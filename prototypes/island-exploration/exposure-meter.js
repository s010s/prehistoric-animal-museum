import * as T from 'three';
// Small HDR log-luminance meter. Readback is asynchronous and changes exposure
// slowly during movement, while teleports get a fresh meter before review.
export function makeExposureMeter(){
 const target=new T.WebGLRenderTarget(24,16,{depthBuffer:false}),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 const uniforms={image:{value:null}};
 scene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D image;varying vec2 v;void main(){vec3 c=texture2D(image,v).rgb;float l=dot(c,vec3(.2126,.7152,.0722));float e=clamp((log2(max(.0001,l))+10.)/16.,0.,1.);gl_FragColor=vec4(e,e,e,1.);}'})));
 let pending=false,tick=0,desired=1.05,mean=0,snap=true,valid=false,error=null;const lastPose=new T.Vector3(1e8,1e8,1e8);
 return {status:()=>({valid,pending,desired,mean,error}),update(renderer,image,viewer){
  if(lastPose.distanceTo(viewer.position)>80){lastPose.copy(viewer.position);snap=true;valid=false;tick=0;}
  renderer.toneMappingExposure+=(desired-renderer.toneMappingExposure)*.045;
  if(pending||tick++%24!==0)return;
  pending=true;const origin=viewer.position.clone(),pixels=new Uint8Array(24*16*4),previous=renderer.getRenderTarget();uniforms.image.value=image.texture;
  renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(previous);
  renderer.readRenderTargetPixelsAsync(target,0,0,24,16,pixels).then(()=>{
   if(origin.distanceTo(viewer.position)>80)return;let sum=0,weight=0;
   for(let y=0;y<16;y++)for(let x=0;x<24;x++){const w=1-Math.min(.7,Math.hypot((x-11.5)/24,(y-7.5)/16));sum+=(pixels[(y*24+x)*4]/255*16-10)*w;weight+=w;}
   mean=2**(sum/weight);desired=T.MathUtils.clamp(.155/Math.max(.01,mean),.85,2.25);valid=true;
   if(snap){renderer.toneMappingExposure=desired;snap=false;}
  }).catch(e=>{error=String(e);valid=true;}).finally(()=>pending=false);
 }};
}
