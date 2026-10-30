import { MathUtils } from 'three'
import { SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND, type ScaleEncounterDefinition } from './scale-encounter'

type AirHeadAxis = '+x' | '-x' | '+z'

// Anatomical forward, verified from source meshes/rigs rather than their
// measurement axes. Those axes belong to reference-pose calibration only.
// A future animal needs its own inspection before inclusion in this table.
const AIR_HEAD_AXES: Readonly<Record<string, AirHeadAxis>> = {
  pteranodon: '+z',
  rhamphorhynchus: '-x',
  tupandactylus: '-x',
  sordes: '+x',
  anurognathus: '+x',
  quetzalcoatlus: '+x',
}

export function scaleEncounterAirHeadAxisFor(animalId: string): AirHeadAxis | null {
  return AIR_HEAD_AXES[animalId] ?? null
}

/** Face the +Z child rail; camera layout alone maps this down or left. */
export function scaleEncounterAirPresentationYawRadians(animalId: string): number | null {
  const axis = scaleEncounterAirHeadAxisFor(animalId)
  if (axis === '+x') return -Math.PI / 2
  if (axis === '-x') return Math.PI / 2
  return axis === '+z' ? 0 : null
}

export function scaleEncounterOrbitAngularSpeedRadiansPerSecond(
  definition: Pick<ScaleEncounterDefinition, 'habitat' | 'maximumDistance'>,
  horizontalRadius: number,
  boostMultiplier: number,
): number {
  if (definition.habitat === 'air') {
    // Dividing a fixed 4m/s by the current radius made close encounters turn
    // almost 200deg/s. One cadence covers the complete legal distance range,
    // retaining both a 20deg/s comfort cap and a 4m/s far-edge travel cap.
    return Math.min(MathUtils.degToRad(20), 4 / Math.max(definition.maximumDistance, .001)) * boostMultiplier
  }
  const travelSpeed = definition.habitat === 'water'
    ? 1.2 : SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND
  return travelSpeed / Math.max(horizontalRadius, .001) * boostMultiplier
}
