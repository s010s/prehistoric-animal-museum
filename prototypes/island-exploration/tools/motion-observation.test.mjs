// Failure inventory written before motion-observation.js or P3 harness changes.
// Offline synthetic replay only, not browser/GPU/performance evidence.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const cases=[];let api;
function output(){const result={schema:'island-motion-offline-v1',scope:'prewritten synthetic validity and statistics checks; no GPU',cases,passed:cases.every(c=>c.passed)};if(process.argv[2]){mkdirSync(dirname(resolve(process.argv[2])),{recursive:true});writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}
try{api=await import('../motion-observation.js');}catch(error){cases.push({name:'motion module exists',passed:false,error:String(error)});output();process.exit(1);}
function state(t=12,n=720){return{build:{sourceHash:'source',assetsHash:'assets'},drawSize:[1280,720],viewport:[1280,720],pixelRatio:1,effectivePixelRatio:1,quality:'high',fov:62,exposure:1.35,worldTime:60+t,position:[1.55*t,1.75,0],quaternion:[0,0,0,1],programErrors:0,adaptive:false,workload:{targetFps:60,maxPixels:921600,maxDimension:1280,fixed:false,desktopTier:'pace',deadlineSeconds:45,activeSeconds:t,pausedSeconds:0,submittedFrames:n,paused:false,bootComplete:true},skyCache:{ready:true,width:1536,height:384,steps:120,raysPerFrame:12288,frozen:false},vegetation:{pending:false,error:null,treeWindTime:{override:null}},terrain:{pending:false,revision:1,reflection:{mode:'fixed-proxy'}},flow:{pending:false,error:null,composition:{mode:'linear-hdr'},diagnostic:{reflectionFrozen:false,aoDisabled:false,cheapWater:false}},resources:[],navigation:{groundRoute:true,speed:1.55,constraints:{blocked:null}},route:{id:'side-spring-loop',clock:'wall',clip:true,durationSeconds:25,progress:t/225},benchmarkObservation:{routeActive:true,recording:false,videoPending:false,pendingCapture:false,evidenceReadback:false}};}
function window(fps=60){const count=fps*12,before=state(),after=state(24,720+count),conditions=api.motionConditions(before);return{reason:'window complete',before,after,warmupSeconds:12,durationSeconds:12,boundaryRafTimestampMs:12000,frames:Array.from({length:count},(_,i)=>{const t=12+(i+1)/fps,s=state(t,721+i);return{rafTimestampMs:t*1000,frameIntervalMs:1000/fps,cpuSubmissionMs:2,cpu:{renderSubmissionInclusive:1},worldTime:s.worldTime,activeSeconds:t,pausedSeconds:0,submittedFrames:s.workload.submittedFrames,position:s.position,quaternion:s.quaternion,conditions,route:s.route,navigation:s.navigation,benchmarkObservation:s.benchmarkObservation,programErrors:0,pending:false};}),errors:[],events:[],instrumentation:{timerQueries:false,capture:false,readback:false}};}
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(error){cases.push({name,passed:false,error:String(error)});}}
function reject(name,mutate){check(name,()=>{const r=window();mutate(r);assert.equal(api.validateMotionObservation(r).valid,false);});}
check('normal ground motion is valid and meets declared 60-class threshold',()=>{const r=window();assert.equal(api.validateMotionObservation(r).valid,true);assert.equal(api.summarizeMotionObservation(r).performance.passed,true);});
check('valid low FPS saves a failed performance verdict rather than invalidating it',()=>{const r=window(25);assert.equal(api.validateMotionObservation(r).valid,true);const s=api.summarizeMotionObservation(r);assert.equal(s.performance.passed,false);assert.equal(s.summary.submittedFps,25);});
check('ordinary moving worker pending remains counted',()=>{const r=window();r.frames[5].pending=true;assert.equal(api.validateMotionObservation(r).valid,true);});
reject('30 cap is ineligible',r=>r.before.workload.targetFps=30);
reject('fixed time cannot masquerade as normal motion',r=>r.before.workload.fixed=true);
reject('empty or insufficient interval evidence fails',r=>r.frames=r.frames.slice(0,30));
reject('incomplete user stop fails',r=>r.reason='user stop');
reject('short warmup fails',r=>r.warmupSeconds=2);
reject('source changes fail',r=>r.after.build.sourceHash='other');
reject('quality or viewport changes fail',r=>r.frames[42].conditions={...r.frames[42].conditions,viewport:[1000,700]});
reject('resource configuration change fails',r=>r.after.resources=[{name:'added',width:1,height:1}]);
reject('clock rewind inside window fails even if endpoints match',r=>r.frames[42].worldTime-=5);
reject('world clock freeze fails',r=>r.after.worldTime=r.before.worldTime);
reject('pause including brief resume fails',r=>r.events.push({type:'pause-state',paused:true}));
reject('missed submitted-frame evidence fails',r=>r.after.workload.submittedFrames++);
reject('duplicate timestamp fails',r=>r.frames[42].rafTimestampMs=r.frames[41].rafTimestampMs);
reject('synthetic interval inconsistent with RAF timestamps fails',r=>r.frames[42].frameIntervalMs=1);
reject('blocked route fails',r=>r.frames[42].navigation={...r.frames[42].navigation,constraints:{blocked:'cliff'}});
reject('diagnostic rail is not ground walking',r=>r.frames[42].navigation={...r.frames[42].navigation,groundRoute:false});
reject('stopped or substituted route fails',r=>r.frames[42].route={...r.frames[42].route,id:'other'});
for(const key of ['recording','videoPending','pendingCapture','evidenceReadback'])reject(key+' cannot mix with main timing',r=>r.frames[42].benchmarkObservation={...r.frames[42].benchmarkObservation,[key]:true});
reject('query instrumentation cannot become main FPS sample',r=>r.instrumentation.timerQueries=true);
reject('runtime/shader errors fail',r=>r.errors.push('shader rejected'));
check('tail hitches fail despite nearly 60 average',()=>{const r=window();r.frames[0].frameIntervalMs=34;const s=api.summarizeMotionObservation(r);assert.equal(s.performance.passed,false);assert(s.summary.over33_3msRatio>0);});
check('worst rolling second exposes clumped gaps',()=>{const r=window(25);assert.equal(api.summarizeMotionObservation(r).summary.worstSecondFrames,25);});
// New real-review failures written before the overshoot/clock-phase repair.
check('last real 640 ms interval remains a valid window and fails performance',()=>{const r=window(25),f=r.frames.at(-1);f.rafTimestampMs+=600;f.frameIntervalMs+=600;f.worldTime+=.6;f.activeSeconds+=.6;r.after.worldTime+=.6;r.after.workload.activeSeconds+=.6;r.durationSeconds+=.6;assert.equal(api.validateMotionObservation(r).valid,true);const s=api.summarizeMotionObservation(r);assert.equal(s.performance.passed,false);assert.equal(s.summary.frameMs.max,640);assert(s.summary.sampleOvershootSeconds>.59);});
check('same-phase frame-start clock accepts legitimate endFrame CPU variation',()=>{const r=window();r.boundaryClock={worldTime:r.before.worldTime,activeSeconds:r.before.workload.activeSeconds};r.frames.forEach(f=>f.frameClock={worldTime:f.worldTime,activeSeconds:f.activeSeconds});r.frames[42].activeSeconds+=.08;r.after.workload.activeSeconds+=.08;assert.equal(api.validateMotionObservation(r).valid,true);});
check('same-phase clock still rejects a true rewind even if endpoint wall clock advances',()=>{const r=window();r.boundaryClock={worldTime:r.before.worldTime,activeSeconds:r.before.workload.activeSeconds};r.frames.forEach(f=>f.frameClock={worldTime:f.worldTime,activeSeconds:f.activeSeconds});r.frames[42].frameClock.worldTime-=1;assert.equal(api.validateMotionObservation(r).valid,false);});
// Additional source review omissions, written before their guard changes.
check('frozen tree wind is explicitly ineligible',()=>{const s=state();s.vegetation.treeWindTime={override:60};assert.equal(api.motionEligibility(s).ordinaryTreeWind,false);});
check('moving SHA instance audit is rejected at P3 entry',()=>{const source=readFileSync(new URL('../workload-review.js',import.meta.url),'utf8');assert(source.includes("noInstanceAudit:params.get('instanceAudit')!=='1'"));});
output();
