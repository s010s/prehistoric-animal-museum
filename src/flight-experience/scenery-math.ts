import type { BufferGeometry } from 'three'
import { hash } from './world'
export function deformRock(geometry: BufferGeometry) {
  const p = geometry.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const f = .8 + hash(Math.round(x * 1e5), Math.round(z * 1e5), Math.round(y * 1e5)) * .35
    p.setXYZ(i, x * f, y * f * .7, z * f)
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere()
}
const TAU = Math.PI * 2
export const wrapPhase = (n: number) => ((n % TAU) + TAU) % TAU
export function waterPhases(x: number, z: number, time: number): [number, number] {
  return [wrapPhase(x * .035 + z * .045 + time * .55), wrapPhase(x * .09 - z * .055 + time * .7)]
}
export function waterNormal(x: number, z: number, time: number): [number, number, number] {
  const [a, b] = waterPhases(x, z, time), dx = Math.cos(a) * .035 * .8 + Math.cos(b) * .09 * .25, dz = Math.cos(a) * .045 * .8 - Math.cos(b) * .055 * .25
  const length = Math.hypot(dx, 1, dz); return [-dx / length, 1 / length, -dz / length]
}
