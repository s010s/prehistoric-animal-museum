import { createWorldRiver } from './hydrology/world-river'
/** Pure, order-independent world. Metres; Y up; supported logical domain ±10,000 km. */
export interface WorldConfig { readonly id: string; readonly seed: number; readonly generator: string; readonly preset: string }
export const WORLD: WorldConfig = Object.freeze({ id: 'coastal-valley', seed: 193706, generator: '5', preset: '1' })
export const SEA_LEVEL = -.7
export const CHUNK_SIZE = 512
export const SEGMENTS = [64, 32, 16, 8] as const
export interface Address { x: number; z: number }
export interface Position extends Address { y: number }
export type Lod = 0 | 1 | 2 | 3
export const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))
const smooth = (t: number) => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v) }
const samplerCache = new Map<string, WorldSampler>()
export function createWorldSampler(config: WorldConfig = WORLD): ReturnType<typeof buildWorldSampler> {
 const key=JSON.stringify(config),cached=samplerCache.get(key);if(cached)return cached
 const sampler=buildWorldSampler(config);samplerCache.set(key,sampler)
 if(samplerCache.size>8)samplerCache.delete(samplerCache.keys().next().value!)
 return sampler
}
function buildWorldSampler(config: WorldConfig) {
const world = Object.freeze({ ...config })
function hash(x: number, z: number, namespace = 0, seed = world.seed): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed ^ Math.imul(namespace, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function noise(x: number, z: number, namespace = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x - ix), v = smooth(z - iz)
  const a = hash(ix, iz, namespace), b = hash(ix + 1, iz, namespace)
  const c = hash(ix, iz + 1, namespace), d = hash(ix + 1, iz + 1, namespace)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}
function coastAt(z: number): number {
  return 100 * Math.sin(z / 790) + 220 * Math.sin(z / 2300) + 95 * (noise(0, z / 900, 4) - .5)
}
function valleyAt(z: number): number { return coastAt(z) + 650 + 200 * Math.sin(z / 1400) }
function baseTerrainAt(x: number, z: number) {
  const inland = x - coastAt(z)
  const land = smooth((inland + 95) / 300)
  const upland = smooth((inland - 110) / 760)
  const canyon = smooth((-z - 900) / 1200) * (.65 + .35 * noise(x / 4000, z / 4000, 13))
  const width = 280 - canyon * 125
  const valley = 1 - smooth(Math.abs(x - valleyAt(z)) / width)
  const ridge = 1 - Math.abs(noise(x / 1050, z / 1050, 9) * 2 - 1)
  const mass = 125 + ridge * 245 + 120 * noise(x / 2300, z / 2300, 11)
  const detail = 16 * (noise(x / 180, z / 180, 7) - .5)
  // Every term bounded: sea -80..-55; inland < 550m. No runtime clamping cliffs.
  const ground = 12 + upland * mass * (1 - valley * (.64 + canyon * .17)) + detail * land
  const height = (-80 + 25 * noise(x / 500, z / 500, 2)) * (1 - land) + ground * land
  const moisture = noise(x / 580, z / 580, 23)
  return { height, moisture, coastWeight: 1 - upland, uplandWeight: upland, canyonWeight: canyon * upland, valley }
}
function terrainAt(x:number,z:number) {
  const t=baseTerrainAt(x,z),water=river.query(x,z)
  return {...t,naturalHeight:t.height,height:river.height(x,z,t.height,water),moisture:Math.max(t.moisture,water?.wetness??0)}
}
function normalAt(x: number, z: number): [number, number, number] {
  const dx = terrainAt(x - 2, z).height - terrainAt(x + 2, z).height
  const dz = terrainAt(x, z - 2).height - terrainAt(x, z + 2).height
  const length = Math.hypot(dx, 4, dz)
  return [dx / length, 4 / length, dz / length]
}
/** Same diagonal as the mesh, not bilinear interpolation of non-coplanar quads. */
function meshHeight(x: number, z: number, segments: number): number {
  const step = CHUNK_SIZE / segments
  const gx = Math.floor(x / step) * step, gz = Math.floor(z / step) * step
  const u = (x - gx) / step, v = (z - gz) / step
  const a = terrainAt(gx, gz).height, b = terrainAt(gx + step, gz).height
  const c = terrainAt(gx, gz + step).height, d = terrainAt(gx + step, gz + step).height
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d)
}
/** Covers every resident/transition LOD plus the tallest 14m prop. */
function safeSurface(x: number, z: number): number {
  return Math.max(0, terrainAt(x, z).height, ...SEGMENTS.map(n => meshHeight(x, z, n))) + 16
}
function regionAt(x: number, z: number): 'coast' | 'hills' | 'valley' | 'canyon' {
  const t = terrainAt(x, z)
  if (t.uplandWeight < .35) return 'coast'
  if (t.valley > .3) return t.canyonWeight > .35 ? 'canyon' : 'valley'
  return 'hills'
}
function scatter(address: Address): Prop[] {
  const result: Prop[] = []
  const spacing = 32
  const startX = address.x * 16, startZ = address.z * 16
  for (let z = startZ; z < startZ + 16; z++) for (let x = startX; x < startX + 16; x++) {
    const wx = (x + .12 + hash(x, z, 31) * .76) * spacing
    const wz = (z + .12 + hash(x, z, 32) * .76) * spacing
    const sample = terrainAt(wx, wz), slope = normalAt(wx, wz)[1]
    if (sample.height < 7 || (river.query(wx,wz)?.signedBankDistance ?? Infinity) < 6) continue
    const woodland = noise(wx / 240, wz / 240, 71)
    const kind = hash(x, z, 35) < .2 + (1 - slope) * .8 ? 'rock' : 'plant'
    if (kind === 'plant' && (slope < .82 || woodland < .43 || hash(x, z, 72) > woodland * .95)) continue
    if (kind === 'rock' && (slope < .45 || hash(x, z, 73) > .35 + (1 - slope))) continue
    result.push({ id: `${x}:${z}`, x: wx, y: sample.height, z: wz,
      scale: 2 + hash(x, z, 33) * 4, yaw: hash(x, z, 34) * Math.PI * 2,
      kind: kind === 'rock' && slope < .85 && hash(x,z,86)<.2 ? 'cliff' : kind, priority: hash(x, z, 36) })
    if(kind === 'plant'){
      // Woodland is a crown cluster, not an evenly spaced scatter of isolated
      // trees. The gradual density gate keeps the forest edge porous.
      const crownDensity = smooth((woodland - .5) / .25)
      for(let cluster=0;cluster<2;cluster++){
        const angle=hash(x,z,90+cluster)*Math.PI*2,r=4+hash(x,z,94+cluster)*5
        const sx=wx+Math.cos(angle)*r,sz=wz+Math.sin(angle)*r,ground=terrainAt(sx,sz)
        if(ground.height>4 && normalAt(sx,sz)[1]>.8 && (river.query(sx,sz)?.signedBankDistance ?? Infinity)>1)result.push({id:`understory:${x}:${z}:${cluster}`,x:sx,y:ground.height,z:sz,scale:2+hash(x,z,98+cluster)*4,yaw:angle,kind:'understory',priority:hash(x,z,102+cluster)})
        if(cluster!==0||hash(x,z,140)>crownDensity*.9)continue
        const treeAngle=angle+1.1,treeRadius=8+hash(x,z,145+cluster)*5
        const tx=clamp(wx+Math.cos(treeAngle)*treeRadius,x*spacing+2,(x+1)*spacing-2)
        const tz=clamp(wz+Math.sin(treeAngle)*treeRadius,z*spacing+2,(z+1)*spacing-2)
        const treeGround=terrainAt(tx,tz)
        if(treeGround.height>7&&normalAt(tx,tz)[1]>.82&&(river.query(tx,tz)?.signedBankDistance??Infinity)>6)
          result.push({id:`crown:${x}:${z}:${cluster}`,x:tx,y:treeGround.height,z:tz,scale:1.5+hash(x,z,148+cluster)*3.5,yaw:hash(x,z,152+cluster)*Math.PI*2,kind:'plant',priority:hash(x,z,156+cluster)})
      }
    }
  }
  return result
}

/** Actual sea-level intersection for the current single-coast heightfield, metres. */
function shorelineAt(z: number): number {
  let lo = coastAt(z) - 300, hi = coastAt(z) + 400
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (terrainAt(mid, z).height < SEA_LEVEL) lo = mid; else hi = mid }
  return (lo + hi) / 2
}
function bathymetry(x: number, z: number) {
  const height = terrainAt(x, z).height
  return { height, depth: Math.max(0, SEA_LEVEL - height), signedShoreDistance: x - shorelineAt(z) }
}
let outletLo=coastAt(420)-300,outletHi=coastAt(420)+400
for(let i=0;i<24;i++){const mid=(outletLo+outletHi)/2;if(baseTerrainAt(mid,420).height<SEA_LEVEL)outletLo=mid;else outletHi=mid}
const river=createWorldRiver(world.seed,{x:(outletLo+outletHi)/2-16,z:420},valleyAt,(x,z)=>baseTerrainAt(x,z).height)
return { river, config: world, hash, noise, coastAt, valleyAt, terrainAt, normalAt, meshHeight, safeSurface, regionAt, scatter, shorelineAt, bathymetry }
}
export type WorldSampler = ReturnType<typeof buildWorldSampler>
const defaultSampler = createWorldSampler()
export const { hash, noise, coastAt, valleyAt, terrainAt, normalAt, meshHeight, safeSurface, regionAt, scatter, shorelineAt, bathymetry } = defaultSampler
export function chunkAt(x: number, z: number): Address {
  return { x: Math.floor(x / CHUNK_SIZE), z: Math.floor(z / CHUNK_SIZE) }
}
export function chunkKey(a: Address, config: WorldConfig = WORLD): string { return `${config.seed}:${config.generator}:${config.preset}:${a.x},${a.z}` }
export interface Prop { id: string; x: number; y: number; z: number; scale: number; yaw: number; kind: 'rock' | 'plant' | 'understory' | 'cliff'; priority: number }
