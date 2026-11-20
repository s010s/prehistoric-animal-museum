import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { floatAttribute, islandMorphWeights } from './IslandMuseumModelData.js';
import { islandMuseumMediumCalibration } from './IslandMuseumMediumCalibration.js';
import { TAU } from './IslandMotionClips.js';

const fullWeight = 65535;

export function islandMediumRigExtraGpuBytes(id, geometry) {
  if (!Object.hasOwn(islandMuseumMediumCalibration, id)) return 0;
  const { joints } = islandMuseumMediumCalibration[id];
  return geometry.vertices * 16 + (joints.length + 1) * 128;
}

function sourceMatrix(gltf, index) {
  const world = new Matrix4();
  let node = index;
  while (node >= 0) {
    const { t, r, s } = gltf.nodes[node];
    world.premultiply(new Matrix4().compose(new Vector3(...t), new Quaternion(...r), new Vector3(...s)));
    node = gltf.nodes.findIndex(candidate => candidate.children.includes(node));
  }
  return world;
}

function sourceVertex(piece, position, offset, weights, result) {
  result.fromArray(position, offset);
  for (const [i, weight] of weights.entries()) {
    const delta = piece.primitive.targets[i].position;
    if (!weight || !delta) continue;
    result.x += weight * delta[offset];
    result.y += weight * delta[offset + 1];
    result.z += weight * delta[offset + 2];
  }
  return result;
}

function addMotion(clip, joints, active, toModel, sourceInverse) {
  const defaultSamples = 72;
  const defaultTimes = Float32Array.from({ length: defaultSamples + 1 }, (_, i) => clip.duration * i / defaultSamples);
  const rotation = new Quaternion(), part = new Quaternion();
  const delta = new Vector3(), turned = new Vector3(), d = new Vector3();
  const channels = [...clip.channels];
  for (const joint of joints) {
    const authored = clip.aquaticAuxiliary?.get(joint.name);
    if (!authored && !joint.motion) throw Error('Missing supplemental motion for ' + joint.name);
    const times = authored?.times ?? defaultTimes;
    const samples = times.length - 1;
    const rotations = authored?.values ?? new Float32Array(times.length * 4);
    const translations = joint.anchor ? new Float32Array(times.length * 3) : null;
    const anchor = joint.anchor;
    const values = anchor && new Float32Array(anchor.weights.length);
    const layers = [{ clip, time: 0, weight: 1 }];
    for (let i = 0; i < samples; i++) {
      if (authored) {
        rotation.fromArray(rotations, i * 4).normalize();
      } else {
        const phase = i / samples * TAU;
        rotation.identity();
        for (const [axis, angle] of joint.motion(phase, active)) {
          const localAxis = toModel(axis).transformDirection(sourceInverse);
          rotation.premultiply(part.setFromAxisAngle(localAxis, angle));
        }
        rotation.normalize().toArray(rotations, i * 4);
      }
      if (translations) {
        layers[0].time = times[i];
        islandMorphWeights(anchor.piece, layers, values);
        delta.set(0, 0, 0);
        for (const [j, target] of anchor.piece.primitive.targets.entries()) {
          if (target.position) delta.addScaledVector(d.fromArray(target.position, anchor.offset), values[j] - anchor.weights[j]);
        }
        // Conjugate the joint rotation around the moving morph landmark.
        // A zero angle still gives precisely the original morph geometry.
        turned.copy(delta).applyQuaternion(rotation);
        delta.sub(turned).add(joint.offset).toArray(translations, i * 3);
      }
    }
    if (!authored) rotations.copyWithin(samples * 4, 0, 4);
    channels.push({ node: joint.node, path: 'rotation', times, values: rotations });
    if (translations) {
      translations.copyWithin(samples * 3, 0, 3);
      channels.push({ node: joint.node, path: 'translation', times, values: translations });
    }
  }
  clip.channels = channels;
}

/**
 * Add native articulation to rigid morph-animated source models. Original
 * morph deltas, mesh space, and Idle channels use the source transform.
 */
export function augmentIslandMediumRig(id, gltf, pieces, skin, metadata) {
  if (!Object.hasOwn(islandMuseumMediumCalibration, id)) return;
  const config = islandMuseumMediumCalibration[id];
  const source = pieces[0].nodeIndex;
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const clips = [config.active, config.resting].filter(Boolean).map(name => {
    const clip = gltf.animations.find(clip => clip.name === name);
    if (!clip) throw Error(`Missing supplemental motion clip ${id}/${name}`);
    return clip;
  });
  if (!idle || idle.channels.length || pieces.some(piece => piece.nodeIndex !== source || piece.influences.length)) {
    throw Error(`Unexpected source skeleton for island ${id}`);
  }
  const sourceWorld = sourceMatrix(gltf, source);
  const sourceInverse = sourceWorld.clone().invert();
  const [x, z] = config.forward ?? metadata.forward;
  const axisLength = Math.hypot(x, z);
  const fx = x / axisLength, fz = z / axisLength;
  const toModel = ([f, y, l]) => new Vector3(f * fx + l * fz, y, f * fz - l * fx);
  const inverseBind = [...skin.inverseBindMatrices];
  const whole = new Matrix4();
  const baseRow = skin.joints.indexOf(source);
  const rigidRow = baseRow >= 0 ? baseRow : skin.joints.length;
  if (baseRow < 0) {
    skin.joints.push(source);
    inverseBind.push(...whole.elements);
  }

  const joints = [];
  for (const def of config.joints) {
    const pivot = toModel(def.pivot);
    const local = pivot.clone().applyMatrix4(sourceInverse);
    const parent = def.parent ? joints.find(joint => joint.name === def.parent) : null;
    const offset = parent ? local.clone().sub(parent.local) : local;
    const node = gltf.nodes.length, row = skin.joints.length;
    gltf.nodes.push({ name: 'Museum ' + def.name, t: offset.toArray(), r: [0, 0, 0, 1], s: [1, 1, 1], children: [] });
    gltf.nodes[parent?.node ?? source].children.push(node);
    skin.joints.push(node);
    inverseBind.push(...whole.makeTranslation(-local.x, -local.y, -local.z).elements);
    joints.push({ ...def, pivot, local, offset, node, row, affected: 0, distance: Infinity, anchor: null });
  }
  skin.inverseBindMatrices = Float32Array.from(inverseBind);

  const layers = [{ clip: idle, time: 0, weight: 1 }];
  const point = new Vector3();
  for (const piece of pieces) {
    const { primitive } = piece;
    const material = gltf.materials[primitive.material]?.name;
    const position = floatAttribute(primitive.attributes.POSITION);
    const weights = islandMorphWeights(piece, layers, new Float32Array(primitive.targets.length));
    const jointRows = new Uint16Array(position.length / 3 * 4).fill(rigidRow);
    const jointWeights = new Uint16Array(jointRows.length);
    let affected = false;
    for (let offset = 0, i = 0; offset < position.length; offset += 3, i += 4) {
      sourceVertex(piece, position, offset, weights, point).applyMatrix4(sourceWorld);
      const f = point.x * fx + point.z * fz, l = point.x * fz - point.z * fx;
      let remaining = fullWeight, count = 0;
      // Prefer the distal joint and let the taper blend with its proximal
      // parent, which already contributes motion through the hierarchy.
      for (let j = joints.length - 1; j >= 0; j--) {
        const joint = joints[j], amount = joint.weight(f, point.y, l, material);
        if (joint.followMorph && amount > .005 && weights.length) {
          const distance = point.distanceToSquared(joint.pivot);
          if (distance < joint.distance) {
            joint.distance = distance;
            joint.anchor = { piece, offset, weights };
          }
        }
        const contribution = Math.round(amount * remaining);
        if (!contribution) continue;
        if (count === 4) throw Error(`Too many supplemental joint influences in island ${id}`);
        jointRows[i + count] = joint.row;
        jointWeights[i + count++] = contribution;
        joint.affected++;
        affected = true;
        remaining -= contribution;
      }
      if (remaining) {
        if (count === 4) throw Error(`Too many supplemental joint influences in island ${id}`);
        jointWeights[i + count] = remaining;
      }
    }
    if (affected) piece.influences.push({ joints: jointRows, weights: jointWeights });
  }
  if (joints.some(joint => !joint.affected || (joint.followMorph && !joint.anchor))) {
    throw Error(`Missing supplemental joint geometry in island ${id}`);
  }
  for (const clip of clips) {
    addMotion(clip, joints, clip.name === config.active, toModel, sourceInverse);
    delete clip.aquaticAuxiliary;
  }
}
