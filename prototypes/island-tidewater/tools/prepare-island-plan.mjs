// Generate the entrance thumbnail and cartography from the same composed
// terrain and water queries as the visitor scene, sampled every 40 m.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ISLAND_PLAN } from '../island/plan.js';
import { bakeAtlasImages } from './island-atlas-images.mjs';
import { loadRuntimeTerrain } from './load-runtime-terrain.mjs';

const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { terrain, field, island: world, islandMasks } = await loadRuntimeTerrain();
const bounds = ISLAND_PLAN.bounds;
const [west, north, east, south] = bounds;
const [originX, originZ] = world.sourceOrigin;
const texelMetres = 40;
const res = (east - west) / texelMetres;
if (!Number.isInteger(res) || south - north !== res * texelMetres ||
    world.sourceOrigin.some((offset, axis) => offset !== ISLAND_PLAN.sourceOrigin[axis])) {
  throw Error('Runtime terrain and atlas coordinate frames disagree');
}

const { seaLevel } = world;
const heights = new Float32Array(res ** 2);
const water = new Float32Array(res ** 2);
const habitat = new Uint8Array(res ** 2 * 4);
const maskStep = world.size / world.maskRes;
const waterProbe = [0, 0, 0, 0];
let land = 0;
for (let row = 0; row < res; row++) {
  const z = north + (row + 0.5) * texelMetres - originZ;
  const maskZ = Math.floor((z - world.origin) / maskStep);
  for (let col = 0; col < res; col++) {
    const x = west + (col + 0.5) * texelMetres - originX;
    const index = row * res + col;
    const h = terrain.heightAt(x, z);
    const [level, distance] = field.sample(x, z, waterProbe);
    const inlandWater = distance < 0.05 && level > seaLevel;
    if (!Number.isFinite(h) || !Number.isFinite(level)) throw Error('Invalid atlas sample at ' + x + ', ' + z);
    heights[index] = h;
    water[index] = inlandWater ? level : seaLevel;
    if (h > seaLevel) land++;

    const maskX = Math.floor((x - world.origin) / maskStep);
    const maskIndex = (maskZ * world.maskRes + maskX) * 4;
    const offset = index * 4;
    habitat[offset] = inlandWater && h < level + 1 ? 230 : 0;
    habitat[offset + 1] = islandMasks[maskIndex + 1];
    habitat[offset + 2] = islandMasks[maskIndex + 2];
    habitat[offset + 3] = islandMasks[maskIndex + 3];
  }
}

// Preserve narrow channels that otherwise disappear at 40 m resolution.
// Split the line when it reaches the shore or the water field has a gap.
function riverRuns(points) {
  const runs = [];
  let run = [];
  for (const [x, z] of points) {
    const [level, distance] = field.sample(x, z, waterProbe);
    if (distance < 0.05 && level > seaLevel && terrain.heightAt(x, z) < level + 0.3) {
      run.push([Math.round(x + originX), Math.round(z + originZ)]);
    } else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const { riverStart, riverStep, riverCount } = field.riverLayout;
const riverZ = Array.from({ length: Math.floor((riverCount - 1) * riverStep / 20) }, (_, index) => riverStart + index * 20);
const rivers = [
  ...riverRuns(riverZ.map(z => [field.riverAt(z).x, z])),
  ...riverRuns(world.tributary.filter((_, index) => index % 3 === 0).map(([x, , , z]) => [x, z])),
  ...riverRuns(field.continuousSample.points.filter((_, index) => index % 16 === 0).map(({ x, z }) => [x, z])),
];
const meta = {
  schema: 'museum-island-cartography-v2',
  plan: ISLAND_PLAN.id,
  bounds,
  res,
  texelMetres,
  seaLevel,
  landAreaKm2: land * texelMetres ** 2 / 1e6,
  rivers,
};

const preview = { size: 460, webpQuality: 76 };
const images = await bakeAtlasImages({ meta, heights, water, habitat }, preview);
const outputs = [];
for (const [path, bytes] of [
  ['island/assets/heights.bin', Buffer.from(heights.buffer)],
  ['island/assets/water.bin', Buffer.from(water.buffer)],
  ['island/assets/habitat.bin', Buffer.from(habitat.buffer)],
  ['island/assets/map.json', Buffer.from(JSON.stringify(meta) + '\n')],
  ...images,
]) {
  await writeFile(new URL(path, root), bytes);
  outputs.push({ path, bytes: bytes.length, sha256: sha(bytes) });
}

const inputs = await Promise.all([
  'creek/geography.lock.json',
  'creek/coast.lock.json',
  'creek/watershed.lock.json',
  'creek/island.lock.json',
  'creek/sample.lock.json',
].map(async path => ({ path, sha256: sha(await readFile(new URL(path, root))) })));
const lock = {
  schema: 'museum-island-plan-export-v2',
  provenance: 'The default native terrain composition and inland water used by CreekApp, sampled at atlas cell centres in source coordinates',
  sampling: { bounds, sourceOrigin: world.sourceOrigin, res, texelMetres, seaLevel },
  preview,
  inputs,
  outputs,
};
await writeFile(new URL('island/export.lock.json', root), JSON.stringify(lock, null, 2) + '\n');
console.log(`Exported ${res} × ${res} runtime atlas samples at ${texelMetres} m, two lossless maps and a ${preview.size} px entrance preview`);
