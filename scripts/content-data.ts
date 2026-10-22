import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  AnimalDefinitionModule,
  AnimalPackageDefinition,
} from '../src/content/types'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const animalsRoot = join(repositoryRoot, 'src/content/animals')

export interface LoadedAnimalDefinition {
  readonly directoryName: string
  readonly directoryPath: string
  readonly definition: AnimalPackageDefinition
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAnimalDefinitionModule(
  value: unknown,
): value is AnimalDefinitionModule {
  if (!isRecord(value)) {
    return false
  }

  const definition = value.animalDefinition
  return (
    isRecord(definition) &&
    typeof definition.id === 'string' &&
    (definition.status === 'draft' || definition.status === 'published')
  )
}

export async function loadAnimalDefinitions(
  onlyIds?: readonly string[],
  importDefinition: (moduleUrl: string) => Promise<unknown> = (moduleUrl) => import(moduleUrl),
): Promise<
  LoadedAnimalDefinition[]
> {
  const directoryEntries = await readdir(animalsRoot, {
    withFileTypes: true,
  })
  const directoryNames = directoryEntries
    .filter((entry) => entry.isDirectory() && (!onlyIds || onlyIds.includes(entry.name)))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(
    directoryNames.map(async (directoryName) => {
      const directoryPath = join(animalsRoot, directoryName)
      const moduleUrl = pathToFileURL(join(directoryPath, 'package.ts')).href
      const loadedModule = await importDefinition(moduleUrl)

      if (!isAnimalDefinitionModule(loadedModule)) {
        throw new Error(
          `${directoryName}/package.ts 必须导出 animalDefinition。`,
        )
      }

      return {
        directoryName,
        directoryPath,
        definition: loadedModule.animalDefinition,
      }
    }),
  )
}
