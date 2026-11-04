import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'
import { selectedScaleEncounterAnimalIds } from '../src/scale-encounter/types'

describe('scale encounter calibration asset integrity', () => {
  it.each(selectedScaleEncounterAnimalIds.map((animalId) => [animalId, animalId] as const))('keeps the %s model identical to the asset used for scale calibration', (animalId, directory) => {
    const bytes = readFileSync(
      resolve(process.cwd(), `src/content/animals/${directory}/model/model.glb`),
    )
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      SCALE_ENCOUNTER_DEFINITIONS[animalId].calibratedModelSha256,
    )
  })
})
