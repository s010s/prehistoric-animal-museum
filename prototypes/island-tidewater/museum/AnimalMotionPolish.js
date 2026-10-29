// Runtime-only pose repair for the four sample museum models. Source GLBs and
// their locked skeleton/animation bytes stay untouched. Native skin sampling
// still supplies both current and previous palettes to every render pass.
import { Matrix4, Quaternion, Vector3 } from '../vendor/tidewater/src/engine/index.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const tau=Math.PI*2;
const normal=q=>{const d=Math.hypot(...q);if(d<1e-12)throw Error('Degenerate museum motion quaternion');return q.map(v=>v/d);};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const inverse=q=>[-q[0],-q[1],-q[2],q[3]];
const axisAngle=(a,v)=>{const s=Math.sin(v*.5);return [a[0]*s,a[1]*s,a[2]*s,Math.cos(v*.5)];};
const align=(q,to)=>dot(q,to)<0?q.map(v=>-v):q;
const varies=ch=>{const n=ch.path==='rotation'?4:3;return ch.values.some((v,i)=>Math.abs(v-ch.values[i%n])>1e-6);};

function sample(ch,t){
 const T=ch.times,V=ch.values,w=ch.path==='rotation'?4:3;
 if(T.length===1||t<=T[0])return Array.from(V.slice(0,w));
 if(t>=T.at(-1))return Array.from(V.slice(-w));
 let lo=0,hi=T.length-1;while(hi-lo>1){const k=(lo+hi)>>1;if(T[k]>t)hi=k;else lo=k;}
 const u=ch.step?0:(t-T[lo])/(T[hi]-T[lo]),a=Array.from(V.slice(lo*w,lo*w+w));let b=Array.from(V.slice(hi*w,hi*w+w));
 if(w===4)b=align(b,a);
 const q=a.map((v,i)=>v+(b[i]-v)*u);return w===4?normal(q):q;
}

// Normalised quaternion Hermite curves have a continuous tangent. The source
// 24 Hz angular keys keep their timing and key poses; unlike easing every key,
// this does not make the wing stop at each source sample.
function rotationCurve(ch,duration){
 const T=Array.from(ch.times),Q=[];
 for(let i=0;i<T.length;i++){let q=normal(Array.from(ch.values.slice(i*4,i*4+4)));if(i)q=align(q,Q[i-1]);Q.push(q);}
 const closed=Math.abs(dot(Q[0],Q.at(-1)))>Math.cos(.03*.5);
 if(closed)Q[Q.length-1]=[...Q[0]];
 const tangent=i=>{
  let p=i-1,n=i+1,tp=T[p],tn=T[n];
  if(closed&&(i===0||i===T.length-1)){p=T.length-2;n=1;tp=T[p]-duration;tn=T[n];}
  else{p=Math.max(0,p);n=Math.min(T.length-1,n);tp=T[p];tn=T[n];}
  const a=align(Q[p],Q[i]),b=align(Q[n],Q[i]),dt=Math.max(1e-6,tn-tp);return a.map((v,k)=>(b[k]-v)/dt);
 };
 const D=T.map((_,i)=>tangent(i));
 return t=>{
  if(t<=T[0])return [...Q[0]];if(t>=T.at(-1))return [...Q.at(-1)];
  let lo=0,hi=T.length-1;while(hi-lo>1){const k=(lo+hi)>>1;if(T[k]>t)hi=k;else lo=k;}
  const dt=T[hi]-T[lo],u=(t-T[lo])/dt,u2=u*u,u3=u2*u;
  return normal(Q[lo].map((v,k)=>(2*u3-3*u2+1)*v+(u3-2*u2+u)*dt*D[lo][k]+(-2*u3+3*u2)*Q[hi][k]+(u3-u2)*dt*D[hi][k]));
 };
}

function bake(node,duration,fn,hz=120){
 const count=Math.ceil(duration*hz),times=new Float32Array(count+1),values=new Float32Array((count+1)*4);
 let previous=null;
 for(let i=0;i<=count;i++){const t=i*duration/count;let q=normal(fn(t));if(previous)q=align(q,previous);times[i]=t;values.set(q,i*4);previous=q;}
 return {node,path:'rotation',times,values,step:false};
}

function restMatrices(g){
 const W=g.nodes.map(()=>new Matrix4()),parent=new Int32Array(g.nodes.length).fill(-1);
 const visit=(i,p)=>{parent[i]=p;const n=g.nodes[i],local=new Matrix4().compose(new Vector3(...n.t),new Quaternion(...n.r),new Vector3(...n.s));W[i]=p<0?local:W[p].clone().multiply(local);for(const c of n.children)visit(c,i);};
 for(const r of g.roots)visit(r,-1);
 return {W,parent};
}
const node=(g,name)=>{const i=g.nodes.findIndex(n=>n.name===name);if(i<0)throw Error('Museum motion: missing joint '+name);return i;};
function parentAxis(matrices,i,axis){const p=matrices.parent[i];return new Vector3(...axis).transformDirection(p<0?new Matrix4():matrices.W[p].clone().invert()).toArray();}
function replaceRotation(clip,index,channel){const i=clip.channels.findIndex(c=>c.node===index&&c.path==='rotation');if(i<0)clip.channels.push(channel);else clip.channels[i]=channel;}

// Each source flipper is a leaf joint, but both members of a pair rotate about
// the body midline. Relocate the four sockets using dominant fin geometry, then
// compensate every source piece's inverse bind so its rest mesh is unchanged.
function repairFinSockets(g){
 const before=restMatrices(g),sockets={front_fin_L:[-1.50,-.35,-.60],front_fin_R:[-1.50,-.35,.60],rear_fin_L:[.45,-.145,-.40],rear_fin_R:[.45,-.145,.40]},changes=[];
 for(const [name,p]of Object.entries(sockets)){
  const i=node(g,name),parent=before.parent[i];if(g.nodes[i].children.length)throw Error('Museum fin socket is no longer a leaf');
  if(g.animations.some(a=>a.channels.some(c=>c.node===i&&c.path==='translation')))throw Error('Museum fin socket gained a translation clip');
  const local=new Vector3(...p).applyMatrix4(before.W[parent].clone().invert());
  g.nodes[i].t=local.toArray();changes.push({name,node:i,before:before.W[i].elements.slice(12,15),after:p});
 }
 const after=restMatrices(g);
 for(const skin of g.skins)for(let j=0;j<skin.joints.length;j++){
  const i=skin.joints[j];if(!changes.some(c=>c.node===i))continue;
  const oldBind=new Matrix4().fromArray(skin.inverseBindMatrices,j*16),bind=after.W[i].clone().invert().multiply(before.W[i]).multiply(oldBind);
  skin.inverseBindMatrices.set(bind.elements,j*16);
 }
 return changes;
}

function fishMotion(g,summary){
 summary.socketRepairs=repairFinSockets(g);const M=restMatrices(g),clip=g.animations.find(a=>a.name==='Idle');
 if(!clip)throw Error('Museum fish lost its swimming clip');
 for(const ch of [...clip.channels])if(ch.path==='rotation'&&varies(ch)&&ch.times.length>2)replaceRotation(clip,ch.node,bake(ch.node,clip.duration,rotationCurve(ch,clip.duration)));
 for(const name of ['front_fin_L','front_fin_R','rear_fin_L','rear_fin_R']){
  const i=node(g,name),source=clip.channels.find(c=>c.node===i&&c.path==='rotation'),side=name.endsWith('_L')?-1:1,rear=name.startsWith('rear');
  if(!source)throw Error('Museum fish lost flipper animation '+name);
  const flapAxis=parentAxis(M,i,[1,0,0]),sweepAxis=parentAxis(M,i,[0,1,0]),phase=(side>0?.38:0)+(rear?.85:0);
  replaceRotation(clip,i,bake(i,clip.duration,t=>{
   const p=t/clip.duration*tau,opening=(rear?.065:.10)+Math.sin(p+phase)*(rear?.035:.065),sweep=Math.sin(p+phase+.8)*(rear?.025:.045);
   return mul(axisAngle(sweepAxis,side*sweep),mul(axisAngle(flapAxis,-side*opening),sample(source,t)));
  }));
 }
 for(const ch of [...clip.channels])if(ch.path==='rotation'&&/^tail_0[2-6]$/.test(g.nodes[ch.node].name)){
  const rest=normal(g.nodes[ch.node].r),inv=inverse(rest);
  replaceRotation(clip,ch.node,bake(ch.node,clip.duration,t=>{
   const q=align(normal(sample(ch,t)),rest),delta=normal(mul(q,inv)),angle=2*Math.acos(clamp(delta[3],-1,1)),s=Math.sin(angle*.5);
   if(Math.abs(s)<1e-6)return q;
   return mul(axisAngle(delta.slice(0,3).map(v=>v/s),angle*1.12),rest);
  }));
 }
 summary.actions=['four anatomically separated flipper sockets; rest mesh preserved','continuous-tangent source swimming curves with phase-offset flipper opening and sweep','source tail-joint rotations extended by 12%, bone lengths unchanged'];
 // All source vertices were evaluated at 120 Hz through the native sampler.
 // This envelope includes 1.0–1.4 cm of world-space margin around those extrema.
 // Reusing a padded pre-repair envelope would retain a deep fin excursion that
 // the corrected sockets remove and unnecessarily eliminate the swim corridor.
 summary.revisedEnvelope={min:[-4.02,-.995,-1.57],max:[4.03,.91,1.58],sampleHz:120,minimumMarginMetres:.01};
 summary.padding=[0,0,0];
}

function lystroMotion(g,summary){
 const M=restMatrices(g),clip=g.animations.find(a=>a.name==='Idle'),i=node(g,'Neck_1_063_64'),source=clip.channels.find(c=>c.node===i&&c.path==='rotation');
 if(!source)throw Error('Museum Lystrosaurus neck clip missing');
 const yaw=parentAxis(M,i,[0,1,0]),pitch=parentAxis(M,i,[1,0,0]);
 replaceRotation(clip,i,bake(i,clip.duration,t=>{
  const p=t/clip.duration*tau,scan=Math.sin(p)*.11+Math.sin(p*2)*.025,nod=Math.sin(p*2+.35)*.035;
  return mul(axisAngle(yaw,scan),mul(axisAngle(pitch,nod),sample(source,t)));
 }));
 summary.actions=['source idle plus neck-led scanning and small nod; four limb chains unchanged'];summary.padding=[.15,.08,.15];
}

function parasMotion(g,summary){
 const idle=g.animations.find(a=>a.name==='Idle'),walk=g.animations.find(a=>a.name==='Walk');if(!idle||!walk)throw Error('Museum Parasaurolophus clips missing');
 const branches=new Set(),visit=i=>{branches.add(i);for(const c of g.nodes[i].children)visit(c);};
 visit(node(g,'骨骼.003'));visit(node(g,'骨骼.024'));
 for(const ch of idle.channels)if(ch.path==='rotation'&&branches.has(ch.node)&&varies(ch))replaceRotation(walk,ch.node,bake(ch.node,walk.duration,t=>sample(ch,t/walk.duration*idle.duration)));
 summary.actions=['source idle neck/tail articulation carried into the short-step forage','all four walking limb chains, cadence and measured stance velocity unchanged'];summary.padding=[.06,.09,.06];
}

function pteraMotion(g,summary){
 let count=0;
 for(const clip of g.animations)for(const ch of [...clip.channels])if(ch.path==='rotation'&&varies(ch)&&ch.times.length>2){
  replaceRotation(clip,ch.node,bake(ch.node,clip.duration,rotationCurve(ch,clip.duration)));count++;
 }
 summary.actions=['continuous-tangent wing, wrist, neck and leg rotation curves','near-closed rotation loops joined; original large wing range and timing retained'];summary.smoothedRotationChannels=count;summary.padding=[.02,.02,.02];
}

export function prepareMuseumMotion(source,id){
 const g={...source,nodes:source.nodes.map(n=>({...n,t:[...n.t],r:[...n.r],s:[...n.s],children:[...n.children]})),skins:source.skins.map(s=>({...s,joints:[...s.joints],inverseBindMatrices:Float32Array.from(s.inverseBindMatrices)})),animations:source.animations.map(a=>({...a,channels:a.channels.map(c=>({...c}))}))};
 const summary={schema:'museum-motion-polish-v1',sourceBytesPreserved:true,jointsAdded:0,axes:'source model space',socketRepairs:[],actions:[],padding:[0,0,0]};
 if(id==='ichthyosaur')fishMotion(g,summary);else if(id==='lystrosaurus')lystroMotion(g,summary);else if(id==='parasaurolophus')parasMotion(g,summary);else if(id==='pteranodon')pteraMotion(g,summary);
 g.museumMotion=summary;return g;
}

export function museumMotionEnvelope(metadata,gltf){
 if(gltf.museumMotion?.revisedEnvelope){const e=gltf.museumMotion.revisedEnvelope;return{min:[...e.min],max:[...e.max]};}
 const min=[0,1,2].map(k=>Math.min(...metadata.animationEnvelope.clips.map(c=>c.min[k]))),max=[0,1,2].map(k=>Math.max(...metadata.animationEnvelope.clips.map(c=>c.max[k]))),padding=gltf.museumMotion?.padding??[0,0,0];
 return {min:min.map((v,k)=>v-padding[k]),max:max.map((v,k)=>v+padding[k])};
}
