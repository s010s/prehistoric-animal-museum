import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const worktreeRoot = resolve(import.meta.dirname, '../..')
const outputDirectory = resolve(
  worktreeRoot,
  'prototypes/scale-encounter-sky/evidence',
)

await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=metal'],
  headless: true,
})
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { height: 900, width: 1440 },
})
const browserIssues = []
page.on('console', (message) => {
  if (message.type() === 'error') {
    browserIssues.push(`console:${message.text()}`)
  }
})
page.on('pageerror', (error) => browserIssues.push(`page:${error.message}`))
page.on('requestfailed', (request) => {
  browserIssues.push(
    `request:${request.url()}:${request.failure()?.errorText ?? 'unknown'}`,
  )
})

await page.goto('http://127.0.0.1:4188/?variant=C&chrome=0', {
  waitUntil: 'networkidle',
})
await page.waitForFunction(() => window.__SKY_REVIEW__?.ready === true, null, {
  timeout: 30_000,
})
await page.evaluate(() => window.__SKY_REVIEW__?.waitForFrames(8))
await page.waitForTimeout(700)

for (const variant of ['A', 'B', 'C']) {
  await page.evaluate(
    async (nextVariant) =>
      window.__SKY_REVIEW__?.setVariant(nextVariant),
    variant,
  )
  await page.screenshot({
    path: resolve(outputDirectory, `probe-${variant.toLowerCase()}-overview.png`),
  })
}

await page.evaluate(() => window.__SKY_REVIEW__?.setView('pov', 'default'))
await page.screenshot({
  path: resolve(outputDirectory, 'probe-c-pov-default.png'),
})

for (const height of ['overview', 'eye-level', 'cloud-boundary']) {
  await page.evaluate(
    async (nextHeight) => window.__SKY_REVIEW__?.setOrbit(135, nextHeight),
    height,
  )
  await page.screenshot({
    path: resolve(outputDirectory, `probe-c-orbit-${height}.png`),
  })
}

await page.evaluate(() => window.__SKY_REVIEW__?.setView('overview', 'default'))

const diagnostics = await page.evaluate(() =>
  window.__SKY_REVIEW__?.diagnostics(),
)
await writeFile(
  resolve(outputDirectory, 'probe-diagnostics.json'),
  `${JSON.stringify({ browserIssues, diagnostics }, null, 2)}\n`,
)
process.stdout.write(
  `${JSON.stringify({ browserIssues, diagnostics }, null, 2)}\n`,
)
await browser.close()
