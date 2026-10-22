import { CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Matrix4 } from 'three'
import type { ScaleEncounterEnvironment } from '../viewer/scale-encounter-environment'
import type { ScaleEncounterDefinition } from '../viewer/scale-encounter'

import type { AnimationContactSamples, WalkContactSamples } from './expansion-manifest'

const entries = new Map<string, AnimationContactSamples>()
export function registerExpansionContactSamples(id: string, samples: AnimationContactSamples): void {
  if (import.meta.env.MODE === 'review') entries.set(`${id}:${samples.clip}`, samples)
}

export function getExpansionWalkSamples(id: string, sha: string | undefined): WalkContactSamples | undefined {
  const entry = entries.get(`${id}:Walk`)
  return entry && entry.modelSha256 === sha && entry.clip === 'Walk' ? entry as WalkContactSamples : undefined
}

/** Actual exported sole samples, interpolated on the active Walk clock.
 * Lifted feet lose contact opacity; samples are pinned to exact model bytes. */
export function installExpansionWalkContacts(environment: ScaleEncounterEnvironment, definition: ScaleEncounterDefinition, sha: string | undefined, clip = 'Walk'): number {
  const entry = entries.get(`${definition.id}:${clip}`)
  if (!entry || entry.modelSha256 !== sha || sha !== definition.calibratedModelSha256 ||
      definition.habitat !== 'land' || Math.abs(definition.displayedMeters - entry.meters) > 1e-6 ||
      definition.modelYawRadians !== 0 || !environment.groundHeightAtWorld || environment.disposeCandidate) return 0
  if (environment.root.getObjectByName('expansion-walk-contacts')) return entry.frames[0]!.feet.length
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
  const context = canvas.getContext('2d'); if (!context) return 0
  const mask = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  mask.addColorStop(0, '#fff'); mask.addColorStop(.45, '#ddd'); mask.addColorStop(1, '#000')
  context.fillStyle = mask; context.fillRect(0, 0, 128, 128)
  const texture = new CanvasTexture(canvas), geometry = new CircleGeometry(.5, 48)
  const root = new Group(); root.name = 'expansion-walk-contacts'
  root.userData = { animalId: definition.id, modelSha256: sha, clip }
  for (const foot of entry.frames[0]!.feet) {
    const material = new MeshBasicMaterial({ color: '#17160f', alphaMap: texture, opacity: .48, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    const mesh = new Mesh(geometry, material); mesh.name = foot.name
    mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1; root.add(mesh)
  }
  environment.root.add(root)
  updateExpansionWalkContacts(environment, definition.id, sha, 0, undefined, clip)
  return root.children.length
}
export function updateExpansionWalkContacts(environment: ScaleEncounterEnvironment | null, id: string, sha: string | undefined, time: number, transform?: Matrix4, clip = 'Walk'): void {
  const entry = entries.get(`${id}:${clip}`), root = environment?.root.getObjectByName('expansion-walk-contacts')
  if (!entry || !root || root.userData.clip !== clip || sha !== entry.modelSha256 || !environment?.groundHeightAtWorld) return
  const sample = ((time % entry.duration + entry.duration) % entry.duration) * entry.sampleRate
  const index = Math.floor(sample), alpha = sample - index
  const a = entry.frames[index]!, b = entry.frames[Math.min(index + 1, entry.frames.length - 1)]!
  root.children.forEach((child, i) => {
    const first = a.feet[i]!, next = b.feet[i]!
    const xyz = first.center.map((value, axis) => value + (next.center[axis]! - value) * alpha)
    const point = new Vector3(xyz[0], xyz[1], xyz[2]); if (transform) point.applyMatrix4(transform)
    const y = environment.groundHeightAtWorld!(point.x, point.z)
    const mesh = child as Mesh<CircleGeometry, MeshBasicMaterial>
    mesh.position.set(point.x, y + .002, point.z)
    mesh.scale.set(first.width * 1.32 + .04, first.depth * 1.32 + .04, 1)
    mesh.material.opacity = .48 * Math.max(0, 1 - Math.max(0, point.y - y) / .045)
    mesh.visible = Number.isFinite(y) && Math.abs(y) < .003
  })
}
