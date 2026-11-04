import {AnimationMixer,Vector3} from 'three'
import {expect,it} from 'vitest'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {sourcePoweredMotion} from '../../src/flight-experience/source-powered-motion'
it('retains articulated wrist, elbow and head motion from the real source in a seamless climb loop',async()=>{
 await MeshoptDecoder.ready
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
 const doc=await io.read('src/content/animals/pteranodon/model/model.glb')
 for(const t of doc.getRoot().listTextures())t.dispose()
 for(const e of doc.getRoot().listExtensionsUsed())e.dispose()
 const binary=await io.writeBinary(doc)
 const gltf=await new GLTFLoader().parseAsync(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),'')
 const source=gltf.animations.find(a=>a.name==='Idle')!,powered=sourcePoweredMotion(source)
 for(const track of powered.tracks){
  const n=track.getValueSize()
  for(let i=0;i<n;i++)expect(track.values[track.values.length-n+i]).toBeCloseTo(track.values[i]!,5)
  expect(Array.from(track.values).every(Number.isFinite)).toBe(true)
 }
 for(const joint of ['upperArm','foreArm','wing','head']){
  const tracks=powered.tracks.filter(t=>t.name.includes(joint)&&t.ValueTypeName==='quaternion')
  expect(tracks.length).toBeGreaterThan(0)
  expect(tracks.some(t=>Array.from(t.values).some((v,i)=>Math.abs(v-t.values[i%4]!)>.01))).toBe(true)
 }
 // Two loops must contain two full downstrokes and two recoveries, with no
 // extra small beat at the join. Measure the real rig, not just track values.
 const mixer=new AnimationMixer(gltf.scene);mixer.clipAction(powered).play()
 for(const name of ['Lwing08_End39_39','Rwing08_End69_69']){
  const tip=gltf.scene.getObjectByName(name)!,height:number[]=[]
  expect(tip).toBeDefined()
  for(let i=0;i<=180;i++){mixer.setTime(i/60);gltf.scene.updateMatrixWorld(true);height.push(tip.getWorldPosition(new Vector3()).y)}
  const maxima:number[]=[],minima:number[]=[]
  for(let i=1;i<height.length-1;i++){
   const before=height[i]!-height[i-1]!,after=height[i+1]!-height[i]!
   if(before>0&&after<0)maxima.push(height[i]!)
   if(before<0&&after>0)minima.push(height[i]!)
  }
  expect(maxima).toHaveLength(2);expect(minima).toHaveLength(2)
  expect(maxima[0]).toBeCloseTo(maxima[1]!,5);expect(minima[0]).toBeCloseTo(minima[1]!,5)
 }

})
