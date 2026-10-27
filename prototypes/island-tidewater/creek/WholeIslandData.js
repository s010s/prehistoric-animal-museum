import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import {bakeTerrainMaps} from '../vendor/tidewater/src/world/terrain/TerrainBake.js';
import {bedRelief} from './BedRelief.js';
import {sculptShallowCove} from './ShallowCove.js';
import {extendCoastalShelf} from './CoastalShelf.js';
import {installIslandWater} from './IslandWaterField.js';
import {applySampleTerrain} from './SampleTerrain.js';
// Explicit URLs keep every generated file in the production asset graph.
const islandAssets={
 'island-layout.json':new URL('./assets/island-layout.json',import.meta.url),
 'island-habitat.bin':new URL('./assets/island-habitat.bin',import.meta.url),
 'island-source-water.bin':new URL('./assets/island-source-water.bin',import.meta.url),
 'island-island-heights.bin':new URL('./assets/island-island-heights.bin',import.meta.url),
 'island-north-heights.bin':new URL('./assets/island-north-heights.bin',import.meta.url),
 'island-east-heights.bin':new URL('./assets/island-east-heights.bin',import.meta.url),
 'island-source-heights.bin':new URL('./assets/island-source-heights.bin',import.meta.url),
};
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function terrainGrid(g,heights,field,masks,world){
 const rockAt=(x,z)=>{const fx=Math.max(0,Math.min(world.maskRes-1.001,(x+world.size/2)/world.size*world.maskRes-.5)),fz=Math.max(0,Math.min(world.maskRes-1.001,(z+world.size/2)/world.size*world.maskRes-.5)),i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,k=(j*world.maskRes+i)*4;
  return ((masks[k+2]*(1-u)+masks[k+6]*u)*(1-v)+(masks[k+world.maskRes*4+2]*(1-u)+masks[k+(world.maskRes+1)*4+2]*u)*v)/255;};
 const t=Object.create(TerrainData.prototype),n=g.res*g.res;Object.assign(t,{...g,origin:-g.size/2,heights,pads:[],rockSites:[],paths:[],timings:{source:'museum '+g.id}});t.rock=new Float32Array(n);const zero=new Uint8Array(n);for(const key of ['sand','path','gully','seagrass','rubble','scarp'])t[key]=zero; // read-only until a writer explicitly splits its channel
 // Habitat semantics are32m samples, not32m parcels. Bilinear reconstruction
 // precedes the high-resolution normal bake, just as it does for grass cover.
 for(let j=0;j<g.res;j++)for(let i=0;i<g.res;i++){const k=j*g.res+i,x=g.center[0]-g.size/2+(i+.5)*g.texel,z=g.center[1]-g.size/2+(j+.5)*g.texel;t.rock[k]=rockAt(x,z);const f=field.sample(x,z);t.heights[k]=bedRelief(x,z,field.tributarySource.sculpt(x,z,field.headwater.removeLegacyGrain(x,z,t.heights[k])),f[1]<1?Math.max(-.7,f[0]):-.7,g.texel);if(g.id==='source'){t.heights[k]=field.headwater.sculpt(x,z,t.heights[k]);if(Math.hypot(x-field.headwater.origin.x,z-field.headwater.origin.z)<8)t.rock[k]=Math.max(t.rock[k],.7);}}
 t.buildMinMax();const h=t.heightAt.bind(t),b=t.boundsFor.bind(t);t.heightAt=(x,z)=>h(x-g.center[0],z-g.center[1]);t.boundsFor=(x0,z0,x1,z1)=>b(x0-g.center[0],z0-g.center[1],x1-g.center[0],z1-g.center[1]);return t;
}
export async function expandWholeIsland(data){
 const get=async(name,json=false)=>{const url=islandAssets[name];if(!url)throw Error('Unknown island asset '+name);const r=await fetch(url);if(!r.ok)throw Error('Island asset '+r.status);return json?r.json():r.arrayBuffer();};
 const world=await get('island-layout.json',true),[mb,sw,...hb]=await Promise.all([get('island-habitat.bin'),get('island-source-water.bin'),...world.grids.map(g=>get(g.file))]),masks=new Uint8Array(mb);
 installIslandWater(data.field,world,new Float32Array(sw));
 // Extract the local input before the regional arrays are sculpted. The
 // .5m east-source patch adds one array layer, no new sampled binding.
 const eg=world.grids[2],eh=new Float32Array(hb[2]),ec=data.field.tributarySource.center;
 const cubic=(a,b,c,d,t)=>b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
 const sampleEast=(x,z)=>{const fx=(x-eg.center[0]+eg.size/2)/eg.texel-.5,fz=(z-eg.center[1]+eg.size/2)/eg.texel-.5,i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,rows=[];
  for(let k=-1;k<=2;k++){const p=(j+k)*eg.res+i;rows.push(cubic(eh[p-1],eh[p],eh[p+1],eh[p+2],u));}return cubic(...rows,v);};
 const eastInput=new Float32Array(512*512);for(let j=0;j<512;j++)for(let i=0;i<512;i++)eastInput[j*512+i]=sampleEast(ec[0]-128+(i+.5)*.5,ec[1]-128+(j+.5)*.5);
 const eastSource=terrainGrid({id:'east-source',center:ec,size:256,res:512,texel:.5},eastInput,data.field,masks,world);
 const grids=world.grids.map((g,i)=>terrainGrid(g,new Float32Array(hb[i]),data.field,masks,world)),global=grids[0],regional=data.terrain,source=grids[3];
 regional.center=[0,0];regional.id='creek-region';
 for(let j=0;j<regional.res;j++)for(let i=0;i<regional.res;i++){
  const x=regional.origin+(i+.5)*regional.texel,z=regional.origin+(j+.5)*regional.texel,k=j*regional.res+i;
  regional.heights[k]=data.field.headwater.removeLegacyGrain(x,z,regional.heights[k]);
 }
 regional.buildMinMax();
 data.cove=sculptShallowCove(regional,global,data.coast.coast,[grids[1],grids[2]]);global.museumCove=data.cove;
 const coastalPatches=[regional,grids[1],grids[2]],readCoast=(x,z)=>{let h=global.heightAt(x,z);for(const p of coastalPatches){const d=Math.max(Math.abs(x-p.center[0]),Math.abs(z-p.center[1])),w=1-smooth(3800,4080,d);if(w>0)h=h*(1-w)+p.heightAt(x,z)*w;}return h;};
 data.cove.continuous=extendCoastalShelf([global,...coastalPatches],readCoast,data.field);
 data.cove.id='museum-continuous-shallow-shelf-v3';
 // Compose all resolutions identically on CPU and GPU. Broad overlaps prevent
 // seams in both the surface and bounds; the original fine core stays intact.
 const finePatches=[source,eastSource],patches=[regional,grids[1],grids[2]],baseH=global.heightAt.bind(global),baseB=global.boundsFor.bind(global);
 global.heightAt=(x,z)=>{let h=baseH(x,z);for(const p of patches){const d=Math.max(Math.abs(x-p.center[0]),Math.abs(z-p.center[1])),w=1-smooth(3800,4080,d);if(w>0)h=h*(1-w)+p.heightAt(x,z)*w;}for(const p of finePatches){const d=Math.max(Math.abs(x-p.center[0]),Math.abs(z-p.center[1])),w=1-smooth(112,124,d);if(w>0)h=h*(1-w)+p.heightAt(x,z)*w;}return h;};
 global.boundsFor=(x0,z0,x1,z1)=>{let [lo,hi]=baseB(x0,z0,x1,z1);for(const p of [...patches,...finePatches]){const s=p.size/2,c=p.center;if(x1<c[0]-s||x0>c[0]+s||z1<c[1]-s||z0>c[1]+s)continue;const b=p.boundsFor(x0,z0,x1,z1);lo=Math.min(lo,b[0]);hi=Math.max(hi,b[1]);}return [lo,hi];};
 data.island=world;data.islandMasks=masks;data.regionTerrains=patches;data.sourceTerrain=source;data.eastSourceTerrain=eastSource;data.terrain=global;data.field.terrain=global;
 // The legacy export used a lake's level over a rectangular bounding box.
 // Recover that lost land cover from the same habitat rules, with the actual
 // signed water extent. Blend back into the untouched mask over 96m outside
 // the old boxes; never extend this correction into the protected creek core.
 let repaired=0;const wf=[0,0,0,0],maskStep=world.size/world.maskRes;
 for(let j=0;j<world.maskRes;j++)for(let i=0;i<world.maskRes;i++){
  const x=-world.size/2+(i+.5)*maskStep,z=-world.size/2+(j+.5)*maskStep;
  let w=0;for(const lake of world.lakes){const edge=Math.max(Math.abs(x-lake.center[0])-lake.rx*1.75,Math.abs(z-lake.center[1])-lake.rz*1.75);w=Math.max(w,1-smooth(0,96,edge));}
  if(w===0)continue;
  const k=(j*world.maskRes+i)*4,h=global.heightAt(x,z);
  const nx=(global.heightAt(x+2,z)-global.heightAt(x-2,z))/4,nz=(global.heightAt(x,z+2)-global.heightAt(x,z-2))/4;
  const ny=1/Math.hypot(nx,1,nz);data.field.sample(x,z,wf);
  const water=wf[1]<=0?Math.max(-.7,wf[0]):-.7;
  const heath=1-smooth(.5,1.2,Math.hypot((x-3400)/2700,(z+5250)/2400));
  const density=smooth(.70,.94,ny)*smooth(.18,1.2,h-water)*(1-masks[k]/255)*(.38+.46*(1-masks[k+3]/255))*(1-heath*.68);
  const old=masks[k+1],next=Math.round(old*(1-w)+density*255*w);
  if(next!==old){masks[k+1]=next;repaired++;}
 }
 data.habitatRepair={texels:repaired,maskMetres:maskStep,outerBlendMetres:96,scope:'two legacy lake water-level boxes; actual water + original slope/trail/wood/heath rules; original assets unchanged'};
 // The native grass pool only submits the neighbourhood of the camera. The
 // global occupancy grid is coarse; roots always sample the composed surface.
 const grass=new Uint8Array(masks.length);for(let i=0;i<masks.length;i+=4)grass[i+1]=masks[i+1];data.grass={res:world.maskRes,data:grass};data.coverTerrain=global;
 applySampleTerrain(data);
 return data;
}

export function installIslandTerrainGPU(gpu,data){
 const N=2048,layers=[data.terrain,...data.regionTerrains],heights=new Float32Array(N*N*layers.length),normals=new Uint8Array(N*N*4*layers.length);
 layers.forEach((t,i)=>{heights.set(t.heights,i*N*N);normals.set(bakeTerrainMaps(t).normal,i*N*N*4);});
 const make=(label,n,depth,format,bytes,mips=false)=>{const t=new Texture({label,width:n,height:n,depth,dimension:'2d-array',format,data:bytes,mips,usage:['sample','copyDst']});t.getGPU();if(mips)generateMipmaps(t);return t;};
 const oldH=gpu.heightTexture,oldN=gpu.normalTexture;gpu.heightTexture=make('Museum multiresolution heights',N,4,'r32float',heights);gpu.normalTexture=make('Museum regional normals',N,4,'rgba8unorm',normals,true);
 const fine=[data.coreTerrain,data.sourceTerrain,data.eastSourceTerrain,...data.sampleTerrains],FH=new Float32Array(1024*1024*fine.length),FN=new Uint8Array(1024*1024*4*fine.length);
 fine.forEach((t,k)=>{const normal=bakeTerrainMaps(t).normal;for(let j=0;j<1024;j++)for(let i=0;i<1024;i++){
  const source=Math.min(j,t.res-1)*t.res+Math.min(i,t.res-1),target=k*1024*1024+j*1024+i;
  FH[target]=t.heights[source];FN.set(normal.subarray(source*4,source*4+4),target*4);
 }});
 const fineH=make('Museum fine creek and source',1024,fine.length,'r32float',FH),fineN=make('Museum fine normals',1024,fine.length,'rgba8unorm',FN,true),mod=gpu.module;
 const localFine=[data.sourceTerrain,data.eastSourceTerrain,...data.sampleTerrains].map((t,i)=>({...t,layer:i+1,inner:t.inner??112,outer:t.outer??124}));
 const noFiner=t=>localFine.filter(p=>p.layer>t.layer).map(p=>`&&max(abs(p.x-(${p.center[0].toFixed(7)})),abs(p.y-(${p.center[1].toFixed(7)})))>=${p.outer.toFixed(1)}`).join('');
 mod.bindings.terrainHeightTex={texture:gpu.heightTexture,sampleType:'unfilterable-float'};mod.bindings.terrainNormalTex={texture:gpu.normalTexture};mod.bindings.terrainFineHeightTex={texture:fineH,sampleType:'unfilterable-float'};mod.bindings.terrainFineNormalTex={texture:fineN};gpu.retiredTerrainTextures=[oldH,oldN];
 mod.code=mod.code.replace(/fn terrainHeightAt\([\s\S]*?(?=\/\/ filtered normal)/,`fn terrainLayerHeight(p:vec2f,c:vec2f,size:f32,layer:i32)->f32{let f=clamp((p-c+size*.5)/size*2048.0-.5,vec2f(0.0),vec2f(2046.999));let q=vec2i(floor(f));let t=fract(f);return mix(mix(textureLoad(terrainHeightTex,q,layer,0).x,textureLoad(terrainHeightTex,q+vec2i(1,0),layer,0).x,t.x),mix(textureLoad(terrainHeightTex,q+vec2i(0,1),layer,0).x,textureLoad(terrainHeightTex,q+vec2i(1,1),layer,0).x,t.x),t.y);}
 fn terrainFineWeight(p:vec2f)->f32{return 1.0-smoothstep(448.0,496.0,max(abs(p.x),abs(p.y)));}
 fn terrainFineAt(p:vec2f,c:vec2f,size:f32,res:f32,layer:i32)->f32{let f=clamp((p-c+size*.5)/size*res-.5,vec2f(0.0),vec2f(res-1.001));let q=vec2i(floor(f));let t=fract(f);return mix(mix(textureLoad(terrainFineHeightTex,q,layer,0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,0),layer,0).x,t.x),mix(textureLoad(terrainFineHeightTex,q+vec2i(0,1),layer,0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,1),layer,0).x,t.x),t.y);}
 fn terrainHeightAtCoarse(p:vec2f)->f32{return terrainLayerHeight(p,vec2f(0.0),32768.0,0);}
 fn terrainHeightAt(p:vec2f)->f32{if(max(abs(p.x),abs(p.y))>16376.0){return -90.0;}if(max(abs(p.x),abs(p.y))<=448.0){return terrainFineAt(p,vec2f(0.0),1024.0,1024.0,0);}
 ${[...localFine].reverse().map(t=>`if(max(abs(p.x-(${t.center[0].toFixed(7)})),abs(p.y-(${t.center[1].toFixed(7)})))<=${t.inner.toFixed(1)}${noFiner(t)}){return terrainFineAt(p,vec2f(${t.center.map(x=>x.toFixed(7)).join(',')}),${t.size.toFixed(1)},${t.res.toFixed(1)},${t.layer});}`).join('')}
 var h=terrainHeightAtCoarse(p);
 ${data.regionTerrains.map((p,i)=>`{let c=vec2f(${p.center.map(x=>x.toFixed(7)).join(',')});let w=1.0-smoothstep(3800.0,4080.0,max(abs(p.x-c.x),abs(p.y-c.y)));if(w>0.0){var rh=terrainLayerHeight(p,c,8192.0,${i+1});${i===0?'let f=terrainFineWeight(p);if(f>0.0){rh=mix(rh,terrainFineAt(p,vec2f(0.0),1024.0,1024.0,0),f);}':''}h=mix(h,rh,w);}}`).join('\n')}
 ${localFine.map(t=>`{let c=vec2f(${t.center.map(x=>x.toFixed(7)).join(',')});let w=1.0-smoothstep(${t.inner.toFixed(1)},${t.outer.toFixed(1)},max(abs(p.x-c.x),abs(p.y-c.y)));if(w>0.0){h=mix(h,terrainFineAt(p,c,${t.size.toFixed(1)},${t.res.toFixed(1)},${t.layer}),w);}}`).join('\n')}return h;}
 `);
 // Explicit gradients permit skipping inactive maps without changing the
 // physical mip footprint. Previously every terrain pixel read every region.
 const normalBody=fragment=>{
  const sample=(tex,uv,layer,scale)=>fragment?`textureSampleGrad(${tex},smpLinearClamp,${uv},${layer},dx/${scale},dy/${scale})`:`textureSampleLevel(${tex},smpLinearClamp,${uv},${layer},l)`;
  const fineSample=t=>sample('terrainFineNormalTex',`clamp((p-vec2f(${t.center.map(x=>x.toFixed(7)).join(',')})+${(t.size/2).toFixed(1)})/${(t.texel*1024).toFixed(1)},vec2f(.00048828125),vec2f(${((t.res-.5)/1024).toFixed(10)}))`,t.layer,(t.texel*1024).toFixed(1));
  const decode='return vec4f(s.xy*2.0-1.0,s.zw);';
  let code=fragment?'let dx=dpdx(p);let dy=dpdy(p);':'';
  code+=`if(max(abs(p.x),abs(p.y))<=448.0){let s=${sample('terrainFineNormalTex','(p+512.0)/1024.0',0,'1024.0')};${decode}}`;
  for(const t of [...localFine].reverse())code+=`if(max(abs(p.x-(${t.center[0].toFixed(7)})),abs(p.y-(${t.center[1].toFixed(7)})))<=${t.inner.toFixed(1)}${noFiner(t)}){let s=${fineSample(t)};${decode}}`;
  code+=`var s=${sample('terrainNormalTex','(p+16384.0)/32768.0',0,'32768.0')};`;
  for(const [i,t]of data.regionTerrains.entries())code+=`{let c=vec2f(${t.center.map(x=>x.toFixed(7)).join(',')});let w=1.0-smoothstep(3800.0,4080.0,max(abs(p.x-c.x),abs(p.y-c.y)));if(w>0.0){s=mix(s,${sample('terrainNormalTex','(p-c+4096.0)/8192.0',i+1,'8192.0')},w);}}`;
  code+=`let fw=terrainFineWeight(p);if(fw>0.0){s=mix(s,${sample('terrainFineNormalTex','(p+512.0)/1024.0',0,'1024.0')},fw);}`;
  for(const t of localFine)code+=`{let w=1.0-smoothstep(${t.inner.toFixed(1)},${t.outer.toFixed(1)},max(abs(p.x-(${t.center[0].toFixed(7)})),abs(p.y-(${t.center[1].toFixed(7)}))));if(w>0.0){s=mix(s,${fineSample(t)},w);}}`;
  return code+decode;
 };
 const normalCode=`fn terrainNormalRockLevel(p:vec2f,l:f32)->vec4f{${normalBody(false)}}
 fn terrainNormalRock(p:vec2f)->vec4f{${normalBody(true)}}
 `;
 mod.code=mod.code.replace(/fn terrainNormalRock\([\s\S]*?(?=fn terrainNormalAt)/,normalCode);
 gpu.fineCore={texelMetres:1,headwaterTexelMetres:.5,eastSourceTexelMetres:.5,fineLayers:fine.length,sampleLayers:data.sampleTerrains.map(t=>({id:t.id,texel:t.texel,size:t.size})),regionalTexelMetres:4,outerTexelMetres:16,layers:4,sampledTextureBindingsUnchanged:true};return gpu;
}
