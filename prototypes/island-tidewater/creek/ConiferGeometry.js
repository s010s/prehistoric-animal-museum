// Museum-authored conifer geometry. The original RGB textures are retained.
import * as T from '../vendor/tidewater/src/engine/index.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {decodeImage} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {uploadNeedleMips} from './NeedleMips.js';
const hash=(x,z)=>{let h=Math.imul(Math.floor(x*731),374761393)^Math.imul(Math.floor(z*193),668265263)^193706^Math.imul(71,1274126177);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
export const coniferTextures={};
export async function loadConiferTextures(){
 for(const [key,url,mime,format] of [
  ['needles',new URL('./assets/needle-spray-v1.png',import.meta.url),'image/png','rgba8unorm-srgb'],
  ['bark',new URL('./assets/fir-bark-albedo.webp',import.meta.url),'image/webp','rgba8unorm-srgb'],
  ['barkNormal',new URL('./assets/fir-bark-normal.webp',import.meta.url),'image/webp','rgba8unorm'],
 ]){
  const response=await fetch(url);if(!response.ok)throw Error('Original conifer texture unavailable: '+key);
  const image=await decodeImage(new Uint8Array(await response.arrayBuffer()),mime);
  coniferTextures[key]=new Texture({...image,format,mips:true,sampler:'anisoRepeat',usage:['sample','copyDst']});
  if(key==='needles')uploadNeedleMips(coniferTextures[key],image);
 }
}
export function coniferTemplate(seed=1,species=0,barkMaterial=null,needleMap=null,lod=0){
 const h=15+hash(seed,7)*4,verts=[],uv=[],colors=[],normals=[],indices=[]
 const crownStart=h*[.28,.48,.55,.18][species],crownWidth=[4.4,6.2,4.6,3.4][species],tiers=[12,9,9,14][species],branches=[]
 const UP=new T.Vector3(0,1,0);
 const addSegment=(a,b,rTop,rBot,sides)=>{
  const axis=b.clone().sub(a),len=axis.length();
  if(len<1e-4)return;
  const wood=new T.CylinderGeometry(rTop,rBot,len,sides,1);
  wood.applyQuaternion(new T.Quaternion().setFromUnitVectors(UP,axis.normalize()));
  wood.translate((a.x+b.x)*.5,(a.y+b.y)*.5,(a.z+b.z)*.5);
  branches.push(wood);
 };
 const append=(center,along,side,length,width,shade)=>{
  const idx=verts.length/3;
  const outward=center.clone().setY(0).normalize();outward.y=.45;outward.normalize();
  // Bent sprays retain a rounded silhouette and leaf-cluster normals in close view.
  const segments=lod?1:2;
  for(let j=0;j<=segments;j++)for(const v of [0,1]){
   const u=j/segments,p=center.clone().addScaledVector(along,(u-.5)*length).addScaledVector(side,(v-.5)*width);
   p.y+=Math.sin(u*Math.PI)*width*.17;
   const n=outward.clone().addScaledVector(side,(v-.5)*.28);n.y+=Math.sin(u*Math.PI)*.3;n.normalize();
   verts.push(p.x,p.y,p.z);colors.push(shade*.94,shade,shade*.88);uv.push(u,v);normals.push(n.x,n.y,n.z);
  }
  for(let j=0;j<segments;j++){const i=idx+j*2;indices.push(i,i+2,i+3,i,i+3,i+1);}
 }
 for(let tier=0;tier<tiers;tier++){
  const t=tier/tiers,baseY=crownStart+(t+(hash(tier,seed)-.5)*.055)*(h-crownStart);
  const reach=(species===1||species===2?Math.sin(Math.PI*(.22+t*.77))**.65:Math.pow(1-t,.85))*crownWidth+.1;
  const armCount=species===2?6:5;
  for(let arm=0;arm<armCount;arm++){
   if(hash(tier+seed*17,arm+55)<(species===1?.24:.14))continue;
   // Stagger each bough vertically and azimuthally to break spoke-wheel symmetry.
   const yOff=(hash(tier*13+arm,seed+29)-.5)*(h-crownStart)/tiers*.72;
   const y=Math.min(h-.35,Math.max(crownStart*.92,baseY+yOff));
   const a=arm*(Math.PI*2/armCount)+tier*2.399+seed+(hash(tier,arm)-.5)*1.12;
   const r=reach*(.58+hash(arm+seed,tier)*.62);
   const start=new T.Vector3(Math.sin(y*.14+seed)*.2,y,(seed%3-1)*y*.018);
   const radX=Math.cos(a),radZ=Math.sin(a),perpX=-radZ,perpZ=radX;
   const crook=(hash(tier+31,arm*7+seed)-.5)*.34;
   const droop=(species===2?-.22:.10*t-.20)*(1-t*.75)+(hash(tier,seed+arm)-.5)*.16;
   const upsweep=.12+t*.28+hash(arm+19,tier+seed)*.14;
   const mid=start.clone().add(new T.Vector3(radX*r*.48+perpX*r*crook*.55,r*droop*.55,radZ*r*.48+perpZ*r*crook*.55));
   const tip=start.clone().add(new T.Vector3(radX*r*.90+perpX*r*crook,r*(droop*.32+upsweep*.34),radZ*r*.90+perpZ*r*crook));
   const limb=species===2?2.45:1;
   const rBase=(.072*(1-t)+.014)*limb,rMid=rBase*.56,rTip=.011*limb;
   if(lod===1){
    addSegment(start,tip,rTip,rBase,3);
   }else if(!lod){
    addSegment(start,mid,rMid,rBase,species===2?4:4);
    addSegment(mid,tip,rTip,rMid,3);
    // Secondary lateral fork on thick lower/mid giant boughs breaks radial lines from underneath.
    if(species===2&&t<.72&&hash(tier*5+arm,seed+91)>.48){
     const fSign=hash(tier,arm+7)>.5?1:-1;
     const fa=a+fSign*(.48+hash(arm,tier+seed)*.38);
     const fTip=mid.clone().add(new T.Vector3(Math.cos(fa)*r*.38,r*(.06+t*.10),Math.sin(fa)*r*.38));
     addSegment(mid,fTip,rTip*.9,rMid*.72,3);
    }
   }
   // Evaluate curved bough spine for foliage clusters so sprays hug the drooping/upswept limb.
   const spine=u=>{
    const u1=1-u;
    return new T.Vector3(
     u1*u1*start.x+2*u1*u*mid.x+u*u*tip.x,
     u1*u1*start.y+2*u1*u*mid.y+u*u*tip.y,
     u1*u1*start.z+2*u1*u*mid.z+u*u*tip.z
    );
   };
   const clusterCount=lod>=2?3:4;
   for(let k=0;k<clusterCount;k++){
    const f=lod>=2?.26+k*.32:.24+k*.23,sideSign=k%2?1:-1;
    const center=spine(f);
    center.x+=perpX*sideSign*r*.16*(1-f*.55);
    center.z+=perpZ*sideSign*r*.16*(1-f*.55);
    center.y+=(hash(tier*7+k,arm+seed)-.5)*.38;
    const shootAngle=a+sideSign*(.34+hash(k+seed,tier+arm)*.54);
    const along=new T.Vector3(Math.cos(shootAngle),.06+hash(tier,k)*.20,Math.sin(shootAngle)).normalize();
    const length=(.38+r*.30)*(lod>=2?1.16:1),width=(.32+r*.21)*(lod>=2?1.12:1);
    const cardCount=species===2?(lod>=2?2:3):2;
    for(let card=0;card<cardCount;card++){
     const tilt=card*Math.PI/cardCount+hash(tier+arm,k)*.7;
     const across=new T.Vector3(-Math.sin(shootAngle)*Math.cos(tilt),Math.sin(tilt),Math.cos(shootAngle)*Math.cos(tilt));
     append(center,along,across,length,width,.44+f*.35+t*.18);
    }
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices)
 // Giants have deeper organic buttress flutes at the root collar; small conifers keep lean geometry.
 const trunk=new T.CylinderGeometry(species===2?.075:.028,species===2?.36:.22,h,species===2?11:7,species===2?10:5);
 const p=trunk.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const rawY=p.getY(i)+h*.5,y=species===2?h*(rawY/h)**2:rawY;
  const ang=Math.atan2(p.getZ(i),p.getX(i));
  const flare=1.+Math.exp(-y*(species===2?2.2:1.3))*(species===2?1.35:1.1);
  const rootRidge=species===2?Math.exp(-y*1.35)*.22*Math.max(0,Math.cos(ang*5+seed)+.35*Math.cos(ang*3-seed)):0;
  const flute=species===2?1+.085*Math.cos(ang*5+y*.18)+rootRidge:1;
  p.setXYZ(i,p.getX(i)*flare*flute+Math.sin(y*.14+seed)*.2,y,p.getZ(i)*flare*flute+(seed%3-1)*y*.018);
 }
 trunk.computeVertexNormals()
 const wood=mergeGeometries([trunk,...branches]);trunk.dispose();branches.forEach(g=>g.dispose());
 return {height:h,width:crownWidth*2,wood,leaves:g};
}

// Actual mesh/plane intersection, cached in the grove audit at startup. Root
// flare is not reported as the unflared cylinder's nominal diameter.
export function trunkSection(template,s,sy=1,height=1.3){
 const p=template.wood.attributes.position,ix=template.wood.index.array,y=height/(s*sy);let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
 for(let k=0;k<ix.length;k+=3)for(let e=0;e<3;e++){const a=ix[k+e],b=ix[k+(e+1)%3],ay=p.getY(a),by=p.getY(b);if((ay-y)*(by-y)>0||Math.abs(by-ay)<1e-8)continue;const t=(y-ay)/(by-ay);if(t<0||t>1)continue;const x=p.getX(a)+(p.getX(b)-p.getX(a))*t,z=p.getZ(a)+(p.getZ(b)-p.getZ(a))*t;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
 return {height,diameterX:(maxX-minX)*s,diameterZ:(maxZ-minZ)*s,method:'actual triangle section, no wind'};
}
