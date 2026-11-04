import {describe,expect,it} from 'vitest'
import {clockPolicy,EnvironmentClock,type EnvironmentActivity} from '../../src/flight-experience/environment/environment-clock'

describe('independent environment time',()=>{
 it('scrubbing changes sunlight without rewinding wave time', () => {
    const clock = new EnvironmentClock()
    clock.tick(1 / 60, clockPolicy('flying'))
    const waveTime = clock.motionSeconds
    for (const solar of [.2, .9, .2]) {
      clock.setSolarDayProgress(solar)
      expect(clock.solarDayProgress).toBe(solar)
      expect(clock.motionSeconds).toBe(waveTime)
      expect(clock.solarMode).toBe('fixed')
    }
    clock.tick(1 / 60, clockPolicy('viewpoint'))
    expect(clock.motionSeconds).toBeCloseTo(waveTime + 1 / 60)
  })
 it('fixed sun permits water motion, and pause scenery freezes it', () => {
    const clock = new EnvironmentClock()
    clock.tick(.02, clockPolicy('viewpoint'))
    expect(clock.motionSeconds).toBe(.02)
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
 it('manual override stops automatic sunlight while water motion continues', () => {
  const clock = new EnvironmentClock(), policy = clockPolicy('flying')
  clock.setSolarMode('auto')
  clock.tick(1/60, policy)
  const motion = clock.motionSeconds
  clock.setSolarDayProgress(.42)
  expect(clock.solarMode).toBe('fixed'); expect(clock.motionSeconds).toBe(motion)
  clock.tick(1/60, policy)
  expect(clock.motionSeconds).toBeGreaterThan(motion); expect(clock.solarDayProgress).toBe(.42)
 })
})
