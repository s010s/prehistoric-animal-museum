import {Euler,Quaternion,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {SAMPLE} from '../creek/ContinuousSample.js';
function mouthSurface(app){
 const design=app.creekData.field.continuousSample;if(!design)return null;const rows=[];
 for(let z=-64;z<=336;z+=2)for(let x=-1088;x<=-768;x+=2)rows.push([x,z,app.terrainData.heightAt(x,z),design.baselineHeight(x,z),...design.sample(x,z).slice(0,2)]);
 const forestShoreProbe=[];for(let z=-420;z<=-220;z+=4)for(let x=-900;x<=-760;x+=4)forestShoreProbe.push([x,z,app.terrainData.heightAt(x,z),design.baselineHeight(x,z)]);
 return {columns:['x','z','bed','originalBed','water','signedWaterEdge'],bounds:[-1088,-64,-768,336],stepMetres:2,rows,forestShoreProbe};
}
function sourceSurface(app){
 const design=app.creekData.field.continuousSample;if(!design)return null;const rows=[];
 for(let z=-524;z<=-460;z+=.25)for(let x=-688;x<=-616;x+=.25)rows.push([x,z,app.terrainData.heightAt(x,z),design.baselineHeight(x,z)]);
 const texelCentres=[];
 for(let z=-506+.125;z<-480;z+=.25)for(let x=-660+.125;x<-630;x+=.25)texelCentres.push([x,z,app.terrainData.heightAt(x,z),design.baselineHeight(x,z)]);
 return {columns:['x','z','bed','originalIslandBed'],bounds:[-688,-524,-616,-460],stepMetres:.25,rows,texelCentres};
}
export function sampleState(app){
 const s=app.creekData?.field.continuousSample;
 return {renderVisibility:{terrain:app.terrain?.mesh.visible,landmarks:app.sampleDetails?.group.visible,breakerLips:app.breakers?.mesh.visible},enabled:!!s,id:SAMPLE.id,mode:s?'authored finite sample':'snapshot landform comparison',metres:s?.length??null,seaLevel:SAMPLE.sea,sections:SAMPLE.sections,channelControls:SAMPLE.channelControls,terrain:s?.terrainAudit??null,forest:app.vegetation?.sampleForest??null,details:app.sampleDetails?.stats()??null,scientificStatus:'modern landform and forest-structure analogy; authored local datum, no fused survey or species reconstruction'};
}
export function bindSampleInspection(runtime,build){
 const a=runtime.app,select=document.querySelector('#sample-place'),compare=document.querySelector('#sample-compare'),profile=document.querySelector('#sample-profile');
 if(!select)return;
 select.onchange=()=>{if(runtime.phase!=='ready'||runtime.recordingVideo||runtime.measuring)return;runtime.clearInput();a.showLandmark(select.value);runtime.resetHistory();runtime.resume();};
 compare.onclick=()=>{
  if(runtime.phase!=='ready'||runtime.recordingVideo||runtime.measuring)return;
  sessionStorage.setItem('museum-sample-comparison',JSON.stringify({position:a.camera.position.toArray(),quaternion:a.camera.quaternion.toArray(),fov:a.camera.fov,time:a.settings.timeOfDay,place:a.currentLandmark}));
  const url=new URL(location.href);if(url.searchParams.get('sample')==='baseline')url.searchParams.delete('sample');else url.searchParams.set('sample','baseline');location.assign(url.href);
 };
 compare.textContent=new URLSearchParams(location.search).get('sample')==='baseline'?'返回连续样板':'本机位原版对照';
 profile.onclick=async()=>{
  if(runtime.phase!=='ready'||runtime.recordingVideo||runtime.measuring)return;
  const lod=a.terrain.lod;
  await runtime.save('acceptance',{kind:'finite-continuous-sample',build,sample:sampleState(a),geometry:a.geometryAudit,mouthSurface:mouthSurface(a),sourceSurface:sourceSurface(a),terrainMesh:{gridSize:lod.G,nodes:Array.from(lod.nodeArray.slice(0,lod.count*4)),ranges:lod.ranges,morph:lod.uMorph.array.map(v=>v.toArray())},state:runtime.state()});document.querySelector('#status').textContent='样板剖面与一致性证据已保存';
 };
 runtime.restoreSampleComparison=()=>{
  const raw=sessionStorage.getItem('museum-sample-comparison');if(!raw)return;sessionStorage.removeItem('museum-sample-comparison');
  const p=JSON.parse(raw),q=new Quaternion(...p.quaternion),e=new Euler().setFromQuaternion(q,'YXZ');a.setFreeCam(true);a.fly.setPose(new Vector3(...p.position),e.y,e.x);a.fly.velocity.set(0,0,0);a.camera.fov=p.fov;a.camera.updateProjectionMatrix();a.settings.timeOfDay=p.time;a.updateSun();a.query.setCamera(p.position[0],p.position[2]);a.currentLandmark=p.place;
  const baseline=new URLSearchParams(location.search).get('sample')==='baseline';document.querySelector('#place-title').textContent=(baseline?'原版 · ':'')+(a.islandVisits?.[p.place]?.title??'同机位对照');runtime.resetHistory();runtime.event('sample-comparison-restored',{baseline,position:p.position});
 };
}
