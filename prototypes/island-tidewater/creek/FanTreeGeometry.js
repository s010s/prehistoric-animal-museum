// Museum-authored fan-leaved tree form, a visual proxy rather than a species ID.
// Individual geometric fans avoid importing the old high-frequency alpha cards.
import * as T from '../vendor/tidewater/src/engine/index.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
const rand=(a,b)=>{let h=Math.imul(a+17,374761393)^Math.imul(b+71,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
export function fanTreeTemplate(seed=63){
 const wood=[],pos=[],nor=[],uv=[],col=[],ix=[],up=new T.Vector3(0,1,0);
 const limb=(a,b,r0,r1)=>{const d=b.clone().sub(a),g=new T.CylinderGeometry(r1,r0,d.length(),6,1);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(up,d.normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());wood.push(g);};
 const stem=[new T.Vector3(0,0,0),new T.Vector3(.12,5,.05),new T.Vector3(-.08,10,.12),new T.Vector3(.18,15.9,-.1)];
 for(let i=0;i<3;i++)limb(stem[i],stem[i+1],.27*(1-i/3),.27*(1-(i+1)/3)+.022);
 const vertex=(p,n,u,v,shade)=>{pos.push(...p.toArray());nor.push(...n.toArray());uv.push(u,v);col.push(shade*.97,shade,shade*.88);return pos.length/3-1;};
 for(let b=0;b<18;b++){
  const a=b*2.39996+seed*.17,t=b/18,y=7.2+t*8.2,reach=2.2+Math.sin((t*.78+.17)*Math.PI)*2.1;
  const root=new T.Vector3(0,4.8+t*5.3,0),elbow=new T.Vector3(Math.cos(a)*reach*.58,y-1.1,Math.sin(a)*reach*.58),tip=new T.Vector3(Math.cos(a)*reach,y,Math.sin(a)*reach);limb(root,elbow,.105*(1-t*.55),.045);limb(elbow,tip,.045,.009);
  for(let c=0;c<6;c++){
   const ca=a+c*2.39996,center=elbow.clone().lerp(tip,(c+.5)/6).add(new T.Vector3(Math.cos(ca)*.85,(rand(b,c)-.4)*.9,Math.sin(ca)*.85));
   for(let l=0;l<10;l++){
    const la=ca+l*2.39996,n=new T.Vector3(Math.cos(la),.5+rand(l,b)*.7,Math.sin(la)).normalize(),right=new T.Vector3().crossVectors(up,n).normalize(),vUp=new T.Vector3().crossVectors(n,right).normalize();
    const rootLeaf=center.clone().add(new T.Vector3(Math.cos(la)*.4,(rand(c,l)-.5)*.5,Math.sin(la)*.4));
    const size=.24+rand(b*7+l,c+seed)*.15,shade=.62+t*.18+rand(l,c)*.17,base=vertex(rootLeaf,n,.5,0,shade),rim=[];
    for(let j=0;j<=5;j++){const q=-1.12+j*2.24/5,notch=1-.17*Math.exp(-q*q/.04),p=rootLeaf.clone().addScaledVector(right,Math.sin(q)*size).addScaledVector(vUp,(.16+Math.cos(q)*notch)*size);p.addScaledVector(n,Math.cos(q)*size*.1);rim.push(vertex(p,n,.5+Math.sin(q)*.5,.16+Math.cos(q)*.8,shade));}
    for(let j=0;j<5;j++)ix.push(base,rim[j],rim[j+1]);
   }
  }
 }
 const leaves=new T.BufferGeometry();leaves.setAttribute('position',new T.Float32BufferAttribute(pos,3));leaves.setAttribute('normal',new T.Float32BufferAttribute(nor,3));leaves.setAttribute('uv',new T.Float32BufferAttribute(uv,2));leaves.setAttribute('color',new T.Float32BufferAttribute(col,3));leaves.setIndex(ix);leaves.computeBoundingSphere();
 const branch=mergeGeometries(wood);wood.forEach(g=>g.dispose());return {height:17,width:12,wood:branch,leaves,leafKind:2};
}
