import type { ScaleEncounterPreparedLandBiome } from './types'

/** Kayenta-style seasonal stream, overbank mud and riparian plant belts. */
const FLOODPLAIN_BIOME = {
  assets: {
    uniqueGroundSourceUrl: new URL('../../assets/environments/red-silt-unique-v2.webp', import.meta.url).href,
    groundAlbedoSourceUrl: new URL(
      '../../assets/environments/surface-land-albedo-1024.webp',
      import.meta.url,
    ).href,
    groundPhysicalWidthMeters: 2,
    panoramaLowSourceUrl: new URL(
      '../../assets/environments/panorama-air-cretaceous-2048.webp',
      import.meta.url,
    ).href,
    panoramaLowWidth: 2048,
    panoramaSourceUrl: new URL(
      '../../assets/environments/panorama-air-cretaceous-4096.webp',
      import.meta.url,
    ).href,
    panoramaWidth: 4096,
    panoramaYawRadians: -Math.PI / 2,
    scannedPropProfile: 'river-margin',
  },
  atmosphere: {
    exposure: 1.18,
    fogFarMeters: 380,
    fogNearMeters: 130,
    hemisphereGround: '#9c998c',
    hemisphereIntensity: 2.65,
    hemisphereSky: '#a8c9d0',
    sunIntensity: 1.8,
    sunPosition: [-58, 104, 82],
  },
  ecology: {
    calamites: 0,
    distantLandforms: 0,
    ferns: 70,
    gravel: 330,
    lycopsids: 0,
    riparianPlants: 0,
    shrubs: 46,
    treeFerns: 0,
  },
  palette: {
    fog: '#b9b8ac',
    groundDark: '#633b2d',
    groundLight: '#bd8053',
    groundMid: '#8d5038',
    horizon: '#d6ad82',
    skyTop: '#659bae',
    sun: '#ffd8a0',
    water: '#789892',
  },
  profile: 'kayenta-seasonal-floodplain',
  revision: 'kayenta-sky-and-world-space-river-v5',
  scientificBasis: [
    'https://www.sciencedirect.com/science/article/pii/003707389390096N',
    'https://home.nps.gov/zion/learn/nature/kayenta.htm',
  ],
  seed: 0xf100d,
  themeId: 'floodplain',
} as const satisfies ScaleEncounterPreparedLandBiome

export default FLOODPLAIN_BIOME
