import { farCellTopology } from './far-surface'
import { attachSurfaceAttributes } from './materials/surface-attributes'
import { BufferAttribute, BufferGeometry, DataTexture, RedFormat, UnsignedByteType, Vector2, Group, Mesh, MeshStandardMaterial, type Material } from 'three'
import type { Address, WorldSampler } from './world'
import type { FrameWorkBudget } from './frame-work-budget'
interface Strip { key:string;x:number;z:number;half:number;inner:number;cx:number;cz:number;geometry:BufferGeometry;mesh:Mesh }
interface Build { key:string;x:number;z:number;half:number;inner:number;cx:number;cz:number;row:number;cols:number;positions:number[];normals:number[];colors:number[];indices:number[] }
/** Far-only 64m strips. World-aligned, bounded and incrementally prepared; never collision data. */
export class FarTerrain {
 readonly root=new Group()
 readonly material=new MeshStandardMaterial({vertexColors:true,roughness:1})
 readonly metrics={strips:0,vertices:0,triangles:0,bytes:0,pending:0,preparedRows:0,uploadBytes:0}
 private readonly coverage=new DataTexture(new Uint8Array(17*17),17,17,RedFormat,UnsignedByteType)
 private readonly coverageOrigin={value:new Vector2()}
 private readonly localOrigin={value:new Vector2()}
 private coverageSignature=''
 setNearCoverage(addresses:readonly Address[]){
  const sorted=addresses.map(a=>`${a.x},${a.z}`).sort(),signature=sorted.join(';');if(signature===this.coverageSignature)return;this.coverageSignature=signature
  const data=this.coverage.image.data as Uint8Array;data.fill(0)
  if(addresses.length){const x=Math.min(...addresses.map(a=>a.x)),z=Math.min(...addresses.map(a=>a.z));this.coverageOrigin.value.set(x*512,z*512);for(const a of addresses){const dx=a.x-x,dz=a.z-z;if(dx<17&&dz<17)data[dz*17+dx]=255}}
  this.coverage.needsUpdate=true
 }
 private strips=new Map<string,Strip>()
 private build:Build|null=null
 private origin:Address={x:0,z:0}
 constructor(private readonly world:WorldSampler,decorate:(material:Material)=>void){
  this.coverage.generateMipmaps=false;this.coverage.needsUpdate=true;decorate(this.material)
  const compile=this.material.onBeforeCompile.bind(this.material)
  this.material.onBeforeCompile=(shader,renderer)=>{
   compile(shader,renderer);Object.assign(shader.uniforms,{nearCoverage:{value:this.coverage},nearCoverageOrigin:this.coverageOrigin,farLocalOrigin:this.localOrigin})
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform vec2 farLocalOrigin; varying vec2 farWorldXZ;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nfarWorldXZ=(modelMatrix*vec4(transformed,1.0)).xz+farLocalOrigin;')
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform sampler2D nearCoverage; uniform vec2 nearCoverageOrigin; varying vec2 farWorldXZ;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nvec2 nearUV=(floor((farWorldXZ-nearCoverageOrigin)/512.0)+.5)/17.0; if(all(greaterThanEqual(nearUV,vec2(0.0)))&&all(lessThan(nearUV,vec2(1.0)))&&texture2D(nearCoverage,nearUV).r>.5)discard;')
  }
  this.material.customProgramCacheKey=()=> 'far-terrain-coverage-cut-v1'
 }
 update(x:number,z:number,range:number,nearRange:number,budget:FrameWorkBudget){
  this.metrics.preparedRows=0;this.metrics.uploadBytes=0
  const half=Math.ceil(range/512)*512,cx=Math.floor(x/512)*512,cz=Math.floor(z/512)*512,inner=Math.max(512,nearRange-512)
  const wanted=new Map<string,{x:number;z:number}>()
  // The baked inner hole depends on cz as well as row: retained rows must rebuild after north/south movement.
  for(let row=cz-half;row<cz+half;row+=512)wanted.set(`${cx-half}:${row}:${half}:${inner}:${cz}`,{x:cx-half,z:row})
  if(this.build&&!wanted.has(this.build.key))this.build=null
  if(!this.build){const next=[...wanted].filter(([key])=>!this.strips.has(key)).sort((a,b)=>Math.abs(a[1].z-z)-Math.abs(b[1].z-z))[0]
   if(next){const cols=half*2/64+1,count=cols*9;void count;this.build={key:next[0],...next[1],half,inner,cx,cz,row:0,cols,positions:[],normals:[],colors:[],indices:[]}}
  }
  const build=this.build
  if(build&&build.row<8&&budget.canStart(.1))budget.measure('farTerrain.prepare',()=>{
   const r=build.row,wz=build.z+r*64
   for(let c=0;c<build.cols-1;c++){
    const wx=build.x+c*64
    if(Math.max(Math.abs(wx+32-build.cx),Math.abs(wz+32-build.cz))<build.inner)continue
    const topology=farCellTopology(this.world,wx,wz),xz=topology.xz,offset=build.positions.length/3,count=xz.length/2
    for(let v=0;v<count;v++){
      const x=wx+xz[v*2]!,z=wz+xz[v*2+1]!,t=this.world.terrainAt(x,z),n=this.world.normalAt(x,z)
      build.positions.push(x-build.x,t.height,z-build.z);build.normals.push(...n)
      const rock=Math.min(1,Math.max(0,(1-n[1])*3.8+t.canyonWeight*.35)),sand=Math.max(0,1-Math.abs(t.height-3)/22),green=[.16+t.moisture*.035,.24+t.moisture*.065,.12+t.moisture*.015],stone=[.42,.37,.29],beach=[.58,.51,.36]
      for(let k=0;k<3;k++)build.colors.push((green[k]!*(1-rock)+stone[k]!*rock)*(1-sand)+beach[k]!*sand)
    }
    for(const index of topology.indices)build.indices.push(offset+index)
   }
   build.row++;this.metrics.preparedRows=1
  })
  if(build&&build.row===8&&budget.canStart(.1,build.positions.length*4*3+build.indices.length*2,1))budget.measure('farTerrain.install',()=>{
   const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(build.positions),3));geometry.setAttribute('normal',new BufferAttribute(new Float32Array(build.normals),3));geometry.setAttribute('color',new BufferAttribute(new Float32Array(build.colors),3));geometry.setIndex(build.indices);geometry.computeBoundingBox();geometry.computeBoundingSphere()
   attachSurfaceAttributes(geometry,this.world,build.x,build.z)
   const mesh=new Mesh(geometry,this.material);mesh.position.set(build.x-this.origin.x,0,build.z-this.origin.z);this.root.add(mesh)
   // A completed strip replaces the same world row; never remove its only fallback first.
   for(const [key,old] of this.strips)if(old.z===build.z){old.mesh.removeFromParent();old.geometry.dispose();this.strips.delete(key)}
   this.strips.set(build.key,{...build,geometry,mesh});this.build=null;this.metrics.uploadBytes=build.positions.length*4*3+build.indices.length*2
  },build.positions.length*4*3+build.indices.length*2,1)
  // One bounded retirement per update, after leaving the far coverage plus one guard strip.
  for(const [key,strip] of this.strips)if(strip.z<cz-half-512||strip.z>=cz+half+512){strip.mesh.removeFromParent();strip.geometry.dispose();this.strips.delete(key);break}
  this.metrics.strips=this.strips.size;this.metrics.pending=[...wanted.keys()].filter(key=>!this.strips.has(key)).length
  this.metrics.vertices=0;this.metrics.triangles=0;this.metrics.bytes=0
  for(const strip of this.strips.values()){this.metrics.vertices+=strip.geometry.getAttribute('position').count;this.metrics.triangles+=(strip.geometry.index?.count??0)/3;this.metrics.bytes+=Object.values(strip.geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(strip.geometry.index?.array.byteLength??0)}
 }
 /** Published cells only, including retained strips while replacements are building. */
 get coveredChunks(): Address[] {
  const cells=new Map<string,Address>()
  for(const strip of this.strips.values())for(let x=strip.x;x<strip.x+strip.half*2;x+=512){
   if(Math.max(Math.abs(x+256-strip.cx),Math.abs(strip.z+256-strip.cz))<strip.inner)continue
   const cell={x:x/512,z:strip.z/512};cells.set(`${cell.x},${cell.z}`,cell)
  }
  return [...cells.values()]
 }
 relocate(origin:Address){this.origin={...origin};this.localOrigin.value.set(origin.x,origin.z);for(const strip of this.strips.values())strip.mesh.position.set(strip.x-origin.x,0,strip.z-origin.z)}
 dispose(){for(const strip of this.strips.values())strip.geometry.dispose();this.strips.clear();this.build=null;this.coverage.dispose();this.material.dispose();this.root.clear();this.root.removeFromParent()}
}
