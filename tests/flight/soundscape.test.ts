import { describe, expect, it, vi } from 'vitest'
import { Soundscape, soundscapeMix } from '../../src/flight-experience/living/soundscape'
import { createWorldSampler } from '../../src/flight-experience/world'
const world = createWorldSampler()
const frame = { camera: { x: world.shorelineAt(0), y: 1.6, z: 0 }, rain: 0, wind: .2, active: true, delta: .1 }
function mockContext(resume = () => Promise.resolve()) {
 const param = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() })
 const gains: ReturnType<typeof param>[] = []
 const ctx = { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(resume), suspend: vi.fn(async () => {}), close: vi.fn(async () => {}), createGain: () => { const gain = param(); gains.push(gain); return { gain, connect: vi.fn(), disconnect: vi.fn() } }, createBufferSource: vi.fn(() => ({ buffer: null, loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })), decodeAudioData: vi.fn(() => Promise.resolve({ length: 48000 * 12, numberOfChannels: 1 })) }
 return { ctx, gains, context: ctx as unknown as AudioContext }
}
const load = () => Promise.resolve(new ArrayBuffer(8))
describe('soundscape consent and lifecycle', () => {
 it('allocates nothing until consent; always resumes before loading; uses four sources and actual decoded PCM', async () => {
  const mock = mockContext(), factory = vi.fn(() => mock.context), loader = vi.fn(load), sound = new Soundscape(world, { createContext: factory, load: loader })
  sound.update(frame); expect(factory).not.toHaveBeenCalled(); const pending = sound.enable(); expect(mock.ctx.resume).toHaveBeenCalledOnce(); expect(loader).not.toHaveBeenCalled(); await pending
  expect(sound.getSnapshot()).toMatchObject({ sourceCount: 4, decodedBytes: 9216000, status: 'playing' })
  for (let i = 0; i < 200; i++) sound.update(frame)
  expect(mock.ctx.createBufferSource).toHaveBeenCalledTimes(4)
  sound.dispose(); expect(sound.getSnapshot()).toMatchObject({ sourceCount: 0, decodedBytes: 0, contextCount: 0 })
 })
 it('discards decode after disable without creating a source', async () => {
  const mock = mockContext(); let resolve!: (value: { length: number; numberOfChannels: number }) => void
  mock.ctx.decodeAudioData.mockImplementation(() => new Promise(r => { resolve = r }))
  const sound = new Soundscape(world, { createContext: () => mock.context, load }); sound.update(frame); const pending = sound.enable()
  await vi.waitFor(() => expect(resolve).toBeDefined()); sound.disable(); resolve({ length: 1, numberOfChannels: 1 }); await pending
  expect(mock.ctx.createBufferSource).not.toHaveBeenCalled(); expect(sound.getSnapshot().status).toBe('off')
 })
 it('does not load or revive after exit while permission is pending', async () => {
  let resume!: () => void; const mock = mockContext(() => new Promise<void>(r => { resume = r })), loader = vi.fn(load)
  const sound = new Soundscape(world, { createContext: () => mock.context, load: loader }); const pending = sound.enable(); sound.dispose(); resume(); await pending
  expect(loader).not.toHaveBeenCalled(); expect(mock.ctx.close).toHaveBeenCalledOnce()
 })
 it('reports rejection once and enforces resampled PCM budget', async () => {
  const mock = mockContext(() => Promise.reject(new Error('NotAllowed'))); const sound = new Soundscape(world, { createContext: () => mock.context, load }); await sound.enable()
  for (let i = 0; i < 20; i++) sound.update(frame)
  expect(mock.ctx.resume).toHaveBeenCalledOnce(); expect(sound.getSnapshot().status).toBe('retry')
  const second = mockContext(), limited = new Soundscape(world, { createContext: () => second.context, load, pcmBudget: 100 }); await limited.enable(); expect(limited.getSnapshot().status).toBe('retry'); expect(second.ctx.createBufferSource).not.toHaveBeenCalled()
 })
 it('finishes loading after a pause/resume race and detects OS interruption without retry loops', async () => {
  const mock = mockContext(); mock.ctx.resume.mockImplementation(() => { mock.ctx.state = 'running'; return Promise.resolve() }); mock.ctx.suspend.mockImplementation(() => { mock.ctx.state = 'suspended'; return Promise.resolve() })
  let complete!: () => void
  const loader = vi.fn(() => new Promise<ArrayBuffer>(resolve => { complete = () => resolve(new ArrayBuffer(8)) }))
  const sound = new Soundscape(world, { createContext: () => mock.context, load: loader }); sound.update(frame); const pending = sound.enable()
  await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
  sound.update({ ...frame, active: false }); sound.update(frame)
  for (let i = 1; i <= 4; i++) { complete(); if (i < 4) await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(i + 1)) }
  await pending; await vi.waitFor(() => expect(sound.getSnapshot().status).toBe('playing'))
  expect(mock.ctx.resume).toHaveBeenCalledTimes(2)
  mock.ctx.state = 'interrupted'; sound.update(frame)
  expect(sound.getSnapshot().status).toBe('retry')
  for (let i = 0; i < 20; i++) sound.update(frame)
  expect(mock.ctx.resume).toHaveBeenCalledTimes(2)
  await sound.enable(); expect(sound.getSnapshot().status).toBe('playing'); sound.dispose()
 })
 it('keeps late resume silent when narration takes focus', async () => {
  const mock = mockContext(), sound = new Soundscape(world, { createContext: () => mock.context, load }); sound.update(frame); await sound.enable()
  sound.update({ ...frame, active: false })
  let resume!: () => void; mock.ctx.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve }))
  sound.update(frame); sound.update({ ...frame, narrationActive: true }); resume(); await Promise.resolve()
  expect(mock.gains[0]!.setValueAtTime).toHaveBeenLastCalledWith(0, 0)
  expect(sound.getSnapshot().status).toBe('suspended'); sound.dispose()
 })
 it('zeros master immediately on background, narration and mute; twenty cycles remain bounded', async () => {
  const mock = mockContext(), sound = new Soundscape(world, { createContext: () => mock.context, load }); sound.update(frame)
  for (let i = 0; i < 20; i++) { await sound.enable(); expect(sound.getSnapshot().sourceCount).toBe(4); sound.update({ ...frame, active: false }); expect(mock.gains[0]!.setValueAtTime).toHaveBeenLastCalledWith(0, 0); sound.disable(); sound.update(frame) }
  expect(sound.getSnapshot()).toMatchObject({ sourceCount: 0, decodedBytes: 0, contextCount: 1 }); sound.dispose()
 })
})
describe('real-world spatial mix', () => {
 it('uses resolved rain and attenuates shore by height across twelve weather/camera mixes', () => {
  for (const rain of [0, .1, .5, 1]) {
   const mixes = [1.6, 120, 210].map(y => soundscapeMix(world, { ...frame, camera: { ...frame.camera, y }, rain }))
   expect(mixes[0]!.surf).toBeGreaterThan(mixes[1]!.surf); expect(mixes[1]!.surf).toBeGreaterThan(mixes[2]!.surf)
   for (const mix of mixes) expect(mix.rain).toBeCloseTo(.42 * rain)
  }
  expect(soundscapeMix(world, { ...frame, camera: { ...frame.camera, y: 1400 } }).surf).toBeLessThan(.00001)
 })
 it('samples finite actual river and excludes ocean side', () => {
  const river = world.river.station(world.river.length * .5)
  expect(soundscapeMix(world, { ...frame, camera: { x: river.x, y: river.waterLevel + 2, z: river.z } }).river).toBeGreaterThan(0)
  expect(soundscapeMix(world, { ...frame, camera: { x: world.shorelineAt(420) - 50, y: 2, z: 420 } }).river).toBe(0)
 })
})
