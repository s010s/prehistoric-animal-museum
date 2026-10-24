import * as T from 'three'
import { SHORE, shoreGLSL } from './shore.js'

// A fixed, world-space wet-sand history for the authored east shore only.
// Numeric wetness is independent of the water's display-space composition.
export function makeShoreWetMemory(shore) {
  const targets = [0, 1].map(() => new T.WebGLRenderTarget(256, 256, {
    type: T.HalfFloatType, depthBuffer: false,
    minFilter: T.LinearFilter, magFilter: T.LinearFilter,
  }))
  const uniforms = { ...shore, previousWet: { value: targets[0].texture }, dryStep: { value: 0 }, resetWet: { value: 1 } }
  const material = new T.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 wetUV;void main(){wetUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `varying vec2 wetUV;uniform sampler2D previousWet;uniform float dryStep,resetWet;
      ${shoreGLSL}
      void main(){vec2 p=(wetUV-.5)*${SHORE.size.toFixed(1)}+vec2(${SHORE.x.toFixed(1)},${SHORE.z.toFixed(1)});
      float h=shoreGround(p)+.7,r=runupAt(p,shoreTime);
      float fresh=1.-smoothstep(r-.1,r+.15,h);
      vec2 history=texture2D(previousWet,wetUV).rg;
      float previous=resetWet>.5?0.:history.r+history.g;
      float wet=max(fresh,previous*exp(-dryStep/24.));
      // An exactly representable coarse value plus its small residual avoids
      // cumulative half-float rounding that depends on the update step count.
      float coarse=floor(wet*1024.)/1024.;
      gl_FragColor=vec4(coarse,wet-coarse,0.,1.);}`,
  })
  const geometry = new T.PlaneGeometry(2, 2), scene = new T.Scene()
  scene.add(new T.Mesh(geometry, material))
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let current = 0, lastTime = NaN, updates = 0, resets = 0, disposed = false
  shore.shoreWetMemory.value = targets[current].texture
  shore.shoreMemoryEnabled.value = 1
  return {
    resources: () => targets.map((target, i) => ['eastWetMemory' + i, target]),
    status: () => ({ cell: [SHORE.x, SHORE.z, SHORE.size], size: 256, lastTime: Number.isFinite(lastTime) ? lastTime : null, updates, resets, disposed }),
    update(renderer, time, diagnostics) {
      if (disposed || !Number.isFinite(time)) return
      const reset = !Number.isFinite(lastTime) || time < lastTime
      if (!reset && time - lastTime < .1) return
      uniforms.resetWet.value = reset ? 1 : 0
      uniforms.dryStep.value = reset ? 0 : time - lastTime
      uniforms.previousWet.value = targets[current].texture
      const next = 1 - current, oldTarget = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), auto = renderer.autoClear
      try {
        renderer.autoClear = true
        renderer.setRenderTarget(targets[next])
        const draw = () => renderer.render(scene, camera)
        if (diagnostics) diagnostics.pass('eastWetMemory', draw); else draw()
        current = next; lastTime = time; updates++; if (reset) resets++
        shore.shoreWetMemory.value = targets[current].texture
      } finally {
        renderer.setRenderTarget(oldTarget, face, mip)
        renderer.autoClear = auto
      }
    },
    dispose() {
      if (disposed) return
      disposed = true; shore.shoreMemoryEnabled.value = 0; shore.shoreWetMemory.value = null
      targets.forEach(target => target.dispose()); geometry.dispose(); material.dispose()
    },
  }
}
