// PROTOTYPE — compare a sparse ground slice with a genuinely inhabited hybrid
// forest, while keeping the reviewed child/animal clearing untouched.

export type ScaleEncounterForestScatterVariant =
  | 'ground-slice'
  | 'hybrid-slice'

export type ScaleEncounterForestPropTier = 'near' | 'middle'

export interface ScaleEncounterForestPropPlacement {
  readonly aspect: number
  readonly pitch: number
  readonly roll: number
  readonly scale: number
  readonly tier: ScaleEncounterForestPropTier
  readonly x: number
  readonly yaw: number
  readonly z: number
}

export interface ScaleEncounterForestScatter {
  readonly ferns: ReadonlyArray<ScaleEncounterForestPropPlacement>
  readonly logs: ReadonlyArray<ScaleEncounterForestPropPlacement>
  readonly rocks: ReadonlyArray<ScaleEncounterForestPropPlacement>
}

interface ScatterCluster {
  readonly radiusX: number
  readonly radiusZ: number
  readonly x: number
  readonly z: number
}

interface ScatterRecipe {
  readonly clusters: ReadonlyArray<ScatterCluster>
  readonly count: number
  readonly maximumScale: number
  readonly minimumRadius: number
  readonly minimumScale: number
  readonly minimumSeparation: number
  readonly seed: number
  readonly tier: ScaleEncounterForestPropTier
}

const TAU = Math.PI * 2

// These are landscape composition anchors, not a grid. Negative z receives a
// slight bias because it is the middle distance in the overview camera, while
// the side/rear groups keep the orbit and child-eye views from becoming bare.
const NEAR_CLUSTERS = [
  { x: -25, z: -25, radiusX: 8, radiusZ: 6 },
  { x: 25, z: -28, radiusX: 9, radiusZ: 7 },
  { x: -49, z: -43, radiusX: 16, radiusZ: 12 },
  { x: 49, z: -49, radiusX: 17, radiusZ: 13 },
  { x: -78, z: -27, radiusX: 18, radiusZ: 14 },
  { x: 79, z: -30, radiusX: 19, radiusZ: 15 },
  { x: -31, z: 21, radiusX: 8, radiusZ: 5 },
  { x: 32, z: 19, radiusX: 8, radiusZ: 5 },
] as const satisfies ReadonlyArray<ScatterCluster>

const MIDDLE_CLUSTERS = [
  { x: -76, z: -68, radiusX: 23, radiusZ: 18 },
  { x: 72, z: -82, radiusX: 24, radiusZ: 20 },
  { x: -31, z: -103, radiusX: 22, radiusZ: 23 },
  { x: 34, z: -121, radiusX: 25, radiusZ: 22 },
  { x: -104, z: -49, radiusX: 25, radiusZ: 20 },
  { x: 102, z: -51, radiusX: 24, radiusZ: 21 },
  { x: -92, z: 36, radiusX: 23, radiusZ: 20 },
  { x: 94, z: 39, radiusX: 23, radiusZ: 20 },
  { x: -47, z: 91, radiusX: 21, radiusZ: 22 },
  { x: 51, z: 99, radiusX: 22, radiusZ: 24 },
] as const satisfies ReadonlyArray<ScatterCluster>

const NEAR_LOG_CLUSTERS = [
  { x: -31, z: 22, radiusX: 4, radiusZ: 3 },
  { x: 35, z: -27, radiusX: 5, radiusZ: 4 },
  { x: -64, z: 43, radiusX: 7, radiusZ: 7 },
] as const satisfies ReadonlyArray<ScatterCluster>

const MIDDLE_LOG_CLUSTERS = [
  { x: -76, z: -84, radiusX: 10, radiusZ: 8 },
  { x: 71, z: -101, radiusX: 10, radiusZ: 9 },
  { x: 96, z: 42, radiusX: 9, radiusZ: 8 },
] as const satisfies ReadonlyArray<ScatterCluster>

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
  placements: ReadonlyArray<ScaleEncounterForestPropPlacement>,
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

function scatter(recipe: ScatterRecipe): ScaleEncounterForestPropPlacement[] {
  const random = createSeededRandom(recipe.seed)
  const placements: ScaleEncounterForestPropPlacement[] = []

  for (let index = 0; index < recipe.count; index += 1) {
    const cluster = recipe.clusters[index % recipe.clusters.length]!
    let x = cluster.x
    let z = cluster.z

    // Concentrating samples toward each anchor makes recognisable plant/stone
    // communities. Rejection only prevents obvious mesh interpenetration; it
    // does not regularise them into evenly spaced points.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = random() * TAU
      const clusteredRadius = random() ** 1.55
      const candidateX =
        cluster.x + Math.cos(angle) * cluster.radiusX * clusteredRadius
      const candidateZ =
        cluster.z + Math.sin(angle) * cluster.radiusZ * clusteredRadius
      if (Math.hypot(candidateX, candidateZ) < recipe.minimumRadius) continue
      if (
        !isFarEnough(
          placements,
          candidateX,
          candidateZ,
          recipe.minimumSeparation,
        )
      ) {
        continue
      }
      x = candidateX
      z = candidateZ
      break
    }

    placements.push({
      aspect: round(0.84 + random() * 0.34),
      pitch: round((random() - 0.5) * 0.14),
      roll: round((random() - 0.5) * 0.12),
      scale: round(
        recipe.minimumScale +
          random() * (recipe.maximumScale - recipe.minimumScale),
      ),
      tier: recipe.tier,
      x: round(x),
      yaw: round(random() * TAU),
      z: round(z),
    })
  }

  return placements
}

function createNearScatter(): ScaleEncounterForestScatter {
  return {
    ferns: scatter({
      clusters: NEAR_CLUSTERS,
      count: 39,
      maximumScale: 1.72,
      minimumRadius: 23.5,
      minimumScale: 0.84,
      minimumSeparation: 1.05,
      seed: 0x8af31d21,
      tier: 'near',
    }),
    logs: scatter({
      clusters: NEAR_LOG_CLUSTERS,
      count: 3,
      maximumScale: 1.22,
      minimumRadius: 27,
      minimumScale: 0.9,
      minimumSeparation: 13,
      seed: 0x2b86e1c9,
      tier: 'near',
    }),
    rocks: scatter({
      clusters: NEAR_CLUSTERS,
      count: 12,
      maximumScale: 1.72,
      minimumRadius: 24.5,
      minimumScale: 0.72,
      minimumSeparation: 3.5,
      seed: 0x47c2f93b,
      tier: 'near',
    }),
  }
}

function createMiddleScatter(): ScaleEncounterForestScatter {
  return {
    ferns: scatter({
      clusters: MIDDLE_CLUSTERS,
      count: 39,
      maximumScale: 1.96,
      minimumRadius: 62,
      minimumScale: 0.92,
      minimumSeparation: 1.25,
      seed: 0x65df30a7,
      tier: 'middle',
    }),
    logs: scatter({
      clusters: MIDDLE_LOG_CLUSTERS,
      count: 3,
      maximumScale: 1.36,
      minimumRadius: 66,
      minimumScale: 0.96,
      minimumSeparation: 18,
      seed: 0x9d3aef41,
      tier: 'middle',
    }),
    rocks: scatter({
      clusters: MIDDLE_CLUSTERS,
      count: 12,
      maximumScale: 1.72,
      minimumRadius: 64,
      minimumScale: 0.78,
      minimumSeparation: 5.5,
      seed: 0xc1468b53,
      tier: 'middle',
    }),
  }
}

export function createScaleEncounterForestScatter(
  variant: ScaleEncounterForestScatterVariant,
): ScaleEncounterForestScatter {
  const near = createNearScatter()
  if (variant === 'ground-slice') return near

  const middle = createMiddleScatter()
  return {
    ferns: [...near.ferns, ...middle.ferns],
    logs: [...near.logs, ...middle.logs],
    rocks: [...near.rocks, ...middle.rocks],
  }
}
