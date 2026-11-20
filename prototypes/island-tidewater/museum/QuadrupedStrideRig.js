import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { floatAttribute, islandMorphWeights } from './IslandMuseumModelData.js';
import { setIslandMotionClip } from './IslandMotionClips.js';

const quadrupeds = new Set([
  'stegosaurus', 'ankylosaurus', 'dimetrodon', 'lystrosaurus', 'maiasaura', 'parasaurolophus',
  'regaliceratops', 'triceratops', 'mammoth', 'apatosaurus', 'sauropelta',
]);

// Pivots are forward / lateral / height measured on the displayed GLB.
// Fore and hind limb anchors follow the corresponding section of the trunk.
const axialRigs = {
  apatosaurus: [
    ['haunch', null, .34, 0, .49, .28], ['chest', 'haunch', .70, 0, .49, .30],
    ['neck', 'chest', .93, 0, .49, .19], ['neck mid', 'neck', 1.16, 0, .58, .14],
    ['head', 'neck mid', 1.41, 0, .80, .12], ['tail', 'haunch', .16, 0, .46, .24],
    ['tail mid', 'tail', -.30, 0, .36, .26], ['tail tip', 'tail mid', -.88, 0, .29, .34],
  ],
  sauropelta: [
    ['haunch', null, .12, 0, .52, .24], ['chest', 'haunch', .55, 0, .49, .28],
    ['neck', 'chest', .89, 0, .49, .22], ['head', 'neck', 1.19, 0, .49, .20],
    ['tail', 'haunch', -.20, 0, .49, .20], ['tail mid', 'tail', -.61, 0, .39, .24],
    ['tail tip', 'tail mid', -1.04, 0, .30, .27],
  ],
};

export function quadrupedExtraGpuBytes(id) {
  // These joints reuse the four skin attribute slots allocated by the leg rig.
  return (axialRigs[id]?.length ?? 0) * 128;
}

function addAxialSkin(id, gltf, pieces, skin, metadata, rig) {
  const source = gltf.roots[0], base = gltf.nodes[source];
  const world = new Matrix4().compose(new Vector3(...base.t), new Quaternion(...base.r), new Vector3(...base.s));
  const inverse = world.clone().invert();
  const [fx, fz] = metadata.forward;
  const binds = [...skin.inverseBindMatrices], bones = new Map();
  for (const [name, parent, f, l, h, width] of axialRigs[id]) {
    const pivot = new Vector3(f * fx + l * fz, h, f * fz - l * fx).applyMatrix4(inverse);
    const ancestor = bones.get(parent), i = gltf.nodes.length, row = skin.joints.length;
    const offset = ancestor ? pivot.clone().sub(ancestor.pivot) : pivot;
    gltf.nodes.push({ name: 'Stride ' + name, t: offset.toArray(), r: [0, 0, 0, 1], s: [1, 1, 1], children: [] });
    gltf.nodes[ancestor?.i ?? source].children.push(i);
    skin.joints.push(i);
    binds.push(...new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).elements);
    bones.set(name, { name, pivot, i, row, f, width });
  }
  skin.inverseBindMatrices = Float32Array.from(binds);
  for (const chain of rig.chains) {
    const node = gltf.nodes[chain.upper], parent = bones.get(chain.fore ? 'chest' : 'haunch');
    base.children = base.children.filter(i => i !== chain.upper);
    gltf.nodes[parent.i].children.push(chain.upper);
    node.t = new Vector3(...node.t).sub(parent.pivot).toArray();
  }
  rig.head = bones.get('neck').i;
  rig.tail = bones.get('tail').i;
  const ordered = [...bones.values()].sort((a, b) => a.f - b.f);
  const layers = [{ clip: gltf.animations.find(clip => clip.name === 'Idle'), time: 0, weight: 1 }];
  const point = new Vector3(), delta = new Vector3();
  for (const piece of pieces) {
    const { primitive, influences, nodeIndex } = piece;
    if (nodeIndex !== source || influences.length !== 1) throw Error('Unexpected axial skin layout for ' + id);
    const position = floatAttribute(primitive.attributes.POSITION);
    const morph = islandMorphWeights(piece, layers, new Float32Array(primitive.targets.length));
    const { weights, joints } = influences[0];
    for (let v = 0; v < position.length / 3; v++) {
      const at = v * 4;
      let slot = -1, empty = -1;
      for (let j = at; j < at + 4; j++) {
        if (weights[j] && skin.joints[joints[j]] === source) slot = j;
        else if (!weights[j]) empty = j;
      }
      if (slot < 0) continue;
      point.fromArray(position, v * 3);
      for (let m = 0; m < morph.length; m++) {
        const change = primitive.targets[m].position;
        if (morph[m] && change) point.addScaledVector(delta.fromArray(change, v * 3), morph[m]);
      }
      point.applyMatrix4(world);
      const f = point.x * fx + point.z * fz;
      // Skin between neighboring bone centers. Tail joints take over towards
      // the tip, neck joints towards the muzzle. The haunch owns the midline.
      let previous = ordered[0], next = previous, blend = 0;
      for (let k = 1; k < ordered.length; k++) {
        next = ordered[k];
        const split = (previous.f + next.f) * .5;
        const width = Math.min(next.f - previous.f, (previous.width + next.width) * .5);
        blend = Math.min(1, Math.max(0, (f - split) / width + .5));
        if (blend < 1 || k === ordered.length - 1) break;
        previous = next;
      }
      blend = blend * blend * (3 - 2 * blend);
      const weight = weights[slot];
      if (blend === 0 || blend === 1) {
        joints[slot] = (blend ? next : previous).row;
      } else {
        if (empty < 0) throw Error('Axial weight exceeds four slots for ' + id);
        joints[slot] = previous.row;
        joints[empty] = next.row;
        weights[empty] = Math.round(weight * blend);
        weights[slot] = weight - weights[empty];
      }
    }
  }
}

export function prepareQuadrupedStride(id, gltf, pieces, skin, metadata, legRig) {
  if (!quadrupeds.has(id) || gltf.animations.some(clip => clip.name === 'StrideBase')) return;
  if (axialRigs[id]) addAxialSkin(id, gltf, pieces, skin, metadata, legRig);
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const times = new Float32Array(1), reference = new Quaternion(), original = new Quaternion();
  const channels = idle.channels.map(channel => {
    const rotation = channel.path === 'rotation', width = rotation ? 4 : 3;
    const values = channel.values.slice(0, width), node = gltf.nodes[channel.node];
    if (id === 'stegosaurus' && rotation && /^Tail\d+_/.test(node.name)) {
      // The exhibit idle sweeps its tip two metres across in 1.25s. Keep its
      // relaxed vertical curve, with a much smaller lateral excursion at rest.
      reference.fromArray(node.r).normalize();
      const quieter = new Float32Array(channel.values.length);
      for (let i = 0; i < quieter.length; i += 4) {
        original.fromArray(channel.values, i).normalize();
        original.slerp(reference, .91).toArray(quieter, i);
      }
      channel.values = quieter;
      reference.toArray(values);
    }
    return { ...channel, values, times, _k: 0 };
  });
  const morphChannels = new Map([...idle.morphChannels ?? []].map(([node, ch]) => [node, {
    times, values: ch.values.slice(0, ch.values.length / ch.times.length), step: false,
  }]));
  setIslandMotionClip(gltf, { name: 'StrideBase', duration: 1, channels, morphChannels });
}
