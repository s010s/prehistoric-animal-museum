import {afterEach,expect,it,vi} from 'vitest'
import {Group,type InstancedMesh,Mesh,MeshStandardMaterial,PerspectiveCamera,ShaderLib,Texture,TextureLoader,type WebGLRenderer} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {VegetationWind,vegetationPhase,vegetationWeight,windVertexShader} from '../../src/flight-experience/living/vegetation-wind'
import {PropStream} from '../../src/flight-experience/props/prop-stream'
import {dimensions} from '../../src/flight-experience/props/prop-lod'
import {realPropFixture} from './helpers/real-prop-fixture'
afterEach(()=>vi.restoreAllMocks())
it('locks roots and lower trunk, uses a smooth bounded profile with consistent derivative',()=>{
 for(const tree of [false,true])for(const height of [1,13,17]){
  const root=-.25
  for(const y of [root-1,root,root+height*.1])expect(vegetationWeight(y,root,height,tree)).toEqual({weight:0,derivative:0})
  expect(vegetationWeight(root+height,root,height,tree).weight).toBe(1)
  for(let y=root+height*.4;y<root+height*.98;y+=height*.05){
   const actual=vegetationWeight(y,root,height,tree),h=.00001
   const numerical=(vegetationWeight(y+h,root,height,tree).weight-vegetationWeight(y-h,root,height,tree).weight)/(2*h)
   expect(actual.derivative).toBeCloseTo(numerical,7);expect(actual.weight).toBeGreaterThanOrEqual(0);expect(actual.weight).toBeLessThanOrEqual(1)
  }
 }
})
it('keeps independent fixed-rate motion phase while strength changes, pauses and turns off exactly',()=>{
 const wind=new VegetationWind(),camera=new PerspectiveCamera();camera.position.set(4,120,-20)
 wind.update(100,1,camera);expect(wind.uniforms.flightWindStrength.value).toBe(0)
 wind.update(100.2,1,camera);expect(wind.uniforms.flightWindStrength.value).toBeCloseTo(.3)
 wind.update(100.2,1,camera);expect(wind.uniforms.flightWindStrength.value).toBeCloseTo(.3)
 wind.update(100.2,0,camera);expect(wind.uniforms.flightWindStrength.value).toBe(0)
 wind.update(101,0,camera);expect(wind.uniforms.flightWindStrength.value).toBe(0)
 wind.update(102,1,camera,true);expect(wind.uniforms.flightWindStrength.value).toBe(.3)
 expect(wind.uniforms.flightWindTime.value).toBe(102);expect(wind.uniforms.flightWindCamera.value).toEqual(camera.position)
 expect(vegetationPhase('tree-A')).not.toBe(vegetationPhase('tree-B'))
})
it('applies the same decoded metre displacement to colour/depth/distance and preserves material settings',()=>{
 const wind=new VegetationWind(),source=new MeshStandardMaterial({map:new Texture(),roughness:.81,alphaTest:.4})
 source.normalScale.setScalar(.45)
 const materials=wind.decorate(source,-.25,13,true)
 expect(materials.color.roughness).toBe(source.roughness);expect(materials.color.normalScale).toEqual(source.normalScale)
 for(const material of Object.values(materials)){expect(material.map).toBe(source.map);expect(material.alphaTest).toBe(source.alphaTest)}
 for(const shader of [ShaderLib.standard,ShaderLib.depth,ShaderLib.distance]){
  const vertex=windVertexShader(shader.vertexShader)
  expect(vertex).toContain('transformed+=flightWindBend(position.y,false)')
  expect(vertex.indexOf('transformed+=flightWindBend')).toBeLessThan(vertex.indexOf('#include <project_vertex>'))
 }
 const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}}
 materials.color.onBeforeCompile(shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0],{} as WebGLRenderer)
 expect(shader.uniforms).toHaveProperty('flightWindStrength',wind.uniforms.flightWindStrength)
 Object.values(materials).forEach(m=>m.dispose());source.map!.dispose();source.dispose()
})
it('uses stable ID phases across all real LODs and origin relocations without new batches or rock deformation',async()=>{
 const fixture=await realPropFixture()
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue(fixture)
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockResolvedValue(new Texture())
 const prop={id:'wind-tree',x:8,y:20,z:8,scale:4,yaw:1.2,kind:'plant' as const,priority:.1}
 const stream=new PropStream(new Group(),()=>{},()=>20,{scatter:address=>address.x===0&&address.z===0?[prop]:[]})
 await new Promise(resolve=>setTimeout(resolve,0))
 const sourceMeshes=fixture.scene.children.reduce((sum,root)=>{let count=0;root.traverse(p=>{if(p instanceof Mesh)count++});return sum+count},0)
 expect(stream.root.children.length).toBe(sourceMeshes)
 let phase:number|undefined
 for(const lod of [0,1,2] as const){
  for(let f=0;f<90;f++)stream.update(8,25,8,'balanced',{fixedLod:lod})
  const pool=stream.root.children.find(m=>m.name===`${dimensions(prop).asset}-lod${lod}`) as InstancedMesh
  const value=pool.geometry.getAttribute('flightWindPhase').getX(0)
  if(phase===undefined)phase=value;else expect(value).toBe(phase)
  expect(pool.customDepthMaterial).toBeDefined();expect(pool.customDistanceMaterial).toBeDefined()
  const batches=stream.metrics.batches,uploads=stream.metrics.matrixUploads
  stream.setWind(10,1);stream.setWind(11,1);stream.update(8,25,8,'balanced',{fixedLod:lod})
  expect(stream.metrics.batches).toBe(batches);expect(stream.metrics.matrixUploads).toBe(uploads)
  stream.relocate({x:8192,z:-8192});stream.update(8,25,8,'balanced',{fixedLod:lod})
  expect(pool.geometry.getAttribute('flightWindPhase').getX(0)).toBe(phase)
 }
 for(const child of stream.root.children){
  const mesh=child as InstancedMesh
  if(/^(rock|cliff)-/.test(mesh.name)){expect(mesh.geometry.getAttribute('flightWindPhase')).toBeUndefined();expect(mesh.customDepthMaterial).toBeUndefined()}
 }
 stream.dispose()
})
