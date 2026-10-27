import { Box3, PerspectiveCamera, Vector3 } from 'three'
import {
  estimateTransparentOverdraw,
  isSoftwareSkyRenderer,
  isVerifiedHardwareSkyRenderer,
  projectWorldBounds,
  projectedOverlapFraction,
} from '../src/scale-encounter/environments/sky'

describe('scale encounter sky diagnostics', () => {
  const camera = new PerspectiveCamera(60, 1, 0.03, 240)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  it('projects visible world bounds and rejects a box behind the camera', () => {
    const visible = projectWorldBounds(
      new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      camera,
      1000,
      1000,
    )
    const behind = projectWorldBounds(
      new Box3(new Vector3(-1, -1, 12), new Vector3(1, 1, 14)),
      camera,
      1000,
      1000,
    )
    expect(visible.visible).toBe(true)
    expect(visible.areaFraction).toBeGreaterThan(0)
    expect(visible.widthPixels).toBeGreaterThan(0)
    expect(behind.visible).toBe(false)
  })

  it('reports projected subject overlap as a fraction of subject area', () => {
    const subject = {
      areaFraction: 0.25,
      heightPixels: 500,
      maximumX: 0.5,
      maximumY: 0.5,
      minimumX: -0.5,
      minimumY: -0.5,
      visible: true,
      widthPixels: 500,
    }
    const quarter = {
      ...subject,
      areaFraction: 0.0625,
      minimumX: 0,
      minimumY: 0,
    }
    expect(projectedOverlapFraction(subject, quarter)).toBeCloseTo(0.25, 8)
  })

  it('estimates transparent coverage and stacked rectangles without claiming GPU fragments', () => {
    const rectangle = {
      areaFraction: 0.25,
      heightPixels: 500,
      maximumX: 0.5,
      maximumY: 0.5,
      minimumX: -0.5,
      minimumY: -0.5,
      visible: true,
      widthPixels: 500,
    }
    const estimate = estimateTransparentOverdraw(
      [rectangle, rectangle],
      1000,
      1000,
      20,
    )
    expect(estimate.coveredPixelContributions).toBe(500_000)
    expect(estimate.maximumLayerCount).toBe(2)
    expect(estimate.meanLayerCountWhereCovered).toBe(2)
    expect(estimate.viewportCoverageFraction).toBeCloseTo(0.25, 2)
  })

  it('separates verified hardware names from software rasterizers', () => {
    expect(
      isVerifiedHardwareSkyRenderer(
        'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)',
      ),
    ).toBe(true)
    expect(isSoftwareSkyRenderer('Google SwiftShader')).toBe(true)
    expect(isVerifiedHardwareSkyRenderer('Google SwiftShader')).toBe(false)
    expect(isSoftwareSkyRenderer('llvmpipe (LLVM 18.1)')).toBe(true)
  })
})
