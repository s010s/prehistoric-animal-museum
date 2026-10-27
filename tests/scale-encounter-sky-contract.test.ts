import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import {
  SKY_HEIGHT_BANDS,
  SKY_LOCKED_AVATAR_BASES,
  SKY_LOCKED_CAMERA,
  SKY_LOCKED_SUBJECT,
  SKY_REFERENCE_Y_METERS,
  SKY_VARIANTS,
  createSkyEnvironmentCandidate,
  skyAltitudeMeters,
  skyBandForAltitude,
  skyLayersForVariant,
} from '../src/scale-encounter/environments/sky'
import { SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'

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

  it('keeps A, B and C isolated by the handoff layer boundary', () => {
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
    expect(Object.keys(SKY_VARIANTS)).toEqual(['A', 'B', 'C'])
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

  it('binds only the frozen base Avatar family and leaves outfit bounds null', () => {
    expect(SKY_LOCKED_AVATAR_BASES).toMatchObject({
      animation: 'Idle_Land',
      authoredHeightMeters: 1.15,
      equipmentRigId: 'child-base-v3-meshy-24',
      neutralPose: 'neutral-idle-v1',
      outfitSafetyBounds: null,
    })
    expect(SKY_LOCKED_AVATAR_BASES.boy.filename).not.toContain('wingsuit')
    expect(SKY_LOCKED_AVATAR_BASES.girl.filename).not.toContain('wingsuit')
  })

  it('keeps the asset fragment review-only and free of copied Avatar packages', () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'assets/candidates/scale-encounter-environments/sky/sky-review-candidate.manifest.json',
        ),
        'utf8',
      ),
    ) as {
      readonly productionApproved: boolean
      readonly status: string
      readonly lockedInputs: {
        readonly outfitSafetyBounds: unknown
      }
    }
    expect(manifest.status).toBe('review-candidate')
    expect(manifest.productionApproved).toBe(false)
    expect(manifest.lockedInputs.outfitSafetyBounds).toBeNull()
  })
})

describe('scale encounter sky candidate layer runtime', () => {
  function fixture(variant: 'A' | 'B' | 'C') {
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
    const candidate = createSkyEnvironmentCandidate({
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
      8,
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
    expect(diagnostic.cloudDiagnostics).toHaveLength(8)
    expect(diagnostic.corridorOverlapCount).toBe(0)
    expect(
      diagnostic.cloudDiagnostics.every(
        (cloud) => cloud.corridorOverlap === false,
      ),
    ).toBe(true)
    expect(diagnostic.alpha).toMatchObject({
      alphaMode: 'premultiplied-blend',
      alphaTextureCount: 0,
      cloudMaterialsPremultiplied: true,
      cloudMaterialsUseMipmaps: false,
      cloudMaterialsDepthWriteDisabled: true,
    })
    fixtureValue.candidate.dispose()
  })
})
