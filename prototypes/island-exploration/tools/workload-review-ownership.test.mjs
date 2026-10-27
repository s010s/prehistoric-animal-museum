// Failure cases written before review ownership fixes. Node DOM only; no GL.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {makeWorkloadReview} from '../workload-review.js';
const cases=[];
async function check(name,fn){try{await fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture({busy={},holdJobs=false,holdSave=false,failSave=false}={}){
 const dom=new JSDOM('<body><canvas></canvas><button id="help"></button><dialog id="help-dialog"><button class="close"></button></dialog></body>',{url:'http://fixture.invalid/?workloadReview=1'});
 const names=['document','location','navigator','addEventListener','dispatchEvent','Event','fetch','setTimeout','clearTimeout'];
 const globals=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const install=(n,v)=>Object.defineProperty(globalThis,n,{value:v,writable:true,configurable:true});
 install('document',dom.window.document);install('location',dom.window.location);install('navigator',dom.window.navigator);
 install('addEventListener',dom.window.addEventListener.bind(dom.window));install('dispatchEvent',dom.window.dispatchEvent.bind(dom.window));install('Event',dom.window.Event);
 let time=0,next=0,lost=false,unsafeReads=0,reads=0,resumes=0,readbacks=0,queued=0;
 const timers=new Map(),jobs=[],saves=[],saved=[],events=[],config={terrain:true,cloud:false,grass:false,atlas:true,reflection:false,ao:false,water:false,pixels:1};
 const reflectionAudit={region:true,tiles:true};
 const observation={routeActive:false,recording:false,videoPending:false,pendingCapture:false,evidenceReadback:false,...busy};
 install('setTimeout',(fn,ms)=>{const id=++next;timers.set(id,{fn,at:time+ms});return id;});install('clearTimeout',id=>timers.delete(id));
 install('fetch',async(url,options)=>{const record=JSON.parse(options.body);saved.push(record);events.push({kind:'save',arm:record.arm,config:{...config}});
  if(holdSave)await new Promise(resolve=>saves.push(resolve));
  return {ok:!failSave,status:failSave?500:200};
 });
 const paused={value:true},canvas=document.querySelector('canvas');canvas.toDataURL=()=>{readbacks++;return 'data:image/png;base64,AA==';};
 const renderer={render(){},shadowMap:{render(){}},domElement:canvas,info:{render:{calls:0,triangles:0}},getContext(){throw Error('Unexpected GL access');}};
 const api=makeWorkloadReview(renderer,new URLSearchParams('workloadReview=1'));
 function state(){if(lost){unsafeReads++;throw Error('state after loss');}reads++;
  return {build:{sourceHash:'fixture',assetsHash:'assets'},position:[0,2,0],quaternion:[0,0,0,1],drawSize:[1280,720],viewport:[1280,720],quality:'high',fov:62,exposure:1.35,worldTime:60,
   workload:{targetFps:30,maxPixels:921600,maxDimension:1280,paused:paused.value,pauseReasons:paused.value?['user']:[],submittedFrames:1,activeSeconds:1,pausedSeconds:0,fixed:false},
   vegetation:{pending:false,error:null,counts:{grass:1},atlasNormalDeferred:config.atlas,diagnosticGrass:config.grass},
   terrain:{pending:false,triangles:3634836,revision:1,reflection:{mode:config.terrain?'fixed-proxy':'full',mainRestored:true}},
   skyCache:{ready:true,totalRays:1,width:1536,height:384,steps:120,raysPerFrame:12288,frozen:config.cloud},
   flow:{pending:false,error:null,currentReflectionShadow:true,composition:{mode:'linear-hdr'},reflection:{lastTime:60,updates:1,regionRestored:true},spectrum:{updates:1},wetMemory:{updates:1},diagnostic:{reflectionFrozen:config.reflection,aoDisabled:config.ao,cheapWater:config.water}},
   encounter:{instances:[{},{}]},programErrors:0,resources:[],memory:{},benchmarkObservation:{...observation}};
 }
 const set=(key,value)=>{config[key]=value;events.push({kind:'set',key,value});};
 const context={getState:state,setPaused(value){paused.value=value;if(!value)resumes++;},getPaused:()=>paused.value,
  benchmark:{active:false,observationState:observation,visualRecords:[],videoState:{},startRealtime(){}},
  landscape:{setReflectionTerrain:v=>set('terrain',v),setReflectionTiles:v=>{reflectionAudit.tiles=v;},auditReflectionTiles:()=>({passed:true,excludedCells:1})},
  sky:{status:()=>({ready:true}),setFrozen:v=>set('cloud',v),auditDensity:()=>({passed:true})},
  props:{setDiagnosticGrass:v=>set('grass',v)},
  water:{setDiagnostic({freezeReflection=false,disableAO=false,cheap=false}={}){set('reflection',freezeReflection);set('ao',disableAO);set('water',cheap);},setReflectionRegion:v=>{reflectionAudit.region=v;}},
  setAtlasNormalDeferred:v=>set('atlas',v),setPixelScale:v=>set('pixels',v),setTime(){},setFine(){},
  queueReviewJob(fn){queued++;if(holdJobs)return new Promise(resolve=>jobs.push({fn,resolve}));return Promise.resolve(fn());},
  auditReflectionRegion(v){reflectionAudit.region=v;reflectionAudit.tiles=v;readbacks++;return {time:60,position:[0,2,0],pixels:new Uint16Array([15360,15360,15360,15360]),width:1,height:1,samples:4,region:{mode:'full'},restored:true};},
  auditAtlasNormal(v){set('atlas',v);readbacks+=2;return {time:60,position:[0,2,0],resources:[{name:'a',width:1,height:1},{name:'b',width:1,height:1}],targets:['a','b'].map(name=>({name,width:1,height:1,pixels:new Uint16Array([15360,15360,15360,15360])}))};}
 };
 api.attach(context);
 const button=id=>document.querySelector('#'+id);
 async function advance(ms){const target=time+ms;for(let n=0;n<50;n++){const item=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;timers.delete(item[0]);time=item[1].at;item[1].fn();await flush();}time=target;await flush();}
 async function close(){for(let n=0;n<6;n++){while(jobs.length){const j=jobs.shift();try{j.resolve(j.fn());}catch(e){j.resolve({error:String(e)});}}while(saves.length)saves.shift()();await advance(30000);}timers.clear();dom.window.close();for(const[n,d]of globals)d?Object.defineProperty(globalThis,n,d):delete globalThis[n];}
 return {api,button,context,config,reflectionAudit,events,saved,observation,advance,close,lose:()=>{lost=true;},releaseJob:async()=>{const j=jobs.shift();if(j)j.resolve(j.fn());await flush();},releaseSave:async()=>{while(saves.length)saves.shift()();await flush();},counts:()=>({resumes,readbacks,queued,reads,unsafeReads}),paused};
}
for(const flag of ['recording','videoPending','pendingCapture','evidenceReadback'])for(const id of ['gpu-atlas-normal','gpu-sample','gpu-shot']){
 await check(flag+' rejects '+id+' before resuming or queuing',async()=>{const f=fixture({busy:{[flag]:true}});try{void f.button(id).onclick();await flush();assert.equal(f.counts().resumes,0);assert.equal(f.counts().queued,0);assert.equal(f.counts().readbacks,0);}finally{await f.close();}});
}
await check('warming audit rejects screenshot',async()=>{const f=fixture({holdJobs:true});try{void f.button('gpu-atlas-normal').onclick();await flush();const n=f.counts().resumes;void f.button('gpu-shot').onclick();f.api.endFrame(0);assert.equal(f.counts().resumes,n);assert.equal(f.counts().readbacks,0);}finally{await f.close();}});
await check('pending screenshot rejects audit',async()=>{const f=fixture();try{void f.button('gpu-shot').onclick();void f.button('gpu-atlas-normal').onclick();await flush();assert.equal(f.counts().queued,0);}finally{await f.close();}});
for(const arm of ['fullTerrain','pixels','cloud','reflection','ao','water','grass','atlasNormals']){
 await check(arm+' saves original conditions then restores all ordinary defaults',async()=>{const f=fixture({holdSave:true});try{
  f.button('gpu-arm').value=arm;const warmup=f.button('gpu-sample').onclick();await flush();await f.advance(2000);await warmup;
  const original={...f.config};f.api.beginFrame(1,33);f.api.endFrame(1);
  const stopped=f.button('gpu-stop').onclick();await flush();
  const record=f.saved.find(r=>r.kind==='timing');assert.equal(record.arm,arm);
  assert.equal(record.before.vegetation.atlasNormalDeferred,original.atlas);assert.equal(record.after.vegetation.atlasNormalDeferred,original.atlas);
  assert.equal(record.after.skyCache.frozen,original.cloud);assert.equal(record.after.terrain.reflection.mode,original.terrain?'fixed-proxy':'full');
  assert.deepEqual(f.events.find(e=>e.kind==='save').config,original);
  assert.deepEqual(f.config,original,'save must retain ownership and original settings until settled');
  const reads=f.counts().readbacks;void f.button('gpu-atlas-normal').onclick();await flush();assert.equal(f.counts().readbacks,reads);
  await f.releaseSave();await stopped;
  assert.deepEqual(f.config,{terrain:true,cloud:false,grass:false,atlas:true,reflection:false,ao:false,water:false,pixels:1});
  assert.equal(f.button('gpu-arm').value,'baseline');assert.equal(f.paused.value,true);
 }finally{await f.close();}});
}
await check('failed local save still restores the ordinary defaults',async()=>{const f=fixture({failSave:true});try{f.button('gpu-arm').value='atlasNormals';const p=f.button('gpu-sample').onclick();await f.advance(2000);await p;const stop=f.button('gpu-stop').onclick();await flush();await stop;assert.equal(f.config.atlas,true);assert.equal(f.button('gpu-arm').value,'baseline');}finally{await f.close();}});
await check('stop cancels pending screenshot before any readback',async()=>{const f=fixture();try{void f.button('gpu-shot').onclick();await f.button('gpu-stop').onclick();f.api.endFrame(0);assert.equal(f.counts().readbacks,0);assert.equal(f.paused.value,true);}finally{await f.close();}});
await check('stop prevents a deferred audit closure from doing old readbacks',async()=>{const f=fixture({holdJobs:true});try{const p=f.button('gpu-atlas-normal').onclick();await flush();await f.button('gpu-stop').onclick();await f.releaseJob();assert.equal(f.counts().readbacks,0);assert.equal(f.counts().queued,1);await p;assert.equal(f.paused.value,true);}finally{await f.close();}});
// Failure written before fixing Stop restoration: first full-region frame has
// disabled both crop and tiles; generation cancellation skips the old finally.
await check('stop between reflection comparison frames restores region and tiles despite canceled finally',async()=>{const f=fixture({holdJobs:true});try{const p=f.button('gpu-reflection-region').onclick();await f.releaseJob();assert.deepEqual(f.reflectionAudit,{region:false,tiles:false});assert.equal(f.counts().readbacks,1);await f.button('gpu-stop').onclick();assert.deepEqual(f.reflectionAudit,{region:true,tiles:true});await f.releaseJob();await p;assert.equal(f.counts().readbacks,1);assert.deepEqual(f.reflectionAudit,{region:true,tiles:true});assert.equal(f.paused.value,true);}finally{await f.close();}});
await check('context loss leaves stop usable and late frame reads no state or image',async()=>{const f=fixture();try{f.api.heartbeat(f.context.getState());void f.button('gpu-shot').onclick();const n=f.counts();f.lose();await f.api.contextLost({test:true});assert.equal(f.button('gpu-stop').disabled,false);await f.button('gpu-stop').onclick();f.api.endFrame(0);assert.equal(f.counts().unsafeReads,0);assert.equal(f.counts().readbacks,n.readbacks);}finally{await f.close();}});
const result={schema:'island-review-ownership-offline-v1',scope:'Node DOM only, no browser/WebGL/GPU measurement',cases,passed:cases.every(c=>c.passed),gpuTime:null};
if(process.argv[2]){mkdirSync(dirname(resolve(process.argv[2])),{recursive:true});writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(c=>!c.passed)}));if(!result.passed)process.exitCode=1;
