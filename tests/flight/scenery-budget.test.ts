import { afterEach, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Texture, TextureLoader } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FlightScenery } from '../../src/flight-experience/scenery'
import manifest from '../../src/flight-experience/assets/landscape/manifest.json'
afterEach(() => vi.restoreAllMocks())
it('keeps small prop cells, global instance pools and at most one replacement cell per frame across quality changes', async () => {
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const scene = new Group()
  for (const asset of manifest.assets) for (let lod = 0; lod < 3; lod++) { const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); mesh.name = `${asset.id}-lod${lod}`; scene.add(mesh) }
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({ scene } as unknown as GLTF)
  const scenery = new FlightScenery(new Scene(), () => {}, () => 0)
  await new Promise(resolve => setTimeout(resolve, 0))
  for (let i = 0; i < 240; i++) {
    scenery.update(i * 12, 200, -i * 20, i / 60, i < 120 ? 'low' : 'balanced')
    expect(scenery.metrics.installedThisFrame).toBeLessThanOrEqual(1)
    expect(scenery.metrics.cells).toBeLessThanOrEqual(169)
    expect(scenery.metrics.pending).toBeLessThanOrEqual(169)
    expect(scenery.metrics.instances).toBeLessThanOrEqual(169 * 16 + 2)
    expect(scenery.metrics.batches).toBeLessThanOrEqual(32)
    expect(scenery.metrics.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
  }
  const before = scenery.metrics.cells
  scenery.update(239 * 12, 200, -239 * 20, 4, 'low')
  expect(scenery.metrics.cells).toBeGreaterThan(1); expect(before).toBeGreaterThan(1)
  scenery.dispose(); scenery.dispose(); expect(scenery.root.parent).toBeNull()
})
