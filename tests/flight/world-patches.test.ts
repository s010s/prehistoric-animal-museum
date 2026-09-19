import { describe, expect, it } from 'vitest'
import { SEA_LEVEL, WORLD, CHUNK_SIZE, createWorldSampler, chunkKey, terrainAt } from '../../src/flight-experience/world'
import { generateTerrain, validTerrainResult, resultBytes, type TerrainJob } from '../../src/flight-experience/terrain-protocol'
import { sampleDisplayed } from '../../src/flight-experience/displayed-surface'
import { groupTerrainPatches } from '../../src/flight-experience/terrain-patches'
const job = (seed: number, lod: TerrainJob['lod'], x=3,z=-2): TerrainJob => ({type:'generate',sessionId:1,requestId:1,world:{...WORLD,seed},chunk:{x,z},lod,configHash:'terrain-v2'})
const surface = (r: ReturnType<typeof generateTerrain>) => ({result:r,morph:1,startNormals:r.normals,startColors:r.colors})
describe('R3 real world identity and displayed patches',()=>{
  it('propagates three real seeds through terrain, worker arrays, normals, props and bathymetry independent of order',()=>{
    const seeds=[WORLD.seed,81231,-7189]
    const jobs=seeds.flatMap(seed=>[job(seed,0),job(seed,3,-4,5)])
    const first=jobs.map(generateTerrain)
    expect(jobs.slice().reverse().map(generateTerrain).reverse().map(r=>r.positions)).toEqual(first.map(r=>r.positions))
    expect(new Set(seeds.map(seed=>createWorldSampler({...WORLD,seed}).terrainAt(1600,-900).height)).size).toBe(3)
    expect(new Set(first.map(r=>JSON.stringify([...r.positions]))).size).toBe(6)
    for(const seed of seeds){
      const a=createWorldSampler({...WORLD,seed}),b=createWorldSampler({...WORLD,seed})
      for(const [x,z] of [[1600,-900],[-1300,450],[0,0]]){
        expect(a.terrainAt(x!,z!)).toEqual(b.terrainAt(x!,z!));expect(a.normalAt(x!,z!)).toEqual(b.normalAt(x!,z!))
        expect(a.bathymetry(x!,z!)).toEqual(b.bathymetry(x!,z!))
      }
      expect(a.scatter({x:3,z:-2})).toEqual(b.scatter({x:3,z:-2}))
      expect(chunkKey({x:3,z:-2},a.config)).toContain(`${seed}:`)
    }
    expect(createWorldSampler().terrainAt(1600,-900)).toEqual(terrainAt(1600,-900))
  })
  it('finds the actual sea-level crossing instead of the coast recipe parameter',()=>{
    const sampler=createWorldSampler(),z=350,x=sampler.shorelineAt(z)
    expect(Math.abs(sampler.terrainAt(x,z).height-SEA_LEVEL)).toBeLessThan(.0001)
    expect(x-sampler.coastAt(z)).toBeGreaterThan(120)
    expect(x-sampler.coastAt(z)).toBeLessThan(250) // includes the integrated estuary
    expect(sampler.bathymetry(x-20,z).depth).toBeGreaterThan(0)
    expect(sampler.bathymetry(x+20,z).depth).toBe(0)
    expect(sampler.bathymetry(x,z).signedShoreDistance).toBe(0)
  })
  it('shares exact eight-metre true-height perimeter across every LOD without the old 64m flattening',()=>{
    for(const lod of [0,1,2,3] as const){
      const request=job(WORLD.seed,lod),r=generateTerrain(request),s=surface(r)
      expect(validTerrainResult(r,request)).toBe(true);expect(resultBytes(generateTerrain({...request,patchIndex:0}))).toBeLessThan(250_000)
      const neighbor=surface(generateTerrain(job(WORLD.seed,(3-lod) as TerrainJob['lod'],4,-2)))
      for(let z=0;z<=CHUNK_SIZE;z+=4){
        expect(sampleDisplayed(s,512,z).height).toBeCloseTo(sampleDisplayed(neighbor,0,z).height,4)
        if(z%8===0)expect(sampleDisplayed(s,512,z).height).toBeCloseTo(terrainAt(2048,-1024+z).height,4)
      }
      for(let z=1;z<512;z+=31)for(let x=1;x<512;x+=31)expect(Number.isFinite(sampleDisplayed(s,x,z).height)).toBe(true)
    }
  })
  it('samples the same nonuniform vertex blend as the GPU and bounds patch draw ranges',()=>{
    const r=generateTerrain(job(WORLD.seed,0)),weights=new Float32Array(r.coarseHeights.length)
    r.coarseHeights.fill(100)
    for(let i=0;i<weights.length;i++)weights[i]=(i%17)/17
    const s={...surface(r),vertexBlend:weights}
    let checked=0
    for(let id=0;id<r.coarseHeights.length&&checked<20;id++){
      const x=r.positions[id*3]!,z=r.positions[id*3+2]!
      if(x%128===0||z%128===0)continue
      expect(sampleDisplayed(s,x,z).height).toBeCloseTo(100*(1-weights[id]!)+r.positions[id*3+1]!*weights[id]!,4);checked++
    }
    expect(checked).toBe(20)
    const p=groupTerrainPatches(r)
    expect(p.groups.length).toBe(16);expect(p.indices.length).toBe(r.indices.length)
    expect(p.groups.reduce((sum,g)=>sum+g.count,0)).toBe(r.indices.length)
    expect(groupTerrainPatches(generateTerrain(job(WORLD.seed,3))).groups).toHaveLength(16)
  })
})
