import {expect,it} from 'vitest'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {BufferAttribute,BufferGeometry,Group,Mesh,MeshStandardMaterial,SkinnedMesh,Vector3,Raycaster,DoubleSide} from 'three'
import {preparePterosaurMotion} from '../src/viewer/pterosaur-motion'
import {animationWeights} from '../src/flight-experience/flight-animation-default'
import {FlightAnimationController} from '../src/flight-experience/flight-animation'

async function load(id:string){
 await MeshoptDecoder.ready
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
 const d=await io.read(`src/content/animals/${id}/model/model.glb`),root=new Group()
 for(const source of d.getRoot().listMeshes())for(const primitive of source.listPrimitives()){
  const g=new BufferGeometry()
  for(const [semantic,name] of [['POSITION','position'],['NORMAL','normal']] as const){const a=primitive.getAttribute(semantic)!;g.setAttribute(name,new BufferAttribute(a.getArray()!.slice() as ConstructorParameters<typeof BufferAttribute>[0],3,a.getNormalized()))}
  if(primitive.getIndices())g.setIndex(new BufferAttribute(Uint32Array.from(primitive.getIndices()!.getArray()!),1))
  g.morphTargetsRelative=true
  for(const [semantic,name] of [['POSITION','position'],['NORMAL','normal']] as const)g.morphAttributes[name]=primitive.listTargets().map(t=>{const a=t.getAttribute(semantic)!;return new BufferAttribute(a.getArray()!.slice() as ConstructorParameters<typeof BufferAttribute>[0],3,a.getNormalized())})
  const m=new Mesh(g,new MeshStandardMaterial());const names=source.getExtras().targetNames as string[];names.forEach((name,i)=>{m.morphTargetDictionary![name]=i});root.add(m)
 }
 return root
}
it('uses powered flight during sustained climbing and gliding during descent',()=>{
 const controller=new FlightAnimationController()
 for(let i=0;i<180;i++)controller.update(1/60,1,6)
 expect(animationWeights('auto',controller.poweredWeight,0)).toEqual({source:0,powered:1,glide:0})
 for(let i=0;i<120;i++)controller.update(1/60,-1,-4)
 expect(animationWeights('auto',controller.poweredWeight,1)).toEqual({source:0,powered:0,glide:1})
})

it('keeps the inner wing sheet below the Tupandactylus dorsal surface',async()=>{
 const root=await load('tupandactylus');preparePterosaurMotion(root,'tupandactylus',[]);root.updateMatrixWorld(true)
 const mesh=root.children[0] as SkinnedMesh;(mesh.material as MeshStandardMaterial).side=DoubleSide
 // Probe the actual intersecting shoulder surfaces, on both sides of the back.
 for(const x of [-.075,-.070,-.065])for(const z of [-.03,.03]){
  const hits=new Raycaster(new Vector3(x,1,z),new Vector3(0,-1,0)).intersectObject(mesh,false)
  expect(hits.length).toBeGreaterThanOrEqual(2)
  expect(hits[0]!.point.y-hits[1]!.point.y).toBeGreaterThan(.006)
 }
})
