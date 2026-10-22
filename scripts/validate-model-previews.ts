import { mainCollection } from '../src/content/collections/main'
import { releaseCandidateEnabled } from '../src/content/release-candidate'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'

import { loadAnimalDefinitions } from './content-data'
import type {
  AnimalAnimation,
  AnimalPresentation,
} from '../src/content/types'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'
import {
  MODEL_PREVIEW_CONTRACT_VERSION,
  MODEL_PREVIEW_MANIFEST_FILE,
  modelPreviewProfiles,
  type ModelPreviewManifest,
} from '../src/viewer/model-preview-profiles'
import {
  fileFingerprint,
  modelPreviewOutputDirectory,
  modelPreviewSourceModel,
  parseModelPreviewTarget,
  repositoryRoot,
  requestedAnimalIds,
  resolveRequestedAnimalIds,
  sha256,
} from './model-preview-assets'
import {
  formatVisibleAlphaEdgeContacts,
  visibleAlphaEdgeContacts,
} from './transparent-image-edges'

interface PreviewAnimalDefinition {
  readonly animation?: AnimalAnimation
  readonly content: {
    readonly 'zh-CN': { readonly name: string }
  }
  readonly id: string
  readonly presentation: AnimalPresentation
  readonly status: 'draft' | 'published'
}

function isPreviewAnimalDefinition(
  value: unknown,
): value is PreviewAnimalDefinition {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<PreviewAnimalDefinition>
  return (
    typeof candidate.id === 'string' &&
    (candidate.status === 'draft' || candidate.status === 'published') &&
    typeof candidate.presentation === 'object' &&
    candidate.presentation !== null &&
    typeof candidate.content?.['zh-CN']?.name === 'string'
  )
}

async function loadReviewAnimalDefinition(
  animalId: string,
): Promise<PreviewAnimalDefinition | undefined> {
  const packagePath = resolve(
    repositoryRoot,
    'src/review/animals',
    animalId,
    'package.ts',
  )
  try {
    await access(packagePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  const loaded = (await import(pathToFileURL(packagePath).href)) as {
    readonly animal?: unknown
  }
  if (!isPreviewAnimalDefinition(loaded.animal)) {
    throw new Error(`${animalId}/package.ts does not export a review animal.`)
  }
  return loaded.animal
}

const arguments_ = process.argv.slice(2)
const target = parseModelPreviewTarget(arguments_)
const animalIds = await resolveRequestedAnimalIds(
  target,
  requestedAnimalIds(arguments_),
)
const errors: string[] = []
const expectedSignatures = new Map<string, string>()
const productionDefinitions = (await loadAnimalDefinitions()).map(
  ({ definition }) => definition,
)
const publishedProductionById = new Map(
  productionDefinitions
    .filter(({ status, id }) => status === 'published' || (releaseCandidateEnabled && mainCollection.animalIds.includes(id)))
    .map((definition) => [definition.id, definition]),
)

if (target === 'production') {
  for (const definition of publishedProductionById.values()) {
    const label = definition.content['zh-CN']?.name
    if (!label) {
      errors.push(`${definition.id}: published definition has no zh-CN name.`)
      continue
    }
    const descriptor = createViewerModelDescriptor(
      definition,
      label,
      'model.glb',
    )
    expectedSignatures.set(
      definition.id,
      createModelPreviewPresentationSignature(descriptor),
    )
  }
} else {
  for (const animalId of animalIds) {
    try {
      // Accepted review packages keep their authored presentation. A draft is
      // replaced by production presentation as soon as the same ID is promoted.
      const reviewDefinition = await loadReviewAnimalDefinition(animalId)
      const definition =
        (reviewDefinition?.status === 'published'
          ? reviewDefinition
          : publishedProductionById.get(animalId) ?? reviewDefinition)
      if (!definition) {
        throw new Error(`${animalId} has no review or production definition.`)
      }
      const label = definition.content['zh-CN']?.name
      if (!label) {
        throw new Error(`${animalId} has no zh-CN name.`)
      }
      const descriptor = createViewerModelDescriptor(
        definition,
        label,
        'model.glb',
      )
      expectedSignatures.set(
        animalId,
        createModelPreviewPresentationSignature(descriptor),
      )
    } catch (error) {
      errors.push(
        `${animalId}: cannot load expected review presentation (${error instanceof Error ? error.message : 'unknown error'}).`,
      )
    }
  }
}

for (const animalId of animalIds) {
  const outputDirectory = modelPreviewOutputDirectory(target, animalId)
  const manifestPath = resolve(
    outputDirectory,
    MODEL_PREVIEW_MANIFEST_FILE,
  )
  let manifest: ModelPreviewManifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ModelPreviewManifest
  } catch (error) {
    errors.push(
      `${animalId}: cannot read ${MODEL_PREVIEW_MANIFEST_FILE} (${error instanceof Error ? error.message : 'unknown error'}).`,
    )
    continue
  }

  if (manifest.animalId !== animalId) {
    errors.push(`${animalId}: manifest animalId is ${manifest.animalId}.`)
  }
  if (manifest.target !== target) {
    errors.push(`${animalId}: manifest target is ${manifest.target}.`)
  }
  if (manifest.contractVersion !== MODEL_PREVIEW_CONTRACT_VERSION) {
    errors.push(
      `${animalId}: preview contract ${manifest.contractVersion} is stale; expected ${MODEL_PREVIEW_CONTRACT_VERSION}.`,
    )
  }
  try {
    const signature = JSON.parse(manifest.presentationSignature) as {
      readonly contractVersion?: number
    }
    if (signature.contractVersion !== MODEL_PREVIEW_CONTRACT_VERSION) {
      errors.push(`${animalId}: presentation signature uses a stale contract.`)
    }
  } catch {
    errors.push(`${animalId}: presentation signature is not valid JSON.`)
  }
  const expectedSignature = expectedSignatures.get(animalId)
  if (
    expectedSignature !== undefined &&
    manifest.presentationSignature !== expectedSignature
  ) {
    errors.push(
      `${animalId}: presentation changed after preview generation; regenerate model previews.`,
    )
  }

  try {
    const source = await fileFingerprint(
      modelPreviewSourceModel(target, animalId),
    )
    if (
      source.bytes !== manifest.sourceModel?.bytes ||
      source.sha256 !== manifest.sourceModel?.sha256
    ) {
      errors.push(
        `${animalId}: source model changed after preview generation; regenerate model previews.`,
      )
    }
  } catch (error) {
    errors.push(
      `${animalId}: cannot inspect source model (${error instanceof Error ? error.message : 'unknown error'}).`,
    )
  }

  for (const profile of modelPreviewProfiles) {
    const record = manifest.profiles?.[profile.key]
    if (!record) {
      errors.push(`${animalId}: manifest is missing ${profile.key}.`)
      continue
    }
    if (
      record.fileName !== profile.fileName ||
      record.width !== profile.width ||
      record.height !== profile.height
    ) {
      errors.push(`${animalId}/${profile.fileName}: manifest profile is stale.`)
    }
    const previewPath = resolve(outputDirectory, profile.fileName)
    try {
      const buffer = await readFile(previewPath)
      const metadata = await sharp(buffer).metadata()
      const alpha = await sharp(buffer)
        .ensureAlpha()
        .extractChannel('alpha')
        .stats()
      const alphaChannel = alpha.channels[0]
      if (
        metadata.width !== profile.width ||
        metadata.height !== profile.height
      ) {
        errors.push(
          `${animalId}/${profile.fileName}: expected ${profile.width}x${profile.height}, got ${metadata.width}x${metadata.height}.`,
        )
      }
      if (
        !metadata.hasAlpha ||
        !alphaChannel ||
        alphaChannel.min !== 0 ||
        alphaChannel.max <= 100 ||
        alphaChannel.mean >= 120
      ) {
        errors.push(
          `${animalId}/${profile.fileName}: transparent model silhouette is invalid.`,
        )
      }
      const edgeContactSummary = formatVisibleAlphaEdgeContacts(
        await visibleAlphaEdgeContacts(buffer),
      )
      if (edgeContactSummary) {
        errors.push(
          `${animalId}/${profile.fileName}: visible model pixels touch the image edge (${edgeContactSummary}).`,
        )
      }
      if (
        record.bytes !== buffer.byteLength ||
        record.sha256 !== sha256(buffer)
      ) {
        errors.push(
          `${animalId}/${profile.fileName}: file does not match its manifest.`,
        )
      }
    } catch (error) {
      errors.push(
        `${animalId}/${profile.fileName}: cannot inspect preview (${error instanceof Error ? error.message : 'unknown error'}).`,
      )
    }
  }
}

if (errors.length > 0) {
  console.error(`Invalid ${target} model previews:`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `${target} model previews: ${animalIds.length} animal(s), ${modelPreviewProfiles.length} shared profile(s), source and presentation signatures current, no visible edge contact.`,
  )
}
