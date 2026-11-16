import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {hash} from './field.js';
// Fan-leaved canopy for visual diversity; an original procedural ginkgo proxy.
// Broad crowns, curved branch forks and leaf sprays use the same near/far mesh.
function fanTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');
 for(let k=0;k<68;k++){
  const a=k*2.39996,r=Math.sqrt(hash(k,12))*.43,x=256+Math.cos(a)*r*512,y=256+Math.sin(a)*r*512;
  const size=16+hash(k,73)*22,t=hash(k,47);c.save();c.translate(x,y);c.rotate(hash(k,91)*6.28);
  c.strokeStyle='#595a2c';c.lineWidth=1.8;c.beginPath();c.moveTo(0,11);c.lineTo(0,0);c.stroke();
  const gradient=c.createLinearGradient(0,0,0,-size);gradient.addColorStop(0,`rgb(${49+t*24},${76+t*31},${25+t*12})`);gradient.addColorStop(1,`rgb(${83+t*30},${116+t*35},${41+t*18})`);
  c.fillStyle=gradient;c.beginPath();c.moveTo(0,3);c.bezierCurveTo(-size*.7,-size*.18,-size*.72,-size*.65,-size*.45,-size);
  c.quadraticCurveTo(-size*.16,-size*1.16,0,-size*.82);c.quadraticCurveTo(size*.18,-size*1.16,size*.47,-size);
  c.bezierCurveTo(size*.75,-size*.65,size*.63,-size*.14,0,3);c.fill();
  c.strokeStyle='rgba(160,179,77,.27)';c.lineWidth=.7;
  for(let v=-3;v<=3;v++){c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(v*size*.08,-size*.4,v*size*.15,-size*.93);c.stroke();}c.restore();
 }
 const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;
}
export function ginkgoTemplate(seed,bark){
 const height=17,wood=[],verts=[],normals=[],uv=[],colors=[],indices=[];
 function limb(a,b,r1,r2){const d=b.clone().sub(a),g=new T.CylinderGeometry(r2,r1,d.length(),6,1);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());wood.push(g);}
 const stem=[new T.Vector3(0,0,0),new T.Vector3(.1,4,.05),new T.Vector3(-.18,7.5,.2),new T.Vector3(.32,11,-.12),new T.Vector3(.1,15,0)];for(let i=0;i<stem.length-1;i++)limb(stem[i],stem[i+1],.28*(1-i/4),.28*(1-(i+1)/4)+.025);
 for(let l=0;l<24;l++){
  const a=l*2.39996,y=9+hash(l,seed)*6,reach=(2.8+hash(l,12)*2.2)*(1-Math.max(0,y-13)*.12);
  const root=new T.Vector3(0,5.5+hash(l,41)*4.5,0),elbow=new T.Vector3(Math.cos(a)*reach*.55,y-2,Math.sin(a)*reach*.55),center=new T.Vector3(Math.cos(a)*reach,y,Math.sin(a)*reach);
  limb(root,elbow,.11,.065);limb(elbow,center,.065,.018);
  for(let card=0;card<14;card++){
   const theta=card*2.39996,ct=hash(l*31+card,seed)*2-1,st=Math.sqrt(1-ct*ct),out=new T.Vector3(Math.cos(theta)*st,ct*.78,Math.sin(theta)*st);
   const p=center.clone().addScaledVector(out,1.15+hash(card,l)*.8),n=out.clone().add(new T.Vector3(0,.32,0)).normalize();
   const right=new T.Vector3().crossVectors(n,new T.Vector3(0,1,0)).normalize(),up=new T.Vector3().crossVectors(right,n).normalize();
   const size=1.35+hash(l,card+91)*.85,start=verts.length/3,shade=.42+Math.max(0,out.y)*.42+hash(card,l)*.18;
   for(let j=0;j<=2;j++)for(let k=0;k<=2;k++){
    const u=k/2,v=j/2,q=p.clone().addScaledVector(right,(u-.5)*size).addScaledVector(up,(v-.5)*size).addScaledVector(n,(1-4*(u-.5)**2)*.14);
    const normal=n.clone().addScaledVector(right,(u-.5)*.25).normalize();verts.push(...q.toArray());normals.push(...normal.toArray());uv.push(u,v);colors.push(shade*.97,shade,shade*.89);
   }
   for(let j=0;j<2;j++)for(let k=0;k<2;k++){const i=start+j*3+k;indices.push(i,i+1,i+3,i+1,i+4,i+3);}
  }
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(verts,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);
 const branch=mergeGeometries(wood);wood.forEach(g=>g.dispose());
 return {height,width:13,parts:[{geometry:branch,material:bark.clone()},{geometry,material:new T.MeshStandardMaterial({map:fanTexture(),alphaTest:.4,alphaToCoverage:true,side:T.DoubleSide,vertexColors:true,roughness:.95})}]};
}
