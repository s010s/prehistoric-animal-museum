import { CHUNK_SIZE, WORLD, type WorldConfig, createWorldSampler, chunkAt, chunkKey, type Address, type Lod } from './world'
export interface WantedChunk { chunk: Address; lod: Lod; priority: number }
export function chunkWindow(x: number, z: number, radius: number, heading = 0,
  previous: ReadonlyMap<string, WantedChunk> = new Map(), world: WorldConfig = WORLD, altitude = 0): Map<string, WantedChunk> {
  const sampler = createWorldSampler(world)
  const center = chunkAt(x, z), result = new Map<string, WantedChunk>()
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const chunk = { x: center.x + dx, z: center.z + dz }, key = chunkKey(chunk, world)
    const ground = sampler.terrainAt((chunk.x+.5)*CHUNK_SIZE,(chunk.z+.5)*CHUNK_SIZE).height
    const distance = Math.hypot(Math.max(Math.abs((chunk.x + .5) - x / CHUNK_SIZE), Math.abs((chunk.z + .5) - z / CHUNK_SIZE)), Math.max(0,altitude-ground)/CHUNK_SIZE)
    let lod: Lod = distance < 1.6 ? 0 : distance < 2.7 ? 1 : distance < 4.2 ? 2 : 3
    const old = previous.get(key)
    if (old && old.lod < lod && distance < ([1.6, 2.7, 4.2, Infinity][old.lod] ?? Infinity) * 1.15) lod = old.lod
    const forward = dx * Math.sin(heading) - dz * Math.cos(heading)
    result.set(key, { chunk, lod, priority: dx * dx + dz * dz - forward * .3 })
  }
  // A bounded candidate set is refined with Worker-provided actual-index errors in TerrainStream.
  const near=[...result.values()].filter(item=>item.lod===0).sort((a,b)=>a.priority-b.priority)
  for(const item of near.slice(16))item.lod=1
  // A quality change must still keep neighbours within one subdivision level.
  for (let pass = 0; pass < 3; pass++) for (const item of result.values()) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbour = result.get(chunkKey({ x: item.chunk.x + dx!, z: item.chunk.z + dz! }, world))
      if (neighbour && item.lod > neighbour.lod + 1) item.lod = (neighbour.lod + 1) as Lod
    }
  }
  return result
}
export function localChunkPosition(chunk: Address, origin: Address): Address {
  return { x: chunk.x * CHUNK_SIZE - origin.x, z: chunk.z * CHUNK_SIZE - origin.z }
}
