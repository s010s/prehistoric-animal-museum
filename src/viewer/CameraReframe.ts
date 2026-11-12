import { MathUtils, Spherical, type PerspectiveCamera, type Quaternion, type Vector3 } from 'three'

interface CameraPose {
  readonly position: Vector3
  readonly target: Vector3
  readonly rotation: Quaternion
  readonly view: PerspectiveCamera['view']
  readonly near: number
  readonly far: number
}

interface Reframe {
  from: CameraPose
  to: CameraPose
  started: number
  readonly ends: number
  readonly orbit: boolean
  readonly onFinish: (() => void) | undefined
}

// Evaluate the same easing as the DOM focus control at a given elapsed time.
function eased(progress: number): number {
  let low = 0
  let high = 1
  let t = progress
  for (let i = 0; i < 12; i += 1) {
    const x = 3 * (1 - t) * (1 - t) * t * 0.32 + t ** 3
    if (x < progress) low = t
    else high = t
    t = (low + high) / 2
  }
  return 3 * (1 - t) * (1 - t) * t * 0.72 + 3 * (1 - t) * t * t + t ** 3
}

/** Retarget the exhibit's real camera as React lays out the destination composition. */
export class CameraReframe {
  private run: Reframe | null = null
  private readonly fromOrbit = new Spherical()
  private readonly toOrbit = new Spherical()

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly target: () => Vector3,
  ) {}

  private read(): CameraPose {
    return {
      position: this.camera.position.clone(),
      rotation: this.camera.quaternion.clone(),
      target: this.target().clone(),
      view: this.camera.view ? { ...this.camera.view } : null,
      near: this.camera.near,
      far: this.camera.far,
    }
  }

  start(duration: number, orbit = false, onFinish?: () => void): void {
    const now = performance.now()
    const from = this.read()
    this.run = duration > 0 ? { from, to: from, started: now, ends: now + duration, orbit, onFinish } : null
  }

  beforeFit(): CameraPose | null {
    return this.run ? this.read() : null
  }

  afterFit(visible: CameraPose | null): void {
    const run = this.run
    if (!run || !visible) return
    const next = this.read()
    if (visible.view?.fullWidth !== next.view?.fullWidth ||
        visible.view?.fullHeight !== next.view?.fullHeight) {
      this.cancel()
      run.onFinish?.()
      return
    }
    if (run.to.position.distanceToSquared(next.position) > 0.0001 ||
        run.to.view?.offsetX !== next.view?.offsetX || run.to.view?.offsetY !== next.view?.offsetY) {
      run.from = visible
      run.started = performance.now()
    }
    run.to = next
    this.apply(visible, visible, 1)
  }

  update(now: number): boolean {
    const run = this.run
    if (!run) return false
    if (now >= run.ends) {
      this.finish()
      return true
    }
    const progress = MathUtils.clamp((now - run.started) / Math.max(1, run.ends - run.started), 0, 1)
    this.apply(run.from, run.to, progress === 0 ? 0 : eased(progress), run.orbit)
    return true
  }

  cancel(): void {
    this.run = null
  }

  finish(): void {
    const run = this.run
    if (!run) return
    this.apply(run.to, run.to, 1)
    this.cancel()
    run.onFinish?.()
  }

  private apply(from: CameraPose, to: CameraPose, t: number, orbit = false): void {
    const { camera } = this
    const target = this.target().lerpVectors(from.target, to.target, t)
    if (orbit && t > 0 && t < 1) {
      // A straight chord could cut through the exhibit after a wide drag.
      const fromAngle = this.fromOrbit.setFromVector3(camera.position.subVectors(from.position, from.target))
      const toAngle = this.toOrbit.setFromVector3(camera.position.subVectors(to.position, to.target))
      const turn = MathUtils.euclideanModulo(toAngle.theta - fromAngle.theta + Math.PI, 2 * Math.PI) - Math.PI
      camera.position.setFromSphericalCoords(
        MathUtils.lerp(fromAngle.radius, toAngle.radius, t),
        MathUtils.lerp(fromAngle.phi, toAngle.phi, t),
        fromAngle.theta + turn * t,
      ).add(target)
      camera.lookAt(target)
    } else {
      camera.position.lerpVectors(from.position, to.position, t)
      camera.quaternion.slerpQuaternions(from.rotation, to.rotation, t)
    }
    camera.near = MathUtils.lerp(from.near, to.near, t)
    camera.far = MathUtils.lerp(from.far, to.far, t)
    if (from.view?.enabled && to.view?.enabled) {
      camera.setViewOffset(
        to.view.fullWidth, to.view.fullHeight,
        MathUtils.lerp(from.view.offsetX, to.view.offsetX, t),
        MathUtils.lerp(from.view.offsetY, to.view.offsetY, t),
        to.view.width, to.view.height,
      )
    } else {
      camera.updateProjectionMatrix()
    }
  }
}
