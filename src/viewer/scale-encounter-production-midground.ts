import {
  BatchedMesh,
  type Box3,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  scaleEncounterEcologyCount,
  scaleEncounterEcologyDensityMultiplier,
  type ScaleEncounterEcologyDensity,
} from './scale-encounter-ecology-density'

/**
 * Production-only geometric depth between the forest-floor props and the
 * equirectangular far plate. The population is deliberately built from
 * irregular habitat patches instead of a ring, ridge ribbon, or camera-facing
 * cards: every anchor remains a real world-space volume from a full 360° orbit.
 */

export type ScaleEncounterProductionMidgroundKind =
  | 'araucarian-conifer'
  | 'cycad'
  | 'tree-fern'

export interface ScaleEncounterProductionMidgroundAnchor {
  readonly height: number
  readonly kind: ScaleEncounterProductionMidgroundKind
  readonly radius: number
  readonly tiltX: number
  readonly tiltZ: number
  readonly widthScale: number
  readonly x: number
  readonly yaw: number
  readonly z: number
}

export interface ScaleEncounterProductionMidgroundCounts {
  readonly 'araucarian-conifer': number
  readonly cycad: number
  readonly 'tree-fern': number
}

export interface ScaleEncounterProductionMidgroundOverviewClearance {
  readonly centreX: number
  readonly centreZ: number
  /** Horizontal direction from the subjects toward the overview camera. */
  readonly directionX: number
  readonly directionZ: number
  readonly subjectHalfDepth: number
  readonly subjectHalfWidth: number
}

export interface ScaleEncounterProductionMidgroundMetadata {
  readonly counts: ScaleEncounterProductionMidgroundCounts
  readonly density: ScaleEncounterEcologyDensity
  readonly drawCalls: number
  readonly estimatedTriangles: number
  readonly filteredForOverviewCount: number
  readonly layout: 'irregular-habitat-patches'
  readonly lodCounts: {
    readonly far: number
    readonly near: number
  }
  readonly maximumRadiusMeters: number
  readonly minimumRadiusMeters: number
  readonly seed: number
  readonly representation:
    | 'instanced-volumetric-branch-and-frond-components'
    | 'instanced-scanned-tree-lods-and-grounded-frond-crowns'
    | 'instanced-alpha-clipped-multi-profile-world-space-proxies'
    | 'hybrid-scanned-saplings-supported-tree-ferns-and-atlas-tree-proxies'
    | 'hybrid-scanned-saplings-volumetric-araucarias-and-supported-tree-ferns'
  readonly treeAssetMode:
    | 'procedural-fallback'
    | 'reviewed-cc0-scan-lods'
    | 'authored-atlas-profiles'
  readonly totalInstances: number
  readonly unfilteredInstances: number
}

type TerrainHeightAtWorld = (worldX: number, worldZ: number) => number

interface HabitatPatch {
  readonly radiusX: number
  readonly radiusZ: number
  readonly weight: number
  readonly x: number
  readonly z: number
}

interface SpeciesRecipe {
  readonly count: number
  readonly heightMaximum: number
  readonly heightMinimum: number
  readonly kind: ScaleEncounterProductionMidgroundKind
  readonly maximumRadius: number
  readonly minimumRadius: number
  readonly minimumSeparation: number
  readonly patches: ReadonlyArray<HabitatPatch>
  readonly seed: number
}

interface PrototypeGeometry {
  readonly geometry: BufferGeometry
  readonly height: number
}

interface ScannedPrototypeGeometry extends PrototypeGeometry {
  readonly material: Material | Material[]
  readonly sourceName: string
}

interface CompositeFrondBatchResult {
  readonly meshes: ReadonlyArray<InstancedMesh>
  readonly scannedInstances: number
  readonly triangles: number
}

type MidgroundLod = 'far' | 'near'

const TAU = Math.PI * 2
const WORLD_UP = new Vector3(0, 1, 0)
// The old emergency fallback placed fern component crowns above procedural
// cylinders. In oblique overview shots the trunks disappeared against the
// terrain and the crowns were correctly perceived as ferns floating in air.
// A missing reviewed GLB now falls through to complete, bottom-grounded atlas
// silhouettes instead of ever rebuilding that invalid representation.
function reviewCandidateUrl(bundledUrl: URL): string {
  return bundledUrl.href
}

const vegetationAtlasUrl = reviewCandidateUrl(
  new URL(
    '../scale-encounter/assets/environments/midground-vegetation-atlas-v2.webp',
    import.meta.url,
  ),
)

const frondComponentAtlasUrl = reviewCandidateUrl(
  new URL(
    '../scale-encounter/assets/environments/midground-frond-components-v4-final.webp',
    import.meta.url,
  ),
)

const araucariaComponentAtlasUrl = reviewCandidateUrl(
  new URL(
    '../scale-encounter/assets/environments/midground-araucaria-components-v4.webp',
    import.meta.url,
  ),
)

const matureTreeAtlasUrls = {
  high: reviewCandidateUrl(
    new URL(
      '../scale-encounter/assets/environments/midground-mature-tree-atlas-v1.webp',
      import.meta.url,
    ),
  ),
  low: reviewCandidateUrl(
    new URL(
      '../scale-encounter/assets/environments/midground-mature-tree-atlas-v1-1024.webp',
      import.meta.url,
    ),
  ),
} as const

function matureTreeAtlasUrlForViewport(): string {
  if (typeof window === 'undefined') return matureTreeAtlasUrls.low
  const physicalWidth = window.innerWidth * Math.max(window.devicePixelRatio, 1)
  return physicalWidth >= 1_280
    ? matureTreeAtlasUrls.high
    : matureTreeAtlasUrls.low
}

export const SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_SEED = 0x6d5a_17c3
export const SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MINIMUM_RADIUS_METERS = 8
export const SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_MAXIMUM_RADIUS_METERS = 190

const WOODLAND_PATCHES = [
  { x: -27, z: -24, radiusX: 12, radiusZ: 9, weight: 0.56 },
  { x: 31, z: -27, radiusX: 13, radiusZ: 10, weight: 0.68 },
  { x: -34, z: 19, radiusX: 14, radiusZ: 10, weight: 0.52 },
  { x: 36, z: 26, radiusX: 15, radiusZ: 11, weight: 0.44 },
  { x: -34, z: -34, radiusX: 19, radiusZ: 15, weight: 0.78 },
  { x: 37, z: -39, radiusX: 18, radiusZ: 17, weight: 0.62 },
  { x: -45, z: 21, radiusX: 21, radiusZ: 16, weight: 0.64 },
  { x: 43, z: 34, radiusX: 23, radiusZ: 18, weight: 0.46 },
  { x: 2, z: 49, radiusX: 20, radiusZ: 16, weight: 0.38 },
  { x: -58, z: -63, radiusX: 31, radiusZ: 35, weight: 1.42 },
  { x: 64, z: -72, radiusX: 30, radiusZ: 34, weight: 1.02 },
  { x: 6, z: -112, radiusX: 24, radiusZ: 26, weight: 0.32 },
  { x: -132, z: -31, radiusX: 38, radiusZ: 28, weight: 1.18 },
  { x: 139, z: 21, radiusX: 31, radiusZ: 43, weight: 0.7 },
  { x: -82, z: 112, radiusX: 34, radiusZ: 46, weight: 1.02 },
  { x: 42, z: 151, radiusX: 58, radiusZ: 26, weight: 0.66 },
  { x: 121, z: 94, radiusX: 47, radiusZ: 31, weight: 1.14 },
  { x: -157, z: 34, radiusX: 25, radiusZ: 52, weight: 0.76 },
] as const satisfies ReadonlyArray<HabitatPatch>

const HUMID_UNDERSTOREY_PATCHES = [
  { x: -14, z: -18, radiusX: 9, radiusZ: 6, weight: 1.46 },
  { x: 16, z: 13, radiusX: 9, radiusZ: 7, weight: 1.08 },
  { x: -25, z: 12, radiusX: 10, radiusZ: 7, weight: 0.92 },
  { x: 24, z: -12, radiusX: 10, radiusZ: 7, weight: 1.18 },
  { x: -42, z: -49, radiusX: 22, radiusZ: 17, weight: 1.25 },
  { x: 53, z: -57, radiusX: 25, radiusZ: 18, weight: 0.82 },
  { x: -72, z: 25, radiusX: 29, radiusZ: 18, weight: 1.08 },
  { x: 68, z: 52, radiusX: 31, radiusZ: 20, weight: 0.62 },
  { x: -17, z: 72, radiusX: 25, radiusZ: 24, weight: 0.9 },
  { x: 27, z: -78, radiusX: 22, radiusZ: 27, weight: 0.72 },
] as const satisfies ReadonlyArray<HabitatPatch>

const DRIER_MARGIN_PATCHES = [
  { x: -8, z: -13, radiusX: 7, radiusZ: 5, weight: 1.35 },
  { x: 14, z: 11, radiusX: 7, radiusZ: 6, weight: 0.94 },
  { x: -23, z: 15, radiusX: 9, radiusZ: 6, weight: 1.12 },
  { x: 22, z: -16, radiusX: 9, radiusZ: 6, weight: 1.28 },
  { x: -31, z: -43, radiusX: 20, radiusZ: 14, weight: 1.08 },
  { x: 41, z: -50, radiusX: 21, radiusZ: 16, weight: 0.74 },
  { x: -58, z: 29, radiusX: 26, radiusZ: 15, weight: 1.18 },
  { x: 55, z: 43, radiusX: 27, radiusZ: 16, weight: 0.54 },
  { x: -8, z: 61, radiusX: 23, radiusZ: 19, weight: 0.82 },
  { x: 13, z: -66, radiusX: 27, radiusZ: 14, weight: 0.96 },
] as const satisfies ReadonlyArray<HabitatPatch>

const SPECIES_RECIPES = [
  {
    count: 46,
    // These are genuine CC0 saplings kept close to their believable scale.
    // Stretching a one-metre nursery tree into a 17 m mature araucarian made
    // every crown read as the same broccoli-shaped proxy. Mature canopy scale
    // now belongs to the photographic far plate; this layer supplies parallax.
    heightMaximum: 11.2,
    heightMinimum: 3.6,
    kind: 'araucarian-conifer',
    maximumRadius: 118,
    minimumRadius: 20,
    minimumSeparation: 7.8,
    patches: WOODLAND_PATCHES,
    seed: SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_SEED + 11,
  },
  {
    count: 58,
    // Damp colonies contain both ground ferns and true supported tree-ferns.
    // They are two separate complete representations: a ground silhouette is
    // never translated upward to impersonate a crown.
    heightMaximum: 5.2,
    heightMinimum: 1.75,
    kind: 'tree-fern',
    maximumRadius: 62,
    minimumRadius: 10,
    minimumSeparation: 2.75,
    patches: HUMID_UNDERSTOREY_PATCHES,
    seed: SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_SEED + 37,
  },
  {
    count: 76,
    heightMaximum: 2.25,
    heightMinimum: 0.58,
    kind: 'cycad',
    maximumRadius: 58,
    minimumRadius: 9,
    minimumSeparation: 2.1,
    patches: DRIER_MARGIN_PATCHES,
    seed: SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_SEED + 71,
  },
] as const satisfies ReadonlyArray<SpeciesRecipe>

// Authored near/middle anchors establish recognisable woodland shoulders in
// every aspect ratio before the seeded habitat scatter fills each colony.
// Their radii deliberately vary by more than 60 m, leaving broad gaps between
// clusters instead of recreating the old evenly spaced tree ring.
const AUTHORED_CONIFER_ANCHORS = [
  { height: 5.8, kind: 'araucarian-conifer', radius: 32.8, tiltX: 0.012, tiltZ: -0.018, widthScale: 0.93, x: -26, yaw: 0.44, z: -20 },
  { height: 10.4, kind: 'araucarian-conifer', radius: 67.5, tiltX: -0.015, tiltZ: 0.01, widthScale: 1.06, x: -52, yaw: 2.18, z: -43 },
  { height: 6.4, kind: 'araucarian-conifer', radius: 38.4, tiltX: 0.018, tiltZ: 0.014, widthScale: 0.88, x: 30, yaw: 4.72, z: -24 },
  { height: 10.9, kind: 'araucarian-conifer', radius: 76.5, tiltX: -0.012, tiltZ: -0.017, widthScale: 1.08, x: 57, yaw: 1.28, z: -51 },
  // Two deliberately offset background anchors hold the narrow/mobile
  // overview together. They sit well behind the subject corridor at different
  // radii, so they frame rather than form a symmetric gate or tree wall.
  { height: 7.2, kind: 'araucarian-conifer', radius: 31.6, tiltX: -0.009, tiltZ: 0.014, widthScale: 0.91, x: -10, yaw: 5.12, z: -30 },
  { height: 6.6, kind: 'araucarian-conifer', radius: 36.1, tiltX: 0.013, tiltZ: -0.011, widthScale: 0.87, x: 12, yaw: 2.37, z: -34 },
  { height: 6.9, kind: 'araucarian-conifer', radius: 45, tiltX: 0.01, tiltZ: 0.016, widthScale: 0.91, x: -36, yaw: 5.34, z: 27 },
  { height: 8.1, kind: 'araucarian-conifer', radius: 53.4, tiltX: -0.017, tiltZ: 0.012, widthScale: 1.02, x: 42, yaw: 3.54, z: 33 },
  { height: 8.1, kind: 'araucarian-conifer', radius: 66.5, tiltX: 0.014, tiltZ: -0.01, widthScale: 0.96, x: -64, yaw: 1.82, z: 18 },
  { height: 6.7, kind: 'araucarian-conifer', radius: 70.5, tiltX: -0.011, tiltZ: 0.018, widthScale: 0.86, x: 67, yaw: 0.76, z: 22 },
  { height: 9.1, kind: 'araucarian-conifer', radius: 66.5, tiltX: 0.019, tiltZ: 0.008, widthScale: 1.03, x: -24, yaw: 4.06, z: -62 },
  { height: 7.5, kind: 'araucarian-conifer', radius: 76.7, tiltX: -0.014, tiltZ: -0.012, widthScale: 0.9, x: 20, yaw: 2.64, z: -74 },
  { height: 10.6, kind: 'araucarian-conifer', radius: 108.9, tiltX: 0.01, tiltZ: -0.015, widthScale: 1.04, x: -76, yaw: 5.82, z: 78 },
  { height: 8.8, kind: 'araucarian-conifer', radius: 108.1, tiltX: -0.016, tiltZ: 0.011, widthScale: 0.94, x: 84, yaw: 3.08, z: 68 },
] as const satisfies ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>

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

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function pointToHorizontalSegmentDistance(
  x: number,
  z: number,
  segmentMinimumX: number,
  segmentMaximumX: number,
): number {
  const closestX = Math.max(segmentMinimumX, Math.min(segmentMaximumX, x))
  return Math.hypot(x - closestX, z)
}

/**
 * This is wider than the visible footprints because the child can travel the
 * entire observation rail. The 45 m population floor normally makes the test
 * redundant, but retaining the explicit exclusion keeps future patch edits
 * from silently putting a trunk through either participant.
 */
export function isOutsideScaleEncounterProductionMidgroundCorridor(
  x: number,
  z: number,
): boolean {
  const outsideAnimal = ((x - 2.2) / 12) ** 2 + (z / 7.2) ** 2 >= 1
  const outsideChildRail =
    pointToHorizontalSegmentDistance(x, z, -24, -6) >= 6
  return outsideAnimal && outsideChildRail
}

function isFarEnough(
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  x: number,
  z: number,
  minimumSeparation: number,
): boolean {
  const minimumSquared = minimumSeparation * minimumSeparation
  return anchors.every((anchor) => {
    const dx = anchor.x - x
    const dz = anchor.z - z
    return dx * dx + dz * dz >= minimumSquared
  })
}

function selectHabitatPatch(
  patches: ReadonlyArray<HabitatPatch>,
  random: () => number,
): HabitatPatch {
  const totalWeight = patches.reduce((sum, patch) => sum + patch.weight, 0)
  let value = random() * totalWeight
  for (const patch of patches) {
    value -= patch.weight
    if (value <= 0) return patch
  }
  return patches.at(-1)!
}

function heightForRadius(
  recipe: SpeciesRecipe,
  radius: number,
  random: () => number,
): number {
  const distanceProgress = Math.max(
    0,
    Math.min(
      1,
      (radius - recipe.minimumRadius) /
        (recipe.maximumRadius - recipe.minimumRadius),
    ),
  )
  if (recipe.kind === 'tree-fern') {
    const becomesTreeFern = radius >= 24 && random() > 0.52
    if (!becomesTreeFern) return 0.45 + random() ** 0.8 * 0.9
    const treeFernProgress = Math.max(0, Math.min(1, (radius - 24) / 38))
    return Math.min(
      recipe.heightMaximum,
      1.85 + treeFernProgress * 0.75 + random() ** 1.35 * 2.6,
    )
  }
  if (recipe.kind === 'cycad') {
    // Child-eye review cameras travel inside the clearing. Keep the first
    // habitat shoulder knee-high, then allow taller cycads only as radial
    // depth increases; this preserves foreground ecology without a single
    // near frond filling the frame or hiding the animal silhouette.
    const cycadProgress = Math.max(0, Math.min(1, (radius - 9) / 49))
    const localMaximum = 0.86 + cycadProgress * 1.39
    return recipe.heightMinimum + random() * (localMaximum - recipe.heightMinimum)
  }
  const maximum =
    recipe.kind === 'araucarian-conifer'
      ? Math.min(recipe.heightMaximum, 5.8 + distanceProgress * 9.2)
      : recipe.heightMaximum
  return recipe.heightMinimum + random() * (maximum - recipe.heightMinimum)
}

function scatterSpecies(
  recipe: SpeciesRecipe,
  initialAnchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor> = [],
): ScaleEncounterProductionMidgroundAnchor[] {
  const random = createSeededRandom(recipe.seed)
  const anchors: ScaleEncounterProductionMidgroundAnchor[] = [
    ...initialAnchors,
  ]

  for (let index = anchors.length; index < recipe.count; index += 1) {
    let accepted: { readonly x: number; readonly z: number } | undefined
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      // Unequal habitat weights preserve broad openings between colonies.
      // A compulsory per-compass cycle created the former same-radius fence.
      const patch = selectHabitatPatch(recipe.patches, random)
      const angle = random() * TAU
      const patchRadius = random() ** 0.72
      const x =
        patch.x +
        Math.cos(angle) * patch.radiusX * patchRadius +
        (random() - 0.5) * 2.4
      const z =
        patch.z +
        Math.sin(angle) * patch.radiusZ * patchRadius +
        (random() - 0.5) * 2.4
      const radius = Math.hypot(x, z)
      const angularBin = Math.floor(
        ((((Math.atan2(z, x) + TAU) % TAU) / TAU) * 12),
      )
      const angularPopulation =
        recipe.kind === 'araucarian-conifer'
          ? anchors.filter((anchor) => {
              const anchorBin = Math.floor(
                ((((Math.atan2(anchor.z, anchor.x) + TAU) % TAU) / TAU) * 12),
              )
              return anchorBin === angularBin
            }).length
          : 0
      const angularPopulationLimit = Math.ceil(recipe.count / 12) + 3
      if (
        radius < recipe.minimumRadius ||
        radius > recipe.maximumRadius ||
        (recipe.kind === 'araucarian-conifer' &&
          angularPopulation >= angularPopulationLimit) ||
        !isOutsideScaleEncounterProductionMidgroundCorridor(x, z) ||
        !isFarEnough(anchors, x, z, recipe.minimumSeparation)
      ) {
        continue
      }
      accepted = { x, z }
      break
    }

    if (!accepted) {
      throw new Error(
        `Unable to place ${recipe.kind} ${index + 1}/${recipe.count}`,
      )
    }

    const radius = Math.hypot(accepted.x, accepted.z)
    const tiltRange =
      recipe.kind === 'araucarian-conifer'
        ? 0.05
        : recipe.kind === 'tree-fern'
          ? 0.065
          : 0.08
    anchors.push({
      height: round(heightForRadius(recipe, radius, random)),
      kind: recipe.kind,
      radius: round(radius),
      tiltX: round((random() - 0.5) * tiltRange),
      tiltZ: round((random() - 0.5) * tiltRange),
      widthScale: round(0.84 + random() * 0.3),
      x: round(accepted.x),
      yaw: round(random() * TAU),
      z: round(accepted.z),
    })
  }

  return anchors
}

export function createScaleEncounterProductionMidgroundPlan(
  density: ScaleEncounterEcologyDensity = 'current',
): ReadonlyArray<ScaleEncounterProductionMidgroundAnchor> {
  const multiplier = scaleEncounterEcologyDensityMultiplier(density)
  return SPECIES_RECIPES.flatMap((recipe) => {
    const currentAnchors = scatterSpecies(
      recipe,
      recipe.kind === 'araucarian-conifer'
        ? AUTHORED_CONIFER_ANCHORS
        : [],
    )
    if (density === 'current') return currentAnchors
    return scatterSpecies({
      ...recipe,
      count: scaleEncounterEcologyCount(recipe.count, density),
      // Keep individual trunks from intersecting while allowing the same
      // irregular habitat colonies to carry the denser experiments.
      minimumSeparation:
        recipe.minimumSeparation / Math.sqrt(multiplier),
      seed:
        recipe.seed ^ (density === '1.25x' ? 0x2512_5a11 : 0x5015_0a77),
    }, currentAnchors)
  })
}

export function createScaleEncounterProductionMidgroundOverviewClearance(
  subjectBounds: Readonly<Box3>,
  overviewDirection: Readonly<Vector3>,
): ScaleEncounterProductionMidgroundOverviewClearance | null {
  if (subjectBounds.isEmpty()) return null
  const direction = new Vector2(
    overviewDirection.x,
    overviewDirection.z,
  )
  if (direction.lengthSq() <= 1e-8) return null
  direction.normalize()
  const right = new Vector2(direction.y, -direction.x)
  const centre = subjectBounds.getCenter(new Vector3())
  const size = subjectBounds.getSize(new Vector3())
  return {
    centreX: centre.x,
    centreZ: centre.z,
    directionX: direction.x,
    directionZ: direction.y,
    subjectHalfDepth:
      (Math.abs(direction.x) * size.x + Math.abs(direction.y) * size.z) *
      0.5,
    subjectHalfWidth:
      (Math.abs(right.x) * size.x + Math.abs(right.y) * size.z) * 0.5,
  }
}

function scaleEncounterProductionMidgroundCrownRadius(
  anchor: ScaleEncounterProductionMidgroundAnchor,
): number {
  const widthRatio =
    anchor.kind === 'araucarian-conifer'
      ? anchor.radius >= 68
        ? 0.34
        : 0.28
      : anchor.kind === 'tree-fern'
        ? 0.52
        : 0.46
  return Math.max(0.35, anchor.height * anchor.widthScale * widthRatio)
}

/**
 * Keeps the portrait overview sightline open around the actual child and
 * animal bounds. Trees behind the subjects and trees framing either side stay
 * in place; only tall vegetation capable of covering the comparison is cut.
 */
export function isScaleEncounterProductionMidgroundAnchorClearOfOverview(
  anchor: ScaleEncounterProductionMidgroundAnchor,
  clearance: ScaleEncounterProductionMidgroundOverviewClearance,
): boolean {
  const relativeX = anchor.x - clearance.centreX
  const relativeZ = anchor.z - clearance.centreZ
  const depth =
    relativeX * clearance.directionX +
    relativeZ * clearance.directionZ
  const lateral = Math.abs(
    relativeX * clearance.directionZ -
      relativeZ * clearance.directionX,
  )
  const crownRadius = scaleEncounterProductionMidgroundCrownRadius(anchor)
  const canCoverSubject = anchor.height >= 1.6 || crownRadius >= 0.72
  const reachesSubjectDepth =
    depth >= -clearance.subjectHalfDepth - crownRadius
  const perspectivePadding = 2.4 + Math.max(0, depth) * 0.035
  const overlapsSubjectWidth =
    lateral <=
    clearance.subjectHalfWidth + crownRadius + perspectivePadding
  return !(canCoverSubject && reachesSubjectDepth && overlapsSubjectWidth)
}

function mergePrototypeParts(parts: BufferGeometry[]): BufferGeometry {
  const normalizedParts = parts.map((part) => {
    return part.index ? part.toNonIndexed() : part
  })
  const merged = mergeGeometries(normalizedParts, false)
  normalizedParts.forEach((part) => part.dispose())
  parts.forEach((part) => {
    if (!normalizedParts.includes(part)) part.dispose()
  })
  if (!merged) throw new Error('Unable to merge production midground geometry')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function applyVertexColour(
  geometry: BufferGeometry,
  colour: Color,
): BufferGeometry {
  const positions = geometry.getAttribute('position')
  const colours = new Float32Array(positions.count * 3)
  for (let index = 0; index < positions.count; index += 1) {
    colour.toArray(colours, index * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  return geometry
}

function applyFixedUv(
  geometry: BufferGeometry,
  u: number,
  v: number,
): BufferGeometry {
  const positions = geometry.getAttribute('position')
  const values = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index += 1) {
    values[index * 2] = u
    values[index * 2 + 1] = v
  }
  geometry.setAttribute('uv', new BufferAttribute(values, 2))
  return geometry
}

function borrowMaterialTextures(
  material: Material | Material[],
  borrowedTextures?: Set<Texture>,
): void {
  if (!borrowedTextures) return
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    for (const value of Object.values(entry)) {
      if (value instanceof Texture) {
        // Three's runtime instanceof narrows through Texture's legacy `any`
        // defaults, while the environment lease intentionally stores the
        // stricter Texture type. It is the same runtime class in both cases.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        borrowedTextures.add(value)
      }
    }
  }
}

function cloneScannedPrototype(
  templateRoot: Group,
  sourceName: string,
  borrowedTextures?: Set<Texture>,
  normalization: 'footprint' | 'height' = 'height',
): ScannedPrototypeGeometry | null {
  const object = templateRoot.getObjectByName(sourceName)
  if (!(object instanceof Mesh)) return null
  const templateMesh = object as Mesh<BufferGeometry, Material | Material[]>

  templateRoot.updateMatrixWorld(true)
  object.updateMatrixWorld(true)
  const relativeMatrix = new Matrix4()
    .copy(templateRoot.matrixWorld)
    .invert()
    .multiply(templateMesh.matrixWorld)
  const geometry = templateMesh.geometry.clone()
  geometry.applyMatrix4(relativeMatrix)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox?.clone()
  if (!bounds) {
    geometry.dispose()
    return null
  }
  const height = Math.max(0.001, bounds.max.y - bounds.min.y)
  const footprint = Math.max(
    0.001,
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z,
  )
  const centreX = (bounds.min.x + bounds.max.x) * 0.5
  const centreZ = (bounds.min.z + bounds.max.z) * 0.5
  geometry.translate(-centreX, -bounds.min.y, -centreZ)
  const normalizationSize = normalization === 'height' ? height : footprint
  geometry.scale(
    1 / normalizationSize,
    1 / normalizationSize,
    1 / normalizationSize,
  )
  geometry.computeBoundingBox()
  const normalizedBounds = geometry.boundingBox
  if (
    normalization === 'height' &&
    sourceName.startsWith('fern_02_') &&
    normalizedBounds
  ) {
    const normalizedWidth = Math.max(
      normalizedBounds.max.x - normalizedBounds.min.x,
      normalizedBounds.max.z - normalizedBounds.min.z,
    )
    const horizontalCorrection = Math.min(1, 1.24 / normalizedWidth)
    geometry.scale(horizontalCorrection, 1, horizontalCorrection)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = `scale-encounter-normalized-${sourceName}`

  const material = Array.isArray(templateMesh.material)
    ? templateMesh.material.map((entry) => entry.clone())
    : templateMesh.material.clone()
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    entry.side = DoubleSide
    entry.alphaToCoverage = true
    if (entry instanceof MeshStandardMaterial) {
      entry.metalness = 0
      entry.roughness = Math.max(0.78, entry.roughness)
      entry.envMapIntensity = Math.min(0.82, entry.envMapIntensity)
    }
  }
  borrowMaterialTextures(material, borrowedTextures)
  const normalizedHeight = Math.max(
    0.001,
    (geometry.boundingBox?.max.y ?? 1) - (geometry.boundingBox?.min.y ?? 0),
  )
  return { geometry, height: normalizedHeight, material, sourceName }
}


function createTaperedBranch(
  origin: Vector3,
  direction: Vector3,
  length: number,
  baseRadius: number,
  tipRadius: number,
  colour: Color,
  fixedU: number,
  fixedV: number,
): BufferGeometry {
  const normalizedDirection = direction.clone().normalize()
  const branch = new CylinderGeometry(
    tipRadius,
    baseRadius,
    length,
    5,
    1,
    false,
  )
  branch.applyQuaternion(
    new Quaternion().setFromUnitVectors(WORLD_UP, normalizedDirection),
  )
  branch.translate(
    origin.x + normalizedDirection.x * length * 0.5,
    origin.y + normalizedDirection.y * length * 0.5,
    origin.z + normalizedDirection.z * length * 0.5,
  )
  applyFixedUv(branch, fixedU, fixedV)
  return applyVertexColour(branch, colour)
}

function addRootFlareParts(
  parts: BufferGeometry[],
  colour: Color,
  baseRadius: number,
  length: number,
  phase: number,
  count: number,
  fixedU: number,
  fixedV: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const yaw = phase + (index / count) * TAU
    const direction = new Vector3(
      Math.cos(yaw),
      -0.08 - (index % 2) * 0.025,
      Math.sin(yaw),
    ).normalize()
    parts.push(
      createTaperedBranch(
        new Vector3(0, baseRadius * 0.42, 0),
        direction,
        length * (0.84 + (index % 3) * 0.08),
        baseRadius * (0.52 + (index % 2) * 0.08),
        baseRadius * 0.13,
        colour,
        fixedU,
        fixedV,
      ),
    )
  }
}

function vegetationAtlasCellBounds(cell: number): {
  readonly u0: number
  readonly u1: number
  readonly v0: number
  readonly v1: number
} {
  const columns = 8
  const padding = 0.004
  return {
    u0: (cell + padding) / columns,
    u1: (cell + 1 - padding) / columns,
    v0: 0.004,
    v1: 0.996,
  }
}

function mapGeometryUvsToVegetationCell(
  geometry: BufferGeometry,
  cell: number,
  mirrorU = false,
): BufferGeometry {
  const bounds = vegetationAtlasCellBounds(cell)
  const uvs = geometry.getAttribute('uv')
  for (let index = 0; index < uvs.count; index += 1) {
    uvs.setXY(
      index,
      bounds.u0 +
        (bounds.u1 - bounds.u0) *
          (mirrorU ? 1 - uvs.getX(index) : uvs.getX(index)),
      bounds.v0 + (bounds.v1 - bounds.v0) * uvs.getY(index),
    )
  }
  uvs.needsUpdate = true
  return geometry
}

const MATURE_TREE_PROFILE_COUNT = 8

function matureTreeAtlasCellBounds(profile: number): {
  readonly u0: number
  readonly u1: number
  readonly v0: number
  readonly v1: number
} {
  const columns = 4
  const rows = 2
  const column = profile % columns
  const rowFromTop = Math.floor(profile / columns)
  const paddingU = 0.006
  const paddingV = 0.006
  return {
    u0: (column + paddingU) / columns,
    u1: (column + 1 - paddingU) / columns,
    v0: 1 - (rowFromTop + 1 - paddingV) / rows,
    v1: 1 - (rowFromTop + paddingV) / rows,
  }
}

function createMatureTreePrototype(profile: number): BufferGeometry {
  const parts: BufferGeometry[] = []
  const bounds = matureTreeAtlasCellBounds(profile)
  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    const secondary = planeIndex > 0
    const planeHeight = secondary ? 0.955 + planeIndex * 0.012 : 1
    const planeWidth = secondary ? 0.87 + planeIndex * 0.035 : 1
    const plane = new PlaneGeometry(planeWidth, planeHeight, 1, 1)
    const uvs = plane.getAttribute('uv')
    for (let index = 0; index < uvs.count; index += 1) {
      const sourceU = secondary ? 1 - uvs.getX(index) : uvs.getX(index)
      uvs.setXY(
        index,
        bounds.u0 + (bounds.u1 - bounds.u0) * sourceU,
        bounds.v0 + (bounds.v1 - bounds.v0) * uvs.getY(index),
      )
    }
    uvs.needsUpdate = true
    plane.rotateY(planeIndex * (Math.PI / 3))
    // The cutout itself is root-to-tip and bottom aligned by the deterministic
    // atlas preparation pass.  A geometry minimum of exactly zero therefore
    // represents the real root flare, not the bottom of an invisible crown
    // card or a guessed support trunk.
    plane.translate(0, planeHeight * 0.5, 0)
    parts.push(plane)
  }
  const geometry = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!geometry) throw new Error('Unable to merge mature tree profile')
  geometry.name = `scale-encounter-mature-tree-profile-${profile + 1}`
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createMatureTreeBatch(
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  atlas: Texture,
): {
  readonly mesh: BatchedMesh
  readonly triangles: number
} | null {
  if (anchors.length === 0) return null
  const material = new MeshBasicMaterial({
    // Preserve the fine needle and branch silhouette.  The previous 0.46
    // cutoff erased most secondary branches after mip selection, so a mature
    // tree collapsed into a pale wire outline in overview and portrait views.
    alphaTest: 0.32,
    alphaToCoverage: true,
    // The atlas was authored under a neutral studio key. A restrained olive
    // grade brings the baked cards into the same humid-forest middle values as
    // the panorama and prevents fine needles reading as yellow cutout edges.
    color: '#b8beaf',
    fog: true,
    map: atlas,
    side: DoubleSide,
    transparent: false,
  })
  material.name = 'scale-encounter-production-mature-tree-material'
  const prototypes = Array.from(
    { length: MATURE_TREE_PROFILE_COUNT },
    (_, profile) => createMatureTreePrototype(profile),
  )
  const maximumVertexCount = prototypes.reduce(
    (sum, geometry) => sum + geometry.getAttribute('position').count,
    0,
  )
  const maximumIndexCount = prototypes.reduce(
    (sum, geometry) => sum + (geometry.index?.count ?? 0),
    0,
  )
  const batched = new BatchedMesh(
    anchors.length,
    maximumVertexCount,
    maximumIndexCount,
    material,
  )
  batched.name = 'scale-encounter-production-mature-tree-colonies'
  batched.castShadow = false
  batched.receiveShadow = false
  batched.perObjectFrustumCulled = true
  batched.sortObjects = false
  const geometryIds = prototypes.map((geometry) => batched.addGeometry(geometry))
  const transform = new Object3D()
  const placements: Array<
    ScaleEncounterProductionMidgroundAnchor & {
      readonly burialDepth: number
      readonly groundingError: number
      readonly instanceId: number
      readonly profile: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []
  const projectionMetrics: Array<{
    readonly height: number
    readonly instanceId: number
    readonly worldCentre: Vector3
  }> = []
  let triangles = 0
  anchors.forEach((anchor, index) => {
    const profile =
      (Math.floor(anchor.yaw * 10_000) + index * 5) %
      MATURE_TREE_PROFILE_COUNT
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    const burialDepth = Math.min(0.085, anchor.height * 0.005)
    transform.position.set(anchor.x, terrainY - burialDepth, anchor.z)
    // Tall trunks remain upright. Tilting a square alpha card to a sampled
    // slope makes its invisible lower corner drive the placement and visually
    // lifts the actual root pixels on the uphill side.
    transform.rotation.set(0, anchor.yaw, 0)
    transform.scale.set(
      anchor.height * anchor.widthScale,
      anchor.height,
      anchor.height * anchor.widthScale,
    )
    transform.updateMatrix()
    const instanceId = batched.addInstance(geometryIds[profile]!)
    batched.setMatrixAt(instanceId, transform.matrix)
    const distanceFade = Math.max(0, Math.min(1, (anchor.radius - 34) / 112))
    const variation = ((index * 7 + profile * 3) % 9) * 0.011
    batched.setColorAt(
      instanceId,
      new Color().setRGB(
        0.82 - distanceFade * 0.12 + variation,
        0.87 - distanceFade * 0.11 + variation * 0.8,
        0.73 - distanceFade * 0.09 + variation * 0.45,
      ),
    )
    placements.push({
      ...anchor,
      burialDepth,
      groundingError: 0,
      instanceId,
      profile,
      terrainY,
      worldBottomY: round(terrainY - burialDepth),
    })
    projectionMetrics.push({
      height: anchor.height,
      instanceId,
      worldCentre: new Vector3(anchor.x, terrainY + anchor.height * 0.5, anchor.z),
    })
    triangles += geometryTriangleCount(prototypes[profile]!)
  })
  batched.computeBoundingBox()
  batched.computeBoundingSphere()
  batched.userData.scaleEncounterProductionMidgroundKind =
    'araucarian-conifer'
  batched.userData.scaleEncounterProductionMidgroundPlacements = placements
  batched.userData.scaleEncounterProductionMidgroundProjectedPixelGate = 7
  const rendererSize = new Vector2()
  const cameraWorldPosition = new Vector3()
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
      renderer.getSize(rendererSize)
      camera.getWorldPosition(cameraWorldPosition)
      const pixelsPerWorldUnitAtUnitDistance =
        rendererSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360))
      let visibleCount = 0
      projectionMetrics.forEach((metric) => {
        const distance = Math.max(
          0.01,
          cameraWorldPosition.distanceTo(metric.worldCentre),
        )
        const projectedHeight =
          (metric.height * pixelsPerWorldUnitAtUnitDistance) / distance
        const visible = projectedHeight >= 7
        batched.setVisibleAt(metric.instanceId, visible)
        if (visible) visibleCount += 1
      })
      batched.userData.scaleEncounterProductionMidgroundVisibleMatureTrees =
        visibleCount
    }
    // BatchedMesh owns an essential onBeforeRender implementation that builds
    // the multi-draw list and indirect instance texture. Replacing it made the
    // authored trees report as visible while submitting zero draws. Always run
    // our projected-pixel gate first, then delegate to Three's implementation.
    updateBatchedDrawList(
      renderer,
      scene,
      camera,
      geometry,
      renderMaterial,
      group,
    )
  }
  return { mesh: batched, triangles }
}

interface VolumetricAraucariaPrototype {
  readonly crown: BufferGeometry
  readonly wood: BufferGeometry
}

interface VolumetricAraucariaBatchResult {
  readonly meshes: readonly [BatchedMesh, BatchedMesh]
  readonly triangles: number
}

const VOLUMETRIC_ARAUCARIA_PROFILE_COUNT = 4

function mapGeometryUvsToAraucariaComponent(
  geometry: BufferGeometry,
  column: number,
  row: number,
  mirrorU: boolean,
): BufferGeometry {
  const columns = 4
  const rows = 3
  const paddingU = 0.008
  const paddingV = 0.008
  const u0 = (column + paddingU) / columns
  const u1 = (column + 1 - paddingU) / columns
  const invertedRow = rows - row - 1
  const v0 = (invertedRow + paddingV) / rows
  const v1 = (invertedRow + 1 - paddingV) / rows
  const uvs = geometry.getAttribute('uv')
  for (let index = 0; index < uvs.count; index += 1) {
    const sourceU = mirrorU ? 1 - uvs.getX(index) : uvs.getX(index)
    uvs.setXY(
      index,
      u0 + (u1 - u0) * sourceU,
      v0 + (v1 - v0) * uvs.getY(index),
    )
  }
  uvs.needsUpdate = true
  return geometry
}

function createAraucariaFoliageCard(
  centre: Vector3,
  yaw: number,
  width: number,
  height: number,
  column: number,
  row: number,
  mirrorU: boolean,
  crossed: boolean,
  colour: Color,
): BufferGeometry[] {
  const cards: BufferGeometry[] = []
  const cardCount = crossed ? 2 : 1
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
    const card = mapGeometryUvsToAraucariaComponent(
      new PlaneGeometry(
        width * (cardIndex === 0 ? 1 : 0.86),
        height * (cardIndex === 0 ? 1 : 0.92),
        1,
        1,
      ),
      column,
      row,
      cardIndex === 1 ? !mirrorU : mirrorU,
    )
    // The component sheet contains individual branch-tip clusters, not whole
    // tree silhouettes. Each card is physically attached to the end of an
    // explicit tapered limb and remains fixed in world space. A second crossed
    // card is reserved for the top crown and broad primary branches, where it
    // contributes real volume without recreating a camera-facing billboard.
    card.rotateY(-yaw + cardIndex * Math.PI * 0.5)
    card.rotateZ((row - 1) * 0.045)
    card.translate(
      centre.x,
      centre.y + height * (0.04 + cardIndex * 0.015),
      centre.z,
    )
    cards.push(applyVertexColour(card, colour))
  }
  return cards
}

function createVolumetricAraucariaPrototype(
  profile: number,
): VolumetricAraucariaPrototype {
  const woodParts: BufferGeometry[] = []
  const crownParts: BufferGeometry[] = []
  const trunkBaseRadius = [0.044, 0.056, 0.048, 0.04][profile]!
  const trunkTopRadius = trunkBaseRadius * [0.24, 0.2, 0.26, 0.22][profile]!
  const tierCount = [10, 8, 9, 11][profile]!
  const crownStart = [0.2, 0.3, 0.17, 0.26][profile]!
  const barkColour = new Color(
    ['#5c4938', '#65503d', '#584737', '#6a5440'][profile],
  )
  const foliageColours = [
    new Color('#c8d0b9'),
    new Color('#b8c5ac'),
    new Color('#d1d6c4'),
  ] as const

  const trunk = new CylinderGeometry(
    trunkTopRadius,
    trunkBaseRadius,
    1,
    8,
    5,
    false,
  )
  trunk.translate(0, 0.5, 0)
  applyFixedUv(trunk, 0.5, 0.5)
  woodParts.push(applyVertexColour(trunk, barkColour))
  addRootFlareParts(
    woodParts,
    barkColour,
    trunkBaseRadius,
    trunkBaseRadius * 2.7,
    0.29 + profile * 0.41,
    6,
    0.5,
    0.5,
  )

  for (let tier = 0; tier < tierCount; tier += 1) {
    const progress = tier / Math.max(1, tierCount - 1)
    const tierY = crownStart + progress * (0.72 - crownStart)
    const tierPhase = profile * 0.47 + tier * 0.61
    const branchCount = 4 + ((tier + profile) % 2)
    const umbrellaEnvelope = Math.sin(progress * Math.PI) ** 0.7
    const spread =
      profile === 0
        ? 0.235 - progress * 0.12
        : profile === 1
          ? 0.105 + umbrellaEnvelope * 0.19
          : profile === 2
            ? 0.24 - progress * 0.085
            : 0.19 - progress * 0.075

    for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
      // Profile 2 is an older, open-crowned tree with a few naturally missing
      // limbs. The gap is deterministic and never repeats as an entire level.
      if (
        profile === 2 &&
        (tier * 7 + branchIndex * 5 + profile) % 11 === 0
      ) {
        continue
      }
      const yaw =
        tierPhase +
        (branchIndex / branchCount) * TAU +
        (((tier * 13 + branchIndex * 7 + profile * 5) % 9) - 4) * 0.017
      const branchLength =
        spread *
        (0.84 + ((tier * 11 + branchIndex * 5 + profile) % 7) * 0.045)
      const rise =
        -0.12 + progress * 0.34 + ((branchIndex + tier) % 3 - 1) * 0.025
      const direction = new Vector3(
        Math.cos(yaw),
        rise,
        Math.sin(yaw),
      ).normalize()
      const origin = new Vector3(0, tierY, 0)
      const baseRadius =
        trunkBaseRadius * (0.34 - progress * 0.17) * (branchIndex % 2 ? 0.92 : 1)
      woodParts.push(
        createTaperedBranch(
          origin,
          direction,
          branchLength,
          Math.max(0.006, baseRadius),
          Math.max(0.0025, baseRadius * 0.2),
          barkColour,
          0.5,
          0.5,
        ),
      )
      const endpoint = origin
        .clone()
        .addScaledVector(direction, branchLength * 0.92)
      const componentWidth = branchLength * (1.12 + (tier % 3) * 0.07)
      const componentHeight = componentWidth * (0.48 + (branchIndex % 2) * 0.06)
      crownParts.push(
        ...createAraucariaFoliageCard(
          endpoint,
          yaw,
          componentWidth,
          componentHeight,
          (tier + branchIndex + profile) % 4,
          (tier + profile * 2) % 3,
          (tier + branchIndex) % 2 === 1,
          branchIndex === 0 || (tier + branchIndex + profile) % 5 === 0,
          foliageColours[(tier + branchIndex + profile) % foliageColours.length]!,
        ),
      )
    }
  }

  // A short leader and asymmetric crown cap prevent the last branch tier from
  // reading as a clipped horizontal plate.
  const leaderOrigin = new Vector3(0, 0.7, 0)
  woodParts.push(
    createTaperedBranch(
      leaderOrigin,
      WORLD_UP,
      0.3,
      trunkTopRadius * 1.25,
      trunkTopRadius * 0.5,
      barkColour,
      0.5,
      0.5,
    ),
  )
  for (let topIndex = 0; topIndex < 5; topIndex += 1) {
    const yaw = profile * 0.37 + (topIndex / 5) * TAU
    const radius = 0.035 + (topIndex % 2) * 0.018
    crownParts.push(
      ...createAraucariaFoliageCard(
        new Vector3(
          Math.cos(yaw) * radius,
          0.9 + (topIndex % 3) * 0.025,
          Math.sin(yaw) * radius,
        ),
        yaw,
        0.13 + (topIndex % 2) * 0.025,
        0.1 + (topIndex % 3) * 0.012,
        (profile + topIndex) % 4,
        (profile * 2 + topIndex) % 3,
        topIndex % 2 === 1,
        true,
        foliageColours[(profile + topIndex) % foliageColours.length]!,
      ),
    )
  }

  const wood = mergePrototypeParts(woodParts)
  const crown = mergePrototypeParts(crownParts)
  wood.name = `scale-encounter-volumetric-araucaria-wood-${profile + 1}`
  crown.name = `scale-encounter-volumetric-araucaria-crown-${profile + 1}`
  return { crown, wood }
}

function installBatchedProjectedPixelGate(
  mesh: BatchedMesh,
  metrics: ReadonlyArray<{
    readonly height: number
    readonly instanceId: number
    readonly worldCentre: Vector3
  }>,
  thresholdPixels: number,
  metadataKey: string,
): void {
  const rendererSize = new Vector2()
  const cameraWorldPosition = new Vector3()
  const updateBatchedDrawList = mesh.onBeforeRender.bind(mesh)
  mesh.onBeforeRender = (
    renderer,
    scene,
    camera,
    geometry,
    renderMaterial,
    group,
  ) => {
    if (camera instanceof PerspectiveCamera) {
      renderer.getSize(rendererSize)
      camera.getWorldPosition(cameraWorldPosition)
      const pixelsPerWorldUnitAtUnitDistance =
        rendererSize.y / (2 * Math.tan((camera.fov * Math.PI) / 360))
      let visibleCount = 0
      metrics.forEach((metric) => {
        const distance = Math.max(
          0.01,
          cameraWorldPosition.distanceTo(metric.worldCentre),
        )
        const projectedHeight =
          (metric.height * pixelsPerWorldUnitAtUnitDistance) / distance
        const visible = projectedHeight >= thresholdPixels
        mesh.setVisibleAt(metric.instanceId, visible)
        if (visible) visibleCount += 1
      })
      mesh.userData[metadataKey] = visibleCount
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
}

function createVolumetricAraucariaBatches(
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  foliageTexture: Texture,
): VolumetricAraucariaBatchResult | null {
  if (anchors.length === 0) return null
  const prototypes = Array.from(
    { length: VOLUMETRIC_ARAUCARIA_PROFILE_COUNT },
    (_, profile) => createVolumetricAraucariaPrototype(profile),
  )
  const woodMaterial = new MeshStandardMaterial({
    color: '#806b56',
    metalness: 0,
    roughness: 0.97,
    vertexColors: true,
  })
  woodMaterial.name = 'scale-encounter-volumetric-araucaria-wood-material'
  const crownMaterial = new MeshStandardMaterial({
    alphaTest: 0.36,
    alphaToCoverage: true,
    color: '#d2dcc8',
    // The component photographs contain their own diffuse shading. A measured
    // ambient term restores their middle values under the same directional key
    // used by the animals, without turning the foliage into unlit UI sprites.
    emissive: '#31402c',
    emissiveIntensity: 0.32,
    map: foliageTexture,
    metalness: 0,
    roughness: 0.94,
    side: DoubleSide,
    transparent: false,
    vertexColors: true,
  })
  crownMaterial.name = 'scale-encounter-volumetric-araucaria-crown-material'

  const makeBatch = (
    role: 'crown' | 'wood',
    material: MeshStandardMaterial,
  ): { readonly geometryIds: number[]; readonly mesh: BatchedMesh } => {
    const geometries = prototypes.map((prototype) => prototype[role])
    const mesh = new BatchedMesh(
      anchors.length,
      geometries.reduce(
        (sum, geometry) => sum + geometry.getAttribute('position').count,
        0,
      ),
      geometries.reduce(
        (sum, geometry) => sum + (geometry.index?.count ?? 0),
        0,
      ),
      material,
    )
    mesh.name = `scale-encounter-production-volumetric-araucarias-${role}`
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.perObjectFrustumCulled = true
    mesh.sortObjects = false
    return {
      geometryIds: geometries.map((geometry) => mesh.addGeometry(geometry)),
      mesh,
    }
  }

  const woodBatch = makeBatch('wood', woodMaterial)
  const crownBatch = makeBatch('crown', crownMaterial)
  const transform = new Object3D()
  const placements: Array<
    ScaleEncounterProductionMidgroundAnchor & {
      readonly burialDepth: number
      readonly groundingError: number
      readonly profile: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []
  const projectionMetrics: Array<{
    readonly height: number
    readonly instanceId: number
    readonly worldCentre: Vector3
  }> = []
  let triangles = 0
  anchors.forEach((anchor, index) => {
    const profile =
      (Math.floor(anchor.yaw * 1_000) + index * 7) %
      VOLUMETRIC_ARAUCARIA_PROFILE_COUNT
    const prototype = prototypes[profile]!
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    transform.position.set(anchor.x, 0, anchor.z)
    transform.rotation.set(
      anchor.tiltX * 0.22,
      anchor.yaw,
      anchor.tiltZ * 0.22,
    )
    transform.scale.set(
      anchor.height * anchor.widthScale,
      anchor.height,
      anchor.height * anchor.widthScale,
    )
    transform.updateMatrix()
    const zeroBounds = prototype.wood.boundingBox!
      .clone()
      .union(prototype.crown.boundingBox!.clone())
      .applyMatrix4(transform.matrix)
    const burialDepth = Math.min(0.1, anchor.height * 0.006)
    transform.position.y = terrainY - burialDepth - zeroBounds.min.y
    transform.updateMatrix()
    const finalBounds = prototype.wood.boundingBox!
      .clone()
      .union(prototype.crown.boundingBox!.clone())
      .applyMatrix4(transform.matrix)
    const woodInstanceId = woodBatch.mesh.addInstance(
      woodBatch.geometryIds[profile]!,
    )
    const crownInstanceId = crownBatch.mesh.addInstance(
      crownBatch.geometryIds[profile]!,
    )
    woodBatch.mesh.setMatrixAt(woodInstanceId, transform.matrix)
    crownBatch.mesh.setMatrixAt(crownInstanceId, transform.matrix)
    const distanceFade = Math.max(0, Math.min(1, (anchor.radius - 42) / 68))
    const variation = ((index * 11 + profile * 5) % 7) * 0.012
    woodBatch.mesh.setColorAt(
      woodInstanceId,
      new Color().setRGB(
        0.75 - distanceFade * 0.08 + variation,
        0.68 - distanceFade * 0.07 + variation * 0.7,
        0.56 - distanceFade * 0.06 + variation * 0.4,
      ),
    )
    crownBatch.mesh.setColorAt(
      crownInstanceId,
      new Color().setRGB(
        0.88 - distanceFade * 0.07 + variation,
        0.94 - distanceFade * 0.06 + variation * 0.8,
        0.82 - distanceFade * 0.05 + variation * 0.5,
      ),
    )
    placements.push({
      ...anchor,
      burialDepth,
      groundingError: round(finalBounds.min.y - (terrainY - burialDepth)),
      profile,
      terrainY,
      worldBottomY: round(finalBounds.min.y),
    })
    projectionMetrics.push({
      height: anchor.height,
      instanceId: woodInstanceId,
      worldCentre: finalBounds.getCenter(new Vector3()),
    })
    triangles +=
      geometryTriangleCount(prototype.wood) +
      geometryTriangleCount(prototype.crown)
  })

  woodBatch.mesh.computeBoundingBox()
  woodBatch.mesh.computeBoundingSphere()
  crownBatch.mesh.computeBoundingBox()
  crownBatch.mesh.computeBoundingSphere()
  woodBatch.mesh.userData.scaleEncounterProductionMidgroundKind =
    'araucarian-conifer'
  woodBatch.mesh.userData.scaleEncounterProductionMidgroundRole =
    'volumetric-wood'
  woodBatch.mesh.userData.scaleEncounterProductionMidgroundPlacements =
    placements
  crownBatch.mesh.userData.scaleEncounterProductionMidgroundKind =
    'araucarian-conifer'
  crownBatch.mesh.userData.scaleEncounterProductionMidgroundRole =
    'volumetric-crown'
  installBatchedProjectedPixelGate(
    woodBatch.mesh,
    projectionMetrics,
    9,
    'scaleEncounterProductionMidgroundVisibleVolumetricTrees',
  )
  installBatchedProjectedPixelGate(
    crownBatch.mesh,
    projectionMetrics,
    9,
    'scaleEncounterProductionMidgroundVisibleVolumetricTrees',
  )

  prototypes.forEach(({ crown, wood }) => {
    crown.dispose()
    wood.dispose()
  })
  return {
    meshes: [woodBatch.mesh, crownBatch.mesh],
    triangles,
  }
}

function createAtlasSilhouettePrototype(
  kind: ScaleEncounterProductionMidgroundKind,
  variant: 0 | 1,
  lod: MidgroundLod,
): PrototypeGeometry {
  const cellBase =
    kind === 'araucarian-conifer' ? 0 : kind === 'tree-fern' ? 1 : 2
  const width =
    kind === 'araucarian-conifer' ? 0.78 : kind === 'tree-fern' ? 1.06 : 1.12
  const parts: BufferGeometry[] = []
  const profileCount =
    lod === 'far' ? 2 : kind === 'araucarian-conifer' ? 3 : 2
  const foliageColour = new Color(
    variant === 0 ? '#f7faf2' : '#f1f5eb',
  )

  // Fixed world-space crossed profiles retain parallax around the full orbit.
  // The atlas contains two independently authored silhouettes per species;
  // instance yaw, height and width then break up repetition without making
  // any card face the camera or rotate while the child moves.
  for (let profile = 0; profile < profileCount; profile += 1) {
    const profileVariant = ((profile + variant) % 2) as 0 | 1
    const cell = cellBase + profileVariant * 3
    const profileHeight =
      0.91 + ((profile * 7 + variant * 5 + kind.length) % 5) * 0.035
    const profileWidth =
      width * (0.88 + ((profile * 5 + variant * 3) % 4) * 0.075)
    const plane = mapGeometryUvsToVegetationCell(
      new PlaneGeometry(profileWidth, profileHeight, 1, 1),
      cell,
      (profile + variant) % 3 === 1,
    )
    plane.rotateY(
      (profile / profileCount) * Math.PI +
        (variant === 0 ? 0.035 : -0.045),
    )
    plane.translate(
      ((profile * 11 + variant * 7) % 3 - 1) * 0.018,
      profileHeight * 0.5,
      ((profile * 13 + variant * 5) % 3 - 1) * 0.015,
    )
    parts.push(applyVertexColour(plane, foliageColour))
  }

  const trunkHeight =
    kind === 'araucarian-conifer' ? 0.78 : kind === 'tree-fern' ? 0.07 : 0.12
  const baseRadius =
    kind === 'araucarian-conifer' ? 0.038 : kind === 'tree-fern' ? 0.05 : 0.08
  const barkU = (6 + variant + 0.5) / 8
  const barkV = 0.5
  const barkColour = new Color(variant === 0 ? '#f6f0e5' : '#ede5d8')
  const trunk = new CylinderGeometry(
    baseRadius * 0.55,
    baseRadius,
    trunkHeight,
    lod === 'far' ? 5 : 7,
    2,
    false,
  )
  trunk.translate(0, trunkHeight * 0.5, 0)
  applyFixedUv(trunk, barkU, barkV)
  parts.push(applyVertexColour(trunk, barkColour))
  addRootFlareParts(
    parts,
    barkColour,
    baseRadius,
    baseRadius * 2.8,
    variant * 0.57,
    lod === 'far' ? 4 : 5,
    barkU,
    barkV,
  )

  const geometry = mergePrototypeParts(parts)
  geometry.name = `scale-encounter-${kind}-atlas-silhouette-prototype`
  return {
    geometry,
    height: Math.max(0.001, geometry.boundingBox?.max.y ?? 1),
  }
}

function geometryTriangleCount(geometry: BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
}

function midgroundTerrainNormal(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  x: number,
  z: number,
  kind: ScaleEncounterProductionMidgroundKind,
  target: Vector3,
): Vector3 {
  const step =
    kind === 'araucarian-conifer' ? 1.25 : kind === 'tree-fern' ? 0.62 : 0.4
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

function midgroundBurialDepth(
  kind: ScaleEncounterProductionMidgroundKind,
  height: number,
): number {
  if (kind === 'araucarian-conifer') return Math.min(0.085, height * 0.005)
  if (kind === 'tree-fern') return Math.min(0.034, height * 0.007)
  return Math.min(0.014, height * 0.009)
}

function createSpeciesBatch(
  kind: ScaleEncounterProductionMidgroundKind,
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  foliageTexture: Texture,
  variant: 0 | 1,
  lod: MidgroundLod,
): { readonly mesh: InstancedMesh; readonly triangles: number } {
  const prototype = createAtlasSilhouettePrototype(kind, variant, lod)
  const material = new MeshStandardMaterial({
    alphaTest: 0.4,
    alphaToCoverage: true,
    color: '#ffffff',
    emissive: '#182016',
    emissiveIntensity: 0.045,
    map: foliageTexture,
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide,
    vertexColors: true,
  })
  material.name = `scale-encounter-production-${kind}-material`
  const mesh = new InstancedMesh(
    prototype.geometry,
    material,
    anchors.length,
  )
  mesh.name = `scale-encounter-production-${kind}s-${lod}-variant-${variant === 0 ? 'a' : 'b'}`
  const transform = new Object3D()
  const tilt = new Object3D()
  const terrainNormal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawAroundLocalUp = new Quaternion()
  prototype.geometry.computeBoundingBox()
  const prototypeBounds = prototype.geometry.boundingBox?.clone()
  if (!prototypeBounds) {
    throw new Error(`Production ${kind} prototype has no bounds`)
  }
  const groundedAnchors: Array<
    ScaleEncounterProductionMidgroundAnchor & {
      readonly burialDepth: number
      readonly groundingError: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []

  anchors.forEach((anchor, index) => {
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    const scale = anchor.height / prototype.height
    transform.position.set(anchor.x, 0, anchor.z)
    midgroundTerrainNormal(
      terrainHeightAtWorld,
      anchor.x,
      anchor.z,
      kind,
      terrainNormal,
    )
    slopeAlignment.setFromUnitVectors(WORLD_UP, terrainNormal)
    yawAroundLocalUp.setFromAxisAngle(WORLD_UP, anchor.yaw)
    tilt.rotation.set(anchor.tiltX, 0, anchor.tiltZ)
    transform.quaternion
      .copy(slopeAlignment)
      .multiply(yawAroundLocalUp)
      .multiply(tilt.quaternion)
    transform.scale.set(
      scale * anchor.widthScale,
      scale,
      scale * anchor.widthScale,
    )
    transform.updateMatrix()
    const zeroHeightBounds = prototypeBounds
      .clone()
      .applyMatrix4(transform.matrix)
    const burialDepth = midgroundBurialDepth(kind, anchor.height)
    transform.position.y = terrainY - burialDepth - zeroHeightBounds.min.y
    transform.updateMatrix()
    const finalBounds = prototypeBounds.clone().applyMatrix4(transform.matrix)
    mesh.setMatrixAt(index, transform.matrix)
    const distanceFade = Math.max(0, Math.min(1, (anchor.radius - 48) / 136))
    const variation = ((index * 13) % 7) * 0.009
    const brightness = 0.96 - distanceFade * 0.11 + variation
    const tint = new Color().setRGB(
      brightness * 0.95,
      brightness,
      brightness * 0.9,
    )
    mesh.setColorAt(index, tint)
    groundedAnchors.push({
      ...anchor,
      burialDepth,
      groundingError: round(
        finalBounds.min.y - (terrainY - burialDepth),
      ),
      terrainY,
      worldBottomY: round(finalBounds.min.y),
    })
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.scaleEncounterProductionMidgroundKind = kind
  mesh.userData.scaleEncounterProductionMidgroundVariant = variant
  mesh.userData.scaleEncounterProductionMidgroundLod = lod
  mesh.userData.scaleEncounterProductionMidgroundPlacements = groundedAnchors
  mesh.userData.scaleEncounterProductionMidgroundPrototypeTriangles =
    geometryTriangleCount(prototype.geometry)

  return {
    mesh,
    triangles: geometryTriangleCount(prototype.geometry) * anchors.length,
  }
}

function createScannedSpeciesBatch(
  kind: ScaleEncounterProductionMidgroundKind,
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  templateRoot: Group,
  sourceName: string,
  borrowedTextures?: Set<Texture>,
): { readonly mesh: InstancedMesh; readonly triangles: number } | null {
  const prototype = cloneScannedPrototype(
    templateRoot,
    sourceName,
    borrowedTextures,
  )
  if (!prototype) return null

  const mesh = new InstancedMesh(
    prototype.geometry,
    prototype.material,
    anchors.length,
  )
  mesh.name = `scale-encounter-production-${kind}s-scanned-${sourceName}`
  const transform = new Object3D()
  const tilt = new Object3D()
  const terrainNormal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawAroundLocalUp = new Quaternion()
  const prototypeBounds = prototype.geometry.boundingBox?.clone()
  if (!prototypeBounds) {
    prototype.geometry.dispose()
    const materials = Array.isArray(prototype.material)
      ? prototype.material
      : [prototype.material]
    materials.forEach((material) => material.dispose())
    return null
  }
  const groundedAnchors: Array<
    ScaleEncounterProductionMidgroundAnchor & {
      readonly burialDepth: number
      readonly groundingError: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []

  anchors.forEach((anchor, index) => {
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    const scale = anchor.height / prototype.height
    transform.position.set(anchor.x, 0, anchor.z)
    midgroundTerrainNormal(
      terrainHeightAtWorld,
      anchor.x,
      anchor.z,
      kind,
      terrainNormal,
    )
    slopeAlignment.setFromUnitVectors(WORLD_UP, terrainNormal)
    yawAroundLocalUp.setFromAxisAngle(WORLD_UP, anchor.yaw)
    tilt.rotation.set(anchor.tiltX, 0, anchor.tiltZ)
    transform.quaternion
      .copy(slopeAlignment)
      .multiply(yawAroundLocalUp)
      .multiply(tilt.quaternion)
    transform.scale.set(
      scale * anchor.widthScale,
      scale,
      scale * anchor.widthScale,
    )
    transform.updateMatrix()
    const zeroHeightBounds = prototypeBounds
      .clone()
      .applyMatrix4(transform.matrix)
    const burialDepth = midgroundBurialDepth(kind, anchor.height)
    transform.position.y = terrainY - burialDepth - zeroHeightBounds.min.y
    transform.updateMatrix()
    const finalBounds = prototypeBounds.clone().applyMatrix4(transform.matrix)
    mesh.setMatrixAt(index, transform.matrix)
    const distanceFade = Math.max(0, Math.min(1, (anchor.radius - 42) / 130))
    const variation = ((index * 17 + sourceName.length) % 9) * 0.008
    const brightness =
      (kind === 'araucarian-conifer' ? 0.82 : 0.76) -
      distanceFade * 0.09 +
      variation
    mesh.setColorAt(
      index,
      new Color().setRGB(
        brightness * 0.86,
        brightness * 0.96,
        brightness * 0.76,
      ),
    )
    groundedAnchors.push({
      ...anchor,
      burialDepth,
      groundingError: round(
        finalBounds.min.y - (terrainY - burialDepth),
      ),
      terrainY,
      worldBottomY: round(finalBounds.min.y),
    })
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.scaleEncounterProductionMidgroundKind = kind
  mesh.userData.scaleEncounterProductionMidgroundSource = sourceName
  mesh.userData.scaleEncounterProductionMidgroundPlacements = groundedAnchors
  mesh.userData.scaleEncounterProductionMidgroundPrototypeTriangles =
    geometryTriangleCount(prototype.geometry)

  return {
    mesh,
    triangles: geometryTriangleCount(prototype.geometry) * anchors.length,
  }
}

function createCompositeSupportPrototype(
  kind: 'cycad' | 'tree-fern',
  lod: MidgroundLod,
): BufferGeometry {
  const parts: BufferGeometry[] = []
  const baseRadius = kind === 'tree-fern' ? 0.108 : 0.17
  const topRadius = kind === 'tree-fern' ? 0.066 : 0.11
  const barkU = kind === 'tree-fern' ? 0.81 : 0.93
  const barkV = 0.5
  const barkColour = new Color(
    kind === 'tree-fern' ? '#75634f' : '#6d5f49',
  )
  const trunk = new CylinderGeometry(
    topRadius,
    baseRadius,
    1,
    lod === 'near' ? 9 : 7,
    lod === 'near' ? 4 : 3,
    false,
  )
  trunk.translate(0, 0.5, 0)
  applyFixedUv(trunk, barkU, barkV)
  parts.push(applyVertexColour(trunk, barkColour))
  addRootFlareParts(
    parts,
    barkColour,
    baseRadius,
    baseRadius * (kind === 'tree-fern' ? 2.35 : 3.1),
    kind === 'tree-fern' ? 0.37 : 0.81,
    lod === 'near' ? 6 : 4,
    barkU,
    barkV,
  )
  const geometry = mergePrototypeParts(parts)
  geometry.name = `scale-encounter-${kind}-${lod}-grounded-support`
  return geometry
}

function mapGeometryUvsToFrondComponent(
  geometry: BufferGeometry,
  column: number,
  row: number,
  mirrorU: boolean,
): BufferGeometry {
  const columns = 4
  const rows = 3
  const paddingU = 0.008
  const paddingV = 0.006
  const uvs = geometry.getAttribute('uv')
  const u0 = (column + paddingU) / columns
  const u1 = (column + 1 - paddingU) / columns
  // The source sheet is authored top-to-bottom while WebGL UVs are bottom-up.
  const invertedRow = rows - row - 1
  const v0 = (invertedRow + paddingV) / rows
  const v1 = (invertedRow + 1 - paddingV) / rows
  for (let index = 0; index < uvs.count; index += 1) {
    const sourceU = mirrorU ? 1 - uvs.getX(index) : uvs.getX(index)
    uvs.setXY(
      index,
      u0 + (u1 - u0) * sourceU,
      v0 + (v1 - v0) * uvs.getY(index),
    )
  }
  uvs.needsUpdate = true
  return geometry
}

/**
 * Assemble a real radial crown from independently oriented fronds.  The old
 * implementation enlarged a complete ground-fern mesh and raised it onto a
 * thin cylinder.  Even with a mathematically grounded cylinder, that shape
 * read as a row of ferns suspended in the air.  Here every card starts at the
 * same crown socket, extends outwards in world-space, and visibly overlaps the
 * broad trunk/root support created below.
 */
function createComponentFrondCrown(
  kind: 'cycad' | 'tree-fern',
  lod: MidgroundLod,
  variant: 0 | 1,
  texture: Texture,
): ScannedPrototypeGeometry {
  const outerCount = lod === 'near' ? (kind === 'tree-fern' ? 12 : 9) : 8
  const innerCount = lod === 'near' ? (kind === 'tree-fern' ? 6 : 4) : 4
  const parts: BufferGeometry[] = []
  const frondDirection = new Vector3()
  const directionRotation = new Quaternion()
  const socket = kind === 'tree-fern' ? 0.035 : 0.018

  const addRing = (count: number, inner: boolean): void => {
    for (let index = 0; index < count; index += 1) {
      const phase = variant * 0.31 + (inner ? 0.2 : 0)
      const yaw = phase + (index / count) * TAU
      const length =
        (inner ? 0.72 : 1) *
        (0.9 + ((index * 7 + variant * 3) % 5) * 0.035)
      const width =
        length *
        (kind === 'tree-fern' ? (inner ? 0.29 : 0.34) : 0.31)
      const plane = mapGeometryUvsToFrondComponent(
        new PlaneGeometry(width, length, 1, 2),
        (index + variant * 2 + (inner ? 1 : 0)) % 4,
        kind === 'tree-fern' ? (index + variant) % 2 : 2,
        (index + variant) % 2 === 1,
      )
      // Put the frond stem at the local origin before directing its tip.
      plane.translate(0, length * 0.5, 0)
      const radial = inner ? 0.53 : 0.94
      const rise =
        kind === 'tree-fern'
          ? inner
            ? 0.82
            : 0.2 + (index % 3) * 0.045
          : inner
            ? 0.76
            : 0.43 + (index % 2) * 0.06
      frondDirection.set(
        Math.cos(yaw) * radial,
        rise,
        Math.sin(yaw) * radial,
      ).normalize()
      directionRotation.setFromUnitVectors(WORLD_UP, frondDirection)
      plane.applyQuaternion(directionRotation)
      plane.applyQuaternion(
        new Quaternion().setFromAxisAngle(
          frondDirection,
          (index % 3 - 1) * 0.09,
        ),
      )
      plane.translate(0, socket + (inner ? 0.035 : 0), 0)
      parts.push(
        applyVertexColour(
          plane,
          new Color(
            (index + variant) % 4 === 0 ? '#e3ead8' : '#f4f6ee',
          ),
        ),
      )
    }
  }

  addRing(outerCount, false)
  addRing(innerCount, true)
  const geometry = mergePrototypeParts(parts)
  geometry.name = `scale-encounter-${kind}-${lod}-component-crown-${variant}`
  const material = new MeshStandardMaterial({
    alphaTest: 0.37,
    alphaToCoverage: true,
    color: '#ffffff',
    emissive: '#172014',
    emissiveIntensity: 0.035,
    map: texture,
    metalness: 0,
    roughness: 0.92,
    side: DoubleSide,
    vertexColors: true,
  })
  material.name = `scale-encounter-${kind}-component-crown-material-${variant}`
  const bounds = geometry.boundingBox
  return {
    geometry,
    height: Math.max(0.001, (bounds?.max.y ?? 1) - (bounds?.min.y ?? 0)),
    material,
    sourceName: `frond-component-${kind}-${variant}`,
  }
}

/**
 * Builds a real, supported tree-fern/cycad instead of treating a photographed
 * crown as a complete plant. The source fern geometry is normalised by its
 * footprint, lifted onto an explicit trunk, and kept overlapped with that
 * support in the same slope-aligned local frame. This is the important
 * distinction between a grounded plant and the old floating crown cards.
 */
function createCompositeFrondBatches(
  kind: 'cycad' | 'tree-fern',
  anchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor>,
  terrainHeightAtWorld: TerrainHeightAtWorld,
  lod: MidgroundLod,
  frondTexture: Texture,
): CompositeFrondBatchResult | null {
  if (anchors.length === 0) return null
  const prototypes = ([0, 1] as const).map((variant) =>
    createComponentFrondCrown(kind, lod, variant, frondTexture),
  )

  const supportGeometry = createCompositeSupportPrototype(kind, lod)
  supportGeometry.computeBoundingBox()
  const supportBounds = supportGeometry.boundingBox?.clone()
  if (!supportBounds) {
    supportGeometry.dispose()
    return null
  }
  const supportMaterial = new MeshStandardMaterial({
    // A fixed UV inside the shared crown atlas multiplied the support by its
    // darkest bark texels and turned tree-ferns into black telephone poles.
    // A restrained solid bark response is cheaper and remains readable under
    // the calibrated forest fill light.
    color: '#6d5b48',
    emissive: '#15100c',
    emissiveIntensity: 0.035,
    metalness: 0,
    roughness: 0.98,
    side: DoubleSide,
    vertexColors: true,
  })
  supportMaterial.name = `scale-encounter-production-${kind}-support-material`
  const supportMesh = new InstancedMesh(
    supportGeometry,
    supportMaterial,
    anchors.length,
  )
  supportMesh.name = `scale-encounter-production-${kind}s-${lod}-grounded-supports`

  const rootTransform = new Object3D()
  const tilt = new Object3D()
  const supportLocal = new Object3D()
  const zeroSupportMatrix = new Matrix4()
  const finalSupportMatrix = new Matrix4()
  const terrainNormal = new Vector3()
  const slopeAlignment = new Quaternion()
  const yawAroundLocalUp = new Quaternion()
  const supportPlacements: Array<
    ScaleEncounterProductionMidgroundAnchor & {
      readonly burialDepth: number
      readonly groundingError: number
      readonly rootY: number
      readonly supportTopY: number
      readonly terrainY: number
      readonly worldBottomY: number
    }
  > = []

  anchors.forEach((anchor, index) => {
    const prototype = prototypes[index % prototypes.length]!
    if (!prototype) return
    const crownScale =
      anchor.height *
      anchor.widthScale *
      (kind === 'tree-fern'
        ? 0.7 + (index % 4) * 0.025
        : 1.2 + (index % 3) * 0.055)
    const crownHeight = prototype.height * crownScale
    const crownBaseHeight =
      kind === 'tree-fern'
        ? Math.max(anchor.height * 0.44, anchor.height - crownHeight * 0.9)
        : anchor.height * (0.05 + (index % 3) * 0.012)
    const supportHeight = crownBaseHeight + Math.min(0.14, anchor.height * 0.055)
    const terrainY = terrainHeightAtWorld(anchor.x, anchor.z)
    const burialDepth = midgroundBurialDepth(kind, anchor.height)

    rootTransform.position.set(anchor.x, 0, anchor.z)
    midgroundTerrainNormal(
      terrainHeightAtWorld,
      anchor.x,
      anchor.z,
      kind,
      terrainNormal,
    )
    slopeAlignment.setFromUnitVectors(WORLD_UP, terrainNormal)
    yawAroundLocalUp.setFromAxisAngle(WORLD_UP, anchor.yaw)
    tilt.rotation.set(anchor.tiltX, 0, anchor.tiltZ)
    rootTransform.quaternion
      .copy(slopeAlignment)
      .multiply(yawAroundLocalUp)
      .multiply(tilt.quaternion)
    rootTransform.scale.set(1, 1, 1)
    rootTransform.updateMatrix()

    supportLocal.position.set(0, 0, 0)
    supportLocal.rotation.set(0, 0, 0)
    supportLocal.scale.set(
      supportHeight * anchor.widthScale,
      supportHeight,
      supportHeight * anchor.widthScale,
    )
    supportLocal.updateMatrix()
    zeroSupportMatrix
      .multiplyMatrices(rootTransform.matrix, supportLocal.matrix)
    const zeroBounds = supportBounds
      .clone()
      .applyMatrix4(zeroSupportMatrix)
    rootTransform.position.y = terrainY - burialDepth - zeroBounds.min.y
    rootTransform.updateMatrix()
    finalSupportMatrix
      .multiplyMatrices(rootTransform.matrix, supportLocal.matrix)
    const finalBounds = supportBounds
      .clone()
      .applyMatrix4(finalSupportMatrix)
    supportMesh.setMatrixAt(index, finalSupportMatrix)
    const brightness = 0.98 + (index % 5) * 0.014
    supportMesh.setColorAt(
      index,
      new Color().setRGB(
        brightness * 0.86,
        brightness * 0.82,
        brightness * 0.72,
      ),
    )
    supportPlacements.push({
      ...anchor,
      burialDepth,
      groundingError: round(finalBounds.min.y - (terrainY - burialDepth)),
      rootY: round(rootTransform.position.y),
      supportTopY: round(finalBounds.max.y),
      terrainY,
      worldBottomY: round(finalBounds.min.y),
    })
  })
  supportMesh.instanceMatrix.needsUpdate = true
  if (supportMesh.instanceColor) supportMesh.instanceColor.needsUpdate = true
  supportMesh.computeBoundingBox()
  supportMesh.computeBoundingSphere()
  supportMesh.castShadow = false
  supportMesh.receiveShadow = false
  supportMesh.userData.scaleEncounterProductionMidgroundKind = kind
  supportMesh.userData.scaleEncounterProductionMidgroundLod = lod
  supportMesh.userData.scaleEncounterProductionMidgroundRole = 'grounded-support'
  supportMesh.userData.scaleEncounterProductionMidgroundPlacements =
    supportPlacements

  const meshes: InstancedMesh[] = [supportMesh]
  let triangles = geometryTriangleCount(supportGeometry) * anchors.length
  prototypes.forEach((prototype, sourceIndex) => {
    const sourceName = prototype.sourceName
    const sourceAnchors = anchors.filter(
      (_anchor, index) => index % prototypes.length === sourceIndex,
    )
    const crownMesh = new InstancedMesh(
      prototype.geometry,
      prototype.material,
      sourceAnchors.length,
    )
    crownMesh.name = `scale-encounter-production-${kind}s-${lod}-grounded-crowns-${sourceName}`
    const crownLocal = new Object3D()
    const crownMatrix = new Matrix4()
    const crownBounds = prototype.geometry.boundingBox?.clone()
    const crownPlacements: Array<
      ScaleEncounterProductionMidgroundAnchor & {
        readonly crownBottomY: number
        readonly crownSupportGap: number
        readonly supportTopY: number
        readonly terrainY: number
      }
    > = []
    if (!crownBounds) return

    sourceAnchors.forEach((anchor, localIndex) => {
      const globalIndex = localIndex * prototypes.length + sourceIndex
      const crownScale =
        anchor.height *
        anchor.widthScale *
        (kind === 'tree-fern'
          ? 0.7 + (globalIndex % 4) * 0.025
          : 1.2 + (globalIndex % 3) * 0.055)
      const crownHeight = prototype.height * crownScale
      const crownBaseHeight =
        kind === 'tree-fern'
          ? Math.max(
              anchor.height * 0.44,
              anchor.height - crownHeight * 0.9,
            )
          : anchor.height * (0.05 + (globalIndex % 3) * 0.012)
      const supportPlacement = supportPlacements[globalIndex]!

      rootTransform.position.set(
        anchor.x,
        supportPlacement.rootY,
        anchor.z,
      )
      midgroundTerrainNormal(
        terrainHeightAtWorld,
        anchor.x,
        anchor.z,
        kind,
        terrainNormal,
      )
      slopeAlignment.setFromUnitVectors(WORLD_UP, terrainNormal)
      yawAroundLocalUp.setFromAxisAngle(WORLD_UP, anchor.yaw)
      tilt.rotation.set(anchor.tiltX, 0, anchor.tiltZ)
      rootTransform.quaternion
        .copy(slopeAlignment)
        .multiply(yawAroundLocalUp)
        .multiply(tilt.quaternion)
      rootTransform.scale.set(1, 1, 1)
      rootTransform.updateMatrix()
      crownLocal.position.set(0, crownBaseHeight, 0)
      crownLocal.rotation.set(
        (globalIndex % 3 - 1) * 0.025,
        (globalIndex % 5) * 0.19,
        ((globalIndex * 3) % 3 - 1) * 0.018,
      )
      crownLocal.scale.set(crownScale, crownScale, crownScale)
      crownLocal.updateMatrix()
      crownMatrix.multiplyMatrices(rootTransform.matrix, crownLocal.matrix)
      crownMesh.setMatrixAt(localIndex, crownMatrix)
      const finalCrownBounds = crownBounds
        .clone()
        .applyMatrix4(crownMatrix)
      const crownBottomY = finalCrownBounds.min.y
      crownPlacements.push({
        ...anchor,
        crownBottomY: round(crownBottomY),
        crownSupportGap: round(
          Math.max(0, crownBottomY - supportPlacement.supportTopY),
        ),
        supportTopY: supportPlacement.supportTopY,
        terrainY: supportPlacement.terrainY,
      })
      const distanceFade = Math.max(0, Math.min(1, (anchor.radius - 34) / 90))
      const brightness = 0.97 - distanceFade * 0.1 + (globalIndex % 5) * 0.009
      crownMesh.setColorAt(
        localIndex,
        new Color().setRGB(
          brightness * 0.9,
          brightness,
          brightness * 0.84,
        ),
      )
    })
    crownMesh.instanceMatrix.needsUpdate = true
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true
    crownMesh.computeBoundingBox()
    crownMesh.computeBoundingSphere()
    crownMesh.castShadow = false
    crownMesh.receiveShadow = false
    crownMesh.userData.scaleEncounterProductionMidgroundKind = kind
    crownMesh.userData.scaleEncounterProductionMidgroundLod = lod
    crownMesh.userData.scaleEncounterProductionMidgroundRole = 'supported-crown'
    crownMesh.userData.scaleEncounterProductionMidgroundSource = sourceName
    crownMesh.userData.scaleEncounterProductionMidgroundPlacements =
      crownPlacements
    meshes.push(crownMesh)
    triangles +=
      geometryTriangleCount(prototype.geometry) * sourceAnchors.length
  })

  return {
    meshes,
    scannedInstances: anchors.length,
    triangles,
  }
}

export function createScaleEncounterProductionMidground(
  terrainHeightAtWorld: TerrainHeightAtWorld,
  density: ScaleEncounterEcologyDensity = 'current',
  forestProps: Group | null = null,
  borrowedTextures?: Set<Texture>,
  preparedMatureTreeAtlas: Texture | null = null,
  overviewClearance: ScaleEncounterProductionMidgroundOverviewClearance | null = null,
  includedKinds: ReadonlyArray<ScaleEncounterProductionMidgroundKind> = [
    'araucarian-conifer',
    'tree-fern',
    'cycad',
  ],
  preparedFrondAtlas: Texture | null = null,
): Group {
  const unfilteredPlan = createScaleEncounterProductionMidgroundPlan(density)
    .filter((anchor) => includedKinds.includes(anchor.kind))
  const plan = overviewClearance
    ? unfilteredPlan.filter((anchor) =>
        isScaleEncounterProductionMidgroundAnchorClearOfOverview(
          anchor,
          overviewClearance,
        ),
      )
    : unfilteredPlan
  const textureLoader = new TextureLoader()
  const includesAraucarian = includedKinds.includes('araucarian-conifer')
  const includesTreeFern = includedKinds.includes('tree-fern')
  const includesCycad = includedKinds.includes('cycad')
  const matureTreeTexture = includesAraucarian
    ? preparedMatureTreeAtlas ??
      textureLoader.load(matureTreeAtlasUrlForViewport())
    : null
  if (matureTreeTexture) {
    matureTreeTexture.name = 'scale-encounter-production-mature-tree-atlas-v1'
    matureTreeTexture.colorSpace = SRGBColorSpace
    matureTreeTexture.magFilter = LinearFilter
    matureTreeTexture.minFilter = LinearMipmapLinearFilter
    matureTreeTexture.generateMipmaps = true
  }
  const vegetationTexture =
    includesAraucarian || includesCycad
      ? textureLoader.load(vegetationAtlasUrl)
      : null
  if (vegetationTexture) {
    vegetationTexture.name = 'scale-encounter-production-vegetation-atlas-v2'
    vegetationTexture.colorSpace = SRGBColorSpace
    vegetationTexture.magFilter = LinearFilter
    vegetationTexture.minFilter = LinearMipmapLinearFilter
    vegetationTexture.generateMipmaps = true
  }
  // The reviewed GLB supplies complete low ferns, shrubs and rocks. Tree
  // ferns use a different representation: independent fronds attached to a
  // visible, root-flared support. Load that atlas even when the GLB is present
  // so a complete ground fern is never raised into the canopy again.
  const frondTexture = includesTreeFern
    ? preparedFrondAtlas ?? textureLoader.load(frondComponentAtlasUrl)
    : null
  if (frondTexture) {
    frondTexture.name = 'scale-encounter-production-frond-components-v4'
    frondTexture.colorSpace = SRGBColorSpace
    frondTexture.magFilter = LinearFilter
    frondTexture.minFilter = LinearMipmapLinearFilter
    frondTexture.generateMipmaps = true
  }
  const araucariaTexture = includesAraucarian
    ? textureLoader.load(araucariaComponentAtlasUrl)
    : null
  if (araucariaTexture) {
    araucariaTexture.name =
      'scale-encounter-production-araucaria-components-v4'
    araucariaTexture.colorSpace = SRGBColorSpace
    araucariaTexture.magFilter = LinearFilter
    araucariaTexture.minFilter = LinearMipmapLinearFilter
    araucariaTexture.generateMipmaps = true
  }
  const counts: Record<ScaleEncounterProductionMidgroundKind, number> = {
    'araucarian-conifer': 0,
    cycad: 0,
    'tree-fern': 0,
  }
  let estimatedTriangles = 0
  let drawCalls = 0
  let scannedInstanceCount = 0
  let supportedTreeFernInstanceCount = 0
  const lodCounts = { far: 0, near: 0 }
  const group = new Group()
  group.name = 'scale-encounter-production-midground-depth'

  for (const kind of includedKinds) {
    const anchors = plan.filter((anchor) => anchor.kind === kind)
    const currentBudget = SPECIES_RECIPES.find(
      (recipe) => recipe.kind === kind,
    )!.count
    counts[kind] = anchors.length

    if (kind === 'araucarian-conifer') {
      // Keep the genuine one-to-three metre CC0 trees in a believable young-
      // tree band. The component-built prototype proved mathematically
      // volumetric but read as a sparse, symmetrical low-poly Christmas tree
      // at encounter distance. Use the eight root-to-tip mature profiles from
      // the edge of the clearing onward; three fixed crossed planes preserve a
      // stable 360-degree silhouette without camera-facing billboards.
      const saplingAnchors = anchors
        .filter(({ radius }) => radius < 32)
        .map((anchor) => ({
          ...anchor,
          height: Math.min(anchor.height, 3.6),
        }))
      // The 32–68 m band is close enough that crossed cards reveal their
      // planes during a 360-degree orbit.  Keep genuine three-dimensional CC0
      // scan LODs in that whole middle-distance band, with the authored cards
      // reserved for the fog-softened distance beyond it.  This also gives the
      // clearing an actual volume instead of a ring of flat tree silhouettes.
      const lowDetailAnchors = anchors
        .filter(({ radius }) => radius >= 32 && radius < 68)
        .map((anchor) => ({
          ...anchor,
          height: Math.max(3.4, Math.min(6.8, anchor.height * 0.7)),
          widthScale: anchor.widthScale * 0.9,
        }))
      const volumetricAnchors: ReadonlyArray<ScaleEncounterProductionMidgroundAnchor> = []
      const matureAnchors = anchors
        .filter(({ radius }) => radius >= 68)
        .map((anchor, index) => ({
          ...anchor,
          height: Math.max(
            13,
            Math.min(
              22,
              anchor.height *
                (1.78 + ((index * 7 + Math.round(anchor.radius)) % 6) * 0.075),
            ),
          ),
          widthScale:
            anchor.widthScale *
            (0.78 + ((index * 5 + Math.round(anchor.yaw * 10)) % 5) * 0.055),
        }))
      lodCounts.near += saplingAnchors.length
      lodCounts.far +=
        lowDetailAnchors.length + volumetricAnchors.length + matureAnchors.length
      const volumetricBatches = createVolumetricAraucariaBatches(
        volumetricAnchors,
        terrainHeightAtWorld,
        araucariaTexture!,
      )
      if (volumetricBatches) {
        estimatedTriangles += volumetricBatches.triangles
        drawCalls += volumetricBatches.meshes.length
        group.add(...volumetricBatches.meshes)
      }
      const matureBatch = createMatureTreeBatch(
        matureAnchors,
        terrainHeightAtWorld,
        matureTreeTexture!,
      )
      if (matureBatch) {
        estimatedTriangles += matureBatch.triangles
        drawCalls += 1
        group.add(matureBatch.mesh)
      }

      const scannedSourceFamilies = [
        {
          anchors: saplingAnchors,
          lod: 'near' as const,
          names: [
            'real_tree_fir_sapling_a_lod0',
            'real_tree_fir_sapling_b_lod0',
            'real_tree_fir_sapling_c_lod0',
            'real_tree_pine_sapling_small_a_lod0',
            'real_tree_pine_sapling_small_b_lod0',
            'real_tree_pine_sapling_small_c_lod0',
          ] as const,
        },
        {
          anchors: lowDetailAnchors,
          lod: 'far' as const,
          names: [
            'real_tree_fir_sapling_a_lod1',
            'real_tree_fir_sapling_b_lod1',
            'real_tree_fir_sapling_c_lod1',
            'real_tree_pine_sapling_small_a_lod1',
            'real_tree_pine_sapling_small_b_lod1',
            'real_tree_pine_sapling_small_c_lod1',
          ] as const,
        },
      ]
      const canUseScannedSources =
        forestProps !== null &&
        scannedSourceFamilies.every(({ names }) =>
          names.every(
            (sourceName) =>
              forestProps.getObjectByName(sourceName) instanceof Mesh,
          ),
        )
      if (canUseScannedSources && forestProps) {
        scannedSourceFamilies.forEach(({ anchors: sourceFamily, names }) => {
          names.forEach((sourceName, sourceIndex) => {
            const sourceAnchors = sourceFamily.filter(
              (_anchor, index) => index % names.length === sourceIndex,
            )
            if (sourceAnchors.length === 0) return
            const batch = createScannedSpeciesBatch(
              kind,
              sourceAnchors,
              terrainHeightAtWorld,
              forestProps,
              sourceName,
              borrowedTextures,
            )
            if (!batch) return
            estimatedTriangles += batch.triangles
            drawCalls += 1
            scannedInstanceCount += sourceAnchors.length
            group.add(batch.mesh)
          })
        })
      } else if (vegetationTexture) {
        for (const { anchors: sourceFamily, lod } of scannedSourceFamilies) {
          for (const variant of [0, 1] as const) {
            const variantAnchors = sourceFamily.filter(
              (_anchor, index) => index % 2 === variant,
            )
            if (variantAnchors.length === 0) continue
            const batch = createSpeciesBatch(
              kind,
              variantAnchors,
              terrainHeightAtWorld,
              vegetationTexture,
              variant,
              lod,
            )
            estimatedTriangles += batch.triangles
            drawCalls += 1
            group.add(batch.mesh)
          }
        }
      }
      continue
    }

    const nearRadius =
      kind === 'tree-fern' ? 64 : 54
    const denseVisibleRadius =
      kind === 'tree-fern' ? 52 : 44
    for (const lod of ['near', 'far'] as const) {
      const lodAnchors = anchors.filter(({ radius }, index) => {
        const usesNearLod =
          radius < nearRadius &&
          (index < currentBudget || radius < denseVisibleRadius)
        return lod === 'near' ? usesNearLod : !usesNearLod
      })
      lodCounts[lod] += lodAnchors.length
      const supportedTreeFernAnchors =
        kind === 'tree-fern'
          ? lodAnchors.filter(({ height }) => height >= 1.75)
          : []
      const completeGroundPlantAnchors =
        kind === 'tree-fern'
          ? lodAnchors.filter(({ height }) => height < 1.75)
          : lodAnchors

      if (supportedTreeFernAnchors.length > 0 && frondTexture) {
        const composite = createCompositeFrondBatches(
          'tree-fern',
          supportedTreeFernAnchors,
          terrainHeightAtWorld,
          lod,
          frondTexture,
        )
        if (composite) {
          estimatedTriangles += composite.triangles
          drawCalls += composite.meshes.length
          supportedTreeFernInstanceCount += composite.scannedInstances
          group.add(...composite.meshes)
        }
      }

      // The scanned ecology GLB uses an opaque shared atlas; at grazing angles
      // its decimated fern leaf planes become bright rectangular strips. The
      // authored v2 silhouettes preserve alpha, multiple profiles and a true
      // root-aligned lower bound. Tall tree ferns still use the explicit
      // support+crown system above.
      for (const variant of [0, 1] as const) {
        if (!vegetationTexture) continue
        const variantAnchors = completeGroundPlantAnchors.filter(
          (_anchor, index) => index % 2 === variant,
        )
        if (variantAnchors.length === 0) continue
        const batch = createSpeciesBatch(
          kind,
          variantAnchors,
          terrainHeightAtWorld,
          vegetationTexture,
          variant,
          lod,
        )
        estimatedTriangles += batch.triangles
        drawCalls += 1
        group.add(batch.mesh)
      }
    }
  }

  const radii = plan.map(({ radius }) => radius)
  const metadata: ScaleEncounterProductionMidgroundMetadata = {
    counts,
    density,
    drawCalls,
    estimatedTriangles,
    filteredForOverviewCount: unfilteredPlan.length - plan.length,
    layout: 'irregular-habitat-patches',
    lodCounts,
    maximumRadiusMeters: Math.max(...radii),
    minimumRadiusMeters: Math.min(...radii),
    seed: SCALE_ENCOUNTER_PRODUCTION_MIDGROUND_SEED,
    representation:
      group.getObjectByName(
        'scale-encounter-production-volumetric-araucarias-crown',
      ) &&
      supportedTreeFernInstanceCount > 0
        ? 'hybrid-scanned-saplings-volumetric-araucarias-and-supported-tree-ferns'
        : group.getObjectByName('scale-encounter-production-mature-tree-colonies') &&
            supportedTreeFernInstanceCount > 0
          ? 'hybrid-scanned-saplings-supported-tree-ferns-and-atlas-tree-proxies'
        : group.getObjectByName('scale-encounter-production-mature-tree-colonies')
          ? 'instanced-alpha-clipped-multi-profile-world-space-proxies'
        : scannedInstanceCount > 0
          ? 'instanced-scanned-tree-lods-and-grounded-frond-crowns'
          : 'instanced-alpha-clipped-multi-profile-world-space-proxies',
    treeAssetMode:
      group.getObjectByName('scale-encounter-production-mature-tree-colonies')
        ? 'authored-atlas-profiles'
        : scannedInstanceCount > 0
          ? 'reviewed-cc0-scan-lods'
          : 'authored-atlas-profiles',
    totalInstances: plan.length,
    unfilteredInstances: unfilteredPlan.length,
  }
  group.userData.scaleEncounterProductionMidground = metadata
  return group
}
