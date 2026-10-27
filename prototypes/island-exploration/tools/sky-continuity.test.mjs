// All failure scenarios are recorded in phase3/cloud-continuity.md before this implementation.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import * as T from 'three'
import {makeSky,skyGLSL} from '../sky.js'
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>({arrayBuffer:async()=>{const data=await readFile(new URL('../public/'+String(url).replace(/^\.\//,''),import.meta.url));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}})
const budget={width:1536,height:384,raysPerFrame:12288,steps:120};
async function setup(){
 const sky=await makeSky(new T.Vector3(-.38,.58,.72).normalize(),budget),camera=new T.PerspectiveCamera(),state={target:{name:'original'},autoClear:false,throwRender:false,draws:[]};camera.position.set(0,30,0);
 const renderer={getRenderTarget:()=>state.target,setRenderTarget:t=>state.target=t,get autoClear(){return state.autoClear},set autoClear(v){state.autoClear=v},render(scene){const u=scene.children[0].material.uniforms,pano=state.target!==sky.resources().find(([name])=>name==='cloudShadow')[1];if(pano){assert.notEqual(state.target.texture,u.cloudPanorama.value);assert.notEqual(state.target.texture,u.cloudPrevious.value);assert.ok(state.target.scissor.z*state.target.scissor.w<=budget.raysPerFrame)}state.draws.push({pano,phase:u.cloudPhase.value.clone(),origin:u.cloudViewOrigin.value.clone(),rows:state.target.scissor.w});if(state.throwRender)throw Error('synthetic stripe failure')}};
 let tick=0;function step({speed=0,time}={}){const t=time??tick/30;camera.position.x+=speed/30;sky.update(t);sky.updateLighting(renderer,t,camera);tick++;return sky.status()}
 function warm(){for(let i=0;i<48;i++)step();assert.equal(sky.status().ready,true)}
 return{sky,camera,state,renderer,step,warm};
}
test('150 and 300m/s continuous travel completes coherent jobs without cloud blackout',async()=>{
 for(const speed of [150,300]){const o=await setup();try{o.warm();const before=o.sky.status().completed;for(let i=0;i<144;i++){const s=o.step({speed});assert.equal(s.ready,true);assert.ok(s.raysLastFrame<=12288)}assert.ok(o.sky.status().completed>=before+3);assert.equal(o.sky.status().invalidations,0)}finally{o.sky.dispose()}}
})
test('actual cut keeps complete history/metadata until bounded replacement and labels fallback',async()=>{
 const o=await setup();try{o.warm();const texture=o.sky.uniforms.cloudPanorama.value,origin=o.sky.uniforms.cloudPublishedOrigin.value.clone(),phase=o.sky.uniforms.cloudPublishedPhase.value.clone();o.camera.position.x+=1000;
 const s=o.step();assert.equal(s.ready,true);assert.equal(s.lastInvalidation,'camera-cut');assert.equal(s.temporaryFallback,'reprojected-compatible');assert.equal(o.sky.uniforms.cloudPanorama.value,texture);assert.ok(o.sky.uniforms.cloudPublishedOrigin.value.equals(origin));assert.ok(o.sky.uniforms.cloudPublishedPhase.value.equals(phase));
 for(let i=0;i<47;i++)assert.equal(o.step().ready,true);assert.notEqual(o.sky.uniforms.cloudPanorama.value,texture);assert.equal(o.sky.status().temporaryFallback,null);
 }finally{o.sky.dispose()}
})
test('weather snapshot invalidation has explicit finite previous-weather fallback then publishes newest revision',async()=>{
 const o=await setup();try{o.warm();o.sky.uniforms.cloudCoverage.value=.6;const old=o.sky.uniforms.cloudPanorama.value,s=o.step();assert.equal(s.ready,true);assert.equal(s.temporaryFallback,'previous-weather');assert.ok(s.publishedRevision<s.revision);assert.equal(o.sky.uniforms.cloudPanorama.value,old);for(let i=0;i<47;i++)o.step();assert.equal(o.sky.status().publishedRevision,o.sky.status().revision);assert.equal(o.sky.status().temporaryFallback,null)}finally{o.sky.dispose()}
})
test('time rewind reprojects complete phase and cannot blank all elevated sky',async()=>{
 const o=await setup();try{o.warm();const tex=o.sky.uniforms.cloudPanorama.value,phase=o.sky.uniforms.cloudPublishedPhase.value.clone();const s=o.step({time:.1});assert.equal(s.ready,true);assert.equal(s.lastInvalidation,'time-reset');assert.equal(o.sky.uniforms.cloudPanorama.value,tex);assert.ok(o.sky.uniforms.cloudPublishedPhase.value.equals(phase));assert.equal(o.sky.uniforms.cloudPhase.value.x,.5);assert.ok(Number.isFinite(s.blend));for(let i=1;i<48;i++)assert.equal(o.step({time:.1+i/30}).ready,true);
 }finally{o.sky.dispose()}
})
test('look rotation cannot invalidate angular cache; corrupt metadata warms safely',async()=>{
 const o=await setup();try{o.warm();o.camera.rotation.set(.3,2,0);assert.equal(o.step().invalidations,0);o.sky.uniforms.cloudPublishedOrigin.value.x=NaN;o.camera.position.x+=1000;assert.equal(o.step().ready,false);for(let i=0;i<47;i++)o.step();assert.equal(o.sky.status().ready,true)}finally{o.sky.dispose()}
})
test('throw preserves renderer/uniforms/scissor; quality resize is bounded honest warmup',async()=>{
 const o=await setup();try{o.warm();const target=o.state.target,auto=o.state.autoClear,phase=o.sky.uniforms.cloudPhase.value.clone();o.camera.position.x+=20;o.state.throwRender=true;assert.throws(()=>o.sky.updateLighting(o.renderer,2,o.camera),/synthetic/);assert.equal(o.state.target,target);assert.equal(o.state.autoClear,auto);assert.ok(o.sky.uniforms.cloudPhase.value.equals(phase));assert.equal(o.sky.status().ready,true);
 o.state.throwRender=false;const targets=o.sky.resources().map(([,r])=>r);o.sky.setQuality(false);assert.equal(o.sky.status().ready,false);assert.deepEqual(o.sky.resources().map(([,r])=>r),targets);for(let i=0;i<12;i++)assert.ok(o.step().raysLastFrame<=12288);assert.equal(o.sky.status().ready,true);
 }finally{o.sky.dispose()}
})
test('consumer preserves one slab reprojection source, hemisphere coverage and no new direct tracing',()=>{assert.match(skyGLSL,/cachedPhase-cloudPhase/);assert.match(skyGLSL,/cloudPanoramaReady>\.5/);assert.match(skyGLSL,/atan\(r.z,r.x\)/);assert.match(skyGLSL,/skyRadiance\(reflected,cameraPosition\)/)})
process.on('exit',()=>{globalThis.fetch=originalFetch})
