import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Vector2, DataTexture, RedFormat, UnsignedByteType, type Material } from 'three'
import type { Address, WorldSampler } from './world'
import type { FrameWorkBudget } from './frame-work-budget'

export const HORIZON_STEP = 256
export const HORIZON_RADIUS = 12288
const SIDE = HORIZON_RADIUS * 2 / HORIZON_STEP + 1
const UPLOAD_BYTES = SIDE * SIDE * 36 + (SIDE - 1) ** 2 * 12
/** Same world, coarse land only. No props, textures, collision, or second world seed.
 * One row per budget slice; retain the published mesh until its replacement is ready.
 */
export class HorizonTerrain {
  readonly root = new Group()
  readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  readonly metrics = { pending: 1, vertices: 0, triangles: 0, bytes: 0, preparedRows: 0 }
  private readonly originUniform = { value: new Vector2() }
  private readonly coverage = new DataTexture(new Uint8Array(33 * 33), 33, 33, RedFormat, UnsignedByteType)
  private readonly coverageOrigin = { value: new Vector2() }
  private coverageSignature = ''
  private origin: Address = { x: 0, z: 0 }
  private mesh: Mesh | null = null
  private published: Address | null = null
  private build: { x: number; z: number; row: number; positions: Float32Array; colors: Float32Array } | null = null
  constructor(private readonly world: WorldSampler, decorate: (material: Material) => void) {
    this.coverage.generateMipmaps = false; this.coverage.needsUpdate = true
    decorate(this.material)
    const compile = this.material.onBeforeCompile.bind(this.material), key = this.material.customProgramCacheKey.bind(this.material)
    this.material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer)
      Object.assign(shader.uniforms, { horizonOrigin: this.originUniform, horizonCoverage: { value: this.coverage }, horizonCoverageOrigin: this.coverageOrigin })
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 horizonOrigin; varying vec2 horizonXZ; varying float horizonHeight;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nhorizonXZ=(modelMatrix*vec4(transformed,1.)).xz+horizonOrigin;horizonHeight=(modelMatrix*vec4(transformed,1.)).y;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D horizonCoverage; uniform vec2 horizonCoverageOrigin; varying vec2 horizonXZ; varying float horizonHeight;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif(horizonHeight<-.7)discard; vec2 uv=(floor((horizonXZ-horizonCoverageOrigin)/512.)+.5)/33.; if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThan(uv,vec2(1.)))&&texture2D(horizonCoverage,uv).r>.5)discard;')
    }
    this.material.customProgramCacheKey = () => `${key()}:horizon-land-coverage-v2`
  }
  get ready() { return this.mesh !== null }
  /** Never infer ownership from pending work: moving streams retain real terrain. */
  setCoverage(addresses: readonly Address[]) {
    const signature=addresses.map(a=>`${a.x},${a.z}`).sort().join(';')
    if(signature===this.coverageSignature)return
    this.coverageSignature=signature
    const data=this.coverage.image.data as Uint8Array;data.fill(0)
    if(addresses.length){
      const x=Math.min(...addresses.map(a=>a.x)),z=Math.min(...addresses.map(a=>a.z))
      this.coverageOrigin.value.set(x*512,z*512)
      for(const a of addresses){const dx=a.x-x,dz=a.z-z;if(dx>=0&&dz>=0&&dx<33&&dz<33)data[dz*33+dx]=255}
    }
    this.coverage.needsUpdate=true
  }
  update(x: number, z: number, budget: FrameWorkBudget) {
    const cx = Math.floor(x / 2048) * 2048, cz = Math.floor(z / 2048) * 2048
    this.metrics.preparedRows = 0
    if (this.build && (this.build.x !== cx || this.build.z !== cz)) this.build = null
    if (!this.build && (this.published?.x !== cx || this.published?.z !== cz)) {
      this.build = { x: cx, z: cz, row: 0, positions: new Float32Array(SIDE * SIDE * 3), colors: new Float32Array(SIDE * SIDE * 3) }
    }
    const b = this.build
    if (b && b.row < SIDE && budget.canStart(.15)) budget.measure('horizon.prepare', () => {
      const z = b.row * HORIZON_STEP - HORIZON_RADIUS
      for (let c = 0; c < SIDE; c++) {
        const x = c * HORIZON_STEP - HORIZON_RADIUS, t = this.world.terrainAt(b.x + x, b.z + z), i = (b.row * SIDE + c) * 3
        b.positions.set([x, t.height - 8, z], i)
        const rock = Math.min(1, t.canyonWeight * .45), green = [.16 + t.moisture * .035, .24 + t.moisture * .065, .12 + t.moisture * .015]
        b.colors.set(green.map((v, k) => v * (1 - rock) + [.42, .37, .29][k]! * rock), i)
      }
      b.row++; this.metrics.preparedRows = 1
    })
    if (b && b.row === SIDE && budget.canStart(.3, UPLOAD_BYTES, 1)) budget.measure('horizon.install', () => {
      const indices: number[] = []
      for (let r = 0; r < SIDE - 1; r++) for (let c = 0; c < SIDE - 1; c++) {
        const a = r * SIDE + c; indices.push(a, a + SIDE, a + 1, a + 1, a + SIDE, a + SIDE + 1)
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(b.positions, 3)); geometry.setAttribute('color', new BufferAttribute(b.colors, 3)); geometry.setIndex(indices)
      geometry.computeVertexNormals(); geometry.computeBoundingSphere()
      const mesh = new Mesh(geometry, this.material); mesh.position.set(b.x - this.origin.x, 0, b.z - this.origin.z)
      this.root.add(mesh); this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.mesh = mesh
      this.published = { x: b.x, z: b.z }; this.build = null
      this.metrics.vertices = SIDE * SIDE; this.metrics.triangles = indices.length / 3
      this.metrics.bytes = Object.values(geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0)
    }, UPLOAD_BYTES, 1)
    this.metrics.pending = Number(this.build !== null)
  }
  relocate(origin: Address) {
    this.origin = { ...origin }; this.originUniform.value.set(origin.x, origin.z)
    if (this.mesh && this.published) this.mesh.position.set(this.published.x - origin.x, 0, this.published.z - origin.z)
  }
  dispose() { this.mesh?.geometry.dispose(); this.material.dispose(); this.coverage.dispose(); this.root.clear(); this.root.removeFromParent(); this.build = null; this.mesh = null; this.published = null; this.metrics.pending = 0 }
}
