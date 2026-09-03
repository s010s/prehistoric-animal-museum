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
import { preloadDirectScaleEncounterAssets } from '../src/scale-encounter/preload-assets'
import { scaleEncounterContentFor } from '../src/scale-encounter/content'
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

const forestPropsMock = vi.hoisted(() => ({
  load: vi.fn(),
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
  loadReviewCandidateForestProps: forestPropsMock.load,
}))

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

class TestAudio extends EventTarget {
  currentTime = 0
  loop = false
  preload = ''
  volume = 1
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
    perspective: 'child-eyes' as const,
    view: 'overview' as const,
    transitioning: false,
    distanceMeters: 15,
    orbitAngleDegrees: 0,
    overviewZoom: 1,
    error: null,
    profile: null,
    rawSpanUnits: 1,
    metersPerUnit: 1,
  }
  return {
    adjustScaleEncounterDistance: vi.fn(),
    adjustScaleEncounterOrbit: vi.fn(),
    beginScaleEncounter: vi.fn(() => true),
    endScaleEncounter: vi.fn(),
    finishScaleEncounterTransition: vi.fn(),
    getScaleEncounterMaximumTextureSize: vi.fn(() => 8192),
    getScaleEncounterSnapshot: vi.fn(() => snapshot),
    setScaleEncounterAvatarFactory: vi.fn(),
    setScaleEncounterDistanceMotion: vi.fn(),
    setScaleEncounterOrbitMotion: vi.fn(),
    setScaleEncounterEcologyDensity: vi.fn(),
    setScaleEncounterEnvironmentVariant: vi.fn(),
    setScaleEncounterForestProps: vi.fn(),
    setScaleEncounterPanoramaTexture: vi.fn(),
    setScaleEncounterPrototypeFlightApproximation: vi.fn(),
    setScaleEncounterSceneCandidateVariant: vi.fn(),
    setScaleEncounterBoost: vi.fn(() => true),
    triggerScaleEncounterJump: vi.fn(() => true),
    transitionScaleEncounterView: vi.fn<
      (view: 'overview' | 'pov', durationMs?: number) => Promise<void>
    >(() => Promise.resolve()),
    transitionScaleEncounterPerspective: vi.fn<
      (
        perspective: 'child-eyes' | 'child-rear',
        durationMs?: number,
      ) => Promise<void>
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

function renderArchaeopteryxEncounter(
  controller = makeController(),
  profile: DirectScaleEncounterProps['profile'] = null,
) {
  const onClose = vi.fn()
  const onPresentationStateChange = vi.fn()
  const onProfileChange = vi.fn()
  const onScenePresentationChange =
    vi.fn<DirectScaleEncounterProps['onScenePresentationChange']>()
  const view = render(
    <DirectScaleEncounter
      animal={{
        atmosphere: 'forest',
        backgroundLandscape: '/archaeopteryx-landscape.webp',
        backgroundPortrait: '/archaeopteryx-portrait.webp',
        id: 'archaeopteryx',
        name: '始祖鸟',
        poster: '/archaeopteryx.webp',
        posterPortrait: '/archaeopteryx-portrait-model.webp',
      }}
      controller={controller as unknown as ViewerController}
      locale="zh-CN"
      onClose={onClose}
      onPresentationStateChange={onPresentationStateChange}
      onProfileChange={onProfileChange}
      onScenePresentationChange={onScenePresentationChange}
      profile={profile}
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

function renderMosasaurusEncounter(controller = makeController()) {
  const onClose = vi.fn()
  const onPresentationStateChange = vi.fn()
  const onProfileChange = vi.fn()
  const onScenePresentationChange =
    vi.fn<DirectScaleEncounterProps['onScenePresentationChange']>()
  const view = render(
    <DirectScaleEncounter
      animal={{
        atmosphere: 'underwater',
        backgroundLandscape: '/mosasaurus-landscape.webp',
        backgroundPortrait: '/mosasaurus-portrait.webp',
        id: 'mosasaurus',
        name: '沧龙',
        poster: '/mosasaurus.webp',
        posterPortrait: '/mosasaurus-portrait-model.webp',
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

function renderMammothEncounter(controller = makeController()) {
  const onClose = vi.fn()
  const onPresentationStateChange = vi.fn()
  const onProfileChange = vi.fn()
  const onScenePresentationChange =
    vi.fn<DirectScaleEncounterProps['onScenePresentationChange']>()
  const view = render(
    <DirectScaleEncounter
      animal={{
        atmosphere: 'ice',
        backgroundLandscape: '/mammoth-landscape.webp',
        backgroundPortrait: '/mammoth-portrait.webp',
        id: 'mammoth',
        name: '长毛猛犸象',
        poster: '/mammoth.webp',
        posterPortrait: '/mammoth-portrait-model.webp',
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

function openPlaybackSettings(): HTMLElement {
  const trigger = screen.getByRole('button', {
    name: '打开声音与文字设置',
  })
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(trigger)
  }
  return screen.getByRole('group', { name: '声音与文字' })
}

function setNarrationEnabled(enabled: boolean): HTMLElement {
  const narration = within(openPlaybackSettings()).getByRole('button', {
    name: '开关讲解旁白',
  })
  if (narration.getAttribute('aria-pressed') !== String(enabled)) {
    fireEvent.click(narration)
  }
  fireEvent.click(
    screen.getByRole('button', { name: '打开声音与文字设置' }),
  )
  return narration
}

function setAmbienceEnabled(enabled: boolean): HTMLElement {
  const ambience = within(openPlaybackSettings()).getByRole('button', {
    name: '环境音乐',
  })
  if (ambience.getAttribute('aria-pressed') !== String(enabled)) {
    fireEvent.click(ambience)
  }
  fireEvent.click(
    screen.getByRole('button', { name: '打开声音与文字设置' }),
  )
  return ambience
}

describe('DirectScaleEncounter', () => {
  beforeEach(() => {
    testAudioInstances.length = 0
    reviewCandidateMock.acquire.mockReset().mockResolvedValue({
      factory: reviewCandidateMock.factory as unknown as ScaleEncounterAvatarFactory,
      release: reviewCandidateMock.release,
      variantId: 'boy-air-wingsuit',
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
    forestPropsMock.load.mockReset().mockResolvedValue(null)
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

  it('prewarms only the current environment and exact saved avatar target', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=tyrannosaurus-rex&variant=production-slice',
    )
    const abort = new AbortController()

    await preloadDirectScaleEncounterAssets({
      animalId: 'tyrannosaurus-rex',
      maximumTextureSize: 4096,
      profile: { gender: 'girl', heightCm: 115 },
      signal: abort.signal,
    })

    expect(reviewCandidateMock.acquire).toHaveBeenCalledOnce()
    expect(reviewCandidateMock.acquire).toHaveBeenCalledWith(
      { gender: 'girl', heightCm: 115 },
      'tyrannosaurus-rex',
      abort.signal,
    )
    expect(reviewEnvironmentMock.acquire).toHaveBeenCalledOnce()
    expect(reviewEnvironmentMock.acquire).toHaveBeenCalledWith(
      'tyrannosaurus-rex',
      undefined,
      4096,
      undefined,
      undefined,
      'production-slice',
    )
    expect(reviewCandidateMock.release).toHaveBeenCalledOnce()
    expect(reviewEnvironmentMock.release).toHaveBeenCalledOnce()
  })

  it('installs the scanned fallen-log prop before an Archaeopteryx encounter begins', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=archaeopteryx&variant=production-slice',
    )
    const controller = makeController()
    const scannedForestProps = { name: 'reviewed-forest-props' }
    forestPropsMock.load.mockResolvedValue(scannedForestProps)

    renderArchaeopteryxEncounter(controller, {
      gender: 'boy',
      heightCm: 100,
    })

    await waitFor(() => {
      expect(controller.beginScaleEncounter).toHaveBeenCalledWith({
        gender: 'boy',
        heightCm: 100,
      })
    })
    expect(forestPropsMock.load).toHaveBeenCalledOnce()
    expect(controller.setScaleEncounterForestProps).toHaveBeenCalledWith(
      scannedForestProps,
    )
    expect(
      controller.setScaleEncounterForestProps.mock.invocationCallOrder[0],
    ).toBeLessThan(controller.beginScaleEncounter.mock.invocationCallOrder[0]!)
  })

  it('uses the accepted D sky scene when the formal URL has no review override', async () => {
    const controller = makeController()
    renderPteranodonEncounter(controller)
    await waitFor(() => {
      expect(
        controller.setScaleEncounterSceneCandidateVariant,
      ).toHaveBeenCalledWith('D')
    })
    expect(
      controller.setScaleEncounterPrototypeFlightApproximation,
    ).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-scene-candidate',
      'D',
    )
  })

  it('uses the accepted D ocean scene when the formal URL has no review override', async () => {
    window.history.replaceState({}, '', '/museum/?animal=mosasaurus')
    const controller = makeController()
    renderMosasaurusEncounter(controller)
    await waitFor(() => {
      expect(
        controller.setScaleEncounterSceneCandidateVariant,
      ).toHaveBeenCalledWith('D')
    })
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-scene-candidate',
      'D',
    )
  })

  it('uses the accepted E mammoth scene when the formal URL has no review override', async () => {
    window.history.replaceState({}, '', '/museum/?animal=mammoth')
    const controller = makeController()
    renderMammothEncounter(controller)
    await waitFor(() => {
      expect(
        controller.setScaleEncounterSceneCandidateVariant,
      ).toHaveBeenCalledWith('E')
    })
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-scene-candidate',
      'E',
    )
  })

  it('uses the accepted T. rex forest and child-eye action on the formal URL', async () => {
    window.history.replaceState({}, '', '/museum/?animal=tyrannosaurus-rex')
    const user = userEvent.setup()
    const { controller } = renderTyrannosaurusEncounter()

    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-environment',
      'production-slice',
    )
    expect(controller.setScaleEncounterEnvironmentVariant).toHaveBeenCalledWith(
      'production-slice',
    )

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    expect(
      screen.getByRole('button', { name: '从我的眼睛看' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('group', { name: '生态密度实验' }),
    ).not.toBeInTheDocument()
  })

  it('enables the reversible sky C composition approximation only through an explicit review URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=C',
    )
    const controller = makeController()
    renderPteranodonEncounter(controller)
    await waitFor(() => {
      expect(
        controller.setScaleEncounterSceneCandidateVariant,
      ).toHaveBeenCalledWith('C')
    })
    expect(
      controller.setScaleEncounterPrototypeFlightApproximation,
    ).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-scene-candidate',
      'C',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-prototype-flight-approximation',
      'true',
    )
  })

  it('can disable the sky composition approximation without disabling the environment candidate', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=C&flight-approximation=0',
    )
    const controller = makeController()
    renderPteranodonEncounter(controller)
    await waitFor(() => {
      expect(
        controller.setScaleEncounterSceneCandidateVariant,
      ).toHaveBeenCalledWith('C')
    })
    expect(
      controller.setScaleEncounterPrototypeFlightApproximation,
    ).toHaveBeenCalledWith(false)
  })

  it('plays the reviewed imagined-flight-equipment narration in the sky candidate', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=C',
    )
    const user = userEvent.setup()
    renderPteranodonEncounter()
    setAmbienceEnabled(true)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-intro-v2.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-transition-v2.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-arrival-v2.zh-CN'),
    )
    const ambience = testAudioInstances.find((audio) =>
      audio.src.includes('scale-encounter-wandering-town-loop.ogg'),
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-avatar-narration-policy',
      'authored-flight-equipment',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-experience-layer',
      'imaginative-encounter',
    )
    expect(screen.getByText('想象相遇')).toBeVisible()
    await waitFor(() => expect(intro?.play).toHaveBeenCalledOnce())
    expect(ambience?.volume).toBeCloseTo(0.045)
    intro?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(transition?.play).toHaveBeenCalledOnce())
    expect(ambience?.volume).toBeCloseTo(0.045)
    transition?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(arrival?.play).toHaveBeenCalledOnce())
    expect(ambience?.volume).toBeCloseTo(0.045)
    arrival?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(ambience?.volume).toBeCloseTo(0.14))
  })

  it('plays the reviewed imagined-diving-equipment narration in the ocean candidate', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=mosasaurus&scene-variant=C',
    )
    const user = userEvent.setup()
    renderMosasaurusEncounter()

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('mosasaurus-intro-v2.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('mosasaurus-transition-v2.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('mosasaurus-arrival-v4.zh-CN'),
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-avatar-narration-policy',
      'authored-diving-equipment',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-experience-layer',
      'imaginative-encounter',
    )
    expect(screen.getByText('想象相遇')).toBeVisible()
    await waitFor(() => expect(intro?.play).toHaveBeenCalledOnce())
    intro?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(transition?.play).toHaveBeenCalledOnce())
    transition?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(arrival?.play).toHaveBeenCalledOnce())
  })

  it('plays all three mammoth lines without narrating internal camera movement', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=mammoth&scene-variant=C',
    )
    const user = userEvent.setup()
    renderMammothEncounter()

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-experience-layer',
      'imaginative-encounter',
    )
    expect(screen.getByText('想象相遇')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('mammoth-intro-v4.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('mammoth-transition-v6.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('mammoth-arrival-v4.zh-CN'),
    )
    await waitFor(() => expect(intro?.play).toHaveBeenCalledOnce())
    expect(
      screen.getByText(
        scaleEncounterContentFor('mammoth', 'zh-CN').copy.intro,
      ),
    ).toBeVisible()

    intro?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(transition?.play).toHaveBeenCalledOnce())
    const transitionCaption = screen.getByText(
      scaleEncounterContentFor('mammoth', 'zh-CN').copy.transition,
    )
    expect(transitionCaption).toBeVisible()
    expect(transitionCaption.textContent).not.toMatch(
      /从头到脚|绕到你身后|来到你的眼睛|长毛|长牙/,
    )

    transition?.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(arrival?.play).toHaveBeenCalledOnce())
  })

  it('hands the selected profile to the app without changing the URL', async () => {
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
    const approachGroup = screen.getByRole('group', {
      name: '想离动物多近？',
    })
    expect(screen.getAllByRole('group')).toEqual([
      genderGroup,
      heightGroup,
      approachGroup,
    ])
    expect(within(genderGroup).getAllByRole('radio')).toHaveLength(2)
    const setupPortraits = genderGroup.querySelectorAll(
      '.scale-encounter-mini-avatar img',
    )
    expect(setupPortraits).toHaveLength(2)
    expect(setupPortraits[0]).toHaveAttribute(
      'src',
      expect.stringContaining(
        '/scale-encounter/assets/avatars/boy-land-explorer.webp',
      ),
    )
    expect(setupPortraits[1]).toHaveAttribute(
      'src',
      expect.stringContaining(
        '/scale-encounter/assets/avatars/girl-land-explorer.webp',
      ),
    )
    expect(within(heightGroup).getByRole('slider')).toHaveValue('110')
    expect(
      within(approachGroup).getByRole('radio', { name: /留点距离/ }),
    ).toBeChecked()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/只留在当前页面/),
    ).not.toBeInTheDocument()

    const start = screen.getByRole('button', { name: '进入比一比' })
    expect(start).toBeDisabled()
    await user.click(within(genderGroup).getByRole('radio', { name: /男孩/ }))
    await user.click(
      within(heightGroup).getByRole('button', { name: '身高增加 5 厘米' }),
    )
    await user.click(
      within(approachGroup).getByRole('radio', { name: /靠近观察/ }),
    )
    await user.click(start)

    await waitFor(() => {
      expect(controller.beginScaleEncounter).toHaveBeenCalledWith({
        approach: 'close',
        gender: 'boy',
        heightCm: 115,
      })
    })
    expect(onProfileChange).toHaveBeenCalledWith({
      approach: 'close',
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

  it('keeps compact sound, text and exhibit exit controls available during setup', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPteranodonEncounter()

    const trigger = screen.getByRole('button', {
      name: '打开声音与文字设置',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('group', { name: '声音与文字' }),
    ).not.toBeInTheDocument()

    await user.click(trigger)
    const panel = screen.getByRole('group', { name: '声音与文字' })
    const narration = within(panel).getByRole('button', {
      name: '开关讲解旁白',
    })
    const ambience = within(panel).getByRole('button', { name: '环境音乐' })
    const captions = within(panel).getByRole('button', { name: '开关旁白文字' })
    expect(narration).toHaveAttribute('aria-pressed', 'true')
    expect(ambience).toHaveAttribute('aria-pressed', 'false')
    expect(captions).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '重新设置' })).not.toBeInTheDocument()

    await user.click(captions)
    expect(captions).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '返回展台' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps pastoral ambience off by default and controls it separately from narration', async () => {
    const user = userEvent.setup()
    renderPteranodonEncounter()

    const ambience = testAudioInstances.find((audio) =>
      audio.src.includes('scale-encounter-wandering-town-loop.ogg'),
    )
    expect(ambience).toBeDefined()
    expect(ambience?.loop).toBe(true)
    expect(ambience?.volume).toBeCloseTo(0.14)
    expect(ambience?.play).not.toHaveBeenCalled()
    expect(testAudioInstances.length).toBeGreaterThanOrEqual(6)
    for (const audio of testAudioInstances) {
      expect(audio.preload).toBe('none')
      expect(audio.load).not.toHaveBeenCalled()
    }
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ambience',
      'off',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-narration',
      'on',
    )

    const panel = openPlaybackSettings()
    const narration = within(panel).getByRole('button', {
      name: '开关讲解旁白',
    })
    const music = within(panel).getByRole('button', { name: '环境音乐' })
    await user.click(music)
    expect(ambience?.play).toHaveBeenCalledOnce()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ambience',
      'on',
    )
    expect(narration).toHaveAttribute('aria-pressed', 'true')

    await user.click(music)
    expect(ambience?.pause).toHaveBeenCalled()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-ambience',
      'off',
    )
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-narration',
      'on',
    )
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
    expect(screen.getAllByText('空中相遇')).toHaveLength(2)

    expect(setNarrationEnabled(false)).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    expect(
      await screen.findByText(
        scaleEncounterContentFor('pteranodon', 'zh-CN').copy.transition,
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
      scaleEncounterContentFor('pteranodon', 'zh-CN').transitionDurationMs,
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
        scaleEncounterContentFor('pteranodon', 'zh-CN').copy.arrival,
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

  it('switches both ways between the child-eye and behind-child viewpoints', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })

    const viewpoint = screen.getByRole('group', { name: '观察视角' })
    expect(
      within(viewpoint).getByRole('button', { name: '眼睛视角' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(
      within(viewpoint).getByRole('button', { name: '身后视角' }),
    )
    await waitFor(() => {
      expect(controller.transitionScaleEncounterPerspective).toHaveBeenCalledWith(
        'child-rear',
        1_600,
      )
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-perspective',
        'child-rear',
      )
    })

    await user.click(screen.getByRole('button', { name: '眼睛视角' }))
    await waitFor(() => {
      expect(controller.transitionScaleEncounterPerspective).toHaveBeenLastCalledWith(
        'child-eyes',
        1_600,
      )
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-perspective',
        'child-eyes',
      )
    })
  })

  it('plays the matching guide line when the viewpoint changes', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByRole('group', { name: '观察视角' })).toBeVisible()
    })
    setNarrationEnabled(true)

    await user.click(screen.getByRole('button', { name: '身后视角' }))
    const rearAudio = testAudioInstances.find((audio) =>
      audio.src.includes('view-switch-to-rear-v4.zh-CN'),
    )
    expect(rearAudio?.play).toHaveBeenCalledOnce()
    expect(
      screen.getByText(
        '想看看自己刚才在什么位置吗？我们到你身后看一眼。你还可以向左或向右移动，换个方向再看看动物。',
      ),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '眼睛视角' }))
    const eyesAudio = testAudioInstances.find((audio) =>
      audio.src.includes('view-switch-to-eyes-v4.zh-CN'),
    )
    expect(rearAudio?.pause).toHaveBeenCalledOnce()
    expect(eyesAudio?.play).toHaveBeenCalledOnce()
    expect(
      screen.getByText(
        scaleEncounterContentFor('pteranodon', 'zh-CN').copy.toChildEyes,
      ),
    ).toBeVisible()
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
      audio.src.includes('pteranodon-intro-v2.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-transition-v2.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-arrival-v2.zh-CN'),
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
      audio.src.includes('pteranodon-intro-v2.zh-CN'),
    )
    const transition = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-transition-v2.zh-CN'),
    )
    const arrival = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-arrival-v2.zh-CN'),
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
      scaleEncounterContentFor('pteranodon', 'zh-CN').copy.arrival,
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
    const arrival = scaleEncounterContentFor('pteranodon', 'zh-CN').copy.arrival
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
    setNarrationEnabled(false)
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
        scaleEncounterContentFor('pteranodon', 'zh-CN').copy.arrival,
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

  it('moves only while arrow or WASD keys are held in the child POV and stops on release', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()

    expect(
      screen.queryByRole('button', { name: '向左绕着动物看' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '向右绕着动物看' }),
    ).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(controller.adjustScaleEncounterOrbit).not.toHaveBeenCalled()
    expect(controller.setScaleEncounterOrbitMotion).not.toHaveBeenCalledWith(-1)
    expect(controller.setScaleEncounterOrbitMotion).not.toHaveBeenCalledWith(1)

    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })

    const left = screen.getByRole('button', {
      name: '向左绕着动物看',
    })
    const right = screen.getByRole('button', {
      name: '向右绕着动物看',
    })
    expect(left).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft A')
    expect(right).toHaveAttribute('aria-keyshortcuts', 'ArrowRight D')
    expect(screen.getByRole('button', { name: '退后一点' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowDown S',
    )
    expect(screen.getByRole('button', { name: '靠近一点' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp W',
    )
    controller.setScaleEncounterOrbitMotion.mockClear()
    controller.setScaleEncounterDistanceMotion.mockClear()

    await user.click(left)
    await user.click(right)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(-1)
    fireEvent.keyDown(document, { key: 'ArrowLeft', repeat: true })
    expect(
      controller.setScaleEncounterOrbitMotion.mock.calls.filter(
        ([direction]) => direction === -1,
      ),
    ).toHaveLength(1)
    fireEvent.keyUp(document, { key: 'ArrowLeft' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(1)
    fireEvent.keyUp(document, { key: 'ArrowUp' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(-1)
    fireEvent.keyUp(document, { key: 'ArrowDown' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(document, { code: 'KeyA', key: 'a' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(-1)
    fireEvent.keyUp(document, { code: 'KeyA', key: 'a' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(document, { code: 'KeyD', key: 'D' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(1)
    fireEvent.keyUp(document, { code: 'KeyD', key: 'D' })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(document, { code: 'KeyS', key: 's' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(-1)
    fireEvent.keyUp(document, { code: 'KeyS', key: 's' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(document, { code: 'KeyW', key: 'w' })
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(1)
    fireEvent.keyUp(document, { code: 'KeyW', key: 'w' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(1)
    fireEvent.keyUp(document, { key: 'ArrowUp' })
    expect(controller.setScaleEncounterDistanceMotion).toHaveBeenLastCalledWith(0)

    expect(controller.adjustScaleEncounterOrbit.mock.calls).toEqual([
      [-1],
      [1],
    ])
  })

  it('uses Space and the touch action button for a one-shot land jump', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderTyrannosaurusEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /男孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })

    const jump = screen.getByRole('button', { name: '跳一下' })
    expect(jump).toHaveAttribute('aria-keyshortcuts', 'Space')
    fireEvent.keyDown(document, { code: 'Space', key: ' ' })
    fireEvent.keyDown(document, { code: 'Space', key: ' ', repeat: true })
    expect(controller.triggerScaleEncounterJump).toHaveBeenCalledOnce()

    await user.click(jump)
    expect(controller.triggerScaleEncounterJump).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByRole('button', { name: '靠近一点' }), {
      code: 'Space',
      key: ' ',
    })
    expect(controller.triggerScaleEncounterJump).toHaveBeenCalledTimes(2)
  })

  it('holds Space or the touch action button to boost only in air and water', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })

    const boost = screen.getByRole('button', { name: '按住加速' })
    expect(boost).toHaveAttribute('aria-keyshortcuts', 'Space')
    fireEvent.keyDown(document, { code: 'Space', key: ' ' })
    expect(controller.setScaleEncounterBoost).toHaveBeenLastCalledWith(true)
    expect(boost).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(document, { code: 'Space', key: ' ' })
    expect(controller.setScaleEncounterBoost).toHaveBeenLastCalledWith(false)
    expect(boost).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(boost, {
      button: 0,
      pointerId: 31,
      pointerType: 'touch',
    })
    expect(controller.setScaleEncounterBoost).toHaveBeenLastCalledWith(true)
    fireEvent.pointerUp(boost, {
      button: 0,
      pointerId: 31,
      pointerType: 'touch',
    })
    expect(controller.setScaleEncounterBoost).toHaveBeenLastCalledWith(false)
  })

  it('hides and restores narration text without stopping the voice track', async () => {
    const user = userEvent.setup()
    renderPteranodonEncounter()

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))

    const intro = testAudioInstances.find((audio) =>
      audio.src.includes('pteranodon-intro-v2.zh-CN'),
    )
    const introText = scaleEncounterContentFor('pteranodon', 'zh-CN').copy.intro
    expect(intro?.play).toHaveBeenCalledOnce()
    expect(screen.getByText(introText)).toBeVisible()

    const captions = within(openPlaybackSettings()).getByRole('button', {
      name: '开关旁白文字',
    })
    expect(captions).toHaveAttribute('aria-pressed', 'true')
    await user.click(captions)
    expect(captions).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(introText)).not.toBeInTheDocument()
    expect(intro?.pause).not.toHaveBeenCalled()
    expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
      'data-captions',
      'off',
    )

    await user.click(captions)
    expect(captions).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(introText)).toBeVisible()
    expect(intro?.play).toHaveBeenCalledOnce()
  })

  it('turns a held orbit button into continuous circling without a release step', async () => {
    const user = userEvent.setup()
    const controller = makeController()
    renderPteranodonEncounter(controller)

    await user.click(screen.getByRole('radio', { name: /女孩/ }))
    await user.click(screen.getByRole('button', { name: '进入比一比' }))
    await waitForOverview()

    expect(
      screen.queryByRole('button', { name: '向右绕着动物看' }),
    ).not.toBeInTheDocument()
    setNarrationEnabled(false)
    await user.click(screen.getByRole('button', { name: '从我的眼睛看' }))
    await waitFor(() => {
      expect(screen.getByTestId('scale-encounter')).toHaveAttribute(
        'data-phase',
        'eyes',
      )
    })

    const right = screen.getByRole('button', {
      name: '向右绕着动物看',
    })
    vi.useFakeTimers()
    fireEvent.pointerDown(right, {
      button: 0,
      pointerId: 23,
      pointerType: 'touch',
    })
    await act(() => vi.advanceTimersByTime(260))
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenCalledWith(1)

    fireEvent.pointerUp(right, {
      button: 0,
      pointerId: 23,
      pointerType: 'touch',
    })
    expect(controller.setScaleEncounterOrbitMotion).toHaveBeenLastCalledWith(0)
    fireEvent.click(right)
    expect(controller.adjustScaleEncounterOrbit).not.toHaveBeenCalled()
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
      readonly variantId: 'girl-air-wingsuit'
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
      variantId: 'girl-air-wingsuit',
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
      readonly variantId: 'boy-air-wingsuit'
    }>()
    const girlReady = deferred<{
      readonly factory: ScaleEncounterAvatarFactory
      readonly release: () => void
      readonly variantId: 'girl-air-wingsuit'
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
      variantId: 'boy-air-wingsuit',
    })
    await waitFor(() => expect(releaseBoy).toHaveBeenCalledOnce())
    expect(controller.setScaleEncounterAvatarFactory).not.toHaveBeenCalledWith(
      boyFactory,
    )
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()

    girlReady.resolve({
      factory: girlFactory,
      release: releaseGirl,
      variantId: 'girl-air-wingsuit',
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
      readonly variantId: 'girl-air-wingsuit'
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
      variantId: 'girl-air-wingsuit',
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
      screen.getByText(
        scaleEncounterContentFor('pteranodon', 'zh-CN').copy.unavailable,
      ),
    ).toBeVisible()
  })

  it('keeps the setup background until both rich candidates are ready, then installs the panorama before the encounter', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=off',
    )
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
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=off',
    )
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

  it('keeps the current exhibit covered instead of revealing an incomplete environment', async () => {
    window.history.replaceState(
      {},
      '',
      '/museum/?animal=pteranodon&scene-variant=off',
    )
    const user = userEvent.setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    reviewEnvironmentMock.acquire.mockRejectedValue(
      new Error('panorama-offline'),
    )
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

    expect(controller.setScaleEncounterPanoramaTexture).toHaveBeenCalledWith(null)
    expect(controller.beginScaleEncounter).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('keeping the current exhibit covered'),
      expect.any(Error),
    )
  })
})
