// Native Tidewater rock shapes/material/LOD; museum-authored cove composition.
import {Rocks} from '../vendor/tidewater/src/world/Rocks.js';
import {ROCK_STYLES} from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import {Vector3,Matrix4,Quaternion,Euler} from '../vendor/tidewater/src/engine/index.js';
export class CoveRocks extends Rocks{
 constructor(options){super({...options,colliders:null});this.submergedColliders=0;this.exposedColliders=0;
  this.classification={exposed:0,waterline:0,submerged:0};this.examples={};
  // Measure the actual native near geometry after its world transform, rather
  // than guessing that every style has the same 0.8m vertical extent.
  const p=new Vector3();
  for(const r of this.instances){
   const pos=this.buckets[r.style].near.geometry.attributes.position;let top=-Infinity,bottom=Infinity,radius=0;
   for(let i=0;i<pos.count;i++){p.set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(r.matrix);top=Math.max(top,p.y);bottom=Math.min(bottom,p.y);radius=Math.max(radius,Math.hypot(p.x-r.x,p.z-r.z));}
   Object.assign(r,{top,bottom,footRadius:radius});const category=top>-.25?'exposed':top> -1.45?'waterline':'submerged';this.classification[category]++;
   this.examples[category]??={x:r.x,z:r.z,top,bottom,ground:this.terrainData.heightAt(r.x,r.z),style:ROCK_STYLES[r.style].name};
   if(r.size<.9)continue;options.colliders?.addCylinder(r.x,r.z,radius*.72,bottom,top,{tag:category==='submerged'?'submerged cove rock':'shore rock'});
   if(category==='submerged')this.submergedColliders++;else this.exposedColliders++;
  }
  const shelf=this.terrainData.museumCove.continuous;
  shelf.divingSites=shelf.stations.map(s=>{
   const p=s.at(230),near=this.instances.filter(r=>r.size>=3&&r.top< -1.1&&Math.hypot(r.x-p[0],r.z-p[1])<480);
   const r=near.sort((a,b)=>Math.hypot(a.x-p[0],a.z-p[1])-Math.hypot(b.x-p[0],b.z-p[1]))[0];
   if(!r)return {id:s.id,point:p,gaze:[p[0]+s.normal[0]*12,-2.2,p[1]+s.normal[1]*12]};
   let x=r.x+s.normal[0]*(r.footRadius+4),z=r.z+s.normal[1]*(r.footRadius+4);
   if(this.terrainData.heightAt(x,z)> -3.1){for(let d=4;d<=48;d+=4){const px=x+s.normal[0]*d,pz=z+s.normal[1]*d;if(this.terrainData.heightAt(px,pz)<=-3.1){x=px;z=pz;break;}}}
   if(this.terrainData.heightAt(x,z)> -3.1){x=p[0];z=p[1];}
   return {id:s.id,point:[x,z],gaze:[r.x,Math.max(r.top-.5,-3.1),r.z],rock:{x:r.x,z:r.z,top:r.top,bottom:r.bottom}};
  });
 }
 stats(){return {...super.stats(),submergedColliders:this.submergedColliders,exposedColliders:this.exposedColliders,classification:this.classification,examples:this.examples,bounds:'actual transformed near-LOD vertices; waterline category -1.45 to -0.25m around mean sea -0.7m',placement:'fixed uneven coastal clusters; four native shapes/two shared LODs'};}
 _place(rand){
  const t=this.terrainData,cove=t.museumCove,out=[];if(!cove)return out;
  const add=(x,z,size,style,flat=1)=>{
   const st=ROCK_STYLES[style].scale,sx=size*(.82+rand()*.36),sy=size*(.75+rand()*.32)*flat,sz=size*(.8+rand()*.4);
   let g=t.heightAt(x,z);for(let a=0;a<7;a++)g=Math.min(g,t.heightAt(x+Math.cos(a)*size*.5,z+Math.sin(a)*size*.5));
   const y=g-sy*st[1]*.22,q=new Quaternion().setFromEuler(new Euler((rand()-.5)*.22,rand()*6.283,(rand()-.5)*.16));
   const matrix=new Matrix4().compose(new Vector3(x,y,z),q,new Vector3(sx,sy,sz));out.push({x,y,z,size,sy:sy/size,style,matrix,radius:Math.max(sx,sy,sz)*1.6});
  };
  // Asymmetrical groups leave the central wading/sand channel open.
  for(const shelf of cove.shelves){
   const groups=[[-.68,18,4.6],[-.43,72,3.3],[-.16,138,4.0],[.19,32,3.8],[.41,16,5.1],[.64,95,4.5],[.08,210,3.2]];
   for(const [along,d,size] of groups){
    const [x,z]=shelf.at(along*shelf.along,d);add(x,z,size,Math.floor(rand()*3),.75+rand()*.3);
    for(let i=0;i<4;i++){const a=rand()*6.283,r=size*(1.1+rand()*2.4);add(x+Math.cos(a)*r,z+Math.sin(a)*r,1+rand()*1.8,Math.floor(rand()*3),.65+rand()*.35);}
    for(let i=0;i<5;i++){const a=rand()*6.283,r=size*(1.4+rand()*3);add(x+Math.cos(a)*r,z+Math.sin(a)*r,.35+rand()*.7,Math.floor(rand()*3),.6);}
   }
  }
  // Continuous outer coast, with a sparse large-scale distribution. Native
  // distance/frustum buckets still submit only the visitor's neighbourhood.
  const occupied=new Map(),cell=160;
  const free=(x,z)=>{const i=Math.floor(x/cell),j=Math.floor(z/cell);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const q of occupied.get((i+a)+':'+(j+b))??[])if(Math.hypot(q[0]-x,q[1]-z)<135)return false;const key=i+':'+j;if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push([x,z]);return true;};
  for(const s of cove.continuous?.segments??[]){
   if(rand()>s.length/105)continue;
   const [nx,nz]=s.normal,along=(rand()-.5)*70,deep=rand()<.38,offshore=deep?155+rand()*270:8+rand()*110,x=s.point[0]+nx*offshore-nz*along,z=s.point[1]+nz*offshore+nx*along;
   const h=t.heightAt(x,z);if(h>-.55||h< -10||!free(x,z))continue;
   const emergent=!deep&&rand()<.36,size=emergent?5+rand()*4:deep?3.5+rand()*4.5:1.8+rand()*3.8;
   add(x,z,size,rand()<.2?3:Math.floor(rand()*3),.75+rand()*.35);
   const count=2+Math.floor(rand()*4);
   for(let k=0;k<count;k++){
    const a=rand()*6.283,r=4+rand()*size*2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,bed=t.heightAt(px,pz);
    if(bed>-.45||bed< -12)continue;
    add(px,pz,.6+rand()*2.2,Math.floor(rand()*3),.6+rand()*.35);
   }
  }
  return out;
 }
}
