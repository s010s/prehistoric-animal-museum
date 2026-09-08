import {
  Box3,
  Matrix4,
  MathUtils,
  Quaternion,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
} from 'three'
import type {
  ScaleEncounterApproach,
  ScaleEncounterAnimalId,
  ScaleEncounterAvatarPresentationProfile,
  ScaleEncounterEnvironmentTheme,
  ScaleEncounterScaleConfidence,
} from '../scale-encounter/types'
import { disposeObject3D } from './dispose'

export type { ScaleEncounterAnimalId } from '../scale-encounter/types'

export type ScaleEncounterHabitat = 'land' | 'air' | 'water'
export type ScaleEncounterGender = 'boy' | 'girl'
export type ScaleEncounterView = 'overview' | 'pov'
export type ScaleEncounterPerspective = 'child-eyes' | 'child-rear'
export type ScaleEncounterAvatarMotion =
  | 'idle'
  | 'walk'
  | 'run'
  | 'glide'
  | 'swim'

export type ScaleEncounterJumpEntryMotion = Extract<
  ScaleEncounterAvatarMotion,
  'idle' | 'walk' | 'run'
>

export type ScaleEncounterAvatarAction = 'jump'

export type ScaleEncounterAvatarMotionPolicy =
  | 'adaptive-land'
  | 'walk-only'
  | 'glide'
  | 'swim'

export interface ScaleEncounterAvatarMotionState {
  readonly kind: ScaleEncounterAvatarMotion
  readonly speedMetersPerSecond: number
}

export const SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND = 1.4
export const SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND = 2.8

export interface ScaleEncounterLandInputIntent {
  /** Positive values move toward the animal. */
  readonly radial: number
  /** Positive values circle right around the animal. */
  readonly tangential: number
  readonly motion: Extract<ScaleEncounterAvatarMotion, 'idle' | 'walk' | 'run'>
  readonly speedMetersPerSecond: number
}

/**
 * Resolves land controls before any rail mapping or collision projection.
 * Gait belongs to the user's intent, while geometry is only allowed to limit
 * the final position. Normalising here prevents diagonal inputs from adding a
 * 1.4 m/s radial vector to an independent 2.8 m/s tangent vector.
 */
export function resolveScaleEncounterLandInputIntent(
  radialDirection: -1 | 0 | 1,
  tangentialDirection: -1 | 0 | 1,
): ScaleEncounterLandInputIntent {
  if (radialDirection === 0 && tangentialDirection === 0) {
    return {
      motion: 'idle',
      radial: 0,
      speedMetersPerSecond: 0,
      tangential: 0,
    }
  }
  const magnitude = Math.hypot(radialDirection, tangentialDirection)
  const motion = tangentialDirection === 0 ? 'walk' : 'run'
  return {
    motion,
    radial: radialDirection / magnitude,
    speedMetersPerSecond:
      motion === 'run'
        ? SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND
        : SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND,
    tangential: tangentialDirection / magnitude,
  }
}
export type ScaleEncounterCameraStage =
  | 'overview'
  | 'side-establishing'
  | 'rear-establishing'
  | 'full-body-showcase'
  | 'child-rear'
  | 'follow-orbit'
  | 'eye-entry'
  | 'pov'
export type ScaleEncounterSubjectLayout =
  | 'authored'
  | 'side-by-side'
  | 'stacked'

export const SCALE_ENCOUNTER_WIDE_LAYOUT_MINIMUM_ASPECT = 1.2

export function scaleEncounterSubjectLayoutForAspect(
  animalId: ScaleEncounterAnimalId,
  aspect: number,
): ScaleEncounterSubjectLayout {
  if (SCALE_ENCOUNTER_DEFINITIONS[animalId].habitat !== 'air') {
    return 'authored'
  }
  return aspect >= SCALE_ENCOUNTER_WIDE_LAYOUT_MINIMUM_ASPECT
    ? 'side-by-side'
    : 'stacked'
}

export interface ScaleEncounterProfile {
  readonly approach?: ScaleEncounterApproach
  readonly gender: ScaleEncounterGender
  readonly heightCm: number
}

export interface NormalizedScaleEncounterProfile {
  readonly approach: ScaleEncounterApproach
  readonly gender: ScaleEncounterGender
  readonly heightCm: number
  readonly heightMeters: number
}

export interface ScaleEncounterSnapshot {
  readonly active: boolean
  readonly animalId: ScaleEncounterAnimalId | null
  readonly cameraStage: ScaleEncounterCameraStage
  readonly perspective: ScaleEncounterPerspective
  readonly view: ScaleEncounterView
  readonly transitioning: boolean
  readonly distanceMeters: number | null
  readonly orbitAngleDegrees: number
  readonly overviewZoom: number
  readonly error: string | null
  readonly profile: NormalizedScaleEncounterProfile | null
  readonly rawSpanUnits: number | null
  readonly metersPerUnit: number | null
}

export interface ScaleEncounterDefinition {
  readonly id: ScaleEncounterAnimalId
  readonly habitat: ScaleEncounterHabitat
  readonly environmentTheme: ScaleEncounterEnvironmentTheme
  readonly avatarProfile: ScaleEncounterAvatarPresentationProfile
  readonly avatarMotionPolicy: ScaleEncounterAvatarMotionPolicy
  readonly calibratedModelSha256: string
  readonly displayedMeters: number
  readonly scaleConfidence: ScaleEncounterScaleConfidence
  readonly measurement: 'body-length' | 'wingspan' | 'shoulder-height'
  readonly measurementAxis: 'x' | 'y' | 'z'
  readonly modelYawRadians: number
  readonly support: 'ground' | 'centre'
  readonly animalPosition: Readonly<Vector3>
  readonly defaultDistance: number
  readonly minimumDistance: number
  readonly maximumDistance: number
  readonly overviewFieldOfView: number
  readonly povFieldOfView: number
  readonly overviewDirection: Readonly<Vector3>
  readonly overviewUp: Readonly<Vector3>
  readonly guidedTransitionDurationMs: number
  readonly referenceAnimationTimeSeconds: number
  /** Precise skinned AABB span recorded during calibration, when retained. */
  readonly reviewedRawSpanUnits?: number
}

export interface ScaleEncounterPlacement {
  readonly animalId: ScaleEncounterAnimalId
  /** Complete calibrated world-space bounds used by close approach. */
  readonly groundFootprint?: readonly Vector3[]
  readonly animalBoundsMaximum: Readonly<Vector3>
  readonly animalBoundsMinimum: Readonly<Vector3>
  /** Exact centre of the animal's complete calibrated world-space bounds. */
  readonly orbitCenter: Readonly<Vector3>
  readonly target: Readonly<Vector3>
  /** Unit vector pointing from the animal target toward the child's eyes. */
  readonly observerRailDirection: Readonly<Vector3>
  readonly defaultEyePosition: Readonly<Vector3>
  readonly defaultDistance: number
  readonly minimumDistance: number
  readonly maximumDistance: number
  readonly avatarYawRadians: number
}

export interface ScaleEncounterAvatar {
  /** Rendered body axis; prone candidates already own their flight/swim trim. */
  readonly bodyOrientation?: 'upright' | 'prone'
  /**
   * Candidate GLBs use a cache-aware disposer so an instance never closes the
   * ImageBitmap owned by its cached source package. Test-only lightweight
   * avatars may omit this and continue through the ordinary Object3D disposer.
   */
  readonly dispose?: () => void
  readonly root: Group
  readonly visual: Group
  readonly eyeAnchor: Object3D
  readonly leftArm?: Mesh
  readonly rightArm?: Mesh
  readonly torso?: Mesh
  readonly baseLeftArmRotationX?: number
  readonly baseRightArmRotationX?: number
  readonly setMotionState?: (
    motion: ScaleEncounterAvatarMotionState,
  ) => void
  /**
   * Starts or ends a one-shot pose animation. World-space travel remains the
   * responsibility of ViewerController so authored clips never introduce
   * duplicate root motion or alter the measured animal scale.
   */
  readonly setActionState?: (
    action: ScaleEncounterAvatarAction,
    active: boolean,
    entryMotion?: ScaleEncounterJumpEntryMotion,
  ) => void
  readonly updateIdle?: (
    elapsedSeconds: number,
    reducedMotion: boolean,
  ) => void
}

export type ScaleEncounterAvatarFactory = (
  profile: ScaleEncounterProfile,
  habitat: ScaleEncounterHabitat,
  animalId: ScaleEncounterAnimalId,
) => ScaleEncounterAvatar

/**
 * Measures the eye height from the avatar's actual rendered sole, not from its
 * root origin. Reviewed GLBs are allowed to retain tiny export offsets between
 * the root and shoe geometry; treating the root as the floor made those shoes
 * visibly hover even though the authored eye anchor itself was correct.
 */
export function computeScaleEncounterAvatarGroundedEyeHeight(
  avatar: ScaleEncounterAvatar,
): number {
  avatar.root.updateMatrixWorld(true)
  const eyeY = avatar.eyeAnchor.getWorldPosition(new Vector3()).y
  const bounds = new Box3().setFromObject(avatar.root, true)
  if (bounds.isEmpty() || !Number.isFinite(bounds.min.y)) return eyeY
  return eyeY - bounds.min.y
}

export function disposeScaleEncounterAvatar(
  avatar: ScaleEncounterAvatar,
  renderer?: { readonly renderLists: { dispose(): void } },
): void {
  avatar.root.removeFromParent()
  if (avatar.dispose) {
    avatar.dispose()
    renderer?.renderLists.dispose()
    return
  }
  disposeObject3D(avatar.root, renderer)
}

export const SCALE_ENCOUNTER_DEFINITIONS: Readonly<
  Record<ScaleEncounterAnimalId, ScaleEncounterDefinition>
> = {
  stegosaurus: {
    id: 'stegosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '2f1564c1f3f07e41ddb21b1f190621baba2ea5ea9c97c36cd89256ff60bddcea',
    displayedMeters: 8,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  pteranodon: {
    id: 'pteranodon',
    habitat: 'air',
    environmentTheme: 'sky',
    avatarProfile: 'air-wingsuit',
    avatarMotionPolicy: 'glide',
    calibratedModelSha256:
      'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1',
    displayedMeters: 7,
    scaleConfidence: 'range-midpoint',
    measurement: 'wingspan',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'centre',
    animalPosition: new Vector3(0, 4.8, 0),
    defaultDistance: 15,
    minimumDistance: 8,
    maximumDistance: 21,
    overviewFieldOfView: 29,
    povFieldOfView: 60,
    overviewDirection: new Vector3(
      Math.cos(MathUtils.degToRad(70)),
      Math.sin(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    overviewUp: new Vector3(
      -Math.sin(MathUtils.degToRad(70)),
      Math.cos(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    guidedTransitionDurationMs: 5_150,
    referenceAnimationTimeSeconds: 0,
  },
  pachycephalosaurus: {
    id: 'pachycephalosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'ac3539e1119aed28af89296f92f1bae02f0f5a796323bd1738f91c6b069dda48',
    displayedMeters: 4,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(1.8, 0, 0),
    defaultDistance: 8,
    minimumDistance: 4,
    maximumDistance: 12,
    overviewFieldOfView: 34,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_500,
    referenceAnimationTimeSeconds: 0,
  },
  ichthyosaur: {
    id: 'ichthyosaur',
    habitat: 'water',
    environmentTheme: 'ocean',
    avatarProfile: 'water-diver',
    avatarMotionPolicy: 'swim',
    calibratedModelSha256:
      '226f5f6055656f10498c641f0aa5a124dcfffc228d945b0f7484bfd480817f31',
    displayedMeters: 4,
    scaleConfidence: 'representative',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'centre',
    animalPosition: new Vector3(0.8, 1.25, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 32,
    povFieldOfView: 60,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_000,
    referenceAnimationTimeSeconds: 0,
  },
  'tyrannosaurus-rex': {
    id: 'tyrannosaurus-rex',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'ea15319ca1fa3724f1a961515c36b4834446f5ac30a9b0de49b62881877efa54',
    displayedMeters: 12,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    // Start far enough away that the open mouth does not dominate a narrow
    // phone viewport. Families can still move closer along the single rail.
    defaultDistance: 12.5,
    minimumDistance: 6.5,
    maximumDistance: 18,
    // A moderate lens restores readable foreground/midground separation. The
    // former 29° telephoto view flattened every environment layer into the
    // panorama and devoted half the frame to an empty floor.
    overviewFieldOfView: 38,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  rhamphorhynchus: {
    id: 'rhamphorhynchus',
    habitat: 'air',
    environmentTheme: 'sky',
    avatarProfile: 'air-wingsuit',
    avatarMotionPolicy: 'glide',
    calibratedModelSha256:
      '16b5ab37ac44e177c3e12c229e6f0b27fab669c3d6e74e5b5bdf54ed3a68a935',
    displayedMeters: 1.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'wingspan',
    // Turn the animal across the child's +Z flight rail, then measure the
    // now-world-Z wing axis so the reviewed 1.5 m wingspan stays unchanged.
    measurementAxis: 'z',
    modelYawRadians: Math.PI / 2,
    support: 'centre',
    animalPosition: new Vector3(0, 3.8, 0),
    defaultDistance: 7,
    minimumDistance: 3.5,
    maximumDistance: 11,
    overviewFieldOfView: 32,
    povFieldOfView: 60,
    overviewDirection: new Vector3(
      Math.cos(MathUtils.degToRad(70)),
      Math.sin(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    overviewUp: new Vector3(
      -Math.sin(MathUtils.degToRad(70)),
      Math.cos(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    guidedTransitionDurationMs: 4_500,
    referenceAnimationTimeSeconds: 0,
  },
  triceratops: {
    id: 'triceratops',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'e51eeb1c3b9c890cdef1f78c65a74179f2da6d4ed899b32e8833b87d2777cf33',
    displayedMeters: 8.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 12.5,
    minimumDistance: 6.5,
    maximumDistance: 18,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  apatosaurus: {
    id: 'apatosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '9d9f151933a33ae5824eb7532e16a7416b012b9ffff154aca2957ad37a2a540a',
    displayedMeters: 23,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    // The reviewed side-on pose already puts the head on the child's side.
    // Keeping that direction also preserves the full 23 m X-axis span.
    modelYawRadians: 0,
    support: 'ground',
    animalPosition: new Vector3(3.5, 0, 0),
    // Meet the head just beyond the silhouette instead of putting the child
    // eighteen metres past the tail, outside the useful overview frame.
    defaultDistance: 8,
    minimumDistance: 5,
    maximumDistance: 18,
    overviewFieldOfView: 40,
    povFieldOfView: 60,
    // With this side of the clearing facing the camera, the child remains on
    // screen-left while the animal stands on screen-right and faces the child.
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_500,
    referenceAnimationTimeSeconds: 0,
  },
  plesiosaurus: {
    id: 'plesiosaurus',
    habitat: 'water',
    environmentTheme: 'ocean',
    avatarProfile: 'water-diver',
    avatarMotionPolicy: 'swim',
    calibratedModelSha256:
      '4edc54ab21f61eb7b5e38c3b5d87a1816621547a9e7fde33cfdf3efd93b788a8',
    displayedMeters: 5,
    scaleConfidence: 'representative',
    measurement: 'body-length',
    measurementAxis: 'x',
    // Match the model's published -90° presentation so its nose-to-tail axis
    // lies on world X and the child meets the head rather than the flank.
    modelYawRadians: -Math.PI / 2,
    support: 'centre',
    animalPosition: new Vector3(0.9, 1.25, 0),
    defaultDistance: 8,
    minimumDistance: 4,
    maximumDistance: 14,
    overviewFieldOfView: 32,
    povFieldOfView: 60,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_000,
    referenceAnimationTimeSeconds: 0,
  },
  gigantoraptor: {
    id: 'gigantoraptor',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '26b137edc63f38defdf04d85903a30ad7817c83c5b3d5f5626a1fb2e6f216c0e',
    displayedMeters: 8,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  tupandactylus: {
    id: 'tupandactylus',
    habitat: 'air',
    environmentTheme: 'sky',
    avatarProfile: 'air-wingsuit',
    avatarMotionPolicy: 'glide',
    calibratedModelSha256:
      'e2c232534c909899d266fb75e1787117d7e17396d677a82e1a63a0872f2f385e',
    displayedMeters: 2.7,
    scaleConfidence: 'range-midpoint',
    measurement: 'wingspan',
    // Face the head toward the child without turning the 2.7 m wing axis into
    // a body-length calibration.
    measurementAxis: 'z',
    modelYawRadians: Math.PI / 2,
    support: 'centre',
    animalPosition: new Vector3(0, 4.2, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 31,
    povFieldOfView: 60,
    overviewDirection: new Vector3(
      Math.cos(MathUtils.degToRad(70)),
      Math.sin(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    overviewUp: new Vector3(
      -Math.sin(MathUtils.degToRad(70)),
      Math.cos(MathUtils.degToRad(70)),
      0,
    ).normalize(),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  mammoth: {
    id: 'mammoth',
    habitat: 'land',
    environmentTheme: 'glacier',
    avatarProfile: 'snow-expedition',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '623a62621f1c6f2955fd3fe6442be8dfd34cdc94064e1bbb0c5e43e8970a1ece',
    // Published sources give a 3–3.5 m adult shoulder-height range. The
    // midpoint is used only as a deliberately approximate visual calibration:
    // this source GLB is titled “Baby”, while its tusks and proportions do not
    // establish age. The model's vertical AABB reaches the shoulder hump, so
    // the Y span is a more honest proxy than inventing an adult body length.
    displayedMeters: 3.25,
    scaleConfidence: 'range-midpoint',
    measurement: 'shoulder-height',
    measurementAxis: 'y',
    modelYawRadians: 0,
    support: 'ground',
    animalPosition: new Vector3(1.8, 0, 0),
    // The mammoth is less visually aggressive than the open-mouthed T. rex,
    // but ten metres still lets a preschool child take in the whole silhouette
    // before choosing to move closer on the constrained observation rail.
    defaultDistance: 10,
    minimumDistance: 5.5,
    maximumDistance: 15,
    overviewFieldOfView: 30,
    povFieldOfView: 56,
    overviewDirection: new Vector3(0, 0.025, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_000,
    referenceAnimationTimeSeconds: 0,
    // Headless Blender 5.2 evaluation of the formal GLB's skinned mesh at the
    // same t=0 Idle review pose. 3.25 / 1.3191838264465332 = 2.463644516
    // metres per source unit. The model SHA above makes this evidence stale
    // rather than silently transferable if the formal GLB changes.
    reviewedRawSpanUnits: 1.3191838264465332,
  },
  megalodon: {
    id: 'megalodon',
    habitat: 'water',
    environmentTheme: 'ocean',
    avatarProfile: 'water-diver',
    avatarMotionPolicy: 'swim',
    calibratedModelSha256:
      'dcd9ab8192cd1d38adf1c2ed664e040fed24a8d8498295fca138c887822d2070',
    displayedMeters: 16,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    // The source animal's nose-to-tail axis becomes world X at -90°. Measuring
    // the unturned head width had produced an unintended roughly 47 m shark.
    modelYawRadians: -Math.PI / 2,
    support: 'centre',
    animalPosition: new Vector3(1.5, 1.25, 0),
    defaultDistance: 20,
    minimumDistance: 10,
    maximumDistance: 28,
    overviewFieldOfView: 31,
    povFieldOfView: 60,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_700,
    referenceAnimationTimeSeconds: 0,
  },
  maiasaura: {
    id: 'maiasaura',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '31dca5fff3c4c361153385ac6e603c8f6916c26576bb4b8bae4db4f735b6fd27',
    displayedMeters: 8,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  sauropelta: {
    id: 'sauropelta',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'ef283def4b17e92122442c8cfb617dce7abecf0bdc1962dc2ff1f18835e7a58c',
    displayedMeters: 5.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'ground',
    animalPosition: new Vector3(2, 0, 0),
    defaultDistance: 5,
    minimumDistance: 2.75,
    maximumDistance: 12,
    overviewFieldOfView: 35,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_600,
    referenceAnimationTimeSeconds: 0,
  },
  meganeura: {
    id: 'meganeura',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '4e388ade5b32132cc60054fa51dc7ac0fe48372efafaf4c57732697b3874589b',
    displayedMeters: 0.7,
    scaleConfidence: 'range-midpoint',
    measurement: 'wingspan',
    measurementAxis: 'x',
    modelYawRadians: MathUtils.degToRad(-18),
    support: 'centre',
    animalPosition: new Vector3(0.8, 1.7, 0),
    defaultDistance: 2.5,
    minimumDistance: 1.25,
    maximumDistance: 5,
    overviewFieldOfView: 32,
    povFieldOfView: 54,
    overviewDirection: new Vector3(0, 0.04, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_300,
    referenceAnimationTimeSeconds: 0,
  },
  dilophosaurus: {
    id: 'dilophosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '51b895d460d1fc73103e92a632c4aea22e025ee468ab2a011474711711f965f6',
    displayedMeters: 6.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: Math.PI,
    support: 'ground',
    animalPosition: new Vector3(2.1, 0, 0),
    defaultDistance: 6,
    minimumDistance: 3.25,
    maximumDistance: 14,
    overviewFieldOfView: 35,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_600,
    referenceAnimationTimeSeconds: 0,
  },
  mosasaurus: {
    id: 'mosasaurus',
    habitat: 'water',
    environmentTheme: 'ocean',
    avatarProfile: 'water-diver',
    avatarMotionPolicy: 'swim',
    calibratedModelSha256:
      'c36e49446fb6f34a25deb1e1421118d24aaf608fde1654c2f667437702863e59',
    displayedMeters: 12,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'centre',
    animalPosition: new Vector3(1.2, 1.25, 0),
    defaultDistance: 20,
    minimumDistance: 10,
    maximumDistance: 27,
    overviewFieldOfView: 29,
    povFieldOfView: 60,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_500,
    referenceAnimationTimeSeconds: 0,
  },
  spinosaurus: {
    id: 'spinosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'b4b97f2df0acc376495689351bc2c5e1067ab17bd2cd5f8ce4be83e3213d4c84',
    displayedMeters: 14.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.6, 0, 0),
    // Keep the child close enough to remain recognisable beside the long
    // silhouette in a portrait overview; families can still back away to 25 m.
    defaultDistance: 12.5,
    minimumDistance: 9,
    maximumDistance: 25,
    overviewFieldOfView: 38,
    povFieldOfView: 58,
    // Keep most of the 14.5 m silhouette visible while looking partly along
    // the child's diagonal rail. The child then reads as foreground scale
    // instead of disappearing at the far-left edge of the comparison.
    overviewDirection: new Vector3(
      Math.cos(MathUtils.degToRad(132)),
      0.02,
      Math.sin(MathUtils.degToRad(132)),
    ).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 5_100,
    referenceAnimationTimeSeconds: 0,
  },
  lystrosaurus: {
    id: 'lystrosaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'f3edc52dc7bbfec681cb7b30b8246f65b84f2980b6bd04f8eee46e5f6a62551a',
    displayedMeters: 1.5,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(1.1, 0, 0),
    defaultDistance: 4,
    minimumDistance: 2,
    maximumDistance: 7,
    overviewFieldOfView: 35,
    povFieldOfView: 56,
    overviewDirection: new Vector3(0, 0.025, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_300,
    referenceAnimationTimeSeconds: 0,
  },
  baryonyx: {
    id: 'baryonyx',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      '6bd4dbf4924e8b0c22e3687eaed30889d8bbf4f0463395cffc9e458d2688ffdc',
    displayedMeters: 8.75,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 13,
    minimumDistance: 6.5,
    maximumDistance: 19,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  archaeopteryx: {
    id: 'archaeopteryx',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'bf3e125a0b834202ba4a3709788375165d68bcd79691692a17debc22702e89da',
    displayedMeters: 0.5,
    scaleConfidence: 'representative',
    measurement: 'body-length',
    // The authored body axis is local +Z. Turn it across the forest clearing
    // so the child sees the complete half-metre profile while the feet rest on
    // the low fallen log rather than floating in the former sky scene.
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0.3, 0),
    // A 3.6 m rail made the half-metre beak-to-tail silhouette and the child
    // occupy opposite edges of the overview. At 1.8 m they still have a calm,
    // plausible clearing between them, while the true 2:1 length/height
    // comparison is readable without enlarging the animal.
    defaultDistance: 1.8,
    minimumDistance: 1.4,
    maximumDistance: 5,
    overviewFieldOfView: 36,
    povFieldOfView: 56,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_400,
    referenceAnimationTimeSeconds: 0,
  },
  carnotaurus: {
    id: 'carnotaurus',
    habitat: 'land',
    environmentTheme: 'forest',
    avatarProfile: 'land-explorer',
    avatarMotionPolicy: 'adaptive-land',
    calibratedModelSha256:
      'e66ebb901782706aadd2a054bd7965f1c819ead52f73baa5fcf34ca3427265f8',
    displayedMeters: 8,
    scaleConfidence: 'representative',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: -Math.PI / 2,
    support: 'ground',
    animalPosition: new Vector3(2.2, 0, 0),
    defaultDistance: 12,
    minimumDistance: 6,
    maximumDistance: 18,
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.02, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_700,
    referenceAnimationTimeSeconds: 0,
  },
  anomalocaris: {
    id: 'anomalocaris',
    habitat: 'water',
    environmentTheme: 'ocean',
    avatarProfile: 'water-diver',
    avatarMotionPolicy: 'swim',
    calibratedModelSha256:
      '147de95a18c771739f918e8ce0319c00fba560d6f415305f57fddc97b96f661a',
    displayedMeters: 0.6,
    scaleConfidence: 'range-midpoint',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: Math.PI,
    support: 'centre',
    animalPosition: new Vector3(0.6, 1.35, 0),
    defaultDistance: 4,
    minimumDistance: 2,
    maximumDistance: 8,
    overviewFieldOfView: 34,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.04, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4_400,
    referenceAnimationTimeSeconds: 0,
  },
}

const AIR_RAIL_DIRECTION = new Vector3(0, 0, 1)
const WATER_RAIL_DIRECTION = new Vector3(-0.82, -0.34, 0.46).normalize()
const PLESIOSAUR_FACE_RAIL_DIRECTION = new Vector3(
  -0.45,
  -0.25,
  0.86,
).normalize()

export function isScaleEncounterAnimalId(
  value: string,
): value is ScaleEncounterAnimalId {
  return Object.prototype.hasOwnProperty.call(
    SCALE_ENCOUNTER_DEFINITIONS,
    value,
  )
}

export function clampScaleEncounterValue(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function normalizeScaleEncounterProfile(
  profile: ScaleEncounterProfile,
): NormalizedScaleEncounterProfile {
  const finiteHeight = Number.isFinite(profile.heightCm)
    ? profile.heightCm
    : 110
  const heightCm = clampScaleEncounterValue(
    Math.round(finiteHeight / 5) * 5,
    90,
    130,
  )
  return {
    approach: profile.approach === 'close' ? 'close' : 'comfortable',
    gender: profile.gender,
    heightCm,
    heightMeters: heightCm / 100,
  }
}

export function clampScaleEncounterDistance(
  animalId: ScaleEncounterAnimalId,
  distance: number,
): number {
  const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
  if (!Number.isFinite(distance)) {
    return definition.defaultDistance
  }
  return clampScaleEncounterValue(
    distance,
    definition.minimumDistance,
    definition.maximumDistance,
  )
}

const AVATAR_WORLD_UP = new Vector3(0, 1, 0)
const AVATAR_HEADING_FALLBACK_SIDE = new Vector3(0, 0, 1)

/**
 * Builds the outer-wrapper heading for a character that owns local +X as its
 * travel axis. Ground characters stay vertical and use yaw only. Flight and
 * scuba characters follow a three-dimensional rail while retaining a stable
 * projected world-up, so they pitch without an accidental camera-like roll.
 */
export function computeScaleEncounterAvatarTravelQuaternion(
  travelDirection: Readonly<Vector3>,
  habitat: ScaleEncounterHabitat,
  fallbackYawRadians: number,
  result = new Quaternion(),
): Quaternion {
  const forward = new Vector3().copy(travelDirection)
  if (habitat === 'land') forward.y = 0
  if (forward.lengthSq() <= 1e-10) {
    return result.setFromAxisAngle(AVATAR_WORLD_UP, fallbackYawRadians)
  }
  forward.normalize()

  if (habitat === 'land') {
    return result.setFromAxisAngle(
      AVATAR_WORLD_UP,
      Math.atan2(-forward.z, forward.x),
    )
  }

  const up = AVATAR_WORLD_UP.clone().addScaledVector(
    forward,
    -AVATAR_WORLD_UP.dot(forward),
  )
  if (up.lengthSq() <= 1e-8) {
    up.copy(AVATAR_HEADING_FALLBACK_SIDE).addScaledVector(
      forward,
      -AVATAR_HEADING_FALLBACK_SIDE.dot(forward),
    )
  }
  up.normalize()
  const side = new Vector3().crossVectors(forward, up).normalize()
  up.crossVectors(side, forward).normalize()
  return result.setFromRotationMatrix(
    new Matrix4().makeBasis(forward, up, side),
  )
}

export function scaleEncounterAvatarMotionFor(
  animalId: ScaleEncounterAnimalId,
  speedMetersPerSecond: number,
): ScaleEncounterAvatarMotion {
  const policy = SCALE_ENCOUNTER_DEFINITIONS[animalId].avatarMotionPolicy
  if (policy === 'glide') return 'glide'
  if (policy === 'swim') {
    return speedMetersPerSecond > 0.02 ? 'swim' : 'idle'
  }
  if (speedMetersPerSecond <= 0.02) return 'idle'
  if (policy === 'walk-only') return 'walk'
  return speedMetersPerSecond >= 2.2 ? 'run' : 'walk'
}

export function positionOnScaleEncounterRail(
  target: Readonly<Vector3>,
  railDirection: Readonly<Vector3>,
  distance: number,
  result = new Vector3(),
): Vector3 {
  return result
    .copy(railDirection)
    .normalize()
    .multiplyScalar(distance)
    .add(target)
}

export function scaleEncounterElevationDegrees(
  observer: Readonly<Vector3>,
  target: Readonly<Vector3>,
): number {
  const horizontalDistance = Math.hypot(
    target.x - observer.x,
    target.z - observer.z,
  )
  return (
    (Math.atan2(target.y - observer.y, horizontalDistance) * 180) /
    Math.PI
  )
}

function pointInBounds(
  boundsMinimum: Readonly<Vector3>,
  boundsMaximum: Readonly<Vector3>,
  xFraction: number,
  yFraction: number,
  zFraction: number,
): Vector3 {
  return new Vector3(
    boundsMinimum.x + (boundsMaximum.x - boundsMinimum.x) * xFraction,
    boundsMinimum.y + (boundsMaximum.y - boundsMinimum.y) * yFraction,
    boundsMinimum.z + (boundsMaximum.z - boundsMinimum.z) * zFraction,
  )
}

function yawTowardTarget(
  eyePosition: Readonly<Vector3>,
  target: Readonly<Vector3>,
): number {
  const x = target.x - eyePosition.x
  const z = target.z - eyePosition.z
  // The canonical child's runtime wrapper faces local +X. Positive Y
  // rotation maps +X toward -Z in Three.js.
  return Math.atan2(-z, x)
}

export function createScaleEncounterPlacement(
  animalId: ScaleEncounterAnimalId,
  boundsMinimum: Readonly<Vector3>,
  boundsMaximum: Readonly<Vector3>,
  childGroundedEyeHeightMeters: number,
  groundFootprint?: readonly Vector3[],
): ScaleEncounterPlacement {
  const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
  const orbitCenter = new Vector3()
    .addVectors(boundsMinimum, boundsMaximum)
    .multiplyScalar(0.5)
  let target: Vector3
  let observerRailDirection: Vector3

  if (definition.habitat === 'land') {
    target = pointInBounds(
      boundsMinimum,
      boundsMaximum,
      animalId === 'tyrannosaurus-rex' ? 0.19 : 0.1,
      animalId === 'tyrannosaurus-rex' ? 0.58 : 0.72,
      0.5,
    )
    const verticalOffset = childGroundedEyeHeightMeters - target.y
    const horizontalDistance = Math.sqrt(
      Math.max(definition.defaultDistance ** 2 - verticalOffset ** 2, 0),
    )
    // The open-mouthed Spinosaurus faces along -X. Offset its authored rail
    // toward +Z so eye view reads as a calm three-quarter head view. Forty-two
    // degrees also carries more of the child-to-animal gap into screen depth,
    // keeping the long animal and child balanced on wide and phone overviews.
    const railAzimuthRadians =
      animalId === 'spinosaurus'
        ? MathUtils.degToRad(42)
        : animalId === 'archaeopteryx'
          // Keep the complete beak-to-tail profile broadside to the overview,
          // but place the child partly in screen depth so a phone does not
          // pin the two true-scale subjects to opposite edges.
          ? MathUtils.degToRad(30)
          : 0
    observerRailDirection = new Vector3(
      -horizontalDistance * Math.cos(railAzimuthRadians),
      verticalOffset,
      horizontalDistance * Math.sin(railAzimuthRadians),
    ).normalize()
  } else if (definition.habitat === 'air') {
    target = pointInBounds(boundsMinimum, boundsMaximum, 0.5, 0.5, 0.5)
    observerRailDirection = AIR_RAIL_DIRECTION.clone()
  } else {
    // From this left/lower/front line the child sees the belly, both pairs of
    // flippers, tail and the bright water surface. The line never puts the
    // child behind the animal's tail.
    target =
      animalId === 'plesiosaurus'
        ? // The reviewed plesiosaur curls its neck toward the front-left.
          // Start at its head so eye view is genuinely face-to-face; the
          // overview remains available for comparing the complete body.
          pointInBounds(boundsMinimum, boundsMaximum, 0.08, 0.8, 0.5)
        : pointInBounds(boundsMinimum, boundsMaximum, 0.48, 0.3, 0.5)
    observerRailDirection =
      animalId === 'plesiosaurus'
        ? PLESIOSAUR_FACE_RAIL_DIRECTION.clone()
        : WATER_RAIL_DIRECTION.clone()
  }

  const defaultEyePosition = positionOnScaleEncounterRail(
    target,
    observerRailDirection,
    definition.defaultDistance,
  )
  return {
    animalId,
    ...(groundFootprint ? { groundFootprint } : {}),
    animalBoundsMaximum: new Vector3().copy(boundsMaximum),
    animalBoundsMinimum: new Vector3().copy(boundsMinimum),
    orbitCenter,
    target,
    observerRailDirection,
    defaultEyePosition,
    defaultDistance: definition.defaultDistance,
    minimumDistance: definition.minimumDistance,
    maximumDistance: definition.maximumDistance,
    avatarYawRadians: yawTowardTarget(defaultEyePosition, target),
  }
}

export function updateScaleEncounterAvatarIdle(
  avatar: ScaleEncounterAvatar,
  elapsedSeconds: number,
  reducedMotion: boolean,
): void {
  if (avatar.updateIdle) {
    avatar.updateIdle(elapsedSeconds, reducedMotion)
    return
  }
  if (!avatar.leftArm || !avatar.rightArm || !avatar.torso) return
  const baseLeftArmRotationX = avatar.baseLeftArmRotationX ?? 0
  const baseRightArmRotationX = avatar.baseRightArmRotationX ?? 0
  if (reducedMotion) {
    avatar.leftArm.rotation.x = baseLeftArmRotationX
    avatar.rightArm.rotation.x = baseRightArmRotationX
    avatar.torso.scale.y = 1
    return
  }
  const armSwing = Math.sin(elapsedSeconds * 1.25) * 0.025
  avatar.leftArm.rotation.x = baseLeftArmRotationX + armSwing
  avatar.rightArm.rotation.x = baseRightArmRotationX - armSwing
  avatar.torso.scale.y = 1 + Math.sin(elapsedSeconds * 1.1) * 0.006
}
