// Deterministic stand design on the actual shared terrain. No camera seeding.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {GROVE,groveWeight,grovePathDistance,groveOpening,grovePatch} from './GroveDesign.js';

export function locateGroveHeroes(data){
 const t=data.terrain,f=data.field;
 return GROVE.heroes.map(h=>{
  if(!h.search)return {...h};let best=null;
  for(let j=-32;j<=32;j+=4)for(let i=-32;i<=32;i+=4){
   const x=h.x+i,z=h.z+j,y=t.heightAt(x,z);if(grovePathDistance(x,z)<9||f.sample(x,z)[1]<8)continue;
   let variation=0;for(let a=0;a<8;a++)variation=Math.max(variation,Math.abs(t.heightAt(x+Math.cos(a*Math.PI/4)*6,z+Math.sin(a*Math.PI/4)*6)-y));
   if(variation>2.4)continue;const score=Math.hypot(i,j)+variation*12;
   if(!best||score<best.score)best={...h,x,z,score,rootTerrainVariation:variation};
  }
  if(!best)throw Error('No safe giant root site near '+h.x+','+h.z);return best;
 });
}

export function fillGroveStand(data,records,templates,heroes){
 const t=data.terrain,f=data.field,rng=mulberry32(1710263),cells=new Map(),cell=32,key=(x,z)=>Math.floor(x/cell)+','+Math.floor(z/cell);
 const mature=records.filter(r=>r.variant===4),addIndex=r=>{const k=key(r.x,r.z);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(r);};mature.forEach(addIndex);
 const clear=(x,z,min)=>{const ix=Math.floor(x/cell),iz=Math.floor(z/cell);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)for(const r of cells.get((ix+i)+','+(iz+j))??[])if(Math.hypot(x-r.x,z-r.z)<min)return false;return true;};
 const ground=(x,z)=>{const y=t.heightAt(x,z),s=Math.hypot(t.heightAt(x+2,z)-t.heightAt(x-2,z),t.heightAt(x,z+2)-t.heightAt(x,z-2))/4;return {y,s,dry:f.sample(x,z)[1]>4};};
 let addedMature=0,addedYoung=0,attempts=0;
 for(;attempts<22000&&mature.length<GROVE.matureTarget;attempts++){
  const a=rng()*Math.PI*2,d=Math.sqrt(rng())*GROVE.outer,x=GROVE.center[0]+Math.cos(a)*d,z=GROVE.center[1]+Math.sin(a)*d/GROVE.zScale,w=groveWeight(x,z);
  if(w<.18||rng()>w*.86||grovePathDistance(x,z)<6.5||groveOpening(x,z)>.5||!clear(x,z,23+rng()*5))continue;
  const g=ground(x,z);if(!g.dry||g.s>.48)continue;
  const H=58+rng()*20,sy=.96+rng()*.10,s=H/(templates[4].height*sy),yaw=rng()*6.283,seed=4+rng()*.999;
  const r={x,z,y:g.y-.08,s,sy,yaw,la:yaw,l:sy,H,seed,variant:4,qr:GROVE.near+GROVE.margin,cohort:'mature infill'};records.push(r);mature.push(r);addIndex(r);addedMature++;
 }
 for(let i=0;i<5000&&addedYoung<650;i++){
  const a=rng()*6.283,d=Math.sqrt(rng())*GROVE.inner*1.18,x=GROVE.center[0]+Math.cos(a)*d,z=GROVE.center[1]+Math.sin(a)*d/GROVE.zScale;
  if(groveWeight(x,z)<.5||grovePathDistance(x,z)<4.0||groveOpening(x,z)>.7||!clear(x,z,5.5)||rng()>grovePatch(x,z))continue;
  const g=ground(x,z);if(!g.dry||g.s>.55)continue;const variant=rng()<.6?0:1,H=6+rng()*17,sy=.92+rng()*.16,s=H/(templates[variant].height*sy),yaw=rng()*6.283,seed=variant===0?rng()*.49:.5+rng()*.49;
  records.push({x,z,y:g.y-.08,s,sy,yaw,la:yaw,l:sy,H,seed,variant,qr:81,cohort:'regeneration'});addedYoung++;
 }
 // Circular crown footprints describe spatial layering only: not alpha-leaf
 // coverage, botanical abundance, or fossil stand density measurements.
 let samples=0,covered=0;
 for(let z=GROVE.center[1]-GROVE.inner/GROVE.zScale;z<=GROVE.center[1]+GROVE.inner/GROVE.zScale;z+=24)for(let x=GROVE.center[0]-GROVE.inner;x<=GROVE.center[0]+GROVE.inner;x+=24){
  if(groveWeight(x,z)<.98||groveOpening(x,z)>.6)continue;samples++;
  const ix=Math.floor(x/cell),iz=Math.floor(z/cell);let hit=false;
  for(let j=-1;j<=1&&!hit;j++)for(let i=-1;i<=1&&!hit;i++)for(const r of cells.get((ix+i)+','+(iz+j))??[])if(Math.hypot(x-r.x,z-r.z)<templates[4].width*r.s*.46){hit=true;break;}
  if(hit)covered++;
 }
 return {addedMature,addedYoung,attempts,mature:mature.length,nominalFootprintKm2:Math.PI*GROVE.outer**2/GROVE.zScale/1e6,fullWeightCoreKm2:Math.PI*GROVE.inner**2/GROVE.zScale/1e6,crownFootprintProxy:covered/Math.max(1,samples),crownSamples:samples,method:'world-fixed stochastic infill, shared water/slope checks, mature spacing 23–28m, regeneration cohorts; circular crown footprint proxy',scientificStatus:GROVE.scientificStatus,heroRoots:heroes.map(h=>[h.x,h.z])};
}
