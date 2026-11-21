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
    }
  }
  const attrs=new Float32Array(count*6);
  for(let v=0;v<count;v++)for(let k=0;k<3;k++){
    colors[v*3+k]/=Math.max(1,weights[v]);attrs[v*6+k]=normal[v*3+k];attrs[v*6+3+k]=colors[v*3+k];
  }
  const [simplified]=MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(visible),position,3,attrs,6,
    [.03,.03,.03,.22,.22,.22],null,2352,.5,['Permissive']);
  const remap=new Map();
  for(const idx of simplified)if(!remap.has(idx))remap.set(idx,remap.size);
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const i of remap.keys())for(let k=0;k<3;k++){bounds[k]=Math.min(bounds[k],position[i*3+k]);bounds[k+3]=Math.max(bounds[k+3],position[i*3+k]);}
  const center=bounds.slice(0,3).map((v,k)=>(v+bounds[k+3])/2), span=Math.max(bounds[3]-bounds[0],bounds[5]-bounds[2]);
  const out=Buffer.alloc(8+remap.size*12+simplified.length*2);
  out.writeUInt32LE(remap.size);out.writeUInt32LE(simplified.length,4);
  for(const [i,j] of remap)for(let k=0;k<3;k++){
    const off=8+j*12;
    out.writeInt16LE(Math.round((position[i*3+k]-center[k])/span*30000),off+k*2);
    out.writeInt8(Math.round(Math.min(1,Math.max(-1,normal[i*3+k]))*127),off+6+k);
    out.writeUInt8(Math.round(Math.min(1,colors[i*3+k])*255),off+9+k);
  }
  for(let i=0;i<simplified.length;i++)out.writeUInt16LE(remap.get(simplified[i]),8+remap.size*12+i*2);
  return out;
}

export async function prepareMarineRocks() {
  await MeshoptSimplifier.ready;
  const bytes=Buffer.concat(await Promise.all(profiles.map(([id,base])=>profile(id,base))));
  await mkdir(new URL('.transport/',assets),{recursive:true});
  const old=await readFile(transport).catch(()=>null);
  if(!old||!bytes.equals(old))await writeFile(transport,bytes);
}
