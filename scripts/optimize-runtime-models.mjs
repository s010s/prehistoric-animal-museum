import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, textureCompress, unpartition } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { validateBytes } from 'gltf-validator'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { resampleCubicRotationTracks } from './resample-cubic-rotation-tracks.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const animalsRoot = join(repositoryRoot, 'src/content/animals')
await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

async function transformModel(inputPath, outputPath, transform) {
  const document = await io.read(inputPath)
  // Match the CLI's decode-before-transform behavior to avoid recompressing
  // with stale compression settings.
  for (const name of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
    document.disposeExtension(name)
  }
  await document.transform(transform, unpartition())
  await io.write(outputPath, document)
}

function readGlbJson(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Expected a binary glTF file.')
  }
  const jsonLength = buffer.readUInt32LE(12)
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const animalIds = (await readdir(animalsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const animalId of animalIds) {
  const modelPath = join(animalsRoot, animalId, 'model/model.glb')
  let original
  try {
    original = await readFile(modelPath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      continue
    }
    throw error
  }

  const json = readGlbJson(original)
  const extensions = new Set(json.extensionsUsed ?? [])
  const containsPng = (json.images ?? []).some(
    (image) => image.mimeType === 'image/png',
  )
  if (extensions.has('EXT_meshopt_compression') && !containsPng) {
    console.log(`${animalId}: already optimized`)
    continue
  }

  const scratch = await mkdtemp(join(tmpdir(), `museum-${animalId}-`))
  const webpPath = join(scratch, 'textures-webp.glb')
  const animationSafePath = join(scratch, 'animation-safe.glb')
  const optimizedPath = join(scratch, 'optimized.glb')
  try {
    let meshoptInput = modelPath
    if (containsPng) {
      await transformModel(modelPath, webpPath, textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        formats: /png/,
        lossless: true,
      }))
      meshoptInput = webpPath
    }
    const resampledTracks = await resampleCubicRotationTracks(
      meshoptInput,
      animationSafePath,
    )
    if (resampledTracks > 0) {
      meshoptInput = animationSafePath
      console.log(
        `${animalId}: resampled ${resampledTracks} cubic rotation track(s) before Meshopt compression`,
      )
    }
    await transformModel(meshoptInput, optimizedPath, meshopt({
      encoder: MeshoptEncoder,
      level: 'high',
      quantizePosition: 16,
      quantizeNormal: 12,
      quantizeTexcoord: 14,
      quantizeWeight: 12,
    }))
    const validation = await validateBytes(new Uint8Array(await readFile(optimizedPath)))
    if (validation.issues.numErrors > 0) {
      throw new Error(`Model validation failed: ${JSON.stringify(validation.issues.messages)}`)
    }

    const optimized = await readFile(optimizedPath)
    if (optimized.byteLength >= original.byteLength) {
      console.log(`${animalId}: kept original because compression was not smaller`)
      continue
    }

    const nextPath = `${modelPath}.next`
    await copyFile(optimizedPath, nextPath)
    await rename(nextPath, modelPath)
    const modelStat = await stat(modelPath)
    console.log(
      JSON.stringify({
        animalId,
        beforeBytes: original.byteLength,
        bytes: modelStat.size,
        savedPercent: Number(
          ((1 - modelStat.size / original.byteLength) * 100).toFixed(1),
        ),
        sha256: sha256(optimized),
      }),
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
