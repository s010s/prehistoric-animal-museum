// Explicit, bounded browser E2E and short observations. No GL hooks or timer queries.
import * as T from 'three';
import {observationConditions,validateTimingObservation} from './short-observation.js';
import {MOTION_POLICY,motionConditions,motionRenderedReady,motionEligibility,validateMotionObservation,summarizeMotionObservation} from './motion-observation.js';
export function makeWorkloadReview(renderer,params) {
  if(params.get('workloadReview')!=='1')return null;
  let context=null,current=null,sample=null,motion=null,renders=0,reportSerial=0,scope='startup',pendingShot=false,warming=false,saving=0,generation=0,lastState=null,terminal=false,injectionRequested=false;
  const events=[],errors=[],reports=[];
  function unavailable(){
    if(!context||terminal||sample||motion||warming||pendingShot||saving||context.externalBusy?.())return true;
    const observation=context.benchmark?.observationState;
    return Boolean(context.benchmark?.active||['routeActive','recording','videoPending','pendingCapture','evidenceReadback'].some(key=>observation?.[key]));
  }
  function applyArm(arm){
    context.landscape.setReflectionTerrain(arm!=='fullTerrain');context.sky.setFrozen(arm==='cloud');context.props.setDiagnosticGrass(arm==='grass');context.setAtlasNormalDeferred(arm!=='atlasNormals');context.props.setForestAtlasBudget?.(arm!=='atlasLegacy');
    context.setShadowBudget?.(arm!=='shadowLegacy');context.setSunGlare?.(arm!=='glareOff');context.setLeafTransmission?.(arm!=='leafOff');
    context.water.setDiagnostic({freezeReflection:arm==='reflection',disableAO:arm==='ao',cheap:arm==='water'});context.setPixelScale(arm==='pixels'?Math.SQRT1_2:1);panel.dataset.arm=arm;
  }
  function restoreDefaults(){if(!context||terminal)return;applyArm('baseline');context.water.setReflectionRegion?.(true);context.landscape.setReflectionTiles?.(true);$('gpu-arm').value='baseline';$('gpu-arm').disabled=false;}
  function assertCurrent(run){if(terminal||run!==generation)throw Error('Review operation interrupted');}
  async function auditJob(run,fn){
    assertCurrent(run);
    const result=await context.queueReviewJob(()=>terminal||run!==generation?{passed:false,reason:'Review operation interrupted'}:fn());
    assertCurrent(run);if(result?.passed===false&&(result.reason||result.error))throw Error(result.reason||result.error);return result;
  }
  function endReview(run){if(run!==generation)return;restoreDefaults();warming=false;context.setPaused(true);}
  const original=renderer.render.bind(renderer);
  renderer.render=(...args)=>{renders++;return original(...args)};
  // Draw counts only: nested in the main pass, never an additive GPU budget.
  const originalShadow=renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render=(...args)=>{const calls=renderer.info.render.calls,triangles=renderer.info.render.triangles;try{return originalShadow(...args);}finally{if(current&&renderer.info.render.calls>calls)current.shadow={parent:scope,calls:renderer.info.render.calls-calls,triangles:renderer.info.render.triangles-triangles,gpuTime:null};}};
  addEventListener('error',e=>{if(errors.length<64)errors.push(e.message)});
  addEventListener('unhandledrejection',e=>{if(errors.length<64)errors.push(String(e.reason))});
  const panel=document.createElement('section');panel.id='gpu-review';
  panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:90;background:#122a29ef;color:white;padding:10px;max-width:560px;font:12px system-ui';
  panel.innerHTML='<strong>受限 GPU 验证 · 无 GPU 查询</strong><div><button id="gpu-s0">验证暂停与预算</button><select id="gpu-arm" aria-label="短实验变量"><option value="baseline">全部正常 · 地形代理</option><option value="fullTerrain">仅完整反射地形</option><option value="pixels">仅半像素</option><option value="cloud">仅冻结云重算</option><option value="reflection">仅冻结反射重画</option><option value="ao">仅停 AO</option><option value="water">仅廉价水着色</option><option value="grass">诊断 · 仅停止近草提交</option><option value="shadowLegacy">对照 · 280 米旧阴影</option><option value="glareOff">对照 · 关闭太阳光斑</option><option value="leafOff">对照 · 关闭近叶透光</option><option value="atlasLegacy">对照 · 原 280 米树冠采样</option><option value="atlasNormals">对照 · 原树林法线调度</option></select><button id="gpu-sample">12 秒短样本</button><button id="gpu-stop">停止并保存</button><button id="gpu-shot">独立截图</button></div><output id="gpu-state">启动调度中</output><pre id="gpu-result" style="max-height:110px;overflow:auto"></pre>';
  document.body.append(panel);
  // Acceptance sequence written before connecting the new rendering budgets.
  // It uses the existing review owner and fixed world time; image readback is
  // explicitly outside the timing windows and never runs during ordinary play.
  for(const [kind,label]of [['shadow','阴影预算 A/B'],['glare','太阳光斑 A/B']]){
    const button=document.createElement('button');button.id='gpu-budget-'+kind;button.textContent=label;panel.querySelector('div').append(button);
    button.onclick=async()=>{
      if(unavailable())return;
      warming=true;const run=++generation,checks={},snapshots=[];
      const time=state().worldTime;
      try{
        context.setPaused(false);
        for(const enabled of [false,true]){
          const result=await auditJob(run,()=>context.auditPerceptualBudget(kind,enabled,time));
          snapshots.push(result.state);
          if(kind==='glare'&&enabled){const glare=result.state.flow.sunGlare;checks.visibilityPass=glare.eligible?glare.updates>result.beforeGlareUpdates&&glare.active&&glare.historyValid:glare.active===false;}
          await save('budget-'+kind+'-'+(enabled?'candidate':'legacy'),{...result,comparisonTime:time,errors:[...errors]});
          assertCurrent(run);
        }
        const [a,b]=snapshots;
        const samePose=(x,y)=>x.length===y.length&&x.every((n,i)=>Number.isFinite(n)&&Number.isFinite(y[i])&&Math.abs(n-y[i])<1e-10);
        checks.samePoseTimeAndPixels=samePose(a.position,b.position)&&samePose(a.quaternion,b.quaternion)&&a.worldTime===b.worldTime&&JSON.stringify(a.drawSize)===JSON.stringify(b.drawSize);
        checks.protectedPixels=b.drawSize[0]*b.drawSize[1]<=921600&&b.workload.targetFps===30;
        checks.oneShadowMapSameResolution=JSON.stringify(a.shadow.mapSize)===JSON.stringify(b.shadow.mapSize)&&a.resources.filter(r=>r.name==='sun-shadow').length===1&&b.resources.filter(r=>r.name==='sun-shadow').length===1;
        checks.currentReflectionAndHDR=b.flow.currentReflectionShadow&&b.flow.reflection.lastTime===time&&b.flow.reflection.regionRestored&&b.flow.composition.mode==='linear-hdr';
        checks.noShaderErrors=!errors.length&&!b.programErrors;
        if(kind==='shadow')checks.budgetModes=a.shadow.budget.enabled===false&&b.shadow.budget.enabled===true&&a.shadow.extent[0]===280&&b.shadow.extent[0]===280;
        if(kind==='glare')checks.budgetModes=a.flow.sunGlare.enabled===false&&b.flow.sunGlare.enabled===true;
        await save('budget-'+kind+'-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,visualVerdict:'requires independent image and motion review',errors:[...errors]});
      }catch(error){if(!terminal)await save('budget-'+kind+'-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}
      finally{if(!terminal&&run===generation)context.resetPerceptualBudget();endReview(run);}
    };
  }
  for(const [view,label]of [['sun','查看太阳'],['sun-edge','太阳偏离中心'],['away','背向太阳'],['ground','查看脚下树影']]){
    const button=document.createElement('button');button.id='gpu-view-'+view;button.textContent=label;panel.querySelector('div').append(button);
    button.onclick=()=>{if(unavailable())return;context.setPaused(true);context.setReviewView(view);};
  }
  const occlusionButton=document.createElement('button');occlusionButton.id='gpu-glare-occlusion';occlusionButton.textContent='光斑深度遮挡断言';panel.querySelector('div').append(occlusionButton);
  occlusionButton.onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation;
    try{
      context.setPaused(false);
      const result=await auditJob(run,()=>context.auditGlareOcclusion());
      const checks={clearDepthVisible:result.clear.skyVisibility>.95&&result.clear.value>.05,opaqueDepthBlocks:result.blocked.skyVisibility===0&&result.blocked.value===0,fixtureRemoved:result.fixtureRemoved,protected:result.state.drawSize[0]*result.state.drawSize[1]<=921600,noShaderErrors:!errors.length&&!result.state.programErrors};
      await save('glare-depth-e2e',{passed:Object.values(checks).every(Boolean),checks,...result,errors:[...errors]});
    }catch(error){if(!terminal)await save('glare-depth-e2e',{passed:false,error:String(error),errors:[...errors]});}
    finally{if(!terminal&&run===generation)context.resetPerceptualBudget();endReview(run);}
  };
  const auditButton=document.createElement('button');auditButton.textContent='验证云优化等价';auditButton.id='gpu-density-audit';panel.querySelector('div').append(auditButton);
  // Define the protection E2E before adding spectrum observability or changing
  // recovery: normal submissions must advance, then every heavy counter stops;
  // resuming advances active time only. Missing counters fail the evidence.
  const protectionButton=document.createElement('button');protectionButton.id='gpu-protection';protectionButton.textContent='保护流程短验证';panel.querySelector('div').append(protectionButton);
  // Defined before changing the shader scheduling or blur lifecycle. These
  // observations are independent of timing/video and always finish paused.
  const atlasButton=document.createElement('button');atlasButton.id='gpu-atlas-normal';atlasButton.textContent='独立树林法线 HDR 对照';panel.querySelector('div').append(atlasButton);
  atlasButton.onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation,checks={},snapshots=[];
    try{
      context.setPaused(false);
      const a=await auditJob(run,()=>context.auditAtlasNormal(false));snapshots.push(state());
      const b=await auditJob(run,()=>context.auditAtlasNormal(true));snapshots.push(state());
      const s=snapshots[1];checks.sameCameraTimeAndResources=a.time===b.time&&JSON.stringify(a.position)===JSON.stringify(b.position)&&JSON.stringify(a.resources)===JSON.stringify(b.resources);
      checks.protectedOnly=s.workload.targetFps===30&&s.drawSize[0]*s.drawSize[1]<=921600;
      const half=n=>{const sign=n&32768?-1:1,e=(n>>>10)&31,f=n&1023;return sign*(e===0?f*2**-24:e===31?(f?NaN:Infinity):(1+f/1024)*2**(e-15));};
      const comparisons=[];
      for(let t=0;t<a.targets.length;t++){
        const x=a.targets[t],y=b.targets[t];let compared=0,different=0,maxAbsolute=0,maxRelative=0;
        if(x.width===y.width&&x.height===y.height&&x.pixels.length===y.pixels.length)for(let i=0;i<x.pixels.length;i++){if(i%4===3)continue;const av=half(x.pixels[i]),bv=half(y.pixels[i]),abs=Math.abs(av-bv),rel=abs/Math.max(1,Math.abs(av));compared++;maxAbsolute=Math.max(maxAbsolute,abs);maxRelative=Math.max(maxRelative,rel);if(!Number.isFinite(rel)||rel>.002)different++;}
        comparisons.push({name:x.name,compared,different,maxAbsolute,maxRelative,imagePresent:x.pixels.some(n=>n!==0)&&y.pixels.some(n=>n!==0)});
      }
      checks.mainAndMirrorEquivalent=comparisons.length===2&&comparisons.every(c=>c.imagePresent&&c.compared>0&&c.different/c.compared<=.001);
      checks.originalAnimalsPlantsAndHDR=s.encounter.instances.length===2&&JSON.stringify(snapshots[0].vegetation.counts)===JSON.stringify(s.vegetation.counts)&&s.flow.composition.mode==='linear-hdr';
      checks.currentShadowAndRestore=s.flow.currentReflectionShadow&&s.flow.reflection.lastTime===s.worldTime&&s.terrain.reflection.mainRestored&&s.flow.reflection.regionRestored;
      context.setPaused(true);const r=renders;await wait(1100,run);const p=state();
      checks.pauseStopsAllWork=r===renders&&s.flow.spectrum.updates===p.flow.spectrum.updates&&s.flow.reflection.updates===p.flow.reflection.updates&&s.skyCache.totalRays===p.skyCache.totalRays;
      checks.noErrors=!errors.length&&!p.programErrors;
      await save('atlas-normal-e2e',{passed:Object.values(checks).every(Boolean),checks,comparisons,readbacks:4,readbackBytes:[...a.targets,...b.targets].reduce((n,t)=>n+t.pixels.byteLength,0),snapshots,errors:[...errors]});
    }catch(error){if(!terminal){if(run===generation)context.setPaused(true);await save('atlas-normal-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}}
    finally{endReview(run);}
  };
  const blurButton=document.createElement('button');blurButton.id='gpu-blur';blurButton.textContent='测试入口 · 人为失焦暂停';panel.querySelector('div').append(blurButton);
  blurButton.onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation,checks={},snapshots=[];
    try{
      context.setPaused(false);await wait(2200,run);const a=state();snapshots.push(a);
      dispatchEvent(new Event('blur'));const r=renders,b=state();snapshots.push(b);
      dispatchEvent(new Event('focus'));await wait(2200,run);const c=state();snapshots.push(c);
      checks.explicitUserPause=b.workload.paused&&b.workload.pauseReasons.includes('user');
      checks.allGpuStops=r===renders&&b.flow.reflection.updates===c.flow.reflection.updates&&b.flow.spectrum.updates===c.flow.spectrum.updates&&b.skyCache.totalRays===c.skyCache.totalRays&&b.flow.wetMemory.updates===c.flow.wetMemory.updates;
      checks.worldAndFocusStayPaused=c.workload.paused&&b.worldTime===c.worldTime&&b.workload.activeSeconds===c.workload.activeSeconds;
      checks.noErrors=!errors.length&&!c.programErrors;
      await save('blur-pause-e2e',{passed:Object.values(checks).every(Boolean),injection:'synthetic window blur/focus; NOT a system/context fault',checks,snapshots,errors:[...errors]});
    }catch(error){if(!terminal)await save('blur-pause-e2e',{passed:false,checks,snapshots,error:String(error)});}
    finally{endReview(run);}
  };
  // Explicit rendering E2E, defined before enabling reflection-region cropping.
  // Exactly two separately gated frames; readback is absent from ordinary runs
  // and timing. The full and candidate images share camera, time and resources.
  const regionButton=document.createElement('button');regionButton.id='gpu-reflection-region';regionButton.textContent='独立反射区域对照';panel.querySelector('div').append(regionButton);
  regionButton.onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation,checks={},snapshots=[];
    try{
      context.setPaused(false);
      const a=await auditJob(run,()=>context.auditReflectionRegion(false));snapshots.push(state());
      const b=await auditJob(run,()=>context.auditReflectionRegion(true));snapshots.push(state());
      const s=snapshots[1],region=b.region;
      checks.identicalCameraTimeAndResources=a.time===b.time&&JSON.stringify(a.position)===JSON.stringify(b.position)&&a.width===b.width&&a.height===b.height&&a.samples===b.samples;
      checks.protectedOnly=s.workload.targetFps===30&&s.drawSize[0]*s.drawSize[1]<=921600;
      checks.cropKeepsResolution=a.width===512&&a.height===512&&a.samples===4&&region?.mode==='crop'&&region.width*region.height<512*512;
      checks.readbackHasImage=a.pixels.some(n=>n!==0)&&b.pixels.some(n=>n!==0);
      let compared=0,different=0,maxAbsolute=0,maxRelative=0;
      const half=n=>{const sign=n&32768?-1:1,e=(n>>>10)&31,f=n&1023;return sign*(e===0?f*2**-24:e===31?(f?NaN:Infinity):(1+f/1024)*2**(e-15));};
      if(checks.identicalCameraTimeAndResources&&region)for(let y=region.y+1;y<region.y+region.height-1;y++)for(let x=region.x+1;x<region.x+region.width-1;x++)for(let c=0;c<3;c++){
        const i=(y*a.width+x)*4+c,av=half(a.pixels[i]),bv=half(b.pixels[i]),abs=Math.abs(av-bv),relative=abs/Math.max(1,Math.abs(av));compared++;maxAbsolute=Math.max(maxAbsolute,abs);maxRelative=Math.max(maxRelative,relative);if(!Number.isFinite(relative)||relative>.002)different++;
      }
      checks.linearReflectionEquivalent=compared>0&&different/compared<=.001;
      checks.currentShadowAndHDR=s.flow.currentReflectionShadow&&s.flow.composition.mode==='linear-hdr'&&s.encounter.instances.length===2;
      checks.mainGeometryAndStateRestored=s.terrain.reflection.mainRestored&&b.restored===true;
      const spatial=context.landscape.auditReflectionTiles?.();
      checks.spatialIndexAndCullingConservative=spatial?.passed===true&&spatial.excludedCells>0;
      context.setPaused(true);const r=renders;await wait(1100,run);const paused=state();
      checks.pauseStillStopsAllWork=r===renders&&paused.flow.reflection.updates===s.flow.reflection.updates&&paused.flow.spectrum.updates===s.flow.spectrum.updates;
      checks.noErrors=!errors.length&&!s.programErrors;
      await save('reflection-region-e2e',{passed:Object.values(checks).every(Boolean),checks,region,spatial,comparison:{compared,different,differentRatio:different/Math.max(1,compared),maxAbsolute,maxRelative},readbacks:2,readbackBytes:(a.pixels?.byteLength??0)+(b.pixels?.byteLength??0),snapshots,errors:[...errors]});
    }catch(error){if(!terminal){if(run===generation)context.setPaused(true);await save('reflection-region-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}}
    finally{if(!terminal&&run===generation){context.water.setReflectionRegion?.(true);context.landscape.setReflectionTiles?.(true);}endReview(run);}
  };
  protectionButton.onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation,checks={},snapshots=[];
    const capture=()=>{const s=state();snapshots.push({renders,state:s});return s;};
    try{
      context.setPaused(false);const a=capture();await wait(2200,run);const b=capture();
      checks.normalFramesAdvance=b.workload.submittedFrames>a.workload.submittedFrames&&b.flow.reflection.updates>a.flow.reflection.updates&&b.flow.spectrum?.updates>a.flow.spectrum?.updates;
      context.setPaused(true);const c=capture();await wait(2200,run);const d=capture();
      checks.pausedAllRendererSubmissions=snapshots[2].renders===snapshots[3].renders;
      checks.pausedCloudRays=c.skyCache.totalRays===d.skyCache.totalRays;
      checks.pausedReflection=c.flow.reflection.updates===d.flow.reflection.updates;
      checks.pausedSpectrum=Number.isFinite(c.flow.spectrum?.updates)&&c.flow.spectrum.updates===d.flow.spectrum?.updates;
      checks.pausedWetMemory=c.flow.wetMemory.updates===d.flow.wetMemory.updates;
      checks.pausedWorldAndActiveTime=c.worldTime===d.worldTime&&c.workload.activeSeconds===d.workload.activeSeconds;
      context.setPaused(false);await wait(2200,run);const e=capture();
      const active=e.workload.activeSeconds-d.workload.activeSeconds;
      checks.resumeRealTime=Math.abs(e.worldTime-d.worldTime-active)<.12&&active>=2&&active<2.6;
      checks.noCatchup=e.workload.submittedFrames-d.workload.submittedFrames<=Math.ceil(active*e.workload.targetFps)+2&&Math.hypot(...e.position.map((n,i)=>n-d.position[i]))<.01;
      checks.sameProtection=e.workload.targetFps===a.workload.targetFps&&e.drawSize.every((n,i)=>n===a.drawSize[i])&&e.drawSize[0]*e.drawSize[1]<=e.workload.maxPixels;
      checks.animalsAndHDR=e.encounter.instances.length===2&&e.flow.composition.mode==='linear-hdr';
      checks.noErrors=!errors.length&&!e.programErrors&&!e.vegetation.error&&!e.flow.error;
      context.setPaused(true);await save('protection-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,errors:[...errors]});
    }catch(error){if(!terminal){if(run===generation)context.setPaused(true);await save('protection-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}}
    finally{endReview(run);}
  };
  const routeButton=document.createElement('button');routeButton.textContent='保存游览与资源';routeButton.id='gpu-route-save';panel.querySelector('div').append(routeButton);
  const walkTiming=document.createElement('button');walkTiming.textContent='区域行走 · 仅计时';panel.querySelector('div').append(walkTiming);walkTiming.onclick=()=>{if(unavailable())return;restoreDefaults();context.benchmark.startRealtime({capture:false});context.setPaused(false);};
  // Failure cases recorded before the reflection/navigation implementation:
  // changed main/collision mesh; shoreline cracks; stale mirror/shadow time;
  // per-frame proxy allocation; pause work; rock tunnelling, steep/deep-water
  // walking; diagnostic routes skipping the ordinary movement constraints.
  const mirrorButton=document.createElement('button');mirrorButton.textContent='验证反射与地面约束';panel.querySelector('div').append(mirrorButton);
  const fold=document.createElement('button');fold.textContent='收起 GPU 验证';panel.querySelector('strong').after(fold);fold.onclick=()=>{const hidden=panel.querySelector('div').hidden=!panel.querySelector('div').hidden;panel.querySelector('pre').hidden=hidden;panel.querySelector('output').hidden=hidden;fold.textContent=hidden?'展开 GPU 验证':'收起 GPU 验证';};
  // Fault injection belongs to a separate explicit test URL. Never place it
  // among ordinary timing controls, where an input mistake can lose evidence.
  if(params.get('contextLossTest')==='1'){const b=document.createElement('button');b.id='gpu-context';b.textContent='测试入口 · 注入一次 context loss';panel.querySelector('div').append(b);}
  const $=id=>panel.querySelector('#'+id),wait=async(ms,run)=>{await new Promise(r=>setTimeout(r,ms));if(run!==undefined)assertCurrent(run);};
  const state=()=>{if(terminal)throw Error('Graphics context lost; observations stopped');lastState=context.getState();return lastState;};
  mirrorButton.onclick=async()=>{
    if(unavailable())return;
    const run=++generation,checks={},snapshots=[];warming=true;context.setPaused(false);
    try{
      await wait(2200,run);const a=state();snapshots.push(a);
      await wait(2200,run);const b=state();snapshots.push(b);
      const p=b.terrain.reflection;
      checks.mainGeometryRestored=p?.mainRestored===true&&b.terrain.triangles===3634836;
      checks.proxyReducesGeometry=p?.triangles>0&&p.triangles<b.terrain.triangles*.7;
      checks.shoreContactGridPreserved=p?.shoreContactPreserved===true;
      checks.mirrorEveryFrame=b.flow.reflection?.lastTime===b.worldTime&&b.flow.reflection?.updates-a.flow.reflection?.updates===b.workload.submittedFrames-a.workload.submittedFrames;
      checks.currentShadowBeforeMirror=b.flow.currentReflectionShadow===true;
      const clipping=context.landscape.auditReflectionClip?.();
      checks.clipNeverSkipsVisibleTriangles=clipping?.passed===true&&clipping.checkedSkippedTriangles>0;
      checks.currentMirrorClipPlane=b.flow.reflection.clipPlane?.time===b.worldTime&&b.flow.reflection.clipPlane?.source==='current-camera-near-plane';
      checks.mainDrawRangesPreserved=p?.clip?.mainDrawRangesPreserved===true;
      checks.animalsAndLinearHDR=b.encounter.instances.length===2&&b.flow.composition.mode==='linear-hdr';
      context.setPaused(true);const r=renders;await wait(1100,run);const c=state();snapshots.push(c);
      checks.pauseStopsMirror=r===renders&&b.flow.reflection?.updates===c.flow.reflection?.updates;
      const walk=await context.auditWalk?.();
      checks.walkConstraints=walk?.passed===true;
      checks.noRuntimeOrShaderErrors=!errors.length&&!b.programErrors;
      await save('reflection-walk-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,walk:walk??null,clipping,errors:[...errors]});
    }catch(error){if(!terminal){if(run===generation)context.setPaused(true);await save('reflection-walk-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}}
    finally{endReview(run);}
  };
  async function save(kind,record,timeoutMs=null) {
    const name=(params.get('runLabel')||kind)+'-'+kind+'-'+(++reportSerial)+'-'+Date.now();
    const artifact={schema:'island-gpu-governance-v1',kind,name,url:location.href,userAgent:navigator.userAgent,three:T.REVISION,gpuTime:null,gpuTiming:'not measured; no timer queries',...record};
    reports.push(artifact);if(reports.length>24)reports.shift();
    panel.dataset.report=JSON.stringify(artifact);$('gpu-result').textContent=JSON.stringify({kind,passed:artifact.passed,validation:artifact.validation,summary:artifact.summary,checks:artifact.checks},null,2);
    saving++;
    const controller=timeoutMs?new AbortController():null;let timeout=null;
    try{const request=fetch('/__gpu/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(artifact),...(controller?{signal:controller.signal}:{})});const res=timeoutMs?await Promise.race([request,new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('Local evidence save deadline'));},timeoutMs);})]):await request;if(!res.ok)throw Error(res.status);$('gpu-state').textContent='已保存在本地 · '+name;}
    catch(error){$('gpu-state').textContent='本地保存失败 · '+error;artifact.saveError=String(error)}
    finally{if(timeout!==null)clearTimeout(timeout);saving--;}
    return artifact;
  }
  const stats=values=>{const a=[...values].sort((a,b)=>a-b),p=q=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*q))]:null;return{count:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:null}};
  // P3 failure cases and replay/DOM checks were written before this owner.
  // A continuous real ground route warms for 12 s and samples for 12 s. The
  // 25 s route sentinel leaves one second for this observer to stop it first.
  const motionButton=document.createElement('button');motionButton.id='gpu-motion';motionButton.textContent='P3 行走性能 24 秒';panel.querySelector('div').append(motionButton);
  const p3Eligibility=s=>({...motionEligibility(s),noDiagnostics:params.get('diagnostics')!=='1',noInstanceAudit:params.get('instanceAudit')!=='1',noExistingErrors:errors.length===0,ordinaryArm:$('gpu-arm').value==='baseline'});
  async function finishMotion(reason='window complete',completed=false){
    const m=motion;if(!m)return;
    motion=null;clearTimeout(m.timer);warming=false;
    const after=m.lastState??m.initial,before=m.before??m.initial;
    const durationSeconds=m.before&&m.lastRaf!==null?(m.lastRaf-m.boundaryRaf)/1000:0;
    const record={reason,completed,source:m.initial.build,initial:m.initial,before,after,setupMs:m.setupMs??null,setupBudgetMs:5000,warmupSeconds:m.warmupSeconds??0,warmupDistanceMetres:m.warmupDistance??0,durationSeconds,boundaryRafTimestampMs:m.boundaryRaf??null,boundaryClock:m.boundaryClock??null,clockPhase:m.boundaryClock?'beginFrame world/active pair':'legacy replay fallback',frames:m.frames,events:[...m.events],errors:[...errors],eligibility:m.eligibility,instrumentation:{timerQueries:false,capture:false,readback:false},routeContract:{id:m.routeStart?.route?.id??'side-spring-performance-prefix',scope:m.routeStart?.route?.scope??null,clock:'active-wall',navigation:'ordinary-ground-navigation',declaredRouteSeconds:MOTION_POLICY.routeSeconds,observedSeconds:(m.warmupSeconds??0)+durationSeconds,fullRouteCompleted:false,fullOriginalRoutePlanned:false,anchors:m.routeStart?.route?.coordinates??null,version:m.routeStart?.route?.version??null},warmup:{started:m.routeStart,ended:m.before??null,events:m.warmupEvents??m.events},cpuContract:'synchronous ordinary rAF navigation/update/GL submission plus existing review UI; no worker callback or GPU execution time; setupMs is excluded from steady sample',policy:MOTION_POLICY};
    const validation=validateMotionObservation(record),result=summarizeMotionObservation(record);
    record.validation=validation;record.performance=result.performance;record.summary=result.summary;record.allPassed=completed&&validation.valid&&result.performance.passed;record.passed=record.allPassed;record.verdict=!validation.valid?'incomplete or invalid observation':result.performance.passed?'local 60-class threshold met':'valid observation; stable 60-class threshold NOT met';
    // Detach before cancel/pause events to avoid recursive finish. Context loss
    // uses cached state and does not call a renderer or restore graphics modes.
    if(!terminal){context.benchmark.cancel('P3 '+reason);context.setPaused(true);$('gpu-arm').disabled=false;}
    return save('motion-timing',record,10000);
  }
  motionButton.onclick=async()=>{
    if(unavailable())return;
    const initial=state(),eligibility=p3Eligibility(initial);
    if(!Object.values(eligibility).every(Boolean)){context.setPaused(true);return save('motion-timing',{completed:false,passed:false,allPassed:false,reason:'P3 eligibility failed; wait for ready resources / fresh bounded pace trial',source:initial.build,before:initial,after:initial,eligibility,validation:{valid:false,issues:Object.entries(eligibility).filter(([,ok])=>!ok).map(([name])=>name)},performance:{passed:false,policy:MOTION_POLICY},gpuTime:null},10000);}
    $('gpu-arm').disabled=true;events.length=0;const run=++generation;
    const m={run,initial,eligibility,lastState:initial,routeStart:null,startActive:initial.workload.activeSeconds,phase:'setup',frames:[],events:[],before:null,boundaryRaf:null,lastRaf:null,warmupDistance:0,previousPosition:null};motion=m;
    m.timer=setTimeout(()=>{void finishMotion('P3 wall deadline',false);},32000);
    try{
      // Release the click event before bounded synchronous ground planning.
      await new Promise(resolve=>setTimeout(resolve,0));if(motion!==m||terminal)return;
      context.setPaused(false);
      const setupStart=performance.now();
      const started=context.benchmark.startRealtime({capture:false,seconds:MOTION_POLICY.routeSeconds,clip:true,timing:true,prefixMetres:MOTION_POLICY.routeSeconds*1.55});
      m.setupMs=performance.now()-setupStart;
      if(started!==true)throw Error('Ground route could not start');
      if(motion!==m||terminal)return;
      m.routeStart=state();m.lastState=m.routeStart;m.startActive=m.routeStart.workload.activeSeconds;m.previousPosition=m.routeStart.position;
      if(m.setupMs>5000||m.routeStart.workload.overrideDeadlineRemaining<25)throw Error('Prefix setup exceeded budget or left less than 25 s trial');
      m.phase='warmup';
      $('gpu-state').textContent='P3 真实行走预热 12 秒 · 然后独立计时 12 秒 · 无录像/查询';
    }catch(error){await finishMotion(String(error),false);}
  };
  function motionFrame(cpuMs){
    const m=motion;if(!m||!current||m.phase==='setup')return;
    let s;try{s=state();}catch(error){void finishMotion(String(error),false);return;}
    m.lastState=s;
    const o=s.benchmarkObservation,clean=o&&['recording','videoPending','pendingCapture','evidenceReadback'].every(k=>o[k]===false);
    const unchanged=JSON.stringify(motionConditions(m.initial))===JSON.stringify(motionConditions(s));
    if(context.externalBusy?.()||!clean||!context.benchmark.active||!s.navigation?.groundRoute||s.navigation?.constraints?.blocked||s.workload.paused||!unchanged||s.programErrors||s.vegetation?.error||s.flow?.error||s.terrain?.error||errors.length){m.events.push({type:'motion-ownership-lost',activeSeconds:s.workload.activeSeconds});void finishMotion('P3 pause, ownership, conditions or resource failure',false);return;}
    const elapsed=s.workload.activeSeconds-m.startActive;
    if(m.phase==='warmup'){
      const p=s.position,q=m.previousPosition;m.warmupDistance+=Math.hypot(p[0]-q[0],p[2]-q[2]);m.previousPosition=p;
      if(elapsed>=MOTION_POLICY.warmupSeconds-1e-6){
        if(!motionRenderedReady(s)){void finishMotion('Moving warmup did not reach renderable sky/resources',false);return;}
        m.before=s;m.boundaryRaf=current.rafTimestampMs;m.boundaryClock=Number.isFinite(current.frameClock?.worldTime)&&Number.isFinite(current.frameClock?.activeSeconds)?{...current.frameClock}:null;m.lastRaf=current.rafTimestampMs;m.warmupSeconds=elapsed;m.warmupEvents=[...m.events];m.events=[];m.phase='sample';$('gpu-state').textContent='P3 连续普通时钟采样中 · 12 秒';
      }
      return;
    }
    if(m.frames.length>=1800){void finishMotion('P3 frame storage bound',false);return;}
    m.lastRaf=current.rafTimestampMs;
    const route=s.route?Object.fromEntries(['id','version','clock','durationSeconds','clip','progress','walk','speed','constraints'].map(key=>[key,s.route[key]])):null;
    m.frames.push({...current,cpuSubmissionMs:cpuMs,worldTime:s.worldTime,activeSeconds:s.workload.activeSeconds,pausedSeconds:s.workload.pausedSeconds,submittedFrames:s.workload.submittedFrames,drawSize:s.drawSize,position:s.position,quaternion:s.quaternion,conditions:motionConditions(s),benchmarkObservation:s.benchmarkObservation,route,navigation:s.navigation,clearance:s.clearance,drawCalls:s.drawCalls,triangles:s.triangles,memory:s.memory,programErrors:s.programErrors,pending:Boolean(s.terrain?.pending||s.vegetation?.pending||s.flow?.pending)});
    if((m.lastRaf-m.boundaryRaf)/1000>=MOTION_POLICY.sampleSeconds-1e-6)void finishMotion('window complete',true);
  }
  const cancelMotion=type=>{if(motion){motion.events.push({type});void finishMotion(type,false);}};
  addEventListener('blur',()=>cancelMotion('blur'));
  addEventListener('visibilitychange',()=>{if(document.hidden)cancelMotion('visibility');});
  addEventListener('resize',()=>cancelMotion('resize'));
  addEventListener('pagehide',()=>cancelMotion('pagehide'));
  async function finish(reason='window complete') {
    if(!sample)return;
    const s=sample,sampleEvents=[...events];sample=null;$('gpu-arm').disabled=false;clearTimeout(s.timer);context.setPaused(true);
    const end=state(),duration=(performance.now()-s.started)/1000,intervals=s.frames.map(f=>f.frameIntervalMs);
    const record={arm:s.arm,reason,source:s.before.build,before:s.before,after:end,durationSeconds:duration,frames:s.frames,events:sampleEvents,errors:[...errors]};
    const validation=validateTimingObservation(record);
    try{return await save('timing',{...record,validation,
      summary:{frames:s.frames.length,submittedFps:s.frames.length/duration,frameMs:stats(intervals),over33msRatio:intervals.filter(n=>n>33.4).length/Math.max(1,intervals.length),targetFps:s.before.workload.targetFps,longFrameRatio:intervals.filter(n=>n>50).length/Math.max(1,intervals.length),cpuSubmissionMs:stats(s.frames.map(f=>f.cpuSubmissionMs)),renders:renders-s.renderStart},
      passed:validation.valid});}
    finally{restoreDefaults();}
  }
  $('gpu-arm').onchange=()=>{
    if(unavailable())return;
    applyArm($('gpu-arm').value);
  };
  $('gpu-sample').onclick=async()=>{
    if(unavailable())return;
    context.setPaused(false);$('gpu-arm').onchange();warming=true;const run=++generation;$('gpu-arm').disabled=true;
    const started=performance.now();
    while(run===generation&&(!context.sky.status().ready||state().vegetation.pending||state().flow.pending)&&performance.now()-started<20000)await wait(100);
    if(run!==generation)return;
    if(!context.sky.status().ready||state().vegetation.pending||state().flow.pending||errors.length||state().programErrors){context.setPaused(true);try{await save('blocked',{passed:false,state:state(),errors:[...errors],reason:'Cache or resources not ready'});}finally{endReview(run);}return;}
    context.setTime(60);await wait(2000);if(run!==generation)return;warming=false;events.length=0;const before=state();
    sample={arm:$('gpu-arm').value,started:performance.now(),before,frames:[],renderStart:renders,timer:setTimeout(()=>finish(),12000)};
    $('gpu-state').textContent='固定镜头短采样 · '+sample.arm;
  };
  $('gpu-stop').onclick=()=>{if(motion)return finishMotion('user stop',false);generation++;warming=false;pendingShot=false;context?.setPaused(true);if(sample)return finish('user stop');if(!saving)restoreDefaults();};
  auditButton.onclick=async()=>{if(unavailable())return;warming=true;const run=++generation;try{context.setPaused(false);const result=await auditJob(run,()=>context.sky.auditDensity(renderer));context.setPaused(true);await save('density-audit',{passed:result.passed,result,state:state(),errors:[...errors]});}catch(error){if(!terminal)await save('density-audit',{passed:false,error:String(error),errors:[...errors]});}finally{endReview(run);}};
  routeButton.onclick=async()=>{if(unavailable())return;context.setPaused(true);const records=context.benchmark.visualRecords.map(({image,...record})=>record),s=state(),motion=records.findLast(r=>r.kind==='replay'&&r.route?.id==='side-spring-loop'),suite=records.findLast(r=>r.kind==='suite-complete');await save('regional-e2e',{passed:Boolean(motion?.completed&&motion.route?.completed&&!motion.samples.some(f=>!f.position.every(Number.isFinite)||f.clearance<1.2)&&!errors.length&&!s.programErrors&&s.encounter.instances.length===2),state:s,records,video:context.benchmark.videoState,suitePassed:suite?.passed??null,errors:[...errors]});};
  $('gpu-shot').onclick=async()=>{
    if(unavailable())return;
    pendingShot=true;context.setPaused(false);$('gpu-state').textContent='独立单帧取证，完成后暂停';
  };
  const injection=$('gpu-context');if(injection)injection.onclick=()=>{
    if(unavailable())return;
    const ext=renderer.getContext().getExtension('WEBGL_lose_context');
    if(!ext){$('gpu-state').textContent='context loss 注入不可用';return;}
    injectionRequested=true;panel.dataset.injection=JSON.stringify({requestedAt:Date.now(),test:'WEBGL_lose_context'});context.setPaused(true);ext.loseContext();setTimeout(()=>ext.restoreContext(),1000);
  };
  $('gpu-s0').onclick=async()=>{
    if(unavailable())return;
    warming=true;const run=++generation,checks={},snapshots=[],check=(name,passed)=>checks[name]=Boolean(passed);
    const capture=()=>{const s=state();snapshots.push({renders,state:s});return s};
    try{
      context.setPaused(true);const a=capture();await wait(2100,run);const b=capture();
      check('pausedAllRendererSubmissions',snapshots[0].renders===renders);
      check('pausedCloudRays',a.skyCache.totalRays===b.skyCache.totalRays);
      check('pausedWetMemory',a.flow.wetMemory.updates===b.flow.wetMemory.updates);
      check('pausedAnimation',a.worldTime===b.worldTime);
      check('boundedDeferredResults',b.vegetation.deferredResults<=1&&b.flow.deferredResults<=1);
      context.setPaused(false);await wait(2100,run);const c=capture();
      check('resumeRealTime',Math.abs(c.worldTime-b.worldTime-2.1)<.25);
      check('oneLoop',c.workload.loops===1);
      check('actualFrameCounter',c.workload.submittedFrames>b.workload.submittedFrames&&c.workload.submittedFrames-b.workload.submittedFrames<=65);
      check('noCatchupPose',Math.hypot(...c.position.map((n,i)=>n-b.position[i]))<.01);
      check('canvasBudget',c.drawSize[0]*c.drawSize[1]<=c.workload.maxPixels&&Math.max(...c.drawSize)<=c.workload.maxDimension);
      check('cloudFrameBudget',c.skyCache.raysLastFrame<=c.skyCache.raysPerFrame);
      document.querySelector('#help').click();const r=renders;await wait(1100,run);
      check('dialogPausesGpu',r===renders&&state().workload.pauseReasons.includes('dialog'));
      document.querySelector('#help-dialog .close').click();await wait(250,run);
      context.setPaused(true);const beforeQuality=renders;context.setFine(false);await wait(250,run);
      check('qualityWhilePausedNoGpu',renders===beforeQuality);
      context.setPaused(false);await wait(1800,run);const d=capture();
      check('lowQualityBudget',d.drawSize[0]*d.drawSize[1]<=655360&&d.skyCache.width===768&&d.skyCache.steps===80);
      context.setFine(true);await wait(2000,run);const e=capture();
      check('highQualityBudget',e.drawSize[0]*e.drawSize[1]<=921600&&e.skyCache.width===1536);
      check('animalsRetained',e.encounter.instances.length===2);
      check('linearComposition',e.flow.composition.mode==='linear-hdr');
      check('programsValid',e.programErrors===0&&!errors.length);
      context.setPaused(true);
      await save('s0-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,errors:[...errors]});
    }catch(error){if(!terminal){if(run===generation)context.setPaused(true);await save('s0-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]})}}
    finally{endReview(run);}
  };
  return {
    get injectionRequested(){return injectionRequested;},
    contextLost(detail){
      terminal=true;generation++;warming=false;pendingShot=false;
      const motionSave=motion?finishMotion('context-lost',false):null;
      const interrupted=sample;sample=null;if(interrupted)clearTimeout(interrupted.timer);
      errors.push('WebGL context lost');$('gpu-arm').disabled=true;
      panel.querySelectorAll('button').forEach(b=>b.disabled=b.id!=='gpu-stop');
      // No GL read or screenshot after loss: use the last safe observation.
      const lossSave=save('context-loss',{passed:false,reason:'graphics context lost',injectionRequested,detail,lastSafeState:lastState,collection:interrupted?'sampling':lastState?'idle-or-warmup':'startup',before:interrupted?.before??null,frames:interrupted?.frames??[],events:[...events],errors:[...errors]});return motionSave?Promise.allSettled([motionSave,lossSave]):lossSave;
    },
    get collecting(){return Boolean(sample||motion||warming||pendingShot||saving)},labelGroup(){},labelGeometry(){},
    attach(value){context={...context,...value};},
    event(type,detail={}){const row={type,...detail,wallMs:performance.now()};events.push(row);if(events.length>512)events.shift();if(motion){motion.events.push(row);if((type==='pause-state'&&detail.paused)||type==='context-lost')void finishMotion(type,false);}},
    beginFrame(t,raw,worldTime,frameClock){current={rafTimestampMs:t,frameIntervalMs:raw,frameClock:{worldTime,activeSeconds:frameClock?.activeSeconds??null},cpu:{},passes:[]};},
    cpu(name,ms){if(current)current.cpu[name]=ms;},
    pass(name,fn){const before={...renderer.info.render},start=performance.now(),oldScope=scope;scope=name;try{return fn()}finally{scope=oldScope;if(current)current.passes.push({name,cpuSubmissionMs:performance.now()-start,calls:renderer.info.render.calls-before.calls,triangles:renderer.info.render.triangles-before.triangles});}},
    endGpuFrame(){},
    endFrame(cpuMs){motionFrame(cpuMs);if(pendingShot){pendingShot=false;context.setPaused(true);const image=renderer.domElement.toDataURL('image/png');void save('still',{state:state(),image,errors:[...errors]});}if(sample&&current&&sample.frames.length<900){const s=state();sample.frames.push({...current,cpuSubmissionMs:cpuMs,worldTime:s.worldTime,drawSize:s.drawSize,cloudRays:s.skyCache.raysLastFrame,drawCalls:s.drawCalls,triangles:s.triangles,memory:s.memory,position:s.position,quaternion:s.quaternion,conditions:observationConditions(s),benchmarkObservation:s.benchmarkObservation,pending:s.terrain.pending||s.vegetation.pending||s.flow.pending||Boolean(s.vegetation.error||s.flow.error||s.programErrors)});}current=null;},
    heartbeat(s){if(terminal)return;lastState=s;panel.dataset.snapshot=JSON.stringify({renders,...s});const readiness={...p3Eligibility(s),ownerAvailable:!unavailable()};panel.dataset.motionReady=String(Object.values(readiness).every(Boolean));panel.dataset.motionIssues=JSON.stringify(Object.entries(readiness).filter(([,ok])=>!ok).map(([name])=>name));if(!sample&&!motion)$('gpu-state').textContent=(s.workload.paused?'3D 已暂停':'运行中')+' · 提交 '+s.workload.submittedFrames+' · GPU 绘制 '+renders;},
  };
}
