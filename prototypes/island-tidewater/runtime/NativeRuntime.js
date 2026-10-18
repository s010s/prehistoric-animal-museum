import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { G } from '../vendor/tidewater/src/core/Globals.js';
import { FrameTimer } from './FrameTimer.js';
import {RegionMap} from '../creek/RegionMap.js';
import buildInfo from './build-info.json';
import {bindSceneReport} from './SceneReport.js';

const quantile = (a, q) => { const v = a.slice().sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) * q)] : null; };
const pause = ms => new Promise(r => setTimeout(r, ms));
export class NativeRuntime {
  constructor(app, kind) {
    this.app = app; this.kind = kind; this.phase = 'loading'; this.running = false;
    this.events = []; this.callbacks = []; this.frames = []; this.errors = []; this.recording = false;
    this.timer = new FrameTimer(); this.loadedAt = null; this.lastCallback = null; this.lastSubmit = null;
    this.inFlight = 0; this.targetFps = 60; this.frameToleranceMs = 1;
    this.cpu = {}; this.lastFrame = null; this.cancelled = false; this.lost = false;
    this.loaderStarted = performance.now();
    bindSceneReport(this,buildInfo);
    const reportError = console.error.bind(console);
    console.error = (...args) => { reportError(...args); this.fail(args.map(x => x?.message ?? String(x)).join(' ')); };
    const hudToggle=document.querySelector('#hud-toggle');if(hudToggle)hudToggle.onclick=()=>{const collapsed=document.body.classList.toggle('hud-collapsed');hudToggle.textContent=collapsed?'展开导览':'收起导览';hudToggle.setAttribute('aria-expanded',String(!collapsed));hudToggle.setAttribute('aria-label',collapsed?'展开导览面板':'收起导览面板');};
    document.querySelector('#pause').onclick = () => this.running ? this.stop('user') : this.resume();
    document.querySelector('#capture').onclick = () => this.saveObservation();
    document.querySelector('#measure').onclick = () => this.measure().catch(e => this.fail(e));
    const video=document.querySelector('#record-video');if(video)video.onclick=()=>this.recordVideo().catch(error=>{this.videoResult={status:'failed',message:String(error)};this.event('video-unavailable',{message:String(error)});this.publish();document.querySelector('#status').textContent='本次录像未保存 · '+error.message;});
    document.querySelector('#cancel').onclick = () => { this.cancelled = true; this.stop('loading cancelled'); GPU.device?.destroy(); };
    document.querySelector('#scale').onchange = event => {
      if (this.phase !== 'ready' || this.recording || this.measuring || this.walkingSample || this.recordingVideo) return;
      this.app.setRenderScale(Number(event.target.value)); this.resetHistory();
      this.event('scale', { value: this.app.settings.renderScale }); this.publish();
    };
    const density=document.querySelector('#output-density');if(density)density.onchange=()=>{if(this.phase!=='ready'||this.measuring||this.recordingVideo||this.recordingAudio)return;this.app.engine.setRenderScale(Number(density.value));this.resetHistory();this.event('output-density',{value:Number(density.value)});this.resume();this.publish();};
    for (const button of document.querySelectorAll('[data-animal]')) button.onclick = () => { if (this.recording || this.measuring || this.walkingSample) return; app.animals?.lookAt(button.dataset.animal); this.resetHistory(); if (this.phase === 'ready') this.resume(); };
    document.querySelector('#walk').onclick = () => { if (this.phase !== 'ready' || this.recording || this.measuring || this.walkingSample) return; app.freeCam = false; app.dropPlayerAtCamera(); this.resetHistory(); this.event('native-ground-walk'); this.resume(); };
    const fly=document.querySelector('#fly');if(fly)fly.onclick=()=>{if(this.phase!=='ready'||this.recording||this.measuring||this.walkingSample)return;app.setFreeCam(!app.freeCam);this.event('free-flight',{enabled:app.freeCam});this.resume();};
    const region=document.querySelector('#region-place');if(region)region.onchange=()=>{if(this.phase!=='ready'||this.measuring||this.recordingVideo)return;app.showLandmark(region.value);this.clearInput();this.resetHistory();this.resume();};
    const light=document.querySelector('#light-time');if(light)light.onchange=()=>{if(this.phase!=='ready'||this.measuring||this.recordingVideo)return;app.settings.timeOfDay=light.value==='auto'?(app.islandVisits?.[app.currentLandmark]?.time??12.6):Number(light.value);app.updateSun();this.resetHistory();this.event('light-time',{hour:app.settings.timeOfDay});this.resume();};
    const speed=document.querySelector('#flight-speed');if(speed)speed.onchange=()=>{app.fly.speed=Number(speed.value);app.fly.velocity.set(0,0,0);this.event('flight-speed',{metresPerSecond:app.fly.speed,shiftMultiplier:6});this.publish();};
    const duration=document.querySelector('#duration');if(duration)duration.onchange=()=>{if(this.running){this.deadline=Number(duration.value)>0?performance.now()+Number(duration.value)*1000:Infinity;}this.event('observation-duration',{seconds:Number(duration.value)});this.publish();};
    const waterDebug=document.querySelector('#water-debug');if(waterDebug)waterDebug.onchange=()=>{if(this.phase!=='ready'||this.recording||this.measuring||this.walkingSample)return;for(const m of [app.water?.material,app.oceanMaterial])if(m?.debugMode)m.debugMode.value=Number(waterDebug.value);this.resetHistory();this.event('water-debug',{mode:Number(waterDebug.value)});this.publish();};
    const grassDistance=document.querySelector('#grass-distance');if(grassDistance)grassDistance.onchange=()=>{if(this.phase!=='ready'||this.measuring||this.recordingVideo||this.recordingAudio||this.walkingSample)return;app.vegetation?.grass?.setFarRange(Number(grassDistance.value));this.resetHistory();this.event('grass-distance',{metres:Number(grassDistance.value)});this.resume();this.publish();};
    const grassVisible=document.querySelector('#grass-visible');if(grassVisible)grassVisible.onchange=()=>{app.vegetation?.grass?.setVisible(grassVisible.checked);this.resetHistory();this.publish();};
    const boundsAudit=document.querySelector('#grass-bounds-audit');if(boundsAudit)boundsAudit.onchange=()=>{app.vegetation?.grass?.setBoundsAudit(boundsAudit.checked);this.publish();};
    const oldBounds=document.querySelector('#grass-legacy-bounds');if(oldBounds)oldBounds.onchange=()=>{app.vegetation?.grass?.setLegacyBounds(oldBounds.checked);this.resetHistory();this.publish();};
    const oldCloudShadow=document.querySelector('#cloud-legacy-centre');if(oldCloudShadow)oldCloudShadow.onchange=()=>{app.clouds?.setLegacyShadowRecentre(oldCloudShadow.checked);this.resetHistory();this.publish();};
    const cloudShadow=document.querySelector('#cloud-shadow-visible');if(cloudShadow)cloudShadow.onchange=()=>{if(app.clouds?.shadowStrength)app.clouds.shadowStrength.value=cloudShadow.checked ? .85 : 0;this.resetHistory();this.publish();};
    const inlandBedLegacy=document.querySelector('#inland-bed-legacy');if(inlandBedLegacy)inlandBedLegacy.onchange=()=>{app.terrain.review.fields.inlandBedLegacy.value=inlandBedLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const bedDebug=document.querySelector('#bed-debug');if(bedDebug)bedDebug.onchange=()=>{app.terrain.review.fields.bedDebug.value=Number(bedDebug.value);this.resetHistory();this.resume();this.publish();};
    const hillShadow=document.querySelector('#hill-shadow-visible');if(hillShadow)hillShadow.onchange=()=>{app.terrainGPU.hillShadowEnabled=hillShadow.checked;app.terrainGPU.uSunBaked.value=hillShadow.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const terrainShadow=document.querySelector('#terrain-shadow-cast');if(terrainShadow)terrainShadow.onchange=()=>{app.terrain.mesh.castShadow=terrainShadow.checked;this.resetHistory();this.resume();this.publish();};
    const habitatLegacy=document.querySelector('#habitat-legacy-water');if(habitatLegacy)habitatLegacy.onchange=()=>{app.creekData.appearance.review.fields.legacyWater.value=habitatLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    for(const id of ['ground-snow','ground-bump','ground-filtered']){const e=document.querySelector('#'+id);if(e)e.onchange=()=>{const key=id.slice(7);if(app.terrain?.review)app.terrain.review.fields[key].value=e.checked?1:0;this.resetHistory();this.resume();this.publish();};}
    const reefVisible=document.querySelector('#reef-visible');if(reefVisible)reefVisible.onchange=()=>{app.shelfReef.enabled=reefVisible.checked;this.resetHistory();this.resume();this.publish();};
    const seabedLegacy=document.querySelector('#seabed-legacy');if(seabedLegacy)seabedLegacy.onchange=()=>{if(app.terrain?.review)app.terrain.review.fields.seabedLegacy.value=seabedLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const surfWindowLegacy=document.querySelector('#surf-window-legacy');if(surfWindowLegacy)surfWindowLegacy.onchange=()=>{app.shoreSim.presentation.fields.legacy.value=surfWindowLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const shoreLegacy=document.querySelector('#shore-legacy');if(shoreLegacy)shoreLegacy.onchange=()=>{app.oceanSurface.shoreReview.fields.legacy.value=shoreLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const caustics=document.querySelector('#caustics-visible');if(caustics)caustics.onchange=()=>{if(app.caustics)app.caustics.params.fields.strength.value=caustics.checked ? .75 : 0;this.resetHistory();this.resume();this.publish();};
    for(const [id,key] of [['ocean-visible','reviewOcean'],['inland-visible','reviewInland']]){const e=document.querySelector('#'+id);if(e)e.onchange=()=>{app[key]=e.checked;this.resetHistory();this.publish();};}
    const medium=document.querySelector('#medium-visible');if(medium)medium.onchange=()=>{if(app.underwater)app.underwater.enabled.value=medium.checked?1:0;this.resetHistory();this.publish();};
    const riverRipples=document.querySelector('#river-ripples');if(riverRipples)riverRipples.onchange=()=>{app.water.surface.params.fields.rippleScale.value=riverRipples.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const riverSSR=document.querySelector('#river-ssr');if(riverSSR)riverSSR.onchange=()=>{if(this.phase!=='ready')return;app.water.material.params.ssr.value=riverSSR.checked?1:0;this.resetHistory();this.publish();};
    const inlandPathLegacy=document.querySelector('#inland-path-legacy');if(inlandPathLegacy)inlandPathLegacy.onchange=()=>{app.water.material.depthReview.fields.pathLegacy.value=inlandPathLegacy.checked?1:0;this.resetHistory();this.resume();this.publish();};
    const legacyDepth=document.querySelector('#legacy-ocean-depth');if(legacyDepth)legacyDepth.onchange=()=>{if(this.measuring||this.recording)return;app.oceanMaterial.depthReview.fields.pixelDepth.value=legacyDepth.checked?0:1;this.resetHistory();this.event('sea-depth-review',{pixelDepth:!legacyDepth.checked});this.publish();};
    const aaReview=document.querySelector('#aa-review');if(aaReview)aaReview.onchange=()=>{if(this.phase!=='ready'||this.recordingVideo||this.measuring)return;app.post.aaMode=aaReview.value;this.resetHistory();this.resume();this.event('aa-review',{mode:aaReview.value});this.publish();};
    const sharpenReview=document.querySelector('#sharpen-review');if(sharpenReview)sharpenReview.onchange=()=>{if(this.phase!=='ready'||this.recordingVideo||this.measuring)return;app.post.params.sharpen.value=Number(sharpenReview.value);this.resetHistory();this.resume();this.event('sharpen-review',{value:app.post.params.sharpen.value});this.publish();};
    const fixedPost=document.querySelector('#fixed-post');if(fixedPost)fixedPost.onchange=()=>{if(this.phase!=='ready'||this.recordingVideo||this.measuring)return;app.post.autoExposure.enabled.value=fixedPost.checked?0:1;app.post.params.grain.value=fixedPost.checked?0:.012;this.resetHistory();this.resume();this.event('post-review',{fixed:fixedPost.checked});this.publish();};
    const canopyReview=()=>{if(this.phase!=='ready'||this.recording||this.measuring||this.walkingSample||this.recordingVideo)return;app.vegetation?.setReview?.({coverage:document.querySelector('#canopy-coverage')?.value??.5,shade:document.querySelector('#canopy-shade')?.value??0,mode:document.querySelector('#canopy-mode')?.value??0,wind:document.querySelector('#canopy-wind')?.checked??true,parallax:document.querySelector('#canopy-parallax')?.checked??false,thinning:document.querySelector('#canopy-thinning')?.checked??false,solo:document.querySelector('#canopy-solo')?.checked??false,shadows:document.querySelector('#canopy-shadows')?.checked??true});this.resetHistory();this.event('canopy-review');this.publish();};
    for(const id of ['canopy-coverage','canopy-shade','canopy-mode','canopy-parallax','canopy-wind','canopy-thinning','canopy-solo','canopy-shadows']){const element=document.querySelector('#'+id);if(element)element.onchange=canopyReview;}
    document.querySelector('#walk-sample').onclick = () => this.walkSample().catch(e => this.fail(e));
    for (const button of document.querySelectorAll('[data-place], [data-water-view]')) button.onclick = () => {
      if (this.phase !== 'ready' || this.recording || this.measuring || this.walkingSample) return;
      try {
        if (button.dataset.place) app.showLandmark?.(button.dataset.place);
        else app.waterView?.(button.dataset.waterView);
        this.resetHistory(); this.event('viewpoint', { place: button.dataset.place ?? button.dataset.waterView }); this.resume();
      } catch (error) { this.fail(error); }
    };
    const shelfReport=document.querySelector('#shelf-report');if(shelfReport)shelfReport.onclick=async()=>{if(this.phase!=='ready'||this.recording||this.measuring||this.recordingVideo)return;await this.save('acceptance',{kind:'continuous-shelf-depth-audit',build:buildInfo,coast:app.creekData.cove.continuous.audit,state:this.state()});document.querySelector('#status').textContent='环岛岸线与水深剖面已保存';};
    const coastPlace=document.querySelector('#coast-place');if(coastPlace)coastPlace.onchange=()=>{if(this.phase!=='ready'||this.recording||this.measuring||this.recordingVideo)return;app.showLandmark(coastPlace.value);this.resetHistory();this.resume();};
    const sound=document.querySelector('#sea-sound');if(sound)sound.onclick=async()=>{if(this.phase!=='ready'||this.measuring||this.recording)return;if(!this.running)this.resume();await app.audio.toggle();this.event('sea-sound',{requested:app.audio.choice});this.publish();};
    const forestAir=document.querySelector('#forest-air');if(forestAir)forestAir.onchange=()=>{app.haze?.setLocalEnabled(forestAir.checked);if(app.airMotes)app.airMotes.active=forestAir.checked;this.resetHistory();this.resume();};
    const lifeVisible=document.querySelector('#life-visible');if(lifeVisible)lifeVisible.onchange=()=>{if(app.life){app.life.enabled=lifeVisible.checked;this.resetHistory();this.resume();}};
    const volume=document.querySelector('#sound-volume');if(volume)volume.oninput=()=>{app.audio?.setMasterVolume(Number(volume.value));this.publish();};
    const audioRecord=document.querySelector('#record-audio');if(audioRecord)audioRecord.onclick=async()=>{if(this.recordingAudio||this.recording||this.measuring||this.recordingVideo||this.walkingSample)return;this.recordingAudio=true;audioRecord.disabled=true;document.querySelector('#inspection')?.removeAttribute('open');try{const data=await app.audio.record(Number(document.querySelector('#audio-length')?.value??20),document.querySelector('#audio-scope')?.value??'mix');await this.save('audio',{...data,build:buildInfo,scene:this.state()});}catch(error){document.querySelector('#status').textContent=error.message;}finally{this.recordingAudio=false;audioRecord.disabled=false;}};
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop('hidden'); });
    window.addEventListener('blur', () => { if (this.phase === 'ready') this.stop('blur'); });
    window.addEventListener('keydown', event => { if (event.code === 'Escape' && this.phase === 'ready' && this.running) this.stop('escape'); });
    window.addEventListener('pagehide', () => this.stop('pagehide'));
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.app.engine?.domElement;
      const released = this.wasLocked && !locked;
      this.wasLocked = locked;
      const hint=document.querySelector('#pointer-note');if(locked&&hint)hint.hidden=true;
      this.event('pointer-lock', { locked });
      if (released && this.running) this.stop('pointer-unlocked');
      else this.publish();
    });
    document.addEventListener('pointerlockerror', () => {
      // A browser can briefly reject re-locking immediately after Esc. Keep
      // rendering and allow another explicit click or the native drag gesture.
      this.event('pointer-lock-rejected');
      const hint = document.querySelector('#pointer-note');
      if (hint) {hint.hidden=false;hint.textContent = '鼠标尚未锁定，可按住鼠标拖动环顾，或稍后再点击画面。';}
    });
    window.addEventListener('error', event => this.fail(event.error ?? event.message));
    window.addEventListener('unhandledrejection', event => this.fail(event.reason));
    this._loop = t => this.loop(t);
    this.raf = requestAnimationFrame(this._loop);
  }
  event(kind, detail = {}) { this.events.push({ at: performance.now(), kind, ...detail }); }
  renderSceneStill(){
    const start=performance.now();this.app.frame(0);this.inFlight++;
    GPU.queue.onSubmittedWorkDone().then(()=>this.inFlight--,error=>{this.inFlight--;this.fail(error);});
    this.lastFrame={t:start,frame:GPU.frame,interval:0,dt:0,worldTime:G.time.value,camera:this.app.camera.position.toArray(),quaternion:this.app.camera.quaternion.toArray(),cpuFrameMs:performance.now()-start,captureOnly:true};
  }
  progress(p, text) {
    if (this.cancelled || this.lost || this.errors.length) throw Error('Native scene loading cancelled or failed');
    if (performance.now() - this.loaderStarted > 180000) throw Error('Native scene loading exceeded 180 seconds');
    document.querySelector('#status').textContent = `${Math.round(p * 100)}% · ${text}`;
    this.attachDevice();
  }
  attachDevice() {
    if (!GPU.device || this.observedDevice) return;
    this.observedDevice = GPU.device;
    GPU.device.addEventListener('uncapturederror', event => this.fail(event.error?.message ?? 'WebGPU validation error'));
    GPU.device.lost.then(info => { this.lost = true; this.fail(`WebGPU device lost: ${info.message}`); });
  }
  track(object, method, label) {
    if (!object || typeof object[method] !== 'function') return;
    const original = object[method];
    object[method] = (...args) => {
      const start = performance.now();
      try { return original.apply(object, args); }
      finally { this.cpu[label] = (this.cpu[label] ?? 0) + performance.now() - start; }
    };
  }
  ready() {
    if (this.errors.length || this.cancelled) throw Error('Native initialization failed; inspect saved errors');
    this.phase = 'ready'; this.loadedAt = performance.now(); this.attachDevice();
    this.app.engine.domElement.addEventListener('click', () => {
      if (this.recording || this.measuring || this.walkingSample) return;
      if (!this.running) { this.clearInput(); this.event('canvas-reenter'); this.resume(); }
    });
    const enter = document.querySelector('#enter-scene');
    if (enter) enter.onclick = () => {
      if (this.recording || this.measuring || this.walkingSample) return;
      this.clearInput(); this.resume(); this.app.input.requestLock();
    };
    for (const [key, method, label] of [
      ['animals', 'update', 'animals'], ['player', 'update', 'navigation'], ['fly', 'update', 'flyCamera'],
      ['terrain', 'update', 'terrain'], ['vegetation', 'update', 'vegetation'], ['debris', 'update', 'debris'],
      ['clouds', 'update', 'clouds'], ['environment', 'update', 'environment'], ['fft', 'update', 'oceanFFT'],
      ['shoreSim', 'update', 'shoreSimulation'], ['sceneRenderer', 'render', 'sceneRenderInclusive'],
      ['shadows', 'render', 'shadows'], ['post', 'render', 'post'],
    ]) this.track(this.app[key], method, label);
    this.animalPassVisits = {};
    for (const animal of this.app.animals?.state() ?? []) this.animalPassVisits[animal.id] = {};
    const renderer = this.app.engine.meshRenderer, render = renderer.render.bind(renderer);
    renderer.render = (scene, pass) => { const before = this.currentPass; this.currentPass = pass.kind; try { return render(scene, pass); } finally { this.currentPass = before; } };
    this.app.animals?.instrumentPassVisits(id => { const pass = this.currentPass ?? 'unknown'; const counts = this.animalPassVisits[id]; counts[pass] = (counts[pass] ?? 0) + 1; });
    if(this.app.audio)this.app.audio.onStateChange=()=>this.publish();
    if(this.kind==='museum-creek')this.app.regionMap=new RegionMap(this.app,place=>{if(this.phase!=='ready'||this.recording||this.measuring||this.walkingSample||this.recordingVideo||this.recordingAudio)return false;this.clearInput();this.app.showLandmark(place);this.resetHistory();this.event('map-travel',{place});this.resume();return true;});
    this.event('ready', { loadMs: this.loadedAt - this.loaderStarted });
    document.querySelector('#cancel').hidden = true;
    for (const button of document.querySelectorAll('[data-ready]')) button.disabled = false;
    this.resume();
  }
  resetHistory() {
    this.app.animals?.hold();
    if(this.app.haze)this.app.haze._histValid=false;
    this.app.clouds?.resetHistory?.();
    const temporal = this.app.post?.taau;
    if (temporal) temporal._needsRestart = true;
    if (this.app.post) { this.app.post._hasPrev = false; this.app.post.motionBlur._hasPrev = false; }
    this.app.scene?.traverse(o => { if (o.isMesh) o.resetVelocity = true; });
    this.lastSubmit = null;
  }
  resume() {
    if (this.phase !== 'ready' || this.lost || this.errors.length) return;
    if (this.recording) this.interruptedDuringTiming = true;
    this.resetHistory(); this.running = true; this.app.audio?.setPaused?.(false).catch(e=>this.event('audio-state-error',{message:String(e)})); this.deadline = Number(document.querySelector('#duration')?.value??45)>0?performance.now()+Number(document.querySelector('#duration')?.value??45)*1000:Infinity;
    this.event('resume'); document.querySelector('#pause').textContent = '暂停'; this.publish();
  }
  stop(reason) {
    if (this.recording) this.interruptedDuringTiming = true;
    this.running = false; this.app.audio?.setPaused?.(true).catch(e=>this.event('audio-state-error',{message:String(e)})); if (!this.lost && this.phase !== 'error') this.app.animals?.hold();
    this.clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
    this.event('pause', { reason, gpuFrame: GPU.frame, worldTime: G.time.value });
    document.querySelector('#pause').textContent = this.kind==='museum-creek'?'继续观察':'继续观察 45 秒';
    if (this.phase === 'ready') document.querySelector('#status').textContent = `已暂停 · ${reason}`;
    this.publish();
  }
  clearInput() {
    const input = this.app.input;
    if (!input) return;
    input.keys.clear(); input.pressed.clear(); input.look.x = input.look.y = 0;
    input.wheel = 0; input.mouseDown = input.rightDown = false;
    this.app.fly?.velocity.set(0,0,0);
  }
  fail(error) {
    const message = String(error?.message ?? error);
    if (this.cancelled && message.includes('destroy')) return;
    if (this.errors.at(-1)?.message === message) return;
    this.errors.push({ at: performance.now(), message }); this.running = false; this.phase = 'error';
    this.event('error', { message }); document.querySelector('#status').textContent = message;
    this.publish();
  }
  loop(t) {
    const callbackStart = performance.now();
    this.raf = requestAnimationFrame(this._loop);
    const callbackInterval = this.lastCallback === null ? null : t - this.lastCallback;
    this.lastCallback = t;
    // rAF timestamps jitter around display ticks. Compare with the last actual
    // submission, so an epoch boundary cannot create alternating25ms/8ms pairs.
    const tooSoon = this.lastSubmit !== null && t - this.lastSubmit < 1000 / this.targetFps - this.frameToleranceMs;
    const reason = this.phase !== 'ready' ? this.phase : document.hidden ? 'hidden' : !this.running ? 'paused' : this.lost ? 'device-lost' : t >= this.deadline ? 'observation-deadline' : tooSoon ? 'frame-budget' : this.inFlight >= 2 ? 'gpu-backpressure' : null;
    const callback = { t, interval: callbackInterval, callbackStart, latenessMs: callbackStart - t, attempted: !reason, submitted: false, reason };
    if (this.recording) this.callbacks.push(callback);
    if (reason) { if (reason === 'observation-deadline' && this.running) this.stop(reason); return; }
    const interval = this.lastSubmit === null ? null : t - this.lastSubmit;
    const dt = this.lastSubmit === null ? 1 / 60 : Math.min(.1, Math.max(0, interval / 1000));
    this.lastSubmit = t; this.cpu = {};
    const start = performance.now();
    try { this.videoMotion?.(callbackStart); this.app.frame(dt); }
    catch (error) { this.fail(error); return; }
    this.inFlight++;
    // Asynchronous resource/backpressure bound, not a GPU timing measurement.
    GPU.queue.onSubmittedWorkDone().then(() => this.inFlight--, error => { this.inFlight--; this.lost = true; this.fail(error); });
    callback.submitted = true;
    const row = { t, frame: GPU.frame, interval, dt, worldTime: G.time.value, camera: this.app.camera.position.toArray(), quaternion: this.app.camera.quaternion.toArray(), cpuFrameMs: performance.now() - start, cpu: { ...this.cpu } };
    this.lastFrame = row;
    if (this.recording) this.frames.push(row);
    if (!this.lastHUD || t - this.lastHUD > 500) { this.lastHUD = t; this.publish(); }
    row.cpuCallbackMs = performance.now() - callbackStart;
    row.cpuInstrumentationMs = row.cpuCallbackMs - row.cpuFrameMs;
  }
  state() {
    const a = this.app;
    return {
      schema: 'museum-tidewater-native-observation-v1', kind: this.kind, upstream: '4811ba48d795197de5621985f404e765c0b7c0ef', build: buildInfo,
      phase: this.phase, running: this.running, remainingSeconds: this.running ? Number.isFinite(this.deadline)?Math.max(0,(this.deadline-performance.now())/1000):null : 0,
      flightSpeed:this.app.fly?{metresPerSecond:this.app.fly.speed,shiftMultiplier:6}:null,
      observationDurationSeconds:Number(document.querySelector('#duration')?.value??45),
      deviceLimits:GPU.device?Object.fromEntries(['maxSampledTexturesPerShaderStage','maxSamplersPerShaderStage','maxStorageBuffersPerShaderStage'].map(k=>[k,GPU.device.limits[k]])):null,
      gpuFrame: GPU.frame, worldTime: G.time.value, camera: a.camera ? { position: a.camera.position.toArray(), quaternion: a.camera.quaternion.toArray(), freeCam: a.freeCam } : null,
      output: a.engine?.canvas ? [a.engine.width, a.engine.height] : null,
      internal: a.sceneRenderer?.sceneRT ? [a.sceneRenderer.sceneRT.width, a.sceneRenderer.sceneRT.height] : null,
      inspectionOpen:document.querySelector('#inspection')?.open??false,sceneReport:this.sceneReport??null,
      sceneCapture:this.sceneCapture??null,
      recordingVideo:!!this.recordingVideo,videoResult:this.videoResult??null,
      input: a.input ? { locked:a.input.locked, keys:[...a.input.keys], mouseDown:a.input.mouseDown, rightDown:a.input.rightDown, look:{...a.input.look} } : null,
      interactionEvents:this.events.filter(e=>['pointer-lock','pointer-lock-rejected','canvas-reenter','pause','resume'].includes(e.kind)).slice(-12),
      sceneConditions:{timeOfDay:a.settings.timeOfDay,windSpeed:G.windSpeed.value,exposure:a.settings.exposure,autoExposure:a.post?.autoExposure.enabled.value,filmGrain:a.post?.params.grain.value,sharpen:a.post?.params.sharpen.value,jitterMoving:a.post?.taau?.jitterMoving},
      renderScale: a.settings.renderScale, aaMode: a.post?.aaMode,
      antiAlias:a.post?{requested:a.post.aaMode,lookupTexturesReady:!!(a.post.aa.area&&a.post.aa.search),smaaBuilt:!!a.post.aa._smaa,actualPreFilter:a.post.aaMode==='smaataa'?(a.post.aa.area&&a.post.aa.search?'smaa':'fxaa fallback'):'none'}:null,
      systems: Object.fromEntries(['atmosphere', 'sky', 'clouds', 'environment', 'terrain', 'vegetation', 'shadows', 'fft', 'shoreSim', 'refraction', 'underwater', 'haze', 'post', 'game'].map(k => [k, !!a[k]])),
      animals: a.animals?.state() ?? [], lastFrame: this.lastFrame, errors: this.errors,
      animalPassVisits: this.animalPassVisits, historyResetPending: a.post?.taau?._needsRestart,
      nativeScene: { scannedDebrisReady: a.debris?.scanned?.ready, renderStats: a.engine?.meshRenderer?.stats },
      loadMs: this.loadedAt === null ? null : this.loadedAt - this.loaderStarted,
      adapter: GPU.adapter?.info ? { vendor: GPU.adapter.info.vendor, architecture: GPU.adapter.info.architecture, device: GPU.adapter.info.device, description: GPU.adapter.info.description } : null,
      timestampSupported: GPU.hasTimestamp, pendingQueries: this.timer.pending.size, scheduler: { targetFps: this.targetFps, timestampToleranceMs: this.frameToleranceMs, gate: 'elapsed-since-last-submission', maximumInFlight: 2, currentInFlight: this.inFlight },
      slice: a.sliceState?.() ?? null,
      limitation: a.sliceState ? 'Connected museum island, nine habitats and native ocean/underwater chain. Inland SSR remains screen-limited; species-level palaeobotany, river caustics, marine gameplay and long-duration thermal stability need separate validation.' : 'Reference island with native museum animal compatibility; original museum creek, vegetation and inland water not migrated. Submitted frames do not measure compositor presentation.',
    };
  }
  publish() {
    const state = this.state();
    const capture=document.querySelector('#copy-scene');if(capture)capture.disabled=this.phase!=='ready'||this.lost||this.measuring||this.recording||this.recordingVideo||this.recordingAudio||this.walkingSample||!!this.sceneCapture?.busy;
    document.querySelector('#native-state').textContent = JSON.stringify(state, null, 2);
    document.querySelector('#dimensions').textContent = state.output ? `输出 ${state.output.join('×')} · 内部 ${state.internal?.join('×') ?? '准备中'} · 目标 60 FPS` : '完整原生场景准备中';
    const fly=document.querySelector('#fly');if(fly){fly.textContent=state.camera?.freeCam?'退出升空 · F':'自由升空 · F';fly.setAttribute('aria-pressed',String(!!state.camera?.freeCam));}
    const sound=document.querySelector('#sea-sound');if(sound&&this.app.audio){const a=this.app.audio;sound.textContent=!a.choice?'自然声：已关闭 · 点击开启':a.paused?'自然声：已暂停':a.enabled?'自然声：已开启':'自然声：点击恢复';sound.setAttribute('aria-pressed',String(a.choice));}
    const entry=document.querySelector('#scene-entry');if(entry)entry.hidden=this.phase!=='ready'||this.running||this.measuring||this.walkingSample||this.recording;
    if (this.phase === 'ready' && this.running) document.querySelector('#status').textContent = this.recordingVideo?'正在保存 12 秒动态画面 · 可正常行走':state.remainingSeconds===null?'持续观察中 · 可随时暂停':`观察中 · ${Math.ceil(state.remainingSeconds)} 秒后暂停`;
  }
  async measure() {
    if (this.phase !== 'ready' || this.recording || this.measuring || this.walkingSample || this.recordingVideo || this.recordingAudio || this.lost) return;
    this.measuring = true;
    // Repainting the live raw JSON panel changes browser presentation cost.
    // Time the normal visitor view and record this condition explicitly.
    document.querySelector('#inspection')?.removeAttribute('open');
    document.querySelector('#measure').disabled = true;
    this.resume();
    document.querySelector('#status').textContent = '预热 3 秒后采集 8 秒 · 不录制画面';
    await pause(3000);
    if (!this.running) { this.measuring = false; document.querySelector('#measure').disabled = false; this.event('timing-cancelled-during-warmup'); return; }
    const conditions = this.state();
    this.callbacks = []; this.frames = []; this.interruptedDuringTiming = false; this.recording = true; this.timer.start();
    const start = performance.now();
    await pause(8000);
    const elapsedMs = performance.now() - start;
    this.recording = false;
    const interrupted = !this.running || this.interruptedDuringTiming;
    this.stop('timing complete');
    const gpu = await this.timer.stop();
    const after = this.state();
    const fixedBuffers = JSON.stringify(conditions.output) === JSON.stringify(after.output) && JSON.stringify(conditions.internal) === JSON.stringify(after.internal) && conditions.renderScale === after.renderScale;
    const intervals = this.frames.map(f => f.interval).filter(v => v !== null);
    const gpuMs = gpu.rows.filter(r => r.status === 'valid').map(r => r.ms);
    const result = {
      schema: 'museum-native-timing-v1', passed: !interrupted && fixedBuffers && this.frames.length > 10 && !this.errors.length,
      conditions, after, fixedBuffers, interrupted, elapsedMs, submittedFps: this.frames.length / (elapsedMs / 1000),
      intervalP50: quantile(intervals, .5), intervalP95: quantile(intervals, .95), intervalP99: quantile(intervals, .99),
      cpuP50: quantile(this.frames.map(f => f.cpuFrameMs), .5), cpuP95: quantile(this.frames.map(f => f.cpuFrameMs), .95),
      callbackCpuP50: quantile(this.frames.map(f => f.cpuCallbackMs), .5), callbackCpuP95: quantile(this.frames.map(f => f.cpuCallbackMs), .95),
      gpuP50: quantile(gpuMs, .5), gpuP95: quantile(gpuMs, .95), gpu,
      callbacks: this.callbacks, frames: this.frames, events: this.events,
      capture: false, pixelReadback: false, timestampReadback: true,
      caveat: 'Sparse timestamps on actual native passes and asynchronous readbacks add overhead. No causal comparison or long-duration thermal claim from one short run.',
    };
    await this.save('timing', result);
    this.measuring = false;
    document.querySelector('#measure').disabled = false;
    document.querySelector('#status').textContent = result.passed ? `计时已保存 · 提交 ${result.submittedFps.toFixed(2)} FPS · GPU pass 区间 p50 ${result.gpuP50?.toFixed(2) ?? '不可用'} ms` : '计时中断或失败 · 原始记录已保存';
  }
  async walkSample() {
    if (this.phase !== 'ready' || this.recording || this.measuring || this.walkingSample || this.recordingAudio || this.recordingVideo) return;
    this.walkingSample = true;
    try {
      if (this.app.showLandmark) this.app.showLandmark('entrance');
      else { this.app.animals?.lookAt('apatosaurus'); this.app.freeCam = false; this.app.dropPlayerAtCamera(); }
      this.resetHistory(); this.resume();
      const before = this.state(), points = [];
      // Same native player, collision, terrain and input as WASD. No camera rail.
      const start = performance.now();
      while (performance.now() - start < 7000 && this.running && !this.lost) {
        const elapsed = performance.now() - start;
        if (elapsed > 2000 && elapsed < 6000) this.app.input.keys.add('KeyW');
        else this.app.input.keys.delete('KeyW');
        points.push({ elapsed, position: this.app.player.position.toArray(), camera: this.app.camera.position.toArray(), mode: this.app.player.mode });
        await pause(100);
      }
      this.app.input.keys.delete('KeyW');
      const complete = this.running && !this.lost;
      this.stop('ordinary walk saved');
      const after = this.state();
      const travel = points.reduce((sum, p, i) => i ? sum + Math.hypot(p.position[0] - points[i - 1].position[0], p.position[2] - points[i - 1].position[2]) : 0, 0);
      await this.save('observation', { kind: 'ordinary-native-walk', passed: complete && travel > 1, before, after, points, travelMetres: travel, events: this.events });
    } finally { this.app.input?.keys.delete('KeyW'); this.walkingSample = false; }
  }
  async recordVideo() {
    if(this.phase!=='ready'||this.recordingVideo||this.recordingAudio||this.recording||this.measuring||this.walkingSample)return;
    const canvas=this.app.engine.canvas;
    if(!canvas.captureStream||typeof MediaRecorder==='undefined')throw Error('浏览器不支持画布录像');
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mimeType)throw Error('浏览器没有可用的 WebM 编码器');
    const button=document.querySelector('#record-video'),stream=canvas.captureStream(30),chunks=[];
    this.recordingVideo=true;this.videoResult={status:'recording'};button.disabled=true;document.querySelector('#inspection')?.removeAttribute('open');
    this.resume();const before=this.state(),start=performance.now();
    const motion=document.querySelector('#motion-route')?.value??'none',motionPoints=[];this.motionSpeedBefore=this.app.fly?.speed;if(motion==='aerial'||motion==='approach')this.app.fly.speed=this.app.currentLandmark==='review-cove-boundary'?48:12;
    const turnYaw=this.app.fly?.yaw;
    if(motion==='turn'){this.clearInput();this.app.fly.velocity.set(0,0,0);this.videoMotion=now=>{const t=Math.max(0,Math.min(1,(now-start-2000)/8000));this.app.fly.yaw=turnYaw+Math.sin(t*Math.PI*2)*Math.PI/18;};}
    const motionTimer=setInterval(()=>{
      const t=performance.now()-start,keys=this.app.input.keys;
      if(motion!=='none'&&motion!=='turn'){keys.delete('KeyA');keys.delete('KeyD');keys.delete('KeyW');keys.delete('KeyS');if(t>2000&&t<10000&&this.running){keys.add(motion==='walk'?'KeyW':motion==='approach'?(t<6000?'KeyW':'KeyS'):t<6000?'KeyD':'KeyA');}}
      const life=this.app.life;motionPoints.push({elapsedMs:t,camera:this.app.camera.position.toArray(),quaternion:this.app.camera.quaternion.toArray(),running:this.running,grove:this.app.vegetation?.giantWindow?.(this.app.camera.position),life:life?{fish:life.frameSight.fish.length,shrimp:life.frameSight.shrimp.length,birds:life.frameSight.birds.length,examples:Object.fromEntries(Object.entries(life.frameSight).map(([k,v])=>[k,v.slice(0,2)]))}:null});
    },100);
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4000000});
    const onHide=()=>{if(recorder.state!=='inactive')recorder.stop();};
    window.addEventListener('pagehide',onHide,{once:true});
    try {
      await new Promise((resolve,reject)=>{
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        recorder.onstop=resolve;recorder.onerror=e=>reject(e.error??Error('录像编码失败'));
        recorder.start(1000);this.videoDeadline=setTimeout(onHide,12000);
      });
      const blob=new Blob(chunks,{type:mimeType}),bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.length>24000000)throw Error('录像超过本地体积限制');
      let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      const saved=await this.save('video',{before,after:this.state(),motion,motionPoints,events:this.events,elapsedMs:performance.now()-start,mimeType,videoBase64:btoa(binary),captureFps:30,performanceEvidence:false});
      this.videoResult={status:'saved',artifact:saved.artifact,bytes:bytes.length,motion};
      document.querySelector('#status').textContent='动态画面已保存 · 性能另行计时';
    } finally {
      clearTimeout(this.videoDeadline);clearInterval(motionTimer);this.videoMotion=null;if(motion==='turn')this.app.fly.yaw=turnYaw;if(motion==='aerial'||motion==='approach')this.app.fly.speed=this.motionSpeedBefore;for(const k of ['KeyA','KeyD','KeyW','KeyS'])this.app.input.keys.delete(k);window.removeEventListener('pagehide',onHide);
      if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(t=>t.stop());
      this.recordingVideo=false;button.disabled=false;this.publish();
    }
  }
  async saveObservation() {
    if (this.recording || this.measuring || this.walkingSample) return;
    this.stop('observation saved');
    await this.save('observation', { state: this.state(), events: this.events });
    document.querySelector('#status').textContent = '状态已保存 · 截图与动态观感独立验收';
  }
  async save(kind, data) {
    const response = await fetch('/__native-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, app: this.kind, data }) });
    if (!response.ok) throw Error(`Local evidence sink returned ${response.status}`);
    const result = await response.json();
    document.querySelector('#saved').textContent = result.artifact;
    return result;
  }
}
