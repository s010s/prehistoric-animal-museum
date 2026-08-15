export type ScaleEncounterAnimalId =
  | 'tyrannosaurus-rex'
  | 'pteranodon'
  | 'mosasaurus'
  | 'mammoth'

export type ChildProfile = {
  readonly gender: 'boy' | 'girl'
  readonly heightCm: number
}

const SCALE_ENCOUNTER_ANIMAL_IDS: ReadonlySet<string> = new Set([
  'tyrannosaurus-rex',
  'pteranodon',
  'mosasaurus',
  'mammoth',
])

export function isScaleEncounterAnimal(
  animalId: string,
): animalId is ScaleEncounterAnimalId {
  return SCALE_ENCOUNTER_ANIMAL_IDS.has(animalId)
}
