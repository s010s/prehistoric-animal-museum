import {
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { applyScaleEncounterHybridGroundMaterialPrototype } from '../src/viewer/scale-encounter-ground-material-prototype'

function compilePrototype(material: MeshStandardMaterial) {
  const shader = {
    fragmentShader: `
varying vec3 vViewPosition;
void main() {
  vec4 diffuseColor = vec4(1.0);
  #include <map_fragment>
  #include <color_fragment>
}`,
    uniforms: {},
    vertexShader: `
varying vec3 vViewPosition;
void main() {
  #include <begin_vertex>
}`,
  } as unknown as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

describe('scale encounter hybrid ground material prototype', () => {
  it('keeps the near floor opaque while installing multiscale albedo and dual-distance fade masks', () => {
    const material = new MeshStandardMaterial({
      depthWrite: false,
      transparent: true,
    })
    applyScaleEncounterHybridGroundMaterialPrototype(material)

    const shader = compilePrototype(material)

    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(true)
    expect(shader.vertexShader).toContain(
      'vScaleEncounterGroundLocalPosition = position.xy',
    )
    expect(shader.fragmentShader.match(/texture2D\(map,/g)).toHaveLength(3)
    expect(shader.fragmentShader).toContain(
      'diffuseColor.a *= 1.0 - scaleEncounterCoverageLoss',
    )
    expect(shader.fragmentShader).not.toContain('floor(gl_FragCoord.xy)')
    expect(shader.fragmentShader).toContain(
      'scaleEncounterSubjectFade * scaleEncounterCameraFade',
    )
    expect(shader.uniforms.uScaleEncounterSubjectFade?.value).toEqual([34, 126])
    expect(shader.uniforms.uScaleEncounterCameraFade?.value).toEqual([64, 172])
    expect(shader.uniforms.uScaleEncounterMaximumCoverageLoss?.value).toBe(0.82)
    expect(material.customProgramCacheKey()).toContain(
      'hybrid-ground-antitile-v1',
    )
  })

  it('clamps an unsafe subject fade so the 22 m encounter clearing cannot dither away', () => {
    const material = new MeshStandardMaterial()
    applyScaleEncounterHybridGroundMaterialPrototype(material, {
      cameraFadeEndMeters: 20,
      cameraFadeStartMeters: 18,
      subjectFadeEndMeters: 12,
      subjectFadeStartMeters: 4,
    })

    const shader = compilePrototype(material)

    expect(shader.uniforms.uScaleEncounterSubjectFade?.value).toEqual([24, 25])
    expect(shader.uniforms.uScaleEncounterCameraFade?.value).toEqual([18, 20])
  })
})
