// Failure inventory was written first in phase3/foliage-coverage-preimplementation.md.
// Phase4 boundary extension was written first in phase4/coverage-failure-cases.md.
// Public math/patch/toggle seams plus props callback wiring. No WebGL context.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import * as T from 'three';
const checks=[];const check=(name,fn)=>{try{fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:String(error)});}};
let api;try{api=await import('../foliage-coverage.js');}catch(error){checks.push({name:'coverage candidate module exists',passed:false,error:String(error)});}
if(api){
 const {foliageCoverageEnabled,setFoliageCoverage,foliageThreshold,foliageAlphaCoverage,patchFoliageCoverage}=api;
 check('candidate is shared, enabled by default; A/B restores only radius and uniform',()=>{assert.equal(foliageCoverageEnabled.value,true);const light=new T.DirectionalLight();light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-140,right:140,top:140,bottom:-140,near:1,far:1200});light.shadow.bias=-.00015;light.shadow.normalBias=.08;const before={map:light.shadow.mapSize.toArray(),camera:[light.shadow.camera.left,light.shadow.camera.right,light.shadow.camera.top,light.shadow.camera.bottom,light.shadow.camera.near,light.shadow.camera.far],bias:light.shadow.bias,normalBias:light.shadow.normalBias};for(const [enabled,radius]of[[false,1],[true,1.5],[false,1],[true,1.5]]){setFoliageCoverage(enabled,light);assert.equal(foliageCoverageEnabled.value,enabled);assert.equal(light.shadow.radius,radius);assert.deepEqual({map:light.shadow.mapSize.toArray(),camera:[light.shadow.camera.left,light.shadow.camera.right,light.shadow.camera.top,light.shadow.camera.bottom,light.shadow.camera.near,light.shadow.camera.far],bias:light.shadow.bias,normalBias:light.shadow.normalBias},before);}setFoliageCoverage(false);assert.equal(foliageCoverageEnabled.value,false);setFoliageCoverage(true);});
 check('known texture footprints keep base coverage then compensate by bounded mip bias',()=>{assert.equal(foliageThreshold({uvDx:[0,0],uvDy:[0,0],mapSize:[512,256]}),.28);assert.ok(Math.abs(foliageThreshold({uvDx:[4/512,0],uvDy:[0,0],mapSize:[512,256]})-.26)<1e-12);assert.ok(Math.abs(foliageThreshold({uvDx:[0,0],uvDy:[0,16/256],mapSize:[512,256]})-.24)<1e-12);assert.ok(Math.abs(foliageThreshold({uvDx:[1024/512,0],uvDy:[0,0],mapSize:[512,256]})-.24)<1e-12);});
 check('invalid footprint input fails rather than reporting a NaN threshold',()=>{for(const input of[{uvDx:[NaN,0],uvDy:[0,0],mapSize:[512,256]},{uvDx:[0,0],uvDy:[0,0],mapSize:[0,256]},{uvDx:[0,0],uvDy:[0,0],mapSize:[512,Infinity]}])assert.throws(()=>foliageThreshold(input));});
 check('centred edge is half covered at threshold, symmetric and epsilon safe',()=>{assert.equal(foliageAlphaCoverage(.28,.08,.28),.5);assert.equal(foliageAlphaCoverage(.24,.08,.28),0);assert.equal(foliageAlphaCoverage(.32,.08,.28),1);assert.ok(Math.abs(foliageAlphaCoverage(.26,.08,.28)+foliageAlphaCoverage(.3,.08,.28)-1)<1e-12);assert.equal(foliageAlphaCoverage(.28,0,.28),.5);});
 const cutoffs=[.24,.25,.26,.275,.28];
 const boundaryWidths=threshold=>[0,1.e-12,1.e-5,.02,.08,2*threshold-1.e-8,2*threshold,2*threshold+1.e-8,1,2,1.e6,Number.MAX_VALUE];
 check('phase4 transparent alpha stays exactly zero even for broad derivatives',()=>{
  for(const threshold of cutoffs)for(const width of boundaryWidths(threshold))assert.equal(foliageAlphaCoverage(0,width,threshold),0,`transparent endpoint: threshold=${threshold}, width=${width}`);
 });
 check('phase4 opaque alpha stays exactly one even for broad derivatives',()=>{
  for(const threshold of cutoffs)for(const width of boundaryWidths(threshold))assert.equal(foliageAlphaCoverage(1,width,threshold),1,`opaque endpoint: threshold=${threshold}, width=${width}`);
 });
 check('phase4 derivative width does not shift the half-coverage threshold',()=>{
  for(const threshold of cutoffs)for(const width of boundaryWidths(threshold))assert.equal(foliageAlphaCoverage(threshold,width,threshold),.5,`midpoint: threshold=${threshold}, width=${width}`);
 });
 check('phase4 finite extreme derivatives remain bounded and alpha-monotone',()=>{
  for(const threshold of cutoffs)for(const width of boundaryWidths(threshold)){
   let previous=-1;
   for(let i=0;i<=256;i++){
    const alpha=i/256,value=foliageAlphaCoverage(alpha,width,threshold);
    assert.ok(Number.isFinite(value)&&value>=0&&value<=1,`bounded: alpha=${alpha}, threshold=${threshold}, width=${width}, value=${value}`);
    assert.ok(value>=previous,`alpha reversal: threshold=${threshold}, width=${width}, alpha=${alpha}`);previous=value;
   }
  }
 });
 check('phase4 ordinary centred transitions preserve existing values and symmetry',()=>{
  const oldCoverage=(alpha,width,threshold)=>{const t=Math.min(1,Math.max(0,(alpha-threshold)/Math.max(width,1.e-5)+.5));return t*t*(3-2*t);};
  for(const threshold of cutoffs)for(const width of[.02,.08])for(const fraction of[-.75,-.5,-.25,0,.25,.5,.75]){
   const alpha=threshold+fraction*width,value=foliageAlphaCoverage(alpha,width,threshold);
   assert.ok(Math.abs(value-oldCoverage(alpha,width,threshold))<1.e-12);
   assert.ok(Math.abs(value+foliageAlphaCoverage(2*threshold-alpha,width,threshold)-1)<1.e-12);
  }
  for(const threshold of cutoffs)for(const width of[0,1.e-12,1.e-5]){assert.equal(foliageAlphaCoverage(threshold-1.e-4,width,threshold),0);assert.equal(foliageAlphaCoverage(threshold+1.e-4,width,threshold),1);}
 });
 check('phase4 alpha, derivative-boundary and cutoff continuity survive endpoint repair',()=>{
  const delta=1.e-10;
  for(const threshold of cutoffs)for(const width of boundaryWidths(threshold))for(const alpha of[0,1.e-8,threshold-width/2,threshold,threshold+width/2,1-1.e-8,1].filter(x=>x>=0&&x<=1)){
   const left=foliageAlphaCoverage(Math.max(0,alpha-delta),width,threshold),right=foliageAlphaCoverage(Math.min(1,alpha+delta),width,threshold);
   assert.ok(Math.abs(right-left)<4.e-5,`alpha discontinuity: alpha=${alpha}, threshold=${threshold}, width=${width}`);
  }
  for(const threshold of cutoffs)for(const width of[1.e-5,2*threshold,2*(1-threshold)])for(const alpha of[0,threshold-1.e-6,threshold,threshold+1.e-6,.5,1]){
   assert.ok(Math.abs(foliageAlphaCoverage(alpha,width+delta,threshold)-foliageAlphaCoverage(alpha,width-delta,threshold))<4.e-5,`width discontinuity: width=${width}, threshold=${threshold}, alpha=${alpha}`);
  }
  for(const threshold of cutoffs)for(const alpha of[0,.2,threshold,.3,1])assert.ok(Math.abs(foliageAlphaCoverage(alpha,.08,threshold+delta)-foliageAlphaCoverage(alpha,.08,threshold-delta))<1.e-7);
 });
 check('phase4 mip cutoff values, bounds, continuity and texture-pixel footprint regressions',()=>{
  const thresholdAt=footprint=>foliageThreshold({uvDx:[footprint/512,0],uvDy:[0,0],mapSize:[512,256]});
  for(const [footprint,expected]of[[0,.28],[1,.28],[Math.SQRT2,.275],[2,.27],[4,.26],[8,.25],[16,.24],[1.e6,.24]])assert.ok(Math.abs(thresholdAt(footprint)-expected)<1.e-12,`cutoff: footprint=${footprint}`);
  let previous=.28;
  for(let i=-16;i<=64;i++){const value=thresholdAt(2**(i/8));assert.ok(value>=.24-1.e-12&&value<=.28+1.e-12);assert.ok(value<=previous+1.e-12);previous=value;}
  for(const footprint of[1,2,4,8,16])assert.ok(Math.abs(thresholdAt(footprint-1.e-8)-thresholdAt(footprint+1.e-8))<1.e-8);
  for(const footprint of[1,2,4,8,16,1024]){
   const expected=thresholdAt(footprint);
   for(const input of[
    {uvDx:[-footprint/512,0],uvDy:[0,0],mapSize:[512,256]},
    {uvDx:[0,0],uvDy:[0,-footprint/256],mapSize:[512,256]},
    {uvDx:[footprint/Math.SQRT2/512,footprint/Math.SQRT2/256],uvDy:[0,0],mapSize:[512,256]},
    {uvDx:[footprint/1024,0],uvDy:[0,0],mapSize:[1024,128]}
   ])assert.ok(Math.abs(foliageThreshold(input)-expected)<1.e-12);
  }
 });
 check('actual standard/depth shaders share live uniform, real map dimensions and explicit threshold',()=>{const map=new T.Texture({width:512,height:256}),colour={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader},depth={uniforms:{},vertexShader:T.ShaderLib.depth.vertexShader,fragmentShader:T.ShaderLib.depth.fragmentShader};patchFoliageCoverage(colour,{map,depth:false});patchFoliageCoverage(depth,{map,depth:true});for(const shader of[colour,depth]){assert.equal(shader.uniforms.foliageCoverageEnabled,foliageCoverageEnabled);assert.deepEqual(shader.uniforms.foliageMapSize.value,[512,256]);assert.equal(shader.uniforms.foliageBaseThreshold.value,.28);assert.match(shader.fragmentShader,/dFdx\(uv\)\*foliageMapSize/);assert.match(shader.fragmentShader,/dFdy\(uv\)\*foliageMapSize/);assert.match(shader.fragmentShader,/foliageMipThreshold\(vMapUv\)/);assert.equal((shader.fragmentShader.match(/float foliageMipThreshold\(/g)||[]).length,1);assert.match(shader.fragmentShader,/#include <alphatest_fragment>/);assert.ok(shader.fragmentShader.indexOf('uniform bool foliageCoverageEnabled')<shader.fragmentShader.indexOf('void main()'));}assert.match(colour.fragmentShader,/fwidth\(diffuseColor\.a\)/);assert.match(colour.fragmentShader,/foliageCutoff-.5\*foliageWidth,foliageCutoff\+.5\*foliageWidth/);assert.match(depth.fragmentShader,/if\(diffuseColor\.a<foliageCutoff\)discard/);assert.doesNotMatch(depth.fragmentShader,/fwidth\(diffuseColor\.a\)/);assert.match(depth.fragmentShader,/if\(foliageCoverageEnabled\)/);});
 check('patch fails loudly for unsupported shader and missing map dimensions',()=>{assert.throws(()=>patchFoliageCoverage({uniforms:{},fragmentShader:'void main(){}'},{map:new T.Texture({width:512,height:256})}));assert.throws(()=>patchFoliageCoverage({uniforms:{},fragmentShader:T.ShaderLib.standard.fragmentShader},{map:new T.Texture()}));});
 const shadow=await import('../shadow-budget.js');
 check('projected PCF keeps five comparison calls and legacy IGN; point variants stay byte-identical',()=>{const raw=T.ShaderChunk.shadowmap_pars_fragment,out=shadow.patchShadowChunk(raw),boundary=raw.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0',raw.indexOf('float getShadow('));assert.equal(out.slice(out.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0',out.indexOf('float getShadow('))),raw.slice(boundary));assert.match(out,/float phi = foliageCoverageEnabled \? 0\.0 : interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;/);assert.equal((out.slice(0,out.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0',out.indexOf('float getShadow('))).match(/texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample/g)||[]).length,5);});
 const {makeAtmosphere}=await import('../atmosphere.js');
 check('actual atmosphere shader declares and exposes shared PCF switch once',()=>{const material=new T.MeshStandardMaterial(),object=new T.Mesh(new T.BoxGeometry(),material);makeAtmosphere({}).apply(object);const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);assert.equal(shader.uniforms.foliageCoverageEnabled,foliageCoverageEnabled);assert.equal((shader.fragmentShader.match(/uniform bool foliageCoverageEnabled;/g)||[]).length,1);assert.ok(shader.fragmentShader.indexOf('uniform bool foliageCoverageEnabled;')<shader.fragmentShader.indexOf('float getShadow('));assert.match(shader.fragmentShader,/foliageCoverageEnabled \? 0\.0/);});
 const props=readFileSync(new URL('../props.js',import.meta.url),'utf8');
 check('real near callback and custom depth both patch leaf coverage, leave LOD/wind unchanged',()=>{assert.match(props,/if\(habitat&&part\.material\.alphaTest>0\)patchFoliageCoverage\(s,\{map:part\.material\.map,depth:false\}\)/);assert.match(props,/if\(part\.material\.alphaTest>0\)patchFoliageCoverage\(s,\{map:mesh\.material\.map,depth:true\}\)/);assert.match(props,/customDepthMaterial\.customProgramCacheKey[^\n]*coverage/);assert.match(props,/near-canopy-r12-coverage/);assert.match(props,/nearCoverage=1\.-smoothstep\(\$\{habitat\?'80\.,112\.,rootDistance'/);assert.equal((props.match(/treeWindOffset\(position,(?:root|treeRoot),leafMotion,mat3\(modelMatrix\*instanceMatrix\)\)/g)||[]).length,2);const forest=readFileSync(new URL('../forest-impostor.js',import.meta.url),'utf8');assert.match(forest,/if\(transitionNoise<nearCoverage\|\|transitionNoise>distant\)discard/);assert.doesNotMatch(forest,/foliageCoverage/);});
 check('review wind setter freezes only tree time, rejects invalid input and resumes current frame time',()=>{const match=props.match(/function setTreeWindTime\(value\)\{([^]*?)\n \}/);assert.ok(match);const context={treeTime:{value:60},treeWindTimeOverride:null,lastTreeWindInputTime:60};vm.createContext(context);vm.runInContext(match[0]+';setTreeWindTime(61);',context);assert.equal(context.treeTime.value,61);assert.equal(context.treeWindTimeOverride,61);for(const value of['NaN','Infinity','"61"','undefined'])assert.throws(()=>vm.runInContext('setTreeWindTime('+value+');',context));context.lastTreeWindInputTime=74;vm.runInContext('setTreeWindTime(null);',context);assert.equal(context.treeWindTimeOverride,null);assert.equal(context.treeTime.value,74);assert.match(props,/lastTreeWindInputTime=time;treeTime\.value=treeWindTimeOverride\?\?time/);assert.match(props,/plantTime\.value=time/);assert.match(props,/return \{auditTrees,setTreeWindTime,/);assert.match(props,/treeWindTime:\{value:treeTime\.value,override:treeWindTimeOverride\}/);});
}
const result={schema:'foliage-coverage-offline-v1',scope:'math, public switch/patch seams and actual callback source wiring; driver compile and perceptual acceptance require headed E2E',failureInventory:'docs/research/perceptual-budget/phase4/coverage-failure-cases.md',coverageSourceSha256:createHash('sha256').update(readFileSync(new URL('../foliage-coverage.js',import.meta.url))).digest('hex'),gpuExecuted:false,checks,passed:checks.length>1&&checks.every(x=>x.passed)};
if(process.argv[2]){const path=resolve(process.argv[2]);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
