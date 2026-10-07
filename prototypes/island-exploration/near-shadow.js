import * as T from 'three';

// A bounded Tidewater-inspired near precision candidate, not a port of its
// three-cascade PCSS/TAA system. Keep the original 280m shadow and ground cache.
// https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/engine/render/Shadows.js#L88
export const nearShadowConfig=Object.freeze({extentMetres:64,mapSize:1024,fullRadiusMetres:20,fadeRadiusMetres:30,comparisonCalls:5,nominalBytesPerTexel:8,requiredFilter:'PCFShadowMap'});
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function nearShadowWeight(coord){
 const [x,y,z]=coord;if(!coord.every(Number.isFinite)||x<0||x>1||y<0||y>1||z<0||z>1)return 0;
 return 1-smoothstep(20/64,30/64,Math.max(Math.abs(x-.5),Math.abs(y-.5)));
}
export function nearShadowVisibility({far,raw,weight,intensity=1}){return far*(1-weight)+(1+(raw-1)*intensity)*weight;}

// This snippet is included INSIDE main(), so raw comparisons are inline, not
// another getShadow() overload. Three's patched getShadow(0) already includes
// the existing primary-map edge/ground-cache policy. Never apply it to near.
// Arrays use constant indices after Three's native loop unrolling. WebGLLights
// stable-sorts castShadow lights first; makeNearShadow validates sun0/near1.
export function patchNearShadowLighting(chunk){
 const begin='#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )',end='#if ( NUM_RECT_AREA_LIGHTS > 0 )';
 const a=chunk.indexOf(begin),b=chunk.indexOf(end,a);
 const query='directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
 if(a<0||b<=a||chunk.slice(a,b).split(query).length!==2)throw Error('Unknown Three directional shadow query');
 const direct='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
 if(chunk.slice(a,b).split(direct).length!==2)throw Error('Unknown Three directional lighting endpoint');
 const block=chunk.slice(a,b).replace(query,`{
  // Braces retain a separate scope for each copy of Three's unrolled loop.
  bool queryShadow=false;
  #if !defined( SHADOWMAP_TYPE_PCF ) || NUM_DIR_LIGHT_SHADOWS != 2
   queryShadow=directLight.visible && receiveShadow;
  #elif UNROLLED_LOOP_INDEX != 1
   queryShadow=directLight.visible && receiveShadow;
  #endif
  float primaryVisibility=queryShadow?getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ):1.;
 #if defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS == 2 && UNROLLED_LOOP_INDEX == 0
   // Same P8 helper as primary. Evaluate before pixel-varying validity/weight
   // branches; the directional projection has w=1, invalid w is gated below.
   vec4 nearCoord=vDirectionalShadowCoord[ 1 ];
   nearCoord.xyz/=max(nearCoord.w,1.e-6);nearCoord.z+=directionalLightShadows[ 1 ].shadowBias;
   float nearBaseRadius=directionalLightShadows[ 1 ].shadowRadius/directionalLightShadows[ 1 ].shadowMapSize.x;
   IslandShadowReceiver nearReceiver=islandShadowReceiverFootprint(nearCoord.xyz,nearBaseRadius);
   if(queryShadow){
    float nearWeight=0.;
    if(nearCoord.w>0.){
     bool nearValid=nearCoord.x>=0.&&nearCoord.x<=1.&&nearCoord.y>=0.&&nearCoord.y<=1.&&nearCoord.z >= 0.&&nearCoord.z<=1.;
     if(nearValid)nearWeight=1.-smoothstep(.3125,.46875,max(abs(nearCoord.x-.5),abs(nearCoord.y-.5)));
    }
    float nearVisibility=1.;
    if(nearWeight>0.){
     float nearRadius=nearReceiver.radius;
     // Fixed rotation: no screen-noise movement and no dependence on TAA.
     float nearRaw=(
      texture( directionalShadowMap[ 1 ], islandShadowComparisonCoord(nearCoord.xyz,vogelDiskSample(0,5,0.)*nearRadius,nearReceiver.depthSlope) )+
      texture( directionalShadowMap[ 1 ], islandShadowComparisonCoord(nearCoord.xyz,vogelDiskSample(1,5,0.)*nearRadius,nearReceiver.depthSlope) )+
      texture( directionalShadowMap[ 1 ], islandShadowComparisonCoord(nearCoord.xyz,vogelDiskSample(2,5,0.)*nearRadius,nearReceiver.depthSlope) )+
      texture( directionalShadowMap[ 1 ], islandShadowComparisonCoord(nearCoord.xyz,vogelDiskSample(3,5,0.)*nearRadius,nearReceiver.depthSlope) )+
      texture( directionalShadowMap[ 1 ], islandShadowComparisonCoord(nearCoord.xyz,vogelDiskSample(4,5,0.)*nearRadius,nearReceiver.depthSlope) )
     )*.2;
     nearVisibility=mix(1.,nearRaw,directionalLightShadows[ 1 ].shadowIntensity);
    }
    primaryVisibility=mix( primaryVisibility, nearVisibility, nearWeight );
   }
 #endif
  // index1 is the zero-energy map-only light: no redundant native shadow query.
  directLight.color*=primaryVisibility;
 }`).replace(direct,`#if !defined( SHADOWMAP_TYPE_PCF ) || NUM_DIR_LIGHT_SHADOWS != 2 || UNROLLED_LOOP_INDEX != 1
  // The parent's transmission replacement of this literal endpoint remains
  // inside the guard: the map-only zero-energy light does no BRDF/leaf ALU.
  ${direct}
 #endif`);
 return chunk.slice(0,a)+block+chunk.slice(b);
}

export function makeNearShadow({scene,sun,enabled=false}){
 if(!scene?.isScene||!sun?.isDirectionalLight||!sun.castShadow)throw Error('Near shadow requires scene and shadow-casting directional sun');
 const light=new T.DirectionalLight(0xffffff,0);light.name='candidate-near-shadow';light.castShadow=true;light.visible=false;light.layers.mask=sun.layers.mask;
 light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=light.shadow.camera.bottom=-32;light.shadow.camera.right=light.shadow.camera.top=32;light.shadow.camera.updateProjectionMatrix();
 scene.add(light,light.target);
 const direction=new T.Vector3(),sunPosition=new T.Vector3(),sunTarget=new T.Vector3(),focus=new T.Vector3(),right=new T.Vector3(),up=new T.Vector3(),vertical=new T.Vector3(),worldEye=new T.Vector3(),localEye=new T.Vector3(),localTarget=new T.Vector3();
 let disposed=false,isEnabled=false,indices=null,projectionUpdates=0,biasScale=null;const gridError=[0,0];
 const alive=()=>{if(disposed)throw Error('Near shadow disposed');};
 function validateOrder(){
  // Explicit enable/validation only, never an ordinary per-frame tree walk.
  const directionals=[];scene.traverseVisible(o=>{if(o.isDirectionalLight)directionals.push(o);});
  directionals.sort((a,b)=>(b.castShadow?2:0)-(a.castShadow?2:0)+(b.map?1:0)-(a.map?1:0));
  const shadows=directionals.filter(o=>o.castShadow);
  if(shadows.length!==2||shadows[0]!==sun||shadows[1]!==light)throw Error('Near shadow directional light order must be primary0/near1 with exactly two shadow directionals');
  indices={primary:directionals.indexOf(sun),near:directionals.indexOf(light)};return {...indices};
 }
 function setEnabled(value){
  alive();const next=Boolean(value),previous=light.visible;light.visible=next;
  if(next){try{validateOrder();}catch(e){light.visible=previous;throw e;}}
  isEnabled=next;light.intensity=0;return isEnabled;
 }
 function update(camera,heightAt){
  alive();if(!isEnabled)return false;
  if(!camera?.position||![camera.position.x,camera.position.y,camera.position.z].every(Number.isFinite)||typeof heightAt!=='function')throw Error('Invalid near shadow camera/height function');
  const y=heightAt(camera.position.x,camera.position.z);if(!Number.isFinite(y))throw Error('Invalid near shadow ground height');
  sun.updateWorldMatrix(true,false);sun.target.updateWorldMatrix(true,false);sun.getWorldPosition(sunPosition);sun.target.getWorldPosition(sunTarget);direction.subVectors(sunPosition,sunTarget);
  const distance=direction.length(),primaryTexel=(sun.shadow.camera.right-sun.shadow.camera.left)/sun.shadow.mapSize.x;
  if(!Number.isFinite(distance)||distance<=0||!Number.isFinite(primaryTexel)||primaryTexel<=0)throw Error('Invalid near shadow sun direction/primary extent');
  const sc=sun.shadow.camera;if(![sc.near,sc.far,sun.shadow.bias,sun.shadow.normalBias,sun.shadow.radius,sun.shadow.intensity].every(Number.isFinite)||sc.far<=sc.near)throw Error('Invalid primary shadow parameters');
  direction.divideScalar(distance);vertical.set(0,Math.abs(direction.y)>.999?0:1,Math.abs(direction.y)>.999?1:0);
  right.crossVectors(direction,vertical).normalize();up.crossVectors(right,direction).normalize();focus.set(camera.position.x,Math.max(0,y),camera.position.z);
  const texel=64/1024;focus.addScaledVector(right,Math.round(focus.dot(right)/texel)*texel-focus.dot(right));focus.addScaledVector(up,Math.round(focus.dot(up)/texel)*texel-focus.dot(up));
  worldEye.copy(focus).addScaledVector(direction,distance);scene.updateWorldMatrix(true,false);localEye.copy(worldEye);localTarget.copy(focus);scene.worldToLocal(localEye);scene.worldToLocal(localTarget);
  light.position.copy(localEye);light.target.position.copy(localTarget);light.shadow.camera.up.copy(vertical);light.intensity=0;
  biasScale=texel/primaryTexel;light.shadow.bias=sun.shadow.bias*biasScale;light.shadow.normalBias=sun.shadow.normalBias*biasScale;light.shadow.radius=sun.shadow.radius;light.shadow.intensity=sun.shadow.intensity;
  if(light.shadow.camera.near!==sc.near||light.shadow.camera.far!==sc.far){light.shadow.camera.near=sc.near;light.shadow.camera.far=sc.far;light.shadow.camera.updateProjectionMatrix();}
  light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);
  const gx=focus.dot(right)/texel,gy=focus.dot(up)/texel;gridError[0]=Math.abs(gx-Math.round(gx));gridError[1]=Math.abs(gy-Math.round(gy));projectionUpdates++;return true;
 }
 function resources(){return light.shadow.map?[['nearSunShadow',light.shadow.map]]:[];}
 function status(){return{enabled:isEnabled,disposed,visible:light.visible,intensity:light.intensity,indices:indices?{...indices}:null,filter:nearShadowConfig.requiredFilter,extentMetres:64,mapSize:[1024,1024],texelMetres:64/1024,featherMetres:[20,30],comparisonCalls:5,maximumAdditionalComparisonCalls:5,expectedAdditionalShadowPasses:isEnabled?1:0,projectionUpdates,biasScale,bias:light.shadow.bias,normalBias:light.shadow.normalBias,radius:light.shadow.radius,depthInterval:[light.shadow.camera.near,light.shadow.camera.far],focus:focus.toArray(),direction:projectionUpdates?direction.toArray():null,gridError:projectionUpdates?gridError.slice():null,plannedAttachmentBytes:1024*1024*8,estimatedResidentAttachmentBytes:light.shadow.map?light.shadow.map.width*light.shadow.map.height*8:0,memoryCaveat:'Nominal uint-depth plus default RGBA8 attachment payload; not driver bytes',casterScope:'Existing installed scene casters with Three light-frustum clipping; no added root-distance clipping',orderCaveat:'Revalidate on enable if directional lights or their scene order/visibility change'};}
 function dispose(){if(disposed)return;disposed=true;isEnabled=false;light.visible=false;light.shadow.dispose();scene.remove(light,light.target);}
 try{setEnabled(enabled);}catch(e){dispose();throw e;}
 return{light,update,setEnabled,resources,status,dispose};
}
