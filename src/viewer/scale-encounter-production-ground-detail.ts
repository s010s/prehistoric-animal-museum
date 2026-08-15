import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ZeroFactor,
} from 'three'
import {
  scaleEncounterEcologyCount,
  type ScaleEncounterEcologyDensity,
} from './scale-encounter-ecology-density'

/**
 * Low-profile forest-floor breakup for the production encounter.
 *
 * The source litter assets are opaque radial cards, so using them as decals
 * creates obvious atlas-coloured disks. This replacement reuses their already
 * reviewed world-space colony layout but renders small opaque twig/leaf shards
 * as one instanced geometric batch. It adds no texture memory or alpha sorting
 * and remains valid through a full 360-degree orbit.
 */

type TerrainHeightAtWorld = (worldX: number, worldZ: number) => number

export const SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED = 0x38d1_6f2b

interface GroundDetailSample {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface GroundDetailPatch {
  readonly radiusX: number
  readonly radiusZ: number
  readonly x: number
  readonly z: number
}

interface GroundDetailPlacement {
  readonly aspect: number
  readonly patchId: number
  readonly pitch: number
  readonly roll: number
  readonly scale: number
  readonly x: number
  readonly yaw: number
  readonly z: number
}

const GROUND_DETAIL_INSTANCE_COUNT = 520
const GROUND_DETAIL_PATCHES = [
  // Subject-edge micro-biomes. These sit just outside the protected animal
  // footprint and child rail, so close cameras see roots and decomposing
  // litter without losing either silhouette or placing debris under a foot.
  { x: -2, z: 7.2, radiusX: 5.2, radiusZ: 1.9 },
  { x: 9.8, z: 5.9, radiusX: 3.6, radiusZ: 1.8 },
  { x: -3.8, z: -7.4, radiusX: 5, radiusZ: 2 },
  { x: 10.4, z: -5.8, radiusX: 3.7, radiusZ: 1.8 },
  { x: -13.2, z: 3.7, radiusX: 5.5, radiusZ: 1.15 },
  { x: -13.4, z: -3.7, radiusX: 5.1, radiusZ: 1.2 },
  { x: -17, z: 14, radiusX: 12, radiusZ: 8 },
  { x: 20, z: 17, radiusX: 14, radiusZ: 9 },
  { x: -28, z: -16, radiusX: 16, radiusZ: 10 },
  { x: 32, z: -21, radiusX: 15, radiusZ: 11 },
  { x: -45, z: 23, radiusX: 18, radiusZ: 12 },
  { x: 49, z: 30, radiusX: 19, radiusZ: 13 },
  { x: -15, z: -43, radiusX: 15, radiusZ: 13 },
  { x: 19, z: -49, radiusX: 17, radiusZ: 14 },
  { x: -58, z: -20, radiusX: 19, radiusZ: 14 },
  { x: 61, z: -8, radiusX: 18, radiusZ: 15 },
  { x: -96, z: 31, radiusX: 27, radiusZ: 21 },
  { x: 104, z: -28, radiusX: 28, radiusZ: 23 },
  { x: -78, z: -94, radiusX: 25, radiusZ: 28 },
  { x: 82, z: -108, radiusX: 28, radiusZ: 30 },
  { x: -129, z: -47, radiusX: 29, radiusZ: 24 },
  { x: 134, z: 58, radiusX: 31, radiusZ: 27 },
  { x: -34, z: 139, radiusX: 28, radiusZ: 32 },
  { x: 49, z: 153, radiusX: 30, radiusZ: 27 },
] as const satisfies ReadonlyArray<GroundDetailPatch>

export interface ScaleEncounterProductionGroundDetailMetadata {
  readonly density: ScaleEncounterEcologyDensity
  readonly drawCalls: number
  readonly estimatedTriangles: number
  readonly humusPatchCount: number
  readonly instanceCount: number
  readonly litterPatchCount: number
  readonly representation: 'instanced-twigs-humus-roots-and-authored-soil-impressions'
  readonly rootInstanceCount: number
  readonly rootSamples: ReadonlyArray<GroundDetailSample>
  readonly samples: ReadonlyArray<GroundDetailSample>
  readonly seed: number
  readonly soilImpressionCount: number
}

const HERO_SOIL_IMPRESSIONS = [
  // Two broad, offset theropod foot-compression marks. They are deliberately
  // subtle and do not try to replace the animated real-time foot shadows.
  { x: 3.7, z: -1.05, scaleX: 0.78, scaleZ: 0.46, yaw: 0.12 },
  { x: 5.1, z: 0.92, scaleX: 0.72, scaleZ: 0.43, yaw: -0.08 },
  // A short child track across the observation rail gives the contact cue a
  // soil response without placing vegetation beneath the avatar.
  { x: -12.8, z: -0.2, scaleX: 0.2, scaleZ: 0.34, yaw: 0.08 },
  { x: -12.25, z: 0.18, scaleX: 0.19, scaleZ: 0.32, yaw: -0.04 },
  { x: -13.35, z: 0.14, scaleX: 0.18, scaleZ: 0.3, yaw: 0.12 },
] as const

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function appendShard(
  positions: number[],
  colours: number[],
  indices: number[],
  centreX: number,
  centreZ: number,
  halfLength: number,
  halfWidth: number,
  yaw: number,
  colour: Color,
  height: number,
): void {
  const tangentX = Math.cos(yaw)
  const tangentZ = Math.sin(yaw)
  const sideX = -tangentZ
  const sideZ = tangentX
  const base = positions.length / 3
  const corners = [
    [-halfLength, -halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
  ] as const
  for (const [along, across] of corners) {
    positions.push(
      centreX + tangentX * along + sideX * across,
      height,
      centreZ + tangentZ * along + sideZ * across,
    )
    colour.toArray(colours, colours.length)
  }
  // Winding points upward in the geometry's native XZ floor plane.
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
}

function appendTwigPrism(
  positions: number[],
  colours: number[],
  indices: number[],
  centreX: number,
  centreZ: number,
  halfLength: number,
  halfWidth: number,
  yaw: number,
  colour: Color,
  height: number,
): void {
  const tangentX = Math.cos(yaw)
  const tangentZ = Math.sin(yaw)
  const sideX = -tangentZ
  const sideZ = tangentX
  const base = positions.length / 3
  // A triangular cross-section gives the twigs a real grazing silhouette and
  // catches a narrow highlight without the cost of cylindrical geometry.
  for (const along of [-halfLength, halfLength]) {
    positions.push(
      centreX + tangentX * along - sideX * halfWidth,
      height,
      centreZ + tangentZ * along - sideZ * halfWidth,
      centreX + tangentX * along + sideX * halfWidth,
      height,
      centreZ + tangentZ * along + sideZ * halfWidth,
      centreX + tangentX * along,
      height + halfWidth * 1.55,
      centreZ + tangentZ * along,
    )
    colour.toArray(colours, colours.length)
    colour.toArray(colours, colours.length)
    colour.toArray(colours, colours.length)
  }
  // Two end caps and three rectangular sides, eight triangles total.
  indices.push(
    base,
    base + 2,
    base + 1,
    base + 3,
    base + 4,
    base + 5,
    base,
    base + 3,
    base + 5,
    base,
    base + 5,
    base + 2,
    base + 1,
    base + 2,
    base + 5,
    base + 1,
    base + 5,
    base + 4,
    base,
    base + 1,
    base + 4,
    base,
    base + 4,
    base + 3,
  )
}

function createGroundDetailClusterGeometry(): BufferGeometry {
  const random = createSeededRandom(
    SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED,
  )
  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const palette = [
    new Color('#554b3e'),
    new Color('#625545'),
    new Color('#594d40'),
    new Color('#4e5446'),
    new Color('#695947'),
  ] as const

  // Fine needles and snapped twig fragments.
  for (let index = 0; index < 9; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 0.08 + random() ** 0.62 * 0.56
    appendShard(
      positions,
      colours,
      indices,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.05 + random() * 0.105,
      0.006 + random() * 0.009,
      random() * Math.PI,
      palette[index % palette.length]!,
      0.004 + random() * 0.009,
    )
  }

  // Broader decomposing leaf shards break the needle field without becoming
  // readable modern leaves at the intended camera distance.
  for (let index = 0; index < 4; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 0.12 + random() * 0.42
    appendShard(
      positions,
      colours,
      indices,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.04 + random() * 0.06,
      0.018 + random() * 0.024,
      random() * Math.PI,
      palette[(index + 2) % palette.length]!,
      0.007 + random() * 0.012,
    )
  }

  // A few raised snapped twigs keep the colony legible at child-eye height.
  // They share this geometry and instanced batch, so parallax costs no extra
  // draw call, texture fetch, or alpha-sorted surface.
  for (let index = 0; index < 3; index += 1) {
    const angle = random() * Math.PI * 2
    const radius = 0.11 + random() * 0.38
    appendTwigPrism(
      positions,
      colours,
      indices,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.075 + random() * 0.105,
      0.007 + random() * 0.006,
      random() * Math.PI,
      palette[(index + 1) % palette.length]!,
      0.008 + random() * 0.008,
    )
  }

  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-production-ground-detail-cluster-geometry'
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createCompactedHumusPatchGeometry(): BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const centre = new Color('#8f927e')
  const edge = new Color('#3d4038')
  const segments = 18
  positions.push(0, 0.002, 0)
  centre.toArray(colours, 0)
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const radius = 0.72 + Math.sin(angle * 3 + 0.7) * 0.12 + Math.sin(angle * 7) * 0.06
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    edge.toArray(colours, colours.length)
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, index + 1, ((index + 1) % segments) + 1)
  }
  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-production-compacted-humus-patch-geometry'
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function distanceToChildRail(x: number, z: number): number {
  const closestX = Math.max(-23, Math.min(-6, x))
  return Math.hypot(x - closestX, z)
}

function outsideSubjectCorridor(x: number, z: number): boolean {
  const outsideAnimal = ((x - 2.2) / 10.5) ** 2 + (z / 5.2) ** 2 >= 1
  return outsideAnimal && distanceToChildRail(x, z) >= 2.4
}

function createGroundDetailPlacements(
  instanceCount: number,
): GroundDetailPlacement[] {
  const random = createSeededRandom(
    SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED + 97,
  )
  const placements: GroundDetailPlacement[] = []
  for (let index = 0; index < instanceCount; index += 1) {
    let accepted:
      | { readonly patchId: number; readonly x: number; readonly z: number }
      | undefined
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const patchId = (index * 7 + Math.floor(random() * 3)) % GROUND_DETAIL_PATCHES.length
      const patch = GROUND_DETAIL_PATCHES[patchId]!
      const angle = random() * Math.PI * 2
      // Dense centres with ragged gaps read as accumulated debris rather than
      // a uniformly scattered icon field.
      const radius = random() ** 1.8
      const x = patch.x + Math.cos(angle) * patch.radiusX * radius
      const z = patch.z + Math.sin(angle) * patch.radiusZ * radius
      const minimumSeparation = attempt < 170 ? 0.52 : 0.34
      if (
        Math.hypot(x, z) < 3.2 ||
        Math.hypot(x, z) > 188 ||
        !outsideSubjectCorridor(x, z) ||
        placements.some(
          (placement) =>
            Math.hypot(placement.x - x, placement.z - z) < minimumSeparation,
        )
      ) {
        continue
      }
      accepted = { patchId, x, z }
      break
    }
    if (!accepted) {
      throw new Error(
        `Could not place production ground detail ${index + 1}/${instanceCount}`,
      )
    }
    placements.push({
      aspect: 0.78 + random() * 0.48,
      patchId: accepted.patchId,
      pitch: (random() - 0.5) * 0.035,
      roll: (random() - 0.5) * 0.035,
      scale: 0.72 + random() * 0.78,
      x: accepted.x,
      yaw: random() * Math.PI * 2,
      z: accepted.z,
    })
  }
  return placements
}

function createSurfaceRootFanGeometry(): BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const palette = [
    new Color('#625a4c'),
    new Color('#716757'),
    new Color('#585548'),
  ] as const
  for (let index = 0; index < 5; index += 1) {
    const yaw = (index / 5) * Math.PI * 2 + Math.sin(index * 2.17) * 0.18
    const length = 0.52 + (index % 3) * 0.14
    appendTwigPrism(
      positions,
      colours,
      indices,
      Math.cos(yaw) * length * 0.43,
      Math.sin(yaw) * length * 0.43,
      length * 0.52,
      0.026 + (index % 2) * 0.008,
      yaw,
      palette[index % palette.length]!,
      0.002,
    )
  }
  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-production-surface-root-fan-geometry'
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(colours), 3),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createScaleEncounterProductionGroundDetail(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  density: ScaleEncounterEcologyDensity = 'current',
): Group {
  const placements = createGroundDetailPlacements(
    scaleEncounterEcologyCount(GROUND_DETAIL_INSTANCE_COUNT, density),
  )
  const geometry = createGroundDetailClusterGeometry()
  const material = new MeshStandardMaterial({
    color: '#c1b9aa',
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    roughness: 0.97,
    side: DoubleSide,
    vertexColors: true,
  })
  material.name = 'scale-encounter-production-ground-detail-material'

  const mesh = new InstancedMesh(geometry, material, placements.length)
  mesh.name = 'scale-encounter-production-ground-detail-instances'
  mesh.castShadow = false
  mesh.receiveShadow = true
  const transform = new Object3D()
  const instancePalettes = [
    new Color('#d0c8b8'),
    new Color('#c4bcae'),
    new Color('#cfc1ae'),
    new Color('#bcc4b5'),
  ] as const
  const samples: GroundDetailSample[] = []
  const geometryBounds = geometry.boundingBox?.clone()
  if (!geometryBounds) {
    throw new Error('Production ground-detail geometry has no bounds')
  }

  placements.forEach((placement, index) => {
    const terrainY = terrainHeightAtWorld(placement.x, placement.z)
    transform.position.set(placement.x, 0, placement.z)
    transform.rotation.set(placement.pitch, placement.yaw, placement.roll)
    const scale = placement.scale * 0.52
    transform.scale.set(scale * placement.aspect, scale, scale)
    transform.updateMatrix()
    const zeroHeightBounds = geometryBounds
      .clone()
      .applyMatrix4(transform.matrix)
    transform.position.y = terrainY - 0.0015 - zeroHeightBounds.min.y
    transform.updateMatrix()
    const finalBounds = geometryBounds.clone().applyMatrix4(transform.matrix)
    mesh.setMatrixAt(index, transform.matrix)
    mesh.setColorAt(index, instancePalettes[(index * 5 + placement.patchId) % 4]!)
    if (samples.length < 12) {
      samples.push({ x: placement.x, y: finalBounds.min.y, z: placement.z })
    }
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()

  const patchGeometry = createCompactedHumusPatchGeometry()
  const patchMaterial = new MeshBasicMaterial({
    blendDst: ZeroFactor,
    blendSrc: DstColorFactor,
    blending: CustomBlending,
    depthWrite: false,
    // The previous 7.5% multiply was effectively invisible once ACES and the
    // ground normal map were applied. A still-restrained 13% response creates
    // readable damp pockets and foot-compression variation without looking
    // like transparent decals or hiding the continuous terrain material.
    opacity: 0.13,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    transparent: true,
    vertexColors: true,
  })
  patchMaterial.name = 'scale-encounter-production-compacted-humus-patch-material'
  const patchCount = scaleEncounterEcologyCount(64, density)
  const totalPatchCount = patchCount + HERO_SOIL_IMPRESSIONS.length
  const patches = new InstancedMesh(
    patchGeometry,
    patchMaterial,
    totalPatchCount,
  )
  patches.name = 'scale-encounter-production-compacted-humus-patches'
  patches.castShadow = false
  patches.receiveShadow = false
  const patchRandom = createSeededRandom(
    SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED + 701,
  )
  for (let index = 0; index < patchCount; index += 1) {
    const placement = placements[(index * 11 + 7) % placements.length]!
    const y = terrainHeightAtWorld(placement.x, placement.z) + 0.0015
    transform.position.set(placement.x, y, placement.z)
    transform.rotation.set(0, patchRandom() * Math.PI * 2, 0)
    const scale = 0.85 + patchRandom() * 2.2
    transform.scale.set(
      scale * (0.7 + patchRandom() * 0.8),
      1,
      scale * (0.62 + patchRandom() * 0.72),
    )
    transform.updateMatrix()
    patches.setMatrixAt(index, transform.matrix)
    patches.setColorAt(
      index,
      index % 3 === 0
        ? new Color('#747e68')
        : index % 3 === 1
          ? new Color('#716a59')
          : new Color('#62685b'),
    )
  }
  HERO_SOIL_IMPRESSIONS.forEach((impression, impressionIndex) => {
    const instanceIndex = patchCount + impressionIndex
    const y = terrainHeightAtWorld(impression.x, impression.z) + 0.001
    transform.position.set(impression.x, y, impression.z)
    transform.rotation.set(0, impression.yaw, 0)
    transform.scale.set(impression.scaleX, 1, impression.scaleZ)
    transform.updateMatrix()
    patches.setMatrixAt(instanceIndex, transform.matrix)
    patches.setColorAt(
      instanceIndex,
      impressionIndex < 2 ? new Color('#555448') : new Color('#5d5d50'),
    )
  })
  patches.instanceMatrix.needsUpdate = true
  if (patches.instanceColor) patches.instanceColor.needsUpdate = true
  patches.computeBoundingBox()
  patches.computeBoundingSphere()

  const rootInstanceCount =
    density === 'current' ? 24 : density === '1.25x' ? 34 : 46
  const rootGeometry = createSurfaceRootFanGeometry()
  const rootMaterial = new MeshStandardMaterial({
    color: '#c7c2b4',
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    roughness: 0.98,
    vertexColors: true,
  })
  rootMaterial.name = 'scale-encounter-production-surface-root-material'
  const roots = new InstancedMesh(
    rootGeometry,
    rootMaterial,
    rootInstanceCount,
  )
  roots.name = 'scale-encounter-production-surface-roots'
  roots.castShadow = false
  roots.receiveShadow = true
  const rootPlacements = placements.filter(({ x, z }) => {
    const radius = Math.hypot(x, z)
    return radius >= 16 && radius <= 84
  })
  const rootSamples: GroundDetailSample[] = []
  const rootBounds = rootGeometry.boundingBox?.clone()
  if (!rootBounds) {
    throw new Error('Production surface-root geometry has no bounds')
  }
  for (let index = 0; index < rootInstanceCount; index += 1) {
    const placement = rootPlacements[(index * 29 + 13) % rootPlacements.length]!
    const terrainY = terrainHeightAtWorld(placement.x, placement.z)
    transform.position.set(placement.x, 0, placement.z)
    transform.rotation.set(0, placement.yaw + index * 0.37, 0)
    const scale = 0.72 + ((index * 17) % 13) / 13
    transform.scale.set(
      scale * (0.84 + placement.aspect * 0.18),
      scale,
      scale * (0.88 + ((index * 7) % 9) * 0.025),
    )
    transform.updateMatrix()
    const zeroHeightBounds = rootBounds.clone().applyMatrix4(transform.matrix)
    transform.position.y = terrainY - 0.002 - zeroHeightBounds.min.y
    transform.updateMatrix()
    const finalBounds = rootBounds.clone().applyMatrix4(transform.matrix)
    roots.setMatrixAt(index, transform.matrix)
    if (rootSamples.length < 12) {
      rootSamples.push({
        x: placement.x,
        y: finalBounds.min.y,
        z: placement.z,
      })
    }
  }
  roots.instanceMatrix.needsUpdate = true
  roots.computeBoundingBox()
  roots.computeBoundingSphere()

  const triangleCount = (geometry.getIndex()?.count ?? 0) / 3
  const patchTriangleCount = (patchGeometry.getIndex()?.count ?? 0) / 3
  const rootTriangleCount = (rootGeometry.getIndex()?.count ?? 0) / 3
  const metadata: ScaleEncounterProductionGroundDetailMetadata = {
    density,
    drawCalls: rootInstanceCount > 0 ? 3 : 2,
    estimatedTriangles:
      triangleCount * placements.length +
      patchTriangleCount * patchCount +
      rootTriangleCount * rootInstanceCount,
    humusPatchCount: patchCount,
    instanceCount: placements.length,
    litterPatchCount: 0,
    representation: 'instanced-twigs-humus-roots-and-authored-soil-impressions',
    rootInstanceCount,
    rootSamples,
    samples,
    seed: SCALE_ENCOUNTER_PRODUCTION_GROUND_DETAIL_SEED,
    soilImpressionCount: HERO_SOIL_IMPRESSIONS.length,
  }
  const root = new Group()
  root.name = 'scale-encounter-production-ground-detail'
  root.userData.scaleEncounterProductionGroundDetail = metadata
  root.add(patches, mesh)
  root.add(roots)
  return root
}
