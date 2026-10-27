// Keep the existing single-map allocation AND receiver coverage. A 128 m
// trial improved texel density but lost mid-distance tree receiving shadows.
// The accepted change is complementary ground cache/live handover.
// The cached canopy footprint assumes lighting-config.js's fixed sun direction.
// It is ground-only; changing the sun would require rebaking that footprint.
export const shadowBudget = { enabled: { value: 0 } }
export const SHADOW_EXTENT = { legacy: 280, coherent: 280 }
// P8: filter the receiver's projected pixel footprint within the existing five
// hardware comparison calls. This is not fractional alpha caster coverage.
export const shadowFootprintEnabled = { value: true }
export const shadowFootprintConfig = Object.freeze({comparisonCalls:5,extraComparisonCalls:0,extraPasses:0,extraTargets:0,pattern:'fixed-light-plane-vogel',radius:'max(base,receiver-pixel-half-diagonal)',depth:'receiver-plane-offset',coverage:'five-sample-PCF approximation, not exact pixel integration'})
export function setShadowFootprint(enabled) { shadowFootprintEnabled.value=Boolean(enabled) }
export function shadowFootprintStatus() { return {enabled:shadowFootprintEnabled.value,...shadowFootprintConfig} }

// Offline reference for the prewritten geometry checks; never called per tree
// or per pixel by ordinary frames. dx/dy are derivatives of projected XYZ.
export function shadowFootprintReference({baseRadius,dx,dy,enabled=true}) {
 if(!Number.isFinite(baseRadius)||baseRadius<0||![dx,dy].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('Invalid shadow receiver footprint')
 if(!enabled)return {radius:baseRadius,depthSlope:[0,0]}
 const radius=Math.max(baseRadius,.5*Math.hypot(Math.abs(dx[0])+Math.abs(dy[0]),Math.abs(dx[1])+Math.abs(dy[1])))
 const det=dx[0]*dy[1]-dx[1]*dy[0],scale=Math.max(Math.hypot(dx[0],dx[1])*Math.hypot(dy[0],dy[1]),1e-20)
 const t=Math.min(1,Math.max(0,(Math.abs(det)/scale-1e-4)/9e-4)),weight=t*t*(3-2*t)
 const depthSlope=weight>0?[(dx[2]*dy[1]-dx[1]*dy[2])/det*weight,(dx[0]*dy[2]-dx[2]*dy[0])/det*weight]:[0,0]
 return {radius,depthSlope}
}

export function setShadowBudget(light, enabled) {
  shadowBudget.enabled.value = enabled ? 1 : 0
  const half = (enabled ? SHADOW_EXTENT.coherent : SHADOW_EXTENT.legacy) / 2
  const camera = light.shadow.camera
  camera.left = camera.bottom = -half
  camera.right = camera.top = half
  camera.updateProjectionMatrix()
}

// CPU reference for deterministic diagnostics, using the coordinates after
// perspective division and shadowBias. Candidate guards both depth planes;
// legacy retains Three's existing z<=1 convention.
const smoothstep = (a, b, value) => { const t = Math.min(1, Math.max(0, (value-a)/(b-a))); return t*t*(3-2*t) }
export function shadowLiveWeight(coord) {
  const [x, y, z] = coord
  if (x < 0 || x > 1 || y < 0 || y > 1 || z < 0 || z > 1) return 0
  return 1-smoothstep(.32,.49,Math.max(Math.abs(x-.5),Math.abs(y-.5)))
}
export function shadowVisibility({coord, live, cached=1, intensity=1, ground=false, enabled=false}) {
  const [x,y,z]=coord
  const weight = enabled ? shadowLiveWeight(coord) : (x<0||x>1||y<0||y>1||z>1 ? 0 : 1-smoothstep(.32,.49,Math.max(Math.abs(x-.5),Math.abs(y-.5))))
  const visibility = enabled ? (ground ? cached : 1)*(1-weight)+live*weight : 1+(live-1)*weight
  return intensity===1 ? visibility : 1+(visibility-1)*intensity
}

// airWorld and (for ground) canopyLighting are declared by the material before
// this helper. The caller supplies Three's actual sampled frustum test, after
// normal offset, perspective division and bias; no viewer-distance proxy.
export const shadowBudgetGLSL = `
uniform bool shadowFootprintEnabled;
struct IslandShadowReceiver {float radius;vec2 depthSlope;};
IslandShadowReceiver islandShadowReceiverFootprint(vec3 coord,float baseRadius){
 IslandShadowReceiver receiver;
 receiver.radius=baseRadius;receiver.depthSlope=vec2(0.);
 // Uniform branch preserves the old filter exactly and skips derivative ALU.
 if(shadowFootprintEnabled){
  // Call before frustum/near-weight branches: derivatives need the full quad.
  vec3 dx=dFdx(coord),dy=dFdy(coord);
  receiver.radius=max(baseRadius,.5*length(abs(dx.xy)+abs(dy.xy)));
  // Offset comparison depth on the receiver plane, rather than widening a
  // constant-depth query into grazing-surface self-shadow acne. Geometry
  // discontinuities are still a limitation, not a claim of exact integration.
  float det=dx.x*dy.y-dx.y*dy.x;
  float scale=max(length(dx.xy)*length(dy.xy),1.e-20);
  // Fade the nearly singular plane solve instead of abruptly dropping its
  // depth correction as a grazing receiver/camera changes conditioning.
  float planeWeight=smoothstep(1.e-4,1.e-3,abs(det)/scale);
  if(planeWeight>0.)receiver.depthSlope=vec2(dx.z*dy.y-dx.y*dy.z,dx.x*dy.z-dx.z*dy.x)*(planeWeight/det);
 }
 return receiver;
}
vec3 islandShadowComparisonCoord(vec3 coord,vec2 offset,vec2 depthSlope){
 return vec3(coord.xy+offset,coord.z+dot(depthSlope,offset));
}
float islandShadowVisibility(float shadow, float shadowIntensity, vec4 shadowCoord, bool frustumTest) {
 float edgeWeight=1.-smoothstep(.32,.49,max(abs(shadowCoord.x-.5),abs(shadowCoord.y-.5)));
 if(shadowBudgetEnabled<.5)return mix(1.,shadow,shadowIntensity*edgeWeight);
 float liveWeight=frustumTest&&shadowCoord.z>=0.?edgeWeight:0.;
 float cachedVisibility=1.;
 #ifdef ISLAND_SHADOW_GROUND
 cachedVisibility=mix(.28,1.,texture2D(canopyLighting,airWorld.xz/20480.+.5).r);
 #endif
 return mix(1.,mix(cachedVisibility, shadow, liveWeight),shadowIntensity);
}`

export function patchShadowChunk(chunk) {
  // getShadow has PCF, VSM and basic variants. Point-light cube sampling does
  // not use these light-plane coordinates and must retain its original code.
  const boundary = chunk.indexOf('#if NUM_POINT_LIGHT_SHADOWS > 0', chunk.indexOf('float getShadow('))
  if (boundary < 0) throw new Error('Three projected/point shadow boundary changed')
  const projected = chunk.slice(0, boundary)
  const endpoint = 'return mix( 1.0, shadow, shadowIntensity );'
  if (projected.split(endpoint).length !== 4) throw new Error('Three projected shadow endpoints changed')
  const rotation = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;'
  if (projected.split(rotation).length !== 2) throw new Error('Three projected PCF rotation changed')
  const a=projected.indexOf('float getShadow( sampler2DShadow'),b=projected.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )',a)
  if(a<0||b<=a)throw new Error('Three projected PCF boundary changed')
  let pcf=projected.slice(a,b)
  const frustum='bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;'
  const radius='float radius = shadowRadius * texelSize.x;'
  if(pcf.split(frustum).length!==2||pcf.split(radius).length!==2)throw new Error('Three projected PCF footprint anchors changed')
  pcf=pcf.replace(frustum,'IslandShadowReceiver receiver=islandShadowReceiverFootprint(shadowCoord.xyz,shadowRadius/shadowMapSize.x);\n\t\t\t'+frustum).replace(radius,'float radius = receiver.radius;')
  for(let i=0;i<5;i++){
   const sample=`vec3( shadowCoord.xy + vogelDiskSample( ${i}, 5, phi ) * radius, shadowCoord.z )`
   if(pcf.split(sample).length!==2)throw new Error('Three projected PCF sample changed')
   // Retain Three's literal XY sampling endpoint (and its existing contract).
   // Only comparison Z comes from the same helper used by the optional near.
   pcf=pcf.replace(sample,`vec3( shadowCoord.xy + vogelDiskSample( ${i}, 5, phi ) * radius, islandShadowComparisonCoord( shadowCoord.xyz, vogelDiskSample( ${i}, 5, phi ) * radius, receiver.depthSlope ).z )`)
  }
  const filtered=projected.slice(0,a)+pcf+projected.slice(b)
  // Five hardware comparison calls in either branch. Fixed candidate rotation
  // removes camera motion through the screen IGN field; it may reveal banding.
  // Light-plane texel noise would also change on snapped projection offsets.
  return filtered.replace(rotation, 'float phi = foliageCoverageEnabled ? 0.0 : interleavedGradientNoise( gl_FragCoord.xy ) * PI2;\n\t\t\t\tphi = shadowFootprintEnabled ? 0.0 : phi;').replaceAll(endpoint, 'return islandShadowVisibility( shadow, shadowIntensity, shadowCoord, frustumTest );') + chunk.slice(boundary)
}
