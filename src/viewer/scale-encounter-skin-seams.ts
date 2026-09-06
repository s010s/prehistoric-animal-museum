import { type Bone, Float32BufferAttribute, MathUtils, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three'

/** Reconcile duplicated skin vertices only where the added neck motion would
 * separate them. Descendants with the same attention owner (e.g. jaw and head)
 * retain their independent authored motion. A narrow feather avoids a hard
 * weight ring beside the corrected seam. All source geometry is restored. */
export function prepareAttentionSkinSeams(model: Object3D, chain: readonly Bone[]) {
  const restores: (() => void)[] = []
  model.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return
    const mesh = object as SkinnedMesh
    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    const indices = geometry.getAttribute('skinIndex')
    const weights = geometry.getAttribute('skinWeight')
    if (!indices || !weights) return
    const owners = mesh.skeleton.bones.map((bone) => {
      for (let cursor: Object3D | null = bone; cursor; cursor = cursor.parent) {
        const index = chain.indexOf(cursor as Bone)
        if (index >= 0) return index
      }
      return -1
    })
    const groups = new Map<string, number[]>()
    for (let i = 0; i < position.count; i++) {
      const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`
      const group = groups.get(key)
      if (group) group.push(i)
      else groups.set(key, [i])
    }
    const seams: { point: Vector3; weights: Map<number, number> }[] = []
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const attention = group.map((i) => {
        const values = new Float64Array(chain.length)
        for (let slot = 0; slot < 4; slot++) {
          const owner = owners[indices.getComponent(i, slot)]!
          if (owner >= 0) values[owner]! += weights.getComponent(i, slot)
        }
        return values
      })
      if (!attention.some((values) => values.some((weight, i) => Math.abs(weight - attention[0]![i]!) > .0001))) continue
      const averaged = new Map<number, number>()
      for (const i of group) for (let slot = 0; slot < 4; slot++) {
        const joint = indices.getComponent(i, slot)
        averaged.set(joint, (averaged.get(joint) ?? 0) + weights.getComponent(i, slot) / group.length)
      }
      seams.push({ point: new Vector3().fromBufferAttribute(position, group[0]!), weights: averaged })
    }
    if (seams.length === 0) return
    geometry.computeBoundingBox()
    const radius = geometry.boundingBox!.getSize(new Vector3()).length() * .012
    const clone = geometry.clone()
    const correctedIndices = new Uint16BufferAttribute(new Uint16Array(position.count * 4), 4)
    const correctedWeights = new Float32BufferAttribute(new Float32Array(position.count * 4), 4)
    const point = new Vector3()
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i)
      let nearest: typeof seams[number] | undefined
      let distance = radius
      for (const seam of seams) {
        const candidate = point.distanceTo(seam.point)
        if (candidate < distance) { distance = candidate; nearest = seam }
      }
      const blend = nearest ? 1 - MathUtils.smoothstep(distance, 0, radius) : 0
      const merged = new Map<number, number>()
      for (let slot = 0; slot < 4; slot++) {
        const joint = indices.getComponent(i, slot)
        merged.set(joint, (merged.get(joint) ?? 0) + weights.getComponent(i, slot) * (1 - blend))
      }
      if (nearest) for (const [joint, weight] of nearest.weights) merged.set(joint, (merged.get(joint) ?? 0) + weight * blend)
      const strongest = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4)
      const sum = strongest.reduce((total, [, weight]) => total + weight, 0) || 1
      strongest.forEach(([joint, weight], slot) => {
        correctedIndices.setComponent(i, slot, joint)
        correctedWeights.setComponent(i, slot, weight / sum)
      })
    }
    clone.setAttribute('skinIndex', correctedIndices)
    clone.setAttribute('skinWeight', correctedWeights)
    mesh.geometry = clone
    restores.push(() => { mesh.geometry = geometry; clone.dispose() })
  })
  let disposed = false
  return { dispose: () => { if (!disposed) { disposed = true; restores.forEach((restore) => restore()) } } }
}
