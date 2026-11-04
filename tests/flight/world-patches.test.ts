import {expect,it} from 'vitest'
import {SEA_LEVEL,createWorldSampler} from '../../src/flight-experience/world'

it('finds the actual sea-level crossing instead of the coast recipe parameter',()=>{
    const sampler=createWorldSampler(),z=350,x=sampler.shorelineAt(z)
    expect(Math.abs(sampler.terrainAt(x,z).height-SEA_LEVEL)).toBeLessThan(.0001)
    expect(sampler.bathymetry(x-20,z).depth).toBeGreaterThan(0)
    expect(sampler.bathymetry(x+20,z).depth).toBe(0)
  })
