import { expect, test, type Page } from '@playwright/test'
import { mainCollection } from '../src/content/collections/main'

const nestedPath = '/prehistoric-animal-museum/'

const noJsDetailCases = [
  {
    animalId: 'stegosaurus',
    introduction: '看看它背上的两排骨板，像不像一列起伏的小山？',
    locale: 'zh-CN',
    museumName: '史前动物博物馆',
    name: '剑龙',
    siblingId: 'tyrannosaurus-rex',
  },
  {
    animalId: 'mosasaurus',
    introduction:
      'Look at its flippers and powerful tail. Can you imagine its tail pushing it forwards while the flippers steer?',
    locale: 'en',
    museumName: 'Prehistoric Animal Museum',
    name: 'Mosasaurus',
    siblingId: 'megalodon',
  },
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
      const museum = page.locator('#museum-experience')
      await expect(museum).toBeVisible()
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
  await page.waitForLoadState('load')

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
  await page.route('**/*.glb*', (route) => route.abort())

  await page.goto('./en/?animal=pachycephalosaurus')
  await page.waitForURL('**/en/animals/pachycephalosaurus/')

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
  expect(hydrationErrors).toEqual([])
})

test('shows the default Chinese museum immediately when the edge redirect fails open', async ({
  page,
}) => {
  const response = await page.goto('.')
  expect(response?.status()).toBe(200)
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

test('keeps the equivalent detail route and publication metadata when language changes', async ({
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
  await expect(page.locator('.museum-kicker')).toContainText(
    'Prehistoric Animal Museum',
  )
  await expect(page.locator('.animal-title')).toHaveText('Mosasaurus')
  await expect(
    page.getByRole('dialog', { name: 'Museum guide' }),
  ).toBeVisible()
})
