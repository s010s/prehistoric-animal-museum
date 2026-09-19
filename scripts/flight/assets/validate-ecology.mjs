import fs from 'node:fs/promises'
import sharp from 'sharp'
const base='src/flight-experience/assets/ecology-r5'
process.env.MUSEUM_LOOKDEV_OUTPUT=base
await import('./validate-lookdev-r4.mjs')
const manifest=JSON.parse(await fs.readFile(`${base}/manifest.json`,'utf8'))
const silhouettes=[]
for(const asset of manifest.assets.filter(a=>a.kind==='plant'))for(const view of [0,1,4]){
 const {data,info}=await sharp(`${base}/${asset.id}-${view}.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 let covered=0,black=0
 for(let i=0;i<data.length;i+=4)if(data[i+3]>128){covered++;if(Math.max(data[i],data[i+1],data[i+2])<20)black++}
 if(info.width!==512||info.height!==512||covered<500)throw new Error(`Missing usable silhouette: ${asset.id}/${view}`)
 if(black/covered>.05)throw new Error(`Black baked foliage exceeds 5% of coverage: ${asset.id}/${view} ${black}/${covered}`)
 silhouettes.push({asset:asset.id,view,covered,black})
}
console.log(JSON.stringify({sameSourceCanopy:silhouettes},null,2))
