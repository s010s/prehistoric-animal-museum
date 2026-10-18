// Tidewater SoundScape (MIT) + its credited CC0 recordings. Keep the native
// ShoreWaves timing, spatial surf and underwater filtering, without village,
// fishing or boats; birds are explicitly environmental examples. No microphone and no autoplay.
import {SoundScape} from '../vendor/tidewater/src/audio/SoundScape.js';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';
const allowed=new Set(['surf_far','surf_crash','surf_wash','surf_backwash','under_reef','bird_forest','bird_dove','birds_dawn','gull','tern']);
export class MuseumSeaSound extends SoundScape {
 constructor({shore,field,terrain,trees=[],seaLevel=-.7}){
  super({shore:{shore,field,terrain:{size:terrain.size,origin:terrain.origin,heightAt:(x,z)=>terrain.heightAt(x,z)-seaLevel}}});
  this.treeCells=new Map();for(const r of trees){const k=Math.floor(r.x/80)+','+Math.floor(r.z/80);let c=this.treeCells.get(k);if(!c)this.treeCells.set(k,c=[]);c.push(r);}
  this.terrain=terrain;this.seaLevel=seaLevel;this.choice=false;this.paused=true;this.failures=[];this.contour=[];this._distanceAt=0;this._distance=1e4;this.peakRMS=0;
  this._swell={x:1,z:0};this.forward=new Vector3();this.up=new Vector3();this.birdEvents=[];this.birdPeakRMS=0;this.flock=[];
  try{this.savedChoice=localStorage.getItem('museum-natural-sound')??'off';}catch{this.savedChoice='off';}
  const R=terrain.res,S=terrain.size,step=2;
  for(let j=0;j<R-step;j+=step)for(let i=0;i<R-step;i+=step){const k=j*R+i,h=terrain.heights[k]-seaLevel;
   if((h>0)!==(terrain.heights[k+step]-seaLevel>0)||(h>0)!==(terrain.heights[k+step*R]-seaLevel>0))this.contour.push([-S/2+(i+.5)*S/R,-S/2+(j+.5)*S/R]);
  }
 }
 _field(x,z,out){return this._shore.field.sampleAt?this._shore.field.sampleAt(x,z,out):super._field(x,z,out);}
 _want(name){return allowed.has(name)?super._want(name):null;}
 _life(dt){super._life(dt);} _whale(){} _reel(){}
 _flock(){this.flock.length=0;for(const b of this.life?.birds??[]){if(!b.active)continue;const p=b.flyer.P.pos;this.flock.push({id:b.id,kind:b.kind,visible:true,f:{P:{pos:[p[0],p[1]-this.seaLevel,p[2]]}}});}return this.flock;}
 _perch(){const e=this.env,ix=Math.floor(e.lx/80),iz=Math.floor(e.lz/80),found=[];for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const cell=this.treeCells.get((ix+i)+','+(iz+j));if(cell)for(const t of cell){const d=Math.hypot(t.x-e.lx,t.z-e.lz);if(d>8&&d<50)found.push({t,d});}}if(!found.length)return null;found.sort((a,b)=>a.d-b.d);const t=found[Math.floor(Math.random()*Math.min(6,found.length))].t;return {x:t.x,y:t.y-this.seaLevel+Math.min(t.H*.35,8),z:t.z};}
 _shotAt(bank,cat,x,y,z,target,rate,at,ref,rolloff=1,pick=-1){
  const bird=cat==='bird'||cat==='gull'||cat==='tern',trim=cat==='bird'?4:0;
  const v=super._shotAt(bank,cat,x,y,z,target+trim,rate,at,ref,rolloff,pick);if(!v||!bird)return v;
  // The separate meter/stem is after the real HRTF and distance attenuation.
  // Normal listening still runs through the same above-water/muffle/master path.
  const pan=v.extra[1];pan.disconnect(this.above);pan.connect(this.birdBus);
  const nearest=(cat==='gull'||cat==='tern')?this.flock.filter(b=>b.kind===cat).reduce((a,b)=>{const p=b.f.P.pos,d=Math.hypot(p[0]-x,p[1]-y,p[2]-z);return !a||d<a.error?{id:b.id,error:d}:a;},null):null;
  this.birdEvents.push({time:this.ctx.currentTime,bank,category:cat,position:[x,y+this.seaLevel,z],distance:Math.hypot(x-this.env.lx,y-this.env.ly,z-this.env.lz),targetLufs:target+trim,trimDb:trim,end:v.end,sourceBird:nearest});if(this.birdEvents.length>80)this.birdEvents.shift();return v;
 }
 _warn(e){const s=String(e?.message??e);if(!this.failures.includes(s))this.failures.push(s);console.warn('Museum sea sound:',s);}
 _build(){super._build();this.ctx.addEventListener('statechange',()=>this.onStateChange?.());this.analyser=this.ctx.createAnalyser();this.analyser.fftSize=1024;this.waveform=new Float32Array(1024);this.limiter.connect(this.analyser);this.birdBus=this.ctx.createGain();this.birdAnalyser=this.ctx.createAnalyser();this.birdAnalyser.fftSize=1024;this.birdWaveform=new Float32Array(1024);this.birdBus.connect(this.birdAnalyser).connect(this.above);this._dest.birds_dawn=this.birdBus;}
 // Serialize pause/resume so rapid Escape/re-entry cannot finish with an old
 // suspend winning over a newer user gesture. Read the latest desired state.
 _syncContext(){this._contextWork=(this._contextWork??Promise.resolve()).catch(e=>this._warn(e)).then(async()=>{if(!this.ctx)return;const run=this.choice&&!this.paused;if(run&&this.ctx.state!=='running')await this.ctx.resume();else if(!run&&this.ctx.state==='running')await this.ctx.suspend();}).finally(()=>this.onStateChange?.());return this._contextWork;}
 async toggle(){
  const recover=this.choice&&!this.paused&&!this.enabled;this.choice=recover||!this.choice;
  if(this.choice){this.paused=false;const ok=await super.resume();if(!ok&&this.ctx?.state!=='interrupted'){this.choice=false;this._warn('Audio output unavailable');}else{this._birdT=0;this._gullT=.5;this._ternT=2;for(const bank of ['bird_forest','bird_dove','gull','tern'])this._want(bank);}}
  await this._syncContext();try{this.savedChoice=this.choice?'on':'off';localStorage.setItem('museum-natural-sound',this.savedChoice);}catch{}this.onStateChange?.();return this.choice;
 }
 setPaused(paused){this.paused=paused;this.onStateChange?.();return this._syncContext();}
 updateAt(dt,camera,h,timeOfDay=12.6){
  if(!this.choice||this.paused)return;
  this._distanceAt-=dt;const p=camera.position;
  if(this._distanceAt<=0){let d2=Infinity,nearest=null;for(const c of this.contour){const q=(p.x-c[0])**2+(p.z-c[1])**2;if(q<d2){d2=q;nearest=c;}}this._distance=Math.hypot(Math.sqrt(d2),Math.max(0,p.y-this.seaLevel-3));this._nearest=nearest;this._distanceAt=.4;}
  camera.getWorldDirection(this.forward);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
  const depth=Math.max(0,h-p.y),u=Math.min(1,depth/.12);
  super.update(dt,{listener:{position:{x:p.x,y:p.y-this.seaLevel,z:p.z},forward:this.forward,up:this.up},underwater:u,depthBelowSurface:depth,distanceToShore:this._distance,coastDistance:(this.terrain.heightAt(p.x,p.z)>this.seaLevel?-1:1)*this._distance,windSpeed:3.2,surfIntensity:.65,timeOfDay});
  if(this._nearest){const x=this._nearest[0]-p.x,z=this._nearest[1]-p.z,l=Math.hypot(x,z)||1;this.env.shoreX=x/l;this.env.shoreZ=z/l;}
 }
 stats(){let rms=0,birdRMS=0;if(this.analyser&&this.enabled){this.analyser.getFloatTimeDomainData(this.waveform);rms=Math.sqrt(this.waveform.reduce((a,x)=>a+x*x,0)/this.waveform.length);this.peakRMS=Math.max(this.peakRMS,rms);this.birdAnalyser.getFloatTimeDomainData(this.birdWaveform);birdRMS=Math.sqrt(this.birdWaveform.reduce((a,x)=>a+x*x,0)/this.birdWaveform.length);this.birdPeakRMS=Math.max(this.birdPeakRMS,birdRMS);}return {requested:this.choice,context:this.ctx?.state??'not-created',paused:this.paused,savedChoice:this.savedChoice,unlock:'explicit sound-button gesture; cold load is silent, never restores sound without a gesture',volume:this.volume,decoded:[...this._buffers.keys()],shoreDistance:this._distance,stations:this._stations?.length??0,underwater:this.env.u,lowpassHz:this.muffle?.[0].frequency.value??null,outputRMS:rms,peakRMS:this.peakRMS,birdChannelRMS:birdRMS,birdChannelPeakRMS:this.birdPeakRMS,birdMeter:'post-HRTF/distance, before water filtering and master; total output measured post-limiter',birdEvents:this.birdEvents.slice(-24),voices:Object.fromEntries(Object.entries(this._voices).map(([k,v])=>[k,v.length])),failures:this.failures,source:'Tidewater CC0 audio/CREDITS.md',birdPerches:'actual nearest museum tree positions; sea calls use active, world-fixed rendered bird poses',singers:this._singers.map(s=>({x:s.x,y:s.y+this.seaLevel,z:s.z,bank:s.bank})),phase:'native ShoreWaves timing; positioned forest phrases and time-aware chorus'};}
 async record(seconds=20,scope='mix'){
  if(!this.enabled||!this.choice||this.paused)throw Error('请先开启自然声并继续观察');
  const mimeType=['audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mimeType)throw Error('浏览器不支持本地声音记录');
  const dest=this.ctx.createMediaStreamDestination(),chunks=[],source=scope==='birds'?this.birdBus:this.limiter;source.connect(dest);const recorder=new MediaRecorder(dest.stream,{mimeType}),before=this.stats(),started=performance.now(),samples=[];const meter=setInterval(()=>samples.push({elapsedMs:performance.now()-started,...this.stats()}),250);
  try{await new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=e=>reject(e.error??Error('Audio recording failed'));recorder.onstop=resolve;recorder.start();setTimeout(()=>recorder.stop(),seconds*1000);});
   const bytes=new Uint8Array(await new Blob(chunks,{type:mimeType}).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return {mimeType,audioBase64:btoa(binary),before,after:this.stats(),samples,scope,complete:this.enabled&&!this.paused&&samples.length>=Math.floor(seconds*4*.8)&&samples.every(s=>s.context==='running'&&!s.paused),elapsedMs:performance.now()-started,source:scope==='birds'?'diagnostic bird stem post-HRTF/distance, before water/master; not the visitor mix':'normal visitor mix post-limiter; no microphone; performanceEvidence=false'};
  }finally{clearInterval(meter);source.disconnect(dest);dest.stream.getTracks().forEach(t=>t.stop());}
 }
}
