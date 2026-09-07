import type { ScaleEncounterPreparedLandBiome } from './types'

/**
 * Gigantoraptor lived in the Iren Dabasu Formation. Sedimentology supports a
 * broad vegetated floodplain crossed by braided channels and temporary ponds,
 * so the encounter places a shallow reach between open banks and woodland.
 */
const GOBI_BIOME = {
  assets: {
    uniqueGroundSourceUrl: new URL('../../assets/environments/braided-sand-unique-v2.webp', import.meta.url).href,
    groundAlbedoSourceUrl: new URL(
      '../../assets/environments/surface-land-albedo-1024.webp',
      import.meta.url,
    ).href,
    groundPhysicalWidthMeters: 2,
    panoramaLowSourceUrl: new URL(
      '../../assets/environments/panorama-land-cretaceous-v5-farfield-2048.webp',
      import.meta.url,
    ).href,
    panoramaLowWidth: 2048,
    panoramaSourceUrl: new URL(
      '../../assets/environments/panorama-land-cretaceous-v5-farfield-4096.webp',
      import.meta.url,
    ).href,
    panoramaWidth: 4096,
    panoramaYawRadians: -Math.PI / 2,
    scannedPropProfile: 'river-margin',
  },
  atmosphere: {
    exposure: 1.22,
    fogFarMeters: 340,
    fogNearMeters: 110,
    hemisphereGround: '#b2aea0',
    hemisphereIntensity: 2.6,
    hemisphereSky: '#b8d7dc',
    sunIntensity: 1.9,
    sunPosition: [-72, 118, 54],
  },
  ecology: {
    calamites: 0,
    distantLandforms: 0,
    ferns: 0,
    gravel: 0,
    lycopsids: 0,
    riparianPlants: 0,
    shrubs: 112,
    treeFerns: 0,
  },
  palette: {
    fog: '#696c61',
    groundDark: '#655d41',
    groundLight: '#b5aa87',
    groundMid: '#7f7163',
    horizon: '#d3b27f',
    skyTop: '#5e9eaf',
    sun: '#ffe1a2',
    water: '#718a7e',
  },
  profile: 'gobi-braided-basin',
  revision: 'irendabas-wooded-shallow-river-v4',
  scientificBasis: [
    'https://www.sciencedirect.com/science/article/pii/S0195667105000662',
  ],
  seed: 0x6f6269,
  themeId: 'gobi',
} as const satisfies ScaleEncounterPreparedLandBiome

export default GOBI_BIOME
