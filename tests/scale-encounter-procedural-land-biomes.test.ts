import {
  Mesh,
  Texture,
  TextureLoader,
  type Material,
  type MeshStandardMaterial,
  type ShaderMaterial,
} from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import {
  acquireProceduralLandBiomeEnvironmentLease,
  loadPreparedScaleEncounterLandBiome,
} from '../src/scale-encounter/environments/land-biomes/load'
import { resetScaleEncounterLandBiomeArtCacheForTests } from '../src/scale-encounter/environments/land-biomes/assets'
import type { ScaleEncounterProceduralLandBiomeThemeId } from '../src/scale-encounter/environments/land-biomes/types'
import {
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
  updateScaleEncounterEnvironment,
} from '../src/viewer/scale-encounter-environment'
import { createScaleEncounterProceduralLandBiome } from '../src/viewer/scale-encounter-procedural-land-biome'
import type { ScaleEncounterAnimalId } from '../src/viewer/scale-encounter'

const THEME_CASES = [
  {
    animalId: 'gigantoraptor',
    absentMarkers: ['swamp-pool', 'distant-mesa-batch'],
    markers: ['terrain', 'drought-shrub-batch', 'seasonal-channel-water'],
    panoramaFile: 'panorama-land-cretaceous-v5-farfield-4096.webp',
    profile: 'gobi-braided-basin',
    themeId: 'gobi',
    groundFile: 'surface-land-albedo-1024.webp',
  },
  {
    animalId: 'dilophosaurus',
    absentMarkers: ['lycopsid', 'calamites'],
    markers: [
      'terrain',
      'seasonal-channel-water',
      'fern-frond-batch',
    ],
    panoramaFile: 'panorama-air-cretaceous-4096.webp',
    profile: 'kayenta-seasonal-floodplain',
    themeId: 'floodplain',
    groundFile: 'surface-land-albedo-1024.webp',
  },
  {
    animalId: 'meganeura',
    absentMarkers: ['drought-shrub', 'distant-mesa', 'seasonal-channel-water'],
    markers: [
      'terrain',
      'swamp-pool',
      'lycopsid-sigillaria-trunks',
      'lycopsid-terminal-crowns',
      'calamites-segmented-stems',
      'calamites-joint-rings',
      'calamites-leaf-sprays',
      'fern-frond-batch',
    ],
    panoramaFile:
      'panorama-carboniferous-wetland-photoreal-v1-4096.webp',
    profile: 'carboniferous-coal-swamp',
    themeId: 'carboniferous-wetland-forest',
    groundFile: 'surface-carboniferous-peat-albedo-v1.webp',
  },
] as const satisfies readonly {
  readonly absentMarkers: readonly string[]
  readonly animalId: ScaleEncounterAnimalId
  readonly markers: readonly string[]
  readonly groundFile: string
  readonly panoramaFile: string
  readonly profile: string
  readonly themeId: ScaleEncounterProceduralLandBiomeThemeId
}[]

function sceneNames(root: { traverse(callback: (object: { name: string }) => void): void }): string[] {
  const names: string[] = []
  root.traverse((object) => names.push(object.name))
  return names
}

describe('scale encounter procedural land biomes', () => {
  afterEach(() => {
    resetScaleEncounterLandBiomeArtCacheForTests()
    vi.restoreAllMocks()
  })

  it.each(THEME_CASES)(
    'loads only the exact approved $themeId ground and far-field package',
    async ({ groundFile, panoramaFile, profile, themeId }) => {
      const textureLoad = vi
        .spyOn(TextureLoader.prototype, 'loadAsync')
        .mockImplementation(() => Promise.resolve(new Texture()))
      const lease = await acquireProceduralLandBiomeEnvironmentLease(themeId)

      expect(textureLoad).toHaveBeenCalledTimes(
        themeId === 'carboniferous-wetland-forest' ? 5 : 6,
      )
      const requestedUrls = textureLoad.mock.calls.map(([sourceUrl]) =>
        String(sourceUrl),
      )
      expect(requestedUrls.some((url) => url.includes(panoramaFile))).toBe(true)
      expect(requestedUrls.some((url) => url.includes(groundFile))).toBe(true)
      const unrelatedThemeFiles = THEME_CASES
        .filter((theme) => theme.themeId !== themeId && theme.groundFile !== groundFile)
        .map((theme) => theme.groundFile)
      unrelatedThemeFiles.forEach((fileName) => {
        expect(requestedUrls.some((url) => url.includes(fileName))).toBe(false)
      })
      expect(lease.texture).toBeInstanceOf(Texture)
      expect(lease.panoramaWidth).toBe(4096)
      expect(lease.sourceUrl).toContain(panoramaFile)
      expect(lease.surfaceTextures).toMatchObject({
        physicalWidthMeters: 2,
      })
      expect(lease.preparedLandBiome).toMatchObject({
        profile,
        themeId,
      })
      expect(lease.matureTreeAtlas instanceof Texture).toBe(
        themeId !== 'carboniferous-wetland-forest',
      )
      expect(
        lease.surfaceTextures?.landBiomeFrondAtlas instanceof Texture,
      ).toBe(themeId === 'carboniferous-wetland-forest')
      await expect(lease.startPanoramaUpgrade()).resolves.toBeNull()
      lease.release()
    },
  )

  it('installs the prepared panorama and PBR ground without transferring cache ownership', async () => {
    const preparedLandBiome = await loadPreparedScaleEncounterLandBiome('gobi')
    const panorama = new Texture()
    const albedo = new Texture()
    const normal = new Texture()
    const roughness = new Texture()
    const environment = createScaleEncounterProceduralLandBiome(
      preparedLandBiome,
      'production-slice',
      {
        animalId: 'gigantoraptor',
        surfaceTextures: {
          albedo,
          normal,
          physicalWidthMeters: 2,
          roughness,
        },
      },
      panorama,
    )
    if (!environment) throw new Error('Expected photoreal Gobi environment.')

    expect(environment.panoramaTexture).toBe(panorama)
    expect(environment.skyDome.name).toContain('distant-art-dome')
    expect(environment.borrowedTextures).toEqual(
      new Set([panorama, albedo, normal, roughness]),
    )
    const terrain = environment.root.getObjectByName(
      'scale-encounter-gobi-terrain',
    )
    if (!(terrain instanceof Mesh)) throw new Error('Expected terrain mesh.')
    expect((terrain.material as MeshStandardMaterial).map).toBe(albedo)
    expect(
      (terrain.material as MeshStandardMaterial).userData
        .scaleEncounterLandBiomeGroundMaterial,
    ).toBe('land-biome-stochastic-pbr-v1')
    const disposePanorama = vi.spyOn(panorama, 'dispose')
    const disposeAlbedo = vi.spyOn(albedo, 'dispose')
    disposeScaleEncounterEnvironment(environment)
    expect(disposePanorama).not.toHaveBeenCalled()
    expect(disposeAlbedo).not.toHaveBeenCalled()
  })

  it('reuses the sky-only plate at 2K for a constrained connection', async () => {
    const textureLoad = vi
      .spyOn(TextureLoader.prototype, 'loadAsync')
      .mockImplementation(() => Promise.resolve(new Texture()))
    const lease = await acquireProceduralLandBiomeEnvironmentLease(
      'floodplain',
      8192,
      { saveData: true },
    )

    expect(lease.quality).toBe('low')
    expect(lease.panoramaWidth).toBe(2048)
    expect(lease.sourceUrl).toContain(
      'panorama-air-cretaceous-2048.webp',
    )
    expect(
      textureLoad.mock.calls.some(([sourceUrl]) =>
        String(sourceUrl).includes(
          'panorama-air-cretaceous-4096.webp',
        ),
      ),
    ).toBe(false)
    lease.release()
  })

  it.each(THEME_CASES)(
    'builds a complete and ecologically distinct $themeId world from the shared factory',
    async ({ absentMarkers, animalId, markers, profile, themeId }) => {
      const preparedLandBiome = await loadPreparedScaleEncounterLandBiome(themeId)
      const environment = createScaleEncounterProceduralLandBiome(
        preparedLandBiome,
        'production-slice',
        {
          animalId,
          ecologyDensity: 'current',
        },
      )
      if (!environment) throw new Error(`Expected the ${themeId} environment.`)

      expect(environment.sceneCandidateSemantic).toBe('land-biome')
      expect(environment.ownsLighting).toBe(true)
      expect(environment.panoramaTexture).toBeNull()
      expect(environment.borrowedTextures.size).toBe(0)
      expect(environment.groundHeightAtWorld?.(0, 0)).toBeCloseTo(0, 6)
      expect(environment.root.userData).toMatchObject({
        scaleEncounterEnvironmentBaselineReady: true,
        scaleEncounterEnvironmentRuntimeKind: 'procedural-biome',
        scaleEncounterEnvironmentRuntimeTheme: themeId,
        scaleEncounterEnvironmentTargetTheme: themeId,
        scaleEncounterEnvironmentUsingCompatibilityFallback: false,
        scaleEncounterLandBiomeProfile: profile,
      })

      const names = sceneNames(environment.root)
      markers.forEach((marker) => {
        expect(names.some((name) => name.includes(marker))).toBe(true)
      })
      absentMarkers.forEach((marker) => {
        expect(names.some((name) => name.includes(marker))).toBe(false)
      })
      if (themeId === 'carboniferous-wetland-forest') {
        expect(
          names.some((name) =>
            /(flower|broadleaf|palm|rainforest)/i.test(name),
          ),
        ).toBe(false)
      }

      const terrain = environment.root.getObjectByName(
        `scale-encounter-${themeId}-terrain`,
      )
      if (!(terrain instanceof Mesh)) throw new Error('Expected terrain mesh.')
      const disposeGeometry = vi.spyOn(terrain.geometry, 'dispose')
      const terrainMaterial = terrain.material as Material
      const disposeMaterial = vi.spyOn(terrainMaterial, 'dispose')
      disposeScaleEncounterEnvironment(environment)
      expect(disposeGeometry).toHaveBeenCalledOnce()
      expect(disposeMaterial).toHaveBeenCalledOnce()
    },
  )

  it('keeps the unselected Carboniferous candidate out of the forest encounter', () => {
    const panorama = new Texture()
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      panorama,
      { animalId: 'meganeura' },
    )

    expect(environment?.root.userData).toMatchObject({
      scaleEncounterEnvironmentRuntimeTheme: 'cretaceous-forest',
      scaleEncounterEnvironmentTargetTheme: 'cretaceous-forest',
      scaleEncounterEnvironmentUsingCompatibilityFallback: false,
    })
    expect(
      environment?.root.getObjectByName('scale-encounter-gobi-terrain'),
    ).toBeFalsy()
    expect(
      environment?.root.getObjectByName(
        'scale-encounter-accepted-forested-mountain-basin',
      ),
    ).toBeTruthy()
    disposeScaleEncounterEnvironment(environment)
    panorama.dispose()
  })

  it.each([
    ['floodplain', 'dilophosaurus'],
    ['gobi', 'gigantoraptor'],
  ] as const)('keeps %s river banks, wading depth and moving reflection on one fixed surface', async (themeId, animalId) => {
    const preparedLandBiome = await loadPreparedScaleEncounterLandBiome(themeId)
    const current = createScaleEncounterProceduralLandBiome(
      preparedLandBiome,
      'production-slice',
      {
        animalId,
        ecologyDensity: 'current',
      },
    )
    const dense = createScaleEncounterProceduralLandBiome(
      preparedLandBiome,
      'production-slice',
      {
        animalId,
        ecologyDensity: '1.5x',
      },
    )
    if (!current || !dense) throw new Error('Expected floodplain environments.')

    const currentPopulation = current.root.userData
      .scaleEncounterLandBiomePopulation as Record<string, number>
    const densePopulation = dense.root.userData
      .scaleEncounterLandBiomePopulation as Record<string, number>
    expect(densePopulation.ferns! + densePopulation.shrubs!).toBeGreaterThan(currentPopulation.ferns! + currentPopulation.shrubs!)


    const water = current.root.getObjectByName(
      `scale-encounter-${themeId}-seasonal-channel-water`,
    )
    if (!(water instanceof Reflector)) throw new Error('Expected reflective channel water.')
    const waterMaterial = water.material as ShaderMaterial
    // Three refreshes these uniforms on the first render whenever fog is on.
    // Omitting them used to make the entire encounter fail at entry.
    expect(waterMaterial.fog).toBe(true)
    for (const key of ['fogColor', 'fogNear', 'fogFar']) {
      expect(waterMaterial.uniforms[key]).toHaveProperty('value')
    }
    const positions = water.geometry.getAttribute('position')
    const depths = water.geometry.getAttribute('waterDepth')
    // The reach at the animal's X position must read as a river in portrait.
    const middle = (positions.count / 13 - 1) / 2 * 13
    expect(Math.abs(positions.getY(middle + 12) - positions.getY(middle))).toBeGreaterThan(12)
    expect(current.groundHeightAtWorld!(2.2, 0)).toBeGreaterThan(water.position.y)
    expect(current.groundHeightAtWorld!(-13, 0)).toBeGreaterThan(water.position.y)
    expect(water.geometry.getAttribute('normal').getZ(240 * 13 + 6)).toBeCloseTo(1)
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const z = -positions.getY(index)
      const terrainHeight = current.groundHeightAtWorld!(x, z)
      expect(depths.getX(index)).toBeCloseTo(Math.max(0, water.position.y - terrainHeight), 4)
      expect(depths.getX(index)).toBeLessThanOrEqual(0.50001)
      if (index % 13 === 0 || index % 13 === 12) {
        expect(depths.getX(index)).toBeLessThan(0.002)
      }
    }
    const disposeReflection = vi.spyOn(water.getRenderTarget(), 'dispose')
    const before = water.position.y
    updateScaleEncounterEnvironment(current, 3, false)
    expect(water.position.y).toBe(before)
    expect((water.material as ShaderMaterial).uniforms.uTime?.value).toBe(3)


    disposeScaleEncounterEnvironment(current)
    expect(disposeReflection).toHaveBeenCalledOnce()
    disposeScaleEncounterEnvironment(dense)
  })
})
