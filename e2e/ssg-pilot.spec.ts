import { mainCollection } from '../src/content/collections/main'
import { expect, test, type Page } from '@playwright/test'

const nestedPath = '/prehistoric-animal-museum/'

const noJsDetailCases = [
  {
    animalId: 'stegosaurus',
    atmosphere: 'forest',
    introduction: '看看它背上的两排骨板，像不像一列起伏的小山？',
    locale: 'zh-CN',
    museumName: '史前动物博物馆',
    name: '剑龙',
    siblingId: 'tyrannosaurus-rex',
  },
  {
    animalId: 'pachycephalosaurus',
    atmosphere: 'forest',
    introduction:
      'Look at its round, bony dome and the little bumps around it. Does it look like a small, round hat?',
    locale: 'en',
    museumName: 'Prehistoric Animal Museum',
    name: 'Pachycephalosaurus',
    siblingId: 'pteranodon',
  },
  {
    animalId: 'pteranodon',
    atmosphere: 'air',
    introduction: '看看它长长的无齿嘴巴、头后的冠和展开的大翅膀。',
    locale: 'zh-CN',
    museumName: '史前动物博物馆',
    name: '无齿翼龙',
    siblingId: 'tupandactylus',
  },
  {
    animalId: 'mosasaurus',
    atmosphere: 'underwater',
    introduction:
      'Look at its flippers and powerful tail. Can you imagine its tail pushing it forwards while the flippers steer?',
    locale: 'en',
    museumName: 'Prehistoric Animal Museum',
    name: 'Mosasaurus',
    siblingId: 'megalodon',
  },
] as const

const backToMuseumViewports = [
  { height: 568, hidesLabel: false, name: 'minimum phone portrait', width: 320 },
  { height: 800, hidesLabel: false, name: 'compact phone edge', width: 370 },
  { height: 800, hidesLabel: false, name: 'compact phone edge plus one', width: 371 },
  { height: 1024, hidesLabel: false, name: 'mobile upper edge', width: 767 },
  { height: 1024, hidesLabel: false, name: 'tablet lower edge', width: 768 },
  { height: 1365, hidesLabel: false, name: 'tablet upper edge', width: 1023 },
  { height: 768, hidesLabel: false, name: 'desktop lower edge', width: 1024 },
  { height: 720, hidesLabel: false, name: 'wide desktop', width: 1280 },
  { height: 320, hidesLabel: true, name: 'minimum compact landscape', width: 568 },
  { height: 390, hidesLabel: true, name: 'wide compact landscape', width: 844 },
] as const

function collectHydrationErrors(page: Page): string[] {
  const hydrationErrors: string[] = []
  page.on('console', (message) => {
    if (/hydration|hydrated|didn.t match/i.test(message.text())) {
      hydrationErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    if (/hydration|hydrated|didn.t match/i.test(error.message)) {
      hydrationErrors.push(error.message)
    }
  })
  return hydrationErrors
}

test('hydrates the real English museum first frame without replacing it', async ({
  page,
}) => {
  const hydrationErrors = collectHydrationErrors(page)
  await page.route('**/*.glb*', (route) => route.abort())

  const response = await page.goto('./en/')
  expect(response?.status()).toBe(200)
  const source = await response?.text()
  expect(source).toContain('id="museum-experience"')
  expect(source).toContain('data-locale="en"')
  expect(source).not.toContain('class="seo-static-shell"')

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Prehistoric Animal Museum',
    }),
  ).toBeVisible()
  await expect(page.locator('a[data-animal-detail-link]')).toHaveCount(mainCollection.animalIds.length)
  await expect(
    page.locator('a[data-animal-detail-link][data-animal-id="mosasaurus"]'),
  ).toHaveAttribute('href', './animals/mosasaurus/')
  await page.getByRole('button', { name: 'Guide for grown-ups' }).click()
  await expect(page.getByText('Late Jurassic', { exact: true })).toBeVisible()
  expect(hydrationErrors).toEqual([])
})

for (const detailCase of noJsDetailCases) {
  test(`serves the ${detailCase.locale} ${detailCase.animalId} museum deep link with useful no-JS content`, async ({
    baseURL,
    browser,
  }) => {
    if (!baseURL) {
      throw new Error('Playwright baseURL is required.')
    }
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      const response = await page.goto(
        `${baseURL}${detailCase.locale}/animals/${detailCase.animalId}/`,
      )
      expect(response?.status()).toBe(200)
      const source = await response?.text()
      expect(source).toContain('id="museum-experience"')
      expect(source).toContain('data-page-kind="animal-detail"')
      expect(source).toContain(
        `data-requested-animal-id="${detailCase.animalId}"`,
      )
      expect(source).not.toContain('class="animal-page"')
      expect(source).not.toContain('seo-static-shell')

      const museum = page.locator('#museum-experience')
      await expect(museum).toBeVisible()
      await expect(museum).toHaveAttribute('data-locale', detailCase.locale)
      await expect(museum).toHaveAttribute(
        'data-atmosphere',
        detailCase.atmosphere,
      )
      await expect(museum).toHaveAttribute(
        'data-page-kind',
        'animal-detail',
      )
      await expect(
        page.getByRole('heading', { level: 1, name: detailCase.name }),
      ).toBeVisible()
      await expect(page.locator('.museum-kicker')).toContainText(
        detailCase.museumName,
      )
      await expect(
        page.getByText(detailCase.introduction, { exact: true }),
      ).toBeVisible()
      await expect(page.locator('.animal-card[data-animal-id]')).toHaveCount(mainCollection.animalIds.length)
      await expect(page.locator('script[type="module"][src]')).toHaveCount(1)

      const still = page.locator('.model-still img')
      await expect(still).toBeVisible()
      await expect
        .poll(() => still.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0)

      await expect(page.locator('[data-museum-return]')).toHaveAttribute(
        'href',
        `../../../${detailCase.locale}/?animal=${detailCase.animalId}`,
      )
      await expect(
        page.locator(
          `[data-animal-detail-link][data-animal-id="${detailCase.siblingId}"]`,
        ),
      ).toHaveAttribute('href', `../${detailCase.siblingId}/`)
    } finally {
      await context.close()
    }
  })
}

test('hydrates a requested detail without flashing the default animal and exits its route when another animal is chosen', async ({
  page,
}) => {
  const hydrationErrors = collectHydrationErrors(page)
  await page.addInitScript(() => {
    const titleHistory: string[] = []
    Object.defineProperty(window, '__museumAnimalTitleHistory', {
      configurable: true,
      value: titleHistory,
    })
    const recordTitle = () => {
      const title = document.querySelector('.animal-title')?.textContent?.trim()
      if (title && titleHistory.at(-1) !== title) {
        titleHistory.push(title)
      }
    }
    new MutationObserver(recordTitle).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    document.addEventListener('DOMContentLoaded', recordTitle, { once: true })
  })
  await page.route('**/*.glb*', (route) => route.abort())

  const response = await page.goto('./en/animals/mosasaurus/')
  expect(response?.status()).toBe(200)
  expect(await response?.text()).toContain(
    'data-requested-animal-id="mosasaurus"',
  )
  await page.waitForLoadState('load')

  const museum = page.locator('#museum-experience')
  await expect(museum).toHaveAttribute('data-page-kind', 'animal-detail')
  await expect(museum).toHaveAttribute(
    'data-requested-animal-id',
    'mosasaurus',
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mosasaurus' }),
  ).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(
    `${nestedPath}en/animals/mosasaurus/`,
  )
  expect(new URL(page.url()).search).toBe('')

  const titleHistory = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __museumAnimalTitleHistory: string[]
        }
      ).__museumAnimalTitleHistory,
  )
  expect(titleHistory).toContain('Mosasaurus')
  expect(titleHistory).not.toContain('Stegosaurus')
  expect(hydrationErrors).toEqual([])

  await page
    .locator(
      '[data-animal-detail-link][data-animal-id="tyrannosaurus-rex"]',
    )
    .click()
  await expect(page).toHaveURL(
    new RegExp(`${nestedPath}en/\\?animal=tyrannosaurus-rex$`),
  )
  await expect(museum).toHaveAttribute('data-page-kind', 'museum')
})

test('normalizes a refreshed museum query to the matching static animal without flashing the default exhibit', async ({
  page,
}) => {
  const hydrationErrors = collectHydrationErrors(page)
  await page.addInitScript(() => {
    const titleHistory: string[] = []
    Object.defineProperty(window, '__museumAnimalTitleHistory', {
      configurable: true,
      value: titleHistory,
    })
    const recordTitle = () => {
      const title = document.querySelector('.animal-title')?.textContent?.trim()
      if (title && titleHistory.at(-1) !== title) {
        titleHistory.push(title)
      }
    }
    new MutationObserver(recordTitle).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    document.addEventListener('DOMContentLoaded', recordTitle, { once: true })
  })
  const requestedModels: string[] = []
  await page.route('**/*.glb*', (route) => {
    requestedModels.push(route.request().url())
    return route.abort()
  })

  await page.goto('./en/?animal=pachycephalosaurus')
  await page.waitForURL('**/en/animals/pachycephalosaurus/')

  const museum = page.locator('#museum-experience')
  await expect(museum).toHaveAttribute('data-page-kind', 'animal-detail')
  await expect(museum).toHaveAttribute(
    'data-requested-animal-id',
    'pachycephalosaurus',
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pachycephalosaurus' }),
  ).toBeVisible()
  await expect(page.locator('.model-still img')).toHaveAttribute(
    'alt',
    'Still model of Pachycephalosaurus on a transparent background',
  )

  const titleHistory = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __museumAnimalTitleHistory: string[]
        }
      ).__museumAnimalTitleHistory,
  )
  expect(titleHistory).toContain('Pachycephalosaurus')
  expect(titleHistory).not.toContain('Stegosaurus')
  expect(
    requestedModels.some((url) => url.includes('/stegosaurus/')),
  ).toBe(false)
  expect(hydrationErrors).toEqual([])
})

test('shows the default Chinese museum immediately when the edge redirect fails open', async ({
  page,
}) => {
  const response = await page.goto('.')
  expect(response?.status()).toBe(200)
  await expect(page.locator('.seo-static-shell')).toHaveCount(0)
  await expect(page.locator('#museum-experience')).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 1, name: '史前动物博物馆' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '切换语言，当前简体中文' }),
  ).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://leon-made-this.work/museum/zh-CN/',
  )
})

test('persists a detail language choice and keeps the equivalent animal route', async ({
  page,
}) => {
  await page.route('**/*.glb*', (route) => route.abort())
  await page.goto('./en/animals/mosasaurus/')
  await page.waitForLoadState('load')
  await page
    .getByRole('button', { name: 'Change language, current English' })
    .click()
  await page
    .getByRole('menuitemradio', { name: '简体中文', exact: true })
    .click()

  await expect(page).toHaveURL(/\/zh-CN\/animals\/mosasaurus\/$/)
  await expect(
    page.getByRole('heading', { level: 1, name: '沧龙' }),
  ).toBeVisible()
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-page-kind',
    'animal-detail',
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://leon-made-this.work/museum/zh-CN/animals/mosasaurus/',
  )
  await expect(
    page.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute(
    'href',
    'https://leon-made-this.work/museum/en/animals/mosasaurus/',
  )
  const structuredData = JSON.parse(
    (await page.locator('#animal-structured-data').textContent()) ?? '{}',
  ) as { inLanguage?: string; name?: string; url?: string }
  expect(structuredData).toMatchObject({
    inLanguage: 'zh-CN',
    name: '沧龙',
    url: 'https://leon-made-this.work/museum/zh-CN/animals/mosasaurus/',
  })

  const localeCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'museum_locale',
  )
  expect(localeCookie).toMatchObject({
    value: 'zh-CN',
    path: nestedPath.slice(0, -1),
    secure: true,
    sameSite: 'Lax',
  })
})

test('returns from a direct detail deep link to the matching museum exhibit and opens the full guide', async ({
  page,
}) => {
  await page.route('**/*.glb*', (route) => route.abort())
  await page.goto('./en/animals/mosasaurus/')
  await page.waitForLoadState('load')

  const returnLink = page.locator('a[data-museum-return]')
  await expect(returnLink).toHaveAttribute(
    'href',
    '../../../en/?animal=mosasaurus',
  )
  await returnLink.click()

  await expect(page).toHaveURL(new RegExp(`${nestedPath}en/\\?animal=mosasaurus$`))
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-page-kind',
    'museum',
  )
  await expect(page.locator('.museum-kicker')).toContainText(
    'Prehistoric Animal Museum',
  )
  await expect(page.locator('.animal-title')).toHaveText('Mosasaurus')
  await expect(page.locator('.museum-kicker')).toHaveJSProperty(
    'tagName',
    'H1',
  )
  await expect(page.locator('.animal-title')).toHaveJSProperty(
    'tagName',
    'H2',
  )
  await expect(
    page.getByRole('dialog', { name: 'Museum guide' }),
  ).toBeVisible()
})

test('keeps the English Back to museum action contained at responsive boundaries', async ({
  page,
}) => {
  await page.route('**/*.glb*', (route) => route.abort())
  await page.setViewportSize(backToMuseumViewports[0])
  const response = await page.goto('./en/animals/pachycephalosaurus/')
  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pachycephalosaurus' }),
  ).toBeVisible()

  const returnLink = page.getByRole('link', {
    name: 'Return to the museum and open the full guide',
  })
  await expect(returnLink).toBeVisible()

  for (const viewport of backToMuseumViewports) {
    await page.setViewportSize(viewport)
    await page.evaluate(
      () =>
        document.fonts.ready.then(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            }),
        ),
    )

    const layout = await returnLink.evaluate((link) => {
      const actions = link.closest('.story-actions')
      const animalTitle = document.querySelector('.animal-title')
      const introText = document.querySelector('.child-intro > span')
      const storyCard = document.querySelector('.story-card')
      const storyPanel = document.querySelector('.story-panel')
      const label = link.querySelector(':scope > span')
      if (
        !(actions instanceof HTMLElement) ||
        !(animalTitle instanceof HTMLElement) ||
        !(introText instanceof HTMLElement) ||
        !(label instanceof HTMLElement) ||
        !(storyCard instanceof HTMLElement) ||
        !(storyPanel instanceof HTMLElement)
      ) {
        throw new Error('The Back to museum action is incomplete.')
      }
      const actionsBox = actions.getBoundingClientRect()
      const labelStyle = getComputedStyle(label)
      const linkBox = link.getBoundingClientRect()
      const panelBox = storyPanel.getBoundingClientRect()
      const panelStyle = getComputedStyle(storyPanel)
      const panelInnerWidth =
        panelBox.width -
        Number.parseFloat(panelStyle.paddingLeft) -
        Number.parseFloat(panelStyle.paddingRight)
      const storyCardBox = storyCard.getBoundingClientRect()
      const titleStyle = getComputedStyle(animalTitle)
      const titleRange = document.createRange()
      titleRange.selectNodeContents(animalTitle)
      const titleTextBox = titleRange.getBoundingClientRect()
      const titleLineCount = new Set(
        Array.from(titleRange.getClientRects()).map((line) =>
          Math.round(line.top),
        ),
      ).size
      const introStyle = getComputedStyle(introText)
      const introRange = document.createRange()
      introRange.selectNodeContents(introText)
      const introTextBox = introRange.getBoundingClientRect()
      const introLineCount = new Set(
        Array.from(introRange.getClientRects()).map((line) =>
          Math.round(line.top),
        ),
      ).size
      const labelVisible = labelStyle.display !== 'none'
      const textRange = document.createRange()
      textRange.selectNodeContents(label)
      const textBox = labelVisible ? textRange.getBoundingClientRect() : null
      const textLineCount = labelVisible
        ? new Set(
            Array.from(textRange.getClientRects()).map((line) =>
              Math.round(line.top),
            ),
          ).size
        : 0

      return {
        actionsBottom: actionsBox.bottom,
        actionsLeft: actionsBox.left,
        actionsRight: actionsBox.right,
        actionsTop: actionsBox.top,
        actionsWidth: actionsBox.width,
        documentScrollWidth: document.documentElement.scrollWidth,
        labelDisplay: labelStyle.display,
        linkBottom: linkBox.bottom,
        linkClientHeight: link.clientHeight,
        linkClientWidth: link.clientWidth,
        linkHeight: linkBox.height,
        linkLeft: linkBox.left,
        linkRight: linkBox.right,
        linkScrollHeight: link.scrollHeight,
        linkScrollWidth: link.scrollWidth,
        linkTop: linkBox.top,
        linkWidth: linkBox.width,
        panelInnerWidth,
        introFontSize: Number.parseFloat(introStyle.fontSize),
        introLineCount,
        introTextBottom: introTextBox.bottom,
        introTextLeft: introTextBox.left,
        introTextRight: introTextBox.right,
        introTextTop: introTextBox.top,
        storyCardBottom: storyCardBox.bottom,
        storyCardLeft: storyCardBox.left,
        storyCardRight: storyCardBox.right,
        storyCardTop: storyCardBox.top,
        storyCardWidth: storyCardBox.width,
        titleFontSize: Number.parseFloat(titleStyle.fontSize),
        titleLineCount,
        titleTextBottom: titleTextBox.bottom,
        titleTextLeft: titleTextBox.left,
        titleTextRight: titleTextBox.right,
        titleTextTop: titleTextBox.top,
        textBottom: textBox?.bottom ?? null,
        textLeft: textBox?.left ?? null,
        textLineCount,
        textOverflow: labelStyle.textOverflow,
        textRight: textBox?.right ?? null,
        textTop: textBox?.top ?? null,
        viewportWidth: document.documentElement.clientWidth,
      }
    })

    expect(
      layout.linkWidth,
      `${viewport.name}: link width`,
    ).toBeGreaterThanOrEqual(48)
    expect(
      layout.linkHeight,
      `${viewport.name}: link height`,
    ).toBeGreaterThanOrEqual(48)
    expect(
      layout.linkScrollWidth,
      `${viewport.name}: link must not clip horizontally`,
    ).toBeLessThanOrEqual(layout.linkClientWidth + 1)
    expect(
      layout.linkScrollHeight,
      `${viewport.name}: link must not clip vertically`,
    ).toBeLessThanOrEqual(layout.linkClientHeight + 1)
    expect(layout.linkLeft, `${viewport.name}: link left`).toBeGreaterThanOrEqual(
      layout.actionsLeft - 1,
    )
    expect(layout.linkTop, `${viewport.name}: link top`).toBeGreaterThanOrEqual(
      layout.actionsTop - 1,
    )
    expect(layout.linkRight, `${viewport.name}: link right`).toBeLessThanOrEqual(
      layout.actionsRight + 1,
    )
    expect(
      layout.linkBottom,
      `${viewport.name}: link bottom`,
    ).toBeLessThanOrEqual(layout.actionsBottom + 1)
    expect(
      layout.documentScrollWidth,
      `${viewport.name}: page must not overflow horizontally`,
    ).toBeLessThanOrEqual(layout.viewportWidth + 1)

    if (
      viewport.width >= 768 &&
      viewport.width <= 1023 &&
      viewport.height > viewport.width
    ) {
      expect(
        layout.storyCardWidth / layout.panelInnerWidth,
        `${viewport.name}: story copy must retain at least half of the card`,
      ).toBeGreaterThanOrEqual(0.52)
      expect(
        layout.actionsWidth / layout.panelInnerWidth,
        `${viewport.name}: actions must not squeeze the story copy`,
      ).toBeLessThanOrEqual(0.44)
      expect(
        layout.titleFontSize,
        `${viewport.name}: title font`,
      ).toBeGreaterThanOrEqual(32)
      expect(
        layout.introFontSize,
        `${viewport.name}: intro font`,
      ).toBeGreaterThanOrEqual(14)
      expect(layout.titleLineCount, `${viewport.name}: title lines`).toBe(1)
      expect(
        layout.introLineCount,
        `${viewport.name}: intro lines`,
      ).toBeLessThanOrEqual(3)
      for (const [edge, value, boundary] of [
        ['title left', layout.titleTextLeft, layout.storyCardLeft],
        ['title top', layout.titleTextTop, layout.storyCardTop],
        ['intro left', layout.introTextLeft, layout.storyCardLeft],
        ['intro top', layout.introTextTop, layout.storyCardTop],
      ] as const) {
        expect(value, `${viewport.name}: ${edge}`).toBeGreaterThanOrEqual(
          boundary - 1,
        )
      }
      for (const [edge, value, boundary] of [
        ['title right', layout.titleTextRight, layout.storyCardRight],
        ['title bottom', layout.titleTextBottom, layout.storyCardBottom],
        ['intro right', layout.introTextRight, layout.storyCardRight],
        ['intro bottom', layout.introTextBottom, layout.storyCardBottom],
      ] as const) {
        expect(value, `${viewport.name}: ${edge}`).toBeLessThanOrEqual(
          boundary + 1,
        )
      }
    }

    if (viewport.hidesLabel) {
      expect(layout.labelDisplay, `${viewport.name}: compact label`).toBe('none')
      expect(layout.textLineCount).toBe(0)
      continue
    }

    expect(layout.labelDisplay, `${viewport.name}: visible label`).not.toBe(
      'none',
    )
    expect(layout.textOverflow).not.toBe('ellipsis')
    expect(layout.textLineCount).toBeGreaterThanOrEqual(1)
    expect(layout.textLineCount).toBeLessThanOrEqual(2)
    expect(layout.textLeft ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      layout.linkLeft - 1,
    )
    expect(layout.textTop ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      layout.linkTop - 1,
    )
    expect(layout.textRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      layout.linkRight + 1,
    )
    expect(layout.textBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      layout.linkBottom + 1,
    )
  }
})

test('uses an explicit CSR boundary for E2E fixtures without hydration recovery', async ({
  page,
}) => {
  const hydrationErrors = collectHydrationErrors(page)

  await page.goto('./zh-CN/?fixtures=1')
  await expect(page.locator('.animal-card[data-animal-id]')).toHaveCount(mainCollection.animalIds.length + 3)
  expect(hydrationErrors).toEqual([])
})
