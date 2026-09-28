// Reuse the project's existing Poly Haven CC0 fir bark textures, without resampling.
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../public/assets/',import.meta.url),b=readFileSync(new URL('fir-a-spatial-near-layered.glb',root));
const length=b.readUInt32LE(12),gltf=JSON.parse(b.subarray(20,20+length)),bin=b.subarray(28+length);
for(const [source,target] of [['fir_tree_01_bark_diff','albedo'],['fir_tree_01_bark_nor_gl','normal'],['fir_tree_01_bark_rough','rough']]){const im=gltf.images.find(i=>i.name===source),v=gltf.bufferViews[im.bufferView];writeFileSync(new URL(`fir-bark-${target}.webp`,root),bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));}
