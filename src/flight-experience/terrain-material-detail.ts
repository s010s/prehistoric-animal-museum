/** Metres, linear RGB. Spatial bands share world coordinates across tile/patch boundaries. */
export const terrainDetailFunctions = `
float groundHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float groundNoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(groundHash(i),groundHash(i+vec2(1.,0.)),f.x),mix(groundHash(i+vec2(0.,1.)),groundHash(i+vec2(1.)),f.x),f.y);
}
float groundRelief(vec3 p, vec3 weights){
  vec3 grain=vec3(dot(texture2D(flightSurface,p.zy/12.).rgb,vec3(.3,.5,.2)),dot(texture2D(flightSurface,p.xz/12.).rgb,vec3(.3,.5,.2)),dot(texture2D(flightSurface,p.xy/12.).rgb,vec3(.3,.5,.2)));
  return dot(weights,grain);
}`
export const terrainDetailColor = `
  vec2 worldUV=flightWorld.xz+flightSurfaceOrigin;
  vec3 weights=pow(abs(normalize(flightObjectNormal)),vec3(4.)); weights/=max(.001,weights.x+weights.y+weights.z);
  vec3 point=vec3(worldUV.x,flightWorld.y,worldUV.y);
  float grain=groundRelief(point,weights);
  float farDetail=1.-smoothstep(90.,650.,length(vViewPosition));
  float textureDetail=mix(1.,.86+grain*.42,flightSurfaceReady*flightReview.y*farDetail);
  // Macro soil patches remain visible when micro detail is disabled. No per-tile random rotation.
  float macro=groundNoise(worldUV/192.);
  float soil=groundNoise(worldUV/48.+vec2(17.,39.));
  float slope=1.-clamp(normalize(flightObjectNormal).y,0.,1.);
  float rockWeight=smoothstep(.13,.46,slope);
  float beds=groundNoise(vec2(point.x*.017+point.z*.011,point.y*.11));
  float rockFaces=groundNoise(vec2(point.x*.07+point.z*.043,point.y*.15+soil*1.7));
  float groundPatches=groundNoise(worldUV/18.+vec2(91.,12.));
  diffuseColor.rgb*=mix(.78,1.17,macro)*mix(.9,1.08,soil);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*mix(vec3(.68,.76,.79),vec3(1.20,1.11,.98),rockFaces),rockWeight*.72);
  diffuseColor.rgb*=mix(1.,mix(.82,1.08,groundPatches),.45*farDetail);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*mix(vec3(.76,.78,.79),vec3(1.14,1.10,1.02),beds),rockWeight*.6);
  // Wet sand follows the rendered height, never a coastline recipe anchor.
  float wetShore=(1.-smoothstep(-.7,2.3,flightWorld.y))*smoothstep(-3.,-.7,flightWorld.y);
  diffuseColor.rgb*=1.-wetShore*.18;
  if(flightReview.x>.5){float oldGrain=dot(texture2D(flightSurface,worldUV/32.).rgb,vec3(.3,.5,.2)); textureDetail=mix(1.,.65+oldGrain*1.8,flightSurfaceReady*flightReview.y*.65);}
  float bands=.96+.04*sin(flightWorld.y*.3+sin(flightWorld.x*.013+flightStrataPhase)*3.);
  diffuseColor.rgb*=textureDetail*mix(1.,bands,flightReview.z);
  if(flightReview.w>.5)diffuseColor.rgb=vec3(.45);
`
export const terrainDetailRoughness = `
  roughnessFactor=clamp(roughnessFactor-rockWeight*.14-wetShore*.22+(grain-.5)*.06*farDetail,.62,1.);
`
// A restrained derivative bump uses the same triplanar material coordinates. Geometric normals
// still come from the displayed morph; subpixel texture energy fades instead of sparkling.
export const terrainDetailNormal = `
  float bumpHeight=grain*.045*farDetail*flightSurfaceReady*flightReview.y;
  vec3 dpdx=dFdx(-vViewPosition),dpdy=dFdy(-vViewPosition);
  vec3 r1=cross(dpdy,normal),r2=cross(normal,dpdx);
  float det=dot(dpdx,r1);
  vec3 grad=sign(det)*(dFdx(bumpHeight)*r1+dFdy(bumpHeight)*r2);
  normal=normalize(abs(det)*normal-grad);
`
