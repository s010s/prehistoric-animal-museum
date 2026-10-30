import type { ViewerModelDescriptor } from './viewer-model-descriptor'
import {
  MODEL_PREVIEW_CAMERA_FIELD_OF_VIEW_DEGREES,
  MODEL_PREVIEW_CONTRACT_VERSION,
  MODEL_PREVIEW_LAYOUT_COORDINATE_SYSTEM,
  MODEL_PREVIEW_MAX_PIXEL_RATIO,
  MODEL_PREVIEW_OBJECT_FIT,
  MODEL_PREVIEW_PHONE_PORTRAIT_SCALE,
  modelPreviewProfiles,
} from './model-preview-profiles'

type PreviewDescriptor = Pick<ViewerModelDescriptor, 'animation' | 'presentation'>

/**
 * JSON property order is deliberately explicit. The resulting string is used
 * by the browser, generator, and validators as the cross-environment contract.
 */
export function createModelPreviewPresentationSignature(
  descriptor: PreviewDescriptor,
): string {
  const { animation, presentation } = descriptor
  return JSON.stringify({
    contractVersion: MODEL_PREVIEW_CONTRACT_VERSION,
    renderer: {
      cameraFieldOfViewDegrees:
        MODEL_PREVIEW_CAMERA_FIELD_OF_VIEW_DEGREES,
      maxPixelRatio: MODEL_PREVIEW_MAX_PIXEL_RATIO,
    },
    layout: {
      coordinateSystem: MODEL_PREVIEW_LAYOUT_COORDINATE_SYSTEM,
      phonePortraitModelScale: MODEL_PREVIEW_PHONE_PORTRAIT_SCALE,
      previewObjectFit: MODEL_PREVIEW_OBJECT_FIT,
      referenceViewports: modelPreviewProfiles.map(
        ({ key, referenceHeight, referenceWidth }) => ({
          key,
          width: referenceWidth,
          height: referenceHeight,
        }),
      ),
    },
    animation: animation
      ? {
          clip: animation.clip,
          loop: animation.loop,
          speed: animation.speed,
        }
      : null,
    presentation: {
      cameraLightScale: presentation.cameraLightScale ?? 1,
      horizontalOffset: {
        landscape: presentation.horizontalOffset?.landscape ?? 0,
        portrait: presentation.horizontalOffset?.portrait ?? 0,
      },
      initialYawDegrees: presentation.initialYawDegrees,
      ...(presentation.initialRotationZDegrees === undefined
        ? {}
        : { initialRotationZDegrees: presentation.initialRotationZDegrees }),
      preciseBounds: presentation.preciseBounds ?? false,
      safeAreaPadding: {
        landscape: presentation.safeAreaPadding.landscape,
        portrait: presentation.safeAreaPadding.portrait,
      },
      shadow: {
        depthOffset: presentation.shadow.depthOffset ?? 0,
        depthScale: presentation.shadow.depthScale ?? 1,
        horizontalOffset: presentation.shadow.horizontalOffset ?? 0,
        opacity: presentation.shadow.opacity,
        scale: presentation.shadow.scale,
        yOffset: presentation.shadow.yOffset ?? 0,
      },
      toneMappingExposure: presentation.toneMappingExposure ?? 1,
      verticalOffset: {
        landscape: presentation.verticalOffset?.landscape ?? 0,
        portrait: presentation.verticalOffset?.portrait ?? 0,
      },
    },
  })
}
