import { afterEach, expect, it, vi } from 'vitest'
import { Group, InstancedMesh, Matrix4, Texture, TextureLoader } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PropStream } from '../../src/flight-experience/props/prop-stream'
import { realPropFixture } from './helpers/real-prop-fixture'
afterEach(() => vi.restoreAllMocks())

it('updates a moved landmark even when its ID/pool/scale and ground height are unchanged', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(await realPropFixture())
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const stream = new PropStream(new Group(), () => {}, () => 20, { scatter: () => [] }, undefined, { poolCapacity: 1 })
  await new Promise(resolve => setTimeout(resolve, 0))
  const landmark = { id: 'same-landmark', asset: 'cliff-0' as const, x: 10, y: 20, z: 30, scale: 1, yaw: 0 }
  stream.setLandmarks([landmark]); stream.update(0, 90, 0, 'low')
  stream.setLandmarks([{ ...landmark, x: 60, yaw: 1 }]); stream.update(0, 90, 0, 'low')
  const mesh = stream.root.children.find(child => child.name === 'cliff-0-lod0') as InstancedMesh
  const matrix = new Matrix4(); mesh.getMatrixAt(0, matrix); expect(matrix.elements[12]).toBe(60)
  stream.dispose()
})
