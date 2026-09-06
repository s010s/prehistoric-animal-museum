import type {
  ScaleEncounterAnimalId,
  ScaleEncounterEnvironmentTheme,
} from './types'

export const SCALE_ENCOUNTER_ENVIRONMENT_THEME_IDS = [
  'cretaceous-forest',
  'gobi',
  'floodplain',
  'carboniferous-wetland-forest',
  'ice-age-steppe',
  'cretaceous-sky',
  'cretaceous-ocean',
] as const

export type ScaleEncounterEnvironmentThemeId =
  (typeof SCALE_ENCOUNTER_ENVIRONMENT_THEME_IDS)[number]

export type ScaleEncounterEnvironmentBaselineAssetRole =
  | 'panorama'
  | 'procedural-ecology'
  | 'procedural-sky'
  | 'procedural-surface'
  | 'procedural-terrain'
  | 'procedural-water'
  | 'surface-albedo'
  | 'surface-normal'
  | 'surface-roughness'

export interface ScaleEncounterEnvironmentThemeDefinition {
  /** Stable domain identifier. Asset filenames may change without changing it. */
  readonly id: ScaleEncounterEnvironmentThemeId
  readonly labels: Readonly<{ readonly en: string; readonly zhCN: string }>
  /** Existing renderer family reused while a theme adds its own art package. */
  readonly rendererFamily: ScaleEncounterEnvironmentTheme
  /** Review panorama family currently safe to request at runtime. */
  readonly runtimePanoramaTheme:
    | 'land-cretaceous'
    | 'air-cretaceous'
    | 'water-cretaceous'
    | 'snow-ice-age'
    | null
  readonly runtimeKind: 'panorama-pbr' | 'procedural-biome'
  readonly assetNamespace: string
  readonly assetStatus: 'active' | 'awaiting-baseline-assets'
  readonly fallbackThemeId: ScaleEncounterEnvironmentThemeId | null
  readonly baselineAssetContract: readonly ScaleEncounterEnvironmentBaselineAssetRole[]
  readonly loadPolicy: 'selected-theme-only'
  readonly revealPolicy: 'keep-current-scene-until-baseline-ready'
}

const LAND_BASELINE_ASSET_CONTRACT = [
  'panorama',
  'surface-albedo',
  'surface-normal',
  'surface-roughness',
] as const satisfies readonly ScaleEncounterEnvironmentBaselineAssetRole[]

const PROCEDURAL_LAND_BASELINE_CONTRACT = [
  'procedural-sky',
  'procedural-terrain',
  'procedural-surface',
  'procedural-ecology',
] as const satisfies readonly ScaleEncounterEnvironmentBaselineAssetRole[]

const PROCEDURAL_WET_LAND_BASELINE_CONTRACT = [
  ...PROCEDURAL_LAND_BASELINE_CONTRACT,
  'procedural-water',
] as const satisfies readonly ScaleEncounterEnvironmentBaselineAssetRole[]

export const SCALE_ENCOUNTER_ENVIRONMENT_THEMES: Readonly<
  Record<ScaleEncounterEnvironmentThemeId, ScaleEncounterEnvironmentThemeDefinition>
> = {
  'cretaceous-forest': {
    id: 'cretaceous-forest',
    labels: { en: 'Cretaceous forest', zhCN: '白垩纪森林' },
    rendererFamily: 'forest',
    runtimePanoramaTheme: 'land-cretaceous',
    runtimeKind: 'panorama-pbr',
    assetNamespace: 'land-cretaceous',
    assetStatus: 'active',
    fallbackThemeId: null,
    baselineAssetContract: LAND_BASELINE_ASSET_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  gobi: {
    id: 'gobi',
    labels: { en: 'Vegetated river plain', zhCN: '植被河漫平原' },
    rendererFamily: 'forest',
    runtimePanoramaTheme: null,
    runtimeKind: 'procedural-biome',
    assetNamespace: 'gobi',
    assetStatus: 'active',
    fallbackThemeId: 'cretaceous-forest',
    baselineAssetContract: PROCEDURAL_WET_LAND_BASELINE_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  floodplain: {
    id: 'floodplain',
    labels: { en: 'Seasonal river valley', zhCN: '季节性河谷' },
    rendererFamily: 'forest',
    runtimePanoramaTheme: null,
    runtimeKind: 'procedural-biome',
    assetNamespace: 'floodplain',
    assetStatus: 'active',
    fallbackThemeId: 'cretaceous-forest',
    baselineAssetContract: PROCEDURAL_WET_LAND_BASELINE_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  'carboniferous-wetland-forest': {
    id: 'carboniferous-wetland-forest',
    labels: {
      en: 'Carboniferous wetland forest',
      zhCN: '石炭纪湿地森林',
    },
    rendererFamily: 'forest',
    runtimePanoramaTheme: null,
    runtimeKind: 'procedural-biome',
    assetNamespace: 'carboniferous-wetland-forest',
    assetStatus: 'active',
    fallbackThemeId: 'cretaceous-forest',
    baselineAssetContract: PROCEDURAL_WET_LAND_BASELINE_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  'ice-age-steppe': {
    id: 'ice-age-steppe',
    labels: { en: 'Ice Age steppe', zhCN: '冰期草原' },
    rendererFamily: 'glacier',
    runtimePanoramaTheme: 'snow-ice-age',
    runtimeKind: 'panorama-pbr',
    assetNamespace: 'snow-ice-age',
    assetStatus: 'active',
    fallbackThemeId: null,
    baselineAssetContract: LAND_BASELINE_ASSET_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  'cretaceous-sky': {
    id: 'cretaceous-sky',
    labels: { en: 'Cretaceous sky', zhCN: '白垩纪天空' },
    rendererFamily: 'sky',
    runtimePanoramaTheme: 'air-cretaceous',
    runtimeKind: 'panorama-pbr',
    assetNamespace: 'air-cretaceous',
    assetStatus: 'active',
    fallbackThemeId: null,
    baselineAssetContract: ['panorama'],
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
  'cretaceous-ocean': {
    id: 'cretaceous-ocean',
    labels: { en: 'Cretaceous ocean', zhCN: '白垩纪海洋' },
    rendererFamily: 'ocean',
    runtimePanoramaTheme: 'water-cretaceous',
    runtimeKind: 'panorama-pbr',
    assetNamespace: 'water-cretaceous',
    assetStatus: 'active',
    fallbackThemeId: null,
    baselineAssetContract: LAND_BASELINE_ASSET_CONTRACT,
    loadPolicy: 'selected-theme-only',
    revealPolicy: 'keep-current-scene-until-baseline-ready',
  },
}

const TARGET_THEME_OVERRIDES: Readonly<
  Partial<Record<ScaleEncounterAnimalId, ScaleEncounterEnvironmentThemeId>>
> = { gigantoraptor: 'gobi', dilophosaurus: 'floodplain' }

// The September scene revision restores two dedicated, ground-first habitats.
// The legacy gobi identifier remains stable; its label describes the evidenced
// vegetated Iren Dabasu floodplain, not the modern desert.

const DEFAULT_THEME_BY_RENDERER_FAMILY: Readonly<
  Record<ScaleEncounterEnvironmentTheme, ScaleEncounterEnvironmentThemeId>
> = {
  forest: 'cretaceous-forest',
  glacier: 'ice-age-steppe',
  ocean: 'cretaceous-ocean',
  sky: 'cretaceous-sky',
}

export interface ScaleEncounterEnvironmentThemePlan {
  readonly target: ScaleEncounterEnvironmentThemeDefinition
  /** Theme whose complete baseline can be rendered today. */
  readonly runtime: ScaleEncounterEnvironmentThemeDefinition
  readonly usingCompatibilityFallback: boolean
}

/**
 * Resolves artistic intent separately from the currently complete asset set.
 * A new biome cannot become visible until its entire baseline contract exists;
 * until then the already-reviewed environment remains on screen.
 */
export function scaleEncounterEnvironmentThemePlanFor(
  animalId: ScaleEncounterAnimalId,
  rendererFamily: ScaleEncounterEnvironmentTheme,
): ScaleEncounterEnvironmentThemePlan {
  const targetId =
    TARGET_THEME_OVERRIDES[animalId] ??
    DEFAULT_THEME_BY_RENDERER_FAMILY[rendererFamily]
  const target = SCALE_ENCOUNTER_ENVIRONMENT_THEMES[targetId]
  if (target.rendererFamily !== rendererFamily) {
    throw new Error(
      `scale-encounter-theme-family-mismatch:${animalId}:${targetId}`,
    )
  }
  if (target.assetStatus === 'active') {
    return { target, runtime: target, usingCompatibilityFallback: false }
  }
  const fallbackId = target.fallbackThemeId
  if (!fallbackId) {
    throw new Error(`scale-encounter-theme-missing-fallback:${target.id}`)
  }
  const runtime = SCALE_ENCOUNTER_ENVIRONMENT_THEMES[fallbackId]
  if (
    runtime.assetStatus !== 'active' ||
    runtime.rendererFamily !== rendererFamily ||
    runtime.runtimeKind !== 'panorama-pbr' ||
    !runtime.runtimePanoramaTheme
  ) {
    throw new Error(`scale-encounter-theme-invalid-fallback:${target.id}`)
  }
  return { target, runtime, usingCompatibilityFallback: true }
}
