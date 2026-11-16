import * as T from 'three';
export async function makeTerrainLight(enabled){
 const data=enabled?new Float32Array(await(await fetch('./assets/terrain-horizon.bin')).arrayBuffer()):new Float32Array([-100,-106,0,1]);const size=enabled?1024:1;
 if(data.length!==size*size*4)throw Error('Invalid terrain horizon field');
 const horizon=new T.DataTexture(data,size,size,T.RGBAFormat,T.FloatType);horizon.minFilter=horizon.magFilter=T.LinearFilter;horizon.needsUpdate=true;
 return {terrainHorizon:{value:horizon},terrainLightEnabled:{value:enabled?1:0}};
}
export const terrainLightGLSL=`uniform sampler2D terrainHorizon,cloudShadow;uniform float terrainLightEnabled;
vec4 horizonAt(vec3 p){return texture2D(terrainHorizon,clamp((p.xz/20480.+.5)*(1023./1024.)+.5/1024.,0.,1.));}
float worldAmbient(vec3 p){vec4 h=horizonAt(p);float openSky=mix(h.a,1.,smoothstep(6.,90.,p.y-h.r));return mix(1.,mix(.52,1.,openSky),terrainLightEnabled);}
float worldSun(vec3 p){vec4 h=horizonAt(p);float penumbra=2.5+h.b*.009;float clouds=texture2D(cloudShadow,clamp(p.xz/20480.+.5,0.,1.)).r;return mix(1.,smoothstep(h.g-penumbra,h.g+penumbra,p.y)*mix(.55,1.,clouds),terrainLightEnabled);}`;
