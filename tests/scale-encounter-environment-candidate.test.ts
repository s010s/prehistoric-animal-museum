import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import {
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import {
  acquireReviewCandidateEnvironment,
  resetReviewCandidateEnvironmentCacheForTests,
  scaleEncounterPanoramaQualityFor,
  scaleEncounterPanoramaThemeFor,
} from '../src/scale-encounter/environment-review-candidate'

interface Delivery {
  readonly bytes: number
  readonly file: string
  readonly height: number
  readonly sha256: string
  readonly width: number
}

interface EnvironmentManifest {
  readonly productionApproved: boolean
  readonly surfaceSets: readonly {
    readonly high: Readonly<Record<'albedo' | 'normal' | 'roughness', Delivery>>
    readonly low: Readonly<Record<'albedo' | 'normal' | 'roughness', Delivery>>
    readonly physicalWidthMeters: number
    readonly theme: 'land' | 'water' | 'snow'
  }[]
  readonly variants: readonly {
    readonly high: Delivery
    readonly low: Delivery
    readonly medium: Delivery
  }[]
}

const candidateDirectory = resolve(
  process.cwd(),
  'src/scale-encounter/assets/environments',
)
const candidateManifestPath = resolve(
  candidateDirectory,
  'manifest.json',
)
const environmentDeliveriesTestTitle =
  'ties every delivery to the manifest, native dimensions and bounded transfer sizes'

function textureFor(url: string): Texture<HTMLImageElement> {
  const texture = new Texture(document.createElement('img'))
  texture.name = url
  return texture
}

async function decodedLongitudeSeamDelta(bytes: Buffer): Promise<{
  readonly maximum: number
  readonly mean: number
}> {
  const image = sharp(bytes)
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Expected a decodable panorama with dimensions.')
  }
  const [left, right] = await Promise.all([
    image
      .clone()
      .extract({ height: metadata.height, left: 0, top: 0, width: 1 })
      .raw()
      .toBuffer(),
    image
      .clone()
      .extract({
        height: metadata.height,
        left: metadata.width - 1,
        top: 0,
        width: 1,
      })
      .raw()
      .toBuffer(),
  ])
  let maximum = 0
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index]! - right[index]!)
    maximum = Math.max(maximum, delta)
    total += delta
  }
  return { maximum, mean: total / Math.max(left.length, 1) }
}

describe('scale encounter review panorama candidate', () => {
  afterEach(() => {
    resetReviewCandidateEnvironmentCacheForTests()
    vi.restoreAllMocks()
  })

  it('selects an animal-specific theme, including snow for the land-habitat mammoth', () => {
    expect(scaleEncounterPanoramaThemeFor('tyrannosaurus-rex')).toBe(
      'land-cretaceous',
    )
    expect(scaleEncounterPanoramaThemeFor('pteranodon')).toBe(
      'air-cretaceous',
    )
    expect(scaleEncounterPanoramaThemeFor('mosasaurus')).toBe(
      'water-cretaceous',
    )
    expect(scaleEncounterPanoramaThemeFor('mammoth')).toBe('snow-ice-age')
  })

  it('plans by network, rendered pixels and renderer texture limit', () => {
    expect(scaleEncounterPanoramaQualityFor(undefined, 1440, 2, 8192)).toBe(
      'high',
    )
    expect(scaleEncounterPanoramaQualityFor(undefined, 1440, 1, 8192)).toBe(
      'medium',
    )
    expect(scaleEncounterPanoramaQualityFor(undefined, 390, 3, 8192)).toBe(
      'medium',
    )
    expect(scaleEncounterPanoramaQualityFor(undefined, 1440, 2, 4096)).toBe(
      'medium',
    )
    expect(scaleEncounterPanoramaQualityFor(undefined, 1440, 2, 2048)).toBe(
      'low',
    )
    expect(
      scaleEncounterPanoramaQualityFor({ saveData: true }, 1440, 2, 8192),
    ).toBe('low')
    expect(
      scaleEncounterPanoramaQualityFor(
        { effectiveType: 'slow-2g' },
        390,
        3,
        8192,
      ),
    ).toBe('low')
  })

  it('installs 4K plus PBR first, then upgrades to 8K without retaining the decoded 4K', async () => {
    const textures = new Map<string, Texture<HTMLImageElement>>()
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => {
        const texture = textureFor(url)
        textures.set(url, texture)
        return Promise.resolve(texture)
      })

    const [first, second] = await Promise.all([
      acquireReviewCandidateEnvironment(
        'tyrannosaurus-rex',
        { effectiveType: '4g' },
        8192,
        1440,
        2,
      ),
      acquireReviewCandidateEnvironment(
        'tyrannosaurus-rex',
        { effectiveType: '4g' },
        8192,
        1440,
        2,
      ),
    ])

    expect(load).toHaveBeenCalledTimes(4)
    expect(first.quality).toBe('medium')
    expect(first.preferredQuality).toBe('high')
    expect(first.panoramaWidth).toBe(4096)
    expect(first.texture).toBe(second.texture)
    if (!first.texture) throw new Error('Expected a panorama texture.')
    expect(first.surfaceTextures).toEqual(second.surfaceTextures)
    expect(first.texture.mapping).toBe(EquirectangularReflectionMapping)
    expect(first.texture.colorSpace).toBe(SRGBColorSpace)
    expect(first.texture.generateMipmaps).toBe(true)
    expect(first.texture.minFilter).toBe(LinearMipmapLinearFilter)
    expect(first.texture.magFilter).toBe(LinearFilter)
    expect(first.surfaceTextures?.albedo.colorSpace).toBe(SRGBColorSpace)
    expect(first.surfaceTextures?.normal.colorSpace).toBe(NoColorSpace)
    expect(first.surfaceTextures?.roughness.colorSpace).toBe(NoColorSpace)
    if (!first.surfaceTextures) throw new Error('Expected land PBR textures.')
    expect(first.surfaceTextures.physicalWidthMeters).toBe(2)
    for (const texture of [
      first.surfaceTextures.albedo,
      first.surfaceTextures.normal,
      first.surfaceTextures.roughness,
    ]) {
      expect(texture.wrapS).toBe(RepeatWrapping)
      expect(texture.wrapT).toBe(RepeatWrapping)
      expect(texture.generateMipmaps).toBe(true)
    }

    const mediumDispose = vi.spyOn(first.texture, 'dispose')
    const upgrade = await first.startPanoramaUpgrade()
    expect(upgrade?.panoramaWidth).toBe(8192)
    expect(load).toHaveBeenCalledTimes(5)
    upgrade?.commit()
    expect(mediumDispose).not.toHaveBeenCalled()
    second.release()
    expect(mediumDispose).toHaveBeenCalledOnce()
    first.release()
  })

  it('uses one reduced 2K panorama on Save-Data and no surface bundle for air', async () => {
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => Promise.resolve(textureFor(url)))

    const lease = await acquireReviewCandidateEnvironment(
      'pteranodon',
      { saveData: true },
      8192,
      1440,
      2,
    )

    expect(lease.quality).toBe('low')
    expect(lease.panoramaWidth).toBe(2048)
    expect(lease.surfaceTextures).toBeNull()
    await expect(lease.startPanoramaUpgrade()).resolves.toBeNull()
    expect(load).toHaveBeenCalledOnce()
    expect(load.mock.calls[0]?.[0]).toContain(
      'panorama-air-cretaceous-2048.webp',
    )
    lease.release()
  })

  it('uses the open-clearing far plate for the production forest slice', async () => {
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => Promise.resolve(textureFor(url)))

    const lease = await acquireReviewCandidateEnvironment(
      'tyrannosaurus-rex',
      undefined,
      8192,
      1440,
      2,
      'production-slice',
    )

    expect(lease.panoramaWidth).toBe(4096)
    expect(lease.quality).toBe('medium')
    expect(lease.sourceUrl).toContain(
      'panorama-land-cretaceous-v5-farfield-4096.webp',
    )
    expect(lease.surfaceTextures?.albedo.name).toContain(
      'surface-land-albedo-2048.webp',
    )
    expect(lease.surfaceTextures?.dryLitterAlbedo).toBeUndefined()
    await expect(lease.startPanoramaUpgrade()).resolves.toBeNull()
    expect(load).toHaveBeenCalledTimes(6)
    expect(lease.matureTreeAtlas?.name).toContain(
      'midground-mature-tree-atlas-v1.webp',
    )
    lease.release()
  })

  it('uses the 2K far plate when production-slice data saving is enabled', async () => {
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => Promise.resolve(textureFor(url)))

    const lease = await acquireReviewCandidateEnvironment(
      'tyrannosaurus-rex',
      { saveData: true },
      8192,
      1440,
      2,
      'production-slice',
    )

    expect(lease.panoramaWidth).toBe(2048)
    expect(lease.quality).toBe('low')
    expect(lease.sourceUrl).toContain(
      'panorama-land-cretaceous-v5-farfield-2048.webp',
    )
    await expect(lease.startPanoramaUpgrade()).resolves.toBeNull()
    expect(load).toHaveBeenCalledTimes(6)
    expect(lease.matureTreeAtlas?.name).toContain(
      'midground-mature-tree-atlas-v1.webp',
    )
    lease.release()
  })

  it.each([
    ['tyrannosaurus-rex', 2],
    ['mosasaurus', 15],
    ['mammoth', 2],
  ] as const)(
    'carries the %s scan width into the runtime surface bundle',
    async (animalId, expectedPhysicalWidthMeters) => {
      vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(
        (url) => Promise.resolve(textureFor(url)),
      )
      const lease = await acquireReviewCandidateEnvironment(
        animalId,
        undefined,
        4096,
      )
      expect(lease.surfaceTextures?.physicalWidthMeters).toBe(
        expectedPhysicalWidthMeters,
      )
      lease.release()
    },
  )

  it('reuses the current theme on reopen and evicts it after switching themes', async () => {
    const textures = new Map<string, Texture<HTMLImageElement>>()
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => {
        const texture = textureFor(url)
        textures.set(url, texture)
        return Promise.resolve(texture)
      })
    const first = await acquireReviewCandidateEnvironment(
      'tyrannosaurus-rex',
      undefined,
      4096,
    )
    first.release()
    const reopened = await acquireReviewCandidateEnvironment(
      'tyrannosaurus-rex',
      undefined,
      4096,
    )
    expect(load).toHaveBeenCalledTimes(4)
    reopened.release()

    const landDisposals = [...textures.values()].map((texture) =>
      vi.spyOn(texture, 'dispose'),
    )
    const air = await acquireReviewCandidateEnvironment(
      'pteranodon',
      undefined,
      4096,
    )
    expect(landDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(
      true,
    )
    air.release()
  })

  it('disposes decoded textures that finish after a pending cache entry is reset', async () => {
    const pendingLoads: Array<{
      readonly texture: Texture<HTMLImageElement>
      resolve(texture: Texture<HTMLImageElement>): void
    }> = []
    const load = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation((url) => {
        const texture = textureFor(url)
        return new Promise<Texture<HTMLImageElement>>((resolveLoad) => {
          pendingLoads.push({ resolve: resolveLoad, texture })
        })
      })

    const pendingLease = acquireReviewCandidateEnvironment(
      'tyrannosaurus-rex',
      undefined,
      4096,
    ).catch((error: unknown) => error)
    expect(load).toHaveBeenCalledTimes(4)
    expect(pendingLoads).toHaveLength(4)

    const disposals = pendingLoads.map(({ texture }) =>
      vi.spyOn(texture, 'dispose'),
    )
    resetReviewCandidateEnvironmentCacheForTests()
    for (const pendingLoad of pendingLoads) {
      pendingLoad.resolve(pendingLoad.texture)
    }

    await expect(pendingLease).resolves.toBeInstanceOf(Error)
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce())
  })

  it(environmentDeliveriesTestTitle, async () => {
    const manifest = JSON.parse(
      readFileSync(candidateManifestPath, 'utf8'),
    ) as EnvironmentManifest

    expect(manifest.productionApproved).toBe(true)
    expect(manifest.variants).toHaveLength(4)
    for (const variant of manifest.variants) {
      for (const [kind, delivery] of [
        ['high', variant.high],
        ['medium', variant.medium],
        ['low', variant.low],
      ] as const) {
        const bytes = readFileSync(resolve(candidateDirectory, delivery.file))
        const metadata = await sharp(bytes).metadata()
        expect(bytes.byteLength).toBe(delivery.bytes)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          delivery.sha256,
        )
        expect(metadata.width).toBe(delivery.width)
        expect(metadata.height).toBe(delivery.height)
        expect(delivery.width).toBe(
          kind === 'high' ? 8192 : kind === 'medium' ? 4096 : 2048,
        )
        expect(bytes.byteLength).toBeLessThanOrEqual(
          kind === 'high' ? 14_000_000 : kind === 'medium' ? 4_000_000 : 1_000_000,
        )
        const decodedSeam = await decodedLongitudeSeamDelta(bytes)
        // WebP is lossy, so equality before encoding is not enough. Bound the
        // actual decoded longitude columns that WebGL will bilinearly sample.
        expect(decodedSeam.mean).toBeLessThanOrEqual(5)
        expect(decodedSeam.maximum).toBeLessThanOrEqual(32)
      }
    }

    expect(manifest.surfaceSets).toHaveLength(3)
    expect(
      manifest.surfaceSets.map(({ physicalWidthMeters, theme }) => ({
        physicalWidthMeters,
        theme,
      })),
    ).toEqual([
      { physicalWidthMeters: 2, theme: 'land' },
      { physicalWidthMeters: 15, theme: 'water' },
      { physicalWidthMeters: 2, theme: 'snow' },
    ])
    for (const surface of manifest.surfaceSets) {
      for (const [kind, maps] of [
        ['high', surface.high],
        ['low', surface.low],
      ] as const) {
        for (const delivery of Object.values(maps)) {
          const bytes = readFileSync(resolve(candidateDirectory, delivery.file))
          const metadata = await sharp(bytes).metadata()
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(
            delivery.sha256,
          )
          expect(bytes.byteLength).toBe(delivery.bytes)
          expect(metadata.width).toBe(kind === 'high' ? 2048 : 1024)
          expect(metadata.height).toBe(metadata.width)
        }
      }
    }
  })
})
