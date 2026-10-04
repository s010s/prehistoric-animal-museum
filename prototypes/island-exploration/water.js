import {springRuns,springAt,forestSpringRun} from './spring.js'
import {makeOceanSpectrum,oceanSpectrumGLSL} from './ocean-spectrum.js';
import {makeExposureMeter} from './exposure-meter.js'
import {terrainLightGLSL} from './terrain-light.js'
import {swellGLSL,oceanGeometry,makeRockSpray} from './water-motion.js'
import * as T from 'three'
import {shoreResources,shoreGLSL,shoreTime,SHORE,ESTUARY_SHORE} from './shore.js'
import {makeShoreWetMemory} from './shore-wet-memory.js'
import {skyGLSL} from './sky.js'
import {contactOcclusionGLSL} from './contact-occlusion.js'
import {riverReach} from './hydrology.js'
import {makeFlowField} from './flow-field.js'
import {Reflector} from 'three/addons/objects/Reflector.js'
import {SEA,riverX,halfWidth,riverLevel,lake,wetland,wetlandLevel,tarn,tributaryX,tributaryLevel,waterLevelAt,bankWaterLevelAt,terrainHeight} from './field.js'
export async function makeWater(renderer,camera,rocks,skyUniforms,getFine=()=>false,diagnostics,shadowReady=()=>true){
 const shore=await shoreResources(),exposureMeter=makeExposureMeter(),spectrum=makeOceanSpectrum();
 const wetMemory=new URLSearchParams(location.search).get('benchmark')==='1'&&new URLSearchParams(location.search).get('wetMemory')==='legacy'?null:makeShoreWetMemory(shore);
 const disposeWetOnExit=event=>{if(!event.persisted){wetMemory?.dispose();disposeLinearComposite();output?.dispose();removeEventListener('pagehide',disposeWetOnExit)}};
 const laceData=new Uint8Array(await(await fetch('./assets/surf-lace.bin')).arrayBuffer());if(laceData.length!==512*512*4)throw Error('Invalid surf lace');
 const surfLace=new T.DataTexture(laceData,512,512,T.RGBAFormat);surfLace.wrapS=surfLace.wrapT=T.RepeatWrapping;surfLace.minFilter=T.LinearMipmapLinearFilter;surfLace.magFilter=T.LinearFilter;surfLace.generateMipmaps=true;surfLace.anisotropy=8;surfLace.needsUpdate=true;
 const habitat=new URLSearchParams(location.search).get('look')!=='baseline';
 const currentReflectionShadow=!(new URLSearchParams(location.search).get('benchmark')==='1'&&['reflectionShadow','shadowBootstrap'].some(key=>new URLSearchParams(location.search).get(key)==='legacy'));
 const linearComposite=!(new URLSearchParams(location.search).get('benchmark')==='1'&&new URLSearchParams(location.search).get('linearComposite')==='legacy');
 let ripplePending=true,rippleError=null,reflectionFrozen=false,reflectionReady=false,aoDisabled=false;
 const field=makeFlowField(rocks,diagnostics),rippleMap=new T.TextureLoader().load("./assets/river-ripples.png",()=>ripplePending=false,undefined,()=>{ripplePending=false;rippleError="river-ripples.png failed to load"});rippleMap.wrapS=rippleMap.wrapT=T.RepeatWrapping;rippleMap.anisotropy=8
 const resolution=new T.Vector2(),opaque=new T.WebGLRenderTarget(1,1,{samples:0,type:T.HalfFloatType,depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)})
 const reflector=new Reflector(new T.PlaneGeometry(60000,60000),{textureWidth:384,textureHeight:384,clipBias:.001,multisample:4});reflector.rotation.x=-Math.PI/2
 // The reflection has linear filtering and no mip chain. Explicit level zero
 // keeps sampling well-defined inside the contribution branch below.
 const reflectionTexture=reflector.getRenderTarget().texture;reflectionTexture.minFilter=reflectionTexture.magFilter=T.LinearFilter;reflectionTexture.generateMipmaps=false;
 const coastDepth=new T.DataTexture(new Uint8Array([255]),1,1,T.RedFormat);coastDepth.needsUpdate=true;
 // Exact piecewise-linear footprint of the river mesh: one owner at each point.
 const coverageData=new Float32Array(851*4);let ct=0,cx=riverX(-4000);for(let i=0;i<=850;i++){const z=-4000+i*8,rx=riverX(z),speed=riverReach(z).speed;if(i)ct+=Math.hypot(rx-cx,8)/speed;cx=rx;coverageData.set([rx,halfWidth(z)+25,speed,ct],i*4)}
 const riverFieldGLSL=`
 uniform sampler2D riverCoverage;
 vec4 riverSample(float z){float row=clamp((z+4000.)/8.,0.,849.999);vec4 a=texture2D(riverCoverage,vec2((floor(row)+.5)/851.,.5)),b=texture2D(riverCoverage,vec2((floor(row)+1.5)/851.,.5));return mix(a,b,fract(row));}
 float mainRiverLevel(float z){return 17.3*(1.-smoothstep(-1550.,2800.,z))+190.*(1.-smoothstep(-3800.,-1550.,z))-.7;}
 float riverDomain(vec2 p){vec4 r=riverSample(p.y);return smoothstep(-4070.,-3995.,p.y)*(1.-smoothstep(2700.,2800.,p.y))*(1.-smoothstep(r.y+8.,r.y+120.,abs(p.x-r.x)));}
 float riverInfluence(vec2 p){vec4 r=riverSample(p.y);return smoothstep(-4070.,-3995.,p.y)*(1.-smoothstep(1700.,2800.,p.y))*(1.-smoothstep(r.y-12.,r.y+75.,abs(p.x-r.x)));}
 `;
 const coverage=new T.DataTexture(coverageData,851,1,T.RGBAFormat,T.FloatType);coverage.minFilter=coverage.magFilter=T.NearestFilter;coverage.needsUpdate=true;
 const waterScene=new T.Scene(),u={...spectrum.uniforms,surfLace:{value:surfLace},...shore,riverCoverage:{value:coverage},coastDepth:{value:coastDepth},terrainSpan:{value:20480},oceanCenter:{value:new T.Vector2()},...skyUniforms,aoEnabled:{value:getFine()?1:0},opaque:{value:opaque.texture},sceneDepth:{value:opaque.depthTexture},reflection:{value:reflector.getRenderTarget().texture},reflectionMatrix:{value:new T.Matrix4()},cheapWater:{value:0},debug:{value:({normal:1,reflection:2,depth:3,foam:4,body:5}[new URLSearchParams(location.search).get('water')]??0)},reflectionY:{value:0},time:{value:0},resolution:{value:resolution},cameraNear:{value:camera.near},cameraFar:{value:camera.far},sunDir:skyUniforms.skySun,rippleMap:{value:rippleMap},viewToWorld:{value:camera.matrixWorld},inverseProjection:{value:camera.projectionMatrixInverse},screenSize:{value:resolution},flowMap:{value:field.texture},flowOrigin:{value:field.origin},flowSpan:{value:field.span}}
 const mat=new T.ShaderMaterial({uniforms:u,depthTest:false,depthWrite:false,transparent:true,
 vertexShader:`${swellGLSL}
 ${oceanSpectrumGLSL}
 ${riverFieldGLSL}
 ${shoreGLSL}
 attribute float springBedDepth;varying float cascadeBedDepth;attribute float springHalfWidth;varying float cascadeHalfWidth;attribute float springDistance;varying float cascadeDistance;attribute vec2 springEnergy;varying vec2 cascadeEnergy;attribute float waterKind;varying float kind;attribute vec2 velocity;attribute vec2 riverCoord;varying vec2 channel;varying vec3 wp;varying float vd,seaMask,coastalTile;varying vec2 flow;
 void main(){cascadeBedDepth=springBedDepth;cascadeHalfWidth=springHalfWidth;cascadeDistance=springDistance;cascadeEnergy=springEnergy;wp=position;flow=velocity;channel=riverCoord;coastalTile=step(3.5,waterKind);kind=coastalTile>.5?0.:waterKind;seaMask=1.-step(.5,kind);
 if(kind<.5){if(coastalTile<.5)wp.xz+=oceanCenter;wp.y+=max(0.,mainRiverLevel(wp.z)+.7)*riverDomain(wp.xz);}
 if(kind<1.5){vec4 r=riverSample(wp.z);float dx=(riverSample(wp.z+4.).x-riverSample(wp.z-4.).x)/8.;flow=normalize(vec2(dx,1.))*r.b;channel=vec2(wp.x-r.x,r.a);}
 float tidal=kind<1.5?1.-riverInfluence(wp.xz):0.;
 wp.y+=(swell(wp.xz).x*.35+texture2D(oceanBand0,wp.xz/256.).b)*tidal*coastAttenuation(wp.xz);
 if(kind<.5){vec2 shore=shoreSurface(wp.xz);wp.y=mix(wp.y,shore.x,shore.y);}
 vec4 p=viewMatrix*vec4(wp,1.);vd=-p.z;gl_Position=projectionMatrix*p;}`,
 fragmentShader:`
 #include <common>
 #include <packing>
 varying float cascadeBedDepth;varying float cascadeHalfWidth;varying float cascadeDistance;varying vec2 cascadeEnergy;varying float kind;${riverFieldGLSL}uniform sampler2D opaque,sceneDepth,reflection;uniform mat4 reflectionMatrix,viewToWorld;uniform vec2 resolution;uniform float cameraNear,cameraFar,reflectionY,debug,cheapWater;uniform vec3 sunDir;uniform sampler2D surfLace,rippleMap,flowMap;uniform vec2 flowOrigin;uniform float flowSpan;varying vec3 wp;varying float vd,seaMask,coastalTile;varying vec2 flow;varying vec2 channel;
 ${swellGLSL}
 ${oceanSpectrumGLSL}
 ${shoreGLSL}
 ${contactOcclusionGLSL}
 ${terrainLightGLSL}
 uniform float aoEnabled;
 ${skyGLSL}
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
 // Stable cellular foam membranes, advected by the local backwash.
 // Tidewater's rounded lace distance field, with footprint-to-average handover.
 float foamCells(vec2 p,float coverage){vec4 lace=texture2D(surfLace,p/3.5);float footprint=max(length(dFdx(p)),length(dFdy(p)));
 float w=max(0.,pow(clamp(coverage,0.,1.),1.4)*.9*(lace.b*.5+.75)+(lace.g-.5)*.06),soft=.05+footprint*4.5;
 float mat=1.-smoothstep(w-soft,w+soft,lace.r),inner=clamp((w-lace.r)/.25,0.,1.);
 float near=mat*(inner*.35+.45+lace.b*.3);float avg=clamp(pow(w,1.45)*1.9,0.,1.)*.8;
 return mix(near,avg,smoothstep(.03,.12,footprint))*smoothstep(0.,.05,coverage);}
 // Analytic derivatives of band-limited noise; no repeating sine-wave rows.
 vec2 gradNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+1.);return du*vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x));}
 vec2 filteredGradient(vec2 p){float footprint=max(length(dFdx(p)),length(dFdy(p)));return gradNoise(p)*(1.-smoothstep(.45,1.7,footprint));}
 vec2 riverSurface(vec2 p){mat2 r=mat2(.8,.6,-.6,.8);return filteredGradient(p*.48)*.65+transpose(r)*filteredGradient(r*p*1.37+17.)*.28+filteredGradient(p*3.73+vec2(53.,9.))*.10;}
 float sceneZ(vec2 uv){return -perspectiveDepthToViewZ(texture2D(sceneDepth,uv).x,cameraNear,cameraFar);}
 void main(){
 if(kind<.5&&coastalTile<.5&&shoreDistance(wp.xz)<.86)discard;
 if(kind<.5&&wp.z>=-4000.&&wp.z<2800.){float row=(wp.z+4000.)/8.;vec2 a=texture2D(riverCoverage,vec2((floor(row)+.5)/851.,.5)).rg,b=texture2D(riverCoverage,vec2((floor(row)+1.5)/851.,.5)).rg;vec2 bounds=mix(a,b,fract(row));if(abs(wp.x-bounds.x)<bounds.y)discard;}
 // Wetland owns its footprint above the sea; never let the ocean show through it.
 if((kind<.5||kind>2.5&&wp.z>0.)&&wp.x>945.&&wp.x<6255.&&wp.z>3630.&&wp.z<7170.)discard;

 vec2 screen=gl_FragCoord.xy/resolution;float thick=sceneZ(screen)-vd;if(thick<=.015)discard;
 if(cheapWater>.5){gl_FragColor=vec4(mix(texture2D(opaque,screen).rgb,vec3(.03,.16,.19),.3),smoothstep(.015,.23,thick));return;}
 vec3 eye=normalize(cameraPosition-wp);float speed=length(flow);float tidal=kind<1.5?1.-riverInfluence(wp.xz):0.;float backwater=kind>2.5&&wp.z>0.?1.-smoothstep(4100.,4800.,wp.z):1.;float springReach=max(step(2.5,kind)*(1.-step(-3890.,wp.z)),step(3.1,kind));float river=max(step(.3,speed)*(1.-tidal)*backwater,springReach);
 float depth=max(0.,wp.y-(viewToWorld*vec4(viewPoint(screen),1.)).y);
 float shoreWeight=kind<.5?shoreMask(wp.xz):0.;float shoreBed=shoreGround(wp.xz),shoreDepth=-.7-shoreBed,front=runupAt(wp.xz,time)-(shoreBed+.7);vec3 swash=vec3(1000.,1.,0.);if(shoreWeight>.001&&shoreDepth<.65)swash=shoreSwash(wp.xz,shoreBed,shoreGradient(wp.xz),time);float filmWeight=shoreWeight*(1.-smoothstep(.10,.65,shoreDepth));
 if(shoreWeight>.99&&shoreDepth<.10&&swash.y<=0.)discard;
 vec2 fuv=(wp.xz-flowOrigin)/flowSpan;float local=1.-smoothstep(.34,.49,max(abs(fuv.x-.5),abs(fuv.y-.5)));local*=1.-springReach;vec4 ff=texture2D(flowMap,clamp(fuv,0.,1.));
 vec2 velocity=mix(flow,(ff.rg-.5)*6.,local*river*step(-3890.,wp.z));float current=length(velocity);
 // Longitudinal travel time is integrated once in mesh coordinates. No reset/crossfade.
 vec2 direction=normalize(flow+vec2(.00001));vec2 across=vec2(direction.y,-direction.x);
 vec2 deformation=vec2(dot(velocity-flow,across),dot(velocity-flow,direction))*.45;
 vec2 adv=channel-vec2(0.,time);
 float phase0=fract(time/1.2),phase1=fract(time/1.2+.5),flowWeight=1.-abs(phase0*2.-1.);
 vec2 localDelta=vec2(dot(velocity-flow,across),dot(velocity-flow,direction)/max(.25,speed));
 vec2 adv0=adv-localDelta*1.2*(phase0-.5),adv1=adv-localDelta*1.2*(phase1-.5);
 float riffle=(1.-smoothstep(1.2,3.5,depth))*smoothstep(.45,1.6,current);
 float strength=${habitat?'.11+riffle*.24+ff.b*local*.26':'.023+riffle*.14+ff.b*local*.24'};
 vec2 localNormal=mix(riverSurface(adv1),riverSurface(adv0),flowWeight)*strength;vec2 moving=across*localNormal.x+direction*localNormal.y;
 // The short spectral band breaks the broad oily lobes without parallel sine rows.
 float gust=.25+.75*smoothstep(.20,.8,noise(wp.xz/190.-time*.006));
 mat2 windTurn=mat2(.8,.6,-.6,.8);
 vec2 wind=texture2D(oceanBand1,wp.xz/32.).rg*.65+transpose(windTurn)*texture2D(oceanBand1,windTurn*wp.xz/27.47+vec2(.31,.73)).rg*.35+texture2D(oceanBand0,wp.xz/256.).rg*.08;
 float lakeWind=step(1.5,kind)*(1.-step(2.5,kind));wind*=1.+lakeWind*${habitat?'1.2':'0.'}+tidal*${habitat?'2.2':'0.'};float exposedSea=tidal;wind*=mix(1.,1.25,exposedSea)*mix(.65,1.,gust)*mix(.38,1.,smoothstep(.15,5.,depth));
 // Shallow-water wave packets break unevenly along the coast, not in full rings.
 float shoal=(1.-smoothstep(.25,.85,depth))*smoothstep(.035,.16,depth)*exposedSea;
 float coastCrest=wavePacket(wp.xz,-.44,137.,1.,.57,1.2).x;
 float pulse=smoothstep(.38,.64,coastCrest)*smoothstep(.36,.68,noise(wp.xz*.27-vec2(.2,.1)*time));
 wind+=vec2(sin(dot(wp.xz,vec2(2.3,.8))-time*4.8),cos(dot(wp.xz,vec2(-1.1,3.2))-time*5.7))*.055*(1.-smoothstep(.25,1.2,max(length(dFdx(wp.xz)),length(dFdy(wp.xz)))));
 wind+=filteredGradient(wp.xz*.8-vec2(.9,.28)*time)*shoal*pulse*.045;
 float footprint=max(length(dFdx(wp.xz)),length(dFdy(wp.xz)));vec2 seaSlope=vec2(0.);if(exposedSea>.001)seaSlope=spectrumSlope(wp.xz,footprint)*exposedSea*coastAttenuation(wp.xz);vec2 slope=mix(wind*(1.-tidal*.85)-seaSlope,moving,river);if(springReach>.5)slope*=mix(.075,.55,smoothstep(.12,.9,speed));vec3 surfaceNormal=normalize(cross(dFdx(wp),dFdy(wp)));surfaceNormal*=surfaceNormal.y<0.?-1.:1.;vec3 normal=normalize(mix(vec3(0.,1.,0.),surfaceNormal,river)+vec3(slope.x,0.,slope.y));
 if(shoreWeight>.001){vec2 bedSlope=shoreGradient(wp.xz);float phase=shorePhase(wp.xz,shoreDepth,time);
 float shoalK=(1.-smoothstep(2.5,7.,shoreDepth))*smoothstep(-.4,1.5,shoreDepth);
 float crestDerivative=.90*max(0.,sin(phase))*cos(phase)*shoalK;
 vec2 phaseWarp=cos(wp.z*.035+wp.x*.011)*vec2(.011,.035)*.38+gradNoise(wp.xz/18.)*(1.1/18.)+gradNoise(wp.xz/43.)*(1.7/43.);
 vec2 waveGradient=crestDerivative*(-bedSlope*4.2+phaseWarp);
 vec3 breakerN=normalize(normal+vec3(-waveGradient.x,0.,-waveGradient.y));
 vec2 micro=gradNoise(wp.xz*5.7-vec2(time*.4))*mix(.015,.045,swash.z);
 normal=normalize(mix(breakerN,normalize(vec3(-bedSlope.x+micro.x,1.,-bedSlope.y+micro.y)),filmWeight));}

 float fresnel=.02+.98*pow(1.-max(0.,dot(eye,normal)),5.);
 vec2 distort=normal.xz*.008*smoothstep(.02,1.8,thick);vec2 refrUv=clamp(screen+distort,vec2(.002),vec2(.998));if(sceneZ(refrUv)<vd)refrUv=screen;
 refrUv=mix(refrUv,screen,filmWeight);vec3 bottom=texture2D(opaque,refrUv).rgb;
 vec3 transmittedRay=refract(-eye,normal,1./1.333);float opticalPath=depth/max(.15,-transmittedRay.y);
 // A falling sheet has thickness along its rock face. Vertical background
 // height can be above the water pixel and is not a valid depth on this face.
 float fall=kind>3.1?cascadeEnergy.x:0.;
 float sheetDepth=cascadeBedDepth*max(.12,surfaceNormal.y);
 if(fall>.001){depth=max(depth,sheetDepth*fall);opticalPath=mix(opticalPath,sheetDepth/max(.15,-dot(transmittedRay,surfaceNormal)),fall);}
 // A centimetre-deep sheet is crossed along the refracted ray, not the long
 // grazing camera ray. Preserve the sand instead of absorbing it into cyan.
 if(filmWeight>.001){vec2 bedSlope=shoreGradient(wp.xz);vec3 bedNormal=normalize(vec3(-bedSlope.x,1.,-bedSlope.y));
 float filmPath=swash.y/max(.15,-dot(refract(-eye,normal,1./1.333),bedNormal));opticalPath=mix(opticalPath,filmPath,filmWeight);}
 // Beer-Lambert extinction and in-scattered sun/sky, following Tidewater WaterMaterial.
 // Foam is on the surface; sediment and entrained bubbles brighten the volume beneath it.
 float surfPhase=shorePhase(wp.xz,shoreDepth,time);
 float aeration=shoreWeight*smoothstep(.12,.8,shoreDepth)*(1.-smoothstep(2.,5.,shoreDepth))
   *smoothstep(-.5,.65,sin(surfPhase-.55))*(.3+.7*noise(wp.xz*.43-time*.08));
 aeration=max(aeration,fall*(.24+.46*noise(adv*2.3)));
 vec3 sigA=mix(vec3(.42,.075,.035),vec3(.20,.085,.065),river);
 vec3 sigS=mix(vec3(.012,.018,.024),vec3(.024,.029,.020),river)+aeration*vec3(.12,.15,.13);
 vec3 sigT=sigA+sigS,transmission=exp(-sigT*opticalPath);
 float muV=max(.15,eye.y),muS=max(.1,sunDir.y);
 vec3 bb=sigS*mix(.035,.06,aeration),albedo=1.32*bb/(sigA+bb);
 vec3 kSun=sigT*(1.+muV/muS),kSky=sigT*(1.+muV/.75);
 vec3 inSun=vec3(1.,.94,.82)*worldSun(wp)*(sigS*.12+albedo*sigT)*(1.-exp(-kSun*opticalPath))/kSun;
 vec3 inSky=vec3(.36,.49,.64)*(sigS*.25+albedo*sigT)*(1.-exp(-kSky*opticalPath))/kSky;
 vec3 body=bottom*transmission+inSun+inSky;
 body+=vec3(.025,.14,.105)*aeration*(1.-normal.y)*worldSun(wp);
 vec4 rc=reflectionMatrix*vec4(wp.x,reflectionY,wp.z,1.);vec2 ruv=rc.xy/rc.w+normal.xz*(.005+lakeWind*${habitat?'.018':'0.'}+tidal*${habitat?'.043':'0.'});
 float unresolved=clamp(log2(1.+footprint*6.)/6.,0.,1.);
 float spread=mix(.004,.018,unresolved)*mix(.3,1.,tidal)+lakeWind*.003;
 vec3 mirror=vec3(0.);
 float mirrorEdge=min(min(ruv.x,ruv.y),min(1.-ruv.x,1.-ruv.y));
 vec3 reflectedDirection=reflect(-eye,normal);
 // The planar image is for nearby land. Sky follows the actual perturbed ray;
 // UV offsets on a flat mirror cannot represent short-wave sky reflections.
 float localReflection=(1.-smoothstep(1.,12.,abs(wp.y-reflectionY)))*(1.-smoothstep(280.,650.,vd))*smoothstep(.015,.10,mirrorEdge);
 localReflection*=1.-smoothstep(.06,.32,reflectedDirection.y);
 if(localReflection>0.){
 mirror=textureLod(reflection,clamp(ruv,vec2(.025),vec2(.975)),0.).rgb*.4;
 mirror+=(textureLod(reflection,clamp(ruv+vec2(spread,0.),vec2(.002),vec2(.998)),0.).rgb+textureLod(reflection,clamp(ruv-vec2(spread,0.),vec2(.002),vec2(.998)),0.).rgb+textureLod(reflection,clamp(ruv+vec2(0.,spread),vec2(.002),vec2(.998)),0.).rgb+textureLod(reflection,clamp(ruv-vec2(0.,spread),vec2(.002),vec2(.998)),0.).rgb)*.15;
 }
 if(localReflection<.999){vec3 rr=reflectedDirection;float sigma=.014+unresolved*.045+river*.025;rr.y=max(.004,rr.y)+sigma*(1.-max(0.,rr.y));rr=normalize(rr);
 vec3 sky=skyRadiance(rr,wp)*.5+(skyRadiance(normalize(rr+vec3(sigma,sigma,0.)),wp)+skyRadiance(normalize(rr+vec3(-sigma,sigma,0.)),wp))*.25;// Sloped rivers cannot use a distant horizontal mirror. Rough unresolved
 // banks retain the river's environment tint instead of a chalk-white sky strip.
 vec3 riverEnvironment=mix(body,sky, .30);sky=mix(sky,riverEnvironment,river);
 mirror=mix(sky,mirror,localReflection);}
 vec3 col=mix(body,mirror,fresnel*.78);
 // Tidewater: unresolved slope variance broadens GGX rather than aliasing a sharp glint.
 vec3 H=normalize(eye+sunDir);float nl=max(.001,dot(normal,sunDir)),nv=max(.025,dot(normal,eye)),nh=max(0.,dot(normal,H));
 float normalVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
 float alpha2=.00035+.009*unresolved+.015*aeration+min(.06,normalVariance*.5);
 float denom=nh*nh*(alpha2-1.)+1.;float D=alpha2/(3.14159265*denom*denom);
 float visibility=.5/max(.001,nl*sqrt(nv*nv*(1.-alpha2)+alpha2)+nv*sqrt(nl*nl*(1.-alpha2)+alpha2));
 float specF=.02+.98*pow(1.-max(0.,dot(eye,H)),5.);
 col+=vec3(1.,.94,.82)*min(2.4,D*visibility*specF*nl)*2.35*worldSun(wp)*smoothstep(.1,1.,thick);
 float foam=ff.b*local*river;
 float filaments=${habitat?'smoothstep(.53,.77,noise(adv*9.2))*smoothstep(.25,.62,noise(adv*3.8))':'smoothstep(.43,.72,noise(adv*3.8))'};
 float broken=smoothstep(.40,.70,noise(adv*.85+vec2(noise(adv/4.))*2.));
 float white=(foam*${habitat?'.34':'.65'}*filaments*mix(.2,1.,broken)+riffle*river*broken*${habitat?'.026':'.085'}+shoal*pulse*.22)*smoothstep(.03,.22,depth)*(1.-smoothstep(180.,750.,vd));
 float springRun=(1.-smoothstep(-3935.,-3925.,wp.z))*step(-4015.,wp.z)*smoothstep(.65,.95,speed);
 white=max(white,springRun*.09*filaments*broken*smoothstep(.005,.10,depth));
 // Side-source drops aerate locally; impact foam decays into the quiet pools.
 if(kind>3.1){vec2 seepC=vec2(channel.x,cascadeDistance);
 float supply=cascadeEnergy.x*.62+cascadeEnergy.y*.13;
 vec2 seep0=seepC-vec2(0.,speed*1.2*(phase0-.5)),seep1=seepC-vec2(0.,speed*1.2*(phase1-.5));
 float curtain=smoothstep(.38,.76,noise(vec2(channel.x*6.3,cascadeDistance*.32)))*(.55+.45*noise(vec2(channel.x*4.7,cascadeDistance*.65-time*1.8)));
 float poolLace=mix(foamCells(seep1*2.8,supply),foamCells(seep0*2.8,supply),flowWeight)*.55;
 float seepFoam=mix(poolLace,.14+.62*curtain,cascadeEnergy.x);
 float bubbleDepth=mix(smoothstep(.015,.14,depth),smoothstep(.006,.06,depth),cascadeEnergy.x);
 white=max(white,seepFoam*bubbleDepth*(1.-smoothstep(120.,350.,vd)));}
 float bead=smoothstep(-.01,.05,swash.x)*(1.-smoothstep(.12,.6,swash.x));
 float sheetTrail=smoothstep(-.01,.25,swash.x)*(1.-smoothstep(.3,2.2,swash.x));
 float edgeFoam=(bead*mix(1.1,.45,swash.z)+sheetTrail*mix(.4,.12,swash.z))*(1.-smoothstep(.0,.4,shoreDepth));
 float shoreFoam=shoreWeight*(edgeFoam+pow(max(0.,sin(shorePhase(wp.xz,shoreDepth,time))),8.)*smoothstep(.15,.65,shoreDepth)*(1.-smoothstep(1.2,2.8,shoreDepth))*.62);
 vec2 backwash=wp.xz+shoreGradient(wp.xz)*sin(time*.60)*8.;
 float foamPhase=shorePhase(wp.xz,shoreDepth,time);
 float trailing=smoothstep(-.3,.4,sin(foamPhase-.65))*(1.-smoothstep(.8,2.7,shoreDepth))*smoothstep(.06,.35,shoreDepth);
 float foamSupply=trailing*mix(.34,.98,noise(backwash*.45+vec2(noise(backwash*.13))*2.));
 float membranes=foamCells(backwash,foamSupply);
 shoreFoam=max(shoreFoam,shoreWeight*membranes*.95);
 float foamPatch=smoothstep(.19,.67,noise(backwash*.31+vec2(noise(backwash*.1))*1.7));
 shoreFoam*=smoothstep(.10,.82,foamPatch)*(.68+.32*smoothstep(.24,.75,noise(wp.xz*4.7+time*.12)));white=max(white,shoreFoam);
 // Foam is a rough diffuse bubble layer, with soft self-shadowing in the lace cavities.
 float foamRelief=mix(.83,1.,texture2D(surfLace,backwash/3.5).b);
 vec3 foamLight=(vec3(.32,.40,.48)+vec3(.59,.55,.46)*worldSun(wp)*(.25+.75*max(0.,dot(normal,sunDir))))*foamRelief;
 col=mix(col,foamLight,clamp(white,0.,1.));
 vec3 ray=normalize(wp-cameraPosition);float distanceToEye=length(wp-cameraPosition);float y0=max(cameraPosition.y,0.),y1=max(wp.y,0.),dy=y1-y0;float density=abs(dy)<.1?exp(-y0*.006):(exp(-y0*.006)-exp(-y1*.006))/(dy*.006);float mist=1.-exp(-distanceToEye*(.000055+.00016*density));col=mix(col,skyGradient(normalize(vec3(ray.x,max(.025,ray.y),ray.z))),mist);if(distanceToEye>4500.)col=mix(col,seaDistance(ray),smoothstep(4500.,11000.,distanceToEye));
 if(debug==1.)col=normal*.5+.5;if(debug==2.)col=mirror;if(debug==3.)col=vec3(thick*.15);if(debug==4.)col=vec3(white);if(debug==5.)col=body;
 // Image depth alone can see through a sloping bank to deeper background.
 // Keep the side-source sheet within its shared physical channel instead.
 float springBank=1.;
 if(${habitat?'true':'false'}&&kind>3.1){
  float feather=max(.12,fwidth(channel.x)*1.5);
  float bankEdge=abs(channel.x)+.08*(noise(wp.xz*2.3)-.5);
  springBank=1.-smoothstep(cascadeHalfWidth-.04,cascadeHalfWidth+feather,bankEdge);
 }
 float coastBlend=coastalTile>.5?1.-smoothstep(.86,1.,shoreDistance(wp.xz)):1.;
 float filmAlpha=smoothstep(0.,max(fwidth(swash.y)*1.5,.004),swash.y);
 gl_FragColor=vec4(col,mix(smoothstep(.015,max(.23,vd*.0007),thick),filmAlpha,filmWeight)*coastBlend*springBank);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`})
 mat.defaultAttributeValues.springBedDepth=[0];mat.defaultAttributeValues.springHalfWidth=[0];mat.defaultAttributeValues.springEnergy=[0,0];mat.defaultAttributeValues.springDistance=[0];
 const geometryAudit={partitionedBodies:0,inputIndices:0,outputIndices:0,indexOrderPreserved:true,staticChunks:0};
 function add(g,flow,kind=2){
  g.setAttribute('waterKind',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(kind),1));if(!g.attributes.velocity)g.setAttribute('velocity',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2).map((_,i)=>flow[i%2]),2));if(!g.attributes.riverCoord)g.setAttribute('riverCoord',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  const fixed=kind>=1&&kind<4;
  const install=geometry=>{const m=new T.Mesh(geometry,mat);m.frustumCulled=fixed;if(fixed){const box=new T.Box3(),p=geometry.attributes.position,v=new T.Vector3();for(let i=0;i<(geometry.index?.count??p.count);i++){v.fromBufferAttribute(p,geometry.index?geometry.index.getX(i):i);box.expandByPoint(v);}box.expandByScalar(8);geometry.boundingBox=box;geometry.boundingSphere=box.getBoundingSphere(new T.Sphere());geometryAudit.staticChunks++;}waterScene.add(m);return m;};
  if(!fixed||!g.index||g.index.count<=6144)return install(g);
  // Keep vertex identity, triangle order and shader inputs. Only index ownership
  // changes, so distant river/spring reaches can be rejected before shading.
  geometryAudit.partitionedBodies++;geometryAudit.inputIndices+=g.index.count;let first;
  for(let start=0;start<g.index.count;start+=6144){const part=new T.BufferGeometry();for(const [name,attribute]of Object.entries(g.attributes))part.setAttribute(name,attribute);const indices=g.index.array.slice(start,start+6144);part.setIndex(new T.BufferAttribute(indices,1));geometryAudit.outputIndices+=indices.length;for(let i=0;i<indices.length;i++)geometryAudit.indexOrderPreserved&&=indices[i]===g.index.array[start+i];const mesh=install(part);first??=mesh;}
  return first;
 }
 add(oceanGeometry(),[.11,.06],0)
 for(const cell of [SHORE,ESTUARY_SHORE]){const coastal=new T.PlaneGeometry(cell.size,cell.size,384,384);coastal.rotateX(-Math.PI/2);coastal.translate(cell.x,SEA,cell.z);const coastalMesh=add(coastal,[.11,.06],4);coastalMesh.renderOrder=1;coastalMesh.frustumCulled=true;coastal.computeBoundingSphere();coastal.boundingSphere.radius+=3;}

 const p=[],v=[],rc=[],idx=[],segments=850,acrossSegments=24;let travel=0,previousX=riverX(-4000),previousZ=-4000
 for(let i=0;i<=segments;i++){const z=-4000+i*8,x=riverX(z),w=halfWidth(z)+25,y=riverLevel(z),dx=(riverX(z+1)-riverX(z-1))/2,len=Math.hypot(dx,1);travel+=Math.hypot(x-previousX,z-previousZ)/riverReach(z).speed;previousX=x;previousZ=z;
 for(let k=0;k<=acrossSegments;k++){const offset=w*(k/acrossSegments*2-1);rc.push(offset,travel);p.push(x+offset,y,z);v.push(dx/len*riverReach(z).speed,1/len*riverReach(z).speed);if(z>=-3920&&i<segments&&k<acrossSegments){const j=i*(acrossSegments+1)+k;idx.push(j,j+acrossSegments+1,j+1,j+1,j+acrossSegments+1,j+acrossSegments+2)}}}
 const river=new T.BufferGeometry();river.setAttribute('position',new T.Float32BufferAttribute(p,3));river.setAttribute('velocity',new T.Float32BufferAttribute(v,2));river.setAttribute('riverCoord',new T.Float32BufferAttribute(rc,2));river.setIndex(idx);add(river,[0,.8],1);mat.side=T.DoubleSide
 // Quiet spring pools and narrow curved overflow runs share the carved bed.
 for(const run of springRuns){const sp=[],sv=[],sc=[],si=[],se=run===forestSpringRun?[]:null,sd=se?[]:null,sw=se?[]:null,sb=se?[]:null;let travel=0,impact=0,arc=0;
 for(let i=0;i<run.length;i++){const p=run[i],a=run[Math.max(0,i-1)],b=run[Math.min(run.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;const distance=Math.hypot(p.x-a.x,p.z-a.z);const surfaceArc=Math.hypot(distance,p.level-a.level);travel+=(se?surfaceArc:distance)/Math.max(.1,p.speed);arc+=surfaceArc;
 const grade=Math.max(0,Math.min(1,((a.level-b.level)/len-.18)/.65)),drop=grade*grade*(3-2*grade);impact=Math.max(drop,impact*Math.exp(-distance/2.3));
 for(let k=0;k<=8;k++){const offset=(k/4-1)*(p.width+.65);sp.push(p.x+dz/len*offset,p.level,p.z-dx/len*offset);sv.push(dx/len*p.speed,dz/len*p.speed);sc.push(offset,travel);if(se){se.push(drop,impact*(1-drop));sd.push(arc);sw.push(p.width);sb.push(p.depth);}if(i<run.length-1&&k<8){const j=i*9+k;si.push(j,j+9,j+1,j+1,j+9,j+10)}}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(sp,3));g.setAttribute('velocity',new T.Float32BufferAttribute(sv,2));g.setAttribute('riverCoord',new T.Float32BufferAttribute(sc,2));g.setIndex(si);if(se){g.setAttribute('springBedDepth',new T.Float32BufferAttribute(sb,1));g.setAttribute('springHalfWidth',new T.Float32BufferAttribute(sw,1));g.setAttribute('springEnergy',new T.Float32BufferAttribute(se,2));g.setAttribute('springDistance',new T.Float32BufferAttribute(sd,1));}add(g,[0,.2],run===forestSpringRun?3.25:3);}
 const pool=new T.PlaneGeometry(lake.rx*3.5,lake.rz*3.5);pool.rotateX(-Math.PI/2);pool.translate(lake.x,lake.level,lake.z);add(pool,[.1,.04])
 for(const body of [wetland,tarn]){const g=new T.PlaneGeometry(body.rx*(body===wetland?2.36:3.5),body.rz*(body===wetland?2.36:3.5),body===wetland?32:1,body===wetland?64:1);g.rotateX(-Math.PI/2);g.translate(body.x,body.level,body.z);if(body===wetland){const a=g.attributes.position;for(let i=0;i<a.count;i++)a.setY(i,wetlandLevel(a.getZ(i)))}add(g,[.04,.01])}
 const tp=[],tv=[],tc=[],ti=[];for(let i=0;i<=588;i++){const z=100+i*8,x=tributaryX(z),dx=(tributaryX(z+1)-tributaryX(z-1))/2;for(const side of [-1,1]){tc.push(side*50,z/.7);tp.push(x+side*50,tributaryLevel(z),z);tv.push(dx*.7,.7)}if(i<588){const j=i*2;ti.push(j,j+2,j+1,j+1,j+2,j+3)}}const tg=new T.BufferGeometry();tg.setAttribute('position',new T.Float32BufferAttribute(tp,3));tg.setAttribute('velocity',new T.Float32BufferAttribute(tv,2));tg.setAttribute('riverCoord',new T.Float32BufferAttribute(tc,2));tg.setIndex(ti);add(tg,[0,.7],3);
 const copyScene=new T.Scene(),copyCamera=new T.OrthographicCamera(-1,1,1,-1,0,1),copy=new T.ShaderMaterial({uniforms:{aoEnabled:u.aoEnabled,map:{value:opaque.texture},sceneDepth:{value:opaque.depthTexture},inverseProjection:{value:camera.projectionMatrixInverse},screenSize:{value:resolution}},depthTest:false,depthWrite:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D map,sceneDepth;uniform float aoEnabled;varying vec2 vUv;${contactOcclusionGLSL}
void main(){gl_FragColor=texture2D(map,vUv);if(aoEnabled>.5)gl_FragColor.rgb*=contactAO(vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});copyScene.add(new T.Mesh(new T.PlaneGeometry(2,2),copy))
 // Water reads opaque/depth while blending into a separate linear HDR image.
 // Only the final fullscreen output applies exposure and display conversion.
 let composite=linearComposite?new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false,samples:0}):null,outputScene=new T.Scene(),output=composite?new T.ShaderMaterial({uniforms:{map:{value:composite.texture}},depthTest:false,depthWrite:false,vertexShader:copy.vertexShader,fragmentShader:'uniform sampler2D map;varying vec2 vUv;void main(){gl_FragColor=texture2D(map,vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'}):null;
 if(output)outputScene.add(new T.Mesh(copyScene.children[0].geometry,output));
 let compositeDisposed=false;
 function restoreLinearComposite(){if(!linearComposite||!compositeDisposed)return;composite=new T.WebGLRenderTarget(Math.max(1,lastW),Math.max(1,lastH),{type:T.HalfFloatType,depthBuffer:false,samples:0});output.uniforms.map.value=composite.texture;compositeDisposed=false;diagnostics?.event('composition-reallocated',{width:lastW,height:lastH});}
 addEventListener('pagehide',disposeWetOnExit);
 function disposeLinearComposite(){if(compositeDisposed)return;compositeDisposed=true;composite?.dispose()}
 let spray=null,lastW=0,lastH=0,lastFine=null,reflectionMode=()=>{};
 const shadowSun=skyUniforms.skySun.value.clone();
 const pass=(name,fn)=>diagnostics?diagnostics.pass(name,fn):fn();
 return {setDiagnostic({freezeReflection=false,disableAO=false,cheap=false}={}){reflectionFrozen=freezeReflection;aoDisabled=disableAO;u.cheapWater.value=cheap?1:0;},dispose(){field.dispose();spectrum.dispose?.();wetMemory?.dispose();disposeLinearComposite();opaque.dispose();reflector.dispose();waterScene.traverse(o=>o.geometry?.dispose());mat.dispose();copy.dispose();output?.dispose();removeEventListener('pagehide',disposeWetOnExit);},disposeLinearComposite,disposeShoreWetMemory:()=>wetMemory?.dispose(),auditMaterials:()=>({copy,water:mat,spray:spray?.material,output}),resources:()=>[['opaque',opaque],['reflection',reflector.getRenderTarget()],...(composite&&!compositeDisposed?[['linearComposite',composite]]:[]),...spectrum.resources(),...(wetMemory?.resources()??[])],setReflectionMode:fn=>reflectionMode=fn,setDebug:value=>u.debug.value=value,status:()=>({geometryAudit:{...geometryAudit},diagnostic:{reflectionFrozen,reflectionReady,aoDisabled,cheapWater:u.cheapWater.value===1},composition:{mode:linearComposite?'linear-hdr':'legacy-display',width:composite?.width??0,height:composite?.height??0,disposed:compositeDisposed,outputDraws:linearComposite?1:0,order:['opaque-current-shadow','reflection','linear-ao-copy','linear-water-spray','display-output']},debug:u.debug.value,wetMemory:wetMemory?.status()??null,...field.status(),exposure:exposureMeter.status(),pending:field.status().pending||ripplePending,error:field.status().error||rippleError}),setTerrainDepth(data,size,span){const tx=new T.DataTexture(data,size,size,T.RedFormat);tx.minFilter=tx.magFilter=T.LinearFilter;tx.needsUpdate=true;u.coastDepth.value.dispose();u.coastDepth.value=tx;u.terrainSpan.value=span;},render(scene,camera,time){restoreLinearComposite();if(!spray){spray=makeRockSpray(rocks,u);waterScene.add(spray)}u.oceanCenter.value.set(camera.position.x,camera.position.z);const fine=getFine();u.aoEnabled.value=fine&&!aoDisabled?1:0;if(fine!==lastFine){opaque.samples=habitat?(fine?4:2):0;opaque.dispose();reflector.getRenderTarget().setSize(fine?512:320,fine?512:320);lastFine=fine}renderer.getDrawingBufferSize(resolution);if(resolution.x!==lastW||resolution.y!==lastH){opaque.setSize(resolution.x,resolution.y);composite?.setSize(resolution.x,resolution.y);lastW=resolution.x;lastH=resolution.y}u.time.value=time;shoreTime.value=time;wetMemory?.update(renderer,time,diagnostics);field.update(camera);spectrum.update(renderer,time,diagnostics);
 // Reflections use the current main shadow coverage, including camera cuts.
 const sunChanged=!shadowSun.equals(skyUniforms.skySun.value),shadowMissing=!shadowReady();
 const renderOpaque=()=>{renderer.setRenderTarget(opaque);pass('mainInclusiveShadow',()=>{renderer.clear();renderer.render(scene,camera)});shadowSun.copy(skyUniforms.skySun.value)},primeShadow=currentReflectionShadow||shadowMissing||sunChanged;
 if(primeShadow){renderOpaque();if(shadowMissing||sunChanged)diagnostics?.event(sunChanged?'shadow-sun-change':'shadow-bootstrap',{reordered:true})}
 const localSpring=springAt(camera.position.x,camera.position.z),level=localSpring?.level??waterLevelAt(camera.position.x,camera.position.z);
 if(!reflectionFrozen||!reflectionReady){ // Render the planar image for every visible frame; no 8/12 Hz stepping.
 u.reflectionY.value=level;reflector.position.y=level;reflector.updateMatrixWorld();const shadowUpdate=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;reflectionMode(true);try{pass('planarReflection',()=>reflector.onBeforeRender(renderer,scene,camera))}finally{reflectionMode(false);renderer.shadowMap.autoUpdate=shadowUpdate;}reflectionReady=true;u.reflectionMatrix.value.copy(reflector.material.uniforms.textureMatrix.value).multiply(new T.Matrix4().copy(reflector.matrixWorld).invert());
 }
 if(!primeShadow)renderOpaque();if(habitat)exposureMeter.update(renderer,opaque,camera);renderer.setRenderTarget(composite);pass('aoOutputComposite',()=>renderer.render(copyScene,copyCamera));renderer.autoClear=false;pass('water',()=>renderer.render(waterScene,camera));renderer.autoClear=true;
 if(composite){renderer.setRenderTarget(null);pass('displayOutput',()=>renderer.render(outputScene,copyCamera))}
 }}
}
