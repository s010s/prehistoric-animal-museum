// Anatomical pivots measured on the visible reference mesh in forward, up,
// lateral coordinates. Both source files store facial detail on separate draws.
import { Matrix4, Quaternion, Vector3 } from '../../vendor/tidewater/src/engine/index.js';
import { floatAttribute, islandMorphWeights } from '../IslandMuseumModelData.js';

const smooth = (a, b, n) => {
  const x = Math.max(0, Math.min(1, (n - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

const carnotaurus = {
  forward: [0, 1],
  bones: [
    ['Thorax', null, [-.72, 2.67, -.05]],
    ['Neck', 'Thorax', [.44, 2.69, -.04]],
    ['Skull', 'Neck', [1.55, 2.73, .32]],
    ['Mandible', 'Skull', [1.63, 2.49, .42]],
    ['Tail', null, [-1.32, 2.72, -.06]],
    ['Tail middle', 'Tail', [-3, 2.68, .16]],
    ['Tail end', 'Tail middle', [-4.43, 2.50, .88]],
    ['Tail distal', 'Tail end', [-4.81, 2.34, 1.30]],
    ['Tail penultimate', 'Tail distal', [-5.10, 2.12, 1.71]],
    ['Tail tip', 'Tail penultimate', [-5.21, 1.88, 1.90]],
    ['Tail tip landmark', 'Tail tip', [-5.22, 1.43, 2.02]],
    ['Left arm', 'Thorax', [.39, 2.24, .58]],
    ['Left wrist', 'Left arm', [.29, 2.07, .66]],
    ['Right arm', 'Thorax', [.18, 2.25, -.70]],
    ['Right wrist', 'Right arm', [-.08, 2.02, -.85]],
  ],
  // The lower teeth and tongue sit behind the folded cheek. Bind their root
  // and crown with the same weights as the mandible so they stay in the mouth.
  weights(f, y, r, material) {
    if (material === 'CLAW') return [];
    const mandible = material === 'LOWER_TOOTH' ? 1 : material === 'TONGUE' ? smooth(1.02, 1.7, f) * .56
      : material === 'BODY' ? smooth(1.42, 1.82, f) * (1 - smooth(2.35, 2.52, y)) : 0;
    const face = !['BODY', 'CLAW'].includes(material);
    const arm = (side, f0, f1, y0, r0, r1) => {
      const wristStage = smooth(f0, f1, f);
      const centerR = r0 + (r1 - r0) * wristStage;
      return smooth(.39, .60, r * side) * (1 - smooth(.09, .21, Math.abs(r - centerR)))
        * (1 - smooth(y0 - .07, y0 + .20, y)) * smooth(f0 - .27, f0, f)
        * (1 - smooth(f1 + .09, f1 + .21, f)) * smooth(1.55, 1.74, y);
    };
    // The end turns almost vertically in the sculpt. Successive tangent
    // planes separate the joints even where multiple tail rings share Z.
    const distal = f < -3.8 && r > .45;
    const segment = (f0, y0, r0, df, dy, dr, band) => distal
      ? smooth(-band, band, (f-f0)*df + (y-y0)*dy + (r-r0)*dr) : 0;
    return [
      ['Tail tip', segment(-5.21, 1.88, 1.90, -.18, -.88, .43, .14)],
      ['Tail penultimate', segment(-5.10, 2.12, 1.71, -.38, -.68, .63, .18)],
      ['Tail distal', segment(-4.81, 2.34, 1.30, -.59, -.31, .75, .23)],
      ['Mandible', mandible], ['Skull', face ? 1 : smooth(1.19, 1.69, f)],
      ['Left wrist', arm(1, .29, .72, 2.14, .68, .71) * smooth(.30, .49, f)],
      ['Left arm', arm(1, .29, .72, 2.24, .68, .71)],
      ['Right wrist', arm(-1, -.07, .23, 2.03, -.87, -.81) * smooth(-.10, .10, f)],
      ['Right arm', arm(-1, -.07, .23, 2.18, -.87, -.81)],
      ['Neck', smooth(.32, .97, f) * smooth(1.93, 2.28, y)],
      ['Thorax', smooth(-.96, .23, f) * smooth(1.55, 2.49, y)],
      ['Tail end', 1 - smooth(-4.77, -4.04, f)],
      ['Tail middle', 1 - smooth(-3.52, -2.54, f)],
      ['Tail', (1 - smooth(-1.89, -.97, f)) * smooth(1.80, 2.28, y)],
    ];
  },
};

const dilophosaurus = {
  forward: [1, 0],
  bones: [
    ['Thorax', null, [.43, .70, 0]], ['Neck', 'Thorax', [.89, .75, 0]],
    ['Skull', 'Neck', [1.32, .84, 0]], ['Tail', null, [.21, .68, 0]],
    ['Tail middle', 'Tail', [-.41, .66, 0]], ['Tail end', 'Tail middle', [-1.06, .67, 0]],
    ['Left arm', 'Thorax', [.88, .68, -.13]], ['Left wrist', 'Left arm', [.98, .54, -.16]],
    ['Right arm', 'Thorax', [.88, .68, .13]], ['Right wrist', 'Right arm', [.98, .54, .16]],
  ],
  weights(f, y, r, material) {
    const arm = smooth(.68, .84, f) * (1 - smooth(.59, .73, y)) * smooth(.06, .13, Math.abs(r));
    const side = r < 0 ? 'Left' : 'Right';
    return [
      ['Skull', material === 'Body' ? smooth(1.18, 1.36, f) : 1],
      [side + ' wrist', arm * smooth(.95, 1.035, f)], [side + ' arm', arm],
      ['Neck', smooth(.84, 1.06, f) * smooth(.60, .72, y)], ['Thorax', smooth(.37, .68, f) * smooth(.40, .61, y)],
      ['Tail end', 1 - smooth(-1.25, -.89, f)], ['Tail middle', 1 - smooth(-.63, -.21, f)],
      ['Tail', (1 - smooth(.01, .31, f)) * smooth(.44, .62, y)],
    ];
  },
};

function weightSet(count) {
  return { joints: new Uint16Array(count * 4), weights: new Uint16Array(count * 4) };
}

export function prepareBipedBodyRig(id, gltf, pieces, skin, legs) {
  const config = { carnotaurus, dilophosaurus }[id];
  if (!config) return;
  const world = [];
  function visit(i, parent) {
    const node = gltf.nodes[i];
    world[i] = new Matrix4().compose(new Vector3(...node.t), new Quaternion(...node.r), new Vector3(...node.s)).premultiply(parent);
    for (const child of node.children) visit(child, world[i]);
  }
  for (const i of gltf.roots) visit(i, new Matrix4());
  const [fx, fz] = config.forward;
  const ids = new Map();
  for (const [name, parent, [f, y, r]] of config.bones) {
    const p = parent ? ids.get(parent) : legs.root;
    const pivot = new Vector3(f * fx + r * fz, y, f * fz - r * fx);
    const offset = pivot.applyMatrix4(world[p].clone().invert());
    const i = gltf.nodes.length;
    gltf.nodes.push({ name: 'Museum ' + name, children: [], t: offset.toArray(), r: [0, 0, 0, 1], s: [1, 1, 1] });
    gltf.nodes[p].children.push(i);
    world[i] = world[p].clone().multiply(new Matrix4().makeTranslation(...offset.toArray()));
    ids.set(name, i);
  }
  const inverse = Array.from(skin.inverseBindMatrices);
  const idle = gltf.animations.find(clip => clip.name === 'Idle');
  const layers = [{ clip: idle, time: 0, weight: 1 }];
  const raw = new Vector3(), delta = new Vector3();
  for (const piece of pieces) {
    const { primitive, nodeIndex, influences } = piece;
    const material = gltf.materials[primitive.material].name;
    if (material === 'CLAW') continue;
    const position = floatAttribute(primitive.attributes.POSITION);
    const n = position.length / 3;
    // An inverse bind is relative to this particular mesh. Eye, horn, tongue,
    // teeth and body nodes have different origins and scales in Carnotaurus.
    const rows = new Map();
    function rowFor(i) {
      if (!rows.has(i)) {
        const bind = world[i].clone().invert().multiply(world[nodeIndex]);
        const row = skin.joints.length;
        skin.joints.push(i);
        inverse.push(...bind.elements);
        rows.set(i, row);
      }
      return rows.get(i);
    }
    if (!influences.length) {
      const set = weightSet(n), row = rowFor(nodeIndex);
      for (let j = 0; j < n; ++j) {
        set.joints[j * 4] = row;
        set.weights[j * 4] = 65535;
      }
      influences.push(set);
    }
    const morph = islandMorphWeights(piece, layers, new Float32Array(primitive.targets.length));
    for (let j = 0; j < n; ++j) {
      raw.fromArray(position, j * 3);
      for (const [m, target] of primitive.targets.entries()) {
        if (morph[m] && target.position) raw.addScaledVector(delta.fromArray(target.position, j * 3), morph[m]);
      }
      raw.applyMatrix4(world[nodeIndex]);
      const fields = config.weights(fx * raw.x + fz * raw.z, raw.y, fz * raw.x - fx * raw.z, material);
      if (!fields.some(([, w]) => w > 1 / 65535)) continue;
      const entries = [];
      let remaining = 0;
      for (const set of influences) for (let k = j * 4; k < j * 4 + 4; k++) {
        const weight = set.weights[k], row = set.joints[k];
        if (!weight) continue;
        // Existing hindleg rows retain every unit of their measured weight.
        if (skin.joints[row] === nodeIndex) remaining += weight;
        else entries.push([row, weight]);
      }
      if (!remaining) continue;
      const upper = [];
      for (const [name, coverage] of fields) {
        const part = Math.round(remaining * coverage);
        if (part) upper.push([rowFor(ids.get(name)), part]);
        remaining -= part;
      }
      if (remaining) upper.push([rowFor(nodeIndex), remaining]);
      // The leg rig uses at most two derived rows on a rigid source limb.
      // Fit the upper body in the remaining slots, preserving leg weights.
      upper.sort((a, b) => b[1] - a[1]);
      const slots = 4 - entries.length;
      if (upper.length > slots) upper[0][1] += upper.splice(slots).reduce((s, pair) => s + pair[1], 0);
      entries.push(...upper);
      for (const set of influences) set.weights.fill(0, j * 4, j * 4 + 4);
      for (const [k, [row, weight]] of entries.entries()) {
        influences[0].joints[j * 4 + k] = row;
        influences[0].weights[j * 4 + k] = weight;
      }
    }
  }
  skin.inverseBindMatrices = Float32Array.from(inverse);
}
