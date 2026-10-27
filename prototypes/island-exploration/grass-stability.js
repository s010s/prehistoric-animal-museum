// Bounded grass-only candidates. Tidewater's GrassField narrows geometry at
// handover; TerrainShading fades unresolved features by their pixel footprint.
// No temporal dither, texture query, extra target or pass is introduced here.
export const grassGroundStabilityEnabled={value:false};
export const grassBladeStabilityEnabled={value:false};
export const grassStabilityConfig=Object.freeze({cyclesPerPixel:Object.freeze([.25,.75]),bladeFade:'fixed-4-4-4-tiers',groundFade:'unresolved-noise-to-mean',bladeTiers:Object.freeze({counts:Object.freeze([4,4,4]),early:Object.freeze([.14,.22]),middle:Object.freeze([.37,.52]),finalCutoff:Object.freeze([.78,.98]),finalFade:.06,maxWidthMultiplier:3,distance:'existing-world-root-viewer',identity:'immutable-blade-and-world-root'})});
export function setGrassStability(enabled,{ground=true,blades=true}={}){
 grassGroundStabilityEnabled.value=Boolean(enabled&&ground);
 grassBladeStabilityEnabled.value=Boolean(enabled&&blades);
}
export function grassStabilityStatus(){return{enabled:{ground:grassGroundStabilityEnabled.value,blades:grassBladeStabilityEnabled.value},...grassStabilityConfig};}
export const grassGroundStabilityGLSL=`
uniform bool grassGroundStabilityEnabled;
float grassGroundNoise(float noiseValue,float cyclesPerPixel){
 if(!grassGroundStabilityEnabled||cyclesPerPixel<=.25)return noiseValue;
 if(cyclesPerPixel>=.75)return .5;
 return mix(.5,noiseValue,1.-smoothstep(.25,.75,cyclesPerPixel));
}
`;
const grassBladeStabilityGLSL=`
uniform bool grassBladeStabilityEnabled;
float grassBladeOpacityFactor(float fade){return grassBladeStabilityEnabled?1.:fade;}
`;
function requireCommon(shader){if(!shader.fragmentShader.includes('#include <common>'))throw Error('Unsupported grass common shader');}
const grassBladeTierGLSL=`
uniform bool grassBladeStabilityEnabled;
attribute vec2 bladeLod;
varying float grassTierVisibility;
vec2 grassTierWidth(float d,float range,vec2 lod,vec2 worldRoot,float resolvedWidth){
 float f2=1.-smoothstep(range*.14,range*.22,d);
 float f1=1.-smoothstep(range*.37,range*.52,d);
 // Immutable clump/root and blade identity: no frame or screen-space noise.
 vec3 seed=fract(vec3(worldRoot,lod.y)*.1031);
 seed+=dot(seed,seed.yzx+33.33);
 float cutoff=range*mix(.78,.98,fract((seed.x+seed.y)*seed.z));
 float own=lod.x>1.5?f2:lod.x>.5?f1:1.-smoothstep(cutoff-range*.06,cutoff,d);
 // Keep the final four in the denominator even while they retire.
 float compensation=3./(1.+f1+f2);
 return vec2(min(3.,resolvedWidth*compensation)*own,own);
}
`;
export function patchGrassBladeTiers(shader){
 requireCommon(shader);
 const width='transformed+=bladeSide*(resolvedWidth*widthFade-1.);';
 if(!shader.vertexShader?.includes('#include <common>')||shader.vertexShader.split(width).length!==2)throw Error('Unsupported grass width shader');
 if(!shader.fragmentShader.includes('grassBladeOpacityFactor(densityFade)'))throw Error('Grass tier patch requires the grass alpha patch');
 shader.uniforms.grassBladeStabilityEnabled=grassBladeStabilityEnabled;
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+grassBladeTierGLSL)
 .replace(width,`if(grassBladeStabilityEnabled){vec2 tierWidth=grassTierWidth(bladeDistance,grassFade.y,bladeLod,root.xz,resolvedWidth);grassTierVisibility=tierWidth.y;transformed+=bladeSide*(tierWidth.x-1.);}else{grassTierVisibility=1.;${width}}`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float grassTierVisibility;')
 .replace('diffuseColor.a*=grassBladeOpacityFactor(densityFade);','diffuseColor.a*=grassBladeOpacityFactor(densityFade);if(grassBladeStabilityEnabled&&grassTierVisibility<=.001)discard;');
}
export function attachGrassGroundStability(shader){
 requireCommon(shader);shader.uniforms.grassGroundStabilityEnabled=grassGroundStabilityEnabled;
 if(!shader.fragmentShader.includes('uniform bool grassGroundStabilityEnabled;'))shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+grassGroundStabilityGLSL);
}
export function patchGrassBladeStability(shader){
 requireCommon(shader);
 const existing='diffuseColor.a*=densityFade;';
 if(shader.fragmentShader.split(existing).length!==2)throw Error('Unsupported grass distance alpha shader');
 shader.uniforms.grassBladeStabilityEnabled=grassBladeStabilityEnabled;
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+grassBladeStabilityGLSL)
 .replace(existing,'diffuseColor.a*=grassBladeOpacityFactor(densityFade);');
}
// Deterministic references used only by explicit isolated evidence checks.
export function groundNoiseSample(value,cyclesPerPixel,enabled){
 if(!enabled||cyclesPerPixel<=.25)return value;
 if(cyclesPerPixel>=.75)return .5;
 const t=(cyclesPerPixel-.25)/.5,weight=1-t*t*(3-2*t);
 return .5+(value-.5)*weight;
}
export function grassBladeAlpha(alpha,fade,enabled){return alpha*(enabled?1:fade);}
export function grassTierState({distance,tier,seed,range,resolvedWidth=1.75}){
 if(![distance,tier,seed,range,resolvedWidth].every(Number.isFinite)||range<=0||distance<0||![0,1,2].includes(tier)||seed<0||seed>1||resolvedWidth<0)throw Error('Invalid grass tier reference input');
 const fade=(a,b,d)=>{const t=Math.max(0,Math.min(1,(d-a)/(b-a)));return 1-t*t*(3-2*t);};
 const f2=fade(range*.14,range*.22,distance),f1=fade(range*.37,range*.52,distance),cutoff=range*(.78+.2*seed);
 const visibility=tier===2?f2:tier===1?f1:fade(cutoff-range*.06,cutoff,distance),compensation=3/(1+f1+f2);
 return {width:Math.min(3,resolvedWidth*compensation)*visibility,visibility,compensation,cutoff};
}
