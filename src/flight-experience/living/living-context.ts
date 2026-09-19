import type { ClockPolicy } from '../environment/environment-clock'
import { admittedEnvironmentDelta } from '../environment/environment-clock'
import type { WeatherState } from '../environment/weather-controller'

export interface LivingIntent { wind: boolean; companions: boolean }
export const DEFAULT_LIVING_INTENT: Readonly<LivingIntent> = Object.freeze({ wind: false, companions: false })
export interface LivingContext {
  readonly generation: number
  readonly active: boolean
  readonly delta: number
  readonly motionSeconds: number
  readonly camera: Readonly<{x:number;y:number;z:number}>
  readonly player: Readonly<{x:number;y:number;z:number}>
  readonly heading: number
  readonly quality: 'low' | 'balanced'
  readonly gentle: boolean
  readonly weather: WeatherState
  readonly intent: Readonly<LivingIntent>
}
/** Derived from the existing admitted frame; owns no timer or simulation clock. */
export function livingContext(input: Omit<LivingContext, 'active' | 'delta'>, policy: ClockPolicy, delta: number): LivingContext {
  return { ...input, active: policy.advanceEnvironmentMotion,
    delta: policy.advanceEnvironmentMotion ? admittedEnvironmentDelta(delta) : 0 }
}

/** Own only resources created by this scope. Shared model textures stay with their owner. */
export class LivingScope {
  private revision = 0
  private closed = false
  private readonly releases = new Set<() => void>()
  get generation() { return this.revision }
  accepts(token: number) { return !this.closed && token === this.revision }
  invalidate() { this.revision++ }
  own(release: () => void) {
    if (this.closed) { release(); return () => {} }
    this.releases.add(release)
    return () => { if (this.releases.delete(release)) release() }
  }
  dispose() {
    if (this.closed) return
    this.closed = true; this.invalidate()
    for (const release of this.releases) release()
    this.releases.clear()
  }
}
