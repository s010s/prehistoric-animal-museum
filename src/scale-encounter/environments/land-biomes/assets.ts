import {
  EquirectangularReflectionMapping,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Group,
  type Texture,
} from 'three'
import type { ScaleEncounterSurfaceTextures } from '../../../viewer/scale-encounter-environment'
import {
  loadReviewCandidateForestEcology,
  loadReviewCandidateForestEcologyProps,
} from '../../forest-ecology-review-candidate'
import type {
  ScaleEncounterPreparedLandBiome,
  ScaleEncounterProceduralLandBiomeThemeId,
} from './types'

interface LandBiomeTextureCacheEntry {
  readonly promise: Promise<Texture>
  retainCount: number
  readonly scope: ScaleEncounterProceduralLandBiomeThemeId | 'shared'
  texture: Texture | null
}

interface ScaleEncounterLandBiomeArtLease {
  readonly matureTreeAtlas: Texture | null
  readonly panorama: Texture
  readonly props: Group | null
  readonly surfaceTextures: ScaleEncounterSurfaceTextures
  release(): void
}

const sharedNormalSourceUrl = new URL(
  '../../assets/environments/surface-land-normal-1024.webp',
  import.meta.url,
).href
const sharedRoughnessSourceUrl = new URL(
  '../../assets/environments/surface-land-roughness-1024.webp',
  import.meta.url,
).href
const matureTreeAtlasSourceUrl = new URL(
  '../../assets/environments/midground-mature-tree-atlas-v1.webp',
  import.meta.url,
).href
const carboniferousFrondAtlasSourceUrl = new URL(
  '../../assets/environments/midground-frond-components-v4-final.webp',
  import.meta.url,
).href

const textureCache = new Map<string, LandBiomeTextureCacheEntry>()

function disposeEntry(sourceUrl: string, entry: LandBiomeTextureCacheEntry): void {
  if (textureCache.get(sourceUrl) !== entry) return
  textureCache.delete(sourceUrl)
  void entry.promise.then((texture) => texture.dispose()).catch(() => undefined)
}

function evictInactiveThemeTextures(
  activeTheme: ScaleEncounterProceduralLandBiomeThemeId,
): void {
  for (const [sourceUrl, entry] of textureCache) {
    if (
      entry.scope === 'shared' ||
      entry.scope === activeTheme ||
      entry.retainCount > 0
    ) {
      continue
    }
    disposeEntry(sourceUrl, entry)
  }
}

function loadTexture(
  sourceUrl: string,
  scope: ScaleEncounterProceduralLandBiomeThemeId | 'shared',
  kind: 'colour' | 'data' | 'panorama',
): Promise<Texture> {
  const cached = textureCache.get(sourceUrl)
  if (cached) return cached.promise

  const promise = new TextureLoader()
    .loadAsync(sourceUrl)
    .then((texture) => {
      texture.colorSpace = kind === 'data' ? NoColorSpace : SRGBColorSpace
      if (kind === 'panorama') {
        texture.mapping = EquirectangularReflectionMapping
      } else {
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
      }
      texture.generateMipmaps = true
      texture.minFilter = LinearMipmapLinearFilter
      texture.magFilter = LinearFilter
      texture.needsUpdate = true
      const liveEntry = textureCache.get(sourceUrl)
      if (!liveEntry || liveEntry.promise !== promise) {
        texture.dispose()
        throw new Error(`evicted-land-biome-texture:${sourceUrl}`)
      }
      liveEntry.texture = texture
      return texture
    })
    .catch((error: unknown) => {
      const liveEntry = textureCache.get(sourceUrl)
      if (liveEntry?.promise === promise) textureCache.delete(sourceUrl)
      throw error
    })
  textureCache.set(sourceUrl, {
    promise,
    retainCount: 0,
    scope,
    texture: null,
  })
  return promise
}

function retain(sourceUrl: string): void {
  const entry = textureCache.get(sourceUrl)
  if (!entry) throw new Error(`uncached-land-biome-texture:${sourceUrl}`)
  entry.retainCount += 1
}

function release(sourceUrl: string): void {
  const entry = textureCache.get(sourceUrl)
  if (!entry) return
  entry.retainCount = Math.max(0, entry.retainCount - 1)
}

export async function acquireScaleEncounterLandBiomeArt(
  biome: ScaleEncounterPreparedLandBiome,
  panoramaSourceUrl = biome.assets.panoramaSourceUrl,
): Promise<ScaleEncounterLandBiomeArtLease> {
  evictInactiveThemeTextures(biome.themeId)
  const uniqueSourceUrl = biome.assets.uniqueGroundSourceUrl
  const urls = [
    panoramaSourceUrl,
    biome.assets.groundAlbedoSourceUrl,
    sharedNormalSourceUrl,
    sharedRoughnessSourceUrl,
    ...(biome.profile !== 'carboniferous-coal-swamp'
      ? [matureTreeAtlasSourceUrl]
      : []),
    ...(biome.profile === 'carboniferous-coal-swamp'
      ? [carboniferousFrondAtlasSourceUrl]
      : []),
    ...(uniqueSourceUrl ? [uniqueSourceUrl] : []),
  ]
  const [
    panorama,
    albedo,
    normal,
    roughness,
    matureTreeAtlas,
    landBiomeFrondAtlas,
    uniqueAlbedo,
    props,
  ] =
    await Promise.all([
      // Existing art plates provide the distant backdrop; the walkable floor,
      // banks and near vegetation are continuous world-space geometry.
      loadTexture(urls[0]!, 'shared', 'panorama'),
      loadTexture(urls[1]!, biome.themeId, 'colour'),
      loadTexture(urls[2]!, 'shared', 'data'),
      loadTexture(urls[3]!, 'shared', 'data'),
      biome.profile !== 'carboniferous-coal-swamp'
        ? loadTexture(matureTreeAtlasSourceUrl, biome.themeId, 'colour')
        : Promise.resolve(null),
      biome.profile === 'carboniferous-coal-swamp'
        ? loadTexture(carboniferousFrondAtlasSourceUrl, biome.themeId, 'colour')
        : Promise.resolve(null),
      uniqueSourceUrl ? loadTexture(uniqueSourceUrl, biome.themeId, 'colour') : Promise.resolve(null),
      import.meta.env.MODE === 'test'
        ? Promise.resolve(null)
        : biome.profile !== 'carboniferous-coal-swamp'
          ? loadReviewCandidateForestEcology()
          : loadReviewCandidateForestEcologyProps(),
    ])
  if (uniqueAlbedo) uniqueAlbedo.wrapS = uniqueAlbedo.wrapT = ClampToEdgeWrapping
  urls.forEach(retain)
  let released = false

  return {
    matureTreeAtlas,
    panorama,
    props,
    surfaceTextures: {
      albedo,
      uniqueAlbedo,
      landBiomeFrondAtlas,
      normal,
      physicalWidthMeters: biome.assets.groundPhysicalWidthMeters,
      roughness,
    },
    release: () => {
      if (released) return
      released = true
      urls.forEach(release)
    },
  }
}

/** Test-only cache teardown for decoded texture ownership assertions. */
export function resetScaleEncounterLandBiomeArtCacheForTests(): void {
  for (const [sourceUrl, entry] of textureCache) {
    disposeEntry(sourceUrl, entry)
  }
}
