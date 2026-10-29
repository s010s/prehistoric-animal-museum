import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {StorageBuffer} from '../vendor/tidewater/src/engine/gpu/Texture.js';

// Museum-owned functional articulation for static Vault meshes. The original
// GLBs, native fish shader and compact indirect instance batch remain intact.
// Three per-vertex attributes describe real appendage roots and segment chains.
const motionCode=/* wgsl */`
struct VaultSwimPose { p: vec3f, n: vec3f };
fn vaultRx(p:vec3f,a:f32)->vec3f {let c=cos(a);let s=sin(a);return vec3f(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}
fn vaultRy(p:vec3f,a:f32)->vec3f {let c=cos(a);let s=sin(a);return vec3f(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
fn vaultRz(p:vec3f,a:f32)->vec3f {let c=cos(a);let s=sin(a);return vec3f(c*p.x-s*p.y,s*p.x+c*p.y,p.z);}
// Offset and its derivative with respect to z: normals follow the same body
// wave. Aeger's rigid shell is not deformed as if it were a flexible fish.
fn vaultBody(ph:f32,p:vec3f,amp:f32,bend:f32,pattern:f32)->vec2f {
 if(pattern==99.0){return vec2f(0.0);}
 let u=clamp(0.5-p.z,0.0,1.0);let t=clamp(u/0.25,0.0,1.0);
 let ss=t*t*(3.0-2.0*t);let ds=select(0.0,6.0*t*(1.0-t)/0.25,u>0.0&&u<0.25);
 let env=(0.85*u*u+0.08)*(0.7*ss+0.3);
 let de=1.7*u*(0.7*ss+0.3)+(0.85*u*u+0.08)*0.7*ds;
 let h=clamp((u-0.48)/0.42,0.0,1.0);
 let rigid=select(1.0,h*h*(3.0-2.0*h),pattern==103.0);
 let dr=select(0.0,6.0*h*(1.0-h)/0.42,pattern==103.0&&u>0.48&&u<0.9);
 let a=ph-u*5.6;let wave=sin(a)*env*amp+bend*u*u;
 let deriv=(-5.6*cos(a)*env*amp+sin(a)*de*amp+2.0*bend*u)*rigid+wave*dr;
 return vec2f(wave*rigid,-deriv*select(0.0,1.0,p.z> -0.5&&p.z<0.5));
}
fn vaultPose(ph:f32,src:vec3f,nrm:vec3f,a:f32,b:f32,pattern:f32,r0:vec4f,r1:vec4f,r2:vec4f)->VaultSwimPose {
 var p=src;var n=nrm;let role=floor(r0.w+0.01);let segment=i32(round(fract(r0.w)*4.0));
 let side=select(-1.0,1.0,r0.x>=0.0);let phase=r2.w;let w=clamp(r1.w,0.0,1.0);
 if(role==1.0){
  // Paired fins and radiodont lobes turn about their own proximal edges.
  let t=ph*select(0.62,0.92,pattern==102.0)+phase;
  let lift=side*sin(t)*select(0.38,0.46,pattern==102.0);
  let sweep=side*cos(t-0.5)*select(0.19,0.08,pattern==102.0);
  let q=p-r0.xyz;let rp=vaultRy(vaultRz(q,lift),sweep);
  p=r0.xyz+mix(q,rp,w);n=normalize(mix(n,vaultRy(vaultRz(n,lift),sweep),w));
 }else if(role==2.0){
  let yaw=sin(ph*0.31+phase)*0.16*w;let tip=sin(ph*0.48+phase)*0.055*w;
  p=r0.xyz+vaultRz(vaultRy(p-r0.xyz,yaw),tip);n=vaultRz(vaultRy(n,yaw),tip);
 }else if(role==3.0||role==4.0){
  let cycle=fract((ph+phase)/6.28318530718);let stance=cycle<0.64;
  let t=select((cycle-0.64)/0.36,cycle/0.64,stance);
  let ease=t*t*(3.0-2.0*t);let drive=clamp(a,0.0,1.0);
  let sweep=select(0.28-0.56*ease,-0.28+0.56*t,stance)*drive;
  let lift=select(sin(t*3.14159265359)*0.40,0.0,stance)*drive;
  let feeding=select(1.0,0.45,role==4.0);
  let hipYaw=side*sweep*feeding;let hipLift=side*lift*feeding;
  let knee=-side*lift*0.72*feeding;let ankle=side*lift*0.30*feeding;
  if(segment>=2){p=r2.xyz+vaultRz(p-r2.xyz,ankle);n=vaultRz(n,ankle);}
  if(segment>=1){p=r1.xyz+vaultRz(p-r1.xyz,knee);n=vaultRz(n,knee);}
  p=r0.xyz+vaultRy(vaultRz(p-r0.xyz,hipLift),hipYaw);n=vaultRy(vaultRz(n,hipLift),hipYaw);
 }else if(role==5.0){
  let stroke=sin(ph*1.1+phase)*0.44;
  p=r0.xyz+vaultRx(p-r0.xyz,stroke);n=vaultRx(n,stroke);
 }
 let body=vaultBody(ph,p,a,b,pattern);p.x+=body.x;
 n=normalize(vec3f(n.x,n.y,n.z-body.y*n.x));return VaultSwimPose(p,n);
}
`;

export function createVaultSwimMotion(batch){
 const previous=new Float32Array(batch.maxInstances*8);
 const buffer=new StorageBuffer({label:'Museum life.previous articulation',count:batch.maxInstances*2,type:'vec4f'});
 const module=new ShaderModule({name:'museum-vault-swim',bindings:{vaultSwimPrevious:{storage:buffer,access:'read'}},code:motionCode});
 return {previous,module,upload(){buffer.write(previous);}};
}

export function articulateVaultSwimMaterial(material,motion){
 material.modules.push(motion.module);
 Object.assign(material.attributes,{aRig0:'vec4f',aRig1:'vec4f',aRig2:'vec4f'});
 // Keep the native fish path exactly as supplied upstream; only imported
 // static species use this articulation, including shadow/depth/refraction.
 material.vertex+=/* wgsl */`
 if(pattern>=98.0){
  let posed=vaultPose(r2.x,v.position,v.normal,r2.y,r2.z,pattern,v.aRig0,v.aRig1,v.aRig2);
  let oldQ=vaultSwimPrevious[ri*2u];let oldAB=vaultSwimPrevious[ri*2u+1u];
  let prev=vaultPose(r2.x-r3.w,v.position,v.normal,oldAB.x,oldAB.y,pattern,v.aRig0,v.aRig1,v.aRig2);
  v.worldPos=fishRotateQ(q,posed.p*r0.w)+r0.xyz;
  v.worldNormal=fishRotateQ(q,posed.n);
  v.prevWorldPos=fishRotateQ(oldQ,prev.p*r0.w)+r0.xyz-r3.xyz;
 }
`;
}
