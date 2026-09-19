import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
const base = process.env.MUSEUM_LOOKDEV_OUTPUT ?? 'src/flight-experience/assets/lookdev-r4'
const path = `${base}/${base.endsWith('ecology-r5')?'ecology-r5':'lookdev-r4'}.glb`
const evidence = process.env.MUSEUM_ASSET_EVIDENCE ?? '.flight-evidence/r4/assets'
const scratch = `${evidence}/optimized.glb`
await MeshoptDecoder.ready; await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const document = await io.read(path)
for (const texture of document.getRoot().listTextures()) {
  const name = texture.getName(), preserve = name.endsWith('baseColor') && (name.startsWith('cliff-') || name.startsWith('tree-'))
  if (!preserve) texture.setImage(await sharp(texture.getImage()).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).setMimeType('image/png')
}
const sized = `${evidence}/sized.glb`
await io.write(sized, document)
execFileSync('node_modules/.bin/gltf-transform', ['optimize', sized, scratch, '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false', '--compress', 'meshopt', '--texture-compress', 'webp'], { stdio: 'inherit' })
await fs.copyFile(scratch, path)
const bytes = await fs.readFile(path), manifestPath = `${base}/manifest.json`
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
manifest.sha256 = createHash('sha256').update(bytes).digest('hex'); manifest.bytes = bytes.length
manifest.textureRuntimePolicy = 'Tree/cliff base colour 1k; all other channels 512; selected high-to-low source bake 1k.'
manifest.optimization = 'gltf-transform 4.4.2: dedup/prune, WebP, Meshopt; hierarchy/names and authored LOD geometry retained'
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
