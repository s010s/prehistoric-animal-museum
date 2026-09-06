import { readFileSync } from 'node:fs'
import { Bone, Box3, BoxGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, PropertyBinding, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createAnimalPresence, ENCOUNTER_ATTENTION_JOINTS } from '../src/viewer/scale-encounter-animal-presence'
import { loadTexturelessAnimal } from './helpers/load-textureless-animal'

function rig(parentYaw = 0) {
  const model = new Group()
  model.add(new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicMaterial()))
  const parent = new Bone()
  parent.name = 'neck'
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
      expect(Math.abs(presence.yawRadians)).toBeLessThanOrEqual(MathUtils.degToRad(26))
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

  it('corrects the real mammoth skin and bends its foreleg visibly without moving joint origins', async () => {
    const model = await loadTexturelessAnimal('mammoth')
    model.scale.setScalar(3.4 / new Box3().setFromObject(model, true).getSize(new Vector3()).y)
    model.updateMatrixWorld(true)
    let mesh!: SkinnedMesh
    model.traverse((object) => { if (object instanceof SkinnedMesh) mesh = object as SkinnedMesh })
    const sourceGeometry = mesh.geometry, sourceSkeleton = mesh.skeleton
    sourceSkeleton.update()
    const originalVertices = Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, i) => mesh.getVertexPosition(i, new Vector3()))
    const centre = new Box3().setFromObject(model, true).getCenter(new Vector3())
    const presence = createAnimalPresence('mammoth', model, centre.clone().add(new Vector3(0, 0, 12)))!
    expect(presence).not.toBeNull()
    mesh.skeleton.update()
    let restError = 0
    originalVertices.forEach((point, i) => { restError = Math.max(restError, point.distanceTo(mesh.getVertexPosition(i, new Vector3()))) })
    expect(restError).toBeLessThan(.00001)
    const upper = model.getObjectByName('leg_front_left') as Bone
    const lower = model.getObjectByName('encounter_mammoth_front_elbow') as Bone
    const upperStart = upper.quaternion.clone(), lowerStart = lower.quaternion.clone()
    const upperPosition = upper.position.clone(), lowerPosition = lower.position.clone()
    let impacts = 0, peakBend = 0, peakLift = 0
    const bottom = originalVertices.reduce((index, point, i) => point.y < originalVertices[index]!.y ? i : index, 0)
    // Use the actual left-front plantar vertices, not the joint origin.
    const positions = mesh.geometry.getAttribute('position')
    let footVertex = bottom
    for (let i = 0; i < positions.count; i++) if (positions.getY(i) < -.61 && positions.getX(i) < .15 && positions.getZ(i) > .15) { footVertex = i; break }
    const footStart = mesh.getVertexPosition(footVertex, new Vector3()).applyMatrix4(mesh.matrixWorld)
    function run(seconds: number, near = true) {
      for (let i = 0; i < seconds * 60; i++) {
        if (presence.update({ deltaSeconds: 1 / 60, visitorEye: centre.clone().add(new Vector3(0, 0, near ? 2.8 : 14)), active: true, reducedMotion: false })) impacts++
        model.updateMatrixWorld(true); mesh.skeleton.update()
        peakBend = Math.max(peakBend, lower.quaternion.angleTo(lowerStart))
        peakLift = Math.max(peakLift, mesh.getVertexPosition(footVertex, new Vector3()).applyMatrix4(mesh.matrixWorld).y - footStart.y)
      }
    }
    run(1); expect(presence.acknowledgementCount).toBe(0)
    run(30)
    expect(presence.acknowledgementCount).toBe(1)
    expect(impacts).toBe(1)
    expect(peakBend).toBeGreaterThan(MathUtils.degToRad(50))
    expect(peakLift).toBeGreaterThan(.15)
    expect(peakLift).toBeLessThan(.4)
    expect(upper.position).toEqual(upperPosition)
    expect(lower.position).toEqual(lowerPosition)
    run(2, false); run(5)
    expect(presence.acknowledgementCount).toBe(2)
    presence.update({ deltaSeconds: .1, visitorEye: centre, active: true, reducedMotion: true })
    expect(upper.quaternion.angleTo(upperStart)).toBeLessThan(.00001)
    expect(lower.quaternion.angleTo(lowerStart)).toBeLessThan(.00001)
    presence.dispose()
    expect(mesh.geometry).toBe(sourceGeometry)
    expect(mesh.skeleton).toBe(sourceSkeleton)
    expect(model.getObjectByName(lower.name)).toBeUndefined()
  })

  it('increases close attention through the neck chain and restores reduced motion immediately', () => {
    const { model, head } = rig()
    const presence = createAnimalPresence('tyrannosaurus-rex', model)!
    const input = { deltaSeconds: .1, visitorEye: new Vector3(15, 1, 15), active: true, reducedMotion: false }
    for (let i = 0; i < 80; i++) presence.update(input)
    const distant = Math.abs(presence.yawRadians)
    for (let i = 0; i < 80; i++) presence.update({ ...input, visitorEye: new Vector3(2, 1, 2) })
    expect(Math.abs(presence.yawRadians)).toBeGreaterThan(distant * 1.6)
    expect(head.parent!.quaternion.angleTo(new Quaternion())).toBeGreaterThan(head.quaternion.angleTo(new Quaternion()))
    presence.update({ ...input, reducedMotion: true })
    expect(head.quaternion.angleTo(new Quaternion())).toBeLessThan(.000001)
    expect(head.parent!.quaternion.angleTo(new Quaternion())).toBeLessThan(.000001)
    expect(createAnimalPresence('mosasaurus', model)).toBeNull()
    expect(createAnimalPresence('mammoth', model)).toBeNull()
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
      if (id !== 'mammoth') expect(createAnimalPresence(id as keyof typeof ENCOUNTER_ATTENTION_JOINTS, model), id).not.toBeNull()
    }
  })

  it('keeps coincident head and neck skin seams together at the larger turn on shipped rigs', async () => {
    for (const id of Object.keys(ENCOUNTER_ATTENTION_JOINTS)) {
      const model = await loadTexturelessAnimal(id)
      const bounds = new Box3().setFromObject(model, true)
      const size = bounds.getSize(new Vector3()).length()
      model.scale.setScalar(5 / size)
      model.updateMatrixWorld(true)
      const centre = new Box3().setFromObject(model, true).getCenter(new Vector3())
      const presence = createAnimalPresence(id as keyof typeof ENCOUNTER_ATTENTION_JOINTS, model, centre.clone().add(new Vector3(0, 0, 8)))!
      for (let i = 0; i < 90; i++) presence.update({ deltaSeconds: .1, visitorEye: centre.clone().add(new Vector3(2, 0, 2)), active: true, reducedMotion: false })
      model.updateMatrixWorld(true)
      let maximumGap = 0
      model.traverse((object) => {
        if (!(object instanceof SkinnedMesh)) return
        const skinned = object as SkinnedMesh
        skinned.skeleton.update()
        const positions = skinned.geometry.getAttribute('position')
        const matches = new Map<string, number>()
        for (let i = 0; i < positions.count; i++) {
          const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].join(',')
          const point = object.getVertexPosition(i, new Vector3()).applyMatrix4(object.matrixWorld)
          const previous = matches.get(key)
          if (previous !== undefined) {
            const gap = object.getVertexPosition(previous, new Vector3()).applyMatrix4(object.matrixWorld).distanceTo(point)
            maximumGap = Math.max(maximumGap, gap)
          } else matches.set(key, i)
        }
      })
      expect(maximumGap, `${id}: coincident skin seam gap`).toBeLessThan(.0001)
      presence.dispose()
    }
  }, 15_000)
})
