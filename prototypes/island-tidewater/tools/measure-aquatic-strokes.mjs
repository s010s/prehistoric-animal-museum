// Sample the hydrated, visible museum skin. The runtime uses the resulting
// cyclic pressure profile to synchronize displacement to the playing clip.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { augmentIslandMediumRig } from '../museum/IslandMuseumMediumRig.js';
import { prepareIslandAquaticMotion } from '../museum/IslandAquaticMotion.js';
import { createIslandModelPose, islandModelPieces, parseIslandMuseumModel } from '../museum/IslandMuseumModelData.js';
import { visitAquaticSkin } from './visit-aquatic-skin.mjs';
import lock from '../museum/island-museum-models.lock.json' with { type: 'json' };
import calibration from '../museum/aquatic-motion/rig-calibration.json' with { type: 'json' };
import { ISLAND_FAUNA_PLAN } from '../creek/IslandFaunaPlan.js';

globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4 };
GPU.device = {createBuffer: () => ({destroy() {}})};
GPU.queue = {writeBuffer() {}};

const species = {
  anomalocaris: 'lobes', opabinia: 'lobes', hallucigenia: 'legs', ammonite: 'jet',
  plesiosaurus: 'paddles', styxosaurus: 'paddles', livyatan: 'flukes',
};
const propulsionRows = {lobes: /^(Flap_|Body[ABC]\.)/, legs: /^Bone\./, jet: /^tentacles/};
const count = 40;
const check = process.argv.includes('--check');
const museum = new URL('../museum/', import.meta.url);
const quantile = (a, t) => a[Math.floor((a.length - 1) * t)];

function regions(vertices, mode) {
  const forward = vertices.map(v => v.f).sort((a,b) => a-b);
  const extent = vertices.map(v => Math.abs(v.l)).sort((a,b) => a-b);
  const low = quantile(forward, .30), high = quantile(forward, .65), width = quantile(extent, .42);
  const torso = vertices.filter(v => v.f >= low && v.f <= high && Math.abs(v.l) <= width && !v.limb);
  const groups = [];
  if (mode === 'tail' || mode === 'flukes') {
    groups.push(vertices.filter(v => v.f <= quantile(forward, .035)));
  } else if (mode === 'jet') {
    groups.push(vertices.filter(v => v.limb));
  } else if (mode === 'legs') {
    const legs = vertices.filter(v => v.limb);
    const bottom = quantile(legs.map(v => v.y).sort((a,b) => a-b), .15);
    for (const side of [-1, 1]) {
      const feet = legs.filter(v => v.y <= bottom && side * v.l > 0);
      const middle = quantile(feet.map(v => v.f).sort((a,b) => a-b), .50);
      groups.push(feet.filter(v => v.f <= middle), feet.filter(v => v.f > middle));
    }
  } else {
    // Split the outboard blade tips into fore/aft and left/right. Opposed
    // blades can cancel perfectly at their centroid while each sweeps water.
    for (const side of [-1, 1]) {
      const candidates = vertices.filter(v => side * v.l > 0 && (mode !== 'lobes' || v.limb));
      const edge = quantile(candidates.map(v => side * v.l).sort((a,b) => a-b), .82);
      const tips = candidates.filter(v => side * v.l >= edge);
      const middle = quantile(tips.map(v => v.f).sort((a,b) => a-b), .50);
      groups.push(tips.filter(v => v.f <= middle), tips.filter(v => v.f > middle));
    }
  }
  if ([torso, ...groups].some(group => group.length < 4)) throw Error('Missing body or propulsive skin for ' + mode);
  return [torso, ...groups];
}

// Replay the real clip through the same propulsion API as both visitor
// routes. A skin held in its current phase may coast, but cannot add thrust.
async function checkLaunch(id, model, layer) {
  const { aquaticDrive, aquaticTravel } = await import('../creek/IslandAquaticLocomotion.js');
  const drive = aquaticDrive(id), period = layer.clip.duration;
  const ticks = 100, dt = period / ticks;
  layer.time = 0;
  model.update(0);
  if (aquaticTravel(drive, layer, layer.time, 1, true, dt) !== 0) throw Error(id + ': frozen launch');
  let finalCycle = 0;
  for (let frame = 0; frame < 6 * ticks; frame++) {
    const previousTime = layer.time;
    model.update(dt);
    const distance = aquaticTravel(drive, layer, previousTime, 1, true, dt);
    if (!frame && distance > 0) throw Error(id + ': movement preceded the first stroke');
    if (frame >= 5 * ticks) finalCycle += distance;
  }
  if (Math.abs(finalCycle / period - 1) > .01) throw Error(id + ': wrong steady cruise distance');
  const before = drive.speed;
  for (let frame = 0; frame < 3 * ticks; frame++) aquaticTravel(drive, layer, layer.time, 1, true, dt);
  if (drive.speed > .001 * before) throw Error(id + ': frozen skin continued to propel the body');
}

async function measure(id) {
  const mode = species[id] ?? 'tail';
  const src = gunzipSync(await readFile(new URL('assets/island/' + id + '.glb.gz', museum)));
  const gltf = parseIslandMuseumModel(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
  await prepareIslandAquaticMotion(gltf, id);
  const {pieces, skin} = islandModelPieces(gltf), metadata = lock.animals[id];
  augmentIslandMediumRig(id, gltf, pieces, skin, metadata);
  const model = createIslandModelPose(gltf, skin);
  const [x,z] = calibration[id]?.forward ?? metadata.forward;
  const length = Math.hypot(x,z), fx = x / length, fz = z / length;
  const layer = model.play(mode === 'legs' ? 'Crawl' : 'Swim', {fade:0});
  model.update(0);
  const members = pieces.map(p => new Int8Array(p.primitive.attributes.POSITION.array.length/3).fill(-1));
  const vertices = [];
  for (const [i,p] of pieces.entries()) {
    visitAquaticSkin(p, model, ([x,y,z], index) => {
      let part = 0;
      const matcher = propulsionRows[mode];
      if (matcher) for (const weights of p.influences) {
        for (let k = index*4; k < index*4+4; k++) {
          if (weights.weights[k] && matcher.test(gltf.nodes[skin.joints[weights.joints[k]]].name)) part += weights.weights[k]/65535;
        }
      }
      vertices.push({i,index,f:x*fx+z*fz,l:x*fz-z*fx,y,limb:part>.55});
    });
  }
  const groups = regions(vertices, mode);
  for (const [g,region] of groups.entries()) for (const v of region) members[v.i][v.index] = g;
  const samples = [];
  for (let frame = 0; frame < count; frame++) {
    layer.time = frame/count * layer.clip.duration;
    model.update(0);
    const centers = groups.map(() => [0,0,0]);
    for (const [i,p] of pieces.entries()) {
      visitAquaticSkin(p, model, ([x,y,z], index) => {
        const k = members[i][index];
        if (k < 0) return;
        const center = centers[k];
        center[0] += (x*fx+z*fz);
        center[1] += y;
        center[2] += (x*fz-z*fx);
      });
    }
    for (const [g,center] of centers.entries()) for (let k=0;k<3;k++) center[k] /= groups[g].length;
    samples.push(centers);
  }
  if (check) await checkLaunch(id, model, layer);
  model.dispose();

  const pressure = samples.map((centers, i) => {
    const previous = samples[(i+count-1)%count], next = samples[(i+1)%count];
    // The visible shell's forward recoil identifies the brief jet. The
    // compliant crown moves after release; its return is not a second jet.
    if (mode === 'jet') return Math.max(0, next[0][0] - previous[0][0]);
    return centers.slice(1).reduce((sum, _, index) => {
      const step = next[index+1].map((v,k) => v - next[0][k] - (previous[index+1][k] - previous[0][k]));
      if (mode === 'tail') return sum + Math.abs(step[2]);
      if (mode === 'flukes') return sum + Math.abs(step[1]);
      if (mode === 'legs') return sum + Math.max(0, -step[0]);
      // Negative longitudinal travel is the blade sweeping aft. Both halves
      // of the vertical stroke can produce thrust for lift-based swimmers.
      return sum + Math.max(0, -step[0]) + Math.abs(step[1]) * .68;
    }, 0);
  });
  const maximum = Math.max(...pressure);
  if (!(maximum*metadata.scale > metadata.metres*.00001)) throw Error('Missing propulsive excursion for ' + id);
  const shape = pressure.map(force => Math.round(255 * force / maximum));
  const mean = shape.reduce((sum, v) => sum + v, 0) / shape.length;
  const result = {mode, mean, shape};
  console.log(id, mode, 'selected skin vertices', groups.slice(1).map(v => v.length).join('+'));
  return result;
}

const rows = {};
for (const site of ISLAND_FAUNA_PLAN.filter(v => ['marine','benthic','freshwater'].includes(v.medium))) rows[site.id] = await measure(site.id);
const path = new URL('aquatic-motion/strokes.json', museum);
const json = '{\n' + Object.entries(rows).map(([id, row]) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(row)).join(',\n') + '\n}\n';
if (check) {
  if (await readFile(path, 'utf8') !== json) throw Error('Stale aquatic propulsive phases');
} else await writeFile(path, json);
