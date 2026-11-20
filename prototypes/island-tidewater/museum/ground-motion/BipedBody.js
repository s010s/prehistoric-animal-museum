import { Vector3 } from '../../vendor/tidewater/src/engine/index.js';
import { bipedAnatomy } from './BipedAnatomy.js';
import { bipedActions } from './BipedActions.js';
import { createRestingMandible } from './RestingMandible.js';

const up = new Vector3(0, 1, 0);
const degree = Math.PI / 180;
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

// The Blender table stores per-joint incremental anatomical angles. The
// ground solver supplies the phase of the foot that is really bearing weight.
export function createBipedBodyMotion(id, pose, { branchAt, orientBranch }) {
  const rig = bipedAnatomy[id];
  if (!rig) return null;
  const action = bipedActions[id];
  const indices = new Map(pose.gltf.nodes.map((n, i) => [n.name, i]));
  const get = name => {
    if (!name) return null;
    const i = indices.get(name);
    if (i === undefined) throw Error('Missing biped articulation ' + id + '/' + name);
    return branchAt(pose, i);
  };
  const arms = [...rig.left.map(get), ...rig.right.map(get)];
  if (id === 'allosaurus-pandras') {
    for (const [side, arm] of ['L', 'R'].map((side, i) => [side, arms[i]])) {
      const family = new Set(pose.gltf.nodes.flatMap((node, i) => node.name.startsWith('IdleClaw' + side + '_') ? [i] : []));
      arm.nodes = [...family].map(i => i * 16);
      arm.joints = pose.skin.joints.flatMap((i, j) => family.has(i) ? [j * 16] : []);
    }
  }
  const chest = get(rig.chest), neck = get(rig.neck), head = get(rig.head), jaw = get(rig.jaw);
  const tail = rig.tail.map(get);
  // The Allosaurus tail controls are siblings. Apply its neutral correction
  // to their union around the tail socket so the three sections stay joined.
  const allosaurusTail = id === 'allosaurus-pandras'
    ? { i: tail[0].i, nodes: tail.flatMap(part => part.nodes), joints: tail.flatMap(part => part.joints) } : null;
  const middleNeck = id === 'phorusrhacos' ? get('Neck') : null;
  const neckTip = id === 'gigantoraptor' ? get('neck7_011_9_35') : null;
  const tongue = id === 'gigantoraptor' ? get('tongue5_018_0_42') : null;
  const tailLandmark = id === 'carnotaurus' ? get('Museum Tail tip landmark')
    : id === 'gigantoraptor' ? get('tail10_055_44_80') : null;
  const tailSlopes = id === 'carnotaurus' ? [-2, -3, -4, -5, -6, -8] : [6, 9, 12];
  const attentiveWalker = id === 'carnotaurus' || id === 'baryonyx' || id === 'therizinosaurus';
  const channels = [chest, neck, head, ...arms, ...tail];
  const buffer = new Float64Array(action[0].length);
  const rotate = (branch, angle, axis) => orientBranch(pose, branch, angle, axis);
  const restJaw = createRestingMandible(id, pose, head, jaw, rotate, get);
  function align(from, to, forward, right, amount) {
    const a = from.i * 16 + 12, b = to.i * 16 + 12;
    const x = pose.world[b] - pose.world[a], z = pose.world[b + 2] - pose.world[a + 2];
    const angle = Math.atan2(x * right.x + z * right.z, x * forward.x + z * forward.z);
    rotate(from, -angle * amount, up);
  }
  return ({ phase, gaitWeight, time, turn, lookYaw = 0, alert, right, forward }) => {
    const frame = ((phase % 1 + 1) % 1) * action.length;
    const index = Math.floor(frame), a = action[index], b = action[(index + 1) % action.length];
    for (let i = 0; i < buffer.length; ++i) buffer[i] = (a[i] + (b[i] - a[i]) * (frame - index)) * degree * gaitWeight;
    // Idle morphs contain a sculpted turn in Carnotaurus. Center the load
    // over the hips and keep all seven face materials together. Gigantoraptor
    // has an independently keyed terminal neck joint, so use its live heading.
    if (id === 'carnotaurus') {
      rotate(chest, -3 * degree, up);
      rotate(neck, -17 * degree, up);
      rotate(head, -8.4 * degree, up);
      rotate(jaw, -51 * degree, right);
      rotate(neck, (6.5 + 2.5 * gaitWeight) * degree, right);
      rotate(head, (5 + 1.5 * gaitWeight) * degree, right);
    } else if (id === 'baryonyx' || id === 'therizinosaurus') {
      // The museum rest pose turns the actual muzzle left even in straight
      // travel. Share its correction between the neck and skull sockets.
      const yaw = 8.5 * degree;
      rotate(neck, yaw * .6, up);
      rotate(head, yaw * .4, up);
    } else if (id === 'gigantoraptor') {
      align(neckTip, head, forward, right, .97);
      align(head, tongue, forward, right, .88);
    } else if (middleNeck) {
      // The neck and beak are sculpted to one side of this bird's straight
      // rest bones. Restore the skin's centreline across both neck sockets.
      rotate(neck, -15 * degree, up);
      rotate(middleNeck, -4 * degree, up);
      rotate(head, 8 * degree, up);
    } else if (id === 'spinosaurus') {
      rotate(chest, 9 * degree, up);
      rotate(tail[0], 9 * degree, up);
    }
    if (allosaurusTail) rotate(allosaurusTail, -8 * degree, up);
    if (tailLandmark) {
      for (let i = 0; i < tail.length; i++) {
        const joint = tail[i], next = tail[i + 1] ?? tailLandmark;
        const from = joint.i * 16 + 12, to = next.i * 16 + 12;
        const dx = pose.world[to] - pose.world[from], dz = pose.world[to + 2] - pose.world[from + 2];
        const elevation = Math.atan2(pose.world[to + 1] - pose.world[from + 1], Math.hypot(dx, dz));
        const heading = Math.atan2(dx * right.x + dz * right.z, -dx * forward.x - dz * forward.z);
        rotate(joint, heading, up);
        rotate(joint, tailSlopes[i] * degree - elevation, right);
      }
    }
    for (let i = 0; i < channels.length; i++) {
      rotate(channels[i], buffer[i * 3], right);
      rotate(channels[i], buffer[i * 3 + 1], up);
      rotate(channels[i], buffer[i * 3 + 2], forward);
    }
    const quiet = 1 - gaitWeight;
    const breath = Math.sin(time * (id === 'gallimimus' ? 1.8 : 1.12));
    const scan = Math.sin(time * .61) * .66 + Math.sin(time * 1.09) * .34;
    // These long-muzzled specimens spend much of a walk on a nearly
    // straight heading. Brief independent glances survive the foot cycle.
    const walkingScan = attentiveWalker && !alert
      ? gaitWeight * (1 - Math.abs(turn)) * (.050 * Math.sin(time * .86) + .019 * Math.sin(time * 1.76 + .8)) : 0;
    const attention = (alert ? .012 : .073) * quiet * scan + walkingScan
      + clamp(lookYaw, -.20, .20) + turn * .17;
    rotate(neck, attention * .56, up);
    rotate(head, attention * (neck ? .44 : 1), up);
    rotate(neck, quiet * breath * .018, right);
    rotate(head, quiet * breath * -.012, right);
    if (restJaw) restJaw(breath, quiet);
    else rotate(jaw, (.5 + .5 * breath) * .023 * quiet, right);
    rotate(tail[0], -turn * .12 + quiet * .014 * Math.sin(time * .73), up);
    if (tailLandmark) for (let i = 1; i < tail.length; i++) {
      rotate(tail[i], -turn * .09 / (1 + i * .40) + quiet * .006 * Math.sin(time * .73 - i * .44), up);
    }
  };
}
