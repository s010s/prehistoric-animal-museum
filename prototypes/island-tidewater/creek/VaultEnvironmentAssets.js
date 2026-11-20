import {BufferAttribute, BufferGeometry} from '../vendor/tidewater/src/engine/index.js';
import {loadGLB, parseGLB, decodeImage} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';

const sources = {
 ichthyornis: new URL('./assets/environment-ichthyornis-vault.glb', import.meta.url),
 sapeornis: new URL('./assets/environment-sapeornis-vault.glb', import.meta.url),
 meganeura: new URL('./assets/environment-meganeura-vault.glb', import.meta.url),
 juracimbrophlebia: new URL('./assets/environment-juracimbrophlebia-vault.glb', import.meta.url),
 stenodictya: new URL('./assets/environment-stenodictya-vault.glb', import.meta.url),
 falcatus: new URL('./assets/environment-falcatus-vault.glb', import.meta.url),
 cheiracanthus: new URL('./assets/environment-cheiracanthus-vault.glb', import.meta.url),
};

export async function loadReviewedFauna(kind, signal) {
 const url=sources[kind].href;
 if (!signal || globalThis.__assetFile) return loadGLB(url);
 const res=await fetch(url,{signal});
 if (!res.ok) throw Error(`Vault ${kind} GLB returned ${res.status}`);
 const buffer=await res.arrayBuffer();
 signal.throwIfAborted();
 return parseGLB(buffer);
}

// Source art uses either one albedo atlas or a small set of material colors.
// The texture and UVs remain independent of the museum's local motion field.
export async function reviewedAlbedo(gltf, kind, signal) {
 const maps = new Set(gltf.materials.flatMap(m => m.pbrMetallicRoughness?.baseColorTexture?.index ?? []));
 if (!maps.size) return null;
 if (maps.size !== 1) throw Error(`Vault atlas changed for ${kind}`);
 const source = gltf.textures[[...maps][0]].source;
 const image = gltf.images[source];
 const px = await decodeImage(image.bytes, image.mimeType);
 signal?.throwIfAborted();
 const texture = new Texture({label:`Vault ${kind} albedo`, width:px.width, height:px.height, format:'rgba8unorm-srgb',
  data:px.data, mips:true, usage:['sample','copyDst'], sampler:'anisoRepeat'});
 try {
  texture.getGPU();
  generateMipmaps(texture);
  return texture;
 } catch (error) {
  texture.destroy();
  throw error;
 }
}

export function reviewedGeometry(gltf, transform, weights, bodyWeights) {
 const sources = [];
 let vertices = 0, triangles = 0;
 for (const node of gltf.nodes) {
  if (node.mesh === undefined) continue;
  if (node.s.some(v=>v!==1) || node.r.some((v,i)=>v!==(i===3?1:0))) throw Error(`Vault transform must be baked for ${node.name}`);
  for (const p of gltf.meshes[node.mesh]) {
   const count = p.attributes.POSITION.array.length / 3;
   const indexCount = p.indices?.length ?? count;
   if (p.mode !== 4 || indexCount % 3) throw Error(`Vault topology changed for ${node.name}`);
   sources.push({node, p, count, indexCount});
   vertices += count;
   triangles += indexCount / 3;
  }
 }
 if (!vertices || !triangles) throw Error('Empty reviewed Vault mesh');
 const positions = new Float32Array(vertices*3), normals = new Float32Array(vertices*3), colors = new Float32Array(vertices*3);
 const uv = new Float32Array(vertices*2), indices = new Uint32Array(triangles*3);
 const local = weights ? new Float32Array(vertices*4) : null;
 const body = bodyWeights ? new Float32Array(vertices*4) : null;
 let v0 = 0, i0 = 0, rebuildNormals = false;
 for (const {node,p,count,indexCount} of sources) {
  const {POSITION,NORMAL,TEXCOORD_0} = p.attributes;
  const color = (gltf.materials[p.material]?.pbrMetallicRoughness?.baseColorFactor ?? [1,1,1]).slice(0,3);
  if (TEXCOORD_0) uv.set(TEXCOORD_0.array,v0*2);
  for (let v=0; v<count; v++) {
   const i=v*3, j=(v0+v)*3, raw=POSITION.array;
   const position=transform(raw[i]+node.t[0],raw[i+1]+node.t[1],raw[i+2]+node.t[2], false);
   positions.set(position,j);
   if (NORMAL) normals.set(transform(NORMAL.array[i],NORMAL.array[i+1],NORMAL.array[i+2],true), j);
   else rebuildNormals = true;
   colors.set(color,j);
   if (local) local.set(weights(position,node.name), (v0+v)*4);
   if (body) body.set(bodyWeights(position,node.name), (v0+v)*4);
  }
  for (let i=0;i<indexCount;i++) indices[i0+i]=v0+(p.indices?.[i] ?? i);
  i0+=indexCount;
  v0+=count;
 }
 const geometry=new BufferGeometry();
 geometry.setAttribute('position',new BufferAttribute(positions,3));
 geometry.setAttribute('normal',new BufferAttribute(normals,3));
 geometry.setAttribute('color',new BufferAttribute(colors,3));
 geometry.setAttribute('uv',new BufferAttribute(uv,2));
 if (local) geometry.setAttribute('aWing',new BufferAttribute(local,4));
 if (body) geometry.setAttribute('aFlightBody',new BufferAttribute(body,4));
 geometry.setIndex(new BufferAttribute(indices,1));
 if (rebuildNormals) geometry.computeVertexNormals();
 geometry.computeBoundingSphere();
 return geometry;
}
