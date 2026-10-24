import * as T from 'three'
import {hash} from './field.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
// Original branch atlas: dense overlapping secondary shoots, broken tips, and
// sun-facing needles. A visual proxy, not a botanical reconstruction.
function needleTexture(){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const c=canvas.getContext('2d');c.lineCap='round'
 function shoot(ax,ay,bx,by,width,id){
  const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len
  c.strokeStyle='#51422d';c.lineWidth=width;c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke()
  const count=Math.floor(len/2.8)
  for(let j=0;j<count;j++)for(const sign of [-1,1]){
   const t=j/count,x=ax+dx*t,y=ay+dy*t,k=hash(j+id*73,sign+9),size=(7+9*k)*(1-t*.45)
   c.strokeStyle=`rgb(${78+k*33},${103+k*34},${49+k*23})`;c.lineWidth=1.3+k
   c.beginPath();c.moveTo(x,y);c.lineTo(x+nx*size*sign+dx/len*7,y+ny*size*sign+dy/len*7);c.stroke()
  }
 }
 shoot(10,131,499,121,4,8)
 for(let twig=0;twig<16;twig++)for(const sign of [-1,1]){
  const rootX=24+twig*28,rootY=131-twig*.6,len=(95+hash(twig,4)*45)*(1-twig/23)
  const tipX=rootX+len*.58,tipY=rootY+sign*len*.68
  shoot(rootX,rootY,tipX,tipY,2,twig+sign*30)
  for(let j=1;j<5;j++){
   const t=j/5,x=rootX+(tipX-rootX)*t,y=rootY+(tipY-rootY)*t
   shoot(x,y,x+28+hash(j,twig)*20,y+sign*(12+hash(twig,j)*15),1,twig*10+j)
  }
 }
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture
}
const texture=needleTexture()
function barkTexture(){
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=512;const ctx=canvas.getContext('2d'),img=ctx.createImageData(128,512);
 for(let y=0;y<512;y++)for(let x=0;x<128;x++){
 const bend=Math.sin(y*.027+x*.12)*2.2+Math.sin(y*.071+x*.19)*1.7;
 const ridge=Math.pow(Math.max(0,Math.sin((x+bend)*1.13)),.35),grain=hash(x,y),patch=hash(Math.floor(x/7),Math.floor(y/36));
 const split=hash(Math.floor((x+bend)/4),Math.floor(y/23)),lichen=hash(Math.floor(x/11),Math.floor(y/17));const v=(58+ridge*45+grain*15+patch*18)*(split<.17?.60:1)+(lichen>.78?18:0),i=(y*128+x)*4;img.data[i]=v*1.06;img.data[i+1]=v*.91;img.data[i+2]=v*.73;img.data[i+3]=255;
 }ctx.putImageData(img,0,0);const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(2,4);map.anisotropy=8;return map;
}
const bark=barkTexture();
export function coniferTemplate(seed=1,species=0,barkMaterial=null,needleMap=null){
 const h=15+hash(seed,7)*4,verts=[],uv=[],colors=[],normals=[],indices=[]
 const crownStart=h*[.28,.48,.55,.18][species],crownWidth=[4.4,6.2,6.3,3.4][species],tiers=[12,9,9,14][species],branches=[]
 const append=(center,along,side,length,width,shade)=>{
  const idx=verts.length/3;
  const outward=center.clone().setY(0).normalize();outward.y=.45;outward.normalize();
  // Bent sprays retain a rounded silhouette and leaf-cluster normals in close view.
  for(let j=0;j<=2;j++)for(const v of [0,1]){
   const u=j/2,p=center.clone().addScaledVector(along,(u-.5)*length).addScaledVector(side,(v-.5)*width);
   p.y+=Math.sin(u*Math.PI)*width*.17;
   const n=outward.clone().addScaledVector(side,(v-.5)*.28);n.y+=Math.sin(u*Math.PI)*.3;n.normalize();
   verts.push(p.x,p.y,p.z);colors.push(shade*.94,shade,shade*.88);uv.push(u,v);normals.push(n.x,n.y,n.z);
  }
  for(let j=0;j<2;j++){const i=idx+j*2;indices.push(i,i+2,i+3,i,i+3,i+1);}

 }
 for(let tier=0;tier<tiers;tier++){
  const t=tier/tiers,y=crownStart+(t+(hash(tier,seed)-.5)*.034)*(h-crownStart),reach=(species===1||species===2?Math.sin(Math.PI*(.22+t*.77))**.65:Math.pow(1-t,.85))*crownWidth+.1
  for(let arm=0;arm<(species===2?6:5);arm++){
   if(hash(tier+seed*17,arm+55)<(species===1?.22:.12))continue
   const a=arm*(species===2?1.0472:1.2566)+tier*2.399+seed+hash(tier,arm)*.65,r=reach*(.67+hash(arm+seed,tier)*.46)
   const start=new T.Vector3(Math.sin(y*.14+seed)*.2,y+hash(tier+seed,arm)*.65,(seed%3-1)*y*.018)
   const dir=new T.Vector3(Math.cos(a),(species===2?.25:-.12)-(1-t)*.12+hash(tier,seed+arm)*.2,Math.sin(a)).normalize()
   const tip=start.clone().addScaledVector(dir,r*.87),axis=tip.clone().sub(start),wood=new T.CylinderGeometry(.012,.07*(1-t)+.012,axis.length(),5,1);
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
    for(let card=0;card<2;card++){
     const tilt=card*Math.PI/2+hash(tier+arm,k)*.7;
     const across=new T.Vector3(-Math.sin(shootAngle)*Math.cos(tilt),Math.sin(tilt),Math.cos(shootAngle)*Math.cos(tilt));
     append(center,along,across,length,width,.46+f*.33+t*.17);
    }
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices)
 const trunk=new T.CylinderGeometry(.028,.22,h,7,5);const p=trunk.getAttribute('position');for(let i=0;i<p.count;i++){const y=p.getY(i)+h*.5;p.setXYZ(i,p.getX(i)*(1.+Math.exp(-y*1.3)*1.1)+Math.sin(y*.14+seed)*.2,y,p.getZ(i)*(1.+Math.exp(-y*1.3)*1.1)+(seed%3-1)*y*.018)}trunk.computeVertexNormals()
 const wood=mergeGeometries([trunk,...branches]);trunk.dispose();branches.forEach(g=>g.dispose());
 return{height:h,width:crownWidth*2,parts:[{geometry:wood,material:barkMaterial??new T.MeshStandardMaterial({map:bark,bumpMap:bark,bumpScale:.055,color:0xc8bea5,roughness:1})},{geometry:g,material:new T.MeshStandardMaterial({map:needleMap??texture,alphaTest:.36,alphaToCoverage:true,side:T.DoubleSide,roughness:.93,vertexColors:true,color:0xffffff})}]}
}
