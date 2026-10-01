import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ocean-refracted.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: '.handoff/ocean-v12/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4216',
    channel: 'chrome',
    headless: true,
    launchOptions: { args: ['--use-angle=metal'] },
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4216 --strictPort --mode review',
    url: 'http://127.0.0.1:4216',
    reuseExistingServer: true,
  },
})
