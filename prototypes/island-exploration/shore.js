import * as T from 'three'
export const SHORE={x:9160,z:2330,size:768,res:385};
export const shoreTime={value:0};
let resources;
export function shoreResources(){return resources??=(async()=>{const data=await (await fetch('./assets/coast-height.bin')).arrayBuffer(),tx=new T.DataTexture(new Float32Array(data),SHORE.res,SHORE.res,T.RedFormat,T.FloatType);tx.minFilter=tx.magFilter=T.LinearFilter;tx.needsUpdate=true;return {shoreHeight:{value:tx},shoreTime}})()}
// A local authored shore cell. Height, run-up, foam and sand wetting all evaluate
// this same field. It is an analytic wave cycle, not Tidewater's fluid solver.
export const shoreGLSL=`
 uniform sampler2D shoreHeight;uniform float shoreTime;
 float shoreMask(vec2 p){return 1.-smoothstep(330.,375.,max(abs(p.x-9160.),abs(p.y-2330.)));}
 float shoreGround(vec2 p){return texture2D(shoreHeight,((p-vec2(9160.,2330.))/768.+.5)*(384./385.)+.5/385.).r;}
 vec2 shoreGradient(vec2 p){return vec2(shoreGround(p+vec2(2.,0.))-shoreGround(p-vec2(2.,0.)),shoreGround(p+vec2(0.,2.))-shoreGround(p-vec2(0.,2.)))/4.;}
 float shoreNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);}
 float shorePhase(vec2 p,float depth,float clock){return clock*.86+depth*4.2+sin(p.y*.035+p.x*.011)*.38+(shoreNoise(p/18.)-.5)*1.1+(shoreNoise(p/43.)-.5)*1.7;}
 float runupAt(vec2 p,float clock){float along=p.y*.013+p.x*.004;float cycle=clock/10.5+sin(along)*.08;float t=fract(cycle);float height=.82+.18*sin(floor(cycle)*2.399+along*.4);return -.25+height*pow(max(0.,sin(t*3.14159265)),1.65)+(shoreNoise(vec2(p.y*.31,clock*.045))-.5)*.18+(shoreNoise(vec2(p.y*.079,clock*.027))-.5)*.24;}
 // Front distance and draining film adapted from Tidewater ShoreWaves/WaterMaterial (MIT).
 // Our analytic cycle peaks at .5, so classify flow by the actual run-up derivative.
 vec3 shoreSwash(vec2 p,float ground,vec2 slope,float clock){
  float front=(runupAt(p,clock)-(ground+.7))/max(.025,length(slope));
  float retreat=smoothstep(-.02,.06,(runupAt(p,clock-.12)-runupAt(p,clock+.12))/.24);
  front+=((shoreNoise(p*1.1)-.5)*.7+(shoreNoise(p*3.7+vec2(5.3,1.9))-.5)*.3)*retreat;
  float raw=.035*(.7+.3*shoreNoise(p*.9));float film=min(raw,max(0.,front)*mix(.08,.025,retreat));
  return vec3(front,film,retreat);
 }
 float shoreWet(vec2 p){float mask=shoreMask(p);if(mask<.001)return 0.;float h=shoreGround(p)+.7,r=runupAt(p,shoreTime);float fresh=1.-smoothstep(r-.1,r+.15,h);float residue=(1.-smoothstep(.45,.85,h))*(.6+.22*sin(shoreTime*.12+p.y*.01));return shoreMask(p)*max(fresh,residue);}
 vec2 shoreSurface(vec2 p){float mask=shoreMask(p);if(mask<.001)return vec2(-.7,0.);float ground=shoreGround(p),depth=-.7-ground;vec2 slope=shoreGradient(p);float slopeLen=length(slope);float beach=1.-smoothstep(.19,.36,slopeLen);mask*=beach;
 float phase=shorePhase(p,depth,shoreTime);
 float shoal=(1.-smoothstep(2.5,7.,depth))*smoothstep(-.4,1.5,depth);
 float crest=pow(max(0.,sin(phase)),4.);float wave=(crest*.60-.12)*shoal;
 vec3 swash=shoreSwash(p,ground,slope,shoreTime);float film=1.-smoothstep(.10,.65,depth);
 // Extend carrier geometry across the analytic front. Collapsing dry vertices
 // onto the sand makes the 2 m triangle grid cut the front into stairs.
 float height=mix(-.7+wave,ground+max(.04,swash.y),film);
 return vec2(height,mask);
 }
`;
