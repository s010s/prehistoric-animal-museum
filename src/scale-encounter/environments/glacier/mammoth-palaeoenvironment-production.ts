import {
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Material,
  type Object3D,
} from 'three'

import {
  mammothPalaeoenvironmentGroundY,
  type MammothPalaeoenvironmentCandidate,
  type MammothPalaeoenvironmentResourceEstimate,
  type MammothPalaeoenvironmentSurfaceState,
  type MammothPalaeoenvironmentVariant,
} from './mammoth-palaeoenvironment-candidate'
import { MAMMOTH_PALAEOENVIRONMENT_ANCHOR } from './scientific-anchor'
import {
  easternAlpsPanoramaUrl as mammothEasternAlpsPanoramaUrl,
  tundraGroundAlbedoUrl as mammothTundraGroundAlbedoUrl,
  tundraSedgeClumpUrl as mammothTundraSedgeClumpUrl,
} from 'virtual:scale-encounter-glacier-assets'

export const MAMMOTH_PALAEOENVIRONMENT_PRODUCTION_CANDIDATE_ID =
  'mammoth-palaeoenvironment-eastern-alps-production-candidate-v3'

// PROTOTYPE — A preserves the current photographic panorama. B replaces it
// with an analytic sky and three staggered world-space mountain ranges. C
// adds a snow-covered moraine belt, a frozen valley channel, and calibrated
// atmospheric perspective. The existing review route selects the three
// architectures with ?scene-variant=A|B|C.

const GROUND_RADIUS_METERS = 180
const FAR_ICE_MINIMUM = new Vector3(-54, 17, -208)
const FAR_ICE_MAXIMUM = new Vector3(36, 36, -188)
const SUBJECT_CORRIDOR = new Box3(
  new Vector3(-14, -0.2, -4.2),
  new Vector3(7.5, 4.8, 4.2),
)

const SURFACE_STATE = {
  'wind-scoured': {
    coverFraction: 0.22,
    crustCount: 34,
    frostBlend: 0.24,
    patchCount: 50,
  },
  balanced: {
    coverFraction: 0.4,
    crustCount: 66,
    frostBlend: 0.48,
    patchCount: 100,
  },
  'late-snow': {
    coverFraction: 0.49,
    crustCount: 88,
    frostBlend: 0.62,
    patchCount: 132,
  },
} as const satisfies Readonly<
  Record<
    MammothPalaeoenvironmentSurfaceState,
    {
      readonly coverFraction: number
      readonly crustCount: number
      readonly frostBlend: number
      readonly patchCount: number
    }
  >
>

const WORLD_SUN_DIRECTION = new Vector3(-0.48, 0.72, 0.5).normalize()

function smoothstep(edge0: number, edge1: number, value: number): number {
  const denominator = edge1 - edge0
  const t = Math.min(
    1,
    Math.max(0, denominator === 0 ? 0 : (value - edge0) / denominator),
  )
  return t * t * (3 - 2 * t)
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

function pointToCorridorDistance(x: number, z: number): number {
  const startX = -11
  const endX = 5
  const projection = Math.min(1, Math.max(0, (x - startX) / (endX - startX)))
  const closestX = startX + (endX - startX) * projection
  return Math.hypot(x - closestX, z)
}

function periodicSurfaceNoise(u: number, v: number): number {
  return (
    Math.sin(Math.PI * 2 * (u * 3 + v * 2) + 0.7) * 0.24 +
    Math.sin(Math.PI * 2 * (u * 7 - v * 5) + 2.1) * 0.18 +
    Math.cos(Math.PI * 2 * (u * 13 + v * 11) - 0.4) * 0.12 +
    Math.sin(Math.PI * 2 * (u * 29 - v * 17) + 1.6) * 0.07
  )
}

function createSteppeSurfaceTexture(
  kind: 'albedo' | 'roughness',
): DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  const darkSoil = new Color('#877b61')
  const openLoess = new Color('#a49370')
  const drySedge = new Color('#9f986a')
  const colour = new Color()
  const random = seededRandom(kind === 'albedo' ? 0x51e77e : 0x51e77f)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const broad = periodicSurfaceNoise(u, v)
      const grain = random() - 0.5

      if (kind === 'roughness') {
        const roughness = Math.round(
          Math.min(252, Math.max(205, 236 + broad * 18 + grain * 13)),
        )
        data[offset] = roughness
        data[offset + 1] = roughness
        data[offset + 2] = roughness
      } else {
        const loessMix = smoothstep(-0.34, 0.42, broad + grain * 0.1)
        const sedgeMix = smoothstep(0.18, 0.48, broad - grain * 0.08)
        colour.copy(darkSoil).lerp(openLoess, loessMix).lerp(drySedge, sedgeMix * 0.38)
        colour.offsetHSL(0, grain * 0.018, grain * 0.045)
        data[offset] = Math.round(colour.r * 255)
        data[offset + 1] = Math.round(colour.g * 255)
        data[offset + 2] = Math.round(colour.b * 255)
      }
      data[offset + 3] = 255
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.name = `mammoth-steppe-${kind}-procedural-v1`
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(22, 22)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  if (kind === 'albedo') texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

interface SkyDomePrototypeController {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>
  setPhotographicBackground(enabled: boolean): void
}

function createSkyDome(): SkyDomePrototypeController {
  const panoramaReady = { value: 0 }
  const panoramaMix = { value: 0 }
  const panoramaMap = { value: new Texture() }
  panoramaMap.value.name = 'mammoth-analytic-sky-placeholder'
  let panoramaTexture: Texture | null = null

  const ensurePanorama = () => {
    if (panoramaTexture) return
    panoramaTexture = new TextureLoader().load(
      mammothEasternAlpsPanoramaUrl,
      () => {
        panoramaReady.value = 1
      },
    )
    panoramaTexture.name = 'mammoth-eastern-alps-mis3-panorama-v2'
    panoramaTexture.colorSpace = SRGBColorSpace
    panoramaTexture.wrapS = RepeatWrapping
    panoramaTexture.anisotropy = 8
    // A keeps the current photographic baseline. B and C never request this
    // texture, so their low-cost analytic sky avoids the 4K upload entirely.
    panoramaTexture.generateMipmaps = false
    panoramaTexture.magFilter = LinearFilter
    panoramaTexture.minFilter = LinearFilter
    panoramaMap.value.dispose()
    panoramaMap.value = panoramaTexture
  }

  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      horizonColour: { value: new Color('#adc3cf') },
      lowerColour: { value: new Color('#879c9f') },
      sunColour: { value: new Color('#ffe6b5') },
      sunDirection: { value: WORLD_SUN_DIRECTION.clone() },
      zenithColour: { value: new Color('#5d86a4') },
      panoramaMap,
      panoramaMix,
      panoramaReady,
    },
    vertexShader: /* glsl */ `
      varying vec2 vPanoramaUv;
      varying float vViewportAspect;
      varying vec3 vWorldDirection;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPanoramaUv = uv;
        vViewportAspect = projectionMatrix[1][1] / projectionMatrix[0][0];
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
      uniform sampler2D panoramaMap;
      uniform float panoramaMix;
      uniform float panoramaReady;
      varying vec2 vPanoramaUv;
      varying float vViewportAspect;
      varying vec3 vWorldDirection;

      float softWave(vec3 direction) {
        float first = sin(direction.x * 21.0 + direction.z * 16.0 + direction.y * 8.0);
        float second = sin(direction.x * 37.0 - direction.z * 23.0 + 1.7);
        float third = cos(direction.x * 63.0 + direction.z * 39.0 - 0.8);
        return first * 0.48 + second * 0.34 + third * 0.18;
      }

      void main() {
        vec3 direction = normalize(vWorldDirection);
        float height = direction.y * 0.5 + 0.5;
        vec3 sky = mix(lowerColour, horizonColour, smoothstep(0.17, 0.49, height));
        sky = mix(sky, zenithColour, smoothstep(0.49, 0.93, height));

        float sunFacing = max(dot(direction, sunDirection), 0.0);
        float sun = pow(sunFacing, 620.0);
        float glow = pow(sunFacing, 10.0) * 0.13;
        sky += sunColour * (sun * 1.35 + glow);

        float cloudAltitude = smoothstep(0.50, 0.62, height) *
          (1.0 - smoothstep(0.73, 0.89, height));
        float streak = softWave(direction);
        float cloud = smoothstep(0.36, 0.79, streak) * cloudAltitude;
        sky = mix(sky, vec3(0.91, 0.91, 0.86), cloud * 0.16);

        float horizonHaze = 1.0 - smoothstep(0.45, 0.56, height);
        sky = mix(sky, horizonColour, horizonHaze * 0.24);
        if (panoramaReady > 0.5 && panoramaMix > 0.001) {
          // The source plate covers the whole 180-degree vertical span. The
          // encounter camera only uses a narrow band around the horizon, so a
          // restrained remap keeps the high Alpine ridge visually remote
          // instead of magnifying it into a nearby wall.
          float portraitAmount = 1.0 - smoothstep(0.72, 1.02, vViewportAspect);
          float panoramaVerticalScale = mix(2.38, 4.25, portraitAmount);
          float remappedV = clamp(
            0.5 + (vPanoramaUv.y - 0.5) * panoramaVerticalScale,
            0.001,
            0.999
          );
          vec2 panoramaUv = vec2(vPanoramaUv.x, remappedV);
          vec3 panoramaBase = texture2D(panoramaMap, panoramaUv).rgb;
          // Keep the plate's authored atmospheric perspective. A small
          // source-space unsharp mask restores only the detail lost during
          // the dome projection; a stronger kernel turns snow seams into dark
          // graphic outlines and makes the distant ridge look pasted on.
          vec2 panoramaTexel = vec2(1.5 / 4096.0, 1.5 / 2048.0);
          vec3 panoramaBlur = 0.25 * (
            texture2D(panoramaMap, panoramaUv + vec2(panoramaTexel.x, 0.0)).rgb +
            texture2D(panoramaMap, panoramaUv - vec2(panoramaTexel.x, 0.0)).rgb +
            texture2D(panoramaMap, panoramaUv + vec2(0.0, panoramaTexel.y)).rgb +
            texture2D(panoramaMap, panoramaUv - vec2(0.0, panoramaTexel.y)).rgb
          );
          float ridgeDetailBand = smoothstep(0.24, 0.38, remappedV) *
            (1.0 - smoothstep(0.72, 0.87, remappedV));
          float localEdge = clamp(length(panoramaBase - panoramaBlur) * 4.6, 0.0, 1.0);
          float sharpeningStrength = mix(0.08, 1.08, ridgeDetailBand) *
            mix(0.54, 0.9, localEdge);
          vec3 panorama = clamp(
            panoramaBase + (panoramaBase - panoramaBlur) * sharpeningStrength,
            0.0,
            1.0
          );
          panorama = clamp((panorama - 0.5) * 1.016 + 0.5, 0.0, 1.0);
          // The generated plate is very nearly wrapped, but a narrow
          // shader-side crossfade prevents its longitude boundary from
          // flashing during orbit without softening the central mountains.
          float seamDistance = min(panoramaUv.x, 1.0 - panoramaUv.x);
          float seamBlend = 1.0 - smoothstep(0.0, 0.018, seamDistance);
          vec3 seamSample = 0.5 * (
            texture2D(panoramaMap, panoramaUv + vec2(-0.012, 0.0)).rgb +
            texture2D(panoramaMap, panoramaUv + vec2(0.012, 0.0)).rgb
          );
          vec3 photographicSky = mix(panorama, seamSample, seamBlend) * 0.96;
          sky = mix(sky, photographicSky, panoramaMix);
        }
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new Mesh(new SphereGeometry(195, 64, 32), material)
  mesh.name = 'glacier-background-atmosphere-sky'
  mesh.renderOrder = -100
  return {
    mesh,
    setPhotographicBackground: (enabled) => {
      panoramaMix.value = enabled ? 1 : 0
      mesh.userData.mammothBackgroundMode = enabled
        ? 'photographic-panorama'
        : 'analytic-sky'
      if (enabled) ensurePanorama()
    },
  }
}

function mountainHeight(x: number, z: number): number {
  const depthEnvelope = Math.exp(-Math.pow((z + 192) / 33, 2))
  const westernPeak = Math.exp(-Math.pow((x + 92) / 27, 2)) * 20
  const westernNeedle = Math.exp(-Math.pow((x + 54) / 17, 2)) * 16
  const centralPeak = Math.exp(-Math.pow((x + 12) / 23, 2)) * 31
  const centralShoulder = Math.exp(-Math.pow((x - 27) / 18, 2)) * 19
  const easternPeak = Math.exp(-Math.pow((x - 72) / 25, 2)) * 25
  const easternNeedle = Math.exp(-Math.pow((x - 111) / 18, 2)) * 18
  const distantShoulder = Math.exp(-Math.pow((x - 172) / 48, 2)) * 11
  // Narrow summits break the broad glacial massifs into an irregular skyline.
  // They remain much lower-frequency than a photograph, but stop the range
  // reading as one evenly extruded wall at the teaching overview distance.
  const farWesternSpire = Math.exp(-Math.pow((x + 142) / 13, 2)) * 10
  const westernSpire = Math.exp(-Math.pow((x + 72) / 10, 2)) * 9
  const centralSpire = Math.exp(-Math.pow((x - 2) / 9, 2)) * 12
  const easternSpire = Math.exp(-Math.pow((x - 93) / 11, 2)) * 10
  const farEasternSpire = Math.exp(-Math.pow((x - 145) / 13, 2)) * 8
  const serration =
    Math.sin(x * 0.071 + z * 0.037) * 3.5 +
    Math.sin(x * 0.153 - z * 0.082 + 1.4) * 2.25 +
    Math.cos(x * 0.043 + z * 0.121) * 1.7 +
    Math.sin(x * 0.287 - z * 0.173) * 1.05
  const spurRelief =
    Math.sin(x * 0.109 + z * 0.224) * 2.6 +
    Math.cos(x * 0.218 - z * 0.137) * 1.45 +
    Math.sin(x * 0.397 + z * 0.091) * 0.68
  const foothill = smoothstep(-132, -174, z) * 2.8
  return Math.max(
    -2,
    -1 + foothill + depthEnvelope *
      (
        4 +
        westernPeak +
        westernNeedle +
        centralPeak +
        centralShoulder +
        easternPeak +
        easternNeedle +
        distantShoulder +
        farWesternSpire +
        westernSpire +
        centralSpire +
        easternSpire +
        farEasternSpire +
        serration +
        spurRelief
      ),
  )
}

function createMountainRangeGeometry(): BufferGeometry {
  const xSegments = 192
  const zSegments = 32
  const xMinimum = -248
  const xMaximum = 248
  const zMinimum = -210
  const zMaximum = -122
  const vertices: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const colour = new Color()
  const shadowRock = new Color('#344a57')
  const openRock = new Color('#657985')
  const highRock = new Color('#8fa0a5')
  const snowShadow = new Color('#9fb9c7')
  const snowLight = new Color('#e3ebe9')
  const normal = new Vector3()

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const zFraction = zIndex / zSegments
    const z = zMinimum + (zMaximum - zMinimum) * zFraction
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const xFraction = xIndex / xSegments
      const x = xMinimum + (xMaximum - xMinimum) * xFraction
      const y = mountainHeight(x, z)
      const slopeX =
        (mountainHeight(x + 2, z) - mountainHeight(x - 2, z)) / 4
      const slopeZ =
        (mountainHeight(x, z + 2) - mountainHeight(x, z - 2)) / 4
      normal.set(-slopeX, 1, -slopeZ).normalize()
      const bakedLight = smoothstep(
        -0.35,
        0.72,
        normal.dot(WORLD_SUN_DIRECTION),
      )
      const lightVariation =
        Math.sin(x * 0.037 + z * 0.029) * 0.5 +
        Math.cos(x * 0.019 - z * 0.043) * 0.5
      const snowRetention = smoothstep(0.24, 0.78, normal.y)
      const snowLine = smoothstep(13, 31, y)
      const snowBreakup = smoothstep(
        -0.45,
        0.58,
        Math.sin(x * 0.085 + z * 0.041) * 0.62 +
          Math.cos(x * 0.037 - z * 0.068) * 0.38,
      )
      const snowCoverage = Math.min(
        0.78,
        snowLine * (0.3 + snowRetention * 0.32 + snowBreakup * 0.16),
      )
      const rockStrata =
        Math.sin(y * 0.72 + x * 0.095 + z * 0.028) * 0.55 +
        Math.cos(y * 0.31 - x * 0.047 + z * 0.066) * 0.45
      const gullyShadow = smoothstep(
        0.32,
        0.94,
        Math.abs(
          Math.sin(x * 0.116 + z * 0.041) * 0.72 +
            Math.sin(x * 0.043 - z * 0.089) * 0.28,
        ),
      )
      colour
        .copy(shadowRock)
        .lerp(openRock, 0.1 + bakedLight * 0.7)
        .lerp(highRock, smoothstep(30, 54, y) * 0.34)
        .offsetHSL(
          0,
          0,
          rockStrata * 0.055 + lightVariation * 0.035 - gullyShadow * 0.045,
        )
        .lerp(snowShadow, snowCoverage * (0.32 - bakedLight * 0.08))
        .lerp(snowLight, snowCoverage * (0.24 + bakedLight * 0.34))
      vertices.push(x, y, z)
      colours.push(colour.r, colour.g, colour.b)
    }
  }

  const stride = xSegments + 1
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const offset = zIndex * stride + xIndex
      indices.push(
        offset,
        offset + stride,
        offset + 1,
        offset + 1,
        offset + stride,
        offset + stride + 1,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function glacierChannelMask(x: number, z: number, height: number): number {
  const centralChannel = -7 + (z + 198) * 0.72
  const westernChannel = -43 - (z + 198) * 0.38
  const central = 1 - smoothstep(8, 17, Math.abs(x - centralChannel))
  const western = 1 - smoothstep(6, 13, Math.abs(x - westernChannel))
  const altitude = smoothstep(17, 25, height)
  const taper = smoothstep(-187, -195, z)
  return Math.max(central, western * 0.74) * altitude * taper
}

function createFarIceGeometry(): BufferGeometry {
  const xSegments = 52
  const zSegments = 16
  const xMinimum = FAR_ICE_MINIMUM.x
  const xMaximum = FAR_ICE_MAXIMUM.x
  const zMinimum = FAR_ICE_MINIMUM.z
  const zMaximum = FAR_ICE_MAXIMUM.z
  const vertices: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const coldShadow = new Color('#8ea7aa')
  const iceLight = new Color('#d8e2df')
  const colour = new Color()

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const zFraction = zIndex / zSegments
    const z = zMinimum + (zMaximum - zMinimum) * zFraction
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const xFraction = xIndex / xSegments
      const x = xMinimum + (xMaximum - xMinimum) * xFraction
      const y = mountainHeight(x, z) + 0.48
      const channel = glacierChannelMask(x, z, y)
      colour
        .copy(coldShadow)
        .lerp(iceLight, Math.min(1, 0.42 + channel * 0.58))
      vertices.push(x, y, z)
      colours.push(colour.r, colour.g, colour.b)
    }
  }

  const stride = xSegments + 1
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const offset = zIndex * stride + xIndex
      const x = xMinimum + (xMaximum - xMinimum) * ((xIndex + 0.5) / xSegments)
      const z = zMinimum + (zMaximum - zMinimum) * ((zIndex + 0.5) / zSegments)
      const height = mountainHeight(x, z)
      if (glacierChannelMask(x, z, height) < 0.42) continue
      indices.push(
        offset,
        offset + stride,
        offset + 1,
        offset + 1,
        offset + stride,
        offset + stride + 1,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createHorizonVeil(
  name: string,
  width: number,
  height: number,
  opacity: number,
): Mesh<PlaneGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    depthWrite: false,
    fog: true,
    transparent: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        colour: { value: new Color('#b7bbae') },
        opacity: { value: opacity },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float opacity;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float vertical = smoothstep(0.0, 0.28, vUv.y) *
          (1.0 - smoothstep(0.72, 1.0, vUv.y));
        float horizontal = smoothstep(0.0, 0.1, vUv.x) *
          (1.0 - smoothstep(0.9, 1.0, vUv.x));
        gl_FragColor = vec4(colour, opacity * vertical * horizontal);
        #include <fog_fragment>
      }
    `,
  })
  const mesh = new Mesh(new PlaneGeometry(width, height), material)
  mesh.name = name
  return mesh
}

interface FarBackgroundPrototypeLayers {
  readonly frontMountainRange: Mesh<BufferGeometry, ShaderMaterial>
  readonly horizonHaze: Mesh<PlaneGeometry, ShaderMaterial>
  readonly ice: Mesh<BufferGeometry, MeshBasicMaterial>
  readonly mountainRange: Mesh<BufferGeometry, ShaderMaterial>
  readonly rearMountainRange: Mesh<BufferGeometry, ShaderMaterial>
}

interface MountainRangeMaterialOptions {
  readonly detailStrength: number
  readonly openRock: string
  readonly shadowRock: string
  readonly snowAmount: number
  readonly snowLight: string
  readonly snowShadow: string
  readonly snowStart: number
  readonly snowEnd: number
}

const MOUNTAIN_RANGE_PALETTES = {
  B: {
    rear: {
      detailStrength: 0.48,
      openRock: '#80939d',
      shadowRock: '#506775',
      snowAmount: 1.08,
      snowEnd: 29,
      snowLight: '#edf4f4',
      snowShadow: '#adbfca',
      snowStart: 11,
    },
    centre: {
      detailStrength: 1,
      openRock: '#647985',
      shadowRock: '#273f4e',
      snowAmount: 0.88,
      snowEnd: 36,
      snowLight: '#e8f0f0',
      snowShadow: '#97b3c2',
      snowStart: 17.5,
    },
    front: {
      detailStrength: 0.82,
      openRock: '#596a68',
      shadowRock: '#2f4548',
      snowAmount: 0.36,
      snowEnd: 34,
      snowLight: '#dbe5e3',
      snowShadow: '#91a9ac',
      snowStart: 21,
    },
  },
  C: {
    // The selected depth architecture uses the original mammoth exhibit as
    // its colour target: bright snow fields with cool blue shade, rather than
    // a grey photographic ridge. Contrast still decreases with distance.
    rear: {
      detailStrength: 0.3,
      openRock: '#c0d0d8',
      shadowRock: '#86a4b7',
      snowAmount: 1.72,
      snowEnd: 18,
      snowLight: '#f8fbfa',
      snowShadow: '#c7dce8',
      snowStart: 1.5,
    },
    centre: {
      detailStrength: 0.72,
      openRock: '#9fb5c1',
      shadowRock: '#55788e',
      snowAmount: 1.55,
      snowEnd: 24,
      snowLight: '#f7faf8',
      snowShadow: '#b6d1e2',
      snowStart: 5,
    },
    front: {
      detailStrength: 0.7,
      openRock: '#81989f',
      shadowRock: '#466570',
      snowAmount: 0.98,
      snowEnd: 14,
      snowLight: '#f0f7f5',
      snowShadow: '#abc8d3',
      snowStart: 2,
    },
  },
} as const satisfies Readonly<
  Record<
    'B' | 'C',
    Readonly<
      Record<'centre' | 'front' | 'rear', MountainRangeMaterialOptions>
    >
  >
>

function applyMountainRangeMaterialOptions(
  material: ShaderMaterial,
  options: MountainRangeMaterialOptions,
): void {
  material.uniforms.detailStrength!.value = options.detailStrength
  ;(material.uniforms.openRock!.value as Color).set(options.openRock)
  ;(material.uniforms.shadowRock!.value as Color).set(options.shadowRock)
  material.uniforms.snowAmount!.value = options.snowAmount
  material.uniforms.snowEnd!.value = options.snowEnd
  ;(material.uniforms.snowLightColour!.value as Color).set(options.snowLight)
  ;(material.uniforms.snowShadow!.value as Color).set(options.snowShadow)
  material.uniforms.snowStart!.value = options.snowStart
}

function createMountainRangeMaterial(
  options: MountainRangeMaterialOptions,
): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    toneMapped: false,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        detailStrength: { value: options.detailStrength },
        openRock: { value: new Color(options.openRock) },
        shadowRock: { value: new Color(options.shadowRock) },
        snowAmount: { value: options.snowAmount },
        snowEnd: { value: options.snowEnd },
        snowLightColour: { value: new Color(options.snowLight) },
        snowShadow: { value: new Color(options.snowShadow) },
        snowStart: { value: options.snowStart },
        sunDirection: { value: WORLD_SUN_DIRECTION.clone() },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      #include <fog_pars_vertex>
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 mvPosition = viewMatrix * worldPosition;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float detailStrength;
      uniform vec3 openRock;
      uniform vec3 shadowRock;
      uniform float snowAmount;
      uniform float snowEnd;
      uniform vec3 snowLightColour;
      uniform vec3 snowShadow;
      uniform float snowStart;
      uniform vec3 sunDirection;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      #include <fog_pars_fragment>

      void main() {
        vec3 geometricNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        if (!gl_FrontFacing) geometricNormal = -geometricNormal;
        vec3 normal = normalize(mix(vWorldNormal, geometricNormal, 0.46));
        float sunLight = smoothstep(-0.32, 0.72, dot(normal, sunDirection));

        // All detail is evaluated in world space, so it stays crisp when the
        // camera moves and costs no photographic panorama upload. The broad
        // channels read as eroded gullies; the finer bands prevent the ridge
        // from looking like a softly blurred cardboard silhouette.
        float broadChannel = 0.5 + 0.5 * sin(
          vWorldPosition.x * 0.118 +
          vWorldPosition.z * 0.071 +
          sin(vWorldPosition.x * 0.031) * 2.1
        );
        float ravine = smoothstep(0.66, 0.96, broadChannel);
        float strata = 0.5 + 0.5 * sin(
          vWorldPosition.y * 1.36 +
          vWorldPosition.x * 0.22 -
          vWorldPosition.z * 0.09
        );
        float fineRock = 0.5 + 0.5 * sin(
          vWorldPosition.x * 0.58 +
          vWorldPosition.z * 0.37 +
          sin(vWorldPosition.y * 0.91) * 1.7
        );

        vec3 colour = mix(shadowRock, openRock, 0.16 + sunLight * 0.84);
        colour *= mix(1.0 - detailStrength * 0.12, 1.0 + detailStrength * 0.09, strata);
        colour *= mix(1.0 - detailStrength * 0.16, 1.0 + detailStrength * 0.1, fineRock);
        colour = mix(
          colour,
          colour * vec3(0.38, 0.54, 0.64),
          ravine * detailStrength * 0.72
        );

        float snowPattern = smoothstep(
          -0.16,
          0.58,
          sin(vWorldPosition.x * 0.093 + vWorldPosition.z * 0.061) * 0.64 +
          cos(vWorldPosition.x * 0.041 - vWorldPosition.z * 0.119) * 0.36
        );
        float snowHint = smoothstep(snowStart, snowEnd, vWorldPosition.y) *
          mix(0.28, 0.9, smoothstep(0.28, 0.88, normal.y)) *
          mix(0.46, 1.0, snowPattern) *
          (1.0 - ravine * 0.58) * snowAmount;
        vec3 snowLight = mix(snowShadow, snowLightColour, sunLight);
        colour = mix(colour, snowLight, clamp(snowHint, 0.0, 0.9));

        gl_FragColor = vec4(colour, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function createFarBackground(
  background: Group,
  farIceMass: Group,
): FarBackgroundPrototypeLayers {
  const mountainGeometry = createMountainRangeGeometry()
  const rearMountainRange = new Mesh(
    mountainGeometry,
    createMountainRangeMaterial(MOUNTAIN_RANGE_PALETTES.B.rear),
  )
  rearMountainRange.name = 'glacier-rear-snow-peak-range'
  rearMountainRange.position.set(-65, 2, -72)
  rearMountainRange.scale.set(1.18, 0.72, 1.08)
  rearMountainRange.castShadow = false
  rearMountainRange.receiveShadow = false
  rearMountainRange.visible = false
  background.add(rearMountainRange)

  const mountainRange = new Mesh(
    mountainGeometry,
    createMountainRangeMaterial(MOUNTAIN_RANGE_PALETTES.B.centre),
  )
  mountainRange.name = 'glacier-far-rock-ridge'
  mountainRange.castShadow = false
  mountainRange.receiveShadow = false
  mountainRange.visible = false
  background.add(mountainRange)

  const frontMountainRange = new Mesh(
    mountainGeometry,
    createMountainRangeMaterial(MOUNTAIN_RANGE_PALETTES.B.front),
  )
  frontMountainRange.name = 'glacier-front-moraine-ridge'
  frontMountainRange.position.set(44, -10, 45)
  frontMountainRange.scale.set(1.08, 0.42, 0.9)
  frontMountainRange.castShadow = false
  frontMountainRange.receiveShadow = false
  frontMountainRange.visible = false
  background.add(frontMountainRange)

  const ice = new Mesh(
    createFarIceGeometry(),
    new MeshBasicMaterial({
      color: '#ffffff',
      fog: true,
      vertexColors: true,
    }),
  )
  ice.name = 'glacier-far-ice-mass-direction-reference'
  ice.castShadow = false
  ice.receiveShadow = true
  ice.visible = false
  farIceMass.add(ice)

  const horizonHaze = createHorizonVeil(
    'glacier-background-horizon-haze',
    520,
    24,
    0,
  )
  // Sit just in front of the nearest ridge. A veil placed behind that mesh
  // cannot soften its contact line because the depth buffer occludes it.
  horizonHaze.position.set(0, 7, -72)
  horizonHaze.renderOrder = -4
  horizonHaze.visible = false
  background.add(horizonHaze)
  return {
    frontMountainRange,
    horizonHaze,
    ice,
    mountainRange,
    rearMountainRange,
  }
}

function createGroundGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(
    GROUND_RADIUS_METERS * 2,
    GROUND_RADIUS_METERS * 2,
    144,
    144,
  )
  const positions = geometry.getAttribute('position')
  const colours: number[] = []
  const soil = new Color()
  const darkSoil = new Color('#f2f0eb')
  const sedgeSoil = new Color('#e7e7dd')
  const loess = new Color('#faf8f3')

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const worldZ = -positions.getY(index)
    positions.setZ(index, mammothPalaeoenvironmentGroundY(x, worldZ))
    const macro =
      Math.sin(x * 0.047) * 0.36 +
      Math.cos(worldZ * 0.038) * 0.28 +
      Math.sin((x - worldZ) * 0.017) * 0.2 +
      Math.cos((x + worldZ) * 0.071) * 0.1
    soil
      .copy(darkSoil)
      .lerp(loess, smoothstep(-0.48, 0.3, macro))
      .lerp(sedgeSoil, smoothstep(0.12, 0.56, macro) * 0.56)
    colours.push(soil.r, soil.g, soil.b)
  }
  positions.needsUpdate = true
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.computeVertexNormals()
  return geometry
}

function createGroundSurface(): Mesh<PlaneGeometry, MeshStandardMaterial> {
  const albedo = new TextureLoader().load(mammothTundraGroundAlbedoUrl)
  albedo.name = 'mammoth-tundra-ground-albedo-v2'
  albedo.colorSpace = SRGBColorSpace
  albedo.wrapS = MirroredRepeatWrapping
  albedo.wrapT = MirroredRepeatWrapping
  albedo.center.set(0.5, 0.5)
  albedo.rotation = 0.31
  // Keep the photograph's gravel scale. A 12× repeat made individual source
  // pebbles grow into soft hand-sized blobs in the child-height camera.
  albedo.repeat.set(24, 24)
  albedo.magFilter = LinearFilter
  albedo.minFilter = LinearMipmapLinearFilter
  albedo.generateMipmaps = true
  albedo.anisotropy = 8
  const roughness = createSteppeSurfaceTexture('roughness')
  const frostBlend = { value: SURFACE_STATE.balanced.frostBlend }
  const material = new MeshStandardMaterial({
    alphaTest: 0.015,
    bumpMap: albedo,
    bumpScale: 0.035,
    // The generated plate already carries the full soil colour. A second
    // grey tint and dark vertex colours had multiplied it into an asphalt-like
    // surface that no longer matched the panorama foreground.
    color: '#ffffff',
    map: albedo,
    metalness: 0,
    roughness: 0.94,
    roughnessMap: roughness,
    transparent: true,
  })
  material.name = 'mammoth-steppe-ground-frost-distance-blend-v3'
  material.userData.mammothFrostBlend = frostBlend
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mammothFrostBlend = frostBlend
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vMammothGroundDistance;\nvarying vec2 vMammothGroundWorldXZ;',
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec3 mammothGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vMammothGroundWorldXZ = mammothGroundWorld.xz;
        vMammothGroundDistance = length(mammothGroundWorld.xz);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float mammothFrostBlend;\nvarying float vMammothGroundDistance;\nvarying vec2 vMammothGroundWorldXZ;',
      )
      .replace(
        '#include <opaque_fragment>',
        `float mammothFrostBroad =
          sin(vMammothGroundWorldXZ.x * 0.085 + vMammothGroundWorldXZ.y * 0.041) * 0.52 +
          cos(vMammothGroundWorldXZ.x * 0.033 - vMammothGroundWorldXZ.y * 0.092) * 0.38 +
          sin((vMammothGroundWorldXZ.x + vMammothGroundWorldXZ.y) * 0.17) * 0.22;
        float mammothFrostFine =
          sin(vMammothGroundWorldXZ.x * 0.57 - vMammothGroundWorldXZ.y * 0.43) * 0.09 +
          cos(vMammothGroundWorldXZ.x * 0.31 + vMammothGroundWorldXZ.y * 0.49) * 0.07;
        float mammothFrostMask = smoothstep(
          0.05,
          0.72,
          mammothFrostBroad + mammothFrostFine
        );
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          vec3(0.88, 0.92, 0.93),
          mammothFrostMask * mammothFrostBlend
        );
        diffuseColor.a *= 1.0 - smoothstep(132.0, 176.0, vMammothGroundDistance);
        if (diffuseColor.a < 0.015) discard;
        #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () =>
    'mammoth-steppe-ground-frost-distance-blend-v3'
  const ground = new Mesh(
    createGroundGeometry(),
    material,
  )
  material.vertexColors = true
  ground.name = 'glacier-ground-surface-unglaciated-land'
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  return ground
}

interface SnowLayerResult {
  readonly frozenCrusts: InstancedMesh
  readonly nearDrifts: InstancedMesh
}

function createSnowPatchTexture(): DataTexture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const u = (x + 0.5) / size * 2 - 1
      const v = (y + 0.5) / size * 2 - 1
      const radius = Math.hypot(u, v)
      const edgeNoise =
        Math.sin(u * 8.7 + v * 5.1) * 0.09 +
        Math.sin(u * 19.3 - v * 13.7 + 1.2) * 0.05
      const edge = 1 - smoothstep(0.48 + edgeNoise, 0.96 + edgeNoise, radius)
      const breakup =
        Math.sin(u * 17.1 + v * 9.3 + 0.4) * 0.38 +
        Math.cos(u * 31.7 - v * 23.9) * 0.24 +
        Math.sin(u * 53.1 + v * 47.3 + 2.1) * 0.14
      const crust = smoothstep(-0.34, 0.24, breakup + edge * 0.22)
      const grain =
        0.86 +
        Math.sin(u * 31 + v * 23) * 0.035 +
        Math.cos(u * 17 - v * 29) * 0.025
      const windPolish = smoothstep(-0.42, 0.36, breakup)
      const grit = smoothstep(
        0.72,
        0.97,
        Math.sin(u * 71.3 + v * 43.7) *
          Math.cos(u * 37.1 - v * 59.9),
      )
      const crustTone =
        0.91 + edge * 0.035 + crust * 0.025 - grit * 0.12
      data[offset] = Math.round(228 * grain * crustTone)
      data[offset + 1] = Math.round(236 * grain * crustTone)
      data[offset + 2] = Math.round(239 * grain * crustTone)
      // Let the wind-scoured edge break up into the soil instead of drawing a
      // bright polygon. A firm interior keeps the patch readable at overview
      // scale, while the alpha fringe survives mipmapping as a soft melt line.
      const alpha = smoothstep(0.025, 0.78, edge) *
        (0.82 + windPolish * 0.18)
      data[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.name = 'mammoth-thin-crusted-snow-patch-v2'
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function createSnowPatchGeometry(): BufferGeometry {
  const segments = 28
  const vertices = [0, 0.022, 0]
  const uvs = [0.5, 0.5]
  const indices: number[] = []
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const radius =
      0.5 *
      (0.86 +
        Math.sin(angle * 3 + 0.6) * 0.1 +
        Math.sin(angle * 7 - 1.1) * 0.055 +
        Math.cos(angle * 11 + 0.2) * 0.028)
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    vertices.push(x, Math.sin(angle * 5 + 0.4) * 0.003, z)
    // Overscan the albedo so every mesh edge lands in the translucent melt
    // fringe instead of exposing the fan silhouette as a pale polygon.
    uvs.push(0.5 + x * 1.16, 0.5 + z * 1.16)
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, index + 1, ((index + 1) % segments) + 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(vertices), 3),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createNearSnowDrifts(): InstancedMesh {
  const maximumCount = SURFACE_STATE['late-snow'].patchCount
  const geometry = createSnowPatchGeometry()
  const snowTexture = createSnowPatchTexture()
  const mesh = new InstancedMesh(
    geometry,
    new MeshStandardMaterial({
      alphaTest: 0.08,
      bumpMap: snowTexture,
      bumpScale: 0.018,
      color: '#f5f8f6',
      depthWrite: true,
      emissive: '#304044',
      emissiveIntensity: 0.035,
      map: snowTexture,
      metalness: 0,
      opacity: 0.94,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      roughness: 0.92,
      side: DoubleSide,
      transparent: true,
    }),
    maximumCount,
  )
  mesh.name = 'glacier-snow-layer-near-wind-drifts'
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.userData.persistentAcrossCameraStages = true
  const random = seededRandom(0x51a9d4)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const yAxis = new Vector3(0, 1, 0)
  const heroPatches = [
    [-10, 18, 5.4, 2.1, 0.12],
    [6, 19, 5.8, 2.4, -0.22],
    [20, 22, 6.2, 2.2, 0.4],
    [-25, 25, 6.5, 2.6, -0.36],
    [0, 30, 7.4, 2.8, 0.18],
    [30, 34, 7, 2.6, -0.5],
    [-34, 36, 7.6, 3, 0.42],
    [12, 42, 8.2, 3.2, -0.12],
    [-18, 47, 7.8, 3.1, 0.54],
    [38, 49, 8.4, 3.4, -0.38],
    [-42, 54, 8.6, 3.6, 0.27],
    [4, 57, 9, 3.8, -0.6],
    [-58, 20, 6.8, 2.7, -0.18],
    [54, 23, 7.2, 2.8, 0.34],
    [-55, 31, 7.6, 3.1, 0.48],
    [57, 35, 8.1, 3.2, -0.42],
    [-49, 43, 8.4, 3.5, -0.28],
    [51, 47, 8.8, 3.6, 0.52],
    [-62, 56, 9.4, 3.9, 0.2],
    [60, 60, 9.8, 4.1, -0.36],
    [-38, 66, 10.2, 4.3, 0.42],
    [35, 70, 10.6, 4.4, -0.5],
    [-12, 76, 11.2, 4.8, 0.18],
    [16, 82, 11.6, 5, -0.34],
    [-52, -10, 6.8, 2.6, 0.28],
    [48, -12, 7.2, 2.8, -0.4],
    [-39, -22, 7.6, 3, -0.32],
    [43, -26, 8, 3.2, 0.46],
    [-60, -34, 8.5, 3.4, 0.18],
    [58, -38, 8.8, 3.6, -0.52],
    [-31, -45, 9.2, 3.8, 0.36],
    [34, -49, 9.6, 4, -0.24],
    [-6.5, 5.8, 2.2, 0.92, -0.12],
    [4.8, 5.2, 2.4, 1.02, 0.38],
    [-13, -4.8, 2.1, 0.88, 0.72],
    [9.5, -5.8, 2.6, 1.05, -0.36],
    [-4.6, 8.1, 1.55, 0.58, 0.24],
    [-8.8, 6.9, 1.35, 0.5, -0.48],
    [2.6, 7.4, 1.6, 0.6, -0.18],
    [7.4, 6.4, 1.5, 0.54, 0.58],
    [-15.6, -2.8, 1.7, 0.62, -0.7],
    [-10.8, -7.2, 1.45, 0.52, 0.46],
    [12.4, -3.8, 1.65, 0.58, 0.14],
    [15.2, -7.6, 1.55, 0.54, -0.56],
    [-1.4, 12.4, 1.8, 0.64, 0.84],
    [7.2, 11.2, 1.7, 0.6, -0.32],
    [-20.5, 9.4, 1.9, 0.68, 0.38],
    [20.8, 10.2, 1.85, 0.66, -0.76],
    [-9, 8, 2.5, 1.18, 0.28],
    [2, 9.5, 1.9, 0.88, -0.48],
    [10, 7, 2.2, 1, 0.82],
    [-17, 12, 2.6, 1.18, -0.16],
    [18, -7, 2.4, 1.08, 0.46],
    [-22, -10, 2.8, 1.24, -0.72],
    [28, 13, 2.7, 1.12, 0.18],
    [-32, 5.5, 2.3, 1, 0.92],
    [6, -11, 2, 0.9, -0.2],
    [-8, -13, 2.1, 0.92, 0.62],
    [35, -18, 2.9, 1.28, -0.38],
    [-40, 20, 3, 1.32, 0.34],
    [15, 16, 2.4, 1.04, -0.84],
    [-26, 17, 2.7, 1.16, 0.54],
    [31, -4, 2.2, 0.94, 0.08],
    [-35, -3, 2.4, 1.02, -0.58],
    [-3, 15.5, 2.5, 1.08, 0.42],
    [13, 14.5, 2.2, 0.96, -0.26],
    [-20, 19, 2.8, 1.18, 0.76],
    [24, -14, 2.6, 1.1, -0.62],
    [-29, -17, 2.9, 1.2, 0.24],
    [39, 8, 3, 1.22, -0.88],
    [-43, 10, 3.1, 1.25, 0.52],
    [8, -20, 2.4, 1.02, -0.08],
    // Narrow portrait framing moves the fitted overview camera farther down
    // the +Z rail than the desktop view. Mid-rail drifts keep snow in that
    // foreground and remain in world space throughout the guided move.
    [-12, 24, 3.5, 1.32, 0.22],
    [-3, 27, 3.1, 1.12, -0.48],
    [6, 25, 3.4, 1.26, 0.68],
    [14, 28, 3, 1.08, -0.18],
    [-15, 33, 3.3, 1.2, -0.62],
    [-6, 35, 2.9, 1.02, 0.36],
    [3, 32, 3.2, 1.16, -0.78],
    [12, 36, 2.8, 0.98, 0.54],
    [-13, 41, 2.9, 1.04, 0.16],
    [-4, 39, 2.6, 0.92, -0.38],
    [5, 42, 2.8, 1, 0.72],
    [14, 40, 2.5, 0.88, -0.56],
    [-10, 47, 2.5, 0.9, 0.42],
    [-1, 45, 2.3, 0.82, -0.74],
    [8, 48, 2.4, 0.86, 0.18],
    [16, 46, 2.2, 0.78, -0.28],
  ] as const
  let placed = 0
  for (const [x, z, width, depth, rotation] of heroPatches) {
    quaternion.setFromAxisAngle(yAxis, rotation)
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + 0.058, z),
      quaternion,
      new Vector3(width * 1.28, 1, depth * 1.28),
    )
    mesh.setMatrixAt(placed, matrix)
    placed += 1
  }
  let guard = 0

  while (placed < maximumCount && guard < 2_000) {
    guard += 1
    const angle = random() * Math.PI * 2
    const distance = 13 + Math.pow(random(), 0.78) * 72
    const x = Math.cos(angle) * distance * (0.86 + random() * 0.3)
    const z = Math.sin(angle) * distance
    if (pointToCorridorDistance(x, z) < 3.1) continue
    const size = 0.8 + random() * 1.65
    quaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2)
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + 0.052, z),
      quaternion,
      new Vector3(
        size * (1.04 + random() * 0.72),
        1,
        size * (0.38 + random() * 0.3),
      ),
    )
    mesh.setMatrixAt(placed, matrix)
    placed += 1
  }
  mesh.count = maximumCount
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function createFrozenCrusts(): InstancedMesh {
  const maximumCount = SURFACE_STATE['late-snow'].crustCount
  const crustTexture = createSnowPatchTexture()
  const mesh = new InstancedMesh(
    createSnowPatchGeometry(),
    new MeshStandardMaterial({
      alphaTest: 0.1,
      bumpMap: crustTexture,
      bumpScale: 0.012,
      color: '#d8e6e7',
      depthWrite: false,
      emissive: '#29434a',
      emissiveIntensity: 0.1,
      map: crustTexture,
      metalness: 0.07,
      opacity: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.28,
      side: DoubleSide,
      transparent: true,
    }),
    maximumCount,
  )
  mesh.name = 'glacier-snow-layer-wind-polished-frozen-crust'
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.userData.persistentAcrossCameraStages = true

  const priorityCrusts = [
    [-10, 18, 3.4, 1.05, 0.12],
    [6, 19, 3.7, 1.16, -0.22],
    [20, 22, 3.9, 1.08, 0.4],
    [-25, 25, 4.1, 1.22, -0.36],
    [0, 30, 4.6, 1.34, 0.18],
    [30, 34, 4.3, 1.26, -0.5],
    [-34, 36, 4.8, 1.4, 0.42],
    [12, 42, 5.1, 1.48, -0.12],
    [-18, 47, 4.9, 1.44, 0.54],
    [38, 49, 5.2, 1.52, -0.38],
    [-58, 20, 4.2, 1.25, -0.18],
    [54, 23, 4.4, 1.32, 0.34],
    [-55, 31, 4.6, 1.38, 0.48],
    [57, 35, 4.9, 1.46, -0.42],
    [-49, 43, 5.1, 1.52, -0.28],
    [51, 47, 5.3, 1.58, 0.52],
    [-62, 56, 5.6, 1.66, 0.2],
    [60, 60, 5.8, 1.72, -0.36],
    [-38, 66, 6.1, 1.82, 0.42],
    [35, 70, 6.3, 1.88, -0.5],
    [-52, -10, 4.1, 1.22, 0.28],
    [48, -12, 4.3, 1.28, -0.4],
    [-39, -22, 4.6, 1.36, -0.32],
    [43, -26, 4.8, 1.42, 0.46],
    [-60, -34, 5.1, 1.5, 0.18],
    [58, -38, 5.3, 1.56, -0.52],
    [-6.5, 5.8, 1.2, 0.38, -0.12],
    [4.8, 5.2, 1.35, 0.42, 0.38],
    [-13, -4.8, 1.15, 0.35, 0.72],
    [9.5, -5.8, 1.45, 0.43, -0.36],
    [-9, 8, 1.35, 0.44, 0.28],
    [2, 9.5, 1.0, 0.34, -0.48],
    [10, 7, 1.2, 0.38, 0.82],
    [-17, 12, 1.4, 0.44, -0.16],
    [18, -7, 1.3, 0.42, 0.46],
    [-22, -10, 1.5, 0.46, -0.72],
    [28, 13, 1.5, 0.44, 0.18],
    [-32, 5.5, 1.3, 0.4, 0.92],
    [-4.6, 8.1, 0.82, 0.24, 0.24],
    [-8.8, 6.9, 0.72, 0.22, -0.48],
    [2.6, 7.4, 0.86, 0.25, -0.18],
    [7.4, 6.4, 0.8, 0.23, 0.58],
    [-15.6, -2.8, 0.9, 0.26, -0.7],
    [-10.8, -7.2, 0.76, 0.22, 0.46],
    [12.4, -3.8, 0.88, 0.24, 0.14],
    [15.2, -7.6, 0.82, 0.23, -0.56],
    [-1.4, 12.4, 0.94, 0.27, 0.84],
    [7.2, 11.2, 0.9, 0.25, -0.32],
    [-20.5, 9.4, 1, 0.28, 0.38],
    [20.8, 10.2, 0.98, 0.28, -0.76],
    [-12, 24, 1.9, 0.52, 0.22],
    [-3, 27, 1.7, 0.46, -0.48],
    [6, 25, 1.85, 0.5, 0.68],
    [14, 28, 1.65, 0.44, -0.18],
    [-15, 33, 1.8, 0.48, -0.62],
    [-6, 35, 1.6, 0.42, 0.36],
    [3, 32, 1.75, 0.46, -0.78],
    [12, 36, 1.55, 0.4, 0.54],
    [-4, 39, 1.45, 0.38, -0.38],
    [5, 42, 1.5, 0.4, 0.72],
  ] as const
  const random = seededRandom(0x8c41b2)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const yAxis = new Vector3(0, 1, 0)
  let placed = 0

  for (const [x, z, width, depth, rotation] of priorityCrusts) {
    quaternion.setFromAxisAngle(yAxis, rotation)
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + 0.066, z),
      quaternion,
      new Vector3(width, 1, depth),
    )
    mesh.setMatrixAt(placed, matrix)
    placed += 1
  }

  let guard = 0
  while (placed < maximumCount && guard < 2_000) {
    guard += 1
    const angle = random() * Math.PI * 2
    const distance = 14 + Math.pow(random(), 0.82) * 68
    const x = Math.cos(angle) * distance * (0.84 + random() * 0.32)
    const z = Math.sin(angle) * distance
    if (pointToCorridorDistance(x, z) < 3.4) continue
    const size = 0.72 + random() * 1.25
    quaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2)
    matrix.compose(
      new Vector3(x, mammothPalaeoenvironmentGroundY(x, z) + 0.064, z),
      quaternion,
      new Vector3(
        size * (0.75 + random() * 0.45),
        1,
        size * (0.22 + random() * 0.2),
      ),
    )
    mesh.setMatrixAt(placed, matrix)
    placed += 1
  }
  mesh.count = maximumCount
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function createSnowLayer(): SnowLayerResult {
  return {
    frozenCrusts: createFrozenCrusts(),
    nearDrifts: createNearSnowDrifts(),
  }
}

function createGrassTuftGeometry(): BufferGeometry {
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let plane = 0; plane < 3; plane += 1) {
    const angle = (plane / 3) * Math.PI
    const tangentX = Math.cos(angle) * 0.5
    const tangentZ = Math.sin(angle) * 0.5
    const offset = vertices.length / 3
    vertices.push(
      -tangentX,
      0,
      -tangentZ,
      tangentX,
      0,
      tangentZ,
      tangentX,
      1,
      tangentZ,
      -tangentX,
      1,
      -tangentZ,
    )
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset,
      offset + 2,
      offset + 3,
    )
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createGrassCutoutMaterial(): MeshLambertMaterial {
  const texture = new TextureLoader().load(mammothTundraSedgeClumpUrl)
  texture.name = 'mammoth-tundra-sedge-clump-v2'
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  // The source has a keyed checker matte. Downsampled mip levels mixed that
  // bright matte into every blade and produced the pale pom-poms seen at a
  // distance. Sample the source level directly before keying it out.
  texture.generateMipmaps = false
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  const material = new MeshLambertMaterial({
    alphaTest: 0.46,
    color: '#ffffff',
    map: texture,
    side: DoubleSide,
  })
  material.name = 'mammoth-tundra-sedge-checker-matte-cutout-v2'
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
        #endif
        float matteLuma = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float matteSpread = max(
          max(sampledDiffuseColor.r, sampledDiffuseColor.g),
          sampledDiffuseColor.b
        ) - min(
          min(sampledDiffuseColor.r, sampledDiffuseColor.g),
          sampledDiffuseColor.b
        );
        float sedgeAlpha = clamp(
          (1.0 - smoothstep(0.70, 0.84, matteLuma)) * 1.18 +
          smoothstep(0.065, 0.16, matteSpread) * 0.34,
          0.0,
          1.0
        );
        diffuseColor *= sampledDiffuseColor;
        diffuseColor.a *= sedgeAlpha;
      #endif`,
    )
  }
  material.customProgramCacheKey = () =>
    'mammoth-tundra-sedge-checker-matte-cutout-v2'
  return material
}

function createForbGeometry(): BufferGeometry {
  const vertices: number[] = []
  const indices: number[] = []
  const leafCount = 5
  for (let leaf = 0; leaf < leafCount; leaf += 1) {
    const angle = (leaf / leafCount) * Math.PI * 2
    const width = 0.07
    const offset = vertices.length / 3
    vertices.push(
      Math.cos(angle + Math.PI / 2) * width,
      0,
      Math.sin(angle + Math.PI / 2) * width,
      -Math.cos(angle + Math.PI / 2) * width,
      0,
      -Math.sin(angle + Math.PI / 2) * width,
      Math.cos(angle) * 0.18,
      0.72 + (leaf % 2) * 0.08,
      Math.sin(angle) * 0.18,
    )
    indices.push(offset, offset + 1, offset + 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createDwarfWillowGeometry(): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(0.5, 1)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    positions.setXYZ(
      index,
      positions.getX(index) * 1.15,
      (positions.getY(index) + 0.5) * 0.52,
      positions.getZ(index) * 0.92,
    )
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function createRockGeometry(): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(0.5, 1)
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const variation = 0.86 + Math.sin(x * 17 + y * 11 + z * 23) * 0.12
    positions.setXYZ(
      index,
      x * variation,
      (y + 0.5) * variation * 0.62,
      z * variation * 1.08,
    )
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

interface InstanceLayerOptions {
  readonly castShadow: boolean
  readonly clusterStrength: number
  readonly colours: readonly string[]
  readonly corridorClearance: number
  readonly count: number
  readonly geometry: BufferGeometry
  readonly heightRange: readonly [number, number]
  readonly maximumDistance: number
  readonly material?: MeshLambertMaterial
  readonly minimumDistance: number
  readonly name: string
  readonly seed: number
  readonly widthRange: readonly [number, number]
}

function createSteppeInstances(options: InstanceLayerOptions): InstancedMesh {
  const material = options.material ?? new MeshLambertMaterial({
    color: '#ffffff',
    side: DoubleSide,
  })
  const mesh = new InstancedMesh(options.geometry, material, options.count)
  mesh.name = options.name
  mesh.castShadow = options.castShadow
  mesh.receiveShadow = true

  const random = seededRandom(options.seed)
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const position = new Vector3()
  const scale = new Vector3()
  const colour = new Color()
  const yAxis = new Vector3(0, 1, 0)
  let placed = 0
  let guard = 0

  while (placed < options.count && guard < options.count * 120) {
    guard += 1
    const angle = random() * Math.PI * 2
    const distance =
      options.minimumDistance +
      Math.pow(random(), 0.82) *
        (options.maximumDistance - options.minimumDistance)
    const x = Math.cos(angle) * distance * (0.82 + random() * 0.38)
    const z = Math.sin(angle) * distance
    if (pointToCorridorDistance(x, z) < options.corridorClearance) continue

    const cluster =
      Math.sin(x * 0.19 + z * 0.11 + options.seed * 0.0001) * 0.34 +
      Math.cos(x * 0.071 - z * 0.17) * 0.23 +
      0.5
    const clusterProbability = Math.min(
      1,
      Math.max(0.18, 1 - options.clusterStrength + cluster * options.clusterStrength),
    )
    if (random() > clusterProbability) continue

    const height =
      options.heightRange[0] +
      random() * (options.heightRange[1] - options.heightRange[0])
    const width =
      options.widthRange[0] +
      random() * (options.widthRange[1] - options.widthRange[0])
    quaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2)
    position.set(x, mammothPalaeoenvironmentGroundY(x, z) + 0.008, z)
    scale.set(width * (0.86 + random() * 0.28), height, width)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(placed, matrix)

    colour
      .set(options.colours[Math.floor(random() * options.colours.length)] ?? '#82764b')
      .offsetHSL(0, (random() - 0.5) * 0.04, (random() - 0.5) * 0.05)
    mesh.setColorAt(placed, colour)
    placed += 1
  }

  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}

function populateSteppe(nearGround: Group, midSteppe: Group): {
  readonly dwarfWillow: number
  readonly forb: number
  readonly grassAndSedge: number
  readonly rockAndHummock: number
} {
  const grassGeometry = createGrassTuftGeometry()
  const grassMaterial = createGrassCutoutMaterial()
  const nearGrass = createSteppeInstances({
    castShadow: false,
    clusterStrength: 0.66,
    colours: ['#a39778', '#899274', '#a28d69', '#7d896c'],
    corridorClearance: 1.9,
    count: 210,
    geometry: grassGeometry,
    heightRange: [0.11, 0.24],
    material: grassMaterial,
    maximumDistance: 48,
    minimumDistance: 3.5,
    name: 'glacier-near-grass-and-sedge',
    seed: 0x17a22,
    widthRange: [0.3, 0.58],
  })
  const midGrass = createSteppeInstances({
    castShadow: false,
    clusterStrength: 0.72,
    colours: ['#918c70', '#7f886c', '#958466', '#778168'],
    corridorClearance: 3.8,
    count: 350,
    geometry: grassGeometry.clone(),
    heightRange: [0.08, 0.17],
    material: grassMaterial,
    maximumDistance: 106,
    minimumDistance: 35,
    name: 'glacier-mid-grass-and-sedge',
    seed: 0x17a23,
    widthRange: [0.22, 0.42],
  })
  nearGround.add(nearGrass)
  midSteppe.add(midGrass)

  const forbs = createSteppeInstances({
    castShadow: true,
    clusterStrength: 0.78,
    colours: ['#6d6558', '#756c5d', '#68675b', '#5f6258'],
    corridorClearance: 2.2,
    count: 24,
    geometry: createForbGeometry(),
    heightRange: [0.08, 0.18],
    maximumDistance: 54,
    minimumDistance: 6,
    name: 'glacier-near-low-forbs',
    seed: 0x28b31,
    widthRange: [0.3, 0.58],
  })
  nearGround.add(forbs)

  const willows = createSteppeInstances({
    castShadow: false,
    clusterStrength: 0.83,
    colours: ['#596342', '#65704b', '#717750', '#4f5d43'],
    corridorClearance: 4.6,
    count: 42,
    geometry: createDwarfWillowGeometry(),
    heightRange: [0.28, 0.64],
    maximumDistance: 96,
    minimumDistance: 18,
    name: 'glacier-mid-dwarf-willow',
    seed: 0x39c41,
    widthRange: [0.56, 1.02],
  })
  midSteppe.add(willows)

  const rocks = createSteppeInstances({
    castShadow: true,
    clusterStrength: 0.42,
    colours: ['#5f605c', '#6d675d', '#575d5c', '#756b5c'],
    corridorClearance: 3.2,
    count: 46,
    geometry: createRockGeometry(),
    heightRange: [0.12, 0.36],
    maximumDistance: 68,
    minimumDistance: 8,
    name: 'glacier-near-rock-and-loess-hummock',
    seed: 0x4ad52,
    widthRange: [0.36, 0.8],
  })
  nearGround.add(rocks)

  const moraineRocks = createSteppeInstances({
    castShadow: false,
    clusterStrength: 0.48,
    colours: ['#666966', '#77736a', '#5f6665', '#81796b'],
    corridorClearance: 5,
    count: 28,
    geometry: createRockGeometry(),
    heightRange: [0.3, 0.82],
    maximumDistance: 82,
    minimumDistance: 36,
    name: 'glacier-midground-moraine-stone',
    seed: 0x72bc4,
    widthRange: [0.75, 1.65],
  })
  midSteppe.add(moraineRocks)

  return {
    dwarfWillow: willows.count,
    forb: forbs.count,
    grassAndSedge: nearGrass.count + midGrass.count,
    rockAndHummock: rocks.count + moraineRocks.count,
  }
}

function foothillHeight(x: number, z: number): number {
  const distance = Math.hypot(x, z)
  const rise = smoothstep(80, 108, distance)
  const outerTaper = 1 - smoothstep(142, 178, distance)
  const reliefEnvelope = rise * outerTaper
  const angle = Math.atan2(z, x)
  const moundSignal =
    Math.sin(angle * 3.1 + 0.4) * 0.45 +
    Math.cos(angle * 5.3 - 0.7) * 0.34 +
    Math.sin(angle * 9.7 + 1.1) * 0.21
  const mound = smoothstep(-0.22, 0.62, moundSignal)
  const localVariation =
    Math.sin(x * 0.037 + z * 0.022) * 0.18 +
    Math.cos(x * 0.061 - z * 0.029) * 0.12
  return (
    mammothPalaeoenvironmentGroundY(x, z) +
    0.03 +
    reliefEnvelope * (0.28 + mound * 0.72) * (1.12 + localVariation)
  )
}

function createFoothillGeometry(): BufferGeometry {
  const angleSegments = 192
  const radialSegments = 20
  const radiusMinimum = 76
  const radiusMaximum = 180
  const vertices: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const low = new Color('#686c68')
  const high = new Color('#868b86')
  const snow = new Color('#b7c5c4')
  const colour = new Color()

  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
    const radialFraction = radialIndex / radialSegments
    const radius =
      radiusMinimum + (radiusMaximum - radiusMinimum) * radialFraction
    for (let angleIndex = 0; angleIndex <= angleSegments; angleIndex += 1) {
      const angle = (angleIndex / angleSegments) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = foothillHeight(x, z)
      const relief = y - mammothPalaeoenvironmentGroundY(x, z)
      const surfaceVariation =
        Math.sin(x * 0.094 + z * 0.057) * 0.5 +
        Math.cos(x * 0.041 - z * 0.083) * 0.5
      const exposedSnow =
        smoothstep(0.72, 1.22, relief) *
        smoothstep(-0.12, 0.58, surfaceVariation)
      const windPackedSnow =
        smoothstep(0.08, 0.62, surfaceVariation) *
        smoothstep(88, 116, radius) *
        (1 - smoothstep(150, 178, radius))
      colour
        .copy(low)
        .lerp(high, smoothstep(0.22, 1.18, relief) * 0.48)
        .lerp(
          snow,
          Math.min(0.24, exposedSnow * 0.18 + windPackedSnow * 0.14),
        )
        .offsetHSL(0, 0, surfaceVariation * 0.018)
      vertices.push(x, y, z)
      colours.push(colour.r, colour.g, colour.b)
    }
  }

  const stride = angleSegments + 1
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
    for (let angleIndex = 0; angleIndex < angleSegments; angleIndex += 1) {
      const offset = radialIndex * stride + angleIndex
      indices.push(
        offset,
        offset + stride,
        offset + 1,
        offset + 1,
        offset + stride,
        offset + stride + 1,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

interface FarLandformPrototypeLayers {
  readonly foothills: Mesh<BufferGeometry, MeshBasicMaterial>
  readonly frozenValleyChannel: Mesh<BufferGeometry, MeshStandardMaterial>
  readonly haze: Mesh<PlaneGeometry, ShaderMaterial>
  readonly middleRidge: Mesh<BufferGeometry, ShaderMaterial>
}

function middleRidgeHeight(x: number, z: number): number {
  const depthEnvelope = Math.exp(-Math.pow((z + 105) / 28, 2))
  const westernRise = Math.exp(-Math.pow((x + 118) / 24, 2)) * 4.2
  const centralRise = Math.exp(-Math.pow((x + 34) / 28, 2)) * 5.2
  const easternRise = Math.exp(-Math.pow((x - 54) / 22, 2)) * 3.8
  const distantRise = Math.exp(-Math.pow((x - 128) / 27, 2)) * 4.6
  const rollingRelief =
    Math.sin(x * 0.049 + z * 0.034) * 0.62 +
    Math.cos(x * 0.091 - z * 0.057) * 0.38
  const isolatedMound = Math.max(
    westernRise,
    centralRise,
    easternRise,
    distantRise,
  )
  return (
    mammothPalaeoenvironmentGroundY(x, z) +
    depthEnvelope * Math.max(0, isolatedMound - 0.95 + rollingRelief * 0.25)
  )
}

function createMiddleRidgeGeometry(): BufferGeometry {
  const xSegments = 144
  const zSegments = 24
  const xMinimum = -240
  const xMaximum = 240
  const zMinimum = -148
  const zMaximum = -66
  const vertices: number[] = []
  const colours: number[] = []
  const reliefs: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const frozenSoil = new Color('#82979d')
  const litSoil = new Color('#afc0c4')
  const windSnow = new Color('#f3f7f5')
  const colour = new Color()

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const zFraction = zIndex / zSegments
    const z = zMinimum + (zMaximum - zMinimum) * zFraction
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const xFraction = xIndex / xSegments
      const x = xMinimum + (xMaximum - xMinimum) * xFraction
      const y = middleRidgeHeight(x, z)
      const localGround = mammothPalaeoenvironmentGroundY(x, z)
      const relief = Math.max(0, y - localGround)
      const faceLight = smoothstep(
        -0.7,
        0.7,
        Math.sin(x * 0.052 + z * 0.034) * 0.7 +
          Math.cos(x * 0.021 - z * 0.057) * 0.3,
      )
      const snowBreakup = smoothstep(
        0.32,
        0.88,
        0.5 + 0.5 * Math.sin(x * 0.083 - z * 0.047 + relief * 0.8),
      )
      const snowCover =
        smoothstep(1.25, 3.65, relief) *
        (0.38 + snowBreakup * 0.62) *
        0.78
      colour
        .copy(frozenSoil)
        .lerp(litSoil, 0.18 + faceLight * 0.46)
        .lerp(windSnow, snowCover)
      vertices.push(x, y, z)
      colours.push(colour.r, colour.g, colour.b)
      reliefs.push(relief)
      uvs.push(xFraction, zFraction)
    }
  }

  const stride = xSegments + 1
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const offset = zIndex * stride + xIndex
      indices.push(
        offset,
        offset + stride,
        offset + 1,
        offset + 1,
        offset + stride,
        offset + stride + 1,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setAttribute('relief', new BufferAttribute(new Float32Array(reliefs), 1))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createMiddleRidgeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    depthWrite: true,
    fog: true,
    transparent: true,
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexColors: true,
    vertexShader: /* glsl */ `
      attribute float relief;
      varying vec3 vColour;
      varying float vRelief;
      varying vec3 vWorldPosition;
      #include <fog_pars_vertex>
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 mvPosition = viewMatrix * worldPosition;
        vColour = color;
        vRelief = relief;
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColour;
      varying float vRelief;
      varying vec3 vWorldPosition;
      #include <fog_pars_fragment>
      void main() {
        float textureSignal =
          sin(vWorldPosition.x * 0.31 + vWorldPosition.z * 0.19) * 0.5 +
          cos(vWorldPosition.x * 0.13 - vWorldPosition.z * 0.37) * 0.3 +
          sin(vWorldPosition.x * 0.67 + vWorldPosition.z * 0.43) * 0.2;
        float alpha = smoothstep(0.08, 0.72, vRelief);
        alpha *= 0.9 + textureSignal * 0.1;
        if (alpha < 0.035) discard;
        vec3 colour = vColour * (0.92 + textureSignal * 0.075);
        gl_FragColor = vec4(colour, alpha);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

function createFrozenValleyChannel(): Mesh<BufferGeometry, MeshStandardMaterial> {
  const segments = 72
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const pointAt = (fraction: number) => {
    const z = -16 - fraction * 136
    const x = -28 - fraction * 25 + Math.sin(fraction * 7.4) * 8
    return { x, z }
  }

  for (let index = 0; index <= segments; index += 1) {
    const fraction = index / segments
    const point = pointAt(fraction)
    const ahead = pointAt(Math.min(1, fraction + 1 / segments))
    const behind = pointAt(Math.max(0, fraction - 1 / segments))
    const tangentX = ahead.x - behind.x
    const tangentZ = ahead.z - behind.z
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ))
    const perpendicularX = -tangentZ / tangentLength
    const perpendicularZ = tangentX / tangentLength
    const endTaper =
      smoothstep(0, 0.14, fraction) *
      (1 - smoothstep(0.88, 1, fraction))
    const halfWidth =
      (8 + fraction * 6 + Math.sin(fraction * Math.PI * 3) * 1.1) *
      Math.max(0.08, endTaper)
    for (const side of [-1, 1] as const) {
      const x = point.x + perpendicularX * halfWidth * side
      const z = point.z + perpendicularZ * halfWidth * side
      vertices.push(
        x,
        mammothPalaeoenvironmentGroundY(x, z) + 0.14,
        z,
      )
      uvs.push(side < 0 ? 0 : 1, fraction * 5)
    }
  }

  for (let index = 0; index < segments; index += 1) {
    const offset = index * 2
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset + 1,
      offset + 3,
      offset + 2,
    )
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const channel = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: '#8dbec8',
      depthWrite: false,
      emissive: '#29474e',
      emissiveIntensity: 0.08,
      metalness: 0.04,
      opacity: 0.74,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.32,
      side: DoubleSide,
      transparent: true,
    }),
  )
  channel.name = 'glacier-middle-distance-frozen-valley-channel'
  channel.receiveShadow = true
  channel.renderOrder = 1
  channel.visible = false
  return channel
}

function createFarLandform(farLandform: Group): FarLandformPrototypeLayers {
  const foothills = new Mesh(
    createFoothillGeometry(),
    new MeshBasicMaterial({
      color: '#ffffff',
      fog: true,
      vertexColors: true,
    }),
  )
  foothills.name = 'glacier-far-unglaciated-valley-terrace'
  foothills.receiveShadow = true
  foothills.visible = true
  farLandform.add(foothills)

  const middleRidge = new Mesh(
    createMiddleRidgeGeometry(),
    createMiddleRidgeMaterial(),
  )
  middleRidge.name = 'glacier-middle-distance-frozen-foothills'
  middleRidge.receiveShadow = false
  middleRidge.visible = false
  farLandform.add(middleRidge)

  const frozenValleyChannel = createFrozenValleyChannel()
  farLandform.add(frozenValleyChannel)

  const haze = createHorizonVeil(
    'glacier-far-valley-haze',
    480,
    26,
    0.055,
  )
  haze.position.set(0, 7, -128)
  haze.renderOrder = -2
  // A faint air layer hides the geometric meeting line between the local
  // terrain and the photographic valley, while leaving the ridge itself
  // readable. This is the middle step in the near / middle / far progression.
  haze.visible = true
  farLandform.add(haze)
  return { foothills, frozenValleyChannel, haze, middleRidge }
}

function addAtmosphere(atmosphere: Group): void {
  const nearVeil = createHorizonVeil(
    'glacier-atmosphere-veil-1',
    420,
    24,
    0.026,
  )
  nearVeil.position.set(0, 9, -92)
  nearVeil.renderOrder = -1
  nearVeil.visible = true

  const farVeil = createHorizonVeil(
    'glacier-atmosphere-veil-2',
    500,
    38,
    0.035,
  )
  farVeil.position.set(0, 14, -169)
  farVeil.renderOrder = -3
  farVeil.visible = true
  atmosphere.add(nearVeil, farVeil)
}

function addWorldLighting(background: Group): void {
  const hemisphere = new HemisphereLight('#d5e3eb', '#b9c7d0', 2.65)
  hemisphere.name = 'glacier-world-hemisphere-light'

  const sun = new DirectionalLight('#ffe5bd', 3.8)
  sun.name = 'glacier-world-sun'
  sun.position.copy(WORLD_SUN_DIRECTION).multiplyScalar(86)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -34
  sun.shadow.camera.right = 34
  sun.shadow.camera.top = 28
  sun.shadow.camera.bottom = -28
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 180
  sun.shadow.bias = -0.0001
  sun.shadow.normalBias = 0.025

  const skyFill = new DirectionalLight('#c6e0ed', 2.1)
  skyFill.name = 'glacier-world-sky-fill'
  skyFill.position.set(38, 28, -26)
  skyFill.castShadow = false

  const subjectFill = new DirectionalLight('#f2d5ad', 1.28)
  subjectFill.name = 'glacier-world-subject-fill'
  subjectFill.position.set(-26, 20, 34)
  subjectFill.target.position.set(-2, 2, 0)
  subjectFill.castShadow = false

  background.add(
    hemisphere,
    sun,
    sun.target,
    skyFill,
    skyFill.target,
    subjectFill,
    subjectFill.target,
  )
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

function materialTextures(material: Material): Texture[] {
  const textures = Object.values(material).filter(
    (value): value is Texture => value instanceof Texture,
  )
  if (material instanceof ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value: unknown = uniform.value
      if (value instanceof Texture) textures.push(value as Texture<unknown>)
    }
  }
  return textures
}

function estimateVisibleResources(
  root: Object3D,
): MammothPalaeoenvironmentResourceEstimate {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
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
      materialTextures(material).forEach((texture) => textures.add(texture))
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
    textures: textures.size,
    transparentDrawCalls,
    triangles,
  }
}

function disposeRoot(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if (!isEnvironmentMesh(object)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    objectMaterials.forEach((material) => {
      materials.add(material)
      materialTextures(material).forEach((texture) => textures.add(texture))
    })
  })
  textures.forEach((texture) => texture.dispose())
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  root.clear()
}

export function createMammothPalaeoenvironmentProductionCandidate(
  initialVariant: MammothPalaeoenvironmentVariant = 'C',
  initialSurfaceState: MammothPalaeoenvironmentSurfaceState = 'balanced',
): MammothPalaeoenvironmentCandidate {
  const root = new Group()
  root.name = 'scale-encounter-glacier-palaeoenvironment-production-candidate'
  root.userData.mammothPalaeoenvironmentProductionCandidate = {
    candidateId: MAMMOTH_PALAEOENVIRONMENT_PRODUCTION_CANDIDATE_ID,
    reconstructionType: MAMMOTH_PALAEOENVIRONMENT_ANCHOR.reconstructionType,
    visualSystem: 'mammoth-background-architecture-prototype-v8',
  }

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

  const skyDome = createSkyDome()
  background.add(skyDome.mesh)
  const farBackground = createFarBackground(background, farIceMass)
  addWorldLighting(background)
  const ground = createGroundSurface()
  groundSurface.add(ground)
  const snow = createSnowLayer()
  snowLayer.add(snow.nearDrifts, snow.frozenCrusts)
  snowLayer.userData.persistentAcrossCameraStages = true
  const vegetationCounts = populateSteppe(nearGround, midSteppe)
  const farLandformLayers = createFarLandform(farLandform)
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
  const photographicFog = new FogExp2('#969a92', 0.00265)
  const layeredDepthFog = new Fog('#c2d4dc', 105, 330)

  const applyVariant = () => {
    const photographicBaseline = variant === 'A'
    const geometricBackground = variant === 'B' || variant === 'C'
    const layeredDepth = variant === 'C'

    // Keep the subjects and near ground identical across A, B and C. The
    // increased foreground snow is a shared scene correction, while the
    // switcher continues to isolate only the background architecture.
    groundSurface.visible = true
    snowLayer.visible = true
    nearGround.visible = true
    midSteppe.visible = true

    skyDome.setPhotographicBackground(photographicBaseline)
    const skyPalette = layeredDepth
      ? {
          horizon: '#c9dfe7',
          lower: '#dce8e9',
          zenith: '#78a9c8',
        }
      : {
          horizon: '#adc3cf',
          lower: '#879c9f',
          zenith: '#5d86a4',
        }
    const skyUniforms = skyDome.mesh.material.uniforms
    if (skyUniforms.horizonColour?.value instanceof Color) {
      skyUniforms.horizonColour.value.set(skyPalette.horizon)
    }
    if (skyUniforms.lowerColour?.value instanceof Color) {
      skyUniforms.lowerColour.value.set(skyPalette.lower)
    }
    if (skyUniforms.zenithColour?.value instanceof Color) {
      skyUniforms.zenithColour.value.set(skyPalette.zenith)
    }
    farBackground.rearMountainRange.visible = geometricBackground
    farBackground.mountainRange.visible = geometricBackground
    farBackground.frontMountainRange.visible = geometricBackground
    farBackground.ice.visible = geometricBackground
    farBackground.horizonHaze.visible = geometricBackground
    const mountainPalette = layeredDepth
      ? MOUNTAIN_RANGE_PALETTES.C
      : MOUNTAIN_RANGE_PALETTES.B
    applyMountainRangeMaterialOptions(
      farBackground.rearMountainRange.material,
      mountainPalette.rear,
    )
    applyMountainRangeMaterialOptions(
      farBackground.mountainRange.material,
      mountainPalette.centre,
    )
    applyMountainRangeMaterialOptions(
      farBackground.frontMountainRange.material,
      mountainPalette.front,
    )
    const horizonHazeColour =
      farBackground.horizonHaze.material.uniforms.colour
    if (horizonHazeColour?.value instanceof Color) {
      horizonHazeColour.value.set(layeredDepth ? '#d4e1e5' : '#b7bbae')
    }
    const horizonHazeOpacity =
      farBackground.horizonHaze.material.uniforms.opacity
    if (horizonHazeOpacity) {
      horizonHazeOpacity.value = layeredDepth ? 0.12 : 0.055
    }

    // A retains the old one-metre valley terrace. B intentionally stops at
    // the mountain system. C inserts discrete snow-covered moraine mounds and
    // a blue frozen-valley channel, so its middle distance is visibly unlike
    // both the foreground soil and the mountain wall.
    farLandform.visible = photographicBaseline || layeredDepth
    farLandformLayers.foothills.visible = photographicBaseline
    farLandformLayers.foothills.scale.y = 1
    farLandformLayers.middleRidge.visible = layeredDepth
    farLandformLayers.frozenValleyChannel.visible = layeredDepth
    farLandformLayers.haze.position.y = layeredDepth ? 6 : 7
    farLandformLayers.haze.position.z = layeredDepth ? -58 : -128
    farLandformLayers.haze.visible = photographicBaseline || layeredDepth
    const valleyHazeOpacity = farLandformLayers.haze.material.uniforms.opacity
    if (valleyHazeOpacity) {
      valleyHazeOpacity.value = photographicBaseline
        ? 0.055
        : layeredDepth
          ? 0.075
          : 0
    }
    const valleyHazeColour = farLandformLayers.haze.material.uniforms.colour
    if (valleyHazeColour?.value instanceof Color) {
      valleyHazeColour.value.set(
        layeredDepth ? '#ccdde2' : '#b7bbae',
      )
    }
    atmosphere.children.forEach((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof ShaderMaterial)) {
        return
      }
      const colour = child.material.uniforms.colour
      if (colour?.value instanceof Color) {
        colour.value.set('#c9dbe1')
      }
    })
    atmosphere.visible = layeredDepth
  }

  const applySurfaceState = () => {
    const state = SURFACE_STATE[surfaceState]
    const groundMaterial = ground.material
    const frostUniform = groundMaterial.userData.mammothFrostBlend as
      | { value: number }
      | undefined
    if (frostUniform) frostUniform.value = state.frostBlend
    snow.nearDrifts.count = state.patchCount
    snow.nearDrifts.instanceMatrix.needsUpdate = true
    snow.frozenCrusts.count = state.crustCount
    snow.frozenCrusts.instanceMatrix.needsUpdate = true
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
        snowPatches: SURFACE_STATE[surfaceState].patchCount,
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
    fog: () =>
      variant === 'A'
        ? photographicFog
        : variant === 'B'
          ? null
          : layeredDepthFog,
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
        child.position.x = Math.sin(elapsedSeconds * 0.018 + index * 2.4) * 0.9
      })
    },
  }
}
