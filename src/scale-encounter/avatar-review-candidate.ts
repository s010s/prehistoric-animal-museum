import {
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  SkinnedMesh,
  Texture,
  type AnimationAction,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Skeleton,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { disposeObject3D } from '../viewer/dispose'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  normalizeScaleEncounterProfile,
  type ScaleEncounterAnimalId,
  type ScaleEncounterAvatar,
  type ScaleEncounterAvatarAction,
  type ScaleEncounterAvatarFactory,
  type ScaleEncounterAvatarMotion,
  type ScaleEncounterAvatarMotionState,
  type ScaleEncounterGender,
  type ScaleEncounterHabitat,
  type ScaleEncounterJumpEntryMotion,
  type ScaleEncounterProfile,
} from '../viewer/scale-encounter'
import {
  createAvatarPresentationPoseController,
  orientAvatarVisualForPresentation,
  scaleEncounterAvatarPresentationFor,
  type ScaleEncounterAvatarPresentation,
  type ScaleEncounterAvatarPresentationId,
  type ScaleEncounterAvatarPresentationProfile,
} from './avatar-scene-presentation'

export type ReviewCandidateAvatarProfile =
  ScaleEncounterAvatarPresentationProfile

export type ReviewCandidateAvatarSourceId =
  ScaleEncounterAvatarPresentationId

export type ReviewCandidateAvatarVariantId =
  ScaleEncounterAvatarPresentationId

export type ReviewCandidateAvatarClipName =
  | 'Idle_Forest'
  | 'Walk_Forest'
  | 'Run_Forest'
  | 'Jump_Land_Stand'
  | 'Jump_Land_Walk'
  | 'Jump_Land_Run'
  | 'Idle_Snow'
  | 'Walk_Snow'
  | 'Glide_Static'
  | 'Scuba_Trim_Static'

export interface ReviewCandidateAvatarPackage {
  readonly packageSha256: string
  /** Bone names align, while bind/rest data remains private to this package. */
  readonly rigPolicy: 'meshy-v4-per-package-24-joint'
  readonly authoredHeightMeters: number
  readonly clipForMotion: Readonly<
    Record<ScaleEncounterAvatarMotion, ReviewCandidateAvatarClipName>
  >
  readonly clipForAction: Readonly<
    Partial<
      Record<
        ScaleEncounterAvatarAction,
        Readonly<
          Record<ScaleEncounterJumpEntryMotion, ReviewCandidateAvatarClipName>
        >
      >
    >
  >
  readonly clipNames: readonly ReviewCandidateAvatarClipName[]
  readonly defaultClipName: ReviewCandidateAvatarClipName
  readonly eyeAnchorName: 'EyeAnchor'
  readonly filename: string
  readonly gender: ScaleEncounterGender
  readonly habitat: ScaleEncounterHabitat
  readonly profile: ReviewCandidateAvatarProfile
  readonly sceneRootName: 'ChildAvatarV4Root'
  readonly sourceUrl: string
  readonly variantId: ReviewCandidateAvatarSourceId
}

export const REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES = [
  'Hips',
  'Spine',
  'Spine01',
  'Spine02',
  'neck',
  'Head',
  'LeftShoulder',
  'LeftHand',
  'RightShoulder',
  'RightHand',
  'LeftFoot',
  'RightFoot',
] as const

const REVIEW_CANDIDATE_AVATAR_POSE_BONE_NAMES = [
  'Head',
  'headfront',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
] as const

export interface ReviewCandidateAvatarGltf {
  readonly animations: readonly AnimationClip[]
  readonly scene: Group
}

const BASE_AUTHORED_HEIGHT_METERS = 1.15
const CENTIMETRE_TRANSLATION_DETECTION_THRESHOLD = 5
const CENTIMETRE_TO_METRE = 0.01

interface AvatarClipPolicy {
  readonly clipForAction: ReviewCandidateAvatarPackage['clipForAction']
  readonly clipForMotion: ReviewCandidateAvatarPackage['clipForMotion']
  readonly clipNames: readonly ReviewCandidateAvatarClipName[]
  readonly defaultClipName: ReviewCandidateAvatarClipName
}

const CLIPS_BY_PROFILE: Readonly<
  Record<ReviewCandidateAvatarProfile, AvatarClipPolicy>
> = {
  'land-explorer': {
    clipForAction: {
      jump: {
        idle: 'Jump_Land_Stand',
        walk: 'Jump_Land_Walk',
        run: 'Jump_Land_Run',
      },
    },
    defaultClipName: 'Idle_Forest',
    clipNames: [
      'Idle_Forest',
      'Walk_Forest',
      'Run_Forest',
      'Jump_Land_Stand',
      'Jump_Land_Walk',
      'Jump_Land_Run',
    ],
    clipForMotion: {
      idle: 'Idle_Forest',
      walk: 'Walk_Forest',
      run: 'Run_Forest',
      glide: 'Idle_Forest',
      swim: 'Idle_Forest',
    },
  },
  'snow-expedition': {
    clipForAction: {
      jump: {
        idle: 'Jump_Land_Stand',
        walk: 'Jump_Land_Walk',
        run: 'Jump_Land_Run',
      },
    },
    defaultClipName: 'Idle_Snow',
    clipNames: [
      'Idle_Snow',
      'Walk_Snow',
      'Jump_Land_Stand',
      'Jump_Land_Walk',
      'Jump_Land_Run',
    ],
    clipForMotion: {
      idle: 'Idle_Snow',
      walk: 'Walk_Snow',
      run: 'Walk_Snow',
      glide: 'Idle_Snow',
      swim: 'Idle_Snow',
    },
  },
  'air-wingsuit': {
    clipForAction: {},
    defaultClipName: 'Glide_Static',
    clipNames: ['Glide_Static'],
    clipForMotion: {
      idle: 'Glide_Static',
      walk: 'Glide_Static',
      run: 'Glide_Static',
      glide: 'Glide_Static',
      swim: 'Glide_Static',
    },
  },
  'water-diver': {
    clipForAction: {},
    defaultClipName: 'Scuba_Trim_Static',
    clipNames: ['Scuba_Trim_Static'],
    clipForMotion: {
      idle: 'Scuba_Trim_Static',
      walk: 'Scuba_Trim_Static',
      run: 'Scuba_Trim_Static',
      glide: 'Scuba_Trim_Static',
      swim: 'Scuba_Trim_Static',
    },
  },
}

function avatarPackage(
  variantId: ReviewCandidateAvatarSourceId,
  gender: ScaleEncounterGender,
  profile: ReviewCandidateAvatarProfile,
  habitat: ScaleEncounterHabitat,
  authoredHeightMeters: number,
  packageSha256: string,
  bundledUrl: URL,
): ReviewCandidateAvatarPackage {
  const filename = `child-avatar-v4-${gender}-${profile}-v01.glb`
  const clipPolicy = CLIPS_BY_PROFILE[profile]
  return {
    ...clipPolicy,
    authoredHeightMeters,
    packageSha256,
    rigPolicy: 'meshy-v4-per-package-24-joint',
    eyeAnchorName: 'EyeAnchor',
    filename,
    gender,
    habitat,
    profile,
    sceneRootName: 'ChildAvatarV4Root',
    sourceUrl: bundledUrl.href,
    variantId,
  }
}

// Each entry is one complete character+scene package. A package may expose
// several compatible clips, but clips are never retargeted across entries: the
// eight source rigs use common bone names with different bind/rest data.
export const REVIEW_CANDIDATE_AVATAR_PACKAGES = {
  'boy-land-explorer': avatarPackage(
    'boy-land-explorer',
    'boy',
    'land-explorer',
    'land',
    BASE_AUTHORED_HEIGHT_METERS,
    '591201f2048b279a4dcc6a231c2023cc5a9a9d36495e803d437e40f1abd4c62b',
    new URL(
      './assets/avatars/child-avatar-v4-boy-land-explorer-v01.glb',
      import.meta.url,
    ),
  ),
  'girl-land-explorer': avatarPackage(
    'girl-land-explorer',
    'girl',
    'land-explorer',
    'land',
    BASE_AUTHORED_HEIGHT_METERS,
    '71e602e6ac2cf63d67965df446f5314096882ef2dd83e7aa01f164e84c506aaa',
    new URL(
      './assets/avatars/child-avatar-v4-girl-land-explorer-v01.glb',
      import.meta.url,
    ),
  ),
  'boy-snow-expedition': avatarPackage(
    'boy-snow-expedition',
    'boy',
    'snow-expedition',
    'land',
    BASE_AUTHORED_HEIGHT_METERS,
    '6ea345a82d8649e9ca6e86d7b9a0603eb203fc2a3a52c319ddaa9f3ae8b46658',
    new URL(
      './assets/avatars/child-avatar-v4-boy-snow-expedition-v01.glb',
      import.meta.url,
    ),
  ),
  'girl-snow-expedition': avatarPackage(
    'girl-snow-expedition',
    'girl',
    'snow-expedition',
    'land',
    BASE_AUTHORED_HEIGHT_METERS,
    'e9eeeaa6894b797ffdbb850b2b63a7bb9ddff58221f52a4a7ae7867c0e929fe7',
    new URL(
      './assets/avatars/child-avatar-v4-girl-snow-expedition-v01.glb',
      import.meta.url,
    ),
  ),
  'boy-air-wingsuit': avatarPackage(
    'boy-air-wingsuit',
    'boy',
    'air-wingsuit',
    'air',
    BASE_AUTHORED_HEIGHT_METERS,
    'b2d48dacde98091d48edfc3fb330fb5bfd0bdf6590986a3d30b2a4e5348b3e9b',
    new URL(
      './assets/avatars/child-avatar-v4-boy-air-wingsuit-v01.glb',
      import.meta.url,
    ),
  ),
  'girl-air-wingsuit': avatarPackage(
    'girl-air-wingsuit',
    'girl',
    'air-wingsuit',
    'air',
    BASE_AUTHORED_HEIGHT_METERS,
    'df8454c36e41ad0e94cc7906ba3b13daa7fffc8f5e75a4b0ee4ae9d4f054a1c4',
    new URL(
      './assets/avatars/child-avatar-v4-girl-air-wingsuit-v01.glb',
      import.meta.url,
    ),
  ),
  'boy-water-diver': avatarPackage(
    'boy-water-diver',
    'boy',
    'water-diver',
    'water',
    BASE_AUTHORED_HEIGHT_METERS,
    '1e8f3a3efadd3c4a7a1fb355ab28920bab351419c6eeae509bc65eda41d58806',
    new URL(
      './assets/avatars/child-avatar-v4-boy-water-diver-v01.glb',
      import.meta.url,
    ),
  ),
  'girl-water-diver': avatarPackage(
    'girl-water-diver',
    'girl',
    'water-diver',
    'water',
    BASE_AUTHORED_HEIGHT_METERS,
    '5e381e53823766cf564685d17618d8db658cb1d5c981bc64baa6ebe41a5c00bb',
    new URL(
      './assets/avatars/child-avatar-v4-girl-water-diver-v01.glb',
      import.meta.url,
    ),
  ),
} as const satisfies Readonly<
  Record<ReviewCandidateAvatarSourceId, ReviewCandidateAvatarPackage>
>

export function scaleEncounterAvatarVariantFor(
  gender: ScaleEncounterGender,
  habitat: ScaleEncounterHabitat,
  animalId: ScaleEncounterAnimalId,
): {
  readonly animation: ReviewCandidateAvatarClipName
  readonly id: ReviewCandidateAvatarVariantId
  readonly presentation: ScaleEncounterAvatarPresentation
  readonly sourceId: ReviewCandidateAvatarSourceId
} {
  const presentation = scaleEncounterAvatarPresentationFor(
    gender,
    habitat,
    animalId,
  )
  return {
    animation: CLIPS_BY_PROFILE[presentation.profile].defaultClipName,
    id: presentation.id,
    presentation,
    sourceId: presentation.id,
  }
}

function targetFor(
  profile: ScaleEncounterProfile,
  animalId: ScaleEncounterAnimalId,
): {
  readonly avatarPackage: ReviewCandidateAvatarPackage
  readonly presentation: ScaleEncounterAvatarPresentation
} {
  const normalized = normalizeScaleEncounterProfile(profile)
  const habitat = SCALE_ENCOUNTER_DEFINITIONS[animalId].habitat
  const variant = scaleEncounterAvatarVariantFor(
    normalized.gender,
    habitat,
    animalId,
  )
  return {
    avatarPackage: REVIEW_CANDIDATE_AVATAR_PACKAGES[variant.sourceId],
    presentation: variant.presentation,
  }
}

interface OwnedAvatarResources {
  readonly geometries: Set<BufferGeometry>
  readonly materials: Set<Material>
  readonly skeletons: Set<Skeleton>
  readonly textures: Set<Texture>
}

const AIRFLOW_FABRIC_MOTION_REVISION =
  'scale-encounter-airflow-fabric-v4'
const AIRFLOW_FABRIC_USER_DATA_KEY = 'scaleEncounterAirflowFabricMotion'

// The source mesh is authored in centimetres. A face-on rear camera barely
// reveals normal displacement, so the motion combines a clearly readable
// geometric flutter with a travelling light change across the cloth.
// Both cues use the same bind-pose mask and therefore never reach the arms.
const AIRFLOW_FABRIC_DISPLACEMENT_CENTIMETRES = 3.8
const AIRFLOW_FABRIC_EDGE_LIFT_CENTIMETRES = 3.4
const AIRFLOW_FABRIC_LIGHT_VARIATION = 0.38

const AIRFLOW_FABRIC_MASK = {
  depthEnd: 8,
  depthStart: 6,
  innerEnd: 14,
  innerStart: 10,
  lowerEnd: 58,
  lowerStart: 53,
  outerEnd: 40,
  outerStart: 34,
  upperEnd: 84,
  upperStart: 79,
} as const

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)),
  )
  return normalized * normalized * (3 - 2 * normalized)
}

/**
 * Bind-pose mask for the reviewed Meshy v4 wingsuit packages. Their mesh
 * accessor is authored in centimetres with X lateral, Y depth and Z vertical.
 */
export function scaleEncounterAirflowFabricMaskAt(position: {
  readonly x: number
  readonly y: number
  readonly z: number
}): number {
  const side = Math.abs(position.x)
  return (
    smoothstep(
      AIRFLOW_FABRIC_MASK.innerStart,
      AIRFLOW_FABRIC_MASK.innerEnd,
      side,
    ) *
    (1 -
      smoothstep(
        AIRFLOW_FABRIC_MASK.outerStart,
        AIRFLOW_FABRIC_MASK.outerEnd,
        side,
      )) *
    smoothstep(
      AIRFLOW_FABRIC_MASK.lowerStart,
      AIRFLOW_FABRIC_MASK.lowerEnd,
      position.z,
    ) *
    (1 -
      smoothstep(
        AIRFLOW_FABRIC_MASK.upperStart,
        AIRFLOW_FABRIC_MASK.upperEnd,
        position.z,
      )) *
    (1 -
      smoothstep(
        AIRFLOW_FABRIC_MASK.depthStart,
        AIRFLOW_FABRIC_MASK.depthEnd,
        Math.abs(position.y),
      ))
  )
}

interface AirflowFabricMotionController {
  update(elapsedSeconds: number, reducedMotion: boolean): void
}

function applyAirflowFabricMotion(
  materials: ReadonlySet<Material>,
): AirflowFabricMotionController {
  const timeUniform = { value: 0 }
  const strengthUniform = { value: 1 }

  for (const material of materials) {
    const previousOnBeforeCompile = material.onBeforeCompile.bind(material)
    const previousProgramCacheKey = material.customProgramCacheKey.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile(shader, renderer)
      shader.uniforms.uScaleEncounterAirflowTime = timeUniform
      shader.uniforms.uScaleEncounterAirflowStrength = strengthUniform
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `uniform float uScaleEncounterAirflowTime;
uniform float uScaleEncounterAirflowStrength;
varying float vScaleEncounterAirflowMask;
varying float vScaleEncounterAirflowRipple;

void main() {`,
        )
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>

  // The reviewed wingsuit is one skinned mesh authored in centimetres.
  // Its membrane lies below the horizontal arms in the shallow central depth
  // band. Using the real X/Y/Z axes keeps sleeves, hands, torso and legs rigid.
  float scaleEncounterWingSide = smoothstep(
    ${AIRFLOW_FABRIC_MASK.innerStart.toFixed(1)},
    ${AIRFLOW_FABRIC_MASK.innerEnd.toFixed(1)},
    abs(position.x)
  );
  float scaleEncounterWingTip = 1.0 - smoothstep(
    ${AIRFLOW_FABRIC_MASK.outerStart.toFixed(1)},
    ${AIRFLOW_FABRIC_MASK.outerEnd.toFixed(1)},
    abs(position.x)
  );
  float scaleEncounterWingLower = smoothstep(
    ${AIRFLOW_FABRIC_MASK.lowerStart.toFixed(1)},
    ${AIRFLOW_FABRIC_MASK.lowerEnd.toFixed(1)},
    position.z
  );
  float scaleEncounterWingUpper = 1.0 - smoothstep(
    ${AIRFLOW_FABRIC_MASK.upperStart.toFixed(1)},
    ${AIRFLOW_FABRIC_MASK.upperEnd.toFixed(1)},
    position.z
  );
  float scaleEncounterWingDepth = 1.0 - smoothstep(
    ${AIRFLOW_FABRIC_MASK.depthStart.toFixed(1)},
    ${AIRFLOW_FABRIC_MASK.depthEnd.toFixed(1)},
    abs(position.y)
  );
  float scaleEncounterWingMask =
    scaleEncounterWingSide *
    scaleEncounterWingTip *
    scaleEncounterWingLower *
    scaleEncounterWingUpper *
    scaleEncounterWingDepth;
  float scaleEncounterAirflowRipple =
    sin(
      uScaleEncounterAirflowTime * 10.2 +
      position.x * 0.26 +
      position.z * 0.12
    ) * 0.68 +
    sin(
      uScaleEncounterAirflowTime * 17.3 -
      position.x * 0.17 +
      position.z * 0.21
    ) * 0.32;
  float scaleEncounterAirflowGust = 0.82 + 0.18 * sin(
    uScaleEncounterAirflowTime * 1.65 + abs(position.x) * 0.08
  );
  scaleEncounterAirflowRipple *= scaleEncounterAirflowGust;
  vScaleEncounterAirflowMask = scaleEncounterWingMask;
  vScaleEncounterAirflowRipple = scaleEncounterAirflowRipple;
  transformed += normalize(objectNormal) *
    scaleEncounterAirflowRipple *
    scaleEncounterWingMask *
    uScaleEncounterAirflowStrength *
    ${AIRFLOW_FABRIC_DISPLACEMENT_CENTIMETRES.toFixed(2)};
  transformed.z +=
    scaleEncounterAirflowRipple *
    scaleEncounterWingMask *
    uScaleEncounterAirflowStrength *
    ${AIRFLOW_FABRIC_EDGE_LIFT_CENTIMETRES.toFixed(2)};`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `uniform float uScaleEncounterAirflowStrength;
varying float vScaleEncounterAirflowMask;
varying float vScaleEncounterAirflowRipple;

void main() {`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>

  // A rear view looks almost directly along the displaced cloth normal. The
  // matching moving light band makes the same small ripple readable without
  // moving the arm silhouette or turning the membrane glossy.
  float scaleEncounterFabricLight =
    vScaleEncounterAirflowRipple *
    vScaleEncounterAirflowMask *
    uScaleEncounterAirflowStrength;
  diffuseColor.rgb *= 1.0 +
    scaleEncounterFabricLight *
    ${AIRFLOW_FABRIC_LIGHT_VARIATION.toFixed(3)};`,
        )
    }
    material.customProgramCacheKey = () =>
      `${previousProgramCacheKey()}|${AIRFLOW_FABRIC_MOTION_REVISION}`
    material.userData[AIRFLOW_FABRIC_USER_DATA_KEY] =
      AIRFLOW_FABRIC_MOTION_REVISION
    material.needsUpdate = true
  }

  return {
    update: (elapsedSeconds, reducedMotion) => {
      timeUniform.value = elapsedSeconds
      strengthUniform.value = reducedMotion ? 0 : 1
    },
  }
}

function createOwnedAvatarResources(): OwnedAvatarResources {
  return {
    geometries: new Set(),
    materials: new Set(),
    skeletons: new Set(),
    textures: new Set(),
  }
}

function cloneTextureReference(
  texture: Texture,
  clones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): Texture {
  const cached = clones.get(texture)
  if (cached) return cached
  const clone = texture.clone()
  // Texture.clone deliberately shares Source/ImageBitmap. The visible
  // instance owns only this GPU texture object; its custom disposer below
  // never closes Source.data, which remains owned by the cached source GLTF.
  clones.set(texture, clone)
  resources.textures.add(clone)
  return clone
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture
}

function cloneTextureValue(
  value: unknown,
  clones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): unknown {
  if (isTexture(value)) {
    return cloneTextureReference(value, clones, resources)
  }
  if (Array.isArray(value) && value.some(isTexture)) {
    const entries: readonly unknown[] = value
    return entries.map((entry) =>
      isTexture(entry)
        ? cloneTextureReference(entry, clones, resources)
        : entry,
    )
  }
  return value
}

function cloneMaterial(
  source: Material,
  textureClones: Map<Texture, Texture>,
  resources: OwnedAvatarResources,
): Material {
  const clone = source.clone()
  const sourceValues = source as unknown as Record<string, unknown>
  const cloneValues = clone as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(sourceValues)) {
    const replacement = cloneTextureValue(value, textureClones, resources)
    if (replacement !== value) cloneValues[key] = replacement
  }

  if ('uniforms' in sourceValues && 'uniforms' in cloneValues) {
    const sourceUniforms = sourceValues.uniforms as Record<string, unknown>
    const cloneUniforms = cloneValues.uniforms as Record<string, unknown>
    for (const [name, sourceUniform] of Object.entries(sourceUniforms)) {
      if (
        sourceUniform &&
        typeof sourceUniform === 'object' &&
        'value' in sourceUniform
      ) {
        const clonedUniform = cloneUniforms[name]
        if (
          clonedUniform &&
          typeof clonedUniform === 'object' &&
          'value' in clonedUniform
        ) {
          clonedUniform.value = cloneTextureValue(
            sourceUniform.value,
            textureClones,
            resources,
          )
        }
      }
    }
  }
  resources.materials.add(clone)
  return clone
}

type CandidateMesh = Mesh<BufferGeometry, Material | Material[]>

function isCandidateMesh(object: Object3D): object is CandidateMesh {
  return object instanceof Mesh
}

function cloneCandidateScene(source: Group): {
  readonly resources: OwnedAvatarResources
  readonly visual: Group
} {
  const visual = cloneSkeleton(source) as Group
  const resources = createOwnedAvatarResources()
  const textureClones = new Map<Texture, Texture>()
  visual.traverse((object) => {
    if (!isCandidateMesh(object)) return
    object.geometry = object.geometry.clone()
    resources.geometries.add(object.geometry)
    object.material = Array.isArray(object.material)
      ? object.material.map((material) =>
          cloneMaterial(material, textureClones, resources),
        )
      : cloneMaterial(object.material, textureClones, resources)
    if (object instanceof SkinnedMesh) {
      resources.skeletons.add(object.skeleton)
    }
  })
  return { resources, visual }
}

function disposeOwnedAvatarResources(
  resources: OwnedAvatarResources,
): void {
  for (const texture of resources.textures) texture.dispose()
  for (const material of resources.materials) material.dispose()
  for (const geometry of resources.geometries) geometry.dispose()
  for (const skeleton of resources.skeletons) skeleton.dispose()
}

function validateCandidate(
  candidate: ReviewCandidateAvatarGltf,
  avatarPackage: ReviewCandidateAvatarPackage,
): ReviewCandidateAvatarGltf {
  if (
    candidate.scene.name !== avatarPackage.sceneRootName &&
    !candidate.scene.getObjectByName(avatarPackage.sceneRootName)
  ) {
    throw new Error(
      `candidate-avatar-missing-${avatarPackage.sceneRootName}`,
    )
  }
  let eyeAnchorCount = 0
  candidate.scene.traverse((object) => {
    if (object.name === avatarPackage.eyeAnchorName) eyeAnchorCount += 1
  })
  if (eyeAnchorCount !== 1) {
    throw new Error(
      `candidate-avatar-invalid-${avatarPackage.eyeAnchorName}-count:${eyeAnchorCount}`,
    )
  }
  const animationCounts = new Map<string, number>()
  for (const animation of candidate.animations) {
    if (!animation.name) throw new Error('candidate-avatar-empty-clip-name')
    animationCounts.set(
      animation.name,
      (animationCounts.get(animation.name) ?? 0) + 1,
    )
  }
  if (candidate.animations.length !== avatarPackage.clipNames.length) {
    throw new Error('candidate-avatar-unexpected-clip-set')
  }
  for (const clipName of avatarPackage.clipNames) {
    if (animationCounts.get(clipName) !== 1) {
      throw new Error(`candidate-avatar-missing-${clipName}`)
    }
    const clip = candidate.animations.find(
      (animation) => animation.name === clipName,
    )!
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks.length) {
      throw new Error(`candidate-avatar-invalid-${clipName}`)
    }
  }
  const translationTracks = candidate.animations.flatMap((animation) =>
    animation.tracks.filter(
      (track) => track.name.endsWith('.position') && track.getValueSize() === 3,
    ),
  )
  const maximumTranslationComponent = translationTracks.reduce(
    (maximum, track) => {
      let nextMaximum = maximum
      for (const value of track.values) {
        nextMaximum = Math.max(nextMaximum, Math.abs(value))
      }
      return nextMaximum
    },
    0,
  )
  const translationScale =
    maximumTranslationComponent > CENTIMETRE_TRANSLATION_DETECTION_THRESHOLD
      ? CENTIMETRE_TO_METRE
      : 1
  if (translationScale !== 1) {
    const animatedNodeNames = new Set<string>()
    for (const track of translationTracks) {
      animatedNodeNames.add(
        track.name.slice(0, -'.position'.length),
      )
      for (let index = 0; index < track.values.length; index += 1) {
        track.values[index] = track.values[index]! * translationScale
      }
    }
    // These Meshy packages keep the render mesh in metres while their rig and
    // animation translations are still in centimetres. Scaling only the
    // keyframes leaves the rest pose and inverse bind matrices in the old unit
    // system; the first arm rotation then swings the skin around a pivot tens
    // of metres away. Normalize the animated nodes and rebuild the bind pose as
    // one operation so both the imported clips and our child-facing pose
    // adjustments deform around the real joints.
    for (const nodeName of animatedNodeNames) {
      candidate.scene
        .getObjectByName(nodeName)
        ?.position.multiplyScalar(translationScale)
    }
    candidate.scene.updateMatrixWorld(true)
    candidate.scene.traverse((object) => {
      if (!(object instanceof SkinnedMesh)) return
      object.skeleton.calculateInverses()
      object.skeleton.update()
    })
  }
  candidate.scene.userData.scaleEncounterAvatarAnimationTranslationScale =
    translationScale
  candidate.scene.userData.scaleEncounterAvatarRigTranslationScale =
    translationScale
  for (const socketName of REVIEW_CANDIDATE_AVATAR_EQUIPMENT_SOCKET_NAMES) {
    if (!candidate.scene.getObjectByName(socketName)) {
      throw new Error(`candidate-avatar-missing-equipment-socket:${socketName}`)
    }
  }
  for (const boneName of REVIEW_CANDIDATE_AVATAR_POSE_BONE_NAMES) {
    if (!candidate.scene.getObjectByName(boneName)) {
      throw new Error(`candidate-avatar-missing-pose-bone:${boneName}`)
    }
  }
  return candidate
}

interface AvatarCacheEntry {
  candidate: ReviewCandidateAvatarGltf | null
  disposed: boolean
  evicted: boolean
  instanceCount: number
  leaseCount: number
  readonly avatarPackage: ReviewCandidateAvatarPackage
  readonly promise: Promise<ReviewCandidateAvatarGltf>
}

export interface ReviewCandidateAvatarLease {
  readonly factory: ScaleEncounterAvatarFactory
  readonly variantId: ReviewCandidateAvatarVariantId
  release(): void
}

export interface ReviewCandidateAvatarLoader {
  acquire(
    profile: ScaleEncounterProfile,
    animalId: ScaleEncounterAnimalId,
    signal?: AbortSignal,
  ): Promise<ReviewCandidateAvatarLease>
  cachedVariantIds(): readonly ReviewCandidateAvatarSourceId[]
  disposeUnused(): void
}

export interface ReviewCandidateAvatarLoaderOptions {
  readonly cacheLimit?: number
  readonly load?: (sourceUrl: string) => Promise<ReviewCandidateAvatarGltf>
  readonly maxStepSeconds?: number
  readonly stallBaselineMultiplier?: number
}

function disposeCachedCandidate(entry: AvatarCacheEntry): void {
  if (entry.disposed || !entry.candidate) return
  entry.disposed = true
  disposeObject3D(entry.candidate.scene)
  entry.candidate.scene.clear()
}

function disposeUncachedCandidate(candidate: ReviewCandidateAvatarGltf): void {
  disposeObject3D(candidate.scene)
  candidate.scene.clear()
}

export function createReviewCandidateAvatarLoader(
  options: ReviewCandidateAvatarLoaderOptions = {},
): ReviewCandidateAvatarLoader {
  const cacheLimit = options.cacheLimit ?? 3
  if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
    throw new RangeError('candidate-avatar-cache-limit-invalid')
  }
  const maxStepSeconds = options.maxStepSeconds ?? 1 / 30
  const stallBaselineMultiplier = options.stallBaselineMultiplier ?? 1.25
  if (
    !Number.isFinite(maxStepSeconds) ||
    maxStepSeconds <= 0 ||
    !Number.isFinite(stallBaselineMultiplier) ||
    stallBaselineMultiplier < 1
  ) {
    throw new RangeError('candidate-avatar-clock-policy-invalid')
  }
  const load: (
    sourceUrl: string,
  ) => Promise<ReviewCandidateAvatarGltf> =
    options.load ??
    ((sourceUrl: string) =>
      new GLTFLoader().loadAsync(sourceUrl))
  const cache = new Map<ReviewCandidateAvatarSourceId, AvatarCacheEntry>()

  function touch(entry: AvatarCacheEntry): void {
    const id = entry.avatarPackage.variantId
    if (cache.get(id) !== entry) return
    cache.delete(id)
    cache.set(id, entry)
  }

  function evict(entry: AvatarCacheEntry): void {
    const id = entry.avatarPackage.variantId
    if (cache.get(id) !== entry) return
    cache.delete(id)
    entry.evicted = true
    disposeCachedCandidate(entry)
  }

  function trimCache(): void {
    while (cache.size > cacheLimit) {
      const unused = [...cache.values()].find(
        (entry) => entry.leaseCount === 0 && entry.instanceCount === 0,
      )
      if (!unused) return
      evict(unused)
    }
  }

  function releaseInstance(entry: AvatarCacheEntry): void {
    entry.instanceCount = Math.max(0, entry.instanceCount - 1)
    trimCache()
  }

  function createFactory(
    entry: AvatarCacheEntry,
    presentation: ScaleEncounterAvatarPresentation,
  ): ScaleEncounterAvatarFactory {
    return (profile, habitat, animalId): ScaleEncounterAvatar => {
      const normalized = normalizeScaleEncounterProfile(profile)
      const variant = scaleEncounterAvatarVariantFor(
        normalized.gender,
        habitat,
        animalId,
      )
      if (
        variant.id !== presentation.id ||
        variant.sourceId !== entry.avatarPackage.variantId
      ) {
        throw new Error('candidate-avatar-lease-target-mismatch')
      }
      const candidate = entry.candidate
      if (!candidate || entry.disposed) {
        throw new Error('candidate-avatar-source-unavailable')
      }

      entry.instanceCount += 1
      let cloned: ReturnType<typeof cloneCandidateScene> | null = null
      try {
        cloned = cloneCandidateScene(candidate.scene)
        const { resources, visual } = cloned
        visual.name = 'scale-encounter-child-visual'
        orientAvatarVisualForPresentation(visual, presentation)
        const airflowFabricMotion =
          presentation.profile === 'air-wingsuit'
            ? applyAirflowFabricMotion(resources.materials)
            : null

        const root = new Group()
        root.name =
          `scale-encounter-child-${presentation.id}-runtime-v1`
        root.userData.scaleEncounterProductionApproved = true
        root.userData.scaleEncounterAvatarEquipment = presentation.equipment
        root.userData.scaleEncounterAvatarPose = presentation.pose
        root.userData.scaleEncounterAvatarPresentation = presentation.id
        root.userData.scaleEncounterAvatarSource = entry.avatarPackage.filename
        if (airflowFabricMotion) {
          root.userData.scaleEncounterAvatarFabricMotion =
            AIRFLOW_FABRIC_MOTION_REVISION
        }
        const animationTranslationScale = candidate.scene.userData
          .scaleEncounterAvatarAnimationTranslationScale as unknown
        const rigTranslationScale = candidate.scene.userData
          .scaleEncounterAvatarRigTranslationScale as unknown
        root.userData.scaleEncounterAvatarAnimationTranslationScale =
          typeof animationTranslationScale === 'number'
            ? animationTranslationScale
            : 1
        root.userData.scaleEncounterAvatarRigTranslationScale =
          typeof rigTranslationScale === 'number' ? rigTranslationScale : 1
        root.add(visual)
        root.scale.setScalar(
          normalized.heightMeters /
            entry.avatarPackage.authoredHeightMeters,
        )
        root.updateMatrixWorld(true)

        const eyeAnchor = visual.getObjectByName(
          entry.avatarPackage.eyeAnchorName,
        )
        if (!eyeAnchor) {
          throw new Error('candidate-avatar-missing-EyeAnchor')
        }
        const mixer = new AnimationMixer(visual)
        const actions = new Map<
          ReviewCandidateAvatarClipName,
          AnimationAction
        >()
        for (const clipName of entry.avatarPackage.clipNames) {
          const clip = candidate.animations.find(
            (animation) => animation.name === clipName,
          )
          if (!clip) throw new Error(`candidate-avatar-missing-${clipName}`)
          const action = mixer.clipAction(clip)
          if (clipName.startsWith('Jump_Land_')) {
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
          } else {
            action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
          }
          actions.set(clipName, action)
        }
        let activeClipName = entry.avatarPackage.defaultClipName
        const defaultAction = actions.get(activeClipName)
        if (!defaultAction) {
          throw new Error(`candidate-avatar-missing-${activeClipName}`)
        }
        let activeAction: AnimationAction = defaultAction
        activeAction.reset().play()
        root.userData.scaleEncounterAvatarActiveClip = activeClipName
        // Apply the authored frame-zero pose before ViewerController measures
        // EyeAnchor or renders the first overview.
        mixer.update(0)
        const poseController = createAvatarPresentationPoseController(
          visual,
          presentation,
        )
        poseController.apply(mixer.time, false)

        let disposed = false
        let previousElapsedSeconds: number | null = null
        let reducedMotionActive = false
        let stableFrameDeltaSeconds: number | null = null
        let motionState: ScaleEncounterAvatarMotionState = {
          kind:
            presentation.profile === 'air-wingsuit' ? 'glide' : 'idle',
          speedMetersPerSecond: 0,
        }
        root.userData.scaleEncounterAvatarMotion = motionState.kind
        root.userData.scaleEncounterAvatarTravelSpeed = 0
        root.userData.scaleEncounterAvatarAnimationTimeSeconds = mixer.time
        root.userData.scaleEncounterAvatarAnimationRate = 1
        root.userData.scaleEncounterAvatarAnimationDeltaSeconds = 0
        let transientAction: ScaleEncounterAvatarAction | null = null

        const playbackRateFor = (
          motion: ScaleEncounterAvatarMotionState,
        ): number => {
          if (motion.kind === 'walk') {
            return Math.min(
              1.2,
              Math.max(import.meta.env.MODE === 'review' ? 0.01 : 0.72, motion.speedMetersPerSecond / 1.4),
            )
          }
          if (motion.kind === 'run') {
            return Math.min(
              1.25,
              Math.max(0.78, motion.speedMetersPerSecond / 2.8),
            )
          }
          return 1
        }

        const activateMotionClip = (
          motion: ScaleEncounterAvatarMotionState,
          crossFade: boolean,
        ) => {
          const nextClipName =
            entry.avatarPackage.clipForMotion[motion.kind]
          const nextAction = actions.get(nextClipName)
          if (!nextAction) {
            throw new Error(`candidate-avatar-missing-${nextClipName}`)
          }
          const playbackRate = playbackRateFor(motion)
          if (nextClipName === activeClipName) {
            activeAction.setEffectiveTimeScale(playbackRate)
            return
          }
          nextAction
            .reset()
            .setEffectiveTimeScale(playbackRate)
            .setEffectiveWeight(1)
            .play()
          if (crossFade) activeAction.crossFadeTo(nextAction, 0.2, false)
          else activeAction.stop()
          activeAction = nextAction
          activeClipName = nextClipName
          root.userData.scaleEncounterAvatarActiveClip = activeClipName
        }

        const setActionState = (
          action: ScaleEncounterAvatarAction,
          active: boolean,
          requestedEntryMotion?: ScaleEncounterJumpEntryMotion,
        ) => {
          const clipForEntry = entry.avatarPackage.clipForAction[action]
          const entryMotion: ScaleEncounterJumpEntryMotion =
            requestedEntryMotion ??
            (motionState.kind === 'walk' || motionState.kind === 'run'
              ? motionState.kind
              : 'idle')
          const clipName = clipForEntry?.[entryMotion]
          if (!clipName || disposed) return
          if (!active) {
            if (transientAction !== action) return
            transientAction = null
            activateMotionClip(motionState, true)
            return
          }
          if (transientAction === action) return
          const nextAction = actions.get(clipName)
          if (!nextAction) {
            throw new Error(`candidate-avatar-missing-${clipName}`)
          }
          transientAction = action
          nextAction
            .reset()
            .setLoop(LoopOnce, 1)
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
          nextAction.clampWhenFinished = true
          nextAction.play()
          activeAction.crossFadeTo(nextAction, 0.1, false)
          activeAction = nextAction
          activeClipName = clipName
          root.userData.scaleEncounterAvatarActiveClip = activeClipName
          root.userData.scaleEncounterAvatarJumpEntryMotion = entryMotion
        }

        const dispose = () => {
          if (disposed) return
          disposed = true
          mixer.stopAllAction()
          mixer.uncacheRoot(visual)
          root.removeFromParent()
          disposeOwnedAvatarResources(resources)
          visual.clear()
          root.clear()
          releaseInstance(entry)
        }

        return {
          bodyOrientation: presentation.bodyOrientation,
          dispose,
          eyeAnchor,
          root,
          setMotionState: (nextMotion) => {
            if (disposed) return
            motionState = {
              kind: nextMotion.kind,
              speedMetersPerSecond: Math.max(
                0,
                Number.isFinite(nextMotion.speedMetersPerSecond)
                  ? nextMotion.speedMetersPerSecond
                  : 0,
              ),
            }
            root.userData.scaleEncounterAvatarMotion = motionState.kind
            root.userData.scaleEncounterAvatarTravelSpeed =
              motionState.speedMetersPerSecond
            if (!reducedMotionActive && transientAction === null) {
              activateMotionClip(motionState, true)
            }
          },
          setActionState,
          visual,
          updateIdle: (elapsedSeconds, reducedMotion) => {
            if (disposed || !Number.isFinite(elapsedSeconds)) return
            airflowFabricMotion?.update(elapsedSeconds, reducedMotion)

            if (reducedMotion) {
              previousElapsedSeconds = elapsedSeconds
              root.userData.scaleEncounterAvatarAnimationRate = 0
              root.userData.scaleEncounterAvatarAnimationDeltaSeconds = 0
              if (!reducedMotionActive) {
                reducedMotionActive = true
                mixer.stopAllAction()
                activeClipName = entry.avatarPackage.defaultClipName
                activeAction = actions.get(activeClipName)!
                activeAction.reset().play()
                activeAction.paused = true
                root.userData.scaleEncounterAvatarActiveClip = activeClipName
                mixer.update(0)
                poseController.apply(
                  mixer.time,
                  true,
                  presentation.profile === 'air-wingsuit'
                    ? 'glide'
                    : 'idle',
                )
              }
              return
            }

            if (reducedMotionActive) {
              reducedMotionActive = false
              activeAction.paused = false
              activateMotionClip(motionState, false)
              root.userData.scaleEncounterAvatarAnimationRate = activeAction.getEffectiveTimeScale()
              previousElapsedSeconds = elapsedSeconds
              poseController.apply(mixer.time, false, motionState.kind)
              return
            }

            if (previousElapsedSeconds === null) {
              previousElapsedSeconds = elapsedSeconds
              return
            }
            const rawDelta = elapsedSeconds - previousElapsedSeconds
            previousElapsedSeconds = elapsedSeconds
            if (rawDelta <= 0) return

            const frameBudget = Math.min(
              maxStepSeconds,
              stableFrameDeltaSeconds === null
                ? maxStepSeconds
                : stableFrameDeltaSeconds * stallBaselineMultiplier,
            )
            // A flight can legitimately render below 30fps when its islands
            // occupy more of the frame. Clipping *every* such frame to 1/30
            // made the child slow down in the wide scene and speed up when
            // approaching. Real frames up to 100ms retain one clock second
            // per second; longer stalls still get one small bounded step.
            const delta = presentation.profile === 'air-wingsuit' && rawDelta <= .1 + 1e-9
              ? rawDelta : Math.min(rawDelta, frameBudget)
            mixer.update(delta)
            root.userData.scaleEncounterAvatarAnimationTimeSeconds = mixer.time
            root.userData.scaleEncounterAvatarAnimationRate = activeAction.getEffectiveTimeScale()
            root.userData.scaleEncounterAvatarAnimationDeltaSeconds = delta
            // The stationary land presentation normally restores a reviewed
            // relaxed stance after every mixer update. Doing that during the
            // transient jump erased the authored hip and knee rotations, so
            // a stationary child appeared to rise with locked legs while a
            // moving child used a different pose path. A transient package
            // action owns the complete skeleton until its recovery frame.
            if (transientAction === null) {
              poseController.apply(mixer.time, false, motionState.kind)
            }

            // Learn legitimate 120/60/30Hz cadence changes while excluding
            // long stalls. A 200/500ms wall-clock gap is deliberately dropped
            // after one bounded update instead of being replayed as a burst of
            // substeps in the same rendered frame.
            if (rawDelta <= maxStepSeconds + 1e-9) {
              stableFrameDeltaSeconds =
                stableFrameDeltaSeconds === null
                  ? rawDelta
                  : stableFrameDeltaSeconds * 0.8 + rawDelta * 0.2
            }
          },
        }
      } catch (error) {
        if (cloned) {
          disposeOwnedAvatarResources(cloned.resources)
          cloned.visual.clear()
        }
        releaseInstance(entry)
        throw error
      }
    }
  }

  async function acquire(
    profile: ScaleEncounterProfile,
    animalId: ScaleEncounterAnimalId,
    signal?: AbortSignal,
  ): Promise<ReviewCandidateAvatarLease> {
    const { avatarPackage, presentation } = targetFor(profile, animalId)
    let entry = cache.get(avatarPackage.variantId)
    if (!entry) {
      const entryState: { current: AvatarCacheEntry | null } = {
        current: null,
      }
      const promise = load(avatarPackage.sourceUrl)
        .then((candidate) => {
          try {
            validateCandidate(candidate, avatarPackage)
          } catch (error) {
            disposeUncachedCandidate(candidate)
            throw error
          }
          if (!entryState.current || entryState.current.evicted) {
            // Defensive future-proofing for cancellation/teardown paths: a
            // source that finishes after its cache entry was evicted must not
            // become an orphaned ImageBitmap/GLTF.
            disposeUncachedCandidate(candidate)
            throw new Error('candidate-avatar-load-evicted')
          }
          entryState.current.candidate = candidate
          return candidate
        })
        .catch((error: unknown) => {
          if (cache.get(avatarPackage.variantId) === entryState.current) {
            cache.delete(avatarPackage.variantId)
          }
          throw error
        })
      // An aborted lease can evict this shared entry while GLTFLoader is still
      // finishing its request. Active leases continue to await the original
      // promise and receive its error; this terminal observer only prevents a
      // late, intentionally evicted load from becoming an unhandled rejection
      // after every consumer has already detached.
      void promise.catch(() => undefined)
      const createdEntry: AvatarCacheEntry = {
        avatarPackage,
        candidate: null,
        disposed: false,
        evicted: false,
        instanceCount: 0,
        leaseCount: 0,
        promise,
      }
      entryState.current = createdEntry
      entry = createdEntry
      cache.set(avatarPackage.variantId, entry)
    }
    touch(entry)
    entry.leaseCount += 1
    trimCache()

    try {
      if (signal?.aborted) {
        throw new DOMException('Avatar package load aborted.', 'AbortError')
      }
      if (signal) {
        await new Promise<ReviewCandidateAvatarGltf>((resolve, reject) => {
          const abort = () => {
            settle()
            reject(
              new DOMException('Avatar package load aborted.', 'AbortError'),
            )
          }
          const settle = () => signal.removeEventListener('abort', abort)
          signal.addEventListener('abort', abort, { once: true })
          void entry.promise.then(
            (candidate) => {
              settle()
              resolve(candidate)
            },
            (error: unknown) => {
              settle()
              reject(error instanceof Error ? error : new Error(String(error)))
            },
          )
        })
      } else {
        await entry.promise
      }
    } catch (error) {
      entry.leaseCount = Math.max(0, entry.leaseCount - 1)
      if (
        signal?.aborted &&
        entry.leaseCount === 0 &&
        entry.instanceCount === 0
      ) {
        evict(entry)
      } else {
        trimCache()
      }
      throw error
    }

    let released = false
    const factory = createFactory(entry, presentation)
    return {
      factory: (nextProfile, habitat, nextAnimalId) => {
        if (released) {
          throw new Error('candidate-avatar-lease-released')
        }
        return factory(nextProfile, habitat, nextAnimalId)
      },
      release: () => {
        if (released) return
        released = true
        entry.leaseCount = Math.max(0, entry.leaseCount - 1)
        trimCache()
      },
      variantId: presentation.id,
    }
  }

  return {
    acquire,
    cachedVariantIds: () => [...cache.keys()],
    disposeUnused: () => {
      for (const entry of [...cache.values()]) {
        if (entry.leaseCount === 0 && entry.instanceCount === 0) {
          evict(entry)
        }
      }
    },
  }
}

const defaultAvatarLoader = createReviewCandidateAvatarLoader()

export function acquireReviewCandidateAvatarFactory(
  profile: ScaleEncounterProfile,
  animalId: ScaleEncounterAnimalId,
  signal?: AbortSignal,
): Promise<ReviewCandidateAvatarLease> {
  return defaultAvatarLoader.acquire(profile, animalId, signal)
}
