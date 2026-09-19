import manifest from '../assets/ecology-r5/manifest.json'
import { dimensions } from './prop-lod'
import { chunkAt, type WorldSampler } from '../world'
/** Landmarks use exactly the same metres/Y-up sample as rendering; no overhang can
 * silently extend beyond this conservative cylinder. Runtime accepts at most 2. */
export interface PropLandmark { id: string; asset: 'cliff-0'; x: number; y: number; z: number; scale: number; yaw: number }
export const CLIFF_SAMPLE = Object.freeze({ height: manifest.assets.find(a => a.id === 'cliff-group-0')!.physicalHeight, radius: manifest.assets.find(a => a.id === 'cliff-group-0')!.footprint.radius })
export function landmarkTop(landmark: PropLandmark, x: number, z: number): number {
  return Math.hypot(x - landmark.x, z - landmark.z) <= CLIFF_SAMPLE.radius * landmark.scale ? landmark.y + CLIFF_SAMPLE.height * landmark.scale : -Infinity
}
/** Rendering density/quality cannot remove a collision obstacle. Caller owns its
 * bounded tile cache; this pure probe covers neighbouring source cells as well. */
export function sampleObstacleHeight(world: Pick<WorldSampler, 'scatter'>, x: number, z: number, landmarks: readonly PropLandmark[] = []): number {
  const address = chunkAt(x, z); let top = -Infinity
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const prop of world.scatter({ x: address.x + dx, z: address.z + dz })) {
    const size = dimensions(prop)
    if (Math.hypot(prop.x - x, prop.z - z) <= size.crownRadius) top = Math.max(top, prop.y + size.physicalHeight)
  }
  for (const landmark of landmarks) top = Math.max(top, landmarkTop(landmark, x, z))
  return top
}
