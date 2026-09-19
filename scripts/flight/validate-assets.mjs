import fs from 'node:fs/promises'
import crypto from 'node:crypto'
const manifest = JSON.parse(await fs.readFile('src/flight-experience/assets/manifest.json', 'utf8'))
for (const [path, expected] of [[manifest.source, manifest.sourceSha256], [manifest.output, manifest.sha256], ...manifest.sharedAssets.map(asset => [asset.source, asset.sha256])]) {
  const bytes = await fs.readFile(path)
  const actual = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`Flight asset checksum differs: ${path}`)
}
const file = JSON.parse(await fs.readFile(manifest.output, 'utf8'))
if (file.name !== 'Glide' || file.duration !== 4 || file.tracks.length !== 375) throw new Error('Unexpected glide contract')
if (manifest.reviewStatus !== 'approved' && manifest.approval !== null) throw new Error('Unreviewed asset has an approval')
console.log(`Flight asset hashes and animation contract verified; review: ${manifest.reviewStatus}.`)

const landscape = JSON.parse(await fs.readFile('src/flight-experience/assets/landscape/manifest.json','utf8'))
const landscapeBytes = await fs.readFile('src/flight-experience/assets/landscape/landscape-samples.glb')
if(crypto.createHash('sha256').update(landscapeBytes).digest('hex') !== landscape.sha256)throw new Error('Landscape candidate checksum differs')
if(landscape.reviewStatus !== 'needs_review' || landscape.approval !== null)throw new Error('Landscape samples require explicit human approval')
if(landscape.assets.length !== 8 || landscape.assets.some(asset=>asset.lods.length!==3))throw new Error('Landscape sample family/LOD contract differs')
console.log(`Landscape candidate verified: ${landscape.assets.length} samples; ${landscapeBytes.length} bytes; review needs_review.`)
