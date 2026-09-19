/** Environment time is independent of FlightSimulation and its original mixer. */
export type EnvironmentActivity = 'flying' | 'viewpoint' | 'paused' | 'viewpoint-preparing' | 'return-preparing' | 'hidden' | 'context-lost' | 'error' | 'closed'
export interface ClockPolicy {
  readonly advanceMovement: boolean
  readonly advanceEnvironmentMotion: boolean
  readonly advanceAutomaticSun: boolean
  readonly allowExplicitSolarPreview: boolean
  readonly allowBudgetedPreparation: boolean
}
export function clockPolicy(activity: EnvironmentActivity, sceneryPaused = false): ClockPolicy {
  const active = activity === 'flying' || activity === 'viewpoint'
  const suspended = ['hidden', 'context-lost', 'error', 'closed'].includes(activity)
  return {
    advanceMovement: activity === 'flying',
    advanceEnvironmentMotion: active && !sceneryPaused,
    advanceAutomaticSun: active && !sceneryPaused,
    allowExplicitSolarPreview: active || activity === 'paused',
    allowBudgetedPreparation: !suspended,
  }
}
export const DAYLIGHT_START = .08
export const DAYLIGHT_END = .94
export const FULL_DAYLIGHT_SECONDS = 600
export const DAYLIGHT_RATE = (DAYLIGHT_END - DAYLIGHT_START) / FULL_DAYLIGHT_SECONDS
/** Match the existing simulation's four fixed steps; never catch up after suspension. */
export const MAX_ENVIRONMENT_DELTA = 4 / 60
export function admittedEnvironmentDelta(delta: number): number {
  return Number.isFinite(delta) ? Math.min(MAX_ENVIRONMENT_DELTA, Math.max(0, delta)) : 0
}
export type SolarMode = 'fixed' | 'auto'
export type DaylightStatus = 'idle' | 'running' | 'suspended' | 'ended'
export interface DaylightSnapshot {
  mode: SolarMode
  status: DaylightStatus
  progress: number
  remainingActiveSeconds: number
}
export class EnvironmentClock {
  private motion = 0
  private solar = .68
  private mode: SolarMode = 'fixed'
  get motionSeconds() { return this.motion }
  get solarDayProgress() { return this.solar }
  get solarMode() { return this.mode }
  snapshot(policy: ClockPolicy): DaylightSnapshot {
    return { mode: this.mode, progress: this.solar,
      status: this.mode === 'fixed' ? 'idle' : this.solar >= DAYLIGHT_END ? 'ended' : policy.advanceAutomaticSun ? 'running' : 'suspended',
      remainingActiveSeconds: (DAYLIGHT_END - this.solar) / DAYLIGHT_RATE }
  }
  tick(delta: number, policy: ClockPolicy) {
    const admitted = admittedEnvironmentDelta(delta)
    if (policy.advanceEnvironmentMotion) this.motion += admitted
    if (this.mode === 'auto' && policy.advanceAutomaticSun && this.solar < DAYLIGHT_END) {
      const next = this.solar + admitted * DAYLIGHT_RATE
      this.solar = next >= DAYLIGHT_END - 1e-10 ? DAYLIGHT_END : next
    }
  }
  setSolarMode(mode: SolarMode) { this.mode = mode }
  restartDaylightFromMorning() { this.solar = DAYLIGHT_START; this.mode = 'auto' }
  /** A manual override cancels auto without rewinding motion or the animal. */
  setSolarDayProgress(value: number) {
    if (!Number.isFinite(value)) return
    this.solar = Math.max(DAYLIGHT_START, Math.min(DAYLIGHT_END, value)); this.mode = 'fixed'
  }
  /** Explicit DEV capture restoration, never called by a solar control. */
  restoreCaptureMotion(value: number) {
    if (Number.isFinite(value) && value >= 0) this.motion = value
  }
}
