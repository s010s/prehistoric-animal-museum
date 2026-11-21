// Compact, vertex-colour derivatives of the museum's two licensed and
// screened geological specimens. Original URLs, attribution and checksums are
// in creek/island-ecology.lock.json. Never depend on a remote Vault checkout.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';
import {BufferAttribute, BufferGeometry} from '../vendor/tidewater/src/engine/index.js';
import {parseGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';

const assets = new URL('../creek/assets/',import.meta.url);
const profiles = [['cross-bedded-sandstone',-.23],['conglomerate-outcrop',-.245]];
const transport = new URL('.transport/marine-rock-profiles.bin',assets);

// These photographed UV atlases include wide black gutters, including
// under some triangles in the source. Transfer reliable pigments through
// physical surface neighbours across UV seams instead of sampling a gutter.
function repairPigment(position, normal, samples, weights, used) {
  const nodes=new Map(), representative=new Map();
  for (const i of new Set(used)) {
    const coords=Array.from(position.subarray(i*3,i*3+3)), key=coords.map(x=>Math.round(x*1e5)).join(',');
    if (!nodes.has(key)) nodes.set(key,{coords, normal:normal.subarray(i*3,i*3+3), rgb:[0,0,0], weight:0});
    const node=nodes.get(key);
    for (let k=0;k<3;k++) node.rgb[k]+=samples[i*3+k];
    node.weight+=weights[i];
    representative.set(i,node);
  }
  const good=[...nodes.values()].filter(v=>v.weight);
  if (!good.length) throw Error('No usable pigment in geological specimen');
  for (const node of good) node.rgb=node.rgb.map(c=>c/node.weight);
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for (const {coords} of good) for(let k=0;k<3;k++){
    bounds[k]=Math.min(bounds[k],coords[k]);bounds[k+3]=Math.max(bounds[k+3],coords[k]);
  }
  const cell=Math.max(...bounds.slice(3).map((v,k)=>v-bounds[k]))/22;
  const bins=new Map();
  for (const node of good) {
    const key=node.coords.map(x=>Math.floor(x/cell)).join(',');
    if (!bins.has(key)) bins.set(key,[]);
    bins.get(key).push(node);
  }
  for (const node of nodes.values()) {
    if (node.weight) continue;
    const [ix,iy,iz]=node.coords.map(x=>Math.floor(x/cell));
    let weight=0;
    for (let r=1;weight===0;r++) {
      for(let z=iz-r;z<=iz+r;z++) for(let y=iy-r;y<=iy+r;y++) for(let x=ix-r;x<=ix+r;x++) {
        const bucket=bins.get(x+','+y+','+z);
        if (!bucket) continue;
        for (const other of bucket) {
          let d2=.0001*cell*cell, facing=0;
          for(let k=0;k<3;k++){d2+=(other.coords[k]-node.coords[k])**2;facing+=node.normal[k]*other.normal[k];}
          const w=(.15+.85*Math.max(0,facing))/(d2*d2);
          for(let k=0;k<3;k++) node.rgb[k]+=other.rgb[k]*w;
          weight+=w;
        }
      }
    }
    node.rgb=node.rgb.map(c=>c/weight);
  }
  for(const [i,node] of representative) samples.set(node.rgb,i*3);
  return samples;
}

async function profile(id, base) {
  const bytes=await readFile(new URL('island-'+id+'-vault.glb',assets));
  const gltf=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const {attributes,indices}=gltf.meshes[0][0],position=attributes.POSITION.array;
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(position,3));geometry.setIndex(new BufferAttribute(indices,1));
  geometry.computeVertexNormals();
  const uv=attributes.TEXCOORD_0.array, normal=geometry.attributes.normal.array,count=position.length/3;
  const tex=gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index;
  const image=gltf.images[gltf.textures[tex].source];
  const {data,info}=await sharp(image.bytes).removeAlpha().resize(384,384).raw().toBuffer({resolveWithObject:true});
  // Sample just inside each incident UV triangle; UV island gutters are
  // black and must never bleed into the exposed sediment.
  const colors=new Float32Array(count*3),weights=new Uint16Array(count),visible=[];
  const pigment=new Float32Array(count*3), reliable=new Uint16Array(count);
  for(let i=0;i<indices.length;i+=3) {
    const tri=[indices[i],indices[i+1],indices[i+2]];
    if(tri.some(v=>position[v*3+1]<base))continue;
    visible.push(...tri);
    const mx=tri.reduce((sum,v)=>sum+uv[v*2],0)/3, my=tri.reduce((sum,v)=>sum+uv[v*2+1],0)/3;
    for(const j of tri){
      const u=uv[j*2]*.87+mx*.13,v=uv[j*2+1]*.87+my*.13;
      const x=Math.min(info.width-1,Math.max(0,Math.floor(u*info.width)));
      const y=Math.min(info.height-1,Math.max(0,Math.floor(v*info.height)));
      for(let k=0;k<3;k++)colors[j*3+k]+=data[(y*info.width+x)*info.channels+k]/255;
      weights[j]++;
      const pixel=(y*info.width+x)*info.channels;
      if (.21*data[pixel]+.72*data[pixel+1]+.07*data[pixel+2]>46) {
        for(let k=0;k<3;k++) pigment[j*3+k]+=data[pixel+k]/255;
        reliable[j]++;
      }
    }
  }
  const attrs=new Float32Array(count*6);
  for(let v=0;v<count;v++)for(let k=0;k<3;k++){
    colors[v*3+k]/=Math.max(1,weights[v]);attrs[v*6+k]=normal[v*3+k];attrs[v*6+3+k]=colors[v*3+k];
  }
  repairPigment(position,normal,pigment,reliable,visible);
  const [simplified]=MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(visible),position,3,attrs,6,
    [.03,.03,.03,.22,.22,.22],null,2352,.5,['Permissive']);
  const remap=new Map();
  for(const idx of simplified)if(!remap.has(idx))remap.set(idx,remap.size);
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const i of remap.keys())for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k],position[i*3+k]);bounds[k+3]=Math.max(bounds[k+3],position[i*3+k]);}
  const center=bounds.slice(0,3).map((v,k)=>(v+bounds[k+3])/2), span=Math.max(bounds[3]-bounds[0],bounds[5]-bounds[2]);
  // Contract actual connected edges, preserving winding and the scanned
  // silhouette. Both LODs index the same quantised positions and colours.
  const [coarse]=MeshoptSimplifier.simplify(simplified,position,3,900,.05,[]);
  const out=Buffer.alloc(12+remap.size*12+(simplified.length+coarse.length)*2);
  out.writeUInt32LE(remap.size);out.writeUInt32LE(simplified.length,4);out.writeUInt32LE(coarse.length,8);
  for(const [i,j] of remap)for(let k=0;k<3;k++){
    const off=12+j*12;
    out.writeInt16LE(Math.round((position[i*3+k]-center[k])/span*30000),off+k*2);
    out.writeInt8(Math.round(Math.min(1,Math.max(-1,normal[i*3+k]))*127),off+6+k);
    out.writeUInt8(Math.round(Math.min(1,pigment[i*3+k])*255),off+9+k);
  }
  let offset=12+remap.size*12;
  for (const indices of [simplified,coarse]) for (const index of indices) {
    out.writeUInt16LE(remap.get(index),offset);offset+=2;
  }
  return out;
}

export async function prepareMarineRocks() {
  await MeshoptSimplifier.ready;
  const bytes=Buffer.concat([Buffer.from('MRL2'),...await Promise.all(profiles.map(([id,base])=>profile(id,base)))]);
  await mkdir(new URL('.transport/',assets),{recursive:true});
  const old=await readFile(transport).catch(()=>null);
  if(!old||!bytes.equals(old))await writeFile(transport,bytes);
}
