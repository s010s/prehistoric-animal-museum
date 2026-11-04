import { createModelPreviewPresentationSignature } from '../src/viewer/model-preview-contract'
import { createViewerModelDescriptor } from '../src/viewer/create-viewer-model-descriptor'
import type { AnimalPresentation } from '../src/content/types'

describe('model preview contract', () => {
  it('invalidates a gallery preview when its model tilt changes', () => {
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

    expect(correctedSignature).not.toBe(ordinarySignature)
  })
})
