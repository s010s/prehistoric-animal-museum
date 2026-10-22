import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { ExpansionNarrationTrack, ExpansionReviewManifest } from '../src/review/expansion-manifest'
import { reviewNarrationAssetFor, reviewNarrationPlanFor } from '../src/review/types'

const empty: ExpansionReviewManifest = { animals: [], comparisons: [], files: {}, modelHashes: {} }

export function expansionNarrationTracks(manifest: ExpansionReviewManifest): readonly ExpansionNarrationTrack[] {
  return [
    ...Object.values(manifest.galleryNarration ?? {}).flatMap(localized => Object.values(localized)),
    ...manifest.comparisons.flatMap(item => item.narration
      ? Object.values(item.narration).flatMap(localized => Object.values(localized)) : []),
  ]
}

function validateExpansionNarration(manifest: ExpansionReviewManifest): void {
  const locales = ['zh-CN', 'en'] as const
  const phases = ['intro', 'transition', 'arrival'] as const
  const usedUrls = new Set<string>()
  const assertKeys = (value: unknown, keys: readonly string[], label: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
      throw new Error(`Incomplete candidate narration ${label}`)
    }
  }
  const validateTrack = (track: ExpansionNarrationTrack, animalId: string, locale: string, phase: string) => {
    if (!track || typeof track.url !== 'string' ||
        !track.url.startsWith(`/__museum-review-assets/${animalId}/`) ||
        !track.url.endsWith(`.${locale.toLowerCase()}.mp3`) ||
        (phase !== 'gallery' && !new RegExp(`(?:^|[-.])${phase}(?:[-.]|$)`).test(track.url.split('/').at(-1)!)) ||
        usedUrls.has(track.url) || !/^[a-f0-9]{64}$/.test(track.sha256) ||
        typeof track.script !== 'string' || !track.script.trim() ||
        !Number.isInteger(track.durationMs) || track.durationMs <= 0 || track.durationMs > 120_000) {
      throw new Error(`Invalid candidate narration identity: ${animalId}/${locale}/${phase}`)
    }
    const path = manifest.files[track.url]
    if (!path || !path.endsWith('.mp3')) throw new Error(`Unlisted candidate narration route: ${track.url}`)
    const bytes = readFileSync(resolve(path))
    if (createHash('sha256').update(bytes).digest('hex') !== track.sha256) {
      throw new Error(`Candidate narration hash mismatch: ${animalId}/${locale}/${phase}`)
    }
    const measuredMs = Math.round(Number(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', resolve(path),
    ], { encoding: 'utf8', timeout: 10_000 }).trim()) * 1_000)
    if (!Number.isFinite(measuredMs) || Math.abs(measuredMs - track.durationMs) > 2) {
      throw new Error(`Candidate narration duration mismatch: ${animalId}/${locale}/${phase}`)
    }
    usedUrls.add(track.url)
  }
  for (const [id, localized] of Object.entries(manifest.galleryNarration ?? {})) {
    const animal = manifest.animals.find(item => item.id === id)
    if (!animal) throw new Error(`Unknown candidate gallery narration: ${id}`)
    assertKeys(localized, locales, id)
    for (const locale of locales) {
      const track = localized[locale]
      validateTrack(track, id, locale, 'gallery')
      const asset = reviewNarrationAssetFor(animal.assets.narration, locale)
      const plan = reviewNarrationPlanFor(animal.narration, locale)
      const content = animal.content[locale]
      if (!content || track.script !== content.narration.sentences.join('\n') ||
          asset?.status !== 'ready' || asset.url !== track.url || plan?.status !== 'ready' ||
          asset.sourcePath !== `audio/narration.${locale}.mp3` || plan.sourcePath !== asset.sourcePath ||
          asset.mimeType !== 'audio/mpeg' || plan.mimeType !== 'audio/mpeg') {
        throw new Error(`Candidate gallery narration display binding mismatch: ${id}/${locale}`)
      }
    }
  }
  for (const animal of manifest.animals) {
    if (locales.some(locale => reviewNarrationAssetFor(animal.assets.narration, locale)?.status === 'ready') &&
        !manifest.galleryNarration?.[animal.id]) {
      throw new Error(`Unbound ready candidate narration: ${animal.id}`)
    }
  }
  for (const comparison of manifest.comparisons) {
    if (!comparison.narration) continue
    assertKeys(comparison.narration, locales, comparison.id)
    for (const locale of locales) {
      assertKeys(comparison.narration[locale], phases, `${comparison.id}/${locale}`)
      for (const phase of phases) validateTrack(comparison.narration[locale][phase], comparison.id, locale, phase)
    }
  }
}

export function readExpansionReviewManifest(enabled: boolean): ExpansionReviewManifest {
  if (!enabled) return empty
  const path = resolve('.handoff/expansion-12/runtime-catalog.json')
  if (!existsSync(path)) return empty
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ExpansionReviewManifest
  const roots = [
    resolve('assets/candidates/expansion-12') + sep,
    resolve('src/content/animals') + sep,
  ]
  for (const [route, relativePath] of Object.entries(manifest.files)) {
    if (!/^\/__museum-review-assets\/expansion-[a-z0-9-]+\/[a-z0-9.-]+$/.test(route)) {
      throw new Error(`Invalid candidate review route: ${route}`)
    }
    const file = realpathSync(resolve(relativePath))
    if (!roots.some((root) => file.startsWith(root)) || !statSync(file).isFile()) {
      throw new Error(`Candidate asset outside allowed roots: ${relativePath}`)
    }
  }
  const ids = new Set<string>()
  const hashes = new Map<string, string>()
  const modelClips = new Map<string, Map<string, number>>()
  for (const animal of manifest.animals) {
    if (!/^expansion-[a-z0-9-]+$/.test(animal.id) || ids.has(animal.id) || animal.status !== 'draft') {
      throw new Error('Expansion entries must be unique local drafts.')
    }
    ids.add(animal.id)
    const path = manifest.files[animal.assets.model]
    if (!path) throw new Error(`Missing candidate model route: ${animal.id}`)
    const data = readFileSync(resolve(path))
    if (data.length !== animal.assets.modelBytes || data.length > 12 * 1024 * 1024) {
      throw new Error(`Candidate model bytes or budget mismatch: ${animal.id}`)
    }
    const hash = createHash('sha256').update(data).digest('hex')
    if (manifest.modelHashes[animal.id] !== hash) throw new Error(`Candidate model hash mismatch: ${animal.id}`)
    hashes.set(animal.id, hash)
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as {
      animations?: { name?: string; samplers: { input: number }[] }[]
      accessors: { max?: number[] }[]
    }
    const clips = new Map<string, number>()
    for (const animation of gltf.animations ?? []) {
      if (!animation.name || clips.has(animation.name)) throw new Error(`Invalid candidate clip identity: ${animal.id}`)
      const duration = Math.max(...animation.samplers.map(sampler => gltf.accessors[sampler.input]?.max?.[0] ?? NaN))
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid candidate clip duration: ${animal.id}`)
      clips.set(animation.name, duration)
    }
    if (animal.animation && !clips.has(animal.animation.clip)) throw new Error(`Missing selected candidate clip: ${animal.id}`)
    if (manifest.evidenceVersion === 'motion-v5' && animal.animation?.clip !== 'Idle') throw new Error(`Stationary Idle required: ${animal.id}`)
    modelClips.set(animal.id, clips)
  }
  const comparisonIds = new Set<string>()
  const allowed = new Set([
    'expansion-parasaurolophus', 'expansion-dimetrodon', 'expansion-gallimimus',
    'expansion-ankylosaurus', 'expansion-styxosaurus', 'expansion-livyatan',
    'expansion-allosaurus-pandras', 'expansion-xiphactinus',
  ])
  for (const comparison of manifest.comparisons) {
    if (!allowed.has(comparison.id) || comparisonIds.has(comparison.id) ||
        hashes.get(comparison.id) !== comparison.modelSha256 ||
        !Number.isFinite(comparison.meters) || comparison.meters <= 0) {
      throw new Error(`Invalid candidate comparison calibration: ${comparison.id}`)
    }
    comparisonIds.add(comparison.id)
    if (comparison.motionFootprint) {
      const footprint = comparison.motionFootprint
      if (footprint.modelSha256 !== comparison.modelSha256 || footprint.clip !== manifest.animals.find(animal => animal.id === comparison.id)?.animation?.clip ||
          !modelClips.get(comparison.id)?.has(footprint.clip) ||
          Math.abs(footprint.duration - modelClips.get(comparison.id)!.get(footprint.clip)!) > .0001 ||
          !Number.isFinite(footprint.duration) || !Number.isInteger(footprint.sampleCount) || footprint.sampleCount < Math.ceil(footprint.duration * 24) + 1 ||
          footprint.points.length < 3 || footprint.points.length > 4096 ||
          footprint.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) {
        throw new Error(`Invalid swept motion footprint: ${comparison.id}`)
      }
    }
    if (comparison.walkContacts) {
      const contacts = comparison.walkContacts
      const footNames = contacts.frames[0]?.feet.map(foot => foot.name) ?? []
      if (!footNames.length || new Set(footNames).size !== footNames.length ||
          footNames.some(name => typeof name !== 'string' || !name.trim())) {
        throw new Error(`Invalid animated sole identities: ${comparison.id}`)
      }
      const legacyWalker = ['expansion-dimetrodon', 'expansion-gallimimus'].includes(comparison.id)
      const explicitRoute = contacts.stopLegNodeNames !== undefined || contacts.cruiseSeconds !== undefined || !legacyWalker
      if (explicitRoute && (!contacts.stopLegNodeNames?.length || contacts.stopLegNodeNames.length > 120 ||
          new Set(contacts.stopLegNodeNames).size !== contacts.stopLegNodeNames.length ||
          contacts.stopLegNodeNames.some(name => typeof name !== 'string' || !name.trim()) ||
          !Number.isFinite(contacts.speedMetersPerSecond) || contacts.speedMetersPerSecond! <= 0 || contacts.speedMetersPerSecond! > 2 ||
          !Number.isFinite(contacts.cruiseSeconds) || contacts.cruiseSeconds! < 22 || contacts.cruiseSeconds! > 26)) {
        throw new Error(`Invalid calibrated walking route: ${comparison.id}`)
      }
      if (contacts.modelSha256 !== comparison.modelSha256 || contacts.clip !== 'Walk' ||
          !modelClips.get(comparison.id)?.has(contacts.clip) ||
          contacts.duration !== 8 || contacts.sampleRate !== 24 || contacts.frames.length !== 193 ||
          contacts.meters !== comparison.meters || contacts.frames.some((frame, index) =>
            Math.abs(frame.time - index / 24) > 1e-5 || frame.feet.length !== contacts.frames[0].feet.length ||
            frame.feet.some((foot, footIndex) => foot.name !== footNames[footIndex] || foot.center.length !== 3 || foot.center.some(n => !Number.isFinite(n)) ||
              !Number.isFinite(foot.width) || !Number.isFinite(foot.depth) || foot.width <= 0 || foot.depth <= 0 || typeof foot.stance !== 'boolean'))) {
        throw new Error(`Invalid animated sole contacts: ${comparison.id}`)
      }
    }
    if (comparison.idleContacts) {
      const contacts = comparison.idleContacts
      const footNames = contacts.frames[0]?.feet.map(foot => foot.name) ?? []
      const duration = modelClips.get(comparison.id)?.get('Idle')
      if (contacts.clip !== 'Idle' || contacts.modelSha256 !== comparison.modelSha256 ||
          duration === undefined || !Number.isFinite(contacts.duration) || contacts.duration <= 0 || Math.abs(contacts.duration - duration) > .0001 ||
          contacts.sampleRate !== 24 || contacts.frames.length !== Math.round(duration * 24) + 1 ||
          contacts.meters !== comparison.meters || !footNames.length || new Set(footNames).size !== footNames.length ||
          footNames.some(name => typeof name !== 'string' || !name.trim()) ||
          contacts.frames.some((frame, index) => Math.abs(frame.time - index / 24) > 1e-5 ||
            frame.feet.length !== footNames.length || frame.feet.some((foot, footIndex) =>
              foot.name !== footNames[footIndex] || foot.center.length !== 3 || foot.center.some(value => !Number.isFinite(value)) ||
              !Number.isFinite(foot.width) || !Number.isFinite(foot.depth) || foot.width <= 0 || foot.depth <= 0 || typeof foot.stance !== 'boolean'))) {
        throw new Error(`Invalid stationary Idle contacts: ${comparison.id}`)
      }
    }
    if (manifest.evidenceVersion === 'motion-v5' && comparison.habitat === 'land' && !comparison.idleContacts) {
      throw new Error(`Stationary land comparison requires Idle contacts: ${comparison.id}`)
    }
    if (comparison.habitat === 'land' && manifest.animals.find(animal => animal.id === comparison.id)?.animation && !comparison.motionFootprint) {
      throw new Error(`Animated land comparison requires a swept footprint: ${comparison.id}`)
    }
  }
  if (manifest.evidenceVersion === 'motion-v5' && (ids.size !== 12 || comparisonIds.size !== 8)) throw new Error('Idle review requires twelve gallery and eight comparison animals.')
  validateExpansionNarration(manifest)
  return { ...manifest, clipDurations: Object.fromEntries(manifest.animals.filter(animal => animal.animation).map(animal =>
    [animal.id, modelClips.get(animal.id)!.get(animal.animation!.clip)!])) }
}
