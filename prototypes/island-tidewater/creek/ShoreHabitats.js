// Own shore composition using native Tidewater procedural debris + materials
// (MIT, DRG Software Solutions). No village or man-made debris placement.
import {Mesh,Group} from '../vendor/tidewater/src/engine/index.js';
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {shell,stone,coralPiece,driftLog,seagrassWrack} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {createNatureMaterial} from '../vendor/tidewater/src/world/debris/NatureMaterial.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

export class ShoreHabitats{
 constructor({scene,data,terrainGPU,sites=data.hydrology.coasts}){
  this.group=new Group();this.group.name='Museum shore habitats';this.patches=[];
  const terrain=data.terrain,ground=(x,z)=>terrain.heightAt(x,z);
  this.material=createNatureMaterial(terrainGPU);
  for(let k=0;k<sites.length;k++){
   const site=sites[k],level=site.level??-.7,fresh=site.kind==='freshwater-shore',B=new Builder(),rand=mulberry32(6127+k*997),counts={shell:0,stone:0,coralFragment:0,driftwood:0,wrack:0},roots=[];
   for(let n=0;n<900;n++){
    const x=site.x+(rand()-.37)*110,z=site.z+(rand()-.5)*150,h=ground(x,z);
    const slope=Math.hypot(ground(x+1,z)-ground(x-1,z),ground(x,z+1)-ground(x,z-1))/2;
    if(h<level+.4||h>level+3.5||slope>.42)continue;
    const r=rand();
    if(!fresh&&r<.57&&counts.shell<85){shell(B,ground,x,z,.055+rand()*.13,rand,{type:rand()<.8?0:1});counts.shell++;}
    else if((r<.80||fresh)&&counts.stone<90){const s=.035+rand()*.11;stone(B,ground,x,z,s,s*.65,s*.8,rand,{palette:k===1?.25:.48,detail:0});counts.stone++;}
    else if(k===0&&r<.86&&counts.coralFragment<8){coralPiece(B,ground,x,z,.12+rand()*.16,rand,{bleach:.92});counts.coralFragment++;}
    roots.push({x,z,h});
   }
   // Drift lines and low rocks are composed by shore type. Logs use the native
   // ground-fitting emitter; no floating cylinders across the terrain.
   for(let n=0;n<250;n++){
    const x=site.x+(rand()-.25)*90,z=site.z+(rand()-.5)*110,h=ground(x,z);
    if(h<level+.8||h>level+3.3)continue;
    if((k===2||fresh)&&counts.driftwood<8){driftLog(B,ground,x,z,rand()*Math.PI,rand,{len:1.1+rand()*1.6,r0:.065,r1:.04});counts.driftwood++;}
    else if(!fresh&&counts.wrack<12){seagrassWrack(B,ground,x,z,.15+rand()*.2,rand,{dry:.8});counts.wrack++;}
   }
   // The rocky inlet has an exposed intertidal boulder apron. Shell beach and
   // estuary retain fine sediment; large rocks are not scattered over all coasts.
   if(k===1)for(let n=0;n<22;n++){
    const x=site.x-7+(rand()-.5)*20,z=site.z+(rand()-.5)*140,h=ground(x,z);
    if(h< -3.2||h>1.1)continue;const s=1.2+rand()*2.1;
    stone(B,ground,x,z,s,s*(.7+rand()*.35),s*.85,rand,{palette:.20+rand()*.16,detail:1,sink:.26,tilt:.15});counts.stone++;
   }
   for(let n=0;n<100;n++){
    const x=site.x-5-rand()*55,z=site.z+(rand()-.5)*120,h=ground(x,z);
    if(h>level-.1||h<level-13.3)continue;
    const s=(k===1?.45:.18)+rand()*(k===1?1.2:.5);
    stone(B,ground,x,z,s,s*(.35+rand()*.3),s*.8,rand,{palette:k===1?.15:.47,detail:1,sink:.35});counts.stone++;
   }
   if(!B.batches.nature?.idx.length)continue;
   // Per-vertex native contact occlusion, kept cheap for all tiny items.
   const batch=B.batches.nature;
   for(let i=0;i<batch.vcount;i++){const y=batch.pos[i*3+1],x=batch.pos[i*3],z=batch.pos[i*3+2],gap=Math.max(0,y-ground(x,z)),a=.65+.35*Math.min(1,gap/.16);for(let c=0;c<3;c++)batch.tint[i*3+c]*=a;}
   const geometry=batch.build(),mesh=new Mesh(geometry,this.material);mesh.name='Shore '+site.kind;mesh.staticVelocity=true;mesh.castShadow=false;mesh.receiveShadow=true;
   this.group.add(mesh);this.patches.push({site,mesh,counts,roots,triangles:geometry.index.count/3});
  }
  scene.add(this.group);
 }
 update(camera){for(const p of this.patches)p.mesh.visible=Math.hypot(camera.position.x-p.site.x,camera.position.z-p.site.z)<330&&Math.abs(camera.position.y-(p.site.level??-.7))<180;}
 stats(){return {placement:'fixed shoreline bands; native ground-fitting procedural shells/stone/wrack',patches:this.patches.map(p=>({id:p.site.id,kind:p.site.kind,counts:p.counts,triangles:p.triangles,visible:p.mesh.visible})),singleSharedMaterial:true};}
}
