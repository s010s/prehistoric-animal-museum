import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import { requireHardwareWebGl } from './support/webgl-hardware'

const enabled = process.env.SCALE_ENCOUNTER_RUN_DENSITY_EXPERIMENT === '1'
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.env.SCALE_ENCOUNTER_DENSITY_OUTPUT ??
    '.handoff/scale-encounter-ecology-density-experiment-2026-08-14',
)

const densities = ['current', '1.25x', '1.5x'] as const
type Density = (typeof densities)[number]
const requestedDensities = (
  process.env.SCALE_ENCOUNTER_DENSITY_FILTER?.split(',') ?? densities
).filter((density): density is Density =>
  densities.includes(density as Density),
)
const resume = process.env.SCALE_ENCOUNTER_DENSITY_RESUME === '1'
const replaceRequested =
  process.env.SCALE_ENCOUNTER_DENSITY_REPLACE_REQUESTED === '1'
const visualOnly =
  process.env.SCALE_ENCOUNTER_DENSITY_VISUAL_ONLY === '1'
const skipOrbit =
  process.env.SCALE_ENCOUNTER_DENSITY_SKIP_ORBIT === '1'

const viewports = [
  {
    deviceScaleFactor: 1,
    hasTouch: false,
    height: 900,
    isMobile: false,
    label: 'desktop',
    width: 1440,
  },
  {
    deviceScaleFactor: 2,
    hasTouch: true,
    height: 844,
    isMobile: true,
    label: 'mobile',
    width: 390,
  },
  {
    deviceScaleFactor: 1,
    hasTouch: true,
    height: 768,
    isMobile: false,
    label: 'tablet',
    width: 1024,
  },
  {
    deviceScaleFactor: 1,
    hasTouch: true,
    height: 390,
    isMobile: true,
    label: 'compact-landscape',
    width: 844,
  },
] as const

const headings = Array.from({ length: 12 }, (_, index) => index * 30)

interface FrameMetrics {
  readonly droppedFrameRatio: number
  readonly framesPerSecond: number
  readonly meanFrameTimeMs: number
  readonly p50FrameTimeMs: number
  readonly p95FrameTimeMs: number
  readonly sampleCount: number
}

interface LayoutMeasurement {
  readonly browserErrors: readonly string[]
  readonly density: Density
  readonly encounterReadyMs: number
  readonly firstPageLoadMs: number
  readonly frameMetrics: FrameMetrics | null
  readonly hardware: {
    readonly renderer: string
    readonly userAgent: string
    readonly vendor: string
  }
  readonly performance: Record<string, unknown>
  readonly resourceDecodedBytes: number
  readonly resourceTransferBytes: number
  readonly viewport: string
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

async function sampleFrames(page: Page): Promise<FrameMetrics> {
  const samples = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = []
        let previous = performance.now()
        const step = (now: number) => {
          deltas.push(now - previous)
          previous = now
          if (deltas.length >= 181) resolve(deltas.slice(21))
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
  )
  const sorted = [...samples].sort((left, right) => left - right)
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  return {
    droppedFrameRatio:
      samples.filter((value) => value > 25).length / samples.length,
    framesPerSecond: 1_000 / mean,
    meanFrameTimeMs: mean,
    p50FrameTimeMs: percentile(sorted, 0.5),
    p95FrameTimeMs: percentile(sorted, 0.95),
    sampleCount: samples.length,
  }
}

async function openDensityEncounter(
  page: Page,
  density: Density,
): Promise<{
  readonly canvas: Locator
  readonly dialog: Locator
  readonly encounterReadyMs: number
  readonly firstPageLoadMs: number
}> {
  const startedAt = performance.now()
  const response = await page.goto(
    `./zh-CN/?animal=tyrannosaurus-rex&variant=production-slice&ecology-density=${encodeURIComponent(density)}`,
  )
  expect(response?.ok()).toBe(true)
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    'tyrannosaurus-rex',
    { timeout: 45_000 },
  )
  const firstPageLoadMs = await page.evaluate(() => {
    const navigation = performance.getEntries()[0] as
      | (PerformanceEntry & { readonly loadEventEnd?: number })
      | undefined
    return navigation?.loadEventEnd ?? performance.now()
  })
  await page.getByRole('button', { name: '打开和霸王龙比一比' }).click()
  const dialog = page.getByTestId('scale-encounter')
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'overview', {
    timeout: 45_000,
  })
  await expect(dialog).toHaveAttribute('data-ecology-density', density)
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-ecology-density',
    density,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-forest-props',
    'ecology-v2',
    { timeout: 45_000 },
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-performance-ready',
    'true',
    { timeout: 45_000 },
  )
  await expect
    .poll(
      async () => {
        const serialized = await canvas.getAttribute(
          'data-scale-encounter-performance',
        )
        if (!serialized) return 0
        const diagnostics = JSON.parse(serialized) as {
          readonly density?: string
          readonly ecology?: { readonly totalInstances?: number } | null
          readonly scene?: { readonly estimatedTextureBytes?: number }
        }
        if (diagnostics.density !== density) return 0
        if ((diagnostics.scene?.estimatedTextureBytes ?? 0) < 20_000_000) {
          return 0
        }
        return diagnostics.ecology?.totalInstances ?? 0
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(900)
  return {
    canvas,
    dialog,
    encounterReadyMs: performance.now() - startedAt,
    firstPageLoadMs,
  }
}

async function resourceBytes(page: Page): Promise<{
  readonly decoded: number
  readonly transfer: number
}> {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[]
    return resources.reduce(
      (totals, resource) => ({
        decoded: totals.decoded + resource.decodedBodySize,
        transfer: totals.transfer + resource.transferSize,
      }),
      { decoded: 0, transfer: 0 },
    )
  })
}

async function makeContactSheet(
  files: readonly string[],
  destination: string,
  columns: number,
): Promise<void> {
  const cellWidth = 360
  const cellHeight = 203
  const rows = Math.ceil(files.length / columns)
  const images = await Promise.all(
    files.map((file) =>
      sharp(file)
        .resize(cellWidth, cellHeight, { fit: 'cover' })
        .png()
        .toBuffer(),
    ),
  )
  await sharp({
    create: {
      background: '#1d241f',
      channels: 3,
      height: rows * cellHeight,
      width: columns * cellWidth,
    },
  })
    .composite(
      images.map((input, index) => ({
        input,
        left: (index % columns) * cellWidth,
        top: Math.floor(index / columns) * cellHeight,
      })),
    )
    .png()
    .toFile(destination)
}

async function captureLayout(
  browser: Browser,
  density: Density,
  viewport: (typeof viewports)[number],
): Promise<LayoutMeasurement> {
  const densityOutput = path.join(output, density)
  await mkdir(densityOutput, { recursive: true })
  const context = await browser.newContext({
    deviceScaleFactor: viewport.deviceScaleFactor,
    hasTouch: viewport.hasTouch,
    isMobile: viewport.isMobile,
    locale: 'zh-CN',
    viewport: { height: viewport.height, width: viewport.width },
  })
  const browserErrors: string[] = []
  try {
    const page = await context.newPage()
    const probedHardware = await requireHardwareWebGl(page)
    const hardware = {
      ...probedHardware,
      userAgent: await page.evaluate(() => navigator.userAgent),
    }
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    const opened = await openDensityEncounter(page, density)
    const frameMetrics = visualOnly ? null : await sampleFrames(page)
    const serialized = await opened.canvas.getAttribute(
      'data-scale-encounter-performance',
    )
    if (!serialized) throw new Error('missing-scale-encounter-performance')
    const runtimePerformance = JSON.parse(serialized) as Record<string, unknown>
    const bytes = await resourceBytes(page)
    await opened.canvas.evaluate((element: HTMLCanvasElement) => {
      element.dataset.reviewAnimationTime = '0.6'
    })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    await page.screenshot({
      animations: 'disabled',
      path: path.join(densityOutput, `${viewport.label}-overview.png`),
    })

    await opened.dialog
      .getByRole('button', { name: '开关讲解员姐姐的声音' })
      .click()
    await opened.canvas.evaluate((element: HTMLCanvasElement) => {
      element.dataset.scaleEncounterReviewTransitionProgress = '1'
    })
    await opened.dialog.getByRole('button', { name: '从我的眼睛看' }).click()
    await expect(opened.dialog).toHaveAttribute('data-phase', 'eyes', {
      timeout: 20_000,
    })
    await page.screenshot({
      animations: 'disabled',
      path: path.join(densityOutput, `${viewport.label}-pov.png`),
    })

    expect(browserErrors).toEqual([])
    return {
      browserErrors,
      density,
      encounterReadyMs: opened.encounterReadyMs,
      firstPageLoadMs: opened.firstPageLoadMs,
      frameMetrics,
      hardware,
      performance: runtimePerformance,
      resourceDecodedBytes: bytes.decoded,
      resourceTransferBytes: bytes.transfer,
      viewport: viewport.label,
    }
  } finally {
    await context.close()
  }
}

async function captureOrbit(
  browser: Browser,
  density: Density,
): Promise<{ readonly browserErrors: readonly string[]; readonly views: number }> {
  const orbitOutput = path.join(output, density, 'orbit')
  await mkdir(orbitOutput, { recursive: true })
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    viewport: { height: 540, width: 960 },
  })
  const browserErrors: string[] = []
  try {
    const page = await context.newPage()
    await requireHardwareWebGl(page)
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    const { canvas } = await openDensityEncounter(page, density)
    await canvas.evaluate((element: HTMLCanvasElement) => {
      element.dataset.reviewAnimationTime = '0.6'
    })
    for (const heightMode of ['overview', 'child-eye'] as const) {
      const files: string[] = []
      for (const heading of headings) {
        await canvas.evaluate(
          (
            element: HTMLCanvasElement,
            request: { readonly heading: number; readonly heightMode: string },
          ) => {
            element.dataset.scaleEncounterReviewOrbitAzimuthDegrees = String(
              request.heading,
            )
            element.dataset.scaleEncounterReviewOrbitHeight = request.heightMode
          },
          { heading, heightMode },
        )
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-review-orbit',
          `${heightMode}:${heading}`,
          { timeout: 20_000 },
        )
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            }),
        )
        const file = path.join(
          orbitOutput,
          `${heightMode}-${String(heading).padStart(3, '0')}.png`,
        )
        await canvas.screenshot({ animations: 'disabled', path: file })
        files.push(file)
      }
      await makeContactSheet(
        files,
        path.join(orbitOutput, `${heightMode}-contact-sheet.png`),
        4,
      )
    }
    expect(browserErrors).toEqual([])
    return { browserErrors, views: headings.length * 2 }
  } finally {
    await context.close()
  }
}

test.describe.configure({ mode: 'serial' })

test('captures resumable ecology density evidence with a hardware WebGL gate', async ({
  browser,
}) => {
  test.skip(!enabled, 'Run explicitly for the density performance experiment.')
  test.setTimeout(1_800_000)
  await mkdir(output, { recursive: true })
  let layouts: LayoutMeasurement[] = []
  let orbits: Record<
    Density,
    { readonly browserErrors: readonly string[]; readonly views: number }
  > = {
    current: { browserErrors: [], views: 0 },
    '1.25x': { browserErrors: [], views: 0 },
    '1.5x': { browserErrors: [], views: 0 },
  }

  if (resume) {
    try {
      const previous = JSON.parse(
        await readFile(
          path.join(output, 'experiment-report.partial.json'),
          'utf8',
        ),
      ) as {
        readonly layouts?: LayoutMeasurement[]
        readonly orbits?: typeof orbits
      }
      layouts = previous.layouts ?? layouts
      orbits = previous.orbits ?? orbits
      if (replaceRequested) {
        layouts = layouts.filter(
          ({ density }) => !requestedDensities.includes(density),
        )
        requestedDensities.forEach((density) => {
          orbits[density] = { browserErrors: [], views: 0 }
        })
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error
      }
    }
  }

  for (const density of requestedDensities) {
    for (const viewport of viewports) {
      const existing = layouts.some(
        (measurement) =>
          measurement.density === density &&
          measurement.viewport === viewport.label,
      )
      if (!existing) {
        layouts.push(await captureLayout(browser, density, viewport))
      }
      await writeFile(
        path.join(output, 'experiment-report.partial.json'),
        `${JSON.stringify({ layouts, orbits }, null, 2)}\n`,
      )
    }
    if (!skipOrbit && orbits[density].views !== headings.length * 2) {
      orbits[density] = await captureOrbit(browser, density)
      await writeFile(
        path.join(output, 'experiment-report.partial.json'),
        `${JSON.stringify({ layouts, orbits }, null, 2)}\n`,
      )
    }
    const layoutFiles = viewports.flatMap((viewport) => [
      path.join(output, density, `${viewport.label}-overview.png`),
      path.join(output, density, `${viewport.label}-pov.png`),
    ])
    await makeContactSheet(
      layoutFiles,
      path.join(output, density, 'layouts-contact-sheet.png'),
      4,
    )
  }

  const previewBase =
    'http://127.0.0.1:4187/prehistoric-animal-museum/zh-CN/animals/tyrannosaurus-rex/?variant=production-slice'
  await writeFile(
    path.join(output, 'experiment-report.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        layouts,
        orbits,
        previewLinks: Object.fromEntries(
          densities.map((density) => [
            density,
            `${previewBase}&ecology-density=${encodeURIComponent(density)}`,
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  )

  expect(layouts).toHaveLength(densities.length * viewports.length)
  if (!skipOrbit) {
    expect(
      requestedDensities.every(
        (density) => orbits[density].views === headings.length * 2,
      ),
    ).toBe(true)
  }
})
