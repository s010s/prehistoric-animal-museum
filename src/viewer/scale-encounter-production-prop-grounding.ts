import type { Box3, Matrix4 } from 'three'

/**
 * Places a D-slice prop by its transformed geometry bottom instead of by the
 * asset node origin. The matrix must contain the complete template hierarchy,
 * placement rotation and scale, with its vertical placement still set to 0.
 */
export function scaleEncounterProductionPropTranslationY(
  templateGeometryBounds: Box3,
  zeroHeightInstanceMatrix: Matrix4,
  terrainSurfaceWorldY: number,
  burialDepthMeters: number,
): number {
  if (templateGeometryBounds.isEmpty()) {
    return terrainSurfaceWorldY - burialDepthMeters
  }

  const transformedBounds = templateGeometryBounds
    .clone()
    .applyMatrix4(zeroHeightInstanceMatrix)

  return (
    terrainSurfaceWorldY -
    Math.max(0, burialDepthMeters) -
    transformedBounds.min.y
  )
}
