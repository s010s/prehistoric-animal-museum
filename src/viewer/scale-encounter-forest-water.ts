import { MathUtils } from 'three'
import type { ScaleEncounterAnimalId } from './scale-encounter'
import { scaleEncounterProductionTerrainHeightAtWorld } from './scale-encounter-production-terrain'

export const FOREST_STREAM_LEVEL_METERS = -0.12

// Reuse the forest and the same shallow bank section for habitats whose
// original art includes channels. Scale the reach to the comparison camera,
// rather than giving a half-metre animal the river of a fourteen-metre one.
const FOREST_WATER_PROFILES: Partial<Record<ScaleEncounterAnimalId, { scale: number; offsetZ?: number }>> = {
  meganeura: { scale: 1 },
  lystrosaurus: { scale: 1.15 },
  archaeopteryx: { scale: 0.85 },
  baryonyx: { scale: 2 },
  carnotaurus: { scale: 2 },
  'tyrannosaurus-rex': { scale: 2.3 },
  // The child's existing three-quarter rail is on the positive-Z bank.
  spinosaurus: { scale: 2.4, offsetZ: 8 },
}

/** Broad foreground water stays visible in a portrait overview. */
export function forestStreamCentreZ(x: number): number {
  return 7.2 + 1.5 * Math.sin(x * 0.08) + 1.2 * Math.tanh(x / 8)
}

function streamHeightAtWorld(x: number, z: number, scale: number, centreZ: number): number {
  const ground = scaleEncounterProductionTerrainHeightAtWorld(x, z)
  const localX = x / scale
  const width = scale * (4.5 + 1.2 * Math.exp(-(((localX + 4) / 8) ** 2)))
  const lateral = Math.abs(z - centreZ) / width
  const reach = 1 - MathUtils.smoothstep(Math.abs(x), 58, 82)
  const channel = (1 - MathUtils.smoothstep(lateral, 0.25, 1)) * reach
  // The same floor supports the avatar and clips the water. Maximum depth is
  // half a metre; the central animal and initial child positions stay dry.
  return MathUtils.lerp(ground, FOREST_STREAM_LEVEL_METERS - 0.5, channel)
}

export function forestWaterForAnimal(animalId: ScaleEncounterAnimalId) {
  const profile = FOREST_WATER_PROFILES[animalId]
  if (!profile) return null
  const { scale, offsetZ = 0 } = profile
  const centreZ = (x: number) => forestStreamCentreZ(x / scale) * scale + offsetZ
    // The close insect overview crops the foreground in landscape. Bring a
    // broad left-hand bend into that frame without flooding the start bank.
    - (animalId === 'meganeura' ? 8 * Math.exp(-(((x + 6.5) / 2.8) ** 2)) : 0)
  return {
    centreZ,
    heightAtWorld: (x: number, z: number) => streamHeightAtWorld(x, z, scale, centreZ(x)),
  }
}
