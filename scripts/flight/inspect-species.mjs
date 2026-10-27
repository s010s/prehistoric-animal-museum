// Read-only audit of source GLBs. Texture stripping happens in memory only.
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {AnimationMixer,Box3,Vector3} from 'three'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
await MeshoptDecoder.ready;await MeshoptEncoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder})
const results=[]
for(const id of ['pteranodon','tupandactylus','rhamphorhynchus','archaeopteryx','meganeura']){
 const path=`src/content/animals/${id}/model/model.glb`,source=await readFile(path),doc=await io.read(path)
 const root=doc.getRoot(),materials=root.listMaterials().length,textures=root.listTextures().length
 for(const t of root.listTextures())t.dispose()
 for(const e of root.listExtensionsUsed())e.dispose()
 const bytes=await io.writeBinary(doc),g=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const clip=g.animations.find(c=>c.name==='Idle'),m=new AnimationMixer(g.scene),envelope=new Box3()
 let triangles=0,vertices=0,bones=0,morphTargets=0
 g.scene.traverse(mesh=>{if(mesh.isMesh){vertices+=mesh.geometry.attributes.position.count;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;morphTargets+=mesh.morphTargetInfluences?.length??0;bones+=mesh.skeleton?.bones.length??0}})
 if(clip)m.clipAction(clip).play()
 m.setTime(0);g.scene.updateMatrixWorld(true)
 const initial=new Box3().setFromObject(g.scene,true)
 for(let i=0;i<=120;i++){m.setTime((clip?.duration??0)*i/120);g.scene.updateMatrixWorld(true);g.scene.traverse(mesh=>mesh.skeleton?.update());envelope.union(new Box3().setFromObject(g.scene,true))}
 results.push({id,path,sha256:createHash('sha256').update(source).digest('hex'),bytes:source.length,materials,textures,triangles,vertices,bones,morphTargets,animationKind:bones&&morphTargets?'hybrid':bones?'skeletal':morphTargets?'morph':'none',clips:g.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.map(t=>({name:t.name,type:t.ValueTypeName,samples:t.times.length}))})),initial:{min:initial.min.toArray(),max:initial.max.toArray(),size:initial.getSize(new Vector3()).toArray(),center:initial.getCenter(new Vector3()).toArray()},envelope:{min:envelope.min.toArray(),max:envelope.max.toArray(),size:envelope.getSize(new Vector3()).toArray()},samples:121,visualReview:'not_run'})
}
console.log(JSON.stringify({schema:'flight-species-audit-v1',results},null,2))
