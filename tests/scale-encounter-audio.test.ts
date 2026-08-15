import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  scaleEncounterContentFor,
  type GuidedLineKind,
  type ScaleEncounterAnimalId,
} from '../src/scale-encounter/content'
import type { Locale } from '../src/i18n/locale'

interface NarrationTrack {
  readonly durationSeconds: number
  readonly file: string
  readonly locale: Locale
  readonly script: string
  readonly sha256: string
}

interface NarrationManifest {
  readonly engine: {
    readonly model: string
    readonly modelRevision: string
    readonly speaker: string
  }
  readonly humanListeningReview: Readonly<
    Record<
      ScaleEncounterAnimalId,
      {
        readonly status: 'approved' | 'pending'
        readonly reviewedBy?: string
        readonly reviewedOn?: string
      }
    >
  >
  readonly publicDistributionDecision: string
  readonly status: string
  readonly tracks: readonly NarrationTrack[]
}

const manifestPath = resolve(
  process.cwd(),
  'src/scale-encounter/audio/narration-candidates.json',
)
const audioDirectory = dirname(manifestPath)
const manifest = JSON.parse(
  readFileSync(manifestPath, 'utf8'),
) as NarrationManifest

const animalIds: readonly ScaleEncounterAnimalId[] = [
  'tyrannosaurus-rex',
  'pteranodon',
  'mosasaurus',
  'mammoth',
]
const locales: readonly Locale[] = ['zh-CN', 'en']
const lineKinds: readonly GuidedLineKind[] = [
  'intro',
  'transition',
  'arrival',
]

describe('scale encounter narration candidates', () => {
  it('keeps all 24 Qwen Serena files byte-for-byte tied to their recorded hashes', () => {
    expect(manifest.status).toBe('prototype-listening-candidates')
    expect(manifest.engine).toMatchObject({
      model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      modelRevision: '85e237c12c027371202489a0ec509ded67b5e4b5',
      speaker: 'Serena',
    })
    expect(manifest.tracks).toHaveLength(24)
    expect(new Set(manifest.tracks.map((track) => track.file)).size).toBe(24)

    for (const track of manifest.tracks) {
      const bytes = readFileSync(resolve(audioDirectory, track.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        track.sha256,
      )
      expect(track.durationSeconds).toBeGreaterThan(0)
    }
  })

  it('matches every localized UI line and records listening review per animal', () => {
    const tracksByFile = new Map(
      manifest.tracks.map((track) => [track.file, track]),
    )
    const expectedFiles: string[] = []

    for (const animalId of animalIds) {
      for (const locale of locales) {
        const content = scaleEncounterContentFor(animalId, locale)
        for (const kind of lineKinds) {
          const file = `${animalId}-${kind}.${locale}.mp3`
          expectedFiles.push(file)
          const track = tracksByFile.get(file)
          expect(track, file).toBeDefined()
          expect(track?.locale).toBe(locale)
          expect(track?.script).toBe(content.copy[kind])
          if (kind === 'transition') {
            expect(content.transitionDurationMs).toBe(
              Math.ceil((track?.durationSeconds ?? 0) * 1_000),
            )
            expect(content.transitionDurationMs).toBeLessThanOrEqual(12_000)
          }
          expect(
            decodeURIComponent(new URL(content.audio[kind]).pathname).split('/').at(-1),
          ).toBe(file)
        }
      }
    }

    expect([...tracksByFile.keys()].sort()).toEqual(expectedFiles.sort())
    for (const animalId of [
      'tyrannosaurus-rex',
      'pteranodon',
      'mosasaurus',
    ] as const) {
      expect(manifest.humanListeningReview[animalId]).toMatchObject({
        status: 'approved',
        reviewedBy: 'Leon',
        reviewedOn: '2026-08-12',
      })
    }
    expect(manifest.humanListeningReview.mammoth).toEqual({
      status: 'pending',
    })
    expect(manifest.publicDistributionDecision).toBe('pending')
  })
})
