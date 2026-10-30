import { modelPreviewModules } from 'virtual:canonical-model-previews'
import { SKY_EXPANSION_REVIEW_ID_SET } from '../review/sky-expansion-config'

const candidatePreviews = new Map<string, ReadonlySet<string>>()

export function registerSkyReviewModelPreviews(animalId: string, fileNames: readonly string[]): void {
  if (import.meta.env.MODE !== 'review' || !SKY_EXPANSION_REVIEW_ID_SET.has(animalId)) throw new Error('Private sky previews only.')
  candidatePreviews.set(animalId, new Set(fileNames))
}

export function modelPreviewFor(
  animalId: string,
  fileName: string,
): string | undefined {
  if (import.meta.env.MODE === 'review') {
    if (SKY_EXPANSION_REVIEW_ID_SET.has(animalId) && !candidatePreviews.get(animalId)?.has(fileName)) return undefined
    return `/__museum-review-assets/${animalId}/${fileName}`
  }
  return modelPreviewModules[
    `../content/animals/${animalId}/images/${fileName}`
  ]
}
