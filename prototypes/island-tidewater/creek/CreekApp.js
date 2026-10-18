import {installIslandHillShadow} from './IslandHillShadow.js';
import {ShelfReef} from './ShelfReef.js';
// Museum-owned application composition. Native orchestration/helper methods are
// derived from Tidewater4811ba48 App.js (MIT, DRG Software Solutions LLC).
import { MuseumApp } from '../museum/MuseumApp.js';
import { createMuseumAnimals } from '../museum/animals.js';
import { Vector3, Euler, MathUtils } from '../vendor/tidewater/src/engine/index.js';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { FrameUniforms } from '../vendor/tidewater/src/engine/render/Frame.js';
import { SunShadows } from '../vendor/tidewater/src/engine/render/Shadows.js';
import { Engine } from '../vendor/tidewater/src/core/Engine.js';
import { Input } from '../vendor/tidewater/src/core/Input.js';
import { G } from '../vendor/tidewater/src/core/Globals.js';
import { SceneRenderer, LAYERS } from '../vendor/tidewater/src/core/SceneRenderer.js';
import { Atmosphere } from '../vendor/tidewater/src/sky/Atmosphere.js';
import { Sky } from '../vendor/tidewater/src/sky/Sky.js';
import { MuseumClouds } from './MuseumClouds.js';
import { Environment } from '../vendor/tidewater/src/sky/Environment.js';
import { computeShoreField } from '../vendor/tidewater/src/world/ShoreField.js';
import { expandMuseumCoast, installFineCoreGPU } from './CoastTerrain.js';
import {expandWatershed} from './WatershedData.js';
import {expandWholeIsland,installIslandTerrainGPU} from './WholeIslandData.js';
import { createCoastalOcean } from './CoastalOcean.js';
import { TerrainGPU } from '../vendor/tidewater/src/world/TerrainGPU.js';
import {IslandLife} from './IslandLife.js';
import {LandscapeDetails} from './LandscapeDetails.js';
import {MuseumColliders} from './MuseumColliders.js';
import { LocalLights } from '../vendor/tidewater/src/materials/LocalLights.js';
import { installGroundBounce } from '../vendor/tidewater/src/materials/GroundBounce.js';
import { PostFX } from '../vendor/tidewater/src/post/PostFX.js';
import {ForestAir,ForestMotes} from './ForestAir.js';
import {GroveDetails} from './GroveDetails.js';
import { LENS_REACH } from '../vendor/tidewater/src/post/Underwater.js';
import { FlyCamera } from '../vendor/tidewater/src/player/FlyCamera.js';
import { updateCameraVelocity } from '../vendor/tidewater/src/post/CameraVelocity.js';
import { loadCreekData } from './CreekData.js';
import { CreekTerrain } from './CreekTerrain.js';
import { CreekForest } from './CreekForest.js';
import { loadConiferTextures } from './ConiferGeometry.js';
import {createMeadowAppearance} from './MeadowAppearance.js';
import {ShoreHabitats} from './ShoreHabitats.js';
import {CoveRocks} from './CoveRocks.js';
import {refineCoveShoreField} from './CoveShoreField.js';
import {MuseumSeaSound} from './MuseumSeaSound.js';
import {MuseumPlankton} from './MuseumPlankton.js';
import {createIslandVisits} from './IslandVisits.js';
import {ISLAND_PLAN} from '../island/plan.js';
import { CreekPlayer } from './CreekPlayer.js';
import { CreekRefraction, CreekUnderwater, clipCreekRefraction, createCreekWater, installCreekLighting } from './CreekWater.js';

export class CreekApp extends MuseumApp {
  constructor(){super();this.settings.timeOfDay=12.6;}
  async init(onProgress=()=>{}) {
    const progress=async(p,text)=>{onProgress(p,text);await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));};
    await progress(.02,'准备溪谷…');
    const engine=this.engine=new Engine(document.querySelector('#app'));await engine.init();
    const {scene,camera}=engine;Object.assign(this,{scene,camera,renderer:engine});camera.near=.1;camera.far=300000;camera.updateProjectionMatrix();
    this.input=new Input(engine.domElement);this.fly=new FlyCamera(camera,engine.domElement,this.input);this.fly.speed=48;
    this.atmosphere=new Atmosphere(engine);this.sky=new Sky(this.atmosphere);
    this.clouds=new MuseumClouds(engine,this.atmosphere);await this.clouds.ready;this.sky.clouds=this.clouds;
    this.shadows=this.csm=new SunShadows({size:2048,splits:[10,60,400],lightMargin:200,normalBias:[.015,.06,.3],bias:.00002});
    this.shadows.layerMask=(1<<LAYERS.OPAQUE)|(1<<LAYERS.TRANSPARENT);
    this.environment=new Environment(engine,scene,this.sky);
    await progress(.10,'还原河床、岩壁与林间小径…');
    const data=this.creekData=await expandWholeIsland(await expandWatershed(await expandMuseumCoast(await loadCreekData())));this.geography=data.geography;this.terrainData=data.terrain;
    G.seaLevel.value=-.7;G.windSpeed.value=3.2;G.waterAbsorption.value.set(.16,.07,.045);G.waterScattering.value.set(.006,.010,.006);
    this.colliders=new MuseumColliders();
    this.shoreField=computeShoreField(this.terrainData,{res:1024,seaLevel:-.7,swellDir:[1,0]});
    // Native SoundScape reserves times >=10000 for invalid propagation. The
    // larger domain changes only the field's arbitrary time origin. Shift both
    // arrival channels before GPU upload so shore visuals and audio stay in phase.
    const shoreTimeOrigin=this.terrainData.size-4096;for(let k=0;k<this.shoreField.data.length;k+=4)for(const c of [0,3])if(this.shoreField.data[k+c]<90000)this.shoreField.data[k+c]-=shoreTimeOrigin;
    this.shoreField.timeOriginSeconds=4096;
    this.terrainGPU=installIslandTerrainGPU(new TerrainGPU(this.terrainData,this.shoreField),data);installIslandHillShadow(this.terrainGPU);this.terrainGPU.shoreField=this.shoreField;refineCoveShoreField(this.terrainGPU,this.terrainData,this.shoreField,data.cove);data.field.useTerrainGPU(this.terrainGPU);
    data.appearance=createMeadowAppearance(data,this.terrainGPU);
    this.terrain=new CreekTerrain({scene,data,terrainGPU:this.terrainGPU});
    await progress(.17,'生长溪谷针叶林…');
    await loadConiferTextures();this.vegetation=new CreekForest({scene,data,colliders:this.colliders,terrainGPU:this.terrainGPU});
    this.groveDetails=new GroveDetails({scene,data,forest:this.vegetation,colliders:this.colliders});
    this.localLights=new LocalLights();
    this.sceneRenderer=new SceneRenderer(engine.meshRenderer,scene,camera);this.sceneRenderer.background=this.sky.background;
    this.refraction=new CreekRefraction({meshRenderer:engine.meshRenderer,scene,camera,sceneRenderer:this.sceneRenderer,scale:.5},data.field);
    this.sceneRenderer.onBeforeWater=()=>this.refraction.render();
    await progress(.21,'连接自己的海岸与原生海浪…');
    Object.assign(this,createCoastalOcean(this,data));this.terrain.setCoastWetness(this.shoreSim);
    this.islandVisits=createIslandVisits(data);
    const east=this.islandVisits['east-bay'];data.hydrology.coasts.push({id:'east-coast',name:'东湾砂砾岸',kind:'sheltered-bay',x:east.p[0],z:east.p[1],visit:east.p,gaze:east.gaze});
    const shores=[...data.hydrology.coasts,...data.island.lakes.map(b=>({id:b.id+'-shore',kind:'freshwater-shore',level:b.level,x:this.islandVisits[b.id==='lake'?'lake':'highland-lake'].p[0],z:this.islandVisits[b.id==='lake'?'lake':'highland-lake'].p[1]}))];
    this.shoreHabitats=new ShoreHabitats({scene,data,terrainGPU:this.terrainGPU,sites:shores});
    this.coveRocks=new CoveRocks({scene,terrain:{data:data.terrain,gpu:this.terrainGPU},colliders:this.colliders,seed:17615});
    this.shelfReef=new ShelfReef(this,data);
    this.marineSnow=new MuseumPlankton({fft:this.fft,query:{module:this.query.module},count:12000,box:8});this.marineSnow.opacity.value=.24;scene.add(this.marineSnow.mesh);
    this.audio=new MuseumSeaSound({shore:this.shore,field:this.shoreField,terrain:data.terrain,trees:this.vegetation.records});
    installCreekLighting(data.field,this.terrainGPU,this.clouds,this.underwaterLighting);installGroundBounce({terrain:this.terrainGPU,clouds:this.clouds});
    this.water=createCreekWater({scene,sky:this.sky,clouds:this.clouds,sceneRenderer:this.sceneRenderer,field:data.field,terrain:this.terrainGPU,refraction:this.refraction,query:this.query,foamTexture:this.foamTexture});
    this.surface=this.water.surface;this.waterMaterial=this.water.material;
    this.player=new CreekPlayer({camera,input:this.input,terrain:this.terrainData,colliders:this.colliders,query:this.query,boat:null});
    this.islandVisits=createIslandVisits(data);
    this.landscapeDetails=new LandscapeDetails({scene,data,colliders:this.colliders});
    this.life=new IslandLife({app:this,data,visits:this.islandVisits});this.audio.life=this.life;
    this.airMotes=new ForestMotes({terrain:this.terrainGPU,clouds:this.clouds,csm:this.shadows},data.field,data.terrain);scene.add(this.airMotes.mesh);
    await progress(.24,'接入林缘的史前动物…');
    this.animals=await createMuseumAnimals(this);
    for(const a of this.animals.state()){
      const p=a.position;
      this.colliders.addBox(new Vector3(p[0],p[1]+(a.id==='apatosaurus'?2.6:1.7),p[2]),a.id==='apatosaurus'?new Vector3(10,2.8,1.4):new Vector3(1.35,1.8,3.7),this.geography.animals.find(x=>x.id===a.id).yaw,{tag:'museum animal',solid:true});
    }
    const clipped=new Set();scene.traverse(o=>{if(o.isMesh&&o.material&&!o.material.isWaterMaterial&&!clipped.has(o.material)){clipped.add(o.material);clipCreekRefraction(o.material,data.field);}});
    this.underwater=new CreekUnderwater({depthTexture:this.sceneRenderer.sceneRT.depthTexture,maskTexture:this.sceneRenderer.waterMaskTexture,query:{module:this.query.mediumModule},caustics:this.caustics,fft:this.fft});
    this.haze=new ForestAir({depthTexture:this.sceneRenderer.sceneRT.depthTexture,underwater:this.underwater,atmosphere:this.atmosphere,sky:this.sky,clouds:this.clouds,terrain:this.terrainGPU,csm:this.csm},data.terrain);
    this.post=new PostFX(engine,{sceneRenderer:this.sceneRenderer,camera,underwater:this.underwater,clouds:this.clouds,sunDir:this.atmosphere.sunDir,haze:this.haze});
    // Native morphological prefilter stabilises fine needle edges before TAA.
    // Keep native sharpening and report the actual lookup/fallback path.
    this.post.aaMode='smaataa';
    this.setRenderScale(this.settings.renderScale);G.exposure.value=this.settings.exposure;G.seaLevel.value=-.7;
    G.windSpeed.value=3.2;G.waterAbsorption.value.set(.16,.07,.045);G.waterScattering.value.set(.006,.010,.006);this.updateSun();
    this.islandVisits=createIslandVisits(data);
    const requested=new URLSearchParams(location.search).get('place');
    const waterView=new URLSearchParams(location.search).get('water');
    this.showLandmark(['giant','coast','rock-cove','estuary',...ISLAND_PLAN.pilots.map(p=>p.id),...Object.keys(this.islandVisits)].includes(requested)?requested:'entrance');
    if(['sea-under','lake-under','highland-under','east-under'].includes(waterView))this.waterView(waterView);
    engine.domElement.addEventListener('click',()=>this.input.requestLock());
    this.gpu=GPU;window.__app=this;
    await progress(.36,'准备光照与水面…');await this.precompile();for(const t of this.terrainGPU.retiredTerrainTextures??[])t.destroy();this.terrainGPU.retiredTerrainTextures=[];
    await progress(.96,'走进溪谷…');for(let i=0;i<2;i++){this.frame(1/60);await GPU.queue.onSubmittedWorkDone();}
    this.geometryAudit=await data.field.auditGPU(this.terrainGPU);
    await this.vegetation.grass.auditGround();
  }
  setFreeCam(on){
    super.setFreeCam(on);
    if(on){const e=new Euler().setFromQuaternion(this.camera.quaternion,'YXZ');this.fly.setPose(this.camera.position.clone(),e.y,e.x);this.fly.velocity.set(0,0,0);}
  }
  showLandmark(id){
    const region=document.querySelector('#region-place'),regionId=id.startsWith('giant-')?'giant-forest':id;
    if(region&&Array.from(region.options).some(o=>o.value===regionId))region.value=regionId;
    const grove=document.querySelector('#grove-visits');if(grove)grove.hidden=!['giant-forest','giant-root','giant-glade','giant-log','giant-heart','giant-avenue','giant-decomposition','giant-canopy','giant-extent','review-grove-lod'].includes(id);
    const coast=this.creekData.coast.coast;
    this.fly.velocity.set(0,0,0);
    const visit=this.islandVisits?.[id];
    if(document.querySelector('#light-time')?.value==='auto')this.settings.timeOfDay=visit?.time??({coast:10.7,'rock-cove':14.5,estuary:15.5}[id]??12.6);
    if(visit){
      if(visit.target)this.vegetation.setReview({target:visit.target});
      if(visit.diveLevel!==undefined){const [x,z]=visit.p,h=visit.diveLevel;this.freeCam=false;this.camera.position.set(x,h-1.2,z);this.camera.lookAt(new Vector3(...visit.gaze));const e=new Euler().setFromQuaternion(this.camera.quaternion,'YXZ');this.player.position.set(x,h-1.362,z);this.player.mode='swim';this.player.floating=false;this.player.wet=true;this.player.grounded=false;this.player.waterH=this.player.waterMean=h;this.player.velocity.set(0,0,0);this.player.yaw=e.y;this.player.pitch=e.x;this.player._camY=null;this.player.update(0);this.query.setCamera(x,z);this.cameraWaterHeight=h;this.currentLandmark=id;document.querySelector('#place-title').textContent=visit.title;document.querySelector('#place-note').textContent=visit.note;return;}
      if(document.querySelector('#light-time')?.value==='auto')this.settings.timeOfDay=visit.time;
      if(visit.fly){this.camera.position.set(...visit.p);this.camera.lookAt(new Vector3(...visit.gaze));this.setFreeCam(true);this.query.setCamera(this.camera.position.x,this.camera.position.z);this.currentLandmark=id;document.querySelector('#place-title').textContent=visit.title;document.querySelector('#place-note').textContent=visit.note;return;}
    }
    const reviewPlaces=Object.fromEntries(ISLAND_PLAN.pilots.flatMap(p=>[[p.id,{id:p.id,title:p.name,note:p.id==='mixed-forest'?'从针叶林走向扇叶混交林，观察林冠和林下层次。':'沿山腰走，看矮针林、裸岩和开阔草坡。',p:p.arrival??p.local,gaze:p.arrivalGaze??p.gaze}],['compare-'+p.id,{id:'compare-'+p.id,title:p.name+' · 原机位对照',note:'与外延前相同的相机位置和方向。',p:p.local,gaze:p.gaze}]]));
    Object.assign(reviewPlaces,{
      ...Object.fromEntries(this.creekData.hydrology.coasts.filter(s=>s.id!=='coast').map(s=>[s.id,{id:s.id,title:s.name,note:s.id==='estuary'?'溪水沿主河道进入潮汐河口，砂砾洲、漂积线和海浪在这里相遇。':'陡岸围成小岩湾，潮间带以礁石和磨圆石为主。',p:s.visit,gaze:s.gaze}])),
      'review-river':{id:'review-river',title:'溪流接续对照',note:'这里位于原先水面生成范围之外。沿水道看向下游。',p:[this.creekData.field.riverAt(450).x+this.creekData.field.riverAt(450).width+5,450],gaze:[this.creekData.field.riverAt(550).x,this.creekData.field.riverAt(550).level,550]},
      'review-mouth':{id:'review-mouth',title:'沿溪流向海',note:'主水道在前方逐渐降至海平面，接入真实河口。',p:[this.creekData.field.riverAt(3200).x+this.creekData.field.riverAt(3200).width+8,3200],gaze:[this.creekData.field.riverAt(3400).x,-.7,3400]},
      'review-slope':{id:'review-slope',title:'坡地贴地对照',note:'沿坡面步行，近看草根与地面接触。',p:[24,-64],gaze:[46,25,-50]},
      'review-meadow':{id:'review-meadow',title:'草甸层次对照',note:'走近草甸，观察地被和远近衔接。',p:[-556,308],gaze:[-620,105,372]},
      'review-canopy':{id:'review-canopy',title:'单树交接对照',note:'向前走过近远树交接距离。诊断面板可固定表示、关风或只看目标树。',p:[5.963828455,120.907625301],gaze:[5.963828455,28.3,48.907625301]},
      'review-stand':{id:'review-stand',title:'远林接近对照',note:'靠近同一片针叶林，观察树冠身份与大小。',p:[15.202,224.12],gaze:[15.202,30,44.12]},
    });
    if(id==='review-cliff'){
      this.camera.position.set(-110,112,70);this.camera.lookAt(new Vector3(-250,230,-90));this.setFreeCam(true);this.query.setCamera(-110,70);this.currentLandmark=id;
      document.querySelector('#place-title').textContent='崖壁轮廓对照';document.querySelector('#place-note').textContent='自由飞行查看崖面起伏、层理与接地。';return;
    }
    if(id==='aerial'){
      this.camera.position.set(100,920,650);this.camera.lookAt(new Vector3(-420,70,-40));this.setFreeCam(true);
      this.query.setCamera(this.camera.position.x,this.camera.position.z);this.currentLandmark=id;
      document.querySelector('#place-title').textContent='从溪谷到海岸';document.querySelector('#place-note').textContent='自由升空。WASD 飞行，E / 空格上升，Q / C 下降，Shift 加速。F 返回步行。';return;
    }
    if(id==='review-horizon'){this.camera.position.set(100,920,650);this.camera.lookAt(new Vector3(-8000,800,650));this.setFreeCam(true);this.query.setCamera(100,650);this.currentLandmark=id;document.querySelector('#place-title').textContent='高空海天交界';document.querySelector('#place-note').textContent='水平观察海面覆盖与大气交界。';return;}
    if(id==='review-sea-aerial'){
      this.camera.position.set(100,920,650);this.camera.lookAt(new Vector3(-1900,0,760));this.setFreeCam(true);this.query.setCamera(100,650);this.currentLandmark=id;document.querySelector('#place-title').textContent='海面高空对照';document.querySelector('#place-note').textContent='观察岸边到远海的法线与水深是否连续。';return;
    }
    const extra=id==='falls'?{id,title:'侧泉跌水',note:'从浅池溢出的侧泉沿原岩阶下降，在下方汇入溪流。',p:[-42,-56],gaze:[-47.5,28.3,-61.5]}:id==='coast'?{id,title:'西岸贝壳滩',note:'沿浅砂通道涉水，点“浅湾鱼群”可潜入砂槽近看。抬头看海鸟掠岸，开启自然声听逐浪与鸟鸣。',p:[coast.x+5,coast.z],gaze:[coast.x-20,-1.1,coast.z]}:null;
    const place=visit??reviewPlaces[id]??extra??(id==='boundary'?{id,title:'岛屿边界对照',note:'本地检查机位。前方为本轮扩展地形的东缘。',p:[2023.7,0],gaze:[2040,this.terrainData.heightAt(2023.7,0)+1.62,0]}:this.geography.landmarks.find(x=>x.id===id));if(!place)return;
    if(id==='review-canopy'||id==='review-stand'){const target=this.vegetation.records.reduce((best,r)=>Math.hypot(r.x-place.gaze[0],r.z-place.gaze[2])<Math.hypot(best.x-place.gaze[0],best.z-place.gaze[2])?r:best);this.vegetation.setReview({target:[target.x,target.z]});}
    const pilot=ISLAND_PLAN.pilots.find(p=>p.id===id);
    if(pilot){const [px,pz]=place.p,dx=place.gaze[0]-px,dz=place.gaze[2]-pz,n=Math.hypot(dx,dz),tx=px+dx/n*55,tz=pz+dz/n*55,candidates=this.vegetation.records.filter(r=>r.variant===(id==='mixed-forest'?2:3));if(candidates.length){const target=candidates.reduce((a,b)=>Math.hypot(a.x-tx,a.z-tz)<Math.hypot(b.x-tx,b.z-tz)?a:b);this.vegetation.setReview({target:[target.x,target.z]});}}
    const [x,z]=place.p,h=this.terrainData.heightAt(x,z);
    this.camera.position.set(x,h+1.62,z);this.camera.lookAt(new Vector3(...place.gaze));
    this.freeCam=false;this.dropPlayerAtCamera();this.player.position.set(x,h,z);this.player.grounded=true;this.player.mode='walk';this.player._camY=null;
    this.player.wet=false;this.player.velocity.set(0,0,0);this.query.setCamera(x,z);this.player.waterMean=this.player.waterH=this.query.sample(x,z)[0];this.cameraWaterHeight=this.query.cpu[0];this.animals.hold();this.currentLandmark=id;
    const title=document.querySelector('#place-title'),note=document.querySelector('#place-note');if(title)title.textContent=place.title;if(note)note.textContent=place.note;
  }
  waterView(view='surface'){
    const grove=document.querySelector('#grove-visits');if(grove)grove.hidden=true;
    if(view==='cove-rock'){
      const r=this.coveRocks.instances.find(r=>r.size>=3&&r.y+r.size*r.sy*.8<-.3);
      if(!r)throw Error('Missing submerged cove review rock');
      this.freeCam=false;this.player.position.set(r.x,Math.max(this.terrainData.heightAt(r.x,r.z+r.size+3)+.2,r.y+r.size*.25),r.z+r.size+3);this.player.mode='swim';this.player.floating=false;this.player.wet=true;this.player.waterH=this.player.waterMean=-.7;this.player.velocity.set(0,0,0);this.player.yaw=0;this.player.pitch=0;this.player._camY=null;this.player.update(0);this.query.setCamera(this.player.position.x,this.player.position.z);this.currentLandmark=view;
      document.querySelector('#place-title').textContent='浅湾潜石近看';document.querySelector('#place-note').textContent='向前游近大石，检查石体、沙槽和真实碰撞。';return;
    }
    if(['lake-under','highland-under','east-under'].includes(view)){
      const b=view==='lake-under'?this.creekData.island.lakes[0]:view==='highland-under'?this.creekData.island.lakes[1]:null;
      const center=b?{x:b.center[0]+b.rx*.68,z:b.center[1]+b.rz*.1,h:b.level}:(()=>{const p=this.creekData.cove.shelves[1].at(0,175);return{x:p[0],z:p[1],h:-.7};})();
      let best=null;for(let dz=-40;dz<=40;dz+=4)for(let dx=-40;dx<=40;dx+=4){const x=center.x+dx,z=center.z+dz,h=this.terrainData.heightAt(x,z),water=this.query.height(x,z),depth=water-h;if(depth>2&&depth<14&&(!best||Math.hypot(dx,dz)<best.score))best={x,z,h:water,score:Math.hypot(dx,dz)};}
      if(!best)throw Error('No valid underwater arrival for '+view);const q=best;this.freeCam=false;this.player.position.set(q.x,q.h-1.5,q.z);this.player.mode='swim';this.player.floating=false;this.player.wet=true;this.player.waterMean=this.player.waterH=q.h;this.player.velocity.set(0,0,0);this.player.yaw=.65;this.player.pitch=-.07;this.player._camY=null;this.player.update(0);this.query.setCamera(q.x,q.z);this.currentLandmark=view;document.querySelector('#place-title').textContent=b?b.name+' · 水下':'东湾 · 水下';document.querySelector('#place-note').textContent='抬头看水面、转头观察床面与鱼群；空格上浮、C 下潜。';return;
    }
    if(view==='sea-under'){
      const point=this.creekData.cove.shelves[0].at(0,175),px=point[0],z=point[1],h=this.query.sample(px,z)[0];
      this.freeCam=false;this.player.position.set(px,h-1.5,z);this.player.mode='swim';this.player.floating=false;this.player.wet=true;this.player.waterMean=this.player.waterH=h;this.player.velocity.set(0,0,0);this.player.yaw=-Math.PI/2;this.player.pitch=-.12;this.player._camY=null;this.player.update(0);this.query.setCamera(px,z);this.currentLandmark='sea-under';
      document.querySelector('#place-title').textContent='海面之下';document.querySelector('#place-note').textContent='海浪与水下仍属同一片海。WASD 游动，C 下潜，空格上浮。';return;
    }
    if(view==='shore'){
      const x=-26,z=0,h=this.terrainData.heightAt(x,z);
      this.freeCam=false;this.player.position.set(x,h,z);this.player.mode='walk';this.player.grounded=true;this.player.wet=false;this.player.waterMean=this.player.waterH=h-.2;this.player.velocity.set(0,0,0);this.player.yaw=-Math.PI/2;this.player.pitch=0;this.player._camY=null;this.player.update(0);
      this.currentLandmark='shore';document.querySelector('#place-title').textContent='溪岸入水';document.querySelector('#place-note').textContent='沿前方缓岸走入河道。深水中 C 下潜、空格上浮，后退可返回岸边。';this.animals.hold();return;
    }
    const under=view==='under';
    const point=this.deepWaterPoint();const h=this.query.height(point.x,point.z),ground=this.terrainData.heightAt(point.x,point.z);
    this.freeCam=false;this.player.position.set(point.x,under?Math.max(ground+.32,h-.9):h-.06,point.z);this.player.mode='swim';this.player.waterMean=this.player.waterH=h;this.player.floating=!under;this.player.wet=true;this.player.velocity.set(0,0,0);this.player.yaw=.8;this.player.pitch=under?.3:-.05;this.player._camY=null;
    this.player.update(0);this.query.setCamera(point.x,point.z);this.cameraWaterHeight=h;this.animals.hold();this.currentLandmark=under?'underwater':'waterline';
    document.querySelector('#place-title').textContent=under?'水下观察':'近看水面';document.querySelector('#place-note').textContent='WASD 游动，C 下潜，空格上浮。玩法仍在探索中。';
  }
  deepWaterPoint(){
    if(this._deep)return this._deep;let best={depth:0,x:0,z:0};
    for(let z=-100;z<160;z+=1)for(let x=-90;x<40;x+=1){const f=this.query.sample(x,z);if(f[1]>-1)continue;const depth=f[0]-this.terrainData.heightAt(x,z);if(depth>best.depth)best={depth,x,z};}
    if(best.depth<.9)throw Error('Original creek has no verified underwater observation depth');this._deep=best;return best;
  }
  async precompile(){
    const mr=this.engine.meshRenderer;if(!this.post._built){this.post._build();this.post._outW=0;}
    await GPU.pipelinesReady();mr.precompiling=true;
    try{this.frame(1/60);}finally{mr.precompiling=false;}
    await GPU.pipelinesReady();await GPU.queue.onSubmittedWorkDone();
  }
  _frame(dt){
    GPU.beginFrame();FrameUniforms.fields.frameIndex.value=GPU.frame;G.dt.value=dt;G.time.value+=dt;this.updateFPS(dt);
    if(this.input.hit('KeyF'))this.setFreeCam(!this.freeCam);
    if(this.freeCam)this.fly.update(dt);else this.player.update(dt);
    this.regionMap?.update(performance.now());
    this.animals.update(dt);this.updateSun();this.atmosphere.update(dt,this.camera.position.y);this.applyAtmosphereReadback();
    this.fft.update(dt);this.seaDetail.update(dt);
    this.query.setCamera(this.camera.position.x,this.camera.position.z);this.query.update();const h=this.query.cpu[0];this.cameraWaterHeight=h;G.cameraWaterHeight.value=h;G.cameraUnderwater.value=this.camera.position.y<h-LENS_REACH?1:0;
    // The FFT clock never pauses. Prewarm surf well before reaching the coast;
    // the opaque valley ridge hides the sea while these cached maps are idle.
    const c=this.camera.position;
    this.airMotes?.update(dt,this.camera,h);this.life?.update(dt,this.camera);this.landscapeDetails?.update(this.camera);this.shoreHabitats.update(this.camera);this.coveRocks?.update(this.camera);this.shelfReef?.update(this.camera);this.marineSnow.opacity.value=h>1?.12:.42;this.marineSnow.update(this.camera,c.y<h+LENS_REACH&&h>-89);this.audio.updateAt(dt,this.camera,h,this.settings.timeOfDay);
    const edge=Math.max(Math.abs(c.x),Math.abs(c.z));
    const active=this.engine.meshRenderer.precompiling||(this.coastalActive?(edge>340||c.y>100):(edge>420||c.y>120));
    this.coastalActive=active;this.ocean.visible=active&&this.reviewOcean!==false;this.water.mesh.visible=this.reviewInland!==false;for(const m of this.water.extensions)m.visible=this.reviewInland!==false;this.breakers.mesh.visible=active&&this.reviewOcean!==false;this.spray.mesh.visible=active&&this.reviewOcean!==false;
    if(active){this.caustics.update();this.shoreSim.update(this.camera);this.underwaterLighting.update(this.camera);this.breakers.update(this.camera);this.spray.update();this.oceanLOD.update(this.camera);}
    this.clouds.update(dt,this.camera);this.environment.update(dt);this.terrain.update(this.camera);this.vegetation.update(dt,this.camera);this.localLights.update(this.camera,dt);
    G.exposure.value=this.settings.exposure;updateCameraVelocity(this.camera);this.post.lens.update(dt,this.camera.position.y<h);
    if(this.post.flare){this.post.flare.setDepthHeight(this.sceneRenderer.sceneRT.height);this.post.flare.update(this.camera,dt,{aboveWater:this.camera.position.y>h-.02});}
    this.post.beginFrame();this.underwater.updateCamera(this.camera);this.shadows.render(this.scene,this.engine.meshRenderer,this.shadows.update(this.camera,G.sunDir.value));
    this.sceneRenderer.render();if(this.post.flare)this.post.flare.kernel.dispatch(1);this.post.render();this.post.endFrame();GPU.submit();this.input.endFrame();
  }
  sliceState(){if(!this.player||!this.water||!this.breakers)return {loading:true};return {cloudShadow:this.clouds.stabilityStats(),regionMap:this.regionMap?.stats(),name:'溪畔的巨影',region:this.geography.region,sourceOrigin:this.geography.sourceOrigin,translationOnly:this.geography.translationOnly,relief:this.geography.relief,sourceAnimalSites:this.geography.animals,currentLandmark:this.currentLandmark,conditions:{timeOfDay:this.settings.timeOfDay,windSpeed:G.windSpeed.value,waterAbsorption:G.waterAbsorption.value.toArray(),waterScattering:G.waterScattering.value.toArray(),shadowMapSize:2048,shadowSplits:[10,60,400]},player:{position:this.player.position.toArray(),mode:this.player.mode,waterH:this.player.waterH,waterMean:this.player.waterMean,wet:this.player.wet,boundaryHits:this.player.boundaryHits},navigationCollisions:this.colliders.hitCount??0,hillShadow:{...this.terrainGPU.hillShadowStats,enabled:this.terrainGPU.uSunBaked.value,terrainCast:this.terrain.mesh.castShadow},groundReview:Object.fromEntries(Object.entries(this.terrain.review.fields).map(([k,f])=>[k,f.value])),habitatRepair:this.creekData.habitatRepair,bedRevision:this.creekData.bedRevision,landscapeDetails:this.landscapeDetails?.stats(),life:this.life?.stats(),shoreHabitats:this.shoreHabitats.stats(),shelfReef:this.shelfReef.stats(),shallowCove:{...this.creekData.cove,continuous:this.creekData.cove.continuous.summary,edgeAt:undefined,shelves:this.creekData.cove.shelves.map(({shore,at,...s})=>s),rocks:this.coveRocks.stats(),waveField:this.shoreField.localCove},marineSnow:{count:12000,box:8,opacity:this.marineSnow.opacity.value,visible:this.marineSnow.mesh.visible,space:'native neighbourhood/disc drawing with museum analytic world-space advection and previous pose; 1–6mm flecks, inland wave exclusion; wrapping fades at edges'},audio:this.audio.stats(),hydrology:{size:this.creekData.hydrology.size,riverStart:this.creekData.hydrology.riverStart,riverEnd:this.creekData.hydrology.riverStart+(this.creekData.hydrology.riverCount-1)*4,mouth:this.creekData.hydrology.mouth,coasts:this.creekData.hydrology.coasts},water:{...this.water.stats(),cameraWaterHeight:this.cameraWaterHeight,cameraUnderwater:G.cameraUnderwater.value,gpuReadbackCamera:{valid:this.query.ocean.cpuValid,height:this.query.ocean.cpu[0],normal:[this.query.ocean.cpu[1],this.query.ocean.cpu[2]],bed:this.query.ocean.cpu[3],input:Array.from(this.query.ocean.resultInputs.slice(0,2)),ageSeconds:this.query.ocean.latency},waterDepthAtCamera:this.cameraWaterHeight-this.camera.position.y,deepWaterPoint:this._deep??null},forest:{...this.vegetation.stats(),details:this.groveDetails.stats(),air:this.haze.stats(),motes:this.airMotes.stats()},geographyAudit:this.geometryAudit,coast:{...this.creekData.coast.coast,terrainSize:this.terrainData.size,terrainTexels:{core:1,outer:4},fineCore:this.terrainGPU.fineCore,seaLevel:-.7,pixelSeaDepth:this.oceanMaterial.depthReview.fields.pixelDepth.value,shoreDetailLegacy:this.oceanSurface.shoreReview.fields.legacy.value,nativeFFT:true,nativeShoreSim:true,oceanLocalWind:this.fft.local.windSpeed,oceanSwellWind:this.fft.swell.windSpeed,breakerStations:this.breakers.NS,surfWindow:this.shoreSim.stats(),breakerWindow:this.breakers.stats(),simulation:'FFT continuous; surf/caustic/light-map active outside creek core (max abs XZ >420m) or above 120m; exit inside 340m / below 100m',active:this.coastalActive,cpuQueryLatencySeconds:this.query.ocean.latency},island:{size:this.terrainData.size,regionCount:9,visits:this.islandVisits,gridLayers:this.terrainGPU.fineCore,terrainLOD:{patches:this.terrain.lod.count,grid:64,rangeFactor:3,levels:this.terrain.lod.levels,triangles:this.terrain.lod.count*64*64*2},oceanLOD:{levels:this.oceanLOD.levels,patches:this.oceanLOD.count}},omitted:['village','boat','fishing','wake','whale'],underwaterCaustics:'native ocean caustics; creek attenuation without river-specific caustics',lensHeight:'one hybrid camera query per frame in native GPU results buffer; local ocean plane / exact inland field'};}
}
