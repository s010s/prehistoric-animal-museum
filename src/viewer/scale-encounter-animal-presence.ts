import { Bone, Box3, MathUtils, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three'
import type { ScaleEncounterAnimalId } from './scale-encounter'
import { prepareMammothInteractionRig } from './scale-encounter-mammoth-rig'
import { prepareAttentionSkinSeams } from './scale-encounter-skin-seams'

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
  dispose(): void
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
  const mammothRig = animalId === 'mammoth' ? prepareMammothInteractionRig(model) : null
  // Do not animate an uncorrected mammoth: the original ear seam is unsafe.
  if (animalId === 'mammoth' && !mammothRig) return null
  const chain: Bone[] = [head as Bone]
  for (let parent = head.parent; parent instanceof Bone && /^neck/i.test(parent.name); parent = parent.parent) chain.unshift(parent as Bone)
  const baseRotations = chain.map(() => new Quaternion())
  model.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(model, true)
  const centre = bounds.getCenter(new Vector3())
  const headPoint = head.getWorldPosition(new Vector3())
  // Preserve the authored arrival pose. React to changes in the child's
  // bearing around the body; a source rig's head pivot is not necessarily at
  // its visible face (the mammoth's is several metres from the nose).
  const forward = (visitorStart ? new Vector3().copy(visitorStart) : headPoint.clone()).sub(centre).setY(0)
  if (forward.lengthSq() < 0.0001) { mammothRig?.dispose(); return null }
  forward.normalize()
  const skinSeams = prepareAttentionSkinSeams(model, [...chain, ...(mammothRig?.legs.flatMap((leg) => [leg.upperLeg, leg.lowerLeg]) ?? [])])
  let selectedLeg = mammothRig?.legs[0]
  const baseUpper = new Quaternion()
  const baseLower = new Quaternion()
  const parentRotation = new Quaternion()
  const localUp = new Vector3()
  const direction = new Vector3()
  const offset = new Quaternion()
  const worldFoot = new Vector3()
  const bendAxis = new Vector3()
  let applied = false
  let yaw = 0
  let dwell = 0
  let cooldown = 0
  let gesture = -1
  let armed = true
  let count = 0
  const maximumYaw = MathUtils.degToRad(animalId === 'pteranodon' ? 16 : animalId === 'mammoth' ? 20 : chain.length === 1 ? 16 : 26)

  function restore() {
    if (!applied) return
    chain.forEach((bone, index) => bone.quaternion.copy(baseRotations[index]!))
    if (selectedLeg) {
      selectedLeg.upperLeg.quaternion.copy(baseUpper)
      selectedLeg.lowerLeg.quaternion.copy(baseLower)
    }
    applied = false
  }

  return {
    restore,
    dispose: () => { restore(); skinSeams.dispose(); mammothRig?.dispose() },
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
      const attentionStrength = MathUtils.lerp(1, .48, MathUtils.smoothstep(surfaceDistance, .5, 9))
      const facingFade = MathUtils.smoothstep(facing, -.35, .1)
      const desiredYaw = active && facing > -0.15
        ? MathUtils.clamp(Math.atan2(
          forward.z * direction.x - forward.x * direction.z, facing,
        ) * 1.4, -maximumYaw * attentionStrength, maximumYaw * attentionStrength) * facingFade : 0
      yaw = MathUtils.damp(yaw, desiredYaw, 1.65, dt)
      // Spread the rotation through the real neck chain. Eyes, jaw, horns and
      // other descendants follow their owning joints without separate offsets.
      chain.forEach((bone, index) => {
        baseRotations[index]!.copy(bone.quaternion)
        bone.parent!.getWorldQuaternion(parentRotation).invert()
        localUp.set(0, 1, 0).applyQuaternion(parentRotation)
        const share = chain.length === 1 ? 1 : index === chain.length - 1 ? .35 : .65 / (chain.length - 1)
        offset.setFromAxisAngle(localUp, yaw * share)
        bone.quaternion.premultiply(offset)
        bone.updateWorldMatrix(false, false)
      })
      applied = true

      // A quiet weight adjustment, with a long pause and a leave/re-enter
      // latch. No startle, charge, roar, camera shake or root displacement.
      cooldown = Math.max(0, cooldown - dt)
      if (surfaceDistance > 3.2) armed = true
      const nearby = active && surfaceDistance < 3
      dwell = nearby ? dwell + dt : 0
      if (mammothRig) {
        if (armed && cooldown === 0 && dwell > 1.6 && gesture < 0) {
          // Make the visible near-side foreleg answer the child.
          let nearest = Infinity
          for (const leg of mammothRig.legs) {
            leg.lowerLeg.updateWorldMatrix(true, false)
            worldFoot.copy(leg.footInLowerLeg).applyMatrix4(leg.lowerLeg.matrixWorld)
            const distance = Math.hypot(worldFoot.x - visitorEye.x, worldFoot.z - visitorEye.z)
            if (distance < nearest) { nearest = distance; selectedLeg = leg }
          }
          gesture = 0
          armed = false
          cooldown = 18
          count += 1
        }
        const { upperLeg, lowerLeg, footInLowerLeg } = selectedLeg!
        baseUpper.copy(upperLeg.quaternion)
        baseLower.copy(lowerLeg.quaternion)
        if (!active) gesture = -1
        if (gesture >= 0) {
          const previous = gesture
          gesture += dt
          // Flex the foreleg around its shoulder and elbow, preserving segment
          // lengths. A short hold makes the raised foot readable from child height.
          const lift = gesture < .9 ? MathUtils.smoothstep(gesture, 0, .9)
            : 1 - MathUtils.smoothstep(gesture, 1.25, 2.55)
          // Source mammoth faces -X; +Z is its anatomical bend axis. Convert
          // through the rig root so turning the model never changes the bend.
          bendAxis.set(0, 0, 1)
          offset.setFromAxisAngle(bendAxis, MathUtils.degToRad(25) * lift)
          upperLeg.quaternion.premultiply(offset)
          upperLeg.getWorldQuaternion(parentRotation).invert()
          upperLeg.parent!.getWorldQuaternion(offset)
          bendAxis.set(0, 0, 1).applyQuaternion(offset).applyQuaternion(parentRotation)
          lowerLeg.quaternion.premultiply(offset.setFromAxisAngle(bendAxis, MathUtils.degToRad(-55) * lift))
          lowerLeg.updateWorldMatrix(true, false)
          worldFoot.copy(footInLowerLeg).applyMatrix4(lowerLeg.matrixWorld)
          if (gesture >= 2.8) gesture = -1
          if (previous < 2.55 && previous + dt >= 2.55) return worldFoot.clone()
        }
      }
      return null
    },
  }
}
