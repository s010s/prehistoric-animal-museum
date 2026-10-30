import {
  MODEL_PREVIEW_CONTRACT_VERSION,
  MODEL_PREVIEW_MANIFEST_FILE,
  modelPreviewProfiles,
  selectModelPreviewProfile,
} from '../src/viewer/model-preview-profiles'
import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import type { AnimalPresentation } from '../src/content/types'

// Keep Vitest focused on the fast, in-memory contract. The production build
// runs scripts/validate-model-previews.ts for the full 108-image decode,
// transparency, dimension, source-signature, and manifest audit.
describe('model preview contract', () => {
  it('keeps the shared profile catalog stable and unambiguous', () => {
    expect(MODEL_PREVIEW_CONTRACT_VERSION).toBe(3)
    expect(MODEL_PREVIEW_MANIFEST_FILE).toBe(
      'model-preview.manifest.json',
    )
    expect(modelPreviewProfiles).toHaveLength(6)
    expect(new Set(modelPreviewProfiles.map(({ key }) => key)).size).toBe(
      modelPreviewProfiles.length,
    )
    expect(
      new Set(modelPreviewProfiles.map(({ fileName }) => fileName)).size,
    ).toBe(modelPreviewProfiles.length)

    for (const profile of modelPreviewProfiles) {
      expect(profile.fileName).toMatch(/^preview-[a-z-]+\.webp$/)
      expect(profile.width).toBeGreaterThan(0)
      expect(profile.height).toBeGreaterThan(0)
      expect(profile.referenceWidth).toBeGreaterThan(0)
      expect(profile.referenceHeight).toBeGreaterThan(0)
    }
  })

  it('binds previews to the live renderer and responsive layout contract', () => {
    const signature = JSON.parse(
      createModelPreviewPresentationSignature({
        animation: {
          clip: 'Idle',
          loop: 'repeat',
          speed: 0.8,
        },
        presentation: {
          initialYawDegrees: -90,
          safeAreaPadding: {
            landscape: 0.08,
            portrait: 0.1,
          },
          shadow: {
            opacity: 0.56,
            scale: 0.7,
          },
        },
      }),
    ) as {
      contractVersion?: number
      layout?: {
        coordinateSystem?: string
        phonePortraitModelScale?: number
        previewObjectFit?: string
        referenceViewports?: Array<{
          height?: number
          key?: string
          width?: number
        }>
      }
      renderer?: {
        cameraFieldOfViewDegrees?: number
        maxPixelRatio?: number
      }
    }

    expect(signature).toMatchObject({
      contractVersion: 3,
      renderer: {
        cameraFieldOfViewDegrees: 34,
        maxPixelRatio: 2,
      },
      layout: {
        coordinateSystem: 'fixed-fullscreen-canvas+composition-frame-v1',
        phonePortraitModelScale: 1.15,
        previewObjectFit: 'contain',
        referenceViewports: [
          { height: 390, key: 'landscapeCompact', width: 844 },
          { height: 720, key: 'desktopWide', width: 1280 },
          { height: 640, key: 'phonePortraitCompact', width: 360 },
          { height: 844, key: 'phonePortraitTall', width: 390 },
          { height: 1024, key: 'tabletPortrait', width: 768 },
          { height: 900, key: 'desktopStandard', width: 1440 },
        ],
      },
    })
  })

  it('selects the first matching profile and uses desktop standard as fallback', () => {
    const phoneTall = selectModelPreviewProfile(
      (media) => media === modelPreviewProfiles[3].media,
    )
    expect(phoneTall.key).toBe('phonePortraitTall')

    const firstOfSeveralMatches = selectModelPreviewProfile(
      (media) =>
        media === modelPreviewProfiles[0].media ||
        media === modelPreviewProfiles[5].media,
    )
    expect(firstOfSeveralMatches.key).toBe('landscapeCompact')

    expect(selectModelPreviewProfile(() => false).key).toBe(
      'desktopStandard',
    )
  })

  it('invalidates a tilted gallery preview without changing the omitted-pose contract', () => {
    const presentation: AnimalPresentation = {
      initialYawDegrees: -155,
      safeAreaPadding: 0.14,
      shadow: 'none',
    }
    const ordinary = createViewerModelDescriptor(
      { id: 'dakosaurus', presentation }, 'Dakosaurus', '/model.glb',
    )
    const corrected = createViewerModelDescriptor(
      { id: 'dakosaurus', presentation: { ...presentation, initialRotationZDegrees: 9 } },
      'Dakosaurus', '/model.glb',
    )
    const ordinarySignature = createModelPreviewPresentationSignature(ordinary)
    const correctedSignature = createModelPreviewPresentationSignature(corrected)
    const ordinaryPreview = JSON.parse(ordinarySignature) as { presentation: Record<string, unknown> }
    const correctedPreview = JSON.parse(correctedSignature) as { presentation: Record<string, unknown> }

    expect(ordinary.presentation).not.toHaveProperty('initialRotationZDegrees')
    expect(ordinaryPreview.presentation).not.toHaveProperty('initialRotationZDegrees')
    expect(corrected.presentation).toHaveProperty('initialRotationZDegrees', 9)
    expect(correctedPreview.presentation).toHaveProperty('initialRotationZDegrees', 9)
    expect(correctedSignature).not.toBe(ordinarySignature)
  })
})
