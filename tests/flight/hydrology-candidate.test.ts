import { describe,expect,it } from 'vitest'
import { createCoastalRiverCandidate } from '../../src/flight-experience/hydrology/coastal-river-candidate'
describe('finite unintegrated static hydrology candidate',()=>{
  it('has a connected source→flat pool→sea graph with downhill water and submerged centre bed',()=>{
    const river=createCoastalRiverCandidate();expect(river.status).toBe('candidate-needs-review');expect(river.length).toBe(3000)
    let previous=Infinity
    for(let s=0;s<=3000;s+=2){const p=river.station(s);expect(p.waterLevel).toBeLessThanOrEqual(previous);expect(p.bedLevel).toBeLessThan(p.waterLevel);previous=p.waterLevel}
    for(let s=1800;s<=2100;s+=5)expect(river.station(s).waterLevel).toBe(14)
    expect(river.station(3000)).toMatchObject({x:0,z:0,waterLevel:-.7})
    for(let i=0;i<river.reaches.length-1;i++)expect(river.reaches[i]!.to).toBe(river.reaches[i+1]!.from)
  })
  it('has one shared bank/depth definition with continuous sections and no tilted pool',()=>{
    const river=createCoastalRiverCandidate()
    for(const chainage of [100,700,1800,1950,2300,2999]){const s=river.station(chainage)
      expect(river.crossSection(chainage,s.halfWidth).depth).toBe(0)
      expect(river.crossSection(chainage,s.halfWidth).signedBankDistance).toBe(0)
      expect(river.crossSection(chainage,0).depth).toBeGreaterThan(.79)
      expect(Math.abs(river.crossSection(chainage,s.halfWidth-.001).bedLevel-river.crossSection(chainage,s.halfWidth+.001).bedLevel)).toBeLessThan(.004)
      expect(river.query(s.x,s.z)?.waterLevel).toBeCloseTo(s.waterLevel,8)
    }
  })
  it('is deterministic, seed separated, order independent and finite',()=>{
    const a=createCoastalRiverCandidate(1),b=createCoastalRiverCandidate(1),c=createCoastalRiverCandidate(2)
    expect(a.station(1200)).toEqual(b.station(1200));expect(a.station(1200).x).not.toBe(c.station(1200).x)
    const p=a.station(777);a.query(0,0);a.station(2900);expect(a.query(p.x,p.z)).toEqual(b.query(p.x,p.z))
    expect(a.query(a.bounds.maxX+1,0)).toBeNull();expect(a.query(1e9,1e9)).toBeNull()
  })
})
