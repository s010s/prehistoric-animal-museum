import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Material, type Texture, type Vector2 } from 'three'
export type MaterialTrial = {method:'histogram'|'triangle'|'four'|'tiled';channel:'pbr'|'albedo'|'normal'|'roughness'|'weights';scale:number;layers:2|4}
/** Finite trial: compare source tiling, old four-cell averaging and triangular statistics. */
export function sampleHeight(x:number,z:number){
 const hill=18*Math.exp(-((x+25)**2/350+(z+9)**2/700))
 return hill+4*Math.exp(-((x-24)**2/650+(z+16)**2/650))+2.3*Math.sin(x/21)*Math.cos(z/27)+.045*(18-z)+.5
}
export function makeMaterialTerrain(library:MeshStandardMaterial[],decorate:(m:Material)=>void,trial:MaterialTrial){
 const geometry=new BufferGeometry(),positions:number[]=[],uv:number[]=[],indices:number[]=[],n=65,size=104
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const wx=x/(n-1)*size-size/2,wz=z/(n-1)*size-size/2;positions.push(wx,sampleHeight(wx,wz),wz);uv.push(wx/24,wz/24);if(z<n-1&&x<n-1){const a=z*n+x;indices.push(a,a+n,a+1,a+1,a+n,a+n+1)}}
 geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));geometry.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));geometry.setIndex(indices);geometry.computeVertexNormals()
 const material=new MeshStandardMaterial({map:library[0]!.map,normalMap:library[0]!.normalMap,roughness:1})
 decorate(material);decorateMaterialTerrain(material,library,trial)
 const mesh=new Mesh(geometry,material);mesh.receiveShadow=true
 return mesh
}

/** Shared by the finite art trial and every streamed terrain LOD. */
export function decorateMaterialTerrain(material:MeshStandardMaterial,library:MeshStandardMaterial[],trial:MaterialTrial,origin?:{value:Vector2},review?:{value:Vector2}){
 material.map=library[0]!.map;material.normalMap=library[0]!.normalMap
 const baseKey=material.customProgramCacheKey()
 const compile=material.onBeforeCompile.bind(material)
 material.onBeforeCompile=(s,r)=>{
  compile.call(material,s,r)
  library.forEach((m,i)=>{const data=m.userData.stochastic as {gaussian:Texture;inverse:Texture;metresPerRepeat:number;atlasRect?:{x:number;y:number;z:number;w:number}};s.uniforms.trialAlbedoAtlas={value:trial.method==='histogram'?data.gaussian:m.map};s.uniforms.trialRawAlbedo={value:m.map};s.uniforms.trialInverse={value:data.inverse};s.uniforms[`trialScale${i}`]={value:data.metresPerRepeat*trial.scale};s.uniforms[`trialAtlasRect${i}`]={value:data.atlasRect??{x:0,y:0,z:1,w:1}};s.uniforms.trialNormalAtlas={value:m.normalMap};s.uniforms.trialARMAtlas={value:m.roughnessMap}})
  if(review){const source=library[5]!.userData.stochastic as {independent?:{gaussian:Texture;normal:Texture;arm:Texture}};const fallback=library[0]!.userData.stochastic as {gaussian:Texture};s.uniforms.trialIndependentAlbedo={value:source.independent?.gaussian??fallback.gaussian};s.uniforms.trialIndependentNormal={value:source.independent?.normal??library[0]!.normalMap};s.uniforms.trialIndependentARM={value:source.independent?.arm??library[0]!.roughnessMap}}
  if(origin)s.uniforms.trialOrigin=origin
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 trialPosition; varying vec3 trialNormal;').replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\ntrialPosition=${origin?'(modelMatrix*vec4(transformed,1.)).xyz+vec3(trialOrigin.x,0.,trialOrigin.y)':'position'};trialNormal=objectNormal;`)
  if(origin)s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform vec2 trialOrigin;')
  if(origin)s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 surfaceWeightsA; attribute vec3 surfaceWeightsB; varying vec3 vSurfaceA; varying vec3 vSurfaceB;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSurfaceA=surfaceWeightsA;vSurfaceB=surfaceWeightsB;')
  if(review)s.uniforms.surfaceReview=review
  const declaration=`uniform sampler2DArray trialAlbedoAtlas; uniform sampler2DArray trialRawAlbedo; uniform sampler2DArray trialNormalAtlas; uniform sampler2DArray trialARMAtlas;\n`+library.map((_,i)=>`uniform float trialScale${i}; uniform vec4 trialAtlasRect${i};`).join('\n')
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
${declaration}
uniform sampler2D trialInverse;
#define TRIAL_METHOD ${['tiled','four','triangle','histogram'].indexOf(trial.method)}
varying vec3 trialPosition; varying vec3 trialNormal;
float trialHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float trialNoise(vec2 p){vec2 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(trialHash(cell),trialHash(cell+vec2(1.,0.)),f.x),mix(trialHash(cell+vec2(0.,1.)),trialHash(cell+vec2(1.,1.)),f.x),f.y);}
vec4 trialCell(sampler2DArray tex,vec4 rect,vec2 p,vec2 dx,vec2 dy,vec2 cell,bool bump,bool directional,float layer){float a=directional?0.0:trialHash(cell)*6.2831853;float c=cos(a),s=sin(a);mat2 rotation=mat2(c,s,-s,c);vec2 uv=rotation*p+vec2(trialHash(cell+23.7),trialHash(cell+71.3))*17.0;vec4 sampleValue=textureGrad(tex,vec3(fract(uv),layer),rotation*dx,rotation*dy);if(bump){vec3 n=sampleValue.xyz*2.0-1.0;n.xy=transpose(rotation)*n.xy;return vec4(n,1.0);}return sampleValue;}
vec4 trialSample(sampler2DArray tex,vec4 rect,vec2 p,vec2 dx,vec2 dy,bool bump,bool gaussian,bool directional,float layer){
 #if TRIAL_METHOD == 0
 vec4 direct=textureGrad(tex,vec3(fract(p),layer),dx,dy);return bump?vec4(direct.xyz*2.-1.,1.):direct;
 #elif TRIAL_METHOD == 1
 vec2 base=floor(trialPosition.xz/12.),f=smoothstep(vec2(0),vec2(1),fract(trialPosition.xz/12.));
 return mix(mix(trialCell(tex,rect,p,dx,dy,base,bump,directional,layer),trialCell(tex,rect,p,dx,dy,base+vec2(1,0),bump,directional,layer),f.x),mix(trialCell(tex,rect,p,dx,dy,base+vec2(0,1),bump,directional,layer),trialCell(tex,rect,p,dx,dy,base+vec2(1,1),bump,directional,layer),f.x),f.y);
 #else
 vec2 q=mat2(1.0,0.0,-.577350269,1.154700538)*p,cell=floor(q),f=fract(q);
 vec2 a=cell,b,c;vec3 w;
 if(f.x+f.y<1.0){b=cell+vec2(1,0);c=cell+vec2(0,1);w=vec3(1.0-f.x-f.y,f.x,f.y);}else{a=cell+1.;b=cell+vec2(0,1);c=cell+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
 vec4 value=trialCell(tex,rect,p,dx,dy,a,bump,directional,layer)*w.x+trialCell(tex,rect,p,dx,dy,b,bump,directional,layer)*w.y+trialCell(tex,rect,p,dx,dy,c,bump,directional,layer)*w.z;
 if(gaussian)value.rgb=(value.rgb-.5)/sqrt(dot(w,w))+.5;
 return value;
 #endif
}
vec3 trialColor(sampler2DArray tex,sampler2D inverse,vec4 rect,vec2 p,vec2 dx,vec2 dy,bool directional,float sampleLayer,float lutLayer){
 #if TRIAL_METHOD != 3
 return trialSample(tex,rect,p,dx,dy,false,false,directional,sampleLayer).rgb;
 #else
 vec3 g=clamp(trialSample(tex,rect,p,dx,dy,false,true,directional,sampleLayer).rgb,0.,1.);
 float level=clamp(log2(max(length(dx),length(dy))*512.),0.,9.);
 vec3 srgb=vec3(texture2D(inverse,vec2(g.r,1.-(level+.5+lutLayer*10.)/${library.length*10}.)).r,texture2D(inverse,vec2(g.g,1.-(level+.5+lutLayer*10.)/${library.length*10}.)).g,texture2D(inverse,vec2(g.b,1.-(level+.5+lutLayer*10.)/${library.length*10}.)).b);
 return mix(srgb/12.92,pow((srgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),srgb));
 #endif
}
vec4 trialWeights(){float slope=1.0-normalize(trialNormal).y;float rock=max(smoothstep(.035,.22,slope),smoothstep(6.0,11.0,trialPosition.y)*(1.0-smoothstep(-10.0,2.0,trialPosition.x)));float sand=1.0-smoothstep(.15,2.1,trialPosition.y);float floorWeight=smoothstep(-7.0,18.0,trialPosition.x)*smoothstep(1.2,3.0,trialPosition.y);vec4 w=vec4(rock,(1.0-floorWeight)*(1.0-sand),sand,floorWeight*(1.0-sand));w.yzw*=1.0-rock;return w/max(.001,dot(w,vec4(1.0)));}
`)
  if(origin)s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSurfaceA; varying vec3 vSurfaceB;')
  if(review)s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform vec2 surfaceReview; uniform sampler2DArray trialIndependentAlbedo; uniform sampler2DArray trialIndependentNormal; uniform sampler2DArray trialIndependentARM;')
  if(origin)s.fragmentShader=s.fragmentShader.replace(/vec4 trialWeights\(\)\{[^}]+\}/,`vec4 trialWeights(){vec3 a=max(vSurfaceA,vec3(0.)),b=max(vSurfaceB,vec3(0.));return vec4(a.x,a.y,a.z,b.x);}\nvec2 trialExtraWeights(){return max(vSurfaceB.yz,vec2(0.));}`)
  const layers=library.map((_,i)=>{const weight=i<4?`tw.${'xyzw'[i]}`:origin?`tx.${'xy'[i-4]}`:'0.';const grade=i===0?'color=mix(vec3(.21,.15,.11),color,.38);':i===5?'color*=vec3(.72,.94,.82);':'';const fadeStart=i===1?.005:.014,fadeEnd=i===1?.02:.065;return `if(${weight}>.001){vec2 p=trialUV/trialScale${i},dx=trialDx/trialScale${i},dy=trialDy/trialScale${i};float weight=${weight};vec3 color=trialColor(trialAlbedoAtlas,trialInverse,trialAtlasRect${i},p,dx,dy,${i===0||i===2?'true':'false'},${i}.0,${i}.0);${origin?`// The source spans only a few metres; at flight height its repeated features must not become landscape-scale relief.
float footprint=max(length(dx),length(dy));float fade=smoothstep(${fadeStart},${fadeEnd},footprint);vec3 meanColor=textureLod(trialRawAlbedo,vec3(.5,.5,${i}.0),9.).rgb;color=mix(color,meanColor,fade);${i===1||i===5?'// Subtle world-scale variation remains visible once centimetre-scale texels are filtered.\ncolor*=.91+.12*trialNoise(trialPosition.xz/17.+vec2('+i+'.))+.045*trialNoise(trialPosition.xz/4.7+vec2('+i+'.));':''}`:''}${review?`if(surfaceReview.x==11.)color=textureGrad(trialRawAlbedo,vec3(fract(p),${i}.0),dx,dy).rgb;if(surfaceReview.x==12.)color=trialSample(trialRawAlbedo,trialAtlasRect${i},p,dx,dy,false,false,${i===0||i===2?'true':'false'},${i}.0).rgb;`:''}${grade}trialC+=color*weight;trialA+=trialSample(trialARMAtlas,trialAtlasRect${i},p,dx,dy,false,false,${i===0||i===2?'true':'false'},${i}.0).rgb*weight;trialN+=trialSample(trialNormalAtlas,trialAtlasRect${i},p,dx,dy,true,false,${i===0||i===2?'true':'false'},${i}.0).xyz*weight;}`}).join('\n')
  s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`vec3 tn=normalize(trialNormal);vec2 trialUV=abs(tn.y)>=max(abs(tn.x),abs(tn.z))?trialPosition.xz:(abs(tn.x)>abs(tn.z)?trialPosition.zy:trialPosition.xy);vec2 trialDx=dFdx(trialUV),trialDy=dFdy(trialUV);vec4 tw=trialWeights();vec2 tx=${origin?'trialExtraWeights()':'vec2(0.)'};${trial.layers===2?'tw=vec4(tw.x,1.-tw.x,0.,0.);':''}${origin?'float rockEdge=tw.x;float edgeMask=smoothstep(0.,.22,rockEdge)*(1.-smoothstep(.78,1.,rockEdge));float patches=(trialNoise(trialPosition.xz/34.)-.5)*.67+(trialNoise(trialPosition.xz/10.)-.5)*.33;tw.x=clamp(rockEdge+patches*.72*edgeMask,0.,rockEdge+tw.y);tw.y+=rockEdge-tw.x;':''}${review?'if(surfaceReview.x==2.||surfaceReview.x==10.){int layer=int(surfaceReview.y);tw=vec4(float(layer==0),float(layer==1),float(layer==2),float(layer==3));tx=vec2(float(layer==4),float(layer==5));}':''}vec3 trialC=vec3(0),trialA=vec3(0),trialN=vec3(0);${layers}${review?'if(surfaceReview.x==10.){vec2 p=trialUV/trialScale5,dx=trialDx/trialScale5,dy=trialDy/trialScale5;vec4 rect=vec4(0.,0.,1.,1.);trialC=trialColor(trialIndependentAlbedo,trialInverse,rect,p,dx,dy,false,0.,5.)*vec3(.55,1.12,.93);trialA=trialSample(trialIndependentARM,rect,p,dx,dy,false,false,false,0.).rgb;trialN=trialSample(trialIndependentNormal,rect,p,dx,dy,true,false,false,0.).xyz;}':''}diffuseColor.rgb*=trialC;`)
  if(origin)s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','')
  s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>','float roughnessFactor=roughness*trialA.g;')
  s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>','trialN=normalize(trialN);trialN.xy*=.65;normal=normalize(getTangentFrame(-vViewPosition,normal,trialUV)*trialN);')
  const diagnostic=trial.channel==='albedo'?'pow(max(trialC,vec3(0)),vec3(1./2.2))':trial.channel==='normal'?'trialN*.5+.5':trial.channel==='roughness'?'vec3(trialA.g)':trial.channel==='weights'?'tw.xyz+tw.w*vec3(.6,.2,.7)':null
  if(diagnostic)s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>\ngl_FragColor=vec4(${diagnostic},1.);`)
  if(review)s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
if(surfaceReview.x==1.){vec3 a=max(vSurfaceA,vec3(0.)),b=max(vSurfaceB,vec3(0.));float w[6];w[0]=a.x;w[1]=a.y;w[2]=a.z;w[3]=b.x;w[4]=b.y;w[5]=b.z;int best=0;for(int i=1;i<6;i++)if(w[i]>w[best])best=i;vec3 colors[6];colors[0]=vec3(.43,.46,.52);colors[1]=vec3(.75,.48,.28);colors[2]=vec3(.96,.78,.40);colors[3]=vec3(.32,.25,.38);colors[4]=vec3(.36,.22,.12);colors[5]=vec3(.18,.62,.30);gl_FragColor=vec4(colors[best],1.);}
if(surfaceReview.x==3.){float value=surfaceReview.y<4.?tw[int(surfaceReview.y)]:surfaceReview.y==4.?tx.x:surfaceReview.y==5.?tx.y:surfaceReview.y<9.?vSurfaceA[int(surfaceReview.y)-6]:vSurfaceB[int(surfaceReview.y)-9];gl_FragColor=vec4(vec3(value),1.);}`)
  if(review)s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
if(surfaceReview.x==4.)gl_FragColor=vec4(pow(max(trialC,vec3(0.)),vec3(1./2.2)),1.);
if(surfaceReview.x==5.)gl_FragColor=vec4(normalize(trialN)*.5+.5,1.);
if(surfaceReview.x==6.)gl_FragColor=vec4(vec3(trialA.g),1.);
if(surfaceReview.x==7.)gl_FragColor=vec4(normal*.5+.5,1.);
if(surfaceReview.x==8.)gl_FragColor=vec4(pow(max(reflectedLight.indirectDiffuse,vec3(0.)),vec3(1./2.2)),1.);
if(surfaceReview.x==9.)gl_FragColor=vec4(pow(max(reflectedLight.directDiffuse,vec3(0.)),vec3(1./2.2)),1.);`)
  if(review)s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>\nif(surfaceReview.x==11.||surfaceReview.x==12.)gl_FragColor=vec4(pow(max(trialC,vec3(0.)),vec3(1./2.2)),1.);`)
  // The sun-facing canyon wall receives direct light; its opposite wall needs
  // an approximate diffuse bounce from the lit terrain. Scope this to the
  // logical rock region instead of raising exposure across the whole world.
  s.fragmentShader=s.fragmentShader.replace('#include <aomap_fragment>',`reflectedLight.indirectDiffuse*=mix(.65,1.0,trialA.r);
${origin?'float rockBounce=tw.x*(1.0-smoothstep(.025,.13,dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722))));reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.42,.47,.49)*rockBounce;':''}`)
 }
 material.customProgramCacheKey=()=> `${baseKey}-terrain-material-v7-flight-footprint-${Boolean(origin)}-${Boolean(review)}-${JSON.stringify(trial)}`
 material.needsUpdate=true
}
