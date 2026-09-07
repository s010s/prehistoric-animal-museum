import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Bone,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { animalDefinition } from '../src/content/animals/stegosaurus/package'
import {
  computeCameraFit,
  computeCompositionFieldOfView,
  computeCompositionViewOffset,
} from '../src/viewer/camera-fit'
import {
  MODEL_PREVIEW_PHONE_PORTRAIT_SCALE,
  modelScaleForViewport,
} from '../src/viewer/model-preview-profiles'
import { disposeObject3D } from '../src/viewer/dispose'
import type { RiverVisitor } from '../src/viewer/scale-encounter-water-interaction'
import {
  computeContactShadowLayout,
  classifyModelResourceTiming,
  computeScaleEncounterOrbitedEyePosition,
  computeScaleEncounterOrbitedGazeTarget,
  computeScaleEncounterOverviewFieldOfView,
  computeScaleEncounterPovEyePosition,
  computeModelTransitionFrame,
  computeModelBounds,
  createCameraRelativeLightingPose,
  minimumScaleEncounterDistanceForProfile,
  readModelResponseBuffer,
  requestModelResponse,
  resetStagedModelPose,
  updateCameraRelativeLightingPose,
  ViewerController,
  viewerZoomProfileForPointer,
  type ViewerModelDescriptor,
} from '../src/viewer/ViewerController'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  computeScaleEncounterAvatarGroundedEyeHeight,
  createScaleEncounterPlacement,
  positionOnScaleEncounterRail,
  scaleEncounterSubjectLayoutForAspect,
  type NormalizedScaleEncounterProfile,
  type ScaleEncounterAnimalId,
  type ScaleEncounterAvatarFactory,
} from '../src/viewer/scale-encounter'

describe('scale encounter avatar grounding', () => {
  it('measures the eye from the rendered shoe sole instead of the GLB root', () => {
    const root = new Group()
    const body = new Mesh(
      new BoxGeometry(0.42, 1.05, 0.28),
      new MeshBasicMaterial(),
    )
    body.position.y = 0.0045 + 1.05 / 2
    const eyeAnchor = new Group()
    eyeAnchor.position.y = 0.9895
    root.add(body, eyeAnchor)

    expect(
      computeScaleEncounterAvatarGroundedEyeHeight({
        eyeAnchor,
        root,
        visual: new Group(),
      }),
    ).toBeCloseTo(0.985, 7)

    body.geometry.dispose()
    body.material.dispose()
  })
})

describe('scale encounter overview optical zoom', () => {
  it('uses a responsive comparison axis only for the sky encounter', () => {
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 1.6)).toBe(
      'side-by-side',
    )
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 1)).toBe(
      'stacked',
    )
    expect(scaleEncounterSubjectLayoutForAspect('pteranodon', 390 / 844)).toBe(
      'stacked',
    )
    expect(scaleEncounterSubjectLayoutForAspect('mosasaurus', 1)).toBe(
      'authored',
    )
  })

  it.each([0.64, 0.74, 0.82, 0.9, 1, 1.08, 1.18])(
    'maps zoom %s through camera FOV so the panorama and subjects scale together',
    (zoom) => {
      const baseFieldOfView = 58
      const zoomedFieldOfView = computeScaleEncounterOverviewFieldOfView(
        baseFieldOfView,
        zoom,
      )
      const baseTangent = Math.tan(
        MathUtils.degToRad(baseFieldOfView) / 2,
      )
      const zoomedTangent = Math.tan(
        MathUtils.degToRad(zoomedFieldOfView) / 2,
      )

      expect(zoomedTangent / baseTangent).toBeCloseTo(zoom, 12)
      if (zoom < 1) expect(zoomedFieldOfView).toBeLessThan(baseFieldOfView)
      if (zoom > 1) expect(zoomedFieldOfView).toBeGreaterThan(baseFieldOfView)
    },
  )

  it('eases click targets and advances held zoom at a constant rate', () => {
    const harness = createGroundedPovController(1440 / 900)
    harness.encounter.view = 'overview'
    harness.encounter.overviewZoom = 1
    harness.encounter.targetOverviewZoom = 1
    Object.assign(harness.controller as unknown as Record<string, unknown>, {
      applyScaleEncounterOverviewPose: vi.fn(),
      publishScaleEncounterSnapshot: vi.fn(),
      scaleEncounterDistanceSnapshotUpdatedAt: Number.NEGATIVE_INFINITY,
    })
    const internals = harness.controller as unknown as {
      updateScaleEncounterDistance: (
        deltaSeconds: number,
        now: number,
      ) => void
    }

    harness.controller.adjustScaleEncounterDistance(1)
    expect(harness.encounter.targetOverviewZoom).toBeCloseTo(0.92, 10)
    expect(harness.encounter.overviewZoom).toBe(1)
    internals.updateScaleEncounterDistance(1 / 60, 16)
    expect(harness.encounter.overviewZoom).toBeLessThan(1)
    expect(harness.encounter.overviewZoom).toBeGreaterThan(0.92)
    for (let frame = 2; frame <= 60; frame += 1) {
      internals.updateScaleEncounterDistance(1 / 60, frame * 16)
    }
    expect(harness.encounter.overviewZoom).toBeCloseTo(0.92, 3)

    harness.encounter.overviewZoom = 1.1
    harness.encounter.targetOverviewZoom = 1.1
    harness.controller.setScaleEncounterDistanceMotion(1)
    for (let frame = 0; frame < 5; frame += 1) {
      internals.updateScaleEncounterDistance(0.1, 1_000 + frame * 100)
    }
    expect(harness.encounter.overviewZoom).toBeCloseTo(1.025, 6)
    harness.controller.setScaleEncounterDistanceMotion(0)
  })

  it('keeps a closer shared range while giving the mammoth a deeper close-up', () => {
    const harness = createGroundedPovController(1440 / 900)
    harness.encounter.view = 'overview'
    harness.encounter.overviewZoom = 0.75
    harness.encounter.targetOverviewZoom = 0.75
    harness.controller.adjustScaleEncounterDistance(1)
    expect(harness.encounter.targetOverviewZoom).toBe(0.74)

    Object.assign(harness.encounter, {
      definition: SCALE_ENCOUNTER_DEFINITIONS.mammoth,
      overviewZoom: 0.62,
      targetOverviewZoom: 0.62,
    })
    harness.controller.adjustScaleEncounterDistance(1)
    expect(harness.encounter.targetOverviewZoom).toBe(0.58)
  })
})

describe('scale encounter 360-degree observer orbit', () => {
  it.each([
    ['land', 'tyrannosaurus-rex'],
    ['air', 'pteranodon'],
    ['water', 'mosasaurus'],
  ] as const)(
    'preserves the animal-centre radius and eye height through a full %s orbit',
    (habitat, animalId) => {
      const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
      const placement = createScaleEncounterPlacement(
        animalId,
        new Vector3(-5, -1, -1),
        new Vector3(7, 6, 1),
        0.985,
      )
      const initial = computeScaleEncounterOrbitedEyePosition(
        placement,
        habitat,
        definition.defaultDistance,
        0,
      )
      const quarterTurn = computeScaleEncounterOrbitedEyePosition(
        placement,
        habitat,
        definition.defaultDistance,
        Math.PI / 2,
      )
      const fullTurn = computeScaleEncounterOrbitedEyePosition(
        placement,
        habitat,
        definition.defaultDistance,
        Math.PI * 2,
      )

      expect(initial.distanceTo(placement.target)).toBeCloseTo(
        definition.defaultDistance,
        8,
      )
      expect(quarterTurn.distanceTo(placement.orbitCenter)).toBeCloseTo(
        initial.distanceTo(placement.orbitCenter),
        8,
      )
      expect(
        quarterTurn.distanceTo(
          initial
            .clone()
            .sub(placement.orbitCenter)
            .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
            .add(placement.orbitCenter),
        ),
      ).toBeLessThan(1e-8)
      expect(quarterTurn.y).toBeCloseTo(initial.y, 8)
      expect(fullTurn.distanceTo(initial)).toBeLessThan(1e-8)
    },
  )

  it('centres the whole mammoth once the child circles away from the authored head view', () => {
    const placement = createScaleEncounterPlacement(
      'mammoth',
      new Vector3(-0.75, 0, -0.7),
      new Vector3(4.35, 3.25, 0.7),
      1.05,
    )

    expect(
      computeScaleEncounterOrbitedGazeTarget(placement, 0).distanceTo(
        placement.target,
      ),
    ).toBeLessThan(1e-10)
    expect(
      computeScaleEncounterOrbitedGazeTarget(
        placement,
        MathUtils.degToRad(30),
      ).distanceTo(placement.orbitCenter),
    ).toBeLessThan(1e-10)
  })

  it('moves to the next 30-degree side at a bounded arc speed and turns the child onto the tangent', () => {
    const harness = createGroundedPovController(1440 / 900)
    const internals = harness.controller as unknown as {
      computeScaleEncounterCameraPose: (view: 'pov') => {
        readonly position: Vector3
        readonly quaternion: PerspectiveCamera['quaternion']
      }
      updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
      updateScaleEncounterOrbit: (deltaSeconds: number, now: number) => void
    }

    harness.controller.adjustScaleEncounterOrbit(1)
    expect(harness.encounter.targetOrbitAngleRadians).toBeCloseTo(
      MathUtils.degToRad(30),
      10,
    )
    let finalTravel = new Vector3()
    let frame = 1
    for (; frame <= 360; frame += 1) {
      const previousEye = harness.encounter.avatarPreviousEyePosition.clone()
      internals.updateScaleEncounterOrbit(1 / 60, frame * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
      finalTravel = harness.encounter.avatarPreviousEyePosition
        .clone()
        .sub(previousEye)
      if (
        Math.abs(
          harness.encounter.orbitAngleRadians -
            harness.encounter.targetOrbitAngleRadians,
        ) < 1e-10
      ) {
        break
      }
    }

    expect(frame).toBeGreaterThan(90)
    expect(frame).toBeLessThan(360)
    expect(harness.encounter.orbitAngleRadians).toBeCloseTo(
      MathUtils.degToRad(30),
      4,
    )
    const expectedEye = computeScaleEncounterOrbitedEyePosition(
      harness.placement,
      'land',
      harness.encounter.observerDistance,
      harness.encounter.orbitAngleRadians,
    )
    const expectedCamera = internals.computeScaleEncounterCameraPose('pov')
    expect(
      harness.avatarEye.getWorldPosition(new Vector3()).distanceTo(expectedEye),
    ).toBeLessThan(1e-8)
    expect(
      harness.camera.position.distanceTo(expectedCamera.position),
    ).toBeLessThan(1e-8)
    expect(
      harness.camera.quaternion.angleTo(expectedCamera.quaternion),
    ).toBeLessThan(1e-8)
    expect(harness.encounter.avatar.root.visible).toBe(true)
    const renderedForward = new Vector3(1, 0, 0)
      .applyQuaternion(harness.encounter.avatar.root.quaternion)
      .normalize()
    expect(finalTravel.length()).toBeGreaterThan(0)
    expect(renderedForward.dot(finalTravel.normalize())).toBeGreaterThan(0.99)
    expect(
      Number(
        harness.encounter.avatar.root.userData
          .scaleEncounterAvatarTravelSpeed,
      ),
    ).toBeLessThanOrEqual(2.8 + 1e-6)
  })

  it('ignores orbit input while the encounter is in the overview', () => {
    const harness = createGroundedPovController(390 / 844)
    harness.encounter.view = 'overview'

    harness.controller.adjustScaleEncounterOrbit(1)
    harness.controller.setScaleEncounterOrbitMotion(1)

    expect(harness.encounter.orbitAngleRadians).toBe(0)
    expect(harness.encounter.targetOrbitAngleRadians).toBe(0)
    expect(harness.encounter.orbitMotionDirection).toBe(0)
  })

  it('returns the child and trailing camera to their original orbit before revealing the overview', async () => {
    const harness = createGroundedPovController(390 / 844)
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      computeScaleEncounterCameraPose: (view: 'pov') => {
        readonly position: Vector3
        readonly quaternion: PerspectiveCamera['quaternion']
      }
      updateScaleEncounterTransition: (now: number) => void
    }
    harness.encounter.orbitAngleRadians = Math.PI
    harness.encounter.targetOrbitAngleRadians = Math.PI
    internals.applyScaleEncounterPovPose()

    const returnPromise = harness.controller.transitionScaleEncounterView(
      'overview',
      2_000,
    )
    const transition = harness.encounter.transition as {
      readonly duration: number
      readonly keyframes: readonly {
        readonly at: number
        readonly cameraStage: string
      }[]
      readonly orbitReturn: {
        readonly endAt: number
        readonly holdEndAt: number
        readonly startAngleRadians: number
        readonly startDistance: number
      }
      readonly startedAt: number
    }

    expect(transition.keyframes.map(({ cameraStage }) => cameraStage)).toEqual([
      'follow-orbit',
      'follow-orbit',
      'follow-orbit',
      'child-rear',
      'overview',
    ])
    expect(transition.orbitReturn.startAngleRadians).toBeCloseTo(Math.PI, 10)
    expect(transition.keyframes[1]?.at).toBe(transition.orbitReturn.endAt)

    internals.updateScaleEncounterTransition(
      transition.startedAt +
        transition.duration * transition.orbitReturn.endAt * 0.5,
    )
    const expectedHalfwayEye = computeScaleEncounterOrbitedEyePosition(
      harness.placement,
      'land',
      harness.encounter.observerDistance,
      Math.PI / 2,
    )
    expect(harness.encounter.orbitAngleRadians).toBeCloseTo(Math.PI / 2, 8)
    expect(harness.camera.position.distanceTo(expectedHalfwayEye)).toBeGreaterThan(
      8,
    )
    expect(
      harness.avatarEye
        .getWorldPosition(new Vector3())
        .distanceTo(expectedHalfwayEye),
    ).toBeLessThan(1e-8)
    const expectedHalfwayCamera = internals.computeScaleEncounterCameraPose('pov')
    expect(
      harness.camera.position.distanceTo(expectedHalfwayCamera.position),
    ).toBeLessThan(1e-8)
    expect(
      harness.camera.quaternion.angleTo(expectedHalfwayCamera.quaternion),
    ).toBeLessThan(1e-6)
    const halfwayCameraPosition = harness.camera.position.clone()
    const halfwayAvatarPosition = harness.encounter.avatar.root.position.clone()
    harness.container.clientWidth = 844
    harness.container.clientHeight = 390
    harness.controller.resize()
    expect(harness.encounter.orbitAngleRadians).toBeCloseTo(Math.PI / 2, 8)
    expect(
      harness.camera.position.distanceTo(halfwayCameraPosition),
    ).toBeLessThan(1e-8)
    expect(
      harness.encounter.avatar.root.position.distanceTo(
        halfwayAvatarPosition,
      ),
    ).toBeLessThan(1e-8)
    expect(harness.encounter.avatar.root.visible).toBe(true)

    internals.updateScaleEncounterTransition(
      transition.startedAt +
        transition.duration * transition.orbitReturn.endAt,
    )
    const originalEye = computeScaleEncounterOrbitedEyePosition(
      harness.placement,
      'land',
      harness.encounter.observerDistance,
      0,
    )
    expect(harness.encounter.orbitAngleRadians).toBe(0)
    expect(
      harness.avatarEye
        .getWorldPosition(new Vector3())
        .distanceTo(originalEye),
    ).toBeLessThan(1e-8)
    const expectedOriginalCamera = internals.computeScaleEncounterCameraPose('pov')
    expect(
      harness.camera.position.distanceTo(expectedOriginalCamera.position),
    ).toBeLessThan(1e-8)
    expect(harness.encounter.avatar.root.visible).toBe(true)

    const rearAt = transition.keyframes[3]!.at
    internals.updateScaleEncounterTransition(
      transition.startedAt +
        transition.duration *
          MathUtils.lerp(transition.orbitReturn.holdEndAt, rearAt, 0.5),
    )
    expect(harness.encounter.avatar.root.visible).toBe(true)

    harness.controller.finishScaleEncounterTransition()
    await returnPromise
    expect(harness.encounter.view).toBe('overview')
    expect(harness.encounter.orbitAngleRadians).toBe(0)
  })
})

describe('scale encounter avatar locomotion', () => {
  it('turns and walks outward when the child moves farther, then stays idle for overview optical zoom', () => {
    const harness = createGroundedPovController(1440 / 900)
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      publishScaleEncounterAvatarMotionDiagnostics: () => void
      updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
      updateScaleEncounterDistance: (
        deltaSeconds: number,
        now: number,
      ) => void
    }
    internals.applyScaleEncounterPovPose()
    harness.encounter.avatarPreviousEyePosition.copy(
      harness.avatarEye.getWorldPosition(new Vector3()),
    )

    harness.controller.adjustScaleEncounterDistance(-1)
    let lastTravel = new Vector3()
    for (let frame = 1; frame <= 60; frame += 1) {
      const previousEye = harness.encounter.avatarPreviousEyePosition.clone()
      internals.updateScaleEncounterDistance(1 / 60, frame * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
      lastTravel = harness.encounter.avatarPreviousEyePosition
        .clone()
        .sub(previousEye)
      if (
        harness.encounter.observerDistance ===
        harness.encounter.targetObserverDistance
      ) {
        break
      }
    }

    const renderedForward = new Vector3(1, 0, 0)
      .applyQuaternion(harness.encounter.avatar.root.quaternion)
      .normalize()
    expect(lastTravel.length()).toBeGreaterThan(0)
    expect(renderedForward.dot(lastTravel.normalize())).toBeGreaterThan(0.98)
    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('walk')
    expect(
      Number(
        harness.encounter.avatar.root.userData
          .scaleEncounterAvatarTravelSpeed,
      ),
    ).toBeLessThanOrEqual(1.4 + 1e-6)

    harness.encounter.view = 'overview'
    harness.encounter.overviewZoom = 1
    harness.encounter.targetOverviewZoom = 1
    harness.encounter.avatarPreviousEyePosition.copy(
      harness.avatarEye.getWorldPosition(new Vector3()),
    )
    harness.controller.adjustScaleEncounterDistance(1)
    internals.updateScaleEncounterDistance(1 / 60, 2_000)
    internals.updateScaleEncounterAvatarMotion(1 / 60)
    internals.publishScaleEncounterAvatarMotionDiagnostics()

    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('idle')
    expect(
      harness.renderer.domElement.dataset
        .scaleEncounterAvatarSpeedMetersPerSecond,
    ).toBe('0.000')
    expect(
      harness.renderer.domElement.dataset.scaleEncounterAvatarMotion,
    ).toBe('idle')
  })

  it.each([
    [
      'ordinary forest animal',
      'tyrannosaurus-rex',
      new Vector3(-3.8, 0, -0.8),
      new Vector3(8.2, 4, 0.8),
      12.5,
      1.4,
      2.8,
    ],
    [
      'Apatosaurus body-centred rail',
      'apatosaurus',
      new Vector3(-8, 0, -1.5),
      new Vector3(15, 5, 1.5),
      12,
      1.4,
      2.8,
    ],
    [
      'calmer Spinosaurus rail',
      'spinosaurus',
      new Vector3(-4.7, 0, -1.3),
      new Vector3(9.45, 5.15, 2.6),
      15,
      1.4,
      2.8,
    ],
    [
      'calmer Archaeopteryx rail',
      'archaeopteryx',
      new Vector3(1.95, 0.3, -0.21),
      new Vector3(2.45, 0.62, 0.21),
      3,
      1.4,
      2.8,
    ],
  ] as const)(
    'keeps the configured world pace and intent-driven actions on an %s',
    (
      _label,
      animalId,
      boundsMinimum,
      boundsMaximum,
      distance,
      expectedWalkSpeed,
      expectedRunSpeed,
    ) => {
      const makeHarness = () => {
        const harness = createGroundedPovController(
          1440 / 900,
          animalId,
          boundsMinimum,
          boundsMaximum,
        )
        harness.encounter.observerDistance = distance
        harness.encounter.targetObserverDistance = distance
        const internals = harness.controller as unknown as {
          applyScaleEncounterPovPose: () => void
          updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
          updateScaleEncounterDistance: (
            deltaSeconds: number,
            now: number,
          ) => void
          updateScaleEncounterOrbit: (
            deltaSeconds: number,
            now: number,
          ) => void
        }
        internals.applyScaleEncounterPovPose()
        harness.encounter.avatarPreviousEyePosition.copy(
          harness.avatarEye.getWorldPosition(new Vector3()),
        )
        return { harness, internals }
      }

      const runForOneSecond = (
        radial: -1 | 0 | 1,
        tangential: -1 | 0 | 1,
      ) => {
        const { harness, internals } = makeHarness()
        harness.controller.setScaleEncounterDistanceMotion(radial)
        harness.controller.setScaleEncounterOrbitMotion(tangential)
        let pathLength = 0
        for (let frame = 1; frame <= 60; frame += 1) {
          const previous = harness.avatarEye.getWorldPosition(new Vector3())
          internals.updateScaleEncounterDistance(1 / 60, frame * 16)
          internals.updateScaleEncounterOrbit(1 / 60, frame * 16)
          internals.updateScaleEncounterAvatarMotion(1 / 60)
          pathLength += harness.avatarEye
            .getWorldPosition(new Vector3())
            .sub(previous)
            .setY(0)
            .length()
        }
        return { harness, pathLength }
      }

      const closer = runForOneSecond(1, 0)
      expect(Math.abs(closer.pathLength - expectedWalkSpeed)).toBeLessThan(
        0.02,
      )
      expect(
        closer.harness.encounter.avatar.root.userData
          .scaleEncounterAvatarMotion,
      ).toBe('walk')

      const farther = runForOneSecond(-1, 0)
      expect(Math.abs(farther.pathLength - expectedWalkSpeed)).toBeLessThan(
        0.02,
      )
      expect(
        farther.harness.encounter.avatar.root.userData
          .scaleEncounterAvatarMotion,
      ).toBe('walk')

      const orbit = runForOneSecond(0, 1)
      expect(Math.abs(orbit.pathLength - expectedRunSpeed)).toBeLessThan(0.04)
      expect(
        orbit.harness.encounter.avatar.root.userData
          .scaleEncounterAvatarMotion,
      ).toBe('run')

      const diagonal = runForOneSecond(1, 1)
      expect(diagonal.pathLength).toBeGreaterThan(expectedRunSpeed * 0.75)
      expect(diagonal.pathLength).toBeLessThanOrEqual(expectedRunSpeed + 0.04)
      expect(
        diagonal.harness.encounter.avatar.root.userData
          .scaleEncounterAvatarMotion,
      ).toBe('run')
    },
  )

  it.each([
    [
      'ordinary forest animal',
      'tyrannosaurus-rex',
      new Vector3(-3.8, 0, -0.8),
      new Vector3(8.2, 4, 0.8),
      12.5,
      1.4,
      2.8,
    ],
    [
      'calmer Spinosaurus rail',
      'spinosaurus',
      new Vector3(-4.7, 0, -1.3),
      new Vector3(9.45, 5.15, 2.6),
      15,
      1.4,
      2.8,
    ],
    [
      'calmer Archaeopteryx rail',
      'archaeopteryx',
      new Vector3(1.95, 0.3, -0.21),
      new Vector3(2.45, 0.62, 0.21),
      3,
      1.4,
      2.8,
    ],
  ] as const)(
    'uses the same configured pace for tapped controls on an %s',
    (
      _label,
      animalId,
      boundsMinimum,
      boundsMaximum,
      distance,
      expectedWalkSpeed,
      expectedRunSpeed,
    ) => {
      const makeHarness = () => {
        const harness = createGroundedPovController(
          1440 / 900,
          animalId,
          boundsMinimum,
          boundsMaximum,
        )
        harness.encounter.observerDistance = distance
        harness.encounter.targetObserverDistance = distance
        const internals = harness.controller as unknown as {
          applyScaleEncounterPovPose: () => void
          updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
          updateScaleEncounterDistance: (
            deltaSeconds: number,
            now: number,
          ) => void
          updateScaleEncounterOrbit: (
            deltaSeconds: number,
            now: number,
          ) => void
        }
        internals.applyScaleEncounterPovPose()
        harness.encounter.avatarPreviousEyePosition.copy(
          harness.avatarEye.getWorldPosition(new Vector3()),
        )
        return { harness, internals }
      }

      const distanceHarness = makeHarness()
      const distanceStart = distanceHarness.harness.avatarEye
        .getWorldPosition(new Vector3())
      distanceHarness.harness.controller.adjustScaleEncounterDistance(-1)
      distanceHarness.internals.updateScaleEncounterDistance(1 / 60, 16)
      distanceHarness.internals.updateScaleEncounterAvatarMotion(1 / 60)
      const walkSpeed = distanceHarness.harness.avatarEye
        .getWorldPosition(new Vector3())
        .sub(distanceStart)
        .setY(0)
        .length() * 60
      expect(Math.abs(walkSpeed - expectedWalkSpeed)).toBeLessThan(0.02)

      const orbitHarness = makeHarness()
      const orbitStart = orbitHarness.harness.avatarEye
        .getWorldPosition(new Vector3())
      orbitHarness.harness.controller.adjustScaleEncounterOrbit(1)
      orbitHarness.internals.updateScaleEncounterOrbit(1 / 60, 16)
      orbitHarness.internals.updateScaleEncounterAvatarMotion(1 / 60)
      const runSpeed = orbitHarness.harness.avatarEye
        .getWorldPosition(new Vector3())
        .sub(orbitStart)
        .setY(0)
        .length() * 60
      expect(Math.abs(runSpeed - expectedRunSpeed)).toBeLessThan(0.04)
    },
  )

  it.each([
    [
      'Spinosaurus',
      'spinosaurus',
      new Vector3(-4.7, 0, -1.3),
      new Vector3(9.45, 5.15, 2.6),
      15,
    ],
    [
      'Archaeopteryx',
      'archaeopteryx',
      new Vector3(1.95, 0.3, -0.21),
      new Vector3(2.45, 0.62, 0.21),
      3,
    ],
  ] as const)(
    'hands tapped %s controls between axes without retaining a spiral',
    (_label, animalId, boundsMinimum, boundsMaximum, distance) => {
      const harness = createGroundedPovController(
        1440 / 900,
        animalId,
        boundsMinimum,
        boundsMaximum,
      )
      harness.encounter.observerDistance = distance
      harness.encounter.targetObserverDistance = distance
      const internals = harness.controller as unknown as {
        applyScaleEncounterPovPose: () => void
        updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
        updateScaleEncounterDistance: (
          deltaSeconds: number,
          now: number,
        ) => void
        updateScaleEncounterOrbit: (
          deltaSeconds: number,
          now: number,
        ) => void
      }
      internals.applyScaleEncounterPovPose()
      harness.encounter.avatarPreviousEyePosition.copy(
        harness.avatarEye.getWorldPosition(new Vector3()),
      )

      harness.controller.adjustScaleEncounterOrbit(1)
      for (let frame = 1; frame <= 12; frame += 1) {
        internals.updateScaleEncounterDistance(1 / 60, frame * 16)
        internals.updateScaleEncounterOrbit(1 / 60, frame * 16)
        internals.updateScaleEncounterAvatarMotion(1 / 60)
      }
      expect(harness.encounter.orbitAngleRadians).toBeGreaterThan(0.01)
      expect(
        harness.encounter.targetOrbitAngleRadians -
          harness.encounter.orbitAngleRadians,
      ).toBeGreaterThan(0.01)

      const angleBeforeRadialInput = harness.encounter.orbitAngleRadians
      const radialStart = harness.avatarEye.getWorldPosition(new Vector3())
      harness.controller.adjustScaleEncounterDistance(1)
      expect(harness.encounter.targetOrbitAngleRadians).toBe(
        angleBeforeRadialInput,
      )
      internals.updateScaleEncounterDistance(1 / 60, 13 * 16)
      internals.updateScaleEncounterOrbit(1 / 60, 13 * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
      const radialEnd = harness.avatarEye.getWorldPosition(new Vector3())
      const radialTravel = radialEnd.clone().sub(radialStart).setY(0)
      const towardAnimal = harness.placement.orbitCenter
        .clone()
        .sub(radialStart)
        .setY(0)
        .normalize()
      // The internal rail angle may compensate slightly because its authored
      // target is offset from the body centre; the world-space path must not.
      expect(harness.encounter.targetOrbitAngleRadians).toBe(
        harness.encounter.orbitAngleRadians,
      )
      expect(radialTravel.clone().normalize().dot(towardAnimal)).toBeGreaterThan(
        0.999,
      )
      expect(radialTravel.length() * 60).toBeCloseTo(1.4, 2)

      const radiusBeforeLateralInput = radialEnd
        .clone()
        .sub(harness.placement.orbitCenter)
        .setY(0)
        .length()
      expect(
        Math.abs(
          harness.encounter.targetObserverDistance -
            harness.encounter.observerDistance,
        ),
      ).toBeGreaterThan(0.01)
      harness.controller.adjustScaleEncounterOrbit(-1)
      expect(harness.encounter.targetObserverDistance).toBe(
        harness.encounter.observerDistance,
      )
      internals.updateScaleEncounterDistance(1 / 60, 14 * 16)
      internals.updateScaleEncounterOrbit(1 / 60, 14 * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
      const radiusAfterLateralInput = harness.avatarEye
        .getWorldPosition(new Vector3())
        .sub(harness.placement.orbitCenter)
        .setY(0)
        .length()
      expect(radiusAfterLateralInput).toBeCloseTo(
        radiusBeforeLateralInput,
        6,
      )
    },
  )

  it('keeps diagonals locally 45 degrees, cancels idle input and switches gait when one key is released', () => {
    const harness = createGroundedPovController(1440 / 900)
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
      updateScaleEncounterDistance: (
        deltaSeconds: number,
        now: number,
      ) => void
      updateScaleEncounterOrbit: (
        deltaSeconds: number,
        now: number,
      ) => void
    }
    internals.applyScaleEncounterPovPose()
    harness.encounter.avatarPreviousEyePosition.copy(
      harness.avatarEye.getWorldPosition(new Vector3()),
    )
    const start = harness.avatarEye.getWorldPosition(new Vector3())
    const outward = start
      .clone()
      .sub(harness.placement.orbitCenter)
      .setY(0)
      .normalize()
    const inward = outward.clone().negate()
    const clockwiseTangent = new Vector3(outward.z, 0, -outward.x)

    harness.controller.setScaleEncounterDistanceMotion(1)
    harness.controller.setScaleEncounterOrbitMotion(1)
    internals.updateScaleEncounterDistance(1 / 120, 8)
    internals.updateScaleEncounterOrbit(1 / 120, 8)
    internals.updateScaleEncounterAvatarMotion(1 / 120)
    const diagonalTravel = harness.avatarEye
      .getWorldPosition(new Vector3())
      .sub(start)
      .setY(0)
    expect(diagonalTravel.length() * 120).toBeCloseTo(2.8, 3)
    expect(diagonalTravel.dot(inward) * 120).toBeCloseTo(
      2.8 * Math.SQRT1_2,
      2,
    )
    expect(diagonalTravel.dot(clockwiseTangent) * 120).toBeCloseTo(
      2.8 * Math.SQRT1_2,
      2,
    )

    harness.controller.setScaleEncounterOrbitMotion(0)
    internals.updateScaleEncounterDistance(1 / 60, 24)
    internals.updateScaleEncounterOrbit(1 / 60, 24)
    internals.updateScaleEncounterAvatarMotion(1 / 60)
    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('walk')
    expect(
      Number(
        harness.encounter.avatar.root.userData
          .scaleEncounterAvatarTravelSpeed,
      ),
    ).toBeCloseTo(1.4, 4)

    harness.controller.setScaleEncounterDistanceMotion(0)
    const idleStart = harness.avatarEye.getWorldPosition(new Vector3())
    internals.updateScaleEncounterDistance(1 / 60, 40)
    internals.updateScaleEncounterOrbit(1 / 60, 40)
    internals.updateScaleEncounterAvatarMotion(1 / 60)
    expect(
      harness.avatarEye
        .getWorldPosition(new Vector3())
        .distanceTo(idleStart),
    ).toBeLessThan(1e-10)
    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('idle')
  })

  it('integrates the same diagonal destination at low and high frame rates', () => {
    const simulate = (framesPerSecond: number) => {
      const harness = createGroundedPovController(1440 / 900)
      const internals = harness.controller as unknown as {
        applyScaleEncounterPovPose: () => void
        updateScaleEncounterDistance: (
          deltaSeconds: number,
          now: number,
        ) => void
        updateScaleEncounterOrbit: (
          deltaSeconds: number,
          now: number,
        ) => void
      }
      internals.applyScaleEncounterPovPose()
      harness.controller.setScaleEncounterDistanceMotion(-1)
      harness.controller.setScaleEncounterOrbitMotion(1)
      for (let frame = 1; frame <= framesPerSecond; frame += 1) {
        internals.updateScaleEncounterDistance(
          1 / framesPerSecond,
          (frame * 1_000) / framesPerSecond,
        )
        internals.updateScaleEncounterOrbit(
          1 / framesPerSecond,
          (frame * 1_000) / framesPerSecond,
        )
      }
      return harness.avatarEye.getWorldPosition(new Vector3())
    }

    expect(simulate(15).distanceTo(simulate(120))).toBeLessThan(0.01)
  })

  it('slides around the Apatosaurus leg boundary, then retreats without a corrective jump', () => {
    const harness = createGroundedPovController(
      1440 / 900,
      'apatosaurus',
      new Vector3(-8, 0, -1.5),
      new Vector3(15, 5, 1.5),
    )
    harness.encounter.profile = {
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
      heightMeters: 1.1,
    }
    harness.encounter.orbitAngleRadians = Math.PI / 2
    harness.encounter.targetOrbitAngleRadians = Math.PI / 2
    const boundaryDistance = minimumScaleEncounterDistanceForProfile(
      harness.encounter.placement,
      harness.encounter.definition,
      harness.encounter.profile,
      harness.encounter.orbitAngleRadians,
    )
    harness.encounter.observerDistance = boundaryDistance
    harness.encounter.targetObserverDistance = boundaryDistance
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      updateScaleEncounterAvatarMotion: (deltaSeconds: number) => void
      updateScaleEncounterDistance: (
        deltaSeconds: number,
        now: number,
      ) => void
      updateScaleEncounterOrbit: (
        deltaSeconds: number,
        now: number,
      ) => void
    }
    internals.applyScaleEncounterPovPose()
    harness.encounter.avatarPreviousEyePosition.copy(
      harness.avatarEye.getWorldPosition(new Vector3()),
    )

    harness.controller.setScaleEncounterDistanceMotion(1)
    harness.controller.setScaleEncounterOrbitMotion(1)
    const startingAngle = harness.encounter.orbitAngleRadians
    let maximumFrameTravel = 0
    for (let frame = 1; frame <= 60; frame += 1) {
      const previous = harness.avatarEye.getWorldPosition(new Vector3())
      internals.updateScaleEncounterDistance(1 / 60, frame * 16)
      internals.updateScaleEncounterOrbit(1 / 60, frame * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
      const frameTravel = harness.avatarEye
        .getWorldPosition(new Vector3())
        .sub(previous)
        .setY(0)
        .length()
      maximumFrameTravel = Math.max(maximumFrameTravel, frameTravel)
      const minimum = minimumScaleEncounterDistanceForProfile(
        harness.encounter.placement,
        harness.encounter.definition,
        harness.encounter.profile,
        harness.encounter.orbitAngleRadians,
      )
      expect(Number.isFinite(harness.encounter.observerDistance)).toBe(true)
      expect(harness.encounter.observerDistance).toBeGreaterThanOrEqual(
        minimum - 1e-5,
      )
    }
    expect(harness.encounter.orbitAngleRadians - startingAngle).toBeGreaterThan(
      0.2,
    )
    expect(maximumFrameTravel).toBeLessThanOrEqual(2.8 / 60 + 1e-5)
    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('run')

    const beforeRetreat = harness.avatarEye
      .getWorldPosition(new Vector3())
      .sub(harness.encounter.placement.orbitCenter)
      .setY(0)
      .length()
    harness.controller.setScaleEncounterOrbitMotion(0)
    harness.controller.setScaleEncounterDistanceMotion(-1)
    for (let frame = 61; frame <= 120; frame += 1) {
      internals.updateScaleEncounterDistance(1 / 60, frame * 16)
      internals.updateScaleEncounterOrbit(1 / 60, frame * 16)
      internals.updateScaleEncounterAvatarMotion(1 / 60)
    }
    const afterRetreat = harness.avatarEye
      .getWorldPosition(new Vector3())
      .sub(harness.encounter.placement.orbitCenter)
      .setY(0)
      .length()
    expect(afterRetreat - beforeRetreat).toBeCloseTo(1.4, 4)
    expect(
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion,
    ).toBe('walk')
  })
})

describe('scale encounter context action', () => {
  it('runs a terrain-relative land parabola and ends the package jump pose on landing', () => {
    const harness = createGroundedPovController(1440 / 900)
    const setActionState = (
      harness.encounter.avatar as typeof harness.encounter.avatar & {
        setActionState: ReturnType<typeof vi.fn>
      }
    ).setActionState
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      updateScaleEncounterContextAction: (deltaSeconds: number) => void
    }
    internals.applyScaleEncounterPovPose()
    const groundedEyeY = harness.avatarEye.getWorldPosition(new Vector3()).y

    expect(harness.controller.triggerScaleEncounterJump()).toBe(true)
    expect(harness.controller.triggerScaleEncounterJump()).toBe(false)
    expect(setActionState).toHaveBeenCalledWith('jump', true, 'idle')
    expect(harness.encounter.jumpPhase).toBe('anticipation')
    expect(harness.encounter.jumpEntryMotion).toBe('idle')

    internals.updateScaleEncounterContextAction(0.1)
    expect(harness.avatarEye.getWorldPosition(new Vector3()).y).toBeCloseTo(
      groundedEyeY,
      8,
    )
    expect(harness.renderer.domElement.dataset.scaleEncounterJump).toBe(
      'anticipation',
    )

    let maximumEyeY = groundedEyeY
    let minimumEyeY = groundedEyeY
    for (let frame = 0; frame < 120; frame += 1) {
      internals.updateScaleEncounterContextAction(1 / 60)
      const eyeY = harness.avatarEye.getWorldPosition(new Vector3()).y
      maximumEyeY = Math.max(maximumEyeY, eyeY)
      minimumEyeY = Math.min(minimumEyeY, eyeY)
      if (!harness.encounter.jumpActive) break
    }

    expect(maximumEyeY - groundedEyeY).toBeGreaterThanOrEqual(0.11)
    expect(minimumEyeY).toBeGreaterThanOrEqual(groundedEyeY - 1e-8)
    expect(harness.avatarEye.getWorldPosition(new Vector3()).y).toBeCloseTo(
      groundedEyeY,
      6,
    )
    expect(setActionState).toHaveBeenLastCalledWith('jump', false, 'idle')
    expect(harness.renderer.domElement.dataset.scaleEncounterJump).toBe(
      'grounded',
    )
  })

  it.each([
    ['walk', 46 / 60],
    ['run', 42 / 60],
  ] as const)(
    'matches the %s entry clip timing instead of replaying the standing jump',
    (entryMotion, expectedDuration) => {
      const harness = createGroundedPovController(1440 / 900)
      harness.encounter.avatar.root.userData.scaleEncounterAvatarMotion =
        entryMotion
      const setActionState = harness.encounter.avatar.setActionState
      const internals = harness.controller as unknown as {
        updateScaleEncounterContextAction: (deltaSeconds: number) => void
      }

      expect(harness.controller.triggerScaleEncounterJump()).toBe(true)
      expect(setActionState).toHaveBeenCalledWith(
        'jump',
        true,
        entryMotion,
      )
      expect(harness.encounter.jumpEntryMotion).toBe(entryMotion)
      expect(
        harness.renderer.domElement.dataset.scaleEncounterJumpEntryMotion,
      ).toBe(entryMotion)

      let elapsed = 0
      while (harness.encounter.jumpActive && elapsed < 2) {
        internals.updateScaleEncounterContextAction(1 / 120)
        elapsed += 1 / 120
      }

      expect(elapsed).toBeCloseTo(expectedDuration, 1)
      expect(setActionState).toHaveBeenLastCalledWith(
        'jump',
        false,
        entryMotion,
      )
    },
  )

  it.each([
    ['pteranodon', 1.6],
    ['mosasaurus', 1.4],
  ] as const)('smoothly applies the %s hold-to-boost cap', (animalId, cap) => {
    const harness = createGroundedPovController(1440 / 900)
    harness.encounter.definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
    const setIntensity = vi.fn()
    harness.encounter.boostFlow = { setIntensity }
    const internals = harness.controller as unknown as {
      updateScaleEncounterContextAction: (deltaSeconds: number) => void
    }

    expect(harness.controller.setScaleEncounterBoost(true)).toBe(true)
    internals.updateScaleEncounterContextAction(1)
    expect(harness.encounter.actionBoostMultiplier).toBeCloseTo(cap, 3)
    expect(
      Number(
        harness.renderer.domElement.dataset.scaleEncounterBoostMultiplier,
      ),
    ).toBeCloseTo(cap, 3)
    expect(setIntensity).toHaveBeenLastCalledWith(expect.closeTo(1, 3))
    expect(
      Number(
        harness.renderer.domElement.dataset
          .scaleEncounterBoostFlowIntensity,
      ),
    ).toBeCloseTo(1, 3)

    expect(harness.controller.setScaleEncounterBoost(false)).toBe(true)
    internals.updateScaleEncounterContextAction(1)
    expect(harness.encounter.actionBoostMultiplier).toBeCloseTo(1, 3)
    expect(setIntensity).toHaveBeenLastCalledWith(expect.closeTo(0, 3))
    expect(
      Number(
        harness.renderer.domElement.dataset
          .scaleEncounterBoostFlowIntensity,
      ),
    ).toBeCloseTo(0, 3)
  })
})

describe('scale encounter canonical avatar source', () => {
  it('requires an installed reviewed factory and never restores the procedural child', () => {
    const controller = Object.create(
      ViewerController.prototype,
    ) as ViewerController
    const internals = controller as unknown as {
      scaleEncounter: unknown
      scaleEncounterAvatarFactory: (...args: unknown[]) => unknown
    }
    internals.scaleEncounter = null

    controller.setScaleEncounterAvatarFactory(null)
    expect(() => internals.scaleEncounterAvatarFactory()).toThrow(
      'scale-encounter-avatar-factory-unavailable',
    )

    const reviewedFactory = vi.fn(() => ({ source: 'reviewed-base' }))
    controller.setScaleEncounterAvatarFactory(
      reviewedFactory as unknown as ScaleEncounterAvatarFactory,
    )
    expect(internals.scaleEncounterAvatarFactory()).toEqual({
      source: 'reviewed-base',
    })

    internals.scaleEncounter = {}
    controller.setScaleEncounterAvatarFactory(null)
    expect(internals.scaleEncounterAvatarFactory()).toEqual({
      source: 'reviewed-base',
    })
  })
})

describe('model response loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports streamed bytes and reassembles the exact model buffer', async () => {
    const progress: Array<{
      readonly loadedBytes: number
      readonly totalBytes: number | null
    }> = []
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]))
          controller.enqueue(Uint8Array.from([3, 4, 5]))
          controller.close()
        },
      }),
      { headers: { 'content-length': '5' } },
    )

    const buffer = await readModelResponseBuffer(
      response,
      undefined,
      ({ loadedBytes, totalBytes }) => {
        progress.push({ loadedBytes, totalBytes })
      },
    )

    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5])
    expect(progress).toEqual([
      { loadedBytes: 2, totalBytes: 5 },
      { loadedBytes: 5, totalBytes: 5 },
    ])
  })

  it('uses exactly one ordinary request so the browser can apply its HTTP cache', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const sources: string[] = []

    const result = await requestModelResponse(
      '/model.glb',
      undefined,
      (source) => sources.push(source),
    )

    expect(result.source).toBe('network')
    expect(sources).toEqual(['network'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/model.glb',
      expect.objectContaining({
        priority: 'high',
      }),
    )
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('cache')
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('mode')
  })

  it('reports a failed ordinary request without issuing a second probe', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const sources: string[] = []

    await expect(
      requestModelResponse('/unavailable.glb', undefined, (source) =>
        sources.push(source),
      ),
    ).rejects.toThrow('模型请求失败（503）')

    expect(sources).toEqual(['network'])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('classifies a zero-transfer completed resource as an HTTP cache hit', () => {
    expect(
      classifyModelResourceTiming(
        [
          {
            decodedBodySize: 4_096,
            encodedBodySize: 4_096,
            startTime: 101,
            transferSize: 0,
          },
        ],
        100,
      ),
    ).toBe('http-cache')
  })

  it('does not mistake an older timing entry or a fresh transfer for cache', () => {
    expect(
      classifyModelResourceTiming(
        [
          {
            decodedBodySize: 4_096,
            encodedBodySize: 4_096,
            startTime: 80,
            transferSize: 0,
          },
          {
            decodedBodySize: 4_096,
            encodedBodySize: 4_096,
            startTime: 101,
            transferSize: 4_396,
          },
        ],
        100,
      ),
    ).toBe('network')
  })
})

describe('scale encounter resize continuity', () => {
  it('caps the layered mammoth prototype on ultra-wide high-DPI displays', () => {
    const devicePixelRatio = vi
      .spyOn(window, 'devicePixelRatio', 'get')
      .mockReturnValue(2)
    const camera = new PerspectiveCamera(52, 1, 0.03, 240)
    const renderer = {
      domElement: { dataset: {} as Record<string, string> },
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    }
    const controller = Object.create(
      ViewerController.prototype,
    ) as ViewerController
    Object.assign(controller as unknown as Record<string, unknown>, {
      applyScaleEncounterOverviewPose: vi.fn(),
      camera,
      container: { clientHeight: 2_304, clientWidth: 4_096 },
      destroyed: false,
      renderer,
      scaleEncounter: {
        definition: SCALE_ENCOUNTER_DEFINITIONS.mammoth,
        transition: null,
        view: 'overview',
      },
      scaleEncounterSceneCandidateVariant: 'C',
    })

    controller.resize()

    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5)
    expect(renderer.domElement.dataset.scaleEncounterRenderPixelRatio).toBe(
      '1.50',
    )
    expect(renderer.setSize).toHaveBeenLastCalledWith(4_096, 2_304, false)

    Object.assign(controller as unknown as Record<string, unknown>, {
      scaleEncounterSceneCandidateVariant: 'B',
    })
    controller.resize()
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2)
    devicePixelRatio.mockRestore()
  })

  it('refreshes only the final keyframe without completing or jumping an active transition', async () => {
    let resolveTransition = (): void => undefined
    let transitionSettled = false
    const transitionPromise = new Promise<void>((resolve) => {
      resolveTransition = resolve
    }).then(() => {
      transitionSettled = true
    })
    const camera = new PerspectiveCamera(52, 1, 0.03, 240)
    const originalFinalPosition = new Vector3(8, 4, 2)
    const refreshedFinalPosition = new Vector3(10, 5, 3)
    const transition = {
      duration: 9_638,
      keyframes: [
        {
          at: 0,
          cameraStage: 'child-rear' as const,
          fieldOfView: 52,
          position: new Vector3(2, 3, 4),
          quaternion: camera.quaternion.clone(),
        },
        {
          at: 1,
          cameraStage: 'pov' as const,
          fieldOfView: 60,
          position: originalFinalPosition,
          quaternion: camera.quaternion.clone(),
        },
      ],
      promise: transitionPromise,
      resolve: resolveTransition,
      startedAt: 1_000,
      targetView: 'pov' as const,
    }
    const encounter = {
      cameraStage: 'child-rear' as const,
      definition: SCALE_ENCOUNTER_DEFINITIONS.pteranodon,
      transition,
      view: 'overview' as const,
    }
    const finalPose = {
      fieldOfView: 60,
      position: refreshedFinalPosition,
      quaternion: camera.quaternion.clone(),
    }
    const computeFinalPose = vi.fn(() => finalPose)
    const completeView = vi.fn((targetView: 'overview' | 'pov') => {
      Object.assign(encounter, {
        cameraStage: targetView,
        transition: null,
        view: targetView,
      })
    })
    const renderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    }
    const controller = Object.create(
      ViewerController.prototype,
    ) as ViewerController
    Object.assign(controller as unknown as Record<string, unknown>, {
      camera,
      completeScaleEncounterView: completeView,
      computeScaleEncounterCameraPose: computeFinalPose,
      container: { clientHeight: 390, clientWidth: 844 },
      destroyed: false,
      renderer,
      scaleEncounter: encounter,
    })

    controller.resize()
    await Promise.resolve()

    expect(renderer.setSize).toHaveBeenCalledWith(844, 390, false)
    expect(camera.aspect).toBeCloseTo(844 / 390)
    expect(computeFinalPose).toHaveBeenCalledWith('pov')
    expect(encounter.view).toBe('overview')
    expect(encounter.cameraStage).toBe('child-rear')
    expect(completeView).not.toHaveBeenCalled()
    expect(transitionSettled).toBe(false)
    expect(encounter.transition).not.toBe(transition)
    expect(encounter.transition?.promise).toBe(transitionPromise)
    expect(encounter.transition?.startedAt).toBe(1_000)
    expect(encounter.transition?.keyframes.at(-1)).toMatchObject({
      at: 1,
      cameraStage: 'pov',
      fieldOfView: 60,
      position: refreshedFinalPosition,
    })

    controller.finishScaleEncounterTransition()
    await transitionPromise

    expect(completeView).toHaveBeenCalledOnce()
    expect(completeView).toHaveBeenCalledWith('pov')
    expect(transitionSettled).toBe(true)
    expect(encounter.view).toBe('pov')
    expect(encounter.cameraStage).toBe('pov')
  })

  it('creates a real return transition when POV is cancelled before its stage label changes', async () => {
    const oldResolve = vi.fn()
    const oldTransition = {
      duration: 8_204,
      keyframes: [],
      promise: Promise.resolve(),
      resolve: oldResolve,
      startedAt: 1_000,
      targetView: 'pov' as const,
    }
    const target = new Vector3(3, 2, 1)
    const avatarRoot = new Group()
    const startingAvatarQuaternion = avatarRoot.quaternion.clone()
    const encounter = {
      avatar: { root: avatarRoot },
      avatarBaseYawRadians: 0.2,
      cameraStage: 'overview' as const,
      definition: {
        ...SCALE_ENCOUNTER_DEFINITIONS['tyrannosaurus-rex'],
        defaultDistance: 12.5,
      },
      observerDistance: 12.5,
      orbitAngleRadians: MathUtils.degToRad(90),
      orbitMotionDirection: 0 as const,
      placement: {
        defaultEyePosition: new Vector3(-9, 1, 0),
        observerRailDirection: new Vector3(-1, 0, 0),
        orbitCenter: target.clone(),
        target,
      },
      targetOrbitAngleRadians: MathUtils.degToRad(120),
      transition: oldTransition,
      view: 'overview' as const,
    }
    const returnPromiseResolve = vi.fn()
    const keyframes = [
      {
        at: 0,
        cameraStage: 'overview' as const,
        fieldOfView: 52,
        position: new Vector3(1, 2, 3),
        quaternion: new PerspectiveCamera().quaternion.clone(),
      },
      {
        at: 1,
        cameraStage: 'overview' as const,
        fieldOfView: 29,
        position: new Vector3(4, 5, 6),
        quaternion: new PerspectiveCamera().quaternion.clone(),
      },
    ]
    const controller = Object.create(
      ViewerController.prototype,
    ) as ViewerController
    const publish = vi.fn()
    const completeView = vi.fn((targetView: 'overview' | 'pov') => {
      Object.assign(encounter, {
        cameraStage: targetView,
        transition: null,
        view: targetView,
      })
    })
    Object.assign(controller as unknown as Record<string, unknown>, {
      completeScaleEncounterView: completeView,
      controls: { target: new Vector3() },
      createScaleEncounterTransitionKeyframes: vi.fn(() => keyframes),
      placeScaleEncounterAvatarEyeAt: vi.fn(),
      publishScaleEncounterSnapshot: publish,
      reducedMotion: false,
      scaleEncounter: encounter,
    })

    const returnPromise = controller.transitionScaleEncounterView(
      'overview',
      1_250,
    )

    expect(oldResolve).toHaveBeenCalledOnce()
    expect(encounter.transition).not.toBeNull()
    expect(encounter.transition).not.toBe(oldTransition)
    expect(encounter.transition?.targetView).toBe('overview')
    expect(encounter.transition?.keyframes).toBe(keyframes)
    expect(encounter.orbitAngleRadians).toBe(0)
    expect(encounter.targetOrbitAngleRadians).toBe(0)
    expect(
      encounter.avatar.root.quaternion.angleTo(startingAvatarQuaternion),
    ).toBeCloseTo(0, 10)
    expect(publish).toHaveBeenCalledOnce()
    expect(returnPromise).not.toBe(oldTransition.promise)

    const observedReturn = returnPromise.then(returnPromiseResolve)
    controller.finishScaleEncounterTransition()
    await observedReturn
    expect(completeView).toHaveBeenCalledWith('overview')
    expect(returnPromiseResolve).toHaveBeenCalledOnce()
  })
})

const LAND_STAGE_GROUND_Y = -0.035

function minimumNearPlaneCornerHeight(camera: PerspectiveCamera): number {
  camera.updateMatrixWorld(true)
  const halfHeight =
    Math.tan(MathUtils.degToRad(camera.fov) / 2) * camera.near
  const halfWidth = halfHeight * camera.aspect
  return Math.min(
    ...[-1, 1].flatMap((xDirection) =>
      [-1, 1].map(
        (yDirection) =>
          new Vector3(
            xDirection * halfWidth,
            yDirection * halfHeight,
            -camera.near,
          ).applyMatrix4(camera.matrixWorld).y,
      ),
    ),
  )
}

function createGroundedPovController(
  aspect: number,
  animalId: ScaleEncounterAnimalId = 'tyrannosaurus-rex',
  boundsMinimum = new Vector3(-3.8, 0, -0.8),
  boundsMaximum = new Vector3(8.2, 4, 0.8),
): {
  readonly avatarEye: Group
  readonly camera: PerspectiveCamera
  readonly container: { clientHeight: number; clientWidth: number }
  readonly controller: ViewerController
  readonly encounter: Record<string, unknown> & {
    actionBoostActive: boolean
    actionBoostMultiplier: number
    avatar: {
      root: Group
      visual: Group
      eyeAnchor: Group
      setActionState: ReturnType<typeof vi.fn>
    }
    avatarBaseYawRadians: number
    avatarPreviousEyePosition: Vector3
    boostFlow: null | { setIntensity: ReturnType<typeof vi.fn> }
    distanceMotionDirection: -1 | 0 | 1
    definition: (typeof SCALE_ENCOUNTER_DEFINITIONS)[keyof typeof SCALE_ENCOUNTER_DEFINITIONS]
    jumpActive: boolean
    jumpEntryMotion: 'idle' | 'walk' | 'run'
    jumpOffsetMeters: number
    jumpPhase: 'grounded' | 'anticipation' | 'airborne' | 'landing'
    jumpPhaseElapsedSeconds: number
    jumpVelocityMetersPerSecond: number
    observerDistance: number
    orbitAngleRadians: number
    orbitMotionDirection: -1 | 0 | 1
    overviewZoom: number
    placement: ReturnType<typeof createScaleEncounterPlacement>
    profile: NormalizedScaleEncounterProfile
    targetObserverDistance: number
    targetOrbitAngleRadians: number
    targetOverviewZoom: number
    transition: unknown
    view: 'overview' | 'pov'
  }
  readonly placement: ReturnType<typeof createScaleEncounterPlacement>
  readonly renderer: {
    readonly domElement: { readonly dataset: Record<string, string> }
    readonly setPixelRatio: ReturnType<typeof vi.fn>
    readonly setSize: ReturnType<typeof vi.fn>
  }
} {
  const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
  const placement = createScaleEncounterPlacement(
    definition.id,
    boundsMinimum,
    boundsMaximum,
    0.985,
  )
  const avatarRoot = new Group()
  avatarRoot.name =
    'scale-encounter-child-girl-land-explorer-runtime-v1'
  avatarRoot.userData.scaleEncounterAvatarMotion = 'idle'
  const avatarBody = new Mesh(
    new BoxGeometry(0.42, 1.05, 0.28),
    new MeshBasicMaterial(),
  )
  avatarBody.position.y = 0.525
  const avatarEye = new Group()
  avatarEye.position.y = 0.985
  avatarRoot.add(avatarBody, avatarEye)
  avatarRoot.rotation.y = placement.avatarYawRadians

  const camera = new PerspectiveCamera(58, aspect, 0.03, 240)
  const container = {
    clientHeight: Math.round(900 / aspect),
    clientWidth: 900,
  }
  const renderer = {
    domElement: { dataset: {} as Record<string, string> },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
  }
  const encounter = {
    actionBoostActive: false,
    actionBoostMultiplier: 1,
    avatar: {
      root: avatarRoot,
      visual: new Group(),
      eyeAnchor: avatarEye,
      setActionState: vi.fn(),
    },
    avatarBaseYawRadians: placement.avatarYawRadians,
    avatarPreviousEyePosition: placement.defaultEyePosition.clone(),
    boostFlow: null,
    cameraStage: 'follow-orbit' as const,
    definition,
    observerDistance: definition.defaultDistance,
    orbitAngleRadians: 0,
    orbitMotionDirection: 0 as const,
    metersPerUnit: 1,
    overviewZoom: 1,
    perspective: 'child-rear' as const,
    targetObserverDistance: definition.defaultDistance,
    targetOrbitAngleRadians: 0,
    targetOverviewZoom: 1,
    distanceMotionDirection: 0 as const,
    jumpActive: false,
    jumpEntryMotion: 'idle' as const,
    jumpOffsetMeters: 0,
    jumpPhase: 'grounded' as const,
    jumpPhaseElapsedSeconds: 0,
    jumpVelocityMetersPerSecond: 0,
    placement,
    profile: {
      approach: 'comfortable' as const,
      gender: 'girl' as const,
      heightCm: 100,
      heightMeters: 1,
    },
    transition: null,
    rawSpanUnits: 12,
    view: 'pov' as const,
  }
  const controller = Object.create(
    ViewerController.prototype,
  ) as ViewerController
  Object.assign(controller as unknown as Record<string, unknown>, {
    camera,
    container,
    controls: { target: new Vector3() },
    current: { modelRoot: new Group() },
    destroyed: false,
    publishScaleEncounterSnapshot: vi.fn(),
    renderer,
    scaleEncounter: encounter,
    scaleEncounterListeners: new Set<() => void>(),
    updateCameraLighting: vi.fn(),
  })

  return {
    avatarEye,
    camera,
    container,
    controller,
    encounter,
    placement,
    renderer,
  }
}

describe('scale encounter visitor water contact', () => {
  it('reports terrain plus jump height, independent of the eye or animated model root', () => {
    const { controller, encounter } = createGroundedPovController(1.5, 'meganeura')
    encounter.environment = { groundHeightAtWorld: () => -0.62 }
    encounter.avatarPreviousEyePosition.set(2, 4, 3)
    encounter.jumpOffsetMeters = 0.3
    encounter.jumpVelocityMetersPerSecond = -1.5
    encounter.jumpPhase = 'airborne'
    const position = computeScaleEncounterOrbitedEyePosition(
      encounter.placement, 'land', encounter.observerDistance, encounter.orbitAngleRadians,
    )
    const internals = controller as unknown as { scaleEncounterRiverVisitor(): RiverVisitor | null }
    expect(internals.scaleEncounterRiverVisitor()).toEqual({
      x: position.x, z: position.z, feetY: -0.32, heightMeters: 1,
      verticalVelocity: -1.5, airborne: true,
    })
    encounter.avatarPreviousEyePosition.add(new Vector3(0.02, 0.1, 0.01))
    expect(internals.scaleEncounterRiverVisitor()?.x).toBe(position.x)
    expect(internals.scaleEncounterRiverVisitor()?.z).toBe(position.z)
  })

  it('disables visitor impacts during overview, scripted transitions and underwater encounters', () => {
    const { controller, encounter } = createGroundedPovController(1.5, 'meganeura')
    encounter.environment = { groundHeightAtWorld: () => -0.62 }
    const internals = controller as unknown as { scaleEncounterRiverVisitor(): RiverVisitor | null }
    expect(internals.scaleEncounterRiverVisitor()).not.toBeNull()
    encounter.view = 'overview'
    expect(internals.scaleEncounterRiverVisitor()).toBeNull()
    encounter.view = 'pov'
    encounter.transition = { targetView: 'pov' }
    expect(internals.scaleEncounterRiverVisitor()).toBeNull()
    encounter.transition = null
    encounter.definition = SCALE_ENCOUNTER_DEFINITIONS.mosasaurus
    expect(internals.scaleEncounterRiverVisitor()).toBeNull()
  })
})

describe('scale encounter child viewpoint switch', () => {
  it('moves the eye-view camera with the child instead of pinning it at the initial distance', () => {
    const harness = createGroundedPovController(
      1440 / 900,
      'spinosaurus',
      new Vector3(-4.7, 0, -1.3),
      new Vector3(9.45, 5.15, 2.6),
    )
    harness.encounter.perspective = 'child-eyes'
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
    }

    harness.encounter.observerDistance = 18
    internals.applyScaleEncounterPovPose()
    const initialCameraPosition = harness.camera.position.clone()

    harness.encounter.observerDistance = 4
    internals.applyScaleEncounterPovPose()
    const expectedCloseEye = computeScaleEncounterOrbitedEyePosition(
      harness.placement,
      'land',
      4,
      harness.encounter.orbitAngleRadians,
    )

    expect(harness.camera.position.distanceTo(expectedCloseEye)).toBeLessThan(
      1e-8,
    )
    expect(harness.camera.position.distanceTo(initialCameraPosition)).toBeGreaterThan(
      10,
    )
  })

  it('moves between the child eyes and the accepted trailing camera', async () => {
    const harness = createGroundedPovController(1440 / 900)

    const eyesPromise = harness.controller.transitionScaleEncounterPerspective(
      'child-eyes',
      1_600,
    )
    expect(harness.encounter.perspective).toBe('child-eyes')
    expect(
      (harness.encounter.transition as {
        targetPerspective?: string
      } | null)?.targetPerspective,
    ).toBe('child-eyes')
    harness.controller.finishScaleEncounterTransition()
    await eyesPromise
    expect(harness.encounter.cameraStage).toBe('pov')
    expect(harness.encounter.avatar.root.visible).toBe(false)

    const rearPromise = harness.controller.transitionScaleEncounterPerspective(
      'child-rear',
      1_600,
    )
    expect(harness.encounter.perspective).toBe('child-rear')
    harness.controller.finishScaleEncounterTransition()
    await rearPromise
    expect(harness.encounter.cameraStage).toBe('follow-orbit')
    expect(harness.encounter.avatar.root.visible).toBe(true)
  })

  it('keeps the close-approach child visible in the phone rear-view keepsake composition', () => {
    const harness = createGroundedPovController(390 / 844)
    harness.encounter.profile = {
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
      heightMeters: 1.1,
    }
    harness.encounter.observerDistance = 4.65
    harness.encounter.targetObserverDistance = 4.65
    harness.encounter.perspective = 'child-rear'
    ;(
      harness.controller as unknown as {
        applyScaleEncounterPovPose: () => void
      }
    ).applyScaleEncounterPovPose()
    harness.camera.updateMatrixWorld(true)

    const bounds = new Box3().setFromObject(
      harness.encounter.avatar.root,
      true,
    )
    const centre = bounds.getCenter(new Vector3()).project(harness.camera)
    expect(Math.abs(centre.x)).toBeLessThan(0.7)
    expect(centre.y).toBeGreaterThan(-0.72)
    expect(centre.y).toBeLessThan(0.45)
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(harness.camera)
          expect(Math.abs(projected.x)).toBeLessThan(0.9)
          expect(Math.abs(projected.y)).toBeLessThan(0.96)
        }
      }
    }
  })
})

describe('narrow scale encounter overview framing', () => {
  it.each([
    ['desktop', 1440 / 900, 900, 50],
    ['phone', 390 / 844, 844, 30],
  ])(
    'keeps a 110 cm child readable beside the full Spinosaurus on %s',
    (_label, aspect, viewportHeight, minimumAvatarPixels) => {
      const boundsMinimum = new Vector3(-4.698872, 0, -1.356681)
      const boundsMaximum = new Vector3(9.682645, 5.158696, 2.046446)
      const harness = createGroundedPovController(
        aspect,
        'spinosaurus',
        boundsMinimum,
        boundsMaximum,
      )
      const avatarScale = 1.1 / 1.05
      harness.encounter.profile = {
        approach: 'comfortable',
        gender: 'girl',
        heightCm: 110,
        heightMeters: 1.1,
      }
      harness.encounter.avatar.root.scale.setScalar(avatarScale)
      harness.encounter.avatar.root.position.copy(
        harness.placement.defaultEyePosition,
      )
      harness.encounter.avatar.root.position.y -= 0.985 * avatarScale
      harness.encounter.avatar.root.updateMatrixWorld(true)
      harness.encounter.overviewZoom = 0.82
      harness.encounter.targetOverviewZoom = 0.82

      const animal = new Mesh(
        new BoxGeometry(
          boundsMaximum.x - boundsMinimum.x,
          boundsMaximum.y - boundsMinimum.y,
          boundsMaximum.z - boundsMinimum.z,
        ),
        new MeshBasicMaterial(),
      )
      animal.position.copy(
        new Box3(boundsMinimum, boundsMaximum).getCenter(new Vector3()),
      )
      const animalRoot = new Group()
      animalRoot.add(animal)
      Object.assign(harness.controller as unknown as Record<string, unknown>, {
        current: { modelRoot: animalRoot },
      })

      const pose = (
        harness.controller as unknown as {
          computeScaleEncounterCameraPose: (view: 'overview') => {
            readonly fieldOfView: number
            readonly position: Vector3
            readonly quaternion: PerspectiveCamera['quaternion']
          }
        }
      ).computeScaleEncounterCameraPose('overview')
      harness.camera.fov = pose.fieldOfView
      harness.camera.position.copy(pose.position)
      harness.camera.quaternion.copy(pose.quaternion)
      harness.camera.updateProjectionMatrix()
      harness.camera.updateMatrixWorld(true)

      const avatarBounds = new Box3().setFromObject(
        harness.encounter.avatar.root,
        true,
      )
      let avatarMinimumY = Number.POSITIVE_INFINITY
      let avatarMaximumY = Number.NEGATIVE_INFINITY
      let avatarMinimumX = Number.POSITIVE_INFINITY
      let avatarMaximumX = Number.NEGATIVE_INFINITY
      for (const subject of [animalRoot, harness.encounter.avatar.root]) {
        const bounds = new Box3().setFromObject(subject, true)
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(harness.camera)
              expect(Math.abs(projected.x)).toBeLessThan(0.97)
              expect(Math.abs(projected.y)).toBeLessThan(0.97)
              if (subject === harness.encounter.avatar.root) {
                avatarMinimumX = Math.min(avatarMinimumX, projected.x)
                avatarMaximumX = Math.max(avatarMaximumX, projected.x)
                avatarMinimumY = Math.min(avatarMinimumY, projected.y)
                avatarMaximumY = Math.max(avatarMaximumY, projected.y)
              }
            }
          }
        }
      }
      const avatarHeightPixels =
        ((avatarMaximumY - avatarMinimumY) * viewportHeight) / 2
      expect(avatarMinimumX).toBeGreaterThan(-0.86)
      expect(avatarMaximumX).toBeLessThan(0.86)
      expect(avatarHeightPixels).toBeGreaterThan(minimumAvatarPixels)

      expect(avatarBounds.isEmpty()).toBe(false)
      animal.geometry.dispose()
      animal.material.dispose()
    },
  )

  it.each([
    ['ultrawide 3214 x 1148', 3214 / 1148, 3214, 1148, 180, 300],
    ['desktop 1440 x 900', 1440 / 900, 1440, 900, 90, 180],
    ['phone 390 x 844', 390 / 844, 390, 844, 60, 130],
  ])(
    'keeps the true half-metre Archaeopteryx profile readable beside a 100 cm child on %s',
    (
      _label,
      aspect,
      viewportWidth,
      viewportHeight,
      minimumAnimalPixels,
      minimumAvatarPixels,
    ) => {
      const boundsMinimum = new Vector3(1.95, 0.3, -0.21)
      const boundsMaximum = new Vector3(2.45, 0.62, 0.21)
      const harness = createGroundedPovController(
        aspect,
        'archaeopteryx',
        boundsMinimum,
        boundsMaximum,
      )
      harness.encounter.profile = {
        approach: 'comfortable',
        gender: 'girl',
        heightCm: 100,
        heightMeters: 1,
      }
      harness.encounter.avatar.root.position.copy(
        harness.placement.defaultEyePosition,
      )
      harness.encounter.avatar.root.position.y -= 0.985
      harness.encounter.avatar.root.updateMatrixWorld(true)
      harness.encounter.overviewZoom = 0.82
      harness.encounter.targetOverviewZoom = 0.82

      const animal = new Mesh(
        new BoxGeometry(0.5, 0.32, 0.42),
        new MeshBasicMaterial(),
      )
      animal.position.copy(
        new Box3(boundsMinimum, boundsMaximum).getCenter(new Vector3()),
      )
      const animalRoot = new Group()
      animalRoot.add(animal)
      Object.assign(harness.controller as unknown as Record<string, unknown>, {
        current: { modelRoot: animalRoot },
      })

      const pose = (
        harness.controller as unknown as {
          computeScaleEncounterCameraPose: (view: 'overview') => {
            readonly fieldOfView: number
            readonly position: Vector3
            readonly quaternion: PerspectiveCamera['quaternion']
          }
        }
      ).computeScaleEncounterCameraPose('overview')
      harness.camera.fov = pose.fieldOfView
      harness.camera.position.copy(pose.position)
      harness.camera.quaternion.copy(pose.quaternion)
      harness.camera.updateProjectionMatrix()
      harness.camera.updateMatrixWorld(true)

      const projectedBounds = (subject: Group | Mesh) => {
        const bounds = new Box3().setFromObject(subject, true)
        let minimumX = Number.POSITIVE_INFINITY
        let maximumX = Number.NEGATIVE_INFINITY
        let minimumY = Number.POSITIVE_INFINITY
        let maximumY = Number.NEGATIVE_INFINITY
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(harness.camera)
              minimumX = Math.min(minimumX, projected.x)
              maximumX = Math.max(maximumX, projected.x)
              minimumY = Math.min(minimumY, projected.y)
              maximumY = Math.max(maximumY, projected.y)
            }
          }
        }
        return { maximumX, maximumY, minimumX, minimumY }
      }
      const animalProjection = projectedBounds(animalRoot)
      const avatarProjection = projectedBounds(
        harness.encounter.avatar.root,
      )
      const animalLengthPixels =
        ((animalProjection.maximumX - animalProjection.minimumX) *
          viewportWidth) /
        2
      const avatarHeightPixels =
        ((avatarProjection.maximumY - avatarProjection.minimumY) *
          viewportHeight) /
        2
      const centreSeparationPixels =
        Math.abs(
          (animalProjection.maximumX + animalProjection.minimumX) / 2 -
            (avatarProjection.maximumX + avatarProjection.minimumX) / 2,
        ) *
        viewportWidth /
        2

      expect(animalProjection.maximumX).toBeLessThan(0.88)
      expect(avatarProjection.minimumX).toBeGreaterThan(-0.88)
      expect(animalLengthPixels).toBeGreaterThan(minimumAnimalPixels)
      expect(avatarHeightPixels).toBeGreaterThan(minimumAvatarPixels)
      expect(animalLengthPixels / avatarHeightPixels).toBeGreaterThan(0.42)
      expect(animalLengthPixels / avatarHeightPixels).toBeLessThan(0.58)
      expect(centreSeparationPixels).toBeLessThan(viewportWidth * 0.7)

      animal.geometry.dispose()
      animal.material.dispose()
    },
  )

  it.each([
    ['1024 x 1024 square PC', 1],
    ['1024 x 1365 narrow PC', 1024 / 1365],
    ['820 x 1024 narrow PC', 820 / 1024],
  ])('keeps the full child and T. rex inside %s at closest zoom', (_label, aspect) => {
    const harness = createGroundedPovController(aspect)
    const animal = new Mesh(
      new BoxGeometry(12, 4, 2),
      new MeshBasicMaterial(),
    )
    animal.position.set(2.2, 2, 0)
    const animalRoot = new Group()
    animalRoot.add(animal)
    harness.avatarEye.getWorldPosition(new Vector3())
    harness.encounter.avatar.root.position.copy(
      harness.placement.defaultEyePosition,
    ).y -= 0.985
    harness.encounter.avatar.root.updateMatrixWorld(true)
    harness.encounter.overviewZoom = 0.82
    harness.encounter.targetOverviewZoom = 0.82
    Object.assign(harness.controller as unknown as Record<string, unknown>, {
      current: { modelRoot: animalRoot },
    })
    const computePose = (
      harness.controller as unknown as {
        computeScaleEncounterCameraPose: (view: 'overview') => {
          readonly fieldOfView: number
          readonly position: Vector3
          readonly quaternion: PerspectiveCamera['quaternion']
        }
      }
    ).computeScaleEncounterCameraPose.bind(harness.controller)
    const pose = computePose('overview')
    harness.camera.fov = pose.fieldOfView
    harness.camera.position.copy(pose.position)
    harness.camera.quaternion.copy(pose.quaternion)
    harness.camera.updateProjectionMatrix()
    harness.camera.updateMatrixWorld(true)

    for (const subject of [animalRoot, harness.encounter.avatar.root]) {
      const bounds = new Box3().setFromObject(subject, true)
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const projected = new Vector3(x, y, z).project(harness.camera)
            expect(Math.abs(projected.x)).toBeLessThan(0.98)
            expect(Math.abs(projected.y)).toBeLessThan(0.98)
          }
        }
      }
    }

    animal.geometry.dispose()
    animal.material.dispose()
  })

  it('keeps Gigantoraptor and the child fully inside the default phone overview', () => {
    const harness = createGroundedPovController(390 / 844)
    const definition = SCALE_ENCOUNTER_DEFINITIONS.gigantoraptor
    const animal = new Mesh(
      new BoxGeometry(8, 3.2, 1.8),
      new MeshBasicMaterial(),
    )
    animal.position.set(2.2, 1.6, 0)
    const animalRoot = new Group()
    animalRoot.add(animal)
    harness.encounter.definition = definition
    harness.encounter.avatar.root.position.set(-3.8, 0, 0)
    harness.encounter.avatar.root.updateMatrixWorld(true)
    harness.encounter.overviewZoom = 0.82
    harness.encounter.targetOverviewZoom = 0.82
    Object.assign(harness.controller as unknown as Record<string, unknown>, {
      current: { modelRoot: animalRoot },
    })
    const computePose = (
      harness.controller as unknown as {
        computeScaleEncounterCameraPose: (view: 'overview') => {
          readonly fieldOfView: number
          readonly position: Vector3
          readonly quaternion: PerspectiveCamera['quaternion']
        }
      }
    ).computeScaleEncounterCameraPose.bind(harness.controller)
    const pose = computePose('overview')
    harness.camera.fov = pose.fieldOfView
    harness.camera.position.copy(pose.position)
    harness.camera.quaternion.copy(pose.quaternion)
    harness.camera.updateProjectionMatrix()
    harness.camera.updateMatrixWorld(true)

    for (const subject of [animalRoot, harness.encounter.avatar.root]) {
      const bounds = new Box3().setFromObject(subject, true)
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const projected = new Vector3(x, y, z).project(harness.camera)
            expect(Math.abs(projected.x)).toBeLessThan(0.98)
            expect(Math.abs(projected.y)).toBeLessThan(0.98)
          }
        }
      }
    }

    animal.geometry.dispose()
    animal.material.dispose()
  })
})

describe('grounded scale encounter POV clearance', () => {
  it('keeps the T. rex one-axis dolly at the child eye height instead of extending the diagonal rail underground', () => {
    const childEyeHeight = 0.985
    const placement = createScaleEncounterPlacement(
      'tyrannosaurus-rex',
      new Vector3(-3.8, 0, -0.8),
      new Vector3(8.2, 4, 0.8),
      childEyeHeight,
    )
    const oldDiagonalFarEye = positionOnScaleEncounterRail(
      placement.target,
      placement.observerRailDirection,
      SCALE_ENCOUNTER_DEFINITIONS['tyrannosaurus-rex'].maximumDistance,
    )
    expect(oldDiagonalFarEye.y).toBeLessThan(0.45)
    expect(oldDiagonalFarEye.y).toBeLessThan(childEyeHeight)

    const distances = [6.5, 12.5, 18]
    const eyes = distances.map((distance) =>
      computeScaleEncounterPovEyePosition(placement, 'land', distance),
    )
    for (const [index, eye] of eyes.entries()) {
      expect(eye.y).toBeCloseTo(placement.defaultEyePosition.y, 10)
      expect(eye.distanceTo(placement.target)).toBeCloseTo(
        distances[index]!,
        8,
      )
      expect(eye.z).toBeCloseTo(eyes[0]!.z, 10)
    }
    const firstSegment = eyes[1]!.clone().sub(eyes[0]!).normalize()
    const secondSegment = eyes[2]!.clone().sub(eyes[1]!).normalize()
    expect(firstSegment.distanceTo(secondSegment)).toBeLessThan(1e-10)
    expect(Math.abs(firstSegment.y)).toBeLessThan(1e-10)
  })

  it.each([
    ['desktop', 1440 / 900],
    ['390 x 844 mobile', 390 / 844],
  ])(
    'keeps the child and trailing camera above land at min/default/max on %s',
    (_label, aspect) => {
      const harness = createGroundedPovController(aspect)
      const internals = harness.controller as unknown as {
        applyScaleEncounterPovPose: () => void
        computeScaleEncounterCameraPose: (view: 'pov') => {
          readonly position: Vector3
          readonly quaternion: PerspectiveCamera['quaternion']
        }
      }
      const applyPov = internals.applyScaleEncounterPovPose.bind(
        harness.controller,
      )

      for (const distance of [6.5, 12.5, 18]) {
        harness.encounter.observerDistance = distance
        applyPov()
        const worldEye = harness.avatarEye.getWorldPosition(new Vector3())
        const expectedEye = computeScaleEncounterOrbitedEyePosition(
          harness.placement,
          'land',
          distance,
          harness.encounter.orbitAngleRadians,
        )
        const expectedCamera = internals.computeScaleEncounterCameraPose('pov')
        expect(worldEye.distanceTo(expectedEye)).toBeLessThan(1e-9)
        expect(
          harness.camera.position.distanceTo(expectedCamera.position),
        ).toBeLessThan(1e-9)
        expect(
          harness.camera.quaternion.angleTo(expectedCamera.quaternion),
        ).toBeLessThan(1e-6)
        expect(harness.camera.position.distanceTo(worldEye)).toBeGreaterThan(
          8,
        )
        expect(harness.camera.position.y).toBeGreaterThan(worldEye.y)
        expect(harness.encounter.avatar.root.visible).toBe(true)
        expect(
          new Vector3(0, 0, -1)
            .applyQuaternion(harness.camera.quaternion)
            .y,
        ).toBeLessThan(0)
        expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
          LAND_STAGE_GROUND_Y,
        )
      }

      const publishSnapshot = (
        ViewerController.prototype as unknown as {
          publishScaleEncounterSnapshot(this: ViewerController): void
        }
      ).publishScaleEncounterSnapshot.bind(harness.controller)
      publishSnapshot()
      expect(
        harness.renderer.domElement.dataset.scaleEncounterAvatarVariant,
      ).toBe('scale-encounter-child-girl-land-explorer-runtime-v1')
      expect(
        Number(
          harness.renderer.domElement.dataset.scaleEncounterEyeHeightMeters,
        ),
      ).toBeCloseTo(harness.placement.defaultEyePosition.y, 6)
    },
  )

  it('keeps every guided keyframe, the transition finish and both portrait/desktop resizes clear of land', () => {
    const harness = createGroundedPovController(1440 / 900)
    harness.encounter.observerDistance = 18
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
      computeScaleEncounterCameraPose: (view: 'pov') => {
        readonly position: Vector3
      }
      createScaleEncounterTransitionKeyframes: (
        view: 'overview' | 'pov',
      ) => readonly {
        readonly at: number
        readonly cameraStage: string
        readonly fieldOfView: number
        readonly position: Vector3
        readonly quaternion: PerspectiveCamera['quaternion']
      }[]
    }
    internals.applyScaleEncounterPovPose()
    const keyframes = internals.createScaleEncounterTransitionKeyframes('pov')
    expect(keyframes.length).toBeGreaterThan(2)
    for (const keyframe of keyframes) {
      const keyframeCamera = new PerspectiveCamera(
        keyframe.fieldOfView,
        1440 / 900,
        0.03,
        240,
      )
      keyframeCamera.position.copy(keyframe.position)
      keyframeCamera.quaternion.copy(keyframe.quaternion)
      expect(minimumNearPlaneCornerHeight(keyframeCamera)).toBeGreaterThan(
        LAND_STAGE_GROUND_Y,
      )
    }

    const transitionPromise = Promise.resolve()
    harness.encounter.view = 'overview'
    harness.encounter.transition = {
      duration: 8_204,
      keyframes,
      promise: transitionPromise,
      resolve: vi.fn(),
      startedAt: 1_000,
      targetView: 'pov' as const,
    }
    harness.container.clientWidth = 390
    harness.container.clientHeight = 844
    harness.controller.resize()
    const refreshedTransition = harness.encounter.transition as {
      readonly keyframes: readonly { readonly position: Vector3 }[]
    }
    const portraitPose = internals.computeScaleEncounterCameraPose('pov')
    expect(
      refreshedTransition.keyframes.at(-1)?.position.distanceTo(
        portraitPose.position,
      ),
    ).toBeLessThan(1e-9)

    harness.controller.finishScaleEncounterTransition()
    expect(harness.encounter.view).toBe('pov')
    expect(harness.encounter.cameraStage).toBe('follow-orbit')
    expect(harness.encounter.avatar.root.visible).toBe(true)
    expect(harness.camera.aspect).toBeCloseTo(390 / 844)
    expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
      LAND_STAGE_GROUND_Y,
    )

    harness.container.clientWidth = 1440
    harness.container.clientHeight = 900
    harness.controller.resize()
    expect(harness.camera.aspect).toBeCloseTo(1440 / 900)
    const desktopPose = internals.computeScaleEncounterCameraPose('pov')
    expect(
      harness.camera.position.distanceTo(desktopPose.position),
    ).toBeLessThan(1e-9)
    expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
      LAND_STAGE_GROUND_Y,
    )
    expect(harness.renderer.setSize).toHaveBeenLastCalledWith(1440, 900, false)
  })

  it.each([
    ['desktop', 1440 / 900, 3.2, 0.75],
    ['390 x 844 mobile', 390 / 844, 3.9, 0.95],
  ])(
    'keeps the child clear of the T. rex sight line in the %s rear establishing pose',
    (_label, aspect, minimumRearDistance, minimumSideOffset) => {
      const harness = createGroundedPovController(aspect)
      harness.encounter.view = 'overview'
      harness.encounter.cameraStage = 'overview'
      harness.encounter.perspective = 'child-eyes'
      const internals = harness.controller as unknown as {
        createScaleEncounterTransitionKeyframes: (
          view: 'overview' | 'pov',
        ) => readonly {
          readonly cameraStage: string
          readonly fieldOfView: number
          readonly position: Vector3
          readonly quaternion: PerspectiveCamera['quaternion']
        }[]
      }
      const rearKeyframes = internals
        .createScaleEncounterTransitionKeyframes('pov')
        .filter((keyframe) => keyframe.cameraStage === 'child-rear')
      expect(rearKeyframes).toHaveLength(2)

      const eye = harness.avatarEye.getWorldPosition(new Vector3())
      const forward = harness.placement.target.clone().sub(eye).normalize()
      const horizontalForward = forward.clone().setY(0).normalize()
      const childRight = horizontalForward
        .clone()
        .cross(new Vector3(0, 1, 0))
        .normalize()
      const rearOffset = rearKeyframes[0]!.position.clone().sub(eye)

      expect(rearOffset.length()).toBeGreaterThan(minimumRearDistance)
      expect(Math.abs(rearOffset.dot(childRight))).toBeGreaterThan(
        minimumSideOffset,
      )
      expect(rearKeyframes[0]!.fieldOfView).toBeGreaterThanOrEqual(58)
    },
  )

  it('keeps the child visible through the rear bridge, then enters their eyes', () => {
    const harness = createGroundedPovController(390 / 844)
    harness.encounter.view = 'overview'
    harness.encounter.cameraStage = 'child-rear'
    harness.encounter.perspective = 'child-eyes'
    harness.encounter.avatar.root.visible = true
    const internals = harness.controller as unknown as {
      createScaleEncounterTransitionKeyframes: (
        view: 'overview' | 'pov',
      ) => readonly {
        readonly at: number
        readonly cameraStage: string
        readonly fieldOfView: number
        readonly position: Vector3
        readonly quaternion: PerspectiveCamera['quaternion']
      }[]
      updateScaleEncounterTransition: (now: number) => void
    }
    const keyframes = internals.createScaleEncounterTransitionKeyframes('pov')
    harness.encounter.transition = {
      duration: 1_000,
      keyframes,
      promise: Promise.resolve(),
      resolve: vi.fn(),
      startedAt: 0,
      targetView: 'pov' as const,
    }

    internals.updateScaleEncounterTransition(620)
    expect(harness.encounter.cameraStage).toBe('child-rear')
    expect(harness.encounter.avatar.root.visible).toBe(true)

    internals.updateScaleEncounterTransition(800)
    expect(harness.encounter.cameraStage).toBe('eye-entry')
    expect(harness.encounter.avatar.root.visible).toBe(false)
  })

  it.each([
    ['desktop wide', 1440 / 900],
    ['phone portrait', 390 / 844],
  ])(
    'holds a dynamically fitted full-body Avatar showcase before rear follow orbit on %s',
    (_label, aspect) => {
      const harness = createGroundedPovController(aspect)
      harness.encounter.view = 'overview'
      harness.encounter.cameraStage = 'overview'
      const keyframes = (
        harness.controller as unknown as {
          createScaleEncounterTransitionKeyframes: (
            view: 'pov',
          ) => readonly {
            readonly at: number
            readonly cameraStage: string
            readonly fieldOfView: number
            readonly position: Vector3
            readonly quaternion: PerspectiveCamera['quaternion']
          }[]
        }
      ).createScaleEncounterTransitionKeyframes('pov')
      const showcases = keyframes.filter(
        (keyframe) => keyframe.cameraStage === 'full-body-showcase',
      )
      expect(showcases.map((keyframe) => keyframe.at)).toEqual([0.18, 0.4])
      expect(
        keyframes.findIndex(
          (keyframe) => keyframe.cameraStage === 'full-body-showcase',
        ),
      ).toBeLessThan(
        keyframes.findIndex(
          (keyframe) => keyframe.cameraStage === 'follow-orbit',
        ),
      )

      const pose = showcases[0]!
      const showcaseCamera = new PerspectiveCamera(
        pose.fieldOfView,
        aspect,
        0.03,
        240,
      )
      showcaseCamera.position.copy(pose.position)
      showcaseCamera.quaternion.copy(pose.quaternion)
      showcaseCamera.updateProjectionMatrix()
      showcaseCamera.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(
        harness.encounter.avatar.root,
        true,
      )
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const projected = new Vector3(x, y, z).project(showcaseCamera)
            expect(Math.abs(projected.x)).toBeLessThan(0.88)
            expect(Math.abs(projected.y)).toBeLessThan(0.88)
          }
        }
      }
    },
  )

  it('moves straight into the mobile water side framing without a second orbit correction', () => {
    const harness = createGroundedPovController(390 / 844)
    const definition = SCALE_ENCOUNTER_DEFINITIONS.mosasaurus
    const placement = createScaleEncounterPlacement(
      definition.id,
      new Vector3(-5, -1, -1),
      new Vector3(7, 6, 1),
      0.985,
    )
    const avatar = harness.encounter.avatar
    avatar.root.rotation.y = placement.avatarYawRadians
    avatar.root.position.copy(placement.defaultEyePosition)
    avatar.root.position.y -= avatar.eyeAnchor.position.y
    avatar.root.updateMatrixWorld(true)
    Object.assign(harness.encounter, {
      cameraStage: 'overview',
      definition,
      observerDistance: definition.defaultDistance,
      placement,
      targetObserverDistance: definition.defaultDistance,
      view: 'overview',
    })
    const animalRoot = new Group()
    const animal = new Mesh(
      new BoxGeometry(12, 7, 2),
      new MeshBasicMaterial(),
    )
    animal.position.set(1, 2.5, 0)
    animalRoot.add(animal)
    Object.assign(harness.controller as unknown as Record<string, unknown>, {
      current: { modelRoot: animalRoot },
    })
    const overviewPose = (
      harness.controller as unknown as {
        computeScaleEncounterCameraPose: (view: 'overview') => {
          readonly fieldOfView: number
          readonly position: Vector3
          readonly quaternion: PerspectiveCamera['quaternion']
        }
      }
    ).computeScaleEncounterCameraPose('overview')
    harness.camera.fov = overviewPose.fieldOfView
    harness.camera.position.copy(overviewPose.position)
    harness.camera.quaternion.copy(overviewPose.quaternion)
    harness.camera.updateProjectionMatrix()

    const internals = harness.controller as unknown as {
      createScaleEncounterTransitionKeyframes: (
        view: 'pov',
      ) => readonly {
        readonly at: number
        readonly cameraStage: string
        readonly fieldOfView: number
        readonly focusTarget?: Vector3
        readonly position: Vector3
        readonly quaternion: PerspectiveCamera['quaternion']
      }[]
      updateScaleEncounterTransition: (now: number) => void
    }
    const keyframes = internals.createScaleEncounterTransitionKeyframes('pov')
    const sideEstablishing = keyframes.filter(
      (keyframe) => keyframe.cameraStage === 'side-establishing',
    )
    const fullBodyShowcase = keyframes.filter(
      (keyframe) => keyframe.cameraStage === 'full-body-showcase',
    )

    expect(sideEstablishing).toHaveLength(2)
    expect(fullBodyShowcase).toHaveLength(2)
    for (const establishing of sideEstablishing) {
      expect(
        establishing.position.distanceTo(fullBodyShowcase[0]!.position),
      ).toBeLessThan(1e-10)
      expect(
        establishing.quaternion.angleTo(fullBodyShowcase[0]!.quaternion),
      ).toBeLessThan(1e-10)
      expect(establishing.fieldOfView).toBe(
        fullBodyShowcase[0]!.fieldOfView,
      )
      expect(establishing.focusTarget?.distanceTo(
        fullBodyShowcase[0]!.focusTarget!,
      )).toBeLessThan(1e-10)
    }

    harness.encounter.transition = {
      duration: 1_000,
      keyframes,
      promise: Promise.resolve(),
      resolve: vi.fn(),
      startedAt: 0,
      targetView: 'pov' as const,
    }
    const childCentre = new Box3()
      .setFromObject(avatar.root, true)
      .getCenter(new Vector3())
    for (const now of [20, 40, 60, 80]) {
      internals.updateScaleEncounterTransition(now)
      harness.camera.updateMatrixWorld(true)
      const projected = childCentre.clone().project(harness.camera)
      expect(Math.abs(projected.x)).toBeLessThan(0.95)
      expect(Math.abs(projected.y)).toBeLessThan(0.95)
    }

    animal.geometry.dispose()
    animal.material.dispose()
  })

  it('leaves the authored air and water observer rails unchanged', () => {
    for (const animalId of ['pteranodon', 'mosasaurus'] as const) {
      const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
      const placement = createScaleEncounterPlacement(
        animalId,
        new Vector3(-5, -1, -1),
        new Vector3(7, 6, 1),
        1,
      )
      for (const distance of [
        definition.minimumDistance,
        definition.defaultDistance,
        definition.maximumDistance,
      ]) {
        expect(
          computeScaleEncounterPovEyePosition(
            placement,
            definition.habitat,
            distance,
          ).distanceTo(
            positionOnScaleEncounterRail(
              placement.target,
              placement.observerRailDirection,
              distance,
            ),
          ),
        ).toBeLessThan(1e-10)
      }
    }
  })
})

const stegosaurusDescriptor = {
  id: 'stegosaurus',
  label: '剑龙',
  modelUrl: '/model.glb',
  presentation: {
    initialYawDegrees: animalDefinition.presentation.initialYawDegrees,
    safeAreaPadding: {
      landscape: animalDefinition.presentation.safeAreaPadding,
      portrait: Math.max(
        animalDefinition.presentation.safeAreaPadding,
        0.1,
      ),
    },
    shadow: {
      opacity: 0.42,
      scale: 0.82,
    },
  },
} satisfies ViewerModelDescriptor

describe('viewer presentation pose', () => {
  it('places the normalized model head on audience-left', () => {
    // This normalized GLB points from pelvis toward its head along local +Z.
    const headDirection = new Vector3(0, 0, 1).applyAxisAngle(
      new Vector3(0, 1, 0),
      MathUtils.degToRad(stegosaurusDescriptor.presentation.initialYawDegrees),
    )

    expect(stegosaurusDescriptor.presentation.initialYawDegrees).toBe(-90)
    expect(headDirection.x).toBeLessThan(-0.999)
    expect(Math.abs(headDirection.z)).toBeLessThan(1e-12)
  })

  it('restores yaw and the exact start of Idle on every reset', () => {
    const modelRoot = new Group()
    const clip = new AnimationClip('Idle', 1, [
      new NumberKeyframeTrack('.rotation[z]', [0, 1], [0, 0.8]),
    ])
    const mixer = new AnimationMixer(modelRoot)
    const action = mixer.clipAction(clip).play()
    mixer.update(0.5)
    modelRoot.rotation.y = 0.4

    expect(modelRoot.rotation.z).toBeGreaterThan(0)
    expect(mixer.time).toBeGreaterThan(0)

    resetStagedModelPose({
      action,
      descriptor: stegosaurusDescriptor,
      mixer,
      modelRoot,
    })

    expect(modelRoot.rotation.y).toBeCloseTo(-Math.PI / 2)
    expect(modelRoot.rotation.z).toBeCloseTo(0)
    expect(action.time).toBe(0)
    expect(mixer.time).toBe(0)
    expect(action.isRunning()).toBe(true)
  })

  it('does not invert an exact 180-degree yaw after quaternion restoration', () => {
    const modelRoot = new Group()
    modelRoot.quaternion.setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI,
    )
    const descriptor = {
      ...stegosaurusDescriptor,
      presentation: {
        ...stegosaurusDescriptor.presentation,
        initialYawDegrees: 180,
      },
    }

    resetStagedModelPose({
      action: null,
      descriptor,
      mixer: null,
      modelRoot,
    })

    const headDirection = new Vector3(0, 0, 1).applyQuaternion(
      modelRoot.quaternion,
    )
    expect(modelRoot.rotation.x).toBeCloseTo(0, 12)
    expect(modelRoot.rotation.y).toBeCloseTo(Math.PI, 12)
    expect(modelRoot.rotation.z).toBeCloseTo(0, 12)
    expect(headDirection.z).toBeCloseTo(-1, 12)
  })
})

describe('model bounds and contact shadow', () => {
  it('can fit the current skinned pose instead of a stale cached box', () => {
    const geometry = new BoxGeometry(1, 1, 1)
    const vertexCount = geometry.getAttribute('position').count
    const skinIndices = new Uint16Array(vertexCount * 4)
    const skinWeights = new Float32Array(vertexCount * 4)
    for (let index = 0; index < vertexCount; index += 1) {
      skinWeights[index * 4] = 1
    }
    geometry.setAttribute(
      'skinIndex',
      new Uint16BufferAttribute(skinIndices, 4),
    )
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(skinWeights, 4),
    )

    const bone = new Bone()
    const mesh = new SkinnedMesh(
      geometry,
      new MeshBasicMaterial(),
    )
    mesh.add(bone)
    mesh.bind(new Skeleton([bone]))
    const root = new Group()
    root.add(mesh)

    expect(computeModelBounds(root).getCenter(new Vector3()).x).toBeCloseTo(0)

    bone.position.x = 3
    root.updateMatrixWorld(true)

    expect(computeModelBounds(root).getCenter(new Vector3()).x).toBeCloseTo(0)
    expect(
      computeModelBounds(root, true).getCenter(new Vector3()).x,
    ).toBeCloseTo(3)
  })

  it('places the Maiasaura shadow under its compact foot cluster', () => {
    const layout = computeContactShadowLayout(
      new Vector3(5.125, 1.763, 0.822),
      0.32,
      {
        depthScale: 0.8,
        horizontalOffset: -0.98,
        yOffset: -0.04,
      },
    )

    expect(layout.position.toArray()).toEqual([-0.98, -0.034, 0])
    expect(layout.scale.x).toBeCloseTo(1.64)
    expect(layout.scale.y).toBeCloseTo(0.6576)
    expect(layout.scale.z).toBe(1)
  })

  it('places the Apatosaurus shadow under its four-foot cluster', () => {
    const layout = computeContactShadowLayout(
      new Vector3(3.2, 0.882, 0.432),
      0.38,
      {
        depthScale: 0.9,
        horizontalOffset: -0.61,
        yOffset: 0.11,
      },
    )

    expect(layout.position.toArray()).toEqual([-0.61, 0.116, 0])
    expect(layout.scale.x).toBeCloseTo(1.216)
    expect(layout.scale.y).toBeCloseTo(0.3888)
    expect(layout.scale.z).toBe(1)
  })
})

describe('model transition framing', () => {
  it('fully fades the composed canvas while the camera switches to the incoming fit', () => {
    const start = computeModelTransitionFrame(0)
    const outgoingFade = computeModelTransitionFrame(0.21)
    const cameraSwitch = computeModelTransitionFrame(0.42)
    const incomingFade = computeModelTransitionFrame(0.71)
    const end = computeModelTransitionFrame(1)

    expect(start).toEqual({
      modelOpacity: 1,
      phase: 'outgoing',
    })
    expect(outgoingFade.phase).toBe('outgoing')
    expect(outgoingFade.modelOpacity).toBeGreaterThan(0)
    expect(outgoingFade.modelOpacity).toBeLessThan(1)
    expect(cameraSwitch).toEqual({
      modelOpacity: 0,
      phase: 'incoming',
    })
    expect(incomingFade.phase).toBe('incoming')
    expect(incomingFade.modelOpacity).toBeGreaterThan(0)
    expect(incomingFade.modelOpacity).toBeLessThan(1)
    expect(end).toEqual({
      modelOpacity: 1,
      phase: 'incoming',
    })
  })

  it('clamps transition progress to a valid canvas opacity', () => {
    for (const progress of [-1, 0, 0.2, 0.419, 0.42, 0.8, 1, 2]) {
      const frame = computeModelTransitionFrame(progress)

      expect(frame.modelOpacity).toBeGreaterThanOrEqual(0)
      expect(frame.modelOpacity).toBeLessThanOrEqual(1)
    }
  })
})

describe('viewer zoom profile', () => {
  it('makes touch pinching more responsive and allows a closer view', () => {
    expect(viewerZoomProfileForPointer(true)).toEqual({
      minDistanceFactor: 0.6,
      zoomSpeed: 1.2,
    })
  })

  it('leaves precise-pointer zoom behavior unchanged', () => {
    expect(viewerZoomProfileForPointer(false)).toEqual({
      minDistanceFactor: 0.68,
      zoomSpeed: 1,
    })
  })
})

describe('camera-relative viewer lighting', () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315])(
    'keeps shaped key and fill light on the screen-facing hemisphere at %s°',
    (azimuthDegrees) => {
      const target = new Vector3(2, 1.5, -3)
      const azimuth = MathUtils.degToRad(azimuthDegrees)
      const camera = target.clone().add(
        new Vector3(
          Math.sin(azimuth) * 8,
          1.6,
          Math.cos(azimuth) * 8,
        ),
      )
      const pose = createCameraRelativeLightingPose()

      updateCameraRelativeLightingPose(pose, camera, target)

      const keyDirection = pose.keyPosition
        .clone()
        .sub(target)
        .normalize()
      const fillDirection = pose.fillPosition
        .clone()
        .sub(target)
        .normalize()

      expect(pose.targetPosition.toArray()).toEqual(target.toArray())
      expect(keyDirection.dot(pose.viewDirection)).toBeGreaterThan(0.75)
      expect(fillDirection.dot(pose.viewDirection)).toBeGreaterThan(0.75)
      expect(keyDirection.dot(pose.rightDirection)).toBeLessThan(-0.25)
      expect(fillDirection.dot(pose.rightDirection)).toBeGreaterThan(0.45)
      expect(keyDirection.dot(pose.upDirection)).toBeGreaterThan(0.4)
      expect(keyDirection.dot(fillDirection)).toBeLessThan(0.7)
    },
  )
})

describe('computeCameraFit', () => {
  function projectedBoundsCorners(
    bounds: Box3,
    camera: PerspectiveCamera,
  ): Vector3[] {
    const corners: Vector3[] = []
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          corners.push(new Vector3(x, y, z).project(camera))
        }
      }
    }
    return corners
  }

  function projectedCorners(
    bounds: Box3,
    aspect: number,
    paddingFraction: number,
  ): Vector3[] {
    const fit = computeCameraFit({
      aspect,
      bounds,
      fieldOfViewDegrees: 34,
      paddingFraction,
    })
    const camera = new PerspectiveCamera(34, aspect, fit.near, fit.far)
    camera.position.copy(fit.position)
    camera.lookAt(fit.target)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    return projectedBoundsCorners(bounds, camera)
  }

  it('fits a wide animal farther away in a portrait stage', () => {
    const bounds = new Box3(new Vector3(-3, 0, -1), new Vector3(3, 2, 1))
    const portrait = computeCameraFit({
      aspect: 0.6,
      bounds,
      fieldOfViewDegrees: 34,
      paddingFraction: 0.12,
    })
    const landscape = computeCameraFit({
      aspect: 1.8,
      bounds,
      fieldOfViewDegrees: 34,
      paddingFraction: 0.12,
    })

    expect(portrait.distance).toBeGreaterThan(landscape.distance)
    expect(portrait.target.toArray()).toEqual([0, 1, 0])
  })

  it('makes the default phone portrait presentation fifteen percent larger', () => {
    const bounds = new Box3(new Vector3(-3, 0, -1), new Vector3(3, 2, 1))
    const defaultFit = computeCameraFit({
      aspect: 390 / 844,
      bounds,
      fieldOfViewDegrees: 34,
      paddingFraction: 0.1,
    })
    const mobileFit = computeCameraFit({
      aspect: 390 / 844,
      bounds,
      fieldOfViewDegrees: 34,
      modelScale: modelScaleForViewport(390, 844),
      paddingFraction: 0.1,
    })

    expect(modelScaleForViewport(390, 844)).toBe(
      MODEL_PREVIEW_PHONE_PORTRAIT_SCALE,
    )
    expect(mobileFit.distance).toBeLessThan(defaultFit.distance)
    expect(modelScaleForViewport(844, 390)).toBe(1)
    expect(modelScaleForViewport(768, 1024)).toBe(1)
  })

  it('is deterministic for reset calls', () => {
    const options = {
      aspect: 16 / 9,
      bounds: new Box3(new Vector3(-2, 0, -0.5), new Vector3(2, 1.5, 0.5)),
      fieldOfViewDegrees: 34,
      paddingFraction: 0.09,
    }

    expect(computeCameraFit(options).position.toArray()).toEqual(
      computeCameraFit(options).position.toArray(),
    )
  })

  it('converts a smaller composition frame into its full-canvas field of view', () => {
    const fullFieldOfView = 34

    expect(
      computeCompositionFieldOfView(fullFieldOfView, 844, 844),
    ).toBeCloseTo(fullFieldOfView)
    expect(
      computeCompositionFieldOfView(fullFieldOfView, 844, 546),
    ).toBeLessThan(fullFieldOfView)
  })

  it('moves a model within the composition without changing its fitted size', () => {
    const composition = {
      compositionHeight: 734,
      compositionLeft: 468,
      compositionTop: 84,
      compositionWidth: 952,
      viewportHeight: 900,
      viewportWidth: 1440,
    }
    const centred = computeCompositionViewOffset(composition)
    const shiftedLeft = computeCompositionViewOffset({
      ...composition,
      horizontalOffsetFraction: -0.08,
    })
    const shiftedDown = computeCompositionViewOffset({
      ...composition,
      verticalOffsetFraction: 0.05,
    })

    expect(centred).toEqual({ x: -224, y: -1 })
    expect(shiftedLeft.x).toBeCloseTo(centred.x + 76.16)
    expect(shiftedLeft.y).toBe(centred.y)
    expect(shiftedDown.x).toBe(centred.x)
    expect(shiftedDown.y).toBeCloseTo(centred.y - 36.7)
  })

  it('caps large vertical composition nudges at thirty percent', () => {
    const composition = {
      compositionHeight: 700,
      compositionLeft: 400,
      compositionTop: 20,
      compositionWidth: 1000,
      viewportHeight: 900,
      viewportWidth: 1440,
    }
    const capped = computeCompositionViewOffset({
      ...composition,
      verticalOffsetFraction: 1,
    })
    const thirtyPercent = computeCompositionViewOffset({
      ...composition,
      verticalOffsetFraction: 0.3,
    })

    expect(capped).toEqual(thirtyPercent)
  })

  it('fits a wide model inside an offset phone composition on a full canvas', () => {
    const viewport = { width: 390, height: 844 }
    const composition = {
      left: 10,
      top: 138,
      width: 370,
      height: 546,
    }
    const bounds = new Box3(
      new Vector3(-4.456, 0, -1.025),
      new Vector3(4.456, 4.6, 1.025),
    )
    const fit = computeCameraFit({
      aspect: composition.width / composition.height,
      bounds,
      fieldOfViewDegrees: computeCompositionFieldOfView(
        34,
        viewport.height,
        composition.height,
      ),
      paddingFraction:
        stegosaurusDescriptor.presentation.safeAreaPadding.portrait,
    })
    const camera = new PerspectiveCamera(
      34,
      viewport.width / viewport.height,
      fit.near,
      fit.far,
    )
    camera.position.copy(fit.position)
    camera.lookAt(fit.target)
    camera.setViewOffset(
      viewport.width,
      viewport.height,
      viewport.width / 2 - (composition.left + composition.width / 2),
      viewport.height / 2 - (composition.top + composition.height / 2),
      viewport.width,
      viewport.height,
    )
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    for (const corner of projectedBoundsCorners(bounds, camera)) {
      const x = ((corner.x + 1) / 2) * viewport.width
      const y = ((1 - corner.y) / 2) * viewport.height
      expect(x).toBeGreaterThanOrEqual(composition.left - 1e-6)
      expect(x).toBeLessThanOrEqual(
        composition.left + composition.width + 1e-6,
      )
      expect(y).toBeGreaterThanOrEqual(composition.top - 1e-6)
      expect(y).toBeLessThanOrEqual(
        composition.top + composition.height + 1e-6,
      )
    }
  })

  it.each([
    [
      'phone-360x640',
      340 / 350,
      stegosaurusDescriptor.presentation.safeAreaPadding.portrait,
    ],
    [
      'phone-390x844',
      370 / 551,
      stegosaurusDescriptor.presentation.safeAreaPadding.portrait,
    ],
    [
      'phone-landscape-844x390',
      557 / 378,
      stegosaurusDescriptor.presentation.safeAreaPadding.landscape,
    ],
    [
      'tablet-768x1024',
      748 / 731,
      stegosaurusDescriptor.presentation.safeAreaPadding.portrait,
    ],
    [
      'desktop-1440x900',
      952 / 734,
      stegosaurusDescriptor.presentation.safeAreaPadding.landscape,
    ],
  ])('keeps every deep model-bounds corner inside the %s safe area', (
    _name,
    aspect,
    paddingFraction,
  ) => {
    const stegosaurusBounds = new Box3(
      new Vector3(-4.456, 0, -1.025),
      new Vector3(4.456, 4.6, 1.025),
    )
    const usableFraction = 1 - paddingFraction * 2
    const corners = projectedCorners(
      stegosaurusBounds,
      aspect,
      paddingFraction,
    )

    for (const corner of corners) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(usableFraction + 1e-6)
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(usableFraction + 1e-6)
      expect(corner.z).toBeGreaterThanOrEqual(-1)
      expect(corner.z).toBeLessThanOrEqual(1)
    }
  })
})

describe('disposeObject3D', () => {
  it('disposes each shared GPU resource once and detaches the tree', () => {
    const group = new Group()
    const geometry = new BoxGeometry()
    const imageSource = { close: vi.fn() }
    const texture = new Texture(imageSource)
    const material = new MeshBasicMaterial({ map: texture })
    const geometrySpy = vi.spyOn(geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')
    const textureSpy = vi.spyOn(texture, 'dispose')
    group.add(new Mesh(geometry, material), new Mesh(geometry, material))
    const parent = new Group()
    parent.add(group)

    const counts = disposeObject3D(group)

    expect(counts).toEqual({ geometries: 1, materials: 1, skeletons: 0, textures: 1 })
    expect(geometrySpy).toHaveBeenCalledOnce()
    expect(materialSpy).toHaveBeenCalledOnce()
    expect(textureSpy).toHaveBeenCalledOnce()
    expect(imageSource.close).toHaveBeenCalledOnce()
    expect(group.parent).toBeNull()
  })

  it('disposes shared skinned-mesh skeleton resources once', () => {
    const group = new Group()
    const skeleton = new Skeleton([new Bone()])
    const skeletonSpy = vi.spyOn(skeleton, 'dispose')
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    const first = new SkinnedMesh(geometry, material)
    const second = new SkinnedMesh(geometry, material)
    first.bind(skeleton)
    second.bind(skeleton)
    group.add(first, second)

    const counts = disposeObject3D(group)

    expect(counts.skeletons).toBe(1)
    expect(skeletonSpy).toHaveBeenCalledOnce()
  })

  it('leaves no scene children or open image sources after repeated presentation disposal', () => {
    const scene = new Group()
    const imageClosers: Array<ReturnType<typeof vi.fn>> = []

    for (let index = 0; index < 24; index += 1) {
      const presentation = new Group()
      const imageSource = { close: vi.fn() }
      imageClosers.push(imageSource.close)
      presentation.add(
        new Mesh(
          new BoxGeometry(),
          new MeshBasicMaterial({ map: new Texture(imageSource) }),
        ),
      )
      scene.add(presentation)

      expect(disposeObject3D(presentation)).toEqual({
        geometries: 1,
        materials: 1,
        skeletons: 0,
        textures: 1,
      })
      expect(presentation.parent).toBeNull()
    }

    expect(scene.children).toHaveLength(0)
    for (const close of imageClosers) {
      expect(close).toHaveBeenCalledOnce()
    }
  })
})
