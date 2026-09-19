import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture, TextureLoader } from 'three'
import { TerrainStream } from '../../src/flight-experience/terrain-stream'
import { generateTerrain, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  jobs: TerrainJob[] = []
  terminated = false
  constructor() { TestWorker.instances.push(this) }
  postMessage(job: TerrainJob) { this.jobs.push(job) }
  terminate() { this.terminated = true }
  finish() { const job = this.jobs.shift(); if (job) this.onmessage?.({ data: generateTerrain(job) }) }
}
beforeEach(() => {
  TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker)
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
// Real generator integration stress: latest Ubuntu CI measured 30.038s (run 35427540301).
// Keep the full 19km route and every resource assertion; allowance is per-test only.
describe('terrain generator integration stress', () => {
  it('keeps queues/resources bounded over a long deterministic route and releases twice safely', () => {
    const stream = new TerrainStream(() => {}, () => {})
    for (let frame = 0; frame < 2400; frame++) {
      stream.plan(-160 + frame * 1.5, 350 - frame * 8, 0)
      stream.update(1 / 60, true)
      TestWorker.instances.forEach(w => w.finish())
      expect(stream.resident.size).toBeLessThanOrEqual(81)
      expect(stream.diagnostics().readyBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      expect(stream.diagnostics().pending).toBeLessThanOrEqual(1)
    }
    expect(stream.diagnostics().peakQueue).toBeLessThanOrEqual(24)
    const resources = [...stream.resident.values()].map(r => vi.spyOn(r.mesh.geometry, 'dispose'))
    stream.dispose(); stream.dispose()
    resources.forEach(spy => expect(spy).toHaveBeenCalledTimes(1))
    expect(stream.resident.size).toBe(0); expect(TestWorker.instances.every(w => w.terminated)).toBe(true)
  }, 45_000)
})
