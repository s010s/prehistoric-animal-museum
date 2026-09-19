import type { TerrainResult } from './terrain-protocol'
import { clamp, type Lod } from './world'
export const TERRAIN_PATCH_SIZE=128
export const MAX_PATCHES_PER_TILE=16
export const TOPOLOGY_VERSION='nested-bisection-32-cells-v3'
export const topologyLayoutId=(lod:Lod)=>`${TOPOLOGY_VERSION}:lod${lod}`
export interface TerrainTopology {id:string;level:number;verticesPerPatch:number;trianglesPerPatch:number;xz:Float32Array;indices:Uint16Array;nodes:Int16Array}
interface Face {a:number;b:number;c:number;node:number}
const cache=new Map<Lod,TerrainTopology>()
let builds=0
const coordinates:number[]=[],vertexIds=new Map<string,number>(),faces=new Map<number,Face>(),nodes:number[]=[]
function vertex(x:number,z:number){const key=`${x},${z}`,old=vertexIds.get(key);if(old!==undefined)return old;const id=coordinates.length/2;coordinates.push(x,z);vertexIds.set(key,id);return id}
function addFace(a:number,b:number,c:number){const node=nodes.length/4;nodes.push(-1,-1,-1,-1);faces.set(node,{a,b,c,node});return node}
// Sixteen bounded-aspect parent cells replace the long radial fan. Every level
// retains the same 8m patch perimeter, while no root edge spans the whole patch.
function initialize(){
 if(nodes.length)return
 for(let z=0;z<4;z++)for(let x=0;x<4;x++){
  const ox=x*32,oz=z*32,center=vertex(ox+16,oz+16)
  const ring=(i:number):[number,number]=>{const side=Math.floor(i/4)%4,t=i%4*8;return side===0?[ox,oz+t]:side===1?[ox+t,oz+32]:side===2?[ox+32,oz+32-t]:[ox+32-t,oz]}
  for(let i=0;i<16;i++){const a=ring(i),b=ring((i+1)%16);addFace(center,vertex(a[0],a[1]),vertex(b[0],b[1]))}
 }
}
function refine(maxLength:number){
  type Edge={u:number;v:number;length:number;key:string}
  const incident=new Map<string,Set<number>>(),heap:Edge[]=[]
  const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`
  const greater=(a:Edge,b:Edge)=>a.length>b.length || a.length===b.length&&a.key<b.key
  const push=(e:Edge)=>{heap.push(e);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(!greater(heap[i]!,heap[p]!))break;[heap[i],heap[p]]=[heap[p]!,heap[i]!];i=p}}
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){let n=i;for(const c of [i*2+1,i*2+2])if(c<heap.length&&greater(heap[c]!,heap[n]!))n=c;if(n===i)break;[heap[n],heap[i]]=[heap[i]!,heap[n]!];i=n}}return first}
  const edges=(f:Face)=>[[f.a,f.b],[f.b,f.c],[f.c,f.a]] as const
  const register=(f:Face)=>{for(const [u,v] of edges(f)){const k=key(u,v);let set=incident.get(k);if(!set){set=new Set();incident.set(k,set);const length=(coordinates[u*2]!-coordinates[v*2]!)**2+(coordinates[u*2+1]!-coordinates[v*2+1]!)**2;if(length>maxLength*maxLength+1e-8)push({u,v,length,key:k})}set.add(f.node)}}
  const remove=(f:Face)=>{faces.delete(f.node);for(const [u,v] of edges(f)){const k=key(u,v),set=incident.get(k)!;set.delete(f.node);if(!set.size)incident.delete(k)}}
  for(const f of faces.values())register(f)
  while(heap.length){
    const {u,v,key:k}=pop(),set=incident.get(k);if(!set)continue
    const neighbors=[...set].map(id=>faces.get(id)!),middle=vertex((coordinates[u*2]!+coordinates[v*2]!)/2,(coordinates[u*2+1]!+coordinates[v*2+1]!)/2)
    for(const f of neighbors){
      remove(f);let edge:number,left:number,right:number
      if((f.a===u&&f.b===v)||(f.a===v&&f.b===u)){edge=0;left=addFace(f.a,middle,f.c);right=addFace(middle,f.b,f.c)}
      else if((f.b===u&&f.c===v)||(f.b===v&&f.c===u)){edge=1;left=addFace(f.a,f.b,middle);right=addFace(f.a,middle,f.c)}
      else{edge=2;left=addFace(f.a,f.b,middle);right=addFace(middle,f.b,f.c)}
      nodes[f.node*4]=edge;nodes[f.node*4+1]=left;nodes[f.node*4+2]=right
      register(faces.get(left)!);register(faces.get(right)!)
    }
  }
}
/** Worker-built conforming hierarchy; main-thread queries use the returned compact nodes. */
export function terrainTopology(lod:Lod):TerrainTopology{
  const existing=cache.get(lod);if(existing)return existing
  initialize()
  if(lod<3){terrainTopology((lod+1) as Lod);refine([8,12,16,Infinity][lod]!)}
  const indices:number[]=[],snapshot=nodes.slice()
  for(const face of faces.values()){snapshot[face.node*4+3]=indices.length/3;indices.push(face.a,face.b,face.c)}
  const result={id:topologyLayoutId(lod),level:3-lod,verticesPerPatch:coordinates.length/2,trianglesPerPatch:indices.length/3,xz:new Float32Array(coordinates),indices:new Uint16Array(indices),nodes:new Int16Array(snapshot)}
  cache.set(lod,result);builds++;return result
}
export function topologyDiagnostics(){return {layouts:cache.size,builds}}
/** Allocation-free lookup: one analytic parent fan and bounded binary descent. */
export function locateTerrainTriangle(lod:Lod,x:number,z:number,output:Float64Array,indices?:Uint16Array,verticesPerPatch?:number,patchIndex?:number,nodeTable?:Int16Array){
  const px=patchIndex===undefined?clamp(Math.floor(x/128),0,3):patchIndex%4,pz=patchIndex===undefined?clamp(Math.floor(z/128),0,3):Math.floor(patchIndex/4)
  const patchX=clamp(x-px*128,0,128),patchZ=clamp(z-pz*128,0,128)
  const cellX=Math.min(3,Math.floor(patchX/32)),cellZ=Math.min(3,Math.floor(patchZ/32))
  const lx=patchX-cellX*32,lz=patchZ-cellZ*32,dx=lx-16,dz=lz-16
  let side:number,t:number
  if(Math.abs(dx)>=Math.abs(dz)&&dx!==0){side=dx<0?0:2;t=dx<0?16+dz*16/-dx:16-dz*16/dx}
  else if(dz!==0){side=dz>0?1:3;t=dz>0?16+dx*16/dz:16-dx*16/-dz}
  else{side=0;t=0}
  const segment=clamp(Math.floor(t/8),0,3),v=segment*8
  let bx:number,bz:number,cx:number,cz:number
  if(side===0){bx=0;bz=v;cx=0;cz=v+8}else if(side===1){bx=v;bz=32;cx=v+8;cz=32}else if(side===2){bx=32;bz=32-v;cx=32;cz=24-v}else{bx=32-v;bz=0;cx=24-v;cz=0}
  const denominator=(bz-cz)*(16-cx)+(cx-bx)*(16-cz)
  let a=((bz-cz)*(lx-cx)+(cx-bx)*(lz-cz))/denominator,b=((cz-16)*(lx-cx)+(16-cx)*(lz-cz))/denominator,c=1-a-b,node=(cellZ*4+cellX)*16+side*4+segment
  const topology=cache.get(lod),table=nodeTable??topology?.nodes
  if(!table)throw new Error('Terrain topology missing')
  for(let depth=0;depth<32;depth++){
    const edge=table[node*4]!
    if(edge<0)break
    if(edge===0){if(a>=b){node=table[node*4+1]!;a-=b;b*=2}else{node=table[node*4+2]!;b-=a;a*=2}}
    else if(edge===1){if(b>=c){node=table[node*4+1]!;b-=c;c*=2}else{node=table[node*4+2]!;c-=b;b*=2}}
    else if(a>=c){node=table[node*4+1]!;a-=c;c*=2}else{node=table[node*4+2]!;c-=a;a*=2}
  }
  const triangle=table[node*4+3]!,patch=pz*4+px
  if(indices&&verticesPerPatch){const perTriangles=indices.length/3/(patchIndex===undefined?16:1),index=((patch-(patchIndex??0))*perTriangles+triangle)*3;output[0]=indices[index]!;output[1]=indices[index+1]!;output[2]=indices[index+2]!}
  else{if(!topology)throw new Error('Terrain topology missing');const offset=patch*topology.verticesPerPatch,index=triangle*3;output[0]=offset+topology.indices[index]!;output[1]=offset+topology.indices[index+1]!;output[2]=offset+topology.indices[index+2]!}
  output[3]=a;output[4]=b;output[5]=c
}
export function groupTerrainPatches(result:TerrainResult){const count=result.indices.length/16;return {indices:result.indices,groups:Array.from({length:16},(_,i)=>({start:i*count,count,materialIndex:0}))}}
export function patchBlend(_x:number,_z:number,progress:number){return clamp(progress,0,1)}
