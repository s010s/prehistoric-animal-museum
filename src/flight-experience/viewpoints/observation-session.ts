import type { Viewpoint } from './viewpoint-catalog'
export type ObservationPhase = 'inactive' | 'preparing' | 'active' | 'returning' | 'failed'
/** Only return metadata is retained. The host keeps one bounded active world window. */
export class ObservationSession<Bookmark> {
  phase: ObservationPhase = 'inactive'
  generation = 0
  target: Viewpoint | null = null
  bookmark: Bookmark | null = null
  sceneryPaused = false
  private remaining = 20000
  private sampledAt = 0
  private preparationAvailable = true
  private resetBudget(now: number) { this.remaining = 20000; this.sampledAt = now }
  private sampleBudget(now: number) {
    if (this.preparationAvailable && ['preparing', 'returning'].includes(this.phase)) this.remaining -= Math.max(0, now - this.sampledAt)
    this.sampledAt = now
  }
  setPreparationAvailable(available: boolean, now: number) {
    this.sampleBudget(now); this.preparationAvailable = available
  }
  request(target: Viewpoint, bookmark: Bookmark, now: number) {
    if (this.bookmark === null) { this.bookmark = bookmark; this.sceneryPaused = false }
    this.target = target; this.phase = 'preparing'; this.resetBudget(now)
    return ++this.generation
  }
  returnToTravel(now: number) {
    if (this.bookmark === null) return this.generation
    this.target = null; this.phase = 'returning'; this.resetBudget(now)
    return ++this.generation
  }
  complete(token: number): boolean {
    if (token !== this.generation || !['preparing','returning'].includes(this.phase)) return false
    if (this.phase === 'returning') { this.phase = 'inactive'; this.bookmark = null }
    else this.phase = 'active'
    return true
  }
  checkTimeout(now: number) {
    this.sampleBudget(now)
    if (this.preparationAvailable && ['preparing','returning'].includes(this.phase) && this.remaining <= 0) { this.phase = 'failed'; this.sceneryPaused = true; return true }
    return false
  }
  suspend() { this.sceneryPaused = true }
  fail() { ++this.generation; this.phase = 'failed'; this.sceneryPaused = true }
  close() { ++this.generation; this.phase = 'inactive'; this.target = null; this.bookmark = null; this.sceneryPaused = true }
}
