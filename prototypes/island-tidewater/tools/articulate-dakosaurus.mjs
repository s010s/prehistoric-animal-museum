import { Matrix4 } from '../vendor/tidewater/src/engine/index.js';

// Cross-section centres sampled on the exhibited axial skin. Coordinates
// are in the original torso joint frame (lateral, posterior, dorsal).
const centers = [
  [1.5, 55, 19], [11.7, 160, 39], [28.4, 275, 61], [51.8, 390, 82],
  [60.8, 492, 90], [62.3, 561, 89], [48.8, 615, 77], [16.9, 680, 44],
];

export function articulateDakosaurus(doc) {
  const root = doc.getRoot(), skin = root.listSkins()[0], original = skin.listJoints();
  const index = name => original.findIndex(joint => joint.getName() === name);
  const torso = index('Torso'), base = index('TailBase'), tip = index('TailTip');
  if (Math.min(torso, base, tip) < 0) throw Error('Missing Dakosaurus source axial joints');
  const bind = skin.getInverseBindMatrices(), matrices = [...bind.getArray()];
  const torsoBind = new Matrix4().fromArray(matrices, torso * 16);
  const chain = [], rows = [torso];
  let parent = original[torso], previous = [0, 0, 0];
  for (const [i, at] of centers.entries()) {
    const joint = doc.createNode('Caudal ' + (i + 1)).setTranslation(at.map((v,k) => v - previous[k]));
    parent.addChild(joint);
    rows.push(skin.listJoints().length);
    skin.addJoint(joint);
    matrices.push(...new Matrix4().makeTranslation(-at[0], -at[1], -at[2]).multiply(torsoBind).elements);
    chain.push(joint);
    parent = joint;
    previous = at;
  }
  bind.setArray(Float32Array.from(matrices));

  // Carry the original hind paddle sockets on the moving pelvic section.
  // Retain each socket's bind transform and the museum take's local keys.
  const mount = original[base], pivot = centers[1];
  original[torso].removeChild(mount);
  chain[1].addChild(mount);
  mount.setTranslation(mount.getTranslation().map((v,k) => v - pivot[k]));
  for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) {
    if (ch.getTargetNode() !== mount || ch.getTargetPath() !== 'translation') continue;
    const sampler = ch.getSampler(), src = sampler.getOutput();
    const values = src.getArray().map((v,k) => v - pivot[k % 3]);
    sampler.setOutput(src.clone().setArray(values));
  }
  for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION'), jointIndices = primitive.getAttribute('JOINTS_0');
    const influenceWeights = primitive.getAttribute('WEIGHTS_0'), point = [], joints = [], weights = [];
    for (let v = 0; v < positions.getCount(); v++) {
      positions.getElement(v, point);
      const depth = -point[2] - 400;
      if (depth < 0) continue;
      jointIndices.getElement(v, joints);
      influenceWeights.getElement(v, weights);
      let mass = 0;
      const links = [];
      for (let k = 0; k < 4; k++) {
        if (joints[k] === torso || joints[k] === base || joints[k] === tip) mass += weights[k];
        else if (weights[k]) links.push([joints[k],weights[k]]);
      }
      if (!mass) continue;
      // Blend across each station on both sides of its pivot so the muscle
      // bends over a length of skin and adjacent mesh pieces meet exactly.
      let next = centers.findIndex((c,i) => depth < (c[1] + (centers[i+1]?.[1] ?? c[1]+80)) * .5);
      if (next < 0) next = centers.length - 1;
      const mid = centers[next][1];
      const interval = depth < mid ? mid - (centers[next-1]?.[1] ?? -mid) : (centers[next+1]?.[1] ?? mid+80) - mid;
      const u = Math.max(0, Math.min(1, .5 + (depth-mid)/interval));
      const t = u*u*(3-2*u);
      links.push([rows[next], mass*(1-t)], [rows[next+1], mass*t]);
      links.sort((a,b) => b[1]-a[1]);
      const sum = links.slice(0,4).reduce((s,entry) => s+entry[1],0);
      for (let k = 0; k < 4; k++) {
        joints[k] = links[k]?.[0] ?? 0;
        weights[k] = (links[k]?.[1] ?? 0) / sum;
      }
      jointIndices.setElement(v, joints);
      influenceWeights.setElement(v, weights);
    }
  }
}
