import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const baseUrl = process.env.OCEAN_PREVIEW_URL ?? 'http://127.0.0.1:4189/'
const evidenceDirectory = resolve(
  process.env.OCEAN_EVIDENCE_DIR ?? '.handoff/scale-encounter-ocean-unbound',
)
const channel = process.env.OCEAN_PLAYWRIGHT_CHANNEL ?? 'chromium'

const fullState = (overrides = {}) => ({
  debug: false,
  depth: 'locked',
  distance: 'default',
  gender: 'boy',
  transitionProgress: null,
  variant: 'C',
  view: 'overview',
  ...overrides,
})

const captureIndex = []
const allBrowserErrors = []
const benignRequestCancellations = []

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true })
}

function attachErrorCollection(page) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page:${error.message}`))
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown'
    const description = `request:${request.method()}:${request.url()}:${reason}`
    if (
      reason === 'net::ERR_ABORTED' &&
      /\/__museum-review-assets\/scale-encounter-child-avatar\/child-avatar-v3-(boy|girl)-land-normal\.glb$/.test(
        request.url(),
      )
    ) {
      benignRequestCancellations.push(description)
      return
    }
    errors.push(description)
  })
  return errors
}

async function waitForStableFrame(page) {
  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
      }),
  )
  await page.waitForTimeout(240)
}

async function openReviewPage(context, gender = 'boy') {
  const page = await context.newPage()
  const errors = attachErrorCollection(page)
  const query = new URLSearchParams({
    distance: 'default',
    gender,
    ui: '0',
    variant: 'C',
    view: 'overview',
  })
  const response = await page.goto(`${baseUrl}?${query}`)
  if (!response?.ok()) throw new Error(`preview-http:${response?.status()}`)
  await page.waitForFunction(() => window.__oceanReview?.ready === true, null, {
    timeout: 60_000,
  })
  await page.evaluate(() => document.fonts.ready)
  await waitForStableFrame(page)
  return { errors, page }
}

async function setState(page, state) {
  await page.evaluate(
    async (next) => window.__oceanReview?.setState(next),
    state,
  )
  await waitForStableFrame(page)
}

function isSoftwareRenderer(renderer) {
  return /swiftshader|llvmpipe|software raster|software renderer|basic render/i.test(
    renderer,
  )
}

async function capture(page, errors, directory, name, state, extra = {}) {
  await setState(page, fullState(state))
  const metadata = await page.evaluate(() => window.__oceanReview?.captureMetadata())
  const renderer = String(metadata?.renderer?.renderer ?? 'unavailable')
  if (renderer === 'unavailable' || isSoftwareRenderer(renderer)) {
    throw new Error(`hardware-renderer-required:${renderer}`)
  }
  const pngPath = resolve(evidenceDirectory, directory, `${name}.png`)
  const jsonPath = resolve(evidenceDirectory, directory, `${name}.json`)
  await ensureParent(pngPath)
  await page.screenshot({
    animations: 'disabled',
    path: pngPath,
  })
  const captureErrors = [...errors]
  errors.length = 0
  allBrowserErrors.push(...captureErrors.map((error) => `${directory}/${name}:${error}`))
  const payload = {
    captureErrors,
    evidence: {
      category: directory,
      label: name,
      screenshot: `${directory}/${name}.png`,
    },
    metadata,
    ...extra,
  }
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)
  captureIndex.push({
    errors: captureErrors.length,
    json: `${directory}/${name}.json`,
    label: name,
    png: `${directory}/${name}.png`,
    renderer,
    state: metadata.state,
    viewport: metadata.viewport,
  })
  return payload
}

async function createContactSheet(items, outputPath, columns = 3) {
  const cellWidth = 480
  const cellHeight = 320
  const rows = Math.ceil(items.length / columns)
  const composites = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const image = await sharp(resolve(evidenceDirectory, item.path))
      .resize(cellWidth, cellHeight, { fit: 'cover' })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${cellWidth}" height="46" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(3,20,32,.82)"/><text x="18" y="30" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#fff">${item.label}</text></svg>`,
          ),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer()
    composites.push({
      input: image,
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    })
  }
  const target = resolve(evidenceDirectory, outputPath)
  await ensureParent(target)
  await sharp({
    create: {
      background: '#031722',
      channels: 3,
      height: rows * cellHeight,
      width: columns * cellWidth,
    },
  })
    .composite(composites)
    .png()
    .toFile(target)
}

async function samplePerformance(page, label, state, samples = 180) {
  await setState(page, fullState(state))
  const before = await page.evaluate(() => window.__oceanReview?.captureMetadata())
  const renderer = String(before?.renderer?.renderer ?? 'unavailable')
  if (renderer === 'unavailable' || isSoftwareRenderer(renderer)) {
    throw new Error(`absolute-performance-forbidden:${renderer}`)
  }
  const frames = await page.evaluate(
    async (count) => window.__oceanReview?.sampleFrames(count),
    samples,
  )
  const after = await page.evaluate(() => window.__oceanReview?.captureMetadata())
  return {
    frames,
    label,
    metadata: after,
    method:
      'requestAnimationFrame cadence after 20 warm-up frames; this is a hardware-browser frame pacing comparison, not a GPU timer query',
    renderer,
  }
}

await mkdir(evidenceDirectory, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
try {
  const desktopContext = await browser.newContext({
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    viewport: { height: 900, width: 1440 },
  })
  const { errors: boyErrors, page: boyPage } = await openReviewPage(
    desktopContext,
    'boy',
  )

  for (const variant of ['A', 'B', 'C']) {
    await capture(
      boyPage,
      boyErrors,
      'layer-isolation',
      `${variant}-overview-default`,
      { variant, view: 'overview' },
    )
    await capture(
      boyPage,
      boyErrors,
      'layer-isolation',
      `${variant}-pov-default`,
      { variant, view: 'pov' },
    )
  }

  for (const view of ['overview', 'pov']) {
    for (const distance of ['min', 'default', 'max']) {
      await capture(boyPage, boyErrors, 'views', `C-${view}-${distance}`, {
        distance,
        variant: 'C',
        view,
      })
    }
  }

  for (const transition of [0, 0.09, 0.5, 0.95, 1]) {
    await capture(
      boyPage,
      boyErrors,
      'transitions',
      `C-transition-${String(Math.round(transition * 100)).padStart(3, '0')}`,
      { transitionProgress: transition, variant: 'C', view: 'overview' },
    )
  }

  for (const depth of ['up', 'level', 'down']) {
    await capture(boyPage, boyErrors, 'depth', `C-depth-${depth}`, {
      depth,
      variant: 'C',
      view: 'pov',
    })
  }
  await capture(boyPage, boyErrors, 'boundaries', 'C-debug-boundaries', {
    debug: true,
    variant: 'C',
    view: 'overview',
  })

  const desktopPerformance = {
    baselineA: await samplePerformance(boyPage, 'A-background-only', {
      variant: 'A',
      view: 'overview',
    }),
    candidateC: await samplePerformance(boyPage, 'C-layered-open-water', {
      variant: 'C',
      view: 'overview',
    }),
  }

  const layoutSizes = [
    [1440, 900, 'desktop-1440x900'],
    [1024, 768, 'landscape-1024x768'],
    [1024, 1024, 'square-1024x1024'],
    [1024, 1365, 'portrait-1024x1365'],
    [576, 1058, 'portrait-576x1058'],
    [390, 844, 'mobile-390x844'],
    [844, 390, 'mobile-landscape-844x390'],
  ]
  for (const [width, height, label] of layoutSizes) {
    await boyPage.setViewportSize({ height, width })
    await waitForStableFrame(boyPage)
    await capture(boyPage, boyErrors, 'layouts', `C-${label}`, {
      variant: 'C',
      view: 'overview',
    })
  }
  await boyPage.setViewportSize({ height: 900, width: 1440 })

  const { errors: girlErrors, page: girlPage } = await openReviewPage(
    desktopContext,
    'girl',
  )
  await capture(girlPage, girlErrors, 'avatar', 'C-overview-girl-base', {
    gender: 'girl',
    variant: 'C',
    view: 'overview',
  })
  await capture(boyPage, boyErrors, 'avatar', 'C-overview-boy-base', {
    gender: 'boy',
    variant: 'C',
    view: 'overview',
  })
  await girlPage.close()
  await boyPage.close()
  await desktopContext.close()

  const mobileContext = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    locale: 'zh-CN',
    viewport: { height: 844, width: 390 },
  })
  const { errors: mobileErrors, page: mobilePage } = await openReviewPage(
    mobileContext,
    'boy',
  )
  const mobilePerformance = {
    baselineA: await samplePerformance(mobilePage, 'A-mobile-layout-dpr2', {
      variant: 'A',
      view: 'overview',
    }),
    candidateC: await samplePerformance(mobilePage, 'C-mobile-layout-dpr2', {
      variant: 'C',
      view: 'overview',
    }),
  }
  await capture(
    mobilePage,
    mobileErrors,
    'layouts',
    'C-mobile-390x844-dpr2',
    { variant: 'C', view: 'overview' },
  )
  await mobilePage.close()
  await mobileContext.close()

  const performanceReport = {
    absoluteConclusionAllowed: true,
    baselineDefinition: 'A includes the frozen Mosasaurus, base Avatar and background-only ocean environment.',
    candidateDefinition: 'C keeps the same frozen subject/camera and enables the complete candidate environment.',
    desktop: desktopPerformance,
    mobileLayoutSimulation: mobilePerformance,
    note: 'The mobile run changes viewport and DPR on the same Apple Metal GPU; it is not a physical-phone measurement.',
    softwareRendererRejected: true,
  }
  const performancePath = resolve(
    evidenceDirectory,
    'performance/hardware-performance.json',
  )
  await ensureParent(performancePath)
  await writeFile(
    performancePath,
    `${JSON.stringify(performanceReport, null, 2)}\n`,
  )

  await createContactSheet(
    ['A', 'B', 'C'].map((variant) => ({
      label: `${variant} · overview default`,
      path: `layer-isolation/${variant}-overview-default.png`,
    })),
    'assets/contact-sheet-abc.png',
    3,
  )
  await createContactSheet(
    ['min', 'default', 'max'].flatMap((distance) =>
      ['overview', 'pov'].map((view) => ({
        label: `C · ${view} · ${distance}`,
        path: `views/C-${view}-${distance}.png`,
      })),
    ),
    'assets/contact-sheet-view-extremes.png',
    3,
  )
  await createContactSheet(
    [0, 9, 50, 95, 100].map((percentage) => ({
      label: `transition ${percentage}%`,
      path: `transitions/C-transition-${String(percentage).padStart(3, '0')}.png`,
    })),
    'assets/contact-sheet-transition.png',
    5,
  )

  const indexPayload = {
    benignRequestCancellations,
    benignRequestCancellationPolicy:
      'Only net::ERR_ABORTED on an allowlisted frozen base-Avatar GLB is separated after the ready gate; the corresponding source file is independently hash-verified, and all console, page and other request failures remain fatal.',
    browserErrors: allBrowserErrors,
    captureCount: captureIndex.length,
    captures: captureIndex,
    generatedAt: new Date().toISOString(),
    previewUrl: baseUrl,
  }
  await writeFile(
    resolve(evidenceDirectory, 'browser-audit-index.json'),
    `${JSON.stringify(indexPayload, null, 2)}\n`,
  )
  if (allBrowserErrors.length > 0) {
    throw new Error(`browser-errors:${allBrowserErrors.join('|')}`)
  }
  process.stdout.write(`${JSON.stringify(indexPayload, null, 2)}\n`)
} finally {
  await browser.close()
}
