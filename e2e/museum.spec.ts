import { mainCollection } from '../src/content/collections/main'
import { expect, test, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import { GITHUB_STAR_PROMPT_STORAGE_KEY } from '../src/github'
import { MODEL_DATA_REMINDER_STORAGE_KEY } from '../src/model-policy'

const nestedPath = '/prehistoric-animal-museum/'

interface NormalizedAlphaBounds {
  readonly centerX: number
  readonly centerY: number
  readonly height: number
  readonly pixelCount: number
  readonly visualCenterX: number
  readonly visualCenterY: number
  readonly xMax: number
  readonly xMin: number
  readonly yMax: number
  readonly yMin: number
  readonly width: number
}

async function normalizedAlphaBounds(
  png: Buffer,
  alphaThreshold = 16,
): Promise<NormalizedAlphaBounds | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const alphaChannel = info.channels - 1
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let pixelCount = 0
  let alphaWeight = 0
  let weightedX = 0
  let weightedY = 0

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + alphaChannel]
      if (alpha === undefined || alpha < alphaThreshold) {
        continue
      }
      pixelCount += 1
      alphaWeight += alpha
      weightedX += (x + 0.5) * alpha
      weightedY += (y + 0.5) * alpha
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (pixelCount === 0) {
    return null
  }

  const xMin = minX / info.width
  const xMax = (maxX + 1) / info.width
  const yMin = minY / info.height
  const yMax = (maxY + 1) / info.height
  return {
    centerX: (xMin + xMax) / 2,
    centerY: (yMin + yMax) / 2,
    height: yMax - yMin,
    pixelCount,
    visualCenterX: weightedX / alphaWeight / info.width,
    visualCenterY: weightedY / alphaWeight / info.height,
    width: xMax - xMin,
    xMax,
    xMin,
    yMax,
    yMin,
  }
}

function boundsIntersectionOverUnion(
  first: NormalizedAlphaBounds,
  second: NormalizedAlphaBounds,
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(first.xMax, second.xMax) - Math.max(first.xMin, second.xMin),
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(first.yMax, second.yMax) - Math.max(first.yMin, second.yMin),
  )
  const intersectionArea = intersectionWidth * intersectionHeight
  const firstArea = first.width * first.height
  const secondArea = second.width * second.height
  return intersectionArea / (firstArea + secondArea - intersectionArea)
}

async function openMuseum(
  page: Page,
  query = '',
  options: { waitForModel?: boolean } = {},
): Promise<Locator> {
  const response = await page.goto(`./zh-CN/${query}`)
  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole('heading', { level: 1, name: '史前动物博物馆' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '剑龙' })).toBeVisible()

  const museum = page.locator('#museum-experience')
  await expect(museum).toBeVisible()
  if (options.waitForModel !== false) {
    await expect(museum).toHaveAttribute(
      'data-ready-animal-id',
      'stegosaurus',
      { timeout: 20_000 },
    )
    await expect(page.locator('.viewer-canvas')).toBeVisible()
  }
  return museum
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate<{
    body: number
    document: number
    viewport: number
  }>(`({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  })`)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
}

async function expectPrimaryTargetsAtLeast48Px(page: Page): Promise<void> {
  const targets = page.locator('button:visible, a.animal-card:visible')
  const count = await targets.count()
  expect(count).toBeGreaterThan(0)

  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index)
    const name = await target.getAttribute('aria-label')
      ?? (await target.textContent())
      ?? `button ${index}`
    const box = await target.boundingBox()
    expect(box, `${name} should have a layout box`).not.toBeNull()
    expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(48)
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(48)
  }
}

async function switchToEnglish(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-locale',
    'en',
  )
}

async function expectEnglishAnimalRailNamesContained(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const animalNameLayouts = await page.evaluate<
    Array<{
      cardBottom: number
      cardLeft: number
      cardRight: number
      clientHeight: number
      clientWidth: number
      labelBottom: number
      labelLeft: number
      labelRight: number
      lineCount: number
      name: string
      scrollHeight: number
      scrollWidth: number
      textLeft: number
      textRight: number
    }>
  >(`(() =>
    Array.from(
      document.querySelectorAll(
        '.animal-card:not([data-animal-id^="fixture-"]) strong'
      )
    ).map((label) => {
      const range = document.createRange()
      range.selectNodeContents(label)
      const lineTops = new Set(
        Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))
      )
      const card = label.closest('.animal-card')
      const cardBox = card?.getBoundingClientRect()
      const labelBox = label.getBoundingClientRect()
      const textRects = Array.from(range.getClientRects())
      return {
        cardBottom: cardBox?.bottom ?? Number.NEGATIVE_INFINITY,
        cardLeft: cardBox?.left ?? Number.POSITIVE_INFINITY,
        cardRight: cardBox?.right ?? Number.NEGATIVE_INFINITY,
        clientHeight: label.clientHeight,
        clientWidth: label.clientWidth,
        labelBottom: labelBox.bottom,
        labelLeft: labelBox.left,
        labelRight: labelBox.right,
        lineCount: lineTops.size,
        name: label.textContent ?? '',
        scrollHeight: label.scrollHeight,
        scrollWidth: label.scrollWidth,
        textLeft: Math.min(...textRects.map((rect) => rect.left)),
        textRight: Math.max(...textRects.map((rect) => rect.right))
      }
    })
  )()`)
  expect(animalNameLayouts).toHaveLength(mainCollection.animalIds.length)
  const railFailures = animalNameLayouts.flatMap((layout) => {
    const failures: string[] = []
    if (layout.lineCount < 1 || layout.lineCount > 2) {
      failures.push('uses more than two lines')
    }
    if (layout.scrollHeight > layout.clientHeight + 1) {
      failures.push('is clipped vertically')
    }
    if (layout.scrollWidth > layout.clientWidth + 1) {
      failures.push('is clipped horizontally')
    }
    if (
      layout.labelBottom > layout.cardBottom + 1 ||
      layout.labelLeft < layout.cardLeft - 1 ||
      layout.labelRight > layout.cardRight + 1 ||
      layout.textLeft < layout.cardLeft - 1 ||
      layout.textRight > layout.cardRight + 1
    ) {
      failures.push('extends outside its card')
    }
    return failures.length === 0 ? [] : [{ failures, layout }]
  })
  expect(
    railFailures,
    'every English animal name should stay inside its card',
  ).toEqual([])
}

async function expectEnglishTitleContained(
  page: Page,
  name: string,
): Promise<void> {
  const title = page.getByRole('heading', { level: 2, name })
  await expect(title).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const layout = await title.evaluate((element) => {
    const titleBox = element.getBoundingClientRect()
    const storyCardBox = element.closest('.story-card')?.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const textRects = Array.from(range.getClientRects())
    const lineTops = new Set(textRects.map((rect) => Math.round(rect.top)))
    const style = getComputedStyle(element)
    return {
      clientWidth: element.clientWidth,
      hyphens: style.hyphens,
      lineCount: lineTops.size,
      overflowWrap: style.overflowWrap,
      scrollWidth: element.scrollWidth,
      storyCardLeft: storyCardBox?.left ?? Number.POSITIVE_INFINITY,
      storyCardRight: storyCardBox?.right ?? Number.NEGATIVE_INFINITY,
      textLeft: Math.min(...textRects.map((rect) => rect.left)),
      textRight: Math.max(...textRects.map((rect) => rect.right)),
      titleLeft: titleBox.left,
      titleRight: titleBox.right,
      wordBreak: style.wordBreak,
    }
  })
  expect(layout.lineCount, JSON.stringify({ name, viewport: page.viewportSize(), layout })).toBe(1)
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
  expect(layout.textLeft).toBeGreaterThanOrEqual(layout.titleLeft - 1)
  expect(layout.textRight, JSON.stringify({ name, viewport: page.viewportSize(), layout })).toBeLessThanOrEqual(layout.titleRight + 1)
  expect(layout.textLeft).toBeGreaterThanOrEqual(layout.storyCardLeft - 1)
  expect(layout.textRight).toBeLessThanOrEqual(layout.storyCardRight + 1)
  expect(layout.wordBreak).toBe('normal')
  expect(layout.overflowWrap).toBe('normal')
  expect(layout.hyphens).toBe('none')
}

async function setEnglishTitleForLayoutProbe(
  page: Page,
  name: string,
): Promise<void> {
  await page.locator('.animal-title').evaluate((title, nextName) => {
    title.textContent = nextName
    window.dispatchEvent(new Event('resize'))
  }, name)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function expectEnglishResponsiveLayout(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect(page.getByRole('heading', { level: 2, name: 'Stegosaurus' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectPrimaryTargetsAtLeast48Px(page)

  const titleLayout = await page.locator('.animal-title').evaluate((title) => {
    const range = document.createRange()
    range.selectNodeContents(title)
    const lineTops = new Set(
      Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
    )
    const style = getComputedStyle(title)
    return {
      clientWidth: title.clientWidth,
      hyphens: style.hyphens,
      lineCount: lineTops.size,
      overflowWrap: style.overflowWrap,
      scrollWidth: title.scrollWidth,
      wordBreak: style.wordBreak,
    }
  })
  expect(titleLayout.lineCount).toBe(1)
  expect(titleLayout.scrollWidth).toBeLessThanOrEqual(
    titleLayout.clientWidth + 1,
  )
  expect(titleLayout.wordBreak).toBe('normal')
  expect(titleLayout.overflowWrap).toBe('normal')
  expect(titleLayout.hyphens).toBe('none')

  await expectEnglishAnimalRailNamesContained(page)

  if (viewport.width <= 767 && viewport.height > viewport.width) {
    await page
      .getByRole('button', { name: 'Open the full museum guide' })
      .click()
    const collection = page.getByRole('dialog', { name: 'Museum guide' })
    await expect(collection).toBeVisible()
    const columnCounts = await collection.locator('.collection-grid').evaluateAll(
      (grids) => grids.map((grid) =>
        getComputedStyle(grid)
          .gridTemplateColumns.split(' ')
          .filter(Boolean).length,
      ),
    )
    expect(columnCounts).toEqual([2, 2, 2])
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Close the museum guide' }).click()
  }
}

async function expectInsideViewport(
  locator: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  await expect(locator).toHaveCSS('opacity', '1')
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    viewport.width + 1,
  )
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height + 1,
  )
}

interface ModelTransitionProbe {
  readonly opacities: number[]
  readonly states: string[]
}

async function installModelTransitionProbe(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const canvas = document.querySelector('.viewer-canvas')
    const host = document.querySelector('.viewer-host')
    if (!(canvas instanceof HTMLElement) || !(host instanceof HTMLElement)) {
      throw new Error('Viewer transition surfaces are missing')
    }
    const probe = {
      opacities: [],
      states: [canvas.dataset.transitioning ?? '']
    }
    Object.defineProperty(window, '__cachedModelTransitionProbe', {
      configurable: true,
      value: probe
    })
    const inspect = () => {
      const state = canvas.dataset.transitioning ?? ''
      if (probe.states.at(-1) !== state) {
        probe.states.push(state)
      }
      const opacity = Number.parseFloat(
        host.style.getPropertyValue('--model-transition-opacity')
      )
      if (Number.isFinite(opacity)) {
        probe.opacities.push(opacity)
      }
    }
    new MutationObserver(inspect).observe(canvas, {
      attributes: true,
      attributeFilter: ['data-transitioning']
    })
    new MutationObserver(inspect).observe(host, {
      attributes: true,
      attributeFilter: ['style']
    })
    inspect()
  })()`)
}

async function readModelTransitionProbe(
  page: Page,
): Promise<ModelTransitionProbe> {
  return page.evaluate<ModelTransitionProbe>(
    `window.__cachedModelTransitionProbe`,
  )
}

test('loads from the nested static base with Chinese semantics and accessible tooltips', async ({
  page,
}) => {
  const museum = await openMuseum(page)

  expect(new URL(page.url()).pathname).toBe(`${nestedPath}zh-CN/`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'zh-CN')
  const moduleScriptUrl = await page
    .locator('script[type="module"]')
    .getAttribute('src')
  expect(moduleScriptUrl).toMatch(/^\.\.\/assets\//)

  await expect(
    page.getByText('看看它背上的两排骨板，像不像一列起伏的小山？', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText('这是剑龙，它是一种生活在晚侏罗世的食草恐龙。', {
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '听它的介绍' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('link', { name: '查看剑龙' }),
  ).toHaveAttribute('aria-current', 'true')
  await expect(museum).toHaveAttribute(
    'data-requested-animal-id',
    'stegosaurus',
  )
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'data-auto-rotate',
    'false',
  )
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'aria-label',
    '剑龙三维模型，可拖动旋转并缩放',
  )

  const reset = page.getByRole('button', { name: '恢复初始视角' })
  await reset.hover()
  const tooltipId = await reset.getAttribute('aria-describedby')
  expect(tooltipId).toBeTruthy()
  const tooltip = page.locator(`#${tooltipId ?? ''}`)
  await expect(tooltip).toHaveRole('tooltip')
  await expect(tooltip).toHaveText('恢复初始视角')
  await expect(tooltip).toHaveCSS('opacity', '1')
})

test('opens the creator story in the left drawer and keeps source links distinct', async ({
  page,
}) => {
  await openMuseum(page)
  const trigger = page.getByRole('button', {
    name: '了解Leon做了个和这座博物馆',
  })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '关于这座博物馆' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('一个程序员爸爸，为女儿做的小博物馆'),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: '在 GitHub 查看源码' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum',
  )
  await expect(
    dialog.getByRole('link', { name: '查看许可与素材说明' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
  )
  const drawerBox = await dialog.boundingBox()
  expect(drawerBox).not.toBeNull()
  expect(drawerBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(12)

  await dialog.getByRole('button', { name: '关闭关于这座博物馆' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.getByRole('button', { name: '给家长的资料' }).click()
  const parentDialog = page.getByRole('dialog', { name: '给家长的资料' })
  const disclosure = parentDialog.getByText('开源与许可')
  await disclosure.click()
  await expect(
    parentDialog.getByRole('link', { name: '查看 GitHub 项目' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum',
  )
  await expect(
    parentDialog.getByRole('link', { name: '查看完整许可说明' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
  )
})

test('offers a GitHub Star after 60 seconds without leaving the museum tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addInitScript(`(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = (handler, timeout = 0, ...args) =>
      nativeSetTimeout(handler, timeout === 60000 ? 50 : timeout, ...args)
  })()`)
  await openMuseum(page)

  const prompt = page.getByRole('complementary', {
    name: '支持这座博物馆',
  })
  await expect(prompt).toBeVisible()
  const link = prompt.getByRole('link', { name: '去 GitHub' })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute(
    'href',
    'https://github.com/s010s/prehistoric-animal-museum',
  )
  const promptBox = await prompt.boundingBox()
  const navigationBox = await page.locator('.animal-navigation').boundingBox()
  expect(promptBox).not.toBeNull()
  expect(navigationBox).not.toBeNull()
  expect(
    Math.abs(
      (promptBox?.x ?? 0) + (promptBox?.width ?? 0) / 2 -
        ((navigationBox?.x ?? 0) + (navigationBox?.width ?? 0) / 2),
    ),
  ).toBeLessThanOrEqual(1)

  await prompt.getByRole('button', { name: '暂时不用' }).click()
  await expect(prompt).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        GITHUB_STAR_PROMPT_STORAGE_KEY,
      ),
    )
    .toMatch(/^dismissed-until:/)
})

test('eagerly loads every thumbnail in the complete museum index', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMuseum(page)
  await page.getByRole('button', { name: '打开全馆图鉴' }).click()

  const dialog = page.getByRole('dialog', { name: '全馆图鉴' })
  const cards = dialog.locator('.collection-card')
  const images = dialog.locator('.collection-card__image img')
  const cardCount = await cards.count()

  expect(cardCount).toBeGreaterThan(0)
  await expect(images).toHaveCount(cardCount)
  expect(
    await images.evaluateAll((elements) =>
      elements.every((element) => element.getAttribute('loading') === 'eager'),
    ),
  ).toBe(true)

  await expect(dialog.locator('.collection-grid')).toHaveCount(3)
  await dialog.locator('.elevator-scrollable').evaluate((scrollport) => {
    scrollport.scrollTop = scrollport.scrollHeight
  })
  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true)
})

test('preloads only the adjacent model binaries after the quiet-period gate', async ({
  page,
}) => {
  const failedModelUrls: string[] = []
  const modelUrls = new Set<string>()
  let modelRequestCount = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('.glb')) {
      modelUrls.add(url.pathname)
      modelRequestCount += 1
    }
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('.glb')) {
      failedModelUrls.push(url.pathname)
    }
  })

  await openMuseum(page)
  await expect
    .poll(() => modelUrls.size, { timeout: 10_000 })
    .toBe(3)
  await page.waitForTimeout(1_000)
  expect(modelUrls.size).toBe(3)
  expect(failedModelUrls).toEqual([])

  const requestsBeforeAdjacentSelection = modelRequestCount
  await page
    .locator(
      'a[data-animal-detail-link][data-animal-id="pteranodon"]',
    )
    .click()
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    'pteranodon',
    { timeout: 10_000 },
  )
  expect(modelRequestCount).toBe(requestsBeforeAdjacentSelection)
  expect(failedModelUrls).toEqual([])
})

test('shows an adjacent in-memory model without fading the WebGL canvas', async ({
  page,
}) => {
  const finishedModelUrls = new Set<string>()
  page.on('requestfinished', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('.glb')) {
      finishedModelUrls.add(url.pathname)
    }
  })

  const museum = await openMuseum(page)
  await expect
    .poll(() => finishedModelUrls.size, { timeout: 10_000 })
    .toBe(3)
  await installModelTransitionProbe(page)

  await page
    .locator(
      'a[data-animal-detail-link][data-animal-id="pteranodon"]',
    )
    .click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'pteranodon',
    { timeout: 10_000 },
  )
  await page.waitForTimeout(700)

  const probe = await readModelTransitionProbe(page)
  expect(probe.states).not.toContain('true')
  expect(probe.opacities.every((opacity) => opacity >= 0.999)).toBe(true)
})

test('shows a browser-cached model without fading after a hard refresh', async ({
  page,
}) => {
  const finishedModelUrls = new Set<string>()
  page.on('requestfinished', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('.glb')) {
      finishedModelUrls.add(url.pathname)
    }
  })

  await openMuseum(page)
  await expect
    .poll(() => finishedModelUrls.size, { timeout: 10_000 })
    .toBe(3)
  const modelResponse = await page.request.head([...finishedModelUrls][0])
  expect(modelResponse.ok()).toBe(true)
  expect(modelResponse.headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  )
  const documentResponse = await page.request.head('./zh-CN/')
  expect(documentResponse.headers()['cache-control']).toBe('no-store')
  await page.reload()
  const museum = page.locator('#museum-experience')
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'stegosaurus',
    { timeout: 20_000 },
  )
  await installModelTransitionProbe(page)

  await page
    .locator(
      'a[data-animal-detail-link][data-animal-id="pteranodon"]',
    )
    .click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'pteranodon',
    { timeout: 10_000 },
  )
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'data-model-load-source',
    'http-cache',
  )
  await page.waitForTimeout(700)

  const probe = await readModelTransitionProbe(page)
  expect(probe.states).not.toContain('true')
  expect(probe.opacities.every((opacity) => opacity >= 0.999)).toBe(true)
})

test('does not leak an unhandled error during rapid cached animal switching', async ({
  page,
}) => {
  const browserErrors: string[] = []
  const finishedModelUrls = new Set<string>()
  page.on('requestfinished', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('.glb')) {
      finishedModelUrls.add(url.pathname)
    }
  })
  page.on('pageerror', (error) => {
    browserErrors.push(error.stack ?? error.message)
  })
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('Cannot read properties of undefined')
    ) {
      browserErrors.push(message.text())
    }
  })

  const museum = await openMuseum(page)
  await expect
    .poll(() => finishedModelUrls.size, { timeout: 10_000 })
    .toBe(3)
  await page.evaluate(`(async () => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const next = buttons.find(
      (button) => button.getAttribute('aria-label') === '下一只动物'
    )
    const previous = buttons.find(
      (button) => button.getAttribute('aria-label') === '上一只动物'
    )
    if (!(next instanceof HTMLButtonElement) ||
        !(previous instanceof HTMLButtonElement)) {
      throw new Error('Adjacent-animal buttons are missing')
    }
    for (let index = 0; index < 12; index += 1) {
      ;(index % 2 === 0 ? next : previous).click()
      await new Promise((resolve) => window.setTimeout(resolve, 90))
    }
  })()`)

  await expect(museum).toHaveAttribute('data-requested-animal-id', 'stegosaurus')
  await page.waitForTimeout(3_000)
  expect(browserErrors).toEqual([])
})

test('keeps a distant full-museum selection and its feedback inside the visible rail', async ({
  page,
}) => {
  const viewport = { width: 390, height: 844 }
  await page.setViewportSize(viewport)
  const museum = await openMuseum(page, '?fixtures=1')

  await page.getByRole('button', { name: '打开全馆图鉴' }).click()
  let dialog = page.getByRole('dialog', { name: '全馆图鉴' })
  await dialog.getByRole('button', { name: '前往慢慢龙展台' }).click()

  const slowCard = page.locator(
    '.animal-card[data-animal-id="fixture-slow"]',
  )
  await expect(museum).toHaveAttribute(
    'data-requested-animal-id',
    'fixture-slow',
  )
  await expect(slowCard).toHaveAttribute('data-loading', 'true')
  await expect(slowCard.locator('.card-status')).toBeVisible()
  await expect(slowCard.locator('.card-status')).toContainText(
    /正在请它出来|下载中|正在打开/,
  )
  await expectInsideViewport(slowCard, viewport)
  expect(await slowCard.evaluate((card) => document.activeElement === card)).toBe(
    false,
  )

  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-slow',
    { timeout: 20_000 },
  )
  await page.getByRole('button', { name: '打开全馆图鉴' }).click()
  dialog = page.getByRole('dialog', { name: '全馆图鉴' })
  await dialog.getByRole('button', { name: '前往再试龙展台' }).click()

  const retryCard = page.locator(
    '.animal-card[data-animal-id="fixture-retry"]',
  )
  await expect(retryCard).toHaveAttribute('data-failed', 'true')
  await expect(retryCard.getByText('点我再试')).toBeVisible()
  await expectInsideViewport(retryCard, viewport)
  expect(
    await retryCard.evaluate((card) => document.activeElement === card),
  ).toBe(false)
})

test('keeps automatic rotation off before and after a focus-mode drag', async ({
  page,
}) => {
  await openMuseum(page)
  await page.getByRole('button', { name: '专注看模型' }).click()
  const canvas = page.locator('.viewer-canvas')
  await expect(canvas).toHaveAttribute('data-auto-rotate', 'false')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) {
    throw new Error('Viewer canvas did not have a layout box')
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2)
  await expect(canvas).toHaveAttribute('data-auto-rotate', 'false')
  await page.mouse.up()
  // Manual input must not restart the retired idle camera spin.
  await page.waitForTimeout(4_300)
  await expect(canvas).toHaveAttribute('data-auto-rotate', 'false')
  await expect(canvas).toHaveAttribute('data-first-frame-rendered', 'true')
})

test('shows a distinct stage loader while the first animal is arriving', async ({
  page,
}) => {
  await page.route('**/*.glb', async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 850)
    })
    await route.continue()
  })

  const museum = await openMuseum(page, '', { waitForModel: false })
  const loader = page.locator('.stage-loading')

  await expect(loader).toBeVisible()
  await expect(page.locator('.model-still')).toBeVisible()
  await expect(
    page.getByRole('progressbar', { name: '3D 模型加载进度' }),
  ).toBeVisible()
  const initialLoaderBox = await loader.boundingBox()
  await expect(
    page.getByText(/正在下载 3D 模型 · \d+%/),
  ).toBeVisible({ timeout: 1_000 })
  await page.waitForTimeout(350)
  const progressingLoaderBox = await loader.boundingBox()
  expect(progressingLoaderBox?.height).toBe(initialLoaderBox?.height)
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'stegosaurus',
    { timeout: 20_000 },
  )
  await expect(loader).toHaveCount(0)
  await expect(page.locator('.viewer-canvas')).toBeVisible()
})

test('keeps the first-arrival treatment visible for a useful minimum', async ({
  page,
}) => {
  const startedAt = Date.now()
  const museum = await openMuseum(page, '', { waitForModel: false })

  await expect(page.locator('.stage-loading')).toBeVisible()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'stegosaurus',
    { timeout: 20_000 },
  )
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(800)
})

test('keeps every initial model surface transparent across a hard refresh', async ({
  page,
}) => {
  await page.route('**/*.glb', async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 1_100)
    })
    await route.continue()
  })

  const assertTransparentStage = async () => {
    await expect(
      page.getByRole('heading', { level: 2, name: '剑龙' }),
    ).toBeVisible()
    await expect(page.locator('.scene-background img')).toBeVisible()
    await expect(page.locator('.viewer-canvas')).toBeVisible()
    const paints = await page.evaluate<{
      body: string
      canvas: string
      clearAlpha: number | null
      host: string
      root: string
      stage: string
    }>(`(() => {
      const canvas = document.querySelector('.viewer-canvas')
      const host = document.querySelector('.viewer-host')
      const stage = document.querySelector('.viewer-stage')
      if (!(canvas instanceof HTMLCanvasElement) || !host || !stage) {
        throw new Error('The transparent viewer surfaces are missing.')
      }
      const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const clearValue = context
        ? context.getParameter(context.COLOR_CLEAR_VALUE)
        : null
      return {
        body: getComputedStyle(document.body).backgroundColor,
        canvas: getComputedStyle(canvas).backgroundColor,
        clearAlpha: clearValue ? clearValue[3] : null,
        host: getComputedStyle(host).backgroundColor,
        root: getComputedStyle(document.documentElement).backgroundColor,
        stage: getComputedStyle(stage).backgroundColor
      }
    })()`)

    expect(paints.root).not.toBe('rgb(255, 255, 255)')
    expect(paints.body).not.toBe('rgb(255, 255, 255)')
    expect(paints.canvas).toBe('rgba(0, 0, 0, 0)')
    expect(paints.host).toBe('rgba(0, 0, 0, 0)')
    expect(paints.stage).toBe('rgba(0, 0, 0, 0)')
    expect(paints.clearAlpha).toBe(0)
  }

  await page.goto('./zh-CN/')
  await assertTransparentStage()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await assertTransparentStage()
})

test('switches the bounded CSS atmosphere with the committed exhibit', async ({
  page,
}) => {
  const museum = await openMuseum(page, '?fixtures=1')
  await expect(museum).toHaveAttribute('data-habitat', 'land')
  await expect(museum).toHaveAttribute('data-atmosphere', 'forest')
  await expect(page.locator('.forest-atmosphere')).toBeVisible()
  await expect(page.locator('.underwater-atmosphere')).toHaveCount(0)

  await page.getByRole('button', { name: '查看快快龙' }).click()
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'fixture-fast', {
    timeout: 20_000,
  })
  await expect(museum).toHaveAttribute('data-habitat', 'water')
  await expect(museum).toHaveAttribute('data-atmosphere', 'underwater')
  await expect(page.locator('.forest-atmosphere')).toHaveCount(0)
  const atmosphere = page.locator('.underwater-atmosphere')
  await expect(atmosphere).toBeVisible()
  await expect(atmosphere).toHaveCSS('pointer-events', 'none')
  await expect(atmosphere.locator('.underwater-bubble')).toHaveCount(12)
  await expect(atmosphere.locator('.underwater-current').first()).toHaveCSS(
    'animation-name',
    'underwater-current-drift',
  )

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(atmosphere.locator('.underwater-bubble').first()).toHaveCSS(
    'display',
    'none',
  )
  await expect(atmosphere.locator('.underwater-current').first()).toHaveCSS(
    'animation-name',
    'none',
  )
  await expect(atmosphere.locator('.underwater-bubbles')).not.toHaveCSS(
    'background-image',
    'none',
  )

  await page.getByRole('button', { name: '查看再试龙' }).click()
  await page.getByRole('button', { name: '查看再试龙，加载失败，点击重试' }).click()
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'fixture-retry', {
    timeout: 20_000,
  })
  await expect(museum).toHaveAttribute('data-habitat', 'land')
  await expect(museum).toHaveAttribute('data-atmosphere', 'forest')
  await expect(page.locator('.forest-atmosphere')).toBeVisible()
  await expect(page.locator('.underwater-atmosphere')).toHaveCount(0)
})

test('uses a full-screen WebGL zoom canvas around the shared preview frame', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMuseum(page)

  const canvas = page.locator('.viewer-canvas')
  const viewport = page.locator('.model-viewport')
  const compositionFrame = page.locator('.model-composition-frame')
  const fittedGeometry = async () => {
    const canvasBox = await canvas.boundingBox()
    const frameBox = await compositionFrame.boundingBox()
    const viewportBox = await viewport.boundingBox()
    return {
      canvasHeight: Math.round(canvasBox?.height ?? 0),
      canvasWidth: Math.round(canvasBox?.width ?? 0),
      canvasX: Math.round(canvasBox?.x ?? 0),
      canvasY: Math.round(canvasBox?.y ?? 0),
      frameHeight: Math.round(frameBox?.height ?? 0),
      frameWidth: Math.round(frameBox?.width ?? 0),
      frameX: Math.round(frameBox?.x ?? 0),
      frameY: Math.round(frameBox?.y ?? 0),
      profile: await viewport.getAttribute('data-preview-profile'),
      rendererHeight: Number(
        await canvas.getAttribute('data-composition-height'),
      ),
      rendererLeft: Number(
        await canvas.getAttribute('data-composition-left'),
      ),
      rendererTop: Number(
        await canvas.getAttribute('data-composition-top'),
      ),
      rendererWidth: Number(
        await canvas.getAttribute('data-composition-width'),
      ),
      viewportHeight: Math.round(viewportBox?.height ?? 0),
      viewportWidth: Math.round(viewportBox?.width ?? 0),
    }
  }

  await expect.poll(fittedGeometry).toMatchObject({
    profile: 'phonePortraitTall',
    rendererHeight: expect.any(Number),
    rendererWidth: expect.any(Number),
  })
  let geometry = await fittedGeometry()
  expect(geometry.canvasX).toBe(0)
  expect(geometry.canvasY).toBe(0)
  expect(geometry.canvasWidth).toBe(390)
  expect(geometry.canvasHeight).toBe(844)
  expect(geometry.rendererWidth).toBe(geometry.frameWidth)
  expect(geometry.rendererHeight).toBe(geometry.frameHeight)
  expect(geometry.rendererLeft).toBe(geometry.frameX - geometry.canvasX)
  expect(geometry.rendererTop).toBe(geometry.frameY - geometry.canvasY)
  expect(geometry.canvasWidth).toBe(geometry.viewportWidth)
  expect(geometry.canvasHeight).toBe(geometry.viewportHeight)

  await page.setViewportSize({ width: 390, height: 750 })
  await expect
    .poll(async () => (await fittedGeometry()).profile)
    .toBe('phonePortraitTall')
  geometry = await fittedGeometry()
  expect(geometry.canvasX).toBe(0)
  expect(geometry.canvasY).toBe(0)
  expect(geometry.canvasWidth).toBe(390)
  expect(geometry.canvasHeight).toBe(750)
  expect(geometry.rendererWidth).toBe(geometry.frameWidth)
  expect(geometry.rendererHeight).toBe(geometry.frameHeight)
  expect(geometry.rendererLeft).toBe(geometry.frameX - geometry.canvasX)
  expect(geometry.rendererTop).toBe(geometry.frameY - geometry.canvasY)
  expect(geometry.canvasWidth).toBe(geometry.viewportWidth)
  expect(geometry.canvasHeight).toBe(geometry.viewportHeight)
  expect(geometry.canvasWidth).toBeGreaterThan(geometry.frameWidth)

  await page.setViewportSize({ width: 844, height: 390 })
  await expect
    .poll(async () => (await fittedGeometry()).profile)
    .toBe('landscapeCompact')
  geometry = await fittedGeometry()
  expect(geometry.canvasX).toBe(0)
  expect(geometry.canvasY).toBe(0)
  expect(geometry.canvasWidth).toBe(844)
  expect(geometry.canvasHeight).toBe(390)
  expect(geometry.rendererWidth).toBe(geometry.frameWidth)
  expect(geometry.rendererHeight).toBe(geometry.frameHeight)
  expect(geometry.rendererLeft).toBe(geometry.frameX - geometry.canvasX)
  expect(geometry.rendererTop).toBe(geometry.frameY - geometry.canvasY)
  expect(geometry.canvasWidth).toBe(geometry.viewportWidth)
  expect(geometry.canvasHeight).toBe(geometry.viewportHeight)
})

test('reveals the local loading label after 300 ms while preserving the ready animal', async ({
  page,
}) => {
  await page.clock.install()
  const museum = await openMuseum(page, '?fixtures=1')
  const slowCard = page.getByRole('button', { name: '查看慢慢龙' })
  const browserTime = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(browserTime + 60_000)

  await slowCard.click()
  await expect(museum).toHaveAttribute('data-requested-animal-id', 'fixture-slow')
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus')
  await expect(page.getByRole('heading', { name: '剑龙' })).toBeVisible()
  await expect(page.locator('.scene-background--solo img')).not.toHaveAttribute(
    'src',
    /fixture-slow/,
  )
  await expect(slowCard).toHaveAttribute('data-loading', 'true')
  await expect(page.getByText('正在请它出来…')).toHaveCount(0)

  await page.clock.runFor(299)
  await expect(page.getByText('正在请它出来…')).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(page.getByText('正在请它出来…')).toBeVisible()

  await page.clock.runFor(550)
  await page.clock.resume()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-slow',
    { timeout: 20_000 },
  )
  await expect(page.getByRole('heading', { name: '慢慢龙' })).toBeVisible()
  await expect(page.getByText('正在请它出来…')).toHaveCount(0)
})

test('keeps the fast selection when an uncancellable slow result arrives later', async ({
  page,
}) => {
  const museum = await openMuseum(page, '?fixtures=1')
  await page.evaluate(`(() => {
    const probe = {
      outgoingAppeared: false,
      outgoingPreservedInitial: false,
      outgoingRemoved: false,
      modelOpacities: [],
      viewerStates: [],
      transitionPhases: []
    }
    Object.defineProperty(window, '__museumTransitionProbe', {
      configurable: true,
      value: probe
    })
    document
      .querySelector('.scene-background')
      ?.setAttribute('data-probe-background', 'initial')
    const inspect = () => {
      const outgoing = document.querySelector('.scene-background--outgoing')
      if (outgoing) {
        probe.outgoingAppeared = true
        if (outgoing.getAttribute('data-probe-background') === 'initial') {
          probe.outgoingPreservedInitial = true
        }
      } else if (probe.outgoingAppeared) {
        probe.outgoingRemoved = true
      }
      const state = document
        .querySelector('.viewer-canvas')
        ?.getAttribute('data-transitioning')
      if (state && probe.viewerStates.at(-1) !== state) {
        probe.viewerStates.push(state)
      }
      const phase = document
        .querySelector('.viewer-canvas')
        ?.getAttribute('data-transition-phase')
      if (phase && probe.transitionPhases.at(-1) !== phase) {
        probe.transitionPhases.push(phase)
      }
      const modelOpacity = Number.parseFloat(
        document
          .querySelector('.viewer-host')
          ?.style.getPropertyValue('--model-transition-opacity') ?? ''
      )
      if (Number.isFinite(modelOpacity)) {
        probe.modelOpacities.push(modelOpacity)
      }
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.attributeName === 'data-transition-phase' &&
          record.oldValue &&
          probe.transitionPhases.at(-1) !== record.oldValue
        ) {
          probe.transitionPhases.push(record.oldValue)
        }
      }
      inspect()
    }).observe(document.body, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        'class',
        'data-transitioning',
        'data-transition-phase',
        'style'
      ],
      childList: true,
      subtree: true
    })
    inspect()
  })()`)

  await page.getByRole('button', { name: '查看慢慢龙' }).click()
  await expect(museum).toHaveAttribute('data-requested-animal-id', 'fixture-slow')
  await page.getByRole('button', { name: '查看快快龙' }).click()
  await expect(museum).toHaveAttribute('data-requested-animal-id', 'fixture-fast')

  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-fast',
    { timeout: 20_000 },
  )
  await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible()
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'aria-label',
    '快快龙三维模型，可拖动旋转并缩放',
  )
  await expect(
    page.locator(
      '.scene-background:not(.scene-background--outgoing) img',
    ),
  ).toHaveAttribute('src', /#fixture-fast$/)
  await expect(page.locator('.model-still')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate<boolean>(
        `Boolean(
          window.__museumTransitionProbe?.outgoingAppeared &&
          window.__museumTransitionProbe?.outgoingPreservedInitial
        )`,
      ),
    )
    .toBe(true)

  // The slow fixture ignores AbortSignal and still produces a staged model.
  // Waiting past its delay proves that late success cannot overwrite the page.
  await page.waitForTimeout(1_400)
  await expect(page.locator('.scene-background--outgoing')).toHaveCount(0)
  await expect(page.locator('.viewer-canvas')).toHaveAttribute(
    'data-transitioning',
    'false',
  )
  const transitionProbe = await page.evaluate<{
    outgoingAppeared: boolean
    outgoingPreservedInitial: boolean
    outgoingRemoved: boolean
    modelOpacities: number[]
    transitionPhases: string[]
    viewerStates: string[]
  }>(`window.__museumTransitionProbe`)
  expect(transitionProbe.outgoingAppeared).toBe(true)
  expect(transitionProbe.outgoingPreservedInitial).toBe(true)
  expect(transitionProbe.outgoingRemoved).toBe(true)
  expect(transitionProbe.viewerStates).toContain('true')
  expect(transitionProbe.viewerStates.at(-1)).toBe('false')
  expect(transitionProbe.transitionPhases).toContain('outgoing')
  expect(transitionProbe.transitionPhases).toContain('incoming')
  expect(transitionProbe.transitionPhases.at(-1)).toBe('idle')
  expect(Math.min(...transitionProbe.modelOpacities)).toBeLessThan(0.1)
  expect(Math.max(...transitionProbe.modelOpacities)).toBeGreaterThan(0.9)
  const transitionOverlay = await page.evaluate<{
    backdropFilter: string
    backgroundImage: string
    content: string
  }>(`(() => {
    const host = document.querySelector('.viewer-host')
    if (!(host instanceof HTMLElement)) {
      throw new Error('Viewer host is missing')
    }
    const style = getComputedStyle(host, '::after')
    return {
      backdropFilter: style.backdropFilter,
      backgroundImage: style.backgroundImage,
      content: style.content
    }
  })()`)
  expect(transitionOverlay.content).toBe('none')
  expect(transitionOverlay.backgroundImage).toBe('none')
  expect(transitionOverlay.backdropFilter).toBe('none')
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'fixture-fast')
  await expect(museum).toHaveAttribute('data-requested-animal-id', 'fixture-fast')
  await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible()
  await page.getByRole('button', { name: '给家长的资料' }).click()
  await expect(page.getByText('测试时期：快快龙', { exact: true })).toBeVisible()
  await expect(page.getByText('测试展区：快快龙', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭家长资料' }).click()
})

test('keeps the ready presentation on failure and retries with a fresh token', async ({
  page,
}) => {
  const museum = await openMuseum(page, '?fixtures=1')
  const retryCard = page.getByRole('button', { name: '查看再试龙' })
  const tokenBefore = Number(await museum.getAttribute('data-request-token'))

  await retryCard.click()
  await expect(retryCard).toHaveAttribute('data-failed', 'true')
  await expect(
    page.getByText('点我再试'),
  ).toBeVisible()
  await expect(retryCard).toHaveAccessibleName(
    '查看再试龙，加载失败，点击重试',
  )
  await expect(page.locator('p[role="status"]')).toContainText(
    '再试龙暂时没准备好，可以点击它的卡片重试。',
  )
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus')
  const failedToken = Number(await museum.getAttribute('data-request-token'))
  expect(failedToken).toBeGreaterThan(tokenBefore)

  await retryCard.click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-retry',
    { timeout: 20_000 },
  )
  const retriedToken = Number(await museum.getAttribute('data-request-token'))
  expect(retriedToken).toBeGreaterThan(failedToken)
  await expect(page.getByRole('heading', { name: '再试龙' })).toBeVisible()
  await expect(
    page.getByText('点我再试'),
  ).toHaveCount(0)
})

test('shows the poster for an initial model failure and succeeds on explicit retry', async ({
  page,
}) => {
  let firstModelRequest = true
  await page.route('**/*.glb', async (route) => {
    if (firstModelRequest) {
      firstModelRequest = false
      await route.fulfill({
        body: 'deterministic model request failure',
        contentType: 'text/plain',
        status: 503,
      })
      return
    }
    await route.continue()
  })
  const museum = await openMuseum(page, '', {
    waitForModel: false,
  })

  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(
    page.getByText('它暂时没准备好，再点一次试试。'),
  ).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()
  await expect(museum).toHaveAttribute('data-ready-animal-id', '')

  const failedToken = Number(await museum.getAttribute('data-request-token'))
  await page.getByRole('button', { name: '重新加载模型' }).click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'stegosaurus',
    { timeout: 20_000 },
  )
  expect(Number(await museum.getAttribute('data-request-token'))).toBeGreaterThan(
    failedToken,
  )
  await expect(page.getByText('今天先看看它的静态模型吧')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeEnabled()
})

test('keeps content, navigation, narration state, and parent facts in WebGL fallback', async ({
  page,
}) => {
  await page.addInitScript({
    content: `(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (contextId, ...args) {
        if (contextId === 'webgl' || contextId === 'webgl2') {
          return null
        }
        return originalGetContext.call(this, contextId, ...args)
      }
    })()`,
  })
  const museum = await openMuseum(page, '', {
    waitForModel: false,
  })

  await expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus')
  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(
    page.getByText('这个浏览器现在不能显示 3D 模型。'),
  ).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '听它的介绍' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()
  await expect(page.getByRole('region', { name: '动物选择' })).toBeVisible()

  await page.getByRole('button', { name: '重新加载模型' }).click()
  await expect(page.getByText('今天先看看它的静态模型吧')).toBeVisible()
  await expect(page.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '专注看模型' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: '给家长的资料' }).click()
  await expect(
    page.getByRole('dialog', { name: '给家长的资料' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('dialog', { name: '给家长的资料' })
      .getByText('晚侏罗世', { exact: true }),
  ).toBeVisible()
})

test('honors reduced motion for loading and viewer startup', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('The Playwright project must provide a baseURL')
  }
  const context = await browser.newContext({
    baseURL,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  try {
    await openMuseum(page, '?fixtures=1')
    expect(
      await page.evaluate<boolean>(
        `window.matchMedia('(prefers-reduced-motion: reduce)').matches`,
      ),
    ).toBe(true)

    await page.getByRole('button', { name: '查看慢慢龙' }).click()
    const spinner = page.locator('.loading-orbit')
    await expect(spinner).toBeVisible()
    const duration = await page.evaluate<number>(`(() => {
      const element = document.querySelector('.loading-orbit')
      if (!element) {
        return Number.POSITIVE_INFINITY
      }
      const value = getComputedStyle(element).animationDuration
      if (value.endsWith('ms')) {
        return Number.parseFloat(value)
      }
      return Number.parseFloat(value) * 1_000
    })()`)
    expect(duration).toBeLessThanOrEqual(80)

    await page.getByRole('button', { name: '专注看模型' }).click()
    await expect(page.locator('.viewer-canvas')).toHaveAttribute(
      'data-auto-rotate',
      'false',
    )
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('.viewer-canvas')).toHaveAttribute(
      'data-auto-rotate',
      'false',
    )
  } finally {
    await context.close()
  }
})

test('keeps the narrow-touch data reminder and shows uncached large-model advice', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new Error('The Playwright project must provide a baseURL')
  }
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()

  try {
    await openMuseum(page, '?fixtures=1')
    const notice = page.locator('.model-data-notice')
    await expect(notice).toHaveAttribute('data-notice-kind', 'first-entry')
    await expect(notice).toContainText(
      '3D 动物会使用一些流量，连接 Wi‑Fi 时观看会更顺畅',
    )
    await expect(notice).toHaveAttribute('role', 'status')
    expect(
      await page.evaluate<string | null>(
        `window.localStorage.getItem(${JSON.stringify(
          MODEL_DATA_REMINDER_STORAGE_KEY,
        )})`,
      ),
    ).toBe('seen')
    const animationDuration = await page.evaluate<string>(
      `getComputedStyle(document.querySelector('.model-data-notice')).animationDuration`,
    )
    const animationDurationMs = animationDuration.endsWith('ms')
      ? Number.parseFloat(animationDuration)
      : Number.parseFloat(animationDuration) * 1_000
    expect(animationDurationMs).toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: '关闭模型流量提示' }).click()
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看慢慢龙' }).click()
    await expect(notice).toHaveAttribute('data-notice-kind', 'large-model', {
      timeout: 5_000,
    })
    await expect(notice).toContainText(
      '慢慢龙的 3D 模型约 9.0 MiB，第一次下载的数据量较大，加载可能会久一点',
    )
    await expect(
      page.locator('#museum-experience'),
    ).toHaveAttribute('data-ready-animal-id', 'fixture-slow', {
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看快快龙' }).click()
    await expect(
      page.locator('#museum-experience'),
    ).toHaveAttribute('data-ready-animal-id', 'fixture-fast', {
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: '查看慢慢龙' }).click()
    await expect(
      page.locator('#museum-experience'),
    ).toHaveAttribute('data-ready-animal-id', 'fixture-slow', {
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)

    await page.reload()
    await page.waitForTimeout(1_500)
    await expect(notice).toHaveCount(0)
    await expect(
      page.locator('#museum-experience'),
    ).toHaveAttribute('data-ready-animal-id', 'fixture-slow', {
      timeout: 20_000,
    })
    await expect(notice).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('shows an uncached large-model notice on desktop and suppresses it from memory cache', async ({
  page,
}) => {
  await openMuseum(page, '?fixtures=1')
  const museum = page.locator('#museum-experience')
  const notice = page.locator('.model-data-notice')
  await expect(notice).toHaveCount(0)

  await page.getByRole('button', { name: '查看慢慢龙' }).click()
  await expect(notice).toHaveAttribute('data-notice-kind', 'large-model', {
    timeout: 5_000,
  })
  await expect(notice).toContainText(
    '慢慢龙的 3D 模型约 9.0 MiB，第一次下载的数据量较大，加载可能会久一点',
  )
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-slow',
    { timeout: 20_000 },
  )
  await expect(notice).toHaveCount(0)

  await page.getByRole('button', { name: '查看快快龙' }).click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-fast',
    { timeout: 20_000 },
  )
  await page.getByRole('button', { name: '查看慢慢龙' }).click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-slow',
    { timeout: 20_000 },
  )
  await expect(notice).toHaveCount(0)
})

for (const width of [768, 1023]) {
  test(`keeps the narration script popover inside a ${width}px tablet viewport`, async ({
    page,
  }) => {
    const viewport = { width, height: 768 }
    await page.setViewportSize(viewport)
    await openMuseum(page)

    await page.locator('.narration-control').hover()
    const popover = page.locator('.narration-script-popover')
    await expect(popover).toBeVisible()
    await expectInsideViewport(popover, viewport)
  })
}

test('preserves the committed animal and switches the picture source after orientation change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const museum = await openMuseum(page, '?fixtures=1')
  await page.getByRole('button', { name: '查看快快龙' }).click()
  await expect(museum).toHaveAttribute(
    'data-ready-animal-id',
    'fixture-fast',
    { timeout: 20_000 },
  )

  const portraitSource = await page.evaluate<string>(
    `document.querySelector('.scene-background img')?.currentSrc ?? ''`,
  )
  expect(portraitSource).toContain('portrait')

  await page.setViewportSize({ width: 844, height: 390 })
  await expect
    .poll(() =>
      page.evaluate<string>(
        `document.querySelector('.scene-background img')?.currentSrc ?? ''`,
      ),
    )
    .not.toBe(portraitSource)
  const landscapeSource = await page.evaluate<string>(
    `document.querySelector('.scene-background img')?.currentSrc ?? ''`,
  )
  expect(landscapeSource).toContain('landscape')
  await expect(museum).toHaveAttribute('data-ready-animal-id', 'fixture-fast')
  await expect(page.getByRole('heading', { name: '快快龙' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

const requiredViewports = [
  { name: 'phone-360x640', poster: 'preview-phone-compact', width: 360, height: 640 },
  { name: 'phone-390x844', poster: 'preview-phone-tall', width: 390, height: 844 },
  { name: 'compact-tablet-767x1024', poster: 'preview-tablet-portrait', width: 767, height: 1024 },
  { name: 'phone-landscape-844x390', poster: 'preview-landscape-compact', width: 844, height: 390 },
  { name: 'desktop-wide-1280x720', poster: 'preview-desktop-wide', width: 1280, height: 720 },
  { name: 'tablet-768x1024', poster: 'preview-tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-1023x1365', poster: 'preview-tablet-portrait', width: 1023, height: 1365 },
  { name: 'desktop-1366x768', poster: 'preview-desktop-wide', width: 1366, height: 768 },
  { name: 'desktop-1440x900', poster: 'preview-desktop-standard', width: 1440, height: 900 },
  { name: 'desktop-1885x1329', poster: 'preview-desktop-standard', width: 1885, height: 1329 },
] as const

test('English animal rail contains long names at every required viewport', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.setViewportSize(requiredViewports[0])
  await openMuseum(page, '', { waitForModel: false })
  await switchToEnglish(page)

  for (const viewport of requiredViewports) {
    await page.setViewportSize(viewport)
    await expectEnglishAnimalRailNamesContained(page)
  }
})

test('all English animal titles stay whole at every required viewport', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize(requiredViewports[0])
  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 2, name: '剑龙' })).toBeVisible()
  await switchToEnglish(page)
  const englishNames = await page
    .locator('.animal-card:not([data-animal-id^="fixture-"]) strong')
    .allTextContents()
  expect(englishNames).toHaveLength(mainCollection.animalIds.length)

  for (const viewport of requiredViewports) {
    await page.setViewportSize(viewport)
    for (const name of englishNames) {
      await setEnglishTitleForLayoutProbe(page, name)
      await expectEnglishTitleContained(page, name)
      await expectNoHorizontalOverflow(page)
    }
  }
})

test('mobile portrait grows the story card around a three-line animal introduction', async ({
  page,
}) => {
  const viewport = { width: 400, height: 704 }
  await page.setViewportSize(viewport)
  const response = await page.goto('./zh-CN/?animal=plesiosaurus')
  expect(response?.ok()).toBe(true)

  await expect(page.getByRole('heading', { name: '蛇颈龙类' })).toBeVisible()
  await expect(
    page.getByText(
      '看看它的长颈和四只鳍，四只鳍会像水下的翅膀一样一起划水。',
      { exact: true },
    ),
  ).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const layout = await page.evaluate<{
    cardClientHeight: number
    cardScrollHeight: number
    cardTop: number
    cardBottom: number
    introTop: number
    introBottom: number
    lineCount: number
    stageHeight: number
    navigationBottom: number
  }>(`(() => {
    const card = document.querySelector('.story-card')
    const intro = document.querySelector('.child-intro > span')
    const stage = document.querySelector('[data-testid="model-stage"]')
    const navigation = document.querySelector('.animal-navigation')
    if (
      !(card instanceof HTMLElement) ||
      !(intro instanceof HTMLElement) ||
      !(stage instanceof HTMLElement) ||
      !(navigation instanceof HTMLElement)
    ) {
      throw new Error('The responsive museum layout is incomplete.')
    }
    const cardBox = card.getBoundingClientRect()
    const introBox = intro.getBoundingClientRect()
    const stageBox = stage.getBoundingClientRect()
    const navigationBox = navigation.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(intro)
    const lineTops = new Set(
      Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
    )
    return {
      cardClientHeight: card.clientHeight,
      cardScrollHeight: card.scrollHeight,
      cardTop: cardBox.top,
      cardBottom: cardBox.bottom,
      introTop: introBox.top,
      introBottom: introBox.bottom,
      lineCount: lineTops.size,
      stageHeight: stageBox.height,
      navigationBottom: navigationBox.bottom,
    }
  })()`)

  expect(layout.lineCount).toBeGreaterThanOrEqual(3)
  expect(layout.cardClientHeight).toBeGreaterThan(106)
  expect(layout.cardScrollHeight).toBeLessThanOrEqual(
    layout.cardClientHeight + 1,
  )
  expect(layout.introTop).toBeGreaterThanOrEqual(layout.cardTop)
  expect(layout.introBottom).toBeLessThanOrEqual(layout.cardBottom + 1)
  expect(layout.stageHeight).toBeGreaterThan(240)
  expect(layout.navigationBottom).toBeLessThanOrEqual(viewport.height + 1)
  await expectNoHorizontalOverflow(page)
})

test('mobile portrait keeps a five-character animal name aligned with its introduction', async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 704 })
  const response = await page.goto('./zh-CN/?animal=mammoth')
  expect(response?.ok()).toBe(true)

  await expect(page.getByRole('heading', { name: '长毛猛犸象' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const layout = await page.evaluate<{
    cardClientHeight: number
    cardScrollHeight: number
    introTop: number
    titleLineCount: number
    titleTop: number
  }>(`(() => {
    const card = document.querySelector('.story-card')
    const intro = document.querySelector('.child-intro > span')
    const title = document.querySelector('.animal-title')
    if (
      !(card instanceof HTMLElement) ||
      !(intro instanceof HTMLElement) ||
      !(title instanceof HTMLElement)
    ) {
      throw new Error('The responsive mammoth card is incomplete.')
    }
    const range = document.createRange()
    range.selectNodeContents(title)
    const titleLineTops = new Set(
      Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
    )
    return {
      cardClientHeight: card.clientHeight,
      cardScrollHeight: card.scrollHeight,
      introTop: intro.getBoundingClientRect().top,
      titleLineCount: titleLineTops.size,
      titleTop: title.getBoundingClientRect().top,
    }
  })()`)

  expect(layout.titleLineCount).toBe(1)
  expect(Math.abs(layout.titleTop - layout.introTop)).toBeLessThanOrEqual(1)
  expect(layout.cardScrollHeight).toBeLessThanOrEqual(
    layout.cardClientHeight + 1,
  )
  await expectNoHorizontalOverflow(page)
})

test.describe('responsive first-model reveal', () => {
  test.describe.configure({ mode: 'serial' })

  for (const viewport of requiredViewports) {
    test(`${viewport.name} crossfades its matching first-frame still into WebGL`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await page.route('**/*.glb', async (route) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 700)
        })
        await route.continue()
      })

      const museum = await openMuseum(page, '', { waitForModel: false })
      const loader = page.locator('.stage-loading')
      const viewerHost = page.locator('.viewer-host')

      await expect(loader).toBeVisible()
      const modelStill = page.locator('.model-still')
      const compositionFrame = page.locator('.model-composition-frame')
      await expect(modelStill).toBeVisible()
      await expect
        .poll(() =>
          page
            .locator('.model-still img')
            .evaluate((image) => Reflect.get(image, 'currentSrc') as string),
        )
        .toContain(viewport.poster)
      const stillBox = await modelStill.boundingBox()
      const compositionFrameBox = await compositionFrame.boundingBox()
      expect(stillBox).not.toBeNull()
      expect(compositionFrameBox).not.toBeNull()
      expect(stillBox?.x).toBeCloseTo(compositionFrameBox?.x ?? 0, 0)
      expect(stillBox?.y).toBeCloseTo(compositionFrameBox?.y ?? 0, 0)
      expect(stillBox?.width).toBeCloseTo(
        compositionFrameBox?.width ?? 0,
        0,
      )
      expect(stillBox?.height).toBeCloseTo(
        compositionFrameBox?.height ?? 0,
        0,
      )
      await expect(viewerHost).toHaveCSS('opacity', '1')
      const initialLoaderBox = await loader.boundingBox()
      await page.waitForTimeout(320)
      const delayedLoaderBox = await loader.boundingBox()
      expect(delayedLoaderBox?.height).toBe(initialLoaderBox?.height)

      await expect(museum).toHaveAttribute(
        'data-ready-animal-id',
        'stegosaurus',
        { timeout: 20_000 },
      )
      await expect(page.locator('.viewer-canvas')).toHaveAttribute(
        'data-first-frame-rendered',
        'true',
      )
      await expect(loader).toHaveCount(0)
      await expect(page.locator('.model-still')).toHaveCount(0)
      await expect(viewerHost).toHaveCSS('opacity', '1')
      await expectNoHorizontalOverflow(page)
    })
  }
})

test.describe('first-frame preview silhouette', () => {
  test.describe.configure({ mode: 'serial' })

  const previewViewports = [
    {
      height: 768,
      name: 'desktop-standard-1024x768',
      poster: 'preview-desktop-standard',
      profile: 'desktopStandard',
      width: 1024,
    },
    {
      height: 1024,
      name: 'tablet-portrait-768x1024',
      poster: 'preview-tablet-portrait',
      profile: 'tabletPortrait',
      width: 768,
    },
    {
      height: 1329,
      name: 'detail-tablet-portrait-844x1329',
      path: './en/animals/pachycephalosaurus/',
      poster: 'preview-tablet-portrait',
      profile: 'tabletPortrait',
      width: 844,
    },
  ] as const

  for (const viewport of previewViewports) {
    test(`${viewport.name} keeps Pachycephalosaurus aligned through its first reveal`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000)
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })

      let releaseModel: () => void = () => {
        throw new Error('The model request gate was not initialised.')
      }
      const modelGate = new Promise<void>((resolve) => {
        releaseModel = resolve
      })
      await page.route('**/*.glb', async (route) => {
        await modelGate
        await route.continue()
      })

      const response = await page.goto(
        'path' in viewport
          ? viewport.path
          : './en/?animal=pachycephalosaurus',
        { waitUntil: 'domcontentloaded' },
      )
      expect(response?.ok()).toBe(true)
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: 'Pachycephalosaurus',
        }),
      ).toBeVisible()

      await page.addStyleTag({
        content: `
          html,
          body,
          #root,
          .museum-page,
          .museum-experience,
          .stage-panel,
          .viewer-stage,
          .model-viewport,
          .viewer-host,
          .model-composition-frame {
            background: transparent !important;
          }
          html::before,
          html::after,
          body::before,
          body::after,
          .scene-background,
          .museum-experience > :not(.stage-panel),
          .stage-panel > :not(.viewer-stage),
          .stage-loading,
          .model-gesture-hint,
          .model-fallback {
            visibility: hidden !important;
          }
          .viewer-host::after {
            opacity: 0 !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }
        `,
      })

      const compositionFrame = page.locator('.model-composition-frame')
      const modelStill = page.locator('.model-still')
      const canvas = page.locator('.viewer-canvas')
      await expect(compositionFrame).toBeVisible()
      const stillCompositionBox = await compositionFrame.boundingBox()
      expect(stillCompositionBox).not.toBeNull()
      await expect(modelStill).toBeVisible()
      await expect(page.locator('.model-viewport')).toHaveAttribute(
        'data-preview-profile',
        viewport.profile,
      )
      await expect
        .poll(() =>
          page
            .locator('.model-still img')
            .evaluate((image) => {
              const source = Reflect.get(image, 'currentSrc') as string
              return image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0
                ? source
                : ''
            }),
        )
        .toContain(viewport.poster)
      await expect
        .poll(() =>
          canvas.evaluate(
            (element) =>
              typeof Reflect.get(
                element,
                '__museumReviewSetAnimationTime',
              ),
          ),
        )
        .toBe('function')

      const stillPng = await compositionFrame.screenshot({
        animations: 'disabled',
        omitBackground: true,
        scale: 'css',
        type: 'png',
      })

      releaseModel()
      await expect(page.locator('#museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'pachycephalosaurus',
        { timeout: 20_000 },
      )
      await expect(canvas).toHaveAttribute('data-first-frame-rendered', 'true')
      const frozeInitialFrame = await canvas.evaluate((element) => {
        const freeze = Reflect.get(
          element,
          '__museumReviewSetAnimationTime',
        ) as ((time: number | null) => boolean) | undefined
        return freeze?.(0) ?? false
      })
      expect(frozeInitialFrame).toBe(true)
      await expect(modelStill).toHaveCount(0)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )

      const webglCompositionBox = await compositionFrame.boundingBox()
      expect(webglCompositionBox).not.toBeNull()

      const webglPng = await compositionFrame.screenshot({
        animations: 'disabled',
        omitBackground: true,
        scale: 'css',
        type: 'png',
      })
      await testInfo.attach('static-preview', { body: stillPng, contentType: 'image/png' })
      await testInfo.attach('webgl-first-frame', { body: webglPng, contentType: 'image/png' })
      const [stillBounds, webglBounds] = await Promise.all([
        normalizedAlphaBounds(stillPng),
        normalizedAlphaBounds(webglPng),
      ])
      expect(
        stillBounds?.pixelCount ?? 0,
        `${viewport.name} static preview should contain visible pixels`,
      ).toBeGreaterThan(0)
      expect(
        webglBounds?.pixelCount ?? 0,
        `${viewport.name} WebGL frame should contain visible pixels`,
      ).toBeGreaterThan(0)
      if (!stillBounds || !webglBounds) {
        throw new Error(`${viewport.name} did not produce two silhouettes.`)
      }
      for (const bounds of [stillBounds, webglBounds]) {
        expect(
          bounds.width * bounds.height,
          `${viewport.name} capture must isolate the model, not an opaque page background`,
        ).toBeLessThan(0.95)
      }
      if (!stillCompositionBox || !webglCompositionBox) {
        throw new Error(`${viewport.name} did not produce two composition boxes.`)
      }

      const diagnostics = JSON.stringify({
        stillBounds,
        stillCompositionBox,
        webglBounds,
        webglCompositionBox,
      })
      await testInfo.attach('silhouette-measurements', { body: diagnostics, contentType: 'application/json' })
      for (const dimension of ['width', 'height'] as const) {
        expect(
          Math.abs(stillBounds[dimension] - webglBounds[dimension]),
          `${viewport.name} ${dimension} mismatch: ${diagnostics}`,
        ).toBeLessThanOrEqual(0.03)
      }
      for (const center of ['centerX', 'centerY'] as const) {
        expect(
          Math.abs(stillBounds[center] - webglBounds[center]),
          `${viewport.name} ${center} mismatch: ${diagnostics}`,
        ).toBeLessThanOrEqual(0.03)
      }
      expect(
        boundsIntersectionOverUnion(stillBounds, webglBounds),
        `${viewport.name} bounding-box IoU: ${diagnostics}`,
      ).toBeGreaterThanOrEqual(0.85)
      if (viewport.profile === 'tabletPortrait') {
        for (const bounds of [stillBounds, webglBounds]) {
          expect(
            bounds.visualCenterX,
            `${viewport.name} visual centre: ${diagnostics}`,
          ).toBeGreaterThanOrEqual(0.47)
          expect(
            bounds.visualCenterX,
            `${viewport.name} visual centre: ${diagnostics}`,
          ).toBeLessThanOrEqual(0.52)
        }
      }
      if ('path' in viewport) {
        for (const [bounds, box] of [
          [stillBounds, stillCompositionBox],
          [webglBounds, webglCompositionBox],
        ] as const) {
          const absoluteVisualCenterX =
            (box.x + bounds.visualCenterX * box.width) / viewport.width
          const absoluteVisualCenterY =
            (box.y + bounds.visualCenterY * box.height) / viewport.height
          expect(
            absoluteVisualCenterX,
            `${viewport.name} absolute horizontal centre: ${diagnostics}`,
          ).toBeGreaterThanOrEqual(0.47)
          expect(
            absoluteVisualCenterX,
            `${viewport.name} absolute horizontal centre: ${diagnostics}`,
          ).toBeLessThanOrEqual(0.52)
          expect(
            absoluteVisualCenterY,
            `${viewport.name} absolute vertical centre: ${diagnostics}`,
          ).toBeGreaterThanOrEqual(0.56)
          expect(
            absoluteVisualCenterY,
            `${viewport.name} absolute vertical centre: ${diagnostics}`,
          ).toBeLessThanOrEqual(0.62)
        }
      }
    })
  }
})

test.describe('required responsive viewports', () => {
  test.describe.configure({ mode: 'serial' })

  for (const viewport of requiredViewports) {
    test(`${viewport.name} has safe controls, rail, drawer, and model focus`, async ({
      page,
    }) => {
      test.setTimeout(60_000)
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      const museum = await openMuseum(page, '?fixtures=1')
      await expectNoHorizontalOverflow(page)
      await expectPrimaryTargetsAtLeast48Px(page)
      const focusButton = page.getByRole('button', { name: '专注看模型' })
      await focusButton.hover()
      const focusTooltipId = await focusButton.getAttribute('aria-describedby')
      expect(focusTooltipId).toBeTruthy()
      const focusTooltip = page.locator(`#${focusTooltipId ?? ''}`)
      await expect(focusTooltip).toBeVisible()
      await expectInsideViewport(focusTooltip, viewport)

      for (const name of ['上一只动物', '下一只动物']) {
        const step = page.getByRole('button', { name })
        await step.hover()
        const tooltipId = await step.getAttribute('aria-describedby')
        expect(tooltipId).toBeTruthy()
        const tooltip = page.locator(`#${tooltipId ?? ''}`)
        await expect(tooltip).toBeVisible()
        await expectInsideViewport(tooltip, viewport)
      }

      const stage = page.getByTestId('model-stage')
      const stageBox = await stage.boundingBox()
      const modelViewportBox = await page
        .locator('.model-viewport')
        .boundingBox()
      const compositionFrameBox = await page
        .locator('.model-composition-frame')
        .boundingBox()
      expect(stageBox).not.toBeNull()
      expect(modelViewportBox).not.toBeNull()
      expect(compositionFrameBox).not.toBeNull()
      const canvasBox = await page.locator('.viewer-canvas').boundingBox()
      expect(canvasBox).not.toBeNull()
      expect(canvasBox?.x).toBeCloseTo(modelViewportBox?.x ?? 0, 0)
      expect(canvasBox?.y).toBeCloseTo(modelViewportBox?.y ?? 0, 0)
      expect(canvasBox?.width).toBeCloseTo(
        modelViewportBox?.width ?? 0,
        0,
      )
      expect(canvasBox?.height).toBeCloseTo(
        modelViewportBox?.height ?? 0,
        0,
      )
      expect(modelViewportBox?.x ?? Number.POSITIVE_INFINITY).toBeCloseTo(0, 0)
      expect(modelViewportBox?.y ?? Number.POSITIVE_INFINITY).toBeCloseTo(0, 0)
      expect(modelViewportBox?.width ?? 0).toBeCloseTo(viewport.width, 0)
      expect(modelViewportBox?.height ?? 0).toBeCloseTo(viewport.height, 0)
      expect(compositionFrameBox?.x ?? -1).toBeGreaterThanOrEqual(
        (stageBox?.x ?? 0) - 1,
      )
      expect(compositionFrameBox?.y ?? -1).toBeGreaterThanOrEqual(
        (stageBox?.y ?? 0) - 1,
      )
      expect(
        (compositionFrameBox?.x ?? 0) + (compositionFrameBox?.width ?? 0),
      ).toBeLessThanOrEqual(
        (stageBox?.x ?? 0) + (stageBox?.width ?? 0) + 1,
      )
      expect(
        (compositionFrameBox?.y ?? 0) + (compositionFrameBox?.height ?? 0),
      ).toBeLessThanOrEqual(
        (stageBox?.y ?? 0) + (stageBox?.height ?? 0) + 1,
      )

      const intro = page.locator('.child-intro')
      await expect(intro).toBeVisible()
      const introLayout = await page.evaluate<{
        clientHeight: number
        scrollHeight: number
        textOverflow: string
        whiteSpace: string
      }>(`(() => {
        const element = document.querySelector('.child-intro')
        if (!(element instanceof HTMLElement)) {
          throw new Error('The child introduction is missing.')
        }
        const style = getComputedStyle(element)
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace
        }
      })()`)
      expect(introLayout.whiteSpace).toBe('normal')
      expect(introLayout.textOverflow).not.toBe('ellipsis')
      expect(introLayout.scrollHeight).toBeLessThanOrEqual(
        introLayout.clientHeight + 1,
      )

      if (
        viewport.width >= 768 &&
        viewport.width <= 1023 &&
        viewport.height > viewport.width
      ) {
        const storyPanelBox = await page.locator('.story-panel').boundingBox()
        const museumKickerBox = await page
          .locator('.museum-kicker')
          .boundingBox()
        const museumHeaderBox = await page
          .locator('.museum-header')
          .boundingBox()
        const creatorSignatureBox = await page
          .locator('.creator-signature-button')
          .boundingBox()
        const titleBox = await page.locator('.animal-title').boundingBox()
        const introBox = await intro.boundingBox()
        const animalEyebrowBox = await page
          .locator('.animal-eyebrow')
          .boundingBox()
        const storyActionsBox = await page
          .locator('.story-actions')
          .boundingBox()
        const stageActionsBox = await page
          .locator('.stage-actions')
          .boundingBox()

        expect(storyPanelBox).not.toBeNull()
        expect(museumKickerBox).not.toBeNull()
        expect(museumHeaderBox).not.toBeNull()
        expect(creatorSignatureBox).not.toBeNull()
        expect(titleBox).not.toBeNull()
        expect(introBox).not.toBeNull()
        expect(animalEyebrowBox).not.toBeNull()
        expect(storyActionsBox).not.toBeNull()
        expect(stageActionsBox).not.toBeNull()
        expect(storyPanelBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(
          180,
        )
        expect(
          Math.abs((museumKickerBox?.x ?? 0) - (titleBox?.x ?? 0)),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            (museumKickerBox?.y ?? 0) + (museumKickerBox?.height ?? 0) / 2 -
              ((creatorSignatureBox?.y ?? 0) +
                (creatorSignatureBox?.height ?? 0) / 2),
          ),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            (museumHeaderBox?.y ?? 0) + (museumHeaderBox?.height ?? 0) / 2 -
              ((museumKickerBox?.y ?? 0) +
                (museumKickerBox?.height ?? 0) / 2),
          ),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            (museumHeaderBox?.y ?? 0) + (museumHeaderBox?.height ?? 0) / 2 -
              ((animalEyebrowBox?.y ?? 0) +
                (animalEyebrowBox?.height ?? 0) / 2),
          ),
        ).toBeLessThanOrEqual(1)
        const creatorGap =
          (creatorSignatureBox?.x ?? 0) -
          ((museumKickerBox?.x ?? 0) + (museumKickerBox?.width ?? 0))
        expect(creatorGap).toBeGreaterThanOrEqual(8)
        expect(creatorGap).toBeLessThanOrEqual(12)
        expect(titleBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
          (introBox?.y ?? 0) + (introBox?.height ?? 0),
        )
        expect(introBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
          (titleBox?.y ?? 0) + (titleBox?.height ?? 0),
        )
        expect(
          Math.abs(
            (animalEyebrowBox?.x ?? 0) +
              (animalEyebrowBox?.width ?? 0) -
              ((storyActionsBox?.x ?? 0) + (storyActionsBox?.width ?? 0)),
          ),
        ).toBeLessThanOrEqual(1)
        expect(storyActionsBox?.y ?? -1).toBeGreaterThanOrEqual(
          (animalEyebrowBox?.y ?? 0) +
            (animalEyebrowBox?.height ?? 0) +
            4,
        )
        expect(stageActionsBox?.y ?? -1).toBeGreaterThanOrEqual(
          (storyPanelBox?.y ?? 0) + (storyPanelBox?.height ?? 0),
        )
      }

      if (viewport.width <= 767 && viewport.height > viewport.width) {
        const introTextBox = await page
          .locator('.child-intro > span')
          .boundingBox()
        const storyCardBox = await page.locator('.story-card').boundingBox()
        const introTextSize = await page.evaluate<{
          clientHeight: number
          lineHeight: number
          scrollHeight: number
        }>(`(() => {
          const element = document.querySelector('.child-intro > span')
          if (!(element instanceof HTMLElement)) {
            throw new Error('The child introduction text is missing.')
          }
          return {
            clientHeight: element.clientHeight,
            lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
            scrollHeight: element.scrollHeight
          }
        })()`)
        const storyActionsBox = await page
          .locator('.story-actions')
          .boundingBox()
        const animalNavigationBox = await page
          .locator('.animal-navigation')
          .boundingBox()
        expect(introTextBox).not.toBeNull()
        expect(storyCardBox).not.toBeNull()
        expect(storyActionsBox).not.toBeNull()
        expect(animalNavigationBox).not.toBeNull()
        expect(introTextSize.scrollHeight).toBeLessThanOrEqual(
          introTextSize.clientHeight + 1,
        )
        expect(
          Math.abs(
            (storyActionsBox?.width ?? 0) -
              (animalNavigationBox?.width ?? 0),
          ),
        ).toBeLessThanOrEqual(1)
        if (viewport.width >= 600) {
          expect(introTextSize.scrollHeight).toBeLessThanOrEqual(
            Math.ceil(introTextSize.lineHeight) + 1,
          )
        }
        expect(introTextBox?.x ?? -1).toBeGreaterThanOrEqual(
          storyCardBox?.x ?? 0,
        )
        expect(introTextBox?.y ?? -1).toBeGreaterThanOrEqual(
          storyCardBox?.y ?? 0,
        )
        expect(
          (introTextBox?.x ?? 0) + (introTextBox?.width ?? 0),
        ).toBeLessThanOrEqual(
          (storyCardBox?.x ?? 0) + (storyCardBox?.width ?? 0) + 1,
        )
        expect(
          (introTextBox?.y ?? 0) + (introTextBox?.height ?? 0),
        ).toBeLessThanOrEqual(
          (storyCardBox?.y ?? 0) + (storyCardBox?.height ?? 0) + 1,
        )

        const stageActionsBox = await page
          .locator('.stage-actions')
          .boundingBox()
        expect(stageActionsBox).not.toBeNull()
        expect(stageActionsBox?.width ?? 0).toBeGreaterThan(
          stageActionsBox?.height ?? Number.POSITIVE_INFINITY,
        )
        expect(stageActionsBox?.y ?? -1).toBeGreaterThanOrEqual(
          (stageBox?.y ?? 0) - 2,
        )
        expect(stageActionsBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
          (stageBox?.y ?? 0) + 80,
        )

        const bottomInset =
          viewport.height -
          ((animalNavigationBox?.y ?? 0) +
            (animalNavigationBox?.height ?? 0))
        expect(bottomInset).toBeGreaterThanOrEqual(0)
        expect(bottomInset).toBeLessThanOrEqual(3)
      }

      const animalNameLayouts = await page.evaluate<
        Array<{
          clientWidth: number
          labelTop: number
          lineCount: number
          name: string
          scrollWidth: number
          thumbnailBottom: number
        }>
      >(`(() =>
        Array.from(document.querySelectorAll('.animal-card strong')).map(
          (label) => {
            const range = document.createRange()
            range.selectNodeContents(label)
            const thumbnail = label.parentElement?.querySelector(
              '.thumbnail-frame',
            )
            return {
              clientWidth: label.clientWidth,
              labelTop: label.getBoundingClientRect().top,
              lineCount: range.getClientRects().length,
              name: label.textContent ?? '',
              scrollWidth: label.scrollWidth,
              thumbnailBottom:
                thumbnail?.getBoundingClientRect().bottom ??
                Number.POSITIVE_INFINITY,
            }
          },
        )
      )()`)
      expect(animalNameLayouts.length).toBeGreaterThan(0)
      expect(
        animalNameLayouts.every(({ lineCount }) => lineCount === 1),
      ).toBe(true)
      expect(
        animalNameLayouts.filter(
          ({ clientWidth, scrollWidth }) => scrollWidth > clientWidth + 1,
        ),
        JSON.stringify({ viewport, animalNameLayouts }),
      ).toEqual([])
      expect(
        animalNameLayouts.every(
          ({ labelTop, thumbnailBottom }) => thumbnailBottom <= labelTop,
        ),
      ).toBe(true)

      const rail = page.locator('.animal-rail')
      await expect(rail).toBeVisible()
      const railDimensions = await page.evaluate<{
        clientHeight: number
        clientWidth: number
        scrollHeight: number
        scrollWidth: number
      }>(`(() => {
          const element = document.querySelector('.animal-rail')
          return {
            clientHeight: element?.clientHeight ?? 0,
            clientWidth: element?.clientWidth ?? 0,
            scrollHeight: element?.scrollHeight ?? 0,
            scrollWidth: element?.scrollWidth ?? 0
          }
        })()`)
      expect(railDimensions.clientHeight).toBeGreaterThan(0)
      expect(railDimensions.clientWidth).toBeGreaterThan(0)
      expect(railDimensions.scrollHeight).toBeGreaterThanOrEqual(
        railDimensions.clientHeight,
      )
      expect(railDimensions.scrollWidth).toBeGreaterThanOrEqual(
        railDimensions.clientWidth,
      )

      const landscapePhone =
        viewport.height <= 500 && viewport.width > viewport.height
      if (landscapePhone) {
        const navigationBox = await page
          .locator('.animal-navigation')
          .boundingBox()
        const selectedCardBox = await page
          .locator('.animal-card[data-selected="true"]')
          .boundingBox()
        expect(navigationBox).not.toBeNull()
        expect(selectedCardBox).not.toBeNull()
        expect(navigationBox?.width ?? 0).toBeGreaterThan(
          navigationBox?.height ?? Number.POSITIVE_INFINITY,
        )
        expect(selectedCardBox?.y ?? -1).toBeGreaterThanOrEqual(
          navigationBox?.y ?? 0,
        )
        expect(
          (selectedCardBox?.y ?? 0) + (selectedCardBox?.height ?? 0),
        ).toBeLessThanOrEqual(
          (navigationBox?.y ?? 0) + (navigationBox?.height ?? 0) + 1,
        )
      }

      const lastCard = page.getByRole('button', { name: '查看再试龙' })
      await lastCard.scrollIntoViewIfNeeded()
      await expect(lastCard).toBeInViewport()
      await lastCard.focus()
      await expect(lastCard).toBeFocused()
      if (railDimensions.scrollWidth > railDimensions.clientWidth + 1) {
        expect(
          await page.evaluate<number>(`(() => {
            const element = document.querySelector('.animal-rail')
            if (!element) {
              return 0
            }
            element.scrollLeft = element.scrollWidth
            return element.scrollLeft
          })()`),
        ).toBeGreaterThan(0)
      }

      await page.getByRole('button', { name: '给家长的资料' }).click()
      const drawer = page.getByRole('dialog', { name: '给家长的资料' })
      await expect(drawer).toBeVisible()
      await expect(
        page.getByRole('region', {
          name: '动物选择',
          includeHidden: true,
        }),
      ).toHaveAttribute('inert', '')
      await expect(stage).toHaveAttribute('aria-hidden', 'true')
      await expect(stage).toHaveAttribute('inert', '')
      const drawerBox = await drawer.boundingBox()
      expect(drawerBox).not.toBeNull()
      await expect
        .poll(async () => {
          const settledBox = await drawer.boundingBox()
          return Boolean(
            settledBox &&
            settledBox.y >= 0 &&
            settledBox.x + settledBox.width <= viewport.width + 1 &&
            settledBox.y + settledBox.height <= viewport.height + 1,
          )
        })
        .toBe(true)
      const settledDrawerBox = await drawer.boundingBox()
      expect(settledDrawerBox?.y ?? -1).toBeGreaterThanOrEqual(0)
      expect(
        (settledDrawerBox?.x ?? 0) + (settledDrawerBox?.width ?? 0),
      ).toBeLessThanOrEqual(viewport.width + 1)
      expect(
        (settledDrawerBox?.y ?? 0) + (settledDrawerBox?.height ?? 0),
      ).toBeLessThanOrEqual(viewport.height + 1)
      if (viewport.width >= 1024 || viewport.width > viewport.height) {
        await expect(drawer).toHaveCSS('animation-name', 'drawer-enter-side')
        expect(settledDrawerBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          18,
        )
        expect(
          (settledDrawerBox?.x ?? 0) + (settledDrawerBox?.width ?? 0),
        ).toBeLessThan(viewport.width * 0.56)
        await expect(page.locator('.drawer-layer:not([hidden]) > .drawer-backdrop')).toHaveCSS(
          'backdrop-filter',
          'none',
        )
      } else {
        await expect(drawer).toHaveCSS('animation-name', 'drawer-enter')
      }
      await page.getByRole('button', { name: '关闭家长资料' }).click()

      await page.getByRole('button', { name: '专注看模型' }).click()
      const exit = page.getByRole('button', { name: '退出模型专注模式' })
      await expect(exit).toBeVisible()
      await expect(page.getByRole('heading', { name: '剑龙' })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '动物选择' })).toHaveCount(0)
      await expect(page.locator('button:visible')).toHaveCount(2)
      await expect(page.locator('.model-gesture-hint')).toBeHidden()
      const focusedStageBox = await stage.boundingBox()
      expect(focusedStageBox).not.toBeNull()
      expect(focusedStageBox?.x).toBeCloseTo(0, 0)
      expect(focusedStageBox?.y).toBeCloseTo(0, 0)
      expect(focusedStageBox?.width).toBeCloseTo(viewport.width, 0)
      expect(focusedStageBox?.height).toBeCloseTo(viewport.height, 0)
      await expectPrimaryTargetsAtLeast48Px(page)

      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: '剑龙' })).toBeVisible()
      await expect(page.getByRole('region', { name: '动物选择' })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await page.evaluate(() => {
        Object.defineProperty(window, '__responsiveLocaleCanvas', {
          configurable: true,
          value: document.querySelector('.viewer-canvas'),
        })
      })
      await switchToEnglish(page)
      await expect(museum).toHaveAttribute(
        'data-ready-animal-id',
        'stegosaurus',
      )
      expect(
        await page.evaluate(
          () =>
            (
              window as typeof window & {
                __responsiveLocaleCanvas: Element | null
              }
            ).__responsiveLocaleCanvas ===
            document.querySelector('.viewer-canvas'),
        ),
      ).toBe(true)
      await expectEnglishResponsiveLayout(page, viewport)
    })
  }
})
