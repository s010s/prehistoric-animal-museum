import { DirectionalLight, Mesh, type MeshStandardMaterial, ShaderMaterial, Texture, TextureLoader, type WebGLRenderer } from 'three'

import {
  MAMMOTH_PALAEOENVIRONMENT_ANCHOR,
  MAMMOTH_PALAEOENVIRONMENT_PRODUCTION_CANDIDATE_ID,
  computeMammothOverviewFittingFieldOfView,
  createMammothPalaeoenvironmentCandidate,
  mammothPalaeoenvironmentGroundY,
} from '../src/scale-encounter/environments/glacier'

describe('mammoth palaeoenvironment teaching composite', () => {
  it('keeps a lit soil fallback until the ground image has loaded', () => {
    const pending: { texture: Texture<HTMLImageElement>; loaded: ((texture: Texture<HTMLImageElement>) => void) | undefined }[] = []
    const loader = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, loaded) => {
      const texture = new Texture<HTMLImageElement>()
      pending.push({ texture, loaded })
      return texture
    })
    const candidate = createMammothPalaeoenvironmentCandidate('B')
    try {
      const ground = candidate.root.getObjectByName('glacier-ground-surface-unglaciated-land') as Mesh
      const material = ground.material as MeshStandardMaterial
      const shader = {
        uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
        fragmentShader: '#include <common>\n#include <map_fragment>\n#include <opaque_fragment>',
      } as unknown as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as WebGLRenderer)
      const readiness = shader.uniforms.mammothGroundAlbedoReady!
      expect(readiness.value).toBe(0)
      expect(shader.fragmentShader).toContain('if (mammothGroundAlbedoReady < 0.5) diffuseColor.rgb = vec3(0.42, 0.36, 0.26)')
      const image = pending.find((entry) => entry.texture === material.map)!
      expect(image).toBeDefined()
      image.loaded!(image.texture)
      expect(readiness.value).toBe(1)
    } finally { candidate.dispose(); loader.mockRestore() }
  })

  it('fits the narrow overview against minimum zoom without changing wide framing', () => {
    const mobileFittingFieldOfView =
      computeMammothOverviewFittingFieldOfView(30, 390 / 844)

    expect(mobileFittingFieldOfView).toBeGreaterThan(24)
    expect(mobileFittingFieldOfView).toBeLessThan(25)
    expect(computeMammothOverviewFittingFieldOfView(30, 16 / 9)).toBe(30)
    expect(() => computeMammothOverviewFittingFieldOfView(30, 0)).toThrow(
      'mammoth-overview-aspect-out-of-range',
    )
  })

  it('records the chosen place, time, season and distant-ice role without claiming a site photograph', () => {
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.id).toBe(
      'eastern-alps-mis3-teaching-composite-v1',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.reconstructionType).toBe(
      'teaching-composite',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.location.region).toContain(
      'Lower Inn Valley',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.time.interval).toContain(
      '47–43 cal ka BP',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.seasonClimate.season).toBe(
      '晚春清晨',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.iceRole.type).toBe(
      'distant-high-elevation-glacier-and-ice-covered-ridge',
    )
    expect(MAMMOTH_PALAEOENVIRONMENT_ANCHOR.unknowns.join(' ')).toContain(
      '教学型综合复原',
    )
  })

  it('keeps the established mammoth-child rail level and moves relief outside it', () => {
    for (const x of [-12, -8, -4, 0, 4, 6]) {
      expect(mammothPalaeoenvironmentGroundY(x, 0)).toBeCloseTo(0, 8)
    }
    expect(Math.abs(mammothPalaeoenvironmentGroundY(52, -44))).toBeGreaterThan(
      0.08,
    )
  })

  it('switches A, B and C without changing the shared subject contract', () => {
    const candidate = createMammothPalaeoenvironmentCandidate('A')
    expect(candidate.layers.background.visible).toBe(true)
    expect(candidate.layers.farIceMass.visible).toBe(true)
    expect(candidate.layers.groundSurface.visible).toBe(true)
    expect(candidate.layers.nearGround.visible).toBe(true)
    expect(candidate.layers.farLandform.visible).toBe(true)
    expect(
      candidate.root.getObjectByName('glacier-far-rock-ridge')?.visible,
    ).toBe(false)
    expect(candidate.fog()).not.toBeNull()
    const a = candidate.diagnostics().resourceEstimate

    candidate.setVariant('B')
    expect(candidate.layers.groundSurface.visible).toBe(true)
    expect(candidate.layers.snowLayer.visible).toBe(true)
    expect(candidate.layers.nearGround.visible).toBe(true)
    expect(candidate.layers.farLandform.visible).toBe(false)
    expect(
      candidate.root.getObjectByName('glacier-far-rock-ridge')?.visible,
    ).toBe(true)
    expect(
      candidate.root.getObjectByName('glacier-rear-snow-peak-range')?.visible,
    ).toBe(true)
    expect(
      candidate.root.getObjectByName('glacier-front-moraine-ridge')?.visible,
    ).toBe(true)
    expect(
      candidate.root.getObjectByName(
        'glacier-far-ice-mass-direction-reference',
      )?.visible,
    ).toBe(true)
    expect(
      candidate.root.getObjectByName(
        'glacier-middle-distance-frozen-valley-channel',
      )?.visible,
    ).toBe(false)
    expect(candidate.fog()).toBeNull()
    const centreMountain = candidate.root.getObjectByName(
      'glacier-far-rock-ridge',
    ) as Mesh
    const bSnowAmount = (
      (centreMountain.material as ShaderMaterial).uniforms.snowAmount
        ?.value as number
    )
    const b = candidate.diagnostics().resourceEstimate

    candidate.setVariant('C')
    expect(candidate.layers.nearGround.visible).toBe(true)
    expect(candidate.layers.midSteppe.visible).toBe(true)
    expect(candidate.layers.farLandform.visible).toBe(true)
    expect(candidate.layers.atmosphere.visible).toBe(true)
    const cSnowAmount = (
      (centreMountain.material as ShaderMaterial).uniforms.snowAmount
        ?.value as number
    )
    expect(cSnowAmount).toBeGreaterThan(bSnowAmount)
    expect(
      candidate.root.getObjectByName(
        'glacier-middle-distance-frozen-valley-channel',
      )?.visible,
    ).toBe(true)
    expect(
      candidate.root.getObjectByName(
        'glacier-middle-distance-frozen-foothills',
      )?.visible,
    ).toBe(true)
    expect(candidate.fog()).not.toBeNull()
    const c = candidate.diagnostics().resourceEstimate

    expect(c.triangles).toBeGreaterThan(a.triangles)
    expect(c.triangles).toBeGreaterThan(b.triangles)
    expect(c.drawCalls).toBeGreaterThan(a.drawCalls)
    expect(c.drawCalls).toBeGreaterThan(b.drawCalls)
    candidate.dispose()
  })

  it('registers the background architecture prototype and lazy photographic baseline', () => {
    const candidate = createMammothPalaeoenvironmentCandidate('C')
    expect(candidate.root.name).toBe(
      'scale-encounter-glacier-palaeoenvironment-production-candidate',
    )
    expect(
      candidate.root.userData.mammothPalaeoenvironmentProductionCandidate,
    ).toMatchObject({
      candidateId: MAMMOTH_PALAEOENVIRONMENT_PRODUCTION_CANDIDATE_ID,
      visualSystem: 'mammoth-background-architecture-prototype-v8',
    })

    const sky = candidate.root.getObjectByName(
      'glacier-background-atmosphere-sky',
    )
    expect(sky).toBeInstanceOf(Mesh)
    expect((sky as Mesh).material).toBeInstanceOf(ShaderMaterial)
    expect(sky?.userData.mammothBackgroundMode).toBe('analytic-sky')
    expect(
      ((sky as Mesh).material as ShaderMaterial).uniforms.panoramaMix?.value,
    ).toBe(0)
    const panorama: unknown = (
      (sky as Mesh).material as ShaderMaterial
    ).uniforms.panoramaMap?.value
    expect(panorama).toBeInstanceOf(Texture)
    expect((panorama as Texture).name).toBe(
      'mammoth-analytic-sky-placeholder',
    )
    expect(candidate.diagnostics().resourceEstimate.textures).toBeGreaterThanOrEqual(4)
    const subjectFill = candidate.root.getObjectByName(
      'glacier-world-subject-fill',
    )
    expect(subjectFill).toBeInstanceOf(DirectionalLight)
    expect((subjectFill as DirectionalLight).intensity).toBeCloseTo(1.28)
    const snow = candidate.root.getObjectByName(
      'glacier-snow-layer-near-wind-drifts',
    )
    expect(snow?.userData.persistentAcrossCameraStages).toBe(true)
    const frozenCrust = candidate.root.getObjectByName(
      'glacier-snow-layer-wind-polished-frozen-crust',
    )
    expect(frozenCrust?.userData.persistentAcrossCameraStages).toBe(true)
    expect(
      candidate.root.getObjectByName(
        'glacier-far-unglaciated-valley-terrace',
      )?.visible,
    ).toBe(false)
    expect(
      candidate.root.getObjectByName(
        'glacier-middle-distance-frozen-foothills',
      )?.visible,
    ).toBe(true)
    const ground = candidate.root.getObjectByName(
      'glacier-ground-surface-unglaciated-land',
    ) as Mesh
    expect((ground.material as { map?: Texture }).map?.name).toBe(
      'mammoth-tundra-ground-albedo-v2',
    )
    const grass = candidate.root.getObjectByName(
      'glacier-near-grass-and-sedge',
    ) as Mesh
    expect((grass.material as { map?: Texture }).map?.name).toBe(
      'mammoth-tundra-sedge-clump-v2',
    )
    candidate.dispose()

    const photographicCandidate = createMammothPalaeoenvironmentCandidate('A')
    const photographicSky = photographicCandidate.root.getObjectByName(
      'glacier-background-atmosphere-sky',
    ) as Mesh
    expect(photographicSky.userData.mammothBackgroundMode).toBe(
      'photographic-panorama',
    )
    expect(
      (photographicSky.material as ShaderMaterial).uniforms.panoramaMix?.value,
    ).toBe(1)
    expect(
      (
        (photographicSky.material as ShaderMaterial).uniforms.panoramaMap
          ?.value as Texture
      ).name,
    ).toBe('mammoth-eastern-alps-mis3-panorama-v2')
    photographicCandidate.dispose()
  })

  it('keeps ice remote and leaves dangerous ice layers empty', () => {
    const candidate = createMammothPalaeoenvironmentCandidate('C')
    const diagnostics = candidate.diagnostics()
    expect(diagnostics.farIceVolume.minimumCorridorSeparationMeters).toBeGreaterThan(
      180,
    )
    expect(diagnostics.farIceVolume.role).toContain('不可接近')
    expect(diagnostics.crevasseCount).toBe(0)
    expect(diagnostics.iceTowerCount).toBe(0)
    expect(diagnostics.groundSurface.kind).toBe(
      'unglaciated-loess-and-permafrost-topsoil',
    )
    expect(diagnostics.groundSurface.supportsSubjects).toBe(true)
    expect(diagnostics.snowLayer.supportsSubjects).toBe(false)
    candidate.dispose()
  })

  it('offers bounded surface states without turning the valley into a white ice field', () => {
    const candidate = createMammothPalaeoenvironmentCandidate(
      'C',
      'wind-scoured',
    )
    const windScoured = candidate.diagnostics()
    candidate.setSurfaceState('balanced')
    const balanced = candidate.diagnostics()
    candidate.setSurfaceState('late-snow')
    const lateSnow = candidate.diagnostics()

    expect(windScoured.snowLayer.approximateCoverFraction).toBe(0.22)
    expect(balanced.snowLayer.approximateCoverFraction).toBe(0.4)
    expect(lateSnow.snowLayer.approximateCoverFraction).toBe(0.49)
    expect(windScoured.layerCounts.snowPatches).toBeLessThan(
      balanced.layerCounts.snowPatches,
    )
    expect(balanced.layerCounts.snowPatches).toBeLessThan(
      lateSnow.layerCounts.snowPatches,
    )
    expect(lateSnow.snowLayer.approximateCoverFraction).toBeLessThan(0.5)
    candidate.dispose()
  })
})
