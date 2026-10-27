import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const previewUrl = 'http://127.0.0.1:4188/'
const outputPath = process.argv[2] ? resolve(process.argv[2]) : null
const issues = []
const samples = []
const browser = await chromium.launch({
  args: ['--use-angle=metal'],
  headless: true,
})
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { height: 900, width: 1440 },
})
page.on('console', (message) => {
  if (message.type() === 'error') issues.push(`console:${message.text()}`)
})
page.on('pageerror', (error) => issues.push(`pageerror:${error.message}`))
page.on('requestfailed', (request) => {
  issues.push(`requestfailed:${request.url()}:${request.failure()?.errorText}`)
})
const response = await page.goto(`${previewUrl}?variant=C&chrome=0`, {
  waitUntil: 'networkidle',
})
if (!response?.ok()) throw new Error(`sky-preview-http:${response?.status()}`)
await page.waitForFunction(() => window.__SKY_REVIEW__?.ready === true, null, {
  timeout: 30_000,
})

async function call(method, ...args) {
  await page.evaluate(
    async ({ args: callArgs, method: callMethod }) => {
      const operation = window.__SKY_REVIEW__?.[callMethod]
      if (typeof operation !== 'function') throw new Error(callMethod)
      await operation(...callArgs)
    },
    { args, method },
  )
}

async function sample(label) {
  await call('waitForFrames', 3)
  const diagnostics = await page.evaluate(() =>
    window.__SKY_REVIEW__.diagnostics(),
  )
  const avatar = diagnostics.subjects.avatar
  const approximation = avatar.prototypeFlightApproximation
  samples.push({
    altitudeFailures: diagnostics.environment.cloudDiagnostics.filter(
      (cloud) => {
        const band = diagnostics.environment.heightBands.find(
          (candidate) => candidate.id === cloud.bandId,
        )
        return (
          !band ||
          cloud.altitudeMinimumMeters < band.minimumAltitudeMeters ||
          cloud.altitudeMaximumMeters > band.maximumAltitudeMeters
        )
      },
    ),
    buildId: diagnostics.build.buildId,
    avatarOcclusionEvaluated:
      diagnostics.environment.avatarOcclusionEvaluated,
    contextLossCount: diagnostics.browser.contextLossCount,
    corridorOverlapCount: diagnostics.environment.corridorOverlapCount,
    label,
    prototypeFlightApproximation: {
      approximatedBodyAxisWorld: approximation.approximatedBodyAxisWorld,
      baseSubjectBoundsMatchesDynamicBounds:
        JSON.stringify(avatar.baseSubjectBounds) ===
        JSON.stringify(approximation.transformedDynamicBounds),
      enabled: approximation.enabled,
      flightDirectionWorld: approximation.flightDirectionWorld,
      limitation: approximation.limitation,
      modelTransformBaked: approximation.modelTransformBaked,
      pivotLocal: approximation.pivotLocal,
      pivotWorld: approximation.pivotWorld,
      rotationEulerDegrees: approximation.rotationEulerDegrees,
      rotationQuaternion: approximation.rotationQuaternion,
      sourceAnimationReclassified:
        approximation.sourceAnimationReclassified,
      sourceModelIdentityUnchanged:
        approximation.sourceModelIdentityUnchanged,
    },
    occludingClouds: diagnostics.environment.cloudDiagnostics
      .filter((cloud) => cloud.subjectOcclusionFraction > 0)
      .map((cloud) => ({
        id: cloud.id,
        subjectOcclusionFraction: cloud.subjectOcclusionFraction,
      })),
    renderer: diagnostics.environment.rendererCapabilities.renderer,
    subjectOcclusionMaximumFraction:
      diagnostics.environment.subjectOcclusionMaximumFraction,
  })
}

function dot(left, right) {
  return left.reduce(
    (total, value, index) => total + value * (right[index] ?? 0),
    0,
  )
}

async function auditPrototypeFlightApproximationToggle() {
  const readAvatar = () =>
    page.evaluate(() => window.__SKY_REVIEW__.diagnostics().subjects.avatar)
  const initial = await readAvatar()
  await call('setPrototypeFlightApproximation', false)
  const standing = await readAvatar()
  await call('setPrototypeFlightApproximation', true)
  const flight = await readAvatar()
  const approximation = flight.prototypeFlightApproximation
  const failures = [
    ...(initial.prototypeFlightApproximation.enabled !== true
      ? ['initial-approximation-disabled']
      : []),
    ...(standing.prototypeFlightApproximation.enabled !== false
      ? ['standing-toggle-not-applied']
      : []),
    ...(approximation.enabled !== true
      ? ['flight-toggle-not-restored']
      : []),
    ...(dot(
      approximation.approximatedBodyAxisWorld,
      approximation.flightDirectionWorld,
    ) < 0.999999
      ? ['body-axis-not-parallel-to-flight-direction']
      : []),
    ...(approximation.modelTransformBaked !== false
      ? ['model-transform-baked']
      : []),
    ...(approximation.sourceAnimationReclassified !== false
      ? ['source-animation-reclassified']
      : []),
    ...(approximation.sourceModelIdentityUnchanged !== true
      ? ['source-model-identity-changed']
      : []),
    ...(JSON.stringify(
      standing.prototypeFlightApproximation.sourceBoundsAtCurrentPlacement,
    ) !== JSON.stringify(standing.baseSubjectBounds)
      ? ['standing-bounds-mismatch']
      : []),
    ...(JSON.stringify(approximation.transformedDynamicBounds) !==
    JSON.stringify(flight.baseSubjectBounds)
      ? ['flight-dynamic-bounds-mismatch']
      : []),
    ...(standing.filename !== flight.filename ||
    standing.modelSha256 !== flight.modelSha256 ||
    standing.rigId !== flight.rigId ||
    standing.variantId !== flight.variantId
      ? ['source-identity-changed-across-toggle']
      : []),
    ...(!approximation.limitation.includes('not a final flight pose')
      ? ['prototype-limitation-missing']
      : []),
  ]
  return {
    failures,
    flight: {
      baseSubjectBounds: flight.baseSubjectBounds,
      diagnostic: approximation,
    },
    passed: failures.length === 0,
    sourceIdentity: {
      filename: flight.filename,
      modelSha256: flight.modelSha256,
      rigId: flight.rigId,
      variantId: flight.variantId,
    },
    standing: {
      baseSubjectBounds: standing.baseSubjectBounds,
      diagnostic: standing.prototypeFlightApproximation,
    },
  }
}

const prototypeFlightApproximationToggleAudit =
  await auditPrototypeFlightApproximationToggle()

for (const view of ['overview', 'pov']) {
  for (const range of ['minimum', 'default', 'maximum']) {
    await call('setView', view, range)
    await sample(`${view}-${range}`)
  }
}
for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
  await call('setTransitionProgress', progress)
  await sample(`transition-${progress}`)
}
for (const height of ['overview', 'eye-level', 'cloud-boundary']) {
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    await call('setOrbit', azimuth, height)
    await sample(`orbit-${height}-${azimuth}`)
  }
}

const maximumOcclusion = Math.max(
  ...samples.map((entry) => entry.subjectOcclusionMaximumFraction),
)
const renderer = samples[0]?.renderer ?? 'unknown'
const softwareRenderer =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(
    renderer,
  )
const failures = [
  ...(issues.length > 0 ? [`browser-issues:${issues.length}`] : []),
  ...(samples.some((entry) => entry.contextLossCount > 0)
    ? ['context-loss']
    : []),
  ...(samples.some((entry) => entry.corridorOverlapCount > 0)
    ? ['corridor-overlap']
    : []),
  ...(samples.some((entry) => entry.altitudeFailures.length > 0)
    ? ['altitude-contract']
    : []),
  ...(maximumOcclusion > 0 ? [`subject-aabb-overlap:${maximumOcclusion}`] : []),
  ...(!prototypeFlightApproximationToggleAudit.passed
    ? [
        `prototype-flight-approximation:${prototypeFlightApproximationToggleAudit.failures.join(',')}`,
      ]
    : []),
  ...(softwareRenderer ? [`software-renderer:${renderer}`] : []),
]
const result = {
  buildIds: [...new Set(samples.map((entry) => entry.buildId))],
  failures,
  generatedAt: new Date().toISOString(),
  issues,
  maximumOcclusion,
  passed: failures.length === 0,
  prototypeFlightApproximationToggleAudit,
  renderer,
  sampleCount: samples.length,
  samples,
}
if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
await browser.close()
if (!result.passed) process.exitCode = 1
