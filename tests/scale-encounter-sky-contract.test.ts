import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Box3,
  BoxGeometry,
  Group,
  Texture,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  type ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three'
import {
  SKY_HEIGHT_BANDS,
  SKY_LOCKED_AVATAR_BASES,
  SKY_LOCKED_CAMERA,
  SKY_LOCKED_SUBJECT,
  SKY_PRODUCTION_REVIEW_CANDIDATE,
  SKY_REFERENCE_Y_METERS,
  SKY_RUNTIME_AVATAR_PRESENTATION,
  SKY_VARIANTS,
  createSkyEnvironmentCandidate,
  skyAltitudeMeters,
  skyBandForAltitude,
  skyLayersForVariant,
} from '../src/scale-encounter/environments/sky'
import {
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
} from '../src/viewer/scale-encounter-environment'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  scaleEncounterSubjectLayoutForAspect,
} from '../src/viewer/scale-encounter'

const skyReviewManifestPath = resolve(
  process.cwd(),
  'src/scale-encounter/assets/environments/sky/manifest.json',
)
const skyManifestTestTitle =
  'records D as the Leon-approved production default'

describe('scale encounter sky phase-two contract', () => {
  it('locks the existing Pteranodon scale and camera without copying forest values', () => {
    const shared = SCALE_ENCOUNTER_DEFINITIONS.pteranodon
    expect(SKY_LOCKED_SUBJECT).toMatchObject({
      animalId: 'pteranodon',
      calibratedModelSha256: shared.calibratedModelSha256,
      displayedWingspanMeters: shared.displayedMeters,
      support: shared.support,
    })
    expect(SKY_LOCKED_CAMERA).toMatchObject({
      defaultDistanceMeters: shared.defaultDistance,
      minimumDistanceMeters: shared.minimumDistance,
      maximumDistanceMeters: shared.maximumDistance,
      overviewFieldOfViewDegrees: shared.overviewFieldOfView,
      povFieldOfViewDegrees: shared.povFieldOfView,
      transitionDurationMs: shared.guidedTransitionDurationMs,
    })
    expect(SKY_LOCKED_CAMERA.overviewDirection.distanceTo(shared.overviewDirection)).toBeLessThan(
      1e-12,
    )
    expect(SKY_LOCKED_CAMERA.overviewUp.distanceTo(shared.overviewUp)).toBeLessThan(
      1e-12,
    )
  })

  it('keeps A, B, C and coherent-radiance D isolated by the handoff layer boundary', () => {
    expect(skyLayersForVariant('A')).toEqual([
      'subject',
      'background-atmosphere',
    ])
    expect(skyLayersForVariant('B')).toEqual([
      'subject',
      'background-atmosphere',
      'flight-volume',
    ])
    expect(skyLayersForVariant('C')).toEqual([
      'subject',
      'background-atmosphere',
      'flight-volume',
      'near-air',
      'mid-cloud',
      'far-cloud',
    ])
    expect(skyLayersForVariant('D')).toEqual(skyLayersForVariant('C'))
    expect(Object.keys(SKY_VARIANTS)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('uses one explicit world reference and named non-overlapping cloud bands', () => {
    expect(SKY_REFERENCE_Y_METERS).toBe(-60)
    expect(skyAltitudeMeters(4.8)).toBeCloseTo(64.8, 10)
    expect(SKY_HEIGHT_BANDS.map((band) => band.id)).toEqual([
      'subject-flight',
      'near-air',
      'mid-cloud',
      'far-cloud',
    ])
    expect(skyBandForAltitude(64.8)?.id).toBe('subject-flight')
    expect(skyBandForAltitude(88)?.id).toBe('near-air')
    expect(skyBandForAltitude(48)?.id).toBe('mid-cloud')
    expect(skyBandForAltitude(24)?.id).toBe('far-cloud')
  })

  it('keeps the historical base lock and records the approved wingsuit bounds', () => {
    expect(SKY_LOCKED_AVATAR_BASES).toMatchObject({
      animation: 'Idle_Land',
      authoredHeightMeters: 1.15,
      equipmentRigId: 'child-base-v3-meshy-24',
      neutralPose: 'neutral-bind-idle-v2',
      outfitSafetyBounds: null,
    })
    expect(SKY_LOCKED_AVATAR_BASES.boy.filename).not.toContain('wingsuit')
    expect(SKY_LOCKED_AVATAR_BASES.girl.filename).not.toContain('wingsuit')
    expect(SKY_RUNTIME_AVATAR_PRESENTATION).toMatchObject({
      bodyOrientation: 'prone',
      environmentEvidenceReusable: true,
      equipment: 'helmeted-wingsuit-and-parachute',
      outfitSafetyBounds: 'reviewed-dynamic-bounds-v4',
      pose: 'prone-wingsuit-glide',
      profile: 'air-wingsuit',
      status: 'production-approved',
    })
  })

  it(skyManifestTestTitle, () => {
    const manifestBytes = readFileSync(skyReviewManifestPath)
    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(
      SKY_PRODUCTION_REVIEW_CANDIDATE.manifestSha256,
    )
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      readonly defaultCandidate: boolean
      readonly leonApproved: boolean
      readonly mainIntegration: {
        readonly naturalnessGate: string
      }
      readonly latestOwnerRequestedRevision: {
        readonly aerialIslandCount: number
        readonly atlasBlurTapCount: number
        readonly atlasSampleMipBias: number
        readonly historicalBaseApprovalPreserved: boolean
        readonly landscapeDistribution: string
        readonly maximumSeaWaveDisplacementMeters: number
        readonly minimumStableCoreClearanceMeters: number
        readonly portraitDistribution: string
        readonly portraitIslandCount: number
        readonly responsiveLayoutCount: number
        readonly surfaceTexture: {
          readonly dimensions: readonly [number, number]
          readonly mode: string
          readonly path: string
          readonly sha256: string
        }
        readonly visualReviewStatus: string
      }
      readonly productionApproved: boolean
      readonly runtimeIntegrated: boolean
      readonly sceneContract: {
        readonly coastRendered: boolean
        readonly distantIslandSilhouettes: boolean
        readonly aerialIslandTerrainCount: number
      }
      readonly status: string
      readonly lockedInputs: {
        readonly outfitSafetyBounds: unknown
      }
    }
    expect(manifest.status).toBe('production-approved')
    expect(manifest.runtimeIntegrated).toBe(true)
    expect(manifest.defaultCandidate).toBe(true)
    expect(manifest.leonApproved).toBe(true)
    expect(manifest.productionApproved).toBe(true)
    expect(manifest.mainIntegration.naturalnessGate).toBe(
      'owner-approved-2026-08-24',
    )
    expect(manifest.latestOwnerRequestedRevision).toMatchObject({
      aerialIslandCount: 6,
      historicalBaseApprovalPreserved: true,
      maximumSeaWaveDisplacementMeters: 0.74,
      minimumStableCoreClearanceMeters: 0.84,
      atlasBlurTapCount: 5,
      atlasSampleMipBias: 0.9,
      landscapeDistribution: 'staggered-landscape-depth-bands',
      portraitDistribution: 'portrait-sea-footprint-depth-bands',
      portraitIslandCount: 6,
      responsiveLayoutCount: 2,
      visualReviewStatus: 'approved-2026-08-24',
    })
    expect(manifest.latestOwnerRequestedRevision.surfaceTexture).toMatchObject({
      dimensions: [1152, 768],
      mode: 'built-in-imagegen',
      path: 'aerial-island-atlas-v1.webp',
      sha256: '58a30f61f76d163a4289d1d1adc31d4c920db2763594588d90f3c9bb8ae69195',
    })
    expect(manifest.sceneContract.coastRendered).toBe(false)
    expect(manifest.sceneContract.distantIslandSilhouettes).toBe(false)
    expect(manifest.sceneContract.aerialIslandTerrainCount).toBe(6)
    expect(manifest.lockedInputs.outfitSafetyBounds).toBe(
      'reviewed-dynamic-bounds-v4',
    )
  })

  it('switches the pteranodon comparison axis without changing either subject scale', () => {
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 1440 / 900)).toBe(
      'side-by-side',
    )
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 1)).toBe(
      'stacked',
    )
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 390 / 844)).toBe(
      'stacked',
    )
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 360 / 640)).toBe(
      'stacked',
    )
    expect(scaleEncounterSubjectLayoutForAspect('mammoth', 390 / 844)).toBe(
      'authored',
    )
  })
})

describe('scale encounter sky candidate layer runtime', () => {
  function fixture(variant: 'A' | 'B' | 'C' | 'D') {
    const camera = new PerspectiveCamera(29, 1440 / 900, 0.03, 240)
    camera.position.set(18, 36, 0)
    camera.lookAt(0, 5, 6)
    camera.updateProjectionMatrix()
    const subjectBounds = new Box3(
      new Vector3(-4, 3.2, -1),
      new Vector3(4, 6.2, 16),
    )
    const avatarBounds = new Box3(
      new Vector3(-0.4, 4.2, 14.7),
      new Vector3(0.4, 5.35, 15.3),
    )
    const cameraSweepBounds = new Box3(
      new Vector3(-1, 4, -1),
      new Vector3(24, 39, 22),
    )
    const corridorBounds = subjectBounds
      .clone()
      .union(cameraSweepBounds)
      .expandByScalar(1)
    const cameraState = {
      aspect: camera.aspect,
      far: camera.far,
      fieldOfViewDegrees: camera.fov,
      near: camera.near,
      position: camera.position,
      stage: 'overview' as const,
      target: new Vector3(0, 5, 6),
      viewportHeight: 900,
      viewportWidth: 1440,
    }
    const scan = new Mesh(new BoxGeometry(100, 10, 100).translate(0, 5.24, 0), new MeshStandardMaterial({
      map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture(),
    }))
    scan.name = 'woodland-island'
    const template = new Group()
    template.add(scan)
    const candidate = createSkyEnvironmentCandidate({
      coastTemplate: template,
      assetLease: {
        assetId: 'scale-encounter-sky-coastal-v1',
        manifestSha256: 'fixture',
        productionApproved: false,
        status: 'review-candidate',
      },
      avatarBounds,
      cameraState,
      cameraSweepBounds,
      corridorBounds,
      rendererCapabilities: {
        isWebGl2: true,
        maxAnisotropy: 16,
        maxTextureSize: 16384,
        pixelRatio: 2,
        renderer: 'ANGLE Metal Renderer: Apple fixture',
        vendor: 'Google Inc. (Apple)',
      },
      subjectBounds,
      variant,
    })
    return {
      avatarBounds,
      camera,
      cameraState,
      candidate,
      subjectBounds,
    }
  }

  it.each([
    ['A', 0, ['background-atmosphere']],
    ['B', 0, ['background-atmosphere', 'flight-volume']],
    [
      'C',
      4,
      [
        'background-atmosphere',
        'flight-volume',
        'near-air',
        'mid-cloud',
        'far-cloud',
      ],
    ],
    [
      'D',
      4,
      [
        'background-atmosphere',
        'flight-volume',
        'near-air',
        'mid-cloud',
        'far-cloud',
      ],
    ],
  ] as const)(
    'activates only declared layers for variant %s',
    (variant, cloudCount, visibleLayers) => {
      const fixtureValue = fixture(variant)
      const diagnostic = fixtureValue.candidate.getDiagnostics(
        fixtureValue.camera,
        fixtureValue.cameraState,
        fixtureValue.subjectBounds,
        fixtureValue.avatarBounds,
      )
      expect(diagnostic.cloudCount).toBe(cloudCount)
      expect(
        diagnostic.layerStates
          .filter((layer) => layer.visible && layer.id !== 'subject')
          .map((layer) => layer.id),
      ).toEqual(visibleLayers)
      fixtureValue.candidate.dispose()
    },
  )

  it('keeps every C cloud world AABB outside the legal subject and camera corridor', () => {
    const fixtureValue = fixture('C')
    const diagnostic = fixtureValue.candidate.getDiagnostics(
      fixtureValue.camera,
      fixtureValue.cameraState,
      fixtureValue.subjectBounds,
      fixtureValue.avatarBounds,
    )
    expect(diagnostic.cloudDiagnostics).toHaveLength(4)
    expect(diagnostic.corridorOverlapCount).toBe(0)
    expect(
      diagnostic.cloudDiagnostics.every(
        (cloud) => cloud.corridorOverlap === false,
      ),
    ).toBe(true)
    expect(diagnostic.alpha).toMatchObject({
      alphaMode: 'premultiplied-blend',
      alphaTextureCount: 1,
      cloudMaterialsPremultiplied: true,
      cloudMaterialsUseMipmaps: true,
      cloudMaterialsDepthWriteDisabled: true,
    })
    fixtureValue.candidate.dispose()
  })

  it('feathers the finite sea before its geometry can form polygonal skyline segments', () => {
    const fixtureValue = fixture('C')
    const sea = fixtureValue.candidate.root.getObjectByName(
      'world-space-open-sea',
    ) as Mesh
    const seaMaterial = sea.material as ShaderMaterial
    expect(seaMaterial.vertexShader).toContain(
      'scaleEncounterHorizonWaveFade',
    )
    expect(seaMaterial.vertexShader).toContain('145.0')
    expect(seaMaterial.fragmentShader).toContain(
      'scaleEncounterSeamlessHorizon',
    )
    expect(seaMaterial.fragmentShader).toContain(
      'scaleEncounterSeaLevelDefinition',
    )
    expect(seaMaterial.fragmentShader).toContain('skyColourBehindSea')
    expect(seaMaterial.fragmentShader).toContain(
      'vWorldPosition.xz - uCameraPosition.xz',
    )

    fixtureValue.candidate.dispose()
  })

  it('keeps vegetated islands below the flight corridor and retains borrowed texture ownership', () => {
    const { candidate, camera } = fixture('D')
    candidate.root.updateMatrixWorld(true)
    const coast = candidate.root.getObjectByName('sky-woodland-island') as Mesh<BufferGeometry, MeshStandardMaterial>
    expect(coast).toBeInstanceOf(Mesh)
    const bounds = new Box3().setFromObject(coast)
    expect(bounds.min.y).toBeGreaterThan(SKY_REFERENCE_Y_METERS)
    expect(bounds.max.y).toBeGreaterThan(SKY_REFERENCE_Y_METERS)
    expect(bounds.max.y).toBeLessThan(SKY_REFERENCE_Y_METERS + 20)
    expect(coast.material.map).toBeTruthy()
    expect(coast.material.normalMap).toBeTruthy()
    expect(coast.material.roughness).toBeGreaterThan(0.9)
    const before = coast.matrixWorld.clone()
    camera.aspect = 390 / 844
    camera.updateProjectionMatrix()
    candidate.update(3, true, camera)
    coast.updateWorldMatrix(true, false)
    expect(coast.matrixWorld.equals(before)).toBe(true)
    const textureDisposals = [coast.material.map!, coast.material.normalMap!]
      .map((texture) => vi.spyOn(texture, 'dispose'))
    const geometryDisposal = vi.spyOn(coast.geometry, 'dispose')
    candidate.dispose()
    textureDisposals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled())
    expect(geometryDisposal).toHaveBeenCalledOnce()
  })

  it('registers C through the shared environment factory with actual camera and bounds', () => {
    const camera = new PerspectiveCamera(29, 1440 / 900, 0.03, 240)
    camera.position.set(18, 36, 0)
    const animalBounds = new Box3(
      new Vector3(-3.6, 3.6, -0.8),
      new Vector3(3.6, 6, 0.8),
    )
    const avatarBounds = new Box3(
      new Vector3(-0.55, 4.1, 14.2),
      new Vector3(0.55, 5.6, 15.8),
    )
    const environment = createScaleEncounterEnvironment(
      'air',
      'baseline',
      null,
      {
        animalBounds,
        animalId: 'pteranodon',
        avatarBounds,
        camera,
        sceneCandidateVariant: 'C',
      },
    )
    expect(environment?.sceneCandidateSemantic).toBe('sky')
    expect(environment?.sceneCandidateVariant).toBe('C')
    expect(environment?.root.getObjectByName('world-space-open-sea')).toBeTruthy()
    expect(environment?.root.getObjectByName(
      'distant-directional-coast-proxy',
    )).toBeFalsy()
    expect(environment?.root.getObjectByName('distant-vegetated-coast')).toBeTruthy()
    expect(
      environment?.root.getObjectByName(
        'sky-candidate-rear-upper-flight-fill',
      ),
    ).toBeTruthy()
    expect(environment?.root.userData.scaleEncounterSceneCandidate).toMatchObject({
      buildSource: 'sky-production-review-2026-08-17-v2',
      defaultCandidate: false,
      baseLeonApproved: true,
      naturalnessGate: 'local-review-2026-09-05',
      naturalnessRevision: 'vegetated-landforms-and-fixed-shore-v2',
      productionApproved: false,
      semanticName: 'sky',
    })
    disposeScaleEncounterEnvironment(environment)
  })
})
