import {
  ACESFilmicToneMapping,
  AnimationMixer,
  BatchedMesh,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Quaternion,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {
  computeCameraFit,
  computeCompositionFieldOfView,
  computeCompositionViewOffset,
} from './camera-fit'
import { disposeObject3D } from './dispose'
import type { ModelCache } from './model-cache'
import { createModelPreviewPresentationSignature } from './model-preview-contract'
import {
  MODEL_PREVIEW_CAMERA_FIELD_OF_VIEW_DEGREES,
  MODEL_PREVIEW_MAX_PIXEL_RATIO,
  modelScaleForViewport,
} from './model-preview-profiles'
import type { ViewerModelDescriptor } from './viewer-model-descriptor'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  clampScaleEncounterDistance,
  clampScaleEncounterValue,
  computeScaleEncounterAvatarGroundedEyeHeight,
  createScaleEncounterPlacement,
  disposeScaleEncounterAvatar,
  isScaleEncounterAnimalId,
  normalizeScaleEncounterProfile,
  positionOnScaleEncounterRail,
  updateScaleEncounterAvatarIdle,
  type NormalizedScaleEncounterProfile,
  type ScaleEncounterAvatar,
  type ScaleEncounterAvatarFactory,
  type ScaleEncounterCameraStage,
  type ScaleEncounterDefinition,
  type ScaleEncounterPlacement,
  type ScaleEncounterProfile,
  type ScaleEncounterSnapshot,
  type ScaleEncounterView,
} from './scale-encounter'
import {
  createScaleEncounterEnvironment,
  disposeScaleEncounterEnvironment,
  syncScaleEncounterGroundContacts,
  updateScaleEncounterEnvironment,
  type ScaleEncounterEnvironment,
  type ScaleEncounterEnvironmentVariant,
  type ScaleEncounterSurfaceTextures,
} from './scale-encounter-environment'
import type { ScaleEncounterEcologyDensity } from './scale-encounter-ecology-density'
import { inspectScaleEncounterSceneResources } from './scale-encounter-performance'

export type { ViewerModelDescriptor } from './viewer-model-descriptor'
export type { ScaleEncounterEnvironmentVariant } from './scale-encounter-environment'
export type {
  ScaleEncounterProfile,
  ScaleEncounterSnapshot,
  ScaleEncounterView,
} from './scale-encounter'

export type ViewerFailureKind = 'webgl-unavailable' | 'context-lost' | 'model-load' | 'animation'

export interface ViewerFailure {
  kind: ViewerFailureKind
  message: string
  cause?: unknown
}

export interface ModelLoadProgress {
  readonly fromCache: boolean
  readonly loadedBytes: number
  readonly source: ModelLoadSource
  readonly totalBytes: number | null
}

export type ModelLoadSource = 'memory-cache' | 'http-cache' | 'network'

interface ModelResponse {
  readonly response: Response
  readonly source: Exclude<ModelLoadSource, 'memory-cache'>
}

interface ModelResourceTiming {
  readonly decodedBodySize: number
  readonly encodedBodySize: number
  readonly startTime: number
  readonly transferSize: number
}

export function classifyModelResourceTiming(
  entries: readonly ModelResourceTiming[],
  requestStartedAt: number,
): Exclude<ModelLoadSource, 'memory-cache'> {
  let timing: ModelResourceTiming | undefined
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && entry.startTime >= requestStartedAt - 1) {
      timing = entry
      break
    }
  }
  return timing &&
    timing.transferSize === 0 &&
    (timing.encodedBodySize > 0 || timing.decodedBodySize > 0)
    ? 'http-cache'
    : 'network'
}

function readCompletedModelSource(
  modelUrl: string,
  requestStartedAt: number,
): Exclude<ModelLoadSource, 'memory-cache'> {
  try {
    const resolvedUrl = new URL(modelUrl, window.location.href).href
    const entries = performance
      .getEntriesByName(resolvedUrl, 'resource')
      .map((entry) => entry as PerformanceResourceTiming)
    return classifyModelResourceTiming(entries, requestStartedAt)
  } catch {
    return 'network'
  }
}

/**
 * Uses one ordinary fetch so the browser can satisfy it from its HTTP cache.
 * A cache-only probe creates a misleading failed request in DevTools on every
 * cold miss before the successful transfer begins.
 */
export async function requestModelResponse(
  modelUrl: string,
  signal?: AbortSignal,
  onSource?: (source: Exclude<ModelLoadSource, 'memory-cache'>) => void,
): Promise<ModelResponse> {
  onSource?.('network')
  const response = await fetch(modelUrl, {
    priority: 'high',
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`模型请求失败（${response.status}）。`)
  }
  return { response, source: 'network' }
}

export async function readModelResponseBuffer(
  response: Response,
  signal?: AbortSignal,
  onProgress?: (progress: ModelLoadProgress) => void,
  source: Exclude<ModelLoadSource, 'memory-cache'> = 'network',
): Promise<ArrayBuffer> {
  const contentLength = Number(response.headers.get('content-length'))
  const totalBytes =
    Number.isSafeInteger(contentLength) && contentLength > 0
      ? contentLength
      : null

  if (!response.body || !onProgress) {
    const buffer = await response.arrayBuffer()
    signal?.throwIfAborted()
    onProgress?.({
      fromCache: source !== 'network',
      loadedBytes: buffer.byteLength,
      source,
      totalBytes: totalBytes ?? buffer.byteLength,
    })
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0

  while (true) {
    signal?.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    loadedBytes += value.byteLength
    onProgress({
      fromCache: source !== 'network',
      loadedBytes,
      source,
      totalBytes,
    })
  }

  signal?.throwIfAborted()
  const combined = new Uint8Array(loadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (totalBytes === null) {
    onProgress({
      fromCache: source !== 'network',
      loadedBytes,
      source,
      totalBytes: loadedBytes,
    })
  }
  return combined.buffer
}

export interface ViewerControllerOptions {
  compositionFrame?: HTMLElement
  modelCache?: ModelCache
  onFailure?: (failure: ViewerFailure) => void
  onModelReady?: (animalId: string) => void
}

export interface StagedViewerModel {
  readonly animalId: string
  readonly descriptor: ViewerModelDescriptor
  readonly loadSource: ModelLoadSource
  readonly group: Group
  readonly modelRoot: Group
  readonly bounds: Box3
  readonly mixer: AnimationMixer | null
  readonly action: AnimationAction | null
  disposed: boolean
}

interface ModelTransition {
  cameraSwitched: boolean
  readonly duration: number
  readonly incoming: StagedViewerModel
  readonly outgoing: StagedViewerModel
  readonly startedAt: number
}

interface SavedScaleEncounterViewerState {
  readonly actionEnabled: boolean | null
  readonly actionPaused: boolean | null
  readonly actionTime: number | null
  readonly actionTimeScale: number | null
  readonly actionWeight: number | null
  readonly ambientHemisphereIntensity: number
  readonly camera: PerspectiveCamera
  readonly controlsTarget: Vector3
  readonly controlsEnabled: boolean
  readonly controlsEnableDamping: boolean
  readonly controlsEnablePan: boolean
  readonly controlsEnableRotate: boolean
  readonly controlsEnableZoom: boolean
  readonly controlsAutoRotate: boolean
  readonly controlsMinDistance: number
  readonly controlsMaxDistance: number
  readonly controlsZoomSpeed: number
  readonly groupPosition: Vector3
  readonly groupQuaternion: Quaternion
  readonly groupScale: Vector3
  readonly groupVisible: boolean
  readonly sceneFog: Scene['fog']
  readonly modelRootPosition: Vector3
  readonly modelRootQuaternion: Quaternion
  readonly modelRootScale: Vector3
  readonly mixerTime: number | null
  readonly mixerTimeScale: number | null
  readonly resumeRotationAt: number
  readonly toneMappingExposure: number
  readonly modelContactShadowVisible: boolean | null
  readonly accessibilityLabel: string | null
}

interface ScaleEncounterCameraKeyframe {
  readonly at: number
  readonly cameraStage: ScaleEncounterCameraStage
  readonly fieldOfView: number
  readonly position: Vector3
  readonly quaternion: Quaternion
}

interface ScaleEncounterCameraTransition {
  readonly duration: number
  readonly keyframes: readonly ScaleEncounterCameraKeyframe[]
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly startedAt: number
  readonly targetView: ScaleEncounterView
}

interface ScaleEncounterRuntime {
  avatar: ScaleEncounterAvatar
  readonly definition: ScaleEncounterDefinition
  placement: ScaleEncounterPlacement
  readonly saved: SavedScaleEncounterViewerState
  readonly rawSpanUnits: number
  readonly metersPerUnit: number
  profile: NormalizedScaleEncounterProfile
  view: ScaleEncounterView
  cameraStage: ScaleEncounterCameraStage
  observerDistance: number
  overviewZoom: number
  targetObserverDistance: number
  targetOverviewZoom: number
  distanceMotionDirection: -1 | 0 | 1
  environment: ScaleEncounterEnvironment | null
  transition: ScaleEncounterCameraTransition | null
}

export interface CameraRelativeLightingPose {
  readonly fillPosition: Vector3
  readonly keyPosition: Vector3
  readonly rightDirection: Vector3
  readonly targetPosition: Vector3
  readonly upDirection: Vector3
  readonly viewDirection: Vector3
}

export interface ViewerZoomProfile {
  readonly minDistanceFactor: number
  readonly zoomSpeed: number
}

const WORLD_UP = new Vector3(0, 1, 0)
const VERTICAL_VIEW_REFERENCE = new Vector3(0, 0, 1)
const MIN_LIGHT_DISTANCE = 0.001
const DEFAULT_TONE_MAPPING_EXPOSURE = 1.08
const CAMERA_KEY_INTENSITY = 2.15
const CAMERA_FILL_INTENSITY = 0.72
const MODEL_TRANSITION_CAMERA_SWITCH = 0.42
const INITIAL_STILL_CROSSFADE_MS = 420
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM = 0.82
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM = 1.18
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_STEP = 0.08
const SCALE_ENCOUNTER_OVERVIEW_HOLD_SPEED_PER_SECOND = 0.15
const SCALE_ENCOUNTER_DISTANCE_HOLD_STEPS_PER_SECOND = 4
const SCALE_ENCOUNTER_DISTANCE_EASING_PER_SECOND = 14
// Keep a grounded first-person camera well above both the land plane
// (y = -0.035) and its 3 cm near plane, even if a future avatar has a
// malformed eye anchor. Reviewed child avatars sit much higher than this.
const SCALE_ENCOUNTER_GROUNDED_CAMERA_MINIMUM_HEIGHT = 0.35
const SCALE_ENCOUNTER_DISTANCE_STEP: Readonly<
  Record<ScaleEncounterDefinition['habitat'], number>
> = {
  land: 0.35,
  air: 0.45,
  water: 0.6,
}

const INACTIVE_SCALE_ENCOUNTER_SNAPSHOT: ScaleEncounterSnapshot = {
  active: false,
  animalId: null,
  cameraStage: 'overview',
  view: 'overview',
  transitioning: false,
  distanceMeters: null,
  overviewZoom: 1,
  error: null,
  profile: null,
  rawSpanUnits: null,
  metersPerUnit: null,
}

export function viewerZoomProfileForPointer(
  coarsePointer: boolean,
): ViewerZoomProfile {
  return coarsePointer
    ? { minDistanceFactor: 0.6, zoomSpeed: 1.2 }
    : { minDistanceFactor: 0.68, zoomSpeed: 1 }
}

/**
 * Resolves the child's eye/camera position for the one-dimensional POV dolly.
 *
 * A land placement's original sight-line rail joins the child's grounded eye
 * to a higher point on the animal. Extending that diagonal past its calibrated
 * default distance also extends it down through the ground. The UI's "farther"
 * control could therefore lower a T. rex observer almost to (or, with a
 * different child eye anchor, below) the land plane.
 *
 * On land the useful interaction is a horizontal dolly at the child's eye
 * height. `distance` remains the true eye-to-target distance, while the camera
 * moves on one fixed horizontal axis. Air and water retain their authored
 * three-dimensional rails unchanged.
 */
export function computeScaleEncounterPovEyePosition(
  placement: ScaleEncounterPlacement,
  habitat: ScaleEncounterDefinition['habitat'],
  distance: number,
  result = new Vector3(),
): Vector3 {
  if (habitat !== 'land') {
    return positionOnScaleEncounterRail(
      placement.target,
      placement.observerRailDirection,
      distance,
      result,
    )
  }

  const eyeHeight = Math.max(
    placement.defaultEyePosition.y,
    SCALE_ENCOUNTER_GROUNDED_CAMERA_MINIMUM_HEIGHT,
  )
  const verticalDistance = placement.target.y - eyeHeight
  const horizontalDistance = Math.sqrt(
    Math.max(distance * distance - verticalDistance * verticalDistance, 0),
  )
  result.copy(placement.observerRailDirection).setY(0)
  if (result.lengthSq() < 1e-8) {
    result.copy(placement.defaultEyePosition).sub(placement.target).setY(0)
  }
  if (result.lengthSq() < 1e-8) {
    result.set(-1, 0, 0)
  }
  return result
    .normalize()
    .multiplyScalar(horizontalDistance)
    .add(placement.target)
    .setY(eyeHeight)
}

/**
 * Uses optical zoom for the overview instead of moving only the foreground
 * subjects through an infinitely distant panorama. The tangent-space mapping
 * preserves the old `1 / zoom` apparent-size curve while making the child,
 * animal and 360 background enlarge or shrink together.
 */
export function computeScaleEncounterOverviewFieldOfView(
  baseFieldOfViewDegrees: number,
  overviewZoom: number,
): number {
  const baseFieldOfView = MathUtils.degToRad(baseFieldOfViewDegrees)
  return MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(baseFieldOfView / 2) *
          clampScaleEncounterValue(
            overviewZoom,
            SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM,
            SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM,
          ),
      ),
  )
}

export interface ModelTransitionFrame {
  /**
   * Opacity of the composited WebGL canvas. It reaches zero exactly while the
   * shared camera is refitted, so the scene background stays untouched and a
   * large difference in animal size never appears as a one-frame jump.
   */
  readonly modelOpacity: number
  readonly phase: 'outgoing' | 'incoming'
}

function smoothStep(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}

function createVoidDeferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let complete = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    complete = resolve
  })
  return { promise, resolve: complete }
}

/**
 * Fades the already-composited WebGL canvas before fitting the shared camera
 * to the new model, then fades it back in. Individual GLTF materials remain
 * fully opaque and the exhibit background never receives a rectangular veil.
 */
export function computeModelTransitionFrame(
  progress: number,
): ModelTransitionFrame {
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  if (clampedProgress < MODEL_TRANSITION_CAMERA_SWITCH) {
    return {
      modelOpacity:
        1 -
        smoothStep(clampedProgress / MODEL_TRANSITION_CAMERA_SWITCH),
      phase: 'outgoing',
    }
  }

  return {
    modelOpacity: smoothStep(
      (clampedProgress - MODEL_TRANSITION_CAMERA_SWITCH) /
        (1 - MODEL_TRANSITION_CAMERA_SWITCH),
    ),
    phase: 'incoming',
  }
}

export function createCameraRelativeLightingPose(): CameraRelativeLightingPose {
  return {
    fillPosition: new Vector3(),
    keyPosition: new Vector3(),
    rightDirection: new Vector3(),
    targetPosition: new Vector3(),
    upDirection: new Vector3(),
    viewDirection: new Vector3(),
  }
}

/**
 * Keeps two asymmetric directional lights on the camera-facing hemisphere.
 * The key stays higher and to camera-left while the weaker fill comes from
 * camera-right, preserving surface shape instead of producing flat frontal
 * illumination.
 */
export function updateCameraRelativeLightingPose(
  pose: CameraRelativeLightingPose,
  cameraPosition: Vector3,
  targetPosition: Vector3,
): void {
  pose.targetPosition.copy(targetPosition)
  pose.viewDirection.copy(cameraPosition).sub(targetPosition)
  const distance = Math.max(
    pose.viewDirection.length(),
    MIN_LIGHT_DISTANCE,
  )
  if (pose.viewDirection.lengthSq() < MIN_LIGHT_DISTANCE ** 2) {
    pose.viewDirection.set(0, 0, 1)
  } else {
    pose.viewDirection.normalize()
  }

  const upReference =
    Math.abs(pose.viewDirection.y) > 0.985
      ? VERTICAL_VIEW_REFERENCE
      : WORLD_UP
  pose.rightDirection
    .crossVectors(upReference, pose.viewDirection)
    .normalize()
  pose.upDirection
    .crossVectors(pose.viewDirection, pose.rightDirection)
    .normalize()

  pose.keyPosition
    .copy(targetPosition)
    .addScaledVector(pose.viewDirection, distance)
    .addScaledVector(pose.rightDirection, -distance * 0.46)
    .addScaledVector(pose.upDirection, distance * 0.58)
  pose.fillPosition
    .copy(targetPosition)
    .addScaledVector(pose.viewDirection, distance * 0.82)
    .addScaledVector(pose.rightDirection, distance * 0.58)
    .addScaledVector(pose.upDirection, distance * 0.12)
}

export function resetStagedModelPose(
  staged: Pick<
    StagedViewerModel,
    'action' | 'descriptor' | 'mixer' | 'modelRoot'
  >,
): void {
  staged.action?.reset().play()
  staged.mixer?.setTime(0)
  staged.modelRoot.rotation.y = MathUtils.degToRad(
    staged.descriptor.presentation.initialYawDegrees,
  )
  staged.modelRoot.updateMatrixWorld(true)
}

export class ViewerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ViewerUnavailableError'
  }
}

export function computeModelBounds(
  modelRoot: Group,
  precise = false,
): Box3 {
  modelRoot.updateMatrixWorld(true)
  return new Box3().setFromObject(modelRoot, precise)
}

export function computeContactShadowLayout(
  size: Vector3,
  scale: number,
  options: {
    depthOffset?: number
    depthScale?: number
    horizontalOffset?: number
    yOffset?: number
  } = {},
): { position: Vector3; scale: Vector3 } {
  return {
    position: new Vector3(
      options.horizontalOffset ?? 0,
      0.006 + (options.yOffset ?? 0),
      options.depthOffset ?? 0,
    ),
    scale: new Vector3(
      Math.max(size.x * scale, 0.1),
      options.depthScale === undefined
        ? Math.max(size.z * scale * 1.25, size.x * scale * 0.22, 0.1)
        : Math.max(size.z * options.depthScale, 0.1),
      1,
    ),
  }
}

function makeContactShadow(
  opacity: number,
  size: Vector3,
  scale: number,
  options: {
    depthOffset?: number
    depthScale?: number
    horizontalOffset?: number
    yOffset?: number
  } = {},
): Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')

  if (context) {
    context.fillStyle = '#000'
    context.fillRect(0, 0, 128, 128)
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
    // Three.js reads the green channel of alphaMap, not its alpha channel.
    // A white-to-black mask therefore produces a genuinely dark, tight core
    // while keeping the edge feathered and directionless.
    gradient.addColorStop(0, '#fff')
    gradient.addColorStop(0.18, '#f2f2f2')
    gradient.addColorStop(0.46, '#9a9a9a')
    gradient.addColorStop(0.74, '#333')
    gradient.addColorStop(1, '#000')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  }

  const alphaMap = new CanvasTexture(canvas)
  const material = new MeshBasicMaterial({
    alphaMap,
    color: new Color('#182319'),
    depthWrite: false,
    opacity,
    side: DoubleSide,
    transparent: true,
  })
  const geometry = new CircleGeometry(0.5, 48)
  const shadow = new Mesh(geometry, material)
  const layout = computeContactShadowLayout(size, scale, options)
  shadow.name = 'contact-shadow'
  shadow.rotation.x = -Math.PI / 2
  shadow.position.copy(layout.position)
  shadow.scale.copy(layout.scale)
  shadow.renderOrder = -1
  return shadow
}

function findClip(clips: AnimationClip[], name: string): AnimationClip | undefined {
  return clips.find((clip) => clip.name === name)
}

export class ViewerController {
  private readonly camera = new PerspectiveCamera(
    MODEL_PREVIEW_CAMERA_FIELD_OF_VIEW_DEGREES,
    1,
    0.01,
    100,
  )
  private readonly scene = new Scene()
  private readonly renderer: WebGLRenderer
  private readonly controls: OrbitControls
  private readonly cameraKeyLight = new DirectionalLight(
    '#fff0ce',
    CAMERA_KEY_INTENSITY,
  )
  private readonly cameraFillLight = new DirectionalLight(
    '#e4f1ff',
    CAMERA_FILL_INTENSITY,
  )
  private readonly sceneAccentLight = new DirectionalLight('#ffd6a0', 0.55)
  private readonly ambientHemisphereLight = new HemisphereLight(
    '#fff8df',
    '#71805e',
    1.3,
  )
  private readonly scaleEncounterHemisphereLight = new HemisphereLight(
    '#e8eee6',
    '#969986',
    0,
  )
  private readonly scaleEncounterSunLight = new DirectionalLight(
    '#ffe9c8',
    1.85,
  )
  private readonly scaleEncounterSunTarget = new Group()
  private readonly scaleEncounterSkyFillLight = new DirectionalLight(
    '#e4eee9',
    1.12,
  )
  private readonly scaleEncounterSkyFillTarget = new Group()
  private readonly cameraLightTarget = new Group()
  private readonly cameraLightingPose = createCameraRelativeLightingPose()
  private readonly resizeObserver: ResizeObserver
  private readonly coarsePointerQuery = window.matchMedia('(pointer: coarse)')
  private readonly reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  private readonly handleReducedMotionChange = () => {
    const wasReduced = this.reducedMotion
    this.reducedMotion = this.reducedMotionQuery.matches
    if (this.reducedMotion && this.scaleEncounter?.transition) {
      this.finishScaleEncounterTransition()
    }
    if (wasReduced && !this.reducedMotion) {
      this.resumeRotationAt = 0
    }
    this.updateAutoRotation(performance.now())
  }
  private readonly handleContextLost = (event: Event) => {
    event.preventDefault()
    this.options.onFailure?.({
      kind: 'context-lost',
      message: 'WebGL 绘图环境暂时不可用。',
    })
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.stopLoop()
  }
  private readonly handleControlStart = () => {
    this.resumeRotationAt = Number.POSITIVE_INFINITY
    this.controls.autoRotate = false
  }
  private readonly handleControlEnd = () => {
    this.resumeRotationAt = performance.now() + 4_000
  }

  private current: StagedViewerModel | null = null
  private destroyed = false
  private reducedMotion = this.reducedMotionQuery.matches
  private resumeRotationAt = 0
  private initialPoseHoldUntil = 0
  private reviewAnimationTime: number | null = null
  private lastFrameTime = performance.now()
  private transition: ModelTransition | null = null
  private compositionFitFrame: number | null = null
  private firstFrameConfirmationFrame: number | null = null
  private readonly scaleEncounterListeners = new Set<() => void>()
  private scaleEncounter: ScaleEncounterRuntime | null = null
  private scaleEncounterSnapshot = INACTIVE_SCALE_ENCOUNTER_SNAPSHOT
  private scaleEncounterAvatarFactory: ScaleEncounterAvatarFactory = () => {
    throw new Error('scale-encounter-avatar-factory-unavailable')
  }
  private scaleEncounterEnvironmentVariant: ScaleEncounterEnvironmentVariant =
    'baseline'
  private scaleEncounterEcologyDensity: ScaleEncounterEcologyDensity =
    'current'
  private scaleEncounterPanoramaTexture: Texture | null = null
  private scaleEncounterMatureTreeAtlas: Texture | null = null
  private scaleEncounterForestProps: Group | null = null
  private scaleEncounterSurfaceTextures: ScaleEncounterSurfaceTextures | null =
    null
  private scaleEncounterDiagnosticsEnvironment: ScaleEncounterEnvironment | null =
    null
  private scaleEncounterDiagnosticsUpdatedAt = Number.NEGATIVE_INFINITY
  private scaleEncounterDistanceSnapshotUpdatedAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ViewerControllerOptions = {},
  ) {
    try {
      this.renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      })
    } catch (cause) {
      const failure = {
        kind: 'webgl-unavailable' as const,
        message: '这个浏览器现在不能显示 3D 模型。',
        cause,
      }
      options.onFailure?.(failure)
      throw new ViewerUnavailableError(failure.message, { cause })
    }

    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DEFAULT_TONE_MAPPING_EXPOSURE
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setClearAlpha(0)
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, MODEL_PREVIEW_MAX_PIXEL_RATIO),
    )
    this.renderer.domElement.className = 'viewer-canvas'
    this.renderer.domElement.setAttribute('role', 'img')
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    this.renderer.domElement.setAttribute('aria-label', '三维动物模型，可拖动旋转并缩放')
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost)
    this.container.append(this.renderer.domElement)

    this.scene.add(this.ambientHemisphereLight)
    this.cameraLightTarget.name = 'camera-light-target'
    this.cameraKeyLight.name = 'camera-relative-key'
    this.cameraFillLight.name = 'camera-relative-fill'
    this.sceneAccentLight.name = 'scene-accent'
    this.scaleEncounterSunLight.name = 'scale-encounter-world-sun'
    this.scaleEncounterSunTarget.name = 'scale-encounter-world-sun-target'
    this.scaleEncounterSkyFillLight.name = 'scale-encounter-world-sky-fill'
    this.scaleEncounterSkyFillTarget.name =
      'scale-encounter-world-sky-fill-target'
    this.cameraKeyLight.target = this.cameraLightTarget
    this.cameraFillLight.target = this.cameraLightTarget
    this.sceneAccentLight.target = this.cameraLightTarget
    this.sceneAccentLight.position.set(-5, 7, -4)
    this.scaleEncounterSunLight.target = this.scaleEncounterSunTarget
    this.scaleEncounterSunLight.position.set(48, 72, 31)
    this.scaleEncounterSunTarget.position.set(0, 1.5, 0)
    this.scaleEncounterSunLight.castShadow = true
    this.scaleEncounterSunLight.visible = false
    this.scaleEncounterSunLight.shadow.mapSize.set(2048, 2048)
    this.scaleEncounterSunLight.shadow.camera.left = -42
    this.scaleEncounterSunLight.shadow.camera.right = 42
    this.scaleEncounterSunLight.shadow.camera.top = 42
    this.scaleEncounterSunLight.shadow.camera.bottom = -42
    this.scaleEncounterSunLight.shadow.camera.near = 8
    this.scaleEncounterSunLight.shadow.camera.far = 150
    this.scaleEncounterSunLight.shadow.bias = -0.00035
    // Keep the first shadow texel attached to small shoes and claws. A 3.5 cm
    // normal offset created an obvious floating gap at child-eye height.
    this.scaleEncounterSunLight.shadow.normalBias = 0.012
    // A fixed, shadowless skylight from the opposite hemisphere preserves
    // texture on the child and animal's camera-facing backs. It stays in
    // world space so rear/POV moves do not make the lighting chase the lens.
    this.scaleEncounterSkyFillLight.target = this.scaleEncounterSkyFillTarget
    this.scaleEncounterSkyFillLight.position.set(-42, 36, -58)
    this.scaleEncounterSkyFillTarget.position.set(0, 2.4, 0)
    this.scaleEncounterSkyFillLight.castShadow = false
    this.scaleEncounterSkyFillLight.visible = false
    this.scene.add(
      this.cameraLightTarget,
      this.cameraKeyLight,
      this.cameraFillLight,
      this.sceneAccentLight,
      this.scaleEncounterHemisphereLight,
      this.scaleEncounterSunTarget,
      this.scaleEncounterSunLight,
      this.scaleEncounterSkyFillTarget,
      this.scaleEncounterSkyFillLight,
    )

    this.camera.position.set(0, 1, 4)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.enablePan = false
    this.controls.autoRotateSpeed = 0.52
    this.controls.addEventListener('start', this.handleControlStart)
    this.controls.addEventListener('end', this.handleControlEnd)
    this.updateCameraLighting()

    this.reducedMotionQuery.addEventListener('change', this.handleReducedMotionChange)
    this.resizeObserver = new ResizeObserver(() => {
      this.resize()
    })
    this.resizeObserver.observe(this.container)
    if (
      this.options.compositionFrame &&
      this.options.compositionFrame !== this.container
    ) {
      this.resizeObserver.observe(this.options.compositionFrame)
    }
    this.resize()
    this.startLoop()
  }

  async stageModel(
    descriptor: ViewerModelDescriptor,
    signal?: AbortSignal,
    onProgress?: (progress: ModelLoadProgress) => void,
  ): Promise<StagedViewerModel> {
    try {
      let loadSource: ModelLoadSource = 'memory-cache'
      let buffer = this.options.modelCache?.get(descriptor.modelUrl) ?? null
      if (buffer === null) {
        const requestStartedAt = performance.now()
        const { response, source } = await requestModelResponse(
          descriptor.modelUrl,
          signal,
          (pendingSource) => {
            onProgress?.({
              fromCache: pendingSource !== 'network',
              loadedBytes: 0,
              source: pendingSource,
              totalBytes: null,
            })
          },
        )
        buffer = await readModelResponseBuffer(
          response,
          signal,
          onProgress,
          source,
        )
        signal?.throwIfAborted()
        loadSource = readCompletedModelSource(
          descriptor.modelUrl,
          requestStartedAt,
        )
        if (loadSource === 'http-cache') {
          onProgress?.({
            fromCache: true,
            loadedBytes: buffer.byteLength,
            source: loadSource,
            totalBytes: buffer.byteLength,
          })
        }
        this.options.modelCache?.set(descriptor.modelUrl, buffer)
      } else {
        onProgress?.({
          fromCache: true,
          loadedBytes: buffer.byteLength,
          source: 'memory-cache',
          totalBytes: buffer.byteLength,
        })
      }
      signal?.throwIfAborted()
      const resourceBase = new URL('.', new URL(descriptor.modelUrl, window.location.href)).href
      // Each request gets its own loader. Rapid selections can leave an older
      // parse finishing after its AbortSignal fires; isolating loader state
      // keeps that stale work from affecting the latest requested model.
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.parseAsync(buffer, resourceBase)
      if (signal?.aborted) {
        disposeObject3D(gltf.scene)
        signal.throwIfAborted()
      }

      const modelRoot = gltf.scene
      modelRoot.name = `${descriptor.id}-model`
      modelRoot.rotation.y = (descriptor.presentation.initialYawDegrees * Math.PI) / 180
      modelRoot.updateMatrixWorld(true)

      const preciseBounds = descriptor.presentation.preciseBounds ?? false
      let mixer: AnimationMixer | null = null
      let action: AnimationAction | null = null
      const prepareAnimation = (): void => {
        if (!descriptor.animation) {
          return
        }
        const clip = findClip(gltf.animations, descriptor.animation.clip)
        if (clip) {
          mixer = new AnimationMixer(modelRoot)
          action = mixer.clipAction(clip)
          action.setLoop(
            descriptor.animation.loop === 'once' ? LoopOnce : LoopRepeat,
            Infinity,
          )
          action.clampWhenFinished = descriptor.animation.loop === 'once'
          action.timeScale = descriptor.animation.speed
          action.play()
          mixer.setTime(0)
          modelRoot.updateMatrixWorld(true)
        } else {
          this.options.onFailure?.({
            kind: 'animation',
            message: `模型中没有找到 ${descriptor.animation.clip} 动作，已显示静态模型。`,
          })
        }
      }

      if (preciseBounds) {
        prepareAnimation()
      }

      const initialBounds = computeModelBounds(modelRoot, preciseBounds)
      const center = initialBounds.getCenter(new Vector3())
      modelRoot.position.x -= center.x
      modelRoot.position.y -= initialBounds.min.y
      modelRoot.position.z -= center.z
      modelRoot.updateMatrixWorld(true)

      const bounds = computeModelBounds(modelRoot, preciseBounds)
      const size = bounds.getSize(new Vector3())
      const group = new Group()
      group.name = `${descriptor.id}-presentation`
      group.add(modelRoot)
      if (descriptor.presentation.shadow.opacity > 0) {
        group.add(
          makeContactShadow(
            descriptor.presentation.shadow.opacity,
            size,
            descriptor.presentation.shadow.scale,
            descriptor.presentation.shadow,
          ),
        )
      }
      if (!preciseBounds) {
        prepareAnimation()
      }

      return {
        action,
        animalId: descriptor.id,
        bounds,
        descriptor,
        disposed: false,
        group,
        loadSource,
        mixer,
        modelRoot,
      }
    } catch (cause) {
      if (signal?.aborted) {
        signal.throwIfAborted()
      }
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause
      }
      this.options.onFailure?.({
        kind: 'model-load',
        message: '模型没有成功来到展台。',
        cause,
      })
      throw cause
    }
  }

  commitModel(staged: StagedViewerModel): void {
    if (this.destroyed || staged.disposed) {
      this.disposeStagedModel(staged)
      return
    }

    // A catalog selection replaces the animal, so an encounter must restore
    // the ordinary viewer before the staged group is committed.
    this.endScaleEncounter()

    // A new choice can arrive while the former choice is still fading out.
    // Do not complete that older transition here: doing so fits its hidden
    // incoming model and makes the still-visible outgoing animal jump in size.
    // Instead, retain whichever model is actually visible as the next
    // transition's outgoing model.
    this.cancelTransitionForReplacement()
    const previous = this.current
    this.scene.add(staged.group)
    this.current = staged
    this.renderer.domElement.setAttribute(
      'aria-label',
      staged.descriptor.accessibilityLabel ??
        `${staged.descriptor.label}三维模型，可拖动旋转并缩放`,
    )
    this.renderer.domElement.setAttribute('aria-hidden', 'false')
    this.renderer.domElement.dataset.modelLoadSource = staged.loadSource
    if (previous && staged.loadSource === 'network') {
      this.initialPoseHoldUntil = 0
      staged.group.visible = false
      this.transition = {
        cameraSwitched: false,
        duration: this.reducedMotion ? 80 : 560,
        incoming: staged,
        outgoing: previous,
        startedAt: performance.now(),
      }
      this.setTransitionOpacity(1)
      this.renderer.domElement.dataset.transitioning = 'true'
      this.renderer.domElement.dataset.transitionPhase = 'outgoing'
    } else if (previous) {
      this.initialPoseHoldUntil = 0
      this.applyPresentationSettings(staged)
      this.reset()
      this.disposeStagedModel(previous)
      this.clearTransitionOpacity()
      this.renderer.domElement.dataset.transitioning = 'false'
      this.renderer.domElement.dataset.transitionPhase = 'idle'
      this.updateCameraLighting()
      this.renderer.render(this.scene, this.camera)
    } else {
      this.applyPresentationSettings(staged)
      this.reset()
      this.initialPoseHoldUntil =
        performance.now() + INITIAL_STILL_CROSSFADE_MS
      this.controls.autoRotate = false
      this.renderer.domElement.dataset.autoRotate = 'false'
      this.updateCameraLighting()
      this.renderer.render(this.scene, this.camera)
      this.confirmInitialFrame(staged.animalId)
      this.renderer.domElement.dataset.transitioning = 'false'
      this.renderer.domElement.dataset.transitionPhase = 'idle'
    }
  }

  disposeStagedModel(staged: StagedViewerModel): void {
    if (staged.disposed) {
      return
    }
    if (this.scaleEncounter && this.current === staged) {
      this.endScaleEncounter()
    }
    staged.action?.stop()
    if (staged.mixer) {
      staged.mixer.stopAllAction()
      staged.mixer.uncacheRoot(staged.modelRoot)
    }
    disposeObject3D(staged.group, this.renderer)
    staged.disposed = true
    if (this.current === staged) {
      this.current = null
    }
  }

  setAccessibilityLabel(label: string): void {
    this.renderer.domElement.setAttribute('aria-label', label)
  }

  setScaleEncounterEnvironmentVariant(
    variant: ScaleEncounterEnvironmentVariant,
  ): void {
    this.scaleEncounterEnvironmentVariant = variant
    const encounter = this.scaleEncounter
    if (!encounter || encounter.environment?.variant === variant) {
      return
    }
    encounter.environment?.root.removeFromParent()
    disposeScaleEncounterEnvironment(encounter.environment)
    encounter.environment = createScaleEncounterEnvironment(
      encounter.definition.habitat,
      variant,
      this.scaleEncounterPanoramaTexture,
      {
        animalId: encounter.definition.id,
        ecologyDensity: this.scaleEncounterEcologyDensity,
        forestProps: this.scaleEncounterForestProps,
        matureTreeAtlas: this.scaleEncounterMatureTreeAtlas,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        surfaceTextures: this.scaleEncounterSurfaceTextures,
      },
    )
    if (encounter.environment) {
      this.scene.add(encounter.environment.root)
      syncScaleEncounterGroundContacts(
        encounter.environment,
        this.current?.modelRoot ?? encounter.avatar.root,
        encounter.avatar.root,
      )
      updateScaleEncounterEnvironment(
        encounter.environment,
        performance.now() / 1_000,
        this.reducedMotion,
        this.camera.position,
      )
    }
    this.renderer.domElement.dataset.scaleEncounterEnvironment = variant
    this.renderer.render(this.scene, this.camera)
  }

  setScaleEncounterEcologyDensity(
    density: ScaleEncounterEcologyDensity,
  ): void {
    const changed = this.scaleEncounterEcologyDensity !== density
    this.scaleEncounterEcologyDensity = density
    this.renderer.domElement.dataset.scaleEncounterEcologyDensity = density
    this.scaleEncounterDiagnosticsEnvironment = null
    if (!changed || !this.scaleEncounter) return
    this.setScaleEncounterPanoramaTexture(
      this.scaleEncounterPanoramaTexture,
      this.scaleEncounterSurfaceTextures,
      true,
      this.scaleEncounterMatureTreeAtlas,
    )
  }

  setScaleEncounterPanoramaTexture(
    texture: Texture | null,
    surfaceTextures: ScaleEncounterSurfaceTextures | null = null,
    forceRebuild = false,
    matureTreeAtlas: Texture | null = null,
  ): void {
    if (
      !forceRebuild &&
      this.scaleEncounterPanoramaTexture === texture &&
      this.scaleEncounterSurfaceTextures === surfaceTextures &&
      this.scaleEncounterMatureTreeAtlas === matureTreeAtlas
    ) {
      return
    }
    this.scaleEncounterPanoramaTexture = texture
    this.scaleEncounterSurfaceTextures = surfaceTextures
    this.scaleEncounterMatureTreeAtlas = matureTreeAtlas
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }

    // Build and position the ready replacement before removing the currently
    // visible environment. An asynchronous candidate download can therefore
    // never produce a blank first frame or flash between sky domes.
    const replacement = createScaleEncounterEnvironment(
      encounter.definition.habitat,
      this.scaleEncounterEnvironmentVariant,
      texture,
      {
        animalId: encounter.definition.id,
        ecologyDensity: this.scaleEncounterEcologyDensity,
        forestProps: this.scaleEncounterForestProps,
        matureTreeAtlas,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        surfaceTextures,
      },
    )
    if (replacement) {
      this.scene.add(replacement.root)
      syncScaleEncounterGroundContacts(
        replacement,
        this.current?.modelRoot ?? encounter.avatar.root,
        encounter.avatar.root,
      )
      updateScaleEncounterEnvironment(
        replacement,
        performance.now() / 1_000,
        this.reducedMotion,
        this.camera.position,
      )
    }
    const previous = encounter.environment
    encounter.environment = replacement
    previous?.root.removeFromParent()
    disposeScaleEncounterEnvironment(previous)
    this.renderer.render(this.scene, this.camera)
  }

  setScaleEncounterForestProps(forestProps: Group | null): void {
    if (this.scaleEncounterForestProps === forestProps) return
    this.scaleEncounterForestProps = forestProps
    this.renderer.domElement.dataset.scaleEncounterForestProps = forestProps
      ? forestProps.name.includes('ecology-v2')
        ? 'ecology-v2'
        : 'real-v1'
      : 'procedural'
    const encounter = this.scaleEncounter
    if (!encounter) return
    // Rebuild through the same prepared replacement path used by panorama
    // swaps, so asynchronous prototype props never reveal a blank scene.
    this.setScaleEncounterPanoramaTexture(
      this.scaleEncounterPanoramaTexture,
      this.scaleEncounterSurfaceTextures,
      true,
      this.scaleEncounterMatureTreeAtlas,
    )
  }

  setScaleEncounterAvatarFactory(
    factory: ScaleEncounterAvatarFactory | null,
  ): void {
    if (!factory && this.scaleEncounter) {
      // Clearing the prepared source while an encounter is still visible
      // must not replace its avatar mid-frame. The active instance owns its
      // cloned resources until endScaleEncounter disposes it.
      return
    }
    this.scaleEncounterAvatarFactory =
      factory ?? (() => {
        throw new Error('scale-encounter-avatar-factory-unavailable')
      })
  }

  /**
   * Reuses the already parsed active GLB and its AnimationMixer. No second
   * canvas, fetch or GLTF parse is created for the scale encounter.
   */
  beginScaleEncounter(profile: ScaleEncounterProfile): boolean {
    if (this.destroyed || this.transition) {
      this.setScaleEncounterUnavailable('viewer-not-ready')
      return false
    }

    if (this.scaleEncounter) {
      this.endScaleEncounter()
    }

    const current = this.current
    if (!current) {
      this.setScaleEncounterUnavailable('viewer-not-ready')
      return false
    }
    if (!isScaleEncounterAnimalId(current.animalId)) {
      this.setScaleEncounterUnavailable('unsupported-animal')
      return false
    }

    const definition = SCALE_ENCOUNTER_DEFINITIONS[current.animalId]
    const normalizedProfile = normalizeScaleEncounterProfile(profile)
    const saved = this.captureScaleEncounterViewerState(current)
    let avatar: ScaleEncounterAvatar | null = null
    let environment: ScaleEncounterEnvironment | null = null

    try {
      this.controls.enabled = false
      this.controls.enableDamping = false
      this.controls.enablePan = false
      this.controls.enableRotate = false
      this.controls.enableZoom = false
      this.controls.autoRotate = false
      // Consume any final damping delta before assigning deterministic
      // encounter camera poses.
      this.controls.update()
      this.resumeRotationAt = Number.POSITIVE_INFINITY
      this.initialPoseHoldUntil = 0

      const modelContactShadow = current.group.getObjectByName('contact-shadow')
      if (modelContactShadow) modelContactShadow.visible = false
      current.modelRoot.traverse((object) => {
        if (object instanceof Mesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })

      current.group.position.set(0, 0, 0)
      current.group.rotation.set(0, 0, 0)
      current.group.scale.set(1, 1, 1)
      current.modelRoot.rotation.y = definition.modelYawRadians
      current.group.updateMatrixWorld(true)

      // Measure a deterministic reviewed pose instead of whichever animation
      // frame happened to be visible when the family opened the feature. The
      // model hash is locked by the encounter definition and the content
      // provenance validator; a changed GLB therefore requires a deliberate
      // re-calibration rather than silently changing the apparent scale.
      if (current.mixer && current.action) {
        current.mixer.timeScale = 1
        current.action.enabled = true
        current.action.paused = false
        current.mixer.setTime(definition.referenceAnimationTimeSeconds)
        current.modelRoot.updateMatrixWorld(true)
      }
      const rawBounds = computeModelBounds(current.modelRoot, true)
      const rawSpanUnits = rawBounds.getSize(new Vector3())[
        definition.measurementAxis
      ]
      if (!Number.isFinite(rawSpanUnits) || rawSpanUnits <= 0) {
        throw new RangeError('active-model-has-no-measurable-span')
      }
      const metersPerUnit = definition.displayedMeters / rawSpanUnits
      const rawCentre = rawBounds.getCenter(new Vector3())
      current.group.scale.setScalar(metersPerUnit)
      current.group.position.set(
        definition.animalPosition.x - rawCentre.x * metersPerUnit,
        definition.support === 'ground'
          ? definition.animalPosition.y - rawBounds.min.y * metersPerUnit
          : definition.animalPosition.y - rawCentre.y * metersPerUnit,
        definition.animalPosition.z - rawCentre.z * metersPerUnit,
      )
      this.restoreScaleEncounterAnimationState(current, saved)
      current.group.updateMatrixWorld(true)

      const worldBounds = computeModelBounds(current.modelRoot, true)
      avatar = this.scaleEncounterAvatarFactory(
        normalizedProfile,
        definition.habitat,
        definition.id,
      )
      avatar.root.position.set(0, 0, 0)
      avatar.root.rotation.set(0, 0, 0)
      avatar.root.updateMatrixWorld(true)
      const groundedEyeHeight =
        computeScaleEncounterAvatarGroundedEyeHeight(avatar)
      const placement = createScaleEncounterPlacement(
        definition.id,
        worldBounds.min,
        worldBounds.max,
        groundedEyeHeight,
      )
      avatar.root.rotation.y = placement.avatarYawRadians
      this.placeScaleEncounterAvatarEyeAt(
        avatar,
        placement.defaultEyePosition,
      )
      this.scene.add(avatar.root)
      avatar.root.traverse((object) => {
        if (object instanceof Mesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })

      environment = createScaleEncounterEnvironment(
        definition.habitat,
        this.scaleEncounterEnvironmentVariant,
        this.scaleEncounterPanoramaTexture,
        {
          animalId: definition.id,
          ecologyDensity: this.scaleEncounterEcologyDensity,
          forestProps: this.scaleEncounterForestProps,
          matureTreeAtlas: this.scaleEncounterMatureTreeAtlas,
          maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
          surfaceTextures: this.scaleEncounterSurfaceTextures,
        },
      )
      if (environment) {
        this.scene.add(environment.root)
        syncScaleEncounterGroundContacts(
          environment,
          current.modelRoot,
          avatar.root,
        )
      }

      this.camera.clearViewOffset()
      this.scaleEncounter = {
        avatar,
        definition,
        placement,
        saved,
        rawSpanUnits,
        metersPerUnit,
        profile: normalizedProfile,
        view: 'overview',
        cameraStage: 'overview',
        observerDistance: definition.defaultDistance,
        overviewZoom: 1,
        targetObserverDistance: definition.defaultDistance,
        targetOverviewZoom: 1,
        distanceMotionDirection: 0,
        environment,
        transition: null,
      }
      this.scaleEncounterSunLight.visible = definition.habitat === 'land'
      this.scaleEncounterSkyFillLight.visible = definition.habitat === 'land'
      this.scaleEncounterHemisphereLight.intensity =
        definition.habitat === 'land' ? 2.58 : 0
      // The museum preview hemisphere is intentionally generous so models
      // read against the neutral plinth. Leaving it enabled here adds a
      // second, unrelated sky/ground probe on top of the authored encounter
      // sun and hemisphere, flattening the terrain and lifting tree-card
      // edges. The saved intensity is restored on exit.
      this.ambientHemisphereLight.intensity =
        definition.habitat === 'land' ? 0 : 1.3
      this.sceneAccentLight.intensity = 0
      this.cameraKeyLight.intensity = definition.habitat === 'land' ? 0 : 1.1
      this.cameraFillLight.intensity = definition.habitat === 'land' ? 0 : 0.42
      if (definition.habitat === 'land') {
        this.renderer.toneMappingExposure = 1.3
        // World-space atmosphere lets the 3D woodland lose contrast into the
        // far plate instead of ending as a crisp horizontal cut. Near/hero
        // geometry remains untouched through the 108 m clear distance.
        this.scene.fog = environment?.distanceFogColour
          ? new Fog(environment.distanceFogColour, 62, 220)
          : null
      }
      this.applyScaleEncounterOverviewPose()
      updateScaleEncounterEnvironment(
        environment,
        performance.now() / 1_000,
        this.reducedMotion,
        this.camera.position,
      )
      this.renderer.domElement.dataset.scaleEncounter = 'true'
      this.renderer.domElement.dataset.scaleEncounterAnimalId = definition.id
      this.renderer.domElement.dataset.scaleEncounterCameraStage = 'overview'
      this.renderer.domElement.dataset.scaleEncounterEnvironment =
        this.scaleEncounterEnvironmentVariant
      this.renderer.domElement.dataset.scaleEncounterEcologyDensity =
        this.scaleEncounterEcologyDensity
      this.renderer.domElement.dataset.scaleEncounterView = 'overview'
      this.renderer.domElement.setAttribute(
        'aria-label',
        `${current.descriptor.label}与小朋友的等比例三维相遇；不能旋转，只能沿观察线前后移动`,
      )
      this.publishScaleEncounterSnapshot()
      this.updateCameraLighting()
      this.renderer.render(this.scene, this.camera)
      return true
    } catch (cause) {
      if (avatar) {
        disposeScaleEncounterAvatar(avatar, this.renderer)
      }
      environment?.root.removeFromParent()
      disposeScaleEncounterEnvironment(environment)
      this.scaleEncounter = null
      this.scaleEncounterSunLight.visible = false
      this.scaleEncounterSkyFillLight.visible = false
      this.scaleEncounterHemisphereLight.intensity = 0
      this.restoreScaleEncounterViewerState(current, saved)
      this.setScaleEncounterUnavailable(
        cause instanceof Error ? cause.message : 'scale-encounter-failed',
      )
      return false
    }
  }

  setScaleEncounterProfile(profile: ScaleEncounterProfile): boolean {
    const encounter = this.scaleEncounter
    const current = this.current
    if (!encounter || !current) {
      return false
    }
    this.finishScaleEncounterTransition()

    const normalizedProfile = normalizeScaleEncounterProfile(profile)
    const replacement = this.scaleEncounterAvatarFactory(
      normalizedProfile,
      encounter.definition.habitat,
      encounter.definition.id,
    )
    replacement.root.position.set(0, 0, 0)
    replacement.root.rotation.set(0, 0, 0)
    replacement.root.updateMatrixWorld(true)
    const groundedEyeHeight =
      computeScaleEncounterAvatarGroundedEyeHeight(replacement)
    const worldBounds = computeModelBounds(current.modelRoot, true)
    const placement = createScaleEncounterPlacement(
      encounter.definition.id,
      worldBounds.min,
      worldBounds.max,
      groundedEyeHeight,
    )
    replacement.root.rotation.y = placement.avatarYawRadians
    const observerDistance = clampScaleEncounterDistance(
      encounter.definition.id,
      encounter.observerDistance,
    )
    this.placeScaleEncounterAvatarEyeAt(
      replacement,
      computeScaleEncounterPovEyePosition(
        placement,
        encounter.definition.habitat,
        observerDistance,
      ),
    )
    this.scene.add(replacement.root)
    disposeScaleEncounterAvatar(encounter.avatar, this.renderer)
    encounter.avatar = replacement
    encounter.placement = placement
    encounter.profile = normalizedProfile
    encounter.observerDistance = observerDistance
    encounter.targetObserverDistance = observerDistance
    encounter.distanceMotionDirection = 0
    syncScaleEncounterGroundContacts(
      encounter.environment,
      current.modelRoot,
      replacement.root,
    )

    if (encounter.view === 'pov') {
      this.applyScaleEncounterPovPose()
    } else {
      this.applyScaleEncounterOverviewPose()
    }
    this.publishScaleEncounterSnapshot()
    return true
  }

  transitionScaleEncounterView(
    targetView: ScaleEncounterView,
    durationMs?: number,
  ): Promise<void> {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return Promise.resolve()
    }
    if (encounter.transition?.targetView === targetView) {
      return encounter.transition.promise
    }
    const interruptedOppositeTransition = encounter.transition !== null
    if (encounter.transition) {
      encounter.transition.resolve()
      encounter.transition = null
    }
    if (
      !interruptedOppositeTransition &&
      encounter.view === targetView &&
      encounter.cameraStage === targetView
    ) {
      return Promise.resolve()
    }

    if (targetView === 'overview') {
      encounter.observerDistance = encounter.definition.defaultDistance
      encounter.targetObserverDistance = encounter.definition.defaultDistance
      this.placeScaleEncounterAvatarEyeAt(
        encounter.avatar,
        encounter.placement.defaultEyePosition,
      )
    } else {
      encounter.avatar.root.visible = true
    }
    encounter.distanceMotionDirection = 0
    const duration = this.reducedMotion
      ? 0
      : clampScaleEncounterValue(
          durationMs ??
            (targetView === 'pov'
              ? encounter.definition.guidedTransitionDurationMs
              : 1_250),
          0,
          12_000,
        )
    if (duration === 0) {
      this.completeScaleEncounterView(targetView)
      return Promise.resolve()
    }

    const deferred = createVoidDeferred()
    const keyframes = this.createScaleEncounterTransitionKeyframes(targetView)
    encounter.transition = {
      duration,
      keyframes,
      promise: deferred.promise,
      resolve: deferred.resolve,
      startedAt: performance.now(),
      targetView,
    }
    this.controls.target.copy(encounter.placement.target)
    this.publishScaleEncounterSnapshot()
    return deferred.promise
  }

  finishScaleEncounterTransition(): void {
    const transition = this.scaleEncounter?.transition
    if (!transition) {
      return
    }
    this.completeScaleEncounterView(transition.targetView)
    transition.resolve()
  }

  /** `1` moves closer; `-1` moves farther away. */
  adjustScaleEncounterDistance(direction: -1 | 1): void {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.transition) {
      return
    }
    if (encounter.view === 'overview') {
      encounter.targetOverviewZoom = clampScaleEncounterValue(
        encounter.targetOverviewZoom -
          direction * SCALE_ENCOUNTER_OVERVIEW_ZOOM_STEP,
        SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM,
        SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM,
      )
    } else {
      encounter.targetObserverDistance = clampScaleEncounterDistance(
        encounter.definition.id,
        encounter.targetObserverDistance -
          direction * SCALE_ENCOUNTER_DISTANCE_STEP[encounter.definition.habitat],
      )
    }
    if (this.reducedMotion) {
      encounter.overviewZoom = encounter.targetOverviewZoom
      encounter.observerDistance = encounter.targetObserverDistance
      if (encounter.view === 'overview') {
        this.applyScaleEncounterOverviewPose()
      } else {
        this.applyScaleEncounterPovPose()
      }
      this.publishScaleEncounterSnapshot()
    }
  }

  /** Starts or stops the pointer-held, constant-speed distance dolly. */
  setScaleEncounterDistanceMotion(direction: -1 | 0 | 1): void {
    const encounter = this.scaleEncounter
    if (!encounter || (encounter.transition && direction !== 0)) return
    encounter.distanceMotionDirection = direction
    if (direction !== 0) {
      // A held button owns the camera directly. Cancelling a residual click
      // target prevents an ease from being added on top of the linear dolly.
      encounter.targetOverviewZoom = encounter.overviewZoom
      encounter.targetObserverDistance = encounter.observerDistance
    } else {
      this.publishScaleEncounterSnapshot()
    }
  }

  private updateScaleEncounterDistance(
    deltaSeconds: number,
    now: number,
  ): void {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.transition) return

    const heldDirection = encounter.distanceMotionDirection
    const isOverview = encounter.view === 'overview'
    let changed: boolean
    let settled = false
    if (isOverview) {
      const previous = encounter.overviewZoom
      if (heldDirection !== 0) {
        encounter.overviewZoom = clampScaleEncounterValue(
          previous -
            heldDirection *
              SCALE_ENCOUNTER_OVERVIEW_HOLD_SPEED_PER_SECOND *
              deltaSeconds,
          SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM,
          SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM,
        )
        encounter.targetOverviewZoom = encounter.overviewZoom
      } else {
        const alpha = 1 - Math.exp(
          -SCALE_ENCOUNTER_DISTANCE_EASING_PER_SECOND * deltaSeconds,
        )
        encounter.overviewZoom = MathUtils.lerp(
          previous,
          encounter.targetOverviewZoom,
          alpha,
        )
        if (
          Math.abs(
            encounter.overviewZoom - encounter.targetOverviewZoom,
          ) < 0.0002
        ) {
          encounter.overviewZoom = encounter.targetOverviewZoom
          settled = true
        }
      }
      changed = Math.abs(encounter.overviewZoom - previous) > 1e-7
      if (changed) this.applyScaleEncounterOverviewPose()
    } else {
      const previous = encounter.observerDistance
      if (heldDirection !== 0) {
        encounter.observerDistance = clampScaleEncounterDistance(
          encounter.definition.id,
          previous -
            heldDirection *
              SCALE_ENCOUNTER_DISTANCE_STEP[encounter.definition.habitat] *
              SCALE_ENCOUNTER_DISTANCE_HOLD_STEPS_PER_SECOND *
              deltaSeconds,
        )
        encounter.targetObserverDistance = encounter.observerDistance
      } else {
        const alpha = 1 - Math.exp(
          -SCALE_ENCOUNTER_DISTANCE_EASING_PER_SECOND * deltaSeconds,
        )
        encounter.observerDistance = MathUtils.lerp(
          previous,
          encounter.targetObserverDistance,
          alpha,
        )
        if (
          Math.abs(
            encounter.observerDistance - encounter.targetObserverDistance,
          ) < 0.002
        ) {
          encounter.observerDistance = encounter.targetObserverDistance
          settled = true
        }
      }
      changed = Math.abs(encounter.observerDistance - previous) > 1e-6
      if (changed) this.applyScaleEncounterPovPose()
    }

    if (
      changed &&
      (settled || now - this.scaleEncounterDistanceSnapshotUpdatedAt >= 50)
    ) {
      this.scaleEncounterDistanceSnapshotUpdatedAt = now
      this.publishScaleEncounterSnapshot()
    }
  }

  endScaleEncounter(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    encounter.transition?.resolve()
    encounter.transition = null
    encounter.environment?.root.removeFromParent()
    disposeScaleEncounterEnvironment(encounter.environment)
    disposeScaleEncounterAvatar(encounter.avatar, this.renderer)
    const current = this.current
    this.scaleEncounter = null
    this.scaleEncounterDistanceSnapshotUpdatedAt = Number.NEGATIVE_INFINITY
    this.scaleEncounterSunLight.visible = false
    this.scaleEncounterSkyFillLight.visible = false
    this.scaleEncounterHemisphereLight.intensity = 0
    this.sceneAccentLight.intensity = 0.55
    this.scaleEncounterPanoramaTexture = null
    this.scaleEncounterMatureTreeAtlas = null
    this.scaleEncounterForestProps = null
    this.scaleEncounterSurfaceTextures = null
    if (current) {
      this.restoreScaleEncounterViewerState(current, encounter.saved)
      const currentAspect =
        Math.max(this.container.clientWidth, 1) /
        Math.max(this.container.clientHeight, 1)
      if (Math.abs(this.camera.aspect - currentAspect) > 0.001) {
        this.camera.aspect = currentAspect
        this.fitCurrentModel()
      }
    }
    this.scaleEncounterSnapshot = INACTIVE_SCALE_ENCOUNTER_SNAPSHOT
    delete this.renderer.domElement.dataset.scaleEncounter
    delete this.renderer.domElement.dataset.scaleEncounterCameraStage
    delete this.renderer.domElement.dataset.scaleEncounterEnvironment
    delete this.renderer.domElement.dataset.scaleEncounterEcologyDensity
    delete this.renderer.domElement.dataset.scaleEncounterPerformance
    delete this.renderer.domElement.dataset.scaleEncounterPerformanceReady
    this.scaleEncounterDiagnosticsEnvironment = null
    this.scaleEncounterDiagnosticsUpdatedAt = Number.NEGATIVE_INFINITY
    delete this.renderer.domElement.dataset.scaleEncounterForestProps
    delete this.renderer.domElement.dataset.scaleEncounterAnimalId
    delete this.renderer.domElement.dataset.scaleEncounterAvatarVariant
    delete this.renderer.domElement.dataset.scaleEncounterDistanceMeters
    delete this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters
    delete this.renderer.domElement.dataset.scaleEncounterMetersPerUnit
    delete this.renderer.domElement.dataset.scaleEncounterOverviewZoom
    delete this.renderer.domElement.dataset.scaleEncounterRawSpanUnits
    delete this.renderer.domElement.dataset.scaleEncounterView
    this.emitScaleEncounterSnapshot()
    this.updateCameraLighting()
    this.renderer.render(this.scene, this.camera)
  }

  getScaleEncounterSnapshot(): ScaleEncounterSnapshot {
    return this.scaleEncounterSnapshot
  }

  getScaleEncounterMaximumTextureSize(): number {
    return this.renderer.capabilities.maxTextureSize
  }

  subscribeScaleEncounter(listener: () => void): () => void {
    this.scaleEncounterListeners.add(listener)
    return () => {
      this.scaleEncounterListeners.delete(listener)
    }
  }

  reset(): void {
    if (this.scaleEncounter) {
      return
    }
    if (this.transition && !this.transition.cameraSwitched) {
      return
    }
    const current = this.current
    if (!current) {
      return
    }
    resetStagedModelPose(current)
    this.fitCurrentModel()
    this.resumeRotationAt = this.reducedMotion ? Number.POSITIVE_INFINITY : 0
    this.updateAutoRotation(performance.now())
  }

  /**
   * Freezes the active clip at an exact time for deterministic local-review
   * and end-to-end screenshots. Passing null resumes normal playback.
   * ViewerStage only exposes this hook in Vite's `review`, `model-still`, and
   * `e2e` modes.
   */
  setReviewAnimationTime(timeSeconds: number | null): boolean {
    if (this.scaleEncounter) {
      return false
    }
    if (
      import.meta.env.MODE !== 'review' &&
      import.meta.env.MODE !== 'model-still' &&
      import.meta.env.MODE !== 'e2e'
    ) {
      return false
    }
    const current = this.current
    if (!current) {
      return false
    }
    if (timeSeconds === null) {
      this.reviewAnimationTime = null
      delete this.renderer.domElement.dataset.reviewAnimationTime
      if (current.mixer && current.action) {
        current.mixer.timeScale = 1
        current.action.paused = false
      }
      this.resumeRotationAt = this.reducedMotion
        ? Number.POSITIVE_INFINITY
        : 0
      this.updateAutoRotation(performance.now())
      this.renderer.domElement.dataset.animationPaused = 'false'
      return true
    }
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      return false
    }
    this.reviewAnimationTime = timeSeconds
    this.renderer.domElement.dataset.reviewAnimationTime = String(timeSeconds)
    this.resumeRotationAt = Number.POSITIVE_INFINITY
    this.controls.autoRotate = false
    this.renderer.domElement.dataset.autoRotate = 'false'
    resetStagedModelPose(current)
    this.fitCurrentModel()
    if (current.mixer && current.action) {
      current.mixer.timeScale = 1
      current.action.paused = false
      current.action.reset().play()
      current.mixer.setTime(timeSeconds)
      current.action.paused = true
      current.mixer.timeScale = 0
    }
    current.modelRoot.updateMatrixWorld(true)
    this.renderer.domElement.dataset.animationPaused = 'true'
    return true
  }

  setFocusMode(focused: boolean): void {
    if (this.scaleEncounter) {
      this.resize()
      return
    }
    if (focused) {
      this.reset()
    } else {
      this.fitCurrentModel()
    }
    if (this.compositionFitFrame !== null) {
      window.cancelAnimationFrame(this.compositionFitFrame)
    }
    this.compositionFitFrame = window.requestAnimationFrame(() => {
      this.compositionFitFrame = null
      this.fitCurrentModel()
    })
  }

  resize(): void {
    if (this.destroyed) {
      return
    }
    const width = Math.max(this.container.clientWidth, 1)
    const height = Math.max(this.container.clientHeight, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.scaleEncounter) {
      const transition = this.scaleEncounter.transition
      if (transition) {
        // Mobile browser chrome and orientation changes can trigger resize
        // repeatedly during the guided move. Keep the current camera and the
        // original normalized timeline; only refresh the final pose for the
        // new aspect ratio so narration and choreography do not jump ahead.
        const finalPose = this.computeScaleEncounterCameraPose(
          transition.targetView,
        )
        const finalKeyframe = transition.keyframes.at(-1)
        if (finalKeyframe) {
          this.scaleEncounter.transition = {
            ...transition,
            keyframes: [
              ...transition.keyframes.slice(0, -1),
              {
                at: 1,
                cameraStage: transition.targetView,
                ...finalPose,
              },
            ],
          }
        }
        return
      }
      if (this.scaleEncounter.view === 'pov') {
        this.applyScaleEncounterPovPose()
      } else {
        this.applyScaleEncounterOverviewPose()
      }
      return
    }
    this.fitCurrentModel()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.endScaleEncounter()
    this.destroyed = true
    this.stopLoop()
    if (this.compositionFitFrame !== null) {
      window.cancelAnimationFrame(this.compositionFitFrame)
      this.compositionFitFrame = null
    }
    if (this.firstFrameConfirmationFrame !== null) {
      window.cancelAnimationFrame(this.firstFrameConfirmationFrame)
      this.firstFrameConfirmationFrame = null
    }
    this.resizeObserver.disconnect()
    this.reducedMotionQuery.removeEventListener('change', this.handleReducedMotionChange)
    this.controls.removeEventListener('start', this.handleControlStart)
    this.controls.removeEventListener('end', this.handleControlEnd)
    this.controls.dispose()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost)
    const outgoing = this.transition?.outgoing ?? null
    this.transition = null
    this.clearTransitionOpacity()
    if (outgoing && outgoing !== this.current) {
      this.disposeStagedModel(outgoing)
    }
    if (this.current) {
      this.disposeStagedModel(this.current)
    }
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    this.scaleEncounterListeners.clear()
  }

  private captureScaleEncounterViewerState(
    current: StagedViewerModel,
  ): SavedScaleEncounterViewerState {
    return {
      actionEnabled: current.action?.enabled ?? null,
      actionPaused: current.action?.paused ?? null,
      actionTime: current.action?.time ?? null,
      actionTimeScale: current.action?.timeScale ?? null,
      actionWeight: current.action?.weight ?? null,
      ambientHemisphereIntensity: this.ambientHemisphereLight.intensity,
      camera: this.camera.clone(),
      controlsTarget: this.controls.target.clone(),
      controlsEnabled: this.controls.enabled,
      controlsEnableDamping: this.controls.enableDamping,
      controlsEnablePan: this.controls.enablePan,
      controlsEnableRotate: this.controls.enableRotate,
      controlsEnableZoom: this.controls.enableZoom,
      controlsAutoRotate: this.controls.autoRotate,
      controlsMinDistance: this.controls.minDistance,
      controlsMaxDistance: this.controls.maxDistance,
      controlsZoomSpeed: this.controls.zoomSpeed,
      groupPosition: current.group.position.clone(),
      groupQuaternion: current.group.quaternion.clone(),
      groupScale: current.group.scale.clone(),
      groupVisible: current.group.visible,
      sceneFog: this.scene.fog,
      modelRootPosition: current.modelRoot.position.clone(),
      modelRootQuaternion: current.modelRoot.quaternion.clone(),
      modelRootScale: current.modelRoot.scale.clone(),
      mixerTime: current.mixer?.time ?? null,
      mixerTimeScale: current.mixer?.timeScale ?? null,
      resumeRotationAt: this.resumeRotationAt,
      toneMappingExposure: this.renderer.toneMappingExposure,
      modelContactShadowVisible:
        current.group.getObjectByName('contact-shadow')?.visible ?? null,
      accessibilityLabel: this.renderer.domElement.getAttribute('aria-label'),
    }
  }

  private restoreScaleEncounterViewerState(
    current: StagedViewerModel,
    saved: SavedScaleEncounterViewerState,
  ): void {
    current.modelRoot.position.copy(saved.modelRootPosition)
    current.modelRoot.quaternion.copy(saved.modelRootQuaternion)
    current.modelRoot.scale.copy(saved.modelRootScale)
    current.group.position.copy(saved.groupPosition)
    current.group.quaternion.copy(saved.groupQuaternion)
    current.group.scale.copy(saved.groupScale)
    current.group.visible = saved.groupVisible
    this.restoreScaleEncounterAnimationState(current, saved)
    current.group.updateMatrixWorld(true)

    this.camera.copy(saved.camera)
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(saved.controlsTarget)
    this.controls.enabled = saved.controlsEnabled
    this.controls.enableDamping = saved.controlsEnableDamping
    this.controls.enablePan = saved.controlsEnablePan
    this.controls.enableRotate = saved.controlsEnableRotate
    this.controls.enableZoom = saved.controlsEnableZoom
    this.controls.autoRotate = saved.controlsAutoRotate
    this.controls.minDistance = saved.controlsMinDistance
    this.controls.maxDistance = saved.controlsMaxDistance
    this.controls.zoomSpeed = saved.controlsZoomSpeed
    this.resumeRotationAt = saved.resumeRotationAt
    this.renderer.toneMappingExposure = saved.toneMappingExposure
    this.ambientHemisphereLight.intensity = saved.ambientHemisphereIntensity
    this.scene.fog = saved.sceneFog
    const modelContactShadow = current.group.getObjectByName('contact-shadow')
    if (modelContactShadow && saved.modelContactShadowVisible !== null) {
      modelContactShadow.visible = saved.modelContactShadowVisible
    }
    this.applyPresentationSettings(current)
    this.sceneAccentLight.intensity = 0.55
    if (saved.accessibilityLabel === null) {
      this.renderer.domElement.removeAttribute('aria-label')
    } else {
      this.renderer.domElement.setAttribute(
        'aria-label',
        saved.accessibilityLabel,
      )
    }
    this.controls.update()
  }

  private restoreScaleEncounterAnimationState(
    current: StagedViewerModel,
    saved: SavedScaleEncounterViewerState,
  ): void {
    if (current.mixer && saved.mixerTime !== null) {
      current.mixer.timeScale = 1
      current.mixer.setTime(saved.mixerTime)
      if (saved.mixerTimeScale !== null) {
        current.mixer.timeScale = saved.mixerTimeScale
      }
    }
    if (current.action) {
      if (saved.actionTime !== null) current.action.time = saved.actionTime
      if (saved.actionTimeScale !== null) {
        current.action.timeScale = saved.actionTimeScale
      }
      if (saved.actionWeight !== null) current.action.weight = saved.actionWeight
      if (saved.actionEnabled !== null) {
        current.action.enabled = saved.actionEnabled
      }
      if (saved.actionPaused !== null) current.action.paused = saved.actionPaused
    }
    current.modelRoot.updateMatrixWorld(true)
  }

  private placeScaleEncounterAvatarEyeAt(
    avatar: ScaleEncounterAvatar,
    desiredEyePosition: Readonly<Vector3>,
  ): void {
    avatar.root.position.set(0, 0, 0)
    avatar.root.updateMatrixWorld(true)
    const eyeOffset = avatar.eyeAnchor.getWorldPosition(new Vector3())
    avatar.root.position.copy(desiredEyePosition).sub(eyeOffset)
    avatar.root.updateMatrixWorld(true)
  }

  private createScaleEncounterCameraPose(
    position: Readonly<Vector3>,
    target: Readonly<Vector3>,
    fieldOfView: number,
    up: Readonly<Vector3> = WORLD_UP,
  ): {
    readonly fieldOfView: number
    readonly position: Vector3
    readonly quaternion: Quaternion
  } {
    const helper = this.camera.clone()
    helper.clearViewOffset()
    helper.position.copy(position)
    helper.up.copy(up)
    helper.fov = fieldOfView
    helper.lookAt(target)
    helper.updateProjectionMatrix()
    return {
      fieldOfView,
      position: helper.position.clone(),
      quaternion: helper.quaternion.clone(),
    }
  }

  /**
   * Review-only free-orbit override used by the environment-art quality gate.
   *
   * The family-facing encounter intentionally keeps a guided camera, but a
   * fixed three-shot path cannot prove that the 360-degree terrain, vegetation
   * and far plate hold together away from the authored compositions. E2E and
   * local review builds may therefore request an azimuth through canvas data
   * attributes. Production builds never enter this branch.
   */
  private applyScaleEncounterReviewOrbit(): void {
    if (
      import.meta.env.MODE !== 'review' &&
      import.meta.env.MODE !== 'e2e'
    ) {
      return
    }
    const encounter = this.scaleEncounter
    const current = this.current
    const canvas = this.renderer.domElement
    const rawAzimuth = canvas.dataset.scaleEncounterReviewOrbitAzimuthDegrees
    if (!encounter || !current || encounter.transition || rawAzimuth === undefined) {
      return
    }
    const azimuthDegrees = Number(rawAzimuth)
    if (!Number.isFinite(azimuthDegrees)) return

    const heightMode =
      canvas.dataset.scaleEncounterReviewOrbitHeight === 'child-eye'
        ? 'child-eye'
        : 'overview'
    const animalBounds = computeModelBounds(current.modelRoot, true)
    const animalSphere = animalBounds.getBoundingSphere(new Sphere())
    const target = animalSphere.center.clone()
    const fieldOfView = heightMode === 'child-eye' ? 58 : 46
    // Keep the QA camera inside the encounter clearing. Earlier versions used
    // a fit radius large enough to sit behind the first woodland belt, which
    // tested an unsupported forest-interior shot instead of the family-facing
    // movement envelope and exaggerated any single radial population edge.
    const defaultRadius =
      heightMode === 'child-eye'
        ? 12.5
        : Math.min(
            18,
            Math.max(
              14,
              (animalSphere.radius /
                Math.sin(MathUtils.degToRad(fieldOfView / 2))) *
                0.86,
            ),
          )
    const requestedRadius = Number(
      canvas.dataset.scaleEncounterReviewOrbitRadiusMeters,
    )
    const radius =
      Number.isFinite(requestedRadius) && requestedRadius > 0
        ? requestedRadius
        : defaultRadius
    const azimuth = MathUtils.degToRad(azimuthDegrees)
    const cameraHeight =
      heightMode === 'child-eye'
        ? encounter.placement.defaultEyePosition.y
        : Math.max(target.y + 5.2, animalBounds.max.y * 0.72)
    const position = new Vector3(
      target.x + Math.sin(azimuth) * radius,
      cameraHeight,
      target.z + Math.cos(azimuth) * radius,
    )
    const lookTarget = target.clone()
    lookTarget.y =
      heightMode === 'child-eye'
        ? Math.max(target.y, encounter.placement.target.y * 0.58)
        : target.y
    const pose = this.createScaleEncounterCameraPose(
      position,
      lookTarget,
      fieldOfView,
    )

    encounter.avatar.root.visible = false
    this.camera.clearViewOffset()
    this.camera.position.copy(pose.position)
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.up.copy(WORLD_UP)
    this.camera.fov = pose.fieldOfView
    this.camera.near = 0.03
    this.camera.far = 240
    this.camera.updateProjectionMatrix()
    canvas.dataset.scaleEncounterReviewOrbit = `${heightMode}:${azimuthDegrees.toFixed(0)}`
  }

  private createScaleEncounterTransitionKeyframes(
    targetView: ScaleEncounterView,
  ): readonly ScaleEncounterCameraKeyframe[] {
    const encounter = this.scaleEncounter
    if (!encounter) return []

    const start: ScaleEncounterCameraKeyframe = {
      at: 0,
      cameraStage: encounter.cameraStage,
      fieldOfView: this.camera.fov,
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    }
    const eye = encounter.avatar.eyeAnchor.getWorldPosition(new Vector3())
    const target = encounter.placement.target.clone()
    const childBounds = new Box3().setFromObject(encounter.avatar.root, true)
    const childCentre = childBounds.getCenter(new Vector3())
    const childHeight = Math.max(
      encounter.profile.heightMeters,
      childBounds.max.y - childBounds.min.y,
      0.9,
    )
    const forward = target.clone().sub(eye).normalize()
    const behind = forward.clone().multiplyScalar(-1)
    const horizontalForward = forward.clone().setY(0)
    if (horizontalForward.lengthSq() < 1e-6) horizontalForward.set(1, 0, 0)
    horizontalForward.normalize()
    const childRight = horizontalForward.clone().cross(WORLD_UP).normalize()

    const rearParameters = {
      land: { behind: 2.35, fieldOfView: 58, up: 0.5 },
      air: { behind: 2.4, fieldOfView: 58, up: 1.2 },
      water: { behind: 2, fieldOfView: 56, up: 0.35 },
    } as const
    const rearProfile = rearParameters[encounter.definition.habitat]
    const isTyrannosaurusRear =
      encounter.definition.id === 'tyrannosaurus-rex'
    const isPhonePortrait = this.camera.aspect < 0.75
    // A T. rex needs a true two-subject establishing shot. The generic rear
    // pose was only ~2.4 child heights behind the avatar, so the reviewed GLB
    // head filled a portrait frame and sat directly over the animal. Pulling
    // back and moving off the sight line keeps the child on the lower third
    // while preserving the scale relationship and an unobstructed T. rex.
    const rearBehind = isTyrannosaurusRear
      ? isPhonePortrait
        ? 4.25
        : 3.35
      : rearProfile.behind
    const rearSide = isTyrannosaurusRear
      ? isPhonePortrait
        ? 1.08
        : 0.86
      : 0
    const rearUp = isTyrannosaurusRear
      ? isPhonePortrait
        ? 0.95
        : 0.68
      : rearProfile.up
    const rearFieldOfView =
      isTyrannosaurusRear && isPhonePortrait
        ? 62
        : rearProfile.fieldOfView
    const rearPosition = eye
      .clone()
      .addScaledVector(behind, rearBehind * childHeight)
      .addScaledVector(childRight, rearSide * childHeight)
      .addScaledVector(WORLD_UP, rearUp * childHeight)
    const rearTarget = target.clone()
    if (isTyrannosaurusRear) {
      // Bias the lens slightly below/behind the authored animal target so the
      // child's full silhouette stays above the mobile controls instead of
      // leaving only a giant head at the bottom edge.
      rearTarget.lerp(childCentre, isPhonePortrait ? 0.12 : 0.08)
    }
    const rearPose = this.createScaleEncounterCameraPose(
      rearPosition,
      rearTarget,
      rearFieldOfView,
    )

    if (targetView === 'overview') {
      const overview = this.computeScaleEncounterCameraPose('overview')
      return [
        start,
        {
          at: 0.32,
          cameraStage: 'child-rear',
          ...rearPose,
        },
        {
          at: 1,
          cameraStage: 'overview',
          ...overview,
        },
      ]
    }

    let establishingPosition: Vector3
    let establishingTarget: Vector3
    let establishingFieldOfView: number
    if (encounter.definition.habitat === 'land') {
      establishingPosition = childCentre
        .clone()
        .addScaledVector(
          encounter.definition.overviewDirection,
          Math.max(3 * childHeight, 3),
        )
        .addScaledVector(WORLD_UP, 0.08 * childHeight)
      establishingTarget = childCentre
      establishingFieldOfView = 43
    } else if (encounter.definition.habitat === 'air') {
      establishingPosition = eye
        .clone()
        .addScaledVector(behind, 2.8 * childHeight)
        .addScaledVector(WORLD_UP, 1.55 * childHeight)
      establishingTarget = eye
        .clone()
        .addScaledVector(forward, 1.85 * childHeight)
      establishingFieldOfView = 56
    } else {
      establishingPosition = childCentre
        .clone()
        .addScaledVector(childRight, 3.05 * childHeight)
        .addScaledVector(WORLD_UP, 0.12 * childHeight)
      establishingTarget = childCentre
      establishingFieldOfView = 45
    }
    const establishingPose = this.createScaleEncounterCameraPose(
      establishingPosition,
      establishingTarget,
      establishingFieldOfView,
    )
    const eyeEntryPose = this.createScaleEncounterCameraPose(
      eye
        .clone()
        .addScaledVector(behind, 0.48 * childHeight)
        .addScaledVector(childRight, 0.12 * childHeight)
        .addScaledVector(WORLD_UP, 0.08 * childHeight),
      target,
      encounter.definition.povFieldOfView,
    )
    const povPose = this.computeScaleEncounterCameraPose('pov')
    const timing =
      encounter.definition.habitat === 'land'
        ? [0.1, 0.17, 0.5, 0.6, 0.95]
        : encounter.definition.habitat === 'air'
          ? [0.09, 0.15, 0.49, 0.58, 0.95]
          : [0.09, 0.15, 0.5, 0.58, 0.95]
    return [
      start,
      {
        at: timing[0]!,
        cameraStage: 'side-establishing',
        ...establishingPose,
      },
      {
        at: timing[1]!,
        cameraStage: 'side-establishing',
        ...establishingPose,
      },
      {
        at: timing[2]!,
        cameraStage: 'child-rear',
        ...rearPose,
      },
      {
        at: timing[3]!,
        cameraStage: 'child-rear',
        ...rearPose,
      },
      {
        at: timing[4]!,
        cameraStage: 'eye-entry',
        ...eyeEntryPose,
      },
      {
        at: 1,
        cameraStage: 'pov',
        ...povPose,
      },
    ]
  }

  private computeScaleEncounterCameraPose(view: ScaleEncounterView): {
    readonly fieldOfView: number
    readonly position: Vector3
    readonly quaternion: Quaternion
  } {
    const encounter = this.scaleEncounter
    const current = this.current
    if (!encounter || !current) {
      return {
        fieldOfView: this.camera.fov,
        position: this.camera.position.clone(),
        quaternion: this.camera.quaternion.clone(),
      }
    }

    let fieldOfView: number
    let position: Vector3
    let target: Vector3
    if (view === 'pov') {
      fieldOfView = encounter.definition.povFieldOfView
      position = computeScaleEncounterPovEyePosition(
        encounter.placement,
        encounter.definition.habitat,
        encounter.observerDistance,
      )
      target = encounter.placement.target.clone()
    } else {
      const wasAvatarVisible = encounter.avatar.root.visible
      encounter.avatar.root.visible = true
      current.modelRoot.updateMatrixWorld(true)
      encounter.avatar.root.updateMatrixWorld(true)
      const bounds = computeModelBounds(current.modelRoot, true)
      bounds.union(new Box3().setFromObject(encounter.avatar.root, true))
      encounter.avatar.root.visible = wasAvatarVisible
      const sphere = bounds.getBoundingSphere(new Sphere())
      const baseFieldOfView = encounter.definition.overviewFieldOfView
      fieldOfView = computeScaleEncounterOverviewFieldOfView(
        baseFieldOfView,
        encounter.overviewZoom,
      )
      const narrowOverview = this.camera.aspect <= 1.05
      const fittingFieldOfView =
        encounter.definition.id === 'tyrannosaurus-rex' && narrowOverview
          ? computeScaleEncounterOverviewFieldOfView(
              baseFieldOfView,
              SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM,
            )
          : baseFieldOfView
      const verticalFieldOfView = MathUtils.degToRad(fittingFieldOfView)
      const horizontalFieldOfView =
        2 * Math.atan(Math.tan(verticalFieldOfView / 2) * this.camera.aspect)
      const limitingFieldOfView = Math.max(
        0.2,
        Math.min(verticalFieldOfView, horizontalFieldOfView),
      )
      // Narrow desktop windows are limited by horizontal FOV just like phones.
      // Treating only aspect ratios below 0.75 as portrait let a 1024 x 1365
      // browser crop the child completely. The conservative sphere margin is
      // applied through square PC layouts, while wider desktop compositions
      // retain their tighter authored framing.
      const tyrannosaurusOverviewFactor = narrowOverview ? 1 : 0.8
      const distance =
        (sphere.radius / Math.sin(limitingFieldOfView / 2)) *
        (encounter.definition.id === 'tyrannosaurus-rex'
          ? tyrannosaurusOverviewFactor
          : 1.1)
      target = sphere.center.clone()
      if (encounter.definition.id === 'tyrannosaurus-rex') {
        const portrait = narrowOverview
        target.y += sphere.radius * (portrait ? -0.008 : 0.055)
      }
      position = target
        .clone()
        .addScaledVector(encounter.definition.overviewDirection, distance)
      if (
        encounter.definition.id === 'tyrannosaurus-rex' &&
        narrowOverview
      ) {
        // A portrait frame cannot make a 12 m animal and a 1.15 m child both
        // readable if their world-X separation remains the horizontal screen
        // axis. Orbit the overview around the pair so the comparison runs on a
        // strong diagonal and the authored habitat colonies occupy both sides.
        const offset = position.clone().sub(target)
        const azimuth = Math.atan2(offset.z, offset.x) - 0.58
        const horizontalDistance = Math.hypot(offset.x, offset.z)
        offset.x = Math.cos(azimuth) * horizontalDistance
        offset.z = Math.sin(azimuth) * horizontalDistance
        position.copy(target).add(offset)
        target.y += sphere.radius * 0.006
      }
    }

    return this.createScaleEncounterCameraPose(
      position,
      target,
      fieldOfView,
      view === 'overview' ? encounter.definition.overviewUp : WORLD_UP,
    )
  }

  private applyScaleEncounterOverviewPose(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    const pose = this.computeScaleEncounterCameraPose('overview')
    encounter.avatar.root.visible = true
    this.camera.clearViewOffset()
    this.camera.position.copy(pose.position)
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.up.copy(encounter.definition.overviewUp)
    this.camera.fov = pose.fieldOfView
    this.camera.near = 0.03
    this.camera.far = 240
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(
      new Box3()
        .setFromObject(this.current?.modelRoot ?? encounter.avatar.root, true)
        .union(new Box3().setFromObject(encounter.avatar.root, true))
        .getCenter(new Vector3()),
    )
  }

  private applyScaleEncounterPovPose(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    const eyePosition = computeScaleEncounterPovEyePosition(
      encounter.placement,
      encounter.definition.habitat,
      encounter.observerDistance,
    )
    this.placeScaleEncounterAvatarEyeAt(encounter.avatar, eyePosition)
    const pose = this.computeScaleEncounterCameraPose('pov')
    this.camera.clearViewOffset()
    this.camera.position.copy(pose.position)
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.up.copy(WORLD_UP)
    this.camera.fov = pose.fieldOfView
    this.camera.near = 0.03
    this.camera.far = 240
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(encounter.placement.target)
    encounter.avatar.root.visible = encounter.view !== 'pov'
  }

  private completeScaleEncounterView(targetView: ScaleEncounterView): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    encounter.transition = null
    encounter.view = targetView
    encounter.cameraStage = targetView
    if (targetView === 'pov') {
      this.applyScaleEncounterPovPose()
      encounter.avatar.root.visible = false
    } else {
      this.applyScaleEncounterOverviewPose()
      encounter.avatar.root.visible = true
    }
    this.renderer.domElement.dataset.scaleEncounterCameraStage = targetView
    this.renderer.domElement.dataset.scaleEncounterView = targetView
    this.publishScaleEncounterSnapshot()
    this.updateCameraLighting()
  }

  private updateScaleEncounterTransition(now: number): void {
    const encounter = this.scaleEncounter
    const transition = encounter?.transition
    if (!encounter || !transition) {
      return
    }
    const requestedReviewProgress =
      import.meta.env.MODE === 'review' || import.meta.env.MODE === 'e2e'
        ? Number(
            this.renderer.domElement.dataset
              .scaleEncounterReviewTransitionProgress,
          )
        : Number.NaN
    const linearProgress = Number.isFinite(requestedReviewProgress)
      ? clampScaleEncounterValue(requestedReviewProgress, 0, 1)
      : clampScaleEncounterValue(
          (now - transition.startedAt) / Math.max(transition.duration, 1),
          0,
          1,
        )
    this.renderer.domElement.dataset.scaleEncounterTransitionProgress =
      linearProgress.toFixed(3)
    let toIndex = transition.keyframes.findIndex(
      (keyframe) => keyframe.at >= linearProgress,
    )
    if (toIndex <= 0) toIndex = 1
    if (toIndex < 0) toIndex = transition.keyframes.length - 1
    const from = transition.keyframes[toIndex - 1]
    const to = transition.keyframes[toIndex]
    if (!from || !to) {
      this.finishScaleEncounterTransition()
      return
    }
    const segmentLinearProgress = clampScaleEncounterValue(
      (linearProgress - from.at) / Math.max(to.at - from.at, 0.0001),
      0,
      1,
    )
    const progress = smoothStep(segmentLinearProgress)
    this.camera.position.lerpVectors(
      from.position,
      to.position,
      progress,
    )
    this.camera.quaternion.slerpQuaternions(
      from.quaternion,
      to.quaternion,
      progress,
    )
    this.camera.fov = MathUtils.lerp(
      from.fieldOfView,
      to.fieldOfView,
      progress,
    )
    this.camera.updateProjectionMatrix()

    const cameraStage =
      segmentLinearProgress < 0.36 ? from.cameraStage : to.cameraStage
    if (encounter.cameraStage !== cameraStage) {
      encounter.cameraStage = cameraStage
      this.renderer.domElement.dataset.scaleEncounterCameraStage = cameraStage
      this.publishScaleEncounterSnapshot()
    }

    if (transition.targetView === 'pov') {
      // Remove the third-person avatar as soon as the move becomes an
      // eye-entry shot. Waiting until 91% let the camera travel through the
      // reviewed avatar's head for most of the final approach, which was most
      // obvious in the narrow mobile composition.
      encounter.avatar.root.visible =
        cameraStage !== 'eye-entry' && cameraStage !== 'pov'
    } else if (
      transition.targetView === 'overview' &&
      linearProgress >= 0.14
    ) {
      encounter.avatar.root.visible = true
    }
    if (linearProgress >= 1) {
      delete this.renderer.domElement.dataset
        .scaleEncounterReviewTransitionProgress
      this.finishScaleEncounterTransition()
    }
  }

  private publishScaleEncounterSnapshot(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    this.scaleEncounterSnapshot = {
      active: true,
      animalId: encounter.definition.id,
      cameraStage: encounter.cameraStage,
      view: encounter.view,
      transitioning: encounter.transition !== null,
      distanceMeters: encounter.observerDistance,
      overviewZoom: encounter.overviewZoom,
      error: null,
      profile: encounter.profile,
      rawSpanUnits: encounter.rawSpanUnits,
      metersPerUnit: encounter.metersPerUnit,
    }
    this.renderer.domElement.dataset.scaleEncounterDistanceMeters =
      encounter.observerDistance.toFixed(3)
    this.renderer.domElement.dataset.scaleEncounterAvatarVariant =
      encounter.avatar.root.name
    if (encounter.view === 'pov' && encounter.cameraStage === 'pov') {
      this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters =
        this.camera.position.y.toFixed(6)
    } else {
      delete this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters
    }
    this.renderer.domElement.dataset.scaleEncounterMetersPerUnit =
      encounter.metersPerUnit.toPrecision(8)
    this.renderer.domElement.dataset.scaleEncounterOverviewZoom =
      encounter.overviewZoom.toFixed(3)
    this.renderer.domElement.dataset.scaleEncounterRawSpanUnits =
      encounter.rawSpanUnits.toPrecision(8)
    delete this.renderer.domElement.dataset.scaleEncounterError
    this.emitScaleEncounterSnapshot()
  }

  private setScaleEncounterUnavailable(error: string): void {
    // Keep the exact renderer-side failure available to the hardware visual
    // gate. The customer-facing fallback remains deliberately generic, while
    // automated review can distinguish an asset/load failure from geometry,
    // shader or batching regressions without exposing a stack trace in UI.
    this.renderer.domElement.dataset.scaleEncounterError = error
    this.scaleEncounterSnapshot = {
      ...INACTIVE_SCALE_ENCOUNTER_SNAPSHOT,
      error,
    }
    this.emitScaleEncounterSnapshot()
  }

  private emitScaleEncounterSnapshot(): void {
    this.scaleEncounterListeners.forEach((listener) => {
      listener()
    })
  }

  private fitCurrentModel(): void {
    if (this.scaleEncounter) {
      return
    }
    // The outgoing camera pose is intentionally frozen until the transition
    // veil covers it. React layout updates and ResizeObserver notifications can
    // otherwise refit the outgoing animal against incoming content and cause a
    // momentary zoom immediately before it disappears.
    if (this.transition && !this.transition.cameraSwitched) {
      return
    }
    const current = this.current
    if (!current) {
      return
    }
    const previousAutoRotate = this.controls.autoRotate
    const previousDamping = this.controls.enableDamping
    this.controls.autoRotate = false
    this.controls.enableDamping = false
    // Apply and clear any pending drag/damping delta before assigning the
    // deterministic fitted pose.
    this.controls.update()
    const containerWidth = Math.max(this.container.clientWidth, 1)
    const containerHeight = Math.max(this.container.clientHeight, 1)
    const containerBounds = this.container.getBoundingClientRect()
    const frameBounds = this.options.compositionFrame?.getBoundingClientRect()
    const compositionLeft = frameBounds
      ? MathUtils.clamp(
          frameBounds.left - containerBounds.left,
          0,
          containerWidth - 1,
        )
      : 0
    const compositionTop = frameBounds
      ? MathUtils.clamp(
          frameBounds.top - containerBounds.top,
          0,
          containerHeight - 1,
        )
      : 0
    const compositionRight = frameBounds
      ? MathUtils.clamp(
          frameBounds.right - containerBounds.left,
          compositionLeft + 1,
          containerWidth,
        )
      : containerWidth
    const compositionBottom = frameBounds
      ? MathUtils.clamp(
          frameBounds.bottom - containerBounds.top,
          compositionTop + 1,
          containerHeight,
        )
      : containerHeight
    const compositionWidth = compositionRight - compositionLeft
    const compositionHeight = compositionBottom - compositionTop
    this.renderer.domElement.dataset.compositionLeft = String(
      Math.round(compositionLeft),
    )
    this.renderer.domElement.dataset.compositionTop = String(
      Math.round(compositionTop),
    )
    this.renderer.domElement.dataset.compositionWidth = String(
      Math.round(compositionWidth),
    )
    this.renderer.domElement.dataset.compositionHeight = String(
      Math.round(compositionHeight),
    )
    const isPortrait = compositionHeight > compositionWidth
    const configuredPadding = isPortrait
      ? current.descriptor.presentation.safeAreaPadding.portrait
      : current.descriptor.presentation.safeAreaPadding.landscape
    const configuredHorizontalOffset = isPortrait
      ? (current.descriptor.presentation.horizontalOffset?.portrait ?? 0)
      : (current.descriptor.presentation.horizontalOffset?.landscape ?? 0)
    const configuredVerticalOffset = isPortrait
      ? (current.descriptor.presentation.verticalOffset?.portrait ?? 0)
      : (current.descriptor.presentation.verticalOffset?.landscape ?? 0)
    const modelScale = modelScaleForViewport(
      containerWidth,
      containerHeight,
    )
    const zoomProfile = viewerZoomProfileForPointer(
      this.coarsePointerQuery.matches,
    )
    const compositionFieldOfView = computeCompositionFieldOfView(
      this.camera.fov,
      containerHeight,
      compositionHeight,
    )
    const fit = computeCameraFit({
      aspect: compositionWidth / compositionHeight,
      bounds: current.bounds,
      fieldOfViewDegrees: compositionFieldOfView,
      modelScale,
      paddingFraction: configuredPadding,
    })
    this.camera.near = fit.near
    this.camera.far = fit.far
    this.camera.position.copy(fit.position)
    const viewOffset = computeCompositionViewOffset({
      compositionHeight,
      compositionLeft,
      compositionTop,
      compositionWidth,
      horizontalOffsetFraction: configuredHorizontalOffset,
      verticalOffsetFraction: configuredVerticalOffset,
      viewportHeight: containerHeight,
      viewportWidth: containerWidth,
    })
    this.renderer.domElement.dataset.compositionHorizontalOffset =
      String(configuredHorizontalOffset)
    this.renderer.domElement.dataset.compositionVerticalOffset =
      String(configuredVerticalOffset)
    this.renderer.domElement.dataset.modelScale = String(modelScale)
    this.renderer.domElement.dataset.minDistanceFactor = String(
      zoomProfile.minDistanceFactor,
    )
    this.renderer.domElement.dataset.zoomSpeed = String(zoomProfile.zoomSpeed)
    this.renderer.domElement.dataset.previewPresentationSignature =
      createModelPreviewPresentationSignature(current.descriptor)
    this.camera.setViewOffset(
      containerWidth,
      containerHeight,
      viewOffset.x,
      viewOffset.y,
      containerWidth,
      containerHeight,
    )
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(fit.target)
    this.controls.zoomSpeed = zoomProfile.zoomSpeed
    this.controls.minDistance = fit.distance * zoomProfile.minDistanceFactor
    this.controls.maxDistance = fit.distance * 2.25
    this.controls.update()
    this.controls.enableDamping = previousDamping
    this.controls.autoRotate = previousAutoRotate
  }

  private confirmInitialFrame(animalId: string): void {
    if (this.firstFrameConfirmationFrame !== null) {
      window.cancelAnimationFrame(this.firstFrameConfirmationFrame)
    }
    this.firstFrameConfirmationFrame = window.requestAnimationFrame(() => {
      this.firstFrameConfirmationFrame = window.requestAnimationFrame(() => {
        this.firstFrameConfirmationFrame = null
        if (!this.destroyed && this.current?.animalId === animalId) {
          this.renderer.domElement.dataset.firstFrameRendered = 'true'
          this.options.onModelReady?.(animalId)
        }
      })
    })
  }

  private applyPresentationSettings(staged: StagedViewerModel): void {
    if (import.meta.env.MODE === 'review') {
      this.renderer.domElement.dataset.activeAnimalId = staged.animalId
      this.renderer.domElement.dataset.initialYawDegrees = String(
        staged.descriptor.presentation.initialYawDegrees,
      )
    }
    const cameraLightScale =
      staged.descriptor.presentation.cameraLightScale ?? 1
    this.cameraKeyLight.intensity =
      CAMERA_KEY_INTENSITY * cameraLightScale
    this.cameraFillLight.intensity =
      CAMERA_FILL_INTENSITY * cameraLightScale
    this.renderer.toneMappingExposure =
      staged.descriptor.presentation.toneMappingExposure ??
      DEFAULT_TONE_MAPPING_EXPOSURE
  }

  private updateAutoRotation(now: number): void {
    this.controls.autoRotate =
      this.scaleEncounter === null &&
      !this.reducedMotion &&
      now >= this.resumeRotationAt
    this.renderer.domElement.dataset.autoRotate = String(this.controls.autoRotate)
  }

  private updateCameraLighting(): void {
    updateCameraRelativeLightingPose(
      this.cameraLightingPose,
      this.camera.position,
      this.controls.target,
    )
    this.cameraLightTarget.position.copy(
      this.cameraLightingPose.targetPosition,
    )
    this.cameraKeyLight.position.copy(this.cameraLightingPose.keyPosition)
    this.cameraFillLight.position.copy(this.cameraLightingPose.fillPosition)
  }

  private finishTransition(): void {
    const transition = this.transition
    if (!transition) {
      this.renderer.domElement.dataset.transitioning = 'false'
      this.renderer.domElement.dataset.transitionPhase = 'idle'
      return
    }
    this.switchTransitionCamera(transition)
    this.transition = null
    this.disposeStagedModel(transition.outgoing)
    this.clearTransitionOpacity()
    this.renderer.domElement.dataset.transitioning = 'false'
    this.renderer.domElement.dataset.transitionPhase = 'idle'
  }

  private cancelTransitionForReplacement(): void {
    const transition = this.transition
    if (!transition) {
      return
    }

    this.transition = null
    if (transition.cameraSwitched) {
      // The incoming model is already the only visible one and remains the
      // current presentation. The old outgoing scene can disappear directly.
      this.disposeStagedModel(transition.outgoing)
    } else {
      // The old outgoing model is still visible. Keep it and its current
      // camera fit; discard the invisible incoming staging scene.
      this.disposeStagedModel(transition.incoming)
      transition.outgoing.group.visible = true
      this.current = transition.outgoing
    }
    this.clearTransitionOpacity()
    this.renderer.domElement.dataset.transitioning = 'false'
    this.renderer.domElement.dataset.transitionPhase = 'idle'
  }

  private switchTransitionCamera(transition: ModelTransition): void {
    if (transition.cameraSwitched) {
      return
    }
    transition.outgoing.group.visible = false
    transition.incoming.group.visible = true
    transition.cameraSwitched = true
    this.applyPresentationSettings(transition.incoming)
    this.reset()
    this.renderer.domElement.dataset.transitionPhase = 'incoming'
  }

  private updateTransition(now: number): void {
    const transition = this.transition
    if (!transition) {
      return
    }
    const linearProgress = Math.min(
      Math.max((now - transition.startedAt) / transition.duration, 0),
      1,
    )
    const frame = computeModelTransitionFrame(linearProgress)
    if (frame.phase === 'incoming') {
      this.switchTransitionCamera(transition)
    }
    this.setTransitionOpacity(frame.modelOpacity)
    if (linearProgress >= 1) {
      this.finishTransition()
    }
  }

  private setTransitionOpacity(opacity: number): void {
    this.container.style.setProperty(
      '--model-transition-opacity',
      String(Math.min(Math.max(opacity, 0), 1)),
    )
  }

  private clearTransitionOpacity(): void {
    this.container.style.removeProperty('--model-transition-opacity')
  }

  private startLoop(): void {
    this.renderer.setAnimationLoop((time) => {
      const deltaSeconds = Math.min(Math.max((time - this.lastFrameTime) / 1_000, 0), 0.1)
      this.lastFrameTime = time
      if (
        import.meta.env.MODE === 'review' ||
        import.meta.env.MODE === 'e2e'
      ) {
        const requestedReviewTime = Number(
          this.renderer.domElement.dataset.reviewAnimationTime,
        )
        this.reviewAnimationTime = Number.isFinite(requestedReviewTime)
          ? requestedReviewTime
          : null
      }
      const holdingInitialPose = time < this.initialPoseHoldUntil
      if (holdingInitialPose) {
        this.controls.autoRotate = false
        this.renderer.domElement.dataset.autoRotate = 'false'
      } else {
        this.updateAutoRotation(time)
      }
      if (this.current?.mixer && this.current.action) {
        if (this.reviewAnimationTime === null) {
          if (!holdingInitialPose) {
            this.current.mixer.update(deltaSeconds)
          }
        } else {
          this.current.mixer.timeScale = 1
          this.current.action.paused = false
          this.current.mixer.setTime(this.reviewAnimationTime)
          this.current.action.paused = true
          this.current.mixer.timeScale = 0
        }
      }
      this.transition?.outgoing.mixer?.update(deltaSeconds)
      if (this.scaleEncounter) {
        updateScaleEncounterAvatarIdle(
          this.scaleEncounter.avatar,
          time / 1_000,
          this.reducedMotion,
        )
        this.updateScaleEncounterTransition(time)
        this.updateScaleEncounterDistance(deltaSeconds, time)
        this.applyScaleEncounterReviewOrbit()
        updateScaleEncounterEnvironment(
          this.scaleEncounter.environment,
          time / 1_000,
          this.reducedMotion,
          this.camera.position,
        )
      }
      if (import.meta.env.MODE === 'review') {
        const action = this.current?.action
        this.renderer.domElement.dataset.animationTime = action
          ? action.time.toFixed(4)
          : ''
        this.renderer.domElement.dataset.animationPaused = String(
          (action?.paused ?? false) || this.current?.mixer?.timeScale === 0,
        )
        this.renderer.domElement.dataset.animationTimeScale = action
          ? (
              action.getEffectiveTimeScale() *
              (this.current?.mixer?.timeScale ?? 1)
            ).toFixed(4)
          : ''
        let maximumMorphWeight = 0
        const morphTargetWeights: string[] = []
        this.current?.modelRoot.traverse((object) => {
          const influences = (
            object as typeof object & {
              readonly morphTargetInfluences?: readonly number[]
            }
          ).morphTargetInfluences
          if (influences) {
            maximumMorphWeight = Math.max(
              maximumMorphWeight,
              ...influences.map((weight) => Math.abs(weight)),
            )
            morphTargetWeights.push(
              `${object.name}:${influences
                .map((weight) => weight.toFixed(4))
                .join(',')}`,
            )
          }
        })
        this.renderer.domElement.dataset.maximumMorphWeight =
          maximumMorphWeight.toFixed(4)
        this.renderer.domElement.dataset.morphTargetWeights =
          morphTargetWeights.join(';')
      }
      this.updateTransition(time)
      if (!this.scaleEncounter) {
        this.controls.update()
      }
      this.updateCameraLighting()
      this.renderer.render(this.scene, this.camera)
      this.publishScaleEncounterPerformanceDiagnostics(time)
    })
  }

  private publishScaleEncounterPerformanceDiagnostics(now: number): void {
    const environment = this.scaleEncounter?.environment ?? null
    if (!environment) return
    if (
      this.scaleEncounterDiagnosticsEnvironment === environment &&
      now - this.scaleEncounterDiagnosticsUpdatedAt < 2_000
    ) {
      return
    }
    this.scaleEncounterDiagnosticsEnvironment = environment
    this.scaleEncounterDiagnosticsUpdatedAt = now
    const sceneResources = inspectScaleEncounterSceneResources(this.scene)
    const environmentResources = inspectScaleEncounterSceneResources(
      environment.root,
    )
    const rendererInfo = this.renderer.info
    const environmentUserData = environment.root.userData as unknown as Record<
      string,
      unknown
    >
    const grounding = {
      airborneInstanceCount: 0,
      maximumAbsoluteGroundingError: 0,
      sampleCount: 0,
    }
    environment.root.traverse((object) => {
      const userData = object.userData as Record<string, unknown>
      const summary = userData.scaleEncounterEcologyGrounding
      if (summary && typeof summary === 'object') {
        const values = summary as Record<string, unknown>
        const instanceCount = Number(values.instanceCount)
        const airborneCount = Number(values.airborneInstanceCount)
        const maximumError = Number(values.maximumAbsoluteGroundingError)
        if (Number.isFinite(instanceCount)) grounding.sampleCount += instanceCount
        if (Number.isFinite(airborneCount)) {
          grounding.airborneInstanceCount += airborneCount
        }
        if (Number.isFinite(maximumError)) {
          grounding.maximumAbsoluteGroundingError = Math.max(
            grounding.maximumAbsoluteGroundingError,
            Math.abs(maximumError),
          )
        }
        return
      }
      const samples = [
        userData.scaleEncounterProductionMidgroundPlacements,
        userData.scaleEncounterFarTreePlacements,
        userData.scaleEncounterGroundingSamples,
      ].find(Array.isArray)
      if (!Array.isArray(samples)) return
      for (const sample of samples) {
        if (!sample || typeof sample !== 'object') continue
        const values = sample as Record<string, unknown>
        const terrainY = Number(values.terrainY)
        const worldBottomY = Number(values.worldBottomY)
        const burialDepth = Number(values.burialDepth ?? 0)
        const reportedError = Number(values.groundingError)
        const groundingError = Number.isFinite(reportedError)
          ? reportedError
          : worldBottomY - (terrainY - burialDepth)
        if (
          !Number.isFinite(terrainY) ||
          !Number.isFinite(worldBottomY) ||
          !Number.isFinite(groundingError)
        ) {
          continue
        }
        grounding.sampleCount += 1
        grounding.maximumAbsoluteGroundingError = Math.max(
          grounding.maximumAbsoluteGroundingError,
          Math.abs(groundingError),
        )
        if (worldBottomY > terrainY + 0.002) {
          grounding.airborneInstanceCount += 1
        }
      }
    })
    const animalBounds = this.current
      ? new Box3().setFromObject(this.current.modelRoot, true)
      : null
    const childBounds = this.scaleEncounter
      ? new Box3().setFromObject(this.scaleEncounter.avatar.root, true)
      : null
    const environmentArt = [
      'scale-encounter-production-mature-tree-colonies',
      'scale-encounter-production-far-tree-colonies',
    ].map((name) => {
      const object = environment.root.getObjectByName(name)
      if (!object) return { name, present: false }
      const bounds =
        object instanceof BatchedMesh && object.boundingBox
          ? object.boundingBox.clone().applyMatrix4(object.matrixWorld)
          : new Box3().setFromObject(object, true)
      const centre = bounds.getCenter(new Vector3())
      const projectedCentre = centre.clone().project(this.camera)
      const renderable =
        object instanceof Mesh
          ? (object as Mesh<BufferGeometry, Material | Material[]>)
          : null
      const renderableMaterial = renderable?.material ?? null
      const material = Array.isArray(renderableMaterial)
        ? (renderableMaterial[0] ?? null)
        : renderableMaterial
      const texture =
        material && 'map' in material && material.map instanceof Texture
          ? material.map
          : null
      const textureRecord = texture as unknown as
        | { readonly image?: unknown }
        | null
      const rawTextureImage = textureRecord?.image
      const textureImage =
        rawTextureImage && typeof rawTextureImage === 'object'
          ? (rawTextureImage as Record<string, unknown>)
          : null
      const objectUserData = object.userData as unknown as Record<
        string,
        unknown
      >
      const placementCandidate =
        objectUserData.scaleEncounterProductionMidgroundPlacements ??
        objectUserData.scaleEncounterFarTreePlacements
      return {
        bounds: {
          maximum: bounds.max.toArray(),
          minimum: bounds.min.toArray(),
        },
        frustumCulled: object.frustumCulled,
        map: texture
          ? {
              height:
                typeof textureImage?.height === 'number'
                  ? textureImage.height
                  : null,
              name: texture.name,
              width:
                typeof textureImage?.width === 'number'
                  ? textureImage.width
                  : null,
            }
          : null,
        name,
        instanceCount:
          object instanceof BatchedMesh ? object.instanceCount : null,
        placementCount: Array.isArray(placementCandidate)
          ? placementCandidate.length
          : null,
        present: true,
        projectedCentre: projectedCentre.toArray(),
        visible: object.visible,
        visibleInstanceCount:
          objectUserData.scaleEncounterProductionMidgroundVisibleMatureTrees ??
          objectUserData.scaleEncounterFarTreeVisibleCount ??
          null,
      }
    })
    this.renderer.domElement.dataset.scaleEncounterPerformance = JSON.stringify({
      density: this.scaleEncounterEcologyDensity,
      ecology: environmentUserData.scaleEncounterEcologyPopulation ?? null,
      environment: environmentResources,
      environmentArt,
      grounding: {
        ...grounding,
        maximumAbsoluteGroundingError: Number(
          grounding.maximumAbsoluteGroundingError.toFixed(6),
        ),
        subjects: {
          animalBottomY:
            animalBounds && !animalBounds.isEmpty()
              ? Number(animalBounds.min.y.toFixed(6))
              : null,
          childBottomY:
            childBounds && !childBounds.isEmpty()
              ? Number(childBounds.min.y.toFixed(6))
              : null,
        },
      },
      renderer: {
        calls: rendererInfo.render.calls,
        geometries: rendererInfo.memory.geometries,
        lines: rendererInfo.render.lines,
        points: rendererInfo.render.points,
        programs: rendererInfo.programs?.length ?? 0,
        textures: rendererInfo.memory.textures,
        triangles: rendererInfo.render.triangles,
      },
      scene: sceneResources,
    })
    this.renderer.domElement.dataset.scaleEncounterPerformanceReady = 'true'
  }

  private stopLoop(): void {
    this.renderer.setAnimationLoop(null)
  }
}
