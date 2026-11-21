// Static salt-spray and wash exposure for ordinary shores. Start with the
// shelf's ocean flood, then refill the collar against the finished terrain.
import {smooth} from './ContinuousSample.js';

const STEP=16, COLLAR=112, REACH=96;
const SWASH_BASE=1.22, SWASH_EXPOSURE=1.08, POCKET=.22;
const RECOVERY=2.55, RECOVERY_EXPOSURE=1.15, FULL_PRESENCE=.94;
const uv=(v,origin,step)=>(v-origin)/step-.5;
const wgsl=v=>v.toFixed(3);

export function strandGrowthLimits(rise, exposure, pocket) {
 const low=SWASH_BASE+exposure*SWASH_EXPOSURE+pocket*POCKET;
 return {low,growth:smooth(low,low+RECOVERY+exposure*RECOVERY_EXPOSURE,rise)};
}

export function buildStrandGrowth(data, shoreField) {
 const started=performance.now();
 const {terrain,island,cove:{continuous:shelf}}=data;
 const {size,maskRes:res,seaLevel}=island,origin=-size/2;
 const fineRes=size/STEP,maskStep=size/res,cell=(i,j)=>j*fineRes+i;
 const dry=1,pending=2,wet=3;
 const collar=new Map(),queue=[],field=[0,0,0,0];
 const snapped=COLLAR/STEP;
 for(const {point:[x,z]} of shelf.segments) {
  const i=Math.round(uv(x,origin,STEP)),j=Math.round(uv(z,origin,STEP));
  for(let j1=Math.max(0,j-snapped);j1<=Math.min(fineRes-1,j+snapped);j1++) {
   for(let i1=Math.max(0,i-snapped);i1<=Math.min(fineRes-1,i+snapped);i1++) {
    const k=cell(i1,j1);
    if(collar.has(k)) continue;
    const sx=origin+(i1+.5)*STEP,sz=origin+(j1+.5)*STEP;
    const h=terrain.heightAt(sx,sz);
    let state=h>=seaLevel?dry:pending;
    if(state===pending && shelf.marineAt(sx,sz)>=.96) {state=wet;queue.push(k);}
    collar.set(k,state);
   }
  }
 }
 function neighbours(k,fn) {
  const i=k%fineRes;
  if(i>0) fn(k-1);
  if(i<fineRes-1) fn(k+1);
  if(k>=fineRes) fn(k-fineRes);
  if(k<fineRes*(fineRes-1)) fn(k+fineRes);
 }
 function flood(k) {
  if(collar.get(k)!==pending) return;
  collar.set(k,wet);
  queue.push(k);
 }
 for(let q=0;q<queue.length;q++) neighbours(queue[q],flood);

 const nearest=new Map(),bytes=new Uint8Array(res*res*2);
 for(const k of queue) {
  let edge=false;
  neighbours(k,key=>{edge ||= collar.get(key)===dry;});
  if(!edge) continue;
  const x=origin+(k%fineRes+.5)*STEP,z=origin+(Math.floor(k/fineRes)+.5)*STEP;
  shoreField?.sampleAt(x,z,field);
  const energy=Math.hypot(field[1],field[2])*1.4;
  // The propagation front may be unresolved where a submerged bar and the
  // upper beach share a coarse cell. Use a modest wind-sea floor there.
  const exposure=energy>0?Math.max(.22,Math.min(1,energy)):.42;
  const loX=Math.max(0,Math.ceil(uv(x-REACH,origin,maskStep)));
  const hiX=Math.min(res-1,Math.floor(uv(x+REACH,origin,maskStep)));
  const loZ=Math.max(0,Math.ceil(uv(z-REACH,origin,maskStep)));
  const hiZ=Math.min(res-1,Math.floor(uv(z+REACH,origin,maskStep)));
  for(let j=loZ;j<=hiZ;j++) for(let i=loX;i<=hiX;i++) {
   const dx=origin+(i+.5)*maskStep-x,dz=origin+(j+.5)*maskStep-z;
   const squared=dx*dx+dz*dz,o=j*res+i;
   if(squared>=REACH**2 || squared>=(nearest.get(o)??Infinity)) continue;
   nearest.set(o,squared);
   const presence=1-smooth(43,REACH,Math.sqrt(squared));
   bytes[o*2]=Math.round(presence*255);
   bytes[o*2+1]=Math.round(presence*exposure*255);
  }
 }
 function sampleAt(x,z) {
  const u=Math.max(0,Math.min(res-1.001,uv(x,origin,maskStep))),v=Math.max(0,Math.min(res-1.001,uv(z,origin,maskStep)));
  const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,o=(j*res+i)*2;
  const sample=c=>((bytes[o+c]*(1-a)+bytes[o+2+c]*a)*(1-b)+(bytes[o+res*2+c]*(1-a)+bytes[o+res*2+2+c]*a)*b)/255;
  const presence=sample(0);
  return {presence:smooth(.015,FULL_PRESENCE,presence),exposure:presence>0?sample(1)/presence:0};
 }
 return {
  bytes,res,sampleAt,
  stats:{collarCells:collar.size,wetCells:queue.length,coastalTexels:nearest.size,uploadBytes:bytes.byteLength,buildMs:performance.now()-started},
  // Shader noise breaks the first returning plants into sheltered pockets.
  wgsl:`
fn museumStrandExposureAt(p:vec2f)->vec2f{
 let coast=textureSampleLevel(museumStrandExposure,smpLinearClamp,(p+${wgsl(-origin)})/${wgsl(size)},0.0).rg;
 return vec2f(smoothstep(.015,${wgsl(FULL_PRESENCE)},coast.r),clamp(coast.g/max(coast.r,.001),0.0,1.0));
}
fn museumStrandGrowth(p:vec2f,rise:f32,cover:f32)->vec2f{
 if(cover<=.001){return vec2f(1.0,-1000.0);}
 let coast=museumStrandExposureAt(p);
 let influence=coast.x*cover;
 if(influence<=.001){return vec2f(1.0,-1000.0);}
 let exposure=coast.y;
 let pocket=clamp(perlin2(p/19.5)*.65+perlin2(p/7.6+17.3)*.30,-1.0,1.0);
 let low=${wgsl(SWASH_BASE)}+exposure*${wgsl(SWASH_EXPOSURE)}+pocket*${wgsl(POCKET)};
 let growth=smoothstep(low,low+${wgsl(RECOVERY)}+exposure*${wgsl(RECOVERY_EXPOSURE)},rise);
 let rootFloor=select(-1000.0,frame.seaLevel+low,influence>.98);
 return vec2f(mix(1.0,growth,influence),rootFloor);
}
`,
 };
}
