import { Bone, Float32BufferAttribute, MathUtils, Matrix4, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three'

export interface MammothForeleg {
  readonly upperLeg: Bone
  readonly lowerLeg: Bone
  readonly footInLowerLeg: Vector3
}

export interface MammothInteractionRig {
  readonly legs: readonly MammothForeleg[]
  dispose(): void
}

/** A leased correction for the shipped eight-joint mammoth, in its bind space.
 * Keep the source asset and exhibit skin intact. The original ear vertices are
 * fully head-weighted while the adjoining skin is partly root-weighted; the
 * same continuous field must cover both sides of those duplicated seams.
 */
export function prepareMammothInteractionRig(model: Object3D): MammothInteractionRig | null {
  let body: SkinnedMesh | undefined
  model.traverse((object) => {
    if (object instanceof SkinnedMesh && object.skeleton.bones.length === 8 &&
      object.skeleton.bones[0]?.name === 'root' && object.skeleton.bones[1]?.name === 'head') body = object as SkinnedMesh
  })
  if (!body) return null
  const mesh = body
  const originalGeometry = mesh.geometry
  const originalSkeleton = mesh.skeleton
  const legIndices = ['leg_front_left', 'leg_front_right'].map((name) => originalSkeleton.bones.findIndex((bone) => bone.name === name))
  if (legIndices.some((index) => index < 0)) return null
  const geometry = originalGeometry.clone()
  const positions = geometry.getAttribute('position')
  const sourceIndices = geometry.getAttribute('skinIndex')
  const sourceWeights = geometry.getAttribute('skinWeight')
  if (!sourceIndices || !sourceWeights) { geometry.dispose(); return null }
  // The compressed source mesh uses this normalized coordinate volume.
  // Derive joint coordinates from inverse binds, never from a live idle pose.
  const legs = legIndices.map((legIndex, side) => {
    const upperLeg = originalSkeleton.bones[legIndex]!
    const inverseUpperBind = originalSkeleton.boneInverses[legIndex]!
    const z = side === 0 ? .235 : -.195
    const lowerLeg = new Bone()
    lowerLeg.name = side === 0 ? 'encounter_mammoth_front_elbow' : 'encounter_mammoth_front_elbow_right'
    lowerLeg.position.set(.055, -.29, z).applyMatrix4(inverseUpperBind)
    upperLeg.add(lowerLeg)
    const inverseBind = new Matrix4().makeTranslation(
      -lowerLeg.position.x, -lowerLeg.position.y, -lowerLeg.position.z,
    ).multiply(inverseUpperBind)
    return { upperLeg, lowerLeg, inverseBind, footInLowerLeg: new Vector3(.065, -.625, z).applyMatrix4(inverseBind) }
  })
  const kneeIndex = originalSkeleton.bones.length
  const skeleton = new Skeleton(
    [...originalSkeleton.bones, ...legs.map((leg) => leg.lowerLeg)],
    [...originalSkeleton.boneInverses.map((matrix) => matrix.clone()), ...legs.map((leg) => leg.inverseBind)],
  )
  const indices = new Uint16BufferAttribute(new Uint16Array(positions.count * 4), 4)
  const weights = new Float32BufferAttribute(new Float32Array(positions.count * 4), 4)
  const influences = new Float64Array(kneeIndex + legs.length)
  for (let i = 0; i < positions.count; i++) {
    influences.fill(0)
    for (let slot = 0; slot < 4; slot++) influences[sourceIndices.getComponent(i, slot)]! += sourceWeights.getComponent(i, slot)
    const x = positions.getX(i), y = positions.getY(i)
    const headField = (1 - MathUtils.smoothstep(x, -.04, .27)) * MathUtils.smoothstep(y, -.12, .10)
    const headWeight = Math.max(influences[1]!, headField)
    const remainder = 1 - influences[1]!
    const factor = remainder > .00001 ? (1 - headWeight) / remainder : 0
    for (let joint = 0; joint < kneeIndex; joint++) influences[joint]! *= factor
    influences[1] = headWeight
    legIndices.forEach((legIndex, side) => {
      const lowerWeight = influences[legIndex]! * (1 - MathUtils.smoothstep(y, -.39, -.19))
      influences[legIndex]! -= lowerWeight
      influences[kneeIndex + side] = lowerWeight
    })
    const strongest = Array.from(influences, (weight, joint) => ({ weight, joint }))
      .sort((a, b) => b.weight - a.weight).slice(0, 4)
    const sum = strongest.reduce((total, entry) => total + entry.weight, 0) || 1
    strongest.forEach((entry, slot) => {
      indices.setComponent(i, slot, entry.joint)
      weights.setComponent(i, slot, entry.weight / sum)
    })
  }
  geometry.setAttribute('skinIndex', indices)
  geometry.setAttribute('skinWeight', weights)
  mesh.geometry = geometry
  mesh.skeleton = skeleton
  let disposed = false
  return {
    legs,
    dispose: () => {
      if (disposed) return
      disposed = true
      mesh.geometry = originalGeometry
      mesh.skeleton = originalSkeleton
      legs.forEach((leg) => leg.lowerLeg.removeFromParent())
      geometry.dispose()
      skeleton.dispose()
    },
  }
}
