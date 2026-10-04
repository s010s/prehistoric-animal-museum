// Explicit, bounded browser E2E and short observations. No GL hooks or timer queries.
import * as T from 'three';
export function makeWorkloadReview(renderer,params) {
  if(params.get('workloadReview')!=='1')return null;
  let context=null,current=null,sample=null,renders=0,reportSerial=0,scope='startup',pendingShot=false,warming=false,generation=0;
  const events=[],errors=[],reports=[];
  const original=renderer.render.bind(renderer);
  renderer.render=(...args)=>{renders++;return original(...args)};
  addEventListener('error',e=>{if(errors.length<64)errors.push(e.message)});
  const panel=document.createElement('section');panel.id='gpu-review';
  panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:90;background:#122a29ef;color:white;padding:10px;max-width:560px;font:12px system-ui';
  panel.innerHTML='<strong>受限 GPU 验证 · 无 GPU 查询</strong><div><button id="gpu-s0">验证暂停与预算</button><select id="gpu-arm" aria-label="短实验变量"><option value="baseline">全部正常 · 地形代理</option><option value="fullTerrain">仅完整反射地形</option><option value="pixels">仅半像素</option><option value="cloud">仅冻结云重算</option><option value="reflection">仅冻结反射重画</option><option value="ao">仅停 AO</option><option value="water">仅廉价水着色</option></select><button id="gpu-sample">12 秒短样本</button><button id="gpu-stop">停止并保存</button><button id="gpu-shot">独立截图</button><button id="gpu-context">一次受控 context loss</button></div><output id="gpu-state">启动调度中</output><pre id="gpu-result" style="max-height:110px;overflow:auto"></pre>';
  document.body.append(panel);
  const auditButton=document.createElement('button');auditButton.textContent='验证云优化等价';auditButton.id='gpu-density-audit';panel.querySelector('div').append(auditButton);
  const routeButton=document.createElement('button');routeButton.textContent='保存游览与资源';routeButton.id='gpu-route-save';panel.querySelector('div').append(routeButton);
  const walkTiming=document.createElement('button');walkTiming.textContent='区域行走 · 仅计时';panel.querySelector('div').append(walkTiming);walkTiming.onclick=()=>{if(!context||sample||warming)return;context.benchmark.startRealtime({capture:false});context.setPaused(false);};
  // Failure cases recorded before the reflection/navigation implementation:
  // changed main/collision mesh; shoreline cracks; stale mirror/shadow time;
  // per-frame proxy allocation; pause work; rock tunnelling, steep/deep-water
  // walking; diagnostic routes skipping the ordinary movement constraints.
  const mirrorButton=document.createElement('button');mirrorButton.textContent='验证反射与地面约束';panel.querySelector('div').append(mirrorButton);
  const fold=document.createElement('button');fold.textContent='收起 GPU 验证';panel.querySelector('strong').after(fold);fold.onclick=()=>{const hidden=panel.querySelector('div').hidden=!panel.querySelector('div').hidden;panel.querySelector('pre').hidden=hidden;panel.querySelector('output').hidden=hidden;fold.textContent=hidden?'展开 GPU 验证':'收起 GPU 验证';};
  const $=id=>panel.querySelector('#'+id),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const state=()=>context.getState();
  mirrorButton.onclick=async()=>{
    if(!context||sample||warming)return;
    const checks={},snapshots=[];warming=true;context.setPaused(false);
    try{
      await wait(2200);const a=state();snapshots.push(a);
      await wait(2200);const b=state();snapshots.push(b);
      const p=b.terrain.reflection;
      checks.mainGeometryRestored=p?.mainRestored===true&&b.terrain.triangles===3634836;
      checks.proxyReducesGeometry=p?.triangles>0&&p.triangles<b.terrain.triangles*.7;
      checks.shoreContactGridPreserved=p?.shoreContactPreserved===true;
      checks.mirrorEveryFrame=b.flow.reflection?.lastTime===b.worldTime&&b.flow.reflection?.updates-a.flow.reflection?.updates===b.workload.submittedFrames-a.workload.submittedFrames;
      checks.currentShadowBeforeMirror=b.flow.currentReflectionShadow===true;
      checks.animalsAndLinearHDR=b.encounter.instances.length===2&&b.flow.composition.mode==='linear-hdr';
      context.setPaused(true);const r=renders;await wait(1100);const c=state();snapshots.push(c);
      checks.pauseStopsMirror=r===renders&&b.flow.reflection?.updates===c.flow.reflection?.updates;
      const walk=await context.auditWalk?.();
      checks.walkConstraints=walk?.passed===true;
      checks.noRuntimeOrShaderErrors=!errors.length&&!b.programErrors;
      await save('reflection-walk-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,walk:walk??null,errors:[...errors]});
    }catch(error){context.setPaused(true);await save('reflection-walk-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]});}
    finally{warming=false;context.setPaused(true);}
  };
  async function save(kind,record) {
    const name=(params.get('runLabel')||kind)+'-'+kind+'-'+(++reportSerial)+'-'+Date.now();
    const artifact={schema:'island-gpu-governance-v1',kind,name,url:location.href,userAgent:navigator.userAgent,three:T.REVISION,gpuTime:null,gpuTiming:'not measured; no timer queries',...record};
    reports.push(artifact);if(reports.length>24)reports.shift();
    panel.dataset.report=JSON.stringify(artifact);$('gpu-result').textContent=JSON.stringify({kind,passed:artifact.passed,summary:artifact.summary,checks:artifact.checks},null,2);
    try{const res=await fetch('/__gpu/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(artifact)});if(!res.ok)throw Error(res.status);$('gpu-state').textContent='已保存在本地 · '+name;}
    catch(error){$('gpu-state').textContent='本地保存失败 · '+error;artifact.saveError=String(error)}
    return artifact;
  }
  const stats=values=>{const a=[...values].sort((a,b)=>a-b),p=q=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*q))]:null;return{count:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1)??null,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:null}};
  async function finish(reason='window complete') {
    if(!sample)return;
    const s=sample;sample=null;$('gpu-arm').disabled=false;clearTimeout(s.timer);context.setPaused(true);
    const end=state(),duration=(performance.now()-s.started)/1000,intervals=s.frames.map(f=>f.frameIntervalMs);
    const artifact=await save('timing',{arm:s.arm,reason,source:s.before.build,before:s.before,after:end,durationSeconds:duration,frames:s.frames,events:[...events],errors:[...errors],
      summary:{frames:s.frames.length,submittedFps:s.frames.length/duration,frameMs:stats(intervals),over33msRatio:intervals.filter(n=>n>33.4).length/Math.max(1,intervals.length),targetFps:s.before.workload.targetFps,longFrameRatio:intervals.filter(n=>n>50).length/Math.max(1,intervals.length),cpuSubmissionMs:stats(s.frames.map(f=>f.cpuSubmissionMs)),renders:renders-s.renderStart},
      passed:reason==='window complete'&&s.frames.length>0&&!errors.length&&!end.programErrors&&end.drawSize[0]*end.drawSize[1]<=end.workload.maxPixels});
    return artifact;
  }
  $('gpu-arm').onchange=()=>{
    if(!context||sample||warming)return;
    const arm=$('gpu-arm').value;
    context.landscape.setReflectionTerrain(arm!=='fullTerrain');
    context.sky.setFrozen(arm==='cloud');
    context.water.setDiagnostic({freezeReflection:arm==='reflection',disableAO:arm==='ao',cheap:arm==='water'});
    context.setPixelScale(arm==='pixels'?Math.SQRT1_2:1);
    panel.dataset.arm=arm;
  };
  $('gpu-sample').onclick=async()=>{
    if(!context||sample||warming)return;
    context.setPaused(false);$('gpu-arm').onchange();warming=true;const run=++generation;$('gpu-arm').disabled=true;
    const started=performance.now();
    while(run===generation&&(!context.sky.status().ready||state().vegetation.pending||state().flow.pending)&&performance.now()-started<20000)await wait(100);
    if(run!==generation)return;
    if(!context.sky.status().ready||state().vegetation.pending||state().flow.pending||errors.length||state().programErrors){warming=false;$('gpu-arm').disabled=false;context.setPaused(true);await save('blocked',{passed:false,state:state(),errors:[...errors],reason:'Cache or resources not ready'});return;}
    context.setTime(60);await wait(2000);if(run!==generation)return;warming=false;events.length=0;const before=state();
    sample={arm:$('gpu-arm').value,started:performance.now(),before,frames:[],renderStart:renders,timer:setTimeout(()=>finish(),12000)};
    $('gpu-state').textContent='固定镜头短采样 · '+sample.arm;
  };
  $('gpu-stop').onclick=()=>{generation++;warming=false;$('gpu-arm').disabled=false;context?.setPaused(true);finish('user stop')};
  auditButton.onclick=async()=>{if(!context||sample||warming)return;context.setPaused(false);const result=await context.queueReviewJob(()=>context.sky.auditDensity(renderer));context.setPaused(true);await save('density-audit',{passed:result.passed,result,state:state(),errors:[...errors]});};
  routeButton.onclick=async()=>{if(!context||sample||warming)return;context.setPaused(true);const records=context.benchmark.visualRecords.map(({image,...record})=>record),s=state(),motion=records.findLast(r=>r.kind==='replay'&&r.route?.id==='side-spring-loop'),suite=records.findLast(r=>r.kind==='suite-complete');await save('regional-e2e',{passed:Boolean(motion?.completed&&motion.route?.completed&&!motion.samples.some(f=>!f.position.every(Number.isFinite)||f.clearance<1.2)&&!errors.length&&!s.programErrors&&s.encounter.instances.length===2),state:s,records,video:context.benchmark.videoState,suitePassed:suite?.passed??null,errors:[...errors]});};
  $('gpu-shot').onclick=async()=>{
    if(!context||sample)return;
    pendingShot=true;context.setPaused(false);$('gpu-state').textContent='独立单帧取证，完成后暂停';
  };
  $('gpu-context').onclick=()=>{
    if(!context||sample)return;
    const ext=renderer.getContext().getExtension('WEBGL_lose_context');
    if(!ext){$('gpu-state').textContent='context loss 注入不可用';return;}
    context.setPaused(true);ext.loseContext();setTimeout(()=>ext.restoreContext(),1000);
  };
  $('gpu-s0').onclick=async()=>{
    if(!context||sample)return;
    const checks={},snapshots=[],check=(name,passed)=>checks[name]=Boolean(passed);
    const capture=()=>{const s=state();snapshots.push({renders,state:s});return s};
    try{
      context.setPaused(true);const a=capture();await wait(2100);const b=capture();
      check('pausedAllRendererSubmissions',snapshots[0].renders===renders);
      check('pausedCloudRays',a.skyCache.totalRays===b.skyCache.totalRays);
      check('pausedWetMemory',a.flow.wetMemory.updates===b.flow.wetMemory.updates);
      check('pausedAnimation',a.worldTime===b.worldTime);
      check('boundedDeferredResults',b.vegetation.deferredResults<=1&&b.flow.deferredResults<=1);
      context.setPaused(false);await wait(2100);const c=capture();
      check('resumeRealTime',Math.abs(c.worldTime-b.worldTime-2.1)<.25);
      check('oneLoop',c.workload.loops===1);
      check('actualFrameCounter',c.workload.submittedFrames>b.workload.submittedFrames&&c.workload.submittedFrames-b.workload.submittedFrames<=65);
      check('noCatchupPose',Math.hypot(...c.position.map((n,i)=>n-b.position[i]))<.01);
      check('canvasBudget',c.drawSize[0]*c.drawSize[1]<=c.workload.maxPixels&&Math.max(...c.drawSize)<=c.workload.maxDimension);
      check('cloudFrameBudget',c.skyCache.raysLastFrame<=c.skyCache.raysPerFrame);
      document.querySelector('#help').click();const r=renders;await wait(1100);
      check('dialogPausesGpu',r===renders&&state().workload.pauseReasons.includes('dialog'));
      document.querySelector('#help-dialog .close').click();await wait(250);
      context.setPaused(true);const beforeQuality=renders;context.setFine(false);await wait(250);
      check('qualityWhilePausedNoGpu',renders===beforeQuality);
      context.setPaused(false);await wait(1800);const d=capture();
      check('lowQualityBudget',d.drawSize[0]*d.drawSize[1]<=655360&&d.skyCache.width===768&&d.skyCache.steps===80);
      context.setFine(true);await wait(2000);const e=capture();
      check('highQualityBudget',e.drawSize[0]*e.drawSize[1]<=921600&&e.skyCache.width===1536);
      check('animalsRetained',e.encounter.instances.length===2);
      check('linearComposition',e.flow.composition.mode==='linear-hdr');
      check('programsValid',e.programErrors===0&&!errors.length);
      context.setPaused(true);
      await save('s0-e2e',{passed:Object.values(checks).every(Boolean),checks,snapshots,errors:[...errors]});
    }catch(error){context.setPaused(true);await save('s0-e2e',{passed:false,checks,snapshots,error:String(error),errors:[...errors]})}
  };
  return {
    get collecting(){return Boolean(sample||warming)},labelGroup(){},labelGeometry(){},
    attach(value){context={...context,...value};},
    event(type,detail={}){events.push({type,...detail,wallMs:performance.now()});if(events.length>512)events.shift();},
    beginFrame(t,raw){current={rafTimestampMs:t,frameIntervalMs:raw,cpu:{},passes:[]};},
    cpu(name,ms){if(current)current.cpu[name]=ms;},
    pass(name,fn){const before={...renderer.info.render},start=performance.now(),oldScope=scope;scope=name;try{return fn()}finally{scope=oldScope;if(current)current.passes.push({name,cpuSubmissionMs:performance.now()-start,calls:renderer.info.render.calls-before.calls,triangles:renderer.info.render.triangles-before.triangles});}},
    endGpuFrame(){},
    endFrame(cpuMs){if(pendingShot){pendingShot=false;context.setPaused(true);const image=renderer.domElement.toDataURL('image/png');void save('still',{state:state(),image,errors:[...errors]});}if(sample&&current&&sample.frames.length<900){const s=state();sample.frames.push({...current,cpuSubmissionMs:cpuMs,worldTime:s.worldTime,drawSize:s.drawSize,cloudRays:s.skyCache.raysLastFrame,drawCalls:s.drawCalls,triangles:s.triangles,memory:s.memory,position:s.position,pending:s.vegetation.pending||s.flow.pending});}current=null;},
    heartbeat(s){panel.dataset.snapshot=JSON.stringify({renders,...s});if(!sample)$('gpu-state').textContent=(s.workload.paused?'3D 已暂停':'运行中')+' · 提交 '+s.workload.submittedFrames+' · GPU 绘制 '+renders;},
  };
}
