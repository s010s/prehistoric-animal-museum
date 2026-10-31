// Frame reprojection adapted from Tidewater (MIT), DRG Software Solutions LLC.
// Fixed source 4811ba48d795197de5621985f404e765c0b7c0ef.
export const treeTime={value:0};
// Re-lightable impostor. Its position is shared by projection, fog and shadows.
export function configureForestImpostor(mesh,atlas,viewerPosition,forestRange,nearFraction){
 mesh.material.onBeforeCompile=s=>{
  Object.assign(s.uniforms,{treeNormals:{value:atlas.normalMap},treeTime,viewerPosition,forestRange,nearFraction});
  s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
  uniform float treeTime;uniform vec3 viewerPosition;attribute float nearSeed,treeYaw,treeSpecies;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw;varying vec3 treeScale,treeRoot,impostorWorld;`)
  .replace('#include <project_vertex>',`vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  treeRoot=root;treeScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
  vec3 center=root+vec3(0.,treeScale.y*.5,0.);vec3 toEye=cameraPosition-center;
  treeDistance=length(cameraPosition-root);rootDistance=length(viewerPosition-root);nearIdentity=nearSeed;treeType=treeSpecies;yaw=treeYaw;
  azimuth=mod((atan(toEye.x,toEye.z)-treeYaw)/.7853981634+24.,8.);elevation=clamp(atan(max(0.,toEye.y),length(toEye.xz))/.55,0.,2.);
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  airWorld=center+right*position.x*treeScale.x+up*(position.y-.5)*treeScale.y;
  airWorld.x+=(sin(treeTime*.61+root.x*.031+root.z*.024)+.32*sin(treeTime*1.37+root.z*.071))*max(0.,position.y)*treeScale.y*.003;
  impostorWorld=airWorld;vec4 mvPosition=viewMatrix*vec4(airWorld,1.);gl_Position=projectionMatrix*mvPosition;`)
  .replace('#include <worldpos_vertex>','vec4 worldPosition=vec4(airWorld,1.);');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
  uniform sampler2D treeNormals;uniform float forestRange,nearFraction;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw;varying vec3 treeScale,treeRoot,impostorWorld;
  vec4 atlasSample(sampler2D tx,vec2 p,float az,float el){vec2 padding=vec2(.5/${atlas.cell.toFixed(1)});p=clamp(p,padding,1.-padding);return texture2D(tx,(p+vec2(mod(az,8.),treeType*3.+el))/vec2(8.,${atlas.rows.toFixed(1)}));}
  vec2 frameUV(float az,float el){
   vec3 O=cameraPosition-(treeRoot+vec3(0.,treeScale.y*.5,0.)),D=impostorWorld-cameraPosition;
   float c=cos(yaw),s=sin(yaw);O=vec3(c*O.x-s*O.z,O.y,s*O.x+c*O.z)/treeScale;D=vec3(c*D.x-s*D.z,D.y,s*D.x+c*D.z)/treeScale;
   float a=az*.7853981634,e=el*.55;vec3 n=vec3(sin(a)*cos(e),sin(e),cos(a)*cos(e)),right=vec3(cos(a),0.,-sin(a)),up=cross(n,right);
   vec3 P=O-D*dot(O,n)/dot(D,n);return vec2(dot(P,right),dot(P,up))/1.4+.5;
  }
  vec4 frameSample(sampler2D tx,float a,float e){vec2 p=frameUV(a,e);if(any(lessThan(p,vec2(0.)))||any(greaterThan(p,vec2(1.))))return vec4(0.);return atlasSample(tx,p,a,e);}
  vec4 atlasBlend(sampler2D tx,vec2 p){float a=floor(azimuth),e=floor(elevation);if(rootDistance>280.)return frameSample(tx,floor(azimuth+.5),floor(elevation+.5));return mix(mix(frameSample(tx,a,e),frameSample(tx,a+1.,e),fract(azimuth)),mix(frameSample(tx,a,min(2.,e+1.)),frameSample(tx,a+1.,min(2.,e+1.)),fract(azimuth)),fract(elevation));}`)
  .replace('#include <map_fragment>',`vec4 canopy=atlasBlend(map,vMapUv);vec3 canopyNormal=atlasBlend(treeNormals,vMapUv).rgb/max(canopy.a,.001)*2.-1.;
  diffuseColor.rgb*=canopy.rgb/max(canopy.a,.001);diffuseColor.a*=canopy.a;

  float distant=1.-smoothstep(forestRange-1400.,forestRange,treeDistance);
  float nearCoverage=nearIdentity<nearFraction?1.-smoothstep(80.,112.,rootDistance):0.;float treeCoverage=distant*(1.-nearCoverage);if(treeCoverage<.001)discard;`)
  .replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nfloat transitionNoise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(transitionNoise<nearCoverage||transitionNoise>distant)discard;')
  .replace('#include <normal_fragment_maps>',`vec3 localNormal=normalize(canopyNormal/max(treeScale,vec3(.001)));float cy=cos(yaw),sy=sin(yaw);vec3 worldNormal=vec3(cy*localNormal.x+sy*localNormal.z,localNormal.y,-sy*localNormal.x+cy*localNormal.z);normal=normalize(mat3(viewMatrix)*worldNormal);`);
 s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.025;reflectedLight.indirectSpecular*=.025;');
 };mesh.material.customProgramCacheKey=()=> 'reprojected-canopy-r10';
}
