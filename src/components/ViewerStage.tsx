import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Footprints } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import type {
  ViewerController,
  ViewerFailure,
} from 'virtual:viewer-controller'
import type { ModelCache } from '../viewer/model-cache'
import { modelPreviewProfiles } from '../viewer/model-preview-profiles'
import { modelPreviewFor } from '../viewer/responsive-model-stills'
import { useModelPreviewProfile } from '../viewer/use-model-preview-profile'
import { saveSkyCapture } from '../review/sky-capture'

interface ViewerStageProps {
  animalId: string
  failureMessage: string | null
  initialLoading: boolean
  label: string
  loadingPhase: 'checking-cache' | 'downloading' | 'preparing' | null
  loadingPercent: number | null
  modelCache: ModelCache
  modelReady: boolean
  onControllerReady: (controller: ViewerController | null) => void
  onFirstFrameRendered: (animalId: string) => void
  onRetry: () => void
  onViewerFailure: (failure: ViewerFailure) => void
  posterUrl: string
  posterPortraitUrl: string
}

type ReviewCanvas = HTMLCanvasElement & {
  __museumReviewSetAnimationTime?: (time: number | null) => boolean
}

export function ViewerStage({
  animalId,
  failureMessage,
  initialLoading,
  label,
  loadingPhase,
  loadingPercent,
  modelCache,
  modelReady,
  onControllerReady,
  onFirstFrameRendered,
  onRetry,
  onViewerFailure,
  posterUrl,
  posterPortraitUrl,
}: ViewerStageProps) {
  const { messages } = useI18n()
  const stageRef = useRef<HTMLDivElement>(null)
  const compositionFrameRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<ViewerController | null>(null)
  const [initialOverlayMounted, setInitialOverlayMounted] = useState(true)
  const [viewportSize, setViewportSize] = useState<{
    readonly height: number
    readonly width: number
  } | null>(null)
  const responsivePreviewProfile = useModelPreviewProfile()
  const captureSearchParams = new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  )
  const requestedCaptureProfile = captureSearchParams.get(
    'modelPreviewCapture',
  )
  const requestedCaptureMatte = captureSearchParams.get('modelPreviewMatte')
  const requestedCaptureTime = Number(
    captureSearchParams.get('modelPreviewTime') ?? 0,
  )
  const saveSkyDerivative = captureSearchParams.get('skyCapture') === '1'
  const captureProfile =
    import.meta.env.MODE === 'review'
      ? modelPreviewProfiles.find(
          ({ key }) => key === requestedCaptureProfile,
        )
      : undefined
  const previewProfile = captureProfile ?? responsivePreviewProfile
  const captureScale = captureProfile
    ? Math.min(
        window.innerWidth / captureProfile.referenceWidth,
        window.innerHeight / captureProfile.referenceHeight,
        1,
      )
    : 1
  const captureWidth = captureProfile
    ? captureProfile.referenceWidth * captureScale
    : undefined
  const captureHeight = captureProfile
    ? captureProfile.referenceHeight * captureScale
    : undefined
  const previewUrl =
    modelPreviewFor(animalId, previewProfile.fileName) ??
    (previewProfile.height > previewProfile.width
      ? posterPortraitUrl
      : posterUrl)
  const responsivePreviewSources = modelPreviewProfiles.slice(0, -1).map(
    (profile) => ({
      media: profile.media,
      srcSet:
        modelPreviewFor(animalId, profile.fileName) ??
        (profile.height > profile.width ? posterPortraitUrl : posterUrl),
    }),
  )

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const stagePanel = stage.parentElement
    const frameInsetProperty = '--model-frame-bottom-inset'
    const update = () => {
      const availableWidth = Math.max(stage.clientWidth, 1)
      const availableHeight = Math.max(stage.clientHeight, 1)
      const aspect = previewProfile.width / previewProfile.height
      const width = Math.min(availableWidth, availableHeight * aspect)
      const height = width / aspect
      // The gesture hint is anchored to the centered preview frame. Expose its
      // bottom inset so sibling controls can follow the same position.
      stagePanel?.style.setProperty(
        frameInsetProperty,
        `${Math.max(0, (availableHeight - height) / 2)}px`,
      )
      setViewportSize((current) => {
        if (
          current &&
          Math.abs(current.width - width) < 0.5 &&
          Math.abs(current.height - height) < 0.5
        ) {
          return current
        }
        return { height, width }
      })
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => {
        window.removeEventListener('resize', update)
        stagePanel?.style.removeProperty(frameInsetProperty)
      }
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => {
      observer.disconnect()
      stagePanel?.style.removeProperty(frameInsetProperty)
    }
  }, [previewProfile.height, previewProfile.width])

  useEffect(() => {
    if (!captureProfile) {
      return
    }
    const root = document.documentElement
    root.dataset.modelPreviewCapture = captureProfile.key
    root.style.setProperty(
      '--model-preview-capture-width',
      `${captureWidth}px`,
    )
    root.style.setProperty(
      '--model-preview-capture-height',
      `${captureHeight}px`,
    )
    root.style.setProperty(
      '--model-preview-capture-matte',
      requestedCaptureMatte === 'black' ? '#000' : '#fff',
    )
    return () => {
      delete root.dataset.modelPreviewCapture
      root.style.removeProperty('--model-preview-capture-width')
      root.style.removeProperty('--model-preview-capture-height')
      root.style.removeProperty('--model-preview-capture-matte')
    }
  }, [
    captureHeight,
    captureProfile,
    captureWidth,
    requestedCaptureMatte,
  ])

  useEffect(() => {
    if (captureProfile && modelReady) {
      const controller = controllerRef.current
      controller?.setReviewAnimationTime(
        Number.isFinite(requestedCaptureTime) && requestedCaptureTime >= 0
          ? requestedCaptureTime
          : 0,
      )
      const frame = controller?.captureReviewFramePng()
      const canvas = containerRef.current?.querySelector<HTMLCanvasElement>(
        '.viewer-canvas',
      )
      if (canvas && frame) {
        canvas.dataset.reviewCapturePng = frame
      }
      if (saveSkyDerivative && stageRef.current && controller) {
        void saveSkyCapture(animalId, captureProfile.key, controller, stageRef.current).catch(error => {
          if (stageRef.current) stageRef.current.dataset.skyCaptureResult = JSON.stringify({ error: String(error) })
        })
      }
    }
  }, [animalId, captureProfile, modelReady, requestedCaptureTime, saveSkyDerivative])

  useEffect(() => {
    if (!modelReady) {
      return
    }
    const timeout = window.setTimeout(() => {
      setInitialOverlayMounted(false)
    }, 420)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [modelReady])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      onControllerReady(null)
      return
    }

    let cancelled = false
    let controller: ViewerController | null = null
    let reviewCanvas: ReviewCanvas | null = null

    const initialise = async () => {
      try {
        const { ViewerController, ViewerUnavailableError } = await import(
          'virtual:viewer-controller'
        )
        if (cancelled) {
          return
        }
        try {
          controller = new ViewerController(container, {
            ...(compositionFrameRef.current
              ? { compositionFrame: compositionFrameRef.current }
              : {}),
            modelCache,
            onFailure: onViewerFailure,
            onModelReady: onFirstFrameRendered,
          })
        } catch (error) {
          if (!(error instanceof ViewerUnavailableError)) {
            console.error(error)
          }
          onControllerReady(null)
          return
        }
        if (cancelled) {
          controller.destroy()
          controller = null
          return
        }
        onControllerReady(controller)
        controllerRef.current = controller
        reviewCanvas = container.querySelector<ReviewCanvas>('.viewer-canvas')
        if (
          reviewCanvas &&
          (import.meta.env.DEV ||
            import.meta.env.MODE === 'review' ||
            import.meta.env.MODE === 'model-still' ||
            import.meta.env.MODE === 'e2e')
        ) {
          reviewCanvas.__museumReviewSetAnimationTime = (time) =>
            controller?.setReviewAnimationTime(time) ?? false
        }
      } catch (error) {
        if (!cancelled) {
          onControllerReady(null)
          onViewerFailure({
            cause: error,
            kind: 'webgl-unavailable',
            message: '3D viewer code could not be loaded.',
          })
        }
      }
    }
    void initialise()

    return () => {
      cancelled = true
      if (reviewCanvas) {
        delete reviewCanvas.__museumReviewSetAnimationTime
      }
      if (controller) {
        controllerRef.current = null
        onControllerReady(null)
        controller.destroy()
      }
    }
  }, [
    modelCache,
    onControllerReady,
    onFirstFrameRendered,
    onViewerFailure,
  ])

  const revealPhase = failureMessage
    ? 'failure'
    : modelReady
      ? 'exiting'
      : 'loading'
  const showModelStill = initialOverlayMounted || Boolean(failureMessage)

  return (
    <div
      className="viewer-stage"
      data-model-preview-capture={captureProfile?.key}
      data-initial-loading={initialLoading}
      data-model-ready={modelReady}
      data-reveal-phase={revealPhase}
      ref={stageRef}
    >
      <div
        className="model-viewport"
        data-preview-profile={previewProfile.key}
        data-preview-reference-height={captureProfile?.referenceHeight}
        data-preview-reference-width={captureProfile?.referenceWidth}
        style={
          captureProfile
            ? {
                height: captureHeight,
                width: captureWidth,
              }
            : undefined
        }
      >
        <div className="viewer-host" ref={containerRef} />
      </div>
      <div
        className="model-composition-frame"
        ref={compositionFrameRef}
        style={
          viewportSize
            ? { height: viewportSize.height, width: viewportSize.width }
            : undefined
        }
      >
        {showModelStill && previewUrl ? (
          <picture aria-hidden="true" className="model-still">
            {responsivePreviewSources.map((source) => (
              <source
                key={source.media}
                media={source.media}
                srcSet={source.srcSet}
              />
            ))}
            <img
              alt={messages.viewer.stillAlt(label)}
              decoding="async"
              fetchPriority="high"
              src={previewUrl}
            />
          </picture>
        ) : null}
        {initialOverlayMounted && !failureMessage ? (
          <div
            aria-atomic="true"
            aria-live="polite"
            className="stage-loading"
            role="status"
          >
            <span aria-hidden="true" className="fossil-loader">
              <span className="fossil-loader__ring" />
              <Footprints size={30} strokeWidth={2} />
            </span>
            <strong>
              {loadingPhase === 'preparing'
                ? messages.viewer.preparing
                : loadingPhase === 'downloading'
                  ? loadingPercent === null
                    ? messages.viewer.downloading
                    : messages.viewer.downloadingPercent(loadingPercent)
                  : loadingPhase === 'checking-cache'
                    ? messages.viewer.checkingCache
                    : messages.viewer.invitingFirst}
            </strong>
            <progress
              aria-label={messages.viewer.progressLabel}
              className="model-load-progress"
              max={100}
              {...(loadingPhase !== 'downloading' || loadingPercent === null
                ? {}
                : { value: loadingPercent })}
            />
          </div>
        ) : null}
        {modelReady ? (
          <p aria-hidden="true" className="model-gesture-hint">
            {messages.viewer.gestureHint}
          </p>
        ) : null}
        {failureMessage ? (
          <div className="model-fallback" role="status">
            <strong>{messages.viewer.fallbackTitle}</strong>
            <span>{failureMessage}</span>
            <button
              className="friendly-button friendly-button--small"
              onClick={onRetry}
              type="button"
            >
              {messages.viewer.retry}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
