import { expect,it } from 'vitest'
import { FarTerrain } from '../../src/flight-experience/far-terrain'
import { FrameWorkBudget } from '../../src/flight-experience/frame-work-budget'
import { createWorldSampler } from '../../src/flight-experience/world'
it('prepares bounded far strips incrementally and preserves origin geometry',()=>{
 const ring=new FarTerrain(createWorldSampler(),()=>{}),budget=new FrameWorkBudget(()=>0)
 for(let i=0;i<160;i++){budget.begin(i);ring.update(0,0,3000,2048,budget);expect(ring.metrics.preparedRows).toBeLessThanOrEqual(1)}
 expect(ring.metrics.pending).toBe(0);expect(ring.metrics.strips).toBe(12);// Conforming 8m tile boundaries add finite edge triangles, not a global fine grid.
 expect(ring.metrics.triangles).toBeLessThan(60000)
 const before=ring.root.children[0]!.position.clone();ring.relocate({x:512,z:-512});expect(ring.root.children[0]!.position.x).toBe(before.x-512)
 for(let i=0;i<200;i++){budget.begin(i);ring.update(3000,3000,3000,2048,budget);expect(ring.metrics.strips).toBeLessThanOrEqual(14)}
 ring.dispose();expect(ring.root.children).toHaveLength(0)
})
it('reports only installed cells and retains their ownership during a streaming shift',()=>{
 const ring=new FarTerrain(createWorldSampler(),()=>{}),budget=new FrameWorkBudget(()=>0)
 for(let i=0;i<160;i++){budget.begin(i);ring.update(0,0,3000,2048,budget)}
 const before=ring.coveredChunks
 expect(before.some(a=>a.x===4&&a.z===0)).toBe(true)
 expect(before.some(a=>a.x===0&&a.z===0)).toBe(false)
 budget.begin(161);ring.update(513,0,3000,2048,budget)
 expect(ring.metrics.pending).toBeGreaterThan(0)
 expect(ring.coveredChunks).toEqual(before)
 ring.dispose();expect(ring.coveredChunks).toEqual([])
})

it('rebuilds every retained row when the north-south ownership hole moves',()=>{
 const ring=new FarTerrain(createWorldSampler(),()=>{}),budget=new FrameWorkBudget(()=>0)
 for(let i=0;i<160;i++){budget.begin(i);ring.update(0,0,3000,2048,budget)}
 expect(ring.coveredChunks.some(a=>a.x===0&&a.z===-3)).toBe(false)
 for(let i=160;i<320;i++){budget.begin(i);ring.update(0,513,3000,2048,budget)}
 expect(ring.metrics.pending).toBe(0)
 expect(ring.coveredChunks.some(a=>a.x===0&&a.z===-3)).toBe(true)
 expect(ring.coveredChunks.some(a=>a.x===0&&a.z===3)).toBe(false)
 ring.dispose()
})
