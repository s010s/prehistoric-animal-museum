import { modelPreviewModules } from 'virtual:canonical-model-previews'

export function modelPreviewFor(
  animalId: string,
  fileName: string,
): string | undefined {
  if (import.meta.env.MODE === 'review') {
    return `/__museum-review-assets/${animalId}/${fileName}`
  }
  return modelPreviewModules[
    `../content/animals/${animalId}/images/${fileName}`
  ]
}
