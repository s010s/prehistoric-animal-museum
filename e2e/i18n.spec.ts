import { expect, test, type Locator, type Page } from '@playwright/test'
import { mainCollection } from '../src/content/collections/main'

const nestedPath = '/prehistoric-animal-museum/'
const localeStorageKey = 'museum.locale'

const responsiveStoryViewports = [
  { name: 'minimum phone portrait', width: 320, height: 568 },
  { name: 'compact phone breakpoint', width: 370, height: 800 },
  { name: 'compact phone breakpoint plus one', width: 371, height: 800 },
  { name: 'large phone portrait', width: 430, height: 932 },
  { name: 'small tablet portrait', width: 600, height: 960 },
  { name: 'mobile layout upper edge', width: 767, height: 1024 },
  { name: 'tablet layout lower edge', width: 768, height: 1024 },
  { name: 'tablet portrait 820', width: 820, height: 1180 },
  { name: 'tablet portrait 912', width: 912, height: 1368 },
  { name: 'reported Retina layout', width: 978, height: 1329 },
  { name: 'tablet layout upper edge', width: 1023, height: 1365 },
  { name: 'desktop layout lower edge portrait', width: 1024, height: 1366 },
  { name: 'square tablet', width: 1023, height: 1023 },
  { name: 'desktop compact upper edge portrait', width: 1279, height: 1706 },
  { name: 'desktop wide lower edge portrait', width: 1280, height: 1707 },
  { name: 'minimum phone landscape', width: 568, height: 320 },
  { name: 'phone landscape 667', width: 667, height: 375 },
  { name: 'phone landscape 844', width: 844, height: 390 },
  { name: 'large phone landscape', width: 932, height: 430 },
  { name: 'compact landscape old edge', width: 1023, height: 500 },
  { name: 'compact landscape old edge plus one', width: 1023, height: 501 },
  { name: 'compact landscape upper edge', width: 1023, height: 560 },
  { name: 'compact landscape upper edge plus one', width: 1023, height: 561 },
  { name: 'desktop compact height', width: 1024, height: 500 },
  { name: 'desktop compact height plus one', width: 1024, height: 501 },
  { name: 'desktop compact upper edge', width: 1024, height: 560 },
  { name: 'desktop compact upper edge plus one', width: 1024, height: 561 },
  { name: 'tablet landscape', width: 1180, height: 820 },
  { name: 'desktop 1280', width: 1280, height: 800 },
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'desktop 1920', width: 1920, height: 1080 },
] as const

const responsiveEnglishStoryCases = [
  { animalId: 'ichthyosaur', heading: 'Ichthyosaurs' },
  { animalId: 'sauropelta', heading: 'Sauropelta' },
  { animalId: 'pachycephalosaurus', heading: 'Pachycephalosaurus' },
] as const

interface LayoutRect {
  readonly bottom: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly width: number
}

function expectRectInside(
  inner: LayoutRect,
  outer: LayoutRect,
  label: string,
): void {
  expect(inner.left, `${label} left`).toBeGreaterThanOrEqual(outer.left - 1)
  expect(inner.top, `${label} top`).toBeGreaterThanOrEqual(outer.top - 1)
  expect(inner.right, `${label} right`).toBeLessThanOrEqual(outer.right + 1)
  expect(inner.bottom, `${label} bottom`).toBeLessThanOrEqual(outer.bottom + 1)
}

async function expectUnmistakableSelectedLanguage(menu: Locator): Promise<void> {
  await expect(menu).toBeVisible()
  const states = await menu.locator('.language-menu__choice').evaluateAll(
    (choices) =>
      choices.map((choice) => {
        const radio = choice.querySelector('.language-menu__radio')
        const mark = choice.querySelector('.language-menu__selected-mark')
        if (!(radio instanceof HTMLElement) || !(mark instanceof HTMLElement)) {
          throw new Error('A language choice is missing its visual state markers')
        }
        const style = getComputedStyle(choice)
        const box = choice.getBoundingClientRect()
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          checked: choice.getAttribute('aria-checked') === 'true',
          fontWeight: Number.parseInt(style.fontWeight, 10),
          height: box.height,
          markOpacity: Number.parseFloat(getComputedStyle(mark).opacity),
          radioDotColor: getComputedStyle(radio, '::after').backgroundColor,
        }
      }),
  )
  const selected = states.filter(({ checked }) => checked)
  const unselected = states.filter(({ checked }) => !checked)

  expect(selected).toHaveLength(1)
  expect(unselected).toHaveLength(2)
  expect(selected[0]?.backgroundColor).not.toBe(unselected[0]?.backgroundColor)
  expect(selected[0]?.boxShadow).not.toBe('none')
  expect(selected[0]?.fontWeight).toBeGreaterThanOrEqual(800)
  expect(selected[0]?.height).toBeGreaterThanOrEqual(48)
  expect(selected[0]?.markOpacity).toBe(1)
  expect(selected[0]?.radioDotColor).not.toBe('rgba(0, 0, 0, 0)')
  for (const state of unselected) {
    expect(state.markOpacity).toBe(0)
  }
}

async function expectReadableEnglishStoryLayout(
  page: Page,
  viewport: (typeof responsiveStoryViewports)[number],
): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect
    .poll(
      () =>
        page.locator('#museum-experience').evaluate((museum) =>
          Math.abs(museum.getBoundingClientRect().height - window.innerHeight),
        ),
      { message: `${viewport.name}: dynamic viewport height should settle` },
    )
    .toBeLessThanOrEqual(0.1)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const panel = document.querySelector('.story-panel')
          const card = document.querySelector('.story-card')
          const title = document.querySelector('.animal-title')
          if (!(panel instanceof HTMLElement) || !(card instanceof HTMLElement) || !title) {
            return false
          }
          const container =
            getComputedStyle(panel).display === 'contents' ? card : panel
          const containerBox = container.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(title)
          const titleBox = range.getBoundingClientRect()
          return (
            titleBox.left >= containerBox.left - 1 &&
            titleBox.right <= containerBox.right + 1
          )
        }),
      { message: `${viewport.name}: responsive title should finish fitting` },
    )
    .toBe(true)

  const layout = await page.evaluate(() => {
    const requireElement = (selector: string): HTMLElement => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing responsive story element: ${selector}`)
      }
      return element
    }
    const rect = (element: Element): LayoutRect => {
      const box = element.getBoundingClientRect()
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      }
    }
    const lineCount = (element: Node): number => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return new Set(
        Array.from(range.getClientRects()).map((line) => Math.round(line.top)),
      ).size
    }
    const textRect = (element: Node): LayoutRect => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const box = range.getBoundingClientRect()
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      }
    }

    const panel = requireElement('.story-panel')
    const card = requireElement('.story-card')
    const header = requireElement('.museum-header')
    const title = requireElement('.animal-title')
    const introText = requireElement('.child-intro > span')
    const actions = requireElement('.story-actions')
    const navigation = requireElement('.animal-navigation')
    const stageActions = requireElement('.stage-actions')
    const museumName = requireElement('.museum-kicker > span:nth-child(2)')

    const buttonLayouts = Array.from(actions.querySelectorAll('button')).map(
      (button) => {
        const label = button.querySelector(':scope > span:not(.narration-wave)')
        const labelVisible =
          label instanceof HTMLElement && getComputedStyle(label).display !== 'none'
        return {
          button: rect(button),
          label: labelVisible && label ? rect(label) : null,
        }
      },
    )
    const stageActionButtons = Array.from(
      stageActions.querySelectorAll('button'),
    ).map(rect)

    return {
      actions: rect(actions),
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      buttonLayouts,
      card: rect(card),
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      header: rect(header),
      introLineCount: lineCount(introText),
      introText: rect(introText),
      museumNameLineCount: lineCount(museumName),
      navigation: rect(navigation),
      panel: rect(panel),
      panelDisplay: getComputedStyle(panel).display,
      stageActionButtons,
      stageActions: rect(stageActions),
      title: rect(title),
      titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
      titleLineCount: lineCount(title),
      titleText: textRect(title),
    }
  })

  const viewportRect: LayoutRect = {
    bottom: viewport.height,
    height: viewport.height,
    left: 0,
    right: viewport.width,
    top: 0,
    width: viewport.width,
  }
  for (const [label, element] of [
    ['story card', layout.card],
    ['story actions', layout.actions],
    ['animal navigation', layout.navigation],
    ['stage actions', layout.stageActions],
  ] as const) {
    expectRectInside(element, viewportRect, `${viewport.name}: ${label}`)
  }
  const storyContentBounds =
    layout.panelDisplay === 'contents' ? layout.card : layout.panel
  for (const [label, element] of [
    ['museum header', layout.header],
    ['animal title', layout.title],
    ['animal title text', layout.titleText],
    ['animal introduction', layout.introText],
  ] as const) {
    expectRectInside(element, storyContentBounds, `${viewport.name}: ${label}`)
  }
  if (layout.panelDisplay !== 'contents') {
    expectRectInside(layout.card, layout.panel, `${viewport.name}: story card`)
    expectRectInside(
      layout.actions,
      layout.panel,
      `${viewport.name}: story actions`,
    )
  }

  const horizontalOverlap =
    Math.min(layout.card.right, layout.actions.right) -
    Math.max(layout.card.left, layout.actions.left)
  const verticalOverlap =
    Math.min(layout.card.bottom, layout.actions.bottom) -
    Math.max(layout.card.top, layout.actions.top)
  expect(
    horizontalOverlap <= 1 || verticalOverlap <= 1,
    `${viewport.name}: story copy and actions must not overlap`,
  ).toBe(true)

  for (const [index, buttonLayout] of layout.buttonLayouts.entries()) {
    expectRectInside(
      buttonLayout.button,
      layout.actions,
      `${viewport.name}: story button ${index + 1}`,
    )
    expect(buttonLayout.button.width).toBeGreaterThanOrEqual(48)
    expect(buttonLayout.button.height).toBeGreaterThanOrEqual(48)
    if (buttonLayout.label) {
      expectRectInside(
        buttonLayout.label,
        buttonLayout.button,
        `${viewport.name}: story button ${index + 1} label`,
      )
    }
  }

  expect(layout.stageActionButtons).toHaveLength(3)
  for (const [index, button] of layout.stageActionButtons.entries()) {
    expectRectInside(
      button,
      layout.stageActions,
      `${viewport.name}: stage button ${index + 1}`,
    )
    expect(button.width).toBeGreaterThanOrEqual(48)
    expect(button.height).toBeGreaterThanOrEqual(48)
  }
  expect(
    layout.stageActionButtons[1].left - layout.stageActionButtons[0].right,
    `${viewport.name}: language and reset controls need a visible gap`,
  ).toBeGreaterThanOrEqual(5.5)

  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(viewport.width + 1)
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(viewport.width + 1)
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(viewport.height + 1)
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(viewport.height + 1)
  expect(layout.titleFontSize).toBeGreaterThanOrEqual(18)
  expect(layout.titleLineCount).toBe(1)
  expect(
    layout.introLineCount,
    `${viewport.name}: introduction lines`,
  ).toBeLessThanOrEqual(5)

  const compactLandscape =
    viewport.width > viewport.height && viewport.height <= 560
  expect(layout.museumNameLineCount).toBeLessThanOrEqual(
    compactLandscape ? 3 : 2,
  )
  expect(layout.card.width).toBeGreaterThanOrEqual(compactLandscape ? 180 : 280)
  expect(layout.introText.width).toBeGreaterThanOrEqual(
    compactLandscape ? 180 : 260,
  )

  if (
    viewport.width >= 768 &&
    viewport.width <= 1023 &&
    viewport.height > 560
  ) {
    expect(layout.panel.width).toBeGreaterThanOrEqual(viewport.width - 22)
    expect(layout.panel.height).toBeLessThanOrEqual(240)
    expect(layout.card.width).toBeGreaterThanOrEqual(320)
  }
}

async function waitForMuseumShell(
  page: Page,
  heading: string,
  level: 1 | 2 = 2,
): Promise<void> {
  await expect(page.locator('#museum-experience')).toBeVisible()
  await expect(page.getByRole('heading', { level, name: heading })).toBeVisible()
}

async function waitForReadyAnimal(page: Page, animalId: string): Promise<void> {
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    animalId,
    { timeout: 20_000 },
  )
}

async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface AudioProbeInstance {
      readonly source: string
      currentTime: number
      pauseCalls: number
      playCalls: number
      readonly rewinds: number[]
    }

    const probe: { instances: AudioProbeInstance[] } = { instances: [] }

    class FakeAudio {
      autoplay = false
      preload = ''
      readonly error = null
      readonly instance: AudioProbeInstance
      private readonly listeners = new Map<string, Set<() => void>>()

      constructor(source = '') {
        this.instance = {
          source,
          currentTime: 0,
          pauseCalls: 0,
          playCalls: 0,
          rewinds: [],
        }
        probe.instances.push(this.instance)
      }

      get currentTime(): number {
        return this.instance.currentTime
      }

      set currentTime(value: number) {
        this.instance.currentTime = value
        this.instance.rewinds.push(value)
      }

      play(): Promise<void> {
        this.instance.playCalls += 1
        return Promise.resolve()
      }

      pause(): void {
        this.instance.pauseCalls += 1
      }

      addEventListener(type: string, listener: () => void): void {
        const listeners = this.listeners.get(type) ?? new Set<() => void>()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }

      removeEventListener(type: string, listener: () => void): void {
        this.listeners.get(type)?.delete(listener)
      }
    }

    Object.defineProperty(window, '__museumAudioProbe', {
      configurable: true,
      value: probe,
    })
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: FakeAudio,
    })
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g', saveData: true },
    })
  })
}

test('keeps the complete English museum first frame reachable without JavaScript', async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required for the static SEO test.')
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 640 },
  })
  const page = await context.newPage()
  try {
    const response = await page.goto(`${baseURL}en/`)
    expect(response?.ok()).toBe(true)
    const museum = page.locator('#museum-experience')
    await expect(museum).toBeVisible()
    await expect(page.locator('.animal-title')).toHaveText('Stegosaurus')
    await expect(page.locator('.animal-card[data-animal-id]')).toHaveCount(
      mainCollection.animalIds.length,
    )
    await expect(page.locator('.model-still')).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator('.model-still img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0)
    await expect(page.locator('.seo-static-shell')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('an English locale path wins for this visit without overwriting a saved choice', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: localeStorageKey, value: 'zh-CN' },
  )
  await page.route('**/*.glb', (route) => route.abort())

  const response = await page.goto('./en/')
  expect(response?.ok()).toBe(true)
  expect(await response?.text()).toContain(
    '<title>Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits</title>',
  )
  await waitForMuseumShell(page, 'Stegosaurus')

  expect(new URL(page.url()).pathname).toBe(`${nestedPath}en/`)
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Prehistoric Animal Museum',
    }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'en')
  await expect(page).toHaveTitle(
    'Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits',
  )
  await expect(
    page.getByRole('button', {
      name: 'About Leon Made This and this museum',
    }),
  ).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBe(
    'zh-CN',
  )
})

test('lets Tab and Shift+Tab leave the language menu naturally', async ({
  page,
}) => {
  await page.route('**/*.glb', (route) => route.abort())
  await page.goto('./en/')
  await waitForMuseumShell(page, 'Stegosaurus')

  const trigger = page.getByRole('button', {
    name: 'Change language, current English',
  })
  await trigger.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Choose interface language' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reset the view' })).toBeFocused()

  await trigger.press('ArrowDown')
  await expect(
    page.getByRole('menu', { name: 'Choose interface language' }),
  ).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(
    page.getByRole('menu', { name: 'Choose interface language' }),
  ).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('switches language with the radio menu without reloading the page or model', async ({
  page,
}) => {
  await installAudioProbe(page)
  const glbRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('.glb')) {
      glbRequests.push(request.url())
    }
  })

  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, '剑龙')
  await waitForReadyAnimal(page, 'stegosaurus')
  await page
    .locator('a[data-animal-detail-link][data-animal-id="mammoth"]')
    .click()
  await waitForMuseumShell(page, '长毛猛犸象')
  await waitForReadyAnimal(page, 'mammoth')

  const narration = page.locator('.narration-button')
  await expect(narration).toHaveAccessibleName('听它的介绍')
  await expect(narration).toBeEnabled()
  await narration.click()
  await expect(narration).toHaveAccessibleName('暂停介绍')
  await expect(narration).toHaveAttribute('data-playback', 'playing')

  await page.evaluate(() => {
    Object.defineProperty(window, '__localeSwitchCanvas', {
      configurable: true,
      value: document.querySelector('.viewer-canvas'),
    })
  })
  const modelRequestCount = glbRequests.length

  const languageTrigger = page.getByRole('button', {
    name: '切换语言，当前简体中文',
  })
  await languageTrigger.focus()
  await languageTrigger.press('ArrowDown')

  const menu = page.getByRole('menu', { name: '选择界面语言' })
  await expect(menu).toBeVisible()
  const choices = menu.getByRole('menuitemradio')
  await expect(choices).toHaveCount(3)
  await expect(choices.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(choices.nth(0)).toBeFocused()

  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toBeFocused()
  await page.keyboard.press('Enter')

  await waitForMuseumShell(page, 'Woolly mammoth')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).toHaveAttribute('data-locale', 'en')
  await expect(page).toHaveTitle(
    'Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits',
  )
  await expect(page.locator('#museum-experience')).toHaveAttribute(
    'data-ready-animal-id',
    'mammoth',
  )
  expect(new URL(page.url()).pathname).toBe(`${nestedPath}en/`)
  expect(new URL(page.url()).searchParams.get('animal')).toBe('mammoth')
  expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBe(
    'en',
  )
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'museum_locale',
    ),
  ).toMatchObject({
    value: 'en',
    path: nestedPath.slice(0, -1),
    secure: true,
    sameSite: 'Lax',
  })
  await expect(
    page.getByRole('button', { name: 'Change language, current English' }),
  ).toBeFocused()

  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __localeSwitchCanvas: Element | null
          }
        ).__localeSwitchCanvas === document.querySelector('.viewer-canvas'),
    ),
  ).toBe(true)
  await page.waitForTimeout(200)
  expect(glbRequests).toHaveLength(modelRequestCount)

  const audioProbe = await page.evaluate(() =>
    (
      window as typeof window & {
        __museumAudioProbe: {
          instances: Array<{
            currentTime: number
            pauseCalls: number
            playCalls: number
            rewinds: number[]
          }>
        }
      }
    ).__museumAudioProbe,
  )
  expect(audioProbe.instances).toHaveLength(1)
  expect(audioProbe.instances[0]?.playCalls).toBe(1)
  expect(audioProbe.instances[0]?.pauseCalls).toBeGreaterThanOrEqual(1)
  expect(audioProbe.instances[0]?.currentTime).toBe(0)
  expect(audioProbe.instances[0]?.rewinds).toContain(0)
  await expect(narration).toHaveAccessibleName('Listen to its introduction')
  await expect(narration).toHaveAttribute('data-playback', 'stopped')

  await page
    .getByRole('button', { name: 'About Leon Made This and this museum' })
    .click()
  const about = page.getByRole('dialog', { name: 'About this museum' })
  await expect(about).toBeVisible()
  await expect(
    about.getByRole('heading', {
      name: 'A little museum made by a developer dad for his daughter',
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close About this museum' }).click()

  await page.getByRole('button', { name: 'Guide for grown-ups' }).click()
  const guide = page.getByRole('dialog', { name: 'Guide for grown-ups' })
  await expect(guide).toBeVisible()
  await expect(guide.getByText('When it lived', { exact: true })).toBeVisible()
  await expect(
    guide.getByRole('heading', { name: 'Narration transcript' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close the guide for grown-ups' }).click()

  await page.getByRole('button', { name: 'Open the full museum guide' }).click()
  const collection = page.getByRole('dialog', { name: 'Museum guide' })
  await expect(collection).toBeVisible()
  await expect(
    collection.getByText('Choose a friend and go straight to its 3D exhibit.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close the museum guide' }).click()

  await page
    .getByRole('button', { name: 'Change language, current English' })
    .click()
  await page
    .getByRole('menuitemradio', { name: /^Follow system \(currently / })
    .click()
  await waitForMuseumShell(page, '长毛猛犸象')
  expect(new URL(page.url()).pathname).toBe(`${nestedPath}zh-CN/`)
  expect(new URL(page.url()).searchParams.get('animal')).toBe('mammoth')
  expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBeNull()
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'museum_locale',
    ),
  ).toBeUndefined()
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __localeSwitchCanvas: Element | null
          }
        ).__localeSwitchCanvas === document.querySelector('.viewer-canvas'),
    ),
  ).toBe(true)
  await page.waitForTimeout(200)
  expect(glbRequests).toHaveLength(modelRequestCount)

  await page.reload()
  await waitForMuseumShell(page, '长毛猛犸象', 1)
  expect(new URL(page.url()).pathname).toBe(
    `${nestedPath}zh-CN/animals/mammoth/`,
  )
  expect(new URL(page.url()).search).toBe('')
  await page
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await expect(
    page.getByRole('menuitemradio', { name: /^跟随系统（当前：/ }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('keeps an open drawer and model focus mode during an in-place language switch', async ({
  page,
}) => {
  const glbRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('.glb')) {
      glbRequests.push(request.url())
    }
  })

  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, '剑龙')
  await waitForReadyAnimal(page, 'stegosaurus')
  const activeModelUrl = glbRequests[0]
  expect(activeModelUrl).toBeDefined()
  const activeModelRequestCount = glbRequests.filter(
    (requestUrl) => requestUrl === activeModelUrl,
  ).length

  await page.getByRole('button', { name: '给家长的资料' }).click()
  const chineseGuide = page.getByRole('dialog', { name: '给家长的资料' })
  await chineseGuide
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await page.keyboard.press('Escape')
  await expect(chineseGuide).toBeVisible()
  await expect(chineseGuide.getByRole('menu')).toHaveCount(0)
  await chineseGuide
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await chineseGuide.getByRole('menuitemradio', { name: 'English' }).click()
  const englishGuide = page.getByRole('dialog', { name: 'Guide for grown-ups' })
  await expect(englishGuide).toBeVisible()
  await expect(englishGuide.getByText('When it lived', { exact: true })).toBeVisible()
  await englishGuide
    .getByRole('button', { name: 'Close the guide for grown-ups' })
    .click()

  await page.getByRole('button', { name: 'Focus on the model' }).click()
  await page
    .getByRole('button', { name: 'Change language, current English' })
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Exit model focus mode' })).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Change language, current English' })
    .click()
  await page
    .getByRole('menuitemradio', { name: '简体中文', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '退出模型专注模式' }),
  ).toBeVisible()
  await expect(
    page.locator('#museum-experience'),
  ).toHaveClass(/museum-experience--focus/)
  await expect(page.getByRole('heading', { name: '剑龙' })).toHaveCount(0)
  await page.waitForTimeout(200)
  expect(
    glbRequests.filter((requestUrl) => requestUrl === activeModelUrl),
  ).toHaveLength(activeModelRequestCount)
})

test('makes the selected language unmistakable in both museum sheets', async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required for the language menu test.')
  }
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'zh-CN',
    viewport: { width: 430, height: 932 },
  })
  const page = await context.newPage()
  try {
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: localeStorageKey, value: 'zh-CN' },
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/*.glb', (route) => route.abort())
    const response = await page.goto(`${baseURL}zh-CN/`)
    expect(response?.ok()).toBe(true)
    await waitForMuseumShell(page, '剑龙')

    await page.getByRole('button', { name: '打开全馆图鉴' }).click()
    const collection = page.getByRole('dialog', { name: '全馆图鉴' })
    await collection
      .getByRole('button', { name: '切换语言，当前简体中文' })
      .click()
    await expectUnmistakableSelectedLanguage(
      collection.getByRole('menu', { name: '选择界面语言' }),
    )
    await page.keyboard.press('Escape')
    await collection.getByRole('button', { name: '关闭全馆图鉴' }).click()

    await page.getByRole('button', { name: '给家长的资料' }).click()
    const guide = page.getByRole('dialog', { name: '给家长的资料' })
    await guide
      .getByRole('button', { name: '切换语言，当前简体中文' })
      .click()
    await expectUnmistakableSelectedLanguage(
      guide.getByRole('menu', { name: '选择界面语言' }),
    )
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2)
  } finally {
    await context.close()
  }
})

test('keeps the English guide heading and both header actions contained on narrow layouts', async ({
  page,
}) => {
  await page.route('**/*.glb', (route) => route.abort())
  await page.setViewportSize({ width: 360, height: 640 })
  const response = await page.goto('./en/')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, 'Stegosaurus')

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Guide for grown-ups' }).click()
    const guide = page.getByRole('dialog', { name: 'Guide for grown-ups' })
    await expect(guide).toBeVisible()
    const layout = await guide.locator('.drawer-header').evaluate((header) => {
      const title = header.querySelector('h2')
      const actions = header.querySelector('.drawer-header__actions')
      if (!(title instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
        throw new Error('The English guide header is incomplete')
      }
      const headerBox = header.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      const actionsBox = actions.getBoundingClientRect()
      return {
        actionCount: actions.querySelectorAll('button').length,
        actionsBottom: actionsBox.bottom,
        actionsLeft: actionsBox.left,
        actionsRight: actionsBox.right,
        actionsTop: actionsBox.top,
        fontFamily: getComputedStyle(title).fontFamily,
        headerBottom: headerBox.bottom,
        headerLeft: headerBox.left,
        headerRight: headerBox.right,
        headerTop: headerBox.top,
        titleBottom: titleBox.bottom,
        titleLeft: titleBox.left,
        titleRight: titleBox.right,
        titleScrollWidth: title.scrollWidth,
        titleWidth: title.clientWidth,
      }
    })
    expect(layout.fontFamily).toContain('Fredoka Variable')
    expect(layout.actionCount).toBe(2)
    expect(layout.titleScrollWidth).toBeLessThanOrEqual(layout.titleWidth + 1)
    expect(layout.titleLeft).toBeGreaterThanOrEqual(layout.headerLeft - 1)
    expect(layout.titleRight).toBeLessThanOrEqual(layout.headerRight + 1)
    expect(layout.titleBottom).toBeLessThanOrEqual(layout.headerBottom + 1)
    expect(layout.titleRight).toBeLessThanOrEqual(layout.actionsLeft + 1)
    expect(layout.actionsTop).toBeGreaterThanOrEqual(layout.headerTop - 1)
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.headerBottom + 1)
    expect(layout.actionsRight).toBeLessThanOrEqual(layout.headerRight + 1)
    expect(layout.headerTop).toBeGreaterThanOrEqual(0)
    await guide
      .getByRole('button', { name: 'Close the guide for grown-ups' })
      .click()
  }
})

test('keeps representative English stories readable across responsive breakpoints', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/*.glb', (route) => route.abort())
  await page.setViewportSize(responsiveStoryViewports[0])

  for (const story of responsiveEnglishStoryCases) {
    const response = await page.goto(`./en/?animal=${story.animalId}`)
    expect(response?.ok()).toBe(true)
    await waitForMuseumShell(page, story.heading, 1)

    for (const viewport of responsiveStoryViewports) {
      await page.setViewportSize(viewport)
      await expectReadableEnglishStoryLayout(page, viewport)
    }
  }
})

test('keeps Chinese exhibit metadata clear of the actions in mobile desktop-site mode', async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) {
    throw new Error(
      'Playwright baseURL is required for the desktop-site layout test.',
    )
  }
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    hasTouch: true,
    locale: 'zh-CN',
    viewport: { width: 980, height: 1920 },
  })
  const page = await context.newPage()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/*.glb', (route) => route.abort())
    const response = await page.goto(
      `${baseURL}zh-CN/animals/stegosaurus/`,
    )
    expect(response?.ok()).toBe(true)
    await waitForMuseumShell(page, '剑龙', 1)
    await expect(page.locator('#museum-experience')).toHaveAttribute(
      'data-page-kind',
      'animal-detail',
    )
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )

    const layout = await page.evaluate(() => {
      const requireElement = (selector: string): HTMLElement => {
        const element = document.querySelector(selector)
        if (!(element instanceof HTMLElement)) {
          throw new Error(`Missing desktop-site element: ${selector}`)
        }
        return element
      }
      const rect = (element: Element): LayoutRect => {
        const box = element.getBoundingClientRect()
        return {
          bottom: box.bottom,
          height: box.height,
          left: box.left,
          right: box.right,
          top: box.top,
          width: box.width,
        }
      }

      return {
        actions: rect(requireElement('.story-actions')),
        card: rect(requireElement('.story-card')),
        eyebrow: rect(requireElement('.animal-eyebrow')),
      }
    })

    expectRectInside(
      layout.eyebrow,
      layout.card,
      'mobile desktop-site mode: exhibit metadata',
    )
    const horizontalOverlap =
      Math.min(layout.eyebrow.right, layout.actions.right) -
      Math.max(layout.eyebrow.left, layout.actions.left)
    const verticalOverlap =
      Math.min(layout.eyebrow.bottom, layout.actions.bottom) -
      Math.max(layout.eyebrow.top, layout.actions.top)
    expect(
      horizontalOverlap <= 1 || verticalOverlap <= 1,
      'mobile desktop-site mode: exhibit metadata must not overlap the actions',
    ).toBe(true)
  } finally {
    await context.close()
  }
})

test('keeps the reported Retina phone and tablet layouts readable with touch input', async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required for the Retina layout test.')
  }
  const viewports = responsiveStoryViewports.filter(
    ({ name }) =>
      name === 'large phone portrait' || name === 'reported Retina layout',
  )
  if (viewports.length !== 2) {
    throw new Error('A reported Retina viewport is missing.')
  }
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    viewport: viewports[0],
  })
  const page = await context.newPage()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/*.glb', (route) => route.abort())
    const response = await page.goto(`${baseURL}en/?animal=ichthyosaur`)
    expect(response?.ok()).toBe(true)
    await waitForMuseumShell(page, 'Ichthyosaurs', 1)
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expectReadableEnglishStoryLayout(page, viewport)
    }
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2)
  } finally {
    await context.close()
  }
})

test('localises initial loading and recoverable model errors in English', async ({
  page,
}) => {
  let firstModelRequest = true
  await page.route('**/*.glb', async (route) => {
    if (firstModelRequest) {
      firstModelRequest = false
      await new Promise((resolve) => setTimeout(resolve, 650))
    }
    await route.continue()
  })

  const response = await page.goto('./en/?fixtures=1')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, 'Stegosaurus')
  await expect(page.locator('.stage-loading')).toContainText(
    /Inviting our first prehistoric friend|Looking for the 3D model|Downloading the 3D model|Opening the 3D model/,
  )
  await waitForReadyAnimal(page, 'stegosaurus')

  const slowAnimal = page.locator(
    '.animal-card[data-animal-id="fixture-slow"]',
  )
  await expect(slowAnimal).toContainText('Slow test animal')
  await slowAnimal.click()
  await expect(slowAnimal.locator('.card-status')).toHaveText(
    /Coming to the exhibit|Downloading|Opening/,
    { timeout: 2_000 },
  )

  const retryAnimal = page.locator(
    '.animal-card[data-animal-id="fixture-retry"]',
  )
  await expect(retryAnimal).toContainText('Retry test animal')
  await retryAnimal.click()
  await expect(retryAnimal).toHaveAttribute('data-failed', 'true', {
    timeout: 3_000,
  })
  await expect(retryAnimal.locator('.card-status')).toHaveText('Try again')
  await expect(retryAnimal).toHaveAttribute(
    'aria-label',
    /loading failed, activate to try again/,
  )
  await expect(page.locator('.sr-only[role="status"]')).toContainText(
    'is not ready just now. Activate its card to try again.',
  )
})

test.describe('unsupported system language', () => {
  test.use({ locale: 'fr-FR' })

  test('uses the default Chinese museum when the edge entry fails open', async ({ page }) => {
    const response = await page.goto('.')
    expect(response?.ok()).toBe(true)
    await expect(page.locator('.seo-static-shell')).toHaveCount(0)
    await expect(page.locator('#museum-experience')).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 1, name: '史前动物博物馆' }),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(nestedPath)
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBeNull()
  })
})

test.describe('Traditional Chinese system language', () => {
  test.use({ locale: 'zh-TW' })

  test('keeps the fail-open Chinese first frame stable', async ({ page }) => {
    const response = await page.goto('.')
    expect(response?.ok()).toBe(true)
    await expect(page.locator('.seo-static-shell')).toHaveCount(0)
    await expect(page.locator('#museum-experience')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(nestedPath)
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBeNull()
  })
})
