import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
/** Reads/decompresses the actual candidate GLB. Only browser image decoding is
 * omitted in Node: topology, normals, UVs, transforms and material side/alpha are real. */
export async function realPropFixture(): Promise<GLTF> {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const document = await io.read('src/flight-experience/assets/ecology-r5/ecology-r5.glb')
  const scene = new Group()
  for (const node of document.getRoot().listNodes()) {
    if (!node.getMesh()) continue
    const group = new Group(); group.name = node.getName(); group.applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()))
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const geometry = new BufferGeometry()
      for (const [semantic, attribute] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']] as const) {
        const accessor = primitive.getAttribute(semantic)
        if (accessor) {
          // Preserve the same normalized integer buffers used by GLTFLoader.
          // Pre-decoding to floats here would hide transform overflow in production.
          const values=accessor.getArray()!.slice()
          geometry.setAttribute(attribute,new BufferAttribute(values as ConstructorParameters<typeof BufferAttribute>[0],accessor.getElementSize(),accessor.getNormalized()))
        }
      }
      const indices = primitive.getIndices(); if (indices) geometry.setIndex(new BufferAttribute(Uint32Array.from(indices.getArray()!), 1))
      const materialSource = primitive.getMaterial(), material = new MeshStandardMaterial({ side: materialSource?.getDoubleSided() ? DoubleSide : FrontSide, alphaTest: materialSource?.getAlphaCutoff() ?? 0, roughness: materialSource?.getRoughnessFactor() ?? 1 })
      group.add(new Mesh(geometry, material))
    }
    scene.add(group)
  }
  scene.updateMatrixWorld(true)
  return { scene } as unknown as GLTF
}
