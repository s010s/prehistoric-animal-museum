import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { requireHardwareWebGl } from './support/webgl-hardware'

test.setTimeout(60_000)

const cases = [
  {
    animalId: 'tyrannosaurus-rex',
    avatarClip: 'Idle_Forest',
    avatarMotion: 'idle',
    avatarAsset: 'child-avatar-v4-boy-land-explorer-v01',
    avatarRootName:
      'scale-encounter-child-boy-land-explorer-runtime-v1',
    bodyOrientation: 'upright',
    defaultDistance: '12.500',
    name: '霸王龙',
    equipment: 'trail-daypack',
    panoramaAssets: ['panorama-land-cretaceous-v5-farfield-4096'],
    pose: 'grounded-observer',
    sceneCandidate: 'off',
    sceneLabel: '河岸森林',
    sceneSemantic: 'legacy-environment',
    surfaceAssets: [
      'surface-land-albedo-2048',
      'surface-land-normal-2048',
      'surface-land-roughness-2048',
    ],
    travelClip: 'Walk_Forest',
    travelMotion: 'walk',
  },
  {
    animalId: 'pteranodon',
    avatarClip: 'Glide_Static',
    avatarMotion: 'glide',
    avatarAsset: 'child-avatar-v4-boy-air-wingsuit-v01',
    avatarRootName:
      'scale-encounter-child-boy-air-wingsuit-runtime-v1',
    bodyOrientation: 'prone',
    defaultDistance: '15.000',
    name: '无齿翼龙',
    equipment: 'helmeted-wingsuit-and-parachute',
    panoramaAssets: [],
    pose: 'prone-wingsuit-glide',
    sceneCandidate: 'D',
    sceneLabel: '空中相遇',
    sceneSemantic: 'sky',
    surfaceAssets: [],
    travelClip: 'Glide_Static',
    travelMotion: 'glide',
  },
  {
    animalId: 'mosasaurus',
    avatarClip: 'Scuba_Trim_Static',
    avatarMotion: 'idle',
    avatarAsset: 'child-avatar-v4-boy-water-diver-v01',
    avatarRootName:
      'scale-encounter-child-boy-water-diver-runtime-v1',
    bodyOrientation: 'prone',
    defaultDistance: '20.000',
    name: '沧龙',
    equipment: 'scuba-kit',
    panoramaAssets: [],
    pose: 'horizontal-scuba-trim',
    sceneCandidate: 'D',
    sceneLabel: '海底相遇',
    sceneSemantic: 'ocean',
    surfaceAssets: [],
    travelClip: 'Scuba_Trim_Static',
    travelMotion: 'swim',
  },
  {
    animalId: 'mammoth',
    avatarClip: 'Idle_Snow',
    avatarMotion: 'idle',
    avatarAsset: 'child-avatar-v4-boy-snow-expedition-v01',
    avatarRootName:
      'scale-encounter-child-boy-snow-expedition-runtime-v1',
    bodyOrientation: 'upright',
    defaultDistance: '10.000',
    name: '长毛猛犸象',
    equipment: 'insulated-cold-weather-kit',
    panoramaAssets: [],
    pose: 'cold-weather-observer',
    sceneCandidate: 'E',
    sceneLabel: '寒冷草原',
    sceneSemantic: 'mammoth-palaeoenvironment',
    surfaceAssets: [
      'surface-snow-albedo-1024',
      'surface-snow-normal-1024',
      'surface-snow-roughness-1024',
      'surface-land-albedo-1024',
      'surface-land-normal-1024',
    ],
    travelClip: 'Walk_Snow',
    travelMotion: 'walk',
  },
] as const

const viewports = [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'mobile', width: 390 },
] as const

const mobileHeightEndpoints = [
  {
    animalId: 'pteranodon',
    avatarAsset: 'child-avatar-v4-girl-air-wingsuit-v01',
    avatarRootName:
      'scale-encounter-child-girl-air-wingsuit-runtime-v1',
    heightCm: 90,
    name: '无齿翼龙',
    environmentAsset: 'island-landforms-v2',
  },
  {
    animalId: 'mammoth',
    avatarAsset: 'child-avatar-v4-girl-snow-expedition-v01',
    avatarRootName:
      'scale-encounter-child-girl-snow-expedition-runtime-v1',
    heightCm: 130,
    name: '长毛猛犸象',
    environmentAsset: 'forest-props-real-v1',
  },
] as const

function isChildCandidateRequest(url: string): boolean {
  return url.includes('child-avatar-v4-')
}

async function muteNarration(dialog: Locator): Promise<void> {
  const settings = dialog.getByRole('button', { name: '打开声音与文字设置' })
  await settings.click()
  const narration = dialog.getByRole('button', { name: '开关讲解旁白' })
  await expect(narration).toHaveAttribute('aria-pressed', 'true')
  await narration.click()
  await expect(narration).toHaveAttribute('aria-pressed', 'false')
  await expect(dialog).toHaveAttribute('data-narration', 'off')
  await settings.click()
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
  const gender = dialog.getByRole('group', { name: '小朋友是男孩还是女孩？' })
  const approach = dialog.getByRole('group', { name: '想离动物多近？' })
  await expect(gender.getByRole('radio')).toHaveCount(2)
  await expect(gender.getByRole('radio', { name: /男孩/ })).not.toBeChecked()
  await expect(gender.getByRole('radio', { name: /女孩/ })).not.toBeChecked()
  await expect(approach.getByRole('radio')).toHaveCount(2)
  await expect(approach.getByRole('radio', { name: /留点距离/ })).toBeChecked()
  await expect(approach.getByRole('radio', { name: /靠近观察/ })).not.toBeChecked()
  await expect(dialog.getByRole('slider')).toHaveValue('110')
  expect(glbRequests.filter(isChildCandidateRequest)).toHaveLength(0)
  await dialog.getByRole('radio', { name: /男孩/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()

  await expect(dialog).toHaveAttribute('data-phase', 'overview')
  await expect(dialog).toHaveAttribute(
    'data-experience-layer',
    'imaginative-encounter',
  )
  await expect(dialog.getByText('想象相遇', { exact: true })).toBeVisible()
  await expect(
    dialog.locator('.scale-encounter-scene-heading').getByText(animal.sceneLabel, { exact: true }),
  ).toBeVisible()
  await expect(dialog).toHaveAttribute('data-scene-candidate', animal.sceneCandidate)
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-scene-semantic',
    animal.sceneSemantic,
  )
  await expect(canvas).toHaveAttribute('data-scale-encounter', 'true')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-animal-id',
    animal.animalId,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-distance-meters',
    animal.defaultDistance,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.820',
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-variant',
    animal.avatarRootName,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-equipment',
    animal.equipment,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-orientation',
    animal.bodyOrientation,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-pose',
    animal.pose,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-motion',
    animal.avatarMotion,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-active-clip',
    animal.avatarClip,
  )
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-avatar-speed-meters-per-second',
    '0.000',
  )
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
    animal.avatarAsset,
  )
  await expect
    .poll(
      () => panoramaRequests.length,
      { message: 'only the panorama used by the selected environment should load' },
    )
    .toBe(animal.panoramaAssets.length)
  for (const asset of animal.panoramaAssets) {
    expect(panoramaRequests.filter((url) => url.includes(asset))).toHaveLength(1)
  }
  await expect
    .poll(() => surfaceRequests.length, {
      message: 'the selected environment should load its exact PBR surface set',
    })
    .toBe(animal.surfaceAssets.length)
  for (const asset of animal.surfaceAssets) {
    expect(surfaceRequests.filter((url) => url.includes(asset))).toHaveLength(1)
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
  expect(clickMidpoint).toBeGreaterThan(0.74)
  expect(clickMidpoint).toBeLessThan(0.82)
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.740',
  )

  await farther.click()
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.820',
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

  expect(firstHeldZoom).toBeLessThan(0.82)
  expect(secondHeldZoom).toBeLessThan(firstHeldZoom - 0.02)
  const releasedZoom = Number(
    await canvas.getAttribute('data-scale-encounter-overview-zoom'),
  )
  await page.waitForTimeout(160)
  expect(
    Number(await canvas.getAttribute('data-scale-encounter-overview-zoom')),
  ).toBeCloseTo(releasedZoom, 3)
})

test('mobile controls stay compact and expose 360-degree orbit only in POV', async ({
  page,
}) => {
  await requireHardwareWebGl(page)
  await page.setViewportSize(viewports[1])
  await openEncounter(page, cases[1], 'mobile-orbit-controls')
  const dialog = page.getByTestId('scale-encounter')
  const canvas = page.locator('.viewer-canvas')
  const controls = dialog.locator('.scale-encounter-controls')
  const distanceControl = dialog.locator('.scale-encounter-distance-control')
  const viewButton = dialog.getByRole('button', { name: '从我的眼睛看' })
  const left = dialog.getByRole('button', { name: '向左绕着动物看' })
  const right = dialog.getByRole('button', { name: '向右绕着动物看' })

  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.820',
  )
  await expect(controls).toBeVisible()
  await expect(left).toHaveCount(0)
  await expect(right).toHaveCount(0)
  const [controlsBox, distanceBox, viewBox] = await Promise.all([
    controls.boundingBox(),
    distanceControl.boundingBox(),
    viewButton.boundingBox(),
  ])
  expect(controlsBox).not.toBeNull()
  expect(distanceBox).not.toBeNull()
  expect(viewBox).not.toBeNull()
  if (controlsBox && distanceBox && viewBox) {
    expect(controlsBox.height).toBeLessThanOrEqual(60)
    expect(
      Math.abs(
        distanceBox.y + distanceBox.height / 2 -
          (viewBox.y + viewBox.height / 2),
      ),
    ).toBeLessThanOrEqual(2)
  }
  expect(
    await controls.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true)

  await page.keyboard.press('ArrowRight')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-orbit-angle-degrees',
    '0.00',
  )
  await muteNarration(dialog)
  await viewButton.click()
  await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
    timeout: 15_000,
  })
  await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
  await expect(left).toBeVisible()
  await expect(right).toBeVisible()
  const [leftBox, rightBox] = await Promise.all([
    left.boundingBox(),
    right.boundingBox(),
  ])
  expect(leftBox).not.toBeNull()
  expect(rightBox).not.toBeNull()
  if (leftBox && rightBox) {
    expect(leftBox.x).toBeGreaterThanOrEqual(8)
    expect(rightBox.x + rightBox.width).toBeLessThanOrEqual(
      viewports[1].width - 8,
    )
  }

  await right.click()
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-orbit-angle-degrees',
    '30.00',
  )
  for (let step = 0; step < 11; step += 1) await right.click()
  await expect
    .poll(async () => {
      const angle = Number(
        await canvas.getAttribute('data-scale-encounter-orbit-angle-degrees'),
      )
      return Math.min(angle, 360 - angle)
    }, {
      // Sky orbit travels at min(20 deg/s, 4 / maximumDistance rad/s).
      // Pteranodon's 21 m limit makes a complete turn take about 33 seconds.
      timeout: 35_000,
    })
    .toBeLessThan(0.05)
  await saveVisual(page, 'mobile-pteranodon-complete-orbit.png')
})

test('mobile keyboard orbit stops on release and returns through the original eye position', async ({
  page,
}) => {
  await requireHardwareWebGl(page)
  await page.setViewportSize(viewports[1])
  await openEncounter(page, cases[1], 'mobile-orbit-return')
  const dialog = page.getByTestId('scale-encounter')
  const canvas = page.locator('.viewer-canvas')
  await muteNarration(dialog)
  await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'eyes', {
    timeout: 15_000,
  })

  const left = dialog.getByRole('button', { name: '向左绕着动物看' })
  const right = dialog.getByRole('button', { name: '向右绕着动物看' })
  for (let step = 0; step < 6; step += 1) await left.click()
  await expect
    .poll(async () =>
      Number(
        await canvas.getAttribute('data-scale-encounter-orbit-angle-degrees'),
      ),
    // The same 10.9 deg/s sky cadence needs about 16.5 seconds for 180 degrees.
    { timeout: 20_000 })
    .toBeCloseTo(180, 1)

  // Keys drive continuous motion; releasing one must freeze its current angle.
  await page.keyboard.down('ArrowLeft')
  try {
    await expect
      .poll(async () => Number(
        await canvas.getAttribute('data-scale-encounter-orbit-angle-degrees'),
      ))
      .toBeLessThan(178)
  } finally {
    await page.keyboard.up('ArrowLeft')
  }
  const releasedAngle = await canvas.getAttribute(
    'data-scale-encounter-orbit-angle-degrees',
  )
  await page.waitForTimeout(160)
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-orbit-angle-degrees',
    releasedAngle ?? '',
  )

  await dialog.getByRole('button', { name: '退后看全身' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'returning')
  await expect(canvas).toHaveAttribute('data-scale-encounter-view', 'pov')
  const stageAtOriginalEye = await page
    .waitForFunction(() => {
      const element = document.querySelector<HTMLCanvasElement>('.viewer-canvas')
      const degrees = Number(
        element?.dataset.scaleEncounterOrbitAngleDegrees,
      )
      if (!element || !Number.isFinite(degrees)) return false
      const distanceFromOrigin = Math.min(degrees, 360 - degrees)
      return distanceFromOrigin < 0.05
        ? element.dataset.scaleEncounterCameraStage
        : false
    })
    .then((handle) => handle.jsonValue())
  expect(stageAtOriginalEye).toBe('pov')
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-camera-stage',
    'child-rear',
  )
  await expect(dialog).toHaveAttribute('data-phase', 'overview', {
    timeout: 10_000,
  })
  await expect(left).toHaveCount(0)
  await expect(right).toHaveCount(0)
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-orbit-angle-degrees',
    '0.00',
  )
})

test('mammoth overview allows the requested deeper close-up', async ({
  page,
}) => {
  await requireHardwareWebGl(page)
  await page.setViewportSize(viewports[1])
  await openEncounter(page, cases[3], 'mobile-mammoth-close-up')
  const dialog = page.getByTestId('scale-encounter')
  const canvas = page.locator('.viewer-canvas')
  const closer = dialog.getByRole('button', { name: '靠近一点' })

  for (let step = 0; step < 8; step += 1) await closer.click()
  await expect(canvas).toHaveAttribute(
    'data-scale-encounter-overview-zoom',
    '0.580',
  )
  await saveVisual(page, 'mobile-mammoth-overview-closest.png')
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

      await muteNarration(dialog)
      await dialog.getByRole('button', { name: '从我的眼睛看' }).click()
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-camera-stage',
        'full-body-showcase',
        { timeout: 12_000 },
      )
      await saveVisual(
        page,
        `${viewport.label}-${animal.animalId}-showcase.png`,
      )
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
        expect(guideCopy).toContain('两只大翅膀从左到右足有七米')
        expect(guideCopy).toContain('飞到对面')
        expect(guideCopy).not.toMatch(/低头|下面|俯视/)
      }
      if (animal.animalId === 'mosasaurus') {
        const copy = await dialog.innerText()
        expect(copy).toContain('斜上方')
        expect(copy).toContain('身体两侧的四只鳍')
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
        const closer = dialog.getByRole('button', { name: '靠近一点' })
        const farther = dialog.getByRole('button', { name: '退后一点' })
        await closer.click()
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-distance-meters',
          '12.150',
        )
        await farther.click()
        await expect(canvas).toHaveAttribute(
          'data-scale-encounter-distance-meters',
          animal.defaultDistance,
        )
        // World eye height includes the terrain's local height. Retracing to
        // the same point must restore the original height at the same precision.
        expect(Number(await canvas.getAttribute(
          'data-scale-encounter-eye-height-meters',
        ))).toBeCloseTo(initialPovEyeHeight, 6)
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
        // The terrain can change the world's Y coordinate along this dolly;
        // its far endpoint must still keep the eye above the safety floor.
        expect(farPovEyeHeight).toBeGreaterThan(0.35)
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
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-avatar-motion',
        animal.travelMotion,
      )
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-avatar-active-clip',
        animal.travelClip,
      )
      await expect(canvas).toHaveAttribute(
        'data-scale-encounter-avatar-heading',
        /^-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6}$/,
      )
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
    const environmentResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().includes(endpoint.environmentAsset) && candidate.ok(),
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

    const [childAsset, environment] = await Promise.all([
      childAssetResponse,
      environmentResponse,
    ])
    expect(childAsset.url()).toContain(
      endpoint.avatarAsset,
    )
    expect(childRequests).toHaveLength(1)
    // Vite's dev server streams these files without a Content-Length header,
    // so measure the delivered payload instead of relying on response headers.
    const childBytes = (await childAsset.body()).byteLength
    const environmentBytes = (await environment.body()).byteLength
    expect(childBytes).toBeGreaterThan(0)
    expect(childBytes).toBeLessThanOrEqual(4_000_000)
    expect(environmentBytes).toBeGreaterThan(0)
    expect(childBytes + environmentBytes).toBeLessThanOrEqual(5 * 1024 * 1024)

    const overviewFrame = await canvas.screenshot({ animations: 'allow' })
    await page.waitForTimeout(450)
    const laterOverviewFrame = await canvas.screenshot({ animations: 'allow' })
    expect(laterOverviewFrame.equals(overviewFrame)).toBe(false)

    await muteNarration(dialog)
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
  expect(panoramaRequestsAfterFirstOpen).toBe(animal.panoramaAssets.length)
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

test('explorer gender, height and approach persist in local storage across tabs', async ({
  context,
  page,
}, testInfo) => {
  const animal = cases[0]
  const storageKey = 'museum.scaleEncounterProfile.v1'
  const expectedProfile = { approach: 'close', gender: 'girl', heightCm: 125 }
  const response = await page.goto(`./zh-CN/?animal=${animal.animalId}`)
  expect(response?.ok()).toBe(true)
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id', animal.animalId, { timeout: 30_000 },
  )
  await page.getByRole('button', { name: /打开和霸王龙比一比/ }).click()
  const dialog = page.getByTestId('scale-encounter')
  await expect(dialog).toHaveAttribute('data-phase', 'setup')
  await dialog.getByRole('radio', { name: /女孩/ }).check({ force: true })
  await dialog.getByRole('slider').fill('125')
  await dialog.getByRole('radio', { name: /靠近观察/ }).check({ force: true })
  await dialog.getByRole('button', { name: '进入比一比' }).click()
  await expect(dialog).toHaveAttribute('data-phase', 'overview')

  const storedProfile = await page.evaluate((key) => ({
    local: JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown,
    session: window.sessionStorage.getItem(key),
  }), storageKey)
  expect(storedProfile.local).toEqual({ profile: expectedProfile, version: 1 })
  expect(storedProfile.session).toBeNull()

  const observeSavedExplorer = async (target: Page) => {
    const encounter = target.getByTestId('scale-encounter')
    const canvas = target.locator('.viewer-canvas')
    await expect(encounter).toHaveAttribute('data-phase', 'overview')
    await expect(encounter.getByRole('slider')).toHaveCount(0)
    await expect(canvas).toHaveAttribute(
      'data-scale-encounter-avatar-variant',
      'scale-encounter-child-girl-land-explorer-runtime-v1',
    )
    await muteNarration(encounter)
    await encounter.getByRole('button', { name: '从我的眼睛看' }).click()
    await expect(encounter).toHaveAttribute('data-phase', 'eyes', {
      timeout: 15_000,
    })
    const eyeHeight = Number(await canvas.getAttribute('data-scale-encounter-eye-height-meters'))
    expect(eyeHeight).toBeGreaterThan(0)
    const closer = encounter.getByRole('button', { name: '靠近一点' })
    for (let step = 0; step < 20; step += 1) await closer.click()
    // A comfortable T. rex encounter stops at 6.5 m. The saved close approach
    // must continue inside that limit while keeping the child's eyes grounded.
    await expect.poll(async () => Number(
      await canvas.getAttribute('data-scale-encounter-distance-meters'),
    ), { timeout: 10_000 }).toBeLessThan(6.5)
    return { eyeHeight }
  }

  const original = await observeSavedExplorer(page)
  const restoredPage = await context.newPage()
  const url = page.url()
  await page.close()
  const restoredResponse = await restoredPage.goto(url)
  expect(restoredResponse?.ok()).toBe(true)
  await expect(restoredPage.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id', animal.animalId, { timeout: 30_000 },
  )
  await restoredPage.getByRole('button', { name: /打开和霸王龙比一比/ }).click()
  const restored = await observeSavedExplorer(restoredPage)
  expect(restored.eyeHeight).toBeCloseTo(original.eyeHeight, 6)
  const restoredStorage = await restoredPage.evaluate((key) => ({
    local: JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown,
    session: window.sessionStorage.getItem(key),
  }), storageKey)
  expect(restoredStorage).toEqual(storedProfile)
  await testInfo.attach('persisted-explorer-profile', {
    body: JSON.stringify({ expectedProfile, storedProfile, original, restored, restoredStorage }, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('restored-explorer', {
    body: await restoredPage.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})
