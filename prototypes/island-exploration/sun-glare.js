import * as T from 'three';

// Optical layout and disc occlusion follow Tidewater LensFlare (MIT),
// DRG Software Solutions LLC, fixed source 4811ba48d795197de5621985f404e765c0b7c0ef.
// This module measures one scalar; its 24 depth taps do not describe the cost of
// the procedural shapes evaluated by the existing fullscreen display shader.
export const SUN_GLARE_TAPS=24;
const SUN_RADIUS=.00465;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

export function visibilityBlend(deltaSeconds){
 return Number.isFinite(deltaSeconds)?1-Math.exp(-14*Math.max(0,Math.min(.1,deltaSeconds))):0;
}

// Direction projection has w=0 so world position/large island coordinates do
// not change the apparent solar direction. No camera jitter or matrix edits.
export function projectSunGlare(camera,sun,waterHeight){
 const sunUv=new T.Vector2(.5,.5),discUv=new T.Vector2(),sunView=new T.Vector3();
 const result={eligible:false,sunUv,discUv,sunView,edgeWeight:0};
 if(!sun||!Number.isFinite(sun.x+sun.y+sun.z)||sun.lengthSq()<1e-12||!Number.isFinite(waterHeight)||camera.position.y<=waterHeight+.05)return result;
 const direction=sun.clone().normalize();
 if(direction.y<=0)return result;
 camera.updateMatrixWorld();
 const view=new T.Vector4(direction.x,direction.y,direction.z,0).applyMatrix4(camera.matrixWorldInverse);
 sunView.set(view.x,view.y,view.z).normalize();
 if(-sunView.z<=.05)return result;
 const projected=view.applyMatrix4(camera.projectionMatrix);
 if(!Number.isFinite(projected.x+projected.y+projected.w)||projected.w<=0)return result;
 const x=projected.x/projected.w,y=projected.y/projected.w,edge=Math.max(Math.abs(x),Math.abs(y));
 sunUv.set(x*.5+.5,y*.5+.5); // WebGL render target UV origin is bottom-left.
 discUv.set(SUN_RADIUS*Math.abs(camera.projectionMatrix.elements[0])*.5/-sunView.z,SUN_RADIUS*Math.abs(camera.projectionMatrix.elements[5])*.5/-sunView.z);
 result.edgeWeight=(1-smooth(.9,1,edge))*smooth(0,.04,direction.y);
 result.eligible=edge<1&&result.edgeWeight>0;
 return result;
}

// Add the returned radiance to linear HDR before the one existing exposure /
// tone mapping / display conversion. Inactive and fully occluded pixels branch
// before any aperture, halo or glare shape evaluation.
export const sunGlareGLSL=`
uniform sampler2D glareVisibilityTex;
uniform float glareActive,glareAspect,glareStrength;
uniform vec2 glareSunUv;
float glareAperture(vec2 q){float a=atan(q.y,q.x)+.3;float seg=.897597901;return length(q)*cos(floor(a/seg+.5)*seg-a);}
vec3 glareGhost(vec2 p,vec2 s,float axis,float radius,vec3 tint,float energy){
 float d=glareAperture(p-s*axis);
 float body=1.-smoothstep(radius*.82,radius,d);
 float rim=.3+.7*smoothstep(radius*.5,radius,d);
 return tint*body*rim*energy;
}
vec3 sunGlareLight(vec2 uv){
 if(glareActive<.5)return vec3(0.);
 float visibility=texture2D(glareVisibilityTex,vec2(.5)).r;
 if(visibility<=0.)return vec3(0.);
 vec2 p=(uv-.5)*vec2(glareAspect,1.),s=(glareSunUv-.5)*vec2(glareAspect,1.);
 float offAxis=smoothstep(.025,.2,length(s));
 vec3 ghosts=glareGhost(p,s,.55,.025,vec3(1.,.82,.56),.035)
  +glareGhost(p,s,-.22,.06,vec3(.52,.76,1.),.018)
  +glareGhost(p,s,-.72,.095,vec3(.64,1.,.79),.010);
 float r=length(p),off=smoothstep(.25,.7,length(s));
 vec3 halo=vec3(1.-smoothstep(0.,.035,abs(r-.43)),1.-smoothstep(0.,.035,abs(r-.445)),1.-smoothstep(0.,.035,abs(r-.46)))*off*.004;
 float q=length(p-s);
 vec3 veil=vec3(1.,.90,.72)*(exp(-q*7.)*.006+exp(-q*55.)*.028);
 return (ghosts*offAxis+halo+veil)*visibility*glareStrength;
}`;

const visibilityGLSL=`
uniform sampler2D glareDepth,glarePrevious,cloudPanorama,cloudPrevious;
uniform mat4 glareProjection;
uniform vec3 glareSunView,glareSunDirection,glareCameraPosition,cloudPublishedOrigin,cloudPreviousOrigin;
uniform vec2 cloudPublishedPhase,cloudPreviousPhase,cloudPhase;
uniform float glareDelta,glareEdgeWeight,cloudPanoramaReady,cloudBlend;
vec4 glareCachedCloud(sampler2D tx,vec3 origin,vec2 phaseOffset){
 vec3 d=glareSunDirection;
 float distanceToCloud=max(1.,(6000.-glareCameraPosition.y)/max(.025,d.y));
 vec3 hit=glareCameraPosition+d*distanceToCloud;
 hit.xz+=phaseOffset;
 vec3 r=normalize(hit-origin);
 return texture2D(tx,vec2(atan(r.z,r.x)/6.2831853+.5,asin(clamp(r.y,0.,1.))/1.5707963));
}
void main(){
 vec3 right=normalize(cross(vec3(0.,1.,0.),glareSunView));
 vec3 up=cross(glareSunView,right);
 float sky=0.;
 for(int i=0;i<24;i++){
  float radius=sqrt((float(i)+.5)/24.)*.00465,angle=float(i)*2.39996323;
  vec3 ray=normalize(glareSunView+radius*(right*cos(angle)+up*sin(angle)));
  vec4 projected=glareProjection*vec4(ray,0.);
  vec2 uv=projected.xy/projected.w*.5+.5;
  if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){
   sky+=step(.9999999,texture2D(glareDepth,uv).r);
  }
 }
 float cloudT=1.;
 if(cloudPanoramaReady>.5){
  // Same cached panoramas, origins, phases, blend and alpha remap as skyRadiance.
  vec4 previous=glareCachedCloud(cloudPrevious,cloudPreviousOrigin,cloudPreviousPhase-cloudPhase);
  vec4 current=glareCachedCloud(cloudPanorama,cloudPublishedOrigin,cloudPublishedPhase-cloudPhase);
  float alpha=mix(previous.a,current.a,cloudBlend);
  cloudT=alpha*smoothstep(.004,.04,alpha);
 }
 float target=sky/24.*cloudT*glareEdgeWeight;
 float visibility=mix(texture2D(glarePrevious,vec2(.5)).r,target,1.-exp(-14.*glareDelta));
 // Spare channels preserve existing scalar inputs for explicit 8-byte review.
 // Ordinary output samples red only; nothing is read back during normal play.
 gl_FragColor=vec4(clamp(visibility,0.,1.),sky/24.,cloudT,1.);
}`;

export function makeSunGlare(skyUniforms){
 const cloudKeys=['cloudPanorama','cloudPrevious','cloudPanoramaReady','cloudBlend','cloudPublishedOrigin','cloudPreviousOrigin','cloudPublishedPhase','cloudPreviousPhase','cloudPhase'];
 for(const key of cloudKeys)if(!skyUniforms?.[key])throw Error('Sun glare requires cached sky uniform '+key);
 const zero=new T.DataTexture(new Uint8Array(4),1,1,T.RGBAFormat);zero.minFilter=zero.magFilter=T.NearestFilter;zero.needsUpdate=true;
 const targets=[0,1].map(()=>new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false,stencilBuffer:false,samples:0}));
 const uniforms={glareVisibilityTex:{value:zero},glareActive:{value:0},glareSunUv:{value:new T.Vector2(.5,.5)},glareAspect:{value:1},glareStrength:{value:1}};
 const measure={glareDepth:{value:zero},glarePrevious:{value:zero},glareProjection:{value:new T.Matrix4()},glareSunView:{value:new T.Vector3()},glareSunDirection:{value:new T.Vector3()},glareCameraPosition:{value:new T.Vector3()},glareDelta:{value:0},glareEdgeWeight:{value:0}};
 for(const key of cloudKeys){
  measure[key]=skyUniforms[key];
 }
 const material=new T.ShaderMaterial({uniforms:measure,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:visibilityGLSL});
 const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),camera2D=new T.OrthographicCamera(-1,1,1,-1,0,1);scene.add(new T.Mesh(geometry,material));
 let enabled=true,disposed=false,eligible=false,updates=0,historyValid=false,historyReset='initial',writeIndex=0,lastTime=null,lastSun=null,lastPosition=null,lastQuaternion=null,lastProjection=null;
 const reset=reason=>{historyValid=false;uniforms.glareVisibilityTex.value=zero;uniforms.glareActive.value=0;historyReset=reason;};
 return {
  uniforms,
  setEnabled(value){enabled=Boolean(value);if(!enabled){eligible=false;reset('disabled');}},
  update(renderer,{depth,camera,sun,time,waterHeight}){
   if(disposed)return;
   const projection=projectSunGlare(camera,sun,waterHeight),finiteTime=Number.isFinite(time),dt=lastTime===null?1/60:time-lastTime;
   const timeReset=lastTime!==null&&(!finiteTime||dt<0||dt>.5);
   const cameraCut=lastPosition&&(lastPosition.distanceToSquared(camera.position)>100||lastQuaternion.angleTo(camera.quaternion)>.35||!lastProjection.equals(camera.projectionMatrix));
   const sunChanged=lastSun&&sun&&lastSun.angleTo(sun)>.001;
   const moved=lastPosition&&(lastPosition.distanceToSquared(camera.position)>1e-8||lastQuaternion.angleTo(camera.quaternion)>1e-6);
   lastTime=finiteTime?time:null;lastPosition??=new T.Vector3();lastPosition.copy(camera.position);lastQuaternion??=new T.Quaternion();lastQuaternion.copy(camera.quaternion);lastProjection??=new T.Matrix4();lastProjection.copy(camera.projectionMatrix);lastSun??=new T.Vector3();if(sun)lastSun.copy(sun);else lastSun.set(0,0,0);
   eligible=Boolean(enabled&&depth&&finiteTime&&projection.eligible);
   uniforms.glareSunUv.value.copy(projection.sunUv);uniforms.glareAspect.value=Math.max(.01,camera.aspect);
   if(!eligible){reset(enabled?'ineligible':'disabled');return;}
   if(timeReset||cameraCut||sunChanged){reset(timeReset?'time-reset':cameraCut?'camera-cut':'sun-change');return;}
   if(dt===0){if(moved)reset('zero-dt-motion');return;}
   measure.glareDepth.value=depth;measure.glarePrevious.value=historyValid?uniforms.glareVisibilityTex.value:zero;
   measure.glareProjection.value.copy(camera.projectionMatrix);measure.glareSunView.value.copy(projection.sunView);measure.glareSunDirection.value.copy(sun).normalize();measure.glareCameraPosition.value.copy(camera.position);
   measure.glareDelta.value=Math.max(0,Math.min(.1,dt));measure.glareEdgeWeight.value=projection.edgeWeight;
   const target=targets[writeIndex],previousTarget=renderer.getRenderTarget(),previousAutoClear=renderer.autoClear;
   try{
    renderer.autoClear=true;renderer.setRenderTarget(target);renderer.render(scene,camera2D);
    uniforms.glareVisibilityTex.value=target.texture;uniforms.glareActive.value=1;historyValid=true;historyReset=null;writeIndex=1-writeIndex;updates++;
   }catch(error){reset('render-failure');throw error;}
   finally{renderer.setRenderTarget(previousTarget);renderer.autoClear=previousAutoClear;}
  },
  resources:()=>targets.map((target,i)=>['sunGlareVisibility'+i,target]),
  status:()=>({enabled,disposed,eligible,taps:SUN_GLARE_TAPS,updates,sunUv:uniforms.glareSunUv.value.toArray(),historyReset,historyValid,active:uniforms.glareActive.value===1,estimatedTargetBytes:16,estimatedZeroBytes:4,cloudSource:'published-sky-panorama',depthSource:'resolved-opaque',pixelCost:'24 depth taps only in the scalar pass; procedural shapes in existing fullscreen output'}),
  dispose(){if(disposed)return;disposed=true;eligible=false;reset('disposed');targets.forEach(target=>target.dispose());zero.dispose();geometry.dispose();material.dispose();},
 };
}
