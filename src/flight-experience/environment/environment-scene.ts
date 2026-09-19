import { CloudAppearance } from './cloud-appearance'
import { RainField, RainCurtains } from './rain-field'
import { WeatherController, type WeatherState, wrapCloud } from './weather-controller'
import cloudUrl from '../assets/weather/cloud-density.png'
import { RepeatWrapping, TextureLoader, NoColorSpace, type Texture } from 'three'
import {oceanCoverage,type WaterRect} from '../hydrology/ocean-coverage'
import { BackSide, BufferGeometry, DataTexture, DirectionalLight, Group, HemisphereLight, Mesh, NearestFilter, RGBAFormat, ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4, type PerspectiveCamera, type Scene, UniformsLib, UniformsUtils } from 'three'
import { terrainAt, type Address } from '../world'
import { BathymetryField, DEPTH_SIZE, DEPTH_STEP, type BathymetryOptions } from './bathymetry'
import { sampleEnvironment, composeWeather, type SolarPreset, type SolarLayout, type EnvironmentFrame } from './environment-state'
import { envelopeOrigin, waveComponents } from './ocean-waves'
import { ENVIRONMENT_ATMOSPHERE_GLSL as atmosphere } from './atmosphere'
import { createEnvironmentFog } from './environment-fog'

const skyVertex=`varying vec3 direction;void main(){direction=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`
const skyFragment=`varying vec3 direction;${atmosphere}
void main(){gl_FragColor=vec4(distantColor(normalize(direction)),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
const waterVertex=`
#include <common>
#include <shadowmap_pars_vertex>
attribute vec3 waterFlow; varying vec3 flowData; varying vec3 worldPosition;void main(){flowData=waterFlow;worldPosition=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldPosition,1.);
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
vDirectionalShadowCoord[0]=directionalShadowMatrix[0]*vec4(worldPosition+vec3(0.,.8,0.),1.);
#endif
}`
export interface EnvironmentUpdateOptions extends BathymetryOptions { immutableSurface?:(x:number,z:number)=>number }
const waterFragment=`
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
varying vec3 flowData;varying vec3 worldPosition;uniform vec4 waterOwnerRect;uniform vec2 waterWorldOrigin;uniform float riverReady;uniform float riverPass;uniform float waterTime;uniform vec4 waves[6];uniform vec2 envelopeOrigin;uniform sampler2D depthField;uniform sampler2D previousDepthField;uniform sampler2D coarseDepthField;uniform vec2 depthOrigin;uniform vec2 previousDepthOrigin;uniform vec2 coarseDepthOrigin;uniform float depthBlend;uniform float hasPreviousDepth;uniform float hasCoarseDepth;uniform float hasDepth;uniform float flatWater;uniform float edges;uniform float ownerColors;uniform float depthColors;
${atmosphere}
// Periodic 8192m value noise with analytic derivatives; bounded origin coordinates.
float oceanHash(vec2 p){p=mod(p,64.);return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 oceanNoise(vec2 p){vec2 cell=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
float a=oceanHash(cell),b=oceanHash(cell+vec2(1.,0.)),c=oceanHash(cell+vec2(0.,1.)),d=oceanHash(cell+1.);
return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(b-a,d-c,u.y)*du.x,mix(c-a,d-b,u.x)*du.y);}
float ground(sampler2D field,vec2 pixel){vec2 rg=texture2D(field,(clamp(pixel,vec2(0.),vec2(129.))+.5)/130.).rg*255.;return -128.+(rg.x*256.+rg.y)/65535.*1024.;}
vec2 readField(sampler2D field,vec2 origin,float spacing){vec2 p=(worldPosition.xz-origin)/spacing;vec2 cell=floor(p),f=fract(p);
float height=mix(mix(ground(field,cell),ground(field,cell+vec2(1.,0.)),f.x),mix(ground(field,cell+vec2(0.,1.)),ground(field,cell+1.),f.x),f.y);
float edge=min(min(p.x,p.y),min(129.-p.x,129.-p.y));
return vec2(height,smoothstep(0.,8.,edge));}
float shallowAt(float height){float depth=max(0.,worldPosition.y-height);return mix(1.-smoothstep(1.,24.,depth),exp(-depth/4.5),smoothstep(120.,400.,cameraPosition.y)*landDistanceReady);}
void main(){

// Ocean/finite water ownership is disjoint in geometry, not a fragment epsilon.
vec3 ray=normalize(worldPosition-cameraPosition);float distanceToEye=length(worldPosition-cameraPosition);vec2 gradient=vec2(0.);
vec2 envelopePosition=(worldPosition.xz+envelopeOrigin)/128.;
for(int i=0;i<6;i++){
vec3 warp=oceanNoise(envelopePosition+vec2(float(i)*7.3,float(i)*11.9));
vec3 envelope=oceanNoise(envelopePosition+vec2(float(i)*17.7+31.,float(i)*5.1+19.));
float phase=dot(worldPosition.xz,waves[i].xy)+waves[i].w+warp.x*6.;
vec2 phaseGradient=waves[i].xy+warp.yz*(6./128.);
float amplitude=.25+.55*envelope.x;
float footprint=length(vec2(dFdx(phase),dFdy(phase)));
float aa=1.-smoothstep(.45,1.8,footprint);
// Short waves contribute only close to the eye; the offshore field is broad swell.
float reach=i<2?4500.:(i<4?2800.:1400.);
float fade=1.-smoothstep(reach*.2,reach,distanceToEye);
gradient+=(cos(phase)*phaseGradient*amplitude+sin(phase)*envelope.yz*(.55/128.))*waves[i].z*aa*fade*(i<2?1.12:.8);
}
// Advected, continuous fine slopes break broad swells into irregular highlights.
// Subpixel structure fades out; its slope variance stays in the BRDF roughness.
vec2 finePosition=(worldPosition.xz+envelopeOrigin)*.4375+vec2(waterTime*.18,waterTime*.11);
float fineFootprint=max(length(dFdx(finePosition)),length(dFdy(finePosition)));
float fineResolved=(1.-smoothstep(.45,1.5,fineFootprint))*(1.-smoothstep(450.,1700.,distanceToEye));
vec3 fineA=oceanNoise(finePosition),fineB=oceanNoise(finePosition*.5+vec2(19.,31.));
gradient+=(fineA.yz+fineB.yz*.6)*.11*fineResolved;
// Centimetre-scale capillary ripples remain visible from the low comparison camera.
// Frequencies are periodic over the same 8192m logical envelope as broad waves.
vec2 ripplePosition=(worldPosition.xz+envelopeOrigin)*4.+vec2(waterTime*.31,-waterTime*.23);
float rippleFootprint=max(length(dFdx(ripplePosition)),length(dFdy(ripplePosition)));
float rippleResolved=1.-smoothstep(.35,1.25,rippleFootprint);
vec3 ripple=oceanNoise(ripplePosition),rippleFine=oceanNoise(ripplePosition*2.+vec2(7.,23.)+waterTime*.17);
gradient+=ripple.yz*.12*rippleResolved+rippleFine.yz*.065*(1.-smoothstep(.35,1.25,rippleFootprint*2.));
// Two phases crossfade only the moving normal signal; surface opacity stays one.
float phase0=fract(waterTime*.09),phase1=fract(waterTime*.09+.5);
vec2 flowUV=(worldPosition.xz+envelopeOrigin)*.125;
vec3 flowA=oceanNoise(flowUV-flowData.xy*flowData.z*phase0*5.);
vec3 flowB=oceanNoise(flowUV-flowData.xy*flowData.z*phase1*5.);
gradient+=mix(flowA.yz,flowB.yz,abs(phase0*2.-1.))*flowData.z*.055;
// Keep nearby water intact; unresolved offshore slopes relax toward the horizon.
gradient*=mix(1.,.15,smoothstep(600.,2200.,distanceToEye));
vec3 n=normalize(vec3(-gradient.x*(1.-flatWater),1.,-gradient.y*(1.-flatWater)));
vec2 coarse=readField(coarseDepthField,coarseDepthOrigin,32.);
float fallback=shallowAt(coarse.x)*coarse.y*hasCoarseDepth;
vec2 current=readField(depthField,depthOrigin,${DEPTH_STEP}.);
vec2 previous=readField(previousDepthField,previousDepthOrigin,${DEPTH_STEP}.);
// Each version resolves UV independently at this same world point.
float oldShallow=mix(fallback,shallowAt(previous.x),previous.y*hasPreviousDepth);
float newShallow=mix(fallback,shallowAt(current.x),current.y*hasDepth);
float shallow=mix(oldShallow,newShallow,depthBlend);
float visibility=1.;
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
vec3 sp=vDirectionalShadowCoord[0].xyz/vDirectionalShadowCoord[0].w;
float edge=min(min(sp.x,sp.y),min(1.-sp.x,1.-sp.y));
float weight=smoothstep(0.,.18,edge)*smoothstep(0.,.04,sp.z)*(1.-smoothstep(.94,1.,sp.z));
visibility=mix(1.,getShadow(directionalShadowMap[0],directionalLightShadows[0].shadowMapSize,directionalLightShadows[0].shadowIntensity,directionalLightShadows[0].shadowBias,directionalLightShadows[0].shadowRadius,vDirectionalShadowCoord[0]),weight);
#endif
vec3 base=oceanBase(ray,n,shallow)*mix(.72,1.,visibility);vec3 c=base+(oceanColor(ray,n,shallow,worldPosition)-oceanBase(ray,n,shallow))*visibility;float farMix=smoothstep(3200.,4200.,distanceToEye);c=mix(c,distantColor(ray),farMix);
if(edges>.5){float border=step(4750.,max(abs(worldPosition.x-cameraPosition.x),abs(worldPosition.z-cameraPosition.z)));c=mix(c,vec3(1.,0.,0.),border);}
if(ownerColors>.5)c=riverPass>.5?vec3(.8,.25,.1):vec3(.1,.2,.8);if(depthColors>.5)c=vec3(shallow);
gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
/** Owns only environment resources. Renderer/shadow state is leased by the runtime. */
export class EnvironmentScene {
  readonly root=new Group()
  readonly review={flatWater:false,freezeWater:false,oceanEdges:false,skyColors:false,shadows:true,highlight:true,freezeBathymetry:false,ownerColors:false,depthColors:false}
  readonly metrics={cloudDataReady:false,cloudAppearanceWeight:0,weatherTextureBytes:1398102,weatherDrawCalls:0,bathymetrySamples:0,textureBytes:DEPTH_SIZE*DEPTH_SIZE*4*3,shadowMapSize:0,shadowExtent:384,bathymetryRevision:0,bathymetryMs:0,peakBathymetryMs:0,bathymetryEpoch:0,bathymetryDirtyPages:0,bathymetryBlend:1,bathymetryUploadBytes:0,bathymetryPendingAgeFrames:0,bathymetryStarvedFrames:0}
  solarLayout: SolarLayout = 'legacy'
  solarDayProgress: number | undefined
  weatherState:WeatherState=new WeatherController().serialize()
  weatherDegraded=false
  weatherEnabled=true
  private readonly clearWeather=new WeatherController().serialize()
  private disposed=false
  private cloudLoadTimer:ReturnType<typeof setTimeout>|undefined
  readonly cloudAppearance=new CloudAppearance()
  private cloudTexture:Texture=new DataTexture(new Uint8Array([128,128,0,255]),1,1,RGBAFormat)
  private frameRevision = 0
  private currentFrame=sampleEnvironment()
  get frame():EnvironmentFrame{return this.currentFrame}
  readonly sun=new DirectionalLight(0xffffff,2.6)
  readonly fill=new HemisphereLight(0xffffff,0xffffff,1.15)
  private readonly field=new BathymetryField()
  private readonly coarseField=new BathymetryField(32)
  private readonly previousTexture=new DataTexture(this.field.previousData,DEPTH_SIZE,DEPTH_SIZE,RGBAFormat)
  private readonly coarseTexture=new DataTexture(this.coarseField.data,DEPTH_SIZE,DEPTH_SIZE,RGBAFormat)
  private readonly texture=new DataTexture(this.field.data,DEPTH_SIZE,DEPTH_SIZE,RGBAFormat)
  readonly fog=createEnvironmentFog(this.currentFrame)
  private readonly uniforms=this.fog.uniforms
  readonly rain=new RainField()
  readonly curtains=new RainCurtains(this.uniforms)
  private readonly waterUniforms={...this.uniforms,waterOwnerRect:{value:new Vector4()},waterWorldOrigin:{value:new Vector2()},riverReady:{value:0},riverPass:{value:0},waterTime:{value:0},envelopeOrigin:{value:new Vector2()},waves:{value:Array.from({length:6},()=>new Vector4())},depthField:{value:this.texture},previousDepthField:{value:this.previousTexture},coarseDepthField:{value:this.coarseTexture},previousDepthOrigin:{value:new Vector2()},coarseDepthOrigin:{value:new Vector2()},depthBlend:{value:1},hasPreviousDepth:{value:0},hasCoarseDepth:{value:0},depthOrigin:{value:new Vector2()},hasDepth:{value:0},flatWater:{value:0},edges:{value:0},ownerColors:{value:0},depthColors:{value:0}}
  readonly sky=new Mesh(new SphereGeometry(1,24,12),new ShaderMaterial({vertexShader:skyVertex,fragmentShader:skyFragment,uniforms:this.uniforms,side:BackSide,depthWrite:false,depthTest:false}))
  private waterHole:WaterRect|undefined
  private waterLayout=''
  readonly water=new Mesh(new BufferGeometry(),new ShaderMaterial({vertexShader:waterVertex,fragmentShader:waterFragment,lights:true,uniforms:{...UniformsUtils.clone(UniformsLib.lights),...this.waterUniforms}}))
  setWaterOwner(bounds:{minX:number;minZ:number;maxX:number;maxZ:number},ready:boolean){this.waterUniforms.waterOwnerRect.value.set(bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ);this.waterUniforms.riverReady.value=Number(ready);this.waterHole=ready?bounds:undefined}
  createRiverMaterial(){return new ShaderMaterial({vertexShader:waterVertex,fragmentShader:waterFragment,lights:true,uniforms:{...UniformsUtils.clone(UniformsLib.lights),...this.waterUniforms,riverPass:{value:1}}})}
  private lastWaterTime=0
  private previousMotion:number|null=null
  restoreWaterMotion(value:number){this.lastWaterTime=value;this.previousMotion=value}
  get waterMotionSeconds(){return this.lastWaterTime}
  private preparationFrame=0
  get busy(){return this.field.busy||this.coarseField.busy}
  constructor(scene:Scene,private readonly surface:(x:number,z:number)=>number,wake:()=>void=()=>{}){
    this.uniforms.cloudDensityMap.value=this.cloudTexture
    const loadCloud=()=>{this.cloudLoadTimer=undefined;void new TextureLoader().loadAsync(cloudUrl).then(texture=>{if(this.disposed){texture.dispose();return}this.cloudTexture.dispose();this.cloudTexture=texture;texture.colorSpace=NoColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;this.uniforms.cloudDensityMap.value=texture;this.cloudAppearance.markDataReady();this.uniforms.cloudDataReady.value=1;wake()}).catch(()=>{if(!this.disposed){this.weatherDegraded=true;wake()}})}
    // Local-only reproducible slow resource probe. Production has no query override.
    const delay=import.meta.env.DEV?Math.min(180000,Math.max(0,Number(new URLSearchParams(globalThis.location?.search).get('flightCloudDelayMs'))||0)):0
    if(delay)this.cloudLoadTimer=setTimeout(loadCloud,delay);else loadCloud()
    for(const texture of [this.texture,this.previousTexture,this.coarseTexture]){texture.minFilter=NearestFilter;texture.magFilter=NearestFilter;texture.generateMipmaps=false}
    this.sky.frustumCulled=false;this.sky.renderOrder=-10
    this.water.frustumCulled=false;this.water.receiveShadow=true
    this.sun.castShadow=true;this.sun.shadow.camera.left=-192;this.sun.shadow.camera.right=192;this.sun.shadow.camera.top=192;this.sun.shadow.camera.bottom=-192
    this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=1400;this.sun.shadow.bias=-.0003;this.sun.shadow.normalBias=.8
    this.root.add(this.rain.mesh,this.curtains.mesh,this.sky,this.water,this.sun,this.sun.target,this.fill);scene.add(this.root)
  }
  update(camera:PerspectiveCamera,origin:Address,time:number,quality:'low'|'balanced',preset:SolarPreset='afternoon',options:EnvironmentUpdateOptions={}){
    const f=this.currentFrame=composeWeather(sampleEnvironment(this.solarDayProgress ?? preset,time,this.solarLayout,++this.frameRevision),this.weatherEnabled?this.weatherState:this.clearWeather)
    this.uniforms.cloudAppearanceWeight.value=this.cloudAppearance.update(time,this.weatherEnabled)
    this.metrics.cloudDataReady=this.cloudAppearance.dataReady;this.metrics.cloudAppearanceWeight=this.cloudAppearance.appearanceWeight
    this.fog.update(f)
    this.rain.update(camera,origin,this.weatherState.rainSeconds,f.rainRate,quality);this.curtains.update(origin,this.weatherEnabled?this.weatherState.resolved.curtain:0)
    this.metrics.weatherDrawCalls=Number(this.rain.mesh.visible)+Number(this.curtains.mesh.visible)
    this.uniforms.cloudOrigin.value.set(wrapCloud(origin.x),wrapCloud(origin.z));this.uniforms.cloudPhase.value.set(...this.weatherState.phase)
    this.uniforms.weatherHaze.value=this.weatherEnabled?this.weatherState.resolved.haze:0
    this.uniforms.waterHighlight.value=Number(this.review.highlight);this.uniforms.skyColors.value=Number(this.review.skyColors);this.sun.castShadow=this.review.shadows
    this.sun.color.setRGB(...f.sunColor);this.sun.intensity=f.sunIntensity
    this.fill.color.setRGB(...f.skyZenith);this.fill.groundColor.setRGB(...f.groundFill);this.fill.intensity=f.fillIntensity
    this.sky.position.copy(camera.position)
    const waterCenter={x:Math.floor((camera.position.x+origin.x)/512)*512,z:Math.floor((camera.position.z+origin.z)/512)*512},waterLayout=JSON.stringify([waterCenter,origin,this.waterHole])
    if(waterLayout!==this.waterLayout){const old=this.water.geometry;this.water.geometry=oceanCoverage(waterCenter,origin,this.waterHole);old.dispose();this.waterLayout=waterLayout}
    const size=quality==='low'?1024:2048
    if(this.sun.shadow.mapSize.x!==size){this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.mapSize.set(size,size)}
    this.metrics.shadowMapSize=size
    // Snap in the sun's tangent plane in logical coordinates; origin shifts never rotate the light.
    const dir=new Vector3(...f.sunDirectionWorld),right=new Vector3().crossVectors(dir,new Vector3(0,Math.abs(dir.y)>.999?0:1,Math.abs(dir.y)>.999?1:0)).normalize(),up=new Vector3().crossVectors(right,dir).normalize()
    const focus=new Vector3(camera.position.x+origin.x,camera.position.y-60,camera.position.z+origin.z),texel=384/size
    focus.addScaledVector(right,Math.round(focus.dot(right)/texel)*texel-focus.dot(right))
    focus.addScaledVector(up,Math.round(focus.dot(up)/texel)*texel-focus.dot(up))
    focus.x-=origin.x;focus.z-=origin.z;this.sun.target.position.copy(focus);this.sun.position.copy(focus).addScaledVector(dir,700)
    if(!this.review.freezeWater)this.lastWaterTime+=this.previousMotion===null?time:Math.max(0,time-this.previousMotion)
    this.previousMotion=time
    this.waterUniforms.waterWorldOrigin.value.set(origin.x,origin.z);this.waterUniforms.waterTime.value=this.lastWaterTime
    this.waterUniforms.envelopeOrigin.value.set(...envelopeOrigin(origin))
    this.uniforms.solarWaterOrigin.value.set(...envelopeOrigin(origin));this.uniforms.solarWaterTime.value=this.lastWaterTime
    waveComponents(f.windWorld,origin,this.lastWaterTime).forEach((w,i)=>this.waterUniforms.waves.value[i]!.set(w.x,w.z,w.amplitude*f.waveStrength,w.phase))
    this.uniforms.solarWaveStrength.value=Number(!this.review.flatWater);this.waterUniforms.flatWater.value=Number(this.review.flatWater);this.waterUniforms.edges.value=Number(this.review.oceanEdges);this.waterUniforms.ownerColors.value=Number(this.review.ownerColors);this.waterUniforms.depthColors.value=Number(this.review.depthColors)
    const revision=this.field.revision,started=performance.now()
    this.metrics.bathymetryUploadBytes=0
    const allowPublish=options.allowPublish!==false&&!this.review.freezeBathymetry
    const x=camera.position.x+origin.x,z=camera.position.z+origin.z
    const coarseRevision=this.coarseField.revision
    const coarse=()=>this.coarseField.update(x,z,options.immutableSurface??((x,z)=>terrainAt(x,z).height),1,{...(options.budget?{budget:options.budget}:{}),allowPublish,presentationSeconds:time})
    const near=()=>this.field.update(x,z,this.surface,1,{...options,allowPublish,presentationSeconds:time})
    this.metrics.bathymetrySamples=(this.preparationFrame++%2===0)?coarse()+near():near()+coarse()
    if(coarseRevision!==this.coarseField.revision){this.coarseTexture.needsUpdate=true;this.metrics.bathymetryUploadBytes+=this.coarseField.data.byteLength}
    this.metrics.bathymetryPendingAgeFrames=Math.max(this.field.pendingAgeFrames,this.coarseField.pendingAgeFrames)
    this.metrics.bathymetryStarvedFrames=this.field.starvedFrames+this.coarseField.starvedFrames
    this.metrics.bathymetryMs=performance.now()-started
    this.metrics.peakBathymetryMs=Math.max(this.metrics.peakBathymetryMs,this.metrics.bathymetryMs)
    if(revision!==this.field.revision){
      this.previousTexture.needsUpdate=true
      this.metrics.bathymetryUploadBytes+=this.field.previousData.byteLength
      const sameOrigin=this.field.previousX===this.field.startX&&this.field.previousZ===this.field.startZ
      if(sameOrigin)for(const rect of this.field.publication?.dirtyRects??[]){
        const col=Math.round((rect.minX-this.field.startX)/DEPTH_STEP),row=Math.round((rect.minZ-this.field.startZ)/DEPTH_STEP)
        const width=Math.round((rect.maxX-rect.minX)/DEPTH_STEP)+1,height=Math.round((rect.maxZ-rect.minZ)/DEPTH_STEP)+1
        this.metrics.bathymetryUploadBytes+=width*height*4
        for(let r=0;r<height;r++)this.texture.addUpdateRange(((row+r)*DEPTH_SIZE+col)*4,width*4)
      }
      if(!sameOrigin)this.metrics.bathymetryUploadBytes+=this.field.data.byteLength
      this.texture.needsUpdate=true
    }
    this.waterUniforms.depthBlend.value=this.field.blend;this.waterUniforms.hasPreviousDepth.value=Number(this.field.revision>1)
    this.waterUniforms.hasCoarseDepth.value=Number(this.coarseField.revision>0)
    this.waterUniforms.previousDepthOrigin.value.set(Number.isFinite(this.field.previousX)?this.field.previousX-origin.x:0,Number.isFinite(this.field.previousZ)?this.field.previousZ-origin.z:0)
    this.waterUniforms.coarseDepthOrigin.value.set(Number.isFinite(this.coarseField.startX)?this.coarseField.startX-origin.x:0,Number.isFinite(this.coarseField.startZ)?this.coarseField.startZ-origin.z:0)
    this.metrics.bathymetryRevision=this.field.revision
    this.metrics.bathymetryEpoch=this.field.publication?.epoch??0;this.metrics.bathymetryDirtyPages=this.field.publication?.dirtyRects.length??0;this.metrics.bathymetryBlend=this.field.blend
    this.waterUniforms.hasDepth.value=Number(this.field.revision>0);this.waterUniforms.depthOrigin.value.set(Number.isFinite(this.field.startX)?this.field.startX-origin.x:0,Number.isFinite(this.field.startZ)?this.field.startZ-origin.z:0)
  }
  dispose(){if(this.disposed)return;this.disposed=true;clearTimeout(this.cloudLoadTimer);this.rain.dispose();this.curtains.dispose();this.cloudTexture.dispose();this.root.removeFromParent();this.sky.geometry.dispose();this.sky.material.dispose();this.water.geometry.dispose();this.water.material.dispose();this.texture.dispose();this.previousTexture.dispose();this.coarseTexture.dispose();this.field.dispose();this.coarseField.dispose();this.sun.dispose();this.fill.dispose();this.root.clear()}
}
