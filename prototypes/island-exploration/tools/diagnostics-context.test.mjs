// Written before diagnostics termination/Blob-video corrections.
// CPU/DOM simulation only; every GL method and fetch is a local JS stub.
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import * as T from 'three';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {makeDiagnostics} from '../diagnostics.js';
const cases=[];
async function check(name,fn){try{await fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
function fixture({mode='frame',enabled=true,defer=false,video={}}={}){
 const dom=new JSDOM('<body><canvas></canvas><video id="benchmark-video"></video></body>',{url:'http://fixture.invalid/',virtualConsole:new VirtualConsole()});
 globalThis.document=dom.window.document;globalThis.addEventListener=dom.window.addEventListener.bind(dom.window);
 globalThis.devicePixelRatio=1;globalThis.screen={width:1280,height:720};
 let now=0,lost=false,unsafeGL=0,unsafeState=0,prepared=0;const calls=[],posts=[],acks=[];
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
 globalThis.fetch=async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});if(defer)await new Promise(resolve=>acks.push(resolve));return{ok:true};};
 const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2},gl={MAX_SAMPLES:3,VERSION:4,QUERY_RESULT_AVAILABLE:5,QUERY_RESULT:6};
 for(const name of ['getExtension','getParameter','getQueryParameter','createQuery','beginQuery','endQuery','deleteQuery','bindBuffer','deleteBuffer','bufferData','bufferSubData'])gl[name]=(...args)=>{if(lost){unsafeGL++;throw Error('GL '+name+' after context loss');}calls.push(name);if(name==='getExtension')return args[0]==='EXT_disjoint_timer_query_webgl2'?ext:null;if(name==='getParameter')return args[0]===gl.VERSION?'CPU fixture only':args[0]===ext.GPU_DISJOINT_EXT?false:4;if(name==='getQueryParameter')return false;if(name==='createQuery')return{};};
 const renderer={domElement:document.querySelector('canvas'),getContext:()=>gl,renderBufferDirect:()=>{},shadowMap:{render:()=>{},autoUpdate:true},toneMappingExposure:1.35,info:{render:{calls:0,triangles:0,points:0,lines:0},memory:{geometries:1,textures:1},programs:[]}};
 const benchmark={active:false,diagnosticComplete:true,videoPending:false,visualRecords:[],videoState:{bytes:20,pending:false,truncated:false,saveError:null,...video},prepareDiagnostic:()=>prepared++,startDiagnostic:()=>{benchmark.active=true;},cancel:()=>{benchmark.active=false;},contextLost:()=>{benchmark.active=false;}};
 const state=()=>({build:{sourceHash:'cpu-fixture-only',assetsHash:'cpu-fixture-assets'},position:[1,2,3],clearance:1.75,drawSize:[1280,720],pixelRatio:1,adaptive:false,programErrors:0,workload:{maxPixels:921600,maxDimension:1280},vegetation:{pending:false,error:null,counts:{},instanceSort:'radix'},terrain:{pending:false},flow:{pending:false,error:null}});
 const getState=()=>{if(lost){unsafeState++;throw Error('State read after context loss');}return state();};
 const resources=()=>[['fixture-rt',{width:16,height:16,samples:0,texture:{type:T.HalfFloatType},depthBuffer:false}]];
 const api=makeDiagnostics(renderer,new URLSearchParams('benchmark=1&diagnostics='+(enabled?'1':'0')+'&gpuScope='+mode+'&measureRoutes=forest,beach'));
 if(api)api.attach({getState,resources,props:{group:new T.Group()},benchmark});
 return{api,benchmark,calls,posts,advance:v=>{now=v;},counts:()=>({unsafeGL,unsafeState,prepared}),click:id=>document.querySelector('#'+id).click(),lose:()=>{lost=true;renderer.domElement.dispatchEvent(new dom.window.Event('webglcontextlost'));},settle:async()=>{for(const resolve of acks.splice(0))resolve();for(let i=0;i<6;i++)await Promise.resolve();},close:()=>dom.window.close()};
}
function sample(f){f.click('e00-smoke');f.advance(2200);f.api.beginFrame(2200,33,60);}
await check('ordinary mode never installs diagnostics or accesses GL',()=>{const f=fixture({enabled:false});assert.equal(f.api,null);assert.equal(f.calls.length,0);f.close();});
await check('active query loss stays null and performs no GL cleanup calls',async()=>{const f=fixture();sample(f);f.lose();await f.settle();assert.equal(f.counts().unsafeGL,0);const r=f.api.interruption;assert.equal(r.passed,false);assert.ok(r.gpu.some(q=>q.status==='context-lost'&&q.ms===null));assert.equal(r.source.sourceHash,'cpu-fixture-only');assert.equal(f.api.collecting,false);f.close();});
await check('pending query loss never deletes or polls dead query handles',async()=>{const f=fixture();sample(f);f.api.endGpuFrame();f.lose();f.api.beginFrame(2300,33,60.1);await f.settle();assert.equal(f.counts().unsafeGL,0);assert.equal(f.api.interruption.gpu[0].ms,null);f.close();});
await check('resource snapshot after loss remains unknown without a GL read',()=>{const f=fixture();sample(f);f.lose();const r=f.api.resourceSnapshot();assert.equal(f.counts().unsafeGL,0);assert.equal(r.contextLost,true);assert.equal(r.actualBufferBytes,null);f.close();});
await check('late frames and pass callbacks cannot restart work',()=>{const f=fixture();sample(f);f.lose();let ran=false;f.api.beginFrame(2400,33,60.2);f.api.pass('water',()=>{ran=true;});f.api.endGpuFrame();f.api.endFrame(1);assert.equal(ran,false);assert.equal(f.counts().unsafeGL,0);assert.equal(f.counts().unsafeState,0);f.close();});
await check('late clicks cannot restart a multi-round queue',()=>{const f=fixture();sample(f);f.lose();const n=f.counts().prepared;f.click('e00-hot');f.click('e03-ab');assert.equal(f.api.collecting,false);assert.equal(f.counts().prepared,n);f.close();});
await check('repeated loss retains one local interruption record',async()=>{const f=fixture();sample(f);f.lose();await f.settle();const r=f.api.interruption,n=f.posts.length;assert.ok(r);assert.equal(n,1);f.lose();await f.settle();assert.equal(f.api.interruption,r);assert.equal(f.posts.length,n);f.close();});
await check('save acknowledgement cannot revive the next route after loss',async()=>{const f=fixture({mode:'none',defer:true});f.click('e00-regression');f.advance(11000);f.api.beginFrame(11000,33,60);f.advance(11034);f.benchmark.active=false;f.api.endFrame(1);f.api.beginFrame(11035,33,60.1);f.lose();await f.settle();assert.equal(f.api.status().phase,'error');assert.equal(f.api.collecting,false);assert.equal(f.counts().prepared,1);assert.equal(f.counts().unsafeState,0);f.close();});
async function videoCheck(video){const f=fixture({mode:'none',video});document.querySelector('#benchmark-video').src='blob:fixture-video';f.click('e00-video');f.advance(3500);f.api.beginFrame(3500,33,60);f.advance(3534);f.benchmark.active=false;f.api.endFrame(1);f.api.beginFrame(3535,33,60.1);await f.settle();const r=f.posts.find(p=>p.body.checks)?.body;assert.ok(r);f.close();return r.checks.motionVideo;}
await check('current Blob video with completed bounded metadata is accepted',async()=>assert.equal(await videoCheck({}),true));
for(const video of [{truncated:true},{pending:true},{saveError:'disk failed'},{bytes:0}])await check('incomplete video is rejected '+JSON.stringify(video),async()=>assert.equal(await videoCheck(video),false));
const result={schema:'island-diagnostics-context-offline-checks-v1',scope:'Node stubs only; no browser, GL, GPU queries or real video/performance',gpuTime:null,cases,passed:cases.every(c=>c.passed)};
if(process.argv[2]){mkdirSync(dirname(resolve(process.argv[2])),{recursive:true});writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(c=>!c.passed)}));if(!result.passed)process.exitCode=1;
