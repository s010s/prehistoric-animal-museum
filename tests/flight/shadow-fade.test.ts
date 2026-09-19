import { describe,expect,it } from 'vitest'
import { MeshStandardMaterial,ShaderChunk } from 'three'
import { decorateShadowFade,shadowEdgeWeight,withShadowEdgeFade } from '../../src/flight-experience/environment/shadow-fade'
describe('near sunlight shadow boundary',()=>{
  it('fades continuously to unshadowed at every tile edge and keeps the centre intact',()=>{
    expect(shadowEdgeWeight(.5,.5)).toBe(1)
    for(const p of [[0,.5],[1,.5],[.5,0],[.5,1]])expect(shadowEdgeWeight(p[0]!,p[1]!)).toBe(0)
    let previous=0
    for(let i=0;i<=180;i++){const next=shadowEdgeWeight(i/1000,.5);expect(next).toBeGreaterThanOrEqual(previous);expect(next-previous).toBeLessThan(.01);previous=next}
    expect(shadowEdgeWeight(.5,.5,0)).toBe(0);expect(shadowEdgeWeight(.5,.5,1)).toBe(0)
  })
  it('matches installed Three chunk and changes only directional direct-light shadow multiplier',()=>{
    const fragment=withShadowEdgeFade('#include <common>\n#include <lights_fragment_begin>')
    expect(fragment).toContain('mix(1.0, getShadow( directionalShadowMap')
    expect(fragment).toContain('flightShadowWeight(vDirectionalShadowCoord[ i ])')
    const spotLine=ShaderChunk.lights_fragment_begin.split('\n').find(l=>l.includes('getShadow( spotShadowMap'))!
    expect(fragment).toContain(spotLine)
    expect(fragment).toContain('RE_Direct( directLight,')
  })
  it('decorates once while preserving existing compile and program cache hooks',()=>{
    const material=new MeshStandardMaterial();let called=0
    material.onBeforeCompile=()=>{called++};material.customProgramCacheKey=()=> 'terrain-morph-v3'
    decorateShadowFade(material);const hook=material.onBeforeCompile.bind(material),version=material.version;decorateShadowFade(material)
    expect(material.version).toBe(version)
    const shader={fragmentShader:'#include <common>\n#include <lights_fragment_begin>'} as Parameters<typeof hook>[0]
    hook.call(material,shader,{} as Parameters<typeof hook>[1])
    expect(called).toBe(1);expect(material.customProgramCacheKey()).toBe('terrain-morph-v3:flight-shadow-edge-v1')
    expect(shader.fragmentShader).toContain('flightShadowWeight')
  })
})
