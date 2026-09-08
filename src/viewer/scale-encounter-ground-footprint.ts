import { Mesh, SkinnedMesh, Vector3, type Object3D } from 'three'

/** Conservative convex projection of the posed animal, including raised limbs.
 * Unlike its bounding rectangle this leaves empty head-side corners walkable. */
export function createAnimalGroundFootprint(model: Object3D): readonly Vector3[] {
  model.updateWorldMatrix(true, true)
  const points: Vector3[] = []
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    if (mesh instanceof SkinnedMesh) mesh.skeleton.update()
    const position = (mesh as Mesh).geometry.getAttribute('position')
    if (!position) return
    for (let i = 0; i < position.count; i++) {
      points.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld).setY(0))
    }
  })
  points.sort((a, b) => a.x - b.x || a.z - b.z)
  const turn = (a: Vector3, b: Vector3, c: Vector3) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  const half = (ordered: readonly Vector3[]) => {
    const hull: Vector3[] = []
    for (const point of ordered) {
      while (hull.length >= 2 && turn(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop()
      hull.push(point)
    }
    hull.pop()
    return hull
  }
  return [...half(points), ...half([...points].reverse())]
}

export function clearsAnimalGroundFootprint(eye: Readonly<Vector3>, hull: readonly Vector3[], margin: number): boolean {
  return hull.some((a, index) => {
    const b = hull[(index + 1) % hull.length]!
    const dx = b.x - a.x, dz = b.z - a.z
    return dx * (eye.z - a.z) - dz * (eye.x - a.x) <= -margin * Math.hypot(dx, dz)
  })
}
