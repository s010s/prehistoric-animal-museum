import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import {
  computeSkyOverviewPose,
  computeSkyPovPose,
  createSkyTransitionKeyframes,
  placeAvatarEyeAt,
  sampleSkyTransition,
  skyPovDistanceForRange,
} from '../prototypes/scale-encounter-sky/camera-harness'
import {
  SCALE_ENCOUNTER_DEFINITIONS,
  createScaleEncounterPlacement,
} from '../src/viewer/scale-encounter'

function cameraFixture() {
  const animalRoot = new Group()
  const animal = new Mesh(
    new BoxGeometry(7, 2, 1.4),
    new MeshBasicMaterial(),
  )
  animal.position.set(0, 4.8, 0)
  animalRoot.add(animal)

  const avatarRoot = new Group()
  const avatarBody = new Mesh(
    new BoxGeometry(0.42, 1.1, 0.28),
    new MeshBasicMaterial(),
  )
  avatarBody.position.y = 0.55
  const eyeAnchor = new Group()
  eyeAnchor.position.y = 1.001
  avatarRoot.add(avatarBody, eyeAnchor)
  const placement = createScaleEncounterPlacement(
    'pteranodon',
    new Vector3(-3.5, 3.8, -0.7),
    new Vector3(3.5, 5.8, 0.7),
    1.001,
  )
  avatarRoot.rotation.y = placement.avatarYawRadians
  placeAvatarEyeAt(avatarRoot, eyeAnchor, placement.defaultEyePosition)
  return { animal, animalRoot, avatarBody, avatarRoot, eyeAnchor, placement }
}

describe('scale encounter sky locked camera harness', () => {
  it('uses the shared minimum, default and maximum air rail distances', () => {
    expect(skyPovDistanceForRange('minimum')).toBe(8)
    expect(skyPovDistanceForRange('default')).toBe(15)
    expect(skyPovDistanceForRange('maximum')).toBe(21)
  })

  it('keeps POV on the unchanged world +Z rail at every legal distance', () => {
    const fixture = cameraFixture()
    for (const range of ['minimum', 'default', 'maximum'] as const) {
      const pose = computeSkyPovPose(fixture.placement, 1440 / 900, range)
      expect(pose.position.distanceTo(fixture.placement.target)).toBeCloseTo(
        skyPovDistanceForRange(range),
        8,
      )
      expect(pose.position.x).toBeCloseTo(fixture.placement.target.x, 10)
      expect(pose.position.y).toBeCloseTo(fixture.placement.target.y, 10)
      expect(pose.position.z).toBeGreaterThan(fixture.placement.target.z)
      expect(pose.fieldOfViewDegrees).toBe(
        SCALE_ENCOUNTER_DEFINITIONS.pteranodon.povFieldOfView,
      )
    }
  })

  it('keeps the overview at the shared 70 degree direction and optical zoom limits', () => {
    const fixture = cameraFixture()
    const closest = computeSkyOverviewPose(
      fixture.animalRoot,
      fixture.avatarRoot,
      1440 / 900,
      'minimum',
    )
    const defaultPose = computeSkyOverviewPose(
      fixture.animalRoot,
      fixture.avatarRoot,
      1440 / 900,
      'default',
    )
    const farthest = computeSkyOverviewPose(
      fixture.animalRoot,
      fixture.avatarRoot,
      1440 / 900,
      'maximum',
    )
    const direction = defaultPose.position
      .clone()
      .sub(defaultPose.target)
      .normalize()
    expect(
      direction.distanceTo(
        SCALE_ENCOUNTER_DEFINITIONS.pteranodon.overviewDirection,
      ),
    ).toBeLessThan(1e-10)
    expect(closest.fieldOfViewDegrees).toBeLessThan(
      defaultPose.fieldOfViewDegrees,
    )
    expect(farthest.fieldOfViewDegrees).toBeGreaterThan(
      defaultPose.fieldOfViewDegrees,
    )
  })

  it('reproduces every shared air transition stage and timing landmark', () => {
    const fixture = cameraFixture()
    const start = computeSkyOverviewPose(
      fixture.animalRoot,
      fixture.avatarRoot,
      1440 / 900,
      'default',
    )
    const keyframes = createSkyTransitionKeyframes(
      start,
      fixture.avatarRoot,
      fixture.eyeAnchor,
      fixture.placement,
      1440 / 900,
    )
    expect(keyframes.map((keyframe) => keyframe.at)).toEqual([
      0, 0.09, 0.15, 0.49, 0.58, 0.95, 1,
    ])
    expect(keyframes.map((keyframe) => keyframe.stage)).toEqual([
      'overview',
      'side-establishing',
      'side-establishing',
      'child-rear',
      'child-rear',
      'eye-entry',
      'pov',
    ])
    expect(sampleSkyTransition(keyframes, 0).stage).toBe('overview')
    expect(sampleSkyTransition(keyframes, 0.25).stage).toBe(
      'side-establishing',
    )
    expect(sampleSkyTransition(keyframes, 0.75).stage).toBe('eye-entry')
    expect(sampleSkyTransition(keyframes, 1).stage).toBe('pov')
  })
})
