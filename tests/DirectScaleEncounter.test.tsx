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
import type { ViewerController } from '../src/viewer/ViewerController'
import {
  DirectScaleEncounter,
  type DirectScaleEncounterProps,
} from '../src/scale-encounter/DirectScaleEncounter'
import type { ScaleEncounterAvatarFactory } from '../src/viewer/scale-encounter'

const reviewCandidateMock = vi.hoisted(() => ({
  acquire: vi.fn(),
  factory: vi.fn(),
  release: vi.fn(),
}))

const reviewEnvironmentMock = vi.hoisted(() => ({
  acquire: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
  startPanoramaUpgrade: vi.fn(),
  surfaceTextures: {
    albedo: { name: 'review-ground-albedo' },
    normal: { name: 'review-ground-normal' },
    physicalWidthMeters: 2,
    roughness: { name: 'review-ground-roughness' },
  },
  texture: { name: 'review-panorama' },
  upgradeTexture: { name: 'review-panorama-high' },
}))

vi.mock('../src/scale-encounter/avatar-review-candidate', () => ({
  acquireReviewCandidateAvatarFactory: reviewCandidateMock.acquire,
}))

vi.mock('../src/scale-encounter/environment-review-candidate', () => ({
  acquireReviewCandidateEnvironment: reviewEnvironmentMock.acquire,
}))

vi.mock('../src/scale-encounter/forest-ecology-review-candidate', () => ({
  loadReviewCandidateForestEcology: vi.fn().mockResolvedValue(null),
}))

vi.mock('../src/scale-encounter/forest-props-review-candidate', () => ({
  loadReviewCandidateForestProps: vi.fn().mockResolvedValue(null),
}))

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

class TestAudio extends EventTarget {
  currentTime = 0
  preload = ''
  readonly load = vi.fn()
  readonly pause = vi.fn()
  readonly play = vi.fn(() => Promise.resolve())
  readonly removeAttribute = vi.fn()

  constructor(readonly src: string) {
    super()
    testAudioInstances.push(this)
  }
}

const testAudioInstances: TestAudio[] = []

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function makeController() {
  const snapshot = {
    active: true,
    animalId: 'pteranodon' as const,
    cameraStage: 'overview' as const,
    view: 'overview' as const,
    transitioning: false,
    distanceMeters: 15,
    overviewZoom: 1,
    error: null,
    profile: null,
    rawSpanUnits: 1,
    metersPerUnit: 1,
  }
  return {
    adjustScaleEncounterDistance: vi.fn(),
    beginScaleEncounter: vi.fn(() => true),
    endScaleEncounter: vi.fn(),
    finishScaleEncounterTransition: vi.fn(),
    getScaleEncounterMaximumTextureSize: vi.fn(() => 8192),
    getScaleEncounterSnapshot: vi.fn(() => snapshot),
    setScaleEncounterAvatarFactory: vi.fn(),
    setScaleEncounterDistanceMotion: vi.fn(),
    setScaleEncounterEcologyDensity: vi.fn(),
    setScaleEncounterEnvironmentVariant: vi.fn(),
    setScaleEncounterPanoramaTexture: vi.fn(),
    transitionScaleEncounterView: vi.fn<
      (view: 'overview' | 'pov', durationMs?: number) => Promise<void>
    >(() => Promise.resolve()),
    subscribeScaleEncounter: vi.fn(() => () => undefined),
  }
}

function renderTyrannosaurusEncounter(controller = makeController()) {
  const onClose = vi.fn()
  const onPresentationStateChange = vi.fn()
  const onProfileChange = vi.fn()
  const onScenePresentationChange =
    vi.fn<DirectScaleEncounterProps['onScenePresentationChange']>()
  const view = render(
    <DirectScaleEncounter
      animal={{
        atmosphere: 'forest',
        backgroundLandscape: '/tyrannosaurus-landscape.webp',
        backgroundPortrait: '/tyrannosaurus-portrait.webp',
        id: 'tyrannosaurus-rex',
        name: '霸王龙',
        poster: '/tyrannosaurus.webp',
        posterPortrait: '/tyrannosaurus-portrait-model.webp',
      }}
      controller={controller as unknown as ViewerController}
      locale="zh-CN"
      onClose={onClose}
      onPresentationStateChange={onPresentationStateChange}
      onProfileChange={onProfileChange}
      onScenePresentationChange={onScenePresentationChange}
      profile={null}
    />,
  )
  return {
    ...view,
    controller,
    onClose,
    onPresentationStateChange,
    onProfileChange,
    onScenePresentationChange,
  }
}

function storageSnapshot(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index)
      return key ? [key, window.localStorage.getItem(key) ?? ''] : null
    }).filter((entry): entry is [string, string] => entry !== null),
  )
}

function renderPteranodonEncounter(
  controller = makeController(),
) {
  const onClose = vi.fn()
  const onPresentationStateChange = vi.fn()
  const onProfileChange = vi.fn()
  const onScenePresentationChange =
    vi.fn<DirectScaleEncounterProps['onScenePresentationChange']>()
  const view = render(
    <DirectScaleEncounter
      animal={{
        atmosphere: 'air',
        backgroundLandscape: '/pteranodon-landscape.webp',
        backgroundPortrait: '/pteranodon-portrait.webp',
        id: 'pteranodon',
        name: '无齿翼龙',
        poster: '/pteranodon.webp',
        posterPortrait: '/pteranodon-portrait-model.webp',
      }}
      controller={controller as unknown as ViewerController}
      locale="zh-CN"
      onClose={onClose}
      onPresentationStateChange={onPresentationStateChange}
      onProfileChange={onProfileChange}
      onScenePresentationChange={onScenePresentationChange}
      profile={null}
    />,
  )
  return {
    ...view,
    controller,
    onClose,
    onPresentationStateChange,
    onProfileChange,
    onScenePresentationChange,
  }
}

async function waitForOverview(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'overview',
    )
  })
}

describe('DirectScaleEncounter', () => {
  beforeEach(() => {
    testAudioInstances.length = 0
    reviewCandidateMock.acquire.mockReset().mockResolvedValue({
      factory: reviewCandidateMock.factory as unknown as ScaleEncounterAvatarFactory,
      release: reviewCandidateMock.release,
      variantId: 'boy-base',
    })
    reviewCandidateMock.factory.mockReset()
    reviewCandidateMock.release.mockReset()
    reviewEnvironmentMock.acquire.mockReset().mockResolvedValue({
      panoramaWidth: 4096,
      preferredQuality: 'high',
      quality: 'medium',
      release: reviewEnvironmentMock.release,
      sourceUrl: '/review-panorama.webp',
      startPanoramaUpgrade: reviewEnvironmentMock.startPanoramaUpgrade,
      surfaceTextures: reviewEnvironmentMock.surfaceTextures,
      texture: reviewEnvironmentMock.texture,
      theme: 'air-cretaceous',
    })
    reviewEnvironmentMock.commit.mockReset()
    reviewEnvironmentMock.discard.mockReset()
    reviewEnvironmentMock.release.mockReset()
    reviewEnvironmentMock.startPanoramaUpgrade.mockReset().mockResolvedValue(null)
    vi.stubGlobal('Audio', TestAudio)
    window.localStorage.clear()
    window.localStorage.setItem('museum.locale', 'zh-CN')
    window.history.replaceState({}, '', '/museum/?animal=pteranodon')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('asks only for gender and approximate height, then starts without persisting the profile', async () => {
    const user = userEvent.setup()
    const beforeUrl = window.location.href
    const beforeStorage = storageSnapshot()
    const { controller, onProfileChange } = renderPteranodonEncounter()

    const genderGroup = screen.getByRole('group', {
      name: '小朋友是男孩还是女孩？',
    })
    const heightGroup = screen.getByRole('group', {
      name: '小朋友大约有多高？',
    })
    expect(screen.getAllByRole('group')).toEqual([genderGroup, heightGroup])
    expect(within(genderGroup).getAllByRole('radio')).toHaveLength(2)
    expect(within(heightGroup).getByRole('slider')).toHaveValue('110')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.getByText('这两项只留在当前页面，不会写入网址、账号或分析数据。'),
    ).toBeVisible()

    const start = screen.getByRole('button', { name: '进入比一比' })
    expect(start).toBeDisabled()
    await user.click(within(genderGroup).getByRole('radio', { name: /男孩/ }))
    await user.click(
      within(heightGroup).getByRole('button', { name: '身高增加 5 厘米' }),
    )
    await user.click(start)

    await waitFor(() => {
      expect(controller.beginScaleEncounter).toHaveBeenCalledWith({
        gender: 'boy',
        heightCm: 115,
      })
    })
    expect(onProfileChange).toHaveBeenCalledWith({
      gender: 'boy',
      heightCm: 115,
    })
    expect(reviewCandidateMock.acquire).toHaveBeenCalledOnce()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'overview',
    )
    expect(window.location.href).toBe(beforeUrl)
    expect(storageSnapshot()).toEqual(beforeStorage)
  })

  it('moves from the full-body view to an eye-level POV while muted and Escape returns to the overview', async () => {
    const user = userEvent.setup()
    const povTransition = deferred<void>()
    const controller = makeController()
    controller.transitionScaleEncounterView.mockImplementation((view) =>
      view === 'pov' ? povTransition.promise : Promise.resolve(),
    )
    const { onClose } = renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    expect(screen.getAllByText('俯视翼展 · 随后平视')).toHaveLength(2)

    await user.click(
      screen.getByRole('button', { name: '开关讲解员姐姐的声音' }),
    )
    expect(
      screen.getByRole('button', { name: '开关讲解员姐姐的声音' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    expect(
      await screen.findByText(
        '先从后上方看看你的翼装，像一只小飞鸟。无齿翼龙就在前面，准备好，我们来到你的眼睛这里啦。',
      ),
    ).toBeVisible()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'moving',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-view',
      'overview',
    )
    expect(screen.queryByText(/低头|下面/)).not.toBeInTheDocument()
    expect(controller.transitionScaleEncounterView).toHaveBeenCalledWith(
      'pov',
      9_638,
    )

    await act(async () => {
      povTransition.resolve()
      await povTransition.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-view',
      'pov',
    )
    expect(
      screen.getByText(
        '看，无齿翼龙就在正前方，和我们飞得一样高。它的两只大翅膀一左一右，展开得真宽！',
      ),
    ).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'overview',
      )
    })
    expect(controller.transitionScaleEncounterView).toHaveBeenLastCalledWith(
      'overview',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-view',
      'overview',
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops each active narration before skipping or returning to the overview', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-intro.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-transition.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-arrival.zh-CN'),
    )
    expect(intro?.play).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '直接进入' }))
    await waitFor(() => expect(transition?.play).toHaveBeenCalledOnce())
    expect(intro?.pause).toHaveBeenCalledOnce()
    expect(intro?.currentTime).toBe(0)

    await user.click(screen.getByRole('button', { name: '直接进入' }))
    await waitFor(() => expect(arrival?.play).toHaveBeenCalledOnce())
    expect(transition?.pause).toHaveBeenCalledOnce()
    expect(controller.finishScaleEncounterTransition).toHaveBeenCalledOnce()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'overview',
      )
    })
    expect(arrival?.pause).toHaveBeenCalledOnce()
    expect(arrival?.currentTime).toBe(0)
  })

  it('fades and then removes the guide caption after the arrival narration ends', async () => {
    const controller = makeController()
    renderPteranodonEncounter(controller)

    fireEvent.click(screen.getByRole('radio', { name: /女孩/ }))
    fireEvent.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-intro.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-transition.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-arrival.zh-CN'),
    )
    expect(intro).toBeDefined()
    expect(transition).toBeDefined()
    expect(arrival).toBeDefined()

    await act(async () => {
      intro?.dispatchEvent(new Event('ended'))
      await Promise.resolve()
    })
    expect(transition?.play).toHaveBeenCalledOnce()

    await act(async () => {
      transition?.dispatchEvent(new Event('ended'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(arrival?.play).toHaveBeenCalledOnce()

    await act(async () => {
      arrival?.dispatchEvent(new Event('ended'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'eyes',
    )
    const captionText = screen.getByText(
      '看，无齿翼龙就在正前方，和我们飞得一样高。它的两只大翅膀一左一右，展开得真宽！',
    )
    expect(captionText.closest('aside')).toHaveAttribute('data-visible', 'true')

    await act(async () => {
      vi.advanceTimersByTime(899)
      await Promise.resolve()
    })
    expect(captionText.closest('aside')).toHaveAttribute('data-visible', 'true')

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(captionText.closest('aside')).toHaveAttribute('data-visible', 'false')

    await act(async () => {
      vi.advanceTimersByTime(440)
      await Promise.resolve()
    })
    expect(screen.queryByText(captionText.textContent ?? '')).not.toBeInTheDocument()
  })

  it('keeps the arrival caption readable when mobile audio playback is rejected', async () => {
    const user = userEvent.setup()
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    renderPteranodonEncounter()

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    for (const audio of testAudioInstances) {
      audio.play.mockRejectedValueOnce(new Error('mobile-playback-rejected'))
    }
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })
    const arrival =
      '看，无齿翼龙就在正前方，和我们飞得一样高。它的两只大翅膀一左一右，展开得真宽！'
    expect(screen.getByText(arrival).closest('aside')).toHaveAttribute(
      'data-visible',
      'true',
    )
    expect(timeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      Math.min(6_500, Math.max(3_200, arrival.length * 115)),
    )
  })

  it('ignores a stale POV completion after Escape starts the reverse transition', async () => {
    const povTransition = deferred<void>()
    const controller = makeController()
    controller.transitionScaleEncounterView.mockImplementation((view) =>
      view === 'pov' ? povTransition.promise : Promise.resolve(),
    )
    renderPteranodonEncounter(controller)

    fireEvent.click(screen.getByRole('radio', { name: /男孩/ }))
    fireEvent.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    fireEvent.click(
      screen.getByRole('button', { name: '开关讲解员姐姐的声音' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'moving',
      )
    })

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'overview',
      )
    })
    expect(controller.transitionScaleEncounterView).toHaveBeenLastCalledWith(
      'overview',
    )

    await act(async () => {
      povTransition.resolve()
      await povTransition.promise
    })
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'overview',
    )
    expect(
      screen.queryByText(
        '看，无齿翼龙就在正前方，和我们飞得一样高。它的两只大翅膀一左一右，展开得真宽！',
      ),
    ).not.toBeInTheDocument()
  })

  it('keeps the forest prototype switcher out of non-forest encounters', async () => {
    const user = userEvent.setup()
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&variant=hybrid-slice',
    )
    const { controller } = renderPteranodonEncounter()

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()

    expect(screen.queryByRole('group', { name: '森林环境原型' })).not.toBeInTheDocument()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-environment',
      'baseline',
    )
    expect(controller.setScaleEncounterEnvironmentVariant).toHaveBeenCalledWith(
      'baseline',
    )
  })

  it('opens a shareable 1.25x ecology experiment through the public URL', () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=tyrannosaurus-rex&variant=production-slice&ecology-density=1.25x',
    )
    const { controller } = renderTyrannosaurusEncounter()

    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ecology-density',
      '1.25x',
    )
    expect(controller.setScaleEncounterEcologyDensity).toHaveBeenCalledWith(
      '1.25x',
    )
  })

  it('uses the approved 1.25x ecology density when the URL omits an override', () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=tyrannosaurus-rex&variant=production-slice',
    )
    const { controller } = renderTyrannosaurusEncounter()

    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ecology-density',
      '1.25x',
    )
    expect(controller.setScaleEncounterEcologyDensity).toHaveBeenCalledWith(
      '1.25x',
    )
  })

  it('switches ecology density in the running scene and keeps the choice shareable', async () => {
    const user = userEvent.setup()
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=tyrannosaurus-rex&variant=production-slice&ecology-density=current',
    )
    const { controller } = renderTyrannosaurusEncounter()

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    const switcher = screen.getByRole('group', { name: '生态密度实验' })
    await user.click(
      within(switcher).getByRole('button', { name: '切换到 1.5 倍生态密度' }),
    )

    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ecology-density',
      '1.5x',
    )
    expect(controller.setScaleEncounterEcologyDensity).toHaveBeenLastCalledWith(
      '1.5x',
    )
    expect(new URL(window.location.href).searchParams.get('ecology-density')).toBe(
      '1.5x',
    )
  })

  it('synchronizes the background scale metadata with each overview zoom step', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    const { onScenePresentationChange } =
      renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    controller.getScaleEncounterSnapshot.mockReturnValue({
      ...controller.getScaleEncounterSnapshot(),
      overviewZoom: 0.92,
    })
    await user.click(screen.getByRole('button', { name: '靠近一点' }))

    expect(controller.adjustScaleEncounterDistance).toHaveBeenLastCalledWith(1)
    const presentation = onScenePresentationChange.mock.lastCall?.[0]
    expect(presentation?.environmentVariant).toBe('baseline')
    expect(presentation?.backgroundScale).toBeCloseTo(1.28 / 0.92, 8)
  })

  it('turns a held zoom button into continuous motion without adding a release jump', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()

    const closer = screen.getByRole('button', { name: '靠近一点' })
    vi.useFakeTimers()
    fireEvent.pointerDown(closer, {
      button: 0,
      pointerId: 17,
      pointerType: 'mouse',
    })
    await act(() => vi.advanceTimersByTime(260))
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenCalledWith(1)

    fireEvent.pointerUp(closer, {
      button: 0,
      pointerId: 17,
      pointerType: 'mouse',
    })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(
      0,
    )
    fireEvent.click(closer)
    expect(controller.adjustScaleEncounterDistance).not.toHaveBeenCalled()
  })

  it('waits until gender is known, then preloads and awaits only that avatar target', async () => {
    const user = userEvent.setup()
    const candidateReady = deferred<{
      readonly factory: ScaleEncounterAvatarFactory
      readonly release: () => void
      readonly variantId: 'girl-base'
    }>()
    reviewCandidateMock.acquire.mockReturnValue(candidateReady.promise)
    const controller = makeController()
    const { onPresentationStateChange } =
      renderPteranodonEncounter(controller)

    expect(reviewCandidateMock.acquire).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await waitFor(() => expect(reviewCandidateMock.acquire).toHaveBeenCalledOnce())
    expect(reviewCandidateMock.acquire).toHaveBeenCalledWith(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
      expect.any(AbortSignal),
    )
    await user.click(screen.getByRole('button', { name: '进入比一比' }))

    expect(reviewCandidateMock.acquire).toHaveBeenCalledOnce()
    expect(reviewCandidateMock.acquire).toHaveBeenCalledWith(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
      expect.any(AbortSignal),
    )
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()
    expect(controller.setScaleEncounterAvatarFactory).not.toHaveBeenCalled()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'entering',
    )
    expect(onPresentationStateChange).toHaveBeenLastCalledWith('setup')
    expect(screen.getByText('正在准备和无齿翼龙见面…')).toBeVisible()

    candidateReady.resolve({
      factory: reviewCandidateMock.factory,
      release: reviewCandidateMock.release,
      variantId: 'girl-base',
    })
    await waitFor(() => {
      expect(controller.beginScaleEncounter).toHaveBeenCalledWith({
        gender: 'girl',
        heightCm: 110,
      })
    })

    expect(controller.setScaleEncounterAvatarFactory).toHaveBeenCalledWith(
      reviewCandidateMock.factory,
    )
    expect(
      controller.setScaleEncounterAvatarFactory.mock.invocationCallOrder[0],
    ).toBeLessThan(controller.beginScaleEncounter.mock.invocationCallOrder[0]!)
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'overview',
    )
  })

  it('releases a late old target without letting it clear or replace the newer target', async () => {
    const user = userEvent.setup()
    const boyReady = deferred<{
      readonly factory: ScaleEncounterAvatarFactory
      readonly release: () => void
      readonly variantId: 'boy-base'
    }>()
    const girlReady = deferred<{
      readonly factory: ScaleEncounterAvatarFactory
      readonly release: () => void
      readonly variantId: 'girl-base'
    }>()
    const boyFactory = vi.fn() as unknown as ScaleEncounterAvatarFactory
    const girlFactory = vi.fn() as unknown as ScaleEncounterAvatarFactory
    const releaseBoy = vi.fn()
    const releaseGirl = vi.fn()
    reviewCandidateMock.acquire.mockImplementation(
      (nextProfile: { readonly gender: 'boy' | 'girl' }) =>
        nextProfile.gender === 'boy' ? boyReady.promise : girlReady.promise,
    )
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    expect(reviewCandidateMock.acquire).toHaveBeenLastCalledWith(
      { gender: 'boy', heightCm: 110 },
      'pteranodon',
      expect.any(AbortSignal),
    )

    await user.click(screen.getByRole('button', { name: '重新设置' }))
    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    expect(reviewCandidateMock.acquire).toHaveBeenLastCalledWith(
      { gender: 'girl', heightCm: 110 },
      'pteranodon',
      expect.any(AbortSignal),
    )

    boyReady.resolve({
      factory: boyFactory,
      release: releaseBoy,
      variantId: 'boy-base',
    })
    await waitFor(() => expect(releaseBoy).toHaveBeenCalledOnce())
    expect(controller.setScaleEncounterAvatarFactory).not.toHaveBeenCalledWith(
      boyFactory,
    )
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()

    girlReady.resolve({
      factory: girlFactory,
      release: releaseGirl,
      variantId: 'girl-base',
    })
    await waitFor(() => {
      expect(controller.beginScaleEncounter).toHaveBeenCalledWith({
        gender: 'girl',
        heightCm: 110,
      })
    })
    expect(controller.setScaleEncounterAvatarFactory).toHaveBeenCalledWith(
      girlFactory,
    )
    expect(releaseGirl).not.toHaveBeenCalled()
  })

  it('releases a target that finishes after unmount without installing its factory', async () => {
    const user = userEvent.setup()
    const candidateReady = deferred<{
      readonly factory: ScaleEncounterAvatarFactory
      readonly release: () => void
      readonly variantId: 'girl-base'
    }>()
    const lateFactory = vi.fn() as unknown as ScaleEncounterAvatarFactory
    const lateRelease = vi.fn()
    reviewCandidateMock.acquire.mockReturnValue(candidateReady.promise)
    const controller = makeController()
    const view = renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await waitFor(() => expect(reviewCandidateMock.acquire).toHaveBeenCalledOnce())
    view.unmount()
    candidateReady.resolve({
      factory: lateFactory,
      release: lateRelease,
      variantId: 'girl-base',
    })

    await waitFor(() => expect(lateRelease).toHaveBeenCalledOnce())
    expect(controller.setScaleEncounterAvatarFactory).not.toHaveBeenCalledWith(
      lateFactory,
    )
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()
  })

  it('stops the encounter instead of restoring the old procedural child when the canonical base fails', async () => {
    const user = userEvent.setup()
    const error = new Error('canonical-base-offline')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reviewCandidateMock.acquire.mockRejectedValue(error)
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))

    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'error',
      )
    })
    expect(controller.setScaleEncounterAvatarFactory).toHaveBeenCalledWith(null)
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Canonical child avatar unavailable.',
      error,
    )
    expect(
      screen.getByText('这个设备暂时不能打开 3D 相遇。你可以返回展台，继续看动物模型。'),
    ).toBeVisible()
  })

  it('keeps the setup background until both rich candidates are ready, then installs the panorama before the encounter', async () => {
    const user = userEvent.setup()
    const environmentReady = deferred<{
      readonly panoramaWidth: 4096
      readonly preferredQuality: 'high'
      readonly quality: 'medium'
      readonly release: () => void
      readonly sourceUrl: string
      readonly startPanoramaUpgrade: () => Promise<null>
      readonly surfaceTextures: typeof reviewEnvironmentMock.surfaceTextures
      readonly texture: object
      readonly theme: 'air-cretaceous'
    }>()
    reviewEnvironmentMock.acquire.mockReturnValue(environmentReady.promise)
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))

    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-phase',
      'entering',
    )
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()
    expect(controller.setScaleEncounterPanoramaTexture).not.toHaveBeenCalled()

    const lease = {
      panoramaWidth: 4096 as const,
      preferredQuality: 'high' as const,
      quality: 'medium' as const,
      release: reviewEnvironmentMock.release,
      sourceUrl: '/review-panorama.webp',
      startPanoramaUpgrade: reviewEnvironmentMock.startPanoramaUpgrade,
      surfaceTextures: reviewEnvironmentMock.surfaceTextures,
      texture: reviewEnvironmentMock.texture,
      theme: 'air-cretaceous' as const,
    }
    environmentReady.resolve(lease)

    await waitForOverview()
    expect(controller.setScaleEncounterPanoramaTexture).toHaveBeenCalledWith(
      lease.texture,
      lease.surfaceTextures,
      false,
      null,
    )
    expect(
      controller.setScaleEncounterPanoramaTexture.mock.invocationCallOrder[0],
    ).toBeLessThan(controller.beginScaleEncounter.mock.invocationCallOrder[0]!)
  })

  it('shows the 4K/PBR scene first and swaps to the optional 8K panorama without a blank frame', async () => {
    const user = userEvent.setup()
    reviewEnvironmentMock.startPanoramaUpgrade.mockResolvedValue({
      commit: reviewEnvironmentMock.commit,
      discard: reviewEnvironmentMock.discard,
      panoramaWidth: 8192,
      sourceUrl: '/review-panorama-high.webp',
      texture: reviewEnvironmentMock.upgradeTexture,
    })
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    await waitFor(() => {
      expect(controller.setScaleEncounterPanoramaTexture).toHaveBeenCalledWith(
        reviewEnvironmentMock.upgradeTexture,
        reviewEnvironmentMock.surfaceTextures,
        false,
        undefined,
      )
    })

    expect(controller.setScaleEncounterPanoramaTexture.mock.calls[0]).toEqual([
      reviewEnvironmentMock.texture,
      reviewEnvironmentMock.surfaceTextures,
      false,
      null,
    ])
    expect(reviewEnvironmentMock.commit).toHaveBeenCalledOnce()
    expect(reviewEnvironmentMock.discard).not.toHaveBeenCalled()
  })

  it('falls back to the procedural environment when the panorama cannot load', async () => {
    const user = userEvent.setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    reviewEnvironmentMock.acquire.mockRejectedValue(
      new Error('panorama-offline'),
    )
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()

    expect(controller.setScaleEncounterPanoramaTexture).toHaveBeenCalledWith(
      null,
      null,
      false,
      null,
    )
    expect(controller.beginScaleEncounter).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('procedural environment fallback'),
      expect.any(Error),
    )
  })
})
