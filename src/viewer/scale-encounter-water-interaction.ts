import {
  DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry,
  SRGBColorSpace, TextureLoader, Vector4, type Vector3,
} from 'three'
import splashUrl from '../scale-encounter/assets/environments/footstep-water-splash-v1.webp?url'

export interface RiverVisitor {
  readonly x: number
  readonly z: number
  /** Sole height, including the controller's jump offset, in world metres. */
  readonly feetY: number
  readonly heightMeters: number
  readonly verticalVelocity: number
  readonly airborne: boolean
}

export const RIVER_RIPPLE_COUNT = 8
export const RIVER_RIPPLE_LIFETIME_SECONDS = 3

/** One short-lived pool shared by entry, wading and landing. Ripples are
 * shader inputs on the river itself; only the airborne spray uses a cutout.
 */
export function createRiverWaterInteraction(
  depthAt: (x: number, z: number) => number,
  level: number,
) {
  const root = new Group()
  root.name = 'scale-encounter-visitor-water-splashes'
  // Parent is the horizontal Reflector. Restore world X/Y/Z for the spray.
  root.rotation.x = Math.PI / 2
  const texture = new TextureLoader().load(splashUrl)
  texture.colorSpace = SRGBColorSpace
  const geometry = new PlaneGeometry(1, 1).translate(0, 0.42, 0)
  const ripples = Array.from({ length: RIVER_RIPPLE_COUNT }, () => new Vector4(0, 0, -10, 0))
  // A moving pressure front stays with the submerged body. Footfall impulses
  // alone are immediately left behind by the person who produced them.
  const push = new Vector4(0, 0, 0, 0)
  const flow = new Vector4(1, 0, 0, 0)
  const sprays = ripples.map(() => {
    const material = new MeshBasicMaterial({
      map: texture, color: '#becbd0', transparent: true, opacity: 0,
      depthWrite: false, side: DoubleSide, alphaTest: 0.01,
    })
    material.onBeforeCompile = (shader) => {
      shader.uniforms.waterLevel = { value: level }
      shader.vertexShader = 'varying float vSplashHeight;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vSplashHeight = (modelMatrix * vec4(transformed, 1.0)).y;
        #include <project_vertex>
      `)
      shader.fragmentShader = 'uniform float waterLevel;\nvarying float vSplashHeight;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        if (vSplashHeight < waterLevel + 0.004) discard;
        #include <map_fragment>
        // Neutral water catches the scene's light without blue cutout fringes.
        float waterLuma = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(waterLuma), .82);
      `)
    }
    const mesh = new Mesh(geometry, material)
    mesh.name = 'scale-encounter-footstep-spray'
    mesh.renderOrder = 1
    mesh.visible = false
    root.add(mesh)
    return { mesh, directionX: 0, directionZ: 0, speed: 0, flip: 1 }
  })

  let previous: (RiverVisitor & { time: number; wet: boolean }) | null = null
  let strideDistance = 0
  let nextImpact = 0
  let foot = 1
  let jumpImpactEmitted = false

  const clear = () => {
    ripples.forEach((ripple, index) => {
      ripple.w = 0
      sprays[index]!.mesh.visible = false
    })
    strideDistance = 0
    jumpImpactEmitted = false
    push.z = 0
    flow.z = 0
  }

  function emit(
    visitor: RiverVisitor, time: number, strength: number,
    directionX: number, directionZ: number, twoFeet: boolean,
  ) {
    const spread = twoFeet ? 0 : MathUtils.clamp(visitor.heightMeters * 0.075, 0.07, 0.14) * foot
    const lead = twoFeet ? 0 : MathUtils.clamp(visitor.heightMeters * 0.16, 0.14, 0.28)
    let x = visitor.x + directionX * lead - directionZ * spread
    let z = visitor.z + directionZ * lead + directionX * spread
    // At the very edge a planted foot may still be on the bank.
    if (depthAt(x, z) < 0.015) { x = visitor.x; z = visitor.z }
    const depth = depthAt(x, z)
    if (depth < 0.015) return
    const ripple = ripples[nextImpact]!
    ripple.set(x, z, time, strength * MathUtils.smoothstep(depth, 0.005, 0.12))
    const spray = sprays[nextImpact]!
    spray.directionX = directionX
    spray.directionZ = directionZ
    spray.speed = twoFeet ? 0 : flow.z
    spray.flip = foot
    nextImpact = (nextImpact + 1) % RIVER_RIPPLE_COUNT
    foot *= -1
  }

  function update(time: number, visitor: RiverVisitor | null, cameraPosition?: Readonly<Vector3>) {
    if (!visitor) {
      clear()
      previous = null
      return
    }
    const depth = depthAt(visitor.x, visitor.z)
    const wet = depth > 0.015 && visitor.feetY <= level + 0.01
    if (previous) {
      const dt = time - previous.time
      const dx = visitor.x - previous.x
      const dz = visitor.z - previous.z
      const distance = Math.hypot(dx, dz)
      // Camera transitions, resets and suspended tabs must not leave a wake.
      if (dt <= 0 || dt > 0.25 || distance > Math.max(0.8, dt * 8)) {
        clear()
      } else {
        const speed = distance / dt
        const directionX = distance > 0.001 ? dx / distance : 1
        const directionZ = distance > 0.001 ? dz / distance : 0
        const immersion = Math.max(0, Math.min(depth, level - visitor.feetY))
        const pushing = wet && !visitor.airborne && speed > 0.08
        const force = pushing ? MathUtils.clamp(speed / 1.4, 0, 1.6)
          * MathUtils.smoothstep(immersion, 0.01, 0.22) : 0
        push.set(visitor.x, visitor.z,
          MathUtils.lerp(push.z, force, 1 - Math.exp(-dt * (pushing ? 18 : 10))),
          MathUtils.clamp(visitor.heightMeters * 0.19, 0.16, 0.34))
        if (!wet || visitor.airborne) push.z = 0
        if (pushing) flow.set(directionX, directionZ, speed, immersion)
        if (visitor.airborne && !previous.airborne) jumpImpactEmitted = false
        const landing = previous.airborne && !visitor.airborne && !jumpImpactEmitted
        const entering = wet && !previous.wet && visitor.verticalVelocity <= 0
        if (wet && (entering || landing)) {
          const impactSpeed = Math.max(-visitor.verticalVelocity, -previous.verticalVelocity)
          const jumping = landing || visitor.airborne
          const strength = jumping
            ? MathUtils.clamp(0.8 + impactSpeed * 0.18, 0.8, 1.6)
            : MathUtils.clamp(0.38 + speed * 0.22, 0.38, 0.9)
          emit(visitor, time, strength, directionX, directionZ, jumping)
          jumpImpactEmitted = jumping
          strideDistance = 0
        } else if (wet && !visitor.airborne && speed > 0.08) {
          strideDistance += distance
          // The existing walk/run clips travel about .75/.93 m per footfall
          // at their authored playback rates. Avoid machine-gun spray when
          // the smaller child rig moves at the same world speed as the taller one.
          const stride = MathUtils.lerp(0.75, 0.93, MathUtils.smoothstep(speed, 1.7, 2.5))
          if (strideDistance >= stride) {
            emit(visitor, time, MathUtils.clamp(0.34 + speed * 0.18, 0.38, 0.85), directionX, directionZ, false)
            strideDistance %= stride
          }
        } else if (!wet) {
          strideDistance = 0
        }
      }
    }
    previous = { ...visitor, time, wet }

    ripples.forEach((ripple, index) => {
      const spray = sprays[index]!
      const age = time - ripple.z
      if (age >= RIVER_RIPPLE_LIFETIME_SECONDS) ripple.w = 0
      const lifetime = 0.58 + ripple.w * 0.14
      spray.mesh.visible = ripple.w > 0 && age >= 0 && age < lifetime
      if (!spray.mesh.visible) return
      const progress = age / lifetime
      const arc = 4 * progress * (1 - progress)
      const width = (0.24 + ripple.w * 0.4) * (0.7 + progress * 0.65)
      const height = (0.12 + ripple.w * 0.3) * arc
      // Spray initially carries the visitor's forward momentum, then loses
      // speed and falls outward. It must not start as an immobile patch behind.
      const drift = spray.speed * 0.18 * (1 - Math.exp(-age / 0.18))
      const outward = spray.flip * age * 0.24
      spray.mesh.scale.set(width * spray.flip, height, 1)
      spray.mesh.position.set(
        ripple.x + spray.directionX * drift - spray.directionZ * outward,
        0.005,
        ripple.y + spray.directionZ * drift + spray.directionX * outward,
      )
      if (cameraPosition) {
        spray.mesh.rotation.y = Math.atan2(cameraPosition.x - ripple.x, cameraPosition.z - ripple.y)
      }
      spray.mesh.material.opacity = (0.4 + ripple.w * 0.14)
        * MathUtils.smoothstep(progress, 0, 0.07)
        * (1 - MathUtils.smoothstep(progress, 0.25, 1))
    })
  }
  return { root, ripples, push, flow, update }
}
