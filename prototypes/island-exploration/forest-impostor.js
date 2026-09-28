export const treeTime={value:0};
// Re-lightable impostor. Its position is shared by projection, fog and shadows.
export function configureForestImpostor(mesh,atlas,viewerPosition,forestRange,nearFraction){
 mesh.material.onBeforeCompile=s=>{
  Object.assign(s.uniforms,{treeNormals:{value:atlas.normalMap},treeTime,viewerPosition,forestRange,nearFraction});
  s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
  uniform float treeTime;uniform vec3 viewerPosition;attribute float nearSeed,treeYaw,treeSpecies;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw;varying vec3 treeScale;`)
  .replace('#include <project_vertex>',`vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  treeScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
  vec3 center=root+vec3(0.,treeScale.y*.5,0.);vec3 toEye=cameraPosition-center;
  treeDistance=length(cameraPosition-root);rootDistance=length(viewerPosition-root);nearIdentity=nearSeed;treeType=treeSpecies;yaw=treeYaw;
  azimuth=mod((atan(toEye.x,toEye.z)-treeYaw)/.7853981634+24.,8.);elevation=clamp(atan(max(0.,toEye.y),length(toEye.xz))/.55,0.,2.);
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  airWorld=center+right*position.x*treeScale.x+up*(position.y-.5)*treeScale.y;
  airWorld.x+=sin(treeTime*1.15+root.x*.031+root.z*.024)*max(0.,position.y)*treeScale.y*.008;
  vec4 mvPosition=viewMatrix*vec4(airWorld,1.);gl_Position=projectionMatrix*mvPosition;`)
  .replace('#include <worldpos_vertex>','vec4 worldPosition=vec4(airWorld,1.);');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
  uniform sampler2D treeNormals;uniform float forestRange,nearFraction;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw;varying vec3 treeScale;
  vec4 atlasSample(sampler2D tx,vec2 p,float az,float el){vec2 padding=vec2(.5/${atlas.cell.toFixed(1)});p=clamp(p,padding,1.-padding);return texture2D(tx,(p+vec2(mod(az,8.),treeType*3.+el))/vec2(8.,${atlas.rows.toFixed(1)}));}
  vec4 atlasBlend(sampler2D tx,vec2 p){float a=floor(azimuth),e=floor(elevation);return mix(mix(atlasSample(tx,p,a,e),atlasSample(tx,p,a+1.,e),fract(azimuth)),mix(atlasSample(tx,p,a,min(2.,e+1.)),atlasSample(tx,p,a+1.,min(2.,e+1.)),fract(azimuth)),fract(elevation));}`)
  .replace('#include <map_fragment>',`vec4 canopy=atlasBlend(map,vMapUv);vec3 canopyNormal=atlasBlend(treeNormals,vMapUv).rgb/max(canopy.a,.001)*2.-1.;
  diffuseColor.rgb*=canopy.rgb/max(canopy.a,.001);diffuseColor.a*=canopy.a;

  float distant=1.-smoothstep(forestRange-1400.,forestRange,treeDistance);
  float nearCoverage=nearIdentity<nearFraction?1.-step(70.,rootDistance):0.;float treeCoverage=distant*(1.-nearCoverage);if(treeCoverage<.001)discard;`)
  .replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(treeCoverage<.5)discard;')
  .replace('#include <normal_fragment_maps>',`vec3 localNormal=normalize(canopyNormal/max(treeScale,vec3(.001)));float cy=cos(yaw),sy=sin(yaw);vec3 worldNormal=vec3(cy*localNormal.x+sy*localNormal.z,localNormal.y,-sy*localNormal.x+cy*localNormal.z);normal=normalize(mat3(viewMatrix)*worldNormal+normalize(vViewPosition)*.25);`);
 s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.15;reflectedLight.indirectSpecular*=.15;');
 };mesh.material.customProgramCacheKey=()=> 'relightable-matched-conifer-r6';
}
