import { VegetationWind, VEGETATION_WIND_BOUND, installVegetationPhase, vegetationPhase } from '../living/vegetation-wind'
import ecologyManifest from '../assets/ecology-r5/manifest.json'
import { bakePropGeometry } from './bake-prop-geometry'
import { decorateShadowFade } from '../environment/shadow-fade'
import { DynamicDrawUsage, InstancedBufferAttribute, Frustum, Group, InstancedMesh, Matrix4, Mesh, Object3D, Sphere, Texture, MeshStandardMaterial, type BufferGeometry, type Material, type PerspectiveCamera } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import assetUrl from '../assets/ecology-r5/ecology-r5.glb?url'
import { scatter, chunkAt, type Address, type Prop } from '../world'
import { loadPropImpostors } from './prop-impostors'
import { CLIFF_SAMPLE, type PropLandmark } from './prop-obstacles'
import { cellKey, dimensions, propLod, PROP_CELL_SIZE, PROP_CELL_RADII, PROP_INSTANCE_CAPACITY } from './prop-lod'

type Quality = 'low' | 'balanced'
interface ScatterSource { scatter(address: Address): Prop[] }
export interface PropWorkBudget { canStart(estimatedMs?: number, bytes?: number, objects?: number): boolean; measure<T>(label: string, fn: () => T, bytes?: number, objects?: number): T }
export interface PropFrameContext { framebufferHeight?:number; camera?: PerspectiveCamera; frameId?: number; groundEpoch?: number; budget?: PropWorkBudget; fixedLod?: 0 | 1 | 2 }
interface Pool { name: string; meshes: InstancedMesh[]; free: number[]; next: number; live: number; instances: Map<number, Instance>; submission: string }
interface Instance { prop: Prop; lod: number; pool: Pool; slot: number; matrix: Matrix4; revision: number; groundEpoch: number; submittedSlot: number; lastVisibleFrame: number; fixedScale?: number; fixedY?: number }
interface Cell { key: string; x: number; z: number; quality: Quality; instances: Instance[]; signature: string; lastWantedFrame: number }
interface Desired { prop: Prop; lod: number; poolName: string; fixedScale?: number; fixedY?: number }
interface Dirty { epoch: number; sinceFrame: number }
export interface PropLifecycleEvent { frameId: number; id: string; event: string; reason: string; lod: number; pool: string; slot: number; groundEpoch: number; matrix: number[] }
function disposeMaterials(materials: Set<Material>) {
  const textures = new Set<Texture>()
  for (const material of materials) for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value as Texture)
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose())
}
/** CPU ownership is stable; GPU slots are compacted separately. Transactions reserve
 * every changed representation before touching resident state. A failed transaction
 * keeps the old signature/slots and stays retryable. Candidate cell and object bounds
 * are unchanged from R3 (169 cells, <=16 grid candidates/cell, 512 slots/template). */
export class PropStream {
  readonly root = new Group()
  readonly wind = new VegetationWind()
  setWind(motionSeconds:number,strength:number,camera?:PerspectiveCamera,reducedMotion=false){this.wind.update(motionSeconds,strength,camera,reducedMotion);this.metrics.windStrength=this.wind.uniforms.flightWindStrength.value;this.metrics.windMotionSeconds=motionSeconds}
  readonly metrics = { windStrength:0,windMotionSeconds:0,pending: 0, installMs: 0, peakInstallMs: 0, installedThisFrame: 0, bytes: 0, batches: 0, instances: 0, cells: 0, nearInstances: 0, ready: false, failed: false, failureReason: '',
    submitted: 0, visible: 0, submittedVertices: 0, slotFailures: 0, missingAssets: 0, deferred: 0, groundDirty: 0, groundMaxWaitFrames: 0, frameId: 0, compactMs: 0, matrixUploads: 0 }
  private readonly cells = new Map<string, Cell>()
  private readonly tileCandidates = new Map<string, Prop[]>()
  private readonly pools = new Map<string, Pool>()
  private readonly geometries = new Set<BufferGeometry>()
  private readonly materials = new Set<Material>()
  private readonly transform = new Object3D()
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly sphere = new Sphere()
  private readonly groundDirty = new Map<string, Dirty>()
  private readonly pendingSince = new Map<string, number>()
  private readonly representedIds = new Set<string>()
  private readonly lifecycle: PropLifecycleEvent[] = []
  private traceEnabled = false
  private tracedId: string | undefined
  private origin = { x: 0, z: 0 }
  private released = false
  private ready = false
  private matrixRevision = 0
  private frame = 0
  private epoch = 0
  private capacity: number
  private readonly loadTimeout: ReturnType<typeof setTimeout>
  private landmarks: PropLandmark[] = []
  private landmarkCell: Cell | undefined
  private landmarksDirty = false
  private canopyTemplates: {asset:string;parts:Awaited<ReturnType<typeof loadPropImpostors>> extends Map<string,infer P>?P:never}[]=[]
  constructor(parent: Group, private readonly wake: () => void, private readonly surface: (x: number, z: number) => number, private readonly sampler: ScatterSource = { scatter }, private readonly decorateMaterial: (material: Material) => void = () => {}, options: { poolCapacity?: number } = {}) {
    this.capacity = Math.max(1, Math.min(PROP_INSTANCE_CAPACITY, options.poolCapacity ?? PROP_INSTANCE_CAPACITY))
    this.root.name = 'flight-props-128m'; parent.add(this.root)
    this.loadTimeout=setTimeout(()=>{if(!this.released&&!this.ready){this.metrics.failed=true;this.wake()}},20000)
    Promise.resolve().then(() => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl)).then(async gltf => {
      const geometrySet = new Set<BufferGeometry>(), materialSet = new Set<Material>()
      gltf.scene.traverse(object => { if (object instanceof Mesh) { const typed = object as Mesh<BufferGeometry, Material | Material[]>; geometrySet.add(typed.geometry); for (const material of Array.isArray(typed.material) ? typed.material : [typed.material]) materialSet.add(material) } })
      if (this.released || this.metrics.failed) { geometrySet.forEach(g => g.dispose()); disposeMaterials(materialSet); return }
      let impostors: Awaited<ReturnType<typeof loadPropImpostors>>
      try { impostors = await loadPropImpostors() } catch (error) {
        geometrySet.forEach(g => g.dispose()); disposeMaterials(materialSet); throw error
      }
      if (this.released || this.metrics.failed) { for (const parts of impostors.values()) for (const part of parts) { part.geometry.dispose(); part.material.map?.dispose(); part.material.dispose() }; geometrySet.forEach(g => g.dispose()); disposeMaterials(materialSet); return }
      for(const [asset,parts] of impostors){this.canopyTemplates.push({asset,parts});for(const p of parts){this.geometries.add(p.geometry);this.materials.add(p.material)}}
      gltf.scene.updateMatrixWorld(true)
      for (const object of gltf.scene.children) {
        if(object.name.startsWith('cliff-group-0-'))object.name=object.name.replace('cliff-group-0-','cliff-0-')
        if (!/^(tree|rock|cliff|understory)-.*-lod[012]$/.test(object.name)) continue
        const pool: Pool = { name: object.name, meshes: [], free: [], next: 0, live: 0, instances: new Map(), submission: '' }
        object.traverse(part => {
          if (!(part instanceof Mesh)) return
          const typed = part as Mesh<BufferGeometry, Material | Material[]>
          if(object.name.startsWith('tree-1-'))for(const m of Array.isArray(typed.material)?typed.material:[typed.material])if(m instanceof MeshStandardMaterial){m.aoMapIntensity=.28;m.normalScale.setScalar(.45)}
          const geometry = bakePropGeometry(typed.geometry,part.matrixWorld)
          this.geometries.add(geometry)
          const vegetation=/^(tree|understory)-/.test(object.name)
          const asset=ecologyManifest.assets.find(asset=>asset.id===object.name.replace(/-lod[012]$/,''))
          const wind=vegetation&&asset&&typed.material instanceof MeshStandardMaterial?this.wind.decorate(typed.material,asset.groundAnchor[1]!,asset.physicalHeight,object.name.startsWith('tree-')):undefined
          const material=wind?.color??typed.material
          for (const owned of Array.isArray(material)?material:[material])this.materials.add(owned)
          const mesh = new InstancedMesh(geometry, material, this.capacity)
          if(wind){
            installVegetationPhase(geometry,this.capacity)
            mesh.customDepthMaterial=wind.depth;mesh.customDistanceMaterial=wind.distance
            this.materials.add(wind.depth);this.materials.add(wind.distance)
            // GPU instancing is culled below in physical world units. Also expand local
            // geometry bounds conservatively for tools that inspect the baked geometry.
            const minimumScale=(object.name.startsWith('tree-')?8:.7)/asset!.physicalHeight
            geometry.boundingBox?.expandByScalar(VEGETATION_WIND_BOUND/minimumScale)
            if(geometry.boundingSphere)geometry.boundingSphere.radius+=VEGETATION_WIND_BOUND/minimumScale
          }
          mesh.count = 0; mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = object.name.endsWith('lod0'); mesh.receiveShadow = true
          mesh.name = object.name; pool.meshes.push(mesh); this.root.add(mesh)
        })
        this.pools.set(object.name, pool)
      }
      geometrySet.forEach(g => g.dispose())
      // The cliff only appears via explicit landmarks with matching obstacle metadata.
      materialSet.forEach(m => { if (!this.materials.has(m)) m.dispose() })
      this.materials.forEach(decorateShadowFade)
      this.materials.forEach(this.decorateMaterial)
      this.ready = true; this.metrics.ready = true
      this.metrics.bytes = [...this.pools.values()].reduce((sum, p) => sum + p.meshes.reduce((s, m) => s + m.instanceMatrix.array.byteLength, 0), 0)
      const textures = new Set<Texture>()
      for (const material of this.materials) for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value as Texture)
      this.metrics.bytes += [...textures].reduce((sum, texture) => { const source = texture.image as { width?: number; height?: number } | undefined; return sum + (source?.width ?? 0) * (source?.height ?? 0) * 4 * 4 / 3 }, 0)
      this.metrics.bytes += [...this.geometries].reduce((sum, g) => sum + Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0), 0)
      this.wake()
    }).catch((error: unknown) => { if (!this.released) { this.metrics.failed = true; this.metrics.failureReason = error instanceof Error ? error.message : String(error); this.wake() } }).finally(()=>clearTimeout(this.loadTimeout))
  }
  markGroundDirty(worldTileKeys: string[], epoch = this.epoch + 1) {
    for (const tileKey of worldTileKeys) {
      const [tx, tz] = (tileKey.split(':').at(-1) ?? tileKey).split(',').map(Number)
      if (tx === undefined || tz === undefined || !Number.isFinite(tx) || !Number.isFinite(tz)) continue
      for (let z = tz * 4; z < tz * 4 + 4; z++) for (let x = tx * 4; x < tx * 4 + 4; x++) {
        const key = `${x},${z}`
        if (this.cells.has(key)) this.groundDirty.set(key, { epoch, sinceFrame: this.groundDirty.get(key)?.sinceFrame ?? this.frame })
      }
    }
  }
  setLandmarks(landmarks: readonly PropLandmark[]) { this.landmarks = landmarks.slice(0, 2).map(l => ({ ...l })); this.landmarksDirty = true }
  get busy() { return !this.metrics.failed && (!this.ready || this.metrics.pending > 0) }
  set visible(value: boolean) { this.root.visible = value }
  setTracing(enabled: boolean, id?: string) { this.traceEnabled = enabled; this.tracedId = id; this.lifecycle.length = 0 }
  getLifecycleTrace() { return this.lifecycle.map(event => ({ ...event, matrix: [...event.matrix] })) }
  getCanopyTemplates() { return this.canopyTemplates }
  hasRepresentation(id: string) { return this.representedIds.has(id) }
  hasSubmittedRepresentation(id: string) { return this.submittedIds.has(id) }
  private readonly submittedIds = new Set<string>()
  getResidentIds() { return [...this.representedIds] }
  inspectObject(id: string) {
    const instance = this.allInstances().find(i => i.prop.id === id)
    if (!instance) return null
    const { prop, pool, slot, lod, matrix, groundEpoch, lastVisibleFrame, submittedSlot } = instance
    return { id, candidate: true, resident: true, position: { x: prop.x, y: matrix.elements[13], z: prop.z }, lod, pool: pool.name, slot, submittedSlot, groundEpoch, lastVisibleFrame, matrix: [...matrix.elements],
      materials: pool.meshes.flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({ side: material.side, alphaTest: material.alphaTest, transparent: material.transparent }))), physical: dimensions(prop) }
  }
  private emit(instance: Instance, event: string, reason: string) {
    if (!this.traceEnabled || this.tracedId && instance.prop.id !== this.tracedId) return
    this.lifecycle.push({ frameId: this.frame, id: instance.prop.id, event, reason, lod: instance.lod, pool: instance.pool.name, slot: instance.slot, groundEpoch: instance.groundEpoch, matrix: [...instance.matrix.elements] })
    if (this.lifecycle.length > 512) this.lifecycle.shift()
  }
  update(x: number, y: number, z: number, quality: Quality, context: PropFrameContext = {}) {
    if (this.released || !this.ready) return
    this.frame = context.frameId ?? this.frame + 1; this.epoch = context.groundEpoch ?? this.epoch
    this.metrics.frameId = this.frame; this.metrics.installedThisFrame = 0; this.metrics.deferred = 0
    const start = performance.now(), camera = context.camera, budget = context.budget
    camera?.updateMatrixWorld(true)
    if (camera) this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const viewX = camera ? camera.position.x + this.origin.x : x, viewY = camera?.position.y ?? y, viewZ = camera ? camera.position.z + this.origin.z : z
    const cx = Math.floor(viewX / PROP_CELL_SIZE), cz = Math.floor(viewZ / PROP_CELL_SIZE), radius = PROP_CELL_RADII[quality]
    if (this.landmarksDirty && (!budget || budget.canStart(.05, 256, 2))) {
      const desired: Desired[] = this.landmarks.map(l => ({ prop: { ...l, kind: 'rock', priority: 0 }, lod: 0, poolName: `${l.asset}-lod0`, fixedScale: l.scale, fixedY: l.y }))
      const result = this.commit(this.landmarkCell, desired, '@landmarks', 0, 0, quality, JSON.stringify(this.landmarks))
      if (result) { this.landmarkCell = result; this.landmarksDirty = false }
    }
    const nearby: Prop[] = []
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nearby.push(...this.candidates(cx + dx, cz + dz))
    const distance = (p: Prop) => Math.hypot(p.x - viewX, p.y - viewY, p.z - viewZ)
    const nearIds = new Set(nearby.filter(p => p.priority < (quality === 'low' ? .55 : .85)).sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, quality === 'low' ? 12 : 24).map(p => p.id))
    const chooseLod = (p: Prop, previous?: number) => { const lod = context.fixedLod ?? propLod(distance(p), previous,dimensions(p).physicalHeight,context.framebufferHeight??720,camera?.fov??55); return context.fixedLod === undefined && lod === 0 && !nearIds.has(p.id) ? 1 : lod }
    const wanted = new Set<string>(), pending: { key: string; x: number; z: number; desired: Desired[]; signature: string; distance: number }[] = []
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const ax = cx + dx, az = cz + dz, key = `${ax},${az}`; wanted.add(key)
      const previous = this.cells.get(key), props = this.candidates(ax, az).filter(p => p.priority < (quality === 'low' ? .55 : .85))
      if (previous) previous.lastWantedFrame = this.frame
      const desired = props.map(prop => { const lod = chooseLod(prop, previous?.instances.find(i => i.prop.id === prop.id)?.lod); return { prop, lod, poolName: `${dimensions(prop).asset}-lod${lod}` } })
      const signature = desired.map(d => `${d.prop.id}:${d.poolName}`).join('|')
      if (!previous || signature !== previous.signature) {
        if (!this.pendingSince.has(key)) this.pendingSince.set(key, this.frame)
        pending.push({ key, x: ax, z: az, desired, signature, distance: Math.hypot((ax + .5) * PROP_CELL_SIZE - viewX, (az + .5) * PROP_CELL_SIZE - viewZ) })
      } else this.pendingSince.delete(key)
    }
    // Detail and turn-back retention share the unchanged global 169-cell ceiling.
    // Select an actual camera-visible/safe set before eviction, so a full cache
    // cannot block fresh visible work forever after a quality change or turn.
    const priority = new Map<string, number>()
    for (const key of wanted) {
      const [ax = 0, az = 0] = key.split(',').map(Number), distance2 = Math.hypot((ax + .5) * PROP_CELL_SIZE - viewX, (az + .5) * PROP_CELL_SIZE - viewZ)
      const near = distance2 < 192
      const seen = !camera || this.candidates(ax, az).some(prop => this.propInFrustum(prop))
      priority.set(key, (near ? 0 : seen ? 10000 : 20000) + distance2)
    }
    for (const cell of this.cells.values()) if (!wanted.has(cell.key)) {
      const distance2 = Math.hypot((cell.x + .5) * PROP_CELL_SIZE - viewX, (cell.z + .5) * PROP_CELL_SIZE - viewZ)
      const near = Math.hypot((cell.x + .5) * PROP_CELL_SIZE - x, (cell.z + .5) * PROP_CELL_SIZE - z) < 192
      const seen = camera && cell.instances.some(instance => this.inFrustum(instance))
      if (near || distance2 < (radius + 2) * PROP_CELL_SIZE && (seen || this.frame - cell.lastWantedFrame <= 90)) priority.set(cell.key, (near ? 0 : seen ? 10000 : 20000) + distance2)
    }
    const selected = new Set([...priority].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 169).map(([key]) => key))
    for (const cell of this.cells.values()) if (!selected.has(cell.key)) this.evict(cell, 'outside-camera-cache-budget')
    for (let index = pending.length - 1; index >= 0; index--) if (!selected.has(pending[index]!.key)) pending.splice(index, 1)
    const cellLimit = 169
    // Oldest pending work gains priority; pool pressure cannot permanently starve
    // unrelated cells. A failed attempt rotates behind equal-priority work.
    pending.sort((a, b) => (a.distance - (this.frame - (this.pendingSince.get(a.key) ?? this.frame)) * 16) - (b.distance - (this.frame - (this.pendingSince.get(b.key) ?? this.frame)) * 16) || a.key.localeCompare(b.key))
    const next = pending[0]
    let committed = false
    if (next) {
      const allocationBytes = next.desired.length * 64
      if ((!this.cells.has(next.key) && this.cells.size >= cellLimit) || budget && !budget.canStart(.08, allocationBytes, next.desired.length)) this.metrics.deferred++
      else {
        const perform = () => this.commit(this.cells.get(next.key), next.desired, next.key, next.x, next.z, quality, next.signature)
        const result = budget ? budget.measure('props.install', perform, allocationBytes, next.desired.length) : perform()
        if (result) { this.cells.set(next.key, result); this.pendingSince.delete(next.key); this.metrics.installedThisFrame = 1; committed = true }
        else { this.pendingSince.set(next.key, this.frame); this.metrics.deferred++ }
      }
    }
    const dirty = [...this.groundDirty].map(([key, info]) => ({ cell: this.cells.get(key), info })).filter((entry): entry is { cell: Cell; info: Dirty } => Boolean(entry.cell))
      .sort((a, b) => a.info.sinceFrame - b.info.sinceFrame || Math.hypot(a.cell.x - cx, a.cell.z - cz) - Math.hypot(b.cell.x - cx, b.cell.z - cz))[0]
    if (dirty && (!budget || budget.canStart(.04, dirty.cell.instances.length * 64, dirty.cell.instances.length))) {
      const reground = () => { for (const instance of dirty.cell.instances) { this.place(instance, dirty.info.epoch); this.emit(instance, 'ground', 'surface-revision') }; this.groundDirty.delete(dirty.cell.key) }
      if (budget) budget.measure('props.ground', reground, dirty.cell.instances.length * 64, dirty.cell.instances.length); else reground()
    }
    const tiles = new Set([...wanted, ...this.cells.keys()].map(key => { const [ax = 0, az = 0] = key.split(',').map(Number); return `${Math.floor(ax / 4)},${Math.floor(az / 4)}` }))
    for (const key of this.tileCandidates.keys()) if (!tiles.has(key)) this.tileCandidates.delete(key)
    for (const key of this.pendingSince.keys()) if (!wanted.has(key)) this.pendingSince.delete(key)
    this.metrics.pending = pending.length - (committed ? 1 : 0); this.metrics.cells = this.cells.size
    this.metrics.groundDirty = this.groundDirty.size; this.metrics.groundMaxWaitFrames = Math.max(0, ...[...this.groundDirty.values()].map(d => this.frame - d.sinceFrame))
    const compact = () => this.compact(camera, viewX, viewY, viewZ)
    // Compaction is necessary render submission, not optional preparation. Charging
    // it even after exhaustion preserves the current display and truthful timings.
    if (budget) budget.measure('props.submit', compact); else compact()
    this.metrics.installMs = performance.now() - start; this.metrics.peakInstallMs = Math.max(this.metrics.peakInstallMs, this.metrics.installMs)
  }
  private commit(previous: Cell | undefined, desired: Desired[], key: string, x: number, z: number, quality: Quality, signature: string): Cell | undefined {
    const old = new Map(previous?.instances.map(instance => [instance.prop.id, instance]) ?? [])
    const retained: Instance[] = [], changes: Desired[] = []
    for (const target of desired) {
      const instance = old.get(target.prop.id)
      if (instance && instance.pool.name === target.poolName && instance.fixedScale === target.fixedScale && instance.fixedY === target.fixedY && instance.prop.x === target.prop.x && instance.prop.y === target.prop.y && instance.prop.z === target.prop.z && instance.prop.scale === target.prop.scale && instance.prop.yaw === target.prop.yaw) { retained.push(instance); old.delete(target.prop.id) }
      else changes.push(target)
    }
    const retired = [...old.values()], borrowed = new Set<Instance>(), reserved: { pool: Pool; slot: number; target: Desired; borrowed: boolean }[] = []
    for (const target of changes) {
      const pool = this.pools.get(target.poolName)
      if (!pool || !pool.meshes.length) { this.metrics.missingAssets++; this.rollback(reserved); previous?.instances.forEach(i => this.emit(i, 'retained', 'missing-asset-retry')); return undefined }
      let slot = pool.free.pop(), reuse: Instance | undefined
      if (slot === undefined && pool.next < this.capacity) slot = pool.next++
      if (slot === undefined) { reuse = retired.find(instance => instance.pool === pool && !borrowed.has(instance)); if (reuse) { slot = reuse.slot; borrowed.add(reuse) } }
      if (slot === undefined) { this.metrics.slotFailures++; this.rollback(reserved); previous?.instances.forEach(i => this.emit(i, 'retained', 'pool-full-retry')); return undefined }
      reserved.push({ pool, slot, target, borrowed: Boolean(reuse) })
    }
    const additions = reserved.map(({ pool, slot, target }) => {
      const instance: Instance = { prop: target.prop, lod: target.lod, pool, slot, matrix: new Matrix4(), revision: 0, groundEpoch: this.epoch, submittedSlot: -1, lastVisibleFrame: -1, ...(target.fixedScale === undefined ? {} : { fixedScale: target.fixedScale }), ...(target.fixedY === undefined ? {} : { fixedY: target.fixedY }) }
      this.place(instance, this.epoch); return instance
    })
    for (const instance of retired) this.release(instance, desired.some(d => d.prop.id === instance.prop.id) ? 'lod-replaced' : 'density-subset', borrowed.has(instance))
    for (const instance of additions) { instance.pool.instances.set(instance.slot, instance); this.representedIds.add(instance.prop.id); instance.pool.live = instance.pool.instances.size; this.emit(instance, 'resident', 'atomic-commit') }
    return { key, x, z, quality, instances: [...retained, ...additions], signature, lastWantedFrame: this.frame }
  }
  private rollback(reserved: { pool: Pool; slot: number; borrowed: boolean }[]) { for (const item of reserved) if (!item.borrowed) item.pool.free.push(item.slot) }
  private candidates(x: number, z: number) {
    const address = chunkAt(x * PROP_CELL_SIZE, z * PROP_CELL_SIZE), key = `${address.x},${address.z}`
    let props = this.tileCandidates.get(key)
    if (!props) { props = this.sampler.scatter(address); this.tileCandidates.set(key, props) }
    return props.filter(p => cellKey(p.x, p.z) === `${x},${z}`)
  }
  private groundFor(prop:Prop){
    let height=this.surface(prop.x,prop.z)
    if(prop.kind==='cliff'||prop.kind==='rock'){
      const radius=dimensions(prop).crownRadius*.75
      for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius]])height=Math.min(height,this.surface(prop.x+dx!,prop.z+dz!))
    }
    return height
  }
  private place(instance: Instance, epoch: number) {
    const { prop } = instance, ground = this.groundFor(prop)
    this.transform.position.set(prop.x - this.origin.x, instance.fixedY ?? (Number.isFinite(ground) ? ground : prop.y), prop.z - this.origin.z)
    this.transform.rotation.set(0, prop.yaw, 0); this.transform.scale.setScalar(instance.fixedScale ?? dimensions(prop).scale); this.transform.updateMatrix()
    instance.matrix.copy(this.transform.matrix); instance.groundEpoch = epoch; instance.revision = ++this.matrixRevision
  }
  private propInFrustum(prop: Prop) {
    const physical = dimensions(prop)
    this.sphere.center.set(prop.x - this.origin.x, prop.y + physical.physicalHeight * .5, prop.z - this.origin.z)
    this.sphere.radius = Math.hypot(physical.physicalHeight * .5, physical.crownRadius)+(prop.kind==='plant'||prop.kind==='understory'?VEGETATION_WIND_BOUND:0)
    return this.frustum.intersectsSphere(this.sphere)
  }
  private inFrustum(instance: Instance) {
    const physical = dimensions(instance.prop)
    const height = instance.fixedScale === undefined ? physical.physicalHeight : instance.fixedScale * CLIFF_SAMPLE.height
    this.sphere.center.set(instance.matrix.elements[12], instance.matrix.elements[13] + height * .5, instance.matrix.elements[14])
    this.sphere.radius = Math.hypot(height * .5, instance.fixedScale === undefined ? physical.crownRadius : instance.fixedScale * CLIFF_SAMPLE.radius)+(instance.prop.kind==='plant'||instance.prop.kind==='understory'?VEGETATION_WIND_BOUND:0)
    return this.frustum.intersectsSphere(this.sphere)
  }
  private compact(camera: PerspectiveCamera | undefined, x: number, y: number, z: number) {
    this.submittedIds.clear()
    const start = performance.now(); let submitted = 0, visible = 0, batches = 0, vertices = 0, live = 0, near = 0, uploads = 0
    for (const pool of this.pools.values()) {
      const entries: Instance[] = []
      for (const instance of pool.instances.values()) {
        live++; if (instance.lod === 0) near++
        const seen = !camera || this.inFrustum(instance)
        if (seen) { visible++; instance.lastVisibleFrame = this.frame }
        const shadowNeighbour = instance.lod === 0 && Math.hypot(instance.prop.x - x, instance.matrix.elements[13] - y, instance.prop.z - z) < 180
        // Trees stay submitted around the whole camera so a turn cannot expose a handoff hole.
        if (seen || shadowNeighbour || instance.prop.kind === 'plant') {
          entries.push(instance); this.submittedIds.add(instance.prop.id)
        } else instance.submittedSlot = -1
      }
      const signature = entries.map(instance => `${instance.slot}:${instance.prop.id}:${instance.revision}`).join('|')
      const changed = signature !== pool.submission
      for (const mesh of pool.meshes) mesh.userData.propIds = entries.map(instance => instance.prop.id)
      entries.forEach((instance, index) => { instance.submittedSlot = index; if (changed) for (const mesh of pool.meshes) {mesh.setMatrixAt(index, instance.matrix);mesh.geometry.getAttribute('flightWindPhase')?.setX(index,vegetationPhase(instance.prop.id))} })
      for (const mesh of pool.meshes) {
        mesh.count = entries.length; mesh.visible = entries.length > 0
        if (changed && entries.length) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, entries.length * 16); mesh.instanceMatrix.needsUpdate = true; uploads += entries.length * 64;const phase=mesh.geometry.getAttribute('flightWindPhase');if(phase instanceof InstancedBufferAttribute){phase.clearUpdateRanges();phase.addUpdateRange(0,entries.length);phase.needsUpdate=true;uploads+=entries.length*4} }
        if (entries.length) { batches++; vertices += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) * entries.length }
      }
      submitted += entries.length; pool.submission = signature
    }
    for (const [name, pool] of this.pools) for (const mesh of pool.meshes) mesh.castShadow = name.endsWith('lod0') && near <= 32
    Object.assign(this.metrics, { instances: live, nearInstances: near, submitted, visible, batches, submittedVertices: vertices, matrixUploads: uploads, compactMs: performance.now() - start })
  }
  private allInstances() { return [...this.pools.values()].flatMap(pool => [...pool.instances.values()]) }
  private release(instance: Instance, reason: string, borrowed = false) {
    this.emit(instance, 'released', reason); this.representedIds.delete(instance.prop.id); instance.pool.instances.delete(instance.slot); instance.pool.live = instance.pool.instances.size
    if (!borrowed) instance.pool.free.push(instance.slot)
  }
  private evict(cell: Cell, reason: string) {
    for (const instance of cell.instances) this.release(instance, reason)
    this.cells.delete(cell.key); this.groundDirty.delete(cell.key); this.pendingSince.delete(cell.key)
  }
  relocate(origin: { x: number; z: number }) {
    const dx = this.origin.x - origin.x, dz = this.origin.z - origin.z; this.origin = { ...origin }
    for (const instance of this.allInstances()) { instance.matrix.elements[12] += dx; instance.matrix.elements[14] += dz; instance.revision = ++this.matrixRevision; this.emit(instance, 'origin', 'floating-origin') }
  }
  dispose() {
    if (this.released) return
    this.released = true; clearTimeout(this.loadTimeout); this.root.removeFromParent()
    for (const instance of this.allInstances()) this.emit(instance, 'released', 'session-dispose')
    this.root.traverse(o => { if (o instanceof InstancedMesh) o.dispose() })
    this.geometries.forEach(g => g.dispose()); disposeMaterials(this.materials)
    this.submittedIds.clear(); this.representedIds.clear(); this.cells.clear(); this.tileCandidates.clear(); this.pools.clear(); this.landmarkCell = undefined; this.landmarks = []; this.groundDirty.clear(); this.pendingSince.clear(); this.geometries.clear(); this.materials.clear(); this.root.clear()
    Object.assign(this.metrics, { pending: 0, instances: 0, cells: 0, bytes: 0, submitted: 0, visible: 0, batches: 0 })
  }
}
