import * as T from 'three'
import {islandCloudGLSL} from './island-clouds.js'
// All values are linear radiance. Sky, land haze and distant sea share this endpoint.
// World-anchored cloud slab has thickness, wind and parallax; it is not an environment photograph.
export const skyGLSL=`
${islandCloudGLSL}
uniform sampler2D cloudPanorama;uniform float cloudPanoramaReady;
uniform vec3 skySun;uniform float skyTime;uniform sampler2D cloudWeather;
vec3 skyGradient(vec3 d){
 float y=max(d.y,0.);vec3 c=mix(vec3(.50,.61,.66),vec3(.29,.43,.59),smoothstep(0.,.075,y));
 c=mix(c,vec3(.095,.23,.43),smoothstep(.025,.32,y));c=mix(c,vec3(.032,.105,.29),smoothstep(.24,.85,y));
 float forward=pow(max(0.,dot(normalize(vec3(d.x,.001,d.z)),normalize(vec3(skySun.x,.001,skySun.z)))),8.);
 return c+vec3(.075,.055,.025)*forward*exp(-y*9.);
}
vec3 skyRadiance(vec3 d,vec3 origin){
 vec3 c=skyGradient(d);float mu=max(0.,dot(d,skySun));float angle=sqrt(max(0.,2.*(1.-mu)));
 float solar=(1.-smoothstep(.0038,.0052,angle))*10.+exp(-pow(angle/.022,2.))*.12;
 if(d.y>0.&&cloudPanoramaReady>.5)c=texture2D(cloudPanorama,vec2(atan(d.z,d.x)/6.2831853+.5,asin(clamp(d.y,0.,1.))/1.5707963)).rgb;
 return c+vec3(1.,.90,.72)*solar;
}
vec3 seaDistance(vec3 ray){
 vec3 reflected=reflect(ray,vec3(0.,1.,0.));float f=.02+.98*pow(1.-max(0.,-ray.y),5.);
 vec3 ocean=mix(vec3(.003,.021,.031),skyGradient(reflected),f);
 return mix(ocean,skyGradient(vec3(ray.x,0.,ray.z)),1.-smoothstep(0.,.024,-ray.y));
}
vec3 distantRadiance(vec3 ray){return ray.y>=0.?skyRadiance(ray,cameraPosition):seaDistance(ray);}
`
export async function makeSky(sunDirection){
 const volumeData=new Uint8Array(await(await fetch('./assets/cloud-volume.bin')).arrayBuffer());if(volumeData.length!==64**3*4)throw Error('Invalid cloud volume');
 const volume=new T.Data3DTexture(volumeData,64,64,64);volume.format=T.RGBAFormat;volume.minFilter=volume.magFilter=T.LinearFilter;volume.wrapS=volume.wrapT=volume.wrapR=T.RepeatWrapping;volume.needsUpdate=true;
 const weather=await new T.TextureLoader().loadAsync('./assets/cloud-weather-r4.png');weather.wrapS=weather.wrapT=T.RepeatWrapping;
 const uniforms={cloudNoiseMap:{value:volume},skySun:{value:sunDirection},skyTime:{value:0},cloudWeather:{value:weather},cloudDensityMap:{value:weather},cloudOrigin:{value:new T.Vector2()},cloudPhase:{value:new T.Vector2()},cloudCoverage:{value:.49},cloudThickness:{value:1.7},cloudDataReady:{value:1},cloudAppearanceWeight:{value:1},weatherHaze:{value:0},rainWetness:{value:0}};
 const panoramas=[0,1].map(()=>new T.WebGLRenderTarget(3072,768,{type:T.HalfFloatType,depthBuffer:false}));for(const p of panoramas)p.texture.wrapS=T.RepeatWrapping;let panorama=panoramas[0],panoJob=null;
 uniforms.cloudPanorama={value:panorama.texture};uniforms.cloudPanoramaReady={value:0};uniforms.cloudViewOrigin={value:new T.Vector3()};
 const panoScene=new T.Scene(),panoCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 panoScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,vertexShader:'varying vec2 uvSky;void main(){uvSky=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`varying vec2 uvSky;uniform vec3 cloudViewOrigin;${skyGLSL}void main(){float az=(uvSky.x-.5)*6.2831853,el=uvSky.y*1.5707963;vec3 d=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el));gl_FragColor=vec4(traceCloudSky(cloudViewOrigin,d,skyGradient(d),vec3(.12,.26,.40),vec3(1.,.90,.72),skySun),1.);}`})));
 const shadowTarget=new T.WebGLRenderTarget(192,192,{depthBuffer:false});
 uniforms.cloudShadow={value:shadowTarget.texture};
 const shadowScene=new T.Scene(),shadowCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 shadowScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
 vertexShader:'varying vec2 uvWorld;void main(){uvWorld=uv;gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`varying vec2 uvWorld;${skyGLSL} void main(){vec2 p=(uvWorld-.5)*20480.;float transmission=cloudTransmission(vec3(p.x,0.,p.y),skySun);gl_FragColor=vec4(vec3(transmission),1.);}`
 })));
 let shadowTime=-1e6,panoTime=-1e6;const lastPanoPosition=new T.Vector3(1e8,1e8,1e8);
 const updateLighting=(renderer,t,camera)=>{
 const shadowDirty=Math.abs(t-shadowTime)>=2,panoDirty=Math.abs(t-panoTime)>=2||lastPanoPosition.distanceTo(camera.position)>16;
 if(!panoJob&&panoDirty)panoJob={index:0,time:t,position:camera.position.clone(),target:panoramas.find(p=>p!==panorama),phase:uniforms.cloudPhase.value.clone(),cut:lastPanoPosition.distanceTo(camera.position)>200};
 if(!shadowDirty&&!panoJob)return;
 const target=renderer.getRenderTarget(),auto=renderer.autoClear,scissor=renderer.getScissor(new T.Vector4()),test=renderer.getScissorTest();renderer.autoClear=true;
 if(panoJob){
  const job=panoJob,phase=uniforms.cloudPhase.value.clone();uniforms.cloudViewOrigin.value.copy(job.position);uniforms.cloudPhase.value.copy(job.phase);renderer.setRenderTarget(job.target);
  renderer.setScissorTest(!job.cut);if(!job.cut)renderer.setScissor(0,job.index*24,3072,24);renderer.render(panoScene,panoCamera);uniforms.cloudPhase.value.copy(phase);
  if(job.cut||++job.index===32){panorama=job.target;uniforms.cloudPanorama.value=panorama.texture;uniforms.cloudPanoramaReady.value=1;panoTime=job.time;lastPanoPosition.copy(job.position);panoJob=null;}
 }
 renderer.setScissorTest(false);
 if(shadowDirty){renderer.setRenderTarget(shadowTarget);renderer.render(shadowScene,shadowCamera);shadowTime=t;}
 renderer.setRenderTarget(target);renderer.setScissor(scissor);renderer.setScissorTest(test);renderer.autoClear=auto;
 };
 const material=new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,depthTest:false,
 vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}',
 fragmentShader:`varying vec3 skyDirection;${skyGLSL}\nvoid main(){gl_FragColor=vec4(distantRadiance(normalize(skyDirection)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
 const mesh=new T.Mesh(new T.SphereGeometry(1,32,16),material);mesh.frustumCulled=false;mesh.renderOrder=-1000;
 mesh.onBeforeRender=(_r,_s,c)=>{mesh.position.copy(c.position);mesh.updateMatrixWorld()};
 return {mesh,uniforms,updateLighting,update:t=>{uniforms.skyTime.value=t;uniforms.cloudPhase.value.set(t*5,t*1.7)}};
}
