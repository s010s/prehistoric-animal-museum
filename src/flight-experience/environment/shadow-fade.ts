import { ShaderChunk, type Material } from 'three'

/** Three 0.185.1 lights_fragment_begin: fade only the directional direct-light shadow.
 * All indirect/hemisphere light stays untouched. The final 18% of the 384m shadow
 * tile (69m each side) returns continuously to the unshadowed distant lighting.
 */
const directionalShadowCall = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )'
const decorated = new WeakSet<Material>()
export const SHADOW_EDGE_FADE = .18
export function shadowEdgeWeight(u: number, v: number, depth = .5): number {
  const smooth = (a:number,b:number,x:number) => {const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
  return smooth(0,SHADOW_EDGE_FADE,Math.min(u,v,1-u,1-v))*smooth(0,.04,depth)*(1-smooth(.94,1,depth))
}
const fadeDeclaration = `
float flightShadowWeight(vec4 coord) {
  vec3 p=coord.xyz/coord.w;
  float edge=min(min(p.x,p.y),min(1.-p.x,1.-p.y));
  return smoothstep(0.,${SHADOW_EDGE_FADE},edge)*smoothstep(0.,.04,p.z)*(1.-smoothstep(.94,1.,p.z));
}
`
export function withShadowEdgeFade(fragmentShader: string): string {
  if (!fragmentShader.includes('#include <lights_fragment_begin>')) return fragmentShader
  const original=ShaderChunk.lights_fragment_begin
  if(!original.includes(directionalShadowCall))throw new Error('Flight shadow fade: unsupported Three directional shadow chunk')
  const lighting=original.replace(directionalShadowCall,`mix(1.0, ${directionalShadowCall}, flightShadowWeight(vDirectionalShadowCoord[ i ]))`)
  return fragmentShader.replace('#include <common>',`#include <common>\n${fadeDeclaration}`)
    .replace('#include <lights_fragment_begin>',lighting)
}
/** Call after a material's own compile hook is assigned. Chained, idempotent per material. */
export function decorateShadowFade(material: Material): void {
  if(decorated.has(material))return
  decorated.add(material)
  const compile=material.onBeforeCompile.bind(material),cacheKey=material.customProgramCacheKey.bind(material)
  material.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);shader.fragmentShader=withShadowEdgeFade(shader.fragmentShader)}
  material.customProgramCacheKey=function(){return `${cacheKey.call(this)}:flight-shadow-edge-v1`}
  material.needsUpdate=true
}
