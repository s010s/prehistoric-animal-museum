import {describe,it,expect} from 'vitest'
import {createWorldSampler,WORLD,SEA_LEVEL} from '../../src/flight-experience/world'
import {terrainTopology} from '../../src/flight-experience/terrain-patches'
import {farSurfaceHeight} from '../../src/flight-experience/far-surface'
import {waterVertex,visibleWaterHeight} from '../../src/flight-experience/hydrology/water-surface'

describe('visible shoreline regression',()=>{
 it('uses bounded-aspect triangles at every terrain level, including initial coverage',()=>{
  for(const lod of [0,1,2,3] as const){const t=terrainTopology(lod)
   for(let i=0;i<t.indices.length;i+=3){const ids=[t.indices[i]!,t.indices[i+1]!,t.indices[i+2]!],lengths=ids.map((a,j)=>{const b=ids[(j+1)%3]!;return Math.hypot(t.xz[a*2]!-t.xz[b*2]!,t.xz[a*2+1]!-t.xz[b*2+1]!)})
    expect(Math.max(...lengths)/Math.min(...lengths)).toBeLessThan(3)
   }
  }
 })
 for(const seed of [193706,193707,193708])it(`contains seed ${seed} water beneath both banks without a steep exposed water skirt`,()=>{
  const w=createWorldSampler({...WORLD,seed})
  for(let s=100;s<w.river.length-200;s+=13){const p=w.river.station(s)
   for(const side of [-1,1]){
    const d=(p.halfWidth+6)*side,x=p.x+p.tangent.z*d,z=p.z-p.tangent.x*d,q=w.river.query(x,z)!
    expect(w.terrainAt(x,z).height).toBeGreaterThan(q.waterLevel)
    expect(waterVertex(w,x,z).height).toBeCloseTo(q.waterLevel,6)
    expect(farSurfaceHeight(w,x,z)).toBeGreaterThan(q.waterLevel)
   }
   for(const side of [-1,1])for(let d=p.halfWidth+10;d<150;d+=4){
    const x=p.x+p.tangent.z*d*side,z=p.z-p.tangent.x*d*side,water=visibleWaterHeight(w,x,z)
    if(water>SEA_LEVEL+.05)expect(water).toBeLessThan(w.terrainAt(x,z).height+.05)
   }
   for(let d=-176;d<=176;d+=8){const t=w.terrainAt(p.x+p.tangent.z*d,p.z-p.tangent.x*d);expect(t.naturalHeight-t.height).toBeLessThan(50)}
  }
 })
})
