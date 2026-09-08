import { AnimationMixer, Box3, Group, Vector3 } from 'three'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadTexturelessAnimalGltf } from './helpers/load-textureless-animal'
import { SCALE_ENCOUNTER_DEFINITIONS } from '../src/viewer/scale-encounter'
import { createEncounterMotionFootprint } from '../src/viewer/scale-encounter-motion-footprint'
import { createAnimalGroundFootprint, clearsAnimalGroundFootprint } from '../src/viewer/scale-encounter-ground-footprint'

it.each(Object.values(SCALE_ENCOUNTER_DEFINITIONS).filter(definition => definition.habitat === 'land'))(
  'keeps stationary visitors clear throughout the complete $id idle cycle', async definition => {
    const gltf = await loadTexturelessAnimalGltf(definition.id)
    const model = gltf.scene
    const group = new Group().add(model)
    model.rotation.y = definition.modelYawRadians
    const mixer = new AnimationMixer(model)
    const clip = gltf.animations.find(clip => clip.name === 'Idle')!
    mixer.clipAction(clip).play()
    mixer.setTime(definition.referenceAnimationTimeSeconds)
    group.updateMatrixWorld(true)
    const raw = new Box3().setFromObject(model, true)
    const scale = definition.displayedMeters / raw.getSize(new Vector3())[definition.measurementAxis]
    const centre = raw.getCenter(new Vector3())
    group.scale.setScalar(scale)
    group.position.set(definition.animalPosition.x - centre.x * scale,
      definition.animalPosition.y - raw.min.y * scale,
      definition.animalPosition.z - centre.z * scale)
    group.updateMatrixWorld(true)
    const initial = createAnimalGroundFootprint(model)
    const swept = createEncounterMotionFootprint(definition)
    expect(createHash('sha256').update(readFileSync(`src/content/animals/${definition.id}/model/model.glb`)).digest('hex'))
      .toBe(definition.calibratedModelSha256)
    // A child stays in these positions for the entire cycle, including frames
    // between bake samples. Test both the minimum and a taller child's margin.
    const visitors = [.55, .9].flatMap(margin => swept.map((a, index) => {
      const b = swept[(index + 1) % swept.length]!
      const outward = new Vector3(b.z - a.z, 0, a.x - b.x).normalize()
      return {point: a.clone().lerp(b, .5).addScaledVector(outward, margin), margin}
    }))
    let exceedsInitial = false
    for (let frame = 0; frame < 65; frame++) {
      mixer.setTime(clip.duration * (frame + .37) / 65)
      const pose = createAnimalGroundFootprint(model)
      for (const point of pose) {
        expect(clearsAnimalGroundFootprint(point, swept, 0), `${definition.id} frame ${frame}`).toBe(false)
        if (clearsAnimalGroundFootprint(point, initial, .05)) exceedsInitial = true
      }
      for (const visitor of visitors) {
        // Measure actual distance to polygon segments independently of the
        // runtime's conservative mitered half-plane expansion.
        const distance = Math.min(...pose.map((a, index) => {
          const b = pose[(index + 1) % pose.length]!
          const edge = b.clone().sub(a)
          const t = Math.max(0, Math.min(1, visitor.point.clone().sub(a).dot(edge) / edge.lengthSq()))
          return visitor.point.distanceTo(a.clone().addScaledVector(edge, t))
        }))
        expect(clearsAnimalGroundFootprint(visitor.point, pose, 0)).toBe(true)
        expect(distance, `${definition.id} stationary visitor at frame ${frame}`)
          .toBeGreaterThanOrEqual(visitor.margin - 1e-5)
      }
    }
    if (definition.id === 'pachycephalosaurus') expect(exceedsInitial).toBe(true)
  }, 20_000,
)

it('rejects an obsolete motion bake when the model calibration changes', () => {
  expect(() => createEncounterMotionFootprint({...SCALE_ENCOUNTER_DEFINITIONS.pachycephalosaurus, calibratedModelSha256: 'changed'}))
    .toThrow('Rebake encounter motion footprint')
})
