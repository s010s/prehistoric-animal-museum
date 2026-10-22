import { mainCollection } from '../src/content/collections/main'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { localReviewAssetFiles, localReviewAssetPrefix } from './review-assets'

export type ModelPreviewTarget = 'production' | 'review'

export const repositoryRoot = resolve(import.meta.dirname, '..')
export const productionAnimalRoot = resolve(
  repositoryRoot,
  'src/content/animals',
)

export function parseModelPreviewTarget(
  arguments_: readonly string[],
): ModelPreviewTarget {
  const value = arguments_
    .find((argument) => argument.startsWith('--target='))
    ?.slice('--target='.length)
  if (value === undefined || value === 'production') {
    return 'production'
  }
  if (value === 'review') {
    return 'review'
  }
  throw new Error(`Unknown model preview target: ${value}`)
}

export function requestedAnimalIds(
  arguments_: readonly string[],
): string[] {
  return arguments_.filter((argument) => !argument.startsWith('--'))
}

export function modelPreviewAnimalIds(
  target: ModelPreviewTarget,
): Promise<string[]> {
  if (target === 'review') {
    return Promise.resolve([...localReviewAssetFiles.keys()]
      .filter((route) => route.endsWith('/model.glb'))
      .map((route) => route.split('/').at(-2) ?? '')
      .filter(Boolean)
      .sort())
  }

  return Promise.resolve([...mainCollection.animalIds].sort())
}

export function modelPreviewOutputDirectory(
  target: ModelPreviewTarget,
  animalId: string,
): string {
  return target === 'production'
    ? resolve(productionAnimalRoot, animalId, 'images')
    : resolve(
        repositoryRoot,
        'assets/review-generated/model-previews',
        animalId,
      )
}

export function modelPreviewSourceModel(
  target: ModelPreviewTarget,
  animalId: string,
): string {
  if (target === 'production') {
    return resolve(productionAnimalRoot, animalId, 'model/model.glb')
  }
  const route = `${localReviewAssetPrefix}/${animalId}/model.glb`
  const source = localReviewAssetFiles.get(route)
  if (!source) {
    throw new Error(`Review catalog has no model route for ${animalId}.`)
  }
  return source
}

export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export async function fileFingerprint(
  absolutePath: string,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const buffer = await readFile(absolutePath)
  return { bytes: buffer.byteLength, sha256: sha256(buffer) }
}

export async function resolveRequestedAnimalIds(
  target: ModelPreviewTarget,
  requested: readonly string[],
): Promise<string[]> {
  const available = await modelPreviewAnimalIds(target)
  const selected = requested.length > 0 ? [...new Set(requested)] : available
  const unknown = selected.filter((animalId) => !available.includes(animalId))
  if (unknown.length > 0) {
    throw new Error(`Unknown ${target} animal ID(s): ${unknown.join(', ')}`)
  }
  return selected
}
