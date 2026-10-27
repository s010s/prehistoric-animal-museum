// Explicit, asynchronous GPU observation. No readback, capture or GL upload hooks.
const scopes=['mainInclusiveShadow','shadow','planarReflection','aoOutputComposite','water','sunVisibility','temporalResolve','displayOutput','cloudPanorama','cloudShadow','oceanSpectrum0','oceanSpectrum1','eastWetMemory'];
export function makePassTiming(renderer,params,base){
 if(params.get('representationReview')!=='1')return {observer:base,timing:null};
 const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 let active=false,lost=false,frame=0,mode='passes',selected=null,query=null,pending=[],rows=[],frames=[],cpu=[],current=null,scopeCursor=0,missed=0,queriedFrame=-1;
 function poll(){
  if(lost||!ext)return;
  const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
  pending=pending.filter(p=>{let status=disjoint?'disjoint':performance.now()-p.ended>4000?'timeout':null,ms=null;
   if(!status&&gl.getQueryParameter(p.handle,gl.QUERY_RESULT_AVAILABLE)){status='valid';ms=gl.getQueryParameter(p.handle,gl.QUERY_RESULT)/1e6;}
   if(!status)return true;rows.push({frame:p.frame,scope:p.scope,status,ms});gl.deleteQuery(p.handle);return false;
  });
 }
 function begin(scope){
  if(!active||lost||scope!==selected||query||queriedFrame===frame)return false;
  queriedFrame=frame;
  if(!ext){rows.push({frame,scope,status:'unsupported',ms:null});return false;}
  if(pending.length>=64){rows.push({frame,scope,status:'backpressure',ms:null});return false;}
  const handle=gl.createQuery();if(!handle){rows.push({frame,scope,status:'allocation-failed',ms:null});return false;}
  gl.beginQuery(ext.TIME_ELAPSED_EXT,handle);query={frame,scope,handle};return true;
 }
 function end(){if(!query||lost)return;gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({...query,ended:performance.now()});query=null;}
 function pass(scope,fn){const start=active?performance.now():0,timed=begin(scope);try{return base?.pass?base.pass(scope,fn):fn();}finally{if(timed)end();if(active)cpu.push({frame,scope,cpuSubmitMs:performance.now()-start});}}
 const originalShadow=renderer.shadowMap.render.bind(renderer.shadowMap);
 renderer.shadowMap.render=(...args)=>{
  // Fullscreen/cloud scenes also call this entry point with no shadow lights.
  // Measure the first real caster render, never an empty early return.
  const map=renderer.shadowMap;
  if(!map.enabled||!map.autoUpdate&&!map.needsUpdate||!args[0]?.some(light=>light.shadow&&(light.shadow.autoUpdate||light.shadow.needsUpdate)))return originalShadow(...args);
  return pass('shadow',()=>originalShadow(...args));
 };
 renderer.domElement.addEventListener('webglcontextlost',()=>{lost=true;active=false;for(const p of [...pending,...(query?[query]:[])])rows.push({frame:p.frame,scope:p.scope,status:'context-lost',ms:null});pending=[];query=null;});
 const observer=new Proxy(base??{}, {get(target,key){
  if(key==='pass')return pass;
  if(key==='beginFrame')return (...args)=>{base?.beginFrame?.(...args);poll();if(!active)return;frame++;selected=mode==='frame'?'frameInclusive':scopes[(scopeCursor++)%scopes.length];current={frame,interval:args[1],time:args[2]};if(mode==='frame')begin('frameInclusive');};
  if(key==='endGpuFrame')return ()=>{if(mode==='frame')end();base?.endGpuFrame?.();};
  if(key==='endFrame')return (...args)=>{base?.endFrame?.(...args);if(current){frames.push(current);if(selected&&!rows.some(r=>r.frame===frame)&&!pending.some(r=>r.frame===frame)&&query?.frame!==frame){missed++;rows.push({frame,scope:selected,status:'scope-not-run',ms:null});}current=null;}};
  return typeof target[key]==='function'?target[key].bind(target):target[key]??(()=>{});
 }});
 const timing={start(value='passes'){if(active||pending.length||lost)throw Error('GPU observation still active or unavailable');mode=value;rows=[];frames=[];cpu=[];frame=scopeCursor=missed=0;queriedFrame=-1;active=true;},stop(){end();active=false;},poll,status:()=>({active,pending:pending.length,support:ext?'supported':'unsupported',lost}),report(){return{mode,support:ext?'supported':'unsupported',gpu:rows,frames,cpu,missedScopes:missed,pending:pending.length,method:'EXT_disjoint_timer_query_webgl2; one elapsed query per frame; asynchronous availability/disjoint checks',limits:'pass samples occur on different frames; inclusive main includes shadows; do not sum inclusive and shadow. ANGLE/Metal command-buffer timing needs cross-check against whole-frame runs.'};}};
 return {observer,timing};
}
