// Native Tidewater rock shapes/material/LOD; museum-authored cove composition.
import {Rocks} from '../vendor/tidewater/src/world/Rocks.js';
import {ROCK_STYLES} from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import {bandFade} from '../vendor/tidewater/src/materials/LODFade.js';
import {Vector3,Matrix4,Quaternion,Euler} from '../vendor/tidewater/src/engine/index.js';
import {placePocketRocks} from './PocketBeaches.js';
import {setRefractionFrustum} from './RefractionFrustum.js';

const NEAR_DIST=60;
const FAR_DIST=700;
const BAND=.12;

export class CoveRocks extends Rocks{
 constructor(options){
  // SceneLighting directModulation already applies terrainSunShadowAt(P);
  // pass sunShadow:false so rocks are not double-darkened by hill shadows.
  super({...options,colliders:null,sunShadow:false});
  // Solid depth shadow pass: avoid Bayer screen-door holes in the 60–80 m LOD fade band.
  this.material.shadow='';
  this.material.needsUpdate=true;
  this._lastFocalX=NaN;this._lastFocalY=NaN;
  this.submergedColliders=0;this.exposedColliders=0;
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
 update(camera){
  const cam=camera.getWorldPosition(this._tmpV||(this._tmpV=new Vector3()));
  const proj=camera.projectionMatrix.elements;
  const moved=cam.distanceToSquared(this._lastCam)>1.0||!camera.quaternion.equals(this._lastQuat)||proj[0]!==this._lastFocalX||proj[5]!==this._lastFocalY;
  if(!moved)return;
  this._lastCam.copy(cam);this._lastQuat.copy(camera.quaternion);this._lastFocalX=proj[0];this._lastFocalY=proj[5];
  camera.updateMatrixWorld();
  setRefractionFrustum(this._frustum,camera,this._m4);
  const sph=this._sphere;
  for(const b of this.buckets){
   let nn=0,nf=0;
   const nl=b.near.geometry.attributes.iLod,fl=b.far.geometry.attributes.iLod;
   for(const r of b.members){
    const d=Math.hypot(r.x-cam.x,r.y-cam.y,r.z-cam.z);
    const dn=NEAR_DIST+r.size*6,df=FAR_DIST+r.size*60;
    const out=bandFade(d,df*(1-BAND),df);
    if(out>=1)continue;
    const t=bandFade(d,dn*(1-BAND/2),dn*(1+BAND/2));
    // Keep all shadow-casting near boulders submitted regardless of camera
    // facing so tall coastal rocks outside the view keep casting CSM shadows.
    if(t<1){
     nl.array[nn*2]=t;nl.array[nn*2+1]=1;
     b.near.setMatrixAt(nn++,r.matrix);
    }
    if(t>0){
     sph.center.set(r.x,r.y,r.z);sph.radius=r.radius;
     if(!this._frustum.intersectsSphere(sph))continue;
     fl.array[nf*2]=t*(1-out);fl.array[nf*2+1]=0;
     b.far.setMatrixAt(nf++,r.matrix);
    }
   }
   b.near.count=nn;b.far.count=nf;
   for(const [a,c] of [[nl,nn],[fl,nf]]){
    a.clearUpdateRanges();a.addUpdateRange(0,Math.max(1,c)*2);a.needsUpdate=true;
   }
   b.near.instanceMatrix.clearUpdateRanges();b.near.instanceMatrix.addUpdateRange(0,nn*16);b.near.instanceMatrix.needsUpdate=true;
   b.far.instanceMatrix.clearUpdateRanges();b.far.instanceMatrix.addUpdateRange(0,nf*16);b.far.instanceMatrix.needsUpdate=true;
  }
 }
 stats(){return {...super.stats(),submergedColliders:this.submergedColliders,exposedColliders:this.exposedColliders,classification:this.classification,examples:this.examples,bounds:'actual transformed near-LOD vertices; waterline category -1.45 to -0.25m around mean sea -0.7m',placement:'fixed uneven coastal clusters; four native shapes/two shared LODs; view-independent near shadow casters'};}
 _place(rand){
  const t=this.terrainData,cove=t.museumCove,out=[];if(!cove)return out;
  const add=(x,z,size,style,flat=1,strike)=>{
   const st=ROCK_STYLES[style].scale,sx=size*(.82+rand()*.36),sy=size*(.75+rand()*.32)*flat,sz=size*(.8+rand()*.4);
   let g=t.heightAt(x,z);for(let a=0;a<7;a++)g=Math.min(g,t.heightAt(x+Math.cos(a)*size*.5,z+Math.sin(a)*size*.5));
   const tilt=(rand()-.5)*.22,turn=rand(),roll=(rand()-.5)*.16;
   const y=g-sy*st[1]*.22,q=new Quaternion().setFromEuler(new Euler(tilt,strike==null?turn*6.283:strike+(turn-.5)*.32,roll));
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
  placePocketRocks(t,add);
  return out;
 }
}
