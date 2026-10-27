// Own woodland design; native Tidewater instance LOD, semantic atlas and grass.
// Atlas/LOD/foliage shader contract: Tidewater4811ba48, MIT (see NOTICE).
import { Group, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Vector2, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { ShaderModule, UniformBlock } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { VegType } from '../vendor/tidewater/src/world/vegetation/InstanceLOD.js';
import { buildImpostorQuad } from '../vendor/tidewater/src/world/vegetation/Impostors.js';
import {MuseumImpostorAtlas} from './MuseumImpostorAtlas.js';
import {CreekGrass} from './CreekGrass.js';
import { vegModule, uCamPos, uGustOffset, UNDER_FERN_FADE } from '../vendor/tidewater/src/world/vegetation/VegNodes.js';
import { buildFern, UNDERSTORY } from '../vendor/tidewater/src/world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../vendor/tidewater/src/world/vegetation/VegMaterials.js';
import { G } from '../vendor/tidewater/src/core/Globals.js';
import { coniferTemplate, coniferTextures, trunkSection } from './ConiferGeometry.js';
import {fanTreeTemplate} from './FanTreeGeometry.js';
import {pilotVegetation} from '../island/plan.js';
import {GROVE,groveModule,groveWeight,grovePathDistance,groveOpening,grovePatch} from './GroveDesign.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {locateGroveHeroes,fillGroveStand} from './GrovePlanting.js';
import {sampleForestWeight,plantSampleForest} from './SampleForest.js';
import {GeometryCanopy,TREE_ATLAS_PIXELS} from './GeometryCanopy.js';
import {CanopyShadows,hasFixedCanopyShadow,fixedCanopyShadowWGSL} from './CanopyShadows.js';

const RANGE=65;
const review=new UniformBlock('MuseumCanopyReview',{coverage:['f32',.5],mode:['f32',0],wind:['f32',1],parallax:['f32',0],thinning:['f32',0],shade:['f32',0],shadows:['f32',1],fixedShadows:['f32',0],solo:['f32',0],pixelScale:['f32',1105],probeXZ:['vec2f',new Vector2(5.963828455,48.907625301)]},{label:'Museum canopy comparison'});
const shader=new ShaderModule({name:'museumConifer',deps:[vegModule],uniforms:review,uniformName:'museumCanopy',bindings:{creekNeedles:{texture:()=>coniferTextures.needles},creekBark:{texture:()=>coniferTextures.bark}},code:`
const MUSEUM_LOD_BAND:f32=.28;
fn museumNear(seed:f32)->f32{return select(65.0,190.0,seed>=4.0);}
fn museumTreeFar(H:f32,seed:f32,stretch:f32)->f32{return select(museumNear(seed),max(museumNear(seed)*4.0,H*museumCanopy.pixelScale/${TREE_ATLAS_PIXELS.toFixed(1)}),stretch<0.0);}
fn creekVariant(seed:f32)->f32{return select(floor(seed),select(0.0,1.0,seed>=.5),seed<1.0);}
fn creekInstanceTint(seed:f32)->vec3f{if(seed>=2.0){let t=fract(seed*7.3);return select(mix(vec3f(.90,.98,.82),vec3f(1.07,1.02,.83),t),mix(vec3f(.73,.85,.85),vec3f(.92,.97,.87),t),seed>=3.0);}return mix(vec3f(.74,.86,.94),vec3f(1.18,1.02,.74),fract(seed*7.3)*.65)*(.78+fract(seed*9.7)*.34)*select(vec3f(.86,.92,.92),vec3f(1.04,.94,.75),seed>=.5);}
fn creekTemplateAlbedo(uv:vec2f,leaf:f32,shade:f32)->vec3f {
 let needle=textureSample(creekNeedles,smpAnisoRepeat,uv).rgb*vec3f(0.94,1.0,0.88)*shade;
 let bark=textureSample(creekBark,smpAnisoRepeat,uv*vec2f(2.0,12.0)).rgb;
 let fan=vec3f(.095,.160,.043)*(.83+uv.y*.17)*shade;
 return select(bark,select(needle,fan,leaf>1.5),leaf>.5);
}
fn creekTreeWind(base:vec3f,hf:f32,H:f32,seed:f32,t:f32)->vec3f{
 let w=vegWindStrength()*museumCanopy.wind;let g=vegGustAt(base.xz);let ph=seed*6.2832;
 let sway=(w*w*0.009*(g*0.8+0.3)+sin(t*0.9+ph)*w*0.0045*(g+0.4))*H*hf*hf;
 return vegWindDir3()*sway;
}
fn creekNeedleSample(uv:vec2f)->vec4f{return textureSample(creekNeedles,smpAnisoRepeat,uv);}
fn creekNeedleVisible(uv:vec2f,P:vec3f,V:vec3f)->bool{
 // Coverage mips and both representations share the same cutoff. A bake's
 // tile position must never alter which needles exist; nor may a runtime
 // screen derivative make a fixed branch change identity while approaching.
 return creekNeedleSample(uv).a>=.36;
}
fn creekPackNormal(n0:vec3f)->vec2f{
 let n=n0/(abs(n0.x)+abs(n0.y)+abs(n0.z));var p=n.xz;
 if(n.y<0.0){p=(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0));}
 return p*.5+.5;
}
fn creekUnpackNormal(p0:vec2f)->vec3f{
 let p=p0*2.0-1.0;var n=vec3f(p.x,1.0-abs(p.x)-abs(p.y),p.y);
 if(n.y<0.0){let q=(1.0-abs(n.zx))*select(vec2f(-1.0),vec2f(1.0),n.xz>=vec2f(0.0));n.x=q.x;n.z=q.y;}
 return normalize(n);
}
`});

const canopyOutput=`
if(museumCanopy.shade==1.0){r.color=vec4f(s.albedo,1.0);}
if(museumCanopy.shade==2.0){r.color=vec4f(s.normal*.5+.5,1.0);}
if(museumCanopy.shade==3.0){r.color=vec4f(vec3f(s.ao),1.0);}
if(museumCanopy.shade==4.0){r.color=vec4f(s.translucency,1.0);}
if(museumCanopy.shade==5.0){r.color=vec4f(1.0);}
`;

function mergeParts(parts) {
  const packed=[],indices=[];
  for(const {geometry,leaf,height,variant} of parts){
    const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,c=geometry.attributes.color,base=packed.length/16;
    for(let i=0;i<p.count;i++){const shade=c?c.getY(i):.7,hf=Math.max(0,p.getY(i)/height),exposure=leaf>.5?Math.max(.45,Math.min(1,.55+(shade-.46)*.9)):Math.max(.35,Math.min(.85,.35+hf*.5));packed.push(p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i),uv.getX(i),uv.getY(i),leaf,exposure,shade,variant,hf,leaf*.7,leaf*.5,(i%19)/19);}
    const ix=geometry.index?.array??Array.from({length:p.count},(_,i)=>i);for(const v of ix)indices.push(v+base);
  }
  const geometry=new BufferGeometry(),buffer=new InterleavedBuffer(new Float32Array(packed),16);
  for(const [name,size,offset]of [['position',3,0],['normal',3,3],['uv',2,6],['aMat',4,8],['aVeg',4,12]])geometry.setAttribute(name,new InterleavedBufferAttribute(buffer,size,offset));
  geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
function bakeMaterial(normal) {
  return new Material({name:normal?'creek atlas oct-normal/leaf/exposure':'creek atlas original RGB',side:'double',lit:false,modules:[shader],attributes:{aMat:'vec4f'},varyings:{vMat:'vec4f',vLocalN:'vec3f'},vertex:'o.vMat=v.aMat;o.vLocalN=v.normal;',surface:'if(in.vs.vMat.x>.5&&in.vs.vMat.x<1.5&&creekNeedleSample(in.uv).a<.36){discard;}',output:normal?'r.color=vec4f(creekPackNormal(normalize(in.vs.vLocalN)),min(in.vs.vMat.x,1.0),in.vs.vMat.y);':`r.color=vec4f(creekTemplateAlbedo(in.uv,in.vs.vMat.x,in.vs.vMat.z),1.0);`});
}

// Same vertical-axis bounds contract as native Vegetation.axisSphere, measured
// over every vertex of both museum variants instead of a guessed frame width.
function canopyBounds(geometry){
 const p=geometry.attributes.position;let lo=Infinity,hi=-Infinity,rh=0,r=0;
 for(let i=0;i<p.count;i++){lo=Math.min(lo,p.getY(i));hi=Math.max(hi,p.getY(i));rh=Math.max(rh,Math.hypot(p.getX(i),p.getZ(i)));}
 const center=new Vector3(0,(lo+hi)*.5,0);
 for(let i=0;i<p.count;i++)r=Math.max(r,Math.hypot(p.getX(i),p.getY(i)-center.y,p.getZ(i)));
 return {center,radius:r*1.02,rh:rh*1.03,hv:(hi-lo)*.5*1.03,measured:{y:[lo,hi],horizontalRadius:rh,sphereRadius:r,vertices:p.count}};
}

export class CreekForest {
  constructor({scene,data,colliders,terrainGPU,engine}) {
    this.engine=engine;
    const {terrain,geography:g,field}=data;this.group=new Group();this.group.name='Museum creek woodland';review.fields.fixedShadows.value=field.continuousSample?1:0;
    for(const texture of Object.values(coniferTextures)){texture.getGPU();if(!texture.coverageMips)generateMipmaps(texture);}
    const templates=[coniferTemplate(3,0),coniferTemplate(11,1),fanTreeTemplate(),coniferTemplate(87,3),coniferTemplate(141,2)];
    const heroes=this.heroes=data.groveHeroes=locateGroveHeroes(data);
    const parts=templates.flatMap((t,variant)=>[{geometry:t.wood,leaf:0,height:t.height,variant},{geometry:t.leaves,leaf:t.leafKind??1,height:t.height,variant}]);
    const allGeometry=mergeParts(parts),nearGeometry=mergeParts(parts.filter(p=>p.variant<2)),variants=templates.map((_,i)=>mergeParts(parts.filter(p=>p.variant===i)));
    const bounds=this.bounds=canopyBounds(allGeometry),group={variants,...bounds};
    this.atlas=new MuseumImpostorAtlas([group,{variants:[],...bounds}],{albedo:bakeMaterial(false),normal:bakeMaterial(true)});
    const rootContact=new ShaderModule({name:'museumGiantRootContact',deps:[terrainGPU.module],code:`
fn creekRootContact(p:vec3f,base:vec3f,wood:f32,seed:f32)->vec3f{
 var q=p;if(seed>=4.0&&wood<.5){let w=1.0-smoothstep(.8,6.0,max(0.0,p.y-base.y));q.y+=(terrainHeightAt(p.xz)-base.y-.06)*w;}return q;
}
fn creekRootNormal(p:vec3f,base:vec3f,n:vec3f,wood:f32,seed:f32)->vec3f{
 let h=p.y-base.y;if(seed<4.0||wood>.5||h>=6.0){return n;}
 let t=clamp((max(0.0,h)-.8)/5.2,0.0,1.0);let w=1.0-t*t*(3.0-2.0*t);let dw=-6.0*t*(1.0-t)/5.2;
 let d=terrainHeightAt(p.xz)-base.y-.06;let e=.25;
 let gx=(terrainHeightAt(p.xz+vec2f(e,0.0))-terrainHeightAt(p.xz-vec2f(e,0.0)))/(2.0*e);
 let gz=(terrainHeightAt(p.xz+vec2f(0.0,e))-terrainHeightAt(p.xz-vec2f(0.0,e)))/(2.0*e);
 let ny=n.y/max(.2,1.0+d*dw);return normalize(vec3f(n.x-gx*w*ny,ny,n.z-gz*w*ny));
}
`});
    const near=new Material({name:'museum-conifer-near',side:'double',modules:[shader,rootContact],attributes:{iPos:'vec4f',iDat:'vec4f',aMat:'vec4f',aVeg:'vec4f'},varyings:{vMat:'vec4f',vSeed:'f32',vDistance:'f32',vRoot:'vec3f'},vertex:`
 let variant=creekVariant(v.iDat.w);let keep=select(0.0,1.0,abs(v.aMat.w-variant)<0.1);
 let base=v.iPos.xyz;let d=length(vegParams.camPos-base);let nd=museumNear(v.iDat.w);let limit=select(nd*(1.0+VEG_LOD_BAND/2.0),nd*1.5,museumCanopy.mode==1.0);let vis=select(0.0,1.0,d<limit&&museumCanopy.mode!=2.0&&(museumCanopy.solo<.5||distance(base.xz,museumCanopy.probeXZ)<.05));
 let p=(v.model*vec4f(v.position,1.0)).xyz;
 let offset=creekTreeWind(base,v.aVeg.x,v.iDat.z,v.iDat.w,frame.time);
 v.useWorld=true;v.worldPos=base+(creekRootContact(p+offset,base,v.aMat.x,v.iDat.w)-base)*keep*vis;v.worldNormal=creekRootNormal(p+offset,base,vegInstanceNormal(v.model,v.normal),v.aMat.x,v.iDat.w);
 v.prevWorldPos=base+(creekRootContact(p+creekTreeWind(base,v.aVeg.x,v.iDat.z,v.iDat.w,frame.time-frame.dt),base,v.aMat.x,v.iDat.w)-base)*keep*vis;
 o.vMat=v.aMat;o.vSeed=v.iDat.w;o.vDistance=d;o.vRoot=base;`,surface:`
 let leafKind=in.vs.vMat.x;let leaf=min(leafKind,1.0);let needlesVisible=creekNeedleVisible(in.uv,in.P,in.V);if(leafKind>0.5 && leafKind<1.5 && !needlesVisible){discard;}
 let fade=select(smoothstep(museumNear(in.vs.vSeed)*(1.0-VEG_LOD_BAND/2.0),museumNear(in.vs.vSeed)*(1.0+VEG_LOD_BAND/2.0),in.vs.vDistance),0.0,museumCanopy.mode==1.0);
 if(bayer4(in.pixel)<fade){discard;}
 s.albedo=creekTemplateAlbedo(in.uv,leafKind,in.vs.vMat.z)*creekInstanceTint(in.vs.vSeed);s.ao=mix(.4,1.0,in.vs.vMat.y);s.roughness=0.93;s.specularIntensity=0.12;
 let leafN=normalize(in.vs.normal);s.normal=normalize(leafN+in.V*0.12*leaf);s.translucency=vegTranslucency(s.albedo,leafN,0.35,in.P)*leaf*(.6+.4*in.vs.vMat.y);`,output:canopyOutput,shadow:`let needlesVisible=creekNeedleVisible(in.uv,in.P,in.V);if(in.vs.vMat.x>0.5 && in.vs.vMat.x<1.5 && !needlesVisible){return false;}let fade=select(smoothstep(museumNear(in.vs.vSeed)*(1.0-VEG_LOD_BAND/2.0),museumNear(in.vs.vSeed)*(1.0+VEG_LOD_BAND/2.0),in.vs.vDistance),0.0,museumCanopy.mode==1.0);return vegHash12(floor(in.P.xz*8.0)+vec2f(in.vs.vSeed*71.0,13.0))>=fade;`});
    const mid=near.clone();mid.name='museum-conifer-middle-geometry';
    mid.vertex=mid.vertex.replace('let limit=select(nd*(1.0+VEG_LOD_BAND/2.0),nd*1.5,museumCanopy.mode==1.0);','let limit=museumTreeFar(v.iDat.z,v.iDat.w,v.iDat.y)*(1.0+VEG_LOD_BAND/2.0);').replace('d<limit&&museumCanopy.mode!=2.0','d<limit&&d>nd*(1.0-VEG_LOD_BAND/2.0)&&museumCanopy.mode==0.0');
    mid.surface=mid.surface.replace('if(bayer4(in.pixel)<fade){discard;}',`let farFade=smoothstep(in.vs.vGeometryEnd*(1.0-VEG_LOD_BAND/2.0),in.vs.vGeometryEnd*(1.0+VEG_LOD_BAND/2.0),in.vs.vDistance);if(bayer4(in.pixel)>=fade||bayer4(in.pixel)<farFade){discard;}`);
    mid.varyings={...mid.varyings,vGeometryEnd:'f32'};mid.vertex+='\no.vGeometryEnd=museumTreeFar(v.iDat.z,v.iDat.w,v.iDat.y);';
    const far=this.atlas.createMaterial({isGroup1:()=> 'false',variantOf:seed=>`creekVariant(${seed})`,nearDist:()=>`museumTreeFar(iDat.z,iDat.w,iDat.y)`,colorOf:()=> `vec3f(bright,leaf,cr)`});
    far.modules.push(shader);
    const thinSeam='let thin = smoothstep( 140.0, 320.0, d );';
    if(!far.vertex.includes(thinSeam))throw Error('Native conifer thinning seam changed');
    far.vertex=far.vertex.replace(thinSeam,'let thin = smoothstep(140.0,320.0,d)*museumCanopy.thinning;')
      .replace('d >= ( museumTreeFar(iDat.z,iDat.w,iDat.y) ) * ( 1.0 - VEG_LOD_BAND / 2.0 )','museumCanopy.mode!=1.0 && (museumCanopy.mode==2.0 || d >= museumTreeFar(iDat.z,iDat.w,iDat.y)*(1.0-VEG_LOD_BAND/2.0))')
      .replace('let w = vegWindStrength();','let w = vegWindStrength()*museumCanopy.wind;')
      .replace('let k = s * vis * keep;','let isolate=select(0.0,1.0,museumCanopy.solo<.5||distance(base.xz,museumCanopy.probeXZ)<.05);let k=s*vis*keep*isolate;');
    far.surface=far.surface.replace('let fade = smoothstep( nd * ( 1.0 - VEG_LOD_BAND / 2.0 ), nd * ( 1.0 + VEG_LOD_BAND / 2.0 ), length( vegParams.camPos - base ) );','let fade = select(smoothstep(nd*(1.0-VEG_LOD_BAND/2.0),nd*(1.0+VEG_LOD_BAND/2.0),length(vegParams.camPos-base)),1.0,museumCanopy.mode==2.0);');
    // Atlas A is original linear RGB/coverage, B is oct-normal/leaf/crown exposure. Never
    // reinterpret RGB as brightness or multiply the baked colour a second time.
    const match=/let albedo = [^;]+;/;
    if(!match.test(far.surface))throw Error('Native atlas colour seam changed');
    far.surface=far.surface.replace(match,'let albedo=vA.rgb/cov*creekInstanceTint(iDat.w)*mix(1.0,mix(.26,1.0,clamp(ex,0.0,1.0)*clamp(ex,0.0,1.0)),museumCanopy.shadows);\n s.ao=mix(.4,1.0,clamp(ex,0.0,1.0));');
    far.surface=far.surface.replace('let nl = vB.xyz / max( vA.w, 1e-3 ) * 2.0 - 1.0;','let nl=normalize(vN.xyz/max(vN.w,.001));');
    // A quad's +Z normal is unrelated to the reconstructed foliage. Use the
    // same actual leaf normal for transmission and view-facing bias as near.
    far.surface=far.surface.replace('s.normal = normalize( nw + in.V * 0.12 );','s.normal=normalize(nw+in.V*.12*clamp(vB.z/cov,0.0,1.0));')
      .replace('s.translucency = vegTranslucency( albedo, in.N, 0.35, in.P );','s.translucency=vegTranslucency(albedo,nw,.35,in.P)*clamp(vB.z/cov,0.0,1.0)*(.6+.4*clamp(ex,0.0,1.0));');
    far.output=canopyOutput;
    // Previous pose uses the same rooted bend and height, not whole-quad sway.
    far.vertex+=`
let oldThin=smoothstep(140.0,320.0,length(frame.prevCameraPos-base))*museumCanopy.thinning;
 let oldS=iPos.w*(1.0+oldThin*.41421356237309515);let oldK=oldS*vis*keep*isolate;
 let oldCs=base+vec3f(0.0,Cy*oldS*sy,0.0);
 let oldToCam=normalize(frame.prevCameraPos-oldCs);let oldRight=normalize(cross(VEG_UP,oldToCam)+vec3f(1e-4,0.0,0.0));let oldUp=cross(oldToCam,oldRight);
 let oldTy=abs(oldToCam.y);let oldH=(Hv*sy*sqrt(max(1.0-oldTy*oldTy,0.0))+Rh*oldTy)*oldK;
 let oldP=oldCs+oldRight*(p.x*Rh*oldK)+oldUp*(p.y*oldH);
 v.prevWorldPos=oldP+creekTreeWind(base,clamp((oldP.y-base.y)/max(iDat.z,.01),0.0,1.15),iDat.z,iDat.w,frame.time-frame.dt);`;
    far.output+=`
#if PASS_MAIN
 let ip=in.vs.vIPos4;let id=in.vs.vIDat;let sy=abs(id.y);let yaw=id.x;
 let q=museumImpHit+vec3f(0.0,${bounds.center.y.toFixed(7)},0.0);
 let si=in.vs.vImp.w;let oldThin=smoothstep(140.0,320.0,length(frame.prevCameraPos-ip.xyz))*museumCanopy.thinning;
 let oldSi=ip.w*(1.0+oldThin*.41421356237309515);
 let local=q*vec3f(si,si*sy,si);let oldLocal=q*vec3f(oldSi,oldSi*sy,oldSi);
 let rest=ip.xyz+vec3f(local.x*cos(yaw)+local.z*sin(yaw),local.y,local.z*cos(yaw)-local.x*sin(yaw));
 let oldRest=ip.xyz+vec3f(oldLocal.x*cos(yaw)+oldLocal.z*sin(yaw),oldLocal.y,oldLocal.z*cos(yaw)-oldLocal.x*sin(yaw));
 let hf=clamp((rest.y-ip.y)/max(id.z,.01),0.0,1.15);let oldHf=clamp((oldRest.y-ip.y)/max(id.z,.01),0.0,1.15);
 let now=frame.viewProjNoJitter*vec4f(rest+creekTreeWind(ip.xyz,hf,id.z,id.w,frame.time),1.0);
 let old=frame.prevViewProjNoJitter*vec4f(oldRest+creekTreeWind(ip.xyz,oldHf,id.z,id.w,frame.time-frame.dt),1.0);
 r.velocity=vec4f((now.xy/now.w-old.xy/old.w)*vec2f(.5,-.5),0.0,1.0);
#endif`;
    // Keep three-view reconstruction throughout the near approach. Blend to
    // the sparse angular blend over a band instead of jumping at one range.
    const blendSeam='let blend = length( vegParams.camPos - base ) < 100.0;';
    if(!far.surface.includes(blendSeam))throw Error('Native atlas blend seam changed');
    far.surface=far.surface.replace(blendSeam,'let blend=length(vegParams.camPos-base)<max(220.0,museumNear(iDat.w)*2.2);');
    const sampleSeam='hit=s0[2]*w0+s1[2]*w1+s2[2]*w2;';
    far.surface=far.surface.replace(sampleSeam,sampleSeam+`
 let aw=museumAngularWeights(vec3f(w0,w1,w2));
 let dominantA=s0[0]*aw.x+s1[0]*aw.y+s2[0]*aw.z;
 let dominantB=s0[1]*aw.x+s1[1]*aw.y+s2[1]*aw.z;
 let single=smoothstep(max(150.0,museumNear(iDat.w)*1.6),max(220.0,museumNear(iDat.w)*2.2),length(vegParams.camPos-base));
 vA=mix(vA,dominantA,single);vB=mix(vB,dominantB,single);
 hit=mix(hit,s0[2]*aw.x+s1[2]*aw.y+s2[2]*aw.z,single);
 vN=mix(vN,s0[3]*aw.x+s1[3]*aw.y+s2[3]*aw.z,single);
`);
    far.surface=far.surface.replace('s.roughness = 0.85;','s.roughness = 0.93;');
    for(const m of [near,mid,far]){for(const k of ['vertex','surface','shadow'])if(typeof m[k]==='string')m[k]=m[k].replaceAll('VEG_LOD_BAND','MUSEUM_LOD_BAND');}far.surface=far.surface.replace('vA.w > 0.42','vA.w > museumCanopy.coverage');
    const shadowMaterial=near.clone();shadowMaterial.name='museum fixed geometry canopy shadow';
    const visibleSeam='let vis=select(0.0,1.0,d<limit&&museumCanopy.mode!=2.0&&(museumCanopy.solo<.5||distance(base.xz,museumCanopy.probeXZ)<.05));';
    if(!shadowMaterial.vertex.includes(visibleSeam))throw Error('Canopy shadow pose seam changed');
    shadowMaterial.vertex=shadowMaterial.vertex.replace(visibleSeam,'let vis=select(0.0,1.0,museumCanopy.solo<.5||distance(base.xz,museumCanopy.probeXZ)<.05);');
    shadowMaterial.shadow='return in.vs.vMat.x<.5||in.vs.vMat.x>1.5||creekNeedleVisible(in.uv,in.P,in.V);';
    near.shadow=`if(${fixedCanopyShadowWGSL}){return false;}\n`+near.shadow;
    const sourceRecords=[...g.trees,...(data.coast?.trees.filter(r=>{const d=Math.max(Math.abs(r.x),Math.abs(r.z)),t=Math.max(0,Math.min(1,(d-1500)/400)),k=t*t*(3-2*t);return r.seed<1-k*.66;})??[]),...(data.island?.trees.filter(r=>Math.max(Math.abs(r.x),Math.abs(r.z))>=1900)??[])],records=[];
    const speciesNames=['高针叶','疏冠针叶','扇叶树形','矮针叶','古杉巨木'];
    for(const original of sourceRecords){let choice=pilotVegetation(original.x,original.z,original.seed);
      if(field.continuousSample&&sampleForestWeight(original.x,original.z)>.25)continue;
      if(field.continuousSample&&field.continuousSample.weight(original.x,original.z)>.05){const f=field.sample(original.x,original.z);if(f[1]<3||terrain.heightAt(original.x,original.z)<f[0]+.8)continue;}
      const edge=groveWeight(original.x,original.z);
      if(edge>.05&&(grovePathDistance(original.x,original.z)<6.0||groveOpening(original.x,original.z)>.85||heroes.some(h=>Math.hypot(original.x-h.x,original.z-h.z)<13)))continue;
      if(edge>0&&original.seed<edge*.58)choice={variant:4,scale:2.0+original.seed*.85,keep:true};
      else if(edge>.6&&original.seed>.58&&original.seed<.88)choice={variant:original.seed<.74?0:1,scale:.27+(original.seed-.58)*1.4,keep:true};
      else if(original.heath>.4)choice={variant:3,scale:.38+original.seed*.4,keep:original.seed<.5};
      else if(original.marsh>.25)choice={variant:2,scale:.7+original.seed*.35,keep:original.seed<.42};
      else if(Math.max(Math.abs(original.x),Math.abs(original.z))>1900&&original.grass<.3&&original.seed>.76)choice={variant:2,scale:.86+original.seed*.2,keep:true};
      if(!choice.keep)continue;
      const variant=choice.variant,r={...original,s:original.s*choice.scale,seed:variant<2?original.seed:variant+original.seed*.999,variant};
      if(variant===4)r.s=(58+original.seed*35)/(templates[4].height*r.sy);
      records.push({...r,y:terrain.heightAt(r.x,r.z)-.08,la:r.yaw,l:r.sy,H:templates[variant].height*r.s*r.sy,qr:variant===4?GROVE.near+GROVE.margin:RANGE+16});
    }
    for(const h of heroes){const s=h.height/templates[4].height;records.push({...h,y:terrain.heightAt(h.x,h.z)-.08,s,sy:1,H:h.height,seed:4+h.seed,variant:4,la:h.yaw,l:1,qr:GROVE.near+GROVE.margin,landmark:true});}
    const stand=fillGroveStand(data,records,templates,heroes);
    this.sampleForest=plantSampleForest(data,templates,records);
    const protectedCore=sourceRecords.filter(r=>Math.max(Math.abs(r.x),Math.abs(r.z))<512),adaptedCore=records.filter(r=>Math.max(Math.abs(r.x),Math.abs(r.z))<512),coreByRoot=new Map(adaptedCore.map(r=>[r.x+','+r.z,r]));
    const corePreserved=protectedCore.length===adaptedCore.length&&protectedCore.every(a=>{const b=coreByRoot.get(a.x+','+a.z);return b&&b.seed===a.seed&&b.s===a.s&&b.sy===a.sy&&b.yaw===a.yaw&&b.variant===(a.seed<.5?0:1);});
    if(!corePreserved)throw Error('Ecology adaptation changed accepted creek core');
    this.ecologyAudit={corePreserved,coreOriginalTrees:protectedCore.length,coreCurrentTrees:adaptedCore.length,fixedStandTransitionMetres:[512,612],cameraThinning:false};
    for(const r of records){r.stableGeometry=!!field.continuousSample&&(r.sample||sampleForestWeight(r.x,r.z)>.02);if(r.stableGeometry)r.l=-Math.abs(r.sy);}
    const makeCanopy=(name,items,geometry,range=RANGE)=>new VegType(name,items,{nearRange:range,margin:range===GROVE.near?GROVE.margin:16,refreshDistance:6,sortNear:true,sortFar:false,farRefresh:64,near:[{geometry,material:near,castShadow:true,name:name+'-near'}],far:{parts:[{geometry:buildImpostorQuad(),material:far,name:name+'-far'}],fade:[3200,4000]}});
    // Keep the accepted two-template core pool intact. Extra forms have their
    // own near geometry, rather than adding their vertices to every old tree.
    this.canopies=[makeCanopy('museum conifers',records.filter(r=>r.variant<2),nearGeometry),... [2,3,4].map(i=>makeCanopy('museum '+speciesNames[i],records.filter(r=>r.variant===i),variants[i],i===4?190:RANGE))];
    this.canopy=this.canopies[0];this.types=[...this.canopies];
    const middleTemplates=[coniferTemplate(3,0,null,null,1),coniferTemplate(11,1,null,null,1),templates[2],coniferTemplate(87,3,null,null,1),coniferTemplate(141,2,null,null,1)];
    this.canopyShadows=middleTemplates.map((t,i)=>{const geometry=mergeParts([{geometry:t.wood,leaf:0,height:t.height,variant:i},{geometry:t.leaves,leaf:t.leafKind??1,height:t.height,variant:i}]);const items=field.continuousSample?records.filter(r=>hasFixedCanopyShadow(r)&&(r.seed<1?(r.seed>=.5?1:0):Math.floor(r.seed))===i):[];return new CanopyShadows('museum depth-only '+speciesNames[i],items,geometry,shadowMaterial);});
    this.types.push(...this.canopyShadows);for(const type of this.canopyShadows)for(const mesh of type.meshes)this.group.add(mesh);
    this.geometryCanopies=middleTemplates.map((t,i)=>{const geometry=mergeParts([{geometry:t.wood,leaf:0,height:t.height,variant:i},{geometry:t.leaves,leaf:t.leafKind??1,height:t.height,variant:i}]);const items=records.filter(r=>r.stableGeometry&&(r.seed<1?(r.seed>=.5?1:0):Math.floor(r.seed))===i);return new GeometryCanopy('museum middle '+speciesNames[i],items,geometry,mid,canopyBounds(geometry));});
    this.types.push(...this.geometryCanopies);for(const type of this.geometryCanopies)for(const mesh of type.meshes){mesh.renderOrder=1;mesh.underwaterLighting='none';mesh.material.underwaterLighting='none';this.group.add(mesh);}
    for(const type of this.canopies)for(const mesh of type.meshes){mesh.renderOrder=mesh===type.far.meshes[0]?2:1;mesh.underwaterLighting='none';mesh.material.underwaterLighting='none';this.group.add(mesh);}
    for(const r of records){let low=r.y;if(r.variant===4)for(let i=0;i<12;i++)low=Math.min(low,terrain.heightAt(r.x+Math.cos(i*Math.PI/6)*.86*r.s,r.z+Math.sin(i*Math.PI/6)*.86*r.s)-.1);colliders.addCylinder(r.x,r.z,(r.variant===4?.53:.24)*r.s,low,r.y+r.H,{tag:r.variant===4?'museum giant trunk':'museum tree trunk'});if(r.variant===4)colliders.addCylinder(r.x,r.z,.82*r.s,low,r.y+2.0,{tag:'museum giant root collar'});}
    this.species=speciesNames.map((name,i)=>({name,variant:i,instances:records.filter(r=>r.variant===i).length,nearGeometryTriangles:(i<2?nearGeometry:variants[i]).index.count/3}));
    this.atlasBudget={variants:templates.length,width:this.atlas.width,height:this.atlas.height,textureCount:2,framePixels:96,mipLevels:6,lastFrameAlignedMip:5,normalMipFilter:new URLSearchParams(location.search).get('atlasMips')==='box'?'box-oct diagnostic':'startup coverage-weight XYZ',angularHandover:"continuous sparse barycentric band .10; 1–3 views",normalViewMix:"decode each oct normal then coverage-weight XYZ",viewGrid:8,viewCoverage:"full sphere including crown undersides",depthParallax:"diagnostic only, off by default",coreNearGeometryUnchanged:true,giantTemplateHeightMetres:[Math.min(...records.filter(r=>r.variant===4).map(r=>r.H)),Math.max(...records.filter(r=>r.variant===4).map(r=>r.H))],giantNearToGeometryMetres:190,atlasTransitionHeightPixels:TREE_ATLAS_PIXELS,giantAtlasUsesNormalisedTreeBounds:true,channels:{A:"linear RGB and coverage",B:"oct-normal RG / leaf B / crown exposure A"},farCrownOcclusion:"native .26–1 exposure-squared compensation for absent crown self-shadow"};
    // Native procedural fern geometry, with our wet-forest placement only.
    const fernRecords=[];
    for(let i=0;i<records.length;i+=2){const r=records[i],x=r.x+(r.variant===4?5.5:2.5),z=r.z-1.7;if((Math.hypot(x,z)>245&&Math.hypot(x+600,z-630)>260&&groveWeight(x,z)<.15)||field.sample(x,z)[1]<1.4)continue;fernRecords.push({x,y:terrain.heightAt(x,z)-.03,z,s:.8+(r.seed%1)*.7,yaw:r.yaw,la:0,l:0,H:.05,seed:UNDERSTORY.FERN+(r.seed%1)*.999,qr:UNDER_FERN_FADE[1]+8});}
    const rng=mulberry32(611603);
    let forestFernCount=0;
    for(let i=0;i<26000&&forestFernCount<6000;i++){const a=rng()*Math.PI*2,rr=Math.sqrt(rng())*GROVE.outer,x=1400+Math.cos(a)*rr,z=-2120+Math.sin(a)*rr/GROVE.zScale,y=terrain.heightAt(x,z),f=field.sample(x,z),slope=Math.hypot(terrain.heightAt(x+1,z)-terrain.heightAt(x-1,z),terrain.heightAt(x,z+1)-terrain.heightAt(x,z-1))/2;
      if(groveWeight(x,z)<.3||grovePathDistance(x,z)<2.9||slope>.65||f[1]<1.2||heroes.some(h=>Math.hypot(x-h.x,z-h.z)<5.0)||rng()>grovePatch(x,z))continue;
      fernRecords.push({x,y:y-.035,z,s:1.0+rng()*1.0,sy:1,yaw:rng()*6.283,la:0,l:0,H:.05,seed:UNDERSTORY.FERN+rng()*.999,qr:UNDER_FERN_FADE[1]+8});forestFernCount++;
    }
    if(field.continuousSample){let count=0;for(let i=0;i<4000&&count<520;i++){
      const x=-812+rng()*195,z=-520+rng()*408,y=terrain.heightAt(x,z),f=field.sample(x,z),grade=Math.hypot(terrain.heightAt(x+1,z)-terrain.heightAt(x-1,z),terrain.heightAt(x,z+1)-terrain.heightAt(x,z-1))/2;
      if(rng()>sampleForestWeight(x,z)||f[1]<1.3||y<f[0]+.12||grade>.65||(field.continuousSample.forestRecords??[]).some(t=>Math.hypot(t.x-x,t.z-z)<(t.variant===4?1.8: .5)*t.s))continue;
      fernRecords.push({x,y:y-.03,z,s:.65+rng()*1.1,sy:1,yaw:rng()*6.283,la:0,l:0,H:.05,seed:UNDERSTORY.FERN+rng()*.999,qr:UNDER_FERN_FADE[1]+8});count++;
    }this.sampleForest.ferns=count;}
    const fernMat=createPlantLeafMaterial();fernMat.modules.push(groveModule);fernMat.surface+='\nlet groveTint=museumGroveWeight(in.P.xz);s.albedo*=mix(vec3f(1.0),vec3f(.72,.78,.65),groveTint);s.translucency*=1.0-groveTint*.35;s.roughness=max(s.roughness,.9);';
    const fern=new VegType('museum ferns',fernRecords,{fade:[105,125],margin:10,sortNear:true,near:[{geometry:buildFern(3).geometry,material:fernMat,castShadow:false,name:'creek-ferns'}]});
    this.types.push(fern);for(const mesh of fern.meshes)this.group.add(mesh);
    this.groveAudit={...stand,mature:records.filter(r=>r.variant===4).length,young:records.filter(r=>groveWeight(r.x,r.z)>.6&&r.variant<2&&r.H<24).length,heroes:records.filter(r=>r.landmark).map(r=>({x:r.x,y:r.y,z:r.z,height:r.H,DBH:trunkSection(templates[4],r.s,r.sy),collarDiameter:1.64*r.s})),nearRange:GROVE.near,visualEnd:GROVE.near*1.14,cpuQuery:GROVE.near+GROVE.margin,refreshAllowance:6,path:GROVE.path,forestFerns:fernRecords.filter(r=>groveWeight(r.x,r.z)>.3).length};
    this.grass=new CreekGrass({data,terrainGPU});
    for(const mesh of this.grass.meshes)this.group.add(mesh);
    this.group.updateMatrixWorld(true);scene.add(this.group);this.position=new Vector3();this.materials=[near,mid,far];this.records=records;this.review=review;this.reviewShadows=true;
  }
  update(dt,camera){
    if(!this.atlas.baked)this.atlas.bake(true);
    camera.updateMatrixWorld();camera.getWorldPosition(this.position);uCamPos.value.copy(this.position);
    const pixels=camera.projectionMatrix.elements[5]*this.engine.height*.5;review.fields.pixelScale.value=pixels;for(const t of this.geometryCanopies)t.pixelScale=pixels;
    const wind=G.windDir.value,speed=.7*G.windSpeed.value+1.5;uGustOffset.value.x+=wind.x*speed*dt;uGustOffset.value.y+=wind.y*speed*dt;
    for(const type of this.types)type.update(this.position,camera);
    this.grass.update(camera);
  }
  giantWindow(p){const t=this.canopies.find(t=>t.nearRange===GROVE.near);return this.heroes.map(h=>{let id=-1;for(let i=0;i<t.inst.count;i++)if(Math.abs(t.inst.px[i]-h.x)<.02&&Math.abs(t.inst.pz[i]-h.z)<.02){id=i;break;}let inPool=false;for(let k=0;k<t.near.count;k++)if(t.nearIds[k]===id)inPool=true;return {root:[h.x,h.z],distance:Math.hypot(p.x-h.x,p.y-t.inst.py[id],p.z-h.z),horizontal:Math.hypot(p.x-h.x,p.z-h.z),inPool,queryRadius:t.queryRadius,visualEnd:GROVE.near*1.14};});}
  setReview({mode,wind,parallax,thinning,solo,target,shadows,shade,coverage}){if(coverage!==undefined)review.fields.coverage.value=Number(coverage);if(mode!==undefined){review.fields.mode.value=Number(mode);for(const t of this.canopies){t.queryRadius=Number(mode)===1?t.nearRange*1.5+6:t.nearRange+(t.nearRange===GROVE.near?GROVE.margin:16);t.inst.qr2.fill(t.queryRadius*t.queryRadius);t.lastX=Infinity;}}if(shade!==undefined)review.fields.shade.value=Number(shade);if(wind!==undefined)review.fields.wind.value=wind?1:0;if(parallax!==undefined)review.fields.parallax.value=parallax?1:0;if(thinning!==undefined)review.fields.thinning.value=thinning?1:0;if(solo!==undefined)review.fields.solo.value=solo?1:0;if(target)review.fields.probeXZ.value.set(...target);if(shadows!==undefined&&shadows!==this.reviewShadows){this.reviewShadows=shadows;review.fields.shadows.value=shadows?1:0;for(const type of [...this.canopies,...this.canopyShadows])for(const mesh of type.near.meshes)mesh.castShadow=shadows;for(const m of this.materials){m.receiveShadows=shadows;m.needsUpdate=true;}}}
  stats(){return {geometryCanopy:this.geometryCanopies.map(t=>t.stats()),canopyShadows:this.canopyShadows.map(t=>t.stats()),canopyReview:{coverage:review.fields.coverage.value,shade:review.fields.shade.value,shadows:this.reviewShadows,mode:review.fields.mode.value,wind:review.fields.wind.value,parallax:review.fields.parallax.value,thinning:review.fields.thinning.value,solo:review.fields.solo.value,target:review.fields.probeXZ.value.toArray()},bounds:{center:this.bounds.center.toArray(),radius:this.bounds.radius,rh:this.bounds.rh,hv:this.bounds.hv,measured:this.bounds.measured},trees:this.records.length,grove:this.groveAudit,ecologyAudit:this.ecologyAudit,species:this.species,atlasBudget:this.atlasBudget,nearInstances:this.canopies.reduce((n,t)=>n+t.near.count,0),farInstances:this.canopies.reduce((n,t)=>n+t.far.count,0),nearTriangles:this.canopies.reduce((n,t)=>n+t.near.triangles,0),farTriangles:this.canopies.reduce((n,t)=>n+t.far.triangles,0),grass:this.grass.stats?.()??{patchTriangles:this.grass.patchTris},sameTemplateAtlas:true,colourSource:"original sRGB needle/bark and cool-warm palette; own analytic fan leaf; full RGB near/far",atlasBaked:this.atlas.baked,windVelocity:'rooted hf² bend shared with near geometry; reconstructed hit previous pose',atlasViewBlend:[150,220],needleCoverageMips:coniferTextures.needles.coverageMips,shadowFade:'sample: continuous fixed 3D canopy; outside sample: original world-anchored cells',palms:0};}
}
