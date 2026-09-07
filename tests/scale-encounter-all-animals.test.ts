import { mainCollection } from '../src/content/collections/main'
import {
  scaleEncounterAvatarPresentationFor,
} from '../src/scale-encounter/avatar-scene-presentation'
import { scaleEncounterContentFor } from '../src/scale-encounter/content'
import {
  defaultScaleEncounterSceneCandidateVariant,
  sceneCandidateSemanticName,
  sceneCandidateSupportedFor,
} from '../src/scale-encounter/environments/scene-candidate'
import {
  scaleEncounterPanoramaThemeFor,
} from '../src/scale-encounter/environment-review-candidate'
import {
  REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS,
  SCALE_ENCOUNTER_ANIMAL_IDS,
} from '../src/scale-encounter/types'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
} from '../src/viewer/scale-encounter'
import { animalDefinition as dilophosaurusDefinition } from '../src/content/animals/dilophosaurus/package'

const expectedThemes = {
  stegosaurus: 'forest',
  pteranodon: 'sky',
  pachycephalosaurus: 'forest',
  ichthyosaur: 'ocean',
  'tyrannosaurus-rex': 'forest',
  rhamphorhynchus: 'sky',
  triceratops: 'forest',
  apatosaurus: 'forest',
  plesiosaurus: 'ocean',
  gigantoraptor: 'forest',
  tupandactylus: 'sky',
  mammoth: 'glacier',
  megalodon: 'ocean',
  maiasaura: 'forest',
  sauropelta: 'forest',
  meganeura: 'forest',
  dilophosaurus: 'forest',
  mosasaurus: 'ocean',
  spinosaurus: 'forest',
  lystrosaurus: 'forest',
  baryonyx: 'forest',
  archaeopteryx: 'forest',
  carnotaurus: 'forest',
  anomalocaris: 'ocean',
} as const

const expansionAnimalIds = [
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris',
] as const

describe('complete twenty-four-animal scale encounter catalog', () => {
  it('keeps the published collection exact with no local-only animals', () => {
    expect(SCALE_ENCOUNTER_ANIMAL_IDS).toEqual(mainCollection.animalIds)
    expect(REVIEW_SCALE_ENCOUNTER_ANIMAL_IDS).toEqual([])
    expect(Object.keys(SCALE_ENCOUNTER_DEFINITIONS)).toHaveLength(
      SCALE_ENCOUNTER_ANIMAL_IDS.length,
    )
  })

  it('maps every animal to one of the four shared review environments', () => {
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      expect(SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme).toBe(
        expectedThemes[animalId],
      )
    }
    expect(Object.values(expectedThemes).filter((theme) => theme === 'forest'))
      .toHaveLength(15)
    expect(Object.values(expectedThemes).filter((theme) => theme === 'sky'))
      .toHaveLength(3)
    expect(Object.values(expectedThemes).filter((theme) => theme === 'ocean'))
      .toHaveLength(5)
    expect(Object.values(expectedThemes).filter((theme) => theme === 'glacier'))
      .toHaveLength(1)
  })

  it('keeps all six promoted animals on their accepted compare calibration', () => {
    expect(
      expansionAnimalIds.map((animalId) => {
        const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
        return [
          animalId,
          definition.environmentTheme,
          definition.displayedMeters,
          definition.measurementAxis,
        ]
      }),
    ).toEqual([
      ['spinosaurus', 'forest', 14.5, 'x'],
      ['lystrosaurus', 'forest', 1.5, 'x'],
      ['baryonyx', 'forest', 8.75, 'x'],
      ['archaeopteryx', 'forest', 0.5, 'x'],
      ['carnotaurus', 'forest', 8, 'x'],
      ['anomalocaris', 'ocean', 0.6, 'x'],
    ])
    for (const animalId of expansionAnimalIds) {
      const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
      expect(definition.calibratedModelSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(definition.referenceAnimationTimeSeconds).toBe(0)
      expect(definition.minimumDistance).toBeLessThan(definition.defaultDistance)
      expect(definition.maximumDistance).toBeGreaterThan(definition.defaultDistance)
    }
    const archaeopteryx = SCALE_ENCOUNTER_DEFINITIONS.archaeopteryx
    expect(archaeopteryx.animalPosition.toArray()).toEqual([2.2, 0.3, 0])
    expect(archaeopteryx).toMatchObject({
      avatarMotionPolicy: 'adaptive-land',
      avatarProfile: 'land-explorer',
      defaultDistance: 1.8,
      habitat: 'land',
      maximumDistance: 5,
      minimumDistance: 1.4,
      modelYawRadians: -Math.PI / 2,
      support: 'ground',
    })
  })

  it('derives avatar packages and panoramas from the shared catalog', () => {
    const panoramaByTheme = {
      forest: 'land-cretaceous',
      glacier: 'snow-ice-age',
      sky: 'air-cretaceous',
      ocean: 'water-cretaceous',
    } as const
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
      const presentation = scaleEncounterAvatarPresentationFor(
        'boy',
        definition.habitat,
        animalId,
      )
      expect(presentation.profile).toBe(definition.avatarProfile)
      expect(scaleEncounterPanoramaThemeFor(animalId)).toBe(
        animalId === 'gigantoraptor' || animalId === 'dilophosaurus'
          ? null : panoramaByTheme[definition.environmentTheme],
      )
    }
  })

  it('keeps representative sizing internal while giving children direct dimensions', () => {
    expect(
      SCALE_ENCOUNTER_ANIMAL_IDS.filter(
        (animalId) =>
          SCALE_ENCOUNTER_DEFINITIONS[animalId].scaleConfidence ===
          'representative',
      ),
    ).toEqual([
      'ichthyosaur',
      'plesiosaurus',
      'archaeopteryx',
      'carnotaurus',
    ])
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const animalId of ['ichthyosaur', 'plesiosaurus'] as const) {
        const measurement = scaleEncounterContentFor(animalId, locale).copy
          .measurement
        expect(measurement).toMatch(/约 [45] 米|about [45] m/i)
        expect(measurement).not.toMatch(/模型|假设|大致|model|hypothetical|rough/i)
      }
    }
  })

  it('keeps the five corrected models on their reviewed head-left calibration', () => {
    expect(SCALE_ENCOUNTER_DEFINITIONS.apatosaurus).toMatchObject({
      defaultDistance: 8,
      displayedMeters: 23,
      modelYawRadians: 0,
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.plesiosaurus).toMatchObject({
      defaultDistance: 8,
      displayedMeters: 5,
      modelYawRadians: -Math.PI / 2,
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.sauropelta).toMatchObject({
      defaultDistance: 5,
      displayedMeters: 5.5,
      modelYawRadians: 0,
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.meganeura).toMatchObject({
      defaultDistance: 2.5,
      displayedMeters: 0.7,
      modelYawRadians: Math.PI / -10,
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.dilophosaurus).toMatchObject({
      defaultDistance: 6,
      displayedMeters: 6.5,
      modelYawRadians: Math.PI,
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.dilophosaurus.modelYawRadians).toBeCloseTo(
      (dilophosaurusDefinition.presentation.initialYawDegrees * Math.PI) / 180,
      12,
    )
  })

  it('faces the reviewed air animals toward the child and measures their rotated wing axes', () => {
    for (const animalId of ['rhamphorhynchus', 'tupandactylus'] as const) {
      expect(SCALE_ENCOUNTER_DEFINITIONS[animalId]).toMatchObject({
        measurementAxis: 'z',
        modelYawRadians: Math.PI / 2,
      })
    }
    expect(SCALE_ENCOUNTER_DEFINITIONS.rhamphorhynchus.defaultDistance).toBe(7)
    expect(SCALE_ENCOUNTER_DEFINITIONS.tupandactylus.defaultDistance).toBe(12)
  })

  it('measures Megalodon nose-to-tail instead of scaling its head width', () => {
    expect(SCALE_ENCOUNTER_DEFINITIONS.megalodon).toMatchObject({
      displayedMeters: 16,
      measurementAxis: 'x',
      modelYawRadians: -Math.PI / 2,
      defaultDistance: 20,
    })
  })

  it('reuses the accepted sky, ocean and glacier scene candidates by family', () => {
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const theme = expectedThemes[animalId]
      expect(sceneCandidateSupportedFor(animalId)).toBe(theme !== 'forest')
      expect(defaultScaleEncounterSceneCandidateVariant(animalId)).toBe(
        theme === 'glacier' ? 'E' : theme === 'forest' ? 'off' : 'D',
      )
      expect(sceneCandidateSemanticName(animalId)).toBe(
        theme === 'glacier'
          ? 'mammoth-palaeoenvironment'
          : theme === 'ocean'
            ? 'ocean'
            : theme === 'sky'
              ? 'sky'
              : null,
      )
    }
  })
})
