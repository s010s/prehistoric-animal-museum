// Museum scene coordinates, not device geolocation. A report stays in the
// browser/clipboard until the visitor chooses to send it with their screenshot.
import {Euler,Vector3,Quaternion} from '../vendor/tidewater/src/engine/index.js';
import {G} from '../vendor/tidewater/src/core/Globals.js';
import {sceneImage,imageBase64} from './SceneCapture.js';

export function bindSceneReport(runtime,build){
 const button=document.querySelector('#copy-scene');if(!button)return;
 const box=document.querySelector('#scene-report-text'),details=document.querySelector('#scene-report-details'),status=document.querySelector('#scene-copy-status');
 const message=text=>{status.textContent=text;};
 const report=(withImage=false)=>{
  const a=runtime.app,c=a.camera;c.updateMatrixWorld();
  const p=c.getWorldPosition(new Vector3()),q=c.quaternion.toArray(),v=c.getWorldDirection(new Vector3()),e=new Euler().setFromQuaternion(c.quaternion,'YXZ');
  const grass=a.vegetation?.grass,gs=grass?.stats(),ground=a.terrainData?.heightAt(p.x,p.z);
  const packet={schema:'museum-scene-report-v1',id:'M-'+Date.now().toString(36),capturedAt:new Date().toISOString(),sourceHash:build.sourceHash,upstreamCommit:build.upstreamCommit,
   worldSample:a.creekData?{id:'west-fissure-to-sea-v1',enabled:!!a.creekData.field.continuousSample}:null,
   place:{arrivalId:a.currentLandmark,title:document.querySelector('#place-title')?.textContent,nearby:a.regionMap?.stats().label},
   camera:{position:p.toArray(),quaternion:q,headingDegrees:(Math.atan2(v.x,-v.z)*180/Math.PI+360)%360,pitchDegrees:Math.asin(Math.max(-1,Math.min(1,v.y)))*180/Math.PI,eulerYXZRadians:[e.x,e.y,e.z],fov:c.fov,zoom:c.zoom,freeCam:!!a.freeCam,mode:a.freeCam?'fly':a.player?.mode??'unknown',groundHeight:ground,heightAboveGround:Number.isFinite(ground)?p.y-ground:null},
   frame:{gpu:runtime.lastFrame?.frame??null,worldTime:G.time.value,running:runtime.running,output:[a.engine.width,a.engine.height],internal:[a.sceneRenderer.sceneRT.width,a.sceneRenderer.sceneRT.height],renderScale:a.settings.renderScale,aaMode:a.post?.aaMode},
   environment:{timeOfDay:a.settings.timeOfDay,windSpeed:G.windSpeed.value,windDirection:G.windDir.value.toArray(),exposure:a.settings.exposure,post:{autoExposure:a.post.autoExposure.enabled.value,filmGrain:a.post.params.grain.value,sharpen:a.post.params.sharpen.value,lookupTexturesReady:!!(a.post.aa.area&&a.post.aa.search),smaaBuilt:!!a.post.aa._smaa,actualPreFilter:a.post.aaMode==='smaataa'?(a.post.aa.area&&a.post.aa.search?'smaa':'fxaa fallback'):'none'},cloudShadowStrength:a.clouds?.shadowStrength.value??null,cloudShadow:a.clouds?.stabilityStats?.()??null},
   grass:gs?{visible:gs.visible,range:gs.range,cells:gs.cells,triangles:gs.triangles,visibility:gs.rangeAudit,groundAtCamera:grass.probeAt?.(p.x,p.z)??null}:null,
   review:{canopy:a.vegetation?.stats().canopyReview,ground:a.terrain?.review?Object.fromEntries(Object.entries(a.terrain.review.fields).map(([k,f])=>[k,f.value])):null,hillShadow:{...a.terrainGPU?.hillShadowStats,enabled:a.terrainGPU?.uSunBaked.value??null,terrainCast:a.terrain?.mesh.castShadow??null},habitatLegacyWater:a.creekData?.appearance.review.fields.legacyWater.value??null,surfPresentation:a.shoreSim?.stats().presentation??null,inlandPathLegacy:a.water?.material.depthReview.fields.pathLegacy.value??null,waterDebug:a.water?.material.debugMode?.value??0},
   axes:'metres; Y up; north=-Z; heading clockwise from north; pitch positive up',errors:runtime.errors.slice(-4)};
  const image=withImage?sceneImage(a.engine.canvas,packet):null;
  const f=n=>Number(n).toFixed(2);
  const text=`史前天地现场 ${packet.id}\n${packet.place.title} · ${packet.place.nearby??''}\n坐标（米）X ${f(p.x)} / Y ${f(p.y)} / Z ${f(p.z)}\n朝向 ${f(packet.camera.headingDegrees)}° / 俯仰 ${f(packet.camera.pitchDegrees)}° / 视场 ${f(c.fov)}°\n${packet.camera.mode} · ${packet.frame.output.join('×')} · 版本 ${build.sourceHash.slice(0,12)}\n${packet.image?'配套截图 '+packet.image.filename:'截图请附上以下完整定位信息。'}\n坐标为虚拟场景，不含设备位置。\n\n${JSON.stringify(packet,null,2)}`;
  box.value=text;runtime.sceneReport={id:packet.id,capturedAt:packet.capturedAt,sourceHash:packet.sourceHash};
  return {packet,text,image};
 };
 let imageUrl=null;
 const copyText=text=>{
  // Some embedded browser hosts resolve Clipboard.writeText while their
  // native paste path still sees an older item. Exercise the focused editing
  // copy path in the same gesture as well, without exposing/changing the form.
  const previous=document.activeElement,selection=window.getSelection(),ranges=[];
  if(selection)for(let i=0;i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
  const field=document.createElement('textarea');field.value=text;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px';document.body.append(field);field.select();
  let editingCopy=false;try{editingCopy=document.execCommand('copy');}catch{}field.remove();previous?.focus?.({preventScroll:true});
  if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}
  let modern;try{modern=Promise.resolve(navigator.clipboard.writeText(text)).then(()=>true,()=>false);}catch{modern=Promise.resolve(false);}
  return modern.then(ok=>ok||editingCopy);
 };
 const capture=async()=>{
  if(runtime.phase!=='ready'||runtime.lost||runtime.measuring||runtime.recording||runtime.recordingVideo||runtime.recordingAudio||runtime.walkingSample||runtime.sceneCapture?.busy)return;
  runtime.sceneCapture={busy:true};button.disabled=true;message('正在保存画面…');
  try{
   // Render once at dt=0 in this same user gesture, even when paused. Do not
   // stop/resume the scene or change its pose to obtain a usable GPU canvas.
   runtime.renderSceneStill();
   const {packet,text,image}=report(true);
   // Start clipboard access before awaiting PNG encoding/local persistence.
   const copied=copyText(text);
   const blob=await image,link=document.querySelector('#scene-shot-link');
   if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=URL.createObjectURL(blob);
   link.href=imageUrl;link.download=packet.image.filename;link.hidden=false;link.textContent='下载截图';link.click();
   let saved=false,artifact=null;
   if(location.hostname==='127.0.0.1'){
    try{const result=await runtime.save('scene',{packet,text,imageBase64:await imageBase64(blob)});saved=result.saved;artifact=result.artifact;}catch(error){runtime.event('scene-local-save-unavailable',{id:packet.id,message:String(error)});}
   }
   const clipboard=await copied;
   runtime.sceneCapture={busy:false,id:packet.id,frame:packet.frame.gpu,filename:packet.image.filename,imageBytes:blob.size,clipboard,savedLocally:saved,artifact,downloadRequested:true,runningBefore:packet.frame.running};
   if(!clipboard){details.open=true;box.focus();box.select();}
   message(clipboard?`${saved?'画面已保存':'截图已生成'} · 定位已复制`:`截图已生成 · 请按 ⌘C / Ctrl+C 复制已选文字`);
   runtime.event('scene-shot-saved',{...runtime.sceneCapture});
  }catch(error){runtime.sceneCapture={busy:false,error:String(error)};message('本次截图未完成 · '+error.message);runtime.event('scene-shot-failed',{message:String(error)});}
  finally{runtime.sceneCapture.busy=false;runtime.publish();}
 };
 button.onclick=capture;
 window.addEventListener('keydown',event=>{
  if(event.code!=='KeyP'||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  event.preventDefault();event.stopImmediatePropagation();void capture();
 },true);
 document.querySelector('#select-scene-report').onclick=()=>{if(runtime.phase!=='ready'||runtime.measuring||runtime.recordingVideo)return;if(!box.value)report();details.open=true;box.focus();box.select();message('已选中完整现场文字，可手动复制');};
 document.querySelector('#restore-scene-report').onclick=()=>{
  if(runtime.phase!=='ready'||runtime.measuring||runtime.recordingVideo)return;
  try{
   if(box.value.length>24000)throw Error('定位文字过长');
   const start=box.value.indexOf('{');if(start<0)throw Error('请粘贴完整的现场文字');
   const data=JSON.parse(box.value.slice(start)),c=data.camera;
   const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
   if(data.schema!=='museum-scene-report-v1'||!c||!vector(c.position,3)||!vector(c.quaternion,4))throw Error('定位格式不完整');
   if(Math.abs(c.position[0])>16300||Math.abs(c.position[2])>16300||c.position[1]<-500||c.position[1]>10000||!Number.isFinite(c.fov)||c.fov<20||c.fov>110)throw Error('机位超出岛屿检查范围');
   const len=Math.hypot(...c.quaternion);if(Math.abs(len-1)>.001)throw Error('机位旋转数据无效');
   const q=new Quaternion(...c.quaternion).normalize(),e=new Euler().setFromQuaternion(q,'YXZ');
   if(Math.abs(e.z)>.001)throw Error('此机位含滚转角，当前飞行相机暂不支持');
   const a=runtime.app;runtime.clearInput();a.setFreeCam(true);a.fly.setPose(new Vector3(...c.position),e.y,e.x);a.fly.velocity.set(0,0,0);a.camera.fov=c.fov;a.camera.zoom=Number.isFinite(c.zoom)&&c.zoom>=.5&&c.zoom<=4?c.zoom:1;a.camera.updateProjectionMatrix();
   a.query?.setCamera(c.position[0],c.position[2]);
   if(Number.isFinite(data.environment?.timeOfDay)&&data.environment.timeOfDay>=0&&data.environment.timeOfDay<=24){a.settings.timeOfDay=data.environment.timeOfDay;a.updateSun();const select=document.querySelector('#light-time');if(select){const value=String(a.settings.timeOfDay);if(![...select.options].some(o=>o.value===value)){const option=document.createElement('option');option.value=value;option.textContent='现场 · '+value+' 时';select.add(option);}select.value=value;}}
   const t=document.querySelector('#place-title');if(t)t.textContent='现场机位复现';const note=document.querySelector('#place-note');if(note)note.textContent='定点飞行观察，WASD 移动；地图可返回各区域。';
   a.currentLandmark='scene-report';runtime.resetHistory();runtime.resume();runtime.event('scene-report-restored',{id:typeof data.id==='string'?data.id.slice(0,80):null,versionMatches:data.sourceHash===build.sourceHash});details.open=false;
   message(data.sourceHash===build.sourceHash?'机位已还原 · 定点飞行观察':'机位已还原 · 来源版本不同，地形和画质可能有差异');
  }catch(error){message('未定位：'+error.message);}
 };
}
