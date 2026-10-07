import * as T from 'three'
import {terrainLightGLSL} from './terrain-light.js'
import {skyGLSL} from './sky.js'
import {shadowBudget,shadowFootprintEnabled,shadowBudgetGLSL,patchShadowChunk} from './shadow-budget.js'
import {markTreeLeafMaterial,leafUniformsFor,leafTransmissionGLSL,patchSolarLighting} from './leaf-transmission.js'
import {attachFoliageCoverageSwitch} from './foliage-coverage.js'
// One linear-light atmospheric endpoint, including the same far sea used by the sky sphere.
export function makeAtmosphere(uniforms){
 const patched=new WeakSet();
 function shader(s,m){Object.assign(s.uniforms,uniforms,{shadowBudgetEnabled:shadowBudget.enabled,shadowFootprintEnabled},leafUniformsFor(m));s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 airWorld;\nuniform float shadowBudgetEnabled;\n${terrainLightGLSL}\n${leafTransmissionGLSL}`).replace('#include <lights_fragment_begin>',`vec3 lightingWorld=airWorld;
#ifdef ISLAND_FOREST_SURFACE
if(canopyCandidateEnabled)lightingWorld=forestSurfaceWorld;
#endif
#ifdef ISLAND_FOREST_SURFACE
float sunVisibility=worldSun(lightingWorld);
#else
float sunVisibility=worldSun(airWorld);
#endif
#ifdef ISLAND_LEAF_REVIEW_FIXTURE
sunVisibility*=leafFixtureSunGate;
#endif
${patchSolarLighting(T.ShaderChunk.lights_fragment_begin)}`).replace('#include <lights_fragment_end>',`#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=worldAmbient(lightingWorld);
// Preserve albedo, sky direction and cavity occlusion while opening the
// cliff-foot shade. A broad feather avoids a visible pool of fill light.
vec2 springOffset=(lightingWorld.xz-vec2(-2051.53,-680.))/vec2(115.,145.);
float springFill=1.-smoothstep(.35,1.,length(springOffset));
// Open the river clearing's sky diffuse without flattening its direct shadows.
vec2 clearingOffset=(lightingWorld.xz-vec2(-1969.27,-560.))/vec2(75.,90.);
float clearingFill=1.-smoothstep(.25,1.,length(clearingOffset));
float shadeFill=max(.9*springFill*(1.-sunVisibility),.65*clearingFill);
reflectedLight.indirectDiffuse*=1.+shadeFill*terrainLightEnabled;`);s.fragmentShader=s.fragmentShader.replace('#include <shadowmap_pars_fragment>',`${shadowBudgetGLSL}\n${patchShadowChunk(T.ShaderChunk.shadowmap_pars_fragment)}`);
 s.vertexShader=s.vertexShader.replace('void main()','varying vec3 airWorld;\nvoid main()').replace('#include <project_vertex>',`vec4 airP=vec4(transformed,1.);
#ifdef USE_INSTANCING
 airP=instanceMatrix*airP;
#endif
 airWorld=(modelMatrix*airP).xyz;
#include <project_vertex>`);
 s.fragmentShader=s.fragmentShader.replace('void main()',`${skyGLSL}
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
vec4 islandDirectionalReceiver(vec4 original,int lightIndex,float normalBias){
#ifdef ISLAND_FOREST_SURFACE
 if(canopyCandidateEnabled)return directionalShadowMatrix[lightIndex]*vec4(forestSurfaceWorld+forestSurfaceNormal*normalBias,1.);
#endif
 return original;
}
#endif
void main()`).replace('#include <tonemapping_fragment>',`
 vec3 ar=airWorld-cameraPosition;float ad=length(ar);vec3 ray=ar/max(1.,ad);
 float y0=max(cameraPosition.y,0.),y1=max(airWorld.y,0.),dy=y1-y0;
 float density=abs(dy)<.1?exp(-y0*.006):(exp(-y0*.006)-exp(-y1*.006))/(dy*.006);
 float extinction=1.-exp(-ad*(.000055+.00016*density));
 vec3 haze=skyGradient(normalize(vec3(ray.x,max(.025,ray.y),ray.z)));
 haze=mix(haze,ray.y<0.?seaDistance(ray):skyGradient(ray),smoothstep(7000.,14000.,ad));
 gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,clamp(extinction,0.,.98));
 #include <tonemapping_fragment>`);
 // Lower dielectric response before evaluating the BRDF, so diffuse energy
 // compensation uses the same inputs. Legacy leaves retain their old endpoint.
 if(m.userData?.treeLeafKind)s.fragmentShader=s.fragmentShader.replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
 if(canopyCandidateEnabled){material.specularColor*=.15;material.specularColorBlended*=.15;material.specularF90*=.15;}`);
 attachFoliageCoverageSwitch(s);
 }
 return {uniforms,apply(object){object.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(patched.has(m))continue;patched.add(m);if(m.userData?.treeLeafKind)markTreeLeafMaterial(m,m.userData.treeLeafKind);if(m.isShaderMaterial){shader(m,m);m.needsUpdate=true}else{const original=m.onBeforeCompile,key=m.customProgramCacheKey();m.onBeforeCompile=s=>{original.call(m,s);shader(s,m);if(m.isMeshBasicMaterial)s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','outgoingLight*=mix(.62,1.,worldSun(airWorld))*worldAmbient(airWorld);\n#include <opaque_fragment>')};m.customProgramCacheKey=()=>`island-air-r6-${key}`;m.needsUpdate=true}}})}};
}
