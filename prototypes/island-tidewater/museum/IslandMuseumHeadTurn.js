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
  const [name, limit] = choice;
  const pivot = nodes.findIndex(node => node.name === name);
  if (pivot < 0) throw Error(`Missing ${name} articulation for ${id}`);
  const selected = new Set();
  const visit = index => {
    selected.add(index);
    for (const child of nodes[index].children) visit(child);
  };
  visit(pivot);
  const paletteRows = skin.joints.flatMap((joint, i) => selected.has(joint) ? [i * 16] : []);
  if (!paletteRows.length) throw Error(`Missing skinned head branch for ${id}`);
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
