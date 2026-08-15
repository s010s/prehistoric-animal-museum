import type {
  ScaleEncounterForestPropPlacement,
  ScaleEncounterForestPropTier,
} from './scale-encounter-forest-scatter-prototype'
import {
  scaleEncounterEcologyDensityMultiplier,
  type ScaleEncounterEcologyDensity,
} from './scale-encounter-ecology-density'

export type ScaleEncounterProductionEcologyKind =
  | 'branch'
  | 'fern'
  | 'litter'
  | 'log'
  | 'moss'
  | 'rock'
  | 'shrub'

export interface ScaleEncounterProductionEcologyPlacement
  extends ScaleEncounterForestPropPlacement {
  readonly patchId: number
}

export interface ScaleEncounterProductionEcologyBatch {
  readonly kind: ScaleEncounterProductionEcologyKind
  readonly placements: ReadonlyArray<ScaleEncounterProductionEcologyPlacement>
  readonly templateName: string
}

export interface ScaleEncounterProductionEcologyScatter {
  readonly batches: ReadonlyArray<ScaleEncounterProductionEcologyBatch>
  readonly counts: Readonly<Record<ScaleEncounterProductionEcologyKind, number>>
}

interface EcologyPatch {
  readonly radiusX: number
  readonly radiusZ: number
  readonly tier: ScaleEncounterForestPropTier
  readonly weight: number
  readonly x: number
  readonly z: number
}

interface ScatterRecipe {
  readonly count: number
  readonly forceInnerCover?: boolean
  readonly kind: ScaleEncounterProductionEcologyKind
  /**
   * Static population envelope before the render-time projected-size gate.
   * Tiny forest-floor silhouettes beyond these radii read as black pixels,
   * not ecology, in the portrait overview.
   */
  readonly maximumRadius: number
  readonly maximumScale: number
  readonly minimumRadius: number
  readonly minimumScale: number
  readonly minimumSeparation: number
  readonly patches: ReadonlyArray<EcologyPatch>
  readonly seed: number
}

const TAU = Math.PI * 2
const MAXIMUM_SCATTER_RADIUS = 122

const DAMP_PATCHES = [
  // Low cover reaches into the comparison clearing without occupying the
  // animal footprint or the child's observation rail. These four pockets
  // remove the previous 22 m empty-disc silhouette from the overview.
  { x: -5, z: -11, radiusX: 8, radiusZ: 3.2, weight: 1.55, tier: 'near' },
  { x: 11, z: 6, radiusX: 3.8, radiusZ: 6.4, weight: 0.62, tier: 'near' },
  { x: -1, z: 14, radiusX: 8.5, radiusZ: 2.8, weight: 0.88, tier: 'near' },
  { x: -34, z: -29, radiusX: 10, radiusZ: 7, weight: 1.25, tier: 'near' },
  { x: 27, z: -33, radiusX: 13, radiusZ: 8, weight: 1.6, tier: 'near' },
  { x: -53, z: -7, radiusX: 12, radiusZ: 9, weight: 0.8, tier: 'near' },
  { x: 51, z: 9, radiusX: 11, radiusZ: 8, weight: 1.05, tier: 'near' },
  { x: -39, z: 35, radiusX: 10, radiusZ: 8, weight: 1.35, tier: 'near' },
  { x: 39, z: 38, radiusX: 13, radiusZ: 9, weight: 0.75, tier: 'near' },
  { x: -74, z: -38, radiusX: 16, radiusZ: 11, weight: 1.5, tier: 'near' },
  { x: 74, z: -46, radiusX: 15, radiusZ: 12, weight: 0.9, tier: 'near' },
  { x: -73, z: 37, radiusX: 14, radiusZ: 10, weight: 0.7, tier: 'near' },
  { x: 75, z: 35, radiusX: 16, radiusZ: 12, weight: 1.3, tier: 'near' },
  { x: -38, z: -78, radiusX: 17, radiusZ: 14, weight: 1.5, tier: 'middle' },
  { x: 37, z: -86, radiusX: 19, radiusZ: 15, weight: 0.8, tier: 'middle' },
  { x: -85, z: -69, radiusX: 17, radiusZ: 15, weight: 1.15, tier: 'middle' },
  { x: 88, z: -65, radiusX: 18, radiusZ: 14, weight: 1.4, tier: 'middle' },
  { x: -109, z: -23, radiusX: 13, radiusZ: 17, weight: 0.75, tier: 'middle' },
  { x: 108, z: 21, radiusX: 14, radiusZ: 18, weight: 1.2, tier: 'middle' },
  { x: -69, z: 86, radiusX: 17, radiusZ: 18, weight: 1.45, tier: 'middle' },
  { x: 72, z: 91, radiusX: 18, radiusZ: 18, weight: 0.85, tier: 'middle' },
  { x: 7, z: 111, radiusX: 21, radiusZ: 11, weight: 1.1, tier: 'middle' },
  { x: -8, z: -113, radiusX: 22, radiusZ: 10, weight: 0.65, tier: 'middle' },
] as const satisfies ReadonlyArray<EcologyPatch>

const ROCK_PATCHES = [
  { x: -29, z: -37, radiusX: 7, radiusZ: 5, weight: 1.4, tier: 'near' },
  { x: 38, z: -28, radiusX: 8, radiusZ: 6, weight: 0.8, tier: 'near' },
  { x: -58, z: 17, radiusX: 10, radiusZ: 7, weight: 1.1, tier: 'near' },
  { x: 63, z: 28, radiusX: 11, radiusZ: 8, weight: 1.55, tier: 'near' },
  { x: -82, z: -44, radiusX: 12, radiusZ: 9, weight: 0.7, tier: 'near' },
  { x: 83, z: -48, radiusX: 12, radiusZ: 8, weight: 1.25, tier: 'near' },
  { x: -48, z: -86, radiusX: 14, radiusZ: 11, weight: 1.35, tier: 'middle' },
  { x: 57, z: -94, radiusX: 14, radiusZ: 12, weight: 0.75, tier: 'middle' },
  { x: -100, z: 12, radiusX: 12, radiusZ: 14, weight: 1.05, tier: 'middle' },
  { x: 101, z: 5, radiusX: 13, radiusZ: 14, weight: 1.45, tier: 'middle' },
  { x: -65, z: 91, radiusX: 14, radiusZ: 13, weight: 0.7, tier: 'middle' },
  { x: 71, z: 87, radiusX: 15, radiusZ: 13, weight: 1.2, tier: 'middle' },
] as const satisfies ReadonlyArray<EcologyPatch>

const WOODY_PATCHES = [
  { x: -35, z: 29, radiusX: 6, radiusZ: 5, weight: 1.5, tier: 'near' },
  { x: 42, z: -39, radiusX: 7, radiusZ: 5, weight: 0.85, tier: 'near' },
  { x: -67, z: -31, radiusX: 9, radiusZ: 7, weight: 1.2, tier: 'near' },
  { x: 70, z: 32, radiusX: 9, radiusZ: 7, weight: 0.7, tier: 'near' },
  { x: -46, z: -85, radiusX: 10, radiusZ: 8, weight: 1.35, tier: 'middle' },
  { x: 59, z: -94, radiusX: 10, radiusZ: 9, weight: 0.8, tier: 'middle' },
  { x: -88, z: 62, radiusX: 10, radiusZ: 8, weight: 1.15, tier: 'middle' },
  { x: 91, z: 64, radiusX: 11, radiusZ: 9, weight: 1.45, tier: 'middle' },
] as const satisfies ReadonlyArray<EcologyPatch>

const TEMPLATE_NAMES = {
  branch: {
    near: ['dry_branch_a_lod0', 'dry_branch_b_lod0', 'dry_branch_c_lod0'],
    middle: ['dry_branch_a_lod1', 'dry_branch_b_lod1', 'dry_branch_c_lod1'],
  },
  fern: {
    near: ['fern_02_a_lod0', 'fern_02_b_lod0', 'fern_02_c_lod0', 'fern_02_d_lod0'],
    middle: ['fern_02_a_lod1', 'fern_02_b_lod1', 'fern_02_c_lod1', 'fern_02_d_lod1'],
  },
  litter: {
    near: ['forest_litter_a_lod0', 'forest_litter_b_lod0', 'forest_litter_c_lod0', 'forest_litter_d_lod0'],
    middle: ['forest_litter_a_lod0', 'forest_litter_b_lod0', 'forest_litter_c_lod0', 'forest_litter_d_lod0'],
  },
  log: {
    near: ['dead_tree_trunk_lod0', 'dead_tree_trunk_02_lod0'],
    middle: ['dead_tree_trunk_lod1', 'dead_tree_trunk_02_lod1'],
  },
  moss: {
    near: ['moss_01_a_lod0', 'moss_01_b_lod0', 'moss_01_c_lod0'],
    middle: ['moss_01_a_lod1', 'moss_01_b_lod1', 'moss_01_c_lod1'],
  },
  rock: {
    near: ['rock_07_lod0', 'rock_09_lod0', 'stone_01_lod0'],
    middle: ['rock_07_lod1', 'rock_09_lod1', 'stone_01_lod1'],
  },
  shrub: {
    near: ['shrub_04_a_lod0', 'shrub_04_b_lod0', 'shrub_04_c_lod0', 'shrub_04_d_lod0'],
    middle: ['shrub_04_a_lod1', 'shrub_04_b_lod1', 'shrub_04_c_lod1', 'shrub_04_d_lod1'],
  },
} as const satisfies Record<
  ScaleEncounterProductionEcologyKind,
  Record<ScaleEncounterForestPropTier, readonly string[]>
>

export const SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES = [
  ...new Set(
    Object.values(TEMPLATE_NAMES).flatMap(({ middle, near }) => [
      ...near,
      ...middle,
    ]),
  ),
] as const

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

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

function isFarEnough(
  placements: ReadonlyArray<ScaleEncounterProductionEcologyPlacement>,
  x: number,
  z: number,
  minimumSeparation: number,
): boolean {
  const minimumSquared = minimumSeparation * minimumSeparation
  return placements.every((placement) => {
    const dx = x - placement.x
    const dz = z - placement.z
    return dx * dx + dz * dz >= minimumSquared
  })
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

function isOutsideSubjectFootprints(
  kind: ScaleEncounterProductionEcologyKind,
  x: number,
  z: number,
): boolean {
  // Reviewed T. rex presentation footprint, intentionally broader than the
  // visible feet so low decals never slide beneath the body in an idle pose.
  const outsideAnimal = ((x - 2.2) / 8.6) ** 2 + (z / 3.7) ** 2 >= 1
  // The child moves along this full 6.5–18 m observation rail. Keep a 2.2 m
  // capsule clear so a family never sees vegetation intersect the avatar.
  const childRailClearance = pointToHorizontalSegmentDistance(x, z, -22, -7)
  const requiredRailClearance =
    kind === 'litter' || kind === 'moss' ? 1.55 : 2.2
  return outsideAnimal && childRailClearance >= requiredRailClearance
}

function selectPatch(
  patches: ReadonlyArray<EcologyPatch>,
  random: () => number,
): { readonly index: number; readonly patch: EcologyPatch } {
  const totalWeight = patches.reduce((sum, patch) => sum + patch.weight, 0)
  let value = random() * totalWeight
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]!
    value -= patch.weight
    if (value <= 0) return { index, patch }
  }
  return { index: patches.length - 1, patch: patches.at(-1)! }
}

function scatterInPatches(
  recipe: ScatterRecipe,
): ScaleEncounterProductionEcologyPlacement[] {
  const random = createSeededRandom(recipe.seed)
  const placements: ScaleEncounterProductionEcologyPlacement[] = []

  for (let index = 0; index < recipe.count; index += 1) {
    let accepted:
      | { readonly patchId: number; readonly tier: ScaleEncounterForestPropTier; readonly x: number; readonly z: number }
      | undefined

    // One hand-reviewed ankle-height anchor breaks the former concentric
    // clearing without gambling on the seeded scatter. It sits outside the
    // animal ellipse and more than five metres from the child rail.
    if (index === 0 && recipe.forceInnerCover) {
      accepted = { patchId: 0, tier: 'near', x: -5.7, z: -5.2 }
    }

    for (let attempt = 0; !accepted && attempt < 360; attempt += 1) {
      const { index: patchId, patch } = selectPatch(recipe.patches, random)
      const angle = random() * TAU
      // Forest-floor populations form colonies with dense centres and ragged
      // margins. A high exponent preserves real gaps between those colonies;
      // blue-noise separation is only a local anti-intersection constraint.
      const clusterExponent =
        recipe.kind === 'log'
          ? 0.72
          : recipe.kind === 'rock'
            ? 1.35
            : recipe.kind === 'branch'
              ? 1.75
              : 2.28
      const radius = random() ** clusterExponent
      const x = patch.x + Math.cos(angle) * patch.radiusX * radius
      const z = patch.z + Math.sin(angle) * patch.radiusZ * radius
      const worldRadius = Math.hypot(x, z)
      const relaxedSeparation =
        attempt < 260 ? recipe.minimumSeparation : recipe.minimumSeparation * 0.62
      if (
        worldRadius < recipe.minimumRadius ||
        worldRadius > Math.min(MAXIMUM_SCATTER_RADIUS, recipe.maximumRadius) ||
        !isOutsideSubjectFootprints(recipe.kind, x, z) ||
        !isFarEnough(placements, x, z, relaxedSeparation)
      ) {
        continue
      }
      accepted = { patchId, tier: patch.tier, x, z }
      break
    }

    if (!accepted) {
      throw new Error(
        `Could not place production ecology instance ${index + 1}/${recipe.count}`,
      )
    }

    placements.push({
      aspect: round(0.72 + random() * 0.62),
      patchId: accepted.patchId,
      pitch: round((random() - 0.5) * 0.075),
      roll: round((random() - 0.5) * 0.065),
      scale: round(
        recipe.minimumScale +
          random() * (recipe.maximumScale - recipe.minimumScale),
      ),
      tier: accepted.tier,
      x: round(accepted.x),
      yaw: round(random() * TAU),
      z: round(accepted.z),
    })
  }

  return placements
}

function patchesAtTier(
  patches: ReadonlyArray<EcologyPatch>,
  tier: ScaleEncounterForestPropTier,
): EcologyPatch[] {
  return patches.filter((patch) => patch.tier === tier)
}

function createKindPlacements(
  kind: ScaleEncounterProductionEcologyKind,
  density: ScaleEncounterEcologyDensity,
): ScaleEncounterProductionEcologyPlacement[] {
  const recipes = {
    branch: {
      middle: { count: 6, maximumRadius: 102, maximumScale: 1.18, minimumRadius: 18, minimumScale: 0.68, minimumSeparation: 2.8, patches: WOODY_PATCHES, seed: 0x5ac4d93f },
      near: { count: 16, maximumRadius: 76, maximumScale: 1.28, minimumRadius: 16, minimumScale: 0.72, minimumSeparation: 2.1, patches: WOODY_PATCHES, seed: 0x1ab769e3 },
    },
    fern: {
      middle: { count: 24, maximumRadius: 92, maximumScale: 1.02, minimumRadius: 9, minimumScale: 0.48, minimumSeparation: 1.55, patches: DAMP_PATCHES, seed: 0x8ec1b754 },
      near: { count: 72, forceInnerCover: true, maximumRadius: 58, maximumScale: 1.08, minimumRadius: 4.2, minimumScale: 0.5, minimumSeparation: 1.02, patches: DAMP_PATCHES, seed: 0xd1c4086b },
    },
    litter: {
      middle: { count: 55, maximumRadius: 122, maximumScale: 1.7, minimumRadius: 5.8, minimumScale: 0.85, minimumSeparation: 2.45, patches: DAMP_PATCHES, seed: 0x34e015af },
      near: { count: 100, maximumRadius: 52, maximumScale: 1.85, minimumRadius: 3.2, minimumScale: 0.9, minimumSeparation: 1.85, patches: DAMP_PATCHES, seed: 0x87b2ac61 },
    },
    log: {
      middle: { count: 4, maximumRadius: 112, maximumScale: 1.2, minimumRadius: 25, minimumScale: 0.78, minimumSeparation: 17, patches: WOODY_PATCHES, seed: 0xb1852c79 },
      near: { count: 7, maximumRadius: 82, maximumScale: 1.34, minimumRadius: 25, minimumScale: 0.82, minimumSeparation: 10, patches: WOODY_PATCHES, seed: 0x29c47be1 },
    },
    moss: {
      middle: { count: 42, maximumRadius: 122, maximumScale: 1.55, minimumRadius: 5.8, minimumScale: 0.72, minimumSeparation: 2.2, patches: [...DAMP_PATCHES, ...ROCK_PATCHES], seed: 0xc8d2791f },
      near: { count: 90, maximumRadius: 54, maximumScale: 1.75, minimumRadius: 3.4, minimumScale: 0.78, minimumSeparation: 1.5, patches: [...DAMP_PATCHES, ...ROCK_PATCHES], seed: 0x3b964a21 },
    },
    rock: {
      middle: { count: 16, maximumRadius: 110, maximumScale: 1.32, minimumRadius: 24, minimumScale: 0.64, minimumSeparation: 5.2, patches: ROCK_PATCHES, seed: 0x43a9d65f },
      near: { count: 36, maximumRadius: 84, maximumScale: 1.48, minimumRadius: 20, minimumScale: 0.68, minimumSeparation: 2.8, patches: ROCK_PATCHES, seed: 0x731af802 },
    },
    shrub: {
      middle: { count: 14, maximumRadius: 92, maximumScale: 1.08, minimumRadius: 18, minimumScale: 0.58, minimumSeparation: 4.4, patches: DAMP_PATCHES, seed: 0x7d6e0fb5 },
      near: { count: 22, maximumRadius: 68, maximumScale: 1.12, minimumRadius: 13, minimumScale: 0.58, minimumSeparation: 3.1, patches: DAMP_PATCHES, seed: 0x49f8d721 },
    },
  } as const satisfies Record<
    ScaleEncounterProductionEcologyKind,
    Record<
      ScaleEncounterForestPropTier,
      Omit<ScatterRecipe, 'kind' | 'patches'> & {
        readonly patches: ReadonlyArray<EcologyPatch>
      }
    >
  >
  const recipe = recipes[kind]
  // Most of the requested near-field increase is supplied by the inexpensive
  // ground-detail, litter, humus and root batches. Scaling the atlas-backed
  // fern batch at the global ratio raised triangle cost without making the
  // clearing read materially denser. Keep those larger silhouettes on a
  // smaller budget while the total environment still lands at 1.25x/1.5x.
  const multiplier =
    kind === 'rock'
      ? 1
      : kind === 'litter' || kind === 'moss'
        ? scaleEncounterEcologyDensityMultiplier(density)
        : density === '1.25x'
          ? 1.05
          : density === '1.5x'
            ? 1.18
            : 1
  const scaledCount = (count: number) => Math.round(count * multiplier)
  return [
    ...scatterInPatches({
      ...recipe.near,
      count: scaledCount(recipe.near.count),
      kind,
      minimumSeparation:
        recipe.near.minimumSeparation / Math.sqrt(multiplier),
      patches: patchesAtTier(recipe.near.patches, 'near'),
    }),
    ...scatterInPatches({
      ...recipe.middle,
      count: scaledCount(recipe.middle.count),
      kind,
      minimumSeparation:
        recipe.middle.minimumSeparation / Math.sqrt(multiplier),
      patches: patchesAtTier(recipe.middle.patches, 'middle'),
    }),
  ]
}

export function createScaleEncounterProductionForestScatter(
  density: ScaleEncounterEcologyDensity = 'current',
): ScaleEncounterProductionEcologyScatter {
  const batchMap = new Map<string, ScaleEncounterProductionEcologyBatch>()
  const counts = {
    branch: 0,
    fern: 0,
    litter: 0,
    log: 0,
    moss: 0,
    rock: 0,
    shrub: 0,
  } satisfies Record<ScaleEncounterProductionEcologyKind, number>

  for (const kind of Object.keys(counts) as ScaleEncounterProductionEcologyKind[]) {
    const placements = createKindPlacements(kind, density)
    counts[kind] = placements.length
    for (const [index, placement] of placements.entries()) {
      const templates = TEMPLATE_NAMES[kind][placement.tier]
      // The coprime stride guarantees use of every authored silhouette while
      // keeping adjacent colony members from cycling through an obvious order.
      const templateName = templates[(index * 5 + placement.patchId * 3) % templates.length]!
      const key = `${kind}:${templateName}`
      const batch = batchMap.get(key)
      if (batch) {
        ;(batch.placements as ScaleEncounterProductionEcologyPlacement[]).push(
          placement,
        )
      } else {
        batchMap.set(key, { kind, placements: [placement], templateName })
      }
    }
  }

  const templateOrder = new Map<string, number>(
    SCALE_ENCOUNTER_PRODUCTION_ECOLOGY_TEMPLATE_NAMES.map((name, index) => [
      name,
      index,
    ]),
  )
  return {
    batches: [...batchMap.values()].sort(
      (left, right) =>
        templateOrder.get(left.templateName)! -
        templateOrder.get(right.templateName)!,
    ),
    counts,
  }
}
