import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3, type PerspectiveCamera } from 'three'
import { CLOUD_GLSL } from './cloud-shared.glsl'
import type { createEnvironmentFog } from './environment-fog'
export const RAIN_COUNTS={low:512,balanced:1536} as const
const hash=(i:number)=>{let h=Math.imul(i+193706,374761393);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295}
export function rainSeed(id:number){return [hash(id*3)*100,hash(id*3+1)*60,hash(id*3+2)*100] as const}
export function rainPosition(id:number,time:number,eye:readonly[number,number,number]){
 const seed=rainSeed(id),mod=(a:number,b:number)=>(a%b+b)%b
 return [eye[0]+mod(seed[0]+time*1.2-eye[0]+50,100)-50,eye[1]+mod(seed[1]-time*19-eye[1]+30,60)-30,eye[2]+mod(seed[2]+time*.4-eye[2]+50,100)-50] as const
}
const fragment=`varying vec2 uvRain;varying vec3 rainWorld;uniform float rainAmount;
void main(){if(rainWorld.y<-.7)discard;float range=length(rainWorld-cameraPosition);float fade=smoothstep(1.,5.,range)*(1.-smoothstep(35.,50.,range));float a=(1.-abs(uvRain.x))*sin(uvRain.y*3.14159265)*fade*rainAmount*.38;if(a<.003)discard;gl_FragColor=vec4(.57,.65,.72,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
/** Bounded world-space rain, GPU motion, stable IDs. No per-drop terrain queries. */
export class RainField {
 readonly geometry=new InstancedBufferGeometry()
 readonly uniforms={rainEye:{value:new Vector3()},rainOrigin:{value:new Vector2()},rainTime:{value:0},rainAmount:{value:0}}
 readonly material=new ShaderMaterial({uniforms:this.uniforms,transparent:true,depthTest:true,depthWrite:false,vertexShader:`attribute vec3 seed;uniform vec3 rainEye;uniform vec2 rainOrigin;uniform float rainTime;varying vec2 uvRain;varying vec3 rainWorld;
void main(){vec3 logicalEye=rainEye+vec3(rainOrigin.x,0.,rainOrigin.y);vec3 p=logicalEye+mod(seed+vec3(1.2,-19.,.4)*rainTime-logicalEye+vec3(50.,30.,50.),vec3(100.,60.,100.))-vec3(50.,30.,50.);p.xz-=rainOrigin;vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);p+=right*position.x*.023+vec3(-.063,1.,-.021)*position.y*.8;rainWorld=p;uvRain=vec2(position.x,position.y+.5);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,fragmentShader:fragment})
 readonly mesh=new Mesh(this.geometry,this.material)
 private disposed=false
 private warmed=false
 constructor(){
  this.geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,-.5,0,1,-.5,0,1,.5,0,-1,.5,0]),3));this.geometry.setIndex([0,1,2,0,2,3])
  this.geometry.setAttribute('seed',new InstancedBufferAttribute(new Float32Array(Array.from({length:1536},(_,i)=>rainSeed(i)).flat()),3));this.geometry.instanceCount=512
  this.mesh.frustumCulled=false;this.mesh.renderOrder=2;this.mesh.onAfterRender=()=>{this.warmed=true}
 }
 update(camera:PerspectiveCamera,origin:{x:number;z:number},time:number,rain:number,quality:'low'|'balanced'){
  this.mesh.visible=rain>.0001||!this.warmed;this.geometry.instanceCount=RAIN_COUNTS[quality];this.uniforms.rainEye.value.copy(camera.position);this.uniforms.rainOrigin.value.set(origin.x,origin.z);this.uniforms.rainTime.value=time;this.uniforms.rainAmount.value=rain/.32
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose()}
}
/** Three world-anchored curtains in one draw, attenuated by the shared cloud field. */
export class RainCurtains {
 readonly geometry=new InstancedBufferGeometry()
 readonly uniforms
 readonly material:ShaderMaterial
 readonly mesh:Mesh
 private warmed=false
 private disposed=false
 constructor(shared:ReturnType<typeof createEnvironmentFog>['uniforms']){
  this.uniforms={...shared,curtainAmount:{value:0},curtainOrigin:{value:new Vector2()}}
  this.geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,0,0,1,0,0,1,1,0,-1,1,0]),3));this.geometry.setIndex([0,1,2,0,2,3])
  this.geometry.setAttribute('curtainCenter',new InstancedBufferAttribute(new Float32Array([-2400,0,-3200,1900,0,-5100,-500,0,-7200]),3));this.geometry.instanceCount=3
  this.material=new ShaderMaterial({uniforms:this.uniforms,transparent:true,depthTest:true,depthWrite:false,side:2,vertexShader:`attribute vec3 curtainCenter;uniform vec2 curtainOrigin;varying vec2 curtainUV;varying vec3 curtainWorld;void main(){vec3 p=curtainCenter+vec3(position.x*1450.,position.y*2400.,0.);p.xz-=curtainOrigin;curtainWorld=p;curtainUV=position.xy;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,fragmentShader:`${CLOUD_GLSL}
varying vec2 curtainUV;varying vec3 curtainWorld;uniform float curtainAmount;void main(){float edge=pow(max(0.,1.-curtainUV.x*curtainUV.x),2.)*smoothstep(0.,.15,curtainUV.y)*(1.-smoothstep(.8,1.,curtainUV.y));float a=edge*curtainAmount*cloudDensity(curtainWorld.xz)*.36;gl_FragColor=vec4(.32,.38,.44,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`})
  this.mesh=new Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=1;this.mesh.onAfterRender=()=>{this.warmed=true}
 }
 update(origin:{x:number;z:number},amount:number){this.mesh.visible=amount>.001||!this.warmed;this.uniforms.curtainOrigin.value.set(origin.x,origin.z);this.uniforms.curtainAmount.value=amount}
 dispose(){if(this.disposed)return;this.disposed=true;this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose()}
}
