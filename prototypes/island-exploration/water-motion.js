import * as T from 'three'
import {riverLevel,riverX} from './field.js'
import {riverReach} from './hydrology.js'
// Wavelengths/directions from the original flight world's ocean-waves.ts.
// Irregular phase and amplitude envelopes break rows without resetting animation.
export const swellGLSL=`
uniform float time,terrainSpan;uniform sampler2D coastDepth;uniform vec2 oceanCenter;
float oceanHash(vec2 p){return fract(sin(dot(mod(p,4096.),vec2(127.1,311.7)))*43758.5453);}
vec3 oceanNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);float a=oceanHash(i),b=oceanHash(i+vec2(1,0)),c=oceanHash(i+vec2(0,1)),d=oceanHash(i+1.);return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),du*vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x)));}
float coastAttenuation(vec2 p){vec2 uv=p/terrainSpan+.5;float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);float depth=mix(40.,texture2D(coastDepth,clamp(uv,0.,1.)).r*40.,inside);return smoothstep(.3,8.,depth);}
vec3 wavePacket(vec2 p,float angle,float wavelength,float amp,float speed,float seed){
 vec2 dir=vec2(cos(angle),sin(angle));float k=6.2831853/wavelength;
 vec3 warp=oceanNoise(p/128.+seed),env=oceanNoise(p/210.+seed+vec2(17.,31.));
 float phase=dot(p,dir)*k+warp.x*6.-time*speed+seed,weight=.25+.75*env.x;
 vec2 gradient=dir*k+warp.yz*(6./128.);
 return vec3(amp*weight*sin(phase),amp*(weight*cos(phase)*gradient+env.yz*(.75/210.)*sin(phase)));
}
vec3 swell(vec2 p){float fade=1.-smoothstep(900.,2400.,length(p-oceanCenter));
 return (wavePacket(p,-.44,137.,.56,.57,1.2)+wavePacket(p,.82,83.,.37,.71,8.7)+wavePacket(p,.12,41.,.19,.95,19.1))*coastAttenuation(p)*fade;
}
vec2 oceanSlope(vec2 p,float footprint){
 vec2 slope=wavePacket(p,-.44,137.,.56,.57,1.2).yz+wavePacket(p,.82,83.,.37,.71,8.7).yz+wavePacket(p,.12,41.,.19,.95,19.1).yz;
 slope+=wavePacket(p,1.13,23.,.095,1.17,29.4).yz*(1.-smoothstep(2.,8.,footprint));
 slope+=wavePacket(p,-.61,9.7,.13,1.61,41.8).yz*(1.-smoothstep(.8,3.,footprint));
 slope+=wavePacket(p,.55,4.3,.06,2.14,53.2).yz*(1.-smoothstep(.35,1.4,footprint));
 slope+=wavePacket(p,-.27,1.73,.034,3.65,73.7).yz*(1.-smoothstep(.12,.55,footprint));
 slope+=wavePacket(p,1.34,.71,.012,5.8,97.3).yz*(1.-smoothstep(.05,.23,footprint));
 return slope*coastAttenuation(p);
}`
export function oceanGeometry(){
 const n=256,p=[],idx=[];
 const axis=t=>Math.sign(t)*(Math.abs(t)*600+Math.pow(Math.abs(t),7)*60000);
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)p.push(axis(x/n*2-1),-.7,axis(z/n*2-1));
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*(n+1)+x;idx.push(i,i+n+1,i+1,i+1,i+n+1,i+n+2)}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(idx);return g;
}
export function makeRockSpray(rocks,uniforms){
 const p=[],seed=[],motion=[];
 const hash=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x)};
 for(let i=0;i<rocks.length;i++){
  const r=rocks[i],reach=riverReach(r.z);if(r.strength<.25||reach.speed<.55)continue;
  for(let j=0;j<24;j++){
   const h=hash(i*19+j),angle=(h-.5)*4.8,bend=Math.atan2(riverX(r.z+1)-riverX(r.z-1),2),dx=Math.sin(angle-bend),dz=-Math.cos(angle-bend);
   p.push(r.x+dx*r.radius*1.03,riverLevel(r.z)+.06,r.z+dz*r.radius*1.03);
   seed.push(h,hash(i*71+j+1),hash(i*11+j+3),r.strength);
   motion.push(dx*(.5+h)*reach.speed,(1.7+hash(i*43+j)*2.4)*Math.min(1.4,reach.speed),dz*.6+reach.speed*.8);
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('spraySeed',new T.Float32BufferAttribute(seed,4));g.setAttribute('launch',new T.Float32BufferAttribute(motion,3));
 const m=new T.ShaderMaterial({uniforms:uniforms,transparent:true,depthTest:false,depthWrite:false,
 vertexShader:`attribute vec4 spraySeed;attribute vec3 launch;uniform float time;uniform vec2 resolution;varying float alpha,vd;
 void main(){float duration=.51+spraySeed.y*.37;float cycle=time/duration+spraySeed.x*17.;float t=fract(cycle)*duration;
 float burst=.55+.45*sin(floor(cycle)*2.399+spraySeed.z*31.);vec3 pos=position+launch*t;pos.y-=4.9*t*t;
 vec4 v=modelViewMatrix*vec4(pos,1.);vd=-v.z;
 alpha=sin(fract(cycle)*3.14159)*spraySeed.w*burst*(1.-smoothstep(70.,230.,vd))*step(position.y-.025,pos.y);
 gl_Position=projectionMatrix*v;gl_PointSize=clamp((.09+spraySeed.z*.16)*resolution.y/max(1.,vd),1.,7.);}`,
 fragmentShader:`#include <packing>
 uniform sampler2D sceneDepth;uniform float cameraNear,cameraFar;uniform vec2 resolution;varying float alpha,vd;
 void main(){float d=-perspectiveDepthToViewZ(texture2D(sceneDepth,gl_FragCoord.xy/resolution).x,cameraNear,cameraFar);if(d<vd)discard;float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.15,1.,r))*alpha;if(a<.015)discard;gl_FragColor=vec4(.80,.88,.87,a*.8);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});const mesh=new T.Points(g,m);mesh.frustumCulled=false;mesh.renderOrder=10;return mesh;
}
