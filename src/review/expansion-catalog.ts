import { registerExpansionContactSamples } from './expansion-walk-contacts'
import { Vector3 } from 'three'
import { expansionManifest } from 'virtual:expansion-manifest'
import { mainAnimals } from '../content/catalog'
import { registerReviewScaleEncounterAnimal } from '../scale-encounter/types'
import { registerReviewScaleEncounterCopy } from '../scale-encounter/content'
import { registerReviewScaleEncounterDefinition } from '../viewer/scale-encounter'
import { registerReviewMotionFootprint } from '../viewer/scale-encounter-motion-footprint'
import { registerExpansionNarrationEvidence } from './expansion-narration-audio'
import { SKY_EXPANSION_REVIEW_ID_SET } from './sky-expansion-config'
import { registerSkyReviewModelPreviews } from '../viewer/responsive-model-stills'

registerExpansionNarrationEvidence(expansionManifest)
const canonicalIds = new Set(mainAnimals.map(animal => animal.id))
const remainingDraftAnimals = expansionManifest.animals.filter(animal => !canonicalIds.has(animal.id))

for (const animal of remainingDraftAnimals) {
  if (SKY_EXPANSION_REVIEW_ID_SET.has(animal.id)) {
    registerSkyReviewModelPreviews(animal.id, Object.keys(expansionManifest.files)
      .filter(route => route.startsWith(`/__museum-review-assets/${animal.id}/preview-`))
      .map(route => route.split('/').at(-1)!))
  }
}

for (const item of expansionManifest.comparisons) {
  if (canonicalIds.has(item.id)) continue
  const water = item.habitat === 'water'
  const air = item.habitat === 'air'
  if (item.walkContacts) registerExpansionContactSamples(item.id, item.walkContacts)
  if (item.idleContacts) registerExpansionContactSamples(item.id, item.idleContacts)
  if (item.motionFootprint) registerReviewMotionFootprint(item.id, item.motionFootprint)
  registerReviewScaleEncounterDefinition({
    id: item.id,
    habitat: item.habitat,
    environmentTheme: water ? 'ocean' : air ? 'sky' : 'forest',
    avatarProfile: water ? 'water-diver' : air ? 'air-wingsuit' : 'land-explorer',
    avatarMotionPolicy: water ? 'swim' : air ? 'glide' : 'adaptive-land',
    calibratedModelSha256: item.modelSha256,
    displayedMeters: item.meters,
    scaleConfidence: 'representative',
    measurement: item.measurement ?? 'body-length',
    measurementAxis: item.measurementAxis ?? 'x',
    modelYawRadians: item.modelYawRadians,
    support: water || air ? 'centre' : 'ground',
    animalPosition: new Vector3(water ? 0.8 : air ? 0 : 2.2, water ? 1.25 : air ? 3.8 : 0, 0),
    // The short generic water rail put this long, broad animal's child close
    // to its head. Keep entry/arrival spacious; its nearer safe boundary is a
    // separate interaction policy in ViewerController.
    defaultDistance: Math.max(3, item.meters * (air || (water && item.id === 'dakosaurus') ? 1.1 : 0.65)),
    minimumDistance: Math.max(1.2, item.meters * (air ? 0.5 : 0.25)),
    maximumDistance: Math.max(12, item.meters * 3),
    overviewFieldOfView: air ? 32 : 36,
    povFieldOfView: air ? 60 : 58,
    overviewDirection: air
      ? new Vector3(Math.cos(70 * Math.PI / 180), Math.sin(70 * Math.PI / 180), 0)
      : new Vector3(0, 0.035, 1).normalize(),
    overviewUp: air
      ? new Vector3(-Math.sin(70 * Math.PI / 180), Math.cos(70 * Math.PI / 180), 0)
      : new Vector3(0, 1, 0),
    guidedTransitionDurationMs: 4500,
    referenceAnimationTimeSeconds: 0,
  })
  registerReviewScaleEncounterCopy(item.id, item.names, item.measurements, item.narration, item.scripts)
  registerReviewScaleEncounterAnimal(item.id)
}

// A private review catalog. Public production order and assets are unchanged.
export const localReviewAnimals = [...mainAnimals, ...remainingDraftAnimals]
