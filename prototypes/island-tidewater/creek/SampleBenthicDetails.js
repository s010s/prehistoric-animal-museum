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

const patches=[
 {id:'middle-creek',key:'midCreek',rx:9,rz:13,rocks:32,plants:28,meadows:0,marine:false,min:.65,max:2.8},
 {id:'log-pool',key:'logPool',rx:12,rz:15,rocks:35,plants:32,meadows:0,marine:false,min:.75,max:2.8},
 {id:'bend-pool',key:'bend',rx:12,rz:15,rocks:38,plants:38,meadows:0,marine:false,min:.75,max:2.8},
 {id:'silt-pool',key:'siltPool',rx:13,rz:16,rocks:42,plants:46,meadows:0,marine:false,min:.75,max:2.8},
 {id:'lower-creek',key:'lowerCreek',rx:17,rz:19,rocks:42,plants:42,meadows:0,marine:false,min:.65,max:3.0},
 {id:'brackish-mouth',key:'transition',rx:12,rz:10,rocks:23,plants:10,meadows:0,marine:false,min:.9,max:2.7},
 {id:'marine-mouth',key:'aeger',rx:27,rz:25,rocks:48,plants:51,meadows:26,hard:4,shells:22,marine:true,min:1.35,max:3.7},
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
    // A garden has many colony forms on broken carbonate, with sandy gaps
    // between gardens. Keep the central ebb channel open through the shelf.
    for(let cluster=0;cluster<spec.hard;cluster++){
     let anchor=pick({...spec,min:spec.id==='marine-mouth'?1.9:1.55,max:3.8,maxSlope:.18},center,this.reefGardens,8,420);
     if(spec.id==='marine-mouth'&&cluster===0){const x=-932,z=149,floor=ground(x,z),depth=water(x,z,true)-floor;if(depth>1.8&&depth<3.5&&slope(x,z)<.22)anchor={x,z,floor,depth};}
     if(!anchor)continue;
     const yaw=rng()*Math.PI*2,garden=this.reefGardens.length,occupied=[];
     this.reefGardens.push({...anchor,id:spec.id+'-'+cluster,patch:spec.id,radius:3.4});
     for(let i=0;i<26;i++){
      const species=CORALS[(garden*7+i)%CORALS.length],span=species.span[0]+rng()*(species.span[1]-species.span[0]);
      let site=null;
      for(let attempt=0;attempt<70;attempt++){
       const a=yaw+rng()*Math.PI*2,r=Math.sqrt(rng())*3.1,x=anchor.x+Math.cos(a)*r,z=anchor.z+Math.sin(a)*r,floor=ground(x,z),depth=water(x,z,true)-floor;
       if(depth<spec.min||depth>spec.max||slope(x,z)>.24||inSandChannel(x,z))continue;
       if(occupied.some(p=>Math.hypot(p.x-x,p.z-z)<(p.span+span)*.46))continue;
       site={x,z,floor,depth,y:floor-.012,kind:species.id,span,yaw:rng()*Math.PI*2,garden};break;
      }
      if(!site)continue;
      occupied.push(site);this.coralSites.push(site);
      // Colonies sit on separate partly buried crusts, whose footprints
      // follow their real base size instead of one large display plinth.
      if(span>.34)this.hardSites.push({x:site.x,z:site.z,floor:site.floor,scale:span*1.65,yaw:site.yaw,seed:rng(),patch:spec.id});
     }
     for(let i=0;i<3;i++){
      const a=yaw+i*2.399,r=1+rng()*2,x=anchor.x+Math.cos(a)*r,z=anchor.z+Math.sin(a)*r,floor=ground(x,z);
      if(slope(x,z)<.22&&!inSandChannel(x,z))this.spongeSites.push({x,z,floor,depth:water(x,z,true)-floor,kind:SPONGES[(garden+i)%SPONGES.length],span:.24+rng()*.24,yaw:rng()*6.283,garden});
     }
     // Ten shell shapes form denser lag deposits at the edge of each reef,
     // with smaller scattered shells in the intervening sand.
     for(let i=0;i<spec.shells;i++){
       const a=yaw+i*2.399+rng()*.35,r=2.4+rng()*2.8,x=anchor.x+Math.cos(a)*r,z=anchor.z+Math.sin(a)*r;
       const floor=ground(x,z),depth=water(x,z,true)-floor;
       if(depth<1.15||depth>4.2||slope(x,z)>.25||inSandChannel(x,z))continue;
       const kind=SHELLS[(garden*3+i)%SHELLS.length],upright=(kind==='hippurites'||kind==='radiolites')&&i%3===0;
       this.shellSites.push({x,z,floor,depth,embedFraction:.18+rng()*.26,kind,span:kind==='pinna'?.25+rng()*.15:.11+rng()*.17,yaw:rng()*Math.PI*2,lean:.05+rng()*.18,upright,garden});
     }
    }
    for(let i=0;i<18;i++){
     const p=pick(spec,center,this.shellSites,.30,120);if(!p)continue;
     this.shellSites.push({...p,kind:SHELLS[i%SHELLS.length],span:.09+rng()*.10,embedFraction:.2+rng()*.24,yaw:rng()*6.283,lean:rng()*.18,garden:-1});
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
   this.batch.data.set([p.x,p.floor-.040,p.z,p.scale,0,Math.sin(half),0,Math.cos(half),0x958b79,0x9f8c86,43+p.seed,SURFACE.rock,1,.30,1,-.025],(this.plants.length+i)*16);
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
 stats(){return {plants:this.plants.length,marinePlants:this.plants.filter(p=>p.marine).length,meadows:this.plants.filter(p=>p.kind==='meadow').length,visiblePlants:this.visiblePlants,hardbottomPieces:this.hardSites.length,coralSpecies:Object.fromEntries(CORALS.map(c=>[c.id,this.coralSites.filter(s=>s.kind===c.id).length])),shellSpecies:Object.fromEntries(SHELLS.map(id=>[id,this.shellSites.filter(s=>s.kind===id).length])),reefGardens:this.reefGardens,coralSites:this.coralSites,shellSites:this.shellSites,spongeSites:this.spongeSites,patches:this.patchCounts,pebbleTriangles:this.rockPatches.reduce((n,p)=>n+p.triangles,0),placement:'17 Vault coral forms in separated dense gardens, 10 shell shapes in lag deposits, sponges and seagrass beside an open sand channel; freshwater rooted clumps follow deepened pools'};}
}
