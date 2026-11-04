import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  scaleEncounterContentFor,
  type GuidedLineKind,
  type ScaleEncounterAnimalId,
} from '../src/scale-encounter/content'
import type { Locale } from '../src/i18n/locale'
import { selectedScaleEncounterAnimalIds } from '../src/scale-encounter/types'

interface NarrationTrack {
  readonly file: string
  readonly locale: Locale
  readonly script: string
  readonly sha256: string
}

interface NarrationManifest {
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

const additionManifest = JSON.parse(
  readFileSync(resolve(audioDirectory, 'additions-manifest.json'), 'utf8'),
) as NarrationManifest
const tracks = [...manifest.tracks, ...additionManifest.tracks]

const narratedAnimalIds: readonly ScaleEncounterAnimalId[] =
  selectedScaleEncounterAnimalIds
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

function audioAssetPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? url
  return decodeURIComponent(path.split('/scale-encounter/audio/').at(-1) ?? path)
}

describe('scale encounter narration asset integrity', () => {
  it('keeps narration files tied to their recorded hashes', () => {
    for (const track of tracks) {
      const bytes = readFileSync(resolve(audioDirectory, track.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        track.sha256,
      )
    }
  })

  it('selects narration files whose language and recorded scripts match every encounter', () => {
    const tracksByFile = new Map(
      tracks.map((track) => [audioAssetPath(track.file), track]),
    )

    for (const animalId of narratedAnimalIds) {
      for (const locale of locales) {
        const content = scaleEncounterContentFor(animalId, locale)
        for (const kind of lineKinds) {
          const file = audioAssetPath(content.audio[kind])
          const track = tracksByFile.get(file)
          expect(track, file).toBeDefined()
          expect(track?.locale).toBe(locale)
          expect(track?.script).toBe(content.copy[kind])
        }
      }
    }

    for (const locale of locales) {
      const content = scaleEncounterContentFor('pteranodon', locale)
      for (const kind of viewSwitchLineKinds) {
        const file = audioAssetPath(content.audio[kind])
        const track = tracksByFile.get(file)
        expect(track, file).toBeDefined()
        expect(track?.locale).toBe(locale)
        expect(track?.script).toBe(content.copy[kind])
      }
    }
  })
})
