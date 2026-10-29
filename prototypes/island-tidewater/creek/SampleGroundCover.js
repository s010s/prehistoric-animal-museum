// A small, world-fixed ground-cover mask for the coast/creek sample. Like
// Tidewater's 2 m grass mask, this is baked once instead of running several
// noise octaves for every grass vertex and terrain fragment.
const RES=256, TEXEL=2, ORIGIN=[-1088,-128];
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const hash=(x,z,seed)=>{
 let h=(Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(seed,1442695041))|0;
 h=Math.imul(h^(h>>>13),1274126177);
 return ((h^(h>>>16))>>>0)/4294967295;
};
function noise(x,z,seed){
 const i=Math.floor(x),j=Math.floor(z),u=smooth(0,1,x-i),v=smooth(0,1,z-j);
 const a=hash(i,j,seed)*(1-u)+hash(i+1,j,seed)*u;
 const b=hash(i,j+1,seed)*(1-u)+hash(i+1,j+1,seed)*u;
 return a*(1-v)+b*v;
}

export function buildSampleGroundCover(enabled=true,terrain=null){
 if(!enabled)return {res:1,origin:ORIGIN,size:TEXEL,bytes:new Uint8Array([255,255,0,255]),stats:{enabled:false,res:1,texel:TEXEL,estimatedMipBytes:4}};
 if(typeof terrain?.heightAt!=='function')throw Error('Sample ground cover needs the composed terrain heightAt');
 const started=Date.now(),bytes=new Uint8Array(RES*RES*4),counts={bare:0,thin:0,thick:0,core:0,steep:0,graded:0,gentle:0};
 for(let j=0;j<RES;j++)for(let i=0;i<RES;i++){
  const x=ORIGIN[0]+(i+.5)*TEXEL,z=ORIGIN[1]+(j+.5)*TEXEL;
  // Two broad, independent displacements break the periodicity and prevent
  // circular bald spots or an 8 m vegetation-cell pattern.
  const wx=(noise(x/73,z/73,11)-.5)*16,wz=(noise(x/81+23,z/81-17,17)-.5)*16;
  const px=x+wx,pz=z+wz;
  const ax=px*.819+pz*.574,az=-px*.574+pz*.819;
  const bx=px*.389-pz*.921,bz=px*.921+pz*.389;
  const field=noise(ax/28,az/18,23)*.61+noise(bx/9.5,bz/7,29)*.31+noise(px/4.8,pz/6.1,31)*.08;
  const open=.035+.965*smooth(.42,.61,field);
  // The authored 80–120 m stretch is inside this soft, elongated reach;
  // the outer 30–50 m blend back to the untouched island habitat mask.
  const d=Math.hypot((x+832)/195,(z-128)/240);
  const reach=1-smooth(.72,.97,d),factor=1-reach*(1-open),k=(j*RES+i)*4;
  // Follow the final composed 1 m sample terrain, not the 32 m habitat map.
  // A 2 m central-difference span catches the authored cliff without
  // thresholding every small sand grain into a bald speck.
  let slopeKeep=1;
  if(reach>0){const dx=(terrain.heightAt(x+1,z)-terrain.heightAt(x-1,z))*.5,dz=(terrain.heightAt(x,z+1)-terrain.heightAt(x,z-1))*.5;
   slopeKeep=smooth(.42,.72,1/Math.hypot(1,dx,dz));}
  bytes[k]=Math.round(factor*255);bytes[k+1]=Math.round(slopeKeep*255);bytes[k+2]=Math.round(reach*255);bytes[k+3]=255;
  if(reach>.9){counts.core++;if(open<.18)counts.bare++;else if(open<.68)counts.thin++;else counts.thick++;
   if(slopeKeep<.02)counts.steep++;else if(slopeKeep>.98)counts.gentle++;else counts.graded++;}
 }
 return {res:RES,origin:ORIGIN,size:RES*TEXEL,bytes,stats:{enabled:true,res:RES,texel:TEXEL,origin:ORIGIN,size:RES*TEXEL,estimatedMipBytes:Math.ceil(bytes.byteLength*4/3),bakeMillis:Date.now()-started,coreTexels:counts.core,coreFractions:{bare:counts.bare/counts.core,thin:counts.thin/counts.core,thick:counts.thick/counts.core},coreSlopeFractions:{steep:counts.steep/counts.core,graded:counts.graded/counts.core,gentle:counts.gentle/counts.core},definition:'R: world-fixed warped 7–30 m clumps; G: composed-terrain slope survival Ny .42–.72; B: elliptical reach feather'}};
}
