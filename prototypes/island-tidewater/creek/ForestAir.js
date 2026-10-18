// Native Tidewater AirHaze/AirMotes integration (4811ba48, MIT; see NOTICE).
// One world-fixed humid opening supplements the existing aerial medium. It
// uses the SAME shadow march, temporal history, composite and water-lens mask.
import {AirHaze} from '../vendor/tidewater/src/post/AirHaze.js';
import {AirMotes} from '../vendor/tidewater/src/fx/AirMotes.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {FullscreenPass} from '../vendor/tidewater/src/engine/render/FullscreenPass.js';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {groveModule,groveWeight} from './GroveDesign.js';

export class ForestAir extends AirHaze{
 constructor(options,terrainData){
  super(options);this.localAir=new UniformBlock('MuseumForestAir',{center:['vec3f',new Vector3(1408,terrainData.heightAt(1408,-2098)+12,-2098)],radius:['vec3f',new Vector3(110,22,105)],sigma:['f32',.00085],enabled:['f32',1]},{label:'world-fixed humid forest opening'});
  this.localModule=new ShaderModule({name:'museumForestAir',uniforms:this.localAir,uniformName:'forestAir',code:`
fn groveAirErf(x:f32)->f32{
 let a=abs(x);let t=1.0/(1.0+.3275911*a);
 let y=1.0-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a);
 return select(-y,y,x>=0.0);
}
fn groveAirSigma(p:vec3f)->f32{let q=(p-forestAir.center)/forestAir.radius;return forestAir.sigma*forestAir.enabled*exp(-dot(q,q));}
// Analytic integral of the same ellipsoidal Gaussian, shared by the marcher,
// its normalization and full-resolution extinction. No terrain texture taps.
fn groveAirTau(cam:vec3f,dir:vec3f,d:f32)->f32{
 let q=(cam-forestAir.center)/forestAir.radius;let v=dir/forestAir.radius;
 let a=max(dot(v,v),1e-10);let b=dot(q,v);let c=dot(q,q);if(c-b*b/a>12.0||forestAir.enabled<.5){return 0.0;}let sa=sqrt(a);
 return max(0.0,forestAir.sigma*forestAir.enabled*exp(-max(c-b*b/a,0.0))*.886226925/sa*(groveAirErf(sa*d+b/sa)-groveAirErf(b/sa)));
}
fn groveAirSegment(cam:vec3f,dir:vec3f,d:f32)->vec2f{
 let q=(cam-forestAir.center)/forestAir.radius;let v=dir/forestAir.radius;
 let a=dot(v,v);let b=dot(q,v);let det=b*b-a*(dot(q,q)-9.0);
 if(det<=0.0||forestAir.enabled<.5){return vec2f(0.0);}
 let r=sqrt(det);return clamp(vec2f((-b-r)/a,(-b+r)/a),vec2f(0.0),vec2f(d));
}
`});
 }
 get module(){const m=super.module;if(!this._forestModule){m.deps.push(this.localModule);m.code+=`
fn groveAirInScatter(cam:vec3f,dir:vec3f,d:f32)->f32{
 let hc=max(cam.y-frame.seaLevel,0.0);
 let tau=(hazeLayerDepth(HZ_MARINE_SIGMA,HZ_MARINE_H,hc,dir.y,d)+hazeLayerDepth(HZ_AEROSOL_SIGMA,HZ_AEROSOL_H,hc,dir.y,d))*hazeParams.density+groveAirTau(cam,dir,d);
 return 1.0-exp(-tau);
}
`;this._forestModule=true;}return m;}
 get compositeModule(){const m=super.compositeModule;if(!this._forestComposite){
   const a='let tau = ( hazeLayerDepth( HZ_MARINE_SIGMA, HZ_MARINE_H, camH, dir.y, dist ) + hazeLayerDepth( HZ_AEROSOL_SIGMA, HZ_AEROSOL_H, camH, dir.y, dist ) ) * hazeParams.density;';
   const b='hazeInScatter( camH, dir.y, min( dist, 2500.0 ) )';
   if(!m.code.includes(a)||!m.code.includes(b))throw Error('Pinned native haze composite seam changed');
   m.code=m.code.replace(a,a.slice(0,-1)+' + groveAirTau(underwaterParams.camPos,dir,dist);');
   m.code=m.code.replace('var acc = vec2f( 0.0 );','var acc = vec3f( 0.0 );').replace('acc += s.xy * wt;','acc += s.xyw * wt;');
   const hook='out = max( out + near - deficit, vec3f( 0.0 ) );';
   if(!m.code.includes(hook))throw Error('Pinned native haze energy composite changed');
   m.code=m.code.replace(hook,hook+`
    let tauLocal=groveAirTau(underwaterParams.camPos,dir,dist);
    if(tauLocal>1e-5){
     let exactGlobal=hazeInScatter(camH,dir.y,min(dist,2500.0));
     let exactTotal=groveAirInScatter(underwaterParams.camPos,dir,min(dist,2500.0));
     let globalAll=clamp(sh.y*exactGlobal,0.0,exactTotal);let localAll=max(exactTotal-globalAll,0.0);
     let globalLit=sat(sh.x)*globalAll;let localLit=sat(sh.z)*localAll;
     let tauGlobal=(hazeLayerDepth(HZ_MARINE_SIGMA,HZ_MARINE_H,camH,dir.y,dist)+hazeLayerDepth(HZ_AEROSOL_SIGMA,HZ_AEROSOL_H,camH,dir.y,dist))*hazeParams.density;
     var physical=c.rgb*exp(-tauGlobal-tauLocal)+fog*globalAll*(1.0-fSun*(1.0-h));
     physical+=Ep*(globalLit*(1.0-h)+localLit)*hazeParams.shafts-fog*fSun*(globalAll-globalLit)*h;
     physical+=fog*localAll*(1.0-fSun);
     // The atmospheric sky already contains the global aerosol. Only the
     // new local volume gets an extra transmission / emission here.
     if(sky){physical=c.rgb*exp(-tauLocal)-fog*fSun*(globalAll-globalLit)+fog*localAll*(1.0-fSun)+Ep*localLit*hazeParams.shafts;}
     out=mix(out,max(physical,vec3f(0.0)),smoothstep(1e-5,.001,tauLocal));
    }
   `);this._forestComposite=true;
  }return m;}
 _build(){
  super._build();
  // Native 16 global samples plus 8 samples restricted to the local medium's
  // intersection, in the existing march pass. No extra render targets/pass.
  this._passes.march=new FullscreenPass({label:'haze march',modules:[this.module],defines:this._defines(),colorFormats:['rgba16float'],code:`
fn fragment(in:FSIn)->vec4f{
 let R=hazeRay(in.uv);var out=vec4f(0.0,0.0,R.dist,0.0);
 if(hazeParams.enabled>.5&&frame.cameraUnderwater<.5&&hazeParams.shafts>0.0){
  let cam=underwaterParams.camPos;let tMax=min(R.dist,2500.0);
  let jitter=fract(interleavedGradientNoise(in.pos.xy)+hazeParams.frame*.61803398875);
  let sigM=HZ_MARINE_SIGMA*hazeParams.density;let sigA=HZ_AEROSOL_SIGMA*hazeParams.density;
  var lit=0.0;var all=0.0;var localLit=0.0;var localAll=0.0;var tau=0.0;var tPrev=0.0;
  let fwd=-vec3f(frame.view[0][2],frame.view[1][2],frame.view[2][2]);
  var sc0:array<vec4f,4>;var scd:array<vec4f,4>;
  for(var c=0;c<i32(shadowParams.count);c++){sc0[c]=shadowParams.matrices[c]*vec4f(cam,1.0);scd[c]=shadowParams.matrices[c]*vec4f(R.dir,0.0);}
  for(var i=0;i<16;i++){
   let u=(f32(i)+jitter)/16.0;let t=u*u*tMax;let dt=u*.125*tMax;let P=cam+R.dir*t;
   let h=max(P.y-frame.seaLevel,0.0);let sig=exp(h/-HZ_MARINE_H)*sigM+exp(h/-HZ_AEROSOL_H)*sigA;
   tau+=sig*(t-tPrev);tPrev=t;let Tr=exp(-tau-groveAirTau(cam,R.dir,t));let w=sig*Tr*dt;
   var v=1.0;
   if(shadowParams.enabled>.5){let c=shadowCascadeOf(dot(P-frame.cameraPos,fwd));if(c>=0){let sc=sc0[c]+scd[c]*t;let uv=vec2f(sc.x*.5+.5,.5-sc.y*.5);if(!(any(uv<=vec2f(0.0))||any(uv>=vec2f(1.0))||sc.z>1.0)){v=select(0.0,1.0,sc.z-2e-5<=_shadowDepth(uv,c));}}}
   lit+=w*hazeVisibilityRest(P,v);all+=w;
  }
  let seg=groveAirSegment(cam,R.dir,tMax);let step=(seg.y-seg.x)/8.0;
  if(step>.001){for(var i=0;i<8;i++){
   let t=seg.x+(f32(i)+jitter)*step;let P=cam+R.dir*t;let hc=max(cam.y-frame.seaLevel,0.0);
   let globalTau=(hazeLayerDepth(HZ_MARINE_SIGMA,HZ_MARINE_H,hc,R.dir.y,t)+hazeLayerDepth(HZ_AEROSOL_SIGMA,HZ_AEROSOL_H,hc,R.dir.y,t))*hazeParams.density;
   let w=groveAirSigma(P)*exp(-globalTau-groveAirTau(cam,R.dir,t))*step;
   localLit+=w*hazeVisibility(P);localAll+=w;
  }}
  let exact=hazeInScatter(max(cam.y-frame.seaLevel,0.0),R.dir.y,tMax);out=vec4f(lit/max(all,1e-12),all/max(exact,1e-12),R.dist,localLit/max(localAll,1e-12));
 }
 return out;
}
`});
  const mod=this.module;
  this._passes.temporal=[0,1].map(src=>new FullscreenPass({label:'haze shafts temporal',modules:[mod],defines:this._defines(),bindings:{hzCur:{texture:()=>this.low.texture},hzPrev:{texture:()=>this.hist[src].texture}},colorFormats:['rgba16float'],code:`
fn fragment(in:FSIn)->vec4f{
 let size=vec2i(textureDimensions(hzCur));let p=vec2i(in.pos.xy);let cur=textureLoad(hzCur,p,0);var out=cur;
 if(hazeParams.histValid>.5){
  var lo=cur.xyw;var hi=cur.xyw;
  for(var k=0;k<9;k++){let s=textureLoad(hzCur,clamp(p+vec2i(k%3-1,k/3-1),vec2i(0),size-1),0).xyw;lo=min(lo,s);hi=max(hi,s);}
  let R=hazeRay(in.uv);let world=underwaterParams.camPos+R.dir*cur.z;let clip=frame.prevViewProjNoJitter*vec4f(world,1.0);
  if(clip.w>1e-4){let puv=clip.xy/clip.w*vec2f(.5,-.5)+.5;if(all(puv>=vec2f(0.0))&&all(puv<=vec2f(1.0))){
   let prev=textureSampleLevel(hzPrev,smpLinearClamp,puv,0.0);let expect=length(world-frame.prevCameraPos);
   if(abs(prev.z-expect)<expect*.05+.3){let val=mix(clamp(prev.xyw,lo,hi),cur.xyw,.12);out=vec4f(val.x,val.y,cur.z,val.z);}
  }}
 }
 return out;
}
`}));
 }
 setLocalEnabled(on){this.localAir.fields.enabled.value=on?1:0;this._histValid=false;}
 stats(){return {enabled:this.localAir.fields.enabled.value,center:this.localAir.fields.center.value.toArray(),radius:this.localAir.fields.radius.value.toArray(),sigma:this.localAir.fields.sigma.value,pass:'native haze march + temporal + depth-aware composite; no additional per-frame pass',steps:{global:16,local:8},normalization:'same analytic Gaussian in extinction, march transmittance and exact in-scatter',history:this._histValid};}
}

export class ForestMotes extends AirMotes{
 constructor(options,field,terrainData){
  super({...options,count:1400,box:10});this.active=true;this.data=terrainData;this.windScale=.08;
  const m=this.material;m.name='Museum forest air motes';m.modules.push(groveModule,field.module);
  const change=(a,b)=>{if(!m.vertex.includes(a))throw Error('Pinned native AirMotes seam changed: '+a.slice(0,45));m.vertex=m.vertex.replace(a,b);};
  change('let isGnat = id < 48.0;','let isGnat = false;');change('let isSeed = id >= 48.0 && id < 96.0;','let isSeed = false;');
  // A few millimetre-scale organic particles make native dust readable when
  // backlit; 97.5% keep submillimetre sizes. Both poses use the same r below.
  change('let rMote = mix( 0.00015, 0.0005, h2.x * h2.x ) * mix( 1.0, 0.6, salt ) * select( 1.0, 2.2, h2.y > 0.96 );',
   'let fineDust = mix( 0.00015, 0.0005, h2.x * h2.x ) * mix( 1.0, 0.6, salt ) * select( 1.0, 2.2, h2.y > 0.96 ); let rMote = select(fineDust,mix(.0025,.0045,h2.x),h2.y>.975);');
  change('frame.windSpeed * 0.25','frame.windSpeed * 0.08');
  change('let density = select( select( dMote, dSeed, isSeed ), dGnat, isGnat );','let density=museumGroveWeight(xz0)*day*.7;');
  change('sunShadowCascadeHard( p, 0 )','sunShadowHard( p )');
  change('let a = cover * fade * keep * air.intensity;',`let water=creekFieldAt(p.xz);let inWater=water.y<0.0&&p.y<water.x+.06;
 let a=cover*fade*keep*air.intensity*select(1.0,0.0,inWater);`);
  change('v.prevWorldPos = v.worldPos - vel * frame.dt;',`let oldP=p-vel*frame.dt;
 let oldGround=terrainHeightAt(xz0-windV.xz*frame.dt);let before=oldP+vec3f(0.0,oldGround-ht,0.0);
 let oldV=normalize(frame.prevCameraPos-before);let oldRight=normalize(cross(vec3f(0.0,1.0,0.0),oldV)+vec3f(1e-5,0.0,0.0));let oldUp=cross(oldV,oldRight);
 let oldPixel=max(length(frame.prevCameraPos-before),.05)*2.0/(p11*frame.resolution.y);let oldSize=max(r,oldPixel*1.2);
 v.prevWorldPos=before+oldRight*(corner.x*oldSize)+oldUp*(corner.y*oldSize);`);
  m.needsUpdate=true;this.mesh.name='Native forest motes, own habitat';
 }
 update(dt,camera,water){const p=camera.position,h=p.y-this.data.heightAt(p.x,p.z),a=Math.max(0,Math.min(1,(12-h)/5));this.intensity.value=this.active?groveWeight(p.x,p.z)*a:0;super.update(dt,camera,water);}
 stats(){return {active:this.active,visible:this.mesh.visible,count:1400,intensity:this.intensity.value,box:10,windScale:this.windScale,space:'world phase, native drift + own previous pose; smooth world habitat / height / inland water exclusion',kind:'native dust with 2.5% millimetre organic particles; no gnat/seed placeholder species'};}
}
