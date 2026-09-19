import { Color, ShaderChunk, Vector2, Vector3, Texture, type Material } from 'three'
import { ENVIRONMENT_ATMOSPHERE_GLSL } from './atmosphere'
import type { EnvironmentFrame } from './environment-state'

/** Retains Three's exact fog density/distance, replacing only its endpoint colour.
 * Fog executes AFTER tone mapping and output conversion in Three 0.185.1, so the
 * radiance endpoint is passed through those same transforms before the blend.
 */
export const ENVIRONMENT_FOG_FRAGMENT = ShaderChunk.fog_fragment.replace(
  'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  `vec3 flightFogRadiance=fogRadiance(inverseTransformDirection(flightFogView,viewMatrix));
  #if defined(TONE_MAPPING)
    flightFogRadiance=toneMapping(flightFogRadiance);
  #endif
  fogFactor=1.-(1.-fogFactor)*exp(-length(flightFogView)*weatherHaze/16000.);
  vec3 flightFogOutput=linearToOutputTexel(vec4(flightFogRadiance,1.)).rgb;
  gl_FragColor.rgb=mix(gl_FragColor.rgb,flightFogOutput,fogFactor);`,
)
export function createEnvironmentFog(initialFrame:EnvironmentFrame){
  const uniforms={cloudDensityMap:{value:new Texture()},cloudDataReady:{value:0},cloudAppearanceWeight:{value:0},cloudOrigin:{value:new Vector2()},cloudPhase:{value:new Vector2()},cloudCoverage:{value:0},cloudThickness:{value:0},weatherHaze:{value:0},rainWetness:{value:0},landDistanceReady:{value:0},animalRim:{value:1},solarWaveStrength:{value:1},solarWaterTime:{value:0},solarWaterOrigin:{value:new Vector2()},photographicSky:{value:0},skyLow:{value:new Color()},skyMid:{value:new Color()},skyUpper:{value:new Color()},waterHighlight:{value:1},skyColors:{value:0},skyZenith:{value:new Color()},horizon:{value:new Color()},sunDirection:{value:new Vector3()},sunColor:{value:new Color()}}
  const decorated=new WeakSet<Material>()
  function update(frame:EnvironmentFrame){
    uniforms.cloudCoverage.value=frame.cloudCoverage;uniforms.cloudThickness.value=frame.cloudThickness;uniforms.rainWetness.value=frame.wetness
    uniforms.photographicSky.value=frame.photographicSky;uniforms.skyLow.value.setRGB(...frame.skyLow);uniforms.skyMid.value.setRGB(...frame.skyMid);uniforms.skyUpper.value.setRGB(...frame.skyUpper)
    uniforms.skyZenith.value.setRGB(...frame.skyZenith);uniforms.horizon.value.setRGB(...frame.horizon)
    uniforms.sunDirection.value.set(...frame.sunDirectionWorld);uniforms.sunColor.value.setRGB(...frame.sunColor).multiplyScalar(frame.sunIntensity)
  }
  update(initialFrame)
  return {uniforms,update,
    /** Invoke after the material's own hook assignment; chains shadow/morph hooks. */
    decorate(material:Material,land=false){
      if(decorated.has(material))return
      decorated.add(material)
      const compile=material.onBeforeCompile.bind(material),cacheKey=material.customProgramCacheKey.bind(material)
      material.onBeforeCompile=function(shader,renderer){
        compile(shader,renderer)
        if(!shader.fragmentShader.includes('#include <fog_fragment>'))return
        Object.assign(shader.uniforms,uniforms)
        // mvPosition already includes skinning, morph, batching, instances and camera transform.
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 flightFogView;')
          .replace('#include <project_vertex>','#include <project_vertex>\nflightFogView=mvPosition.xyz;')
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 flightFogView;\n${ENVIRONMENT_ATMOSPHERE_GLSL}`)
          .replace('#include <fog_fragment>',land?ENVIRONMENT_FOG_FRAGMENT.replace('vec3 flightFogRadiance=', `// Once real distant coverage is published, clear-air visibility must not depend on camera altitude.
          float landDistance=length(flightFogView);
          float landHaze=(1.-exp(-max(0.,landDistance-1200.)/8000.));
          landHaze=mix(landHaze,1.,smoothstep(9500.,11500.,landDistance));
          fogFactor=mix(fogFactor,landHaze,landDistanceReady);
          vec3 flightFogRadiance=`).replace('fogRadiance(inverseTransformDirection(flightFogView,viewMatrix))','landFogRadiance(inverseTransformDirection(flightFogView,viewMatrix),landDistance)'):ENVIRONMENT_FOG_FRAGMENT)
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nfloat cloudT=cloudTransmission(flightWorldPoint(flightFogView),sunDirection);\nreflectedLight.directDiffuse*=cloudT;reflectedLight.directSpecular*=cloudT;`)
        if(land){
          const response=shader.fragmentShader.includes('vec3 trialC=')?'dot(tw,vec4(.55,.85,.95,.7))+dot(tx,vec2(.65,.35))':'.55'
          shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
            float rainResponse=${response};
            float rainExposure=.3+.7*clamp(inverseTransformDirection(normalize(vNormal),viewMatrix).y,0.,1.);
            float rainSurface=rainWetness*rainResponse*rainExposure;
            roughnessFactor=mix(roughnessFactor,max(.42,roughnessFactor*.72),rainSurface);diffuseColor.rgb*=1.-rainSurface*.18;
            #include <metalnessmap_fragment>
          `)
        }
        if(land)shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', `
          float landAltitude=smoothstep(120.,400.,cameraPosition.y)*landDistanceReady;
          outgoingLight+=diffuseColor.rgb*vec3(.10,.14,.19)*landAltitude;
          #include <opaque_fragment>
        `)
      }
      material.customProgramCacheKey=()=>`${cacheKey()}:flight-directional-fog-w1-clear-air:${land}`
      material.needsUpdate=true
    },
  }
}
