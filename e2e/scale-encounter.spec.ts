import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

test.setTimeout(60_000)

const cases = [
  {
    animalId: 'tyrannosaurus-rex',
    defaultDistance: '12.500',
    name: '霸王龙',
    panoramaTheme: 'land-cretaceous',
    relation: '共同地面 · 侧面相遇',
  },
  {
    animalId: 'pteranodon',
    defaultDistance: '15.000',
    name: '无齿翼龙',
    panoramaTheme: 'air-cretaceous',
    relation: '俯视翼展 · 随后平视',
  },
  {
    animalId: 'mosasaurus',
    defaultDistance: '20.000',
    name: '沧龙',
    panoramaTheme: 'water-cretaceous',
    relation: '水下错层 · 斜向上观察',
  },
  {
    animalId: 'mammoth',
    avatarRootName:
      'scale-encounter-child-boy-base-review-candidate',
    defaultDistance: '10.000',
    name: '长毛猛犸象',
    panoramaTheme: 'snow-ice-age',
    relation: '寒冷草原 · 共同地面侧视',
  },
] as const

const viewports = [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'mobile', width: 390 },
] as const

const mobileHeightEndpoints = [
  {
    animalId: 'pteranodon',
    avatarRootName:
      'scale-encounter-child-girl-base-review-candidate',
    heightCm: 90,
    name: '无齿翼龙',
    panoramaTheme: 'air-cretaceous',
  },
  {
    animalId: 'mammoth',
    avatarRootName:
      'scale-encounter-child-girl-base-review-candidate',
    heightCm: 130,
    name: '长毛猛犸象',
    panoramaTheme: 'snow-ice-age',
  },
] as const

function isChildCandidateRequest(url: string): boolean {
  return url.includes('child-avatar-v3-')
}

async function saveVisual(
  page: Page,
  file: string,
): Promise<void> {
  const output = process.env.SCALE_ENCOUNTER_VISUAL_OUTPUT
  if (!output) {
    return
  }
  await mkdir(output, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, file),
  })
}

async function openEncounter(
  page: Page,
  animal: (typeof cases)[number],
  visualPrefix: string,
): Promise<{
  readonly activeAnimalGlb: string
  readonly backgroundSource: string
  readonly glbRequests: string[]
  readonly panoramaRequests: string[]
  readonly scale: string
  readonly surfaceRequests: string[]
}> {
  const glbRequests: string[] = []
  const panoramaRequests: string[] = []
  const surfaceRequests: string[] = []
  page.on('request', (request) => {
    if (/\.glb(?:$|\?)/.test(request.url())) {
      glbRequests.push(request.url())
    }
    if (request.url().includes('panorama-')) {
      panoramaRequests.push(request.url())
    }
    if (request.url().includes('surface-')) {
      surfaceRequests.push(request.url())
    }
  })
  const response = await page.goto(`./zh-CN/?animal=${animal.animalId}`)
  expect(response?.ok()).toBe(true)
  const museum = page.locator('#museum-experience')
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    animal.animalId,
    { timeout: 30_000 },
  )
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute('data-first-frame-rendered', 'true')
  const activeAnimalGlb = glbRequests.find(
    (url) => !isChildCandidateRequest(url),
  )
  expect(activeAnimalGlb).toBeDefined()
  const background = page.locator('.scene-background img').last()
  await expect(background).toBeVisible()
  const backgroundSource = await background.evaluate(
    (image: HTMLImageElement) => image.currentSrc,
  )
  await page.evaluate(() => {
    Object.defineProperty(window, '__encounterOriginalCanvas', {
      configurable: true,
      value: document.querySelector('.viewer-canvas'),
    })
  })

  const activeAnimalRequestsBeforeEntry = glbRequests.filter(
    (url) => url === activeAnimalGlb,
  ).length
  await page
    .getByRole('button', {
      name: new RegExp(`打开和${animal.name}比一比`),
    })
    .click()
  const dialog = page.getByRole('dialog', {
    name: `和${animal.name}比一比`,
  })
  await expect(dialog).toBeVisible()
  await saveVisual(page, `${visualPrefix}-${animal.animalId}-setup.png`)
  await expect(dialog.getByRole('radio')).toHaveCount(2)
  await expect(dialog.getByRole('slider')).toHaveValue('110')
  expect(glbRequests.filter(isChildCandidateRequest)).toHaveLength(0)
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()

  await expect(dialog).toHaveAttribute('data-phase', 'overview')
  await expect(
    dialog.getByText(animal.relation, { exact: true }).last(),
  ).toBeVisible()
  await expect(canvas).toHaveAttribute('data-scale-encounter', 'true')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-animal-id',
    animal.animalId,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-distance-meters',
    animal.defaultDistance,
  )
  if ('avatarRootName' in animal) {
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-avatar-variant',
      animal.avatarRootName,
    )
  }
  const scale = (await canvas.getAttribute(
    'data-scale-encounter-meters-per-unit',
  )) ?? ''
  expect(Number(scale)).toBeGreaterThan(0)
  expect(
    glbRequests.filter((url) => url === activeAnimalGlb),
  ).toHaveLength(activeAnimalRequestsBeforeEntry)
  await expect
    .poll(
      () => glbRequests.filter(isChildCandidateRequest).length,
      { message: 'only the selected child package should load' },
    )
    .toBe(1)
  expect(glbRequests.filter(isChildCandidateRequest)[0]).toContain(
    'child-avatar-v3-boy-land-normal',
  )
  await expect
    .poll(
      () => panoramaRequests.length,
      { message: 'the animal-specific 4K first-frame panorama should load' },
    )
    .toBe(1)
  expect(panoramaRequests[0]).toContain(
    `panorama-${animal.panoramaTheme}-4096`,
  )
  if (animal.animalId === 'pteranodon') {
    expect(surfaceRequests).toHaveLength(0)
  } else {
    await expect
      .poll(() => surfaceRequests.length, {
        message: 'land, snow and water should load all three PBR maps',
      })
      .toBe(3)
    expect(surfaceRequests.every((url) => url.includes('-2048'))).toBe(true)
  }
  await expect
    .poll(() => background.evaluate((image: HTMLImageElement) => image.currentSrc))
    .toBe(backgroundSource)

  return {
    activeAnimalGlb: activeAnimalGlb ?? '',
    backgroundSource,
    glbRequests,
    panoramaRequests,
    scale,
    surfaceRequests,
  }
}

test('overview buttons ease a click and hold a constant forward dolly on hardware WebGL', async ({
  page,
}) => {
  await requireHardwareWebGl(page)
  await page.setViewportSize({ height: 900, width: 1440 })
  await openEncounter(page, cases[0], 'smooth-distance')
  const dialog = page.getByTestId('scale-encounter')
  const canvas = page.locator('.viewer-canvas')
  const closer = dialog.getByRole('button', { name: '靠近一点' })
  const farther = dialog.getByRole('button', { name: '退后一点' })

  await closer.evaluate((button: HTMLButtonElement) => button.click())
  await page.waitForTimeout(50)
  const clickMidpoint = Number(
    await canvas.getAttribute('data-scale-encounter-overview-zoom'),
  )
  expect(clickMidpoint).toBeGreaterThan(0.92)
  expect(clickMidpoint).toBeLessThan(1)
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.920',
  )

  await farther.click()
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '1.000',
  )
  const buttonBounds = await closer.boundingBox()
  expect(buttonBounds).not.toBeNull()
  if (!buttonBounds) return
  await page.mouse.move(
    buttonBounds.x + buttonBounds.width / 2,
    buttonBounds.y + buttonBounds.height / 2,
  )
  await page.mouse.down()
  await page.waitForTimeout(320)
  const firstHeldZoom = Number(
    await canvas.getAttribute('data-scale-encounter-overview-zoom'),
  )
  await page.waitForTimeout(300)
  const secondHeldZoom = Number(
    await canvas.getAttribute('data-scale-encounter-overview-zoom'),
  )
  await page.mouse.up()

  expect(firstHeldZoom).toBeLessThan(1)
  expect(secondHeldZoom).toBeLessThan(firstHeldZoom - 0.02)
  const releasedZoom = Number(
    await canvas.getAttribute('data-scale-encounter-overview-zoom'),
  )
  await page.waitForTimeout(160)
  expect(
    Number(await canvas.getAttribute('data-scale-encounter-overview-zoom')),
  ).toBeCloseTo(releasedZoom, 3)
})

for (const viewport of viewports) {
  for (const animal of cases) {
    test(`${viewport.label} ${animal.animalId} keeps one scene and a comfortable direct encounter`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const { backgroundSource, glbRequests, scale } = await openEncounter(
        page,
        animal,
        viewport.label,
      )
      const dialog = page.getByTestId('scale-encounter')
      const canvas = page.locator('.viewer-canvas')
      const background = page.locator('.scene-background img').last()
      await saveVisual(
        page,
        `${viewport.label}-${animal.animalId}-overview.png`,
      )

      if (
        viewport.label === 'mobile' &&
        animal.animalId === 'tyrannosaurus-rex'
      ) {
        const fartherOverview = dialog.getByRole('button', {
          name: '退后一点',
        })
        for (let step = 0; step < 10; step += 1) {
          await fartherOverview.click()
        }
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-overview-zoom',
          '1.180',
        )
        await saveVisual(
          page,
          'mobile-tyrannosaurus-rex-overview-farthest.png',
        )
      }

      await dialog
        .getByRole('button', { name: '开关讲解员姐姐的声音' })
        .click()
      await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-camera-stage',
        'child-rear',
        { timeout: 12_000 },
      )
      await saveVisual(page, `${viewport.label}-${animal.animalId}-rear.png`)
      await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
        timeout: 15_000,
      })
      await expect(dialog).toHaveAttribute('data-view', 'pov')
      await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-distance-meters',
        animal.defaultDistance,
      )
      const initialPovEyeHeight = Number(
        await canvas.getAttribute('data-scale-encounter-eye-height-meters'),
      )
      expect(Number.isFinite(initialPovEyeHeight)).toBe(true)
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-meters-per-unit',
        scale,
      )

      if (animal.animalId === 'pteranodon') {
        const guideCopy = await dialog
          .locator('.scale-encounter-caption p')
          .innerText()
        expect(guideCopy).toContain('一样高')
        expect(guideCopy).toContain('正前方')
        expect(guideCopy).not.toMatch(/低头|下面|俯视/)
      }
      if (animal.animalId === 'mosasaurus') {
        const copy = await dialog.innerText()
        expect(copy).toContain('斜上方')
        expect(copy).toContain('水面')
      }

      await saveVisual(page, `${viewport.label}-${animal.animalId}-pov.png`)

      const gestureLayer = dialog.locator('.scale-encounter-gesture-layer')
      const gestureBox = await gestureLayer.boundingBox()
      expect(gestureBox).not.toBeNull()
      const distanceBeforeDrag = await canvas.getAttribute(
        'data-scale-encounter-distance-meters',
      )
      if (gestureBox) {
        await page.mouse.move(
          gestureBox.x + gestureBox.width * 0.35,
          gestureBox.y + gestureBox.height * 0.5,
        )
        await page.mouse.down()
        await page.mouse.move(
          gestureBox.x + gestureBox.width * 0.72,
          gestureBox.y + gestureBox.height * 0.26,
          { steps: 5 },
        )
        await page.mouse.up()
      }
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-distance-meters',
        distanceBeforeDrag ?? '',
      )
      if (animal.animalId === 'tyrannosaurus-rex') {
        const farther = dialog.getByRole('button', { name: '退后一点' })
        for (let step = 0; step < 20; step += 1) {
          await farther.click()
        }
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-distance-meters',
          '18.000',
        )
        const farPovEyeHeight = Number(
          await canvas.getAttribute('data-scale-encounter-eye-height-meters'),
        )
        // The child-eye camera remains on its grounded horizontal dolly instead
        // of extending the old diagonal rail below the land plane. The unit
        // controller test separately checks all four near-plane corners.
        expect(farPovEyeHeight).toBeGreaterThan(0.35)
        expect(farPovEyeHeight).toBeCloseTo(initialPovEyeHeight, 6)
        await saveVisual(
          page,
          `${viewport.label}-${animal.animalId}-pov-farthest.png`,
        )
      }
      const distanceBeforeCloser = Number(
        await canvas.getAttribute('data-scale-encounter-distance-meters'),
      )
      await gestureLayer.evaluate((element) => {
        element.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: -120,
          }),
        )
      })
      await expect
        .poll(async () =>
          Number(
            await canvas.getAttribute('data-scale-encounter-distance-meters'),
          ),
        )
        .toBeLessThan(distanceBeforeCloser)
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-meters-per-unit',
        scale,
      )

      const urlBeforeBack = page.url()
      const requestsBeforeBack = glbRequests.length
      await page.goBack()
      await expect(dialog).toBeHidden()
      await expect(canvas).not.toHaveAttribute('data-scale-encounter', 'true')
      await expect(canvas).not.toHaveAttribute(
        'data-scale-encounter-avatar-variant',
      )
      await expect(canvas).not.toHaveAttribute(
        'data-scale-encounter-eye-height-meters',
      )
      expect(page.url()).toBe(urlBeforeBack)
      await expect(page.locator('#museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        animal.animalId,
      )
      expect(glbRequests).toHaveLength(requestsBeforeBack)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  __encounterOriginalCanvas?: Element
                }
              ).__encounterOriginalCanvas ===
              document.querySelector('.viewer-canvas'),
          ),
        )
        .toBe(true)
      await expect
        .poll(() => background.evaluate((image: HTMLImageElement) => image.currentSrc))
        .toBe(backgroundSource)
      await expect(page.getByRole('button', { name: /打开和.+比一比/ })).toBeFocused()
    })
  }
}

for (const endpoint of mobileHeightEndpoints) {
  test(`mobile ${endpoint.heightCm} cm ${endpoint.animalId} keeps the detailed avatar and WebGL context healthy`, async ({
    page,
  }) => {
    await page.setViewportSize(viewports[1])
    const childRequests: string[] = []
    page.on('request', (request) => {
      if (isChildCandidateRequest(request.url())) {
        childRequests.push(request.url())
      }
    })
    const response = await page.goto(`./zh-CN/?animal=${endpoint.animalId}`)
    expect(response?.ok()).toBe(true)
    const museum = page.locator('#museum-experience')
    await expect(museum).toHaveAttribute(
      'data-ready-animal-id',
      endpoint.animalId,
      { timeout: 30_000 },
    )

    const childAssetResponse = page.waitForResponse(
      (candidate) =>
        isChildCandidateRequest(candidate.url()) && candidate.ok(),
    )
    const panoramaResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().includes(
          `panorama-${endpoint.panoramaTheme}-4096`,
        ) && candidate.ok(),
    )
    await page
      .getByRole('button', {
        name: new RegExp(`打开和${endpoint.name}比一比`),
      })
      .click()
    const dialog = page.getByRole('dialog', {
      name: `和${endpoint.name}比一比`,
    })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /女孩/ }).check({ force: true })
    const height = dialog.getByRole('slider')
    await height.fill(String(endpoint.heightCm))
    await expect(height).toHaveValue(String(endpoint.heightCm))
    await dialog.getByRole('button', { name: '进入比一比' }).click()

    await expect(dialog).toHaveAttribute('data-phase', 'overview', {
      timeout: 30_000,
    })
    const canvas = page.locator('.viewer-canvas')
    await expect(canvas).toHaveAttribute('data-scale-encounter', 'true')
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-avatar-variant',
      endpoint.avatarRootName,
    )
    await expect(canvas).toHaveAttribute('data-first-frame-rendered', 'true')

    const [childAsset, panorama] = await Promise.all([
      childAssetResponse,
      panoramaResponse,
    ])
    expect(childAsset.url()).toContain(
      'child-avatar-v3-girl-land-normal',
    )
    expect(childRequests).toHaveLength(1)
    // Vite's dev server streams these files without a Content-Length header,
    // so measure the delivered payload instead of relying on response headers.
    const childBytes = (await childAsset.body()).byteLength
    const panoramaBytes = (await panorama.body()).byteLength
    expect(childBytes).toBeGreaterThan(0)
    expect(childBytes).toBeLessThanOrEqual(4_000_000)
    expect(panoramaBytes).toBeGreaterThan(0)
    expect(childBytes + panoramaBytes).toBeLessThanOrEqual(5 * 1024 * 1024)

    const overviewFrame = await canvas.screenshot({ animations: 'allow' })
    await page.waitForTimeout(450)
    const laterOverviewFrame = await canvas.screenshot({ animations: 'allow' })
    expect(laterOverviewFrame.equals(overviewFrame)).toBe(false)

    await dialog
      .getByRole('button', { name: '开关讲解员姐姐的声音' })
      .click()
    await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
    await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
      timeout: 15_000,
    })
    await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-avatar-variant',
      endpoint.avatarRootName,
    )
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-eye-height-meters',
      /-?\d+\.\d+/,
    )
    expect(
      await canvas.evaluate((element: HTMLCanvasElement) => {
        const context =
          element.getContext('webgl2') ?? element.getContext('webgl')
        return context !== null && !context.isContextLost()
      }),
    ).toBe(true)
    await expect(dialog).not.toHaveAttribute('data-phase', 'error')
  })
}

test('same-page close and reopen reuses both the animal and child GLBs', async ({
  page,
}) => {
  await page.setViewportSize(viewports[0])
  const animal = cases[1]
  const {
    activeAnimalGlb,
    glbRequests,
    panoramaRequests,
    surfaceRequests,
  } = await openEncounter(page, animal, 'resource-cache')
  const animalRequestsAfterFirstOpen = glbRequests.filter(
    (url) => url === activeAnimalGlb,
  ).length
  const childRequestsAfterFirstOpen = glbRequests.filter(
    isChildCandidateRequest,
  ).length
  expect(childRequestsAfterFirstOpen).toBe(1)
  const panoramaRequestsAfterFirstOpen = panoramaRequests.length
  expect(panoramaRequestsAfterFirstOpen).toBe(1)
  const surfaceRequestsAfterFirstOpen = surfaceRequests.length

  const dialog = page.getByTestId('scale-encounter')
  await page.goBack()
  await expect(dialog).toBeHidden()
  await page
    .getByRole('button', { name: new RegExp(`打开和${animal.name}比一比`) })
    .click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-phase', 'overview', {
    timeout: 15_000,
  })

  expect(
    glbRequests.filter((url) => url === activeAnimalGlb),
  ).toHaveLength(animalRequestsAfterFirstOpen)
  expect(glbRequests.filter(isChildCandidateRequest)).toHaveLength(
    childRequestsAfterFirstOpen,
  )
  expect(panoramaRequests).toHaveLength(panoramaRequestsAfterFirstOpen)
  expect(surfaceRequests).toHaveLength(surfaceRequestsAfterFirstOpen)
})
