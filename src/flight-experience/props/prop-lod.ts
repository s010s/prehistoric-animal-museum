import type { Prop } from '../world'
import manifest from '../assets/ecology-r5/manifest.json'
/** Physical metres, independent of geometry/LOD scale. Original sample trees fit the 16m safety envelope. */
export interface PropDimensions { asset: string; physicalHeight: number; scale: number; crownRadius: number }
export const PROP_CELL_SIZE = 128
export const PROP_CELL_RADII = { low: 4, balanced: 6 } as const
export const PROP_INSTANCE_CAPACITY = 512
export function cellKey(x: number, z: number) { return `${Math.floor(x / PROP_CELL_SIZE)},${Math.floor(z / PROP_CELL_SIZE)}` }
/** Variant and density occupy independent deterministic namespaces. Prop IDs are
 * world-grid identities; changing density/quality never changes the source asset. */
export function assetVariant(prop: Pick<Prop, 'id' | 'kind'>): number {
  let value = 0x9e3779b9 ^ 83
  for (let i = 0; i < prop.id.length; i++) value = Math.imul(value ^ prop.id.charCodeAt(i), 16777619)
  value = Math.imul(value ^ value >>> 16, 0x85ebca6b)
  return (value >>> 0) % (prop.kind === 'plant' ? 4 : 2)
}
export function dimensions(prop: Prop): PropDimensions {
  const variant = assetVariant(prop)
  const asset = prop.kind === 'plant' ? `tree-${Math.floor(variant / 2)}-${variant % 2}` : prop.kind === 'understory' ? `understory-${variant}` : prop.kind === 'cliff' ? 'cliff-0' : `rock-group-${variant}`
  const source = manifest.assets.find(item => item.id === (asset === 'cliff-0' ? 'cliff-group-0' : asset))!
  const authoredHeight = source.physicalHeight
  const physicalHeight = prop.kind === 'plant' ? 8 + prop.scale : prop.kind === 'understory' ? .7 + prop.scale * .15 : prop.kind === 'cliff' ? 8 + prop.scale : prop.scale * .72
  return { asset, physicalHeight, scale: physicalHeight / authoredHeight, crownRadius: source.footprint.radius * physicalHeight / authoredHeight }
}
/** Three-dimensional distance matters when flying high above a nearby horizontal cell.
 * Hysteresis avoids rebuild churn; every representation keeps the exact same matrix. */
export function propLod(distance: number, previous?: number, height=12, framebufferHeight=720,fov=55): 0 | 1 | 2 {
  const projected=height*framebufferHeight/(2*Math.tan(fov*Math.PI/360)*Math.max(1,distance))
  if(projected>70)return 0
  if (previous === 0 && distance < 150) return 0
  if(projected>26&&distance>=150)return 1
  if (previous === 1 && distance >= 115 && distance < 340) return 1
  if (previous === 2 && distance >= 285) return 2
  return distance < 130 ? 0 : distance < 310 ? 1 : 2
}
