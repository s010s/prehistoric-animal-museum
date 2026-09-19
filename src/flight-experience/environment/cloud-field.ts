import { CLOUD_PERIOD, wrapCloud } from './weather-controller'
export const CLOUD_BASE=2400
/** Logical world ray intersection. Never clamp the oblique receiver query to a local cache. */
export function cloudIntersection(point:readonly number[],direction:readonly number[],height=CLOUD_BASE){
 if(![...point,...direction,height].every(Number.isFinite)||direction[1]!<=.00001)return null
 const t=(height-point[1]!)/direction[1]!
 if(t<0)return null
 return [point[0]!+direction[0]!*t,height,point[2]!+direction[2]!*t] as const
}
export function cloudUV(local:readonly[number,number],origin:readonly[number,number],phase:readonly[number,number]){return [wrapCloud((local[0]+origin[0]-phase[0])*4)/CLOUD_PERIOD,wrapCloud((local[1]+origin[1]-phase[1])*4)/CLOUD_PERIOD] as const}
