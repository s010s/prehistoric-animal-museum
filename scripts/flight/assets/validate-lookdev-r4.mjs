import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'
const base = process.env.MUSEUM_LOOKDEV_OUTPUT ?? 'src/flight-experience/assets/lookdev-r4', manifest = JSON.parse(await fs.readFile(`${base}/manifest.json`, 'utf8')), bytes = await fs.readFile(`${base}/${base.endsWith('ecology-r5')?'ecology-r5':'lookdev-r4'}.glb`)
if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Lookdev hash mismatch')
const expectedReviewStatus=base.endsWith('ecology-r5')?'integrated-preview':'needs_review'
if (manifest.reviewStatus !== expectedReviewStatus || manifest.approval !== null || manifest.assets.length !== 9) throw new Error('Lookdev review gate/count mismatch')
const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength)), binary = bytes.subarray(28 + jsonLength)
let triangles = 0, decodedBytes = 0, roughnessVariance = 0
for (const asset of manifest.assets) {
  if (asset.highTriangles < asset.lowTriangles * 8) throw new Error('Missing distinct high-resolution bake source')
  if (!(asset.physicalHeight > 0 && asset.footprint.radius > 0)) throw new Error('Missing metres/bounds')
  for (const lod of asset.lods) {
    const node = json.nodes.find(node => node.name === lod.name)
    if (node?.mesh === undefined) throw new Error(`Missing ${lod.name}`)
    const count = json.meshes[node.mesh].primitives.reduce((sum, primitive) => sum + json.accessors[primitive.indices].count / 3, 0)
    if (count !== lod.triangles) throw new Error(`Unexpected triangle mutation for ${lod.name}`)
    triangles += count
  }
}
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView], data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), metadata = await sharp(data).metadata()
  if (metadata.width > 1024 || metadata.height > 1024) throw new Error('Texture exceeds finite sample policy')
  decodedBytes += metadata.width * metadata.height * 4
  if (image.name.endsWith('ORM')) { const stats = await sharp(data).stats(); roughnessVariance += stats.channels[1].stdev }
}
if (roughnessVariance < 1) throw new Error('Roughness maps accidentally became constant')
if (json.skins?.length || json.animations?.length) throw new Error('Unexpected skeletal resources')
console.log(JSON.stringify({ assets: manifest.assets.length, fileBytes: bytes.length, sourceLodTriangles: triangles, textureCount: json.images.length, decodedTextureBytes: decodedBytes, estimatedMipTextureBytes: Math.ceil(decodedBytes * 4 / 3), roughnessVariationSum: roughnessVariance, reviewStatus: manifest.reviewStatus, visualApproval: 'NOT_RUN' }, null, 2))
// Decode the final exported GLB, including Meshopt/quantization, rather than trust
// Blender source metadata. Upper front-wall normals must face the open air (+Z in
// glTF; -Y in Blender). Talus is below this region and cannot mask a bad wall.
const { NodeIO } = await import('@gltf-transform/core')
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
const { MeshoptDecoder } = await import('meshoptimizer')
const { Matrix3, Matrix4, Vector3 } = await import('three')
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const document = await io.read(`${base}/${base.endsWith('ecology-r5')?'ecology-r5':'lookdev-r4'}.glb`)
const wall = document.getRoot().listNodes().find(node => node.getName() === 'cliff-group-0-lod0')
if (!wall?.getMesh()) throw new Error('Cliff orientation probe is missing its mesh')
const world = new Matrix4().fromArray(wall.getWorldMatrix()), normalMatrix = new Matrix3().getNormalMatrix(world)
let outward = 0, inward = 0
for (const primitive of wall.getMesh().listPrimitives()) {
  const positions = primitive.getAttribute('POSITION'), normals = primitive.getAttribute('NORMAL'), element = [], normalElement = []
  for (let index = 0; index < positions.getCount(); index++) {
    const point = new Vector3().fromArray(positions.getElement(index, element)).applyMatrix4(world)
    const normal = new Vector3().fromArray(normals.getElement(index, normalElement)).applyMatrix3(normalMatrix).normalize()
    if (point.y > 9 && point.z > -5 && Math.abs(normal.z) > .35) { if (normal.z > 0) outward++; else inward++ }
  }
}
if (outward < 20 || outward / (outward + inward) < .9) throw new Error(`Cliff upper-front wall has inward exported normals: ${outward} outward / ${inward} inward`)
console.log(JSON.stringify({ upperFrontWallNormals: { outward, inward }, orientation: 'PASS' }))
