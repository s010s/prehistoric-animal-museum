import { motionFootprints } from 'virtual:canonical-comparison-extension'
import { Vector3, type Object3D } from 'three'
import { convexGroundFootprint, createAnimalGroundFootprint } from './scale-encounter-ground-footprint'
import footprints from './scale-encounter-motion-footprints.json'
import type { ScaleEncounterDefinition } from './scale-encounter'

export interface ReviewMotionFootprint {
  readonly modelSha256: string
  readonly clip: string
  readonly duration: number
  readonly sampleCount: number
  readonly points: readonly (readonly [number, number])[]
}
const reviewFootprints = new Map<string, ReviewMotionFootprint>()
export function registerReviewMotionFootprint(id: string, footprint: ReviewMotionFootprint): void {
  if ((import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE !== 'review' || !id.startsWith('expansion-')) throw new Error('Private review footprint only')
  reviewFootprints.set(id, footprint)
}

/** A fixed swept area prevents an idle tail from entering a stationary child.
 * The bake uses calibrated world metres, including the authored animal offset.
 * Padding covers interpolation between offline animation samples. */
export function createEncounterMotionFootprint(definition: ScaleEncounterDefinition, staticReviewModel?: Object3D): readonly Vector3[] {
  const entry = reviewFootprints.get(definition.id) ?? motionFootprints[definition.id] ?? footprints[definition.id as keyof typeof footprints]
  const staticReview = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === 'review' && definition.id.startsWith('expansion-') && staticReviewModel
  if (!staticReview && (!entry || entry.modelSha256 !== definition.calibratedModelSha256)) {
    throw new Error(`Rebake encounter motion footprint for ${definition.id}`)
  }
  const hull = staticReview
    ? createAnimalGroundFootprint(staticReviewModel)
    : convexGroundFootprint(entry.points.map(([x, z]) => new Vector3(x, 0, z)))
  // Bound collision work independently of source vertex count. Supporting
  // lines circumscribe the sampled hull; they never cut across a tail tip.
  const sides = 48
  const supports = Array.from({length: sides}, (_, index) => {
    const angle = index * Math.PI * 2 / sides
    const x = Math.cos(angle), z = Math.sin(angle)
    return {x, z, distance: Math.max(...hull.map(point => point.x * x + point.z * z)) + .08}
  })
  return supports.map((a, index) => {
    const b = supports[(index + 1) % sides]!
    const determinant = a.x * b.z - a.z * b.x
    return new Vector3((a.distance * b.z - a.z * b.distance) / determinant, 0,
      (a.x * b.distance - a.distance * b.x) / determinant)
  })
}
