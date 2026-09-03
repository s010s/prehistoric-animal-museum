import {
  ArrowLeft,
  ArrowUp,
  Captions,
  CaptionsOff,
  ChevronLeft,
  ChevronRight,
  Eye,
  Minus,
  Music2,
  PersonStanding,
  Plus,
  RotateCcw,
  Scaling,
  Settings2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { Group } from 'three'
import type { AtmosphereKind } from '../content/types'
import type { Locale } from '../i18n/locale'
import type { ViewerController } from '../viewer/ViewerController'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  type ScaleEncounterPerspective,
} from '../viewer/scale-encounter'
import {
  parseScaleEncounterEcologyDensity,
  type ScaleEncounterEcologyDensity,
} from '../viewer/scale-encounter-ecology-density'
import {
  type ScaleEncounterEnvironmentVariant,
} from '../viewer/scale-encounter-environment'
import {
  scaleEncounterContentFor,
  type ChildProfile,
  type GuidedLineKind,
  type ScaleEncounterAnimalId,
} from './content'
import { EnvironmentPrototypeSwitcher } from './EnvironmentPrototypeSwitcher'
import { EcologyDensitySwitcher } from './EcologyDensitySwitcher'
import { SceneCandidatePrototypeSwitcher } from './SceneCandidatePrototypeSwitcher'
import type { ReviewCandidateAvatarLease } from './avatar-review-candidate'
import type { ReviewCandidateEnvironmentLease } from './environment-review-candidate'
import { scaleEncounterEnvironmentThemePlanFor } from './environment-theme-registry'
import {
  sceneCandidateSupportedFor,
  type ScaleEncounterSceneCandidateVariant,
} from './environments/scene-candidate'
import {
  initialScaleEncounterEnvironmentVariant,
  initialScaleEncounterSceneCandidateVariant,
  isScaleEncounterAssetAbortError,
  loadReviewCandidateAvatarLease,
  loadReviewCandidateEnvironmentLease,
  shouldPreloadScaleEncounterRichAssets,
} from './review-asset-loading'

type ExperiencePhase =
  | 'setup'
  | 'entering'
  | 'overview'
  | 'intro'
  | 'moving'
  | 'arrival'
  | 'eyes'
  | 'switching'
  | 'returning'
  | 'error'

export interface DirectScaleEncounterAnimal {
  readonly atmosphere: AtmosphereKind
  readonly backgroundLandscape: string
  readonly backgroundPortrait: string
  readonly id: ScaleEncounterAnimalId
  readonly name: string
  readonly poster: string
  readonly posterPortrait: string
}

export interface DirectScaleEncounterProps {
  readonly animal: DirectScaleEncounterAnimal
  readonly controller: ViewerController
  readonly locale: Locale
  readonly onClose: () => void
  readonly onPresentationStateChange: (
    state: 'setup' | 'active' | 'transition',
  ) => void
  readonly onProfileChange: (profile: ChildProfile | null) => void
  readonly onScenePresentationChange: (presentation: {
    readonly backgroundScale: number
    readonly environmentVariant: ScaleEncounterEnvironmentVariant
  }) => void
  readonly profile: ChildProfile | null
}

interface PointerButtonHold {
  readonly direction: -1 | 1
  engaged: boolean
  readonly pointerId: number
  timer: number
}

type MovementKey =
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'KeyA'
  | 'KeyD'
  | 'KeyS'
  | 'KeyW'

function movementKeyForEvent(event: KeyboardEvent): MovementKey | null {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
      return event.key
  }
  switch (event.code) {
    case 'KeyA':
    case 'KeyD':
    case 'KeyS':
    case 'KeyW':
      return event.code
  }
  switch (event.key.toLowerCase()) {
    case 'a':
      return 'KeyA'
    case 'd':
      return 'KeyD'
    case 's':
      return 'KeyS'
    case 'w':
      return 'KeyW'
    default:
      return null
  }
}

const DISTANCE_BUTTON_HOLD_DELAY_MS = 260
const AMBIENT_AUDIO_URL = new URL(
  './audio/scale-encounter-wandering-town-loop.ogg',
  import.meta.url,
).href
const AMBIENT_VOLUME = 0.14
const AMBIENT_DUCKED_VOLUME = 0.045

function startPreparedAmbientAudio(
  audio: HTMLAudioElement,
  volume: number,
): Promise<void> {
  audio.volume = volume
  audio.preload = 'auto'
  audio.load()
  return audio.play()
}

const SETUP_AVATAR_PORTRAITS = {
  boy: new URL('./assets/avatars/boy-land-explorer.webp', import.meta.url).href,
  girl: new URL('./assets/avatars/girl-land-explorer.webp', import.meta.url).href,
} as const

function keyboardTargetOwnsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.closest('button, input, select, textarea, [contenteditable="true"]') !==
      null
  )
}

function avatarTargetKey(
  profile: ChildProfile,
  animalId: ScaleEncounterAnimalId,
): string {
  // Height still scales one canonical base. The animal remains part of the
  // lease target because its equipment and physically reviewed pose differ.
  return `${profile.gender}:${animalId}`
}

async function loadReviewCandidateForestProps(): Promise<Group | null> {
  const candidate = await import('./forest-props-review-candidate')
  return candidate.loadReviewCandidateForestProps()
}

async function loadReviewCandidateForestEcology(): Promise<Group | null> {
  const candidate = await import('./forest-ecology-review-candidate')
  return candidate.loadReviewCandidateForestEcology()
}

function isPovPhase(phase: ExperiencePhase): boolean {
  return (
    phase === 'arrival' ||
    phase === 'eyes' ||
    phase === 'switching' ||
    phase === 'returning'
  )
}

function isTransitionPhase(phase: ExperiencePhase): boolean {
  return (
    phase === 'intro' ||
    phase === 'moving' ||
    phase === 'switching' ||
    phase === 'returning'
  )
}

function defaultPerspectiveForAnimal(): ScaleEncounterPerspective {
  return 'child-eyes'
}

function initialEcologyDensity(
  animalId: ScaleEncounterAnimalId,
): ScaleEncounterEcologyDensity {
  if (
    import.meta.env.MODE === 'production' ||
    typeof window === 'undefined' ||
    SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme !== 'forest'
  ) {
    return 'current'
  }
  return parseScaleEncounterEcologyDensity(
    new URLSearchParams(window.location.search).get('ecology-density'),
  )
}

function environmentReviewControlsRequested(): boolean {
  if (
    import.meta.env.MODE === 'production' ||
    typeof window === 'undefined'
  ) return false
  const search = new URLSearchParams(window.location.search)
  return (
    search.get('review-controls') === '1' ||
    search.has('variant') ||
    search.has('scene-variant') ||
    search.has('ecology-density')
  )
}

function initialPrototypeFlightApproximation(
  animalId: ScaleEncounterAnimalId,
  sceneCandidateVariant: ScaleEncounterSceneCandidateVariant,
): boolean {
  if (
    import.meta.env.MODE === 'production' ||
    typeof window === 'undefined' ||
    SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme !== 'sky' ||
    sceneCandidateVariant === 'off'
  ) {
    return false
  }
  return new URLSearchParams(window.location.search).get(
    'flight-approximation',
  ) !== '0'
}

function flatBackgroundScale(overviewZoom: number): number {
  return Math.min(1.58, Math.max(1.06, 1.28 / overviewZoom))
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(settle, milliseconds)
    function settle() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', settle)
      resolve()
    }
    signal.addEventListener('abort', settle, { once: true })
  })
}

export function DirectScaleEncounter({
  animal,
  controller,
  locale,
  onClose,
  onPresentationStateChange,
  onProfileChange,
  onScenePresentationChange,
  profile,
}: DirectScaleEncounterProps) {
  const content = useMemo(
    () => scaleEncounterContentFor(animal.id, locale),
    [animal.id, locale],
  )
  const environmentThemePlan = useMemo(() => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS[animal.id]
    return scaleEncounterEnvironmentThemePlanFor(
      animal.id,
      definition.environmentTheme,
    )
  }, [animal.id])
  const requiresProceduralLandBiome =
    environmentThemePlan.runtime.runtimeKind === 'procedural-biome'
  const [phase, setPhase] = useState<ExperiencePhase>(
    profile ? 'entering' : 'setup',
  )
  const [selectedGender, setSelectedGender] = useState<
    ChildProfile['gender'] | null
  >(profile?.gender ?? null)
  const [heightCm, setHeightCm] = useState(profile?.heightCm ?? 110)
  const [approach, setApproach] = useState<NonNullable<ChildProfile['approach']>>(
    profile?.approach ?? 'comfortable',
  )
  const [voiceEnabled, setVoiceEnabled] = useState(
    content.narrationAvailable,
  )
  const [ambientEnabled, setAmbientEnabled] = useState(false)
  const [captionsEnabled, setCaptionsEnabled] = useState(true)
  const [playbackMenuOpen, setPlaybackMenuOpen] = useState(false)
  const [boostActive, setBoostActive] = useState(false)
  const [activePerspective, setActivePerspective] =
    useState<ScaleEncounterPerspective>(() =>
      defaultPerspectiveForAnimal(),
    )
  const [caption, setCaption] = useState<string | null>(null)
  const [captionVisible, setCaptionVisible] = useState(false)
  const [environmentVariant, setEnvironmentVariant] =
    useState<ScaleEncounterEnvironmentVariant>(() =>
      initialScaleEncounterEnvironmentVariant(animal.id),
    )
  const [ecologyDensity, setEcologyDensity] = useState<ScaleEncounterEcologyDensity>(() =>
    initialEcologyDensity(animal.id),
  )
  const [sceneCandidateVariant, setSceneCandidateVariant] =
    useState<ScaleEncounterSceneCandidateVariant>(() =>
      initialScaleEncounterSceneCandidateVariant(animal.id),
    )
  const [prototypeFlightApproximation] = useState(() =>
    initialPrototypeFlightApproximation(
      animal.id,
      sceneCandidateVariant,
    ),
  )
  const [reviewControlsVisible] = useState(
    environmentReviewControlsRequested,
  )
  const [failure, setFailure] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const playbackSettingsRef = useRef<HTMLDivElement>(null)
  const setupTitleRef = useRef<HTMLHeadingElement>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const contextActionRef = useRef<HTMLButtonElement>(null)
  const contextActionPointerRef = useRef<number | null>(null)
  const suppressContextActionClickRef = useRef(false)
  const startedRef = useRef(false)
  const sequenceRef = useRef<AbortController | null>(null)
  const audioBankRef = useRef(new Map<GuidedLineKind, HTMLAudioElement>())
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null)
  const settleLineRef = useRef<(() => void) | null>(null)
  const voiceEnabledRef = useRef(voiceEnabled)
  const ambientEnabledRef = useRef(ambientEnabled)
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistanceRef = useRef<number | null>(null)
  const distanceButtonHoldRef = useRef<PointerButtonHold | null>(null)
  const suppressDistanceClickRef = useRef(false)
  const orbitButtonHoldRef = useRef<PointerButtonHold | null>(null)
  const suppressOrbitClickRef = useRef(false)
  const heldMovementKeysRef = useRef(new Set<MovementKey>())
  const contextActionHeldRef = useRef(false)
  const mountedRef = useRef(false)
  const beginTokenRef = useRef(0)
  const beginningRef = useRef(false)
  const avatarLoadGenerationRef = useRef(0)
  const candidateLeaseRef = useRef<ReviewCandidateAvatarLease | null>(null)
  const candidateLeaseTargetRef = useRef<string | null>(null)
  const candidateLoadRef = useRef<Promise<ReviewCandidateAvatarLease | null> | null>(null)
  const candidateLoadAbortRef = useRef<AbortController | null>(null)
  const candidateLoadTargetRef = useRef<string | null>(null)
  const candidateLoadTokenRef = useRef(0)
  const candidateUnavailableTargetsRef = useRef(new Set<string>())
  const environmentLeaseRef =
    useRef<ReviewCandidateEnvironmentLease | null>(null)
  const environmentLoadRef =
    useRef<Promise<ReviewCandidateEnvironmentLease | null> | null>(null)
  const environmentLoadRefGeneration = useRef(-1)
  const environmentUnavailableRef = useRef(false)
  const forestPropsLoadRef = useRef<Promise<Group | null> | null>(null)
  const forestEcologyLoadRef = useRef<Promise<Group | null> | null>(null)

  const setPresentationState = useCallback(
    (nextPhase: ExperiencePhase) => {
      setPhase(nextPhase)
      onPresentationStateChange(
        nextPhase === 'setup' ||
          nextPhase === 'entering' ||
          nextPhase === 'error'
          ? 'setup'
          : isTransitionPhase(nextPhase)
            ? 'transition'
            : 'active',
      )
    },
    [onPresentationStateChange],
  )

  const syncScenePresentation = useCallback(() => {
    const snapshot = controller.getScaleEncounterSnapshot()
    onScenePresentationChange({
      backgroundScale: flatBackgroundScale(snapshot.overviewZoom),
      environmentVariant,
    })
  }, [controller, environmentVariant, onScenePresentationChange])

  useEffect(
    () => controller.subscribeScaleEncounter(syncScenePresentation),
    [controller, syncScenePresentation],
  )

  useEffect(
    () =>
      controller.subscribeScaleEncounter(() => {
        const snapshot = controller.getScaleEncounterSnapshot()
        if (
          snapshot.active &&
          snapshot.view === 'pov' &&
          !snapshot.transitioning
        ) {
          setActivePerspective(snapshot.perspective)
        }
      }),
    [controller],
  )

  useEffect(() => {
    let cancelled = false
    controller.setScaleEncounterSceneCandidateVariant(
      sceneCandidateVariant,
    )
    controller.setScaleEncounterPrototypeFlightApproximation(
      prototypeFlightApproximation,
    )
    controller.setScaleEncounterEcologyDensity(ecologyDensity)
    controller.setScaleEncounterEnvironmentVariant(environmentVariant)
    const shouldLoadReviewForestProps =
      environmentVariant !== 'baseline' &&
      (animal.id === 'tyrannosaurus-rex' || animal.id === 'archaeopteryx')
    if (shouldLoadReviewForestProps) {
      const productionEcology =
        animal.id === 'tyrannosaurus-rex' &&
        environmentVariant === 'production-slice'
      const request = productionEcology
        ? (forestEcologyLoadRef.current ??=
            loadReviewCandidateForestEcology())
        : (forestPropsLoadRef.current ??= loadReviewCandidateForestProps())
      void request
        .then((forestProps) => {
          if (
            !cancelled &&
            mountedRef.current &&
            forestProps
          ) {
            controller.setScaleEncounterForestProps?.(forestProps)
          }
          return forestProps
        })
        .catch((error: unknown) => {
          console.warn(
            'Real forest prop candidate unavailable; keeping reviewed fallback props.',
            error,
          )
          return null
        })
    }
    syncScenePresentation()
    return () => {
      cancelled = true
    }
  }, [
    animal.id,
    controller,
    ecologyDensity,
    environmentVariant,
    prototypeFlightApproximation,
    sceneCandidateVariant,
    syncScenePresentation,
  ])

  const restoreAmbientVolume = useCallback(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = AMBIENT_VOLUME
    }
  }, [])

  const playAmbientAudio = useCallback(() => {
    if (!ambientEnabledRef.current) return
    let audio = ambientAudioRef.current
    if (!audio) {
      audio = new Audio()
      audio.preload = 'none'
      audio.src = AMBIENT_AUDIO_URL
      audio.loop = true
      audio.volume = AMBIENT_VOLUME
      ambientAudioRef.current = audio
    }
    void startPreparedAmbientAudio(
      audio,
      activeAudioRef.current ? AMBIENT_DUCKED_VOLUME : AMBIENT_VOLUME,
    ).catch(() => {
      // The explicit music toggle is already a user gesture. If playback is
      // still rejected, turning music off and on again provides a safe retry.
    })
  }, [])

  const stopActiveAudio = useCallback(() => {
    const audio = activeAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      activeAudioRef.current = null
    }
    settleLineRef.current?.()
    settleLineRef.current = null
    restoreAmbientVolume()
  }, [restoreAmbientVolume])

  const cancelSequence = useCallback(() => {
    // Stop the element before aborting. The abort listener settles the active
    // line synchronously and clears its ref, so reversing this order would let
    // the old narration keep playing under the next view or line.
    stopActiveAudio()
    sequenceRef.current?.abort()
    sequenceRef.current = null
  }, [stopActiveAudio])

  const releaseCandidateLease = useCallback((markUnavailable = false) => {
    const target = candidateLeaseTargetRef.current
    candidateLeaseRef.current?.release()
    candidateLeaseRef.current = null
    candidateLeaseTargetRef.current = null
    if (markUnavailable && target) {
      candidateUnavailableTargetsRef.current.add(target)
    }
  }, [])

  const invalidateCandidateAvatar = useCallback(() => {
    candidateLoadTokenRef.current += 1
    candidateLoadAbortRef.current?.abort()
    candidateLoadAbortRef.current = null
    candidateLoadRef.current = null
    candidateLoadTargetRef.current = null
    releaseCandidateLease()
  }, [releaseCandidateLease])

  const ensureReviewCandidateAvatar = useCallback((
    nextProfile: ChildProfile,
  ): Promise<ReviewCandidateAvatarLease | null> => {
    const target = avatarTargetKey(nextProfile, animal.id)
    if (candidateUnavailableTargetsRef.current.has(target)) {
      return Promise.resolve(null)
    }
    const currentLease = candidateLeaseRef.current
    if (currentLease && candidateLeaseTargetRef.current === target) {
      return Promise.resolve(currentLease)
    }
    if (currentLease) releaseCandidateLease()

    const generation = avatarLoadGenerationRef.current
    const pending = candidateLoadRef.current
    if (pending && candidateLoadTargetRef.current === target) {
      return pending
    }

    const requestToken = candidateLoadTokenRef.current + 1
    candidateLoadTokenRef.current = requestToken
    candidateLoadAbortRef.current?.abort()
    const loadAbort = new AbortController()
    candidateLoadAbortRef.current = loadAbort
    const next = loadReviewCandidateAvatarLease(
      nextProfile,
      animal.id,
      loadAbort.signal,
    )
      .then((lease) => {
        if (!lease) return null
        if (
          !mountedRef.current ||
          avatarLoadGenerationRef.current !== generation ||
          candidateLoadTokenRef.current !== requestToken ||
          candidateLoadTargetRef.current !== target
        ) {
          lease.release()
          return null
        }
        candidateLeaseRef.current = lease
        candidateLeaseTargetRef.current = target
        return lease
      })
      .catch((error: unknown) => {
        if (
          !isScaleEncounterAssetAbortError(error) &&
          mountedRef.current &&
          avatarLoadGenerationRef.current === generation &&
          candidateLoadTokenRef.current === requestToken
        ) {
          candidateUnavailableTargetsRef.current.add(target)
          console.error('Canonical child avatar unavailable.', error)
        }
        return null
      })
      .finally(() => {
        if (
          candidateLoadTokenRef.current === requestToken &&
          candidateLoadRef.current === next
        ) {
          candidateLoadRef.current = null
          candidateLoadTargetRef.current = null
          if (candidateLoadAbortRef.current === loadAbort) {
            candidateLoadAbortRef.current = null
          }
        }
      })
    candidateLoadRef.current = next
    candidateLoadTargetRef.current = target
    return next
  }, [animal.id, releaseCandidateLease])

  const releaseEnvironmentLease = useCallback((markUnavailable = false) => {
    environmentLeaseRef.current?.release()
    environmentLeaseRef.current = null
    if (markUnavailable) environmentUnavailableRef.current = true
  }, [])

  const ensureReviewCandidateEnvironment = useCallback((): Promise<ReviewCandidateEnvironmentLease | null> => {
    if (
      environmentUnavailableRef.current ||
      sceneCandidateVariant !== 'off'
    ) {
      return Promise.resolve(null)
    }
    const currentLease = environmentLeaseRef.current
    if (currentLease) return Promise.resolve(currentLease)

    const generation = avatarLoadGenerationRef.current
    const pending = environmentLoadRef.current
    if (
      pending &&
      environmentLoadRefGeneration.current === generation
    ) {
      return pending
    }

    const maximumTextureSize =
      controller.getScaleEncounterMaximumTextureSize?.() ?? 4096
    const next = loadReviewCandidateEnvironmentLease(
      animal.id,
      maximumTextureSize,
      environmentVariant,
    )
      .then((lease) => {
        if (!lease) return null
        if (
          !mountedRef.current ||
          avatarLoadGenerationRef.current !== generation
        ) {
          lease.release()
          return null
        }
        environmentLeaseRef.current = lease
        return lease
      })
      .catch((error: unknown) => {
        if (
          mountedRef.current &&
          avatarLoadGenerationRef.current === generation
        ) {
          environmentUnavailableRef.current = true
          console.warn(
            'Prepared encounter environment unavailable; keeping the current exhibit covered.',
            error,
          )
        }
        return null
      })
      .finally(() => {
        if (environmentLoadRefGeneration.current === generation) {
          environmentLoadRef.current = null
          environmentLoadRefGeneration.current = -1
        }
      })
    environmentLoadRef.current = next
    environmentLoadRefGeneration.current = generation
    return next
  }, [
    animal.id,
    controller,
    environmentVariant,
    sceneCandidateVariant,
  ])

  const beginEncounter = useCallback(
    async (nextProfile: ChildProfile): Promise<boolean> => {
      if (beginningRef.current) return false
      const beginToken = beginTokenRef.current + 1
      beginTokenRef.current = beginToken
      beginningRef.current = true
      setPresentationState('entering')
      setFailure(null)
      setCaption(content.copy.loading(animal.name))
      setCaptionVisible(true)
      const delayedCaptionTimer = window.setTimeout(() => {
        if (
          mountedRef.current &&
          beginTokenRef.current === beginToken &&
          beginningRef.current
        ) {
          setCaption(content.copy.loadingDelayed(animal.name))
        }
      }, 2_200)

      try {
        const archaeopteryxForestProps =
          animal.id === 'archaeopteryx' &&
          environmentVariant !== 'baseline'
            ? (forestPropsLoadRef.current ??=
                loadReviewCandidateForestProps().catch((error: unknown) => {
                  forestPropsLoadRef.current = null
                  console.warn(
                    'Scanned Archaeopteryx perch unavailable; keeping the natural-form fallback.',
                    error,
                  )
                  return null
                }))
            : Promise.resolve(null)
        const [candidateLease, environmentLease, encounterForestProps] =
          await Promise.all([
            ensureReviewCandidateAvatar(nextProfile),
            ensureReviewCandidateEnvironment(),
            archaeopteryxForestProps,
          ])
        if (
          !mountedRef.current ||
          beginTokenRef.current !== beginToken
        ) {
          candidateLease?.release()
          environmentLease?.release()
          return false
        }
        const requiresPreparedEnvironment =
          requiresProceduralLandBiome || sceneCandidateVariant === 'off'
        if (
          !candidateLease ||
          (requiresPreparedEnvironment && !environmentLease)
        ) {
          controller.setScaleEncounterAvatarFactory(null)
          releaseCandidateLease(Boolean(!candidateLease))
          releaseEnvironmentLease()
          setCaption(null)
          setCaptionVisible(false)
          controller.setScaleEncounterPanoramaTexture(null)
          setFailure(content.copy.unavailable)
          setPresentationState('error')
          return false
        }
        controller.setScaleEncounterAvatarFactory(candidateLease.factory)
        controller.setScaleEncounterForestProps?.(
          environmentLease?.sceneProps ?? encounterForestProps,
        )
        if (environmentLease?.preparedLandBiome) {
          controller.setScaleEncounterPanoramaTexture(
            environmentLease.texture,
            environmentLease.surfaceTextures,
            false,
            environmentLease.matureTreeAtlas,
            environmentLease.preparedLandBiome,
          )
        } else {
          controller.setScaleEncounterPanoramaTexture(
            environmentLease?.texture ?? null,
            environmentLease?.surfaceTextures ?? null,
            false,
            environmentLease?.matureTreeAtlas ?? null,
          )
        }
        controller.setScaleEncounterEnvironmentVariant(environmentVariant)
        const began = controller.beginScaleEncounter(nextProfile)
        if (!began) {
          releaseCandidateLease(true)
          releaseEnvironmentLease()
          setCaption(null)
          setCaptionVisible(false)
          controller.setScaleEncounterPanoramaTexture(null)
          setFailure(content.copy.unavailable)
          setPresentationState('error')
          return false
        }
        startedRef.current = true
        setActivePerspective(defaultPerspectiveForAnimal())
        setCaption(null)
        setCaptionVisible(false)
        setPresentationState('overview')
        if (environmentLease && import.meta.env.MODE !== 'development') {
          // The first usable frame already has the 4K/mobile-appropriate
          // panorama and PBR near field.  Only then request the optional 8K
          // desktop dome; replacing it is a prepared scene swap with no blank
          // frame, and the page cache prevents a same-page refetch.
          void environmentLease
            .startPanoramaUpgrade()
            .then((upgrade) => {
              if (
                upgrade &&
                mountedRef.current &&
                startedRef.current &&
                beginTokenRef.current === beginToken &&
                environmentLeaseRef.current === environmentLease
              ) {
                controller.setScaleEncounterPanoramaTexture(
                  upgrade.texture,
                  environmentLease.surfaceTextures,
                  false,
                  environmentLease.matureTreeAtlas,
                )
                upgrade.commit()
              } else {
                upgrade?.discard()
              }
            })
            .catch((error: unknown) => {
              // The medium first frame remains fully usable; a failed optional
              // refinement must not take the family out of the experience.
              console.warn(
                'High-resolution panorama refinement unavailable; keeping the first-frame environment.',
                error,
              )
            })
        }
        window.setTimeout(syncScenePresentation, 0)
        window.setTimeout(() => primaryActionRef.current?.focus(), 0)
        return true
      } finally {
        window.clearTimeout(delayedCaptionTimer)
        if (beginTokenRef.current === beginToken) {
          beginningRef.current = false
        }
      }
    },
    [
      animal.id,
      animal.name,
      content.copy,
      controller,
      ensureReviewCandidateAvatar,
      ensureReviewCandidateEnvironment,
      environmentVariant,
      releaseCandidateLease,
      releaseEnvironmentLease,
      requiresProceduralLandBiome,
      sceneCandidateVariant,
      setPresentationState,
      syncScenePresentation,
    ],
  )

  useEffect(() => {
    mountedRef.current = true
    avatarLoadGenerationRef.current += 1
    return () => {
      mountedRef.current = false
      beginTokenRef.current += 1
      beginningRef.current = false
      avatarLoadGenerationRef.current += 1
      candidateLoadTokenRef.current += 1
      candidateLoadAbortRef.current?.abort()
      candidateLoadAbortRef.current = null
      const distanceHold = distanceButtonHoldRef.current
      if (distanceHold) {
        window.clearTimeout(distanceHold.timer)
        if (distanceHold.engaged) {
          controller.setScaleEncounterDistanceMotion(0)
        }
        distanceButtonHoldRef.current = null
      }
      const orbitHold = orbitButtonHoldRef.current
      if (orbitHold) {
        window.clearTimeout(orbitHold.timer)
        if (orbitHold.engaged) {
          controller.setScaleEncounterOrbitMotion(0)
        }
        orbitButtonHoldRef.current = null
      }
      if (startedRef.current) {
        controller.endScaleEncounter()
        startedRef.current = false
      }
      controller.setScaleEncounterAvatarFactory(null)
      controller.setScaleEncounterForestProps?.(null)
      releaseCandidateLease()
      releaseEnvironmentLease()
      candidateLoadRef.current = null
      candidateLoadTargetRef.current = null
      environmentLoadRef.current = null
      environmentLoadRefGeneration.current = -1
    }
  }, [controller, releaseCandidateLease, releaseEnvironmentLease])

  useEffect(() => {
    if (!profile && shouldPreloadScaleEncounterRichAssets()) {
      void ensureReviewCandidateEnvironment()
    }
  }, [ensureReviewCandidateEnvironment, profile])

  useEffect(() => {
    if (!profile && selectedGender && shouldPreloadScaleEncounterRichAssets()) {
      void ensureReviewCandidateAvatar({
        gender: selectedGender,
        heightCm,
      })
    }
  }, [ensureReviewCandidateAvatar, heightCm, profile, selectedGender])

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled
  }, [voiceEnabled])

  useEffect(() => {
    ambientEnabledRef.current = ambientEnabled
  }, [ambientEnabled])

  useEffect(() => {
    // Set preload before assigning src. `new Audio(url)` defaults to eager
    // preload in some browsers and can start the ambience request immediately.
    const ambient = new Audio()
    ambient.preload = 'none'
    ambient.src = AMBIENT_AUDIO_URL
    ambient.loop = true
    ambient.volume = AMBIENT_VOLUME
    ambientAudioRef.current = ambient
    return () => {
      ambient.pause()
      ambient.removeAttribute('src')
      ambient.load()
      if (ambientAudioRef.current === ambient) {
        ambientAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!playbackMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !playbackSettingsRef.current?.contains(event.target)
      ) {
        setPlaybackMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }
  }, [playbackMenuOpen])

  useEffect(() => {
    const bank = audioBankRef.current
    for (const audio of bank.values()) {
      audio.pause()
    }
    bank.clear()
    for (const kind of [
      'intro',
      'transition',
      'arrival',
      'toChildEyes',
      'toChildRear',
    ] as const) {
      // Register sources without fetching them. The exact line switches to
      // auto and calls load() only when the sequence reaches that line.
      const source = content.audio[kind]
      if (!source) continue
      const audio = new Audio()
      audio.preload = 'none'
      audio.src = source
      bank.set(kind, audio)
    }
    return () => {
      for (const audio of bank.values()) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      bank.clear()
    }
  }, [content.audio])

  useEffect(() => {
    document.body.classList.add('scale-encounter-open')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.classList.remove('scale-encounter-open')
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    if (phase !== 'setup') {
      return
    }
    const frame = window.requestAnimationFrame(() =>
      setupTitleRef.current?.focus(),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [phase])

  useEffect(() => {
    if (profile && !startedRef.current && !beginningRef.current) {
      void beginEncounter(profile)
    } else if (!beginningRef.current) {
      onPresentationStateChange(profile ? 'active' : 'setup')
    }
  }, [beginEncounter, onPresentationStateChange, profile])

  useEffect(
    () => () => {
      cancelSequence()
      if (startedRef.current) {
        controller.endScaleEncounter()
        startedRef.current = false
      }
      controller.setScaleEncounterPanoramaTexture(null)
      controller.setScaleEncounterForestProps?.(null)
      controller.setScaleEncounterSceneCandidateVariant('off')
      controller.setScaleEncounterPrototypeFlightApproximation(false)
    },
    [cancelSequence, controller],
  )

  const returnToOverview = useCallback(async () => {
    const operationToken = beginTokenRef.current
    cancelSequence()
    setCaption(null)
    setCaptionVisible(false)
    setPresentationState('returning')
    try {
      await controller.transitionScaleEncounterView('overview')
    } finally {
      const shouldRestoreOverview =
        mountedRef.current &&
        startedRef.current &&
        beginTokenRef.current === operationToken
      if (shouldRestoreOverview) {
        setActivePerspective(defaultPerspectiveForAnimal())
        setPresentationState('overview')
        window.setTimeout(() => {
          if (
            mountedRef.current &&
            startedRef.current &&
            beginTokenRef.current === operationToken
          ) {
            primaryActionRef.current?.focus()
          }
        }, 0)
      }
    }
  }, [cancelSequence, controller, setPresentationState])

  const closeExperience = useCallback(() => {
    beginTokenRef.current += 1
    beginningRef.current = false
    cancelSequence()
    if (startedRef.current) {
      controller.endScaleEncounter()
      startedRef.current = false
    }
    controller.setScaleEncounterAvatarFactory(null)
    invalidateCandidateAvatar()
    onClose()
  }, [cancelSequence, controller, invalidateCandidateAvatar, onClose])

  const contextActionKind =
    SCALE_ENCOUNTER_DEFINITIONS[animal.id].habitat === 'land'
      ? 'jump'
      : 'boost'

  const beginContextAction = useCallback(() => {
    if (!startedRef.current || !['arrival', 'eyes'].includes(phase)) {
      return false
    }
    if (contextActionKind === 'jump') {
      return controller.triggerScaleEncounterJump()
    }
    const accepted = controller.setScaleEncounterBoost(true)
    if (accepted) {
      contextActionHeldRef.current = true
      setBoostActive(true)
    }
    return accepted
  }, [contextActionKind, controller, phase])

  const endContextAction = useCallback(() => {
    if (contextActionKind !== 'boost' || !contextActionHeldRef.current) return
    contextActionHeldRef.current = false
    controller.setScaleEncounterBoost(false)
    setBoostActive(false)
  }, [contextActionKind, controller])

  useEffect(() => {
    const syncKeyboardMotion = () => {
      const held = heldMovementKeysRef.current
      const orbitDirection =
        Number(held.has('ArrowRight') || held.has('KeyD')) -
        Number(held.has('ArrowLeft') || held.has('KeyA'))
      const distanceDirection =
        Number(held.has('ArrowUp') || held.has('KeyW')) -
        Number(held.has('ArrowDown') || held.has('KeyS'))
      controller.setScaleEncounterOrbitMotion(
        orbitDirection as -1 | 0 | 1,
      )
      controller.setScaleEncounterDistanceMotion(
        distanceDirection as -1 | 0 | 1,
      )
    }
    const clearKeyboardMotion = () => {
      if (heldMovementKeysRef.current.size > 0) {
        heldMovementKeysRef.current.clear()
        controller.setScaleEncounterOrbitMotion(0)
        controller.setScaleEncounterDistanceMotion(0)
      }
      endContextAction()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        clearKeyboardMotion()
        if (playbackMenuOpen) {
          setPlaybackMenuOpen(false)
          return
        }
        if (startedRef.current && phase !== 'overview' && phase !== 'setup') {
          void returnToOverview()
        } else {
          closeExperience()
        }
        return
      }
      const movementKey = movementKeyForEvent(event)
      if (
        startedRef.current &&
        ['arrival', 'eyes'].includes(phase) &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        movementKey !== null
      ) {
        event.preventDefault()
        if (!heldMovementKeysRef.current.has(movementKey)) {
          heldMovementKeysRef.current.add(movementKey)
          syncKeyboardMotion()
        }
        return
      }
      if (
        event.code === 'Space' &&
        startedRef.current &&
        ['arrival', 'eyes'].includes(phase) &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (!keyboardTargetOwnsSpace(event.target) ||
          event.target === contextActionRef.current)
      ) {
        if (contextActionKind === 'boost') {
          if (!contextActionHeldRef.current) beginContextAction()
        } else if (!event.repeat) {
          beginContextAction()
        }
        event.preventDefault()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && contextActionHeldRef.current) {
        event.preventDefault()
        endContextAction()
        return
      }
      const key = movementKeyForEvent(event)
      if (key === null) return
      if (!heldMovementKeysRef.current.delete(key)) return
      event.preventDefault()
      syncKeyboardMotion()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', clearKeyboardMotion)
    document.addEventListener('visibilitychange', clearKeyboardMotion)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', clearKeyboardMotion)
      document.removeEventListener('visibilitychange', clearKeyboardMotion)
      clearKeyboardMotion()
    }
  }, [
    closeExperience,
    beginContextAction,
    contextActionKind,
    controller,
    endContextAction,
    phase,
    playbackMenuOpen,
    returnToOverview,
  ])

  const playLine = useCallback(
    (kind: GuidedLineKind, signal: AbortSignal): Promise<boolean> => {
      const text = content.copy[kind]
      setCaption(text)
      setCaptionVisible(true)
      // The guide describes each scene's actions and equipment from the
      // child's point of view. Outfit production and bounds regression remain
      // separate gates, while the setup keeps every encounter imaginative.
      if (!content.narrationAvailable || !voiceEnabledRef.current) {
        return Promise.resolve(false)
      }
      let audio = audioBankRef.current.get(kind)
      if (!audio) {
        audio = new Audio()
        audio.preload = 'none'
        audio.src = content.audio[kind]
        audioBankRef.current.set(kind, audio)
      }
      audio.preload = 'auto'
      audio.load()
      return new Promise((resolve) => {
        let settled = false
        const settle = (playedToEnd: boolean) => {
          if (settled) return
          settled = true
          audio.removeEventListener('ended', handleEnded)
          audio.removeEventListener('error', handleFailure)
          signal.removeEventListener('abort', handleFailure)
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null
            restoreAmbientVolume()
          }
          if (settleLineRef.current === handleFailure) {
            settleLineRef.current = null
          }
          resolve(playedToEnd)
        }
        const handleEnded = () => settle(true)
        const handleFailure = () => settle(false)
        settleLineRef.current = handleFailure
        activeAudioRef.current = audio
        if (ambientAudioRef.current) {
          ambientAudioRef.current.volume = AMBIENT_DUCKED_VOLUME
        }
        audio.currentTime = 0
        audio.addEventListener('ended', handleEnded, { once: true })
        audio.addEventListener('error', handleFailure, { once: true })
        signal.addEventListener('abort', handleFailure, { once: true })
        void audio.play().catch(handleFailure)
      })
    },
    [content.audio, content.copy, content.narrationAvailable, restoreAmbientVolume],
  )

  const startPovSequence = useCallback(async () => {
    if (phase !== 'overview') return
    cancelSequence()
    const run = new AbortController()
    sequenceRef.current = run
    try {
      setPresentationState('intro')
      await playLine('intro', run.signal)
      if (run.signal.aborted) return

      setPresentationState('moving')
      await Promise.all([
        controller.transitionScaleEncounterView(
          'pov',
          content.transitionDurationMs,
        ),
        playLine('transition', run.signal),
      ])
      if (run.signal.aborted) return

      setPresentationState('arrival')
      const arrivalAudioCompleted = await playLine('arrival', run.signal)
      if (run.signal.aborted) return
      setPresentationState('eyes')
      const readingHold = arrivalAudioCompleted
        ? 900
        : Math.min(6_500, Math.max(3_200, content.copy.arrival.length * 115))
      await waitForDelay(readingHold, run.signal)
      if (run.signal.aborted) return
      setCaptionVisible(false)
      await waitForDelay(440, run.signal)
      if (!run.signal.aborted) setCaption(null)
    } catch (error) {
      if (!run.signal.aborted) {
        console.error(error)
        setPresentationState('eyes')
      }
    } finally {
      if (sequenceRef.current === run) {
        sequenceRef.current = null
      }
    }
  }, [
    cancelSequence,
    controller,
    phase,
    playLine,
    content.copy.arrival,
    content.transitionDurationMs,
    setPresentationState,
  ])

  const switchPerspective = useCallback(
    async (targetPerspective: ScaleEncounterPerspective) => {
      if (
        !startedRef.current ||
        !['arrival', 'eyes'].includes(phase) ||
        targetPerspective === activePerspective
      ) {
        return
      }
      cancelSequence()
      const run = new AbortController()
      sequenceRef.current = run
      const previousPerspective = activePerspective
      const lineKind: GuidedLineKind =
        targetPerspective === 'child-eyes'
          ? 'toChildEyes'
          : 'toChildRear'
      try {
        setPresentationState('switching')
        const narration = playLine(lineKind, run.signal)
        await controller.transitionScaleEncounterPerspective(
          targetPerspective,
          1_600,
        )
        if (run.signal.aborted) return
        setActivePerspective(targetPerspective)
        setPresentationState('eyes')
        const narrationCompleted = await narration
        if (run.signal.aborted) return
        const readingHold = narrationCompleted
          ? 650
          : Math.min(
              5_000,
              Math.max(2_400, content.copy[lineKind].length * 90),
            )
        await waitForDelay(readingHold, run.signal)
        if (run.signal.aborted) return
        setCaptionVisible(false)
        await waitForDelay(440, run.signal)
        if (!run.signal.aborted) setCaption(null)
      } catch (error) {
        if (!run.signal.aborted) {
          console.error(error)
          stopActiveAudio()
          setActivePerspective(previousPerspective)
          setPresentationState('eyes')
        }
      } finally {
        if (sequenceRef.current === run) {
          sequenceRef.current = null
        }
      }
    },
    [
      activePerspective,
      cancelSequence,
      content.copy,
      controller,
      phase,
      playLine,
      setPresentationState,
      stopActiveAudio,
    ],
  )

  const confirmProfile = () => {
    if (!selectedGender) return
    const nextProfile: ChildProfile = {
      ...(approach === 'close' ? { approach } : {}),
      gender: selectedGender,
      heightCm,
    }
    onProfileChange(nextProfile)
    void beginEncounter(nextProfile)
  }

  const resetProfile = () => {
    beginTokenRef.current += 1
    beginningRef.current = false
    cancelSequence()
    if (startedRef.current) {
      controller.endScaleEncounter()
      startedRef.current = false
    }
    controller.setScaleEncounterAvatarFactory(null)
    invalidateCandidateAvatar()
    setSelectedGender(null)
    setHeightCm(110)
    setApproach('comfortable')
    setCaption(null)
    setCaptionVisible(false)
    setActivePerspective(defaultPerspectiveForAnimal())
    setFailure(null)
    onProfileChange(null)
    setPresentationState('setup')
  }

  const toggleVoice = () => {
    if (!content.narrationAvailable) return
    const next = !voiceEnabledRef.current
    voiceEnabledRef.current = next
    setVoiceEnabled(next)
    if (!next) {
      stopActiveAudio()
    }
  }

  const toggleAmbient = () => {
    const next = !ambientEnabledRef.current
    ambientEnabledRef.current = next
    setAmbientEnabled(next)
    if (next) {
      playAmbientAudio()
    } else {
      ambientAudioRef.current?.pause()
    }
  }

  const skipCurrentStep = () => {
    stopActiveAudio()
    if (phase === 'moving') {
      controller.finishScaleEncounterTransition()
    }
  }

  const adjustDistance = (direction: -1 | 1) => {
    controller.adjustScaleEncounterDistance(direction)
    syncScenePresentation()
  }

  const beginDistanceButtonHold = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) => {
    if (event.button !== 0 || isTransitionPhase(phase)) return
    const previous = distanceButtonHoldRef.current
    if (previous) {
      window.clearTimeout(previous.timer)
      if (previous.engaged) controller.setScaleEncounterDistanceMotion(0)
    }
    suppressDistanceClickRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const hold: PointerButtonHold = {
      direction,
      engaged: false,
      pointerId: event.pointerId,
      timer: 0,
    }
    hold.timer = window.setTimeout(() => {
      if (distanceButtonHoldRef.current !== hold) return
      hold.engaged = true
      controller.setScaleEncounterDistanceMotion(direction)
    }, DISTANCE_BUTTON_HOLD_DELAY_MS)
    distanceButtonHoldRef.current = hold
  }

  const endDistanceButtonHold = (
    event: ReactPointerEvent<HTMLButtonElement>,
    suppressClickWhenEngaged: boolean,
  ) => {
    const hold = distanceButtonHoldRef.current
    if (!hold || hold.pointerId !== event.pointerId) return
    window.clearTimeout(hold.timer)
    if (hold.engaged) controller.setScaleEncounterDistanceMotion(0)
    suppressDistanceClickRef.current =
      suppressClickWhenEngaged && hold.engaged
    distanceButtonHoldRef.current = null
  }

  const clickDistanceButton = (direction: -1 | 1) => {
    if (suppressDistanceClickRef.current) {
      suppressDistanceClickRef.current = false
      return
    }
    adjustDistance(direction)
  }

  const beginOrbitButtonHold = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) => {
    if (event.button !== 0 || isTransitionPhase(phase)) return
    const previous = orbitButtonHoldRef.current
    if (previous) {
      window.clearTimeout(previous.timer)
      if (previous.engaged) controller.setScaleEncounterOrbitMotion(0)
    }
    suppressOrbitClickRef.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const hold: PointerButtonHold = {
      direction,
      engaged: false,
      pointerId: event.pointerId,
      timer: 0,
    }
    hold.timer = window.setTimeout(() => {
      if (orbitButtonHoldRef.current !== hold) return
      hold.engaged = true
      controller.setScaleEncounterOrbitMotion(direction)
    }, DISTANCE_BUTTON_HOLD_DELAY_MS)
    orbitButtonHoldRef.current = hold
  }

  const endOrbitButtonHold = (
    event: ReactPointerEvent<HTMLButtonElement>,
    suppressClickWhenEngaged: boolean,
  ) => {
    const hold = orbitButtonHoldRef.current
    if (!hold || hold.pointerId !== event.pointerId) return
    window.clearTimeout(hold.timer)
    if (hold.engaged) controller.setScaleEncounterOrbitMotion(0)
    suppressOrbitClickRef.current = suppressClickWhenEngaged && hold.engaged
    orbitButtonHoldRef.current = null
  }

  const clickOrbitButton = (direction: -1 | 1) => {
    if (suppressOrbitClickRef.current) {
      suppressOrbitClickRef.current = false
      return
    }
    controller.adjustScaleEncounterOrbit(direction)
  }

  const beginContextActionPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (contextActionKind !== 'boost' || event.button !== 0) return
    suppressContextActionClickRef.current = true
    contextActionPointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture?.(event.pointerId)
    beginContextAction()
  }

  const endContextActionPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      contextActionKind !== 'boost' ||
      contextActionPointerRef.current !== event.pointerId
    ) {
      return
    }
    contextActionPointerRef.current = null
    endContextAction()
  }

  const clickContextAction = () => {
    if (suppressContextActionClickRef.current) {
      suppressContextActionClickRef.current = false
      return
    }
    if (contextActionKind === 'jump') {
      beginContextAction()
    } else if (boostActive) {
      endContextAction()
    } else {
      beginContextAction()
    }
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!startedRef.current || isTransitionPhase(phase)) return
    event.preventDefault()
    adjustDistance(event.deltaY < 0 ? 1 : -1)
  }

  const updatePinch = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return
    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })
    if (touchPointsRef.current.size !== 2) return
    const [first, second] = [...touchPointsRef.current.values()]
    if (!first || !second) return
    const distance = Math.hypot(first.x - second.x, first.y - second.y)
    const previous = pinchDistanceRef.current
    if (previous !== null && Math.abs(distance - previous) >= 14) {
      adjustDistance(distance > previous ? 1 : -1)
      pinchDistanceRef.current = distance
    } else if (previous === null) {
      pinchDistanceRef.current = distance
    }
  }

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    touchPointsRef.current.delete(event.pointerId)
    if (touchPointsRef.current.size < 2) {
      pinchDistanceRef.current = null
    }
  }

  const chooseEnvironmentVariant = (
    nextVariant: ScaleEncounterEnvironmentVariant,
  ) => {
    setEnvironmentVariant(nextVariant)
    const url = new URL(window.location.href)
    url.searchParams.set('variant', nextVariant)
    window.history.replaceState(window.history.state, '', url)
  }

  const chooseEcologyDensity = (
    nextDensity: ScaleEncounterEcologyDensity,
  ) => {
    setEcologyDensity(nextDensity)
    const url = new URL(window.location.href)
    url.searchParams.set('ecology-density', nextDensity)
    window.history.replaceState(window.history.state, '', url)
  }

  const chooseSceneCandidateVariant = (
    nextVariant: Exclude<ScaleEncounterSceneCandidateVariant, 'off'>,
  ) => {
    setSceneCandidateVariant(nextVariant)
    const url = new URL(window.location.href)
    url.searchParams.set('scene-variant', nextVariant)
    window.history.replaceState(window.history.state, '', url)
  }

  const viewIsPov = isPovPhase(phase)
  const controlsVisible = ['overview', 'arrival', 'eyes'].includes(phase)
  const activeViewLabel = activePerspective === 'child-rear'
    ? locale === 'zh-CN'
      ? '人物后上方视角'
      : 'Behind-the-child view'
    : locale === 'zh-CN'
      ? '小朋友眼睛视角'
      : "Child's-eye view"
  const activeDistanceTitle = activePerspective === 'child-rear'
    ? locale === 'zh-CN'
      ? '环绕观察距离'
      : 'Orbit distance'
    : content.copy.controls.povTitle
  const activeDistanceHint = activePerspective === 'child-rear'
    ? locale === 'zh-CN'
      ? '人物保持全身可见 · 左右环绕动物'
      : 'Keep the full child visible · circle the animal'
    : content.copy.controls.povHint
  const enterActiveViewLabel = content.copy.viewFromMyEyes
  // All current encounters place a modern child inside an immersive
  // prehistoric habitat. Their reviewed scale remains meaningful, but the
  // encounter itself is imagined; a separate neutral science layer/gate has
  // not been implemented yet.
  const experienceLayer = 'imaginative-encounter' as const

  return (
    <section
      aria-label={content.copy.title}
      aria-modal="true"
      className="scale-encounter-shell"
      data-animal-id={animal.id}
      data-ecology-density={ecologyDensity}
      data-environment={environmentVariant}
      data-experience-layer={experienceLayer}
      data-captions={captionsEnabled ? 'on' : 'off'}
      data-ambience={ambientEnabled ? 'on' : 'off'}
      data-narration={voiceEnabled ? 'on' : 'off'}
      data-sound={voiceEnabled ? 'on' : 'off'}
      data-phase={phase}
      data-scene-candidate={sceneCandidateVariant}
      data-prototype-flight-approximation={prototypeFlightApproximation}
      data-avatar-narration-policy={
        sceneCandidateVariant === 'off'
          ? 'legacy-mapped'
          : SCALE_ENCOUNTER_DEFINITIONS[content.animalId].habitat === 'water'
            ? 'authored-diving-equipment'
            : SCALE_ENCOUNTER_DEFINITIONS[content.animalId].habitat === 'air'
              ? 'authored-flight-equipment'
              : 'authored-scene-outfit'
      }
      data-testid="scale-encounter"
      data-perspective={viewIsPov ? activePerspective : 'overview'}
      data-view={viewIsPov ? 'pov' : 'overview'}
      ref={dialogRef}
      role="dialog"
    >
      <div
        aria-label={
          viewIsPov
            ? activeDistanceHint
            : content.copy.controls.overviewHint
        }
        className="scale-encounter-gesture-layer"
        onPointerCancel={endPointer}
        onPointerDown={updatePinch}
        onPointerMove={updatePinch}
        onPointerUp={endPointer}
        onWheel={handleWheel}
        role="application"
      />

      <header className="scale-encounter-topbar">
        <div className="scale-encounter-brand">
          <span aria-hidden="true"><Scaling size={20} strokeWidth={2.3} /></span>
          <div>
            <strong>{content.copy.title}</strong>
            <small>{content.sceneLabel}</small>
          </div>
        </div>
        <div className="scale-encounter-top-actions">
          <div
            className="scale-encounter-playback-settings"
            data-open={playbackMenuOpen || undefined}
            ref={playbackSettingsRef}
          >
            <button
              aria-controls="scale-encounter-playback-panel"
              aria-expanded={playbackMenuOpen}
              aria-label={content.copy.playbackLabel}
              onClick={() => setPlaybackMenuOpen((open) => !open)}
              type="button"
            >
              <Settings2 aria-hidden="true" size={18} />
              <span>{content.copy.playbackShortLabel}</span>
            </button>
            {playbackMenuOpen ? (
              <div
                aria-label={content.copy.playbackTitle}
                className="scale-encounter-playback-panel"
                id="scale-encounter-playback-panel"
                role="group"
              >
                <p>{content.copy.playbackTitle}</p>
                <button
                  aria-label={content.copy.audioLabel}
                  aria-pressed={voiceEnabled}
                  disabled={!content.narrationAvailable}
                  onClick={toggleVoice}
                  type="button"
                >
                  {voiceEnabled ? (
                    <Volume2 aria-hidden="true" size={19} />
                  ) : (
                    <VolumeX aria-hidden="true" size={19} />
                  )}
                  <div>
                    <strong>{content.copy.narrationLabel}</strong>
                    <small>
                      {content.narrationAvailable
                        ? content.copy.narrationHint
                        : locale === 'zh-CN'
                          ? '本轮先评审画面与比例，旁白随后制作'
                          : 'Visual and scale review first; narration follows'}
                    </small>
                  </div>
                  <b>{voiceEnabled ? content.copy.audioOn : content.copy.audioOff}</b>
                </button>
                <button
                  aria-label={content.copy.ambientLabel}
                  aria-pressed={ambientEnabled}
                  onClick={toggleAmbient}
                  type="button"
                >
                  <Music2 aria-hidden="true" size={19} />
                  <div>
                    <strong>{content.copy.ambientLabel}</strong>
                    <small>{content.copy.ambientHint}</small>
                  </div>
                  <b>
                    {ambientEnabled
                      ? content.copy.ambientOn
                      : content.copy.ambientOff}
                  </b>
                </button>
                <button
                  aria-label={content.copy.captionsLabel}
                  aria-pressed={captionsEnabled}
                  onClick={() => setCaptionsEnabled((enabled) => !enabled)}
                  type="button"
                >
                  {captionsEnabled ? (
                    <Captions aria-hidden="true" size={19} />
                  ) : (
                    <CaptionsOff aria-hidden="true" size={19} />
                  )}
                  <div>
                    <strong>{content.copy.captionsTitle}</strong>
                    <small>{content.copy.captionsHint}</small>
                  </div>
                  <b>
                    {captionsEnabled
                      ? content.copy.captionsOn
                      : content.copy.captionsOff}
                  </b>
                </button>
              </div>
            ) : null}
          </div>
          {phase !== 'setup' && phase !== 'error' ? (
            <button
              aria-label={locale === 'zh-CN' ? '重新设置' : 'Set up again'}
              onClick={resetProfile}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={18} />
              <span>{locale === 'zh-CN' ? '重新设置' : 'Set up again'}</span>
            </button>
          ) : null}
          <button aria-label={content.copy.close} onClick={closeExperience} type="button">
            <X aria-hidden="true" size={20} />
            <span>{content.copy.close}</span>
          </button>
        </div>
      </header>

      {phase !== 'setup' && phase !== 'error' ? (
        <div className="scale-encounter-scene-heading" aria-live="polite">
          <span>{content.sceneLabel}</span>
          <em className="scale-encounter-imagination-label">
            {locale === 'zh-CN' ? '想象相遇' : 'Imaginative encounter'}
          </em>
          <strong>{animal.name}</strong>
          <small>{content.copy.measurement}</small>
        </div>
      ) : null}

      {sceneCandidateSupportedFor(animal.id) &&
      reviewControlsVisible &&
      sceneCandidateVariant !== 'off' &&
      phase !== 'setup' &&
      phase !== 'entering' &&
      phase !== 'error' ? (
        <SceneCandidatePrototypeSwitcher
          animalId={animal.id}
          current={sceneCandidateVariant}
          locale={locale}
          onChange={chooseSceneCandidateVariant}
        />
      ) : null}

      {animal.id === 'tyrannosaurus-rex' &&
      reviewControlsVisible &&
      phase !== 'setup' &&
      phase !== 'entering' &&
      phase !== 'error' ? (
        environmentVariant === 'production-slice' ? (
          <EcologyDensitySwitcher
            current={ecologyDensity}
            locale={locale}
            onChange={chooseEcologyDensity}
          />
        ) : (
          <EnvironmentPrototypeSwitcher
            current={environmentVariant}
            locale={locale}
            onChange={chooseEnvironmentVariant}
          />
        )
      ) : null}

      {phase !== 'setup' && phase !== 'error' &&
      viewIsPov &&
      !isTransitionPhase(phase) ? (
        <div
          aria-label={content.copy.viewSwitcherLabel}
          className="scale-encounter-perspective-switch"
          role="group"
        >
          <button
            aria-pressed={activePerspective === 'child-eyes'}
            data-active={activePerspective === 'child-eyes' || undefined}
            onClick={() => void switchPerspective('child-eyes')}
            type="button"
          >
            <Eye aria-hidden="true" size={17} />
            <span>{content.copy.childEyesView}</span>
          </button>
          <button
            aria-pressed={activePerspective === 'child-rear'}
            data-active={activePerspective === 'child-rear' || undefined}
            onClick={() => void switchPerspective('child-rear')}
            type="button"
          >
            <PersonStanding aria-hidden="true" size={17} />
            <span>{content.copy.childRearView}</span>
          </button>
        </div>
      ) : phase !== 'setup' && phase !== 'error' ? (
        <div className="scale-encounter-mode-chip">
          {isTransitionPhase(phase)
            ? locale === 'zh-CN' ? '正在切换视角' : 'Changing viewpoint'
            : viewIsPov
              ? activeViewLabel
              : content.copy.overview}
        </div>
      ) : null}

      {phase === 'setup' ? (
        <div className="scale-encounter-setup-layer">
          <div className="scale-encounter-setup-card">
            <h2 ref={setupTitleRef} tabIndex={-1}>{content.copy.setup.title}</h2>
            <p>{content.copy.setup.subtitle}</p>

            <fieldset>
              <legend>{content.copy.setup.fieldGender}</legend>
              <div className="scale-encounter-gender-options">
                {(['boy', 'girl'] as const).map((gender) => {
                  const selected = selectedGender === gender
                  const label = gender === 'boy' ? content.copy.setup.boy : content.copy.setup.girl
                  const description = gender === 'boy'
                    ? content.copy.setup.boyDescription
                    : content.copy.setup.girlDescription
                  return (
                    <label
                      className="scale-encounter-gender"
                      data-gender={gender}
                      data-selected={selected || undefined}
                      key={gender}
                    >
                      <input
                        checked={selected}
                        name="scale-encounter-gender"
                        onChange={() => setSelectedGender(gender)}
                        type="radio"
                        value={gender}
                      />
                      <span aria-hidden="true" className="scale-encounter-mini-avatar">
                        <img
                          alt=""
                          decoding="async"
                          draggable={false}
                          src={SETUP_AVATAR_PORTRAITS[gender]}
                        />
                      </span>
                      <span><strong>{label}</strong><small>{description}</small></span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="scale-encounter-height-field">
              <legend>{content.copy.setup.fieldHeight}</legend>
              <div className="scale-encounter-height-control">
                <button
                  aria-label={locale === 'zh-CN' ? '身高减少 5 厘米' : 'Reduce height by 5 centimetres'}
                  disabled={heightCm <= 90}
                  onClick={() => setHeightCm((height) => Math.max(90, height - 5))}
                  type="button"
                >
                  <Minus aria-hidden="true" size={20} />
                </button>
                <output aria-live="polite" htmlFor="scale-encounter-height">
                  <strong>{heightCm}</strong><span>cm</span>
                </output>
                <button
                  aria-label={locale === 'zh-CN' ? '身高增加 5 厘米' : 'Increase height by 5 centimetres'}
                  disabled={heightCm >= 130}
                  onClick={() => setHeightCm((height) => Math.min(130, height + 5))}
                  type="button"
                >
                  <Plus aria-hidden="true" size={20} />
                </button>
              </div>
              <input
                aria-describedby="scale-encounter-height-help"
                id="scale-encounter-height"
                max="130"
                min="90"
                onChange={(event) => setHeightCm(Number(event.currentTarget.value))}
                step="5"
                type="range"
                value={heightCm}
              />
              <small id="scale-encounter-height-help">{content.copy.setup.heightHelp}</small>
            </fieldset>

            <fieldset className="scale-encounter-approach-field">
              <legend>{content.copy.setup.fieldApproach}</legend>
              <div className="scale-encounter-approach-options">
                {(['comfortable', 'close'] as const).map((value) => {
                  const selected = approach === value
                  const label = value === 'comfortable'
                    ? content.copy.setup.approachComfortable
                    : content.copy.setup.approachClose
                  const description = value === 'comfortable'
                    ? content.copy.setup.approachComfortableDescription
                    : content.copy.setup.approachCloseDescription
                  return (
                    <label
                      className="scale-encounter-approach"
                      data-selected={selected || undefined}
                      key={value}
                    >
                      <input
                        checked={selected}
                        name="scale-encounter-approach"
                        onChange={() => setApproach(value)}
                        type="radio"
                        value={value}
                      />
                      <span><strong>{label}</strong><small>{description}</small></span>
                    </label>
                  )
                })}
              </div>
              <small>{content.copy.setup.approachHelp}</small>
            </fieldset>

            <button
              className="scale-encounter-primary"
              disabled={!selectedGender}
              onClick={confirmProfile}
              type="button"
            >
              <Scaling aria-hidden="true" size={20} />
              {content.copy.setup.confirm}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="scale-encounter-error-layer">
          <picture aria-hidden="true">
            <source media="(orientation: portrait)" srcSet={animal.posterPortrait} />
            <img alt="" src={animal.poster} />
          </picture>
          <div className="scale-encounter-error-card" role="status">
            <strong>{failure ?? content.copy.unavailable}</strong>
            <div>
              <button
                onClick={() => {
                  if (profile) void beginEncounter(profile)
                  else setPresentationState('setup')
                }}
                type="button"
              >{content.copy.retry}</button>
              <button onClick={closeExperience} type="button">{content.copy.close}</button>
            </div>
          </div>
        </div>
      ) : null}

      {caption && captionsEnabled ? (
        <aside
          aria-atomic="true"
          aria-live="polite"
          className="scale-encounter-caption"
          data-visible={captionVisible}
          data-stage={phase}
        >
          <span aria-hidden="true" className="scale-encounter-voice-orb">
            <i /><i /><i />
          </span>
          <div>
            <strong>{locale === 'zh-CN' ? '讲解员姐姐' : 'Museum guide'}</strong>
            <p>{caption}</p>
          </div>
          {phase === 'intro' || phase === 'moving' ? (
            <button onClick={skipCurrentStep} type="button">{content.copy.skip}</button>
          ) : null}
        </aside>
      ) : null}

      {controlsVisible ? (
        <>
          {viewIsPov ? (
            <>
              <button
                aria-keyshortcuts="ArrowLeft A"
                aria-label={content.copy.controls.orbitLeft}
                className="scale-encounter-orbit-button scale-encounter-orbit-button--left"
                onClick={() => clickOrbitButton(-1)}
                onLostPointerCapture={(event) =>
                  endOrbitButtonHold(event, false)
                }
                onPointerCancel={(event) =>
                  endOrbitButtonHold(event, false)
                }
                onPointerDown={(event) => beginOrbitButtonHold(event, -1)}
                onPointerUp={(event) => endOrbitButtonHold(event, true)}
                title={content.copy.controls.orbitLeft}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={28} strokeWidth={2.4} />
              </button>
              <button
                aria-keyshortcuts="ArrowRight D"
                aria-label={content.copy.controls.orbitRight}
                className="scale-encounter-orbit-button scale-encounter-orbit-button--right"
                onClick={() => clickOrbitButton(1)}
                onLostPointerCapture={(event) =>
                  endOrbitButtonHold(event, false)
                }
                onPointerCancel={(event) =>
                  endOrbitButtonHold(event, false)
                }
                onPointerDown={(event) => beginOrbitButtonHold(event, 1)}
                onPointerUp={(event) => endOrbitButtonHold(event, true)}
                title={content.copy.controls.orbitRight}
                type="button"
              >
                <ChevronRight aria-hidden="true" size={28} strokeWidth={2.4} />
              </button>
            </>
          ) : null}
          <div className="scale-encounter-controls">
            <div className="scale-encounter-distance-control">
              <button
                aria-keyshortcuts={viewIsPov ? 'ArrowDown S' : undefined}
                aria-label={content.copy.controls.farther}
                onClick={() => clickDistanceButton(-1)}
                onLostPointerCapture={(event) =>
                  endDistanceButtonHold(event, false)
                }
                onPointerCancel={(event) =>
                  endDistanceButtonHold(event, false)
                }
                onPointerDown={(event) =>
                  beginDistanceButtonHold(event, -1)
                }
                onPointerUp={(event) =>
                  endDistanceButtonHold(event, true)
                }
                type="button"
              >
                <Minus aria-hidden="true" size={22} />
              </button>
              <span>
                <strong>
                  {viewIsPov
                    ? activeDistanceTitle
                    : content.copy.controls.overviewTitle}
                </strong>
                <small>
                  {viewIsPov
                    ? activeDistanceHint
                    : content.copy.controls.overviewHint}
                </small>
              </span>
              <button
                aria-keyshortcuts={viewIsPov ? 'ArrowUp W' : undefined}
                aria-label={content.copy.controls.closer}
                onClick={() => clickDistanceButton(1)}
                onLostPointerCapture={(event) =>
                  endDistanceButtonHold(event, false)
                }
                onPointerCancel={(event) =>
                  endDistanceButtonHold(event, false)
                }
                onPointerDown={(event) =>
                  beginDistanceButtonHold(event, 1)
                }
                onPointerUp={(event) =>
                  endDistanceButtonHold(event, true)
                }
                type="button"
              >
                <Plus aria-hidden="true" size={22} />
              </button>
            </div>
            {viewIsPov ? (
              <button
                aria-keyshortcuts="Space"
                aria-label={
                  contextActionKind === 'jump'
                    ? locale === 'zh-CN'
                      ? '跳一下'
                      : 'Jump'
                    : locale === 'zh-CN'
                      ? '按住加速'
                      : 'Hold to boost'
                }
                aria-pressed={
                  contextActionKind === 'boost' ? boostActive : undefined
                }
                className="scale-encounter-primary scale-encounter-action-button"
                data-action={contextActionKind}
                data-active={boostActive || undefined}
                onClick={clickContextAction}
                onLostPointerCapture={endContextActionPointer}
                onPointerCancel={endContextActionPointer}
                onPointerDown={beginContextActionPointer}
                onPointerUp={endContextActionPointer}
                ref={contextActionRef}
                type="button"
              >
                {contextActionKind === 'jump' ? (
                  <ArrowUp aria-hidden="true" size={20} />
                ) : (
                  <Zap aria-hidden="true" size={20} />
                )}
                <span>
                  {contextActionKind === 'jump'
                    ? locale === 'zh-CN'
                      ? '跳一下'
                      : 'Jump'
                    : locale === 'zh-CN'
                      ? '按住加速'
                      : 'Hold to boost'}
                </span>
              </button>
            ) : null}
            <button
              className="scale-encounter-primary scale-encounter-view-button"
              onClick={() => {
                if (viewIsPov) void returnToOverview()
                else void startPovSequence()
              }}
              ref={primaryActionRef}
              type="button"
            >
              {viewIsPov ? (
                <ArrowLeft aria-hidden="true" size={20} />
              ) : (
                <Eye aria-hidden="true" size={20} />
              )}
              <span>
                {viewIsPov
                  ? content.copy.backToOverview
                  : enterActiveViewLabel}
              </span>
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
