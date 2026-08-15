import { Color } from 'three'
import {
  SCALE_ENCOUNTER_PRODUCTION_CLEARING_RADIUS_METERS,
  SCALE_ENCOUNTER_PRODUCTION_MICRO_RELIEF_MAXIMUM_METERS,
  SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS,
  createScaleEncounterProductionMiddleDistance,
  createScaleEncounterProductionTerrainGeometry,
  scaleEncounterProductionTerrainAngularSegmentsForRadius,
  scaleEncounterProductionTerrainHeight,
  scaleEncounterProductionTerrainHeightAtWorld,
} from '../src/viewer/scale-encounter-production-terrain'

describe('scale encounter production terrain', () => {
  it('keeps feet and child rail stable without exposing a flat circular stage', () => {
    const baseHeight = scaleEncounterProductionTerrainHeight(0, 0)
    for (const [x, y] of [
      [2.2, 0],
      [0, 0],
      [4, 0],
      [-15, 0],
      [-10, 0],
    ] as const) {
      expect(
        Math.abs(scaleEncounterProductionTerrainHeight(x, y) - baseHeight),
      ).toBeLessThan(0.008)
    }

    const clearingSamples: number[] = []
    for (let radius = 6; radius <= SCALE_ENCOUNTER_PRODUCTION_CLEARING_RADIUS_METERS; radius += 1) {
      for (let index = 0; index < 24; index += 1) {
        const angle = (index / 24) * Math.PI * 2
        clearingSamples.push(
          scaleEncounterProductionTerrainHeight(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
          ),
        )
      }
    }
    expect(Math.max(...clearingSamples) - Math.min(...clearingSamples)).toBeGreaterThan(
      0.035,
    )
    expect(
      Math.max(...clearingSamples.map((height) => Math.abs(height - baseHeight))),
    ).toBeLessThan(
      SCALE_ENCOUNTER_PRODUCTION_MICRO_RELIEF_MAXIMUM_METERS + 0.05,
    )
  })

  it('keeps world Z to local Y conversion explicit and correctly signed', () => {
    const worldX = 61.25
    const worldZ = -104.75
    expect(
      scaleEncounterProductionTerrainHeightAtWorld(worldX, worldZ),
    ).toBeCloseTo(
      scaleEncounterProductionTerrainHeight(worldX, -worldZ) +
        SCALE_ENCOUNTER_PRODUCTION_TERRAIN_WORLD_Y_METERS,
      12,
    )
    expect(
      Math.abs(
        scaleEncounterProductionTerrainHeight(worldX, worldZ) -
          scaleEncounterProductionTerrainHeight(worldX, -worldZ),
      ),
    ).toBeGreaterThan(0.05)
  })

  it('places the child and animal clearing on the canonical world support plane', () => {
    for (const [x, z] of [
      [2.2, 0],
      [-12, 0],
      [-18, 0],
    ] as const) {
      expect(scaleEncounterProductionTerrainHeightAtWorld(x, z)).toBeCloseTo(
        0,
        2,
      )
    }
  })

  it('builds a staggered terrain without aligned radial spokes or coarse outer rings', () => {
    const geometry = createScaleEncounterProductionTerrainGeometry()
    const positions = geometry.getAttribute('position')
    expect(positions.count).toBeLessThanOrEqual(11_000)
    expect(scaleEncounterProductionTerrainAngularSegmentsForRadius(55)).toBe(288)
    expect(scaleEncounterProductionTerrainAngularSegmentsForRadius(120)).toBe(216)
    expect(scaleEncounterProductionTerrainAngularSegmentsForRadius(240)).toBe(144)
    expect(geometry.index?.count).toBeGreaterThan(positions.count * 5)
    geometry.dispose()
  })

  it('uses one continuous terrain surface instead of detached green horizon strips', () => {
    const middleDistance = createScaleEncounterProductionMiddleDistance()
    expect(middleDistance.children).toHaveLength(0)
    expect(
      middleDistance.userData.scaleEncounterUsesSingleOpaqueTerrain,
    ).toBe(true)
  })

  it('keeps far terrain earthy and varied instead of fading to a saturated green band', () => {
    const geometry = createScaleEncounterProductionTerrainGeometry()
    const positions = geometry.getAttribute('position')
    const colours = geometry.getAttribute('color')
    const farColours = new Set<string>()
    let redTotal = 0
    let greenTotal = 0
    let samples = 0
    let minimumNearLuminance = Number.POSITIVE_INFINITY

    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(positions.getX(index), positions.getY(index))
      const colour = new Color(
        colours.getX(index),
        colours.getY(index),
        colours.getZ(index),
      )
      if (radius < 96) {
        minimumNearLuminance = Math.min(
          minimumNearLuminance,
          colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722,
        )
      }
      if (radius < 132) continue
      redTotal += colour.r
      greenTotal += colour.g
      samples += 1
      farColours.add(
        [colour.r, colour.g, colour.b]
          .map((channel) => channel.toFixed(3))
          .join(','),
      )
    }

    expect(samples).toBeGreaterThan(500)
    expect(farColours.size).toBeGreaterThan(12)
    // Vertex tint is a subtle ecological modifier, not a second dark albedo.
    // Keeping it above this floor prevents multiplicative black-carpet crush.
    expect(minimumNearLuminance).toBeGreaterThan(0.72)
    // Humus remains neutral/olive and restrained, never a saturated lawn.
    expect(Math.abs(redTotal - greenTotal) / samples).toBeLessThan(0.08)
    geometry.dispose()
  })
})
