import { Matrix4, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { floatAttribute } from './IslandMuseumModelData.js';

// Centres of three cross sections in the source mesh. The hanging part of
// the trunk separates from the tusks below y = -.105 in these coordinates.
const pivots = [
  [-.441, -.125, .090],
  [-.485, -.263, .093],
  [-.501, -.401, .096],
];
const boundaries = [-.105, -.205, -.35, -.49];
const name = index => 'Museum trunk ' + (index + 1);
export const mammothTrunkGpuBytes = pivots.length * 128;

function smooth(start, end, value) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function fitMammothTrunk(gltf, pieces, skin) {
  const headRow = skin.joints.findIndex(i => gltf.nodes[i].name === 'head');
  if (headRow < 0) throw Error('Missing mammoth head bind');
  const head = skin.joints[headRow];
  const headBind = new Matrix4().fromArray(skin.inverseBindMatrices, headRow * 16);
  const binds = [...skin.inverseBindMatrices];
  const rows = [headRow];
  let parent = head, previous = new Vector3();
  for (const [i, p] of pivots.entries()) {
    // Each new joint has its parent's orientation at rest. Its bind first
    // takes a source vertex into head space, then subtracts the pivot.
    const at = new Vector3(...p).applyMatrix4(headBind);
    const index = gltf.nodes.length;
    gltf.nodes.push({ name: name(i), t: at.clone().sub(previous).toArray(), r: [0, 0, 0, 1], s: [1, 1, 1], children: [] });
    gltf.nodes[parent].children.push(index);
    rows.push(skin.joints.length);
    skin.joints.push(index);
    binds.push(...new Matrix4().makeTranslation(-at.x, -at.y, -at.z).multiply(headBind).elements);
    previous = at;
    parent = index;
  }
  skin.inverseBindMatrices = Float32Array.from(binds);
  const linked = [0, 0, 0];
  for (const piece of pieces) {
    const positions = floatAttribute(piece.primitive.attributes.POSITION);
    const { joints, weights } = piece.influences[0];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (y >= -.105 || x < -.59 || x > -.34 || Math.abs(z - .09) >= .119) continue;
      const at = i / 3 * 4;
      let slot = 0;
      while (slot < 4 && (joints[at + slot] !== headRow || weights[at + slot] !== 65535)) slot++;
      if (slot === 4) continue;
      // Overlapping joints fade into one another, including the head at
      // the upper limit. Both the nose tip and the adjacent curl move.
      const lane = y > boundaries[1] ? 0 : y > boundaries[2] ? 1 : 2;
      const blend = Math.round(smooth(boundaries[lane], boundaries[lane + 1], y) * 65535);
      linked[lane]++;
      const next = (slot + 1) % 4;
      joints[at + slot] = rows[lane];
      joints[at + next] = rows[lane + 1];
      weights[at + slot] = 65535 - blend;
      weights[at + next] = blend;
    }
  }
  if (linked.some(count => count === 0)) throw Error('Mammoth nose no longer matches the source skin');
}

export function mammothTrunkMotion(pose, branchAt, orientBranch) {
  const joints = pivots.map((_, i) => branchAt(pose, pose.gltf.nodes.findIndex(n => n.name === name(i))));
  return (phase, weight, time, forward, right) => {
    for (const [i, joint] of joints.entries()) {
      const lag = i * .42;
      // The hanging nose swings under the head. Distal segments follow the
      // proximal part with a delay, then resume a slower exploratory curl.
      const pitch = Math.sin(phase * Math.PI * 2 - lag) * (.09 + i * .018) * weight
        + Math.sin(time * .83 - lag) * (.042 + i * .025) * (1 - weight);
      const sway = Math.sin(phase * Math.PI * 2 + .65 - lag) * .050 * weight
        + Math.sin(time * .62 - lag) * .032 * (1 - weight);
      orientBranch(pose, joint, pitch, right);
      orientBranch(pose, joint, sway, forward);
    }
  };
}
