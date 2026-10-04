// Height-dependent cumulus erosion and optical depth studied against Tidewater's
// current SkyProClouds.js (MIT repository). Noise remains generated locally.
export const islandCloudGLSL=`
uniform sampler3D cloudNoiseMap;uniform sampler2D cloudWeather;
uniform vec2 cloudOrigin,cloudPhase;
uniform float cloudCoverage,cloudThickness,cloudDataReady,cloudAppearanceWeight,weatherHaze,rainWetness,cloudStepCount;
float cloudOvercast(){return smoothstep(.55,.9,cloudCoverage)*cloudAppearanceWeight;}
// Density construction adapted from Tidewater SkyProClouds.js, MIT, DRG Software Solutions LLC.
float cloudField(vec3 p){
 vec3 q=p-vec3(cloudPhase.x,0.,cloudPhase.y);q.xz+=cloudOrigin;
 float h=(p.y-4000.)/5200.;if(h<-.1||h>1.3)return 0.;
 float weather=texture2D(cloudWeather,q.xz/29000.).r;
 q.xz-=vec2(.23,.08)*max(0.,p.y-4000.);
 float edge=max(.095*exp2(-max(h,0.)),.0001);
 float required=(1.-smoothstep(0.,.13,h))*.54;
 float floorMask=smoothstep(required-.1,required,weather);
 vec3 baseSample=texture(cloudNoiseMap,q/7500.).rgb;
 float dilation=dot(baseSample,vec3(.7,.41,.23))*.69;
 float top=weather+cloudCoverage-1.+dilation*cloudCoverage;
 float localHeight=clamp(h/max(top,.001),0.,1.);
 vec3 erodeSample=texture(cloudNoiseMap,q/975.).rgb;
 float erosion=dot(erodeSample,vec3(.113,.04,.02))*mix(.24,2.15,localHeight)*cloudCoverage;
 return smoothstep(-edge,edge,top-erosion-h)*smoothstep(-edge,edge,h-erosion)*floorMask*cloudDataReady;
}
float cloudTransmission(vec3 p,vec3 sun){
 if(sun.y<=.001)return 1.;float t=max(0.,(4000.-p.y)/sun.y),ds=5200./max(.12,sun.y)/20.,tau=0.;
 for(int i=0;i<20;i++)tau+=cloudField(p+sun*(t+(float(i)+.5)*ds))*ds*.007*cloudThickness;
 return mix(1.,exp(-tau),cloudAppearanceWeight);
}
vec4 traceCloudSky(vec3 p,vec3 d,vec3 base,vec3 ambient,vec3 solar,vec3 sun){
 if(d.y<=.035||cloudCoverage<=0.||cloudDataReady<.5)return vec4(base,1.);
 float start=max(0.,(4000.-p.y)/d.y),end=min((9200.-p.y)/d.y,70000.);
 if(end<=start)return vec4(base,1.);
 float ds=(end-start)/cloudStepCount,transmission=1.;vec3 light=vec3(0.);
 for(int i=0;i<240;i++){
  if(float(i)>=cloudStepCount)break;
  float dist=start+(float(i)+fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))))*ds;vec3 q=p+d*dist;float den=cloudField(q);
  if(den>.001){
   float h=clamp((q.y-4000.)/5200.,0.,1.);
   float sunDepth=(cloudField(q+sun*65.)*110.+cloudField(q+sun*200.)*240.+cloudField(q+sun*550.)*580.+cloudField(q+sun*1200.)*900.)*.007*cloudThickness;
   float skyDepth=(cloudField(q+vec3(0.,125.,0.))*250.+cloudField(q+vec3(0.,600.,0.))*700.)*.007*cloudThickness;
   float direct=exp(-sunDepth),multiple=.44*exp(-sunDepth*.35)+.18*exp(-sunDepth*.12);
   float powder=mix(.45,1.,1.-exp(-den*2.5));float forward=pow(max(0.,dot(d,sun)),12.);
   float baseShadow=mix(.22,1.,smoothstep(0.,.16,h));
   vec3 fill=mix(vec3(.23,.30,.40),ambient,sqrt(h))*(.25+.75/(1.+skyDepth*.35));
   vec3 radiance=fill+solar*(direct*1.35+multiple)*baseShadow*powder+solar*forward*direct*.4;
   float dt=1.-exp(-den*ds*.007*cloudThickness);float haze=1.-exp(-dist/42000.);
   light+=transmission*dt*mix(radiance,base,haze);transmission*=1.-dt;
   if(transmission<.008)break;
  }
 }
 float weight=cloudAppearanceWeight*smoothstep(.035,.085,d.y);return vec4(mix(base,base*transmission+light,weight),mix(1.,transmission,weight));
}
`;
