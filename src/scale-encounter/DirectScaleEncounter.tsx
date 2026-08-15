import {
  ArrowLeft,
  Eye,
  Minus,
  Plus,
  RotateCcw,
  Scaling,
  Volume2,
  VolumeX,
  X,
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
  parseScaleEncounterEcologyDensity,
  type ScaleEncounterEcologyDensity,
} from '../viewer/scale-encounter-ecology-density'
import {
  SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS,
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
import type { ReviewCandidateAvatarLease } from './avatar-review-candidate'
import type { ReviewCandidateEnvironmentLease } from './environment-review-candidate'

type ExperiencePhase =
  | 'setup'
  | 'entering'
  | 'overview'
  | 'intro'
  | 'moving'
  | 'arrival'
  | 'eyes'
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

interface NetworkInformationLike {
  readonly effectiveType?: string
  readonly saveData?: boolean
}

interface DistanceButtonHold {
  readonly direction: -1 | 1
  engaged: boolean
  readonly pointerId: number
  timer: number
}

const DISTANCE_BUTTON_HOLD_DELAY_MS = 260

function shouldPreloadRichAssets(): boolean {
  const connection = (
    navigator as Navigator & { readonly connection?: NetworkInformationLike }
  ).connection
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
}

function shouldPreloadAudio(): boolean {
  return shouldPreloadRichAssets()
}

async function loadReviewCandidateAvatarLease(
  profile: ChildProfile,
  animalId: ScaleEncounterAnimalId,
  signal: AbortSignal,
): Promise<ReviewCandidateAvatarLease | null> {
  if (import.meta.env.MODE === 'production') return null
  const { acquireReviewCandidateAvatarFactory } = await import(
    './avatar-review-candidate'
  )
  return acquireReviewCandidateAvatarFactory(profile, animalId, signal)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function avatarTargetKey(
  profile: ChildProfile,
  animalId: ScaleEncounterAnimalId,
): string {
  // Height and scene are intentionally absent. Every encounter now starts
  // from one canonical base per gender; later equipment attaches to those
  // rigs instead of replacing the child with a separately authored avatar.
  void animalId
  return `${profile.gender}:base`
}

async function loadReviewCandidateEnvironmentLease(
  animalId: ScaleEncounterAnimalId,
  maximumTextureSize: number,
  environmentVariant: ScaleEncounterEnvironmentVariant,
): Promise<ReviewCandidateEnvironmentLease | null> {
  if (import.meta.env.MODE === 'production') return null
  const { acquireReviewCandidateEnvironment } = await import(
    './environment-review-candidate'
  )
  return acquireReviewCandidateEnvironment(
    animalId,
    undefined,
    maximumTextureSize,
    undefined,
    undefined,
    environmentVariant,
  )
}

async function loadReviewCandidateForestProps(): Promise<Group | null> {
  if (import.meta.env.MODE === 'production') return null
  const candidate = await import('./forest-props-review-candidate')
  return candidate.loadReviewCandidateForestProps()
}

async function loadReviewCandidateForestEcology(): Promise<Group | null> {
  if (import.meta.env.MODE === 'production') return null
  const candidate = await import('./forest-ecology-review-candidate')
  return candidate.loadReviewCandidateForestEcology()
}

function isPovPhase(phase: ExperiencePhase): boolean {
  return phase === 'arrival' || phase === 'eyes' || phase === 'returning'
}

function isTransitionPhase(phase: ExperiencePhase): boolean {
  return phase === 'intro' || phase === 'moving' || phase === 'returning'
}

function initialEnvironmentVariant(
  animalId: ScaleEncounterAnimalId,
): ScaleEncounterEnvironmentVariant {
  if (typeof window === 'undefined' || animalId !== 'tyrannosaurus-rex') {
    return 'baseline'
  }
  const requested = new URLSearchParams(window.location.search).get('variant')
  return SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS.includes(
    requested as ScaleEncounterEnvironmentVariant,
  )
    ? (requested as ScaleEncounterEnvironmentVariant)
    : 'baseline'
}

function initialEcologyDensity(
  animalId: ScaleEncounterAnimalId,
): ScaleEncounterEcologyDensity {
  if (typeof window === 'undefined' || animalId !== 'tyrannosaurus-rex') {
    return 'current'
  }
  return parseScaleEncounterEcologyDensity(
    new URLSearchParams(window.location.search).get('ecology-density'),
  )
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
  const [phase, setPhase] = useState<ExperiencePhase>(
    profile ? 'entering' : 'setup',
  )
  const [selectedGender, setSelectedGender] = useState<
    ChildProfile['gender'] | null
  >(profile?.gender ?? null)
  const [heightCm, setHeightCm] = useState(profile?.heightCm ?? 110)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [caption, setCaption] = useState<string | null>(null)
  const [captionVisible, setCaptionVisible] = useState(false)
  const [environmentVariant, setEnvironmentVariant] =
    useState<ScaleEncounterEnvironmentVariant>(() =>
      initialEnvironmentVariant(animal.id),
    )
  const [ecologyDensity, setEcologyDensity] = useState<ScaleEncounterEcologyDensity>(() =>
    initialEcologyDensity(animal.id),
  )
  const [failure, setFailure] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const setupTitleRef = useRef<HTMLHeadingElement>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const startedRef = useRef(false)
  const sequenceRef = useRef<AbortController | null>(null)
  const audioBankRef = useRef(new Map<GuidedLineKind, HTMLAudioElement>())
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const settleLineRef = useRef<(() => void) | null>(null)
  const voiceEnabledRef = useRef(voiceEnabled)
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistanceRef = useRef<number | null>(null)
  const distanceButtonHoldRef = useRef<DistanceButtonHold | null>(null)
  const suppressDistanceClickRef = useRef(false)
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

  useEffect(() => {
    let cancelled = false
    controller.setScaleEncounterEcologyDensity(ecologyDensity)
    controller.setScaleEncounterEnvironmentVariant(environmentVariant)
    if (animal.id === 'tyrannosaurus-rex' && environmentVariant !== 'baseline') {
      const productionEcology = environmentVariant === 'production-slice'
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
            'Real forest ecology candidate unavailable; keeping reviewed fallback props.',
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
    syncScenePresentation,
  ])

  const stopActiveAudio = useCallback(() => {
    const audio = activeAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      activeAudioRef.current = null
    }
    settleLineRef.current?.()
    settleLineRef.current = null
  }, [])

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
    if (
      import.meta.env.MODE === 'production' ||
      candidateUnavailableTargetsRef.current.has(target)
    ) {
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
          !isAbortError(error) &&
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
      import.meta.env.MODE === 'production' ||
      environmentUnavailableRef.current
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
            'Review candidate panorama unavailable; using the procedural environment fallback.',
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
  }, [animal.id, controller, environmentVariant])

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
        const [candidateLease, environmentLease] = await Promise.all([
          ensureReviewCandidateAvatar(nextProfile),
          ensureReviewCandidateEnvironment(),
        ])
        if (
          !mountedRef.current ||
          beginTokenRef.current !== beginToken
        ) {
          candidateLease?.release()
          environmentLease?.release()
          return false
        }
        if (!candidateLease) {
          controller.setScaleEncounterAvatarFactory(null)
          releaseEnvironmentLease()
          setCaption(null)
          setCaptionVisible(false)
          controller.setScaleEncounterPanoramaTexture(null)
          setFailure(content.copy.unavailable)
          setPresentationState('error')
          return false
        }
        controller.setScaleEncounterAvatarFactory(candidateLease.factory)
        controller.setScaleEncounterPanoramaTexture(
          environmentLease?.texture ?? null,
          environmentLease?.surfaceTextures ?? null,
          false,
          environmentLease?.matureTreeAtlas ?? null,
        )
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
      animal.name,
      content.copy,
      controller,
      ensureReviewCandidateAvatar,
      ensureReviewCandidateEnvironment,
      environmentVariant,
      releaseCandidateLease,
      releaseEnvironmentLease,
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
    if (!profile && shouldPreloadRichAssets()) {
      void ensureReviewCandidateEnvironment()
    }
  }, [ensureReviewCandidateEnvironment, profile])

  useEffect(() => {
    if (!profile && selectedGender && shouldPreloadRichAssets()) {
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
    const bank = audioBankRef.current
    for (const audio of bank.values()) {
      audio.pause()
    }
    bank.clear()
    const preloadAudio = shouldPreloadAudio()
    for (const kind of ['intro', 'transition', 'arrival'] as const) {
      const audio = new Audio(content.audio[kind])
      audio.preload = preloadAudio ? 'auto' : 'metadata'
      bank.set(kind, audio)
      if (preloadAudio) {
        audio.load()
      }
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (startedRef.current && phase !== 'overview' && phase !== 'setup') {
          void returnToOverview()
        } else {
          closeExperience()
        }
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
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [closeExperience, phase, returnToOverview])

  const playLine = useCallback(
    (kind: GuidedLineKind, signal: AbortSignal): Promise<boolean> => {
      const text = content.copy[kind]
      setCaption(text)
      setCaptionVisible(true)
      if (!voiceEnabledRef.current) {
        return Promise.resolve(false)
      }
      const audio = audioBankRef.current.get(kind)
      if (!audio) {
        return Promise.resolve(false)
      }
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
        audio.currentTime = 0
        audio.addEventListener('ended', handleEnded, { once: true })
        audio.addEventListener('error', handleFailure, { once: true })
        signal.addEventListener('abort', handleFailure, { once: true })
        void audio.play().catch(handleFailure)
      })
    },
    [content.copy],
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

  const confirmProfile = () => {
    if (!selectedGender) return
    const nextProfile: ChildProfile = {
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
    setCaption(null)
    setCaptionVisible(false)
    setFailure(null)
    onProfileChange(null)
    setPresentationState('setup')
  }

  const toggleVoice = () => {
    const next = !voiceEnabledRef.current
    voiceEnabledRef.current = next
    setVoiceEnabled(next)
    if (!next) {
      stopActiveAudio()
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
    const hold: DistanceButtonHold = {
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

  const viewIsPov = isPovPhase(phase)
  const controlsVisible = ['overview', 'arrival', 'eyes'].includes(phase)

  return (
    <section
      aria-label={content.copy.title}
      aria-modal="true"
      className="scale-encounter-shell"
      data-animal-id={animal.id}
      data-ecology-density={ecologyDensity}
      data-environment={environmentVariant}
      data-phase={phase}
      data-testid="scale-encounter"
      data-view={viewIsPov ? 'pov' : 'overview'}
      ref={dialogRef}
      role="dialog"
    >
      <div
        aria-label={
          viewIsPov
            ? content.copy.controls.povHint
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
          <button
            aria-label={content.copy.audioLabel}
            aria-pressed={voiceEnabled}
            onClick={toggleVoice}
            type="button"
          >
            {voiceEnabled ? <Volume2 aria-hidden="true" size={18} /> : <VolumeX aria-hidden="true" size={18} />}
            <span>{voiceEnabled ? content.copy.audioOn : content.copy.audioOff}</span>
          </button>
          <button onClick={resetProfile} type="button">
            <RotateCcw aria-hidden="true" size={18} />
            <span>{locale === 'zh-CN' ? '重新设置' : 'Set up again'}</span>
          </button>
          <button aria-label={content.copy.close} onClick={closeExperience} type="button">
            <X aria-hidden="true" size={20} />
            <span>{content.copy.close}</span>
          </button>
        </div>
      </header>

      {phase !== 'setup' && phase !== 'error' ? (
        <div className="scale-encounter-scene-heading" aria-live="polite">
          <span>{content.sceneLabel}</span>
          <strong>{animal.name}</strong>
          <small>{content.copy.measurement}</small>
        </div>
      ) : null}

      {animal.id === 'tyrannosaurus-rex' &&
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

      {phase !== 'setup' && phase !== 'error' ? (
        <div className="scale-encounter-mode-chip">
          {isTransitionPhase(phase)
            ? locale === 'zh-CN' ? '正在切换视角' : 'Changing viewpoint'
            : viewIsPov
              ? content.copy.childView
              : content.copy.overview}
        </div>
      ) : null}

      {phase === 'setup' ? (
        <div className="scale-encounter-setup-layer">
          <div className="scale-encounter-setup-card">
            <span className="scale-encounter-eyebrow">{content.copy.setup.step}</span>
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
                        <i className="scale-encounter-mini-avatar__head" />
                        <i className="scale-encounter-mini-avatar__body" />
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

            <p className="scale-encounter-privacy">{content.copy.setup.privacy}</p>
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

      {caption ? (
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
        <div className="scale-encounter-controls">
          <div className="scale-encounter-distance-control">
            <button
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
            ><Minus aria-hidden="true" size={22} /></button>
            <span>
              <strong>{viewIsPov ? content.copy.controls.povTitle : content.copy.controls.overviewTitle}</strong>
              <small>{viewIsPov ? content.copy.controls.povHint : content.copy.controls.overviewHint}</small>
            </span>
            <button
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
            ><Plus aria-hidden="true" size={22} /></button>
          </div>
          <button
            className="scale-encounter-primary scale-encounter-view-button"
            onClick={() => {
              if (viewIsPov) void returnToOverview()
              else void startPovSequence()
            }}
            ref={primaryActionRef}
            type="button"
          >
            {viewIsPov ? <ArrowLeft aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
            {viewIsPov ? content.copy.backToOverview : content.copy.viewFromMyEyes}
          </button>
        </div>
      ) : null}
    </section>
  )
}
