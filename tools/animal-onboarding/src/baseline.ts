import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { fileDigest, regularFile, writeJson } from './io'
import { inspectGlbFile } from './glb'

export const immutableProductionBaselineIds = [
  'stegosaurus',
  'pachycephalosaurus',
  'ichthyosaur',
  'pteranodon',
  'tyrannosaurus-rex',
  'triceratops',
  'plesiosaurus',
  'apatosaurus',
  'gigantoraptor',
  'mammoth',
  'megalodon',
  'maiasaura',
] as const

// Backward-compatible export for the captured twelve-animal milestone. New
// explicitly approved animals may extend the collection, and an explicit
// curator decision may reorder it, but none of these baseline animals may be
// removed by onboarding automation.
export const expectedProductionIds = immutableProductionBaselineIds

export const goldenIds = ['maiasaura', 'plesiosaurus', 'megalodon'] as const

const publishedStatusPattern = /(?:^|[{,])\s*(?:status|['"]status['"])\s*:\s*['"]published['"]/m

export async function verifyProductionBaseline(): Promise<{
  readonly pass: boolean
  readonly actualIds: readonly string[]
  readonly errors: readonly string[]
}> {
  const root = resolve('src/content/animals')
  const entries = await readdir(root, { withFileTypes: true })
  const actualIds = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) =>
          (await regularFile(resolve(root, entry.name, 'animal.ts')))
            ? entry.name
            : null,
        ),
    )
  )
    .filter((id): id is string => id !== null)
    .sort()
  const errors: string[] = []
  const collection = await readFile(
    resolve('src/content/collections/main.ts'),
    'utf8',
  )
  const collectionBlock = collection.match(/animalIds:\s*\[([\s\S]*?)\]/)?.[1]
  const collectionIds = collectionBlock
    ? [...collectionBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])
    : []
  const collectionSet = [...collectionIds].sort()
  if (JSON.stringify(actualIds) !== JSON.stringify(collectionSet)) {
    errors.push(
      `Production animal directories differ from main collection: directories ${actualIds.join(', ')}, collection ${collectionSet.join(', ')}`,
    )
  }
  if (new Set(collectionIds).size !== collectionIds.length) {
    errors.push('main collection contains duplicate animal IDs')
  }
  const missingBaselineIds = immutableProductionBaselineIds.filter(
    (id) => !collectionIds.includes(id),
  )
  if (missingBaselineIds.length > 0) {
    errors.push(
      `Immutable production baseline is missing: ${missingBaselineIds.join(', ')}`,
    )
  }
  for (const id of collectionIds) {
    const packageSource = await readFile(
      resolve(`src/content/animals/${id}/package.ts`),
      'utf8',
    ).catch(() => '')
    if (!publishedStatusPattern.test(packageSource)) {
      errors.push(`${id} is not published`)
    }
  }
  for (const id of goldenIds) {
    const packageSource = await readFile(
      resolve(`src/content/animals/${id}/package.ts`),
      'utf8',
    )
    if (!publishedStatusPattern.test(packageSource)) {
      errors.push(`${id} is not published`)
    }
  }
  return { pass: errors.length === 0, actualIds, errors }
}

export async function captureGolden(path: string): Promise<void> {
  if (await regularFile(path)) {
    throw new Error(
      `Golden baseline already exists and is read-only: ${path}`,
    )
  }
  const baseline = await verifyProductionBaseline()
  if (!baseline.pass) {
    throw new Error(baseline.errors.join('\n'))
  }
  const samples = []
  for (const id of goldenIds) {
    const modelPath = `src/content/animals/${id}/model/model.glb`
    samples.push({
      id,
      modelPath,
      digest: await fileDigest(resolve(modelPath)),
      inspection: await inspectGlbFile(resolve(modelPath)),
      runtimeAssets: await Promise.all(
        [
          'backgrounds/landscape.webp',
          'backgrounds/portrait.webp',
          'images/poster.webp',
          'images/thumbnail.webp',
          'audio/narration.zh-CN.mp3',
        ].map(async (relativePath) => ({
          path: `src/content/animals/${id}/${relativePath}`,
          digest: await fileDigest(
            resolve(`src/content/animals/${id}/${relativePath}`),
          ),
        })),
      ),
    })
  }
  await writeJson(path, {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    productionAnimalIds: baseline.actualIds,
    samples,
  })
}

export async function regressGolden(path: string): Promise<{
  readonly pass: boolean
  readonly checked: number
  readonly errors: readonly string[]
}> {
  const value = JSON.parse(await readFile(path, 'utf8')) as {
    samples?: Array<{
      id: string
      modelPath: string
      digest: { bytes: number; sha256: string }
      runtimeAssets: Array<{
        path: string
        digest: { bytes: number; sha256: string }
      }>
    }>
  }
  const errors: string[] = []
  const samples = value.samples ?? []
  for (const sample of samples) {
    for (const target of [
      { path: sample.modelPath, digest: sample.digest },
      ...sample.runtimeAssets,
    ]) {
      const actual = await fileDigest(resolve(target.path)).catch(() => null)
      if (
        actual === null ||
        actual.bytes !== target.digest.bytes ||
        actual.sha256 !== target.digest.sha256
      ) {
        errors.push(`${sample.id}: changed or missing ${target.path}`)
      }
    }
  }
  return {
    pass: samples.length === goldenIds.length && errors.length === 0,
    checked: samples.length,
    errors,
  }
}
