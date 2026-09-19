import { SEA_LEVEL, clamp, type WorldSampler } from '../world'

export const MATERIAL_VERSION = 'm1-1'
export const SURFACE_NAMES = ['rock', 'mineral-soil', 'beach-sand', 'riparian-mud', 'organic-floor', 'low-groundcover'] as const
export type SurfaceName = typeof SURFACE_NAMES[number]
export interface SurfaceContext {
  worldKey: string; materialVersion: string; height: number; slope: number; moisture: number
  woodland: number; geology: number; rockVariation?: number; water: { valid: boolean; kind: 'river' | 'sea' | 'none'; distance: number; relativeLevel: number }
  coast?: { distance:number; relativeLevel:number }
}
const smooth = (a:number,b:number,v:number) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t) }
/** Logical coordinates only: no rendered normal, tree density, LOD or floating-origin input. */
export function surfaceContext(world:WorldSampler,x:number,z:number):SurfaceContext {
  const t=world.terrainAt(x,z),n=world.normalAt(x,z),river=world.river.query(x,z)
  // The canyon wall also sheds coarse rock onto nearby gentler terrain. A
  // wider x-profile provides that apron without turning every hill to stone.
  const halfSpan=52
  const broadSlope=t.canyonWeight>.3?1-(2*halfSpan)/Math.hypot(world.terrainAt(x-halfSpan,z).height-world.terrainAt(x+halfSpan,z).height,2*halfSpan):0
  // Shoreline intersection is expensive; reject distant inland/ocean samples first.
  const coastOffset=x-world.coastAt(z)
  const shore=Math.abs(coastOffset)<420?world.bathymetry(x,z).signedShoreDistance:Infinity
  const sea=shore>=-16&&shore<90
  const useRiver=river&&(!sea||river.signedBankDistance<60)
  const water=useRiver?{valid:true,kind:'river' as const,distance:river.signedBankDistance,relativeLevel:t.height-river.waterLevel}:sea?{valid:true,kind:'sea' as const,distance:shore,relativeLevel:t.height-SEA_LEVEL}:river?{valid:true,kind:'river' as const,distance:river.signedBankDistance,relativeLevel:t.height-river.waterLevel}:{valid:false,kind:'none' as const,distance:Infinity,relativeLevel:Infinity}
  return {worldKey:`${world.config.seed}:${world.config.generator}:${world.config.preset}`,materialVersion:MATERIAL_VERSION,
    height:t.height,slope:Math.max(1-n[1],broadSlope*.82),moisture:t.moisture,woodland:world.noise(x/240,z/240,71),geology:t.canyonWeight,
    rockVariation:(world.noise(x/85,z/85,119)-.5)*.28+(world.noise(x/24,z/24,120)-.5)*.10,
    water,...(sea?{coast:{distance:shore,relativeLevel:t.height-SEA_LEVEL}}:{})}
}
export interface SurfaceClassification { weights: readonly [number,number,number,number,number,number]; dominant:SurfaceName; wetness:number }
/** Six source weights retain semantic identity in PBR, including blend edges. */
export function pbrSourceWeights(weights:SurfaceClassification['weights']):SurfaceClassification['weights'] { return weights }
/** Base materials sum to one; wetness modifies any base without changing its identity. */
export function classifySurface(c:SurfaceContext):SurfaceClassification {
  const finite=(n:number,fallback=0)=>Number.isFinite(n)?n:fallback
  const slope=clamp(finite(c.slope),0,1),moisture=clamp(finite(c.moisture,.4),0,1),woodland=clamp(finite(c.woodland),0,1)
  const valid=c.water.valid&&Number.isFinite(c.water.distance)&&Number.isFinite(c.water.relativeLevel)
  const distance=valid?c.water.distance:Infinity,relative=valid?c.water.relativeLevel:Infinity
  // Broad, world-anchored lithology changes break the razor-straight slope
  // contour, while the wider blend retains a soil/stone scree apron.
  const rock=clamp(smooth(.04,.72,slope+finite(c.geology)*.06+finite(c.rockVariation??0)*1.25),0,1)
  const riverMix=valid&&c.water.kind==='river'?1-smooth(20,60,Math.max(0,distance)):0
  const bank=riverMix*(1-smooth(3,32,Math.max(0,distance)))*(1-smooth(4,22,relative))
  const coastDistance=c.coast?.distance??(valid&&c.water.kind==='sea'?distance:Infinity)
  const coastRelative=c.coast?.relativeLevel??(valid&&c.water.kind==='sea'?relative:Infinity)
  const beach=(1-riverMix)*(1-smooth(12,75,Math.max(0,coastDistance)))*(1-smooth(3,18,coastRelative))
  const canopy=smooth(.43,.70,woodland)*(1-bank*.75)
  // Sparse cover exposes a mineral-soil matrix from a flight view; a near-solid
  // grass weight paints kilometre-wide olive slabs over the terrain.
  const cover=smooth(.34,.66,moisture)*(1-smooth(.62,.84,woodland))*(1-bank)*.68
  const available=1-rock, sediment=available*beach, mud=(available-sediment)*bank*.9
  const organic=(available-sediment-mud)*canopy*.68, groundcover=(available-sediment-mud-organic)*cover
  const soil=Math.max(0,1-rock-sediment-mud-organic-groundcover)
  const weights=[rock,soil,sediment,mud,organic,groundcover] as const
  const index=weights.indexOf(Math.max(...weights))
  const nearWater=valid?(1-smooth(0,20,Math.max(0,distance)))*(1-smooth(2,15,relative)):0
  const nearSea=(1-smooth(0,20,Math.max(0,coastDistance)))*(1-smooth(2,15,coastRelative))
  return {weights,dominant:SURFACE_NAMES[index]!,wetness:clamp(Math.max(nearWater,nearSea),0,1)}
}
