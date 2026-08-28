import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { NARROW_TOUCH_MEDIA_QUERY } from '../src/model-policy'
import { mainAnimals } from '../src/content/catalog'
import { SCALE_ENCOUNTER_PROFILE_STORAGE_KEY } from '../src/scale-encounter/profile-storage'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

interface MockDescriptor {
  readonly id: string
}

interface MockScaleEncounterSnapshot {
  readonly active: boolean
  readonly animalId: null
  readonly cameraStage: 'overview'
  readonly distanceMeters: null
  readonly error: null
  readonly metersPerUnit: null
  readonly orbitAngleDegrees: number
  readonly overviewZoom: number
  readonly perspective: 'child-eyes' | 'child-rear'
  readonly profile: null
  readonly rawSpanUnits: null
  readonly transitioning: boolean
  readonly view: 'overview'
}

interface MockViewerOptions {
  readonly onFailure?: (failure: {
    readonly kind: 'context-lost' | 'webgl-unavailable'
    readonly message: string
  }) => void
  readonly onModelReady?: (animalId: string) => void
}

const viewerMock = vi.hoisted(() => ({
  adjustScaleEncounterDistance: vi.fn(),
  adjustScaleEncounterOrbit: vi.fn(),
  beginScaleEncounter: vi.fn(),
  commitModel: vi.fn(),
  constructorCount: 0,
  destroy: vi.fn(),
  disposeStagedModel: vi.fn(),
  endScaleEncounter: vi.fn(),
  failConstruction: false,
  failureHandlers: [] as Array<
    (failure: {
      readonly kind: 'context-lost' | 'webgl-unavailable'
      readonly message: string
    }) => void
  >,
  finishScaleEncounterTransition: vi.fn(),
  getScaleEncounterSnapshot: vi.fn(),
  reset: vi.fn(),
  setAccessibilityLabel: vi.fn(),
  setFocusMode: vi.fn(),
  setScaleEncounterAvatarFactory: vi.fn(),
  setScaleEncounterDistanceMotion: vi.fn(),
  setScaleEncounterOrbitMotion: vi.fn(),
  setScaleEncounterEcologyDensity: vi.fn(),
  setScaleEncounterEnvironmentVariant: vi.fn(),
  setScaleEncounterPanoramaTexture: vi.fn(),
  setScaleEncounterPrototypeFlightApproximation: vi.fn(),
  setScaleEncounterSceneCandidateVariant: vi.fn(),
  stageModel: vi.fn(),
  transitionScaleEncounterView: vi.fn(),
  transitionScaleEncounterPerspective: vi.fn(),
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
      viewerMock.constructorCount += 1
      if (options.onFailure) {
        viewerMock.failureHandlers.push(options.onFailure)
      }
      if (viewerMock.failConstruction) {
        const message = '这个浏览器现在不能显示 3D 模型。'
        options.onFailure?.({ kind: 'webgl-unavailable', message })
        throw new ViewerUnavailableError(message)
      }
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

    reset(): void {
      viewerMock.reset()
    }

    setAccessibilityLabel(label: string): void {
      viewerMock.setAccessibilityLabel(label)
    }

    setFocusMode(focused: boolean): void {
      viewerMock.setFocusMode(focused)
    }

    getScaleEncounterSnapshot(): MockScaleEncounterSnapshot {
      const snapshot: unknown = viewerMock.getScaleEncounterSnapshot()
      return snapshot as MockScaleEncounterSnapshot
    }

    setScaleEncounterAvatarFactory(factory: unknown): void {
      viewerMock.setScaleEncounterAvatarFactory(factory)
    }

    setScaleEncounterEcologyDensity(density: unknown): void {
      viewerMock.setScaleEncounterEcologyDensity(density)
    }

    setScaleEncounterEnvironmentVariant(variant: unknown): void {
      viewerMock.setScaleEncounterEnvironmentVariant(variant)
    }

    setScaleEncounterPanoramaTexture(texture: unknown): void {
      viewerMock.setScaleEncounterPanoramaTexture(texture)
    }

    setScaleEncounterPrototypeFlightApproximation(enabled: boolean): void {
      viewerMock.setScaleEncounterPrototypeFlightApproximation(enabled)
    }

    setScaleEncounterSceneCandidateVariant(variant: unknown): void {
      viewerMock.setScaleEncounterSceneCandidateVariant(variant)
    }

    beginScaleEncounter(profile: {
      readonly gender: 'boy' | 'girl'
      readonly heightCm: number
    }): boolean {
      return viewerMock.beginScaleEncounter(profile) as boolean
    }

    transitionScaleEncounterView(
      view: 'overview' | 'pov',
      durationMs?: number,
    ): Promise<void> {
      return Promise.resolve(
        viewerMock.transitionScaleEncounterView(view, durationMs),
      )
    }

    transitionScaleEncounterPerspective(
      perspective: 'child-eyes' | 'child-rear',
      durationMs?: number,
    ): Promise<void> {
      return Promise.resolve(
        viewerMock.transitionScaleEncounterPerspective(
          perspective,
          durationMs,
        ),
      )
    }

    finishScaleEncounterTransition(): void {
      viewerMock.finishScaleEncounterTransition()
    }

    adjustScaleEncounterDistance(direction: 1 | -1): void {
      viewerMock.adjustScaleEncounterDistance(direction)
    }

    adjustScaleEncounterOrbit(direction: 1 | -1): void {
      viewerMock.adjustScaleEncounterOrbit(direction)
    }

    setScaleEncounterDistanceMotion(direction: 1 | 0 | -1): void {
      viewerMock.setScaleEncounterDistanceMotion(direction)
    }

    setScaleEncounterOrbitMotion(direction: 1 | 0 | -1): void {
      viewerMock.setScaleEncounterOrbitMotion(direction)
    }

    subscribeScaleEncounter(): () => void {
      return () => undefined
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

vi.mock('../src/scale-encounter/avatar-review-candidate', () => ({
  acquireReviewCandidateAvatarFactory: vi.fn(() =>
    Promise.resolve({
      factory: vi.fn(),
      release: vi.fn(),
    }),
  ),
}))

vi.mock('../src/scale-encounter/environment-review-candidate', () => ({
  acquireReviewCandidateEnvironment: vi.fn(() =>
    Promise.resolve({
      panoramaWidth: 4096,
      preferredQuality: 'medium',
      quality: 'medium',
      release: vi.fn(),
      sourceUrl: '/review-panorama.webp',
      startPanoramaUpgrade: vi.fn(() => Promise.resolve(null)),
      surfaceTextures: null,
      texture: { name: 'review-panorama' },
      theme: 'air-cretaceous',
    }),
  ),
}))

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

async function renderReadyApp(): Promise<void> {
  render(<App />)
  await waitFor(() => {
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'stegosaurus',
    )
  })
}

function expectTooltip(buttonName: string): void {
  const button = screen.getByRole('button', { name: buttonName })
  const tooltipId = button.getAttribute('aria-describedby')
  expect(tooltipId).toBeTruthy()
  const tooltip = tooltipId ? document.getElementById(tooltipId) : null
  expect(tooltip).toHaveAttribute('role', 'tooltip')
  expect(tooltip).toHaveTextContent(buttonName)
}

describe('App', () => {
  beforeEach(() => {
    viewerMock.adjustScaleEncounterDistance.mockReset()
    viewerMock.adjustScaleEncounterOrbit.mockReset()
    viewerMock.beginScaleEncounter.mockReset().mockReturnValue(true)
    viewerMock.commitModel.mockReset()
    viewerMock.constructorCount = 0
    viewerMock.destroy.mockReset()
    viewerMock.disposeStagedModel.mockReset()
    viewerMock.endScaleEncounter.mockReset()
    viewerMock.finishScaleEncounterTransition.mockReset()
    viewerMock.getScaleEncounterSnapshot.mockReset().mockReturnValue({
      active: false,
      animalId: null,
      cameraStage: 'overview',
      distanceMeters: null,
      error: null,
      metersPerUnit: null,
      orbitAngleDegrees: 0,
      overviewZoom: 1,
      perspective: 'child-rear',
      profile: null,
      rawSpanUnits: null,
      transitioning: false,
      view: 'overview',
    })
    viewerMock.reset.mockReset()
    viewerMock.setAccessibilityLabel.mockReset()
    viewerMock.setFocusMode.mockReset()
    viewerMock.setScaleEncounterAvatarFactory.mockReset()
    viewerMock.setScaleEncounterDistanceMotion.mockReset()
    viewerMock.setScaleEncounterOrbitMotion.mockReset()
    viewerMock.setScaleEncounterEcologyDensity.mockReset()
    viewerMock.setScaleEncounterEnvironmentVariant.mockReset()
    viewerMock.setScaleEncounterPanoramaTexture.mockReset()
    viewerMock.setScaleEncounterPrototypeFlightApproximation.mockReset()
    viewerMock.setScaleEncounterSceneCandidateVariant.mockReset()
    viewerMock.stageModel.mockReset()
    viewerMock.transitionScaleEncounterView
      .mockReset()
      .mockResolvedValue(undefined)
    viewerMock.transitionScaleEncounterPerspective
      .mockReset()
      .mockResolvedValue(undefined)
    viewerMock.failConstruction = false
    viewerMock.failureHandlers.length = 0
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

  it('presents the Chinese child experience with accessible controls and reviewed narration', async () => {
    await renderReadyApp()

    expect(viewerMock.constructorCount).toBe(1)
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('heading', { level: 1, name: '史前动物博物馆' }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 2, name: '剑龙' }),
    ).toBeVisible()
    expect(
      screen.getByText('看看它背上的两排骨板，像不像一列起伏的小山？'),
    ).toBeVisible()
    expect(
      screen.queryByText('这是剑龙，它是一种生活在晚侏罗世的食草恐龙。'),
    ).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: '听它的介绍' })).toBeEnabled()
    expect(
      screen.getByRole('region', { name: '剑龙模型展台' }),
    ).toBeVisible()
    expect(
      screen.getByRole('region', { name: '动物选择' }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: /^查看剑龙$/ }),
    ).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByText('本地评审')).not.toBeInTheDocument()
    expect(screen.queryByText('已听审')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '给家长的资料' }),
    ).toBeVisible()
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-habitat',
      'land',
    )
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-atmosphere',
      'forest',
    )
    expect(document.querySelector('.forest-atmosphere')).toBeInTheDocument()
    expect(
      document.querySelector('.underwater-atmosphere'),
    ).not.toBeInTheDocument()
    expect(new URL(window.location.href).searchParams.get('animal')).toBe(
      'stegosaurus',
    )

    for (const name of [
      '恢复初始视角',
      '专注看模型',
      '上一只动物',
      '下一只动物',
    ]) {
      expectTooltip(name)
    }
  })

  it('opens a supported animal encounter, persists its child profile, and Back restores the exhibit', async () => {
    const user = userEvent.setup()
    const audioInstances: AppTestAudio[] = []
    class AppTestAudio extends EventTarget {
      autoplay = false
      currentTime = 0
      preload = ''
      readonly load = vi.fn()
      readonly pause = vi.fn()
      readonly play = vi.fn(() => Promise.resolve())
      readonly removeAttribute = vi.fn()

      constructor(readonly src = '') {
        super()
        audioInstances.push(this)
      }
    }
    vi.stubGlobal('Audio', AppTestAudio)
    window.history.replaceState({}, '', '/museum/?animal=pteranodon')

    render(
      <App
        initialState={{
          animalId: 'pteranodon',
          locale: 'zh-CN',
          pageKind: 'museum',
          preference: 'zh-CN',
        }}
      />,
    )
    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'pteranodon',
      )
    })
    const originalUrl = window.location.href
    await user.click(screen.getByRole('button', { name: '听它的介绍' }))
    await waitFor(() => {
      expect(audioInstances).toHaveLength(1)
      expect(audioInstances[0]?.play).toHaveBeenCalledOnce()
    })
    const exhibitNarration = audioInstances[0]!
    exhibitNarration.currentTime = 7

    const entry = screen.getByRole('button', {
      name: '打开和无齿翼龙比一比的等比例相遇场景',
    })
    await user.click(entry)
    const encounter = await screen.findByRole('dialog', {
      name: '和无齿翼龙比一比',
    })
    expect(encounter).toBeVisible()
    expect(exhibitNarration.pause).toHaveBeenCalled()
    expect(exhibitNarration.currentTime).toBe(0)

    await user.click(within(encounter).getByRole('radio', { name: /男孩/ }))
    await user.click(
      within(encounter).getByRole('button', { name: '身高增加 5 厘米' }),
    )
    await user.click(
      within(encounter).getByRole('button', { name: '进入比一比' }),
    )
    expect(viewerMock.beginScaleEncounter).toHaveBeenLastCalledWith({
      gender: 'boy',
      heightCm: 115,
    })
    expect(window.location.href).toBe(originalUrl)
    expect(
      new URL(window.location.href).searchParams.has('heightCm'),
    ).toBe(false)
    expect(new URL(window.location.href).searchParams.has('gender')).toBe(false)
    expect(
      JSON.parse(
        window.sessionStorage.getItem(SCALE_ENCOUNTER_PROFILE_STORAGE_KEY) ?? '',
      ),
    ).toEqual({
      profile: { gender: 'boy', heightCm: 115 },
      version: 1,
    })

    act(() => window.history.back())
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: '和无齿翼龙比一比' }),
      ).not.toBeInTheDocument()
    })
    expect(window.location.href).toBe(originalUrl)
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'pteranodon',
    )
    expect(screen.getByRole('heading', { name: '无齿翼龙' })).toBeVisible()
    await waitFor(() => expect(entry).toHaveFocus())

    await user.click(entry)
    const reopenedEncounter = await screen.findByRole('dialog', {
      name: '和无齿翼龙比一比',
    })
    await waitFor(() => {
      expect(reopenedEncounter).toHaveAttribute('data-phase', 'overview')
    })
    expect(
      within(reopenedEncounter).queryByRole('group', {
        name: '小朋友是男孩还是女孩？',
      }),
    ).not.toBeInTheDocument()
    expect(viewerMock.beginScaleEncounter).toHaveBeenLastCalledWith({
      gender: 'boy',
      heightCm: 115,
    })

    await user.click(
      within(reopenedEncounter).getByRole('button', { name: '返回展台' }),
    )
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: '和无齿翼龙比一比' }),
      ).not.toBeInTheDocument()
      expect(entry).toBeEnabled()
    })
  })

  it('restores the explorer profile after a page refresh and skips setup', async () => {
    window.sessionStorage.setItem(
      SCALE_ENCOUNTER_PROFILE_STORAGE_KEY,
      JSON.stringify({
        profile: { approach: 'close', gender: 'girl', heightCm: 120 },
        version: 1,
      }),
    )
    window.history.replaceState({}, '', '/museum/?animal=pteranodon')
    const user = userEvent.setup()

    render(
      <App
        initialState={{
          animalId: 'pteranodon',
          locale: 'zh-CN',
          pageKind: 'museum',
          preference: 'zh-CN',
        }}
      />,
    )
    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'pteranodon',
      )
    })

    await user.click(
      screen.getByRole('button', {
        name: '打开和无齿翼龙比一比的等比例相遇场景',
      }),
    )
    const encounter = await screen.findByRole('dialog', {
      name: '和无齿翼龙比一比',
    })
    await waitFor(() => expect(encounter).toHaveAttribute('data-phase', 'overview'))
    expect(
      within(encounter).queryByRole('group', {
        name: '小朋友是男孩还是女孩？',
      }),
    ).not.toBeInTheDocument()
    expect(viewerMock.beginScaleEncounter).toHaveBeenLastCalledWith({
      approach: 'close',
      gender: 'girl',
      heightCm: 120,
    })
  })

  it('opens the same-scale encounter from a shareable query link', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/zh-CN/?animal=mammoth&scene-variant=C&scale-encounter=1',
    )

    render(
      <App
        initialState={{
          animalId: 'mammoth',
          locale: 'zh-CN',
          pageKind: 'museum',
          preference: 'zh-CN',
        }}
      />,
    )

    const encounter = await screen.findByRole('dialog', {
      name: '和长毛猛犸象比一比',
    })
    expect(encounter).toBeVisible()
    expect(encounter).toHaveAttribute('data-phase', 'setup')
    expect(viewerMock.setScaleEncounterSceneCandidateVariant).toHaveBeenCalledWith(
      'C',
    )
  })

  it('treats a scene candidate URL as a direct 3D prototype destination', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/zh-CN/?animal=pteranodon&scene-variant=D',
    )

    render(
      <App
        initialState={{
          animalId: 'pteranodon',
          locale: 'zh-CN',
          pageKind: 'museum',
          preference: 'zh-CN',
        }}
      />,
    )

    const encounter = await screen.findByRole('dialog', {
      name: '和无齿翼龙比一比',
    })
    expect(encounter).toBeVisible()
    expect(viewerMock.setScaleEncounterSceneCandidateVariant).toHaveBeenCalledWith(
      'D',
    )
  })

  it('keeps an animal detail URL clean after the initial model commits', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/en/animals/mosasaurus/',
    )

    render(
      <App
        initialState={{
          animalId: 'mosasaurus',
          locale: 'en',
          pageKind: 'animal-detail',
          preference: 'en',
        }}
      />,
    )

    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'mosasaurus',
      )
    })

    expect(viewerMock.stageModel).toHaveBeenCalledOnce()
    expect(viewerMock.stageModel.mock.calls[0]?.[0]).toMatchObject({
      id: 'mosasaurus',
    })
    expect(viewerMock.commitModel).toHaveBeenCalledWith(
      expect.objectContaining({ animalId: 'mosasaurus' }),
    )
    expect(window.location.pathname).toBe(
      '/museum/en/animals/mosasaurus/',
    )
    expect(window.location.search).toBe('')
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-page-kind',
      'animal-detail',
    )
  })

  it('preserves explicit encounter review selectors when leaving a detail route', async () => {
    const user = userEvent.setup()
    window.history.replaceState(
      {},
      '',
      '/museum/zh-CN/animals/tyrannosaurus-rex/?scene-variant=C&variant=production-slice&flight-approximation=0',
    )

    render(
      <App
        initialState={{
          animalId: 'tyrannosaurus-rex',
          locale: 'zh-CN',
          pageKind: 'animal-detail',
          preference: 'zh-CN',
        }}
      />,
    )
    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'tyrannosaurus-rex',
      )
    })

    await user.click(screen.getByRole('link', { name: '查看长毛猛犸象' }))
    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'mammoth',
      )
    })

    const currentUrl = new URL(window.location.href)
    expect(currentUrl.pathname).toBe('/museum/zh-CN/')
    expect(currentUrl.searchParams.get('animal')).toBe('mammoth')
    expect(currentUrl.searchParams.get('scene-variant')).toBe('C')
    expect(currentUrl.searchParams.get('variant')).toBe('production-slice')
    expect(currentUrl.searchParams.get('flight-approximation')).toBe('0')
  })

  it('switches to English without reloading the model and remembers a shareable locale path', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/museum/?animal=stegosaurus')
    await renderReadyApp()

    expect(viewerMock.constructorCount).toBe(1)
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)

    const languageButton = screen.getByRole('button', {
      name: '切换语言，当前简体中文',
    })
    await user.click(languageButton)
    const menu = screen.getByRole('menu', { name: '选择界面语言' })
    await user.click(
      within(menu).getByRole('menuitemradio', { name: 'English' }),
    )

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Prehistoric Animal Museum',
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Stegosaurus' }),
    ).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(document.documentElement).toHaveAttribute('data-locale', 'en')
    expect(window.location.pathname).toBe('/museum/en/')
    expect(new URL(window.location.href).searchParams.get('animal')).toBe(
      'stegosaurus',
    )
    expect(window.localStorage.getItem('museum.locale')).toBe('en')
    expect(viewerMock.constructorCount).toBe(1)
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)
    expect(viewerMock.setAccessibilityLabel).toHaveBeenLastCalledWith(
      'Stegosaurus 3D model. Drag to rotate; scroll or pinch to zoom.',
    )
  })

  it('commits the latest language when locale changes during the initial model load', async () => {
    const user = userEvent.setup()
    const pendingModel = deferred<ReturnType<typeof stagedModel>>()
    const stegosaurus = mainAnimals.find(
      (animal) => animal.id === 'stegosaurus',
    )
    if (!stegosaurus) {
      throw new Error('The Stegosaurus fixture is missing.')
    }
    const originalNarration = stegosaurus.assets.narration
    const mutableAssets = stegosaurus.assets as unknown as {
      narration: typeof originalNarration
    }
    mutableAssets.narration = {
      'zh-CN': {
        ...originalNarration['zh-CN'],
        url: '/audio/narration.zh-CN.mp3',
      },
      en: {
        ...originalNarration.en,
        url: '/audio/narration.en.mp3',
      },
    }
    const media = {
      addEventListener: vi.fn(),
      autoplay: false,
      currentTime: 0,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      preload: '',
      removeEventListener: vi.fn(),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return media as unknown as HTMLAudioElement
    })
    vi.stubGlobal('Audio', AudioMock)
    viewerMock.stageModel.mockImplementationOnce(() => pendingModel.promise)

    try {
      render(<App />)
      await waitFor(() => {
        expect(viewerMock.stageModel).toHaveBeenCalledOnce()
      })

      await user.click(
        screen.getByRole('button', {
          name: '切换语言，当前简体中文',
        }),
      )
      await user.click(
        screen.getByRole('menuitemradio', { name: 'English' }),
      )
      expect(
        screen.getByRole('heading', { level: 2, name: 'Stegosaurus' }),
      ).toBeVisible()

      await act(async () => {
        pendingModel.resolve(stagedModel({ id: 'stegosaurus' }))
        await pendingModel.promise
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(
          screen.getByText('Stegosaurus is now in the exhibit.'),
        ).toBeVisible()
      })
      expect(viewerMock.stageModel).toHaveBeenCalledOnce()
      expect(viewerMock.setAccessibilityLabel).toHaveBeenLastCalledWith(
        'Stegosaurus 3D model. Drag to rotate; scroll or pinch to zoom.',
      )
      expect(
        viewerMock.setAccessibilityLabel.mock.invocationCallOrder.at(-1),
      ).toBeGreaterThan(viewerMock.commitModel.mock.invocationCallOrder.at(-1) ?? 0)

      await user.click(
        screen.getByRole('button', { name: 'Listen to its introduction' }),
      )
      expect(AudioMock).toHaveBeenCalledWith('/audio/narration.en.mp3')
      expect(AudioMock).not.toHaveBeenCalledWith('/audio/narration.zh-CN.mp3')
    } finally {
      mutableAssets.narration = originalNarration
    }
  })

  it('stops and rewinds the previous language narration during a locale switch', async () => {
    const user = userEvent.setup()
    const media = {
      addEventListener: vi.fn(),
      autoplay: false,
      currentTime: 0,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      preload: '',
      removeEventListener: vi.fn(),
    }
    const AudioMock = vi.fn(function AudioMock() {
      return media as unknown as HTMLAudioElement
    })
    vi.stubGlobal('Audio', AudioMock)
    window.history.replaceState({}, '', '/museum/?animal=stegosaurus')
    await renderReadyApp()

    await user.click(screen.getByRole('button', { name: '听它的介绍' }))
    await waitFor(() => {
      expect(media.play).toHaveBeenCalledTimes(1)
    })
    media.currentTime = 8

    await user.click(
      screen.getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
    )
    await user.click(
      screen.getByRole('menuitemradio', { name: 'English' }),
    )

    expect(media.pause).toHaveBeenCalled()
    expect(media.currentTime).toBe(0)
    expect(screen.getByRole('heading', { name: 'Stegosaurus' })).toBeVisible()
    expect(viewerMock.constructorCount).toBe(1)
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)
  })

  it('switches language inside an open drawer without closing it or reloading the model', async () => {
    const user = userEvent.setup()
    await renderReadyApp()

    await user.click(
      screen.getByRole('button', { name: '给家长的资料' }),
    )
    const chineseDialog = screen.getByRole('dialog', {
      name: '给家长的资料',
    })
    await user.click(
      within(chineseDialog).getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
    )
    await user.click(
      within(chineseDialog).getByRole('menuitemradio', { name: 'English' }),
    )

    const englishDialog = screen.getByRole('dialog', {
      name: 'Guide for grown-ups',
    })
    expect(englishDialog).toBeVisible()
    expect(within(englishDialog).getByText('Late Jurassic')).toBeVisible()
    expect(document.getElementById('museum-experience')).not.toHaveClass(
      'museum-experience--focus',
    )
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)
  })

  it('switches language in model focus mode without leaving focus or reloading the model', async () => {
    const user = userEvent.setup()
    await renderReadyApp()

    await user.click(
      screen.getByRole('button', { name: '专注看模型' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
    )
    await user.click(
      screen.getByRole('menuitemradio', { name: 'English' }),
    )

    expect(document.getElementById('museum-experience')).toHaveClass(
      'museum-experience--focus',
    )
    expect(
      screen.getByRole('button', { name: 'Exit model focus mode' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Stegosaurus' }),
    ).not.toBeInTheDocument()
    expect(viewerMock.stageModel).toHaveBeenCalledTimes(1)
  })

  it('opens the creator story without replacing the museum and restores focus', async () => {
    const user = userEvent.setup()
    await renderReadyApp()

    const aboutButton = screen.getByRole('button', {
      name: '了解Leon做了个和这座博物馆',
    })
    const navigation = screen.getByRole('region', { name: '动物选择' })
    await user.click(aboutButton)

    const dialog = screen.getByRole('dialog', { name: '关于这座博物馆' })
    expect(dialog).toBeVisible()
    expect(
      within(dialog).getByText('一个程序员爸爸，为女儿做的小博物馆'),
    ).toBeVisible()
    expect(within(dialog).getByText(/女儿三岁时会害怕电视里的恐龙追逐/))
      .toBeVisible()
    expect(
      within(dialog).getByRole('link', { name: '在 GitHub 查看源码' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/s010s/prehistoric-animal-museum',
    )
    expect(
      within(dialog).getByRole('link', { name: '查看许可与素材说明' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
    )
    expect(
      within(dialog).getByRole('link', {
        name: /史前动物博物馆官方网站/,
      }),
    ).toHaveAttribute(
      'href',
      'https://leon-made-this.work/museum/zh-CN/',
    )
    expect(
      within(dialog).getByRole('link', { name: /Leon 的个人官网/ }),
    ).toHaveAttribute('href', 'https://leon-made-this.work/')
    expect(navigation).toHaveAttribute('inert')

    await user.click(
      within(dialog).getByRole('button', { name: '关闭关于这座博物馆' }),
    )
    expect(
      screen.queryByRole('dialog', { name: '关于这座博物馆' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(aboutButton).toHaveFocus()
    })
  })

  it('replaces navigation with the parent drawer and gives focus mode Escape priority', async () => {
    const user = userEvent.setup()
    await renderReadyApp()

    const focusButton = screen.getByRole('button', { name: '专注看模型' })
    const drawerButton = screen.getByRole('button', {
      name: '给家长的资料',
    })
    const navigation = screen.getByRole('region', { name: '动物选择' })
    await user.click(drawerButton)

    const dialog = screen.getByRole('dialog', { name: '给家长的资料' })
    expect(dialog).toBeVisible()
    expect(
      within(dialog).queryByRole('region', { name: '本地评审记录' }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByText('评审备注（仅本地可见）'),
    ).not.toBeInTheDocument()
    expect(navigation).toHaveAttribute('aria-hidden', 'true')
    expect(navigation).toHaveAttribute('inert')
    expect(screen.getByTestId('model-stage')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('model-stage')).toHaveAttribute('inert')
    expect(screen.getByText('晚侏罗世')).toBeVisible()
    expect(screen.getByText('北美洲西部')).toBeVisible()
    expect(
      within(dialog).getByText(
        '这是剑龙，它是一种生活在晚侏罗世的食草恐龙。看看它背上的两排骨板，像不像一列起伏的小山？',
      ),
    ).toBeVisible()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '关闭家长资料' }),
      ).toHaveFocus()
    })
    const researchDisclosure = within(dialog)
      .getByText('剑龙研究资料')
      .closest('details')
    expect(
      Array.from(
        dialog.querySelectorAll(
          '.narration-transcript, .research-disclosure',
        ),
      ).map((element) => element.classList[0]),
    ).toEqual(['narration-transcript', 'research-disclosure'])
    expect(researchDisclosure).not.toHaveAttribute('open')
    await user.click(within(dialog).getByText('剑龙研究资料'))
    expect(researchDisclosure).toHaveAttribute('open')
    expect(
      within(dialog).getByText(/剑龙属于剑龙类恐龙。已知化石年代为晚侏罗世/),
    ).toBeVisible()
    expect(
      within(dialog).getByText('化石证据与复原边界'),
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        '不把骨板颜色和叫声描述成已经证实的事实。',
      ),
    ).toBeVisible()
    expect(
      within(dialog).getByText(/本页研究资料由 Leon做了个依据公开博物馆资料和科学论文整理/),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'PBR Stegasaurus (Animated)' }),
    ).toHaveAttribute(
      'href',
      'https://sketchfab.com/3d-models/pbr-stegasaurus-animated-ec254ea1554941fe8a131f62db0faf3d',
    )
    expect(
      screen.getByRole('link', {
        name: 'Creative Commons Attribution 4.0 International',
      }),
    ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
    expect(
      within(dialog).getByRole('link', { name: '查看 GitHub 项目' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/s010s/prehistoric-animal-museum',
    )
    expect(
      within(dialog).getByRole('link', { name: '查看完整许可说明' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/s010s/prehistoric-animal-museum/blob/main/LICENSING.md',
    )
    expect(
      within(dialog).getByRole('link', {
        name: /史前动物博物馆官方网站/,
      }),
    ).toHaveAttribute(
      'href',
      'https://leon-made-this.work/museum/zh-CN/',
    )
    expect(
      within(dialog).getByRole('link', { name: /Leon 的个人官网/ }),
    ).toHaveAttribute('href', 'https://leon-made-this.work/')
    // The action is inert to real users while the dialog is open. Firing it
    // directly creates the otherwise unreachable overlapping state so Escape
    // ordering can be verified deterministically.
    fireEvent.click(focusButton)
    const exitButton = screen.getByRole('button', {
      name: '退出模型专注模式',
    })
    expect(exitButton).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '剑龙' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
      exitButton,
    ])
    expect(viewerMock.setFocusMode).toHaveBeenCalledWith(true)

    await user.keyboard('{Escape}')
    expect(
      screen.getByRole('dialog', { name: '给家长的资料' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: '退出模型专注模式' }),
    ).not.toBeInTheDocument()
    expect(viewerMock.setFocusMode).toHaveBeenLastCalledWith(false)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '给家长的资料' }),
      ).toHaveFocus()
    })
  })

  it('opens a complete museum index and moves directly to the chosen exhibit', async () => {
    const user = userEvent.setup()
    await renderReadyApp()

    const collectionButton = screen.getByRole('button', {
      name: '打开全馆图鉴',
    })
    const navigation = screen.getByRole('region', { name: '动物选择' })
    await user.click(collectionButton)

    const dialog = screen.getByRole('dialog', { name: '全馆图鉴' })
    expect(dialog).toBeVisible()
    expect(
      within(dialog).getAllByRole('button', { name: /前往.+展台$/ }),
    ).toHaveLength(18)
    expect(
      dialog.querySelectorAll('.collection-card__image img[loading="eager"]'),
    ).toHaveLength(18)
    expect(
      within(dialog).getByRole('button', {
        name: '当前展台，前往剑龙展台',
      }),
    ).toHaveAttribute('aria-current', 'true')
    expect(navigation).toHaveAttribute('aria-hidden', 'true')
    expect(navigation).toHaveAttribute('inert')
    expect(screen.getByTestId('model-stage')).toHaveAttribute('inert')

    await user.click(
      within(dialog).getByRole('button', { name: '前往三角龙展台' }),
    )

    expect(screen.queryByRole('dialog', { name: '全馆图鉴' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: '三角龙' }),
      ).toBeVisible()
    })
    expect(new URL(window.location.href).searchParams.get('animal')).toBe(
      'triceratops',
    )
  })

  it('shows download and model-opening phases, preserves the poster on failure, and retries', async () => {
    vi.useFakeTimers()
    const staged = deferred<ReturnType<typeof stagedModel>>()
    let reportProgress:
      | ((progress: {
          readonly fromCache: boolean
          readonly loadedBytes: number
          readonly source: 'memory-cache' | 'http-cache' | 'network'
          readonly totalBytes: number | null
        }) => void)
      | undefined
    viewerMock.stageModel.mockImplementation(
      (
        _descriptor: MockDescriptor,
        _signal: AbortSignal | undefined,
        onProgress: typeof reportProgress,
      ) => {
        reportProgress = onProgress
        return staged.promise
      },
    )

    render(<App />)
    await act(async () => {
      await Promise.resolve()
    })

    const card = screen.getByRole('link', { name: '查看剑龙' })
    const focusButton = screen.getByRole('button', { name: '专注看模型' })
    expect(card).toHaveAttribute('data-loading', 'true')
    expect(screen.queryByText('正在请它出来…')).not.toBeInTheDocument()
    expect(screen.getByText('正在查找 3D 模型…')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: '3D 模型加载进度' }))
      .not.toHaveAttribute('value')
    expect(document.querySelector('.stage-loading')).toBeVisible()
    expect(focusButton).toBeDisabled()
    expect(
      screen.getByAltText('剑龙的透明背景静态模型图'),
    ).toBeVisible()

    act(() => {
      reportProgress?.({
        fromCache: false,
        loadedBytes: 40,
        source: 'network',
        totalBytes: 100,
      })
    })
    expect(screen.getByText('正在下载 3D 模型 · 40%')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: '3D 模型加载进度' }))
      .toHaveAttribute('value', '40')

    act(() => {
      reportProgress?.({
        fromCache: false,
        loadedBytes: 44,
        source: 'network',
        totalBytes: 100,
      })
    })
    expect(screen.getByText('正在下载 3D 模型 · 40%')).toBeVisible()

    act(() => {
      reportProgress?.({
        fromCache: false,
        loadedBytes: 45,
        source: 'network',
        totalBytes: 100,
      })
    })
    expect(screen.getByText('正在下载 3D 模型 · 45%')).toBeVisible()

    act(() => {
      reportProgress?.({
        fromCache: false,
        loadedBytes: 100,
        source: 'network',
        totalBytes: 100,
      })
    })
    expect(screen.getByText('正在打开 3D 模型…')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: '3D 模型加载进度' }))
      .not.toHaveAttribute('value')
    expect(screen.queryByText(/3D 模型 · 100%/)).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(screen.queryByText('正在请它出来…')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.queryByText('正在请它出来…')).not.toBeInTheDocument()

    const loadFailure = new Error('mock model failure')
    await act(async () => {
      staged.reject(loadFailure)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(card).toHaveAttribute('data-failed', 'true')
    expect(
      screen.getByText('点我再试'),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '重新加载模型' }),
    ).toBeVisible()
    expect(screen.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
    expect(document.querySelector('.stage-loading')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '剑龙' })).toBeVisible()
    expect(screen.getByRole('button', { name: '听它的介绍' })).toBeEnabled()

    configureSuccessfulViewer()
    fireEvent.click(card)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'stegosaurus',
    )
    expect(focusButton).toBeEnabled()
  })

  it('preloads the next then previous animal after the visitor is idle', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'stegosaurus',
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
      await vi.runAllTimersAsync()
    })
    const urls = fetchMock.mock.calls.map(([url]) =>
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.href
          : url.url,
    )
    expect(urls).toHaveLength(6)
    expect(urls[0]).toContain('pteranodon/model/model.glb')
    expect(
      urls.slice(1, 3).every((url) => url.includes('pteranodon')),
    ).toBe(true)
    expect(urls[3]).toContain('mosasaurus/model/model.glb')
    expect(urls.slice(4).every((url) => url.includes('mosasaurus'))).toBe(true)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ priority: 'low' })
    }
  })

  it('creates narration media only after the ready exhibit stays idle', async () => {
    vi.useFakeTimers()
    const audio = document.createElement('audio')
    const AudioMock = vi.fn(function AudioMock() {
      return audio
    })
    vi.stubGlobal('Audio', AudioMock)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
      ),
    )

    render(<App />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.getElementById('museum-experience')).toHaveAttribute(
      'data-ready-animal-id',
      'stegosaurus',
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999)
    })
    expect(AudioMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(audio.autoplay).toBe(false)
    expect(audio.preload).toBe('auto')
  })

  it('defers offscreen rail thumbnails until they approach the viewport', async () => {
    const observations: Array<{
      readonly callback: IntersectionObserverCallback
      readonly observer: IntersectionObserver
      target: Element | null
    }> = []
    const IntersectionObserverMock = vi.fn(function IntersectionObserverMock(
      callback: IntersectionObserverCallback,
    ) {
      const observation = {
        callback,
        observer: null as unknown as IntersectionObserver,
        target: null as Element | null,
      }
      const observer = {
        disconnect: vi.fn(),
        observe: vi.fn((target: Element) => {
          observation.target = target
        }),
        root: null,
        rootMargin: '0px 180px',
        takeRecords: () => [],
        thresholds: [0.01],
        unobserve: vi.fn(),
      } as unknown as IntersectionObserver
      observation.observer = observer
      observations.push(observation)
      return observer
    })
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)

    await renderReadyApp()

    const thumbnails = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        '.animal-rail .thumbnail-frame img',
      ),
    )
    expect(thumbnails).toHaveLength(18)
    expect(thumbnails.filter((image) => image.hasAttribute('src'))).toHaveLength(
      1,
    )

    act(() => {
      for (const observation of observations) {
        if (!observation.target) {
          continue
        }
        observation.callback(
          [
            {
              isIntersecting: true,
              target: observation.target,
            } as IntersectionObserverEntry,
          ],
          observation.observer,
        )
      }
    })
    expect(thumbnails.every((image) => image.hasAttribute('src'))).toBe(true)
  })

  it('restarts adjacent preloading after the visitor returns to the tab', async () => {
    vi.useFakeTimers()
    let visibilityState: DocumentVisibilityState = 'visible'
    const originalVisibilityState = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    )
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      render(<App />)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'stegosaurus',
      )

      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(fetchMock).not.toHaveBeenCalled()

      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_999)
      })
      expect(fetchMock).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await vi.runAllTimersAsync()
      })
      const urls = fetchMock.mock.calls.map(([url]) =>
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.href
            : url.url,
      )
      expect(urls[0]).toContain('pteranodon/model/model.glb')
      expect(urls.slice(0, 3).every((url) => url.includes('pteranodon'))).toBe(
        true,
      )
      expect(urls[3]).toContain('mosasaurus/model/model.glb')
    } finally {
      if (originalVisibilityState) {
        Object.defineProperty(
          document,
          'visibilityState',
          originalVisibilityState,
        )
      } else {
        Reflect.deleteProperty(document, 'visibilityState')
      }
    }
  })

  it('preserves unrelated query parameters and the hash when committing an animal', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum?campaign=forest&animal=missing#details',
    )

    await renderReadyApp()

    const currentUrl = new URL(window.location.href)
    expect(currentUrl.pathname).toBe('/museum')
    expect(currentUrl.searchParams.get('campaign')).toBe('forest')
    expect(currentUrl.searchParams.get('animal')).toBe('stegosaurus')
    expect(currentUrl.hash).toBe('#details')
  })

  it('does not reposition the animal rail merely because a card receives focus', async () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    )
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      await renderReadyApp()
      scrollIntoView.mockClear()

      fireEvent.focus(screen.getByRole('link', { name: '查看剑龙' }))

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollIntoView',
          originalScrollIntoView,
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('centers a distant full-collection selection while it loads and when it fails', async () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    )
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const pending = deferred<ReturnType<typeof stagedModel>>()

    try {
      await renderReadyApp()
      scrollIntoView.mockClear()
      viewerMock.stageModel.mockImplementationOnce(() => pending.promise)

      await userEvent.click(
        screen.getByRole('button', { name: '打开全馆图鉴' }),
      )
      const dialog = screen.getByRole('dialog', { name: '全馆图鉴' })
      await userEvent.click(
        within(dialog).getByRole('button', { name: '前往沧龙展台' }),
      )

      const requestedCard = screen.getByRole('link', { name: '查看沧龙' })
      await waitFor(() => {
        expect(requestedCard).toHaveAttribute('data-loading', 'true')
        expect(scrollIntoView).toHaveBeenCalled()
      })
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(requestedCard)
      expect(requestedCard).not.toHaveFocus()

      await act(async () => {
        pending.reject(new Error('mock distant selection failure'))
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(requestedCard).toHaveAttribute('data-failed', 'true')
      })
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(requestedCard)
      expect(screen.getByText('点我再试')).toBeVisible()
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollIntoView',
          originalScrollIntoView,
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
      }
    }
  })

  it('uses the latest requested animal as the anchor for rapid next clicks', async () => {
    await renderReadyApp()
    viewerMock.stageModel.mockClear()
    viewerMock.stageModel.mockImplementation(
      () => new Promise<never>(() => undefined),
    )

    const nextButton = screen.getByRole('button', { name: '下一只动物' })
    fireEvent.click(nextButton)
    fireEvent.click(nextButton)

    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-requested-animal-id',
        'pachycephalosaurus',
      )
    })
    expect(
      viewerMock.stageModel.mock.calls.map(
        ([descriptor]) => (descriptor as MockDescriptor).id,
      ),
    ).toEqual(['pteranodon', 'pachycephalosaurus'])
  })

  it('keeps content and controls available with a poster when WebGL is unavailable', async () => {
    viewerMock.failConstruction = true
    render(<App />)

    expect(
      await screen.findByText('今天先看看它的静态模型吧'),
    ).toBeVisible()
    expect(screen.getByText('这个浏览器现在不能显示 3D 模型。')).toBeVisible()
    expect(screen.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
    expect(screen.getByRole('heading', { name: '剑龙' })).toBeVisible()
    expect(screen.getByRole('button', { name: '听它的介绍' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '专注看模型' })).toBeDisabled()
    expect(screen.getByRole('region', { name: '动物选择' })).toBeVisible()

    viewerMock.failConstruction = false
    await userEvent.click(
      screen.getByRole('button', { name: '重新加载模型' }),
    )
    await waitFor(() => {
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'stegosaurus',
      )
    })
    expect(
      screen.queryByText('今天先看看它的静态模型吧'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '专注看模型' })).toBeEnabled()

    await userEvent.click(
      screen.getByRole('button', { name: '给家长的资料' }),
    )
    expect(
      screen.getByRole('dialog', { name: '给家长的资料' }),
    ).toBeVisible()
  })

  it('localises a WebGL fallback reported by the renderer', async () => {
    window.localStorage.setItem('museum.locale', 'en')
    window.history.replaceState({}, '', '/museum/en/')
    viewerMock.failConstruction = true

    render(<App />)

    expect(
      await screen.findByText('Let’s look at its still model for now'),
    ).toBeVisible()
    expect(
      screen.getByText('This browser cannot display the 3D model right now.'),
    ).toBeVisible()
    expect(
      screen.getByAltText(
        'Still model of Stegosaurus on a transparent background',
      ),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Stegosaurus' })).toBeVisible()
  })

  it('relocalises a visible model-data notice without dismissing it', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string): MediaQueryList => ({
        matches: query === NARROW_TOUCH_MEDIA_QUERY,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    await renderReadyApp()

    expect(
      await screen.findByText(
        '这里的 3D 动物会使用一些流量，连接 Wi‑Fi 时观看会更顺畅。',
      ),
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
    )
    await user.click(
      screen.getByRole('menuitemradio', { name: 'English' }),
    )

    expect(
      screen.getByText(
        'The 3D animals use some data. A Wi-Fi connection may feel smoother.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByText(
        '这里的 3D 动物会使用一些流量，连接 Wi‑Fi 时观看会更顺畅。',
      ),
    ).not.toBeInTheDocument()
  })

  it('relocalises an already-visible WebGL fallback and its announcement', async () => {
    const user = userEvent.setup()
    await renderReadyApp()
    const failureHandler = viewerMock.failureHandlers.at(-1)
    if (!failureHandler) {
      throw new Error('The mock viewer did not receive an onFailure callback')
    }

    act(() => {
      failureHandler({
        kind: 'context-lost',
        message: 'WebGL 绘图环境暂时不可用。',
      })
    })
    expect(screen.getByText('WebGL 绘图环境暂时不可用。')).toBeVisible()

    await user.click(
      screen.getByRole('button', {
        name: '切换语言，当前简体中文',
      }),
    )
    await user.click(
      screen.getByRole('menuitemradio', { name: 'English' }),
    )

    expect(
      screen.getByText('The 3D drawing surface is temporarily unavailable.'),
    ).toBeVisible()
    expect(
      document.querySelector('.sr-only[role="status"]'),
    ).toHaveTextContent(
      'The 3D exhibit is unavailable, so a still model of Stegosaurus is shown instead.',
    )
    expect(
      screen.queryByText('WebGL 绘图环境暂时不可用。'),
    ).not.toBeInTheDocument()
  })

  it('shows the poster after context loss and remounts a working viewer on retry', async () => {
    const user = userEvent.setup()
    await renderReadyApp()
    const initialConstructorCount = viewerMock.constructorCount
    const failureHandler = viewerMock.failureHandlers.at(-1)
    if (!failureHandler) {
      throw new Error('The mock viewer did not receive an onFailure callback')
    }

    act(() => {
      failureHandler({
        kind: 'context-lost',
        message: 'WebGL 绘图环境暂时不可用。',
      })
    })

    expect(screen.getByText('今天先看看它的静态模型吧')).toBeVisible()
    expect(screen.getByText('WebGL 绘图环境暂时不可用。')).toBeVisible()
    expect(screen.getByAltText('剑龙的透明背景静态模型图')).toBeVisible()
    expect(screen.getByRole('heading', { name: '剑龙' })).toBeVisible()
    expect(screen.getByRole('button', { name: '听它的介绍' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '专注看模型' })).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: '重新加载模型' }),
    )
    await waitFor(() => {
      expect(viewerMock.constructorCount).toBeGreaterThan(
        initialConstructorCount,
      )
      expect(document.getElementById('museum-experience')).toHaveAttribute(
        'data-ready-animal-id',
        'stegosaurus',
      )
    })

    expect(viewerMock.destroy).toHaveBeenCalled()
    expect(
      screen.queryByText('今天先看看它的静态模型吧'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '专注看模型' })).toBeEnabled()
  })

  it('cannot commit an in-flight model after context loss and keeps tokens increasing on retry', async () => {
    const staged = deferred<ReturnType<typeof stagedModel>>()
    viewerMock.stageModel.mockImplementationOnce(() => staged.promise)
    render(<App />)

    await waitFor(() => {
      expect(viewerMock.stageModel).toHaveBeenCalledOnce()
    })
    const museum = document.getElementById('museum-experience')
    const failedToken = Number(museum?.getAttribute('data-request-token'))
    const failureHandler = viewerMock.failureHandlers.at(-1)
    if (!failureHandler) {
      throw new Error('The mock viewer did not receive an onFailure callback')
    }

    act(() => {
      failureHandler({
        kind: 'context-lost',
        message: 'WebGL 绘图环境暂时不可用。',
      })
    })
    expect(screen.getByText('今天先看看它的静态模型吧')).toBeVisible()

    await act(async () => {
      staged.resolve(stagedModel({ id: 'stegosaurus' }))
      await staged.promise
      await Promise.resolve()
    })
    expect(viewerMock.commitModel).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(viewerMock.disposeStagedModel).toHaveBeenCalledOnce()
    })
    expect(screen.getByText('今天先看看它的静态模型吧')).toBeVisible()

    configureSuccessfulViewer()
    await userEvent.click(
      screen.getByRole('button', { name: '重新加载模型' }),
    )
    await waitFor(() => {
      expect(museum).toHaveAttribute('data-ready-animal-id', 'stegosaurus')
      expect(screen.queryByText('今天先看看它的静态模型吧')).not.toBeInTheDocument()
    })
    expect(Number(museum?.getAttribute('data-request-token'))).toBeGreaterThan(
      failedToken,
    )
  })
})
