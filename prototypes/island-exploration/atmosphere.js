import * as T from 'three'
import {terrainLightGLSL} from './terrain-light.js'
import {skyGLSL} from './sky.js'
// One linear-light atmospheric endpoint, including the same far sea used by the sky sphere.
export function makeAtmosphere(uniforms){
 const patched=new WeakSet();
 function shader(s){Object.assign(s.uniforms,uniforms);s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>\n${terrainLightGLSL}`).replace('#include <lights_fragment_end>',`#include <lights_fragment_end>\nfloat sunVisibility=worldSun(airWorld);reflectedLight.indirectDiffuse*=worldAmbient(airWorld);
// Preserve albedo, sky direction and cavity occlusion while opening the
// cliff-foot shade. A broad feather avoids a visible pool of fill light.
vec2 springOffset=(airWorld.xz-vec2(-2051.53,-680.))/vec2(115.,145.);
float springFill=1.-smoothstep(.35,1.,length(springOffset));
reflectedLight.indirectDiffuse*=1.+.9*springFill*terrainLightEnabled*(1.-sunVisibility);reflectedLight.directDiffuse*=sunVisibility;reflectedLight.directSpecular*=sunVisibility;`);s.fragmentShader=s.fragmentShader.replace('#include <shadowmap_pars_fragment>',T.ShaderChunk.shadowmap_pars_fragment.replaceAll('shadowCoord.xyz /= shadowCoord.w;', 'shadowCoord.xyz /= shadowCoord.w; shadowIntensity *= 1.-smoothstep(.32,.49,max(abs(shadowCoord.x-.5),abs(shadowCoord.y-.5)));'));
 s.vertexShader=s.vertexShader.replace('void main()','varying vec3 airWorld;\nvoid main()').replace('#include <project_vertex>',`vec4 airP=vec4(transformed,1.);
#ifdef USE_INSTANCING
 airP=instanceMatrix*airP;
#endif
 airWorld=(modelMatrix*airP).xyz;
#include <project_vertex>`);
 s.fragmentShader=s.fragmentShader.replace('void main()',`${skyGLSL}\nvarying vec3 airWorld;\nvoid main()`).replace('#include <tonemapping_fragment>',`
 vec3 ar=airWorld-cameraPosition;float ad=length(ar);vec3 ray=ar/max(1.,ad);
 float y0=max(cameraPosition.y,0.),y1=max(airWorld.y,0.),dy=y1-y0;
 float density=abs(dy)<.1?exp(-y0*.006):(exp(-y0*.006)-exp(-y1*.006))/(dy*.006);
 float extinction=1.-exp(-ad*(.000055+.00016*density));
 vec3 haze=skyGradient(normalize(vec3(ray.x,max(.025,ray.y),ray.z)));
 haze=mix(haze,ray.y<0.?seaDistance(ray):skyGradient(ray),smoothstep(7000.,14000.,ad));
 gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,clamp(extinction,0.,.98));
 #include <tonemapping_fragment>`);
 }
 return {uniforms,apply(object){object.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(patched.has(m))continue;patched.add(m);if(m.isShaderMaterial){shader(m);m.needsUpdate=true}else{const original=m.onBeforeCompile,key=m.customProgramCacheKey();m.onBeforeCompile=s=>{original.call(m,s);shader(s);if(m.isMeshBasicMaterial)s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','outgoingLight*=mix(.62,1.,worldSun(airWorld))*worldAmbient(airWorld);\n#include <opaque_fragment>')};m.customProgramCacheKey=()=>`island-air-r4-${key}`;m.needsUpdate=true}}})}};
}
