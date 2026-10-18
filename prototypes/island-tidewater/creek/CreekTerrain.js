// Museum soil/stone palette on native Tidewater CDLOD, shared heights and AO.
import { Terrain } from '../vendor/tidewater/src/world/Terrain.js';
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {CDLOD} from '../vendor/tidewater/src/core/CDLOD.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/gpu/Uniforms.js';
import { terrainShadingModule, srgb } from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
export class CreekTerrain extends Terrain {
  constructor({scene,data,terrainGPU}) {
    super({scene,terrainData:data.terrain,terrainGPU,gridSize:64,rangeFactor:3});
    const old=this.lod;
    this.lod=new CDLOD({gridSize:64,leafSize:8,levels:Math.ceil(Math.log2(data.terrain.size/8))+1,rangeFactor:3,maxInstances:3000,prefix:'terrainLod',heightBounds:(...p)=>data.terrain.boundsFor(...p),center:{x:data.terrain.origin,z:data.terrain.origin,size:data.terrain.size}});
    this.mesh.geometry=this.lod.geometry;old.geometry.dispose?.();
    const mat=this.material;
    mat.modules=[terrainGPU.module,terrainShadingModule(),this.lod.module,terrainGPU.sunModulationModule,data.field.module,data.appearance.module];
    mat.appliesHillShadow=true;mat.defines.MATERIAL_SUN_MODULATION=1;
    this.review=new UniformBlock('MuseumGroundReview',{snow:['f32',1],bump:['f32',1],filtered:['f32',1],seabedLegacy:['f32',0],bedDebug:['f32',0],inlandBedLegacy:['f32',0]});
    mat.modules.push(new ShaderModule({name:'museumGroundReview',uniforms:this.review}));
    mat.surface=`
 let P=in.P;let nr=terrainNormalRock(P.xz);let filteredN=normalize(vec3f(nr.x,sqrt(max(1.0-dot(nr.xy,nr.xy),.0025)),nr.y));let N=normalize(mix(terrainNormalAt(P.xz),filteredN,museumGroundReview.filtered));
 let footprint=max(length(fwidth(P)),.001);let cover=museumCover(P.xz,footprint);
 let d=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/3.5);let m=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/27.0);
 let micro=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/0.28);
 let macroTone=m.w*0.65+d.y*0.35;
 let litter=mix(${srgb(.25,.23,.16)},${srgb(.36,.32,.22)},macroTone);
 let soil=mix(${srgb(.32,.30,.24)},${srgb(.48,.45,.37)},d.z);
 let meadow=museumSward(P,N,footprint,mat.gustOffset);
 var ground=mix(meadow.albedo,litter,cover.a*0.70);
 ground=mix(ground,soil,cover.r);
 let grove=museumGroveFloor(P.xz);
 let humus=mix(${srgb(.17,.145,.10)},${srgb(.28,.245,.165)},d.y*.6+m.z*.4);
 let moss=mix(${srgb(.17,.22,.12)},${srgb(.27,.30,.16)},d.w);
 var needleBed=mix(humus,moss,smoothstep(.52,.77,grove.z)*(1.0-grove.y)*.53);
 needleBed=mix(needleBed,${srgb(.29,.25,.18)}*(.85+d.y*.3),grove.y*.5);
 ground=mix(ground,needleBed,grove.x*.94);
 let wf=creekFieldAt(P.xz);let bank=(1.0-smoothstep(2.0,10.0,abs(wf.y)))*(1.0-smoothstep(0.6,2.2,P.y-wf.x));
 let gravel=mix(${srgb(.34,.34,.29)},${srgb(.43,.42,.35)},d.z*.65+m.w*.35);
 ground=mix(ground,gravel,bank*(1.0-cover.r*0.3));
 let channelStone=bank*smoothstep(.08,.4,1.0-N.y);
 let slopeRock=smoothstep(.18,.62,1.0-N.y);let rockW=max(max(smoothstep(.12,.72,nr.z),slopeRock*.86),channelStone*.92);
 // Wide cliffs use larger fractures in the same native material. Evaluate
 // rock only on exposed faces. Analytic warp gradients keep the mip footprint
 // exact without adding several Perlin evaluations over every grass pixel.
 let worldGrad=terrainImplicitGrad(P);var rockColour=vec3f(0.0);var rockRough=.94;var rockRelief=0.0;
 if(rockW>.001){
  let a=vec3f(.017,.023,.011);let b=vec3f(-.013,.019,.021);
  let phase=vec2f(dot(P,a),dot(P,b));let warp=sin(phase);let warpCos=cos(phase);
  let rockP=P*.72+vec3f(warp.x,warp.y,warp.x*.7+warp.y*.3)*1.8;
  let dx=warpCos*vec2f(dot(worldGrad.dpdx,a),dot(worldGrad.dpdx,b));
  let dy=warpCos*vec2f(dot(worldGrad.dpdy,a),dot(worldGrad.dpdy,b));
  var grad:RockGrad;grad.dpdx=worldGrad.dpdx*.72+vec3f(dx.x,dx.y,dx.x*.7+dx.y*.3)*1.8;
  grad.dpdy=worldGrad.dpdy*.72+vec3f(dy.x,dy.y,dy.x*.7+dy.y*.3)*1.8;
  grad.fwY=abs(grad.dpdx.y)+abs(grad.dpdy.y);grad.useGrad=true;
  let uv=vec2f(P.x*.8+P.z*.6,P.y)/293.0;
  let gx=vec2f(worldGrad.dpdx.x*.8+worldGrad.dpdx.z*.6,worldGrad.dpdx.y)/293.0;
  let gy=vec2f(worldGrad.dpdy.x*.8+worldGrad.dpdy.z*.6,worldGrad.dpdy.y)/293.0;
  let rockMacro=terrainDetailGrad(uv,gx,gy).w;
  let rock=terrainRockSurface(rockP,N,P.y,rockMacro,0.37,0.22,grad);
  let weathered=mix(${srgb(.27,.26,.23)},${srgb(.44,.42,.37)},rockMacro);
  rockColour=mix(rock.albedo,weathered,.25);rockRough=rock.rough;rockRelief=rock.hd*.8+rock.height*.14;
 }
 ground=mix(ground,rockColour,rockW);
 let sourceWet=museumSourceWet(P);
 ground=mix(ground,rockColour,sourceWet*rockW*.8);
 var wet=(1.0-smoothstep(.08,.7,P.y-wf.x))*(1.0-smoothstep(0.0,2.5,wf.y));
 let marsh=1.0-smoothstep(.78,1.26,length((P.xz-vec2f(5600.0,6050.0))/vec2f(2250.0,1500.0)));
 let mud=mix(${srgb(.24,.25,.18)},${srgb(.34,.32,.23)},m.w*.5+d.y*.5);
 ground=mix(ground,mud,marsh*(1.0-rockW)*.86);
 let beach=(1.0-marsh)*(1.0-smoothstep(2.0,9.0,P.y-frame.seaLevel))*(1.0-rockW)*(1.0-cover.r);
 let coastSand=mix(${srgb(.48,.46,.39)},${srgb(.66,.61,.49)},m.z*0.55+micro.z*0.45);
 ground=mix(ground,coastSand,beach);
 // Substrates continue below the waterline. Depth and slope select sediment,
 // gravel or stone, rather than extending the green meadow over the seabed.
 let seaDepth=frame.seaLevel-P.y;
 let riverDepth=wf.x-P.y;
 let riverBed=(1.0-smoothstep(-1.0,1.0,wf.y))*smoothstep(.04,.65,riverDepth);
 let seaBed=smoothstep(.04,.75,seaDepth);
 let underBed=max(riverBed,seaBed);
 // Mix two rotated, slowly warped native detail scales. Fine grit affects
 // roughness/near relief; it must not stamp a bright dot into every 28cm tile.
 var bedRelief=0.0;
 if(underBed>.001){
  let phase=vec2f(P.z*.113+P.x*.037,P.x*.093-P.z*.041);
  let bw=sin(phase)*1.7;let warpCos=cos(phase);
  let q=P.xz+bw;let uvA=vec2f(q.x*.819-q.y*.574,q.x*.574+q.y*.819)/8.7;
  let uvB=vec2f(q.x*.39+q.y*.921,-q.x*.921+q.y*.39)/13.1;
  let wx=worldGrad.dpdx.xz;let wy=worldGrad.dpdy.xz;
  let dx=wx+warpCos*vec2f(dot(wx,vec2f(.037,.113)),dot(wx,vec2f(.093,-.041)))*1.7;
  let dy=wy+warpCos*vec2f(dot(wy,vec2f(.037,.113)),dot(wy,vec2f(.093,-.041)))*1.7;
  let A=terrainDetailGrad(uvA,vec2f(dx.x*.819-dx.y*.574,dx.x*.574+dx.y*.819)/8.7,vec2f(dy.x*.819-dy.y*.574,dy.x*.574+dy.y*.819)/8.7);
  let B=terrainDetailGrad(uvB,vec2f(dx.x*.39+dx.y*.921,-dx.x*.921+dx.y*.39)/13.1,vec2f(dy.x*.39+dy.y*.921,-dy.x*.921+dy.y*.39)/13.1);
  let sediment=mix(${srgb(.40,.38,.31)},${srgb(.57,.54,.45)},A.w*.6+B.y*.4);
  let pebble=mix(${srgb(.32,.33,.30)},${srgb(.46,.45,.39)},A.z*.5+B.z*.5);
  let patches=smoothstep(.38,.72,A.y*.6+B.w*.4);
  let legacyBed=mix(sediment,pebble,riverBed*(.28+patches*.42));
  // An 8.7m repeating tile becomes rows of pixels from above. Let fine grit
  // resolve near the visitor; wide warped, aperiodic deposits carry the bed
  // farther away, just as the native grass/ground representation hands over.
  let sedimentWarp=vec2f(perlin2(P.xz/131.0),perlin2(P.xz/173.0+23.7));
  let deposit=clamp(.5+perlin2(P.xz/53.0+sedimentWarp*.8)*.6,0.0,1.0);
  let stone=clamp(.5+perlin2(P.xz/31.0+sedimentWarp*.37+vec2f(71.3,18.6))*.6,0.0,1.0);
  let fine=1.0-smoothstep(.09,.5,footprint);
  let silt=mix(${srgb(.43,.41,.35)},${srgb(.54,.51,.44)},deposit);
  let gravel=mix(${srgb(.34,.35,.32)},${srgb(.46,.45,.40)},stone);
  let deposits=mix(silt,gravel,smoothstep(.35,.73,stone)*riverBed*.55);
  var bedColour=mix(deposits,legacyBed,fine*.65);
  bedColour=mix(mix(bedColour,legacyBed,museumGroundReview.inlandBedLegacy),mud,marsh*.75);
  ground=mix(ground,bedColour,underBed);
  bedRelief=(A.y*.009+B.z*.004)*(1.0-smoothstep(.08,.42,footprint))*underBed;
 }
 let stoneShare=max(smoothstep(.1,.55,1.0-N.y),smoothstep(.52,.8,m.w)*.45);
 let coveW=museumShelfWeight(P,footprint);if(coveW>.001){let covePatch=museumCovePatch(P.xz,footprint,museumGroundReview.seabedLegacy);
 let coveSand=mix(${srgb(.82,.77,.65)},${srgb(.73,.72,.62)},covePatch.z*.75+(m.w-.5)*.12);
 let coveRubble=mix(${srgb(.34,.34,.29)},${srgb(.49,.47,.39)},covePatch.z);
 let coveGrass=mix(${srgb(.23,.27,.17)},${srgb(.33,.34,.23)},covePatch.z);
 let grassBed=covePatch.x*smoothstep(.8,2.0,seaDepth)*(1.0-smoothstep(7.0,12.0,seaDepth));
 let coveBed=mix(mix(coveSand,coveRubble,covePatch.y*.65),coveGrass,grassBed*.85);
 ground=mix(ground,coveBed,coveW*underBed);
 ground=mix(ground,coveSand,coveW*beach*(1.0-underBed)*.65);
 }
 let hn=(P.xz-vec2f(3600.0,-5280.0))/vec2f(2100.0,2000.0);let highland=exp(-dot(hn,hn));
 // Residual snow follows broad sheltered landforms. The former 27m repeat
 // fed a height threshold and stamped identical white islands over plateaux.
 var snow=0.0;
 if(highland>.01&&P.y>475.0){
  let snowWarp=vec2f(perlin2(P.xz/467.0),perlin2(P.xz/389.0+31.7));
  let snowField=perlin2(P.xz/211.0+snowWarp*.7);
  let snowLine=545.0+snowField*62.0+N.z*25.0;
  snow=highland*smoothstep(snowLine,snowLine+65.0+footprint*2.0,P.y)*smoothstep(.42,.81,N.y)*(1.0-underBed);
 }
 let snowColour=mix(${srgb(.62,.67,.68)},${srgb(.87,.88,.85)},d.w*.45+.35);
 ground=mix(ground,snowColour,snow*.94*museumGroundReview.snow);
 // Below a few pixels per crown, forest becomes a filtered canopy field.
 // This continues the same woodland footprint beyond individual cards.
 let canopyFar=smoothstep(2900.0,4200.0,distance(P,frame.cameraPos));
 let crownTone=mix(${srgb(.22,.29,.20)},${srgb(.31,.36,.24)},macroTone);
 ground=mix(ground,crownTone,canopyFar*cover.a*.66*(1.0-underBed)*(1.0-snow));

 // Fine sand ripples are filtered at their projected wavelength; broad bed
 // undulation comes from shared CPU/GPU terrain heights (BedRelief).
 let ripplePhase=P.x*13.0+P.z*4.1+sin(P.z*.72)*.65;
 let rippleFilter=1.0-smoothstep(.08,.3,footprint);
 let sandRipples=sin(ripplePhase)*.0025*rippleFilter*underBed*(1.0-stoneShare);
 let shoreWet=creekCoastWetness(P.xz,P.y-frame.seaLevel);
 wet=max(max(wet,shoreWet.x),sourceWet*.94);
 s.albedo=mix(ground*mix(1.0,.72,wet),vec3f(0.68),shoreWet.y*0.55);s.roughness=mix(mix(mix(.94,rockRough,rockW),.48,wet),mix(.86,rockRough,stoneShare*.7),underBed);s.specularIntensity=.22;
 let swardRelief=meadow.relief*(1.0-cover.a*.7)*(1.0-cover.r)*(1.0-grove.x)*(1.0-underBed)*(1.0-snow*museumGroundReview.snow);
 s.normal=terrainPerturbNormal(P,N,(mix((d.y*.022+micro.z*.003)*(1.0-smoothstep(.18,.8,footprint))+swardRelief,rockRelief,rockW)*(1.0-underBed)+bedRelief+sandRipples)*museumGroundReview.bump,1.0);s.ao=mix(.72,1.0,nr.w);
 if(underBed>.5){if(museumGroundReview.bedDebug==1.0){s.albedo=vec3f(.2);}if(museumGroundReview.bedDebug==2.0){s.normal=vec3f(0.0,1.0,0.0);}if(museumGroundReview.bedDebug==3.0){s.albedo=vec3f(.15+(wf.x-P.y)*.025);s.normal=vec3f(0.0,1.0,0.0);}if(museumGroundReview.bedDebug==4.0){s.albedo=vec3f(.2);s.normal=vec3f(0.0,1.0,0.0);s.ao=1.0;}}
`;
    this.setCoastWetness(null);mat.needsUpdate=true;this.mesh.name='Original museum creek and western coast terrain';
  }
  setCoastWetness(sim){
    const m=this.material;
    if(this._coastWet)m.modules=m.modules.filter(x=>x!==this._coastWet);
    this._coastWet=new ShaderModule({name:'museumCoastWetness',deps:sim?[sim.module]:[],code:sim?`
fn creekCoastWetness(p:vec2f,h:f32)->vec2f{
 let detail=museumSurfDetailAt(p);let state=shoreSimSample(p)*detail;let inside=shoreSimInside(shoreSimUvOf(p))*detail;
 let damp=(1.0-smoothstep(-0.2,0.7,h))*(1.0-smoothstep(1.0,2.4,-h));
 return vec2f(max(state.y,damp*(1.0-inside)),shoreSimSandFoam(p,state,h+frame.seaLevel));
}`:'fn creekCoastWetness(p:vec2f,h:f32)->vec2f{return vec2f(0.0);}'});
    m.modules.push(this._coastWet);m.needsUpdate=true;
  }
}
