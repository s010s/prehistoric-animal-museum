import {
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import { MAMMOTH_PALAEOENVIRONMENT_ANCHOR } from './scientific-anchor'

export type MammothPalaeoenvironmentVariant = 'A' | 'B' | 'C'
export type MammothPalaeoenvironmentSurfaceState =
  | 'wind-scoured'
  | 'balanced'
  | 'late-snow'

export interface MammothPalaeoenvironmentResourceEstimate {
  readonly drawCalls: number
  readonly geometryBytes: number
  readonly materials: number
  readonly textures: number
  readonly transparentDrawCalls: number
  readonly triangles: number
}

export interface MammothPalaeoenvironmentDiagnostics {
  readonly anchorId: string
  readonly crevasseCount: 0
  readonly farIceVolume: Readonly<{
    readonly minimum: readonly [number, number, number]
    readonly maximum: readonly [number, number, number]
    readonly minimumCorridorSeparationMeters: number
    readonly role: string
  }>
  readonly groundSurface: Readonly<{
    readonly kind: 'unglaciated-loess-and-permafrost-topsoil'
    readonly supportsSubjects: true
    readonly worldRadiusMeters: number
  }>
  readonly iceTowerCount: 0
  readonly layerCounts: Readonly<{
    readonly dwarfWillow: number
    readonly forb: number
    readonly grassAndSedge: number
    readonly rockAndHummock: number
    readonly snowPatches: number
  }>
  readonly resourceEstimate: MammothPalaeoenvironmentResourceEstimate
  readonly snowLayer: Readonly<{
    readonly approximateCoverFraction: number
    readonly supportsSubjects: false
    readonly thicknessStatement: string
  }>
  readonly surfaceState: MammothPalaeoenvironmentSurfaceState
  readonly variant: MammothPalaeoenvironmentVariant
}

export interface MammothPalaeoenvironmentCandidate {
  readonly root: Group
  readonly layers: Readonly<{
    readonly atmosphere: Group
    readonly background: Group
    readonly farIceMass: Group
    readonly farLandform: Group
    readonly groundSurface: Group
    readonly midSteppe: Group
    readonly nearGround: Group
    readonly snowLayer: Group
  }>
  readonly scientificAnchor: typeof MAMMOTH_PALAEOENVIRONMENT_ANCHOR
  diagnostics(): MammothPalaeoenvironmentDiagnostics
  dispose(): void
  fog(): FogExp2 | null
  setSurfaceState(state: MammothPalaeoenvironmentSurfaceState): void
  setVariant(variant: MammothPalaeoenvironmentVariant): void
  update(elapsedSeconds: number): void
}

const GROUND_RADIUS_METERS = 180
// Keep the direction-reference ice inside the shared encounter camera's
// established 240 m far plane while preserving more than 180 m of separation
// from the subject corridor.
const FAR_ICE_MINIMUM = new Vector3(-12, 39, -207)
const FAR_ICE_MAXIMUM = new Vector3(18, 67, -195)
const SUBJECT_CORRIDOR = new Box3(
  new Vector3(-14, -0.2, -4.2),
  new Vector3(7.5, 4.8, 4.2),
)

const SURFACE_STATE = {
  'wind-scoured': { coverFraction: 0.12, patchCount: 24 },
  balanced: { coverFraction: 0.22, patchCount: 48 },
  'late-snow': { coverFraction: 0.34, patchCount: 72 },
} as const satisfies Readonly<
  Record<
    MammothPalaeoenvironmentSurfaceState,
    { readonly coverFraction: number; readonly patchCount: number }
  >
>

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function pointToCorridorDistance(x: number, z: number): number {
  const startX = -11
  const endX = 5
  const projection = Math.min(1, Math.max(0, (x - startX) / (endX - startX)))
  const closestX = startX + (endX - startX) * projection
  return Math.hypot(x - closestX, z)
}

/**
 * Shared terrain contract for the glacier work key. The established mammoth
 * and child rail stays perfectly level; low-frequency relief begins only
 * outside the protected observation corridor.
 */
export function mammothPalaeoenvironmentGroundY(
  x: number,
  z: number,
): number {
  const distance = Math.hypot(x, z)
  const corridorBlend = smoothstep(5.5, 19, pointToCorridorDistance(x, z))
  const radialBlend = smoothstep(13, 34, distance)
  const broadRelief =
    Math.sin(x * 0.047) * 0.46 +
    Math.cos(z * 0.038) * 0.34 +
    Math.sin((x + z) * 0.021) * 0.28
  const valleyFall = -smoothstep(70, 165, Math.abs(z)) * 0.5
  return (broadRelief + valleyFall) * corridorBlend * radialBlend
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function createSkyDome(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizonColour: { value: new Color('#c5c7b8') },
      lowerColour: { value: new Color('#8b8977') },
      sunColour: { value: new Color('#fff0c8') },
      sunDirection: {
        value: new Vector3(-0.42, 0.54, 0.73).normalize(),
      },
      zenithColour: { value: new Color('#7890a3') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 horizonColour;
      uniform vec3 lowerColour;
      uniform vec3 sunColour;
      uniform vec3 sunDirection;
      uniform vec3 zenithColour;
      varying vec3 vWorldDirection;
      void main() {
        vec3 direction = normalize(vWorldDirection);
        float height = direction.y * 0.5 + 0.5;
        vec3 sky = mix(lowerColour, horizonColour, smoothstep(0.18, 0.5, height));
        sky = mix(sky, zenithColour, smoothstep(0.46, 0.94, height));
        float sun = pow(max(dot(direction, sunDirection), 0.0), 560.0);
        float glow = pow(max(dot(direction, sunDirection), 0.0), 9.0) * 0.15;
        sky += sunColour * (sun * 1.5 + glow);
        float lowHaze = 1.0 - smoothstep(0.43, 0.55, height);
        sky = mix(sky, horizonColour, lowHaze * 0.2);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  })
  // The shared encounter camera keeps a 240 m far plane. A 195 m dome leaves
  // enough headroom for the overview camera offset, avoiding a clipped sphere
  // edge in the intentionally groundless A comparison.
  const mesh = new Mesh(new SphereGeometry(195, 48, 24), material)
  mesh.name = 'glacier-background-atmosphere-sky'
  mesh.renderOrder = -100
  return mesh
}

function ridgeHeight(x: number, phase: number, heightScale: number): number {
  const shoulder = Math.max(0, 1 - Math.abs(x) / 250)
  return (
    16 +
    shoulder * heightScale +
    Math.sin(x * 0.031 + phase) * 9 +
    Math.sin(x * 0.073 - phase * 0.7) * 4.5
  )
}

function createRidgeGeometry(
  z: number,
  phase: number,
  heightScale: number,
  baseY: number,
  xMinimum = -255,
  xMaximum = 255,
): BufferGeometry {
  const segments = 96
  const vertices: number[] = []
  const indices: number[] = []
  for (let index = 0; index <= segments; index += 1) {
    const fraction = index / segments
    const x = xMinimum + (xMaximum - xMinimum) * fraction
    const topY = ridgeHeight(x, phase, heightScale)
    const localZ = z + Math.sin(x * 0.017 + phase) * 3
    vertices.push(x, baseY, localZ, x, topY, localZ)
    if (index < segments) {
      const offset = index * 2
      indices.push(
        offset,
        offset + 2,
        offset + 1,
        offset + 2,
        offset + 3,
        offset + 1,
      )
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createFarBackground(
  background: Group,
  farIceMass: Group,
): void {
  const rearRidge = new Mesh(
    createRidgeGeometry(-204, 0.8, 37, -22),
    new MeshStandardMaterial({
      color: '#626b6d',
      flatShading: true,
      roughness: 1,
    }),
  )
  rearRidge.name = 'glacier-far-rock-ridge'
  rearRidge.receiveShadow = true
  background.add(rearRidge)

  const iceGeometry = createRidgeGeometry(
    -201,
    0.8,
    37,
    31,
    -12,
    18,
  )
  const positions = iceGeometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 2) {
    const x = positions.getX(index)
    const top = positions.getY(index + 1)
    positions.setY(
      index,
      Math.min(top - 1, Math.max(39, top - 7 - Math.cos(x * 0.047) * 1.5)),
    )
  }
  positions.needsUpdate = true
  iceGeometry.computeVertexNormals()
  const ice = new Mesh(
    iceGeometry,
    new MeshStandardMaterial({
      color: '#d7e0dd',
      emissive: '#26353a',
      emissiveIntensity: 0.08,
      flatShading: true,
      roughness: 0.82,
    }),
  )
  ice.name = 'glacier-far-ice-mass-direction-reference'
  ice.castShadow = false
  ice.receiveShadow = true
  farIceMass.add(ice)

  const horizonHaze = new Mesh(
    new PlaneGeometry(560, 38),
    new MeshBasicMaterial({
      color: '#b7beb9',
      depthWrite: false,
      opacity: 0.16,
      transparent: true,
    }),
  )
  horizonHaze.name = 'glacier-background-horizon-haze'
  horizonHaze.position.set(0, 10, -181)
  horizonHaze.renderOrder = -4
  background.add(horizonHaze)
}

function createGroundGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(
    GROUND_RADIUS_METERS * 2,
    GROUND_RADIUS_METERS * 2,
    112,
    112,
  )
  const positions = geometry.getAttribute('position')
  const colours: number[] = []
  const soil = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const worldZ = -positions.getY(index)
    positions.setZ(index, mammothPalaeoenvironmentGroundY(x, worldZ))
    const macro =
      Math.sin(x * 0.071) * 0.5 +
      Math.cos(worldZ * 0.064) * 0.35 +
      Math.sin((x - worldZ) * 0.023) * 0.15
    soil
      .set(macro > 0.2 ? '#756d47' : macro < -0.28 ? '#5b4937' : '#686044')
      .offsetHSL(0, 0, Math.sin(x * 0.19 + worldZ * 0.11) * 0.018)
    colours.push(soil.r, soil.g, soil.b)
  }
  positions.needsUpdate = true
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.computeVertexNormals()
  return geometry
}

function createGroundSurface(): Mesh<PlaneGeometry, MeshStandardMaterial> {
  const ground = new Mesh(
    createGroundGeometry(),
    new MeshStandardMaterial({
      color: '#ffffff',
      metalness: 0,
      roughness: 0.96,
      vertexColors: true,
    }),
  )
  ground.name = 'glacier-ground-surface-unglaciated-land'
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  return ground
}

function createSnowBlobGeometry(): BufferGeometry {
  const segments = 14
  const vertices = [0, 0, 0]
  const indices: number[] = []
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const radius = 0.78 + Math.sin(index * 4.31) * 0.12 + Math.cos(index * 2.17) * 0.08
    vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % segments))
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

interface SnowLayerResult {
  readonly mesh: InstancedMesh
  readonly maximumCount: number
}

function createSnowLayer(): SnowLayerResult {
  const maximumCount = SURFACE_STATE['late-snow'].patchCount
  const mesh = new InstancedMesh(
    createSnowBlobGeometry(),
    new MeshStandardMaterial({
      color: '#dce5e3',
      metalness: 0,
      roughness: 0.9,
      side: DoubleSide,
    }),
    maximumCount,
  )
  mesh.name = 'glacier-snow-layer-thin-patchy'
  mesh.receiveShadow = true
  const random = seededRandom(0x51a9d2)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const positions: Array<{ x: number; z: number; distance: number }> = []
  let guard = 0
  while (positions.length < maximumCount && guard < 4_000) {
    guard += 1
    const angle = random() * Math.PI * 2
    const distance = 7 + Math.pow(random(), 0.72) * 143
    const x = Math.cos(angle) * distance * (0.72 + random() * 0.5)
    const z = Math.sin(angle) * distance
    if (pointToCorridorDistance(x, z) < 2.4) continue
    positions.push({ x, z, distance: Math.hypot(x, z) })
  }
  positions.sort((left, right) => left.distance - right.distance)
  positions.forEach(({ x, z }, index) => {
    const rotation = random() * Math.PI
    quaternion.setFromEuler(new Euler(-Math.PI / 2, 0, rotation))
    const size = 1.2 + random() * 4.6 + Math.hypot(x, z) * 0.018
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + 0.018, z),
      quaternion,
      new Vector3(size * (0.8 + random() * 0.9), size, 1),
    )
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return { maximumCount, mesh }
}

function createVegetationInstances(
  name: string,
  geometry: BufferGeometry,
  colours: readonly string[],
  count: number,
  minimumDistance: number,
  maximumDistance: number,
  seed: number,
  heightRange: readonly [number, number],
  corridorClearance: number,
): InstancedMesh {
  const material = new MeshLambertMaterial({
    color: colours[0] ?? '#9c965c',
  })
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.name = name
  mesh.castShadow = maximumDistance <= 34
  mesh.receiveShadow = true
  const random = seededRandom(seed)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  let placed = 0
  let guard = 0
  while (placed < count && guard < count * 80) {
    guard += 1
    const angle = random() * Math.PI * 2
    const distance =
      minimumDistance +
      Math.pow(random(), 0.78) * (maximumDistance - minimumDistance)
    const x = Math.cos(angle) * distance * (0.82 + random() * 0.42)
    const z = Math.sin(angle) * distance
    if (pointToCorridorDistance(x, z) < corridorClearance) continue
    const height = heightRange[0] + random() * (heightRange[1] - heightRange[0])
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2)
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + height * 0.5, z),
      quaternion,
      new Vector3(0.72 + random() * 0.7, height, 0.72 + random() * 0.7),
    )
    mesh.setMatrixAt(placed, matrix)
    placed += 1
  }
  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function populateSteppe(nearGround: Group, midSteppe: Group): {
  readonly dwarfWillow: number
  readonly forb: number
  readonly grassAndSedge: number
  readonly rockAndHummock: number
} {
  const grassGeometry = new ConeGeometry(0.045, 1, 3, 1, false)
  const nearGrass = createVegetationInstances(
    'glacier-near-grass-and-sedge',
    grassGeometry,
    ['#b19d61', '#9c965c', '#c0a36a', '#87915e'],
    380,
    5,
    34,
    0x17a22,
    [0.14, 0.46],
    2.5,
  )
  const midGrass = createVegetationInstances(
    'glacier-mid-grass-and-sedge',
    grassGeometry.clone(),
    ['#918e59', '#a59a62', '#7d865b'],
    640,
    30,
    122,
    0x17a23,
    [0.09, 0.34],
    4.4,
  )
  nearGround.add(nearGrass)
  midSteppe.add(midGrass)

  const forbGeometry = new ConeGeometry(0.09, 1, 5, 1, false)
  const forbs = createVegetationInstances(
    'glacier-near-low-forbs',
    forbGeometry,
    ['#b58c73', '#b9a077', '#8d806c', '#b29579'],
    92,
    7,
    45,
    0x28b31,
    [0.08, 0.28],
    3,
  )
  nearGround.add(forbs)

  const willowGeometry = new IcosahedronGeometry(0.5, 1)
  const willows = createVegetationInstances(
    'glacier-mid-dwarf-willow',
    willowGeometry,
    ['#75815b', '#859167', '#69765a'],
    54,
    17,
    88,
    0x39c41,
    [0.18, 0.52],
    5,
  )
  midSteppe.add(willows)

  const rockGeometry = new IcosahedronGeometry(0.5, 1)
  const rocks = createVegetationInstances(
    'glacier-near-rock-and-loess-hummock',
    rockGeometry,
    ['#8d8578', '#9b8d77', '#77766f'],
    34,
    8,
    58,
    0x4ad52,
    [0.12, 0.44],
    3.8,
  )
  nearGround.add(rocks)

  return {
    dwarfWillow: willows.count,
    forb: forbs.count,
    grassAndSedge: nearGrass.count + midGrass.count,
    rockAndHummock: rocks.count,
  }
}

function createFarLandform(farLandform: Group): void {
  const terrace = new Mesh(
    createRidgeGeometry(-142, 2.4, 10, -7),
    new MeshStandardMaterial({
      color: '#706f57',
      flatShading: true,
      roughness: 1,
    }),
  )
  terrace.name = 'glacier-far-unglaciated-valley-terrace'
  terrace.receiveShadow = true
  farLandform.add(terrace)

  const haze = new Mesh(
    new PlaneGeometry(500, 22),
    new MeshBasicMaterial({
      color: '#a8aea4',
      depthWrite: false,
      opacity: 0.09,
      transparent: true,
    }),
  )
  haze.name = 'glacier-far-valley-haze'
  haze.position.set(0, 5, -133)
  haze.renderOrder = -2
  farLandform.add(haze)
}

function addAtmosphere(atmosphere: Group): void {
  const veilMaterial = new MeshBasicMaterial({
    color: '#c2c4b8',
    depthWrite: false,
    opacity: 0.045,
    transparent: true,
  })
  for (const [index, z] of [-88, -178, -276].entries()) {
    const veil = new Mesh(new PlaneGeometry(470, 30 + index * 9), veilMaterial.clone())
    veil.name = `glacier-atmosphere-veil-${index + 1}`
    veil.position.set(0, 9 + index * 5, z)
    veil.renderOrder = -3 + index
    atmosphere.add(veil)
  }
}

function addWorldLighting(background: Group): void {
  const hemisphere = new HemisphereLight('#dbe5e7', '#665c49', 1.7)
  hemisphere.name = 'glacier-world-hemisphere-light'
  const sun = new DirectionalLight('#fff1ce', 3.8)
  sun.name = 'glacier-world-sun'
  sun.position.set(-46, 62, 34)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -32
  sun.shadow.camera.right = 32
  sun.shadow.camera.top = 25
  sun.shadow.camera.bottom = -25
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 150
  sun.shadow.bias = -0.00012
  sun.shadow.normalBias = 0.022
  background.add(hemisphere, sun, sun.target)
}

function geometryTriangleCount(geometry: BufferGeometry): number {
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(geometry.getAttribute('position').count / 3)
}

type EnvironmentMesh = Mesh<BufferGeometry, Material | Material[]>

function isEnvironmentMesh(object: Object3D): object is EnvironmentMesh {
  return object instanceof Mesh
}

function estimateVisibleResources(root: Object3D): MammothPalaeoenvironmentResourceEstimate {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  let drawCalls = 0
  let transparentDrawCalls = 0
  let triangles = 0
  root.traverseVisible((object) => {
    if (!isEnvironmentMesh(object)) return
    drawCalls += 1
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of objectMaterials) {
      materials.add(material)
      if (material.transparent) transparentDrawCalls += 1
    }
    const instances = object instanceof InstancedMesh ? object.count : 1
    triangles += geometryTriangleCount(object.geometry) * instances
  })
  let geometryBytes = 0
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) {
      geometryBytes += attribute.array.byteLength
    }
    if (geometry.index) geometryBytes += geometry.index.array.byteLength
  }
  return {
    drawCalls,
    geometryBytes,
    materials: materials.size,
    textures: 0,
    transparentDrawCalls,
    triangles,
  }
}

function disposeRoot(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (!isEnvironmentMesh(object)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    objectMaterials.forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  root.clear()
}

export function createMammothPalaeoenvironmentCandidate(
  initialVariant: MammothPalaeoenvironmentVariant = 'C',
  initialSurfaceState: MammothPalaeoenvironmentSurfaceState = 'balanced',
): MammothPalaeoenvironmentCandidate {
  const root = new Group()
  root.name = 'scale-encounter-glacier-palaeoenvironment-candidate'

  const background = new Group()
  background.name = 'background-atmosphere'
  const groundSurface = new Group()
  groundSurface.name = 'ground-surface'
  const snowLayer = new Group()
  snowLayer.name = 'snow-layer'
  const nearGround = new Group()
  nearGround.name = 'near-ground'
  const midSteppe = new Group()
  midSteppe.name = 'mid-steppe'
  const farLandform = new Group()
  farLandform.name = 'far-landform'
  const farIceMass = new Group()
  farIceMass.name = 'far-ice-mass'
  const atmosphere = new Group()
  atmosphere.name = 'palaeoenvironment-atmosphere'

  background.add(createSkyDome())
  createFarBackground(background, farIceMass)
  addWorldLighting(background)
  groundSurface.add(createGroundSurface())
  const snow = createSnowLayer()
  snowLayer.add(snow.mesh)
  const vegetationCounts = populateSteppe(nearGround, midSteppe)
  createFarLandform(farLandform)
  addAtmosphere(atmosphere)

  root.add(
    background,
    farIceMass,
    groundSurface,
    snowLayer,
    nearGround,
    midSteppe,
    farLandform,
    atmosphere,
  )

  let variant = initialVariant
  let surfaceState = initialSurfaceState
  const fog = new FogExp2('#aeb4ad', 0.00235)

  const applyVariant = () => {
    const hasGround = variant !== 'A'
    const hasPalaeoenvironment = variant === 'C'
    groundSurface.visible = hasGround
    snowLayer.visible = hasGround
    nearGround.visible = hasPalaeoenvironment
    midSteppe.visible = hasPalaeoenvironment
    farLandform.visible = hasPalaeoenvironment
    atmosphere.visible = hasPalaeoenvironment
  }

  const applySurfaceState = () => {
    snow.mesh.count = Math.min(
      snow.maximumCount,
      SURFACE_STATE[surfaceState].patchCount,
    )
    snow.mesh.instanceMatrix.needsUpdate = true
  }

  applySurfaceState()
  applyVariant()

  return {
    root,
    layers: {
      atmosphere,
      background,
      farIceMass,
      farLandform,
      groundSurface,
      midSteppe,
      nearGround,
      snowLayer,
    },
    scientificAnchor: MAMMOTH_PALAEOENVIRONMENT_ANCHOR,
    diagnostics: () => ({
      anchorId: MAMMOTH_PALAEOENVIRONMENT_ANCHOR.id,
      crevasseCount: 0,
      farIceVolume: {
        maximum: FAR_ICE_MAXIMUM.toArray(),
        minimum: FAR_ICE_MINIMUM.toArray(),
        minimumCorridorSeparationMeters: Math.max(
          0,
          SUBJECT_CORRIDOR.min.z - FAR_ICE_MAXIMUM.z,
        ),
        role: MAMMOTH_PALAEOENVIRONMENT_ANCHOR.iceRole.role,
      },
      groundSurface: {
        kind: 'unglaciated-loess-and-permafrost-topsoil',
        supportsSubjects: true,
        worldRadiusMeters: GROUND_RADIUS_METERS,
      },
      iceTowerCount: 0,
      layerCounts: {
        ...vegetationCounts,
        snowPatches: snow.mesh.count,
      },
      resourceEstimate: estimateVisibleResources(root),
      snowLayer: {
        approximateCoverFraction: SURFACE_STATE[surfaceState].coverFraction,
        supportsSubjects: false,
        thicknessStatement:
          MAMMOTH_PALAEOENVIRONMENT_ANCHOR.seasonClimate.snowDepthStatement,
      },
      surfaceState,
      variant,
    }),
    dispose: () => disposeRoot(root),
    fog: () => (variant === 'C' ? fog : null),
    setSurfaceState: (nextSurfaceState) => {
      surfaceState = nextSurfaceState
      applySurfaceState()
    },
    setVariant: (nextVariant) => {
      variant = nextVariant
      applyVariant()
    },
    update: (elapsedSeconds) => {
      if (!Number.isFinite(elapsedSeconds)) return
      atmosphere.children.forEach((child, index) => {
        if (!(child instanceof Mesh)) return
        child.position.x = Math.sin(elapsedSeconds * 0.025 + index * 2.1) * 1.4
      })
    },
  }
}
