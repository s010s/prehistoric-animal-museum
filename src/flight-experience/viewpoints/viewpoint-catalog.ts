import { WORLD, type Position } from '../world'
export interface Viewpoint { readonly id: 'seaward' | 'cliff' | 'waterline'; readonly position: Position; readonly target: Position; readonly heading: number }
/** G0 direction approved; heights raised by user to 120/210m above sea level. */
export const VIEWPOINT_WORLD = WORLD
export const VIEWPOINTS: readonly Viewpoint[] = [
  {id:'seaward',position:{x:160,y:119.3,z:500},target:{x:-116,y:112,z:-461},heading:-.28},
  {id:'cliff',position:{x:-160,y:209.3,z:350},target:{x:420,y:120,z:-550},heading:.57},
  {id:'waterline',position:{x:160,y:.9,z:500},target:{x:-116,y:-6.4,z:-461},heading:-.28},
]

/** Frame the fixed sunset at the left third across aspect ratios; never move the sun. */
export function viewpointTarget(view: Viewpoint, aspect: number, fov: number): Position {
  if (view.id === 'cliff') return view.target
  const heading=-.59+Math.atan(Math.tan(fov*Math.PI/360)*aspect/3)
  return {x:view.position.x+Math.sin(heading)*1000,y:view.position.y-7.3,z:view.position.z-Math.cos(heading)*1000}
}
