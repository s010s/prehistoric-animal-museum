import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { App } from '../src/App'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

interface MockDescriptor {
  readonly id: string
}

interface MockViewerOptions {
  readonly onFailure?: (failure: {
    readonly kind: 'context-lost' | 'webgl-unavailable'
    readonly message: string
  }) => void
  readonly onModelReady?: (animalId: string) => void
}

const viewerMock = vi.hoisted(() => ({
  commitModel: vi.fn(),
  destroy: vi.fn(),
  disposeStagedModel: vi.fn(),
  endScaleEncounter: vi.fn(),
  setAccessibilityLabel: vi.fn(),
  stageModel: vi.fn(),
}))

vi.mock('../src/viewer/ViewerController', () => {
  class ViewerUnavailableError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ViewerUnavailableError'
    }
  }

  class ViewerController {
    private readonly options: MockViewerOptions

    constructor(_container: HTMLElement, options: MockViewerOptions = {}) {
      this.options = options
    }

    stageModel(
      descriptor: MockDescriptor,
      signal?: AbortSignal,
      onProgress?: (progress: {
        readonly fromCache: boolean
        readonly loadedBytes: number
        readonly source: 'memory-cache' | 'http-cache' | 'network'
        readonly totalBytes: number | null
      }) => void,
    ): Promise<unknown> {
      const result = viewerMock.stageModel(
        descriptor,
        signal,
        onProgress,
      ) as unknown
      return Promise.resolve(result)
    }

    commitModel(staged: unknown): void {
      viewerMock.commitModel(staged)
      this.options.onModelReady?.((staged as { animalId: string }).animalId)
    }

    disposeStagedModel(staged: unknown): void {
      viewerMock.disposeStagedModel(staged)
    }

    setAccessibilityLabel(label: string): void {
      viewerMock.setAccessibilityLabel(label)
    }

    endScaleEncounter(): void {
      viewerMock.endScaleEncounter()
    }

    destroy(): void {
      viewerMock.destroy()
    }
  }

  return { ViewerController, ViewerUnavailableError }
})

vi.mock('../src/flight-experience/FlightModuleBoundary', async () => {
  const { createElement } = await import('react')
  return {
    FlightModule: ({
      experienceProps,
    }: {
      experienceProps: {
        onSpeciesChange?: (id: string, preferences: unknown) => void
      }
    }) =>
      createElement(
        'button',
        {
          onClick: () =>
            experienceProps.onSpeciesChange?.('tupandactylus', {}),
          type: 'button',
        },
        'Switch mock flight species',
      ),
  }
})

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

function stagedModel(descriptor: MockDescriptor) {
  return {
    animalId: descriptor.id,
    descriptor,
    disposed: false,
  }
}

function configureSuccessfulViewer(): void {
  viewerMock.stageModel.mockImplementation(
    (descriptor: MockDescriptor) =>
      Promise.resolve(stagedModel(descriptor)),
  )
}

describe('App', () => {
  beforeEach(() => {
    viewerMock.commitModel.mockReset()
    viewerMock.destroy.mockReset()
    viewerMock.disposeStagedModel.mockReset()
    viewerMock.endScaleEncounter.mockReset()
    viewerMock.setAccessibilityLabel.mockReset()
    viewerMock.stageModel.mockReset()
    configureSuccessfulViewer()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('museum.locale', 'zh-CN')
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('cancels the pending flight route when another animal is chosen during a delayed switch', async () => {
    const pending = deferred<ReturnType<typeof stagedModel>>()
    viewerMock.stageModel.mockImplementation((descriptor: MockDescriptor) =>
      descriptor.id === 'tupandactylus'
        ? pending.promise
        : Promise.resolve(stagedModel(descriptor)),
    )
    window.history.replaceState(
      {},
      '',
      '/museum/zh-CN/animals/pteranodon/?experience=flight',
    )
    render(
      <App
        initialState={{
          animalId: 'pteranodon',
          locale: 'zh-CN',
          pageKind: 'animal-detail',
          preference: 'zh-CN',
        }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', {
      name: 'Switch mock flight species',
    }))
    await waitFor(() =>
      expect(
        document.querySelector('[data-animal-id="tupandactylus"]'),
      ).toHaveAttribute('data-loading', 'true'),
    )
    fireEvent.click(
      document.querySelector('[data-animal-id="rhamphorhynchus"]')!,
    )
    await waitFor(() =>
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'rhamphorhynchus',
      ),
    )
    expect(new URL(window.location.href).searchParams.has('experience')).toBe(
      false,
    )
    expect(
      screen.queryByRole('button', { name: 'Switch mock flight species' }),
    ).not.toBeInTheDocument()

    await act(async () => {
      pending.resolve(stagedModel({ id: 'tupandactylus' }))
      await pending.promise
    })
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'rhamphorhynchus',
    )
    expect(new URL(window.location.href).searchParams.has('experience')).toBe(
      false,
    )
  })
})
