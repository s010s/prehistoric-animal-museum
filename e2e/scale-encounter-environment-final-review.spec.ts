import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

const enabled = process.env.SCALE_ENCOUNTER_RUN_FINAL_REVIEW === '1'
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.env.SCALE_ENCOUNTER_FINAL_REVIEW_OUTPUT ??
    '.handoff/scale-encounter-environment-final-review-2026-08-14',
)

const viewports = [
  {
    deviceScaleFactor: 1,
    fullGate: true,
    hasTouch: false,
    height: 900,
    isMobile: false,
    label: 'desktop',
    width: 1440,
  },
  {
    deviceScaleFactor: 2,
    fullGate: true,
    hasTouch: true,
    height: 844,
    isMobile: true,
    label: 'mobile',
    width: 390,
  },
  {
    deviceScaleFactor: 1,
    fullGate: false,
    hasTouch: true,
    height: 768,
    isMobile: false,
    label: 'tablet',
    width: 1024,
  },
  {
    deviceScaleFactor: 1,
    fullGate: false,
    hasTouch: false,
    height: 1024,
    isMobile: false,
    label: 'square-pc',
    width: 1024,
  },
  {
    deviceScaleFactor: 1,
    fullGate: false,
    hasTouch: false,
    height: 1365,
    isMobile: false,
    label: 'narrow-pc',
    width: 1024,
  },
  {
    deviceScaleFactor: 1,
    fullGate: false,
    hasTouch: true,
    height: 390,
    isMobile: true,
    label: 'compact-landscape',
    width: 844,
  },
] as const

const transitionMilestones = [0.12, 0.34, 0.55, 0.76, 0.92] as const

interface ReviewState {
  readonly browserErrors: readonly string[]
  readonly canvasDataset: Readonly<Record<string, string | undefined>>
  readonly devicePixelRatio: number
  readonly height: number
  readonly label: string
  readonly width: number
}

async function capture(
  page: Page,
  label: string,
  browserErrors: readonly string[],
): Promise<ReviewState> {
  const canvas = page.locator('.viewer-canvas')
  const state = await canvas.evaluate(
    (element: HTMLCanvasElement) => ({
      browserErrors: [] as string[],
      canvasDataset: { ...element.dataset },
      devicePixelRatio: window.devicePixelRatio,
      height: element.clientHeight,
      label: '',
      width: element.clientWidth,
    }),
  )
  const result: ReviewState = {
    ...state,
    browserErrors: [...browserErrors],
    label,
  }
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, `${label}.png`),
  })
  await writeFile(
    path.join(output, `${label}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  return result
}

async function openEncounter(page: Page): Promise<{
  readonly canvas: Locator
  readonly dialog: Locator
}> {
  const response = await page.goto(
    './zh-CN/?animal=tyrannosaurus-rex&variant=production-slice',
  )
  expect(response?.ok()).toBe(true)
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    'tyrannosaurus-rex',
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: '打开和霸王龙比一比' }).click()
  const dialog = page.getByTestId('scale-encounter')
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'overview', {
    timeout: 30_000,
  })
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-environment',
    'production-slice',
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '1.000',
  )
  return { canvas, dialog }
}

async function setTransitionProgress(
  page: Page,
  progress: number,
): Promise<void> {
  const formatted = progress.toFixed(3)
  const canvas = page.locator('.viewer-canvas')
  await canvas.evaluate(
    (element: HTMLCanvasElement, requestedProgress: number) => {
      element.dataset.scaleEncounterReviewTransitionProgress = String(
        requestedProgress,
      )
    },
    progress,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-transition-progress',
    formatted,
    { timeout: 15_000 },
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function clickRepeated(button: Locator, count: number): Promise<void> {
  await button.evaluate((element: HTMLButtonElement, requestedCount: number) => {
    for (let step = 0; step < requestedCount; step += 1) element.click()
  }, count)
}

for (const viewport of viewports) {
  test(`${viewport.label} final environment-art evidence`, async ({
    browser,
  }) => {
    test.skip(!enabled, 'Run explicitly for the final environment-art gate.')
    // Lossless evidence from a software-rendered 4K panorama is intentionally
    // expensive. Keep timeout headroom so the gate reflects scene quality,
    // not host screenshot-encoding speed.
    test.setTimeout(viewport.fullGate ? 900_000 : 420_000)
    await mkdir(output, { recursive: true })
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
      await requireHardwareWebGl(page)
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('pageerror', (error) => browserErrors.push(error.message))

      let { canvas, dialog } = await openEncounter(page)
      await capture(
        page,
        `${viewport.label}-overview-default`,
        browserErrors,
      )

      if (viewport.fullGate) {
        const closer = dialog.getByRole('button', { name: '靠近一点' })
        await clickRepeated(closer, 4)
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-overview-zoom',
          '0.820',
        )
        await capture(
          page,
          `${viewport.label}-overview-zoom-min`,
          browserErrors,
        )
        const farther = dialog.getByRole('button', { name: '退后一点' })
        await clickRepeated(farther, 6)
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-overview-zoom',
          '1.180',
        )
        await capture(
          page,
          `${viewport.label}-overview-zoom-max`,
          browserErrors,
        )

        // Begin the guided path from its authored default framing, rather
        // than carrying either overview zoom extreme into transition QA.
        const restarted = await openEncounter(page)
        canvas = restarted.canvas
        dialog = restarted.dialog
      }

      await dialog
        .getByRole('button', { name: '开关讲解员姐姐的声音' })
        .click()
      await canvas.evaluate((element: HTMLCanvasElement) => {
        element.dataset.scaleEncounterReviewTransitionProgress = '0.12'
      })
      await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
      await expect(dialog).toHaveAttribute('data-phase', 'moving')

      const milestones =
        viewport.label === 'desktop'
          ? transitionMilestones
          : viewport.label === 'mobile'
            ? ([0.12, 0.55, 0.92] as const)
            : ([0.55] as const)
      for (const progress of milestones) {
        await setTransitionProgress(page, progress)
        await capture(
          page,
          `${viewport.label}-transition-${String(Math.round(progress * 100)).padStart(2, '0')}`,
          browserErrors,
        )
      }

      await setTransitionProgress(page, 1)
      await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
        timeout: 15_000,
      })
      await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
      await capture(page, `${viewport.label}-pov-default`, browserErrors)

      if (viewport.fullGate) {
        const farther = dialog.getByRole('button', { name: '退后一点' })
        await clickRepeated(farther, 20)
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-distance-meters',
          '18.000',
        )
        await capture(page, `${viewport.label}-pov-max`, browserErrors)

        const closer = dialog.getByRole('button', { name: '靠近一点' })
        await clickRepeated(closer, 40)
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-distance-meters',
          '6.500',
        )
        await capture(page, `${viewport.label}-pov-min`, browserErrors)
      }

      expect(browserErrors).toEqual([])
    } finally {
      await context.close()
    }
  })
}
