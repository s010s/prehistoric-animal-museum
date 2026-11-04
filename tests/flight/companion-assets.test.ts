import {readFile} from 'node:fs/promises'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {Mesh,MeshStandardMaterial,type Object3D,type BufferGeometry,type Material} from 'three'
import {expect,it} from 'vitest'
import {ownFarCompanionTemplate} from '../../src/flight-experience/living/companion-assets'

it.each(['tupandactylus','rhamphorhynchus'])('preserves independent morph phases for %s',async id=>{
 const bytes=await readFile(`src/flight-experience/assets/companions/${id}-far.glb`)
 const buffer=new ArrayBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes)
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer,'')
 const named=new Map<string,Material>()
 gltf.scene.traverse(object=>{if(object instanceof Mesh)for(const m of materialsOf(object as Mesh<BufferGeometry,Material|Material[]>)){const hero=new MeshStandardMaterial();hero.name=m.name;named.set(m.name,hero)}})
 const library=ownFarCompanionTemplate(gltf.scene,gltf.animations[0]!,[...named.values()][0]!,named)
 const a=library.create(),b=library.create({phase:2})
 const morphs=(root:Object3D)=>{const values:number[][]=[];root.traverse(o=>{if(o instanceof Mesh&&o.morphTargetInfluences)values.push([...o.morphTargetInfluences])});return values}
 expect(morphs(a.root)).not.toEqual(morphs(b.root))
 const other=morphs(b.root);a.setMotionSeconds(1);expect(morphs(b.root)).toEqual(other)
 library.dispose();a.dispose();b.dispose()
})

function materialsOf(mesh:Mesh<BufferGeometry,Material|Material[]>):Material[]{return Array.isArray(mesh.material)?mesh.material:[mesh.material]}
