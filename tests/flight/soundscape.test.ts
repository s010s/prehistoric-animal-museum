import { describe, expect, it } from 'vitest'
import { soundscapeMix } from '../../src/flight-experience/living/soundscape'
import { createWorldSampler } from '../../src/flight-experience/world'
const world = createWorldSampler()
const frame = { camera: { x: world.shorelineAt(0), y: 1.6, z: 0 }, rain: 0, wind: .2, active: true, delta: .1 }
describe('real-world spatial mix', () => {
 it('attenuates shore sound by height across twelve weather and camera mixes', () => {
  for (const rain of [0, .1, .5, 1]) {
   const mixes = [1.6, 120, 210].map(y => soundscapeMix(world, { ...frame, camera: { ...frame.camera, y }, rain }))
   expect(mixes[0]!.surf).toBeGreaterThan(mixes[1]!.surf); expect(mixes[1]!.surf).toBeGreaterThan(mixes[2]!.surf)
  }
  expect(soundscapeMix(world, { ...frame, camera: { ...frame.camera, y: 1400 } }).surf).toBeLessThan(.00001)
 })
 it('samples finite actual river and excludes ocean side', () => {
  const river = world.river.station(world.river.length * .5)
  expect(soundscapeMix(world, { ...frame, camera: { x: river.x, y: river.waterLevel + 2, z: river.z } }).river).toBeGreaterThan(0)
  expect(soundscapeMix(world, { ...frame, camera: { x: world.shorelineAt(420) - 50, y: 2, z: 420 } }).river).toBe(0)
 })
})
