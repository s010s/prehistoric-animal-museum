import { expect, it, vi } from 'vitest'
import type { Mesh, DataTexture, Vector2 } from 'three'
import { HorizonTerrain, HORIZON_RADIUS } from '../../src/flight-experience/horizon-terrain'
import { createWorldSampler } from '../../src/flight-experience/world'
import { FrameWorkBudget } from '../../src/flight-experience/frame-work-budget'
it('keeps distant world geometry bounded, budgeted and continuous while moving and rebasing', () => {
 const world=createWorldSampler(),layer=new HorizonTerrain(world,()=>{}),budget=new FrameWorkBudget(()=>0)
 for(let i=0;i<129;i++){budget.begin(i);layer.update(0,0,budget);expect(layer.metrics.preparedRows).toBeLessThanOrEqual(1)}
 expect(layer.ready).toBe(true);expect(layer.metrics.pending).toBe(0)
 expect(layer.metrics.vertices).toBe(9409);expect(layer.metrics.triangles).toBe(18432);expect(layer.metrics.bytes).toBeLessThan(500000)
 const first=layer.root.children[0] as Mesh,position=first.geometry.getAttribute('position')
 expect(position.getY(0)).toBeCloseTo(world.terrainAt(-HORIZON_RADIUS,-HORIZON_RADIUS).height-8,3)
 const dispose=vi.spyOn(first.geometry,'dispose')
 budget.begin(130);layer.update(2500,0,budget);expect(layer.root.children[0]).toBe(first);expect(dispose).not.toHaveBeenCalled()
 layer.relocate({x:2048,z:-2048});expect(first.position.x).toBe(-2048);expect(first.position.z).toBe(2048)
 for(let i=131;i<260;i++){budget.begin(i);layer.update(2500,0,budget)}
 expect(layer.root.children).toHaveLength(1);expect(dispose).toHaveBeenCalledOnce();expect(layer.metrics.pending).toBe(0)
 layer.dispose();expect(layer.root.children).toHaveLength(0)
})
it('cuts coarse terrain wherever published near or far cells exist, across negative coordinates and rebasing',()=>{
 const layer=new HorizonTerrain(createWorldSampler(),()=>{})
 layer.setCoverage([{x:-2,z:-3},{x:4,z:0}])
 // Inspect the material contract used on GPU, not a second implementation of ownership.
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <clipping_planes_fragment>'}
 layer.material.onBeforeCompile(shader as never,undefined as never)
 const uniforms=shader.uniforms as Record<string,{value:unknown}>
 const texture=uniforms.horizonCoverage!.value as DataTexture
 const origin=uniforms.horizonCoverageOrigin!.value as Vector2
 expect(origin.toArray()).toEqual([-1024,-1536])
 expect(texture.image.data![0]).toBe(255)
 expect(texture.image.data![3*33+6]).toBe(255)
 expect(texture.image.data![1]).toBe(0)
 layer.relocate({x:2048,z:-2048});expect(origin.toArray()).toEqual([-1024,-1536])
 layer.setCoverage([{x:4,z:0}]);expect(origin.toArray()).toEqual([2048,0]);expect(texture.image.data![3*33+6]).toBe(0)
 layer.dispose()
})
