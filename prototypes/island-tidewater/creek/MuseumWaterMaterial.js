// Native Tidewater optics with a bounded shallow-water reflection leg. The
// native deep-water scattering remains the fallback outside the screen/range.
import {WaterMaterial} from '../vendor/tidewater/src/ocean/WaterMaterial.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';

const shallowReflection=new ShaderModule({name:'museumShallowReflection',code:`
fn museumUnderTerrain(P:vec3f,R:vec3f,sigT:vec3f,fallback:vec3f)->vec4f{
 var previous=.04;
 for(var i=0;i<15;i++){
  let t=.2*pow(1.5,f32(i));let Q=P+R*t;
  if(Q.y<terrainHeightAt(Q.xz)){
   var lo=previous;var hi=t;
   for(var k=0;k<4;k++){let mid=(lo+hi)*.5;let M=P+R*mid;if(M.y<terrainHeightAt(M.xz)){hi=mid;}else{lo=mid;}}
   let H=P+R*hi;let N=terrainNormalAt(H.xz);
   let detail=textureSampleLevel(terrainDetailTex,smpLinearRepeat,H.xz/3.5,1.0);
   let broad=textureSampleLevel(terrainDetailTex,smpLinearRepeat,H.xz/27.0,1.0);
   let sand=mix(vec3f(.133,.113,.068),vec3f(.307,.263,.155),broad.z*.55+detail.y*.45);
   let gravel=mix(vec3f(.073,.078,.064),vec3f(.188,.179,.126),detail.z);
   let c=mix(sand,gravel,max(smoothstep(.1,.55,1.0-N.y),select(.6,0.0,P.y<1.0)));
   let sun=frame.sunColor*max(dot(N,frame.sunDir),0.0)*terrainSunShadowAt(H);
   let depth=max(P.y-H.y,0.0);let lit=c*(frame.skyIrradiance+sun)*exp(-sigT*depth*1.2)*.72;
   let T=exp(-sigT*hi);let weight=1.0-smoothstep(32.0,58.0,hi);
   return vec4f(lit*T+fallback*(1.0-T),weight);
  }
  previous=t;
 }
 return vec4f(fallback,0.0);
}
fn museumUnderReflection(P:vec3f,R:vec3f,sigT:vec3f,fallback:vec3f)->vec4f{
 // A terrain hit is independent of what happened to be inside the viewport.
 // Screen-space bed hits created rectangular seams when looking up. Keep the
 // native deep-water radiance only beyond this bounded heightfield reflection.
 return museumUnderTerrain(P,R,sigT,fallback);
}

`});

export class MuseumWaterMaterial extends WaterMaterial{
 constructor(options){super(options);this.depthReview=new UniformBlock('MuseumWaterReview',{pixelDepth:['f32',1],pathLegacy:['f32',0]});this.depthReviewModule=new ShaderModule({name:'museumWaterReview',uniforms:this.depthReview,uniformName:'museumWaterReview'});}
 _build(){super._build();this.modules.push(shallowReflection,this.depthReviewModule);if(this.inlandField)this.modules.push(this.inlandField.module);
  if(this.isMuseumOcean){const helper=this.modules.find(m=>m.name==='waterHelpers');if(!helper||!helper.code.includes('frame.seaLevel'))throw Error('Pinned sea SSR seam changed');const local=new ShaderModule({name:'museumSeaWaterHelpers',deps:helper.deps,bindings:helper.bindings,code:helper.code.replaceAll('frame.seaLevel','y0').replace('k < 3','k < 7')});this.modules=this.modules.map(m=>m===helper?local:m);}
 }
 _shadeWGSL(options){
  let code=super._shadeWGSL(options);
  const change=(a,b)=>{if(!code.includes(a))throw Error('Pinned museum water seam changed: '+a.slice(0,50));code=code.replace(a,b);};
  // The native sea hides its mesh under dry land at the vertex. Our lake and
  // river grids also cross banks: reject the buried sheet on BOTH faces. The
  // above-water thickness blend alone left its underside visible to divers.
  change('let footprint = max( length( fwidth( lagXZ ) ), 1e-4 );',`let footprint=max(length(fwidth(lagXZ)),1e-4);
 if(pos.y<terrainHeightAt(pos.xz)-.015){discard;}`);
  if(this.isMuseumOcean){
   // Every material use of history (including suspended sand) must share the
   // presentation handover. Filtering only foam leaves a rectangular tint.
   change('let simState = shoreSimSample( pos.xz );','let simState=shoreSimSample(pos.xz)*museumSurfDetailAt(pos.xz);');
   // Pixel depth, not a depth interpolated across huge adaptive sea triangles.
   change('let vDepth = in.vs.vSeaDepth;','let vDepth=mix(in.vs.vSeaDepth,mix(waterSurfaceSeaDepth(lagXZ),max(pos.y-terrainHeightAt(pos.xz),0.0),museumTransition),museumWaterReview.pixelDepth);');
   change('let vHeight = in.vs.vWaveH;','let vHeight=in.vs.vWaveH*(1.0-museumTransition);');
   change('let crestT = shoreCrestPath( lagXZ, vDepth, Tv );','let crestT=mix(shoreCrestPath(lagXZ,vDepth,Tv),1e4,museumTransition);');
   change('let pos = in.P;',`let pos=in.P;
 let museumTransition=museumEstuaryBlend(pos.xz);
 if(museumEstuaryOwns(pos.xz)){discard;}`);
  }
  change('var thickness = pos.y - groundH;',`var thickness=pos.y-groundH;
 let receiver=worldFromDepth(screenUV,_waterSceneDepthAt(screenUV));
 if(receiver.y<pos.y+.04){thickness=min(thickness,max(pos.y-receiver.y,0.0));}`);
  change('max( fwidth( thickness ) * 1.5, 0.004 )','max(fwidth(thickness)*1.5,0.025)');
  // Screen-depth quantisation must be filtered on both representations.
  // Otherwise the same column changes optical length at the raster handover.
  change('let qDist = length( qView - posV );',`let qDistRaw=length(qView-posV);
 let pixelPath=max(.025,footprint*2.0)/tDown;
 let objectWeight=smoothstep(pixelPath,pixelPath*2.0,Lter-qDistRaw);
 let qDist=mix(Lter,qDistRaw,mix(objectWeight,1.0,museumWaterReview.pathLegacy));`);
  if(this.isMuseumOcean){
   change('let sigA = frame.waterAbsorption + surfMed.absorb * sandK;','let sigA=frame.waterAbsorption+surfMed.absorb*sandK*(1.0-museumTransition);');
   change('let sigS = frame.waterScattering + surfMed.scatter * sandK + aer * 1.6;','let sigS=frame.waterScattering+(surfMed.scatter*sandK+aer*1.6)*(1.0-museumTransition);');
   change('let mss = ( 0.003 + frame.windSpeed * 0.00512 ) * waterSurface.slopeScale;','let mss=(.003+frame.windSpeed*.00512)*mix(waterSurface.slopeScale,.35,museumTransition);');
  }
  change('var dbgRefr = vec3f( 0.0 );','var dbgRefr=vec3f(0.0);var museumF=0.0;var museumReflect=vec4f(0.0);');
  change('let Tt = refract( - V, N,', 'museumF=F;\n let Tt = refract( - V, N,');
  change('outCol = mix( transmittedU * ( 1.0 - F ) + deepCol * F, foamUnder, sat( foam ) * 0.7 );',`museumReflect=museumUnderReflection(pos+Rr*.03,Rr,sigT,deepCol);
  let reflected=mix(deepCol,museumReflect.rgb,museumReflect.a);
  outCol=mix(transmittedU*(1.0-F)+reflected*F,foamUnder,sat(foam)*.7);`);
  change('r.color = vec4f( res, 1.0 );',`if(dbg==14){res=vec3f(seenFromBelow);}
 if(dbg==15){res=vec3f(museumF);}
 if(dbg==16){res=museumReflect.rgb;}
 if(dbg==17){res=vec3f(museumReflect.a);}
 r.color=vec4f(res,1.0);`);
  return code;
 }
}
