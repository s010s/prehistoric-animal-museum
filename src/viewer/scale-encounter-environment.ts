import {
  BackSide,
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Material,
  type Object3DEventMap,
  type Texture,
} from 'three'
import { disposeObject3D } from './dispose'
import type {
  ScaleEncounterAnimalId,
  ScaleEncounterHabitat,
} from './scale-encounter'
import {
  createScaleEncounterForestScatter,
  type ScaleEncounterForestPropPlacement,
} from './scale-encounter-forest-scatter-prototype'
import {
  SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES,
  createScaleEncounterProductionForestScatter,
  type ScaleEncounterProductionEcologyBatch,
  type ScaleEncounterProductionEcologyKind,
  type ScaleEncounterProductionEcologyPlacement,
} from './scale-encounter-production-forest-scatter'
import { applyScaleEncounterHybridGroundMaterialPrototype } from './scale-encounter-ground-material-prototype'
import {
  SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS,
  createScaleEncounterProductionTerrainGeometry,
  scaleEncounterProductionTerrainHeightAtWorld,
} from './scale-encounter-production-terrain'
import { scaleEncounterProductionPropTranslationY } from './scale-encounter-production-prop-grounding'
import { createScaleEncounterProductionMidground } from './scale-encounter-production-midground'
import { createScaleEncounterProductionFarDepth } from './scale-encounter-production-far-depth'
import { createScaleEncounterProductionGroundDetail } from './scale-encounter-production-ground-detail'
import { createScaleEncounterProductionUnderstory } from './scale-encounter-production-understory'
import { applyScaleEncounterStochasticGroundMaterialCandidate } from './scale-encounter-stochastic-ground-material-candidate'
import {
  scaleEncounterEcologyCount,
  type ScaleEncounterEcologyDensity,
} from './scale-encounter-ecology-density'

export type ScaleEncounterEnvironmentVariant =
  | 'baseline'
  | 'ground-slice'
  | 'hybrid-slice'
  | 'production-slice'

export const SCALE_ENCOUNTER_ENVIRONMENT_VARIANTS = [
  'baseline',
  'ground-slice',
  'hybrid-slice',
  'production-slice',
] as const satisfies readonly ScaleEncounterEnvironmentVariant[]

const SCALE_ENCOUNTER_SURFACE_RADIUS_METERS = 360
const SCALE_ENCOUNTER_GROUND_WORLD_Y =
  SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS

function surfaceRepeatCount(physicalWidthMeters: number): number {
  return (SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2) / physicalWidthMeters
}

export interface ScaleEncounterEnvironment {
  readonly animalContactCue: Mesh | null
  readonly borrowedTextures: ReadonlySet<Texture>
  readonly childContactCue: Mesh | null
  readonly distanceFogColour: Color | null
  readonly panoramaTexture: Texture | null
  readonly root: Group
  readonly skyDome: Mesh
  readonly variant: ScaleEncounterEnvironmentVariant
}

export interface ScaleEncounterSurfaceTextures {
  readonly albedo: Texture
  /** Optional second albedo scan used only by the production forest biome. */
  readonly dryLitterAlbedo?: Texture | null
  readonly normal: Texture
  readonly physicalWidthMeters: number
  readonly roughness: Texture
}

export interface ScaleEncounterEnvironmentOptions {
  readonly animalId?: ScaleEncounterAnimalId
  readonly ecologyDensity?: ScaleEncounterEcologyDensity
  readonly forestProps?: Group<Object3DEventMap> | null
  readonly matureTreeAtlas?: Texture | null
  readonly maxAnisotropy?: number
  readonly surfaceTextures?: ScaleEncounterSurfaceTextures | null
}

function createMesh(
  name: string,
  geometry: BufferGeometry,
  material: Material,
): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  return mesh
}

function createGradientDome(
  habitat: ScaleEncounterHabitat,
): Mesh {
  const palettes = {
    land: {
      bottom: new Color('#d7c9a0'),
      horizon: new Color('#afc7b2'),
      top: new Color('#789fb0'),
    },
    air: {
      bottom: new Color('#e9f1e8'),
      horizon: new Color('#a9d4e3'),
      top: new Color('#568eb9'),
    },
    water: {
      bottom: new Color('#073945'),
      horizon: new Color('#176978'),
      top: new Color('#79bfc0'),
    },
  } as const
  const geometry = new SphereGeometry(118, 32, 18)
  const positions = geometry.getAttribute('position')
  const colours = new Float32Array(positions.count * 3)
  const palette = palettes[habitat]
  const colour = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const y = positions.getY(index) / 118
    const upper = Math.max(0, y)
    if (y >= 0) {
      colour.copy(palette.horizon).lerp(palette.top, Math.min(upper, 1))
    } else {
      colour
        .copy(palette.horizon)
        .lerp(palette.bottom, Math.min(Math.abs(y), 1))
    }
    colour.toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  const dome = createMesh(
    `scale-encounter-${habitat}-dome`,
    geometry,
    new MeshBasicMaterial({
      depthWrite: false,
      side: BackSide,
      vertexColors: true,
    }),
  )
  dome.renderOrder = -100
  return dome
}

function createPanoramaDome(texture: Texture, toneMapped = false): Mesh {
  const geometry = new SphereGeometry(118, 64, 32)
  // This is Three.js's documented panorama-sphere orientation: flip the
  // sphere geometry once and render its front faces from the inside. Keeping
  // the texture itself unflipped prevents the equirectangular seam and left /
  // right directions from reversing during camera moves.
  geometry.scale(-1, 1, 1)
  if (toneMapped) {
    // D's plate is a calibrated far field, but its photographed treeline
    // occupied too many vertical degrees at the encounter's 38° lens and read
    // as giant soft trees immediately behind the subjects. Remap only the
    // dome's latitude sampling with a smooth, monotonic curve: the equatorial
    // treeline becomes roughly 45% thinner while seam longitude and both poles
    // remain exact. Geometry, terrain and parallax proxies still own all near
    // and middle distance; this is not a colour-blend disguise.
    const uvs = geometry.getAttribute('uv')
    // The v5 plate is a sky/far-field source. Its equirectangular equator still
    // contains photographed trees that would otherwise project at near-forest
    // scale behind our world-space canopy. Compress that narrow latitude band
    // so the plate reads as a distant treeline; the 0–102 m depth is now owned
    // by grounded geometry rather than enlarged photographic trunks.
    const latitudeCompression = 4.8
    const normalization = Math.tanh(latitudeCompression * 0.5)
    for (let index = 0; index < uvs.count; index += 1) {
      const v = uvs.getY(index)
      const remappedV =
        0.5 +
        (0.5 * Math.tanh(latitudeCompression * (v - 0.5))) /
          normalization
      uvs.setY(index, remappedV)
    }
    uvs.needsUpdate = true
  }
  const dome = createMesh(
    'scale-encounter-panorama-dome',
    geometry,
    new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      map: texture,
      toneMapped,
    }),
  )
  dome.frustumCulled = false
  dome.renderOrder = -100
  return dome
}

function configureSurfaceTextures(
  textures: ScaleEncounterSurfaceTextures,
  maxAnisotropy: number,
  repeats: number,
  rotationRadians: number,
): void {
  for (const texture of [
    textures.albedo,
    textures.normal,
    textures.roughness,
    textures.dryLitterAlbedo,
  ]) {
    if (!texture) continue
    texture.anisotropy = Math.max(1, Math.min(maxAnisotropy, 8))
    texture.center.set(0.5, 0.5)
    texture.repeat.set(repeats, repeats)
    // Keep all PBR channels aligned while avoiding a screen-horizontal scan
    // direction that reads as repeated rows in the long overview perspective.
    texture.rotation = rotationRadians
    texture.needsUpdate = true
  }
}

function smoothstep(start: number, end: number, value: number): number {
  const progress = Math.max(0, Math.min(1, (value - start) / (end - start)))
  return progress * progress * (3 - 2 * progress)
}

const FOREST_TERRAIN_RING_RADII = [
  2,
  4,
  6,
  8,
  10,
  12,
  14,
  16,
  18,
  20,
  22,
  25,
  28,
  32,
  36,
  41,
  47,
  54,
  62,
  72,
  84,
  98,
  114,
  132,
  154,
  180,
  212,
  252,
  302,
  SCALE_ENCOUNTER_SURFACE_RADIUS_METERS,
] as const
const FOREST_SUBJECT_CLEARING_RADIUS_METERS = 22
const FOREST_RELIEF_FULL_STRENGTH_RADIUS_METERS = 52

function forestTerrainHeight(
  x: number,
  y: number,
  withMiddleDistance: boolean,
): number {
  const radius = Math.hypot(x, y)
  const angle = Math.atan2(y, x)
  // The T. rex and the child's full 6.5–18 m observation rail fit inside this
  // clearing. Every relief source must use the same C1-continuous mask: even a
  // distant Gaussian has a non-zero tail at the origin and previously lifted
  // the hybrid slice by about half a metre through the planted feet.
  const nearRelief = smoothstep(
    FOREST_SUBJECT_CLEARING_RADIUS_METERS,
    FOREST_RELIEF_FULL_STRENGTH_RADIUS_METERS,
    radius,
  )
  const broadRelief =
    Math.sin(x * 0.071 + 0.4) * 0.22 +
    Math.cos(y * 0.057 - 0.7) * 0.19 +
    Math.sin((x + y) * 0.031 + 1.2) * 0.3 +
    Math.cos((x - y) * 0.018) * 0.25
  // Several offset landforms replace the old circular berm. Their overlapping
  // silhouettes meet the photographic forest at different depths and angles,
  // so the panorama no longer reads as a straight wall behind a flat floor.
  const landforms = withMiddleDistance
    ? Math.exp(-(((x + 48) / 52) ** 2 + ((y - 112) / 39) ** 2)) * 7.2 +
      Math.exp(-(((x - 71) / 62) ** 2 + ((y - 136) / 48) ** 2)) * 8.8 +
      Math.exp(-(((x + 126) / 74) ** 2 + ((y - 18) / 56) ** 2)) * 5.4 +
      Math.exp(-(((x - 142) / 82) ** 2 + ((y + 44) / 67) ** 2)) * 6.2
    : 0
  const outerLift =
    (withMiddleDistance ? smoothstep(96, 292, radius) : 0) *
    (1.8 + Math.sin(angle * 3.7 - 0.2) * 0.72)
  return nearRelief * (broadRelief + landforms) + outerLift
}

function forestGroundColour(x: number, y: number, target: Color): Color {
  const radius = Math.hypot(x, y)
  const farBlend = smoothstep(35, 176, radius)
  const macroPatch =
    0.5 +
    Math.sin(x * 0.033 + y * 0.017) * 0.22 +
    Math.cos(x * 0.012 - y * 0.027 + 0.8) * 0.18 +
    Math.sin((x - y) * 0.064) * 0.1
  const damp = new Color('#677356')
  const dry = new Color('#b7aa7e')
  const distant = new Color('#3e5742')
  target
    .copy(damp)
    .lerp(dry, Math.max(0.08, Math.min(0.9, macroPatch)))
    .lerp(distant, farBlend * 0.9)
  return target
}

function createForestGroundGeometry(
  withMiddleDistance: boolean,
): BufferGeometry {
  const angularSegments = 96
  const positions: number[] = [0, 0, 0]
  const colours: number[] = []
  const uvs: number[] = [0.5, 0.5]
  const indices: number[] = []
  const colour = forestGroundColour(0, 0, new Color())
  colour.toArray(colours, 0)

  FOREST_TERRAIN_RING_RADII.forEach((radius) => {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      positions.push(x, y, forestTerrainHeight(x, y, withMiddleDistance))
      forestGroundColour(x, y, colour).toArray(colours, colours.length)
      uvs.push(
        x / (SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2) + 0.5,
        y / (SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2) + 0.5,
      )
    }
  })

  for (let segment = 0; segment < angularSegments; segment += 1) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % angularSegments))
  }
  for (
    let ring = 1;
    ring < FOREST_TERRAIN_RING_RADII.length;
    ring += 1
  ) {
    const innerStart = 1 + (ring - 1) * angularSegments
    const outerStart = 1 + ring * angularSegments
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const next = (segment + 1) % angularSegments
      indices.push(
        innerStart + segment,
        outerStart + segment,
        outerStart + next,
        innerStart + segment,
        outerStart + next,
        innerStart + next,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createLandGroundGeometry(
  snow: boolean,
  forestUpgrade:
    | 'none'
    | 'ground-slice'
    | 'hybrid-slice'
    | 'production-slice',
): BufferGeometry {
  if (!snow && forestUpgrade !== 'none') {
    if (forestUpgrade === 'production-slice') {
      return createScaleEncounterProductionTerrainGeometry()
    }
    return createForestGroundGeometry(
      forestUpgrade === 'hybrid-slice',
    )
  }
  const diameter = SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2
  const geometry = new PlaneGeometry(diameter, diameter, 80, 80)
  const positions = geometry.getAttribute('position')
  const colours = new Float32Array(positions.count * 3)
  const nearColour = new Color(snow ? '#f3f6f8' : '#c2bb95')
  const farColour = new Color(snow ? '#c2d1dc' : '#52674c')
  const colour = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const radius = Math.hypot(x, y)
    // Keep the reviewed child/animal floor perfectly stable, then introduce
    // broad metre-scale undulation toward the middle distance. This gives the
    // camera genuine ground parallax and breaks the photograph/plane ruler
    // line without moving either subject's foot anchor.
    const relief = smoothstep(18, 78, radius)
    const angle = Math.atan2(y, x)
    const broadRelief =
      Math.sin(x * 0.019) * (snow ? 0.28 : 0.52) +
      Math.cos(y * 0.016) * (snow ? 0.22 : 0.44) +
      Math.sin((x + y) * 0.043) * (snow ? 0.12 : 0.22)
    // A broad, irregular middle-distance ridge hides the mathematically
    // straight meeting line between an infinite panorama and a world-space
    // plane. It begins well outside the child/animal floor and reads as soft
    // forest terrain or snow drifts, not as a row of proxy boulders.
    const ridgeBand = Math.exp(-Math.pow((radius - 132) / 54, 2))
    const ridgeProfile =
      0.66 +
      Math.sin(angle * 3 + 0.45) * 0.2 +
      Math.sin(angle * 7 - 0.8) * 0.1 +
      Math.cos(angle * 11 + 1.2) * 0.04
    const ridgeHeight =
      ridgeBand * Math.max(0.2, ridgeProfile) * (snow ? 4.8 : 8.4)
    const outerLift =
      smoothstep(90, 260, radius) *
      (snow ? 1.5 : 3.1) *
      (0.82 + Math.sin(angle * 5 - 0.4) * 0.18)
    const height = relief * broadRelief + ridgeHeight + outerLift
    positions.setZ(index, height)
    const horizonBlend = smoothstep(24, 136, radius)
    colour.copy(nearColour).lerp(farColour, horizonBlend)
    colour.toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

function createWaterSeabedGeometry(): PlaneGeometry {
  const diameter = SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2
  const geometry = new PlaneGeometry(diameter, diameter, 72, 72)
  const positions = geometry.getAttribute('position')
  const colours = new Float32Array(positions.count * 3)
  const nearColour = new Color('#c7d0b5')
  const farColour = new Color('#1f6268')
  const colour = new Color()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const radius = Math.hypot(x, y)
    const angle = Math.atan2(y, x)
    const distantBank =
      Math.exp(-Math.pow((radius - 128) / 62, 2)) *
      (3.4 +
        Math.sin(angle * 4 + 0.6) * 1.1 +
        Math.sin(angle * 7 - 0.2) * 0.48)
    positions.setZ(
      index,
      Math.sin(x * 0.052) * 0.32 +
        Math.cos(y * 0.041) * 0.26 +
        Math.sin((x - y) * 0.09) * 0.08 +
        distantBank,
    )
    colour
      .copy(nearColour)
      .lerp(farColour, smoothstep(34, 170, radius))
    colour.toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  return geometry
}

function createRadialAlphaTexture(): DataTexture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - size / 2) / (size / 2)
      const dy = (y + 0.5 - size / 2) / (size / 2)
      const distance = Math.min(1, Math.hypot(dx, dy))
      const strength = Math.max(0, 1 - distance * distance)
      const value = Math.round(255 * strength * strength)
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
  texture.needsUpdate = true
  return texture
}

function createGroundHorizonFadeTexture(
  kind: 'ground' | 'water' | 'air' = 'ground',
): DataTexture {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5 - size / 2) / (size / 2)
      const ny = (y + 0.5 - size / 2) / (size / 2)
      const radius = Math.hypot(nx, ny)
      const angle = Math.atan2(ny, nx)
      const irregularEdge =
        (kind === 'water' ? 0.54 : kind === 'air' ? 0.62 : 0.57) +
        Math.sin(angle * 5 + 0.4) * 0.035 +
        Math.sin(angle * 9 - 0.8) * 0.018
      // Yield to the infinite plate before the geometric plane reaches a ruler-
      // straight silhouette. The angle-dependent feather prevents a circular
      // cutout from replacing the old horizontal cut.
      const fadeStart = kind === 'air' ? 0.3 : kind === 'water' ? 0.16 : 0.18
      const strength = 1 - smoothstep(fadeStart, irregularEdge, radius)
      const value = Math.round(255 * strength)
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
  texture.needsUpdate = true
  return texture
}

function createVerticalHazeAlphaTexture(): DataTexture {
  const width = 64
  const height = 128
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const vertical = y / (height - 1)
    const verticalStrength =
      smoothstep(0.04, 0.38, vertical) *
      (1 - smoothstep(0.62, 0.98, vertical))
    for (let x = 0; x < width; x += 1) {
      const longitude = (x / width) * Math.PI * 2
      const variation =
        0.82 +
        Math.sin(longitude * 3 + 0.6) * 0.1 +
        Math.sin(longitude * 7 - 0.4) * 0.045
      const value = Math.round(
        255 * Math.max(0, Math.min(1, verticalStrength * variation)),
      )
      const offset = (y * width + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.needsUpdate = true
  return texture
}

function addHorizonHaze(
  root: Group,
  name: string,
  colour: string,
  opacity: number,
  verticalPosition: number,
): void {
  const haze = createMesh(
    name,
    new CylinderGeometry(250, 250, 18, 64, 4, true),
    new MeshBasicMaterial({
      alphaMap: createVerticalHazeAlphaTexture(),
      color: colour,
      depthTest: false,
      depthWrite: false,
      opacity,
      side: DoubleSide,
      transparent: true,
    }),
  )
  haze.position.y = verticalPosition
  haze.renderOrder = -12
  root.add(haze)
}

function createCloudAlphaTexture(): DataTexture {
  const size = 192
  const data = new Uint8Array(size * size * 4)
  const lobes = [
    [-0.42, 0.02, 0.42, 0.7],
    [-0.12, -0.12, 0.5, 0.95],
    [0.24, 0.03, 0.44, 0.82],
    [0.5, -0.02, 0.34, 0.58],
    [0.04, 0.2, 0.38, 0.66],
  ] as const
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5 - size / 2) / (size / 2)
      const ny = (y + 0.5 - size / 2) / (size / 2)
      let density = 0
      for (const [cx, cy, radius, weight] of lobes) {
        const distanceSquared =
          ((nx - cx) ** 2 + (ny - cy) ** 2) / (radius * radius)
        density += Math.exp(-distanceSquared * 2.1) * weight
      }
      const edge = Math.max(0, 1 - Math.hypot(nx * 0.78, ny * 1.15))
      const value = Math.round(
        255 * Math.max(0, Math.min(1, (density - 0.16) * 0.72 * edge)),
      )
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
  texture.needsUpdate = true
  return texture
}

function createLightShaftAlphaTexture(): DataTexture {
  const width = 128
  const height = 256
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const vertical = y / (height - 1)
    const halfWidth = 0.1 + (1 - vertical) * 0.42
    const endFade = Math.sin(Math.PI * vertical) ** 0.42
    for (let x = 0; x < width; x += 1) {
      const horizontal = Math.abs((x + 0.5) / width - 0.5) / halfWidth
      const edgeFade = Math.max(0, 1 - horizontal ** 2) ** 2
      const value = Math.round(255 * edgeFade * endFade)
      const offset = (y * width + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  )
  texture.needsUpdate = true
  return texture
}

function createGroundContactCue(
  name: string,
  colour: string,
  opacity: number,
  groundY = -0.018,
): Mesh {
  const cue = createMesh(
    name,
    new CircleGeometry(0.5, 48),
    new MeshBasicMaterial({
      alphaMap: createRadialAlphaTexture(),
      color: colour,
      depthWrite: false,
      opacity,
      side: DoubleSide,
      transparent: true,
    }),
  )
  cue.rotation.x = -Math.PI / 2
  cue.position.y = groundY
  cue.userData.scaleEncounterContactGroundY = groundY
  cue.renderOrder = -1
  cue.visible = false
  return cue
}

function addSnowGroundDepthAnchors(root: Group): void {
  const moundGeometry = new SphereGeometry(1, 12, 8)
  const moundColours = ['#dce5eb', '#cbd7df', '#eef2f4']
  const moundSpecs = [
    [-42, -28, 8.6, 2.3, 4.8],
    [-21, -38, 6.2, 1.7, 3.8],
    [18, -42, 7.4, 2.1, 4.5],
    [43, -25, 9.1, 2.5, 5.2],
    [58, -52, 11.5, 3.1, 6.8],
  ] as const
  moundSpecs.forEach(([x, z, width, height, depth], index) => {
    const mound = createMesh(
      `scale-encounter-snow-drift-${index + 1}`,
      moundGeometry.clone(),
      new MeshStandardMaterial({
        color: moundColours[index % moundColours.length]!,
        roughness: 0.98,
      }),
    )
    mound.position.set(x, height * 0.34 - 0.42, z)
    mound.rotation.y = index * 0.87
    mound.scale.set(width, height, depth)
    mound.renderOrder = -9
    root.add(mound)
  })
  moundGeometry.dispose()

  const rockGeometry = new SphereGeometry(1, 10, 7)
  const rockMaterial = new MeshStandardMaterial({
    color: '#59656b',
    roughness: 0.97,
  })
  const rocks = [
    [-31, -23, 1.45, 0.82, 1.1],
    [34, -32, 1.8, 1.05, 1.3],
  ] as const
  rocks.forEach(([x, z, width, height, depth], index) => {
    const rock = createMesh(
      `scale-encounter-snow-rock-${index + 1}`,
      rockGeometry.clone(),
      rockMaterial.clone(),
    )
    rock.position.set(x, height * 0.42 - 0.16, z)
    rock.rotation.set(0.08 * index, index * 0.73, -0.06 * index)
    rock.scale.set(width, height, depth)
    rock.renderOrder = -8
    root.add(rock)
  })
  rockGeometry.dispose()
  rockMaterial.dispose()
}

function addLegacyForestGroundDepthAnchors(root: Group): void {
  const moundGeometry = new SphereGeometry(1, 12, 8)
  const moundColours = ['#536348', '#414f3c', '#6b7453']
  const moundSpecs = [
    [-42, -28, 8.6, 2.3, 4.8],
    [-21, -38, 6.2, 1.7, 3.8],
    [18, -42, 7.4, 2.1, 4.5],
    [43, -25, 9.1, 2.5, 5.2],
    [58, -52, 11.5, 3.1, 6.8],
  ] as const
  moundSpecs.forEach(([x, z, width, height, depth], index) => {
    const mound = createMesh(
      `scale-encounter-moss-bank-${index + 1}`,
      moundGeometry.clone(),
      new MeshStandardMaterial({
        color: moundColours[index % moundColours.length]!,
        roughness: 0.98,
      }),
    )
    mound.position.set(x, height * 0.34 - 0.42, z)
    mound.rotation.y = index * 0.87
    mound.scale.set(width, height, depth)
    mound.renderOrder = -9
    root.add(mound)
  })
  moundGeometry.dispose()

  const log = createMesh(
    'scale-encounter-fallen-log',
    new CylinderGeometry(0.34, 0.52, 5.8, 14, 2),
    new MeshStandardMaterial({
      color: '#544432',
      roughness: 0.98,
    }),
  )
  log.position.set(-30, 0.42, -17)
  log.rotation.set(0.08, 0.46, Math.PI / 2)
  log.renderOrder = -8
  root.add(log)
}

function createFernGeometry(): BufferGeometry {
  const positions: number[] = []
  const frondCount = 9
  for (let index = 0; index < frondCount; index += 1) {
    const angle = (index / frondCount) * Math.PI * 2
    const sideAngle = angle + Math.PI / 2
    const length = 0.9 + (index % 3) * 0.16
    const halfWidth = 0.13 + (index % 2) * 0.025
    const baseX = Math.cos(sideAngle) * halfWidth
    const baseZ = Math.sin(sideAngle) * halfWidth
    const tipX = Math.cos(angle) * length
    const tipZ = Math.sin(angle) * length
    positions.push(
      -baseX,
      0.06,
      -baseZ,
      baseX,
      0.06,
      baseZ,
      tipX,
      0.34 + (index % 3) * 0.08,
      tipZ,
    )
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.computeVertexNormals()
  return geometry
}

function addForestGroundDetails(
  root: Group,
  withMiddleDistance: boolean,
): void {
  const dummy = new Object3D()
  const rockGeometry = new SphereGeometry(1, 8, 6)
  const rockPositions = rockGeometry.getAttribute('position')
  for (let index = 0; index < rockPositions.count; index += 1) {
    const x = rockPositions.getX(index)
    const y = rockPositions.getY(index)
    const z = rockPositions.getZ(index)
    const distortion =
      0.84 +
      Math.sin(x * 3.7 + z * 4.3) * 0.09 +
      Math.cos(y * 5.1 - x * 2.2) * 0.06
    rockPositions.setXYZ(index, x * distortion, y * distortion, z * distortion)
  }
  rockGeometry.computeVertexNormals()
  const allRockSpecs = [
    [-12, -18, 0.75, 0.42, 0.62],
    [17, -23, 1.1, 0.58, 0.82],
    [-24, -34, 1.45, 0.72, 1.08],
    [31, -39, 0.9, 0.46, 0.72],
    [-42, -53, 1.72, 0.86, 1.25],
    [48, -61, 1.28, 0.67, 0.98],
    [-64, -79, 2.15, 1.05, 1.52],
    [72, -91, 1.82, 0.88, 1.36],
  ] as const
  const rockSpecs = withMiddleDistance
    ? allRockSpecs
    : allRockSpecs.slice(0, 4)
  const rocks = new InstancedMesh(
    rockGeometry,
    new MeshStandardMaterial({
      color: '#5e6251',
      roughness: 0.99,
    }),
    rockSpecs.length,
  )
  rocks.name = 'scale-encounter-forest-rocks'
  rockSpecs.forEach(([x, z, width, height, depth], index) => {
    dummy.position.set(
      x,
      forestTerrainHeight(x, z, withMiddleDistance) + height * 0.34,
      z,
    )
    dummy.rotation.set(index * 0.07, index * 0.83, -index * 0.035)
    dummy.scale.set(width, height, depth)
    dummy.updateMatrix()
    rocks.setMatrixAt(index, dummy.matrix)
  })
  rocks.castShadow = true
  rocks.receiveShadow = true
  rocks.renderOrder = -8

  const allFernSpecs = [
    [-8, -21, 0.7],
    [-16, -26, 0.92],
    [11, -27, 0.82],
    [22, -31, 1.06],
    [-29, -38, 1.18],
    [35, -45, 0.95],
    [-46, -52, 1.32],
    [52, -57, 1.2],
    [-62, -69, 1.48],
    [66, -74, 1.36],
    [-78, -86, 1.65],
    [83, -94, 1.54],
  ] as const
  const fernSpecs = withMiddleDistance
    ? allFernSpecs
    : allFernSpecs.slice(0, 6)
  const ferns = new InstancedMesh(
    createFernGeometry(),
    new MeshStandardMaterial({
      color: '#566d48',
      roughness: 0.94,
      side: DoubleSide,
    }),
    fernSpecs.length,
  )
  ferns.name = 'scale-encounter-forest-ferns'
  fernSpecs.forEach(([x, z, scale], index) => {
    dummy.position.set(
      x,
      forestTerrainHeight(x, z, withMiddleDistance) + 0.025,
      z,
    )
    dummy.rotation.set(0, index * 1.71, 0)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    ferns.setMatrixAt(index, dummy.matrix)
  })
  ferns.castShadow = true
  ferns.receiveShadow = true
  ferns.renderOrder = -7

  const allLogSpecs = [
    [-27, -31, 0.1, 0.52, 1],
    [38, -54, -0.06, -0.34, 1.24],
    [-57, -72, 0.05, 0.74, 1.42],
  ] as const
  const logSpecs = withMiddleDistance
    ? allLogSpecs
    : allLogSpecs.slice(0, 1)
  const logs = new InstancedMesh(
    new CylinderGeometry(0.34, 0.52, 5.8, 14, 2),
    new MeshStandardMaterial({
      color: '#544432',
      roughness: 0.98,
    }),
    logSpecs.length,
  )
  logs.name = 'scale-encounter-forest-fallen-logs'
  logSpecs.forEach(([x, z, tilt, yaw, scale], index) => {
    dummy.position.set(
      x,
      forestTerrainHeight(x, z, withMiddleDistance) + 0.35 * scale,
      z,
    )
    dummy.rotation.set(tilt, yaw, Math.PI / 2)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    logs.setMatrixAt(index, dummy.matrix)
  })
  logs.castShadow = true
  logs.receiveShadow = true
  logs.renderOrder = -8
  root.add(rocks, ferns, logs)
}

function propTemplate(
  forestProps: Group<Object3DEventMap>,
  name: 'fern_02' | 'rock_07' | 'dead_tree_trunk' | 'shrub_04',
): Mesh | null {
  const productionName = {
    fern_02: 'fern_02_a_lod0',
    rock_07: 'rock_07_lod0',
    dead_tree_trunk: 'dead_tree_trunk_lod0',
    shrub_04: 'shrub_04_a_lod0',
  } as const
  const template =
    forestProps.getObjectByName(name) ??
    forestProps.getObjectByName(productionName[name])
  if (!template) return null
  let mesh: Mesh | null = null
  template.traverse((object) => {
    if (!mesh && object instanceof Mesh) mesh = object
  })
  return mesh
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

function createPropInstances(
  name: string,
  template: Mesh,
  placements: ReadonlyArray<ScaleEncounterForestPropPlacement>,
  kind: 'fern' | 'rock' | 'log' | 'shrub',
  withMiddleDistance: boolean,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld?: (worldX: number, worldZ: number) => number,
  productionTemplateRoot?: Group<Object3DEventMap>,
): InstancedMesh {
  const templateMaterials = Array.isArray(template.material)
    ? template.material
    : [template.material]
  templateMaterials.forEach((material) =>
    borrowMaterialTextures(material, borrowedTextures),
  )
  const materials = templateMaterials.map((material) => material.clone())
  if (kind === 'fern' || kind === 'shrub') {
    materials.forEach((material) => {
      material.side = DoubleSide
      material.alphaToCoverage = true
      if (material instanceof MeshStandardMaterial) {
        material.metalness = 0
        material.roughness = Math.max(0.84, material.roughness)
        material.envMapIntensity = Math.min(0.78, material.envMapIntensity)
      }
    })
  }
  const instances = new InstancedMesh(
    template.geometry.clone(),
    Array.isArray(template.material) ? materials : materials[0]!,
    placements.length,
  )
  instances.name = name

  // D may receive authored assets with transforms on the GLTF scene root or
  // an intermediate node. Resolve the mesh matrix relative to that template
  // root so a cached scene's own world transform cannot leak into instances.
  if (productionTemplateRoot) {
    productionTemplateRoot.updateMatrixWorld(true)
  }
  template.updateMatrixWorld(true)
  const relativeTemplateMatrix = productionTemplateRoot
    ? productionTemplateRoot.matrixWorld
        .clone()
        .invert()
        .multiply(template.matrixWorld)
    : template.matrixWorld.clone()
  template.geometry.computeBoundingBox()
  const templateGeometryBounds = template.geometry.boundingBox?.clone() ?? null
  const placementObject = new Object3D()
  const tiltObject = new Object3D()
  const placementMatrix = new Matrix4()
  const terrainNormal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawAroundLocalUp = new Quaternion()
  const groundingSamples: Array<{
    readonly groundingError: number
    readonly terrainY: number
    readonly worldBottomY: number
    readonly x: number
    readonly z: number
  }> = []
  placements.forEach((placement, index) => {
    const terrainSurfaceWorldY = terrainHeightAtWorld
      ? terrainHeightAtWorld(placement.x, placement.z)
      : forestTerrainHeight(placement.x, -placement.z, withMiddleDistance) +
        SCALE_ENCOUNTER_GROUND_WORLD_Y
    const scale =
      kind === 'rock'
        // Rock 07 is only 14 cm tall at source scale; these multipliers keep
        // the population in a believable 15–55 cm height range.
        ? placement.scale * 2.15
        : placement.scale
    const worldRadius = Math.hypot(placement.x, placement.z)
    const heroRockScale =
      kind === 'rock' && worldRadius < 44 && index % 4 === 0 ? 1.55 : 1
    const legacyBurial =
      kind === 'log' ? 0.075 * scale : kind === 'rock' ? 0.028 * scale : 0
    const productionBurial =
      kind === 'fern' || kind === 'shrub'
        ? 0.012 * scale
        : kind === 'rock'
          ? 0.022 * scale * heroRockScale
          : 0.036 * scale
    placementObject.position.set(
      placement.x,
      productionTemplateRoot
        ? 0
        : terrainSurfaceWorldY - legacyBurial,
      placement.z,
    )
    if (productionTemplateRoot && terrainHeightAtWorld) {
      productionEcologyTerrainNormal(
        terrainHeightAtWorld,
        placement.x,
        placement.z,
        kind,
        terrainNormal,
      )
      slopeAlignment.setFromUnitVectors(
        PRODUCTION_ECOLOGY_UP,
        terrainNormal,
      )
      yawAroundLocalUp.setFromAxisAngle(
        PRODUCTION_ECOLOGY_UP,
        placement.yaw,
      )
      tiltObject.rotation.set(placement.pitch, 0, placement.roll)
      placementObject.quaternion
        .copy(slopeAlignment)
        .multiply(yawAroundLocalUp)
        .multiply(tiltObject.quaternion)
    } else {
      placementObject.rotation.set(
        placement.pitch,
        placement.yaw,
        placement.roll,
      )
    }
    if (kind === 'rock') {
      placementObject.scale.set(
        scale * heroRockScale * placement.aspect,
        scale * heroRockScale * (0.92 + (index % 4) * 0.06),
        (scale * heroRockScale) / placement.aspect,
      )
    } else if (kind === 'fern' || kind === 'shrub') {
      // The source meshes are compact 0.2–0.6 m specimens. At the previous
      // scale the reviewed edge anchors collapsed into single green pixels in
      // overview, leaving only the much taller midground crowns readable.
      // Keep them knee-height and outside the participant corridor, but large
      // enough to form a genuine 6–30 m understorey layer.
      const fernScale = scale * (kind === 'fern' ? 0.68 : 0.92)
      placementObject.scale.set(
        fernScale * placement.aspect,
        fernScale,
        fernScale / placement.aspect,
      )
    } else {
      const logThickness = worldRadius < 44 && index < 2 ? 1.72 : 1
      placementObject.scale.set(
        scale,
        scale * logThickness * (0.9 + (index % 3) * 0.07),
        scale * logThickness,
      )
    }
    placementObject.updateMatrix()
    placementMatrix.multiplyMatrices(
      placementObject.matrix,
      relativeTemplateMatrix,
    )
    if (productionTemplateRoot && templateGeometryBounds) {
      placementObject.position.y = scaleEncounterProductionPropTranslationY(
        templateGeometryBounds,
        placementMatrix,
        terrainSurfaceWorldY,
        productionBurial,
      )
      placementObject.updateMatrix()
      placementMatrix.multiplyMatrices(
        placementObject.matrix,
        relativeTemplateMatrix,
      )
      const worldBottomY = templateGeometryBounds
        .clone()
        .applyMatrix4(placementMatrix).min.y
      groundingSamples.push({
        groundingError:
          worldBottomY - (terrainSurfaceWorldY - productionBurial),
        terrainY: terrainSurfaceWorldY,
        worldBottomY,
        x: placement.x,
        z: placement.z,
      })
    }
    instances.setMatrixAt(index, placementMatrix)
    if (kind === 'fern' || kind === 'shrub') {
      // The source scan is sunlit and otherwise turns lime against the muted
      // humid-forest grade. Instance colour keeps the genuine PBR texture and
      // its variation, while bringing scattered plants into the same olive /
      // moss family as the middle and far layers.
      const brightness = 0.54 + ((index * 7 + name.length) % 6) * 0.014
      instances.setColorAt(
        index,
        new Color().setRGB(
          brightness * 0.8,
          brightness * 0.91,
          brightness * 0.66,
        ),
      )
    }
  })
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.computeBoundingBox()
  instances.computeBoundingSphere()
  instances.castShadow = true
  instances.receiveShadow = true
  instances.userData.scaleEncounterGroundingSamples = groundingSamples
  return instances
}

interface ProductionEcologyTemplate {
  readonly mesh: Mesh
  readonly name: string
}

interface ProductionEcologyInstanceSample {
  readonly burialDepth: number
  readonly groundingError: number
  readonly instanceId: number
  readonly kind: ScaleEncounterProductionEcologyKind
  readonly placement: ScaleEncounterProductionEcologyPlacement
  readonly terrainY: number
  readonly templateName: string
  readonly worldBottomY: number
}

interface ProductionEcologyProjectionMetric {
  readonly encounterRadius: number
  readonly instanceId: number
  readonly maximumWorldDimension: number
  readonly worldCentre: Vector3
}

const PRODUCTION_ECOLOGY_UP = new Vector3(0, 1, 0)

function productionEcologyTemplate(
  forestProps: Group<Object3DEventMap>,
  name: string,
): ProductionEcologyTemplate | null {
  const object = forestProps.getObjectByName(name)
  if (!object) return null
  let mesh: Mesh | null = object instanceof Mesh ? object : null
  object.traverse((child) => {
    if (!mesh && child instanceof Mesh) mesh = child
  })
  return mesh ? { mesh, name } : null
}

function productionEcologyTerrainNormal(
  terrainHeightAtWorld: (worldX: number, worldZ: number) => number,
  x: number,
  z: number,
  kind: ScaleEncounterProductionEcologyKind,
  target: Vector3,
): Vector3 {
  const step =
    kind === 'log' ? 2.1 : kind === 'branch' ? 1.1 : kind === 'litter' || kind === 'moss' ? 0.9 : 0.42
  const slopeX =
    (terrainHeightAtWorld(x + step, z) -
      terrainHeightAtWorld(x - step, z)) /
    (step * 2)
  const slopeZ =
    (terrainHeightAtWorld(x, z + step) -
      terrainHeightAtWorld(x, z - step)) /
    (step * 2)
  return target.set(-slopeX, 1, -slopeZ).normalize()
}

function productionEcologyBaseScale(
  kind: ScaleEncounterProductionEcologyKind,
  templateName: string,
): number {
  if (kind === 'branch') return 1.05
  if (kind === 'fern') return 0.68
  if (kind === 'litter') return 1.7
  if (kind === 'moss') return 1.62
  if (kind === 'shrub') return 1.42
  if (kind === 'log') {
    return templateName.startsWith('dead_tree_trunk_02') ? 0.78 : 1.32
  }
  if (templateName.startsWith('rock_09')) return 9.2
  if (templateName.startsWith('stone_01')) return 5.2
  return 3.05
}

function configureProductionEcologyScale(
  placementObject: Object3D,
  kind: ScaleEncounterProductionEcologyKind,
  templateName: string,
  placement: ScaleEncounterProductionEcologyPlacement,
): number {
  const scale =
    productionEcologyBaseScale(kind, templateName) * placement.scale
  if (kind === 'log') {
    placementObject.scale.set(
      scale * (0.92 + (placement.patchId % 4) * 0.08),
      scale * (0.9 + (placement.patchId % 3) * 0.07),
      scale / placement.aspect,
    )
  } else if (kind === 'branch') {
    placementObject.scale.set(
      scale * placement.aspect,
      scale,
      scale / Math.sqrt(placement.aspect),
    )
  } else if (kind === 'moss' || kind === 'litter') {
    placementObject.scale.set(
      scale * placement.aspect,
      scale,
      scale / placement.aspect,
    )
  } else {
    placementObject.scale.set(
      scale * placement.aspect,
      scale * (0.9 + (placement.patchId % 5) * 0.04),
      scale / placement.aspect,
    )
  }
  return scale
}

function productionEcologyBurialDepth(
  kind: ScaleEncounterProductionEcologyKind,
  scale: number,
): number {
  if (kind === 'fern') return 0.014 * scale
  if (kind === 'shrub') return 0.017 * scale
  if (kind === 'rock') return 0.038 * scale
  if (kind === 'log') return 0.095 * scale
  if (kind === 'branch') return 0.032 * scale
  return 0
}

function productionEcologyTriangleCount(template: Mesh): number {
  return Math.floor(
    (template.geometry.index?.count ??
      template.geometry.getAttribute('position').count) / 3,
  )
}

function createProductionEcologyBatch(
  name: string,
  recipes: ReadonlyArray<ScaleEncounterProductionEcologyBatch>,
  templates: ReadonlyMap<string, ProductionEcologyTemplate>,
  forestProps: Group<Object3DEventMap>,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld: (worldX: number, worldZ: number) => number,
  castShadow: boolean,
): BatchedMesh | null {
  if (recipes.length === 0) return null
  const recipeTemplates = recipes.map((recipe) => templates.get(recipe.templateName)!)
  const allIndexed = recipeTemplates.every(
    ({ mesh }) => mesh.geometry.index !== null,
  )
  const allNonIndexed = recipeTemplates.every(
    ({ mesh }) => mesh.geometry.index === null,
  )
  if (!allIndexed && !allNonIndexed) return null

  const instanceCount = recipes.reduce(
    (sum, recipe) => sum + recipe.placements.length,
    0,
  )
  const maximumVertexCount = recipeTemplates.reduce(
    (sum, { mesh }) =>
      sum + mesh.geometry.getAttribute('position').count,
    0,
  )
  const maximumIndexCount = allIndexed
    ? recipeTemplates.reduce(
        (sum, { mesh }) => sum + (mesh.geometry.index?.count ?? 0),
        0,
      )
    : maximumVertexCount

  for (const { mesh } of recipeTemplates) {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    materials.forEach((material) =>
      borrowMaterialTextures(material, borrowedTextures),
    )
  }
  const sourceMaterial = recipeTemplates[0]!.mesh.material
  const material = (
    Array.isArray(sourceMaterial) ? sourceMaterial[0]! : sourceMaterial
  ).clone()
  const batched = new BatchedMesh(
    instanceCount,
    maximumVertexCount,
    maximumIndexCount,
    material,
  )
  batched.name = name
  // These batches extend beyond 120 m and would redraw every instance into a
  // tight encounter shadow atlas. Nearby subjects own the directional shadow;
  // terrain grounding and AO-style cues handle low forest-floor props.
  batched.castShadow = castShadow
  batched.receiveShadow = true
  batched.perObjectFrustumCulled = true
  batched.sortObjects = true

  forestProps.updateMatrixWorld(true)
  const inverseTemplateRoot = forestProps.matrixWorld.clone().invert()
  const placementObject = new Object3D()
  const tiltObject = new Object3D()
  const zeroHeightMatrix = new Matrix4()
  const finalMatrix = new Matrix4()
  const terrainNormal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawAroundLocalUp = new Quaternion()
  const samples: ProductionEcologyInstanceSample[] = []
  const projectionMetrics: ProductionEcologyProjectionMetric[] = []
  const projectedBoundsSize = new Vector3()
  let estimatedTriangles = 0
  let airborneInstanceCount = 0
  let maximumAbsoluteGroundingError = 0

  for (const recipe of recipes) {
    const template = templates.get(recipe.templateName)!.mesh
    template.updateMatrixWorld(true)
    const relativeTemplateMatrix = inverseTemplateRoot
      .clone()
      .multiply(template.matrixWorld)
    template.geometry.computeBoundingBox()
    const templateGeometryBounds = template.geometry.boundingBox?.clone()
    if (!templateGeometryBounds) continue
    const geometryId = batched.addGeometry(template.geometry)
    estimatedTriangles +=
      productionEcologyTriangleCount(template) * recipe.placements.length

    for (const placement of recipe.placements) {
      const terrainSurfaceWorldY = terrainHeightAtWorld(
        placement.x,
        placement.z,
      )
      placementObject.position.set(placement.x, 0, placement.z)
      productionEcologyTerrainNormal(
        terrainHeightAtWorld,
        placement.x,
        placement.z,
        recipe.kind,
        terrainNormal,
      )
      slopeAlignment.setFromUnitVectors(
        PRODUCTION_ECOLOGY_UP,
        terrainNormal,
      )
      yawAroundLocalUp.setFromAxisAngle(
        PRODUCTION_ECOLOGY_UP,
        placement.yaw,
      )
      tiltObject.rotation.set(
        recipe.kind === 'moss' || recipe.kind === 'litter'
          ? 0
          : placement.pitch,
        0,
        recipe.kind === 'moss' || recipe.kind === 'litter'
          ? 0
          : placement.roll,
      )
      placementObject.quaternion
        .copy(slopeAlignment)
        .multiply(yawAroundLocalUp)
        .multiply(tiltObject.quaternion)
      const worldScale = configureProductionEcologyScale(
        placementObject,
        recipe.kind,
        recipe.templateName,
        placement,
      )
      placementObject.updateMatrix()
      zeroHeightMatrix.multiplyMatrices(
        placementObject.matrix,
        relativeTemplateMatrix,
      )
      const surfaceOffset =
        recipe.kind === 'moss' || recipe.kind === 'litter' ? 0.009 : 0
      const burialDepth = productionEcologyBurialDepth(
        recipe.kind,
        worldScale,
      )
      placementObject.position.y = scaleEncounterProductionPropTranslationY(
        templateGeometryBounds,
        zeroHeightMatrix,
        terrainSurfaceWorldY + surfaceOffset,
        burialDepth,
      )
      placementObject.updateMatrix()
      finalMatrix.multiplyMatrices(
        placementObject.matrix,
        relativeTemplateMatrix,
      )
      const instanceId = batched.addInstance(geometryId)
      batched.setMatrixAt(instanceId, finalMatrix)
      if (recipe.kind === 'fern' || recipe.kind === 'shrub') {
        const brightness =
          0.5 + ((instanceId * 11 + placement.patchId) % 7) * 0.014
        batched.setColorAt(
          instanceId,
          new Color().setRGB(
            brightness * 0.79,
            brightness * 0.9,
            brightness * 0.65,
          ),
        )
      }
      const projectedBounds = templateGeometryBounds
        .clone()
        .applyMatrix4(finalMatrix)
      const expectedBottomY =
        terrainSurfaceWorldY + surfaceOffset - burialDepth
      const groundingError = projectedBounds.min.y - expectedBottomY
      maximumAbsoluteGroundingError = Math.max(
        maximumAbsoluteGroundingError,
        Math.abs(groundingError),
      )
      if (projectedBounds.min.y > terrainSurfaceWorldY + 0.002) {
        airborneInstanceCount += 1
      }
      projectedBounds.getSize(projectedBoundsSize)
      const projectedWorldCentre = projectedBounds.getCenter(new Vector3())
      projectionMetrics.push({
        encounterRadius: Math.hypot(
          projectedWorldCentre.x,
          projectedWorldCentre.z,
        ),
        instanceId,
        maximumWorldDimension: Math.max(
          projectedBoundsSize.x,
          projectedBoundsSize.y,
          projectedBoundsSize.z,
        ),
        worldCentre: projectedWorldCentre,
      })
      if (
        samples.filter(
          ({ templateName }) => templateName === recipe.templateName,
        ).length < 2
      ) {
        samples.push({
          burialDepth,
          groundingError,
          instanceId,
          kind: recipe.kind,
          placement,
          terrainY: terrainSurfaceWorldY,
          templateName: recipe.templateName,
          worldBottomY: projectedBounds.min.y,
        })
      }
    }
  }

  batched.computeBoundingBox()
  batched.computeBoundingSphere()
  batched.userData.scaleEncounterEcologyInstanceCount = instanceCount
  batched.userData.scaleEncounterEcologySamples = samples
  batched.userData.scaleEncounterEcologyUniqueGeometryCount = recipes.length
  batched.userData.scaleEncounterEstimatedTriangles = estimatedTriangles
  batched.userData.scaleEncounterEcologyGrounding = {
    airborneInstanceCount,
    instanceCount,
    maximumAbsoluteGroundingError,
  }
  batched.userData.scaleEncounterProjectedPixelCullThreshold = {
    far: 3.25,
    near: 1.75,
  }
  const drawingBufferSize = new Vector2()
  const cameraWorldPosition = new Vector3()
  // BatchedMesh cannot use Three's ordinary per-object frustum culling for
  // individual low props. Cull silhouettes that would occupy less than a few
  // CSS pixels instead of allowing distant fern/branch fragments to turn into
  // high-contrast black specks during portrait overview transitions.
  const updateBatchedDrawList = batched.onBeforeRender.bind(batched)
  batched.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    renderMaterial,
    group,
  ) => {
    if (camera instanceof PerspectiveCamera) {
      renderer.getSize(drawingBufferSize)
      camera.getWorldPosition(cameraWorldPosition)
      const pixelsPerWorldUnitAtUnitDistance =
        drawingBufferSize.y /
        (2 * Math.tan((camera.fov * Math.PI) / 360))
      let visibleCount = 0
      for (const metric of projectionMetrics) {
        const distance = Math.max(
          0.01,
          cameraWorldPosition.distanceTo(metric.worldCentre),
        )
        const projectedPixels =
          (metric.maximumWorldDimension * pixelsPerWorldUnitAtUnitDistance) /
          distance
        const minimumPixels = metric.encounterRadius <= 64 ? 1.75 : 3.25
        const visible = distance < 34 || projectedPixels >= minimumPixels
        batched.setVisibleAt(metric.instanceId, visible)
        if (visible) visibleCount += 1
      }
      batched.userData.scaleEncounterEcologyVisibleInstanceCount = visibleCount
    }
    updateBatchedDrawList(
      renderer,
      scene,
      camera,
      geometry,
      renderMaterial,
      group,
    )
  }
  return batched
}

function createProductionEcologyMaterialBatches(
  name: string,
  recipes: ReadonlyArray<ScaleEncounterProductionEcologyBatch>,
  templates: ReadonlyMap<string, ProductionEcologyTemplate>,
  forestProps: Group<Object3DEventMap>,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld: (worldX: number, worldZ: number) => number,
  castShadow: boolean,
): BatchedMesh[] {
  // Three's BatchedMesh requires every geometry in a batch to expose the
  // exact same attribute layout. The ecology GLB intentionally mixes scanned
  // templates with and without baked vertex colours, even inside one plant
  // family. Grouping by kind alone therefore made the whole encounter fail at
  // runtime (`Added geometry missing "color"`). Material identity is part of
  // the key as well so foliage, wood and stone never inherit whichever PBR
  // material happened to be the first template in a mixed batch.
  const groupedRecipes = new Map<
    string,
    {
      readonly kind: ScaleEncounterProductionEcologyKind
      readonly recipes: ScaleEncounterProductionEcologyBatch[]
    }
  >()
  for (const recipe of recipes) {
    const template = templates.get(recipe.templateName)
    if (!template) continue
    const sourceMaterial = Array.isArray(template.mesh.material)
      ? template.mesh.material[0]
      : template.mesh.material
    const attributeSignature = Object.entries(
      template.mesh.geometry.attributes,
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([attributeName, attribute]) =>
          `${attributeName}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array.constructor.name}`,
      )
      .join('|')
    const key = [
      recipe.kind,
      sourceMaterial?.uuid ?? 'material-unavailable',
      template.mesh.geometry.index ? 'indexed' : 'non-indexed',
      attributeSignature,
    ].join('::')
    const existing = groupedRecipes.get(key)
    if (existing) {
      existing.recipes.push(recipe)
    } else {
      groupedRecipes.set(key, { kind: recipe.kind, recipes: [recipe] })
    }
  }

  return [...groupedRecipes.values()].flatMap(({ kind, recipes }, index) => {
    const batch = createProductionEcologyBatch(
      `${name}-${kind}-${index}`,
      recipes,
      templates,
      forestProps,
      borrowedTextures,
      terrainHeightAtWorld,
      castShadow,
    )
    return batch ? [batch] : []
  })
}

function addProductionForestEcology(
  root: Group,
  forestProps: Group<Object3DEventMap>,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld: (worldX: number, worldZ: number) => number,
  density: ScaleEncounterEcologyDensity,
): boolean {
  const templates = new Map<string, ProductionEcologyTemplate>()
  for (const name of SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES) {
    const template = productionEcologyTemplate(forestProps, name)
    if (!template) return false
    templates.set(name, template)
  }

  const scatter = createScaleEncounterProductionForestScatter(density)
  // The source moss/litter meshes are opaque radial planes without authored
  // alpha. Rendering them as decals creates solid atlas-coloured carpets, so
  // keep those candidates out of D until the asset pass supplies cutout masks.
  const propRecipes = scatter.batches.filter(
    ({ kind }) =>
      kind !== 'litter' &&
      kind !== 'moss' &&
      kind !== 'fern' &&
      kind !== 'shrub',
  )
  const shadowlessRecipes = propRecipes
    .map((recipe) => ({
      ...recipe,
      placements: recipe.placements,
    }))
    .filter(({ placements }) => placements.length > 0)
  const shadowlessProps = createProductionEcologyMaterialBatches(
    'scale-encounter-production-ecology-shadowless-props-batch',
    shadowlessRecipes,
    templates,
    forestProps,
    borrowedTextures,
    terrainHeightAtWorld,
    false,
  )
  if (shadowlessProps.length === 0) return false

  const propRoot = new Group()
  propRoot.name = 'scale-encounter-real-forest-props'
  propRoot.userData.scaleEncounterEcologyCounts = {
    ...scatter.counts,
    fern: 0,
    litter: 0,
    moss: 0,
    shrub: 0,
  }
  propRoot.userData.scaleEncounterEcologyDensity = density
  propRoot.userData.scaleEncounterEcologyDrawCalls =
    shadowlessProps.length
  propRoot.userData.scaleEncounterDeferredOpaqueGroundPatches = true
  propRoot.add(...shadowlessProps)
  root.add(propRoot)

  // The procedural population is deliberately sparse near the participants,
  // but the comparison clearing still needs a handful of metre-scale anchors
  // to establish parallax and stop reading as an empty studio cyclorama.
  // Reuse the full PBR templates as independent material-preserving batches;
  // the generic BatchedMesh above cannot safely mix their rock/log/foliage
  // materials.
  const heroFern = propTemplate(forestProps, 'fern_02')
  const heroRock = propTemplate(forestProps, 'rock_07')
  const heroLog = propTemplate(forestProps, 'dead_tree_trunk')
  const heroShrub = propTemplate(forestProps, 'shrub_04')
  if (heroFern && heroRock && heroLog && heroShrub) {
    const heroRoot = new Group()
    heroRoot.name = 'scale-encounter-production-hero-ecology'
    const heroFernCandidates: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
      { aspect: 1.08, pitch: 0.01, roll: -0.01, scale: 0.84, tier: 'near', x: -4.8, yaw: 0.9, z: -6.8 },
      { aspect: 0.9, pitch: -0.01, roll: 0.01, scale: 0.78, tier: 'near', x: 7.8, yaw: 2.6, z: 6.2 },
      { aspect: 1.14, pitch: 0.01, roll: 0.01, scale: 0.76, tier: 'near', x: 11.6, yaw: 4.2, z: -5.8 },
      { aspect: 0.86, pitch: -0.01, roll: -0.01, scale: 0.72, tier: 'near', x: -9.4, yaw: 5.4, z: 5.2 },
      { aspect: 1.02, pitch: 0.01, roll: 0.01, scale: 0.8, tier: 'near', x: -17, yaw: 1.8, z: -5.5 },
      { aspect: 1.18, pitch: 0.01, roll: -0.02, scale: 1.55, tier: 'near', x: -18.5, yaw: 0.42, z: 12.8 },
      { aspect: 0.94, pitch: -0.02, roll: 0.01, scale: 1.34, tier: 'near', x: 18.8, yaw: 2.2, z: 15.6 },
      { aspect: 1.12, pitch: 0.02, roll: 0.01, scale: 1.42, tier: 'near', x: -22.4, yaw: 4.5, z: -17.8 },
      { aspect: 0.88, pitch: -0.01, roll: -0.02, scale: 1.27, tier: 'near', x: 24.5, yaw: 5.4, z: -15.2 },
      { aspect: 1.05, pitch: 0.01, roll: 0.01, scale: 1.18, tier: 'near', x: -11.8, yaw: 1.7, z: 23.8 },
      { aspect: 1.2, pitch: 0.01, roll: -0.01, scale: 1.33, tier: 'near', x: 13.8, yaw: 3.6, z: 25.2 },
      { aspect: 0.9, pitch: -0.01, roll: 0.02, scale: 1.16, tier: 'near', x: -31.2, yaw: 5.1, z: 5.8 },
      { aspect: 1.14, pitch: 0.02, roll: -0.01, scale: 1.24, tier: 'near', x: 31.6, yaw: 1.2, z: -4.8 },
      { aspect: 1.02, pitch: 0.01, roll: 0.01, scale: 1.12, tier: 'near', x: 5.5, yaw: 2.7, z: -27.8 },
      { aspect: 0.92, pitch: -0.01, roll: 0.02, scale: 1.06, tier: 'near', x: -7.2, yaw: 4.4, z: -10.4 },
      { aspect: 1.16, pitch: 0.02, roll: -0.01, scale: 0.96, tier: 'near', x: -2.8, yaw: 0.3, z: -12.2 },
      { aspect: 0.86, pitch: -0.02, roll: 0.01, scale: 1.14, tier: 'near', x: 10.8, yaw: 2.1, z: 9.8 },
      { aspect: 1.22, pitch: 0.01, roll: -0.02, scale: 0.92, tier: 'near', x: 14.7, yaw: 5.2, z: 12.4 },
      { aspect: 1.08, pitch: 0.02, roll: 0.01, scale: 1.28, tier: 'near', x: -20.6, yaw: 1.4, z: 15.8 },
      { aspect: 0.9, pitch: -0.01, roll: -0.01, scale: 1.1, tier: 'near', x: -24.2, yaw: 3.8, z: 11.6 },
      { aspect: 1.18, pitch: 0.01, roll: 0.02, scale: 1.22, tier: 'near', x: 21.4, yaw: 4.7, z: 18.2 },
      { aspect: 0.84, pitch: -0.02, roll: 0.01, scale: 1.04, tier: 'near', x: 26.2, yaw: 0.8, z: 14.4 },
      { aspect: 1.12, pitch: 0.01, roll: -0.02, scale: 1.2, tier: 'near', x: -24.8, yaw: 2.9, z: -19.2 },
      { aspect: 0.94, pitch: -0.01, roll: 0.01, scale: 1.02, tier: 'near', x: -29.4, yaw: 5.7, z: -15.6 },
      { aspect: 1.2, pitch: 0.02, roll: -0.01, scale: 1.18, tier: 'near', x: 25.5, yaw: 1.9, z: -19.8 },
      { aspect: 0.88, pitch: -0.01, roll: 0.02, scale: 1.08, tier: 'near', x: 30.8, yaw: 4.1, z: -14.6 },
      { aspect: 1.14, pitch: 0.01, roll: 0.01, scale: 1.16, tier: 'near', x: -14.6, yaw: 0.6, z: 27.2 },
      { aspect: 0.9, pitch: -0.02, roll: -0.01, scale: 1.12, tier: 'near', x: 17.2, yaw: 3.4, z: 28.8 },
    ]
    const heroFerns = heroFernCandidates.slice(
      0,
      scaleEncounterEcologyCount(10, density),
    )
    const heroRocks: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
      { aspect: 1.32, pitch: 0.04, roll: -0.03, scale: 2.55, tier: 'near', x: -24.5, yaw: 0.4, z: 17.2 },
      { aspect: 0.86, pitch: -0.02, roll: 0.05, scale: 2.2, tier: 'near', x: 26.8, yaw: 2.1, z: 18.6 },
      { aspect: 1.14, pitch: 0.02, roll: 0.02, scale: 2.05, tier: 'near', x: -30.5, yaw: 4.5, z: -23.5 },
    ]
    const heroLogs: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
      { aspect: 1.12, pitch: 0.03, roll: 0.02, scale: 1.55, tier: 'near', x: -26.8, yaw: 0.58, z: -19.6 },
      { aspect: 0.92, pitch: -0.04, roll: -0.02, scale: 1.42, tier: 'near', x: 29.2, yaw: -0.42, z: -27.5 },
    ]
    const heroShrubCandidates: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
      { aspect: 1.08, pitch: 0.01, roll: -0.01, scale: 0.56, tier: 'near', x: 10.2, yaw: 1.1, z: 7.4 },
      { aspect: 0.9, pitch: -0.01, roll: 0.01, scale: 0.52, tier: 'near', x: -4.1, yaw: 2.7, z: -8.6 },
      { aspect: 1.14, pitch: 0.01, roll: 0.01, scale: 0.58, tier: 'near', x: -12.2, yaw: 4.1, z: 6.9 },
      { aspect: 0.88, pitch: -0.01, roll: -0.01, scale: 0.54, tier: 'near', x: -18.2, yaw: 5.2, z: -7.3 },
      { aspect: 1.12, pitch: 0.01, roll: -0.02, scale: 0.94, tier: 'near', x: -17.2, yaw: 0.42, z: 10.4 },
      { aspect: 0.88, pitch: -0.01, roll: 0.02, scale: 0.82, tier: 'near', x: 17.8, yaw: 2.2, z: 10.8 },
      { aspect: 1.18, pitch: 0.02, roll: 0.01, scale: 1.06, tier: 'near', x: -21.8, yaw: 4.5, z: -11.4 },
      { aspect: 0.92, pitch: -0.01, roll: -0.02, scale: 0.9, tier: 'near', x: 20.8, yaw: 5.4, z: -12.6 },
      { aspect: 1.06, pitch: 0.01, roll: 0.01, scale: 1.14, tier: 'near', x: -30.8, yaw: 1.7, z: 8.2 },
      { aspect: 1.2, pitch: 0.01, roll: -0.01, scale: 1.02, tier: 'near', x: 30.5, yaw: 3.6, z: 7.4 },
      { aspect: 0.84, pitch: -0.01, roll: 0.02, scale: 0.78, tier: 'near', x: -12.2, yaw: 0.9, z: -20.5 },
      { aspect: 1.14, pitch: 0.02, roll: -0.01, scale: 0.88, tier: 'near', x: 13.8, yaw: 2.9, z: -22.8 },
      { aspect: 0.96, pitch: 0.01, roll: 0.01, scale: 1.12, tier: 'near', x: -28.4, yaw: 4.1, z: -25.2 },
      { aspect: 1.08, pitch: -0.02, roll: 0.01, scale: 1.04, tier: 'near', x: 28.5, yaw: 5.8, z: -28.6 },
      { aspect: 0.9, pitch: 0.01, roll: -0.02, scale: 0.84, tier: 'near', x: -35.5, yaw: 1.2, z: -7.5 },
      { aspect: 1.16, pitch: -0.01, roll: 0.02, scale: 0.92, tier: 'near', x: 35.8, yaw: 3.1, z: -10.4 },
      { aspect: 1.04, pitch: 0.01, roll: -0.02, scale: 0.82, tier: 'near', x: -25.5, yaw: 0.7, z: 22.8 },
      { aspect: 0.86, pitch: -0.01, roll: 0.02, scale: 0.76, tier: 'near', x: 25.4, yaw: 2.5, z: 24.6 },
      { aspect: 1.2, pitch: 0.02, roll: 0.01, scale: 0.88, tier: 'near', x: -38.4, yaw: 4.7, z: 14.2 },
      { aspect: 0.92, pitch: -0.01, roll: -0.02, scale: 0.84, tier: 'near', x: 39.8, yaw: 5.6, z: 16.5 },
      { aspect: 1.08, pitch: 0.01, roll: 0.01, scale: 0.78, tier: 'near', x: -6.8, yaw: 1.9, z: -30.8 },
      { aspect: 0.96, pitch: -0.01, roll: 0.02, scale: 0.8, tier: 'near', x: 8.2, yaw: 3.8, z: -32.5 },
      { aspect: 1.15, pitch: 0.02, roll: -0.01, scale: 0.92, tier: 'near', x: -19.6, yaw: 4.3, z: 17.8 },
      { aspect: 0.88, pitch: -0.01, roll: 0.02, scale: 0.86, tier: 'near', x: 21.8, yaw: 1.5, z: 19.4 },
      { aspect: 1.22, pitch: 0.01, roll: -0.02, scale: 1.08, tier: 'near', x: -32.6, yaw: 2.6, z: 18.6 },
      { aspect: 0.94, pitch: -0.02, roll: 0.01, scale: 1.02, tier: 'near', x: 34.2, yaw: 5.1, z: 22.4 },
      { aspect: 1.08, pitch: 0.02, roll: 0.01, scale: 0.9, tier: 'near', x: -21.4, yaw: 0.4, z: -24.6 },
      { aspect: 0.86, pitch: -0.01, roll: -0.01, scale: 0.84, tier: 'near', x: 23.2, yaw: 3.3, z: -25.8 },
    ]
    const heroShrubs = heroShrubCandidates.slice(
      0,
      scaleEncounterEcologyCount(10, density),
    )
    heroRoot.add(
      createPropInstances(
        'scale-encounter-production-hero-ferns',
        heroFern,
        heroFerns,
        'fern',
        true,
        borrowedTextures,
        terrainHeightAtWorld,
        forestProps,
      ),
      createPropInstances(
        'scale-encounter-production-hero-rocks',
        heroRock,
        heroRocks,
        'rock',
        true,
        borrowedTextures,
        terrainHeightAtWorld,
        forestProps,
      ),
      createPropInstances(
        'scale-encounter-production-hero-logs',
        heroLog,
        heroLogs,
        'log',
        true,
        borrowedTextures,
        terrainHeightAtWorld,
        forestProps,
      ),
      createPropInstances(
        'scale-encounter-production-hero-shrubs',
        heroShrub,
        heroShrubs,
        'shrub',
        true,
        borrowedTextures,
        terrainHeightAtWorld,
        forestProps,
      ),
    )
    // The scanned fern/shrub templates use an opaque shared atlas and expose
    // their rectangular leaf planes in grazing views. Keep them instantiated
    // only as a deterministic rollback reference; the alpha-clipped,
    // bounding-box-grounded understory layer now owns visible plants.
    for (const supersededName of [
      'scale-encounter-production-hero-ferns',
      'scale-encounter-production-hero-shrubs',
    ]) {
      const superseded = heroRoot.getObjectByName(supersededName)
      if (superseded) {
        superseded.visible = false
        superseded.userData.scaleEncounterReplacedByGroundedUnderstory = true
      }
    }
    root.add(heroRoot)
  }
  return true
}

function addHeroForestProps(
  root: Group,
  rockTemplate: Mesh,
  logTemplate: Mesh,
  withMiddleDistance: boolean,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld?: (worldX: number, worldZ: number) => number,
): void {
  if (!withMiddleDistance) return
  const heroRoot = new Group()
  heroRoot.name = 'scale-encounter-real-forest-hero-props'

  const heroRocks: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
    { aspect: 1.08, pitch: 0.04, roll: -0.03, scale: 2.45, tier: 'near', x: -27, yaw: 0.4, z: 18 },
    { aspect: 0.9, pitch: -0.02, roll: 0.05, scale: 2.75, tier: 'near', x: 31, yaw: 2.1, z: 16 },
    { aspect: 1.16, pitch: 0.02, roll: 0.02, scale: 2.28, tier: 'near', x: -35, yaw: 4.5, z: -25 },
  ]
  const heroLogs: ReadonlyArray<ScaleEncounterForestPropPlacement> = [
    { aspect: 1, pitch: 0.03, roll: 0.02, scale: 1.35, tier: 'near', x: -31, yaw: 0.58, z: -24 },
    { aspect: 1, pitch: -0.04, roll: -0.02, scale: 1.5, tier: 'near', x: 35, yaw: -0.42, z: -34 },
  ]
  heroRoot.add(
    createPropInstances(
      'scale-encounter-real-hero-rocks',
      rockTemplate,
      heroRocks,
      'rock',
      true,
      borrowedTextures,
      terrainHeightAtWorld,
    ),
    createPropInstances(
      'scale-encounter-real-hero-logs',
      logTemplate,
      heroLogs,
      'log',
      true,
      borrowedTextures,
      terrainHeightAtWorld,
    ),
  )
  root.add(heroRoot)
}

function addRealForestGroundDetails(
  root: Group,
  forestProps: Group<Object3DEventMap>,
  withMiddleDistance: boolean,
  borrowedTextures: Set<Texture>,
  terrainHeightAtWorld?: (worldX: number, worldZ: number) => number,
): boolean {
  const fern = propTemplate(forestProps, 'fern_02')
  const rock = propTemplate(forestProps, 'rock_07')
  const log = propTemplate(forestProps, 'dead_tree_trunk')
  if (!fern || !rock || !log) return false

  const propRoot = new Group()
  propRoot.name = 'scale-encounter-real-forest-props'
  const scatter = createScaleEncounterForestScatter(
    withMiddleDistance ? 'hybrid-slice' : 'ground-slice',
  )
  propRoot.add(
    createPropInstances(
      'scale-encounter-real-ferns',
      fern,
      scatter.ferns,
      'fern',
      withMiddleDistance,
      borrowedTextures,
      terrainHeightAtWorld,
    ),
    createPropInstances(
      'scale-encounter-real-rocks',
      rock,
      scatter.rocks,
      'rock',
      withMiddleDistance,
      borrowedTextures,
      terrainHeightAtWorld,
    ),
    createPropInstances(
      'scale-encounter-real-logs',
      log,
      scatter.logs,
      'log',
      withMiddleDistance,
      borrowedTextures,
      terrainHeightAtWorld,
    ),
  )

  root.add(propRoot)
  addHeroForestProps(
    root,
    rock,
    log,
    withMiddleDistance,
    borrowedTextures,
    terrainHeightAtWorld,
  )
  return true
}

function addForestMiddleDistanceScreens(root: Group): void {
  // PROTOTYPE — the hybrid slice deliberately keeps the middle-distance
  // contract visible without pretending primitive placeholders are final art.
  // Real biome proxies will replace this marker in the production pass.
  root.userData.scaleEncounterNeedsReviewedMiddleDistanceAssets = true
}

function createLandBase(
  root: Group,
  textures: ScaleEncounterSurfaceTextures | null,
  panoramaTexture: Texture | null,
  snow: boolean,
  maxAnisotropy: number,
  withPanoramaBlend: boolean,
  variant: ScaleEncounterEnvironmentVariant,
  ecologyDensity: ScaleEncounterEcologyDensity,
  forestProps: Group<Object3DEventMap> | null,
  borrowedTextures: Set<Texture>,
): { readonly animalContactCue: Mesh; readonly childContactCue: Mesh } {
  const productionGround = !snow && variant === 'production-slice'
  if (textures) {
    // Poly Haven's source scans cover a two-metre square.  Repeating them at
    // their real-world scale gives the child and animal crisp, stable texels
    // underfoot instead of stretching a panorama's bottom rows across a plane.
    configureSurfaceTextures(
      textures,
      maxAnisotropy,
      productionGround
        ? 1
        : surfaceRepeatCount(textures.physicalWidthMeters),
      productionGround ? 0 : snow ? -0.31 : 0.27,
    )
  }
  const hybridGround = !snow && variant === 'hybrid-slice'
  const opaqueControlledGround = hybridGround || productionGround
  const groundMaterial = new MeshStandardMaterial({
    // The hybrid camera can sit more than 150 m from the origin on a narrow
    // phone overview. A world-origin radial alpha there reveals the photo's
    // lower hemisphere through the real terrain and creates two overlapping
    // floors. Its 360 m radius already covers the controlled camera frustum,
    // so C and D control their own far-ground treatment; A/B retain the
    // original feather for a direct comparison.
    alphaMap: opaqueControlledGround
      ? null
      : createGroundHorizonFadeTexture('ground'),
    // Vertex colours are multiplicative. The baseline keeps white so its
    // reviewed 2 m scan is unchanged; B/C tint that scan with damp/dry/far
    // macro patches to avoid one uniform brown carpet across 720 metres.
    color:
      textures && !snow && variant === 'baseline'
        ? '#ffffff'
        : textures
          ? productionGround
            // The humus scan is naturally dark, but a pure-white material
            // multiplier lets the strong encounter skylight wash its olive
            // and brown mids toward grey. Keep the texture detail intact
            // while restoring a restrained warm earth response.
            ? '#f2ead8'
            : '#d7d2bd'
          : snow
            ? '#edf3f8'
            : '#9a8a65',
    map: textures?.albedo ?? null,
    normalMap: textures?.normal ?? null,
    normalScale: new Vector2(
      snow
        ? 0.42
        : variant === 'baseline'
          ? 0.58
            : variant === 'hybrid-slice'
              ? 0.18
            : variant === 'production-slice'
              ? 0.18
            : 0.34,
      snow
        ? 0.42
        : variant === 'baseline'
          ? 0.58
            : variant === 'hybrid-slice'
              ? 0.18
            : variant === 'production-slice'
              ? 0.18
            : 0.34,
    ),
    roughness:
      snow
        ? 0.88
        : variant === 'baseline'
          ? 0.96
          : variant === 'production-slice'
            ? 0.94
            : 0.88,
    roughnessMap: textures?.roughness ?? null,
    transparent: !opaqueControlledGround,
    vertexColors: true,
  })
  if (hybridGround) {
    applyScaleEncounterHybridGroundMaterialPrototype(groundMaterial, {
      // Preserve more world-space terrain behind the dense mid-ground scatter
      // before the panorama is revealed through a long, ordered transition.
      cameraFadeEndMeters: 155,
      cameraFadeStartMeters: 58,
      horizonColourStrength: 0.72,
      maximumCoverageLoss: 0.86,
      subjectFadeEndMeters: 175,
      subjectFadeStartMeters: 68,
    })
  } else if (productionGround) {
    applyScaleEncounterStochasticGroundMaterialCandidate(groundMaterial, {
      dryLitterAlbedoTexture: textures?.dryLitterAlbedo ?? null,
      macroVariationStrength: 0.5,
      macroWorldSizeMeters: SCALE_ENCOUNTER_SURFACE_RADIUS_METERS * 2,
      normalFadeEndMeters: 112,
      normalFadeStartMeters: 38,
      panoramaBlendEndMeters: 230,
      panoramaBlendStartMeters: 145,
      // The panorama is a far-field plate. Projecting its camera-relative RGB
      // onto a world-space floor made texture details slide and created a
      // horizontal veil during overview/rear transitions.
      panoramaTexture: null,
      physicalWidthMeters: textures?.physicalWidthMeters ?? 2,
      stochasticCellSizeMeters:
        (textures?.physicalWidthMeters ?? 2) * 3.25,
    })
  }
  const ground = createMesh(
    'scale-encounter-land-ground',
    // Portrait overview can put the camera more than 150 m from the subjects.
    // The 720 m grid leaves over 200 m of safety in every cardinal direction.
    createLandGroundGeometry(
      snow,
      snow || variant === 'baseline' ? 'none' : variant,
    ),
    groundMaterial,
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = SCALE_ENCOUNTER_GROUND_WORLD_Y
  ground.receiveShadow = variant !== 'baseline'
  ground.renderOrder = opaqueControlledGround ? 0 : -20
  const animalContactCue = createGroundContactCue(
    'scale-encounter-animal-contact-cue',
    snow ? '#50627b' : '#211d15',
    snow ? 0.23 : productionGround ? 0.09 : 0.3,
    productionGround
      ? scaleEncounterProductionTerrainHeightAtWorld(2.2, 0) + 0.006
      : -0.018,
  )
  const childContactCue = createGroundContactCue(
    'scale-encounter-child-contact-cue',
    snow ? '#50627b' : '#211d15',
    snow ? 0.28 : productionGround ? 0.24 : 0.34,
    productionGround
      ? scaleEncounterProductionTerrainHeightAtWorld(-12, 0) + 0.006
      : -0.018,
  )
  root.add(ground, animalContactCue, childContactCue)
  if (productionGround) {
    root.add(
      createScaleEncounterProductionGroundDetail(
        scaleEncounterProductionTerrainHeightAtWorld,
        ecologyDensity,
      ),
      createScaleEncounterProductionUnderstory(
        scaleEncounterProductionTerrainHeightAtWorld,
        ecologyDensity,
      ),
    )
  }
  if (withPanoramaBlend) {
    if (snow) {
      addHorizonHaze(
        root,
        'scale-encounter-snow-horizon-haze',
        '#d8e3eb',
        0.34,
        2.8,
      )
      addSnowGroundDepthAnchors(root)
    } else if (variant === 'baseline') {
      // Preserve the original v3 panorama as the A/B baseline. It deliberately
      // keeps the old haze, mounds and single log so review can attribute any
      // improvement to the two new environment variants rather than drift in
      // the control image.
      addHorizonHaze(
        root,
        'scale-encounter-forest-horizon-haze',
        '#50654c',
        0.4,
        3.4,
      )
      addLegacyForestGroundDepthAnchors(root)
    } else if (variant === 'ground-slice') {
      // Ground-only candidate: adaptive terrain plus nearby scatter, while the
      // old horizon treatment remains. The hybrid slice removes that curtain
      // and extends the world-space cues into the middle distance.
      addHorizonHaze(
        root,
        'scale-encounter-forest-horizon-haze',
        '#50654c',
        0.4,
        3.4,
      )
      if (
        !forestProps ||
        !addRealForestGroundDetails(
          root,
          forestProps,
          false,
          borrowedTextures,
        )
      ) {
        addForestGroundDetails(root, false)
      }
    } else {
      const addedRealDetails =
        forestProps && productionGround
          ? addProductionForestEcology(
              root,
              forestProps,
              borrowedTextures,
              scaleEncounterProductionTerrainHeightAtWorld,
              ecologyDensity,
            )
          : forestProps
            ? addRealForestGroundDetails(
                root,
                forestProps,
                true,
                borrowedTextures,
              )
            : false
      if (
        !addedRealDetails
      ) {
        addForestGroundDetails(root, true)
      }
    }
  }
  return { animalContactCue, childContactCue }
}

function addForestDepth(root: Group): void {
  const trunkGeometry = new CylinderGeometry(0.34, 0.58, 7.5, 7)
  const crownGeometry = new ConeGeometry(2.5, 7.2, 8)
  const trunkMaterial = new MeshStandardMaterial({
    color: '#5c4a38',
    roughness: 0.98,
  })
  const crownMaterials = [
    new MeshStandardMaterial({ color: '#3e684f', roughness: 0.96 }),
    new MeshStandardMaterial({ color: '#52745a', roughness: 0.96 }),
    new MeshStandardMaterial({ color: '#355c49', roughness: 0.96 }),
  ]
  const positions = [
    [-30, -16],
    [-23, -22],
    [-13, -25],
    [2, -27],
    [16, -24],
    [28, -17],
    [34, -8],
    [-34, -7],
    [-31, 18],
    [-17, 25],
    [5, 28],
    [24, 23],
    [34, 13],
  ] as const
  positions.forEach(([x, z], index) => {
    const tree = new Group()
    tree.name = `scale-encounter-tree-${index + 1}`
    const heightScale = 0.82 + (index % 4) * 0.09
    const trunk = createMesh(
      'trunk',
      trunkGeometry.clone(),
      trunkMaterial.clone(),
    )
    // These are depth cues, not scene blockers. Draw them before the animal
    // without writing depth so a portrait overview or guided orbit can never
    // let a foreground proxy swallow the reviewed subject silhouette.
    for (const material of Array.isArray(trunk.material)
      ? trunk.material
      : [trunk.material]) {
      material.depthWrite = false
    }
    trunk.renderOrder = -10
    trunk.position.y = 3.75 * heightScale
    trunk.scale.y = heightScale
    const crown = createMesh(
      'crown',
      crownGeometry.clone(),
      crownMaterials[index % crownMaterials.length]!.clone(),
    )
    for (const material of Array.isArray(crown.material)
      ? crown.material
      : [crown.material]) {
      material.depthWrite = false
    }
    crown.renderOrder = -10
    crown.position.y = 8 * heightScale
    crown.scale.setScalar(heightScale)
    tree.position.set(x, 0, z)
    tree.rotation.y = index * 0.73
    tree.add(trunk, crown)
    root.add(tree)
  })
  trunkGeometry.dispose()
  crownGeometry.dispose()
  trunkMaterial.dispose()
  crownMaterials.forEach((material) => material.dispose())
}

function addAirBase(root: Group, withDepth: boolean): void {
  const farBelow = createMesh(
    'scale-encounter-air-far-below',
    new CircleGeometry(SCALE_ENCOUNTER_SURFACE_RADIUS_METERS, 64),
    new MeshBasicMaterial({
      alphaMap: createGroundHorizonFadeTexture('air'),
      color: '#78aac0',
      depthWrite: false,
      opacity: 0.46,
      side: DoubleSide,
      transparent: true,
    }),
  )
  farBelow.rotation.x = -Math.PI / 2
  farBelow.position.y = -24
  farBelow.renderOrder = -30
  root.add(farBelow)
  if (!withDepth) return

  const cloudMaterial = new MeshBasicMaterial({
    alphaMap: createCloudAlphaTexture(),
    color: '#f5f4e9',
    opacity: 0.64,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const cloudGeometry = new PlaneGeometry(1, 1, 1, 1)
  const cloudPositions = [
    [2, -16.2, 2, 28, 14],
    [-24, -18.8, -14, 34, 17],
    [27, -20.1, 21, 39, 19],
    [-7, -21.2, 34, 31, 15],
    [4, -21.4, 49, 42, 20],
    [-76, -18.6, -64, 38, 19],
    [67, -20.2, -58, 46, 23],
    [-91, -21.5, 23, 31, 16],
    [84, -18.1, 34, 42, 20],
    [19, -22.3, 92, 52, 25],
    [-28, -19.5, -105, 37, 18],
    [118, -23, -12, 29, 14],
    [-123, -20.7, -17, 35, 17],
  ] as const
  cloudPositions.forEach(([x, y, z, width, depth], index) => {
    const cloud = createMesh(
      `scale-encounter-cloud-${index + 1}`,
      cloudGeometry.clone(),
      cloudMaterial.clone(),
    )
    cloud.name = `scale-encounter-cloud-${index + 1}`
    cloud.position.set(x, y, z)
    cloud.rotation.set(-Math.PI / 2, 0, index * 0.61)
    cloud.scale.set(width, depth, 1)
    ;(cloud.material as MeshBasicMaterial).opacity =
      0.48 + (index % 4) * 0.055
    cloud.renderOrder = -8
    ;(cloud.userData as unknown as Record<string, unknown>)
      .scaleEncounterBaseX = x
    root.add(cloud)
  })
  cloudGeometry.dispose()
  cloudMaterial.dispose()
}

function addWaterBase(
  root: Group,
  withDepth: boolean,
  textures: ScaleEncounterSurfaceTextures | null = null,
  maxAnisotropy = 1,
): void {
  // Coast Sand 02 is a 15 m scan, not a 2 m tile. Across the 720 m seabed
  // diameter it repeats 48 times, preserving its documented physical scale.
  if (textures) {
    configureSurfaceTextures(
      textures,
      maxAnisotropy,
      surfaceRepeatCount(textures.physicalWidthMeters),
      0.19,
    )
  }
  const surface = createMesh(
    'scale-encounter-water-surface',
    new CircleGeometry(SCALE_ENCOUNTER_SURFACE_RADIUS_METERS, 64),
    new MeshBasicMaterial({
      alphaMap: createGroundHorizonFadeTexture('water'),
      color: '#b9e8df',
      opacity: 0.1,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    }),
  )
  surface.rotation.x = -Math.PI / 2
  surface.position.y = 12.5
  surface.renderOrder = -10
  const seabed = createMesh(
    'scale-encounter-seabed',
    createWaterSeabedGeometry(),
    new MeshStandardMaterial({
      alphaMap: createGroundHorizonFadeTexture('water'),
      color: textures ? '#b9c8ae' : '#6f9d94',
      map: textures?.albedo ?? null,
      normalMap: textures?.normal ?? null,
      normalScale: new Vector2(0.48, 0.48),
      roughness: 0.94,
      roughnessMap: textures?.roughness ?? null,
      transparent: true,
      vertexColors: true,
    }),
  )
  seabed.rotation.x = -Math.PI / 2
  seabed.position.y = -11
  seabed.renderOrder = -20
  root.add(surface, seabed)
  addHorizonHaze(
    root,
    'scale-encounter-water-horizon-haze',
    '#175b68',
    0.4,
    -0.8,
  )
  if (!withDepth) return

  // The reviewed water camera looks diagonally upward along this part of the
  // surface. Two translucent discs create a soft sun-through-water focus
  // without a texture download; the light shafts below make the direction of
  // the refracted light readable while the animal remains the foreground.
  const sunHalo = createMesh(
    'scale-encounter-water-sun-halo',
    new CircleGeometry(8.5, 32),
    new MeshBasicMaterial({
      alphaMap: createRadialAlphaTexture(),
      color: '#e8fff2',
      opacity: 0.12,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    }),
  )
  sunHalo.rotation.x = Math.PI / 2
  sunHalo.position.set(24, 10.82, -13)
  sunHalo.renderOrder = -8
  const sunCore = createMesh(
    'scale-encounter-water-sun-core',
    new CircleGeometry(3.4, 28),
    new MeshBasicMaterial({
      alphaMap: createRadialAlphaTexture(),
      color: '#fffde6',
      opacity: 0.28,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    }),
  )
  sunCore.rotation.x = Math.PI / 2
  sunCore.position.set(24, 10.76, -13)
  sunCore.renderOrder = -7
  root.add(sunHalo, sunCore)

  const rayMaterial = new MeshBasicMaterial({
    alphaMap: createLightShaftAlphaTexture(),
    color: '#d8fff2',
    opacity: 0.095,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const rayGeometry = new PlaneGeometry(1, 1, 1, 1)
  for (let index = 0; index < 6; index += 1) {
    const ray = new Group()
    ray.name = `scale-encounter-light-shaft-${index + 1}`
    const width = 3.4 + (index % 3) * 1.2
    const height = 17 + (index % 2) * 3
    for (const rotationY of [0, Math.PI / 2]) {
      const plane = createMesh(
        'soft-light-shaft-plane',
        rayGeometry.clone(),
        rayMaterial.clone(),
      )
      plane.scale.set(width, height, 1)
      plane.position.y = -height / 2
      plane.rotation.y = rotationY
      plane.renderOrder = -5
      ray.add(plane)
    }
    ray.position.set(-22 + index * 9.1, 10.2, -16 + (index % 2) * 11)
    ray.rotation.z = (index - 2.5) * 0.021
    ;(ray.userData as unknown as Record<string, unknown>)
      .scaleEncounterBaseRotationZ = ray.rotation.z
    root.add(ray)
  }
  rayGeometry.dispose()
  rayMaterial.dispose()
}

function userDataRecord(
  object: Object3D | undefined,
  key: string,
): Record<string, unknown> {
  const userData = object?.userData as unknown as
    | Record<string, unknown>
    | undefined
  const value = userData?.[key]
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function numericMetadata(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function publishProductionEcologyPopulation(
  root: Group,
  density: ScaleEncounterEcologyDensity,
): void {
  const groundDetail = root.getObjectByName(
    'scale-encounter-production-ground-detail',
  )
  const ground = userDataRecord(
    groundDetail,
    'scaleEncounterProductionGroundDetail',
  )
  const midground = root.getObjectByName(
    'scale-encounter-production-midground-depth',
  )
  const middle = userDataRecord(
    midground,
    'scaleEncounterProductionMidground',
  )
  const farDepth = root.getObjectByName(
    'scale-encounter-production-far-depth',
  )
  const far = userDataRecord(
    farDepth,
    'scaleEncounterProductionFarDepth',
  )
  const understory = userDataRecord(
    root.getObjectByName('scale-encounter-production-grounded-understory'),
    'scaleEncounterProductionUnderstory',
  )
  const foregroundRoot = root.getObjectByName(
    'scale-encounter-real-forest-props',
  )
  let foregroundInstances = 0
  let foregroundDrawCalls = 0
  foregroundRoot?.children.forEach((child) => {
    if (!(child instanceof BatchedMesh)) return
    foregroundInstances += numericMetadata(
      child.userData,
      'scaleEncounterEcologyInstanceCount',
    )
    foregroundDrawCalls += 1
  })
  const heroRoot = root.getObjectByName(
    'scale-encounter-production-hero-ecology',
  )
  let heroInstances = 0
  let heroDrawCalls = 0
  heroRoot?.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return
    heroInstances += object.count
    heroDrawCalls += 1
  })
  const groundDetailInstances = numericMetadata(ground, 'instanceCount')
  const groundHumusPatches = numericMetadata(ground, 'humusPatchCount')
  const groundLitterPatches = numericMetadata(ground, 'litterPatchCount')
  const groundRootInstances = numericMetadata(ground, 'rootInstanceCount')
  const midgroundInstances = numericMetadata(middle, 'totalInstances')
  const farTreeInstances = numericMetadata(far, 'treeCount')
  const understoryInstances = numericMetadata(understory, 'totalInstances')
  const understoryFernInstances = numericMetadata(understory, 'fernCount')
  const understoryShrubInstances = numericMetadata(understory, 'shrubCount')
  const totalInstances =
    foregroundInstances +
    understoryInstances +
    groundDetailInstances +
    groundHumusPatches +
    groundLitterPatches +
    groundRootInstances +
    heroInstances +
    midgroundInstances +
    farTreeInstances
  root.userData.scaleEncounterEcologyPopulation = {
    density,
    drawCalls:
      numericMetadata(ground, 'drawCalls') +
      numericMetadata(middle, 'drawCalls') +
      numericMetadata(far, 'drawCalls') +
      numericMetadata(understory, 'drawCalls') +
      foregroundDrawCalls +
      heroDrawCalls,
    farTreeInstances,
    foregroundInstances,
    groundDetailInstances,
    groundHumusPatches,
    groundLitterPatches,
    groundRootInstances,
    heroInstances,
    midgroundInstances,
    totalInstances,
    understoryFernInstances,
    understoryInstances,
    understoryShrubInstances,
  }
}

export function createScaleEncounterEnvironment(
  habitat: ScaleEncounterHabitat,
  variant: ScaleEncounterEnvironmentVariant,
  panoramaTexture: Texture | null = null,
  options: ScaleEncounterEnvironmentOptions = {},
): ScaleEncounterEnvironment | null {
  const root = new Group()
  root.name = `scale-encounter-environment-${habitat}-${variant}`
  const effectiveVariant: ScaleEncounterEnvironmentVariant =
    options.animalId === 'tyrannosaurus-rex'
      ? variant
      : 'baseline'
  const ecologyDensity = options.ecologyDensity ?? 'current'
  root.userData.scaleEncounterEcologyDensity = ecologyDensity
  const skyDome = panoramaTexture
    ? createPanoramaDome(
        panoramaTexture,
        effectiveVariant === 'production-slice',
      )
    : createGradientDome(habitat)
  root.add(skyDome)
  const surfaceTextures = options.surfaceTextures ?? null
  const borrowedTextures = new Set<Texture>()
  if (panoramaTexture) borrowedTextures.add(panoramaTexture)
  if (surfaceTextures) {
    borrowedTextures.add(surfaceTextures.albedo)
    borrowedTextures.add(surfaceTextures.normal)
    borrowedTextures.add(surfaceTextures.roughness)
    if (surfaceTextures.dryLitterAlbedo) {
      borrowedTextures.add(surfaceTextures.dryLitterAlbedo)
    }
  }
  if (options.matureTreeAtlas) {
    borrowedTextures.add(options.matureTreeAtlas)
  }
  let animalContactCue: Mesh | null = null
  let childContactCue: Mesh | null = null
  if (habitat === 'land') {
    const contacts = createLandBase(
      root,
      surfaceTextures,
      panoramaTexture,
      options.animalId === 'mammoth',
      options.maxAnisotropy ?? 1,
      panoramaTexture !== null,
      effectiveVariant,
      ecologyDensity,
      options.forestProps ?? null,
      borrowedTextures,
    )
    animalContactCue = contacts.animalContactCue
    childContactCue = contacts.childContactCue
    // The displaced, distance-graded PBR grid supplies the panorama camera's
    // middle-ground parallax. Avoid conspicuous low-poly boulders or poles.
    // The panorama supplies the distant forest.  Only the procedural fallback
    // needs the old stylised tree proxies.
    if (
      !panoramaTexture &&
      (effectiveVariant === 'baseline' ||
        effectiveVariant === 'hybrid-slice' ||
        effectiveVariant === 'production-slice')
    ) {
      addForestDepth(root)
    }
    if (
      options.animalId === 'tyrannosaurus-rex' &&
      effectiveVariant === 'hybrid-slice'
    ) {
      addForestMiddleDistanceScreens(root)
    }
    if (
      options.animalId === 'tyrannosaurus-rex' &&
      effectiveVariant === 'production-slice'
    ) {
      root.add(
        createScaleEncounterProductionMidground(
          scaleEncounterProductionTerrainHeightAtWorld,
          ecologyDensity,
          options.forestProps ?? null,
          borrowedTextures,
          options.matureTreeAtlas ?? null,
        ),
        createScaleEncounterProductionFarDepth(
          scaleEncounterProductionTerrainHeightAtWorld,
          ecologyDensity,
          options.forestProps ?? null,
          borrowedTextures,
          options.matureTreeAtlas ?? null,
        ),
      )
      publishProductionEcologyPopulation(root, ecologyDensity)
    }
  } else if (habitat === 'air') {
    // A cloud deck remains in world space beneath the flight path.  This hides
    // the mirrored lower half of a pure-sky HDRI and supplies real parallax.
    addAirBase(root, true)
  } else {
    // The native 8K underwater panorama stays at infinity. The surface, light
    // shafts and scanned seabed provide world-space parallax near the subjects.
    addWaterBase(
      root,
      true,
      surfaceTextures,
      options.maxAnisotropy ?? 1,
    )
  }
  return {
    animalContactCue,
    borrowedTextures,
    childContactCue,
    distanceFogColour:
      habitat === 'land' && effectiveVariant === 'production-slice'
        // Match the decoded v5 plate just below its mist line. The former
        // lighter olive fog turned every distant alpha-tested crown into a
        // pale cutout and formed a visible grey shelf above the terrain.
        ? new Color('#5b5d54')
        : null,
    panoramaTexture,
    root,
    skyDome,
    variant,
  }
}

function positionGroundContact(
  cue: Mesh | null,
  subject: Object3D,
  scale: number,
): void {
  if (!cue) return
  const bounds = new Box3().setFromObject(subject, true)
  if (bounds.isEmpty()) {
    cue.visible = false
    return
  }
  const centre = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const contactGroundY = Number(
    cue.userData.scaleEncounterContactGroundY ?? -0.018,
  )
  cue.position.set(centre.x, contactGroundY, centre.z)
  cue.scale.set(
    Math.max(0.32, size.x * scale),
    Math.max(0.32, size.z * scale),
    1,
  )
  cue.visible = true
}

export function syncScaleEncounterGroundContacts(
  environment: ScaleEncounterEnvironment | null,
  animal: Object3D,
  child: Object3D,
): void {
  if (!environment) return
  positionGroundContact(environment.animalContactCue, animal, 0.38)
  positionGroundContact(environment.childContactCue, child, 0.5)
}

export function updateScaleEncounterEnvironment(
  environment: ScaleEncounterEnvironment | null,
  elapsedSeconds: number,
  reducedMotion: boolean,
  cameraPosition?: Vector3,
): void {
  if (!environment) {
    return
  }
  // Sky is effectively infinitely distant: keep the inward-facing dome
  // centred on the camera while ground, trees, clouds and water proxies stay
  // in world space. This prevents narrow portrait overviews from ever moving
  // outside the dome and preserves a seamless 360-degree background.
  if (cameraPosition) {
    environment.skyDome.position.copy(cameraPosition)
  }
  if (reducedMotion || environment.variant !== 'hybrid-slice') {
    return
  }
  for (const child of environment.root.children) {
    if (child.name.startsWith('scale-encounter-cloud-')) {
      const metadata = child.userData as unknown as Record<string, unknown>
      const baseX = metadata.scaleEncounterBaseX
      if (typeof baseX === 'number') {
        child.position.x =
          baseX + Math.sin(elapsedSeconds * 0.08 + child.id) * 0.18
      }
    } else if (child.name.startsWith('scale-encounter-light-shaft-')) {
      const metadata = child.userData as unknown as Record<string, unknown>
      const baseRotationZ = metadata.scaleEncounterBaseRotationZ
      if (typeof baseRotationZ === 'number') {
        child.rotation.z =
          baseRotationZ +
          Math.sin(elapsedSeconds * 0.16 + child.id) * 0.015
      }
    }
  }
}

export function disposeScaleEncounterEnvironment(
  environment: ScaleEncounterEnvironment | null,
): void {
  if (!environment) return
  const batchedMeshes = new Set<BatchedMesh>()
  // The page-level candidate cache owns the decoded panorama and PBR maps.
  // Detach every borrowed slot before the generic disposer releases this
  // environment's geometry, materials and locally-created alpha textures.
  environment.root.traverse((object) => {
    if (!(object instanceof Mesh) && !(object instanceof InstancedMesh)) return
    if (object instanceof BatchedMesh) batchedMeshes.add(object)
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      // Candidate props borrow more than `map`/`normalMap` (for example AO
      // and packed metal/roughness slots). Detach every borrowed texture
      // generically so switching A/B/C cannot close the cached GLB images.
      const materialRecord = material as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(materialRecord)) {
        if (
          value &&
          typeof value === 'object' &&
          'isTexture' in value &&
          environment.borrowedTextures.has(value as Texture)
        ) {
          materialRecord[key] = null
        }
      }
    }
  })
  // BatchedMesh owns matrix/indirect DataTextures in addition to its public
  // geometry. The generic mesh disposer cannot see those private resources.
  batchedMeshes.forEach((batch) => {
    batch.dispose()
    // BatchedMesh.dispose already released this generated aggregate geometry;
    // prevent the generic mesh pass from disposing the same buffer again.
    batch.geometry = new BufferGeometry()
  })
  disposeObject3D(environment.root)
}
