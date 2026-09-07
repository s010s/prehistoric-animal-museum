import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  type Texture,
} from 'three'

import type { ScaleEncounterSurfaceTextures } from '../../../viewer/scale-encounter-environment'
import { scaleEncounterProductionTerrainHeightAtWorld } from '../../../viewer/scale-encounter-production-terrain'

export const ACCEPTED_FOREST_BASIN_ID =
  'tyrannosaurus-layered-forested-mountain-basin-v1'

const ANIMAL_X = 2.2
const ANIMAL_Z = 0

interface ForestPatch {
  readonly countWeight: number
  readonly radiusX: number
  readonly radiusZ: number
  readonly x: number
  readonly z: number
}

interface ForestPlacement {
  readonly aspect: number
  readonly pitch: number
  readonly roll: number
  readonly scale: number
  readonly x: number
  readonly yaw: number
  readonly z: number
}

/**
 * Promotes the owner-approved D forest art direction into the integrated
 * encounter. The foreground remains the production clearing; this group adds
 * a continuous, textured 360-degree mountain basin and correctly scaled
 * distant tree profiles between roughly 100 and 326 metres.
 */
export function createAcceptedForestMountainBasin(
  matureTreeAtlas: Texture | null,
  surfaceTextures: ScaleEncounterSurfaceTextures | null,
): Group {
  const root = new Group()
  root.name = 'scale-encounter-accepted-forested-mountain-basin'
  root.userData.scaleEncounterAcceptedEnvironment = {
    defaultCandidate: true,
    id: ACCEPTED_FOREST_BASIN_ID,
    ownerVisualApproval: '2026-08-19',
    panoramaRole: 'sky-and-compressed-distant-treeline',
    productionApproved: true,
    worldSpaceDepthMeters: [100, 326],
  }
  root.add(createForestedMountainTerrain(surfaceTextures))
  if (matureTreeAtlas) {
    addDistantMountainTrees(root, matureTreeAtlas)
  }
  return root
}

/** Further reduces the accepted far plate's tree silhouettes. */
export function applyAcceptedForestFarFieldCompression(dome: Mesh): void {
  if (dome.userData.scaleEncounterAcceptedLatitudeCompression) return
  const uvs = dome.geometry.getAttribute('uv')
  const compression = 3.5
  const normalization = Math.tanh(compression * 0.5)
  for (let index = 0; index < uvs.count; index += 1) {
    const v = uvs.getY(index)
    uvs.setY(
      index,
      0.5 +
        (0.5 * Math.tanh(compression * (v - 0.5))) / normalization,
    )
  }
  uvs.needsUpdate = true
  dome.userData.scaleEncounterAcceptedLatitudeCompression = compression
}

export function acceptedForestMountainSurfaceHeightAtWorld(
  x: number,
  z: number,
): number {
  return (
    scaleEncounterProductionTerrainHeightAtWorld(x, z) +
    forestedMountainHeightAboveGroundAtWorld(x, z) +
    0.035
  )
}

function createForestedMountainTerrain(
  surfaceTextures: ScaleEncounterSurfaceTextures | null,
): Mesh<BufferGeometry, MeshStandardMaterial> {
  const innerRadius = 100
  const outerRadius = 326
  const angularSegments = 224
  const radialSegments = 68
  const verticesPerAngle = radialSegments + 1
  const positions: number[] = []
  const colours: number[] = []
  const surfaceBlends: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const forestShadow = new Color('#c2c6b5')
  const moss = new Color('#d2d0b8')
  const soil = new Color('#d9c6a9')
  const rock = new Color('#d8d5cc')
  const textureWorldSize = 11.5

  for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
    const angle = (angleIndex / angularSegments) * Math.PI * 2
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const progress = radialIndex / radialSegments
      const radius = mix(innerRadius, outerRadius, progress)
      const x = ANIMAL_X + cosine * radius
      const z = ANIMAL_Z + sine * radius
      const mountainHeight = forestedMountainHeightAboveGroundAtWorld(x, z)
      positions.push(
        x,
        scaleEncounterProductionTerrainHeightAtWorld(x, z) +
          mountainHeight +
          0.035,
        z,
      )
      uvs.push(x / textureWorldSize, z / textureWorldSize)

      const step = 2.2
      const slopeX =
        (forestedMountainHeightAboveGroundAtWorld(x + step, z) -
          forestedMountainHeightAboveGroundAtWorld(x - step, z)) /
        (step * 2)
      const slopeZ =
        (forestedMountainHeightAboveGroundAtWorld(x, z + step) -
          forestedMountainHeightAboveGroundAtWorld(x, z - step)) /
        (step * 2)
      const slope = Math.hypot(slopeX, slopeZ)
      const elevation = smoothstep(4, 48, mountainHeight)
      const forestVariation =
        0.5 +
        0.5 *
          Math.sin(x * 0.072 + Math.sin(z * 0.037) * 1.7) *
          Math.cos(z * 0.061 - x * 0.019)
      const soilVariation =
        0.5 +
        0.5 *
          Math.sin(x * 0.031 - z * 0.047 + Math.sin(x * 0.014) * 2.1) *
          Math.cos((x + z) * 0.024)
      const rockVariation =
        0.5 +
        0.5 * Math.sin(x * 0.097 + z * 0.041 + Math.sin(z * 0.028) * 1.8)
      const steepRock =
        smoothstep(0.16, 0.58, slope) * smoothstep(0.12, 0.74, elevation)
      const ridgeRock =
        smoothstep(0.58, 0.94, elevation) *
        smoothstep(0.6, 0.9, rockVariation)
      const exposedRock = Math.max(steepRock * 0.92, ridgeRock * 0.62)
      const weatheredSoil =
        (1 - exposedRock) *
        smoothstep(0.5, 0.84, soilVariation) *
        (0.28 + elevation * 0.58)
      const colour = forestShadow
        .clone()
        .lerp(moss, 0.18 + forestVariation * 0.44)
        .lerp(soil, weatheredSoil * 0.72)
        .lerp(rock, exposedRock * 0.9)
      colour.toArray(colours, colours.length)
      surfaceBlends.push(
        clampNumber(weatheredSoil * 0.82 + exposedRock * 0.94, 0, 1),
      )
    }
  }

  for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
    const nextAngle = (angleIndex + 1) % angularSegments
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const a = angleIndex * verticesPerAngle + radialIndex
      const b = nextAngle * verticesPerAngle + radialIndex
      const c = a + 1
      const d = b + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-continuous-forested-mountain-heightfield'
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3))
  geometry.setAttribute(
    'mountainSurfaceBlend',
    new Float32BufferAttribute(surfaceBlends, 1),
  )
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const material = new MeshStandardMaterial({
    color: '#918d7d',
    map: surfaceTextures?.albedo ?? null,
    metalness: 0,
    normalMap: surfaceTextures?.normal ?? null,
    normalScale: new Vector2(0.14, 0.14),
    roughness: 0.98,
    roughnessMap: surfaceTextures?.roughness ?? null,
    vertexColors: true,
  })
  material.name = 'scale-encounter-forested-mountain-slope-material'
  material.dithering = true
  if (surfaceTextures?.dryLitterAlbedo) {
    const dryLitterAlbedo = surfaceTextures.dryLitterAlbedo
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uAcceptedMountainDryAlbedo = { value: dryLitterAlbedo }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float mountainSurfaceBlend;
varying float vAcceptedMountainSurfaceBlend;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vAcceptedMountainSurfaceBlend = mountainSurfaceBlend;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uAcceptedMountainDryAlbedo;
varying float vAcceptedMountainSurfaceBlend;`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  vec4 acceptedForestAlbedo = texture2D( map, vMapUv );
  vec4 acceptedDryAlbedo = texture2D(
    uAcceptedMountainDryAlbedo,
    vMapUv * 0.73 + vec2(0.173, 0.349)
  );
  vec4 sampledDiffuseColor = mix(
    acceptedForestAlbedo,
    acceptedDryAlbedo,
    smoothstep(0.12, 0.88, vAcceptedMountainSurfaceBlend)
  );
  diffuseColor *= sampledDiffuseColor;
#endif`,
        )
    }
    material.customProgramCacheKey = () =>
      'accepted-mountain-forest-soil-rock-blend-v1'
  }

  const terrain = new Mesh(geometry, material)
  terrain.name = 'scale-encounter-accepted-360-forested-mountain-basin'
  terrain.castShadow = false
  terrain.receiveShadow = true
  return terrain
}

function addDistantMountainTrees(destination: Group, atlas: Texture): void {
  const outerPatches: readonly ForestPatch[] = [
    { x: -112, z: -78, radiusX: 39, radiusZ: 30, countWeight: 1.12 },
    { x: -72, z: -139, radiusX: 46, radiusZ: 34, countWeight: 0.96 },
    { x: -14, z: -184, radiusX: 48, radiusZ: 32, countWeight: 0.82 },
    { x: 61, z: -172, radiusX: 45, radiusZ: 36, countWeight: 1.05 },
    { x: 128, z: -119, radiusX: 42, radiusZ: 39, countWeight: 1.14 },
    { x: 181, z: -42, radiusX: 33, radiusZ: 47, countWeight: 0.84 },
    { x: 186, z: 48, radiusX: 36, radiusZ: 48, countWeight: 1.02 },
    { x: 139, z: 116, radiusX: 45, radiusZ: 38, countWeight: 1.15 },
    { x: 73, z: 168, radiusX: 48, radiusZ: 34, countWeight: 0.92 },
    { x: 4, z: 203, radiusX: 51, radiusZ: 32, countWeight: 0.86 },
    { x: -72, z: 177, radiusX: 46, radiusZ: 37, countWeight: 1.06 },
    { x: -139, z: 119, radiusX: 42, radiusZ: 43, countWeight: 1.08 },
    { x: -190, z: 38, radiusX: 35, radiusZ: 49, countWeight: 0.8 },
    { x: -178, z: -47, radiusX: 36, radiusZ: 45, countWeight: 0.96 },
  ]
  const innerPatches: readonly ForestPatch[] = [
    { x: 0, z: -139, radiusX: 43, radiusZ: 31, countWeight: 1.08 },
    { x: 98, z: -98, radiusX: 37, radiusZ: 35, countWeight: 0.94 },
    { x: 140, z: 0, radiusX: 31, radiusZ: 44, countWeight: 1.02 },
    { x: 100, z: 99, radiusX: 38, radiusZ: 34, countWeight: 1.12 },
    { x: 0, z: 142, radiusX: 45, radiusZ: 31, countWeight: 1.16 },
    { x: -99, z: 99, radiusX: 37, radiusZ: 36, countWeight: 0.98 },
    { x: -141, z: 0, radiusX: 31, radiusZ: 45, countWeight: 1.04 },
    { x: -98, z: -98, radiusX: 37, radiusZ: 35, countWeight: 0.92 },
  ]
  const placements = [
    ...createPatchPlacements(
      outerPatches,
      1_100,
      104,
      306,
      0x2fc751d9,
      9.4,
      19.5,
      0.62,
    ),
    ...createPatchPlacements(
      innerPatches,
      760,
      104,
      204,
      0x81a74d2f,
      7.2,
      15.8,
      0.78,
    ),
  ].filter(
    ({ x, z }) => forestedMountainHeightAboveGroundAtWorld(x, z) > 1.4,
  )

  const material = new MeshBasicMaterial({
    alphaTest: 0.33,
    alphaToCoverage: true,
    color: '#d8dccb',
    fog: true,
    map: atlas,
    side: DoubleSide,
    transparent: false,
  })
  material.name = 'scale-encounter-correct-scale-distant-tree-atlas'
  const helper = new Object3D()
  const dark = new Color('#627157')
  const light = new Color('#88917c')
  const profileCount = 8

  for (let profile = 0; profile < profileCount; profile += 1) {
    const profilePlacements = placements.filter(
      (_placement, index) => index % profileCount === profile,
    )
    const instances = new InstancedMesh(
      createDistantTreeAtlasGeometry(profile),
      material,
      profilePlacements.length,
    )
    instances.name = `scale-encounter-mountain-tree-profile-${profile + 1}`
    profilePlacements.forEach((placement, index) => {
      const widthScale = 0.64 + placement.aspect * 0.19
      helper.position.set(
        placement.x,
        acceptedForestMountainSurfaceHeightAtWorld(
          placement.x,
          placement.z,
        ) - 0.04,
        placement.z,
      )
      helper.rotation.set(
        placement.pitch * 0.28,
        placement.yaw,
        placement.roll * 0.28,
      )
      helper.scale.set(
        placement.scale * widthScale,
        placement.scale,
        placement.scale * widthScale,
      )
      helper.updateMatrix()
      instances.setMatrixAt(index, helper.matrix)
      instances.setColorAt(
        index,
        dark.clone().lerp(light, ((index * 5 + profile * 3) % 13) / 18),
      )
    })
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    instances.computeBoundingBox()
    instances.computeBoundingSphere()
    destination.add(instances)
  }
}

function createDistantTreeAtlasGeometry(profile: number): BufferGeometry {
  const columns = 4
  const rows = 2
  const column = profile % columns
  const rowFromTop = Math.floor(profile / columns)
  const paddingU = 0.009
  const paddingV = 0.008
  const u0 = (column + paddingU) / columns
  const u1 = (column + 1 - paddingU) / columns
  const v0 = 1 - (rowFromTop + 1 - paddingV) / rows
  const v1 = 1 - (rowFromTop + paddingV) / rows
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let planeIndex = 0; planeIndex < 2; planeIndex += 1) {
    const yaw = planeIndex * Math.PI * 0.5 +
      (profile % 2 === 0 ? 0.035 : -0.03)
    const horizontalX = Math.cos(yaw) * 0.5
    const horizontalZ = Math.sin(yaw) * 0.5
    const vertexOffset = planeIndex * 4
    positions.push(
      -horizontalX, 0, -horizontalZ,
      horizontalX, 0, horizontalZ,
      horizontalX, 1, horizontalZ,
      -horizontalX, 1, -horizontalZ,
    )
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1)
    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset,
      vertexOffset + 2,
      vertexOffset + 3,
    )
  }
  const geometry = new BufferGeometry()
  geometry.name = `scale-encounter-distant-tree-profile-${profile + 1}`
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createPatchPlacements(
  patches: readonly ForestPatch[],
  count: number,
  minimumRadius: number,
  maximumRadius: number,
  seed: number,
  minimumScale: number,
  maximumScale: number,
  radialPower: number,
): ForestPlacement[] {
  const random = seededRandom(seed)
  const placements: ForestPlacement[] = []
  const totalWeight = patches.reduce(
    (sum, patch) => sum + patch.countWeight,
    0,
  )
  for (let attempt = 0; attempt < count * 30 && placements.length < count; attempt += 1) {
    let selector = random() * totalWeight
    let patch = patches.at(-1)!
    for (const candidate of patches) {
      selector -= candidate.countWeight
      if (selector <= 0) {
        patch = candidate
        break
      }
    }
    const angle = random() * Math.PI * 2
    const clusteredRadius = random() ** radialPower
    const x = patch.x + Math.cos(angle) * patch.radiusX * clusteredRadius
    const z = patch.z + Math.sin(angle) * patch.radiusZ * clusteredRadius
    const radius = Math.hypot(x - ANIMAL_X, z - ANIMAL_Z)
    if (radius < minimumRadius || radius > maximumRadius) continue
    placements.push({
      aspect: 0.78 + random() * 0.48,
      pitch: (random() - 0.5) * 0.055,
      roll: (random() - 0.5) * 0.055,
      scale: minimumScale + random() * (maximumScale - minimumScale),
      x,
      yaw: random() * Math.PI * 2,
      z,
    })
  }
  return placements
}

function forestedMountainHeightAboveGroundAtWorld(
  x: number,
  z: number,
): number {
  const deltaX = x - ANIMAL_X
  const deltaZ = z - ANIMAL_Z
  const radius = Math.hypot(deltaX, deltaZ)
  if (radius <= 100 || radius >= 326) return 0
  const angle = Math.atan2(deltaZ, deltaX)
  const edgeFade =
    smoothstep(100, 122, radius) * (1 - smoothstep(302, 326, radius))
  const frontCentre =
    154 + Math.sin(angle * 2 - 0.7) * 15 + Math.sin(angle * 5 + 1.2) * 7
  const backCentre =
    250 + Math.sin(angle * 3 + 0.35) * 20 + Math.sin(angle * 7 - 0.9) * 8
  const frontEnvelope = Math.exp(-Math.pow((radius - frontCentre) / 45, 2))
  const backEnvelope = Math.exp(-Math.pow((radius - backCentre) / 64, 2))
  const frontProfile = clampNumber(
    0.63 +
      Math.sin(angle * 3 + 0.25) * 0.23 +
      Math.sin(angle * 7 - 1.1) * 0.13 +
      Math.cos(angle * 11 + 0.8) * 0.07,
    0.24,
    1.08,
  )
  const backProfile = clampNumber(
    0.84 +
      Math.sin(angle * 2 - 0.6) * 0.2 +
      Math.sin(angle * 5 + 0.55) * 0.15 +
      Math.cos(angle * 9 - 0.35) * 0.09,
    0.42,
    1.24,
  )
  const erosion =
    (Math.sin(x * 0.055 + z * 0.017) * 0.7 +
      Math.sin(z * 0.083 - x * 0.026) * 0.42 +
      Math.cos((x + z) * 0.031) * 0.34) *
    (frontEnvelope * 0.65 + backEnvelope) *
    1.35
  return Math.max(
    0,
    edgeFade *
      (frontEnvelope * 14.5 * frontProfile +
        backEnvelope * 31 * backProfile +
        erosion),
  )
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, value))
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = clampNumber((value - start) / (end - start), 0, 1)
  return amount * amount * (3 - 2 * amount)
}

function mix(a: number, b: number, amount: number): number {
  return a * (1 - amount) + b * amount
}
