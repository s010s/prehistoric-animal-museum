import { MathUtils } from 'three'

export const MAMMOTH_NARROW_OVERVIEW_MAXIMUM_ASPECT = 1.05
export const MAMMOTH_OVERVIEW_MINIMUM_ZOOM = 0.82

export function computeMammothOverviewFittingFieldOfView(
  baseFieldOfViewDegrees: number,
  aspect: number,
): number {
  if (
    !Number.isFinite(baseFieldOfViewDegrees) ||
    baseFieldOfViewDegrees <= 0 ||
    baseFieldOfViewDegrees >= 179
  ) {
    throw new RangeError('mammoth-overview-base-fov-out-of-range')
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError('mammoth-overview-aspect-out-of-range')
  }
  if (aspect > MAMMOTH_NARROW_OVERVIEW_MAXIMUM_ASPECT) {
    return baseFieldOfViewDegrees
  }

  const baseFieldOfView = MathUtils.degToRad(baseFieldOfViewDegrees)
  return MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(baseFieldOfView / 2) * MAMMOTH_OVERVIEW_MINIMUM_ZOOM,
      ),
  )
}
