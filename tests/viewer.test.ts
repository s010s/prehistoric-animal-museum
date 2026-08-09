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
import { disposeObject3D } from '../src/viewer/dispose'
import {
  computeContactShadowLayout,
  classifyModelResourceTiming,
  computeModelTransitionFrame,
  computeModelBounds,
  createCameraRelativeLightingPose,
  readModelResponseBuffer,
  requestModelResponse,
  resetStagedModelPose,
  updateCameraRelativeLightingPose,
  type ViewerModelDescriptor,
} from '../src/viewer/ViewerController'

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
