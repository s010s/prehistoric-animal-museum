import { readFile } from 'node:fs/promises'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture, TextureLoader } from 'three'
import { TerrainStream } from '../../src/flight-experience/terrain-stream'
import { generateTerrain, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
import { FlightRuntime } from '../../src/flight-experience/FlightRuntime'
import type { StagedViewerModel, ViewerController, ViewerModelDescriptor } from '../../src/viewer/ViewerController'
import { disposeObject3D } from '../../src/viewer/dispose'
import { chunkKey } from '../../src/flight-experience/world'
// Host fixture presents a completed frame after each update. This models the
// renderer callback contract; these tests still do not assert real GPU pixels.
function hostFrame(runtime:FlightRuntime,delta:number){runtime.update(delta);runtime.completedFrame(document.createElement('canvas'))}
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  jobs: TerrainJob[] = []
  constructor() { TestWorker.instances.push(this) }
  postMessage(job: TerrainJob) { this.jobs.push(job) }
  terminate() {}
  finish() { const job = this.jobs.shift(); if (job) this.onmessage?.({ data: generateTerrain(job) }) }
}
beforeEach(() => {
  TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker)
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: () => {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('bounded terrain lifecycle', () => {
  it('places delayed terrain at the latest origin and cannot install it after disposal', () => {
    const stream = new TerrainStream(() => {}, () => {})
    stream.plan(0, 0, 0); stream.update(1 / 60, true)
    const worker = TestWorker.instances[0]!, job = worker.jobs[0]!
    stream.relocate({ x: 2048, z: 0 }); stream.relocate({ x: 4096, z: -2048 })
    worker.finish()
    for (let i = 0; i < 100; i++) stream.update(1 / 60, true)
    const resident = stream.resident.get(chunkKey(job.chunk))!
    expect(resident.mesh.position.x).toBe(job.chunk.x * 512 - 4096)
    expect(resident.mesh.position.z).toBe(job.chunk.z * 512 + 2048)
    stream.dispose(); worker.finish(); expect(stream.resident.size).toBe(0)
  })
})
describe('flight owned resources and recovery', () => {
  function host() {
    let resolve: ((value: StagedViewerModel) => void) | null = null
    const dispose = vi.fn((model: StagedViewerModel) => { disposeObject3D(model.group); model.disposed = true })
    const controller = {
      acquireExternalExperience: (runtime: FlightRuntime) => ({ invalidate: vi.fn(), release: () => runtime.dispose() }),
      stageModel: () => new Promise<StagedViewerModel>(r => { resolve = r }), disposeStagedModel: dispose,
    } as unknown as ViewerController
    return { controller, resolve: (model: StagedViewerModel) => resolve?.(model) }
  }
  function model(): StagedViewerModel {
    const root = new Group(), group = new Group(); group.add(root)
    root.add(new Mesh(new BoxGeometry(7, 1, 2), new MeshBasicMaterial()))
    return { group, modelRoot: root, disposed: false, mixer: null, action: null } as unknown as StagedViewerModel
  }
  it.each(['model', 'materials'])('keeps cold %s preparation active while visible and blocks travel until assembly', async (stage) => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    let releaseTextures: (() => void) | undefined
    if (stage === 'materials') {
      const gate = new Promise<void>(resolve => { releaseTextures = resolve })
      vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => { await gate; return new Texture() })
    }
    const pending = runtime.prepare({} as ViewerModelDescriptor)
    if (stage === 'materials') { h.resolve(model()); await Promise.resolve() }
    // Real runtime and terrain preparation; no canResume/phase stubs.
    runtime.contextLost(); runtime.setVisibilityState(false); runtime.setFocusState(false)
    runtime.contextRestored(); runtime.contextRestored()
    expect(runtime.canResume).toBe(false)
    runtime.setVisibilityState(true)
    runtime.setFocusState(true)
    for (let i = 0; i < 180; i++) { hostFrame(runtime,1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    expect(runtime.canResume).toBe(false)
    runtime.start(); expect(runtime.getSnapshot().phase).not.toBe('flying')
    if (stage === 'model') h.resolve(model()); else releaseTextures?.()
    await pending
    for (let i = 0; i < 600 && !runtime.canResume; i++) { hostFrame(runtime,1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    expect(runtime.getSnapshot().phase).toBe('ready'); expect(runtime.canResume).toBe(true)
    expect(runtime.simulation.time).toBe(0); expect(runtime.environmentClock.motionSeconds).toBe(0)
    runtime.close()
  }, 20_000)
  it('presents camera arcs while paused without advancing the animal, sunlight or weather', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false)
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(model());await pending
    for(let i=0;i<600&&!runtime.canResume;i++){hostFrame(runtime,1/60);TestWorker.instances.forEach(w=>w.finish())}
    runtime.setSolarMode('auto');runtime.setWeatherMode('auto')
    const clock=runtime.environmentClock.motionSeconds,weather=runtime.weather.serialize()
    const position={...runtime.simulation.position},originalCamera=runtime.camera.position.clone()
    runtime.selectPerspective('front')
    for(let i=0;i<180;i++)hostFrame(runtime,1/60)
    expect(runtime.camera.position.distanceTo(originalCamera)).toBeGreaterThan(10)
    expect(runtime.simulation.position).toEqual(position);expect(runtime.simulation.time).toBe(0)
    expect(runtime.environmentClock.motionSeconds).toBe(clock);expect(runtime.weather.serialize()).toEqual(weather)
    runtime.close()
  },20_000)
  it('freezes simulation and sunlight through pause and context recovery', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false), owned = model()
    try {
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(owned); await pending
    for (let i = 0; i < 600 && !runtime.canResume; i++) { hostFrame(runtime,1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    expect(runtime.getSnapshot().phase).toBe('ready')
    runtime.start(); hostFrame(runtime,1 / 60); runtime.pause('hidden')
    const time = runtime.simulation.time, pos = { ...runtime.simulation.position }, motion = runtime.environmentClock.motionSeconds
    hostFrame(runtime,60)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    expect(runtime.simulation.time).toBe(time); expect(runtime.simulation.position).toEqual(pos)
    runtime.contextLost(); expect(runtime.getSnapshot().phase).toBe('recovering')
    runtime.contextRestored(); expect(runtime.getSnapshot().phase).toBe('paused')
    hostFrame(runtime,60); expect(runtime.environmentClock.motionSeconds).toBe(motion)
    runtime.close()
    } finally { runtime.close() }
  }, 12_000)
  it('installs delayed terrain after hidden and context recovery without moving the animal', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    for (let i = 0; i < 600 && !runtime.canResume; i++) { hostFrame(runtime,1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    runtime.start()
    for (const resident of runtime.terrain.resident.values()) { resident.mesh.removeFromParent(); resident.mesh.geometry.dispose() }
    runtime.terrain.resident.clear()
    runtime.pause('terrain')
    hostFrame(runtime,1 / 60)
    expect(runtime.getSnapshot().phase).toBe('buffering')
    const position = { ...runtime.simulation.position }, time = runtime.simulation.time
    runtime.setVisibilityState(false); runtime.setFocusState(false); runtime.contextLost()
    // Actual generator results can arrive while presentation is unavailable.
    TestWorker.instances.forEach(w => w.finish()); hostFrame(runtime,60)
    runtime.setVisibilityState(true); runtime.contextRestored()
    runtime.setFocusState(true)
    // Fixed coastal/river coverage is denser; preserve the shared per-frame budget.
    for (let i = 0; i < 600 && !runtime.canResume; i++) { TestWorker.instances.forEach(w => w.finish()); hostFrame(runtime,1 / 60) }
    expect(runtime.getSnapshot().phase).toBe('paused'); expect(runtime.canResume).toBe(true)
    expect(runtime.simulation.position).toEqual(position); expect(runtime.simulation.time).toBe(time)
    runtime.close()
  }, 12_000)
  it('keeps live sunlight and flight adjustments moving without relocating or resetting clocks', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false)
    try {
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(model());await pending
    for(let i=0;i<600&&!runtime.canResume;i++){hostFrame(runtime,1/60);TestWorker.instances.forEach(w=>w.finish())}
    runtime.start();hostFrame(runtime,1/60)
    const position={...runtime.simulation.position},time=runtime.simulation.time,motion=runtime.environmentClock.motionSeconds
    runtime.setSolarDayProgress(.94)
    runtime.configure({...runtime.getSnapshot().settings,speed:18,view:'wide',gentle:true})
    expect(runtime.getSnapshot().phase).toBe('flying')
    expect(runtime.simulation.position).toEqual(position);expect(runtime.simulation.time).toBe(time)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    hostFrame(runtime,1/60)
    expect(runtime.simulation.time).toBeGreaterThan(time);expect(runtime.environmentClock.motionSeconds).toBeGreaterThan(motion)
    runtime.pause('user');runtime.setSolarDayProgress(.3)
    expect(runtime.getSnapshot().phase).toBe('paused')
    } finally { runtime.close() }
  }, 12_000)
  it('keeps real travel state frozen while switching viewpoints', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false),owned=model()
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(owned);await pending
    for(let i=0;i<600&&!runtime.canResume;i++){hostFrame(runtime,1/60);TestWorker.instances.forEach(w=>w.finish())}
    runtime.start();hostFrame(runtime,1/60);runtime.pause('user')
    const position={...runtime.simulation.position},time=runtime.simulation.time,heading=runtime.simulation.heading
    runtime.enterViewpoint('seaward');runtime.enterViewpoint('cliff');runtime.enterViewpoint('seaward')
    runtime.setSolarDayProgress(.94)
    for(let i=0;i<25;i++){hostFrame(runtime,1/60);TestWorker.instances.forEach(w=>w.finish())}
    expect(runtime.simulation.position).toEqual(position);expect(runtime.simulation.time).toBe(time);expect(runtime.simulation.heading).toBe(heading)
    expect(runtime.root.visible).toBe(false);expect(runtime.canResume).toBe(false)
    runtime.start();expect(runtime.getSnapshot().phase).toBe('paused')
    runtime.close()
  }, 12_000)
  it('recovers entry and return preparation after hidden/context overlap without reviving scenery', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    // Integer fixture clock keeps the exact 15,000 ms boundary independent of floating subtraction.
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    for (const direction of ['entry', 'return']) {
      runtime.enterViewpoint('seaward')
      if (direction === 'return') runtime.returnFromViewpoint()
      now += 5000
      runtime.setVisibilityState(false); runtime.setFocusState(false)
      now += 60000
      const motion = runtime.environmentClock.motionSeconds
      runtime.contextLost(); runtime.contextRestored(); hostFrame(runtime,60)
      runtime.setVisibilityState(true)
      runtime.setFocusState(true)
      hostFrame(runtime,0)
      expect(runtime.environmentClock.motionSeconds).toBe(motion)
      expect(runtime.getSnapshot().phase).not.toBe('flying')
      expect(runtime.observation.checkTimeout(now + 14999)).toBe(false)
      expect(runtime.observation.checkTimeout(now + 15000)).toBe(true)
    }
    runtime.close()
  })
  it('stops an active observation after fatal failure and rejects late recovery callbacks', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    runtime.enterViewpoint('seaward'); runtime.observation.complete(runtime.observation.generation)
    const motion = runtime.environmentClock.motionSeconds, token = runtime.observation.generation
    vi.spyOn(console, 'error').mockImplementation(() => {})
    runtime.fail(new Error('injected render failure'))
    runtime.contextLost(); runtime.contextRestored(); runtime.setVisibilityState(true); runtime.setFocusState(true)
    hostFrame(runtime,60); runtime.fail(new Error('late repeated failure'))

    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    expect(runtime.observation.complete(token)).toBe(false)
    expect(runtime.canReturnToTravel).toBe(true)
    runtime.returnFromViewpoint()
    expect(runtime.getSnapshot().phase).toBe('paused')
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    runtime.close()
  })
  it('keeps travel state and fixed camera positions through twenty actual Runtime observation roundtrips', async () => {
    // Parse the shipping ecology geometry; only browser image decoding is stubbed.
    const bytes = await readFile('src/flight-experience/assets/ecology-r5/ecology-r5.glb')
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new Texture()); return {name:'test-image-decoder'} })
      const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
      return loader.parseAsync(buffer, '')
    })
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    const prepareUntil = async (phase: string) => {
      for (let frame = 0; frame < 1200 && runtime.observation.phase !== phase; frame++) {
        TestWorker.instances.forEach(worker => worker.finish()); hostFrame(runtime,1/60)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      expect(runtime.observation.phase).toBe(phase)
    }
    const position = {...runtime.simulation.position}, time = runtime.simulation.time
    runtime.setSolarMode('auto')
    for (let trip = 0; trip < 20; trip++) {
      runtime.enterViewpoint((['seaward','cliff','waterline'] as const)[trip%3]!)
      await prepareUntil('active')
      runtime.toggleScenery()
      const fixed=runtime.camera.position.clone()
      runtime.orbitCamera(.3,.1);for(let i=0;i<30;i++)hostFrame(runtime,1/60)
      expect(runtime.camera.position.distanceTo(fixed)).toBeLessThan(.01)
      const progress = runtime.environmentClock.solarDayProgress
      runtime.returnFromViewpoint(); await prepareUntil('inactive')
      expect(runtime.environmentClock.solarDayProgress).toBe(progress)
      expect(runtime.environmentClock.solarMode).toBe('auto')
      expect(runtime.getSnapshot().phase).toBe('paused')
      expect(runtime.simulation.position).toEqual(position); expect(runtime.simulation.time).toBe(time)
      expect(runtime.root.visible).toBe(true)
    }
    runtime.close()
  }, 120_000)
})
