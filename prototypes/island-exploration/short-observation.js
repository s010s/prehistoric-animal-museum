// CPU-only validity rules for the explicit 12-second fixed-camera observation.
// A valid window is not a GPU measurement or a desktop/motion acceptance.
const isolationKeys=['routeActive','recording','videoPending','pendingCapture','evidenceReadback'];
const isolated=s=>Boolean(s)&&isolationKeys.every(k=>s[k]===false);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const near=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((n,i)=>Number.isFinite(n)&&Number.isFinite(b[i])&&Math.abs(n-b[i])<=1e-5);
const ready=s=>Boolean(s?.skyCache?.ready)&&s?.terrain?.pending===false&&s?.vegetation?.pending===false&&s?.flow?.pending===false&&!s?.terrain?.error&&!s?.vegetation?.error&&!s?.flow?.error&&s?.programErrors===0;
const budgeted=s=>Array.isArray(s?.drawSize)&&s.drawSize.length===2&&s.drawSize.every(n=>Number.isInteger(n)&&n>0)&&s.drawSize[0]*s.drawSize[1]<=s.workload?.maxPixels&&Math.max(...s.drawSize)<=s.workload?.maxDimension;
export function observationConditions(s) {
  return {
    source:s.build?.sourceHash??null,assets:s.build?.assetsHash??null,
    drawSize:s.drawSize,viewport:s.viewport,pixelRatio:s.pixelRatio,effectivePixelRatio:s.effectivePixelRatio,
    quality:s.quality,variant:s.variant??null,look:s.look??null,fov:s.fov,exposure:s.exposure,regionVersion:s.regionVersion,
    framebuffer:s.defaultFramebuffer??null,
    targetFps:s.workload?.targetFps,maxPixels:s.workload?.maxPixels,maxDimension:s.workload?.maxDimension,
    fixed:s.workload?.fixed,desktopTier:s.workload?.desktopTier??null,cloudPolicy:s.workload?.cloud,
    cloud:[s.skyCache?.width,s.skyCache?.height,s.skyCache?.steps,s.skyCache?.raysPerFrame,s.skyCache?.frozen],
    composition:s.flow?.composition?.mode,waterDiagnostic:s.flow?.diagnostic,
    grassDiagnostic:s.vegetation?.diagnosticGrass??false,
    terrainRevision:s.terrain?.revision,reflectionTerrain:s.terrain?.reflection?.mode,
    resources:s.resources?.map(({name,width,height,type,format,samples,depthBuffer,colourSpace})=>({name,width,height,type,format,samples,depthBuffer,colourSpace})).sort((a,b)=>a.name.localeCompare(b.name)),
  };
}
export function validateTimingObservation(record) {
  const {before,after,durationSeconds,reason,errors=[],events=[]}=record;
  const frames=Array.isArray(record.frames)?record.frames:[];
  const start=before?observationConditions(before):null,end=after?observationConditions(after):null;
  const active=after?.workload?.activeSeconds-before?.workload?.activeSeconds;
  const paused=after?.workload?.pausedSeconds-before?.workload?.pausedSeconds;
  const checks={
    completeWindow:reason==='window complete'&&Number.isFinite(durationSeconds)&&Math.abs(durationSeconds-12)<=.5,
    framesPresent:Array.isArray(frames)&&frames.length>0,
    allSubmissionsRecorded:frames.length===after?.workload?.submittedFrames-before?.workload?.submittedFrames,
    noPause:Number.isFinite(paused)&&Math.abs(paused)<.01&&Number.isFinite(active)&&Math.abs(active-durationSeconds)<.15&&!events.some(e=>e.type==='pause-state'&&e.paused),
    normalClock:before?.workload?.fixed===true||(Number.isFinite(before?.worldTime)&&Number.isFinite(after?.worldTime)&&Math.abs(after.worldTime-before.worldTime-active)<.15),
    sourceKnown:Boolean(start?.source&&start?.assets),
    withinBudget:budgeted(before)&&budgeted(after),
    stableConditions:Boolean(start)&&same(start,end)&&frames.every(f=>Boolean(f.conditions)&&same(start,f.conditions)),
    stationaryPose:near(before?.position,after?.position)&&near(before?.quaternion,after?.quaternion)&&frames.every(f=>near(before?.position,f.position)&&near(before?.quaternion,f.quaternion)),
    resourcesReady:ready(before)&&ready(after)&&frames.every(f=>f.pending===false),
    independentTiming:isolated(before?.benchmarkObservation)&&isolated(after?.benchmarkObservation)&&frames.every(f=>isolated(f.benchmarkObservation)),
    finiteFrames:frames.every(f=>Number.isFinite(f.frameIntervalMs)&&f.frameIntervalMs>0&&Number.isFinite(f.worldTime)),
    noRuntimeErrors:Array.isArray(errors)&&errors.length===0,
  };
  return {valid:Object.values(checks).every(Boolean),checks,issues:Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name),gpuTime:null};
}
export function compareReflectionObservations(a,b) {
  const validation=[validateTimingObservation(a),validateTimingObservation(b)];
  const arms=new Set([a.arm,b.arm]),ca=a.before?observationConditions(a.before):null,cb=b.before?observationConditions(b.before):null;
  const correctMode=r=>r.before?.terrain?.reflection?.mode===(r.arm==='baseline'?'fixed-proxy':'full');
  if(ca)delete ca.reflectionTerrain;if(cb)delete cb.reflectionTerrain;
  const checks={validWindows:validation.every(r=>r.valid),plannedArms:arms.size===2&&arms.has('baseline')&&arms.has('fullTerrain')&&correctMode(a)&&correctMode(b),sameConditions:Boolean(ca&&cb)&&same(ca,cb),samePose:near(a.before?.position,b.before?.position)&&near(a.before?.quaternion,b.before?.quaternion),sameWorldPhase:Number.isFinite(a.before?.worldTime)&&Math.abs(a.before.worldTime-b.before?.worldTime)<.1};
  return {matched:Object.values(checks).every(Boolean),checks,validation,gpuTime:null};
}
