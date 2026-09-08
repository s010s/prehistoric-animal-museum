import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { AnimationMixer, Box3, Group, Vector3 } from 'three'
import { loadTexturelessAnimalGltf } from '../tests/helpers/load-textureless-animal'
import { SCALE_ENCOUNTER_DEFINITIONS, createScaleEncounterPlacement } from '../src/viewer/scale-encounter'
import { createAnimalGroundFootprint, convexGroundFootprint } from '../src/viewer/scale-encounter-ground-footprint'
import { createAnimalPresence } from '../src/viewer/scale-encounter-animal-presence'

// Bake complete idle cycles and additive interaction poses offline. Runtime
// movement uses this stable swept area even while the child stands still.
const selected = new Set(process.argv.slice(2))
const destination = 'src/viewer/scale-encounter-motion-footprints.json'
const output: Record<string, unknown> = selected.size ? JSON.parse(readFileSync(destination, 'utf8')) : {}
for (const definition of Object.values(SCALE_ENCOUNTER_DEFINITIONS)) {
  if (definition.habitat !== 'land' || (selected.size && !selected.has(definition.id))) continue
  const gltf = await loadTexturelessAnimalGltf(definition.id)
  const model = gltf.scene
  const group = new Group().add(model)
  model.rotation.y = definition.modelYawRadians
  const mixer = new AnimationMixer(model)
  const clip = gltf.animations.find(clip => clip.name === 'Idle')!
  mixer.clipAction(clip).play()
  mixer.setTime(definition.referenceAnimationTimeSeconds)
  group.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(model, true)
  const scale = definition.displayedMeters / bounds.getSize(new Vector3())[definition.measurementAxis]
  const centre = bounds.getCenter(new Vector3())
  group.scale.setScalar(scale)
  group.position.set(definition.animalPosition.x - centre.x * scale,
    definition.animalPosition.y - bounds.min.y * scale,
    definition.animalPosition.z - centre.z * scale)
  group.updateMatrixWorld(true)
  const worldBounds = new Box3().setFromObject(model, true)
  const placement = createScaleEncounterPlacement(definition.id, worldBounds.min, worldBounds.max, 1)
  const presence = createAnimalPresence(definition.id, model, placement.defaultEyePosition)
  const points: Vector3[] = []
  const sampleCount = Math.max(96, Math.ceil(clip.duration * 30))
  for (let frame = 0; frame < sampleCount; frame++) {
    presence?.restore()
    mixer.setTime(clip.duration * frame / sampleCount)
    points.push(...createAnimalGroundFootprint(model))
    if (presence && frame % Math.ceil(sampleCount / 8) === 0) {
      const forward = placement.defaultEyePosition.clone().sub(placement.orbitCenter).setY(0).normalize()
      // Both attention limits, plus all stages of the mammoth's near-side
      // weight adjustment. Advance the real controller rather than guessing bones.
      for (const side of [-1, 1]) {
        if (definition.id === 'mammoth') {
          for (let tick = 0; tick < 200; tick++) {
            presence.update({deltaSeconds: .1, visitorEye: new Vector3(1000, 1, 1000), active: true, reducedMotion: false})
          }
        }
        const visitorEye = forward.clone().applyAxisAngle(new Vector3(0, 1, 0), side * 1.1)
          .multiplyScalar(worldBounds.getSize(new Vector3()).length() * .25)
          .add(placement.orbitCenter).setY(1)
        for (let tick = 0; tick < 80; tick++) {
          presence.update({deltaSeconds: .1, visitorEye, active: true, reducedMotion: false})
          if (tick % 4 === 0 || tick === 79) points.push(...createAnimalGroundFootprint(model))
        }
      }
    }
  }
  presence?.dispose()
  const hull = convexGroundFootprint(points)
  output[definition.id] = {
    modelSha256: createHash('sha256').update(readFileSync(`src/content/animals/${definition.id}/model/model.glb`)).digest('hex'),
    clip: clip.name, duration: clip.duration, sampleCount,
    points: hull.map(point => [Number(point.x.toFixed(6)), Number(point.z.toFixed(6))]),
  }
  console.log(`${definition.id}: ${sampleCount} idle samples, ${hull.length} swept vertices`)
}
writeFileSync(destination, JSON.stringify(output) + '\n')
