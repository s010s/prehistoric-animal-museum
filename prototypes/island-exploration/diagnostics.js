// E00 observation only. No GL hooks, queries, UI or logs without ?diagnostics=1.
import * as T from 'three'
export function makeDiagnostics(renderer, params) {
  if (params.get('diagnostics') !== '1' || params.get('benchmark') !== '1') return null
  const gl = renderer.getContext(), nativeExt = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const ext = params.get('timerTest') === 'unsupported' ? null : nativeExt
  const gpuMode = ['frame','shadow','none','isolated'].includes(params.get('gpuScope')) ? params.get('gpuScope') : 'pass'
  const counts = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points, lines: renderer.info.render.lines })
  const difference = (a,b) => Object.fromEntries(Object.keys(a).map(k => [k,a[k]-b[k]]))
  let uploadCpuMs=0, queryNestingAttempts=0, lastSampleTime=null;
  let context, current = null, frameId = 0, activeQuery = null, pending = [], events = [], results = [], job = null, queue = [], phase = 'idle', stageStart = 0, gpuRows = [], frameRows = [], runEvents = [], upload = { bufferDataBytes:0, bufferSubDataBytes:0 }, parentPass = null, testDisjoint = false
  const groupLabels=new WeakMap(),geometryLabels=new WeakMap();
  function category(object,geometry){if(geometryLabels.has(geometry))return geometryLabels.get(geometry);for(let o=object;o;o=o.parent){if(groupLabels.has(o))return groupLabels.get(o);if(o.name==='溪畔迷惑龙')return 'animal'}return parentPass==='water'?'water':parentPass?.startsWith('cloud')?'skyCache':parentPass?.startsWith('ocean')?'spectrum':parentPass==='aoOutputComposite'?'composite':'other'}
  const originalDraw=renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect=(camera,scene,geometry,material,object,group)=>{if(!current)return originalDraw(camera,scene,geometry,material,object,group);const before=counts();try{return originalDraw(camera,scene,geometry,material,object,group)}finally{if(current){const key=category(object,geometry),delta=difference(counts(),before),scope=parentPass??'unscoped';current.categories[scope]??={};current.categories[scope][key]??={calls:0,triangles:0,points:0,lines:0};for(const k of Object.keys(delta))current.categories[scope][key][k]+=delta[k]}}};
  const startup = performance.now(), initialEvents = []
  const gpuSupport = ext ? 'supported' : 'unsupported'
  function event(type, detail = {}) {
    const e = { type, wallNowMs: performance.now(), frameId, ...detail }
    if (phase === 'sample' || phase === 'drain') runEvents.push(e)
    else if (!context) initialEvents.push(e)
    else events.push(e)
  }
  // These are actual WebGL buffer transfer/allocation arguments, not instance estimates.
  // Texture transfer bytes are deliberately unknown (DOM image, driver conversion/mips).
  for (const name of ['bufferData','bufferSubData']) {
    const original = gl[name].bind(gl)
    gl[name] = (...args) => {
      const source = args[name === 'bufferData' ? 1 : 2]
      let bytes = typeof source === 'number' ? source : source?.byteLength ?? 0
      if (ArrayBuffer.isView(source)) {
        const offset = args[name === 'bufferData' ? 3 : 3] ?? 0
        const length = args[4]
        bytes = length ? length * source.BYTES_PER_ELEMENT : Math.max(0, source.byteLength - offset * (source.BYTES_PER_ELEMENT ?? 1))
      }
      upload[name + 'Bytes'] += bytes
      const start=performance.now();try{return original(...args)}finally{uploadCpuMs+=performance.now()-start}
    }
  }
  function finishQuery(status = 'pending') {
    if (!activeQuery) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    pending.push({ ...activeQuery, endedAt: performance.now(), status })
    activeQuery = null
  }
  function beginQuery(scope) {
    if (phase !== 'sample') return false
    if (!ext) { if (phase === 'sample') gpuRows.push({frameId,scope,ms:null,status:'unsupported'}); return false }
    if (activeQuery) {queryNestingAttempts++;return false} // inclusive parent owns this work; never nest elapsed targets
    if (pending.length >= 128) { if (phase === 'sample') gpuRows.push({frameId,scope,ms:null,status:'backpressure'}); return false }
    const query = gl.createQuery()
    if (!query) { if (phase === 'sample') gpuRows.push({frameId,scope,ms:null,status:'allocation-failed'}); return false }
    activeQuery = {query,scope,frameId,record:phase === 'sample'}
    gl.beginQuery(ext.TIME_ELAPSED_EXT,query)
    return true
  }
  function poll() {
    if (!ext || !pending.length) return
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) || (params.get('timerTest') === 'disjoint' && !testDisjoint && phase === 'sample')
    if (disjoint) { testDisjoint = true; event('gpu-disjoint',{testInjected:params.get('timerTest')==='disjoint'}) }
    // One bounded availability check per pending query, once per rAF. No busy waiting/readback.
    pending = pending.filter(p => {
      let status = disjoint ? 'disjoint' : performance.now()-p.endedAt > 5000 ? 'timeout' : null, ms = null
      if (!status && gl.getQueryParameter(p.query,gl.QUERY_RESULT_AVAILABLE)) { status='valid'; ms=gl.getQueryParameter(p.query,gl.QUERY_RESULT)/1e6 }
      if (!status) return true
      if (p.record) gpuRows.push({frameId:p.frameId,scope:p.scope,ms,status})
      gl.deleteQuery(p.query); return false
    })
  }
  function pass(name, fn) {
    const before = counts(), start = performance.now(), previous = parentPass
    parentPass = name
    // Some ANGLE/Metal implementations report command-buffer spans across many queries.
    // The isolated mode samples at most one selected pass per frame for cross-checking.
    const isolatedScope=['cloudPanorama','cloudShadow','oceanSpectrum0','oceanSpectrum1','planarReflection','mainInclusiveShadow','aoOutputComposite','water'][frameId%8]
    const timed = (gpuMode === 'pass' || (gpuMode==='isolated'&&name===isolatedScope)) && beginQuery(name)
    try { return fn() } finally {
      if (timed) finishQuery()
      if (current) current.passes.push({name,cpuMs:performance.now()-start,...difference(counts(),before),inclusive:name==='mainInclusiveShadow'})
      parentPass = previous
    }
  }
  const originalShadow = renderer.shadowMap.render.bind(renderer.shadowMap)
  renderer.shadowMap.render = (...args) => {
    const before = counts(), start = performance.now()
    const timed = gpuMode === 'shadow' && renderer.shadowMap.autoUpdate && args[0].length && beginQuery('shadow')
    try { return originalShadow(...args) } finally {
      if (timed) finishQuery()
      const delta = difference(counts(),before)
      if (current && delta.calls) { current.shadow = {parent:parentPass,cpuMs:performance.now()-start,...delta}; current.cpu.shadowSubmissionNested = performance.now()-start }
    }
  }
  const percentile = (values,p) => values.length ? [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))] : null
  const stats = values => ({ count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:values.length?Math.max(...values):null,mean:values.length?values.reduce((s,v)=>s+v,0)/values.length:null })
  function resourceLedger() {
    const rt = context.resources().map(([name,target]) => {
      const tex = target.texture, depth = target.depthTexture
      const colourBytes = tex.type === T.HalfFloatType ? 8 : tex.type === T.FloatType ? 16 : 4
      const depthBytes = target.depthBuffer ? (depth?.type === T.UnsignedShortType ? 2 : 4) : 0
      const samples = Math.min(target.samples,gl.getParameter(gl.MAX_SAMPLES))
      return {name,width:target.width,height:target.height,requestedSamples:target.samples,effectiveSamples:samples,colourType:tex.type,colourFormat:tex.format,colourSpace:tex.colorSpace,internalFormat:tex.internalFormat,generateMipmaps:tex.generateMipmaps,depthBuffer:target.depthBuffer,depthTexture:depth?{type:depth.type,format:depth.format}:null,estimatedBytes:Math.round(target.width*target.height*(colourBytes*(tex.generateMipmaps?4/3:1)+depthBytes+samples*(colourBytes+depthBytes))),estimate:'nominal storage including MSAA attachments and resolved colour/depth; driver overhead excluded'}
    })
    const instanceGroups = []
    context.props.group.traverse(o => { if(o.isInstancedMesh)instanceGroups.push({category:category(o,o.geometry),geometry:o.geometry.uuid,instances:o.count,capacity:o.instanceMatrix.count,trianglesPerInstance:(o.geometry.index?.count??o.geometry.attributes.position.count)/3,matrixStagingBytes:o.instanceMatrix.array.byteLength,colourStagingBytes:o.instanceColor?.array.byteLength??0}) })
    return {renderTargets:rt,resourceCounts:{...renderer.info.memory,programs:renderer.info.programs?.length??null},instanceGroups,textureGpuBytes:null,driverOverheadBytes:null,textureUploadBytes:null,groundArraysNominalBytes:15*1024*1024*4*4/3,groundArrayEstimate:'5 albedo + 10 normal/ARM RGBA8 layers with complete mip chain; not measured VRAM'}
  }
  function assertions(state) {
    const all = gpuRows.every(r => r.status === 'valid' ? Number.isFinite(r.ms) && r.ms >= 0 : r.ms === null)
    return {rawRafTimestamps:frameRows.length>0&&frameRows.every(r=>Number.isFinite(r.rafTimestampMs)&&r.frameIntervalMs>0),cpuFinite:frameRows.every(r=>Object.values(r.cpu).every(v=>Number.isFinite(v)&&v>=0)),submissionsReconcile:frameRows.every(r=>r.passes.reduce((s,p)=>s+p.calls,0)===r.submissions.calls&&r.passes.reduce((s,p)=>s+p.triangles,0)===r.submissions.triangles),gpuValidOrNull:all,noNestedQueries:activeQuery===null&&queryNestingAttempts===0,drawSize:state.drawSize[0]===2048&&state.drawSize[1]===1152,fixedExposure:frameRows.every(r=>r.exposure===1.35),adaptiveDisabled:!state.adaptive,noResourceErrors:!state.programErrors&&!state.vegetation.error&&!state.flow.error,framesCollected:frameRows.length>0,completeRoute:['hot','smoke'].includes(job.kind)||context.benchmark.diagnosticComplete,unsupportedNull:gpuSupport!=='unsupported'||gpuRows.every(r=>r.ms===null&&r.status==='unsupported'),disjointNull:params.get('timerTest')!=='disjoint'||gpuRows.some(r=>r.status==='disjoint'&&r.ms===null)}
  }
  const panel = document.createElement('section'); panel.id='e00'; panel.style.cssText='position:fixed;top:12px;left:12px;z-index:80;background:#14252ef0;color:white;padding:10px;max-width:460px;font:12px sans-serif'
  panel.innerHTML='<strong>独立测量</strong><div><button id="e00-regression">路线计时</button><button id="e00-hot">热稳定 3 轮</button><button id="e03-ab">实例排序 A/B · 3 轮</button><button id="e00-video">独立录像</button><button id="e00-smoke">仪表检查</button><button id="e00-stop">停止采集</button></div><output id="e00-status">等待启动</output><pre id="e00-result" style="max-height:80px;overflow:auto"></pre>'
  document.body.append(panel)
  const status = panel.querySelector('output'), result = panel.querySelector('pre')
  function start(kind) {
    if (job || !context) return
    results=[]; events=[]
    const routes=['forest','spring','west','beach']
    const requested=params.get('measureRoutes')?.split(','),selected=requested?.length&&requested.every(route=>routes.includes(route))?[...new Set(requested)]:routes;
    queue = kind==='ab' ? [0,1,2].flatMap(repeat=>['forest','spring'].flatMap(route=>(repeat%2?['radix','all']:['all','radix']).map(instanceSort=>({kind:'hot',experiment:'instance-sort',route,repeat,instanceSort,warmup:30,seconds:120})))) : kind==='hot' ? [0,1,2].flatMap(repeat=>selected.map(route=>({kind,route,repeat,warmup:30,seconds:120}))) : (kind==='smoke'?[{kind,route:'forest',warmup:2,seconds:3}]:selected.map(route=>({kind,route,warmup:kind==='video'?3:10,seconds:null})))
    next()
  }
  function next() {
    job=queue.shift()
    if (!job) { phase='idle'; status.textContent='采集完成 · '+results.length+' 组'; panel.dataset.complete='true'; return }
    if(job.instanceSort)context.props.setInstanceSort(job.instanceSort)
    context.benchmark.prepareDiagnostic(job.route)
    phase='warmup';stageStart=performance.now();panel.dataset.complete='false';status.textContent=job.route+' · 预热'
  }
  async function saveRun() {
    const state = context.getState(), ledger=resourceLedger(), checks=assertions(state);if(job.instanceSort)checks.instanceVariant=state.vegetation.instanceSort===job.instanceSort;if(job.kind==='video')checks.motionVideo=Boolean(document.querySelector('#benchmark-video')?.src?.startsWith('data:'))
    const intervals=frameRows.map(r=>r.frameIntervalMs), cpuNames=[...new Set(frameRows.flatMap(r=>Object.keys(r.cpu)))], scopes=[...new Set(gpuRows.map(r=>r.scope))]
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const artifact = {cpuContracts:{frameInclusive:'synchronous rAF callback including query polling, navigation, scene updates, submission and review UI; excludes asynchronous worker callbacks and final diagnostic state snapshot',renderSubmissionInclusive:'CPU only, contains all water passes and GL upload calls; not GPU time',shadowSubmissionNested:'subset of mainInclusiveShadow; do not sum twice',bufferUploadNested:'actual GL buffer allocation/transfer CPU calls, nested within renderer submission',workerConsume:'asynchronous events; detail consumption includes instance writes',instanceWrites:'asynchronous detail event, subset of workerConsume'},routeContract:{route:job.route,nominalSimulationSeconds:job.route==='forest'?12:job.route==='beach'?42:24,worldStartSeconds:60,tickStepSeconds:1/60,tickAdvancesOnlyWhenJobsReady:true,wallDurationIndependent:true},schema:'island-e00-v1',createdAt:new Date().toISOString(),job,source:state.build,view:state,environment:{userAgent:navigator.userAgent,devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,glVersion:gl.getParameter(gl.VERSION),headed:'Codex in-app browser (host-controlled)',screen:{width:screen.width,height:screen.height},refreshHz:null,powerMode:null,seed:193706},measurement:{queryNestingAttempts,gpuSupport,gpuMode,timerTest:params.get('timerTest'),captureEnabled:job.kind==='video',sampleWallMs:sampleEnd-sampleStart,simulationStart:frameRows[0]?.simulationTime,simulationEnd:frameRows.at(-1)?.simulationTime,frameCount:frameRows.length,actualFps:frameRows.length/((sampleEnd-sampleStart)/1000),frameIntervalMs:stats(intervals),hitches:{over16_67:intervals.filter(v=>v>16.67).length/intervals.length,over33_33:intervals.filter(v=>v>33.33).length/intervals.length,over50:intervals.filter(v=>v>50).length/intervals.length},cpu:cpuNames.map(scope=>({scope,...stats(frameRows.map(r=>r.cpu[scope]).filter(Number.isFinite))})),gpu:scopes.map(scope=>({scope,...stats(gpuRows.filter(r=>r.scope===scope&&r.status==='valid').map(r=>r.ms))}))},visualRecords:job.kind==='video'?context.benchmark.visualRecords:undefined,frames:frameRows,gpu:gpuRows,events:runEvents,resources:ledger,checks,passed:Object.values(checks).every(Boolean),startupEvents:initialEvents}
    const id = `${job.kind}-${job.route}-${job.repeat??0}-${gpuMode}-${params.get('timerTest')??'native'}-${job.instanceSort??state.vegetation.instanceSort??'default'}-${Date.now()}`
    try {
      const response=await fetch('/__e00/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(artifact)}); if(!response.ok)throw Error(await response.text())
      if(job.kind==='video') {
        const video = document.querySelector('#benchmark-video')
        if(video?.src?.startsWith('data:')) { const blob=await(await fetch(video.src)).blob();const response=await fetch('/__e00-video/'+id,{method:'POST',headers:{'Content-Type':blob.type},body:blob});if(!response.ok)throw Error(await response.text()) }
        else event('video-missing')
      }
      results.push({id,passed:artifact.passed,checks,frames:frameRows.length});result.textContent=JSON.stringify(results);panel.dataset.results=JSON.stringify(results)
      next()
    } catch(e) { phase='error';status.textContent='证据保存失败 · '+String(e);panel.dataset.error=String(e) }
  }
  let sampleStart=0,sampleEnd=0
  panel.querySelector('#e00-regression').onclick=()=>start('regression');panel.querySelector('#e00-hot').onclick=()=>start('hot');panel.querySelector('#e00-video').onclick=()=>start('video');panel.querySelector('#e00-smoke').onclick=()=>start('smoke')
  panel.querySelector('#e03-ab').onclick=()=>start('ab')
  panel.querySelector('#e00-stop').onclick=()=>{queue=[];context.benchmark.cancel('diagnostic stopped');event('user-stop');phase='idle';job=null;status.textContent='已停止，未保存完整测量'}
  addEventListener('visibilitychange',()=>event('visibility',{hidden:document.hidden}))
  addEventListener('resize',()=>event('resize',{width:innerWidth,height:innerHeight}))
  renderer.domElement.addEventListener('webglcontextlost',()=>{event('context-lost');if(activeQuery)finishQuery();for(const p of pending){if(p.record)gpuRows.push({frameId:p.frameId,scope:p.scope,ms:null,status:'context-lost'});gl.deleteQuery(p.query)}pending=[];phase='error';status.textContent='上下文丢失，采集失败'})
  return {labelGroup:(object,label)=>groupLabels.set(object,label),labelGeometry:(geometry,label)=>geometryLabels.set(geometry,label),event,pass,cpu(name,ms){if(current)current.cpu[name]=(current.cpu[name]??0)+ms},attach(value){context=value},beginFrame(t,raw,time){
    frameId++;poll();current=null
    if(phase==='warmup'&&performance.now()-stageStart>=job.warmup*1000){
      const state=context.getState();if(performance.now()-stageStart>180000){phase='error';status.textContent='预热资源超时';panel.dataset.error='warmup timeout';return}if(!state.vegetation.pending&&!state.terrain.pending&&!state.flow.pending){
        frameRows=[];gpuRows=[];runEvents=[];testDisjoint=false;queryNestingAttempts=0;lastSampleTime=null;sampleStart=performance.now();phase='sample';context.benchmark.startDiagnostic(job.route,{capture:job.kind==='video',repeat:job.kind==='hot'});event('sample-start',{warmupWallMs:sampleStart-stageStart});
      }
    }
    if(phase==='sample') {
      if(lastSampleTime!==null&&time<lastSampleTime)event('simulation-reset',{from:lastSampleTime,to:time});lastSampleTime=time;
      current={id:frameId,rafTimestampMs:t,frameIntervalMs:raw,wallNowMs:performance.now(),simulationTime:time,cpu:{},passes:[],categories:{},exposure:renderer.toneMappingExposure,bufferUploads:{...upload}};upload={bufferDataBytes:0,bufferSubDataBytes:0};status.textContent=job.route+' · '+((performance.now()-sampleStart)/1000).toFixed(1)+' 秒墙钟 · '+gpuSupport;
      if(gpuMode==='frame')beginQuery('frameInclusive')
    }
    if(phase==='drain'&&(!pending.some(p=>p.record)||performance.now()-sampleEnd>6000)&&(!context.benchmark.videoPending)) { phase='saving';void saveRun() }
  },endGpuFrame(){if(gpuMode==='frame')finishQuery()},endFrame(ms){
    if(!current){upload={bufferDataBytes:0,bufferSubDataBytes:0};uploadCpuMs=0;return}
    current.cpu.frameInclusive=ms;current.cpu.bufferUploadNested=uploadCpuMs;uploadCpuMs=0;current.submissions=counts();current.bufferUploads.bufferDataBytes+=upload.bufferDataBytes;current.bufferUploads.bufferSubDataBytes+=upload.bufferSubDataBytes;upload={bufferDataBytes:0,bufferSubDataBytes:0};
    const state=context.getState();current.position=state.position;current.clearance=state.clearance;current.vegetation=state.vegetation.counts;current.drawSize=state.drawSize;current.pixelRatio=state.pixelRatio;current.resourceCounts={...renderer.info.memory};current.jobsPending=state.vegetation.pending||state.flow.pending;frameRows.push(current);current=null
    const duration=(performance.now()-sampleStart)/1000
    if((job.seconds&&duration>=job.seconds)||(!job.seconds&&!context.benchmark.active)){
      sampleEnd=performance.now();phase='drain';context.benchmark.cancel('measurement wall duration reached');event('sample-end');status.textContent=job.route+' · 等待延迟查询/录像';
    }
  },status:()=>({gpuSupport,gpuMode,phase,pendingQueries:pending.length,elapsedSinceInit:performance.now()-startup})}
}
