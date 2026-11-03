import { expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import ts from 'typescript'
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
      expect(title).toContain('3D')
      expect(description).toContain('3D')
      expect(titles.has(title)).toBe(false)
      titles.add(title)
      const canonical = 'https://leon-made-this.work/museum/' + locale + '/animals/' + animalId + '/'
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonical)
      const otherLocale = locale === 'zh-CN' ? 'en' : 'zh-CN'
      const links = [...document.body.querySelectorAll<HTMLAnchorElement>('a[data-locale-link]')]
      expect(links.some(link => new URL(link.getAttribute('href')!, response.url()).pathname.endsWith('/' + otherLocale + '/animals/' + animalId + '/'))).toBe(true)
      for (const link of links) {
        const targetLocale = link.getAttribute('data-locale-link')
        expect(['zh-CN', 'en']).toContain(targetLocale)
        expect(new URL(link.getAttribute('href')!, response.url()).href)
          .toBe(new URL(targetLocale + '/animals/' + animalId + '/', baseURL).href)
      }
      expect(document.querySelectorAll('a[data-animal-detail-link]')).toHaveLength(mainCollection.animalIds.length)
      expect(document.body.textContent).toContain(locale === 'en' ? 'Scientific sources' : '科学来源')
      rows.push({ animalId, locale, title, description, canonical, counterpartLinks: links.map(link => link.getAttribute('href')) })
    }
  }
  expect(rows).toHaveLength(90)
  await testInfo.attach('published-search-pages.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})

test('the browser entry keeps authoring prompts out of its runtime payload', async ({ request }, testInfo) => {
  const response = await request.get('en/')
  const document = new JSDOM(await response.text()).window.document
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src')
  expect(entry).toBeTruthy()
  const asset = await request.get(new URL(entry!, response.url()).href)
  expect(asset.status()).toBe(200)
  const javascript = await asset.text()
  const source = ts.createSourceFile('entry.js', javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let promptProperties = 0
  const inspect = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'prompt') promptProperties += 1
    ts.forEachChild(node, inspect)
  }
  inspect(source)
  expect(promptProperties).toBe(0)
  await testInfo.attach('runtime-entry.json', { body: JSON.stringify({ url: asset.url(), bytes: Buffer.byteLength(javascript), promptProperties }, null, 2), contentType: 'application/json' })
})

test('language anchors preserve the selected animal and enhance ordinary clicks', async ({ page }, testInfo) => {
  await page.route('**/*.glb*', route => route.abort())
  const hydrationErrors: string[] = []
  page.on('pageerror', error => { if (/hydration|hydrated|didn.t match/i.test(error.message)) hydrationErrors.push(error.message) })
  await page.goto('zh-CN/animals/triceratops/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.locator('.language-menu__trigger:visible').click()
  const english = page.locator('.language-menu__popover:visible a[data-locale-link="en"]')
  await expect(english).toHaveAttribute('href', /\/en\/animals\/triceratops\/$/)
  await english.click()
  await expect(page).toHaveURL(/\/en\/animals\/triceratops\/$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle(/Triceratops.*3D/)
  expect(await page.evaluate(() => localStorage.getItem('museum.locale'))).toBe('en')
  expect(hydrationErrors).toEqual([])
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
      const locale = link.getAttribute('data-locale-link')
      const target = new URL(link.getAttribute('href')!, response.url()).href
      expect(target).toBe(new URL(locale + '/', baseURL).href)
      rows.push({ page: path, locale, target })
    }
  }
  await testInfo.attach('locale-entry-links.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' })
})
