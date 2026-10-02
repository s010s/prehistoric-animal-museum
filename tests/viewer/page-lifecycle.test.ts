import { describe, expect, it, vi } from 'vitest'
import { ViewerPageLifecycle } from '../../src/viewer/page-lifecycle'
import { ViewerController } from '../../src/viewer/ViewerController'
import { ViewerController as ProductionViewerController } from '../../src/viewer/ViewerController.production'

// Failure cases to cover before implementing this isolated lifecycle fix:
// hidden initial mount; duplicate visibility events; hidden RAF already queued;
// multiple long pauses; animation/transition time jumping on return; a start
// request while hidden or context-lost; stale deferred stop after a resume;
// destruction while hidden or visible; listener leaks after remount.
// All renderers below are CPU stubs. No WebGL context or browser is launched.
class PageVisibility extends EventTarget {
  hidden = false
  change(hidden: boolean) {
    this.hidden = hidden
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

function lifecycle(initiallyHidden = false) {
  const page = new PageVisibility()
  page.hidden = initiallyHidden
  let wallTime = 100
  const pause = vi.fn(), resume = vi.fn()
  const state = new ViewerPageLifecycle(page, { pause, resume }, () => wallTime)
  return { page, state, pause, resume, advance: (ms: number) => { wallTime += ms } }
}

describe('viewer page lifecycle', () => {
  it('stops once when hidden and resumes once when visible', () => {
    const h = lifecycle()
    h.page.change(true); h.page.change(true)
    expect(h.pause).toHaveBeenCalledTimes(1)
    expect(h.state.paused).toBe(true)
    h.page.change(false); h.page.change(false)
    expect(h.resume).toHaveBeenCalledTimes(1)
    expect(h.state.paused).toBe(false)
    h.state.dispose()
  })

  it('excludes multiple long pauses from model, transition and wave timestamps', () => {
    const h = lifecycle()
    h.advance(20)
    h.page.change(true)
    h.advance(600_000)
    expect(h.state.now()).toBe(120)
    expect(h.state.now(600_120)).toBe(120)
    h.page.change(false)
    expect(h.state.now()).toBe(120)
    h.advance(16)
    expect(h.state.now(600_136)).toBe(136)
    h.page.change(true); h.advance(30_000); h.page.change(false)
    expect(h.state.now()).toBe(136)
    h.advance(16)
    expect(h.state.now()).toBe(152)
    h.state.dispose()
  })

  it('keeps a hidden initial mount frozen until its first visible frame', () => {
    const h = lifecycle(true)
    h.advance(60_000)
    expect(h.state.paused).toBe(true)
    expect(h.state.now()).toBe(100)
    h.page.change(false)
    expect(h.resume).toHaveBeenCalledTimes(1)
    expect(h.state.now()).toBe(100)
    h.state.dispose()
  })

  it('removes the listener and never resumes after disposal', () => {
    const h = lifecycle()
    const remove = vi.spyOn(h.page, 'removeEventListener')
    h.state.dispose(); h.state.dispose()
    h.page.change(true); h.page.change(false)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(h.pause).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
    expect(h.state.paused).toBe(true)
  })
})

type Frame = (time: number) => void
type ControllerInternals = {
  startLoop(): void
  stopLoop(): void
  renderMainScene(): void
  destroy(): void
  contextAvailable: boolean
  loopRunning: boolean
  lastFrameTime: number
}

function controllerHarness(Controller: typeof ViewerController | typeof ProductionViewerController) {
  const page = new PageVisibility()
  let wallTime = 100, frame: Frame | null = null
  const controller = Object.create(Controller.prototype) as ControllerInternals
  const mixerUpdate = vi.fn(), render = vi.fn(), textureUpdate = vi.fn()
  const canvas = document.createElement('canvas')
  const setAnimationLoop = vi.fn((callback: Frame | null) => { frame = callback })
  const pageLifecycle = new ViewerPageLifecycle(page, {
    pause: () => controller.stopLoop(), resume: () => controller.startLoop(),
  }, () => wallTime)
  Object.assign(controller, {
    pageLifecycle, destroyed: false, contextAvailable: true, loopRunning: false,
    lastFrameTime: 0, initialPoseHoldUntil: 0, reviewAnimationTime: null,
    current: { mixer: { update: mixerUpdate }, action: {} }, transition: null,
    scaleEncounter: null, externalExperience: null,
    renderer: { setAnimationLoop, domElement: canvas, render,
      dispose: vi.fn(), forceContextLoss: vi.fn() },
    controls: { update: vi.fn(), dispose: vi.fn(), removeEventListener: vi.fn() },
    resizeObserver: { disconnect: vi.fn() },
    reducedMotionQuery: { removeEventListener: vi.fn() },
    updateAutoRotation: vi.fn(), updateTransition: vi.fn(), updateCameraLighting: vi.fn(),
    publishScaleEncounterPerformanceDiagnostics: vi.fn(),
    endScaleEncounter: vi.fn(), clearTransitionOpacity: vi.fn(), scaleEncounterListeners: new Set(),
    camera: { position: { x: 1, y: 2, z: 3 } },
  })
  return { controller, page, pageLifecycle, mixerUpdate, render, textureUpdate, setAnimationLoop,
    advance: (ms: number) => { wallTime += ms },
    tick: () => { frame?.(wallTime) },
    queuedFrame: () => frame!,
  }
}

describe.each([
  ['comparison/review', ViewerController],
  ['production exhibit', ProductionViewerController],
] as const)('%s loop integration without WebGL', (_name, Controller) => {
  it('rejects start requests while hidden or while the context is lost', () => {
    const h = controllerHarness(Controller)
    h.page.change(true); h.setAnimationLoop.mockClear()
    h.controller.startLoop()
    expect(h.setAnimationLoop).not.toHaveBeenCalled()
    Object.assign(h.controller, {
      scaleEncounter: { environment: { renderScene: h.textureUpdate } },
    })
    h.controller.renderMainScene()
    expect(h.render).not.toHaveBeenCalled()
    expect(h.textureUpdate).not.toHaveBeenCalled()
    h.controller.contextAvailable = false
    h.page.change(false)
    expect(h.setAnimationLoop).not.toHaveBeenCalled()
    h.pageLifecycle.dispose()
  })

  it('skips an already queued hidden frame and stops after Three stores the next RAF', async () => {
    const h = controllerHarness(Controller)
    h.controller.startLoop()
    const queued = h.queuedFrame()
    h.page.change(true); h.setAnimationLoop.mockClear()
    queued(100_000)
    expect(h.mixerUpdate).not.toHaveBeenCalled()
    expect(h.render).not.toHaveBeenCalled()
    expect(h.textureUpdate).not.toHaveBeenCalled()
    expect(h.setAnimationLoop).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(h.setAnimationLoop).toHaveBeenCalledWith(null)
    h.pageLifecycle.dispose()
  })

  it('preserves state and restarts with one normal delta after a long pause', () => {
    const h = controllerHarness(Controller)
    h.controller.startLoop(); h.advance(16); h.tick()
    expect(h.mixerUpdate).toHaveBeenLastCalledWith(.016)
    h.page.change(true); h.advance(600_000); h.page.change(false)
    expect(h.controller.lastFrameTime).toBe(116)
    h.advance(16); h.tick()
    expect(h.mixerUpdate).toHaveBeenLastCalledWith(.016)
    h.pageLifecycle.dispose()
  })

  it('does not let a stale deferred stop cancel a newly visible loop', async () => {
    const h = controllerHarness(Controller)
    h.controller.startLoop()
    const queued = h.queuedFrame()
    h.page.change(true); queued(100)
    h.page.change(false); h.setAnimationLoop.mockClear()
    await Promise.resolve()
    expect(h.setAnimationLoop).not.toHaveBeenCalled()
    expect(h.controller.loopRunning).toBe(true)
    h.pageLifecycle.dispose()
  })

  it.each([false, true])('cannot restart after destroy (hidden=%s)', (hidden) => {
    const h = controllerHarness(Controller)
    h.controller.startLoop()
    if (hidden) h.page.change(true)
    Object.assign(h.controller, { current: null })
    h.controller.destroy()
    h.setAnimationLoop.mockClear()
    h.page.change(false); h.page.change(true); h.page.change(false)
    h.controller.startLoop()
    expect(h.setAnimationLoop).not.toHaveBeenCalled()
    expect(h.pageLifecycle.paused).toBe(true)
  })
})
