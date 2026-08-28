import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  Leaf,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pause,
  RotateCcw,
  Scaling,
  Volume2,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { NarrationController, getNarrationControlLabel } from './audio'
import {
  animalDetailIdFromPath,
  type AppPageKind,
  type InitialAppState,
} from './app-bootstrap'
import {
  AnimalCollectionSheet,
  type CollectionAnimal,
} from './components/AnimalCollectionSheet'
import { AboutDrawer } from './components/AboutDrawer'
import { GitHubStarPrompt } from './components/GitHubStarPrompt'
import { IconButton } from './components/IconButton'
import { LanguageMenu } from './components/LanguageMenu'
import {
  ParentDrawer,
  type ParentFacts,
  type ParentReviewFacts,
} from './components/ParentDrawer'
import { ResponsiveAnimalTitle } from './components/ResponsiveAnimalTitle'
import { SceneAtmosphere } from './components/SceneAtmosphere'
import { ViewerStage } from './components/ViewerStage'
import { mainAnimals } from './content/catalog'
import { animalSeoDescription } from './content/animal-seo'
import { credits } from './content/credits.generated'
import { staticAnimalDetailIds } from './content/static-animal-details'
import type { PublishedAnimalPackage } from './content/types'
import { I18nProvider, useI18n } from './i18n/I18nProvider'
import { localeFromPath, type Locale } from './i18n/locale'
import { updateLocalizedMetadata } from './i18n/metadata'
import {
  dietLabel,
  formatResearchSizeFact,
  formatSizeFact,
  messagesFor,
} from './i18n/messages'
import { localReviewAnimals } from 'virtual:local-review-catalog'
import {
  MODEL_DATA_REMINDER_STORAGE_KEY,
  NARROW_TOUCH_MEDIA_QUERY,
  formatModelSize,
  isLargeModel,
} from './model-policy'
import type { DisplayableAnimalPackage } from './review/types'
import {
  AnimalLoadCoordinator,
  IdlePreloadCoordinator,
  type AnimalLoadSnapshot,
  type AnimalLoadContext,
} from './state'
import {
  type ModelLoadProgress,
  type StagedViewerModel,
  type ViewerController,
  type ViewerFailure,
  type ViewerModelDescriptor,
} from 'virtual:viewer-controller'
import { ModelCache } from './viewer/model-cache'
import { createViewerModelDescriptor } from './viewer/create-viewer-model-descriptor'
import { selectModelPreviewProfile } from './viewer/model-preview-profiles'
import { modelPreviewFor } from './viewer/responsive-model-stills'
import {
  isScaleEncounterAnimal,
  type ChildProfile,
} from './scale-encounter/types'
import {
  readScaleEncounterProfile,
  writeScaleEncounterProfile,
} from './scale-encounter/profile-storage'
import { sceneCandidateSupportedFor } from './scale-encounter/environments/scene-candidate'
import type { ScaleEncounterEnvironmentVariant } from './viewer/scale-encounter-environment'
import { loadDirectScaleEncounter } from 'virtual:scale-encounter-entry'

/**
 * The integrated encounter remains a review prototype until its generated
 * VoiceDesign tracks pass human listening and public-distribution approval. Keep
 * those pending assets out of a normal production build while preserving the
 * complete experience in development, tests and the dedicated E2E build.
 */
const directScaleEncounterLoader = loadDirectScaleEncounter
const DIRECT_SCALE_ENCOUNTER_ENABLED = directScaleEncounterLoader !== null

let directScaleEncounterModulePromise:
  | ReturnType<NonNullable<typeof directScaleEncounterLoader>>
  | null = null

function preloadDirectScaleEncounterModule() {
  if (!directScaleEncounterLoader) return null
  if (!directScaleEncounterModulePromise) {
    const pending = directScaleEncounterLoader()
    const retryable = pending.catch((error: unknown) => {
      if (directScaleEncounterModulePromise === retryable) {
        directScaleEncounterModulePromise = null
      }
      throw error
    })
    directScaleEncounterModulePromise = retryable
  }
  return directScaleEncounterModulePromise
}

const DirectScaleEncounter = directScaleEncounterLoader
  ? lazy(async () => {
      const module = await preloadDirectScaleEncounterModule()!
      return { default: module.DirectScaleEncounter }
    })
  : null

const SCALE_ENCOUNTER_HISTORY_KEY = '__museumScaleEncounter'

function currentHistoryRecord(): Record<string, unknown> {
  const state: unknown = window.history.state
  return state !== null && typeof state === 'object'
    ? (state as Record<string, unknown>)
    : {}
}

function currentScaleEncounterHistoryToken(): string | null {
  const value = currentHistoryRecord()[SCALE_ENCOUNTER_HISTORY_KEY]
  return typeof value === 'string' ? value : null
}

interface RuntimeAnimal {
  readonly id: string
  readonly name: string
  readonly intro: string
  readonly habitat: DisplayableAnimalPackage['habitat']
  readonly atmosphere: DisplayableAnimalPackage['atmosphere']
  readonly classification: string
  readonly accent: string
  readonly accentSoft: string
  readonly narrationScript: readonly [string, string]
  readonly facts: ParentFacts
  readonly review: NonNullable<ParentFacts['review']> | null
  readonly assets: {
    readonly model: string
    readonly modelBytes: number
    readonly poster: string
    readonly posterPortrait: string
    readonly thumbnail: string
    readonly backgroundLandscape: string
    readonly backgroundPortrait: string
    readonly narration: string | null
  }
  readonly viewer: ViewerModelDescriptor
  readonly testBehavior?: {
    readonly delayMs?: number
    readonly failuresBeforeSuccess?: number
    readonly ignoreAbort?: boolean
  }
}

interface LoadedRuntimeAnimal {
  readonly animal: RuntimeAnimal
  readonly staged: StagedViewerModel
}

type ModelDataNotice =
  | { readonly kind: 'first-entry' }
  | {
      readonly animalId: string
      readonly kind: 'large-model'
      readonly modelBytes: number
    }

type ViewerFailureKind = 'context-lost' | 'webgl-unavailable'

interface ModelLoadingProgress {
  readonly animalId: string
  readonly loadedBytes: number
  readonly percent: number | null
  readonly phase: 'checking-cache' | 'downloading' | 'preparing'
  readonly requestToken: number
  readonly source: ModelLoadProgress['source'] | null
  readonly totalBytes: number
}

const LARGE_MODEL_NOTICE_DELAY_MS = 600
const MODEL_PROGRESS_STEP = 5
const NARRATION_IDLE_PRELOAD_DELAY_MS = 2_000
const staticAnimalDetailIdSet = new Set<string>(staticAnimalDetailIds)
const SCALE_ENCOUNTER_REVIEW_QUERY_KEYS = [
  'scale-encounter',
  'scene-variant',
  'flight-approximation',
  'variant',
  'ecology-density',
] as const

function hasScaleEncounterQuery(animalId: string): boolean {
  if (typeof window === 'undefined') return false
  const query = new URLSearchParams(window.location.search)
  const requested = query.get('scale-encounter')
  if (requested === '1' || requested === 'true' || requested === 'open') {
    return true
  }

  // PROTOTYPE — scene-candidate links are visual-review destinations, not
  // exhibit links. Open the shared 3D encounter automatically so sky/ocean
  // candidates behave like the dedicated mammoth and forest prototype routes.
  return (
    isScaleEncounterAnimal(animalId) &&
    sceneCandidateSupportedFor(animalId) &&
    ['A', 'B', 'C', 'D'].includes(query.get('scene-variant') ?? '')
  )
}

function animalDetailHref(
  locale: Locale,
  animalId: string,
  rootFallback: boolean,
  pageKind: AppPageKind,
): string {
  if (pageKind === 'animal-detail') {
    return `../${animalId}/`
  }
  const needsLocaleSegment =
    typeof window === 'undefined'
      ? rootFallback
      : localeFromPath(window.location.pathname) === null
  return needsLocaleSegment
    ? `./${locale}/animals/${animalId}/`
    : `./animals/${animalId}/`
}

function museumExhibitHref(locale: Locale, animalId: string): string {
  const query = new URLSearchParams({ animal: animalId })
  if (typeof window !== 'undefined') {
    const currentQuery = new URLSearchParams(window.location.search)
    for (const key of SCALE_ENCOUNTER_REVIEW_QUERY_KEYS) {
      const value = currentQuery.get(key)
      if (value !== null) query.set(key, value)
    }
  }
  return `../../../${locale}/?${query.toString()}`
}

interface WindowWithIdleCallback {
  readonly requestIdleCallback?: (
    callback: () => void,
    options?: { readonly timeout: number },
  ) => number
  readonly cancelIdleCallback?: (handle: number) => void
}

function SceneBackground({
  animal,
  onFailure,
  onReady,
  phase,
  transitionReady,
}: {
  readonly animal: RuntimeAnimal
  readonly onFailure?: (animalId: string) => void
  readonly onReady?: (animalId: string) => void
  readonly phase: 'solo' | 'incoming' | 'outgoing'
  readonly transitionReady: boolean
}) {
  return (
    <picture
      aria-hidden="true"
      className={`scene-background scene-background--${phase}${
        transitionReady ? ' scene-background--transition-ready' : ''
      }`}
    >
      <source media="(orientation: portrait)" srcSet={animal.assets.backgroundPortrait} />
      <img
        alt=""
        decoding="async"
        fetchPriority={phase === 'solo' ? 'high' : 'auto'}
        onError={() => onFailure?.(animal.id)}
        onLoad={(event) => {
          const image = event.currentTarget
          const decoded =
            typeof image.decode === 'function'
              ? image.decode()
              : Promise.resolve()
          void decoded.then(
            () => onReady?.(animal.id),
            () => onFailure?.(animal.id),
          )
        }}
        src={animal.assets.backgroundLandscape}
      />
    </picture>
  )
}

function RailThumbnail({
  priority,
  rootRef,
  src,
}: {
  readonly priority: boolean
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly src: string
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [shouldLoad, setShouldLoad] = useState(priority)
  const loadImage = priority || shouldLoad

  useEffect(() => {
    if (loadImage) {
      return
    }
    const image = imageRef.current
    const root = rootRef.current
    if (!image || !root || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      {
        root,
        rootMargin: '0px 180px',
        threshold: 0.01,
      },
    )
    observer.observe(image)
    return () => {
      observer.disconnect()
    }
  }, [loadImage, rootRef])

  return (
    <img
      alt=""
      decoding="async"
      fetchPriority="low"
      loading="lazy"
      ref={imageRef}
      src={loadImage ? src : undefined}
    />
  )
}

const publishedMainAnimals = mainAnimals.filter(
  (animal): animal is PublishedAnimalPackage => animal.status === 'published',
)
const defaultPackage = publishedMainAnimals[0]

if (!defaultPackage) {
  throw new Error('主展览集合中没有可展示的动物。')
}

function narrationUrlFor(
  animal: DisplayableAnimalPackage,
  locale: Locale,
): string | null {
  const narration = animal.assets.narration as unknown
  if (!narration || typeof narration !== 'object') {
    return null
  }
  const localeNarration = (narration as Record<string, unknown>)[locale]
  if (
    localeNarration &&
    typeof localeNarration === 'object' &&
    (localeNarration as { status?: unknown }).status === 'ready'
  ) {
    return (
      (localeNarration as { url?: string }).url ??
      (locale === 'zh-CN' ? (narration as { url?: string }).url : undefined) ??
      null
    )
  }
  // Local review packages may still be migrated one at a time. Never reuse a
  // Mandarin track in the English interface.
  if (
    locale === 'zh-CN' &&
    (narration as { status?: unknown }).status === 'ready'
  ) {
    return (narration as { url?: string }).url ?? null
  }
  return null
}

function toRuntimeAnimal(
  animal: DisplayableAnimalPackage,
  locale: Locale,
): RuntimeAnimal {
  const content =
    animal.content[locale] ??
    (animal.status === 'draft' ? animal.content['zh-CN'] : undefined)
  if (!content) {
    throw new Error(`动物 “${animal.id}” 没有可预览的 ${locale} 内容。`)
  }
  const size = formatSizeFact(content.facts.size, locale)
  const researchSize = formatResearchSizeFact(content.facts.size, locale)
  const review: ParentReviewFacts | null = animal.review
    ? {
        badge: animal.review.badge,
        checks: [...animal.review.checks],
        displayLabel:
          animal.status === 'draft'
            ? `草稿 · ${animal.review.badge}`
            : animal.review.badge,
        note: animal.review.note,
        packageStatus: animal.status,
        stateLabel: animal.status === 'draft' ? '草稿' : '已听审',
        status: animal.review.status,
      }
    : null
  const accent =
    animal.review?.accent ??
    (animal.id === 'stegosaurus'
      ? { strong: '#a85f2f', soft: '#f2d1a5' }
      : { strong: '#356859', soft: '#d9e6d8' })
  const assetCredits: ParentFacts['assetCredits'] = credits
    .filter((credit) => credit.animalId === animal.id && credit.assetKind === 'model')
    .map((credit) => ({
      attribution: credit.attribution,
      licenseName: credit.licenseName,
      licenseUrl: credit.licenseUrl,
      sourceTitle: credit.sourceTitle,
      ...('sourceUrl' in credit ? { sourceUrl: credit.sourceUrl } : {}),
    }))
  if (animal.review?.modelCredit) {
    assetCredits.push({ ...animal.review.modelCredit })
  }
  return {
    id: animal.id,
    name: content.name,
    intro: content.visibleFeature,
    habitat: animal.habitat,
    atmosphere: animal.atmosphere,
    classification: content.classificationLabel,
    accent: accent.strong,
    accentSoft: accent.soft,
    narrationScript: content.narration.sentences,
    review,
    facts: {
      animalName: content.name,
      assetCredits,
      classification: content.classificationLabel,
      classificationNote: content.parentClassificationNote,
      diet: dietLabel(content.facts.diet, locale),
      discoveryRegions: [...content.facts.discoveryRegions],
      researchSize: researchSize.value,
      researchSizeNote: researchSize.note,
      size: size.value,
      sizeLabel: size.label,
      period: content.facts.period,
      narrationScript: content.narration.sentences,
      researchReviewedOn: content.editorial.reviewedOn,
      researchUncertaintyNotes: [...content.editorial.uncertaintyNotes],
      ...(review ? { review } : {}),
      sources: content.sources.map(({ accessedOn, title, url }) => ({
        accessedOn,
        title,
        url,
      })),
    },
    assets: {
      model: animal.assets.model,
      modelBytes: animal.assets.modelBytes,
      poster: animal.assets.poster,
      posterPortrait: animal.assets.posterPortrait ?? animal.assets.poster,
      thumbnail: animal.assets.thumbnail,
      backgroundLandscape: animal.assets.backgrounds.landscape,
      backgroundPortrait: animal.assets.backgrounds.portrait,
      narration: narrationUrlFor(animal, locale),
    },
    viewer: createViewerModelDescriptor(
      animal,
      content.name,
      animal.assets.model,
      messagesFor(locale).viewer.modelLabel(content.name),
    ),
  }
}

const localReviewMode = import.meta.env.MODE === 'review'
const initialLoadSnapshot: AnimalLoadSnapshot = {
  readyAnimalId: null,
  requestedAnimalId: defaultPackage.id,
  requestToken: 0,
  phase: 'loading',
  showDelayedLabel: false,
  failure: null,
}

function readInitialAnimal(
  animals: readonly RuntimeAnimal[],
  fallback: RuntimeAnimal,
): RuntimeAnimal {
  const requestedId =
    animalDetailIdFromPath(window.location.pathname) ??
    new URLSearchParams(window.location.search).get('animal')
  return (
    animals.find((animal) => animal.id === requestedId) ??
    animals[0] ??
    fallback
  )
}

function replaceAnimalUrl(
  animalId: string,
  pageKind: AppPageKind,
): void {
  const url = new URL(window.location.href)
  if (pageKind === 'animal-detail') {
    url.searchParams.delete('animal')
  } else {
    url.searchParams.set('animal', animalId)
  }
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

function makeE2EFixtures(
  base: RuntimeAnimal,
  locale: Locale,
): RuntimeAnimal[] {
  const fixtureMessages = messagesFor(locale)
  const makeFixture = (
    id: string,
    name: string,
    intro: string,
    testBehavior: NonNullable<RuntimeAnimal['testBehavior']>,
    habitat: RuntimeAnimal['habitat'] = base.habitat,
  ): RuntimeAnimal => {
    const markAsset = (url: string) => `${url}#${id}`
    return {
      ...base,
      id,
      name,
      intro,
      habitat,
      atmosphere:
        habitat === 'water' ? 'underwater' : base.atmosphere,
      facts: {
        ...base.facts,
        classification:
          locale === 'zh-CN'
            ? `测试分类：${name}`
            : `Test classification: ${name}`,
        classificationNote:
          locale === 'zh-CN'
            ? '仅用于端到端原子切换验证。'
            : 'Used only to verify atomic exhibit switching in end-to-end tests.',
        discoveryRegions: [
          locale === 'zh-CN' ? `测试展区：${name}` : `Test region: ${name}`,
        ],
        period:
          locale === 'zh-CN' ? `测试时期：${name}` : `Test period: ${name}`,
      },
      assets: {
        ...base.assets,
        modelBytes:
          id === 'fixture-slow'
            ? 9 * 1024 * 1024
            : base.assets.modelBytes,
        backgroundLandscape: markAsset(base.assets.backgroundLandscape),
        backgroundPortrait: markAsset(base.assets.backgroundPortrait),
        poster: markAsset(base.assets.poster),
        posterPortrait: markAsset(base.assets.posterPortrait),
        thumbnail: markAsset(base.assets.thumbnail),
      },
      viewer: {
        ...base.viewer,
        accessibilityLabel: fixtureMessages.viewer.modelLabel(name),
        id,
        label: name,
        modelUrl: `${base.viewer.modelUrl}${
          base.viewer.modelUrl.includes('?') ? '&' : '?'
        }fixture=${encodeURIComponent(id)}`,
      },
      testBehavior,
    }
  }

  return [
    makeFixture(
      'fixture-slow',
      locale === 'zh-CN' ? '慢慢龙' : 'Slow test animal',
      locale === 'zh-CN'
        ? '它会慢一点来到展台，用来检查连续选择。'
        : 'It reaches the exhibit slowly so rapid selections can be checked.',
      { delayMs: 850, ignoreAbort: true },
    ),
    makeFixture(
      'fixture-fast',
      locale === 'zh-CN' ? '快快龙' : 'Fast test animal',
      locale === 'zh-CN'
        ? '它会很快来到展台，用来确认最新选择获胜。'
        : 'It reaches the exhibit quickly so the latest selection can win.',
      { delayMs: 60 },
      'water',
    ),
    makeFixture(
      'fixture-retry',
      locale === 'zh-CN' ? '再试龙' : 'Retry test animal',
      locale === 'zh-CN'
        ? '它第一次会迷路，再点一次就能来到展台。'
        : 'Its first visit fails so the retry path can be checked.',
      { delayMs: 80, failuresBeforeSuccess: 1 },
    ),
  ]
}

function waitForFixture(
  milliseconds: number,
  signal: AbortSignal,
  ignoreAbort = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    if (ignoreAbort) {
      return
    }
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('请求已取消。', 'AbortError'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

const INITIAL_PRESENTATION_MINIMUM_MS = 900
const REDUCED_MOTION_INITIAL_MINIMUM_MS = 180

function abortError(): DOMException {
  return new DOMException('请求已取消。', 'AbortError')
}

function waitForInitialMinimum(
  startedAt: number,
  signal: AbortSignal,
): Promise<void> {
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  const minimum =
    import.meta.env.MODE === 'test'
      ? 0
      : reducedMotion
        ? REDUCED_MOTION_INITIAL_MINIMUM_MS
        : INITIAL_PRESENTATION_MINIMUM_MS
  const remaining = Math.max(0, minimum - (performance.now() - startedAt))
  if (remaining === 0) {
    signal.throwIfAborted()
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, remaining)
    const handleAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    if (signal.aborted) {
      handleAbort()
      return
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function preloadImageAsset(
  url: string,
  signal?: AbortSignal,
  priority: RequestPriority = 'auto',
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let settled = false

    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', handleAbort)
    }
    const finish = (
      result: { readonly image: HTMLImageElement } | { readonly error: Error },
    ) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if ('image' in result) {
        resolve(result.image)
      } else {
        reject(result.error)
      }
    }
    const handleAbort = () => {
      image.src = ''
      finish({ error: abortError() })
    }

    image.decoding = 'async'
    image.fetchPriority = priority
    image.onload = () => {
      const decoded: Promise<void> =
        typeof image.decode === 'function'
          ? image.decode()
          : Promise.resolve()
      void decoded.then(
        () => finish({ image }),
        () => finish({ error: new Error(`场景图片解码失败：${url}`) }),
      )
    }
    image.onerror = () => {
      finish({ error: new Error(`场景图片加载失败：${url}`) })
    }
    if (signal?.aborted) {
      handleAbort()
      return
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    image.src = url
  })
}

function readE2EFixturesEnabled(): boolean {
  if (import.meta.env.MODE !== 'e2e' || typeof window === 'undefined') {
    return false
  }
  return new URLSearchParams(window.location.search).get('fixtures') === '1'
}

function MuseumApp({
  initialAnimalId,
  initialPageKind,
  rootFallback = false,
}: {
  readonly initialAnimalId?: string
  readonly initialPageKind?: AppPageKind
  readonly rootFallback?: boolean
}) {
  const { locale, messages } = useI18n()
  const e2eFixturesEnabled = useMemo(() => readE2EFixturesEnabled(), [])
  const productionAnimals = useMemo(
    () => publishedMainAnimals.map((animal) => toRuntimeAnimal(animal, locale)),
    [locale],
  )
  const defaultAnimal =
    productionAnimals[0] ?? toRuntimeAnimal(defaultPackage!, locale)
  const applicationAnimals = useMemo(
    () =>
      localReviewMode
        ? localReviewAnimals.map((animal) => toRuntimeAnimal(animal, locale))
        : productionAnimals,
    [locale, productionAnimals],
  )
  const e2eFixtureAnimals = useMemo(
    () =>
      import.meta.env.MODE === 'e2e'
        ? makeE2EFixtures(defaultAnimal, locale)
        : [],
    [defaultAnimal, locale],
  )
  const animals = useMemo(
    () =>
      e2eFixturesEnabled
        ? [...productionAnimals, ...e2eFixtureAnimals]
        : applicationAnimals,
    [applicationAnimals, e2eFixtureAnimals, e2eFixturesEnabled, productionAnimals],
  )
  const animalIndex = useMemo(
    () => new Map(animals.map((animal) => [animal.id, animal])),
    [animals],
  )
  const inferredDetailAnimalId = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : animalDetailIdFromPath(window.location.pathname),
    [],
  )
  const resolvedInitialPageKind =
    initialPageKind ?? (inferredDetailAnimalId ? 'animal-detail' : 'museum')
  const requestedInitialAnimalId = initialAnimalId ?? inferredDetailAnimalId
  const initialAnimal = useMemo(
    () =>
      (requestedInitialAnimalId
        ? animals.find(
            (animal) => animal.id === requestedInitialAnimalId,
          )
        : undefined) ?? readInitialAnimal(animals, defaultAnimal),
    [animals, defaultAnimal, requestedInitialAnimalId],
  )
  const modelCache = useMemo(() => new ModelCache(), [])
  const [idlePreloadTargets] = useState(() =>
      animals.map((animal) => ({
        id: animal.id,
        imageUrls: () => {
          const portrait = window.matchMedia('(orientation: portrait)').matches
          const previewProfile = selectModelPreviewProfile(
            (media) => window.matchMedia(media).matches,
          )
          const preview = modelPreviewFor(
            animal.id,
            previewProfile.fileName,
          )
          return [
            portrait
              ? animal.assets.backgroundPortrait
              : animal.assets.backgroundLandscape,
            preview ??
              (previewProfile.height > previewProfile.width
                ? animal.assets.posterPortrait
                : animal.assets.poster),
          ]
        },
        modelUrl: animal.assets.model,
      })),
  )

  const viewerControllerRef = useRef<ViewerController | null>(null)
  const coordinatorRef = useRef<AnimalLoadCoordinator<LoadedRuntimeAnimal> | null>(null)
  const idlePreloadCoordinatorRef = useRef<IdlePreloadCoordinator | null>(null)
  const attemptsRef = useRef(new Map<string, number>())
  const activeAnimalRef = useRef(initialAnimal)
  const animalIndexRef = useRef(animalIndex)
  const messagesRef = useRef(messages)
  const liveMessageLocaleRef = useRef(locale)
  const pageKindRef = useRef<AppPageKind>(resolvedInitialPageKind)
  const detailAnimalIdRef = useRef(
    resolvedInitialPageKind === 'animal-detail' ? initialAnimal.id : null,
  )
  useLayoutEffect(() => {
    animalIndexRef.current = animalIndex
  }, [animalIndex])
  useLayoutEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const backgroundTimerRef = useRef<number | null>(null)
  const visibleBackgroundRef = useRef(initialAnimal)
  const initialPresentationPendingRef = useRef(true)
  const preloadedImagesRef = useRef(new Map<string, HTMLImageElement>())
  const focusPointerRef = useRef<{
    readonly pointerId: number
    readonly startedAt: number
    readonly x: number
    readonly y: number
  } | null>(null)
  const modelDataNoticeTimerRef = useRef<number | null>(null)
  const largeModelNoticeDelayTimerRef = useRef<number | null>(null)
  const networkTransferRequestTokenRef = useRef<number | null>(null)
  const modelDataNoticeKindRef =
    useRef<ModelDataNotice['kind'] | null>(null)
  const modelDataNoticeLifecycleRef = useRef(0)
  const narrationLifecycleRef = useRef(0)
  const lastReportedModelProgressRef = useRef('')
  const requestTokenRef = useRef(0)
  const viewerRequiresRemountRef = useRef(false)
  const drawerTriggerRef = useRef<HTMLButtonElement>(null)
  const collectionTriggerRef = useRef<HTMLElement>(null)
  const aboutTriggerRef = useRef<HTMLButtonElement>(null)
  const scaleEncounterTriggerRef = useRef<HTMLButtonElement>(null)
  const scaleEncounterPreloadRef = useRef<{
    readonly abort: AbortController
    readonly key: string
    readonly promise: Promise<void>
  } | null>(null)
  const scaleEncounterHistoryTokenRef = useRef<string | null>(null)
  const scaleEncounterHistoryBackPendingRef = useRef(false)
  const focusTriggerRef = useRef<HTMLButtonElement>(null)
  const focusExitRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const narrationScriptId = useId()
  const [viewerController, setViewerController] = useState<ViewerController | null>(null)
  const [viewerRetryKey, setViewerRetryKey] = useState(0)
  const [activeAnimalId, setActiveAnimalId] = useState(initialAnimal.id)
  const [pageKind, setPageKind] = useState<AppPageKind>(
    resolvedInitialPageKind,
  )
  useLayoutEffect(() => {
    pageKindRef.current = pageKind
  }, [pageKind])
  const [outgoingAnimal, setOutgoingAnimal] = useState<RuntimeAnimal | null>(null)
  const [backgroundTransitionReady, setBackgroundTransitionReady] =
    useState(false)
  const [loadSnapshot, setLoadSnapshot] = useState<AnimalLoadSnapshot>(() => ({
    ...initialLoadSnapshot,
    requestedAnimalId: initialAnimal.id,
  }))
  const [modelReady, setModelReady] = useState(false)
  const [modelLoadingProgress, setModelLoadingProgress] =
    useState<ModelLoadingProgress | null>(null)
  const [viewerFailure, setViewerFailure] =
    useState<ViewerFailureKind | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [scaleEncounterOpen, setScaleEncounterOpen] = useState(false)
  const [scaleEncounterPhase, setScaleEncounterPhase] = useState<
    'setup' | 'active' | 'transition'
  >('setup')
  const [scaleEncounterProfile, setScaleEncounterProfile] =
    useState<ChildProfile | null>(() => readScaleEncounterProfile())
  const [scaleEncounterScenePresentation, setScaleEncounterScenePresentation] =
    useState<{
      readonly backgroundScale: number
      readonly environmentVariant: ScaleEncounterEnvironmentVariant
    }>({ backgroundScale: 1.28, environmentVariant: 'baseline' })
  const [scaleEncounterHistoryBackPending, setScaleEncounterHistoryBackPending] =
    useState(false)
  const [modelDataNotice, setModelDataNotice] =
    useState<ModelDataNotice | null>(null)
  const [liveMessage, setLiveMessage] = useState(
    messages.loading.initialExhibit(initialAnimal.name),
  )
  const initialQueryAppliedRef = useRef(false)
  const scaleEncounterQueryAppliedRef = useRef(false)

  const narration = useMemo(() => new NarrationController(), [])
  const narrationSnapshot = useSyncExternalStore(
    narration.subscribe,
    narration.getSnapshot,
    narration.getServerSnapshot,
  )
  const activeAnimal = animalIndex.get(activeAnimalId) ?? initialAnimal
  useEffect(() => {
    activeAnimalRef.current = activeAnimal
  }, [activeAnimal])
  useEffect(() => {
    if (
      pageKindRef.current === 'animal-detail' ||
      !initialAnimalId ||
      initialQueryAppliedRef.current
    ) {
      return
    }
    const requestedAnimalId = new URLSearchParams(window.location.search).get(
      'animal',
    )
    const requestedAnimal = requestedAnimalId
      ? animalIndex.get(requestedAnimalId)
      : undefined
    if (!requestedAnimal || requestedAnimal.id === initialAnimalId) {
      return
    }

    // Static prerenders have to use one deterministic animal so hydration can
    // match byte-for-byte. Apply a deep-link selection immediately after that
    // first render, before the viewer coordinator starts its initial request.
    queueMicrotask(() => {
      if (initialQueryAppliedRef.current) {
        return
      }
      initialQueryAppliedRef.current = true
      activeAnimalRef.current = requestedAnimal
      visibleBackgroundRef.current = requestedAnimal
      setActiveAnimalId(requestedAnimal.id)
      setLiveMessage(messages.loading.initialExhibit(requestedAnimal.name))
    })
  }, [animalIndex, initialAnimalId, messages.loading])
  const overlayOpen =
    drawerOpen || collectionOpen || aboutOpen || scaleEncounterOpen
  const collectionAnimals = useMemo<CollectionAnimal[]>(
    () =>
      animals.map((animal) => ({
        classification: animal.classification,
        id: animal.id,
        name: animal.name,
        thumbnail: animal.assets.thumbnail,
      })),
    [animals],
  )

  useEffect(() => {
    const animalDetail =
      pageKind === 'animal-detail'
        ? {
            description: animalSeoDescription(activeAnimal.narrationScript),
            id: activeAnimal.id,
            name: activeAnimal.name,
          }
        : undefined
    updateLocalizedMetadata({
      locale,
      documentTitle: animalDetail
        ? `${activeAnimal.name} | ${messages.museumName}`
        : messages.documentTitle,
      museumTitle: messages.museumName,
      creatorBrand: messages.creatorBrand,
      description: messages.seo.description(animals.length),
      socialImageAlt: messages.seo.socialImageAlt,
      ...(animalDetail ? { animalDetail } : {}),
    })
  }, [activeAnimal.id, activeAnimal.name, activeAnimal.narrationScript, animals.length, locale, messages, pageKind])

  useEffect(() => {
    viewerController?.setAccessibilityLabel(
      activeAnimal.viewer.accessibilityLabel ??
        messages.viewer.modelLabel(activeAnimal.name),
    )
  }, [activeAnimal.name, activeAnimal.viewer.accessibilityLabel, messages, viewerController])

  const dismissModelDataNotice = useCallback(() => {
    if (modelDataNoticeTimerRef.current !== null) {
      window.clearTimeout(modelDataNoticeTimerRef.current)
      modelDataNoticeTimerRef.current = null
    }
    modelDataNoticeKindRef.current = null
    setModelDataNotice(null)
  }, [])

  const presentModelDataNotice = useCallback((notice: ModelDataNotice) => {
    if (modelDataNoticeTimerRef.current !== null) {
      window.clearTimeout(modelDataNoticeTimerRef.current)
    }
    modelDataNoticeKindRef.current = notice.kind
    setModelDataNotice(notice)
    modelDataNoticeTimerRef.current = window.setTimeout(() => {
      modelDataNoticeTimerRef.current = null
      modelDataNoticeKindRef.current = null
      setModelDataNotice(null)
    }, notice.kind === 'first-entry' ? 8_000 : 5_500)
  }, [])

  const clearLargeModelNotice = useCallback(() => {
    if (largeModelNoticeDelayTimerRef.current !== null) {
      window.clearTimeout(largeModelNoticeDelayTimerRef.current)
      largeModelNoticeDelayTimerRef.current = null
    }
    networkTransferRequestTokenRef.current = null
    if (modelDataNoticeKindRef.current === 'large-model') {
      dismissModelDataNotice()
    }
  }, [dismissModelDataNotice])

  const scheduleLargeModelNotice = useCallback(
    (animal: RuntimeAnimal, requestToken: number) => {
      if (
        !isLargeModel(animal.assets.modelBytes) ||
        modelDataNoticeKindRef.current === 'first-entry'
      ) {
        return
      }
      if (networkTransferRequestTokenRef.current === requestToken) {
        return
      }
      networkTransferRequestTokenRef.current = requestToken
      largeModelNoticeDelayTimerRef.current = window.setTimeout(() => {
        largeModelNoticeDelayTimerRef.current = null
        const snapshot = coordinatorRef.current?.getSnapshot()
        if (
          networkTransferRequestTokenRef.current !== requestToken ||
          snapshot?.phase !== 'loading' ||
          snapshot.requestToken !== requestToken ||
          modelDataNoticeKindRef.current === 'first-entry'
        ) {
          return
        }
        presentModelDataNotice({
          animalId: animal.id,
          kind: 'large-model',
          modelBytes: animal.assets.modelBytes,
        })
      }, LARGE_MODEL_NOTICE_DELAY_MS)
    },
    [presentModelDataNotice],
  )

  useEffect(() => {
    const lifecycle = ++narrationLifecycleRef.current
    return () => {
      queueMicrotask(() => {
        // StrictMode immediately mounts the effect again; only the final
        // lifecycle should release the shared controller after unmount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (narrationLifecycleRef.current === lifecycle) {
          narration.destroy()
        }
      })
    }
  }, [narration])

  useEffect(() => {
    const lifecycle = ++modelDataNoticeLifecycleRef.current
    return () => {
      queueMicrotask(() => {
        // React StrictMode immediately starts the next lifecycle. Only clear
        // the timer after the final unmount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (modelDataNoticeLifecycleRef.current === lifecycle) {
          if (modelDataNoticeTimerRef.current !== null) {
            window.clearTimeout(modelDataNoticeTimerRef.current)
            modelDataNoticeTimerRef.current = null
          }
          if (largeModelNoticeDelayTimerRef.current !== null) {
            window.clearTimeout(largeModelNoticeDelayTimerRef.current)
            largeModelNoticeDelayTimerRef.current = null
          }
          networkTransferRequestTokenRef.current = null
          modelDataNoticeKindRef.current = null
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!window.matchMedia(NARROW_TOUCH_MEDIA_QUERY).matches) {
      return
    }

    try {
      if (window.localStorage.getItem(MODEL_DATA_REMINDER_STORAGE_KEY)) {
        return
      }
    } catch {
      // Privacy settings may disable storage. The reminder still works for
      // this visit without blocking the museum.
    }

    const reminderTimer = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(MODEL_DATA_REMINDER_STORAGE_KEY)) {
          return
        }
        window.localStorage.setItem(MODEL_DATA_REMINDER_STORAGE_KEY, 'seen')
      } catch {
        // Keep the current visit useful when persistent storage is blocked.
      }
      presentModelDataNotice({
        kind: 'first-entry',
      })
    }, 0)

    return () => {
      window.clearTimeout(reminderTimer)
    }
  }, [presentModelDataNotice])

  useEffect(() => {
    const preloadedImages = preloadedImagesRef.current
    return () => {
      if (backgroundTimerRef.current !== null) {
        window.clearTimeout(backgroundTimerRef.current)
      }
      for (const image of preloadedImages.values()) {
        image.src = ''
      }
      preloadedImages.clear()
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        idlePreloadCoordinatorRef.current?.cancelAll()
        return
      }

      const loadCoordinator = coordinatorRef.current
      const idlePreloadCoordinator = idlePreloadCoordinatorRef.current
      const snapshot = loadCoordinator?.getSnapshot()
      if (
        idlePreloadCoordinator &&
        snapshot?.phase === 'idle' &&
        snapshot.readyAnimalId
      ) {
        idlePreloadCoordinator.scheduleAfterCommit(snapshot.readyAnimalId)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    narration.commit({
      animalId: activeAnimal.id,
      source: activeAnimal.assets.narration,
    })
  }, [activeAnimal.assets.narration, activeAnimal.id, narration])

  useEffect(() => {
    if (
      !modelReady ||
      loadSnapshot.phase !== 'idle' ||
      loadSnapshot.readyAnimalId !== activeAnimal.id ||
      narrationSnapshot.animalId !== activeAnimal.id ||
      narrationSnapshot.availability !== 'available'
    ) {
      return
    }

    const idleWindow = window as typeof window & WindowWithIdleCallback
    let delayTimer: number | null = null
    let idleHandle: number | null = null
    const cancelScheduledWork = () => {
      if (delayTimer !== null) {
        window.clearTimeout(delayTimer)
        delayTimer = null
      }
      if (idleHandle !== null) {
        idleWindow.cancelIdleCallback?.(idleHandle)
        idleHandle = null
      }
    }
    const prepareIfStillCurrent = () => {
      idleHandle = null
      const currentLoad = coordinatorRef.current?.getSnapshot()
      const currentNarration = narration.getSnapshot()
      if (
        document.visibilityState !== 'hidden' &&
        currentLoad?.phase === 'idle' &&
        currentLoad.readyAnimalId === activeAnimal.id &&
        currentNarration.animalId === activeAnimal.id
      ) {
        narration.prepare()
      }
    }
    const schedule = () => {
      cancelScheduledWork()
      if (document.visibilityState === 'hidden') {
        return
      }
      delayTimer = window.setTimeout(() => {
        delayTimer = null
        if (document.visibilityState === 'hidden') {
          return
        }
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(
            prepareIfStillCurrent,
            { timeout: 1_000 },
          )
        } else {
          prepareIfStillCurrent()
        }
      }, NARRATION_IDLE_PRELOAD_DELAY_MS)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancelScheduledWork()
      } else {
        schedule()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelScheduledWork()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    activeAnimal.id,
    loadSnapshot.phase,
    loadSnapshot.readyAnimalId,
    modelReady,
    narration,
    narrationSnapshot.animalId,
    narrationSnapshot.availability,
  ])

  const handleViewerFailure = useCallback((failure: ViewerFailure) => {
    if (failure.kind === 'animation') {
      console.warn(failure.message)
      return
    }
    if (failure.kind === 'model-load') {
      console.error(failure.message, failure.cause)
      return
    }
    setModelReady(false)
    setModelLoadingProgress(null)
    clearLargeModelNotice()
    setViewerFailure(failure.kind)
    viewerRequiresRemountRef.current =
      failure.kind === 'webgl-unavailable' || failure.kind === 'context-lost'
    const fatalViewerFailure =
      failure.kind === 'webgl-unavailable' || failure.kind === 'context-lost'
    if (failure.kind === 'context-lost') {
      coordinatorRef.current?.destroy()
      coordinatorRef.current = null
      idlePreloadCoordinatorRef.current?.destroy()
      idlePreloadCoordinatorRef.current = null
    }
    if (fatalViewerFailure) {
      setLoadSnapshot((snapshot) => ({
        ...snapshot,
        readyAnimalId: snapshot.readyAnimalId ?? activeAnimalRef.current.id,
        requestedAnimalId: activeAnimalRef.current.id,
        phase: 'idle',
        showDelayedLabel: false,
        failure: null,
      }))
    }
    setLiveMessage(
      messagesRef.current.viewerFallbackAnnouncement(
        activeAnimalRef.current.name,
      ),
    )
  }, [clearLargeModelNotice])

  const handleControllerReady = useCallback((controller: ViewerController | null) => {
    viewerControllerRef.current = controller
    setViewerController(controller)
    if (controller) {
      viewerRequiresRemountRef.current = false
      setViewerFailure(null)
    }
  }, [])

  const handleFirstFrameRendered = useCallback((animalId: string) => {
    if (animalId !== activeAnimalRef.current.id) {
      return
    }
    setModelReady(true)
  }, [])

  const handleBackgroundReady = useCallback((animalId: string) => {
    if (animalId !== activeAnimalRef.current.id) {
      return
    }
    setBackgroundTransitionReady(true)
    if (backgroundTimerRef.current !== null) {
      window.clearTimeout(backgroundTimerRef.current)
    }
    backgroundTimerRef.current = window.setTimeout(
      () => {
        backgroundTimerRef.current = null
        if (animalId !== activeAnimalRef.current.id) {
          return
        }
        visibleBackgroundRef.current = activeAnimalRef.current
        setOutgoingAnimal(null)
        setBackgroundTransitionReady(false)
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 520,
    )
  }, [])

  const handleBackgroundFailure = useCallback((animalId: string) => {
    if (animalId !== activeAnimalRef.current.id) {
      return
    }
    if (backgroundTimerRef.current !== null) {
      window.clearTimeout(backgroundTimerRef.current)
      backgroundTimerRef.current = null
    }
    setBackgroundTransitionReady(false)
    setLiveMessage(
      messagesRef.current.loading.backgroundPending(
        activeAnimalRef.current.name,
      ),
    )
  }, [])

  useEffect(() => {
    const controller = viewerController
    coordinatorRef.current?.destroy()
    coordinatorRef.current = null
    idlePreloadCoordinatorRef.current?.destroy()
    idlePreloadCoordinatorRef.current = null

    if (!controller) {
      return
    }

    const idlePreloadCoordinator = new IdlePreloadCoordinator({
      isImageInMemory: (url) => preloadedImagesRef.current.has(url),
      modelCache,
      targets: idlePreloadTargets,
    })
    idlePreloadCoordinatorRef.current = idlePreloadCoordinator

    const coordinator = new AnimalLoadCoordinator<LoadedRuntimeAnimal>({
      initialReadyAnimalId: null,
      initialRequestToken: requestTokenRef.current,
      load: async (animalId, context: AnimalLoadContext) => {
        idlePreloadCoordinator.cancelAll()
        clearLargeModelNotice()
        const animal = animalIndexRef.current.get(animalId)
        if (!animal) {
          throw new Error(`没有找到动物 ${animalId}。`)
        }
        let ignoreAbort = false
        if (import.meta.env.MODE === 'e2e') {
          const behavior = animal.testBehavior
          const attempt = (attemptsRef.current.get(animalId) ?? 0) + 1
          attemptsRef.current.set(animalId, attempt)
          if (behavior?.delayMs) {
            await waitForFixture(
              behavior.delayMs,
              context.signal,
              behavior.ignoreAbort,
            )
          }
          if (attempt <= (behavior?.failuresBeforeSuccess ?? 0)) {
            throw new Error('确定性的展台加载失败。')
          }
          ignoreAbort = behavior?.ignoreAbort ?? false
        }
        const shouldHoldInitial = initialPresentationPendingRef.current
        const startedAt = performance.now()
        const reportModelProgress = (progress: ModelLoadProgress) => {
          if (context.signal.aborted) {
            return
          }
          const totalBytes = progress.totalBytes ?? animal.assets.modelBytes
          const phase =
            progress.source !== 'network' ||
            (progress.totalBytes !== null &&
              progress.loadedBytes >= progress.totalBytes)
              ? 'preparing'
              : 'downloading'
          const rawPercent = Math.min(
            phase === 'downloading' ? 99 : 100,
            Math.floor((progress.loadedBytes / totalBytes) * 100),
          )
          const percent =
            phase === 'downloading'
              ? Math.floor(rawPercent / MODEL_PROGRESS_STEP) * MODEL_PROGRESS_STEP
              : null
          const progressKey = `${context.requestToken}:${progress.source}:${phase}:${percent ?? 'done'}`
          if (lastReportedModelProgressRef.current === progressKey) {
            return
          }
          lastReportedModelProgressRef.current = progressKey
          if (phase === 'downloading') {
            scheduleLargeModelNotice(animal, context.requestToken)
          } else if (
            networkTransferRequestTokenRef.current === context.requestToken
          ) {
            clearLargeModelNotice()
          }
          setModelLoadingProgress({
            animalId,
            loadedBytes: progress.loadedBytes,
            percent,
            phase,
            requestToken: context.requestToken,
            source: progress.source,
            totalBytes,
          })
        }
        lastReportedModelProgressRef.current = `${context.requestToken}:checking-cache`
        setModelLoadingProgress({
          animalId,
          loadedBytes: 0,
          percent: null,
          phase: 'checking-cache',
          requestToken: context.requestToken,
          source: null,
          totalBytes: animal.assets.modelBytes,
        })
        const selectedBackground = window.matchMedia(
          '(orientation: portrait)',
        ).matches
          ? animal.assets.backgroundPortrait
          : animal.assets.backgroundLandscape
        const modelPromise = controller.stageModel(
          animal.viewer,
          ignoreAbort ? undefined : context.signal,
          reportModelProgress,
        )
        const cachedBackground =
          preloadedImagesRef.current.get(selectedBackground)
        const backgroundPromise =
          import.meta.env.MODE === 'test'
            ? Promise.resolve<HTMLImageElement | null>(null)
            : cachedBackground
              ? Promise.resolve(cachedBackground)
              : preloadImageAsset(
                  selectedBackground,
                  context.signal,
                  'high',
                )
        const [modelResult, backgroundResult] = await Promise.allSettled([
          modelPromise,
          backgroundPromise,
        ])
        if (
          backgroundResult.status === 'fulfilled' &&
          backgroundResult.value
        ) {
          preloadedImagesRef.current.set(
            selectedBackground,
            backgroundResult.value,
          )
        }
        if (modelResult.status === 'rejected') {
          throw modelResult.reason
        }
        const staged = modelResult.value
        if (backgroundResult.status === 'rejected') {
          controller.disposeStagedModel(staged)
          throw backgroundResult.reason
        }

        if (shouldHoldInitial) {
          try {
            await waitForInitialMinimum(startedAt, context.signal)
          } catch (error: unknown) {
            controller.disposeStagedModel(staged)
            throw error
          }
        }
        return { animal, staged }
      },
      commit: ({ animal, staged }) => {
        const isInitialCommit = initialPresentationPendingRef.current
        const localizedAnimal = animalIndexRef.current.get(animal.id) ?? animal
        controller.commitModel(staged)
        controller.setAccessibilityLabel(
          localizedAnimal.viewer.accessibilityLabel ??
            messagesRef.current.viewer.modelLabel(localizedAnimal.name),
        )
        const previousAnimal = activeAnimalRef.current
        if (previousAnimal.id !== localizedAnimal.id) {
          if (backgroundTimerRef.current !== null) {
            window.clearTimeout(backgroundTimerRef.current)
            backgroundTimerRef.current = null
          }
          setBackgroundTransitionReady(false)
          setOutgoingAnimal(
            (current) => current ?? visibleBackgroundRef.current,
          )
        }
        initialPresentationPendingRef.current = false
        activeAnimalRef.current = localizedAnimal
        setActiveAnimalId(localizedAnimal.id)
        if (!isInitialCommit) {
          setModelLoadingProgress(null)
        }
        setViewerFailure(null)
        replaceAnimalUrl(localizedAnimal.id, pageKindRef.current)
        narration.commit({
          animalId: localizedAnimal.id,
          source: localizedAnimal.assets.narration,
        })
        idlePreloadCoordinator.scheduleAfterCommit(localizedAnimal.id)
        setLiveMessage(
          messagesRef.current.loading.arrived(localizedAnimal.name),
        )
      },
      dispose: ({ staged }) => {
        controller.disposeStagedModel(staged)
      },
      onDisposeError: (error) => {
        console.error('释放过期模型失败。', error)
      },
    })
    coordinatorRef.current = coordinator
    setLoadSnapshot(coordinator.getSnapshot())
    const unsubscribe = coordinator.subscribe(() => {
      const snapshot = coordinator.getSnapshot()
      requestTokenRef.current = Math.max(requestTokenRef.current, snapshot.requestToken)
      setLoadSnapshot(snapshot)
      if (snapshot.phase === 'failed' && snapshot.failure) {
        clearLargeModelNotice()
        setModelLoadingProgress(null)
        const failedAnimal = animalIndexRef.current.get(snapshot.failure.animalId)
        setLiveMessage(
          messagesRef.current.loading.failedRetry(
            failedAnimal?.name ?? messagesRef.current.loading.unknownAnimal,
          ),
        )
      }
    })
    void coordinator.request(activeAnimalRef.current.id)

    return () => {
      unsubscribe()
      coordinator.destroy()
      idlePreloadCoordinator.destroy()
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = null
      }
      if (idlePreloadCoordinatorRef.current === idlePreloadCoordinator) {
        idlePreloadCoordinatorRef.current = null
      }
    }
  }, [
    clearLargeModelNotice,
    idlePreloadTargets,
    modelCache,
    narration,
    scheduleLargeModelNotice,
    viewerController,
  ])

  useEffect(() => {
    if (pageKindRef.current === 'animal-detail') {
      return
    }
    const requestedAnimalId = new URLSearchParams(window.location.search).get(
      'animal',
    )
    const coordinator = coordinatorRef.current
    if (
      !requestedAnimalId ||
      !animalIndex.has(requestedAnimalId) ||
      !coordinator
    ) {
      return
    }
    const snapshot = coordinator.getSnapshot()
    if (
      snapshot.requestedAnimalId === requestedAnimalId &&
      snapshot.phase !== 'failed'
    ) {
      return
    }
    void coordinator.request(requestedAnimalId)
  }, [animalIndex, viewerController])

  useEffect(() => {
    const followRequestedAnimal =
      loadSnapshot.phase === 'loading' || loadSnapshot.phase === 'failed'
    const railAnimalId =
      followRequestedAnimal
        ? loadSnapshot.requestedAnimalId
        : loadSnapshot.readyAnimalId
    if (!railAnimalId) {
      return
    }
    const selectedCard = railRef.current?.querySelector<HTMLElement>(
      `[data-animal-id="${railAnimalId}"]`,
    )
    selectedCard?.scrollIntoView?.({
      behavior:
        followRequestedAnimal ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [
    loadSnapshot.phase,
    loadSnapshot.readyAnimalId,
    loadSnapshot.requestedAnimalId,
  ])

  const exitFocusMode = useCallback(() => {
    focusPointerRef.current = null
    viewerControllerRef.current?.setFocusMode(false)
    setFocusMode(false)
    setLiveMessage(messagesRef.current.focusExited)
    window.setTimeout(() => focusTriggerRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (focusMode) {
        event.preventDefault()
        exitFocusMode()
      } else if (collectionOpen) {
        event.preventDefault()
        setCollectionOpen(false)
      } else if (drawerOpen) {
        event.preventDefault()
        setDrawerOpen(false)
      } else if (aboutOpen) {
        event.preventDefault()
        setAboutOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [aboutOpen, collectionOpen, drawerOpen, exitFocusMode, focusMode])

  useEffect(() => {
    if (focusMode) {
      focusExitRef.current?.focus()
    }
  }, [focusMode])

  const leaveAnimalDetailRoute = useCallback(
    (animalId: string) => {
      if (pageKindRef.current !== 'animal-detail') {
        return
      }
      pageKindRef.current = 'museum'
      detailAnimalIdRef.current = null
      window.history.replaceState(
        window.history.state,
        '',
        museumExhibitHref(locale, animalId),
      )
      setPageKind('museum')
    },
    [locale],
  )

  const requestAnimal = (animalId: string) => {
    const coordinator = coordinatorRef.current
    if (!coordinator) {
      return
    }
    const snapshot = coordinator.getSnapshot()
    if (
      (snapshot.phase === 'idle' && snapshot.readyAnimalId === animalId) ||
      (snapshot.phase === 'loading' &&
        snapshot.requestedAnimalId === animalId)
    ) {
      return
    }
    if (
      pageKindRef.current === 'animal-detail' &&
      animalId !== detailAnimalIdRef.current
    ) {
      leaveAnimalDetailRoute(animalId)
    }
    idlePreloadCoordinatorRef.current?.cancelAll()
    clearLargeModelNotice()
    setLiveMessage(messages.loading.preparingExhibit)
    void coordinator.request(animalId)
  }

  const retryAnimal = () => {
    idlePreloadCoordinatorRef.current?.cancelAll()
    clearLargeModelNotice()
    setLiveMessage(messages.loading.retryingExhibit)
    const coordinator = coordinatorRef.current
    if (viewerRequiresRemountRef.current) {
      viewerRequiresRemountRef.current = false
      coordinator?.destroy()
      coordinatorRef.current = null
      setViewerFailure(null)
      setModelReady(false)
      setViewerRetryKey((retryKey) => retryKey + 1)
    } else if (coordinator?.getSnapshot().phase === 'failed') {
      setViewerFailure(null)
      void coordinator.retry()
    } else if (coordinator) {
      setViewerFailure(null)
      void coordinator?.reload(activeAnimal.id)
    } else {
      setViewerRetryKey((retryKey) => retryKey + 1)
    }
  }

  const requestAdjacentAnimal = (offset: -1 | 1) => {
    const snapshot = coordinatorRef.current?.getSnapshot()
    const anchorAnimalId =
      snapshot?.requestedAnimalId ??
      snapshot?.readyAnimalId ??
      activeAnimalRef.current.id
    const anchorIndex = Math.max(
      animals.findIndex((animal) => animal.id === anchorAnimalId),
      0,
    )
    const target =
      animals[(anchorIndex + offset + animals.length) % animals.length]
    if (target) {
      requestAnimal(target.id)
    }
  }
  const initialModelFailure =
    !modelReady && loadSnapshot.phase === 'failed'
      ? messages.loading.failed
      : viewerFailure === 'context-lost'
        ? messages.viewer.contextLost
        : viewerFailure === 'webgl-unavailable'
          ? messages.viewer.webglUnavailable
          : null
  const modelDataNoticeMessage =
    modelDataNotice?.kind === 'first-entry'
      ? messages.dataNotice.wifi
      : modelDataNotice?.kind === 'large-model'
        ? messages.dataNotice.largeModel(
            animalIndex.get(modelDataNotice.animalId)?.name ??
              messages.loading.unknownAnimal,
            formatModelSize(modelDataNotice.modelBytes),
          )
        : null

  useEffect(() => {
    if (liveMessageLocaleRef.current === locale) {
      return
    }
    liveMessageLocaleRef.current = locale
    setLiveMessage(
      viewerFailure
        ? messages.viewerFallbackAnnouncement(activeAnimal.name)
        : '',
    )
  }, [activeAnimal.name, locale, messages, viewerFailure])

  const enterFocusMode = () => {
    if (!modelReady) {
      return
    }
    viewerControllerRef.current?.setFocusMode(true)
    setFocusMode(true)
    setLiveMessage(messages.focusEntered)
  }

  const handleFocusPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (
      !focusMode ||
      !event.isPrimary ||
      (event.target instanceof Element &&
        event.target.closest('button, a') !== null)
    ) {
      focusPointerRef.current = null
      return
    }
    focusPointerRef.current = {
      pointerId: event.pointerId,
      startedAt: performance.now(),
      x: event.clientX,
      y: event.clientY,
    }
  }

  const handleFocusPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = focusPointerRef.current
    focusPointerRef.current = null
    if (
      !focusMode ||
      !start ||
      start.pointerId !== event.pointerId ||
      performance.now() - start.startedAt > 500
    ) {
      return
    }
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y,
    )
    if (distance <= 10) {
      exitFocusMode()
    }
  }

  const handleNarrationToggle = async () => {
    const result = await narration.toggle()
    if (result.status === 'playing') {
      setLiveMessage(messages.narration.playing(activeAnimalRef.current.name))
    } else if (result.status === 'paused') {
      setLiveMessage(messages.narration.paused(activeAnimalRef.current.name))
    }
  }

  const preloadScaleEncounterForIntent = useCallback(() => {
    if (
      !DIRECT_SCALE_ENCOUNTER_ENABLED ||
      !modelReady ||
      loadSnapshot.phase !== 'idle' ||
      !isScaleEncounterAnimal(activeAnimal.id) ||
      !viewerControllerRef.current
    ) {
      return
    }
    const modulePromise = preloadDirectScaleEncounterModule()
    if (!modulePromise) return
    const animalId = activeAnimal.id
    idlePreloadCoordinatorRef.current?.cancelAll()
    const maximumTextureSize =
      viewerControllerRef.current.getScaleEncounterMaximumTextureSize?.() ??
      4096
    const key = [
      animalId,
      scaleEncounterProfile?.gender ?? 'setup',
      maximumTextureSize,
    ].join(':')
    if (scaleEncounterPreloadRef.current?.key === key) return
    scaleEncounterPreloadRef.current?.abort.abort()
    const abort = new AbortController()
    const promise = modulePromise
      .then((module) =>
        module.preloadDirectScaleEncounterAssets({
          animalId,
          maximumTextureSize,
          profile: scaleEncounterProfile,
          signal: abort.signal,
        }),
      )
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          console.warn('比一比资源预热未完成，将在进入时重试。', error)
        }
      })
    scaleEncounterPreloadRef.current = { abort, key, promise }
  }, [
    activeAnimal.id,
    loadSnapshot.phase,
    modelReady,
    scaleEncounterProfile,
  ])

  useEffect(() => {
    return () => {
      scaleEncounterPreloadRef.current?.abort.abort()
      scaleEncounterPreloadRef.current = null
    }
  }, [activeAnimal.id])

  useEffect(() => {
    if (
      !DIRECT_SCALE_ENCOUNTER_ENABLED ||
      !modelReady ||
      loadSnapshot.phase !== 'idle' ||
      !isScaleEncounterAnimal(activeAnimal.id) ||
      document.visibilityState === 'hidden'
    ) {
      return
    }
    const idleWindow = window as typeof window & WindowWithIdleCallback
    let idleHandle: number | null = null
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return
      const warmModule = () => {
        idleHandle = null
        void preloadDirectScaleEncounterModule()
      }
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(warmModule, {
          timeout: 1_000,
        })
      } else {
        warmModule()
      }
    }, 2_000)
    return () => {
      window.clearTimeout(timer)
      if (idleHandle !== null) {
        idleWindow.cancelIdleCallback?.(idleHandle)
      }
    }
  }, [activeAnimal.id, loadSnapshot.phase, modelReady])

  const openScaleEncounter = useCallback(() => {
    if (
      !DIRECT_SCALE_ENCOUNTER_ENABLED ||
      scaleEncounterHistoryBackPendingRef.current ||
      !modelReady ||
      loadSnapshot.phase !== 'idle' ||
      !isScaleEncounterAnimal(activeAnimal.id) ||
      !viewerControllerRef.current
    ) {
      return
    }
    preloadScaleEncounterForIntent()
    narration.reset()
    idlePreloadCoordinatorRef.current?.cancelAll()
    setDrawerOpen(false)
    setCollectionOpen(false)
    setAboutOpen(false)
    setScaleEncounterPhase(scaleEncounterProfile ? 'active' : 'setup')
    const historyToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const historyState = currentHistoryRecord()
    window.history.pushState(
      { ...historyState, [SCALE_ENCOUNTER_HISTORY_KEY]: historyToken },
      '',
      window.location.href,
    )
    scaleEncounterHistoryTokenRef.current = historyToken
    setScaleEncounterOpen(true)
  }, [
    activeAnimal.id,
    loadSnapshot.phase,
    modelReady,
    narration,
    preloadScaleEncounterForIntent,
    scaleEncounterProfile,
  ])

  const updateScaleEncounterProfile = useCallback(
    (profile: ChildProfile | null) => {
      setScaleEncounterProfile(profile)
      writeScaleEncounterProfile(profile)
    },
    [],
  )

  useEffect(() => {
    if (
      scaleEncounterQueryAppliedRef.current ||
      !hasScaleEncounterQuery(activeAnimal.id) ||
      !DIRECT_SCALE_ENCOUNTER_ENABLED ||
      !modelReady ||
      loadSnapshot.phase !== 'idle' ||
      !isScaleEncounterAnimal(activeAnimal.id) ||
      !viewerController
    ) {
      return
    }

    scaleEncounterQueryAppliedRef.current = true
    openScaleEncounter()
  }, [
    activeAnimal.id,
    loadSnapshot.phase,
    modelReady,
    openScaleEncounter,
    viewerController,
  ])

  const finishScaleEncounterClose = useCallback(() => {
    viewerControllerRef.current?.endScaleEncounter()
    setScaleEncounterOpen(false)
    setScaleEncounterPhase('setup')
    const snapshot = coordinatorRef.current?.getSnapshot()
    if (snapshot?.phase === 'idle' && snapshot.readyAnimalId) {
      idlePreloadCoordinatorRef.current?.scheduleAfterCommit(
        snapshot.readyAnimalId,
      )
    }
    window.setTimeout(() => scaleEncounterTriggerRef.current?.focus(), 0)
  }, [])

  const closeScaleEncounter = useCallback(() => {
    const historyToken = scaleEncounterHistoryTokenRef.current
    scaleEncounterHistoryTokenRef.current = null
    finishScaleEncounterClose()
    if (
      historyToken &&
      currentScaleEncounterHistoryToken() === historyToken
    ) {
      // Keep a rapid re-open from pushing a new marker before this async Back
      // removes the old one. Otherwise the old Back can close the new session.
      scaleEncounterHistoryBackPendingRef.current = true
      setScaleEncounterHistoryBackPending(true)
      window.history.back()
    }
  }, [finishScaleEncounterClose])

  useEffect(() => {
    const handlePopState = () => {
      if (scaleEncounterHistoryBackPendingRef.current) {
        scaleEncounterHistoryBackPendingRef.current = false
        setScaleEncounterHistoryBackPending(false)
      }
      const historyToken = scaleEncounterHistoryTokenRef.current
      if (
        scaleEncounterOpen &&
        historyToken &&
        currentScaleEncounterHistoryToken() !== historyToken
      ) {
        scaleEncounterHistoryTokenRef.current = null
        finishScaleEncounterClose()
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [finishScaleEncounterClose, scaleEncounterOpen])

  const narrationLabel = getNarrationControlLabel(
    narrationSnapshot,
    messages.narration,
  )
  const narrationVisibleLabel =
    narrationSnapshot.availability === 'available'
      ? narrationSnapshot.playback === 'playing'
        ? messages.narration.pauseShort
        : messages.narration.listenShort
      : messages.narration.unavailableShort
  const hasOutgoingBackground =
    outgoingAnimal !== null && outgoingAnimal.id !== activeAnimal.id
  const initialLoading =
    !modelReady &&
    loadSnapshot.readyAnimalId === null &&
    loadSnapshot.phase === 'loading'
  const currentModelLoadingProgress =
    modelLoadingProgress?.requestToken === loadSnapshot.requestToken
      ? modelLoadingProgress
      : null
  const loadingPhase =
    currentModelLoadingProgress?.phase ??
    (loadSnapshot.phase === 'loading' ? 'checking-cache' : null)
  const loadingPercent =
    currentModelLoadingProgress?.phase === 'downloading'
      ? currentModelLoadingProgress.percent
      : null
  const interfaceStyle = {
    '--animal-accent': activeAnimal.accent,
    '--animal-accent-soft': activeAnimal.accentSoft,
    '--scale-encounter-background-scale': String(
      scaleEncounterScenePresentation.backgroundScale,
    ),
  } as CSSProperties

  return (
    <div className="museum-page">
      <main
      className={`museum-experience ${focusMode ? 'museum-experience--focus' : ''}${
        scaleEncounterOpen ? ' museum-experience--scale-encounter' : ''
      }`}
      data-atmosphere={activeAnimal.atmosphere}
      data-habitat={activeAnimal.habitat}
      data-locale={locale}
      data-page-kind={pageKind}
      data-ready-animal-id={loadSnapshot.readyAnimalId ?? ''}
      data-review-mode={localReviewMode || undefined}
      data-request-token={loadSnapshot.requestToken}
      data-requested-animal-id={loadSnapshot.requestedAnimalId ?? ''}
      data-scale-encounter-phase={
        scaleEncounterOpen ? scaleEncounterPhase : undefined
      }
      data-scale-encounter-environment={
        scaleEncounterOpen
          ? scaleEncounterScenePresentation.environmentVariant
          : undefined
      }
      id="museum-experience"
      style={interfaceStyle}
    >
      {hasOutgoingBackground ? (
        <SceneBackground
          animal={outgoingAnimal}
          key={outgoingAnimal.id}
          phase="outgoing"
          transitionReady={backgroundTransitionReady}
        />
      ) : null}
      <SceneBackground
        animal={activeAnimal}
        key={activeAnimal.id}
        onFailure={handleBackgroundFailure}
        onReady={handleBackgroundReady}
        phase={hasOutgoingBackground ? 'incoming' : 'solo'}
        transitionReady={backgroundTransitionReady}
      />
      <SceneAtmosphere
        diffuseForestLight={activeAnimal.id === 'tyrannosaurus-rex'}
        key={`atmosphere-${activeAnimal.id}`}
        kind={activeAnimal.atmosphere}
      />
      {!focusMode ? (
        <section aria-hidden={overlayOpen} className="story-panel" inert={overlayOpen}>
          <div className="story-card">
            <div className="museum-header">
              {pageKind === 'animal-detail' ? (
                <div className="museum-kicker">
                  <span className="museum-mark" aria-hidden="true">
                    <Leaf size={16} strokeWidth={2.3} />
                  </span>
                  <span>{messages.museumName}</span>
                  {localReviewMode ? (
                    <span className="review-mode-label">{messages.localReview}</span>
                  ) : null}
                </div>
              ) : (
                <h1 className="museum-kicker">
                  <span className="museum-mark" aria-hidden="true">
                    <Leaf size={16} strokeWidth={2.3} />
                  </span>
                  <span>{messages.museumName}</span>
                  {localReviewMode ? (
                    <span className="review-mode-label">{messages.localReview}</span>
                  ) : null}
                </h1>
              )}
              <button
                aria-label={messages.creatorAboutLabel}
                className="creator-signature-button"
                onClick={() => {
                  setDrawerOpen(false)
                  setCollectionOpen(false)
                  setAboutOpen(true)
                }}
                ref={aboutTriggerRef}
                type="button"
              >
                <Info aria-hidden="true" size={16} strokeWidth={2.1} />
                <span>{messages.creatorBrand}</span>
              </button>
            </div>
            <div className="title-lockup" key={`title-${activeAnimal.id}`}>
              <div className="animal-copy">
                <div className="animal-eyebrow">
                  <span>{messages.todayMeet}</span>
                  <span className="classification-chip">
                    {activeAnimal.classification}
                  </span>
                  {localReviewMode && activeAnimal.review ? (
                    <span
                      className="review-state-chip"
                      data-package-status={activeAnimal.review.packageStatus}
                    >
                      {activeAnimal.review.displayLabel}
                    </span>
                  ) : null}
                </div>
                <ResponsiveAnimalTitle
                  as={pageKind === 'animal-detail' ? 'h1' : 'h2'}
                  locale={locale}
                >
                  {activeAnimal.name}
                </ResponsiveAnimalTitle>
                <p className="child-intro">
                  <Eye aria-hidden="true" size={21} strokeWidth={2.2} />
                  <span>{activeAnimal.intro}</span>
                </p>
              </div>
            </div>
          </div>
          <div className="story-actions">
            <div className="narration-control">
              <button
                aria-label={narrationLabel}
                aria-describedby={
                  narrationSnapshot.availability === 'available'
                    ? narrationScriptId
                    : undefined
                }
                className="narration-button"
                data-playback={narrationSnapshot.playback}
                disabled={narrationSnapshot.availability !== 'available'}
                onClick={() => {
                  void handleNarrationToggle()
                }}
                type="button"
              >
                {narrationSnapshot.playback === 'playing' ? (
                  <Pause aria-hidden="true" size={22} strokeWidth={2.25} />
                ) : (
                  <Volume2 aria-hidden="true" size={22} strokeWidth={2.25} />
                )}
                <span>{narrationVisibleLabel}</span>
                {narrationSnapshot.playback === 'playing' ? (
                  <span aria-hidden="true" className="narration-wave">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </button>
              <span
                className="narration-script-popover"
                id={narrationScriptId}
                role="tooltip"
              >
                {activeAnimal.narrationScript.join(locale === 'zh-CN' ? '' : ' ')}
              </span>
            </div>
            <button
              aria-label={messages.parentInfo}
              className="parent-info-button"
              onClick={() => {
                setCollectionOpen(false)
                setAboutOpen(false)
                setDrawerOpen(true)
              }}
              ref={drawerTriggerRef}
              type="button"
            >
              <BookOpen aria-hidden="true" size={21} strokeWidth={2.1} />
              <span>{messages.parentInfoShort}</span>
            </button>
            {pageKind === 'animal-detail' ? (
              <a
                aria-label={messages.returnToMuseum}
                className="collection-open-button"
                data-museum-return=""
                href={museumExhibitHref(locale, activeAnimal.id)}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return
                  }
                  event.preventDefault()
                  leaveAnimalDetailRoute(activeAnimal.id)
                  setDrawerOpen(false)
                  setAboutOpen(false)
                  setCollectionOpen(true)
                }}
                ref={(element) => {
                  collectionTriggerRef.current = element
                }}
              >
                <LayoutGrid aria-hidden="true" size={21} strokeWidth={2.1} />
                <span>{messages.returnToMuseumShort}</span>
              </a>
            ) : (
              <button
                aria-label={messages.openCollection}
                className="collection-open-button"
                onClick={() => {
                  setDrawerOpen(false)
                  setAboutOpen(false)
                  setCollectionOpen(true)
                }}
                ref={(element) => {
                  collectionTriggerRef.current = element
                }}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={21} strokeWidth={2.1} />
                <span>{messages.collectionShort}</span>
              </button>
            )}
          </div>
        </section>
      ) : null}

      <section
        aria-hidden={overlayOpen && !focusMode}
        aria-label={messages.stageLabel(activeAnimal.name)}
        className="stage-panel"
        data-testid="model-stage"
        inert={overlayOpen && !focusMode}
        onPointerCancel={() => {
          focusPointerRef.current = null
        }}
        onPointerDownCapture={handleFocusPointerDown}
        onPointerUpCapture={handleFocusPointerUp}
      >
        <ViewerStage
          animalId={activeAnimal.id}
          failureMessage={initialModelFailure}
          initialLoading={initialLoading}
          key={`viewer-${viewerRetryKey}`}
          label={activeAnimal.name}
          loadingPhase={loadingPhase}
          loadingPercent={loadingPercent}
          modelCache={modelCache}
          modelReady={modelReady}
          onControllerReady={handleControllerReady}
          onFirstFrameRendered={handleFirstFrameRendered}
          onRetry={retryAnimal}
          onViewerFailure={handleViewerFailure}
          posterUrl={activeAnimal.assets.poster}
          posterPortraitUrl={activeAnimal.assets.posterPortrait}
        />
        {!focusMode ? (
          <div aria-hidden={overlayOpen} className="stage-actions" inert={overlayOpen}>
            <LanguageMenu />
            {DIRECT_SCALE_ENCOUNTER_ENABLED &&
            isScaleEncounterAnimal(activeAnimal.id) ? (
              <button
                aria-label={messages.scaleEncounter.openLabel(activeAnimal.name)}
                className="scale-encounter-entry"
                disabled={
                  scaleEncounterHistoryBackPending ||
                  !modelReady ||
                  loadSnapshot.phase !== 'idle'
                }
                onClick={openScaleEncounter}
                onFocus={preloadScaleEncounterForIntent}
                onPointerDown={preloadScaleEncounterForIntent}
                onPointerEnter={preloadScaleEncounterForIntent}
                ref={scaleEncounterTriggerRef}
                type="button"
              >
                <Scaling aria-hidden="true" size={20} strokeWidth={2.2} />
                <span>{messages.scaleEncounter.open}</span>
              </button>
            ) : null}
            <IconButton
              icon={RotateCcw}
              label={messages.resetView}
              onClick={() => {
                viewerControllerRef.current?.reset()
                setLiveMessage(messages.resetDone)
              }}
            />
            <IconButton
              disabled={!modelReady}
              icon={Maximize2}
              hideTooltipOnFocus
              label={messages.focusView}
              onClick={enterFocusMode}
              ref={focusTriggerRef}
            />
          </div>
        ) : (
          <>
            <p aria-hidden="true" className="focus-return-hint">
              {messages.focusReturnHint}
            </p>
            <div className="focus-actions">
              <LanguageMenu />
              <IconButton
                className="focus-exit"
                hideTooltipOnFocus
                icon={Minimize2}
                label={messages.exitFocus}
                onClick={exitFocusMode}
                ref={focusExitRef}
              />
            </div>
          </>
        )}
      </section>

      {!focusMode ? (
        <section
          aria-hidden={overlayOpen}
          aria-label={
            localReviewMode
              ? messages.reviewNavigationLabel
              : messages.navigationLabel
          }
          className={`animal-navigation ${
            animals.length === 1 ? 'animal-navigation--single' : ''
          }`}
          data-animal-count={animals.length}
          inert={overlayOpen}
        >
          <IconButton
            className="animal-step animal-step--previous"
            icon={ChevronLeft}
            label={messages.previousAnimal}
            onClick={() => requestAdjacentAnimal(-1)}
          />
          <div className="animal-rail" ref={railRef} role="list">
            {animals.map((animal) => {
              const loading =
                loadSnapshot.phase === 'loading' &&
                loadSnapshot.requestedAnimalId === animal.id
              const failed =
                loadSnapshot.phase === 'failed' &&
                loadSnapshot.requestedAnimalId === animal.id
              const selected = loadSnapshot.readyAnimalId === animal.id
              const activateAnimal = () => {
                if (failed) {
                  retryAnimal()
                } else {
                  requestAnimal(animal.id)
                }
              }
              const cardAttributes = {
                'aria-current': selected ? ('true' as const) : undefined,
                'aria-label': messages.viewAnimal(
                  animal.name,
                  localReviewMode && animal.review
                    ? animal.review.displayLabel
                    : '',
                  failed,
                ),
                className: 'animal-card',
                'data-animal-id': animal.id,
                'data-failed': failed,
                'data-loading': loading,
                'data-selected': selected,
              }
              const cardContents = (
                <>
                  <span className="thumbnail-frame">
                    <RailThumbnail
                      priority={
                        animal.id === activeAnimal.id ||
                        animal.id === loadSnapshot.requestedAnimalId
                      }
                      rootRef={railRef}
                      src={animal.assets.thumbnail}
                    />
                    {localReviewMode && animal.review ? (
                      <span
                        aria-hidden="true"
                        className="review-thumbnail-badge"
                        data-package-status={animal.review.packageStatus}
                      >
                        {animal.review.stateLabel}
                      </span>
                    ) : null}
                    {loading ? (
                      <span aria-hidden="true" className="loading-orbit" />
                    ) : null}
                  </span>
                  <strong>{animal.name}</strong>
                  {loading &&
                  !initialLoading &&
                  loadSnapshot.showDelayedLabel ? (
                    <span className="card-status">
                      {loadingPhase === 'preparing'
                        ? messages.loading.opening
                        : loadingPercent === null
                          ? messages.loading.inviting
                          : messages.loading.downloading(loadingPercent)}
                    </span>
                  ) : null}
                  {failed ? (
                    <span className="card-status">{messages.loading.retry}</span>
                  ) : null}
                  {!failed &&
                  (!loading || !loadSnapshot.showDelayedLabel) &&
                  localReviewMode &&
                  animal.review ? (
                    <span className="card-review-status">
                      {messages.localReview}
                    </span>
                  ) : null}
                </>
              )
              const detailHref = staticAnimalDetailIdSet.has(animal.id)
                ? animalDetailHref(
                    locale,
                    animal.id,
                    rootFallback,
                    pageKind,
                  )
                : null
              return (
                <div className="animal-card-slot" key={animal.id} role="listitem">
                  {detailHref ? (
                    <a
                      {...cardAttributes}
                      data-animal-detail-link=""
                      href={detailHref}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) {
                          return
                        }
                        event.preventDefault()
                        activateAnimal()
                      }}
                    >
                      {cardContents}
                    </a>
                  ) : (
                    <button
                      {...cardAttributes}
                      onClick={activateAnimal}
                      type="button"
                    >
                      {cardContents}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <IconButton
            className="animal-step animal-step--next"
            icon={ChevronRight}
            label={messages.nextAnimal}
            onClick={() => requestAdjacentAnimal(1)}
          />
        </section>
      ) : null}

      {modelDataNotice && !focusMode && !overlayOpen ? (
        <aside
          aria-atomic="true"
          aria-live="polite"
          className="model-data-notice"
          data-notice-kind={modelDataNotice.kind}
          role="status"
        >
          <span aria-hidden="true" className="model-data-notice__dot" />
          <p>{modelDataNoticeMessage}</p>
          <button
            aria-label={messages.dataNotice.dismissLabel}
            onClick={dismissModelDataNotice}
            type="button"
          >
            {messages.dataNotice.dismiss}
          </button>
        </aside>
      ) : null}

      <GitHubStarPrompt
        blocked={
          focusMode ||
          overlayOpen ||
          modelDataNotice !== null ||
          loadSnapshot.phase !== 'idle' ||
          narrationSnapshot.playback === 'playing'
        }
        start={loadSnapshot.readyAnimalId !== null}
      />

      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {liveMessage}
      </p>

      {scaleEncounterOpen &&
      DirectScaleEncounter &&
      isScaleEncounterAnimal(activeAnimal.id) &&
      viewerController ? (
        <Suspense
          fallback={
            <section
              aria-label={messages.scaleEncounter.loading}
              aria-modal="true"
              className="scale-encounter-module-loading"
              role="dialog"
            >
              <span aria-hidden="true" className="fossil-loader">
                <span className="fossil-loader__ring" />
                <Scaling size={28} strokeWidth={2} />
              </span>
              <strong>{messages.scaleEncounter.loading}</strong>
            </section>
          }
        >
          <DirectScaleEncounter
            animal={{
              atmosphere: activeAnimal.atmosphere,
              backgroundLandscape: activeAnimal.assets.backgroundLandscape,
              backgroundPortrait: activeAnimal.assets.backgroundPortrait,
              id: activeAnimal.id,
              name: activeAnimal.name,
              poster: activeAnimal.assets.poster,
              posterPortrait: activeAnimal.assets.posterPortrait,
            }}
            controller={viewerController}
            locale={locale}
            onClose={closeScaleEncounter}
            onPresentationStateChange={setScaleEncounterPhase}
            onProfileChange={updateScaleEncounterProfile}
            onScenePresentationChange={setScaleEncounterScenePresentation}
            profile={scaleEncounterProfile}
          />
        </Suspense>
      ) : null}

      <AnimalCollectionSheet
        animals={collectionAnimals}
        currentAnimalId={loadSnapshot.readyAnimalId ?? activeAnimal.id}
        loadingAnimalId={
          loadSnapshot.phase === 'loading'
            ? loadSnapshot.requestedAnimalId
            : null
        }
        loadingPhase={loadingPhase}
        loadingPercent={loadingPercent}
        onClose={() => setCollectionOpen(false)}
        onSelect={(animalId) => {
          setCollectionOpen(false)
          if (animalId !== (loadSnapshot.readyAnimalId ?? activeAnimal.id)) {
            requestAnimal(animalId)
          }
        }}
        open={collectionOpen && !focusMode}
        returnFocusTo={collectionTriggerRef}
      />
      </main>
      <ParentDrawer
        facts={activeAnimal.facts}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen && !focusMode}
        returnFocusTo={drawerTriggerRef}
        showReviewDetails={localReviewMode}
      />
      <AboutDrawer
        onClose={() => setAboutOpen(false)}
        open={aboutOpen && !focusMode}
        returnFocusTo={aboutTriggerRef}
      />
    </div>
  )
}

export function App({
  initialState,
}: {
  readonly initialState?: InitialAppState
} = {}) {
  return (
    <I18nProvider
      {...(initialState
        ? {
            initialState: {
              locale: initialState.locale,
              preference: initialState.preference,
            },
          }
        : {})}
    >
      <MuseumApp
        {...(initialState ? { initialAnimalId: initialState.animalId } : {})}
        {...(initialState ? { initialPageKind: initialState.pageKind } : {})}
        rootFallback={initialState?.rootFallback ?? false}
      />
    </I18nProvider>
  )
}
