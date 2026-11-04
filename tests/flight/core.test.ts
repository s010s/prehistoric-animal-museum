import { sampleDisplayed } from '../../src/flight-experience/displayed-surface'
import { describe, expect, it } from 'vitest'
import { WORLD, chunkAt, meshHeight, safeSurface, scatter, terrainAt, type Lod } from '../../src/flight-experience/world'
import { FlightSimulation } from '../../src/flight-experience/simulation'
import { FlightInputState } from '../../src/flight-experience/input'
import { generateTerrain, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
const job = (x = 0, z = 0, lod: Lod = 0): TerrainJob => ({ type: 'generate', sessionId: 1, requestId: 2, world: WORLD, chunk: { x, z }, lod, configHash: 'terrain-v1' })
describe('flight world contracts', () => {
  it('matches displayed edge heights and normals to adjacent terrain and the real world surface', () => {
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
  it('encloses current and target coarse surfaces including prop clearance', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 22.9, z = -i * 59.3
      for (const segments of [8, 16, 32, 64]) expect(safeSurface(x, z)).toBeGreaterThanOrEqual(meshHeight(x, z, segments) + 16 - 1e-8)
    }
  })
})
describe('comfort simulation and input', () => {
  it('turns right in +X, damps release, and drops long-frame catchup', () => {
    const sim = new FlightSimulation(() => 0); sim.heading = 0
    for (let i = 0; i < 120; i++) sim.advance(1 / 60, { turn: 1, climb: 0 })
    expect(sim.position.x).toBeGreaterThan(-160); expect(sim.heading).toBeGreaterThan(0)
    for (let i = 0; i < 180; i++) sim.advance(1 / 60, { turn: 0, climb: 0 })
    expect(sim.turnRate).toBeLessThan(.001)
    const before = sim.time; sim.advance(100, { turn: 0, climb: 0 })
    expect(sim.time - before).toBeLessThan(.067)
  })
  it('pauses before an unclimbable wall rather than snapping above it', () => {
    const sim = new FlightSimulation((_x, z) => z < 320 ? 600 : 0); sim.heading = 0
    for (let i = 0; i < 2000 && !sim.safetyStop; i++) sim.advance(1 / 60, { turn: 0, climb: -1 })
    expect(sim.safetyStop).toBe(true); expect(sim.position.y).toBeLessThan(250)
  })
  it('clears every input source', () => {
    const input = new FlightInputState(); input.key('KeyD', true); input.point(0, 1)
    expect(input.read()).toEqual({ turn: 1, climb: 1 }); input.clear()
    expect(input.read()).toEqual({ turn: 0, climb: 0 })
  })
})
