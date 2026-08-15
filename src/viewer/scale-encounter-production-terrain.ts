import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  type Material,
} from 'three'

/**
 * Production-candidate terrain topology for the direct scale encounter.
 *
 * Coordinates passed to the pure terrain functions are the ground mesh's
 * local XY coordinates. The host rotates the mesh -PI / 2 around world X, so
 * world (x, z) must be sampled as local (x, -z). Keeping that conversion at a
 * named boundary prevents props and contact tests from being mirrored.
 */

export const SCALE_ENCOUNTER_PRODUCTION_TERRAIN_RADIUS_METERS = 360
/** World transform used by the production terrain mesh. */
export const SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS = -0.04
// Kept as a compatibility/exported quality boundary. The production floor is
// no longer a perfectly flat 22 m disc: only the animal footprint and child
// observation rail are flattened, while the visible clearing carries subtle
// centimetre-scale relief.
export const SCALE_ENCOUNTER_PRODUCTION_CLEARING_RADIUS_METERS = 22
export const SCALE_ENCOUNTER_PRODUCTION_RELIEF_FULL_STRENGTH_RADIUS_METERS = 52
export const SCALE_ENCOUNTER_PRODUCTION_MICRO_RELIEF_MAXIMUM_METERS = 0.075

const TAU = Math.PI * 2
// Keep the authored clearing at world Y=0 so grounded subjects, contact
// shadows and every ecology layer share one physical surface. The previous
// -0.48 m local base combined with the mesh's -0.04 m world transform and
// left both the child and animal visibly suspended above the terrain.
const TERRAIN_BASE_HEIGHT_METERS =
  -SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS
const INNER_RADII = [
  0,
  1.5,
  3,
  4.5,
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
  29,
  34,
  40,
  47,
  55,
] as const
const OUTER_RADIAL_STEPS = 24
const ANGULAR_SEGMENTS = 144
const ANGLE_JITTER_RADIANS = 0.011
const RADIUS_JITTER_RATIO = 0.055

interface TerrainSample {
  readonly localX: number
  readonly localY: number
  readonly height: number
  readonly radius: number
}

export interface ScaleEncounterProductionTerrain {
  readonly groundGeometry: BufferGeometry
  readonly middleDistance: Group
}

/**
 * Terrain density is front-loaded into the encounter's camera envelope. The
 * guided overview/POV path never needs sub-metre tessellation at the outer
 * 200 m plate, but the first 80 m must be dense enough that displaced rings do
 * not turn into visible screen-wide facets on a phone.
 */
export function scaleEncounterProductionTerrainAngularSegmentsForRadius(
  radius: number,
): number {
  if (radius <= 82) return 288
  if (radius <= 170) return 216
  return ANGULAR_SEGMENTS
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(start: number, end: number, value: number): number {
  const progress = clamp01((value - start) / (end - start))
  return progress * progress * (3 - 2 * progress)
}

function smootherstep(start: number, end: number, value: number): number {
  const progress = clamp01((value - start) / (end - start))
  return progress ** 3 * (progress * (progress * 6 - 15) + 10)
}

function hash01(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43_758.545_312_3
  return value - Math.floor(value)
}

function distanceToHorizontalSegment(
  x: number,
  y: number,
  minimumX: number,
  maximumX: number,
): number {
  const closestX = Math.max(minimumX, Math.min(maximumX, x))
  return Math.hypot(x - closestX, y)
}

function subjectFloorReliefMask(localX: number, localY: number): number {
  const animalDistance = Math.sqrt(
    ((localX - 2.2) / 9.2) ** 2 + (localY / 4.2) ** 2,
  )
  const animalMask = smootherstep(1, 1.34, animalDistance)
  const childRailDistance = distanceToHorizontalSegment(
    localX,
    localY,
    -22.5,
    -6.5,
  )
  const childMask = smootherstep(1.45, 3.6, childRailDistance)
  return Math.min(animalMask, childMask)
}

function microRelief(localX: number, localY: number): number {
  const fine =
    Math.sin(localX * 0.93 + localY * 0.31 + 0.7) * 0.031 +
    Math.sin(localX * -0.43 + localY * 0.79 - 1.2) * 0.022 +
    Math.cos(localX * 0.19 - localY * 0.57 + 2.1) * 0.016
  const cellX = Math.floor((localX + 512) / 5.5)
  const cellY = Math.floor((localY + 512) / 5.5)
  const mottling = (hash01(cellX, cellY, 73) - 0.5) * 0.018
  return Math.max(
    -SCALE_ENCOUNTER_PRODUCTION_MICRO_RELIEF_MAXIMUM_METERS,
    Math.min(
      SCALE_ENCOUNTER_PRODUCTION_MICRO_RELIEF_MAXIMUM_METERS,
      fine + mottling,
    ),
  )
}

/**
 * Broad, deterministic terrain in ground-local coordinates. It deliberately
 * avoids a radial lift term: every source is an offset landform or a rotated
 * low-frequency field, so the panorama transition cannot become a circular
 * berm. The quintic clearing mask has zero slope at both ends.
 */
export function scaleEncounterProductionTerrainHeight(
  localX: number,
  localY: number,
): number {
  const radius = Math.hypot(localX, localY)
  const reliefStrength = smootherstep(
    14,
    SCALE_ENCOUNTER_PRODUCTION_RELIEF_FULL_STRENGTH_RADIUS_METERS,
    radius,
  )
  const broadRelief =
    Math.sin(localX * 0.047 + localY * 0.019 + 0.72) * 0.24 +
    Math.sin(localX * -0.021 + localY * 0.039 - 1.14) * 0.21 +
    Math.cos(localX * 0.011 - localY * 0.026 + 0.31) * 0.16

  // Offset, overlapping ellipses create a forest basin and broken ridges.
  // None is centred on the subject, so their contours do not trace the mesh.
  const landforms =
    Math.exp(-(((localX + 46) / 55) ** 2 + ((localY - 96) / 34) ** 2)) * 3.7 +
    Math.exp(-(((localX - 68) / 71) ** 2 + ((localY - 127) / 42) ** 2)) * 5.2 +
    Math.exp(-(((localX + 132) / 88) ** 2 + ((localY + 7) / 61) ** 2)) * 4.1 +
    Math.exp(-(((localX - 148) / 97) ** 2 + ((localY + 58) / 73) ** 2)) * 4.8 +
    Math.exp(-(((localX + 22) / 122) ** 2 + ((localY + 176) / 56) ** 2)) * 5.6

  const supportReliefMask = subjectFloorReliefMask(localX, localY)
  const localMicroRelief =
    microRelief(localX, localY) * supportReliefMask
  // The mesh transform is cancelled at the clearing so the shared subject
  // support plane remains world Y=0. Broad relief still grows naturally
  // outside the authored child/animal corridors.
  return (
    TERRAIN_BASE_HEIGHT_METERS +
    localMicroRelief +
    reliefStrength * (broadRelief + landforms) * supportReliefMask
  )
}

export function scaleEncounterProductionTerrainHeightAtWorld(
  worldX: number,
  worldZ: number,
): number {
  return (
    scaleEncounterProductionTerrainHeight(worldX, -worldZ) +
    SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS
  )
}

function createTerrainRadii(): number[] {
  const radii: number[] = [...INNER_RADII]
  const start = INNER_RADII[INNER_RADII.length - 1]!
  const span = SCALE_ENCOUNTER_PRODUCTION_TERRAIN_RADIUS_METERS - start
  for (let index = 1; index <= OUTER_RADIAL_STEPS; index += 1) {
    const t = index / OUTER_RADIAL_STEPS
    // Quadratic spacing preserves middle-distance silhouette density while
    // allowing the unseen outer floor to remain inexpensive.
    radii.push(start + span * (0.55 * t + 0.45 * t * t))
  }
  return radii
}

function terrainGroundColour(sample: TerrainSample, target: Color): Color {
  // Vertex colours multiply the physically authored albedo. Values near the
  // old mid-grey palette crushed the already-dark humus scan into a black
  // carpet. These near-white ecological tints preserve scan dynamic range;
  // the shader's material-domain weights now provide the actual wet/dry/moss
  // separation.
  const damp = new Color('#eeede8')
  const dry = new Color('#f2efe8')
  const far = new Color('#dfe5dc')
  const macro =
    hash01(
      Math.floor((sample.localX + 420) / 38),
      Math.floor((sample.localY + 420) / 38),
      19,
    ) * 0.42 +
    hash01(
      Math.floor((sample.localX + 460) / 73),
      Math.floor((sample.localY + 460) / 73),
      41,
    ) * 0.33
  return target
    .copy(damp)
    // Domain colour belongs to the material shader. Vertex colour only breaks
    // perfect uniformity and cools the far field; keeping this range narrow
    // prevents another screen-scale orange/green band from appearing.
    .lerp(dry, 0.08 + macro * 0.22)
    .lerp(far, smoothstep(92, 260, sample.radius) * 0.58)
}

/**
 * A staggered radial mesh, not a set of aligned concentric rings. Each outer
 * ring has a deterministic angular phase and radius jitter. The topology keeps
 * one draw call and stable world-scale UVs without long collinear ring edges.
 */
export function createScaleEncounterProductionTerrainGeometry(): BufferGeometry {
  const radii = createTerrainRadii()
  const centreHeight = scaleEncounterProductionTerrainHeight(0, 0)
  const positions: number[] = [0, 0, centreHeight]
  const colours: number[] = []
  const uvs: number[] = [0.5, 0.5]
  const indices: number[] = []
  const ringStarts: number[] = []
  const ringSegments: number[] = []
  const colour = new Color()
  terrainGroundColour(
    { height: centreHeight, localX: 0, localY: 0, radius: 0 },
    colour,
  ).toArray(colours, 0)

  for (let ringIndex = 1; ringIndex < radii.length; ringIndex += 1) {
    const baseRadius = radii[ringIndex]!
    const segmentCount = scaleEncounterProductionTerrainAngularSegmentsForRadius(
      baseRadius,
    )
    ringStarts.push(positions.length / 3)
    ringSegments.push(segmentCount)
    const ringPhase = hash01(ringIndex, 17, 5) * (TAU / segmentCount)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angularJitter =
        (hash01(ringIndex, segment, 11) - 0.5) * ANGLE_JITTER_RADIANS
      const angle =
        (segment / segmentCount) * TAU + ringPhase + angularJitter
      const clearingLocked = baseRadius <= 25
      const radialJitter = clearingLocked
        ? 0
        : (hash01(ringIndex, segment, 29) - 0.5) *
          Math.min(baseRadius * RADIUS_JITTER_RATIO, 4.8)
      const radius = Math.max(
        SCALE_ENCOUNTER_PRODUCTION_CLEARING_RADIUS_METERS,
        Math.min(SCALE_ENCOUNTER_PRODUCTION_TERRAIN_RADIUS_METERS, baseRadius + radialJitter),
      )
      const localX = Math.cos(angle) * radius
      const localY = Math.sin(angle) * radius
      const height = scaleEncounterProductionTerrainHeight(localX, localY)
      const sample = { height, localX, localY, radius }
      positions.push(localX, localY, height)
      terrainGroundColour(sample, colour).toArray(colours, colours.length)
      uvs.push(
        localX / (SCALE_ENCOUNTER_PRODUCTION_TERRAIN_RADIUS_METERS * 2) + 0.5,
        localY / (SCALE_ENCOUNTER_PRODUCTION_TERRAIN_RADIUS_METERS * 2) + 0.5,
      )
    }
  }

  const firstRingStart = ringStarts[0]!
  const firstRingSegments = ringSegments[0]!
  for (let segment = 0; segment < firstRingSegments; segment += 1) {
    indices.push(
      0,
      firstRingStart + segment,
      firstRingStart + ((segment + 1) % firstRingSegments),
    )
  }
  for (let ring = 1; ring < ringStarts.length; ring += 1) {
    const innerStart = ringStarts[ring - 1]!
    const outerStart = ringStarts[ring]!
    const innerCount = ringSegments[ring - 1]!
    const outerCount = ringSegments[ring]!
    let inner = 0
    let outer = 0
    while (inner < innerCount || outer < outerCount) {
      const nextInnerFraction = (inner + 1) / innerCount
      const nextOuterFraction = (outer + 1) / outerCount
      if (
        inner < innerCount &&
        (outer >= outerCount || nextInnerFraction <= nextOuterFraction)
      ) {
        indices.push(
          innerStart + (inner % innerCount),
          outerStart + (outer % outerCount),
          innerStart + ((inner + 1) % innerCount),
        )
        inner += 1
      } else {
        indices.push(
          innerStart + (inner % innerCount),
          outerStart + (outer % outerCount),
          outerStart + ((outer + 1) % outerCount),
        )
        outer += 1
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.name = 'scale-encounter-production-terrain-geometry'
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
  return geometry
}

export function createScaleEncounterProductionMiddleDistance(): Group {
  const group = new Group()
  group.name = 'scale-encounter-production-middle-distance'
  // Intentionally empty. The former three vertical ribbon meshes used solid
  // green vertex colours and stood above the textured terrain. From the
  // overview camera they formed a lawn-like horizontal belt and doubled the
  // floor silhouette. The production terrain already reaches 360 m, has an
  // irregular outer boundary, and supplies its own low-frequency landforms;
  // letting that single opaque, textured surface meet the panorama is both
  // more natural and three draw calls cheaper.
  group.userData.scaleEncounterUsesSingleOpaqueTerrain = true
  return group
}

export function createScaleEncounterProductionTerrain(): ScaleEncounterProductionTerrain {
  return {
    groundGeometry: createScaleEncounterProductionTerrainGeometry(),
    middleDistance: createScaleEncounterProductionMiddleDistance(),
  }
}

export function scaleEncounterProductionTerrainMaterials(
  terrain: ScaleEncounterProductionTerrain,
): ReadonlyArray<Material> {
  const materials: Material[] = []
  terrain.middleDistance.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>
    if (Array.isArray(mesh.material)) materials.push(...mesh.material)
    else materials.push(mesh.material)
  })
  return materials
}
