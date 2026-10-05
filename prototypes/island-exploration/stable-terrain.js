import {regionWeight,regionPathDistance} from './sample-region.js'
import {trailX} from './habitat.js'
import {forestSpring} from './spring.js'
import {SIZE,terrainHeight,riverX,halfWidth,tributaryX,waterLevelAt} from './field.js'
import {surfaceSample} from './surface-sample.js'
import {buildReflectionRange} from './reflection-range.js'
import {buildReflectionTiles} from './reflection-tiles.js'
const ROOT=64,CHUNK=2048,N=SIZE/ROOT
// The tessellation belongs to the island, never to a moving camera. Flat sea
// retains a coarse grid; channels, shorelines and crags get fixed fine cells.
export function buildStableTerrain({reflection=false}={}){
 const steps=new Float32Array(N*N),contacts=new Uint8Array(N*N),H=SIZE/2
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const x=i*ROOT-H,z=j*ROOT-H,cx=x+32,cz=z+32,h=terrainHeight(cx,cz),corners=[terrainHeight(x,z),terrainHeight(x+64,z),terrainHeight(x,z+64),terrainHeight(x+64,z+64)],lo=Math.min(h,...corners),hi=Math.max(h,...corners)
  const channel=(cz>-4096&&cz<4416&&Math.abs(cx-riverX(cz))<halfWidth(cz)+128)||(cz>0&&cz<5824&&Math.abs(cx-tributaryX(cz))<146)
  const crag=cz>-1600&&cz<256&&cx>riverX(cz)-600&&cx<riverX(cz)-70
  const error=Math.abs(h-(corners[1]+corners[2])*.5)
  const shore=waterLevelAt(cx,cz),inlandShore=shore>1&&lo<shore+2&&hi>shore-2;
  const walking=cz> -1664&&cz<384&&Math.abs(cx-trailX(cz))<48;
  const galleryRiver=cz> -1664&&cz<384&&Math.abs(cx-riverX(cz))<halfWidth(cz)+30;
  const forestSource=cz>-768&&cz<-640&&cx>forestSpring.x-32&&cx<forestSpring.x+64;
  const source=(cz>-4096&&cz<-3904&&Math.abs(cx-riverX(cz))<96)||(cz>-768&&cz<-640&&cx>forestSpring.x-32&&cx<forestSpring.x+64);
  const regionWalking=regionWeight(cx,cz)>0&&regionPathDistance(cx,cz)<48;
  steps[j*N+i]=forestSource?.5:regionWalking?1:source?1:crag?4:walking?2:galleryRiver?4:inlandShore?4:(Math.abs(cx-9160)<420&&Math.abs(cz-2330)<420&&hi>-5&&lo<9)?2:(cz>-3200&&cz< -850&&cx> -2810&&cx< -2200)?4:channel||crag||(cz>-3200&&cz< -850&&cx> -2720&&cx< -2310)||(lo<5&&hi>-5)||hi>650?8:hi<-8?64:(hi-lo<10&&error<.5?32:16)
  // Fixed reflection-only tessellation. Keep the original source and every
  // root cell intersecting a water level, including coastal wave contact.
  // Main geometry, material attributes and collision indexing stay untouched.
  const contact=source||channel||inlandShore||(lo<5&&hi>-5)||(Math.abs(cx-9160)<420&&Math.abs(cz-2330)<420&&hi>-5&&lo<9);
  contacts[j*N+i]=contact?1:0;
 }
 // One root-cell halo keeps the contact cells' stitched boundary rings exact.
 if(reflection)for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  let contact=false;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(i+dx>=0&&i+dx<N&&j+dz>=0&&j+dz<N&&contacts[(j+dz)*N+i+dx])contact=true;
  if(!contact)steps[j*N+i]=Math.max(steps[j*N+i],32);
 }
 const at=(i,j)=>i<0||j<0||i>=N||j>=N?64:steps[j*N+i],chunks=[]
 for(let cz=-H;cz<H;cz+=CHUNK)for(let cx=-H;cx<H;cx+=CHUNK){
  const p=[],n=[],w=[],shade=[],water=[],coast=[],seepWet=[],indices=[],ids=new Map()
  function vertex(x,z){const key=`${x},${z}`;if(ids.has(key))return ids.get(key);const id=p.length/3,s=surfaceSample(x,z);ids.set(key,id);p.push(x,s[0],z);n.push(...s.slice(1,4));w.push(...s.slice(4,7));shade.push(s[7]);water.push(s[8]);coast.push(s[9]);seepWet.push(s[10]);return id}
  for(let z=cz;z<cz+CHUNK;z+=ROOT)for(let x=cx;x<cx+CHUNK;x+=ROOT){const i=(x+H)/ROOT,j=(z+H)/ROOT,s=at(i,j)
   for(let dz=0;dz<ROOT;dz+=s)for(let dx=0;dx<ROOT;dx+=s){
    const ax=x+dx,az=z+dz,edges=[[ax,az,0,s,dx===0?Math.min(s,at(i-1,j)):s],[ax,az+s,s,0,dz+s===ROOT?Math.min(s,at(i,j+1)):s],[ax+s,az+s,0,-s,dx+s===ROOT?Math.min(s,at(i+1,j)):s],[ax+s,az,-s,0,dz===0?Math.min(s,at(i,j-1)):s]],ring=[]
    for(const[ex,ez,vx,vz,step]of edges)for(let k=0;k<s/step;k++)ring.push(vertex(ex+vx*k*step/s,ez+vz*k*step/s))
    if(ring.length===4)indices.push(ring[0],ring[1],ring[3],ring[1],ring[2],ring[3]);else{const mid=vertex(ax+s/2,az+s/2);for(let k=0;k<ring.length;k++)indices.push(mid,ring[k],ring[(k+1)%ring.length])}
   }
  }
  chunks.push({cx,cz,p:new Float32Array(p),n:new Float32Array(n),w:new Float32Array(w),shade:new Float32Array(shade),water:new Float32Array(water),coast:new Float32Array(coast),seepWet:new Float32Array(seepWet),indices:new Uint32Array(indices)})
 }
 chunks.audit={stepRoots:Object.fromEntries([.5,1,2,4,8,16,32,64].map(s=>[s,steps.reduce((n,v)=>n+(v===s?1:0),0)])),contactRoots:contacts.reduce((n,v)=>n+v,0),reflectionMinimumMetres:reflection?32:null};
 return chunks
}
if(typeof self!=='undefined'&&typeof document==='undefined'){self.onmessage=()=>{const chunks=buildStableTerrain(),proxy=buildStableTerrain({reflection:true}),reflectionChunks=proxy.map((r,i)=>r.indices.length===chunks[i].indices.length?null:r);const reflectionRanges=chunks.map((r,i)=>buildReflectionRange((reflectionChunks[i]??r).indices,(reflectionChunks[i]??r).p));for(let i=0;i<reflectionChunks.length;i++)if(reflectionChunks[i]&&reflectionRanges[i])reflectionChunks[i].indices=reflectionRanges[i].indices;const reflectionTiles=chunks.map((r,i)=>buildReflectionTiles(reflectionRanges[i]?.indices??(reflectionChunks[i]??r).indices,(reflectionChunks[i]??r).p));const mainTiles=chunks.map(r=>buildReflectionTiles(r.indices,r.p));const buffers=[...new Set([...chunks,...reflectionChunks.filter(Boolean)].flatMap(r=>[r.p.buffer,r.n.buffer,r.w.buffer,r.shade.buffer,r.water.buffer,r.coast.buffer,r.seepWet.buffer,r.indices.buffer]).concat(reflectionRanges.filter(Boolean).flatMap(r=>[r.indices.buffer,r.heights.buffer,r.starts.buffer]).concat([...reflectionTiles,...mainTiles].flatMap(cells=>(cells??[]).flatMap(c=>[c.indices.buffer,c.bounds.buffer,c.range.heights.buffer,c.range.starts.buffer])))))];self.postMessage({chunks,reflectionChunks,reflectionRanges,reflectionTiles,mainTiles,terrainAudit:{main:chunks.audit,proxy:proxy.audit}},buffers)};self.postMessage({ready:true})}
