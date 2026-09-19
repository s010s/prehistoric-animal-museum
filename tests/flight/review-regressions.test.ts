import { describe, expect, it } from 'vitest'
import { IcosahedronGeometry, Vector3 } from 'three'
import { FlightSimulation, angleDelta } from '../../src/flight-experience/simulation'
import { followOffset, cameraPathSafe } from '../../src/flight-experience/camera'
import { sampleDisplayed } from '../../src/flight-experience/displayed-surface'
import { deformRock, waterNormal, waterPhases } from '../../src/flight-experience/scenery-math'
import { generateTerrain } from '../../src/flight-experience/terrain-protocol'
import { WORLD } from '../../src/flight-experience/world'
describe('R2 numerical regressions', () => {
  it.each([30, 60, 90, 120, 144])('interpolates every displayed frame at %iHz', hz => {
    const sim = new FlightSimulation(() => 0)
    let last = 0
    for (let i = 0; i < hz * 8; i++) {
      sim.advance(1 / hz, { turn: 0, climb: 1 })
      const y = sim.renderState().position.y
      if (i > hz * 4) expect((y - last) * hz).toBeCloseTo(6, 1)
      last = y
    }
  })
  it('keeps mixed-interval render time continuous and uses shortest wrapped heading', () => {
    const sim = new FlightSimulation(() => 0); sim.heading = Math.PI - .005; sim.clearAccumulator()
    let previous = sim.renderState()
    for (let i = 0; i < 500; i++) {
      sim.advance([1 / 90, 1 / 144, 1 / 30][i % 3]!, { turn: 1, climb: .5 })
      const render = sim.renderState()
      expect(render.time).toBeGreaterThanOrEqual(previous.time)
      expect(Math.abs(angleDelta(previous.heading, render.heading))).toBeLessThan(.03)
      previous = render
    }
    sim.clearAccumulator()
    expect(sim.renderState().position).toEqual(sim.position)
    expect(sim.renderState().time).toBe(sim.time)
  })
  it.each([.15, .3, .4, .5])('does not chatter on continuous slope %s; bounds acceleration and jerk', slope => {
    const sim = new FlightSimulation((_x, z) => slope * (350 - z) + 60)
    let changes = 0, previousTrend = 0, previousSpeed = sim.speed, previousClimb = sim.climbRate, previousAcceleration = 0
    for (let i = 0; i < 5400 && !sim.safetyStop; i++) {
      sim.advance(1 / 60, { turn: 0, climb: 0 })
      const delta = sim.speed - previousSpeed, trend = Math.abs(delta) > 1e-5 ? Math.sign(delta) : 0
      if (i > 600 && trend && previousTrend && trend !== previousTrend) changes++
      if (trend) previousTrend = trend
      previousSpeed = sim.speed
      const actualAcceleration = (sim.climbRate - previousClimb) * 60
      expect(Math.abs(actualAcceleration)).toBeLessThanOrEqual(3.00001)
      expect(Math.abs(actualAcceleration - previousAcceleration) * 60).toBeLessThanOrEqual(6.00001)
      previousClimb = sim.climbRate; previousAcceleration = actualAcceleration
      expect(Math.abs(sim.verticalAcceleration)).toBeLessThanOrEqual(3.00001)
      expect(Math.abs(sim.commands.jerk)).toBeLessThanOrEqual(6.00001)
    }
    expect(sim.safetyStop).toBe(false)
    expect(changes).toBeLessThan(35)
  })
  it('follows at configured distance independent of cruise speed and checks the entire camera sweep', () => {
    for (const speed of [18, 28, 36]) {
      let offset = new Vector3(0, 5, 17), z = 0
      for (let i = 0; i < 600; i++) { z -= speed / 60; offset = followOffset(offset, 0, 17, 1 / 60) }
      expect((z + offset.z) - z).toBeCloseTo(17, 8)
    }
    const ridge = (x: number) => Math.abs(x) < 3 ? 30 : 0
    expect(cameraPathSafe({ x: -10, y: 20, z: 0 }, { x: 10, y: 20, z: 0 }, ridge)).toBe(false)
    expect(cameraPathSafe({ x: -10, y: 40, z: 0 }, { x: 10, y: 40, z: 0 }, ridge)).toBe(true)
  })
  it('samples the actual edge-adjacent LOD surface and unfinished morph', () => {
    const r = generateTerrain({ type: 'generate', world: WORLD, sessionId: 1, requestId: 1, chunk: { x: 3, z: -2 }, lod: 1, configHash: 'terrain-v1' })
    const surface = { result: r, morph: 1, startNormals: r.normals.slice(), startColors: r.colors.slice() }
    // Independent triangle scan verifies the displayed topology, whose R4 layout
    // intentionally differs from the old regular-grid numeric constant.
    let actual=NaN
    for(let i=0;i<r.indices.length;i+=3){
      const a=r.indices[i]!,b=r.indices[i+1]!,c=r.indices[i+2]!,ax=r.positions[a*3]!,az=r.positions[a*3+2]!,bx=r.positions[b*3]!,bz=r.positions[b*3+2]!,cx=r.positions[c*3]!,cz=r.positions[c*3+2]!
      const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),u=((bz-cz)*(504-cx)+(cx-bx)*(464-cz))/d,v=((cz-az)*(504-cx)+(ax-cx)*(464-cz))/d,w=1-u-v
      if(Math.min(u,v,w)>=-1e-8){actual=u*r.positions[a*3+1]!+v*r.positions[b*3+1]!+w*r.positions[c*3+1]!;break}
    }
    expect(Number.isFinite(actual)).toBe(true)
    expect(sampleDisplayed(surface,504,464).height).toBeCloseTo(actual,5)
    const target = sampleDisplayed(surface, 504, 464).height
    r.coarseHeights.fill(300); surface.morph = .25
    expect(sampleDisplayed(surface, 504, 464).height).toBeCloseTo(300 * .75 + target * .25, 5)
  })
  it('keeps every shared rock position coincident after deformation', () => {
    const g = new IcosahedronGeometry(1, 1), p = g.getAttribute('position'), groups = new Map<string, number[]>()
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',')
      groups.set(key, [...(groups.get(key) ?? []), i])
    }
    deformRock(g)
    for (const ids of groups.values()) for (const id of ids) {
      const first = ids[0]!
      expect([p.getX(id), p.getY(id), p.getZ(id)]).toEqual([p.getX(first), p.getY(first), p.getZ(first)])
    }
    g.dispose()
  })
  it('keeps analytic water phases bounded and invariant across origin changes', () => {
    const x = 9_999_102, z = -8_005_412, time = 234.5, origin = { x: 9_998_848, z: -8_005_632 }
    const phases = waterPhases(origin.x, origin.z, time)
    expect(phases.every(p => p >= 0 && p < Math.PI * 2)).toBe(true)
    const a = (x - origin.x) * .035 + (z - origin.z) * .045 + phases[0]
    const b = (x - origin.x) * .09 - (z - origin.z) * .055 + phases[1]
    const normal = new Vector3(-Math.cos(a) * .035 * .8 - Math.cos(b) * .09 * .25, 1, -Math.cos(a) * .045 * .8 + Math.cos(b) * .055 * .25).normalize()
    waterNormal(x, z, time).forEach((v, i) => expect(normal.getComponent(i)).toBeCloseTo(v, 8))
  })
})
