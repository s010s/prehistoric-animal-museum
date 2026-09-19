import {it,expect} from 'vitest'
import {BufferGeometry,Int16BufferAttribute,Matrix4,Vector3,Mesh,Box3,type Material} from 'three'
import {bakePropGeometry} from '../../src/flight-experience/props/bake-prop-geometry'
it('preserves a quantized glTF tree height while baking its node transform',()=>{
 const source=new BufferGeometry();source.setAttribute('position',new Int16BufferAttribute([0,-32767,0,0,32767,0],3,true))
 const matrix=new Matrix4().makeScale(6.75,6.75,6.75);matrix.setPosition(0,6.5,0)
 const geometry=bakePropGeometry(source,matrix)
 expect(geometry.boundingBox!.getSize(new Vector3()).y).toBeCloseTo(13.5)
 expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array)
 expect(source.getAttribute('position').getY(1)).toBe(1)
 geometry.dispose();source.dispose()
})

it('keeps every shipped tree LOD at its authored metre-scale height',async()=>{
 const {realPropFixture}=await import('./helpers/real-prop-fixture')
 const {scene}=await realPropFixture();let checked=0
 for(const root of scene.children){
  if(!root.name.startsWith('tree-'))continue
  const bounds=new Box3()
  root.traverse(object=>{if(object instanceof Mesh){
   const mesh=object as Mesh<BufferGeometry,Material>
   expect(mesh.geometry.getAttribute('position').normalized).toBe(true)
   const baked=bakePropGeometry(mesh.geometry,mesh.matrixWorld)
   bounds.union(baked.boundingBox!);baked.dispose();mesh.geometry.dispose();mesh.material.dispose()
  }})
  expect(bounds.getSize(new Vector3()).y).toBeGreaterThan(10)
  expect(bounds.getSize(new Vector3()).y).toBeLessThan(18)
  checked++
 }
 expect(checked).toBe(12)
})
