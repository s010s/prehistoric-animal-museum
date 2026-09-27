import {SIZE,terrainHeight,riverX,halfWidth,tributaryX} from './field.js'
import {surfaceSample} from './surface-sample.js'
const ROOT=64,CHUNK=2048,N=SIZE/ROOT
// The tessellation belongs to the island, never to a moving camera. Flat sea
// retains a coarse grid; channels, shorelines and crags get fixed fine cells.
export function buildStableTerrain(){
 const steps=new Uint8Array(N*N),H=SIZE/2
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const x=i*ROOT-H,z=j*ROOT-H,cx=x+32,cz=z+32,h=terrainHeight(cx,cz),corners=[terrainHeight(x,z),terrainHeight(x+64,z),terrainHeight(x,z+64),terrainHeight(x+64,z+64)],lo=Math.min(h,...corners),hi=Math.max(h,...corners)
  const channel=(cz>-4096&&cz<4416&&Math.abs(cx-riverX(cz))<halfWidth(cz)+128)||(cz>0&&cz<5824&&Math.abs(cx-tributaryX(cz))<146)
  const crag=cz>-1600&&cz<256&&cx>riverX(cz)-600&&cx<riverX(cz)-70
  const error=Math.abs(h-(corners[1]+corners[2])*.5)
  steps[j*N+i]=channel||crag||(cz>-3200&&cz< -850&&cx> -2720&&cx< -2310)||(lo<5&&hi>-5)||hi>650?8:hi<-8?64:(hi-lo<10&&error<.5?32:16)
 }
 const at=(i,j)=>i<0||j<0||i>=N||j>=N?64:steps[j*N+i],chunks=[]
 for(let cz=-H;cz<H;cz+=CHUNK)for(let cx=-H;cx<H;cx+=CHUNK){
  const p=[],n=[],w=[],shade=[],water=[],indices=[],ids=new Map()
  function vertex(x,z){const key=`${x},${z}`;if(ids.has(key))return ids.get(key);const id=p.length/3,s=surfaceSample(x,z);ids.set(key,id);p.push(x,s[0],z);n.push(...s.slice(1,4));w.push(...s.slice(4,7));shade.push(s[7]);water.push(s[8]);return id}
  for(let z=cz;z<cz+CHUNK;z+=ROOT)for(let x=cx;x<cx+CHUNK;x+=ROOT){const i=(x+H)/ROOT,j=(z+H)/ROOT,s=at(i,j)
   for(let dz=0;dz<ROOT;dz+=s)for(let dx=0;dx<ROOT;dx+=s){
    const ax=x+dx,az=z+dz,edges=[[ax,az,0,s,dx===0?Math.min(s,at(i-1,j)):s],[ax,az+s,s,0,dz+s===ROOT?Math.min(s,at(i,j+1)):s],[ax+s,az+s,0,-s,dx+s===ROOT?Math.min(s,at(i+1,j)):s],[ax+s,az,-s,0,dz===0?Math.min(s,at(i,j-1)):s]],ring=[]
    for(const[ex,ez,vx,vz,step]of edges)for(let k=0;k<s/step;k++)ring.push(vertex(ex+vx*k*step/s,ez+vz*k*step/s))
    if(ring.length===4)indices.push(ring[0],ring[1],ring[3],ring[1],ring[2],ring[3]);else{const mid=vertex(ax+s/2,az+s/2);for(let k=0;k<ring.length;k++)indices.push(mid,ring[k],ring[(k+1)%ring.length])}
   }
  }
  chunks.push({cx,cz,p:new Float32Array(p),n:new Float32Array(n),w:new Float32Array(w),shade:new Float32Array(shade),water:new Float32Array(water),indices:new Uint32Array(indices)})
 }
 return chunks
}
if(typeof self!=='undefined'&&typeof document==='undefined'){self.onmessage=()=>{const chunks=buildStableTerrain();self.postMessage({chunks},chunks.flatMap(r=>[r.p.buffer,r.n.buffer,r.w.buffer,r.shade.buffer,r.water.buffer,r.indices.buffer]))};self.postMessage({ready:true})}
