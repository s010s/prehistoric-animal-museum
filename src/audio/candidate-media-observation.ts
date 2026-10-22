interface CandidateMediaIdentity {
  readonly animalId: string
  readonly phase: string
  readonly locale?: string
}

const observed = new WeakSet<HTMLAudioElement>()

/** Passive observations for the local candidate/E2E build; never drives media. */
export function observeCandidateNarrationMedia(
  audio: HTMLAudioElement,
  source: string,
  identity: CandidateMediaIdentity,
): void {
  if (import.meta.env.MODE !== 'release-candidate' && import.meta.env.MODE !== 'e2e') return
  if (observed.has(audio)) return
  observed.add(audio)
  const locale = identity.locale ?? document.documentElement.lang
  let lastProgressAt = -Infinity
  const record = (event: string) => {
    if (event === 'timeupdate' && performance.now() - lastProgressAt < 1_000) return
    if (event === 'timeupdate') lastProgressAt = performance.now()
    let output = document.querySelector<HTMLOutputElement>('[data-testid="candidate-media-evidence"]')
    if (!output) {
      output = document.createElement('output')
      output.hidden = true
      output.dataset.testid = 'candidate-media-evidence'
      document.body.append(output)
    }
    const events = JSON.parse(output.dataset.events ?? '[]') as unknown[]
    events.push({
      event,
      at: new Date().toISOString(),
      elapsedMs: performance.now(),
      animalId: identity.animalId,
      locale,
      phase: identity.phase,
      source,
      currentSrc: audio.currentSrc,
      currentTime: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      paused: audio.paused,
      ended: audio.ended,
      readyState: audio.readyState,
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
