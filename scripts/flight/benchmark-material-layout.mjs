// Offline feasibility only. Native Sharp timings are NOT browser decode timings.
import sharp from 'sharp'
import fs from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {unpackMaterialAtlas} from '../../src/flight-experience/lookdev/material-array.ts'
const rows=[]
for(const id of ['albedo','gaussian','normal','arm']){
 const source=`src/flight-experience/assets/lookdev-materials/${id}-atlas.webp`,encoded=await fs.readFile(source)
 const start=performance.now(),decoded=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true}),decodedAt=performance.now()
 const layers=unpackMaterialAtlas(decoded.data,decoded.info.width,decoded.info.height,6),unpackedAt=performance.now()
 rows.push({id,source,encodedBytes:encoded.length,decodedAtlasBytes:decoded.data.length,layerBaseBytes:layers.byteLength,layerGzipBytes:gzipSync(layers).length,layerSha256:createHash('sha256').update(layers).digest('hex'),nativeSharpDecodeMs:decodedAt-start,nodeUnpackMs:unpackedAt-decodedAt,format:{version:1,width:512,height:512,layers:6,channels:4,component:'uint8',colorSpace:id==='albedo'?'sRGB':'linear',orientation:'matches unpackMaterialAtlas, bottom-up per layer',mips:'not included in offline base; each GPU array layer owns its mip chain'}})
}
console.log(JSON.stringify({scope:'offline feasibility; not browser, not GPU measurement',rows,decision:'Keep current compressed source atlases unless a headed-browser transfer/decode experiment demonstrates a net benefit. These measurements do not justify shipping raw layer containers.'},null,2))
