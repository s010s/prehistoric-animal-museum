import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
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
execFileSync('node_modules/.bin/gltf-transform', ['optimize', sized, scratch, '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false', '--compress', 'meshopt', '--texture-compress', 'webp'], { stdio: 'inherit' })
await fs.copyFile(scratch, path)
const bytes = await fs.readFile(path), manifestPath = 'src/flight-experience/assets/landscape/manifest.json'
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
manifest.sha256 = createHash('sha256').update(bytes).digest('hex'); manifest.bytes = bytes.length
manifest.textureRuntimePolicy = 'Tree/cliff base colour 1k; rock base colour and non-colour channels 512; source bake 1k.'
manifest.optimization = 'gltf-transform 4.4.2: dedup/prune, WebP, Meshopt; hierarchy/names and authored LOD geometry retained'
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
