// Rebuild the speed profile when the museum changes a flight performance.
// --check also validates the checked-in profiles against the current skins.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { applyIslandFlightMotion, loadIslandFlightClip } from '../museum/IslandFlightMotion.js';
import { createIslandModelPose, islandModelPieces, parseIslandMuseumModel } from '../museum/IslandMuseumModelData.js';
import { augmentIslandMediumRig } from '../museum/IslandMuseumMediumRig.js';
import { visitAquaticSkin as visitSkin } from './visit-aquatic-skin.mjs';
import catalog from '../museum/island-museum-models.lock.json' with { type: 'json' };

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 };
GPU.device = { createBuffer: () => ({ destroy() {} }) };
GPU.queue = { writeBuffer() {} };
const museum = new URL('../museum/', import.meta.url);
const output = new URL('flight-motion/airspeed.json', museum);
// Response time in seconds, maximum fractional rise above cruise, output samples.
const calibration = {
  anurognathus: [.24, .12, 16], sordes: [.73, .15, 32], archaeopteryx: [.36, .14, 24],
  quetzalcoatlus: [1.1, .12, 32], meganeura: [.1, .065, 64],
  rhamphorhynchus: [.7, .17, 40], tupandactylus: [.9, .14, 32], pteranodon: [1.1, .14, 48],
};

async function measure(id, response, rise, samples) {
  const bytes = gunzipSync(await readFile(new URL('assets/island/' + id + '.glb.gz', museum)));
  const gltf = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const source = await loadIslandFlightClip(id);
  if (source) applyIslandFlightMotion(gltf, id, source.default);
  const { skin, pieces } = islandModelPieces(gltf);
  const meta = catalog.animals[id];
  augmentIslandMediumRig(id, gltf, pieces, skin, meta);
  const pose = createIslandModelPose(gltf, skin);
  const layer = pose.play(source ? 'Fly' : 'Idle', { fade: 0 });
  const frame = phase => { layer.time = layer.clip.duration * phase; pose.update(0); };
  const lateral = ([x,,z]) => x * meta.forward[1] - z * meta.forward[0];
  let widest = 0, opened = 0, left = 0, right = 0;
  for (let i = 0; i < 24; i++) {
    frame(i / 24);
    let min = Infinity, max = -Infinity;
    for (const piece of pieces) visitSkin(piece, pose, point => {
      const x = lateral(point);
      min = Math.min(min, x); max = Math.max(max, x);
    });
    if (max - min > widest) { widest = max - min; left = min; right = max; opened = i / 24; }
  }
  frame(opened);
  const counts = [0, 0, 0], middle = (left + right) * .5;
  const landmarks = pieces.map(piece => {
    const parts = new Int8Array(piece.primitive.attributes.POSITION.array.length / 3).fill(-1);
    visitSkin(piece, pose, (point, i) => {
      const x = lateral(point);
      const part = x < left + .022 * widest ? 0 : x > right - .022 * widest ? 1
        : Math.abs(x - middle) < .038 * widest ? 2 : -1;
      parts[i] = part;
      if (part >= 0) counts[part]++;
    });
    return parts;
  });
  if (counts.some(n => n < 3)) throw Error('Cannot locate both wing surfaces and trunk on ' + id);
  const frames = id === 'meganeura' ? 144 : 96;
  let wingDifference = 0;
  const heights = Array.from({ length: frames }, (_, i) => {
    frame(i / frames);
    const sums = [0, 0, 0];
    for (const [j, piece] of pieces.entries()) visitSkin(piece, pose, (point, vertex) => {
      const part = landmarks[j][vertex];
      if (part >= 0) sums[part] += point[1];
    });
    const left = sums[0] / counts[0], right = sums[1] / counts[1];
    wingDifference += left - right;
    return .5 * (left + right) - sums[2] / counts[2];
  });
  // These two exhibition rest poses carried one wing low throughout the
  // entire patrol. Independent asymmetrical beats can still cross the centre.
  if (['archaeopteryx', 'tupandactylus'].includes(id) && Math.abs(wingDifference / frames) > widest * .012) {
    throw Error('Persistent wing-height imbalance on ' + id);
  }
  const blend = -Math.expm1(-layer.clip.duration / (frames * response)), speeds = [];
  let speed = 0;
  // Reach the repeatable glide speed at the loop boundary, including clips
  // beginning partway through a stroke. Wing reversals carry no downstroke impulse.
  for (let j = 0; j < 12 * frames; j++) {
    const i = j % frames;
    const impulse = Math.max(0, heights[(i + frames - 1) % frames] - heights[i]);
    speed += (impulse - speed) * blend;
    speeds[i] = speed;
  }
  pose.dispose();
  const reduced = Array.from({ length: samples }, (_, j) => {
    const at = j * frames / samples, i = Math.floor(at);
    return speeds[i] + (speeds[(i + 1) % frames] - speeds[i]) * (at - i);
  });
  const mean = reduced.reduce((sum, v) => sum + v, 0) / samples;
  const peak = Math.max(...reduced) - mean;
  if (!(peak > 1e-8)) throw Error('No measurable downstroke on ' + id);
  // Signed thousandths of cruise speed. Subtracting the mean keeps the patrol duration.
  return reduced.map(v => Math.round(1000 * rise * (v - mean) / peak));
}

const profiles = {};
for (const [id, parameters] of Object.entries(calibration)) profiles[id] = await measure(id, ...parameters);
const json = '{\n' + Object.entries(profiles).map(([id, curve]) => '  "' + id + '": ' + JSON.stringify(curve)).join(',\n') + '\n}\n';
if (process.argv.includes('--check')) {
  if (json !== await readFile(output, 'utf8')) throw Error('Flight speed profiles differ from the current wing surfaces');
} else {
  await writeFile(output, json);
}
console.log('Measured propulsion from all eight museum flight performances.');
