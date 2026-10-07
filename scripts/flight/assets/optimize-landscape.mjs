import fs from 'node:fs/promises'
import { dedup, weld, resample, prune, sparse, textureCompress, meshopt, unpartition } from '@gltf-transform/functions'
import { ready as resampleReady, resample as resampleWASM } from 'keyframe-resample'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
const path = 'src/flight-experience/assets/landscape/landscape-samples.glb'
const scratch = '.flight-evidence/r3/assets/optimized.glb'
await MeshoptDecoder.ready; await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const document = await io.read(path)
for (const texture of document.getRoot().listTextures()) {
  const name = texture.getName(), preserve = name.endsWith('baseColor') && (name.startsWith('tree-') || name.startsWith('cliff-'))
  if (!preserve) texture.setImage(await sharp(texture.getImage()).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).setMimeType('image/png')
}
const sized = '.flight-evidence/r3/assets/sized.glb'
await io.write(sized, document)
// Preserve the old optimize flags: no flatten/join/instance/simplify/palette.
const optimized = await io.read(sized)
for (const name of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) optimized.disposeExtension(name)
await optimized.transform(
  dedup(), weld(), resample({ ready: resampleReady, resample: resampleWASM }),
  prune({ keepAttributes: false, keepIndices: false, keepLeaves: false, keepSolidTextures: false }),
  sparse(), textureCompress({ encoder: sharp, resize: [2048, 2048], targetFormat: 'webp' }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }), unpartition(),
)
await io.write(scratch, optimized)
await fs.copyFile(scratch, path)
const bytes = await fs.readFile(path), manifestPath = 'src/flight-experience/assets/landscape/manifest.json'
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
manifest.sha256 = createHash('sha256').update(bytes).digest('hex'); manifest.bytes = bytes.length
manifest.textureRuntimePolicy = 'Tree/cliff base colour 1k; rock base colour and non-colour channels 512; source bake 1k.'
manifest.optimization = 'glTF Transform SDK 4.5.0: dedup/prune, WebP, Meshopt; hierarchy/names and authored LOD geometry retained'
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
