import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Vector3 } from 'three'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  clampScaleEncounterDistance,
  createScaleEncounterPlacement,
  normalizeScaleEncounterProfile,
  positionOnScaleEncounterRail,
  scaleEncounterElevationDegrees,
} from '../src/viewer/scale-encounter'

describe('scale encounter geometry', () => {
  it.each([
    ['tyrannosaurus-rex', 'tyrannosaurus-rex'],
    ['pteranodon', 'pteranodon'],
    ['mosasaurus', 'mosasaurus'],
    ['mammoth', 'mammoth'],
  ] as const)('invalidates the %s calibration when its reviewed GLB changes', (animalId, directory) => {
    const bytes = readFileSync(
      resolve(process.cwd(), `src/content/animals/${directory}/model/model.glb`),
    )
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      SCALE_ENCOUNTER_DEFINITIONS[animalId].calibratedModelSha256,
    )
    expect(
      SCALE_ENCOUNTER_DEFINITIONS[animalId].referenceAnimationTimeSeconds,
    ).toBe(0)
  })

  it('normalizes the only two child profile inputs', () => {
    expect(
      normalizeScaleEncounterProfile({ gender: 'girl', heightCm: 87 }),
    ).toEqual({ gender: 'girl', heightCm: 90, heightMeters: 0.9 })
    expect(
      normalizeScaleEncounterProfile({ gender: 'boy', heightCm: 128 }),
    ).toEqual({ gender: 'boy', heightCm: 130, heightMeters: 1.3 })
    expect(
      normalizeScaleEncounterProfile({ gender: 'boy', heightCm: Number.NaN }),
    ).toEqual({ gender: 'boy', heightCm: 110, heightMeters: 1.1 })
  })

  it.each([
    ['tyrannosaurus-rex', 12.5],
    ['pteranodon', 15],
    ['mosasaurus', 20],
    ['mammoth', 10],
  ] as const)('keeps the requested default distance for %s', (animalId, distance) => {
    expect(SCALE_ENCOUNTER_DEFINITIONS[animalId].defaultDistance).toBe(
      distance,
    )
  })

  it('locks body length, wingspan and adult shoulder-height calibrations to the matching axes', () => {
    expect(SCALE_ENCOUNTER_DEFINITIONS['tyrannosaurus-rex']).toMatchObject({
      displayedMeters: 12,
      measurement: 'body-length',
      measurementAxis: 'x',
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.pteranodon).toMatchObject({
      displayedMeters: 7,
      measurement: 'wingspan',
      measurementAxis: 'x',
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.mosasaurus).toMatchObject({
      displayedMeters: 12,
      measurement: 'body-length',
      measurementAxis: 'x',
    })
    expect(SCALE_ENCOUNTER_DEFINITIONS.mammoth).toMatchObject({
      displayedMeters: 3.25,
      measurement: 'shoulder-height',
      measurementAxis: 'y',
      reviewedRawSpanUnits: 1.3191838264465332,
      support: 'ground',
    })
    expect(
      SCALE_ENCOUNTER_DEFINITIONS.mammoth.displayedMeters /
        SCALE_ENCOUNTER_DEFINITIONS.mammoth.reviewedRawSpanUnits!,
    ).toBeCloseTo(2.463644516, 8)
  })

  it('places the Pteranodon and child on a genuinely eye-level rail', () => {
    const placement = createScaleEncounterPlacement(
      'pteranodon',
      new Vector3(-3.5, 3.8, -0.7),
      new Vector3(3.5, 5.8, 0.7),
      1,
    )

    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      15,
      8,
    )
    expect(
      Math.abs(
        scaleEncounterElevationDegrees(
          placement.defaultEyePosition,
          placement.target,
        ),
      ),
    ).toBeLessThanOrEqual(5)
    expect(
      Math.abs(placement.defaultEyePosition.y - placement.target.y),
    ).toBeLessThanOrEqual(0.15)
    expect(placement.observerRailDirection).toEqual(new Vector3(0, 0, 1))
  })

  it('locks the Pteranodon overview to a 70 degree top-down view with an orthogonal screen-up axis', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.pteranodon
    const direction = definition.overviewDirection.clone().normalize()
    const up = definition.overviewUp.clone().normalize()
    const elevationDegrees =
      Math.asin(direction.dot(new Vector3(0, 1, 0))) * (180 / Math.PI)
    const screenRight = up.clone().cross(direction).normalize()

    expect(elevationDegrees).toBeCloseTo(70, 8)
    expect(definition.overviewDirection.length()).toBeCloseTo(1, 10)
    expect(definition.overviewUp.length()).toBeCloseTo(1, 10)
    expect(direction.dot(up)).toBeCloseTo(0, 10)
    // The child sits on the +Z rail, so screen-right on -Z puts the child on
    // the left and the animal on the right. Their matching world-X wingspans
    // remain parallel and project mostly along the screen-up axis.
    expect(screenRight.x).toBeCloseTo(0, 10)
    expect(screenRight.y).toBeCloseTo(0, 10)
    expect(screenRight.z).toBeCloseTo(-1, 10)
    expect(Math.abs(up.dot(new Vector3(1, 0, 0)))).toBeGreaterThan(0.9)
  })

  it('keeps the grounded child on a comfortable sight line to the T. rex head', () => {
    const childEyeHeight = 0.985
    const placement = createScaleEncounterPlacement(
      'tyrannosaurus-rex',
      new Vector3(-3.8, 0, -0.8),
      new Vector3(8.2, 4, 0.8),
      childEyeHeight,
    )

    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      12.5,
      8,
    )
    expect(placement.defaultEyePosition.y).toBeCloseTo(childEyeHeight, 8)
    expect(placement.defaultEyePosition.x).toBeLessThan(placement.target.x)
    expect(placement.target.x).toBeCloseTo(-1.52, 8)
    expect(placement.target.y).toBeCloseTo(2.32, 8)
  })

  it('puts the winter-clothed child and mammoth on the same ground-facing rail', () => {
    const childEyeHeight = 1.05
    const placement = createScaleEncounterPlacement(
      'mammoth',
      new Vector3(-0.75, 0, -0.7),
      new Vector3(4.35, 3.25, 0.7),
      childEyeHeight,
    )

    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      10,
      8,
    )
    expect(placement.defaultEyePosition.y).toBeCloseTo(childEyeHeight, 8)
    expect(placement.defaultEyePosition.x).toBeLessThan(placement.target.x)
    expect(scaleEncounterElevationDegrees(placement.defaultEyePosition, placement.target))
      .toBeGreaterThan(0)
  })

  it('puts the vertical diver left, below and in front of the Mosasaurus', () => {
    const placement = createScaleEncounterPlacement(
      'mosasaurus',
      new Vector3(-4.8, -0.7, -1),
      new Vector3(7.2, 3.2, 1),
      1,
    )

    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      20,
      8,
    )
    expect(placement.defaultEyePosition.x).toBeLessThan(placement.target.x)
    expect(placement.defaultEyePosition.y).toBeLessThan(placement.target.y)
    expect(placement.defaultEyePosition.z).toBeGreaterThan(placement.target.z)
    expect(
      scaleEncounterElevationDegrees(
        placement.defaultEyePosition,
        placement.target,
      ),
    ).toBeGreaterThan(0)
  })

  it('clamps distance and moves only along the immutable observer rail', () => {
    const placement = createScaleEncounterPlacement(
      'mosasaurus',
      new Vector3(-6, -1, -1),
      new Vector3(6, 3, 1),
      1,
    )
    expect(clampScaleEncounterDistance('mosasaurus', 2)).toBe(10)
    expect(clampScaleEncounterDistance('mosasaurus', 30)).toBe(27)
    expect(clampScaleEncounterDistance('mosasaurus', Number.NaN)).toBe(20)
    const unchangedTarget = placement.target.clone()

    const near = positionOnScaleEncounterRail(
      placement.target,
      placement.observerRailDirection,
      10,
    )
    const far = positionOnScaleEncounterRail(
      placement.target,
      placement.observerRailDirection,
      27,
    )
    const nearDirection = near.clone().sub(placement.target).normalize()
    const farDirection = far.clone().sub(placement.target).normalize()
    expect(near.distanceTo(placement.target)).toBeCloseTo(10, 8)
    expect(far.distanceTo(placement.target)).toBeCloseTo(27, 8)
    expect(nearDirection.distanceTo(farDirection)).toBeLessThan(1e-10)
    expect(placement.target).toEqual(unchangedTarget)
  })
})
