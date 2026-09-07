import {
  ClampToEdgeWrapping,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Group,
  type Texture,
} from 'three'
import type { ScaleEncounterAnimalId } from './types'
import { scaleEncounterEnvironmentThemePlanFor } from './environment-theme-registry'
import type {
  ScaleEncounterPreparedLandBiome,
  ScaleEncounterProceduralLandBiomeThemeId,
} from './environments/land-biomes/types'
import { SCALE_ENCOUNTER_DEFINITIONS } from '../viewer/scale-encounter'
import type { ScaleEncounterSurfaceTextures } from '../viewer/scale-encounter-environment'

export type ScaleEncounterPanoramaTheme =
  | 'land-cretaceous'
  | 'air-cretaceous'
  | 'water-cretaceous'
  | 'snow-ice-age'

export type ScaleEncounterPanoramaQuality = 'low' | 'medium' | 'high'

interface NetworkInformationLike {
  readonly effectiveType?: string
  readonly saveData?: boolean
}

interface PanoramaCacheEntry {
  disposeWhenLoaded: boolean
  disposeWhenUnused: boolean
  evicted: boolean
  readonly promise: Promise<Texture>
  readonly theme: ScaleEncounterPanoramaTheme
  retainCount: number
  texture: Texture | null
}

function reviewCandidateUrl(bundledUrl: URL): string {
  return bundledUrl.href
}

export interface ReviewCandidateEnvironmentLease {
  readonly matureTreeAtlas: Texture | null
  readonly panoramaWidth: number
  readonly preferredQuality: ScaleEncounterPanoramaQuality
  readonly preparedLandBiome?: ScaleEncounterPreparedLandBiome | null
  readonly quality: ScaleEncounterPanoramaQuality
  readonly sceneProps?: Group | null
  readonly sourceUrl: string
  readonly surfaceTextures: ScaleEncounterSurfaceTextures | null
  readonly texture: Texture | null
  readonly theme:
    | ScaleEncounterPanoramaTheme
    | ScaleEncounterProceduralLandBiomeThemeId
  release(): void
  startPanoramaUpgrade(): Promise<{
    commit(): void
    discard(): void
    readonly panoramaWidth: number
    readonly sourceUrl: string
    readonly texture: Texture
  } | null>
}

const panoramaUrls = {
  'land-cretaceous': {
    low: reviewCandidateUrl(new URL(
      './assets/environments/panorama-land-cretaceous-2048.webp',
      import.meta.url,
    )),
    medium: reviewCandidateUrl(new URL(
      './assets/environments/panorama-land-cretaceous-4096.webp',
      import.meta.url,
    )),
    high: reviewCandidateUrl(new URL(
      './assets/environments/panorama-land-cretaceous-8192.webp',
      import.meta.url,
    )),
  },
  'air-cretaceous': {
    low: reviewCandidateUrl(new URL(
      './assets/environments/panorama-air-cretaceous-2048.webp',
      import.meta.url,
    )),
    medium: reviewCandidateUrl(new URL(
      './assets/environments/panorama-air-cretaceous-4096.webp',
      import.meta.url,
    )),
    high: reviewCandidateUrl(new URL(
      './assets/environments/panorama-air-cretaceous-8192.webp',
      import.meta.url,
    )),
  },
  'water-cretaceous': {
    low: reviewCandidateUrl(new URL(
      './assets/environments/panorama-water-cretaceous-2048.webp',
      import.meta.url,
    )),
    medium: reviewCandidateUrl(new URL(
      './assets/environments/panorama-water-cretaceous-4096.webp',
      import.meta.url,
    )),
    high: reviewCandidateUrl(new URL(
      './assets/environments/panorama-water-cretaceous-8192.webp',
      import.meta.url,
    )),
  },
  'snow-ice-age': {
    low: reviewCandidateUrl(new URL(
      './assets/environments/panorama-snow-ice-age-2048.webp',
      import.meta.url,
    )),
    medium: reviewCandidateUrl(new URL(
      './assets/environments/panorama-snow-ice-age-4096.webp',
      import.meta.url,
    )),
    high: reviewCandidateUrl(new URL(
      './assets/environments/panorama-snow-ice-age-8192.webp',
      import.meta.url,
    )),
  },
} as const satisfies Readonly<
  Record<
    ScaleEncounterPanoramaTheme,
    Readonly<Record<ScaleEncounterPanoramaQuality, string>>
  >
>

const productionSliceLandPanoramaUrls = {
  low: reviewCandidateUrl(new URL(
    './assets/environments/panorama-land-cretaceous-v5-farfield-2048.webp',
    import.meta.url,
  )),
  medium: reviewCandidateUrl(new URL(
    './assets/environments/panorama-land-cretaceous-v5-farfield-4096.webp',
    import.meta.url,
  )),
} as const

const productionSliceMatureTreeAtlasUrls = {
  high: reviewCandidateUrl(new URL(
    './assets/environments/midground-mature-tree-atlas-v1.webp',
    import.meta.url,
  )),
  low: reviewCandidateUrl(new URL(
    './assets/environments/midground-mature-tree-atlas-v1-1024.webp',
    import.meta.url,
  )),
} as const

const panoramaCache = new Map<string, PanoramaCacheEntry>()

function evictCacheEntry(
  sourceUrl: string,
  entry: PanoramaCacheEntry,
): void {
  entry.evicted = true
  if (entry.texture) {
    entry.texture.dispose()
  } else {
    // TextureLoader cannot be aborted. Remember that this entry no longer has
    // an owner so a decode finishing after reset/theme eviction releases its
    // texture instead of becoming an unreachable GPU resource.
    entry.disposeWhenLoaded = true
  }
  if (panoramaCache.get(sourceUrl) === entry) {
    panoramaCache.delete(sourceUrl)
  }
}

/** Test-only cache teardown for the bounded runtime asset cache. */
export function resetReviewCandidateEnvironmentCacheForTests(): void {
  for (const [sourceUrl, entry] of panoramaCache) {
    evictCacheEntry(sourceUrl, entry)
  }
}

function currentConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (
    navigator as Navigator & {
      readonly connection?: NetworkInformationLike
    }
  ).connection
}

const panoramaWidths = {
  'land-cretaceous': { low: 2048, medium: 4096, high: 8192 },
  'air-cretaceous': { low: 2048, medium: 4096, high: 8192 },
  'water-cretaceous': { low: 2048, medium: 4096, high: 8192 },
  'snow-ice-age': { low: 2048, medium: 4096, high: 8192 },
} as const satisfies Readonly<
  Record<
    ScaleEncounterPanoramaTheme,
    Readonly<Record<ScaleEncounterPanoramaQuality, number>>
  >
>

const surfaceUrls = {
  land: {
    physicalWidthMeters: 2,
    high: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-land-albedo-2048.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-land-normal-2048.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-land-roughness-2048.webp', import.meta.url)),
    },
    low: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-land-albedo-1024.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-land-normal-1024.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-land-roughness-1024.webp', import.meta.url)),
    },
  },
  water: {
    physicalWidthMeters: 15,
    high: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-water-albedo-2048.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-water-normal-2048.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-water-roughness-2048.webp', import.meta.url)),
    },
    low: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-water-albedo-1024.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-water-normal-1024.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-water-roughness-1024.webp', import.meta.url)),
    },
  },
  snow: {
    physicalWidthMeters: 2,
    high: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-snow-albedo-2048.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-snow-normal-2048.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-snow-roughness-2048.webp', import.meta.url)),
    },
    low: {
      albedo: reviewCandidateUrl(new URL('./assets/environments/surface-snow-albedo-1024.webp', import.meta.url)),
      normal: reviewCandidateUrl(new URL('./assets/environments/surface-snow-normal-1024.webp', import.meta.url)),
      roughness: reviewCandidateUrl(new URL('./assets/environments/surface-snow-roughness-1024.webp', import.meta.url)),
    },
  },
} as const

export function scaleEncounterPanoramaThemeFor(
  animalId: ScaleEncounterAnimalId,
): ScaleEncounterPanoramaTheme | null {
  const rendererFamily =
    SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme
  const plan = scaleEncounterEnvironmentThemePlanFor(
    animalId,
    rendererFamily,
  )
  const panoramaTheme = plan.runtime.runtimePanoramaTheme
  return panoramaTheme
}

export function scaleEncounterPanoramaQualityFor(
  connection: NetworkInformationLike | undefined,
  viewportWidth =
    typeof window === 'undefined' ? 1440 : Math.max(window.innerWidth, 1),
  devicePixelRatio =
    typeof window === 'undefined' ? 1 : Math.max(window.devicePixelRatio, 1),
  maximumTextureSize = 8192,
): ScaleEncounterPanoramaQuality {
  if (
    connection?.saveData ||
    ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
  ) {
    return 'low'
  }
  if (maximumTextureSize < 4096) return 'low'
  if (maximumTextureSize < 8192) return 'medium'
  const renderedWidth = viewportWidth * Math.min(devicePixelRatio, 2)
  return viewportWidth <= 900 || renderedWidth < 1_800 ? 'medium' : 'high'
}

function loadPanorama(
  sourceUrl: string,
  theme: ScaleEncounterPanoramaTheme,
): Promise<Texture> {
  const cached = panoramaCache.get(sourceUrl)
  if (cached?.texture) return Promise.resolve(cached.texture)
  if (cached) return cached.promise

  const entryState: { current: PanoramaCacheEntry | null } = {
    current: null,
  }
  const pending = new TextureLoader()
    .loadAsync(sourceUrl)
    .then((texture) => {
      // The source files are 2:1 equirectangular panoramas. The dome uses
      // ordinary UV sampling, while this mapping documents the source
      // projection and keeps the same texture valid if the renderer later
      // moves it to scene.background/environment.
      texture.mapping = EquirectangularReflectionMapping
      texture.colorSpace = SRGBColorSpace
      texture.generateMipmaps = true
      texture.minFilter = LinearMipmapLinearFilter
      texture.magFilter = LinearFilter
      texture.needsUpdate = true
      const entry = entryState.current
      if (!entry || entry.evicted || entry.disposeWhenLoaded) {
        texture.dispose()
        throw new Error(`evicted-environment-texture:${sourceUrl}`)
      }
      entry.texture = texture
      return texture
    })
    .catch((error: unknown) => {
      if (panoramaCache.get(sourceUrl) === entryState.current) {
        panoramaCache.delete(sourceUrl)
      }
      throw error
    })
  const entry: PanoramaCacheEntry = {
    disposeWhenLoaded: false,
    disposeWhenUnused: false,
    evicted: false,
    promise: pending,
    retainCount: 0,
    texture: null,
    theme,
  }
  entryState.current = entry
  panoramaCache.set(sourceUrl, entry)
  return pending
}

function loadSurfaceTexture(
  sourceUrl: string,
  color: boolean,
  theme: ScaleEncounterPanoramaTheme,
  repeat = true,
): Promise<Texture> {
  const cached = panoramaCache.get(sourceUrl)
  if (cached?.texture) return Promise.resolve(cached.texture)
  if (cached) return cached.promise

  const entryState: { current: PanoramaCacheEntry | null } = { current: null }
  const pending = new TextureLoader().loadAsync(sourceUrl).then((texture) => {
    texture.colorSpace = color ? SRGBColorSpace : NoColorSpace
    texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping
    texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.needsUpdate = true
    const entry = entryState.current
    if (!entry || entry.evicted || entry.disposeWhenLoaded) {
      texture.dispose()
      throw new Error(`evicted-environment-texture:${sourceUrl}`)
    }
    entry.texture = texture
    return texture
  }).catch((error: unknown) => {
    if (panoramaCache.get(sourceUrl) === entryState.current) {
      panoramaCache.delete(sourceUrl)
    }
    throw error
  })
  const entry: PanoramaCacheEntry = {
    disposeWhenLoaded: false,
    disposeWhenUnused: false,
    evicted: false,
    promise: pending,
    retainCount: 0,
    texture: null,
    theme,
  }
  entryState.current = entry
  panoramaCache.set(sourceUrl, entry)
  return pending
}

function retainCachedTexture(sourceUrl: string): void {
  const entry = panoramaCache.get(sourceUrl)
  if (!entry) throw new Error(`uncached-environment-texture:${sourceUrl}`)
  entry.retainCount += 1
}

function releaseCachedTexture(sourceUrl: string, disposeNow = false): void {
  const entry = panoramaCache.get(sourceUrl)
  if (!entry) return
  entry.retainCount = Math.max(0, entry.retainCount - 1)
  if (disposeNow) entry.disposeWhenUnused = true
  if (entry.disposeWhenUnused && entry.retainCount === 0) {
    evictCacheEntry(sourceUrl, entry)
  }
}

function evictInactiveOtherThemes(theme: ScaleEncounterPanoramaTheme): void {
  for (const [sourceUrl, entry] of panoramaCache) {
    if (entry.theme === theme || entry.retainCount > 0) continue
    evictCacheEntry(sourceUrl, entry)
  }
}

function surfaceThemeFor(
  theme: ScaleEncounterPanoramaTheme,
): keyof typeof surfaceUrls | null {
  if (theme === 'land-cretaceous') return 'land'
  if (theme === 'snow-ice-age') return 'snow'
  if (theme === 'water-cretaceous') return 'water'
  return null
}

export async function acquireReviewCandidateEnvironment(
  animalId: ScaleEncounterAnimalId,
  connection: NetworkInformationLike | undefined = currentConnection(),
  maximumTextureSize = 8192,
  viewportWidth =
    typeof window === 'undefined' ? 1440 : Math.max(window.innerWidth, 1),
  devicePixelRatio =
    typeof window === 'undefined' ? 1 : Math.max(window.devicePixelRatio, 1),
  environmentVariant?: string,
): Promise<ReviewCandidateEnvironmentLease> {
  const rendererFamily = SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme
  const environmentThemePlan = scaleEncounterEnvironmentThemePlanFor(
    animalId,
    rendererFamily,
  )
  if (environmentThemePlan.runtime.runtimeKind === 'procedural-biome') {
    const { acquireProceduralLandBiomeEnvironmentLease } = await import(
      './environments/land-biomes/load'
    )
    return acquireProceduralLandBiomeEnvironmentLease(
      environmentThemePlan.runtime.id,
      maximumTextureSize,
      connection,
    )
  }
  const theme = scaleEncounterPanoramaThemeFor(animalId)
  if (!theme) {
    throw new Error(
      `scale-encounter-runtime-theme-has-no-panorama:${environmentThemePlan.runtime.id}`,
    )
  }
  evictInactiveOtherThemes(theme)
  const preferredQuality = scaleEncounterPanoramaQualityFor(
    connection,
    viewportWidth,
    devicePixelRatio,
    maximumTextureSize,
  )
  // On a wide screen, install the genuine 4K level for the first rendered
  // encounter frame.  The 8K level is an explicit second-stage request after
  // the interaction becomes usable; this avoids turning an 11 MB forest
  // download into a click-to-enter blocker.
  const quality = preferredQuality === 'high' ? 'medium' : preferredQuality
  const useProductionSliceLandArt =
    theme === 'land-cretaceous' && environmentVariant === 'production-slice'
  const productionSliceLandQuality = quality === 'low' ? 'low' : 'medium'
  const sourceUrl = useProductionSliceLandArt
    ? productionSliceLandPanoramaUrls[productionSliceLandQuality]
    : panoramaUrls[theme][quality]
  const surfaceTheme = surfaceThemeFor(theme)
  const surfaceQuality = quality === 'low' ? 'low' : 'high'
  const surfaceDefinition = surfaceTheme ? surfaceUrls[surfaceTheme] : null
  const surface = surfaceDefinition?.[surfaceQuality] ?? null
  // Use all three channels of the same ground scan at the same physical scale.
  const productionSurface = surface
  const uniqueColourUrl = useProductionSliceLandArt
    ? new URL('./assets/environments/forest-floor-unique-v2.webp', import.meta.url).href
    : null
  const matureTreeAtlasQuality =
    maximumTextureSize >= 2_048 && viewportWidth * devicePixelRatio >= 1_280
      ? 'high'
      : 'low'
  const matureTreeAtlasUrl = useProductionSliceLandArt
    ? productionSliceMatureTreeAtlasUrls[matureTreeAtlasQuality]
    : null
  const [
    texture,
    albedo,
    normal,
    roughness,
    matureTreeAtlas,
    uniqueAlbedo,
  ] = await Promise.all([
    loadPanorama(sourceUrl, theme),
    productionSurface ? loadSurfaceTexture(productionSurface.albedo, true, theme) : Promise.resolve(null),
    productionSurface ? loadSurfaceTexture(productionSurface.normal, false, theme) : Promise.resolve(null),
    productionSurface ? loadSurfaceTexture(productionSurface.roughness, false, theme) : Promise.resolve(null),
    matureTreeAtlasUrl
      ? loadSurfaceTexture(matureTreeAtlasUrl, true, theme, false)
      : Promise.resolve(null),
    uniqueColourUrl ? loadSurfaceTexture(uniqueColourUrl, true, theme, false) : Promise.resolve(null),
  ])
  const retainedUrls = new Set([
    ...(uniqueColourUrl ? [uniqueColourUrl] : []),
    sourceUrl,
    ...(productionSurface
      ? [productionSurface.albedo, productionSurface.normal, productionSurface.roughness]
      : []),
    ...(matureTreeAtlasUrl ? [matureTreeAtlasUrl] : []),
  ])
  retainedUrls.forEach(retainCachedTexture)
  let released = false

  return {
    matureTreeAtlas,
    panoramaWidth: useProductionSliceLandArt
      ? productionSliceLandQuality === 'low' ? 2048 : 4096
      : panoramaWidths[theme][quality],
    preferredQuality: useProductionSliceLandArt
      ? productionSliceLandQuality
      : preferredQuality,
    quality: useProductionSliceLandArt ? productionSliceLandQuality : quality,
    preparedLandBiome: null,
    sourceUrl,
    surfaceTextures:
      albedo && normal && roughness && surfaceDefinition
        ? {
            albedo,
            uniqueAlbedo,
            normal,
            physicalWidthMeters: surfaceDefinition.physicalWidthMeters,
            roughness,
          }
        : null,
    texture,
    theme,
    startPanoramaUpgrade: () => {
      if (useProductionSliceLandArt || preferredQuality !== 'high') {
        return Promise.resolve(null)
      }
      const upgradeSourceUrl = panoramaUrls[theme].high
      return loadPanorama(upgradeSourceUrl, theme).then((upgradeTexture) => {
        retainCachedTexture(upgradeSourceUrl)
        retainedUrls.add(upgradeSourceUrl)
        let settled = false
        return {
          commit: () => {
            if (settled || released) return
            settled = true
            retainedUrls.delete(sourceUrl)
            releaseCachedTexture(sourceUrl, true)
          },
          discard: () => {
            if (settled) return
            settled = true
            retainedUrls.delete(upgradeSourceUrl)
            releaseCachedTexture(upgradeSourceUrl, true)
          },
          panoramaWidth: panoramaWidths[theme].high,
          sourceUrl: upgradeSourceUrl,
          texture: upgradeTexture,
        }
      })
    },
    release: () => {
      if (released) return
      released = true
      // Keep one inactive theme as a same-page reopen cache. Acquiring another
      // animal evicts these zero-retain entries, which bounds a multi-animal
      // review session instead of accumulating every 8K decode indefinitely.
      retainedUrls.forEach((url) => releaseCachedTexture(url))
      retainedUrls.clear()
    },
  }
}
