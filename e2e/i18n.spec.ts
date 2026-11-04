import { expect, test, type Page } from '@playwright/test'
import { mainCollection } from '../src/content/collections/main'

const nestedPath = '/prehistoric-animal-museum/'
const localeStorageKey = 'museum.locale'

async function waitForMuseumShell(
  page: Page,
  heading: string,
  level: 1 | 2 = 2,
): Promise<void> {
  await expect(page.locator('#museum-experience')).toBeVisible()
  await expect(page.getByRole('heading', { level, name: heading })).toBeVisible()
}

async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface AudioProbeInstance {
      readonly source: string
      currentTime: number
      pauseCalls: number
      playCalls: number
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
        }
        probe.instances.push(this.instance)
      }

      get currentTime(): number {
        return this.instance.currentTime
      }

      set currentTime(value: number) {
        this.instance.currentTime = value
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
  await waitForMuseumShell(page, 'Stegosaurus')

  expect(new URL(page.url()).pathname).toBe(`${nestedPath}en/`)
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Prehistoric Animal Museum',
    }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
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
  await expect(page.getByRole('button', { name: 'Share Stegosaurus' })).toBeFocused()

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

test('switches language, stops narration, and remembers the chosen language', async ({
  page,
}) => {
  await installAudioProbe(page)

  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, '剑龙')
  await page
    .locator('a[data-animal-detail-link][data-animal-id="mammoth"]')
    .click()
  await waitForMuseumShell(page, '长毛猛犸象')

  const narration = page.locator('.narration-button')
  await expect(narration).toHaveAccessibleName('听它的介绍')
  await expect(narration).toBeEnabled()
  await narration.click()
  await expect(narration).toHaveAccessibleName('暂停介绍')

  const languageTrigger = page.getByRole('button', {
    name: '切换语言，当前简体中文',
  })
  await languageTrigger.focus()
  await languageTrigger.press('ArrowDown')

  const menu = page.getByRole('menu', { name: '选择界面语言' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: '简体中文', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitemradio', { name: /^跟随系统（当前：/ }))
    .toBeFocused()

  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitemradio', { name: 'English' })).toBeFocused()
  await page.keyboard.press('Enter')

  await waitForMuseumShell(page, 'Woolly mammoth')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle(
    'Prehistoric Animal Museum for Kids | Free Interactive 3D Exhibits',
  )
  expect(new URL(page.url()).pathname).toBe(`${nestedPath}en/`)
  expect(new URL(page.url()).searchParams.get('animal')).toBe('mammoth')
  expect(await page.evaluate((key) => localStorage.getItem(key), localeStorageKey)).toBe(
    'en',
  )
  await expect(
    page.getByRole('button', { name: 'Change language, current English' }),
  ).toBeFocused()

  const audioProbe = await page.evaluate(() =>
    (
      window as typeof window & {
        __museumAudioProbe: {
          instances: Array<{
            pauseCalls: number
            playCalls: number
          }>
        }
      }
    ).__museumAudioProbe,
  )
  expect(audioProbe.instances[0]?.playCalls).toBe(1)
  expect(audioProbe.instances[0]?.pauseCalls).toBeGreaterThanOrEqual(1)
  await expect(narration).toHaveAccessibleName('Listen to its introduction')

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
  const response = await page.goto('./zh-CN/')
  expect(response?.ok()).toBe(true)
  await waitForMuseumShell(page, '剑龙')

  await page.getByRole('button', { name: '给家长的资料' }).click()
  const chineseGuide = page.getByRole('dialog', { name: '给家长的资料' })
  await chineseGuide
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await page.keyboard.press('Escape')
  await expect(chineseGuide).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await chineseGuide
    .getByRole('button', { name: '切换语言，当前简体中文' })
    .click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
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
  await expect(page.getByRole('heading', { name: '剑龙' })).toHaveCount(0)
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
  await expect(
    page.getByRole('button', { name: 'Focus on the model' }),
  ).toBeEnabled({ timeout: 20_000 })

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
  await expect(retryAnimal.locator('.card-status')).toHaveText('Try again', {
    timeout: 3_000,
  })
  await expect(retryAnimal).toHaveAttribute(
    'aria-label',
    /loading failed, activate to try again/,
  )
  await expect(page.locator('.sr-only[role="status"]')).toContainText(
    'is not ready just now. Activate its card to try again.',
  )
})
