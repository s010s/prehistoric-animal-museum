import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  scaleEncounterContentFor,
  type GuidedLineKind,
  type ScaleEncounterAnimalId,
} from '../src/scale-encounter/content'
import { validateNarrationPublicationAuthorization } from '../scripts/narration-publication-authorization'
import type { Locale } from '../src/i18n/locale'
import {
  SCALE_ENCOUNTER_ANIMAL_IDS,
} from '../src/scale-encounter/types'
import { animalDefinition as staticTyrannosaurus } from '../src/content/animals/tyrannosaurus-rex/package'

interface NarrationTrack {
  readonly continuousMasterEvidence?: string
  readonly continuousMasterSha256?: string
  readonly continuousMasterScriptSha256?: string
  readonly durationSeconds: number
  readonly endSample?: number
  readonly file: string
  readonly locale: Locale
  readonly pronunciationContext?: string
  readonly script: string
  readonly sha256: string
  readonly startSample?: number
}

interface NarrationManifest {
  readonly schemaVersion: number
  readonly continuousNarrationPolicy: {
    readonly animalLocaleMasterCount: number
    readonly animalPhaseTrackCount: number
    readonly guidedTrackCount: number
    readonly sampleRateHz: number
    readonly viewSwitchLocaleMasterCount: number
  }
  readonly engine: {
    readonly model: string
    readonly modelRevision: string
    readonly postProcessing: string
    readonly speaker: string
  }
  readonly latestGeneration: {
    readonly prosodyPreset: string
    readonly tempoPolicy: {
      readonly pitchShiftSemitones: number
      readonly wholeMasterFactor: number
    }
  }
  readonly humanListeningReview: Readonly<
    Record<
      ScaleEncounterAnimalId | 'view-switch',
      {
        readonly status: 'approved' | 'pending'
        readonly reviewedBy?: string
        readonly reviewedOn?: string
        readonly scriptApprovedOn?: string
        readonly scriptReview?: 'pending'
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

const animalIds: readonly ScaleEncounterAnimalId[] =
  SCALE_ENCOUNTER_ANIMAL_IDS
const narratedAnimalIds: readonly ScaleEncounterAnimalId[] =
  SCALE_ENCOUNTER_ANIMAL_IDS
const expansionAnimalIds: ReadonlySet<string> = new Set([
  'spinosaurus',
  'lystrosaurus',
  'baryonyx',
  'archaeopteryx',
  'carnotaurus',
  'anomalocaris',
])
const locales: readonly Locale[] = ['zh-CN', 'en']
const lineKinds: readonly GuidedLineKind[] = [
  'intro',
  'transition',
  'arrival',
]
const viewSwitchLineKinds: readonly GuidedLineKind[] = [
  'toChildEyes',
  'toChildRear',
]

function audioFileName(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? url
  return decodeURIComponent(path.split('/').at(-1) ?? path)
}

describe('scale encounter narration candidates', () => {
  it('locks the CC0 pastoral town loop used by the optional music control', () => {
    const bytes = readFileSync(
      resolve(audioDirectory, 'scale-encounter-wandering-town-loop.ogg'),
    )
    expect(bytes.byteLength).toBe(646_764)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '79d427b3d82a6d73b560eb01f3b62ba1b014b718b2ff68724aee446e7d1c497d',
    )
  })

  it('keeps all 148 Serena files byte-for-byte tied to their recorded hashes', () => {
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.status).toBe(
      'production-approved',
    )
    expect(manifest.engine).toMatchObject({
      model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      modelRevision:
        '85e237c12c027371202489a0ec509ded67b5e4b5',
      speaker: 'Serena',
    })
    expect(manifest.engine.postProcessing).toMatch(
      /tempo 1\.04x.*no pitch shift/i,
    )
    expect(manifest.latestGeneration).toMatchObject({
      prosodyPreset: 'serena-light-exploration-v3',
      tempoPolicy: {
        pitchShiftSemitones: 0,
        wholeMasterFactor: 1.04,
      },
    })
    expect(manifest.tracks).toHaveLength(148)
    expect(new Set(manifest.tracks.map((track) => track.file)).size).toBe(148)

    for (const track of manifest.tracks) {
      const bytes = readFileSync(resolve(audioDirectory, track.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        track.sha256,
      )
      expect(track.durationSeconds).toBeGreaterThan(0)
    }
  })

  it('uses the same Serena voice contract as the static museum', () => {
    expect(manifest.engine).toMatchObject({
      model: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      modelRevision:
        '85e237c12c027371202489a0ec509ded67b5e4b5',
      speaker: staticTyrannosaurus.narration['zh-CN'].speaker,
    })
    expect(staticTyrannosaurus.narration.en.speaker).toBe('Serena')
    expect(manifest.engine.postProcessing).toMatch(
      /tempo 1\.04x.*no pitch shift/i,
    )
  })

  it('keeps recorded scripts tied to the authored scene concepts and records listening review', () => {
    const tracksByFile = new Map(
      manifest.tracks.map((track) => [track.file, track]),
    )
    const expectedFiles: string[] = []
    const staleRecordedCopy: string[] = []

    for (const animalId of narratedAnimalIds) {
      for (const locale of locales) {
        const content = scaleEncounterContentFor(animalId, locale)
        for (const kind of lineKinds) {
          const file = audioFileName(content.audio[kind])
          expectedFiles.push(file)
          const track = tracksByFile.get(file)
          expect(track, file).toBeDefined()
          expect(track?.locale).toBe(locale)
          if (track?.script !== content.copy[kind]) {
            staleRecordedCopy.push(file)
          }
          expect(track?.script).toBe(content.copy[kind])
          if (kind === 'transition') {
            expect(content.transitionDurationMs).toBe(
              Math.ceil((track?.durationSeconds ?? 0) * 1_000),
            )
            // The calmer whole-master cadence intentionally gives the three
            // longest Chinese walk-ins a little more room than the old
            // independently generated clips.
            expect(content.transitionDurationMs).toBeLessThanOrEqual(14_000)
          }
          expect(file).toContain(animalId)
        }
      }
    }

    for (const locale of locales) {
      const content = scaleEncounterContentFor('pteranodon', locale)
      for (const kind of viewSwitchLineKinds) {
        const file = audioFileName(content.audio[kind])
        expectedFiles.push(file)
        const track = tracksByFile.get(file)
        expect(track, file).toBeDefined()
        expect(track?.locale).toBe(locale)
        expect(track?.script).toBe(content.copy[kind])
        expect(file).toContain('view-switch')
      }
    }

    expect([...tracksByFile.keys()].sort()).toEqual(expectedFiles.sort())
    expect(staleRecordedCopy).toEqual([])
    for (const animalId of animalIds) {
      const reviewedOn = expansionAnimalIds.has(animalId)
        ? '2026-09-01'
        : '2026-08-24'
      expect(manifest.humanListeningReview[animalId]).toMatchObject({
        status: 'approved',
        reviewedBy: 'Leon',
        reviewedOn,
        scriptApprovedOn: reviewedOn,
      })
    }
    expect(manifest.humanListeningReview['view-switch']).toMatchObject({
      status: 'approved',
      reviewedBy: 'Leon',
      reviewedOn: '2026-08-25',
      scriptApprovedOn: '2026-08-25',
    })
    for (const locale of locales) {
      const content = scaleEncounterContentFor('mammoth', locale)
      expect(content.copy.intro).not.toMatch(/来到你身边|camera|move behind/i)
      expect(content.copy.transition).not.toMatch(
        /从头到脚|绕到你身后|来到你的眼睛|camera|move behind|arrive at your eyes/i,
      )
    }
    expect(manifest.publicDistributionDecision).toBe(
      'approved-all-production',
    )
  })

  it('records the intended fourth-tone reading for every Chinese Baryonyx line', () => {
    const tracks = manifest.tracks.filter(
      (track) =>
        track.locale === 'zh-CN' && track.file.startsWith('baryonyx-'),
    )
    expect(tracks).toHaveLength(3)
    for (const track of tracks) {
      expect(track.pronunciationContext).toContain('zhòng')
      expect(track.pronunciationContext).toContain('轻重的重')
    }
  })

  it('keeps every animal and locale contiguous on one normalized master', () => {
    expect(manifest.continuousNarrationPolicy).toMatchObject({
      guidedTrackCount: 148,
      animalPhaseTrackCount: 144,
      animalLocaleMasterCount: 48,
      sampleRateHz: 48_000,
      viewSwitchLocaleMasterCount: 2,
    })
    const tracksByFile = new Map(
      manifest.tracks.map((track) => [track.file, track]),
    )
    const masterHashes = new Set<string>()

    for (const animalId of narratedAnimalIds) {
      for (const locale of locales) {
        const content = scaleEncounterContentFor(animalId, locale)
        const tracks = lineKinds.map(
          (kind) => tracksByFile.get(audioFileName(content.audio[kind]))!,
        )
        const intro = tracks[0]!
        const transition = tracks[1]!
        const arrival = tracks[2]!
        const expectedMasterScriptHash = createHash('sha256')
          .update(lineKinds.map((kind) => content.copy[kind]).join('\n'))
          .digest('hex')
        expect(intro.continuousMasterSha256, `${animalId}.${locale}`).toBeTruthy()
        expect(intro.continuousMasterScriptSha256).toBe(
          expectedMasterScriptHash,
        )
        expect(new Set(tracks.map((track) => track.continuousMasterSha256)).size).toBe(1)
        expect(new Set(tracks.map((track) => track.continuousMasterScriptSha256)).size).toBe(1)
        expect(new Set(tracks.map((track) => track.continuousMasterEvidence)).size).toBe(1)
        expect(intro.startSample).toBe(0)
        expect(intro.endSample).toBe(transition.startSample)
        expect(transition.endSample).toBe(arrival.startSample)
        expect(arrival.endSample).toBeGreaterThan(arrival.startSample ?? 0)
        for (const track of tracks) {
          expect(track.endSample).toBeGreaterThan(track.startSample ?? -1)
          expect(track.durationSeconds).toBeCloseTo(
            ((track.endSample ?? 0) - (track.startSample ?? 0)) / 48_000,
            2,
          )
        }
        masterHashes.add(intro.continuousMasterSha256!)
      }
    }

    for (const locale of locales) {
      const content = scaleEncounterContentFor('pteranodon', locale)
      const tracks = viewSwitchLineKinds.map(
        (kind) => tracksByFile.get(audioFileName(content.audio[kind]))!,
      )
      const toEyes = tracks[0]!
      const toRear = tracks[1]!
      const expectedMasterScriptHash = createHash('sha256')
        .update(
          viewSwitchLineKinds
            .map((kind) => content.copy[kind])
            .join('\n'),
        )
        .digest('hex')
      expect(toEyes.continuousMasterSha256, locale).toBeTruthy()
      expect(toEyes.continuousMasterScriptSha256).toBe(
        expectedMasterScriptHash,
      )
      expect(toEyes.continuousMasterSha256).toBe(
        toRear.continuousMasterSha256,
      )
      expect(toEyes.continuousMasterEvidence).toBe(
        toRear.continuousMasterEvidence,
      )
      expect(toEyes.startSample).toBe(0)
      expect(toEyes.endSample).toBe(toRear.startSample)
      expect(toRear.endSample).toBeGreaterThan(toRear.startSample ?? 0)
      masterHashes.add(toEyes.continuousMasterSha256!)
    }

    expect(masterHashes.size).toBe(50)
    expect(
      manifest.tracks.filter((track) => !track.continuousMasterSha256),
    ).toEqual([])
  })

  it('keeps the finished whole-master cadence light without rushing the guide', () => {
    const tracksByFile = new Map(
      manifest.tracks.map((track) => [track.file, track]),
    )

    for (const animalId of [...narratedAnimalIds, 'view-switch'] as const) {
      for (const locale of locales) {
        const content = scaleEncounterContentFor(
          animalId === 'view-switch' ? 'pteranodon' : animalId,
          locale,
        )
        const kinds = animalId === 'view-switch'
          ? viewSwitchLineKinds
          : lineKinds
        const tracks = kinds.map((kind) =>
          tracksByFile.get(audioFileName(content.audio[kind]))!,
        )
        const masterDurationSeconds =
          (tracks.at(-1)?.endSample ?? 0) / 48_000
        const script = tracks.map((track) => track.script).join('\n')

        if (locale === 'zh-CN') {
          const spokenCharacters =
            script.match(/[\u3400-\u9fffA-Za-z0-9]/g)?.length ?? 0
          const charactersPerSecond =
            spokenCharacters / masterDurationSeconds
          expect(charactersPerSecond, `${animalId}.${locale}`).toBeGreaterThanOrEqual(3.2)
          expect(charactersPerSecond, `${animalId}.${locale}`).toBeLessThanOrEqual(4.5)
        } else {
          const spokenWords = script.match(/[A-Za-z]+/g)?.length ?? 0
          const wordsPerMinute =
            (spokenWords / masterDurationSeconds) * 60
          // The six expansion tracks retain their accepted slightly calmer
          // cadence; the earlier production set and shared viewpoint guide
          // keep the established 125 WPM floor.
          const minimumWordsPerMinute = expansionAnimalIds.has(animalId)
            ? 120
            : 125
          expect(wordsPerMinute, `${animalId}.${locale}`).toBeGreaterThanOrEqual(
            minimumWordsPerMinute,
          )
          expect(wordsPerMinute, `${animalId}.${locale}`).toBeLessThanOrEqual(175)
        }
      }
    }
  })
})


describe('publication-authorized narration additions', () => {
  it('binds all 72 new gallery and comparison files without claiming complete listening', async () => {
    const publication = JSON.parse(readFileSync(resolve(process.cwd(), 'src/content/narration-publication-authorization.json'), 'utf8')) as { readonly tracks: readonly { readonly animalId: string; readonly locale: string; readonly phase: string }[] }
    expect(publication).toMatchObject({ owner: 'Leon', recordedOn: '2026-10-30', action: 'public-distribution', completeListening: 'unverified' })
    expect(publication.tracks).toHaveLength(72)
    const ids = ['regaliceratops', 'sarcosuchus', 'anurognathus', 'therizinosaurus', 'phorusrhacos', 'sordes', 'quetzalcoatlus', 'dallasaurus', 'dakosaurus']
    for (const animalId of ids) for (const locale of locales) {
      expect(publication.tracks.filter((track: { animalId: string; locale: string }) => track.animalId === animalId && track.locale === locale).map((track: { phase: string }) => track.phase).sort()).toEqual(['arrival', 'gallery', 'intro', 'transition'])
    }
    expect(await validateNarrationPublicationAuthorization(process.cwd())).toBe(true)
  })
})
