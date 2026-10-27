import {
  BackSide,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type BufferAttribute,
  type Material,
  type PerspectiveCamera,
} from 'three'
import {
  SKY_HEIGHT_BANDS,
  SKY_REFERENCE_Y_METERS,
  SKY_SCENE_CONTRACT_REVISION,
  skyLayersForVariant,
  type SkyAssetLeaseIdentity,
  type SkyCameraState,
  type SkyEnvironmentVariant,
  type SkyLayerId,
  type SkyRendererCapabilities,
} from './sky-contract'
import {
  boundsAltitudeRange,
  estimateGeometryResources,
  estimateTransparentOverdraw,
  inspectSkyClouds,
  projectWorldBounds,
  serializeBox3,
  serializeVector3,
  worldBoundsFor,
  type GeometryResourceEstimate,
  type SerializedBox3,
  type SkyCloudDiagnostic,
  type SkyCloudDiagnosticInput,
  type TransparentOverdrawEstimate,
} from './sky-diagnostics'

export interface SkyEnvironmentCandidateInput {
  readonly assetLease: SkyAssetLeaseIdentity
  readonly avatarBounds: Readonly<Box3>
  readonly cameraState: SkyCameraState
  readonly cameraSweepBounds: Readonly<Box3>
  readonly corridorBounds: Readonly<Box3>
  readonly rendererCapabilities: SkyRendererCapabilities
  readonly subjectBounds: Readonly<Box3>
  readonly variant: SkyEnvironmentVariant
}

export interface SkyLayerState {
  readonly id: SkyLayerId
  readonly visible: boolean
}

export interface SkyAlphaDiagnostic {
  readonly alphaMode: 'opaque' | 'premultiplied-blend'
  readonly alphaTextureCount: number
  readonly cloudMaterialsPremultiplied: boolean
  readonly cloudMaterialsUseMipmaps: false
  readonly cloudMaterialsDepthWriteDisabled: boolean
  readonly edgeRgbPolicy: string
}

export interface SkyEnvironmentDiagnostics {
  readonly alpha: SkyAlphaDiagnostic
  readonly assetLease: SkyAssetLeaseIdentity
  readonly avatarOcclusionEvaluated: boolean
  readonly avatarBounds: SerializedBox3
  readonly camera: {
    readonly aspect: number
    readonly far: number
    readonly fieldOfViewDegrees: number
    readonly near: number
    readonly position: ReturnType<typeof serializeVector3>
    readonly stage: SkyCameraState['stage']
    readonly target: ReturnType<typeof serializeVector3>
  }
  readonly cameraSweepBounds: SerializedBox3
  readonly cloudCount: number
  readonly cloudDiagnostics: readonly SkyCloudDiagnostic[]
  readonly corridorBounds: SerializedBox3
  readonly corridorOverlapCount: number
  readonly heightBands: typeof SKY_HEIGHT_BANDS
  readonly layerStates: readonly SkyLayerState[]
  readonly referenceY: number
  readonly rendererCapabilities: SkyRendererCapabilities
  readonly resources: GeometryResourceEstimate & {
    readonly activeMaterialCount: number
    readonly proceduralTextureBytes: 0
    readonly transparentDrawEstimate: number
  }
  readonly sceneContractRevision: typeof SKY_SCENE_CONTRACT_REVISION
  readonly subjectBounds: SerializedBox3
  readonly subjectOcclusionMaximumFraction: number
  readonly transparentOverdraw: TransparentOverdrawEstimate
  readonly variant: SkyEnvironmentVariant
}

export interface SkyDiagnosticMode {
  readonly backgroundTone?: 'normal' | 'dark'
  readonly isolateLayers?: readonly SkyLayerId[] | null
  readonly showFlightVolumes?: boolean
  readonly showOverdraw?: boolean
}

export interface SkyEnvironmentCandidate {
  readonly root: Group
  dispose(): void
  getDiagnostics(
    camera: PerspectiveCamera,
    cameraState: SkyCameraState,
    subjectBounds: Readonly<Box3>,
    avatarBounds: Readonly<Box3>,
  ): SkyEnvironmentDiagnostics
  setCorridorBounds(
    corridorBounds: Readonly<Box3>,
    cameraSweepBounds: Readonly<Box3>,
  ): void
  setDiagnosticMode(mode: SkyDiagnosticMode): void
  setVariant(variant: SkyEnvironmentVariant): void
  update(
    elapsedSeconds: number,
    reducedMotion: boolean,
    camera: Camera,
  ): void
}

type CloudLayer = Extract<
  SkyLayerId,
  'near-air' | 'mid-cloud' | 'far-cloud'
>

interface CloudLobeSpec {
  readonly offset: readonly [number, number, number]
  readonly scale: readonly [number, number, number]
}

interface CloudClusterSpec {
  readonly id: string
  readonly layer: CloudLayer
  readonly lobes: readonly CloudLobeSpec[]
  readonly opacity: number
  readonly position: readonly [number, number, number]
  readonly tint: string
  readonly yawDegrees: number
}

interface CloudEntry extends SkyCloudDiagnosticInput {
  readonly material: ShaderMaterial
}

const WORLD_UP = new Vector3(0, 1, 0)
const SUN_DIRECTION = new Vector3(-0.42, 0.78, -0.46).normalize()
const BACKGROUND_RADIUS_METERS = 215
const CLOUD_LAYER_SCALE: Readonly<Record<CloudLayer, number>> = {
  'near-air': 0.11,
  'mid-cloud': 0.14,
  'far-cloud': 0.16,
}

const CLOUD_CLUSTERS: readonly CloudClusterSpec[] = [
  {
    id: 'near-air-west-wisp',
    layer: 'near-air',
    position: [-20, 20, -22],
    yawDegrees: 18,
    opacity: 0.42,
    tint: '#f7fbff',
    lobes: [
      { offset: [-3.8, 0, 0], scale: [7.8, 1.45, 3.1] },
      { offset: [1.8, 0.5, 0.6], scale: [9.2, 2.1, 4.2] },
      { offset: [6.2, -0.15, -0.4], scale: [5.8, 1.35, 2.6] },
    ],
  },
  {
    id: 'near-air-east-thread',
    layer: 'near-air',
    position: [-15.4, 20, 36],
    yawDegrees: -24,
    opacity: 0.38,
    tint: '#edf7ff',
    lobes: [
      { offset: [-4.5, 0, 0.2], scale: [7, 1.2, 2.5] },
      { offset: [0.8, 0.45, 0], scale: [8.6, 1.8, 3.4] },
      { offset: [6.1, -0.2, 0.4], scale: [5.2, 1.1, 2.2] },
    ],
  },
  {
    id: 'mid-cloud-south-break',
    layer: 'mid-cloud',
    position: [-11, -10, -30],
    yawDegrees: -9,
    opacity: 0.5,
    tint: '#e9f3fa',
    lobes: [
      { offset: [-7.2, -0.4, 0], scale: [10.5, 2.3, 5.2] },
      { offset: [0, 0.8, -0.5], scale: [13.8, 3.3, 6.8] },
      { offset: [9.5, -0.1, 0.7], scale: [8.8, 2.2, 4.9] },
    ],
  },
  {
    id: 'mid-cloud-north-island',
    layer: 'mid-cloud',
    position: [-6, -14, 44],
    yawDegrees: 31,
    opacity: 0.47,
    tint: '#f4f8fb',
    lobes: [
      { offset: [-6.4, 0, 0.5], scale: [9.4, 2, 4.5] },
      { offset: [0, 0.9, -0.4], scale: [12.2, 3.1, 6.1] },
      { offset: [8.5, 0.1, 1], scale: [7.2, 1.8, 4] },
    ],
  },
  {
    id: 'mid-cloud-east-ribbon',
    layer: 'mid-cloud',
    position: [4, -19, 8],
    yawDegrees: -37,
    opacity: 0.4,
    tint: '#e6f0f7',
    lobes: [
      { offset: [-8, 0, 0], scale: [11.2, 1.6, 4.3] },
      { offset: [1, 0.5, 0.5], scale: [14.8, 2.4, 5.5] },
      { offset: [11, -0.2, -0.4], scale: [7.6, 1.4, 3.8] },
    ],
  },
  {
    id: 'far-cloud-coast-a',
    layer: 'far-cloud',
    position: [-42, -34, -42],
    yawDegrees: 14,
    opacity: 0.38,
    tint: '#dcebf4',
    lobes: [
      { offset: [-11, 0, 0], scale: [16, 2.8, 7] },
      { offset: [1, 1.1, -0.8], scale: [20, 4.1, 9.5] },
      { offset: [15, -0.2, 0.8], scale: [12, 2.5, 6] },
    ],
  },
  {
    id: 'far-cloud-coast-b',
    layer: 'far-cloud',
    position: [-15, -38, 58],
    yawDegrees: -21,
    opacity: 0.35,
    tint: '#e7f1f6',
    lobes: [
      { offset: [-12, 0.1, 0.6], scale: [17, 2.5, 7.5] },
      { offset: [0, 0.9, 0], scale: [21, 3.8, 10] },
      { offset: [16, -0.4, -0.7], scale: [12.5, 2.1, 6.2] },
    ],
  },
  {
    id: 'far-cloud-open-water',
    layer: 'far-cloud',
    position: [2, -31, 8],
    yawDegrees: 8,
    opacity: 0.33,
    tint: '#d9e9f3',
    lobes: [
      { offset: [-10, -0.2, 0], scale: [15, 2.2, 6.5] },
      { offset: [2, 0.7, 0.5], scale: [19, 3.5, 9] },
      { offset: [15, -0.3, -0.5], scale: [11.5, 2, 5.7] },
    ],
  },
] as const

const backgroundVertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);
    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clipPosition.xyww;
  }
`

const backgroundFragmentShader = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uDarkDiagnostic;
  varying vec3 vDirection;

  float directionalWisp(vec3 direction, vec3 axis, float frequency, float threshold) {
    float signal = sin(dot(direction, axis) * frequency);
    signal += 0.55 * sin(dot(direction, axis.zxy) * frequency * 1.73 + 1.1);
    signal += 0.28 * sin(dot(direction, axis.yzx) * frequency * 3.11 - 0.7);
    return smoothstep(threshold, threshold + 0.34, signal);
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    float zenith = smoothstep(0.22, 0.96, height);
    vec3 horizonColour = vec3(0.72, 0.86, 0.94);
    vec3 upperColour = vec3(0.13, 0.43, 0.68);
    vec3 skyColour = mix(horizonColour, upperColour, zenith);
    float horizonGlow = 1.0 - smoothstep(0.0, 0.22, abs(direction.y));
    skyColour += vec3(0.08, 0.075, 0.055) * horizonGlow;

    float wispBand = smoothstep(-0.06, 0.08, direction.y) *
      (1.0 - smoothstep(0.34, 0.56, direction.y));
    float wisps = directionalWisp(
      direction,
      normalize(vec3(0.83, 0.17, -0.53)),
      13.0,
      1.25
    );
    wisps *= directionalWisp(
      direction,
      normalize(vec3(-0.22, 0.11, 0.97)),
      7.0,
      0.74
    );
    wisps *= wispBand * 0.34;
    skyColour = mix(skyColour, vec3(0.91, 0.95, 0.97), wisps);

    float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
    float sunHalo = pow(sunDot, 180.0) * 0.24;
    float sunDisc = smoothstep(0.99955, 0.99986, sunDot);
    skyColour += vec3(1.0, 0.77, 0.46) * sunHalo;
    skyColour = mix(skyColour, vec3(1.0, 0.94, 0.75), sunDisc * 0.86);

    vec3 diagnosticColour = mix(
      vec3(0.018, 0.028, 0.052),
      vec3(0.075, 0.105, 0.14),
      height
    );
    gl_FragColor = vec4(mix(skyColour, diagnosticColour, uDarkDiagnostic), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const seaVertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  float waveHeight(vec2 point, float time) {
    return sin(point.x * 0.055 + time * 0.22) * 0.32 +
      sin(point.y * 0.041 - time * 0.17 + 1.7) * 0.24 +
      sin((point.x + point.y) * 0.021 + time * 0.11) * 0.18;
  }

  void main() {
    vec3 transformed = position;
    vWave = waveHeight(position.xy, uTime);
    transformed.z += vWave;
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const seaFragmentShader = /* glsl */ `
  uniform vec3 uCameraPosition;
  uniform vec3 uSunDirection;
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying float vWave;

  void main() {
    vec2 point = vWorldPosition.xz;
    vec3 normal = normalize(vec3(
      -0.022 * cos(point.x * 0.055 + uTime * 0.22) -
        0.011 * cos((point.x + point.y) * 0.021 + uTime * 0.11),
      1.0,
      -0.010 * cos(point.y * 0.041 - uTime * 0.17 + 1.7) -
        0.011 * cos((point.x + point.y) * 0.021 + uTime * 0.11)
    ));
    vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
    vec3 deepWater = vec3(0.025, 0.23, 0.34);
    vec3 openWater = vec3(0.075, 0.39, 0.53);
    vec3 colour = mix(openWater, deepWater, fresnel * 0.72);
    colour += vWave * vec3(0.012, 0.025, 0.028);
    vec3 reflectedSun = reflect(-normalize(uSunDirection), normal);
    float glint = pow(max(dot(reflectedSun, viewDirection), 0.0), 92.0);
    colour += vec3(1.0, 0.83, 0.57) * glint * 0.88;
    float distanceHaze = smoothstep(120.0, 310.0, length(vWorldPosition.xz));
    colour = mix(colour, vec3(0.43, 0.65, 0.72), distanceHaze * 0.55);
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const cloudVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;

  void main() {
    vLocalPosition = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const cloudFragmentShader = /* glsl */ `
  uniform vec3 uCloudColour;
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  uniform float uOverdrawDiagnostic;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = clamp(dot(normalize(vWorldNormal), viewDirection), 0.0, 1.0);
    float softEdge = smoothstep(0.035, 0.48, facing);
    float structure = 0.88 + 0.12 * sin(
      vLocalPosition.x * 0.72 +
      vLocalPosition.y * 1.11 -
      vLocalPosition.z * 0.57
    );
    float alpha = clamp(uOpacity * softEdge * structure, 0.0, 0.78);
    vec3 normal = normalize(vWorldNormal);
    float sunLight = 0.58 + 0.42 * max(dot(normal, normalize(uSunDirection)), 0.0);
    float underside = smoothstep(-0.55, 0.45, normal.y);
    vec3 shadedColour = uCloudColour * sunLight * mix(0.7, 1.04, underside);
    vec3 outputColour = mix(
      shadedColour,
      vec3(1.0, 0.18, 0.02),
      uOverdrawDiagnostic
    );
    alpha = mix(alpha, 0.22, uOverdrawDiagnostic);
    gl_FragColor = vec4(outputColour, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`

function createBackgroundLayer(): {
  readonly group: Group
  readonly material: ShaderMaterial
  readonly sky: Mesh
} {
  const group = new Group()
  group.name = 'sky-background-atmosphere'
  const material = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: backgroundFragmentShader,
    side: BackSide,
    toneMapped: true,
    uniforms: {
      uDarkDiagnostic: { value: 0 },
      uSunDirection: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: backgroundVertexShader,
  })
  const sky = new Mesh(
    new SphereGeometry(BACKGROUND_RADIUS_METERS, 64, 32),
    material,
  )
  sky.name = 'seam-safe-analytic-sky-background'
  sky.frustumCulled = false
  sky.renderOrder = -1_000
  group.add(sky)

  const hemisphere = new HemisphereLight('#cae8f7', '#315766', 1.35)
  hemisphere.name = 'sky-candidate-hemisphere'
  const sun = new DirectionalLight('#ffe5b8', 2.08)
  sun.name = 'sky-candidate-world-sun'
  sun.position.copy(SUN_DIRECTION).multiplyScalar(95)
  sun.target.position.set(0, 4.8, 0)
  sun.castShadow = false
  group.add(hemisphere, sun, sun.target)
  return { group, material, sky }
}

function createCoastGeometry(): BufferGeometry {
  const segments = 42
  const vertices: number[] = []
  const indices: number[] = []
  for (let index = 0; index <= segments; index += 1) {
    const fraction = index / segments
    const angle = Math.PI + fraction * (Math.PI / 2)
    const irregularity =
      Math.sin(index * 1.73) * 2.1 + Math.sin(index * 0.47 + 0.8) * 3.4
    const innerRadius = 161 + irregularity
    const width = 7.5 + Math.sin(index * 0.81 + 0.3) * 2.2
    for (const radius of [innerRadius, innerRadius + width]) {
      vertices.push(
        Math.cos(angle) * radius,
        SKY_REFERENCE_Y_METERS + 0.62 + Math.sin(index * 0.58) * 0.22,
        Math.sin(angle) * radius,
      )
    }
    if (index < segments) {
      const base = index * 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createFlightLayer(): {
  readonly group: Group
  readonly seaMaterial: ShaderMaterial
} {
  const group = new Group()
  group.name = 'sky-flight-volume-and-sea'
  const seaMaterial = new ShaderMaterial({
    depthTest: true,
    depthWrite: true,
    fragmentShader: seaFragmentShader,
    side: DoubleSide,
    toneMapped: true,
    uniforms: {
      uCameraPosition: { value: new Vector3() },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
    },
    vertexShader: seaVertexShader,
  })
  const sea = new Mesh(new PlaneGeometry(520, 520, 96, 96), seaMaterial)
  sea.name = 'world-space-open-sea'
  sea.position.y = SKY_REFERENCE_Y_METERS
  sea.rotation.x = -Math.PI / 2
  sea.receiveShadow = false
  group.add(sea)

  const coastMaterial = new MeshStandardMaterial({
    color: '#8a9270',
    metalness: 0,
    roughness: 0.93,
    side: DoubleSide,
  })
  const coast = new Mesh(createCoastGeometry(), coastMaterial)
  coast.name = 'distant-directional-coast-proxy'
  coast.castShadow = false
  coast.receiveShadow = false
  group.add(coast)

  const waterline = new LineSegments(
    new EdgesGeometry(coast.geometry, 18),
    new LineBasicMaterial({
      color: '#dce9df',
      opacity: 0.32,
      transparent: true,
    }),
  )
  waterline.name = 'distant-coast-waterline'
  waterline.position.y = 0.04
  coast.add(waterline)
  return { group, seaMaterial }
}

function cloudGeometry(spec: CloudClusterSpec): BufferGeometry {
  const minimum = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  )
  const maximum = new Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  )
  for (const lobe of spec.lobes) {
    const offset = new Vector3(...lobe.offset)
    const scale = new Vector3(...lobe.scale)
    minimum.min(offset.clone().sub(scale))
    maximum.max(offset.clone().add(scale))
  }
  const centre = minimum.clone().add(maximum).multiplyScalar(0.5)
  const halfSize = maximum.clone().sub(minimum).multiplyScalar(0.5)
  const geometry = new SphereGeometry(1, 36, 20)
  const position = geometry.getAttribute('position') as BufferAttribute
  const unit = new Vector3()
  const shapePhase = spec.id.length * 0.37
  for (let index = 0; index < position.count; index += 1) {
    unit.set(position.getX(index), position.getY(index), position.getZ(index))
    const azimuth = Math.atan2(unit.z, unit.x)
    const equator = 1 - Math.abs(unit.y)
    const horizontalRipple =
      1 +
      equator *
        (0.075 * Math.sin(azimuth * 3 + shapePhase) +
          0.035 * Math.sin(azimuth * 7 - shapePhase * 0.7))
    const verticalRipple =
      1 + 0.045 * Math.sin(azimuth * 4 + unit.y * 2.5 + shapePhase)
    position.setXYZ(
      index,
      centre.x + unit.x * halfSize.x * horizontalRipple,
      centre.y + unit.y * halfSize.y * verticalRipple,
      centre.z + unit.z * halfSize.z * horizontalRipple,
    )
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createCloudEntry(spec: CloudClusterSpec): CloudEntry {
  const material = new ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fragmentShader: cloudFragmentShader,
    premultipliedAlpha: true,
    side: FrontSide,
    toneMapped: true,
    transparent: true,
    uniforms: {
      uCloudColour: { value: new Color(spec.tint) },
      uOpacity: { value: spec.opacity },
      uOverdrawDiagnostic: { value: 0 },
      uSunDirection: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: cloudVertexShader,
  })
  const object = new Mesh(cloudGeometry(spec), material)
  object.name = spec.id
  object.position.set(...spec.position)
  object.rotation.y = (spec.yawDegrees * Math.PI) / 180
  object.scale.setScalar(CLOUD_LAYER_SCALE[spec.layer])
  object.castShadow = false
  object.receiveShadow = false
  return { id: spec.id, layer: spec.layer, material, object }
}

function createCloudLayers(): {
  readonly entries: readonly CloudEntry[]
  readonly far: Group
  readonly mid: Group
  readonly near: Group
} {
  const near = new Group()
  const mid = new Group()
  const far = new Group()
  near.name = 'sky-near-air'
  mid.name = 'sky-mid-cloud'
  far.name = 'sky-far-cloud'
  const groups: Record<CloudLayer, Group> = {
    'near-air': near,
    'mid-cloud': mid,
    'far-cloud': far,
  }
  const entries = CLOUD_CLUSTERS.map((spec) => createCloudEntry(spec))
  entries.forEach((entry) => groups[entry.layer].add(entry.object))

  const horizonHaze = new Mesh(
    new CylinderGeometry(205, 205, 58, 64, 1, true),
    new MeshBasicMaterial({
      color: '#bed6df',
      depthWrite: false,
      opacity: 0.105,
      side: BackSide,
      transparent: true,
    }),
  )
  horizonHaze.name = 'necessary-horizon-atmosphere-depth'
  horizonHaze.position.y = SKY_REFERENCE_Y_METERS + 29
  horizonHaze.renderOrder = 80
  far.add(horizonHaze)
  return { entries, far, mid, near }
}

function createBandHelper(
  minimumAltitudeMeters: number,
  maximumAltitudeMeters: number,
  colour: string,
): Group {
  const group = new Group()
  const minimumY = SKY_REFERENCE_Y_METERS + minimumAltitudeMeters
  const maximumY = SKY_REFERENCE_Y_METERS + maximumAltitudeMeters
  const bounds = new Box3(
    new Vector3(-118, minimumY, -118),
    new Vector3(118, maximumY, 118),
  )
  const helper = new Box3Helper(bounds, colour)
  const helperMaterials = Array.isArray(helper.material)
    ? helper.material
    : [helper.material]
  for (const material of helperMaterials) {
    material.transparent = true
    material.opacity = 0.5
  }
  group.add(helper)
  return group
}

function createFlightVolumeDebug(): Group {
  const group = new Group()
  group.name = 'sky-review-flight-volume-debug'
  const colours = {
    'subject-flight': '#ffbf4a',
    'near-air': '#ff7a59',
    'mid-cloud': '#7dd3fc',
    'far-cloud': '#60a5fa',
  } as const
  for (const band of SKY_HEIGHT_BANDS) {
    const helper = createBandHelper(
      band.minimumAltitudeMeters,
      band.maximumAltitudeMeters,
      colours[band.id],
    )
    helper.name = `height-band-${band.id}`
    group.add(helper)
  }
  group.visible = false
  return group
}

function materialList(root: Group, visibleOnly: boolean): Material[] {
  const materials: Material[] = []
  root.traverseVisible((object) => {
    if (visibleOnly && !object.visible) return
    if (!(object instanceof Mesh) && !(object instanceof LineSegments)) return
    if (Array.isArray(object.material)) materials.push(...object.material)
    else materials.push(object.material)
  })
  return [...new Set(materials)]
}

function geometryList(root: Group): BufferGeometry[] {
  const geometries: BufferGeometry[] = []
  root.traverseVisible((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.push(object.geometry)
    }
  })
  return geometries
}

function isTransparentMaterial(material: Material): boolean {
  return material.transparent === true && material.opacity > 0
}

function disposeMaterial(material: Material): void {
  material.dispose()
}

function disposeGroup(root: Group): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry)
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => materials.add(material))
      } else {
        materials.add(object.material)
      }
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach(disposeMaterial)
  root.clear()
}

export function createSkyEnvironmentCandidate(
  input: SkyEnvironmentCandidateInput,
): SkyEnvironmentCandidate {
  const root = new Group()
  root.name = 'scale-encounter-sky-review-candidate'
  const background = createBackgroundLayer()
  const flight = createFlightLayer()
  const clouds = createCloudLayers()
  const debug = createFlightVolumeDebug()
  const layerGroups: Readonly<Record<Exclude<SkyLayerId, 'subject'>, Group>> = {
    'background-atmosphere': background.group,
    'flight-volume': flight.group,
    'near-air': clouds.near,
    'mid-cloud': clouds.mid,
    'far-cloud': clouds.far,
  }
  root.add(
    background.group,
    flight.group,
    clouds.near,
    clouds.mid,
    clouds.far,
    debug,
  )

  let variant = input.variant
  let corridorBounds = input.corridorBounds.clone()
  let cameraSweepBounds = input.cameraSweepBounds.clone()
  let diagnosticMode: SkyDiagnosticMode = {}

  const applyLayerVisibility = () => {
    const variantLayers = new Set(skyLayersForVariant(variant))
    const isolation = diagnosticMode.isolateLayers
      ? new Set(diagnosticMode.isolateLayers)
      : null
    for (const [layer, group] of Object.entries(layerGroups) as Array<
      [Exclude<SkyLayerId, 'subject'>, Group]
    >) {
      group.visible =
        variantLayers.has(layer) && (isolation === null || isolation.has(layer))
    }
    debug.visible = diagnosticMode.showFlightVolumes === true
    background.material.uniforms.uDarkDiagnostic!.value =
      diagnosticMode.backgroundTone === 'dark' ? 1 : 0
    for (const cloud of clouds.entries) {
      cloud.material.uniforms.uOverdrawDiagnostic!.value =
        diagnosticMode.showOverdraw === true ? 1 : 0
    }
  }

  applyLayerVisibility()

  return {
    root,
    dispose: () => {
      root.removeFromParent()
      disposeGroup(root)
    },
    getDiagnostics: (
      camera,
      cameraState,
      subjectBounds,
      avatarBounds,
    ) => {
      root.updateMatrixWorld(true)
      const activeClouds = clouds.entries.filter(
        (entry) => entry.object.visible && entry.object.parent?.visible,
      )
      const avatarOcclusionEvaluated =
        cameraState.stage !== 'eye-entry' && cameraState.stage !== 'pov'
      const cloudDiagnostics = inspectSkyClouds(
        activeClouds,
        corridorBounds,
        subjectBounds,
        camera,
        cameraState.viewportWidth,
        cameraState.viewportHeight,
        avatarOcclusionEvaluated ? [avatarBounds] : [],
      )
      const projectedClouds = activeClouds.map((entry) =>
        projectWorldBounds(
          worldBoundsFor(entry.object),
          camera,
          cameraState.viewportWidth,
          cameraState.viewportHeight,
        ),
      )
      const materials = materialList(root, true)
      const transparentMaterials = materials.filter(isTransparentMaterial)
      const resourceEstimate = estimateGeometryResources(geometryList(root))
      return {
        alpha: {
          alphaMode:
            activeClouds.length > 0 ? 'premultiplied-blend' : 'opaque',
          alphaTextureCount: 0,
          cloudMaterialsPremultiplied: clouds.entries.every(
            (entry) => entry.material.premultipliedAlpha,
          ),
          cloudMaterialsUseMipmaps: false,
          cloudMaterialsDepthWriteDisabled: clouds.entries.every(
            (entry) => entry.material.depthWrite === false,
          ),
          edgeRgbPolicy:
            'Analytic cloud RGB is authored in-shader before alpha; no cutout texture or transparent-pixel matte exists.',
        },
        assetLease: input.assetLease,
        avatarOcclusionEvaluated,
        avatarBounds: serializeBox3(avatarBounds),
        camera: {
          aspect: cameraState.aspect,
          far: cameraState.far,
          fieldOfViewDegrees: cameraState.fieldOfViewDegrees,
          near: cameraState.near,
          position: serializeVector3(cameraState.position),
          stage: cameraState.stage,
          target: serializeVector3(cameraState.target),
        },
        cameraSweepBounds: serializeBox3(cameraSweepBounds),
        cloudCount: activeClouds.length,
        cloudDiagnostics,
        corridorBounds: serializeBox3(corridorBounds),
        corridorOverlapCount: cloudDiagnostics.filter(
          (diagnostic) => diagnostic.corridorOverlap,
        ).length,
        heightBands: SKY_HEIGHT_BANDS,
        layerStates: [
          { id: 'subject', visible: true },
          ...(
            Object.entries(layerGroups) as Array<
              [Exclude<SkyLayerId, 'subject'>, Group]
            >
          ).map(([id, group]) => ({ id, visible: group.visible })),
        ],
        referenceY: SKY_REFERENCE_Y_METERS,
        rendererCapabilities: input.rendererCapabilities,
        resources: {
          ...resourceEstimate,
          activeMaterialCount: materials.length,
          proceduralTextureBytes: 0,
          transparentDrawEstimate: transparentMaterials.length,
        },
        sceneContractRevision: SKY_SCENE_CONTRACT_REVISION,
        subjectBounds: serializeBox3(subjectBounds),
        subjectOcclusionMaximumFraction: Math.max(
          0,
          ...cloudDiagnostics.map(
            (diagnostic) => diagnostic.subjectOcclusionFraction,
          ),
        ),
        transparentOverdraw: estimateTransparentOverdraw(
          projectedClouds,
          cameraState.viewportWidth,
          cameraState.viewportHeight,
        ),
        variant,
      }
    },
    setCorridorBounds: (nextCorridorBounds, nextCameraSweepBounds) => {
      corridorBounds = nextCorridorBounds.clone()
      cameraSweepBounds = nextCameraSweepBounds.clone()
    },
    setDiagnosticMode: (mode) => {
      diagnosticMode = { ...diagnosticMode, ...mode }
      applyLayerVisibility()
    },
    setVariant: (nextVariant) => {
      variant = nextVariant
      applyLayerVisibility()
    },
    update: (elapsedSeconds, reducedMotion, camera) => {
      background.sky.position.copy(camera.position)
      const time = reducedMotion ? 0 : elapsedSeconds
      flight.seaMaterial.uniforms.uTime!.value = time
      flight.seaMaterial.uniforms.uCameraPosition!.value.copy(camera.position)
    },
  }
}

export const SKY_CANDIDATE_ART_DIRECTION = {
  coast:
    'A non-specific, review-only quarter-arc coastline proxy. It makes no palaeoenvironment or locality claim.',
  seaLevelY: SKY_REFERENCE_Y_METERS,
  sunDirection: SUN_DIRECTION.toArray() as [number, number, number],
  sunDirectionStatus: 'candidate-pending-leon-confirmation',
} as const

export function inspectSkyCandidateAltitudeContract(
  candidate: SkyEnvironmentCandidate,
  camera: PerspectiveCamera,
  cameraState: SkyCameraState,
  subjectBounds: Readonly<Box3>,
  avatarBounds: Readonly<Box3>,
): {
  readonly avatar: ReturnType<typeof boundsAltitudeRange>
  readonly environment: SkyEnvironmentDiagnostics
  readonly subject: ReturnType<typeof boundsAltitudeRange>
} {
  return {
    avatar: boundsAltitudeRange(avatarBounds),
    environment: candidate.getDiagnostics(
      camera,
      cameraState,
      subjectBounds,
      avatarBounds,
    ),
    subject: boundsAltitudeRange(subjectBounds),
  }
}
