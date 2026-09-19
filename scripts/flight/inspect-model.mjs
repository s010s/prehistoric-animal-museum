import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AnimationMixer, Box3, Vector3 } from 'three'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
const input = 'src/content/animals/pteranodon/model/model.glb'
await MeshoptDecoder.ready; await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(input)
// Texture-free in-memory copy for geometry/rig inspection; never writes the source GLB.
for (const texture of doc.getRoot().listTextures()) texture.dispose()
for (const extension of doc.getRoot().listExtensionsUsed()) extension.dispose()
const binary = await io.writeBinary(doc)
const gltf = await new GLTFLoader().parseAsync(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), '')
const clip = gltf.animations.find(a => a.name === 'Idle')
if (!clip) throw new Error('Expected reviewed Idle animation')
const mixer = new AnimationMixer(gltf.scene); mixer.clipAction(clip).play()
const bounds = new Box3(), samples = []
const head = gltf.scene.getObjectByName('head15_15') ?? gltf.scene.getObjectByName('head.15_15')
const nodeNames = []; gltf.scene.traverse(n=>nodeNames.push(n.name))
for (let frame=0;frame<120;frame++) {
  const time=clip.duration*frame/120; mixer.setTime(time); gltf.scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(gltf.scene, true); bounds.union(box)
  const size=box.getSize(new Vector3());samples.push({time,min:box.min.toArray(),max:box.max.toArray(),size:size.toArray()})
}
const buffer=await fs.readFile(input)
const report={input,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),bytes:buffer.length,duration:clip.duration,
  tracks:clip.tracks.length,dynamicBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},samples,nodeNames,head:head?.getWorldPosition(new Vector3()).toArray()}
await fs.mkdir('.flight-evidence',{recursive:true});await fs.writeFile('.flight-evidence/rig-report.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({...report,samples:samples.filter((_,i)=>i%20===0),nodeNames:nodeNames.filter(n=>/head|pelvis|wing0[14]|upperArm/.test(n))},null,2))
// Author a separate, seamless glide: widest nearly horizontal pose, small mirrored
// shoulder flex, no root translation. This is an artistic candidate, not a scientific assertion.
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
const pose = [...samples].sort((a,b) => (b.size[0] - b.size[1]*.25) - (a.size[0] - a.size[1]*.25))[0]
const times = Array.from({length:17},(_,i)=>i/4)
const tracks = clip.tracks.map(track => {
  const base = track.createInterpolant().evaluate(pose.time)
  const values=[]
  for (const time of times) {
    const value=Array.from(base)
    if (track.ValueTypeName === 'quaternion' && /upperArm|foreArm/.test(track.name)) {
      const side = track.name.startsWith('R') ? -1 : 1
      const q = new Quaternion().fromArray(value)
      q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),side*.014*Math.sin(time/4*Math.PI*2))).normalize()
      values.push(...q.toArray())
    } else values.push(...value)
  }
  const Track = track.ValueTypeName === 'quaternion' ? QuaternionKeyframeTrack : VectorKeyframeTrack
  return new Track(track.name,times,values)
})
const glide = new AnimationClip('Glide',4,tracks)
const glideAction=mixer.clipAction(glide);mixer.stopAllAction();glideAction.play()
const glideBounds=new Box3()
for(let i=0;i<=120;i++){mixer.setTime(i/30);gltf.scene.updateMatrixWorld(true);glideBounds.union(new Box3().setFromObject(gltf.scene,true))}
const output='src/flight-experience/assets/pteranodon-glide.json'
await fs.mkdir('src/flight-experience/assets',{recursive:true})
const clipJson = AnimationClip.toJSON(glide)
clipJson.uuid = 'f1937060-0001-4000-8000-000000000001'
await fs.writeFile(output,JSON.stringify(clipJson))
const outputBytes=await fs.readFile(output)
const sharedAssets = await Promise.all([
  ['src/scale-encounter/assets/environments/surface-land-albedo-1024.webp','Poly Haven CC0 scan derivative'],
  ['src/scale-encounter/assets/environments/midground-mature-tree-atlas-v1-1024.webp','Project original, CC-BY-NC-SA-4.0'],
].map(async ([source,license]) => { const bytes=await fs.readFile(source);return {source,license,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),provenance:'src/scale-encounter/assets/PROVENANCE.md'} }))
await fs.writeFile('src/flight-experience/assets/manifest.json',JSON.stringify({version:1,sharedAssets,reviewStatus:'needs_review',
  source:input,sourceSha256:report.sha256,sourceLicense:'CC-BY-4.0',author:'Chistodrako._. / Oscar López Riviello',sourceUrl:'https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
  output,sha256:crypto.createHash('sha256').update(outputBytes).digest('hex'),bytes:outputBytes.length,
  recipe:'scripts/flight/inspect-model.mjs',poseTime:pose.time,duration:4,
  modifications:'Selected widest horizontal source pose; authored 4s mirrored shoulder/forearm flex ±0.014 radians; all translations remain fixed; original Idle unchanged.',
  bounds:{min:glideBounds.min.toArray(),max:glideBounds.max.toArray()},approval:null},null,2)+'\n')
console.log('Glide candidate:',pose.time,outputBytes.length,glideBounds.min.toArray(),glideBounds.max.toArray())
