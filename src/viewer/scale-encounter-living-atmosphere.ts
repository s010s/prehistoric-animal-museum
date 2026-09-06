import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide,
  Group, InstancedMesh, MathUtils, Mesh, PerspectiveCamera, PlaneGeometry, Points,
  ShaderMaterial, Vector3, type Material, type WebGLRenderer,
} from 'three'
import type { ScaleEncounterHabitat } from './scale-encounter'

export type LivingAtmosphereKind = 'snow' | 'forest' | 'water' | 'air'

export interface LivingAtmosphere {
  readonly root: Group
  readonly kind: LivingAtmosphereKind
  readonly particleCount: number
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
  const count = kind === 'snow' ? 640 : kind === 'forest' ? 180 : kind === 'water' ? 160 : 0
  const width = kind === 'snow' ? 48 : 38
  const height = kind === 'snow' ? 19 : kind === 'water' ? 24 : 8
  const uniforms = {
    uTime: { value: 0 }, uCentre: { value: new Vector3() },
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
      plant.geometry.computeBoundingBox()
      const bounds = plant.geometry.boundingBox!
      const bottom = bounds.min.y
      const top = bounds.max.y
      const amplitude = Math.min(bounds.max.x - bounds.min.x, top - bottom) * .025
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
              float leafTip = smoothstep(${bottom.toFixed(6)}, ${(top + .00001).toFixed(6)}, position.y);
              transformed.x += sin(uEncounterBreeze * .85 + position.x * 3. + position.z * 2.) * leafTip * leafTip * ${amplitude.toFixed(6)};
            `)
        }
        entry.customProgramCacheKey = () => `${cacheKey}-living-leaf-tips-v1-${bottom}-${top}-${amplitude}`
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
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uTime, uWidth, uHeight, uViewport, uSnow, uWater;
      uniform vec3 uCentre;
      attribute float aSize;
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
        vAlpha = edge * groundFade * nearFade * mix(.32, .78, uSnow);
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

  // Soft, depth-tested shafts sit in the clearing's outer vegetation, aligned
  // with the existing sun. Their silhouettes fade at both ends and all edges.
  // Air stays clear; visible shafts need suspended matter and an occluder.
  const shafts: Mesh<PlaneGeometry, ShaderMaterial>[] = []
  if (kind === 'forest') {
    for (const [x, z, length, breadth] of [[-10, -10, 16, 2.3], [12, -16, 19, 3.2], [-21, 6, 17, 2.1]] as const) {
      const shaft = new Mesh(new PlaneGeometry(breadth, length), new ShaderMaterial({
        transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
        uniforms: { uTime: uniforms.uTime, uPhase: { value: x }, uOpacity: { value: 0.055 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `
          varying vec2 vUv; uniform float uTime, uPhase, uOpacity;
          void main(){
            float across = exp(-pow((vUv.x-.5)*4.8,2.));
            float ends = smoothstep(0.,.25,vUv.y)*(1.-smoothstep(.65,1.,vUv.y));
            float breeze=.88+.12*sin(uTime*.23+uPhase);
            gl_FragColor=vec4(.94,.87,.64,across*ends*uOpacity*breeze);
            #include <colorspace_fragment>
          }`,
      }))
      shaft.position.set(x, groundHeightAt(x, z) + length * .46, z)
      // Project the fixed world sun into a broad vertical ribbon.
      shaft.rotation.set(0, -.574, -.59)
      shaft.name = 'scale-encounter-canopy-sunbeam'
      shafts.push(shaft); root.add(shaft)
    }
  }
  const puff = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uLife: { value: 0 }, uColour: uniforms.uColour },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv; uniform float uLife; uniform vec3 uColour;
      void main(){float r=length((vUv-.5)*2.);float a=exp(-r*r*5.)*(1.-smoothstep(.6,1.,r));
      gl_FragColor=vec4(uColour,a*sin(uLife*3.14159)*.17);
      #include <colorspace_fragment>}`,
  }))
  puff.name = 'scale-encounter-soft-foot-settle'
  puff.visible = false
  root.add(puff)
  let lastTime: number | null = null
  let time = 0
  let puffStart = -100
  return {
    root, kind, particleCount: count,
    get timeSeconds() { return time },
    update: (elapsed, reducedMotion, camera) => {
      const dt = lastTime === null ? 0 : MathUtils.clamp(elapsed - lastTime, 0, .1)
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
        puff.scale.set(.45 + life * .7, .22 + life * .34, 1)
      }
    },
    settleFoot: (point) => {
      puffStart = time
      puff.position.set(point.x, groundHeightAt(point.x, point.z) + .12, point.z)
    },
    dispose: () => {
      root.removeFromParent()
      geometry.dispose(); material.dispose()
      shafts.forEach((s) => { s.geometry.dispose(); s.material.dispose() })
      puff.geometry.dispose(); puff.material.dispose()
      root.clear()
    },
  }
}
