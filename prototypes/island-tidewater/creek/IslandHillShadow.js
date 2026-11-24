// Adapt Tidewater's heightfield sun march to a 32km, multiresolution island
// with a 2.5m camera-centred local clipmap packed into .zw (zero extra
// sampled texture or UBO bindings). Keep vendor 4811ba48 untouched.
import { Texture, ShaderModule, ComputeKernel, UniformBlock } from '../vendor/tidewater/src/engine/webgpu.js';
import { Vector2, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { G } from '../vendor/tidewater/src/core/Globals.js';

export function installIslandHillShadow(gpu) {
  const N = 1024;
  const NEAR_N = 512;
  const NEAR_SIZE = 1280; // 2.5 m per texel; ±460 m unblended core around snapped centre
  const NEAR_SNAP = 80; // 32 texels exact: camera always >= 420 m inside the unblended core
  const mod = gpu.module;
  const start = mod.code.indexOf('fn terrainLayerHeight(');
  const end = mod.code.indexOf('// filtered normal');
  if (start < 0 || end < start) throw Error('Composed island height seam changed');

  // Extend TerrainParams in place before any pipeline compiles so the local
  // clipmap adds zero extra UBO bindings across the engine.
  const prev = gpu.uniforms;
  const params = new UniformBlock('TerrainParams', {
    origin: ['f32', prev.fields.origin.value],
    size: ['f32', prev.fields.size.value],
    res: ['f32', prev.fields.res.value],
    shoreRes: ['f32', prev.fields.shoreRes.value],
    sunBake: ['vec3f', new Vector3().copy(prev.fields.sunBake.value)],
    sunBaked: ['f32', prev.fields.sunBaked.value],
    nearOrigin: ['vec2f', new Vector2(-NEAR_SIZE * 0.5, -NEAR_SIZE * 0.5)],
    nearSize: ['f32', NEAR_SIZE],
    nearBaked: ['f32', 0],
  }, { label: 'terrainParams' });
  if (prev.buffer) prev.buffer.destroy();
  gpu.uniforms = params;
  gpu.uOrigin = params.fields.origin;
  gpu.uSize = params.fields.size;
  gpu.uSunBake = params.fields.sunBake;
  gpu.uSunBaked = params.fields.sunBaked;
  mod.bindings.terrainParams = { uniform: params };

  // Only heights: the bake must not bind its own output as a sampled texture.
  const heights = new ShaderModule({
    name: 'museumHillHeights',
    bindings: {
      terrainHeightTex: mod.bindings.terrainHeightTex,
      terrainFineHeightTex: mod.bindings.terrainFineHeightTex,
    },
    code: mod.code.slice(start, end),
  });
  const old = gpu.sunShadowTexture;
  gpu.sunShadowTexture = new Texture({
    label: 'Museum relative hill clearance',
    width: N,
    height: N,
    format: 'rgba16float',
    usage: ['sample', 'storage'],
  });
  // Internal quadrant backup of global .xy so camera-driven local .zw rebakes
  // preserve global channels without adding any binding to terrain.module.
  const globalQuadBackup = new Texture({
    label: 'Museum global hill quadrant backup',
    width: NEAR_N,
    height: NEAR_N,
    format: 'rgba16float',
    usage: ['sample', 'storage'],
  });
  gpu.hillShadowGlobalBackup = globalQuadBackup;
  mod.bindings.terrainSunShadowTex = { texture: gpu.sunShadowTexture };
  gpu.retiredTerrainTextures.push(old, gpu.shadowHeightTexture);

  gpu.sunShadowKernel = new ComputeKernel({
    label: 'Museum composed hill clearance (global)',
    modules: [heights],
    bindings: {
      museumHillParams: { uniform: gpu.uniforms },
      museumHillOut: { storageTexture: gpu.sunShadowTexture, access: 'write' },
      museumHillBackupOut: { storageTexture: globalQuadBackup, access: 'write' },
    },
    workgroupSize: [8, 8, 1],
    code: `
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
 let value=vec4f(top-receiver,occluder,0.0,1.0);
 textureStore(museumHillOut,gid.xy,value);
 if(gid.x<${NEAR_N}u && gid.y<${NEAR_N}u){
  textureStore(museumHillBackupOut,gid.xy,value);
 }
}`,
  });

  gpu.nearSunShadowKernel = new ComputeKernel({
    label: 'Museum composed hill clearance (local 2.5m)',
    modules: [heights],
    bindings: {
      museumHillParams: { uniform: gpu.uniforms },
      museumHillBackup: { texture: globalQuadBackup },
      museumHillOut: { storageTexture: gpu.sunShadowTexture, access: 'write' },
    },
    workgroupSize: [8, 8, 1],
    code: `
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=vec2u(${NEAR_N}u))){return;}
 let xz=museumHillParams.nearOrigin+(vec2f(gid.xy)+.5)/${NEAR_N}.0*museumHillParams.nearSize;
 let L=museumHillParams.sunBake;let horizontal=max(length(L.xz),1e-4);
 let direction=L.xz/horizontal;let tanElevation=L.y/horizontal;
 let receiver=terrainHeightAt(xz);var top=-1e4;var occluder=0.0;
 var t=24.0;var step=4.0;
 for(var i=0;i<32;i++){
  let height=terrainHeightAt(xz+direction*t);
  let candidate=height-t*tanElevation;
  if(candidate>top){top=candidate;occluder=t;}
  step*=1.16;t+=step;
 }
 let globalVal=textureLoad(museumHillBackup,vec2i(gid.xy),0).xy;
 textureStore(museumHillOut,gid.xy,vec4f(globalVal.x,globalVal.y,top-receiver,occluder));
}`,
  });

  const shadowStart = mod.code.indexOf('fn terrainSunShadowAt(');
  if (shadowStart < 0) throw Error('Native hill shadow receiver seam changed');
  mod.code = mod.code.slice(0, shadowStart) + `
fn terrainSunShadowAt(P:vec3f)->f32{
 let N=f32(textureDimensions(terrainSunShadowTex).x);
 let st=clamp(terrainUvOf(P.xz)*N-.5,vec2f(0.0),vec2f(N-1.001));
 let i=vec2i(floor(st));let t=fract(st);
 let g0=mix(textureLoad(terrainSunShadowTex,i,0).xy,textureLoad(terrainSunShadowTex,i+vec2i(1,0),0).xy,t.x);
 let g1=mix(textureLoad(terrainSunShadowTex,i+vec2i(0,1),0).xy,textureLoad(terrainSunShadowTex,i+vec2i(1,1),0).xy,t.x);
 let sg=mix(g0,g1,t.y);
 let receiverHeight=P.y-terrainHeightAt(P.xz);
 let wg=sg.y*.012+.35;
 var vis=smoothstep(-wg,wg,receiverHeight-sg.x);
 if(terrainParams.nearBaked>.5){
  let nuv=(P.xz-terrainParams.nearOrigin)/terrainParams.nearSize;
  let edge=max(abs(nuv.x-.5),abs(nuv.y-.5));
  let nw=1.0-smoothstep(.36,.48,edge);
  if(nw>0.0){
   let nst=clamp(nuv*${NEAR_N}.0-.5,vec2f(0.0),vec2f(${NEAR_N - 1}.0-0.001));
   let ni=vec2i(floor(nst));let nt=fract(nst);
   let n0=mix(textureLoad(terrainSunShadowTex,ni,0).zw,textureLoad(terrainSunShadowTex,ni+vec2i(1,0),0).zw,nt.x);
   let n1=mix(textureLoad(terrainSunShadowTex,ni+vec2i(0,1),0).zw,textureLoad(terrainSunShadowTex,ni+vec2i(1,1),0).zw,nt.x);
   let sn=mix(n0,n1,nt.y);
   let wn=sn.y*.012+.35;
   vis=mix(vis,smoothstep(-wn,wn,receiverHeight-sn.x),nw);
  }
 }
 return mix(1.0,vis,terrainParams.sunBaked);
}`;

  gpu._sunBaked = false;
  gpu._nearBaked = false;
  gpu._nearOriginX = NaN;
  gpu._nearOriginZ = NaN;
  gpu._focusX = 0;
  gpu._focusZ = 0;
  gpu.hillShadowEnabled = true;

  gpu.setHillShadowFocus = function setHillShadowFocus(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return;
    this._focusX = pos.x;
    this._focusZ = pos.z;
  };

  gpu.updateSunShadow = function updateSunShadow(renderer, force = false) {
    const L = G.sunDir.value;
    const sunMoved = force || !this._sunBaked || L.angleTo(this.uSunBake.value) >= 0.0015;
    if (sunMoved) {
      this.uSunBake.value.copy(L);
      this.sunShadowKernel.dispatch([N / 8, N / 8, 1]);
      this._sunBaked = true;
      this.uSunBaked.value = this.hillShadowEnabled ? 1 : 0;
    }
    const ox = Math.round(this._focusX / NEAR_SNAP) * NEAR_SNAP - NEAR_SIZE * 0.5;
    const oz = Math.round(this._focusZ / NEAR_SNAP) * NEAR_SNAP - NEAR_SIZE * 0.5;
    if (this._sunBaked && (sunMoved || !this._nearBaked || ox !== this._nearOriginX || oz !== this._nearOriginZ)) {
      this._nearOriginX = ox;
      this._nearOriginZ = oz;
      this.uniforms.fields.nearOrigin.value.set(ox, oz);
      this.nearSunShadowKernel.dispatch([NEAR_N / 8, NEAR_N / 8, 1]);
      this._nearBaked = true;
      this.uniforms.fields.nearBaked.value = 1;
      this.hillShadowStats.nearRebakes++;
      this.hillShadowStats.nearOrigin = [ox, oz];
    }
    // Return true only when the sun changed so GroundBounce does not re-bake on
    // routine 80m camera recentering of the local clipmap.
    return sunMoved;
  };

  gpu.hillShadowStats = {
    resolution: N,
    texelMetres: gpu.size / N,
    steps: 24,
    nearResolution: NEAR_N,
    nearTexelMetres: NEAR_SIZE / NEAR_N,
    nearSpanMetres: NEAR_SIZE,
    nearSnapMetres: NEAR_SNAP,
    nearSteps: 32,
    nearRebakes: 0,
    nearOrigin: [-NEAR_SIZE * 0.5, -NEAR_SIZE * 0.5],
    bake: 'global 32m on sun change; local 2.5m clipmap on sun change or 80m snap',
    receiver: 'dual-scale relative clearance rebased on exact terrain; native CSM retained',
    bytes: N * N * 8 + NEAR_N * NEAR_N * 8,
  };
  return gpu;
}
