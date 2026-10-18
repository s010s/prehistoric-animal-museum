// Adapt Tidewater's heightfield sun march to a 32km, multiresolution island.
// Native CSM still resolves nearby geometry. Keep vendor 4811ba48 untouched.
import {Texture,ShaderModule,ComputeKernel} from '../vendor/tidewater/src/engine/webgpu.js';
import {G} from '../vendor/tidewater/src/core/Globals.js';

export function installIslandHillShadow(gpu){
 const N=1024,mod=gpu.module;
 const start=mod.code.indexOf('fn terrainLayerHeight('),end=mod.code.indexOf('// filtered normal');
 if(start<0||end<start)throw Error('Composed island height seam changed');
 // Only heights: the bake must not bind its own output as a sampled texture.
 const heights=new ShaderModule({name:'museumHillHeights',bindings:{
  terrainHeightTex:mod.bindings.terrainHeightTex,
  terrainFineHeightTex:mod.bindings.terrainFineHeightTex,
 },code:mod.code.slice(start,end)});
 const old=gpu.sunShadowTexture;
 gpu.sunShadowTexture=new Texture({label:'Museum relative hill clearance',width:N,height:N,format:'rgba16float',usage:['sample','storage']});
 mod.bindings.terrainSunShadowTex={texture:gpu.sunShadowTexture};
 gpu.retiredTerrainTextures.push(old,gpu.shadowHeightTexture);
 gpu.sunShadowKernel=new ComputeKernel({label:'Museum composed hill clearance',modules:[heights],bindings:{
  museumHillParams:{uniform:gpu.uniforms},
  museumHillOut:{storageTexture:gpu.sunShadowTexture,access:'write'},
 },workgroupSize:[8,8,1],code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=vec2u(${N}u))){return;}
 let xz=(vec2f(gid.xy)+.5)/${N}.0*museumHillParams.size+museumHillParams.origin;
 let L=museumHillParams.sunBake;let horizontal=max(length(L.xz),1e-4);
 let direction=L.xz/horizontal;let tanElevation=L.y/horizontal;
 let receiver=terrainHeightAt(xz);var top=-1e4;var occluder=0.0;
 var t=24.0;var step=6.0;
 for(var i=0;i<24;i++){
  let height=terrainHeightAt(xz+direction*t);
  let candidate=height-t*tanElevation;
  if(candidate>top){top=candidate;occluder=t;}
  step*=1.22;t+=step;
 }
 // Interpolate clearance relative to the receiving terrain, not an absolute
 // 32/64m plane bridging across a narrow valley. Trees add their true height
 // above that surface at lookup; real mountain occlusion remains positive.
 textureStore(museumHillOut,gid.xy,vec4f(top-receiver,occluder,0.0,1.0));
}`});
 const shadowStart=mod.code.indexOf('fn terrainSunShadowAt(');
 if(shadowStart<0)throw Error('Native hill shadow receiver seam changed');
 mod.code=mod.code.slice(0,shadowStart)+`
fn terrainSunShadowAt(P:vec3f)->f32{
 let N=f32(textureDimensions(terrainSunShadowTex).x);
 let st=clamp(terrainUvOf(P.xz)*N-.5,vec2f(0.0),vec2f(N-1.001));
 let i=vec2i(floor(st));let t=fract(st);
 let s=mix(mix(textureLoad(terrainSunShadowTex,i,0),textureLoad(terrainSunShadowTex,i+vec2i(1,0),0),t.x),
           mix(textureLoad(terrainSunShadowTex,i+vec2i(0,1),0),textureLoad(terrainSunShadowTex,i+vec2i(1,1),0),t.x),t.y);
 let receiverHeight=P.y-terrainHeightAt(P.xz);
 let width=s.y*.012+.35;
 return mix(1.0,smoothstep(-width,width,receiverHeight-s.x),terrainParams.sunBaked);
}`;
 gpu._sunBaked=false;gpu.hillShadowEnabled=true;
 gpu.updateSunShadow=function(renderer,force=false){
  const L=G.sunDir.value;
  if(!force&&this._sunBaked&&L.angleTo(this.uSunBake.value)<.0015)return false;
  this.uSunBake.value.copy(L);this.sunShadowKernel.dispatch([N/8,N/8,1]);
  this._sunBaked=true;this.uSunBaked.value=this.hillShadowEnabled?1:0;return true;
 };
 gpu.hillShadowStats={resolution:N,texelMetres:gpu.size/N,steps:24,bake:'on sun change only; exact composed heights',receiver:'relative clearance rebased on the actual terrain; native CSM retained',bytes:N*N*8};
 return gpu;
}
