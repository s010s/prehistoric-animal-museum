import {patchNearShadowLighting} from './near-shadow.js';
// Only genuine near tree leaves opt in. The switch never changes map/pass budgets.
export const leafTransmission={enabled:{value:1}}
// Opt-in P6 material study, shared by real leaves and their relightable atlas.
// Keep the already shared pigment; change lighting, not texture brightness.
export const canopyCandidateEnabled={value:false}
export function setCanopyCandidate(enabled){canopyCandidateEnabled.value=Boolean(enabled)}
const strengths=Object.freeze({needle:.06,fan:.14,canopy:0})
const candidateStrengths=Object.freeze({needle:.25,fan:.5,canopy:.35})
export function setLeafTransmission(enabled){leafTransmission.enabled.value=enabled?1:0}
export function markTreeLeafMaterial(material,kind){
 if(!material.isMeshStandardMaterial||!(kind in strengths))throw Error('Leaf transmission requires a Standard needle/fan material');
 material.userData.treeLeafKind=kind;material.defines={...material.defines,ISLAND_LEAF_TRANSMISSION:1};return material;
}
export function leafUniformsFor(material){return{canopyCandidateEnabled,leafTransmissionEnabled:leafTransmission.enabled,...(material.userData?.treeLeafKind in strengths?{leafTransmissionStrength:{value:strengths[material.userData.treeLeafKind]},leafCandidateStrength:{value:candidateStrengths[material.userData.treeLeafKind]}}:{})}}
export const leafTransmissionGLSL=`
uniform bool canopyCandidateEnabled;
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
vec4 islandDirectionalReceiver(vec4 original,int lightIndex,float normalBias);
#endif
#ifdef ISLAND_LEAF_TRANSMISSION
uniform float leafTransmissionEnabled,leafTransmissionStrength,leafCandidateStrength;
float leafAngularWeight(vec3 n,vec3 l,vec3 v){
 vec3 leafN=dot(n,v)<0.?-n:n;
 float back=max(0.,-dot(leafN,l));
 float through=max(0.,-dot(v,l));
 return clamp(back*(.25+.75*through*through),0.,1.);
}
vec3 canopyTransmission(vec3 albedo,vec3 n,vec3 l,vec3 v){
 vec3 leafN=dot(n,v)<0.?-n:n;
 float back=max(0.,-dot(leafN,l)),through=max(0.,-dot(v,l));
 // Tidewater-inspired warm transmission within shadowed direct lighting.
 return (albedo*vec3(.9,1.,.65))*(leafCandidateStrength*back*(.3+.7*through*through*through));
}
#endif
#ifdef ISLAND_LEAF_REVIEW_FIXTURE
uniform float leafFixtureSunGate;
#endif
`
// Keep the native shadow query and other light loops intact. All inputs are view space.
export function patchSolarLighting(chunk){
 chunk=patchNearShadowLighting(chunk);
 // The atlas surface replaces the camera-facing card only for the P8 profile.
 chunk=chunk.replaceAll('vDirectionalShadowCoord[ i ]',`islandDirectionalReceiver(vDirectionalShadowCoord[ i ], UNROLLED_LOOP_INDEX, directionalLightShadow.shadowNormalBias)`);
 const a=chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'),b=chunk.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
 const endpoint='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
 if(a<0||b<=a)throw Error('Unknown Three directional lighting chunk');
 const block=chunk.slice(a,b);if(block.split(endpoint).length!==2)throw Error('Unknown Three directional lighting endpoint');
 return chunk.slice(0,a)+block.replace(endpoint,`directLight.color*=sunVisibility;
 ${endpoint}
 #ifdef ISLAND_LEAF_TRANSMISSION
 if(canopyCandidateEnabled)reflectedLight.directDiffuse+=directLight.color*clamp(leafTransmissionEnabled,0.,1.)*canopyTransmission(material.diffuseContribution,geometryNormal,directLight.direction,geometryViewDir);
 else reflectedLight.directDiffuse+=directLight.color*BRDF_Lambert(material.diffuseContribution)*(clamp(leafTransmissionEnabled,0.,1.)*clamp(leafTransmissionStrength,0.,.2)*leafAngularWeight(geometryNormal,directLight.direction,geometryViewDir));
 #endif`)+chunk.slice(b);
}
function unit(v){const d=Math.hypot(...v);return Number.isFinite(d)&&d>0?v.map(x=>x/d):null}
export function leafAngularWeight(normal,light,view){
 const n=unit(normal),l=unit(light),v=unit(view);if(!n||!l||!v)return 0;
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sign=dot(n,v)<0?-1:1,back=Math.max(0,-sign*dot(n,l)),through=Math.max(0,-dot(v,l));return Math.min(1,back*(.25+.75*through*through));
}
export function leafTransmissionDelta({normal,light,view,colour,albedo,strength,enabled,gate=1}){
 const weight=enabled?leafAngularWeight(normal,light,view)*Math.max(0,Math.min(.2,strength))*Math.max(0,Math.min(1,gate))/Math.PI:0;
 return colour.map((x,i)=>Math.max(0,x)*Math.max(0,albedo[i])*weight);
}
