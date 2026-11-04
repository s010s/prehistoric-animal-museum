import { IdlePreloadCoordinator } from '../../src/state/idle-preload-coordinator'
import { ModelCache } from '../../src/viewer/model-cache'

const targets = [
  {
    id: 'stegosaurus',
    imageUrls: ['/stegosaurus-background.webp'],
    modelUrl: '/stegosaurus.glb',
  },
  {
    id: 'triceratops',
    imageUrls: ['/triceratops-background.webp'],
    modelUrl: '/triceratops.glb',
  },
  {
    id: 'mammoth',
    imageUrls: ['/mammoth-background.webp'],
    modelUrl: '/mammoth.glb',
  },
] as const

describe('IdlePreloadCoordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not perform optional preloading when the user has enabled data saving', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {
      connection: { effectiveType: '4g', saveData: true },
    })
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const cache = new ModelCache()
    const coordinator = new IdlePreloadCoordinator({
      idleDelayMs: 2_000,
      modelCache: cache,
      targets,
    })

    coordinator.scheduleAfterCommit('triceratops')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.runAllTimersAsync()

    expect(fetchMock).not.toHaveBeenCalled()

    coordinator.destroy()
  })
})
