import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from 'three'
import { inspectScaleEncounterSceneResources } from '../src/viewer/scale-encounter-performance'

describe('scale encounter performance diagnostics', () => {
  it('publishes de-duplicated texture and geometry memory estimates for the review canvas', () => {
    const texture = new Texture({ height: 512, width: 1024 })
    texture.generateMipmaps = true
    const material = new MeshBasicMaterial({ map: texture })
    const geometry = new BoxGeometry(1, 1, 1)
    const root = new Group()
    root.add(
      new Mesh(geometry, material),
      new Mesh(geometry, material),
      new InstancedMesh(geometry, material, 25),
    )

    const resources = inspectScaleEncounterSceneResources(root)

    expect(resources.textureCount).toBe(1)
    expect(resources.estimatedTextureBytes).toBe(
      Math.ceil(1024 * 512 * 4 * (4 / 3)),
    )
    expect(resources.geometryCount).toBe(1)
    expect(resources.instancedMeshCount).toBe(1)
    expect(resources.instanceCount).toBe(25)
    expect(resources.estimatedGeometryBytes).toBeGreaterThan(
      geometry.getAttribute('position').array.byteLength,
    )
    expect(resources.transparentMaterialCount).toBe(0)
  })
})
