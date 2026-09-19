import { describe, expect, it } from 'vitest'
import { clockPolicy, EnvironmentClock, MAX_ENVIRONMENT_DELTA, type EnvironmentActivity } from '../../src/flight-experience/environment/environment-clock'
import { FlightSimulation, ZERO_INPUT } from '../../src/flight-experience/simulation'
import { animationWeights } from '../../src/flight-experience/flight-animation-default'

describe('E1 independent environment clock', () => {
  it.each([
    ['flying', true, true, true, true],
    ['viewpoint', false, true, true, true],
    ['paused', false, false, true, true],
    ['viewpoint-preparing', false, false, false, true],
    ['return-preparing', false, false, false, true],
    ['hidden', false, false, false, false],
    ['context-lost', false, false, false, false],
    ['closed', false, false, false, false],
  ] as const)('%s admits only its permitted work', (activity, movement, motion, preview, preparation) => {
    expect(clockPolicy(activity)).toEqual({ advanceMovement: movement, advanceEnvironmentMotion: motion,
      advanceAutomaticSun: motion, allowExplicitSolarPreview: preview, allowBudgetedPreparation: preparation })
  })
  it('scrubbing changes sunlight without driving travel or rewinding wave time', () => {
    const clock = new EnvironmentClock(), simulation = new FlightSimulation(() => 0)
    simulation.advance(1 / 60, ZERO_INPUT)
    clock.tick(1 / 60, clockPolicy('flying'))
    const before = simulation.renderState(), waveTime = clock.motionSeconds
    for (const solar of [.2, .9, .2]) {
      clock.setSolarDayProgress(solar)
      expect(clock.solarDayProgress).toBe(solar)
      expect(clock.motionSeconds).toBe(waveTime)
      expect(simulation.renderState()).toEqual(before)
      expect(clock.solarMode).toBe('fixed')
    }
    expect(clockPolicy('flying').advanceMovement).toBe(true)
    clock.tick(1 / 60, clockPolicy('viewpoint'))
    expect(clock.motionSeconds).toBeCloseTo(waveTime + 1 / 60)
    expect(animationWeights('auto')).toEqual({ source: 1, powered: 0, glide: 0 })
  })
  it('fixed sun permits water motion, and pause scenery freezes it', () => {
    const clock = new EnvironmentClock()
    clock.tick(.02, clockPolicy('viewpoint'))
    expect(clock.motionSeconds).toBe(.02)
    expect(clock.solarDayProgress).toBe(.68)
    clock.tick(60, clockPolicy('viewpoint', true))
    expect(clock.motionSeconds).toBe(.02)
    clock.setSolarDayProgress(.94)
    expect(clock.motionSeconds).toBe(.02)
  })
  it.each(['paused', 'hidden', 'context-lost', 'viewpoint-preparing', 'return-preparing', 'closed'] as EnvironmentActivity[])(
    'does not accumulate a 60 second %s gap', activity => {
      const clock = new EnvironmentClock()
      clock.tick(.02, clockPolicy('flying'))
      clock.tick(60, clockPolicy(activity))
      expect(clock.motionSeconds).toBe(.02)
      clock.tick(.01, clockPolicy('paused'))
      expect(clock.motionSeconds).toBe(.02)
      clock.tick(.01, clockPolicy('flying'))
      expect(clock.motionSeconds).toBeCloseTo(.03)
    })
  it('rejects nonfinite input and bounds delta and sunlight endpoints', () => {
    const clock = new EnvironmentClock()
    for (const delta of [NaN, Infinity, -Infinity, -1]) clock.tick(delta, clockPolicy('flying'))
    expect(clock.motionSeconds).toBe(0)
    clock.tick(600, clockPolicy('flying'))
    expect(clock.motionSeconds).toBe(MAX_ENVIRONMENT_DELTA)
    for (const value of [NaN, Infinity, -Infinity]) clock.setSolarDayProgress(value)
    expect(clock.solarDayProgress).toBe(.68)
    clock.setSolarDayProgress(-1); expect(clock.solarDayProgress).toBe(.08)
    clock.setSolarDayProgress(2); expect(clock.solarDayProgress).toBe(.94)
  })
})

describe('automatic daylight', () => {
 it.each([15, 30, 60, 120])('completes exactly one full daylight in 600 admitted seconds at %i Hz', hz => {
  const clock = new EnvironmentClock(), policy = clockPolicy('viewpoint')
  clock.restartDaylightFromMorning()
  for (let frame = 0; frame < 600 * hz; frame++) clock.tick(1 / hz, policy)
  expect(clock.solarDayProgress).toBe(.94)
  expect(clock.snapshot(policy).status).toBe('ended')
  clock.tick(1 / hz, policy)
  expect(clock.solarDayProgress).toBe(.94)
  expect(clock.motionSeconds).toBeGreaterThan(600)
 })
 it('continues from afternoon, suspends without catch-up, and manual override only stops the sun', () => {
  const clock = new EnvironmentClock(), policy = clockPolicy('flying')
  clock.setSolarMode('auto')
  expect(clock.solarDayProgress).toBe(.68)
  expect(clock.snapshot(policy).remainingActiveSeconds).toBeCloseTo(181.395349)
  clock.tick(60, clockPolicy('hidden'))
  expect(clock.snapshot(clockPolicy('hidden')).status).toBe('suspended')
  expect(clock.solarDayProgress).toBe(.68)
  clock.tick(1/60, policy)
  expect(clock.solarDayProgress).toBeGreaterThan(.68)
  const motion = clock.motionSeconds
  clock.setSolarDayProgress(.42)
  expect(clock.solarMode).toBe('fixed'); expect(clock.motionSeconds).toBe(motion)
  clock.tick(1/60, policy)
  expect(clock.motionSeconds).toBeGreaterThan(motion); expect(clock.solarDayProgress).toBe(.42)
 })
 it('bounds long frames, rejects invalid deltas and replays without resetting motion', () => {
  const clock = new EnvironmentClock(), policy = clockPolicy('viewpoint')
  clock.setSolarMode('auto')
  for (const dt of [NaN, Infinity, -Infinity, -1]) clock.tick(dt, policy)
  expect(clock.solarDayProgress).toBe(.68)
  clock.tick(60, policy)
  expect(clock.solarDayProgress).toBeCloseTo(.68 + MAX_ENVIRONMENT_DELTA * .86 / 600, 12)
  const motion = clock.motionSeconds
  clock.restartDaylightFromMorning()
  expect(clock.motionSeconds).toBe(motion)
  expect(clock.solarDayProgress).toBe(.08)
  expect(clock.snapshot(clockPolicy('paused')).status).toBe('suspended')
 })
})
