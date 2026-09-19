import { Color, Vector4, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

/** Renderer belongs to the viewer. The experience owns only its scene resources. */
export interface ExternalExperience {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly running: boolean
  readonly pixelRatio: number
  readonly shadowsEnabled?: boolean
  readonly frameId?: number
  completedFrame?(canvas: HTMLCanvasElement): void
  recordGpu?(milliseconds: number, frameId?: number): void
  recordRender?(data: { cpuMs: number; calls: number; triangles: number; geometries: number; textures: number }): void
  setFramebufferHeight?(height: number): void
  update(deltaSeconds: number): void
  resize(width: number, height: number): void
  contextLost(): void
  contextRestored(): void
  fail(error: unknown): void
  dispose(): void
}
export interface ExperienceLease {
  invalidate(): void
  release(): void
}

/** Snapshot every renderer global that an experience may touch. Size follows the latest viewport. */
export function rendererStateLease(renderer: WebGLRenderer): () => void {
  const state = {
    pixelRatio: renderer.getPixelRatio(), viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()), scissorTest: renderer.getScissorTest(),
    target: renderer.getRenderTarget(), clear: renderer.getClearColor(new Color()),
    alpha: renderer.getClearAlpha(), toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
    shadows: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type,
    shadowAutoUpdate: renderer.shadowMap.autoUpdate, shadowNeedsUpdate: renderer.shadowMap.needsUpdate, autoClear: renderer.autoClear,
  }
  let released = false
  return () => {
    if (released) return
    released = true
    renderer.setPixelRatio(state.pixelRatio)
    renderer.setRenderTarget(state.target)
    renderer.setViewport(state.viewport)
    renderer.setScissor(state.scissor)
    renderer.setScissorTest(state.scissorTest)
    renderer.setClearColor(state.clear, state.alpha)
    renderer.toneMapping = state.toneMapping
    renderer.toneMappingExposure = state.exposure
    renderer.outputColorSpace = state.colorSpace
    renderer.shadowMap.enabled = state.shadows
    renderer.shadowMap.type = state.shadowType
    renderer.shadowMap.autoUpdate = state.shadowAutoUpdate
    renderer.shadowMap.needsUpdate = state.shadowNeedsUpdate
    renderer.autoClear = state.autoClear
  }
}
