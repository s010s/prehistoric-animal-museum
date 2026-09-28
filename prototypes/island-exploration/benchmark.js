import {trailX} from './habitat.js';
import {terrainHeight,riverX,riverLevel} from './field.js';
// Review-only UI and evidence. This module is inert outside ?benchmark=1.
export function makeBenchmark({ params, camera, canvas, landmarks, go, stop, getState, auditSky, setWaterDebug, setReviewDpr, setShadow, getShadow, setTime, syncPose }) {
  if (params.get('benchmark') !== '1') return null
  const ids = ['encounter','forest', 'estuary', 'bay', 'lagoon', 'summit', 'grassland', 'wetland', 'mudflat', 'heath', 'cliffs']
  const observations = {
    encounter: '观察脚底贴地、静立动画、尺度与树冠遮挡。',
    forest: '对照水底、碎波、近树体积与林下植物。外观 A/B 会保持镜头，重新加载。',
    estuary: '看河流进入大海的位置。水面、沙洲、浪向能否连续读懂。',
    bay: '看岸浪、水天线和远山。空气是否连贯；白沫是否像整齐边框。',
    lagoon: '平水对照组。看山岸倒影、水深与岸线，避免修河伤湖。',
    summit: '看前中后景山脊。能否认出河谷通向海湾；阴影是否仅围绕镜头。',
    grassland: '看疏林与草坡。移动时细边是否闪，近景是否突然消失。',
    wetland: '看芦苇根部、泥洲和浅水。水线与接触是否稳定。',
    cliffs: '看岩体体积与投影。慢横移，检查影边跳格、离地或覆盖丢失。',
  }
  let recorder=null;let suite = null; let replay = null, tick = 0, settled = 0, samples = [], lastSignature = '', current = params.get('place') || 'forest'
  const records = [], errors = []; let interrupted = null, pendingCapture = false, evidenceReadback = false
  addEventListener('error', e => errors.push(e.message))
  addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
  const panel = document.createElement('section')
  panel.id = 'benchmark'
  panel.setAttribute('aria-label', '世界验收')
  panel.innerHTML = `<button id="benchmark-collapse" aria-expanded="true">收起验收</button><strong>世界验收 · 同一地点，同一时刻</strong><p id="benchmark-note"></p><div class="benchmark-actions"><button id="benchmark-look"></button><button id="benchmark-variant"></button><button id="benchmark-replay">横移往返 · 12 秒</button><button id="benchmark-walk">录制林间步行 · 12 秒</button><button id="benchmark-sky-orbit">录制天空环视 · 24 秒</button><button id="benchmark-continuity">录制前进后退 · 24 秒</button><button id="benchmark-ground">贴地巡航检查</button><button id="benchmark-source">溪流源头</button><button id="benchmark-marsh-high">沼泽俯瞰</button><button id="benchmark-dpr-matrix">像素比例切换 · 12 秒</button><label>水面分量<select id="benchmark-water" aria-label="水面分量"><option value="0">正常</option><option value="1">法线</option><option value="2">反射</option><option value="4">泡沫</option><option value="5">水体</option></select></label><button id="benchmark-sky-audit">校验云层条带</button><button id="benchmark-sky-high">高原仰视</button><button id="benchmark-rock-close">近看岩岸</button><button id="benchmark-shore-close">近看岸浪</button><button id="benchmark-beach-eye">沙滩平视</button><button id="benchmark-shore">岸浪周期 · 42 秒</button><button id="benchmark-reset">复位到地点</button><button id="benchmark-save">记录当前画面</button><button id="benchmark-export">导出验收记录</button><button id="benchmark-suite">巡检全部 11 个地点</button></div><div id="benchmark-places"></div><details id="benchmark-image"><summary>最近原始画布截图</summary><label>选择验收截图<select id="benchmark-frame" aria-label="选择验收截图"></select></label><img id="benchmark-preview" alt="最近记录的原始 3D 画布" style="display:block;width:100%;height:auto" /></details><details id="benchmark-video-panel"><summary>最近移动录像</summary><video id="benchmark-video" controls style="width:100%"></video></details><output id="benchmark-status" aria-live="polite"></output><details id="benchmark-evidence"><summary>验收数据（不含截图）</summary><pre id="benchmark-json"></pre></details>`
  document.body.append(panel)
  const $ = id => panel.querySelector('#' + id)
  $('benchmark-collapse').onclick=()=>{const compact=panel.classList.toggle('compact');$('benchmark-collapse').textContent=compact?'展开验收':'收起验收';$('benchmark-collapse').setAttribute('aria-expanded',String(!compact))};
  const habitat=params.get('look')!=='baseline'
  $('benchmark-look').textContent=habitat?'对照旧参数（同地形）':'返回当前参数'
  $('benchmark-look').onclick=()=>{const next=new URL(location.href);next.searchParams.set('look',habitat?'baseline':'habitat');next.searchParams.set('pose',[...camera.position.toArray(),camera.rotation.y,camera.rotation.x].join(','));location.href=next.href}
  const updateLabel = () => { $('benchmark-variant').textContent = getShadow() ? '阴影 · 稳定' : '阴影 · 原有' }
  function reset(id = current) {
    replay = null; tick = 0; samples = []; settled = 0; interrupted = null
    current = id; panel.dataset.ready='false'; go(id); setTime(60)
    $('benchmark-note').textContent = observations[id] || observations.forest
    $('benchmark-replay').textContent = '横移往返 · 12 秒'
  }
  $('benchmark-frame').onchange=()=>{const r=records[Number($('benchmark-frame').value)];if(r?.image){$('benchmark-preview').src=r.image;$('benchmark-preview').alt=`${r.place} · ${r.kind} · tick ${r.tick}`}};
  function capture(kind, extra = {}) {
    const state = getState()
    const result = { kind, place: current, time: 60 + tick / 60, tick, ...state, ...extra }
    records.push(result)
    if(result.image){evidenceReadback=true;const option=document.createElement('option');option.value=String(records.length-1);option.textContent=`${current} · ${kind} · tick ${tick}`;$('benchmark-frame').append(option);$('benchmark-frame').value=option.value;$('benchmark-preview').src=result.image;$('benchmark-preview').alt=`${current} · ${kind} · ${state.drawSize.join('×')} · ${state.build.sourceHash.slice(0,12)}`}
    $('benchmark-json').textContent=JSON.stringify({schema:'island-world-review-v1',errors,gpuTiming:'unavailable',realMobile:'not tested',records:records.map(({image,...record})=>record)},null,2)
    return result
  }
  for (const id of ids) {
    const b = document.createElement('button'); b.textContent = landmarks.find(l => l.id === id).name
    b.onclick = () => {suite=null;reset(id)}; $('benchmark-places').append(b)
  }
  $('benchmark-variant').onclick = () => {
    if (replay) cancel('variant changed')
    setShadow(!getShadow()); updateLabel(); settled = 0
  }
  $('benchmark-reset').onclick = () => reset()
  $('benchmark-replay').onclick = () => {
    if (replay) { cancel('user stopped'); return }
    stop(); tick = 0; samples = []; interrupted = null; setTime(60)
    replay = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), start: performance.now() }
    $('benchmark-replay').textContent = '停止横移'
  }
  function startRecording(){
    try{const stream=canvas.captureStream(24),mimeType=['video/webm;codecs=vp9','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t)),chunks=[];
      recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6000000});recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{const blob=new Blob(chunks,{type:mimeType}),reader=new FileReader();reader.onload=()=>{$('benchmark-video').src=reader.result;$('benchmark-video').dataset.mime=mimeType;};reader.readAsDataURL(blob);stream.getTracks().forEach(t=>t.stop());};recorder.start();
    }catch(e){capture('video-error',{message:String(e)});}
  }
  $('benchmark-walk').onclick=()=>{
    stop();suite=null;reset('forest');tick=0;samples=[];interrupted=null;
    const z=-680,x=trailX(z);camera.position.set(x,terrainHeight(x,z)+1.75,z);camera.lookAt(camera.position.clone().set(trailX(z-18),terrainHeight(x,z)+2.2,z-18));
    replay={position:camera.position.clone(),quaternion:camera.quaternion.clone(),start:performance.now(),mode:'walk',ticks:720};
    startRecording();
  };
  $('benchmark-sky-orbit').onclick=()=>{stop();suite=null;tick=0;samples=[];interrupted=null;setTime(60);replay={position:camera.position.clone(),quaternion:camera.quaternion.clone(),yaw:camera.rotation.y,start:performance.now(),mode:'sky',ticks:1440};startRecording();};
  $('benchmark-continuity').onclick=()=>{stop();suite=null;tick=0;samples=[];interrupted=null;setTime(60);replay={position:camera.position.clone(),quaternion:camera.quaternion.clone(),yaw:camera.rotation.y,start:performance.now(),mode:'continuity',ticks:1440};startRecording();};
  $('benchmark-ground').onclick=()=>{stop();suite=null;reset('estuary');camera.position.y=terrainHeight(camera.position.x,camera.position.z)+1.75;camera.rotation.x=0;syncPose?.();};
  $('benchmark-source').onclick=()=>{stop();suite=null;reset('cliffs');camera.position.set(riverX(-3980)+35,230,-3930);camera.lookAt(camera.position.clone().set(riverX(-4000),riverLevel(-4000)+1,-4000));syncPose?.();};
  $('benchmark-marsh-high').onclick=()=>{stop();suite=null;reset('wetland');camera.position.set(3900,500,5450);camera.lookAt(camera.position.clone().set(5400,2.4,4000));syncPose?.();};
  $('benchmark-dpr-matrix').onclick=()=>{stop();suite=null;tick=0;samples=[];interrupted=null;setTime(60);replay={position:camera.position.clone(),quaternion:camera.quaternion.clone(),start:performance.now(),mode:'dpr',ticks:719,previousDpr:getState().pixelRatio};};
  $('benchmark-water').onchange=()=>setWaterDebug(Number($('benchmark-water').value));
  $('benchmark-sky-audit').onclick=()=>{const result=auditSky();capture('sky-stripe-audit',{result});$('benchmark-note').textContent=JSON.stringify(result);};
  $('benchmark-sky-high').onclick=()=>{stop();suite=null;reset('heath');camera.position.y=1643;camera.lookAt(camera.position.clone().add({x:0,y:400,z:1000}));syncPose?.();};
  $('benchmark-rock-close').onclick=()=>{stop();suite=null;reset('cliffs');camera.position.set(-2940,8,-2320);camera.lookAt(camera.position.clone().set(-2820,24,-2240));syncPose?.();};
  $('benchmark-beach-eye').onclick=()=>{stop();suite=null;reset('bay');camera.position.set(9120,terrainHeight(9120,2330)+1.7,2330);camera.lookAt(camera.position.clone().set(9164,.8,2338));syncPose?.();};
  $('benchmark-shore-close').onclick=()=>{stop();suite=null;reset('bay');camera.position.set(9151,1.85,2330);camera.lookAt(camera.position.clone().set(9147,-.5,2325));syncPose?.();};
  $('benchmark-shore').onclick=()=>{if(replay){cancel('user stopped');return}stop();tick=0;samples=[];interrupted=null;setTime(60);replay={position:camera.position.clone(),quaternion:camera.quaternion.clone(),start:performance.now(),mode:'shore',ticks:2520};$('benchmark-replay').textContent='停止播放'};
  $('benchmark-suite').onclick=()=>{stop();suite={index:0,results:[],frames:[],start:performance.now()};reset(ids[0]);};
  $('benchmark-save').onclick = () => { pendingCapture = true }
  $('benchmark-export').onclick = () => {
    capture('export-state', { ready: settled >= 30, interrupted })
    const blob = new Blob([JSON.stringify({ schema: 'island-world-review-v1', createdAt: new Date().toISOString(), baseline: 'f0092ff87a9372342f168c20ec7f52a6b165b8bb', humanVerdict: 'pending', errors, gpuTiming: 'unavailable', realMobile: 'not tested', userAgent: navigator.userAgent, records }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = `island-world-review-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function cancel(reason) {
    if (!replay) return
    if(recorder?.state==='recording')recorder.stop();
    if (replay) capture('replay-interrupted', { reason, completed: false, samples })
    if(replay?.mode==='dpr')setReviewDpr(replay.previousDpr);
          syncPose?.(); replay = null; interrupted = reason; $('benchmark-replay').textContent = '横移往返 · 12 秒'
  }
  updateLabel(); $('benchmark-note').textContent = observations[current] || observations.forest; setTime(60)
  return {
    get active() { return Boolean(replay) },
    get time() { return 60 + tick / 60 },
    cancel,
    destination(id) { panel.dataset.ready='false'; current = id; tick = 0; settled = 0; setTime(60); $('benchmark-note').textContent = observations[id] || ''; },
    beforeFrame() {
      if (!replay || replay.mode==='shore') return
      if(replay.mode==='continuity'){const distance=45*(1-Math.cos(tick/1440*Math.PI*2));camera.position.copy(replay.position);camera.position.x-=Math.sin(replay.yaw)*distance;camera.position.z-=Math.cos(replay.yaw)*distance;camera.quaternion.copy(replay.quaternion);camera.rotation.y+=.12*Math.sin(tick/1440*Math.PI*4);return;}
      if(replay.mode==='sky'){camera.position.copy(replay.position);camera.position.x+=80*Math.sin(tick/1440*Math.PI*2);camera.rotation.set(.28+.16*Math.sin(tick/1440*Math.PI*4),replay.yaw+tick/1440*Math.PI*2,0);return;}
      if(replay.mode==='dpr'){if(tick%180===0)setReviewDpr([.73,1,1.6,2][Math.floor(tick/180)]);return;}
      if(replay.mode==='walk'){
        const z=-680-tick/720*26,x=trailX(z),y=terrainHeight(x,z)+1.75;camera.position.set(x,y,z);camera.lookAt(camera.position.clone().set(trailX(z-15),terrainHeight(trailX(z-15),z-15)+2.1,z-15));return;
      }
      // 16 m to the right and back, exactly 720 simulation ticks. No camera cuts.
      const distance = 8 * (1 - Math.cos(2 * Math.PI * tick / 720))
      camera.position.copy(replay.position)
      camera.position.x += Math.cos(camera.rotation.y) * distance
      camera.position.z -= Math.sin(camera.rotation.y) * distance
      camera.quaternion.copy(replay.quaternion)
    },
    afterFrame(raw, state) {
      const afterEvidenceReadback=evidenceReadback;evidenceReadback=false;
      const signature = JSON.stringify([state.position, state.quaternion, state.drawSize, state.quality, state.variant])
      const jobsReady = !state.terrain.pending && !state.vegetation.pending && !state.flow.pending && !state.vegetation.error && !state.flow.error && (state.flow.exposure?.valid??true) && !state.flow.exposure?.error
      settled = jobsReady && signature === lastSignature ? settled + 1 : 0; lastSignature = signature
      const ready = settled >= 30 && !state.programErrors && errors.length === 0
      if(suite){
        if(ready)suite.frames.push(raw);
        const failed=Boolean(state.programErrors||state.vegetation.error||state.flow.error||errors.length||performance.now()-suite.start>60000);
        if(suite.frames.length>=90||failed){
          const sorted=[...suite.frames].sort((a,b)=>a-b),checks={resourcesReady:jobsReady,noProgramErrors:!state.programErrors,noRuntimeErrors:errors.length===0,finitePose:state.position.every(Number.isFinite),positiveDrawSize:state.drawSize.every(n=>n>0)};
          const passed=!failed&&Object.values(checks).every(Boolean);
          capture('site-check',{ready,passed,checks,frameMs:{p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]},image:canvas.toDataURL('image/png')});
          suite.results.push({place:current,passed});suite.index++;
          if(suite.index===ids.length||failed){capture('suite-complete',{completed:!failed,passed:suite.results.length===ids.length&&suite.results.every(r=>r.passed),results:suite.results});suite=null;}
          else{suite.frames=[];suite.start=performance.now();reset(ids[suite.index]);return;}
        }
      }
      if (pendingCapture) { capture('still', { ready, image: canvas.toDataURL('image/png') }); pendingCapture = false }
      panel.dataset.ready = String(ready)
      panel.dataset.snapshot = JSON.stringify({ ...state, tick, time: this.time, ready })
      if (replay && (state.programErrors || state.vegetation.error || state.flow.error || performance.now() - replay.start > 120000)) cancel('resource error or replay timeout')
      if (replay) {
        samples.push({ tick, frameMs: raw, afterEvidenceReadback, clearance:state.clearance,exposure:state.exposure,skyCache:state.skyCache,cpu: { ...state.cpu }, pending: !jobsReady, shadow: state.shadow, position: state.position, drawCalls: state.drawCalls, triangles: state.triangles })
        if(replay.mode==='dpr'&&tick%180===179){capture('sky-stripe-audit',{result:auditSky()});evidenceReadback=true;}
        if(jobsReady&&tick%180===0)capture('motion-frame',{image:canvas.toDataURL('image/png')});
        if (jobsReady) tick++
        if (tick > (replay.ticks??720)) {
          tick = replay.ticks??720
          const ordered = samples.map(s => s.frameMs).sort((a, b) => a - b)
          const clean=samples.filter(s=>!s.afterEvidenceReadback).map(s=>s.frameMs).sort((a,b)=>a-b);
          capture(replay.mode==='shore'?'shore-cycle':replay.mode==='walk'?'trail-walk':replay.mode==='sky'?'sky-orbit':replay.mode==='dpr'?'dpr-matrix':replay.mode==='continuity'?'continuity':'replay', { completed: true, renderingFrameMs:{p50:clean[Math.floor(clean.length*.5)],p95:clean[Math.floor(clean.length*.95)],max:clean.at(-1)},evidenceReadbackFrames:samples.filter(s=>s.afterEvidenceReadback).length, startPosition: replay.position.toArray(), endPosition: camera.position.toArray(), wallMs: performance.now() - replay.start, frameMs: { p50: ordered[Math.floor(ordered.length * .5)], p95: ordered[Math.floor(ordered.length * .95)], max: ordered.at(-1) }, samples })
          if(recorder?.state==='recording')recorder.stop();
          if(replay?.mode==='dpr')setReviewDpr(replay.previousDpr);
          syncPose?.(); replay = null; $('benchmark-replay').textContent = '横移往返 · 12 秒'
        }
      }
      $('benchmark-status').textContent = `${replay ? `${replay.mode==='shore'?'岸浪':replay.mode==='walk'?'步行':'横移'} ${Math.min(tick,replay.ticks??720)} / ${replay.ticks??720}` : ready ? '画面就绪' : errors.length || state.programErrors || state.vegetation.error || state.flow.error ? '资源出错，不能验收' : '等待局部资源与画面稳定'} · 世界 ${this.time.toFixed(2)} 秒 · ${state.drawSize.join('×')} · 已记录 ${records.length} 项`
    },
  }
}
