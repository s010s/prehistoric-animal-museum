import { Box3, Vector3 } from 'three'

export type SkyEnvironmentVariant = 'A' | 'B' | 'C'

export type SkyLayerId =
  | 'subject'
  | 'near-air'
  | 'mid-cloud'
  | 'far-cloud'
  | 'background-atmosphere'
  | 'flight-volume'

export type SkyCameraStage =
  | 'overview'
  | 'side-establishing'
  | 'child-rear'
  | 'eye-entry'
  | 'pov'
  | 'review-orbit'

export type SkyCameraRange = 'minimum' | 'default' | 'maximum'

export interface SkyRendererCapabilities {
  readonly isWebGl2: boolean
  readonly maxAnisotropy: number
  readonly maxTextureSize: number
  readonly pixelRatio: number
  readonly renderer: string
  readonly vendor: string
}

export interface SkyCameraState {
  readonly aspect: number
  readonly far: number
  readonly fieldOfViewDegrees: number
  readonly near: number
  readonly position: Readonly<Vector3>
  readonly stage: SkyCameraStage
  readonly target: Readonly<Vector3>
  readonly viewportHeight: number
  readonly viewportWidth: number
}

export interface SkyAssetLeaseIdentity {
  readonly assetId: string
  readonly manifestSha256: string
  readonly productionApproved: false
  readonly status: 'review-candidate'
}

export interface SkyHeightBand {
  readonly id: 'subject-flight' | 'near-air' | 'mid-cloud' | 'far-cloud'
  readonly maximumAltitudeMeters: number
  readonly minimumAltitudeMeters: number
}

export interface SkyVariantDefinition {
  readonly id: SkyEnvironmentVariant
  readonly label: string
  readonly layers: readonly SkyLayerId[]
  readonly purpose: string
}

export const SKY_SCENE_CONTRACT_REVISION =
  'sky-coastal-flight-vertical-slice-v1' as const

export const SKY_REFERENCE_Y_METERS = -60

export const SKY_LOCKED_SUBJECT = {
  animalId: 'pteranodon',
  calibratedModelSha256:
    'abcde65b2ea29c6ae86d8232a5e1a604b05099deb34cebfb30495aff53f61af1',
  displayedWingspanMeters: 7,
  support: 'centre',
} as const

export const SKY_LOCKED_AVATAR_BASES = {
  equipmentRigId: 'child-base-v3-meshy-24',
  authoredHeightMeters: 1.15,
  animation: 'Idle_Land',
  neutralPose: 'neutral-idle-v1',
  boy: {
    filename: 'child-avatar-v3-boy-land-normal.glb',
    sha256:
      '76eabc9cfa7c9d79b473f8998e449bbc874e292147b003969377ff719ec080d6',
  },
  girl: {
    filename: 'child-avatar-v3-girl-land-normal.glb',
    sha256:
      '0ed1bdfa7b0108addd8d134d7b90657c136222e068511606160b53c213601716',
  },
  outfitSafetyBounds: null,
} as const

export const SKY_LOCKED_CAMERA = {
  animalPosition: new Vector3(0, 4.8, 0),
  defaultDistanceMeters: 15,
  minimumDistanceMeters: 8,
  maximumDistanceMeters: 21,
  overviewFieldOfViewDegrees: 29,
  overviewZoom: {
    minimum: 0.82,
    default: 1,
    maximum: 1.18,
  },
  overviewDirection: new Vector3(
    Math.cos((70 * Math.PI) / 180),
    Math.sin((70 * Math.PI) / 180),
    0,
  ).normalize(),
  overviewUp: new Vector3(
    -Math.sin((70 * Math.PI) / 180),
    Math.cos((70 * Math.PI) / 180),
    0,
  ).normalize(),
  povFieldOfViewDegrees: 60,
  transitionDurationMs: 5_150,
} as const

export const SKY_HEIGHT_BANDS: readonly SkyHeightBand[] = [
  {
    id: 'subject-flight',
    minimumAltitudeMeters: 58,
    maximumAltitudeMeters: 78,
  },
  {
    id: 'near-air',
    minimumAltitudeMeters: 78,
    maximumAltitudeMeters: 105,
  },
  {
    id: 'mid-cloud',
    minimumAltitudeMeters: 34,
    maximumAltitudeMeters: 57,
  },
  {
    id: 'far-cloud',
    minimumAltitudeMeters: 16,
    maximumAltitudeMeters: 33,
  },
] as const

export const SKY_VARIANTS: Readonly<
  Record<SkyEnvironmentVariant, SkyVariantDefinition>
> = {
  A: {
    id: 'A',
    label: 'Background only',
    layers: ['subject', 'background-atmosphere'],
    purpose:
      'Tests the seam-safe clear-sky direction layer and locked two-subject composition.',
  },
  B: {
    id: 'B',
    label: 'Flight volume + sea',
    layers: ['subject', 'background-atmosphere', 'flight-volume'],
    purpose:
      'Adds the declared flight volume, world-space sea and one restrained distant coastline.',
  },
  C: {
    id: 'C',
    label: 'Layered coastal sky',
    layers: [
      'subject',
      'background-atmosphere',
      'flight-volume',
      'near-air',
      'mid-cloud',
      'far-cloud',
    ],
    purpose:
      'Adds sparse near, mid and far cloud structure plus horizon atmosphere while preserving the subject corridor.',
  },
} as const

export function isSkyEnvironmentVariant(
  value: string,
): value is SkyEnvironmentVariant {
  return value === 'A' || value === 'B' || value === 'C'
}

export function skyLayersForVariant(
  variant: SkyEnvironmentVariant,
): readonly SkyLayerId[] {
  return SKY_VARIANTS[variant].layers
}

export function skyAltitudeMeters(worldY: number): number {
  return worldY - SKY_REFERENCE_Y_METERS
}

export function skyBandForAltitude(
  altitudeMeters: number,
): SkyHeightBand | null {
  return (
    SKY_HEIGHT_BANDS.find(
      (band) =>
        altitudeMeters >= band.minimumAltitudeMeters &&
        altitudeMeters <= band.maximumAltitudeMeters,
    ) ?? null
  )
}

export function cloneSkyBounds(bounds: Readonly<Box3>): Box3 {
  return new Box3(bounds.min.clone(), bounds.max.clone())
}
