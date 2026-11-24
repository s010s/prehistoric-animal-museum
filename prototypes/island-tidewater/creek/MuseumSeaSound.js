// Tidewater SoundScape (MIT) + its credited CC0 recordings. Keep the native
// ShoreWaves timing, spatial surf and underwater filtering, without village,
// fishing or boats; birds are explicitly environmental examples. No microphone and no autoplay.
import {MIX,SoundScape} from '../vendor/tidewater/src/audio/SoundScape.js';
import {IslandFreshwaterSound, regionalSoundAt} from './IslandAmbience.js';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {coastalAlong,coastalExposure,coastalWaveAmplitude,coastalWaveWobble} from './CoastalWaveClimate.js';
import {marineShoreFor} from './MarineShore.js';

const allowed=new Set(['surf_far','surf_crash','surf_wash','surf_backwash','under_reef','bird_forest','bird_dove','birds_dawn','gull','tern','wind','crickets','pier_lap','step_sand','step_wetsand','step_wood','step_water','step_grass','step_rock','splash','swim','uw_swim','submerge','emerge']);
const STEP_BANKS={sand:['step_sand',0],wetsand:['step_wetsand',0],wood:['step_wood',2],water:['step_water',2],grass:['step_grass',2],rock:['step_rock',1]};
const surfVoices = {
 crash: {bank:'surf_crash', target:MIX.crash, range:150, ref:10, rolloff:.65},
 wash: {bank:'surf_wash', target:MIX.wash, range:70, ref:5, rolloff:.8},
 back: {bank:'surf_backwash', target:MIX.backwash, range:60, ref:5, rolloff:.8},
};
const SWASH_UP = .4; // ShoreWaves' transition from uprush to backwash
const EARLY = .08, LATE = .09;

export class MuseumSeaSound extends SoundScape {
 constructor({shore,field,terrain,shelf,trees=[],seaLevel=-.7,sample=null}){
  super({shore:{shore,field,terrain:{size:terrain.size,origin:terrain.origin,heightAt:(x,z)=>terrain.heightAt(x,z)-seaLevel}}});
  this.sample=sample;this.streamState={available:!!sample,loaded:false,position:[-651,53.1,-489],source:"NPS / Muir Woods, public domain; modern analogue"};this.treeCells=new Map();for(const r of trees){const k=Math.floor(r.x/80)+','+Math.floor(r.z/80);let c=this.treeCells.get(k);if(!c)this.treeCells.set(k,c=[]);c.push(r);}
  this.terrain=terrain;this.seaLevel=seaLevel;this.choice=false;this.paused=true;this.failures=[];this._distanceAt=0;this._distance=1e4;this._distanceOrigin=new Vector3();this.peakRMS=0;
  this.coastline=shelf.segments;this.marineShore=marineShoreFor(terrain,shelf,seaLevel);
  this.surfProbeIn=0;
  this.surfExposure=0;this.surfEvents=[];this.surfCounts={crash:0,wash:0,back:0};
  this.forward=new Vector3();this.up=new Vector3();this.birdEvents=[];this.birdPeakRMS=0;this.flock=[];this.movementCounts={step:0,splash:0,swim:0,submerge:0,emerge:0};this.movementEvents=[];this.faunaAudioCounts={step:0,breath:0};
  try{this.savedChoice=localStorage.getItem('museum-natural-sound')??'off';}catch{this.savedChoice='off';}
 }
 _field(x,z,out){return this._shore.field.sampleRawAt?this._shore.field.sampleRawAt(x,z,out):super._field(x,z,out);}
 _recordMovement(kind,detail){
  this.movementCounts[kind]=(this.movementCounts[kind]??0)+1;
  this.movementEvents.push({time:this.ctx?.currentTime??0,kind,...detail});
  if(this.movementEvents.length>40)this.movementEvents.shift();
 }
 footstep(surface){
  if(!this.enabled||!this.choice||this.paused)return;
  const [bank,trim]=STEP_BANKS[surface]??STEP_BANKS.sand;
  const target=MIX.step+11+trim+(Math.random()-.5)*2.5;
  if(this._shot(bank,'step',this.foot,target,.93+Math.random()*.14))this._recordMovement('step',{surface,bank,targetLufs:target});
 }
 splash(strength){
  if(!this.enabled||!this.choice||this.paused)return;
  super.splash(strength);
  this._recordMovement('splash',{strength});
 }
 swimStroke(){
  if(!this.enabled||!this.choice||this.paused)return;
  super.swimStroke();
  this._recordMovement('swim',{underwater:this.env.u>.5});
 }
 submerge(){
  if(!this.enabled||!this.choice||this.paused)return;
  super.submerge();
  this._recordMovement('submerge',{});
 }
 emerge(){
  if(!this.enabled||!this.choice||this.paused)return;
  super.emerge();
  this._recordMovement('emerge',{});
 }
 _noiseBuffer(){
  if(this._faunaNoise||!this.ctx)return this._faunaNoise;
  const sr=this.ctx.sampleRate,len=Math.round(sr*1.2),buf=this.ctx.createBuffer(1,len,sr),ch=buf.getChannelData(0);
  for(let i=0;i<len;i++)ch[i]=Math.random()*2-1;
  return (this._faunaNoise=buf);
 }
 faunaFootstep(x,y,z,length=8){
  if(!this.enabled||!this.choice||this.paused||!this.ctx||!this.above)return;
  const ly=y-this.seaLevel,dist=Math.hypot(x-this.env.lx,ly-this.env.ly,z-this.env.lz);
  if(dist>54)return;
  const c=this.ctx,t=c.currentTime+.005,mass=Math.max(0,Math.min(1,(length-4)/18));
  const pan=this._panner(this.above,5.5,1.25);
  pan.positionX.value=x;pan.positionY.value=ly;pan.positionZ.value=z;
  const osc=c.createOscillator(),g=c.createGain(),lp=c.createBiquadFilter();
  osc.type='sine';
  const f0=78-mass*24,f1=36-mass*10;
  osc.frequency.setValueAtTime(f0,t);
  osc.frequency.exponentialRampToValueAtTime(f1,t+.15);
  lp.type='lowpass';lp.frequency.value=135-mass*30;
  const peak=.055+.065*mass;
  g.gain.setValueAtTime(.0001,t);
  g.gain.linearRampToValueAtTime(peak,t+.014);
  g.gain.exponentialRampToValueAtTime(.0001,t+.22);
  osc.connect(lp).connect(g).connect(pan);
  osc.start(t);osc.stop(t+.24);
  const src=c.createBufferSource(),ng=c.createGain(),nlp=c.createBiquadFilter();
  src.buffer=this._noiseBuffer();
  nlp.type='lowpass';nlp.frequency.value=220;
  ng.gain.setValueAtTime(.0001,t);
  ng.gain.linearRampToValueAtTime(peak*.32,t+.012);
  ng.gain.exponentialRampToValueAtTime(.0001,t+.14);
  src.connect(nlp).connect(ng).connect(pan);
  src.start(t,Math.random()*.5,.16);
  osc.onended=()=>{g.disconnect();lp.disconnect();ng.disconnect();nlp.disconnect();pan.disconnect();};
  this.faunaAudioCounts.step++;
 }
 faunaBreath(x,y,z,length=8){
  if(!this.enabled||!this.choice||this.paused||!this.ctx||!this.above)return;
  const ly=y-this.seaLevel,dist=Math.hypot(x-this.env.lx,ly-this.env.ly,z-this.env.lz);
  if(dist>28)return;
  const c=this.ctx,t=c.currentTime+.01,mass=Math.max(0,Math.min(1,(length-6)/16));
  const pan=this._panner(this.above,4.0,1.3);
  pan.positionX.value=x;pan.positionY.value=ly;pan.positionZ.value=z;
  const src=c.createBufferSource(),bp=c.createBiquadFilter(),g=c.createGain();
  src.buffer=this._noiseBuffer();
  bp.type='bandpass';bp.frequency.value=320-mass*110;bp.Q.value=2.4;
  const dur=.95+mass*.35,peak=.022+.016*mass;
  g.gain.setValueAtTime(.0001,t);
  g.gain.linearRampToValueAtTime(peak,t+dur*.32);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(bp).connect(g).connect(pan);
  src.start(t,Math.random()*.15,dur+.05);
  src.onended=()=>{bp.disconnect();g.disconnect();pan.disconnect();};
  this.faunaAudioCounts.breath++;
 }
 _want(name){return allowed.has(name)?super._want(name):null;}
 setIslandAmbience(plan){this.ambiencePlan=plan;this.freshwaterSound=new IslandFreshwaterSound(plan,this.seaLevel);}
 _bed(name,gain,now,tau,rate){
  const room=this.regionalSound;
  if(name==='wind'||name==='crickets'){
   if(!room||room.sample)gain=0;
   else if(name==='crickets')gain*=room.insects;
  }else if(name==='birds_dawn'&&room&&!room.sample)gain*=room.chorus;
  else if(name==='surf_far'&&room)gain*=room.surfGain*(.24+.76*this.surfExposure);
  else if(name==='under_reef'&&room&&!room.sample&&!room.ocean)gain=0;
  return super._bed(name,gain,now,tau,rate);
 }
 _readState(state) {
  super._readState(state);
  if (!this._nearest) return;
  const x=this._nearest[0]-this.env.lx,z=this._nearest[1]-this.env.lz,l=Math.hypot(x,z);
  if (l>.01) {this.env.shoreX=x/l;this.env.shoreZ=z/l;}
 }
 _surfSample(x,z,period,field,shoreline=false) {
  this._field(x,z,field);
  const time=field[shoreline?3:0];
  if (!Number.isFinite(time)||time>=10000) return null;
  const along=coastalAlong(x,z);
  return {x,z,along,phase:time-coastalWaveWobble(along)*period,
   exposure:coastalExposure(Math.hypot(field[1],field[2])),
   depth:this.seaLevel-this.terrain.heightAt(x,z)};
 }
 _buildStations(anchor,period) {
  this._stations=[];
  if (!anchor||anchor.distance>180) return;
  const {path}=anchor,field=[0,0,0,0];
  const offsets=[0,-11,11,-22,22,-33,33,-44,44];
  for (const offset of offsets) {
   const along=anchor.along+offset;
   if (!path.loop&&(along<0||along>path.length)) continue;
   const site=this.marineShore.at(path,along);
   if (!site) continue;
   const [x,z]=site.point,[nx,nz]=site.normal;
   if (this._stations.some(other=>Math.hypot(x-other.shore.x,z-other.shore.z)<8)) continue;
   const shore=this._surfSample(x,z,period,field,true);
   const edge=this._surfSample(x,z,period,field);
   if (!shore||!edge) continue;
   const profile=[edge];
   for (let r=2;r<=128;r+=2) {
    const sample=this._surfSample(x+nx*r,z+nz*r,period,field);
    if (!sample||sample.depth<=0) break;
    profile.push(sample);
   }
   if (profile.length<2) continue;
   const phases=profile.map(sample=>sample.phase);
   this._stations.push({shore,profile,period,crashes:new Map(),last:{crash:-Infinity,wash:-Infinity,back:-Infinity},
    earliest:Math.min(shore.phase,...phases),latest:Math.max(shore.phase+SWASH_UP*period,...phases)});
  }
 }
 _breakingPoint(station,wave,shore) {
  if (station.crashes.has(wave)) return station.crashes.get(wave);
  const {profile}=station;
  const amplitude=shore.amplitude.value,variation=shore.variation.value;
  const lip=1-.8*shore.breakSpan.value;
  const clearance=sample=>sample.depth-lip*Math.pow(coastalWaveAmplitude(wave,sample.along,amplitude,variation)*Math.sqrt(sample.exposure)*3.556/shore.gamma.value,.8);
  let offshore=profile.at(-1),last=clearance(offshore),point=null;
  for (let i=profile.length-2;i>=0;i--) {
   let inside=profile[i];
   const next=clearance(inside);
   if (next<=0&&last>0) {
    const field=[0,0,0,0];
    for (let step=0;step<5;step++) {
     const middle=this._surfSample((offshore.x+inside.x)/2,(offshore.z+inside.z)/2,station.period,field);
     if (!middle) break;
     if (clearance(middle)>0) offshore=middle; else inside=middle;
    }
    point=inside;
    break;
   }
   offshore=inside;last=next;
  }
  // Calculate a crossing once per wave and station, including waves with no resolved break.
  if (station.crashes.size>=12) station.crashes.delete(station.crashes.keys().next().value);
  station.crashes.set(wave,point);
  return point;
 }
 _emitSurf(station,type,point,wave,time,now,shore) {
  if (wave<=station.last[type]||time<now-LATE||time>now+EARLY) return;
  const voice=surfVoices[type],env=this.env,y=type==='crash'?.4:type==='wash'?.1:0;
  const distance=Math.hypot(point.x-env.lx,y-env.ly,point.z-env.lz);
  if (distance>=voice.range) return;
  station.last[type]=wave;
  // A walking visitor can cross the station refresh boundary during the same wave.
  if (this.surfEvents.some(event=>event.type===type&&event.wave===wave&&Math.hypot(event.point[0]-point.x,event.point[2]-point.z)<8&&Math.abs(event.phaseTime-time)<.30)) return;
  const amplitude=shore.amplitude.value;
  const relative=coastalWaveAmplitude(wave,point.along,amplitude,shore.variation.value)/Math.max(.05,amplitude);
  const energy=Math.max(.035,Math.min(3,relative*point.exposure));
  const target=voice.target+16*Math.log10(energy)+(Math.random()-.5)*2;
  const rate=type==='crash'?Math.max(.82,Math.min(1.08,1.06-.25*relative)):.95+Math.random()*.1;
  const start=this.ctx.currentTime+Math.max(0,time-now);
  if (this._shotAt(voice.bank,type,point.x,y,point.z,target,rate,start,voice.ref,voice.rolloff)) {
   this.surfCounts[type]++;
   this.surfEvents.push({type,wave,point:[point.x,y+this.seaLevel,point.z],phaseTime:time,exposure:point.exposure,distance,targetLufs:target});
   if (this.surfEvents.length>80) this.surfEvents.shift();
  }
 }
 _surf(dt) {
  const shore=this._shore.shore,env=this.env;
  if (shore.enabled.value<.5||env.shoreDist>230) {
   this._stations=null;this.surfAnchor=null;this.surfProbeIn=0;
   return;
  }
  const period=Math.max(1,shore.period.value),now=shore.time.value;
  const settings=[period,shore.amplitude.value,shore.variation.value,shore.gamma.value,shore.breakSpan.value].join(',');
  const moved=Math.hypot(env.lx-this._stAt.x,env.lz-this._stAt.z);
  this.surfProbeIn-=dt;
  if ((!this._stations||settings!==this.surfSettings||moved>12)&&this.surfProbeIn<=0) {
   const anchor=this.marineShore.nearest(env.lx,env.lz,{budgetMs:1});
   if (anchor!==undefined) {
    this._stAt.x=env.lx;this._stAt.z=env.lz;this.surfSettings=settings;
    this.surfAnchor=anchor;this._distanceAt=0;
    this._buildStations(anchor,period);
   } else {
    // Keep close stations live while the shared contour builds the next patch.
    if (moved>88) this._stations=null;
    this.surfProbeIn=.06;
   }
  }
  for (const station of this._stations??[]) {
   const first=Math.ceil((now-LATE-station.latest)/period),last=Math.floor((now+EARLY-station.earliest)/period);
   for (let wave=first;wave<=last;wave++) {
    const arrival=station.shore.phase+wave*period;
    if (wave>station.last.crash) {
     const point=this._breakingPoint(station,wave,shore);
     if (point) this._emitSurf(station,'crash',point,wave,point.phase+wave*period,now,shore);
    }
    this._emitSurf(station,'wash',station.shore,wave,arrival,now,shore);
    this._emitSurf(station,'back',station.shore,wave,arrival+SWASH_UP*period,now,shore);
   }
  }
 }
 _life(dt){super._life(dt);} _whale(){} _reel(){}
 _flock(){
  this.flock.length=0;
  // Existing shore recordings are acoustic analogues for the real rendered coast flock.
  for(const bird of this.life?.birds??[]){
   if(!bird.active||bird.species!=='ichthyornis')continue;
   const {x,y,z}=bird.position;
   const kind=bird.phase<Math.PI?'tern':'gull';
   this.flock.push({id:bird.id,kind,visible:true,f:{P:{pos:[x,y-this.seaLevel,z]}}});
  }
  return this.flock;
 }
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
  if(this.choice){this.paused=false;const ok=await super.resume();if(!ok&&this.ctx?.state!=='interrupted'){this.choice=false;this._warn('Audio output unavailable');}else{this._birdT=0;this._gullT=.5;this._ternT=2;for(const bank of ['bird_forest','bird_dove','gull','tern','step_rock','uw_swim','submerge','emerge'])this._want(bank);}}
  if(this.choice&&this.sample&&!this.streamSource)await this.startSampleStream().catch(e=>this._warn(e));
  await this._syncContext();try{this.savedChoice=this.choice?'on':'off';localStorage.setItem('museum-natural-sound',this.savedChoice);}catch{}this.onStateChange?.();return this.choice;
 }
 setPaused(paused){this.paused=paused;this.onStateChange?.();return this._syncContext();}
 async startSampleStream(){
  if(this.streamSource||!this.ctx||!this.sample)return;
  const response=await fetch(new URL('./assets/sample-stream-nps.mp3',import.meta.url));if(!response.ok)throw Error('Sample stream recording missing');
  const original=await this.ctx.decodeAudioData(await response.arrayBuffer()),fade=Math.min(Math.round(original.sampleRate*.4),Math.floor(original.length/4)),length=original.length-fade,buffer=this.ctx.createBuffer(original.numberOfChannels,length,original.sampleRate);
  let square=0,peak=0;
  for(let c=0;c<original.numberOfChannels;c++){
   const input=original.getChannelData(c),out=buffer.getChannelData(c);
   for(let i=0;i<length;i++){let value=input[i+fade];if(i>=length-fade){const t=(i-length+fade)/fade;value=value*Math.cos(t*Math.PI/2)+input[i-length+fade]*Math.sin(t*Math.PI/2);}out[i]=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
  }
  const rms=Math.sqrt(square/(length*original.numberOfChannels)),gain=this.ctx.createGain(),panner=this.ctx.createPanner(),source=this.ctx.createBufferSource();this.streamLevel=Math.min(1,.04/Math.max(.001,rms));gain.gain.value=0;this.streamGain=gain;
  panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=2;panner.maxDistance=55;panner.rolloffFactor=1.4;panner.positionX.value=-651;panner.positionY.value=53.1-this.seaLevel;panner.positionZ.value=-489;
  source.buffer=buffer;source.loop=true;source.connect(gain).connect(panner).connect(this.above);source.start();this.streamSource=source;
  this.streamState={...this.streamState,loaded:true,decodedSeconds:original.duration,loopSeconds:buffer.duration,channels:buffer.numberOfChannels,crossfadeSeconds:fade/original.sampleRate,sourceRMS:rms,sourcePeak:peak,gain:this.streamLevel,referenceMetres:2,maximumMetres:55,fadeMetres:[40,55],rolloff:1.4,underwater:'same native above-water lowpass and master',subjectiveListeningVerified:false};
 }
 updateAt(dt,camera,h,timeOfDay=12.6){
  if(!this.choice||this.paused)return;
  this._distanceAt-=dt;const p=camera.position;
  if(this.streamGain){
   this.streamDistance=Math.hypot(p.x+651,p.y-53.1,p.z+489);
   const t=Math.max(0,Math.min(1,(55-this.streamDistance)/15)),envelope=t*t*(3-2*t);
   // Inverse-distance panning is not a finite audible radius. This world-space
   // envelope fades the authored stream out without moving its HRTF emitter.
   if(envelope!==this.streamEnvelope){this.streamGain.gain.setTargetAtTime(this.streamLevel*envelope,this.ctx.currentTime,.12);this.streamEnvelope=envelope;}
  }
  if(this._distanceAt<=0||p.distanceToSquared(this._distanceOrigin)>14400){
   let d2=Infinity,nearest=null;
   for(const site of this.coastline){
    const [x,z]=site.point,d=(p.x-x)**2+(p.z-z)**2;
    if(d<d2){d2=d;nearest=site;}
   }
   if(this.surfAnchor&&Math.hypot(p.x-this._stAt.x,p.z-this._stAt.z)<=16){
    nearest=this.surfAnchor;
    d2=(p.x-nearest.point[0])**2+(p.z-nearest.point[1])**2;
   }
   this._distance=Math.hypot(Math.sqrt(d2),Math.max(0,p.y-this.seaLevel-3));
   this._nearest=nearest?.point;
   if(nearest){
    const [x,z]=nearest.point,[nx,nz]=nearest.normal;
    const wave=this._field(x+nx*8,z+nz*8,[0,0,0,0]);
    this.surfExposure=coastalExposure(Math.hypot(wave[1],wave[2]));
   }
   this._distanceAt=.4;this._distanceOrigin.copy(p);
  }
  camera.getWorldDirection(this.forward);this.up.set(0,1,0).applyQuaternion(camera.quaternion);
  const depth=Math.max(0,h-p.y),u=Math.min(1,depth/.12);
  this.regionalSound=regionalSoundAt(this.ambiencePlan,p,h,this.seaLevel,this._distance);
  if(this.ctx?.state==='running')this.freshwaterSound?.update(p,this.ctx,this.above,()=>this._want('pier_lap'),u);
  const shore=this._shore.shore;
  const surfIntensity=Math.min(1,shore.amplitude.value*shore.enabled.value/.6);
  super.update(dt,{listener:{position:{x:p.x,y:p.y-this.seaLevel,z:p.z},forward:this.forward,up:this.up},underwater:u,depthBelowSurface:depth,distanceToShore:this._distance,coastDistance:(this.regionalSound.sample?this.terrain.heightAt(p.x,p.z)>this.seaLevel:!this.regionalSound.ocean)?-this._distance:this._distance,windSpeed:this.regionalSound.wind,surfIntensity,timeOfDay});
 }
 stats(){let rms=0,birdRMS=0;if(this.analyser&&this.enabled){this.analyser.getFloatTimeDomainData(this.waveform);rms=Math.sqrt(this.waveform.reduce((a,x)=>a+x*x,0)/this.waveform.length);this.peakRMS=Math.max(this.peakRMS,rms);this.birdAnalyser.getFloatTimeDomainData(this.birdWaveform);birdRMS=Math.sqrt(this.birdWaveform.reduce((a,x)=>a+x*x,0)/this.birdWaveform.length);this.birdPeakRMS=Math.max(this.birdPeakRMS,birdRMS);}return {regional:{...this.regionalSound,freshwater:this.freshwaterSound?.stats()??[]},stream:{...this.streamState,distance:this.streamDistance??null,envelope:this.streamEnvelope??0,currentGain:this.streamGain?.gain.value??0},requested:this.choice,context:this.ctx?.state??'not-created',paused:this.paused,savedChoice:this.savedChoice,unlock:'explicit sound-button gesture; cold load is silent, never restores sound without a gesture',volume:this.volume,decoded:[...this._buffers.keys()],shoreDistance:this._distance,stations:this._stations?.length??0,surf:{exposure:this.surfExposure,counts:{...this.surfCounts},events:this.surfEvents.slice(-24)},movement:{counts:{...this.movementCounts},events:this.movementEvents.slice(-16)},faunaAudio:{...this.faunaAudioCounts},underwater:this.env.u,lowpassHz:this.muffle?.[0].frequency.value??null,outputRMS:rms,peakRMS:this.peakRMS,birdChannelRMS:birdRMS,birdChannelPeakRMS:this.birdPeakRMS,birdMeter:'post-HRTF/distance, before water filtering and master; total output measured post-limiter',birdEvents:this.birdEvents.slice(-24),voices:Object.fromEntries(Object.entries(this._voices).map(([k,v])=>[k,v.length])),failures:this.failures,source:'Tidewater CC0 audio/CREDITS.md',birdPerches:'actual nearest museum tree positions; modern shore-call analogues use the active, world-fixed Ichthyornis poses',singers:this._singers.map(s=>({x:s.x,y:s.y+this.seaLevel,z:s.z,bank:s.bank})),phase:'native ShoreWaves timing; positioned forest phrases and time-aware chorus'};}
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
