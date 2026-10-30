import type { AnimalKind, AtmosphereKind, Habitat } from '../content/types'

/** Historical review packet IDs; canonical entries take precedence after local promotion. */
export const SKY_EXPANSION_REVIEW_IDS = [
  'regaliceratops',
  'sarcosuchus',
  'anurognathus',
  'therizinosaurus',
  'phorusrhacos',
  'sordes',
  'quetzalcoatlus',
  'dallasaurus',
  'dakosaurus',
] as const

export type SkyExpansionReviewAnimalId = (typeof SKY_EXPANSION_REVIEW_IDS)[number]

export const SKY_EXPANSION_REVIEW_ID_SET: ReadonlySet<string> = new Set(
  SKY_EXPANSION_REVIEW_IDS,
)

export interface ReviewPresentationContext {
  readonly kind: AnimalKind
  readonly habitat: Habitat
  readonly atmosphere: AtmosphereKind
  /** GLBs are Y-up with the head along +X and the wings along Z. */
  readonly initialYawDegrees: number
  readonly comparisonYawRadians: number
  /** Axis of the posed world bounds after the comparison yaw is applied. */
  readonly comparisonMeasurementAxis?: 'x' | 'y' | 'z'
  readonly initialRotationZDegrees?: number
  readonly safeAreaPadding?: number
  readonly portraitSafeAreaPadding?: number
  readonly cameraLightScale?: number
  readonly toneMappingExposure?: number
}

export const skyExpansionPresentation = {
  regaliceratops: { kind: 'dinosaur', habitat: 'land', atmosphere: 'forest', initialYawDegrees: -150, comparisonYawRadians: Math.PI },
  sarcosuchus: { kind: 'other-prehistoric-animal', habitat: 'land', atmosphere: 'forest', initialYawDegrees: -160, comparisonYawRadians: Math.PI },
  anurognathus: { kind: 'pterosaur', habitat: 'air', atmosphere: 'air', initialYawDegrees: -115, comparisonYawRadians: 0 },
  therizinosaurus: { kind: 'dinosaur', habitat: 'land', atmosphere: 'forest', initialYawDegrees: -155, comparisonYawRadians: Math.PI },
  phorusrhacos: { kind: 'other-prehistoric-animal', habitat: 'land', atmosphere: 'plains', initialYawDegrees: -150, comparisonYawRadians: Math.PI },
  sordes: { kind: 'pterosaur', habitat: 'air', atmosphere: 'air', initialYawDegrees: -130, comparisonYawRadians: -Math.PI / 2, comparisonMeasurementAxis: 'x', safeAreaPadding: .15, portraitSafeAreaPadding: .20, cameraLightScale: 1.35, toneMappingExposure: 1.15 },
  quetzalcoatlus: { kind: 'pterosaur', habitat: 'air', atmosphere: 'air', initialYawDegrees: -130, comparisonYawRadians: 0 },
  dallasaurus: { kind: 'marine-reptile', habitat: 'water', atmosphere: 'underwater', initialYawDegrees: -155, comparisonYawRadians: Math.PI },
  dakosaurus: { kind: 'marine-reptile', habitat: 'water', atmosphere: 'underwater', initialYawDegrees: -155, initialRotationZDegrees: 9, comparisonYawRadians: Math.PI },
} as const satisfies Record<SkyExpansionReviewAnimalId, ReviewPresentationContext>
