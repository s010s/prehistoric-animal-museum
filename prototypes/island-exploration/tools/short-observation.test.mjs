// Failure inventory and cases written before short-observation.js.
// Offline CPU replay only: no browser, GL, rendering or performance measurement.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const output=process.argv[2],historical=process.argv[3],cases=[];
function artifact(extra={}){const result={schema:'island-observation-offline-checks-v1',scope:'synthetic cases and immutable historical replay; no GPU work',cases,passed:cases.every(c=>c.passed),...extra};if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');}return result;}
let api;
try{api=await import('../short-observation.js');}catch(error){cases.push({name:'observation validator exists',passed:false,error:String(error)});artifact();console.log(JSON.stringify(cases));process.exit(1);}
const {observationConditions,validateTimingObservation,compareReflectionObservations}=api;
const state=()=>({build:{sourceHash:'test-source',assetsHash:'test-assets'},drawSize:[1280,720],viewport:[1280,720],quality:'high',pixelRatio:1,effectivePixelRatio:1,fov:62,exposure:1.35,regionVersion:'test-region',position:[1,2,3],quaternion:[0,0,0,1],programErrors:0,worldTime:62,terrain:{revision:1,pending:false,reflection:{mode:'fixed-proxy'}},vegetation:{pending:false,error:null},flow:{pending:false,error:null,diagnostic:{reflectionFrozen:false,aoDisabled:false,cheapWater:false},composition:{mode:'linear-hdr',outputDraws:1}},skyCache:{ready:true,width:1536,height:384,steps:120,frozen:false,raysPerFrame:12288},workload:{targetFps:30,maxPixels:921600,maxDimension:1280,fixed:false,activeSeconds:2,pausedSeconds:1,submittedFrames:60,cloud:{width:1536,height:384,steps:120,raysPerFrame:12288}},resources:[{name:'opaque',width:1280,height:720,samples:4,type:1016,format:1023,depthBuffer:true},{name:'reflection',width:512,height:512,samples:4,type:1016,format:1023,depthBuffer:true}],benchmarkObservation:{routeActive:false,recording:false,videoPending:false,pendingCapture:false,evidenceReadback:false}});
function window(arm='baseline'){
 const before=state();if(arm==='fullTerrain')before.terrain.reflection.mode='full';
 const after=structuredClone(before);after.worldTime+=12;after.workload.activeSeconds+=12;after.workload.submittedFrames+=360;
 const frames=Array.from({length:360},(_,i)=>({frameIntervalMs:1000/30,worldTime:62+(i+1)/30,position:[...before.position],quaternion:[...before.quaternion],pending:false,conditions:observationConditions(before),benchmarkObservation:{...before.benchmarkObservation}}));
 return {arm,before,after,frames,durationSeconds:12,reason:'window complete',errors:[]};
}
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
function rejects(name,change){check(name,()=>{const r=window();change(r);assert.equal(validateTimingObservation(r).valid,false);});}
rejects('grass diagnostic changes cannot masquerade as stable workload',r=>{r.before.vegetation.diagnosticGrass=false;r.after.vegetation.diagnosticGrass=true;});
// Before adding the atlas normal scheduling arm: a mixed shader policy is not
// a stable window, even when geometry, pixels and frame target stay constant.
rejects('atlas normal scheduling changes invalidate a timing window',r=>{r.before.vegetation.atlasNormalDeferred=true;r.after.vegetation.atlasNormalDeferred=false;});
check('complete stationary window is valid',()=>assert.equal(validateTimingObservation(window()).valid,true));
rejects('empty sample cannot pass',r=>r.frames=[]);
rejects('partial sample is not a complete window',r=>r.reason='user stop');
rejects('short duration cannot pass',r=>r.durationSeconds=3);
rejects('unrecorded submissions cannot pass',r=>r.after.workload.submittedFrames++);
rejects('paused interval invalidates timing instead of proving overload',r=>{r.after.workload.pausedSeconds++;r.after.workload.activeSeconds--;});
rejects('even a brief in-window pause is preserved as invalid',r=>r.events=[{type:'pause-state',paused:true}]);
rejects('world clock cannot freeze in a normal-time observation',r=>r.after.worldTime=r.before.worldTime);
rejects('resize at the end invalidates timing',r=>r.after.drawSize=[1600,900]);
rejects('temporary frame resize is retained as invalid',r=>r.frames[50].conditions={...r.frames[50].conditions,drawSize:[1000,700]});
rejects('quality change invalidates timing',r=>r.after.quality='mobile');
rejects('FPS target change invalidates timing',r=>r.after.workload.targetFps=60);
rejects('cloud detail change invalidates timing',r=>r.after.skyCache.steps=240);
rejects('reflection RT sample change invalidates timing',r=>r.after.resources[1].samples=0);
rejects('source change invalidates timing',r=>r.after.build.sourceHash='other-source');
rejects('assets change invalidates timing',r=>r.after.build.assetsHash='other-assets');
rejects('camera movement invalidates a fixed-camera sample',r=>r.frames[42].position[0]+=.02);
rejects('camera turn invalidates a fixed-camera sample',r=>r.frames[42].quaternion=[0,.1,0,.99]);
rejects('pending frame invalidates timing',r=>r.frames[42].pending=true);
rejects('unfinished or failed resources cannot pass',r=>r.after.flow.error='worker failed');
rejects('resource or runtime failure invalidates timing',r=>r.errors.push('unhandled promise rejection'));
for(const name of ['routeActive','recording','videoPending','pendingCapture','evidenceReadback'])rejects('timing cannot mix '+name,r=>r.frames[42].benchmarkObservation[name]=true);
rejects('missing isolation evidence remains unknown',r=>delete r.frames[42].benchmarkObservation);
check('matched reflection arms accept only the intended terrain difference',()=>assert.equal(compareReflectionObservations(window(),window('fullTerrain')).matched,true));
check('different resolution or target FPS cannot claim an algorithm comparison',()=>{for(const k of ['drawSize','targetFps']){const a=window(),b=window('fullTerrain');if(k==='drawSize'){b.before.drawSize=b.after.drawSize=[1600,900];}else{b.before.workload.targetFps=b.after.workload.targetFps=60;}b.frames.forEach(f=>f.conditions=observationConditions(b.before));assert.equal(compareReflectionObservations(a,b).matched,false);}});
check('two baseline arms do not constitute the planned pair',()=>assert.equal(compareReflectionObservations(window(),window()).matched,false));
let replay=null;
if(historical)check('historical omissions remain unknown and original bytes stay untouched',()=>{const bytes=readFileSync(historical),record=JSON.parse(bytes);replay={path:resolve(historical),sha256:createHash('sha256').update(bytes).digest('hex'),validation:validateTimingObservation(record)};assert.equal(replay.validation.valid,false);assert.deepEqual(readFileSync(historical),bytes);});
const result=artifact({historicalReplay:replay});console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(c=>!c.passed)}));if(!result.passed)process.exitCode=1;
