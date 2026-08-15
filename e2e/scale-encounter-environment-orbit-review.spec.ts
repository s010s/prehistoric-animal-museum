import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

const enabled = process.env.SCALE_ENCOUNTER_RUN_ORBIT_REVIEW === '1'
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.env.SCALE_ENCOUNTER_ORBIT_OUTPUT ??
    '.handoff/scale-encounter-environment-orbit-final-candidate-2026-08-14',
)
const headings = Array.from({ length: 12 }, (_, index) => index * 30)

test('production environment holds together across a 24-view orbit ring', async ({
  page,
}) => {
  test.skip(!enabled, 'Run explicitly for the 360-degree environment-art gate.')
  test.setTimeout(360_000)
  await mkdir(output, { recursive: true })
  await page.setViewportSize({ height: 540, width: 960 })
  const hardware = await requireHardwareWebGl(page)
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
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
  for (const heightMode of ['overview', 'child-eye'] as const) {
    for (const heading of headings) {
      await page.evaluate(
        ({ heading: requestedHeading, heightMode: requestedHeight }) => {
          const target = document.querySelector<HTMLCanvasElement>(
            '.viewer-canvas',
          )
          if (!target) throw new Error('missing-review-canvas')
          target.dataset.scaleEncounterReviewOrbitAzimuthDegrees = String(
            requestedHeading,
          )
          target.dataset.scaleEncounterReviewOrbitHeight = requestedHeight
        },
        { heading, heightMode },
      )
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-review-orbit',
        `${heightMode}:${heading}`,
        { timeout: 15_000 },
      )
      // The dataset confirmation can occur in the same frame that first
      // applies the new camera. Wait through a second render before reading
      // the canvas; otherwise screenshot() can capture the preceding heading.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
      await canvas.screenshot({
        animations: 'disabled',
        path: path.join(
          output,
          `${heightMode}-${String(heading).padStart(3, '0')}.png`,
        ),
      })
    }
  }

  await writeFile(
    path.join(output, 'diagnostics.json'),
    `${JSON.stringify(
      {
        consoleErrors,
        hardware,
        headings,
        heights: ['overview', 'child-eye'],
        panoramaWidth: 4096,
        representation: 'world-space-terrain-midground-far-field',
      },
      null,
      2,
    )}\n`,
  )
  expect(consoleErrors).toEqual([])
})
