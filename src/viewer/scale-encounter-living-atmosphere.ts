import {
  BufferAttribute, BufferGeometry, Color, DoubleSide,
  Group, InstancedMesh, MathUtils, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Points,
  ShaderMaterial, Vector3, type Material, type WebGLRenderer,
} from 'three'
import type { ScaleEncounterHabitat } from './scale-encounter'

export type LivingAtmosphereKind = 'snow' | 'forest' | 'water' | 'air'

export interface LivingAtmosphere {
  readonly root: Group
  readonly kind: LivingAtmosphereKind
  readonly particleCount: number
  readonly particleCapacity: number
  readonly timeSeconds: number
  update(time: number, reducedMotion: boolean, camera?: PerspectiveCamera | Vector3): void
  settleFoot(point: Vector3): void
  dispose(): void
}

export function createLivingAtmosphere(
  habitat: ScaleEncounterHabitat,
  snow: boolean,
  groundHeightAt: (x: number, z: number) => number = () => 0,
  renderer?: WebGLRenderer,
  environmentRoot?: Group,
): LivingAtmosphere {
  const kind: LivingAtmosphereKind = snow ? 'snow' : habitat === 'land' ? 'forest' : habitat
  const root = new Group()
  root.name = `scale-encounter-living-${kind}`
  const count = kind === 'snow' ? 2800 : kind === 'forest' ? 700 : kind === 'water' ? 240 : 0
  const minimum = kind === 'snow' ? 700 : kind === 'forest' ? 180 : kind === 'water' ? 80 : 0
  let population = kind === 'snow' ? 1800 : kind === 'forest' ? 480 : kind === 'water' ? 160 : 0
  let targetPopulation = population
  let frameAverage = 1 / 60
  let sampleSeconds = 0
  let healthySeconds = 0
  const width = kind === 'snow' ? 42 : 32
  const height = kind === 'snow' ? 16 : kind === 'water' ? 24 : 7
  const uniforms = {
    uPopulation: { value: population }, uTime: { value: 0 }, uCentre: { value: new Vector3() },
    uViewport: { value: 900 }, uWidth: { value: width }, uHeight: { value: height },
    uSnow: { value: snow ? 1 : 0 }, uWater: { value: kind === 'water' ? 1 : 0 },
    uColour: { value: new Color(snow ? '#edf5ff' : kind === 'water' ? '#99d6d9' : '#e7d8a4') },
  }
  if (kind === 'forest') {
    const animatedMaterials = new Set<Material>()
    // Only low plants with independent instanced geometry. Root vertices stay
    // pinned; trunks, rocks, terrain and all comparison subjects are untouched.
    environmentRoot?.traverse((object) => {
      if (!(object instanceof InstancedMesh) || !/(hero-ferns|real-ferns|fern-frond-batch|riparian-whorl-batch)$/.test(object.name)) return
      const plant = object as InstancedMesh<BufferGeometry, Material | Material[]>
      const flatFrond = object.name.endsWith('fern-frond-batch')
      const sourceToWorld = new Matrix4()
      plant.getMatrixAt(0, sourceToWorld)
      plant.updateWorldMatrix(true, false)
      sourceToWorld.premultiply(plant.matrixWorld)
      const sourceUp = new Vector3(0, 1, 0).transformDirection(sourceToWorld.invert())
      const positions = plant.geometry.getAttribute('position')
      let bottom = Infinity, top = -Infinity
      const vertex = new Vector3()
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i)
        const along = flatFrond ? vertex.x : vertex.dot(sourceUp)
        bottom = Math.min(bottom, along); top = Math.max(top, along)
      }
      const amplitude = (top - bottom) * (flatFrond ? .10 : .085)
      const up = `vec3(${sourceUp.toArray().map((n) => n.toFixed(6)).join(',')})`
      for (const entry of Array.isArray(plant.material) ? plant.material : [plant.material]) {
        if (animatedMaterials.has(entry)) continue
        animatedMaterials.add(entry)
        const compile = entry.onBeforeCompile.bind(entry)
        const cacheKey = entry.customProgramCacheKey()
        entry.onBeforeCompile = (shader, gl) => {
          compile(shader, gl)
          shader.uniforms.uEncounterBreeze = uniforms.uTime
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uEncounterBreeze;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float leafTip = smoothstep(${bottom.toFixed(6)}, ${(top + .00001).toFixed(6)}, ${flatFrond ? 'position.x' : `dot(position, ${up})`});
              float plantPhase = instanceMatrix[3].x * .31 + instanceMatrix[3].z * .23;
              float wind = sin(uEncounterBreeze * 1.35 + plantPhase) * .78 + sin(uEncounterBreeze * 2.1 + plantPhase * 1.7) * .22;
              transformed += ${flatFrond ? 'vec3(0.,1.,.28)' : `(${up} * .3 + vec3(.8,0.,.45))`} * wind * leafTip * leafTip * ${amplitude.toFixed(6)};
            `)
        }
        entry.customProgramCacheKey = () => `${cacheKey}-living-leaf-tips-v2-${bottom}-${top}-${amplitude}-${up}-${flatFrond}`
        entry.needsUpdate = true
      }
    })
  }
  const seeds = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  let seed = 19373
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = random() * width
    seeds[i * 3 + 1] = random() * height
    seeds[i * 3 + 2] = random() * width
    sizes[i] = snow ? 0.018 + random() * 0.025 : 0.008 + random() * 0.014
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(seeds, 3))
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
  geometry.setAttribute('aRank', new BufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1))
  geometry.setDrawRange(0, population)
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uTime, uWidth, uHeight, uViewport, uSnow, uWater, uPopulation;
      uniform vec3 uCentre;
      attribute float aSize, aRank;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float phase = position.x * 2.9 + position.z;
        p.x += uTime * mix(.10, .24, uSnow) + sin(uTime * .42 + phase) * .27;
        p.z += uTime * .06 + cos(uTime * .31 + phase) * .23;
        p.xz = mod(p.xz - uCentre.xz + uWidth * .5, uWidth) - uWidth * .5 + uCentre.xz;
        p.y = mod(p.y - uTime * mix(-.035, .56 + aSize * 5., uSnow), uHeight) + uCentre.y;
        vec4 mv = viewMatrix * vec4(p, 1.);
        float edge = 1. - smoothstep(uWidth * .32, uWidth * .49, length(p.xz - uCentre.xz));
        float groundFade = smoothstep(0., .6, p.y - uCentre.y);
        float nearFade = smoothstep(.9, 2.8, -mv.z);
        float lightPocket = .75 + .25 * sin(p.x * .31 + p.z * .19);
        float populationFade = 1. - smoothstep(max(0., uPopulation - 70.), uPopulation, aRank);
        vAlpha = edge * groundFade * nearFade * mix(.43 * lightPocket, .8, uSnow) * populationFade;
        gl_PointSize = clamp(aSize * uViewport * projectionMatrix[1][1] / max(1., -mv.z), 1., 9.);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - .5) * 2.;
        float alpha = (1. - smoothstep(.18, 1., radius)) * vAlpha;
        if (alpha < .008) discard;
        gl_FragColor = vec4(uColour, alpha);
        #include <colorspace_fragment>
      }
    `,
  })
  const particles = new Points(geometry, material)
  particles.name = `scale-encounter-${kind}-drift`
  particles.frustumCulled = false
  if (count > 0) root.add(particles)

  // No flat light ribbons: they have no canopy occluder and reveal their
  // plane when walking around them. Sunlit motes carry the clearing's light.
  const puff = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uLife: { value: 0 }, uColour: uniforms.uColour },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv; uniform float uLife; uniform vec3 uColour;
      void main(){float r=length((vUv-.5)*2.);float a=exp(-r*r*5.)*(1.-smoothstep(.6,1.,r));
      gl_FragColor=vec4(uColour,a*sin(uLife*3.14159)*.3);
      #include <colorspace_fragment>}`,
  }))
  puff.name = 'scale-encounter-soft-foot-settle'
  puff.visible = false
  root.add(puff)
  let lastTime: number | null = null
  let time = 0
  let puffStart = -100
  return {
    root, kind, particleCapacity: count,
    get particleCount() { return Math.round(population) },
    get timeSeconds() { return time },
    update: (elapsed, reducedMotion, camera) => {
      const frame = lastTime === null ? 0 : elapsed - lastTime
      const dt = MathUtils.clamp(frame, 0, .1)
      // Measure sustained frame delivery, with hysteresis and no allocations.
      // Loading stalls and background-tab gaps never act as hardware scores.
      if (!reducedMotion && frame > 0 && frame < .25) {
        frameAverage = MathUtils.damp(frameAverage, frame, 1.5, frame)
        sampleSeconds += frame
        healthySeconds = frameAverage < 1 / 55 ? healthySeconds + frame : 0
        if (sampleSeconds >= 2 && time > 3) {
          if (frameAverage > 1 / 40) targetPopulation = Math.max(minimum, targetPopulation * .72)
          else if (healthySeconds > 6) targetPopulation = Math.min(count, targetPopulation + count * .12)
          sampleSeconds = 0
        }
        population = MathUtils.damp(population, targetPopulation, 1.6, dt)
      }
      uniforms.uPopulation.value = population
      geometry.setDrawRange(0, Math.ceil(population))
      lastTime = elapsed
      if (!reducedMotion) time += dt
      uniforms.uTime.value = time
      particles.visible = !reducedMotion
      if (camera) {
        const p = camera instanceof PerspectiveCamera ? camera.position : camera
        uniforms.uCentre.value.set(p.x, kind === 'water' ? p.y - height * .5 : groundHeightAt(p.x, p.z), p.z)
        if (camera instanceof PerspectiveCamera) puff.quaternion.copy(camera.quaternion)
      }
      uniforms.uViewport.value = renderer?.domElement.height ?? 900
      const life = (time - puffStart) / 1.8
      puff.visible = !reducedMotion && life >= 0 && life < 1
      if (puff.visible) {
        puff.material.uniforms.uLife!.value = life
        puff.scale.set(.65 + life * 1.2, .3 + life * .5, 1)
      }
    },
    settleFoot: (point) => {
      puffStart = time
      puff.position.set(point.x, groundHeightAt(point.x, point.z) + .12, point.z)
    },
    dispose: () => {
      root.removeFromParent()
      geometry.dispose(); material.dispose()
      puff.geometry.dispose(); puff.material.dispose()
      root.clear()
    },
  }
}
