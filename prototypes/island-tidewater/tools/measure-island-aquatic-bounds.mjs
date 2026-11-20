// Measure the actual runtime skin and morph envelopes without rendering or changing source GLBs.
// Run with --check to compare against the checked-in bounds.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { prepareIslandAquaticMotion } from '../museum/IslandAquaticMotion.js';
import {
  createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, parseIslandMuseumModel,
} from '../museum/IslandMuseumModelData.js';
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

function measurePiece(piece, model, min, max) {
  const weights = new Float32Array(piece.defaultWeights.length);
  islandMorphWeights(piece, model.layers, weights);
  const source = floatAttribute(piece.primitive.attributes.POSITION);
  const targets = piece.primitive.targets;
  const point = new Float64Array(3);
  for (let offset = 0, vertex = 0; offset < source.length; offset += 3, vertex += 4) {
    let x = source[offset], y = source[offset + 1], z = source[offset + 2];
    for (let j = 0; j < weights.length; j++) {
      const delta = targets[j].position;
      if (!delta || !weights[j]) continue;
      x += delta[offset] * weights[j];
      y += delta[offset + 1] * weights[j];
      z += delta[offset + 2] * weights[j];
    }
    point.fill(0);
    if (piece.influences.length) {
      const rows = model.jointData;
      for (const skin of piece.influences) {
        for (let i = vertex; i < vertex + 4; i++) {
          const weight = skin.weights[i] / 65535;
          if (!weight) continue;
          const j = skin.joints[i] * 16;
          for (let axis = 0; axis < 3; axis++) {
            const k = j + axis;
            point[axis] += weight * (rows[k] * x + rows[k + 4] * y + rows[k + 8] * z + rows[k + 12]);
          }
        }
      }
    } else {
      const rows = model.world, node = piece.nodeIndex * 16;
      for (let axis = 0; axis < 3; axis++) {
        const k = node + axis;
        point[axis] = rows[k] * x + rows[k + 4] * y + rows[k + 8] * z + rows[k + 12];
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
}

async function boundsFor(id) {
  const source = gunzipSync(await readFile(new URL('./assets/island/' + id + '.glb.gz', museum)));
  const gltf = parseIslandMuseumModel(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  await prepareIslandAquaticMotion(gltf, id);
  const { pieces, skin } = islandModelPieces(gltf);
  const metadata = lock.animals[id];
  augmentIslandMediumRig(id, gltf, pieces, skin, metadata);
  const model = createIslandModelPose(gltf, skin);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const measure = dt => {
    model.update(dt);
    for (const piece of pieces) measurePiece(piece, model, min, max);
  };

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
