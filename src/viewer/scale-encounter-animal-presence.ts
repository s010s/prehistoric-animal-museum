import { Bone, Box3, MathUtils, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three'
import type { ScaleEncounterAnimalId } from './scale-encounter'

// Explicit joints from the shipped rigs. Morph-only animals keep their authored
// animation; never rotate a whole animal to imitate a missing neck joint.
export const ENCOUNTER_ATTENTION_JOINTS: Partial<Record<ScaleEncounterAnimalId, string>> = {
  'tyrannosaurus-rex': 'head',
  mammoth: 'head',
  stegosaurus: 'Head_09',
  pachycephalosaurus: 'Head_09',
  triceratops: 'head',
  maiasaura: 'head_023',
  spinosaurus: 'Head_010',
  gigantoraptor: 'head_012_8_36',
  lystrosaurus: 'head_065_62',
  archaeopteryx: 'Head_01',
  pteranodon: 'head.15_15',
  ichthyosaur: 'head',
}

export interface AnimalPresenceInput {
  readonly deltaSeconds: number
  readonly visitorEye: Vector3
  readonly active: boolean
  readonly reducedMotion: boolean
}

export interface AnimalPresence {
  /** Remove last frame's additive pose BEFORE the animation mixer evaluates. */
  restore(): void
  update(input: AnimalPresenceInput): Vector3 | null
  readonly yawRadians: number
  readonly acknowledgementCount: number
}

export function createAnimalPresence(
  animalId: ScaleEncounterAnimalId,
  model: Object3D,
  visitorStart?: Readonly<Vector3>,
): AnimalPresence | null {
  const name = ENCOUNTER_ATTENTION_JOINTS[animalId]
  // GLTFLoader sanitizes dots and other animation-binding characters in names.
  const head = name ? model.getObjectByName(PropertyBinding.sanitizeNodeName(name)) : undefined
  if (!(head instanceof Bone)) return null
  model.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(model, true)
  const centre = bounds.getCenter(new Vector3())
  const headPoint = head.getWorldPosition(new Vector3())
  // Preserve the authored arrival pose. React to changes in the child's
  // bearing around the body; a source rig's head pivot is not necessarily at
  // its visible face (the mammoth's is several metres from the nose).
  const forward = (visitorStart ? new Vector3().copy(visitorStart) : headPoint.clone()).sub(centre).setY(0)
  if (forward.lengthSq() < 0.0001) return null
  forward.normalize()
  const foot = animalId === 'mammoth' ? model.getObjectByName('leg_front_left') : null
  const baseHead = new Quaternion()
  const baseFoot = new Vector3()
  const parentRotation = new Quaternion()
  const localUp = new Vector3()
  const direction = new Vector3()
  const offset = new Quaternion()
  const worldFoot = new Vector3()
  const localFoot = new Vector3()
  let applied = false
  let yaw = 0
  let dwell = 0
  let cooldown = 0
  let gesture = -1
  let armed = true
  let count = 0
  const maximumYaw = MathUtils.degToRad(animalId === 'pteranodon' ? 5 : 10)

  function restore() {
    if (!applied) return
    head!.quaternion.copy(baseHead)
    if (foot) foot.position.copy(baseFoot)
    applied = false
  }

  return {
    restore,
    get yawRadians() { return yaw },
    get acknowledgementCount() { return count },
    update: ({ deltaSeconds, visitorEye, active, reducedMotion }) => {
      // Calling update twice without a mixer is safe as well.
      restore()
      const dt = MathUtils.clamp(deltaSeconds, 0, 0.1)
      if (reducedMotion) {
        yaw = 0
        dwell = 0
        gesture = -1
        return null
      }
      direction.copy(visitorEye).sub(centre).setY(0)
      direction.normalize()
      const facing = forward.dot(direction)
      // A head hinge may sit metres inside a large animal. Use the calibrated
      // body's horizontal envelope for proximity, not the rig joint origin.
      const surfaceDistance = Math.hypot(
        Math.max(bounds.min.x - visitorEye.x, 0, visitorEye.x - bounds.max.x),
        Math.max(bounds.min.z - visitorEye.z, 0, visitorEye.z - bounds.max.z),
      )
      const closeComfort = MathUtils.lerp(.4, 1, MathUtils.smoothstep(surfaceDistance, .4, 1.8))
      const desiredYaw = active && facing > -0.15
        ? MathUtils.clamp(Math.atan2(
          forward.z * direction.x - forward.x * direction.z, facing,
        ), -maximumYaw, maximumYaw) * closeComfort : 0
      yaw = MathUtils.damp(yaw, desiredYaw, 1.25, dt)
      baseHead.copy(head.quaternion)
      head.parent!.getWorldQuaternion(parentRotation).invert()
      localUp.set(0, 1, 0).applyQuaternion(parentRotation)
      offset.setFromAxisAngle(localUp, yaw)
      head.quaternion.premultiply(offset)
      applied = true

      // A quiet weight adjustment, with a long pause and a leave/re-enter
      // latch. No startle, charge, roar, camera shake or root displacement.
      cooldown = Math.max(0, cooldown - dt)
      if (surfaceDistance > 3.2) armed = true
      const nearby = active && surfaceDistance < 2.2
      dwell = nearby ? dwell + dt : 0
      if (foot) {
        baseFoot.copy(foot.position)
        if (armed && cooldown === 0 && dwell > 1.6 && gesture < 0) {
          gesture = 0
          armed = false
          cooldown = 18
          count += 1
        }
        if (!active) gesture = -1
        if (gesture >= 0) {
          const previous = gesture
          gesture += dt
          // Lift just 4 cm over 0.8 s, then settle over another 1.1 s.
          const lift = gesture < 0.8
            ? MathUtils.smoothstep(gesture, 0, 0.8)
            : 1 - MathUtils.smoothstep(gesture, 0.8, 1.9)
          foot.updateWorldMatrix(true, false)
          foot.getWorldPosition(worldFoot)
          localFoot.copy(worldFoot)
          localFoot.y += lift * 0.04
          foot.parent!.worldToLocal(localFoot)
          foot.position.copy(localFoot)
          if (gesture >= 2.2) gesture = -1
          if (previous < 1.9 && previous + dt >= 1.9) return worldFoot.clone()
        }
      }
      return null
    },
  }
}
