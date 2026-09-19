import { describe, expect, it } from 'vitest'
import { FlightInputState } from '../../src/flight-experience/input'
import { DEFAULT_FLIGHT_SETTINGS, framingDistance, spawnState } from '../../src/flight-experience/settings'
import { safeSurface, terrainAt } from '../../src/flight-experience/world'
import { FlightSimulation } from '../../src/flight-experience/simulation'
describe('R2-11 settings and R2-12 input sources', () => {
  it.each([[1, 2], [2, 1]])('releases touch sources independently in order %s, %s', (a, b) => {
    const input = new FlightInputState(); input.point(0, 1, 1); input.point(1, 0, 2)
    expect(input.read()).toEqual({ turn: 1, climb: 1 })
    input.release(a)
    expect(input.read()).toEqual(a === 1 ? { turn: 1, climb: 0 } : { turn: 0, climb: 1 })
    input.key('KeyW', true); input.release(b)
    expect(input.read()).toEqual({ turn: 0, climb: 1 })
    input.point(-1, 0, 3); input.clear(); input.release(3)
    expect(input.read()).toEqual({ turn: 0, climb: 0 })
  })
  it('starts above actual ground and clears every tested wing/camera corridor', () => {
    for (const start of ['coast', 'valley', 'overview'] as const) for (const height of [100, 190, 350] as const) {
      const settings = { ...DEFAULT_FLIGHT_SETTINGS, start, height }, state = spawnState(settings), p = state.position
      expect(p.y).toBeGreaterThanOrEqual(Math.max(0, terrainAt(p.x, p.z).height) + height)
      for (let d = -40; d <= 168; d += 12) for (const lateral of [-20, 0, 20]) {
        expect(p.y).toBeGreaterThanOrEqual(safeSurface(p.x + Math.sin(state.heading) * d + Math.cos(state.heading) * lateral, p.z - Math.cos(state.heading) * d + Math.sin(state.heading) * lateral) + 49.99)
      }
    }
  })
  it('keeps portrait framing wider in distance and smoothly accelerates without moving the world', () => {
    expect(framingDistance(.46, 'standard')).toBeGreaterThan(framingDistance(1.77, 'standard'))
    expect(framingDistance(1.77, 'near')).toBeLessThan(framingDistance(1.77, 'wide'))
    const sim = new FlightSimulation(() => 0), before = { ...sim.position }
    sim.cruiseSpeed = 36; expect(sim.position).toEqual(before)
    let speed = sim.speed
    for (let i = 0; i < 600; i++) {
      sim.advance(1 / 60, { turn: 0, climb: 0 })
      expect(Math.abs(sim.speed - speed)).toBeLessThanOrEqual(3 / 60 + 1e-8); speed = sim.speed
    }
    expect(speed).toBeGreaterThan(35)
  })
})
