import * as T from 'three';
export const treeSemanticEnabled={value:false},treeDebugView={value:0},treeRepresentation={value:0},treeReviewRoot={value:new T.Vector3()},treeReviewRadius={value:0};
export const treeMaterialConfig=Object.freeze({channels:'R leaf fraction, G authored crown exposure, B species transmission, A coverage',exposure:'template vertex shade proxy, not ray-traced AO',depth:'existing card raster depth; reconstructed lighting/fog surface only'});
export function prepareTreeMaterials(templates){
 for(const [species,tree]of templates.entries())for(const part of tree.parts){
  const leaf=part.material.alphaTest>0,g=part.geometry,color=g.getAttribute('color'),exposure=new Float32Array(g.getAttribute('position').count);
  for(let i=0;i<exposure.length;i++)exposure[i]=leaf&&color?Math.max(.25,Math.min(1,color.getY(i))):1;
  g.setAttribute('crownExposure',new T.BufferAttribute(exposure,1));
  part.material.userData.treeSemantic={leaf,species,transmission:leaf?(species===2?.5:.25):0};
 }
}
export const treeReviewGLSL=`
uniform int treeRepresentation;uniform vec3 treeReviewRoot;uniform float treeReviewRadius;
bool treeReviewMatch(vec3 root){return treeReviewRadius>0.&&distance(root,treeReviewRoot)<treeReviewRadius;}
`;
export function patchTreeMaterial(shader,material){
 const meta=material.userData?.treeSemantic,isForest=Boolean(material.defines?.ISLAND_FOREST_SURFACE);
 if(!meta&&!isForest)return;
 Object.assign(shader.uniforms,{treeSemanticEnabled,treeDebugView,treeRepresentation,treeReviewRoot,treeReviewRadius});
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nuniform int treeDebugView;\nvec3 treeTransmissionContribution=vec3(0.);float treeShadowVisibility=1.;`);
 if(meta){
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float crownExposure;varying float treeCrownExposure;varying vec3 treeMaterialRoot;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntreeCrownExposure=crownExposure;treeMaterialRoot=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying float treeCrownExposure;varying vec3 treeMaterialRoot;\n${treeReviewGLSL}`)
   .replace('if(transitionNoise>=nearCoverage)discard;', 'if(treeRepresentation>0&&treeReviewMatch(treeMaterialRoot)){if(treeRepresentation==2)discard;}else if(transitionNoise>=nearCoverage)discard;')
   .replace('else if(rootDistance>112.)discard;', 'else if(!treeReviewMatch(treeMaterialRoot)&&rootDistance>112.)discard;');
 }
 const leaf=isForest?'forestLeafFraction':meta.leaf?'1.':'0.',exposure=isForest?'forestCrownExposure':'treeCrownExposure';
 shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>\nif(treeSemanticEnabled){reflectedLight.indirectDiffuse*=mix(1.,${exposure},${leaf});reflectedLight.indirectSpecular*=mix(1.,${exposure},${leaf});}`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`if(treeDebugView==1)outgoingLight=diffuseColor.rgb;
 if(treeDebugView==2)outgoingLight=max(vec3(0.),reflectedLight.directDiffuse-treeTransmissionContribution);
 if(treeDebugView==3)outgoingLight=reflectedLight.indirectDiffuse;
 if(treeDebugView==4)outgoingLight=treeTransmissionContribution;
 if(treeDebugView==5)outgoingLight=vec3(treeShadowVisibility);
 if(treeDebugView==6)outgoingLight=vec3(1.);
 if(treeDebugView==7)outgoingLight=vec3(${leaf},${exposure},0.);
 #include <opaque_fragment>`);
 // Track the actual transmission term without changing its evaluation order.
 const term='if(canopyCandidateEnabled)reflectedLight.directDiffuse+=';
 shader.fragmentShader=shader.fragmentShader.replace(term,`if(canopyCandidateEnabled){if(treeDebugView==2||treeDebugView==4)treeTransmissionContribution=directLight.color*clamp(leafTransmissionEnabled,0.,1.)*canopyTransmission(material.diffuseContribution,geometryNormal,directLight.direction,geometryViewDir);reflectedLight.directDiffuse+=`)
  .replace('canopyTransmission(material.diffuseContribution,geometryNormal,directLight.direction,geometryViewDir);\n else', 'canopyTransmission(material.diffuseContribution,geometryNormal,directLight.direction,geometryViewDir);}\n else');
 // Debug the real light gate after native shadow lookup, before world lighting.
 shader.fragmentShader=shader.fragmentShader.replace('directLight.color*=sunVisibility;', 'if(treeDebugView==5)treeShadowVisibility=dot(directLight.color,vec3(1.))/max(.0001,dot(directionalLight.color,vec3(1.)));\n directLight.color*=sunVisibility;');
}
