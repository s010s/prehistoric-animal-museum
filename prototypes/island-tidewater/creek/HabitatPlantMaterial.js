import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {commonModule} from '../vendor/tidewater/src/engine/render/wgsl/common.js';

export function createHabitatPlantMaterial(batch,terrainGPU,view,{name='Sample Vault leaves, wind and current',namespace='sampleHabitat',atlas=null,rigidSolids=false}={}){
 const P=batch.prefix,records=batch.record('index');
 const motion=new ShaderModule({name:namespace+'Motion',deps:[commonModule],uniforms:view,code:`
fn habitatColor(f:f32)->vec3f{let u=u32(f);return vec3f(f32((u>>16u)&255u),f32((u>>8u)&255u),f32(u&255u))/255.0;}
fn habitatRotate(q:vec4f,p:vec3f)->vec3f{return p+cross(q.xyz,cross(q.xyz,p)+p*q.w)*2.0;}
fn habitatBend(xz:vec2f,t:f32,seed:f32,part:f32,weight:f32,mode:f32,flow:vec2f)->vec3f{
 let phase=seed*31.0+part*13.0;
 if(mode<1.5){
  let wind=max(frame.windSpeed*.1,.03);
  let gust=.57+.23*sin(dot(xz,vec2f(.071,.039))-t*.63)+.20*sin(dot(xz,vec2f(-.031,.083))-t*.37);
  let pulse=(.045+wind*.13)*gust+sin(t*2.3+phase)*.018*wind;
  let side=sin(t*5.1+phase+xz.x*.12)*.011*wind;
  return vec3f(frame.windDir.x*pulse-frame.windDir.y*side,-abs(pulse)*.06,frame.windDir.y*pulse+frame.windDir.x*side)*weight;
 }
 let marine=select(0.0,1.0,mode>2.5);
 let surge=sin(t*.77-dot(xz,vec2f(.024,.009))+phase*.12)*.11*marine;
 let current=flow*(.12+sin(t*1.27+phase)*.035);
 let flutter=vec2f(sin(t*2.1+phase),cos(t*1.63+phase))*.015;
 let d=(current+vec2f(surge,surge*.22)+flutter)*weight;
 return vec3f(d.x,-dot(d,d)*.35,d.y);
}`});
 return new Material({name,side:'double',textures:atlas?{habitatAlbedo:atlas}:{},modules:[batch.module,terrainGPU.module,motion],attributes:{aKind:'f32',aData:'vec4f'},varyings:{vHabitatColor:'vec3f',vHabitatAO:'f32',vHabitatMode:'f32'},vertex:`
 let index=${P}RecordIndex(u32(v.aKind),v.instance);
 let r0=${records[0]};let q=${records[1]};let r2=${records[2]};let r3=${records[3]};
 let distance=length(${namespace}View.position-r0.xyz);let grow=1.0-smoothstep(r2.y*.80,r2.y,distance);
 var local=v.position*r0.w*grow;
 if(r2.z>.5&&r2.z<1.5){local.y+=r3.w*smoothstep(.008,.036,v.position.y)*grow;}
 var world=habitatRotate(q,local)+r0.xyz;
 let contact=(1.0-smoothstep(0.0,.13,local.y))${rigidSolids?'*select(0.0,1.0,r3.z>0.0)':''};
 let habitatGround=terrainHeightAt(world.xz);
 world.y+=(habitatGround-.018-r0.y)*contact;
 let weight=v.aData.x*v.aData.x*r3.z*r0.w*grow;
 let now=habitatBend(r0.xz,frame.time,r2.x,v.aData.w,weight,r2.z,r3.xy);
 let old=habitatBend(r0.xz,frame.time-frame.dt,r2.x,v.aData.w,weight,r2.z,r3.xy);
 v.useWorld=true;v.worldPos=world+now;v.prevWorldPos=world+old;v.worldNormal=normalize(habitatRotate(q,v.normal));
 o.vHabitatColor=habitatColor(v.aData.y)*(vec3f(.88,.91,.84)+r2.x*.16);
 o.vHabitatAO=v.aData.z;o.vHabitatMode=r2.z;
`,surface:`
 s.albedo=in.vs.vHabitatColor;
 ${atlas?'s.albedo*=textureSample(habitatAlbedo,smpAnisoRepeat,in.uv).rgb;':''}
 s.roughness=select(.86,.75,in.vs.vHabitatMode>1.5);s.metalness=0.0;s.specularIntensity=.12;
 s.ao=in.vs.vHabitatAO;s.translucency=s.albedo*select(.12,.035,in.vs.vHabitatMode>1.5);
`});
}
