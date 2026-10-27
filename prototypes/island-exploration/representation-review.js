// Headed E2E of the actual prototype. All evidence stays in the localhost sink.
import * as T from 'three';
import {treeSemanticEnabled,treeDebugView,treeRepresentation,treeReviewRoot,treeReviewRadius} from './tree-material.js';
import {makeShadowDiagnostics} from './shadow-diagnostics.js';
import {makeReviewRecorder} from './review-recorder.js';
const quantile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)*q)]:null;};
export function makeRepresentationReview(ctx){
 const panel=document.createElement('details');panel.id='representation-review';panel.open=true;panel.style.cssText='position:fixed;right:8px;bottom:8px;z-index:100;max-width:310px;max-height:65vh;overflow:auto;background:#102e2df5;color:white;padding:12px;font:12px system-ui';
 panel.innerHTML='<summary>评审后续 · 独立实验</summary><p>实测与录像分开。三项实验独立开关；普通行走仍需目视验收。</p><div></div><output>等待显式验证</output><pre style="white-space:pre-wrap;max-height:120px;overflow:auto"></pre>';
 document.body.append(panel);const output=panel.querySelector('output'),pre=panel.querySelector('pre');let operation=null,terminal=false,serial=0,shadowDiagnostics=null,suiteRunning=false;
 const recorder=makeReviewRecorder({canvas:ctx.renderer.domElement,upload:async(blob,signal)=>{const id='followup-motion-'+Date.now();const response=await fetch('/__gpu-video/'+id,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal});if(!response.ok)throw Error('Video save failed');return(await response.json()).path;},publish:()=>{},onStop:reason=>{if(operation?.kind.includes('motion'))void finish(false,reason);}});
 const id=label=>'followup-'+label+'-'+Date.now()+'-'+(++serial);
 function assert(condition,label){const check={label,passed:Boolean(condition)};operation.checks.push(check);if(!condition)throw Error(label);}
 function state(){if(terminal)throw Error('Context lost');return ctx.getState();}
 function poseGrass(){const x=-1980,z=-593;return{position:[x,ctx.heightAt(x,z)+1.8,z],target:[-2010,ctx.heightAt(-2010,-535)+1,-535]};}
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function save(label,data,image=null){const key=id(label),response=await fetch('/__gpu/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'island-review-followup-v1',...data,image,source:terminal?operation?.before.build:state().build})});if(!response.ok)throw Error('Local evidence save failed');return key;}
 async function frame(time=60){if(!operation||operation.finishing||terminal)throw Error('Review stopped');operation.fixedTime=time;ctx.setTime(time);ctx.setPaused(false);const result=await ctx.queueReviewJob(()=>ctx.renderAt(time));if(result.passed===false)throw Error(result.reason??result.error);if(result.programErrors)throw Error('Actual shader compilation failed');return result;}
 async function settle(pose){ctx.setPose(pose);ctx.setTime(60);ctx.sky.setFrozen(false);const end=performance.now()+16000;
  do{await frame();const s=state();if(!s.vegetation.pending&&!s.terrain.pending&&!s.flow.pending&&s.skyCache.ready&&s.skyCache.publishedRevision===s.skyCache.revision)break;if(performance.now()>end)throw Error('World did not settle');await delay(50);}while(true);
  ctx.sky.setFrozen(true);for(let i=0;i<6;i++)await frame();
 }
 function imagePixels({pixels,width,height}){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d'),data=c.createImageData(width,height);for(let y=0;y<height;y++)data.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);c.putImageData(data,0,0);return canvas.toDataURL('image/png');}
 async function capture(label,extra={}){const s=state();await save(label,{kind:label,state:s,...extra},ctx.renderer.domElement.toDataURL('image/png'));return s;}
 function start(kind){if(operation||terminal||ctx.busy())throw Error('Another review is active');ctx.stop();ctx.setPaused(false);const s=state();operation={kind,phase:'preparing',fixedTime:60,before:s,checks:[],samples:[],original:{profile:ctx.getProfile(),grass:s.vegetation.grassLod.enabled,tree:treeSemanticEnabled.value,shadow:s.shadow.budget.allocation==='balanced-original-total-texels',walking:s.navigation.walking},deadline:setTimeout(()=>void finish(false,'bounded wall deadline'),180000)};output.textContent='运行 '+kind;panel.dataset.phase=kind;return operation;}
 async function finish(passed,reason){const op=operation;if(!op||op.finishing)return;op.finishing=true;clearTimeout(op.deadline);ctx.timing?.stop();recorder.stop(reason);ctx.setPaused(true);
  let artifact=null;
  try{const recorderEnd=performance.now()+15000;while(recorder.pending&&performance.now()<recorderEnd)await delay(100);if(recorder.pending)throw Error('Recorder finalization timeout');if(op.kind.includes('motion')&&(recorder.state.status!=='saved'||!recorder.state.tracksReleased))throw Error('Capture failed or tracks not released');const after=terminal?null:state(),record={kind:op.kind,passed,reason,checks:op.checks,before:op.before,after,samples:op.samples,result:op.result??null,journey:op.travel===undefined?null:{travelMetres:op.travel,sequence:'stand 3s, ordinary constrained walk 24s at 1.65 m/s, turn 2s, stand 2s'},video:op.kind.includes('motion')?recorder.state:null,claims:'GPU runtime/representation checks only; independent continuous visual acceptance required'};artifact=await save(op.kind+'-summary',record);panel.dataset.report=JSON.stringify(record);const r=op.result;pre.textContent=JSON.stringify({passed,reason,checks:op.checks,...(r?{timing:{frames:r.frameCount,fps:r.submittedFps,p50:r.p50,p95:r.p95,p99:r.p99,gpuSupport:r.gpu.support,queries:r.gpu.gpu.length,rawEvidence:artifact}}:{})},null,2);}
  catch(error){passed=false;reason+='; save: '+error;}
  finally{if(!terminal){treeDebugView.value=treeRepresentation.value=0;treeReviewRadius.value=0;ctx.water.setTemporalDebug(0);ctx.props.setDiagnosticGrass(false);ctx.props.setGrassGeometryLod(op.original.grass);treeSemanticEnabled.value=op.original.tree;ctx.setShadowStudy(op.original.shadow);ctx.setProfile(op.original.profile);ctx.setOrdinaryControls({walk:op.original.walking,forward:false});ctx.sky.setFrozen(false);ctx.renderAt(op.fixedTime);}operation=null;panel.dataset.phase='idle';panel.dataset.passed=String(passed);output.textContent=(passed?'已保存并暂停 · ':'验证失败 · ')+reason;}
  return {kind:op.kind,passed,reason,artifact};
 }
 async function guarded(kind,fn){if(operation||terminal||ctx.busy())throw Error('Another review is active');try{start(kind);await fn();return await finish(true,kind+' complete');}catch(error){return await finish(false,String(error));}}
 async function grass(){return await guarded('grass-e2e',async()=>{
  const pose=poseGrass();ctx.setProfile({...ctx.getProfile(),temporal:false});await settle(pose);const source=state().build.sourceHash,installed=state().vegetation.counts.grass;
  for(const enabled of [false,true]){ctx.props.setGrassGeometryLod(enabled);await frame();
   const s=state(),lod=s.vegetation.grassLod;assert(s.build.sourceHash===source,'same grass source');assert(s.vegetation.counts.grass===installed,'grass roots conserved');
   if(enabled){assert(lod.instances.reduce((a,b)=>a+b,0)===installed,'all roots assigned to actual LOD pools');assert(lod.triangles<lod.fullTriangles,'submitted index workload reduced');assert(JSON.stringify(lod.geometryIndices)==='[180,72,12]','real geometries have 60/24/4 triangles');assert(lod.draws.reduce((n,d)=>n+d.triangles,0)===lod.triangles,'actual main draws match installed index workload');assert(lod.instances.filter(n=>n>0).length>=2,'multiple physical LODs populated');}
   for(let i=0;i<12;i++){ctx.setPose({position:[pose.position[0]+i*.1,pose.position[1],pose.position[2]+i*.05],target:pose.target});await frame(60+i/30);await capture('grass-'+(enabled?'geometry':'p8')+'-'+i,{route:'creek-grass-1.1m-v1',tick:i,mode:enabled?'geometry':'p8'});}
   operation.samples.push({mode:enabled?'geometry':'p8',lod});ctx.setPose(pose);
  }
  ctx.props.setDiagnosticGrass(true);await frame();ctx.props.setDiagnosticGrass(false);await frame();assert(!state().vegetation.diagnosticGrass,'grass visibility restored');
 });}
 async function trees(){return await guarded('tree-e2e',async()=>{
  ctx.setProfile({...ctx.getProfile(),lighting:true,temporal:false});
  const audits=ctx.props.auditTreeSemantics();for(const row of audits){assert(row.leafPixels>0&&row.barkPixels>0,'actual atlas contains leaf and bark for species '+row.species);assert(row.exposureRange[1]-row.exposureRange[0]>.1,'crown exposure survives rasterization '+row.species);assert(row.materials.filter(m=>!m.leaf).every(m=>m.transmission===0),'bark has no transmission '+row.species);const {pixels,...meta}=row;await save('semantic-species-'+row.species,meta,imagePixels(row));}
  const fixture=ctx.props.auditTrees({position:[-1655.834796326235,213.1652344337568,-710.6541914292611],radius:1,limit:8}).records.find(r=>r.id===69639);assert(fixture,'fixed same-tree identity exists');
  const d=ctx.sun.position.clone().sub(ctx.sun.target.position).normalize(),h=Math.hypot(d.x,d.z),root=fixture.root,pos=[root[0]+d.x/h*96,root[1]+fixture.scale[1]*.5,root[2]+d.z/h*96],pose={position:pos,target:[root[0],root[1]+fixture.scale[1]*.67,root[2]]};await settle(pose);treeReviewRoot.value.fromArray(root);treeReviewRadius.value=1;
  const casterIds=()=>ctx.props.auditTrees({position:pos,radius:160}).records.filter(t=>t.casterInstalled).map(t=>t.id),originalCasters=JSON.stringify(casterIds());
  for(const enabled of [false,true]){treeSemanticEnabled.value=enabled;for(const representation of [1,2]){treeRepresentation.value=representation;for(const [component,mode]of [['normal',0],['albedo',1],['direct',2],['indirect',3],['transmission',4],['shadow',5],['coverage',6],['semantic',7]]){treeDebugView.value=mode;await frame();assert(JSON.stringify(casterIds())===originalCasters,'tree color representation leaves installed casters unchanged');await capture('tree-'+(enabled?'semantic':'p8')+'-'+representation+'-'+component,{tree:fixture,pose,component,representation,casterIds:casterIds()});}}}
  treeDebugView.value=treeRepresentation.value=0;treeReviewRadius.value=0;
 });}
 async function shadows(){return await guarded('shadow-e2e',async()=>{
  ctx.setProfile({...ctx.getProfile(),temporal:false,nearShadow:false});ctx.props.setDiagnosticGrass(true);
  const fixture=ctx.props.auditTrees({position:[-1993.794700901962,18.403563452401542,-609.2514818068594],radius:1,limit:8}).records[0];assert(fixture,'fixed creek shadow caster exists');
  const d=ctx.sun.position.clone().sub(ctx.sun.target.position).normalize(),height=fixture.scale[1]*.6,x=fixture.root[0]-d.x/d.y*height,z=fixture.root[2]-d.z/d.y*height,ground=ctx.heightAt(x,z),pose={position:[x+3,ctx.heightAt(x+3,z-3)+2.8,z-3],target:[x,ground+.04,z]};
  await settle(pose);assert(state().ground.visibleHeight>state().ground.waterHeight+.5,'shadow receiver camera is on dry ground');operation.shadowFixture={tree:fixture,pose,groundPoint:[x,ground,z]};
  shadowDiagnostics??=makeShadowDiagnostics(ctx.renderer);
  for(const enabled of [false,true]){ctx.setShadowStudy(enabled);for(let i=0;i<8;i++){const s=await frame(60+i/15);if(enabled)assert(s.shadow.budget.plannedTexels<=s.shadow.budget.originalTexels,'balanced maps fit original texel budget');assert(s.shadow.extent[0]===280,'middle-distance 280 m coverage retained');assert(s.vegetation.treeWindTime.override===null,'physical wind stays active');await capture('shadow-receiver-'+enabled+'-'+i,{tick:i,fixture:operation.shadowFixture});for(const [label,light]of [['primary',ctx.sun],...(enabled?[['near',ctx.nearShadow.light]]:[])]){const raw=shadowDiagnostics.capture(light),{pixels,...meta}=raw;await save('shadow-depth-'+enabled+'-'+label+'-'+i,{time:s.worldTime,...meta},imagePixels(raw));}operation.samples.push({enabled,tick:i,budget:s.shadow.budget,shadow:s.shadow,wind:s.vegetation.treeWindTime});}}
 });}
 async function history(){return await guarded('history-e2e',async()=>{
  const pose=poseGrass();ctx.setProfile({...ctx.getProfile(),temporal:true});await settle(pose);
  for(const mode of [1,2,3]){ctx.water.setTemporalDebug(mode);ctx.setPose({position:[pose.position[0]+.05*mode,pose.position[1],pose.position[2]],target:pose.target});await frame(60+mode/30);const raw=ctx.water.readTemporalDebug(),counts={};if(mode===2){for(let i=0;i<raw.pixels.length;i+=4){const key=[...raw.pixels.subarray(i,i+3)].join(',');counts[key]=(counts[key]??0)+1;}assert(Object.values(counts).reduce((a,b)=>a+b,0)===raw.width*raw.height,'GPU reject mask covers every output pixel');assert(counts['0,255,0']>0&&counts['255,128,0']>0,'GPU mask contains accepted and silhouette-rejected pixels');}assert(state().flow.temporal.targets===2&&state().flow.temporal.extraPasses===2,'diagnostic uses a separate pass and retains two native history targets');await save('history-mask-'+mode,{mode,counts,state:state(),legend:{'0,255,0':'accepted','255,0,0':'depth mismatch','255,128,0':'silhouette','128,0,255':'radiance rejection','0,255,255':'outside previous view','255,0,255':'invalid depth','0,0,255':'water/projection guard','51,51,51':'no history'}},imagePixels(raw));}
  ctx.water.setTemporalDebug(0);await frame(60.2);assert(state().flow.temporal.debugMode===0&&state().flow.temporal.extraPasses===1,'diagnostic disabled and normal output restored');
 });}
 async function timing(mode){try{start('timing-'+mode);ctx.water.setTemporalDebug(0);treeDebugView.value=0;treeRepresentation.value=0;treeReviewRadius.value=0;const pose=poseGrass();await settle(pose);ctx.sky.setFrozen(false);operation.pose=pose;operation.start=ctx.now();operation.phase='timing';operation.mode=mode;operation.intervals=[];operation.origin=state();output.textContent='独立计时 · 3 秒预热 + 8 秒采样';}catch(error){await finish(false,String(error));}}
 async function completeTiming(){const op=operation;op.phase='drain';ctx.timing.stop();ctx.setPaused(true);const end=performance.now()+5000;while(ctx.timing.status().pending&&performance.now()<end){ctx.timing.poll();await delay(100);}const report=ctx.timing.report(),values=op.intervals,sum=values.reduce((a,b)=>a+b,0);op.result={frameCount:values.length,submittedFps:values.length*1000/sum,p50:quantile(values,.5),p95:quantile(values,.95),p99:quantile(values,.99),gpu:report,conditions:op.origin,instrumentation:{capture:false,pixelReadback:false,uploads:false},route:{id:'creek-grass-2.4m-v1',navigation:'camera diagnostic rail; ordinary walking is captured separately',worldSeconds:[60,71]}};assert(values.length>30,'finite native-frame sample collected');assert(state().build.sourceHash===op.origin.build.sourceHash,'timing source remained fixed');assert(report.pending===0,'all GPU queries drained or timed out');await finish(true,'native timing saved; inspect support and raw GPU statuses');}
 async function motion(){try{start('grass-motion');const pose=poseGrass();await settle(pose);ctx.sky.setFrozen(false);operation.pose=pose;operation.start=ctx.now();operation.phase='motion';recorder.setPaused(false);if(!recorder.arm({wallLimitMs:16000,byteLimit:22000000}))throw Error('Recorder unavailable');output.textContent='10 秒普通风速草地慢移录像 · 与计时分开';}catch(error){await finish(false,String(error));}}
 async function ordinaryMotion(){try{start('ordinary-walk-motion');await settle(poseGrass());ctx.sky.setFrozen(false);ctx.setOrdinaryControls({walk:true,forward:false});operation.start=ctx.now();operation.phase='ordinary';operation.motionFrames=0;operation.previousSeconds=0;operation.previousPosition=ctx.camera.position.clone();operation.travel=0;recorder.setPaused(false);if(!recorder.arm({wallLimitMs:42000,byteLimit:22000000}))throw Error('Recorder unavailable');output.textContent='自然行走录像 · 站立 3 秒 / 步行 24 秒 / 转头 / 停下';}catch(error){await finish(false,String(error));}}
 async function suite(){if(operation||suiteRunning||terminal||ctx.busy())throw Error('Another review is active');suiteRunning=true;const results=[];try{for(const action of [grass,trees,shadows,history]){const result=await action();results.push(result);if(!result?.passed)break;}const passed=results.length===4&&results.every(r=>r.passed);const artifact=await save('suite-summary',{kind:'headed-e2e-suite',passed,results,claims:'Actual GPU runtime and independent representations; no visual-completion or 60 FPS claim'});panel.dataset.phase='idle';panel.dataset.passed=String(passed);panel.dataset.suite=JSON.stringify({passed,results,artifact});output.textContent=(passed?'全量浏览器验证已保存 · ':'全量浏览器验证失败 · ')+artifact;}finally{suiteRunning=false;}}
 const button=(id,label,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.style.margin='4px';b.onclick=()=>{if(id!=='followup-stop'&&(operation||suiteRunning))return;Promise.resolve(fn()).catch(error=>output.textContent=String(error));};panel.querySelector('div').append(b);};
 button('followup-grass','验证草地真实几何 LOD',grass);button('followup-tree','同树材质与光照分项',trees);button('followup-shadow','原始风影与预算对照',shadows);button('followup-history','历史接受与拒绝图',history);
 button('followup-passes','独立 GPU 分项计时',()=>timing('passes'));button('followup-frame','独立完整帧计时',()=>timing('frame'));button('followup-motion','草地自然时间慢移录像',motion);button('followup-walk','普通地面步行录像',ordinaryMotion);button('followup-all','完整浏览器验证一次',suite);
 function switchMode(kind){if(ctx.busy())throw Error('Another review is active');ctx.setPaused(true);const s=state();if(kind==='grass')ctx.props.setGrassGeometryLod(!s.vegetation.grassLod.enabled);if(kind==='tree')treeSemanticEnabled.value=!treeSemanticEnabled.value;if(kind==='shadow')ctx.setShadowStudy(s.shadow.budget.allocation!=='balanced-original-total-texels');ctx.renderAt(s.worldTime);const modes=state();output.textContent='已暂停 · 草地 '+(modes.vegetation.grassLod.enabled?'几何 LOD':'P8')+' / 树木 '+(treeSemanticEnabled.value?'语义':'P8')+' / 阴影 '+(modes.shadow.budget.allocation==='original'?'原版':'同预算分配');}
 button('followup-config-grass','切换草地几何 LOD',()=>switchMode('grass'));button('followup-config-tree','切换树木语义',()=>switchMode('tree'));button('followup-config-shadow','切换同预算阴影',()=>switchMode('shadow'));
 button('followup-stop','停止并保留失败证据',()=>finish(false,'explicit stop'));
 return {
  get active(){return Boolean(operation);},
  get controlsCamera(){return Boolean(operation&&operation.phase!=='ordinary');},
  beforeFrame(){
   const op=operation;if(!op||op.finishing)return;
   if(!['motion','timing','ordinary'].includes(op.phase)){ctx.setTime(op.fixedTime);return;}
   const seconds=(ctx.now()-op.start)/1000;op.fixedTime=60+seconds;ctx.setTime(op.fixedTime);
   if(op.phase==='ordinary'){
    const delta=Math.max(0,seconds-op.previousSeconds);op.previousSeconds=seconds;
    ctx.setOrdinaryControls({forward:seconds>=3&&seconds<27,turn:seconds>=27&&seconds<29?delta*.15:0});return;
   }
   const progress=Math.min(1,seconds/(op.phase==='timing'?11:10));
   ctx.setPose({position:[op.pose.position[0]+progress*2.4,op.pose.position[1],op.pose.position[2]+progress*1.2],target:op.pose.target});
   if(op.phase==='timing'&&seconds>=3&&!op.sampleStarted){ctx.timing.start(op.mode);op.sampleStarted=true;}
  },
  afterFrame(raw){
   try{
    const op=operation;if(!op||op.finishing||!['motion','timing','ordinary'].includes(op.phase))return;
    const seconds=(ctx.now()-op.start)/1000;
    if(op.phase==='ordinary'){
     op.travel+=Math.hypot(ctx.camera.position.x-op.previousPosition.x,ctx.camera.position.z-op.previousPosition.z);op.previousPosition.copy(ctx.camera.position);recorder.afterFrame();if(op.motionFrames++%30===0)op.samples.push({seconds,state:state()});
     if(seconds>=31){
      assert(state().navigation.walking,'native walking constraints active');
      assert(state().vegetation.treeWindTime.override===null,'ordinary wind active throughout capture');
      assert(op.samples.length>=8,'ordinary journey state samples retained');
      assert(op.travel>2,'native ground navigation travelled rather than a stationary capture');
      void finish(true,'ordinary ground navigation saved; visual acceptance pending');
     }
    }else if(op.phase==='motion'){
     recorder.afterFrame();if(seconds>=10)void finish(true,'motion saved; visual acceptance pending');
    }else{
     if(op.sampleStarted)op.intervals.push(raw);
     if(seconds>=11)void completeTiming().catch(error=>finish(false,String(error)));
    }
   }catch(error){void finish(false,String(error));}
  },
  contextLost(){terminal=true;recorder.stop('context lost');if(operation)void finish(false,'context lost');},
  dispose(){shadowDiagnostics?.dispose();recorder.stop('dispose');panel.remove();}
 };
}
