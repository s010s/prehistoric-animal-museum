import { describe, expect, it, vi } from 'vitest'
import { MeshStandardMaterial, ShaderLib, type WebGLRenderer } from 'three'
import { decorateAnimalRim } from '../../src/flight-experience/environment/animal-rim'
import { createEnvironmentFog } from '../../src/flight-experience/environment/environment-fog'
import { sampleEnvironment } from '../../src/flight-experience/environment/environment-state'
import { decorateShadowFade } from '../../src/flight-experience/environment/shadow-fade'

describe('animal sunset rim material integration', () => {
  it('chains the source material and fog/shadow hooks once for a shared skinned material', () => {
    const material = new MeshStandardMaterial(), original = vi.fn()
    material.onBeforeCompile = original
    const fog = createEnvironmentFog(sampleEnvironment('evening', 0, 'sunset-bay'))
    decorateShadowFade(material); fog.decorate(material)
    decorateAnimalRim(material, fog.uniforms); decorateAnimalRim(material, fog.uniforms)
    const shader = { ...ShaderLib.standard, uniforms: { ...ShaderLib.standard.uniforms } }
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as WebGLRenderer)
    expect(original).toHaveBeenCalledTimes(1)
    expect(shader.fragmentShader.match(/outgoingLight\+=vec3/g)).toHaveLength(1)
    expect(shader.fragmentShader).toContain('flightShadowWeight')
    expect(shader.fragmentShader).toContain('flightFogRadiance')
    expect(shader.vertexShader).toContain('#include <skinning_vertex>')
    expect(shader.uniforms.animalRim).toBe(fog.uniforms.animalRim)
    expect(shader.uniforms.sunDirection).toBe(fog.uniforms.sunDirection)
    material.dispose()
  })
})
