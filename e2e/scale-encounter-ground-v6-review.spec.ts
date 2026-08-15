import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.handoff/scale-encounter-ground-v7-2026-08-13',
)

const viewports = [
  { deviceScaleFactor: 1, height: 900, label: 'desktop', width: 1440 },
  { deviceScaleFactor: 2, height: 844, label: 'mobile', width: 390 },
] as const

async function capture(page: Page, name: string): Promise<void> {
  await mkdir(output, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, `${name}.png`),
  })
  const diagnostics = await page.locator('.viewer-canvas').evaluate(
    (canvas: HTMLCanvasElement) => ({
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      clientHeight: canvas.clientHeight,
      clientWidth: canvas.clientWidth,
      dataset: { ...canvas.dataset },
      devicePixelRatio: window.devicePixelRatio,
      url: window.location.href,
    }),
  )
  await writeFile(
    path.join(output, `${name}.json`),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  )
}

for (const viewport of viewports) {
  test.describe(`${viewport.label} v7 forest floor`, () => {
    test.use({
      deviceScaleFactor: viewport.deviceScaleFactor,
      hasTouch: viewport.label === 'mobile',
      isMobile: viewport.label === 'mobile',
      locale: 'zh-CN',
      viewport: { height: viewport.height, width: viewport.width },
    })

    test(`captures overview and POV`, async ({ page }) => {
      test.setTimeout(90_000)
      const browserErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('pageerror', (error) => browserErrors.push(error.message))
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
      await page.waitForTimeout(2_500)
      if ((await dialog.getAttribute('data-phase')) === 'error') {
        throw new Error(
          `Encounter failed: ${await dialog.innerText()}\n${browserErrors.join('\n')}`,
        )
      }
      await expect(dialog).toHaveAttribute('data-phase', 'overview', {
        timeout: 30_000,
      })
      await capture(page, `${viewport.label}-production-slice-overview`)

      await dialog
        .getByRole('button', { name: '开关讲解员姐姐的声音' })
        .click()
      await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
      const canvas = page.locator('.viewer-canvas')
      await canvas.evaluate((element: HTMLCanvasElement) => {
        element.dataset.reviewAnimationTime = '3.2'
      })
      await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
        timeout: 30_000,
      })
      await capture(page, `${viewport.label}-production-slice-pov`)
      expect(browserErrors).toEqual([])
    })
  })
}
