import {describe,it,expect,vi} from 'vitest'
import {generateTerrain,validTerrainResult} from '../../src/flight-experience/terrain-protocol'
import {WORLD,type Lod} from '../../src/flight-experience/world'
import {sampleDisplayedHeight,sampleDisplayed} from '../../src/flight-experience/displayed-surface'
import {topologyDiagnostics} from '../../src/flight-experience/terrain-patches'
const results=([0,1,2,3] as Lod[]).map(lod=>generateTerrain({type:'generate',sessionId:1,requestId:lod+1,world:WORLD,chunk:{x:3,z:-2},lod,configHash:'terrain-v3'}))
const surface=(lod:number)=>({result:results[lod]!,morph:1,startNormals:results[lod]!.normals,startColors:results[lod]!.colors})
describe('R4 nested actual topology and allocation-free height',()=>{
 it('preserves every parent crease for all refinement transitions, including the non-vertex review counterexample',()=>{
  for(let from=3;from>=1;from--)for(let to=from-1;to>=0;to--){
   const old=surface(from),r=results[to]!,coarseHeights=new Float32Array(r.coarseHeights.length)
   for(let i=0;i<coarseHeights.length;i++)coarseHeights[i]=sampleDisplayedHeight(old,r.positions[i*3]!,r.positions[i*3+2]!)
   const next={...surface(to),result:{...r,coarseHeights},morph:0}
   const probes=[[493,461],[511.7,.33],[.23,255.6],[127.9,384.1],[64,64]]
   for(let i=0;i<150;i++)probes.push([(i*73.173)%512,(i*41.773+3.131)%512])
   for(const [x,z] of probes)expect(sampleDisplayedHeight(next,x!,z!)).toBeCloseTo(sampleDisplayedHeight(old,x!,z!),3)
  }
 })
 it('retains fine topology until coarsening is geometrically identical, including interrupted morphs',()=>{
  const probes=[[493,461],[501.137,477.39],[128.13,255.31],[.371,511.773]]
  for(let fine=0;fine<3;fine++)for(let coarse=fine+1;coarse<=3;coarse++){
   const parent=surface(coarse),r=results[fine]!,positions=r.positions.slice()
   for(let i=0;i<r.coarseHeights.length;i++)positions[i*3+1]=sampleDisplayedHeight(parent,r.positions[i*3]!,r.positions[i*3+2]!)
   const retained={...surface(fine),result:{...r,positions}}
   for(const [x,z] of probes)expect(sampleDisplayedHeight(retained,x!,z!)).toBeCloseTo(sampleDisplayedHeight(parent,x!,z!),3)
  }
  const old={...surface(2),morph:.37,result:{...results[2]!,coarseHeights:new Float32Array(results[2]!.coarseHeights.length).fill(300)}}
  const r=results[0]!,coarseHeights=new Float32Array(r.coarseHeights.length)
  for(let i=0;i<coarseHeights.length;i++)coarseHeights[i]=sampleDisplayedHeight(old,r.positions[i*3]!,r.positions[i*3+2]!)
  const interrupted={...surface(0),result:{...r,coarseHeights},morph:0}
  for(const [x,z] of probes)expect(sampleDisplayedHeight(interrupted,x!,z!)).toBeCloseTo(sampleDisplayedHeight(old,x!,z!),3)
 })
 it('never constructs a query index for fresh results and matches the full sampler during unfinished morph',()=>{
  const before=topologyDiagnostics()
  for(const r of results){const s={...surface(r.lod),morph:.373};for(let i=0;i<100;i++){
    const x=(i*37.413)%512,z=(i*59.171)%512
    expect(sampleDisplayedHeight(s,x,z)).toEqual(sampleDisplayed(s,x,z).height)
  }}
  expect(topologyDiagnostics()).toEqual(before)
  expect(before.builds).toBeLessThanOrEqual(4)
 })
 it('samples transferred payloads in a fresh module without constructing any topology layout',async()=>{
  vi.resetModules()
  const fresh=await import('../../src/flight-experience/displayed-surface')
  const topology=await import('../../src/flight-experience/terrain-patches')
  expect(topology.topologyDiagnostics()).toEqual({layouts:0,builds:0})
  for(const r of results){const s={result:r,morph:.5,startNormals:r.normals,startColors:r.colors};for(let i=0;i<20;i++)expect(fresh.sampleDisplayedHeight(s,493-i*.371,461+i*.113)).toBeCloseTo(sampleDisplayedHeight(s,493-i*.371,461+i*.113),8)}
  expect(topology.topologyDiagnostics()).toEqual({layouts:0,builds:0})
 })
 it('rejects a mismatched layout and cyclic/invalid compact node table before sampling',()=>{
  const request={type:'generate' as const,sessionId:1,requestId:1,world:WORLD,chunk:{x:3,z:-2},lod:0 as const,configHash:'terrain-v3' as const},r=results[0]!
  expect(validTerrainResult({...r,topologyLayoutId:'stale-layout'},request)).toBe(false)
  const topologyNodes=r.topologyNodes.slice();topologyNodes[1]=0
  expect(validTerrainResult({...r,topologyNodes},request)).toBe(false)
 })
 it('reports dense actual-index sampled error rather than five ideal grid probes',()=>{
  expect(results.every(r=>r.errorSampleSpacing===4&&r.patchErrors.length===16)).toBe(true)
  expect(Math.max(...results[2]!.patchErrors)).toBeGreaterThan(0)
  expect(new Set(results.map(r=>r.topologyLayoutId)).size).toBe(4)
 })
})
