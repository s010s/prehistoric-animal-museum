import { defineConfig, devices } from '@playwright/test'

const nestedBase = '/prehistoric-animal-museum/'
const port = 4187

export default defineConfig({
  testDir: './e2e',
  // Hardware-only ocean review uses its own Chrome/Metal configuration.
  testIgnore: 'ocean-refracted.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}${nestedBase}`,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run build:e2e && node server.mjs dist --port ${port} --base ${nestedBase} --fixture-model-delay 1800`,
    url: `http://127.0.0.1:${port}${nestedBase}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
