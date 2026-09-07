import { Texture } from 'three'
import {
  SCALE_ENCOUNTER_ENVIRONMENT_THEMES,
  scaleEncounterEnvironmentThemePlanFor,
} from '../src/scale-encounter/environment-theme-registry'
import { SCALE_ENCOUNTER_ANIMAL_IDS } from '../src/scale-encounter/types'
import {
  disposeScaleEncounterEnvironment,
  createScaleEncounterEnvironment,
} from '../src/viewer/scale-encounter-environment'
import { SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'

describe('scale encounter reusable environment theme registry', () => {
  it.each([
    'meganeura',
  ] as const)(
    'keeps %s on the forest selected by the final product review',
    (animalId) => {
      const plan = scaleEncounterEnvironmentThemePlanFor(
        animalId,
        SCALE_ENCOUNTER_DEFINITIONS[animalId].environmentTheme,
      )

      expect(plan.target).toMatchObject({
        id: 'cretaceous-forest',
        labels: { zhCN: '白垩纪森林' },
        assetStatus: 'active',
        fallbackThemeId: null,
        loadPolicy: 'selected-theme-only',
        revealPolicy: 'keep-current-scene-until-baseline-ready',
        runtimePanoramaTheme: 'land-cretaceous',
        runtimeKind: 'panorama-pbr',
      })
      expect(plan.runtime).toMatchObject({
        id: 'cretaceous-forest',
        assetStatus: 'active',
        runtimeKind: 'panorama-pbr',
        runtimePanoramaTheme: 'land-cretaceous',
      })
      expect(plan.usingCompatibilityFallback).toBe(false)
    },
  )

  it.each([
    ['gigantoraptor', 'gobi', '植被河漫平原'],
    ['dilophosaurus', 'floodplain', '季节性河谷'],
  ] as const)('uses the complete dedicated environment for %s', (animalId, themeId, label) => {
    const plan = scaleEncounterEnvironmentThemePlanFor(animalId, 'forest')
    expect(plan.target.id).toBe(themeId)
    expect(plan.runtime.labels.zhCN).toBe(label)
    expect(plan.usingCompatibilityFallback).toBe(false)
    expect(createScaleEncounterEnvironment('land', 'production-slice', new Texture(), { animalId })).toBeNull()
  })

  it('keeps the biome presets behind the same selected-theme loading contract', () => {
    for (const themeId of [
      'gobi',
      'floodplain',
      'carboniferous-wetland-forest',
    ] as const) {
      expect(SCALE_ENCOUNTER_ENVIRONMENT_THEMES[themeId]).toMatchObject({
        id: themeId,
        assetStatus: 'active',
        fallbackThemeId: 'cretaceous-forest',
        runtimeKind: 'procedural-biome',
      })
    }
  })

  it('keeps every existing animal resolvable through one reusable theme contract', () => {
    for (const animalId of SCALE_ENCOUNTER_ANIMAL_IDS) {
      const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
      const plan = scaleEncounterEnvironmentThemePlanFor(
        animalId,
        definition.environmentTheme,
      )
      expect(plan.target.rendererFamily).toBe(definition.environmentTheme)
      expect(plan.runtime.assetStatus).toBe('active')
      if (plan.runtime.runtimeKind === 'panorama-pbr') {
        expect(plan.runtime.runtimePanoramaTheme).not.toBeNull()
      } else {
        expect(plan.runtime.runtimePanoramaTheme).toBeNull()
      }
      expect(plan.target.loadPolicy).toBe('selected-theme-only')
    }
    expect(Object.keys(SCALE_ENCOUNTER_ENVIRONMENT_THEMES)).toHaveLength(7)
  })

  it('publishes the restored forest target and runtime on the scene graph', () => {
    const panorama = new Texture()
    const environment = createScaleEncounterEnvironment(
      'land',
      'production-slice',
      panorama,
      { animalId: 'meganeura' },
    )

    expect(environment?.root.userData).toMatchObject({
      scaleEncounterEnvironmentAssetStatus: 'active',
      scaleEncounterEnvironmentLoadPolicy: 'selected-theme-only',
      scaleEncounterEnvironmentRevealPolicy:
        'keep-current-scene-until-baseline-ready',
      scaleEncounterEnvironmentRuntimeTheme: 'cretaceous-forest',
      scaleEncounterEnvironmentTargetTheme: 'cretaceous-forest',
      scaleEncounterEnvironmentUsingCompatibilityFallback: false,
    })
    expect(
      environment?.root.getObjectByName(
        'scale-encounter-accepted-forested-mountain-basin',
      ),
    ).toBeTruthy()
    disposeScaleEncounterEnvironment(environment)
    panorama.dispose()
  })
})
