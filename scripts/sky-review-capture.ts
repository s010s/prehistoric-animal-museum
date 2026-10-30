import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import sharp from 'sharp'
import type { ExpansionReviewManifest } from '../src/review/expansion-manifest'
import { SKY_EXPANSION_REVIEW_ID_SET } from '../src/review/sky-expansion-config'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'
import { MODEL_PREVIEW_CONTRACT_VERSION, modelPreviewProfiles, type ModelPreviewManifest } from '../src/viewer/model-preview-profiles'
import { skyIntegrationRoot } from './sky-expansion-review'

interface CaptureInput {
  readonly animalId: string
  readonly profile: string
  readonly modelSha256: string
  readonly presentationSignature: string
  readonly png: string
  readonly frame: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly canvas: { readonly width: number; readonly height: number }
  readonly viewport: { readonly width: number; readonly height: number; readonly pixelRatio: number }
  readonly state: Readonly<Record<string, string>>
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** An explicit local export, never a browser launcher or publication route. */
export async function saveSkyReviewCapture(request: IncomingMessage, response: ServerResponse, manifest: ExpansionReviewManifest): Promise<void> {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST' || request.headers.origin !== `http://${request.headers.host}`) {
    response.statusCode = 405
    response.end(JSON.stringify({ error: 'Same-origin local capture POST required.' }))
    return
  }
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
      size += chunk.length
      if (size > 32 * 1024 * 1024) throw new Error('Capture exceeds the local input ceiling.')
      chunks.push(chunk)
    }
    const input = JSON.parse(Buffer.concat(chunks).toString()) as CaptureInput
    const animal = manifest.animals.find(item => item.id === input.animalId)
    const profile = modelPreviewProfiles.find(item => item.key === input.profile)
    if (!animal || !profile || !SKY_EXPANSION_REVIEW_ID_SET.has(input.animalId) ||
        input.modelSha256 !== manifest.modelHashes[input.animalId] ||
        input.state.animationClip !== 'Idle' || input.state.reviewAnimationTime !== '0' ||
        input.state.animationPaused !== 'true' || !input.png.startsWith('data:image/png;base64,')) {
      throw new Error('Capture identity or paused first-frame state is stale.')
    }
    if (input.viewport.width !== profile.referenceWidth || input.viewport.height !== profile.referenceHeight) {
      throw new Error(`Set the headed viewport to ${profile.referenceWidth}x${profile.referenceHeight} for ${profile.key}.`)
    }
    const signature = createModelPreviewPresentationSignature(createViewerModelDescriptor(animal, animal.content['zh-CN'].name, animal.assets.model))
    if (signature !== input.presentationSignature) throw new Error('Capture presentation differs from the current native package.')
    const png = Buffer.from(input.png.slice('data:image/png;base64,'.length), 'base64')
    const metadata = await sharp(png).metadata()
    if (!metadata.width || !metadata.height || !metadata.hasAlpha ||
        input.canvas.width <= 0 || input.canvas.height <= 0 ||
        Object.values(input.frame).some(value => !Number.isFinite(value))) throw new Error('Invalid transparent canvas capture.')
    const sx = metadata.width / input.canvas.width
    const sy = metadata.height / input.canvas.height
    const crop = { left: Math.round(input.frame.left * sx), top: Math.round(input.frame.top * sy),
      width: Math.round(input.frame.width * sx), height: Math.round(input.frame.height * sy) }
    if (crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 ||
        crop.left + crop.width > metadata.width || crop.top + crop.height > metadata.height) throw new Error('Composition frame lies outside the captured canvas.')
    const clean = await sharp(png).extract(crop).png().toBuffer()
    const alpha = (await sharp(clean).extractChannel('alpha').stats()).channels[0]
    if (alpha.min !== 0 || alpha.max < 128 || alpha.mean >= 160) throw new Error('The exported model has no usable transparent silhouette.')
    const directory = resolve(skyIntegrationRoot, 'images', animal.id)
    const captureDirectory = resolve(directory, 'captures')
    mkdirSync(captureDirectory, { recursive: true })
    writeFileSync(resolve(captureDirectory, `${profile.key}.png`), clean)
    const encoded = await sharp(clean).resize(profile.width, profile.height, { fit: 'fill' }).webp({ lossless: true, effort: 6 }).toBuffer()
    writeFileSync(resolve(directory, profile.fileName), encoded)
    writeFileSync(resolve(captureDirectory, `${profile.key}.json`), JSON.stringify({
      capturedAt: new Date().toISOString(), animalId: animal.id, modelSha256: input.modelSha256,
      presentationSignature: signature, profile: profile.key, viewport: input.viewport, crop,
      state: input.state, sourcePngSha256: digest(png), cleanPngSha256: digest(clean),
      captureOrigin: 'local-runtime-export', cryptographicallyVerified: false,
      note: 'The parent collector separately attests use of the headed browser.',
      runtime: { fileName: profile.fileName, sha256: digest(encoded), bytes: encoded.length, width: profile.width, height: profile.height },
    }, null, 2) + '\n')
    const derivedPath = resolve(directory, 'derived-images.manifest.json')
    interface DerivedRecord { readonly sha256: string; readonly bytes: number; readonly captureSha256: string; readonly backgroundSha256?: string }
    const previous = existsSync(derivedPath)
      ? JSON.parse(readFileSync(derivedPath, 'utf8')) as { modelSha256: string; presentationSignature: string; assets: Record<string, DerivedRecord> }
      : undefined
    const derived: Record<string, DerivedRecord> = previous?.modelSha256 === input.modelSha256 && previous.presentationSignature === signature ? previous.assets : {}
    const recordDerived = (fileName: string, background?: Buffer) => {
      const bytes = readFileSync(resolve(directory, fileName))
      derived[fileName] = { sha256: digest(bytes), bytes: bytes.length, captureSha256: digest(clean),
        ...(background ? { backgroundSha256: digest(background) } : {}) }
    }
    if (profile.key === 'desktopStandard') {
      await sharp(clean).resize(1200, 675, { fit: 'contain', background: '#00000000' }).webp({ quality: 90, effort: 6 }).toFile(resolve(directory, 'poster.webp'))
      recordDerived('poster.webp')
      const background = resolve(skyIntegrationRoot, 'backgrounds', animal.id, 'landscape.webp')
      if (existsSync(background)) {
        const foreground = await sharp(clean).trim().resize(284, 256, { fit: 'inside' }).toBuffer({ resolveWithObject: true })
        await sharp(background).resize(320, 320, { fit: 'cover', position: 'centre' })
          .composite([{ input: foreground.data, left: Math.round((320 - foreground.info.width) / 2), top: Math.round((320 - foreground.info.height) / 2) }])
          .webp({ quality: 86, effort: 6 }).toFile(resolve(directory, 'thumbnail.webp'))
        recordDerived('thumbnail.webp', readFileSync(background))
      }
    }
    if (profile.key === 'phonePortraitTall') {
      await sharp(clean).resize(390, 844, { fit: 'contain', background: '#00000000' }).webp({ quality: 90, effort: 6 }).toFile(resolve(directory, 'poster-portrait.webp'))
      recordDerived('poster-portrait.webp')
    }
    writeFileSync(derivedPath, JSON.stringify({ modelSha256: input.modelSha256, presentationSignature: signature, assets: derived }, null, 2) + '\n')
    const records = modelPreviewProfiles.flatMap(item => {
      const path = resolve(captureDirectory, `${item.key}.json`)
      if (!existsSync(path)) return []
      const entry = JSON.parse(readFileSync(path, 'utf8')) as { modelSha256: string; presentationSignature: string; runtime: ModelPreviewManifest['profiles'][typeof item.key] }
      if (entry.modelSha256 !== input.modelSha256 || entry.presentationSignature !== signature) return []
      return [[item.key, entry.runtime] as const]
    })
    if (records.length === modelPreviewProfiles.length) {
      const previewManifest: ModelPreviewManifest = { animalId: animal.id, contractVersion: MODEL_PREVIEW_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(), presentationSignature: signature,
        profiles: Object.fromEntries(records) as ModelPreviewManifest['profiles'],
        sourceModel: { bytes: animal.assets.modelBytes, sha256: input.modelSha256 }, target: 'review' }
      writeFileSync(resolve(directory, 'model-preview.manifest.json'), JSON.stringify(previewManifest, null, 2) + '\n')
    }
    response.end(JSON.stringify({ saved: true, animalId: animal.id, profile: profile.key, sha256: digest(encoded), completeProfiles: records.length }))
  } catch (error) {
    response.statusCode = 400
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}
