import { comparisonMetadata } from 'virtual:canonical-comparison-extension'
import { SKY_EXPANSION_REVIEW_ID_SET, type SkyExpansionReviewAnimalId } from '../review/sky-expansion-config'
export const SCALE_ENCOUNTER_ANIMAL_IDS = [
  'stegosaurus',
  'pteranodon',
  'pachycephalosaurus',
  'ichthyosaur',
  'tyrannosaurus-rex',
  'rhamphorhynchus',
  'triceratops',
  'apatosaurus',
  'plesiosaurus',
  'gigantoraptor',
  'tupandactylus',
  'mammoth',
  'megalodon',
  'maiasaura',
  'sauropelta',
  'meganeura',
  'dilophosaurus',
  'mosasaurus',
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris',
] as const

/**
 * Draft animals that may enter the local "compare with me" review flow.
 * The current expansion has been promoted, so no local-only IDs remain.
 */
export const REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS = [] as const

/** Local-only review animals whose bilingual compare narration is available. */
export const NARRATED_REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS = [] as const

export type ProductionScaleEncounterAnimalId =
  (typeof SCALE_ENCOUNTER_ANIMAL_IDS)[number]

export type ReviewScaleEncounterAnimalId =
  | SkyExpansionReviewAnimalId
  | 'expansion-parasaurolophus'
  | 'expansion-dimetrodon'
  | 'expansion-gallimimus'
  | 'expansion-ankylosaurus'
  | 'expansion-styxosaurus'
  | 'expansion-livyatan'
  | 'expansion-allosaurus-pandras'
  | 'expansion-xiphactinus'

export type CanonicalAddedScaleEncounterAnimalId =
  | 'parasaurolophus' | 'dimetrodon' | 'gallimimus' | 'ankylosaurus'
  | 'styxosaurus' | 'livyatan' | 'allosaurus-pandras' | 'xiphactinus'

export type ScaleEncounterAnimalId =
  | ProductionScaleEncounterAnimalId
  | CanonicalAddedScaleEncounterAnimalId
  | ReviewScaleEncounterAnimalId

export const selectedScaleEncounterAnimalIds = [
  ...SCALE_ENCOUNTER_ANIMAL_IDS, ...Object.keys(comparisonMetadata),
] as readonly ScaleEncounterAnimalId[]

export type ScaleEncounterEnvironmentTheme =
  | 'forest'
  | 'glacier'
  | 'sky'
  | 'ocean'

export type ScaleEncounterAvatarPresentationProfile =
  | 'land-explorer'
  | 'snow-expedition'
  | 'air-wingsuit'
  | 'water-diver'

export type ScaleEncounterScaleConfidence = 'range-midpoint' | 'representative'

export type ScaleEncounterApproach = 'comfortable' | 'close'

export type ChildProfile = {
  readonly approach?: ScaleEncounterApproach
  readonly gender: 'boy' | 'girl'
  readonly heightCm: number
}

const SCALE_ENCOUNTER_ANIMAL_ID_SET = new Set<string>(
  [...selectedScaleEncounterAnimalIds, ...REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS],
)

/** Called only after a local candidate has a definition and calibrated model. */
export function registerReviewScaleEncounterAnimal(id: ReviewScaleEncounterAnimalId): void {
  if ((import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE !== 'review' ||
      (!/^expansion-[a-z0-9-]+$/.test(id) && !SKY_EXPANSION_REVIEW_ID_SET.has(id))) {
    throw new Error('Candidate comparison registration is local-review only.')
  }
  SCALE_ENCOUNTER_ANIMAL_ID_SET.add(id)
}

const PRODUCTION_SCALE_ENCOUNTER_ANIMAL_ID_SET: ReadonlySet<string> = new Set(
  SCALE_ENCOUNTER_ANIMAL_IDS,
)

export function isScaleEncounterAnimal(
  animalId: string,
): animalId is ScaleEncounterAnimalId {
  return SCALE_ENCOUNTER_ANIMAL_ID_SET.has(animalId)
}

export function isProductionScaleEncounterAnimal(
  animalId: ScaleEncounterAnimalId,
): animalId is ProductionScaleEncounterAnimalId {
  return PRODUCTION_SCALE_ENCOUNTER_ANIMAL_ID_SET.has(animalId)
}
