import { CAPTURE_ANCHORS } from '../../src/flight-experience/review-anchors'
import { readFile } from 'node:fs/promises'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, NormalAnimationBlendMode, Texture, TextureLoader } from 'three'
import { TerrainStream } from '../../src/flight-experience/terrain-stream'
import { generateTerrain, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
import { FlightRuntime } from '../../src/flight-experience/FlightRuntime'
import type { StagedViewerModel, ViewerController, ViewerModelDescriptor } from '../../src/viewer/ViewerController'
import { disposeObject3D } from '../../src/viewer/dispose'
import { chunkKey } from '../../src/flight-experience/world'
import glide from '../../src/flight-experience/assets/pteranodon-glide.json'
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: () => {},
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('bounded terrain lifecycle', () => {
  it('installs a delayed result at the latest origin and rejects obsolete demands', () => {
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
  it('retries one failed Worker then uses a finite 5x5 fallback', () => {
    const failed = vi.fn(), stream = new TerrainStream(() => {}, failed)
    TestWorker.instances[0]!.onerror?.(); TestWorker.instances[1]!.onerror?.()
    expect(stream.simplified).toBe(true); expect(failed).toHaveBeenCalledTimes(1)
    stream.plan(0, 0, 0)
    for (let i = 0; i < 500; i++) stream.update(1 / 60, true)
    expect(stream.resident.size).toBe(25); expect(stream.ready).toBe(true)
    stream.plan(1e6, 1e6, 0); stream.update(1 / 60, true)
    expect(stream.safeToEnter(1e6, 1e6)).toBe(false)
    stream.dispose()
  })
  it('does not advance terrain transitions or enqueue jobs while paused', () => {
    const stream = new TerrainStream(() => {}, () => {})
    stream.plan(0, 0, 0); stream.update(1 / 60, true)
    const before = stream.diagnostics()
    for (let i = 0; i < 100; i++) stream.update(0, false)
    expect(stream.diagnostics()).toEqual(before); stream.dispose()
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
    return { controller, dispose, resolve: (model: StagedViewerModel) => resolve?.(model) }
  }
  function model(): StagedViewerModel {
    const root = new Group(), group = new Group(); group.add(root)
    root.add(new Mesh(new BoxGeometry(7, 1, 2), new MeshBasicMaterial()))
    return { group, modelRoot: root, disposed: false, mixer: null, action: null } as unknown as StagedViewerModel
  }
  it('disposes a model that finishes after its session closes', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor)
    runtime.close(); const late = model(); h.resolve(late); await pending
    expect(h.dispose).toHaveBeenCalledWith(late); expect(late.disposed).toBe(true)
  })
  it('freezes simulation on pause and returns only flight-owned resources', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false), owned = model()
    const spy = vi.spyOn((owned.modelRoot.children[0] as Mesh).geometry, 'dispose')
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(owned); await pending
    for (let i = 0; i < 180; i++) { runtime.update(1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    expect(runtime.getSnapshot().phase).toBe('ready')
    runtime.start(); runtime.update(1 / 60); runtime.pause('hidden')
    const time = runtime.simulation.time, pos = { ...runtime.simulation.position }, motion = runtime.environmentClock.motionSeconds
    runtime.update(60)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    expect(runtime.simulation.time).toBe(time); expect(runtime.simulation.position).toEqual(pos)
    expect(runtime.running).toBe(false)
    runtime.contextLost(); expect(runtime.getSnapshot().phase).toBe('recovering')
    runtime.reviewIsolation.animateWater = true
    runtime.contextRestored(); expect(runtime.getSnapshot().phase).toBe('paused')
    runtime.update(60); expect(runtime.environmentClock.motionSeconds).toBe(motion)
    runtime.close(); runtime.close(); expect(spy).toHaveBeenCalledTimes(1)
  })
  it('installs delayed terrain while buffering without moving, and never bypasses a safety guard', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    for (let i = 0; i < 180; i++) { runtime.update(1 / 60); TestWorker.instances.forEach(w => w.finish()) }
    runtime.start()
    for (const resident of runtime.terrain.resident.values()) { resident.mesh.removeFromParent(); resident.mesh.geometry.dispose() }
    runtime.terrain.resident.clear()
    runtime.pause('terrain')
    runtime.update(1 / 60)
    expect(runtime.getSnapshot().phase).toBe('buffering')
    const position = { ...runtime.simulation.position }, time = runtime.simulation.time
    runtime.setVisibilityState(false); runtime.setFocusState(false); runtime.contextLost()
    // Actual generator results can arrive while presentation is unavailable.
    TestWorker.instances.forEach(w => w.finish()); runtime.update(60)
    expect(runtime.running).toBe(false)
    runtime.setVisibilityState(true); runtime.contextRestored(); expect(runtime.running).toBe(false)
    runtime.setFocusState(true); expect(runtime.running).toBe(true)
    // Fixed coastal/river coverage is denser; preserve the shared per-frame budget.
    for (let i = 0; i < 600 && !runtime.canResume; i++) { TestWorker.instances.forEach(w => w.finish()); runtime.update(1 / 60) }
    expect(runtime.getSnapshot().phase).toBe('paused'); expect(runtime.canResume).toBe(true)
    expect(runtime.simulation.position).toEqual(position); expect(runtime.simulation.time).toBe(time)
    runtime.simulation.safetyStop = true; runtime.start()
    expect(runtime.getSnapshot().phase).toBe('paused'); expect(runtime.simulation.safetyStop).toBe(true)
    runtime.close()
  }, 12_000) // Real generator recovery: CI measured 6.47s; retain every safety assertion.
  it('keeps live sunlight and flight adjustments moving without relocating or resetting clocks', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false)
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(model());await pending
    for(let i=0;i<180;i++){runtime.update(1/60);TestWorker.instances.forEach(w=>w.finish())}
    runtime.start();runtime.update(1/60)
    const position={...runtime.simulation.position},time=runtime.simulation.time,motion=runtime.environmentClock.motionSeconds
    runtime.setSolarDayProgress(.94)
    runtime.configure({...runtime.getSnapshot().settings,speed:18,view:'wide',gentle:true})
    expect(runtime.getSnapshot().phase).toBe('flying')
    expect(runtime.simulation.position).toEqual(position);expect(runtime.simulation.time).toBe(time)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    expect(runtime.getSnapshot().solarDayProgress).toBe(.94)
    runtime.update(1/60)
    expect(runtime.simulation.time).toBeGreaterThan(time);expect(runtime.environmentClock.motionSeconds).toBeGreaterThan(motion)
    runtime.pause('user');runtime.setSolarDayProgress(.3)
    expect(runtime.getSnapshot().phase).toBe('paused')
    runtime.close()
  })
  it('keeps real travel state frozen through a viewpoint request and cancellation', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false),owned=model()
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(owned);await pending
    for(let i=0;i<180;i++){runtime.update(1/60);TestWorker.instances.forEach(w=>w.finish())}
    runtime.start();runtime.update(1/60);runtime.pause('user')
    const position={...runtime.simulation.position},time=runtime.simulation.time,heading=runtime.simulation.heading
    runtime.enterViewpoint('seaward');runtime.enterViewpoint('cliff');runtime.enterViewpoint('seaward')
    runtime.setSolarDayProgress(.94)
    for(let i=0;i<25;i++){runtime.update(1/60);TestWorker.instances.forEach(w=>w.finish())}
    expect(runtime.simulation.position).toEqual(position);expect(runtime.simulation.time).toBe(time);expect(runtime.simulation.heading).toBe(heading)
    expect(runtime.root.visible).toBe(false);expect(runtime.canResume).toBe(false)
    runtime.start();expect(runtime.getSnapshot().phase).toBe('paused')
    runtime.returnFromViewpoint()
    expect(runtime.observation.phase).toBe('returning');expect(runtime.observation.target).toBeNull()
    expect(runtime.environmentClock.solarDayProgress).toBe(.94)
    runtime.close();expect(runtime.observation.bookmark).toBeNull()
  })
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
      const frame = runtime.frameId, motion = runtime.environmentClock.motionSeconds
      runtime.contextLost(); runtime.contextRestored(); runtime.update(60)
      expect(runtime.running).toBe(false); expect(runtime.frameId).toBe(frame)
      runtime.setVisibilityState(true); expect(runtime.running).toBe(false)
      runtime.setFocusState(true); expect(runtime.running).toBe(true)
      runtime.update(0)
      expect(runtime.frameId).toBe(frame + 1)
      expect(runtime.environmentClock.motionSeconds).toBe(motion)
      expect(runtime.observation.sceneryPaused).toBe(true)
      expect(runtime.getSnapshot().phase).not.toBe('flying')
      expect(runtime.observation.checkTimeout(now + 14999)).toBe(false)
      expect(runtime.observation.checkTimeout(now + 15000)).toBe(true)
    }
    runtime.close(); runtime.setFocusState(true); expect(runtime.running).toBe(false)
  })
  it('stops an active observation after fatal failure and rejects late recovery callbacks', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    runtime.enterViewpoint('seaward'); runtime.observation.complete(runtime.observation.generation)
    expect(runtime.running).toBe(true)
    const motion = runtime.environmentClock.motionSeconds, token = runtime.observation.generation
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    runtime.fail(new Error('injected render failure'))
    runtime.contextLost(); runtime.contextRestored(); runtime.setVisibilityState(true); runtime.setFocusState(true)
    runtime.update(60); runtime.fail(new Error('late repeated failure'))
    expect(runtime.running).toBe(false); expect(error).toHaveBeenCalledTimes(1)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    expect(runtime.observation.complete(token)).toBe(false)
    expect(runtime.observation.bookmark).not.toBeNull()
    expect(runtime.getSnapshot().reason).toBe('error')
    expect(runtime.canReturnToTravel).toBe(true)
    runtime.returnFromViewpoint()
    expect(runtime.observation.phase).toBe('returning')
    expect(runtime.running).toBe(true)
    expect(runtime.getSnapshot().phase).toBe('paused')
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    runtime.fail(new Error('explicit retry still fails'))
    expect(runtime.running).toBe(false); expect(error).toHaveBeenCalledTimes(2)
    runtime.close(); expect(h.dispose).toHaveBeenCalledTimes(1)
  })
  it('ticks one authoritative solar frame and limits progress notifications without resetting layout', async () => {
    const h = host(), runtime = new FlightRuntime(h.controller, false)
    const pending = runtime.prepare({} as ViewerModelDescriptor); h.resolve(model()); await pending
    runtime.enterViewpoint('seaward'); runtime.observation.complete(runtime.observation.generation)
    runtime.reviewIsolation.freezeWorld = true
    const layout = runtime.scenery.environment.solarLayout
    const position = {...runtime.simulation.position}, motion = runtime.environmentClock.motionSeconds, progress = runtime.environmentClock.solarDayProgress
    runtime.setSolarMode('auto')
    expect(runtime.environmentClock.solarDayProgress).toBe(progress)
    expect(runtime.environmentClock.motionSeconds).toBe(motion)
    const published = vi.fn(); runtime.subscribe(published)
    for (let frame = 0; frame < 60; frame++) runtime.update(1/60)
    expect(published.mock.calls.length).toBeLessThanOrEqual(4)
    expect(runtime.scenery.environment.solarDayProgress).toBe(runtime.environmentClock.solarDayProgress)
    expect(runtime.scenery.environment.frame.solarDayProgress).toBe(runtime.environmentClock.solarDayProgress)
    expect(runtime.scenery.environment.frame.motionSeconds).toBe(runtime.environmentClock.motionSeconds)
    expect(runtime.scenery.environment.solarLayout).toBe(layout)
    expect(runtime.simulation.position).toEqual(position)
    runtime.toggleScenery(); const frozen = runtime.environmentClock.solarDayProgress
    runtime.update(60); expect(runtime.environmentClock.solarDayProgress).toBe(frozen)
    expect(runtime.getSnapshot().daylight?.status).toBe('suspended')
    runtime.setSolarDayProgress(.94); runtime.setSolarMode('auto'); runtime.toggleScenery()
    const beforeEnd = runtime.environmentClock.motionSeconds; runtime.update(1/60)
    expect(runtime.getSnapshot().daylight?.status).toBe('ended')
    expect(runtime.environmentClock.motionSeconds).toBeGreaterThan(beforeEnd)
    runtime.restartDaylightFromMorning()
    expect(runtime.environmentClock.solarDayProgress).toBe(.08)
    expect(runtime.simulation.position).toEqual(position)
    runtime.returnFromViewpoint(); expect(runtime.getSnapshot().daylight?.status).toBe('suspended')
    expect(runtime.environmentClock.solarMode).toBe('auto')
    runtime.close()
  })
  it('publishes capture sunlight to the actual frame and freezes water independently', async () => {
    const h=host(),runtime=new FlightRuntime(h.controller,false)
    const pending=runtime.prepare({} as ViewerModelDescriptor);h.resolve(model());await pending
    runtime.reviewIsolation.freezeWorld=true
    for(const preset of ['evening','morning','afternoon'] as const){
      runtime.setSolarMode('auto')
      runtime.applyCaptureAnchor({...CAPTURE_ANCHORS[0]!,preset})
      runtime.update(0)
      expect(runtime.scenery.environment.frame.solarDayProgress).toBe(runtime.environmentClock.solarDayProgress)
      expect(runtime.environmentClock.solarMode).toBe('fixed')
    }
    runtime.enterViewpoint('seaward');runtime.observation.complete(runtime.observation.generation)
    runtime.scenery.review.freezeWater=true;runtime.setSolarMode('auto');runtime.setWeather('fair')
    const water=runtime.scenery.environment.waterMotionSeconds,solar=runtime.environmentClock.solarDayProgress
    runtime.update(1/60)
    expect(runtime.scenery.environment.waterMotionSeconds).toBe(water)
    expect(runtime.environmentClock.solarDayProgress).toBeGreaterThan(solar)
    expect(runtime.weather.snapshot().phase[0]).toBeGreaterThan(0)
    runtime.toggleScenery();const state=runtime.weather.serialize();runtime.update(60);expect(runtime.weather.serialize()).toEqual(state)
    runtime.close()
  })
  it('completes twenty actual Runtime observation roundtrips with bounded resources and unchanged travel', async () => {
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
        TestWorker.instances.forEach(worker => worker.finish()); runtime.update(1/60)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      expect(runtime.observation.phase, JSON.stringify({props:runtime.scenery.metrics,far:runtime.farTerrain.metrics,horizon:runtime.horizonTerrain.metrics,river:runtime.scenery.river.busy,environment:runtime.scenery.environment.busy})).toBe(phase)
    }
    const position = {...runtime.simulation.position}, time = runtime.simulation.time
    runtime.setSolarMode('auto')
    for (let trip = 0; trip < 20; trip++) {
      runtime.enterViewpoint((['seaward','cliff','waterline'] as const)[trip%3]!)
      await prepareUntil('active')
      runtime.update(1/60)
      const progress = runtime.environmentClock.solarDayProgress
      runtime.returnFromViewpoint(); await prepareUntil('inactive')
      expect(runtime.environmentClock.solarDayProgress).toBe(progress)
      expect(runtime.environmentClock.solarMode).toBe('auto')
      expect(runtime.getSnapshot().phase).toBe('paused')
      expect(runtime.simulation.position).toEqual(position); expect(runtime.simulation.time).toBe(time)
      expect(runtime.root.visible).toBe(true); expect(runtime.observation.bookmark).toBeNull()
      expect(runtime.scenery.metrics.failed, runtime.scenery.metrics.failureReason).toBe(false); expect(runtime.scenery.metrics.ready).toBe(true)
      expect(runtime.scenery.metrics.cells).toBeLessThanOrEqual(169)
      expect(runtime.scenery.metrics.bytes).toBeLessThan(120*1024*1024)
      expect(runtime.terrain.resident.size).toBeLessThanOrEqual(81)
      expect(runtime.terrain.diagnostics().readyBytes).toBeLessThanOrEqual(8*1024*1024)
      expect(runtime.scenery.environment.metrics.textureBytes).toBe(202800)
      expect(runtime.farTerrain.metrics.strips).toBeLessThanOrEqual(14)
    }
    runtime.close(); expect(h.dispose).toHaveBeenCalledOnce()
  }, 120_000)
  it('has a seamless non-static authored glide and no animated root translation', () => {
    const clip = AnimationClip.parse({ ...glide, blendMode: NormalAnimationBlendMode })
    expect(clip.duration).toBe(4)
    let movingTracks = 0
    for (const track of clip.tracks) {
      const stride = track.getValueSize(), first = [...track.values.slice(0, stride)], last = [...track.values.slice(-stride)]
      last.forEach((v, i) => expect(v).toBeCloseTo(first[i]!, 6))
      const moves = [...track.values].some((v, i) => Math.abs(v - first[i % stride]!) > 1e-6)
      if (moves) movingTracks++
      if (track.name.endsWith('.position')) expect(moves).toBe(false)
    }
    expect(movingTracks).toBe(4)
  })
})
