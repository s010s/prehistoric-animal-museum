import { describe,expect,it,vi } from 'vitest'
import { Group,type InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,Texture,TextureLoader,Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createWorldSampler } from '../../src/flight-experience/world'
import { FarCanopyLayer } from '../../src/flight-experience/props/far-canopy-layer'
import { PropStream } from '../../src/flight-experience/props/prop-stream'
import { realPropFixture } from './helpers/real-prop-fixture'

describe('R5 static ecology continuity',()=>{
 it('preloads both sides of a turn even when all preparation is denied during the turn',()=>{
  const world=createWorldSampler(),geometry=new PlaneGeometry(8,14),material=new MeshStandardMaterial()
  const layer=new FarCanopyLayer(new Group(),world,{templates:()=>['tree-0-0','tree-0-1','tree-1-0','tree-1-1'].map(asset=>({asset,parts:[{geometry,material}]})),hasRepresentation:()=>false,surface:(x,z)=>world.terrainAt(x,z).height})
  const camera=new PerspectiveCamera(55,1,.5,5000);camera.position.set(1000,130,0);camera.lookAt(1000,130,-500)
  for(let i=0;i<480;i++)layer.update(camera,{x:0,z:0},'low')
  const positions:Vector3[]=[],matrix=new Matrix4()
  for(const mesh of layer.root.children as InstancedMesh[])for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);positions.push(new Vector3().setFromMatrixPosition(matrix))}
  expect(positions.some(p=>p.z<-200)).toBe(true);expect(positions.some(p=>p.z>200)).toBe(true)
  const submitted=layer.metrics.submitted;camera.lookAt(1000,130,500)
  layer.update(camera,{x:0,z:0},'low',{canStart:()=>false,measure:(_label,fn)=>fn()})
  expect(layer.metrics.submitted).toBe(submitted);expect(layer.metrics.overflow).toBe(0)
  layer.dispose();geometry.dispose();material.dispose()
 })
 it('keeps stable source asset and scale while replacing LOD and synchronously regrounds visible trees',async()=>{
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue(await realPropFixture());vi.spyOn(TextureLoader.prototype,'loadAsync').mockResolvedValue(new Texture())
  let height=20
  const prop={id:'r5-same-tree',x:30,z:30,y:20,scale:4,yaw:.3,kind:'plant' as const,priority:.1}
  const stream=new PropStream(new Group(),()=>{},()=>height,{scatter:a=>a.x===0&&a.z===0?[prop]:[]})
  await new Promise(resolve=>setTimeout(resolve,0))
  for(let i=0;i<100;i++)stream.update(30,80,40,'low',{fixedLod:2,groundEpoch:1})
  const far=stream.inspectObject(prop.id)!
  height=55;stream.update(30,80,40,'low',{fixedLod:0,groundEpoch:2})
  const near=stream.inspectObject(prop.id)!
  expect(near.pool.replace(/lod\d$/,'')).toBe(far.pool.replace(/lod\d$/,''));expect(near.matrix[0]).toBeCloseTo(far.matrix[0]!,7)
  expect(near.matrix[13]).toBe(55);expect(stream.hasSubmittedRepresentation(prop.id)).toBe(true)
  stream.dispose();vi.restoreAllMocks()
 })
 it('keeps river water downhill, cuts its bed below water and excludes trees from the channel',()=>{
  const world=createWorldSampler();let previous=Infinity
  for(let s=20;s<2990;s+=20){const station=world.river.station(s),q=world.river.query(station.x,station.z)!
   expect(station.waterLevel).toBeLessThanOrEqual(previous+1e-8);previous=station.waterLevel
   expect(world.terrainAt(station.x,station.z).height).toBeLessThan(station.waterLevel)
   expect(q.depth).toBeGreaterThan(.7)
  }
  const kinds=new Set<string>()
  for(let z=-5;z<=1;z++)for(let x=0;x<=2;x++)for(const prop of world.scatter({x,z})){kinds.add(prop.kind);expect(world.river.query(prop.x,prop.z)?.signedBankDistance??1000).toBeGreaterThan(prop.kind==='understory'?1:6)}
  expect([...kinds].sort()).toEqual(['cliff','plant','rock','understory'])
 })
})
