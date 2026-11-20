// Measure the actual runtime skin and morph envelopes without rendering or changing source GLBs.
// Run with --check to compare against the checked-in bounds.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { prepareIslandAquaticMotion } from '../museum/IslandAquaticMotion.js';
import {
  createIslandModelPose, islandModelPieces, parseIslandMuseumModel,
} from '../museum/IslandMuseumModelData.js';
import { visitAquaticSkin } from './visit-aquatic-skin.mjs';
import { makePlesiosaurSteering } from '../museum/IslandMuseumHeadTurn.js';
import { augmentIslandMediumRig } from '../museum/IslandMuseumMediumRig.js';
import lock from '../museum/island-museum-models.lock.json' with { type: 'json' };

// The native pose evaluator uploads joint palettes. Retain its real pose and
// sampling path while replacing only the destination of that upload.
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 };
GPU.device = { createBuffer: () => ({ destroy() {} }) };
GPU.queue = { writeBuffer() {} };

const museum = new URL('../museum/', import.meta.url);
const motionDirectory = new URL('./aquatic-motion/', museum);
const ids = (await readdir(motionDirectory)).filter(name => name.endsWith('.js')).map(name => name.slice(0, -3))
  .filter(id => Object.hasOwn(lock.animals, id)).sort();

// A long hooked neck still fits an axis-aligned box. Follow the same two
// transverse skull sections even after the corrected pose turns the snout
// almost 90 degrees away from its direction in the source exhibit mesh.
function plesiosaurMuzzle(gltf, pieces, skin) {
  const reference = createIslandModelPose(gltf, skin);
  reference.play('Idle', { fade: 0 });
  reference.update(0);
  const stations = new Int8Array(pieces[0].primitive.attributes.POSITION.array.length / 3);
  let cranium = 0, snout = 0;
  visitAquaticSkin(pieces[0], reference, ([x,,z], i) => {
    if (z < 300) return;
    if (Math.abs(x - 300) < 3) { stations[i] = 1; cranium++; }
    if (Math.abs(x - 373) < 3) { stations[i] = 2; snout++; }
  });
  reference.dispose();
  if (Math.min(cranium, snout) < 4) throw Error('Cannot locate plesiosaur skull sections');
  return stations;
}

async function boundsFor(id) {
  const source = gunzipSync(await readFile(new URL('./assets/island/' + id + '.glb.gz', museum)));
  const gltf = parseIslandMuseumModel(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  await prepareIslandAquaticMotion(gltf, id);
  const { pieces, skin } = islandModelPieces(gltf);
  const metadata = lock.animals[id];
  const skull = id === 'plesiosaurus' ? plesiosaurMuzzle(gltf, pieces, skin) : null;
  augmentIslandMediumRig(id, gltf, pieces, skin, metadata);
  const model = createIslandModelPose(gltf, skin);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const turns = [-1, 1].map(rate => {
    const steering = makePlesiosaurSteering(id, gltf.nodes, skin);
    steering?.follow(rate, 12);
    return steering;
  }).filter(Boolean);
  function sampleSkin() {
    const sums = skull && [[0,0,0], [0,0,0]];
    for (const piece of pieces) visitAquaticSkin(piece, model, (point, vertex) => {
      if (skull && skull[vertex]) {
        const section = sums[skull[vertex] - 1];
        section[0] += point[0]; section[1] += point[2]; section[2]++;
      }
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    });
    if (!sums) return 0;
    const [rear, tip] = sums;
    return Math.atan2(tip[0]/tip[2] - rear[0]/rear[2], tip[1]/tip[2] - rear[1]/rear[2]);
  }
  function measure(dt) {
    model.update(dt);
    const bearing = sampleSkin();
    if (skull && Math.abs(bearing) > .23) throw Error('Plesiosaur snout points aside during a straight swim or rest');
    for (const [index, steering] of turns.entries()) {
      model.update(0);
      steering.apply(model);
      const turned = sampleSkin();
      if (skull && (turned - bearing) * (index ? 1 : -1) < .12) throw Error('Plesiosaur neck did not follow the turn');
    }
  }

  const names = model.clipNames();
  for (const name of names) {
    model.layers.length = 0;
    const layer = model.play(name);
    for (let i = 0; i < 96; i++) {
      layer.time = i * layer.clip.duration / 96;
      measure(0);
    }
  }

  const pair = names.includes('Hover') && names.includes('Swim') ? ['Swim', 'Hover']
    : names.includes('Crawl') ? ['Crawl', 'Idle'] : [];
  for (let i = 0; i < pair.length; i++) {
    const from = pair[i], to = pair[1 - i];
    for (let phase = 0; phase < 1; phase += 1 / 24) {
      model.layers.length = 0;
      model.play(from, { from: phase * model.clipDuration(from) });
      model.play(to, { from: phase * model.clipDuration(to), fade: .28 });
      for (let step = 0; step < 3; step++) measure(.07);
    }
  }
  model.dispose();

  if (![...min, ...max].every(Number.isFinite)) throw Error('Invalid aquatic bounds for ' + id);
  const baseline = metadata.animatedBounds;
  // Preserve the source envelope and allow a small margin on the sampled extensions.
  const padding = baseline.max.map((v, i) => (v - baseline.min[i]) * .001);
  return {
    min: min.map((value, i) => Math.min(baseline.min[i], +(value - padding[i]).toPrecision(8))),
    max: max.map((value, i) => Math.max(baseline.max[i], +(value + padding[i]).toPrecision(8))),
  };
}

const envelopes = {};
for (const id of ids) envelopes[id] = await boundsFor(id);

const file = new URL('./animated-bounds.json', motionDirectory);
const result = '{\n' + Object.entries(envelopes).map(([id, bounds]) =>
  '  ' + JSON.stringify(id) + ': ' + JSON.stringify(bounds)).join(',\n') + '\n}\n';
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== result) throw Error('Stale island aquatic motion bounds');
} else {
  await writeFile(file, result);
}
console.log('Measured native animation bounds for ' + ids.length + ' island specimens');
