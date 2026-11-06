import {SIZE,terrainHeight,smooth,bankAt,riverLevel,noise,waterLevelAt} from './field.js'
import {farEdgeStep,farTriangle,farLayout,farIndicesForHole} from './terrain-layout.js'
export {farIndicesForHole} from './terrain-layout.js'

// Every LOD uses these same float32 vertex attributes. Borders blend to the
// parent's triangle interpolation, not only its height, so lighting stays joined.
export {surfaceSample} from './surface-sample.js'
import {surfaceSample} from './surface-sample.js'

// Remove covered cells in geometry. Stitch each fine outer border to the actual
// coarse vertices: no T-junctions, fragment-discard seams or coplanar overlap.
export function patchIndices(cx,cz,size,segments,parentStep=0,hole=null,riverAware=false){
 const step=size/segments,ratio=Math.max(1,Math.round(parentStep/step)),stride=segments+1,indices=new Uint32Array(segments*segments*6);let used=0
 const snap=(v,r)=>Math.floor(v/r+.5+(v<segments/2?-1e-7:1e-7))*r
 const vertex=(ix,iz)=>{const r=riverAware?Math.max(1,farEdgeStep(cx-size/2+ix*step,cz-size/2+iz*step)/step):ratio;if(iz===0||iz===segments)ix=snap(ix,r);if(ix===0||ix===segments)iz=snap(iz,r);return iz*stride+ix}
 function triangle(a,b,c){if(a===b||b===c||c===a)return;const ax=a%stride,az=Math.floor(a/stride),bx=b%stride,bz=Math.floor(b/stride),cx=c%stride,cz=Math.floor(c/stride);if((bx-ax)*(cz-az)-(bz-az)*(cx-ax)===0)return;indices[used++]=a;indices[used++]=b;indices[used++]=c}
 for(let iz=0;iz<segments;iz++)for(let ix=0;ix<segments;ix++){
  const x=cx-size/2+(ix+.5)*step,z=cz-size/2+(iz+.5)*step
  if(hole&&Math.abs(x-hole.x)<hole.size/2&&Math.abs(z-hole.z)<hole.size/2)continue
  const a=vertex(ix,iz),b=vertex(ix,iz+1),c=vertex(ix+1,iz+1),d=vertex(ix+1,iz);triangle(a,b,d);triangle(b,c,d)
 }
 return indices.subarray(0,used)
}

export function buildPatch(cx,cz,size,segments,near=false,parentStep=64,holeSize=0,riverAware=false){
 const count=(segments+1)**2,p=new Float32Array(count*3),n=new Float32Array(count*3),w=new Float32Array(count*3),shade=new Float32Array(count),water=new Float32Array(count),step=size/segments,parentCache=new Map()
 const parent=(x,z)=>{const key=`${x},${z}`;if(!parentCache.has(key))parentCache.set(key,surfaceSample(x,z));return parentCache.get(key)}
 for(let iz=0;iz<=segments;iz++)for(let ix=0;ix<=segments;ix++){
  const i=iz*(segments+1)+ix,x=cx-size/2+ix*step,z=cz-size/2+iz*step,edge=Math.max(Math.abs(x-cx),Math.abs(z-cz))
  const blend=near?smooth(size/2-(parentStep>=32?96:24),size/2-(parentStep>=32?16:4),edge):0,s=surfaceSample(x,z)
  if(blend>0&&riverAware){const t=farTriangle(x,z),corners=t.points.map(([px,pz])=>parent(px,pz));for(let j=0;j<s.length;j++){const coarse=t.weights.reduce((sum,w,k)=>sum+w*corners[k][j],0);s[j]+=(coarse-s[j])*blend}}
  else if(blend>0){
   const gx=Math.floor(x/parentStep)*parentStep,gz=Math.floor(z/parentStep)*parentStep,u=(x-gx)/parentStep,v=(z-gz)/parentStep
   const a=parent(gx,gz),b=parent(gx+parentStep,gz),c=parent(gx,gz+parentStep),d=parent(gx+parentStep,gz+parentStep)
   for(let j=0;j<s.length;j++){const coarse=u+v<=1?a[j]+u*(b[j]-a[j])+v*(c[j]-a[j]):d[j]+(1-u)*(c[j]-d[j])+(1-v)*(b[j]-d[j]);s[j]+=(coarse-s[j])*blend}
  }
  p.set([x,s[0],z],i*3);n.set(s.slice(1,4),i*3);w.set(s.slice(4,7),i*3);shade[i]=s[7];water[i]=s[8]
 }
 return {cx,cz,size,segments,p,n,w,shade,water,indices:patchIndices(cx,cz,size,segments,near?parentStep:0,holeSize?{x:cx,z:cz,size:holeSize}:null,riverAware)}
}
export function buildFarTerrain(){const layout=farLayout(),count=layout.positions.length,p=new Float32Array(count*3),n=new Float32Array(count*3),w=new Float32Array(count*3),shade=new Float32Array(count),water=new Float32Array(count);for(let i=0;i<count;i++){const[x,z]=layout.positions[i],s=surfaceSample(x,z);p.set([x,s[0],z],i*3);n.set(s.slice(1,4),i*3);w.set(s.slice(4,7),i*3);shade[i]=s[7];water[i]=s[8]}return {p,n,w,shade,water,indices:layout.indices.slice(),refinedTiles:layout.refinedTiles}}
if(typeof self!=='undefined'&&typeof document==='undefined')self.onmessage=e=>{
 const [x,z,fine]=e.data,patches=[buildPatch(x,z,1024,fine?256:128,true,64,256,true),buildPatch(x,z,256,fine?256:128,true,fine?4:8)],farIndices=farIndicesForHole(x,z,1024)
 self.postMessage({patches,farIndices},[farIndices.buffer,...patches.flatMap(r=>[r.p.buffer,r.n.buffer,r.w.buffer,r.shade.buffer,r.water.buffer,r.indices.buffer])])
}
