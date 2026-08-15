import { defineConfig } from '@playwright/test'

const nestedBase = '/prehistoric-animal-museum/'
const port = 4187
const channel = process.env.SCALE_ENCOUNTER_PLAYWRIGHT_CHANNEL ?? 'chromium'
const headless = process.env.SCALE_ENCOUNTER_PLAYWRIGHT_HEADED !== '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list']],
  retries: 0,
  timeout: 600_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}${nestedBase}`,
    channel,
    headless,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node server.mjs dist --port ${port} --base ${nestedBase}`,
    reuseExistingServer: true,
    timeout: 30_000,
    url: `http://127.0.0.1:${port}${nestedBase}`,
  },
})
