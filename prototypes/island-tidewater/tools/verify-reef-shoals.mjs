// Follow living schools at ordinary coast entries, including their body clearance
// and tail-driven progress through a turn around a streamed ledge.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';
import {IslandLife} from '../creek/IslandLife.js';
import {RoamingShoals} from '../creek/RoamingShoals.js';
import {reefObstacleTop} from '../creek/ReefShoals.js';
import {REVIEWED_SWIM_RIGS,advanceReviewedSwimPose} from '../creek/VaultReviewedSwimMotion.js';
import {BED_CELL,BED_CELL_CAPACITY} from '../creek/FreshwaterBedPlan.js';
import {loadMarineRockProfiles} from '../creek/MarineRockProfiles.js';
import {marineOutcropKinds} from '../creek/MarineOutcrops.js';
import {planMarineBedCell} from '../creek/MarineBenthicTiles.js';

const data=await loadRuntimeTerrain(), sea=data.island.seaLevel;
globalThis.__assetFile=async path=>{const b=await readFile(new URL(path));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const kinds=marineOutcropKinds(await loadMarineRockProfiles());
delete globalThis.__assetFile;
const swimmers=Object.fromEntries(Object.keys(REVIEWED_SWIM_RIGS).map(k=>[k,{fixedCount:12}]));
const breakDepth=()=>1.45;
const life={terrain:data.terrain,reefTarget:new Vector3(),breakDepth,audit:{obstacleDeflections:0,maxPanic:0}};
for (const [id,x,z] of [['northwest',-161,-5974],['east',9644,-1655],['south',3786,7985]]) {
  const eye=new Vector3(x,sea-1,z), bed={cells:new Map(),revision:0};
  const shoals=new RoamingShoals(data,[],breakDepth,[]);
  shoals.scan(eye,swimmers,bed);
  for (let dz=-2;dz<=2;dz++) for (let dx=-2;dx<=2;dx++) {
    const i=Math.floor(x/BED_CELL)+dx,j=Math.floor(z/BED_CELL)+dz;
    bed.cells.set(i+','+j,planMarineBedCell(data,i,j,new Map(),BED_CELL_CAPACITY,kinds));
  }
  bed.revision++;
  assert(shoals.scan(eye,swimmers,bed),'New reef must be found while visitor is stationary');
  const reefs=shoals.groups.filter(g=>g.water==='reef');
  assert(reefs.length>0,id+' missing fish beside reef');
  const used=new Set();
  let travelled=0,members=0,smallest=Infinity;
  for (const group of reefs) {
    assert(group.count>=7 && group.reefObstacles.some(r=>r.reefId===group.reefId));
    const swimming=new Map(group.members.map(f=>[f,0]));
    for(const f of group.members) {
      assert(!used.has(f.renderIndex),'Distinct residents must not overwrite a bone palette');
      used.add(f.renderIndex);
    }
    for(let tick=0;tick<540;tick++) {
      life.time=tick/30;
      for (const f of group.members) {
        const px=f.p.x,pz=f.p.z,awake=!f.sleeping;
        IslandLife.prototype.advance.call(life,f,1/30,eye);
        if(f.sleeping) continue;
        advanceReviewedSwimPose(f,1/30);
        if (awake) {
          const dx=f.p.x-px,dz=f.p.z-pz;
          assert(dx*Math.sin(f.yaw)+dz*Math.cos(f.yaw)>-.001,'Tail-first translation at '+id);
          swimming.set(f,swimming.get(f)+Math.hypot(dx,dz));
        }
        const floor=Math.max(data.terrain.heightAt(f.p.x,f.p.z),reefObstacleTop(group.reefObstacles,f.p.x,f.p.z,f.L*.48));
        smallest=Math.min(smallest,f.p.y-floor);
        assert(f.p.y>=floor+.139 && f.p.y<=sea-.849,'Fish body intersects bed/rock or wave margin');
      }
    }
    assert([...swimming.values()].every(length=>length>.4),id+' has a fish pinned against its reef');
    travelled+=[...swimming.values()].reduce((a,b)=>a+b,0);members+=group.count;
  }
  console.log(id,reefs.length+' schools',members+' fish', (travelled/members).toFixed(2)+' m average travel in 18s',smallest.toFixed(2)+' m minimum centre clearance');
}
