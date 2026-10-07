// Independent normal-clock ground-motion contract. Failure cases/tests precede
// this module; old stationary validation remains unchanged. CPU replay only.
import {observationConditions} from './short-observation.js';
export const MOTION_POLICY=Object.freeze({warmupSeconds:12,sampleSeconds:12,routeSeconds:25,minIntervals:60,minimumFps:59,p95Ms:17.5,p99Ms:20,maxLongIntervalMs:33.4,minWorstSecondFrames:55});
const finite=Number.isFinite,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function motionConditions(s){return{...observationConditions(s),adaptive:s.adaptive??false,treeWindOverride:s.vegetation?.treeWindTime?.override??null,foliageCoverage:s.foliageCoverage??null,weatherStatic:s.weather?{cloudCoverage:s.weather.cloudCoverage,cloudThickness:s.weather.cloudThickness,weatherHaze:s.weather.weatherHaze,rainWetness:s.weather.rainWetness}:null};}
export function motionReady(s){return s?.workload?.bootComplete===true&&s.skyCache?.ready===true&&s.terrain?.pending===false&&s.vegetation?.pending===false&&s.flow?.pending===false&&!s.terrain?.error&&!s.vegetation?.error&&!s.flow?.error&&s.programErrors===0;}
// Ordinary moving workers may be pending while their installed scene continues
// rendering. Their work belongs in the sample rather than invalidating it.
export function motionRenderedReady(s){return s?.skyCache?.ready===true&&s.programErrors===0&&!s.terrain?.error&&!s.vegetation?.error&&!s.flow?.error;}
export function measurementPrefixAnchors(anchors,metres){
 if(!Array.isArray(anchors)||anchors.length<2||anchors.some(p=>p.length!==2||!p.every(finite))||!finite(metres)||metres<=0)throw Error('Invalid performance-prefix request');
 const chosen=[[...anchors[0]]];let remaining=metres;
 for(let i=1;i<anchors.length;i++){const a=anchors[i-1],b=anchors[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!d)continue;
  if(d>=remaining){const u=remaining/d;chosen.push([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]);return{anchors:chosen,requestedMetres:metres,sourceAnchorCount:anchors.length};}
  chosen.push([...b]);remaining-=d;
 }
 throw Error('Original path is too short for requested performance prefix');
}
const noCapture=o=>Boolean(o)&&['recording','videoPending','pendingCapture','evidenceReadback'].every(k=>o[k]===false);
const expectedRoute=r=>['side-spring-loop','side-spring-performance-prefix'].includes(r?.id)&&r.clock==='wall'&&r.clip===true&&r.durationSeconds===MOTION_POLICY.routeSeconds;
const expectedNavigation=n=>n?.groundRoute===true&&n.speed===1.55&&n.constraints?.blocked===null;
const validBudget=s=>s?.drawSize?.length===2&&s.drawSize.every(n=>Number.isInteger(n)&&n>0)&&s.drawSize[0]*s.drawSize[1]<=s.workload?.maxPixels&&Math.max(...s.drawSize)<=s.workload?.maxDimension&&s.workload.maxPixels<=921600&&s.workload.maxDimension<=1280;
export function motionEligibility(s){return{targetAtLeast60:finite(s?.workload?.targetFps)&&s.workload.targetFps>=60,normalClock:s?.workload?.fixed===false,boundedPaceTrial:s?.workload?.desktopTier==='pace'&&s.workload.deadlineSeconds===45,remainingTrial:finite(s?.workload?.overrideDeadlineRemaining)&&s.workload.overrideDeadlineRemaining>=30,initialReady:motionReady(s),high1280x720:s?.quality==='high'&&same(s.drawSize,[1280,720])&&same(s.viewport,[1280,720]),withinBudget:validBudget(s),sourceKnown:Boolean(s?.build?.sourceHash&&s.build.assetsHash),ordinaryTreeWind:s?.vegetation?.treeWindTime?.override===null,ordinaryRendering:s?.adaptive===false&&s.skyCache?.frozen===false&&s.flow?.composition?.mode==='linear-hdr'&&['reflectionFrozen','aoDisabled','cheapWater'].every(k=>s.flow?.diagnostic?.[k]===false)&&!s.vegetation?.diagnosticGrass};}
export function validateMotionObservation(record){
 const {before:b,after:a,frames=[],events=[],errors=[]}=record,conditions=b?motionConditions(b):null,paused=a?.workload?.pausedSeconds-b?.workload?.pausedSeconds;
 const phase=f=>({worldTime:f?.frameClock?.worldTime??f?.worldTime,activeSeconds:f?.frameClock?.activeSeconds??f?.activeSeconds}),startPhase=record.boundaryClock??{worldTime:b?.worldTime,activeSeconds:b?.workload?.activeSeconds},endPhase=phase(frames.at(-1)),active=endPhase.activeSeconds-startPhase.activeSeconds;
 let prevTime=startPhase.worldTime,prevRaf=record.boundaryRafTimestampMs,prevActive=startPhase.activeSeconds;
 const monotonic=frames.every(f=>{const c=phase(f),ok=finite(c.worldTime)&&c.worldTime>prevTime&&finite(c.activeSeconds)&&c.activeSeconds>prevActive&&Math.abs((c.worldTime-prevTime)-(c.activeSeconds-prevActive))<.025;prevTime=c.worldTime;prevActive=c.activeSeconds;return ok;});
 const intervals=frames.every(f=>{const ok=finite(f.rafTimestampMs)&&f.rafTimestampMs>prevRaf&&finite(f.frameIntervalMs)&&f.frameIntervalMs>0&&Math.abs(f.rafTimestampMs-prevRaf-f.frameIntervalMs)<.25;prevRaf=f.rafTimestampMs;return ok;});
 const lastInterval=frames.at(-1)?.frameIntervalMs,overshoot=record.durationSeconds-MOTION_POLICY.sampleSeconds;
 const checks={completeWindow:record.reason==='window complete'&&finite(record.durationSeconds)&&overshoot>=-1e-6&&finite(lastInterval)&&overshoot<=lastInterval/1000+1e-6,
  realWarmup:finite(record.warmupSeconds)&&record.warmupSeconds>=MOTION_POLICY.warmupSeconds-1e-6,
  sufficientIntervals:frames.length>=MOTION_POLICY.minIntervals,targetAtLeast60:finite(b?.workload?.targetFps)&&b.workload.targetFps>=60,normalClock:b?.workload?.fixed===false&&a?.workload?.fixed===false&&monotonic&&finite(active)&&Math.abs((endPhase.worldTime-startPhase.worldTime)-active)<.025&&Math.abs(active-record.durationSeconds)<.1&&Math.abs(a.worldTime-endPhase.worldTime)<.025,
  noPause:Math.abs(paused)<.01&&b?.workload?.paused===false&&a?.workload?.paused===false&&!events.some(e=>e.type==='pause-state'&&e.paused),
  initialReady:motionReady(record.initial??b)&&motionRenderedReady(b),sourceKnown:Boolean(conditions?.source&&conditions?.assets),withinBudget:validBudget(b)&&validBudget(a),
  stableConditions:Boolean(conditions)&&same(conditions,motionConditions(a))&&frames.every(f=>same(conditions,f.conditions)),
  allSubmissionsRecorded:frames.length===a?.workload?.submittedFrames-b?.workload?.submittedFrames&&frames.every((f,i)=>f.submittedFrames===b.workload.submittedFrames+i+1),
  rawIntervals:intervals&&frames.every(f=>finite(f.cpuSubmissionMs)&&f.cpuSubmissionMs>=0&&f.position?.every(finite)&&f.quaternion?.every(finite)),
  actualGroundRoute:expectedRoute(b?.route)&&expectedRoute(a?.route)&&b.route.id===a.route.id&&expectedNavigation(b?.navigation)&&expectedNavigation(a?.navigation)&&frames.every(f=>expectedRoute(f.route)&&f.route.id===b.route.id&&expectedNavigation(f.navigation))&&frames.reduce((distance,f,i)=>{const previous=i?frames[i-1].position:b?.position;return distance+(previous&&f.position?Math.hypot(f.position[0]-previous[0],f.position[2]-previous[2]):NaN);},0)>.25&&frames.every((f,i)=>finite(f.route?.progress)&&f.route.progress>=(i?frames[i-1].route?.progress:b?.route?.progress)),
  noCapture:noCapture(b?.benchmarkObservation)&&noCapture(a?.benchmarkObservation)&&frames.every(f=>noCapture(f.benchmarkObservation)&&f.benchmarkObservation.routeActive===true),
  noInstrumentation:record.instrumentation?.timerQueries===false&&record.instrumentation?.capture===false&&record.instrumentation?.readback===false,
  noRuntimeErrors:Array.isArray(errors)&&errors.length===0&&b?.programErrors===0&&a?.programErrors===0&&frames.every(f=>f.programErrors===0)&&!a?.vegetation?.error&&!a?.flow?.error&&!a?.terrain?.error,
  noInterruptionEvents:!events.some(e=>['context-lost','resize','visibility','blur','motion-ownership-lost','simulation-reset'].includes(e.type)||(e.type==='skyCacheInvalidated'&&e.reason==='time-reset')),
 };
 return{valid:Object.values(checks).every(Boolean),checks,issues:Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name),gpuTime:null};
}
function stats(values){const a=values.filter(finite).sort((x,y)=>x-y),p=q=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*q))]:null;return{count:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:null};}
function worstSecond(frames,start,end){if(!finite(start)||!finite(end)||end-start<1000)return null;const times=frames.map(f=>f.rafTimestampMs),starts=[start,...times.filter(t=>t+1000<=end)];let worst=Infinity,left=0,right=0;for(const t of starts){while(left<times.length&&times[left]<=t+1e-6)left++;right=Math.max(right,left);while(right<times.length&&times[right]<=t+1000+1e-6)right++;worst=Math.min(worst,right-left);}return worst===Infinity?null:worst;}
export function summarizeMotionObservation(record){
 const frames=record.frames??[],intervals=frames.map(f=>f.frameIntervalMs),frameMs=stats(intervals),ratio=n=>intervals.length?intervals.filter(v=>v>n).length/intervals.length:null;
 const path=[record.before?.position,...frames.map(f=>f.position)].filter(p=>Array.isArray(p)&&p.length===3),distance=path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-path[i][0],p[2]-path[i][2]),0),end=frames.at(-1)?.rafTimestampMs;
 const summary={frames:frames.length,submittedFps:record.durationSeconds>0?frames.length/record.durationSeconds:null,sampleOvershootSeconds:finite(record.durationSeconds)?record.durationSeconds-MOTION_POLICY.sampleSeconds:null,lastFrameIntervalMs:frames.at(-1)?.frameIntervalMs??null,frameMs,over16_67msRatio:ratio(16.67),over20msRatio:ratio(20),over33_3msRatio:ratio(33.3),over33_4msRatio:ratio(33.4),over50msRatio:ratio(50),worstSecondFrames:worstSecond(frames,record.boundaryRafTimestampMs,end),cpuSubmissionMs:stats(frames.map(f=>f.cpuSubmissionMs)),cpuScopes:[...new Set(frames.flatMap(f=>Object.keys(f.cpu??{})))].map(scope=>({scope,...stats(frames.map(f=>f.cpu?.[scope]))})),distanceMetres:distance,meanSpeedMetresPerSecond:record.durationSeconds>0?distance/record.durationSeconds:null,blockedFrames:frames.filter(f=>f.navigation?.constraints?.blocked).length,pendingFrames:frames.filter(f=>f.pending).length,gpuTime:null};
 const checks={averageNear60:summary.submittedFps>=MOTION_POLICY.minimumFps,p95:frameMs.p95!==null&&frameMs.p95<=MOTION_POLICY.p95Ms,p99:frameMs.p99!==null&&frameMs.p99<=MOTION_POLICY.p99Ms,noLongIntervals:summary.over33_4msRatio===0,worstSecond:summary.worstSecondFrames!==null&&summary.worstSecondFrames>=MOTION_POLICY.minWorstSecondFrames};
 return{summary,performance:{passed:Object.values(checks).every(Boolean),checks,policy:MOTION_POLICY,description:'60-class local tolerance, not strict mathematical 60 every second; validity is separate'}};
}
