// Application terrain composition; native Tidewater TerrainGPU API is preserved.
import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import {bakeTerrainMaps} from '../vendor/tidewater/src/world/terrain/TerrainBake.js';

const blend=p=>{const t=Math.max(0,Math.min(1,(Math.max(Math.abs(p[0]),Math.abs(p[1]))-448)/48));return 1-t*t*(3-2*t);};
export async function expandMuseumCoast(data){
 const read=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Own coast data unavailable');return r;};
 const [layout,h,m]=await Promise.all([(await read(new URL('./assets/coast-layout.json',import.meta.url))).json(),(await read(new URL('./assets/coast-heights.bin',import.meta.url))).arrayBuffer(),(await read(new URL('./assets/coast-masks.bin',import.meta.url))).arrayBuffer()]);
 const core=data.terrain,outer=Object.create(TerrainData.prototype),masks=new Uint8Array(m),n=layout.res*layout.res;
 Object.assign(outer,{size:layout.size,res:layout.res,texel:layout.texel,origin:layout.origin,heights:new Float32Array(h),pads:[],rockSites:[],paths:[],timings:{source:'museum western coast'}});
 outer.rock=new Float32Array(n);for(const k of ['sand','path','gully','seagrass','rubble','scarp'])outer[k]=new Uint8Array(n);
 for(let j=0;j<outer.res;j++)for(let i=0;i<outer.res;i++){const k=j*outer.res+i,p=(Math.floor(j*layout.maskRes/outer.res)*layout.maskRes+Math.floor(i*layout.maskRes/outer.res))*4,y=outer.heights[k];outer.path[k]=masks[p];outer.rock[k]=masks[p+2]/255;outer.sand[k]=Math.round((1-outer.rock[k])*Math.max(0,1-Math.abs(y+.7)/6)*255);}
 outer.buildMinMax();const coarseHeight=outer.heightAt.bind(outer),coarseBounds=outer.boundsFor.bind(outer);
 outer.heightAt=(x,z)=>{const w=blend([x,z]),h=coarseHeight(x,z);return w>0?h*(1-w)+core.heightAt(x,z)*w:h;};
 outer.boundsFor=(x0,z0,x1,z1)=>{const b=coarseBounds(x0,z0,x1,z1);if(x1< -496||z1< -496||x0>496||z0>496)return b;const f=core.boundsFor(Math.max(x0,-496),Math.max(z0,-496),Math.min(x1,496),Math.min(z1,496));return [Math.min(b[0],f[0]),Math.max(b[1],f[1])];};
 data.coreTerrain=core;data.terrain=outer;data.coast=layout;data.coastMasks=masks;data.field.terrain=outer;
 const grassRes=1024,grass=new Uint8Array(grassRes*grassRes*4),fine=data.grass;
 for(let j=0;j<grassRes;j++)for(let i=0;i<grassRes;i++){const x=outer.origin+(i+.5)*outer.size/grassRes,z=outer.origin+(j+.5)*outer.size/grassRes,k=(j*grassRes+i)*4,cp=(Math.floor(j*layout.maskRes/grassRes)*layout.maskRes+Math.floor(i*layout.maskRes/grassRes))*4,w=blend([x,z]);let v=masks[cp+1];if(w>0){const fi=Math.max(0,Math.min(fine.res-1,Math.floor((x+512)/1024*fine.res))),fj=Math.max(0,Math.min(fine.res-1,Math.floor((z+512)/1024*fine.res)));v=v*(1-w)+fine.data[(fj*fine.res+fi)*4+1]*w;}grass[k+1]=Math.round(v);}
 data.grass={res:grassRes,data:grass};return data;
}

export function installFineCoreGPU(gpu,data){
 const fine=data.coreTerrain,maps=bakeTerrainMaps(fine);
 const h=new Texture({label:'Museum 1m creek core heights',width:fine.res,height:fine.res,format:'r32float',data:fine.heights,usage:['sample','copyDst']});
 const normal=new Texture({label:'Museum 1m core normal/rock/AO',width:fine.res,height:fine.res,format:'rgba8unorm',data:maps.normal,mips:true,usage:['sample','copyDst']});normal.getGPU();generateMipmaps(normal);
 const mod=gpu.module;mod.bindings.terrainFineHeightTex={texture:h,sampleType:'unfilterable-float'};mod.bindings.terrainFineNormalTex={texture:normal};
 for(const name of ['terrainHeightAt','terrainNormalRock','terrainNormalRockLevel'])mod.code=mod.code.replace('fn '+name+'(','fn '+name+'Coarse(');
 mod.code+=`
fn terrainFineWeight(p:vec2f)->f32{return 1.0-smoothstep(448.0,496.0,max(abs(p.x),abs(p.y)));}
fn terrainFineHeight(p:vec2f)->f32{
 let f=clamp(p+vec2f(511.5),vec2f(0.0),vec2f(1022.999));let q=vec2i(floor(f));let t=fract(f);
 return mix(mix(textureLoad(terrainFineHeightTex,q,0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,0),0).x,t.x),mix(textureLoad(terrainFineHeightTex,q+vec2i(0,1),0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,1),0).x,t.x),t.y);
}
fn terrainHeightAt(p:vec2f)->f32{let w=terrainFineWeight(p);if(w>=1.0){return terrainFineHeight(p);}if(w<=0.0){return terrainHeightAtCoarse(p);}return mix(terrainHeightAtCoarse(p),terrainFineHeight(p),w);}
fn terrainNormalRock(p:vec2f)->vec4f{let s=textureSample(terrainFineNormalTex,smpLinearClamp,(p+512.0)/1024.0);return mix(terrainNormalRockCoarse(p),vec4f(s.xy*2.0-1.0,s.zw),terrainFineWeight(p));}
fn terrainNormalRockLevel(p:vec2f,l:f32)->vec4f{let s=textureSampleLevel(terrainFineNormalTex,smpLinearClamp,(p+512.0)/1024.0,l);return mix(terrainNormalRockLevelCoarse(p,l),vec4f(s.xy*2.0-1.0,s.zw),terrainFineWeight(p));}
`;
 gpu.fineCore={texelMetres:1,blend:[448,496],outerTexelMetres:4,sunShadowInputTexelMetres:16};return gpu;
}
