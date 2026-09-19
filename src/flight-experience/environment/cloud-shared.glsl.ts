/** One world-space cloud volume for sky, receiver shadows and water reflection. */
export const CLOUD_GLSL=`
uniform sampler2D cloudDensityMap;
uniform vec2 cloudOrigin;uniform vec2 cloudPhase;
uniform float cloudCoverage;uniform float cloudThickness;uniform float cloudDataReady;uniform float cloudAppearanceWeight;
uniform float weatherHaze;uniform float rainWetness;
vec3 flightWorldPoint(vec3 viewPoint){return cameraPosition+transpose(mat3(viewMatrix))*viewPoint;}
float cloudOvercast(){return smoothstep(.55,.9,cloudCoverage)*cloudDataReady*cloudAppearanceWeight;}
float cloudHash(vec2 cell){return fract(sin(dot(mod(cell,8.),vec2(127.1,311.7)))*43758.5453);}
// Integrate a soft ellipsoid analytically: no stacked horizontal sampling planes.
vec3 cloudPuff(vec3 p,vec3 d,vec3 center,vec3 radius,vec3 sun){
 vec3 o=(p-center)/radius,v=d/radius;
 float a=dot(v,v),b=dot(o,v),t=-b/a;
 float core=1.-dot(o+v*t,o+v*t);
 if(core<-.12||t<=0.)return vec3(0.);
 vec3 q=p+d*t;
 vec2 detail=texture2D(cloudDensityMap,(q.xz+q.y*vec2(.5,.25))/4096.).rg;
 core+=(detail.r-.5)*.8+(detail.g-.5)*.12;
 if(core<=0.||t<=0.)return vec3(0.);
 float halfChord=sqrt(core/a);
 float optical=core*core*halfChord/300.*(.65+detail.r*.8);
 // Density erosion and optical-depth shading make the soft lobes read as cloud.
 float rim=pow(1.-clamp(core,0.,1.),.65);

 vec3 normal=normalize((o+v*(t-halfChord*.72))/radius);
 float light=.48+.32*dot(normal,sun)+.1*rim+.1*(detail.r-.5);
 return vec3(optical,optical*light,optical*t);
}
vec3 cloudMass(vec3 p,vec3 d,vec3 sun){
 if(d.y<=.00001||cloudCoverage<=0.||cloudDataReady<.5)return vec3(0.);
 p.xz=mod(p.xz+cloudOrigin-cloudPhase,65536.);
 vec2 tile=floor((p.xz+d.xz*((3100.-p.y)/d.y))/8192.);
 vec3 mass=vec3(0.);
 // Low-angle sun queries span more cells than a steep view ray.
 int reach=d.y<.08?3:(d.y<.18?2:1);
 for(int z=-3;z<=3;z++)for(int x=-3;x<=3;x++){
  if(abs(x)>reach||abs(z)>reach)continue;
  vec2 cell=tile+vec2(float(x),float(z));
  // Reject whole cells before hashes, texture fetches, and six lobe intersections.
  vec3 cellOffset=vec3((cell.x+.5)*8192.,3100.,(cell.y+.5)*8192.)-p;
  float cellT=max(0.,dot(cellOffset,d));
  vec3 cellMiss=cellOffset-d*cellT;
  if(dot(cellMiss,cellMiss)>36000000.)continue;
  float seed=cloudHash(cell),r=cloudHash(cell+vec2(3.,5.));
  float occupied=smoothstep(1.-cloudCoverage-.08,1.-cloudCoverage+.08,seed);
  if(occupied<=0.)continue;
  vec3 center=vec3((cell.x+.22+.56*r)*8192.,3000.+r*260.,(cell.y+.2+.6*cloudHash(cell+vec2(5.,2.)))*8192.);
  float angle=r*6.2831853;
  vec2 axis=vec2(cos(angle),sin(angle));
  float size=650.+1000.*cloudHash(cell+vec2(2.,1.));
  vec3 offset=center-p;
  vec3 miss=offset-d*max(0.,dot(offset,d));
  float bound=size*1.9+700.;
  if(dot(miss,miss)>bound*bound)continue;
  for(int j=0;j<6;j++){
   float f=float(j),k=cloudHash(cell+vec2(f+1.,f*2.+1.));
   vec3 c=center+vec3(axis.x,0.,axis.y)*(f-2.5)*size*.34;
   c.y+=(k-.5)*450.;
   c.xz+=vec2(-axis.y,axis.x)*(k-.5)*size*.9;
   vec3 radius=vec3(size*(.20+k*.52),180.+k*520.,size*(.2+(1.-k)*.45));
   mass+=cloudPuff(p,d,c,radius,sun)*occupied;
  }
 }
 return mass;
}
// Dense weather grows a continuous deck using the existing density asset.
float cloudDeck(vec3 p,vec3 d){
 if(d.y<=.00001||cloudCoverage<=.55||cloudDataReady<.5)return 0.;
 vec2 q=p.xz+d.xz*max(0.,(3200.-p.y)/d.y);
 vec2 uv=(q+cloudOrigin-cloudPhase)/65536.;
 float density=texture2D(cloudDensityMap,uv*4.).r;
 return smoothstep(.55,.95,cloudCoverage)*(.5+density*.7);
}
float cloudOptical(vec3 p,vec3 d){return (cloudMass(p,d,vec3(0.,1.,0.)).x+cloudDeck(p,d))*cloudThickness;}
// Rain curtains sample the same cloud column as the sky and receiver lighting.
float cloudDensity(vec2 p){return (1.-exp(-cloudOptical(vec3(p.x,0.,p.y),vec3(0.,1.,0.))))*cloudAppearanceWeight;}
float cloudTransmission(vec3 p,vec3 d){
 if(d.y<=.00001||cloudCoverage<=0.||cloudDataReady<.5)return 1.;
 // A column approximation for receivers avoids marching low-angle sun rays per pixel.
 vec2 column=p.xz+d.xz*max(0.,(3100.-p.y)/d.y);
 float optical=cloudOptical(vec3(column.x,0.,column.y),vec3(0.,1.,0.));
 return mix(1.,exp(-optical*.65),cloudAppearanceWeight);
}
vec3 cloudSky(vec3 p,vec3 d,vec3 base,vec3 ambient,vec3 solar,vec3 sun){
 if(d.y<=.00001||cloudCoverage<=0.||cloudDataReady<.5)return base;
 float overcast=smoothstep(.55,.9,cloudCoverage);
 vec3 mass=(3100.-p.y)/d.y<38000.?cloudMass(p,d,sun):vec3(0.);
 float deck=cloudDeck(p,d),optical=(mass.x+deck)*cloudThickness;
 float distanceToCloud=mass.z/max(.0001,mass.x);
 float distanceFade=max(distanceToCloud,(3100.-p.y)/max(.001,d.y));
 float aerial=exp(-distanceFade/38000.)*(1.-smoothstep(16000.,38000.,distanceFade));
 float alpha=(1.-exp(-optical))*aerial*smoothstep(.0,.025,d.y);
 float light=(mass.y+deck*.18)/max(.0001,mass.x+deck);
 float lowSun=1.-smoothstep(.1,.4,sun.y);
 vec3 fill=mix(ambient,base,.55+.3*(1.-smoothstep(.05,.5,d.y)));
 vec3 shade=fill*.72+vec3(.12,.13,.14);
 vec3 lit=mix(vec3(1.6,1.64,1.7),vec3(1.6,1.05,.60),lowSun*.7);
 vec3 c=mix(shade,lit,clamp(light+.16*exp(-optical),0.,1.));
 c+=solar*.04*exp(-optical*.5);
 vec3 scattered=mix(base,c,alpha*(1.-overcast*.85));
 // The overhead deck is a continuous ceiling, not distant puffs faded by their range.
 vec2 ceilingUV=(p.xz+cloudOrigin-cloudPhase+d.xz*(2400.-p.y)/sqrt(.04+d.y*d.y))/12000.;
 float broad=texture2D(cloudDensityMap,ceilingUV).r;
 float rolling=texture2D(cloudDensityMap,ceilingUV*2.13+vec2(.17,.41)).r;
 float relief=smoothstep(.28,.72,broad*.75+rolling*.25);
 vec3 ceiling=mix(vec3(.045,.06,.095),vec3(.28,.30,.34),relief);
 float warmth=(1.-smoothstep(.04,.38,d.y))*lowSun;
 ceiling=mix(ceiling,base*.62+solar*.035,warmth*.7);
 float ceilingAlpha=overcast*smoothstep(.018,.24,d.y)*(.82+.14*relief);
 return mix(base,mix(scattered,ceiling,ceilingAlpha),cloudAppearanceWeight);
}
`
