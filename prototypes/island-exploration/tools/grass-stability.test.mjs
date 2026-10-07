// Prewritten isolated shader/math checks. RED recorded before runtime module.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const checks=[];
const check=(name,fn)=>{fn();checks.push(name)};
try{
 const m=await import('../grass-stability.js');
 check('candidate defaults disabled; footprint interval resolves several pixels',()=>{
  assert.deepEqual(m.grassStabilityStatus().enabled,{ground:false,blades:false});
  assert.deepEqual(m.grassStabilityConfig.cyclesPerPixel,[.25,.75]);
 });
 check('ground and blade can be selected independently and restored',()=>{
  m.setGrassStability(true,{ground:true,blades:false});assert.deepEqual(m.grassStabilityStatus().enabled,{ground:true,blades:false});
  m.setGrassStability(true,{ground:false,blades:true});assert.deepEqual(m.grassStabilityStatus().enabled,{ground:false,blades:true});
  m.setGrassStability(false);assert.deepEqual(m.grassStabilityStatus().enabled,{ground:false,blades:false});
 });
 check('unresolved ground feature converges to mean, resolved and legacy stay identical',()=>{
  for(const value of [0,.2,.5,.8,1]){
   assert.equal(m.groundNoiseSample(value,.1,true),value);
   assert.equal(m.groundNoiseSample(value,.75,true),.5);
   for(const footprint of [0,.25,.5,.75,3])assert.equal(m.groundNoiseSample(value,footprint,false),value);
   const samples=[.25,.35,.5,.65,.75].map(f=>Math.abs(m.groundNoiseSample(value,f,true)-.5));
   assert(samples.every((v,i)=>i===0||v<=samples[i-1]+1e-12));
  }
 });
 check('blade candidate removes only second attenuation and preserves near opacity',()=>{
  for(const alpha of [0,.25,.7,1])for(const fade of [0,.1,.5,1]){
   assert.equal(m.grassBladeAlpha(alpha,fade,false),alpha*fade);
   assert.equal(m.grassBladeAlpha(alpha,fade,true),alpha);
  }
 });
 check('shader patch keeps original endpoint discard, single shared bool and existing alpha',()=>{
  const s={uniforms:{},fragmentShader:'#include <common>\n#include <alphatest_fragment>\nfloat densityFade=.4;diffuseColor.a*=densityFade;if(densityFade<.001)discard;'};
  m.patchGrassBladeStability(s);
  assert.equal(s.uniforms.grassBladeStabilityEnabled,m.grassBladeStabilityEnabled);
  assert.equal((s.fragmentShader.match(/uniform bool grassBladeStabilityEnabled;/g)||[]).length,1);
  assert(s.fragmentShader.includes('diffuseColor.a*=grassBladeOpacityFactor(densityFade);'));
  assert(s.fragmentShader.includes('if(densityFade<.001)discard;'));
  assert(s.fragmentShader.includes('#include <alphatest_fragment>'));
  assert(!s.fragmentShader.includes('diffuseColor.a=1.'));
 });
 check('malformed shader rejects without silent global replacements',()=>{
  assert.throws(()=>m.patchGrassBladeStability({uniforms:{},fragmentShader:'#include <common>'}));
  assert.throws(()=>m.patchGrassBladeStability({uniforms:{},fragmentShader:'#include <common>\ndiffuseColor.a*=densityFade;diffuseColor.a*=densityFade;'}));
 });
 check('ground bindings share stable uniform and shader helpers add no sampling',()=>{
  const s={uniforms:{},fragmentShader:'#include <common>'};m.attachGrassGroundStability(s);
  assert.equal(s.uniforms.grassGroundStabilityEnabled,m.grassGroundStabilityEnabled);
  assert.equal((s.fragmentShader.match(/uniform bool grassGroundStabilityEnabled;/g)||[]).length,1);
  assert(!/texture\w*\s*\(/.test(m.grassGroundStabilityGLSL));
  assert(!/gl_FragCoord|sin\(|cos\(|rand/.test(m.grassGroundStabilityGLSL));
 });
 const [props,world]=await Promise.all(['props.js','world.js'].map(n=>readFile(new URL('../'+n,import.meta.url),'utf8')));
 check('actual grass-only callback retains geometry/wind and terrain prepares footprint before branches',()=>{
  const grass=props.slice(props.indexOf('const grassCompile=grassPart.material.onBeforeCompile'),props.indexOf('const swardCompile='));
  assert(grass.includes('patchGrassBladeStability(shader)'));
  assert.equal((props.match(/patchGrassBladeStability\(shader\)/g)||[]).length,1);
  assert(grass.includes('transformed+=bladeSide*(resolvedWidth*widthFade-1.)'));
  assert(props.includes('plantTime.value=time'));
  assert(world.includes('attachGrassGroundStability(s)'));
  assert(world.indexOf('float pixelMetres=')<world.indexOf('if(w.z>.005)'));
  assert(world.includes('grassGroundNoise(nn(landP.xz*3.),pixelMetres*3.)'));
  assert(world.includes('grassGroundNoise(nn(p*11.),pixelMetres*11.)'));
 });
 console.log(JSON.stringify({passed:true,count:checks.length,checks,gpuExecuted:false}));
}catch(error){console.log(JSON.stringify({passed:false,count:checks.length,checks,error:String(error),gpuExecuted:false}));process.exitCode=1;}
