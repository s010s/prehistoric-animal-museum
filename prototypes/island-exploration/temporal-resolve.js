// Stable-output-grid HDR history. No projection jitter, velocities or upscaling.
// Failure inventory preceded this replacement: phase8/temporal-failures.md.
import * as T from 'three';

export const temporalResolveEnabled={value:false};
export const temporalSampleIndex={value:0};
export const temporalChromaEnabled={value:false};
export function setTemporalChroma(enabled){temporalChromaEnabled.value=Boolean(enabled);}
const fragmentShader=`
uniform sampler2D currentColor,currentDepth,historyColorDepth;
uniform mat4 inverseProjection,cameraWorld,previousView,previousProjection;
uniform vec2 imageSize;
uniform float historyWeight,neutralHistoryWeight,waterHeight;
uniform bool historyValid,waterGuard,cameraUnchanged,temporalChromaEnabled;
varying vec2 vUv;
float temporalLuminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float temporalMax(vec3 c){return max(c.x,max(c.y,c.z));}
float temporalDepth(vec2 uv,float d){
 vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);
 return -p.z/p.w;
}
void main(){
 vec3 current=texture2D(currentColor,vUv).rgb;
 float depth=texture2D(currentDepth,vUv).r;
 vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
 view/=view.w;
 float viewDepth=-view.z;
 bool validDepth=depth<.9999999&&depth>=0.&&viewDepth>0.&&viewDepth<65000.;
 vec3 result=current;
 if(historyValid&&validDepth){
  vec4 world=cameraWorld*view;
  vec4 oldView=previousView*world,oldClip=previousProjection*oldView;
  float expectedDepth=-oldView.z;
  if(oldClip.w>0.&&expectedDepth>0.&&(!waterGuard||world.y>waterHeight+.2)){
   vec3 ndc=oldClip.xyz/oldClip.w;
   vec2 oldUv=ndc.xy*.5+.5,halfPixel=.5/imageSize;
   // Avoid floating-point matrix round trips moving a stationary sample off
   // its exact texel centre. Both histories use the unjittered output grid.
   if(cameraUnchanged){oldUv=vUv;expectedDepth=viewDepth;}
   if(all(greaterThanEqual(oldUv,halfPixel))&&all(lessThanEqual(oldUv,1.-halfPixel))&&ndc.z>=-1.&&ndc.z<=1.){
    // RGB is bilinear; depth is fetched at an exact history texel centre.
    vec2 depthUv=(floor(oldUv*imageSize)+.5)/imageSize;
    float oldDepth=texture2D(historyColorDepth,depthUv).a;
    // RGBA16F depth quantization grows with distance; this remains a geometric
    // disocclusion test, not an object-motion estimate.
    float tolerance=.08+.002*expectedDepth;
    if(oldDepth>0.&&abs(oldDepth-expectedDepth)<=tolerance){
     // Silhouettes have unreliable object correspondence without velocities.
     // Reject history at cardinal depth breaks, including transparent/sky
     // boundaries, rather than pulling foreground colour into a reveal.
     bool depthContinuous=true;
     for(int i=0;i<4;i++){
      vec2 offset=i==0?vec2(-1.,0.):i==1?vec2(1.,0.):i==2?vec2(0.,-1.):vec2(0.,1.);
      vec2 uv=clamp(vUv+offset/imageSize,halfPixel,1.-halfPixel);
      float d=texture2D(currentDepth,uv).r;
      float z=temporalDepth(uv,d);
      if(d>=.9999999||z<=0.||abs(z-viewDepth)>max(.12,.02*viewDepth))depthContinuous=false;
     }
     if(depthContinuous){
     vec3 lower=current,upper=current,mean=current,second=current*current;
     for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      if(x!=0||y!=0){
       vec2 uv=clamp(vUv+vec2(float(x),float(y))/imageSize,halfPixel,1.-halfPixel);
       vec3 sampleColor=texture2D(currentColor,uv).rgb;
       lower=min(lower,sampleColor);upper=max(upper,sampleColor);
       mean+=sampleColor;second+=sampleColor*sampleColor;
      }
     }
     mean/=9.;vec3 sigma=sqrt(max(second/9.-mean*mean,vec3(0.)));
     // Include current in the envelope: a fixed scene must not drift toward
     // a spatial mean just because an edge is an outlier in its neighborhood.
     lower=min(current,max(lower,mean-1.25*sigma));
     upper=max(current,min(upper,mean+1.25*sigma));
     vec3 rawHistory=texture2D(historyColorDepth,oldUv).rgb;
     float lumaChange=abs(temporalLuminance(rawHistory)-temporalLuminance(current))/max(.05,max(abs(temporalLuminance(rawHistory)),abs(temporalLuminance(current))));
     float rgbChange=temporalMax(abs(rawHistory-current))/max(.1,max(temporalMax(abs(rawHistory)),temporalMax(abs(current))));
     // React to raw disagreement before clipping, including equal-luma colour
     // changes. Small radiance variation accumulates; large reveals do not.
     float weight=historyWeight*(1.-smoothstep(.1,.4,max(lumaChange,rgbChange)));
     if(temporalChromaEnabled){
      // A scalar shadow change preserves chromaticity. Let it accumulate with
      // shorter memory than the nominal history; an animal reveal still needs
      // the unchanged depth/silhouette guards, particularly for equal hues.
      vec3 positiveCurrent=max(current,vec3(0.)),positiveHistory=max(rawHistory,vec3(0.));
      float currentSum=dot(positiveCurrent,vec3(1.)),historySum=dot(positiveHistory,vec3(1.));
      float chromaChange=0.;
      if(min(currentSum,historySum)>.01)chromaChange=temporalMax(abs(positiveCurrent/currentSum-positiveHistory/historySum));
      weight=neutralHistoryWeight*(1.-smoothstep(.04,.15,chromaChange))*(1.-smoothstep(.7,.95,lumaChange));
     }
     vec3 history=clamp(rawHistory,lower,upper);
     result=mix(current,history,weight);
     }
    }
   }
  }
 }
 // Alpha is a history-only depth payload. Final presentation MUST set alpha 1.
 gl_FragColor=vec4(result,validDepth?viewDepth:0.);
}`;

export function makeTemporalResolve({enabled=false,historyWeight=.8,maxPixels=921600,now=()=>performance.now()}={}){
 if(!Number.isFinite(historyWeight)||historyWeight<0||historyWeight>.85)throw Error('Temporal history weight must be within [0, .85]');
 if(!Number.isInteger(maxPixels)||maxPixels<1||maxPixels>921600)throw Error('Temporal target exceeds protected pixel budget');
 let active=null,targets=[],width=0,height=0,readIndex=0,valid=false,disposed=false,paused=false,appliedHistoryWeight=historyWeight;
 let lastTime=null,lastWall=null,lastColor=null,lastDepth=null,lastReset='initial',lastBypass=null,lastEligible=false,lastChroma=null;
 let frames=0,seedFrames=0,historyEligibleFrames=0,resets=0;
 const resetCounts={},previousProjection=new T.Matrix4(),previousView=new T.Matrix4(),previousPosition=new T.Vector3(),previousQuaternion=new T.Quaternion(),previousBaseProjection=new T.Matrix4();
 const uniforms={currentColor:{value:null},currentDepth:{value:null},historyColorDepth:{value:null},inverseProjection:{value:new T.Matrix4()},cameraWorld:{value:new T.Matrix4()},previousView:{value:previousView},previousProjection:{value:previousProjection},imageSize:{value:new T.Vector2()},historyWeight:{value:historyWeight},neutralHistoryWeight:{value:Math.min(historyWeight,.65)},temporalChromaEnabled,waterHeight:{value:0},historyValid:{value:false},waterGuard:{value:false},cameraUnchanged:{value:false}};
 const material=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,transparent:false,blending:T.NoBlending,toneMapped:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader});
 const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),quad=new T.Mesh(geometry,material),screenCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 quad.frustumCulled=false;scene.add(quad);
 const releaseTargets=()=>{targets.forEach(target=>target.dispose());targets=[];width=height=0;uniforms.historyColorDepth.value=null;};
 function endFrame(camera){
  if(!active)return;
  if(camera&&camera!==active.camera)throw Error('Temporal frame camera ownership mismatch');
  // This version owns a frame, never a mutated camera projection.
  active=null;
 }
 function reset(reason='explicit reset'){
  endFrame();valid=false;temporalSampleIndex.value=0;lastReset=String(reason);lastEligible=false;
  lastTime=lastWall=lastColor=lastDepth=lastChroma=null;resets++;resetCounts[lastReset]=(resetCounts[lastReset]??0)+1;
 }
 function setEnabled(value){
  const next=Boolean(value)&&!disposed;
  if(temporalResolveEnabled.value===next)return;
  reset(next?'enabled':'disabled');temporalResolveEnabled.value=next;
  if(!next)releaseTargets();
 }
 function beginFrame(camera,w,h,time){
  lastBypass=null;
  if(disposed||!temporalResolveEnabled.value||paused)return null;
  if(active)throw Error('Temporal beginFrame called before endFrame');
  if(!camera?.isPerspectiveCamera||camera.coordinateSystem!==T.WebGLCoordinateSystem||camera.reversedDepth){lastBypass='unsupported camera/depth convention';reset(lastBypass);return null;}
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>maxPixels||!Number.isFinite(time)){lastBypass='invalid or over-budget frame';reset(lastBypass);return null;}
  camera.updateMatrixWorld();const wall=now();
  if(!Number.isFinite(wall))throw Error('Temporal wall clock must be finite');
  if(valid){
   let reason=null;
   if(lastChroma!==temporalChromaEnabled.value)reason='reactivity change';
   else if(w!==width||h!==height)reason='resize';
   else if(!camera.projectionMatrix.equals(previousBaseProjection))reason='projection change';
   else if(camera.position.distanceTo(previousPosition)>8||Math.abs(camera.quaternion.dot(previousQuaternion))<Math.cos(Math.PI/12))reason='camera cut';
   else if(time<lastTime)reason='world time rewind';
   else if(time-lastTime>.25||wall-lastWall>250||wall<lastWall)reason='clock gap';
   if(reason)reset(reason);
  }
  temporalSampleIndex.value=0;
  active={camera,w,h,time,wall,baseProjection:camera.projectionMatrix.clone()};
  return {phase:0,jitterPixels:[0,0],width:w,height:h};
 }
 function ensureTargets(w,h){
  if(targets.length&&width===w&&height===h)return;
  releaseTargets();width=w;height=h;valid=false;
  targets=[0,1].map(i=>{
   const target=new T.WebGLRenderTarget(w,h,{type:T.HalfFloatType,format:T.RGBAFormat,depthBuffer:false,stencilBuffer:false,samples:0,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false});
   target.texture.name='temporalHDRDepth'+i;target.texture.colorSpace=T.NoColorSpace;return target;
  });readIndex=0;
 }
 function resolve(renderer,{color,depth,camera,time,waterHeight=null}={}){
  if(disposed||!temporalResolveEnabled.value||paused)return color;
  if(!active||active.camera!==camera){lastBypass='missing/mismatched beginFrame';reset(lastBypass);return color;}
  if(!color?.isTexture||!depth?.isDepthTexture||time!==active.time){reset('invalid resolve input');throw Error('Temporal resolve requires matching time, HDR colour and resolved opaque depth');}
  // A source replacement invalidates history, but not frame ownership.
  if(valid&&(color!==lastColor||depth!==lastDepth)){valid=false;lastReset='source replacement';resets++;resetCounts[lastReset]=(resetCounts[lastReset]??0)+1;}
  ensureTargets(active.w,active.h);
  const writeIndex=1-readIndex,write=targets[writeIndex],read=targets[readIndex];
  if(color===write.texture||color===read.texture||depth===write.texture)throw Error('Temporal resolve input must not alias history attachments');
  uniforms.currentColor.value=color;uniforms.currentDepth.value=depth;uniforms.historyColorDepth.value=read.texture;
  uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);uniforms.cameraWorld.value.copy(camera.matrixWorld);
  uniforms.imageSize.value.set(width,height);uniforms.historyValid.value=valid;
  uniforms.cameraUnchanged.value=valid&&camera.matrixWorldInverse.equals(previousView)&&camera.projectionMatrix.equals(previousProjection);
  appliedHistoryWeight=Math.pow(historyWeight,valid?Math.max(1,(time-lastTime)*60):1);
  uniforms.historyWeight.value=appliedHistoryWeight;
  uniforms.neutralHistoryWeight.value=Math.pow(Math.min(historyWeight,.65),valid?Math.max(1,(time-lastTime)*60):1);
  uniforms.waterGuard.value=Number.isFinite(waterHeight);uniforms.waterHeight.value=Number.isFinite(waterHeight)?waterHeight:0;
  const oldTarget=renderer.getRenderTarget(),oldAuto=renderer.autoClear,oldXr=renderer.xr.enabled;
  const eligible=valid;
  try{
   renderer.xr.enabled=false;renderer.autoClear=false;renderer.setRenderTarget(write);renderer.render(scene,screenCamera);
  }catch(error){valid=false;lastEligible=false;lastReset='resolve failed';throw error;}
  finally{renderer.setRenderTarget(oldTarget);renderer.autoClear=oldAuto;renderer.xr.enabled=oldXr;}
  previousProjection.copy(camera.projectionMatrix);previousBaseProjection.copy(active.baseProjection);previousView.copy(camera.matrixWorldInverse);
  previousPosition.copy(camera.position);previousQuaternion.copy(camera.quaternion);
  lastTime=time;lastWall=active.wall;lastColor=color;lastDepth=depth;lastChroma=temporalChromaEnabled.value;readIndex=writeIndex;valid=true;lastEligible=eligible;
  frames++;if(eligible)historyEligibleFrames++;else seedFrames++;
  return write.texture;
 }
 temporalResolveEnabled.value=false;setEnabled(enabled);
 return {beginFrame,resolve,endFrame,reset,setEnabled,
  setPaused(value){const next=Boolean(value);if(next!==paused){paused=next;reset(next?'paused':'resumed');}},
  resources:()=>targets.map((target,i)=>['temporalHDRDepth'+i,target]),
  status:()=>({enabled:temporalResolveEnabled.value,mode:'stable-grid-history',reactivity:temporalChromaEnabled.value?'chroma-neutral-cap':'raw-radiance-rgb',temporalChromaEnabled:temporalChromaEnabled.value,neutralHistoryCap:.65,appliedNeutralHistoryWeight:uniforms.neutralHistoryWeight.value,projectionJitter:false,paused,disposed,historyValid:valid,lastHistoryEligible:lastEligible,phase:0,nextPhase:0,jitterPixels:[0,0],width,height,targets:targets.length,estimatedTargetBytes:width*height*16,extraPasses:temporalResolveEnabled.value?1:0,maxTextureSamplesPerPixel:16,historyWeight,appliedHistoryWeight,weightReferenceHz:60,frames,seedFrames,historyEligibleFrames,resets,resetCounts:{...resetCounts},lastReset,lastBypass,lastTime,frameActive:Boolean(active),depthPayload:'history alpha is linear view depth; sky/invalid depth is zero',pixelAcceptance:'not measured; counters describe CPU frame eligibility, not GPU pixel reuse',scope:'stable-grid camera reprojection only; no object velocities, no upscaling; water/spray depth incomplete',motionProtection:'depth and silhouette rejection; current-neighborhood variance clamp; selectable chroma or raw radiance/RGB reactivity'}),
  dispose(){if(disposed)return;setEnabled(false);endFrame();releaseTargets();material.dispose();geometry.dispose();disposed=true;},
 };
}
