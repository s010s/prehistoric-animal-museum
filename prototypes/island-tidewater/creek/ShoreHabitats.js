// The original survey debris and the finer deposits use the native Tidewater
// nature material. New station layouts follow the local waterline orientation.
import {Mesh, Group} from '../vendor/tidewater/src/engine/index.js';
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {shell,stone,coralPiece,driftLog,seagrassWrack} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {createNatureMaterial} from '../vendor/tidewater/src/world/debris/NatureMaterial.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {buildShorePlants,createShorePlantMaterial} from './ShorePlants.js';
import {buildShoreDeposits} from './ShoreDeposits.js';

// Keep the six existing layouts bit-for-bit when stations are reordered or
// extended. Other sites receive a stable seed from their own identifier.
const SURVEY_SEEDS={coast:6127,'rock-cove':7124,estuary:8121,'east-coast':9118,'lake-shore':10115,'tarn-shore':11112};
function siteSeed(id) {
  let hash=2166136261;
  for (const ch of id) hash=Math.imul(hash^ch.charCodeAt(0),16777619);
  return hash>>>0;
}

function surveyDebris(site, profile, ground, counts) {
  const builder=new Builder(), rand=mulberry32(SURVEY_SEEDS[site.id]??siteSeed(site.id));
  const {level,freshwater}=profile;
  const rocky=profile.kind==='rocky-cove', coral=profile.kind==='shell-beach', estuary=profile.kind==='tidal-estuary';
  for(let n=0;n<900;n++) {
    const x=site.x+(rand()-.37)*110,z=site.z+(rand()-.5)*150,h=ground(x,z);
    const slope=Math.hypot(ground(x+1,z)-ground(x-1,z),ground(x,z+1)-ground(x,z-1))/2;
    if(h<level+.4 || h>level+3.5 || slope>.42) continue;
    const r=rand();
    if(!freshwater && r<.57 && counts.shell<85) {
      shell(builder,ground,x,z,.055+rand()*.13,rand,{type:rand()<.8?0:1}); counts.shell++;
    } else if((r<.80 || freshwater) && counts.stone<90) {
      const s=.035+rand()*.11;
      stone(builder,ground,x,z,s,s*.65,s*.8,rand,{palette:rocky?.25:.48,detail:0}); counts.stone++;
    } else if(coral && r<.86 && counts.coralFragment<8) {
      coralPiece(builder,ground,x,z,.12+rand()*.16,rand,{bleach:.92}); counts.coralFragment++;
    }
  }
  for(let n=0;n<250;n++) {
    const x=site.x+(rand()-.25)*90,z=site.z+(rand()-.5)*110,h=ground(x,z);
    if(h<level+.8 || h>level+3.3) continue;
    if((estuary||freshwater) && counts.driftwood<8) {
      driftLog(builder,ground,x,z,rand()*Math.PI,rand,{len:1.1+rand()*1.6,r0:.065,r1:.04}); counts.driftwood++;
    } else if(!freshwater && counts.wrack<12) {
      seagrassWrack(builder,ground,x,z,.15+rand()*.2,rand,{dry:.8}); counts.wrack++;
    }
  }
  if(rocky) for(let n=0;n<22;n++) {
    const x=site.x-7+(rand()-.5)*20,z=site.z+(rand()-.5)*140,h=ground(x,z);
    if(h<level-2.5 || h>level+1.8) continue;
    const s=1.2+rand()*2.1;
    stone(builder,ground,x,z,s,s*(.7+rand()*.35),s*.85,rand,{palette:.20+rand()*.16,detail:1,sink:.26,tilt:.15}); counts.stone++;
  }
  for(let n=0;n<100;n++) {
    const x=site.x-5-rand()*55,z=site.z+(rand()-.5)*120,h=ground(x,z);
    if(h>level-.1 || h<level-13.3) continue;
    const s=(rocky?.45:.18)+rand()*(rocky?1.2:.5);
    stone(builder,ground,x,z,s,s*(.35+rand()*.3),s*.8,rand,{palette:rocky?.15:.47,detail:1,sink:.35}); counts.stone++;
  }
  const batch=builder.batches.nature;
  if (!batch?.idx.length) return null;
  for(let i=0;i<batch.vcount;i++) {
    const y=batch.pos[i*3+1],x=batch.pos[i*3],z=batch.pos[i*3+2];
    const contact=.65+.35*Math.min(1,Math.max(0,y-ground(x,z))/.16);
    for(let c=0;c<3;c++) batch.tint[i*3+c]*=contact;
  }
  const geometry=batch.build();geometry.computeBoundingSphere();
  return geometry;
}

function fitWeight(sample, profile, plant) {
  if(plant) {
    if(sample.slope>.56 || sample.relativeHeight<(profile.freshwater?-.04:.95)) return 0;
    return Math.max(sample.backshore,profile.freshwater?sample.strand*.83:0)*(1-sample.channel);
  }
  if(profile.freshwater || sample.slope>.44 || sample.relativeHeight<.09) return 0;
  return Math.max(sample.strand,sample.swash*.35)*(.35+.65*sample.sand)*sample.marine*(1-sample.channel);
}

// Survey both banks of a tidal opening for the outermost *rootable* sand
// shoulder. Its seaward foot catches a thin strand of shell and plant litter.
// These consume existing pocket slots; the channel itself stays open.
function estuaryShoulders(data,site,profile) {
  const plants=[],shells=[];
  if(profile.kind!=='tidal-estuary') return {plants,shells};
  const [nx,nz]=profile.normal;
  for(const side of [-1,1]) {
    let best=null;
    for(let along=6;along<=54;along+=2) for(let inland=-29;inland<18;inland+=2) {
      const x=site.x-nz*along*side-nx*inland,z=site.z+nx*along*side-nz*inland;
      const s=data.landforms.sample(profile,x,z);
      if(s.backshore<.38 || s.relativeHeight<1.1 || s.slope>.36 || s.channel>.04) continue;
      const score=Math.abs(s.relativeHeight-1.42)*6+(1-s.backshore)*1.3+along*.065+inland*.23+s.slope*2;
      if(!best || score<best.score) best={x,z,score};
    }
    if(!best) continue;
    plants.push(best);
    let drift=null;
    for(let along=-5;along<=5;along++) for(let off=1;off<=12;off++) {
      const x=best.x-nz*along+nx*off,z=best.z+nx*along+nz*off;
      const s=data.landforms.sample(profile,x,z);
      if(fitWeight(s,profile,false)<.28 || s.channel>.05 || s.relativeHeight<.22) continue;
      const score=Math.abs(s.relativeHeight-.79)*3.6+Math.abs(off-3.8)*.2+Math.abs(along)*.08;
      if(!drift || score<drift.score) drift={x,z,score};
    }
    if(drift) shells.push(drift);
  }
  return {plants,shells};
}

function pockets(data,site,profile,normal,plant,shoulders) {
  const budget=profile.detail, target=plant?budget.clusterCount:budget.shellPocketCount;
  const rand=mulberry32(siteSeed(site.id+(plant?'/leaves':'/valves')));
  const [nx,nz]=normal, result=[];
  // A shore can curve through this search envelope. Check both the patch
  // centre and each root/deposit against the final physical water and terrain.
  for(let attempt=0;result.length<target && attempt<target*170;attempt++) {
    // First sample the lower bank; then allow the backshore on both flanks.
    // Lake bays can cut back into the survey footprint, so search across it.
    const lower=plant && result.length<target*.53;
    const along=(rand()-.5)*(lower?102:152);
    const inland=profile.freshwater?-66+rand()*114:
      plant?(lower?-23+rand()*51:-3+rand()*71):-15+rand()*57;
    const shoulder=shoulders[attempt];
    const x=shoulder?.x??(site.x-nz*along-nx*inland),z=shoulder?.z??(site.z+nx*along-nz*inland);
    const sample=data.landforms.sample(profile,x,z),weight=fitWeight(sample,profile,plant);
    if(weight<=0 || (!shoulder && rand()>weight)) continue;
    const spacing=plant?5.6:3.4;
    if(result.some(p=>(p.x-x)**2+(p.z-z)**2<spacing*spacing)) continue;
    const members=[],wanted=shoulder?5+Math.floor(rand()*3):3+Math.floor(rand()*(plant?5:6));
    // Loose hummocks and stranded material have a longer axis along shore.
    const length=plant?1.05+rand()*1.25:.7+rand()*1.65, width=plant?.42+rand()*.61:.25+rand()*.55;
    for(let k=0;k<wanted*4 && members.length<wanted;k++) {
      const a=k===0?0:(rand()-.5)*2*length, b=k===0?0:(rand()-.5)*2*width;
      const px=x-nz*a+nx*b,pz=z+nx*a+nz*b;
      const s=k===0?sample:data.landforms.sample(profile,px,pz);
      if(fitWeight(s,profile,plant)<weight*.38) continue;
      const apart=plant?.38:.19;
      if(members.some(m=>(m.x-px)**2+(m.z-pz)**2<apart*apart)) continue;
      const [low,high]=plant?budget.plantHeight:[.098,.295];
      // A tall central fan and smaller spreading shoots make one hummock.
      const youth=Math.min(1,Math.hypot(a/length,b/width));
      const size=plant?(high-(high-low)*rand()*.37)*(1-youth*.6):low+(high-low)*rand()**1.35;
      members.push({x:px,z:pz,height:s.height,size,seed:Math.floor(rand()*4294967296)});
    }
    if(members.length>=2) result.push({x,z,members,shoulder:!!shoulder});
  }
  return result;
}

export function planShoreDetails(data,sites) {
  const stations=[...sites];
  const stream=data.field.continuousSample;
  const mouth=stream?.points.find(p=>p.level<=stream.sea+.5);
  if(mouth && !stations.some(s=>s.id==='sample-mouth')) stations.push({id:'sample-mouth',kind:'tidal-estuary',x:mouth.x,z:mouth.z,level:stream.sea});
  return stations.map(site=>{
    const profile=data.landforms.profileFor(site),normal=profile.normal;
    const shoulders=estuaryShoulders(data,site,profile);
    return {site,profile,normal,plants:pockets(data,site,profile,normal,true,shoulders.plants),shells:pockets(data,site,profile,normal,false,shoulders.shells)};
  });
}

// Find dry footing with real valves in the foreground and a stand beyond.
// The view follows the actual deposit even after a terrain or recipe change.
function strandVisit(data,plan) {
  const leaves=plan.plants.flatMap(p=>p.members),[nx,nz]=plan.normal;
  let best=null;
  for(const shells of plan.shells) {
    const valve=shells.members.reduce((a,b)=>a.size>b.size?a:b);
    for(const pocket of plan.plants) {
      const plant=pocket.members[0],dx=plant.x-valve.x,dz=plant.z-valve.z,d=Math.hypot(dx,dz);
      if(d<2.1 || d>15) continue;
      const fx=dx/d,fz=dz/d,towardSea=nx*fx+nz*fz;
      // A shell line often lies seaward of its planting. Both tangential
      // approaches keep the pair in view without standing in the wash.
      for(const side of [0,2.7,-2.7,4,-4]) {
        const px=valve.x-fx*2.35-fz*side,pz=valve.z-fz*2.35+fx*side;
        const foot=data.landforms.sample(plan.profile,px,pz);
        if(foot.relativeHeight<.48 || foot.slope>.48 || leaves.some(p=>(px-p.x)**2+(pz-p.z)**2<1.2)) continue;
        const score=Math.abs(d-4.7)*.43+Math.abs(towardSea-.34)*1.7+foot.slope*2.5-valve.size+
          Math.abs(side)*.1-(shells.shoulder && pocket.shoulder?9.5:0);
        if(!best || score<best.score) best={score,p:[px,pz],
          gaze:[valve.x+dx*.36,valve.height*.64+(plant.height+plant.size*.32)*.36,valve.z+dz*.36]};
      }
    }
  }
  if(!best) return null;
  return {id:'sample-strand',title:'沙滩植物与贝壳',p:best.p,gaze:best.gaze,time:12.6,
    note:'沙面上散着带肋的壳瓣和螺壳。沿叶丛向海走，可以看到退水留下的湿沙。'};
}

function pocketSummary(pockets) {
  const middle=pockets[Math.floor(pockets.length/2)]?.members[0];
  return {pockets:pockets.length,count:pockets.reduce((sum,p)=>sum+p.members.length,0),
    example:middle?[middle.x,middle.height,middle.z]:null};
}

export class ShoreHabitats {
  constructor({scene,data,terrainGPU,sites=data.hydrology.coasts}) {
    this.group=new Group();this.group.name='Museum shore habitats';
    this.material=createNatureMaterial(terrainGPU);this.foliage=createShorePlantMaterial();
    this.patches=[];this.strandVisit=null;
    const ground=(x,z)=>data.terrain.heightAt(x,z);
    const originalStations=new Set(sites);
    for(const plan of planShoreDetails(data,sites)) {
      const {site,profile}=plan,counts={shell:0,stone:0,coralFragment:0,driftwood:0,wrack:0};
      const patch={site,counts,meshes:[],plants:pocketSummary(plan.plants),deposits:pocketSummary(plan.shells)};
      const add=(geometry,material,reach,name,animated=false)=>{
        if(!geometry) return;
        const mesh=new Mesh(geometry,material);
        mesh.name=site.id+' '+name;mesh.staticVelocity=!animated;
        mesh.castShadow=animated;mesh.receiveShadow=true;
        this.group.add(mesh);
        patch.meshes.push({mesh,reach,animated,survey:name==='survey debris'});
      };
      if(originalStations.has(site)) add(surveyDebris(site,profile,ground,counts),this.material,330,'survey debris');
      add(buildShoreDeposits(plan,ground),this.material,profile.detail.shellReach,'strand deposits');
      add(buildShorePlants(plan,ground),this.foliage,profile.detail.plantReach,'shore plants',true);
      this.patches.push(patch);
      if(site.id==='sample-mouth') this.strandVisit=strandVisit(data,plan);
    }
    scene.add(this.group);
  }

  update(camera) {
    const {x,y,z}=camera.position;
    for(const patch of this.patches) for(const {mesh,reach,animated,survey} of patch.meshes) {
      if(survey) {
        mesh.visible=(x-patch.site.x)**2+(z-patch.site.z)**2<reach*reach && Math.abs(y-(patch.site.level??-.7))<180;
        continue;
      }
      const {center,radius}=mesh.geometry.boundingSphere;
      const distance2=(x-center.x)**2+(y-center.y)**2+(z-center.z)**2;
      mesh.visible=distance2<(reach+radius)**2;
      if(animated) mesh.castShadow=distance2<(Math.min(reach,100)+radius)**2;
    }
  }

  stats() {
    return {placement:'grounded survey debris; shore-oriented pocket deposition and rooted backshore/lake clumps',
      patches:this.patches.map(p=>({
        id:p.site.id,kind:p.site.kind,counts:p.counts,plants:p.plants,deposits:p.deposits,
        triangles:p.meshes.reduce((n,b)=>n+b.mesh.geometry.index.count/3,0),visible:p.meshes.some(b=>b.mesh.visible),
      })),singleSharedMaterial:false,sharedMaterials:2};
  }

  dispose() {
    this.group.removeFromParent();
    for(const p of this.patches) for(const {mesh} of p.meshes) {
      mesh.removeFromParent();mesh.geometry.dispose();
    }
    this.patches.length=0;this.material.dispose();this.foliage.dispose();
  }
}
