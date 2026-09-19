import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'
const base = 'src/flight-experience/assets/landscape'
const manifest = JSON.parse(await fs.readFile(`${base}/manifest.json`, 'utf8'))
const bytes = await fs.readFile(`${base}/landscape-samples.glb`)
if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Landscape sample hash mismatch')
if (manifest.reviewStatus !== 'needs_review' || manifest.approval !== null) throw new Error('Sample assets cannot be automatically approved')
const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString()), binary = bytes.subarray(28 + length)
if ((json.skins?.length ?? 0) !== 0 || (json.animations?.length ?? 0) !== 0) throw new Error('Static sample unexpectedly contains rigs or animation')
let triangles = 0, decodedTextureBytes = 0
for (const asset of manifest.assets) {
  if (!(asset.physicalHeight > 0 && asset.footprint.radius > 0)) throw new Error('Missing physical collision dimensions')
  for (const lod of asset.lods) {
    const node = json.nodes.find(node => node.name === lod.name)
    if (!node || node.mesh === undefined) throw new Error(`Missing same-source LOD ${lod.name}`)
    const count = json.meshes[node.mesh].primitives.reduce((sum, primitive) => sum + json.accessors[primitive.indices].count / 3, 0)
    if (count > 6000 || count <= 0) throw new Error(`Out of sample triangle budget: ${lod.name}: ${count}`)
    triangles += count
  }
}
for (const image of json.images ?? []) {
  const view = json.bufferViews[image.bufferView], imageBytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), metadata = await sharp(imageBytes).metadata()
  if (metadata.width > 1024 || metadata.height > 1024) throw new Error('Unexpected texture size')
  decodedTextureBytes += metadata.width * metadata.height * 4
}
for (const asset of manifest.assets.filter(asset => asset.kind === 'plant')) for (const view of [0, 1, 4]) {
  const data = await fs.readFile(`${base}/${asset.id}-${view}.png`), metadata = await sharp(data).metadata()
  if (metadata.width !== 256 || metadata.height !== 256 || !metadata.hasAlpha) throw new Error('Invalid same-source silhouette')
}
console.log(JSON.stringify({ reviewStatus: manifest.reviewStatus, fileBytes: bytes.length, sourceLodTriangles: triangles, runtimeFarTreeTriangles: 6, materialCount: json.materials.length, textureCount: json.images.length, decodedTextureBytes, estimatedTextureGpuWithMipBytes: Math.ceil(decodedTextureBytes * 4 / 3), sourceImpostors: 12, skinCount: 0 }, null, 2))
