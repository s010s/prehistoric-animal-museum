import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

const enabled =
  process.env.SCALE_ENCOUNTER_RUN_HARDWARE_PERFORMANCE === '1'
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.env.SCALE_ENCOUNTER_HARDWARE_PERFORMANCE_OUTPUT ??
    '.handoff/scale-encounter-ecology-density-experiment-2026-08-14/hardware-performance-report.json',
)

const densities = ['current', '1.25x'] as const
type Density = (typeof densities)[number]
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
    label: 'mobile-simulation',
    width: 390,
  },
  {
    deviceScaleFactor: 1,
    hasTouch: true,
    height: 768,
    isMobile: false,
    label: 'tablet-simulation',
    width: 1024,
  },
  {
    deviceScaleFactor: 1,
    hasTouch: true,
    height: 390,
    isMobile: true,
    label: 'compact-landscape-simulation',
    width: 844,
  },
] as const

interface FrameMetrics {
  readonly droppedFrameRatio: number
  readonly framesPerSecond: number
  readonly meanFrameTimeMs: number
  readonly p50FrameTimeMs: number
  readonly p95FrameTimeMs: number
  readonly sampleCount: number
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ] ?? 0
}

async function sampleThirtyFrames(page: Page): Promise<FrameMetrics> {
  const samples = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = []
        let previous = performance.now()
        const step = (now: number) => {
          deltas.push(now - previous)
          previous = now
          if (deltas.length >= 41) resolve(deltas.slice(11))
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

async function measure(
  browser: Browser,
  density: Density,
  viewport: (typeof viewports)[number],
) {
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
    // This happens before navigation, asset decode, or frame sampling. A
    // software fallback therefore aborts the case in milliseconds.
    const hardware = await requireHardwareWebGl(page)
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
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
    const canvas = page.locator('.viewer-canvas')
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-ecology-density',
      density,
    )
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-performance-ready',
      'true',
      { timeout: 45_000 },
    )
    const encounterReadyMs = performance.now() - startedAt
    const frameMetrics = await sampleThirtyFrames(page)
    const serialized = await canvas.getAttribute(
      'data-scale-encounter-performance',
    )
    if (!serialized) throw new Error('missing-scale-encounter-performance')
    const resources = await page.evaluate(() =>
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .reduce(
          (totals, resource) => ({
            decoded: totals.decoded + resource.decodedBodySize,
            transfer: totals.transfer + resource.transferSize,
          }),
          { decoded: 0, transfer: 0 },
        ),
    )
    expect(browserErrors).toEqual([])
    return {
      browserErrors,
      density,
      deviceQualification:
        viewport.label === 'desktop'
          ? 'desktop-hardware-measurement'
          : 'desktop-gpu-layout-simulation',
      encounterReadyMs,
      firstPageLoadMs,
      frameMetrics,
      hardware: {
        ...hardware,
        browserVersion: browser.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
      performance: JSON.parse(serialized) as Record<string, unknown>,
      resourceDecodedBytes: resources.decoded,
      resourceTransferBytes: resources.transfer,
      viewport: viewport.label,
    }
  } finally {
    await context.close()
  }
}

test.describe.configure({ mode: 'serial' })

test('compares current and 1.25x with 30 hardware-rendered frames per layout', async ({
  browser,
}) => {
  test.skip(!enabled, 'Run explicitly after the hardware WebGL probe passes.')
  const measurements: Awaited<ReturnType<typeof measure>>[] = []
  await mkdir(path.dirname(output), { recursive: true })
  for (const density of densities) {
    for (const viewport of viewports) {
      measurements.push(await measure(browser, density, viewport))
      await writeFile(
        output,
        `${JSON.stringify(
          { generatedAt: new Date().toISOString(), measurements },
          null,
          2,
        )}\n`,
      )
    }
  }
  expect(measurements).toHaveLength(8)
  expect(
    measurements.every(
      ({ frameMetrics }) => frameMetrics.sampleCount === 30,
    ),
  ).toBe(true)
})
