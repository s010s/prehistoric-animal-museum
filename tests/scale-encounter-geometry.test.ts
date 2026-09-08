import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MathUtils, Vector3 } from 'three'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND,
  SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND,
  clampScaleEncounterDistance,
  computeScaleEncounterAvatarTravelQuaternion,
  createScaleEncounterPlacement,
  normalizeScaleEncounterProfile,
  positionOnScaleEncounterRail,
  resolveScaleEncounterLandInputIntent,
  scaleEncounterAvatarMotionFor,
  scaleEncounterElevationDegrees,
} from '../src/viewer/scale-encounter'
import { SCALE_ENCOUNTER_ANIMAL_IDS } from '../src/scale-encounter/types'
import {
  clampScaleEncounterDistanceForProfile,
  computeScaleEncounterOrbitedEyePosition,
  computeScaleEncounterPovEyePosition,
  minimumScaleEncounterDistanceForProfile,
} from '../src/viewer/ViewerController'

describe('scale encounter geometry', () => {
  it.each(SCALE_ENCOUNTER_ANIMAL_IDS.map((animalId) => [animalId, animalId] as const))('invalidates the %s calibration when its reviewed GLB changes', (animalId, directory) => {
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

  it('normalizes the three child encounter settings', () => {
    expect(
      normalizeScaleEncounterProfile({ gender: 'girl', heightCm: 87 }),
    ).toEqual({
      approach: 'comfortable',
      gender: 'girl',
      heightCm: 90,
      heightMeters: 0.9,
    })
    expect(
      normalizeScaleEncounterProfile({
        approach: 'close',
        gender: 'boy',
        heightCm: 128,
      }),
    ).toEqual({
      approach: 'close',
      gender: 'boy',
      heightCm: 130,
      heightMeters: 1.3,
    })
    expect(
      normalizeScaleEncounterProfile({ gender: 'boy', heightCm: Number.NaN }),
    ).toEqual({
      approach: 'comfortable',
      gender: 'boy',
      heightCm: 110,
      heightMeters: 1.1,
    })
  })

  it('keeps the child on the left and Apatosaurus on the right, facing the child', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.apatosaurus
    const minimum = new Vector3(-8, 0, -1.5)
    const maximum = new Vector3(15, 5, 1.5)
    const placement = createScaleEncounterPlacement(
      'apatosaurus',
      minimum,
      maximum,
      1.1,
    )
    const screenRight = definition.overviewUp
      .clone()
      .cross(definition.overviewDirection)
      .normalize()

    expect(definition.modelYawRadians).toBe(0)
    expect(definition.overviewDirection.z).toBeGreaterThan(0)
    expect(placement.defaultEyePosition.x).toBeLessThan(minimum.x)
    expect(
      new Vector3()
        .subVectors(placement.orbitCenter, placement.defaultEyePosition)
        .dot(screenRight),
    ).toBeGreaterThan(0)
  })

  it('lets close approach follow the animal bounds instead of a centre circle', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.apatosaurus
    const placement = createScaleEncounterPlacement(
      'apatosaurus',
      new Vector3(-8, 0, -1.5),
      new Vector3(15, 5, 1.5),
      1.1,
    )
    const closeProfile = normalizeScaleEncounterProfile({
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
    })
    const comfortableProfile = normalizeScaleEncounterProfile({
      approach: 'comfortable',
      gender: 'girl',
      heightCm: 110,
    })
    const headSideMinimum = minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      closeProfile,
      0,
    )
    const broadsideMinimum = minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      closeProfile,
      Math.PI / 2,
    )

    expect(headSideMinimum).toBeGreaterThan(definition.minimumDistance)
    expect(broadsideMinimum).toBeLessThan(definition.minimumDistance)
    expect(
      clampScaleEncounterDistanceForProfile(
        placement,
        definition,
        comfortableProfile,
        0,
        0,
      ),
    ).toBeCloseTo(headSideMinimum, 5)
    expect(
      clampScaleEncounterDistanceForProfile(
        placement,
        definition,
        closeProfile,
        0,
        0,
      ),
    ).toBeCloseTo(headSideMinimum, 5)
  })

  it('lets a close Apatosaurus observer reach the broadside legs without a forward jump', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.apatosaurus
    const placement = createScaleEncounterPlacement(
      'apatosaurus',
      new Vector3(-8, 0, -1.5),
      new Vector3(15, 5, 1.5),
      1.1,
    )
    const profile = normalizeScaleEncounterProfile({
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
    })
    const orbitAngleRadians = Math.PI / 2
    const minimum = minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      profile,
      orbitAngleRadians,
    )
    const atMinimum = computeScaleEncounterOrbitedEyePosition(
      placement,
      definition.habitat,
      minimum,
      orbitAngleRadians,
    )
    const oneStepFarther = computeScaleEncounterOrbitedEyePosition(
      placement,
      definition.habitat,
      minimum + 0.35,
      orbitAngleRadians,
    )
    const twoStepsFarther = computeScaleEncounterOrbitedEyePosition(
      placement,
      definition.habitat,
      minimum + 0.7,
      orbitAngleRadians,
    )
    const firstStep = oneStepFarther.distanceTo(atMinimum)
    const secondStep = twoStepsFarther.distanceTo(oneStepFarther)
    const broadsideRadius = atMinimum
      .clone()
      .sub(placement.orbitCenter)
      .setY(0)
      .length()

    expect(broadsideRadius).toBeLessThan(3)
    expect(firstStep).toBeGreaterThan(0.1)
    expect(secondStep).toBeCloseTo(firstStep, 8)
  })

  it('keeps the Spinosaurus child readable at entry while letting close viewing reach its AABB boundary', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.spinosaurus
    const placement = createScaleEncounterPlacement(
      'spinosaurus',
      new Vector3(-4.698872, 0, -1.356681),
      new Vector3(9.682645, 5.158696, 2.046446),
      1.1,
    )
    const profile = normalizeScaleEncounterProfile({
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
    })
    const collisionMinimum = minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      profile,
      0,
    )
    const horizontalRail = placement.observerRailDirection.clone().setY(0)
    const headOnOffsetRadians = Math.atan2(
      Math.abs(horizontalRail.z),
      Math.abs(horizontalRail.x),
    )

    expect(collisionMinimum).toBeLessThan(definition.minimumDistance)
    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      12.5,
      8,
    )
    expect(MathUtils.radToDeg(headOnOffsetRadians)).toBeCloseTo(42, 8)
    expect(placement.defaultEyePosition.z).toBeGreaterThan(placement.target.z)
    expect(definition.defaultDistance).toBe(12.5)
    expect(definition.minimumDistance).toBe(9)
    expect(definition.maximumDistance).toBe(25)
    expect(definition.defaultDistance).toBeGreaterThan(collisionMinimum)
  })

  it('reaches both Spinosaurus flanks continuously while preserving the opening position', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.spinosaurus
    const placement = createScaleEncounterPlacement('spinosaurus',
      new Vector3(-4.698872, 0, -1.356681), new Vector3(9.682645, 5.158696, 2.046446), 1.1)
    const profile = normalizeScaleEncounterProfile({ approach: 'close', gender: 'girl', heightCm: 110 })
    const initial = computeScaleEncounterPovEyePosition(placement, 'land', definition.defaultDistance)
    expect(initial.distanceTo(placement.defaultEyePosition)).toBeLessThan(1e-8)
    const direction = initial.clone().sub(placement.orbitCenter)
    for (const angle of [Math.atan2(-direction.x, direction.z), Math.atan2(-direction.x, direction.z) + Math.PI]) {
      const minimum = minimumScaleEncounterDistanceForProfile(placement, definition, profile, angle)
      const eye = computeScaleEncounterOrbitedEyePosition(placement, 'land', minimum, angle)
      const next = computeScaleEncounterOrbitedEyePosition(placement, 'land', minimum + .2, angle)
      const after = computeScaleEncounterOrbitedEyePosition(placement, 'land', minimum + .4, angle)
      const halfWidth = (placement.animalBoundsMaximum.z - placement.animalBoundsMinimum.z) / 2
      const clearance = Math.abs(eye.z - placement.orbitCenter.z) - halfWidth
      expect(clearance).toBeGreaterThanOrEqual(.55 - 1e-5)
      expect(clearance).toBeLessThan(.56)
      expect(eye.x).toBeCloseTo(placement.orbitCenter.x, 6)
      expect(next.distanceTo(eye)).toBeGreaterThan(.1)
      expect(after.distanceTo(next)).toBeCloseTo(next.distanceTo(eye), 6)
    }
  })

  it('places the Archaeopteryx child on a short diagonal rail without changing the half-metre animal scale', () => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.archaeopteryx
    const placement = createScaleEncounterPlacement(
      'archaeopteryx',
      new Vector3(1.95, 0.3, -0.21),
      new Vector3(2.45, 0.62, 0.21),
      0.985,
    )
    const horizontalRail = placement.observerRailDirection.clone().setY(0)
    const screenDepthOffsetRadians = Math.atan2(
      Math.abs(horizontalRail.z),
      Math.abs(horizontalRail.x),
    )

    expect(definition.displayedMeters).toBe(0.5)
    expect(definition.measurement).toBe('body-length')
    expect(definition.defaultDistance).toBe(1.8)
    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      1.8,
      8,
    )
    expect(MathUtils.radToDeg(screenDepthOffsetRadians)).toBeCloseTo(30, 8)
    expect(placement.defaultEyePosition.x).toBeLessThan(placement.target.x)
    expect(placement.defaultEyePosition.z).toBeGreaterThan(placement.target.z)
  })

  it.each([
    ['front-left leg side', MathUtils.degToRad(60)],
    ['rear-left leg side', MathUtils.degToRad(120)],
    ['rear-right leg side', MathUtils.degToRad(240)],
    ['front-right leg side', MathUtils.degToRad(300)],
  ])('reaches the safe boundary beside the %s', (_label, angle) => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS.apatosaurus
    const placement = createScaleEncounterPlacement(
      'apatosaurus',
      new Vector3(-8, 0, -1.5),
      new Vector3(15, 5, 1.5),
      1.1,
    )
    const profile = normalizeScaleEncounterProfile({
      approach: 'close',
      gender: 'girl',
      heightCm: 110,
    })
    const minimum = minimumScaleEncounterDistanceForProfile(
      placement,
      definition,
      profile,
      angle,
    )
    const boundary = computeScaleEncounterOrbitedEyePosition(
      placement,
      'land',
      minimum,
      angle,
    )
    const radius = boundary
      .clone()
      .sub(placement.orbitCenter)
      .setY(0)
      .length()
    const farther = computeScaleEncounterOrbitedEyePosition(
      placement,
      'land',
      minimum + 0.1,
      angle,
    )

    expect(Number.isFinite(minimum)).toBe(true)
    expect(radius).toBeLessThan(3)
    expect(farther.distanceTo(boundary)).toBeGreaterThan(0)
    expect(farther.distanceTo(boundary)).toBeLessThan(0.5)
  })

  it.each(
    SCALE_ENCOUNTER_ANIMAL_IDS.filter(
      (animalId) => SCALE_ENCOUNTER_DEFINITIONS[animalId].habitat === 'land',
    ),
  )('preserves the arrival and permits a continuous body-centred approach for %s', (animalId) => {
    const definition = SCALE_ENCOUNTER_DEFINITIONS[animalId]
    const placement = createScaleEncounterPlacement(
      animalId, new Vector3(-4, 0, -1), new Vector3(6, 4, 1), 1.1,
    )
    const arrival = computeScaleEncounterPovEyePosition(placement, 'land', definition.defaultDistance)
    expect(arrival.distanceTo(placement.defaultEyePosition)).toBeLessThan(1e-9)
    const centre = new Vector3().copy(placement.orbitCenter).setY(arrival.y)
    const half = computeScaleEncounterPovEyePosition(placement, 'land', definition.defaultDistance / 2)
    expect(half.distanceTo(centre)).toBeCloseTo(arrival.distanceTo(centre) / 2, 9)
    const end = computeScaleEncounterPovEyePosition(placement, 'land', 0)
    expect(end.distanceTo(centre)).toBeLessThan(1e-9)
    expect(half.y).toBe(arrival.y)
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
    expect(placement.orbitCenter.x).toBeCloseTo(2.2, 10)
    expect(placement.orbitCenter.y).toBeCloseTo(2, 10)
    expect(placement.orbitCenter.z).toBeCloseTo(0, 10)
    expect(placement.orbitCenter.distanceTo(placement.target)).toBeGreaterThan(
      1,
    )
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
    expect(placement.defaultEyePosition.z).toBeCloseTo(placement.target.z, 8)
    expect(placement.observerRailDirection.z).toBeCloseTo(0, 8)
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

  it('starts the Plesiosaurus diver on a comfortable face-to-face head rail', () => {
    const minimum = new Vector3(-1.6, 0.18, -1.65)
    const maximum = new Vector3(3.37, 2.23, 1.63)
    const placement = createScaleEncounterPlacement(
      'plesiosaurus',
      minimum,
      maximum,
      1,
    )

    expect(placement.defaultEyePosition.distanceTo(placement.target)).toBeCloseTo(
      8,
      8,
    )
    expect(placement.target.x).toBeCloseTo(-1.2024, 4)
    expect(placement.target.y).toBeCloseTo(1.82, 4)
    expect(placement.defaultEyePosition.x).toBeLessThan(minimum.x)
    expect(placement.defaultEyePosition.z).toBeGreaterThan(placement.target.z)
    expect(placement.observerRailDirection.z).toBeGreaterThan(0.8)
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

  it.each([
    ['closer', new Vector3(1, 0, 0)],
    ['farther', new Vector3(-1, 0, 0)],
    ['clockwise tangent', new Vector3(0, 0, 1)],
    ['counter-clockwise tangent', new Vector3(0, 0, -1)],
  ])('turns a ground avatar local +X toward %s travel', (_label, travel) => {
    const heading = computeScaleEncounterAvatarTravelQuaternion(
      travel,
      'land',
      0,
    )
    const renderedForward = new Vector3(1, 0, 0).applyQuaternion(heading)

    expect(renderedForward.distanceTo(travel)).toBeLessThan(1e-10)
    expect(new Vector3(0, 1, 0).applyQuaternion(heading)).toEqual(
      new Vector3(0, 1, 0),
    )
  })

  it('pitches a diver into its full 3D rail direction without introducing roll', () => {
    const travel = new Vector3(-0.7, -0.28, 0.45).normalize()
    const heading = computeScaleEncounterAvatarTravelQuaternion(
      travel,
      'water',
      0,
    )
    const renderedForward = new Vector3(1, 0, 0).applyQuaternion(heading)
    const renderedUp = new Vector3(0, 1, 0).applyQuaternion(heading)

    expect(renderedForward.distanceTo(travel)).toBeLessThan(1e-10)
    expect(renderedUp.dot(renderedForward)).toBeCloseTo(0, 10)
    expect(renderedUp.y).toBeGreaterThan(0)
  })

  it('maps only scene-approved motion to skeletal actions', () => {
    expect(scaleEncounterAvatarMotionFor('tyrannosaurus-rex', 0)).toBe('idle')
    expect(scaleEncounterAvatarMotionFor('tyrannosaurus-rex', 1.4)).toBe('walk')
    expect(scaleEncounterAvatarMotionFor('tyrannosaurus-rex', 2.2)).toBe('run')
    expect(scaleEncounterAvatarMotionFor('apatosaurus', 1.4)).toBe('walk')
    expect(scaleEncounterAvatarMotionFor('apatosaurus', 2.8)).toBe('run')
    expect(scaleEncounterAvatarMotionFor('mammoth', 4)).toBe('run')
    expect(scaleEncounterAvatarMotionFor('meganeura', 4)).toBe('run')
    expect(scaleEncounterAvatarMotionFor('pteranodon', 0)).toBe('glide')
    expect(scaleEncounterAvatarMotionFor('pteranodon', 8)).toBe('glide')
    expect(scaleEncounterAvatarMotionFor('mosasaurus', 0)).toBe('idle')
    expect(scaleEncounterAvatarMotionFor('mosasaurus', 0.8)).toBe('swim')
  })

  it('normalises land input once and chooses gait from intent', () => {
    expect(resolveScaleEncounterLandInputIntent(0, 0)).toEqual({
      motion: 'idle',
      radial: 0,
      speedMetersPerSecond: 0,
      tangential: 0,
    })
    expect(resolveScaleEncounterLandInputIntent(1, 0)).toEqual({
      motion: 'walk',
      radial: 1,
      speedMetersPerSecond:
        SCALE_ENCOUNTER_LAND_WALK_SPEED_METERS_PER_SECOND,
      tangential: 0,
    })
    const diagonal = resolveScaleEncounterLandInputIntent(1, 1)
    expect(diagonal.motion).toBe('run')
    expect(diagonal.speedMetersPerSecond).toBe(
      SCALE_ENCOUNTER_LAND_RUN_SPEED_METERS_PER_SECOND,
    )
    expect(diagonal.radial).toBeCloseTo(Math.SQRT1_2, 12)
    expect(diagonal.tangential).toBeCloseTo(Math.SQRT1_2, 12)
    expect(Math.hypot(diagonal.radial, diagonal.tangential)).toBeCloseTo(
      1,
      12,
    )
  })
})
