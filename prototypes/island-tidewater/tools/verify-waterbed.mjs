// Exercise the shipped bed field at visitor entries, down the main river and
// in both deep basins. A wet anchor alone does not prove a shore dive works.
import assert from 'node:assert/strict';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';
import {BED_CELL, BED_CELL_CAPACITY, planFreshwaterBedCell} from '../creek/FreshwaterBedPlan.js';
import {freshwaterBedStops, freshwaterBedVisits} from '../creek/FreshwaterBedVisits.js';
import {nearMarineBed, planMarineBedCell} from '../creek/MarineBenthicTiles.js';
import {freshwaterRibbons} from '../creek/FreshwaterRibbons.js';

const data = await loadRuntimeTerrain();
const visits = freshwaterBedVisits(data);
const isPlant = s => s.kind === 'ribbon' || s.kind === 'streamleaf';
const bladeHeights = {};
for (const [kind, n] of [['ribbon', 0], ['streamleaf', 1]]) {
  const geometry = freshwaterRibbons(7903 + n, 0, n === 1);
  geometry.computeBoundingBox();
  bladeHeights[kind] = geometry.boundingBox.max.y;
}

function sitesAround(x, z, radius) {
  const sites = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
    const ix = Math.floor(x / BED_CELL) + a, iz = Math.floor(z / BED_CELL) + b;
    const cell = planFreshwaterBedCell(data, ix, iz);
    assert(cell.length <= BED_CELL_CAPACITY, 'Local records must fit the fixed GPU batch');
    for (const s of cell) {
      if (Math.hypot(s.x-x, s.z-z) > radius) continue;
      const [level, edge] = data.field.sample(s.x, s.z);
      assert(edge < 0 && level > data.island.seaLevel + .55);
      assert(Math.abs(s.y + .018 - data.terrain.heightAt(s.x, s.z)) < .001);
      if (isPlant(s)) assert(s.y + s.scale * bladeHeights[s.kind] < level, 'Submerged leaf emerged');
      sites.push(s);
    }
  }
  return sites;
}

for (const stop of freshwaterBedStops) {
  const v = visits[stop.id];
  assert(v && v.eyeBelowSurface > .35, stop.id + ' lost its underwater arrival');
  const [x,z] = v.p, dy = v.diveLevel - v.eyeBelowSurface - data.terrain.heightAt(x,z);
  assert(dy > .65 && dy < 1.7);
  const dx = v.gaze[0] - x, dz = v.gaze[2] - z, length = Math.hypot(dx,dz);
  const visible = sitesAround(x,z,15).filter(s => {
    const rx = s.x-x, rz = s.z-z;
    return (dx*rx + dz*rz)/length > .68*Math.hypot(rx,rz);
  });
  assert(visible.some(isPlant), stop.id + ' faces bare sediment');
  assert(visible.some(s => !isPlant(s)), stop.id + ' lost its bed deposits');
}
for (const [x,z] of data.island.lakes.map(lake => lake.center)) {
  const near = sitesAround(x,z,12);
  assert(near.length > 0, 'A natural deep basin should have visible bottom material');
  assert(!near.some(s => isPlant(s) && s.depth >= 6.4), 'Dense green growth spread into deep water');
}
const reach = data.field.riverAt(450);
assert(sitesAround(reach.x,450,22).some(s => !isPlant(s)));
assert.equal(sitesAround(-742,-153,18).length, 0, 'Original west sample was re-dressed');
assert.equal(sitesAround(-23,4,8).some(s => s.kind === 'ledge'), true, 'Original creek cut bank lost its bedding');
const from = [Math.floor(reach.x/BED_CELL),Math.floor(450/BED_CELL)];
const original = planFreshwaterBedCell(data,...from);
planFreshwaterBedCell(data,from[0]+40,from[1]-11);
assert.deepEqual(planFreshwaterBedCell(data,...from), original, 'Patches moved when a tile was revisited');
// Swim the open shelf beyond a named east-bay reef: both exposed sediment
// and populated cells should remain after leaving its authored composition.
const [bayX, bayZ] = data.cove.shelves[1].at(0,175);
let open = 0, covered = 0;
for (let dx = 5; dx < 20; dx++) for (let dz = -8; dz < 9; dz++) {
  const ix = Math.floor(bayX/BED_CELL) + dx, iz = Math.floor(bayZ/BED_CELL) + dz;
  const x = (ix+.5)*BED_CELL, z = (iz+.5)*BED_CELL;
  const floor = data.terrain.heightAt(x,z), depth = data.island.seaLevel - floor;
  if (depth < 1.6 || depth > 8.5 || !nearMarineBed(data,{x,y:floor+1.2,z})) continue;
  const sites = planMarineBedCell(data,ix,iz,new Map());
  if (sites.length) covered++;
  else open++;
  for (const site of sites) {
    const [surface,edge] = data.field.sample(site.x,site.z);
    assert(edge > .12 || surface <= data.island.seaLevel + .15);
    assert(site.depth >= 1.25 && site.depth <= 9.5 && site.mode === 3);
  }
}
assert(covered && open, 'Open shelf needs both colonised ground and sand corridors');
console.log('Verified four dives, both deep freshwater floors, river deposits, submerged foliage, free-swimming shelf and protected sample.');
