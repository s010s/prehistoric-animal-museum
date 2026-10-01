import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

const output = '.handoff/ocean-v12'
async function openOcean(page: Page, id = 'mosasaurus') {
  await page.goto(`/zh-CN/?animal=${id}`)
  await expect(page.locator('#museum-experience')).toHaveAttribute('data-ready-animal-id', id, { timeout: 60_000 })
  await page.getByRole('button', { name: /^打开和.+比一比/ }).click()
  const boy = page.getByRole('radio', { name: /男孩/ })
  await Promise.any([boy.waitFor({ state: 'visible', timeout: 15_000 }),
    expect(page.locator('.viewer-canvas')).toHaveAttribute('data-scale-encounter', 'true', { timeout: 15_000 })])
  if (await boy.isVisible()) {
    await boy.check({ force: true })
    await page.getByRole('button', { name: '进入比一比' }).click()
  }
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-scale-encounter', 'true', { timeout: 30_000 })
  await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-ocean-refracted', /tier/, { timeout: 15_000 })
}
async function enterEyes(page: Page) {
  await page.getByRole('button', { name: '打开声音与文字设置' }).click()
  const voice = page.getByRole('button', { name: '开关讲解旁白' })
  if (await voice.isEnabled()) await voice.click()
  await page.getByRole('button', { name: '打开声音与文字设置' }).click()
  await page.getByRole('button', { name: '从我的眼睛看', exact: true }).click()
  await expect(page.getByTestId('scale-encounter')).toHaveAttribute('data-phase', 'eyes', { timeout: 60_000 })
}
function watchErrors(page: Page) {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGLProgram|WebGL.*(error|INVALID)|shader.*fail/i.test(message.text())) failures.push(message.text())
  })
  return failures
}
async function capture(page: Page, name: string) {
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: `${output}/${name}.png` })
}
async function benchmark(page: Page, name: string) {
  const report = await page.evaluate(async () => {
    const samples: number[] = []
    await new Promise<void>(resolve => {
      let last = 0
      function frame(now: number) {
        if (last) samples.push(now - last)
        last = now
        if (samples.length === 360) resolve()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    samples.sort((a, b) => a - b)
    const canvas = document.querySelector<HTMLCanvasElement>('.viewer-canvas')!
    const gl = canvas.getContext('webgl2')!
    const ext = gl.getExtension('WEBGL_debug_renderer_info')!
    return {
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      samples: samples.length,
      frameP50Ms: samples[Math.floor(samples.length * .5)],
      frameP95Ms: samples[Math.floor(samples.length * .95)],
      frameP99Ms: samples[Math.floor(samples.length * .99)],
      diagnostics: JSON.parse(canvas.dataset.oceanRefracted!) as Record<string, unknown>,
      glError: gl.getError(),
    }
  })
  expect(report.renderer).toMatch(/Metal|Apple/)
  expect(report.glError).toBe(0)
  await writeFile(`${output}/${name}.json`, JSON.stringify(report, null, 2))
  return report
}

test('ocean depth, time, orbit, zoom, avatar and release on desktop Metal', async ({ page }) => {
  const errors = watchErrors(page)
  await requireHardwareWebGl(page)
  await openOcean(page)
  await capture(page, 'desktop-overview')
  await benchmark(page, 'desktop-overview-performance')
  const canvas = page.locator('.viewer-canvas')
  const zoomBefore = await canvas.getAttribute('data-scale-encounter-overview-zoom')
  await page.locator('.scale-encounter-distance-control button').last().click()
  await expect(canvas).not.toHaveAttribute('data-scale-encounter-overview-zoom', zoomBefore!)
  await enterEyes(page)
  await capture(page, 'desktop-eyes')
  await benchmark(page, 'desktop-eyes-performance')
  const angle = await canvas.getAttribute('data-scale-encounter-orbit-angle-degrees')
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(800)
  await page.keyboard.up('ArrowRight')
  await expect(canvas).not.toHaveAttribute('data-scale-encounter-orbit-angle-degrees', angle!)
  await page.getByRole('button', { name: '身后视角' }).click()
  await expect(page.getByTestId('scale-encounter')).toHaveAttribute('data-phase', 'eyes')
  await expect(canvas).toHaveAttribute('data-scale-encounter-camera-stage', 'follow-orbit')
  await capture(page, 'desktop-child-rear')
  for (const azimuth of [0, 60, 120, 180, 240, 300]) {
    for (const time of [0, 3, 5, 8]) {
      await canvas.evaluate((element, state) => {
        element.dataset.scaleEncounterReviewOrbitAzimuthDegrees = String(state.azimuth)
        element.dataset.scaleEncounterReviewOrbitHeight = 'child-eye'
        element.dataset.oceanReviewWaveTime = String(state.time)
        element.dataset.reviewAnimationTime = String(state.time)
      }, { azimuth, time })
      await expect(canvas).toHaveAttribute('data-scale-encounter-review-orbit', `child-eye:${azimuth}`)
      await page.waitForTimeout(100)
      await capture(page, `orbit-${azimuth}-time-${time}`)
    }
  }
  expect(errors).toEqual([])
  await page.getByRole('button', { name: '返回展台', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-scale-encounter-last-disposal', /environmentDetached/)
  const disposal = JSON.parse((await canvas.getAttribute('data-scale-encounter-last-disposal'))!) as { avatarDetached: boolean; environmentDetached: boolean; rendererMemoryBeforeDisposal: { textures: number }; rendererMemoryAfterDisposal: { textures: number } }
  expect(disposal.avatarDetached).toBe(true)
  expect(disposal.environmentDetached).toBe(true)
  expect(disposal.rendererMemoryAfterDisposal.textures).toBeLessThan(disposal.rendererMemoryBeforeDisposal.textures)
  await writeFile(`${output}/desktop-disposal.json`, JSON.stringify(disposal, null, 2))
  await expect(canvas).not.toHaveAttribute('data-ocean-refracted')
  await expect(canvas).not.toHaveAttribute('data-scale-encounter', 'true')
  await openOcean(page)
  await capture(page, 'desktop-reentry')
  await page.getByRole('button', { name: '重新设置', exact: true }).click()
  await page.getByRole('radio', { name: /女孩/ }).check({ force: true })
  await page.getByRole('button', { name: '身高增加 5 厘米' }).click()
  await page.getByRole('button', { name: '进入比一比' }).click()
  await expect(canvas).toHaveAttribute('data-ocean-refracted', /tier/)
  await capture(page, 'desktop-girl-profile')
  expect(errors).toEqual([])
})

for (const id of ['ichthyosaur', 'plesiosaurus', 'megalodon', 'anomalocaris']) {
  test(`real-scale ocean remains available for ${id}`, async ({ page }) => {
    const errors = watchErrors(page)
    await openOcean(page, id)
    await capture(page, `${id}-overview`)
    await enterEyes(page)
    await capture(page, `${id}-eyes`)
    expect(errors).toEqual([])
  })
}

test('phone portrait DPR2, touch, reduced motion and water phase remain coherent', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = watchErrors(page)
  await openOcean(page)
  const canvas = page.locator('.viewer-canvas')
  await capture(page, 'phone-overview')
  await benchmark(page, 'phone-performance')
  const first = JSON.parse((await canvas.getAttribute('data-ocean-refracted'))!) as Record<string, unknown>
  expect(first.waveTime).toBe(0)
  await enterEyes(page)
  await capture(page, 'phone-eyes-reduced-motion')
  const next = JSON.parse((await canvas.getAttribute('data-ocean-refracted'))!) as Record<string, unknown>
  expect(next.waveTime).toBe(0)
  expect(next.updates).toBe(first.updates)
  expect(errors).toEqual([])
  await context.close()
})

for (const blocked of ['EXT_float_blend', 'EXT_color_buffer_float', 'OES_texture_float_linear']) {
  test(`analytic ocean is explicit and usable without ${blocked}`, async ({ page }) => {
    const errors = watchErrors(page)
    await page.addInitScript(extension => {
      const original = Object.getOwnPropertyDescriptor(
        WebGL2RenderingContext.prototype, 'getExtension',
      )!.value as WebGL2RenderingContext['getExtension']
      Object.defineProperty(WebGL2RenderingContext.prototype, 'getExtension', {
        value: new Proxy(original, {
          apply(target, receiver: WebGL2RenderingContext, args: unknown[]): unknown {
            return args[0] === extension ? null : Reflect.apply(target, receiver, args) as unknown
          },
        }),
      })
    }, blocked)
    await openOcean(page)
    await expect(page.locator('.viewer-canvas')).toHaveAttribute('data-ocean-refracted', /analytic-capability/)
    await enterEyes(page)
    await capture(page, `fallback-${blocked}`)
    await benchmark(page, `fallback-${blocked}-performance`)
    expect(errors).toEqual([])
  })
}


test('phone DPR2 animated ocean and touch zoom', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchErrors(page)
  await openOcean(page)
  const canvas = page.locator('.viewer-canvas')
  const before = await canvas.getAttribute('data-scale-encounter-overview-zoom')
  await page.locator('.scale-encounter-distance-control button').last().tap()
  await expect(canvas).not.toHaveAttribute('data-scale-encounter-overview-zoom', before!)
  await capture(page, 'phone-animated-overview')
  await benchmark(page, 'phone-animated-performance')
  await enterEyes(page)
  await capture(page, 'phone-animated-eyes')
  expect(errors).toEqual([])
  await context.close()
})

test('sustained main-thread load triggers a visible, usable economy then analytic tier', async ({ page }) => {
  const errors = watchErrors(page)
  await openOcean(page)
  await page.evaluate(() => {
    const state = window as Window & { oceanLoadActive?: boolean }
    state.oceanLoadActive = true
    function stress() {
      const end = performance.now() + 35
      while (performance.now() < end) { /* Controlled main-thread stress, not a device benchmark. */ }
      if (state.oceanLoadActive) requestAnimationFrame(stress)
    }
    requestAnimationFrame(stress)
  })
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute('data-ocean-refracted', /refracted-economy/, { timeout: 20_000 })
  await expect(canvas).toHaveAttribute('data-ocean-refracted', /analytic-adaptive/, { timeout: 20_000 })
  await page.evaluate(() => { (window as Window & { oceanLoadActive?: boolean }).oceanLoadActive = false })
  await capture(page, 'adaptive-analytic')
  await writeFile(`${output}/adaptive-diagnostics.json`, (await canvas.getAttribute('data-ocean-refracted'))!)
  expect(errors).toEqual([])
})


test('Retina atlas uses texture pixels and preserves each depth layer across DPR1/2', async ({ browser }) => {
  const means: number[][][] = []
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = watchErrors(page)
    await openOcean(page, 'plesiosaurus')
    const canvas = page.locator('.viewer-canvas')
    await canvas.evaluate(c => {
      c.dataset.oceanReviewHoldQuality = 'true'
      c.dataset.oceanReviewCaptureState = 'true'
      c.dataset.oceanReviewWaveTime = '3'
      c.dataset.oceanReviewReadAtlas = 'true'
    })
    await expect.poll(async () => (JSON.parse((await canvas.getAttribute('data-ocean-refracted'))!) as { atlasTiles?: unknown }).atlasTiles).toBeTruthy()
    const d = JSON.parse((await canvas.getAttribute('data-ocean-refracted'))!) as {
      atlasRenderStates: { expected: number[]; viewport: number[]; scissor: number[] }[]
      atlasTiles: { layer: number; mean: number[]; nonzeroFraction: number; nonfinite: number }[]
    }
    for (const state of d.atlasRenderStates) {
      expect(state.viewport).toEqual(state.expected)
      expect(state.scissor).toEqual(state.expected)
    }
    for (const tile of d.atlasTiles.filter(t => t.layer > 0)) {
      expect(tile.nonzeroFraction).toBeGreaterThan(.95)
      expect(tile.nonfinite).toBe(0)
    }
    means.push(d.atlasTiles.map(t => t.mean))
    await writeFile(`${output}/retina-dpr-${dpr}.json`, JSON.stringify(d, null, 2))
    expect(errors).toEqual([])
    await context.close()
  }
  // GPU floating-point rasterization is not bitwise deterministic. A 1% mean
  // tolerance still decisively rejects missing/misplaced Retina depth layers.
  means[0].forEach((rgb, layer) => rgb.forEach((v, channel) => {
    expect(Math.abs(means[1][layer][channel] - v)).toBeLessThan(.01 * Math.max(1, v))
  }))
})


test('Retina desktop animated overview and eyes measure the selected quality tier', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchErrors(page)
  await openOcean(page)
  await capture(page, 'retina-desktop-overview')
  await benchmark(page, 'retina-desktop-overview-performance')
  await enterEyes(page)
  await capture(page, 'retina-desktop-eyes')
  await benchmark(page, 'retina-desktop-eyes-performance')
  expect(errors).toEqual([])
  await context.close()
})
