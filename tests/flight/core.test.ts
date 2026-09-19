import { sampleDisplayed } from '../../src/flight-experience/displayed-surface'
import { describe, expect, it } from 'vitest'
import { WORLD, chunkAt, chunkKey, meshHeight, normalAt, safeSurface, scatter, terrainAt, type Lod } from '../../src/flight-experience/world'
import { FlightSimulation } from '../../src/flight-experience/simulation'
import { FlightInputState, isFlightShortcutTarget } from '../../src/flight-experience/input'
import { generateTerrain, validTerrainResult, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
import { chunkWindow, localChunkPosition } from '../../src/flight-experience/chunk-window'
const job = (x = 0, z = 0, lod: Lod = 0): TerrainJob => ({ type: 'generate', sessionId: 1, requestId: 2, world: WORLD, chunk: { x, z }, lod, configHash: 'terrain-v1' })
describe('flight world contracts', () => {
  it('uses floor at negative boundaries and retains large logical keys', () => {
    expect(chunkAt(-.01, -512.01)).toEqual({ x: -1, z: -2 })
    expect(chunkAt(512, 0)).toEqual({ x: 1, z: 0 })
    expect(chunkKey(chunkAt(10_000_000, -10_000_000))).not.toEqual(chunkKey({ x: 0, z: 0 }))
  })
  it('is deterministic across request order and bounds the entire sampled domain', () => {
    const coordinates = [[-10_000_000, 10_000_000], [0, 0], [810, -2800], [513, 819], [-1200, 600]]
    const values = coordinates.map(([x, z]) => terrainAt(x!, z!))
    expect([...coordinates].reverse().map(([x, z]) => terrainAt(x!, z!)).reverse()).toEqual(values)
    for (let i = -60; i < 60; i++) for (let j = -20; j < 20; j++) {
      const h = terrainAt(i * 173.21, j * 413.7).height
      expect(h).toBeGreaterThanOrEqual(-80); expect(h).toBeLessThan(550)
    }
    expect(values.every(v => Number.isFinite(v.height))).toBe(true)
  })
  it('does not carve repeated narrow runoff lanes across the inland flight view', () => {
    // Compare each sample with its 160 m neighbourhood. The rejected lane
    // generator created 7-8 deep, narrow troughs across this same 2 km span.
    for (const x of [1100, 1500]) {
      let narrowTroughs = 0
      let troughStart: number | null = null
      for (let z = -1100; z <= 900; z += 8) {
        const localHeight = terrainAt(x, z).height
        const shoulderHeight = (terrainAt(x, z - 80).height + terrainAt(x, z + 80).height) / 2
        if (localHeight < shoulderHeight - 3.5) {
          troughStart ??= z
        } else if (troughStart !== null) {
          if (z - troughStart <= 80) narrowTroughs++
          troughStart = null
        }
      }
      expect(narrowTroughs).toBeLessThanOrEqual(2)
    }
  })
  it('has matching heights/normals at same-LOD edges and exact cross-LOD edge polylines', () => {
    for (const lod of [0, 1, 2, 3] as const) {
      const a = generateTerrain(job(-1, 0, lod)), b = generateTerrain(job(0, 0, lod))
      for(let z=0;z<=512;z+=8){
        const left=sampleDisplayed({result:a,morph:1,startNormals:a.normals,startColors:a.colors},512,z)
        const right=sampleDisplayed({result:b,morph:1,startNormals:b.normals,startColors:b.colors},0,z)
        expect(left.height).toEqual(right.height)
        left.normal.forEach((v,i)=>expect(v).toBeCloseTo(right.normal[i]!,5))
        expect(left.height).toBeCloseTo(terrainAt(0,z).height,4)
      }
    }
  })
  it('keeps scatter owners unique and low density a strict subset', () => {
    const tiles = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }]
    const props = tiles.flatMap(scatter)
    expect(new Set(props.map(p => p.id)).size).toBe(props.length)
    tiles.forEach(a => scatter(a).forEach(p => expect(chunkAt(p.x, p.z)).toEqual(a)))
    expect(scatter(tiles[1]!).filter(p => p.priority < .4).every(p => scatter(tiles[1]!).some(q => q.id === p.id))).toBe(true)
  })
  it('clusters woodland crowns around stable parent trees without crossing tile ownership', () => {
    const address = { x: 2, z: -1 }, props = scatter(address)
    const byId = new Map(props.map(prop => [prop.id, prop]))
    const crowns = props.filter(prop => prop.id.startsWith('crown:'))
    expect(crowns.length).toBeGreaterThan(0)
    for (const crown of crowns) {
      const [, x, z] = crown.id.split(':')
      const parent = byId.get(`${x}:${z}`)
      expect(parent?.kind).toBe('plant')
      expect(Math.hypot(crown.x - parent!.x, crown.z - parent!.z)).toBeLessThan(16)
      expect(chunkAt(crown.x, crown.z)).toEqual(address)
      expect(crown.y).toBeCloseTo(terrainAt(crown.x, crown.z).height, 6)
    }
  })
  it('bounds windows, adjacent LOD differences and late placement after two origin changes', () => {
    const window = chunkWindow(-100, 2170, 4)
    expect(window.size).toBe(81)
    for (const item of window.values()) {
      const neighbour = window.get(chunkKey({ x: item.chunk.x + 1, z: item.chunk.z }))
      if (neighbour) expect(Math.abs(item.lod - neighbour.lod)).toBeLessThanOrEqual(1)
    }
    const chunk = { x: 16, z: -11 }
    expect(localChunkPosition(chunk, { x: 4096, z: -4096 })).toEqual({ x: 4096, z: -1536 })
    expect(chunkWindow(0, 0, 6).size).toBe(169)
  })
  it('checks malformed and stale worker payloads before installation', () => {
    const request = job(), result = generateTerrain(request)
    expect(validTerrainResult(result, request)).toBe(true)
    expect(validTerrainResult({ ...result, sessionId: 9 }, request)).toBe(false)
    expect(validTerrainResult({ ...result, configHash: 'bad' }, request)).toBe(false)
    expect(validTerrainResult({ ...result, normals: new Float32Array(2) }, request)).toBe(false)
    result.positions[0] = NaN
    expect(validTerrainResult(result, request)).toBe(false)
  })
  it('encloses current and target coarse surfaces including prop clearance', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 22.9, z = -i * 59.3
      for (const segments of [8, 16, 32, 64]) expect(safeSurface(x, z)).toBeGreaterThanOrEqual(meshHeight(x, z, segments) + 16 - 1e-8)
      expect(Math.hypot(...normalAt(x, z))).toBeCloseTo(1, 10)
    }
  })
})
describe('comfort simulation and input', () => {
  it('replays identically at 30, 60 and 120Hz', () => {
    const results = [30, 60, 120].map(fps => {
      const sim = new FlightSimulation(() => 0)
      for (let i = 0; i < fps * 10; i++) sim.advance(1 / fps, { turn: .4, climb: .2 })
      return { ...sim.position, heading: sim.heading, time: sim.time }
    })
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2])
  })
  it('turns right in +X, damps release, and drops long-frame catchup', () => {
    const sim = new FlightSimulation(() => 0); sim.heading = 0
    for (let i = 0; i < 120; i++) sim.advance(1 / 60, { turn: 1, climb: 0 })
    expect(sim.position.x).toBeGreaterThan(-160); expect(sim.heading).toBeGreaterThan(0)
    for (let i = 0; i < 180; i++) sim.advance(1 / 60, { turn: 0, climb: 0 })
    expect(sim.turnRate).toBeLessThan(.001)
    const before = sim.time; sim.advance(100, { turn: 0, climb: 0 })
    expect(sim.time - before).toBeLessThan(.067); expect(sim.droppedSeconds).toBeGreaterThan(99)
  })
  it('pauses before an unclimbable wall rather than snapping above it', () => {
    const sim = new FlightSimulation((_x, z) => z < 320 ? 600 : 0); sim.heading = 0
    for (let i = 0; i < 2000 && !sim.safetyStop; i++) sim.advance(1 / 60, { turn: 0, climb: -1 })
    expect(sim.safetyStop).toBe(true); expect(sim.position.y).toBeLessThan(250)
  })
  it('clears every input source and respects semantic controls', () => {
    const input = new FlightInputState(); input.key('KeyD', true); input.point(0, 1)
    expect(input.read()).toEqual({ turn: 1, climb: 1 }); input.clear()
    expect(input.read()).toEqual({ turn: 0, climb: 0 })
    expect(isFlightShortcutTarget(document.createElement('button'))).toBe(true)
    expect(isFlightShortcutTarget(document.createElement('section'))).toBe(false)
  })
})
