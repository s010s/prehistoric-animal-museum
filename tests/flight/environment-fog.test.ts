import { describe,expect,it } from 'vitest'
import { MeshBasicMaterial,MeshStandardMaterial,ShaderChunk } from 'three'
import { createEnvironmentFog,ENVIRONMENT_FOG_FRAGMENT } from '../../src/flight-experience/environment/environment-fog'
import { ENVIRONMENT_ATMOSPHERE_GLSL } from '../../src/flight-experience/environment/atmosphere'
import { sampleEnvironment } from '../../src/flight-experience/environment/environment-state'
import { decorateShadowFade } from '../../src/flight-experience/environment/shadow-fade'
describe('direction-aware environment fog endpoint',()=>{
  it('keeps Three distance law and matches output conversion ordering',()=>{
    expect(ENVIRONMENT_FOG_FRAGMENT).toContain('smoothstep( fogNear, fogFar, vFogDepth )')
    expect(ENVIRONMENT_FOG_FRAGMENT).toContain('exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )')
    expect(ENVIRONMENT_FOG_FRAGMENT).not.toContain('mix( gl_FragColor.rgb, fogColor')
    expect(ENVIRONMENT_FOG_FRAGMENT.indexOf('toneMapping(')).toBeLessThan(ENVIRONMENT_FOG_FRAGMENT.indexOf('linearToOutputTexel('))
    expect(ENVIRONMENT_FOG_FRAGMENT).toContain('inverseTransformDirection(flightFogView,viewMatrix)')
  })
  it('composes with shadow/morph hooks and shares exact frame uniforms for lit and basic materials',()=>{
    const frame=sampleEnvironment('noon'),fog=createEnvironmentFog(frame)
    for(const material of [new MeshBasicMaterial(),new MeshStandardMaterial()]){
      material.onBeforeCompile=shader=>{shader.vertexShader+='\n//existing morph hook'}
      decorateShadowFade(material);fog.decorate(material);const version=material.version;fog.decorate(material);expect(material.version).toBe(version)
      const shader={vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>',uniforms:{}} as Parameters<typeof material.onBeforeCompile>[0]
      material.onBeforeCompile(shader,{} as Parameters<typeof material.onBeforeCompile>[1])
      expect(shader.vertexShader).toContain('//existing morph hook');expect(shader.vertexShader).toContain('flightFogView=mvPosition.xyz;')
      expect(shader.fragmentShader).toContain(ENVIRONMENT_ATMOSPHERE_GLSL);expect(shader.fragmentShader).toContain('flightShadowWeight')
      expect(shader.uniforms.horizon).toBe(fog.uniforms.horizon)
      expect(shader.uniforms.sunDirection).toBe(fog.uniforms.sunDirection)
    }
    fog.update(sampleEnvironment('evening'));expect(fog.uniforms.sunDirection.value.toArray()).toEqual(sampleEnvironment('evening').sunDirectionWorld)
  })
  it('uses the installed projection stage that already transforms instanced geometry',()=>{
    expect(ShaderChunk.project_vertex).toContain('instanceMatrix * mvPosition')
    expect(ShaderChunk.project_vertex).toContain('modelViewMatrix * mvPosition')
  })
})
