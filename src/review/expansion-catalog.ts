import { registerExpansionContactSamples } from './expansion-walk-contacts'
import { Vector3 } from 'three'
import { expansionManifest } from 'virtual:expansion-manifest'
import { mainAnimals } from '../content/catalog'
import { registerReviewScaleEncounterAnimal } from '../scale-encounter/types'
import { registerReviewScaleEncounterCopy } from '../scale-encounter/content'
import { registerReviewScaleEncounterDefinition } from '../viewer/scale-encounter'
import { registerReviewMotionFootprint } from '../viewer/scale-encounter-motion-footprint'
import { registerExpansionNarrationEvidence } from './expansion-narration-audio'

registerExpansionNarrationEvidence(expansionManifest)

for (const item of expansionManifest.comparisons) {
  const water = item.habitat === 'water'
  if (item.walkContacts) registerExpansionContactSamples(item.id, item.walkContacts)
  if (item.idleContacts) registerExpansionContactSamples(item.id, item.idleContacts)
  if (item.motionFootprint) registerReviewMotionFootprint(item.id, item.motionFootprint)
  registerReviewScaleEncounterDefinition({
    id: item.id,
    habitat: item.habitat,
    environmentTheme: water ? 'ocean' : 'forest',
    avatarProfile: water ? 'water-diver' : 'land-explorer',
    avatarMotionPolicy: water ? 'swim' : 'adaptive-land',
    calibratedModelSha256: item.modelSha256,
    displayedMeters: item.meters,
    scaleConfidence: 'representative',
    measurement: 'body-length',
    measurementAxis: 'x',
    modelYawRadians: item.modelYawRadians,
    support: water ? 'centre' : 'ground',
    animalPosition: new Vector3(water ? 0.8 : 2.2, water ? 1.25 : 0, 0),
    defaultDistance: Math.max(3, item.meters * 0.65),
    minimumDistance: Math.max(1.2, item.meters * 0.25),
    maximumDistance: Math.max(12, item.meters * 3),
    overviewFieldOfView: 36,
    povFieldOfView: 58,
    overviewDirection: new Vector3(0, 0.035, 1).normalize(),
    overviewUp: new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4500,
    referenceAnimationTimeSeconds: 0,
  })
  registerReviewScaleEncounterCopy(item.id, item.names, item.measurements, item.narration)
  registerReviewScaleEncounterAnimal(item.id)
}

// A private review catalog. Public production order and assets are unchanged.
export const localReviewAnimals = [...mainAnimals, ...expansionManifest.animals]
