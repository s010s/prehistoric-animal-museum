import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { AnimalContent } from '../src/content/types'
import type { ExpansionReviewManifest } from '../src/review/expansion-manifest'
import { SKY_EXPANSION_REVIEW_IDS, SKY_EXPANSION_REVIEW_ID_SET, skyExpansionPresentation, type ReviewPresentationContext } from '../src/review/sky-expansion-config'
import { validateExpansionNarration } from './expansion-review'
import { modelPreviewProfiles, type ModelPreviewManifest } from '../src/viewer/model-preview-profiles'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'

export const skyIntegrationRoot = '.handoff/sky-expansion-12/integration'
export const skyRuntimeCatalogPath = `${skyIntegrationRoot}/runtime-catalog.json`
export const skyFinalModelsPath = '.handoff/sky-expansion-12/production/final-models.json'

export interface SkyFinalModel {
  readonly id: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly triangles: number
  readonly animation: string
  readonly duration: number
  readonly source: Readonly<Record<string, unknown>>
}

export function readSkyFinalModels(): readonly SkyFinalModel[] {
  const document = JSON.parse(readFileSync(skyFinalModelsPath, 'utf8')) as { models: SkyFinalModel[] }
  if (document.models.length !== SKY_EXPANSION_REVIEW_IDS.length ||
      new Set(document.models.map(item => item.id)).size !== SKY_EXPANSION_REVIEW_IDS.length ||
      document.models.some(item => !SKY_EXPANSION_REVIEW_ID_SET.has(item.id))) {
    throw new Error('Sky model lock must contain exactly the nine selected animals.')
  }
  return document.models
}

export function assertSkyContent(content: AnimalContent | undefined, id: string, locale: string): asserts content is AnimalContent {
  if (!content || !content.name?.trim() || !content.classificationLabel?.trim() ||
      !content.visibleFeature?.trim() || !content.parentClassificationNote?.trim() ||
      !content.facts?.period?.trim() || !content.facts.discoveryRegions?.length ||
      content.narration?.sentences?.length !== 2 || content.narration.sentences.some(line => !line.trim()) ||
      !content.narration.pronunciation?.length || !content.sources?.length ||
      content.sources.some(source => !source.title?.trim() || !/^https:\/\//.test(source.url) || !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedOn))) {
    throw new Error(`Incomplete bilingual scientific content: ${id}/${locale}`)
  }
  const size = content.facts.size
  if (size.kind !== 'unknown' && (!Number.isFinite(size.minMeters) || !Number.isFinite(size.maxMeters) ||
      size.minMeters <= 0 || size.maxMeters < size.minMeters)) {
    throw new Error(`Invalid scientific size: ${id}/${locale}`)
  }
}

/** Explicit routes only. This reader is used by a serve-only review plugin. */
export function readSkyExpansionReviewManifest(enabled: boolean): ExpansionReviewManifest {
  if (!enabled) return { animals: [], comparisons: [], files: {}, modelHashes: {} }
  if (!existsSync(skyRuntimeCatalogPath)) {
    throw new Error('Prepare the sky draft with npm run prepare:sky-review before starting review.')
  }
  const manifest = JSON.parse(readFileSync(skyRuntimeCatalogPath, 'utf8')) as ExpansionReviewManifest
  if (manifest.evidenceVersion !== 'sky-integration-v1' ||
      manifest.animals.length !== SKY_EXPANSION_REVIEW_IDS.length ||
      manifest.comparisons.length !== SKY_EXPANSION_REVIEW_IDS.length) {
    throw new Error('Sky review requires the exact nine gallery and comparison drafts.')
  }
  const locked = new Map(readSkyFinalModels().map(item => [item.id, item]))
  const ids = new Set<string>()
  const expectedRoutes = new Set<string>()
  const clipDurations: Record<string, number> = {}
  for (const animal of manifest.animals) {
    const model = locked.get(animal.id)
    if (!model || ids.has(animal.id) || animal.status !== 'draft' || animal.review) {
      throw new Error(`Invalid private sky draft identity: ${animal.id}`)
    }
    ids.add(animal.id)
    const presentation: ReviewPresentationContext = skyExpansionPresentation[animal.id as keyof typeof skyExpansionPresentation]
    if (animal.habitat !== presentation.habitat || animal.kind !== presentation.kind) {
      throw new Error(`Sky habitat or classification mismatch: ${animal.id}`)
    }
    assertSkyContent(animal.content['zh-CN'], animal.id, 'zh-CN')
    assertSkyContent(animal.content.en, animal.id, 'en')
    const modelRoute = `/__museum-review-assets/${animal.id}/model.glb`
    if (animal.assets.model !== modelRoute || manifest.files[modelRoute] !== model.path ||
        model.path !== `assets/candidates/${animal.id}/output/model.glb`) {
      throw new Error(`Sky model route mismatch: ${animal.id}`)
    }
    const bytes = readFileSync(model.path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== model.sha256 || hash !== manifest.modelHashes[animal.id] ||
        bytes.length !== model.bytes || bytes.length !== animal.assets.modelBytes || bytes.length > 20 * 1024 * 1024) {
      throw new Error(`Sky final model lock mismatch: ${animal.id}`)
    }
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
      animations?: { name?: string; samplers: { input: number }[] }[]
      accessors: { min?: number[]; max?: number[] }[]
    }
    if (gltf.animations?.length !== 1 || gltf.animations[0]?.name !== 'Idle' || animal.animation?.clip !== 'Idle') {
      throw new Error(`One selected Idle required: ${animal.id}`)
    }
    const duration = Math.max(...gltf.animations[0].samplers.map(sampler => gltf.accessors[sampler.input]?.max?.[0] ?? NaN))
    if (!Number.isFinite(duration) || Math.abs(duration - 8) > 0.0001) throw new Error(`Eight-second Idle required: ${animal.id}`)
    clipDurations[animal.id] = duration
    expectedRoutes.add(modelRoute)
    for (const route of [animal.assets.poster, animal.assets.posterPortrait, animal.assets.thumbnail,
      animal.assets.backgrounds?.landscape, animal.assets.backgrounds?.portrait]) {
      if (route) expectedRoutes.add(route)
    }
    for (const profile of modelPreviewProfiles) {
      const route = `/__museum-review-assets/${animal.id}/${profile.fileName}`
      if (manifest.files[route]) expectedRoutes.add(route)
    }
    const previewPath = resolve(skyIntegrationRoot, 'images', animal.id, 'model-preview.manifest.json')
    if (existsSync(previewPath)) {
      const preview = JSON.parse(readFileSync(previewPath, 'utf8')) as ModelPreviewManifest
      const signature = createModelPreviewPresentationSignature(createViewerModelDescriptor(animal, animal.content['zh-CN'].name, animal.assets.model))
      if (preview.sourceModel.sha256 !== hash || preview.sourceModel.bytes !== bytes.length || preview.presentationSignature !== signature) {
        throw new Error(`Stale native sky previews: ${animal.id}`)
      }
      for (const profile of modelPreviewProfiles) {
        const file = resolve(skyIntegrationRoot, 'images', animal.id, profile.fileName)
        const record = preview.profiles[profile.key]
        const image = readFileSync(file)
        if (!record || record.sha256 !== createHash('sha256').update(image).digest('hex') || record.bytes !== image.length ||
            record.width !== profile.width || record.height !== profile.height) throw new Error(`Sky preview image mismatch: ${animal.id}/${profile.key}`)
      }
    }
    const derivedPath = resolve(skyIntegrationRoot, 'images', animal.id, 'derived-images.manifest.json')
    if (existsSync(derivedPath)) {
      const derived = JSON.parse(readFileSync(derivedPath, 'utf8')) as {
        modelSha256: string; presentationSignature: string
        assets: Record<string, { sha256: string; bytes: number; backgroundSha256?: string }>
      }
      const signature = createModelPreviewPresentationSignature(createViewerModelDescriptor(animal, animal.content['zh-CN'].name, animal.assets.model))
      if (derived.modelSha256 !== hash || derived.presentationSignature !== signature) throw new Error(`Stale sky poster derivatives: ${animal.id}`)
      for (const [fileName, record] of Object.entries(derived.assets)) {
        if (!['poster.webp', 'poster-portrait.webp', 'thumbnail.webp'].includes(fileName)) throw new Error(`Unknown sky derivative: ${fileName}`)
        const image = readFileSync(resolve(skyIntegrationRoot, 'images', animal.id, fileName))
        if (record.sha256 !== createHash('sha256').update(image).digest('hex') || record.bytes !== image.length) throw new Error(`Sky derivative hash mismatch: ${animal.id}/${fileName}`)
        if (fileName === 'thumbnail.webp') {
          const background = readFileSync(resolve(skyIntegrationRoot, 'backgrounds', animal.id, 'landscape.webp'))
          if (record.backgroundSha256 !== createHash('sha256').update(background).digest('hex')) throw new Error(`Sky thumbnail uses a stale background: ${animal.id}`)
        }
      }
    }
    const comparison = manifest.comparisons.find(item => item.id === animal.id)
    const requiredMeasurement = animal.id === 'phorusrhacos' ? 'standing-height'
      : animal.habitat === 'air' ? 'wingspan' : 'body-length'
    const requiredAxis = presentation.comparisonMeasurementAxis ?? (requiredMeasurement === 'standing-height' ? 'y' : animal.habitat === 'air' ? 'z' : 'x')
    if (!comparison || comparison.modelSha256 !== hash || comparison.habitat !== animal.habitat ||
        comparison.measurement !== requiredMeasurement || comparison.measurementAxis !== requiredAxis ||
        !Number.isFinite(comparison.meters) || comparison.meters <= 0 ||
        comparison.modelYawRadians !== presentation.comparisonYawRadians || !comparison.scripts) {
      throw new Error(`Sky comparison calibration mismatch: ${animal.id}`)
    }
    if (animal.id === 'dakosaurus' && (!animal.content['zh-CN'].facts.period.includes('晚侏罗世') ||
        /白垩|Cretaceous/i.test(Object.values(comparison.scripts).flatMap(value => Object.values(value)).join(' ')))) {
      throw new Error('Dakosaurus must retain its Late Jurassic setting.')
    }
    if (animal.habitat === 'land') {
      const footprint = comparison.motionFootprint
      if (!footprint || footprint.modelSha256 !== hash || footprint.clip !== 'Idle' ||
          footprint.duration !== duration || footprint.sampleCount < 193 || footprint.points.length < 3 ||
          footprint.points.length > 4096 || footprint.points.some(point => point.length !== 2 || point.some(n => !Number.isFinite(n)))) {
        throw new Error(`Full-loop calibrated sky footprint required: ${animal.id}`)
      }
    }
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const phase of ['intro', 'transition', 'arrival'] as const) {
        if (!comparison.scripts[locale][phase]?.trim()) throw new Error(`Missing comparison script: ${animal.id}/${locale}/${phase}`)
        const track = comparison.narration?.[locale][phase]
        if (track && track.script !== comparison.scripts[locale][phase]) throw new Error(`Comparison audio script mismatch: ${animal.id}/${locale}/${phase}`)
      }
    }
  }
  for (const track of [
    ...Object.values(manifest.galleryNarration ?? {}).flatMap(value => Object.values(value)),
    ...manifest.comparisons.flatMap(item => item.narration ? Object.values(item.narration).flatMap(value => Object.values(value)) : []),
  ]) expectedRoutes.add(track.url)
  for (const [route, relativePath] of Object.entries(manifest.files)) {
    const match = route.match(/^\/__museum-review-assets\/([a-z0-9-]+)\/([a-z0-9.-]+)$/)
    if (!match || !ids.has(match[1]) || !expectedRoutes.has(route)) throw new Error(`Unlisted sky route: ${route}`)
    const id = match[1]
    const absolute = realpathSync(resolve(relativePath))
    const allowedModel = absolute === resolve(`assets/candidates/${id}/output/model.glb`) && match[2] === 'model.glb'
    const allowedAsset = ['backgrounds', 'images', 'audio'].some(kind =>
      absolute.startsWith(resolve(skyIntegrationRoot, kind, id) + sep)) && /\.(webp|mp3)$/.test(absolute)
    if ((!allowedModel && !allowedAsset) || !statSync(absolute).isFile()) throw new Error(`Sky asset outside explicit local roots: ${relativePath}`)
  }
  if ([...expectedRoutes].some(route => !manifest.files[route])) throw new Error('Missing declared sky asset route.')
  validateExpansionNarration(manifest)
  return { ...manifest, clipDurations }
}
