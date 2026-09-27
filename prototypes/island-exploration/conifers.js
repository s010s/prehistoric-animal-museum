import * as T from 'three'
import {hash} from './world.js'
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
   c.strokeStyle=`rgb(${38+k*30},${51+k*40},${24+k*19})`;c.lineWidth=1.3+k
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
export function coniferTemplate(seed=1){
 const h=15+hash(seed,7)*4,verts=[],uv=[],colors=[],normals=[],indices=[]
 const crownStart=h*(.08+hash(seed,91)*.27),crownWidth=2.5+hash(seed,47)*1.6
 const append=(center,along,side,length,width,shade)=>{
  const idx=verts.length/3
  const outward=center.clone().setY(0).normalize();outward.y=1.8;outward.normalize()
  for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
   const p=center.clone().addScaledVector(along,(u-.5)*length).addScaledVector(side,(v-.5)*width)
   verts.push(p.x,p.y,p.z);colors.push(shade*.94,shade,shade*.88);uv.push(u,v);normals.push(outward.x,outward.y,outward.z)
  }
  indices.push(idx,idx+1,idx+2,idx,idx+2,idx+3)
 }
 for(let tier=0;tier<13;tier++){
  const t=tier/13,y=crownStart+t*(h-crownStart),reach=Math.pow(1-t,.7+hash(seed,6)*.65)*crownWidth+.1
  for(let arm=0;arm<5;arm++){
   if(hash(tier+seed*17,arm+55)<.10)continue
   const a=arm*1.2566+tier*2.399+seed+hash(tier,arm)*.65,r=reach*(.67+hash(arm+seed,tier)*.46)
   const start=new T.Vector3(Math.sin(y*.14+seed)*.2,y+hash(tier+seed,arm)*.65,(seed%3-1)*y*.018)
   const dir=new T.Vector3(Math.cos(a),-.12-(1-t)*.12+hash(tier,seed+arm)*.2,Math.sin(a)).normalize()
   // Denser outer foliage; inner woody gaps are small and uneven, not stacked discs.
   for(let k=0;k<2;k++){
    const f=.32+k*.45,center=start.clone().addScaledVector(dir,r*f)
    const length=r*(k===0?.95:.83)+.25,width=(.55+r*.51)*(k===0?.9:1)
    const tilt=(hash(tier+arm,seed+k)-.5)*.85
    const across=new T.Vector3(-Math.sin(a)*Math.cos(tilt),Math.sin(tilt),Math.cos(a)*Math.cos(tilt))
    append(center,dir,across,length,width,.72+f*.20+t*.09)
    if(k===1)append(center,dir,new T.Vector3(-Math.sin(a)*.55,.83,Math.cos(a)*.55),length*.92,width*.72,.73+f*.20)
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices)
 const trunk=new T.CylinderGeometry(.028,.22,h,7,5);const p=trunk.getAttribute('position');for(let i=0;i<p.count;i++){const y=p.getY(i)+h*.5;p.setXYZ(i,p.getX(i)+Math.sin(y*.14+seed)*.2,y,p.getZ(i)+(seed%3-1)*y*.018)}trunk.computeVertexNormals()
 return{height:h,width:crownWidth*2,parts:[{geometry:trunk,material:new T.MeshStandardMaterial({color:0x615543,roughness:1})},{geometry:g,material:new T.MeshStandardMaterial({map:texture,alphaTest:.36,side:T.DoubleSide,roughness:.93,vertexColors:true,color:0xd0d5ba})}]}
}
