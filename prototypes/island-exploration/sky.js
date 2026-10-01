import * as T from 'three'
import {islandCloudGLSL} from './island-clouds.js'
// All values are linear radiance. Sky, land haze and distant sea share this endpoint.
// World-anchored cloud slab has thickness, wind and parallax; it is not an environment photograph.
export const skyGLSL=`
${islandCloudGLSL}
uniform sampler2D cloudPanorama,cloudPrevious;uniform float cloudPanoramaReady,cloudBlend;
uniform vec3 cloudPublishedOrigin,cloudPreviousOrigin;uniform vec2 cloudPublishedPhase,cloudPreviousPhase;
vec4 reprojectCloud(sampler2D tx,vec3 d,vec3 origin,vec3 cachedOrigin,vec2 cachedPhase){
 float distanceToCloud=max(1.,(6000.-origin.y)/max(.025,d.y));vec3 hit=origin+d*distanceToCloud;
 hit.xz+=cachedPhase-cloudPhase;vec3 r=normalize(hit-cachedOrigin);
 return texture2D(tx,vec2(atan(r.z,r.x)/6.2831853+.5,asin(clamp(r.y,0.,1.))/1.5707963));}

uniform vec3 skySun;uniform float skyTime;
vec3 skyGradient(vec3 d){
 float y=max(d.y,0.);vec3 c=mix(vec3(.50,.61,.66),vec3(.29,.43,.59),smoothstep(0.,.075,y));
 c=mix(c,vec3(.095,.23,.43),smoothstep(.025,.32,y));c=mix(c,vec3(.032,.105,.29),smoothstep(.24,.85,y));
 float forward=pow(max(0.,dot(normalize(vec3(d.x,.001,d.z)),normalize(vec3(skySun.x,.001,skySun.z)))),8.);
 return c+vec3(.075,.055,.025)*forward*exp(-y*9.);
}
vec3 skyRadiance(vec3 d,vec3 origin){
 vec3 c=skyGradient(d);float cloudTransmittance=1.;float mu=max(0.,dot(d,skySun));float angle=sqrt(max(0.,2.*(1.-mu)));
 float solar=(1.-smoothstep(.0038,.0052,angle))*10.+exp(-pow(angle/.022,2.))*.12;
 if(d.y>0.&&cloudPanoramaReady>.5){vec4 cloud=mix(reprojectCloud(cloudPrevious,d,origin,cloudPreviousOrigin,cloudPreviousPhase),reprojectCloud(cloudPanorama,d,origin,cloudPublishedOrigin,cloudPublishedPhase),cloudBlend);c=cloud.rgb;cloudTransmittance=cloud.a*smoothstep(.004,.04,cloud.a);}
 return c+vec3(1.,.90,.72)*solar*cloudTransmittance;
}
vec3 seaDistance(vec3 ray){
 vec3 reflected=reflect(ray,vec3(0.,1.,0.));float f=.02+.98*pow(1.-max(0.,-ray.y),5.);
 vec3 ocean=mix(vec3(.003,.021,.031),skyRadiance(reflected,cameraPosition),f);
 // Integrate the same height fog to the sea plane; an angular fade alone made
 // a dark belt outside the finite ocean mesh when viewed from the highlands.
 float altitude=max(.1,cameraPosition.y+.7),range=altitude/max(.00001,-ray.y);
 float density=(1.-exp(-altitude*.006))/(altitude*.006);
 float extinction=1.-exp(-range*(.000055+.00016*density));
 return mix(ocean,skyGradient(vec3(ray.x,0.,ray.z)),extinction);
}
vec3 distantRadiance(vec3 ray){return ray.y>=0.?skyRadiance(ray,cameraPosition):seaDistance(ray);}
`
export async function makeSky(sunDirection){
 const volumeData=new Uint8Array(await(await fetch('./assets/cloud-volume.bin')).arrayBuffer());if(volumeData.length!==64**3*4)throw Error('Invalid cloud volume');
 const volume=new T.Data3DTexture(volumeData,64,64,64);volume.format=T.RGBAFormat;volume.minFilter=volume.magFilter=T.LinearFilter;volume.wrapS=volume.wrapT=volume.wrapR=T.RepeatWrapping;volume.needsUpdate=true;
 const weatherData=new Uint8Array(await(await fetch('./assets/cloud-weather.bin')).arrayBuffer());if(weatherData.length!==1024**2)throw Error('Invalid cloud weather');
 const weather=new T.DataTexture(weatherData,1024,1024,T.RedFormat);weather.minFilter=weather.magFilter=T.LinearFilter;weather.wrapS=weather.wrapT=T.RepeatWrapping;weather.needsUpdate=true;
 const uniforms={cloudNoiseMap:{value:volume},skySun:{value:sunDirection},skyTime:{value:0},cloudWeather:{value:weather},cloudDensityMap:{value:weather},cloudOrigin:{value:new T.Vector2()},cloudPhase:{value:new T.Vector2()},cloudCoverage:{value:.49},cloudThickness:{value:1.7},cloudDataReady:{value:1},cloudAppearanceWeight:{value:1},weatherHaze:{value:0},rainWetness:{value:0}};
 const panoramas=[0,1,2].map(()=>new T.WebGLRenderTarget(3072,768,{type:T.HalfFloatType,depthBuffer:false}));for(const p of panoramas)p.texture.wrapS=T.RepeatWrapping;let panorama=panoramas[0],panoJob=null,published=null,completed=0,previousPanorama=panoramas[0],blendStart=-1e6;
 uniforms.cloudPanorama={value:panorama.texture};uniforms.cloudPrevious={value:panorama.texture};uniforms.cloudBlend={value:1};uniforms.cloudPublishedOrigin={value:new T.Vector3()};uniforms.cloudPreviousOrigin={value:new T.Vector3()};uniforms.cloudPublishedPhase={value:new T.Vector2()};uniforms.cloudPreviousPhase={value:new T.Vector2()};uniforms.cloudPanoramaReady={value:0};uniforms.cloudViewOrigin={value:new T.Vector3()};
 const panoScene=new T.Scene(),panoCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 panoScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,vertexShader:'varying vec2 uvSky;void main(){uvSky=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`varying vec2 uvSky;uniform vec3 cloudViewOrigin;${skyGLSL}void main(){float az=(uvSky.x-.5)*6.2831853,el=uvSky.y*1.5707963;vec3 d=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el));gl_FragColor=traceCloudSky(cloudViewOrigin,d,skyGradient(d),vec3(.12,.26,.40),vec3(1.,.90,.72),skySun);}`})));
 const shadowTarget=new T.WebGLRenderTarget(192,192,{depthBuffer:false});
 uniforms.cloudShadow={value:shadowTarget.texture};
 const shadowScene=new T.Scene(),shadowCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 shadowScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
 vertexShader:'varying vec2 uvWorld;void main(){uvWorld=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`varying vec2 uvWorld;${skyGLSL} void main(){vec2 p=(uvWorld-.5)*20480.;float transmission=cloudTransmission(vec3(p.x,0.,p.y),skySun);gl_FragColor=vec4(vec3(transmission),1.);}`
 })));
 let shadowTime=-1e6,panoTime=-1e6;const lastPanoPosition=new T.Vector3(1e8,1e8,1e8);
 const updateLighting=(renderer,t,camera,diagnostics)=>{
 uniforms.cloudBlend.value=T.MathUtils.smoothstep(t-blendStart,0,.45);
 const shadowDirty=Math.abs(t-shadowTime)>=.2,panoDirty=Math.abs(t-panoTime)>=.65||lastPanoPosition.distanceTo(camera.position)>16;
 if(!panoJob&&panoDirty)panoJob={index:0,time:t,position:camera.position.clone(),target:panoramas.find(p=>p!==panorama&&p!==previousPanorama),phase:uniforms.cloudPhase.value.clone(),cut:lastPanoPosition.distanceTo(camera.position)>200};
 if(!shadowDirty&&!panoJob)return;
 const target=renderer.getRenderTarget(),auto=renderer.autoClear;renderer.autoClear=true;
 if(panoJob){
  const job=panoJob,phase=uniforms.cloudPhase.value.clone();uniforms.cloudViewOrigin.value.copy(job.position);uniforms.cloudPhase.value.copy(job.phase);
  // Render-target scissor is in texture texels. renderer.setScissor applies the
  // canvas DPR again, leaving stale rows at fractional/Retina pixel ratios.
  job.target.scissorTest=!job.cut;job.target.scissor.set(0,job.cut?0:job.index*24,3072,job.cut?768:24);
  renderer.setRenderTarget(job.target);if(diagnostics)diagnostics.pass('cloudPanorama',()=>renderer.render(panoScene,panoCamera));else renderer.render(panoScene,panoCamera);uniforms.cloudPhase.value.copy(phase);
  if(job.cut||++job.index===32){published={position:job.position.clone(),phase:job.phase.clone(),cut:job.cut};completed++;previousPanorama=panorama;uniforms.cloudPrevious.value=previousPanorama.texture;uniforms.cloudPreviousOrigin.value.copy(uniforms.cloudPublishedOrigin.value);uniforms.cloudPreviousPhase.value.copy(uniforms.cloudPublishedPhase.value);
 panorama=job.target;uniforms.cloudPublishedOrigin.value.copy(job.position);uniforms.cloudPublishedPhase.value.copy(job.phase);blendStart=t;uniforms.cloudBlend.value=0;
 if(job.cut){previousPanorama=panorama;uniforms.cloudPrevious.value=panorama.texture;uniforms.cloudPreviousOrigin.value.copy(job.position);uniforms.cloudPreviousPhase.value.copy(job.phase);blendStart=t-1;uniforms.cloudBlend.value=1;}
 uniforms.cloudPanorama.value=panorama.texture;uniforms.cloudPanoramaReady.value=1;panoTime=job.time;lastPanoPosition.copy(job.position);panoJob=null;}
 }
 if(shadowDirty){renderer.setRenderTarget(shadowTarget);if(diagnostics)diagnostics.pass('cloudShadow',()=>renderer.render(shadowScene,shadowCamera));else renderer.render(shadowScene,shadowCamera);shadowTime=t;}
 renderer.setRenderTarget(target);renderer.autoClear=auto;
 };
 const material=new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,depthTest:false,
 vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}',
 fragmentShader:`varying vec3 skyDirection;${skyGLSL}\nvoid main(){gl_FragColor=vec4(distantRadiance(normalize(skyDirection)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
 const mesh=new T.Mesh(new T.SphereGeometry(1,32,16),material);mesh.frustumCulled=false;mesh.renderOrder=-1000;
 mesh.onBeforeRender=(_r,_s,c)=>{mesh.position.copy(c.position);mesh.updateMatrixWorld()};
 // Review-only GPU comparison of the published striped image against a full render.
 const audit=(renderer)=>{
  if(!published)return {passed:false,reason:'No completed panorama'};
  const target=renderer.getRenderTarget(),auto=renderer.autoClear,origin=uniforms.cloudViewOrigin.value.clone(),phase=uniforms.cloudPhase.value.clone();
  const reference=new T.WebGLRenderTarget(3072,768,{type:T.HalfFloatType,depthBuffer:false}),a=new Uint16Array(3072*768*4),b=new Uint16Array(a.length);
  try{
   uniforms.cloudViewOrigin.value.copy(published.position);uniforms.cloudPhase.value.copy(published.phase);renderer.autoClear=true;renderer.setRenderTarget(reference);renderer.render(panoScene,panoCamera);
   renderer.readRenderTargetPixels(panorama,0,0,3072,768,a);renderer.readRenderTargetPixels(reference,0,0,3072,768,b);
   let different=0,nonZeroChannels=0,finiteChannels=0;const rows=new Set();for(let i=0;i<a.length;i++){if(a[i]!==0)nonZeroChannels++;if((a[i]&0x7c00)!==0x7c00)finiteChannels++;if(a[i]!==b[i]){different++;rows.add(Math.floor(i/(3072*4)));}}
   return {passed:different===0&&nonZeroChannels>0&&finiteChannels===a.length,nonZeroChannels,finiteChannels,comparedChannels:a.length,differentChannels:different,differentRows:rows.size,pixelRatio:renderer.getPixelRatio(),completed,lastRefresh:published.cut?'full':'striped',position:published.position.toArray(),phase:published.phase.toArray()};
  }finally{uniforms.cloudViewOrigin.value.copy(origin);uniforms.cloudPhase.value.copy(phase);renderer.setRenderTarget(target);renderer.autoClear=auto;reference.dispose();}
 };
 return {mesh,uniforms,updateLighting,audit,resources:()=>[...panoramas.map((t,i)=>['cloudPanorama'+i,t]),['cloudShadow',shadowTarget]],status:()=>({blend:uniforms.cloudBlend.value,continuousReprojection:true,completed,pending:!!panoJob,stripe:panoJob?.index??null,lastRefresh:published?.cut?'full':'striped'}),update:t=>{uniforms.skyTime.value=t;uniforms.cloudPhase.value.set(t*5,t*1.7)}};
}
