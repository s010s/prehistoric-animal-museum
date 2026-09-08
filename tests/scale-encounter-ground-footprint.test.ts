import { Box3, Vector3 } from 'three'
import { createAnimalGroundFootprint, clearsAnimalGroundFootprint } from '../src/viewer/scale-encounter-ground-footprint'
import { loadTexturelessAnimal } from './helpers/load-textureless-animal'
import { createScaleEncounterPlacement, normalizeScaleEncounterProfile, SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'
import { computeScaleEncounterOrbitedEyePosition, minimumScaleEncounterDistanceForProfile } from '../src/viewer/ViewerController'

it('lets a child use empty head-side corners of the shipped Spinosaurus without entering its projected skin', async () => {
  const model = await loadTexturelessAnimal('spinosaurus', 'Idle')
  model.rotation.y = -Math.PI / 2
  model.updateMatrixWorld(true)
  model.scale.multiplyScalar(14.5 / new Box3().setFromObject(model, true).getSize(new Vector3()).x)
  model.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(model, true)
  const hull = createAnimalGroundFootprint(model)
  expect(hull.length).toBeGreaterThan(4)
  for (const vertex of hull) expect(clearsAnimalGroundFootprint(vertex, hull, .55)).toBe(false)
  const placement = createScaleEncounterPlacement('spinosaurus', bounds.min, bounds.max, 1.1, hull)
  const rectangle = createScaleEncounterPlacement('spinosaurus', bounds.min, bounds.max, 1.1)
  const definition = SCALE_ENCOUNTER_DEFINITIONS.spinosaurus
  const profile = normalizeScaleEncounterProfile({ approach: 'close', gender: 'girl', heightCm: 110 })
  let recoveredSpace = 0
  for (let i = 0; i < 72; i++) {
    const angle = i * Math.PI / 36
    const minimum = minimumScaleEncounterDistanceForProfile(placement, definition, profile, angle)
    const eye = computeScaleEncounterOrbitedEyePosition(placement, 'land', minimum, angle)
    const inner = computeScaleEncounterOrbitedEyePosition(placement, 'land', minimum - .03, angle)
    expect(clearsAnimalGroundFootprint(eye, hull, .55 - 1e-5), JSON.stringify({i, minimum, eye, bounds, hullBounds:new Box3().setFromPoints([...hull])})).toBe(true)
    expect(clearsAnimalGroundFootprint(inner, hull, .55)).toBe(false)
    const oldMinimum = minimumScaleEncounterDistanceForProfile(rectangle, definition, profile, angle)
    const oldEye = computeScaleEncounterOrbitedEyePosition(rectangle, 'land', oldMinimum, angle)
    recoveredSpace = Math.max(recoveredSpace, oldEye.distanceTo(eye))
  }
  expect(recoveredSpace).toBeGreaterThan(.5)
})
