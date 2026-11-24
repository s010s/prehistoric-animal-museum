// Bed-scale detail for the continuous sample. The mouth keeps an open sand
// channel; patchy grass and carbonate exposures occupy the sheltered shelf.
import {Group,Mesh,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {stone} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {createMeadow,createMound,createSeagrass} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {createReefMaterials,createReefView,SURFACE} from '../vendor/tidewater/src/world/reef/ReefMaterials.js';
import {createNoiseVolume} from '../vendor/tidewater/src/world/reef/ReefNoise.js';
import {CORALS,SHELLS,SPONGES} from './VaultReefAssets.js';

// Bivalves fill two of the four slots in each deposit. The spiral shells
// keep their established positions, including the shell-bank observation.
const depositShells=['trigonia',...SHELLS];
const patches=[
 {id:'middle-creek',key:'midCreek',rx:9,rz:13,rocks:32,plants:28,meadows:0,marine:false,min:.65,max:2.8},
 {id:'log-pool',key:'logPool',rx:12,rz:15,rocks:35,plants:32,meadows:0,marine:false,min:.75,max:2.8},
 {id:'bend-pool',key:'bend',rx:12,rz:15,rocks:38,plants:38,meadows:0,marine:false,min:.75,max:2.8},
 {id:'silt-pool',key:'siltPool',rx:13,rz:16,rocks:42,plants:46,meadows:0,marine:false,min:.75,max:2.8},
 {id:'lower-creek',key:'lowerCreek',rx:17,rz:19,rocks:42,plants:42,meadows:0,marine:false,min:.65,max:3.0},
 {id:'brackish-mouth',key:'transition',rx:12,rz:10,rocks:23,plants:10,meadows:0,marine:false,min:.9,max:2.7},
 {id:'marine-mouth',key:'marineBed',rx:27,rz:25,rocks:48,plants:51,meadows:26,hard:4,shells:22,marine:true,min:1.35,max:3.7},
 {id:'sheltered-shelf',key:'sea',rx:30,rz:28,rocks:49,plants:58,meadows:32,hard:4,shells:22,marine:true,min:1.5,max:4.0,offsetX:-10},
 {id:'southern-shelf',key:'sea',rx:28,rz:26,rocks:38,plants:47,meadows:26,hard:3,shells:20,marine:true,min:1.2,max:3.6,offsetX:-24,offsetZ:-33},
 {id:'northern-shelf',key:'sea',rx:29,rz:27,rocks:38,plants:48,meadows:26,hard:3,shells:20,marine:true,min:1.15,max:3.6,offsetX:-20,offsetZ:34},
 {id:'outer-shelf',key:'sea',rx:30,rz:28,rocks:36,plants:48,meadows:27,hard:3,shells:20,marine:true,min:1.6,max:4.0,offsetX:-44,offsetZ:6},
];

export class SampleBenthicDetails{
 constructor(app,data,habitats){
  this.group=new Group();this.group.name='Sample stream and seafloor details';
  this.coralSites=[];this.shellSites=[];this.spongeSites=[];this.reefGardens=[];this.plants=[];this.hardSites=[];this.rockPatches=[];this.patchCounts=[];
  const ground=(x,z)=>data.terrain.heightAt(x,z);let rng=mulberry32(284611);
  const caveRocks=app.coveRocks?.instances??[];
  const water=(x,z,marine)=>marine?-.7:app.query.height(x,z);
  const slope=(x,z)=>Math.hypot(ground(x+.5,z)-ground(x-.5,z),ground(x,z+.5)-ground(x,z-.5));
  const inSandChannel=(x,z)=>{const r=data.field.continuousSample.nearest(x,z);return r&&r.distance<900&&Math.abs(r.across)<5;};
  const pick=(spec,center,used,spacing,limit=110)=>{
   for(let attempt=0;attempt<limit;attempt++){
    // Separate foci make irregular pockets rather than a continuous carpet.
    const focus=attempt%3-1,dx=(rng()-.5)*spec.rx+focus*spec.rx*.22,dz=(rng()-.5)*spec.rz-focus*spec.rz*.13;
    const x=center.x+dx,z=center.z+dz,floor=ground(x,z),depth=water(x,z,spec.marine)-floor;
    if(depth<spec.min||depth>spec.max||slope(x,z)>(spec.maxSlope??.33))continue;
    if(spec.marine&&inSandChannel(x,z))continue;
    if(caveRocks.some(r=>Math.hypot(r.x-x,r.z-z)<(r.footRadius??r.size??.5)+.4))continue;
    if(used.some(p=>Math.hypot(p.x-x,p.z-z)<spacing))continue;
    return {x,z,floor,depth};
   }
   return null;
  };
  for(const spec of patches){
   let seed=284611;for(const letter of spec.id)seed=(seed*31+letter.charCodeAt(0))>>>0;rng=mulberry32(seed);
   const habitat=habitats[spec.key];if(!habitat)continue;
   const center={...habitat,x:habitat.x+(spec.offsetX??0),z:habitat.z+(spec.offsetZ??0)};
   const B=new Builder(),rocks=[],coralStart=this.coralSites.length,shellStart=this.shellSites.length,hardStart=this.hardSites.length,plantStart=this.plants.length;
   for(let i=0;i<spec.rocks;i++){
    const p=pick(spec,center,rocks,.16);if(!p)break;
    const size=spec.marine?.045+Math.pow(rng(),2)*.12:.065+Math.pow(rng(),2)*.23;
    stone(B,ground,p.x,p.z,size,size*(.38+rng()*.25),size*(.6+rng()*.3),rng,{palette:spec.marine?.36+rng()*.2:.22+rng()*.2,detail:size>.11?1:0,sink:.36,tilt:.08});
    rocks.push(p);
   }
   if(spec.marine){
    // Each garden forms 2–3 tight, multi-species reef bommie cores anchored on
    // partly-buried carbonate rock, separated by clean open sand channels rather
    // than evenly spaced display specimens on flat coasters.
    for(let cluster=0;cluster<spec.hard;cluster++){
     let anchor=pick({...spec,min:spec.id==='marine-mouth'?1.9:1.55,max:3.8,maxSlope:.18},center,this.reefGardens,8,420);
     if(spec.id==='marine-mouth'&&cluster===0){const x=-932,z=149,floor=ground(x,z),depth=water(x,z,true)-floor;if(depth>1.8&&depth<3.5&&slope(x,z)<.22)anchor={x,z,floor,depth};}
     if(!anchor)continue;
     const yaw=rng()*Math.PI*2,garden=this.reefGardens.length,occupied=[];
     this.reefGardens.push({...anchor,id:spec.id+'-'+cluster,patch:spec.id,radius:3.5});
     // Build 3 distinct sub-cores (1 main bommie + 2 flanking satellites across sand lanes).
     const cores=[{x:anchor.x,z:anchor.z,r:1.35,w:1.0}];
     for(let c=0;c<2;c++){
      const ca=yaw+(c===0?0.45:2.95)+(rng()-.5)*.65,cd=1.95+rng()*1.05;
      const cx=anchor.x+Math.cos(ca)*cd,cz=anchor.z+Math.sin(ca)*cd,cf=ground(cx,cz),cdpt=water(cx,cz,true)-cf;
      if(cdpt>=spec.min&&cdpt<=spec.max&&slope(cx,cz)<.23&&!inSandChannel(cx,cz))cores.push({x:cx,z:cz,r:1.05,w:.65});
     }
     // Anchor 1–2 low, naturally sand-embedded carbonate reef cores per bommie (no coaster per coral).
     for(const [ci,core] of cores.entries()){
      const coreFloor=ground(core.x,core.z);
      const baseScale=ci===0?1.35+rng()*.38:.88+rng()*.32;
      this.hardSites.push({x:core.x,z:core.z,floor:coreFloor,scale:baseScale,yaw:yaw+ci*1.9+rng()*.8,seed:rng(),patch:spec.id,sink:.095,sy:.22});
      if(ci===0){
       const oa=yaw+1.5+rng()*.8,od=.52+rng()*.28;
       const ox=core.x+Math.cos(oa)*od,oz=core.z+Math.sin(oa)*od;
       this.hardSites.push({x:ox,z:oz,floor:ground(ox,oz),scale:.92+rng()*.30,yaw:oa+rng(),seed:rng(),patch:spec.id,sink:.085,sy:.20});
      }
     }
     for(let i=0;i<26;i++){
      const species=CORALS[(garden*7+i)%CORALS.length],span=species.span[0]+rng()*(species.span[1]-species.span[0]);
      // Concentrate colonies densely onto the sub-cores; small peripheral encrusters hug core edges.
      const coreIdx=i<13?0:cores.length>1?(i<20?1:cores.length-1):0;
      const core=cores[coreIdx];
      let site=null;
      for(let attempt=0;attempt<75;attempt++){
       const a=yaw+rng()*Math.PI*2;
       const r=Math.pow(rng(),1.35)*(core.r+span*.35);
       const x=core.x+Math.cos(a)*r,z=core.z+Math.sin(a)*r,floor=ground(x,z),depth=water(x,z,true)-floor;
       if(depth<spec.min||depth>spec.max||slope(x,z)>.24||inSandChannel(x,z))continue;
       if(occupied.some(p=>Math.hypot(p.x-x,p.z-z)<(p.span+span)*.34))continue;
       site={x,z,floor,depth,y:floor-.022,kind:species.id,span,yaw:rng()*Math.PI*2,garden};break;
      }
      if(!site)continue;
      occupied.push(site);this.coralSites.push(site);
     }
     // Tuck sponges directly into sheltered reef-core crevices instead of bare open sand.
     for(let i=0;i<4;i++){
      const core=cores[i%cores.length];
      const a=yaw+i*2.399+rng()*.4,r=.38+rng()*.88,x=core.x+Math.cos(a)*r,z=core.z+Math.sin(a)*r,floor=ground(x,z);
      if(slope(x,z)<.22&&!inSandChannel(x,z))this.spongeSites.push({x,z,floor,depth:water(x,z,true)-floor,kind:SPONGES[(garden+i)%SPONGES.length],span:.12+rng()*.13,yaw:rng()*6.283,garden});
     }
     // Shell lag deposits collect in the sheltered rubble aprons beside each core.
     for(let i=0;i<spec.shells;i++){
       const core=cores[i%cores.length];
       const a=yaw+i*2.399+rng()*.45,r=core.r*.85+rng()*1.9,x=core.x+Math.cos(a)*r,z=core.z+Math.sin(a)*r;
       const floor=ground(x,z),depth=water(x,z,true)-floor;
       if(depth<1.15||depth>4.2||slope(x,z)>.25||inSandChannel(x,z))continue;
       const kind=depositShells[(garden*3+i)%depositShells.length];
       this.shellSites.push({x,z,floor,depth,embedFraction:.20+rng()*.26,kind,span:.065+rng()*.095,yaw:rng()*Math.PI*2,lean:.05+rng()*.18,garden});
     }
    }
    for(let i=0;i<18;i++){
     const p=pick(spec,center,this.shellSites,.30,120);if(!p)continue;
     this.shellSites.push({...p,kind:depositShells[i%depositShells.length],span:.045+rng()*.075,embedFraction:.2+rng()*.24,yaw:rng()*6.283,lean:rng()*.18,garden:-1});
    }
   }
   for(let i=0;i<spec.plants;i++){
    const meadow=i<spec.meadows,spacing=meadow?1.45:.75;
    const p=pick(spec,center,this.plants,spacing,210);if(!p)break;
    if(this.hardSites.some(h=>Math.hypot(h.x-p.x,h.z-p.z)<(meadow?1.55:1.0)))continue;
    const scale=(meadow?.92:.68)+rng()*(meadow?.34:.34),height=(meadow?.48:.32)*scale;
    if(height>p.depth-.28)continue;
    this.plants.push({...p,kind:meadow?'meadow':'clump',scale,stretch:meadow?.82+rng()*.35:.70+rng()*.25,yaw:rng()*Math.PI*2,marine:spec.marine,seed:rng(),patch:spec.id});
   }
   const batch=B.batches.nature;
   if(batch?.idx.length){
    // The lower sides are darkened where the real bed touches each stone.
    for(let i=0;i<batch.vcount;i++){
     const x=batch.pos[i*3],y=batch.pos[i*3+1],z=batch.pos[i*3+2],clear=Math.max(0,y-ground(x,z));
     const shade=.68+.32*Math.min(1,clear/.13);
     for(let c=0;c<3;c++)batch.tint[i*3+c]*=shade;
    }
    const geometry=batch.build(),mesh=new Mesh(geometry,app.shoreHabitats.material);
    mesh.name='Submerged pebbles '+spec.id;mesh.castShadow=false;mesh.receiveShadow=true;mesh.staticVelocity=true;
    this.group.add(mesh);this.rockPatches.push({id:spec.id,center,mesh,count:rocks.length,triangles:geometry.index.count/3});
   }
   this.patchCounts.push({id:spec.id,center:[center.x,center.z],stones:rocks.length,hardBases:this.hardSites.length-hardStart,plants:this.plants.length-plantStart,meadows:this.plants.slice(plantStart).filter(p=>p.kind==='meadow').length,corals:this.coralSites.length-coralStart,shells:this.shellSites.length-shellStart,depth:[spec.min,spec.max]});
  }
  this.batch=new ReefBatch('Sample benthic plants and hardbottom',[
   {geometry:createSeagrass(mulberry32(91827),0),shadow:false},
   {geometry:createMeadow(mulberry32(31982),0),shadow:false},
   {geometry:createMeadow(mulberry32(31982),1),shadow:false},
   {geometry:createMound(mulberry32(61907),1,'slab'),shadow:false},
  ],{maxInstances:Math.max(1,this.plants.length+this.hardSites.length)});
  this.view=createReefView();this.view.fields.position.value=new Vector3();
  const noise=createNoiseVolume(32,8,284611);
  this.material=createReefMaterials({hard:this.batch,soft:this.batch,getOcean:()=>app.fft,noise,view:this.view}).hard;
  this.group.add(this.batch.createMesh(this.material,{castShadow:false}));
  for(let i=0;i<this.plants.length;i++){
   const p=this.plants[i],half=p.yaw*.5,c1=p.marine?0x416b4a:0x455b3c,c2=p.marine?0x9b9161:0x88936d;
   this.batch.data.set([p.x,p.floor-.012,p.z,p.scale,0,Math.sin(half),0,Math.cos(half),c1,c2,43+p.seed,SURFACE.grass,p.kind==='meadow'?1.22:1,p.stretch,p.kind==='meadow'?1.22:1,p.marine?.17:.07],i*16);
  }
  for(const [i,p] of this.hardSites.entries()){
   const half=p.yaw*.5;
   this.batch.data.set([p.x,p.floor-(p.sink??.085),p.z,p.scale,0,Math.sin(half),0,Math.cos(half),0x898170,0x93857c,43+p.seed,SURFACE.rock,1,p.sy??.22,1,-.038],(this.plants.length+i)*16);
  }
  this.batch.upload();app.scene.add(this.group);this.update(app.camera);
  data.sampleBenthicDetails=this;
 }
 update(camera){
  const cp=camera.position;this.view.fields.position.value.copy(cp);this.view.fields.range.value=46;
  for(const p of this.rockPatches)p.mesh.visible=Math.hypot(cp.x-p.center.x,cp.z-p.center.z)<55&&Math.abs(cp.y-p.center.h)<35;
  this.batch.begin();this.visiblePlants=0;
  for(let i=0;i<this.plants.length;i++){
   const p=this.plants[i],d=Math.hypot(cp.x-p.x,cp.y-p.floor,cp.z-p.z);
   if(d>43)continue;this.batch.add(p.kind==='meadow'?(d<18?1:2):0,i);this.visiblePlants++;
  }
  for(let i=0;i<this.hardSites.length;i++){
   const p=this.hardSites[i],d=Math.hypot(cp.x-p.x,cp.y-p.floor,cp.z-p.z);
   if(d>43)continue;this.batch.add(3,this.plants.length+i);
  }
  this.batch.commit();
 }
 stats(){return {plants:this.plants.length,marinePlants:this.plants.filter(p=>p.marine).length,meadows:this.plants.filter(p=>p.kind==='meadow').length,visiblePlants:this.visiblePlants,hardbottomPieces:this.hardSites.length,coralSpecies:Object.fromEntries(CORALS.map(c=>[c.id,this.coralSites.filter(s=>s.kind===c.id).length])),shellSpecies:Object.fromEntries(SHELLS.map(id=>[id,this.shellSites.filter(s=>s.kind===id).length])),reefGardens:this.reefGardens,coralSites:this.coralSites,shellSites:this.shellSites,spongeSites:this.spongeSites,patches:this.patchCounts,pebbleTriangles:this.rockPatches.reduce((n,p)=>n+p.triangles,0),placement:'Reviewed coral colonies, shell lag deposits and sponges occupy the sheltered shelf beside an open sand channel'};}
}
