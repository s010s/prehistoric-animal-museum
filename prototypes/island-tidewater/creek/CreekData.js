// Own museum geography; native query/minmax contracts. Water/visitor sites
// retain original Y; protected relief revision is recorded in geography.lock.
import { TerrainData } from '../vendor/tidewater/src/world/TerrainData.js';
import { Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import { commonModule } from '../vendor/tidewater/src/engine/render/wgsl/common.js';
import { GPU, StorageBuffer, ComputeKernel, readBuffer } from '../vendor/tidewater/src/engine/webgpu.js';
import geographyURL from './assets/geography.json?url';
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = (a,b,v) => { const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t); };
async function get(url,type) { const r=await fetch(url); if(!r.ok)throw Error(`Creek asset ${r.status}: ${url}`); return type==='json'?r.json():r.arrayBuffer(); }
export async function loadCreekData() {
  const [g,h,w,m]=await Promise.all([get(geographyURL,'json'),get(new URL('./assets/heights.bin',import.meta.url)),get(new URL('./assets/water.bin',import.meta.url)),get(new URL('./assets/masks.bin',import.meta.url))]);
  const terrain=Object.create(TerrainData.prototype);
  Object.assign(terrain,{size:g.size,res:g.res,texel:g.texel,origin:g.origin,heights:new Float32Array(h),pads:[],rockSites:[],paths:[],timings:{source:'museum-export'}});
  const masks=new Uint8Array(m),n=g.res*g.res;
  terrain.rock=new Float32Array(n);
  for(const key of ['sand','path','gully','seagrass','rubble','scarp'])terrain[key]=new Uint8Array(n);
  for(let j=0;j<g.res;j++)for(let i=0;i<g.res;i++){
    const p=(Math.floor(j*g.maskRes/g.res)*g.maskRes+Math.floor(i*g.maskRes/g.res))*4,k=j*g.res+i;
    terrain.path[k]=masks[p];terrain.rock[k]=masks[p+2]/255;
  }
  terrain.buildMinMax();
  const field=new CreekField(g,new Float32Array(w),terrain);
  const grass=new Uint8Array(masks.length);
  for(let i=0;i<grass.length;i+=4)grass[i+1]=masks[i+1];
  return {geography:g,terrain,field,masks,grass:{res:g.maskRes,data:grass}};
}

export class CreekField {
  constructor(g,water,terrain) {
    this.g=g;this.data=water;this.terrain=terrain;
    this.texture=new Texture({label:'Museum creek water field',width:g.waterRes,height:g.waterRes,format:'rgba32float',data:water,usage:['sample','copyDst']});
    this.module=new ShaderModule({name:'museumCreek',deps:[commonModule],bindings:{creekFieldTex:{texture:this.texture,sampleType:'unfilterable-float'}},code:`
fn creekFieldAt(p:vec2f)->vec4f {
 let f=(p+${g.waterSize/2}.0)/${g.waterSize}.0*${g.waterRes}.0-0.5;
 if(any(f<vec2f(0.0))||any(f>=vec2f(${g.waterRes-1}.0))){return vec4f(0.0,10000.0,0.0,0.0);}
 let q=vec2i(floor(f));let t=fract(f);
 return mix(mix(textureLoad(creekFieldTex,q,0),textureLoad(creekFieldTex,q+vec2i(1,0),0),t.x),mix(textureLoad(creekFieldTex,q+vec2i(0,1),0),textureLoad(creekFieldTex,q+vec2i(1,1),0),t.x),t.y);
}
fn creekMeanAt(p:vec2f)->f32{return creekFieldAt(p).x;}
fn creekContains(p:vec2f)->bool{return creekFieldAt(p).y<0.05;}
fn creekGradient(p:vec2f)->vec2f {
 let e=0.5;let h=creekMeanAt(p);var v=vec4f(h);
 let p0=p+vec2f(e,0.0);let p1=p-vec2f(e,0.0);let p2=p+vec2f(0.0,e);let p3=p-vec2f(0.0,e);
 let f0=creekFieldAt(p0);let f1=creekFieldAt(p1);let f2=creekFieldAt(p2);let f3=creekFieldAt(p3);
 if(f0.y<0.05){v.x=f0.x;if(abs(v.x-h)>2.0){if(v.x<terrainHeightAt(p0)-0.03){v.x=h;}}}
 if(f1.y<0.05){v.y=f1.x;if(abs(v.y-h)>2.0){if(v.y<terrainHeightAt(p1)-0.03){v.y=h;}}}
 if(f2.y<0.05){v.z=f2.x;if(abs(v.z-h)>2.0){if(v.z<terrainHeightAt(p2)-0.03){v.z=h;}}}
 if(f3.y<0.05){v.w=f3.x;if(abs(v.w-h)>2.0){if(v.w<terrainHeightAt(p3)-0.03){v.w=h;}}}
 return vec2f(v.x-v.y,v.z-v.w)/(2.0*e);
}
fn creekQueryHeightAtXZ(p:vec2f)->f32{return select(-90.0,creekMeanAt(p),creekContains(p));}
fn creekQueryCameraState()->vec4f {let p=frame.cameraPos.xz;let d=creekGradient(p);return vec4f(creekQueryHeightAtXZ(p),-d.x,-d.y,0.0);}
`});
    this.cpuValid=true;this.cpu=new Float32Array(128);this.slots=1;
  }
  useTerrainGPU(gpu){this.module.deps.push(gpu.module);}
  extendRiver(layout,profile){
    const n=this.g.waterRes;if(layout.riverCount>n*2)throw Error('River profile exceeds reserved field rows');
    this.riverLayout=layout;this.riverProfile=profile;
    // Two reserved rows share the existing field binding. No extra texture
    // binding is added to the native water/lighting sampler graph.
    const packed=new Float32Array(n*(n+2)*4);packed.set(this.data);packed.set(profile,n*n*4);
    this.texture=new Texture({label:'Museum fine water plus main-river profile',width:n,height:n+2,format:'rgba32float',data:packed,usage:['sample','copyDst']});
    this.module.bindings.creekFieldTex.texture=this.texture;
    this.module.code=this.module.code.replace('fn creekFieldAt(','fn creekFineFieldAt(')+`
fn creekRiverRow(i:i32)->vec4f{return textureLoad(creekFieldTex,vec2i(i%${n},${n}+i/${n}),0);}
fn creekRiverAt(z:f32)->vec4f{
 let f=(z - (${layout.riverStart.toFixed(1)}))/${layout.riverStep}.0;
 if(f<0.0||f>=${layout.riverCount-1}.0){return vec4f(0.0,-90.0,-10000.0,0.0);}
 let i=i32(floor(f));return mix(creekRiverRow(i),creekRiverRow(i+1),fract(f));
}
fn creekFieldAt(p:vec2f)->vec4f{
 if(max(abs(p.x),abs(p.y))<${(this.g.waterSize/2-this.g.waterSize/n).toFixed(3)}){return creekFineFieldAt(p);}
 let r=creekRiverAt(p.y);let edge=abs(p.x-r.x)-r.z;
 let valid=r.y>frame.seaLevel+0.04&&r.z>0.0;
 let flow=normalize(vec2f(r.w,1.0))*.38;
 return vec4f(r.y,select(10000.0,edge,valid),flow);
}
`;
    this._fineSample=this.sample.bind(this);
    this.sample=(x,z,out=[0,0,0,0])=>{if(Math.max(Math.abs(x),Math.abs(z))<this.g.waterSize/2-this.g.waterSize/n)return this._fineSample(x,z,out);const r=this.riverAt(z);if(!r){out[0]=0;out[1]=10000;out[2]=out[3]=0;return out;}const l=Math.hypot(r.slope,1);out[0]=r.level;out[1]=r.level>-.66?Math.abs(x-r.x)-r.width:10000;out[2]=r.slope/l*.38;out[3]=1/l*.38;return out;};
  }
  riverAt(z){
    if(!this.riverLayout)return null;const l=this.riverLayout,f=(z-l.riverStart)/l.riverStep;if(f<0||f>=l.riverCount-1)return null;
    const i=Math.floor(f)*4,t=f-Math.floor(f),p=this.riverProfile,r=[];for(let c=0;c<4;c++)r[c]=p[i+c]*(1-t)+p[i+4+c]*t;
    return {x:r[0],level:r[1],width:r[2],slope:r[3],z};
  }
  sample(x,z,out=[0,0,0,0]) {
    const n=this.g.waterRes,f=(x+this.g.waterSize/2)/this.g.waterSize*n-.5,j=(z+this.g.waterSize/2)/this.g.waterSize*n-.5;
    if(f<0||j<0||f>=n-1||j>=n-1){out[0]=0;out[1]=10000;out[2]=out[3]=0;return out;}
    const ix=Math.floor(f),iz=Math.floor(j),u=f-ix,v=j-iz,k=(iz*n+ix)*4;
    for(let c=0;c<4;c++)out[c]=(this.data[k+c]*(1-u)+this.data[k+4+c]*u)*(1-v)+(this.data[k+n*4+c]*(1-u)+this.data[k+(n+1)*4+c]*u)*v;
    return out;
  }
  height(x,z){const f=this.sample(x,z);return f[1]<.05?f[0]:-90;}
  allocate(){return this.slots++;}
  setPoint(slot,x,z){const f=this.sample(x,z);this.cpu[slot*4]=f[1]<.05?f[0]:this.terrain.heightAt(x,z)-.2;}
  setCamera(x,z){this.cpu[0]=this.height(x,z);}
  audit(){return {translation:this.g.sourceOrigin,surface:'Original descending river and forest spring',minHeight:this.g.minHeight,maxHeight:this.g.maxHeight,waterRes:this.g.waterRes,waterTexelMetres:this.g.waterSize/this.g.waterRes,reference:this.g.reference.map(p=>({...p,sampledHeight:this.terrain.heightAt(...p.local),sampledWater:this.sample(...p.local)[0],heightError:this.terrain.heightAt(...p.local)-p.height})),underwater:true,ssr:false};}
  async auditGPU(terrainGPU){
    // Startup-only readback of the exact terrain and raw creek-field modules. The hybrid
    // ocean/swim path is exercised independently through headed interaction. No diagnostic dispatch/readback in timed frames.
    const points=[...this.g.reference.map(p=>p.local),...Array.from({length:35},(_,i)=>[-30+i,0]),[-51.53,-70],[-220,220],[255.8,255.8],...[-496,-480,-460,-448,448,460,480,496].map(x=>[x,0]),[-864.4847,-32],[-889.4847,-32],[-1500,300],[2023.7,0]];
    if(this.terrain.museumCove)for(const section of this.terrain.museumCove.sections)for(const transect of section.transects)for(const q of transect.samples)points.push(q.point);
    if(this.terrain.museumCove?.continuous)for(const transect of this.terrain.museumCove.continuous.summary.transects)for(const q of transect.samples)points.push(q.point);
    if(this.sourceExtentRepair)for(const z of [-3300,-3290,-3280.1,-3280,-3279.9,-3270,-3260])for(const x of [235,245,255,265,300])points.push([x,z]);
    if(this.riverLayout)for(let z=-3200;z<4000;z+=160){const r=this.riverAt(z);if(r)points.push([r.x,z],[r.x+r.width-.2,z],[r.x+r.width+.2,z]);}
    if(this.island){if(this.tributarySource)for(const p of this.tributarySource.points)points.push([p.x,p.z],[p.x+p.width+.5,p.z]);for(const lake of this.island.lakes)for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)points.push([lake.center[0]+x*lake.rx*.7,lake.center[1]+z*lake.rz*.7]);for(const grid of this.island.grids){for(const [x,z] of [[0,0],[3800,0],[3900,0],[4040,0],[-3800,0],[-3900,0],[0,3800],[0,3900]])points.push([grid.center[0]+x,grid.center[1]+z]);}for(const run of this.northRuns)for(let i=0;i<run.length;i+=13)points.push([run[i].x,run[i].z]);for(let z=5700;z<7400;z+=160)points.push([5600,z],[5800,z],[5400,z]);}
    if(terrainGPU.shoreField?.sampleAt){for(const shelf of this.terrain.museumCove.shelves){const [x,z]=shelf.center;for(const d of [0,30,120,329,350,400,450,470,500,1100,1120,1250,1400,1450,1500])points.push([x-d,z],[x+d,z],[x,z+d],[x,z-d]);}}
    const input=new StorageBuffer({label:'Creek audit points',count:points.length,type:'vec4f',data:new Float32Array(points.flatMap(p=>[...p,0,0]))});
    const output=new StorageBuffer({label:'Creek audit values',count:points.length,type:'vec4f'});
    const waveOutput=new StorageBuffer({label:'Hybrid wave field audit values',count:points.length,type:'vec4f'});
    const kernel=new ComputeKernel({label:'Creek startup geography audit',modules:[this.module,terrainGPU.module],bindings:{auditPoints:{storage:input,access:'read'},auditValues:{storage:output,access:'read_write'},auditWaves:{storage:waveOutput,access:'read_write'}},code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=${points.length}u){return;}let p=auditPoints[i].xy;
 let f=creekFieldAt(p);auditValues[i]=vec4f(terrainHeightAt(p),creekQueryHeightAtXZ(p),f.y,f.x);auditWaves[i]=terrainShoreSample(p);
}`});
    await GPU.pipelinesReady();GPU.beginFrame();kernel.dispatch(Math.ceil(points.length/64));
    const gpu=new Float32Array(await readBuffer(output,points.length*16));
    const rows=points.map((p,i)=>{const f=this.sample(...p),cpu=[this.terrain.heightAt(...p),this.height(...p),f[1],f[0]],actual=Array.from(gpu.subarray(i*4,i*4+4));return {point:p,cpu,gpu:actual,error:actual.map((v,c)=>v-cpu[c]),sameWetMask:(actual[2]<.05)===(cpu[2]<.05)};});
    let waveField=null;
    if(terrainGPU.shoreField?.sampleAt){
      const actual=new Float32Array(await readBuffer(waveOutput,points.length*16));
      const waves=points.map((p,i)=>{const cpu=terrainGPU.shoreField.sampleAt(...p),gpu=Array.from(actual.subarray(i*4,i*4+4)),validCPU=cpu[0]<10000&&cpu[3]<10000,validGPU=gpu[0]<10000&&gpu[3]<10000;return {point:p,cpu,gpu,validCPU,validGPU,error:gpu.map((v,c)=>v-cpu[c])};});
      // A 100000s land sentinel has no physical phase. Compare classification
      // there, and compare seconds/direction only where an actual wave exists.
      const valid=waves.filter(r=>r.validCPU&&r.validGPU),maxError=Math.max(...valid.flatMap(r=>r.error.map(Math.abs)));
      waveField={passed:valid.length>0&&maxError<.02&&waves.every(r=>r.validCPU===r.validGPU),maxError,validSamples:valid.length,invalidSamples:waves.length-valid.length,phase:'startup GPU vs audio hybrid CPU field; invalid land phase excluded, validity asserted',rows:waves};
      if(!waveField.passed)throw Error('Cove CPU/GPU wave phase mismatch '+maxError+' '+JSON.stringify(valid.reduce((a,b)=>Math.max(...a.error.map(Math.abs))>Math.max(...b.error.map(Math.abs))?a:b)));
    }
    input.destroy();output.destroy();waveOutput.destroy();
    const maxTerrainError=Math.max(...rows.map(r=>Math.abs(r.error[0]))),maxWaterError=Math.max(...rows.map(r=>Math.abs(r.error[1])));
    const passed=maxTerrainError<.002&&maxWaterError<.002&&rows.every(r=>r.sameWetMask&&r.gpu.every(Number.isFinite));
    if(!passed)throw Error('Creek CPU/GPU geography consistency failed');
    return {...this.audit(),waveField,gpu:{passed,phase:'startup-only',maxTerrainError,maxWaterError,rows}};
  }
}
export {smooth};
