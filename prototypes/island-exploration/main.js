import {REGION_VERSION} from './sample-region.js';
import {SUN_DIRECTION} from './lighting-config.js';
import './style.css'
import * as T from 'three'
import{makeSky}from'./sky.js'
import{SIZE,terrainHeight,surfaceHeight,waterLevelAt,makeLandscape,groundMaterial,landmarks,smooth,biomeAt}from'./world.js'
import{makeProps,riverRocks}from'./props.js'
import{makeWater}from'./water.js'
import{makeCliffs}from'./hero-crags.js'
import{makeAtmosphere}from'./atmosphere.js'
import {makeShadowFocus} from './shadow-focus.js'
import {makeEncounter} from './encounter.js'
import {makeTerrainLight} from './terrain-light.js'
import {makeBenchmark} from './benchmark.js'
import {makeDiagnostics} from './diagnostics.js'
import {resolveWorkload,fitDrawingBuffer,FrameClock,recoveryPlan} from './workload.js'
import {makeWorkloadReview} from './workload-review.js'
import {makeGroundNavigation} from './ground-navigation.js'
import {WALK_ROUTE} from './regional-walk.js'
import {deferredAtlasNormal} from './forest-impostor.js'
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search)
const habitat=params.get('look')!=='baseline';
const workload=resolveWorkload(params),benchmarkMode=workload.review,shadowBootstrap=true;let benchmark=null,workloadReview=null,stableShadow=params.get('shadow')!=='baseline';
const clock=new FrameClock(workload.targetFps,performance.now()),pauseReasons=new Set(params.get('paused')==='1'?['user']:[]);
let renderScale=1,effectivePixelRatio=1,reviewJob=null;
let reviewGuardEnd=Infinity;
let trialAnchor=null;
let bootSlots=0,bootComplete=false,worldBase=benchmarkMode?60:0,worldAnchor=0,resizePending=true,resizeTimer=null;
const activeNow=()=>clock.activeNow(performance.now());
function pauseReason(reason,on){const wasPaused=pauseReasons.size>0;if(reason!=='user'&&pauseReasons.has(reason)===on)return;if(reason==='user'&&!on){pauseReasons.delete('review-idle');reviewGuardEnd=activeNow()+20000;}on?pauseReasons.add(reason):pauseReasons.delete(reason);clock.setPaused(pauseReasons.size>0,performance.now());if(pauseReasons.size&&reviewJob){const cancelled=reviewJob;reviewJob=null;cancelled.resolve({passed:false,reason:'3D paused'});}benchmark?.setPaused(pauseReasons.size>0);$('#pause-3d').textContent=pauseReasons.has('user')||pauseReasons.has('review-idle')?'继续 3D':'暂停 3D';$('#pause-3d').setAttribute('aria-pressed',String(pauseReasons.has('user')||pauseReasons.has('review-idle')));document.body.dataset.paused=String(pauseReasons.size>0);if(wasPaused!==(pauseReasons.size>0))workloadReview?.event('pause-state',{paused:pauseReasons.size>0,reason});}
$('#pause-3d').onclick=()=>pauseReason('user',!(pauseReasons.has('user')||pauseReasons.has('review-idle')));
pauseReason('user',pauseReasons.has('user'));
pauseReason('hidden',document.hidden);
addEventListener('visibilitychange',()=>pauseReason('hidden',document.hidden));
addEventListener('pagehide',()=>pauseReason('pagehide',true));
addEventListener('pageshow',()=>pauseReason('pagehide',false));
// Register before asynchronous startup: losing focus never leaves boot GPU work running.
addEventListener('blur',()=>pauseReason('user',true));
const budgetNote=document.createElement('small');budgetNote.id='workload-budget';budgetNote.style.cssText='position:fixed;top:64px;right:16px;z-index:40;color:white;background:#16332dcc;padding:5px 8px';budgetNote.textContent=workload.override?'高负载覆盖 · 20 秒后自动暂停':'调查保护档 · ≤0.92 MP · 30 FPS';document.body.append(budgetNote);
async function waitForWork(stage){while(true){if(lost)throw Error('Graphics context lost during '+stage);const t=await new Promise(resolve=>requestAnimationFrame(resolve));if(workload.deadlineSeconds!==null&&(!workload.desktopTier||trialAnchor!==null)&&(clock.activeNow(t)-(trialAnchor??0))/1000>=workload.deadlineSeconds)pauseReason('override-expired',true);if(clock.accept(t).submit){bootSlots++;return;}}}
for(const dialog of document.querySelectorAll('dialog')){dialog.addEventListener('close',()=>pauseReason('dialog',Boolean(document.querySelector('dialog[open]'))));}
new MutationObserver(()=>pauseReason('dialog',Boolean(document.querySelector('dialog[open]')))).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
let walking=params.get('walk')==='1';
let fine=params.has('quality')?params.get('quality')==='high':innerWidth>=900,cruise=false,touring=false,tourT=0,speedIndex=1,yaw=0,pitch=0,elapsed=0,last=0,frames=[],frame=0
const speeds=[5,35,150],speedNames=['近看','漫游','远行']
const directPreview=params.has('dry');
const renderer=new T.WebGLRenderer({canvas:$('#scene'),antialias:directPreview&&habitat,depth:directPreview,powerPreference:'high-performance'});renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=habitat?1.35:.92;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.info.autoReset=false
const diagnostics=makeDiagnostics(renderer,params);workloadReview=makeWorkloadReview(renderer,params);
const observer=diagnostics??workloadReview;
const scene=new T.Scene();scene.background=new T.Color('#c8dce2');const camera=new T.PerspectiveCamera(62,innerWidth/innerHeight,.3,45000);camera.rotation.order='YXZ'
let lost=false,recoveryUrl=null,poseReady=false;
const contextRecovery=true,recoveryKey='island-context-recovery:'+location.pathname;
const failureKey='island-graphics-failure:'+location.pathname;let evidenceFlush=Promise.resolve();
function showFailureExport(data){
 document.body.dataset.contextFailure=JSON.stringify(data);
 let b=$('#recovery-export');if(!b){const note=document.createElement('p');note.id='recovery-note';note.textContent='图形资源中断后保持暂停。恢复信息可保存到本机。';$('#loading').append(note);b=document.createElement('button');b.id='recovery-export';b.textContent='保存恢复状态';$('#loading').append(b);}
 b.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='island-context-state.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
if(params.has('recoveryAttempt'))try{const saved=sessionStorage.getItem(failureKey);if(saved)showFailureExport(JSON.parse(saved));}catch{}
let recoveryAttempts=Number(params.get('recoveryAttempt'))||0;try{recoveryAttempts=Math.max(recoveryAttempts,Number(sessionStorage.getItem(recoveryKey))||0)}catch{}
if(contextRecovery){
 renderer.domElement.addEventListener('webglcontextlost',e=>{
  e.preventDefault();if(lost)return;lost=true;pauseReason('context',true);
  const cancelledReviewJob=Boolean(reviewJob);if(reviewJob){const queued=reviewJob;reviewJob=null;queued.resolve({passed:false,reason:'Graphics context lost; bounded job cancelled'});}
  const url=new URL(location.href);
  if(poseReady){
   url.searchParams.set('pose',[...camera.position.toArray(),camera.rotation.y,camera.rotation.x].join(','));
   url.searchParams.set('quality','mobile');
  }
  const recovery={...recoveryPlan(url.href,recoveryAttempts),automatic:false};recoveryUrl=recovery.url;recoveryAttempts=recovery.attempts;if(recovery.allowed)try{sessionStorage.setItem(recoveryKey,String(recoveryAttempts))}catch{}
  document.body.dataset.recovery=JSON.stringify(recovery);
  let lastSafeState=null;try{const raw=document.querySelector('#gpu-review')?.dataset.snapshot;if(raw)lastSafeState=JSON.parse(raw);}catch{}
  const failure={observedAt:Date.now(),build:__WORLD_BUILD__,url:location.href,statusMessage:e.statusMessage??null,injectionRequested:workloadReview?.injectionRequested??false,recovery,drawSize:[renderer.domElement.width,renderer.domElement.height],pose:poseReady?camera.position.toArray():null,lastSafeState,routeEvidence:benchmark?.contextLost(lastSafeState)??null,diagnosticEvidence:diagnostics?.interruption??null,cancelledReviewJob};
  let stored=false;try{sessionStorage.setItem(failureKey,JSON.stringify(failure));stored=true;}catch{}
  // Keep the export on this paused page if storage cannot survive a reload.
  // The localhost flush is still useful, but it is not available on every host.
  if(!stored){recoveryUrl=null;failure.recovery={...recovery,allowed:false,url:null,reason:'evidence-storage-unavailable'};document.body.dataset.recovery=JSON.stringify(failure.recovery);}
  showFailureExport(failure);evidenceFlush=Promise.all([workloadReview?.contextLost(failure)??Promise.resolve(),diagnostics?.interruptionFlush??Promise.resolve()]);
  if(poseReady){stop();keys.clear();joy.x=joy.y=0;alt.up=alt.down=false;look=null;}
  document.body.dataset.ready='false';
  $('#loading').classList.remove('done');$('#loading').setAttribute('aria-hidden','false');
  $('#load-detail').textContent='图形资源中断，已暂停并保留原页；请先保存恢复记录。';
 });
 // Cached targets are invalid. Keep the original page and evidence paused
 // even if the driver restores a context; never reload away the failure scene.
 renderer.domElement.addEventListener('webglcontextrestored',()=>{if(!lost)return;pauseReason('context',true);document.body.dataset.contextRestored=String(Date.now());void evidenceFlush.catch(()=>{});$('#load-detail').textContent='图形上下文已恢复，原页仍暂停；记录保留，未自动重载。';});
}
const sunDirection=new T.Vector3(...SUN_DIRECTION).normalize();
const shadowFocus=makeShadowFocus(sunDirection);
const sun=new T.DirectionalLight('#fff1d9',2.35);sun.castShadow=true;sun.shadow.mapSize.set(512,512);Object.assign(sun.shadow.camera,{left:-140,right:140,top:140,bottom:-140,near:1,far:1200});sun.shadow.bias=-.00015;sun.shadow.normalBias=.08;scene.add(sun,sun.target);scene.add(new T.HemisphereLight('#d7e9f4','#45533e',habitat?.65:.85))
// Function declarations are hoisted, but renderScale must exist before startup.
renderScale=1;quality();budgetNote.dataset.initialDrawingBuffer=JSON.stringify([renderer.domElement.width,renderer.domElement.height]);budgetNote.dataset.framebuffer=JSON.stringify(renderer.getContext().getContextAttributes()); // Before any large targets, atlases, PMREM, compilation or GPU pass.
const sky=await makeSky(sunDirection,workload.cloud);scene.add(sky.mesh);observer?.labelGroup(sky.mesh,'sky');scene.background=null;let environmentTarget=null;
Object.assign(sky.uniforms,await makeTerrainLight(habitat));
const air=makeAtmosphere(sky.uniforms);
const landscape=makeLandscape(await groundMaterial(),o=>air.apply(o),()=>fine,observer);scene.add(landscape.group);air.apply(landscape.group)
const water=await makeWater(renderer,camera,riverRocks,sky.uniforms,()=>fine,observer,()=>!shadowBootstrap||Boolean(sun.shadow.map))
$('#load-detail').textContent='铺开森林、岩岸和潮汐河谷…'
await landscape.ready;
const props=await makeProps(renderer,o=>air.apply(o),()=>fine,observer,(x,z)=>landscape.heightAt(x,z),waitForWork);scene.add(props.group);air.apply(props.group);water.setReflectionMode((active,plane,frustum)=>{landscape.reflectionMode(active,plane,frustum);if(!plane)props.reflectionMode(active);});const cliffs=await makeCliffs(habitat);scene.add(cliffs);observer?.labelGroup(cliffs,'cliffs');air.apply(cliffs)
if(params.get('graybox')==='1'){scene.overrideMaterial=new T.MeshLambertMaterial({color:'#9da9a0'});props.group.visible=false;}
const walkingHeight=(x,z)=>Math.max(landscape.heightAt(x,z),cliffs.userData.heightAt(x,z));
const navigationHeight=(x,z)=>walking||benchmark?.groundRouteActive?walkingHeight(x,z):Math.max(surfaceHeight(x,z),walkingHeight(x,z));
await landscape.ready;
const animal=await makeEncounter(scene,o=>air.apply(o),()=>{stop();keys.clear()},(x,z)=>landscape.heightAt(x,z));
const groundNav=makeGroundNavigation({heightAt:walkingHeight,waterAt:waterLevelAt,rockAt:props.walkingObstacle,animal,getRevision:()=>props.walkingRevision});
const mapBase=document.createElement('canvas');mapBase.width=mapBase.height=400;const baseCtx=mapBase.getContext('2d'),pixels=baseCtx.createImageData(400,400),seaDepth=new Uint8Array(400*400)
for(let z=0;z<400;z++)for(let x=0;x<400;x++){const wx=(x/399-.5)*SIZE,wz=(z/399-.5)*SIZE,h=terrainHeight(wx,wz),wl=waterLevelAt(wx,wz),i=(z*400+x)*4;seaDepth[z*400+x]=Math.max(0,Math.min(255,(-.7-h)/40*255));let c;if(h<wl){const shallow=1-smooth(wl-14,wl,h);c=[55+shallow*4,121-shallow*32,133-shallow*24]}else if(biomeAt(wx,wz).marsh>.4)c=[123,123,75];else if(biomeAt(wx,wz).grass>.35)c=[155,161,76];else if(h<8)c=[194,192,150];else if(h<160)c=[66+h*.18,100+h*.14,68+h*.13];else c=[107+h*.17,121+h*.15,99+h*.16];pixels.data.set([...c,255],i)}baseCtx.putImageData(pixels,0,0);water.setTerrainDepth(seaDepth,400,SIZE)
function map(canvas,labels=false){const c=canvas.getContext('2d'),size=canvas.width;c.drawImage(mapBase,0,0,size,size);c.font=`${labels?13:10}px system-ui`;for(let i=0;i<landmarks.length;i++){const l=landmarks[i],x=(l.p[0]/SIZE+.5)*size,y=(l.p[2]/SIZE+.5)*size;const lx=labels&&l.id==='side-spring'?x+32:x,ly=labels&&l.id==='side-spring'?y-18:y;if(labels&&l.id==='side-spring'){c.strokeStyle='#f5ecc8';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(lx,ly);c.stroke();}c.fillStyle='#f5ecc8';c.beginPath();c.arc(lx,ly,labels?9:4,0,6.28);c.fill();if(labels){c.fillStyle='#274d3a';c.textAlign='center';c.fillText(i+1,lx,ly+4)}}const x=(camera.position.x/SIZE+.5)*size,y=(camera.position.z/SIZE+.5)*size;c.save();c.translate(x,y);c.rotate(-yaw);c.fillStyle='#fff';c.strokeStyle='#173e39';c.lineWidth=2;c.beginPath();c.moveTo(0,-8);c.lineTo(-5,5);c.lineTo(5,5);c.closePath();c.fill();c.stroke();c.restore()}
function orient(target){camera.lookAt(target);yaw=camera.rotation.y;pitch=camera.rotation.x}
function stop(reason='navigation or manual interruption'){document.body.dataset.lastStop=JSON.stringify({reason,at:Date.now(),groundRoute:benchmark?.groundRouteActive??false});benchmark?.cancel(reason);touring=false;cruise=false;$('#tour').textContent='环岛导览';$('#tour').setAttribute('aria-pressed','false');$('#cruise').textContent='向前巡航';$('#cruise').setAttribute('aria-pressed','false');document.body.classList.remove('touring')}
function go(id){const l=landmarks.find(p=>p.id===(id==='spring'?'side-spring':id))??landmarks[0];stop();if(l.id==='encounter'){speedIndex=0;$('#speed').textContent='速度 · 近看';}camera.position.fromArray(l.p);if(walking&&waterLevelAt(l.p[0],l.p[2])-walkingHeight(l.p[0],l.p[2])>.65){walking=false;$('#walk-mode').setAttribute('aria-pressed','false');}camera.fov=l.id==='encounter'&&innerWidth/innerHeight<.8?80:62;camera.updateProjectionMatrix();camera.position.y=Math.max(camera.position.y,navigationHeight(camera.position.x,camera.position.z)+3);orient(new T.Vector3(...l.t));$('#place').textContent=l.name;$('#place-note').textContent=l.note;params.set('place',l.id);params.set('quality',fine?'high':'mobile');params.delete('pose');history.replaceState(null,'',`?${params}`);benchmark?.destination(l.id);map($('#minimap'));frames=[]}
for(const [i,l]of landmarks.entries()){const b=document.createElement('button');b.innerHTML=`${i+1} · ${l.name}<small>${l.note}</small>`;b.onclick=()=>{go(l.id);$('#map-dialog').close()};$('#destinations').append(b)}
$('#map-button').onclick=()=>{stop();map($('#large-map'),true);$('#map-dialog').showModal()};$('#map-dialog .close').onclick=()=>$('#map-dialog').close();$('#help').onclick=()=>{stop();$('#help-dialog').showModal()};$('#help-dialog .close').onclick=()=>$('#help-dialog').close()
function quality(){const size=fitDrawingBuffer(workload,{width:innerWidth,height:innerHeight,dpr:Number(params.get('reviewDpr'))||devicePixelRatio,fine,scale:renderScale});effectivePixelRatio=size.ratio;renderer.setPixelRatio(1);renderer.setSize(size.width,size.height,false);$('#quality').textContent=fine?'精细画质':'轻量画质';budgetNote.textContent=(workload.desktopTier?'桌面 '+workload.desktopTier+(workload.deadlineSeconds?' · 45 秒试档':''):workload.override?'高负载覆盖 · 20 秒限时':'调查保护档')+' · '+renderer.domElement.width+'×'+renderer.domElement.height+' · '+workload.targetFps+' FPS';const shadowSize=fine?2048:512;if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(shadowSize,shadowSize)}resizePending=false;}
$('#quality').onclick=()=>{stop();fine=!fine;renderScale=1;params.set('quality',fine?'high':'mobile');history.replaceState(null,'',`?${params}`);resizePending=true};addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{resizePending=true},100)})
$('#speed').onclick=()=>{speedIndex=(speedIndex+1)%3;$('#speed').textContent=`速度 · ${speedNames[speedIndex]}`}
$('#cruise').onclick=()=>{const next=!cruise;stop();cruise=next;$('#cruise').textContent=cruise?'停止巡航':'向前巡航';$('#cruise').setAttribute('aria-pressed',String(cruise))}
const route=new T.CatmullRomCurve3([[-1850,45,-450],[-1750,90,-1100],[-2020,260,-2250],[-1650,420,-3350],[800,650,-2500],[1800,710,-5850],[5500,390,-700],[6500,270,2100],[8400,150,3300],[4600,130,5300],[2950,130,6200],[500,330,4200],[-2100,270,3450],[-3100,200,500],[-3000,230,-2400],[-1850,80,-450]].map(p=>new T.Vector3(...p)),false,'centripetal')
const tourGaze=new T.CatmullRomCurve3([[-1920,20,-650],[-1880,30,-1350],[-1850,130,-2600],[-1800,70,-2600],[700,390,-2700],[-1500,150,100],[4700,15,1400],[-800,200,1400],[-2300,5,2850],[-2100,80,100],[-2150,170,-2200],[-1900,20,-800]].map(p=>new T.Vector3(...p)),false,'centripetal')
const safeRoute=new T.CatmullRomCurve3(Array.from({length:241},(_,i)=>{const p=route.getPoint(i/240);let floor=navigationHeight(p.x,p.z);for(const [dx,dz] of [[-200,0],[200,0],[0,-200],[0,200]])floor=Math.max(floor,navigationHeight(p.x+dx,p.z+dz));p.y=Math.max(p.y,floor+110);return p}),false,'centripetal')
$('#tour').onclick=()=>{const next=!touring;stop();if(next){touring=true;tourT=0;$('#tour').textContent='停止导览';$('#tour').setAttribute('aria-pressed','true');document.body.classList.add('touring')}}
const keys=new Set(),joy={x:0,y:0},alt={up:false,down:false};let look=null
function manual(){benchmark?.cancel('manual input');if(touring)stop()}
addEventListener('keydown',e=>{if(e.target.closest('input,textarea,dialog'))return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight','Space'].includes(e.code)){e.preventDefault();if(e.code==='Space')stop();else{manual();keys.add(e.code)}}});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();joy.x=joy.y=0;alt.up=alt.down=false;look=null;document.body.dataset.lastBlur=JSON.stringify({at:Date.now(),groundRoute:benchmark?.groundRouteActive??false});stop('window-blur');$('#stick').style.transform=''})
renderer.domElement.addEventListener('pointerdown',e=>{manual();look={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)})
renderer.domElement.addEventListener('pointermove',e=>{if(!look||look.id!==e.pointerId)return;yaw-=(e.clientX-look.x)*.004;pitch=T.MathUtils.clamp(pitch-(e.clientY-look.y)*.003,-1.35,1.35);look.x=e.clientX;look.y=e.clientY;camera.rotation.set(pitch,yaw,0)})
renderer.domElement.addEventListener('pointerup',()=>look=null);renderer.domElement.addEventListener('pointercancel',()=>look=null)
const stick=$('#joystick');function moveStick(e){const r=stick.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/(r.width*.36),y=(e.clientY-r.top-r.height/2)/(r.height*.36),len=Math.max(1,Math.hypot(x,y));joy.x=x/len;joy.y=y/len;$('#stick').style.transform=`translate(${joy.x*r.width*.30}px,${joy.y*r.height*.30}px)`}
stick.onpointerdown=e=>{manual();stick.setPointerCapture(e.pointerId);moveStick(e)};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))moveStick(e)};stick.onpointerup=stick.onpointercancel=()=>{joy.x=joy.y=0;$('#stick').style.transform=''}
for(const id of ['up','down']){const b=$('#'+id);b.onpointerdown=e=>{manual();alt[id]=true;b.setPointerCapture(e.pointerId)};b.onpointerup=b.onpointercancel=()=>alt[id]=false;b.onclick=()=>{manual();camera.position.y+=id==='up'?4:-4}}
$('#walk-mode').setAttribute('aria-pressed',String(walking));
$('#walk-mode').onclick=()=>{manual();walking=!walking;$('#walk-mode').setAttribute('aria-pressed',String(walking));};
const initialPose=params.get('pose');quality();go(params.get('place')??'side-spring');if(initialPose){const p=initialPose.split(',').map(Number);if(p.length===5&&p.every(Number.isFinite)){camera.position.set(p[0],p[1],p[2]);yaw=p[3];pitch=p[4];camera.rotation.set(pitch,yaw,0)}};poseReady=true;elapsed=worldBase;await waitForWork('environment-pmrem');const skyScene=new T.Scene();skyScene.add(sky.mesh);const pmrem=new T.PMREMGenerator(renderer);environmentTarget=pmrem.fromScene(skyScene,.03,.3,45000,{size:128});scene.environment=environmentTarget.texture;scene.environmentIntensity=.42;pmrem.dispose();scene.add(sky.mesh);await waitForWork('initial-instance-install');props.update(camera,elapsed);landscape.update(camera);$('#load-detail').textContent='准备阳光、海面与远景…';await landscape.ready;await waitForWork('main-shader-compile');await renderer.compileAsync(scene,camera);bootComplete=true;trialAnchor=workload.desktopTier?activeNow():null;reviewGuardEnd=activeNow()+20000;worldAnchor=activeNow();clock.resetCadence(performance.now());clock.submittedFrames=0;$('#loading').classList.add('done');$('#loading').setAttribute('aria-hidden','true');document.body.dataset.ready='true';if(params.get('paused')==='1')pauseReason('user',true);
let perfStage={propsMs:0,renderMs:0},longFrames=0;
function resourceState(){return [...sky.resources(),...water.resources(),...props.auditResources(),...(environmentTarget?[['environment',environmentTarget]]:[]),...(sun.shadow.map?[['sun-shadow',sun.shadow.map]]:[])].map(([name,t])=>({name,width:t.width,height:t.height,samples:t.samples,type:t.texture.type,format:t.texture.format,depthBuffer:t.depthBuffer,colourSpace:t.texture.colorSpace}));}
function reviewState(){return {regionVersion:REGION_VERSION,route:benchmark?.routeState(),benchmarkObservation:benchmark?.observationState,navigation:{walking,groundRoute:benchmark?.groundRouteActive??false,speed:benchmark?.groundRouteActive?1.55:walking?1.65:speeds[speedIndex],constraints:groundNav.status()},build:__WORLD_BUILD__,variant:stableShadow?'stable':'baseline',shadowBootstrap,look:habitat?'habitat':'baseline',position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,drawSize:[renderer.domElement.width,renderer.domElement.height],viewport:[innerWidth,innerHeight],pixelRatio:renderer.getPixelRatio(),effectivePixelRatio,defaultFramebuffer:renderer.getContext().getContextAttributes(),quality:fine?'high':'mobile',adaptive:false,workload:{...clock.snapshot(performance.now()),...workload,reviewIdleDeadlineSeconds:workloadReview?Math.max(0,(reviewGuardEnd-activeNow())/1000):null,overrideDeadlineRemaining:workload.deadlineSeconds===null?null:Math.max(0,workload.deadlineSeconds-(clock.activeNow(performance.now())-(trialAnchor??0))/1000),pauseReasons:[...pauseReasons],bootSlots,bootComplete,loops:1},resources:resourceState(),clearance:camera.position.y-(walking&&!benchmark?.active?walkingHeight(camera.position.x,camera.position.z):navigationHeight(camera.position.x,camera.position.z)),ground:{visibleHeight:landscape.heightAt(camera.position.x,camera.position.z),waterHeight:waterLevelAt(camera.position.x,camera.position.z),navigationHeight:navigationHeight(camera.position.x,camera.position.z)},exposure:renderer.toneMappingExposure,sunDirection:sunDirection.toArray(),weather:Object.fromEntries(['cloudCoverage','cloudThickness','weatherHaze','rainWetness','cloudPhase','skyTime'].map(k=>[k,sky.uniforms[k].value.toArray?.()??sky.uniforms[k].value])),worldTime:elapsed,skyCache:sky.status(),encounter:animal.status(),vegetation:{...props.status(),atlasNormalDeferred:deferredAtlasNormal.value},flow:water.status(),terrain:landscape.status(),shadow:shadowFocus.snapshot(sun),cpu:{...perfStage},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory,programs:renderer.info.programs?.length??0},programErrors:renderer.info.programs?.filter(p=>p.diagnostics?.runnable===false).length??0}}
function queueReviewJob(fn){if(pauseReasons.size||reviewJob)return Promise.resolve({passed:false,reason:'3D paused or another bounded review job pending'});return new Promise(resolve=>{reviewJob={fn,resolve};});}
benchmark=makeBenchmark({params,camera,canvas:renderer.domElement,landmarks,go,stop,getState:reviewState,auditSky:()=>queueReviewJob(()=>sky.audit(renderer)),setWaterDebug:value=>water.setDebug(value),setReviewDpr:value=>{params.set('reviewDpr',String(value));resizePending=true},syncPose:()=>{yaw=camera.rotation.y;pitch=camera.rotation.x},getShadow:()=>stableShadow,setShadow:value=>{stableShadow=value;params.set('shadow',value?'stable':'baseline');history.replaceState(null,'',`?${params}`)},setTime:value=>{elapsed=worldBase=value;worldAnchor=activeNow()},now:activeNow,getWorldTime:()=>elapsed,navigationHeight,navigateGround:groundNav.move,pauseScene:()=>pauseReason('user',true),resumeScene:()=>{if(lost||document.hidden||document.querySelector('dialog[open]')||[...pauseReasons].some(r=>r!=='user'&&r!=='review-idle'))return false;pauseReason('user',false);return pauseReasons.size===0&&!lost;},planRegion:()=>groundNav.plan(WALK_ROUTE.anchors)});

observer?.labelGroup(animal.group,'animal');
observer?.attach({benchmark,getState:reviewState,resources:()=>[...sky.resources(),...water.resources(),...props.auditResources(),...(sun.shadow.map?[['sun-shadow',sun.shadow.map]]:[])],scene,landscape,props,camera});
const previousPosition=new T.Vector3();
if(!contextRecovery)renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;benchmark?.contextLost();$('#loading').classList.remove('done');$('#load-detail').textContent='图形资源中断，请刷新重试。'})
function render(t){requestAnimationFrame(render);if(workloadReview&&!benchmark?.active&&!workloadReview.collecting&&clock.activeNow(t)>=reviewGuardEnd)pauseReason('review-idle',true);if(workload.deadlineSeconds!==null&&(!workload.desktopTier||trialAnchor!==null)&&(clock.activeNow(t)-(trialAnchor??0))/1000>=workload.deadlineSeconds)pauseReason('override-expired',true);const accepted=clock.accept(t);if(lost||!accepted.submit)return;if(reviewJob){const job=reviewJob;reviewJob=null;try{job.resolve(job.fn());}catch(error){job.resolve({passed:false,error:String(error)});}return;}const raw=accepted.raw,dt=accepted.deltaSeconds;last=t;if(resizePending){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();quality();}sky.setQuality(fine);elapsed=benchmark?.active?benchmark.time:workload.fixed?worldBase:worldBase+(clock.activeNow(t)-worldAnchor)/1000;frames.push(raw);if(raw>50)longFrames++;if(frames.length>120)frames.shift()
 const frameStart=observer?performance.now():0;renderer.info.reset();observer?.beginFrame(t,raw,elapsed);
 const navStart=observer?performance.now():0;
 previousPosition.copy(camera.position);
 if(benchmark?.active){benchmark.beforeFrame(raw);if(pauseReasons.size||lost)return;}
 else if(touring){tourT=Math.min(1,tourT+dt/320);const p=safeRoute.getPoint(tourT),target=tourT<.986?safeRoute.getPoint(tourT+.014):tourGaze.getPoint(1);p.y=Math.max(p.y,navigationHeight(p.x,p.z)+90);target.y=Math.max(target.y-35,p.y-120);camera.position.copy(p);orient(target);pitch=T.MathUtils.clamp(pitch,-.45,.25);camera.rotation.set(pitch,yaw,0);if(tourT>=1)stop()}
 else if(!document.querySelector('dialog[open]')){const f=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)-joy.y+(cruise?1:0),r=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joy.x,u=(keys.has('KeyE')||alt.up?1:0)-(keys.has('KeyQ')||alt.down?1:0),boost=keys.has('ShiftLeft')||keys.has('ShiftRight')?2:1,v=(walking?1.65:speeds[speedIndex])*boost*(walking?Math.min(.1,raw/1000):dt),len=Math.max(1,Math.hypot(f,r));camera.position.x+=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*v/len;camera.position.z+=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*v/len;camera.position.y+=u*v*.7;camera.rotation.set(pitch,yaw,0)}
 // Sweep the traversed segment and the near-plane footprint against visible triangles.
 if(walking&&!benchmark?.active){groundNav.move(camera.position,previousPosition,1.65*(keys.has('ShiftLeft')||keys.has('ShiftRight')?2:1)*Math.min(.1,raw/1000));}
 else if(!benchmark?.groundRouteActive){
 const span=Math.hypot(camera.position.x-previousPosition.x,camera.position.z-previousPosition.z),steps=Math.max(1,Math.ceil(span));let floor=-Infinity;
 for(let i=0;i<=steps;i++){const a=i/steps,x=T.MathUtils.lerp(previousPosition.x,camera.position.x,a),z=T.MathUtils.lerp(previousPosition.z,camera.position.z,a);for(const [dx,dz] of [[0,0],[-.45,0],[.45,0],[0,-.45],[0,.45]])floor=Math.max(floor,navigationHeight(x+dx,z+dz));}
 camera.position.y=Math.max(floor+1.75,Math.min(camera.position.y,2100))
 if(!benchmark?.active&&animal.constrain(camera.position,previousPosition))stop();
 camera.position.y=Math.max(camera.position.y,navigationHeight(camera.position.x,camera.position.z)+1.75);
 }
 observer?.cpu('navigationCollision',performance.now()-navStart);
 const shadowStart=observer?performance.now():0;shadowFocus.apply(sun,camera,terrainHeight,stableShadow);observer?.cpu('shadowFocus',performance.now()-shadowStart)
 const animalStart=observer?performance.now():0;animal.update(elapsed,camera);observer?.cpu('animals',performance.now()-animalStart);
 const skyStart=observer?performance.now():0;sky.update(elapsed);sky.updateLighting(renderer,elapsed,camera,observer);observer?.cpu('skyInclusive',performance.now()-skyStart);
 const ps=performance.now();props.update(camera,elapsed);perfStage.propsMs=performance.now()-ps;observer?.cpu('propsUpdate',perfStage.propsMs);
 const terrainStart=observer?performance.now():0;landscape.update(camera);observer?.cpu('terrainManagement',performance.now()-terrainStart);
 const rs=performance.now();params.has('dry')?renderer.render(scene,camera):water.render(scene,camera,elapsed);perfStage.renderMs=performance.now()-rs;observer?.cpu('renderSubmissionInclusive',perfStage.renderMs);
 observer?.endGpuFrame();const reviewStart=observer?performance.now():0;benchmark?.afterFrame(raw,reviewState());observer?.cpu('reviewUIInclusive',performance.now()-reviewStart);
 if(frame++%30===0){let nearest=landmarks[0],dist=Infinity;for(const l of landmarks){const d=Math.hypot(l.p[0]-camera.position.x,l.p[2]-camera.position.z);if(d<dist){nearest=l;dist=d}}$('#place').textContent=dist>6500?'外海':nearest.name;$('#place-note').textContent=touring?'沿海岸、河谷和山脊连续飞行':dist>6500?'打开地图，随时返回海岛':nearest.note;const avg=frames.reduce((a,b)=>a+b,0)/frames.length;$('#status').textContent=`海拔 ${Math.round(camera.position.y)} m · ${Math.round(1000/avg)} fps${touring?' · 导览中':''}`;const ordered=[...frames].sort((a,b)=>a-b);const metrics={waterTime:elapsed,frameMs:{p50:ordered[Math.floor(ordered.length*.5)],p95:ordered[Math.floor(ordered.length*.95)],max:ordered.at(-1)},longFrames,cpu:perfStage,drawSize:[renderer.domElement.width,renderer.domElement.height],version:'island-r5',position:camera.position.toArray(),ground:terrainHeight(camera.position.x,camera.position.z),touring,tourT,cruise,speed:speeds[speedIndex],quality:fine?'high':'mobile',pixelRatio:renderer.getPixelRatio(),viewport:[innerWidth,innerHeight],fps:1000/avg,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,objects:props.counts,terrain:landscape.status()};$('#status').dataset.metrics=JSON.stringify(metrics);map($('#minimap'));}
 observer?.endFrame(performance.now()-frameStart);
}
workloadReview?.attach({getState:reviewState,setPaused:value=>pauseReason('user',value),go,clock,sky,water,landscape,props,benchmark,camera,quality:()=>{resizePending=true},setFine:value=>{fine=value;resizePending=true},setPixelScale:value=>{renderScale=value;resizePending=true},setTime:value=>{elapsed=worldBase=value;worldAnchor=activeNow()},getPaused:()=>pauseReasons.size>0,queueReviewJob,setAtlasNormalDeferred:value=>{deferredAtlasNormal.value=Boolean(value);},auditAtlasNormal:enabled=>{deferredAtlasNormal.value=Boolean(enabled);return water.auditAtlasNormal(scene,camera,elapsed);},auditWalk:()=>groundNav.audit(WALK_ROUTE.anchors,props.walkingRocks()),auditReflectionRegion:enabled=>{landscape.setReflectionTiles(enabled);return water.auditReflectionRegion(scene,camera,elapsed,enabled)}});
setInterval(()=>{if(lost)return;const state=reviewState();budgetNote.dataset.snapshot=JSON.stringify(state);workloadReview?.heartbeat(state);},1000);
addEventListener('pagehide',event=>{if(!event.persisted){props.dispose();landscape.dispose();sky.dispose();environmentTarget?.dispose();water.dispose?.();renderer.dispose();}});
requestAnimationFrame(render)

// A separate, explicitly enabled contract audit; never included in route timing.
if(diagnostics&&params.get('contractAudit')==='1'){
 const panel=document.createElement('section');panel.id='e09';panel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:80;background:#14252ef0;color:white;padding:10px;font:12px sans-serif';panel.innerHTML='<button id="e09-audit">合成契约审计</button><output id="e09-status">等待审计</output><pre id="e09-result" style="max-height:90px;max-width:440px;overflow:auto"></pre>';document.body.append(panel)
 const button=panel.querySelector('button');button.onclick=async()=>{
  if(lost){panel.querySelector('output').textContent='图形资源中断，审计已停止';return}
  if(benchmark.active||diagnostics.collecting){panel.querySelector('output').textContent='请先停止路线计时';return}
  button.disabled=true
  try {const {auditComposition}=await import('./contract-audit.js');if(lost){panel.querySelector('output').textContent='图形资源中断，审计已停止';return}if(benchmark.active||diagnostics.collecting){panel.querySelector('output').textContent='请先停止路线计时';return}const report=await queueReviewJob(()=>auditComposition(renderer,{scene,materials:water.auditMaterials(),resources:()=>[...sky.resources(),...water.resources(),...props.auditResources(),...(sun.shadow.map?[['sun-shadow',sun.shadow.map]]:[])]}));if(lost)return;panel.dataset.report=JSON.stringify(report);panel.dataset.passed=String(report.passed);panel.querySelector('output').textContent=report.passed?'审计完成':'审计失败';panel.querySelector('pre').textContent=JSON.stringify({preexistingGlErrors:report.preexistingGlErrors,probeGlErrors:report.probeGlErrors,checks:report.checks,probes:report.probes},null,2)}
  catch(error){panel.dataset.passed='false';panel.dataset.report=JSON.stringify({passed:false,error:String(error)});panel.querySelector('output').textContent='审计失败'}
  finally {button.disabled=lost}
 }
}
