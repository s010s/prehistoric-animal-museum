import type { ViewerController } from '../viewer/ViewerController'
import { SKY_EXPANSION_REVIEW_ID_SET } from './sky-expansion-config'

/** Called only from an explicit native review capture URL in the headed tab. */
export async function saveSkyCapture(animalId: string, profile: string, controller: ViewerController, stage: HTMLElement): Promise<void> {
  if (import.meta.env.MODE !== 'review' || !SKY_EXPANSION_REVIEW_ID_SET.has(animalId)) return
  const canvas = stage.querySelector<HTMLCanvasElement>('.viewer-canvas')
  const composition = stage.querySelector<HTMLElement>('.model-composition-frame')
  if (!canvas || !composition) throw new Error('Native capture surfaces are missing.')
  await new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
  controller.setReviewAnimationTime(0)
  const png = controller.captureReviewFramePng()
  if (!png) throw new Error('Native renderer export is unavailable.')
  const canvasBounds = canvas.getBoundingClientRect()
  const frame = composition.getBoundingClientRect()
  const response = await fetch('/__museum-sky-capture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ animalId, profile, png, modelSha256: canvas.dataset.loadedModelSha256,
      presentationSignature: canvas.dataset.previewPresentationSignature,
      frame: { left: frame.left - canvasBounds.left, top: frame.top - canvasBounds.top, width: frame.width, height: frame.height },
      canvas: { width: canvasBounds.width, height: canvasBounds.height },
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      state: Object.fromEntries(Object.entries(canvas.dataset).filter(([key]) => key !== 'reviewCapturePng')) }) })
  const result: unknown = await response.json()
  stage.dataset.skyCaptureResult = JSON.stringify(result)
  if (!response.ok) throw new Error(`Local capture rejected: ${JSON.stringify(result)}`)
}
