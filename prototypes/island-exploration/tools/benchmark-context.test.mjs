// Cases written before correcting benchmark context cancellation.
// Node DOM/recorder simulation only. No browser or GL is constructed.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as T from 'three';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {makeBenchmark} from '../benchmark.js';
const cases=[];
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
function fixture({recorderThrows=false}={}){
 const dom=new JSDOM('<body><canvas></canvas></body>',{url:'http://fixture.invalid/'}),camera=new T.PerspectiveCamera(62,16/9,.3,1000);
 globalThis.document=dom.window.document;globalThis.location=dom.window.location;globalThis.addEventListener=dom.window.addEventListener.bind(dom.window);
 dom.window.HTMLAnchorElement.prototype.click=()=>{};
 let lost=false,unsafeReads=0,reads=0,tracksStopped=0,recorderStops=0,time=60;
 const state=()=>({build:{sourceHash:'cpu-fixture',assetsHash:'cpu-fixture-assets'},position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),drawSize:[1280,720],quality:'high',variant:'stable',terrain:{pending:false},vegetation:{pending:false,error:null},flow:{pending:false,error:null,exposure:{valid:true}},programErrors:0,clearance:1.75,exposure:1.35,skyCache:{ready:true},cpu:{},shadow:{},navigation:{},worldTime:time});
 const getState=()=>{reads++;if(lost){unsafeReads++;throw Error('State touched after graphics context loss');}return state();};
 const canvas=document.querySelector('canvas');canvas.captureStream=()=>({getTracks:()=>[{stop:()=>tracksStopped++}]});
 globalThis.MediaRecorder=class{
  static isTypeSupported(){return true;}
  constructor(){if(recorderThrows)throw Error('recorder unavailable');this.state='inactive';}
  start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}
  stop(){this.state='inactive';recorderStops++;void this.onstop?.();}
 };
 const api=makeBenchmark({params:new URLSearchParams('benchmark=1'),camera,canvas,landmarks:[{id:'side-spring',name:'Fixture'}],go:()=>{},stop:()=>{},getState,auditSky:()=>{},setWaterDebug:()=>{},setReviewDpr:()=>{},setShadow:()=>{},getShadow:()=>true,setTime:t=>time=t,syncPose:()=>{},navigationHeight:()=>0,planRegion:()=>({passed:true,points:[[0,0],[1,0]],length:1,seconds:1}),now:()=>1000,getWorldTime:()=>time});
 return {api,state,lose:()=>{lost=true;},counts:()=>({unsafeReads,reads,tracksStopped,recorderStops}),close:()=>dom.window.close(),panel:()=>document.querySelector('#benchmark')};
}
check('context handler is present',()=>{const f=fixture();assert.equal(typeof f.api.contextLost,'function');f.close();});
check('active walk cancellation retains samples without another state read',()=>{const f=fixture();f.api.startRealtime();f.api.afterFrame(33,f.state());f.lose();if(f.api.contextLost)f.api.contextLost();else f.api.cancel('WebGL context lost');assert.equal(f.counts().unsafeReads,0);assert.equal(f.api.active,false);const r=f.api.visualRecords.findLast(r=>r.kind==='replay-interrupted');assert.equal(r.completed,false);assert.equal(r.samples.length,1);assert.equal(r.build.sourceHash,'cpu-fixture');f.close();});
check('loss before first frame retains unknown state and stops recorder tracks',()=>{const f=fixture();f.api.startRealtime({capture:true});f.lose();f.api.contextLost();assert.equal(f.counts().unsafeReads,0);assert.equal(f.counts().recorderStops,1);assert.equal(f.counts().tracksStopped,1);assert.equal(f.api.active,false);assert.ok(f.api.visualRecords.some(r=>r.stateUnavailable===true));f.close();});
check('repeated loss cannot re-enter cancellation or read state',()=>{const f=fixture();f.api.startRealtime();f.api.afterFrame(33,f.state());f.lose();f.api.contextLost();const n=f.api.visualRecords.length;f.api.contextLost();assert.equal(f.api.visualRecords.length,n);assert.equal(f.counts().unsafeReads,0);f.close();});
check('paused failure page export is safe and source remains available',()=>{const f=fixture();f.api.startRealtime();f.api.afterFrame(33,f.state());f.lose();f.api.contextLost();f.panel().querySelector('#benchmark-export').onclick();assert.equal(f.counts().unsafeReads,0);assert.equal(f.api.visualRecords.at(-1).build.sourceHash,'cpu-fixture');f.close();});
check('late frame and route API cannot resume collection after loss',()=>{const f=fixture();f.lose();f.api.contextLost();const n=f.api.visualRecords.length;f.api.afterFrame(33,f.state());f.api.startRealtime();assert.equal(f.api.active,false);assert.equal(f.api.visualRecords.length,n);assert.equal(f.counts().unsafeReads,0);assert.ok([...f.panel().querySelectorAll('button,select')].every(e=>e.id==='benchmark-export'||e.disabled));f.close();});
check('failed recorder construction releases the capture stream',()=>{const f=fixture({recorderThrows:true});f.api.startRealtime({capture:true});assert.equal(f.counts().tracksStopped,1);assert.equal(f.api.videoPending,false);assert.ok(f.api.videoState.saveError);f.close();});
const result={schema:'island-benchmark-context-offline-checks-v1',scope:'Node DOM and recorder simulation; no browser/WebGL or hardware measurement',cases,passed:cases.every(c=>c.passed),gpuTime:null};
if(process.argv[2]){mkdirSync(dirname(resolve(process.argv[2])),{recursive:true});writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,cases:cases.length,failed:cases.filter(c=>!c.passed)}));if(!result.passed)process.exitCode=1;
