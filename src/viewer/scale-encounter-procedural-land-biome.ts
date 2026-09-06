import { createRiverWater, type RiverWater } from './scale-encounter-river-water'
import { applyAcceptedForestFarFieldCompression } from '../scale-encounter/environments/forest/accepted-forest-basin'
import { applyAuthoredGroundMaterial } from './scale-encounter-authored-ground'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three'
import type { ScaleEncounterPreparedLandBiome } from '../scale-encounter/environments/land-biomes/types'
import { scaleEncounterEcologyCount } from './scale-encounter-ecology-density'
import { applyScaleEncounterLandBiomeGroundMaterial } from './scale-encounter-land-biome-ground-material'
import { createScaleEncounterProductionFarDepth } from './scale-encounter-production-far-depth'
import { createScaleEncounterProductionMidground } from './scale-encounter-production-midground'
import type {
  ScaleEncounterEnvironment,
  ScaleEncounterEnvironmentOptions,
  ScaleEncounterEnvironmentVariant,
} from './scale-encounter-environment'

const BIOME_RADIUS_METERS = 360
const SUBJECT_CLEARING_RADIUS_METERS = 24

const CARBONIFEROUS_WETLAND_POOLS = [
  { depth: 3.4, width: 5.8, x: 3.5, y: -0.1, yaw: -0.28, z: -8.5 },
  { depth: 2.6, width: 4.2, x: -5.5, y: -0.14, yaw: 0.2, z: -12 },
  { depth: 2.8, width: 4.8, x: 8.5, y: -0.12, yaw: 0.48, z: -14 },
] as const

type RandomSource = () => number
type HeightSampler = (x: number, z: number) => number

function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function channelCentreX(
  profile: ScaleEncounterPreparedLandBiome['profile'],
  z: number,
): number {
  if (profile === 'kayenta-seasonal-floodplain') {
    return -38 + Math.sin(z * 0.026 + 0.6) * 18 + Math.sin(z * 0.067) * 5
  }
  return 34 + Math.sin(z * 0.024 - 0.4) * 14 + Math.cos(z * 0.061) * 3.8
}

function channelHalfWidth(
  profile: ScaleEncounterPreparedLandBiome['profile'],
  longitudinal: number,
): number {
  if (profile === 'kayenta-seasonal-floodplain') {
    const bendPool = Math.exp(-(((longitudinal + 16) / 18) ** 2))
    return 7 + bendPool * 5.4 + Math.sin(longitudinal * 0.067 + 0.6) ** 2 * 1.4
  }
  if (profile === 'gobi-braided-basin') {
    return 7.5 + 3.6 * Math.exp(-(((longitudinal + 18) / 24) ** 2))
  }
  return 5.5 + (Math.cos(longitudinal * 0.043) + 1) * 2.4
}

/**
 * The Kayenta reach crosses the comparison view instead of running straight
 * away from the camera.  Keeping it in world space makes the two banks,
 * point bars and reflected sky legible at child-eye height; the former
 * longitudinal ribbon collapsed into a thin artificial line in overview.
 */
function floodplainRiverCentreZ(x: number): number {
  return -18 + Math.tanh(x / 18) * 10 + Math.sin(x * 0.06 + 0.4) * 3
}

function gobiRiverCentreZ(x: number): number {
  return -16 + 32 * Math.exp(-(((x + 22) / 6) ** 2))
    + 5 * Math.exp(-(((x - 24) / 20) ** 2))
}

function channelCoordinates(
  profile: ScaleEncounterPreparedLandBiome['profile'],
  longitudinal: number,
  lateral = 0,
): Readonly<{ x: number; z: number }> {
  if (profile !== 'carboniferous-coal-swamp') {
    return {
      x: longitudinal,
      z: (profile === 'gobi-braided-basin' ? gobiRiverCentreZ(longitudinal) : floodplainRiverCentreZ(longitudinal)) + lateral,
    }
  }
  return {
    x: channelCentreX(profile, longitudinal) + lateral,
    z: longitudinal,
  }
}

function channelDistanceAt(
  profile: ScaleEncounterPreparedLandBiome['profile'],
  x: number,
  z: number,
): number {
  return profile === 'kayenta-seasonal-floodplain'
    ? Math.abs(z - floodplainRiverCentreZ(x))
    : profile === 'gobi-braided-basin'
      ? Math.abs(z - gobiRiverCentreZ(x))
    : Math.abs(x - channelCentreX(profile, z))
}

function wetlandPoolInfluenceAt(x: number, z: number): number {
  let strongest = 0
  CARBONIFEROUS_WETLAND_POOLS.forEach((pool) => {
    const dx = x - pool.x
    const dz = z - pool.z
    const cosine = Math.cos(pool.yaw)
    const sine = Math.sin(pool.yaw)
    const localX = dx * cosine + dz * sine
    const localZ = -dx * sine + dz * cosine
    const influence = Math.exp(
      -(
        (localX / (pool.width * 0.88)) ** 2 * 1.75 +
        (localZ / (pool.depth * 0.88)) ** 2 * 1.75
      ),
    )
    strongest = Math.max(strongest, influence)
  })
  return strongest < 0.015 ? 0 : strongest
}

function createHeightSampler(
  biome: ScaleEncounterPreparedLandBiome,
): HeightSampler {
  return (x, z) => {
    const radius = Math.hypot(x, z)
    const clearing = smoothstep(
      SUBJECT_CLEARING_RADIUS_METERS,
      SUBJECT_CLEARING_RADIUS_METERS + 32,
      radius,
    )
    const broadNoise =
      Math.sin(x * 0.021 + biome.seed * 0.00001) * 0.46 +
      Math.cos(z * 0.018 - biome.seed * 0.000013) * 0.38 +
      Math.sin((x + z) * 0.052) * 0.17

    if (biome.profile === 'gobi-braided-basin') {
      const angle = Math.atan2(z, x)
      // As in the accepted forest, distant depth is a continuous world-space
      // basin. These low eroded benches replace the isolated flat-topped mesa
      // primitives that read as blocks from the overview camera.
      const outerRise = smoothstep(138, 326, radius) *
        Math.max(
          1.2,
          5.4 +
            Math.sin(angle * 3 + 0.4) * 2.25 +
            Math.sin(angle * 7 - 0.9) * 1.05 +
            Math.cos(radius * 0.037 + angle * 4) * 1.15,
        )
      const erodedShoulder =
        Math.exp(
          -Math.pow(
            (radius - (238 + Math.sin(angle * 4) * 21)) / 54,
            2,
          ),
        ) *
        (2.2 + Math.sin(angle * 9 + 0.8) * 0.8)
      const gravelTerraces =
        Math.sin(x * 0.012 - z * 0.019) * 0.38 +
        Math.cos(x * 0.047 + z * 0.024) * 0.16
      const channel = (1 - smoothstep(0.25, 1,
        channelDistanceAt(biome.profile, x, z) / (channelHalfWidth(biome.profile, x) + 2),
      )) * smoothstep(3, 7, radius)
      const terrace = clearing * (0.45 + broadNoise * 0.22 + gravelTerraces * 0.5 + outerRise + erodedShoulder)
      return terrace * (1 - channel) - 0.68 * channel
    }

    if (biome.profile === 'kayenta-seasonal-floodplain') {
      const channelDistance = channelDistanceAt(biome.profile, x, z)
      const channel = 1 - smoothstep(0.35, 1,
        channelDistance / (channelHalfWidth(biome.profile, x) + 2.5),
      )
      const overbank = Math.sin(z * 0.038 + x * 0.009) * 0.34
      const angle = Math.atan2(z, x)
      const outerBench = smoothstep(112, 318, radius) *
        (
          3.2 +
          Math.sin(angle * 4 - 0.3) * 1.25 +
          Math.cos(angle * 9 + radius * 0.025) * 0.55
        )
      return (
        // The overbank terrace stays above the stream. Carve the channel
        // into it, so a distant low patch cannot leave an open water edge.
        clearing * (0.95 + broadNoise * 0.58 + overbank + outerBench) * (1 - channel) -
        // Water is at -0.18 m: a -0.68 m bed limits wading depth to 0.5 m.
        channel * 0.68 * smoothstep(3, 8, radius)
      )
    }

    const wetlandPool = wetlandPoolInfluenceAt(x, z)
    const hummocks =
      Math.sin(x * 0.09) * Math.cos(z * 0.075) * 0.15 + broadNoise * 0.2
    return clearing * hummocks - wetlandPool * 0.76
  }
}

function terrainColourAt(
  biome: ScaleEncounterPreparedLandBiome,
  x: number,
  z: number,
  height: number,
  result: Color,
): Color {
  const dark = new Color(biome.palette.groundDark)
  const mid = new Color(biome.palette.groundMid)
  const light = new Color(biome.palette.groundLight)
  const radius = Math.hypot(x, z)
  const grain = (Math.sin(x * 0.31) + Math.cos(z * 0.27) + 2) * 0.08
  result.copy(mid).lerp(light, Math.min(0.72, 0.2 + grain + Math.max(height, 0) * 0.035))

  if (biome.profile === 'gobi-braided-basin') {
    const swale = Math.abs(z - (-36 + Math.sin(x * 0.017) * 19))
    if (swale < 17) result.lerp(dark, (1 - swale / 17) * 0.28)
  } else if (biome.profile === 'kayenta-seasonal-floodplain') {
    const channel = channelDistanceAt(biome.profile, x, z)
    const longitudinal = x
    const width = channelHalfWidth(biome.profile, longitudinal) + 3.5
    if (channel < width) result.lerp(dark, (1 - channel / width) * 0.68)
  }
  if (biome.profile === 'carboniferous-coal-swamp') {
    result.lerp(
      dark,
      0.28 +
        wetlandPoolInfluenceAt(x, z) * 0.46 +
        Math.min(radius / BIOME_RADIUS_METERS, 1) * 0.12,
    )
  }
  return result
}

function createTerrain(
  biome: ScaleEncounterPreparedLandBiome,
  heightAtWorld: HeightSampler,
  maxAnisotropy: number,
  surfaceTextures: ScaleEncounterEnvironmentOptions['surfaceTextures'],
): Mesh {
  // Narrow river cuts and small swamp pools must be resolved by the terrain
  // itself. The old 7.5 m grid skipped across them, exposing water as isolated
  // triangles and straight chords. These selected-theme-only meshes stay well
  // inside the existing runtime budget while giving every bank several rows
  // of actual world-space geometry.
  const terrainSegments = 224
  const geometry = new PlaneGeometry(
    BIOME_RADIUS_METERS * 2,
    BIOME_RADIUS_METERS * 2,
    terrainSegments,
    terrainSegments,
  )
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute('position')
  if (biome.profile !== 'carboniferous-coal-swamp') {
    // Concentrate the existing grid in the first 90 metres to resolve the
    // river cut and nearby banks, without adding a second overlapping floor.
    for (let i = 0; i < positions.count; i += 1) {
      const refine = (v: number) => Math.sign(v) * 360 * (Math.abs(v) / 360) ** 1.65
      positions.setX(i, refine(positions.getX(i)))
      positions.setZ(i, refine(positions.getZ(i)))
    }
  }
  const colours = new Float32Array(positions.count * 3)
  const colour = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    const height = heightAtWorld(x, z)
    positions.setY(index, height)
    terrainColourAt(biome, x, z, height, colour).toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const groundDetail = surfaceTextures?.albedo ?? createGroundDetailTexture(biome)
  const anisotropy = Math.min(Math.max(maxAnisotropy, 1), 8)
  const detailTextures = surfaceTextures
    ? [surfaceTextures.albedo, surfaceTextures.normal, surfaceTextures.roughness]
    : [groundDetail]
  detailTextures.forEach((texture) => {
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    // World-space stochastic sampling supplies the physical scale. Leaving the
    // texture transform neutral also prevents the old 90-by-90 square grid
    // from leaking into the material through Three's default UV path.
    texture.repeat.set(1, 1)
    texture.anisotropy = anisotropy
    texture.needsUpdate = true
  })
  const material = new MeshStandardMaterial({
    color: biome.profile === 'gobi-braided-basin' ? '#b6aaa1' : '#ffffff',
    emissive:
      biome.profile === 'carboniferous-coal-swamp' ? '#405146' : '#000000',
    emissiveIntensity:
      biome.profile === 'carboniferous-coal-swamp' ? 0.31 : 0,
    map: groundDetail,
    metalness: 0,
    normalMap: surfaceTextures?.normal ?? null,
    normalScale: surfaceTextures
      ? new Vector2(
          biome.profile === 'carboniferous-coal-swamp' ? 0.16 : 0.2,
          biome.profile === 'carboniferous-coal-swamp' ? 0.16 : 0.2,
        )
      : new Vector2(1, 1),
    roughness: biome.profile === 'carboniferous-coal-swamp' ? 0.89 : 0.98,
    roughnessMap: surfaceTextures?.roughness ?? null,
    vertexColors: !surfaceTextures,
  })
  if (surfaceTextures?.uniqueAlbedo) {
    applyAuthoredGroundMaterial(material, {
      colourMap: surfaceTextures.uniqueAlbedo,
      widthMeters: 144,
      detailMeters: 1.7,
      farColour: biome.palette.groundMid,
      grainStrength: 0.65,
      colourMipLevel: 6,
    })
    if (biome.profile !== 'carboniferous-coal-swamp') {
      const compile = material.onBeforeCompile.bind(material)
      material.onBeforeCompile = (shader, renderer) => {
        compile(shader, renderer)
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float bankWetness = 1.0 - smoothstep(-.18, .10, vAuthoredGroundWorld.y);
diffuseColor.rgb *= 1.0 - bankWetness * .3;`)
      }
      material.customProgramCacheKey = () => `${biome.themeId}-authored-bank-v4`
    }
  } else if (surfaceTextures) {
    applyScaleEncounterLandBiomeGroundMaterial(material, {
      darkTint: biome.palette.groundDark,
      lightTint: biome.palette.groundLight,
      macroVariationStrength:
        biome.profile === 'gobi-braided-basin'
          ? 0.2
          : biome.profile === 'carboniferous-coal-swamp'
            ? 0.11
            : 0.16,
      normalFadeEndMeters: 210,
      normalFadeStartMeters: 78,
      physicalWidthMeters: surfaceTextures.physicalWidthMeters,
      stochasticCellSizeMeters:
        surfaceTextures.physicalWidthMeters * 4.75,
    })
  }
  const terrain = new Mesh(geometry, material)
  terrain.name = `scale-encounter-${biome.themeId}-terrain`
  terrain.receiveShadow = true
  return terrain
}

function createGroundDetailTexture(
  biome: ScaleEncounterPreparedLandBiome,
): DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size
      const fine =
        Math.sin(u * Math.PI * 2 * 19 + biome.seed * 0.001) * 5 +
        Math.cos(v * Math.PI * 2 * 23 - biome.seed * 0.0013) * 4 +
        Math.sin((u + v) * Math.PI * 2 * 31) * 3
      const broad =
        Math.sin(u * Math.PI * 2 * 4) * 6 +
        Math.cos(v * Math.PI * 2 * 5) * 5
      const hash =
        Math.sin((x * 127.1 + y * 311.7 + biome.seed) * 0.031) * 4
      const profileDarkening =
        biome.profile === 'carboniferous-coal-swamp' ? -7 : 0
      const value = Math.round(
        Math.min(255, Math.max(198, 239 + fine + broad + hash + profileDarkening)),
      )
      const offset = (y * size + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  const repeat =
    biome.profile === 'gobi-braided-basin'
      ? 12
      : biome.profile === 'kayenta-seasonal-floodplain'
        ? 10
        : 8
  texture.repeat.set(repeat, repeat)
  texture.needsUpdate = true
  return texture
}

function createSkyDome(biome: ScaleEncounterPreparedLandBiome): Mesh {
  const geometry = new SphereGeometry(500, 48, 24)
  const positions = geometry.getAttribute('position')
  const colours = new Float32Array(positions.count * 3)
  const top = new Color(biome.palette.skyTop)
  const horizon = new Color(biome.palette.horizon)
  const lower = new Color(biome.palette.fog)
  const colour = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const vertical = positions.getY(index) / 500
    if (vertical >= 0) {
      colour.copy(horizon).lerp(top, smoothstep(-0.02, 0.42, vertical))
    } else {
      colour.copy(horizon).lerp(lower, smoothstep(0, 0.42, -vertical))
    }
    colour.toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({
      depthWrite: false,
      fog: false,
      side: BackSide,
      vertexColors: true,
    }),
  )
  dome.name = `scale-encounter-${biome.themeId}-procedural-sky`
  dome.frustumCulled = false

  const sun = new Mesh(
    new SphereGeometry(8.5, 20, 12),
    new MeshBasicMaterial({
      color: biome.palette.sun,
      depthWrite: false,
      fog: false,
      transparent: true,
      opacity: biome.profile === 'carboniferous-coal-swamp' ? 0.38 : 0.74,
    }),
  )
  const direction = new Vector3(...biome.atmosphere.sunPosition)
    .normalize()
    .multiplyScalar(390)
  sun.position.copy(direction)
  sun.name = `scale-encounter-${biome.themeId}-sun-disc`
  dome.add(sun)
  return dome
}

function createPanoramaDome(
  biome: ScaleEncounterPreparedLandBiome,
  panoramaTexture: Texture,
  maxAnisotropy: number,
): Mesh {
  // Latitude compression otherwise selects an overly soft isotropic mip
  // across the horizon, blurring cliffs and trees into horizontal smears.
  panoramaTexture.anisotropy = Math.min(8, maxAnisotropy)
  panoramaTexture.needsUpdate = true
  const geometry = new SphereGeometry(500, 64, 32)
  geometry.scale(-1, 1, 1)
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
      map: panoramaTexture,
      toneMapped: true,
    }),
  )
  dome.name = `scale-encounter-${biome.themeId}-distant-art-dome`
  dome.frustumCulled = false
  dome.renderOrder = -100
  // Distant art remains on the panorama. The near bank, river and vegetation
  // use geometry and share one world-space ground.
  dome.rotation.y = biome.assets.panoramaYawRadians
  if (biome.profile === 'kayenta-seasonal-floodplain') {
    // This plate contains only sky. Mapping its clear lower sky to the
    // horizon avoids enlarging the old low-resolution painted trees/cliffs.
    const uvs = geometry.getAttribute('uv')
    for (let i = 0; i < uvs.count; i += 1) {
      uvs.setY(i, Math.max(0, (uvs.getY(i) - 0.5) * 2))
    }
    uvs.needsUpdate = true
  } else if (biome.profile === 'gobi-braided-basin') {
    // Reuse the established sky plate behind actual banks and tree colonies.
    // The rejected flat plain photograph no longer represents the near horizon.
    applyAcceptedForestFarFieldCompression(dome)
    dome.scale.y = 0.32
  }
  return dome
}

function createHorizonMistAlphaTexture(): DataTexture {
  const height = 64
  const data = new Uint8Array(height * 4)
  for (let y = 0; y < height; y += 1) {
    const vertical = y / (height - 1)
    const lowerFade = smoothstep(0, 0.24, vertical)
    const upperFade = 1 - smoothstep(0.48, 1, vertical)
    const value = Math.round(lowerFade * upperFade * 255)
    const offset = y * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }
  const texture = new DataTexture(
    data,
    1,
    height,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

function createHorizonMistRing(
  biome: ScaleEncounterPreparedLandBiome,
): Mesh {
  const ring = new Mesh(
    new CylinderGeometry(235, 215, 34, 96, 1, true),
    new MeshBasicMaterial({
      alphaMap: createHorizonMistAlphaTexture(),
      color: biome.palette.fog,
      depthWrite: false,
      fog: false,
      opacity:
        biome.profile === 'gobi-braided-basin'
          ? 0.24
          : biome.profile === 'carboniferous-coal-swamp'
            ? 0.3
            : 0.22,
      side: DoubleSide,
      transparent: true,
    }),
  )
  ring.name = `scale-encounter-${biome.themeId}-horizon-atmosphere`
  ring.position.y = 7
  ring.renderOrder = 3
  return ring
}

function applyInstance(
  mesh: InstancedMesh,
  index: number,
  position: Vector3,
  scale: Vector3,
  yaw: number,
  colour?: Color,
): void {
  const helper = new Object3D()
  helper.position.copy(position)
  helper.rotation.y = yaw
  helper.scale.copy(scale)
  helper.updateMatrix()
  mesh.setMatrixAt(index, helper.matrix)
  if (colour) mesh.setColorAt(index, colour)
}

function finishInstances(mesh: InstancedMesh): InstancedMesh {
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function randomRingPosition(
  random: RandomSource,
  minimumRadius: number,
  maximumRadius: number,
): Vector3 {
  const angle = random() * Math.PI * 2
  const radius = Math.sqrt(
    minimumRadius ** 2 +
      random() * (maximumRadius ** 2 - minimumRadius ** 2),
  )
  return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
}

function randomBiasedRingPosition(
  random: RandomSource,
  minimumRadius: number,
  maximumRadius: number,
  radialPower: number,
): Vector3 {
  const angle = random() * Math.PI * 2
  const radius =
    minimumRadius +
    random() ** radialPower * (maximumRadius - minimumRadius)
  return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
}

type ScannedPropKind = 'branch' | 'fern' | 'log' | 'rock' | 'shrub'

interface ScannedPropRecipe {
  readonly channelBiased?: boolean
  readonly count: number
  readonly kind: ScannedPropKind
  readonly maximumRadius: number
  readonly maximumScale: number
  readonly minimumRadius: number
  readonly minimumScale: number
  readonly templateName: string
}

function scannedPropRecipes(
  biome: ScaleEncounterPreparedLandBiome,
): readonly ScannedPropRecipe[] {
  switch (biome.assets.scannedPropProfile) {
    case 'dry-basin':
      return [
        { count: 72, kind: 'fern', maximumRadius: 64, maximumScale: 2.8, minimumRadius: 14, minimumScale: 1.2, templateName: 'fern_02_a_lod0' },
        { count: 22, kind: 'rock', maximumRadius: 140, maximumScale: 6.2, minimumRadius: 17, minimumScale: 3.1, templateName: 'rock_07_lod0' },
        { count: 19, kind: 'rock', maximumRadius: 150, maximumScale: 10.4, minimumRadius: 23, minimumScale: 5.2, templateName: 'stone_01_lod0' },
        { count: 22, kind: 'branch', maximumRadius: 125, maximumScale: 2.1, minimumRadius: 20, minimumScale: 1.05, templateName: 'dry_branch_a_lod0' },
        { count: 96, kind: 'shrub', maximumRadius: 148, maximumScale: 3.15, minimumRadius: 24, minimumScale: 1.4, templateName: 'shrub_04_a_lod0' },
        { count: 104, kind: 'shrub', maximumRadius: 248, maximumScale: 3.35, minimumRadius: 88, minimumScale: 1.45, templateName: 'shrub_04_c_lod1' },
      ]
    case 'river-margin':
      return [
        { count: 42, kind: 'fern', maximumRadius: 104, maximumScale: 2.8, minimumRadius: 16, minimumScale: 1.25, templateName: 'fern_02_a_lod0' },
        { channelBiased: true, count: 38, kind: 'shrub', maximumRadius: 148, maximumScale: 2.85, minimumRadius: 23, minimumScale: 1.35, templateName: 'shrub_04_b_lod0' },
        { count: 18, kind: 'rock', maximumRadius: 134, maximumScale: 7.1, minimumRadius: 20, minimumScale: 3.3, templateName: 'rock_09_lod0' },
        { count: 10, kind: 'log', maximumRadius: 124, maximumScale: 1.6, minimumRadius: 25, minimumScale: 0.82, templateName: 'dead_tree_trunk_lod0' },
        { count: 17, kind: 'branch', maximumRadius: 130, maximumScale: 1.95, minimumRadius: 19, minimumScale: 0.95, templateName: 'dry_branch_b_lod0' },
        { channelBiased: true, count: 58, kind: 'fern', maximumRadius: 228, maximumScale: 3.4, minimumRadius: 92, minimumScale: 1.55, templateName: 'fern_02_b_lod1' },
        { channelBiased: true, count: 46, kind: 'shrub', maximumRadius: 230, maximumScale: 3.2, minimumRadius: 104, minimumScale: 1.5, templateName: 'shrub_04_d_lod1' },
      ]
    case 'coal-swamp-floor':
      return [
        { count: 142, kind: 'fern', maximumRadius: 86, maximumScale: 2.65, minimumRadius: 10, minimumScale: 1.05, templateName: 'fern_02_c_lod0' },
        { channelBiased: true, count: 112, kind: 'fern', maximumRadius: 158, maximumScale: 2.55, minimumRadius: 16, minimumScale: 1, templateName: 'fern_02_d_lod0' },
        { count: 14, kind: 'log', maximumRadius: 118, maximumScale: 1.65, minimumRadius: 18, minimumScale: 0.78, templateName: 'dead_tree_trunk_02_lod0' },
        { count: 20, kind: 'branch', maximumRadius: 125, maximumScale: 1.9, minimumRadius: 12, minimumScale: 0.9, templateName: 'dry_branch_c_lod0' },
        { count: 16, kind: 'rock', maximumRadius: 116, maximumScale: 6.2, minimumRadius: 17, minimumScale: 2.8, templateName: 'rock_07_lod0' },
        { count: 156, kind: 'fern', maximumRadius: 224, maximumScale: 3, minimumRadius: 64, minimumScale: 1.2, templateName: 'fern_02_a_lod1' },
      ]
  }
}

function borrowMaterialTextures(
  material: Material,
  borrowedTextures: Set<Texture>,
): void {
  Object.values(material).forEach((value) => {
    if (value && typeof value === 'object' && 'isTexture' in value) {
      borrowedTextures.add(value as Texture)
    }
  })
}

function scannedPropTemplate(
  props: Group,
  templateName: string,
): Mesh | null {
  const object = props.getObjectByName(templateName)
  if (!object) return null
  let template: Mesh | null = object instanceof Mesh ? object : null
  object.traverse((child) => {
    if (!template && child instanceof Mesh) template = child
  })
  return template
}

function addScannedGroundProps(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  props: Group,
  borrowedTextures: Set<Texture>,
  heightAtWorld: HeightSampler,
  random: RandomSource,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
): Readonly<Record<ScannedPropKind, number>> {
  const counts: Record<ScannedPropKind, number> = {
    branch: 0,
    fern: 0,
    log: 0,
    rock: 0,
    shrub: 0,
  }
  props.updateMatrixWorld(true)
  const inverseRootMatrix = props.matrixWorld.clone().invert()

  scannedPropRecipes(biome).forEach((recipe) => {
    const template = scannedPropTemplate(props, recipe.templateName)
    if (!template) return
    const count = scaleEncounterEcologyCount(recipe.count, density ?? 'current')
    if (count === 0) return
    template.updateMatrixWorld(true)
    template.geometry.computeBoundingBox()
    const geometryBounds = template.geometry.boundingBox
    if (!geometryBounds) return
    const relativeTemplateMatrix = inverseRootMatrix
      .clone()
      .multiply(template.matrixWorld)
    const relativeBounds = geometryBounds
      .clone()
      .applyMatrix4(relativeTemplateMatrix)
    const sourceMaterials = Array.isArray(template.material)
      ? template.material
      : [template.material]
    sourceMaterials.forEach((material) =>
      borrowMaterialTextures(material, borrowedTextures),
    )
    const materials = sourceMaterials.map((material) => {
      const clone = material.clone()
      if (recipe.kind === 'fern' || recipe.kind === 'shrub') {
        clone.side = DoubleSide
        clone.alphaToCoverage = true
      }
      if (clone instanceof MeshStandardMaterial) {
        clone.metalness = 0
        clone.roughness = Math.max(
          recipe.kind === 'rock' ? 0.82 : 0.88,
          clone.roughness,
        )
      }
      return clone
    })
    const instances = new InstancedMesh(
      template.geometry.clone(),
      Array.isArray(template.material) ? materials : materials[0]!,
      count,
    )
    instances.name =
      `scale-encounter-${biome.themeId}-scanned-${recipe.kind}-${recipe.templateName}`
    const placement = new Object3D()
    const finalMatrix = new Matrix4()
    for (let index = 0; index < count; index += 1) {
      let position = recipe.channelBiased
        ? channelPlantPosition(biome, random, recipe.minimumRadius)
        : biome.profile === 'carboniferous-coal-swamp' &&
            recipe.kind === 'fern'
          ? randomBiasedRingPosition(
              random,
              recipe.minimumRadius,
              recipe.maximumRadius,
              1.72,
            )
          : randomRingPosition(
              random,
              recipe.minimumRadius,
              recipe.maximumRadius,
            )
      if (position.length() > recipe.maximumRadius) {
        position = randomRingPosition(
          random,
          recipe.minimumRadius,
          recipe.maximumRadius,
        )
      }
      const scale =
        recipe.minimumScale +
        random() * (recipe.maximumScale - recipe.minimumScale)
      const burial =
        recipe.kind === 'log'
          ? 0.08 * scale
          : recipe.kind === 'rock'
            ? 0.035 * scale
            : 0.012 * scale
      placement.position.set(
        position.x,
        heightAtWorld(position.x, position.z) -
          relativeBounds.min.y * scale -
          burial,
        position.z,
      )
      placement.rotation.set(0, random() * Math.PI * 2, 0)
      placement.scale.setScalar(scale)
      placement.updateMatrix()
      finalMatrix.multiplyMatrices(placement.matrix, relativeTemplateMatrix)
      instances.setMatrixAt(index, finalMatrix)
    }
    finishInstances(instances)
    instances.castShadow = recipe.kind !== 'fern'
    root.add(instances)
    counts[recipe.kind] += count
  })
  return counts
}

function addGravel(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.gravel,
    density ?? 'current',
  )
  if (count === 0) return 0
  const mesh = new InstancedMesh(
    new SphereGeometry(1, 5, 3),
    new MeshStandardMaterial({
      color: '#ffffff',
      flatShading: true,
      roughness: 1,
    }),
    count,
  )
  mesh.name = `scale-encounter-${biome.themeId}-gravel-batch`
  const dark = new Color(biome.palette.groundDark)
  const light = new Color(biome.palette.groundLight)
  for (let index = 0; index < count; index += 1) {
    const position = randomRingPosition(random, 11, 245)
    const size =
      0.025 +
      random() ** 3 *
        (biome.profile === 'gobi-braided-basin' ? 0.17 : 0.13)
    position.y = heightAtWorld(position.x, position.z) + size * 0.35
    applyInstance(
      mesh,
      index,
      position,
      new Vector3(size * (0.8 + random()), size * (0.45 + random() * 0.5), size),
      random() * Math.PI,
      dark.clone().lerp(light, 0.25 + random() * 0.65),
    )
  }
  finishInstances(mesh)
  mesh.castShadow = false
  root.add(mesh)
  return count
}

function addShrubs(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.shrubs,
    density ?? 'current',
  )
  if (count === 0) return 0
  const mesh = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    new MeshStandardMaterial({
      color: '#ffffff',
      flatShading: true,
      roughness: 0.96,
    }),
    count * 3,
  )
  mesh.name = `scale-encounter-${biome.themeId}-drought-shrub-batch`
  const dry = new Color('#80633e')
  const green = new Color(biome.profile === 'gobi-braided-basin' ? '#657743' : '#426544')
  let lobeIndex = 0
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 28 + random() ** 2 * 197
    const position = new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    )
    const size = 0.42 + random() * 0.82
    const groundY = heightAtWorld(position.x, position.z)
    const shrubYaw = random() * Math.PI * 2
    for (let lobe = 0; lobe < 3; lobe += 1) {
      const lobeAngle = shrubYaw + (lobe / 3) * Math.PI * 2
      const lobeSize = size * (0.55 + random() * 0.4)
      const lobePosition = new Vector3(
        position.x + Math.cos(lobeAngle) * size * 0.42,
        groundY + lobeSize * (0.42 + lobe * 0.08),
        position.z + Math.sin(lobeAngle) * size * 0.38,
      )
      applyInstance(
        mesh,
        lobeIndex,
        lobePosition,
        new Vector3(
          lobeSize * (0.85 + random() * 0.45),
          lobeSize * (0.62 + random() * 0.3),
          lobeSize * (0.8 + random() * 0.4),
        ),
        shrubYaw + random() * 0.45,
        dry.clone().lerp(green, 0.42 + random() * 0.52),
      )
      lobeIndex += 1
    }
  }
  finishInstances(mesh)
  mesh.castShadow = false
  root.add(mesh)
  return count
}

function channelPlantPosition(
  biome: ScaleEncounterPreparedLandBiome,
  random: RandomSource,
  minimumRadius = 30,
): Vector3 {
  if (biome.profile === 'carboniferous-coal-swamp') {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const pool =
        CARBONIFEROUS_WETLAND_POOLS[
          Math.floor(random() * CARBONIFEROUS_WETLAND_POOLS.length)
        ]!
      const angle = random() * Math.PI * 2
      const margin = 1.04 + random() * 0.74
      const localX = Math.cos(angle) * pool.width * margin
      const localZ =
        Math.sin(angle) * pool.depth * (1.02 + random() * 0.58)
      const cosine = Math.cos(pool.yaw)
      const sine = Math.sin(pool.yaw)
      const position = new Vector3(
        pool.x + localX * cosine - localZ * sine,
        0,
        pool.z + localX * sine + localZ * cosine,
      )
      if (Math.hypot(position.x, position.z) >= minimumRadius) {
        return position
      }
    }
    return randomRingPosition(random, minimumRadius, 230)
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const longitudinal = (random() * 2 - 1) * 245
    const side = random() < 0.5 ? -1 : 1
    const position = channelCoordinates(
      biome.profile,
      longitudinal,
      side *
        (channelHalfWidth(biome.profile, longitudinal) +
          3 +
          random() * 18),
    )
    if (Math.hypot(position.x, position.z) >= minimumRadius) {
      return new Vector3(position.x, 0, position.z)
    }
  }
  return randomRingPosition(random, minimumRadius, 230)
}

function addRiparianPlants(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.riparianPlants,
    density ?? 'current',
  )
  if (count === 0) return 0
  const mesh = new InstancedMesh(
    new CylinderGeometry(0.12, 0.2, 1, 5),
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.94,
    }),
    count,
  )
  mesh.name = `scale-encounter-${biome.themeId}-riparian-stem-batch`
  const whorlsPerStem = 3
  const whorls = new InstancedMesh(
    new CylinderGeometry(0.34, 0.34, 0.055, 9),
    new MeshStandardMaterial({
      color:
        biome.profile === 'carboniferous-coal-swamp'
          ? '#62825f'
          : '#788554',
      roughness: 0.96,
    }),
    count * whorlsPerStem,
  )
  whorls.name = `scale-encounter-${biome.themeId}-riparian-whorl-batch`
  const low = new Color(
    biome.profile === 'carboniferous-coal-swamp' ? '#456b53' : '#586641',
  )
  const high = new Color(
    biome.profile === 'carboniferous-coal-swamp' ? '#75936a' : '#7e8d57',
  )
  let whorlIndex = 0
  for (let index = 0; index < count; index += 1) {
    const position = channelPlantPosition(
      biome,
      random,
      biome.profile === 'carboniferous-coal-swamp' ? 22 : 30,
    )
    const height =
      biome.profile === 'carboniferous-coal-swamp'
        ? 0.65 + random() * 1.65
        : 0.8 + random() * 1.7
    position.y = heightAtWorld(position.x, position.z) + height * 0.5
    applyInstance(
      mesh,
      index,
      position,
      new Vector3(0.7 + random() * 0.7, height, 0.7 + random() * 0.7),
      random() * Math.PI,
      low.clone().lerp(high, random()),
    )
    for (let whorl = 1; whorl <= whorlsPerStem; whorl += 1) {
      applyInstance(
        whorls,
        whorlIndex,
        new Vector3(
          position.x,
          position.y - height * 0.5 +
            (height * whorl) / (whorlsPerStem + 0.45),
          position.z,
        ),
        new Vector3(
          1.35 + random() * 1.05,
          0.7 + random() * 0.35,
          1.35 + random() * 1.05,
        ),
        random() * Math.PI,
      )
      whorlIndex += 1
    }
  }
  root.add(finishInstances(mesh), finishInstances(whorls))
  return count
}

function createFernFrondGeometry(): BufferGeometry {
  const positions: number[] = []
  const leafletPairs = 8
  for (let index = 1; index <= leafletPairs; index += 1) {
    const x = index / (leafletPairs + 1)
    const previousX = Math.max(0, x - 0.09)
    const nextX = Math.min(1, x + 0.1)
    const rise = Math.sin(x * Math.PI) * 0.085
    const width = Math.sin(x * Math.PI) * (0.25 - x * 0.055)
    positions.push(
      previousX, rise * 0.72, 0,
      nextX, rise, 0,
      x, rise, width,
      previousX, rise * 0.72, 0,
      x, rise, -width,
      nextX, rise, 0,
    )
  }
  positions.push(
    0, 0, -0.018,
    1, 0, -0.01,
    1, 0, 0.01,
    0, 0, -0.018,
    1, 0, 0.01,
    0, 0, 0.018,
  )
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.computeVertexNormals()
  return geometry
}

function addFerns(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.ferns,
    density ?? 'current',
  )
  if (count === 0) return 0
  const mesh = new InstancedMesh(
    createFernFrondGeometry(),
    new MeshBasicMaterial({
      color: '#ffffff',
      side: DoubleSide,
    }),
    count,
  )
  mesh.name = `scale-encounter-${biome.themeId}-fern-frond-batch`
  const shadow = new Color('#31553f')
  const light = new Color(biome.profile === 'carboniferous-coal-swamp' ? '#688b5e' : '#677d49')
  for (let index = 0; index < count; index += 1) {
    const position = channelPlantPosition(
      biome,
      random,
      biome.profile === 'carboniferous-coal-swamp' ? 20 : 34,
    )
    const size =
      (biome.profile === 'carboniferous-coal-swamp' ? 1 : 1.15) +
      random() *
        (biome.profile === 'carboniferous-coal-swamp' ? 3.4 : 2.15)
    position.y = heightAtWorld(position.x, position.z) + 0.12 + random() * 0.5
    const helper = new Object3D()
    helper.position.copy(position)
    helper.rotation.set(
      0,
      random() * Math.PI * 2,
      -0.12 + random() * 0.48,
    )
    helper.scale.set(size, 1.15 + random() * 0.5, size)
    helper.updateMatrix()
    mesh.setMatrixAt(index, helper.matrix)
    mesh.setColorAt(
      index,
      shadow.clone().lerp(light, 0.3 + random() * 0.7),
    )
  }
  root.add(finishInstances(mesh))
  return count
}

function addTreeFerns(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
  frondTexture: Texture | null,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.treeFerns,
    density ?? 'current',
  )
  if (count === 0) return 0
  const trunks = new InstancedMesh(
    new CylinderGeometry(0.22, 0.32, 1, 9, 3),
    new MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#1f1711',
      emissiveIntensity: 0.05,
      roughness: 0.96,
    }),
    count,
  )
  trunks.name = `scale-encounter-${biome.themeId}-tree-fern-trunks`
  const outerFronds = 14
  const middleFronds = 8
  const emergingFronds = 4
  const frondsPerTree = outerFronds + middleFronds + emergingFronds
  const crowns = new InstancedMesh(
    frondTexture
      ? createTexturedLycopsidFrondGeometry()
      : createFernFrondGeometry(),
    new MeshStandardMaterial({
      alphaTest: frondTexture ? 0.32 : 0,
      alphaToCoverage: Boolean(frondTexture),
      color: '#dfe8d5',
      emissive: '#314936',
      emissiveIntensity: 0.14,
      map: frondTexture,
      metalness: 0,
      roughness: 0.9,
      side: DoubleSide,
    }),
    count * frondsPerTree,
  )
  crowns.name = `scale-encounter-${biome.themeId}-tree-fern-crowns`
  const barkDark = new Color('#493b30')
  const barkLight = new Color('#705d47')
  const frondDark = new Color('#527458')
  const frondLight = new Color('#9cb67a')
  let crownIndex = 0
  for (let index = 0; index < count; index += 1) {
    let position = new Vector3()
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = random() * Math.PI * 2
      const radius = 48 + random() ** 1.45 * 102
      position = new Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      )
      // Preserve the same open comparison corridor as the accepted forest:
      // substantial crowns frame the child and animal instead of sitting
      // directly between them and the overview camera.
      if (!(position.z < 18 && Math.abs(position.x) < 12)) break
    }
    const height = 3.6 + random() * 5.2
    const width = 0.58 + random() * 0.48
    const groundY = heightAtWorld(position.x, position.z)
    applyInstance(
      trunks,
      index,
      new Vector3(position.x, groundY + height * 0.5, position.z),
      new Vector3(width, height, width),
      random() * Math.PI,
      barkDark.clone().lerp(barkLight, random()),
    )
    const crownYaw = random() * Math.PI * 2
    for (let frond = 0; frond < frondsPerTree; frond += 1) {
      const helper = new Object3D()
      const isOuter = frond < outerFronds
      const isMiddle = !isOuter && frond < outerFronds + middleFronds
      const ringIndex = isOuter
        ? frond
        : isMiddle
          ? frond - outerFronds
          : frond - outerFronds - middleFronds
      const ringCount = isOuter
        ? outerFronds
        : isMiddle
          ? middleFronds
          : emergingFronds
      const yaw =
        crownYaw +
        (ringIndex / ringCount) * Math.PI * 2 +
        (random() - 0.5) * (isOuter ? 0.26 : 0.42)
      const length = isOuter
        ? 2.8 + random() * 2.2
        : isMiddle
          ? 1.9 + random() * 1.55
          : 1.15 + random() * 0.9
      const crownLift = isOuter ? 0 : isMiddle ? 0.22 : 0.48
      const roll = isOuter
        ? -0.88 + random() * 0.32
        : isMiddle
          ? -0.28 + random() * 0.42
          : 0.58 + random() * 0.42
      helper.position.set(
        position.x,
        groundY + height + crownLift,
        position.z,
      )
      helper.rotation.set((random() - 0.5) * 0.34, yaw, roll)
      helper.scale.set(
        length,
        1.08 + random() * 0.32,
        length * (isOuter ? 0.66 : isMiddle ? 0.72 : 0.58),
      )
      helper.updateMatrix()
      crowns.setMatrixAt(crownIndex, helper.matrix)
      crowns.setColorAt(
        crownIndex,
        frondDark.clone().lerp(
          frondLight,
          (isOuter ? 0.28 : isMiddle ? 0.44 : 0.58) + random() * 0.38,
        ),
      )
      crownIndex += 1
    }
  }
  root.add(finishInstances(trunks), finishInstances(crowns))
  return count
}

function createLycopsidBarkTexture(): DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cellHeight = 20
      const cellWidth = 16
      const row = Math.floor(y / cellHeight)
      const localX =
        ((x + (row % 2) * (cellWidth * 0.5)) % cellWidth) -
        cellWidth * 0.5
      const localY = (y % cellHeight) - cellHeight * 0.5
      const diamond =
        Math.abs(localX) / (cellWidth * 0.45) +
        Math.abs(localY) / (cellHeight * 0.43)
      const scarEdge = smoothstep(0.7, 0.86, diamond) *
        (1 - smoothstep(0.92, 1.08, diamond))
      const leafScar = Math.exp(
        -(localX * localX * 0.18 + localY * localY * 0.085),
      )
      const verticalRib =
        (Math.cos((x / size) * Math.PI * 2 * 16) + 1) * 3.2
      const fineNoise =
        Math.sin(x * 0.73 + y * 0.31) * 2.8 +
        Math.cos(x * 0.19 - y * 0.87) * 2.1
      const value = Math.max(
        50,
        Math.min(
          176,
          126 + verticalRib + fineNoise - scarEdge * 37 - leafScar * 24,
        ),
      )
      const offset = (y * size + x) * 4
      data[offset] = Math.round(value * 0.82)
      data[offset + 1] = Math.round(value * 0.88)
      data[offset + 2] = Math.round(value * 0.78)
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
  texture.name = 'scale-encounter-carboniferous-lycopsid-bark-scar-texture'
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(3, 12)
  texture.generateMipmaps = true
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

function createTexturedLycopsidFrondGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        0, 0, -0.025,
        1, 0.1, -0.28,
        1, 0.1, 0.28,
        0, 0, -0.025,
        1, 0.1, 0.28,
        0, 0, 0.025,
      ]),
      3,
    ),
  )
  // Top-left component in the existing 4 x 3 reviewed frond sheet.
  const u0 = 0.008 / 4
  const u1 = (1 - 0.008) / 4
  const v0 = (2 + 0.006) / 3
  const v1 = (3 - 0.006) / 3
  geometry.setAttribute(
    'uv',
    new BufferAttribute(
      new Float32Array([
        u0, v0,
        u0, v1,
        u1, v1,
        u0, v0,
        u1, v1,
        u1, v0,
      ]),
      2,
    ),
  )
  geometry.computeVertexNormals()
  return geometry
}

function createFloodplainFarTreeGeometry(profile: number): BufferGeometry {
  const columns = 4
  const rows = 2
  const column = profile % columns
  const rowFromTop = Math.floor(profile / columns)
  const paddingU = 0.012
  const paddingV = 0.009
  const u0 = (column + paddingU) / columns
  const u1 = (column + 1 - paddingU) / columns
  const v0 = 1 - (rowFromTop + 1 - paddingV) / rows
  const v1 = 1 - (rowFromTop + paddingV) / rows
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -0.5, 0, 0,
        0.5, 0, 0,
        0.5, 1, 0,
        -0.5, 1, 0,
        0, 0, -0.45,
        0, 0, 0.45,
        0, 1, 0.45,
        0, 1, -0.45,
      ]),
      3,
    ),
  )
  geometry.setAttribute(
    'uv',
    new BufferAttribute(
      new Float32Array([
        u0, v0,
        u1, v0,
        u1, v1,
        u0, v1,
        u0, v0,
        u1, v0,
        u1, v1,
        u0, v1,
      ]),
      2,
    ),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Carries the accepted forest's crisp, depth-writing distant-tree grammar
 * into the Kayenta floodplain. The fixed crossed profiles occupy irregular
 * riparian colonies in world space; they never face the camera and never
 * become a blurred landscape plate.
 */
function addFloodplainRiparianWoodland(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  atlas: Texture,
): number {
  const openPlain = biome.profile === 'gobi-braided-basin'
  const count = scaleEncounterEcologyCount(openPlain ? 300 : 218, density ?? 'current')
  const random = seededRandom(biome.seed ^ 0x7a31d)
  const profileCount = 8
  const placements = Array.from({ length: profileCount }, () => [] as Array<{
    height: number
    width: number
    x: number
    yaw: number
    z: number
  }>)
  let accepted = 0
  for (let attempt = 0; attempt < count * 40 && accepted < count; attempt += 1) {
    const angle = random() * Math.PI * 2
    const colonySignal =
      Math.sin(angle * 3.2 + 0.45) * 0.55 +
      Math.cos(angle * 7.1 - 0.8) * 0.32
    if (random() > 0.72 + colonySignal * 0.2) continue
    const radius = 102 + random() ** 0.72 * 158
    const copses = [
      [-42, -35], [45, -42], [-25, -62], [14, -78], [65, -85],
      [-75, -105], [-15, -145], [55, -160], [-130, -130], [120, -100],
      [-45, 82], [32, 120], [110, 45],
    ]
    const copse = copses[accepted % copses.length]!
    const clustered = openPlain || accepted < count * 0.7
    const x = clustered ? copse[0]! + (random() - 0.5) * 38 : Math.cos(angle) * radius + (random() - 0.5) * 14
    const z = clustered ? copse[1]! + (random() - 0.5) * 32 : Math.sin(angle) * radius + (random() - 0.5) * 14
    const height = openPlain ? 8 + random() * 10 : 8.2 + random() * 9.8
    placements[accepted % profileCount]!.push({
      height,
      width: height * (0.48 + random() * 0.24),
      x,
      yaw: random() * Math.PI * 2,
      z,
    })
    accepted += 1
  }
  const shadow = new Color('#697760')
  const light = new Color('#99a28b')
  placements.forEach((profilePlacements, profile) => {
    if (profilePlacements.length === 0) return
    const material = new MeshBasicMaterial({
      alphaTest: 0.42,
      alphaToCoverage: true,
      color: '#e3e6dc',
      fog: true,
      map: atlas,
      side: DoubleSide,
    })
    const trees = new InstancedMesh(
      createFloodplainFarTreeGeometry(profile),
      material,
      profilePlacements.length,
    )
    trees.name =
      `scale-encounter-${biome.themeId}-world-space-riparian-canopy-${profile + 1}`
    const helper = new Object3D()
    profilePlacements.forEach((placement, index) => {
      helper.position.set(
        placement.x,
        heightAtWorld(placement.x, placement.z) - 0.025,
        placement.z,
      )
      helper.rotation.set(
        (random() - 0.5) * 0.025,
        placement.yaw,
        (random() - 0.5) * 0.025,
      )
      helper.scale.set(placement.width, placement.height, placement.width)
      helper.updateMatrix()
      trees.setMatrixAt(index, helper.matrix)
      trees.setColorAt(
        index,
        shadow.clone().lerp(light, 0.25 + random() * 0.75),
      )
    })
    finishInstances(trees)
    trees.castShadow = false
    trees.receiveShadow = false
    root.add(trees)
  })
  return accepted
}

function addLycopsids(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
  frondTexture: Texture | null,
): number {
  const requestedCount = scaleEncounterEcologyCount(
    biome.ecology.lycopsids,
    density ?? 'current',
  )
  // A few recognisable emergent trees establish the Carboniferous canopy.
  // Dozens of identical 30 m cylinders read as utility poles, even when the
  // biological count is technically plausible, so density primarily belongs
  // to the supported tree-fern and floor layers.
  const count = Math.round(requestedCount * 0.34)
  if (count === 0) return 0
  const barkTexture = createLycopsidBarkTexture()
  const barkMaterial = new MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#3d493e',
    emissiveIntensity: 0.16,
    map: barkTexture,
    metalness: 0,
    roughness: 0.96,
  })
  const trunks = new InstancedMesh(
    new CylinderGeometry(0.68, 1, 1, 14, 6),
    barkMaterial,
    count,
  )
  trunks.name = `scale-encounter-${biome.themeId}-lycopsid-sigillaria-trunks`
  const rootFlares = new InstancedMesh(
    new CylinderGeometry(0.52, 1.34, 1, 14, 3),
    barkMaterial,
    count,
  )
  rootFlares.name =
    `scale-encounter-${biome.themeId}-lycopsid-root-flares`
  const branchesPerTree = 7
  const branches = new InstancedMesh(
    new CylinderGeometry(0.2, 0.42, 1, 9, 2),
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.97,
    }),
    count * branchesPerTree,
  )
  branches.name =
    `scale-encounter-${biome.themeId}-lycopsid-terminal-forks`
  const crownFrondsPerBranch = 8
  const crowns = new InstancedMesh(
    frondTexture
      ? createTexturedLycopsidFrondGeometry()
      : createFernFrondGeometry(),
    new MeshStandardMaterial({
      alphaTest: frondTexture ? 0.32 : 0,
      alphaToCoverage: Boolean(frondTexture),
      color: '#d9e2cf',
      emissive: '#2d422f',
      emissiveIntensity: 0.12,
      map: frondTexture,
      metalness: 0,
      roughness: 0.9,
      side: DoubleSide,
    }),
    count * branchesPerTree * crownFrondsPerBranch,
  )
  crowns.name = `scale-encounter-${biome.themeId}-lycopsid-terminal-crowns`
  const barkDark = new Color('#5d685a')
  const barkLight = new Color('#8f927b')
  const crownDark = new Color('#648365')
  const crownLight = new Color('#a6b67f')
  let branchIndex = 0
  let crownIndex = 0
  for (let index = 0; index < count; index += 1) {
    const position = randomRingPosition(random, 160, 245)
    const height = 13.5 + random() * 8
    const width = 0.52 + random() * 0.42
    const groundY = heightAtWorld(position.x, position.z)
    const treeYaw = random() * Math.PI * 2
    const trunk = new Object3D()
    trunk.position.set(position.x, groundY + height * 0.5, position.z)
    trunk.rotation.set(
      (random() - 0.5) * 0.025,
      treeYaw,
      (random() - 0.5) * 0.025,
    )
    trunk.scale.set(width, height, width)
    trunk.updateMatrix()
    trunks.setMatrixAt(index, trunk.matrix)
    trunks.setColorAt(index, barkDark.clone().lerp(barkLight, random()))
    applyInstance(
      rootFlares,
      index,
      new Vector3(position.x, groundY + 0.78, position.z),
      new Vector3(width * 1.18, 1.65, width * 1.18),
      treeYaw,
      barkDark.clone().lerp(barkLight, 0.25 + random() * 0.42),
    )
    const branchBase = new Vector3(
      position.x,
      groundY + height - 2.15,
      position.z,
    )
    for (let branch = 0; branch < branchesPerTree; branch += 1) {
      const branchYaw =
        treeYaw +
        (branch / branchesPerTree) * Math.PI * 2 +
        (random() - 0.5) * 0.22
      const direction = new Vector3(
        Math.cos(branchYaw) * 0.62,
        0.76 + random() * 0.1,
        Math.sin(branchYaw) * 0.62,
      ).normalize()
      const branchLength = 3.4 + random() * 2.1
      const branchHelper = new Object3D()
      branchHelper.position
        .copy(branchBase)
        .addScaledVector(direction, branchLength * 0.5)
      branchHelper.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        direction,
      )
      branchHelper.scale.set(width * 0.58, branchLength, width * 0.58)
      branchHelper.updateMatrix()
      branches.setMatrixAt(branchIndex, branchHelper.matrix)
      branches.setColorAt(
        branchIndex,
        barkDark.clone().lerp(barkLight, 0.42 + random() * 0.4),
      )
      branchIndex += 1
      const branchTip = branchBase
        .clone()
        .addScaledVector(direction, branchLength)
      for (let frond = 0; frond < crownFrondsPerBranch; frond += 1) {
        const helper = new Object3D()
        const yaw =
          branchYaw +
          (frond / crownFrondsPerBranch) * Math.PI * 2 +
          (random() - 0.5) * 0.28
        const length = width * (5.4 + random() * 3.1)
        helper.position.copy(branchTip)
        helper.rotation.set(0, yaw, -0.62 + random() * 0.34)
        helper.scale.set(length, 1.25 + random() * 0.45, length * 1.12)
        helper.updateMatrix()
        crowns.setMatrixAt(crownIndex, helper.matrix)
        crowns.setColorAt(
          crownIndex,
          crownDark.clone().lerp(crownLight, 0.35 + random() * 0.65),
        )
        crownIndex += 1
      }
    }
  }
  root.add(
    finishInstances(trunks),
    finishInstances(rootFlares),
    finishInstances(branches),
    finishInstances(crowns),
  )
  return count
}

function addCalamites(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  density: ScaleEncounterEnvironmentOptions['ecologyDensity'],
  heightAtWorld: HeightSampler,
  random: RandomSource,
): number {
  const count = scaleEncounterEcologyCount(
    biome.ecology.calamites,
    density ?? 'current',
  )
  if (count === 0) return 0
  const stems = new InstancedMesh(
    new CylinderGeometry(0.13, 0.2, 1, 7),
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.93,
    }),
    count,
  )
  stems.name = `scale-encounter-${biome.themeId}-calamites-segmented-stems`
  const jointsPerStem = 4
  const joints = new InstancedMesh(
    new CylinderGeometry(0.24, 0.24, 0.09, 8),
    new MeshStandardMaterial({ color: '#68825f', roughness: 0.95 }),
    count * jointsPerStem,
  )
  joints.name = `scale-encounter-${biome.themeId}-calamites-joint-rings`
  const branchesPerStem = 5
  const branches = new InstancedMesh(
    new CylinderGeometry(0.055, 0.085, 1, 5),
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.94,
    }),
    count * branchesPerStem,
  )
  branches.name = `scale-encounter-${biome.themeId}-calamites-whorled-branches`
  const sprays = new InstancedMesh(
    createFernFrondGeometry(),
    new MeshBasicMaterial({
      color: '#ffffff',
      side: DoubleSide,
    }),
    count * branchesPerStem,
  )
  sprays.name = `scale-encounter-${biome.themeId}-calamites-leaf-sprays`
  const dark = new Color('#42664d')
  const light = new Color('#718e66')
  let jointIndex = 0
  let branchIndex = 0
  for (let index = 0; index < count; index += 1) {
    const position = channelPlantPosition(biome, random, 48)
    const height = 1.7 + random() * 2.7
    const radius = 0.48 + random() * 0.48
    const groundY = heightAtWorld(position.x, position.z)
    applyInstance(
      stems,
      index,
      new Vector3(position.x, groundY + height * 0.5, position.z),
      new Vector3(radius, height, radius),
      random() * Math.PI,
      dark.clone().lerp(light, random()),
    )
    for (let joint = 1; joint <= jointsPerStem; joint += 1) {
      const y = groundY + (height * joint) / (jointsPerStem + 1)
      applyInstance(
        joints,
        jointIndex,
        new Vector3(position.x, y, position.z),
        new Vector3(radius, 1, radius),
        0,
      )
      jointIndex += 1
    }
    const branchNodeY = groundY + height * (0.72 + random() * 0.12)
    for (let branch = 0; branch < branchesPerStem; branch += 1) {
      const angle =
        (branch / branchesPerStem) * Math.PI * 2 + random() * 0.25
      const branchLength = 0.65 + random() * Math.min(2.2, height * 0.22)
      const direction = new Vector3(
        Math.cos(angle) * 0.84,
        0.42 + random() * 0.18,
        Math.sin(angle) * 0.84,
      ).normalize()
      const helper = new Object3D()
      helper.position.set(position.x, branchNodeY, position.z)
        .addScaledVector(direction, branchLength * 0.5)
      helper.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        direction,
      )
      helper.scale.set(radius * 0.78, branchLength, radius * 0.78)
      helper.updateMatrix()
      branches.setMatrixAt(branchIndex, helper.matrix)
      branches.setColorAt(
        branchIndex,
        dark.clone().lerp(light, 0.45 + random() * 0.55),
      )
      const spray = new Object3D()
      spray.position.set(position.x, branchNodeY, position.z)
        .addScaledVector(direction, branchLength)
      spray.rotation.set(0, -angle, -0.18 + random() * 0.3)
      const sprayLength = 0.55 + random() * 0.75
      spray.scale.set(sprayLength, 1.1, sprayLength * 0.8)
      spray.updateMatrix()
      sprays.setMatrixAt(branchIndex, spray.matrix)
      sprays.setColorAt(
        branchIndex,
        dark.clone().lerp(light, 0.55 + random() * 0.45),
      )
      branchIndex += 1
    }
  }
  root.add(
    finishInstances(stems),
    finishInstances(joints),
    finishInstances(branches),
    finishInstances(sprays),
  )
  return count
}

function addDistantLandforms(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  heightAtWorld: HeightSampler,
  random: RandomSource,
  surfaceTextures: ScaleEncounterEnvironmentOptions['surfaceTextures'],
): number {
  const count = biome.ecology.distantLandforms
  if (count === 0) return 0
  const radialSegments = 28
  const levelFractions = [0, 0.12, 0.36, 0.58, 0.76, 0.91, 1] as const
  const radiusFractions = [1.24, 1.1, 0.95, 0.9, 0.82, 0.71, 0.67] as const
  const positions: number[] = []
  const colours: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const dark = new Color(biome.palette.groundDark)
  const light = new Color(biome.palette.groundLight)
  const white = new Color('#ffffff')
  const colour = new Color()
  const gobiAuthoredPositions = [
    [-110, -265],
    [-48, -315],
    [38, -285],
    [108, -330],
    [-105, 265],
    [-35, 310],
    [48, 278],
    [112, 325],
  ] as const
  for (let index = 0; index < count; index += 1) {
    const authoredPosition =
      biome.profile === 'gobi-braided-basin'
        ? gobiAuthoredPositions[index % gobiAuthoredPositions.length]
        : null
    const position = authoredPosition
      ? new Vector3(authoredPosition[0], 0, authoredPosition[1])
      : randomRingPosition(random, 210, 286)
    const width =
      biome.profile === 'gobi-braided-basin'
        ? 13 + random() * 13
        : 9 + random() * 12
    const height =
      biome.profile === 'gobi-braided-basin'
        ? 8.5 + random() * 9.5
        : 7 + random() * 10
    const depth = width * (0.62 + random() * 0.36)
    const yaw = random() * Math.PI * 2
    const baseY = heightAtWorld(position.x, position.z)
    const mesaStart = positions.length / 3
    levelFractions.forEach((levelFraction, levelIndex) => {
      const radiusFraction = radiusFractions[levelIndex]!
      for (let segment = 0; segment < radialSegments; segment += 1) {
        const angle = (segment / radialSegments) * Math.PI * 2
        const irregularity =
          1 +
          Math.sin(angle * 3 + index * 1.7 + levelIndex * 0.31) * 0.085 +
          Math.cos(angle * 7 - index * 0.8 - levelIndex * 0.27) * 0.038 +
          Math.sin(angle * 11 + levelIndex * 0.46) * 0.018
        const localX = Math.cos(angle) * width * radiusFraction * irregularity
        const localZ = Math.sin(angle) * depth * radiusFraction * irregularity
        const rotatedX = localX * Math.cos(yaw) - localZ * Math.sin(yaw)
        const rotatedZ = localX * Math.sin(yaw) + localZ * Math.cos(yaw)
        positions.push(
          position.x + rotatedX,
          baseY + height * levelFraction,
          position.z + rotatedZ,
        )
        uvs.push(
          (position.x + rotatedX) / (BIOME_RADIUS_METERS * 2) + 0.5,
          (position.z + rotatedZ) / (BIOME_RADIUS_METERS * 2) + 0.5,
        )
        const strata =
          0.22 +
          levelFraction * 0.38 +
          Math.sin(levelFraction * Math.PI * 9 + index) * 0.055
        colour
          .copy(dark)
          .lerp(light, strata)
          .lerp(white, 0.42)
          .toArray(colours, colours.length)
      }
    })
    for (let level = 0; level < levelFractions.length - 1; level += 1) {
      for (let segment = 0; segment < radialSegments; segment += 1) {
        const next = (segment + 1) % radialSegments
        const lower = mesaStart + level * radialSegments
        const upper = lower + radialSegments
        indices.push(
          lower + segment,
          upper + segment,
          upper + next,
          lower + segment,
          upper + next,
          lower + next,
        )
      }
    }
    const topCentre = positions.length / 3
    positions.push(position.x, baseY + height, position.z)
    uvs.push(
      position.x / (BIOME_RADIUS_METERS * 2) + 0.5,
      position.z / (BIOME_RADIUS_METERS * 2) + 0.5,
    )
    colour
      .copy(dark)
      .lerp(light, 0.63)
      .lerp(white, 0.36)
      .toArray(colours, colours.length)
    const topRing =
      mesaStart + (levelFractions.length - 1) * radialSegments
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      indices.push(topRing + segment, topCentre, topRing + next)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colours), 3),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const material = new MeshStandardMaterial({
    map: surfaceTextures?.albedo ?? null,
    metalness: 0,
    normalMap: surfaceTextures?.normal ?? null,
    normalScale: new Vector2(0.13, 0.13),
    roughness: 1,
    roughnessMap: surfaceTextures?.roughness ?? null,
    vertexColors: true,
  })
  if (surfaceTextures) {
    applyScaleEncounterLandBiomeGroundMaterial(material, {
      darkTint: biome.palette.groundDark,
      lightTint: biome.palette.groundLight,
      macroVariationStrength: 0.18,
      normalFadeEndMeters: 330,
      normalFadeStartMeters: 150,
      physicalWidthMeters: surfaceTextures.physicalWidthMeters,
      stochasticCellSizeMeters:
        surfaceTextures.physicalWidthMeters * 4.5,
    })
  }
  const mesh = new Mesh(geometry, material)
  mesh.name = `scale-encounter-${biome.themeId}-distant-mesa-batch`
  mesh.castShadow = false
  mesh.receiveShadow = true
  root.add(mesh)
  return count
}

function addDistantRidge(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  heightAtWorld: HeightSampler,
  surfaceTextures: ScaleEncounterEnvironmentOptions['surfaceTextures'],
): void {
  if (biome.profile !== 'gobi-braided-basin') return
  const sectors =
    ([
      { angle: -2.82, halfSpan: 0.09, radius: 302, height: 8.5, depth: 32 },
      { angle: -2.02, halfSpan: 0.075, radius: 318, height: 6.8, depth: 27 },
      { angle: -1.42, halfSpan: 0.12, radius: 298, height: 9.4, depth: 35 },
      { angle: -0.48, halfSpan: 0.085, radius: 324, height: 6.6, depth: 26 },
      { angle: 0.46, halfSpan: 0.08, radius: 310, height: 7.1, depth: 29 },
      { angle: 2.22, halfSpan: 0.085, radius: 320, height: 6.4, depth: 25 },
    ] as const)
  const segmentCount = 42
  const positions: number[] = []
  const colours: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const dark = new Color(biome.palette.groundDark)
  const light = new Color(biome.palette.groundLight)
  const white = new Color('#ffffff')
  const colour = new Color()
  sectors.forEach((sector, sectorIndex) => {
    const sectorStart = positions.length / 3
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const progress = segment / segmentCount
      const angle = sector.angle + (progress * 2 - 1) * sector.halfSpan
      const taper = Math.sin(progress * Math.PI) ** 0.58
      const profile =
        0.78 +
        Math.sin(progress * Math.PI * 3.2 + sectorIndex) * 0.13 +
        Math.cos(progress * Math.PI * 6.7 - sectorIndex * 0.6) * 0.055
      const peakHeight = sector.height * taper * profile
      const centreRadius =
        sector.radius +
        Math.sin(progress * Math.PI * 2.6 + sectorIndex) * 5.5
      const rows = [
        { radius: centreRadius - sector.depth * 0.52, height: 0, colour: 0.17 },
        { radius: centreRadius - sector.depth * 0.16, height: peakHeight * 0.83, colour: 0.34 },
        { radius: centreRadius + sector.depth * 0.12, height: peakHeight, colour: 0.48 },
        { radius: centreRadius + sector.depth * 0.5, height: 0, colour: 0.27 },
      ] as const
      rows.forEach((row) => {
        const x = Math.cos(angle) * row.radius
        const z = Math.sin(angle) * row.radius
        positions.push(x, heightAtWorld(x, z) + row.height - 0.08, z)
        uvs.push(
          x / (BIOME_RADIUS_METERS * 2) + 0.5,
          z / (BIOME_RADIUS_METERS * 2) + 0.5,
        )
        const stratum =
          row.colour + Math.sin(peakHeight * 0.7 + row.radius * 0.04) * 0.035
        colour
          .copy(dark)
          .lerp(light, stratum)
          .lerp(white, 0.45)
          .toArray(colours, colours.length)
      })
    }
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const current = sectorStart + segment * 4
      const next = current + 4
      for (let row = 0; row < 3; row += 1) {
        indices.push(
          current + row,
          next + row,
          next + row + 1,
          current + row,
          next + row + 1,
          current + row + 1,
        )
      }
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const ridgeMaterial = new MeshStandardMaterial({
    map: surfaceTextures?.albedo ?? null,
    metalness: 0,
    normalMap: surfaceTextures?.normal ?? null,
    normalScale: new Vector2(0.08, 0.08),
    roughness: 1,
    roughnessMap: surfaceTextures?.roughness ?? null,
    vertexColors: true,
  })
  if (surfaceTextures) {
    applyScaleEncounterLandBiomeGroundMaterial(ridgeMaterial, {
      darkTint: biome.palette.groundDark,
      lightTint: biome.palette.groundLight,
      macroVariationStrength: 0.12,
      normalFadeEndMeters: 340,
      normalFadeStartMeters: 180,
      physicalWidthMeters: surfaceTextures.physicalWidthMeters,
      stochasticCellSizeMeters:
        surfaceTextures.physicalWidthMeters * 5.5,
    })
  }
  const ridge = new Mesh(geometry, ridgeMaterial)
  ridge.name = `scale-encounter-${biome.themeId}-distant-eroded-ridge`
  ridge.receiveShadow = true
  root.add(ridge)
}

function waterLevelFor(
  biome: ScaleEncounterPreparedLandBiome,
): number {
  return biome.profile !== 'carboniferous-coal-swamp' ? -0.18 : -0.22
}

function createWaterNormalTexture(): DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2
      const v = (y / size) * Math.PI * 2
      const dx =
        Math.cos(u * 3 + v * 2) * 0.42 +
        Math.cos(u * 7 - v * 3 + 1.2) * 0.19 +
        Math.cos(u * 11 + v * 5 - 0.7) * 0.08
      const dz =
        Math.cos(v * 4 - u * 2 + 0.4) * 0.36 +
        Math.cos(v * 9 + u * 3 - 1.6) * 0.16 +
        Math.cos(v * 13 - u * 4 + 0.9) * 0.07
      const normal = new Vector3(-dx * 0.23, -dz * 0.23, 1).normalize()
      const offset = (y * size + x) * 4
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255)
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255)
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255)
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.name = 'scale-encounter-land-biome-water-normal'
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.generateMipmaps = true
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.needsUpdate = true
  return texture
}

function createWaterMaterial(
  biome: ScaleEncounterPreparedLandBiome,
  normalMap: Texture,
): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    clearcoat: biome.profile === 'carboniferous-coal-swamp' ? 0.74 : 0.82,
    clearcoatRoughness: 0.22,
    // Vertex colours already carry the water hue and depth gradient. Keeping
    // the base material near-white avoids multiplying teal by teal into the
    // near-black strip seen in the first river implementation.
    color:
      biome.profile === 'carboniferous-coal-swamp'
        ? '#9ab4ac'
        : '#dce8e5',
    depthWrite: true,
    emissive: biome.palette.water ?? '#526d67',
    emissiveIntensity:
      biome.profile === 'carboniferous-coal-swamp' ? 0.06 : 0.075,
    metalness: 0,
    normalMap,
    normalScale: new Vector2(0.19, 0.19),
    opacity: biome.profile === 'carboniferous-coal-swamp' ? 0.92 : 0.93,
    roughness: biome.profile === 'carboniferous-coal-swamp' ? 0.24 : 0.2,
    side: DoubleSide,
    transparent: true,
    vertexColors: true,
  })
}

function addWetlandPools(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  heightAtWorld: HeightSampler,
  normalMap: Texture,
  waterMeshes: Mesh[],
): void {
  if (biome.profile === 'gobi-braided-basin') return
  const material = createWaterMaterial(biome, normalMap)
  const pools = biome.profile === 'carboniferous-coal-swamp'
    ? CARBONIFEROUS_WETLAND_POOLS
    : ([
        { depth: 7.5, width: 23, x: 82, y: -0.4, yaw: 0.18, z: -76 },
      ] as const)
  pools.forEach(({ depth, width, x, y, yaw, z }, index) => {
    const segmentCount = 56
    const positions: number[] = [x, y, z]
    const colours: number[] = []
    const uvs: number[] = [0, 0]
    const indices: number[] = []
    const bankPositions: number[] = []
    const bankColours: number[] = []
    const bankIndices: number[] = []
    const centreColour = new Color(biome.palette.water ?? '#55766e').multiplyScalar(0.82)
    const edgeColour = new Color(biome.palette.water ?? '#55766e').lerp(
      new Color(biome.palette.groundDark),
      0.26,
    )
    centreColour.toArray(colours, 0)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2
      const irregularity =
        1 +
        Math.sin(angle * 3 + index * 1.8) * 0.18 +
        Math.cos(angle * 7 - index) * 0.085 +
        Math.sin(angle * 13 + index * 0.7) * 0.035
      const localX = Math.cos(angle) * width * irregularity
      const localZ = Math.sin(angle) * depth * irregularity
      const rotatedX = localX * Math.cos(yaw) - localZ * Math.sin(yaw)
      const rotatedZ = localX * Math.sin(yaw) + localZ * Math.cos(yaw)
      const innerX = x + rotatedX
      const innerZ = z + rotatedZ
      const outerX = x + rotatedX * 1.28
      const outerZ = z + rotatedZ * 1.28
      positions.push(
        innerX,
        y + Math.sin(angle * 5 + index) * 0.008,
        innerZ,
      )
      edgeColour.toArray(colours, colours.length)
      uvs.push(rotatedX / 6, rotatedZ / 6)
      bankPositions.push(
        outerX,
        heightAtWorld(outerX, outerZ) + 0.02,
        outerZ,
        innerX,
        y - 0.09,
        innerZ,
      )
      new Color(
        biome.profile === 'carboniferous-coal-swamp'
          ? biome.palette.groundDark
          : biome.palette.groundMid,
      )
        .multiplyScalar(
          biome.profile === 'carboniferous-coal-swamp' ? 0.84 : 1,
        )
        .toArray(bankColours, bankColours.length)
      new Color(biome.palette.groundDark)
        .multiplyScalar(0.72)
        .toArray(bankColours, bankColours.length)
      const next = (segment + 1) % segmentCount
      indices.push(0, segment + 1, next + 1)
      const currentBank = segment * 2
      const nextBank = next * 2
      bankIndices.push(
        currentBank,
        currentBank + 1,
        nextBank + 1,
        currentBank,
        nextBank + 1,
        nextBank,
      )
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    )
    geometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(colours), 3),
    )
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const pool = new Mesh(geometry, material)
    pool.name =
      biome.profile === 'carboniferous-coal-swamp'
        ? `scale-encounter-${biome.themeId}-swamp-pool-${index + 1}`
        : `scale-encounter-${biome.themeId}-seasonal-oxbow-${index + 1}`
    pool.renderOrder = 1
    pool.receiveShadow = true
    pool.userData.scaleEncounterWaterBaseY = 0
    const bankGeometry = new BufferGeometry()
    bankGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(bankPositions), 3),
    )
    bankGeometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(bankColours), 3),
    )
    bankGeometry.setIndex(bankIndices)
    bankGeometry.computeVertexNormals()
    const bank = new Mesh(
      bankGeometry,
      new MeshStandardMaterial({
        metalness: 0,
        roughness: 0.98,
        vertexColors: true,
      }),
    )
    bank.name = `${pool.name}-integrated-mud-bank`
    bank.receiveShadow = true
    root.add(bank, pool)
    waterMeshes.push(pool)
  })
}

function addLighting(root: Group, biome: ScaleEncounterPreparedLandBiome): void {
  const hemisphere = new HemisphereLight(
    biome.atmosphere.hemisphereSky,
    biome.atmosphere.hemisphereGround,
    biome.atmosphere.hemisphereIntensity,
  )
  hemisphere.name = `scale-encounter-${biome.themeId}-hemisphere-light`
  const sun = new DirectionalLight(biome.palette.sun, biome.atmosphere.sunIntensity)
  sun.name = `scale-encounter-${biome.themeId}-sun-light`
  sun.position.set(...biome.atmosphere.sunPosition)
  sun.castShadow = true
  sun.shadow.mapSize.set(2_048, 2_048)
  sun.shadow.camera.left = -42
  sun.shadow.camera.right = 42
  sun.shadow.camera.top = 42
  sun.shadow.camera.bottom = -42
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 260
  sun.shadow.bias = -0.00015
  sun.shadow.normalBias = 0.015
  sun.shadow.radius = 1.6
  sun.target.name = `scale-encounter-${biome.themeId}-sun-target`
  root.add(hemisphere, sun, sun.target)
  if (biome.profile !== 'carboniferous-coal-swamp') {
    const fill = new DirectionalLight('#e8edf1', 1.65)
    fill.name = `scale-encounter-${biome.themeId}-sky-bounce`
    fill.position.set(-sun.position.x, 42, -sun.position.z)
    fill.target.position.set(0, 2, 0)
    root.add(fill, fill.target)
  }
  if (biome.profile === 'carboniferous-coal-swamp') {
    // A broad camera-side bounce keeps the child and Meganeura readable under
    // the tall wetland canopy without flattening the sun/contact shadows.
    const foregroundFill = new DirectionalLight('#e8f1e5', 1.18)
    foregroundFill.name =
      'scale-encounter-carboniferous-foreground-bounce-light'
    foregroundFill.position.set(36, 42, 96)
    foregroundFill.castShadow = false
    foregroundFill.target.name =
      'scale-encounter-carboniferous-foreground-bounce-target'
    foregroundFill.target.position.set(0, 4, 0)
    root.add(foregroundFill, foregroundFill.target)
  }
}

function addSedimentBars(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  random: RandomSource,
): void {
  if (biome.profile !== 'kayenta-seasonal-floodplain') return
  const count = 18
  const mesh = new InstancedMesh(
    new CircleGeometry(1, 28),
    new MeshStandardMaterial({ color: '#c18a5d', roughness: 1, side: DoubleSide }),
    count,
  )
  mesh.name = 'scale-encounter-floodplain-overbank-sediment-bars'
  for (let index = 0; index < count; index += 1) {
    const longitudinal =
      -240 +
      (index / Math.max(count - 1, 1)) * 480 +
      (random() - 0.5) * 12
    const width = channelHalfWidth(biome.profile, longitudinal)
    const midChannelBar = index % 3 === 0
    const lateral = midChannelBar
      ? (random() - 0.5) * width * 0.92
      : (random() < 0.5 ? -1 : 1) * (width + 2 + random() * 7)
    const position = channelCoordinates(
      biome.profile,
      longitudinal,
      lateral,
    )
    const helper = new Object3D()
    helper.position.set(
      position.x,
      waterLevelFor(biome) + 0.055 + random() * 0.07,
      position.z,
    )
    helper.rotation.set(-Math.PI / 2, 0, random() * Math.PI)
    helper.scale.set(
      (midChannelBar ? 1.8 : 1.1) + random() * (midChannelBar ? 3.8 : 2.6),
      (midChannelBar ? 0.55 : 0.4) + random() * 1.15,
      1,
    )
    helper.updateMatrix()
    mesh.setMatrixAt(index, helper.matrix)
  }
  finishInstances(mesh)
  mesh.castShadow = false
  root.add(mesh)
}

function publishThemeDiagnostics(
  root: Group,
  biome: ScaleEncounterPreparedLandBiome,
  population: Readonly<Record<string, number>>,
): void {
  root.userData.scaleEncounterEnvironmentAssetStatus = 'active'
  root.userData.scaleEncounterEnvironmentBaselineReady = true
  root.userData.scaleEncounterEnvironmentLoadPolicy = 'selected-theme-only'
  root.userData.scaleEncounterEnvironmentRevealPolicy =
    'keep-current-scene-until-baseline-ready'
  root.userData.scaleEncounterEnvironmentRuntimeKind = 'procedural-biome'
  root.userData.scaleEncounterEnvironmentRuntimeTheme = biome.themeId
  root.userData.scaleEncounterEnvironmentTargetTheme = biome.themeId
  root.userData.scaleEncounterEnvironmentUsingCompatibilityFallback = false
  root.userData.scaleEncounterGeneratedAssetBoundary =
    'authored-art-plates-scanned-props-and-continuous-terrain'
  root.userData.scaleEncounterFarFieldRepresentation =
    'depth-writing-world-space-landforms-and-vegetation'
  root.userData.scaleEncounterLandBiomeProfile = biome.profile
  root.userData.scaleEncounterLandBiomeRevision = biome.revision
  root.userData.scaleEncounterLandBiomePopulation = population
  root.userData.scaleEncounterScientificBasis = [...biome.scientificBasis]
}

export function createScaleEncounterProceduralLandBiome(
  biome: ScaleEncounterPreparedLandBiome,
  variant: ScaleEncounterEnvironmentVariant,
  options: ScaleEncounterEnvironmentOptions,
  panoramaTexture: Texture | null = null,
): ScaleEncounterEnvironment {
  const root = new Group()
  root.name = `scale-encounter-environment-${biome.themeId}-${variant}`
  const heightAtWorld = createHeightSampler(biome)
  const random = seededRandom(biome.seed)
  const surfaceTextures = options.surfaceTextures ?? null
  const borrowedTextures = new Set<Texture>()
  if (panoramaTexture) borrowedTextures.add(panoramaTexture)
  if (surfaceTextures) {
    borrowedTextures.add(surfaceTextures.albedo)
    if (surfaceTextures.uniqueAlbedo) borrowedTextures.add(surfaceTextures.uniqueAlbedo)
    borrowedTextures.add(surfaceTextures.normal)
    borrowedTextures.add(surfaceTextures.roughness)
    if (surfaceTextures.landBiomeFrondAtlas) {
      borrowedTextures.add(surfaceTextures.landBiomeFrondAtlas)
    }
  }
  if (options.matureTreeAtlas) {
    borrowedTextures.add(options.matureTreeAtlas)
  }
  const skyDome = panoramaTexture
    ? createPanoramaDome(biome, panoramaTexture, options.maxAnisotropy ?? 1)
    : createSkyDome(biome)
  const terrain = createTerrain(
    biome,
    heightAtWorld,
    options.maxAnisotropy ?? 1,
    surfaceTextures,
  )
  root.add(skyDome, terrain, createHorizonMistRing(biome))
  addLighting(root, biome)
  if (!surfaceTextures?.uniqueAlbedo) addDistantRidge(root, biome, heightAtWorld, surfaceTextures)
  if (biome.profile === 'carboniferous-coal-swamp') addSedimentBars(root, biome, random)

  const waterMeshes: Mesh[] = []
  let river: RiverWater | null = null
  let waterNormalTexture: DataTexture | null = null
  if (biome.profile !== 'carboniferous-coal-swamp' && biome.palette.water) {
    river = createRiverWater(heightAtWorld,
      biome.profile === 'gobi-braided-basin' ? gobiRiverCentreZ : floodplainRiverCentreZ,
      waterLevelFor(biome),
    )
    river.name = `scale-encounter-${biome.themeId}-seasonal-channel-water`
    root.add(river)
  } else if (biome.profile === 'carboniferous-coal-swamp' && biome.palette.water) {
    waterNormalTexture = createWaterNormalTexture()
    addWetlandPools(root, biome, heightAtWorld, waterNormalTexture, waterMeshes)
  }

  const scannedPopulation = options.forestProps
    ? addScannedGroundProps(
        root,
        biome,
        options.forestProps,
        borrowedTextures,
        heightAtWorld,
        random,
        options.ecologyDensity,
      )
    : null
  if (
    biome.profile === 'kayenta-seasonal-floodplain' &&
    options.forestProps &&
    options.matureTreeAtlas
  ) {
    const requestedDensity = options.ecologyDensity ?? 'current'
    // The established forest succeeds because real trunks overlap in several
    // depth bands. Give the river margin the same world-space density while
    // preserving the user's explicit 1.5x ceiling.
    const density = requestedDensity
    root.add(
      createScaleEncounterProductionMidground(
        heightAtWorld,
        density,
        options.forestProps,
        borrowedTextures,
        options.matureTreeAtlas,
        null,
        ['araucarian-conifer'],
      ),
      createScaleEncounterProductionFarDepth(
        heightAtWorld,
        density,
        options.forestProps,
        borrowedTextures,
        options.matureTreeAtlas,
      ),
    )
    addFloodplainRiparianWoodland(
      root,
      biome,
      options.ecologyDensity,
      heightAtWorld,
      options.matureTreeAtlas,
    )
  }
  if (biome.profile === 'gobi-braided-basin' && options.matureTreeAtlas) {
    addFloodplainRiparianWoodland(root, biome, options.ecologyDensity, heightAtWorld, options.matureTreeAtlas)
  }
  if (
    biome.profile === 'carboniferous-coal-swamp' &&
    options.forestProps &&
    surfaceTextures?.landBiomeFrondAtlas
  ) {
    const density = '1.5x'
    const treeFernForest = createScaleEncounterProductionMidground(
      heightAtWorld,
      density,
      options.forestProps,
      borrowedTextures,
      null,
      null,
      ['tree-fern'],
      surfaceTextures.landBiomeFrondAtlas,
    )
    treeFernForest.name =
      'scale-encounter-carboniferous-world-space-tree-fern-forest'
    treeFernForest.rotation.y = 0.34
    root.add(treeFernForest)

    // The accepted forest gets its depth from overlapping world-space bands.
    // A wider, independently rotated band fills the humid distance without
    // vertically stretching the nearer supports into telephone-pole palms.
    const farTreeFernForest = createScaleEncounterProductionMidground(
      heightAtWorld,
      density,
      options.forestProps,
      borrowedTextures,
      null,
      null,
      ['tree-fern'],
      surfaceTextures.landBiomeFrondAtlas,
    )
    farTreeFernForest.name =
      'scale-encounter-carboniferous-world-space-far-tree-fern-forest'
    farTreeFernForest.rotation.y = -0.51
    farTreeFernForest.scale.set(2.08, 1.42, 2.08)
    root.add(farTreeFernForest)

    const horizonTreeFernForest = createScaleEncounterProductionMidground(
      heightAtWorld,
      density,
      options.forestProps,
      borrowedTextures,
      null,
      null,
      ['tree-fern'],
      surfaceTextures.landBiomeFrondAtlas,
    )
    horizonTreeFernForest.name =
      'scale-encounter-carboniferous-world-space-horizon-tree-fern-forest'
    horizonTreeFernForest.rotation.y = 1.16
    horizonTreeFernForest.scale.set(3.05, 2.28, 3.05)
    root.add(horizonTreeFernForest)
  }
  const needsCarboniferousCanopy =
    biome.profile === 'carboniferous-coal-swamp'
  const population = {
    calamites:
      needsCarboniferousCanopy || !scannedPopulation
        ? addCalamites(root, biome, options.ecologyDensity, heightAtWorld, random)
        : 0,
    distantLandforms: addDistantLandforms(
      root,
      biome,
      heightAtWorld,
      random,
      surfaceTextures,
    ),
    ferns: scannedPopulation
      ? 0
      : addFerns(root, biome, options.ecologyDensity, heightAtWorld, random),
    gravel:
      !scannedPopulation
        ? addGravel(root, biome, options.ecologyDensity, heightAtWorld, random)
        : 0,
    lycopsids:
      needsCarboniferousCanopy || !scannedPopulation
        ? addLycopsids(
            root,
            biome,
            options.ecologyDensity,
            heightAtWorld,
            random,
            surfaceTextures?.landBiomeFrondAtlas ?? null,
          )
        : 0,
    riparianPlants:
      !scannedPopulation
        ? addRiparianPlants(
            root,
            biome,
            options.ecologyDensity,
            heightAtWorld,
            random,
          )
        : 0,
    scannedBranches: scannedPopulation?.branch ?? 0,
    scannedFerns: scannedPopulation?.fern ?? 0,
    scannedLogs: scannedPopulation?.log ?? 0,
    scannedRocks: scannedPopulation?.rock ?? 0,
    scannedShrubs: scannedPopulation?.shrub ?? 0,
    shrubs: scannedPopulation
      ? 0
      : addShrubs(root, biome, options.ecologyDensity, heightAtWorld, random),
    treeFerns:
      needsCarboniferousCanopy || !scannedPopulation
        ? addTreeFerns(
            root,
            biome,
            options.ecologyDensity,
            heightAtWorld,
            random,
            surfaceTextures?.landBiomeFrondAtlas ?? null,
          )
        : 0,
  }
  publishThemeDiagnostics(root, biome, population)

  return {
    animalContactCue: null,
    borrowedTextures,
    cameraCentredSkyDome: true,
    cameraFarMeters: 540,
    childContactCue: null,
    distanceFogColour: new Color(biome.palette.fog),
    fog: new Fog(
      biome.palette.fog,
      biome.atmosphere.fogNearMeters,
      biome.atmosphere.fogFarMeters,
    ),
    groundHeightAtWorld: heightAtWorld,
    ownsLighting: true,
    panoramaTexture,
    root,
    sceneCandidateSemantic: 'land-biome',
    sceneCandidateVariant: 'off',
    skyDome,
    toneMappingExposure: biome.atmosphere.exposure,
    variant,
    updateCandidate: (elapsedSeconds, reducedMotion, camera, visitor) => {
      river?.updateWater(elapsedSeconds, reducedMotion, camera, visitor)
      if (reducedMotion) return
      if (waterNormalTexture) {
        waterNormalTexture.offset.set(
          (elapsedSeconds * 0.011) % 1,
          (elapsedSeconds * -0.018) % 1,
        )
      }
      waterMeshes.forEach((water, index) => {
        const baseY = Number(water.userData.scaleEncounterWaterBaseY ?? water.position.y)
        water.position.y =
          baseY + Math.sin(elapsedSeconds * 0.28 + index * 1.7) * 0.004
        const material = water.material as Material & { opacity?: number }
        if (typeof material.opacity === 'number') {
          const baseline =
            biome.profile === 'carboniferous-coal-swamp' ? 0.92 : 0.93
          material.opacity =
            baseline + Math.sin(elapsedSeconds * 0.21 + index) * 0.008
        }
      })
    },
  }
}
