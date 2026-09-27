import * as T from 'three'
import {CLOUD_GLSL} from '../../src/flight-experience/environment/cloud-shared.glsl.ts'
// All values are linear radiance. Sky, land haze and distant sea share this endpoint.
// World-anchored cloud slab has thickness, wind and parallax; it is not an environment photograph.
export const skyGLSL=`
${CLOUD_GLSL.replace('int reach=d.y<.08?3:(d.y<.18?2:1);','int reach=1;').replace('for(int z=-3;z<=3;z++)for(int x=-3;x<=3;x++)','for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++)')}
uniform vec3 skySun;uniform float skyTime;uniform sampler2D cloudWeather;
vec3 skyGradient(vec3 d){
 float y=max(d.y,0.);vec3 c=mix(vec3(.50,.61,.66),vec3(.39,.52,.62),smoothstep(0.,.075,y));
 c=mix(c,vec3(.19,.35,.49),smoothstep(.025,.32,y));c=mix(c,vec3(.075,.22,.38),smoothstep(.24,.85,y));
 float forward=pow(max(0.,dot(normalize(vec3(d.x,.001,d.z)),normalize(vec3(skySun.x,.001,skySun.z)))),8.);
 return c+vec3(.075,.055,.025)*forward*exp(-y*9.);
}
vec3 skyRadiance(vec3 d,vec3 origin){
 vec3 c=skyGradient(d);float mu=max(0.,dot(d,skySun));float angle=sqrt(max(0.,2.*(1.-mu)));
 float solar=(1.-smoothstep(.0038,.0052,angle))*10.+exp(-pow(angle/.022,2.))*.12;
 c=cloudSky(origin,d,c,vec3(.12,.26,.40),vec3(1.,.90,.72),skySun);
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
 const weather=await new T.TextureLoader().loadAsync('./assets/cloud-weather-r4.png');weather.wrapS=weather.wrapT=T.RepeatWrapping;
 const uniforms={skySun:{value:sunDirection},skyTime:{value:0},cloudWeather:{value:weather},cloudDensityMap:{value:weather},cloudOrigin:{value:new T.Vector2()},cloudPhase:{value:new T.Vector2()},cloudCoverage:{value:.38},cloudThickness:{value:1.7},cloudDataReady:{value:1},cloudAppearanceWeight:{value:1},weatherHaze:{value:0},rainWetness:{value:0}};
 const material=new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,depthTest:false,
 vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}',
 fragmentShader:`varying vec3 skyDirection;${skyGLSL}\nvoid main(){gl_FragColor=vec4(distantRadiance(normalize(skyDirection)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
 const mesh=new T.Mesh(new T.SphereGeometry(1,32,16),material);mesh.frustumCulled=false;mesh.renderOrder=-1000;
 mesh.onBeforeRender=(_r,_s,c)=>{mesh.position.copy(c.position);mesh.updateMatrixWorld()};
 return {mesh,uniforms,update:t=>{uniforms.skyTime.value=t;uniforms.cloudPhase.value.set(t*5,t*1.7)}};
}
