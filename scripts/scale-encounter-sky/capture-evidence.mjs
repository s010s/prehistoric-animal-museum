import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { relative, resolve } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'

const worktreeRoot = resolve(import.meta.dirname, '../..')
const directScaleWorktree = resolve(worktreeRoot, '../direct-scale-encounter')
const previewUrl = 'http://127.0.0.1:4188/'
const evidenceDate = process.env.SKY_EVIDENCE_DATE ?? '2026-08-16'
const desktopViewport = { height: 900, width: 1440 }
const layouts = [
  { label: 'desktop', height: 900, width: 1440 },
  { label: 'square-pc', height: 1024, width: 1024 },
  { label: 'narrow-pc', height: 1365, width: 1024 },
  { label: 'phone-sim', height: 844, width: 390 },
  { label: 'leon-phone-capture', height: 1058, width: 576 },
  { label: 'tablet-sim', height: 768, width: 1024 },
  { label: 'compact-landscape', height: 390, width: 844 },
]
const orbitHeights = ['overview', 'eye-level', 'cloud-boundary']
const orbitAzimuths = Array.from({ length: 12 }, (_, index) => index * 30)
const softwareRendererPattern =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i
const hardwareRendererPattern =
  /apple|metal|nvidia|geforce|quadro|amd|radeon|intel|iris/i

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function sha256File(absolutePath) {
  return createHash('sha256')
    .update(await readFile(absolutePath))
    .digest('hex')
}

async function collectFiles(absolutePath) {
  const info = await stat(absolutePath)
  if (info.isFile()) return [absolutePath]
  const entries = await readdir(absolutePath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (
      entry.name === '.dist' ||
      entry.name === 'evidence' ||
      entry.name === 'node_modules'
    ) {
      continue
    }
    files.push(...(await collectFiles(resolve(absolutePath, entry.name))))
  }
  return files
}

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function attachIssueRecorder(page, pageLabel, allIssues) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    allIssues.push({
      page: pageLabel,
      source: 'console',
      text: message.text(),
      timestamp: new Date().toISOString(),
    })
  })
  page.on('pageerror', (error) => {
    allIssues.push({
      page: pageLabel,
      source: 'pageerror',
      text: error.message,
      timestamp: new Date().toISOString(),
    })
  })
  page.on('requestfailed', (request) => {
    allIssues.push({
      page: pageLabel,
      source: 'requestfailed',
      text: `${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`,
      timestamp: new Date().toISOString(),
    })
  })
}

async function waitForReviewApi(page) {
  await page.waitForFunction(
    () => window.__SKY_REVIEW__?.ready === true,
    null,
    { timeout: 30_000 },
  )
  await page.evaluate(() => window.__SKY_REVIEW__.waitForFrames(8))
  await page.waitForTimeout(520)
}

async function callApi(page, method, ...args) {
  return page.evaluate(
    async ({ args: callArgs, method: callMethod }) => {
      const api = window.__SKY_REVIEW__
      if (!api?.ready) throw new Error('sky-review-api-not-ready')
      const operation = api[callMethod]
      if (typeof operation !== 'function') {
        throw new Error(`sky-review-api-method-missing:${callMethod}`)
      }
      return operation(...callArgs)
    },
    { args, method },
  )
}

async function resetDiagnosticMode(page) {
  await callApi(page, 'setDiagnosticMode', {
    backgroundTone: 'normal',
    isolateLayers: null,
    overdraw: false,
    showFlightVolumes: false,
  })
}

async function analyseScreenshot(absolutePath) {
  const { data, info } = await sharp(absolutePath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let coastPixels = 0
  let highlightPixels = 0
  let seaPixels = 0
  let sumRed = 0
  let sumGreen = 0
  let sumBlue = 0
  const pixels = info.width * info.height
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset] ?? 0
    const green = data[offset + 1] ?? 0
    const blue = data[offset + 2] ?? 0
    sumRed += red
    sumGreen += green
    sumBlue += blue
    if (
      red < 182 &&
      green > 145 &&
      blue > 165 &&
      blue > red + 24
    ) {
      seaPixels += 1
    }
    if (
      red > 122 &&
      green > 108 &&
      green < 202 &&
      blue < 156 &&
      red > blue + 16
    ) {
      coastPixels += 1
    }
    if (red > 249 && green > 249 && blue > 249) highlightPixels += 1
  }
  return {
    coastCandidateFraction: Number((coastPixels / pixels).toFixed(6)),
    highlightClippingFraction: Number(
      (highlightPixels / pixels).toFixed(6),
    ),
    meanRgb: [
      Number((sumRed / pixels).toFixed(3)),
      Number((sumGreen / pixels).toFixed(3)),
      Number((sumBlue / pixels).toFixed(3)),
    ],
    pixelHeight: info.height,
    pixelWidth: info.width,
    seaCandidateFraction: Number((seaPixels / pixels).toFixed(6)),
  }
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function makeContactSheet({
  build,
  captures,
  columns,
  label,
  outputDirectory,
  rows,
}) {
  const tileWidth = 320
  const tileHeight = 214
  const labelHeight = 30
  const sheetWidth = columns * tileWidth
  const sheetHeight = rows * (tileHeight + labelHeight)
  const composite = []
  for (let index = 0; index < captures.length; index += 1) {
    const capture = captures[index]
    const left = (index % columns) * tileWidth
    const top = Math.floor(index / columns) * (tileHeight + labelHeight)
    const image = await sharp(capture.pngPath)
      .resize(tileWidth, tileHeight, {
        background: '#102d3b',
        fit: 'contain',
      })
      .png()
      .toBuffer()
    const svg = Buffer.from(
      `<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0a2634"/><text x="12" y="20" fill="#dff3f5" font-family="Arial, sans-serif" font-size="12">${escapeXml(capture.label)}</text></svg>`,
    )
    composite.push({ input: image, left, top })
    composite.push({ input: svg, left, top: top + tileHeight })
  }
  const pngPath = resolve(outputDirectory, `${label}.png`)
  await sharp({
    create: {
      background: '#102d3b',
      channels: 3,
      height: sheetHeight,
      width: sheetWidth,
    },
  })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toFile(pngPath)
  await writeFile(
    pngPath.replace(/\.png$/, '.json'),
    json({
      assetManifestHash: build.assetManifestHash,
      browserErrors: [],
      buildId: build.buildId,
      canvas: null,
      capturedAt: new Date().toISOString(),
      contactSheet: true,
      dpr: null,
      label,
      renderer: build.renderer,
      revision: build.revision,
      sources: captures.map((capture) =>
        relative(outputDirectory, capture.pngPath),
      ),
      url: previewUrl,
      variant: 'various',
      viewport: { height: sheetHeight, width: sheetWidth },
    }),
  )
  return { label, pngPath }
}

const browser = await chromium.launch({
  args: ['--use-angle=metal'],
  headless: true,
})
const context = await browser.newContext({
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  viewport: desktopViewport,
})
const allBrowserIssues = []
const page = await context.newPage()
attachIssueRecorder(page, 'visual-capture', allBrowserIssues)
const response = await page.goto(`${previewUrl}?variant=C&chrome=0`, {
  waitUntil: 'networkidle',
})
if (!response?.ok()) throw new Error(`sky-preview-http:${response?.status()}`)
await waitForReviewApi(page)
const initialDiagnostics = await page.evaluate(() =>
  window.__SKY_REVIEW__.diagnostics(),
)
const build = {
  ...initialDiagnostics.build,
  assetManifestHash:
    initialDiagnostics.environment.assetLease.manifestSha256,
  renderer: initialDiagnostics.environment.rendererCapabilities.renderer,
  vendor: initialDiagnostics.environment.rendererCapabilities.vendor,
}
const hardwareRenderer =
  !softwareRendererPattern.test(build.renderer) &&
  hardwareRendererPattern.test(build.renderer)
if (!hardwareRenderer) {
  throw new Error(`HARDWARE_WEBGL_REQUIRED:${build.renderer}`)
}

const evidenceRoot = resolve(
  worktreeRoot,
  `.handoff/scale-encounter-sky-${build.buildId}-${evidenceDate}`,
)
for (const directory of [
  'assets',
  'layer-isolation',
  'layouts',
  'performance',
  'transitions',
  'views',
]) {
  await mkdir(resolve(evidenceRoot, directory), { recursive: true })
}

const captures = []
async function capture(category, label, mutate) {
  if (mutate) await mutate()
  await callApi(page, 'waitForFrames', 5)
  const diagnostics = await page.evaluate(() =>
    window.__SKY_REVIEW__.diagnostics(),
  )
  if (diagnostics.build.buildId !== build.buildId) {
    throw new Error(
      `mixed-sky-build:${diagnostics.build.buildId}:${build.buildId}`,
    )
  }
  const pngPath = resolve(evidenceRoot, category, `${label}.png`)
  await page.screenshot({
    animations: 'disabled',
    path: pngPath,
    type: 'png',
  })
  const imageAnalysis = await analyseScreenshot(pngPath)
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const metadata = {
    assetManifestHash: build.assetManifestHash,
    browser: {
      errors: [...allBrowserIssues, ...diagnostics.browser.issues],
      name: 'Chromium',
      osBoundary: 'local macOS host; exact host data is in build-manifest.json',
      version: browser.version(),
    },
    buildId: build.buildId,
    camera: diagnostics.camera,
    canvas: diagnostics.canvas,
    capturedAt: new Date().toISOString(),
    diagnostics,
    dirty: build.dirty,
    dpr,
    imageAnalysis,
    layers: diagnostics.environment.layerStates,
    renderer: {
      renderer: build.renderer,
      vendor: build.vendor,
    },
    revision: build.revision,
    url: page.url(),
    variant: diagnostics.variant,
    viewport: page.viewportSize(),
  }
  await writeFile(pngPath.replace(/\.png$/, '.json'), json(metadata))
  const captureRecord = { category, label, pngPath }
  captures.push(captureRecord)
  return captureRecord
}

const layoutCaptures = []
for (const layout of layouts) {
  await page.setViewportSize({ height: layout.height, width: layout.width })
  layoutCaptures.push(
    await capture('layouts', `${layout.label}-c-overview-default`, async () => {
      await resetDiagnosticMode(page)
      await callApi(page, 'setGender', 'girl')
      await callApi(page, 'setVariant', 'C')
      await callApi(page, 'setView', 'overview', 'default')
    }),
  )
}

await page.setViewportSize(desktopViewport)
const variantCaptures = []
for (const view of ['overview', 'pov']) {
  for (const variant of ['A', 'B', 'C']) {
    variantCaptures.push(
      await capture('views', `variant-${variant}-${view}-default`, async () => {
        await resetDiagnosticMode(page)
        await callApi(page, 'setVariant', variant)
        await callApi(page, 'setView', view, 'default')
      }),
    )
  }
}

const rangeCaptures = []
for (const view of ['overview', 'pov']) {
  for (const range of ['minimum', 'default', 'maximum']) {
    rangeCaptures.push(
      await capture('views', `c-${view}-${range}`, async () => {
        await resetDiagnosticMode(page)
        await callApi(page, 'setVariant', 'C')
        await callApi(page, 'setView', view, range)
      }),
    )
  }
}

const avatarCaptures = []
for (const gender of ['boy', 'girl']) {
  avatarCaptures.push(
    await capture('views', `c-avatar-${gender}-overview`, async () => {
      await resetDiagnosticMode(page)
      await callApi(page, 'setGender', gender)
      await callApi(page, 'setVariant', 'C')
      await callApi(page, 'setView', 'overview', 'default')
    }),
  )
}

const flightApproximationCaptures = []
flightApproximationCaptures.push(
  await capture('views', 'prototype-avatar-standing-source', async () => {
    await resetDiagnosticMode(page)
    await callApi(page, 'setGender', 'girl')
    await callApi(page, 'setPrototypeFlightApproximation', false)
    await callApi(page, 'setVariant', 'C')
    await callApi(page, 'setView', 'overview', 'default')
  }),
)
flightApproximationCaptures.push(
  await capture('views', 'prototype-avatar-flight-approximation', async () => {
    await resetDiagnosticMode(page)
    await callApi(page, 'setPrototypeFlightApproximation', true)
    await callApi(page, 'setVariant', 'C')
    await callApi(page, 'setView', 'overview', 'default')
  }),
)

const transitionCaptures = []
for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
  const percentage = String(Math.round(progress * 100)).padStart(3, '0')
  transitionCaptures.push(
    await capture('transitions', `c-transition-${percentage}`, async () => {
      await resetDiagnosticMode(page)
      await callApi(page, 'setVariant', 'C')
      await callApi(page, 'setTransitionProgress', progress)
    }),
  )
}

await page.setViewportSize({ height: 600, width: 960 })
const orbitCaptures = []
for (const height of orbitHeights) {
  for (const azimuth of orbitAzimuths) {
    orbitCaptures.push(
      await capture(
        'views',
        `c-orbit-${height}-${String(azimuth).padStart(3, '0')}`,
        async () => {
          await resetDiagnosticMode(page)
          await callApi(page, 'setVariant', 'C')
          await callApi(page, 'setOrbit', azimuth, height)
        },
      ),
    )
  }
}

await page.setViewportSize(desktopViewport)
const layerCaptures = []
const layerCases = [
  ['background-only', ['background-atmosphere']],
  ['flight-volume-only', ['flight-volume']],
  ['near-air-only', ['near-air']],
  ['mid-cloud-only', ['mid-cloud']],
  ['far-cloud-only', ['far-cloud']],
  [
    'combined-c',
    [
      'background-atmosphere',
      'flight-volume',
      'near-air',
      'mid-cloud',
      'far-cloud',
    ],
  ],
]
for (const [label, isolateLayers] of layerCases) {
  layerCaptures.push(
    await capture('layer-isolation', label, async () => {
      await resetDiagnosticMode(page)
      await callApi(page, 'setVariant', 'C')
      await callApi(page, 'setOrbit', 135, 'eye-level')
      await callApi(page, 'setDiagnosticMode', { isolateLayers })
    }),
  )
}
layerCaptures.push(
  await capture('layer-isolation', 'flight-volume-debug', async () => {
    await resetDiagnosticMode(page)
    await callApi(page, 'setVariant', 'C')
    await callApi(
      page,
      'setDiagnosticCamera',
      [90, 105, 90],
      [0, -8, 0],
      78,
    )
    await callApi(page, 'setDiagnosticMode', { showFlightVolumes: true })
  }),
)
layerCaptures.push(
  await capture('layer-isolation', 'transparent-overdraw-proxy', async () => {
    await resetDiagnosticMode(page)
    await callApi(page, 'setVariant', 'C')
    await callApi(
      page,
      'setDiagnosticCamera',
      [-20, 20.2, -10],
      [-20, 20, -22],
      44,
    )
    await callApi(page, 'setDiagnosticMode', {
      isolateLayers: ['background-atmosphere', 'near-air'],
      overdraw: true,
    })
  }),
)

for (const edgeCase of [
  {
    backgroundTone: 'normal',
    camera: [-20, 20.2, -10],
    label: 'cloud-edge-light-background',
  },
  {
    backgroundTone: 'dark',
    camera: [-20, 20.2, -10],
    label: 'cloud-edge-dark-background',
  },
  {
    backgroundTone: 'dark',
    camera: [0, 20.2, -22],
    label: 'cloud-edge-grazing-angle',
  },
]) {
  layerCaptures.push(
    await capture('layer-isolation', edgeCase.label, async () => {
      await resetDiagnosticMode(page)
      await callApi(page, 'setVariant', 'C')
      await callApi(
        page,
        'setDiagnosticCamera',
        edgeCase.camera,
        [-20, 20, -22],
        44,
      )
      await callApi(page, 'setDiagnosticMode', {
        backgroundTone: edgeCase.backgroundTone,
        isolateLayers: ['background-atmosphere', 'near-air'],
      })
    }),
  )
}
await resetDiagnosticMode(page)

const contactDirectory = resolve(evidenceRoot, 'views')
await makeContactSheet({
  build,
  captures: layoutCaptures,
  columns: 4,
  label: 'contact-layouts',
  outputDirectory: resolve(evidenceRoot, 'layouts'),
  rows: 2,
})
await makeContactSheet({
  build,
  captures: variantCaptures,
  columns: 3,
  label: 'contact-variants-a-b-c',
  outputDirectory: contactDirectory,
  rows: 2,
})
await makeContactSheet({
  build,
  captures: [...rangeCaptures, ...avatarCaptures],
  columns: 4,
  label: 'contact-legal-views-and-avatars',
  outputDirectory: contactDirectory,
  rows: 2,
})
await makeContactSheet({
  build,
  captures: flightApproximationCaptures,
  columns: 2,
  label: 'contact-prototype-flight-approximation',
  outputDirectory: contactDirectory,
  rows: 1,
})
await makeContactSheet({
  build,
  captures: transitionCaptures,
  columns: 5,
  label: 'contact-transition-keyframes',
  outputDirectory: resolve(evidenceRoot, 'transitions'),
  rows: 1,
})
await makeContactSheet({
  build,
  captures: orbitCaptures,
  columns: 4,
  label: 'contact-orbits-all-heights',
  outputDirectory: contactDirectory,
  rows: 9,
})
for (const height of orbitHeights) {
  await makeContactSheet({
    build,
    captures: orbitCaptures.filter((capture) =>
      capture.label.includes(`-${height}-`),
    ),
    columns: 4,
    label: `contact-orbits-${height}`,
    outputDirectory: contactDirectory,
    rows: 3,
  })
}
await makeContactSheet({
  build,
  captures: layerCaptures,
  columns: 4,
  label: 'contact-layer-and-alpha-diagnostics',
  outputDirectory: resolve(evidenceRoot, 'layer-isolation'),
  rows: 3,
})

async function measureVariant(variant) {
  const performancePage = await context.newPage()
  attachIssueRecorder(
    performancePage,
    `performance-${variant}`,
    allBrowserIssues,
  )
  const variantResponse = await performancePage.goto(
    `${previewUrl}?variant=${variant}&view=overview&range=default&chrome=0`,
    { waitUntil: 'networkidle' },
  )
  if (!variantResponse?.ok()) {
    throw new Error(`sky-performance-http:${variantResponse?.status()}`)
  }
  await waitForReviewApi(performancePage)
  const before = await performancePage.evaluate(() =>
    window.__SKY_REVIEW__.diagnostics(),
  )
  if (before.build.buildId !== build.buildId) {
    throw new Error(`mixed-performance-build:${before.build.buildId}`)
  }
  const rendererName =
    before.environment.rendererCapabilities.renderer
  if (
    softwareRendererPattern.test(rendererName) ||
    !hardwareRendererPattern.test(rendererName)
  ) {
    throw new Error(`HARDWARE_WEBGL_REQUIRED:${rendererName}`)
  }
  const sample = await performancePage.evaluate(() =>
    window.__SKY_REVIEW__.samplePerformance(240),
  )
  const after = await performancePage.evaluate(() =>
    window.__SKY_REVIEW__.diagnostics(),
  )
  const network = await performancePage.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .reduce(
        (totals, resource) => ({
          decodedBodyBytes:
            totals.decodedBodyBytes + (resource.decodedBodySize ?? 0),
          transferBytes: totals.transferBytes + (resource.transferSize ?? 0),
        }),
        { decodedBodyBytes: 0, transferBytes: 0 },
      ),
  )
  const result = {
    browserErrors: [
      ...allBrowserIssues.filter(
        (issue) => issue.page === `performance-${variant}`,
      ),
      ...after.browser.issues,
    ],
    buildId: build.buildId,
    deviceQualification: 'desktop-hardware-measurement',
    diagnostics: after,
    hardwareRenderer: true,
    network,
    renderer: {
      renderer: rendererName,
      vendor: after.environment.rendererCapabilities.vendor,
    },
    sample,
    variant,
    viewport: performancePage.viewportSize(),
    warmupFrames: 20,
  }
  await performancePage.close()
  return result
}

const performanceMeasurements = []
for (const variant of ['A', 'B', 'C']) {
  performanceMeasurements.push(await measureVariant(variant))
}
const baseline = performanceMeasurements.find(({ variant }) => variant === 'A')
const candidate = performanceMeasurements.find(({ variant }) => variant === 'C')
const performanceComparison = {
  baselineVariant: 'A',
  candidateVariant: 'C',
  frameTimeDeltaMs: Number(
    (
      candidate.sample.averageFrameTimeMs - baseline.sample.averageFrameTimeMs
    ).toFixed(4),
  ),
  geometryByteDelta:
    candidate.diagnostics.resources.geometryBytes -
    baseline.diagnostics.resources.geometryBytes,
  readyTimeDeltaMs: Number(
    (
      candidate.diagnostics.performance.readyTimeMs -
      baseline.diagnostics.performance.readyTimeMs
    ).toFixed(4),
  ),
  renderer: build.renderer,
  rendererQualification: 'verified-hardware',
  transparentDrawDelta:
    candidate.diagnostics.environment.resources.transparentDrawEstimate -
    baseline.diagnostics.environment.resources.transparentDrawEstimate,
  triangleDelta:
    candidate.sample.rendererInfo.render.triangles -
    baseline.sample.rendererInfo.render.triangles,
}
await writeFile(
  resolve(evidenceRoot, 'performance/performance-a-b-c.json'),
  json({
    buildId: build.buildId,
    comparison: performanceComparison,
    measurements: performanceMeasurements,
  }),
)

const ownedRoots = [
  'assets/candidates/scale-encounter-environments/sky',
  'prototypes/scale-encounter-sky',
  'scripts/scale-encounter-sky',
  'src/scale-encounter/environments/sky',
]
const ownedFiles = []
for (const ownedRoot of ownedRoots) {
  for (const absolutePath of await collectFiles(resolve(worktreeRoot, ownedRoot))) {
    const bytes = await readFile(absolutePath)
    ownedFiles.push({
      bytes: bytes.byteLength,
      path: relative(worktreeRoot, absolutePath),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
}
for (const testPath of [
  'tests/scale-encounter-sky-camera.test.ts',
  'tests/scale-encounter-sky-contract.test.ts',
  'tests/scale-encounter-sky-diagnostics.test.ts',
  'tests/scale-encounter-sky-flight-approximation.test.ts',
]) {
  const absolutePath = resolve(worktreeRoot, testPath)
  const bytes = await readFile(absolutePath)
  ownedFiles.push({
    bytes: bytes.byteLength,
    path: testPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
ownedFiles.sort((left, right) => left.path.localeCompare(right.path))

const assetIdentity = {
  avatarManifest: {
    path: relative(
      worktreeRoot,
      resolve(
        directScaleWorktree,
        'assets/candidates/scale-encounter-child-avatar/meshy-child-bases.manifest.json',
      ),
    ),
    sha256: await sha256File(
      resolve(
        directScaleWorktree,
        'assets/candidates/scale-encounter-child-avatar/meshy-child-bases.manifest.json',
      ),
    ),
  },
  boyBase: {
    bytes: (
      await stat(
        resolve(
          directScaleWorktree,
          'assets/candidates/scale-encounter-child-avatar/child-avatar-v3-boy-land-normal.glb',
        ),
      )
    ).size,
    sha256: await sha256File(
      resolve(
        directScaleWorktree,
        'assets/candidates/scale-encounter-child-avatar/child-avatar-v3-boy-land-normal.glb',
      ),
    ),
  },
  candidateManifest: {
    path: 'assets/candidates/scale-encounter-environments/sky/sky-review-candidate.manifest.json',
    sha256: build.assetManifestHash,
  },
  girlBase: {
    bytes: (
      await stat(
        resolve(
          directScaleWorktree,
          'assets/candidates/scale-encounter-child-avatar/child-avatar-v3-girl-land-normal.glb',
        ),
      )
    ).size,
    sha256: await sha256File(
      resolve(
        directScaleWorktree,
        'assets/candidates/scale-encounter-child-avatar/child-avatar-v3-girl-land-normal.glb',
      ),
    ),
  },
  legacyABackgroundComparison: {
    bytes: (
      await stat(
        resolve(
          directScaleWorktree,
          'assets/candidates/scale-encounter-environments/panorama-air-cretaceous-2048.webp',
        ),
      )
    ).size,
    role: 'legacy comparison only; not used by this candidate',
    sha256: await sha256File(
      resolve(
        directScaleWorktree,
        'assets/candidates/scale-encounter-environments/panorama-air-cretaceous-2048.webp',
      ),
    ),
  },
  pteranodon: {
    bytes: (
      await stat(
        resolve(worktreeRoot, 'src/content/animals/pteranodon/model/model.glb'),
      )
    ).size,
    sha256: await sha256File(
      resolve(worktreeRoot, 'src/content/animals/pteranodon/model/model.glb'),
    ),
  },
}
await writeFile(
  resolve(evidenceRoot, 'assets/asset-identity.json'),
  json(assetIdentity),
)

const worktreeStatus = runGit(worktreeRoot, [
  'status',
  '--porcelain=v1',
  '--untracked-files=all',
])
const gitVisiblePaths = worktreeStatus
  ? worktreeStatus.split('\n').map((line) => line.slice(3))
  : []
const allowedPathPatterns = [
  /^\.handoff\/scale-encounter-sky-[^/]+\//,
  /^assets\/candidates\/scale-encounter-environments\/sky\//,
  /^e2e\/scale-encounter-sky-[^/]+\.spec\.ts$/,
  /^prototypes\/scale-encounter-sky\//,
  /^scripts\/scale-encounter-sky\//,
  /^src\/scale-encounter\/environments\/sky\//,
  /^tests\/scale-encounter-sky-[^/]+\.test\.ts$/,
]
const unexpectedGitVisiblePaths = gitVisiblePaths.filter(
  (path) => !allowedPathPatterns.some((pattern) => pattern.test(path)),
)
const buildManifest = {
  assetIdentity,
  browser: {
    name: 'Chromium',
    userAgent: initialDiagnostics.browser.userAgent,
    version: browser.version(),
  },
  build,
  capturedAt: new Date().toISOString(),
  directScaleWorktreeReadOnlyStatus: runGit(directScaleWorktree, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]),
  host: {
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    operatingSystem: os.type(),
    platform: os.platform(),
    release: os.release(),
    version: os.version(),
  },
  ownedFiles,
  ownership: {
    allowedPathPatterns: allowedPathPatterns.map((pattern) => pattern.source),
    gitVisiblePaths,
    passed: unexpectedGitVisiblePaths.length === 0,
    unexpectedGitVisiblePaths,
  },
  rendererQualification: {
    absolutePerformanceAllowed: hardwareRenderer,
    renderer: build.renderer,
    softwareRenderer: softwareRendererPattern.test(build.renderer),
    verifiedHardware: hardwareRenderer,
    vendor: build.vendor,
  },
  screenshotCount: captures.length,
  worktree: {
    branch: runGit(worktreeRoot, ['branch', '--show-current']),
    canonicalPath: worktreeRoot,
    revision: runGit(worktreeRoot, ['rev-parse', 'HEAD']),
    status: worktreeStatus,
    worktreeList: runGit(worktreeRoot, ['worktree', 'list', '--porcelain']),
  },
}
await writeFile(
  resolve(evidenceRoot, 'build-manifest.json'),
  json(buildManifest),
)
await writeFile(
  resolve(evidenceRoot, 'browser-health.json'),
  json({
    buildId: build.buildId,
    contextLossCount: initialDiagnostics.browser.contextLossCount,
    issues: allBrowserIssues,
    passed:
      allBrowserIssues.length === 0 &&
      initialDiagnostics.browser.contextLossCount === 0,
  }),
)

const everyPng = []
for (const category of [
  'layer-isolation',
  'layouts',
  'transitions',
  'views',
]) {
  for (const filename of await readdir(resolve(evidenceRoot, category))) {
    if (filename.endsWith('.png')) {
      everyPng.push(resolve(evidenceRoot, category, filename))
    }
  }
}
const missingJsonCompanions = []
for (const pngPath of everyPng) {
  try {
    await stat(pngPath.replace(/\.png$/, '.json'))
  } catch {
    missingJsonCompanions.push(relative(evidenceRoot, pngPath))
  }
}
const evidenceIndex = {
  browserIssueCount: allBrowserIssues.length,
  buildId: build.buildId,
  categories: {
    flightApproximation: flightApproximationCaptures.length,
    layerIsolation: layerCaptures.length,
    layouts: layoutCaptures.length,
    orbitMatrix: orbitCaptures.length,
    transitions: transitionCaptures.length,
    variants: variantCaptures.length,
    viewsAndAvatars: rangeCaptures.length + avatarCaptures.length,
  },
  generatedAt: new Date().toISOString(),
  missingJsonCompanions,
  originalScreenshotCount: captures.length,
  performanceComparison,
  pngCountIncludingContactSheets: everyPng.length,
  renderer: build.renderer,
  rendererQualification: 'verified-hardware',
  revision: build.revision,
}
await writeFile(resolve(evidenceRoot, 'evidence-index.json'), json(evidenceIndex))

await context.close()
await browser.close()
process.stdout.write(
  json({
    browserIssueCount: allBrowserIssues.length,
    buildId: build.buildId,
    evidenceRoot,
    missingJsonCompanions,
    originalScreenshotCount: captures.length,
    performanceComparison,
    pngCountIncludingContactSheets: everyPng.length,
    renderer: build.renderer,
  }),
)
