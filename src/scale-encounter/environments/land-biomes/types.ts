import type { ScaleEncounterEnvironmentThemeId } from '../../environment-theme-registry'

export const SCALE_ENCOUNTER_PROCEDURAL_LAND_BIOME_THEME_IDS = [
  'gobi',
  'floodplain',
  'carboniferous-wetland-forest',
] as const satisfies readonly ScaleEncounterEnvironmentThemeId[]

export type ScaleEncounterProceduralLandBiomeThemeId =
  (typeof SCALE_ENCOUNTER_PROCEDURAL_LAND_BIOME_THEME_IDS)[number]

export type ScaleEncounterLandBiomeProfile =
  | 'gobi-braided-basin'
  | 'kayenta-seasonal-floodplain'
  | 'carboniferous-coal-swamp'

export interface ScaleEncounterLandBiomePalette {
  readonly fog: string
  readonly groundDark: string
  readonly groundLight: string
  readonly groundMid: string
  readonly horizon: string
  readonly skyTop: string
  readonly sun: string
  readonly water: string | null
}

export interface ScaleEncounterLandBiomeAtmosphere {
  readonly exposure: number
  readonly fogFarMeters: number
  readonly fogNearMeters: number
  readonly hemisphereGround: string
  readonly hemisphereIntensity: number
  readonly hemisphereSky: string
  readonly sunIntensity: number
  readonly sunPosition: readonly [number, number, number]
}

export interface ScaleEncounterLandBiomePopulation {
  readonly calamites: number
  readonly distantLandforms: number
  readonly ferns: number
  readonly gravel: number
  readonly lycopsids: number
  readonly riparianPlants: number
  readonly shrubs: number
  readonly treeFerns: number
}

export interface ScaleEncounterLandBiomeArtAssets {
  readonly groundAlbedoSourceUrl: string
  readonly uniqueGroundSourceUrl?: string
  readonly groundPhysicalWidthMeters: number
  readonly panoramaLowSourceUrl: string
  readonly panoramaLowWidth: number
  readonly panoramaSourceUrl: string
  readonly panoramaWidth: number
  readonly panoramaYawRadians: number
  /** Shared, licensed scan family; the profile controls the selected subset. */
  readonly scannedPropProfile: 'dry-basin' | 'river-margin' | 'coal-swamp-floor'
}

/**
 * Pure-data environment contract. Preset modules contain no decoded images,
 * Three.js objects or fetch side effects, so importing one exact selected
 * module is both the preparation boundary and the baseline-ready signal.
 */
export interface ScaleEncounterPreparedLandBiome {
  readonly assets: ScaleEncounterLandBiomeArtAssets
  readonly atmosphere: ScaleEncounterLandBiomeAtmosphere
  readonly ecology: ScaleEncounterLandBiomePopulation
  readonly palette: ScaleEncounterLandBiomePalette
  readonly profile: ScaleEncounterLandBiomeProfile
  readonly revision: string
  readonly scientificBasis: readonly string[]
  readonly seed: number
  readonly themeId: ScaleEncounterProceduralLandBiomeThemeId
}

export function isScaleEncounterProceduralLandBiomeThemeId(
  themeId: ScaleEncounterEnvironmentThemeId,
): themeId is ScaleEncounterProceduralLandBiomeThemeId {
  return (
    SCALE_ENCOUNTER_PROCEDURAL_LAND_BIOME_THEME_IDS as readonly ScaleEncounterEnvironmentThemeId[]
  ).includes(themeId)
}
