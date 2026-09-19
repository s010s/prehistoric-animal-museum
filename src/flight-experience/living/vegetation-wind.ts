import { InstancedBufferAttribute, MeshDepthMaterial, MeshDistanceMaterial, RGBADepthPacking, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type PerspectiveCamera } from 'three'

export const VEGETATION_WIND_BOUND=.35
export function vegetationPhase(id:string){let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return (h>>>0)/4294967296*Math.PI*2}
export function vegetationWeight(y:number,root:number,height:number,tree:boolean){
 const start=root+height*(tree?.35:.12),range=height*(tree?.65:.88),t=Math.max(0,Math.min(1,(y-start)/range))
 return {weight:t*t*(3-2*t),derivative:t>0&&t<1?6*t*(1-t)/range:0}
}
/** A height-only conservative bend for baked ecology meshes: lower trunk/root stays fixed.
 * The baked atlas no longer identifies individual leaves, so fine motion is deliberately small.
 * Every LOD uses the same authored bounds and ID phase, not per-LOD geometry bounds. */
export const VEGETATION_WIND_GLSL=`
uniform float flightWindTime;uniform float flightWindStrength;
uniform vec3 flightWindCamera;uniform vec3 flightWindProfile;
attribute float flightWindPhase;
vec3 flightWindBend(float y,bool derivative){
 if(flightWindStrength<=0.)return vec3(0.);
 #ifdef USE_INSTANCING
 float scale=max(.001,length(instanceMatrix[0].xyz));
 vec3 anchor=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
 float reach=1.-smoothstep(90.,240.,distance(anchor,flightWindCamera));
 float t=clamp((y-flightWindProfile.x)/flightWindProfile.y,0.,1.);
 float weight=derivative?6.*t*(1.-t)/flightWindProfile.y:t*t*(3.-2.*t);
 float phase=flightWindPhase;
 float sway=.8*sin(flightWindTime*.65+phase)+.2*sin(flightWindTime*1.1+phase*1.7);
 float fine=.09*sin(flightWindTime*2.4+phase*2.3);
 vec3 worldBend=vec3(.9486833,0.,.3162278)*sway+vec3(-.3162278,0.,.9486833)*fine;
 // Inverse of the yaw + uniform-scale instance: displacement is metres AFTER decoding.
 vec3 localBend=vec3(dot(instanceMatrix[0].xyz,worldBend),0.,dot(instanceMatrix[2].xyz,worldBend))/(scale*scale);
 return localBend*(flightWindProfile.z*weight*flightWindStrength*reach);
 #else
 return vec3(0.);
 #endif
}
`
export function windVertexShader(source:string){
 return source.replace('#include <common>',`#include <common>\n${VEGETATION_WIND_GLSL}`)
  .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal.y-=dot(objectNormal.xz,flightWindBend(position.y,true).xz);')
  .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=flightWindBend(position.y,false);')
}
export class VegetationWind {
 readonly uniforms={flightWindTime:{value:0},flightWindStrength:{value:0},flightWindCamera:{value:new Vector3()}}
 private previousMotion:number|null=null
 update(motionSeconds:number,strength:number,camera?:PerspectiveCamera,reducedMotion=false){
  const dt=this.previousMotion===null?0:Math.max(0,motionSeconds-this.previousMotion);this.previousMotion=motionSeconds
  this.uniforms.flightWindTime.value=motionSeconds
  const target=Number.isFinite(strength)?Math.max(0,Math.min(1,strength))*(reducedMotion?.3:1):0
  const before=this.uniforms.flightWindStrength.value
  // An explicit off while paused restores the static baseline without advancing time.
  this.uniforms.flightWindStrength.value=target===0&&dt===0?0:before+Math.sign(target-before)*Math.min(Math.abs(target-before),dt*1.5)
  if(camera)this.uniforms.flightWindCamera.value.copy(camera.position)
 }
 /** Own cloned colour/depth/distance materials; textures remain stream-owned and shared. */
 decorate(source:MeshStandardMaterial,root:number,height:number,tree:boolean){
  const color=source.clone(),depth=new MeshDepthMaterial({depthPacking:RGBADepthPacking}),distance=new MeshDistanceMaterial()
  color.onBeforeCompile=source.onBeforeCompile.bind(color); color.customProgramCacheKey=source.customProgramCacheKey.bind(color)
  for(const shadow of [depth,distance]){shadow.map=source.map;shadow.alphaMap=source.alphaMap;shadow.alphaTest=source.alphaTest;shadow.side=source.side;shadow.displacementMap=source.displacementMap;shadow.displacementScale=source.displacementScale;shadow.displacementBias=source.displacementBias}
  const profile={value:new Vector3(root+height*(tree?.35:.12),height*(tree?.65:.88),tree?.28:.055)}
  for(const material of [color,depth,distance])this.decorateMaterial(material,profile)
  return {color,depth,distance}
 }
 private decorateMaterial(material:Material,profile:{value:Vector3}){
  const compile=material.onBeforeCompile.bind(material),cacheKey=material.customProgramCacheKey.bind(material)
  material.onBeforeCompile=(shader,renderer)=>{compile(shader,renderer);Object.assign(shader.uniforms,this.uniforms,{flightWindProfile:profile});shader.vertexShader=windVertexShader(shader.vertexShader)}
  material.customProgramCacheKey=()=>`${cacheKey()}:flight-vegetation-wind-v1`;material.needsUpdate=true
 }
}
export function installVegetationPhase(geometry:BufferGeometry,capacity:number){
 const phase=new InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('flightWindPhase',phase);return phase
}
