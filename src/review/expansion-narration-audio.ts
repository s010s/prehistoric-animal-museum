import type { Locale } from '../i18n/locale'
import type { ExpansionReviewManifest, ExpansionNarrationTrack } from './expansion-manifest'
import { SKY_EXPANSION_REVIEW_ID_SET } from './sky-expansion-config'

type AudioPhase = 'gallery' | 'intro' | 'transition' | 'arrival' | 'toChildEyes' | 'toChildRear'
interface AudioIdentity {
  readonly animalId: string
  readonly locale: Locale
  readonly phase: AudioPhase
  readonly track?: ExpansionNarrationTrack
}

const tracks = new Map<string, AudioIdentity>()
const observed = new WeakSet<HTMLAudioElement>()

/** Registered only by the private expansion catalog, after server validation. */
export function registerExpansionNarrationEvidence(manifest: ExpansionReviewManifest): void {
  if (import.meta.env.MODE !== 'review') throw new Error('Candidate narration is local-review only.')
  for (const [animalId, localized] of Object.entries(manifest.galleryNarration ?? {})) {
    for (const locale of ['zh-CN', 'en'] as const) {
      const track = localized[locale]
      tracks.set(track.url, { animalId, locale, phase: 'gallery', track })
    }
  }
  for (const item of manifest.comparisons) {
    if (!item.narration) continue
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const phase of ['intro', 'transition', 'arrival'] as const) {
        const track = item.narration[locale][phase]
        tracks.set(track.url, { animalId: item.id, locale, phase, track })
      }
    }
  }
}

/** Passive real-media observations. Never calls load/play/pause or changes timing. */
export function observeExpansionNarrationMedia(
  audio: HTMLAudioElement,
  source: string,
  sharedPrompt?: Omit<AudioIdentity, 'track'>,
): void {
  if (import.meta.env.MODE !== 'review' || observed.has(audio)) return
  const identity: AudioIdentity | undefined = tracks.get(source) ?? (
    sharedPrompt && (sharedPrompt.animalId.startsWith('expansion-') || SKY_EXPANSION_REVIEW_ID_SET.has(sharedPrompt.animalId)) &&
    ['toChildEyes', 'toChildRear'].includes(sharedPrompt.phase)
      ? sharedPrompt
      : undefined
  )
  if (!identity) return
  observed.add(audio)
  let lastProgressAt = -Infinity
  const record = (event: string) => {
    if (event === 'timeupdate' && performance.now() - lastProgressAt < 1_000) return
    if (event === 'timeupdate') lastProgressAt = performance.now()
    let output = document.querySelector<HTMLOutputElement>('[data-testid="expansion-narration-evidence"]')
    if (!output) {
      output = document.createElement('output')
      output.hidden = true
      output.dataset.testid = 'expansion-narration-evidence'
      document.body.append(output)
    }
    const events = JSON.parse(output.dataset.events ?? '[]') as unknown[]
    events.push({
      event, at: new Date().toISOString(), elapsedMs: performance.now(),
      animalId: identity.animalId, locale: identity.locale, phase: identity.phase,
      source, currentSrc: audio.currentSrc, sha256: identity.track?.sha256 ?? null,
      declaredDurationMs: identity.track?.durationMs ?? null,
      currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : null,
      paused: audio.paused, ended: audio.ended, readyState: audio.readyState,
      errorCode: audio.error?.code ?? null,
      scenePhase: document.querySelector('[data-testid="scale-encounter"]')?.getAttribute('data-phase') ?? 'gallery',
    })
    output.dataset.events = JSON.stringify(events.slice(-512))
  }
  for (const event of ['loadedmetadata', 'playing', 'pause', 'ended', 'error', 'timeupdate']) {
    audio.addEventListener(event, () => record(event))
  }
  record('registered')
}
