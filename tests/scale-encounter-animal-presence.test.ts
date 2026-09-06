import { readFileSync } from 'node:fs'
import { Bone, BoxGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, PropertyBinding, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createAnimalPresence, ENCOUNTER_ATTENTION_JOINTS } from '../src/viewer/scale-encounter-animal-presence'

function rig(parentYaw = 0) {
  const model = new Group()
  model.add(new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicMaterial()))
  const parent = new Bone()
  parent.rotation.y = parentYaw
  const head = new Bone()
  head.name = 'head'
  head.position.set(2, 1, 0).applyAxisAngle(new Vector3(0, 1, 0), -parentYaw)
  parent.add(head); model.add(parent)
  const foot = new Bone(); foot.name = 'leg_front_left'; foot.position.set(1, 0, 0)
  model.add(foot)
  model.updateMatrixWorld(true)
  return { model, head, foot }
}

describe('gentle animal attention', () => {
  it('follows the child through differently oriented rig parents, stays bounded, and restores the authored pose', () => {
    for (const rotation of [0, .8, -1.4]) {
      const { model, head } = rig(rotation)
      const original = head.quaternion.clone()
      const presence = createAnimalPresence('tyrannosaurus-rex', model)!
      for (let i = 0; i < 300; i++) {
        presence.restore()
        // Emulate a live animation mixer, including a changing base pose.
        head.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), .03)
        presence.update({ deltaSeconds: 1 / 60, visitorEye: new Vector3(3, 1, 3), active: true, reducedMotion: false })
      }
      expect(presence.yawRadians).toBeLessThan(-.16)
      expect(Math.abs(presence.yawRadians)).toBeLessThanOrEqual(MathUtils.degToRad(10))
      presence.restore()
      expect(head.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .03))).toBeLessThan(.000001)
      head.quaternion.copy(original)
      const rootPosition = model.position.clone()
      for (let i = 0; i < 300; i++) presence.update({ deltaSeconds: 1 / 60, visitorEye: new Vector3(-5, 1, 0), active: true, reducedMotion: false })
      expect(Math.abs(presence.yawRadians)).toBeLessThan(.001)
      expect(model.position).toEqual(rootPosition)
      presence.restore()
      expect(head.quaternion.angleTo(original)).toBeLessThan(.000001)
    }
  })

  it('acknowledges a sustained approach once, with a 4 cm foot lift and a leave/re-enter latch', () => {
    const { model, foot } = rig()
    const presence = createAnimalPresence('mammoth', model)!
    let impacts = 0
    let maximumLift = 0
    function run(seconds: number, near = true) {
      for (let i = 0; i < seconds * 60; i++) {
        const impact = presence.update({ deltaSeconds: 1 / 60, visitorEye: new Vector3(near ? 3 : 12, 1, 1), active: true, reducedMotion: false })
        maximumLift = Math.max(maximumLift, foot.position.y)
        if (impact) impacts++
      }
    }
    run(1)
    expect(presence.acknowledgementCount).toBe(0)
    run(30)
    expect(presence.acknowledgementCount).toBe(1)
    expect(impacts).toBe(1)
    expect(maximumLift).toBeGreaterThan(.039)
    expect(maximumLift).toBeLessThanOrEqual(.04001)
    run(2, false); run(5)
    expect(presence.acknowledgementCount).toBe(2)
    expect(impacts).toBe(2)
    presence.restore()
    expect(foot.position.y).toBe(0)
  })

  it('restores immediately for reduced motion and does not apply unsupported rig guesses', () => {
    const { model, head, foot } = rig()
    const presence = createAnimalPresence('mammoth', model)!
    const input = { deltaSeconds: .1, visitorEye: new Vector3(3, 1, 1), active: true, reducedMotion: false }
    for (let i = 0; i < 22; i++) presence.update(input)
    expect(foot.position.y).toBeGreaterThan(0)
    presence.update({ ...input, reducedMotion: true })
    expect(foot.position.y).toBe(0)
    expect(head.quaternion.angleTo(new Quaternion())).toBeLessThan(.000001)
    expect(createAnimalPresence('mosasaurus', model)).toBeNull()
    expect(createAnimalPresence('mammoth', new Group())).toBeNull()
  })

  it('keeps the arrival pose even with a remote head pivot and detects approach at the visible body', () => {
    const { model, head, foot } = rig()
    head.position.set(-5, 2, 0)
    model.scale.setScalar(.5)
    const presence = createAnimalPresence('mammoth', model, new Vector3(8, 1, 0))!
    let highestWorldFoot = 0
    for (let i = 0; i < 250; i++) {
      presence.update({ deltaSeconds: 1 / 60, visitorEye: new Vector3(2, 1, 0), active: true, reducedMotion: false })
      highestWorldFoot = Math.max(highestWorldFoot, foot.getWorldPosition(new Vector3()).y)
    }
    expect(presence.yawRadians).toBe(0)
    expect(presence.acknowledgementCount).toBe(1)
    expect(highestWorldFoot).toBeGreaterThan(.039)
    expect(highestWorldFoot).toBeLessThanOrEqual(.04001)
    presence.restore()
  })

  it('uses unique head joints actually present in each shipped GLB skin', () => {
    for (const [id, joint] of Object.entries(ENCOUNTER_ATTENTION_JOINTS)) {
      const bytes = readFileSync(`src/content/animals/${id}/model/model.glb`)
      const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
        nodes: { name?: string }[]; skins: { joints: number[] }[]
      }
      const joints = new Set(document.skins.flatMap((skin) => skin.joints))
      expect([...joints].filter((i) => document.nodes[i]?.name === joint), id).toHaveLength(1)
      const { model, head } = rig()
      head.name = PropertyBinding.sanitizeNodeName(joint)
      expect(createAnimalPresence(id as keyof typeof ENCOUNTER_ATTENTION_JOINTS, model), id).not.toBeNull()
    }
  })
})
