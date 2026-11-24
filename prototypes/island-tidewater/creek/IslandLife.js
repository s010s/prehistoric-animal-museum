// Small, world-anchored environmental life. Native Tidewater fish/bird drawing
// and articulation, with museum hydrology, habitat placement and routes.
import {Group,Vector3,Quaternion,Euler,Matrix4,Frustum,Sphere} from '../vendor/tidewater/src/engine/index.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {fishGeometry} from '../vendor/tidewater/src/world/fish/FishGeometry.js';
import {SPECIES} from '../vendor/tidewater/src/world/fish/FishSpecies.js';
import {createSwimMaterial} from '../vendor/tidewater/src/world/fish/FishMaterial.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {loadBenthicSpecies} from './VaultCoastLife.js';
import {clipCreekRefraction} from './CreekWater.js';
import {SampleBenthicDetails} from './SampleBenthicDetails.js';
import {loadMarineRockProfiles} from './MarineRockProfiles.js';
import {MarineBenthicDetails} from './MarineBenthicDetails.js';


import {VaultEnvironmentFlight} from './VaultEnvironmentFlight.js';
import {FaunaResidency} from './FaunaResidency.js';
import {markStreamedFaunaMaterials} from '../museum/StreamedFaunaPipelines.js';
import {loadReviewedFauna, reviewedAlbedo} from './VaultEnvironmentAssets.js';
import {loadReviewedIndices} from './VaultGeometryLods.js';
import {REVIEWED_FISH, reviewedSwimKinds, installReviewedSwimAttributes, bindReviewedSwim, addReviewedSwimInstance} from './VaultEnvironmentSwim.js';
import {createReviewedSwimMotion, createReviewedSwimMaterial, advanceReviewedSwimPose, steerReviewedSwimmer, reviewedCruiseSpeed} from './VaultReviewedSwimMotion.js';
import {visitorShoals} from './VisitorShoals.js';
import {reefPatrolTarget, reefObstacleTop} from './ReefShoals.js';
import {createSwimmer, RoamingShoals, ROAMING_FISH_CAPACITY} from './RoamingShoals.js';
import {setRefractionFrustum} from './RefractionFrustum.js';

// The vendor's two small school fish remain available in the original terrain mode.
function nativeSwimEffort(fish,dt) {
 const {velocity:v,L,panic}=fish, speed=Math.hypot(v.x,v.z), pace=speed/L;
 const heading=pace>.04?Math.atan2(v.x,v.z)-fish.yaw:0;
 const turn=Math.max(-3.2,Math.min(3.2,Math.atan2(Math.sin(heading),Math.cos(heading))*5.1))*Math.min(1,pace/.52);
 fish.yaw+=turn*dt;
 const target=Math.max(-.12,Math.min(.12,turn*.048));
 fish.swimBend=(fish.swimBend??0)+(target-(fish.swimBend??0))*(-Math.expm1(-dt*8));
 return {
  deltaPhase:dt*((fish.morph?5.1:5.9)+pace*(fish.morph?3.2:3.55))*(1+panic*.37),
  amplitude:(.011+Math.min(.04,pace*.021))*(fish.morph?.9:1),bend:fish.swimBend,
  pitch:Math.max(-.28,Math.min(.28,-Math.atan2(v.y,Math.max(L*.34,speed)))),
  roll:Math.max(-.18,Math.min(.18,turn*.058)),
 };
}

export class IslandLife{
 static async create(options){
  const profiles=options.data.field.continuousSample?await loadMarineRockProfiles().catch(error=>{
   console.warn('Marine rock profiles unavailable',error);return [];
  }):[];
  return new IslandLife({...options,profiles});
 }
 constructor({app,data,visits,profiles}){
  this.marineRockProfiles=profiles;
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
   ['tarn',lakePoint('highland-lake'),15,.24,2.4,{min:.75,max:3,radius:25,vault:nativeOr('cheiracanthus'),cruise:.63,lowerDwell:true}],
   ['wetland',{x:visits.wetland.p[0]+15,z:visits.wetland.p[1]+12},24,.23,2.8,{min:.65,max:3,radius:180,step:3,vault:nativeOr('diplomystus'),school:true}],
   ['east-sea',{x:eastCenter[0],z:eastCenter[1]},19,.52,6.2,{min:1.8,max:7,target:3.5,radius:90,sea:true,vault:nativeOr('aspidorhynchus'),school:true}],
  ];
  if(data.field.continuousSample)specs.push(
   ['sample-pool',{x:-656,z:-482},14,.26,1.4,{min:.65,max:1.4,target:.9,radius:4,step:.25,vault:'diplomystus',school:true}],
   ['sample-mid-creek',{x:-719,z:-348},8,.29,2.4,{min:1.15,max:2.4,target:1.4,radius:9,step:.5,vault:'cheiracanthus',lowerDwell:true,cruise:.66}],
   ['sample-log-creek',{x:-698,z:-282},5,.43,3.0,{min:1.4,max:2.6,target:1.8,radius:9,step:.5,vault:'coccosteus',cruise:.72}],
   ['sample-bend',{x:-751,z:-160},21,.39,4.0,{min:1.4,max:2.7,target:2.1,radius:11,step:.5,vault:'diplomystus',school:true}],
   ['sample-silt-pool',{x:-744,z:-33},7,.34,3.2,{min:1.4,max:2.8,target:2.1,radius:11,step:.5,vault:'cheiracanthus',lowerDwell:true,cruise:.65}],
   ['sample-lower-hunters',{x:-781,z:35},4,.50,3.5,{min:1.6,max:2.8,target:2.25,radius:13,step:.5,vault:'coccosteus',cruise:.68}],
   ['sample-lower-creek',{x:-799,z:75},24,.43,6.0,{min:1.6,max:3,target:2.3,radius:14,step:.5,vault:'diplomystus',school:true}],
   ['sample-transition',{x:-858,z:123},6,.62,4.6,{min:1.3,max:3,target:1.9,radius:14,step:.75,vault:'eusthenopteron',cruise:.72}],
   ['sample-mouth-fish',{x:-906,z:134},6,.78,4.6,{min:1.45,max:5,target:2.2,radius:38,step:1,sea:true,sampleMarine:true,vault:'aspidorhynchus'}],
   ['sample-sea',{x:-966,z:146},8,.85,5.4,{min:1.55,max:5,target:2.4,radius:58,step:1,sea:true,sampleMarine:true,vault:'aspidorhynchus'}],
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
  if(sample)specs.push(...visitorShoals());
  for(const [id,p,count,length,radius,search] of specs){
   const c=wetNear(p.x,p.z,search);if(!c)continue;
   const g={id,...c,reviewed:REVIEWED_FISH.includes(search.vault)?search.vault:null,sea:!!search.sea,sampleMarine:!!search.sampleMarine,radius,first:this.fish.length,count,school:!!search.school,routePhase:rng()*6.283,lowerDwell:!!search.lowerDwell,cruise:search.cruise??1};
   const shallow=search.depthBand?.[0]??.26;
   const depthRange=search.depthBand?search.depthBand[1]-shallow:.46;
   this.groups.push(g);
   for(let i=0;i<count;i++){
    this.fish.push(createSwimmer(g,i,length,rng,shallow,depthRange));
    // Large fish in the shallow sand channel need room for their long snouts
    // on waking. Stagger initial depth and radius without synchronising beats.
    if(id==='sample-sea'||id==='sample-mouth-fish'){
     const f=this.fish.at(-1), ring=Math.sqrt((i+.65)/count);
     f.slot=g.routePhase+i*2.399963+.32*(f.slot/6.283-.5);
     f.spread=.16+.84*ring;
     f.depth=.26+.46*((i*.414214+g.routePhase/6.283)%1);
    }
   }
  }
  const westSchools=this.groups.filter(g=>g.sea&&g.school&&g.h-g.floor>1.4);
  westSchools.sort((a,b)=>Math.hypot(a.x-westCenter[0],a.z-westCenter[1])-Math.hypot(b.x-westCenter[0],b.z-westCenter[1]));
  data.lifeObservations={creek:this.groups.find(g=>g.id==='creek'),west:this.groups.find(g=>g.id==='west-sea')??westSchools[0]};
  data.sampleLife=Object.fromEntries(Object.entries({pool:'sample-pool',midCreek:'sample-mid-creek',logPool:'sample-log-creek',bend:'sample-bend',siltPool:'sample-silt-pool',lowerCreek:'sample-lower-creek',transition:'sample-transition',sea:'sample-sea'}).map(([key,id])=>[key,this.groups.find(g=>g.id===id)]));
  if(sample)data.sampleLife.marineBed=wetNear(-929,147,{min:1.35,max:4,target:2.1,radius:52,step:1,sea:true,sampleMarine:true});
  const obstacles=[...(app.coveRocks?.instances??[]),...(app.shelfReef?.obstacles??[])];
  for(const g of this.groups)g.obstacles=obstacles.filter(r=>Math.hypot(r.x-g.x,r.z-g.z)<g.radius+12);
  this.simulationGroups=this.groups.slice();
  this.reefTarget=new Vector3();
  this.roaming=sample?new RoamingShoals(data,this.groups,breakDepth,obstacles):null;
  this.primarySwim=null;
  this.swimBatches=[];
  const nativeFish=this.fish.filter(f=>!f.vault);
  if(nativeFish.length){
   const kinds=[SPECIES.silverside,SPECIES.mullet].flatMap(species=>[0,1,2,3].map(lod=>({geometry:fishGeometry(species,{lod,pose:'swim'}),shadow:false})));
   nativeFish.forEach((f,i)=>{f.renderIndex=i;});
   this.primarySwim=this.createSwimBatch('Museum life',kinds,nativeFish.length,material=>{
    material.surface+='\nif(fishPartOf(in.vs.vFishData)<7.5){s.albedo*=vec3f(.72,.82,.78);s.metalness*=.55;s.roughness=max(s.roughness,.46);s.specularIntensity=.10;}';
   });
   this.group.add(...this.primarySwim.meshes);
   this.swimBatches.push(this.primarySwim);
  }
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
   state.fixedCount=i;
   state.capacity=i+(this.roaming?ROAMING_FISH_CAPACITY:0);
   if(!state.capacity)continue;
   const {kind}=state, habitats=state.groups.map(g=>({x:g.x,z:g.z,radius:g.radius,minY:g.floor-4,maxY:g.h+5}));
   state.habitats=habitats;
   this.environmentResidency.add({id:kind,habitats,range:96,hysteresis:54,bytes:(kind==='aspidorhynchus'?17:15)*1024**2,
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
     for(const g of this.roaming?.groups??[])if(g.reviewed===kind)for(const f of g.members){f.fresh=true;f.sleeping=true;}
    },
    dispose:asset=>asset.dispose(),
   });
  }
  this.environment=new VaultEnvironmentFlight(this.group,data,visits,this.environmentResidency,prepare,this.app.colliders);
  this.birds=this.environment.fliers.filter(f=>this.environment.types.get(f.species).type.kind==='bird');
  this.benthicDetails=data.field.continuousSample?new SampleBenthicDetails(app,data,data.sampleLife):null;
  this.benthos={corals:[],shells:[],sponges:[]};
  this.benthicResidency=null;
  this.vaultLocationReady=false;
  app.scene.add(this.group);this.q=new Quaternion();this.euler=new Euler(0,0,0,'YXZ');this.frustum=new Frustum();this.refractionFrustum=new Frustum();this.viewProjection=new Matrix4();this.sphere=new Sphere();this.screen=new Vector3();this.frameSight={fish:[],shrimp:[],birds:[],insects:[]};this.trackingSwimmers=[];this.enabled=true;this.update(0,app.camera);
 }
 createSwimBatch(name,kinds,count,configure,reviewed){
  const batch=new ReefBatch(name,kinds,{maxInstances:Math.max(1,count),dynamic:true,fade:true});
  if(reviewed)installReviewedSwimAttributes(batch);
  const motion=reviewed?createReviewedSwimMotion(batch,reviewed):null;
  const makeMaterial=fade=>reviewed?createReviewedSwimMaterial(batch,motion,{fade}):createSwimMaterial(batch,{fade});
  const material=makeMaterial(false),fadeMaterial=makeMaterial(true);
  for(const m of [material,fadeMaterial]){
   configure(m);
   clipCreekRefraction(m,this.data.field);
  }
  const meshes=[batch.createMesh(material,{castShadow:!reviewed}),batch.createFadeMesh(fadeMaterial)];
  return {batch,motion,meshes,dispose(){
   batch.dispose();
   for(const m of [material,fadeMaterial]){
    m.uniformBlock.buffer?.destroy();m.dispose();
   }
   motion?.dispose();
  }};
 }

 async loadReviewedSwim(state,signal){
  const {kind,capacity}=state;
  const [gltf,bytes]=await Promise.all([loadReviewedFauna(kind,signal),loadReviewedIndices(kind,signal)]);
  const textures=[];
  try {
   for(let slot=0;slot<(kind==='aspidorhynchus'?2:1);slot++) {
    textures.push(await reviewedAlbedo(gltf,kind,signal,slot));
   }
   signal.throwIfAborted();
   const kinds=reviewedSwimKinds(gltf,kind,bytes);
   const asset=this.createSwimBatch('Museum '+kind,kinds,capacity,m=>bindReviewedSwim(m,textures),kind);
   return {...asset,dispose(){asset.dispose();for(const texture of textures)texture.destroy();}};
  }catch(error){for(const texture of textures)texture.destroy();throw error;}
 }

 addMarineBed(ecology){
  if(!this.benthicDetails||!this.marineRockProfiles?.length)return;
  this.marineBed=new MarineBenthicDetails(this.app,this.data,ecology,this.marineRockProfiles);
 }
 createBenthicResidency(){
  // At the original west gardens all ten kinds can be in view together.
  // Every other district reserves only the species occupying its actual beds.
  const residency=new FaunaResidency({concurrency:2,residentLimit:10,speciesLimit:10,byteLimit:32*1024**2});
  for(const [category,key] of [['corals','coralSites'],['shells','shellSites'],['sponges','spongeSites']]){
   const sampleSites=this.benthicDetails[key],byKind=new Map();
   for(const site of [...sampleSites,...(this.marineBed?.[key]??[])]){
    if(!byKind.has(site.kind))byKind.set(site.kind,[]);
    byKind.get(site.kind).push(site);
   }
   const sampleKinds=new Set(sampleSites.map(site=>site.kind));
   for(const [kind,sites] of byKind){
    const habitats=sites.map(s=>({x:s.x,z:s.z,y:s.floor}));
    // Retain the historical approach to the west garden from the sample trail.
    if(sampleKinds.has(kind))habitats.push({x:-980,z:150,minY:-30,maxY:0,radius:100});
    residency.add({id:kind,habitats,range:80,hysteresis:35,bytes:3*1024**2+sites.length*128,
     load:signal=>loadBenthicSpecies(kind,category,sites,this.terrain,signal),
     prepare:(asset,signal)=>{
      clipCreekRefraction(asset.mesh.material,this.data.field);
      const model={meshes:[asset.mesh]};
      markStreamedFaunaMaterials(model,'vault-benthos:'+kind);
      return this.app.islandFauna?.pipelines.prepareMain(model,signal);
     },
     attach:asset=>{
      asset.update(this.app.camera);
      this.benthos[category].push(asset);
      this.group.add(asset.mesh);
     },
     detach:asset=>{
      const list=this.benthos[category],index=list.indexOf(asset);
      if(index>=0)list.splice(index,1);
      asset.mesh.removeFromParent();
     },
     dispose:asset=>asset.dispose(),
    });
   }
  }
  return residency;
 }
 queueNearbyVault(camera){
  if(this.disposed)return;
  const cp=camera.position, now=performance.now(),transit=!!this.app.fastHabitatTransit;
  if(!this.lastScan||this.lastTransit!==transit||this.lastScan.distanceToSquared(cp)>36||now>=this.nextScan){
   this.lastTransit=transit;
   this.lastScan??=new Vector3();this.lastScan.copy(cp);this.nextScan=now+400;
   if(!transit&&this.roaming?.scan(cp,this.reviewedSwim,this.app.submergedBed)){
    this.simulationGroups.length=this.groups.length;
    for(const state of Object.values(this.reviewedSwim))state.habitats.length=state.groups.length;
    for(const g of this.roaming.groups){
     this.simulationGroups.push(g);
     this.reviewedSwim[g.reviewed].habitats.push({x:g.x,z:g.z,radius:g.radius,minY:g.floor-4,maxY:g.h+5});
    }
   }
   this.environment.prepareResidency(cp);
   this.environmentResidency.scan(cp,undefined,{deferNewAssets:transit});
   if(this.benthicDetails&&this.enabled){
    this.benthicResidency??=this.createBenthicResidency();
    this.benthicResidency.scan(cp,undefined,{deferNewAssets:transit});
   }else if(this.benthicResidency){
    this.benthicResidency.dispose();
    this.benthicResidency=null;
   }
  }
 }

 async prepareNearby(camera){
  this.vaultLocationReady=true;
  this.queueNearbyVault(camera);
  // Optional bottom fauna streams into the running scene. A damaged reef
  // download must not hold the visitor at the loading screen.
  await Promise.all([...this.environmentResidency.entries.keys()].map(id=>this.environmentResidency.ready(id)));
 }

 update(dt,camera){
  if(this.vaultLocationReady)this.queueNearbyVault(camera);
  this.group.visible=this.enabled;
  this.trackingSwimmers.length=0;
  this.time+=dt;const cp=camera.position;camera.updateMatrixWorld();this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.viewProjection,camera.coordinateSystem,camera.reversedDepth);setRefractionFrustum(this.refractionFrustum,camera,this.viewProjection);this.pxScale=camera.projectionMatrix.elements[5]*this.app.engine.height*.5;this.frameSight={fish:[],shrimp:[],birds:[],insects:[]};for(const {batch} of this.swimBatches)batch.begin();let live=0;this.audit.minBedClearance=Infinity;this.audit.minSurfaceClearance=Infinity;
  for(const g of this.simulationGroups){
   const members=g.members??this.fish;
   const dx=cp.x-g.x,dz=cp.z-g.z;
   if(!this.enabled||dx*dx+dz*dz>65*65||cp.y>g.h+8){
    if(g.awake)for(let i=g.first;i<g.first+g.count;i++){members[i].fresh=true;members[i].sleeping=true;}
    g.awake=false;
    continue;
   }
   const render=g.reviewed?this.reviewedSwim[g.reviewed].ready:this.primarySwim;
   if(!render)continue;
   g.awake=true;
   const {batch,motion}=render,D=batch.data;
   const step=Math.min(dt,.1);
   if (g.reefId!==undefined) g.fadeIn=Math.min(1,(g.fadeIn??0)+step*1.6);
   for(let i=g.first;i<g.first+g.count;i++){
    const f=members[i],renderIndex=f.renderIndex??i;
    f.previous.copy(f.p);this.advance(f,step,cp);
    if(f.sleeping)continue;
    const swim=g.reviewed?advanceReviewedSwimPose(f,step):null;
    const nativeEffort=swim?null:nativeSwimEffort(f,step);
    if(nativeEffort)f.phase=(f.phase+nativeEffort.deltaPhase)%(200*Math.PI);
    const {x,y,z}=f.p,h=g.sea?g.h:this.query.height(x,z),floor=this.terrain.heightAt(x,z);

    const clear=y-floor,top=h-y;this.audit.minBedClearance=Math.min(this.audit.minBedClearance,clear);this.audit.minSurfaceClearance=Math.min(this.audit.minSurfaceClearance,top);if(clear<0||top<0)this.audit.violations++;
    const distance=cp.distanceTo(f.p),range=42;if(distance>range){f.fresh=true;continue;}
    const L=f.L,pixels=L*this.pxScale/Math.max(.2,distance);
    if(pixels<1.2){f.fresh=true;continue;}
    this.sphere.center.copy(f.p);this.sphere.radius=L;
    f.trackingVisible=this.frustum.intersectsSphere(this.sphere);
    if(!g.members)f.trackingId=i;
    this.trackingSwimmers.push(f);
    const renderVisible=f.trackingVisible||this.refractionFrustum.intersectsSphere(this.sphere);
    if(!renderVisible){f.fresh=true;continue;}
    if(f.trackingVisible){this.screen.copy(f.p).project(camera);this.frameSight.fish.push({position:f.p.toArray(),length:L,distance,pixels,ndc:[this.screen.x,this.screen.y],habitat:g.id,species:f.vault??'native',bedClearance:clear,surfaceClearance:top});}
    if(swim){
     this.q.setFromEuler(this.euler.set(swim.pitch,f.yaw,swim.roll,'YXZ'));
     motion.setPose(renderIndex,swim,this.q,f.fresh);
     const k=renderIndex*16;
     D[k]=x;D[k+1]=y;D[k+2]=z;D[k+3]=L;
     D[k+12]=f.fresh?0:x-f.previous.x;D[k+13]=f.fresh?0:y-f.previous.y;D[k+14]=f.fresh?0:z-f.previous.z;
     f.fresh=false;
     addReviewedSwimInstance(batch,renderIndex,pixels,distance,range,g.fadeIn??1);
     live++;
     continue;
    }
    const level=pixels>=320?0:pixels>=80?1:pixels>=22?2:3,lod=f.morph*4+level;
    const {deltaPhase,amplitude,bend,pitch,roll}=nativeEffort;
    this.euler.set(pitch,f.yaw,roll,'YXZ');this.q.setFromEuler(this.euler);
    const k=renderIndex*16;
    D.set([x,y,z,L,this.q.x,this.q.y,this.q.z,this.q.w,f.phase,amplitude,bend,(f.morph?14:0)+f.seed*.9,f.fresh?0:x-f.previous.x,f.fresh?0:y-f.previous.y,f.fresh?0:z-f.previous.z,f.fresh?0:deltaPhase],k);
    f.fresh=false;
    const threshold=[320,80,22][level];
    if(distance>range*.85)batch.addFade(lod,renderIndex,Math.max(0,(range-distance)/(range*.15)),false);
    else if(level<3&&pixels<threshold*1.15){const a=(pixels/threshold-1)/.15;batch.addFade(lod,renderIndex,a,false);batch.addFade(lod+1,renderIndex,a,true);}
    else batch.add(lod,renderIndex);live++;
   }
  }
  this.drawnTriangles=0;
  for(const {batch,motion} of this.swimBatches){
   batch.commit();
   if(batch.pairs||batch.fadePairs){batch.upload();motion?.upload();}
   this.drawnTriangles+=batch.kinds.reduce((sum,k,i)=>sum+k.geometry.index.count/3*(batch.counts[i]+batch.fadeCounts[i]),0);
  }
  this.visibleFish=live;this.visibleShrimp=0;
  this.environment.update(this.time,camera,this.frustum,this.pxScale,this.frameSight,this.enabled);
  this.visibleBirds=this.environment.visible.birds;
  this.audit.minBirdGroundClearance=this.frameSight.birds.reduce((min,b)=>Math.min(min,b.groundClearance),Infinity);
  this.benthicDetails?.update(camera);this.marineBed?.update(cp);
  for(const category of Object.values(this.benthos))for(const asset of category)asset.update(camera);
 }
 advance(f,dt,cp){
  const g=f.group,p=f.p,v=f.velocity;
  if(f.sleeping){
   p.set(g.x+Math.cos(f.slot)*g.radius*f.spread*.65,0,g.z+Math.sin(f.slot)*g.radius*f.spread*.5);
   const clear=Math.max(.14,f.L*.24),topMargin=g.sea?.85:clear;
   let bed=this.terrain.heightAt(p.x,p.z),water=g.sea?g.h:this.query.height(p.x,p.z);
   if(water-bed<clear+topMargin+.12){p.x=g.x;p.z=g.z;bed=g.floor;water=g.h;}
   if (g.reefId!==undefined) {
    // Wake the whole school in formation, with its tail stroke at a distinct
    // phase. Reject an obstructed spawn rather than showing a fish in stone.
    for (let attempt=0;attempt<6;attempt++) {
     reefPatrolTarget(p,g,f,this.time+attempt*2.7);
     bed=Math.max(this.terrain.heightAt(p.x,p.z),reefObstacleTop(g.reefObstacles,p.x,p.z,f.L*.48));
     if (water-bed>topMargin+clear+.1) break;
    }
    if (water-bed<=topMargin+clear+.1) return;
   }
   const ceiling=water-topMargin;
   const y=g.lowerDwell?bed+clear+.14:water-f.depth*(water-bed);
   p.y=Math.max(bed+clear,Math.min(ceiling,y));
   if(g.reviewed)v.set(0,0,0);else v.set(Math.sin(f.slot)*.12,0,Math.cos(f.slot)*.12);
   f.yaw=f.slot;f.swimPose=null;f.swimBend=0;f.panic=0;
   f.sleeping=false;f.alignOnWake=true;f.previous.copy(p);
  }
  const steps=Math.max(1,Math.ceil(dt/.035)),hdt=dt/steps;
  for(let k=0;k<steps;k++){
   const time=this.time*(.11+f.seed*.07)+f.slot, schoolTime=this.time*.17+(g.routePhase??0);
   const local=g.school?.4:1, common=g.school?g.radius*.62:0, r=g.radius*f.spread*local;
   const along=Math.cos(schoolTime)*common+Math.cos(time)*r;
   const across=Math.sin(schoolTime)*common*.63+Math.sin(time*.73+f.seed)*r*.68;
   // Stream fish patrol the channel, keeping their cross-current excursion short.
   let tx=g.x+(g.current?along*g.current[0]-across*.60*g.current[1]:along);
   let tz=g.z+(g.current?along*g.current[1]+across*.60*g.current[0]:across);
   if (g.reefId!==undefined) {
    const target=reefPatrolTarget(this.reefTarget,g,f,this.time+1.25);
    tx=target.x;tz=target.z;
   }
   const dx=tx-p.x,dz=tz-p.z,dl=Math.max(Math.hypot(dx,dz),1e-6);
   const approach=Math.min(1,dl/f.L);
   const speed=g.reviewed?reviewedCruiseSpeed(f,this.time,dl)
    :f.L*(1.2+f.seed*.9)*(g.cruise??1)*(.36+.64*approach);
   let thrust=1;
   if(g.reviewed) {
    f.swimDemand=speed/f.L;
    // Hydrodynamic drag carries the animal through recovery; positive drive
    // peaks twice a cycle as the caudal blade crosses the body centreline.
    const pose=f.swimPose;
    const phase=(pose?.phase??f.phase)-f.thrustPhase;
    thrust=Math.min(1,(pose?.effort??0)*3.8)*(.72+.28*Math.cos(2*phase));
   }
   let ax=(dx/dl*speed*thrust-v.x)*1.5,az=(dz/dl*speed*thrust-v.z)*1.5;
   const awayX=p.x-cp.x,awayZ=p.z-cp.z,awayY=p.y-cp.y,away=Math.hypot(awayX,awayY,awayZ),
    reach=Math.max(.72,Math.min(2.7,3.4*f.L));
   f.panic=Math.max(0,f.panic-hdt*.6);
   if(away<reach){const a=1-away/reach,force=a*a*8+a*2;ax+=awayX/(away+.01)*force;az+=awayZ/(away+.01)*force;f.panic=Math.max(f.panic,a);this.audit.fleeFrames++;if(v.x*awayX+v.z*awayZ>0)this.audit.fleeAwayFrames++;}
   // Short-range body separation within the active school, scaled by length.
   const members=g.members??this.fish;
   for(let i=g.first;i<g.first+g.count;i++){const q=members[i];if(q===f||q.sleeping)continue;const sx=p.x-q.p.x,sz=p.z-q.p.z,sd=Math.hypot(sx,sz),clear=(f.L+q.L)*.8;if(sd<clear&&sd>.001){const force=(clear-sd)*1.8;ax+=sx/sd*force;az+=sz/sd*force;}}
   for(const rock of g.obstacles??[]){const rx=p.x-rock.x,rz=p.z-rock.z,d=Math.hypot(rx,rz),safe=(rock.footRadius??rock.size*.9)+f.L*1.5;if(d<safe+1.1&&p.y<(rock.top??rock.y+rock.size*rock.sy*1.1)){const force=(safe+1.1-d)*3;ax+=rx/(d+.01)*force;az+=rz/(d+.01)*force;this.audit.obstacleDeflections++;}}
   const lookX=p.x+v.x*.8,lookZ=p.z+v.z*.8;
   if (g.reefObstacles?.length) {
    for (const rock of g.reefObstacles) {
     const rx=lookX-rock.x,rz=lookZ-rock.z,reach=rock.radius+f.L*1.55;
     if (p.y>rock.top+f.L*.5 || rx*rx+rz*rz>=reach*reach) continue;
     const d=Math.max(.01,Math.hypot(rx,rz)),force=(reach-d)*2.7;
     ax+=rx/d*force;az+=rz/d*force;this.audit.obstacleDeflections++;
    }
   }
   const water=g.sea?g.h:this.query.height(lookX,lookZ),bed=this.terrain.heightAt(lookX,lookZ),minimum=g.sampleMarine?1.12:g.sea?Math.max(1.5,this.breakDepth(lookX,lookZ)+.35):.35;
   if(water-bed<minimum){const gx=this.terrain.heightAt(lookX+.5,lookZ)-this.terrain.heightAt(lookX-.5,lookZ),gz=this.terrain.heightAt(lookX,lookZ+.5)-this.terrain.heightAt(lookX,lookZ-.5),l=Math.hypot(gx,gz)||1;ax-=gx/l*2+v.x*2;az-=gz/l*2+v.z*2;}
   v.x+=ax*hdt;v.z+=az*hdt;const max=speed*(1+f.panic*3),length=Math.hypot(v.x,v.z);if(length>max){v.x*=max/length;v.z*=max/length;}
   if(g.reviewed)steerReviewedSwimmer(f,hdt);
   const bodyClearance=Math.max(.14,f.L*.24);
   let nx=p.x+v.x*hdt,nz=p.z+v.z*hdt,h=g.sea?g.h:this.query.height(nx,nz),floor=this.terrain.heightAt(nx,nz),ceiling=h-(g.sea?.85:bodyClearance);
   if(h-floor<minimum||ceiling<floor+bodyClearance+.08){nx=p.x;nz=p.z;v.x*=-.3;v.z*=-.3;h=g.sea?g.h:this.query.height(nx,nz);floor=this.terrain.heightAt(nx,nz);ceiling=h-(g.sea?.85:bodyClearance);}
   if (g.reefObstacles?.length) {
    // Keep the whole body outside the scanned footprint. Check ahead while
    // steering, and reject a horizontal step into a taller rock face.
    let top=reefObstacleTop(g.reefObstacles,nx,nz,f.L*.48);
    if (top+bodyClearance>p.y && top>floor) {
     nx=p.x;nz=p.z;v.x*=.5;v.z*=.5;
     top=reefObstacleTop(g.reefObstacles,nx,nz,f.L*.48);
     floor=this.terrain.heightAt(nx,nz);
    }
    floor=Math.max(floor,top);
    if (floor+bodyClearance>ceiling) { f.sleeping=true;f.fresh=true;return; }
   }
   const desired=g.lowerDwell?floor+bodyClearance+.14+Math.sin(time*.6)*.055:h-f.depth*(h-floor)+Math.sin(time*.6)*.06;
   const target=Math.max(floor+bodyClearance,Math.min(ceiling,desired));
   v.y+=(target-p.y)*hdt*4-v.y*hdt*3;const y=Math.max(floor+bodyClearance,Math.min(ceiling,p.y+v.y*hdt));p.set(nx,y,nz);this.audit.maxPanic=Math.max(this.audit.maxPanic,f.panic);
  }
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;
  this.benthicResidency?.dispose();
  this.marineBed?.dispose();
  this.environmentResidency.dispose();
  this.primarySwim?.dispose();
  this.group.removeFromParent();
 }
 hold(){for(const f of this.fish)f.fresh=true;for(const g of this.roaming?.groups??[])for(const f of g.members)f.fresh=true;this.environment.hold();}
 stats(){
  const bottom=this.benthicResidency?.stats();
  const benthicErrors=[...(this.benthicResidency?.entries.values()??[])].filter(e=>e.error).map(e=>e.definition.id+' '+e.error);
  const species=Object.fromEntries(REVIEWED_FISH.map(kind=>[kind,this.fish.filter(f=>f.vault===kind).length]));
  return {
   time:this.time,vaultAssets:this.benthicDetails?{benthic:{...bottom,ready:(bottom?.resident??0)>0,
    pending:!!(bottom?.inFlight||bottom?.queued),attempts:bottom?.requested??0,error:benthicErrors.join('; ')||null}}:null,
   articulation:{fish:this.swimBatches.flatMap(({batch})=>batch.kinds.filter(k=>k.geometry.vaultRigStats).map(k=>k.geometry.vaultRigStats))},
   enabled:this.enabled,fish:this.fish.length,shrimp:0,
   birds:this.birds.length,insects:this.environment.fliers.length-this.birds.length,
   environmentalFlight:this.environment.stats(),
   environmentalShoals:Object.fromEntries(Object.entries(this.reviewedSwim).map(([kind,s])=>[kind,{ready:!!s.ready,habitats:s.groups.length,individuals:s.fixedCount,residency:this.environmentResidency.state(kind)}])),
   roamingShoals:(this.roaming?.groups??[]).map(g=>({id:g.id,species:g.reviewed,water:g.water,center:[g.x,g.h,g.z],depth:g.depth,count:g.count})),
   environmentResidency:this.environmentResidency.stats(),
   corals:this.benthos?.corals.reduce((n,c)=>n+c.sites.length,0)??0,coralKinds:this.benthos?.corals.length??0,shellForms:this.benthos?.shells.reduce((n,s)=>n+s.sites.length,0)??0,shellKinds:this.benthos?.shells.length??0,sponges:this.benthos?.sponges.reduce((n,s)=>n+s.sites.length,0)??0,visibleCorals:this.benthos?.corals.reduce((n,c)=>n+c.mesh.count,0)??0,visibleShells:this.benthos?.shells.reduce((n,s)=>n+s.mesh.count,0)??0,benthicDetails:this.benthicDetails?.stats()??null,marineBed:this.marineBed?.stats()??[],species,
   visibleFish:this.visibleFish,visibleShrimp:this.visibleShrimp,visibleBirds:this.visibleBirds,
   activeBirds:this.birds.filter(b=>b.active).length,drawnTriangles:this.drawnTriangles,
   habitats:this.groups.map(g=>({id:g.id,center:[g.x,g.h,g.z],floor:g.floor,depth:g.h-g.floor,count:g.count,species:this.fish[g.first]?.vault??'native environmental form',lengthRange:[Math.min(...this.fish.slice(g.first,g.first+g.count).map(f=>f.L)),Math.max(...this.fish.slice(g.first,g.first+g.count).map(f=>f.L))],radius:g.radius,sea:g.sea??false,sampleMarine:g.sampleMarine??false,surfaceReference:g.sampleMarine?'fixed mean sea with 0.85m ceiling margin and 2.5m local depth footprint':g.sea?'fixed mean sea with 0.85m ceiling margin and native breaker exclusion':'local inland water'})),
   waterBounds:{...this.audit,scope:'fish centre against terrain and conservative ceiling; conservative rock steering; not a full deforming mesh/wave-trough collision proof'},
   screenCandidates:Object.fromEntries(Object.entries(this.frameSight).map(([k,v])=>[k,{count:v.length,examples:v.slice(0,12)}])),
   visibilityMeaning:'main-camera frustum + projected pixel threshold + distance; not occlusion or water-transmission proof; inspect actual image',
   appearance:'Diplomystus and Cheiracanthus shoal in freshwater, with Coccosteus in deeper pools. Eusthenopteron occupies the estuarine transition; Falcatus and Aspidorhynchus cruise marine shallows. Ichthyornis follows the coast and Sapeornis the forest and freshwater margins. Flying insects cluster around wet tracks and understory.',
   movement:this.fish.filter(f=>!f.sleeping).slice(0,10).map(f=>({position:f.p.toArray(),velocity:f.velocity.toArray(),panic:f.panic,group:f.group.id})),
   method:'habitat-streamed museum fin and spine palettes; conservative bed/ceiling and breaker checks; 65m fish simulation and 42m drawing',
   scientificStatus:'This imaginative island deliberately mixes eras while keeping freshwater, marine and aerial habitats distinct. Static Vault models are stylized teaching forms, not specimen-level reconstructions.'
  };
 }
}
