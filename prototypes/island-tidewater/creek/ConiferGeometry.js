// Museum-authored conifer geometry. The original RGB textures are retained.
import * as T from '../vendor/tidewater/src/engine/index.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {decodeImage} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {uploadNeedleMips} from './NeedleMips.js';
const hash=(x,z)=>{let h=Math.imul(Math.floor(x*731),374761393)^Math.imul(Math.floor(z*193),668265263)^193706^Math.imul(71,1274126177);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
export const coniferTextures={};
export async function loadConiferTextures(){
 for(const [key,url,mime] of [['needles',new URL('./assets/needle-spray-v1.png',import.meta.url),'image/png'],['bark',new URL('./assets/fir-bark-albedo.webp',import.meta.url),'image/webp']]){
  const response=await fetch(url);if(!response.ok)throw Error('Original conifer texture unavailable');
  const image=await decodeImage(new Uint8Array(await response.arrayBuffer()),mime);
  coniferTextures[key]=new Texture({...image,format:'rgba8unorm-srgb',mips:true,sampler:'anisoRepeat',usage:['sample','copyDst']});
  if(key==='needles')uploadNeedleMips(coniferTextures[key],image);
 }
}
export function coniferTemplate(seed=1,species=0,barkMaterial=null,needleMap=null,lod=0){
 const h=15+hash(seed,7)*4,verts=[],uv=[],colors=[],normals=[],indices=[]
 const crownStart=h*[.28,.48,.55,.18][species],crownWidth=[4.4,6.2,4.6,3.4][species],tiers=[12,9,9,14][species],branches=[]
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
  const t=tier/tiers,y=crownStart+(t+(hash(tier,seed)-.5)*.034)*(h-crownStart),reach=(species===1||species===2?Math.sin(Math.PI*(.22+t*.77))**.65:Math.pow(1-t,.85))*crownWidth+.1
  for(let arm=0;arm<(species===2?6:5);arm++){
   if(hash(tier+seed*17,arm+55)<(species===1?.22:.12))continue
   const a=arm*(species===2?1.0472:1.2566)+tier*2.399+seed+hash(tier,arm)*.65,r=reach*(.67+hash(arm+seed,tier)*.46)
   const start=new T.Vector3(Math.sin(y*.14+seed)*.2,y+hash(tier+seed,arm)*.65,(seed%3-1)*y*.018)
   const dir=new T.Vector3(Math.cos(a),(species===2?.25:-.12)-(1-t)*.12+hash(tier,seed+arm)*.2,Math.sin(a)).normalize()
   const limb=species===2?2.6:1;
   const tip=start.clone().addScaledVector(dir,r*.87),axis=tip.clone().sub(start),wood=new T.CylinderGeometry(.012*limb,(.07*(1-t)+.012)*limb,axis.length(),lod?3:5,1);
   wood.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize()));wood.translate(...start.clone().add(tip).multiplyScalar(.5).toArray());branches.push(wood);
   // Each branch carries small offset shoots. No single card spans a limb.
   for(let k=0;k<4;k++){
    const f=.24+k*.23,sideSign=k%2?1:-1;
    const center=start.clone().addScaledVector(dir,r*f);
    center.add(new T.Vector3(-Math.sin(a),0,Math.cos(a)).multiplyScalar(sideSign*r*.13*(1-f)));
    center.y+=(hash(tier*7+k,arm+seed)-.5)*.42;
    const shootAngle=a+sideSign*(.28+hash(k+seed,tier+arm)*.48);
    const along=new T.Vector3(Math.cos(shootAngle),.08+hash(tier,k)*.18,Math.sin(shootAngle)).normalize();
    const length=.36+r*.28,width=.30+r*.20;
    for(let card=0;card<(species===2?3:2);card++){
     const tilt=card*Math.PI/(species===2?3:2)+hash(tier+arm,k)*.7;
     const across=new T.Vector3(-Math.sin(shootAngle)*Math.cos(tilt),Math.sin(tilt),Math.cos(shootAngle)*Math.cos(tilt));
     append(center,along,across,length,width,.46+f*.33+t*.17);
    }
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices)
 // Giants have their own trunk/limb proportions; other templates are unchanged.
 const trunk=new T.CylinderGeometry(species===2?.075:.028,species===2?.35:.22,h,species===2?11:7,species===2?10:5);const p=trunk.getAttribute('position');for(let i=0;i<p.count;i++){const rawY=p.getY(i)+h*.5,y=species===2?h*(rawY/h)**2:rawY,flare=1.+Math.exp(-y*(species===2?2.8:1.3))*1.1,flute=species===2?1+.075*Math.cos(Math.atan2(p.getZ(i),p.getX(i))*5+y*.2):1;p.setXYZ(i,p.getX(i)*flare*flute+Math.sin(y*.14+seed)*.2,y,p.getZ(i)*flare*flute+(seed%3-1)*y*.018)}trunk.computeVertexNormals()
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
