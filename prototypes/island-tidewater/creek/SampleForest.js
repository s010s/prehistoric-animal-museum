import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';
import {trunkSection} from './ConiferGeometry.js';
export function sampleForestWeight(x,z){return 1-smooth(.68,1.17,Math.hypot((x+716)/92,(z+318)/205));}
export const sampleForestWGSL=`fn museumSampleForest(p:vec2f)->f32{return 1.0-smoothstep(.68,1.17,length((p-vec2f(-716.0,-318.0))/vec2f(92.0,205.0)));}`;

export function plantSampleForest(data,templates,records){
 const design=data.field.continuousSample;if(!design)return null;
 const t=data.terrain,rng=mulberry32(181026),items=[];
 const coastalNeighbours=records.filter(r=>r.x>-930&&r.x<-625&&r.z>-160&&r.z<220);
 const diagnostics=[];let activeDiagnostic=null;
 const add=(x,z,H,variant,hero=false,zone=null)=>{
  const f=data.field.sample(x,z),y=t.heightAt(x,z),grade=Math.hypot(t.heightAt(x+1,z)-t.heightAt(x-1,z),t.heightAt(x,z+1)-t.heightAt(x,z-1))/2;
  const coastal=zone!==null;
  // Use the higher grassed slope for the body of the wood. A few shorter
  // trees reach its edge, but their roots remain above the mobile beach.
  const minWaterDistance=Math.max(zone==='stand'?25:18,H*.9),minElevation=Math.max(f[0]+(zone==='stand'?4.2:3),zone==='stand'?8.2:7);
  const separation=r=>coastal||r.coastal?(variant===4?11.5:H>15?6.2:4.6)+(r.variant===4?7:r.H>15?2.6:1):(variant===4?6:2.4)+(r.variant===4?5:1.3);
  const reject=reason=>{if(activeDiagnostic)activeDiagnostic[reason]++;return false;};
  if(f[1]<2.5)return reject('waterEdge');
  if(y<f[0]+.25)return reject('submerged');
  if(coastal&&f[1]<minWaterDistance)return reject('waterDistance');
  if(coastal&&y<minElevation)return reject('elevation');
  // The restored headland has a steep green flank between the low sand and
  // the flatter upland. Trees on its planted belt can root on that flank;
  // water and elevation gates still keep them off the mobile beach.
  if(grade>(zone==='stand'?(variant===4?.35:1.1):.65))return reject('slope');
  if(items.some(r=>Math.hypot(r.x-x,r.z-z)<separation(r)))return reject('newTreeSpacing');
  if(coastal&&coastalNeighbours.some(r=>Math.hypot(r.x-x,r.z-z)<(r.H>25?11:7)+(variant===4?8:3)))return reject('existingTreeSpacing');
  const sy=.86+rng()*.27,s=H/(templates[variant].height*sy),seed=variant===0?rng()*.49:variant===1?.5+rng()*.49:variant+rng()*.999;
  // On a flank the downhill half of the real trunk flare can otherwise hang
  // above the terrain sampled at the stem centre. Seat that flare using its
  // measured basal radius; keep the burial under 55 cm and put giants only
  // on gentle ground where their much wider buttresses can be supported.
  const foot=coastal?trunkSection(templates[variant],s,sy,.12):null;
  const rootRadius=foot?Math.max(foot.diameterX,foot.diameterZ)*.5:0;
  const rootSink=coastal?Math.max(.08,Math.min(.55,grade*rootRadius+.035)):.08;
  // Keep tall coastal crowns and a scattered share of saplings in the fixed
  // shadow pass. Their remaining neighbours still fill the colour canopy,
  // without multiplying 3D shadow geometry across every cascade.
  const shadowHash=Math.sin(x*12.9898+z*78.233)*43758.5453;
  const castsFixedShadow=!coastal||H>=17||shadowHash-Math.floor(shadowHash)<.4;
  const r={x,y:y-rootSink,z,s,sy,yaw:rng()*Math.PI*2,seed,variant,H,qr:variant===4?222:81,sample:true,coastal,forestZone:zone,castsFixedShadow,rootSink,landmark:hero};r.la=r.yaw;r.l=sy;items.push(r);if(activeDiagnostic)activeDiagnostic.accepted++;return true;
 };
 add(-727,-325,51.2,4,true);add(-692,-437,44,4,true);
 for(let i=0;i<1800&&items.filter(r=>r.variant===4).length<52;i++){
  const x=-815+rng()*200,z=-522+rng()*410;if(rng()>sampleForestWeight(x,z))continue;add(x,z,34+rng()*20,4);
 }
 for(let i=0;i<2800&&items.filter(r=>r.variant<2).length<140;i++){
  const x=-815+rng()*200,z=-522+rng()*410;if(rng()>sampleForestWeight(x,z))continue;add(x,z,3.5+Math.pow(rng(),.7)*20,rng()<.7?0:1);
 }
 // Tidewater's broadleaf canopy is a forest core with a broken, thinning
 // edge. Build several inland stands first, rather than filling the lowest
 // acceptable contour until it looks like a row of planted saplings.
 const stands=[
  [-766,-68,34,31,20],[-706,60,33,34,17],[-736,112,42,37,27],
  [-735,176,42,39,27],[-715,233,36,29,14],
 ];
 let inlandStand=0;
 for(const [cx,cz,rx,rz,target] of stands){
  const diagnostic={center:[cx,cz],target,attempts:0,patchGap:0,waterEdge:0,submerged:0,waterDistance:0,elevation:0,slope:0,newTreeSpacing:0,existingTreeSpacing:0,accepted:0};diagnostics.push(diagnostic);activeDiagnostic=diagnostic;
  let accepted=0;
  for(let i=0;i<1900&&accepted<target;i++){
   diagnostic.attempts++;
   const angle=rng()*Math.PI*2,r=Math.pow(rng(),.7),edge=.85+.12*Math.sin(angle*3+cx*.03)+.11*Math.sin(angle*5+cz*.02);
   const x=cx+Math.cos(angle)*rx*r*edge,z=cz+Math.sin(angle)*rz*r*edge;
   const gap=.48+.28*Math.sin(x*.071+Math.sin(z*.031)*1.5)+.24*Math.sin(z*.097-x*.027);
   if(rng()>Math.max(.12,Math.min(.9,gap))){diagnostic.patchGap++;continue;}
   const pick=rng(),variant=pick<.27?0:pick<.52?1:pick<.77?2:pick<.93?3:4;
   const H=variant===4?25+rng()*10:variant===3?7+rng()*6:variant===2?10+rng()*8:8+rng()*12;
   if(add(x,z,H,variant,false,'stand'))accepted++,inlandStand++;
  }
  activeDiagnostic=null;
 }
 // A sparse fringe softens the forest boundary. It cannot reach the active
 // sand shoulder or the walkable banks of the mouth.
 const fringes=[[-773,-47,27,25,3],[-774,29,30,26,4],[-769,104,29,27,4],[-764,177,31,27,4],[-767,228,27,23,3]];
 let shoreFringe=0;
 for(const [cx,cz,rx,rz,target] of fringes){
  let accepted=0;
  for(let i=0;i<350&&accepted<target;i++){
   const angle=rng()*Math.PI*2,r=Math.sqrt(rng()),x=cx+Math.cos(angle)*rx*r,z=cz+Math.sin(angle)*rz*r;
   const variant=rng()<.38?2:rng()<.3?3:rng()<.54?0:1,H=7+rng()*7;
   if(add(x,z,H,variant,false,'fringe'))accepted++,shoreFringe++;
  }
 }
 const coastalInfill=inlandStand+shoreFringe;
 records.push(...items);design.forestRecords=items;
 const eligibleGround=[];
 for(let z=0;z<=240;z+=10)for(let x=-850;x<=-650;x+=10){
  const f=data.field.sample(x,z),y=t.heightAt(x,z),grade=Math.hypot(t.heightAt(x+1,z)-t.heightAt(x-1,z),t.heightAt(x,z+1)-t.heightAt(x,z-1))/2;
  if(f[1]>=25&&y>=Math.max(f[0]+4.2,8.2)&&grade<=1.1)eligibleGround.push([x,z,Math.round(y*10)/10,Math.round(f[1]),Math.round(grade*100)/100]);
 }
 const lowLegacyRoots=records.filter(r=>!r.sample&&r.x>-900&&r.x<-700&&r.z>-20&&r.z<170&&r.H>15&&t.heightAt(r.x,r.z)<8.2).map(r=>({x:r.x,z:r.z,base:r.y,height:r.H,waterDistance:data.field.sample(r.x,r.z)[1]}));
 return {mature:items.filter(r=>r.variant===4).length,young:items.filter(r=>r.variant<2).length,coastalInfill,inlandStand,shoreFringe,coastalShadowCasters:items.filter(r=>r.coastal&&r.castsFixedShadow).length,coastalDiagnostics:diagnostics,eligibleGround,lowLegacyRoots,coastalRoots:items.filter(r=>r.coastal).map(r=>({x:r.x,z:r.z,height:r.H,variant:r.variant,base:r.y,zone:r.forestZone,castsFixedShadow:r.castsFixedShadow,rootSink:r.rootSink})),heroMeasurements:items.filter(r=>r.landmark).map(r=>({root:[r.x,r.y,r.z],height:r.H,DBH:trunkSection(templates[r.variant],r.s,r.sy),nominalCrownWidth:templates[r.variant].width*r.s})),crownMeasurement:'nominal template span, not the measured leaf/wood bounding box',identity:'fixed authored instances with the existing near/far native canopy pipeline',scientificStatus:'modern mixed-age forest scale analogy; no named fossil species'};
}
