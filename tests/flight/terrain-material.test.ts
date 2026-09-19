import {expect,it} from 'vitest'
import {MeshStandardMaterial,Texture,Vector2} from 'three'
import {decorateMaterialTerrain} from '../../src/flight-experience/lookdev/material-terrain'
import {createWorldSampler} from '../../src/flight-experience/world'
import {SURFACE_NAMES,classifySurface,pbrSourceWeights,surfaceContext} from '../../src/flight-experience/materials/surface-context'
import {attachSurfaceAttributes} from '../../src/flight-experience/materials/surface-attributes'
import {BufferAttribute,BufferGeometry} from 'three'
import {animationWeights} from '../../src/flight-experience/flight-animation-default'
import {CAPTURE_ANCHORS} from '../../src/flight-experience/review-anchors'
import {coastValleyLandmarks,createLandscapeSurface} from '../../src/flight-experience/world-presets/coast-valley'
import {FlightSimulation,ZERO_INPUT} from '../../src/flight-experience/simulation'
import manifest from '../../src/flight-experience/assets/lookdev-materials/manifest.json'
it('keeps distinct morph and far-coverage programs when sharing the terrain material library',()=>{
 const library=Array.from({length:4},()=>{const m=new MeshStandardMaterial({map:new Texture(),normalMap:new Texture()});m.userData.stochastic={gaussian:new Texture(),inverse:new Texture(),metresPerRepeat:2};return m})
 const near=new MeshStandardMaterial(),far=new MeshStandardMaterial()
 near.customProgramCacheKey=()=> 'morph';far.customProgramCacheKey=()=> 'coverage'
 const trial={method:'histogram',channel:'pbr',scale:1,layers:4} as const,origin={value:new Vector2()}
 decorateMaterialTerrain(near,library,trial,origin);decorateMaterialTerrain(far,library,trial,origin)
 expect(near.customProgramCacheKey()).not.toBe(far.customProgramCacheKey())
 expect(near.map).toBe(far.map);expect(near.normalMap).toBe(far.normalMap)
 near.dispose();far.dispose();for(const m of library){m.map?.dispose();m.normalMap?.dispose();const data=m.userData.stochastic as {gaussian:Texture;inverse:Texture};data.gaussian.dispose();data.inverse.dispose();m.dispose()}
})
it('binds the same review uniform and six-weight vertex contract on near and far programs',()=>{
 const library=Array.from({length:6},()=>{const m=new MeshStandardMaterial({map:new Texture(),normalMap:new Texture()});m.userData.stochastic={gaussian:new Texture(),inverse:new Texture(),metresPerRepeat:2};return m})
 const review={value:new Vector2(1,0)},origin={value:new Vector2()},trial={method:'histogram',channel:'pbr',scale:1,layers:4} as const
 for(const material of [new MeshStandardMaterial(),new MeshStandardMaterial()]){
  decorateMaterialTerrain(material,library,trial,origin,review)
  const shader={uniforms:{} as Record<string,unknown>,vertexShader:'#include <common>\n#include <worldpos_vertex>',fragmentShader:'#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <dithering_fragment>\n#include <aomap_fragment>'}
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0],{} as Parameters<typeof material.onBeforeCompile>[1])
  expect(shader.uniforms.surfaceReview).toBe(review)
  expect(shader.vertexShader).toContain('surfaceWeightsB')
  expect(shader.fragmentShader).toContain('colors[best]')
  expect(shader.fragmentShader).toContain('trialAlbedoAtlas')
  expect(shader.fragmentShader).toContain('sampler2DArray trialAlbedoAtlas')
  expect(shader.fragmentShader).toContain('float fade=smoothstep(0.005,0.02,footprint)')
  expect(shader.fragmentShader).toContain('textureLod(trialRawAlbedo,vec3(.5,.5,1.0),9.)')
  expect(shader.fragmentShader).toContain('if(surfaceReview.x==11.)color=textureGrad(trialRawAlbedo')
  expect(shader.fragmentShader).toContain('if(surfaceReview.x==12.)color=trialSample(trialRawAlbedo')
  expect(shader.fragmentShader).toContain('if(surfaceReview.x==11.||surfaceReview.x==12.)gl_FragColor=')
  expect(shader.fragmentShader).not.toContain('reviewZone')
  expect(shader.fragmentShader).toContain('return vec4(a.x,a.y,a.z,b.x)')
  expect(shader.fragmentShader).toContain('trialExtraWeights')
  material.dispose()
 }
 for(const m of library)m.dispose()
})
it('uses verified physical widths for six independent PBR sources',()=>{
 expect(Object.fromEntries(manifest.entries.map(entry=>[entry.id,entry.metresPerRepeat]))).toEqual({aerial_ground_rock:20,sandy_gravel_02:2.5,coast_sand_01:15,mud_forest:2.3,forest_ground_04:3.2,leafy_grass:2})
})
it('locks automatic and source flight to the original clip only',()=>{
 expect(animationWeights('auto')).toEqual({source:1,powered:0,glide:0})
 expect(animationWeights('source')).toEqual({source:1,powered:0,glide:0})
})
it('classifies real coast, raised riverbank, dry slope, woodland, exposed rock and groundcover independently of LOD and quality',()=>{
 const world=createWorldSampler(),locations:[number,number,string][]=[[281,600,'beach-sand'],[-10,-2400,'riparian-mud'],[400,-900,'mineral-soil'],[700,-900,'organic-floor'],[300,-2200,'rock'],[1200,-700,'low-groundcover']]
 for(const [x,z,name] of locations){
  const context=surfaceContext(world,x,z),sample=classifySurface(context)
  expect(sample.dominant).toBe(name);expect(sample.weights.every(w=>Number.isFinite(w)&&w>=0&&w<=1)).toBe(true)
  expect(sample.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1,8)
  const sources=pbrSourceWeights(sample.weights)
  expect(sources.reduce((a,b)=>a+b,0)).toBeCloseTo(1,8)
  expect(sources.every(weight=>weight>=0&&weight<=1)).toBe(true)
  expect(classifySurface(surfaceContext(world,x,z))).toEqual(sample)
 }
 expect(surfaceContext(world,-10,-2400).height).toBeGreaterThan(14)
 expect(SURFACE_NAMES).toHaveLength(6)
})
it('keeps a wet cliff rocky, and dry low inland ground mineral rather than beach',()=>{
 const base=surfaceContext(createWorldSampler(),700,-900)
 expect(classifySurface({...base,slope:.6,water:{valid:true,kind:'river',distance:2,relativeLevel:1}}).dominant).toBe('rock')
 expect(classifySurface({...base,height:1,slope:0,woodland:.1,moisture:.1,water:{valid:false,kind:'none',distance:Infinity,relativeLevel:Infinity}}).dominant).toBe('mineral-soil')
 expect(classifySurface({...base,water:{valid:true,kind:'sea',distance:NaN,relativeLevel:NaN}}).weights.every(Number.isFinite)).toBe(true)
})
it('attaches identical six-channel semantics in logical world coordinates across origins',()=>{
 const world=createWorldSampler(),make=(localX:number,originX:number)=>{const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array([localX,0,-900]),3));attachSurfaceAttributes(g,world,originX,0);return g}
 const a=make(188,512),b=make(700,0)
 for(const key of ['surfaceWeightsA','surfaceWeightsB'])expect([...a.getAttribute(key).array]).toEqual([...b.getAttribute(key).array])
 a.dispose();b.dispose()
})
it('keeps all six semantic regions on an eight-metre continuous coast-to-upland route without a hard river-mouth switch',()=>{
 const world=createWorldSampler(),points=[[281,600],[100,-900],[-10,-2400],[300,-2200],[400,-900],[700,-900],[1200,-700]],seen=new Set<string>()
 let previous:readonly number[]|undefined
 for(let segment=1;segment<points.length;segment++){
  const [ax,az]=points[segment-1]!,[bx,bz]=points[segment]!,steps=Math.ceil(Math.hypot(bx!-ax!,bz!-az!)/8)
  for(let i=0;i<=steps;i++){
   const value=classifySurface(surfaceContext(world,ax!+(bx!-ax!)*i/steps,az!+(bz!-az!)*i/steps))
   seen.add(value.dominant)
   if(previous)expect(Math.max(...value.weights.map((weight,index)=>Math.abs(weight-previous![index]!)))).toBeLessThan(.4)
   previous=value.weights
  }
 }
 expect(seen).toEqual(new Set(SURFACE_NAMES))
})
it('starts every M1 review anchor above the conservative flight safety envelope and remains flyable',()=>{
 const world=createWorldSampler(),surface=createLandscapeSurface(world,coastValleyLandmarks(world))
 for(const anchor of CAPTURE_ANCHORS.filter(a=>a.id.startsWith('m1-'))){
  const {x,y,z}=anchor.position,heading=anchor.heading
  for(let metres=0;metres<=220;metres+=10)for(const lateral of [-12,0,12]){
   const sx=x+Math.sin(heading)*metres+Math.cos(heading)*lateral,sz=z-Math.cos(heading)*metres+Math.sin(heading)*lateral
   expect(y-surface(sx,sz),`${anchor.id} at ${metres}m`).toBeGreaterThan(40)
  }
  const simulation=new FlightSimulation(surface)
  Object.assign(simulation.position,anchor.position);simulation.heading=heading;simulation.clearAccumulator()
  for(let frame=0;frame<300;frame++)simulation.advance(1/60,ZERO_INPUT)
  expect(simulation.safetyStop,anchor.id).toBe(false)
  expect(simulation.time).toBeGreaterThan(4.9)
 }
})
it('frames the M1 beach review along a coast with water and land both in front',()=>{
 const anchor=CAPTURE_ANCHORS.find(a=>a.id==='m1-beach')!
 const world=createWorldSampler()
 const aheadZ=anchor.position.z-Math.cos(anchor.heading)*80
 const aheadX=anchor.position.x+Math.sin(anchor.heading)*80
 expect(Math.abs(aheadX-world.shorelineAt(aheadZ))).toBeLessThan(90)
 expect(world.terrainAt(aheadX-80,aheadZ).height).toBeLessThan(0)
 expect(world.terrainAt(aheadX+80,aheadZ).height).toBeGreaterThan(0)
})
