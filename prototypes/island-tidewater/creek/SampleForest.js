import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';
import {trunkSection} from './ConiferGeometry.js';
export function sampleForestWeight(x,z){return 1-smooth(.68,1.17,Math.hypot((x+716)/92,(z+318)/205));}
export const sampleForestWGSL=`fn museumSampleForest(p:vec2f)->f32{return 1.0-smoothstep(.68,1.17,length((p-vec2f(-716.0,-318.0))/vec2f(92.0,205.0)));}`;

export function plantSampleForest(data,templates,records){
 const design=data.field.continuousSample;if(!design)return null;
 const t=data.terrain,rng=mulberry32(181026),items=[];
 const add=(x,z,H,variant,hero=false)=>{
  const f=data.field.sample(x,z),y=t.heightAt(x,z),grade=Math.hypot(t.heightAt(x+1,z)-t.heightAt(x-1,z),t.heightAt(x,z+1)-t.heightAt(x,z-1))/2;
  if(f[1]<2.5||y<f[0]+.25||grade>.65||items.some(r=>Math.hypot(r.x-x,r.z-z)<(variant===4?6:2.4)+(r.variant===4?5:1.3)))return false;
  const sy=.86+rng()*.27,s=H/(templates[variant].height*sy),seed=variant<2?rng():4+rng()*.999;
  const r={x,y:y-.08,z,s,sy,yaw:rng()*Math.PI*2,seed,variant,H,qr:variant===4?222:81,sample:true,landmark:hero};r.la=r.yaw;r.l=sy;items.push(r);return true;
 };
 add(-727,-325,51.2,4,true);add(-692,-437,44,4,true);
 for(let i=0;i<1800&&items.filter(r=>r.variant===4).length<52;i++){
  const x=-815+rng()*200,z=-522+rng()*410;if(rng()>sampleForestWeight(x,z))continue;add(x,z,34+rng()*20,4);
 }
 for(let i=0;i<2800&&items.filter(r=>r.variant<2).length<140;i++){
  const x=-815+rng()*200,z=-522+rng()*410;if(rng()>sampleForestWeight(x,z))continue;add(x,z,3.5+Math.pow(rng(),.7)*20,rng()<.7?0:1);
 }
 records.push(...items);design.forestRecords=items;
 return {mature:items.filter(r=>r.variant===4).length,young:items.filter(r=>r.variant<2).length,heroMeasurements:items.filter(r=>r.landmark).map(r=>({root:[r.x,r.y,r.z],height:r.H,DBH:trunkSection(templates[r.variant],r.s,r.sy),nominalCrownWidth:templates[r.variant].width*r.s})),crownMeasurement:'nominal template span, not the measured leaf/wood bounding box',identity:'fixed authored instances with the existing near/far native canopy pipeline',scientificStatus:'modern mixed-age forest scale analogy; no named fossil species'};
}
