export const SCALE_ENCOUNTER_ECOLOGY_DENSITIES = [
  'current',
  '1.25x',
  '1.5x',
] as const

export type ScaleEncounterEcologyDensity =
  (typeof SCALE_ENCOUNTER_ECOLOGY_DENSITIES)[number]

export const DEFAULT_SCALE_ENCOUNTER_ECOLOGY_DENSITY = '1.25x' as const satisfies
  ScaleEncounterEcologyDensity

const DENSITY_MULTIPLIERS = {
  current: 1,
  '1.25x': 1.25,
  '1.5x': 1.5,
} as const satisfies Record<ScaleEncounterEcologyDensity, number>

export function scaleEncounterEcologyDensityMultiplier(
  density: ScaleEncounterEcologyDensity,
): number {
  return DENSITY_MULTIPLIERS[density]
}

export function scaleEncounterEcologyCount(
  currentCount: number,
  density: ScaleEncounterEcologyDensity,
): number {
  return Math.round(
    currentCount * scaleEncounterEcologyDensityMultiplier(density),
  )
}

export function parseScaleEncounterEcologyDensity(
  value: string | null,
): ScaleEncounterEcologyDensity {
  return SCALE_ENCOUNTER_ECOLOGY_DENSITIES.includes(
    value as ScaleEncounterEcologyDensity,
  )
    ? (value as ScaleEncounterEcologyDensity)
    : DEFAULT_SCALE_ENCOUNTER_ECOLOGY_DENSITY
}
