import {Euler, Quaternion, Sphere, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {InstanceRecords, instancedMesh, kitModule, TAU, smooth, clamp} from '../vendor/tidewater/src/world/wildlife/Kit.js';
import {loadReviewedFauna, reviewedAlbedo, reviewedGeometry} from './VaultEnvironmentAssets.js';
import {clipCreekRefraction} from './CreekWater.js';

import { reviewedGeometryLods, loadReviewedIndices } from './VaultGeometryLods.js';

const SEA = -.7;
const TYPES = {
 ichthyornis: {kind:'bird',span:.82,sourceSpan:.994,range:136,preload:203,frequency:3.9,stroke:.49,
  root:[.098,.100,.092,.045],hip:[-.068,-.048,1.49],ankle:[-.133,-.046,1.04],pitch:.19},
 sapeornis: {kind:'bird',span:.89,sourceSpan:.983,range:126,preload:190,frequency:3.25,stroke:.55,
  root:[.107,.087,.101,.09],hip:[-.17,-.013,2.05],ankle:[-.297,.052,.83],pitch:.34},
 meganeura: {kind:'insect',span:.57,sourceSpan:.996,range:36,preload:94,frequency:9.1,stroke:.61,
  root:[.052,.025,.131,-.08],hind:[.052,.028,.079,.10],wingLag:1.17,tuck:.52},

};

const flightModule = new ShaderModule({name:'reviewedVaultFlight',deps:[kitModule],code:/* wgsl */`
fn vaultFlightRz(v:vec3f, angle:f32)->vec3f {
 let s = sin(angle); let c = cos(angle); return vec3f(c*v.x-s*v.y,s*v.x+c*v.y,v.z);
}
fn vaultFlightRx(v:vec3f, angle:f32)->vec3f {
 let s = sin(angle); let c = cos(angle); return vec3f(v.x,c*v.y-s*v.z,s*v.y+c*v.z);
}
fn vaultFlightRy(v:vec3f, angle:f32)->vec3f {
 let s=sin(angle); let c=cos(angle); return vec3f(c*v.x+s*v.z,v.y,c*v.z-s*v.x);
}
fn vaultFlightBend(p:vec3f, curve:vec4f, fore:vec4f, hind:vec4f, w:vec4f, translate:f32, bird:bool)->vec3f {
 let side=w.y;
 let joint=mix(fore,hind,w.z);
 let yaw=joint.w*side;
 let root=vec3f(joint.x*side,joint.y,joint.z)*translate;
 let local=vaultFlightRy(p-root,-yaw);
 let shoulder=mix(curve.x,curve.y,w.z)*side;
 var wing=local;
 if(bird){
  let elbow=vec3f(.138*side,.035,.024)*translate;
  let wrist=vec3f(.259*side,.020,.013)*translate;
  let feathers=wrist+vaultFlightRy(vaultFlightRz(wing-wrist,curve.w*side),max(0.0,curve.w)*side*.25);
  wing=mix(wing,feathers,smoothstep(.49,.98,w.w));
  let forearm=elbow+vaultFlightRz(wing-elbow,curve.z*side);
  wing=mix(wing,forearm,smoothstep(.20,.72,w.w));
 }else{
  // A slight torsion follows the stroke; each membrane shares its hinge with its veins.
  let wrist=vec3f(.17*side,.02,0.0)*translate;
  let flex=wrist+vaultFlightRx(wing-wrist,curve.w*.32);
  wing=mix(wing,flex,w.w*w.w);
 }
 return mix(p,root+vaultFlightRy(vaultFlightRz(wing,shoulder),yaw),w.x);
}
fn vaultFlightBody(p:vec3f, joint:vec4f, wing:vec4f, body:vec4f, curve:vec4f, translate:f32, bird:bool, tuck:f32, hip:vec3f, ankle:vec3f)->vec3f {
 if(bird){
  let h=vec3f(0.0,hip.x,hip.y)*translate;
  let a=vec3f(0.0,ankle.x,ankle.y)*translate;
  let toes=a+vaultFlightRx(p-a,ankle.z+curve.z*.10);
  let feet=h+vaultFlightRx(mix(p,toes,body.z)-h,hip.z+curve.z*.13);
  let tailRoot=vec3f(0.0,-.036,-.151)*translate;
  let tail=tailRoot+vaultFlightRx(p-tailRoot,curve.z*.31-.05);
  return mix(mix(p,feet,body.y),tail,body.x);
 }
 // The abdomen flexes from its base before the posterior segment follows.
 let abdomen=vec3f(0.0,0.015,-0.085)*translate;
 let abdomenEnd=vec3f(0.0,0.004,-0.22)*translate;
 let tip=abdomenEnd+vaultFlightRy(p-abdomenEnd,curve.w*0.47);
 let bent=abdomen+vaultFlightRx(mix(p,tip,body.w)-abdomen,curve.z*0.34);
 let legBase=vec3f(joint.x*wing.y*0.57,0.0,0.12)*translate;
 let leg=legBase+vaultFlightRz(vaultFlightRx(p-legBase,tuck+curve.w*.48),wing.y*(tuck*.24+curve.z*.29));
 let feeler=vec3f(joint.x*wing.y*0.32,0.02,0.16)*translate;
 let antenna=feeler+vaultFlightRy(p-feeler,curve.w*wing.y*0.32);
 return mix(mix(mix(p,bent,body.x),leg,body.y),antenna,body.z);
}
`});

function flightWeights(kind, type, [x,y,z]) {
 const side=x<0?-1:1, ax=Math.abs(x);
 if (type.kind==='bird') {
  // Source feet extend sideways below the pectoral; include only the wing fan here.
  const small=kind==='ichthyornis';
  const aboveFeet=Math.max(smooth(small?-.12:-.20,small?.002:-.102,y),smooth(.17,.22,ax));
  const aheadTail=Math.max(smooth(-.23,-.105,z),smooth(.16,.23,ax));
  return [smooth(small?.068:.062,small?.168:.192,ax)*aboveFeet*aheadTail,side,0,smooth(.09,.47,ax)];
 }
 const start=type.root[0], span=smooth(start,.47,ax);
 const wingHeight=Math.max(smooth(-.015,.021,y),smooth(.134,.21,ax));
 const wing=smooth(.053,.131,ax)*wingHeight*(1-smooth(.209,.255,z));
 return [wing,side,1-smooth(.012,.086,z),span];
}

function flightBodyWeights(kind, [x,y,z]) {
 const ax=Math.abs(x);
 if(TYPES[kind].kind==='bird'){
  const tail=(1-smooth(-.34,-.16,z))*(1-smooth(.142,.205,ax));
  const small=kind==='ichthyornis';
  const feet=(1-smooth(small?-.116:-.23,small?-.071:-.164,y))*(1-smooth(.17,.208,ax))*smooth(-.23,-.10,z);
  const toes=1-smooth(small?-.152:-.304,small?-.123:-.275,y);
  return [tail,feet,toes,0];
 }
 const abdomen=1-smooth(-.27,-.085,z), axial=1-smooth(.060,.114,ax);
 const legs=(1-smooth(-.039,.014,y))*smooth(.025,.085,ax)*smooth(.13,.23,z);
 const feelers=smooth(.255,.365,z)*(1-smooth(.10,.18,ax));
 return [abdomen*axial,legs,feelers,1-smooth(-.38,-.23,z)];
}

export function reviewedFlightAngles(kind, phase, effort, drift) {
 const {kind: family, stroke, wingLag}=TYPES[kind];
 const bird=family==='bird';
 const front=stroke*effort*(Math.sin(phase)-.16*Math.sin(phase*2+.25));
 const hind=bird?front:stroke*.84*effort*Math.sin(phase-wingLag);
 return [
  (bird?.026:.09)+front,
  (bird?.026:.035)+hind,
  (bird?.165:.14)*effort*Math.sin(phase-.72),
  (bird?.115:.13)*effort*Math.sin(phase-1.29)+(bird?.025:0)*Math.sin(drift),
 ];
}

export function reviewedFlightGeometry(gltf,kind) {
 const type=TYPES[kind];
 const geometry=reviewedGeometry(gltf,(x,y,z,normal)=>{
  const orientation=kind==='meganeura'?-1:1;
  const s=normal?1:1/type.sourceSpan;
  return [x*s*orientation,y*s,z*s*orientation];
 },p=>flightWeights(kind,type,p),p=>flightBodyWeights(kind,p));
 return geometry;
}

// At the switch the projected simplification error is below one pixel.
// A small hysteresis band keeps a gliding bird on one mesh at the boundary.
function flightLodAt(pixels, previous) {
  if (pixels > (previous === 0 ? 112 : 132)) return 0;
  if (pixels > (previous === 1 ? 26 : 32)) return 1;
  return 2;
}

async function createFlightBatch(kind, type, capacity, field, signal) {
 const [gltf,indices]=await Promise.all([loadReviewedFauna(kind,signal),loadReviewedIndices(kind,signal)]);
 const geometry=reviewedFlightGeometry(gltf,kind);
 const geometryLevels=reviewedGeometryLods(geometry,indices);
 const texture=await reviewedAlbedo(gltf,kind,signal);
 const levels=geometryLevels.map(levelGeometry=>{
  const records=new InstanceRecords('vaultFlightInstances',capacity,6);
  const F=i=>records.field(i);
  const material=new Material({
   name:`Vault flying ${kind}`, vertexColors:true, side:type.kind==='insect'?'double':'front',
   roughness:.76, metalness:0, modules:[flightModule], textures:texture?{vaultFlightAlbedo:texture}:{},
   storage:{vaultFlightInstances:records.buffer}, attributes:{aWing:'vec4f',aFlightBody:'vec4f'},
   vertex:/* wgsl */`
    let center = ${F(0)}; let q=${F(1)}; let wings=${F(2)};
    let oldCenter = ${F(3)}; let oldQ=${F(4)}; let oldWings=${F(5)};
    let fore = vec4f(${type.root.join(',')}); let hind = vec4f(${(type.hind??type.root).join(',')});
    let bird = ${type.kind==='bird'}; let tuck = ${(type.tuck??0).toFixed(3)};
    let hip=vec3f(${(type.hip??[0,0,0]).join(',')}); let ankle=vec3f(${(type.ankle??[0,0,0]).join(',')});
    let wing = v.aWing; let body = v.aFlightBody;
    let p=vaultFlightBend(vaultFlightBody(v.position,fore,wing,body,wings,1.0,bird,tuck,hip,ankle),wings,fore,hind,wing,1.0,bird);
    let previous=vaultFlightBend(vaultFlightBody(v.position,fore,wing,body,oldWings,1.0,bird,tuck,hip,ankle),oldWings,fore,hind,wing,1.0,bird);
    let n=normalize(vaultFlightBend(vaultFlightBody(v.normal,fore,wing,body,wings,0.0,bird,tuck,hip,ankle),wings,fore,hind,wing,0.0,bird));
    v.useWorld=true;
    v.worldPos=center.xyz+rotateQ(q,p*center.w);
    v.worldNormal=rotateQ(q,n);
    v.prevWorldPos=oldCenter.xyz+rotateQ(oldQ,previous*oldCenter.w);
   `,
   surface:`${texture?'s.albedo*=textureSample(vaultFlightAlbedo,smpAnisoRepeat,in.uv).rgb;':''}
    s.specularIntensity=${type.kind==='bird'?'.15':'.24'};`,
  });
  clipCreekRefraction(material,field);
  const mesh=instancedMesh(kind,levelGeometry,material,records);
  mesh.visible=false;
  return {mesh,records,triangles:levelGeometry.index.count/3};
 });
 return {levels,meshes:levels.map(level=>level.mesh),dispose(){
  for(const {mesh,records} of levels){
   mesh.geometry.dispose();
   mesh.material.uniformBlock.buffer?.destroy();
   mesh.material.dispose();
   records.buffer.destroy();
  }
  texture?.destroy();
 }};
}

function flightOrbit(flier, angle, bird, out) {
 const {habitat,rx,rz,rate,phase}=flier;
 const angularVelocity=rate*flier.direction;
 const c=Math.cos(habitat.heading), s=Math.sin(habitat.heading);
 const side=bird?1.4:.42, ahead=bird?2.45:.42;
 const a=2*angle+phase, b=a-.45;
 const primaryX=Math.cos(angle)*rx, secondaryX=Math.cos(b)*side;
 const primaryZ=Math.sin(angle)*rz, secondaryZ=Math.sin(a)*ahead;
 const x=primaryX+secondaryX,z=primaryZ+secondaryZ;
 const dx=(-Math.sin(angle)*rx-2*side*Math.sin(b))*angularVelocity;
 const dz=(Math.cos(angle)*rz+2*ahead*Math.cos(a))*angularVelocity;
 out[0]=habitat.x+x*c-z*s;
 out[1]=habitat.z+z*c+x*s;
 out[2]=dx*c-dz*s;
 out[3]=dz*c+dx*s;
 if(out.length>4){
  const ax=-(primaryX+4*secondaryX)*rate*rate,az=-(primaryZ+4*secondaryZ)*rate*rate;
  out[4]=ax*c-az*s;
  out[5]=az*c+ax*s;
 }
}

function flightCover(terrain, field, x, z, bird) {
 const ground=Math.max(SEA,terrain.heightAt(x,z));
 if (bird) return ground;
 const [level, edge]=field.sample(x,z);
 return Math.max(ground,edge<0?level:SEA);
}

// Plan the height once over the orbit. A higher patch raises the approach and
// departure across multiple seconds instead of moving the animal up in one frame.
function flightFloor(flier, terrain, field, bird) {
 const stepMetres=bird?.68:.20;
 const count=Math.ceil(TAU*(Math.max(flier.rx,flier.rz)+(bird?5:1.1))/stepMetres);
 const step=TAU/count;
 const clearance=new Float32Array(count*2);
 const floor=new Float32Array(count);
 const point=new Float64Array(4);
 for (let i=0;i<clearance.length;i++) {
  flightOrbit(flier,i*step*.5,bird,point);
  clearance[i]=flightCover(terrain,field,point[0],point[1],bird);
 }
 for (let i=0;i<count;i++) {
  floor[i]=Math.max(clearance[(2*i+clearance.length-1)%clearance.length],clearance[2*i],clearance[2*i+1])+.06;
 }
 const interval=step/flier.rate;
 const descent=bird?4.6:1.05,ascent=bird?4.2:1.28;
 const downward=(flier.direction>0?descent:ascent)*interval;
 const upward=(flier.direction>0?ascent:descent)*interval;
 for (let n=0;n<count*2;n++) {
  const i=n%count;
  floor[i]=Math.max(floor[i],floor[(i+count-1)%count]-downward);
 }
 for (let n=count*2-1;n>=0;n--) {
  const i=n%count;
  floor[i]=Math.max(floor[i],floor[(i+1)%count]-upward);
 }
 return floor;
}

function orbitFloor(floor, angle) {
 const frame=(angle/TAU-Math.floor(angle/TAU))*floor.length;
 const i=Math.floor(frame)%floor.length;
 const fraction=frame-Math.floor(frame);
 return floor[i]+(floor[(i+1)%floor.length]-floor[i])*fraction;
}

export function flightHabitats(data, visits) {
 const {field}=data;
 const habitats=[];
 const add=(species,id,x,z,count,rx,rz,alt,heading=0)=>habitats.push({species,id,x,z,count,rx,rz,alt,heading});
 const coast=data.coast.coast;
 add('ichthyornis','west-coast',coast.x-38,coast.z+10,9,28,19,6.2,1.2);
 add('ichthyornis','east-bay',visits['east-bay'].p[0]+24,visits['east-bay'].p[1]-19,8,39,21,8,.8);
 for (const station of data.cove.continuous.stations) {
  const [x,z]=station.at(118,50);
  add('ichthyornis',station.id,x,z,6,31,17,9,Math.atan2(station.normal[1],station.normal[0])+Math.PI/2);
 }
 const river=field.continuousSample;
 if (river) {
  add('ichthyornis','sample-estuary',-867,126,9,23,11,4.5,1.16);
  add('ichthyornis','sample-shoal',-945,157,8,47,16,7.3,.37);
  add('meganeura','sample-wet-mouth-margin',-837,117,5,5.2,3.1,1.35,1.60);
  for (const [id,x,z,rx,rz,alt] of [
   ['sample-upper',-677,-460,22,12,5.3],['sample-forest-edge',-718,-351,24,17,11],
   ['sample-log-gap',-698,-267,26,14,6],['sample-bend',-746,-162,21,13,5.8],
   ['sample-reed-bend',-749,-43,26,17,5.5],['sample-low-bank',-796,68,32,13,4.5],
  ]) add('sapeornis',id,x,z,6,rx,rz,alt,1.28);
  for (let distance=20;distance<685;distance+=34) {
   const p=river.points.find(candidate=>candidate.distance>=distance);
   if (!p||p.level<.28) continue;
   const dir=river.nearest(p.x,p.z).dir;
   const heading=Math.atan2(dir[1],dir[0]);
   add('meganeura',`sample-water-${distance}`,p.x,p.z,4,5.8,Math.max(2,p.width*.65),1.45,heading);
  }
 }
 for (const id of ['lake','highland-lake','wetland','east-source','north-source','giant-glade','giant-log','grassland']) {
  const visit=visits[id], [x,z]=visit.p;
  const forest=id.startsWith('giant-');
  add('sapeornis',id,x+8,z-17,7,forest?20:31,forest?14:23,forest?17:8,1.12);
  if (id==='grassland') continue;
  const dx=visit.gaze[0]-x,dz=visit.gaze[2]-z,look=Math.hypot(dx,dz)||1;
  if (!forest && id!=='highland-lake') {
   add('meganeura',id,x+dx/look*7,z+dz/look*7,6,6,4,1.8,Math.atan2(dz,dx));
  }
 }
 add('sapeornis','original-creek-ford',-19,-25,6,16,10,5.8,1.16);
 return habitats;
}

export class VaultEnvironmentFlight {
 constructor(group,data,visits,residency,prepare) {
  this.group=group;
  this.data=data;
  this.residency=residency;
  this.habitats=flightHabitats(data,visits);
  this.types=new Map(Object.keys(TYPES).map(id=>[id,{id,type:TYPES[id],fliers:[],batch:null}]));
  this.fliers=[];
  this.trackingFliers=[];
  this.flightPoint=new Float64Array(6);
  this.sphere=new Sphere(); this.projection=new Vector3(); this.euler=new Euler(0,0,0,'YXZ'); this.q=new Quaternion();
  const rng=mulberry32(181029);
  for (const habitat of this.habitats) {
   const state=this.types.get(habitat.species), bird=state.type.kind==='bird', seed=rng()*TAU;
   for (let i=0;i<habitat.count;i++) {
    const flier={id:`${habitat.id}-${habitat.species}-${i+1}`,species:habitat.species,habitat,position:new Vector3(),active:false,
     phase:rng()*TAU, orbit:seed+(bird&&i>=Math.ceil(habitat.count*.64)?Math.PI:0)+i*(bird?.15:.62)+rng()*.24,
     rx:habitat.rx*(.80+rng()*.29), rz:habitat.rz*(.76+rng()*.37), altitude:habitat.alt+(rng()-.5)*(bird?3.2:.65),
     rate:bird?(.91+rng()*.18)*(habitat.species==='ichthyornis'?.34:.43):.5+rng()*.46,
     span:state.type.span*(.86+rng()*.28), frequency:state.type.frequency*(.83+rng()*.33),record:new Float32Array(24), fresh:true};
    // A flock shares its bearing; dragonflies patrol a water margin independently.
    flier.direction=(bird?seed:flier.phase)<Math.PI?-1:1;
    state.fliers.push(flier); this.fliers.push(flier);
   }
  }
  if(residency)for(const state of this.types.values()){
   const {type,id}=state;
   const habitats=this.habitats.filter(h=>h.species===id).map(h=>{
    const ground=Math.max(SEA,data.terrain.heightAt(h.x,h.z));
    return {x:h.x,z:h.z,radius:Math.max(h.rx,h.rz)*1.15,minY:ground-4,maxY:ground+h.alt+12};
   });
   if(!habitats.length)continue;
   const bytes=15*1024**2;
   residency.add({id,habitats,bytes,range:type.preload,hysteresis:type.kind==='bird'?75:42,
    load:signal=>createFlightBatch(id,type,state.fliers.length,data.field,signal),prepare:(batch,signal)=>prepare(id,batch,signal),
    attach:batch=>{state.batch=batch;this.group.add(...batch.meshes);},
    detach:batch=>{
     for(const mesh of batch.meshes)mesh.removeFromParent();
     state.batch=null;
     for(const f of state.fliers){f.fresh=true;f.active=false;}
    },
    dispose:batch=>batch.dispose(),
   });
  }
 }

 update(time,camera,frustum,pxScale,sight,enabled) {
  const cp=camera.position, terrain=this.data.terrain;
  this.visible={birds:0,insects:0,triangles:0};
  this.trackingFliers.length=0;
  for (const state of this.types.values()) {
   const {type,batch}=state;
   if (!batch) continue;
   const bird=type.kind==='bird', channel=bird?'birds':'insects';
   for(const level of batch.levels)level.records.begin();
   for (const f of state.fliers) {
    const h=f.habitat, range=type.range, anchorDistance=Math.hypot(cp.x-h.x,cp.z-h.z);
    f.active=false;
    if (!enabled||anchorDistance>range+Math.max(h.rx,h.rz)*1.2) {f.fresh=true;continue;}
    const angularVelocity=f.rate*f.direction;
    const a=time*angularVelocity+f.orbit,wobble=f.phase+time*(bird?.62:1.4);
    flightOrbit(f,a,bird,this.flightPoint);
    const [x,z,dx,dz,ax,az]=this.flightPoint;
    f.floor??=flightFloor(f,terrain,this.data.field,bird);
    const base=orbitFloor(f.floor,a);
    const cover=flightCover(terrain,this.data.field,x,z,bird);
    const activity=bird?1:.52+.48*smooth(-.3,.85,Math.sin(time*.38+f.phase));
    const y=base+(bird?f.altitude+Math.sin(a+f.phase)*.72
     :Math.max(.24,f.altitude*activity+Math.sin(wobble*1.4)*.24));
    f.position.set(x,y,z);
    const distance=cp.distanceTo(f.position), scale=f.span*(1-smooth(range*.82,range,distance));
    const pixels=scale*pxScale/Math.max(.2,distance);
    f.active=bird&&distance<range;
    if (pixels<1.7) {f.fresh=true;continue;}
    this.sphere.center.copy(f.position); this.sphere.radius=scale*.7;
    f.trackingVisible=frustum.intersectsSphere(this.sphere);
    f.trackingSpan=scale;
    this.trackingFliers.push(f);
    if (!f.trackingVisible) {f.fresh=true;continue;}
    const lookAhead=angularVelocity*.18;
    let climb=(orbitFloor(f.floor,a+lookAhead)-orbitFloor(f.floor,a-lookAhead))/.36;
    if(bird)climb+=.72*angularVelocity*Math.cos(a+f.phase);
    else if(y>base+.24){
     const t=time*.38+f.phase, ramp=clamp((Math.sin(t)+.3)/1.15,0,1);
     climb+=.48*6*ramp*(1-ramp)*Math.cos(t)*.38/1.15*f.altitude+.24*1.96*Math.cos(wobble*1.4);
    }
    const horizontal=Math.hypot(dx,dz);
    // +Z is forward. Rz tips the lift vector toward -X, so a right-hand
    // acceleration calls for negative roll. Use the orbit's actual curvature.
    const bank=clamp(-Math.atan2(dz*ax-dx*az,9.81*horizontal),-.9,.9);
    const pitch=(type.pitch??.02)-clamp(Math.atan2(climb,horizontal),-.78,.78);
    this.q.setFromEuler(this.euler.set(pitch,Math.atan2(dx,dz),bank,'YXZ'));
    if (!f.fresh) f.record.copyWithin(12,0,12);
    const cycle=time*f.frequency*TAU+f.phase;
    const flightGate=bird?Math.max(.045+.955*smooth(-.52,.32,Math.sin(time*.55+f.phase)),
     .58*smooth(.6,3.0,climb)+.20*smooth(.28,.72,Math.abs(bank))):activity;
    f.record.set([x,y,z,scale,this.q.x,this.q.y,this.q.z,this.q.w,
     ...reviewedFlightAngles(f.species,cycle,flightGate,wobble)],0);
    if (f.fresh) f.record.copyWithin(12,0,12);
    f.fresh=false;
    f.lod=flightLodAt(pixels,f.lod);
    const {records}=batch.levels[f.lod];
    records.data.set(f.record,records.push());
    this.projection.copy(f.position).project(camera);
    sight[channel].push({id:f.id,kind:f.species,position:f.position.toArray(),span:scale,pixels,distance,ndc:[this.projection.x,this.projection.y],habitat:h.id,groundClearance:y-cover});
   }
   for(const {mesh,records,triangles} of batch.levels){
    mesh.visible=records.count>0;
    if(records.count)records.commit();
    this.visible[channel]+=records.count;
    this.visible.triangles+=records.count*triangles;
   }
  }
 }

 hold() {for (const f of this.fliers) f.fresh=true;}

 stats() {
  return {
   types:Object.fromEntries([...this.types.values()].map(s=>[s.id,{kind:s.type.kind,count:s.fliers.length,ready:!!s.batch,status:this.residency?.state(s.id)?.status??'outside',error:this.residency?.state(s.id)?.error??null,visible:s.batch?.levels.reduce((sum,l)=>sum+l.records.count,0)??0}])),
   habitats:this.habitats.map(h=>({id:h.id,species:h.species,center:[h.x,h.z],count:h.count})),
   visible:this.visible,
  };
 }
}
