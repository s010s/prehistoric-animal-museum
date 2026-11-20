// A large peak-to-peak bend can take place entirely on one side of the trunk.
// Track fixed points on the skinned surface and measure both halves separately.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { prepareIslandAquaticMotion } from '../museum/IslandAquaticMotion.js';
import { augmentIslandMediumRig } from '../museum/IslandMuseumMediumRig.js';
import { createIslandModelPose, islandModelPieces, parseIslandMuseumModel } from '../museum/IslandMuseumModelData.js';
import { mergeMuseumSkins } from '../museum/NativeMuseumSkin.js';
import { prepareMuseumMotion } from '../museum/AnimalMotionPolish.js';
import { visitAquaticSkin } from './visit-aquatic-skin.mjs';
import lock from '../museum/island-museum-models.lock.json' with { type: 'json' };
import sampleFish from '../museum/assets/sample-ichthyosaur.json' with { type: 'json' };

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 };
GPU.device = { createBuffer: () => ({ destroy() {} }) };
GPU.queue = { writeBuffer() {} };
const museum = new URL('../museum/', import.meta.url);
const swimmers = ['tullimonstrum', 'dakosaurus', 'ichthyosaur', 'sample-ichthyosaur', 'sarcosuchus',
  'dallasaurus', 'xiphactinus', 'mosasaurus', 'livyatan', 'megalodon', 'opabinia'];
const quantile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)];

function crossings(points, axis, plane) {
  const hits = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if ((a.p[axis] <= plane) === (b.p[axis] <= plane)) continue;
    const t = (plane - a.p[axis]) / (b.p[axis] - a.p[axis]);
    hits.push({
      p: a.p.map((v, j) => v + (b.p[j] - v) * t),
      weights: [...a.weights.map(([j, w]) => [j, w * (1 - t)]), ...b.weights.map(([j, w]) => [j, w * t])],
    });
    if (points.length === 2) break;
  }
  return hits;
}

// Cut the resting mesh across the body. Intersect both skin surfaces at
// several heights and keep their barycentric coordinates for the whole clip.
function sectionMarkers(vertices, triangles, forward) {
  const edges = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const indices = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (indices.every(j => vertices[j][0] <= forward) || indices.every(j => vertices[j][0] > forward)) continue;
    const segment = crossings(indices.map(j => ({ p: vertices[j], weights: [[j, 1]] })), 0, forward);
    if (segment.length === 2) edges.push(segment);
  }
  const heights = edges.flat().map(v => v.p[1]), low = Math.min(...heights), high = Math.max(...heights);
  const rows = [];
  for (let i = 0; i < 13; i++) {
    const height = low + (high - low) * (.27 + .038 * i);
    const hits = edges.flatMap(edge => crossings(edge, 1, height)).sort((a, b) => a.p[2] - b.p[2]);
    if (hits.length < 2) continue;
    const a = hits[0], b = hits.at(-1);
    rows.push({ center: (a.p[2] + b.p[2]) / 2, width: b.p[2] - a.p[2], pair: [a, b] });
  }
  const center = quantile(rows.map(r => r.center), .5), width = quantile(rows.map(r => r.width), .5);
  const pairs = rows.filter(r => Math.abs(r.center - center) <= width * .12).flatMap(r => r.pair);
  if (!pairs.length) throw Error('No paired surface landmarks in body section');
  const weights = new Map();
  for (const point of pairs) for (const [i, w] of point.weights) weights.set(i, (weights.get(i) ?? 0) + w / pairs.length);
  return [...weights];
}

// These pairs trim or row together. The other limbs can intentionally
// alternate. The paired source pivots may coincide, so select actual skin.
function pairedFinTips(id, pieces, gltf, skin, rest) {
  const pairs = id === 'opabinia' ? [['BodyA.L_015', 'BodyA.R_016'], ['BodyB.L_013', 'BodyB.R_014'],
    ['BodyC.L_011', 'BodyC.R_012']] : id === 'megalodon' ? [['Bone.012_Armature_25', 'Bone.011_Armature_22']]
    : id === 'ichthyosaur' ? [['front_fin_L', 'front_fin_R']] : [];
  if (!pairs.length) return [];
  const regions = new Map(pairs.flat().map(name => [name, []]));
  let vertex = 0;
  for (const piece of pieces) {
    const count = piece.primitive.attributes.POSITION.array.length / 3;
    for (let i = 0; i < count; i++, vertex++) {
      for (const binding of piece.influences) for (let j = 4 * i; j < 4 * i + 4; j++) {
        if (binding.weights[j] < .45 * 65535) continue;
        const name = gltf.nodes[skin.joints[binding.joints[j]]].name;
        regions.get(name)?.push(vertex);
      }
    }
  }
  function outboard(name) {
    const region = regions.get(name);
    const sign = Math.sign(region.reduce((sum, i) => sum + rest[i][2], 0));
    const edge = quantile(region.map(i => rest[i][2] * sign), .80);
    const tips = region.filter(i => rest[i][2] * sign >= edge);
    if (!tips.length) throw Error(id + ': no skin on ' + name);
    return tips;
  }
  return pairs.map(pair => pair.map(outboard));
}

function checkMatchedBeat(specimen, clip, beats) {
  for (const [left, right] of beats) {
    if ([left, right].some(heights => Math.max(...heights) - Math.min(...heights) < .001)) {
      throw Error(specimen + ' ' + clip + ' has a stationary fin in a matched pair');
    }
    const lowest = values => values.indexOf(Math.min(...values));
    const difference = Math.abs(lowest(left) - lowest(right));
    const separation = Math.min(difference, left.length - difference);
    if (separation > left.length / 3) throw Error(specimen + ' ' + clip + ' has opposed beats on a matched pair of fins');
  }
}

function envelope(values) {
  return [Math.min(...values), Math.max(...values)].map(v => v.toFixed(2)).join(' / ');
}

// Cut the snout through both oral rims. Teeth may interlock, so select the
// skull and mandible skin separately from the dental mesh.
function oralRims(id, gltf, pieces, skin, rest, length, plane) {
  const crocodile = id === 'sarcosuchus';
  if (!crocodile && id !== 'xiphactinus') return null;
  const mesh = crocodile ? 'Sarcosuchus_head' : 'Joined_source_head';
  const bones = crocodile ? ['Head', 'Jaw'] : ['j_neck_03_bind_0130', 'j_jaw_01_bind_0134'];
  let base = 0;
  for (const p of pieces) {
    const count = p.primitive.attributes.POSITION.array.length / 3;
    if (gltf.nodes[p.nodeIndex].name !== mesh) { base += count; continue; }
    const threshold = plane(crocodile ? .966 : .95), rims = [[], []], anterior = [];
    const kind = new Int8Array(count);
    for (let i = 0; i < count; i++) {
      const binding = p.influences[0], start = i * 4;
      let largest = start;
      for (let j = start + 1; j < start + 4; j++) if (binding.weights[j] > binding.weights[largest]) largest = j;
      kind[i] = bones.indexOf(gltf.nodes[skin.joints[binding.joints[largest]]].name);
      if (rest[base + i][0] > threshold - .04 * length) anterior.push(base + i);
    }
    const indices = p.primitive.indices;
    for (let i = 0; i < indices.length; i += 3) {
      const local = [indices[i], indices[i + 1], indices[i + 2]], tri = local.map(j => base + j);
      if (tri.every(j => rest[j][0] <= threshold - .04 * length)) continue;
      for (const [k, rim] of rims.entries()) if (local.filter(j => kind[j] === k).length >= 2) rim.push(tri);
    }
    return { rims, anterior, length, threshold, offset: (crocodile ? .004 : .009) * length };
  }
  throw Error('Missing oral surfaces for ' + id);
}

function rimGap({ rims, anterior, length, threshold, offset }, points) {
  let tip = -Infinity;
  for (const j of anterior) tip = Math.max(tip, points[j][0]);
  const mid = quantile(anterior.filter(j => points[j][0] > tip - .01 * length).map(j => points[j][2]), .5);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const diff = (a, b) => [a[0] - b[0], a[1] - b[1]];
  function toSegment(p, a, b) {
    const [x, y] = diff(b, a), [dx, dy] = diff(p, a);
    const t = Math.max(0, Math.min(1, (dx * x + dy * y) / (x * x + y * y || 1)));
    return Math.hypot(dx - t * x, dy - t * y);
  }
  for (const lateral of [mid - offset, mid, mid + offset]) {
    const cuts = rims.map(rim => rim.flatMap(tri => {
      if (tri.every(j => points[j][0] <= threshold)) return [];
      const edges = [];
      for (let i = 0; i < 3; i++) {
        const a = points[tri[i]], b = points[tri[(i + 1) % 3]];
        if ((a[2] < lateral) === (b[2] < lateral)) continue;
        const t = (lateral - a[2]) / (b[2] - a[2]);
        edges.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
      return edges.length === 2 ? [edges] : [];
    }));
    let gap = Infinity;
    for (const [a, b] of cuts[0]) for (const [c, d] of cuts[1]) {
      const u = diff(b, a), v = diff(d, c), w = diff(c, a), den = cross(u, v);
      const s = cross(w, u) / den, t = cross(w, v) / den;
      if (s > 0 && s < 1 && t > 0 && t < 1) throw Error('Upper and lower snout surfaces intersect');
      gap = Math.min(gap, toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
    }
    if (!(gap < .018 * length)) throw Error('Swimming with a sustained display gape');
  }
}

async function check(specimen) {
  const sample = specimen === 'sample-ichthyosaur', id = sample ? 'ichthyosaur' : specimen;
  const metadata = sample ? sampleFish : lock.animals[id];
  const resource = sample ? 'assets/sample-ichthyosaur.glb' : 'assets/island/' + id + '.glb.gz';
  const source = await readFile(new URL(resource, museum)), raw = sample ? source : gunzipSync(source);
  let gltf = parseIslandMuseumModel(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  if (sample) gltf = prepareMuseumMotion(mergeMuseumSkins(gltf), id);
  await prepareIslandAquaticMotion(gltf, id);
  const { pieces, skin } = islandModelPieces(gltf);
  if (!sample) augmentIslandMediumRig(id, gltf, pieces, skin, metadata);
  const model = createIslandModelPose(gltf, skin), triangles = [];
  const [fx, fz] = metadata.forward;
  let count = 0;
  for (const piece of pieces) {
    const n = piece.primitive.attributes.POSITION.array.length / 3;
    for (const i of piece.primitive.indices ?? Array.from({ length: n }, (_, j) => j)) triangles.push(count + i);
    count += n;
  }
  function surface() {
    const vertices = [];
    for (const p of pieces) visitAquaticSkin(p, model, ([x, y, z]) => vertices.push([x * fx + z * fz, y, x * fz - z * fx]));
    return vertices;
  }

  try {
    model.play('Idle', { fade: 0 });
    model.update(0);
    const rest = surface(), xs = rest.map(v => v[0]);
    let min = Infinity, max = -Infinity;
    for (const x of xs) { min = Math.min(min, x); max = Math.max(max, x); }
    const length = max - min, plane = f => min + length * f;
    const pairs = pairedFinTips(id, pieces, gltf, skin, rest);
    const mouth = oralRims(id, gltf, pieces, skin, rest, length, plane);
    const anchors = [.43, .66, .16].map(f => sectionMarkers(rest, triangles, plane(f)));
    const tips = xs.flatMap((v, i) => v < plane(.032) ? [i] : []);
    anchors.push(tips.map(i => [i, 1 / tips.length]));
    // A horizontal whale fluke sweeps vertically; the other caudal fins
    // move across the sagittal plane. Their dorsal outlines need not match.
    const direction = id === 'livyatan' ? 1 : 2;
    for (const clip of ['Hover', 'Swim']) {
      model.layers.length = 0;
      const layer = model.play(clip, { fade: 0 }), peduncle = [], tail = [];
      const beats = pairs.map(() => [[], []]);
      for (let i = 0; i < 48; i++) {
        layer.time = layer.clip.duration * i / 48;
        model.update(0);
        const vertices = surface();
        if (mouth && i % 4 === 0) rimGap(mouth, vertices);
        const positions = anchors.map(rows => [0, direction].map(k => rows.reduce((v, [j, w]) => v + w * vertices[j][k], 0)));
        const [a, b] = positions;
        if (pairs.length) {
          const trunkHeight = anchors[0].reduce((h, [j, w]) => h + w * vertices[j][1], 0);
          for (const [k, pair] of pairs.entries()) for (const [side, tips] of pair.entries()) {
            const height = tips.reduce((h, j) => h + vertices[j][1], 0) / tips.length;
            beats[k][side].push((height - trunkHeight) / length);
          }
        }
        for (const [k, samples] of [[2, peduncle], [3, tail]]) {
          const [f, measurement] = positions[k];
          const trunkAxis = a[1] + (b[1] - a[1]) * (f - a[0]) / (b[0] - a[0]);
          samples.push((measurement - trunkAxis) * 100 / length);
        }
      }
      checkMatchedBeat(specimen, clip, beats);
      if (id === 'opabinia') {
        console.log(specimen, clip, 'three matched pairs of swimming lobes');
        continue;
      }
      console.log(specimen, clip, 'peduncle / tip extrema (% length):', envelope(peduncle), '|', envelope(tail));
      const left = -Math.min(...tail), right = Math.max(...tail);
      const leftFrames = tail.filter(v => v < 0).length / tail.length;
      if (Math.min(left, right) < .4 * Math.max(left, right) || leftFrames < .24 || leftFrames > .76) {
        throw Error(specimen + ' ' + clip + ' spends its tail stroke on one side of the trunk');
      }
      if (!(Math.min(...peduncle) < 0 && Math.max(...peduncle) > 0)) {
        throw Error(specimen + ' ' + clip + ' keeps its tailstock on one side of the trunk');
      }
      if (!(left + right >= 1)) throw Error(specimen + ' ' + clip + ' has no measurable caudal stroke');
    }
  } finally {
    model.dispose();
  }
}
const selected = process.argv.slice(2);
for (const id of selected.length ? selected : swimmers) await check(id);
