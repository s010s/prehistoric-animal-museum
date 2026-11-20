import { Matrix4, Quaternion, Vector3 } from '../../vendor/tidewater/src/engine/index.js';
import { floatAttribute } from '../IslandMuseumModelData.js';

// Angle about each lower jaw's own local hinge. The weight aliases in the
// Dimetrodon skull share one hinge and divide the transition through the cheek.
const lowerJaws = {
  baryonyx: ['Bone.007', [1, 0, 0], 3.1],
  gallimimus: ['骨骼.006', [0, 0, 1], 9.25],
  ankylosaurus: ['LowerJaw', [1, 0, 0], 9.5],
  maiasaura: ['jaw_031', [1, 0, 0], -2.15],
};
const radians = Math.PI / 180;
function smooth(a, b, x) {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

function fitTerrorBirdBeak(gltf, pieces, skin) {
  const headRow = skin.joints.findIndex(i => gltf.nodes[i].name === 'Head');
  const head = skin.joints[headRow], bind = new Matrix4().fromArray(skin.inverseBindMatrices, headRow * 16);
  // The entire beak was rigidly carried by the skull. In the rest mesh the
  // bill points toward +X/-Z. Separate the mandible and tongue through the
  // empty space below the hooked upper beak, feathering into the cheek.
  const socket = new Vector3(1.10, 2.09, -.266);
  const pivot = socket.clone().applyMatrix4(bind);
  const lateral = new Vector3(.34, 0, .94).transformDirection(bind);
  const angle = new Quaternion().setFromAxisAngle(lateral, 9.1 * radians);
  const i = gltf.nodes.length, row = skin.joints.length;
  gltf.nodes.push({ name: 'Museum lower beak', t: pivot.toArray(), r: angle.toArray(), s: [1, 1, 1], children: [] });
  gltf.nodes[head].children.push(i);
  skin.joints.push(i);
  const inverse = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).multiply(bind);
  skin.inverseBindMatrices = Float32Array.from([...skin.inverseBindMatrices, ...inverse.elements]);
  for (const piece of pieces) {
    const xyz = floatAttribute(piece.primitive.attributes.POSITION);
    for (let v = 0; v < xyz.length / 3; v++) {
      const f = .94 * (xyz[v * 3] - socket.x) - .34 * (xyz[v * 3 + 2] - socket.z);
      if (f <= -.035) continue;
      const gap = 2.120 - .25 * f - .40 * f * f;
      const share = smooth(-.035, .120, f) * (1 - smooth(gap - .009, gap + .009, xyz[v * 3 + 1]));
      if (share <= 0) continue;
      let available, source;
      for (const set of piece.influences) for (let k = v * 4; k < v * 4 + 4; k++) {
        if (set.weights[k] === 0) available = [set, k];
        else if (set.joints[k] === headRow) source = [set, k];
      }
      if (!source) continue;
      const [set, k] = source, amount = Math.round(share * set.weights[k]);
      if (amount === set.weights[k]) set.joints[k] = row;
      else if (amount) {
        if (!available) throw Error('No available influence for the lower beak');
        const [spare, at] = available;
        set.weights[k] -= amount;
        spare.joints[at] = row;
        spare.weights[at] = amount;
      }
    }
  }
}

export function prepareGroundRestingJaws(id, gltf, pieces, skin) {
  if (id === 'phorusrhacos') return fitTerrorBirdBeak(gltf, pieces, skin);
  const rig = lowerJaws[id];
  if (!rig && id !== 'dimetrodon') return;
  const axis = new Vector3(...(rig?.[1] ?? [-1, 0, 0]));
  const key = new Quaternion(), ref = new Quaternion(), offset = new Quaternion();
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const clips = gltf.animations.filter(clip => clip === idle || clip.name === 'StrideBase');
  for (const [i, node] of gltf.nodes.entries()) {
    let degrees;
    if (rig && node.name === rig[0]) degrees = rig[2];
    else if (!rig && node.name.startsWith('IdleJaw_Head_')) degrees = 30 * Number(node.name.slice(-2)) / 64;
    else continue;
    const authored = idle.channels.find(channel => channel.node === i && channel.path === 'rotation');
    ref.fromArray(authored?.values ?? node.r).normalize();
    offset.setFromAxisAngle(axis, degrees * radians);
    key.fromArray(node.r).multiply(offset).normalize().toArray(node.r);
    // Keep a small part of the original living gape, including while a walk
    // settles back to the museum's stationary clip. Keep the upper jaw still.
    for (const clip of clips) {
      const rotation = clip.channels.find(channel => channel.node === i && channel.path === 'rotation');
      if (!rotation) continue;
      const values = rotation.values.slice();
      for (let j = 0; j < values.length; j += 4) {
        key.fromArray(values, j).normalize().slerp(ref, .84).multiply(offset).normalize().toArray(values, j);
      }
      rotation.values = values;
    }
  }
}
