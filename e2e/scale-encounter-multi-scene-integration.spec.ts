import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test'
import {
  readWebGlHardware,
  requireHardwareWebGl,
  type WebGlHardwareInfo,
} from './support/webgl-hardware'

const enabled =
  process.env.SCALE_ENCOUNTER_RUN_MULTI_SCENE_INTEGRATION === '1'
const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.env.SCALE_ENCOUNTER_MULTI_SCENE_OUTPUT ??
    '.handoff/scale-encounter-multi-scene-integration-2026-08-16/evidence',
)

const scenes = [
  {
    animalId: 'mammoth',
    candidate: 'C',
    label: 'mammoth',
    maximumDistance: '15.000',
    minimumOverviewZoom: '0.580',
    minimumDistance: '5.500',
    name: '长毛猛犸象',
    semantic: 'mammoth-palaeoenvironment',
  },
  {
    animalId: 'mosasaurus',
    candidate: 'C',
    label: 'ocean',
    maximumDistance: '27.000',
    minimumOverviewZoom: '0.740',
    minimumDistance: '10.000',
    name: '沧龙',
    semantic: 'ocean',
  },
  {
    animalId: 'pteranodon',
    candidate: 'C',
    label: 'sky',
    maximumDistance: '21.000',
    minimumOverviewZoom: '0.740',
    minimumDistance: '8.000',
    name: '无齿翼龙',
    semantic: 'sky',
  },
  {
    animalId: 'tyrannosaurus-rex',
    candidate: 'off',
    label: 'forest-regression',
    maximumDistance: '18.000',
    minimumOverviewZoom: '0.740',
    minimumDistance: '6.500',
    name: '霸王龙',
    semantic: 'legacy-environment',
  },
] as const

const viewports = [
  {
    deviceScaleFactor: 1,
    fullDistanceGate: true,
    hasTouch: false,
    height: 900,
    isMobile: false,
    label: 'desktop-wide',
    width: 1440,
  },
  {
    deviceScaleFactor: 1,
    fullDistanceGate: false,
    hasTouch: false,
    height: 1024,
    isMobile: false,
    label: 'square',
    width: 1024,
  },
  {
    deviceScaleFactor: 2,
    fullDistanceGate: true,
    hasTouch: true,
    height: 844,
    isMobile: true,
    label: 'portrait',
    width: 390,
  },
  {
    deviceScaleFactor: 2,
    fullDistanceGate: false,
    hasTouch: true,
    height: 640,
    isMobile: true,
    label: 'narrow',
    width: 360,
  },
] as const

type Scene = (typeof scenes)[number]
type SceneCandidate = 'off' | 'A' | 'B' | 'C'
type Viewport = (typeof viewports)[number]

interface BrowserEvidence {
  readonly consoleErrors: string[]
  readonly pageErrors: string[]
  readonly requestFailures: {
    readonly errorText: string
    readonly isAvatarRoute: boolean
    readonly url: string
  }[]
  readonly responseErrors: {
    readonly status: number
    readonly url: string
  }[]
}

function selected(value: string | undefined, candidate: string): boolean {
  if (!value) return true
  return value.split(',').map((entry) => entry.trim()).includes(candidate)
}

function startBrowserEvidence(page: Page): BrowserEvidence {
  const evidence: BrowserEvidence = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
  }
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    evidence.requestFailures.push({
      errorText: request.failure()?.errorText ?? 'unknown',
      isAvatarRoute: request.url().includes('child-avatar-v4-'),
      url: request.url(),
    })
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      evidence.responseErrors.push({
        status: response.status(),
        url: response.url(),
      })
    }
  })
  return evidence
}

async function sampleFrames(page: Page, count = 45) {
  const deltas = await page.evaluate(
    ({ requestedCount }) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = []
        let previous = performance.now()
        const frame = (now: number) => {
          values.push(now - previous)
          previous = now
          if (values.length >= requestedCount + 10) {
            resolve(values.slice(10))
          } else {
            requestAnimationFrame(frame)
          }
        }
        requestAnimationFrame(frame)
      }),
    { requestedCount: count },
  )
  const sorted = [...deltas].sort((left, right) => left - right)
  const mean =
    deltas.reduce((total, duration) => total + duration, 0) / deltas.length
  const percentile = (fraction: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
    ] ?? 0
  return {
    droppedFrameRatio:
      deltas.filter((duration) => duration > 25).length / deltas.length,
    framesPerSecond: 1_000 / mean,
    meanFrameTimeMs: mean,
    p50FrameTimeMs: percentile(0.5),
    p95FrameTimeMs: percentile(0.95),
    sampleCount: deltas.length,
  }
}

async function runtimeState(
  page: Page,
  hardware: WebGlHardwareInfo,
  browserEvidence: BrowserEvidence,
) {
  const canvas = page.locator('.viewer-canvas')
  const dialog = page.getByTestId('scale-encounter')
  const state = await page.evaluate(
    ({ suppliedHardware }) => {
      const runtimeCanvas = document.querySelector<HTMLCanvasElement>(
        '.viewer-canvas',
      )
      const runtimeDialog = document.querySelector<HTMLElement>(
        '[data-testid="scale-encounter"]',
      )
      const context =
        runtimeCanvas?.getContext('webgl2') ??
        runtimeCanvas?.getContext('webgl') ??
        null
      const rendererExtension = context?.getExtension(
        'WEBGL_debug_renderer_info',
      )
      const resources = (
        performance.getEntriesByType(
          'resource',
        ) as PerformanceResourceTiming[]
      ).reduce(
        (totals, resource) => ({
          decodedBodyBytes:
            totals.decodedBodyBytes + resource.decodedBodySize,
          entryCount: totals.entryCount + 1,
          transferBytes: totals.transferBytes + resource.transferSize,
        }),
        { decodedBodyBytes: 0, entryCount: 0, transferBytes: 0 },
      )
      return {
        canvasClient: runtimeCanvas
          ? {
              height: runtimeCanvas.clientHeight,
              pixelHeight: runtimeCanvas.height,
              pixelWidth: runtimeCanvas.width,
              width: runtimeCanvas.clientWidth,
            }
          : null,
        canvasDataset: runtimeCanvas ? { ...runtimeCanvas.dataset } : null,
        contextLost: context?.isContextLost() ?? null,
        dialogDataset: runtimeDialog ? { ...runtimeDialog.dataset } : null,
        renderer: {
          suppliedHardware,
          unmaskedRenderer:
            context && rendererExtension
              ? String(
                  context.getParameter(
                    rendererExtension.UNMASKED_RENDERER_WEBGL,
                  ),
                )
              : 'unavailable',
          unmaskedVendor:
            context && rendererExtension
              ? String(
                  context.getParameter(
                    rendererExtension.UNMASKED_VENDOR_WEBGL,
                  ),
                )
              : 'unavailable',
        },
        resources,
        userAgent: navigator.userAgent,
        viewport: {
          devicePixelRatio: window.devicePixelRatio,
          height: window.innerHeight,
          width: window.innerWidth,
        },
      }
    },
    { suppliedHardware: hardware },
  )
  return {
    ...state,
    browserEvidence: {
      consoleErrors: [...browserEvidence.consoleErrors],
      pageErrors: [...browserEvidence.pageErrors],
      requestFailures: [...browserEvidence.requestFailures],
      responseErrors: [...browserEvidence.responseErrors],
    },
    locatorState: {
      canvasVisible: await canvas.isVisible(),
      dialogVisible: await dialog.isVisible(),
    },
  }
}

async function capture(
  page: Page,
  scene: Scene,
  viewport: Viewport,
  stage: string,
  hardware: WebGlHardwareInfo,
  browserEvidence: BrowserEvidence,
  frameMetrics?: Awaited<ReturnType<typeof sampleFrames>>,
): Promise<void> {
  const base = `${scene.label}-${viewport.label}-${stage}`
  const state = await runtimeState(page, hardware, browserEvidence)
  await page.screenshot({
    animations: 'disabled',
    fullPage: false,
    path: path.join(output, `${base}.jpg`),
    quality: 88,
    type: 'jpeg',
  })
  await writeFile(
    path.join(output, `${base}.json`),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        frameMetrics: frameMetrics ?? null,
        scene,
        stage,
        state,
        viewport,
      },
      null,
      2,
    )}\n`,
  )
}

async function clickRepeated(button: Locator, count: number): Promise<void> {
  await button.evaluate(
    (element: HTMLButtonElement, requestedCount: number) => {
      for (let index = 0; index < requestedCount; index += 1) element.click()
    },
    count,
  )
}

async function setTransitionProgress(
  canvas: Locator,
  progress: number,
): Promise<void> {
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
    progress.toFixed(3),
    { timeout: 15_000 },
  )
}

async function openEncounter(
  page: Page,
  scene: Scene,
  requestedCandidate: SceneCandidate = scene.candidate,
): Promise<{ readonly canvas: Locator; readonly dialog: Locator }> {
  const query = new URLSearchParams({
    animal: scene.animalId,
    'scene-variant': requestedCandidate,
  })
  if (scene.animalId === 'tyrannosaurus-rex') {
    query.set('variant', 'production-slice')
  }
  const response = await page.goto(`./zh-CN/?${query.toString()}`)
  expect(response?.ok()).toBe(true)
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    scene.animalId,
    { timeout: 45_000 },
  )
  await page
    .getByRole('button', {
      name: new RegExp(`打开和${scene.name}比一比`),
    })
    .click()
  const dialog = page.getByTestId('scale-encounter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'overview', {
    timeout: 45_000,
  })
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute('data-scale-encounter', 'true')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-scene-candidate',
    scene.candidate,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-scene-semantic',
    scene.semantic,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-production-approved',
    'false',
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-performance-ready',
    'true',
    { timeout: 45_000 },
  )
  if (scene.animalId === 'pteranodon') {
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-prototype-flight-approximation',
      'true',
    )
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-subject-layout',
      /side-by-side|stacked/,
    )
  }
  return { canvas, dialog }
}

test.describe.configure({ mode: 'serial' })

for (const viewport of viewports) {
  for (const scene of scenes) {
    test(`${scene.label} ${viewport.label} main-runtime evidence`, async ({
      browser,
    }) => {
      test.skip(!enabled, 'Run only for the multi-scene integration gate.')
      test.skip(
        !selected(
          process.env.SCALE_ENCOUNTER_INTEGRATION_SCENES,
          scene.label,
        ) ||
          !selected(
            process.env.SCALE_ENCOUNTER_INTEGRATION_VIEWPORTS,
            viewport.label,
          ),
        'Filtered integration evidence case.',
      )
      test.setTimeout(420_000)
      await mkdir(output, { recursive: true })
      const context = await browser.newContext({
        deviceScaleFactor: viewport.deviceScaleFactor,
        hasTouch: viewport.hasTouch,
        isMobile: viewport.isMobile,
        locale: 'zh-CN',
        viewport: { height: viewport.height, width: viewport.width },
      })
      try {
        const page = await context.newPage()
        const hardware = await requireHardwareWebGl(page)
        const browserEvidence = startBrowserEvidence(page)
        const { canvas, dialog } = await openEncounter(page, scene)
        const overviewFrameMetrics = await sampleFrames(page)
        await capture(
          page,
          scene,
          viewport,
          'overview-default',
          hardware,
          browserEvidence,
          overviewFrameMetrics,
        )

        const playbackSettings = dialog.getByRole('button', {
          name: '打开声音与文字设置',
          exact: true,
        })
        await expect(playbackSettings).toBeVisible()
        await playbackSettings.click()
        const narration = dialog
          .getByRole('group', { name: '声音与文字', exact: true })
          .getByRole('button', { name: '开关讲解旁白', exact: true })
        await expect(narration).toHaveAttribute('aria-pressed', 'true')
        await narration.click()
        await expect(narration).toHaveAttribute('aria-pressed', 'false')
        await expect(dialog).toHaveAttribute('data-narration', 'off')
        await playbackSettings.click()
        await expect(playbackSettings).toHaveAttribute('aria-expanded', 'false')
        await canvas.evaluate((element: HTMLCanvasElement) => {
          element.dataset.scaleEncounterReviewTransitionProgress = '0.3'
        })
        await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-camera-stage',
          'full-body-showcase',
          { timeout: 15_000 },
        )
        await capture(
          page,
          scene,
          viewport,
          'transition-full-body',
          hardware,
          browserEvidence,
        )

        if (viewport.fullDistanceGate) {
          await setTransitionProgress(canvas, 0.96)
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-camera-stage',
            'eye-entry',
          )
          await capture(
            page,
            scene,
            viewport,
            'transition-eye-entry',
            hardware,
            browserEvidence,
          )
        }
        await setTransitionProgress(canvas, 1)
        await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
          timeout: 15_000,
        })
        await capture(
          page,
          scene,
          viewport,
          'pov-default',
          hardware,
          browserEvidence,
        )

        if (viewport.fullDistanceGate) {
          const closer = dialog.getByRole('button', { name: '靠近一点' })
          const farther = dialog.getByRole('button', { name: '退后一点' })
          await clickRepeated(closer, 40)
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-distance-meters',
            scene.minimumDistance,
          )
          await capture(
            page,
            scene,
            viewport,
            'pov-minimum',
            hardware,
            browserEvidence,
          )
          await clickRepeated(farther, 80)
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-distance-meters',
            scene.maximumDistance,
          )
          await capture(
            page,
            scene,
            viewport,
            'pov-maximum',
            hardware,
            browserEvidence,
          )

          await page.keyboard.press('Escape')
          await expect(dialog).toHaveAttribute('data-phase', 'overview', {
            timeout: 20_000,
          })
          await clickRepeated(
            dialog.getByRole('button', { name: '靠近一点' }),
            40,
          )
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-overview-zoom',
            scene.minimumOverviewZoom,
          )
          await capture(
            page,
            scene,
            viewport,
            'overview-minimum',
            hardware,
            browserEvidence,
          )
          await clickRepeated(
            dialog.getByRole('button', { name: '退后一点' }),
            80,
          )
          await expect(canvas).toHaveAttribute(
            'data-scale-encounter-overview-zoom',
            '1.180',
          )
          await capture(
            page,
            scene,
            viewport,
            'overview-maximum',
            hardware,
            browserEvidence,
          )
        }

        expect(browserEvidence.consoleErrors).toEqual([])
        expect(browserEvidence.pageErrors).toEqual([])
        expect(browserEvidence.responseErrors).toEqual([])
        const unexpectedFailures = browserEvidence.requestFailures.filter(
          (failure) =>
            !(
              failure.errorText.includes('ERR_ABORTED') &&
              failure.isAvatarRoute
            ),
        )
        expect(unexpectedFailures).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}

test('four-scene same-runtime switch and disposal regression', async ({
  browser,
}) => {
  test.skip(!enabled, 'Run only for the multi-scene integration gate.')
  test.skip(
    process.env.SCALE_ENCOUNTER_INTEGRATION_SCENES !== undefined ||
      process.env.SCALE_ENCOUNTER_INTEGRATION_VIEWPORTS !== undefined,
    'The filtered visual pass does not run the joint switch gate.',
  )
  test.setTimeout(420_000)
  await mkdir(output, { recursive: true })
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { height: 900, width: 1440 },
  })
  try {
    const page = await context.newPage()
    const hardware = await requireHardwareWebGl(page)
    const browserEvidence = startBrowserEvidence(page)
    const switchOrder = [
      scenes[3],
      scenes[0],
      scenes[1],
      scenes[2],
      scenes[3],
    ] as const
    const switchEvidence: unknown[] = []

    for (const [index, scene] of switchOrder.entries()) {
      if (index === 0) {
        // Load the shared runtime with the explicit candidate selector from
        // the outset. T. rex intentionally resolves it to `off`, while later
        // supported animals inherit the still-active opt-in on this page.
        await openEncounter(page, scene, 'C')
      } else {
        await expect(page.locator('#museum-experience')).toHaveAttribute(
          'data-ready-animal-id',
          switchOrder[index - 1].animalId,
        )
        await page.locator(`[data-animal-id="${scene.animalId}"]`).click()
        await expect(page.locator('#museum-experience')).toHaveAttribute(
          'data-ready-animal-id',
          scene.animalId,
          { timeout: 45_000 },
        )
        await page
          .getByRole('button', {
            name: new RegExp(`打开和${scene.name}比一比`),
          })
          .click()
        const dialog = page.getByTestId('scale-encounter')
        if (await dialog.getByRole('radio').count()) {
          await dialog
            .getByRole('radio', { name: /男孩/ })
            .check({ force: true })
          await dialog.getByRole('button', { name: '进入比一比' }).click()
        }
        await expect(dialog).toHaveAttribute('data-phase', 'overview', {
          timeout: 45_000,
        })
      }

      const canvas = page.locator('.viewer-canvas')
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-scene-semantic',
        scene.semantic,
      )
      switchEvidence.push({
        active: await runtimeState(
          page,
          hardware,
          browserEvidence,
        ),
        scene: scene.label,
      })
      await page.goBack()
      await expect(page.getByTestId('scale-encounter')).toBeHidden()
      await expect(canvas).not.toHaveAttribute('data-scale-encounter')
      const disposal = await canvas.getAttribute(
        'data-scale-encounter-last-disposal',
      )
      expect(disposal).not.toBeNull()
      const parsedDisposal = JSON.parse(disposal ?? '{}') as {
        readonly avatarDetached?: boolean
        readonly environmentDetached?: boolean
      }
      expect(parsedDisposal.avatarDetached).toBe(true)
      expect(parsedDisposal.environmentDetached).toBe(true)
      switchEvidence.push({
        disposal: parsedDisposal,
        scene: scene.label,
      })
      expect(
        await canvas.evaluate((element: HTMLCanvasElement) => {
          const context =
            element.getContext('webgl2') ?? element.getContext('webgl')
          return context !== null && !context.isContextLost()
        }),
      ).toBe(true)
    }

    await writeFile(
      path.join(output, 'four-scene-switch-and-disposal.json'),
      `${JSON.stringify(
        {
          browserEvidence,
          capturedAt: new Date().toISOString(),
          finalHardware: await readWebGlHardware(page),
          switchEvidence,
          switchOrder: switchOrder.map((scene) => scene.label),
        },
        null,
        2,
      )}\n`,
    )
    expect(browserEvidence.consoleErrors).toEqual([])
    expect(browserEvidence.pageErrors).toEqual([])
    expect(browserEvidence.responseErrors).toEqual([])
  } finally {
    await context.close()
  }
})
