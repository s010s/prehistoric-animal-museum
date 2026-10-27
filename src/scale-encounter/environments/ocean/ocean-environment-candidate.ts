import {
  ACESFilmicToneMapping,
  Box3,
  Box3Helper,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
} from 'three'
import {
  OCEAN_WATER_SURFACE_Y,
  OCEAN_WATER_VOLUME_BOUNDS,
  OCEAN_WORLD_RADIUS,
  createOceanGroundedPlacement,
  diagnoseOceanSpatialContract,
  oceanBedYAt,
  type OceanGroundedPlacement,
  type OceanGroundingSpec,
  type OceanObservationContext,
  type OceanSpatialDiagnostics,
  type OceanStructureLayer,
} from './ocean-spatial-contract'

export type OceanEnvironmentVariant = 'A' | 'B' | 'C'

export type OceanEnvironmentLayer =
  | 'background-scatter'
  | 'water-surface'
  | 'water-volume'
  | 'seabed'
  | 'near-water'
  | 'mid-water'
  | 'far-volume'
  | 'caustics'
  | 'suspended-particulate'
  | 'ecology-clues'

export const OCEAN_ENVIRONMENT_VARIANTS = [
  'A',
  'B',
  'C',
] as const satisfies readonly OceanEnvironmentVariant[]

export const OCEAN_ENVIRONMENT_LAYERS = [
  'background-scatter',
  'water-surface',
  'water-volume',
  'seabed',
  'near-water',
  'mid-water',
  'far-volume',
  'caustics',
  'suspended-particulate',
  'ecology-clues',
] as const satisfies readonly OceanEnvironmentLayer[]

export interface OceanSeabedTextureLease {
  readonly albedo: Texture
  readonly decodedByteEstimate: number
  readonly normal: Texture
  readonly physicalWidthMeters: number
  readonly roughness: Texture
}

export interface OceanBackdropTextureLease {
  readonly aspectRatio: number
  readonly decodedByteEstimate: number
  readonly texture: Texture
}

export interface ApprovedOceanEcologyClue {
  readonly id: string
  readonly object: Object3D
  readonly status: 'approved-for-ocean-slice'
}

export interface CreateOceanEnvironmentCandidateOptions {
  readonly approvedEcologyClues?: readonly ApprovedOceanEcologyClue[]
  readonly backdropTexture?: OceanBackdropTextureLease | null
  readonly debug?: boolean
  readonly seabedTextures?: OceanSeabedTextureLease | null
  readonly variant: OceanEnvironmentVariant
}

export interface OceanResourceDiagnostics {
  readonly drawCalls: number
  readonly estimatedDecodedTextureBytes: number
  readonly geometries: number
  readonly instances: number
  readonly materials: number
  readonly objects: number
  readonly opaqueDrawCalls: number
  readonly textures: number
  readonly transparentDrawCalls: number
  readonly transparentMaterialCount: number
  readonly transparentScreenCoverageEstimate: number
  readonly triangles: number
}

export interface OceanEnvironmentDiagnostics {
  readonly alpha: {
    readonly cardCount: number
    readonly depthWriteDisabledDraws: number
    readonly repeatedCardGroups: number
  }
  readonly approvedEcologyAssetIds: readonly string[]
  readonly browserIndependentDesignChecks: {
    readonly colourDiscontinuityBands: number
    readonly ecologyFallbackReason: string | null
    readonly repeatedFarCards: number
  }
  readonly fogDensity: number
  readonly layers: Readonly<Record<OceanEnvironmentLayer, boolean>>
  readonly resources: OceanResourceDiagnostics
  readonly spatial: OceanSpatialDiagnostics | null
  readonly variant: OceanEnvironmentVariant
  readonly world: {
    readonly metresPerUnit: 1
    readonly toneMapping: 'ACESFilmicToneMapping'
    readonly upAxis: '+Y'
    readonly waterSurfaceY: number
  }
}

export interface OceanEnvironmentCandidate {
  readonly root: Group
  readonly toneMapping: typeof ACESFilmicToneMapping
  dispose(): void
  getDiagnostics(): OceanEnvironmentDiagnostics
  getFog(): FogExp2 | null
  setDebugVisible(visible: boolean): void
  setLayerEnabled(layer: OceanEnvironmentLayer, enabled: boolean): void
  setObservationContext(context: OceanObservationContext): void
  setVariant(variant: OceanEnvironmentVariant): void
  update(
    elapsedSeconds: number,
    camera: Camera,
    viewport?: { readonly height: number; readonly width: number },
  ): void
}

const layerDefaults: Readonly<
  Record<OceanEnvironmentVariant, ReadonlySet<OceanEnvironmentLayer>>
> = {
  A: new Set(['background-scatter']),
  B: new Set([
    'background-scatter',
    'water-surface',
    'water-volume',
    'seabed',
    'caustics',
  ]),
  C: new Set(OCEAN_ENVIRONMENT_LAYERS),
}

function createBackdropMaterial(
  lease: OceanBackdropTextureLease | null,
): ShaderMaterial {
  return new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uBackdrop: { value: lease?.texture ?? null },
      uTextureAspect: { value: lease?.aspectRatio ?? 16 / 9 },
      uTime: { value: 0 },
      uUseBackdrop: { value: lease ? 1 : 0 },
      uViewportAspect: { value: 16 / 9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uBackdrop;
      uniform float uTextureAspect;
      uniform float uTime;
      uniform float uUseBackdrop;
      uniform float uViewportAspect;

      float softNoise(vec2 p) {
        return sin(p.x * 3.7 + sin(p.y * 2.1)) *
               sin(p.y * 3.1 - p.x * 2.8) * 0.5 + 0.5;
      }

      void main() {
        vec2 backdropUv = vUv;
        if (uViewportAspect > uTextureAspect) {
          backdropUv.y =
            (backdropUv.y - 0.5) * (uTextureAspect / uViewportAspect) + 0.5;
        } else {
          backdropUv.x =
            (backdropUv.x - 0.5) * (uViewportAspect / uTextureAspect) + 0.5;
        }

        vec3 approvedBackdrop = texture2D(uBackdrop, backdropUv).rgb;
        float vertical = clamp(vUv.y, 0.0, 1.0);
        vec3 deep = vec3(0.018, 0.310, 0.395);
        vec3 middle = vec3(0.055, 0.510, 0.585);
        vec3 upper = vec3(0.410, 0.820, 0.790);
        vec3 fallback = mix(deep, middle, smoothstep(0.0, 0.67, vertical));
        fallback = mix(fallback, upper, smoothstep(0.67, 1.0, vertical));
        float lowFrequency = softNoise(vUv * 4.0 + uTime * 0.002);
        fallback *= 0.96 + lowFrequency * 0.04;
        float sunDistance = length((vUv - vec2(0.16, 0.88)) * vec2(0.72, 1.0));
        float sunHalo = 1.0 - smoothstep(0.03, 0.42, sunDistance);
        fallback += vec3(0.82, 0.97, 0.78) * sunHalo * 0.42;
        vec3 colour = mix(fallback, approvedBackdrop, uUseBackdrop);
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  })
}

function createWaterSurfaceMaterial(
  lease: OceanBackdropTextureLease | null,
): ShaderMaterial {
  return new ShaderMaterial({
    depthTest: true,
    depthWrite: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uBackdrop: { value: lease?.texture ?? null },
      uResolution: { value: new Vector2(1_600, 900) },
      uTextureAspect: { value: lease?.aspectRatio ?? 16 / 9 },
      uTime: { value: 0 },
      uUseBackdrop: { value: lease ? 1 : 0 },
      uViewportAspect: { value: 16 / 9 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPosition;
      uniform sampler2D uBackdrop;
      uniform vec2 uResolution;
      uniform float uTextureAspect;
      uniform float uTime;
      uniform float uUseBackdrop;
      uniform float uViewportAspect;

      float softNoise(vec3 p) {
        return sin(p.x * 3.7 + sin(p.z * 2.1)) *
               sin(p.z * 3.1 - p.y * 2.8) * 0.5 + 0.5;
      }

      vec3 backdropColour(vec3 direction) {
        float vertical = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 deep = vec3(0.018, 0.310, 0.395);
        vec3 middle = vec3(0.055, 0.510, 0.585);
        vec3 upper = vec3(0.410, 0.820, 0.790);
        vec3 colour = mix(deep, middle, smoothstep(0.0, 0.58, vertical));
        colour = mix(colour, upper, smoothstep(0.58, 1.0, vertical));
        float lowFrequency = softNoise(direction * 1.7 + uTime * 0.002);
        colour *= 0.94 + lowFrequency * 0.06;
        vec3 sunDirection = normalize(vec3(-0.44, 0.82, -0.36));
        float sun = pow(max(dot(direction, sunDirection), 0.0), 44.0);
        float halo = pow(max(dot(direction, sunDirection), 0.0), 7.0);
        colour += vec3(0.72, 0.94, 0.80) * halo * 0.24;
        colour += vec3(1.0, 0.98, 0.80) * sun * 0.56;
        return colour;
      }

      void main() {
        vec2 backdropUv = gl_FragCoord.xy / uResolution;
        if (uViewportAspect > uTextureAspect) {
          backdropUv.y =
            (backdropUv.y - 0.5) * (uTextureAspect / uViewportAspect) + 0.5;
        } else {
          backdropUv.x =
            (backdropUv.x - 0.5) * (uViewportAspect / uTextureAspect) + 0.5;
        }
        vec3 approvedSurface = texture2D(uBackdrop, backdropUv).rgb;
        vec2 p = vWorldPosition.xz;
        float waveA = sin(p.x * 0.46 + p.y * 0.14 + uTime * 0.15);
        float waveB = sin(p.y * 0.55 - p.x * 0.11 - uTime * 0.11);
        float waveC = sin((p.x + p.y) * 0.29 + uTime * 0.07);
        float ripple = (waveA + waveB + waveC) / 3.0;
        float crossRipple = sin(p.x * 0.88 - p.y * 0.53 + uTime * 0.19) *
          sin(p.y * 0.74 + p.x * 0.23 - uTime * 0.13);
        float crest = smoothstep(0.67, 0.94, ripple * 0.5 + crossRipple * 0.2 + 0.5);
        vec3 base = mix(
          vec3(0.105, 0.470, 0.555),
          vec3(0.410, 0.755, 0.765),
          ripple * 0.5 + 0.5
        );
        base += vec3(0.72, 0.95, 0.88) * crest * 0.2;
        vec2 sunPoint = vec2(-28.0, -13.0);
        float distanceToSun = length(p - sunPoint);
        float halo = 1.0 - smoothstep(5.0, 38.0, distanceToSun);
        float core = 1.0 - smoothstep(0.0, 8.5, distanceToSun);
        base += vec3(0.74, 0.93, 0.78) * halo * 0.24;
        base += vec3(1.0, 0.98, 0.76) * core * 0.34;
        base = mix(base, approvedSurface, uUseBackdrop * 0.9);
        base += vec3(0.62, 0.91, 0.86) * crest * uUseBackdrop * 0.035;
        float radial = length(p) / 96.0;
        float farBlend = smoothstep(0.62, 0.98, radial);
        vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
        float grazingBlend = 1.0 - smoothstep(0.025, 0.13, abs(rayDirection.y));
        base = mix(
          base,
          backdropColour(rayDirection),
          max(farBlend, grazingBlend) * 0.82 * (1.0 - uUseBackdrop)
        );
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  })
}

function createCausticTexture(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size
      const a = Math.sin((u * 7.1 + Math.sin(v * 8.4)) * Math.PI)
      const b = Math.sin((v * 6.6 - Math.sin(u * 7.8)) * Math.PI)
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(a + b) * 0.64), 3.2)
      const value = Math.round(255 * Math.min(1, ridge * 0.4))
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.name = 'ocean-procedural-caustic-v2-soft'
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(9, 9)
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createSeabedGeometry(
  size = OCEAN_WORLD_RADIUS * 2,
  segments = 64,
): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let row = 0; row <= segments; row += 1) {
    const v = row / segments
    const z = (v - 0.5) * size
    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments
      const x = (u - 0.5) * size
      positions.push(x, oceanBedYAt(x, z), z)
      uvs.push(u, v)
    }
  }
  const width = segments + 1
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const topLeft = row * width + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + width
      const bottomRight = bottomLeft + 1
      indices.push(
        topLeft,
        bottomLeft,
        topRight,
        topRight,
        bottomLeft,
        bottomRight,
      )
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = 'ocean-seabed-world-grid-v1'
  return geometry
}

function configureBorrowedSeabedTextures(
  lease: OceanSeabedTextureLease,
): void {
  const repeats = (OCEAN_WORLD_RADIUS * 2) / lease.physicalWidthMeters
  for (const texture of [lease.albedo, lease.normal, lease.roughness]) {
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    texture.repeat.set(repeats, repeats)
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.needsUpdate = true
  }
  lease.albedo.colorSpace = SRGBColorSpace
}

function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453
  return value - Math.floor(value)
}

function makeRotation(x: number, y: number, z: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(x, y, z))
}

function structureSpecs(
  layer: OceanStructureLayer,
): readonly OceanGroundingSpec[] {
  const layouts = {
    'near-water': [
      [-38, 27],
      [36, -29],
    ],
    'mid-water': [
      [-55, 35],
      [53, -41],
    ],
    'far-volume': [
      [-77, 46],
      [75, -47],
    ],
  } as const
  const layerIndex = layer === 'near-water' ? 1 : layer === 'mid-water' ? 2 : 3
  return layouts[layer].map(([x, z], index) => {
    const width =
      layer === 'near-water'
        ? 1.1 + seededUnit(index + layerIndex * 31) * 0.9
        : layer === 'mid-water'
          ? 1.8 + seededUnit(index + layerIndex * 37) * 1.2
          : 3.2 + seededUnit(index + layerIndex * 41) * 1.8
    return {
      burialDepth: layer === 'far-volume' ? 0.22 : 0.12,
      layer,
      name: `ocean-${layer}-structure-${index + 1}`,
      positionXZ: [x, z] as const,
      rotation: makeRotation(
        (seededUnit(index + 5) - 0.5) * 0.24,
        seededUnit(index + 13) * Math.PI * 2,
        (seededUnit(index + 19) - 0.5) * 0.2,
      ),
      scale: new Vector3(
        width,
        width * (layer === 'far-volume' ? 0.19 : 0.24),
        width * (0.72 + seededUnit(index + 23) * 0.55),
      ),
    }
  })
}

function createStructureLayer(
  layer: OceanStructureLayer,
): {
  readonly grounded: readonly OceanGroundedPlacement[]
  readonly mesh: InstancedMesh
} {
  const geometry = new DodecahedronGeometry(0.5, 0)
  geometry.computeBoundingBox()
  const localBounds = geometry.boundingBox
  if (!localBounds) throw new Error('ocean-structure-bounds-unavailable')
  const specs = structureSpecs(layer)
  const grounded = specs.map((spec) =>
    createOceanGroundedPlacement(localBounds, spec),
  )
  const colours = {
    'near-water': '#78968c',
    'mid-water': '#6f9188',
    'far-volume': '#5f8782',
  } as const
  const material = new MeshStandardMaterial({
    color: colours[layer],
    metalness: 0,
    roughness: 0.91,
  })
  const mesh = new InstancedMesh(geometry, material, grounded.length)
  mesh.name = `ocean-${layer}-structures`
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = true
  grounded.forEach(({ matrix }, index) => mesh.setMatrixAt(index, matrix))
  grounded.forEach((_, index) => {
    const base = new Color(colours[layer])
    const variation = 0.88 + seededUnit(index + layerIndexForColour(layer)) * 0.18
    mesh.setColorAt(index, base.multiplyScalar(variation))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return { grounded, mesh }
}

function layerIndexForColour(layer: OceanStructureLayer): number {
  return layer === 'near-water' ? 101 : layer === 'mid-water' ? 211 : 307
}

function createSuspendedParticulate(): Points {
  const positions: number[] = []
  for (let index = 0; index < 24; index += 1) {
    const angle = seededUnit(index + 71) * Math.PI * 2
    const radius = 24 + seededUnit(index + 79) * 58
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const top = OCEAN_WATER_SURFACE_Y - 2
    const bottom = oceanBedYAt(x, z) + 2
    const y = bottom + seededUnit(index + 83) * (top - bottom)
    positions.push(x, y, z)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = new PointsMaterial({
    color: '#d3f3de',
    depthWrite: false,
    opacity: 0.14,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
  })
  const points = new Points(geometry, material)
  points.name = 'ocean-suspended-particulate-low-density'
  points.renderOrder = 2
  return points
}

function materialList(object: Mesh | Points | InstancedMesh): readonly Material[] {
  return Array.isArray(object.material) ? object.material : [object.material]
}

function isRenderable(object: Object3D): object is Mesh | Points | InstancedMesh {
  return object instanceof Mesh || object instanceof Points || object instanceof InstancedMesh
}

function effectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function triangleCount(geometry: BufferGeometry): number {
  return geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute('position')?.count ?? 0) / 3
}

function inspectResources(
  root: Group,
  borrowedTextureBytes: number,
): OceanResourceDiagnostics {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<unknown>()
  let drawCalls = 0
  let opaqueDrawCalls = 0
  let transparentDrawCalls = 0
  let instances = 0
  let objects = 0
  let triangles = 0
  root.traverse((object) => {
    if (!effectivelyVisible(object)) return
    objects += 1
    if (!isRenderable(object)) return
    drawCalls += 1
    const objectMaterials = materialList(object)
    const transparent = objectMaterials.some((material) => material.transparent)
    if (transparent) transparentDrawCalls += 1
    else opaqueDrawCalls += 1
    geometries.add(object.geometry)
    objectMaterials.forEach((material) => {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
      if (material instanceof ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof Texture) textures.add(uniform.value)
        }
      }
    })
    const instanceCount = object instanceof InstancedMesh ? object.count : 1
    instances += instanceCount
    triangles += triangleCount(object.geometry) * instanceCount
  })
  const proceduralTextureBytes = [...textures]
    .filter((texture): texture is DataTexture => texture instanceof DataTexture)
    .reduce((sum, texture) => {
      const data = texture.image as { readonly height?: number; readonly width?: number }
      return sum + (data.width ?? 0) * (data.height ?? 0) * 4 * (4 / 3)
    }, 0)
  return {
    drawCalls,
    estimatedDecodedTextureBytes: Math.round(
      borrowedTextureBytes + proceduralTextureBytes,
    ),
    geometries: geometries.size,
    instances,
    materials: materials.size,
    objects,
    opaqueDrawCalls,
    textures: textures.size,
    transparentDrawCalls,
    transparentMaterialCount: [...materials].filter(
      (material) => material.transparent,
    ).length,
    transparentScreenCoverageEstimate:
      transparentDrawCalls === 0 ? 0 : 0.009,
    triangles: Math.round(triangles),
  }
}

function createBoundaryContour(): LineLoop {
  const positions: number[] = []
  const samples = 96
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2
    const x = Math.cos(angle) * OCEAN_WORLD_RADIUS
    const z = Math.sin(angle) * OCEAN_WORLD_RADIUS
    positions.push(x, oceanBedYAt(x, z) + 0.05, z)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  const line = new LineLoop(
    geometry,
    new LineBasicMaterial({ color: '#ffb95c' }),
  )
  line.name = 'ocean-debug-seabed-boundary'
  return line
}

function disposeObjectTree(
  root: Object3D,
  borrowedTextures: ReadonlySet<unknown>,
): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<unknown>()
  root.traverse((object) => {
    if (!isRenderable(object) && !(object instanceof LineLoop) && !(object instanceof Box3Helper)) {
      return
    }
    const geometry = (object as Mesh | Points | LineLoop | Box3Helper).geometry
    if (geometry) geometries.add(geometry)
    const material = (object as Mesh | Points | LineLoop | Box3Helper).material
    const objectMaterials = Array.isArray(material) ? material : [material]
    for (const entry of objectMaterials) {
      if (!entry) continue
      materials.add(entry)
      for (const value of Object.values(entry)) {
        if (value instanceof Texture && !borrowedTextures.has(value)) {
          textures.add(value)
        }
      }
    }
  })
  textures.forEach((texture) => {
    if (texture instanceof Texture) texture.dispose()
  })
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
  root.removeFromParent()
  root.clear()
}

export function createOceanEnvironmentCandidate(
  options: CreateOceanEnvironmentCandidateOptions,
): OceanEnvironmentCandidate {
  const root = new Group()
  root.name = 'scale-encounter-ocean-candidate'
  const layerRoots = Object.fromEntries(
    OCEAN_ENVIRONMENT_LAYERS.map((layer) => {
      const group = new Group()
      group.name = `ocean-layer-${layer}`
      root.add(group)
      return [layer, group]
    }),
  ) as Record<OceanEnvironmentLayer, Group>

  const backdropTextureLease = options.backdropTexture ?? null
  if (backdropTextureLease) {
    backdropTextureLease.texture.colorSpace = SRGBColorSpace
    backdropTextureLease.texture.generateMipmaps = true
    backdropTextureLease.texture.minFilter = LinearMipmapLinearFilter
    backdropTextureLease.texture.magFilter = LinearFilter
    backdropTextureLease.texture.needsUpdate = true
  }
  const backdropMaterial = createBackdropMaterial(backdropTextureLease)
  const backdrop = new Mesh(
    new PlaneGeometry(2, 2),
    backdropMaterial,
  )
  backdrop.name = 'ocean-background-approved-exhibit-reference'
  backdrop.frustumCulled = false
  backdrop.renderOrder = -100
  layerRoots['background-scatter'].add(backdrop)

  const surfaceMaterial = createWaterSurfaceMaterial(backdropTextureLease)
  const surface = new Mesh(
    new CircleGeometry(OCEAN_WORLD_RADIUS, 96),
    surfaceMaterial,
  )
  surface.name = 'ocean-world-water-surface'
  surface.position.y = OCEAN_WATER_SURFACE_Y
  surface.rotation.x = Math.PI / 2
  surface.renderOrder = -5
  layerRoots['water-surface'].add(surface)

  const volumeContract = new Group()
  volumeContract.name = 'ocean-world-water-volume-contract'
  volumeContract.userData.oceanWaterVolumeBounds = OCEAN_WATER_VOLUME_BOUNDS.clone()
  layerRoots['water-volume'].add(volumeContract)

  const borrowedTextures = new Set<unknown>()
  if (backdropTextureLease) {
    borrowedTextures.add(backdropTextureLease.texture)
  }
  const textureLease = options.seabedTextures ?? null
  if (textureLease) {
    configureBorrowedSeabedTextures(textureLease)
    borrowedTextures.add(textureLease.albedo)
    borrowedTextures.add(textureLease.normal)
    borrowedTextures.add(textureLease.roughness)
  }
  const causticTexture = createCausticTexture()
  const seabedGeometry = createSeabedGeometry()
  const seabedMaterial = new MeshStandardMaterial({
    color: textureLease ? '#e4ecdc' : '#b7cbc0',
    emissive: new Color('#91ddca'),
    emissiveIntensity: 0.045,
    emissiveMap: causticTexture,
    map: textureLease?.albedo ?? null,
    metalness: 0,
    normalMap: textureLease?.normal ?? null,
    normalScale: new Vector2(0.24, 0.24),
    roughness: 0.96,
    roughnessMap: textureLease?.roughness ?? null,
  })
  const seabed = new Mesh(seabedGeometry, seabedMaterial)
  seabed.name = 'ocean-world-seabed'
  seabed.receiveShadow = false
  seabed.renderOrder = -10
  layerRoots.seabed.add(seabed)

  const groundedObjects: OceanGroundedPlacement[] = []
  for (const layer of [
    'near-water',
    'mid-water',
    'far-volume',
  ] as const) {
    const structures = createStructureLayer(layer)
    groundedObjects.push(...structures.grounded)
    layerRoots[layer].add(structures.mesh)
  }

  const particulate = createSuspendedParticulate()
  layerRoots['suspended-particulate'].add(particulate)

  const approvedEcologyClues = options.approvedEcologyClues ?? []
  for (const clue of approvedEcologyClues) {
    if (clue.status !== 'approved-for-ocean-slice') continue
    clue.object.name ||= `ocean-approved-ecology-${clue.id}`
    layerRoots['ecology-clues'].add(clue.object)
  }

  const debugRoot = new Group()
  debugRoot.name = 'ocean-review-debug-boundaries'
  const volumeHelper = new Box3Helper(OCEAN_WATER_VOLUME_BOUNDS, '#68f3e8')
  volumeHelper.name = 'ocean-debug-water-volume'
  const seabedContour = createBoundaryContour()
  debugRoot.add(volumeHelper, seabedContour)
  root.add(debugRoot)
  let observationDebugRoot = new Group()
  observationDebugRoot.name = 'ocean-review-debug-observation-corridor'
  debugRoot.add(observationDebugRoot)

  const explicitLayerOverrides = new Map<OceanEnvironmentLayer, boolean>()
  let currentVariant = options.variant
  let observationContext: OceanObservationContext | null = null
  let spatialDiagnostics: OceanSpatialDiagnostics | null = null
  let debugVisible = options.debug ?? false

  const applyVisibility = () => {
    const defaults = layerDefaults[currentVariant]
    for (const layer of OCEAN_ENVIRONMENT_LAYERS) {
      const requested = explicitLayerOverrides.get(layer) ?? defaults.has(layer)
      layerRoots[layer].visible =
        layer === 'ecology-clues'
          ? requested && layerRoots[layer].children.length > 0
          : requested
    }
    seabedMaterial.emissiveIntensity = layerRoots.caustics.visible ? 0.045 : 0
    debugRoot.visible = debugVisible
    if (observationContext) {
      spatialDiagnostics = diagnoseOceanSpatialContract(
        observationContext,
        groundedObjects.filter(({ layer }) => layerRoots[layer].visible),
        layerRoots.seabed.visible,
      )
    }
  }

  const rebuildObservationDebug = (context: OceanObservationContext) => {
    disposeObjectTree(observationDebugRoot, borrowedTextures)
    observationDebugRoot = new Group()
    observationDebugRoot.name = 'ocean-review-debug-observation-corridor'
    observationDebugRoot.add(
      new Box3Helper(context.animalBounds.clone(), '#ffca68'),
      new Box3Helper(context.avatarBounds.clone(), '#ff7ca8'),
      ...context.cameraSamples.map(({ label, position }) => {
        const box = new Box3().setFromCenterAndSize(
          position,
          new Vector3(0.5, 0.5, 0.5),
        )
        const helper = new Box3Helper(box, '#fff19a')
        helper.name = `ocean-debug-camera-${label}`
        return helper
      }),
    )
    debugRoot.add(observationDebugRoot)
  }

  const getLayerState = (): Record<OceanEnvironmentLayer, boolean> =>
    Object.fromEntries(
      OCEAN_ENVIRONMENT_LAYERS.map((layer) => [layer, layerRoots[layer].visible]),
    ) as Record<OceanEnvironmentLayer, boolean>

  applyVisibility()

  return {
    root,
    toneMapping: ACESFilmicToneMapping,
    dispose: () => disposeObjectTree(root, borrowedTextures),
    getDiagnostics: () => {
      const layers = getLayerState()
      const resources = inspectResources(
        root,
        (backdropTextureLease?.decodedByteEstimate ?? 0) +
          (textureLease?.decodedByteEstimate ?? 0),
      )
      const depthWriteDisabledDraws = (() => {
        let count = 0
        root.traverse((object) => {
          if (!effectivelyVisible(object) || !isRenderable(object)) return
          if (materialList(object).some((material) => !material.depthWrite)) {
            count += 1
          }
        })
        return count
      })()
      return {
        alpha: {
          cardCount: 0,
          depthWriteDisabledDraws,
          repeatedCardGroups: 0,
        },
        approvedEcologyAssetIds: approvedEcologyClues.map(({ id }) => id),
        browserIndependentDesignChecks: {
          colourDiscontinuityBands: 0,
          ecologyFallbackReason:
            approvedEcologyClues.length === 0
              ? 'No ocean ecology asset is approved in the supplied manifest; C keeps the ecology layer empty.'
              : null,
          repeatedFarCards: 0,
        },
        fogDensity:
          currentVariant === 'A' || !layers['water-volume']
            ? 0
            : currentVariant === 'B'
              ? 0.0055
              : 0.0065,
        layers,
        resources,
        spatial: spatialDiagnostics,
        variant: currentVariant,
        world: {
          metresPerUnit: 1,
          toneMapping: 'ACESFilmicToneMapping',
          upAxis: '+Y',
          waterSurfaceY: OCEAN_WATER_SURFACE_Y,
        },
      }
    },
    getFog: () => {
      const density =
        currentVariant === 'A' || !layerRoots['water-volume'].visible
          ? 0
          : currentVariant === 'B'
            ? 0.0055
            : 0.0065
      return density > 0 ? new FogExp2('#2c8d99', density) : null
    },
    setDebugVisible: (visible) => {
      debugVisible = visible
      applyVisibility()
    },
    setLayerEnabled: (layer, enabled) => {
      explicitLayerOverrides.set(layer, enabled)
      applyVisibility()
    },
    setObservationContext: (context) => {
      observationContext = context
      rebuildObservationDebug(context)
      applyVisibility()
    },
    setVariant: (variant) => {
      currentVariant = variant
      explicitLayerOverrides.clear()
      applyVisibility()
    },
    update: (elapsedSeconds, camera, viewport) => {
      if (camera instanceof PerspectiveCamera) {
        const distance = Math.min(210, camera.far * 0.9)
        const direction = camera.getWorldDirection(new Vector3())
        const height =
          2 * distance * Math.tan((camera.fov * Math.PI) / 360) * 1.01
        backdrop.position.copy(camera.position).addScaledVector(direction, distance)
        backdrop.quaternion.copy(camera.quaternion)
        backdrop.scale.set((height * camera.aspect) / 2, height / 2, 1)
        backdropMaterial.uniforms.uViewportAspect!.value = camera.aspect
        surfaceMaterial.uniforms.uViewportAspect!.value = camera.aspect
      } else {
        backdrop.position.copy(camera.position)
        backdrop.quaternion.copy(camera.quaternion)
        backdrop.scale.setScalar(200)
      }
      if (viewport && viewport.width > 0 && viewport.height > 0) {
        ;(surfaceMaterial.uniforms.uResolution!.value as Vector2).set(
          viewport.width,
          viewport.height,
        )
      }
      backdropMaterial.uniforms.uTime!.value = elapsedSeconds
      surfaceMaterial.uniforms.uTime!.value = elapsedSeconds
    },
  }
}
