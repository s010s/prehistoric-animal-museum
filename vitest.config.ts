import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { canonicalAnimalCatalog } from './scripts/canonical-catalog'
import { scaleEncounterGlacierAssetUrls } from './scripts/scale-encounter-glacier-assets'

export default defineConfig(async () => ({
  plugins: [
    react(),
    (await canonicalAnimalCatalog('test')).plugin,
    scaleEncounterGlacierAssetUrls('review'),
  ],
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
    include: [
      'tests/**/*.test.{ts,tsx}',
      'tools/animal-onboarding/tests/**/*.test.ts',
    ],
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
  },
}))
