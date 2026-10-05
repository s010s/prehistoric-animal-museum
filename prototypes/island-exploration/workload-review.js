// Explicit, bounded browser E2E and short observations. No GL hooks or timer queries.
import * as T from 'three';
import {observationConditions,validateTimingObservation} from './short-observation.js';
export function makeWorkloadReview(renderer,params) {
  if(params.get('workloadReview')!=='1')return null;
  let context=null,current=null,sample=null,renders=0,reportSerial=0,scope='startup',pendingShot=false,warming=false,saving=0,generation=0,lastState=null,terminal=false,injectionRequested=false;
  const events=[],errors=[],reports=[];
  function unavailable(){
    if(!context||terminal||sample||warming||pendingShot||saving)return true;
    const observation=context.benchmark?.observationState;
    return Boolean(context.benchmark?.active||['routeActive','recording','videoPending','pendingCapture','evidenceReadback'].some(key=>observation?.[key]));
  }
  function applyArm(arm){
    context.landscape.setReflectionTerrain(arm!=='fullTerrain');context.sky.setFrozen(arm==='cloud');context.props.setDiagnosticGrass(arm==='grass');context.setAtlasNormalDeferred(arm!=='atlasNormals');
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
  panel.innerHTML='<strong>受限 GPU 验证 · 无 GPU 查询</strong><div><button id="gpu-s0">验证暂停与预算</button><select id="gpu-arm" aria-label="短实验变量"><option value="baseline">全部正常 · 地形代理</option><option value="fullTerrain">仅完整反射地形</option><option value="pixels">仅半像素</option><option value="cloud">仅冻结云重算</option><option value="reflection">仅冻结反射重画</option><option value="ao">仅停 AO</option><option value="water">仅廉价水着色</option><option value="grass">诊断 · 仅停止近草提交</option><option value="atlasNormals">对照 · 原树林法线调度</option></select><button id="gpu-sample">12 秒短样本</button><button id="gpu-stop">停止并保存</button><button id="gpu-shot">独立截图</button></div><output id="gpu-state">启动调度中</output><pre id="gpu-result" style="max-height:110px;overflow:auto"></pre>';
  document.body.append(panel);
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
  async function save(kind,record) {
    const name=(params.get('runLabel')||kind)+'-'+kind+'-'+(++reportSerial)+'-'+Date.now();
    const artifact={schema:'island-gpu-governance-v1',kind,name,url:location.href,userAgent:navigator.userAgent,three:T.REVISION,gpuTime:null,gpuTiming:'not measured; no timer queries',...record};
    reports.push(artifact);if(reports.length>24)reports.shift();
    panel.dataset.report=JSON.stringify(artifact);$('gpu-result').textContent=JSON.stringify({kind,passed:artifact.passed,validation:artifact.validation,summary:artifact.summary,checks:artifact.checks},null,2);
    saving++;
    try{const res=await fetch('/__gpu/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(artifact)});if(!res.ok)throw Error(res.status);$('gpu-state').textContent='已保存在本地 · '+name;}
    catch(error){$('gpu-state').textContent='本地保存失败 · '+error;artifact.saveError=String(error)}
    finally{saving--;}
    return artifact;
  }
  const stats=values=>{const a=[...values].sort((a,b)=>a-b),p=q=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*q))]:null;return{count:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:null}};
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
  $('gpu-stop').onclick=()=>{generation++;warming=false;pendingShot=false;context?.setPaused(true);if(sample)return finish('user stop');if(!saving)restoreDefaults();};
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
      const interrupted=sample;sample=null;if(interrupted)clearTimeout(interrupted.timer);
      errors.push('WebGL context lost');$('gpu-arm').disabled=true;
      panel.querySelectorAll('button').forEach(b=>b.disabled=b.id!=='gpu-stop');
      // No GL read or screenshot after loss: use the last safe observation.
      return save('context-loss',{passed:false,reason:'graphics context lost',injectionRequested,detail,lastSafeState:lastState,collection:interrupted?'sampling':lastState?'idle-or-warmup':'startup',before:interrupted?.before??null,frames:interrupted?.frames??[],events:[...events],errors:[...errors]});
    },
    get collecting(){return Boolean(sample||warming||pendingShot||saving)},labelGroup(){},labelGeometry(){},
    attach(value){context={...context,...value};},
    event(type,detail={}){events.push({type,...detail,wallMs:performance.now()});if(events.length>512)events.shift();},
    beginFrame(t,raw){current={rafTimestampMs:t,frameIntervalMs:raw,cpu:{},passes:[]};},
    cpu(name,ms){if(current)current.cpu[name]=ms;},
    pass(name,fn){const before={...renderer.info.render},start=performance.now(),oldScope=scope;scope=name;try{return fn()}finally{scope=oldScope;if(current)current.passes.push({name,cpuSubmissionMs:performance.now()-start,calls:renderer.info.render.calls-before.calls,triangles:renderer.info.render.triangles-before.triangles});}},
    endGpuFrame(){},
    endFrame(cpuMs){if(pendingShot){pendingShot=false;context.setPaused(true);const image=renderer.domElement.toDataURL('image/png');void save('still',{state:state(),image,errors:[...errors]});}if(sample&&current&&sample.frames.length<900){const s=state();sample.frames.push({...current,cpuSubmissionMs:cpuMs,worldTime:s.worldTime,drawSize:s.drawSize,cloudRays:s.skyCache.raysLastFrame,drawCalls:s.drawCalls,triangles:s.triangles,memory:s.memory,position:s.position,quaternion:s.quaternion,conditions:observationConditions(s),benchmarkObservation:s.benchmarkObservation,pending:s.terrain.pending||s.vegetation.pending||s.flow.pending||Boolean(s.vegetation.error||s.flow.error||s.programErrors)});}current=null;},
    heartbeat(s){if(terminal)return;lastState=s;panel.dataset.snapshot=JSON.stringify({renders,...s});if(!sample)$('gpu-state').textContent=(s.workload.paused?'3D 已暂停':'运行中')+' · 提交 '+s.workload.submittedFrames+' · GPU 绘制 '+renders;},
  };
}
