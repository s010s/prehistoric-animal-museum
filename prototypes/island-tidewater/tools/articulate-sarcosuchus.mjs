// The museum crocodile has an axial skeleton. The skin along its outer
// limbs is bound to a stationary root. Extend only the island derivative.
const limbs = {
  fore: [[.738, -.025, .193], [.674, -.045, .28], [.718, -.16, .356]],
  hind: [[.158, -.052, .19], [.214, -.057, .278], [.164, -.149, .359]],
};

function ramp(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function articulateSarcosuchus(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins().find(s => s.getName() === 'Sarcosuchus_Rig');
  const anchor = skin?.listJoints().find(j => j.getName() === 'Root');
  const legs = root.listNodes().find(n => n.getName() === 'Sarcosuchus_legs')?.getMesh();
  if (!legs || !anchor) throw Error('Sarcosuchus limb skin or source skeleton missing');
  const bind = skin.getInverseBindMatrices();
  const matrices = [...bind.getArray()];
  const rows = new Map();
  for (const [pair, landmarks] of Object.entries(limbs)) for (const side of [-1, 1]) {
    let parent = anchor, previous = [0, 0, 0];
    const indices = [];
    for (const [j, [x, y, radius]] of landmarks.entries()) {
      const z = radius * side;
      const bone = doc.createNode('Swim ' + pair + ' ' + side + ' ' + j)
        .setTranslation([x - previous[0], y - previous[1], z - previous[2]]);
      parent.addChild(bone);
      indices.push(skin.listJoints().length);
      skin.addJoint(bone);
      matrices.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1);
      previous = [x, y, z];
      parent = bone;
    }
    rows.set(pair + side, indices);
  }
  bind.setArray(Float32Array.from(matrices));

  for (const primitive of legs.listPrimitives()) {
    const pos = primitive.getAttribute('POSITION');
    const joints = primitive.getAttribute('JOINTS_0');
    const weights = primitive.getAttribute('WEIGHTS_0');
    const p = [], j = [], w = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      const [x, , z] = p;
      // Keep the overlapping socket on its original influences; the cross
      // sections further from the flank blend into each anatomical joint.
      const span = Math.abs(z);
      const limb = ramp(.179, .315, span);
      if (!limb) continue;
      const row = rows.get((x > .45 ? 'fore' : 'hind') + Math.sign(z));
      const elbow = ramp(.312, .383, span);
      const wrist = ramp(.379, .448, span);
      joints.getElement(i, j);
      weights.getElement(i, w);
      const links = j.map((joint, k) => [joint, w[k] * (1 - limb)]);
      links.push([row[0], limb * (1 - elbow)], [row[1], limb * elbow * (1 - wrist)], [row[2], limb * elbow * wrist]);
      links.sort((a, b) => b[1] - a[1]);
      const sum = links.slice(0, 4).reduce((n, link) => n + link[1], 0);
      for (let k = 0; k < 4; k++) {
        j[k] = links[k][0];
        w[k] = links[k][1] / sum;
      }
      joints.setElement(i, j);
      weights.setElement(i, w);
    }
  }
}
