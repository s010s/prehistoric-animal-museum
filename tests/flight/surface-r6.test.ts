import {describe,it,expect} from 'vitest'
import {createWorldSampler} from '../../src/flight-experience/world'
import {oceanCoverage} from '../../src/flight-experience/hydrology/ocean-coverage'

describe('finite river and generated terrain geometry',()=>{
 it('cuts ocean ownership geometrically, with no overlapping mouth triangles',()=>{
  const w=createWorldSampler(),hole=w.river.bounds,g=oceanCoverage({x:0,z:0},{x:0,z:0},hole),a=g.getAttribute('position')
  for(let i=0;i<a.count;i+=3){const x=(a.getX(i)+a.getX(i+1)+a.getX(i+2))/3,z=(a.getZ(i)+a.getZ(i+1)+a.getZ(i+2))/3
   expect(x>hole.minX&&x<hole.maxX&&z>hole.minZ&&z<hole.maxZ).toBe(false)
  }
  const farthestTerrain=5120+512 // Balanced far range plus one camera/flight centre cell.
  expect(Math.max(...Array.from({length:a.count},(_,i)=>a.getX(i)))).toBeGreaterThan(farthestTerrain)
  g.dispose()
 })
})
