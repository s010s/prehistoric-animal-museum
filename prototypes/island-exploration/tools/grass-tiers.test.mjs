// P8 targeted checks prewritten before tier implementation; original P6 eight remain unchanged.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
try{
 const m=await import('../grass-stability.js');
 assert.equal(typeof m.grassTierState,'function','P8 tier reference is missing');
 const state=(distance,tier=0,seed=.3,range=85,resolvedWidth=1.75)=>m.grassTierState({distance,tier,seed,range,resolvedWidth});
 check('near candidate matches original widening for every fixed tier and both ranges',()=>{
  for(const range of [48,85])for(const tier of [0,1,2])for(const d of [0,range*.1,range*.14]){
   const s=state(d,tier,.2,range,1.12);assert.equal(s.width,1.12);assert.equal(s.visibility,1);
  }
 });
 check('retiring early blades leave wide survivors and compensation stays finite and capped',()=>{
  for(const range of [48,85])for(let i=0;i<=1000;i++){
   const d=i*range/1000;
   for(const tier of [0,1,2]){const s=state(d,tier,.5,range);assert(s.width>=0&&s.width<=3);assert(s.compensation>=1&&s.compensation<=3);assert(s.visibility>=0&&s.visibility<=1);}
  }
  assert.equal(state(25,2).width,0);assert(state(25,0).width>=1.75);
  assert.equal(state(50,1).width,0);assert.equal(state(50,0).width,3);
 });
 check('tier transitions have continuous width and no surviving-blade density cliff',()=>{
  for(const range of [48,85])for(const ratio of [.14,.22,.37,.52])for(const tier of [0,1,2]){
   const d=range*ratio,a=state(d-1e-5,tier,.3,range),b=state(d+1e-5,tier,.3,range);assert(Math.abs(a.width-b.width)<1e-4);
  }
 });
 check('fixed identities stagger final deadlines, exit briefly and stay within old far endpoint',()=>{
  for(const range of [48,85]){
   const cuts=[0,.25,.5,.75].map(seed=>state(0,0,seed,range).cutoff);assert.equal(new Set(cuts).size,4);
   for(const seed of [0,.25,.5,.75,1]){const s=state(0,0,seed,range);assert(s.cutoff>=range*.78&&s.cutoff<=range*.98);assert.equal(state(s.cutoff,0,seed,range).width,0);assert.equal(state(s.cutoff-range*.06,0,seed,range).visibility,1);assert.equal(state(range,0,seed,range).width,0);}
  }
 });
 check('actual patch retains legacy branch and shares tier uniform in both shader stages',()=>{
  const s={uniforms:{},vertexShader:'#include <common>\nfloat resolvedWidth=1.75,widthFade=.5,bladeDistance=35.;vec3 root=vec3(0.);transformed+=bladeSide*(resolvedWidth*widthFade-1.);',fragmentShader:'#include <common>\n#include <alphatest_fragment>\nfloat densityFade=.4;diffuseColor.a*=densityFade;if(densityFade<.001)discard;'};
  m.patchGrassBladeStability(s);m.patchGrassBladeTiers(s);
  assert.equal(s.uniforms.grassBladeStabilityEnabled,m.grassBladeStabilityEnabled);
  for(const src of [s.vertexShader,s.fragmentShader])assert.equal((src.match(/uniform bool grassBladeStabilityEnabled;/g)||[]).length,1);
  assert(s.vertexShader.includes('transformed+=bladeSide*(resolvedWidth*widthFade-1.)'));
  assert(s.vertexShader.includes('attribute vec2 bladeLod;'));assert(s.vertexShader.includes('root.xz'));
  assert(s.fragmentShader.includes('if(densityFade<.001)discard;'));assert(s.fragmentShader.includes('grassTierVisibility'));
  assert(!/gl_FragCoord|texture\w*\s*\(/.test(s.vertexShader));
 });
 const props=await readFile(new URL('../props.js',import.meta.url),'utf8');
 check('real geometric blades own identity; tier callback does not escape grassPart',()=>{
  const grass=props.slice(props.indexOf('const grassCompile=grassPart.material.onBeforeCompile'),props.indexOf('const swardCompile='));
  assert(grass.includes('patchGrassBladeTiers(shader)'));
  assert.equal((props.match(/patchGrassBladeTiers\(shader\)/g)||[]).length,1);
  assert(props.includes('bladeLod.push(k%3,k)'));assert(props.includes("grassG.setAttribute('bladeLod'"));
 });
 console.log(JSON.stringify({passed:true,count:checks.length,checks,gpuExecuted:false}));
}catch(error){console.log(JSON.stringify({passed:false,count:checks.length,checks,error:String(error),gpuExecuted:false}));process.exitCode=1;}
