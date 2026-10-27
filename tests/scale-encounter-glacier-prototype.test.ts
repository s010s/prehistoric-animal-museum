import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'

const root = resolve(import.meta.dirname, '..')

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('mammoth palaeoenvironment prototype boundary', () => {
  it('uses the isolated 4190 preview without changing the shared build config', () => {
    const config = read('prototypes/scale-encounter-glacier/vite.config.ts')
    expect(config).toContain("host: '127.0.0.1'")
    expect(config).toContain('port: 4190')
    expect(config).toContain('strictPort: true')
    expect(config).toContain("cacheDir: resolve(prototypeDirectory, '.cache/vite')")
  })

  it('serves only the frozen mammoth and boy/girl base packages', () => {
    const config = read('prototypes/scale-encounter-glacier/vite.config.ts')
    const harness = read('prototypes/scale-encounter-glacier/main.ts')
    expect(config).toContain("'child-avatar-v3-boy-land-normal.glb'")
    expect(config).toContain("'child-avatar-v3-girl-land-normal.glb'")
    expect(config).toContain("'/__glacier-assets/mammoth.glb'")
    expect(harness).toContain("profile: 'base-only-no-outfit'")
    expect(harness).not.toMatch(/winter|scarf|glove|snow-boot/i)
  })

  it('retains the calibrated mammoth hash, scale and shared camera contract', () => {
    const harness = read('prototypes/scale-encounter-glacier/main.ts')
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth.calibratedModelSha256).toBe(
      '623a62621f1c6f2955fd3fe6442be8dfd34cdc94064e1bbb0c5e43e8970a1ece',
    )
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth.displayedMeters).toBe(3.25)
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth.minimumDistance).toBe(5.5)
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth.defaultDistance).toBe(10)
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth.maximumDistance).toBe(15)
    expect(harness).toContain('camera.far = 240')
    expect(harness).toContain(
      'overviewZoomRange: [MAMMOTH_OVERVIEW_MINIMUM_ZOOM, 1.18]',
    )
    expect(harness).toContain('computeMammothOverviewFittingFieldOfView')
    expect(harness).toContain('screenSpaceBounds')
  })

  it('exposes A/B/C, default/minimum/maximum, transition and orbit review states', () => {
    const harness = read('prototypes/scale-encounter-glacier/main.ts')
    for (const state of [
      'overview-minimum',
      'overview-default',
      'overview-maximum',
      'pov-minimum',
      'pov-default',
      'pov-maximum',
      'transition',
      'orbit',
    ]) {
      expect(harness).toContain(state)
    }
    expect(harness).toContain(
      "const variants: readonly MammothPalaeoenvironmentVariant[] = ['A', 'B', 'C']",
    )
  })
})
