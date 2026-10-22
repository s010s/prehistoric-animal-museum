import { CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Matrix4 } from 'three'
import { idleContacts } from 'virtual:canonical-comparison-extension'
import type { CanonicalIdleContactSamples } from '../scale-encounter/canonical-extension'
import type { ScaleEncounterDefinition } from './scale-encounter'
import type { ScaleEncounterEnvironment } from './scale-encounter-environment'

const groupName = 'animal-idle-contact-shadows'

/** The build resolver exports entries only for the selected canonical catalog. */
export function publicIdleContactEntry(id: string): CanonicalIdleContactSamples | undefined {
  return idleContacts[id]
}

export function installPublicIdleContacts(
  environment: ScaleEncounterEnvironment,
  definition: ScaleEncounterDefinition,
  loadedModelSha256: string | undefined,
): number {
  const entry = publicIdleContactEntry(definition.id)
  if (!entry || entry.modelSha256 !== loadedModelSha256 ||
      loadedModelSha256 !== definition.calibratedModelSha256 || definition.habitat !== 'land' ||
      Math.abs(definition.displayedMeters - entry.meters) > 1e-6 || definition.modelYawRadians !== 0 ||
      !environment.groundHeightAtWorld || environment.disposeCandidate) return 0
  if (environment.root.getObjectByName(groupName)) return entry.frames[0]!.feet.length
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return 0
  const mask = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  mask.addColorStop(0, '#fff'); mask.addColorStop(.45, '#ddd'); mask.addColorStop(1, '#000')
  context.fillStyle = mask; context.fillRect(0, 0, 128, 128)
  const texture = new CanvasTexture(canvas)
  const geometry = new CircleGeometry(.5, 48)
  const root = new Group()
  root.name = groupName
  root.userData = { animalId: definition.id, modelSha256: loadedModelSha256, clip: 'Idle' }
  for (const foot of entry.frames[0]!.feet) {
    const material = new MeshBasicMaterial({ color: '#17160f', alphaMap: texture, opacity: .48,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    const mesh = new Mesh(geometry, material)
    mesh.name = foot.name; mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1
    root.add(mesh)
  }
  environment.root.add(root)
  updatePublicIdleContacts(environment, definition.id, loadedModelSha256, 0)
  return root.children.length
}

export function updatePublicIdleContacts(
  environment: ScaleEncounterEnvironment | null,
  id: string,
  loadedModelSha256: string | undefined,
  timeSeconds: number,
  transform?: Matrix4,
): void {
  const entry = publicIdleContactEntry(id)
  const root = environment?.root.getObjectByName(groupName)
  if (!entry || !root || root.userData.animalId !== id || root.userData.clip !== 'Idle' ||
      loadedModelSha256 !== entry.modelSha256 || !environment?.groundHeightAtWorld ||
      !Number.isFinite(timeSeconds)) return
  const sample = ((timeSeconds % entry.duration + entry.duration) % entry.duration) * entry.sampleRate
  const index = Math.floor(sample), alpha = sample - index
  const a = entry.frames[Math.min(index, entry.frames.length - 1)]!
  const b = entry.frames[Math.min(index + 1, entry.frames.length - 1)]!
  root.children.forEach((child, i) => {
    const first = a.feet[i]!, next = b.feet[i]!
    const xyz = first.center.map((value, axis) => value + (next.center[axis]! - value) * alpha)
    const point = new Vector3(xyz[0], xyz[1], xyz[2])
    if (transform) point.applyMatrix4(transform)
    const y = environment.groundHeightAtWorld!(point.x, point.z)
    const mesh = child as Mesh<CircleGeometry, MeshBasicMaterial>
    mesh.position.set(point.x, y + .002, point.z)
    mesh.scale.set(first.width * 1.32 + .04, first.depth * 1.32 + .04, 1)
    mesh.material.opacity = .48 * Math.max(0, 1 - Math.max(0, point.y - y) / .045)
    mesh.visible = Number.isFinite(y) && Math.abs(y) < .003
  })
}
