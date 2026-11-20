// These branches carry the head and its facial joints only. Limits are in
// radians relative to the current native pose, about the selected joint.
const HEAD_TURNS = {
  lystrosaurus: ['Neck_2_064_63', .14],
  stegosaurus: ['Neck2_06', .13],
  regaliceratops: ['Neck', .10],
  triceratops: ['head', .10],
  'tyrannosaurus-rex': ['neck', .12],
};

export function makeIslandHeadTurn(id, nodes, skin) {
  const choice = HEAD_TURNS[id];
  if (!choice) return null;
  return headBranch(nodes, skin, ...choice);
}

function headBranch(nodes, skin, name, limit) {
  const pivot = nodes.findIndex(node => node.name === name);
  if (pivot < 0) throw Error(`Missing ${name} articulation`);
  const selected = new Set();
  const visit = index => {
    selected.add(index);
    for (const child of nodes[index].children) visit(child);
  };
  visit(pivot);
  const paletteRows = skin.joints.flatMap((joint, i) => selected.has(joint) ? [i * 16] : []);
  if (!paletteRows.length) throw Error(`Missing skinned branch for ${name}`);
  return { pivot: pivot * 16, rows: [...selected].map(index => index * 16), paletteRows, limit };
}

function rotateRow(data, base, c, s, px, pz) {
  for (const offset of [0, 4, 8, 12]) {
    const translate = offset === 12;
    const i = base + offset, x = data[i] - (translate ? px : 0), z = data[i + 2] - (translate ? pz : 0);
    data[i] = c * x + s * z + (translate ? px : 0);
    data[i + 2] = -s * x + c * z + (translate ? pz : 0);
  }
}

export function applyIslandHeadTurn(pose, turn, yaw, resetPrevious = false) {
  const angle = Math.max(-turn.limit, Math.min(turn.limit, yaw));
  if (!angle) return;
  const { pivot, rows, paletteRows } = turn;
  const { world, jointData } = pose;
  const c = Math.cos(angle), s = Math.sin(angle);
  const px = world[pivot + 12], pz = world[pivot + 14];
  for (const row of rows) rotateRow(world, row, c, s, px, pz);
  for (const row of paletteRows) rotateRow(jointData, row, c, s, px, pz);
  if (resetPrevious) jointData.copyWithin(pose.joints * 16, 0, pose.joints * 16);
}

// A neck leads a turn. The tail follows the previous heading and recovers
// as the animal straightens. Both follow the body's actual change in yaw.
export function makeAquaticSteering(id, nodes, skin) {
  const tail = id === 'dakosaurus';
  const chain = tail ? ['Caudal 2', 'Caudal 4', 'Caudal 6', 'Caudal 8']
    : id === 'plesiosaurus'
    ? ['Museum lower neck', 'Museum middle neck', 'Museum upper neck', 'Museum head']
    : id === 'styxosaurus' ? ['NeckBase', 'NeckMid', 'NeckTip', 'Head'] : null;
  if (!chain) return null;
  const shares = [.24, .32, .28, .16];
  const limit = tail ? .11 : .18;
  const response = tail ? -.29 : .60;
  const branches = chain.map((name, i) => headBranch(nodes, skin, name, limit * shares[i]));
  const angles = new Float64Array(chain.length);
  return {
    follow(yawRate, dt) {
      if (!dt) { angles.fill(0); return; }
      let desired = Math.max(-limit, Math.min(limit, yawRate * response));
      for (let i = 0; i < angles.length; i++) {
        const blend = -Math.expm1(-dt / (.12 + .025 * i));
        angles[i] += (desired - angles[i]) * blend;
        if (Math.abs(angles[i]) < .00003 && !desired) angles[i] = 0;
        desired = angles[i];
      }
    },
    apply(pose) {
      let changed = false;
      for (let i = 0; i < branches.length; i++) {
        if (!angles[i]) continue;
        applyIslandHeadTurn(pose, branches[i], angles[i] * shares[i]);
        changed = true;
      }
      return changed;
    },
  };
}
