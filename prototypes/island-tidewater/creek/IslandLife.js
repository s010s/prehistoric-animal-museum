// Small, world-anchored environmental life. Native Tidewater fish/bird drawing
// and articulation; our hydrology, habitat placement, routes and shrimp form.
import {Group,Vector3,Quaternion,Euler,Matrix4,Frustum,Sphere} from '../vendor/tidewater/src/engine/index.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {fishGeometry} from '../vendor/tidewater/src/world/fish/FishGeometry.js';
import {SPECIES} from '../vendor/tidewater/src/world/fish/FishSpecies.js';
import {createSwimMaterial} from '../vendor/tidewater/src/world/fish/FishMaterial.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {VAULT_AERIAL,VAULT_BENTHIC,loadVaultCoastLife,vaultFishGeometry,vaultFishSurface,createVaultPterosaurs,createVaultInsect,createVaultBenthos} from './VaultCoastLife.js';
import {clipCreekRefraction} from './CreekWater.js';
import {SampleBenthicDetails} from './SampleBenthicDetails.js';
import {prepareVaultSwimGeometry,installVaultSwimAttributes} from './VaultSwimRigData.js';
import {createVaultSwimMotion,articulateVaultSwimMaterial,vaultSwimEffort} from './VaultSwimMotion.js';

import {VaultEnvironmentFlight} from './VaultEnvironmentFlight.js';
import {FaunaResidency} from './FaunaResidency.js';
import {markStreamedFaunaMaterials} from '../museum/StreamedFaunaPipelines.js';
import {loadReviewedFauna, reviewedAlbedo} from './VaultEnvironmentAssets.js';
import {loadReviewedIndices} from './VaultGeometryLods.js';
import {REVIEWED_FISH, reviewedSwimKinds, installReviewedSwimAttributes, bindReviewedSwim, addReviewedSwimInstance} from './VaultEnvironmentSwim.js';
import {createReviewedSwimMotion, createReviewedSwimMaterial, advanceReviewedSwimPose, reviewedCruiseSpeed} from './VaultReviewedSwimMotion.js';

const VAULT_LOD={aspidorhynchus:8,aeger:9,diplomystus:10,eusthenopteron:11,anomalocaris:12,coccosteus:13,dipterus:14};
const VAULT_PATTERN={aspidorhynchus:98,aeger:99,diplomystus:100,eusthenopteron:101,anomalocaris:102,coccosteus:103,dipterus:104,falcatus:105,cheiracanthus:106};

export class IslandLife{
 static async create(options){
  const keys=options.data.field.continuousSample?Object.keys(VAULT_LOD):[];
  return new IslandLife({...options,vault:await loadVaultCoastLife(keys)});
 }
 constructor({app,data,visits,vault}){
  this.app=app;this.data=data;this.terrain=data.terrain;this.query=app.query;this.time=0;this.groups=[];this.fish=[];this.audit={fleeFrames:0,fleeAwayFrames:0,obstacleDeflections:0,maxPanic:0,violations:0,minBedClearance:Infinity,minSurfaceClearance:Infinity,minBirdGroundClearance:Infinity};this.group=new Group();this.group.name='Museum environmental life';const rng=mulberry32(440213);
  // Habitat and visitor arrival are designed together. Keep native short draw
  // ranges; moving the lake school sixty metres away defeats a normal shore walk.
  const seaLevel=-.7,seaExposure=[0,0,0,0];
  const breakDepth=(x,z)=>{app.shoreField.sampleAt(x,z,seaExposure);const e=Math.min(1,Math.hypot(seaExposure[1],seaExposure[2]));return Math.pow(.42*1.3*e*3.556/.78,.8);};
  this.breakDepth=breakDepth;
  const wetNear=(cx,cz,{min=.65,max=6,target=1.2,radius=30,step=1.5,sea=false,sampleMarine=false}={})=>{let best=null;for(let dz=-radius;dz<=radius;dz+=step)for(let dx=-radius;dx<=radius;dx+=step){const x=cx+dx,z=cz+dz,h=sea?seaLevel:this.query.height(x,z),floor=this.terrain.heightAt(x,z),depth=h-floor;if(depth<min||depth>max||sea&&!sampleMarine&&depth<breakDepth(x,z)+.55)continue;if(sea){let fits=true;const ring=sampleMarine?2.5:3.5,localMin=sampleMarine?Math.max(1.12,min-.25):0;for(let a=0;a<8;a++){const px=x+Math.cos(a*Math.PI/4)*ring,pz=z+Math.sin(a*Math.PI/4)*ring,d=h-this.terrain.heightAt(px,pz);if(d<(sampleMarine?localMin:Math.max(1.5,breakDepth(px,pz)+.4))){fits=false;break;}}if(!fits)continue;}const score=Math.hypot(dx,dz)+Math.abs(depth-target)*3;if(!best||score<best.score)best={x,z,h,floor,score};}return best;};
  const lakePoint=id=>{const v=visits[id],b=v.water,dx=b.center[0]-v.p[0],dz=b.center[1]-v.p[1],l=Math.hypot(dx,dz);return {x:v.p[0]+dx/l*10,z:v.p[1]+dz/l*10};};
  const westCenter=data.cove.shelves[0].at(0,175),eastCenter=data.cove.shelves[1].at(0,175);
  const nativeOr=(kind)=>data.field.continuousSample?kind:undefined;
  const specs=[
   ['creek',{x:-27,z:0},21,.21,1.4,{min:.65,max:2,radius:26,vault:nativeOr('diplomystus'),school:true}],
   ['west-sea',{x:westCenter[0],z:westCenter[1]},15,.52,5.5,{min:1.8,max:7,target:3.5,radius:90,sea:true,vault:nativeOr('aspidorhynchus'),school:true}],
   ['lake',lakePoint('lake'),26,.24,3.6,{min:.85,max:4,radius:29,vault:nativeOr('diplomystus'),school:true}],
   ['lake-spiny',lakePoint('lake'),8,.31,4.7,{min:1.25,max:5,target:2.4,radius:34,vault:nativeOr('cheiracanthus'),school:true}],
   ['tarn',lakePoint('highland-lake'),15,.24,2.4,{min:.75,max:3,radius:25,vault:nativeOr('dipterus'),cruise:.63,lowerDwell:true}],
   ['wetland',{x:visits.wetland.p[0]+15,z:visits.wetland.p[1]+12},24,.23,2.8,{min:.65,max:3,radius:180,step:3,vault:nativeOr('diplomystus'),school:true}],
   ['east-sea',{x:eastCenter[0],z:eastCenter[1]},19,.52,6.2,{min:1.8,max:7,target:3.5,radius:90,sea:true,vault:nativeOr('aspidorhynchus'),school:true}],
  ];
  if(data.field.continuousSample)specs.push(
   ['sample-pool',{x:-656,z:-482},14,.26,1.4,{min:.65,max:1.4,target:.9,radius:4,step:.25,vault:'diplomystus',school:true}],
   ['sample-mid-creek',{x:-719,z:-348},8,.29,2.4,{min:1.15,max:2.4,target:1.4,radius:9,step:.5,vault:'dipterus',lowerDwell:true,cruise:.66}],
   ['sample-log-creek',{x:-698,z:-282},5,.43,3.0,{min:1.4,max:2.6,target:1.8,radius:9,step:.5,vault:'coccosteus',cruise:.72}],
   ['sample-bend',{x:-751,z:-160},21,.39,4.0,{min:1.4,max:2.7,target:2.1,radius:11,step:.5,vault:'diplomystus',school:true}],
   ['sample-silt-pool',{x:-744,z:-33},7,.34,3.2,{min:1.4,max:2.8,target:2.1,radius:11,step:.5,vault:'dipterus',lowerDwell:true,cruise:.65}],
   ['sample-lower-hunters',{x:-781,z:35},4,.50,3.5,{min:1.6,max:2.8,target:2.25,radius:13,step:.5,vault:'coccosteus',cruise:.68}],
   ['sample-lower-creek',{x:-799,z:75},24,.43,6.0,{min:1.6,max:3,target:2.3,radius:14,step:.5,vault:'diplomystus',school:true}],
   ['sample-transition',{x:-858,z:123},6,.62,4.6,{min:1.3,max:3,target:1.9,radius:14,step:.75,vault:'eusthenopteron',cruise:.72}],
   ['sample-mouth-fish',{x:-906,z:134},6,.78,4.6,{min:1.45,max:5,target:2.2,radius:38,step:1,sea:true,sampleMarine:true}],
   ['sample-sea',{x:-966,z:146},8,.85,5.4,{min:1.55,max:5,target:2.4,radius:58,step:1,sea:true,sampleMarine:true}],
   ['sample-radiodont',{x:-969,z:148},3,.4,3,{min:1.4,max:6,target:2.4,radius:60,step:1,sea:true,sampleMarine:true}],
   ['sample-falcatus-inner',{x:-951,z:128},6,.29,3.9,{min:1.4,max:5,target:2.1,radius:23,step:1,sea:true,sampleMarine:true,vault:nativeOr('falcatus'),school:true}],
   ['sample-falcatus-outer',{x:-1000,z:156},7,.30,4.2,{min:1.55,max:6,target:2.35,radius:26,step:1,sea:true,sampleMarine:true,vault:nativeOr('falcatus'),school:true}],
   ['sample-shelf-shoal',{x:-1040,z:163},14,.44,4.5,{min:1.45,max:5,target:2.1,radius:28,step:1,sea:true,sampleMarine:true,vault:'aspidorhynchus',school:true}]
  );
  const sample=data.field.continuousSample;
  if(sample){
   for(let distance=94;distance<=640;distance+=43){
    const p=sample.points.find(point=>point.distance>=distance);
    if(!p||p.level<=.45||p.depth<.60)continue;
    const tooClose=specs.some(([,home])=>Math.hypot(home.x-p.x,home.z-p.z)<11);
    if(tooClose)continue;
    const spiny=distance%3===1, vault=spiny?nativeOr('cheiracanthus'):'diplomystus';
    specs.push(['sample-shoal-'+distance,p,spiny?7:14,spiny?.27:.25,Math.min(2.6,p.width*.63),
     {min:.58,max:3,target:Math.min(p.depth,1.8),radius:5,step:.5,vault,school:true}]);
   }
  }
  for(const shelf of data.cove.shelves)for(const a of [-.48,.4]){
   const p=shelf.at(a*shelf.along,150);
   specs.push([shelf.id+'-'+a,{x:p[0],z:p[1]},14,.45,5,{min:1.8,max:7,target:3.5,radius:75,step:3,sea:true,vault:nativeOr('aspidorhynchus'),school:true}]);
  }
  for(const [i,site] of data.cove.continuous.divingSites.entries()){
   const kind=i%2?'falcatus':'aspidorhynchus', shark=kind==='falcatus';
   specs.push([site.id+'-life',{x:site.point[0],z:site.point[1]},shark?7:15,shark?.28:.48,4,
    {min:2.2,max:9,target:3.8,radius:45,step:2,sea:true,vault:nativeOr(kind),school:true}]);
  }
  for(const [id,p,count,length,radius,search] of specs){const c=wetNear(p.x,p.z,search);if(!c)continue;const g={id,...c,reviewed:REVIEWED_FISH.includes(search.vault)?search.vault:null,sea:!!search.sea,sampleMarine:!!search.sampleMarine,radius,first:this.fish.length,count,school:!!search.school,routePhase:rng()*6.283,lowerDwell:!!search.lowerDwell,cruise:search.cruise??1};this.groups.push(g);for(let i=0;i<count;i++){
   const vaultFish=search.vault??(id==='sample-mouth-fish'||id==='sample-sea'?'aspidorhynchus':id==='sample-radiodont'?'anomalocaris':null);
   const L=length*(.82+rng()*.36);
   this.fish.push({group:g,phase:rng()*Math.PI*2,slot:rng()*6.283,spread:.25+rng()*.75,depth:.26+rng()*.46,L,p:new Vector3(c.x,Math.max(c.floor+.15,c.h-.6),c.z),previous:new Vector3(),fresh:true,sleeping:true,velocity:new Vector3(),panic:0,yaw:rng()*6.283,morph:vaultFish?0:i%5===0?1:0,seed:rng(),shrimp:false,vault:vaultFish});
  }}
  if(data.field.continuousSample){
   const c=wetNear(-929,147,{min:1.35,max:4,target:2.1,radius:52,step:1,sea:true,sampleMarine:true});
   if(c){const g={...c,id:'sample-aeger',sea:true,sampleMarine:true,first:this.fish.length,count:8,radius:3.3};this.groups.push(g);for(let i=0;i<g.count;i++)this.fish.push({group:g,phase:rng()*6.283,slot:rng()*6.283,spread:.4+rng()*.5,depth:1,L:.16+rng()*.025,p:new Vector3(g.x,g.floor+.028,g.z),previous:new Vector3(),fresh:true,sleeping:true,velocity:new Vector3(),panic:0,yaw:rng()*6.283,morph:0,seed:rng(),shrimp:true,vault:'aeger'});}
  }
  const westSchools=this.groups.filter(g=>g.sea&&g.school&&g.h-g.floor>1.4);
  westSchools.sort((a,b)=>Math.hypot(a.x-westCenter[0],a.z-westCenter[1])-Math.hypot(b.x-westCenter[0],b.z-westCenter[1]));
  data.lifeObservations={creek:this.groups.find(g=>g.id==='creek'),west:this.groups.find(g=>g.id==='west-sea')??westSchools[0]};
  data.sampleLife=Object.fromEntries(Object.entries({aeger:'sample-aeger',pool:'sample-pool',midCreek:'sample-mid-creek',logPool:'sample-log-creek',bend:'sample-bend',siltPool:'sample-silt-pool',lowerCreek:'sample-lower-creek',transition:'sample-transition',sea:'sample-sea',radiodont:'sample-radiodont'}).map(([key,id])=>[key,this.groups.find(g=>g.id===id)]));
  for(const g of this.groups)g.obstacles=[...(app.coveRocks?.instances??[]),...(app.shelfReef?.obstacles??[])].filter(r=>Math.hypot(r.x-g.x,r.z-g.z)<g.radius+12);
  const kinds=[SPECIES.silverside,SPECIES.mullet].flatMap(species=>[0,1,2,3].map(lod=>({geometry:fishGeometry(species,{lod,pose:'swim'}),shadow:false})));
  for(const kind of Object.keys(vault))kinds.push({geometry:prepareVaultSwimGeometry(vaultFishGeometry(vault[kind],kind),kind,vault[kind]),shadow:kind==='aeger'});
  const shrimpRig=kinds[VAULT_LOD.aeger]?.geometry.vaultRigStats;
  for(const f of this.fish)if(f.shrimp)f.bedOffset=-shrimpRig.minY*f.L+.003;
  const baseSurface=`\nif(in.vs.vFishInfo.x<90.0&&fishPartOf(in.vs.vFishData)<7.5){s.albedo*=vec3f(.72,.82,.78);s.metalness*=.55;s.roughness=max(s.roughness,.46);s.specularIntensity=.10;}\n`+
   Object.keys(vault).map(kind=>vaultFishSurface(vault[kind],VAULT_PATTERN[kind],kind==='anomalocaris'?[.55,.73,.60]:[1,1,1])).join('');
  this.primarySwim=this.createSwimBatch('Museum life',kinds,this.fish.length, material=>{material.surface+=baseSurface;});
  this.group.add(...this.primarySwim.meshes);
  this.swimBatches=[this.primarySwim];
  this.environmentResidency=new FaunaResidency({concurrency:2,residentLimit:7,speciesLimit:7,byteLimit:81*1024**2});
  const prepare=(kind,asset,signal)=>{
   markStreamedFaunaMaterials(asset,`vault-environment:${kind}`);
   return this.app.islandFauna?.pipelines.prepareMain(asset,signal);
  };
  this.reviewedSwim=Object.fromEntries(REVIEWED_FISH.map(kind=>[kind,{kind,groups:this.groups.filter(g=>g.reviewed===kind),
   ready:null}]));
  for(const state of Object.values(this.reviewedSwim)){
   let i=0;
   for(const g of state.groups)for(let j=0;j<g.count;j++)this.fish[g.first+j].renderIndex=i++;
   state.capacity=i;
   if(!i)continue;
   const {kind}=state, habitats=state.groups.map(g=>({x:g.x,z:g.z,radius:g.radius,minY:g.floor-4,maxY:g.h+5}));
   this.environmentResidency.add({id:kind,habitats,range:96,hysteresis:54,bytes:15*1024**2,
    load:signal=>this.loadReviewedSwim(state,signal),prepare:(asset,signal)=>prepare(kind,asset,signal),
    attach:asset=>{
     state.ready=asset;
     this.group.add(...asset.meshes);
     this.swimBatches.push(asset);
    },
    detach:asset=>{
     for(const mesh of asset.meshes)mesh.removeFromParent();
     state.ready=null;
     this.swimBatches=this.swimBatches.filter(current=>current!==asset);
     for(const g of state.groups)for(let j=0;j<g.count;j++){
      const f=this.fish[g.first+j];f.fresh=true;f.sleeping=true;
     }
    },
    dispose:asset=>asset.dispose(),
   });
  }
  this.environment=new VaultEnvironmentFlight(this.group,data,visits,this.environmentResidency,prepare);
  this.birds=this.environment.fliers.filter(f=>this.environment.types.get(f.species).type.kind==='bird');
  this.pterosaurs=null;this.insect=null;
  this.benthicDetails=data.field.continuousSample?new SampleBenthicDetails(app,data,data.sampleLife):null;
  this.benthos=null;
  this.vaultLoads=data.field.continuousSample?{
   aerial:{ready:false,pending:null,attempts:0,retryAt:0,error:null},
   benthic:{ready:false,pending:null,attempts:0,retryAt:0,error:null},
  }:null;
  this.vaultLocationReady=false;
  app.scene.add(this.group);this.q=new Quaternion();this.euler=new Euler(0,0,0,'YXZ');this.frustum=new Frustum();this.viewProjection=new Matrix4();this.sphere=new Sphere();this.screen=new Vector3();this.frameSight={fish:[],shrimp:[],birds:[],insects:[]};this.trackingSwimmers=[];this.enabled=true;this.update(0,app.camera);
 }
 createSwimBatch(name,kinds,count,configure,reviewed){
  const batch=new ReefBatch(name,kinds,{maxInstances:Math.max(1,count),dynamic:true,fade:true});
  if(reviewed)installReviewedSwimAttributes(batch);
  else installVaultSwimAttributes(batch);
  const motion=reviewed?createReviewedSwimMotion(batch,reviewed):createVaultSwimMotion(batch);
  const makeMaterial=fade=>reviewed?createReviewedSwimMaterial(batch,motion,{fade}):createSwimMaterial(batch,{fade});
  const material=makeMaterial(false),fadeMaterial=makeMaterial(true);
  for(const m of [material,fadeMaterial]){
   if(!reviewed)articulateVaultSwimMaterial(m,motion);
   configure(m);
   clipCreekRefraction(m,this.data.field);
  }
  const meshes=[batch.createMesh(material,{castShadow:!reviewed}),batch.createFadeMesh(fadeMaterial)];
  return {batch,motion,meshes,dispose(){
   batch.dispose();
   for(const m of [material,fadeMaterial]){
    m.uniformBlock.buffer?.destroy();m.dispose();
   }
   motion.dispose?.();
  }};
 }

 async loadReviewedSwim(state,signal){
  const {kind,capacity}=state;
  const [gltf,bytes]=await Promise.all([loadReviewedFauna(kind,signal),loadReviewedIndices(kind,signal)]);
  const texture=await reviewedAlbedo(gltf,kind,signal);
  try {
   const kinds=reviewedSwimKinds(gltf,kind,bytes);
   signal.throwIfAborted();
   const asset=this.createSwimBatch('Museum '+kind,kinds,capacity,m=>bindReviewedSwim(m,texture),kind);
   return {...asset,dispose(){asset.dispose();texture.destroy();}};
  }catch(error){texture.destroy();throw error;}
 }

 async createVaultGroupDetails(name,group){
  if(name==='aerial'){
   const vault=await loadVaultCoastLife(VAULT_AERIAL);
   return {
    pterosaurs:await createVaultPterosaurs(vault.rhamphorhynchus,vault.pterodaustro,group,this.terrain),
    insect:await createVaultInsect(vault.meganeura,group,this.terrain,this.query),
   };
  }
  const vault=await loadVaultCoastLife(VAULT_BENTHIC);
  return {benthos:await createVaultBenthos(vault,group,this.terrain,{
   aeger:this.data.sampleLife.aeger,coralSites:this.benthicDetails.coralSites,shellSites:this.benthicDetails.shellSites,spongeSites:this.benthicDetails.spongeSites,
   obstacles:[...(this.app.coveRocks?.instances??[]),...this.benthicDetails.hardSites],
  })};
 }

 requestVaultGroup(name){
  const state=this.vaultLoads[name];
  if(state.ready||state.pending||state.attempts>=2||performance.now()<state.retryAt)return;
  state.attempts++;
  state.pending=(async()=>{
   const group=new Group();group.name='Museum Vault '+name;
   const details=await this.createVaultGroupDetails(name,group);
   if(this.disposed)return;
   group.traverse(node=>{if(node.isMesh&&node.material)clipCreekRefraction(node.material,this.data.field);});
   const camera=this.app.camera;
   for(const detail of Object.values(details))detail?.update(this.time,camera);
   Object.assign(this,details);
   this.group.add(group);
   state.ready=true;state.error=null;
  })().catch(error=>{
   state.error=String(error);state.retryAt=performance.now()+5000;
   console.warn(`Museum Vault ${name} unavailable`,error);
  }).finally(()=>{state.pending=null;});
 }
 queueNearbyVault(camera){
  if(this.disposed)return;
  const cp=camera.position, now=performance.now();
  if(!this.lastScan||this.lastScan.distanceToSquared(cp)>36||now>=this.nextScan){
   this.lastScan??=new Vector3();this.lastScan.copy(cp);this.nextScan=now+400;
   this.environmentResidency.scan(cp);
  }
  if(!this.enabled)return;
  if(!this.vaultLoads)return;
  const {x,y,z}=camera.position,{aerial,benthic}=this.vaultLoads;
  if(!aerial.ready&&!aerial.pending&&aerial.attempts<2&&Math.hypot(x+898,z-143)<320)this.requestVaultGroup('aerial');
  if(!benthic.ready&&!benthic.pending&&benthic.attempts<2&&y<40&&Math.hypot(x+980,z-150)<180)this.requestVaultGroup('benthic');
 }

 async prepareNearby(camera){
  this.vaultLocationReady=true;
  this.queueNearbyVault(camera);
  await Promise.all([this.vaultLoads?.aerial.pending,this.vaultLoads?.benthic.pending,
   ...[...this.environmentResidency.entries.keys()].map(id=>this.environmentResidency.ready(id))]);
 }

 update(dt,camera){
  if(this.vaultLocationReady)this.queueNearbyVault(camera);
  this.group.visible=this.enabled;
  this.trackingSwimmers.length=0;
  this.time+=dt;const cp=camera.position;camera.updateMatrixWorld();this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.viewProjection,camera.coordinateSystem,camera.reversedDepth);this.pxScale=camera.projectionMatrix.elements[5]*this.app.engine.height*.5;this.frameSight={fish:[],shrimp:[],birds:[],insects:[]};for(const {batch} of this.swimBatches)batch.begin();let live=0,shrimp=0;this.audit.minBedClearance=Infinity;this.audit.minSurfaceClearance=Infinity;
  for(let i=0;i<this.fish.length;i++){
   const f=this.fish[i],g=f.group,dist=Math.hypot(cp.x-g.x,cp.z-g.z);if(!this.enabled||dist>65||cp.y>g.h+8){f.fresh=true;f.sleeping=true;continue;}
   const render=g.reviewed?this.reviewedSwim[g.reviewed].ready:this.primarySwim;
   if(!render)continue;
   const {batch,motion}=render, D=batch.data, renderIndex=f.renderIndex??i;
   const step=Math.min(dt,.1);
   f.previous.copy(f.p);this.advance(f,step,cp);
   const swim=g.reviewed?advanceReviewedSwimPose(f,step):null;
   const vaultEffort=swim?null:vaultSwimEffort(f,step);
   if(vaultEffort)f.phase=(f.phase+vaultEffort.deltaPhase)%(200*Math.PI);
   const {x,y,z}=f.p,h=g.sea?g.h:this.query.height(x,z),floor=this.terrain.heightAt(x,z);

   const clear=y-floor,top=h-y;this.audit.minBedClearance=Math.min(this.audit.minBedClearance,clear);this.audit.minSurfaceClearance=Math.min(this.audit.minSurfaceClearance,top);if(clear<0||top<0)this.audit.violations++;
   const distance=cp.distanceTo(f.p),range=f.shrimp?6:42;if(distance>range){f.fresh=true;continue;}
   const L=f.L,pixels=L*this.pxScale/Math.max(.2,distance);
   if(pixels<1.2){f.fresh=true;continue;}
   this.sphere.center.copy(f.p);this.sphere.radius=L;
   f.trackingVisible=this.frustum.intersectsSphere(this.sphere);
   if(distance<range){f.trackingId=i;this.trackingSwimmers.push(f);}
   if(!f.trackingVisible){f.fresh=true;continue;}
   this.screen.copy(f.p).project(camera);this.frameSight[f.shrimp?'shrimp':'fish'].push({position:f.p.toArray(),length:L,distance,pixels,ndc:[this.screen.x,this.screen.y],habitat:g.id,species:f.vault??'native',bedClearance:clear,surfaceClearance:top});
   if(swim){
    this.q.setFromEuler(this.euler.set(swim.pitch,f.yaw,swim.roll,'YXZ'));
    motion.setPose(renderIndex,swim,this.q,f.fresh);
    const k=renderIndex*16;
    D[k]=x;D[k+1]=y;D[k+2]=z;D[k+3]=L;
    D[k+12]=f.fresh?0:x-f.previous.x;D[k+13]=f.fresh?0:y-f.previous.y;D[k+14]=f.fresh?0:z-f.previous.z;
    f.fresh=false;
    addReviewedSwimInstance(batch,renderIndex,pixels,distance,range);
    live++;
    continue;
   }
   const level=pixels>=320?0:pixels>=80?1:pixels>=22?2:3,lod=f.vault?VAULT_LOD[f.vault]:f.morph*4+level;
   const {deltaPhase,amplitude,bend}=vaultEffort;
   let {pitch,roll}=vaultEffort;
   if(f.shrimp){const d=.08,gx=(this.terrain.heightAt(x+d,z)-this.terrain.heightAt(x-d,z))/(2*d),gz=(this.terrain.heightAt(x,z+d)-this.terrain.heightAt(x,z-d))/(2*d);pitch=-Math.atan(gx*Math.sin(f.yaw)+gz*Math.cos(f.yaw));roll=Math.atan(gx*Math.cos(f.yaw)-gz*Math.sin(f.yaw));}
   this.euler.set(pitch,f.yaw,roll,'YXZ');this.q.setFromEuler(this.euler);
   // Crawl cadence follows actual horizontal travel. A shrimp does not run
   // an idle gait beneath a root moving several strides per cycle.
   const k=renderIndex*16;
   if(!f.poseQ)f.poseQ=this.q.clone();
   motion.previous.set([...(f.fresh?this.q:f.poseQ).toArray(),f.fresh?amplitude:f.poseAmplitude,f.fresh?bend:f.poseBend,f.fresh?0:1,0],renderIndex*8);
   D.set([x,y,z,L,this.q.x,this.q.y,this.q.z,this.q.w,f.phase,amplitude,bend,(f.vault?VAULT_PATTERN[f.vault]:f.morph?14:0)+f.seed*.9,f.fresh?0:x-f.previous.x,f.fresh?0:y-f.previous.y,f.fresh?0:z-f.previous.z,f.fresh?0:deltaPhase],k);f.fresh=false;f.poseQ.copy(this.q);f.poseAmplitude=amplitude;f.poseBend=bend;
   const threshold=[320,80,22][level];
   if(distance>range*.85)batch.addFade(lod,renderIndex,Math.max(0,(range-distance)/(range*.15)),false);
   else if(!f.vault&&level<3&&pixels<threshold*1.15){const a=(pixels/threshold-1)/.15;batch.addFade(lod,renderIndex,a,false);batch.addFade(lod+1,renderIndex,a,true);}
   else batch.add(lod,renderIndex);live++;if(f.shrimp)shrimp++;

  }
  this.drawnTriangles=0;
  for(const {batch,motion} of this.swimBatches){
   batch.commit();batch.upload();motion.upload();
   this.drawnTriangles+=batch.kinds.reduce((sum,k,i)=>sum+k.geometry.index.count/3*(batch.counts[i]+batch.fadeCounts[i]),0);
  }
  this.visibleFish=live-shrimp;this.visibleShrimp=shrimp;
  this.environment.update(this.time,camera,this.frustum,this.pxScale,this.frameSight,this.enabled);
  this.visibleBirds=this.environment.visible.birds;
  this.audit.minBirdGroundClearance=this.frameSight.birds.reduce((min,b)=>Math.min(min,b.groundClearance),Infinity);
  this.pterosaurs?.update(this.time,camera);this.insect?.update(this.time,camera);this.benthicDetails?.update(camera);this.benthos?.update(this.time,camera);
 }
 advance(f,dt,cp){
  const g=f.group,p=f.p,v=f.velocity;
  if(f.sleeping){
   p.set(g.x+Math.cos(f.slot)*g.radius*f.spread*.65,0,g.z+Math.sin(f.slot)*g.radius*f.spread*.5);
   const clear=f.shrimp?f.bedOffset:Math.max(.14,f.L*.24),topMargin=g.sea?.85:clear;
   let bed=this.terrain.heightAt(p.x,p.z),water=g.sea?g.h:this.query.height(p.x,p.z);
   if(water-bed<clear+topMargin+.12){p.x=g.x;p.z=g.z;bed=g.floor;water=g.h;}
   const ceiling=water-topMargin;
   const y=f.shrimp?bed+clear:g.lowerDwell?bed+clear+.14:water-f.depth*(water-bed);
   p.y=Math.max(bed+clear,Math.min(ceiling,y));v.set(Math.sin(f.slot)*.12,0,Math.cos(f.slot)*.12);
   f.yaw=f.slot;f.swimPose=null;f.swimBend=0;f.panic=0;
   f.sleeping=false;f.previous.copy(p);
  }
  const steps=Math.max(1,Math.ceil(dt/.035)),hdt=dt/steps;
  for(let k=0;k<steps;k++){
   const time=this.time*(.11+f.seed*.07)+f.slot, schoolTime=this.time*.17+(g.routePhase??0);
   const local=g.school?.4:1, common=g.school?g.radius*.62:0, r=g.radius*f.spread*local;
   const tx=g.x+Math.cos(schoolTime)*common+Math.cos(time)*r;
   const tz=g.z+Math.sin(schoolTime)*common*.63+Math.sin(time*.73+f.seed)*r*.68;
   const forage=f.shrimp?Math.pow(Math.max(0,Math.sin(this.time*.9+f.slot)),3):1;
   const dx=tx-p.x,dz=tz-p.z,dl=Math.max(Math.hypot(dx,dz),1e-6);
   const approach=Math.min(1,dl/f.L);
   const speed=g.reviewed?reviewedCruiseSpeed(f,this.time,dl):f.shrimp?forage*.012
    :f.L*(1.2+f.seed*.9)*(g.cruise??1)*(.36+.64*approach);
   let ax=(dx/dl*speed-v.x)*1.5,az=(dz/dl*speed-v.z)*1.5;
   const awayX=p.x-cp.x,awayZ=p.z-cp.z,awayY=p.y-cp.y,away=Math.hypot(awayX,awayY,awayZ),
    reach=f.shrimp?.5:Math.max(.72,Math.min(2.7,3.4*f.L));
   f.panic=Math.max(0,f.panic-hdt*.6);
   if(away<reach){const a=1-away/reach,force=(a*a*8+a*2)*(f.shrimp?.3:1);ax+=awayX/(away+.01)*force;az+=awayZ/(away+.01)*force;f.panic=Math.max(f.panic,a);this.audit.fleeFrames++;if(v.x*awayX+v.z*awayZ>0)this.audit.fleeAwayFrames++;}
   // Short-range body separation within the active school, scaled by length.
   if(!f.shrimp)for(let i=g.first;i<g.first+g.count;i++){const q=this.fish[i];if(q===f||q.sleeping)continue;const sx=p.x-q.p.x,sz=p.z-q.p.z,sd=Math.hypot(sx,sz),clear=(f.L+q.L)*.8;if(sd<clear&&sd>.001){const force=(clear-sd)*1.8;ax+=sx/sd*force;az+=sz/sd*force;}}
   for(const rock of g.obstacles??[]){const rx=p.x-rock.x,rz=p.z-rock.z,d=Math.hypot(rx,rz),safe=(rock.footRadius??rock.size*.9)+f.L*1.5;if(d<safe+1.1&&p.y<(rock.top??rock.y+rock.size*rock.sy*1.1)){const force=(safe+1.1-d)*3;ax+=rx/(d+.01)*force;az+=rz/(d+.01)*force;this.audit.obstacleDeflections++;}}
   const lookX=p.x+v.x*.8,lookZ=p.z+v.z*.8,water=g.sea?g.h:this.query.height(lookX,lookZ),bed=this.terrain.heightAt(lookX,lookZ),minimum=g.sampleMarine?1.12:g.sea?Math.max(1.5,this.breakDepth(lookX,lookZ)+.35):.35;
   if(water-bed<minimum){const gx=this.terrain.heightAt(lookX+.5,lookZ)-this.terrain.heightAt(lookX-.5,lookZ),gz=this.terrain.heightAt(lookX,lookZ+.5)-this.terrain.heightAt(lookX,lookZ-.5),l=Math.hypot(gx,gz)||1;ax-=gx/l*2+v.x*2;az-=gz/l*2+v.z*2;}
   v.x+=ax*hdt;v.z+=az*hdt;const max=Math.max(speed,f.shrimp?f.panic*.012:0)*(1+f.panic*(f.shrimp?1:3)),length=Math.hypot(v.x,v.z);if(length>max){v.x*=max/length;v.z*=max/length;}
   const bodyClearance=f.shrimp?f.bedOffset:Math.max(.14,f.L*.24);
   let nx=p.x+v.x*hdt,nz=p.z+v.z*hdt,h=g.sea?g.h:this.query.height(nx,nz),floor=this.terrain.heightAt(nx,nz),ceiling=h-(g.sea?.85:bodyClearance);
   if(h-floor<minimum||ceiling<floor+bodyClearance+.08){nx=p.x;nz=p.z;v.x*=-.3;v.z*=-.3;h=g.sea?g.h:this.query.height(nx,nz);floor=this.terrain.heightAt(nx,nz);ceiling=h-(g.sea?.85:bodyClearance);}
   const desired=g.lowerDwell?floor+bodyClearance+.14+Math.sin(time*.6)*.055:h-f.depth*(h-floor)+Math.sin(time*.6)*.06;
   const target=f.shrimp?floor+bodyClearance:Math.max(floor+bodyClearance,Math.min(ceiling,desired));
   v.y+=(target-p.y)*hdt*4-v.y*hdt*3;const y=f.shrimp?target:Math.max(floor+bodyClearance,Math.min(ceiling,p.y+v.y*hdt));p.set(nx,y,nz);this.audit.maxPanic=Math.max(this.audit.maxPanic,f.panic);
  }
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;
  this.environmentResidency.dispose();
  this.primarySwim.dispose();
  this.group.removeFromParent();
 }
 hold(){for(const f of this.fish)f.fresh=true;this.environment.hold();this.pterosaurs?.hold();this.insect?.hold();this.benthos?.hold();}
 stats(){
  const species=Object.fromEntries(Object.keys(VAULT_PATTERN).map(kind=>[kind,this.fish.filter(f=>f.vault===kind).length]));
  return {
   time:this.time,vaultAssets:this.vaultLoads?Object.fromEntries(Object.entries(this.vaultLoads).map(([name,state])=>[name,{ready:state.ready,pending:!!state.pending,attempts:state.attempts,error:state.error}])):null,
   articulation:{fish:this.swimBatches.flatMap(({batch})=>batch.kinds.filter(k=>k.geometry.vaultRigStats).map(k=>k.geometry.vaultRigStats)),pterosaurs:this.pterosaurs?.stats()??null,insect:this.insect?.stats()??null,benthos:this.benthos?.stats()??null},
   enabled:this.enabled,fish:this.fish.filter(f=>!f.shrimp).length,shrimp:this.fish.filter(f=>f.shrimp).length,
   birds:this.birds.length,pterosaurs:this.pterosaurs?.flyers.length??0,insects:this.environment.fliers.length-this.birds.length+(this.insect?1:0),
   environmentalFlight:this.environment.stats(),
   environmentalShoals:Object.fromEntries(Object.entries(this.reviewedSwim).map(([kind,s])=>[kind,{ready:!!s.ready,habitats:s.groups.length,individuals:s.capacity,residency:this.environmentResidency.state(kind)}])),
   environmentResidency:this.environmentResidency.stats(),
   benthicCrawlers:this.benthos?.crawlers.length??0,corals:this.benthos?.corals.reduce((n,c)=>n+c.sites.length,0)??0,coralKinds:this.benthos?.corals.length??0,shellForms:this.benthos?.shells.reduce((n,s)=>n+s.sites.length,0)??0,shellKinds:this.benthos?.shells.length??0,sponges:this.benthos?.sponges.reduce((n,s)=>n+s.sites.length,0)??0,visibleCorals:this.benthos?.corals.reduce((n,c)=>n+c.mesh.count,0)??0,visibleShells:this.benthos?.shells.reduce((n,s)=>n+s.mesh.count,0)??0,benthicDetails:this.benthicDetails?.stats()??null,species,
   visibleFish:this.visibleFish,visibleShrimp:this.visibleShrimp,visibleBirds:this.visibleBirds,
   activeBirds:this.birds.filter(b=>b.active).length,drawnTriangles:this.drawnTriangles,
   habitats:this.groups.map(g=>({id:g.id,center:[g.x,g.h,g.z],floor:g.floor,depth:g.h-g.floor,count:g.count,species:this.fish[g.first]?.vault??'native environmental form',lengthRange:[Math.min(...this.fish.slice(g.first,g.first+g.count).map(f=>f.L)),Math.max(...this.fish.slice(g.first,g.first+g.count).map(f=>f.L))],radius:g.radius,sea:g.sea??false,sampleMarine:g.sampleMarine??false,surfaceReference:g.sampleMarine?'fixed mean sea with 0.85m ceiling margin and 2.5m local depth footprint':g.sea?'fixed mean sea with 0.85m ceiling margin and native breaker exclusion':'local inland water'})),
   waterBounds:{...this.audit,scope:'fish centre against terrain and conservative ceiling; conservative rock steering; not a full deforming mesh/wave-trough collision proof'},
   screenCandidates:Object.fromEntries(Object.entries(this.frameSight).map(([k,v])=>[k,{count:v.length,examples:v.slice(0,12)}])),
   visibilityMeaning:'main-camera frustum + projected pixel threshold + distance; not occlusion or water-transmission proof; inspect actual image',
   appearance:'Diplomystus and Cheiracanthus shoal in freshwater, with Dipterus and Coccosteus in deeper pools. Eusthenopteron occupies the estuarine transition; Falcatus and Aspidorhynchus cruise marine shallows. Ichthyornis follows the coast and Sapeornis the forest and freshwater margins. Flying insects cluster around wet tracks and understory.',
   movement:this.fish.filter(f=>!f.shrimp&&!f.sleeping).slice(0,10).map(f=>({position:f.p.toArray(),velocity:f.velocity.toArray(),panic:f.panic,group:f.group.id})),
   method:'native fish batch with museum local fin pivots and phased appendage chains; Aeger crawl cadence follows horizontal travel without world foot IK; conservative bed/ceiling and breaker checks; 65m fish simulation and 42m drawing, Aeger 6m, reviewed flight batches streamed by habitat, pterosaurs 230m',
   scientificStatus:'This imaginative island deliberately mixes eras while keeping freshwater, marine and aerial habitats distinct. Static Vault models are stylized teaching forms, not specimen-level reconstructions.'
  };
 }
}
