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
import {
  computeContactShadowLayout,
  classifyModelResourceTiming,
  computeScaleEncounterOverviewFieldOfView,
  computeScaleEncounterPovEyePosition,
  computeModelTransitionFrame,
  computeModelBounds,
  createCameraRelativeLightingPose,
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
  it.each([0.82, 0.92, 1, 1.08, 1.18])(
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
    const encounter = {
      avatar: {},
      cameraStage: 'overview' as const,
      definition: { defaultDistance: 12.5 },
      observerDistance: 12.5,
      placement: {
        defaultEyePosition: new Vector3(-9, 1, 0),
        target,
      },
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

function createGroundedPovController(aspect: number): {
  readonly avatarEye: Group
  readonly camera: PerspectiveCamera
  readonly container: { clientHeight: number; clientWidth: number }
  readonly controller: ViewerController
  readonly encounter: Record<string, unknown> & {
    avatar: {
      root: Group
      visual: Group
      eyeAnchor: Group
    }
    distanceMotionDirection: -1 | 0 | 1
    observerDistance: number
    overviewZoom: number
    targetObserverDistance: number
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
  const definition = SCALE_ENCOUNTER_DEFINITIONS['tyrannosaurus-rex']
  const placement = createScaleEncounterPlacement(
    definition.id,
    new Vector3(-3.8, 0, -0.8),
    new Vector3(8.2, 4, 0.8),
    0.985,
  )
  const avatarRoot = new Group()
  avatarRoot.name =
    'scale-encounter-child-girl-base-review-candidate'
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
    avatar: {
      root: avatarRoot,
      visual: new Group(),
      eyeAnchor: avatarEye,
    },
    cameraStage: 'pov' as const,
    definition,
    observerDistance: definition.defaultDistance,
    metersPerUnit: 1,
    overviewZoom: 1,
    targetObserverDistance: definition.defaultDistance,
    targetOverviewZoom: 1,
    distanceMotionDirection: 0 as const,
    placement,
    profile: {
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

describe('narrow scale encounter overview framing', () => {
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
    'keeps the real controller camera and near plane above land at min/default/max on %s',
    (_label, aspect) => {
      const harness = createGroundedPovController(aspect)
      const applyPov = (
        harness.controller as unknown as {
          applyScaleEncounterPovPose: () => void
        }
      ).applyScaleEncounterPovPose.bind(harness.controller)

      for (const distance of [6.5, 12.5, 18]) {
        harness.encounter.observerDistance = distance
        applyPov()
        const worldEye = harness.avatarEye.getWorldPosition(new Vector3())
        expect(harness.camera.position.distanceTo(worldEye)).toBeLessThan(1e-9)
        expect(harness.camera.position.y).toBeCloseTo(
          harness.placement.defaultEyePosition.y,
          10,
        )
        expect(harness.camera.position.distanceTo(harness.placement.target)).toBeCloseTo(
          distance,
          8,
        )
        expect(
          new Vector3(0, 0, -1)
            .applyQuaternion(harness.camera.quaternion)
            .y,
        ).toBeGreaterThan(0)
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
      ).toBe('scale-encounter-child-girl-base-review-candidate')
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
    expect(refreshedTransition.keyframes.at(-1)?.position.y).toBeCloseTo(
      harness.placement.defaultEyePosition.y,
      10,
    )

    harness.controller.finishScaleEncounterTransition()
    expect(harness.encounter.view).toBe('pov')
    expect(harness.camera.aspect).toBeCloseTo(390 / 844)
    expect(minimumNearPlaneCornerHeight(harness.camera)).toBeGreaterThan(
      LAND_STAGE_GROUND_Y,
    )

    harness.container.clientWidth = 1440
    harness.container.clientHeight = 900
    harness.controller.resize()
    expect(harness.camera.aspect).toBeCloseTo(1440 / 900)
    expect(harness.camera.position.y).toBeCloseTo(
      harness.placement.defaultEyePosition.y,
      10,
    )
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

  it('hides the child at eye-entry before the camera reaches the POV eye', () => {
    const harness = createGroundedPovController(390 / 844)
    harness.encounter.view = 'overview'
    harness.encounter.cameraStage = 'child-rear'
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
