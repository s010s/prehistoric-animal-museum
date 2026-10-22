import { Matrix4, PropertyBinding, type Vector3, type AnimationAction, type AnimationClip, type AnimationMixer, type Object3D } from 'three'
import type { WalkContactSamples } from './expansion-manifest'
import type { ScaleEncounterEnvironment } from '../viewer/scale-encounter-environment'
import type { ScaleEncounterPlacement } from '../viewer/scale-encounter'
import { getExpansionWalkSamples } from './expansion-walk-contacts'

/** Local evidence route: no repeat/reset of world translation at clip boundaries. */
export interface ExpansionWorldWalk {
  readonly walk: AnimationAction
  readonly idle: AnimationAction
  readonly speed: number
  readonly cruiseSeconds: number
  readonly duration: number
  readonly terrainSampleCount: number
  readonly terrainMaxError: number
  readonly legs: Object3D[]
  readonly matrix: Matrix4
  elapsed: number
  animationSeconds: number
  distance: number
  contactTime: number
  phase: 'walking' | 'decelerating' | 'idle'
  heldLegs: { object: Object3D; position: Vector3; quaternion: Object3D['quaternion']; scale: Vector3 }[]
  idleStarted: boolean
}
function clock(elapsed: number, cruise: number) {
  if (elapsed <= cruise) return { animation: elapsed, rate: 1 }
  const u = Math.min(1, (elapsed - cruise) / 4)
  return { animation: cruise + 4 * (u - u ** 3 + .5 * u ** 4), rate: 1 - 3 * u ** 2 + 2 * u ** 3 }
}
function feetAt(samples: WalkContactSamples, time: number) {
  const f = (time % samples.duration) * samples.sampleRate, i = Math.floor(f), t = f - i
  const a = samples.frames[i]!, b = samples.frames[Math.min(i + 1, samples.frames.length - 1)]!
  return a.feet.map((foot, n) => foot.center.map((v, j) => v + (b.feet[n]!.center[j]! - v) * t))
}
export function createExpansionWorldWalk(id: string, sha: string | undefined, mixer: AnimationMixer, walk: AnimationAction, clips: readonly AnimationClip[], model: Object3D, environment: ScaleEncounterEnvironment | null): ExpansionWorldWalk | null {
  if (import.meta.env.MODE !== 'review' || walk.getClip().name !== 'Walk') return null
  const samples = getExpansionWalkSamples(id, sha), idleClip = clips.find(clip => clip.name === 'Idle')
  if (!samples) return null
  if (!idleClip || !environment?.groundHeightAtWorld) throw new Error('review-walk-route-ground-or-idle-unavailable')
  const speed = samples.speedMetersPerSecond ?? (id === 'expansion-gallimimus' ? .3500001132488251 : .10010366886854172)
  if (!Number.isFinite(speed) || speed <= 0 || speed > 2) throw new Error('review-walk-speed-invalid')
  const cruiseSeconds = samples.cruiseSeconds ?? (id === 'expansion-gallimimus' ? 24.125 : 24)
  const duration = cruiseSeconds + 4
  let terrainMaxError = 0, terrainSampleCount = 0
  // Validate the whole finite route using actual moving sole positions, not only its centre.
  for (let t = 0; t <= duration + 1 / 24; t += 1 / 24) {
    const animation = clock(Math.min(t, duration), cruiseSeconds).animation
    for (const [index, foot] of feetAt(samples, animation).entries()) {
      const width = Math.max(...samples.frames.map(frame => frame.feet[index]!.width))
      const depth = Math.max(...samples.frames.map(frame => frame.feet[index]!.depth))
      for (const [dx, dz] of [[0, 0], [-width / 2, -depth / 2], [-width / 2, depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2]]) {
        const y = environment.groundHeightAtWorld(foot[0]! - speed * animation + dx!, foot[2]! + dz!)
        if (!Number.isFinite(y)) throw new Error('review-walk-route-ground-invalid')
        terrainMaxError = Math.max(terrainMaxError, Math.abs(y)); terrainSampleCount++
      }
    }
  }
  if (terrainMaxError > .003) throw new Error(`review-walk-route-not-flat:${terrainMaxError}`)
  const names = samples.stopLegNodeNames ?? (id === 'expansion-dimetrodon'
    ? ['FL', 'FR', 'HL', 'HR'].flatMap(leg => ['Upper', 'Lower', 'Foot'].map(joint => `${leg}_${joint}`))
    : ['014', '015', '016', '017', '017_end', '018', '019', '020', '021', '021_end'].map(n => `骨骼.${n}`))
  const legs = names.map(name => model.getObjectByName(PropertyBinding.sanitizeNodeName(name))).filter((o): o is Object3D => !!o)
  if (legs.length !== names.length) throw new Error('review-walk-stop-leg-chain-missing')
  walk.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play(); mixer.setTime(0)
  return { walk, idle: mixer.clipAction(idleClip), speed, cruiseSeconds, duration, terrainMaxError, terrainSampleCount, legs, matrix: new Matrix4(), elapsed: 0, animationSeconds: 0, distance: 0, contactTime: 0, phase: 'walking', heldLegs: [], idleStarted: false }
}
/** Advance the authored gait and actual world distance using one integrated clock. */
export function advanceExpansionWorldWalk(state: ExpansionWorldWalk, mixer: AnimationMixer, seconds: number): { action: AnimationAction; deltaX: number; speed: number } {
  const previousDistance = state.distance
  state.elapsed += seconds
  const at = clock(state.elapsed, state.cruiseSeconds)
  state.animationSeconds = at.animation; state.distance = at.animation * state.speed
  state.matrix.makeTranslation(-state.distance, 0, 0)
  state.phase = state.elapsed < state.cruiseSeconds ? 'walking' : state.elapsed < state.duration ? 'decelerating' : 'idle'
  if (!state.idleStarted) {
    state.walk.time = at.animation % 8; state.walk.setEffectiveTimeScale(at.rate)
    mixer.update(0); state.contactTime = state.walk.time
  }
  if (state.phase === 'idle' && !state.idleStarted) {
    state.heldLegs = state.legs.map(object => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }))
    state.walk.paused = true
    state.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play().crossFadeFrom(state.walk, .6, false)
    state.idleStarted = true
  }
  if (state.idleStarted) {
    mixer.update(seconds)
    for (const pose of state.heldLegs) { pose.object.position.copy(pose.position); pose.object.quaternion.copy(pose.quaternion); pose.object.scale.copy(pose.scale) }

  }
  return { action: state.idleStarted ? state.idle : state.walk, deltaX: previousDistance - state.distance, speed: state.speed * at.rate }
}
export function translateExpansionPlacement(p: ScaleEncounterPlacement, delta: Vector3): ScaleEncounterPlacement {
  return { ...p, animalBoundsMaximum: p.animalBoundsMaximum.clone().add(delta), animalBoundsMinimum: p.animalBoundsMinimum.clone().add(delta), orbitCenter: p.orbitCenter.clone().add(delta), target: p.target.clone().add(delta), defaultEyePosition: p.defaultEyePosition.clone().add(delta), ...(p.groundFootprint ? { groundFootprint: p.groundFootprint.map(point => point.clone().add(delta)) } : {}) }
}
export function disposeExpansionWorldWalk(state: ExpansionWorldWalk): AnimationAction {
  state.idle.stop(); state.walk.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play()
  return state.walk
}
