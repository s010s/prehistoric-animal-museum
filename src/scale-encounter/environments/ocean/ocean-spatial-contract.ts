import { Box3, Matrix4, Vector3, type Quaternion } from 'three'

export const OCEAN_WATER_SURFACE_Y = 12.5
export const OCEAN_WATER_VOLUME_MIN_Y = -19
export const OCEAN_WORLD_RADIUS = 96
export const OCEAN_SURFACE_EXCLUSION_METERS = 0.5
export const OCEAN_SEABED_CLEARANCE_METERS = 0.65

export const OCEAN_WATER_VOLUME_BOUNDS = new Box3(
  new Vector3(
    -OCEAN_WORLD_RADIUS,
    OCEAN_WATER_VOLUME_MIN_Y,
    -OCEAN_WORLD_RADIUS,
  ),
  new Vector3(
    OCEAN_WORLD_RADIUS,
    OCEAN_WATER_SURFACE_Y,
    OCEAN_WORLD_RADIUS,
  ),
)

export type OceanStructureLayer = 'near-water' | 'mid-water' | 'far-volume'

export interface OceanGroundingSpec {
  readonly burialDepth: number
  readonly layer: OceanStructureLayer
  readonly name: string
  readonly positionXZ: readonly [number, number]
  readonly rotation: Readonly<Quaternion>
  readonly scale: Readonly<Vector3>
}

export interface OceanGroundedPlacement {
  readonly burialDepth: number
  readonly groundingError: number
  readonly layer: OceanStructureLayer
  readonly matrix: Matrix4
  readonly name: string
  readonly targetBedY: number
  readonly worldBottomY: number
  readonly worldBounds: Box3
}

export interface OceanCameraSample {
  readonly label: string
  readonly position: Readonly<Vector3>
}

export interface OceanObservationContext {
  readonly animalBounds: Readonly<Box3>
  readonly avatarBounds: Readonly<Box3>
  readonly cameraSamples: readonly OceanCameraSample[]
}

export interface OceanSpatialDiagnostics {
  readonly cameraSweepBounds: SerializedBox3
  readonly cameraViolations: readonly OceanBoundaryViolation[]
  readonly corridorOverlapCount: number
  readonly corridorOverlaps: readonly {
    readonly corridor: string
    readonly object: string
  }[]
  readonly hiddenSeabedBoundary: {
    readonly clearanceMeters: number
    readonly maximumY: number
    readonly minimumY: number
    readonly visibleInCandidate: boolean
  }
  readonly objectGrounding: readonly {
    readonly burialDepth: number
    readonly groundingError: number
    readonly layer: OceanStructureLayer
    readonly name: string
    readonly targetBedY: number
    readonly worldBottomY: number
  }[]
  readonly subjectViolations: readonly OceanBoundaryViolation[]
  readonly waterSurface: {
    readonly exclusionMeters: number
    readonly worldY: number
  }
  readonly waterVolume: SerializedBox3
}

export interface SerializedBox3 {
  readonly maximum: readonly [number, number, number]
  readonly minimum: readonly [number, number, number]
}

export interface OceanBoundaryViolation {
  readonly boundary: 'seabed' | 'surface' | 'volume-xz'
  readonly clearanceMeters: number
  readonly label: string
}

/**
 * Candidate-only seafloor contract. It is intentionally low-frequency and
 * carries no palaeoecological claim. The latest task asks B/C to expose this
 * surface, while the older handoff still records a hidden-bed decision; the
 * integration report keeps that conflict open for the main window.
 */
export function oceanBedYAt(x: number, z: number): number {
  const broad = Math.sin(x * 0.041 + z * 0.017) * 0.72
  const crossing = Math.cos(z * 0.052 - x * 0.013) * 0.46
  const shelf = Math.sin((x + z) * 0.019) * 0.31
  return -15.35 + broad + crossing + shelf
}

export function createOceanGroundedPlacement(
  localBounds: Readonly<Box3>,
  spec: OceanGroundingSpec,
): OceanGroundedPlacement {
  if (localBounds.isEmpty()) {
    throw new RangeError(`ocean-grounding-empty-bounds:${spec.name}`)
  }
  const [x, z] = spec.positionXZ
  const targetBedY = oceanBedYAt(x, z)
  const matrix = new Matrix4().compose(
    new Vector3(x, 0, z),
    spec.rotation,
    spec.scale,
  )
  const zeroHeightBounds = localBounds.clone().applyMatrix4(matrix)
  const y = targetBedY - spec.burialDepth - zeroHeightBounds.min.y
  matrix.setPosition(x, y, z)
  const worldBounds = localBounds.clone().applyMatrix4(matrix)
  const worldBottomY = worldBounds.min.y
  const groundingError =
    worldBottomY - (targetBedY - spec.burialDepth)
  return {
    burialDepth: spec.burialDepth,
    groundingError,
    layer: spec.layer,
    matrix,
    name: spec.name,
    targetBedY,
    worldBottomY,
    worldBounds,
  }
}

export function serializeOceanBox3(box: Readonly<Box3>): SerializedBox3 {
  return {
    maximum: box.max.toArray(),
    minimum: box.min.toArray(),
  }
}

function boundaryViolationsForPoint(
  label: string,
  point: Readonly<Vector3>,
): OceanBoundaryViolation[] {
  const violations: OceanBoundaryViolation[] = []
  const surfaceClearance = OCEAN_WATER_SURFACE_Y - point.y
  if (surfaceClearance < OCEAN_SURFACE_EXCLUSION_METERS) {
    violations.push({
      boundary: 'surface',
      clearanceMeters: surfaceClearance,
      label,
    })
  }
  const bedClearance = point.y - oceanBedYAt(point.x, point.z)
  if (bedClearance < OCEAN_SEABED_CLEARANCE_METERS) {
    violations.push({
      boundary: 'seabed',
      clearanceMeters: bedClearance,
      label,
    })
  }
  const horizontalClearance = Math.min(
    OCEAN_WORLD_RADIUS - Math.abs(point.x),
    OCEAN_WORLD_RADIUS - Math.abs(point.z),
  )
  if (horizontalClearance < 0) {
    violations.push({
      boundary: 'volume-xz',
      clearanceMeters: horizontalClearance,
      label,
    })
  }
  return violations
}

function boundaryViolationsForBounds(
  label: string,
  bounds: Readonly<Box3>,
): OceanBoundaryViolation[] {
  const centre = bounds.getCenter(new Vector3())
  const violations: OceanBoundaryViolation[] = []
  const surfaceClearance = OCEAN_WATER_SURFACE_Y - bounds.max.y
  if (surfaceClearance < OCEAN_SURFACE_EXCLUSION_METERS) {
    violations.push({
      boundary: 'surface',
      clearanceMeters: surfaceClearance,
      label,
    })
  }
  const bedClearance = bounds.min.y - oceanBedYAt(centre.x, centre.z)
  if (bedClearance < OCEAN_SEABED_CLEARANCE_METERS) {
    violations.push({
      boundary: 'seabed',
      clearanceMeters: bedClearance,
      label,
    })
  }
  const horizontalClearance = Math.min(
    OCEAN_WORLD_RADIUS - Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    OCEAN_WORLD_RADIUS - Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
  )
  if (horizontalClearance < 0) {
    violations.push({
      boundary: 'volume-xz',
      clearanceMeters: horizontalClearance,
      label,
    })
  }
  return violations
}

function expandedBounds(bounds: Readonly<Box3>, amount: number): Box3 {
  return bounds.clone().expandByScalar(amount)
}

export function diagnoseOceanSpatialContract(
  context: OceanObservationContext,
  groundedObjects: readonly OceanGroundedPlacement[],
  visibleSeabed: boolean,
): OceanSpatialDiagnostics {
  const cameraSweepBounds = new Box3()
  const cameraCorridors = context.cameraSamples.map(({ label, position }) => {
    cameraSweepBounds.expandByPoint(position)
    return {
      bounds: new Box3().setFromCenterAndSize(
        position,
        new Vector3(0.8, 0.8, 0.8),
      ),
      label: `camera:${label}`,
    }
  })
  if (cameraSweepBounds.isEmpty()) {
    cameraSweepBounds.copy(context.avatarBounds)
  }
  const protectedCorridors = [
    {
      bounds: expandedBounds(context.animalBounds, 0.8),
      label: 'subject:mosasaurus',
    },
    {
      bounds: expandedBounds(context.avatarBounds, 0.45),
      label: 'subject:avatar-base',
    },
    ...cameraCorridors,
  ]
  const corridorOverlaps = groundedObjects.flatMap((object) =>
    protectedCorridors
      .filter(({ bounds }) => bounds.intersectsBox(object.worldBounds))
      .map(({ label }) => ({ corridor: label, object: object.name })),
  )
  const bedSamples: number[] = []
  for (let x = -OCEAN_WORLD_RADIUS; x <= OCEAN_WORLD_RADIUS; x += 8) {
    for (let z = -OCEAN_WORLD_RADIUS; z <= OCEAN_WORLD_RADIUS; z += 8) {
      bedSamples.push(oceanBedYAt(x, z))
    }
  }
  return {
    cameraSweepBounds: serializeOceanBox3(cameraSweepBounds),
    cameraViolations: context.cameraSamples.flatMap(({ label, position }) =>
      boundaryViolationsForPoint(label, position),
    ),
    corridorOverlapCount: corridorOverlaps.length,
    corridorOverlaps,
    hiddenSeabedBoundary: {
      clearanceMeters: OCEAN_SEABED_CLEARANCE_METERS,
      maximumY: Math.max(...bedSamples),
      minimumY: Math.min(...bedSamples),
      visibleInCandidate: visibleSeabed,
    },
    objectGrounding: groundedObjects.map((object) => ({
      burialDepth: object.burialDepth,
      groundingError: object.groundingError,
      layer: object.layer,
      name: object.name,
      targetBedY: object.targetBedY,
      worldBottomY: object.worldBottomY,
    })),
    subjectViolations: [
      ...boundaryViolationsForBounds('mosasaurus', context.animalBounds),
      ...boundaryViolationsForBounds('avatar-base', context.avatarBounds),
    ],
    waterSurface: {
      exclusionMeters: OCEAN_SURFACE_EXCLUSION_METERS,
      worldY: OCEAN_WATER_SURFACE_Y,
    },
    waterVolume: serializeOceanBox3(OCEAN_WATER_VOLUME_BOUNDS),
  }
}
