// Run with Node alone, or pass a live-scene JSON snapshot to include every
// registered trunk, visitor arrival, fixed ground detail and land patrol.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';
import {islandGroundAt, planIslandEcology} from '../creek/IslandEcologyPlan.js';
import {prepareLandHabitatField, protectedSampleLand, landContextAt} from '../creek/LandHabitatField.js';
import {LAND_CAPACITY, LAND_CELL, landCellColonies, RoamingLandCover} from '../creek/RoamingLandCover.js';
import {createIslandFaunaHabitats, faunaBodyPlacement} from '../creek/IslandFaunaHabitats.js';
import {makeRoute, routePoint} from '../creek/IslandFaunaRoute.js';
import {regionalLandformVisits} from '../creek/RegionalLandforms.js';
import {sampleVisits} from '../creek/SampleVisits.js';
import {freshwaterBedVisits} from '../creek/FreshwaterBedVisits.js';
import {smooth} from '../creek/ContinuousSample.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const data = await loadRuntimeTerrain();
const scene = process.argv[2] && JSON.parse(await readFile(process.argv[2], 'utf8'));
let visits, actors;
if (scene) {
  visits = Object.fromEntries(scene.visits.map(v => [v.id, v]));
  actors = scene.actors;
} else {
  const catalog = JSON.parse(await readFile(new URL('../museum/island-museum-models.lock.json', import.meta.url))).animals;
  const habitats = createIslandFaunaHabitats(data, catalog);
  visits = {...Object.fromEntries(data.geography.landmarks.map(v => [v.id, v])), ...regionalLandformVisits(data.terrain),
    ...sampleVisits(data), ...freshwaterBedVisits(data), ...habitats.visits};
  actors = [...Object.values(habitats.sites), ...habitats.population].filter(site => site.medium === 'ground')
    .map(site => ({site, body:faunaBodyPlacement(catalog[site.id])}));
}
const trunks = new Map();
for (const [x, z, radius] of scene?.trees ?? []) {
  const key = Math.floor(x/32) + ',' + Math.floor(z/32);
  if (!trunks.has(key)) trunks.set(key, []);
  trunks.get(key).push({x, z, radius, tag:'museum tree trunk'});
}
for (const actor of actors) actor.route = makeRoute(actor.site, actor.body);
prepareLandHabitatField(data, {islandVisits:visits, islandFauna:{individuals:actors}, colliders:{treeCells:trunks}});
const arrivals = Object.values(visits).map(({p}) => [p[0],p.at(-1)]);
const fixed = scene?.fixed ?? planIslandEcology(data, visits).sites.filter(s => s.mode === 0).map(s => [s.x,s.z]);
const nearest = (xz, x, z) => Math.sqrt(xz.reduce((best, [a,b]) => Math.min(best, (x-a)**2+(z-b)**2), Infinity));
let clearances = 0;
const checkClear = (x,z,why) => {
  assert.equal(landContextAt(data,x,z), null, why + ' at ' + [x,z]);
  clearances++;
};
for (const {p,gaze} of Object.values(visits)) {
  const x=p[0], z=p.at(-1);
  checkClear(x,z,'Visitor arrival');
  if (!gaze) continue;
  const dx=gaze[0]-x, dz=gaze[2]-z, length=Math.hypot(dx,dz);
  for (let d=8; d<Math.min(72,length); d+=8) checkClear(x+d*dx/length,z+d*dz/length,'Viewing corridor');
}
for (const {route} of actors) {
  for (let s=0; s<=route.length; s+=3) {
    const [x,,z]=routePoint(route,s);
    checkClear(x,z,'Patrol obstruction');
  }
}
const seed = 0x684abf12, rng = mulberry32(seed);
const biomes = ['meadow','woodland','wet-bank','shore','upland','dry-slope'];
const observers = new Map(biomes.map(b => [b,[]]));
const counts = Object.fromEntries(biomes.map(b => [b,0]));
const quota = 72, worldSamples=50000;
const maxGrade = Math.tan(42*Math.PI/180);
const waterOrSnow = g => g.y <= data.island.seaLevel+.14 || (g.edge<.05 && g.y<=data.field.sample(g.x,g.z)[0]+.12)
  || data.landforms.climate.snow.weight(g.x,g.z)*smooth(508,613,g.y+25*g.gz/Math.hypot(1,g.slope))>.26;
let eligibleGround=0;
const unclassifiedEyes=[];
function placeObserver(x,z, coast) {
  const local = landContextAt(data,x,z);
  // Count potential walking ground without trusting the placement field
  // to declare its own denominator. This also exposes newly empty areas.
  if (!coast && data.terrain.heightAt(x,z)>data.island.seaLevel+.14 && !protectedSampleLand(x,z)) {
    const g = local ?? islandGroundAt(data,x,z);
    if (g.trail<=.48 && g.slope<=maxGrade && !waterOrSnow(g) && nearest(arrivals,x,z)>=180) {
      eligibleGround++;
      if (!local) unclassifiedEyes.push({x,z,bearing:0});
    }
  }
  if (!local || local.slope>maxGrade) return;
  if (coast && local.biome!=='shore') return;
  if (!coast) counts[local.biome]++;
  const group=observers.get(local.biome);
  if (group.length>=quota) return;
  const arrival=nearest(arrivals,x,z);
  if (arrival<180) return;
  group.push({x,z,arrival,bearing:rng()*2*Math.PI});
}
for (let i=0; i<worldSamples; i++) placeObserver((rng()-.5)*data.island.size,(rng()-.5)*data.island.size,false);
// A sea-level contour is a narrow line. Give each metre of actual coast the
// same chance and sample across it, independent of any named dive station.
const coastSegments = data.cove.continuous.segments;
let coastLength = 0;
const ends = coastSegments.map(s => coastLength+=s.length);
let coastDraws = 0;
while (observers.get('shore').length<quota && coastDraws++<25000) {
  const along=rng()*coastLength;
  let lo=0, hi=ends.length-1;
  while (lo<hi) {const mid=(lo+hi)>>>1; if (ends[mid]<along) lo=mid+1; else hi=mid;}
  const s=coastSegments[lo], [nx,nz]=s.normal, d=rng()*60-30;
  const tangent=along-(ends[lo]-.5*s.length);
  placeObserver(s.point[0]+nx*d-nz*tangent,s.point[1]+nz*d+nx*tangent,true);
}

function median(a) {return quantile(a,.5);}
function quantile(a,f) {return [...a].sort((x,y)=>x-y)[Math.floor(f*(a.length-1))];}
const pct=(seen,total)=>Math.round(1000*seen/total)/10;
const results=[];
let rootsChecked=0, uphillBlocked=0;
for (const [index,tree] of (scene?.trees??[]).entries()) {
  if (index%71===0) checkClear(tree[0],tree[1],'Root through a registered trunk');
}
// Classify the view independently of where cover exists. An empty waterward
// view from a strand is expected; an empty view inland has a different cause.
function coastalView(p) {
  let water=0;
  for (const distance of [15,30]) for (const offset of [-.6,-.3,0,.3,.6]) {
    const x=p.x+Math.cos(p.bearing+offset)*distance, z=p.z+Math.sin(p.bearing+offset)*distance;
    if (data.terrain.heightAt(x,z)<=data.island.seaLevel+.1) water++;
  }
  return water>=7 ? 'waterward' : water<=3 ? 'landward' : 'alongshore';
}
function inSight(eye,site,distance) {
  const top=site.y+.22*site.scale;
  for (let d=3; d<distance; d+=3) {
    const u=d/distance;
    if (data.terrain.heightAt(eye.x+(site.x-eye.x)*u,eye.z+(site.z-eye.z)*u)>eye.y+(top-eye.y)*u) return false;
  }
  return true;
}
function survey(p, auditRoots=true) {
  const eye = {...p,y:data.terrain.heightAt(p.x,p.z)+1.62};
  const forms=new Set();
  const individualCounts=[];
  const centers=[];
  let n30=0, n40=0, groups=0, forward=0;
  // Include colonies whose centre is outside the circle and members spill in.
  const margin=40+LAND_CELL/2;
  for (let j=Math.floor((p.z-margin)/LAND_CELL); j<=Math.floor((p.z+margin)/LAND_CELL); j++) {
    for (let i=Math.floor((p.x-margin)/LAND_CELL); i<=Math.floor((p.x+margin)/LAND_CELL); i++) {
      for (const members of landCellColonies(data,i,j)) {
        let counted=false;
        for (const q of members) {
          const dx=q.x-p.x, dz=q.z-p.z, d=Math.hypot(dx,dz,eye.y-q.y);
          if (d>40) continue;
          // Woody litter has the shortest runtime reach; it disappears
          // before the edge of our circle. All other native forms reach 40m.
          if (q.form==='duff' && d>34) continue;
          if (auditRoots) {
            const g=islandGroundAt(data,q.x,q.z);
            assert(!protectedSampleLand(q.x,q.z) && !waterOrSnow(g) && g.trail<=.48, 'Root in the sample, path, water or snow');
            assert(Math.abs(g.y-q.y)<.05, 'Floating or buried ground detail');
            rootsChecked++;
          }
          counted=true;
          n40++;
          if (d<=30) n30++;
          forms.add(q.form);
          // 90° horizontal field, retain only lines of sight above actual ground.
          if (dx*Math.cos(p.bearing)+dz*Math.sin(p.bearing)>.7071*Math.hypot(dx,dz)) {
            if (inSight(eye,q,Math.hypot(dx,dz))) forward++;
            else uphillBlocked++;
          }
        }
        if (counted) {
          groups++; individualCounts.push(members.length);
          centers.push([members[0].x,members[0].z]);
        }
      }
    }
  }
  const gaps=centers.length>1 ? centers.map((c,i)=>nearest(centers.filter((_,j)=>j!==i),...c)) : [];
  return {n30,n40,groups,forward,forms,individualCounts,gaps};
}
for (const [biome,points] of observers) {
  assert(points.length>=48,'Not enough independent '+biome+' samples');
  const frames=points.map(p=>({...survey(p),fixed:nearest(fixed,p.x,p.z),view:biome==='shore' && coastalView(p)}));
  const count=frames.length, num=prop=>frames.filter(s=>s[prop]>0).length;
  const mergedForms=new Set(frames.flatMap(s=>[...s.forms]));
  results.push({biome,count,worldHits:counts[biome],hit30:pct(num('n30'),count),hit40:pct(num('n40'),count),
    forward40:pct(num('forward'),count),groups40:median(frames.map(s=>s.groups)),membersPerGroup:median(frames.flatMap(s=>s.individualCounts)),
    forms:mergedForms.size,formsAtEye:median(frames.map(s=>s.forms.size)),sites40:median(frames.map(s=>s.n40)),
    sitesP10:quantile(frames.map(s=>s.n40),.1),sitesP90:quantile(frames.map(s=>s.n40),.9),
    medianGroupGapM:Math.round(median(frames.flatMap(s=>s.gaps))*10)/10,
    fixedWithin40:pct(frames.filter(s=>s.fixed<=40).length,count),medianFixedMetres:Math.round(median(frames.map(s=>s.fixed))),
    medianArrivalMetres:Math.round(median(points.map(p=>p.arrival)))});
  assert(num('n40')>count*.80,'Most walkers cannot find nearby '+biome+' ground detail');
  assert(mergedForms.size>=2,'Only one form across the whole '+biome+' sample');
  if (biome==='shore') console.table(['waterward','alongshore','landward'].map(view=>{
    const section=frames.filter(f=>f.view===view);
    return {view,count:section.length,forward40:pct(section.filter(f=>f.forward).length,section.length)};
  }));
}
const fringes=unclassifiedEyes.map(p=>survey(p,false));
const openGround=unclassifiedEyes.flatMap((p,i)=>{
  if (fringes[i].n40) return [];
  const g=islandGroundAt(data,p.x,p.z);
  return [{x:Math.round(p.x),z:Math.round(p.z),grade:+g.slope.toFixed(2),
    heightAboveWaterLevel:+g.height.toFixed(2),channelEdge:+g.edge.toFixed(1)}];
});
// Probe both sides of the western sample edges as well as the interior.
for (let z=-670; z<=348; z+=19) for (let x=-1535; x<-481; x+=23) {
  if (protectedSampleLand(x,z)) checkClear(x,z,'Authored creek or estuary');
}
let ocean=0, lake=0, snow=0, trail=0;
for (let n=0; n<18000; n++) {
  const x=(rng()-.5)*data.island.size, z=(rng()-.5)*data.island.size;
  const g=islandGroundAt(data,x,z);
  if (g.y<data.island.seaLevel-.1) {ocean++; checkClear(x,z,'Ocean');}
  else if (g.edge<0 && g.y<data.field.sample(x,z)[0]) {lake++; checkClear(x,z,'Inland water');}
  else if (waterOrSnow(g) && g.y>500) {snow++; checkClear(x,z,'Snow');}
}
// Narrow walking paths have a tiny area relative to the island. Inspect
// every marked dry mask pixel, independently of how many random rays hit.
for (let k=0; k<data.islandMasks.length/4; k++) {
  if (data.islandMasks[k*4]<=.48*255) continue;
  const {maskRes,size}=data.island;
  const x=((k%maskRes+.5)/maskRes-.5)*size, z=((Math.floor(k/maskRes)+.5)/maskRes-.5)*size;
  if (data.terrain.heightAt(x,z)>data.island.seaLevel) {trail++; checkClear(x,z,'Trail');}
}
assert(ocean && lake && snow && trail,'Missing geography in exclusion check');
// Walk at regular foot-travel intervals. A route ends when actual slope,
// inundation or a protected area prevents continuing in the chosen heading.
const walks=[];
for (const [biome,points] of observers) {
  const frames=[];
  for (const origin of points.slice(0,6)) {
    for (let d=0; d<=100; d+=2) {
      const x=origin.x+Math.cos(origin.bearing)*d, z=origin.z+Math.sin(origin.bearing)*d;
      const g=islandGroundAt(data,x,z);
      if (waterOrSnow(g) || g.slope>maxGrade || !landContextAt(data,x,z)) break;
      if (d%10===0) frames.push(survey({x,z,bearing:origin.bearing},false));
    }
  }
  walks.push({biome,eyes:frames.length,hit40:pct(frames.filter(f=>f.n40).length,frames.length),
    forward40:pct(frames.filter(f=>f.forward).length,frames.length)});
}
const cache=new RoamingLandCover(data,()=>{});
let maxSites=0, maxCells=0;
function settle(p) {
  const eye={...p,y:data.terrain.heightAt(p.x,p.z)+1.62};
  let steps=0;
  do {
    cache.update(eye);
    const {residentCells,sites,capacity}=cache.stats();
    maxSites=Math.max(sites,maxSites); maxCells=Math.max(residentCells,maxCells);
    assert(residentCells<=25 && sites<=capacity && capacity===LAND_CAPACITY,'Growing resident cover while travelling');
    assert(++steps<1000,'Ground generation never settled');
  } while (cache.stats().pendingCells);
  const occupied=new Set(), rooted=[];
  cache.visit((p,slot)=>{
    assert(slot>=0 && slot<LAND_CAPACITY && !occupied.has(slot),'Invalid or aliased resident instance slot');
    occupied.add(slot); rooted.push(JSON.stringify(p));
  });
  assert.equal(new Set(rooted).size,rooted.length,'Duplicate ground transforms');
  return rooted.sort();
}
const all=[...observers.values()].flat();
const start=all.find(p=>p.x<0 && p.z<0);
assert(start,'Coverage did not enter the negative quadrant');
const first=settle(start);
assert(first.length,'Empty first resident window');
const others=all.filter(p=>Math.hypot(start.x-p.x,start.z-p.z)>LAND_CELL*12);
for (const p of others.filter((_,i)=>i%12===0)) settle(p);
assert.deepEqual(settle(start),first,'Returning after eviction changed the landscape');
cache.update({...start,y:data.terrain.heightAt(start.x,start.z)+200});
assert.equal(cache.stats().residentCells,0,'High flight retained the close land layer');
assert.equal(cache.stats().sites,0);
console.table(results);
console.table(walks);
console.log({seed,worldSamples,coastDraws,registeredTrees:scene?.trees.length??0,arrivals:arrivals.length,
  fixedGround:fixed.length,landPatrols:actors.length,rootsChecked,clearances,ocean,lake,snow,trail,uphillBlocked,
  eligibleGround,unclassifiedGround:fringes.length,
  unclassifiedWithCover30:fringes.filter(f=>f.n30).length,unclassifiedWithCover40:fringes.filter(f=>f.n40).length,
  openGround,
  highWaterCells:maxCells,highWaterSites:maxSites,capacity:LAND_CAPACITY});
