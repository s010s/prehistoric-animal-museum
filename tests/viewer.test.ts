import { createEncounterMotionFootprint } from '../src/viewer/scale-encounter-motion-footprint'
import { clearsAnimalGroundFootprint } from '../src/viewer/scale-encounter-ground-footprint'
import { loadTexturelessAnimal } from './helpers/load-textureless-animal'
import {
  Box3,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from 'three'
import {
  computeScaleEncounterOrbitedEyePosition,
  ViewerController,
} from '../src/viewer/ViewerController'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  createScaleEncounterPlacement,
  type NormalizedScaleEncounterProfile,
  type ScaleEncounterAnimalId,
} from '../src/viewer/scale-encounter'

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

describe('scale encounter child viewpoint switch', () => {

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
})

describe('grounded scale encounter POV clearance', () => {
  it.each([
    ['desktop', 1440 / 900],
    ['390 x 844 mobile', 390 / 844],
  ])(
    'keeps the trailing camera above land at min/default/max on %s',
    (_label, aspect) => {
      const harness = createGroundedPovController(aspect)
      const internals = harness.controller as unknown as {
        applyScaleEncounterPovPose: () => void
      }
      const applyPov = internals.applyScaleEncounterPovPose.bind(
        harness.controller,
      )

      for (const distance of [6.5, 12.5, 18]) {
        harness.encounter.observerDistance = distance
        applyPov()
        expect(harness.encounter.avatar.root.visible).toBe(true)
        expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
          LAND_STAGE_GROUND_Y,
        )
      }
    },
  )

  it('keeps every guided keyframe, the transition finish and both portrait/desktop resizes clear of land', () => {
    const harness = createGroundedPovController(1440 / 900)
    harness.encounter.observerDistance = 18
    const internals = harness.controller as unknown as {
      applyScaleEncounterPovPose: () => void
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

    harness.controller.finishScaleEncounterTransition()
    expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
      LAND_STAGE_GROUND_Y,
    )

    harness.container.clientWidth = 1440
    harness.container.clientHeight = 900
    harness.controller.resize()
    expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
      LAND_STAGE_GROUND_Y,
    )
  })

  it.each([
    ['desktop wide', 1440 / 900],
    ['phone portrait', 390 / 844],
  ])(
    'keeps the full-body Avatar showcase inside the viewport on %s',
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
})

// Preserve all 24 approaches and held-input frames on slower CI runners.
it.each(Object.values(SCALE_ENCOUNTER_DEFINITIONS).filter(definition => definition.habitat === 'land'))(
  'walks around $id using its shipped footprint and the real held-input collision path', async (definition) => {
  const model = await loadTexturelessAnimal(definition.id, 'Idle')
  const group = new Group().add(model)
  model.rotation.y = definition.modelYawRadians
  group.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(model, true)
  const scale = definition.displayedMeters / raw.getSize(new Vector3())[definition.measurementAxis]
  const centre = raw.getCenter(new Vector3())
  group.scale.setScalar(scale)
  group.position.set(definition.animalPosition.x - centre.x * scale,
    definition.animalPosition.y - raw.min.y * scale,
    definition.animalPosition.z - centre.z * scale)
  group.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(model, true)
  const hull = createEncounterMotionFootprint(definition)
  for (let i = 0; i < 24; i++) {
    const {controller, encounter} = createGroundedPovController(1.5, definition.id, bounds.min, bounds.max)
    encounter.placement = createScaleEncounterPlacement(definition.id, bounds.min, bounds.max, .985, hull)
    encounter.profile = {...encounter.profile, approach: 'close', heightCm: 110, heightMeters: 1.1}
    encounter.orbitAngleRadians = i * Math.PI / 12
    encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
    controller.setScaleEncounterDistanceMotion(1)
    const internals = controller as unknown as {updateScaleEncounterDistance(dt: number, now: number): void}
    for (let frame = 0; frame < 500; frame++) {
      const previousDistance = encounter.observerDistance
      const previousAngle = encounter.orbitAngleRadians
      internals.updateScaleEncounterDistance(.1, frame * 100)
      const eye = computeScaleEncounterOrbitedEyePosition(encounter.placement, 'land', encounter.observerDistance, encounter.orbitAngleRadians)
      expect(clearsAnimalGroundFootprint(eye, hull, .55 - 1e-5)).toBe(true)
      if (Math.abs(encounter.observerDistance - previousDistance) < 1e-8 &&
          Math.abs(encounter.orbitAngleRadians - previousAngle) < 1e-8) break
    }
    // Pure orbit input must remain outside the swept area while making progress.
    controller.setScaleEncounterDistanceMotion(0)
    for (const direction of [-1, 1] as const) {
      const start = encounter.orbitAngleRadians
      controller.setScaleEncounterOrbitMotion(direction)
      for (let frame = 0; frame < 15; frame++) {
        internals.updateScaleEncounterDistance(.1, frame * 100)
        const eye = computeScaleEncounterOrbitedEyePosition(encounter.placement, 'land', encounter.observerDistance, encounter.orbitAngleRadians)
        expect(clearsAnimalGroundFootprint(eye, hull, .55 - 1e-5)).toBe(true)
      }
      expect(Math.abs(encounter.orbitAngleRadians - start)).toBeGreaterThan(.02)
    }
  }
}, 120_000)
