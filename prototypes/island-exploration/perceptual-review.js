import {waterLevelAt} from './field.js';
// UI-owned, bounded visual evidence. Failure inventory was written before
// implementation in docs/research/perceptual-budget/phase2/acceptance.md:
// stale queued jobs after cancel; mixed A/B pose/time; overlapping capture;
// stalled clock/encoder/upload; lost context reads; leaked modes/tracks; rail
// mislabeled as ground walking; radial distance mislabeled light-plane border.
import * as T from 'three';
import {makeReviewRecorder} from './review-recorder.js';
import {setShadowBudget} from './shadow-budget.js';
import {setLeafTransmission} from './leaf-transmission.js';
import {runLeafAudit} from './leaf-audit.js';
import {perceptualReviewPlan as plan} from './perceptual-review-plan.js';
import {setFoliageEdgeSafe} from './foliage-coverage.js';

export function makePerceptualReview(context){
 if(context.params?.get('perceptualReview')!=='1')return null;
 const {renderer,camera}=context;
 const canvas=renderer.domElement;
 let operation=null,serial=0,terminal=false,disposed=false,lastState=null,videoUrl=null,leafDiagnosticRestore=null,displayDiagnosticRestore=null,candidateRestore=null,p7DiagnosticRestore=null;
 const listeners=[];
 const panel=document.createElement('details');panel.id='perceptual-review';panel.open=true;
 panel.style.cssText='position:fixed;right:8px;bottom:8px;z-index:91;max-width:340px;max-height:70vh;overflow:auto;background:#162b2af2;color:#fff;padding:10px;font:12px system-ui';
 panel.innerHTML='<summary>P2 风与阴影 · 有界观察</summary><p>相机轨道为 diagnostic-rail，非地面步行。录像不用于计时。</p><div></div><output aria-live="polite">等待显式动作</output><video controls style="display:none;width:100%"></video><pre style="white-space:pre-wrap;max-height:100px;overflow:auto"></pre>';
 document.body.append(panel);
 const output=panel.querySelector('output'),summary=panel.querySelector('pre'),video=panel.querySelector('video');
 const message=text=>{if(!disposed)output.textContent=text;};
 const unique=kind=>'p2-'+kind+'-'+Date.now()+'-'+(++serial);
 const valid=op=>operation===op&&!op.cancelled&&!op.finishing&&!terminal&&!disposed;
 function assert(op){if(!valid(op))throw Error('P2 operation interrupted');}
 function state(){if(terminal||disposed)throw Error('P2 graphics unavailable');lastState=context.getState();return lastState;}
 function bounded(promise,ms,signal){
  return new Promise((resolve,reject)=>{
   let timer=null,settled=false;
   const end=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
   const abort=()=>end(reject,Error('P2 operation aborted'));
   timer=setTimeout(()=>end(reject,Error('P2 bounded operation timeout')),ms);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   Promise.resolve(promise).then(value=>end(resolve,value),error=>end(reject,error));
  });
 }
 const wait=(ms,signal)=>bounded(new Promise(resolve=>setTimeout(resolve,ms)),ms+100,signal);
 async function post(name,record,signal){
  const artifact={schema:'island-perceptual-review-v1',name,url:location.href,userAgent:navigator.userAgent,three:T.REVISION,gpuTime:null,gpuTiming:'not measured; media/readbacks excluded from timing',...record};
  const result=await bounded(fetch('/__gpu/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(artifact),signal}),10000,signal);
  if(!result.ok)throw Error('P2 evidence HTTP '+result.status);
  return bounded(result.json(),2000,signal);
 }
 const recorder=makeReviewRecorder({canvas,
  upload:async(blob,signal)=>{
   const name=operation?.videoName??unique('orphan-video');
   const response=await fetch('/__gpu-video/'+name,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal});
   if(!response.ok)throw Error('P2 video HTTP '+response.status);
   return (await response.json()).path;
  },
  publish:blob=>{if(disposed)return;if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=URL.createObjectURL(blob);video.src=videoUrl;video.style.display='block';},
  onStop:reason=>{if(operation&&!operation.finishing)void finish(operation,reason,false);},
 });
 function restore(){
  p7DiagnosticRestore?.();p7DiagnosticRestore=null;
  candidateRestore?.();candidateRestore=null;
  displayDiagnosticRestore?.();displayDiagnosticRestore=null;
  leafDiagnosticRestore?.();leafDiagnosticRestore=null;
  setFoliageEdgeSafe(true);context.water.setDiagnostic();context.sky.setFrozen(false);
  try{context.resetModes();context.setFoliageCoverage?.(true);context.props.setTreeWindTime?.(null);}catch{}
  try{context.setPaused(true);}catch{}
 }
 function cancel(reason){
  const op=operation;if(!op)return;
  op.cancelled=true;op.abort.abort();
  if(op.finishing){op.finalAbort?.abort();restore();return;}
  void finish(op,reason,false);
 }
 async function finish(op,reason,completed,error=null){
  if(operation!==op||op.finishing)return;
  op.finishing=true;op.phase='saving';clearTimeout(op.deadline);clearInterval(op.heartbeat);
  op.abort.abort();recorder.stop(reason);restore();
  op.finalAbort=new AbortController();
  let finalState=lastState,saveError=null;
  try{
   if(!terminal&&!disposed)finalState=state();
   const end=performance.now()+14000;
   while(recorder.pending&&performance.now()<end)await wait(100,op.finalAbort.signal);
   if(recorder.pending)throw Error('P2 recorder did not settle within deadline');
   const capture=op.captureArmed?recorder.state:null,record={kind:op.kind,completed,reason,error:error?String(error):null,plan:op.plan,clock:op.clock??((op.capture||op.timing)?'active-wall':'fixed-world-time'),navigation:'diagnostic-camera-rail; no ground walking or collision acceptance',worldStart:op.worldStart,source:op.before?.build,before:op.before,after:finalState,lastRendered:op.lastRendered??null,samples:op.samples,stills:op.stills,video:op.capture?capture:null,routeSeconds:op.duration??null,activeElapsed:op.startedAt===null?null:(context.now()-op.startedAt)/1000,mediaComplete:op.capture?Boolean(capture&&capture.status==='saved'&&!capture.truncated&&!capture.saveError):op.stills.length>0,visualVerdict:'pending independent image and continuous motion review'};
   await post(unique(op.kind+'-summary'),record,op.finalAbort.signal);
   if(!disposed)summary.textContent=JSON.stringify({completed,reason,samples:op.samples.length,stills:op.stills.length,video:capture?.artifact??null,error:record.error},null,2);
  }catch(failure){saveError=String(failure);}
  finally{op.finalAbort.abort();restore();if(operation===op)operation=null;message(saveError?'P2 保存未完成 · '+saveError:'P2 已保存并暂停 · '+reason);}
 }
 function begin(kind,extra={}){
  if(terminal||disposed||operation||recorder.pending||context.busy?.())return null;
  context.stop('P2 explicit observation');
  const op={kind,phase:'preparing',worldStart:plan.worldStart,startedAt:null,cancelled:false,finishing:false,abort:new AbortController(),samples:[],stills:[],capture:false,before:state(),plan:JSON.parse(JSON.stringify(plan)),...extra};
  operation=op;video.style.display='none';summary.textContent='';
  op.deadline=setTimeout(()=>cancel('wall deadline'),kind==='stations'||kind.startsWith('p8-')?120000:40000);
  op.heartbeat=setInterval(()=>{
   if(!valid(op)||op.finishing)return;
   if(context.busy?.()){cancel('another review acquired ownership');return;}
   if(op.phase==='rail'&&context.getPaused())cancel('scene paused during rail');
  },200);
  context.setPaused(false);message('P2 准备中 · '+kind);return op;
 }
 function eye(x,z){const height=context.heightAt(x,z);if(!Number.isFinite(height))throw Error('P2 installed terrain height unavailable');return[x,height+plan.eyeHeight,z];}
 function targets(){
  const [x,z]=plan.caster.rootXZ,fallback=context.heightAt(x,z),root=operation?.casterRecord?.root??[x,fallback,z];
  const groundY=context.heightAt(plan.probe[0],plan.probe[2]);
  if(!root.every(Number.isFinite)||!Number.isFinite(groundY))throw Error('P2 installed ground unavailable');
  const height=operation?.casterRecord?.scale?.[1]??plan.caster.height;
  return {ground:[plan.probe[0],groundY,plan.probe[2]],casterRoot:[...root],casterCrown:[root[0],root[1]+height,root[2]]};
 }
 function auditCaster(op){
  const [x,z]=plan.caster.rootXZ;
  const audit=context.props.auditTrees?.({position:[x,plan.caster.rootYSeed,z],radius:64,limit:512});
  op.casterRecord=audit?.records?.find(record=>Math.abs(record.root[0]-x)<1e-3&&Math.abs(record.root[2]-z)<1e-3)??null;
 }
 function probes(){return Object.entries(targets()).map(([id,point])=>({id,point,seedPoint:id==='ground'?[...plan.probe]:null,installedHeightDelta:id==='ground'?point[1]-plan.probe[1]:null,casterRootSource:id==='ground'?null:operation?.casterRecord?'props audit matched XZ':'installed terrain fallback; caster match unavailable',normal:id==='ground'?plan.normal:null,normalCaveat:id==='ground'?'visible-height-gradient approximation':'geometric probe; crown/trunk surface normal not established',cameraNDC:new T.Vector3(...point).project(camera).toArray(),result:context.shadowProbe(point,id==='ground'?plan.normal:null)}));}
 function install(enabled){setShadowBudget(context.sun,enabled);context.water.setSunGlare?.(false);}
 async function queued(op,fn,timeoutMs=6000){
  assert(op);context.setPaused(false);
  const result=await bounded(context.queueReviewJob(()=>{assert(op);return fn();}),timeoutMs,op.abort.signal);
  assert(op);
  if(result?.passed===false&&(result.reason||result.error))throw Error(result.reason||result.error);
  return result;
 }
 const ready=s=>s.skyCache?.ready&&s.vegetation?.pending===false&&s.terrain?.pending===false&&s.flow?.pending===false&&!s.programErrors&&!s.vegetation?.error&&!s.flow?.error;
 async function prepare(op,position,target,enabled){
  assert(op);install(enabled);context.setPose({position,target});context.setTime(op.worldStart);
  const limit=performance.now()+20000;
  while(true){
   const snapshot=await queued(op,()=>{context.renderAt(op.worldStart);return state();});
   assert(op);if(ready(snapshot)){auditCaster(op);return snapshot;}
   if(performance.now()>=limit)throw Error('P2 resources not ready within 20 seconds');
   await wait(100,op.abort.signal);
  }
 }
 async function stations(offscreen=false,lift=0){
  const op=begin('stations',{offscreen,lift});if(!op)return;
  try{
   const positions=plan.stations.map(row=>({...row,position:eye(row.position[0],row.position[2]),targetId:'ground'}));
   const rows=offscreen?[{distance:null,position:eye(...plan.offscreenCameraXZ),targetId:'ground'}]:lift?positions.filter(row=>[80,112].includes(row.distance)).map(row=>({...row,position:row.position.map((n,i)=>i===1?n+lift:n),targetId:'casterCrown'})):positions.concat(positions.filter(row=>[80,112].includes(row.distance)).map(row=>({...row,targetId:'casterCrown'})));
   for(const row of rows)for(const enabled of [false,true]){
    auditCaster(op);let target=targets()[row.targetId];
    await prepare(op,row.position,target,enabled);
    target=targets()[row.targetId];
    const result=await queued(op,()=>{
     context.setPose({position:row.position,target});context.renderAt(op.worldStart);auditCaster(op);
     const snapshot=state(),result={kind:'station',targetId:row.targetId,diagnosticEyeLift:lift,horizontalDistanceLabel:row.distance,actualCasterDistance:Math.hypot(...row.position.map((n,i)=>n-targets().casterRoot[i])),shadowMode:enabled?'candidate':'legacy',state:snapshot,probes:probes(),skyCache:snapshot.skyCache,foliageCoverage:snapshot.foliageCoverage,treeWindTime:snapshot.vegetation?.treeWindTime,casterAudit:op.casterRecord,trees:context.props.auditTrees?.({position:row.position,radius:180,limit:96}),treeAuditCaveat:'nearSelected/nearColourEligible describe colour eligibility; inspect casterCPUEligible/casterInstalled independently',shadowMatrix:context.sun.shadow.matrix.toArray(),image:canvas.toDataURL('image/png')};
     context.setPaused(true);return result;
    });
    assert(op);op.stills.push({targetId:row.targetId,horizontalDistanceLabel:row.distance,shadowMode:result.shadowMode,probes:result.probes,casterAudit:op.casterRecord,source:result.state.build});
    await post(unique((offscreen?'offscreen':String(row.distance))+(lift?'-lift'+lift:'')+'-'+row.targetId+'-'+result.shadowMode),result,op.abort.signal);
   }
   await finish(op,'station A/B complete',true);
  }catch(error){await finish(op,'station A/B interrupted',false,error);}
 }
 async function rail(kind,enabled,edge=null,lift=0){
  const op=begin(kind,{capture:true,videoName:unique(kind+'-'+(enabled?'candidate':'legacy')+'-video'),duration:edge?10:12,enabled});if(!op)return;
  try{
   const target=kind==='wind-stationary'?context.camera.position.clone().add(context.camera.getWorldDirection(new T.Vector3())).toArray():targets().casterCrown;
   const points=kind==='wind-stationary'?[camera.position.toArray(),camera.position.toArray()]:edge?edge.xz.map(([x,z])=>eye(x,z)):[80,112].map(distance=>{const row=plan.stations.find(s=>s.distance===distance);return eye(row.position[0],row.position[2]);});
   if(lift)for(const point of points)point[1]+=lift;
   let aim=edge?targets().ground:target;
   op.points=points;op.target=aim;op.edge=edge;op.plan={...op.plan,points,target:aim,diagnosticEyeLift:lift,plannedEdge:edge?.plannedEdge??null,shadowMode:enabled?'candidate':'legacy'};
   await prepare(op,points[0],aim,enabled);assert(op);
   if(kind!=='wind-stationary')aim=edge?targets().ground:targets().casterCrown;
   op.target=aim;op.plan.target=aim;
   await queued(op,()=>{context.setPose({position:points[0],target:aim});context.renderAt(op.worldStart);});assert(op);
   op.before=state();op.phase='rail';op.startedAt=context.now();context.setTime(op.worldStart);
   recorder.setPaused(false);if(!recorder.arm({wallLimitMs:(op.duration+6)*1000,byteLimit:18000000}))throw Error('P2 recorder already owns a capture');
   op.captureArmed=true;
   message('P2 录制 '+op.duration+' 秒 · diagnostic-rail · '+(enabled?'candidate':'legacy'));
  }catch(error){await finish(op,'rail preparation failed',false,error);}
 }
 // P3: fixed physical routes, normal active time. Media is never timing evidence.
 async function continuityRail(kind,enabled=true,frozen=false){
  const op=begin('p3-'+kind,{capture:true,videoName:unique('p3-'+kind+'-'+(enabled?'candidate':'legacy')+(frozen?'-frozen':'')+'-video'),duration:kind==='cloud-flight'?8:kind==='leaves'?16:12,enabled});if(!op)return;
  try{
   let target,points,tree=null;
   if(kind==='cloud-flight'){
    points=[[-2037.53,350,-705],[-2037.53,350,-1305]];target=[-2037.53,800,-2305];
   }else{
    tree=context.props.auditTrees({position:[-1969.27,21,-560],radius:180,limit:4096}).records.find(r=>r.species!==2);
    if(!tree)throw Error('P3 real near needle tree unavailable');
    const l=context.sun.position.clone().sub(context.sun.target.position).normalize();
    target=[tree.root[0],tree.root[1]+tree.scale[1]*.55,tree.root[2]];
    if(kind==='leaves')points=[14,8].map(d=>new T.Vector3(...target).addScaledVector(l,-d).toArray());
    else{
     const y=tree.scale[1]*.55;target=[tree.root[0]-l.x*y/l.y,0,tree.root[2]-l.z*y/l.y];target[1]=context.heightAt(target[0],target[2])+.04;
     const eye=[target[0]+8,target[1]+6,target[2]-8];points=[eye,[...eye]];
    }
    for(const p of points)p[1]=Math.max(p[1],context.heightAt(p[0],p[2])+2);
   }
   op.points=points;op.target=target;op.foliageTree=tree;op.plan={kind,points,target,tree,enabled,frozen,clock:'active-wall',speedMetresPerSecond:kind==='cloud-flight'?150:kind==='leaves'?.75:0,claim:'diagnostic camera route; not ground walking or GPU timing'};
   const cloudGeneration=state().skyCache.completed;
   await prepare(op,points[0],target,true);assert(op);
   if(kind==='cloud-flight'){
    const deadline=performance.now()+8000;
    while(state().skyCache.completed<=cloudGeneration||state().skyCache.publishedRevision!==state().skyCache.revision){
     assert(op);if(performance.now()>deadline)throw Error('P3 cloud origin did not publish before flight');
     await wait(80,op.abort.signal);
    }
   }
   context.setFoliageCoverage?.(enabled);context.props.setTreeWindTime?.(frozen?op.worldStart:null);
   await queued(op,()=>{context.setPose({position:points[0],target});context.renderAt(op.worldStart);});assert(op);
   op.before=state();op.phase='rail';op.startedAt=context.now();context.setTime(op.worldStart);
   recorder.setPaused(false);if(!recorder.arm({wallLimitMs:(op.duration+6)*1000,byteLimit:24000000}))throw Error('P3 recorder busy');op.captureArmed=true;
   message('P3 '+kind+' · '+(enabled?'candidate':'legacy')+(frozen?' · tree wind frozen':'')+' · '+op.duration+' 秒');
  }catch(error){await finish(op,'P3 preparation failed',false,error);}
 }
 async function leafComparison(kind='current'){
  const op=begin('leaf-compare');if(!op)return;
  try{
   let position=camera.position.toArray(),target=camera.position.clone().add(camera.getWorldDirection(new T.Vector3())).toArray(),tree=null;
   if(kind!=='current'){
    const rows=context.props.auditTrees({position:kind==='fan'?[-1969.27,21,-560]:position,radius:600,limit:4096}).records;
    tree=rows.find(r=>kind==='fan'?r.species===2:r.species!==2);
    if(!tree)throw Error('No actual '+kind+' tree in review window');
    target=[tree.root[0],tree.root[1]+tree.scale[1]*(kind==='fan'?.72:.55),tree.root[2]];
    const l=context.sun.position.clone().sub(context.sun.target.position).normalize();
    position=new T.Vector3(...target).addScaledVector(l,kind==='fan'?-5:-14).toArray();
    position[1]=Math.max(position[1],context.heightAt(position[0],position[2])+2);
   }
   await prepare(op,position,target,true);
   for(const enabled of [false,true]){
    const result=await queued(op,()=>{setLeafTransmission(enabled);context.renderAt(op.worldStart);const snapshot=state();if(snapshot.programErrors)throw Error('Leaf shader failed');context.setPaused(true);return{kind:'leaf-compare',leafKind:kind,tree,enabled,state:snapshot,image:canvas.toDataURL('image/png')};});
    assert(op);op.stills.push({kind,enabled,source:result.state.build});
    await post(unique('leaf-'+kind+'-'+(enabled?'on':'off')),result,op.abort.signal);
   }
   await finish(op,'leaf A/B complete',true);
  }catch(error){await finish(op,'leaf A/B interrupted',false,error);}
 }
 // P4 failures and matched capture protocol: phase4/edge-e2e-plan.md.
 async function edgeComparison(view='below'){
  const op=begin('p4-fan-edges');if(!op)return;
  try{
   if(state().quality!=='high')throw Error('P4 AO comparison requires high quality');
   const cloudGeneration=state().skyCache.completed;
   const tree=context.props.auditTrees({position:[-1969.27,21,-560],radius:600,limit:4096}).records.find(r=>r.species===2);
   if(!tree)throw Error('P4 actual fan tree unavailable');
   const target=[tree.root[0],tree.root[1]+tree.scale[1]*.72,tree.root[2]],l=context.sun.position.clone().sub(context.sun.target.position).normalize();
   const position=new T.Vector3(...target).addScaledVector(l,view==='above'?5:-5).toArray();position[1]=Math.max(position[1],context.heightAt(position[0],position[2])+2);
   await prepare(op,position,target,true);context.setFoliageCoverage(true);
   const cloudDeadline=performance.now()+8000;
   while(state().skyCache.completed<=cloudGeneration||state().skyCache.pending||state().skyCache.publishedRevision!==state().skyCache.revision){
    assert(op);if(performance.now()>cloudDeadline)throw Error('P4 current sky cache not settled');await wait(80,op.abort.signal);
   }
   context.sky.setFrozen(true);const skySignature=JSON.stringify(state().skyCache);
   op.plan={kind:'real-fan-edge-factorial',view,tree,position,target,time:op.worldStart,cases:['old-ao','safe-ao','old-noao','safe-noao'],claim:'static material diagnosis, not temporal or performance acceptance'};
   for(const disableAO of [false,true])for(const safe of [false,true]){
    const result=await queued(op,()=>{
     setFoliageEdgeSafe(safe);context.water.setDiagnostic({disableAO});context.setPose({position,target});context.renderAt(op.worldStart);const snapshot=state();
     if(!ready(snapshot)||JSON.stringify(snapshot.skyCache)!==skySignature)throw Error('P4 resources, shader or frozen sky changed');
     context.setPaused(true);return{kind:'p4-fan-edge-case',view,safe,disableAO,tree,state:snapshot,image:canvas.toDataURL('image/png')};
    });
    op.stills.push({safe,disableAO,position:result.state.position,time:result.state.worldTime,drawSize:result.state.drawSize,source:result.state.build});
    await post(unique('p4-fan-'+(safe?'safe':'old')+'-'+(disableAO?'noao':'ao')),result,op.abort.signal);
   }
   await queued(op,()=>{setFoliageEdgeSafe(true);context.water.setDiagnostic();context.resetModes();context.renderAt(op.worldStart);context.setPaused(true);});
   await finish(op,'four matched fan edge cases saved',true);
  }catch(error){await finish(op,'P4 fan edge diagnosis interrupted',false,error);}
 }
 // Explicit symptom fixture from ordinary navigation; no production shader cost.
 // Failure inventory: phase5/FAILURES.md. Each case changes one source of light
 // or coverage only; keeping the actual cliff-side pose is essential.
 async function cliffComparison(){
  const op=begin('p5-cliff-edges',{worldStart:251.41440000002385});if(!op)return;
  const cases=[['baseline',0,false,true,true],['old-ramp',0,false,false,true],['no-ao',0,true,true,true],['no-specular',1,false,true,true],['no-leaf-haze',2,false,true,true],['hard-mask',0,false,true,false],['no-shadow',0,false,true,true]];
  try{
   if(state().quality!=='high')throw Error('P5 requires high quality');
   const position=[-1992.2741577194247,44.56824094669904,-536],q=new T.Quaternion(-.003917144638347342,-.9281428491432816,.009771327973724072,-.3720752997871584);
   const target=new T.Vector3(0,0,-1).applyQuaternion(q).add(new T.Vector3(...position)).toArray(),cloudGeneration=state().skyCache.completed;
   await prepare(op,position,target,true);context.setFoliageCoverage(true);
   const deadline=performance.now()+8000;
   while(state().skyCache.completed<=cloudGeneration||state().skyCache.pending||state().skyCache.publishedRevision!==state().skyCache.revision){assert(op);if(performance.now()>deadline)throw Error('P5 sky not settled');await wait(80,op.abort.signal);}
   context.sky.setFrozen(true);const skySignature=JSON.stringify(state().skyCache),mode={value:0},materials=new Map(),shadowIntensity=context.sun.shadow.intensity;
   context.props.group.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(!m.userData?.treeLeafKind||materials.has(m))continue;
    const original=m.onBeforeCompile,key=m.customProgramCacheKey;materials.set(m,{original,key,alphaToCoverage:m.alphaToCoverage});
    m.onBeforeCompile=s=>{original.call(m,s);s.uniforms.leafDiagnosticMode=mode;
     s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform int leafDiagnosticMode;')
      .replace('#include <opaque_fragment>','if(leafDiagnosticMode==1)outgoingLight-=reflectedLight.directSpecular+reflectedLight.indirectSpecular;\n#include <opaque_fragment>')
      .replace('gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,clamp(extinction,0.,.98));','if(leafDiagnosticMode!=2)gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,clamp(extinction,0.,.98));');};
    m.customProgramCacheKey=()=>key.call(m)+'-p5-light-isolation';m.needsUpdate=true;
   }});
   if(!materials.size)throw Error('P5 no real near-leaf materials');
   leafDiagnosticRestore=()=>{for(const [m,old]of materials){m.onBeforeCompile=old.original;m.customProgramCacheKey=old.key;m.alphaToCoverage=old.alphaToCoverage;m.needsUpdate=true;}context.sun.shadow.intensity=shadowIntensity;};
   op.plan={kind:'cliff-reproduction',position,target,time:op.worldStart,leafMaterials:materials.size,cases:cases.map(c=>c[0]),scope:'actual near leaves only for specular/haze/A2C; no-shadow affects all live-map receivers; media is not GPU timing'};
   for(const [label,lightMode,disableAO,safe,a2c]of cases){
    const result=await queued(op,()=>{
     mode.value=lightMode;setFoliageEdgeSafe(safe);context.water.setDiagnostic({disableAO});context.sun.shadow.intensity=label==='no-shadow'?0:shadowIntensity;
     for(const m of materials.keys())if(m.alphaToCoverage!==a2c){m.alphaToCoverage=a2c;m.needsUpdate=true;}
     context.setPose({position,target});context.renderAt(op.worldStart);const snapshot=state();
     if(!ready(snapshot)||JSON.stringify(snapshot.skyCache)!==skySignature)throw Error('P5 state/shader changed');
     context.setPaused(true);return{kind:'p5-cliff-edge-case',label,lightMode,disableAO,safe,a2c,leafMaterials:materials.size,shadowIntensity:context.sun.shadow.intensity,state:snapshot,image:canvas.toDataURL('image/png')};
    },15000);
    op.stills.push({label,source:result.state.build});await post(unique('p5-cliff-'+label),result,op.abort.signal);
   }
   await queued(op,()=>{leafDiagnosticRestore();leafDiagnosticRestore=null;setFoliageEdgeSafe(true);context.water.setDiagnostic();context.resetModes();context.renderAt(op.worldStart);context.setPaused(true);});
   await finish(op,'seven cliff-side cases saved',true);
  }catch(error){await finish(op,'P5 cliff diagnosis interrupted',false,error);}
 }
 async function displayComparison(){
  const op=begin('p5-display-alpha',{worldStart:251.41440000002385});if(!op)return;
  try{
   const position=[-1992.2741577194247,44.56824094669904,-536],q=new T.Quaternion(-.003917144638347342,-.9281428491432816,.009771327973724072,-.3720752997871584),target=new T.Vector3(0,0,-1).applyQuaternion(q).add(new T.Vector3(...position)).toArray();
   const generation=state().skyCache.completed;await prepare(op,position,target,true);
   const deadline=performance.now()+8000;
   while(state().skyCache.completed<=generation||state().skyCache.pending||state().skyCache.publishedRevision!==state().skyCache.revision){assert(op);if(performance.now()>deadline)throw Error('P5 sky not settled');await wait(80,op.abort.signal);}
   context.sky.setFrozen(true);const signature=JSON.stringify(state().skyCache),output=context.water.auditMaterials().output,original=output?.fragmentShader,opaque={value:0};
   if(!output||!original.includes('#include <colorspace_fragment>'))throw Error('P5 linear display output unavailable');
   output.uniforms.displayAuditOpaque=opaque;
   // Also supports the final corrected shader, retaining an exact legacy arm.
   output.fragmentShader='uniform float displayAuditOpaque;\n'+original.replace('gl_FragColor.a=1.;','').replace('#include <colorspace_fragment>','#include <colorspace_fragment>\nif(displayAuditOpaque>.5)gl_FragColor.a=1.;');output.needsUpdate=true;
   displayDiagnosticRestore=()=>{output.fragmentShader=original;delete output.uniforms.displayAuditOpaque;output.needsUpdate=true;};
   const targetRT=context.water.resources().find(([name])=>name==='linearComposite')?.[1];if(!targetRT)throw Error('P5 composite unavailable');
   const previous=new Uint16Array(targetRT.width*targetRT.height*4),current=new Uint16Array(previous.length);
   op.plan={kind:'opaque-display-only',position,target,time:op.worldStart,readbackBytes:previous.byteLength*2,productionExtraTargets:0};
   for(const fixed of [false,true]){
    const result=await queued(op,()=>{
     opaque.value=fixed?1:0;context.setPose({position,target});context.renderAt(op.worldStart);const snapshot=state();
     if(!ready(snapshot)||JSON.stringify(snapshot.skyCache)!==signature)throw Error('P5 display state changed');
     const buf=fixed?current:previous;renderer.readRenderTargetPixels(targetRT,0,0,targetRT.width,targetRT.height,buf);
     const pixels=document.createElement('canvas');pixels.width=canvas.width;pixels.height=canvas.height;const c=pixels.getContext('2d');c.drawImage(canvas,0,0);const rgba=c.getImageData(0,0,pixels.width,pixels.height).data;
     let nonOpaque=0,minAlpha=255;for(let i=3;i<rgba.length;i+=4){minAlpha=Math.min(minAlpha,rgba[i]);if(rgba[i]!==255)nonOpaque++;}
     let different=0;if(fixed)for(let i=0;i<current.length;i++)if(current[i]!==previous[i])different++;
     context.setPaused(true);return{kind:'p5-display-alpha-case',fixed,state:snapshot,nonOpaque,minAlpha,linearCompositeDifferentChannels:fixed?different:null,readbackBytes:buf.byteLength,image:canvas.toDataURL('image/png')};
    },15000);
    op.stills.push({fixed,nonOpaque:result.nonOpaque,minAlpha:result.minAlpha,linearCompositeDifferentChannels:result.linearCompositeDifferentChannels,source:result.state.build});await post(unique('p5-display-'+(fixed?'opaque':'legacy')),result,op.abort.signal);
   }
   const [a,b]=op.stills;op.plan.checks={legacyReproducesTransparentPixels:a.nonOpaque>0,finalSceneOpaque:b.nonOpaque===0&&b.minAlpha===255,internalRGBAUnchanged:b.linearCompositeDifferentChannels===0};
   await queued(op,()=>{displayDiagnosticRestore();displayDiagnosticRestore=null;context.resetModes();context.renderAt(op.worldStart);context.setPaused(true);});
   await finish(op,Object.values(op.plan.checks).every(Boolean)?'display-alpha cause verified':'display-alpha checks failed',Object.values(op.plan.checks).every(Boolean));
  }catch(error){await finish(op,'P5 display diagnosis interrupted',false,error);}
 }
 let p8TreeFixture=null;
 function p6Pose(kind,distance=96){
  if(kind==='tree'){
   const sun=context.sun.position.clone().sub(context.sun.target.position).normalize(),horizontal=Math.hypot(sun.x,sun.z),dx=sun.x/horizontal,dz=sun.z/horizontal;
   const poseFor=(tree,d)=>{const [x,y,z]=tree.root,cx=x+dx*d,cz=z+dz*d;return{position:[cx,Math.max(context.heightAt(cx,cz)+3,y+tree.scale[1]*.5),cz],target:[x,y+tree.scale[1]*.67,z],tree};};
   if(!p8TreeFixture){
    // Explicit fixture selected once from the region audit, then visually
    // checked for terrain/other-tree occlusion. Never rescore the whole forest
    // synchronously in a browser input event.
    const root=[-1655.834796326235,213.1652344337568,-710.6541914292611];
    p8TreeFixture=context.props.auditTrees({position:root,radius:1,limit:8}).records.find(tree=>tree.id===69639);
    if(!p8TreeFixture)throw Error('P8 validated sun-facing fixture missing');
   }
   return poseFor(p8TreeFixture,distance);
  }
  if(kind==='shadow'){
   const direction=context.sun.position.clone().sub(context.sun.target.position).normalize();
   const audit=context.props.auditTrees({position:[-1969.274,21,-560],radius:160,limit:512});
   for(const tree of audit.records){
    const [rx,ry,rz]=tree.root,h=tree.scale[1];if(h<18)continue;
    let x=rx-direction.x/direction.y*h*.6,z=rz-direction.z/direction.y*h*.6;
    for(let n=0;n<3;n++){const fall=Math.max(0,ry+h*.6-context.heightAt(x,z));x=rx-direction.x/direction.y*fall;z=rz-direction.z/direction.y*fall;}
    const ground=context.heightAt(x,z),water=waterLevelAt(x,z),cx=x-2,cz=z-14,cy=context.heightAt(cx,cz)+3;
    if(ground<=water+.6||context.heightAt(cx,cz)<=waterLevelAt(cx,cz)+.6||Math.abs(cy-3-ground)>5)continue;
    return{position:[cx,cy,cz],target:[x,ground,z],receiver:{point:[x,ground,z],waterHeight:water,clearance:ground-water,caster:tree}};
   }
   throw Error('P8 no verified dry shadow receiver');
  }
  const x=-1980,z=-593;return{position:[x,context.heightAt(x,z)+1.8,z],target:[-2010,context.heightAt(-2010,-535)+1,-535]};
 }
 function p6OwnModes(){const original=context.getVegetationCandidate();candidateRestore=()=>context.setVegetationCandidate(original);}
 async function p6Stills(kind='grass'){
  const op=begin('p8-stills',{worldStart:60});if(!op)return;p6OwnModes();
  try{
   const rows=kind==='tree'?[140,112,100,96,80,60,45]:[96];
   const modes=kind==='tree'?[['baseline',false],['candidate',true]]:[['baseline',false],['ground',{lighting:false,ground:true,blades:false,temporal:false,nearShadow:false}],['blades',{lighting:false,ground:false,blades:true,temporal:false,nearShadow:false}],['candidate',true]];
   op.plan={kind,distances:rows,modes:modes.map(row=>row[0]),claim:'matched fixed-time images; no timing or all-motion claim'};
   for(const distance of rows)for(const [label,profile]of modes){
    context.sky.setFrozen(false);context.setVegetationCandidate(profile);const pose=p6Pose(kind,distance);await prepare(op,pose.position,pose.target,true);
    const skyDeadline=performance.now()+8000;while(state().skyCache.pending||state().skyCache.publishedRevision!==state().skyCache.revision){assert(op);if(performance.now()>skyDeadline)throw Error('P8 sky did not settle');await wait(80,op.abort.signal);}context.sky.setFrozen(true);
    for(let n=0;n<12;n++)await queued(op,()=>context.renderAt(op.worldStart));
    const result=await queued(op,()=>{context.renderAt(op.worldStart);const snapshot=state();if(snapshot.programErrors)throw Error('P8 shader error');return{kind:'p8-still',subject:kind,distance,mode:label,state:snapshot,image:canvas.toDataURL('image/png')};});
    await post(unique('p8-'+kind+'-'+distance+'-'+label),result,op.abort.signal);op.stills.push({subject:kind,distance,mode:label});
   }
   await finish(op,'P8 matched stills saved',true);
  }catch(error){await finish(op,'P8 still comparison interrupted',false,error);}
 }
 async function p6Rail(kind,enabled){
  const duration=kind==='tree'?16:10,op=begin('p8-'+kind+'-motion',{worldStart:60,capture:true,videoName:unique('p8-'+kind+'-'+(enabled?'candidate':'baseline')+'-video'),duration,fixedWorldTime:kind==='tree'});if(!op)return;p6OwnModes();
  try{
   context.setVegetationCandidate(enabled);const pose=p6Pose(kind,140),b=kind==='tree'?p6Pose(kind,45).position:kind==='grass'?[pose.position[0]+2.4,pose.position[1],pose.position[2]+1.2]:[...pose.position];
   op.points=[pose.position,b];op.target=pose.target;op.plan={kind,candidate:enabled,receiver:pose.receiver??null,points:op.points,target:op.target,fixedWorldTime:op.fixedWorldTime,tree:pose.tree??null,claim:'diagnostic route; video excluded from timing'};
   await prepare(op,pose.position,pose.target,true);
   for(let n=0;n<12;n++)await queued(op,()=>context.renderAt(op.worldStart));
   if(kind==='tree')context.sky.setFrozen(true);
   op.before=state();op.phase='rail';op.startedAt=context.now();context.setTime(op.worldStart);
   recorder.setPaused(false);if(!recorder.arm({wallLimitMs:(duration+6)*1000,byteLimit:22000000}))throw Error('P8 recorder busy');op.captureArmed=true;
   message('P8 '+kind+' '+(enabled?'试验版':'原版')+' · '+duration+' 秒');
  }catch(error){await finish(op,'P8 motion interrupted',false,error);}
 }
 async function p6Timing(enabled){
  const s=state();if(s.workload.targetFps!==60){message('P8 计时需要有界60 FPS入口 desktopTier=pace&desktopTrial=1');return;}
  const op=begin('p8-timing',{worldStart:60,duration:16,timing:true,timingSamples:[],capture:false});if(!op)return;p6OwnModes();
  try{
   context.setVegetationCandidate(enabled);const pose=p6Pose('grass');
   op.points=[pose.position,[pose.position[0]+2.4,pose.position[1],pose.position[2]+1.2]];op.target=pose.target;
   op.plan={candidate:enabled,warmupSeconds:6,sampleSeconds:10,clock:'active-wall',claim:'submission cadence only; no GPU timer, media or pixel readback'};
   await prepare(op,pose.position,pose.target,true);op.before=state();op.phase='rail';op.startedAt=context.now();context.setTime(op.worldStart);message('P8 独立计时 · 6 秒预热 + 10 秒采样');
  }catch(error){await finish(op,'P8 timing interrupted',false,error);}
 }
 // P7: lossless consecutive frames, fixed output pixels; never a FPS sample.
 async function p7Burst(subject){
  const op=begin('p8-'+subject,{worldStart:60,clock:'explicit-per-case-world-time'});if(!op)return;p6OwnModes();
  const oldShadow=context.sun.shadow.intensity;
  p7DiagnosticRestore=()=>{context.props.setDiagnosticGrass(false);context.sun.shadow.intensity=oldShadow;};
  try{
   context.setVegetationCandidate(false);const pose=p6Pose(subject==='shadow'?'shadow':'grass');
   await prepare(op,pose.position,pose.target,true);
   const deadline=performance.now()+8000;
   while(state().skyCache.pending){assert(op);if(performance.now()>deadline)throw Error('P8 sky did not settle');await wait(80,op.abort.signal);}
   context.sky.setFrozen(true);
   const cases=subject==='jitter'?[
    {name:'baseline',profile:false},
    {name:'temporal-only',profile:{lighting:false,ground:false,blades:false,temporal:true,nearShadow:false}},
    {name:'p8',profile:true},
   ]:subject==='shadow'?[
    {name:'static-shadow',grassOff:true,shadow:1,advance:false},
    {name:'wind-shadow',grassOff:true,shadow:1,advance:true},{name:'wind-shadow-p8',grassOff:true,shadow:1,advance:true,profile:true},{name:'wind-shadow-chroma',grassOff:true,shadow:1,advance:true,profile:{lighting:true,ground:false,blades:true,temporal:true,nearShadow:false,shadowFootprint:true,temporalChroma:true}},
    {name:'wind-no-shadow',grassOff:true,shadow:0,advance:true},
   ]:[
    {name:'camera-grass',grassOff:false,shadow:0,move:true},{name:'camera-grass-p8',grassOff:false,shadow:0,move:true,profile:true},
    {name:'camera-no-grass',grassOff:true,shadow:0,move:true},
    {name:'camera-ground-filter',grassOff:true,shadow:0,move:true,profile:{lighting:false,ground:true,blades:false,temporal:false,nearShadow:false}},
   ];
   op.plan={subject,pose,framesPerCase:16,roi:{x:0,y:.55,width:1,height:.45},cases:cases.map(c=>c.name),results:[],interpretation:'Consecutive lossless diagnostic frames; variation with physical motion is not a flicker score. Sky frozen; shadow/grass controls restored. No timing claims.'};
   const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const c=copy.getContext('2d',{willReadFrequently:true});
   for(const row of cases){
    context.setVegetationCandidate(row.profile??false);context.props.setDiagnosticGrass(Boolean(row.grassOff));context.sun.shadow.intensity=row.shadow??1;
    context.water.setDiagnostic({disableAO:subject!=='jitter'});context.setPose(pose);
    for(let i=0;i<16;i++)await queued(op,()=>context.renderAt(60));
    const pixels=[],states=[];
    for(let i=0;i<16;i++){
     const position=pose.position.map((v,j)=>v+(row.move&&j===0?i*.015:0));
     await queued(op,()=>{context.setPose({position,target:pose.target});const st=context.renderAt(60+(row.advance?i/30:0));if(st.programErrors)throw Error('P8 shader error');c.drawImage(canvas,0,0);pixels.push(c.getImageData(0,0,copy.width,copy.height));states.push({position:st.position,time:st.worldTime,temporal:st.flow.temporal,sky:st.skyCache,shadow:st.shadow,wind:st.vegetation.treeWindTime,grassOff:st.vegetation.diagnosticGrass,profile:st.vegetationCandidate});});
    }
    const changes=[];const y0=Math.floor(copy.height*.55);
    for(let i=1;i<pixels.length;i++){let total=0,changed=0,ground=0,groundChanged=0,maximum=0;const a=pixels[i-1].data,b=pixels[i].data;
     for(let k=0;k<a.length;k+=4){const d=Math.max(Math.abs(a[k]-b[k]),Math.abs(a[k+1]-b[k+1]),Math.abs(a[k+2]-b[k+2]));total+=d;if(d>2)changed++;maximum=Math.max(maximum,d);if(k>=y0*copy.width*4){ground+=d;if(d>2)groundChanged++;}}
     changes.push({frame:i,meanMaxRGB:total/(copy.width*copy.height),changedPixelsAbove2:changed,maximum,groundMeanMaxRGB:ground/(copy.width*(copy.height-y0)),groundChangedPixelsAbove2:groundChanged});
    }
    const result={name:row.name,source:state().build,size:[copy.width,copy.height],controls:row,states,changes};op.plan.results.push(result);
    for(let i=0;i<16;i++){c.putImageData(pixels[i],0,0);await post(unique('p8-'+subject+'-'+row.name+'-'+String(i).padStart(2,'0')),{kind:'p8-consecutive-frame',frame:i,case:row.name,subject,state:states[i],source:result.source,image:copy.toDataURL('image/png')},op.abort.signal);}
    op.stills.push({case:row.name,frames:16});message('P8 '+subject+' · '+row.name+' 已保存');
   }
   await finish(op,'P8 consecutive-frame evidence saved',true);
  }catch(error){await finish(op,'P8 consecutive-frame evidence interrupted',false,error);}
 }
 async function p6HistoryChecks(){
  const op=begin('p8-history',{worldStart:60});if(!op)return;p6OwnModes();
  try{
   context.setVegetationCandidate(true);const pose=p6Pose('grass');await prepare(op,pose.position,pose.target,true);
   const projection=camera.projectionMatrix.clone(),inverse=camera.projectionMatrixInverse.clone();
   for(let n=0;n<12;n++)await queued(op,()=>context.renderAt(op.worldStart));
   const seeded=state();
   const pixels=await queued(op,()=>{context.renderAt(op.worldStart);const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const c=copy.getContext('2d',{willReadFrequently:true});c.drawImage(canvas,0,0);const data=c.getImageData(0,0,copy.width,copy.height).data;let nonOpaque=0;for(let i=3;i<data.length;i+=4)if(data[i]!==255)nonOpaque++;return{nonOpaque,bytes:data.length};});
   const moved=pose.position.map((v,i)=>v+(i===0?24:0));context.setPose({position:moved,target:pose.target});const cut=await queued(op,()=>context.renderAt(op.worldStart));
   context.setVegetationCandidate(false);const off=await queued(op,()=>context.renderAt(op.worldStart));
   const checks={historyAllocated:seeded.flow.temporal.targets===2,historyReused:seeded.flow.temporal.historyEligibleFrames>0,opaque:pixels.nonOpaque===0,projectionRestored:camera.projectionMatrix.equals(projection)&&camera.projectionMatrixInverse.equals(inverse),cameraCutResets:(cut.flow.temporal.resetCounts['camera cut']??0)>0,disabledReleases:off.flow.temporal.targets===0,noShaderErrors:!seeded.programErrors&&!cut.programErrors&&!off.programErrors};
   op.plan={checks,pixels,seeded:seeded.flow.temporal,cut:cut.flow.temporal,disabled:off.flow.temporal};op.stills.push({kind:'history-checks',checks});if(!Object.values(checks).every(Boolean))throw Error('P8 history checks failed');await finish(op,'P8 history checks passed',true);
  }catch(error){await finish(op,'P8 history interrupted',false,error);}
 }
 async function cliffMotion(wind=false){
  const op=begin('p5-cliff-motion',{worldStart:251.41440000002385,capture:true,videoName:unique('p5-cliff-'+(wind?'wind':'camera')+'-video'),duration:8,fixedWorldTime:!wind});if(!op)return;
  try{
   if(!context.water.auditMaterials().output.fragmentShader.includes('gl_FragColor.a=1.;'))throw Error('P5 motion requires opaque presentation so video matches the browser');
   const a=[-1992.2741577194247,44.56824094669904,-536],q=new T.Quaternion(-.003917144638347342,-.9281428491432816,.009771327973724072,-.3720752997871584);
   const target=new T.Vector3(0,0,-100).applyQuaternion(q).add(new T.Vector3(...a)).toArray(),b=wind?[...a]:[a[0]-.75,a[1],a[2]+.75];
   op.points=[a,b];op.target=target;op.plan={kind:wind?'stationary-wind':'camera-only',points:op.points,target,worldStart:op.worldStart,fixedWorldTime:!wind,claim:'opaque-display diagnostic motion; no ground-navigation or timing acceptance'};
   await prepare(op,a,target,true);
   const deadline=performance.now()+8000;
   // Reusing this exact pose/time can already be settled after the static A/B.
   // A clean cache has no reason to publish another generation.
   while(!state().skyCache.ready||state().skyCache.pending||state().skyCache.publishedRevision!==state().skyCache.revision){assert(op);if(performance.now()>deadline)throw Error('P5 motion sky not settled');await wait(80,op.abort.signal);}
   if(!wind)context.sky.setFrozen(true);op.plan.skyFrozen=!wind;op.before=state();op.phase='rail';op.startedAt=context.now();context.setTime(op.worldStart);
   recorder.setPaused(false);if(!recorder.arm({wallLimitMs:14000,byteLimit:18000000}))throw Error('P5 recorder busy');op.captureArmed=true;
   message('P5 '+(wind?'静止观察树风':'冻结世界慢移相机')+' · 8 秒');
  }catch(error){await finish(op,'P5 motion interrupted',false,error);}
 }
 async function leafFixture(){
  const op=begin('leaf-fixture');if(!op)return;
  try{
   const position=camera.position.toArray(),target=camera.position.clone().add(camera.getWorldDirection(new T.Vector3())).toArray();
   await prepare(op,position,target,true);
   const report=await queued(op,async()=>{
    context.setPaused(true);
    // Repeatable open-sun fixture: current camera + 40 m can still be under the
    // forest cliff's real terrain horizon, correctly suppressing every delta.
    return runLeafAudit({renderer,scene:context.scene,camera,sun:context.sun,props:context.props,water:context.water,renderAt:context.renderAt,setPose:context.setPose,getState:state,time:op.worldStart,position:[-2037.5304154034634,69.79699233893682,-705],signal:op.abort.signal,shouldContinue:()=>valid(op),onCase:async row=>{
     assert(op);if(row.state?.programErrors)throw Error('Leaf fixture shader failed');
     if(['clear-back','blocked-back'].includes(row.condition))await post(unique('leaf-fixture-'+row.kind+'-'+row.condition+'-'+(row.enabled?'on':'off')),{kind:'leaf-fixture-case',case:row,image:canvas.toDataURL('image/png')},op.abort.signal);
    }});
   },20000);
   assert(op);await queued(op,()=>{context.renderAt(op.worldStart);context.setPaused(true);});assert(op);report.ordinaryFrameRestored=true;report.resourceContract='resourcesUnchanged verifies existing water targets only; geometry/worker caches are recorded independently';op.stills.push({kind:'leaf-fixture',pass:report.pass});
   await post(unique('leaf-fixture-result'),{kind:'leaf-fixture',report,state:state()},op.abort.signal);
   await finish(op,report.pass?'leaf fixture passed':'leaf fixture assertions failed',report.pass);
  }catch(error){await finish(op,'leaf fixture interrupted',false,error);}
 }
 async function atlasComparison(){
  const op=begin('atlas-compare');if(!op)return;
  try{
   const position=camera.position.toArray(),target=camera.position.clone().add(camera.getWorldDirection(new T.Vector3())).toArray();
   await prepare(op,position,target,true);
   for(const enabled of [false,true]){
    const result=await queued(op,()=>{
     context.props.setForestAtlasBudget(enabled);
     context.props.beginForestContributionAudit({sampleStride:16,maxRecords:10000,maxSamples:40000});
     let audit,snapshot;try{context.renderAt(op.worldStart);snapshot=state();}finally{audit=context.props.endForestContributionAudit();context.setPaused(true);}
     if(snapshot.programErrors)throw Error('Atlas shader failed');
     return {kind:'atlas-compare',enabled,state:snapshot,audit,image:canvas.toDataURL('image/png'),interpretation:'Same pose/time, per-pass projected canopy policy; readback/audit excluded from timing'};
    });
    assert(op);op.stills.push({enabled,source:result.state.build});
    await post(unique('atlas-'+(enabled?'candidate':'legacy')),result,op.abort.signal);
   }
   await finish(op,'atlas A/B complete',true);
  }catch(error){await finish(op,'atlas A/B interrupted',false,error);}
 }
 async function contribution(){
  const op=begin('atlas-contribution');if(!op)return;
  try{
   if(typeof context.props.beginForestContributionAudit!=='function'||typeof context.props.endForestContributionAudit!=='function')throw Error('P2 forest contribution API unavailable');
   const result=await queued(op,()=>{
    let audit,snapshot;
    context.props.beginForestContributionAudit({sampleStride:16,maxRecords:10000,maxSamples:40000});
    try{context.renderAt(op.worldStart);snapshot=state();}
    finally{audit=context.props.endForestContributionAudit();context.setPaused(true);}
    return {kind:'atlas-contribution',state:snapshot,audit,interpretation:'Explicit bounded per-pass crown pixel estimate; no GPU timing or fragment read count measurement',image:canvas.toDataURL('image/png')};
   });
   assert(op);op.stills.push({kind:'atlas-contribution',source:result.state.build});
   await post(unique('atlas-contribution'),result,op.abort.signal);
   await finish(op,'contribution recorded',true);
  }catch(error){await finish(op,'contribution interrupted',false,error);}
 }
 function beforeFrame(){
  const op=operation;if(!op||!valid(op))return;
  // Fixed-time preparation must own the ordinary frame clock as well as queued
  // renders, otherwise every intervening frame invalidates the sky on rewind.
  if(op.phase!=='rail'){context.setTime(op.worldStart);return;}
  try{
   const seconds=(context.now()-op.startedAt)/1000,u=Math.min(1,Math.max(0,seconds/op.duration)),along=u<=.5?u*2:(1-u)*2;
   const a=op.points[0],b=op.points[1],position=a.map((n,i)=>n+(b[i]-n)*along);
   position[1]=Math.max(position[1],context.heightAt(position[0],position[2])+plan.eyeHeight);
   if(!position.every(Number.isFinite))throw Error('P2 invalid rail position');
   context.setPose({position,target:op.target});context.setTime(op.worldStart+(op.fixedWorldTime?0:seconds));op.elapsed=seconds;
  }catch(error){void finish(op,'rail pose failed',false,error);}
 }
 function afterFrame(){
  const op=operation;if(!op||op.phase!=='rail'||!valid(op))return;
  try{
   const s=state();if(s.programErrors||s.vegetation?.error||s.flow?.error)throw Error('P2 rendering/resource error');
   op.lastRendered=s;if(!op.timing)recorder.afterFrame();
   if(op.timing&&op.elapsed>=6){const now=context.now();if(op.lastTimingAt!==undefined)op.timingSamples.push(now-op.lastTimingAt);op.lastTimingAt=now;}
   if(op.timing&&op.elapsed>=op.duration){const sorted=[...op.timingSamples].sort((a,b)=>a-b),sum=sorted.reduce((a,b)=>a+b,0);op.plan.result={frames:sorted.length,elapsedMs:sum,submittedFps:sorted.length*1000/sum,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],minFPSCriterion:58,passes60:sorted.length*1000/sum>=58&&sorted[Math.floor(sorted.length*.95)]<=20,drawCalls:s.drawCalls,triangles:s.triangles,resources:s.resources,candidate:s.vegetationCandidate,temporal:s.flow.temporal,shadow:s.shadow};op.stills.push({kind:'timing-record-only',noImage:true});}
   if(op.samples.length<600&&(op.elapsed-(op.lastSampleAt??-Infinity)>=1/30||op.elapsed>=op.duration)){op.lastSampleAt=op.elapsed;op.samples.push({elapsed:op.elapsed,worldTime:s.worldTime,position:s.position,quaternion:s.quaternion,shadow:s.shadow,shadowMatrix:context.sun.shadow.matrix.toArray(),probes:(op.kind.startsWith('p3-')||op.kind.startsWith('p8-'))?[]:probes(),skyCache:s.skyCache,foliageCoverage:s.foliageCoverage,treeWindTime:s.vegetation?.treeWindTime,casterAudit:op.casterRecord,quality:s.quality,drawSize:s.drawSize,worldWind:s.vegetation?.time,reflectionTime:s.flow?.reflection?.lastTime,vegetationCandidate:s.vegetationCandidate,temporal:s.flow?.temporal});}
   if(op.elapsed>=op.duration)void finish(op,'rail complete',true);
  }catch(error){void finish(op,'rail render failed',false,error);}
 }
 function button(id,label,fn){const b=document.createElement('button');b.id=id;b.textContent=label;b.style.margin='3px';b.onclick=()=>{try{const result=fn();if(result?.catch)result.catch(error=>message(String(error)));}catch(error){message(String(error));}};panel.querySelector('div').append(b);}
 for(const [subject,label]of [['jitter','P8 静止画面逐帧归因'],['shadow','P8 干地风影逐帧隔离'],['grass','P8 草与地面慢移隔离']])button('p8-'+subject,label,()=>p7Burst(subject));
 for(const enabled of [false,true]){
  const suffix=enabled?'candidate':'legacy',label=enabled?'候选':'旧覆盖';
  button('p3-leaves-'+suffix,'P3 近叶慢行 · '+label,()=>continuityRail('leaves',enabled));
  button('p3-shadow-'+suffix,'P3 静止树影风 · '+label,()=>continuityRail('shadow',enabled));
 }
 button('p3-leaves-legacy-frozen','P3 近叶旧覆盖 · 冻结树风',()=>continuityRail('leaves',false,true));
 button('p3-leaves-frozen','P3 近叶慢行 · 冻结树风',()=>continuityRail('leaves',true,true));
 button('p3-shadow-frozen','P3 静止树影 · 冻结树风',()=>continuityRail('shadow',true,true));
 button('p3-cloud-flight','P3 云连续飞行 · 150 米/秒',()=>continuityRail('cloud-flight'));
 button('p2-stations','P2 45–140 m 六站 A/B',()=>stations());
 button('p2-lift-stations','P2 抬高 40 m 树冠 A/B',()=>stations(false,40));
 button('p2-lift-wind','P2 抬高树冠风 · 12 秒',()=>rail('wind-lod-lift',true,null,40));
 button('p2-offscreen','P2 离屏上游树 A/B',()=>stations(true));
 button('p2-wind-stationary','P2 当前视角风 · 12 秒',()=>rail('wind-stationary',true));
 button('p2-leaf-current','P2 当前视角近叶透光 A/B',()=>leafComparison());
 button('p2-leaf-needle','P2 针叶逆光 A/B',()=>leafComparison('needle'));
 button('p2-leaf-fan','P2 扇叶逆光 A/B',()=>leafComparison('fan'));
 button('p4-fan-edges','P4 扇叶白边 · 覆盖/AO 四组',()=>edgeComparison());
 button('p4-fan-edges-above','P4 树冠俯视 · 覆盖/AO 四组',()=>edgeComparison('above'));
 button('p5-cliff-edges','P5 岩壁阴面白边 · 七组隔离',()=>cliffComparison());
 button('p5-display-alpha','P5 页面合成透明度 A/B',()=>displayComparison());
 button('p8-grass-stills','P8 溪畔草地 · 四组隔离',()=>p6Stills('grass'));
 button('p8-tree-stills','P8 同树远近 · 七站对照',()=>p6Stills('tree'));
 for(const enabled of [false,true])button('p8-timing-'+enabled,'P8 溪畔独立计时 · '+(enabled?'试验版':'原版'),()=>p6Timing(enabled));
 button('p8-history','P8 跨帧恢复与不透明断言',p6HistoryChecks);
 for(const [kind,label]of [['grass','溪畔草地慢移'],['tree','同树远近过渡'],['shadow','近影静止看风']])for(const enabled of [false,true])button('p8-'+kind+'-'+enabled,'P8 '+label+' · '+(enabled?'试验版':'原版'),()=>p6Rail(kind,enabled));
 button('p5-cliff-camera','P5 岩壁树冠 · 仅相机慢移',()=>cliffMotion(false));
 button('p5-cliff-wind','P5 岩壁树冠 · 静止看风',()=>cliffMotion(true));
 button('p2-leaf-fixture','P2 叶片遮挡 HDR 断言',()=>leafFixture());
 button('p2-atlas-compare','P2 树冠采样 A/B',()=>atlasComparison());
 button('p2-atlas-contribution','P2 主图/镜面树冠贡献',()=>contribution());
 for(const enabled of [false,true]){
  button('p2-wind-'+(enabled?'candidate':'legacy'),'P2 80–112 m 风轨道 · '+(enabled?'凸交接':'旧交接'),()=>rail('wind-lod',enabled));
  for(const edge of plan.edges)button('p2-edge-'+edge.id+'-'+(enabled?'candidate':'legacy'),'P2 '+edge.id+' 边带轨道 · '+(enabled?'凸交接':'旧交接'),()=>rail('shadow-edge-'+edge.id,enabled,edge,plan.edgeEyeLift??0));
 }
 button('p2-stop','P2 停止并保留记录',()=>cancel('explicit stop'));
 const listen=(target,name,fn)=>{target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));};
 listen(window,'blur',()=>cancel('window blur'));
 listen(document,'visibilitychange',()=>{if(document.hidden)cancel('document hidden');});
 function contextLost(){if(terminal)return;terminal=true;cancel('graphics context lost');}
 listen(canvas,'webglcontextlost',contextLost);
 listen(window,'pagehide',()=>{cancel('pagehide');});
 return {get active(){return Boolean(operation);},beforeFrame,afterFrame,cancel,contextLost,
  get state(){return{active:Boolean(operation),kind:operation?.kind??null,phase:operation?.phase??null,terminal,recorder:recorder.state};},
  dispose(){if(disposed)return;cancel('disposed');disposed=true;terminal=true;listeners.forEach(remove=>remove());panel.remove();if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=null;},
 };
}
