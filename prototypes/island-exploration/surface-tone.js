import * as T from 'three';
// Shared by the terrain and the actual blade material in both quality modes.
export const grassRange={value:new T.Vector2(32,85)};
// Surface-gradient normal adapted from Tidewater (MIT), DRG Software Solutions LLC.
// The biome colour field is shared by terrain and rooted plants, in world metres.
export const surfaceToneGLSL=`
float pigmentHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float pigmentNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(pigmentHash(i),pigmentHash(i+vec2(1,0)),f.x),mix(pigmentHash(i+vec2(0,1)),pigmentHash(i+1.),f.x),f.y);}
vec3 meadowPigment(vec2 p){float a=pigmentNoise(p/173.),b=pigmentNoise(p/47.);float m=a*.55+b*.45;
 vec3 c=mix(vec3(.105,.145,.034),vec3(.17,.18,.055),smoothstep(.3,.8,m));
 c=mix(c,vec3(.29,.25,.105),smoothstep(.55,.85,m)*.35);
 c=mix(c,vec3(.085,.12,.03),(1.-smoothstep(.26,.46,b*.7+a*.3))*.7);
 float tuft=pigmentNoise(p/13.+vec2(pigmentNoise(p/37.))*2.);return c*mix(.92,1.06,smoothstep(.2,.78,tuft));}
vec3 surfaceGradient(vec3 P,vec3 N,float h){
 vec3 dx=dFdx(P),dy=dFdy(P),r1=cross(dy,N),r2=cross(N,dx);float det=dot(dx,r1),ad=abs(det);
 vec3 g=(r1*dFdx(h)+r2*dFdy(h))*sign(det);float area=length(cross(dx,dy));
 float stable=smoothstep(.12,.35,area/max(length(dx)*length(dy),1e-20))*smoothstep(.30,.60,ad/max(area,1e-20));
 g*=min(1.,ad*1.4/max(length(g),1e-20))*stable;return normalize(N*max(ad,1e-20)-g);}
`;
