// Museum-owned lens culling. Native lens equations and state come from Tidewater (MIT).
import {GPU, RenderTarget, StorageBuffer, ShaderModule, composeShader, createShaderModule} from '../vendor/tidewater/src/engine/webgpu.js';
import {LensDroplets} from '../vendor/tidewater/src/post/LensDroplets.js';

export const SPARSE_LENS_TILE = 4;
export const LENS_WET_THRESHOLD = Math.fround(.001);
const tile = SPARSE_LENS_TILE;
const clear = [0,0,0,0];
const aspectBounds = [0.25,4];
const hashStart = 'fn lensHash2( p: vec2f ) -> vec2f {';
const layerStart = 'fn lensLayer( p: vec2f, cell: f32, rMin: f32, rMax: f32, density: f32, slide: bool, acc: ptr<function, LensAcc> ) {';
const wetStart = 'if ( wet > 0.001 ) {';
const hashCall = 'let h = lensHash2( c + seed );';
const dropCalls = ['lensLayer( p, 0.05, 0.003, 0.011, wet * 0.5, false, &acc );',
 'lensLayer( p, 0.13, 0.01, 0.026, wet * 0.22, true, &acc );'];
function replace(s, from, to) {
  if (s.split(from).length !== 2) throw Error('Pinned sparse lens seam changed: '+from);
  return s.replace(from,to);
}
export const SPARSE_LENS_BITS = /* wgsl */`
fn sparseLensBit(c: vec2f, slide: bool) -> u32 {
  let ci = vec2i(c) & vec2i(3);
  return 1u << (u32(ci.x + 4*ci.y) + select(0u, 16u, slide));
}`;
const sizeCode = /* wgsl */`
fn sparseLensTileDimensions() -> vec2u {
  return (vec2u(frame.outputResolution) + ${tile-1}u) / ${tile}u;
}`;
export const SPARSE_LENS_READ = sizeCode + /* wgsl */`
fn sparseLensMaskAt(pixel: vec2u) -> u32 {
  let q=pixel/${tile}u;
  return sparseLensMask[q.y*sparseLensTileDimensions().x+q.x];
}`;

function rasterize(lens) {
  const source=lens.nativeModule.code;
  const native=source.slice(source.indexOf(hashStart),source.indexOf('struct LensAcc'));
  const backing=()=>lens.tileMask;
  const c=composeShader({stage:'render',label:'lens tile candidates',bindings:{
    lensParams:{uniform:lens.uniforms}, sparseLensWrite:{storage:backing,access:'read_write',type:'atomic<u32>'},
  },code:native+SPARSE_LENS_BITS+sizeCode+/* wgsl */`
struct SparseVertex { @builtin(position) pos:vec4f, @location(0) @interpolate(flat) bit:u32 };
const SPARSE_QUAD=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
@vertex fn vs(@builtin(vertex_index) vertex:u32, @builtin(instance_index) idx:u32) -> SparseVertex {
  let aspect=lensParams.aspect;let wet=lensParams.wet;let seed=lensParams.seed;let age=lensParams.age;
  let smallW=u32(floor(aspect/0.05))+3u;let smallH=u32(floor(1.0/0.05))+3u;
  let slide=idx>=smallW*smallH;
  let cell=select(0.05,0.13,slide);
  let stride=select(smallW,u32(floor(aspect/cell))+3u,slide);
  let cellIndex=idx-select(0u,smallW*smallH,slide);
  // Includes one native neighbor outside each edge plus rounding margin at exact cell boundaries.
  let cy=cellIndex/stride;
  if(cy>u32(floor(1.0/cell))+2u){return SparseVertex(vec4f(2.0,2.0,0.0,1.0),0u);}
  let c=vec2f(vec2i(i32(cellIndex%stride)-1,i32(cy)-1));
  let h = lensHash2( c + seed );
  if(h.x>=wet*select(0.5,0.22,slide)){return SparseVertex(vec4f(2.0,2.0,0.0,1.0),0u);}
  let h2 = lensHash2( c + seed + 17.3 );
  var center=(c+(vec2f(0.2)+h2*0.6))*cell;
  let life=clamp(wet*1.6-h2.y*0.6,0.0,1.0);
  let r=mix(select(0.003,0.01,slide),select(0.011,0.026,slide),h.y*h.y)*sqrt(life);
  let s=max(age-(h2.x*3.0+0.4),0.0);
  let dy=select(0.0,s*s*(r*3.5),slide);
  center.y+=dy;
  let rb=max(r*1.18,1e-4);
  let rr=vec2f(rb,rb/select(1.0,0.8,slide));
  let rrAbove=max(rr.y,select(0.0,dy+0.01,slide));
  // The native 3x3 walk only visits c while floor(p/cell) lies in [c-1,c+1].
  let pad=vec2f(0.00002);
  let lo=max(center-vec2f(rr.x,rrAbove),(c-1.0)*cell)-pad;
  let hi=min(center+rr,(c+2.0)*cell)+pad;
  let pixelsPerTile=frame.outputResolution/vec2f(aspect,1.0)/f32(${tile});
  let dims=vec2f(sparseLensTileDimensions());
  let a=clamp(floor(lo*pixelsPerTile),vec2f(0.0),dims);
  let b=clamp(ceil(hi*pixelsPerTile),vec2f(0.0),dims);
  if(any(b<=a)){return SparseVertex(vec4f(2.0,2.0,0.0,1.0),0u);}
  let q=mix(a,b,SPARSE_QUAD[vertex])/dims;
  return SparseVertex(vec4f(q*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0),sparseLensBit(c,slide));
}
@fragment fn fs(in:SparseVertex) -> @location(0) vec4f {
  let q=vec2u(in.pos.xy);
  atomicOr(&sparseLensWrite[q.y*sparseLensTileDimensions().x+q.x],in.bit);
  return vec4f(0.0);
}
`});
  const shader=createShaderModule(c.code,'lens tile candidates');
  const handle=GPU.renderPipeline({label:'lens tile candidates',layout:GPU.device.createPipelineLayout({bindGroupLayouts:[c.group0.layout,c.bindings.layout]}),
    vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'r8unorm',writeMask:0}]},primitive:{topology:'triangle-list'}});
  const target=new RenderTarget(1,1,{label:'lens tile grid',colors:['r8unorm'],usage:['render']});
  return {handle,target,render(encoder,w,h){
    encoder.clearBuffer(backing().getGPU());
    target.setSize(Math.ceil(w/tile),Math.ceil(h/tile));
    const pass=encoder.beginRenderPass({label:'lens tile candidates',colorAttachments:[{
      view:target.texture.view(),loadOp:'clear',storeOp:'discard',clearValue:clear,
    }]});
    pass.setPipeline(GPU.ready(handle));
    pass.setBindGroup(0,c.group0.getBindGroup());
    pass.setBindGroup(1,c.bindings.getBindGroup());
    const aspect=w/h;
    // The GPU determines the exact ranges; these rounded-up CPU bounds can only add culled instances.
    pass.draw(6,(Math.ceil(aspect/.05)+4)*24+(Math.ceil(aspect/.13)+4)*12);
    pass.end();
  }};
}


export const SPARSE_LENS_UV_PIXEL='vec2u( uv * frame.outputResolution )';

function sparseLensCode(source) {
  source=replace(source,hashStart,SPARSE_LENS_BITS+SPARSE_LENS_READ+hashStart);
  source=replace(source,layerStart,layerStart.replace('acc: ptr','mask: u32, acc: ptr'));
  source=replace(source,hashCall,'if ((mask & sparseLensBit(c,slide)) == 0u) { continue; }\n\t\t\t'+hashCall);
  source=replace(source,wetStart,wetStart+`
    // Extreme aspect ratios fall back to the full native cell walk.
    var mask = 0xffffffffu;
    if (lensParams.aspect >= ${aspectBounds[0]} && lensParams.aspect <= ${aspectBounds[1].toFixed(1)}) {
      mask = sparseLensMaskAt(${SPARSE_LENS_UV_PIXEL});
      if (mask == 0u) { return col; }
    }`);
  for(const [i,call] of dropCalls.entries()){
    const half=i===0?'0x0000ffffu':'0xffff0000u';
    source=replace(source,call,`if ((mask & ${half}) != 0u) { ${call.replace('&acc','mask, &acc')} }`);
  }
  return source;
}

export class MuseumLensDroplets extends LensDroplets {
  constructor(existing){
    super();
    if(existing){
      this.uniforms=existing.uniforms;
      for(const name of ['wet','age','seed','aspect'])this[name]=existing[name];
      this.duration=existing.duration;
      this._wasUnder=existing._wasUnder;
    }
    this.nativeModule=existing?.module??this.module;
    this.tileMask=new StorageBuffer({label:'lens tile bits',type:'u32',count:4});
    this.raster=null;
    this.module=new ShaderModule({name:this.nativeModule.name,code:sparseLensCode(this.nativeModule.code),
      bindings:{...this.nativeModule.bindings,sparseLensMask:{storage:()=>this.tileMask}}});
  }

  // Precompile with PostFX so the first surfacing never compiles a shader during play.
  compile(){
    this.raster??=rasterize(this);
    return this.raster.handle;
  }

  reserve(width,height){
    const count=Math.ceil(width/tile)*Math.ceil(height/tile);
    if(count<=this.tileMask.count)return;
    this.tileMask.destroy();
    this.tileMask=new StorageBuffer({label:'lens tile bits',type:'u32',count});
  }

  prepare(width,height,encoder){
    if(Math.fround(this.wet.value)<=LENS_WET_THRESHOLD)return;
    const aspect=Math.fround(this.aspect.value);
    if(aspect<aspectBounds[0]||aspect>aspectBounds[1])return;
    const handle=this.compile();
    if(handle.failed)throw Error('Lens tile candidate pipeline failed');
    this.reserve(width,height);
    this.raster.render(encoder??GPU.getEncoder(),width,height);
  }
}
