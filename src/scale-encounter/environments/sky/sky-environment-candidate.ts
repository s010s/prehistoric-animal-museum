import {
  BackSide,
  Box3,
  Box3Helper,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DataUtils,
  DirectionalLight,
  DoubleSide,
  Group,
  HalfFloatType,
  HemisphereLight,
  LinearFilter,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  TextureLoader,
  SRGBColorSpace,
  type Texture,
  type Camera,
  type LineBasicMaterial,
  type Material,
  type Object3D,
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
import { createSkyCoast } from './sky-coast'

export interface SkyEnvironmentCandidateInput {
  readonly assetLease: SkyAssetLeaseIdentity
  readonly coastTemplate?: Object3D | null
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
  readonly cloudMaterialsUseMipmaps: true
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
    readonly proceduralTextureBytes: number
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
  readonly radianceTexture: DataTexture
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

interface CloudClusterSpec {
  readonly id: string
  readonly layer: CloudLayer
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number]
  readonly rect: readonly [number, number, number, number]
  readonly atlasPart: number
  readonly opacity: number
}

interface CloudEntry extends SkyCloudDiagnosticInput {
  readonly material: ShaderMaterial
}

const SUN_DIRECTION = new Vector3(-0.42, 0.78, -0.46).normalize()
const BACKGROUND_RADIUS_METERS = 850

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalised = clamp01((value - edge0) / (edge1 - edge0))
  return normalised * normalised * (3 - 2 * normalised)
}

function mixNumber(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

/**
 * D preserves the accepted C composition, but bakes the static atmospheric
 * radiance once so the visible sky, sea reflection and subject PMREM can all
 * sample one tone-mapping-free linear HDR source.
 */
function createSkyRadianceLut(): DataTexture {
  const width = 512
  const height = 256
  const data = new Uint16Array(width * height * 4)
  const direction = new Vector3()
  const horizon = [0.56, 0.76, 0.84] as const
  const upper = [0.075, 0.3, 0.55] as const
  const sun = [1.0, 0.77, 0.48] as const

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    const elevationAngle = (v - 0.5) * Math.PI
    const directionY = Math.sin(elevationAngle)
    const horizontalLength = Math.cos(elevationAngle)
    const heightMix = clamp01(directionY * 0.5 + 0.5)
    const zenith = smoothstep(0.22, 0.96, heightMix)
    const horizonGlow = 1 - smoothstep(0, 0.22, Math.abs(directionY))

    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const azimuth = (u - 0.5) * Math.PI * 2
      direction.set(
        Math.cos(azimuth) * horizontalLength,
        directionY,
        Math.sin(azimuth) * horizontalLength,
      )
      const colour: [number, number, number] = [
        mixNumber(horizon[0], upper[0], zenith) + 0.055 * horizonGlow,
        mixNumber(horizon[1], upper[1], zenith) + 0.042 * horizonGlow,
        mixNumber(horizon[2], upper[2], zenith) + 0.025 * horizonGlow,
      ]

      // Visible clouds stay in the accepted C geometry layers. Baking their
      // old direction-space field into an equirectangular LUT produced tall,
      // curtain-like streaks because nearby elevation rows shared almost the
      // same horizontal sample. The LUT now carries lighting only.

      const sunDot = Math.max(0, direction.dot(SUN_DIRECTION))
      // The overview camera keeps the sun just outside the right edge of the
      // frame. Any broad halo therefore projects as a tall pale curtain and
      // reads like a vertically stretched cloud. Direct lighting already owns
      // the solar key, so the radiance map keeps only a tiny visible disc.
      const sunHalo = 0
      const sunDisc = smoothstep(0.99994, 0.999985, sunDot) * 0.42
      const sunAmount = sunHalo + sunDisc
      const offset = (y * width + x) * 4
      data[offset] = DataUtils.toHalfFloat(colour[0] + sun[0] * sunAmount)
      data[offset + 1] = DataUtils.toHalfFloat(
        colour[1] + sun[1] * sunAmount,
      )
      data[offset + 2] = DataUtils.toHalfFloat(
        colour[2] + sun[2] * sunAmount,
      )
      data[offset + 3] = DataUtils.toHalfFloat(1)
    }
  }

  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    HalfFloatType,
  )
  texture.name = 'sky-coherent-radiance-linear-hdr-v3'
  texture.colorSpace = LinearSRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

// Four different photographic cloud silhouettes, placed individually in space.
const CLOUD_CLUSTERS: readonly CloudClusterSpec[] = [
  { id: 'cloud-bank-west', layer: 'mid-cloud', position: [-45, -22, -56], size: [43, 23], rect: [0, .5, .64, .5], atlasPart: 0, opacity: .58 },
  { id: 'cloud-wisp-east', layer: 'near-air', position: [62, 19, -108], size: [28, 24], rect: [.64, .5, .36, .5], atlasPart: 1, opacity: .48 },
  { id: 'cloud-billow-north', layer: 'far-cloud', position: [-108, -30, 100], size: [58, 48], rect: [0, 0, .60, .5], atlasPart: 2, opacity: .66 },
  { id: 'cloud-ribbon-east', layer: 'mid-cloud', position: [86, -26, 37], size: [52, 42], rect: [.5, 0, .5, .5], atlasPart: 3, opacity: .4 },
]

const backgroundVertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);
    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clipPosition.xyww;
  }
`

const backgroundFragmentShader = /* glsl */ `
  uniform sampler2D uSkyRadiance;
  uniform vec3 uSunDirection;
  uniform float uDarkDiagnostic;
  uniform float uUseSkyRadiance;
  varying vec3 vDirection;

  vec2 skyDirectionToEquirectUv(vec3 direction) {
    direction = normalize(direction);
    return vec2(
      atan(direction.z, direction.x) * 0.15915494309189535 + 0.5,
      asin(clamp(direction.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5
    );
  }

  float hash31(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.yzx + 33.33);
    return fract((point.x + point.y) * point.z);
  }

  float valueNoise(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));
    float lower = mix(mix(n000, n100, local.x), mix(n010, n110, local.x), local.y);
    float upper = mix(mix(n001, n101, local.x), mix(n011, n111, local.x), local.y);
    return mix(lower, upper, local.z);
  }

  float fBm(vec3 point) {
    float value = 0.0;
    float amplitude = 0.56;
    mat3 rotation = mat3(
      0.00, 0.80, 0.60,
      -0.80, 0.36, -0.48,
      -0.60, -0.48, 0.64
    );
    for (int octave = 0; octave < 4; octave += 1) {
      value += valueNoise(point) * amplitude;
      point = rotation * point * 2.03 + vec3(7.3, 2.1, 4.7);
      amplitude *= 0.49;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    if (uUseSkyRadiance > 0.5) {
      vec3 cachedSky = texture2D(
        uSkyRadiance,
        skyDirectionToEquirectUv(direction)
      ).rgb;
      // Keep the accepted C cloud coverage in D, but evaluate it directly
      // from the view direction. Baking this field into the equirectangular
      // radiance LUT created vertically stretched streaks on mobile GPUs.
      vec3 cloudSample = direction * vec3(4.2, 9.5, 4.2) + vec3(1.7, 4.1, -2.8);
      float cloudField = fBm(cloudSample);
      float cloudDetail = fBm(cloudSample * 1.83 + vec3(-3.0, 5.0, 1.0));
      float cloudMask = smoothstep(0.52, 0.69, cloudField * 0.72 + cloudDetail * 0.28);
      float cloudBand = smoothstep(0.02, 0.14, direction.y) *
        (1.0 - smoothstep(0.46, 0.72, direction.y));
      float backgroundCloud = 0.0;
      cachedSky = mix(cachedSky, vec3(0.88, 0.94, 0.965), backgroundCloud);
      // Evaluate the small solar aureole analytically in direction space.
      // This stays round at any resolution instead of stretching a LUT texel.
      float solarDot = max(dot(direction, normalize(uSunDirection)), 0.0);
      cachedSky += vec3(1.0, .83, .58) * pow(solarDot, 220.0) * .11;
      cachedSky = mix(cachedSky, vec3(1.0, .97, .85), smoothstep(.99980, .99996, solarDot) * .78);
      float cachedHeight = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 diagnosticColour = mix(
        vec3(0.018, 0.028, 0.052),
        vec3(0.075, 0.105, 0.14),
        cachedHeight
      );
      gl_FragColor = vec4(
        mix(cachedSky, diagnosticColour, uDarkDiagnostic),
        1.0
      );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    float zenith = smoothstep(0.22, 0.96, height);
    vec3 horizonColour = vec3(0.56, 0.76, 0.84);
    vec3 upperColour = vec3(0.075, 0.30, 0.55);
    vec3 skyColour = mix(horizonColour, upperColour, zenith);
    float horizonGlow = 1.0 - smoothstep(0.0, 0.22, abs(direction.y));
    skyColour += vec3(0.055, 0.042, 0.025) * horizonGlow;

    vec3 cloudSample = direction * vec3(4.2, 9.5, 4.2) + vec3(1.7, 4.1, -2.8);
    float cloudField = fBm(cloudSample);
    float cloudDetail = fBm(cloudSample * 1.83 + vec3(-3.0, 5.0, 1.0));
    float cloudMask = smoothstep(0.52, 0.69, cloudField * 0.72 + cloudDetail * 0.28);
    float cloudBand = smoothstep(0.02, 0.14, direction.y) *
      (1.0 - smoothstep(0.46, 0.72, direction.y));
    float backgroundCloud = 0.0;
    skyColour = mix(skyColour, vec3(0.88, 0.94, 0.965), backgroundCloud);

    float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
    float sunHalo = pow(sunDot, 90.0) * 0.15;
    float sunDisc = smoothstep(0.99955, 0.99986, sunDot);
    skyColour += vec3(1.0, 0.77, 0.48) * sunHalo;
    skyColour = mix(skyColour, vec3(1.0, 0.94, 0.76), sunDisc * 0.68);

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
  uniform vec3 uCameraPosition;
  varying vec3 vWorldPosition;
  varying float vWave;

  float waveHeight(vec2 point, float time) {
    return sin(point.x * 0.055 + time * 0.22) * 0.32 +
      sin(point.y * 0.041 - time * 0.17 + 1.7) * 0.24 +
      sin((point.x + point.y) * 0.021 + time * 0.11) * 0.18;
  }

  void main() {
    vec3 transformed = position;
    vec4 flatWorldPosition = modelMatrix * vec4(position, 1.0);
    float horizontalDistance = length(
      flatWorldPosition.xz - uCameraPosition.xz
    );
    // The old moving outer edge met the 240 m far plane as a visibly
    // piecewise-linear skyline. Flatten the swell before it reaches the
    // atmospheric horizon; foreground water keeps all of its movement.
    float scaleEncounterHorizonWaveFade = 1.0 - smoothstep(
      145.0,
      215.0,
      horizontalDistance
    );
    vWave = waveHeight(position.xy, uTime) * scaleEncounterHorizonWaveFade;
    // At aerial scale the visible swell belongs in normals. A fixed sea
    // elevation keeps the shallow beaches stable instead of submerging them.
    // No moving geometry crosses the island's alpha-tested shoreline.
    transformed.z += 0.0;
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const seaFragmentShader = /* glsl */ `
  uniform vec3 uCameraPosition;
  uniform sampler2D uSkyRadiance;
  uniform vec3 uSunDirection;
  uniform float uTime;
  uniform float uUseSkyRadiance;
  varying vec3 vWorldPosition;
  varying float vWave;

  vec2 seaDirectionToEquirectUv(vec3 direction) {
    direction = normalize(direction);
    return vec2(
      atan(direction.z, direction.x) * 0.15915494309189535 + 0.5,
      asin(clamp(direction.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5
    );
  }

  vec3 skyColourBehindSea(vec3 direction) {
    direction = normalize(direction);
    if (uUseSkyRadiance > 0.5) {
      return texture2D(
        uSkyRadiance,
        seaDirectionToEquirectUv(direction)
      ).rgb;
    }
    float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    float zenith = smoothstep(0.22, 0.96, height);
    vec3 horizonColour = vec3(0.56, 0.76, 0.84);
    vec3 upperColour = vec3(0.075, 0.30, 0.55);
    vec3 colour = mix(horizonColour, upperColour, zenith);
    float horizonGlow = 1.0 - smoothstep(0.0, 0.22, abs(direction.y));
    colour += vec3(0.055, 0.042, 0.025) * horizonGlow;
    float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
    float sunHalo = pow(sunDot, 90.0) * 0.15;
    float sunDisc = smoothstep(0.99955, 0.99986, sunDot);
    colour += vec3(1.0, 0.77, 0.48) * sunHalo;
    return mix(colour, vec3(1.0, 0.94, 0.76), sunDisc * 0.68);
  }

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
    vec3 deepWater = vec3(0.018, 0.16, 0.25);
    vec3 openWater = vec3(0.038, 0.28, 0.41);
    vec3 skyReflection = vec3(0.31, 0.57, 0.69);
    if (uUseSkyRadiance > 0.5) {
      vec3 reflectedDirection = reflect(-viewDirection, normal);
      skyReflection = texture2D(
        uSkyRadiance,
        seaDirectionToEquirectUv(reflectedDirection)
      ).rgb;
    }
    // Keep enough blue-green body colour beneath the reflected sky for the
    // sea to read as a plane rather than a continuation of the atmosphere.
    vec3 colour = mix(openWater, skyReflection, fresnel * 0.58);
    colour = mix(colour, deepWater, smoothstep(-0.55, 0.3, vWave) * 0.12);
    float longSwell = 0.5 + 0.5 * sin(
      point.x * 0.072 + point.y * 0.026 + uTime * 0.24 +
      sin(point.y * 0.019 - uTime * 0.09) * 1.35
    );
    float crossSwell = 0.5 + 0.5 * sin(
      point.x * -0.031 + point.y * 0.086 - uTime * 0.19
    );
    float softCrest = smoothstep(0.78, 0.98, longSwell * 0.74 + crossSwell * 0.26);
    colour += vec3(0.10, 0.17, 0.19) * softCrest * (0.16 + fresnel * 0.2);
    vec3 reflectedSun = reflect(-normalize(uSunDirection), normal);
    float glint = pow(max(dot(reflectedSun, viewDirection), 0.0), 92.0);
    colour += vec3(1.0, 0.84, 0.59) * glint * 0.76;
    float cameraDistance = length(vWorldPosition.xz - uCameraPosition.xz);
    float distanceHaze = smoothstep(240.0, 700.0, cameraDistance);
    colour = mix(colour, vec3(0.37, 0.61, 0.71), distanceHaze * 0.48);
    // A broad, low-contrast teal band preserves an unmistakable sea level in
    // high overview angles. It fades again before the finite surface reaches
    // the far clip, so it cannot turn into a hard polygonal skyline.
    float scaleEncounterSeaLevelDefinition =
      smoothstep(340.0, 560.0, cameraDistance) *
      (1.0 - smoothstep(620.0, 780.0, cameraDistance));
    colour = mix(
      colour,
      vec3(0.16, 0.40, 0.52),
      scaleEncounterSeaLevelDefinition * 0.24
    );
    // Match the exact background colour only in the final few metres before
    // the far clip. Most of the distant water therefore retains its identity.
    float scaleEncounterSeamlessHorizon = smoothstep(
      680.0,
      820.0,
      cameraDistance
    );
    vec3 backgroundDirection = normalize(vWorldPosition - uCameraPosition);
    colour = mix(
      colour,
      skyColourBehindSea(backgroundDirection),
      scaleEncounterSeamlessHorizon
    );
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const horizonHazeVertexShader = /* glsl */ `
  varying float vScaleEncounterHazeHeight;

  void main() {
    vScaleEncounterHazeHeight = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const horizonHazeFragmentShader = /* glsl */ `
  uniform vec3 uHazeColour;
  varying float vScaleEncounterHazeHeight;

  void main() {
    // Feather both cylinder rims. The previous opaque 64-sided rim was the
    // source of the long straight segments visible across the sea/sky join.
    float lowerFeather = smoothstep(
      0.0,
      0.22,
      vScaleEncounterHazeHeight
    );
    float upperFeather = 1.0 - smoothstep(
      0.52,
      1.0,
      vScaleEncounterHazeHeight
    );
    float alpha = 0.055 * lowerFeather * upperFeather;
    gl_FragColor = vec4(uHazeColour, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const cloudVertexShader = /* glsl */ `
  varying vec2 vCloudUv;
  void main() {
    vCloudUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const cloudFragmentShader = /* glsl */ `
  uniform sampler2D uCloudAtlas;
  uniform vec4 uCloudRect;
  uniform float uAtlasPart;
  uniform float uOpacity;
  uniform float uOverdrawDiagnostic;
  varying vec2 vCloudUv;
  void main() {
    vec2 atlasUv = uCloudRect.xy + vCloudUv * uCloudRect.zw;
    // The two lower silhouettes have a diagonal transparent gutter.
    float gutter = .5 + atlasUv.y * .2;
    if (uAtlasPart > 1.5 && uAtlasPart < 2.5 && atlasUv.x > gutter) discard;
    if (uAtlasPart > 2.5 && atlasUv.x < gutter) discard;
    vec4 cloud = texture2D(uCloudAtlas, atlasUv);
    float alpha = smoothstep(.025, .95, cloud.a) * uOpacity;
    vec3 colour = mix(cloud.rgb, vec3(1.0, .18, .02), uOverdrawDiagnostic);
    gl_FragColor = vec4(colour, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`

function createBackgroundLayer(radianceTexture: DataTexture): {
  readonly flightFill: DirectionalLight
  readonly group: Group
  readonly hemisphere: HemisphereLight
  readonly material: ShaderMaterial
  readonly sky: Mesh
  readonly sun: DirectionalLight
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
      uSkyRadiance: { value: radianceTexture },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uUseSkyRadiance: { value: 0 },
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

  const hemisphere = new HemisphereLight('#d8eff9', '#718e9d', 1.68)
  hemisphere.name = 'sky-candidate-hemisphere'
  const sun = new DirectionalLight('#ffe3b5', 2.12)
  sun.name = 'sky-candidate-world-sun'
  sun.position.copy(SUN_DIRECTION).multiplyScalar(95)
  sun.target.position.set(0, 4.8, 0)
  sun.castShadow = false
  // The authored sun remains visible ahead of the family, so its key light
  // naturally falls behind the subjects during the child-eye view. A broad,
  // cool flight fill from the rear/upper camera hemisphere restores the
  // colours of skin, clothing and wing membranes without flattening the
  // warmer sun-facing side.
  const flightFill = new DirectionalLight('#e3f4ff', 1.85)
  flightFill.name = 'sky-candidate-rear-upper-flight-fill'
  flightFill.position.set(8, 38, 76)
  flightFill.target.position.set(0, 4.8, 0)
  flightFill.castShadow = false
  group.add(
    hemisphere,
    sun,
    sun.target,
    flightFill,
    flightFill.target,
  )
  return { flightFill, group, hemisphere, material, sky, sun }
}

function createFlightLayer(
  radianceTexture: DataTexture,
  coastTemplate?: Object3D | null,
): {
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
      uSkyRadiance: { value: radianceTexture },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
      uUseSkyRadiance: { value: 0 },
    },
    vertexShader: seaVertexShader,
  })
  const sea = new Mesh(new PlaneGeometry(1800, 1800, 128, 128), seaMaterial)
  sea.name = 'world-space-open-sea'
  sea.position.y = SKY_REFERENCE_Y_METERS
  sea.rotation.x = -Math.PI / 2
  sea.receiveShadow = false
  group.add(sea, createSkyCoast(coastTemplate))
  return {
    group,
    seaMaterial,
  }
}

function createCloudEntry(spec: CloudClusterSpec, atlas: Texture): CloudEntry {
  const material = new ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fragmentShader: cloudFragmentShader,
    premultipliedAlpha: true,
    side: DoubleSide,
    toneMapped: true,
    transparent: true,
    uniforms: {
      uCloudAtlas: { value: atlas },
      uCloudRect: { value: new Vector4(...spec.rect) },
      uAtlasPart: { value: spec.atlasPart },
      uOpacity: { value: spec.opacity },
      uOverdrawDiagnostic: { value: 0 },
    },
    vertexShader: cloudVertexShader,
  })
  const object = new Mesh(new PlaneGeometry(...spec.size), material)
  object.name = spec.id
  object.position.set(...spec.position)
  return { id: spec.id, layer: spec.layer, material, object }
}

function createCloudLayers(): {
  readonly entries: readonly CloudEntry[]
  readonly atlas: Texture
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
  const atlas = new TextureLoader().load(new URL(
    '../../assets/environments/clouds-unique-v2.webp', import.meta.url,
  ).href)
  atlas.colorSpace = SRGBColorSpace
  const entries = CLOUD_CLUSTERS.map((spec) => createCloudEntry(spec, atlas))
  entries.forEach((entry) => groups[entry.layer].add(entry.object))

  const horizonHaze = new Mesh(
    new CylinderGeometry(205, 205, 58, 192, 1, true),
    new ShaderMaterial({
      depthWrite: false,
      fragmentShader: horizonHazeFragmentShader,
      side: BackSide,
      toneMapped: true,
      transparent: true,
      uniforms: {
        uHazeColour: { value: new Color('#bed6df') },
      },
      vertexShader: horizonHazeVertexShader,
    }),
  )
  horizonHaze.name = 'necessary-horizon-atmosphere-depth'
  horizonHaze.position.y = SKY_REFERENCE_Y_METERS + 29
  horizonHaze.renderOrder = 80
  far.add(horizonHaze)
  return { entries, atlas, far, mid, near }
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
  const helperMaterial = helper.material as LineBasicMaterial
  helperMaterial.transparent = true
  helperMaterial.opacity = 0.5
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

interface RenderableResources {
  readonly geometry: BufferGeometry
  readonly material: Material | Material[]
}

function renderableResources(object: Object3D): RenderableResources | null {
  if (!(object instanceof Mesh) && !(object instanceof LineSegments)) {
    return null
  }
  return object
}

function materialList(root: Group, visibleOnly: boolean): Material[] {
  const materials: Material[] = []
  root.traverseVisible((object) => {
    if (visibleOnly && !object.visible) return
    const resources = renderableResources(object)
    if (!resources) return
    if (Array.isArray(resources.material)) {
      materials.push(...resources.material)
    } else {
      materials.push(resources.material)
    }
  })
  return [...new Set(materials)]
}

function geometryList(root: Group): BufferGeometry[] {
  const geometries: BufferGeometry[] = []
  root.traverseVisible((object) => {
    const resources = renderableResources(object)
    if (resources) geometries.push(resources.geometry)
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
    const resources = renderableResources(object)
    if (resources) {
      geometries.add(resources.geometry)
      if (Array.isArray(resources.material)) {
        resources.material.forEach((material) => materials.add(material))
      } else {
        materials.add(resources.material)
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
  const radianceTexture = createSkyRadianceLut()
  const background = createBackgroundLayer(radianceTexture)
  const flight = createFlightLayer(radianceTexture, input.coastTemplate)
  const clouds = createCloudLayers()
  const cloudOrigins = clouds.entries.map((cloud) => cloud.object.position.clone())
  let livingTime = 0
  let previousTime: number | null = null
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
    const coherentRadiance = variant === 'D'
    background.material.uniforms.uUseSkyRadiance!.value =
      coherentRadiance ? 1 : 0
    flight.seaMaterial.uniforms.uUseSkyRadiance!.value =
      coherentRadiance ? 1 : 0
    // PMREM supplies the broad sky fill in D, so the three direct lights can
    // become accents instead of a separate studio-lighting rig.
    background.hemisphere.intensity = coherentRadiance ? 1.02 : 1.68
    background.sun.intensity = coherentRadiance ? 1.96 : 2.12
    background.flightFill.intensity = coherentRadiance ? 1.08 : 1.85
  }

  applyLayerVisibility()

  return {
    radianceTexture,
    root,
    dispose: () => {
      root.removeFromParent()
      disposeGroup(root)
      radianceTexture.dispose()
      clouds.atlas.dispose()
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
          alphaTextureCount: 1,
          cloudMaterialsPremultiplied: clouds.entries.every(
            (entry) => entry.material.premultipliedAlpha,
          ),
          cloudMaterialsUseMipmaps: true,
          cloudMaterialsDepthWriteDisabled: clouds.entries.every(
            (entry) => entry.material.depthWrite === false,
          ),
          edgeRgbPolicy:
            'Four unique generated cloud cutouts use alpha, mipmaps and fixed spatial placements.',
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
          proceduralTextureBytes:
            variant === 'D' ? 512 * 256 * 4 * 2 : 0,
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
      const delta = previousTime === null ? 0 : Math.min(.1, Math.max(0, elapsedSeconds - previousTime))
      previousTime = elapsedSeconds
      if (!reducedMotion) livingTime += delta
      clouds.entries.forEach((cloud, index) => {
        cloud.object.quaternion.copy(camera.quaternion)
        const origin = cloudOrigins[index]!
        cloud.object.position.set(
          origin.x + Math.sin(livingTime * .025) * (3 + index * .6),
          origin.y + Math.sin(livingTime * .016) * .35,
          origin.z + Math.sin(livingTime * .019) * 1.4,
        )
      })
      const time = livingTime
      flight.seaMaterial.uniforms.uTime!.value = time
      const cameraPositionUniform = flight.seaMaterial.uniforms
        .uCameraPosition as { value: Vector3 }
      cameraPositionUniform.value.copy(camera.position)
    },
  }
}

export const SKY_CANDIDATE_ART_DIRECTION = {
  coast:
    'Two independently authored vegetated island landforms provide woodland, beaches and continuous relief below the flight corridor. World positions and waterline remain fixed. These are illustrative coasts, not a reconstruction of a specific Cretaceous locality.',
  seaLevelY: SKY_REFERENCE_Y_METERS,
  sunDirection: SUN_DIRECTION.toArray(),
  sunDirectionStatus: 'owner-approved-2026-08-24',
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
