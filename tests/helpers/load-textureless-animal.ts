import { AnimationMixer } from 'three'
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'meshoptimizer'

/** Exercise the actual shipped skeleton and compressed skin without a browser
 * or image decoder. Materials are irrelevant to joint/vertex continuity. */
export async function loadTexturelessAnimalGltf(id: string) {
  const source = readFileSync(`src/content/animals/${id}/model/model.glb`)
  const jsonLength = source.readUInt32LE(12)
  const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString()) as { meshes: { primitives: { material?: number }[] }[] }
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const encoded = Buffer.from(JSON.stringify(document))
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32)
  encoded.copy(padded)
  const tail = source.subarray(20 + jsonLength)
  const header = Buffer.from(source.subarray(0, 20))
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  const buffer = Uint8Array.from(Buffer.concat([header, padded, tail])).buffer
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '')
  return gltf
}

export async function loadTexturelessAnimal(id: string, clipName?: string) {
  const gltf = await loadTexturelessAnimalGltf(id)
  if (clipName) {
    const clip = gltf.animations.find((animation) => animation.name === clipName)
    if (!clip) throw new Error(`Missing animation ${clipName}`)
    const mixer = new AnimationMixer(gltf.scene)
    mixer.clipAction(clip).play()
    mixer.setTime(0)
  }
  return gltf.scene
}
