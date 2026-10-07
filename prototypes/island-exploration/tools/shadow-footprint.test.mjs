// P8 failure inventory preceded this check and all implementation.
// Test projection invariants and pinned Five-PCF integration, not GPU quality.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import * as T from 'three';
import * as api from '../shadow-budget.js';
import {patchNearShadowLighting,makeNearShadow} from '../near-shadow.js';
const cases=[];const check=(name,fn)=>{try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:String(e)});}};
check('footprint switch restores exact old filter without changing projection',()=>{
 const light=new T.DirectionalLight(),scene=new T.Scene();light.castShadow=true;scene.add(light,light.target);const before=light.shadow.mapSize.toArray();api.setShadowFootprint(false);assert.equal(api.shadowFootprintEnabled.value,false);api.setShadowFootprint(true);assert.equal(api.shadowFootprintEnabled.value,true);assert.deepEqual(light.shadow.mapSize.toArray(),before);const near=makeNearShadow({scene,sun:light});assert.equal(near.status().enabled,false);assert.deepEqual(near.resources(),[]);near.dispose();
 assert.deepEqual(api.shadowFootprintReference({baseRadius:.01,dx:[.03,.04,.07],dy:[-.04,.03,-.01],enabled:false}),{radius:.01,depthSlope:[0,0]});
});
check('filter never shrinks base and spans conservative receiver pixel half diagonal',()=>{
 assert.deepEqual(api.shadowFootprintReference({baseRadius:.02,dx:[0,0,0],dy:[0,0,0]}),{radius:.02,depthSlope:[0,0]});
 const f=api.shadowFootprintReference({baseRadius:.001,dx:[.02,0,.06],dy:[0,.04,-.08]});assert.ok(Math.abs(f.radius-Math.hypot(.02,.04)*.5)<1e-12);assert.ok(Math.abs(f.depthSlope[0]-3)<1e-12);assert.ok(Math.abs(f.depthSlope[1]+2)<1e-12);
});
check('rotated and mirrored receiver planes retain correct comparison depth',()=>{
 for(const dx of [[.03,.04],[-.03,.04]])for(const dy of [[-.02,.05],[.02,-.05]]){
  const slope=[1.7,-.4],z=v=>v[0]*slope[0]+v[1]*slope[1],f=api.shadowFootprintReference({baseRadius:.001,dx:[...dx,z(dx)],dy:[...dy,z(dy)]});assert.ok(Math.abs(f.depthSlope[0]-slope[0])<1e-12);assert.ok(Math.abs(f.depthSlope[1]-slope[1])<1e-12);
 }
});
check('camera footprint scaling is continuous without integer radius levels',()=>{
 let previous=.01;for(let i=0;i<=1000;i++){const scale=i/1000,f=api.shadowFootprintReference({baseRadius:.01,dx:[.08*scale,.02*scale,.01*scale],dy:[-.01*scale,.06*scale,.03*scale]});assert.ok(Number.isFinite(f.radius));assert.ok(f.radius>=previous-1e-12);assert.ok(f.radius-previous<.0001);previous=f.radius;}
 const flat=api.shadowFootprintReference({baseRadius:.01,dx:[.1,0,.3],dy:[.2,0,.6]});assert.deepEqual(flat.depthSlope,[0,0]);assert.ok(Number.isFinite(flat.radius));
});
check('actual projected PCF derivatives precede frustum and only five comparisons remain',()=>{
 const raw=T.ShaderChunk.shadowmap_pars_fragment,out=api.patchShadowChunk(raw),a=out.indexOf('float getShadow( sampler2DShadow'),b=out.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )',a),block=out.slice(a,b),point=raw.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0',raw.indexOf('float getShadow('));assert.ok(block.indexOf('islandShadowReceiverFootprint(')<block.indexOf('if ( frustumTest )'));assert.equal((block.match(/texture\( shadowMap,/g)||[]).length,5);assert.equal((block.match(/islandShadowComparisonCoord\(/g)||[]).length,5);assert.match(block,/shadowFootprintEnabled \? 0\.0/);assert.equal(out.slice(out.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0',out.indexOf('float getShadow('))),raw.slice(point));assert.match(api.shadowBudgetGLSL,/uniform bool shadowFootprintEnabled;/);
});
check('near computes shared derivatives before query and retains five raw comparisons',()=>{
 const out=patchNearShadowLighting(T.ShaderChunk.lights_fragment_begin);assert.ok(out.indexOf('islandShadowReceiverFootprint(')<out.indexOf('if(queryShadow){'));assert.equal((out.match(/texture\( directionalShadowMap\[ 1 \]/g)||[]).length,5);assert.equal((out.match(/islandShadowComparisonCoord\(/g)||[]).length,5);assert.doesNotMatch(out,/getShadow\( directionalShadowMap\[ 1 \]/);
});
const result={schema:'shadow-footprint-offline-v1',scope:'preimplementation projection/filter invariants and actual Three shader-source integration; no GPU compile, visual or performance proof',cases,passed:cases.every(x=>x.passed)};
if(process.argv[2]){const p=resolve(process.argv[2]);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
