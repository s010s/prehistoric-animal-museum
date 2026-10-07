import {temporalResolveEnabled,temporalSampleIndex} from './temporal-resolve.js';
// Frame reprojection adapted from Tidewater (MIT), DRG Software Solutions LLC.
// Fixed source 4811ba48d795197de5621985f404e765c0b7c0ef.
import * as T from 'three';
import {treeWindFieldGLSL,treeWindSlopeAt} from './tree-wind.js';
export const treeTime={value:0};
// Shared across materials so explicit review comparisons change scheduling only.
export const deferredAtlasNormal={value:true};
export const forestAtlasBudgetEnabled={value:true};
export const forestAtlasBudgetConfig=Object.freeze({lowPixels:24,highPixels:48,angularBand:.04});
const clamp01=x=>Math.max(0,Math.min(1,x));
const smooth01=x=>{x=clamp01(x);return x*x*(3-2*x);};
export function forestAtlasWeights(azimuth,elevation,crownPixels){
 const detail=Number.isFinite(crownPixels)?smooth01((crownPixels-24)/24):1,band=.04+.96*detail;
 const axis=f=>{const compact=smooth01((f-(.5-band*.5))/band);return compact+(f-compact)*detail;};
 const a=Math.floor(azimuth),e=Math.min(2,Math.max(0,Math.floor(elevation))),x=axis(azimuth-a),y=e===2?0:axis(clamp01(elevation-e)),frames=[];
 for(const [row,wy]of [[e,1-y],[Math.min(2,e+1),y]])for(const [column,wx]of [[a,1-x],[a+1,x]])if(wx*wy>0)frames.push({column:((column%8)+8)%8,row,weight:wx*wy});return frames;
}
export function forestProjectedCrownPixels({root,scale,crownRatio,camera,viewportWidth,time}){
 const view=camera.matrixWorldInverse.elements,right=new T.Vector3(view[0],view[4],view[8]),center=root.clone().add(new T.Vector3(0,scale.y*.5,0)),slope=new T.Vector3(...treeWindSlopeAt(root.toArray(),time)),clips=[];
 for(const sign of [-1,1]){const p=center.clone().addScaledVector(right,sign*.5*scale.x*crownRatio);p.addScaledVector(slope,p.y-root.y);const clip=new T.Vector4(p.x,p.y,p.z,1).applyMatrix4(camera.matrixWorldInverse);if(-clip.z<=camera.near*1.05)return Infinity;clip.applyMatrix4(camera.projectionMatrix);if(!clip.toArray().every(Number.isFinite)||clip.w<=0)return Infinity;clips.push(clip.x/clip.w);}
 const width=Math.abs(clips[1]-clips[0])*viewportWidth*.5;return Number.isFinite(width)&&width>=0?width:Infinity;
}
// Isolated reference for the explicit texture gradients used by both channels.
export function forestFrameGradients(O,D,dx,dy,azimuth,elevation){
 const n=new T.Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)),right=new T.Vector3(Math.cos(azimuth),0,-Math.sin(azimuth)),up=new T.Vector3().crossVectors(n,right),o=new T.Vector3(...O),d=new T.Vector3(...D),den=d.dot(n),k=o.dot(n)/den,p=o.clone().addScaledVector(d,-k);
 const uv=v=>[v.dot(right)/1.4,v.dot(up)/1.4],gradient=values=>{const v=new T.Vector3(...values);return uv(v.clone().addScaledVector(d,-v.dot(n)/den).multiplyScalar(-k));};return{uv:uv(p).map(v=>v+.5),dx:gradient(dx),dy:gradient(dy)};
}
// Explicit measurement only. Homogeneous clipping precedes perspective divide;
// optional fifth component preserves interpolated view depth at the near plane.
function clipPolygon(polygon,distance){
 const out=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}}return out;
}
export function projectForestPolygon(points,viewport,scissor=null){
 if(points.length<3||!points.every(p=>p.length>=4&&p.every(Number.isFinite))||!viewport.every(Number.isFinite)||viewport[2]<=0||viewport[3]<=0)return null;
 let p=points;for(const plane of [v=>v[0]+v[3],v=>v[3]-v[0],v=>v[1]+v[3],v=>v[3]-v[1],v=>v[2]+v[3],v=>v[3]-v[2]]){p=clipPolygon(p,plane);if(p.length<3)return null;}
 // Clip scissor in homogeneous space too; screen-linear interpolation of view
 // depth would be wrong for a perspective quad crossing the near plane.
 if(scissor){if(!scissor.every(Number.isFinite)||scissor[2]<=0||scissor[3]<=0)return null;const left=(scissor[0]-viewport[0])*2/viewport[2]-1,right=(scissor[0]+scissor[2]-viewport[0])*2/viewport[2]-1,bottom=(scissor[1]-viewport[1])*2/viewport[3]-1,top=(scissor[1]+scissor[3]-viewport[1])*2/viewport[3]-1;for(const plane of [v=>v[0]-left*v[3],v=>right*v[3]-v[0],v=>v[1]-bottom*v[3],v=>top*v[3]-v[1]]){p=clipPolygon(p,plane);if(p.length<3)return null;}}
 if(p.some(v=>v[3]<=1e-9))return null;
 p=p.map(v=>[viewport[0]+(v[0]/v[3]+1)*viewport[2]/2,viewport[1]+(v[1]/v[3]+1)*viewport[3]/2,v[4]??null]);
 let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[1]-b[0]*a[1];}area=Math.abs(area)/2;if(!Number.isFinite(area)||area<1e-9)return null;
 const xs=p.map(v=>v[0]),ys=p.map(v=>v[1]),width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys),depth=p.map(v=>v[2]).filter(Number.isFinite);
 return{areaPx2:area,diameterPx:Math.max(width,height),widthPx:width,heightPx:height,minDepth:depth.length?Math.min(...depth):null};
}
function distribution(values){
 const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted.length?sorted[Math.floor((sorted.length-1)*q)]:null,edges=[2,4,8,16,32,64],buckets=Array(7).fill(0);for(const n of sorted){const i=edges.findIndex(e=>n<e);buckets[i<0?6:i]++;}
 return{count:sorted.length,min:at(0),p25:at(.25),p50:at(.5),p75:at(.75),p95:at(.95),p99:at(.99),max:at(1),bucketUpperBounds:[...edges,null],buckets};
}
export function createForestContributionAudit(){
 let active=false,options=null,passes=new Map();
 function begin(input={}){const defaults={sampleStride:16,maxSamples:40000,maxRecords:2048};for(const key of Object.keys(defaults)){if(input[key]!==undefined&&(!Number.isFinite(input[key])||input[key]<1))throw Error('Invalid forest contribution audit '+key);}options=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,Math.min(key==='sampleStride'?1024:key==='maxRecords'?10000:100000,Math.floor(input[key]??value))]));passes=new Map();active=true;}
 function capture(renderer,camera,mesh,info){
  const target=renderer.getRenderTarget(),viewport=renderer.getCurrentViewport(new T.Vector4()).toArray(),projection=camera.projectionMatrix.toArray(),targetId=target?.texture?.uuid??'canvas';
  const scissor=target?.scissorTest?target.scissor.toArray():!target&&renderer.getScissorTest()?renderer.getScissor(new T.Vector4()).multiplyScalar(renderer.getPixelRatio()).toArray():null;
  const key=JSON.stringify([camera.uuid,targetId,viewport,scissor,projection]),drawSize=target?new T.Vector2(target.width,target.height):renderer.getDrawingBufferSize(new T.Vector2());
  let pass=passes.get(key);if(!pass){pass={index:passes.size,cameraId:camera.uuid,target:{id:targetId,width:drawSize.x,height:drawSize.y},viewport,scissor,projection,view:camera.matrixWorldInverse.toArray(),near:camera.near,far:camera.far,worldTime:treeTime.value,nearFraction:info.nearFraction.value,forestRange:info.forestRange.value,atlasBudget:{enabled:forestAtlasBudgetEnabled.value,...forestAtlasBudgetConfig},submittedDraws:0,submittedInstances:0,sampledInstances:0,visibleSamples:0,hiddenNearSamples:0,hiddenRangeSamples:0,clippedOutSamples:0,sampleLimitReached:false,recordLimitReached:false,atlasFrames:{one:0,four:0},selectedAtlasFrames:{one:0,two:0,four:0},nominalAtlasFetchUpperEstimate:0,candidateNominalAtlasFetchUpperEstimate:0,records:[],diameters:[],policyDiameters:[],areas:[]};passes.set(key,pass);}
  pass.submittedDraws++;pass.submittedInstances+=mesh.count;
  const view=camera.matrixWorldInverse.elements,right=new T.Vector3(view[0],view[4],view[8]),up=new T.Vector3(view[1],view[5],view[9]),cameraPosition=new T.Vector3().setFromMatrixPosition(camera.matrixWorld),array=mesh.instanceMatrix.array,seed=mesh.geometry.getAttribute('nearSeed');
  for(let i=0;i<mesh.count;i+=options.sampleStride){if(pass.sampledInstances>=options.maxSamples){pass.sampleLimitReached=true;break;}pass.sampledInstances++;
   const j=i*16,root=new T.Vector3(array[j+12],array[j+13],array[j+14]).applyMatrix4(mesh.matrixWorld),scale=[Math.hypot(array[j],array[j+1],array[j+2]),Math.hypot(array[j+4],array[j+5],array[j+6]),Math.hypot(array[j+8],array[j+9],array[j+10])],rootDistance=root.distanceTo(info.viewerPosition.value),passDistance=root.distanceTo(cameraPosition),identity=seed?.getX(i)??1;
   if(identity<info.nearFraction.value&&rootDistance<=80){pass.hiddenNearSamples++;continue;}if(passDistance>=info.forestRange.value){pass.hiddenRangeSamples++;continue;}
   const slope=new T.Vector3(...treeWindSlopeAt(root.toArray(),treeTime.value)),center=root.clone().add(new T.Vector3(0,scale[1]*.5,0));
   const project=(halfWidth,halfHeight)=>projectForestPolygon([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{const world=center.clone().addScaledVector(right,x*halfWidth).addScaledVector(up,y*halfHeight);world.addScaledVector(slope,world.y-root.y);const v=new T.Vector4(world.x,world.y,world.z,1).applyMatrix4(camera.matrixWorldInverse),depth=-v.z;v.applyMatrix4(camera.projectionMatrix);return[...v.toArray(),depth];}),viewport,scissor);
   const quad=project(.7*scale[0],.7*scale[1]);if(!quad){pass.clippedOutSamples++;continue;}
   // Full template bounds, including trunk: conservative canopy-envelope proxy.
   // Its physical width is normalized by the same template height as the atlas.
   const record=info.records[i],template=info.templates[record?.species]??info.templates[0],crown=project(.5*scale[0]*template.width/template.height,.5*scale[1]),atlasFrames=rootDistance>280?1:4,fetches=atlasFrames*2;
   const policyCrownDiameterPx=forestProjectedCrownPixels({root,scale:new T.Vector3(...scale),crownRatio:template.width/template.height,camera,viewportWidth:viewport[2],time:treeTime.value}),toEye=cameraPosition.clone().sub(center.clone().addScaledVector(slope,center.y-root.y));toEye.addScaledVector(slope,-toEye.y);
   const azimuth=((Math.atan2(toEye.x,toEye.z)-(record?.yaw??0))/.7853981634+24)%8,elevation=Math.min(2,Math.max(0,Math.atan2(Math.max(0,toEye.y),Math.hypot(toEye.x,toEye.z))/.55)),selectedFrames=forestAtlasWeights(azimuth,elevation,policyCrownDiameterPx),selectedAtlasFrames=selectedFrames.length,candidateNominalAtlasFetchUpperEstimate=quad.areaPx2*selectedAtlasFrames*2;
   const crownDiameterPx=crown?.widthPx??0; // Width, never the template's taller trunk envelope.
   pass.visibleSamples++;pass.atlasFrames[atlasFrames===1?'one':'four']++;pass.selectedAtlasFrames[selectedAtlasFrames===1?'one':selectedAtlasFrames===2?'two':'four']++;pass.nominalAtlasFetchUpperEstimate+=quad.areaPx2*fetches;pass.candidateNominalAtlasFetchUpperEstimate+=candidateNominalAtlasFetchUpperEstimate;pass.diameters.push(crownDiameterPx);if(Number.isFinite(policyCrownDiameterPx))pass.policyDiameters.push(policyCrownDiameterPx);pass.areas.push(quad.areaPx2);
   if(pass.records.length<options.maxRecords)pass.records.push({id:record?.id??`${mesh.uuid}:${i}`,species:record?.species??null,root:root.toArray(),rootDistance,passDistance,centerDepth:-center.clone().addScaledVector(slope,center.y-root.y).applyMatrix4(camera.matrixWorldInverse).z,effectiveClippedMinDepth:quad.minDepth,crownDiameterPx,policyCrownDiameterPx:Number.isFinite(policyCrownDiameterPx)?policyCrownDiameterPx:null,nearPlaneFullDetail:!Number.isFinite(policyCrownDiameterPx),azimuth,elevation,quadAreaPx2:quad.areaPx2,atlasFrames,maxAtlasFetchesPerPixel:fetches,nominalAtlasFetchUpperEstimate:quad.areaPx2*fetches,selectedAtlasFrames,candidateMaxAtlasFetchesPerPixel:selectedAtlasFrames*2,candidateNominalAtlasFetchUpperEstimate});else pass.recordLimitReached=true;
  }
 }
 function observe(mesh,info){const before=mesh.onBeforeRender;mesh.onBeforeRender=function(renderer,scene,camera,...rest){before.call(this,renderer,scene,camera,...rest);if(active)capture(renderer,camera,this,info);};}
 function end(){active=false;const output=[...passes.values()].map(p=>{const {diameters,policyDiameters,areas,...report}=p;return{...report,crownDiameterPx:distribution(diameters),policyCrownDiameterPx:distribution(policyDiameters),quadAreaPx2:distribution(areas),estimatedVisibleSubmittedInstances:p.sampleLimitReached?null:Math.min(p.submittedInstances,p.visibleSamples*options.sampleStride)};}),paired=new Map();for(const pass of output)for(const record of pass.records){if(!paired.has(record.id))paired.set(record.id,[]);paired.get(record.id).push({pass:pass.index,...record});}
  return{schema:'forest-contribution-audit-v1',options:options?{...options}:null,assumptions:['Deterministic stride samples of submitted chunks; not a census of visible leaves.','Crown diameter is the screen-horizontal width of a projected full-template envelope; alpha coverage and scene occlusion are unknown.','Nominal fetch upper estimate is gross clipped quad area times two atlas channels times one/four legacy frames for retained samples; not actual fragments, reads or GPU milliseconds.','Candidate estimates always evaluate projected policy, including its one/two/four sparse frame count; atlasBudget.enabled records which policy actually rendered.','Policy diameter is unclipped physical crown width at the wind-deformed center; null with nearPlaneFullDetail means conservative full detail.','Near hidden/range samples omit their gross quads here, though the current fragment shader samples color before those discards.','Pairs contain only retained visible records; missing pair is not proof of invisibility.'],passes:output,pairs:[...paired].filter(([,rows])=>new Set(rows.map(r=>r.pass)).size>1).map(([id,rows])=>({id,passes:rows}))};
 }
 return{begin,end,observe,get active(){return active;}};
}
// Re-lightable impostor. Its position is shared by projection, fog and shadows.
export function configureForestImpostor(mesh,atlas,viewerPosition,forestRange,nearFraction,templates=null){
 mesh.material.defines={...mesh.material.defines,ISLAND_FOREST_SURFACE:1};
 const forestViewportWidth={value:1},forestCameraNear={value:.3},treeCrownRatios={value:new T.Vector4(...[0,1,2,3].map(i=>templates?.[i]?templates[i].width/templates[i].height:.7))},viewport=new T.Vector4(),before=mesh.onBeforeRender??function(){};
 mesh.onBeforeRender=function(renderer,scene,camera,...rest){before.call(this,renderer,scene,camera,...rest);forestViewportWidth.value=renderer.getCurrentViewport(viewport).z;forestCameraNear.value=camera.near;};
 mesh.material.onBeforeCompile=s=>{
  Object.assign(s.uniforms,{temporalResolveEnabled,temporalSampleIndex,treeNormals:{value:atlas.normalMap},treeTime,viewerPosition,forestRange,nearFraction,deferredAtlasNormal,forestAtlasBudgetEnabled,forestViewportWidth,forestCameraNear,treeCrownRatios});
  s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
  uniform float treeTime,forestViewportWidth,forestCameraNear;uniform vec4 treeCrownRatios;uniform vec3 viewerPosition;attribute float nearSeed,treeYaw,treeSpecies;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw,crownPixels;varying vec3 treeScale,treeRoot,impostorWorld,treeSway,impostorCenter;
  ${treeWindFieldGLSL}`)
  .replace('#include <project_vertex>',`vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  treeRoot=root;treeScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
  vec3 center=root+vec3(0.,treeScale.y*.5,0.);treeSway=treeWindSlope(root);
  impostorCenter=center+treeSway*(center.y-root.y);
  vec3 toEye=cameraPosition-impostorCenter;toEye-=treeSway*toEye.y;
  treeDistance=length(cameraPosition-root);rootDistance=length(viewerPosition-root);nearIdentity=nearSeed;treeType=treeSpecies;yaw=treeYaw;
  azimuth=mod((atan(toEye.x,toEye.z)-treeYaw)/.7853981634+24.,8.);elevation=clamp(atan(max(0.,toEye.y),length(toEye.xz))/.55,0.,2.);
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  vec3 halfCrown=right*(treeScale.x*treeCrownRatios[int(treeSpecies)]*.5),crownLeft=center-halfCrown,crownRight=center+halfCrown;
  crownLeft+=treeSway*(crownLeft.y-root.y);crownRight+=treeSway*(crownRight.y-root.y);
  vec4 leftView=viewMatrix*vec4(crownLeft,1.),rightView=viewMatrix*vec4(crownRight,1.);
  vec4 leftClip=projectionMatrix*leftView,rightClip=projectionMatrix*rightView;
  crownPixels=(-leftView.z<=forestCameraNear*1.05||-rightView.z<=forestCameraNear*1.05||leftClip.w<=0.||rightClip.w<=0.)?1.e6:abs(rightClip.x/rightClip.w-leftClip.x/leftClip.w)*forestViewportWidth*.5;
  airWorld=center+right*position.x*treeScale.x+up*(position.y-.5)*treeScale.y;
  airWorld+=treeSway*(airWorld.y-root.y);
  impostorWorld=airWorld;vec4 mvPosition=viewMatrix*vec4(airWorld,1.);gl_Position=projectionMatrix*mvPosition;`)
  .replace('#include <worldpos_vertex>','vec4 worldPosition=vec4(airWorld,1.);');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
  uniform sampler2D treeNormals;uniform bool temporalResolveEnabled;uniform float temporalSampleIndex;uniform bool deferredAtlasNormal,forestAtlasBudgetEnabled;uniform float forestRange,nearFraction;varying float nearIdentity,rootDistance,treeDistance,azimuth,elevation,treeType,yaw,crownPixels;varying vec3 treeScale,treeRoot,impostorWorld,treeSway,impostorCenter;
  vec3 forestO,forestD,forestDx,forestDy,forestSurfaceLocal,forestSurfaceWorld,forestSurfaceNormal;
  vec4 forestFrameCoverages=vec4(0.);int forestFrameSlot=0;
  bool forestReadSurface=false;float forestFrameWeight=0.,forestSurfaceCoverage=0.;

  vec3 forestSurfaceToWorld(vec3 p){p*=treeScale;float c=cos(yaw),s=sin(yaw);p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);p+=treeSway*p.y;return impostorCenter+p;}
  vec3 forestRayLocal(vec3 v){v-=treeSway*v.y;float c=cos(yaw),s=sin(yaw);return vec3(c*v.x-s*v.z,v.y,s*v.x+c*v.z)/treeScale;}
  void prepareForestAtlas(){vec3 O=cameraPosition-impostorCenter,D=impostorWorld-cameraPosition;
   O-=treeSway*O.y;D-=treeSway*D.y;
   float c=cos(yaw),s=sin(yaw);forestO=vec3(c*O.x-s*O.z,O.y,s*O.x+c*O.z)/treeScale;forestD=vec3(c*D.x-s*D.z,D.y,s*D.x+c*D.z)/treeScale;
   forestDx=forestRayLocal(dFdx(impostorWorld));forestDy=forestRayLocal(dFdy(impostorWorld));}
  vec4 frameSample(sampler2D tx,float az,float el){
   int slot=forestFrameSlot;forestFrameSlot++;
   float a=az*.7853981634,e=el*.55;vec3 n=vec3(sin(a)*cos(e),sin(e),cos(a)*cos(e)),right=vec3(cos(a),0.,-sin(a)),up=cross(n,right);
   float den=dot(forestD,n);if(abs(den)<1.e-6)return vec4(0.);float k=dot(forestO,n)/den;vec3 P=forestO-forestD*k;
   vec2 p=vec2(dot(P,right),dot(P,up))/1.4+.5;if(any(lessThan(p,vec2(0.)))||any(greaterThan(p,vec2(1.))))return vec4(0.);
   vec3 dx=-k*(forestDx-forestD*dot(forestDx,n)/den),dy=-k*(forestDy-forestD*dot(forestDy,n)/den);
   vec2 padding=vec2(.5/${atlas.cell.toFixed(1)}),gradientMask=step(padding,p)*step(p,1.-padding),size=vec2(8.,${atlas.rows.toFixed(1)});
   vec2 gx=vec2(dot(dx,right),dot(dx,up))/1.4*gradientMask/size,gy=vec2(dot(dy,right),dot(dy,up))/1.4*gradientMask/size;
   vec4 sampleValue=textureGrad(tx,(clamp(p,padding,1.-padding)+vec2(mod(az,8.),treeType*3.+el))/size,gx,gy);
   if(!forestReadSurface)forestFrameCoverages[slot]=sampleValue.a;
   else{float coverage=forestFrameCoverages[slot];if(coverage>.001){float surfaceDepth=(sampleValue.a/coverage-.5)*1.4;
    vec3 surfacePoint=forestO-forestD*((dot(forestO,n)-surfaceDepth)/den);
    forestSurfaceLocal+=surfacePoint*(forestFrameWeight*coverage);forestSurfaceCoverage+=forestFrameWeight*coverage;
   }sampleValue.a=coverage;}return sampleValue;
  }
  float forestAxisWeight(float f,float detail){float band=mix(.04,1.,detail);return mix(smoothstep(.5-band*.5,.5+band*.5,f),f,detail);}
  vec4 atlasBlend(sampler2D tx,vec2 p){forestFrameSlot=0;if(!forestReadSurface)forestFrameCoverages=vec4(0.);float a=floor(azimuth),e=floor(elevation),x=fract(azimuth),y=fract(elevation);
   if(!forestAtlasBudgetEnabled){if(rootDistance>280.){forestFrameWeight=1.;return frameSample(tx,floor(azimuth+.5),floor(elevation+.5));}}
   if(forestAtlasBudgetEnabled){float detail=smoothstep(24.,48.,crownPixels);x=forestAxisWeight(x,detail);y=e>=2.?0.:forestAxisWeight(y,detail);}
   vec4 canopy=vec4(0.);if(x<1.&&y<1.){forestFrameWeight=(1.-x)*(1.-y);canopy+=frameSample(tx,a,e)*forestFrameWeight;}if(x>0.&&y<1.){forestFrameWeight=x*(1.-y);canopy+=frameSample(tx,a+1.,e)*forestFrameWeight;}if(x<1.&&y>0.){forestFrameWeight=(1.-x)*y;canopy+=frameSample(tx,a,min(2.,e+1.))*forestFrameWeight;}if(x>0.&&y>0.){forestFrameWeight=x*y;canopy+=frameSample(tx,a+1.,min(2.,e+1.))*forestFrameWeight;}return canopy;
  }
  vec3 readForestNormal(vec2 vMapUv){forestReadSurface=true;forestSurfaceLocal=vec3(0.);forestSurfaceCoverage=0.;vec4 packed=atlasBlend(treeNormals,vMapUv);forestReadSurface=false;
   forestSurfaceWorld=forestSurfaceCoverage>.001?forestSurfaceToWorld(forestSurfaceLocal/forestSurfaceCoverage):impostorWorld;
   return packed.rgb/max(packed.a,.001)*2.-1.;}
  `)  .replace('#include <map_fragment>',`prepareForestAtlas();vec4 canopy=atlasBlend(map,vMapUv);vec3 canopyNormal=vec3(0.);
  if(!deferredAtlasNormal)canopyNormal=readForestNormal(vMapUv);
  diffuseColor.rgb*=canopy.rgb/max(canopy.a,.001);diffuseColor.a*=canopy.a;

  float distant=1.-smoothstep(forestRange-1400.,forestRange,treeDistance);
  float nearCoverage=nearIdentity<nearFraction?1.-smoothstep(80.,112.,rootDistance):0.;float treeCoverage=distant*(1.-nearCoverage);if(treeCoverage<.001)discard;`)
  .replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nfloat transitionNoise=fract(52.9829189*fract(dot(gl_FragCoord.xy+(temporalResolveEnabled?vec2(47.,17.)*temporalSampleIndex:vec2(0.)),vec2(.06711056,.00583715))));if(transitionNoise<nearCoverage||transitionNoise>distant)discard;')
  .replace('#include <normal_fragment_maps>',`if(deferredAtlasNormal)canopyNormal=readForestNormal(vMapUv);
  vec3 localNormal=normalize(canopyNormal/max(treeScale,vec3(.001)));float cy=cos(yaw),sy=sin(yaw);vec3 worldNormal=vec3(cy*localNormal.x+sy*localNormal.z,localNormal.y,-sy*localNormal.x+cy*localNormal.z);if(canopyCandidateEnabled&&dot(worldNormal,cameraPosition-forestSurfaceWorld)<0.)worldNormal=-worldNormal;forestSurfaceNormal=worldNormal;normal=normalize(mat3(viewMatrix)*worldNormal+(canopyCandidateEnabled?normalize(vViewPosition)*.12:vec3(0.)));
  // Keep the raster depth for early-Z. Surface depth corrects solar/terrain lighting; SSAO and camera history still use the card depth.`);
 s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nif(!canopyCandidateEnabled){reflectedLight.directSpecular*=.025;reflectedLight.indirectSpecular*=.025;}');
 };mesh.material.customProgramCacheKey=()=> 'reprojected-canopy-r12-projected-budget-r13-p8-surface-depth';
}
