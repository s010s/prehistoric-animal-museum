import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const variants = [
  'baseline',
  'ground-slice',
  'hybrid-slice',
  'production-slice',
] as const
const requestedVariant = process.env.SCALE_ENCOUNTER_PROTOTYPE_VARIANT
const activeVariants = variants.filter(
  (variant) => !requestedVariant || variant === requestedVariant,
)
const requestedViewport = process.env.SCALE_ENCOUNTER_PROTOTYPE_VIEWPORT
const requestedGender =
  process.env.SCALE_ENCOUNTER_PROTOTYPE_GENDER === 'girl'
    ? 'girl'
    : 'boy'
const viewports = [
  { deviceScaleFactor: 1, height: 900, label: 'desktop', width: 1440 },
  { deviceScaleFactor: 2, height: 844, label: 'mobile', width: 390 },
] as const

const output = process.env.SCALE_ENCOUNTER_PROTOTYPE_OUTPUT
  ? path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      process.env.SCALE_ENCOUNTER_PROTOTYPE_OUTPUT,
    )
  : null

async function capture(
  page: Page,
  name: string,
): Promise<void> {
  if (!output) return
  await mkdir(output, { recursive: true })
  const canvas = page.locator('.viewer-canvas')
  // Preserve what was actually on screen before screenshot encoding yields
  // to the still-running WebGL loop. Reading diagnostics after screenshot()
  // previously mislabeled a valid transition frame as the eventual POV.
  const diagnostics = await canvas.evaluate(
    (element: HTMLCanvasElement) => ({
      canvasHeight: element.height,
      canvasWidth: element.width,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      dataset: { ...element.dataset },
      devicePixelRatio: window.devicePixelRatio,
      url: window.location.href,
    }),
  )
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, `${name}.png`),
  })
  await writeFile(
    path.join(output, `${name}.json`),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  )
}

for (const viewport of viewports.filter(
  ({ label }) => !requestedViewport || label === requestedViewport,
)) {
  for (const variant of activeVariants) {
    test(`${viewport.label} ${variant} forest prototype`, async ({
      browser,
    }) => {
      // Software WebGL on the portrait DPR=2 evidence pass can spend more
      // than 90 seconds compiling the terrain shader and encoding three full
      // page screenshots. Keep this deterministic review gate independent of
      // host load; interaction waits below still retain their tight bounds.
      test.setTimeout(180_000)
      const context = await browser.newContext({
        deviceScaleFactor: viewport.deviceScaleFactor,
        hasTouch: viewport.label === 'mobile',
        isMobile: viewport.label === 'mobile',
        locale: 'zh-CN',
        viewport: { height: viewport.height, width: viewport.width },
      })
      try {
        const page = await context.newPage()
        const response = await page.goto(
          `./zh-CN/?animal=tyrannosaurus-rex&variant=${variant}`,
        )
        expect(response?.ok()).toBe(true)
        const museum = page.locator('#museum-experience')
        const canvas = page.locator('.viewer-canvas')
        await expect(museum).toHaveAttribute(
          'data-ready-animal-id',
          'tyrannosaurus-rex',
          { timeout: 30_000 },
        )
        await page
          .getByRole('button', { name: '打开和霸王龙比一比' })
          .click()
        const dialog = page.getByTestId('scale-encounter')
        await dialog
          .getByRole('radio', {
            name: requestedGender === 'girl' ? /女孩/ : /男孩/,
          })
          .check({ force: true })
        await dialog.getByRole('button', { name: '进入比一比' }).click()
        await expect(dialog).toHaveAttribute('data-phase', 'overview', {
          timeout: 30_000,
        })
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-environment',
          variant,
        )
        if (variant !== 'baseline') {
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-forest-props',
            variant === 'production-slice' ? 'ecology-v2' : 'real-v1',
          )
        }
        await capture(page, `${viewport.label}-${variant}-overview`)

        await dialog
          .getByRole('button', { name: '开关讲解员姐姐的声音' })
          .click()
        await canvas.evaluate((element: HTMLCanvasElement) => {
          element.dataset.reviewAnimationTime = '2.1'
          // Keyframes hold `child-rear` between 0.50 and 0.60. Lock the
          // controller at its exact midpoint before starting the transition,
          // so screenshot encoding cannot race the WebGL animation loop.
          element.dataset.scaleEncounterReviewTransitionProgress = '0.55'
        })
        await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
        // `child-rear` is the semantic midpoint of the guided camera path.
        // A fixed timeout is racy on a busy/mobile WebGL worker: an old run
        // reached the final POV before this capture and wrote identical rear /
        // POV evidence. Wait for the controller's stage instead, then prove the
        // frame is still transitional before taking the rear screenshot.
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-camera-stage',
          'child-rear',
          { timeout: 15_000 },
        )
        await expect(dialog).toHaveAttribute('data-phase', 'moving')
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-view',
          'overview',
        )
        await capture(page, `${viewport.label}-${variant}-rear`)
        await canvas.evaluate((element: HTMLCanvasElement) => {
          element.dataset.scaleEncounterReviewTransitionProgress = '1'
        })
        await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
          timeout: 15_000,
        })
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-camera-stage',
          'pov',
        )
        await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
        await capture(page, `${viewport.label}-${variant}-pov`)
      } finally {
        await context.close()
      }
    })
  }
}
