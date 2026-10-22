import { observeExpansionNarrationMedia } from '../review/expansion-narration-audio'
import { observeCandidateNarrationMedia } from './candidate-media-observation'

export const NARRATION_UNAVAILABLE_LABEL = '介绍准备中'

export type NarrationAvailability = 'missing' | 'available' | 'undecodable'
export type NarrationPlayback = 'stopped' | 'playing' | 'paused'

export interface NarrationSnapshot {
  readonly animalId: string | null
  readonly source: string | null
  readonly availability: NarrationAvailability
  readonly playback: NarrationPlayback
  readonly error: Error | null
}

export interface NarrationTrack {
  readonly animalId: string
  readonly source?: string | null
}

export interface NarrationMedia {
  currentTime: number
  readonly error?: unknown
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}

export type NarrationMediaFactory = (
  source: string,
  animalId: string,
) => NarrationMedia

export type NarrationPlayResult =
  | { readonly status: 'playing' }
  | { readonly status: 'paused' }
  | { readonly status: 'stale' }
  | {
      readonly status: 'unavailable'
      readonly availability: Exclude<NarrationAvailability, 'available'>
      readonly error: Error | null
    }

export interface NarrationControllerOptions {
  readonly createMedia?: NarrationMediaFactory
}

interface MediaListeners {
  readonly media: NarrationMedia
  readonly generation: number
  readonly ended: () => void
  readonly error: () => void
}

interface ActivePlay {
  readonly operation: number
  readonly promise: Promise<NarrationPlayResult>
}

type Listener = () => void

function createBrowserMedia(source: string, animalId: string): NarrationMedia {
  const audio = new Audio(source)
  audio.autoplay = false
  audio.preload = 'auto'
  observeExpansionNarrationMedia(audio, source)
  observeCandidateNarrationMedia(audio, source, { animalId, phase: 'gallery' })
  return audio
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException
  ) {
    return error
  }
  return new Error(typeof error === 'string' ? error : 'Unknown narration error')
}

export interface NarrationControlLabels {
  readonly listen: string
  readonly pause: string
  readonly unavailable: string
}

const defaultNarrationControlLabels: NarrationControlLabels = {
  listen: '听它的介绍',
  pause: '暂停介绍',
  unavailable: NARRATION_UNAVAILABLE_LABEL,
}

export function getNarrationControlLabel(
  snapshot: NarrationSnapshot,
  labels: NarrationControlLabels = defaultNarrationControlLabels,
): string {
  if (snapshot.availability !== 'available') {
    return labels.unavailable
  }
  return snapshot.playback === 'playing' ? labels.pause : labels.listen
}

/**
 * Owns one committed animal's narration element. Committing a track does not
 * create media or start playback. Idle `prepare` may fetch it, while only an
 * explicit `play` or `toggle` call can start sound.
 */
export class NarrationController {
  readonly getSnapshot = (): NarrationSnapshot => this.snapshot

  readonly getServerSnapshot = (): NarrationSnapshot => this.snapshot

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private snapshot: NarrationSnapshot = {
    animalId: null,
    source: null,
    availability: 'missing',
    playback: 'stopped',
    error: null,
  }
  private readonly listeners = new Set<Listener>()
  private readonly createMedia: NarrationMediaFactory
  private mediaListeners: MediaListeners | null = null
  private activePlay: ActivePlay | null = null
  private generation = 0
  private operation = 0
  private destroyed = false

  constructor(options: NarrationControllerOptions = {}) {
    this.createMedia = options.createMedia ?? createBrowserMedia
  }

  /**
   * Replace the committed narration. The previous media is paused and rewound.
   * A null, undefined, or blank source enters the non-blocking missing state.
   */
  commit(track: NarrationTrack): void {
    this.assertUsable()
    this.releaseMedia()
    ++this.generation
    ++this.operation
    this.activePlay = null

    const source = track.source?.trim() || null
    if (source === null) {
      this.setSnapshot({
        animalId: track.animalId,
        source: null,
        availability: 'missing',
        playback: 'stopped',
        error: null,
      })
      return
    }

    this.setSnapshot({
      animalId: track.animalId,
      source,
      availability: 'available',
      playback: 'stopped',
      error: null,
    })
  }

  /**
   * Create the committed track's media element without playing it. Calling
   * this repeatedly is safe, so idle work and a user click can race.
   */
  prepare(): boolean {
    this.assertUsable()
    return this.ensureMedia() !== null
  }

  /**
   * Begin narration in response to an explicit user action. Repeated play calls
   * while the same attempt is pending share one promise.
   */
  play(): Promise<NarrationPlayResult> {
    this.assertUsable()
    const existingPlay = this.activePlay
    if (existingPlay !== null) {
      return existingPlay.promise
    }

    const listeners = this.ensureMedia()
    if (listeners === null) {
      return Promise.resolve({
        status: 'unavailable',
        availability:
          this.snapshot.availability === 'available'
            ? 'missing'
            : this.snapshot.availability,
        error: this.snapshot.error,
      })
    }
    if (this.snapshot.playback === 'playing') {
      return Promise.resolve({ status: 'playing' })
    }

    const operation = ++this.operation
    let browserPlay: Promise<void>
    try {
      browserPlay = listeners.media.play()
    } catch (error: unknown) {
      const normalizedError = normalizeError(error)
      this.markUndecodable(
        listeners.media,
        listeners.generation,
        normalizedError,
      )
      return Promise.resolve({
        status: 'unavailable',
        availability: 'undecodable',
        error: normalizedError,
      })
    }

    const promise = Promise.resolve(browserPlay).then(
      (): NarrationPlayResult => {
        if (!this.isCurrentOperation(listeners, operation)) {
          return { status: 'stale' }
        }
        this.activePlay = null
        return { status: 'playing' }
      },
      (error: unknown): NarrationPlayResult => {
        if (!this.isCurrentOperation(listeners, operation)) {
          return { status: 'stale' }
        }
        this.activePlay = null
        const normalizedError = normalizeError(error)
        this.markUndecodable(
          listeners.media,
          listeners.generation,
          normalizedError,
        )
        return {
          status: 'unavailable',
          availability: 'undecodable',
          error: normalizedError,
        }
      },
    )
    // A media implementation may synchronously emit an error (or user code may
    // synchronously pause/commit) from inside `play()`. Do not overwrite that
    // newer state with an optimistic playing snapshot.
    if (!this.isCurrentOperation(listeners, operation)) {
      return promise
    }
    this.activePlay = { operation, promise }
    this.setSnapshot({
      ...this.snapshot,
      playback: 'playing',
      error: null,
    })
    return promise
  }

  pause(): void {
    this.assertUsable()
    const listeners = this.mediaListeners
    if (
      listeners === null ||
      this.snapshot.availability !== 'available'
    ) {
      return
    }

    ++this.operation
    this.activePlay = null
    this.safePause(listeners.media)
    this.setSnapshot({
      ...this.snapshot,
      playback: 'paused',
    })
  }

  reset(): void {
    this.assertUsable()
    ++this.operation
    this.activePlay = null
    const listeners = this.mediaListeners
    if (listeners !== null) {
      this.safePause(listeners.media)
      this.safeRewind(listeners.media)
    }
    this.setSnapshot({
      ...this.snapshot,
      playback: 'stopped',
    })
  }

  toggle(): Promise<NarrationPlayResult> {
    this.assertUsable()
    if (
      this.snapshot.availability === 'available' &&
      this.snapshot.playback === 'playing'
    ) {
      this.pause()
      return Promise.resolve({ status: 'paused' })
    }
    return this.play()
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    ++this.operation
    ++this.generation
    this.activePlay = null
    this.releaseMedia()
    this.listeners.clear()
  }

  private handleEnded(media: NarrationMedia, generation: number): void {
    if (!this.isCurrentMedia(media, generation)) {
      return
    }
    ++this.operation
    this.activePlay = null
    this.safeRewind(media)
    this.setSnapshot({
      ...this.snapshot,
      playback: 'stopped',
    })
  }

  private ensureMedia(): MediaListeners | null {
    if (this.mediaListeners !== null) {
      return this.mediaListeners
    }
    const { animalId, availability, source } = this.snapshot
    if (availability !== 'available' || animalId === null || source === null) {
      return null
    }

    const generation = this.generation
    let media: NarrationMedia
    try {
      media = this.createMedia(source, animalId)
    } catch (error: unknown) {
      this.setSnapshot({
        ...this.snapshot,
        availability: 'undecodable',
        playback: 'stopped',
        error: normalizeError(error),
      })
      return null
    }

    const ended = () => {
      this.handleEnded(media, generation)
    }
    const error = () => {
      this.handleMediaError(media, generation)
    }
    media.addEventListener('ended', ended)
    media.addEventListener('error', error)
    this.mediaListeners = { media, generation, ended, error }
    return this.mediaListeners
  }

  private handleMediaError(
    media: NarrationMedia,
    generation: number,
  ): void {
    const error = normalizeError(
      media.error ?? new Error('The narration audio could not be decoded'),
    )
    this.markUndecodable(media, generation, error)
  }

  private markUndecodable(
    media: NarrationMedia,
    generation: number,
    error: Error,
  ): void {
    if (!this.isCurrentMedia(media, generation)) {
      return
    }

    ++this.operation
    this.activePlay = null
    this.safePause(media)
    this.safeRewind(media)
    this.detachMediaListeners()
    this.setSnapshot({
      ...this.snapshot,
      availability: 'undecodable',
      playback: 'stopped',
      error,
    })
  }

  private isCurrentOperation(
    listeners: MediaListeners,
    operation: number,
  ): boolean {
    return (
      !this.destroyed &&
      this.mediaListeners === listeners &&
      this.operation === operation
    )
  }

  private isCurrentMedia(
    media: NarrationMedia,
    generation: number,
  ): boolean {
    return (
      !this.destroyed &&
      this.mediaListeners?.media === media &&
      this.mediaListeners.generation === generation
    )
  }

  private releaseMedia(): void {
    const listeners = this.mediaListeners
    if (listeners === null) {
      return
    }
    this.safePause(listeners.media)
    this.safeRewind(listeners.media)
    this.detachMediaListeners()
  }

  private detachMediaListeners(): void {
    const listeners = this.mediaListeners
    if (listeners === null) {
      return
    }
    listeners.media.removeEventListener('ended', listeners.ended)
    listeners.media.removeEventListener('error', listeners.error)
    this.mediaListeners = null
  }

  private safePause(media: NarrationMedia): void {
    try {
      media.pause()
    } catch {
      // Pausing is best-effort during cleanup.
    }
  }

  private safeRewind(media: NarrationMedia): void {
    try {
      media.currentTime = 0
    } catch {
      // Some media implementations are not seekable before metadata is ready.
    }
  }

  private setSnapshot(snapshot: NarrationSnapshot): void {
    if (this.destroyed) {
      return
    }
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      listener()
    }
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error('NarrationController has been destroyed')
    }
  }
}
