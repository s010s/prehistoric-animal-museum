import {describe,expect,it} from 'vitest'
import {createWorldSampler} from '../../src/flight-experience/world'

describe('river ecology',()=>{
 it('keeps river water downhill, cuts its bed below water and excludes trees from the channel',()=>{
  const world=createWorldSampler();let previous=Infinity
  for(let s=20;s<2990;s+=20){const station=world.river.station(s),q=world.river.query(station.x,station.z)!
   expect(station.waterLevel).toBeLessThanOrEqual(previous+1e-8);previous=station.waterLevel
   expect(world.terrainAt(station.x,station.z).height).toBeLessThan(station.waterLevel)
   expect(q.depth).toBeGreaterThan(.7)
  }
  for(let z=-5;z<=1;z++)for(let x=0;x<=2;x++)for(const prop of world.scatter({x,z})){expect(world.river.query(prop.x,prop.z)?.signedBankDistance??1000).toBeGreaterThan(prop.kind==='understory'?1:6)}
 })
})
