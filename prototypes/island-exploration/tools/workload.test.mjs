// Written before workload.js. Failure inventory: legacy review URLs bypass caps;
// extreme/invalid DPR, portrait/ultrawide/zero viewport, quality/resize escape;
// override has no deadline; pacing submits early or catches up in a burst;
// pause includes wall time in animation/navigation; repeated resume doubles work;
// recovery preserves dangerous flags or retries forever, including storage failure.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {resolveWorkload,fitDrawingBuffer,FrameClock,recoveryPlan} from '../workload.js';
const cases=[];
function check(name,fn){try{fn();cases.push({name,passed:true})}catch(error){cases.push({name,passed:false,error:String(error)})}}
check('legacy benchmark UI never unlocks pixels or cadence',()=>{
 const p=resolveWorkload(new URLSearchParams('benchmark=1&reviewDpr=2&quality=high'));
 assert.equal(p.maxPixels,921600);assert.equal(p.targetFps,30);assert.equal(p.review,true);assert.equal(p.fixed,false);assert.equal(p.override,false);
});
check('fixed measurement is independent of UI and override',()=>{
 const p=resolveWorkload(new URLSearchParams('fixedBenchmark=1'));assert.equal(p.fixed,true);assert.equal(p.override,false);
});
check('all dimensions DPR quality and scale stay bounded',()=>{
 for(const width of [0,1,320,1280,1920,2560,10000])for(const height of [0,1,720,1440,6000])for(const dpr of [NaN,0,.1,.73,1,1.6,2,8])for(const fine of [true,false]){
  const p=resolveWorkload(new URLSearchParams('benchmark=1&reviewDpr=2'));
  const b=fitDrawingBuffer(p,{width,height,dpr,fine,scale:1});
  assert.ok(b.width>=1&&b.height>=1);assert.ok(b.width*b.height<=p.maxPixels);assert.ok(Math.max(b.width,b.height)<=p.maxDimension);assert.ok(Number.isFinite(b.ratio)&&b.ratio>0);
 }
});
check('explicit override is bounded with an automatic deadline',()=>{
 const p=resolveWorkload(new URLSearchParams('highLoad=1'));assert.equal(p.override,true);assert.ok(p.maxPixels<=2400000);assert.equal(p.deadlineSeconds,20);
});
check('pixel experiment can reduce but never lift protection',()=>{
 assert.equal(resolveWorkload(new URLSearchParams('pixelBudget=460800')).maxPixels,460800);
 assert.equal(resolveWorkload(new URLSearchParams('pixelBudget=99999999')).maxPixels,921600);
 assert.equal(resolveWorkload(new URLSearchParams('pixelBudget=garbage')).maxPixels,921600);
});
check('120Hz callbacks submit at 30Hz and world keeps real time',()=>{
 const c=new FrameClock(30,0);let count=0;
 for(let i=0;i<=120;i++)if(c.accept(i*1000/120).submit)count++;
 assert.ok(count>=30&&count<=31);assert.ok(Math.abs(c.activeNow(1000)-1000)<.001);
 assert.equal(c.snapshot(1000).submittedFrames,count);
});
check('pause freezes active time and resume cannot catch up',()=>{
 const c=new FrameClock(30,0);c.accept(0);c.accept(100);c.setPaused(true,100);
 assert.equal(c.accept(300000).submit,false);assert.equal(c.activeNow(300000),100);
 c.setPaused(false,300000);c.setPaused(false,300000);
 const f=c.accept(300001);assert.equal(f.submit,true);assert.ok(f.deltaSeconds<=1/30+.001);
 assert.equal(c.accept(300002).submit,false);assert.equal(c.activeNow(300010),110);
});
check('late frame never schedules backlog',()=>{
 const c=new FrameClock(30,0);c.accept(0);const f=c.accept(1500);assert.equal(f.submit,true);
 assert.equal(c.accept(1501).submit,false);assert.ok(f.deltaSeconds<=.1);
});
check('recovery sanitizes URL and stops after one automatic reload',()=>{
 const url='http://127.0.0.1:4386/?benchmark=1&diagnostics=1&highLoad=1&reviewDpr=2&dry=1&skyState=legacy&contextRecovery=legacy&quality=high&fixedBenchmark=1';
 const r=recoveryPlan(url,0),p=new URL(r.url).searchParams;assert.equal(r.allowed,true);assert.equal(r.attempts,1);
 assert.equal(p.get('quality'),'mobile');assert.equal(p.get('recoveryAttempt'),'1');
 for(const k of ['highLoad','diagnostics','reviewDpr','dry','skyState','contextRecovery','fixedBenchmark'])assert.equal(p.has(k),false);
 assert.equal(recoveryPlan(r.url,0).allowed,false);assert.equal(recoveryPlan(url,1).allowed,false);
});
// Added before desktop tiers: accidental default promotion, mixed increments,
// unbounded trial, low quality lifting caps, recovery re-entering a desktop tier.
check('desktop clarity grows one explicit tier at a time',()=>{
 const tiers=['pace','900','1080','clouds'].map(t=>resolveWorkload(new URLSearchParams('desktopTier='+t+'&desktopTrial=1')));
 assert.deepEqual(tiers.map(p=>p.maxPixels),[921600,1440000,2073600,2073600]);
 assert.ok(tiers.every(p=>p.targetFps===60&&p.deadlineSeconds===45));
 assert.deepEqual(tiers.map(p=>p.cloud.width),[1536,1536,1536,3072]);
 assert.deepEqual(tiers.map(p=>p.cloud.steps),[120,120,120,240]);
 assert.ok(tiers.every(p=>p.cloud.raysPerFrame<=12288));
 assert.equal(resolveWorkload(new URLSearchParams('desktopTier=nonsense')).targetFps,30);
});
check('desktop selection is stripped on recovery',()=>{
 const r=recoveryPlan('http://127.0.0.1:4386/?desktopTier=clouds&desktopTrial=1&benchmark=1',0);
 const p=new URL(r.url).searchParams;
 assert.equal(p.has('desktopTier'),false);assert.equal(p.has('desktopTrial'),false);
 assert.equal(resolveWorkload(p).targetFps,30);
});
const out=process.argv[2];if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify({schema:'island-workload-checks-v1',cases,passed:cases.every(c=>c.passed)},null,2))}
console.log(JSON.stringify(cases,null,2));if(cases.some(c=>!c.passed))process.exitCode=1;
