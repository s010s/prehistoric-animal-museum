// Exercise the shipped bed field at visitor entries, down the main river and
// in both deep basins. A wet anchor alone does not prove a shore dive works.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';
import {BED_CELL, BED_CELL_CAPACITY, planFreshwaterBedCell} from '../creek/FreshwaterBedPlan.js';
import {freshwaterBedStops, freshwaterBedVisits} from '../creek/FreshwaterBedVisits.js';
import {nearMarineBed, planMarineBedCell, roamingReefRocks} from '../creek/MarineBenthicTiles.js';
import {freshwaterRibbons} from '../creek/FreshwaterRibbons.js';
import {loadMarineRockProfiles, rockSurface} from '../creek/MarineRockProfiles.js';
import {marineOutcropKinds} from '../creek/MarineOutcrops.js';
import {mainEstuaryWeight} from '../creek/MainEstuary.js';

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
globalThis.__assetFile = async url => {
  const bytes = await readFile(new URL(url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const outcropKinds = marineOutcropKinds(await loadMarineRockProfiles());
delete globalThis.__assetFile;
const marineCell = (ix,iz) => planMarineBedCell(data,ix,iz,new Map(),BED_CELL_CAPACITY,outcropKinds);

// Swim the open shelf beyond a named east-bay reef: both exposed sediment
// and populated cells should remain after leaving its authored composition.
const [bayX, bayZ] = data.cove.shelves[1].at(0,175);
let open = 0, exposed = 0;
for (let dx = 5; dx < 20; dx++) for (let dz = -8; dz < 9; dz++) {
  const ix = Math.floor(bayX/BED_CELL) + dx, iz = Math.floor(bayZ/BED_CELL) + dz;
  const x = (ix+.5)*BED_CELL, z = (iz+.5)*BED_CELL;
  const floor = data.terrain.heightAt(x,z), depth = data.island.seaLevel - floor;
  if (depth < 1.6 || depth > 8.5 || !nearMarineBed(data,{x,y:floor+1.2,z})) continue;
  const sites = marineCell(ix,iz);
  if (sites.some(s => s.q)) exposed++;
  if (!sites.length) open++;
  for (const site of sites) {
    const [surface,edge] = data.field.sample(site.x,site.z);
    assert(edge > .12 || surface <= data.island.seaLevel + .15);
    assert(site.depth >= (site.fixed ? .95 : 1.25) && site.depth <= 9.5 && site.mode === 3);
  }
}
assert(exposed && open, 'Open shelf needs both colonised ground and sand corridors');

function marineWindow(x, z) {
  const sites = [];
  for (let dz=-2;dz<=2;dz++) for (let dx=-2;dx<=2;dx++) {
    const cell = marineCell(Math.floor(x/BED_CELL)+dx,Math.floor(z/BED_CELL)+dz);
    assert(cell.length <= BED_CELL_CAPACITY);
    sites.push(...cell);
  }
  return sites;
}

for (const [x,z] of [[-965,152],[-650,3689]]) {
  assert(!marineWindow(x,z).some(s => s.fixed), 'New hard ground entered an authored mouth');
}

// Audit the outer feather separately. An attachment or a long stone may cross
// the cut-off even when its anchor point is outside the protected beach.
let nearMouth = 0;
for (let iz=184;iz<268;iz++) for (let ix=-80;ix<17;ix++) {
  const x=(ix+.5)*BED_CELL, z=(iz+.5)*BED_CELL;
  const mask = [[-20,-20],[-20,20],[20,-20],[20,20],[0,0]].map(([dx,dz])=>mainEstuaryWeight(x+dx,z+dz));
  if (Math.min(...mask)>=.02 || Math.max(...mask)<=.02) continue;
  for (const s of marineCell(ix,iz)) {
    if (!s.reefId) continue;
    const radius = s.coverRadius ?? s.radius;
    assert(mainEstuaryWeight(s.x,s.z)<=.02, 'Reef anchor entered the main mouth');
    for (let j=0;j<32;j++) {
      const a=j*Math.PI/16;
      assert(mainEstuaryWeight(s.x+Math.cos(a)*radius,s.z+Math.sin(a)*radius)<=.02, 'Reef footprint entered the main mouth');
    }
    nearMouth++;
  }
}
assert(nearMouth>0, 'Audit did not reach the adjacent ordinary reef');

// An ordinary southeast dive has staggered outcrops, including a distinct
// near ledge, and swimming room at the visitor's actual eye position.
const x = 10606.53, z = 5090.61, sea = data.island.seaLevel;
const shelf = marineWindow(x,z), stones = shelf.filter(s => s.q);
assert.equal(new Set(stones.map(s=>s.rockId)).size, stones.length, 'Reef rock identities must be distinct');
assert.deepEqual(marineWindow(x,z).filter(s=>s.q).map(s=>s.rockId), stones.map(s=>s.rockId), 'Recycling a cell moved its reefs');
const indexed=new Map();
for (const s of shelf) {
  const key=`${Math.floor(s.x/BED_CELL)},${Math.floor(s.z/BED_CELL)}`;
  if (!indexed.has(key)) indexed.set(key,[]);
  indexed.get(key).push(s);
}
const nearby=roamingReefRocks(indexed,x,z,19);
assert(nearby.some(s=>s.reefRole==='crest') && nearby.some(s=>s.reefRole==='bench'), 'A shallow reef needs both relief and low shelves');
assert.deepEqual(new Set(nearby),new Set(stones.filter(s=>Math.hypot(s.x-x,s.z-z)<=19+s.footRadius)), 'Nearby query missed a physical reef rock');
assert(stones.some(s=>s.collision && s.top-s.floor>.9), 'Tall outcrops lost their swim collision');
const sight = stones.filter(s => {
  const dx=s.x-x, dz=s.z-z, distance=Math.hypot(dx,dz);
  return -.643*dx+.766*dz>.68*distance;
});
for (const [near,far] of [[4,10],[10,20],[20,31]]) {
  assert(sight.some(s => {
    const distance=Math.hypot(s.x-x,s.z-z);
    return distance>near && distance<far && s.top-s.floor>.22;
  }), 'Ordinary dive lost a depth cue');
}
assert(stones.every(s => Math.hypot(s.x-x,s.z-z)>s.radius+1.5));

const v = new Vector3(), surfaces = new Map();
for (const s of stones) {
  const geometry=outcropKinds.get(s.kind)[0].geometry, p=geometry.attributes.position;
  const pos=[];
  let lowest=Infinity;
  for (let i=0;i<p.count;i++) {
    v.set(p.getX(i),p.getY(i),p.getZ(i)).multiplyScalar(s.scale).applyQuaternion(s.q);
    v.x+=s.x;v.y+=s.y;v.z+=s.z;
    lowest=Math.min(lowest,v.y-data.terrain.heightAt(v.x,v.z));
    pos.push(v.x,v.y,v.z);
  }
  assert(lowest<-.04 && s.top<sea-.95, 'Outcrop must meet the floor and stay underwater');
  const host={pos,idx:geometry.index.array};
  surfaces.set(s.rockId,host);
  const box=s.collision;
  if (!box) continue;
  const c=Math.cos(box.yaw), n=Math.sin(box.yaw);
  assert(box.yMin<s.floor && box.yMax>box.yMin);
  for (let u=-1;u<=1;u++) for (let v=-1;v<=1;v++) {
    const px=box.x+u*box.halfX*c+v*box.halfZ*n, pz=box.z-u*box.halfX*n+v*box.halfZ*c;
    const hit=rockSurface(host,px,pz);
    assert(hit && hit.y>box.yMax, 'Collision roof entered open swimming space');
  }
}
const benthos = shelf.filter(s => s.hostX!==undefined);
for (const kind of ['holdfast','wrack','shell','colony','fingers']) assert(benthos.some(s => s.kind===kind));
assert(shelf.some(s => s.kind==='reef-rubble'), 'The outcrops lost their sediment apron');
for (const s of benthos) {
  const host=surfaces.get(s.hostRockId), hit=rockSurface(host,s.x,s.z);
  assert(hit && hit.y-s.y>.005 && hit.y-s.y<.032, 'Settler lost contact with the scanned rock');
  assert(hit.y>data.terrain.heightAt(s.x,s.z)+.055, 'Settler was buried by the seabed');
}
console.log('Verified four dives, both deep freshwater floors, river deposits, submerged foliage, grouped shelf outcrops and their settlers, sand corridors and both protected mouths.');
