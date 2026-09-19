import { Vector3 } from 'three'
import type { Position } from './world'
/** Conservative near-plane sphere swept at <=2m intervals, in logical coordinates. */
export function cameraPathSafe(from: Position, to: Position, surface: (x: number, z: number) => number): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), steps = Math.max(1, Math.ceil(distance / 2))
  if (steps > 512) return false
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t
    for (const dx of [-2, 0, 2]) for (const dz of [-2, 0, 2]) if (y - 2 < surface(x + dx, z + dz) + 2) return false
  }
  return true
}
/** Dampen only the relative offset. Translation follows the render position without speed-dependent lag. */
export function followOffset(previous: Vector3, heading: number, distance: number, delta: number) {
  const desired = new Vector3(-Math.sin(heading) * distance, 5, Math.cos(heading) * distance)
  return delta <= 0 ? desired : previous.clone().lerp(desired, 1 - Math.exp(-delta * 4))
}
