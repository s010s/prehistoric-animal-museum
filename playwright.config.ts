import { defineConfig, devices } from '@playwright/test'

const nestedBase = '/prehistoric-animal-museum/'
const port = Number(process.env.MUSEUM_E2E_PORT ?? '4187')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}${nestedBase}`,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'on',
    headless: false,
    channel: process.env.CI ? undefined : 'chrome',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run validate:content && npm run typecheck && node --import tsx scripts/build-static-site.ts --mode e2e && node server.mjs dist --port ${port} --base ${nestedBase} --fixture-model-delay 1800 --cache-hashed-assets`,
    url: `http://127.0.0.1:${port}${nestedBase}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
