import {Euler, Quaternion, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {StorageBuffer} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {lodFadeModule} from '../vendor/tidewater/src/materials/LODFade.js';
import {angleDiff, clamp, lerp, smooth, TAU} from '../vendor/tidewater/src/world/wildlife/Kit.js';

// Coordinates use +Z toward the snout and +Y up. Each pair of fin joints follows
// its parent vertebra before hinging, so steering never slides the roots over the skin.
export const REVIEWED_SWIM_RIGS = {
 falcatus:{
  axial:[[0,-.009,.239],[0,-.006,.126],[0,-.004,.002],[0,-.013,-.133],[0,-.003,-.239],[0,.007,-.307],[0,.015,-.392]],
  pectoral:{root:[.057,-.052,.218],tip:[.133,-.086,.200],parent:0,stroke:.21,sweep:.17,flex:.145},
  pelvic:{root:[.030,-.044,-.087],tip:[.055,-.062,-.101],parent:3,stroke:.115,sweep:.12,flex:.09},
  dorsal:{root:[0,.036,-.024],parent:2},anal:{root:[0,-.035,-.204],parent:4},
  waveLag:[0,.82,1.68,2.60,3.42,4.00,4.68],
  waveGain:[.025,.10,.26,.49,.73,1,1.09],
  turnGain:[0,.22,.51,.79,.98,1,.67],
  steadyAngle:.42,burstAngle:.66,cadence:.67,paceCadence:.40,burstCadence:1.42,
  steerRate:2.5,headingGain:4.3,bank:.19,finPhase:0,
 },
 cheiracanthus:{
  axial:[[0,-.007,.280],[0,-.001,.161],[0,-.002,.040],[0,-.004,-.080],[0,-.007,-.190],[0,.001,-.289],[0,.009,-.387]],
  pectoral:{root:[.049,-.059,.264],tip:[.072,-.113,.219],parent:0,stroke:.14,sweep:.10,flex:.022},
  pelvic:{root:[.023,-.086,.088],tip:[.036,-.153,.049],parent:2,stroke:.13,sweep:.094,flex:.024},
  dorsal:{root:[0,.063,-.018],parent:2},anal:{root:[0,-.059,-.165],parent:4},
  waveLag:[0,1.05,2.00,2.96,3.85,4.43,5.12],
  waveGain:[.018,.14,.34,.59,.83,1,1.14],
  turnGain:[0,.19,.52,.82,1,1,.73],
  steadyAngle:.50,burstAngle:.71,cadence:.83,paceCadence:.48,burstCadence:1.72,
  steerRate:3.1,headingGain:5.4,bank:.13,finPhase:.83,
 },
};

export const REVIEWED_SWIM_BONES = {pectoral:7,pelvic:11,dorsal:15,anal:16,count:17};

const follow = (value,target,dt,rate) => lerp(value,target,-Math.expm1(-dt*rate));

export function reviewedCruiseSpeed(fish,time,distance) {
 const shark=fish.vault==='falcatus';
 const targetSpeed=shark?1.38+.68*fish.seed:1.22+.78*fish.seed;
 const pulse=.5+.5*Math.sin(time*(.59+fish.seed*.14)+fish.slot*1.7);
 const cruise=shark?lerp(.69,1,pulse):lerp(.14,1,smooth(.12,.70,pulse));
 const approach=smooth(fish.L*.35,fish.L*2.4,distance);
 return fish.L*targetSpeed*lerp(cruise*lerp(shark?.52:.23,1,approach),1,fish.panic);
}

export function advanceReviewedSwimPose(fish,dt) {
 const rig=REVIEWED_SWIM_RIGS[fish.vault];
 const velocity=fish.velocity, horizontal=Math.hypot(velocity.x,velocity.z), speed=horizontal/fish.L;
 const yaw=speed>.035?Math.atan2(velocity.x,velocity.z):fish.yaw;
 const heading=angleDiff(yaw,fish.yaw), panic=fish.panic;
 const swim=fish.swimPose??={phase:fish.phase,effort:0,burst:0,bend:0,finEffort:0,pitch:0,roll:0,yawRate:0,vertical:0,steer:0,seed:fish.seed};
 const yawLimit=rig.steerRate*(.63+.37*smooth(.13,1.35,speed)+panic*.45);
 const desiredRate=clamp(heading*rig.headingGain,-yawLimit,yawLimit)*smooth(.035,.27,speed);
 swim.yawRate=follow(swim.yawRate,desiredRate,dt,panic>.2?15:9);
 fish.yaw+=swim.yawRate*dt;
 const cruise=smooth(.11,1.95,speed), escape=smooth(.11,.83,panic);
 swim.effort=follow(swim.effort,cruise,dt,cruise>swim.effort?8:3.4);
 swim.burst=follow(swim.burst,escape,dt,escape>swim.burst?13:2.8);
 swim.steer=follow(swim.steer,clamp(desiredRate/rig.steerRate,-1,1),dt,10);
 const curvature=clamp(heading*1.05+swim.yawRate*.09,-1,1);
 swim.bend=follow(swim.bend,curvature*smooth(.045,.49,speed)*(.36+.23*swim.burst),dt,11);
 const pitch=clamp(-Math.atan2(velocity.y,Math.max(fish.L*.35,horizontal)),-.35,.35);
 swim.pitch=follow(swim.pitch,pitch,dt,7);
 swim.vertical=follow(swim.vertical,clamp(velocity.y/fish.L,-1,1),dt,8);
 swim.roll=follow(swim.roll,-swim.steer*rig.bank*(.36+.64*cruise),dt,8);
 const cadence=(rig.cadence+Math.min(speed,3.5)*rig.paceCadence)*(1+(swim.seed-.5)*.25)+rig.burstCadence*swim.burst;
 swim.phase=(swim.phase+TAU*cadence*dt)%TAU;
 // Paired fins retain a small correction stroke during station keeping.
 swim.finEffort=follow(swim.finEffort,.18+.73*Math.max(cruise,swim.burst),dt,7);
 return swim;
}

const axialYaw = new Float64Array(7);
const centers = Array.from({length:7},()=>new Vector3());
const axes = Array.from({length:7},()=>new Quaternion());
const vector = new Vector3(), center = new Vector3(), tip = new Vector3();
const pivot = new Vector3(), rootPivot = new Vector3(), tipPivot = new Vector3();
const local = new Quaternion(), joint = new Quaternion(), world = new Quaternion();
const euler = new Euler(0,0,0,'YXZ');

function writeBone(out, offset, bone, q, rest, posed, heading) {
 world.multiplyQuaternions(heading,q);
 vector.copy(rest).applyQuaternion(q);
 center.copy(posed).sub(vector).applyQuaternion(heading);
 const {x,y,z,w}=world, x2=x+x, y2=y+y, z2=z+z;
 offset+=bone*12;
 out[offset]=1-y*y2-z*z2;out[offset+1]=x*y2-w*z2;out[offset+2]=x*z2+w*y2;out[offset+3]=center.x;
 out[offset+4]=x*y2+w*z2;out[offset+5]=1-x*x2-z*z2;out[offset+6]=y*z2-w*x2;out[offset+7]=center.y;
 out[offset+8]=x*z2-w*y2;out[offset+9]=y*z2+w*x2;out[offset+10]=1-x*x2-y*y2;out[offset+11]=center.z;
}

function parentPoint(out, point, rig, parent) {
 return out.copy(point).sub(vector.fromArray(rig.axial[parent])).applyQuaternion(axes[parent]).add(centers[parent]);
}

export function writeReviewedSwimPalette(out,offset,kind,swim,heading) {
 const rig=REVIEWED_SWIM_RIGS[kind], phase=swim.phase;
 const shark=kind==='falcatus', variation=.92+.16*swim.seed;
 const effort=lerp(rig.steadyAngle*swim.effort,rig.burstAngle,swim.burst)*variation;
 for(let i=0;i<7;i++){
  const lag=rig.waveLag[i], caudal=i===6;
  const feather=caudal?Math.sin(phase-lag-.79)*effort*(shark?.26:.19):0;
  const yaw=Math.sin(phase-lag)*effort*rig.waveGain[i]-swim.bend*rig.turnGain[i]+feather;
  const tilt=caudal?Math.sin(phase-lag-.63)*effort*(shark?.11:.055):0;
  const twist=caudal?Math.cos(phase-lag-.36)*effort*(shark?.28:.15):0;
  axialYaw[i]=yaw;
  axes[i].setFromEuler(euler.set(tilt,yaw,twist,'YXZ'));
  const rest=rig.axial[i];
  if(i===0)centers[i].fromArray(rest);
  else{
   const prior=rig.axial[i-1],dz=rest[2]-prior[2],dy=rest[1]-prior[1],angle=(axialYaw[i-1]+yaw)*.5;
   centers[i].set(centers[i-1].x+Math.sin(angle)*dz,centers[i-1].y+dy,centers[i-1].z+Math.cos(angle)*dz);
  }
  writeBone(out,offset,i,axes[i],pivot.fromArray(rest),centers[i],heading);
 }
 for(const part of ['pectoral','pelvic']){
  const fin=rig[part], start=REVIEWED_SWIM_BONES[part], pelvic=part==='pelvic';
  for(const side of [-1,1]){
   const bone=start+(side>0?2:0);
   const t=phase+rig.finPhase+(pelvic?1.84:.48)+side*(swim.steer*.34+(swim.seed-.5)*.22);
   const beat=Math.sin(t), recover=Math.sin(t-1.22);
   const pressure=swim.steer*side;
   const lift=side*(fin.stroke*beat*swim.finEffort+pressure*(shark?.105:.070)+swim.vertical*(pelvic?.035:.081));
   const sweep=side*(fin.sweep*recover*swim.finEffort+pressure*(shark?.12:.079));
   const feather=swim.finEffort*.065*Math.cos(t-.51);
   pivot.set(side*fin.root[0],fin.root[1],fin.root[2]);
   parentPoint(rootPivot,pivot,rig,fin.parent);
   local.setFromEuler(euler.set(feather,sweep,lift,'YXZ'));
   joint.multiplyQuaternions(axes[fin.parent],local);
   writeBone(out,offset,bone,joint,pivot,rootPivot,heading);
   tip.set(side*fin.tip[0],fin.tip[1],fin.tip[2]);
   const flex=fin.flex*swim.finEffort*Math.sin(t-1.02);
   local.setFromEuler(euler.set(0,side*flex*.38,side*flex,'YXZ'));
   tipPivot.copy(tip).sub(pivot).applyQuaternion(joint).add(rootPivot);
   local.premultiply(joint);
   writeBone(out,offset,bone+1,local,tip,tipPivot,heading);
  }
 }
 // Median fin spines are rigid from base to tip. Their bases translate and rotate
 // with the corresponding vertebra, sharing the motion across the skin seam.
 for(const part of ['dorsal','anal']){
  const {root,parent}=rig[part];
  pivot.fromArray(root);
  parentPoint(rootPivot,pivot,rig,parent);
  writeBone(out,offset,REVIEWED_SWIM_BONES[part],axes[parent],pivot,rootPivot,heading);
 }
}

const stride=REVIEWED_SWIM_BONES.count*12;
const matrices=REVIEWED_SWIM_BONES.count;
const skinning=/* wgsl */`
fn reviewedFishMix(a:mat3x4f,b:mat3x4f,w:f32)->mat3x4f {
 return mat3x4f(mix(a[0],b[0],w),mix(a[1],b[1],w),mix(a[2],b[2],w));
}
fn reviewedFishPose(base:u32, weights:vec4f, fin:vec2f)->mat3x4f {
 var m=reviewedFishJoints[base+u32(weights.x)];
 if(weights.z>0.0){
  m=reviewedFishMix(m,reviewedFishJoints[base+u32(weights.y)],weights.z);
 }
 if(weights.w>0.0){
  let i=base+u32(fin.x);
  var f=reviewedFishJoints[i];
  if(fin.y>0.0){f=reviewedFishMix(f,reviewedFishJoints[i+1u],fin.y);}
  m=reviewedFishMix(m,f,weights.w);
 }
 return m;
}
`;

export function createReviewedSwimMotion(batch,kind) {
 const data=new Float32Array(batch.maxInstances*stride*2);
 const buffer=new StorageBuffer({label:batch.name+'.skeleton history',count:batch.maxInstances*matrices*2,type:'mat3x4f',stride:48});
 const module=new ShaderModule({
  name:'vault-reviewed-swim-skeleton',
  bindings:{reviewedFishJoints:{storage:buffer,access:'read'}},
  code:skinning,
 });
 let min=batch.maxInstances,max=-1;
 return {
  module,
  setPose(index,pose,heading,fresh) {
   const base=index*stride*2,old=base+stride;
   if(!fresh)data.copyWithin(old,base,old);
   writeReviewedSwimPalette(data,base,kind,pose,heading);
   if(fresh)data.copyWithin(old,base,old);
   min=Math.min(min,index);max=Math.max(max,index);
  },
  upload(){
   if(max<min)return;
   const start=min*stride*2;
   buffer.write(data.subarray(start,(max+1)*stride*2),start*4);
   min=batch.maxInstances;max=-1;
  },
  dispose(){buffer.destroy();},
 };
}

export function createReviewedSwimMaterial(batch,motion,{fade=false}={}) {
 const record=batch.record('index');
 return new Material({
  name:batch.name+(fade?' fade':''),
  modules:[batch.module,motion.module,...(fade?[lodFadeModule]:[])],
  attributes:{aKind:'f32',aData:'vec4f',aFishFin:'vec2f'},
  varyings:fade?{vFishFade:'vec2f'}:{},
  vertex:/* wgsl */`
   ${fade?`let fe=${batch.fadeEntry()};let index=fe.index;o.vFishFade=vec2f(fe.fade,fe.outgoing);`:`let index=${batch.recordIndex()};`}
   let root=${record[0]};
   let base=index*${matrices*2}u;
   let position=vec4f(v.position,1.0);
   let pose=reviewedFishPose(base,v.aData,v.aFishFin);
   v.useWorld=true;
   v.worldPos=root.xyz+(position*pose)*root.w;
   v.worldNormal=normalize(vec4f(v.normal,0.0)*pose);
   #if PASS_MAIN
   let oldPose=reviewedFishPose(base+${matrices}u,v.aData,v.aFishFin);
   v.prevWorldPos=root.xyz-${record[3]}.xyz+(position*oldPose)*root.w;
   #endif
  `,
  surface:fade?'if(!lodFadeVisible(in.pixel,in.vs.vFishFade.x,in.vs.vFishFade.y>0.5)){discard;}':'',
 });
}
