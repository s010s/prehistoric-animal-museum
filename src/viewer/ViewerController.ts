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
  PCFShadowMap,
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
  SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND,
  SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND,
  clampScaleEncounterValue,
  computeScaleEncounterAvatarGroundedEyeHeight,
  computeScaleEncounterAvatarTravelQuaternion,
  createScaleEncounterPlacement,
  disposeScaleEncounterAvatar,
  isScaleEncounterAnimalId,
  normalizeScaleEncounterProfile,
  positionOnScaleEncounterRail,
  resolveScaleEncounterLandInputIntent,
  scaleEncounterAvatarMotionFor,
  scaleEncounterSubjectLayoutForAspect,
  updateScaleEncounterAvatarIdle,
  type NormalizedScaleEncounterProfile,
  type ScaleEncounterAvatar,
  type ScaleEncounterAvatarFactory,
  type ScaleEncounterCameraStage,
  type ScaleEncounterDefinition,
  type ScaleEncounterJumpEntryMotion,
  type ScaleEncounterPlacement,
  type ScaleEncounterPerspective,
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
import type { RiverVisitor } from './scale-encounter-water-interaction'
import type { ScaleEncounterEcologyDensity } from './scale-encounter-ecology-density'
import { inspectScaleEncounterSceneResources } from './scale-encounter-performance'
import type { ScaleEncounterSceneCandidateVariant } from '../scale-encounter/environments/scene-candidate'
import type { ScaleEncounterPreparedLandBiome } from '../scale-encounter/environments/land-biomes/types'
import { computeMammothOverviewFittingFieldOfView } from '../scale-encounter/environments/glacier'
import {
  MAMMOTH_SUBJECT_GRADE_REVISION,
  applyMammothSubjectGrade,
  type MammothSubjectGradeLease,
} from '../scale-encounter/environments/glacier/mammoth-subject-grade'
import {
  SKY_PROTOTYPE_FLIGHT_APPROXIMATION_LIMITATION,
  createSkyPrototypeFlightAvatar,
} from '../scale-encounter/environments/sky'
import {
  OCEAN_SUBJECT_GRADE_REVISION,
  applyOceanSubjectGrade,
  type OceanSubjectGradeLease,
} from '../scale-encounter/environments/ocean/ocean-subject-grade'
import {
  createScaleEncounterBoostFlowEffect,
  type ScaleEncounterBoostFlowEffect,
} from './scale-encounter-boost-flow'

export type { ViewerModelDescriptor } from './viewer-model-descriptor'
export type { ScaleEncounterEnvironmentVariant } from './scale-encounter-environment'
export type {
  ScaleEncounterProfile,
  ScaleEncounterPerspective,
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
  readonly sceneEnvironment: Scene['environment']
  readonly sceneEnvironmentIntensity: number
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
  readonly focusTarget?: Vector3
  readonly position: Vector3
  readonly quaternion: Quaternion
}

interface ScaleEncounterCameraTransition {
  readonly duration: number
  readonly keyframes: readonly ScaleEncounterCameraKeyframe[]
  readonly orbitReturn?: {
    readonly endAt: number
    readonly holdEndAt: number
    readonly startAngleRadians: number
    readonly startDistance: number
  }
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly startedAt: number
  readonly targetView: ScaleEncounterView
  readonly targetPerspective?: ScaleEncounterPerspective
}

interface ScaleEncounterRuntime {
  actionBoostActive: boolean
  actionBoostMultiplier: number
  avatar: ScaleEncounterAvatar
  avatarBaseYawRadians: number
  avatarPreviousEyePosition: Vector3
  readonly definition: ScaleEncounterDefinition
  placement: ScaleEncounterPlacement
  readonly saved: SavedScaleEncounterViewerState
  readonly rawSpanUnits: number
  readonly metersPerUnit: number
  profile: NormalizedScaleEncounterProfile
  perspective: ScaleEncounterPerspective
  view: ScaleEncounterView
  cameraStage: ScaleEncounterCameraStage
  observerDistance: number
  orbitAngleRadians: number
  overviewZoom: number
  targetObserverDistance: number
  targetOrbitAngleRadians: number
  targetOverviewZoom: number
  distanceMotionDirection: -1 | 0 | 1
  orbitMotionDirection: -1 | 0 | 1
  boostFlow: ScaleEncounterBoostFlowEffect | null
  environment: ScaleEncounterEnvironment | null
  jumpActive: boolean
  jumpEntryMotion: ScaleEncounterJumpEntryMotion
  jumpOffsetMeters: number
  jumpPhase: 'grounded' | 'anticipation' | 'airborne' | 'landing'
  jumpPhaseElapsedSeconds: number
  jumpVelocityMetersPerSecond: number
  landMotionIntent: 'idle' | 'walk' | 'run'
  mammothAnimalGrade: MammothSubjectGradeLease | null
  oceanAnimalGrade: OceanSubjectGradeLease | null
  oceanAvatarGrade: OceanSubjectGradeLease | null
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
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_MINIMUM = 0.58
const SCALE_ENCOUNTER_OVERVIEW_SAFE_FIT_ZOOM = 0.82
const SCALE_ENCOUNTER_OVERVIEW_DEFAULT_ZOOM = 0.82
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM = 1.18
const SCALE_ENCOUNTER_OVERVIEW_ZOOM_STEP = 0.08
const SCALE_ENCOUNTER_OVERVIEW_HOLD_SPEED_PER_SECOND = 0.15
const SCALE_ENCOUNTER_ORBIT_STEP_RADIANS = MathUtils.degToRad(30)
// Dividing the scene-appropriate travel speed by the current horizontal radius
// avoids the former 42°/s rule accelerating from roughly 4 m/s near a small
// animal to almost 20 m/s in the ocean scene.
function scaleEncounterOrbitTravelSpeedMetersPerSecond(
  definition: ScaleEncounterDefinition,
): number {
  if (definition.habitat === 'air') return 4
  if (definition.habitat === 'water') return 1.2
  return SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND
}
const SCALE_ENCOUNTER_ORBIT_EASING_PER_SECOND = 10
const SCALE_ENCOUNTER_AIR_BOOST_MULTIPLIER = 1.6
const SCALE_ENCOUNTER_WATER_BOOST_MULTIPLIER = 1.4
const SCALE_ENCOUNTER_BOOST_EASING_PER_SECOND = 8
interface ScaleEncounterJumpMotionPolicy {
  readonly airborneSeconds: number
  readonly anticipationSeconds: number
  readonly heightRatio: number
  readonly landingRecoverySeconds: number
  readonly maximumHeightMeters: number
  readonly minimumHeightMeters: number
}

const SCALE_ENCOUNTER_JUMP_MOTION_POLICY: Readonly<
  Record<ScaleEncounterJumpEntryMotion, ScaleEncounterJumpMotionPolicy>
> = {
  idle: {
    airborneSeconds: 27 / 60,
    anticipationSeconds: 12 / 60,
    heightRatio: 0.13,
    landingRecoverySeconds: 15 / 60,
    maximumHeightMeters: 0.18,
    minimumHeightMeters: 0.12,
  },
  walk: {
    airborneSeconds: 26 / 60,
    anticipationSeconds: 8 / 60,
    heightRatio: 0.115,
    landingRecoverySeconds: 12 / 60,
    maximumHeightMeters: 0.17,
    minimumHeightMeters: 0.11,
  },
  run: {
    airborneSeconds: 26 / 60,
    anticipationSeconds: 6 / 60,
    heightRatio: 0.105,
    landingRecoverySeconds: 10 / 60,
    maximumHeightMeters: 0.16,
    minimumHeightMeters: 0.1,
  },
}
const SCALE_ENCOUNTER_AVATAR_MOVING_HEADING_EASING_PER_SECOND = 18
const SCALE_ENCOUNTER_AVATAR_IDLE_HEADING_EASING_PER_SECOND = 8
const SCALE_ENCOUNTER_ORBIT_RETURN_SPEED_RADIANS_PER_SECOND =
  MathUtils.degToRad(120)
const SCALE_ENCOUNTER_ORBIT_RETURN_HOLD_MS = 240
const SCALE_ENCOUNTER_RETURN_OVERVIEW_DURATION_MS = 1_250

function scaleEncounterFinalCameraStage(
  definition: ScaleEncounterDefinition,
  view: ScaleEncounterView,
  perspective: ScaleEncounterPerspective =
    defaultScaleEncounterPerspective(),
): ScaleEncounterCameraStage {
  void definition
  if (view === 'overview') return 'overview'
  return perspective === 'child-rear' ? 'follow-orbit' : 'pov'
}

function defaultScaleEncounterPerspective(): ScaleEncounterPerspective {
  return 'child-eyes'
}

function minimumScaleEncounterOverviewZoom(
  animalId: ScaleEncounterDefinition['id'],
): number {
  return SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme === 'glacier'
    ? 0.58
    : 0.74
}

function shortestScaleEncounterOrbitAngle(angleRadians: number): number {
  return Math.atan2(Math.sin(angleRadians), Math.cos(angleRadians))
}

function scaleEncounterOrbitReturnDurationMs(
  definition: ScaleEncounterDefinition,
  startAngleRadians: number,
  startDistance: number,
): number {
  const angularDuration =
    Math.abs(startAngleRadians) /
    SCALE_ENCOUNTER_ORBIT_RETURN_SPEED_RADIANS_PER_SECOND *
    1_000
  const distanceRatio =
    Math.abs(startDistance - definition.defaultDistance) /
    Math.max(definition.defaultDistance, 0.001)
  const distanceDuration = Math.min(distanceRatio * 900, 900)
  return Math.max(
    angularDuration,
    distanceDuration,
    Math.abs(startAngleRadians) > 0.0002 ? 400 : 0,
    Math.abs(startDistance - definition.defaultDistance) > 0.002 ? 350 : 0,
  )
}

const SCALE_ENCOUNTER_PHONE_ASPECT = 390 / 844

function scaleEncounterNarrowOverviewProgress(aspect: number): number {
  return MathUtils.clamp(
    (1.05 - aspect) / (1.05 - SCALE_ENCOUNTER_PHONE_ASPECT),
    0,
    1,
  )
}

function scaleEncounterOverviewDistanceFactor(
  definition: ScaleEncounterDefinition,
  aspect: number,
  layout: ReturnType<typeof scaleEncounterSubjectLayoutForAspect>,
): number {
  const narrowOverview = aspect <= 1.05
  if (definition.id === 'spinosaurus') {
    // Its diagonal child rail and three-quarter overview use considerably
    // less screen width than the conservative union sphere. Tighten that
    // fit without moving either subject or changing the interaction range.
    return MathUtils.lerp(
      0.85,
      0.66,
      scaleEncounterNarrowOverviewProgress(aspect),
    )
  }
  if (!narrowOverview) {
    return definition.id === 'tyrannosaurus-rex'
      ? 0.8
      : definition.habitat === 'air' && layout === 'stacked'
        ? 1.18
        : 1.1
  }
  const conservativeFactor =
    definition.id === 'tyrannosaurus-rex'
      ? 1
      : definition.habitat === 'air' && layout === 'stacked'
        ? 1.18
        : 1.1
  const phoneProgress = scaleEncounterNarrowOverviewProgress(aspect)
  const phoneFactor =
    definition.environmentTheme === 'forest'
      ? definition.id === 'tyrannosaurus-rex'
        ? 1
        : 1.03
      : 0.95
  return MathUtils.lerp(
    conservativeFactor,
    phoneFactor,
    phoneProgress * phoneProgress * phoneProgress,
  )
}

function scaleEncounterNarrowOverviewYaw(
  animalId: ScaleEncounterDefinition['id'],
  aspect: number,
): number {
  if (aspect > 1.05) return 0
  if (animalId === 'tyrannosaurus-rex') return -0.58
  const progress = scaleEncounterNarrowOverviewProgress(aspect)
  const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
  if (definition.habitat === 'water') return progress
  if (definition.environmentTheme === 'glacier') return -0.95 * progress
  return 0
}

function scaleEncounterOverviewAxes(
  definition: ScaleEncounterDefinition,
  aspect: number,
  orbitAngleRadians = 0,
): {
  readonly direction: Vector3
  readonly layout: ReturnType<typeof scaleEncounterSubjectLayoutForAspect>
  readonly up: Vector3
} {
  const layout = scaleEncounterSubjectLayoutForAspect(definition.id, aspect)
  if (definition.habitat === 'air' && layout === 'stacked') {
    const elevation = MathUtils.degToRad(70)
    const direction = new Vector3(
      0,
      Math.sin(elevation),
      Math.cos(elevation),
    ).normalize()
    const up = new Vector3(
      0,
      Math.cos(elevation),
      -Math.sin(elevation),
    ).normalize()
    direction.applyAxisAngle(WORLD_UP, orbitAngleRadians)
    up.applyAxisAngle(WORLD_UP, orbitAngleRadians)
    return {
      direction,
      layout,
      up,
    }
  }
  const direction = definition.overviewDirection
    .clone()
    .applyAxisAngle(WORLD_UP, orbitAngleRadians)
  const up = definition.overviewUp
    .clone()
    .applyAxisAngle(WORLD_UP, orbitAngleRadians)
  return {
    direction,
    layout,
    up,
  }
}
const SCALE_ENCOUNTER_DISTANCE_HOLD_STEPS_PER_SECOND = 4
const SCALE_ENCOUNTER_DISTANCE_EASING_PER_SECOND = 14
const SCALE_ENCOUNTER_LAND_SWEEP_STEP_METERS = 0.01
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
  perspective: 'child-rear',
  view: 'overview',
  transitioning: false,
  distanceMeters: null,
  orbitAngleDegrees: 0,
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
 * height. Existing animals retain their reviewed head-relative rail.
 * Apatosaurus alone uses a body-centred linear radius: rotating its old
 * head-relative rail around a 23 m body left an irreducible multi-metre gap at
 * the legs, while the slant-distance projection collapsed the last part of an
 * approach into a visible forward snap. Air and water retain their authored
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
  if (placement.animalId !== 'apatosaurus') {
    const verticalDistance = placement.target.y - eyeHeight
    const horizontalDistance = Math.sqrt(
      Math.max(distance * distance - verticalDistance * verticalDistance, 0),
    )
    result.copy(placement.observerRailDirection).setY(0)
    if (result.lengthSq() < 1e-8) {
      result.copy(placement.defaultEyePosition).sub(placement.target).setY(0)
    }
    if (result.lengthSq() < 1e-8) result.set(-1, 0, 0)
    return result
      .normalize()
      .multiplyScalar(horizontalDistance)
      .add(placement.target)
      .setY(eyeHeight)
  }
  result.copy(placement.defaultEyePosition).sub(placement.orbitCenter).setY(0)
  if (result.lengthSq() < 1e-8) result.set(-1, 0, 0)
  return result
    .multiplyScalar(distance / Math.max(placement.defaultDistance, 1e-8))
    .add(placement.orbitCenter)
    .setY(eyeHeight)
}

/**
 * Rotates the authored observer position around the vertical axis through the
 * exact centre of the animal's complete bounds. The authored gaze target can
 * deliberately sit near a head or torso, so it must not double as the orbit
 * pivot: doing so makes the child circle an off-centre fragment of the animal.
 */
export function computeScaleEncounterOrbitedEyePosition(
  placement: ScaleEncounterPlacement,
  habitat: ScaleEncounterDefinition['habitat'],
  distance: number,
  orbitAngleRadians: number,
  result = new Vector3(),
): Vector3 {
  computeScaleEncounterPovEyePosition(
    placement,
    habitat,
    distance,
    result,
  )
  return result
    .sub(placement.orbitCenter)
    .applyAxisAngle(WORLD_UP, orbitAngleRadians)
    .add(placement.orbitCenter)
}

/** Horizontal world radius produced by a rail parameter at any orbit angle. */
export function scaleEncounterLandRadiusAtDistance(
  placement: ScaleEncounterPlacement,
  distance: number,
): number {
  const eye = computeScaleEncounterPovEyePosition(placement, 'land', distance)
  const radius = eye.sub(placement.orbitCenter).setY(0).length()
  return Number.isFinite(radius) ? radius : 0
}

/**
 * Inverts a land animal's existing observation rail by world radius. This is
 * what keeps 1.4/2.8 m/s honest on both the legacy slant-distance rails and
 * Apatosaurus's body-centred linear rail without changing either composition.
 */
export function scaleEncounterLandDistanceForRadius(
  placement: ScaleEncounterPlacement,
  desiredRadius: number,
  minimumDistance: number,
  maximumDistance: number,
): number {
  const lowerDistance = Math.min(minimumDistance, maximumDistance)
  const upperDistance = Math.max(minimumDistance, maximumDistance)
  const lowerRadius = scaleEncounterLandRadiusAtDistance(
    placement,
    lowerDistance,
  )
  const upperRadius = scaleEncounterLandRadiusAtDistance(
    placement,
    upperDistance,
  )
  if (
    !Number.isFinite(desiredRadius) ||
    !Number.isFinite(lowerRadius) ||
    !Number.isFinite(upperRadius)
  ) {
    return lowerDistance
  }
  const increasing = upperRadius >= lowerRadius
  const clampedRadius = MathUtils.clamp(
    desiredRadius,
    Math.min(lowerRadius, upperRadius),
    Math.max(lowerRadius, upperRadius),
  )
  let low = lowerDistance
  let high = upperDistance
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpoint = (low + high) * 0.5
    const radius = scaleEncounterLandRadiusAtDistance(placement, midpoint)
    if ((radius < clampedRadius) === increasing) low = midpoint
    else high = midpoint
  }
  return (low + high) * 0.5
}

function projectScaleEncounterLandPointOutsideBounds(
  point: Vector3,
  minimum: Readonly<Vector3>,
  maximum: Readonly<Vector3>,
): Vector3 {
  if (
    point.x <= minimum.x ||
    point.x >= maximum.x ||
    point.z <= minimum.z ||
    point.z >= maximum.z
  ) {
    return point
  }
  const candidates = [
    { distance: point.x - minimum.x, axis: 'x' as const, value: minimum.x },
    { distance: maximum.x - point.x, axis: 'x' as const, value: maximum.x },
    { distance: point.z - minimum.z, axis: 'z' as const, value: minimum.z },
    { distance: maximum.z - point.z, axis: 'z' as const, value: maximum.z },
  ]
  const closest = candidates.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  )
  point[closest.axis] = closest.value
  return point
}

function unwrapScaleEncounterOrbitAngle(
  previousAngle: number,
  baseDirection: Readonly<Vector3>,
  nextDirection: Readonly<Vector3>,
): number {
  const wrapped = Math.atan2(
    baseDirection.z * nextDirection.x -
      baseDirection.x * nextDirection.z,
    baseDirection.x * nextDirection.x +
      baseDirection.z * nextDirection.z,
  )
  const delta = MathUtils.euclideanModulo(
    wrapped - previousAngle + Math.PI,
    Math.PI * 2,
  ) - Math.PI
  return previousAngle + delta
}

function scaleEncounterLandOrbitAngleForWorldDirection(
  placement: ScaleEncounterPlacement,
  distance: number,
  previousAngle: number,
  worldDirection: Readonly<Vector3>,
): number {
  const baseDirection = computeScaleEncounterPovEyePosition(
    placement,
    'land',
    distance,
  )
    .sub(placement.orbitCenter)
    .setY(0)
  if (baseDirection.lengthSq() < 1e-8) return previousAngle
  return unwrapScaleEncounterOrbitAngle(
    previousAngle,
    baseDirection.normalize(),
    worldDirection,
  )
}

function scaleEncounterEyeClearsExpandedAnimalBounds(
  placement: ScaleEncounterPlacement,
  definition: ScaleEncounterDefinition,
  distance: number,
  orbitAngleRadians: number,
  marginMeters: number,
): boolean {
  const eye = computeScaleEncounterOrbitedEyePosition(
    placement,
    definition.habitat,
    distance,
    orbitAngleRadians,
  )
  const radial = eye.clone().sub(placement.orbitCenter)
  const halfExtents = new Vector3()
    .subVectors(
      placement.animalBoundsMaximum,
      placement.animalBoundsMinimum,
    )
    .multiplyScalar(0.5)
    .addScalar(marginMeters)

  // A child on land must stay outside the animal's complete ground footprint.
  // This avoids allowing an eye-height point underneath a raised belly or long
  // neck. Flying and swimming encounters use the full three-dimensional box.
  if (definition.habitat === 'land') {
    radial.y = 0
    const radius = radial.length()
    if (radius <= 1e-8) return false
    radial.divideScalar(radius)
    const boundaryRadius = Math.min(
      Math.abs(radial.x) > 1e-8
        ? halfExtents.x / Math.abs(radial.x)
        : Number.POSITIVE_INFINITY,
      Math.abs(radial.z) > 1e-8
        ? halfExtents.z / Math.abs(radial.z)
        : Number.POSITIVE_INFINITY,
    )
    return radius >= boundaryRadius
  }

  const radius = radial.length()
  if (radius <= 1e-8) return false
  radial.divideScalar(radius)
  const boundaryRadius = Math.min(
    ...(['x', 'y', 'z'] as const).map((axis) =>
      Math.abs(radial[axis]) > 1e-8
        ? halfExtents[axis] / Math.abs(radial[axis])
        : Number.POSITIVE_INFINITY,
    ),
  )
  return radius >= boundaryRadius
}

/**
 * Finds the nearest child position outside the animal's expanded calibrated
 * bounds. The result changes with the animal's length, width and orbit angle,
 * so close approach follows the occupied model volume instead of a circle
 * centred on the animal.
 */
export function minimumScaleEncounterDistanceForProfile(
  placement: ScaleEncounterPlacement,
  definition: ScaleEncounterDefinition,
  profile: NormalizedScaleEncounterProfile,
  orbitAngleRadians: number,
): number {
  if (
    profile.approach !== 'close' &&
    placement.animalId !== 'apatosaurus'
  ) {
    return definition.minimumDistance
  }
  const marginMeters = Math.max(0.55, profile.heightMeters * 0.5)
  const distanceFloor =
    profile.approach === 'close'
      ? Math.min(
          definition.minimumDistance,
          Math.max(0.75, profile.heightMeters * 0.75),
        )
      : definition.minimumDistance
  const clearsAt = (distance: number) =>
    scaleEncounterEyeClearsExpandedAnimalBounds(
      placement,
      definition,
      distance,
      orbitAngleRadians,
      marginMeters,
    )

  if (clearsAt(distanceFloor)) return distanceFloor

  let unsafeDistance = distanceFloor
  const sampleCount = 48
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const candidateDistance = MathUtils.lerp(
      distanceFloor,
      definition.defaultDistance,
      sample / sampleCount,
    )
    if (!clearsAt(candidateDistance)) {
      unsafeDistance = candidateDistance
      continue
    }
    let safeDistance = candidateDistance
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const midpoint = (unsafeDistance + safeDistance) * 0.5
      if (clearsAt(midpoint)) safeDistance = midpoint
      else unsafeDistance = midpoint
    }
    return safeDistance
  }

  // The reviewed default is the conservative fallback if a highly unusual
  // animated bound does not expose a nearer safe point on the authored rail.
  return definition.defaultDistance
}

export function clampScaleEncounterDistanceForProfile(
  placement: ScaleEncounterPlacement,
  definition: ScaleEncounterDefinition,
  profile: NormalizedScaleEncounterProfile,
  distance: number,
  orbitAngleRadians: number,
): number {
  if (!Number.isFinite(distance)) return definition.defaultDistance
  return clampScaleEncounterValue(
    distance,
    minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      profile,
      orbitAngleRadians,
    ),
    definition.maximumDistance,
  )
}

/**
 * Moves the gaze from the authored opening detail toward the complete animal
 * centre as soon as the child starts circling. The authored land targets sit
 * near the head, which is useful on arrival but makes a side view frame the
 * front half of a long animal and crop the rest of its body.
 */
export function computeScaleEncounterOrbitedGazeTarget(
  placement: ScaleEncounterPlacement,
  orbitAngleRadians: number,
  result = new Vector3(),
): Vector3 {
  const centreBlend = MathUtils.smoothstep(
    Math.abs(orbitAngleRadians),
    0,
    MathUtils.degToRad(12),
  )
  return result
    .copy(placement.target)
    .lerp(placement.orbitCenter, centreBlend)
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
  // Assign all Euler axes together. A quaternion at exactly 180° yaw can be
  // decomposed as X=180°, Y=0°, Z=180°; changing only `.rotation.y` after that
  // decomposition produces the opposite-facing quaternion. That was the
  // Dilophosaurus compare → exhibit → focus direction flip.
  staged.modelRoot.rotation.set(
    0,
    MathUtils.degToRad(staged.descriptor.presentation.initialYawDegrees),
    0,
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
    '#f2f3e8',
    '#8f917e',
    0,
  )
  private readonly scaleEncounterSunLight = new DirectionalLight(
    '#ffe9c8',
    1.28,
  )
  private readonly scaleEncounterSunTarget = new Group()
  private readonly scaleEncounterSkyFillLight = new DirectionalLight(
    '#edf3ee',
    1.4,
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
  private scaleEncounterSceneCandidateVariant: ScaleEncounterSceneCandidateVariant =
    'off'
  private scaleEncounterPrototypeFlightApproximation = false
  private scaleEncounterEcologyDensity: ScaleEncounterEcologyDensity =
    'current'
  private scaleEncounterPanoramaTexture: Texture | null = null
  private scaleEncounterPreparedLandBiome: ScaleEncounterPreparedLandBiome | null =
    null
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
    this.renderer.shadowMap.type = PCFShadowMap
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
    this.scaleEncounterSunLight.shadow.radius = 1.6
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
      modelRoot.rotation.set(
        0,
        (descriptor.presentation.initialYawDegrees * Math.PI) / 180,
        0,
      )
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
        ...(this.current
          ? { animalBounds: computeModelBounds(this.current.modelRoot, true) }
          : {}),
        animalId: encounter.definition.id,
        avatarBounds: new Box3().setFromObject(encounter.avatar.root, true),
        camera: this.camera,
        ecologyDensity: this.scaleEncounterEcologyDensity,
        forestProps: this.scaleEncounterForestProps,
        matureTreeAtlas: this.scaleEncounterMatureTreeAtlas,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        preparedLandBiome: this.scaleEncounterPreparedLandBiome,
        renderer: this.renderer,
        sceneCandidateVariant: this.scaleEncounterSceneCandidateVariant,
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
        this.camera,
      )
    }
    this.scene.environment = encounter.environment?.environmentMap ?? null
    this.scene.environmentIntensity =
      encounter.environment?.environmentIntensity ?? 1
    this.renderer.domElement.dataset.scaleEncounterEnvironment = variant
    this.renderer.render(this.scene, this.camera)
  }

  setScaleEncounterSceneCandidateVariant(
    variant: ScaleEncounterSceneCandidateVariant,
  ): void {
    const changed = this.scaleEncounterSceneCandidateVariant !== variant
    this.scaleEncounterSceneCandidateVariant = variant
    this.renderer.domElement.dataset.scaleEncounterSceneCandidate = variant
    if (!changed || !this.scaleEncounter) return
    // C spends its budget on real depth layers rather than an 8K backbuffer.
    // Re-evaluate the cap immediately so switching variants is measurable in
    // the same persistent preview session.
    this.resize()
    this.setScaleEncounterPanoramaTexture(
      this.scaleEncounterPanoramaTexture,
      this.scaleEncounterSurfaceTextures,
      true,
      this.scaleEncounterMatureTreeAtlas,
      this.scaleEncounterPreparedLandBiome,
    )
  }

  setScaleEncounterPrototypeFlightApproximation(enabled: boolean): void {
    this.scaleEncounterPrototypeFlightApproximation = enabled
    this.renderer.domElement.dataset.scaleEncounterPrototypeFlightApproximation =
      String(enabled)
    this.renderer.domElement.dataset.scaleEncounterPrototypeFlightApproximationLimitation =
      enabled ? SKY_PROTOTYPE_FLIGHT_APPROXIMATION_LIMITATION : 'disabled'
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
      this.scaleEncounterPreparedLandBiome,
    )
  }

  setScaleEncounterPanoramaTexture(
    texture: Texture | null,
    surfaceTextures: ScaleEncounterSurfaceTextures | null = null,
    forceRebuild = false,
    matureTreeAtlas: Texture | null = null,
    preparedLandBiome: ScaleEncounterPreparedLandBiome | null = null,
  ): void {
    if (
      !forceRebuild &&
      this.scaleEncounterPanoramaTexture === texture &&
      this.scaleEncounterSurfaceTextures === surfaceTextures &&
      this.scaleEncounterMatureTreeAtlas === matureTreeAtlas &&
      this.scaleEncounterPreparedLandBiome === preparedLandBiome
    ) {
      return
    }
    this.scaleEncounterPanoramaTexture = texture
    this.scaleEncounterSurfaceTextures = surfaceTextures
    this.scaleEncounterMatureTreeAtlas = matureTreeAtlas
    this.scaleEncounterPreparedLandBiome = preparedLandBiome
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
        ...(this.current
          ? { animalBounds: computeModelBounds(this.current.modelRoot, true) }
          : {}),
        animalId: encounter.definition.id,
        avatarBounds: new Box3().setFromObject(encounter.avatar.root, true),
        camera: this.camera,
        ecologyDensity: this.scaleEncounterEcologyDensity,
        forestProps: this.scaleEncounterForestProps,
        matureTreeAtlas,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        preparedLandBiome,
        renderer: this.renderer,
        sceneCandidateVariant: this.scaleEncounterSceneCandidateVariant,
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
        this.camera,
      )
    }
    const previous = encounter.environment
    encounter.environment = replacement
    this.scene.environment = replacement?.environmentMap ?? null
    this.scene.environmentIntensity = replacement?.environmentIntensity ?? 1
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
      this.scaleEncounterPreparedLandBiome,
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
    if (this.destroyed) {
      this.setScaleEncounterUnavailable('viewer-not-ready')
      return false
    }

    // The catalog marks the incoming animal as selected before its short
    // exhibit crossfade has completely settled. If the family opens the
    // encounter during that window, commit the already-selected incoming
    // model first; rejecting here leaves the encounter in a false error state
    // even though both the model and canonical Avatar are ready.
    if (this.transition) this.finishTransition()

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
    let boostFlow: ScaleEncounterBoostFlowEffect | null = null
    let mammothAnimalGrade: MammothSubjectGradeLease | null = null
    let oceanAnimalGrade: OceanSubjectGradeLease | null = null
    let oceanAvatarGrade: OceanSubjectGradeLease | null = null

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
      current.modelRoot.rotation.set(0, definition.modelYawRadians, 0)
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
      if (
        definition.habitat === 'air' &&
        this.scaleEncounterPrototypeFlightApproximation &&
        avatar.bodyOrientation !== 'prone'
      ) {
        avatar = createSkyPrototypeFlightAvatar(
          avatar,
          placement.target.clone().sub(placement.defaultEyePosition),
        )
      }
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
          animalBounds: worldBounds.clone(),
          animalId: definition.id,
          avatarBounds: new Box3().setFromObject(avatar.root, true),
          camera: this.camera,
          ecologyDensity: this.scaleEncounterEcologyDensity,
          forestProps: this.scaleEncounterForestProps,
          matureTreeAtlas: this.scaleEncounterMatureTreeAtlas,
          maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
          preparedLandBiome: this.scaleEncounterPreparedLandBiome,
          renderer: this.renderer,
          sceneCandidateVariant: this.scaleEncounterSceneCandidateVariant,
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
      boostFlow = createScaleEncounterBoostFlowEffect(definition.habitat)
      if (boostFlow) this.scene.add(boostFlow.root)
      if (environment?.sceneCandidateSemantic === 'ocean') {
        // Grade authored subject albedo before PBR lighting instead of
        // darkening the entire ocean exposure. The animal can take slightly
        // more midtone depth; the child's skin receives a gentler grade so it
        // remains readable in the close guided camera.
        oceanAnimalGrade = applyOceanSubjectGrade(current.modelRoot, {
          midtoneExponent: 1.08,
          saturation: 1.18,
        })
        oceanAvatarGrade = applyOceanSubjectGrade(avatar.root, {
          midtoneExponent: 1.045,
          saturation: 1.12,
        })
      } else if (
        definition.environmentTheme === 'glacier' &&
        environment?.sceneCandidateSemantic === 'mammoth-palaeoenvironment'
      ) {
        // Lift the animal's dark authored fur without touching the snowfield
        // exposure or the child's cold-weather outfit.
        mammothAnimalGrade = applyMammothSubjectGrade(current.modelRoot, {
          midtoneExponent: 0.62,
          minimumFill: 0.075,
          saturation: 1.08,
        })
      }

      this.camera.clearViewOffset()
      this.scaleEncounter = {
        actionBoostActive: false,
        actionBoostMultiplier: 1,
        avatar,
        avatarBaseYawRadians: avatar.root.rotation.y,
        avatarPreviousEyePosition: avatar.eyeAnchor.getWorldPosition(
          new Vector3(),
        ),
        definition,
        placement,
        saved,
        rawSpanUnits,
        metersPerUnit,
        profile: normalizedProfile,
        perspective: defaultScaleEncounterPerspective(),
        view: 'overview',
        cameraStage: 'overview',
        observerDistance: definition.defaultDistance,
        orbitAngleRadians: 0,
        overviewZoom: SCALE_ENCOUNTER_OVERVIEW_DEFAULT_ZOOM,
        targetObserverDistance: definition.defaultDistance,
        targetOrbitAngleRadians: 0,
        targetOverviewZoom: SCALE_ENCOUNTER_OVERVIEW_DEFAULT_ZOOM,
        distanceMotionDirection: 0,
        orbitMotionDirection: 0,
        boostFlow,
        environment,
        jumpActive: false,
        jumpEntryMotion: 'idle',
        jumpOffsetMeters: 0,
        jumpPhase: 'grounded',
        jumpPhaseElapsedSeconds: 0,
        jumpVelocityMetersPerSecond: 0,
        landMotionIntent: 'idle',
        mammothAnimalGrade,
        oceanAnimalGrade,
        oceanAvatarGrade,
        transition: null,
      }
      this.resize()
      const candidateOwnsLighting = environment?.ownsLighting === true
      const skyCandidateSubjectFill =
        environment?.sceneCandidateSemantic === 'sky'
      this.scaleEncounterSunLight.visible =
        definition.habitat === 'land' && !candidateOwnsLighting
      this.scaleEncounterSkyFillLight.visible =
        definition.habitat === 'land' && !candidateOwnsLighting
      this.scaleEncounterHemisphereLight.intensity =
        definition.habitat === 'land' && !candidateOwnsLighting ? 3.12 : 0
      // The museum preview hemisphere is intentionally generous so models
      // read against the neutral plinth. Leaving it enabled here adds a
      // second, unrelated sky/ground probe on top of the authored encounter
      // sun and hemisphere, flattening the terrain and lifting tree-card
      // edges. The saved intensity is restored on exit.
      this.ambientHemisphereLight.intensity =
        definition.habitat === 'land' || candidateOwnsLighting ? 0 : 1.3
      this.sceneAccentLight.intensity = 0
      this.cameraKeyLight.intensity =
        skyCandidateSubjectFill
          ? 0.95
          : definition.habitat === 'land' || candidateOwnsLighting
            ? 0
            : 1.1
      this.cameraFillLight.intensity =
        skyCandidateSubjectFill
          ? 0.44
          : definition.habitat === 'land' || candidateOwnsLighting
            ? 0
            : 0.42
      if (environment?.toneMappingExposure !== null && environment?.toneMappingExposure !== undefined) {
        this.renderer.toneMappingExposure = environment.toneMappingExposure
      } else if (definition.habitat === 'land') {
        this.renderer.toneMappingExposure = 1.4
      }
      this.scene.environment = environment?.environmentMap ?? null
      this.scene.environmentIntensity = environment?.environmentIntensity ?? 1
      if (environment?.fog) {
        this.scene.fog = environment.fog
      } else if (definition.habitat === 'land') {
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
        this.camera,
      )
      this.renderer.domElement.dataset.scaleEncounter = 'true'
      this.renderer.domElement.dataset.scaleEncounterAnimalId = definition.id
      this.renderer.domElement.dataset.scaleEncounterDisplayedMeters =
        definition.displayedMeters.toFixed(3)
      this.renderer.domElement.dataset.scaleEncounterScaleConfidence =
        definition.scaleConfidence
      this.renderer.domElement.dataset.scaleEncounterCameraStage = 'overview'
      this.renderer.domElement.dataset.scaleEncounterEnvironment =
        this.scaleEncounterEnvironmentVariant
      this.renderer.domElement.dataset.scaleEncounterSceneCandidate =
        this.scaleEncounterSceneCandidateVariant
      this.renderer.domElement.dataset.scaleEncounterSceneSemantic =
        environment?.sceneCandidateSemantic ?? 'legacy-environment'
      this.renderer.domElement.dataset.scaleEncounterBoostFlow =
        boostFlow?.habitat ?? 'none'
      this.renderer.domElement.dataset.scaleEncounterSubjectLighting =
        skyCandidateSubjectFill
          ? 'rear-upper-camera-fill-v1'
          : candidateOwnsLighting
            ? 'environment-owned'
            : 'legacy-camera-lighting'
      if (environment?.sceneCandidateSemantic === 'ocean') {
        this.renderer.domElement.dataset.scaleEncounterSubjectColour =
          OCEAN_SUBJECT_GRADE_REVISION
      } else if (definition.environmentTheme === 'glacier') {
        this.renderer.domElement.dataset.scaleEncounterSubjectColour =
          MAMMOTH_SUBJECT_GRADE_REVISION
      }
      this.renderer.domElement.dataset.scaleEncounterProductionApproved =
        'false'
      this.renderer.domElement.dataset.scaleEncounterEcologyDensity =
        this.scaleEncounterEcologyDensity
      this.renderer.domElement.dataset.scaleEncounterView = 'overview'
      this.renderer.domElement.dataset.scaleEncounterPerspective =
        defaultScaleEncounterPerspective()
      this.renderer.domElement.setAttribute(
        'aria-label',
        `${current.descriptor.label}与小朋友的等比例三维相遇；可用左右键绕行，也可前后移动`,
      )
      this.publishScaleEncounterSnapshot()
      this.updateCameraLighting()
      this.renderer.render(this.scene, this.camera)
      return true
    } catch (cause) {
      mammothAnimalGrade?.restore()
      oceanAvatarGrade?.restore()
      oceanAnimalGrade?.restore()
      boostFlow?.dispose()
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
    this.resetScaleEncounterContextAction()

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
    const sceneReplacement =
      encounter.definition.habitat === 'air' &&
      this.scaleEncounterPrototypeFlightApproximation &&
      replacement.bodyOrientation !== 'prone'
        ? createSkyPrototypeFlightAvatar(
            replacement,
            placement.target.clone().sub(placement.defaultEyePosition),
          )
        : replacement
    const avatarBaseYawRadians = sceneReplacement.root.rotation.y
    sceneReplacement.root.rotation.y =
      avatarBaseYawRadians + encounter.orbitAngleRadians
    const observerDistance = clampScaleEncounterDistanceForProfile(
      placement,
      encounter.definition,
      normalizedProfile,
      encounter.observerDistance,
      encounter.orbitAngleRadians,
    )
    this.placeScaleEncounterAvatarEyeAt(
      sceneReplacement,
      this.computeScaleEncounterObserverEyePosition(
        placement,
        encounter.definition,
        encounter.view === 'overview'
          ? encounter.definition.defaultDistance
          : observerDistance,
        encounter.orbitAngleRadians,
      ),
    )
    this.scene.add(sceneReplacement.root)
    encounter.oceanAvatarGrade?.restore()
    encounter.oceanAvatarGrade =
      encounter.environment?.sceneCandidateSemantic === 'ocean'
        ? applyOceanSubjectGrade(sceneReplacement.root, {
            midtoneExponent: 1.045,
            saturation: 1.12,
          })
        : null
    disposeScaleEncounterAvatar(encounter.avatar, this.renderer)
    encounter.avatar = sceneReplacement
    encounter.avatarBaseYawRadians = avatarBaseYawRadians
    encounter.placement = placement
    encounter.profile = normalizedProfile
    encounter.observerDistance = observerDistance
    encounter.targetObserverDistance = observerDistance
    encounter.distanceMotionDirection = 0
    encounter.orbitMotionDirection = 0
    syncScaleEncounterGroundContacts(
      encounter.environment,
      current.modelRoot,
      sceneReplacement.root,
    )

    if (encounter.view === 'pov') {
      this.applyScaleEncounterPovPose()
    } else {
      this.applyScaleEncounterOverviewPose()
    }
    encounter.avatarPreviousEyePosition.copy(
      sceneReplacement.eyeAnchor.getWorldPosition(new Vector3()),
    )
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
    this.resetScaleEncounterContextAction()
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
      encounter.cameraStage ===
        scaleEncounterFinalCameraStage(
          encounter.definition,
          targetView,
          encounter.perspective,
        )
    ) {
      return Promise.resolve()
    }

    const startOrbitAngle = shortestScaleEncounterOrbitAngle(
      encounter.orbitAngleRadians,
    )
    const startObserverDistance = encounter.observerDistance
    const startAvatarQuaternion = encounter.avatar.root.quaternion.clone()
    const shouldReturnToPovOrigin =
      targetView === 'overview' &&
      encounter.view === 'pov' &&
      encounter.cameraStage ===
        scaleEncounterFinalCameraStage(
          encounter.definition,
          'pov',
          encounter.perspective,
        ) &&
      (Math.abs(startOrbitAngle) > 0.0002 ||
        Math.abs(
          startObserverDistance - encounter.definition.defaultDistance,
        ) > 0.002)
    const orbitReturnDuration = shouldReturnToPovOrigin
      ? scaleEncounterOrbitReturnDurationMs(
          encounter.definition,
          startOrbitAngle,
          startObserverDistance,
        )
      : 0

    if (targetView === 'overview') {
      encounter.observerDistance = encounter.definition.defaultDistance
      encounter.targetObserverDistance = encounter.definition.defaultDistance
      encounter.orbitAngleRadians = 0
      encounter.targetOrbitAngleRadians = 0
      encounter.avatar.root.rotation.y = encounter.avatarBaseYawRadians
      this.placeScaleEncounterAvatarEyeAt(
        encounter.avatar,
        this.computeScaleEncounterObserverEyePosition(
          encounter.placement,
          encounter.definition,
          encounter.definition.defaultDistance,
          0,
        ),
      )
    } else {
      encounter.avatar.root.visible = true
    }
    encounter.distanceMotionDirection = 0
    encounter.orbitMotionDirection = 0
    const duration = this.reducedMotion
      ? 0
      : clampScaleEncounterValue(
          durationMs ??
            (targetView === 'pov'
              ? encounter.definition.guidedTransitionDurationMs
              : SCALE_ENCOUNTER_RETURN_OVERVIEW_DURATION_MS +
                orbitReturnDuration +
                (shouldReturnToPovOrigin
                  ? SCALE_ENCOUNTER_ORBIT_RETURN_HOLD_MS
                  : 0)),
          0,
          12_000,
        )
    if (duration === 0) {
      this.completeScaleEncounterView(targetView)
      return Promise.resolve()
    }

    const deferred = createVoidDeferred()
    const orbitReturnEndAt = shouldReturnToPovOrigin
      ? clampScaleEncounterValue(
          orbitReturnDuration / Math.max(duration, 1),
          0.2,
          0.68,
        )
      : 0
    const orbitReturn = shouldReturnToPovOrigin
      ? {
          endAt: orbitReturnEndAt,
          holdEndAt: clampScaleEncounterValue(
            orbitReturnEndAt +
              SCALE_ENCOUNTER_ORBIT_RETURN_HOLD_MS /
                Math.max(duration, 1),
            orbitReturnEndAt,
            0.82,
          ),
          startAngleRadians: startOrbitAngle,
          startDistance: startObserverDistance,
        }
      : undefined
    const keyframes = this.createScaleEncounterTransitionKeyframes(
      targetView,
      orbitReturn?.endAt,
      orbitReturn?.holdEndAt,
    )
    if (orbitReturn) {
      // Keyframe construction needs the child at the canonical observation
      // point so its rear and overview compositions are authored around the
      // original layout. Restore the hidden child to the current POV here;
      // the first transition phase then moves the actual eyes and camera back
      // together along the animal-centred orbit.
      encounter.observerDistance = orbitReturn.startDistance
      encounter.orbitAngleRadians = orbitReturn.startAngleRadians
      encounter.avatar.root.quaternion.copy(startAvatarQuaternion)
      this.placeScaleEncounterAvatarEyeAt(
        encounter.avatar,
        this.computeScaleEncounterObserverEyePosition(
          encounter.placement,
          encounter.definition,
          orbitReturn.startDistance,
          orbitReturn.startAngleRadians,
        ),
      )
      encounter.avatar.root.visible =
        encounter.perspective === 'child-rear'
    } else if (targetView === 'overview') {
      // Keyframe fitting temporarily canonicalises the child. Preserve the
      // live heading and let the per-frame idle damping turn it back toward
      // the animal instead of snapping on transition start.
      encounter.avatar.root.quaternion.copy(startAvatarQuaternion)
      this.placeScaleEncounterAvatarEyeAt(
        encounter.avatar,
        this.computeScaleEncounterObserverEyePosition(
          encounter.placement,
          encounter.definition,
          encounter.definition.defaultDistance,
          0,
        ),
      )
    }
    encounter.transition = {
      duration,
      keyframes,
      ...(orbitReturn ? { orbitReturn } : {}),
      promise: deferred.promise,
      resolve: deferred.resolve,
      startedAt: performance.now(),
      targetView,
    }
    this.controls.target.copy(encounter.placement.target)
    this.publishScaleEncounterSnapshot()
    return deferred.promise
  }

  transitionScaleEncounterPerspective(
    targetPerspective: ScaleEncounterPerspective,
    durationMs = 1_600,
  ): Promise<void> {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.view !== 'pov') {
      return Promise.resolve()
    }
    this.resetScaleEncounterContextAction()
    if (
      encounter.transition?.targetView === 'pov' &&
      encounter.transition.targetPerspective === targetPerspective
    ) {
      return encounter.transition.promise
    }
    const interruptedTransition = encounter.transition !== null
    if (encounter.transition) {
      encounter.transition.resolve()
      encounter.transition = null
    }
    if (
      !interruptedTransition &&
      encounter.perspective === targetPerspective &&
      encounter.cameraStage ===
        scaleEncounterFinalCameraStage(
          encounter.definition,
          'pov',
          targetPerspective,
        )
    ) {
      return Promise.resolve()
    }

    const startPose: ScaleEncounterCameraKeyframe = {
      at: 0,
      cameraStage: encounter.cameraStage,
      fieldOfView: this.camera.fov,
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    }
    encounter.perspective = targetPerspective
    encounter.distanceMotionDirection = 0
    encounter.orbitMotionDirection = 0
    const endPose = this.computeScaleEncounterCameraPose('pov')
    const duration = this.reducedMotion
      ? 0
      : clampScaleEncounterValue(durationMs, 0, 4_000)
    if (duration === 0) {
      this.completeScaleEncounterView('pov')
      return Promise.resolve()
    }

    const deferred = createVoidDeferred()
    encounter.transition = {
      duration,
      keyframes: [
        startPose,
        {
          at: 1,
          cameraStage: scaleEncounterFinalCameraStage(
            encounter.definition,
            'pov',
            targetPerspective,
          ),
          ...endPose,
        },
      ],
      promise: deferred.promise,
      resolve: deferred.resolve,
      startedAt: performance.now(),
      targetPerspective,
      targetView: 'pov',
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
        minimumScaleEncounterOverviewZoom(encounter.definition.id),
        SCALE_ENCOUNTER_OVERVIEW_ZOOM_MAXIMUM,
      )
    } else {
      if (encounter.definition.habitat === 'land') {
        // A tapped radial command owns the next movement segment. Cancel any
        // unfinished left/right target first; otherwise the two independent
        // eases combine into a fast spiral that makes Up/Down look like orbit.
        encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
      }
      encounter.targetObserverDistance = clampScaleEncounterDistanceForProfile(
        encounter.placement,
        encounter.definition,
        encounter.profile,
        encounter.targetObserverDistance -
          direction * SCALE_ENCOUNTER_DISTANCE_STEP[encounter.definition.habitat],
        encounter.orbitAngleRadians,
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
      if (
        encounter.view === 'pov' &&
        encounter.definition.habitat === 'land'
      ) {
        encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
      }
    } else {
      this.publishScaleEncounterSnapshot()
    }
  }

  /** `-1` circles left; `1` circles right around the animal. */
  adjustScaleEncounterOrbit(direction: -1 | 1): void {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.transition || encounter.view !== 'pov') return
    if (encounter.definition.habitat === 'land') {
      // Match held controls: a new lateral command cancels an unfinished
      // radial target. Simultaneous keyboard holds still use the dedicated
      // normalised two-axis integrator below.
      encounter.targetObserverDistance = encounter.observerDistance
    }
    encounter.targetOrbitAngleRadians +=
      direction * SCALE_ENCOUNTER_ORBIT_STEP_RADIANS
    if (this.reducedMotion) {
      encounter.orbitAngleRadians = encounter.targetOrbitAngleRadians
      encounter.observerDistance = clampScaleEncounterDistanceForProfile(
        encounter.placement,
        encounter.definition,
        encounter.profile,
        encounter.observerDistance,
        encounter.orbitAngleRadians,
      )
      encounter.targetObserverDistance = Math.max(
        encounter.targetObserverDistance,
        encounter.observerDistance,
      )
      this.applyScaleEncounterPovPose()
      this.publishScaleEncounterSnapshot()
    }
  }

  /** Starts or stops a pointer-held continuous orbit around the animal. */
  setScaleEncounterOrbitMotion(direction: -1 | 0 | 1): void {
    const encounter = this.scaleEncounter
    if (
      !encounter ||
      (direction !== 0 &&
        (encounter.transition !== null || encounter.view !== 'pov'))
    ) {
      return
    }
    encounter.orbitMotionDirection = direction
    if (direction !== 0) {
      encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
      if (encounter.definition.habitat === 'land') {
        encounter.targetObserverDistance = encounter.observerDistance
      }
    } else {
      this.publishScaleEncounterSnapshot()
    }
  }

  /** Starts one grounded jump. The GLB owns the articulated body pose; this
   * controller aligns its anticipation, parabola, and landing camera motion. */
  triggerScaleEncounterJump(): boolean {
    const encounter = this.scaleEncounter
    if (
      !encounter ||
      encounter.definition.habitat !== 'land' ||
      encounter.view !== 'pov' ||
      encounter.transition !== null ||
      encounter.jumpActive ||
      this.reducedMotion
    ) {
      return false
    }
    const currentMotion = (
      encounter.avatar.root.userData as Record<string, unknown>
    ).scaleEncounterAvatarMotion
    const entryMotion: ScaleEncounterJumpEntryMotion =
      currentMotion === 'run'
        ? 'run'
        : currentMotion === 'walk'
          ? 'walk'
          : 'idle'
    const jumpPolicy = SCALE_ENCOUNTER_JUMP_MOTION_POLICY[entryMotion]
    const apexHeight = MathUtils.clamp(
      encounter.profile.heightMeters * jumpPolicy.heightRatio,
      jumpPolicy.minimumHeightMeters,
      jumpPolicy.maximumHeightMeters,
    )
    encounter.jumpActive = true
    encounter.jumpEntryMotion = entryMotion
    encounter.jumpOffsetMeters = 0
    encounter.jumpPhase = 'anticipation'
    encounter.jumpPhaseElapsedSeconds = 0
    encounter.jumpVelocityMetersPerSecond =
      (4 * apexHeight) / jumpPolicy.airborneSeconds
    encounter.avatar.setActionState?.('jump', true, entryMotion)
    if (this.renderer?.domElement) {
      this.renderer.domElement.dataset.scaleEncounterContextAction = 'jump'
      this.renderer.domElement.dataset.scaleEncounterJump = 'anticipation'
      this.renderer.domElement.dataset.scaleEncounterJumpEntryMotion =
        entryMotion
    }
    return true
  }

  /** Holds a calm speed multiplier for the constrained air/water rail. */
  setScaleEncounterBoost(active: boolean): boolean {
    const encounter = this.scaleEncounter
    if (
      !encounter ||
      (encounter.definition.habitat !== 'air' &&
        encounter.definition.habitat !== 'water') ||
      (active && (encounter.view !== 'pov' || encounter.transition !== null))
    ) {
      return false
    }
    encounter.actionBoostActive = active
    if (this.renderer?.domElement) {
      this.renderer.domElement.dataset.scaleEncounterContextAction = 'boost'
      this.renderer.domElement.dataset.scaleEncounterBoost = active
        ? 'active'
        : 'inactive'
    }
    return true
  }

  private resetScaleEncounterContextAction(): void {
    const encounter = this.scaleEncounter
    if (!encounter) return
    encounter.actionBoostActive = false
    encounter.actionBoostMultiplier = 1
    encounter.boostFlow?.setIntensity(0)
    if (encounter.jumpActive) {
      encounter.avatar.setActionState?.(
        'jump',
        false,
        encounter.jumpEntryMotion,
      )
    }
    encounter.jumpActive = false
    encounter.jumpEntryMotion = 'idle'
    encounter.jumpOffsetMeters = 0
    encounter.jumpPhase = 'grounded'
    encounter.jumpPhaseElapsedSeconds = 0
    encounter.jumpVelocityMetersPerSecond = 0
    const dataset = this.renderer?.domElement?.dataset
    if (dataset) {
      delete dataset.scaleEncounterContextAction
      delete dataset.scaleEncounterJump
      delete dataset.scaleEncounterJumpEntryMotion
      delete dataset.scaleEncounterBoost
      delete dataset.scaleEncounterBoostMultiplier
      delete dataset.scaleEncounterBoostFlowIntensity
    }
  }

  private updateScaleEncounterContextAction(deltaSeconds: number): void {
    const encounter = this.scaleEncounter
    if (!encounter) return

    const boostTarget = encounter.actionBoostActive
      ? encounter.definition.habitat === 'air'
        ? SCALE_ENCOUNTER_AIR_BOOST_MULTIPLIER
        : encounter.definition.habitat === 'water'
          ? SCALE_ENCOUNTER_WATER_BOOST_MULTIPLIER
          : 1
      : 1
    encounter.actionBoostMultiplier = this.reducedMotion
      ? boostTarget
      : MathUtils.damp(
          encounter.actionBoostMultiplier ?? 1,
          boostTarget,
          SCALE_ENCOUNTER_BOOST_EASING_PER_SECOND,
          Math.max(deltaSeconds, 0),
        )
    const boostCap =
      encounter.definition.habitat === 'air'
        ? SCALE_ENCOUNTER_AIR_BOOST_MULTIPLIER
        : encounter.definition.habitat === 'water'
          ? SCALE_ENCOUNTER_WATER_BOOST_MULTIPLIER
          : 1
    const boostIntensity =
      boostCap <= 1
        ? 0
        : (encounter.actionBoostMultiplier - 1) / (boostCap - 1)
    encounter.boostFlow?.setIntensity(boostIntensity)
    if (this.renderer?.domElement) {
      this.renderer.domElement.dataset.scaleEncounterBoostMultiplier =
        encounter.actionBoostMultiplier.toFixed(3)
      this.renderer.domElement.dataset.scaleEncounterBoostFlowIntensity =
        boostIntensity.toFixed(3)
    }

    if (!encounter.jumpActive) return
    const jumpPolicy =
      SCALE_ENCOUNTER_JUMP_MOTION_POLICY[encounter.jumpEntryMotion]
    const stepSeconds = Math.max(deltaSeconds, 0)
    encounter.jumpPhaseElapsedSeconds += stepSeconds

    if (encounter.jumpPhase === 'anticipation') {
      const progress = MathUtils.clamp(
        encounter.jumpPhaseElapsedSeconds /
          jumpPolicy.anticipationSeconds,
        0,
        1,
      )
      // The package-local clip bends the hips and knees while the planted
      // feet remain on the terrain. Moving the outer root down as well applied
      // the crouch twice and pushed shoes below the ground before take-off.
      encounter.jumpOffsetMeters = 0
      if (progress >= 1) {
        encounter.jumpPhase = 'airborne'
        encounter.jumpPhaseElapsedSeconds = 0
        encounter.jumpOffsetMeters = 0
        if (this.renderer?.domElement) {
          this.renderer.domElement.dataset.scaleEncounterJump = 'airborne'
        }
      }
    } else if (encounter.jumpPhase === 'airborne') {
      const elapsed = encounter.jumpPhaseElapsedSeconds
      const apexHeight = MathUtils.clamp(
        encounter.profile.heightMeters * jumpPolicy.heightRatio,
        jumpPolicy.minimumHeightMeters,
        jumpPolicy.maximumHeightMeters,
      )
      const progress = MathUtils.clamp(
        elapsed / jumpPolicy.airborneSeconds,
        0,
        1,
      )
      encounter.jumpVelocityMetersPerSecond =
        ((4 * apexHeight) / jumpPolicy.airborneSeconds) *
        (1 - 2 * progress)
      encounter.jumpOffsetMeters =
        4 * apexHeight * progress * (1 - progress)
      if (progress >= 1) {
        encounter.jumpPhase = 'landing'
        encounter.jumpPhaseElapsedSeconds = 0
        encounter.jumpOffsetMeters = 0
        encounter.jumpVelocityMetersPerSecond = 0
        if (this.renderer?.domElement) {
          this.renderer.domElement.dataset.scaleEncounterJump = 'landing'
        }
      }
    } else if (encounter.jumpPhase === 'landing') {
      const progress = MathUtils.clamp(
        encounter.jumpPhaseElapsedSeconds /
          jumpPolicy.landingRecoverySeconds,
        0,
        1,
      )
      // Landing compression also belongs to the skeleton. The outer root
      // stays clamped to the sampled terrain throughout recovery.
      encounter.jumpOffsetMeters = 0
      if (progress >= 1) {
        encounter.jumpOffsetMeters = 0
        encounter.jumpVelocityMetersPerSecond = 0
        encounter.jumpActive = false
        encounter.jumpPhase = 'grounded'
        encounter.jumpPhaseElapsedSeconds = 0
        encounter.avatar.setActionState?.(
          'jump',
          false,
          encounter.jumpEntryMotion,
        )
        encounter.jumpEntryMotion = 'idle'
        if (this.renderer?.domElement) {
          this.renderer.domElement.dataset.scaleEncounterJump = 'grounded'
          delete this.renderer.domElement.dataset
            .scaleEncounterJumpEntryMotion
        }
      }
    }
    if (encounter.view === 'pov' && encounter.transition === null) {
      this.applyScaleEncounterPovPose()
    }
  }

  private updateScaleEncounterDistance(
    deltaSeconds: number,
    now: number,
  ): void {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.transition) return

    if (
      encounter.view === 'pov' &&
      encounter.definition.habitat === 'land' &&
      (encounter.distanceMotionDirection !== 0 ||
        encounter.orbitMotionDirection !== 0)
    ) {
      this.updateScaleEncounterLandHeldMotion(deltaSeconds, now)
      return
    }

    if (encounter.definition.habitat === 'land') {
      encounter.landMotionIntent =
        encounter.view === 'pov' &&
        Math.abs(
          encounter.targetObserverDistance - encounter.observerDistance,
        ) > 1e-7
          ? 'walk'
          : 'idle'
    }

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
          minimumScaleEncounterOverviewZoom(encounter.definition.id),
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
        encounter.observerDistance = clampScaleEncounterDistanceForProfile(
          encounter.placement,
          encounter.definition,
          encounter.profile,
          previous -
            heldDirection *
              SCALE_ENCOUNTER_DISTANCE_STEP[encounter.definition.habitat] *
              SCALE_ENCOUNTER_DISTANCE_HOLD_STEPS_PER_SECOND *
              (encounter.actionBoostMultiplier ?? 1) *
              deltaSeconds,
          encounter.orbitAngleRadians,
        )
        encounter.targetObserverDistance = encounter.observerDistance
      } else if (
        encounter.definition.habitat === 'land' &&
        encounter.targetObserverDistance !== previous
      ) {
        const currentWorldDirection =
          computeScaleEncounterOrbitedEyePosition(
            encounter.placement,
            'land',
            previous,
            encounter.orbitAngleRadians,
          )
            .sub(encounter.placement.orbitCenter)
            .setY(0)
            .normalize()
        const targetRadius = scaleEncounterLandRadiusAtDistance(
          encounter.placement,
          encounter.targetObserverDistance,
        )
        const previousRadius = scaleEncounterLandRadiusAtDistance(
          encounter.placement,
          previous,
        )
        const maximumWorldStep =
          SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND *
          Math.max(deltaSeconds, 0)
        const remainingRadius = targetRadius - previousRadius
        const nextRadius =
          previousRadius +
          Math.sign(remainingRadius) *
            Math.min(Math.abs(remainingRadius), maximumWorldStep)
        const minimumDistance = minimumScaleEncounterDistanceForProfile(
          encounter.placement,
          encounter.definition,
          encounter.profile,
          encounter.orbitAngleRadians,
        )
        const nextDistance = scaleEncounterLandDistanceForRadius(
          encounter.placement,
          nextRadius,
          minimumDistance,
          encounter.definition.maximumDistance,
        )
        encounter.observerDistance = nextDistance
        // The authored land rail points toward a reviewed head/detail target,
        // which is offset from the body-centred orbit pivot. Compensate that
        // changing rail bearing so a distance command follows one straight
        // world-space radial instead of drifting sideways around long animals.
        encounter.orbitAngleRadians =
          scaleEncounterLandOrbitAngleForWorldDirection(
            encounter.placement,
            nextDistance,
            encounter.orbitAngleRadians,
            currentWorldDirection,
          )
        encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
        if (Math.abs(remainingRadius) <= maximumWorldStep + 1e-8) {
          encounter.observerDistance = encounter.targetObserverDistance
          settled = true
        }
      } else {
        const alpha = 1 - Math.exp(
          -SCALE_ENCOUNTER_DISTANCE_EASING_PER_SECOND * deltaSeconds,
        )
        const easedDistanceStep =
          (encounter.targetObserverDistance - previous) * alpha
        const maximumDistanceStep =
          SCALE_ENCOUNTER_DISTANCE_STEP[encounter.definition.habitat] *
          SCALE_ENCOUNTER_DISTANCE_HOLD_STEPS_PER_SECOND *
          Math.max(deltaSeconds, 0)
        encounter.observerDistance =
          previous +
          MathUtils.clamp(
            easedDistanceStep,
            -maximumDistanceStep,
            maximumDistanceStep,
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

  /**
   * Integrates both axes as one normalised local-polar command. Small world
   * substeps are the swept equivalent used here: every segment is projected
   * onto the angle-dependent safe radius before the next segment begins, so a
   * long frame cannot penetrate and then trigger a large corrective snap.
   */
  private updateScaleEncounterLandHeldMotion(
    deltaSeconds: number,
    now: number,
  ): void {
    const encounter = this.scaleEncounter
    if (
      !encounter ||
      encounter.transition ||
      encounter.view !== 'pov' ||
      encounter.definition.habitat !== 'land'
    ) {
      return
    }
    const intent = resolveScaleEncounterLandInputIntent(
      encounter.distanceMotionDirection,
      encounter.orbitMotionDirection,
    )
    if (intent.motion === 'idle' || deltaSeconds <= 0) return
    encounter.landMotionIntent = intent.motion

    const travelSpeedMetersPerSecond = intent.speedMetersPerSecond

    const previousDistance = encounter.observerDistance
    const previousAngle = encounter.orbitAngleRadians
    const travelMeters = travelSpeedMetersPerSecond * deltaSeconds
    const substepCount = Math.max(
      1,
      Math.ceil(travelMeters / SCALE_ENCOUNTER_LAND_SWEEP_STEP_METERS),
    )
    const substepSeconds = deltaSeconds / substepCount
    const usesExpandedAnimalBounds =
      encounter.profile.approach === 'close' ||
      encounter.placement.animalId === 'apatosaurus'
    const collisionMarginMeters = Math.max(
      0.55,
      encounter.profile.heightMeters * 0.5,
    )
    const collisionMinimum = encounter.placement.animalBoundsMinimum
      .clone()
      .addScalar(-collisionMarginMeters)
    const collisionMaximum = encounter.placement.animalBoundsMaximum
      .clone()
      .addScalar(collisionMarginMeters)
    for (let step = 0; step < substepCount; step += 1) {
      const currentEye = computeScaleEncounterOrbitedEyePosition(
        encounter.placement,
        'land',
        encounter.observerDistance,
        encounter.orbitAngleRadians,
      ).setY(0)
      const outward = currentEye
        .clone()
        .sub(encounter.placement.orbitCenter)
        .setY(0)
        .normalize()
      const tangent = new Vector3(outward.z, 0, -outward.x)
      const nextEye = currentEye
        .clone()
        .addScaledVector(
          outward,
          -intent.radial * travelSpeedMetersPerSecond * substepSeconds,
        )
        .addScaledVector(
          tangent,
          intent.tangential * travelSpeedMetersPerSecond * substepSeconds,
        )
      if (usesExpandedAnimalBounds) {
        projectScaleEncounterLandPointOutsideBounds(
          nextEye,
          collisionMinimum,
          collisionMaximum,
        )
      }
      const nextOffset = nextEye
        .sub(encounter.placement.orbitCenter)
        .setY(0)
      const maximumRadius = scaleEncounterLandRadiusAtDistance(
        encounter.placement,
        encounter.definition.maximumDistance,
      )
      if (nextOffset.length() > maximumRadius) {
        nextOffset.setLength(maximumRadius)
      }
      const nextRadius = Math.max(nextOffset.length(), 0.001)
      const nextDirection = nextOffset.clone().divideScalar(nextRadius)
      let nextAngle = encounter.orbitAngleRadians
      let minimumDistance = minimumScaleEncounterDistanceForProfile(
        encounter.placement,
        encounter.definition,
        encounter.profile,
        nextAngle,
      )
      let nextDistance = scaleEncounterLandDistanceForRadius(
        encounter.placement,
        nextRadius,
        minimumDistance,
        encounter.definition.maximumDistance,
      )
      // Distance changes can rotate a head-targeted authored rail relative to
      // the body-centred pivot. Resolve distance and compensating angle
      // together so the requested Cartesian step is faithfully reconstructed.
      for (let iteration = 0; iteration < 2; iteration += 1) {
        nextAngle = scaleEncounterLandOrbitAngleForWorldDirection(
          encounter.placement,
          nextDistance,
          encounter.orbitAngleRadians,
          nextDirection,
        )
        minimumDistance = minimumScaleEncounterDistanceForProfile(
          encounter.placement,
          encounter.definition,
          encounter.profile,
          nextAngle,
        )
        nextDistance = scaleEncounterLandDistanceForRadius(
          encounter.placement,
          nextRadius,
          minimumDistance,
          encounter.definition.maximumDistance,
        )
      }
      encounter.orbitAngleRadians = nextAngle
      encounter.observerDistance = nextDistance
    }

    encounter.targetObserverDistance = encounter.observerDistance
    encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
    const changed =
      Math.abs(encounter.observerDistance - previousDistance) > 1e-7 ||
      Math.abs(encounter.orbitAngleRadians - previousAngle) > 1e-7
    if (!changed) return
    this.applyScaleEncounterPovPose()
    if (now - this.scaleEncounterDistanceSnapshotUpdatedAt >= 50) {
      this.scaleEncounterDistanceSnapshotUpdatedAt = now
      this.publishScaleEncounterSnapshot()
    }
  }

  private updateScaleEncounterOrbit(
    deltaSeconds: number,
    now: number,
  ): void {
    const encounter = this.scaleEncounter
    if (!encounter || encounter.transition || encounter.view !== 'pov') return
    if (
      encounter.definition.habitat === 'land' &&
      (encounter.distanceMotionDirection !== 0 ||
        encounter.orbitMotionDirection !== 0)
    ) {
      return
    }

    const previous = encounter.orbitAngleRadians
    const hasOrbitIntent =
      encounter.orbitMotionDirection !== 0 ||
      Math.abs(
        encounter.targetOrbitAngleRadians - encounter.orbitAngleRadians,
      ) > 0.0002
    if (
      encounter.definition.habitat === 'land' &&
      hasOrbitIntent
    ) {
      encounter.landMotionIntent = 'run'
    }
    const horizontalOrbitRadius = Math.max(
      encounter.avatar.eyeAnchor
        .getWorldPosition(new Vector3())
        .sub(encounter.placement.orbitCenter)
        .setY(0)
        .length(),
      0.001,
    )
    const maximumAngularStep =
      (scaleEncounterOrbitTravelSpeedMetersPerSecond(encounter.definition) /
        horizontalOrbitRadius) *
      (encounter.actionBoostMultiplier ?? 1) *
      Math.max(deltaSeconds, 0)
    let settled = false
    if (encounter.orbitMotionDirection !== 0) {
      encounter.orbitAngleRadians +=
        encounter.orbitMotionDirection * maximumAngularStep
      encounter.targetOrbitAngleRadians = encounter.orbitAngleRadians
    } else {
      const alpha =
        1 - Math.exp(-SCALE_ENCOUNTER_ORBIT_EASING_PER_SECOND * deltaSeconds)
      const easedAngularStep =
        (encounter.targetOrbitAngleRadians - previous) * alpha
      encounter.orbitAngleRadians =
        previous +
        MathUtils.clamp(
          easedAngularStep,
          -maximumAngularStep,
          maximumAngularStep,
        )
      if (
        Math.abs(
          encounter.orbitAngleRadians - encounter.targetOrbitAngleRadians,
        ) < 0.0002
      ) {
        encounter.orbitAngleRadians = encounter.targetOrbitAngleRadians
        settled = true
      }
    }

    if (Math.abs(encounter.orbitAngleRadians - previous) <= 1e-7) return
    encounter.observerDistance = clampScaleEncounterDistanceForProfile(
      encounter.placement,
      encounter.definition,
      encounter.profile,
      encounter.observerDistance,
      encounter.orbitAngleRadians,
    )
    encounter.targetObserverDistance = Math.max(
      encounter.targetObserverDistance,
      encounter.observerDistance,
    )
    this.applyScaleEncounterPovPose()
    if (
      settled ||
      now - this.scaleEncounterDistanceSnapshotUpdatedAt >= 50
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
    this.resetScaleEncounterContextAction()
    const captureDisposalEvidence =
      import.meta.env.MODE === 'e2e' || import.meta.env.MODE === 'review'
    const disposedEnvironmentRoot = encounter.environment?.root ?? null
    const disposedAvatarRoot = encounter.avatar.root
    const disposedSceneSemantic =
      encounter.environment?.sceneCandidateSemantic ?? 'legacy-environment'
    const disposedSceneVariant =
      encounter.environment?.sceneCandidateVariant ?? 'off'
    const rendererMemoryBeforeDisposal = captureDisposalEvidence
      ? {
          geometries: this.renderer.info.memory.geometries,
          textures: this.renderer.info.memory.textures,
        }
      : null
    encounter.transition?.resolve()
    encounter.transition = null
    encounter.mammothAnimalGrade?.restore()
    encounter.oceanAvatarGrade?.restore()
    encounter.oceanAnimalGrade?.restore()
    encounter.boostFlow?.dispose()
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
    this.scaleEncounterPreparedLandBiome = null
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
    this.resize()
    this.scaleEncounterSnapshot = INACTIVE_SCALE_ENCOUNTER_SNAPSHOT
    delete this.renderer.domElement.dataset.scaleEncounter
    delete this.renderer.domElement.dataset.scaleEncounterCameraStage
    delete this.renderer.domElement.dataset.scaleEncounterEnvironment
    delete this.renderer.domElement.dataset.scaleEncounterSceneCandidate
    delete this.renderer.domElement.dataset.scaleEncounterSceneSemantic
    delete this.renderer.domElement.dataset.scaleEncounterBoostFlow
    delete this.renderer.domElement.dataset.scaleEncounterBoostFlowIntensity
    delete this.renderer.domElement.dataset.scaleEncounterSubjectLighting
    delete this.renderer.domElement.dataset.scaleEncounterSubjectColour
    delete this.renderer.domElement.dataset.scaleEncounterProductionApproved
    delete this.renderer.domElement.dataset
      .scaleEncounterPrototypeFlightApproximation
    delete this.renderer.domElement.dataset
      .scaleEncounterPrototypeFlightApproximationLimitation
    delete this.renderer.domElement.dataset.scaleEncounterEcologyDensity
    delete this.renderer.domElement.dataset.scaleEncounterPerformance
    delete this.renderer.domElement.dataset.scaleEncounterPerformanceReady
    this.scaleEncounterDiagnosticsEnvironment = null
    this.scaleEncounterDiagnosticsUpdatedAt = Number.NEGATIVE_INFINITY
    delete this.renderer.domElement.dataset.scaleEncounterForestProps
    delete this.renderer.domElement.dataset.scaleEncounterAnimalId
    delete this.renderer.domElement.dataset.scaleEncounterDisplayedMeters
    delete this.renderer.domElement.dataset.scaleEncounterScaleConfidence
    delete this.renderer.domElement.dataset.scaleEncounterAvatarActiveClip
    delete this.renderer.domElement.dataset.scaleEncounterAvatarEquipment
    delete this.renderer.domElement.dataset.scaleEncounterAvatarHeading
    delete this.renderer.domElement.dataset.scaleEncounterAvatarMotion
    delete this.renderer.domElement.dataset.scaleEncounterAvatarOrientation
    delete this.renderer.domElement.dataset.scaleEncounterAvatarPose
    delete this.renderer.domElement.dataset
      .scaleEncounterAvatarSpeedMetersPerSecond
    delete this.renderer.domElement.dataset.scaleEncounterAvatarVariant
    delete this.renderer.domElement.dataset.scaleEncounterDistanceMeters
    delete this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters
    delete this.renderer.domElement.dataset.scaleEncounterMetersPerUnit
    delete this.renderer.domElement.dataset.scaleEncounterOrbitAngleDegrees
    delete this.renderer.domElement.dataset.scaleEncounterOverviewZoom
    delete this.renderer.domElement.dataset.scaleEncounterPerspective
    delete this.renderer.domElement.dataset.scaleEncounterRawSpanUnits
    delete this.renderer.domElement.dataset.scaleEncounterSubjectLayout
    delete this.renderer.domElement.dataset.scaleEncounterView
    this.emitScaleEncounterSnapshot()
    this.updateCameraLighting()
    this.renderer.render(this.scene, this.camera)
    if (captureDisposalEvidence) {
      this.renderer.domElement.dataset.scaleEncounterLastDisposal =
        JSON.stringify({
          avatarDetached:
            disposedAvatarRoot.parent === null &&
            this.scene.getObjectById(disposedAvatarRoot.id) === undefined,
          environmentDetached:
            disposedEnvironmentRoot === null ||
            (disposedEnvironmentRoot.parent === null &&
              this.scene.getObjectById(disposedEnvironmentRoot.id) ===
                undefined),
          rendererMemoryAfterDisposal: {
            geometries: this.renderer.info.memory.geometries,
            textures: this.renderer.info.memory.textures,
          },
          rendererMemoryBeforeDisposal,
          sceneSemantic: disposedSceneSemantic,
          sceneVariant: disposedSceneVariant,
        })
    }
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

  /**
   * Renders and exports the current transparent WebGL frame for the headed
   * review-browser preview workflow. Capturing immediately after render avoids
   * losing the drawing buffer when preserveDrawingBuffer remains disabled in
   * the normal interactive viewer.
   */
  captureReviewFramePng(): string | null {
    if (
      import.meta.env.MODE !== 'review' &&
      import.meta.env.MODE !== 'model-still' &&
      import.meta.env.MODE !== 'e2e'
    ) {
      return null
    }
    const current = this.current
    if (!current) {
      return null
    }
    current.modelRoot.updateMatrixWorld(true)
    this.renderer.render(this.scene, this.camera)
    return this.renderer.domElement.toDataURL('image/png')
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
    const mammothLayeredDepthOnUltraWide =
      this.scaleEncounter?.definition?.environmentTheme === 'glacier' &&
      (this.scaleEncounterSceneCandidateVariant === 'C' ||
        this.scaleEncounterSceneCandidateVariant === 'E') &&
      width >= 2_400
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      mammothLayeredDepthOnUltraWide ? 1.5 : 2,
    )
    this.renderer.setPixelRatio(pixelRatio)
    if (this.renderer.domElement?.dataset) {
      this.renderer.domElement.dataset.scaleEncounterRenderPixelRatio =
        pixelRatio.toFixed(2)
    }
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
        const orbitReturn = transition.orbitReturn
        const returningAvatarPosition = orbitReturn
          ? this.scaleEncounter.avatar.root.position.clone()
          : null
        const returningAvatarQuaternion = orbitReturn
          ? this.scaleEncounter.avatar.root.quaternion.clone()
          : null
        const returningOrbitAngle = this.scaleEncounter.orbitAngleRadians
        const returningObserverDistance =
          this.scaleEncounter.observerDistance
        if (orbitReturn && transition.targetView === 'overview') {
          // During the first return phase the live camera and hidden child are
          // still circling back from the far side. Refit the destination from
          // the canonical child position, otherwise a mobile resize would
          // rewrite the last keyframe around the temporary rear-side layout
          // and cause a snap when the overview completes.
          this.scaleEncounter.orbitAngleRadians = 0
          this.scaleEncounter.observerDistance =
            this.scaleEncounter.definition.defaultDistance
          this.scaleEncounter.avatar.root.rotation.y =
            this.scaleEncounter.avatarBaseYawRadians
          this.placeScaleEncounterAvatarEyeAt(
            this.scaleEncounter.avatar,
            this.computeScaleEncounterObserverEyePosition(
              this.scaleEncounter.placement,
              this.scaleEncounter.definition,
              this.scaleEncounter.definition.defaultDistance,
              0,
            ),
          )
        }
        const finalPose = this.computeScaleEncounterCameraPose(
          transition.targetView,
        )
        if (
          returningAvatarPosition &&
          returningAvatarQuaternion &&
          orbitReturn
        ) {
          this.scaleEncounter.orbitAngleRadians = returningOrbitAngle
          this.scaleEncounter.observerDistance = returningObserverDistance
          this.scaleEncounter.avatar.root.position.copy(returningAvatarPosition)
          this.scaleEncounter.avatar.root.quaternion.copy(
            returningAvatarQuaternion,
          )
          this.scaleEncounter.avatar.root.updateMatrixWorld(true)
        }
        const finalKeyframe = transition.keyframes.at(-1)
        if (finalKeyframe) {
          this.scaleEncounter.transition = {
            ...transition,
            keyframes: [
              ...transition.keyframes.slice(0, -1),
              {
                at: 1,
                cameraStage: scaleEncounterFinalCameraStage(
                  this.scaleEncounter.definition,
                  transition.targetView,
                  this.scaleEncounter.perspective,
                ),
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
      sceneEnvironment: this.scene.environment,
      sceneEnvironmentIntensity: this.scene.environmentIntensity,
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
    // The exhibit package owns the canonical left/right presentation. Never
    // let a comparison-specific yaw (or a stale quaternion captured during a
    // rapid close) survive into the exhibit or its subsequent focus mode.
    // This is especially visible on the side-on Dilophosaurus silhouette.
    current.modelRoot.rotation.set(
      0,
      MathUtils.degToRad(current.descriptor.presentation.initialYawDegrees),
      0,
    )
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
    this.scene.environment = saved.sceneEnvironment
    this.scene.environmentIntensity = saved.sceneEnvironmentIntensity
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

  private computeScaleEncounterObserverEyePosition(
    placement: ScaleEncounterPlacement,
    definition: ScaleEncounterDefinition,
    distance: number,
    orbitAngleRadians: number,
    result = new Vector3(),
  ): Vector3 {
    computeScaleEncounterOrbitedEyePosition(
      placement,
      definition.habitat,
      distance,
      orbitAngleRadians,
      result,
    )
    const groundHeightAtWorld =
      this.scaleEncounter?.environment?.groundHeightAtWorld
    if (definition.habitat === 'land' && groundHeightAtWorld) {
      result.y =
        groundHeightAtWorld(result.x, result.z) +
        Math.max(
          placement.defaultEyePosition.y,
          SCALE_ENCOUNTER_GROUNDED_CAMERA_MINIMUM_HEIGHT,
        )
    }
    if (definition.habitat === 'land') {
      result.y += this.scaleEncounter?.jumpOffsetMeters ?? 0
    }
    return result
  }

  private scaleEncounterCameraFarMeters(): number {
    return this.scaleEncounter?.environment?.cameraFarMeters ?? 240
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
    this.camera.far = this.scaleEncounterCameraFarMeters()
    this.camera.updateProjectionMatrix()
    canvas.dataset.scaleEncounterReviewOrbit = `${heightMode}:${azimuthDegrees.toFixed(0)}`
  }

  private createScaleEncounterTransitionKeyframes(
    targetView: ScaleEncounterView,
    orbitReturnEndAt = 0,
    orbitReturnHoldEndAt = orbitReturnEndAt,
  ): readonly ScaleEncounterCameraKeyframe[] {
    const encounter = this.scaleEncounter
    if (!encounter) return []
    const activeCameraStage = scaleEncounterFinalCameraStage(
      encounter.definition,
      'pov',
      encounter.perspective,
    )

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
      if (orbitReturnEndAt > 0) {
        const povOrigin = this.computeScaleEncounterCameraPose('pov')
        const rearAt =
          orbitReturnHoldEndAt + (1 - orbitReturnHoldEndAt) * 0.32
        return [
          start,
          {
            at: orbitReturnEndAt,
            cameraStage: activeCameraStage,
            ...povOrigin,
          },
          {
            at: orbitReturnHoldEndAt,
            cameraStage: activeCameraStage,
            ...povOrigin,
          },
          {
            at: rearAt,
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
    const showcaseFieldOfView = 48
    const showcaseSphere = childBounds.getBoundingSphere(new Sphere())
    const showcaseVerticalFieldOfView = MathUtils.degToRad(
      showcaseFieldOfView,
    )
    const showcaseHorizontalFieldOfView =
      2 *
      Math.atan(
        Math.tan(showcaseVerticalFieldOfView / 2) * this.camera.aspect,
      )
    const showcaseLimitingFieldOfView = Math.max(
      0.2,
      Math.min(
        showcaseVerticalFieldOfView,
        showcaseHorizontalFieldOfView,
      ),
    )
    const showcaseDistance =
      (showcaseSphere.radius /
        Math.sin(showcaseLimitingFieldOfView / 2)) *
      1.28
    const showcaseDirection =
      encounter.definition.habitat === 'land'
        ? encounter.definition.overviewDirection.clone().normalize()
        : encounter.definition.habitat === 'air'
          // Keep the flight-equipment reveal on the same rear/upper axis as
          // the preceding establishing pose. The former child-right vector
          // orbited to a side profile immediately after the narration asked
          // the family to look from behind.
          ? behind.clone().addScaledVector(WORLD_UP, 0.34).normalize()
          : childRight.clone().addScaledVector(WORLD_UP, 0.12).normalize()
    const showcasePose = this.createScaleEncounterCameraPose(
      showcaseSphere.center
        .clone()
        .addScaledVector(showcaseDirection, showcaseDistance),
      showcaseSphere.center,
      showcaseFieldOfView,
    )
    // The water establishing pose and the fitted showcase were two slightly
    // different side views. On a narrow phone that 0.8 m correction read as
    // an unintended orbit: the camera appeared to reach the child's
    // rear-quarter first, then slide back to the requested side. Enter the
    // final fitted side view directly and hold it for the narration beat.
    const transitionEstablishingPose =
      encounter.definition.habitat === 'water'
        ? showcasePose
        : establishingPose
    const waterStartFocusTarget = (() => {
      if (encounter.definition.habitat !== 'water') return null
      const startForward = new Vector3(0, 0, -1)
        .applyQuaternion(start.quaternion)
        .normalize()
      const distanceAlongStartView = Math.max(
        1,
        childCentre.clone().sub(start.position).dot(startForward),
      )
      return start.position
        .clone()
        .addScaledVector(startForward, distanceAlongStartView)
    })()
    const transitionStart = waterStartFocusTarget
      ? { ...start, focusTarget: waterStartFocusTarget }
      : start
    const waterSideFocus =
      encounter.definition.habitat === 'water'
        ? showcaseSphere.center.clone()
        : undefined
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
    // The 22%-duration plateau is an explicit full-body gate before the
    // camera moves behind the child and enters their eyes. It is fitted from
    // the current dynamic Avatar bounds, so future outfit/pose bounds can
    // trigger the required regression without copying a scene-specific size.
    const timing = [0.08, 0.14, 0.18, 0.4, 0.56, 0.64, 0.95] as const
    const establishingStage =
      encounter.definition.habitat === 'air'
        ? 'rear-establishing'
        : 'side-establishing'
    // Every guided encounter now finishes at the child's eyes. The rear pose
    // remains a short, readable bridge through the avatar, never the default
    // destination for land animals.
    return [
      transitionStart,
      {
        at: timing[0],
        cameraStage: establishingStage,
        ...(waterSideFocus ? { focusTarget: waterSideFocus } : {}),
        ...transitionEstablishingPose,
      },
      {
        at: timing[1],
        cameraStage: establishingStage,
        ...(waterSideFocus ? { focusTarget: waterSideFocus } : {}),
        ...transitionEstablishingPose,
      },
      {
        at: timing[2],
        cameraStage: 'full-body-showcase',
        ...(waterSideFocus ? { focusTarget: waterSideFocus } : {}),
        ...showcasePose,
      },
      {
        at: timing[3],
        cameraStage: 'full-body-showcase',
        ...(waterSideFocus ? { focusTarget: waterSideFocus } : {}),
        ...showcasePose,
      },
      {
        at: timing[4],
        cameraStage: 'child-rear',
        ...rearPose,
      },
      {
        at: timing[5],
        cameraStage: 'child-rear',
        ...rearPose,
      },
      {
        at: timing[6],
        cameraStage: 'eye-entry',
        ...eyeEntryPose,
      },
      {
        at: 1,
        cameraStage: activeCameraStage,
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
    let cameraUp = WORLD_UP
    if (view === 'pov') {
      const eyePosition = this.computeScaleEncounterObserverEyePosition(
        encounter.placement,
        encounter.definition,
        encounter.observerDistance,
        encounter.orbitAngleRadians,
      )
      const perspective =
        encounter.perspective ??
        defaultScaleEncounterPerspective()
      if (
        perspective === 'child-rear' &&
        encounter.definition.habitat === 'land'
      ) {
        const radial = eyePosition
          .clone()
          .sub(encounter.placement.orbitCenter)
          .setY(0)
        if (radial.lengthSq() < 1e-8) radial.set(0, 0, 1)
        radial.normalize()
        const tangent = new Vector3(-radial.z, 0, radial.x)
        const groundHeightAtWorld =
          encounter.environment?.groundHeightAtWorld
        if (encounter.profile.approach === 'close') {
          // Close approach is also the keepsake/check-in composition. Keep
          // the camera just behind the child and aim through their nearby
          // position toward the animal's body. The comfortable rear camera
          // deliberately surveys the whole clearing from much farther back;
          // reusing it here drops a close child below the phone controls.
          const childHeight = Math.max(encounter.profile.heightMeters, 0.9)
          position = eyePosition
            .clone()
            .addScaledVector(radial, 3.2 * childHeight)
            .addScaledVector(tangent, -0.42 * childHeight)
          position.y =
            (groundHeightAtWorld?.(position.x, position.z) ?? 0) +
            1.95 * childHeight
          target = eyePosition
            .clone()
            .addScaledVector(radial, -1.45 * childHeight)
          target.y =
            (groundHeightAtWorld?.(target.x, target.z) ?? 0) +
            0.95 * childHeight
          fieldOfView = 58
          return this.createScaleEncounterCameraPose(
            position,
            target,
            fieldOfView,
            cameraUp,
          )
        }
        const follow = encounter.definition.environmentTheme === 'glacier'
          ? {
              behind: 8.25,
              fieldOfView: 50,
              side: 1.8,
              targetHeight: 1.2,
              targetRadial: 3,
              up: 4.25,
            }
          : {
              behind: 8.35,
              fieldOfView: 49,
              side: 0.85,
              targetHeight: 1.9,
              targetRadial: 1.55,
              up: 4.75,
            }
        position = eyePosition
          .clone()
          .addScaledVector(radial, follow.behind)
          .addScaledVector(tangent, -follow.side)
        position.y =
          (groundHeightAtWorld?.(position.x, position.z) ?? 0) + follow.up
        target = encounter.placement.orbitCenter
          .clone()
          .addScaledVector(radial, follow.targetRadial)
        target.y =
          (groundHeightAtWorld?.(
            encounter.placement.orbitCenter.x,
            encounter.placement.orbitCenter.z,
          ) ?? 0) + follow.targetHeight
        fieldOfView = follow.fieldOfView
      } else if (perspective === 'child-rear') {
        const forward = encounter.placement.target
          .clone()
          .sub(eyePosition)
          .normalize()
        const horizontalForward = forward.clone().setY(0)
        if (horizontalForward.lengthSq() < 1e-8) {
          horizontalForward.set(0, 0, -1)
        }
        horizontalForward.normalize()
        const right = horizontalForward.clone().cross(WORLD_UP).normalize()
        const behind = forward.clone().multiplyScalar(-1)
        const childHeight = Math.max(encounter.profile.heightMeters, 0.9)
        const follow =
          encounter.definition.habitat === 'air'
            ? { behind: 3.15, fieldOfView: 58, side: 0.18, up: 1.05 }
            : { behind: 2.85, fieldOfView: 56, side: 0.28, up: 0.62 }
        position = eyePosition
          .clone()
          .addScaledVector(behind, follow.behind * childHeight)
          .addScaledVector(right, follow.side * childHeight)
          .addScaledVector(WORLD_UP, follow.up * childHeight)
        target = encounter.placement.target.clone()
        fieldOfView = follow.fieldOfView
      } else {
        fieldOfView = encounter.definition.povFieldOfView
        position = eyePosition
        target = computeScaleEncounterOrbitedGazeTarget(
          encounter.placement,
          encounter.orbitAngleRadians,
        )
      }
    } else {
      const overviewAxes = scaleEncounterOverviewAxes(
        encounter.definition,
        this.camera.aspect,
        encounter.orbitAngleRadians,
      )
      cameraUp = overviewAxes.up
      this.renderer.domElement.dataset.scaleEncounterSubjectLayout =
        overviewAxes.layout
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
        encounter.definition.environmentTheme === 'forest' && narrowOverview
          ? computeScaleEncounterOverviewFieldOfView(
              baseFieldOfView,
              SCALE_ENCOUNTER_OVERVIEW_SAFE_FIT_ZOOM,
            )
          : encounter.definition.environmentTheme === 'glacier' && narrowOverview
            ? computeMammothOverviewFittingFieldOfView(
                baseFieldOfView,
                this.camera.aspect,
              )
          : baseFieldOfView
      const verticalFieldOfView = MathUtils.degToRad(fittingFieldOfView)
      const horizontalFieldOfView =
        2 * Math.atan(Math.tan(verticalFieldOfView / 2) * this.camera.aspect)
      const limitingFieldOfView = Math.max(
        0.2,
        Math.min(verticalFieldOfView, horizontalFieldOfView),
      )
      const distance =
        (sphere.radius / Math.sin(limitingFieldOfView / 2)) *
        scaleEncounterOverviewDistanceFactor(
          encounter.definition,
          this.camera.aspect,
          overviewAxes.layout,
        )
      target = sphere.center.clone()
      if (encounter.definition.id === 'tyrannosaurus-rex') {
        const portrait = narrowOverview
        target.y += sphere.radius * (portrait ? -0.008 : 0.055)
      }
      position = target
        .clone()
        .addScaledVector(overviewAxes.direction, distance)
      const narrowOverviewYaw = scaleEncounterNarrowOverviewYaw(
        encounter.definition.id,
        this.camera.aspect,
      )
      if (narrowOverviewYaw !== 0) {
        // A portrait frame cannot keep a true-scale child readable when the
        // observation rail remains the horizontal screen axis. Turn the
        // opening camera toward that rail so depth carries more of the gap;
        // the animal and child stay at their real positions and scale.
        const offset = position.clone().sub(target)
        const azimuth =
          Math.atan2(offset.z, offset.x) + narrowOverviewYaw
        const horizontalDistance = Math.hypot(offset.x, offset.z)
        offset.x = Math.cos(azimuth) * horizontalDistance
        offset.z = Math.sin(azimuth) * horizontalDistance
        position.copy(target).add(offset)
      }
      if (
        encounter.definition.id === 'tyrannosaurus-rex' &&
        narrowOverview
      ) {
        target.y += sphere.radius * 0.006
      }
    }

    return this.createScaleEncounterCameraPose(
      position,
      target,
      fieldOfView,
      cameraUp,
    )
  }

  private updateScaleEncounterAvatarMotion(deltaSeconds: number): void {
    const encounter = this.scaleEncounter
    if (!encounter) return

    const eyePosition = encounter.avatar.eyeAnchor.getWorldPosition(
      new Vector3(),
    )
    const travelDirection = eyePosition
      .clone()
      .sub(encounter.avatarPreviousEyePosition)
    // Land locomotion is measured along the ground plane. Jump/crouch camera
    // height and terrain undulation must not be misclassified as forward run
    // speed, otherwise a standing jump can resume into a run clip and a
    // walking jump can change gait during landing.
    if (encounter.definition.habitat === 'land') {
      travelDirection.y = 0
    }
    const measuredSpeedMetersPerSecond =
      encounter.view === 'pov' && deltaSeconds > 0
        ? travelDirection.length() / deltaSeconds
        : 0
    const speedMetersPerSecond = Number.isFinite(measuredSpeedMetersPerSecond)
      ? measuredSpeedMetersPerSecond
      : 0
    const moving = speedMetersPerSecond > 0.02
    const observationYawRadians =
      encounter.avatarBaseYawRadians + encounter.orbitAngleRadians
    const targetQuaternion = computeScaleEncounterAvatarTravelQuaternion(
      moving ? travelDirection : new Vector3(),
      encounter.definition.habitat,
      observationYawRadians,
    )

    if (encounter.view === 'overview' || this.reducedMotion) {
      encounter.avatar.root.quaternion.copy(targetQuaternion)
    } else {
      encounter.avatar.root.quaternion.slerp(
        targetQuaternion,
        1 -
          Math.exp(
            -(moving
              ? SCALE_ENCOUNTER_AVATAR_MOVING_HEADING_EASING_PER_SECOND
              : SCALE_ENCOUNTER_AVATAR_IDLE_HEADING_EASING_PER_SECOND) *
              deltaSeconds,
          ),
      )
    }
    // Rotating an asymmetric rig moves its nested eye anchor. Keep the
    // observer at the already-resolved world-space position after heading it
    // along the measured travel vector.
    this.placeScaleEncounterAvatarEyeAt(encounter.avatar, eyePosition)
    encounter.avatarPreviousEyePosition.copy(eyePosition)
    let motionKind = scaleEncounterAvatarMotionFor(
      encounter.definition.id,
      speedMetersPerSecond,
    )
    if (encounter.definition.habitat === 'land') {
      motionKind =
        encounter.view !== 'pov'
          ? 'idle'
          : (encounter.landMotionIntent ?? 'idle')
    }
    const motionState = {
      kind: motionKind,
      speedMetersPerSecond,
    }
    encounter.avatar.setMotionState?.(motionState)
    encounter.avatar.root.userData.scaleEncounterAvatarMotion =
      motionState.kind
    encounter.avatar.root.userData.scaleEncounterAvatarTravelSpeed =
      motionState.speedMetersPerSecond
  }

  private scaleEncounterRiverVisitor(): RiverVisitor | null {
    const encounter = this.scaleEncounter
    const heightAt = encounter?.environment?.groundHeightAtWorld
    if (!encounter || !heightAt || encounter.definition.habitat !== 'land'
      || encounter.view !== 'pov' || encounter.transition) return null
    // Read locomotion coordinates, not the rig's breathing/head sway.
    const { x, z } = computeScaleEncounterOrbitedEyePosition(
      encounter.placement, 'land', encounter.observerDistance, encounter.orbitAngleRadians,
    )
    return {
      x, z,
      feetY: heightAt(x, z) + encounter.jumpOffsetMeters,
      heightMeters: encounter.profile.heightMeters,
      verticalVelocity: encounter.jumpVelocityMetersPerSecond,
      airborne: encounter.jumpPhase === 'airborne',
    }
  }

  private publishScaleEncounterAvatarMotionDiagnostics(): void {
    const encounter = this.scaleEncounter
    if (!encounter) return
    const canvas = this.renderer.domElement
    const avatarUserData = encounter.avatar.root.userData as Record<
      string,
      unknown
    >
    const motion = avatarUserData.scaleEncounterAvatarMotion
    const activeClip = avatarUserData.scaleEncounterAvatarActiveClip
    const speed = Number(avatarUserData.scaleEncounterAvatarTravelSpeed)
    const heading = new Vector3(1, 0, 0)
      .applyQuaternion(
        encounter.avatar.root.getWorldQuaternion(
          encounter.avatar.root.quaternion.clone(),
        ),
      )
      .normalize()

    if (typeof motion === 'string') {
      canvas.dataset.scaleEncounterAvatarMotion = motion
    } else {
      delete canvas.dataset.scaleEncounterAvatarMotion
    }
    if (typeof activeClip === 'string') {
      canvas.dataset.scaleEncounterAvatarActiveClip = activeClip
    } else {
      delete canvas.dataset.scaleEncounterAvatarActiveClip
    }
    canvas.dataset.scaleEncounterAvatarSpeedMetersPerSecond = Number.isFinite(
      speed,
    )
      ? speed.toFixed(3)
      : '0.000'
    canvas.dataset.scaleEncounterAvatarHeading = heading
      .toArray()
      .map((component) => component.toFixed(6))
      .join(',')
  }

  private applyScaleEncounterOverviewPose(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    encounter.avatar.root.rotation.y =
      encounter.avatarBaseYawRadians + encounter.orbitAngleRadians
    this.placeScaleEncounterAvatarEyeAt(
      encounter.avatar,
      this.computeScaleEncounterObserverEyePosition(
        encounter.placement,
        encounter.definition,
        encounter.observerDistance,
        encounter.orbitAngleRadians,
      ),
    )
    const pose = this.computeScaleEncounterCameraPose('overview')
    if (
      this.current &&
      (import.meta.env.MODE === 'development' ||
        import.meta.env.MODE === 'e2e' ||
        import.meta.env.MODE === 'review')
    ) {
      const modelBounds = new Box3().setFromObject(
        this.current.modelRoot,
        true,
      )
      const avatarBounds = new Box3().setFromObject(
        encounter.avatar.root,
        true,
      )
      this.renderer.domElement.dataset.scaleEncounterReviewOverviewGeometry =
        JSON.stringify({
          animal: {
            max: modelBounds.max.toArray(),
            min: modelBounds.min.toArray(),
          },
          avatar: {
            max: avatarBounds.max.toArray(),
            min: avatarBounds.min.toArray(),
            rootScale: encounter.avatar.root.scale.toArray(),
            visualScale: encounter.avatar.visual.scale.toArray(),
            animationTranslationScale:
              encounter.avatar.root.userData
                .scaleEncounterAvatarAnimationTranslationScale as unknown,
            rigTranslationScale:
              encounter.avatar.root.userData
                .scaleEncounterAvatarRigTranslationScale as unknown,
            authoredRootScale: encounter.avatar.visual
              .getObjectByName('ChildAvatarV4Root')
              ?.scale.toArray(),
            armatureScale: encounter.avatar.visual
              .getObjectByName('Armature')
              ?.scale.toArray(),
            hipsPosition: encounter.avatar.visual
              .getObjectByName('Hips')
              ?.position.toArray(),
          },
          camera: {
            aspect: this.camera.aspect,
            fieldOfView: pose.fieldOfView,
            position: pose.position.toArray(),
            quaternion: pose.quaternion.toArray(),
          },
        })
    }
    encounter.avatar.root.visible = true
    this.camera.clearViewOffset()
    this.camera.position.copy(pose.position)
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.up.copy(
      scaleEncounterOverviewAxes(
        encounter.definition,
        this.camera.aspect,
        encounter.orbitAngleRadians,
      ).up,
    )
    this.camera.fov = pose.fieldOfView
    this.camera.near = 0.03
    this.camera.far = this.scaleEncounterCameraFarMeters()
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(
      new Box3()
        .setFromObject(this.current?.modelRoot ?? encounter.avatar.root, true)
        .union(new Box3().setFromObject(encounter.avatar.root, true))
        .getCenter(new Vector3()),
    )
    if (this.current) {
      syncScaleEncounterGroundContacts(
        encounter.environment,
        this.current.modelRoot,
        encounter.avatar.root,
      )
    }
  }

  private applyScaleEncounterPovPose(): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    const eyePosition = this.computeScaleEncounterObserverEyePosition(
      encounter.placement,
      encounter.definition,
      encounter.observerDistance,
      encounter.orbitAngleRadians,
    )
    this.placeScaleEncounterAvatarEyeAt(encounter.avatar, eyePosition)
    const pose = this.computeScaleEncounterCameraPose('pov')
    this.camera.clearViewOffset()
    this.camera.position.copy(pose.position)
    this.camera.quaternion.copy(pose.quaternion)
    this.camera.up.copy(WORLD_UP)
    this.camera.fov = pose.fieldOfView
    this.camera.near = 0.03
    this.camera.far = this.scaleEncounterCameraFarMeters()
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(
      computeScaleEncounterOrbitedGazeTarget(
        encounter.placement,
        encounter.orbitAngleRadians,
      ),
    )
    encounter.avatar.root.visible =
      encounter.perspective === 'child-rear' || encounter.view !== 'pov'
    if (this.current) {
      syncScaleEncounterGroundContacts(
        encounter.environment,
        this.current.modelRoot,
        encounter.avatar.root,
      )
    }
  }

  private completeScaleEncounterView(targetView: ScaleEncounterView): void {
    const encounter = this.scaleEncounter
    if (!encounter) {
      return
    }
    encounter.transition = null
    encounter.view = targetView
    encounter.cameraStage = scaleEncounterFinalCameraStage(
      encounter.definition,
      targetView,
      encounter.perspective,
    )
    if (targetView === 'pov') {
      this.applyScaleEncounterPovPose()
      encounter.avatar.root.visible =
        encounter.perspective === 'child-rear'
    } else {
      encounter.perspective = defaultScaleEncounterPerspective()
      encounter.observerDistance = encounter.definition.defaultDistance
      encounter.targetObserverDistance = encounter.definition.defaultDistance
      encounter.orbitAngleRadians = 0
      encounter.targetOrbitAngleRadians = 0
      this.applyScaleEncounterOverviewPose()
      encounter.avatar.root.visible = true
    }
    this.renderer.domElement.dataset.scaleEncounterCameraStage =
      encounter.cameraStage
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
    const orbitReturn = transition.orbitReturn
    if (orbitReturn && linearProgress <= orbitReturn.endAt) {
      const orbitLinearProgress = clampScaleEncounterValue(
        linearProgress / Math.max(orbitReturn.endAt, 0.0001),
        0,
        1,
      )
      const orbitProgress = smoothStep(orbitLinearProgress)
      encounter.orbitAngleRadians = MathUtils.lerp(
        orbitReturn.startAngleRadians,
        0,
        orbitProgress,
      )
      encounter.observerDistance = MathUtils.lerp(
        orbitReturn.startDistance,
        encounter.definition.defaultDistance,
        orbitProgress,
      )
      const eyePosition = this.computeScaleEncounterObserverEyePosition(
        encounter.placement,
        encounter.definition,
        encounter.observerDistance,
        encounter.orbitAngleRadians,
      )
      this.placeScaleEncounterAvatarEyeAt(encounter.avatar, eyePosition)
      encounter.avatar.root.visible =
        encounter.perspective === 'child-rear'
      const orbitPose = this.computeScaleEncounterCameraPose('pov')
      this.camera.position.copy(orbitPose.position)
      this.camera.quaternion.copy(orbitPose.quaternion)
      this.camera.up.copy(WORLD_UP)
      this.controls.target.copy(encounter.placement.target)
      this.camera.fov = MathUtils.lerp(
        transition.keyframes[0]?.fieldOfView ??
          orbitPose.fieldOfView,
        orbitPose.fieldOfView,
        orbitProgress,
      )
      this.camera.updateProjectionMatrix()
      const orbitAngleDegrees =
        ((MathUtils.radToDeg(encounter.orbitAngleRadians) % 360) + 360) %
        360
      // Keep renderer telemetry frame-accurate without forcing React to
      // re-render at animation frequency. This also makes the two return
      // phases observable to the hardware interaction gate.
      this.renderer.domElement.dataset.scaleEncounterDistanceMeters =
        encounter.observerDistance.toFixed(3)
      this.renderer.domElement.dataset.scaleEncounterOrbitAngleDegrees =
        orbitAngleDegrees.toFixed(2)
      const activeCameraStage = scaleEncounterFinalCameraStage(
        encounter.definition,
        'pov',
        encounter.perspective,
      )
      if (encounter.cameraStage !== activeCameraStage) {
        encounter.cameraStage = activeCameraStage
        this.renderer.domElement.dataset.scaleEncounterCameraStage =
          activeCameraStage
      }
      if (
        orbitLinearProgress >= 1 ||
        now - this.scaleEncounterDistanceSnapshotUpdatedAt >= 50
      ) {
        this.scaleEncounterDistanceSnapshotUpdatedAt = now
        this.publishScaleEncounterSnapshot()
      }
      if (linearProgress < orbitReturn.endAt) {
        return
      }
    }
    if (
      orbitReturn &&
      linearProgress > orbitReturn.endAt &&
      (Math.abs(encounter.orbitAngleRadians) > 1e-8 ||
        Math.abs(
          encounter.observerDistance - encounter.definition.defaultDistance,
        ) > 1e-8)
    ) {
      // Floating-point rounding can put the first post-orbit frame a few
      // ulps beyond `endAt`. Canonicalise the child before the authored rear
      // and overview keyframes take over so neither the avatar nor a later
      // resize remains stranded halfway around the animal.
      encounter.orbitAngleRadians = 0
      encounter.observerDistance = encounter.definition.defaultDistance
      this.placeScaleEncounterAvatarEyeAt(
        encounter.avatar,
        this.computeScaleEncounterObserverEyePosition(
          encounter.placement,
          encounter.definition,
          encounter.definition.defaultDistance,
          0,
        ),
      )
    }
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
    if (from.focusTarget && to.focusTarget) {
      // Interpolating position and quaternion independently made the mobile
      // ocean lens look past the child halfway through the opening move. The
      // camera then appeared to visit the rear quarter before correcting to
      // the side. Track the authored world-space focus during this segment so
      // the child remains on the same direct visual path.
      this.controls.target.lerpVectors(
        from.focusTarget,
        to.focusTarget,
        progress,
      )
      this.camera.up.copy(WORLD_UP)
      this.camera.lookAt(this.controls.target)
    } else {
      this.camera.quaternion.slerpQuaternions(
        from.quaternion,
        to.quaternion,
        progress,
      )
    }
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
      const targetPerspective =
        transition.targetPerspective ?? encounter.perspective
      encounter.avatar.root.visible =
        targetPerspective === 'child-rear'
          ? transition.targetPerspective
            ? linearProgress >= 0.52
            : true
          : transition.targetPerspective
            ? linearProgress < 0.76
            : cameraStage !== 'eye-entry' && cameraStage !== 'pov'
    } else if (transition.targetView === 'overview') {
      // Keep the avatar hidden while the camera is still occupying or
      // returning to the child's eyes. Reveal it only once the lens has moved
      // into the third-person rear stage.
      encounter.avatar.root.visible =
        encounter.perspective === 'child-rear' || cameraStage !== 'pov'
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
    const orbitAngleDegrees =
      ((MathUtils.radToDeg(encounter.orbitAngleRadians) % 360) + 360) % 360
    this.scaleEncounterSnapshot = {
      active: true,
      animalId: encounter.definition.id,
      cameraStage: encounter.cameraStage,
      perspective: encounter.perspective,
      view: encounter.view,
      transitioning: encounter.transition !== null,
      distanceMeters: encounter.observerDistance,
      orbitAngleDegrees,
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
    const avatarUserData = encounter.avatar.root.userData as Record<
      string,
      unknown
    >
    const avatarEquipment =
      avatarUserData.scaleEncounterAvatarEquipment
    const avatarPose = avatarUserData.scaleEncounterAvatarPose
    if (typeof avatarEquipment === 'string') {
      this.renderer.domElement.dataset.scaleEncounterAvatarEquipment =
        avatarEquipment
    } else {
      delete this.renderer.domElement.dataset.scaleEncounterAvatarEquipment
    }
    if (typeof avatarPose === 'string') {
      this.renderer.domElement.dataset.scaleEncounterAvatarPose = avatarPose
    } else {
      delete this.renderer.domElement.dataset.scaleEncounterAvatarPose
    }
    if (encounter.avatar.bodyOrientation) {
      this.renderer.domElement.dataset.scaleEncounterAvatarOrientation =
        encounter.avatar.bodyOrientation
    } else {
      delete this.renderer.domElement.dataset.scaleEncounterAvatarOrientation
    }
    if (encounter.view === 'pov') {
      const eyeHeight =
        encounter.perspective === 'child-rear'
          ? encounter.avatar.eyeAnchor.getWorldPosition(new Vector3()).y
          : encounter.cameraStage === 'pov'
            ? this.camera.position.y
            : null
      if (eyeHeight !== null) {
        this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters =
          eyeHeight.toFixed(6)
      } else {
        delete this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters
      }
    } else {
      delete this.renderer.domElement.dataset.scaleEncounterEyeHeightMeters
    }
    this.renderer.domElement.dataset.scaleEncounterMetersPerUnit =
      encounter.metersPerUnit.toPrecision(8)
    this.renderer.domElement.dataset.scaleEncounterOrbitAngleDegrees =
      orbitAngleDegrees.toFixed(2)
    this.renderer.domElement.dataset.scaleEncounterPerspective =
      encounter.perspective
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
    const modelViewport = this.container.closest<HTMLElement>(
      '.model-viewport',
    )
    const previewReferenceWidth = Number(
      modelViewport?.dataset.previewReferenceWidth,
    )
    const previewReferenceHeight = Number(
      modelViewport?.dataset.previewReferenceHeight,
    )
    const modelScale = modelScaleForViewport(
      Number.isFinite(previewReferenceWidth) && previewReferenceWidth > 0
        ? previewReferenceWidth
        : containerWidth,
      Number.isFinite(previewReferenceHeight) && previewReferenceHeight > 0
        ? previewReferenceHeight
        : containerHeight,
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
        this.updateScaleEncounterTransition(time)
        this.updateScaleEncounterContextAction(deltaSeconds)
        this.updateScaleEncounterDistance(deltaSeconds, time)
        this.updateScaleEncounterOrbit(deltaSeconds, time)
        this.applyScaleEncounterReviewOrbit()
        this.updateScaleEncounterAvatarMotion(deltaSeconds)
        updateScaleEncounterAvatarIdle(
          this.scaleEncounter.avatar,
          time / 1_000,
          this.reducedMotion,
        )
        this.publishScaleEncounterAvatarMotionDiagnostics()
        updateScaleEncounterEnvironment(
          this.scaleEncounter.environment,
          time / 1_000,
          this.reducedMotion,
          this.camera,
          this.scaleEncounterRiverVisitor(),
        )
        this.scaleEncounter.boostFlow?.update(
          deltaSeconds,
          this.camera,
          this.reducedMotion,
          this.scaleEncounter.avatar,
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
