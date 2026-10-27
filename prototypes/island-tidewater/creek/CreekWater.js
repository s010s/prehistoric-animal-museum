// Application adapters for Tidewater's native WaterSurface, refraction and
// underwater contracts (4811ba48, MIT, DRG Software Solutions LLC).
import { BufferGeometry, Float32BufferAttribute, Mesh, Sphere, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { ShaderModule, UniformBlock } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {MuseumWaterMaterial} from './MuseumWaterMaterial.js';
import { RefractionPass } from '../vendor/tidewater/src/ocean/RefractionPass.js';
import { Underwater } from '../vendor/tidewater/src/post/Underwater.js';
import { SceneLighting } from '../vendor/tidewater/src/materials/SceneLighting.js';
import { LAYERS } from '../vendor/tidewater/src/core/SceneRenderer.js';
import {creekFlowMap} from './CreekFlowMap.js';

export function installCreekLighting(field,terrain,clouds,ocean=null) {
  const deps=[field.module,terrain.module,clouds?.module].filter(Boolean);
  const direct=new ShaderModule({name:'creekDirect',deps:[...deps,ocean?.direct].filter(Boolean),code:`
fn hookDirectModulation(P:vec3f,N:vec3f)->vec3f {
 let inland=museumInlandLightWeight(P.xz);
 ${ocean?'if(inland<.001){return oceanhookDirectModulation(P,N);}':''}
 var atten=vec3f(1.0);
#if !IS_WATER && UNDERWATER_LIGHTING != 0
 if(inland>.001){
  let d=max(creekMeanAt(P.xz)-P.y,0.0);let grad=creekGradient(P.xz);
  let wn=normalize(vec3f(-grad.x,1.0,-grad.y));
  let up=-refract(-frame.sunDir,wn,1.0/1.333);
  atten=mix(vec3f(1.0),exp(-(frame.waterAbsorption+frame.waterScattering)*d/max(up.y,0.15)),smoothstep(0.0,0.08,d));
 }
#endif
#if HILL_SHADOW_SELF
 let hill=1.0;
#else
 let hill=terrainSunShadowAt(P);
#endif
 let river=atten*hill*${clouds?'cloudsShadow(P.xz)':'1.0'};
 ${ocean?'if(inland<.999){return mix(oceanhookDirectModulation(P,N),river,inland);}':''}
 return river;
}`});
  const ambient=new ShaderModule({name:'creekAmbient',deps:[field.module,ocean?.ambient].filter(Boolean),code:`
fn hookAmbientModulation(P:vec3f,N:vec3f)->vec3f {
 let inland=museumInlandLightWeight(P.xz);
 ${ocean?'if(inland<.001){return oceanhookAmbientModulation(P,N);}':''}
 var river=vec3f(1.0);
#if !IS_WATER && UNDERWATER_LIGHTING != 0
 if(inland>.001){let d=max(creekMeanAt(P.xz)-P.y,0.0);let a=exp(-(frame.waterAbsorption+frame.waterScattering)*d*1.2)*0.85+vec3f(0.0,0.02,0.04)*exp(-d*0.1);river=mix(vec3f(1.0),a,smoothstep(0.0,0.1,d));}
#endif
 ${ocean?'if(inland<.999){return mix(oceanhookAmbientModulation(P,N),river,inland);}':''}
 return river;
}`});
  const shadow=new ShaderModule({name:'creekShadowEntry',deps:[field.module,ocean?.shadowPos].filter(Boolean),code:`
fn hookShadowPosition(P:vec3f,N:vec3f,pixel:vec2f)->vec3f {
#if IS_WATER || UNDERWATER_LIGHTING == 0
 return P;
#else
 let inland=museumInlandLightWeight(P.xz);
 if(inland<.001){return ${ocean?'oceanhookShadowPosition(P,N,pixel)':'P'};}
 let h=creekMeanAt(P.xz);let d=h-P.y;if(d<=0.0){return P;}
 let grad=creekGradient(P.xz);let wn=normalize(vec3f(-grad.x,1.0,-grad.y));
 let up=-refract(-frame.sunDir,wn,1.0/1.333);
 var t=d/max(up.y-dot(grad,up.xz),0.15);
 for(var i=0;i<2;i++){let q=P+up*t;let e=creekMeanAt(q.xz)-q.y;t=max(0.0,t+e/max(up.y,0.15));}
 let river=P+up*t;
 ${ocean?'if(inland<.999){return mix(oceanhookShadowPosition(P,N,pixel),river,inland);}':''}
 return river;
#endif
}`});
  SceneLighting.set('directModulation',direct);SceneLighting.set('ambientModulation',ambient);SceneLighting.set('shadowPosition',shadow);
}

export class CreekRefraction extends RefractionPass {
  constructor(options,field){super(options);this.field=field;this.maxWaterY=Math.max(...field.g.waterRuns.flat().map(p=>p.level),...(field.island?.lakes.map(p=>p.level)??[]));this._defines={CREEK_REFRACTION:1};}
  render(){super.render(this.maxWaterY+.05);}
}
export function clipCreekRefraction(material,field) {
  if(material.userData?.creekClip)return;
  material.modules=[...(material.modules??[]),field.module];
  material.defines.MUSEUM_FULL_SUBMERGED_SHADING=1;
  material.surface+=`\n#if CREEK_REFRACTION\nlet clipField=creekFieldAt(in.P.xz);let clipInland=smoothstep(0.0,.2,clipField.x-frame.seaLevel)*(1.0-smoothstep(0.0,1.0,clipField.y));\nlet clipY=mix(frame.seaLevel+.4,clipField.x+.06,clipInland);if(in.P.y>clipY){discard;}\n#endif\n`;
  material.userData??={};material.userData.creekClip=true;material.needsUpdate=true;
}

// The native WaterMaterial remains the optical model. Only its inland-specific
// integration seams are adapted: flow coordinates, shallow opaque receivers,
// thin descending sheets and centimetre-scale contact filtering.
class RiverWaterMaterial extends MuseumWaterMaterial {
 _build(){
  super._build();this.varyings.vCreekFlow='vec4f';this.vertex+='\no.vCreekFlow=v.nodeData;';
  // Native SSR's two rejection tests use a flat sea. Inland rays use this
  // fragment's actual surface elevation instead (short screen-space rays).
  const helper=this.modules.find(m=>m.name==='waterHelpers');
  if(!helper||!helper.code.includes('frame.seaLevel'))throw Error('Pinned SSR helper seam changed');
  const inlandHelper=new ShaderModule({name:'creekWaterHelpers',deps:helper.deps,bindings:helper.bindings,code:helper.code.replaceAll('frame.seaLevel','y0').replace('k < 3','k < 7')});
  this.modules=this.modules.map(m=>m===helper?inlandHelper:m);
 }
 _shadeWGSL(options){
  let code=super._shadeWGSL(options);
  const replace=(a,b)=>{if(!code.includes(a))throw Error('Pinned river material seam changed: '+a);code=code.replace(a,b);};
  replace('let pos = in.P;','creekFlow=in.vs.vCreekFlow;\n let pos = in.P;');
  replace('pathLen = min( pathLen, crestT );',`pathLen=min(pathLen,crestT);
 let slopeY=normalize(in.vs.vShoreN).y;
 let sheet=max(creekFlow.w,0.025)*max(slopeY,0.05)/max(abs(dot(normalize(in.vs.vShoreN),Tv)),0.12);
 let sheetWeight=smoothstep(0.08,0.38,1.0-slopeY)*creekSheetFlag();
 pathLen=mix(pathLen,min(pathLen,sheet),sheetWeight);`);
  // A descending sheet can refract toward the rock behind it. The native sea
  // always bends this ray downwards; retain that rule on the horizontal river.
  replace('let Tv = normalize( vec3f( Tr.x, min( Tr.y, -0.08 ), Tr.z ) );',`let sheetView=creekSheetFlag()*smoothstep(0.08,0.38,1.0-normalize(in.vs.vShoreN).y);
 let Tv=normalize(mix(vec3f(Tr.x,min(Tr.y,-0.08),Tr.z),Tr,sheetView));`);
  return code;
 }
}

export function createCreekWater({scene,sky,clouds,sceneRenderer,field,terrain,refraction,query,foamTexture}) {
 const geometry=new BufferGeometry(),positions=[],nodes=[],indices=[],vertexMap=new Map();
 const n=field.g.waterRes,step=field.g.waterSize/n,half=field.g.waterSize/2;
 const runs=field.g.waterRuns, spring=runs[1];
 for(const run of [spring,...(field.northRuns??[]),...(field.headwater?[field.headwater.points]:[])]){let elapsed=0;for(let i=0;i<run.length;i++){if(i)elapsed+=Math.hypot(run[i].x-run[i-1].x,run[i].z-run[i-1].z)/Math.max(.2,(run[i].speed+run[i-1].speed)*.5);run[i]._travel=elapsed;}}
 // Offset the new chute's travel clock to the old run at its downstream
 // tie. The blend then joins phases, direction and speed continuously.
 let sourceTravelOffset=0;
 if(field.headwater){const end=field.headwater.points.at(-1);let best=Infinity;
  const run=field.northRuns[0];for(let i=1;i<run.length;i++){const a=run[i-1],b=run[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((end.x-a.x)*dx+(end.z-a.z)*dz)/L2)),d=Math.hypot(end.x-a.x-dx*t,end.z-a.z-dz*t);if(d<best){best=d;sourceTravelOffset=a._travel+(b._travel-a._travel)*t-end._travel;}}
 }
 const flowAt=(x,z)=>{
  const local=field.continuousSample;if(local&&local.sample(x,z)[1]<44)return local.flowAt(x,z);
  const mi=Math.max(0,Math.min(runs[0].length-1,Math.round((z-runs[0][0].z)/.5))),p=field.riverAt(z)??runs[0][mi];
  let c=[x-p.x,z/.38,0,1.5],best=Infinity;
  const east=field.tributarySource?.at(z);
  if(east&&Math.abs(x-east.x)<east.width+3){c=[x-east.x,z/.38,1,east.depth];}
  // These are authored source centreline coordinates, not a drifting world-XY
  // texture: travel time advects the pattern through bends and steep steps.
  const north=field.sourceCenter&&Math.max(Math.abs(x-field.sourceCenter[0]),Math.abs(z-field.sourceCenter[1]))<128;
  if(!north&&(Math.abs(x)>140||z< -140||z>20))return c;
  for(const run of north?field.northRuns:[spring])for(let i=1;i<run.length;i++){
   const a=run[i-1],b=run[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz;
   const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(.0001,L2))),qx=a.x+dx*t,qz=a.z+dz*t;
   const d=Math.hypot(x-qx,z-qz),w=a.width+(b.width-a.width)*t;
   if(d<best&&d<w+.8){best=d;c=[((x-qx)*dz-(z-qz)*dx)/Math.sqrt(Math.max(.0001,L2)),a._travel+(b._travel-a._travel)*t,1,a.depth+(b.depth-a.depth)*t];}
  }
  if(north&&field.headwater){const h=field.headwater,r=h.at(z);if(r&&Math.abs(x-r.x)<r.width+.8){const t=Math.max(0,Math.min(1,(z-h.origin.z-5.3)/1.2)),w=1-t*t*(3-2*t);c=[c[0]*(1-w)+(x-r.x)*w,c[1]*(1-w)+(r.travel+sourceTravelOffset)*w,1,c[3]*(1-w)+.09*w];}}
  return c;
 };
 const vertex=(i,j)=>{const key=j*n+i;if(vertexMap.has(key))return vertexMap.get(key);const x=-half+(i+.5)*step,z=-half+(j+.5)*step,k=positions.length/3;positions.push(x,0,z);nodes.push(...flowAt(x,z));vertexMap.set(key,k);return k;};
 const wet=(i,j)=>{const k=(j*n+i)*4;if(field.data[k+1]>.8)return false;const x=-half+(i+.5)*step,z=-half+(j+.5)*step;return field.data[k]>field.terrain.heightAt(x,z)-.15;};
 for(let j=1;j<n-2;j++)for(let i=1;i<n-2;i++)if(wet(i,j)||wet(i+1,j)||wet(i,j+1)||wet(i+1,j+1)){
  const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i,j+1),d=vertex(i+1,j+1);indices.push(a,c,b,b,c,d);
 }
 const fineTriangles=indices.length/3,fineVertices=positions.length/3;
 if(field.riverLayout){
  const l=field.riverLayout,crossings=28;
  const add=(r,u)=>{const x=r.x+u*(r.width+2),k=positions.length/3,c=flowAt(x,r.z);c[2]=-1;positions.push(x,0,r.z);nodes.push(...c);return k;};
  for(let j=0;j<l.riverCount-2;j++){
   const a=field.riverAt(l.riverStart+j*l.riverStep),b=field.riverAt(l.riverStart+(j+1)*l.riverStep);
   if(!a||!b||Math.max(a.level,b.level)<=-.2)continue;
   for(let i=0;i<crossings;i++){
    const u=i/crossings*2-1,v=(i+1)/crossings*2-1,x=(a.x+b.x)*.5+(u+v)*.25*(a.width+b.width+4),z=(a.z+b.z)*.5;
    if(Math.max(Math.abs(x),Math.abs(z))<250)continue;
    const h=(a.level+b.level)*.5;if(field.terrain.heightAt(x,z)>h+2)continue;
    const A=add(a,u),B=add(a,v),C=add(b,u),D=add(b,v);indices.push(A,C,B,B,C,D);
   }
  }
 }
 if(field.island){
  const vertexAt=(x,z,flag=-1)=>{const k=positions.length/3,f=flowAt(x,z);f[2]=flag;positions.push(x,0,z);nodes.push(...f);return k;};
  const grid=(cx,cz,rx,rz,step,flag=-1)=>{
   const ids=new Map(),get=(i,j)=>{const key=i+','+j;if(!ids.has(key))ids.set(key,vertexAt(cx-rx+i*step,cz-rz+j*step,flag));return ids.get(key);};
   const h=field.headwater?.origin,rect=h?[h.x-4,h.x+3,h.z-1.5,h.z+6.5]:null,eq=(a,b)=>Math.abs(a-b)<1e-6;
   for(let j=0;j<Math.ceil(rz*2/step);j++)for(let i=0;i<Math.ceil(rx*2/step);i++){
    const x0=cx-rx+i*step,z0=cz-rz+j*step,x1=x0+step,z1=z0+step,x=(x0+x1)/2,z=(z0+z1)/2,f=field.sample(x,z);
    if(f[1]>step*1.5||f[0]<=-.2)continue;
    if(flag===-3&&step>.2&&rect){
     if(x>rect[0]&&x<rect[1]&&z>rect[2]&&z<rect[3])continue;
     // Only split the edge touching the fine rectangle. A triangle fan joins
     // its 10cm vertices to unchanged coarse outer edges, so no T seam is
     // moved to the next ring and every shared edge has identical heights.
     const corners=[[x0,z0],[x0,z1],[x1,z1],[x1,z0]],border=[];let split=false;
     for(let k=0;k<4;k++){const a=corners[k],b=corners[(k+1)%4];border.push(a);
      const vertical=eq(a[0],b[0])&&(eq(a[0],rect[0])||eq(a[0],rect[1]))&&z0>=rect[2]-1e-6&&z1<=rect[3]+1e-6;
      const horizontal=eq(a[1],b[1])&&(eq(a[1],rect[2])||eq(a[1],rect[3]))&&x0>=rect[0]-1e-6&&x1<=rect[1]+1e-6;
      if(vertical||horizontal){split=true;for(let k=1;k<5;k++)border.push([a[0]+(b[0]-a[0])*k/5,a[1]+(b[1]-a[1])*k/5]);}
     }
     if(split){const c=vertexAt(x,z,flag),ring=border.map(p=>vertexAt(...p,flag));for(let k=0;k<ring.length;k++)indices.push(c,ring[k],ring[(k+1)%ring.length]);continue;}
    }
    const a=get(i,j),b=get(i+1,j),c=get(i,j+1),d=get(i+1,j+1);indices.push(a,c,b,b,c,d);
   }
  };
  const sc=field.sourceCenter;grid(sc[0],sc[1],128,128,.5,-3);
  const ec=field.tributarySource.center;grid(ec[0],ec[1],124,124,.5,-6);
  // Resolve the thin rock chute at 10cm; its height and extent still come from
  // the same authoritative CPU/WGSL source profile as terrain and swimming.
  const h=field.headwater.origin;grid(h.x-.5,h.z+2.5,3.5,4.0,.1,-3);

  for(const b of field.island.lakes)grid(b.center[0],b.center[1],b.rx*1.1,b.rz*1.1,6,-2);
  const m=field.island.marsh;grid(m.x,m.z,m.rx*1.1,m.rz*1.1,14,-4);
  const t=field.island.tributary;
  for(let j=0;j<t.length-1;j++)for(let i=0;i<16;i++){const a=t[j],b=t[j+1],u=i/8-1,v=(i+1)/8-1,x=(a[0]+b[0])*.5+(u+v)*.25*(a[2]+b[2]),z=(a[3]+b[3])*.5,f=field.sample(x,z);if(f[1]>2||f[0]<=-.2||terrain.terrain.heightAt(x,z)>f[0]+1)continue;const A=vertexAt(a[0]+u*(a[2]+2),a[3],-5),B=vertexAt(a[0]+v*(a[2]+2),a[3],-5),C=vertexAt(b[0]+u*(b[2]+2),b[3],-5),D=vertexAt(b[0]+v*(b[2]+2),b[3],-5);indices.push(A,C,B,B,C,D);}
 }
 if(field.continuousSample){
  const route=field.continuousSample.points,crossings=20;let previous=null;
  for(let j=0;j<route.length;j++){
   const p=route[j],a=route[Math.max(0,j-1)],b=route[Math.min(route.length-1,j+1)],dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz),nx=dz/L,nz=-dx/L,row=[];
   for(let i=0;i<=crossings;i++){
    const d=(i/crossings*2-1)*(p.width+1.5),x=p.x+nx*d,z=p.z+nz*d,k=positions.length/3,flow=field.continuousSample.flowAt(x,z);flow[2]=-7;positions.push(x,0,z);nodes.push(...flow);row.push(k);
   }
   if(previous)for(let i=0;i<crossings;i++)indices.push(previous[i],row[i],previous[i+1],previous[i+1],row[i],row[i+1]);previous=row;
  }
 }
 geometry.setAttribute('position',new Float32BufferAttribute(positions.slice(0,fineVertices*3),3));geometry.setAttribute('nodeData',new Float32BufferAttribute(nodes.slice(0,fineVertices*4),4));geometry.setIndex(indices.slice(0,fineTriangles*3));
 const params=new UniformBlock('CreekSurfaceParams',{slopeScale:['f32',.35],rippleScale:['f32',1]},{label:'Creek surface'});
 const flowMap=creekFlowMap(field);
 const module=new ShaderModule({name:'creekSurface',deps:[field.module,terrain.module],uniforms:params,uniformName:'waterSurface',bindings:{creekFoam:{texture:foamTexture},creekRapids:{texture:flowMap.texture}},code:`
var<private> creekFlow:vec4f;
fn creekSheetFlag()->f32{return select(max(creekFlow.z,0.0),1.0,abs(creekFlow.z+3.0)<.1||abs(creekFlow.z+6.0)<.1||abs(creekFlow.z+7.0)<.1);}
fn creekHash(p:vec2f)->f32{return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
// Value noise and its analytic gradient; no screen derivatives inside branches.
fn creekNoise(p:vec2f)->vec3f{
 let i=floor(p);let f=fract(p);let u=f*f*f*(f*(f*6.0-15.0)+10.0);let du=30.0*f*f*(f*(f-2.0)+1.0);
 let a=creekHash(i);let b=creekHash(i+vec2f(1.0,0.0));let c=creekHash(i+vec2f(0.0,1.0));let d=creekHash(i+vec2f(1.0));let k=a-b-c+d;
 return vec3f(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du*vec2f(b-a+k*u.y,c-a+k*u.x));
}
struct WaterSurfaceVertex {position:vec3f,lagXZ:vec2f,height:f32,depth:f32,foam:f32,shoreN:vec3f,shoreFoam:f32,swash:f32,surfMask:vec2f};
fn waterSurfaceVertex(node:vec4f,grid:vec2f)->WaterSurfaceVertex {
 let h=creekMeanAt(grid);let d=creekGradient(grid);var r:WaterSurfaceVertex;
 r.position=vec3f(grid.x,h,grid.y);r.lagXZ=grid;r.height=0.0;r.depth=max(h-terrainHeightAt(grid),0.0);r.foam=0.0;r.shoreN=normalize(vec3f(-d.x,1.0,-d.y));r.shoreFoam=0.0;r.swash=0.0;r.surfMask=vec2f(0.0);return r;
}
struct WaterSurfaceFrag {normal:vec3f,foam:f32,coverage:f32,slopes:vec2f,jacobian:f32,rough:f32,aeration:f32,gust:f32,slick:f32};
fn waterSurfaceFragment(lagXZ:vec2f,footprint:f32,depth:f32,vertexFoam:f32,shoreN:vec3f,shoreFoam:f32,extraFoam:f32,simState:vec4f,surfMask:vec2f,P:vec3f)->WaterSurfaceFrag {
 let f=creekFieldAt(lagXZ);if(f.y>=0.05||f.x<=frame.seaLevel+.5){discard;}
 let owner=museumWaterOwner(lagXZ);if(owner>.5&&abs(creekFlow.z+owner)>.25){discard;}
 let extent=max(abs(P.x),abs(P.z));
 if((creekFlow.z<-.5&&extent<254.0)||(creekFlow.z>=-.5&&extent>=254.0)){discard;}
 let grad=creekGradient(lagXZ);let speed=max(length(f.zw),0.2);
 // Travel time minus time is an advected scalar; a spatially varying
 // speed multiplier here would create ever-growing shear.
 let uv=vec2f(creekFlow.x,(creekFlow.y-frame.time)*0.38);
 let a=creekNoise(uv*vec2f(2.7,1.6));let b=creekNoise(uv*vec2f(8.3,4.7)+vec2f(13.2,4.6));let c=creekNoise(uv*vec2f(21.0,12.0)+vec2f(7.3,18.2));
 let bandA=1.0-smoothstep(0.1,0.6,footprint);let bandB=1.0-smoothstep(0.035,0.18,footprint);let bandC=1.0-smoothstep(0.012,0.065,footprint);
 let sheet=smoothstep(0.12,0.8,length(grad))*creekSheetFlag();
 let thread=creekNoise(uv*vec2f(13.0,0.65)+vec2f(21.0,8.0));
 let rip=waterSurface.rippleScale*smoothstep(.5,2.0,f.x-frame.seaLevel)*(a.yz*0.017*bandA+b.yz*0.010*bandB+c.yz*0.004*bandC+thread.yz*vec2f(.045,.009)*sheet*bandB)*mix(0.55,1.0,smoothstep(0.1,0.7,speed));
 let len=length(f.zw);let along=normalize(f.zw+vec2f(1e-4));let across=vec2f(along.y,-along.x);
 let slopes=grad+across*rip.x+along*rip.y;
 let mapUV=(lagXZ-vec2f(-72.0,-96.0))/96.0;
 let inside=select(0.0,1.0,all(mapUV>vec2f(0.0))&&all(mapUV<vec2f(1.0)));
 let source=textureSampleLevel(creekRapids,smpLinearClamp,mapUV,0.0)*inside;
 let springEnergy=museumSpringWhitewater(P,length(grad));
 let rapid=max(source.y,springEnergy.x);
 let landing=max(source.x,springEnergy.y);
 let riffle=source.z*(1.0-smoothstep(0.12,0.48,depth));
 // Native foam RGBA = foam coverage / bubbles / macro mottle / streaks.
 // The old blue-channel threshold displayed only the large mottle blobs.
 let tile=mix(vec2f(1.2,2.0),vec2f(.55,3.8),sheet);
 let foamTexels=f32(textureDimensions(creekFoam).x)/min(tile.x,tile.y);
 let cells=textureSampleLevel(creekFoam,smpAnisoRepeat,uv/tile,max(0.0,log2(footprint*foamTexels)));
 // Resolve bubbles near the visitor; distant fractional foam coverage must
 // not expose the repeating texture as rows of separate bright dots.
 let lace=mix(smoothstep(.40,.76,cells.r)*(.7+.3*cells.a),.28,smoothstep(.08,.3,footprint));
 let foam=clamp((rapid*.36+landing*1.1+riffle*.12)*lace+cells.g*landing*.22,0.0,.78);
 var r:WaterSurfaceFrag;r.normal=normalize(vec3f(-slopes.x,1.0,-slopes.y));r.foam=foam;r.coverage=1.0;r.slopes=slopes;r.jacobian=1.0;r.rough=0.35;r.aeration=rapid*0.15;r.gust=0.0;r.slick=0.0;return r;
}`});
 const surface={terrain,module,params};
 const material=new RiverWaterMaterial({surface,sky,sceneCopy:sceneRenderer.opaqueCopy,sceneDepthHalf:sceneRenderer.opaqueDepthHalf.texture,refraction});
 material.clouds=clouds;material.cameraWaterHeightNode=query.cameraState().x;material.params.ssr.value=1;material.params.roughness.value=.035;
 const mesh=new Mesh(geometry,material);mesh.name='Museum continuous creek and descending spring';mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.staticVelocity=true;mesh.layers.set(LAYERS.WATER);scene.add(mesh);
 // Cull the long river in 512m sections. Bounds use the displaced water height,
 // rather than the flat input grid at y=0; shared materials add no pipelines.
 const chunks=new Map();
 for(let i=fineTriangles*3;i<indices.length;i+=3){const key=Math.floor(positions[indices[i]*3]/512)+','+Math.floor(positions[indices[i]*3+2]/512);if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(...indices.slice(i,i+3));}
 const extensions=[];
 for(const [key,list]of chunks){const ids=new Map(),p=[],a=[],ix=[],points=[];
  for(const old of list){if(!ids.has(old)){ids.set(old,p.length/3);p.push(...positions.slice(old*3,old*3+3));a.push(...nodes.slice(old*4,old*4+4));points.push(new Vector3(positions[old*3],field.sample(positions[old*3],positions[old*3+2])[0],positions[old*3+2]));}ix.push(ids.get(old));}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('nodeData',new Float32BufferAttribute(a,4));g.setIndex(ix);g.boundingSphere=new Sphere().setFromPoints(points);g.boundingSphere.radius+=2;
  const m=new Mesh(g,material);m.name='Museum river section '+key;m.receiveShadow=true;m.staticVelocity=true;m.layers.set(LAYERS.WATER);scene.add(m);extensions.push(m);
 }
 return {surface,material,mesh,extensions,stats:()=>({triangles:indices.length/3,fineTriangles,extensionTriangles:indices.length/3-fineTriangles,riverSections:extensions.length,sectionCulling:'512m sections with actual displaced height bounds',mainRiverMetres:field.riverLayout?(field.riverLayout.riverCount-1)*field.riverLayout.riverStep:512,runs:runs.length+(field.northRuns?.length??0),inlandAreas:field.island?['creek','headwater','lake','tarn','tributary','wetland']:['creek'],continuousMesh:true,sloped:true,meanGeometryDisplacement:0,headwater:field.headwater.revision,sourceTravelOffset,sourceMeshBoundary:"10cm/50cm conforming shared-edge triangle fans",debugMode:material.debugMode.value,rippleScale:params.fields.rippleScale.value,normalRipples:'filtered aperiodic travel coordinates; stretched sheet threads',whitewater:{method:flowMap.method,res:flowMap.res,active:flowMap.active,nativeFoamChannels:'R coverage / G bubbles / A streaks'},ssr:'native screen-space rays, local elevation rejection; off-screen fallback sky',pathLegacy:material.depthReview.fields.pathLegacy.value,refraction:'native guard-band with local creek / sea clip; inclined sheet refraction',underwater:true,underReflection:'15 bounded terrain steps / 4 refinements; deep scatter beyond 32–58m, no off-screen objects'})};
}

// Native medium/meniscus/composite, with a bounded integral through the actual
// sloping inland volume; the sea keeps the native analytic integral.
export class CreekUnderwater extends Underwater {
  _shaftCode(){return super._shaftCode().replace('let steps = 20;', 'if(!creekContains(underwaterParams.camPos.xz)){\n let steps = 20;').replace('shafts = shafts * sunE * sigS * phase * underwaterParams.shafts * 2.5;', 'shafts = shafts * sunE * sigS * phase * underwaterParams.shafts * 2.5;\n }');}

  _compositeCode(){
    let code=super._compositeCode();
    const end=code.indexOf('// pixel:');
    if(end<0)throw Error('Pinned native underwater integration seam changed');
    code=code.slice(0,end)+`fn creekVolumeLit(m:f32,sigT:vec3f,dir:vec3f,dist:f32)->vec3f {
 var total=vec3f(0.0);var sa=0.0;
 for(var i=0;i<12;i++){
  if(sa>=dist){break;}let sb=min(dist,.25*(pow(2.0,f32(i+1))-1.0));
  let ds=sb-sa;if(ds<=0.0){break;}
  let A=underwaterParams.camPos+dir*sa;let B=underwaterParams.camPos+dir*sb;
  let da=max(creekMeanAt(A.xz)-A.y,0.0);let db=max(creekMeanAt(B.xz)-B.y,0.0);
  let a=sigT*(sa+da/m);let b=sigT*(sb+db/m);let k=(b-a)/ds;let small=abs(k)<vec3f(1e-4);
  let safe=select(k,vec3f(1.0),small);
  total+=select((exp(-a)-exp(-b))/safe,exp(-a)*ds,small);sa=sb;
 }
 return total;
}
fn museumVolumeLit(m:f32,sigT:vec3f,zc:f32,dir:vec3f,dist:f32)->vec3f {
 if(creekContains(underwaterParams.camPos.xz)){
  // A horizontal lake has the exact native closed form. Uniform 8-step
  // quadrature lost all near-eye scattering on long rays and drew dark bands.
  let state=waterQueryCameraState();if(dot(state.yz,state.yz)<1e-6){return _uwLit(m,sigT,zc,dir.y,dist);}
  return creekVolumeLit(m,sigT,dir,dist);
 }
 return _uwLit(m,sigT,zc,dir.y,dist);
}
`+code.slice(end);
    code=code.replace('_uwLit( mu, sigT, zc, dir.y, dist )','museumVolumeLit( mu, sigT, zc, dir, dist )').replace('_uwLit( 0.8, sigT, zc, dir.y, dist )','museumVolumeLit( 0.8, sigT, zc, dir, dist )');
    return code;
  }
}
