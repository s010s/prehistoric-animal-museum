// Startup-only semantic mip filter. The atlas keeps its two RGBA8 textures:
// A = premultiplied RGB / true coverage; B = premultiplied oct RG / leaf / exposure.
// Directions are averaged in XYZ, never in their folded octahedral encoding.
import {GPU} from '../vendor/tidewater/src/engine/gpu/GPU.js';
let pipeline;
export function generateImpostorNormalMipmaps(coverage,normal){
 if(!pipeline){
  const module=GPU.device.createShaderModule({label:'museum oct normal mip',code:`
@group(0) @binding(0) var coverage:texture_2d<f32>;
@group(0) @binding(1) var normals:texture_2d<f32>;
fn decode(p0:vec2f)->vec3f{
 let p=p0*2.0-1.0;var n=vec3f(p.x,1.0-abs(p.x)-abs(p.y),p.y);
 if(n.y<0.0){let q=(1.0-abs(n.zx))*select(vec2f(-1.0),vec2f(1.0),n.xz>=vec2f(0.0));n.x=q.x;n.z=q.y;}return normalize(n);
}
fn encode(n0:vec3f)->vec2f{
 let n=n0/(abs(n0.x)+abs(n0.y)+abs(n0.z));var p=n.xz;
 if(n.y<0.0){p=(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0));}return p*.5+.5;
}
@vertex fn vs(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(p*2.0-1.0,0.0,1.0);
}
@fragment fn fs(@builtin(position)p:vec4f)->@location(0)vec4f{
 let q=vec2i(p.xy)*2;var weight=0.0;var sum=vec3f(0.0);var scalar=vec2f(0.0);var best=0.0;var fallback=vec3f(0.0,1.0,0.0);
 for(var j=0;j<2;j++){for(var i=0;i<2;i++){
  let at=q+vec2i(i,j);let a=textureLoad(coverage,at,0).a;let b=textureLoad(normals,at,0);
  scalar+=b.zw*.25;
  if(a>.00001){let n=decode(clamp(b.xy/a,vec2f(0.0),vec2f(1.0)));sum+=n*a;weight+=a;if(a>best){best=a;fallback=n;}}
 }}
 if(weight<.00001){return vec4f(0.0);}
 var n=fallback;if(dot(sum,sum)>.00000001){n=normalize(sum);}
 return vec4f(encode(n)*(weight*.25),scalar);
}`});
  pipeline=GPU.device.createRenderPipeline({label:'museum semantic atlas mip',layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
 }
 const A=coverage.getGPU(),B=normal.getGPU(),encoder=GPU.getEncoder();
 for(let mip=1;mip<normal.mipLevelCount;mip++){
  const view=(t,m)=>t.createView({dimension:'2d',baseMipLevel:m,mipLevelCount:1});
  const group=GPU.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:view(A,mip-1)},{binding:1,resource:view(B,mip-1)}]});
  const pass=encoder.beginRenderPass({label:'museum semantic normal mip '+mip,colorAttachments:[{view:view(B,mip),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});
  pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
 }
}
