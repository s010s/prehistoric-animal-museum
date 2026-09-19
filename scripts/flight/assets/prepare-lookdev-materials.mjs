/** Local-only candidate preparation. Metadata from the official Poly Haven files API.
 * Reuses explicit metadata saved in the ignored review directory, never downloads code.
 */
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const source='.flight-evidence/r4/material-sources', out='src/flight-experience/assets/lookdev-materials'
await mkdir(out,{recursive:true})
const entries=[]
for(const [id,role,metres] of [['aerial_ground_rock','rock',20],['sandy_gravel_02','dry-soil',2.5],['coast_sand_01','wet-sand',15],['mud_forest','river-mud',2.3],['forest_ground_04','forest-floor',3.2],['leafy_grass','groundcover',2]]){
 let metadata
 try{metadata=JSON.parse(await readFile(`${source}/${id}.json`,'utf8'))}
 catch{const response=await fetch(`https://api.polyhaven.com/files/${id}`);if(!response.ok)throw Error(`metadata ${id}: ${response.status}`);metadata=await response.json();await writeFile(`${source}/${id}.json`,JSON.stringify(metadata,null,2)+'\n')}
 const maps={}
 for(const [key,channel] of [['Diffuse','albedo'],['nor_gl','normal'],['arm','arm']]){
  const file=metadata[key]['1k'].jpg
  let bytes
  try{bytes=await readFile(`${source}/${id}-${channel}.jpg`)}
  catch{const response=await fetch(file.url);if(!response.ok)throw Error(`${response.status}: ${file.url}`);bytes=Buffer.from(await response.arrayBuffer());await writeFile(`${source}/${id}-${channel}.jpg`,bytes)}
  if(createHash('md5').update(bytes).digest('hex')!==file.md5)throw Error(`source checksum ${id}/${channel}`)
  const encoded=await sharp(bytes).resize(512,512).webp({quality:channel==='normal'?95:88}).toBuffer()
  const path=`${id}-${channel}.webp`;await writeFile(`${out}/${path}`,encoded)
  maps[channel]={path,sourceUrl:file.url,downloadBytes:bytes.length,bytes:encoded.length,sha256:createHash('sha256').update(encoded).digest('hex'),colorSpace:channel==='albedo'?'srgb':'linear-data'}
 }
 entries.push({id,role,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',metresPerRepeat:metres,scaleStatus:'source physical width verified against Poly Haven asset page',maps})
}
await writeFile(`${out}/manifest.json`,JSON.stringify({reviewStatus:'needs_review',approval:null,scope:'flight terrain six-source PBR candidate',licenseSource:'https://polyhaven.com/license',modifications:'512px WebP derivatives; no baked sun; OpenGL tangent normal; ARM data',estimatedGpuBytesWithMips:4*3*512*512*4*4/3,entries},null,2)+'\n')
