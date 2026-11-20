import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from '../../../vendor/tidewater/src/engine/index.js';

// Mark lateral patches by original shape, irrespective of current bone weights.
// Read the very same vertices again on every sampled frame of the terrain route.
export function rexRouteCheck(pose, pieces, frameVertex) {
  const named = new Map(pose.gltf.nodes.map((node, i) => [node.name, i]));
  const root = named.get('root');
  const legs = ['left', 'right'].map((side, i) => ({
    sign: i ? 1 : -1, upper: named.get('Museum hind ' + side + ' hip'), lower: named.get('Museum hind ' + side + ' knee'),
    patches: [[],[]], observed: [], cycle: null,
  }));
  const identity = new Matrix4(), inverse = new Matrix4(), point = new Vector3();
  for (const [pieceIndex, piece] of pieces.entries()) {
    for (let vertex = 0; vertex < piece.xyz.length / 3; vertex++) {
      frameVertex(piece, vertex, pose, identity, point);
      for (const leg of legs) {
        if (point.x * leg.sign < .22) continue;
        for (const [i, [f,y]] of [[.16,.70], [.13,.50]].entries()) {
          if (Math.abs(point.y-y)<.027 && Math.abs(point.z-f)<.11) leg.patches[i].push([pieceIndex,vertex]);
        }
      }
    }
  }
  for (const leg of legs) for (const patch of leg.patches) assert(patch.length >= 8, 'Missing outer thigh skin patch');
  const mean = patch => {
    const center = new Vector3();
    for (const [p,v] of patch) center.add(frameVertex(pieces[p],v,pose,inverse,point));
    return center.divideScalar(patch.length);
  };
  const angle = v => Math.atan2(v.z,-v.y) * 180 / Math.PI;
  const joint = i => new Vector3().fromArray(pose.world, i*16+12).applyMatrix4(inverse);
  function record(contacts, cruise) {
    inverse.fromArray(pose.world, root*16).invert();
    for (const [i, leg] of legs.entries()) {
      const foot = contacts[i];
      if (!cruise) {
        leg.cycle = null;
        continue;
      }
      if (!leg.cycle || foot.steps !== leg.cycle.step) {
        if (leg.cycle?.completeStart) {
          const { femora, skin, upper } = leg.cycle;
          const excursion = x => Math.max(...x) - Math.min(...x);
          leg.observed.push({ femur: excursion(femora), skin: excursion(skin), upper: excursion(upper) });
        }
        leg.cycle = { step: foot.steps, completeStart: !!leg.cycle, femora: [], skin: [], upper: [] };
      }
      const top = mean(leg.patches[0]), lower = mean(leg.patches[1]);
      leg.cycle.femora.push(angle(joint(leg.lower).sub(joint(leg.upper))));
      leg.cycle.skin.push(angle(lower.sub(top)));
      leg.cycle.upper.push(top.z * pose.group.scale.x);
    }
  }
  function finish() {
    const cycles = legs.flatMap(l => l.observed);
    assert(cycles.length >= 4, 'Need complete cruising strides on both sides');
    const min = key => Math.min(...cycles.map(c=>c[key]));
    const minGain = Math.min(...cycles.map(c=>c.skin/c.femur));
    assert(min('femur')>15 && min('skin')>12 && min('upper')>.14 && minGain>.60,
      'Stationary hip or skin on the trail: ' + JSON.stringify({femur:min('femur'),skin:min('skin'),top:min('upper'),minGain}));
    return { complete_cruising_strides: cycles.length, min_femur_deg: min('femur'), min_skin_deg: min('skin'),
      min_outer_thigh_excursion_m: min('upper'), min_angular_gain: minGain };
  }
  return { record, finish };
}
