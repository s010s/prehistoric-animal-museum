import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import { mainCollection } from '../src/content/collections/main'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document } }
}

test('all published details expose distinct search metadata and counterpart language links', async ({ request, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('A local baseURL is required.')
  const rows: Record<string, unknown>[] = []
  const titles = new Set<string>()
  for (const locale of ['zh-CN', 'en'] as const) {
    for (const animalId of mainCollection.animalIds) {
      const response = await request.get(locale + '/animals/' + animalId + '/')
      expect(response.status()).toBe(200)
      const document = new JSDOM(await response.text()).window.document
      const title = document.title
      const description = document.querySelector('meta[name="description"]')?.getAttribute('content')
      expect(titles.has(title)).toBe(false)
      titles.add(title)
      const canonical = 'https://leon-made-this.work/museum/' + locale + '/animals/' + animalId + '/'
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical)
      const otherLocale = locale === 'zh-CN' ? 'en' : 'zh-CN'
      const links = [...document.body.querySelectorAll<HTMLAnchorElement>('a[data-locale-link]')]
      expect(links.some(link => new URL(link.getAttribute('href')!, response.url()).pathname.endsWith('/' + otherLocale + '/animals/' + animalId + '/'))).toBe(true)
      for (const link of links) {
        const targetLocale = link.getAttribute('hreflang')
        expect(new URL(link.getAttribute('href')!, response.url()).href)
          .toBe(new URL(targetLocale + '/animals/' + animalId + '/', baseURL).href)
      }
      expect(document.body.textContent).toContain(locale === 'en' ? 'Scientific sources' : '科学来源')
      rows.push({ animalId, locale, title, description, canonical, counterpartLinks: links.map(link => link.getAttribute('href')) })
    }
  }
  await testInfo.attach('published-search-pages.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})

test('keeps the selected animal when changing language from a detail', async ({ page }, testInfo) => {
  await page.route('**/*.glb*', route => route.abort())
  await page.goto('zh-CN/animals/triceratops/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.getByRole('button', { name: '切换语言，当前简体中文' }).click()
  const english = page.getByRole('menuitemradio', { name: 'English', exact: true })
  await expect(english).toHaveAttribute('href', /\/en\/animals\/triceratops\/$/)
  await english.click()
  await expect(page).toHaveURL(/\/en\/animals\/triceratops\/$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.screenshot({ path: testInfo.outputPath('english-triceratops.png'), fullPage: true })
})

test('locale homes and the fail-open root keep every language link inside the mounted museum', async ({ request, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('A local baseURL is required.')
  const rows: Record<string, unknown>[] = []
  for (const path of ['', 'zh-CN/', 'en/']) {
    const response = await request.get(path || './')
    expect(response.status()).toBe(200)
    const document = new JSDOM(await response.text()).window.document
    const links = [...document.body.querySelectorAll<HTMLAnchorElement>('a[data-locale-link]')]
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      const locale = link.getAttribute('hreflang')
      const target = new URL(link.getAttribute('href')!, response.url()).href
      expect(target).toBe(new URL(locale + '/', baseURL).href)
      rows.push({ page: path, locale, target })
    }
  }
  await testInfo.attach('locale-entry-links.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})
