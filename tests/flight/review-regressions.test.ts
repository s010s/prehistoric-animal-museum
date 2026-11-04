import { describe, expect, it } from 'vitest'
import { FlightSimulation } from '../../src/flight-experience/simulation'
import { sampleDisplayed } from '../../src/flight-experience/displayed-surface'
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
})
