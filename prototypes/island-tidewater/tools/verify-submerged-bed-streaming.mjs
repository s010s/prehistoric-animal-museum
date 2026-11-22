import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PerspectiveCamera, Scene, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {GPU} from '../vendor/tidewater/src/engine/gpu/GPU.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {BED_CELL, BED_CELL_CAPACITY, BED_RADIUS} from '../creek/FreshwaterBedPlan.js';
import {loadMarineRockProfiles} from '../creek/MarineRockProfiles.js';
import {MuseumColliders} from '../creek/MuseumColliders.js';
import {SubmergedBed} from '../creek/SubmergedBed.js';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';

globalThis.__assetFile = async url => {
  const bytes = await readFile(new URL(url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const marineRockProfiles = await loadMarineRockProfiles();
delete globalThis.__assetFile;
const data = await loadRuntimeTerrain();
const colliders = new MuseumColliders();
const sentinel = colliders.addBox(new Vector3(0, 100, 0), new Vector3(1, 1, 1));
const app = {scene: new Scene(), colliders, life: {marineRockProfiles},
  shelfReef: {material: {bindings: {reefNoise: {texture: new Texture({dimension: '3d'})}}}},
  terrainGPU: {module: new ShaderModule({name: 'streaming-test-bed'})}};
// Bed material construction caches Tidewater's shared detail texture.
const getTexture = Texture.prototype.getGPU;
Texture.prototype.getGPU = function () { this.mipsOption = false; return {}; };
GPU.encoder = {};
const bed = new SubmergedBed(app, data);
Texture.prototype.getGPU = getTexture;
GPU.encoder = null;
const cells = bed.cells;
const count = (BED_RADIUS * 2 + 1) ** 2;
const writes = [];
// Keep real planning, geometry, collision and indirect index packing. Replace
// only the device uploads so this lifecycle validator runs in Node.
bed.batch.instanceBuffer.write = (values, offset) => writes.push({values: values.slice(), offset});
for (const buffer of [bed.batch.listBuffer, bed.batch.baseBuffer, bed.batch.indirectBuffer]) buffer.write = () => {};

const camera = new PerspectiveCamera(62, 16 / 9);
const x0 = 10606.53, z0 = 5090.61, y0 = data.island.seaLevel - 1.3;
function put(x, y, z) {
  camera.position.set(x, y, z);
  camera.lookAt(new Vector3(x - 6.43, y - 1.8, z + 7.66));
}
function verifyResidents() {
  assert.equal(bed.cells, cells);
  assert.equal(bed.stats().residentCells, bed.cellSlots.size);
  assert.equal(bed.freeSlots.length + bed.cellSlots.size, count);
  assert.equal(new Set([...bed.freeSlots, ...bed.cellSlots.values()]).size, count);
  const records = [...cells].flatMap(([key, rows]) => {
    assert(rows.length <= BED_CELL_CAPACITY);
    const slot = bed.cellSlots.get(key);
    rows.forEach((row, i) => assert.equal(bed.sites[slot * BED_CELL_CAPACITY + i], row));
    return rows;
  });
  assert.equal(records.length, bed.stats().residentSites);
  assert.equal(bed.sites.filter(Boolean).length, records.length);
  assert.equal(colliders.boxes.length, records.filter(row => row.collision).length + 1);
  for (const rock of records.filter(row => row.collision)) {
    assert(colliders.boxes.includes(rock.collider));
    assert.equal(rock.collider.center.x, rock.collision.x);
    assert.equal(rock.collider.center.z, rock.collision.z);
    assert.equal(rock.collider.half.x, rock.collision.halfX);
    assert.equal(rock.collider.half.z, rock.collision.halfZ);
    assert.equal(rock.collider.rotY, rock.collision.yaw);
    assert(Math.abs(rock.collider.top - rock.collision.yMax) < 1e-9);
    assert(Math.abs(rock.collider.bottom - rock.collision.yMin) < 1e-9);
  }
  if (bed.mesh.visible) {
    for (const id of bed.batch.list.subarray(0, bed.batch.visibleInstances)) assert(bed.sites[id]);
  }
}
function finishWindow() {
  let ticks = 0;
  while (bed.stats().pendingCells && ticks++ < count) {
    const before = cells.size;
    bed.update(camera);
    assert(cells.size > before && cells.size <= before + 2, 'Stationary camera publishes a small tile batch');
    verifyResidents();
  }
  assert.equal(bed.stats().pendingCells, 0);
  assert.equal(cells.size, count);
  return ticks;
}

put(x0, y0, z0);
const middle = Math.floor(x0 / BED_CELL) + ',' + Math.floor(z0 / BED_CELL);
bed.update(camera);
assert.equal(cells.keys().next().value, middle, 'Load the camera cell first');
assert(cells.size > 0 && cells.size <= 2, 'Arrival never plans a whole window in one frame');
const stationaryTicks = finishWindow();
const originalCell = cells.get(middle);
const originalSlot = bed.cellSlots.get(middle);
const originalWrites = writes.length;
const originalRevision = bed.revision;
bed.update(camera);
assert.equal(bed.revision, originalRevision);
assert.equal(writes.length, originalWrites);
assert(bed.mesh.visible && bed.batch.visibleInstances > 0, 'The ordinary sea entry must submit bed instances');

const rock = [...cells.values()].flat().find(site => site.collision);
assert(rock, 'The ordinary southeast coast must contain a fitted solid rock');
const originalBox = rock.collider;
const {center, cos, sin, half, bottom} = originalBox;
// This swimming-size capsule starts just inside one of the vertical faces.
const swimmer = new Vector3(center.x + cos * half.x, bottom + .08, center.z - sin * half.x);
swimmer.y = Math.max(swimmer.y, data.terrain.heightAt(swimmer.x, swimmer.z) + .04);
const unblocked = swimmer.clone();
assert(colliders.resolveCapsule(swimmer, .3, .42, 0));
assert(swimmer.distanceTo(unblocked) >= .29, 'Rock does not repel a swimmer from its occupied volume');

put(x0 + BED_CELL, y0, z0);
const previousUploads = writes.length;
bed.update(camera);
assert.equal(cells.get(middle), originalCell, 'The overlapping tile remains resident');
assert.equal(bed.cellSlots.get(middle), originalSlot);
finishWindow();
assert(writes.slice(previousUploads).every(row => row.offset !== originalSlot * BED_CELL_CAPACITY * 64));

// Redirect before a pending window completes and regenerate the previous tile.
put(x0 + 11 * BED_CELL, y0, z0);
bed.update(camera);
put(x0, y0, z0);
bed.update(camera);
verifyResidents();
finishWindow();
assert.notEqual(cells.get(middle), originalCell);
assert.deepEqual(cells.get(middle).map(({collider, ...row}) => row),
  originalCell.map(({collider, ...row}) => row), 'Regenerated sites retain their world locations');
assert(!colliders.boxes.includes(originalBox), 'A previously unloaded rock cannot leave a collider');

for (let cycle = 0; cycle < 4; cycle++) {
  put(x0 + (cycle + 2) * 7 * BED_CELL, y0, z0);
  bed.update(camera);
  verifyResidents();
  put(x0, y0, z0);
  bed.update(camera);
  finishWindow();
}

put(x0, y0 + 100, z0);
bed.update(camera);
assert.equal(cells.size, 0);
assert.equal(bed.stats().pendingCells, 0);
assert.equal(bed.mesh.visible, false);
assert.deepEqual(colliders.boxes, [sentinel]);
assert.equal(colliders.resolveCapsule(unblocked, .3, .42, 0), false, 'An unloaded rock must stop blocking the native solver');
put(x0, y0, z0);
bed.update(camera);
assert(bed.stats().pendingCells > 0, 'Test disposing with a partly resident window');
bed.dispose();
bed.dispose();
bed.update(camera);
verifyResidents();
assert.deepEqual(colliders.boxes, [sentinel]);
assert.equal(app.scene.children.length, 0);
assert(writes.every(({values, offset}) => values.length <= 16 * BED_CELL_CAPACITY && offset % (64 * BED_CELL_CAPACITY) === 0));
console.log('Verified bounded streaming after stationary arrival in ' + stationaryTicks + ' follow-up updates, fixed GPU tile ranges, collision and repeated eviction/disposal.');
