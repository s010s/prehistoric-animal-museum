import type {
  AnimalAnimation,
  AnimalPresentation,
} from '../content/types'
import type { ViewerModelDescriptor } from './viewer-model-descriptor'

interface ViewerAnimalSource {
  readonly animation?: AnimalAnimation
  readonly id: string
  readonly presentation: AnimalPresentation
}

/**
 * The single conversion from content semantics to renderer semantics.
 * Preview generation, validation, and the live app all depend on this helper,
 * so a new animal needs presentation data rather than viewport-specific code.
 */
export function createViewerModelDescriptor(
  animal: ViewerAnimalSource,
  label: string,
  modelUrl: string,
  accessibilityLabel?: string,
): ViewerModelDescriptor {
  return {
    ...(accessibilityLabel ? { accessibilityLabel } : {}),
    id: animal.id,
    label,
    modelUrl,
    presentation: {
      ...(animal.presentation.cameraLightScale === undefined
        ? {}
        : { cameraLightScale: animal.presentation.cameraLightScale }),
      initialYawDegrees: animal.presentation.initialYawDegrees,
      ...(animal.presentation.initialRotationZDegrees === undefined
        ? {}
        : { initialRotationZDegrees: animal.presentation.initialRotationZDegrees }),
      horizontalOffset: {
        landscape: animal.presentation.landscapeHorizontalOffset ?? 0,
        portrait: animal.presentation.portraitHorizontalOffset ?? 0,
      },
      verticalOffset: {
        landscape: animal.presentation.landscapeVerticalOffset ?? 0,
        portrait: animal.presentation.portraitVerticalOffset ?? 0,
      },
      safeAreaPadding: {
        landscape: animal.presentation.safeAreaPadding,
        portrait: Math.max(
          animal.presentation.portraitSafeAreaPadding ??
            animal.presentation.safeAreaPadding,
          0.1,
        ),
      },
      preciseBounds: animal.presentation.preciseBounds ?? false,
      shadow: {
        depthOffset: animal.presentation.shadowDepthOffset ?? 0,
        ...(animal.presentation.shadowDepthScale === undefined
          ? {}
          : { depthScale: animal.presentation.shadowDepthScale }),
        horizontalOffset: animal.presentation.shadowHorizontalOffset ?? 0,
        opacity:
          animal.presentation.shadow === 'ground'
            ? (animal.presentation.shadowOpacity ?? 0.42)
            : 0,
        scale: animal.presentation.shadowScale ?? 0.62,
        yOffset: animal.presentation.shadowYOffset ?? 0,
      },
      ...(animal.presentation.toneMappingExposure === undefined
        ? {}
        : { toneMappingExposure: animal.presentation.toneMappingExposure }),
    },
    ...(animal.animation
      ? {
          animation: {
            clip: animal.animation.clip,
            loop: animal.animation.loop,
            speed: animal.animation.speed,
          },
        }
      : {}),
  }
}
