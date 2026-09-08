import { BackSide, BoxGeometry, Data3DTexture, LinearFilter, Mesh, RGFormat, ShaderMaterial, Vector3, type Camera } from 'three'

const RESOLUTION = 64
export const SKY_CLOUD_DENSITY_BYTES = RESOLUTION ** 3 * 2
export const SKY_CLOUD_COUNT = 32

function randomSource(seed: number) {
  let state = seed >>> 0
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
}

export interface SkyCloudPlan {
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly yaw: number
  readonly seed: number
  readonly speed: number
  readonly distant: boolean
}

/** Sample a volume of air, not a line, arc, grid or repeated cloud photograph.
 * A fresh scene gets entropy once; camera movement never regenerates the field. */
export function createSkyCloudPlan(seed = crypto.getRandomValues(new Uint32Array(1))[0]!): SkyCloudPlan[] {
  const random = randomSource(seed)
  return Array.from({ length: SKY_CLOUD_COUNT }, (_, index) => {
    // Mix small fragments and substantial banks without giving them the same
    // aspect ratio. Each size class still has independent random dimensions.
    const distant = index >= 12
    const width = distant ? 40 + random() * 70 : index < 3 ? 12 + random() * 12 : index < 9 ? 30 + random() * 24 : 64 + random() * 28
    let x: number, z: number
    do {
      x = (random() - .5) * (distant ? 1240 : 340)
      z = (random() - .5) * (distant ? 1240 : 320)
    } while (Math.hypot(x, z) < (distant ? 260 : 65) || (distant && Math.hypot(x, z) > 620))
    return {
      position: [x, distant ? -34 + random() * 10 : -37 + random() * 12, z],
      size: [width, Math.min(distant ? 20 : 25, width * (.28 + random() * .28)), width * (.52 + random() * .46)],
      distant,
      yaw: random() * Math.PI * 2,
      seed: Math.floor(random() * 4294967296),
      speed: .018 + random() * .022,
    }
  })
}

function createDensity(seed: number, resolution = RESOLUTION): Data3DTexture {
  const random = randomSource(seed)
  const lobes = Array.from({ length: 8 }, () => ({
    x: (random() - .5) * .43, y: (random() - .5) * .36, z: (random() - .5) * .42,
    rx: .13 + random() * .17, ry: .15 + random() * .19, rz: .13 + random() * .18,
  }))
  // Independent 3D noise per cloud, baked once. No repeating 2D sprite or
  // screen-space noise can reveal rows or shimmer while the child moves.
  const noise = Float32Array.from({ length: 17 ** 3 }, () => random())
  const ease = (t: number) => t * t * (3 - 2 * t)
  const sample = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
    const fx = ease(x - ix), fy = ease(y - iy), fz = ease(z - iz)
    let value = 0
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      value += noise[(ix + dx) + (iy + dy) * 17 + (iz + dz) * 289]!
        * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz)
    }
    return value
  }
  const data = new Uint8Array(resolution ** 3)
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const px = x / (resolution - 1) - .5, py = y / (resolution - 1) - .5, pz = z / (resolution - 1) - .5
    let shape = -1
    for (const lobe of lobes) shape = Math.max(shape, 1 - ((px - lobe.x) / lobe.rx) ** 2 - ((py - lobe.y) / lobe.ry) ** 2 - ((pz - lobe.z) / lobe.rz) ** 2)
    const turbulence = sample((px + .5) * 7.9, (py + .5) * 7.9, (pz + .5) * 7.9) * .65
      + sample((px + .5) * 15.9, (py + .5) * 15.9, (pz + .5) * 15.9) * .35
    const field = Math.max(0, Math.min(1, (shape + (turbulence - .5) * 1.5) * 1.8))
    const edge = Math.max(0, Math.min(1, (.49 - Math.max(Math.abs(px), Math.abs(py), Math.abs(pz))) / .08))
    data[x + y * resolution + z * resolution ** 2] = Math.round(ease(field) * ease(edge) * 255)
  }
  // Bake directional light attenuation too: one GPU texture sample supplies
  // both density and self-shadowing, independent of the rendering frame rate.
  const lit = new Uint8Array(resolution ** 3 * 2)
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const index = x + y * resolution + z * resolution ** 2
    let opticalDepth = 0
    for (let step = 1; step <= 6; step++) {
      const sx = x - step * 2, sy = y + step * 3, sz = z - step
      if (sx < 0 || sy >= resolution || sz < 0) break
      opticalDepth += data[sx + sy * resolution + sz * resolution ** 2]! / 255
    }
    lit[index * 2] = data[index]!
    lit[index * 2 + 1] = Math.round((.26 + Math.exp(-opticalDepth * .72) * .74) * 255)
  }
  const texture = new Data3DTexture(lit, resolution, resolution, resolution)
  texture.format = RGFormat
  texture.minFilter = texture.magFilter = LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

export function createSkyCloudVolume(plan: SkyCloudPlan, index: number, steps = 28) {
  const density = createDensity(plan.seed, plan.distant ? 32 : 64)
  const localEye = new Vector3()
  const material = new ShaderMaterial({
    transparent: true, premultipliedAlpha: true, depthWrite: false, side: BackSide,
    uniforms: {
      uDensity: { value: density }, uEye: { value: localEye },
      uSteps: { value: plan.distant ? Math.min(20, steps) : steps }, uOverdrawDiagnostic: { value: 0 },
    },
    vertexShader: `varying vec3 vLocal; void main() {
      vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }`,
    fragmentShader: /* glsl */ `
      precision highp sampler3D;
      uniform sampler3D uDensity;
      uniform vec3 uEye;
      uniform float uSteps, uOverdrawDiagnostic;
      varying vec3 vLocal;
      void main() {
        vec3 ray = normalize(vLocal - uEye);
        vec3 safeRay = mix(vec3(.00001), ray, step(vec3(.00001), abs(ray)));
        vec3 a = (-.5 - uEye) / safeRay, b = (.5 - uEye) / safeRay;
        vec3 lo = min(a,b), hi = max(a,b);
        float enter = max(0., max(lo.x, max(lo.y,lo.z)));
        float leave = min(hi.x,min(hi.y,hi.z));
        if (leave <= enter) discard;
        float dt = (leave - enter) / uSteps;
        vec3 colour = vec3(0.); float alpha = 0.;
        for (int i=0; i<32; i++) {
          if (float(i) >= uSteps || alpha > .97) break;
          vec3 uv = uEye + ray * (enter + (float(i) + .5) * dt) + .5;
          vec2 volume = texture(uDensity, uv).rg;
          float d = volume.r;
          float opacity = 1. - exp(-d * dt * 12.);
          float light = volume.g;
          vec3 sampleColour = mix(vec3(.34,.48,.60), vec3(1.,.99,.97), light);
          colour += (1.-alpha) * opacity * sampleColour;
          alpha += (1.-alpha) * opacity;
        }
        if (alpha < .008) discard;
        colour = mix(colour / max(alpha,.001), vec3(1.,.18,.02),uOverdrawDiagnostic);
        gl_FragColor = vec4(colour, alpha * .88);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb *= gl_FragColor.a;
      }
    `,
  })
  const object = new Mesh(new BoxGeometry(1,1,1), material)
  object.name = `sky-volume-cloud-${index}`
  object.position.set(...plan.position)
  object.scale.set(...plan.size)
  object.rotation.y = plan.yaw
  const eye = new Vector3()
  return {
    id: object.name, layer: 'far-cloud' as const, object, material, density,
    update: (time: number, camera: Camera) => {
      // A shared prevailing wind with independent speeds; no synchronized
      // sinusoidal paths. Move continuously without ever recycling in view.
      object.position.set(plan.position[0] + time * plan.speed, plan.position[1], plan.position[2] + time * plan.speed * .24)
      object.updateWorldMatrix(true, false)
      camera.getWorldPosition(eye)
      localEye.copy(object.worldToLocal(eye))
    },
  }
}
