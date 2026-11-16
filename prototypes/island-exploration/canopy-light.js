import {SUN_DIRECTION} from './lighting-config.js';
import * as T from 'three';
import {SIZE,terrainHeight} from './field.js';
// A fixed, coarse canopy footprint joins distant crowns to their forest floor.
// Near sunlight uses real shadow maps; this fills the area beyond that cascade.
const blank=new T.DataTexture(new Uint8Array([255,0,0,255]),1,1,T.RGBAFormat);blank.needsUpdate=true;
export const canopyLighting={value:blank};
export function bakeCanopyLighting(trees,templates){
 const [sunX,sunY,sunZ]=SUN_DIRECTION;
 const n=2048,metres=SIZE/n,data=new Uint8Array(n*n*4);for(let i=0;i<n*n;i++){data[i*4]=255;data[i*4+3]=255;}
 const stamp=(x,z,r,channel,value)=>{
  const px=(x/SIZE+.5)*n-.5,pz=(z/SIZE+.5)*n-.5,rp=Math.max(.8,r/metres);
  for(let j=Math.max(0,Math.floor(pz-rp-1));j<=Math.min(n-1,Math.ceil(pz+rp+1));j++)for(let i=Math.max(0,Math.floor(px-rp-1));i<=Math.min(n-1,Math.ceil(px+rp+1));i++){
   const d=Math.hypot(i-px,j-pz)/rp;if(d>=1.3)continue;const a=Math.max(0,Math.min(1,(1.3-d)/.65))*value,k=(j*n+i)*4+channel;
   data[k]=channel===0?Math.min(data[k],Math.round(255*(1-a))):Math.max(data[k],Math.round(255*a));
  }
 };
 for(const p of trees){const t=templates[p.species],radius=p.scale*t.width/t.height*.5*((p.sx??1)+(p.sz??1))*.5;
  stamp(p.x,p.z,radius,1,.85);
  const h=p.scale*.68;let dx=-(sunX/sunY)*h,dz=-(sunZ/sunY)*h;
  const delta=terrainHeight(p.x+dx,p.z+dz)-p.y;dx=-(sunX/sunY)*Math.max(0,h-delta);dz=-(sunZ/sunY)*Math.max(0,h-delta);
  stamp(p.x+dx,p.z+dz,radius*.9,0,.76);
 }
 const tx=new T.DataTexture(data,n,n,T.RGBAFormat);tx.minFilter=tx.magFilter=T.LinearFilter;tx.needsUpdate=true;canopyLighting.value.dispose();canopyLighting.value=tx;
}
