import {findFlightAssetBoundaryFindings} from './flight/build-asset-boundary.mjs'
import { createHash } from 'node:crypto'
import { extname, join, relative } from 'node:path'
import { readFile } from 'node:fs/promises'

import { mainCollection } from '../src/content/collections/main'
import { supportedLocales } from '../src/i18n/locale'
import { localReviewAssetPrefix } from './review-assets'
import { unprefixedRouteMarker } from './review-server-security'
import {
  collectProductionFiles,
  findForbiddenProductionMarkers,
  scaleEncounterPrivateReviewMarkers,
} from './production-boundary-markers'

const candidate = process.argv.includes('--release-candidate')
if (candidate && process.env.MUSEUM_RELEASE_CANDIDATE !== '1') throw new Error('Candidate boundary requires explicit candidate catalog selection.')
const distributionRoot = join(process.cwd(), candidate ? 'dist-release-candidate' : 'dist')
const forbiddenMarkers = [
  unprefixedRouteMarker(localReviewAssetPrefix),
  '.handoff/collection-review',
  ...scaleEncounterPrivateReviewMarkers,
  ...(!mainCollection.animalIds.includes('parasaurolophus') ? ['parasaurolophus', '副栉龙'] : []),
  ...(!candidate ? ['candidate-media-evidence'] : []),
]

const findings: string[] = []
const flightEnabled=process.env.MUSEUM_FLIGHT === '1'
// One landscape plus three same-species companion LODs; hashes checked below.
const expectedFlightGlbCount = flightEnabled ? 4 : 0
const expectedFlightLandscapeCount=flightEnabled?1:0
const files = await collectProductionFiles(distributionRoot)
const distributionPaths = new Set(
  files.map((absolutePath) => relative(distributionRoot, absolutePath)),
)

// Vite hashes emitted asset names, so scanning only the final filenames can
// miss a private candidate that was copied into dist. The manifest preserves
// each original source path and is therefore part of the production boundary.
if (!distributionPaths.has('.vite/manifest.json')) {
  findings.push('.vite/manifest.json: missing production source manifest')
}
if (!distributionPaths.has('SCALE_ENCOUNTER_ASSET_PROVENANCE.md')) {
  findings.push('missing scale-encounter runtime asset provenance notice')
}

const markerFindings = await findForbiddenProductionMarkers(
  distributionRoot,
  forbiddenMarkers,
  files,
)
findings.push(
  ...markerFindings.map(
    ({ distributionPath, marker }) => `${distributionPath}: ${marker}`,
  ),
)

const glbFiles = files.filter((file) => extname(file) === '.glb')
const mp3Files = files.filter((file) => extname(file) === '.mp3')
const sourceMaps = files.filter((file) => extname(file) === '.map')
// Keep the historical candidate guard runtime-checked even when the normal
// collection's readonly tuple has a different literal length.
const expectedAnimalAssetCount = Number(mainCollection.animalIds.length)
const expectedNarrationAssetCount =
  expectedAnimalAssetCount * supportedLocales.length
const expectedScaleEncounterGlbCount = 12
const narrationManifest = JSON.parse(
  await readFile(
    join(process.cwd(), 'src/scale-encounter/audio/narration-candidates.json'),
    'utf8',
  ),
) as { readonly tracks: readonly { readonly file: string }[] }
const additionsManifest = JSON.parse(await readFile(join(process.cwd(), 'src/scale-encounter/audio/additions-manifest.json'), 'utf8')) as { tracks: { file: string; animalId: string }[] }
const selectedAdditions = additionsManifest.tracks.filter(t => mainCollection.animalIds.includes(t.animalId))
const expectedScaleEncounterNarrationFiles = [...narrationManifest.tracks.filter(
  ({ file }) =>
    file.startsWith('view-switch-') ||
    mainCollection.animalIds.some((animalId) =>
      file.startsWith(`${animalId}-`),
    ),
), ...selectedAdditions]
function selectedComparisonCount(): number { return 24 + new Set(selectedAdditions.map(t => t.animalId)).size }
const expectedScaleEncounterNarrationCount =
  expectedScaleEncounterNarrationFiles.length
if (candidate && (expectedAnimalAssetCount !== 36 || selectedComparisonCount() !== 32 || expectedScaleEncounterNarrationCount !== 196)) findings.push('Candidate requires exactly36gallery/32comparison/196comparison MP3.')
const expectedDetailPaths = supportedLocales.flatMap((locale) =>
  mainCollection.animalIds.map(
    (animalId) => `${locale}/animals/${animalId}/index.html`,
  ),
)
const actualDetailPaths = [...distributionPaths].filter((filePath) =>
  /^(?:zh-CN|en)\/animals\/[^/]+\/index\.html$/.test(filePath),
)
const expectedSocialImagePaths = mainCollection.animalIds.map(
  (animalId) => `animals/${animalId}/social.webp`,
)

for (const detailPath of expectedDetailPaths) {
  if (!distributionPaths.has(detailPath)) {
    findings.push(`missing static animal detail: ${detailPath}`)
  }
}
for (const detailPath of actualDetailPaths) {
  if (!expectedDetailPaths.includes(detailPath)) {
    findings.push(`unexpected static animal detail: ${detailPath}`)
  }
}
for (const socialImagePath of expectedSocialImagePaths) {
  if (!distributionPaths.has(socialImagePath)) {
    findings.push(`missing animal social image: ${socialImagePath}`)
  }
}
if (actualDetailPaths.length !== expectedDetailPaths.length) {
  findings.push(
    `expected exactly ${expectedDetailPaths.length} static animal details; found ${actualDetailPaths.length}`,
  )
}
if (
  glbFiles.length !==
  expectedAnimalAssetCount + expectedScaleEncounterGlbCount + expectedFlightGlbCount
) {
  findings.push(
    `expected exactly ${expectedAnimalAssetCount + expectedScaleEncounterGlbCount + expectedFlightGlbCount} production GLBs; found ${glbFiles.length}`,
  )
}
const flightSamples = glbFiles.filter(file => file.includes('ecology-r5-'))
if (flightSamples.length !== expectedFlightLandscapeCount) findings.push('Flight landscape candidate escaped its build gate or is missing')
if (expectedFlightLandscapeCount === 1 && flightSamples[0]) {
  const candidate = JSON.parse(await readFile('src/flight-experience/assets/ecology-r5/manifest.json', 'utf8')) as { sha256: string }
  const hash = createHash('sha256').update(await readFile(flightSamples[0])).digest('hex')
  if (hash !== candidate.sha256) findings.push('Flight landscape candidate hash differs from its manifest')
}
if (
  mp3Files.length !==
  expectedNarrationAssetCount + expectedScaleEncounterNarrationCount
) {
  findings.push(
    `expected exactly ${expectedNarrationAssetCount + expectedScaleEncounterNarrationCount} approved locale MP3s; found ${mp3Files.length}`,
  )
}
if (sourceMaps.length !== 0) {
  findings.push(`expected 0 production source maps; found ${sourceMaps.length}`)
}

if (distributionPaths.has('.vite/manifest.json')) {
  const viteManifest = JSON.parse(
    await readFile(join(distributionRoot, '.vite/manifest.json'), 'utf8'),
  ) as Record<string, { readonly file?: string; readonly src?: string }>
  findings.push(...await findFlightAssetBoundaryFindings(distributionRoot,flightEnabled,files,viteManifest))
  const productionSources = new Set(
    Object.entries(viteManifest).flatMap(([key, entry]) => [
      key,
      ...(entry.src ? [entry.src] : []),
    ]),
  )
  const runtimeChecksums = await readFile(
    join(process.cwd(), 'src/scale-encounter/assets/SHA256SUMS'),
    'utf8',
  )
  // Retain historical source hashes without requiring replaced textures to
  // ship alongside their replacements.
  const supersededEnvironmentAssets = new Set([
    'environments/clouds-unique-v2.webp',
    'environments/clouds-natural-v3.webp',
    'environments/panorama-gobi-irendabas-photoreal-v1-2048.webp',
    'environments/panorama-gobi-irendabas-photoreal-v1-4096.webp',
    'environments/sky/aerial-island-atlas-v1.webp',
    'environments/surface-floodplain-red-silt-albedo-v1.webp',
    'environments/surface-gobi-gravel-albedo-v1.webp',
    'environments/surface-land-v4-humus-albedo-1254.webp',
    'environments/snow-drifts-unique-v2.webp',
    'environments/panorama-irendabas-open-plain-v3.webp',
    'environments/panorama-floodplain-kayenta-photoreal-v1-2048.webp',
    'environments/panorama-floodplain-kayenta-photoreal-v1-4096.webp',
  ])
  const expectedRuntimeSources = runtimeChecksums
    .trim()
    .split('\n')
    .map((line) => line.match(/^[a-f0-9]{64} {2}(.+)$/)?.[1])
    .filter((fileName): fileName is string => typeof fileName === 'string' && !supersededEnvironmentAssets.has(fileName))
    .map((fileName) => `src/scale-encounter/assets/${fileName}`)
  const expectedNarrationSources = expectedScaleEncounterNarrationFiles
    .map(({ file }) => `src/scale-encounter/audio/${file}`)

  const canonicalAssets = mainCollection.animalIds.flatMap(id => [
    'model/model.glb', 'images/poster.webp', 'images/poster-portrait.webp', 'images/thumbnail.webp',
    'backgrounds/landscape.webp', 'backgrounds/portrait.webp',
    'audio/narration.zh-CN.mp3', 'audio/narration.en.mp3',
  ].map(asset => `src/content/animals/${id}/${asset}`))
  const emittedScripts = await Promise.all(files.filter(p => extname(p) === '.js').map(p => readFile(p, 'utf8')))
  for (const id of mainCollection.animalIds) {
    if (!emittedScripts.some(script => script.includes(`${id}:model/model.glb`))) {
      findings.push(`parent drawer model credit missing from runtime catalog: ${id}`)
    }
  }
  for (const sourcePath of [...canonicalAssets, ...expectedNarrationSources]) {
    const entry = Object.entries(viteManifest).find(([key, entry]) => key === sourcePath || entry.src === sourcePath)?.[1]
    const sourceBytes = await readFile(join(process.cwd(), sourcePath))
    if (!entry?.file) {
      // Vite legitimately inlines small images. Require the complete exact
      // data URL payload, rather than silently skipping a missing manifest key.
      const mime = sourcePath.endsWith('.webp') ? 'image/webp' : sourcePath.endsWith('.png') ? 'image/png' : undefined
      const exactInline = mime && sourceBytes.length <= 4096
        ? `data:${mime};base64,${sourceBytes.toString('base64')}` : undefined
      if (!exactInline || !emittedScripts.some(script => script.includes(exactInline))) {
        findings.push(`canonical runtime source missing from manifest or exact inline payload: ${sourcePath}`)
      }
      continue
    }
    const runtimeBytes = await readFile(join(distributionRoot, entry.file))
    if (createHash('sha256').update(sourceBytes).digest('hex') !== createHash('sha256').update(runtimeBytes).digest('hex')) {
      findings.push(`canonical runtime source hash mismatch: ${sourcePath}`)
    }
  }
  for (const sourcePath of [
    ...expectedRuntimeSources,
    ...expectedNarrationSources,
  ]) {
    if (!productionSources.has(sourcePath)) {
      findings.push(`approved runtime asset missing from manifest: ${sourcePath}`)
    }
  }
}

if (findings.length > 0) {
  console.error(
    'Production distribution contains local-review animal or asset material:',
  )
  for (const finding of findings) {
    console.error(`- ${finding}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `${candidate ? 'Local release-candidate' : 'Production'} boundary: ${files.length} artifact(s) scanned, ${actualDetailPaths.length} animal detail HTML files, ${expectedSocialImagePaths.length} animal social images, ${glbFiles.length} GLBs, ${mp3Files.length} MP3s, 0 source maps, 0 private source marker(s).`,
  )
}
