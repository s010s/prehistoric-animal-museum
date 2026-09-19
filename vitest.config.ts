import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { scaleEncounterGlacierAssetUrls } from './scripts/scale-encounter-glacier-assets'

const localReviewOnlyTests = [
  'tests/review-catalog.test.ts',
  'tests/review-server-security.test.ts',
]

export default defineConfig({
  plugins: [react(), scaleEncounterGlacierAssetUrls('review')],
  resolve: {
    alias: {
      'virtual:flight-experience-entry': fileURLToPath(new URL('./src/flight-experience/entry-enabled.ts', import.meta.url)),
      'virtual:viewer-controller': fileURLToPath(
        new URL('./src/viewer/ViewerController.ts', import.meta.url),
      ),
      'virtual:scale-encounter-entry': fileURLToPath(
        new URL(
          './src/scale-encounter/entry-enabled.ts',
          import.meta.url,
        ),
      ),
      'virtual:local-review-catalog': fileURLToPath(
        new URL('./src/review/empty-catalog.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [
      'e2e/**',
      'prototypes/**/*.spec.ts',
      'review-e2e/**',
      'scripts/readme-screenshot-capture/**',
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.CI ? localReviewOnlyTests : []),
    ],
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
