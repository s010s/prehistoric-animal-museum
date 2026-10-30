import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AnimationMixer, Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'meshoptimizer'
import type { AnimalContent, AnimalPresentation, DraftNarrationAssets, DraftNarrationPlans, Locale, NarrationAsset, NarrationPlan } from '../src/content/types'
import type { ExpansionComparison, ExpansionComparisonNarration, ExpansionNarrationTrack, ExpansionReviewManifest } from '../src/review/expansion-manifest'
import type { RenderableReviewDraftAnimalPackage } from '../src/review/types'
import { SKY_EXPANSION_REVIEW_IDS, skyExpansionPresentation, type ReviewPresentationContext } from '../src/review/sky-expansion-config'
import { convexGroundFootprint } from '../src/viewer/scale-encounter-ground-footprint'
import type { ReviewMotionFootprint } from '../src/viewer/scale-encounter-motion-footprint'
import { modelPreviewProfiles } from '../src/viewer/model-preview-profiles'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'
import { assertSkyContent, readSkyExpansionReviewManifest, readSkyFinalModels, skyIntegrationRoot, skyRuntimeCatalogPath, type SkyFinalModel } from './sky-expansion-review'

type JsonObject = Record<string, unknown>
const locales = ['zh-CN', 'en'] as const
const phases = ['intro', 'transition', 'arrival'] as const
const readJson = (path: string): JsonObject => JSON.parse(readFileSync(path, 'utf8')) as JsonObject
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function readContent(id: string, locale: Locale): Promise<AnimalContent> {
  const module = await import(pathToFileURL(resolve(skyIntegrationRoot, 'content', id, `content.${locale}.ts`)).href) as Record<string, AnimalContent | undefined>
  const content = module[locale === 'zh-CN' ? 'zhCN' : 'en'] ?? module[locale === 'zh-CN' ? 'contentZhCN' : 'contentEn'] ?? module.default
  assertSkyContent(content, id, locale)
  return content
}

function comparisonReference(facts: JsonObject): { measurement: NonNullable<ExpansionComparison['measurement']>; meters: number; measurements?: Record<Locale, string> } {
  const reference = object(facts.compareReference ?? facts.compareReferenceScale ?? facts.comparison)
  const measurement = reference.semantic ?? reference.kind
  const meters = reference.meters
  if (!['body-length', 'standing-height', 'shoulder-height', 'wingspan'].includes(String(measurement)) ||
      typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) throw new Error('Missing scientific comparison reference.')
  const labels = object(reference.measurements ?? reference.requiredPublicLabel)
  return {
    measurement: measurement as NonNullable<ExpansionComparison['measurement']>, meters,
    ...(typeof labels['zh-CN'] === 'string' && typeof labels.en === 'string'
      ? { measurements: { 'zh-CN': labels['zh-CN'], en: labels.en } } : {}),
  }
}

function comparisonScripts(narration: JsonObject): NonNullable<ExpansionComparison['scripts']> {
  return Object.fromEntries(locales.map(locale => {
    const localized = object(narration[locale])
    const compare = object(localized.compare ?? object(narration.compare)[locale])
    if (phases.some(phase => typeof compare[phase] !== 'string' || !String(compare[phase]).trim())) {
      throw new Error(`Incomplete comparison phases: ${locale}`)
    }
    const scripts = Object.fromEntries(phases.map(phase => [phase, compare[phase]])) as Record<typeof phases[number], string>
    const continuous = localized.compareContinuousInput ?? object(narration.compareContinuousInput)[locale] ?? compare.continuousInput ?? compare.continuousText
    if (continuous !== undefined && continuous !== phases.map(phase => scripts[phase]).join('\n')) {
      throw new Error(`Comparison continuous input is stale: ${locale}`)
    }
    return [locale, scripts]
  })) as NonNullable<ExpansionComparison['scripts']>
}

async function texturelessModel(bytes: Buffer) {
  const jsonLength = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as { meshes: { primitives: { material?: number }[] }[] }
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const encoded = Buffer.from(JSON.stringify(document))
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32)
  encoded.copy(padded)
  const tail = bytes.subarray(20 + jsonLength)
  const header = Buffer.from(bytes.subarray(0, 20))
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(Uint8Array.from(Buffer.concat([header, padded, tail])).buffer, '')
}

async function sweptFootprint(model: SkyFinalModel, comparison: Pick<ExpansionComparison, 'meters' | 'modelYawRadians' | 'measurementAxis'>): Promise<ReviewMotionFootprint> {
  const destination = resolve(skyIntegrationRoot, 'footprints', `${model.id}.json`)
  const calibration = { meters: comparison.meters, yaw: comparison.modelYawRadians, axis: comparison.measurementAxis }
  if (existsSync(destination)) {
    const cached = readJson(destination)
    if (cached.modelSha256 === model.sha256 && JSON.stringify(cached.calibration) === JSON.stringify(calibration)) {
      return cached as unknown as ReviewMotionFootprint
    }
  }
  const gltf = await texturelessModel(readFileSync(model.path))
  const root = gltf.scene
  const group = new Group().add(root)
  root.rotation.y = comparison.modelYawRadians
  const clip = gltf.animations.find(item => item.name === 'Idle')
  if (!clip || Math.abs(clip.duration - 8) > .0001) throw new Error(`Eight-second Idle missing: ${model.id}`)
  const mixer = new AnimationMixer(root)
  mixer.clipAction(clip).play()
  mixer.setTime(0)
  group.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(root, true)
  const scale = comparison.meters / raw.getSize(new Vector3())[comparison.measurementAxis ?? 'x']
  const centre = raw.getCenter(new Vector3())
  group.scale.setScalar(scale)
  group.position.set(2.2 - centre.x * scale, -raw.min.y * scale, -centre.z * scale)
  const points: Vector3[] = []
  const sampleCount = Math.round(clip.duration * 24) + 1
  for (let frame = 0; frame < sampleCount; frame++) {
    mixer.setTime(frame / 24)
    group.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(root, true)
    // Full posed bounds conservatively retain raised limbs and every tail
    // position without assuming an animal-specific foot or bone layout.
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      points.push(new Vector3(x, 0, z))
    }
  }
  const footprint: ReviewMotionFootprint = {
    modelSha256: model.sha256, clip: clip.name, duration: clip.duration, sampleCount,
    points: convexGroundFootprint(points).map(point => [Number(point.x.toFixed(6)), Number(point.z.toFixed(6))]),
  }
  mkdirSync(resolve(skyIntegrationRoot, 'footprints'), { recursive: true })
  writeFileSync(destination, JSON.stringify({ ...footprint, calibration, method: '24 fps full-cycle conservative posed bounds; 0.08 m runtime padding' }, null, 2) + '\n')
  mixer.stopAllAction()
  console.log(`${model.id}: baked ${sampleCount} calibrated Idle samples`)
  return footprint
}

interface PreparedTrack extends ExpansionNarrationTrack { readonly path: string }
function readAudio(id: string, content: Record<Locale, AnimalContent>, scripts: NonNullable<ExpansionComparison['scripts']>): Map<string, PreparedTrack> {
  const directory = resolve(skyIntegrationRoot, 'audio', id)
  const path = resolve(directory, 'manifest.json')
  const output = new Map<string, PreparedTrack>()
  if (!existsSync(path)) return output
  const manifest = readJson(path)
  const declared = manifest.tracks
  if (!Array.isArray(declared)) throw new Error(`Audio manifest needs tracks: ${id}`)
  for (const item of declared) {
    const track = object(item)
    const locale = String(track.locale)
    const phase = String(track.phase === 'exhibit' ? 'gallery' : track.phase)
    if (!locales.includes(locale as Locale) || !['gallery', ...phases].includes(String(phase)) ||
        typeof track.path !== 'string' || typeof track.sha256 !== 'string' ||
        typeof track.durationMs !== 'number' || typeof track.script !== 'string') throw new Error(`Invalid audio track metadata: ${id}`)
    const expectedScript = phase === 'gallery' ? content[locale as Locale].narration.sentences.join('\n')
      : scripts[locale as Locale][phase as typeof phases[number]]
    const compact = (text: string) => text.replace(/\s+/g, '')
    if (compact(track.script) !== compact(expectedScript)) throw new Error(`Stale audio script: ${id}/${locale}/${phase}`)
    const absolute = isAbsolute(track.path) ? track.path
      : existsSync(resolve(track.path)) ? resolve(track.path) : resolve(directory, track.path)
    const bytes = readFileSync(absolute)
    if (hashBytes(bytes) !== track.sha256) throw new Error(`Audio SHA mismatch: ${id}/${locale}/${phase}`)
    const key = `${locale}/${phase}`
    if (output.has(key)) throw new Error(`Duplicate audio phase: ${id}/${key}`)
    output.set(key, { path: relative(process.cwd(), absolute), url: `/__museum-review-assets/${id}/${phase}.${String(locale).toLowerCase()}.mp3`,
      sha256: track.sha256, durationMs: track.durationMs, script: expectedScript })
  }
  return output
}

function measurementLabels(measurement: NonNullable<ExpansionComparison['measurement']>, meters: number): Record<Locale, string> {
  const value = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(meters)
  if (measurement === 'wingspan') return { 'zh-CN': `翼展约 ${value} 米`, en: `About ${value} m across the wings` }
  if (measurement === 'standing-height') return { 'zh-CN': `头顶高度约 ${value} 米`, en: `About ${value} m to the top of its raised head` }
  if (measurement === 'shoulder-height') return { 'zh-CN': `肩高约 ${value} 米`, en: `About ${value} m at the shoulder` }
  return { 'zh-CN': `从头到尾约 ${value} 米`, en: `About ${value} m from head to tail` }
}

const animals: RenderableReviewDraftAnimalPackage[] = []
const comparisons: ExpansionComparison[] = []
const files: Record<string, string> = {}
const modelHashes: Record<string, string> = {}
const galleryNarration: Record<string, Record<Locale, ExpansionNarrationTrack>> = {}
const readiness: Record<string, { complete: boolean; missing: string[]; humanListening: 'pending' }> = {}
const models = new Map(readSkyFinalModels().map(model => [model.id, model]))
for (const id of SKY_EXPANSION_REVIEW_IDS) {
  const model = models.get(id)!
  const bytes = readFileSync(model.path)
  if (hashBytes(bytes) !== model.sha256 || bytes.length !== model.bytes) throw new Error(`Final model changed: ${id}`)
  const context: ReviewPresentationContext = skyExpansionPresentation[id]
  const presentation: AnimalPresentation = {
    initialYawDegrees: context.initialYawDegrees, safeAreaPadding: context.safeAreaPadding ?? .14,
    portraitSafeAreaPadding: context.portraitSafeAreaPadding ?? (context.habitat === 'air' ? .18 : .14),
    toneMappingExposure: context.toneMappingExposure ?? 1.08,
    ...(context.cameraLightScale !== undefined ? { cameraLightScale: context.cameraLightScale } : {}),
    ...(context.initialRotationZDegrees !== undefined ? { initialRotationZDegrees: context.initialRotationZDegrees } : {}),
    preciseBounds: true, shadow: context.habitat === 'land' ? 'ground' : 'none',
  }
  const animation = { clip: 'Idle', loop: 'repeat' as const, speed: 1 }
  const presentationSignature = createModelPreviewPresentationSignature(
    createViewerModelDescriptor({ id, presentation, animation }, id, model.path),
  )
  const previewManifestPath = resolve(skyIntegrationRoot, 'images', id, 'model-preview.manifest.json')
  const derivedManifestPath = resolve(skyIntegrationRoot, 'images', id, 'derived-images.manifest.json')
  const previewManifest = existsSync(previewManifestPath) ? readJson(previewManifestPath) : undefined
  const derivedManifest = existsSync(derivedManifestPath) ? readJson(derivedManifestPath) : undefined
  // Old files may remain for reference, but only a current, native-bound
  // image bundle can be selected by the live draft catalog.
  const imageBundleCurrent = previewManifest?.presentationSignature === presentationSignature &&
    object(previewManifest.sourceModel).sha256 === model.sha256 &&
    derivedManifest?.presentationSignature === presentationSignature &&
    derivedManifest.modelSha256 === model.sha256
  const content: Record<Locale, AnimalContent> = { 'zh-CN': await readContent(id, 'zh-CN'), en: await readContent(id, 'en') }
  const facts = readJson(resolve(skyIntegrationRoot, 'content', id, 'facts.json'))
  const reference = comparisonReference(facts)
  if (id === 'phorusrhacos') {
    for (const locale of locales) content[locale] = { ...content[locale], facts: { ...content[locale].facts,
      size: { kind: 'standing-height', minMeters: reference.meters, maxMeters: reference.meters } } }
  }
  const narration = readJson(resolve(skyIntegrationRoot, 'content', id, 'narration.json'))
  const scripts = comparisonScripts(narration)
  const missing: string[] = []
  const asset = (kind: 'images' | 'backgrounds', file: string): string | undefined => {
    const path = `${skyIntegrationRoot}/${kind}/${id}/${file}`
    if (kind === 'images' && !imageBundleCurrent) { missing.push(`${kind}/${file} (native recapture pending)`); return undefined }
    if (!existsSync(path)) { missing.push(`${kind}/${file}`); return undefined }
    const route = `/__museum-review-assets/${id}/${kind === 'backgrounds' ? 'background-' : ''}${file}`
    files[route] = path
    return route
  }
  const landscape = asset('backgrounds', 'landscape.webp')
  const portrait = asset('backgrounds', 'portrait.webp')
  const poster = asset('images', 'poster.webp')
  const posterPortrait = asset('images', 'poster-portrait.webp')
  const thumbnail = asset('images', 'thumbnail.webp')
  for (const profile of modelPreviewProfiles) asset('images', profile.fileName)
  if (!imageBundleCurrent) missing.push('images/current-native-manifests')
  const audio = readAudio(id, content, scripts)
  const plans: Partial<Record<Locale, NarrationPlan>> = {}
  const audioAssets: Partial<Record<Locale, NarrationAsset>> = {}
  const galleryReady = locales.every(locale => audio.has(`${locale}/gallery`))
  for (const locale of locales) {
    if (galleryReady) {
      const track = audio.get(`${locale}/gallery`)!
      files[track.url] = track.path
      const plan = { status: 'ready' as const, sourcePath: `audio/narration.${locale}.mp3` as const, mimeType: 'audio/mpeg' as const }
      plans[locale] = plan
      audioAssets[locale] = { ...plan, url: track.url }
    } else {
      if (!audio.has(`${locale}/gallery`)) missing.push(`audio/gallery.${locale}`)
      const plan = { status: 'pending-review' as const, expectedPath: `audio/narration.${locale}.mp3` as const,
        message: locale === 'zh-CN' ? '旁白正在准备中。' : 'Narration is being prepared.',
        gate: { id: 'final-narration' as const, locale, reason: 'Local audio preparation is incomplete.' } }
      plans[locale] = plan
      audioAssets[locale] = plan
    }
  }
  if (galleryReady) galleryNarration[id] = Object.fromEntries(locales.map(locale => {
    const track = audio.get(`${locale}/gallery`)!
    return [locale, { url: track.url, sha256: track.sha256, script: track.script, durationMs: track.durationMs }]
  })) as Record<Locale, ExpansionNarrationTrack>
  const compareReady = locales.every(locale => phases.every(phase => audio.has(`${locale}/${phase}`)))
  for (const locale of locales) for (const phase of phases) if (!audio.has(`${locale}/${phase}`)) missing.push(`audio/${phase}.${locale}`)
  let comparisonAudio: ExpansionComparisonNarration | undefined
  if (compareReady) comparisonAudio = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(phases.map(phase => {
    const { path, ...track } = audio.get(`${locale}/${phase}`)!
    files[track.url] = path
    return [phase, track]
  }))])) as ExpansionComparisonNarration
  const comparison: ExpansionComparison = {
    id, names: { 'zh-CN': content['zh-CN'].name, en: content.en.name },
    measurements: reference.measurements ?? measurementLabels(reference.measurement, reference.meters),
    habitat: context.habitat, modelSha256: model.sha256, meters: reference.meters,
    measurement: reference.measurement,
    measurementAxis: context.comparisonMeasurementAxis ?? (reference.measurement === 'standing-height' || reference.measurement === 'shoulder-height' ? 'y' : context.habitat === 'air' ? 'z' : 'x'),
    modelYawRadians: context.comparisonYawRadians, scripts,
    ...(comparisonAudio ? { narration: comparisonAudio } : {}),
  }
  if (context.habitat === 'land') Object.assign(comparison, { motionFootprint: await sweptFootprint(model, comparison) })
  comparisons.push(comparison)
  const modelRoute = `/__museum-review-assets/${id}/model.glb`
  files[modelRoute] = model.path
  modelHashes[id] = model.sha256
  const sourceAuthor = model.source.sourceAuthor ?? model.source.author
  const sourceUrl = model.source.sourceUrl ?? model.source.source
  if (typeof sourceAuthor !== 'string' || !sourceAuthor.trim() || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) {
    throw new Error(`Final model source attribution is incomplete: ${id}`)
  }
  animals.push({
    id, status: 'draft', kind: context.kind, habitat: context.habitat, atmosphere: context.atmosphere,
    content, presentation, animation, provenance: [],
    modelCredit: {
      attribution: `Model by ${sourceAuthor}; museum preparation by Leon Made This.`,
      licenseName: 'Creative Commons Attribution 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceTitle: `${content.en.name} 3D model`,
      sourceUrl,
    },
    narration: plans as DraftNarrationPlans,
    assets: { model: modelRoute, modelBytes: model.bytes, poster, posterPortrait, thumbnail,
      backgrounds: { landscape, portrait }, narration: audioAssets as DraftNarrationAssets },
    draftNotes: ['Private local museum draft. Availability does not record human listening or public-distribution approval.'],
  })
  readiness[id] = { complete: missing.length === 0, missing, humanListening: 'pending' }
  console.log(`${id}: ${missing.length ? `pending ${missing.join(', ')}` : 'all local assets present; listening pending'}`)
}
const manifest: ExpansionReviewManifest = { evidenceVersion: 'sky-integration-v1', animals, comparisons, files, modelHashes, galleryNarration, readiness }
mkdirSync(skyIntegrationRoot, { recursive: true })
writeFileSync(skyRuntimeCatalogPath, JSON.stringify(manifest, null, 2) + '\n')
readSkyExpansionReviewManifest(true)
writeFileSync(resolve(skyIntegrationRoot, 'runtime-presentation.json'), JSON.stringify({
  frozenAt: new Date().toISOString(),
  scope: 'Current local gallery presentation. Native image readiness remains explicit; no publication approval.',
  galleryAutoRotate: false,
  animals: animals.map(animal => ({ id: animal.id, modelSha256: modelHashes[animal.id],
    initialYawDegrees: animal.presentation.initialYawDegrees,
    toneMappingExposure: animal.presentation.toneMappingExposure,
    presentationSignature: createModelPreviewPresentationSignature(
      createViewerModelDescriptor(animal, animal.content.en.name, animal.assets.model),
    ) })),
}, null, 2) + '\n')
const complete = Object.values(readiness).every(value => value.complete)
writeFileSync(resolve(skyIntegrationRoot, 'readiness.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
  localDraft: true, productionPromotion: false, humanListening: 'pending', complete, animals: readiness }, null, 2) + '\n')
if (process.argv.includes('--require-complete') && !complete) throw new Error('Sky local packet still has missing assets; see integration/readiness.json.')
console.log(`Prepared ${animals.length} native museum drafts. Production remains unchanged. ${complete ? 'All files present.' : 'Capture-ready with explicit missing derivatives.'}`)
