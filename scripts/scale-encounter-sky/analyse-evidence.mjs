import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const worktreeRoot = resolve(import.meta.dirname, '../..')
const evidenceDirectoryName = process.argv[2]
if (!evidenceDirectoryName?.startsWith('scale-encounter-sky-')) {
  throw new Error(
    'usage: node scripts/scale-encounter-sky/analyse-evidence.mjs scale-encounter-sky-<build-id>-<date>',
  )
}
const evidenceRoot = resolve(worktreeRoot, '.handoff', evidenceDirectoryName)

function distanceFromPointToBox(point, bounds) {
  const axisDistance = (value, minimum, maximum) =>
    value < minimum ? minimum - value : value > maximum ? value - maximum : 0
  return Math.hypot(
    axisDistance(point.x, bounds.minimum.x, bounds.maximum.x),
    axisDistance(point.y, bounds.minimum.y, bounds.maximum.y),
    axisDistance(point.z, bounds.minimum.z, bounds.maximum.z),
  )
}

function vectorDot(left, right) {
  return left.reduce(
    (total, value, index) => total + value * (right[index] ?? 0),
    0,
  )
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readCaptureDirectory(directory) {
  const absoluteDirectory = resolve(evidenceRoot, directory)
  const captures = []
  for (const filename of await readdir(absoluteDirectory)) {
    if (!filename.endsWith('.json') || filename.startsWith('contact-')) continue
    const value = JSON.parse(await readFile(resolve(absoluteDirectory, filename)))
    if (value.diagnostics) captures.push({ filename, ...value })
  }
  return captures
}

const captureGroups = Object.fromEntries(
  await Promise.all(
    ['layer-isolation', 'layouts', 'transitions', 'views'].map(
      async (directory) => [directory, await readCaptureDirectory(directory)],
    ),
  ),
)
const captures = Object.values(captureGroups).flat()
const acceptanceCaptures = [
  ...captureGroups.layouts,
  ...captureGroups.transitions,
  ...captureGroups.views,
]
const buildIds = [...new Set(captures.map((capture) => capture.buildId))]
const revisions = [...new Set(captures.map((capture) => capture.revision))]
const manifestHashes = [
  ...new Set(captures.map((capture) => capture.assetManifestHash)),
]
const browserErrors = captures.flatMap((capture) => capture.browser.errors)
const contextLossMaximum = Math.max(
  ...captures.map((capture) => capture.diagnostics.browser.contextLossCount),
)
const corridorOverlapMaximum = Math.max(
  ...captures.map(
    (capture) => capture.diagnostics.environment.corridorOverlapCount,
  ),
)
const subjectOcclusionMaximumFraction = Math.max(
  ...acceptanceCaptures.map(
    (capture) =>
      capture.diagnostics.environment.subjectOcclusionMaximumFraction,
  ),
)
const diagnosticViewSubjectOcclusionMaximumFraction = Math.max(
  ...captureGroups['layer-isolation'].map(
    (capture) =>
      capture.diagnostics.environment.subjectOcclusionMaximumFraction,
  ),
)
const overdrawMaximumLayerCount = Math.max(
  ...captures.map(
    (capture) =>
      capture.diagnostics.environment.transparentOverdraw.maximumLayerCount,
  ),
)
const overdrawMaximumViewportCoverageFraction = Math.max(
  ...captures.map(
    (capture) =>
      capture.diagnostics.environment.transparentOverdraw
        .viewportCoverageFraction,
  ),
)

const altitudeFailures = []
for (const capture of captures) {
  const bands = new Map(
    capture.diagnostics.environment.heightBands.map((band) => [band.id, band]),
  )
  for (const cloud of capture.diagnostics.environment.cloudDiagnostics) {
    const band = bands.get(cloud.bandId)
    if (
      !band ||
      cloud.altitudeMinimumMeters < band.minimumAltitudeMeters ||
      cloud.altitudeMaximumMeters > band.maximumAltitudeMeters
    ) {
      altitudeFailures.push({
        band,
        cloud,
        screenshot: capture.filename,
      })
    }
  }
}

const transitionClearance = captureGroups.transitions
  .sort((left, right) => left.filename.localeCompare(right.filename))
  .map((capture) => {
    const cameraPosition = capture.diagnostics.camera.current.position
    const subjects = capture.diagnostics.subjects
    return {
      avatarVisible:
        capture.diagnostics.camera.current.stage !== 'eye-entry' &&
        capture.diagnostics.camera.current.stage !== 'pov',
      cameraStage: capture.diagnostics.camera.current.stage,
      cameraToAnimalBoundsMeters: Number(
        distanceFromPointToBox(
          cameraPosition,
          subjects.animal.baseSubjectBounds,
        ).toFixed(6),
      ),
      cameraToAvatarBoundsMeters: Number(
        distanceFromPointToBox(
          cameraPosition,
          subjects.avatar.baseSubjectBounds,
        ).toFixed(6),
      ),
      screenshot: capture.filename.replace(/\.json$/, '.png'),
      transitionProgress:
        capture.diagnostics.camera.transitionProgress,
    }
  })

function captureSummary(capture) {
  return {
    camera: capture.diagnostics.camera.current,
    canvas: capture.canvas,
    filename: capture.filename.replace(/\.json$/, '.png'),
    imageAnalysis: capture.imageAnalysis,
    viewport: capture.viewport,
  }
}

const legalViewNames = [
  'c-overview-minimum.json',
  'c-overview-default.json',
  'c-overview-maximum.json',
  'c-pov-minimum.json',
  'c-pov-default.json',
  'c-pov-maximum.json',
]
const legalViews = legalViewNames.map((filename) => {
  const capture = captureGroups.views.find((entry) => entry.filename === filename)
  if (!capture) throw new Error(`missing-legal-view:${filename}`)
  return captureSummary(capture)
})

const avatarIdentities = Object.fromEntries(
  ['boy', 'girl'].map((gender) => {
    const filename = `c-avatar-${gender}-overview.json`
    const capture = captureGroups.views.find((entry) => entry.filename === filename)
    if (!capture) throw new Error(`missing-avatar-evidence:${filename}`)
    return [gender, capture.diagnostics.subjects.avatar]
  }),
)

const standingSourceCapture = captureGroups.views.find(
  (entry) => entry.filename === 'prototype-avatar-standing-source.json',
)
const flightApproximationCapture = captureGroups.views.find(
  (entry) =>
    entry.filename === 'prototype-avatar-flight-approximation.json',
)
if (!standingSourceCapture || !flightApproximationCapture) {
  throw new Error('missing-prototype-flight-approximation-comparison')
}
const standingAvatar = standingSourceCapture.diagnostics.subjects.avatar
const flightAvatar = flightApproximationCapture.diagnostics.subjects.avatar
const standingApproximation =
  standingAvatar.prototypeFlightApproximation
const flightApproximation = flightAvatar.prototypeFlightApproximation
const approximationAxisDotFlightDirection = vectorDot(
  flightApproximation.approximatedBodyAxisWorld,
  flightApproximation.flightDirectionWorld,
)
const prototypeFlightApproximationPassed =
  standingApproximation.enabled === false &&
  flightApproximation.enabled === true &&
  standingApproximation.modelTransformBaked === false &&
  flightApproximation.modelTransformBaked === false &&
  standingApproximation.sourceAnimationReclassified === false &&
  flightApproximation.sourceAnimationReclassified === false &&
  standingApproximation.sourceModelIdentityUnchanged === true &&
  flightApproximation.sourceModelIdentityUnchanged === true &&
  approximationAxisDotFlightDirection > 0.999999 &&
  sameJson(
    standingApproximation.sourceBoundsAtCurrentPlacement,
    standingAvatar.baseSubjectBounds,
  ) &&
  sameJson(
    flightApproximation.transformedDynamicBounds,
    flightAvatar.baseSubjectBounds,
  ) &&
  standingAvatar.filename === flightAvatar.filename &&
  standingAvatar.modelSha256 === flightAvatar.modelSha256 &&
  standingAvatar.rigId === flightAvatar.rigId &&
  standingAvatar.variantId === flightAvatar.variantId

const orbitCaptures = captureGroups.views.filter((capture) =>
  capture.filename.startsWith('c-orbit-'),
)
const layoutCaptures = captureGroups.layouts
const transitionKeyframes =
  captureGroups.transitions[0]?.diagnostics.camera.transitionKeyframes ?? []
const output = {
  altitudeContract: {
    failureCount: altitudeFailures.length,
    failures: altitudeFailures,
    passed: altitudeFailures.length === 0,
  },
  avatarIdentities,
  browserHealth: {
    contextLossMaximum,
    errorCount: browserErrors.length,
    errors: browserErrors,
    passed: browserErrors.length === 0 && contextLossMaximum === 0,
  },
  buildBinding: {
    buildIds,
    manifestHashes,
    passed:
      buildIds.length === 1 &&
      revisions.length === 1 &&
      manifestHashes.length === 1,
    revisions,
  },
  cloudAndCorridor: {
    corridorOverlapMaximum,
    diagnosticViewSubjectOcclusionMaximumFraction,
    evaluatedCaptureCount: acceptanceCaptures.length,
    note:
      'Subject occlusion is gated on presentation, transition, layout, and orbit captures; intentionally reframed layer-isolation diagnostics are disclosed separately.',
    passed:
      corridorOverlapMaximum === 0 &&
      subjectOcclusionMaximumFraction === 0,
    subjectOcclusionMaximumFraction,
  },
  generatedAt: new Date().toISOString(),
  layouts: layoutCaptures.map(captureSummary),
  legalViews,
  orbitMatrix: {
    azimuthCount: new Set(
      orbitCaptures.map((capture) => capture.filename.split('-').at(-1)),
    ).size,
    captureCount: orbitCaptures.length,
    heightCount: new Set(
      orbitCaptures.map((capture) =>
        capture.filename.includes('cloud-boundary')
          ? 'cloud-boundary'
          : capture.filename.includes('eye-level')
            ? 'eye-level'
            : 'overview',
      ),
    ).size,
    coastCandidateFractionMaximum: Math.max(
      ...orbitCaptures.map(
        (capture) => capture.imageAnalysis.coastCandidateFraction,
      ),
    ),
    highlightClippingFractionMaximum: Math.max(
      ...orbitCaptures.map(
        (capture) => capture.imageAnalysis.highlightClippingFraction,
      ),
    ),
    seaCandidateFractionMaximum: Math.max(
      ...orbitCaptures.map(
        (capture) => capture.imageAnalysis.seaCandidateFraction,
      ),
    ),
  },
  overdraw: {
    maximumLayerCount: overdrawMaximumLayerCount,
    maximumViewportCoverageFraction: overdrawMaximumViewportCoverageFraction,
  },
  prototypeFlightApproximation: {
    axisDotFlightDirection: Number(
      approximationAxisDotFlightDirection.toFixed(9),
    ),
    flightApproximation: {
      baseSubjectBounds: flightAvatar.baseSubjectBounds,
      diagnostic: flightApproximation,
      screenshot: flightApproximationCapture.filename.replace(
        /\.json$/,
        '.png',
      ),
    },
    limitation: flightApproximation.limitation,
    passed: prototypeFlightApproximationPassed,
    sourceIdentity: {
      filename: flightAvatar.filename,
      modelSha256: flightAvatar.modelSha256,
      rigId: flightAvatar.rigId,
      variantId: flightAvatar.variantId,
    },
    standingSource: {
      baseSubjectBounds: standingAvatar.baseSubjectBounds,
      diagnostic: standingApproximation,
      screenshot: standingSourceCapture.filename.replace(/\.json$/, '.png'),
    },
  },
  transition: {
    clearance: transitionClearance,
    durationMs: 5150,
    keyframes: transitionKeyframes,
    minimumCameraToAnimalBoundsMeters: Math.min(
      ...transitionClearance.map(
        (entry) => entry.cameraToAnimalBoundsMeters,
      ),
    ),
    minimumCameraToAvatarBoundsMeters: Math.min(
      ...transitionClearance.map(
        (entry) => entry.cameraToAvatarBoundsMeters,
      ),
    ),
    minimumVisibleCameraToAvatarBoundsMeters: Math.min(
      ...transitionClearance
        .filter((entry) => entry.avatarVisible)
        .map((entry) => entry.cameraToAvatarBoundsMeters),
    ),
  },
}

await writeFile(resolve(evidenceRoot, 'technical-diagnostics.json'), `${JSON.stringify(output, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
