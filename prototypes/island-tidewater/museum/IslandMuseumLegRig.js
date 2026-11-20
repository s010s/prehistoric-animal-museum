import { Matrix4 } from '../vendor/tidewater/src/engine/math/Matrix4.js';
import { Quaternion } from '../vendor/tidewater/src/engine/math/Quaternion.js';
import { Vector3 } from '../vendor/tidewater/src/engine/math/Vector3.js';
import { floatAttribute, islandMorphWeights } from './IslandMuseumModelData.js';
import { islandMuseumLegCalibration } from './IslandMuseumLegCalibration.js';

const uintWeight = 65535;

export function islandLegRigExtraGpuBytes(id, geometry) {
  if (!Object.hasOwn(islandMuseumLegCalibration, id)) return 0;
  const { addedVertexBytes = 0 } = islandMuseumLegCalibration[id];
  // Charge the full asset even when only selected materials need another
  // influence set. Each palette alias has current and previous 64-byte rows.
  return addedVertexBytes * geometry.vertices + 32 * 128;
}

function matrixFromPose(node) {
  const rotation = new Quaternion().fromArray(node.r);
  return new Matrix4().compose(new Vector3().fromArray(node.t), rotation, new Vector3().fromArray(node.s));
}

function visibleReference(gltf, skin) {
  const clip = gltf.animations.find(clip => clip.name === 'Idle');
  if (!clip) throw Error('Island leg calibration requires Idle');
  const local = gltf.nodes.map(({ t, r, s }) => ({ t, r, s }));
  for (const { node, path, values } of clip.channels) {
    const [component, count] = { translation: ['t', 3], rotation: ['r', 4], scale: ['s', 3] }[path];
    local[node][component] = values.subarray(0, count);
    if (path === 'rotation') local[node].r = new Quaternion().fromArray(local[node].r).normalize().toArray();
  }
  const world = [];
  function visit(index, parent) {
    world[index] = matrixFromPose(local[index]).premultiply(parent);
    for (const child of gltf.nodes[index].children) visit(child, world[index]);
  }
  for (const root of gltf.roots) visit(root, new Matrix4());
  const palette = skin.joints.map((node, row) =>
    world[node].clone().multiply(new Matrix4().fromArray(skin.inverseBindMatrices, row * 16)));
  return { world, palette, layers: [{ clip, time: 0, weight: 1 }] };
}

function appendNode(gltf, parent, name, translation, children = []) {
  const index = gltf.nodes.length;
  gltf.nodes.push({ name, children, t: translation, r: [0, 0, 0, 1], s: [1, 1, 1] });
  if (parent !== null) gltf.nodes[parent].children.push(index);
  return index;
}

function smoothstep(min, max, value) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function sliceWeight(sections, f, y, l, halo) {
  let i = 1;
  while (i < sections.length - 1 && y < sections[i][1]) i++;
  const a = sections[i - 1], b = sections[i];
  const t = Math.max(0, Math.min(1, (a[1] - y) / (a[1] - b[1])));
  const u = 1 - t;
  const forward = Math.abs(f - a[0] * u - b[0] * t) / (a[3] * u + b[3] * t);
  const lateral = Math.abs(l - a[2] * u - b[2] * t) / (a[4] * u + b[4] * t);
  return 1 - smoothstep(.86 - halo, 1.18 + halo, Math.max(forward, lateral));
}

function influenceSet(vertexCount) {
  return { joints: new Uint16Array(vertexCount * 4), weights: new Uint16Array(vertexCount * 4) };
}

function writeInfluence(influences, vertexCount, vertex, slot, row, weight) {
  const group = slot >> 2;
  if (group === influences.length) influences.push(influenceSet(vertexCount));
  const index = vertex * 4 + (slot & 3);
  influences[group].joints[index] = row;
  influences[group].weights[index] = weight;
}

function blendSkinSeams(pieces, soften) {
  const vertices = new Map(), mesh = [];
  for (const { nodeIndex, primitive, influences } of pieces) {
    if (!influences.length || primitive.targets.length || primitive.mode !== 4) continue;
    const positions = floatAttribute(primitive.attributes.POSITION);
    const nodes = [];
    for (let v = 0; v < positions.length; v += 3) {
      const key = [nodeIndex, positions[v], positions[v + 1], positions[v + 2]].join(',');
      if (!vertices.has(key)) vertices.set(key, { peers: [], adjacent: new Set() });
      const node = vertices.get(key);
      nodes.push(node);
      node.peers.push({ influences, at: v / 3 * 4 });
    }
    mesh.push({ indices: primitive.indices, nodes });
  }
  const accumulate = (target, source, amount) => {
    for (const [row, weight] of source) target.set(row, (target.get(row) ?? 0) + weight * amount);
  };
  const read = ({ at, influences }) => {
    const rows = new Map();
    for (const { weights, joints } of influences) for (let i = at; i < at + 4; i++) {
      if (weights[i]) rows.set(joints[i], (rows.get(joints[i]) ?? 0) + weights[i]);
    }
    return rows;
  };
  // UV seams in these specimens duplicate positions but can carry different
  // weights. Share the blended influences while preserving the separate UVs.
  const seams = [];
  for (const vertex of vertices.values()) {
    const { peers } = vertex;
    if (peers.length < 2) continue;
    const rows = peers.map(read);
    const first = rows[0];
    if (rows.every(row => row.size === first.size && [...row].every(([key, value]) => first.get(key) === value))) continue;
    vertex.weights = new Map();
    for (const row of rows) accumulate(vertex.weights, row, 1 / peers.length);
    seams.push(vertex);
  }
  const settled = new Set(seams);
  if (soften) {
    for (const { indices, nodes } of mesh) for (let i = 0; i < (indices?.length ?? nodes.length); i += 3) {
      const face = [0, 1, 2].map(k => nodes[indices?.[i + k] ?? i + k]);
      for (const node of face) for (const neighbor of face) if (neighbor !== node) node.adjacent.add(neighbor);
    }
    const firstRing = new Set(seams.flatMap(node => [...node.adjacent]));
    const secondRing = new Set([...firstRing].flatMap(node => [...node.adjacent]));
    const near = new Set([...seams, ...firstRing, ...secondRing]);
    for (const node of near) node.weights ??= read(node.peers[0]);
    for (let i = 0; i < 3; i++) {
      const eased = new Map();
      for (const node of near) {
        const mix = node.peers.length > 1 ? .73 : firstRing.has(node) ? .60 : .26;
        const weights = new Map();
        accumulate(weights, node.weights, 1 - mix);
        for (const neighbor of node.adjacent) {
          accumulate(weights, neighbor.weights ?? read(neighbor.peers[0]), mix / node.adjacent.size);
        }
        eased.set(node, weights);
      }
      for (const [node, weights] of eased) node.weights = weights;
    }
    for (const node of near) settled.add(node);
  }
  for (const { peers, weights } of settled) {
    const capacity = Math.min(...peers.map(({ influences }) => influences.length)) * 4;
    const rows = [...weights].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, capacity);
    const total = rows.reduce((sum, [, weight]) => sum + weight, 0);
    if (!total) continue;
    let cumulative = 0, written = 0;
    for (const { at, influences } of peers) for (const { weights } of influences) weights.fill(0, at, at + 4);
    for (const [slot, [row, weight]] of rows.entries()) {
      cumulative += weight;
      const end = Math.round(cumulative / total * uintWeight);
      for (const { at, influences } of peers) {
        const { joints, weights } = influences[slot >> 2];
        joints[at + (slot & 3)] = row;
        weights[at + (slot & 3)] = end - written;
      }
      written = end;
    }
  }
}

function solePatch(candidates, ankleHeight, id, side, fore) {
  if (candidates.length < 9) throw Error(`Missing sole geometry for ${id}, side ${side}, fore ${fore}`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const sample of candidates) min[1] = Math.min(min[1], sample.point[1]);
  const band = (ankleHeight - min[1]) * .18;
  const surface = candidates.filter(({ point }) => point[1] <= min[1] + band);
  for (const { point } of surface) for (const i of [0, 2]) {
    min[i] = Math.min(min[i], point[i]);
    max[i] = Math.max(max[i], point[i]);
  }
  const cells = new Map();
  for (const sample of surface) {
    const [x, y, z] = sample.point;
    const col = Math.min(2, Math.floor(3 * (x - min[0]) / (max[0] - min[0] || 1)));
    const row = Math.min(2, Math.floor(3 * (z - min[2]) / (max[2] - min[2] || 1)));
    const cell = col + 3 * row;
    if (!cells.has(cell) || y < cells.get(cell).point[1]) cells.set(cell, sample);
  }
  const contact = [(min[0] + max[0]) * .5, min[1], (min[2] + max[2]) * .5];
  return { contact, samples: [...cells.values()] };
}

/** Add articulated leg branches to the already unified museum skin palette. */
export function augmentIslandLegRig(id, gltf, pieces, skin) {
  if (!Object.hasOwn(islandMuseumLegCalibration, id)) return null;
  const calibration = islandMuseumLegCalibration[id];
  const { upperBlend = .58, upperHalo = 0, hipFeather = 0, hipHalo = 0, laneDivider, laneOutset = 0 } = calibration;

  const reference = visibleReference(gltf, skin);
  const inverseBind = Array.from(skin.inverseBindMatrices);
  const originalJoints = [...skin.joints];
  const nodeByName = name => {
    const index = gltf.nodes.findIndex(node => node.name === name);
    if (index < 0) throw Error(`Missing island leg attachment ${id}/${name}`);
    return index;
  };
  let root = calibration.root === undefined ? gltf.roots[0] : nodeByName(calibration.root);
  if (!calibration.root && gltf.roots.length > 1) {
    root = appendNode(gltf, null, 'Museum locomotion root', [0, 0, 0], gltf.roots);
    gltf.roots = [root];
    reference.world[root] = new Matrix4();
  }

  const rigidRows = new Map();
  function rigidRow(node) {
    if (!rigidRows.has(node)) {
      const row = skin.joints.length;
      rigidRows.set(node, row);
      skin.joints.push(node);
      inverseBind.push(...new Matrix4().elements);
      reference.palette[row] = reference.world[node];
    }
    return rigidRows.get(node);
  }

  const [fx, fz] = calibration.forward;
  const toModel = ([f, y, l]) => new Vector3(f * fx + l * fz, y, f * fz - l * fx);
  const legs = calibration.legs.map(({ side, fore, attach, joints, sections, source }) => {
    const attachment = attach === null ? root : nodeByName(attach);
    const referenceWorld = reference.world[attachment];
    const inverseAttachment = referenceWorld.clone().invert();
    const centers = joints.map(i => toModel(sections[i]));
    const localCenters = centers.map(center => center.clone().applyMatrix4(inverseAttachment));
    const bones = [];
    let parent = attachment;
    for (const [i, jointName] of ['hip', 'knee', 'ankle'].entries()) {
      const offset = localCenters[i].clone();
      if (i) offset.sub(localCenters[i - 1]);
      const name = ['Museum', fore ? 'fore' : 'hind', side < 0 ? 'left' : 'right', jointName].join(' ');
      const index = appendNode(gltf, parent, name, offset.toArray());
      const offsetFromAttachment = new Matrix4().makeTranslation(...localCenters[i].toArray());
      const world = referenceWorld.clone().multiply(offsetFromAttachment);
      bones.push({ index, world, inverseOffset: offsetFromAttachment.invert(), rows: new Map() });
      parent = index;
    }
    const sourceNodes = new Set(source.map(nodeByName));
    const sourceRows = new Set(originalJoints.flatMap((node, row) => sourceNodes.has(node) ? [row] : []));
    const [hip, knee, ankle] = centers.map(center => center.y);
    return { side, fore, attachment, centers, bones, sections, sourceRows, hip, knee, ankle, candidates: [] };
  });

  function derivedRow(bone, original) {
    if (!bone.rows.has(original)) {
      const row = skin.joints.length;
      if (row > uintWeight) throw Error(`Island leg palette exceeded uint16 indices for ${id}`);
      bone.rows.set(original, row);
      skin.joints.push(bone.index);
      inverseBind.push(...bone.world.clone().invert().multiply(reference.palette[original]).elements);
    }
    return bone.rows.get(original);
  }

  const point = new Vector3(), raw = new Vector3(), transformed = new Vector3();
  for (const [pieceIndex, piece] of pieces.entries()) {
    const { nodeIndex, primitive, influences } = piece;
    if (calibration.materials && !calibration.materials.includes(gltf.materials[primitive.material]?.name)) continue;
    const positions = floatAttribute(primitive.attributes.POSITION);
    const vertexCount = positions.length / 3;
    const wasSkinned = influences.length > 0;
    const initialSets = influences.length;
    const morph = islandMorphWeights(piece, reference.layers, new Float32Array(primitive.targets.length));
    const groundMorph = calibration.groundMorph && morph.length > 0 ? new Float32Array(vertexCount) : null;
    // Scratch rows keep each incoming influence separate throughout the split.
    const old = Array.from({ length: Math.max(1, initialSets * 4) }, () => ({ row: 0, weight: 0 }));

    for (let v = 0, p = 0; v < vertexCount; v++, p += 3) {
      raw.fromArray(positions, p);
      for (let m = 0; m < morph.length; m++) {
        const delta = primitive.targets[m].position;
        if (!delta || !morph[m]) continue;
        raw.x += delta[p] * morph[m];
        raw.y += delta[p + 1] * morph[m];
        raw.z += delta[p + 2] * morph[m];
      }
      let count = 0;
      if (wasSkinned) {
        point.set(0, 0, 0);
        for (let set = 0; set < initialSets; set++) {
          const { joints, weights } = influences[set];
          for (let i = v * 4; i < v * 4 + 4; i++) {
            if (!weights[i]) continue;
            const source = old[count++];
            source.row = joints[i];
            source.weight = weights[i];
            transformed.copy(raw).applyMatrix4(reference.palette[source.row]);
            point.addScaledVector(transformed, source.weight / uintWeight);
          }
        }
      } else {
        point.copy(raw).applyMatrix4(reference.world[nodeIndex]);
      }

      const f = point.x * fx + point.z * fz, l = point.x * fz - point.z * fx;
      const y = point.y;
      let leg = null, coverage = 0;
      for (const candidate of legs) {
        const { sections, sourceRows, hip, knee, ankle, side, fore } = candidate;
        const depth = (hip - y) / (hip - knee);
        if (depth <= -hipFeather) continue;
        const shinHeight = smoothstep(ankle, knee, y);
        const hipTransition = smoothstep(0, 1, depth + hipFeather) * (1 - smoothstep(.66, 1.22, depth));
        const halo = upperHalo * shinHeight + hipHalo * hipTransition;
        const outer = sliceWeight(sections, f, y, l, halo);
        if (!(outer > 0)) continue;
        let authored = 1;
        if (wasSkinned && sourceRows.size) {
          let sourceWeight = 0;
          for (let i = 0; i < count; i++) {
            if (sourceRows.has(old[i].row)) sourceWeight += old[i].weight;
          }
          authored = smoothstep(.08, .72, sourceWeight / uintWeight);
        }
        const divider = laneDivider?.[fore ? 0 : 1];
        // Separate close feet and let the shared inner thigh return to its source skin.
        const lane = divider === undefined ? 1 : smoothstep(0, .012 + .055 * shinHeight, (l - divider) * side);
        const score = lane * outer * authored * smoothstep(-hipFeather, upperBlend, depth);
        if (score <= coverage) continue;
        coverage = score;
        leg = candidate;
      }
      if (!leg || coverage * uintWeight < 1) continue;

      if (!wasSkinned) {
        old[0].row = rigidRow(nodeIndex);
        old[0].weight = uintWeight;
        count = 1;
        if (!influences.length) {
          const source = influenceSet(vertexCount);
          for (let i = 0; i < source.joints.length; i += 4) {
            source.joints[i] = old[0].row;
            source.weights[i] = uintWeight;
          }
          influences.push(source);
        }
      }
      const { hip, knee, ankle, sections, bones } = leg;
      const kneeBlend = Math.min(hip - knee, knee - ankle) * .23;
      const ankleBlend = Math.min(knee - ankle, ankle - sections.at(-1)[1]) * .21;
      const lower = y >= (ankle + knee) * .5 ? 0 : 1;
      const boundary = lower === 0 ? knee : ankle;
      const blend = lower === 0 ? kneeBlend : ankleBlend;
      const distal = 1 - smoothstep(boundary - blend, boundary + blend, y);
      if (lower === 1 && coverage > .996 && distal === 1 && y < ankle - ankleBlend) {
        leg.candidates.push({ point: point.toArray(), piece: pieceIndex, vertex: v });
      }
      for (const { weights } of influences) weights.fill(0, v * 4, v * 4 + 4);
      let slot = 0, footWeight = 0;
      for (let i = 0; i < count; i++) {
        const { row, weight } = old[i];
        const moved = Math.round(weight * coverage);
        const end = Math.round(moved * distal);
        const middle = moved - end;
        if (weight > moved) writeInfluence(influences, vertexCount, v, slot++, row, weight - moved);
        if (middle) writeInfluence(influences, vertexCount, v, slot++, derivedRow(bones[lower], row), middle);
        if (end) writeInfluence(influences, vertexCount, v, slot++, derivedRow(bones[lower + 1], row), end);
        if (lower === 1) footWeight += end;
      }
      if (groundMorph) groundMorph[v] = footWeight / uintWeight;
    }
    if (groundMorph && influences.length) {
      piece.groundMorphMask = groundMorph;
      piece.groundMorphWeights = morph;
    }
  }
  if (calibration.blendSkinSeams) blendSkinSeams(pieces, calibration.softenSkinSeams);
  skin.inverseBindMatrices = Float32Array.from(inverseBind);

  const chains = legs.map(({ side, fore, attachment, centers, bones, ankle, candidates }, limbIndex) => {
    const [upper, lower, foot] = bones.map(bone => bone.index);
    const [hipPoint, kneePoint, anklePoint] = centers;
    const axis = anklePoint.clone().sub(hipPoint).normalize();
    const pole = kneePoint.clone().sub(hipPoint);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const pitch = calibration.solePitch?.[limbIndex] ?? 0;
    let supportCandidates = candidates;
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(fz, 0, -fx), pitch);
    if (pitch) {
      supportCandidates = candidates.map(sample => ({
        ...sample, point: new Vector3(...sample.point).sub(anklePoint).applyQuaternion(rotation).add(anklePoint).toArray(),
      }));
    }
    const { contact: flat, samples } = solePatch(supportCandidates, ankle, id, side, fore);
    const contact = pitch ? new Vector3(...flat).sub(anklePoint).applyQuaternion(rotation.invert()).add(anklePoint).toArray() : flat;
    const outset = laneOutset * side;
    const neutral = [flat[0] + fz * outset, flat[1], flat[2] - fx * outset];
    const sole = new Vector3().fromArray(contact).applyMatrix4(bones[2].world.clone().invert()).toArray();
    const palette = bones.map(({ index, inverseOffset, rows }) => ({
      index: index * 16, inverseOffset, rows: [...rows].map(([source, derived]) => [source * 16, derived * 16]),
    }));
    return { upper, lower, foot, side, fore, sole, contact, neutral, pitch, pole: pole.toArray(), samples, attachment: attachment * 16, palette };
  });
  return {
    root, chains, head: calibration.head && nodeByName(calibration.head), tail: calibration.tail && nodeByName(calibration.tail),
    isolateGroundLegs: calibration.isolateGroundLegs,
    attachmentMatrix: new Matrix4(), delta: new Matrix4(), originalMatrix: new Matrix4(),
  };
}

/**
 * Each new row adds the solved bone's delta to its own native source row.
 * This keeps the complete authored pose and morphs when the added joints are at
 * rest, even where a leg crosses old influences from the pelvis or trunk.
 */
export function syncIslandLegRigPalette(pose, rig, resetPrevious = false, grounded = false) {
  if (!rig) return;
  const { attachmentMatrix, delta, originalMatrix } = rig;
  const { world, jointData } = pose;
  const chains = grounded && rig.isolateGroundLegs ? [] : rig.chains;
  for (const chain of chains) {
    attachmentMatrix.fromArray(world, chain.attachment).invert();
    // Ground motion already places the distal rows with reference mesh shape.
    // Reapplying original animated rows there would reintroduce foot sliding.
    const count = grounded ? chain.palette.length - 1 : chain.palette.length;
    for (let i = 0; i < count; i++) {
      const bone = chain.palette[i];
      delta.fromArray(world, bone.index).multiply(bone.inverseOffset).multiply(attachmentMatrix);
      for (const [source, destination] of bone.rows) {
        originalMatrix.fromArray(jointData, source).premultiply(delta).toArray(jointData, destination);
      }
    }
  }
  if (resetPrevious) jointData.copyWithin(pose.joints * 16, 0, pose.joints * 16);
}
