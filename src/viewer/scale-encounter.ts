import {
  Box3,
  MathUtils,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
} from 'three'
import { disposeObject3D } from './dispose'

export type ScaleEncounterAnimalId =
  | 'tyrannosaurus-rex'
  | 'pteranodon'
  | 'mosasaurus'
  | 'mammoth'

export type ScaleEncounterHabitat = 'land' | 'air' | 'water'
export type ScaleEncounterGender = 'boy' | 'girl'
export type ScaleEncounterView = 'overview' | 'pov'
export type ScaleEncounterCameraStage =
  | 'overview'
  | 'side-establishing'
  | 'child-rear'
  | 'eye-entry'
  | 'pov'

export interface ScaleEncounterProfile {
  readonly gender: ScaleEncounterGender
  readonly heightCm: number
}

export interface NormalizedScaleEncounterProfile {
  readonly gender: ScaleEncounterGender
  readonly heightCm: number
  readonly heightMeters: number
}

export interface ScaleEncounterSnapshot {
  readonly active: boolean
  readonly animalId: ScaleEncounterAnimalId | null
  readonly cameraStage: ScaleEncounterCameraStage
  readonly view: ScaleEncounterView
  readonly transitioning: boolean
  readonly distanceMeters: number | null
  readonly overviewZoom: number
  readonly error: string | null
  readonly profile: NormalizedScaleEncounterProfile | null
  readonly rawSpanUnits: number | null
  readonly metersPerUnit: number | null
}

export interface ScaleEncounterDefinition {
  readonly id: ScaleEncounterAnimalId
  readonly habitat: ScaleEncounterHabitat
  readonly calibratedModelSha256: string
  readonly displayedMeters: number
  readonly measurement: 'body-length' | 'wingspan' | 'shoulder-height'
  readonly measurementAxis: 'x' | 'y'
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
  'tyrannosaurus-rex': {
    id: 'tyrannosaurus-rex',
    habitat: 'land',
    calibratedModelSha256:
      'ea15319ca1fa3724f1a961515c36b4834446f5ac30a9b0de49b62881877efa54',
    displayedMeters: 12,
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
  pteranodon: {
    id: 'pteranodon',
    habitat: 'air',
    calibratedModelSha256:
      'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1',
    displayedMeters: 7,
    measurement: 'wingspan',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'centre',
    animalPosition: new Vector3(0, 4.8, 0),
    // A 15 m start keeps the final eye-level encounter comfortable while the
    // separate opening camera shows the two wingspans from above.
    defaultDistance: 15,
    minimumDistance: 8,
    maximumDistance: 21,
    overviewFieldOfView: 29,
    povFieldOfView: 60,
    // The opening comparison is intentionally top-down: both the child's
    // wingsuit and the animal's reviewed wingspan remain readable at once.
    // Seventy degrees feels overhead without making the move to the later
    // eye-level view a near-vertical camera flip. Screen-right points toward
    // world -Z, so the child on the +Z rail appears on the left and the animal
    // on the right, matching the side-by-side story Leon specified. Their
    // world-X wingspans remain parallel and read vertically in this view.
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
  mosasaurus: {
    id: 'mosasaurus',
    habitat: 'water',
    calibratedModelSha256:
      '5071da06a8a12bf0e3396d84bd3bfd86a3f9f378f322cda53bd69cc3541aa47d',
    displayedMeters: 12,
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: 0,
    support: 'centre',
    animalPosition: new Vector3(1.2, 1.25, 0),
    // The diagonal underwater sight line foreshortens less than a head-on
    // view, so the child starts farther back and sees the whole passing body.
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
  mammoth: {
    id: 'mammoth',
    habitat: 'land',
    calibratedModelSha256:
      '623a62621f1c6f2955fd3fe6442be8dfd34cdc94064e1bbb0c5e43e8970a1ece',
    // Published sources give a 3–3.5 m adult shoulder-height range. The
    // midpoint is used only as a deliberately approximate visual calibration:
    // this source GLB is titled “Baby”, while its tusks and proportions do not
    // establish age. The model's vertical AABB reaches the shoulder hump, so
    // the Y span is a more honest proxy than inventing an adult body length.
    displayedMeters: 3.25,
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
}

const AIR_RAIL_DIRECTION = new Vector3(0, 0, 1)
const WATER_RAIL_DIRECTION = new Vector3(-0.82, -0.34, 0.46).normalize()

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
): ScaleEncounterPlacement {
  const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
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
    observerRailDirection = new Vector3(
      -horizontalDistance,
      verticalOffset,
      0,
    ).normalize()
  } else if (definition.habitat === 'air') {
    target = pointInBounds(boundsMinimum, boundsMaximum, 0.5, 0.5, 0.5)
    observerRailDirection = AIR_RAIL_DIRECTION.clone()
  } else {
    // From this left/lower/front line the child sees the belly, both pairs of
    // flippers, tail and the bright water surface. The line never puts the
    // child behind the animal's tail.
    target = pointInBounds(boundsMinimum, boundsMaximum, 0.48, 0.3, 0.5)
    observerRailDirection = WATER_RAIL_DIRECTION.clone()
  }

  const defaultEyePosition = positionOnScaleEncounterRail(
    target,
    observerRailDirection,
    definition.defaultDistance,
  )
  return {
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
