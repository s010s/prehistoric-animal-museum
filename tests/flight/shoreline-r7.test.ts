import {describe,it,expect} from 'vitest'
import {createWorldSampler,WORLD,SEA_LEVEL} from '../../src/flight-experience/world'
import {farSurfaceHeight} from '../../src/flight-experience/far-surface'
import {visibleWaterHeight} from '../../src/flight-experience/hydrology/water-surface'

describe('visible shoreline regression',()=>{
 for(const seed of [193706,193707,193708])it(`contains seed ${seed} water beneath both banks without a steep exposed water skirt`,()=>{
  const w=createWorldSampler({...WORLD,seed})
  for(let s=100;s<w.river.length-200;s+=13){const p=w.river.station(s)
   for(const side of [-1,1]){
    const d=(p.halfWidth+6)*side,x=p.x+p.tangent.z*d,z=p.z-p.tangent.x*d,q=w.river.query(x,z)!
    expect(w.terrainAt(x,z).height).toBeGreaterThan(q.waterLevel)
    expect(farSurfaceHeight(w,x,z)).toBeGreaterThan(q.waterLevel)
   }
   for(const side of [-1,1])for(let d=p.halfWidth+10;d<150;d+=4){
    const x=p.x+p.tangent.z*d*side,z=p.z-p.tangent.x*d*side,water=visibleWaterHeight(w,x,z)
    if(water>SEA_LEVEL+.05)expect(water).toBeLessThan(w.terrainAt(x,z).height+.05)
   }
  }
 })
})
