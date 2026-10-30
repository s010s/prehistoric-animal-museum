/// <reference types="node" />

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { animal } from '../src/content/animals/stegosaurus/animal'
import { animalDefinition } from '../src/content/animals/stegosaurus/package'
import { provenance } from '../src/content/animals/stegosaurus/provenance'
import { MEBIBYTE_BYTES } from '../src/model-policy'
import {
  inspectGlb,
  inspectWebp,
  sha256,
  validateCollection,
  validateLocaleCompleteness,
  validateRecordedAsset,
} from '../scripts/content-validation'

import {
  isPublicationAuthorizedNarrationPlan,
  publicationAuthorizationCoversTrack,
  verifyNarrationPublicationAuthorization,
  validateNarrationPublicationAuthorization,
} from '../scripts/narration-publication-authorization'

const packageRoot = join(
  process.cwd(),
  'src/content/animals/stegosaurus',
)

describe('content asset validation utilities', () => {
  it('reads the production GLB and finds the explicitly declared Idle clip', async () => {
    const model = await readFile(join(packageRoot, 'model/model.glb'))
    const inspection = inspectGlb(model)

    expect(animal.assets.modelBytes).toBe(model.byteLength)
    expect(inspection.version).toBe(2)
    expect(inspection.declaredBytes).toBe(model.byteLength)
    expect(inspection.animationNames).toContain('Idle')
    expect(inspection.cubicSplineRotationTracks).toBe(0)
    expect(inspection.externalUris).toEqual([])
    expect(inspection.triangles).toBe(19_839)
    expect(inspection.drawCalls).toBeLessThanOrEqual(24)
  })

  it('keeps the meshopt-compressed ichthyosaur Idle on safe linear rotation tracks', async () => {
    const model = await readFile(
      join(
        process.cwd(),
        'src/content/animals/ichthyosaur/model/model.glb',
      ),
    )
    const inspection = inspectGlb(model)

    expect(inspection.meshoptCompressed).toBe(true)
    expect(inspection.animationNames).toEqual(['Idle'])
    expect(inspection.cubicSplineRotationTracks).toBe(0)
  })

  it('reads exact WebP dimensions for both authored orientations', async () => {
    const landscape = inspectWebp(
      await readFile(join(packageRoot, 'backgrounds/landscape.webp')),
    )
    const portrait = inspectWebp(
      await readFile(join(packageRoot, 'backgrounds/portrait.webp')),
    )

    expect(landscape).toEqual({ width: 1672, height: 941 })
    expect(portrait).toEqual({ width: 941, height: 1672 })
  })

  it('reports concrete hash and byte mismatches', async () => {
    const modelRecord = provenance[0]
    const model = await readFile(join(packageRoot, modelRecord.assetPath))
    expect(
      validateRecordedAsset(
        modelRecord,
        model.byteLength,
        sha256(model),
        'stegosaurus',
      ),
    ).toEqual([])

    expect(
      validateRecordedAsset(
        modelRecord,
        model.byteLength - 1,
        '0'.repeat(64),
        'stegosaurus',
      ).map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining(['ASSET_HASH_MISMATCH', 'ASSET_SIZE_MISMATCH']),
    )
  })

  it('warns above 12 MiB and blocks only above the 20 MiB GLB ceiling', () => {
    const modelRecord = provenance[0]
    const recordedHash = 'a'.repeat(64)
    const issuesAt13MiB = validateRecordedAsset(
      {
        ...modelRecord,
        runtime: {
          bytes: 13 * MEBIBYTE_BYTES,
          sha256: recordedHash,
        },
      },
      13 * MEBIBYTE_BYTES,
      recordedHash,
      'test-animal',
    )
    const issuesAt21MiB = validateRecordedAsset(
      {
        ...modelRecord,
        runtime: {
          bytes: 21 * MEBIBYTE_BYTES,
          sha256: recordedHash,
        },
      },
      21 * MEBIBYTE_BYTES,
      recordedHash,
      'test-animal',
    )

    expect(issuesAt13MiB.map(({ code }) => code)).toContain(
      'ASSET_TARGET_EXCEEDED',
    )
    expect(issuesAt13MiB.map(({ code }) => code)).not.toContain(
      'ASSET_HARD_CEILING',
    )
    expect(issuesAt21MiB.map(({ code }) => code)).toContain(
      'ASSET_HARD_CEILING',
    )
  })
})

describe('collection validation utility', () => {
  it('accepts the one-item looping published collection', () => {
    expect(
      validateCollection(
        {
          id: 'main',
          animalIds: ['stegosaurus'],
          defaultAnimalId: 'stegosaurus',
          loop: true,
        },
        [animalDefinition],
      ),
    ).toEqual([])
  })

  it('reports duplicates, unknown IDs, a missing default, and non-looping order', () => {
    const issues = validateCollection(
      {
        id: 'broken',
        animalIds: ['stegosaurus', 'stegosaurus', 'unknown'],
        defaultAnimalId: 'missing',
        loop: false,
      },
      [animalDefinition],
    )
    const codes = issues.map(({ code }) => code)

    expect(codes).toEqual(
      expect.arrayContaining([
        'COLLECTION_DUPLICATE',
        'COLLECTION_UNKNOWN_ID',
        'COLLECTION_DEFAULT_MISSING',
        'MAIN_COLLECTION_NOT_LOOPING',
      ]),
    )
  })
})

describe('published locale completeness', () => {
  const approvedDefinition = {
    ...animalDefinition,
    narration: {
      ...animalDefinition.narration,
      en: {
        ...animalDefinition.narration.en,
        humanReviewStatus: 'approved',
      },
    },
  }

  it('rejects empty locale shells and ready narration records without canonical metadata', () => {
    const issues = validateLocaleCompleteness({
      id: 'empty-shell',
      status: 'published',
      content: { 'zh-CN': {}, en: {} },
      narration: {
        'zh-CN': { status: 'ready' },
        en: { status: 'ready' },
      },
    })

    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'PUBLISHED_LOCALE_CONTENT_INCOMPLETE',
        'PUBLISHED_LOCALE_NARRATION_INVALID',
      ]),
    )
    expect(issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'content.zh-CN.name',
        'content.en.narration.sentences',
        'narration.zh-CN.sourcePath',
        'narration.en.mimeType',
      ]),
    )
  })

  it('accepts the complete production locale records', () => {
    expect(validateLocaleCompleteness(approvedDefinition)).toEqual([])
  })

  it('keeps a generated English track out of publication until listening is approved', () => {
    const pendingDefinition = {
      ...approvedDefinition,
      narration: {
        ...approvedDefinition.narration,
        en: {
          ...approvedDefinition.narration.en,
          humanReviewStatus: 'pending',
        },
      },
    }
    expect(
      validateLocaleCompleteness(pendingDefinition).map(({ code }) => code),
    ).toContain('PUBLISHED_LOCALE_NARRATION_REVIEW_MISSING')
  })

  it('rejects copied Chinese content and American spelling in the English edition', () => {
    const copied = validateLocaleCompleteness({
      ...approvedDefinition,
      content: {
        'zh-CN': animalDefinition.content['zh-CN'],
        en: animalDefinition.content['zh-CN'],
      },
    })
    expect(copied.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'PUBLISHED_LOCALE_LANGUAGE_INVALID',
        'PUBLISHED_LOCALE_CONTENT_DUPLICATED',
      ]),
    )

    const americanSpelling = validateLocaleCompleteness({
      ...approvedDefinition,
      content: {
        ...approvedDefinition.content,
        en: {
          ...approvedDefinition.content.en,
          visibleFeature: 'Look at the color and behavior of this animal.',
        },
      },
    })
    expect(americanSpelling.map(({ code }) => code)).toContain(
      'PUBLISHED_ENGLISH_STYLE_INVALID',
    )
  })

  it('requires Serena with the locale-bound language declaration', () => {
    const issues = validateLocaleCompleteness({
      ...approvedDefinition,
      narration: {
        ...approvedDefinition.narration,
        en: {
          ...approvedDefinition.narration.en,
          speaker: 'Aiden',
          language: 'Chinese',
        },
      },
    })
    expect(issues.map(({ code }) => code)).toContain(
      'PUBLISHED_LOCALE_NARRATION_VOICE_INVALID',
    )
  })

  it('blocks a published package unless both public locales and narrations are complete', () => {
    const incomplete = {
      ...animalDefinition,
      content: { 'zh-CN': animalDefinition.content['zh-CN'] },
      narration: {
        'zh-CN': {
          status: 'ready',
          sourcePath: 'audio/narration.zh-CN.mp3',
          mimeType: 'audio/mpeg',
        },
        en: {
          status: 'pending-review',
          expectedPath: 'audio/narration.en.mp3',
          message: 'Narration is being prepared',
          gate: {
            id: 'final-narration',
            locale: 'en',
            reason: 'English listening review is pending.',
          },
        },
      },
    }

    expect(
      validateLocaleCompleteness(incomplete).map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        'PUBLISHED_LOCALE_CONTENT_MISSING',
        'PUBLISHED_LOCALE_NARRATION_NOT_READY',
      ]),
    )
  })

  it('allows an incomplete draft while keeping it out of the public collection', () => {
    expect(
      validateLocaleCompleteness({
        ...animalDefinition,
        status: 'draft',
        content: { 'zh-CN': animalDefinition.content['zh-CN'] },
        narration: {},
      }),
    ).toEqual([])
  })
})


describe('portable owner authorization for narration publication', () => {
  const digest = 'a'.repeat(64)
  const track = { animalId: 'example-animal', locale: 'zh-CN', phase: 'gallery', sha256: digest, assetPath: 'src/content/animals/example-animal/audio/narration.zh-CN.mp3' }
  const authorization = {
    schemaVersion: 1, kind: 'owner-publication-authorization',
    scope: 'owner-publication-authorized', owner: 'Leon', recordedOn: '2026-10-30',
    action: 'public-distribution', completeListening: 'unverified', tracks: [track],
  }
  const plan = {
    status: 'ready', sourcePath: 'audio/narration.zh-CN.mp3', mimeType: 'audio/mpeg',
    speaker: 'Serena', language: 'Chinese', humanReviewStatus: 'pending',
    publicationAuthorization: { scope: 'owner-publication-authorized', recordSha256: digest, completeListening: 'unverified' },
  }

  it('accepts a named publication decision while preserving unverified listening', () => {
    expect(isPublicationAuthorizedNarrationPlan(plan)).toBe(true)
    expect(publicationAuthorizationCoversTrack(authorization, track)).toBe(true)
    expect(validateLocaleCompleteness({
      ...animalDefinition,
      narration: { ...animalDefinition.narration, 'zh-CN': plan },
    })).toEqual([])
  })

  it.each([
    ['changed audio', { ...track, sha256: 'b'.repeat(64) }],
    ['wrong animal', { ...track, animalId: 'different-animal' }],
    ['wrong locale', { ...track, locale: 'en' }],
    ['wrong phase', { ...track, phase: 'intro' }],
  ])('rejects %s outside the exact authorized bytes', (_label, expected) => {
    expect(publicationAuthorizationCoversTrack(authorization, expected)).toBe(false)
  })

  it.each([
    ['missing owner', { ...authorization, owner: '' }],
    ['invalid date', { ...authorization, recordedOn: '2026-02-30' }],
    ['local-only scope', { ...authorization, scope: 'local-formal-candidate' }],
    ['local-only action', { ...authorization, action: 'local-preview' }],
    ['invented complete listening', { ...authorization, completeListening: 'approved' }],
    ['empty tracks', { ...authorization, tracks: [] }],
    ['duplicate tracks', { ...authorization, tracks: [track, track] }],
    ['invalid hash', { ...authorization, tracks: [{ ...track, sha256: 'invalid' }] }],
    ['private evidence path', { ...authorization, tracks: [{ ...track, assetPath: '.handoff/audio.mp3' }] }],
    ['traversal path', { ...authorization, tracks: [{ ...track, assetPath: 'src/../audio.mp3' }] }],
  ])('rejects %s in a public record', (_label, value) => {
    expect(publicationAuthorizationCoversTrack(value, track)).toBe(false)
  })

  it('rejects fabricated listening and incomplete playback metadata', () => {
    expect(isPublicationAuthorizedNarrationPlan({ ...plan, humanReviewStatus: 'approved' })).toBe(false)
    expect(isPublicationAuthorizedNarrationPlan({ ...plan, status: 'pending-review' })).toBe(false)
    expect(isPublicationAuthorizedNarrationPlan({ ...plan, sourcePath: 'audio/narration.en.mp3' })).toBe(false)
    expect(isPublicationAuthorizedNarrationPlan({ ...plan, publicationAuthorization: { ...plan.publicationAuthorization, recordSha256: 'invalid' } })).toBe(false)
    expect(isPublicationAuthorizedNarrationPlan({ ...plan, publicationAuthorization: { ...plan.publicationAuthorization, completeListening: 'approved' } })).toBe(false)
  })

  it('validates an isolated checkout from public records and rejects stale or missing evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'museum-publication-'))
    const recordPath = join(root, 'src/content/narration-publication-authorization.json')
    const manifestPath = join(root, 'src/scale-encounter/audio/additions-manifest.json')
    const audio = Buffer.from('exact authorized encoded audio')
    const galleryTrack = { ...track, sha256: sha256(audio) }
    const comparisonTrack = { ...galleryTrack, phase: 'intro', assetPath: 'src/scale-encounter/audio/additions/example-animal-intro.zh-CN.mp3' }
    const record = { ...authorization, tracks: [galleryTrack, comparisonTrack] }
    const recordBytes = JSON.stringify(record)
    const review = { ...plan, publicationAuthorization: { ...plan.publicationAuthorization, recordSha256: sha256(Buffer.from(recordBytes)) } }
    const comparison = { ...comparisonTrack, ...review, file: 'additions/example-animal-intro.zh-CN.mp3' }
    try {
      await mkdir(join(root, 'src/content/animals/example-animal/audio'), { recursive: true })
      await mkdir(join(root, 'src/scale-encounter/audio/additions'), { recursive: true })
      await writeFile(recordPath, recordBytes)
      await writeFile(manifestPath, JSON.stringify({ tracks: [comparison] }))
      for (const entry of record.tracks) await writeFile(join(root, entry.assetPath), audio)
      expect(await verifyNarrationPublicationAuthorization(review, galleryTrack, root)).toBe(true)
      expect(await validateNarrationPublicationAuthorization(root)).toBe(true)
      expect(await verifyNarrationPublicationAuthorization({ ...review, publicationAuthorization: { ...review.publicationAuthorization, recordSha256: 'b'.repeat(64) } }, galleryTrack, root)).toBe(false)
      await writeFile(join(root, comparisonTrack.assetPath), 'changed audio')
      expect(await validateNarrationPublicationAuthorization(root)).toBe(false)
      await writeFile(join(root, comparisonTrack.assetPath), audio)
      await writeFile(manifestPath, JSON.stringify({ tracks: [] }))
      expect(await validateNarrationPublicationAuthorization(root)).toBe(false)
      await writeFile(manifestPath, JSON.stringify({ tracks: [comparison, comparison] }))
      expect(await validateNarrationPublicationAuthorization(root)).toBe(false)
      await writeFile(manifestPath, JSON.stringify({ tracks: [{ ...comparison, humanReviewStatus: 'approved' }] }))
      expect(await validateNarrationPublicationAuthorization(root)).toBe(false)
      await rm(recordPath)
      expect(await verifyNarrationPublicationAuthorization(review, galleryTrack, root)).toBe(false)
      await writeFile(join(root, 'record.json'), recordBytes)
      await symlink(join(root, 'record.json'), recordPath)
      expect(await verifyNarrationPublicationAuthorization(review, galleryTrack, root)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
