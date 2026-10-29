// Conservative full-wind envelopes for the fixed museum canopy templates.
export const CANOPY_LIGHT_LIMITS=Object.freeze({windSpeedMax:25,reviewWindAbsMax:1,windDirLengthMax:1.001,sinAbsMax:1.01,roundingMetres:.05,pixelMargin:2});
const finite=Number.isFinite,normalize=s=>String(s).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
const UNKNOWN=reason=>({known:false,reason,min:[-Infinity,-Infinity,-Infinity],max:[Infinity,Infinity,Infinity]});
const gamma=16*2**-24/(1-16*2**-24);
export function canopyFunction(code,name){
 const matches=[...code.matchAll(new RegExp('\\bfn\\s+'+name+'\\s*\\(','g'))];if(matches.length!==1)return null;
 const start=matches[0].index,open=code.indexOf('{',start);let depth=1;
 for(let i=open+1;i<code.length;i++){if(code[i]==='{')depth++;else if(code[i]==='}'&&!--depth)return normalize(code.slice(start,i+1));}
 return null;
}
const WIND=`fn creekTreeWindG(hf:f32,H:f32,seed:f32,g:f32,t:f32)->vec3f{
let w=vegWindStrength()*museumCanopy.wind;let ph=seed*6.2832;
let sway=(w*w*.023*(g*.8+.3)+sin(t*.9+ph)*w*.009*(g+.4))*H*hf*hf;
return vegWindDir3()*sway;}`;
const LEAF=`fn creekLeafWind(rest:vec3f,base:vec3f,hf:f32,H:f32,seed:f32,leaf:f32,g:f32,t:f32)->vec3f{
let trunk=creekTreeWindG(hf,H,seed,g,t);let w=vegWindStrength()*museumCanopy.wind;
let tip=smoothstep(.28,.92,hf)*min(leaf,1.0);let q=rest-base;let ph=seed*6.2832+q.x*.18+q.z*.23+q.y*.11;
let branch=sin(t*1.65+ph)*w*(.18+H*.008)*(.38+.62*g)*tip;
let flutter=sin(t*4.4+ph*2.1)*w*.052*tip;
return trunk+vegWindDir3()*branch+vegWindPerp3()*flutter;}`;
const ROOT=`fn creekRootContact(p:vec3f,base:vec3f,wood:f32,seed:f32)->vec3f{
var q=p;if(seed>=4.0&&wood<.5){let w=1.0-smoothstep(.8,6.0,max(0.0,p.y-base.y));q.y+=(terrainHeightAt(p.xz)-base.y-.06)*w;}return q;}`;
const VERTEX=`let variant=creekVariant(v.iDat.w);let keep=select(0.0,1.0,abs(v.aMat.w-variant)<0.1);
let base=v.iPos.xyz;let d=length(vegParams.camPos-base);let nd=museumNear(v.iDat.w);let limit=select(nd*(1.0+MUSEUM_LOD_BAND/2.0),nd*1.5,museumCanopy.mode==1.0);
let vis=select(0.0,1.0,museumCanopy.solo<.5||distance(base.xz,museumCanopy.probeXZ)<.05);
let p=(v.model*vec4f(v.position,1.0)).xyz;let gust=vegGustAt(base.xz);
let offset=creekLeafWind(p,base,v.aVeg.x,v.iDat.z,v.iDat.w,v.aMat.x,gust,frame.time);
v.useWorld=true;v.worldPos=base+(creekRootContact(p+offset,base,v.aMat.x,v.iDat.w)-base)*keep*vis;v.worldNormal=creekRootNormal(p+offset,base,vegInstanceNormal(v.model,v.normal),v.aMat.x,v.iDat.w);
v.prevWorldPos=base+(creekRootContact(p+creekLeafWind(p,base,v.aVeg.x,v.iDat.z,v.iDat.w,v.aMat.x,gust,frame.time-frame.dt),base,v.aMat.x,v.iDat.w)-base)*keep*vis;
o.vMat=v.aMat;o.vSeed=v.iDat.w;o.vDistance=d;o.vRoot=base;`;

export function auditCanopyLightMaterial(material){
 const modules=[],seen=new Set(),visit=m=>{if(!m||seen.has(m))return;seen.add(m);modules.push(m);for(const d of m.deps??[])visit(d);};material.modules.forEach(visit);
 const conifer=modules.find(m=>m.name==='museumConifer'),root=modules.find(m=>m.name==='museumGiantRootContact'),veg=modules.find(m=>m.name==='veg');
 if(!conifer||!root||!veg||normalize(material.vertex)!==normalize(VERTEX)||
  normalize(material.shadow)!==normalize('return in.vs.vMat.x<.5||in.vs.vMat.x>1.5||creekNeedleVisible(in.uv,in.P,in.V);')||
  canopyFunction(conifer.code,'creekTreeWindG')!==normalize(WIND)||canopyFunction(conifer.code,'creekLeafWind')!==normalize(LEAF)||
  canopyFunction(root.code,'creekRootContact')!==normalize(ROOT))return null;
 for(const [fn,body]of Object.entries({vegWindStrength:'return max(frame.windSpeed*0.1,0.03);',vegWindDir3:'return vec3f(frame.windDir.x,0.0,frame.windDir.y);',vegWindPerp3:'return vec3f(-frame.windDir.y,0.0,frame.windDir.x);'})){
  const code=canopyFunction(veg.code,fn);if(!code||!code.endsWith(normalize('{'+body+'}')))return null;
 }
 const gust=canopyFunction(veg.code,'vegGustAt');
 if(gust!==normalize(`fn vegGustAt(xz:vec2f)->f32{let p=xz-vegParams.gustOffset;
let n=textureSampleLevel(vegDetail,smpLinearRepeat,p/140.0,0.0).w*0.62+textureSampleLevel(vegDetail,smpLinearRepeat,p/61.0+0.37,0.0).w*0.38;
return smoothstep(0.46,0.6,n);}`))return null;
 const review=conifer.bindings.museumCanopy?.uniform,params=veg.bindings.vegParams?.uniform;
 if(!review?.fields.wind||!params?.fields.gustOffset)return null;
 return {conifer,root,veg,review,params,modules,signature:modules.flatMap(m=>[m,m.code,...m.deps])};
}

export function measureCanopyTemplate(geometry){
 const p=geometry.attributes.position,a=geometry.attributes.aVeg,m=geometry.attributes.aMat;
 if(!p||!a||!m||p.count!==a.count||p.count!==m.count||!p.count)return {known:false,reason:'unknown-template-attributes'};
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let hf=0,leafTip=0;
 for(let i=0;i<p.count;i++){
  const v=[p.getX(i),p.getY(i),p.getZ(i)],h=a.getX(i),leaf=m.getX(i);
  if(!v.every(finite)||!finite(h)||h<0||!finite(leaf)||leaf<0)return {known:false,reason:'nonfinite-or-unproved-template'};
  for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[k]);max[k]=Math.max(max[k],v[k]);}
  hf=Math.max(hf,h);leafTip=Math.max(leafTip,Math.min(leaf,1));
 }
 return {known:true,min,max,hf,leafTip,vertices:p.count,triangles:(geometry.index?.count??p.count)/3};
}

// Interval product of packed-f32 draw.model*instanceMatrix, then the local
// bounding box. gamma16 covers separate/fused multiply-add rounding at both
// stages; an extra fixed 5cm also covers the final base+(q-base) expression.
export function canopyInstanceEnvelope(template,instanceMatrix,iPos,iDat,objectMatrix,limits=CANOPY_LIGHT_LIMITS){
 if(!template.known)return UNKNOWN(template.reason);
 if(iDat[3]>=4)return UNKNOWN('giant-root-contact-unproved');
 const im=Array.from(instanceMatrix),obj=Array.from(objectMatrix,Math.fround),base=Array.from(iPos).slice(0,3);
 if(im.length!==16||obj.length!==16||![...im,...obj,...iPos,...iDat].every(finite)||
  [im,obj].some(m=>m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1))return UNKNOWN('nonfinite-or-nonaffine-matrix');
 const lo=[],hi=[];
 for(let col=0;col<4;col++)for(let row=0;row<3;row++){
  let value=0,abs=0;for(let k=0;k<4;k++){const x=obj[k*4+row]*im[col*4+k];value+=x;abs+=Math.abs(x);}
  const error=gamma*abs+1e-30;lo[col*3+row]=value-error;hi[col*3+row]=value+error;
 }
 const min=[],max=[];
 for(let row=0;row<3;row++){
  let low=lo[9+row],high=hi[9+row],abs=Math.max(Math.abs(low),Math.abs(high));
  for(let col=0;col<3;col++){
   const a=lo[col*3+row],b=hi[col*3+row],c=template.min[col],d=template.max[col],q=[a*c,a*d,b*c,b*d];
   low+=Math.min(...q);high+=Math.max(...q);abs+=Math.max(...q.map(Math.abs));
  }
  const error=gamma*abs+limits.roundingMetres;min[row]=low-error;max[row]=high+error;
 }
 const w=Math.max(limits.windSpeedMax*.1,.03)*limits.reviewWindAbsMax,H=Math.abs(iDat[2]),S=limits.sinAbsMax;
 const trunk=H*template.hf**2*(w*w*.023*1.1+S*w*.009*1.4);
 const branch=S*w*(.18+H*.008)*template.leafTip,flutter=S*w*.052*template.leafTip;
 const wind=(trunk+branch+flutter)*limits.windDirLengthMax*1.01+limits.roundingMetres;
 min[0]-=wind;max[0]+=wind;min[2]-=wind;max[2]+=wind;
 for(let k=0;k<3;k++){min[k]=Math.min(min[k],base[k]-limits.roundingMetres);max[k]=Math.max(max[k],base[k]+limits.roundingMetres);}
 if(![...min,...max,wind].every(finite))return UNKNOWN('nonfinite-envelope');
 return {known:true,reason:'full-template-full-wind-envelope',min,max,wind,trunk,branch,flutter};
}

// Orthographic native shadow camera. Only reject XY; ignoring near/far is
// intentionally conservative and avoids changing depth-bias/clip semantics.
export function prepareCanopyLightTest(viewProj,size,limits=CANOPY_LIGHT_LIMITS){
 const p=Array.from(viewProj,Math.fround);
 if(p.length!==16||!p.every(finite)||p[3]!==0||p[7]!==0||p[11]!==0||p[15]!==1||!finite(size)||size<=0)return ()=>-1;
 const margin=limits.pixelMargin*2/size+1e-5;
 return envelope=>{
 if(!envelope.known)return -1;
 for(let axis=0;axis<2;axis++){
  let low=p[12+axis],high=low,abs=Math.abs(low);
  for(let k=0;k<3;k++){const c=p[k*4+axis],a=c*envelope.min[k],b=c*envelope.max[k];low+=Math.min(a,b);high+=Math.max(a,b);abs+=Math.max(Math.abs(a),Math.abs(b));}
  const error=gamma*abs+1e-6;
  if(high+error < -1-margin)return axis*2;
  if(low-error > 1+margin)return axis*2+1;
 }
 return -1;
 };
}
export function canopyLightReject(envelope,viewProj,size,limits=CANOPY_LIGHT_LIMITS){
 return prepareCanopyLightTest(viewProj,size,limits)(envelope);
}
