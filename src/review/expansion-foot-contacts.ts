import {
  CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial,
} from 'three'
import type { ScaleEncounterDefinition } from '../viewer/scale-encounter'
import type { ScaleEncounterEnvironment } from '../viewer/scale-encounter-environment'
import contacts from './expansion-foot-contacts.json'

/** Supplemental sole contact only for hash-locked, stationary private review
 * clips. World-metre landmarks were measured from final GLBs at frame zero;
 * independent 193-frame scans confirm the feet do not move. See private
 * comparison-foot-contact-landmarks.json for extraction and floor evidence.
 * The environment owns/disposes these generated textures and meshes. */
export function installExpansionFootContacts(
  environment: ScaleEncounterEnvironment,
  definition: ScaleEncounterDefinition,
  loadedSha256: string | undefined,
): number {
  if (import.meta.env.MODE !== 'review' || definition.habitat !== 'land') return 0
  const entry = contacts[definition.id as keyof typeof contacts]
  const ground = environment.groundHeightAtWorld
  if (!entry || !ground || environment.disposeCandidate ||
      entry.sha256 !== loadedSha256 ||
      entry.sha256 !== definition.calibratedModelSha256 ||
      definition.modelYawRadians !== 0 ||
      Math.abs(definition.displayedMeters - entry.metres) > 1e-6 ||
      Math.abs(definition.animalPosition.x - 2.2) > 1e-6 ||
      Math.abs(definition.animalPosition.y) > 1e-6 ||
      Math.abs(definition.animalPosition.z) > 1e-6) return 0
  // Fail closed if a later environment changes the reviewed flat support.
  const heights = entry.feet.map(([x, z]) => ground(x!, z!))
  if (heights.some(y => !Number.isFinite(y) || Math.abs(y) > 0.003)) return 0
  if (environment.root.getObjectByName('expansion-foot-contacts')) return entry.feet.length

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return 0
  const mask = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  mask.addColorStop(0, '#ffffff')
  mask.addColorStop(0.42, '#f5f5f5')
  mask.addColorStop(0.7, '#969696')
  mask.addColorStop(1, '#000000')
  context.fillStyle = mask
  context.fillRect(0, 0, 128, 128)
  const texture = new CanvasTexture(canvas)
  const material = new MeshBasicMaterial({
    color: '#17160f', alphaMap: texture, opacity: 0.48,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  const geometry = new CircleGeometry(0.5, 48)
  const root = new Group()
  root.name = 'expansion-foot-contacts'
  root.userData = { animalId: definition.id, modelSha256: loadedSha256, source: 'measured-stationary-soles', count: entry.feet.length }
  entry.feet.forEach(([x, z, width, depth], index) => {
    const cue = new Mesh(geometry, material)
    cue.name = `expansion-foot-contact-${index}`
    cue.rotation.x = -Math.PI / 2
    cue.position.set(x!, heights[index]! + 0.002, z)
    // A short soft fringe around the measured sole, not a body-wide oval.
    cue.scale.set(width! * 1.32 + 0.04, depth! * 1.32 + 0.04, 1)
    cue.renderOrder = 1
    root.add(cue)
  })
  environment.root.add(root)
  return root.children.length
}
