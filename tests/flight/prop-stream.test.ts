import { afterEach, expect, it, vi } from 'vitest'
import { Group, InstancedMesh, Matrix4, PerspectiveCamera, type Mesh, Texture, TextureLoader } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PropStream } from '../../src/flight-experience/props/prop-stream'
import { cellKey, dimensions, propLod } from '../../src/flight-experience/props/prop-lod'
import { createWorldSampler } from '../../src/flight-experience/world'
import { CLIFF_SAMPLE, landmarkTop, sampleObstacleHeight } from '../../src/flight-experience/props/prop-obstacles'
import { realPropFixture } from './helpers/real-prop-fixture'
import manifest from '../../src/flight-experience/assets/ecology-r5/manifest.json'
afterEach(() => vi.restoreAllMocks())
it('keeps stable ownership and physical dimensions for positive/negative cells and every same-source LOD', () => {
  expect(cellKey(-.01, -128.01)).toBe('-1,-2')
  const sampler = createWorldSampler()
  for (const prop of sampler.scatter({ x: 2, z: -1 })) {
    const size = dimensions(prop), asset = manifest.assets.find(a => a.id === (size.asset==='cliff-0'?'cliff-group-0':size.asset))!
    expect(size.scale * asset.physicalHeight).toBeCloseTo(size.physicalHeight, 8)
    expect(size.physicalHeight).toBeLessThanOrEqual(16)
    for (let lod = 0; lod < 3; lod++) expect(asset.lods[lod]?.name).toBe(`${asset.id}-lod${lod}`)
  }
  expect(propLod(140, 0)).toBe(0); expect(propLod(151, 0)).toBe(1)
  expect(propLod(300, 2)).toBe(1); expect(propLod(500,2)).toBe(2); expect(propLod(284, 2)).toBe(1)
})
it('bounds cells, pooled allocations and one-cell installation through route, quality and origins', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(await realPropFixture())
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const surface = vi.fn(() => 20), stream = new PropStream(new Group(), () => {}, surface)
  await new Promise(resolve => setTimeout(resolve, 0))
  for (let frame = 0; frame < 450; frame++) {
    const quality = frame < 200 ? 'low' : 'balanced'
    stream.update(700 + frame * 3, 100, -frame * 2, quality)
    expect(stream.metrics.installedThisFrame).toBeLessThanOrEqual(1)
    expect(stream.metrics.cells).toBeLessThanOrEqual(169)
    expect(stream.metrics.instances).toBeLessThanOrEqual(169 * 48)
    // Nine textured ecological assets replace the old constant-colour geometry.
    // Node omits decoded images; actual browser total is separately capped at 96 MiB.
    expect(stream.metrics.bytes).toBeLessThan(16 * 1024 * 1024)
    if (frame === 150 || frame === 300) stream.relocate({ x: frame * 10, z: -frame * 10 })
  }
  for (let i = 0; i < 200; i++) stream.update(2000, 100, -900, 'balanced')
  surface.mockClear(); stream.update(2000, 100, -900, 'balanced'); expect(surface).not.toHaveBeenCalled()
  stream.markGroundDirty(['193706:1:1:3,-2']); stream.update(2000, 100, -900, 'balanced'); expect(surface.mock.calls.length).toBeLessThanOrEqual(16)
  stream.dispose(); stream.dispose(); expect(stream.root.parent).toBeNull(); expect(stream.metrics.bytes).toBe(0)
})
it('releases late resources and exits busy on asynchronous or synchronous loading failure', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => { throw new Error('offline') })
  const stream = new PropStream(new Group(), () => {}, () => 0)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(stream.metrics.failed).toBe(true); expect(stream.busy).toBe(false); stream.dispose()
})

it('uses the same conservative asset cylinder for fixed landmarks and nearby props', () => {
  const landmark = { id: 'gate', asset: 'cliff-0' as const, x: -20, y: 15, z: 10, scale: 2, yaw: 0 }
  expect(landmarkTop(landmark, -20, 10)).toBe(15 + CLIFF_SAMPLE.height * 2)
  expect(landmarkTop(landmark, -20 + CLIFF_SAMPLE.radius * 2 + .01, 10)).toBe(-Infinity)
  expect(sampleObstacleHeight({ scatter: () => [] }, -20, 10, [landmark])).toBe(15 + CLIFF_SAMPLE.height * 2)
})
it('disposes GLB results arriving after exit without starting silhouette downloads', async () => {
  let complete!: (value: GLTF) => void
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const textureLoad = vi.spyOn(TextureLoader.prototype, 'loadAsync')
  const stream = new PropStream(new Group(), () => {}, () => 0)
  await Promise.resolve(); stream.dispose()
  const fixture = await realPropFixture(), mesh = fixture.scene.children[0]!.children[0] as Mesh
  const dispose = vi.spyOn(mesh.geometry, 'dispose')
  complete(fixture); await new Promise(resolve => setTimeout(resolve, 0))
  expect(dispose).toHaveBeenCalledOnce(); expect(textureLoad).not.toHaveBeenCalled()
})
it('keeps old IDs and slots when a real-GLB pool cannot reserve an entire density diff, then retries', async () => {
  const fixture = await realPropFixture()
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(fixture)
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const first = { id: 'stable-0', x: 8, y: 20, z: 8, scale: 4, yaw: 0, kind: 'plant' as const, priority: .1 }
  let id = 1
  while (dimensions({ ...first, id: `stable-${id}` }).asset !== dimensions(first).asset) id++
  const second = { ...first, id: `stable-${id}`, x: 40, priority: .7 }
  const stream = new PropStream(new Group(), () => {}, () => 20, { scatter: address => address.x === 0 && address.z === 0 ? [first, second] : [] }, undefined, { poolCapacity: 1 })
  await new Promise(resolve => setTimeout(resolve, 0)); stream.setTracing(true)
  for (let frame = 0; frame < 90; frame++) stream.update(20, 80, 20, 'low')
  const before = stream.inspectObject(first.id)!
  expect(before).not.toBeNull()
  for (let frame = 0; frame < 100; frame++) stream.update(20, 80, 20, 'balanced')
  const retained = stream.inspectObject(first.id)!
  expect(retained.slot).toBe(before.slot); expect(retained.matrix).toEqual(before.matrix)
  expect(stream.inspectObject(second.id)).toBeNull(); expect(stream.metrics.slotFailures).toBeGreaterThan(0); expect(stream.metrics.pending).toBeGreaterThan(0)
  expect(stream.getLifecycleTrace().some(event => event.reason === 'pool-full-retry')).toBe(true)
  for (let frame = 0; frame < 100; frame++) stream.update(20, 80, 20, 'low')
  expect(stream.metrics.pending).toBe(0); expect(stream.inspectObject(first.id)?.slot).toBe(before.slot)
  stream.dispose()
})
it('retains trees around the whole camera while visibility changes during a turn', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(await realPropFixture())
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const records = [-450, 50].map((z, index) => ({ id: `view-${index}`, x: 1300, y: 20, z, scale: 4, yaw: 0, kind: 'plant' as const, priority: .2 }))
  const stream = new PropStream(new Group(), () => {}, () => 20, { scatter: address => records.filter(p => Math.floor(p.x / 512) === address.x && Math.floor(p.z / 512) === address.z) })
  await new Promise(resolve => setTimeout(resolve, 0))
  const camera = new PerspectiveCamera(45, 1, .1, 1500); camera.position.set(1300, 90, -200); camera.lookAt(1300, 40, -600)
  for (let frame = 0; frame < 200; frame++) stream.update(1300, 90, -200, 'balanced', { camera })
  const live = stream.metrics.instances, submitted = stream.metrics.submitted
  expect(live).toBeGreaterThan(0); expect(submitted).toBe(live); expect(stream.metrics.visible).toBeLessThan(live); const pools=records.map(p=>stream.inspectObject(p.id)?.pool)
  camera.lookAt(1300, 40, 400); stream.update(1300, 90, -200, 'balanced', { camera })
  expect(stream.metrics.instances).toBe(live); expect(stream.metrics.submitted).toBe(live); expect(records.map(p=>stream.inspectObject(p.id)?.pool)).toEqual(pools);expect(records.every(p=>stream.hasSubmittedRepresentation(p.id))).toBe(true)
  for (const child of stream.root.children) if (child instanceof InstancedMesh) expect(child.count).toBeLessThanOrEqual(stream.metrics.submitted)
  stream.dispose()
})
it('keeps every tree variant possible under the low-density stable subset', () => {
  const variants = new Set<string>()
  for (let n = 0; n < 200; n++) {
    const prop = { id: `grid-${n}`, x: n * 32, y: 0, z: 0, scale: 4, yaw: 0, kind: 'plant' as const, priority: .2 }
    variants.add(dimensions(prop).asset)
    expect(dimensions({ ...prop, priority: .8 }).asset).toBe(dimensions(prop).asset)
  }
  expect(variants.size).toBe(4)
})
it('updates a moved landmark even when its ID/pool/scale and ground height are unchanged', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(await realPropFixture())
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture())
  const stream = new PropStream(new Group(), () => {}, () => 20, { scatter: () => [] }, undefined, { poolCapacity: 1 })
  await new Promise(resolve => setTimeout(resolve, 0))
  const landmark = { id: 'same-landmark', asset: 'cliff-0' as const, x: 10, y: 20, z: 30, scale: 1, yaw: 0 }
  stream.setLandmarks([landmark]); stream.update(0, 90, 0, 'low')
  stream.setLandmarks([{ ...landmark, x: 60, yaw: 1 }]); stream.update(0, 90, 0, 'low')
  expect(stream.inspectObject(landmark.id)?.matrix[12]).toBe(60)
  const mesh = stream.root.children.find(child => child.name === 'cliff-0-lod0') as InstancedMesh
  const matrix = new Matrix4(); mesh.getMatrixAt(0, matrix); expect(matrix.elements[12]).toBe(60)
  stream.dispose()
})
