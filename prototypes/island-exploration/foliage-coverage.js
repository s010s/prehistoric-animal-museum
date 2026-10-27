// Local coverage compensation informed by Tidewater's vegCoverageThreshold:
// https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/world/vegetation/VegMaterials.js#L619
// Tidewater lowers a hard mask threshold as ordinary mipmaps lose coverage.
// Here genuine near leaves retain MSAA alpha-to-coverage; the single-sample
// shadow remains a binary mask, NOT fractional coverage. No TAA or new passes.
export const foliageCoverageEnabled={value:true};
// Review-only legacy switch; ordinary rendering always preserves alpha endpoints.
export const foliageEdgeSafeEnabled={value:true};
export function setFoliageEdgeSafe(enabled){foliageEdgeSafeEnabled.value=Boolean(enabled);}
export const foliageCoverageConfig=Object.freeze({baseThreshold:.28,mipReduction:.04,mipLevels:4,candidateRadius:1.5,legacyRadius:1,pcfRotation:'fixed-zero',pcfComparisonCalls:5});
const baseThreshold={value:foliageCoverageConfig.baseThreshold};
export function setFoliageCoverage(enabled,light){
 foliageCoverageEnabled.value=Boolean(enabled);
 if(light)light.shadow.radius=enabled?foliageCoverageConfig.candidateRadius:foliageCoverageConfig.legacyRadius;
}
export function attachFoliageCoverageSwitch(shader){
 shader.uniforms.foliageCoverageEnabled=foliageCoverageEnabled;
 if(!shader.fragmentShader.includes('uniform bool foliageCoverageEnabled;'))shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform bool foliageCoverageEnabled;');
}
const thresholdGLSL=`
#if defined(USE_MAP) && defined(USE_ALPHATEST)
uniform vec2 foliageMapSize;
uniform float foliageBaseThreshold;
float foliageMipThreshold(vec2 uv){
 vec2 dx=dFdx(uv)*foliageMapSize,dy=dFdy(uv)*foliageMapSize;
 float footprint=max(length(dx),length(dy));
 float lod=log2(max(footprint,1.));
 return foliageBaseThreshold-.04*clamp(lod*.25,0.,1.);
}
#endif
`;
export function patchFoliageCoverage(shader,{map,depth=false}){
 const size=map?.image??map?.source?.data,width=size?.width,height=size?.height;
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Foliage coverage requires actual loaded map dimensions');
 if(!shader.fragmentShader.includes('#include <common>')||!shader.fragmentShader.includes('#include <alphatest_fragment>'))throw Error('Unsupported foliage coverage shader');
 attachFoliageCoverageSwitch(shader);
 Object.assign(shader.uniforms,{foliageMapSize:{value:[width,height]},foliageBaseThreshold:baseThreshold,foliageEdgeSafeEnabled});
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform bool foliageEdgeSafeEnabled;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+thresholdGLSL)
 .replace('#include <alphatest_fragment>',`
#if defined(USE_MAP) && defined(USE_ALPHATEST)
 if(foliageCoverageEnabled){
  // Explicit uniform bypasses WebGLShadowMap's forced alphaTest=0.5 for A2C.
  float foliageCutoff=foliageMipThreshold(vMapUv);
  ${depth?'if(diffuseColor.a<foliageCutoff)discard;':`#ifdef ALPHA_TO_COVERAGE
  float foliageWidth=max(fwidth(diffuseColor.a),1.e-5);
  // An unbounded centred ramp resurrects transparent texels (and their gray
  // specular/fog RGB). Keep both endpoints while retaining the midpoint cutoff.
  if(foliageEdgeSafeEnabled)foliageWidth=min(foliageWidth,2.*min(foliageCutoff,1.-foliageCutoff));
  diffuseColor.a=smoothstep(foliageCutoff-.5*foliageWidth,foliageCutoff+.5*foliageWidth,diffuseColor.a);
  if(diffuseColor.a==0.)discard;
  #else
  if(diffuseColor.a<foliageCutoff)discard;
  #endif`}
 }else{
  #include <alphatest_fragment>
 }
#else
 #include <alphatest_fragment>
#endif
`);
}
// Deterministic references for isolated checks; never enumerate trees per frame.
export function foliageThreshold({uvDx,uvDy,mapSize}){
 if(![uvDx,uvDy,mapSize].every(a=>Array.isArray(a)&&a.length===2&&a.every(Number.isFinite))||mapSize.some(x=>x<=0))throw Error('Invalid foliage footprint');
 const footprint=Math.max(Math.hypot(uvDx[0]*mapSize[0],uvDx[1]*mapSize[1]),Math.hypot(uvDy[0]*mapSize[0],uvDy[1]*mapSize[1]));
 return .28-.04*Math.min(1,Math.log2(Math.max(footprint,1))/4);
}
export function foliageAlphaCoverage(alpha,width,threshold){
 const w=Math.min(Math.max(width,1.e-5),2*Math.min(threshold,1-threshold)),t=Math.min(1,Math.max(0,(alpha-threshold)/w+.5));return t*t*(3-2*t);
}
