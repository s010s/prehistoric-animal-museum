import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = process.env.OCEAN_PREVIEW_URL ?? 'http://127.0.0.1:4189/'
const query =
  process.env.OCEAN_PROBE_QUERY ??
  'variant=C&view=overview&distance=default&ui=0'
const outputDirectory = resolve(
  process.env.OCEAN_PROBE_OUTPUT ?? '/tmp/ocean-preview-probe',
)

const browser = await chromium.launch({
  channel: process.env.OCEAN_PLAYWRIGHT_CHANNEL ?? 'chromium',
  headless: true,
})
const errors = []
try {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    viewport: { height: 900, width: 1440 },
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page:${error.message}`))
  const response = await page.goto(`${baseUrl}?${query}`)
  if (!response?.ok()) throw new Error(`preview-http:${response?.status()}`)
  await page.waitForFunction(() => window.__oceanReview?.ready === true, null, {
    timeout: 60_000,
  })
  await page.waitForTimeout(600)
  const metadata = await page.evaluate(() => window.__oceanReview.captureMetadata())
  await mkdir(outputDirectory, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    path: resolve(outputDirectory, 'candidate-C-overview.png'),
  })
  await writeFile(
    resolve(outputDirectory, 'candidate-C-overview.json'),
    `${JSON.stringify({ errors, metadata }, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify({ errors, metadata }, null, 2)}\n`)
  await context.close()
} finally {
  await browser.close()
}
