// Museum soil/stone palette on native Tidewater CDLOD, shared heights and AO.
import { Terrain } from '../vendor/tidewater/src/world/Terrain.js';
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {CDLOD} from '../vendor/tidewater/src/core/CDLOD.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/gpu/Uniforms.js';
import { terrainShadingModule, srgb } from '../vendor/tidewater/src/world/terrain/TerrainShading.js';

const naturalStrand = new ShaderModule({name:'museumNaturalStrand',code:`
struct StrandSurface {
 albedo: vec3f,
 relief: f32,
 roughness: f32,
 specular: f32,
};

fn museumStrandSurface(
 p: vec2f, h: f32, n: vec3f, d: vec4f, m: vec4f, micro: vec4f,
 grad: RockGrad, footprint: f32, history: vec2f,
) -> StrandSurface {
 // Windblown fines and denser grains accumulate in patches measured in metres.
 let drift=perlin2(p/36.0+17.8);
 let pockets=perlin2(p/7.4+vec2f(22.7,drift*.56));
 let sorted=smoothstep(.19,.81,.49+drift*.47+pockets*.18+(m.w-.5)*.23);
 var dry=mix(${srgb(.66,.58,.46)},${srgb(.80,.73,.60)},sorted);
 dry*=1.0+(d.w-.5)*.11;

 let gritWeight=1.0-smoothstep(.024,.10,footprint);
 let grainWeight=1.0-smoothstep(.005,.028,footprint);
 let grain=clamp(micro.z,.31,.59)-.45;
 let flakeHeight=h+pockets*.46+(m.w-.5)*.38;
 let wrack=smoothstep(.61,1.17,flakeHeight)*(1.0-smoothstep(1.80,2.78,flakeHeight))
   *smoothstep(.42,.72,.52+pockets*.42+(d.w-.5)*.35);
 var fragments=0.0;
 if(gritWeight>.0){
  // Use the sparse pebble peaks in the native sand atlas at a second angle.
  let rotation=mat2x2f(vec2f(.821,.571),vec2f(-.571,.821))*(1.0/2.6);
  let grit=terrainDetailGrad(rotation*p+vec2f(.37,.68),rotation*grad.dpdx.xz,rotation*grad.dpdy.xz);
  let exposure=smoothstep(.29,.75,.51+pockets*.53+(d.w-.5)*.24);
  fragments=smoothstep(.66,.87,grit.z)*gritWeight*(.24+.34*exposure+.29*wrack);
  let mineral=mix(${srgb(.42,.37,.31)},${srgb(.82,.77,.66)},smoothstep(.41,.62,grit.y+(m.y-.5)*.22));
  dry=mix(dry,mineral,fragments*.68);
 }
 let detritus=wrack*smoothstep(.54,.74,d.y)*.43;
 dry=mix(dry,${srgb(.34,.28,.21)},detritus);
 dry*=1.0+grain*.34*grainWeight;

 // Use the remembered reach of the actual swash. Capillary damp persists when
 // the travelling history window is absent. Pore drainage breaks up its edge.
 let wick=.36+pockets*.21+(d.w-.5)*.22;
 let capillary=1.0-smoothstep(.015,max(.18,wick),h);
 let wetHistory=clamp(history.x,0.0,1.0);
 let draining=smoothstep(.07,.47,wetHistory)*(1.0-smoothstep(.59,.95,wetHistory));
 let poreNoise=smoothstep(.24,.79,.52+pockets*.35+(d.y-.5)*.48);
 let wet=max(capillary*.76,wetHistory*(1.0-draining*poreNoise*.42));
 let glossy=smoothstep(.52,.95,wetHistory)*(1.0-smoothstep(.15,.81,h));

 // Wind ripples bend and peter out in patches on the upper, drier shore.
 let wind=frame.windDir;
 let dx=grad.dpdx.xz;let dy=grad.dpdy.xz;
 let cycles=max(abs(dot(dx,wind)),abs(dot(dy,wind)))/.16+footprint*.56;
 let windWeight=(1.0-smoothstep(.12,.36,cycles))*smoothstep(.78,1.78,h)
   *smoothstep(.30,.69,.48+pockets*.65+(m.w-.5)*.20)*(1.0-wet)*(1.0-wrack);
 let phase=dot(p,wind)*(6.2831853/.16)+pockets*6.2+drift*11.4;
 let ripple=(pow(sin(phase)*.5+.5,1.55)-.43)*windWeight;
 dry*=1.0+ripple*.16;

 // Use two fixed projections for faint downslope drainage. A world position
 // projected onto a turning normal would shear the texture as the slope bends.
 let rillWeight=wet*smoothstep(.025,.18,h)*(1.0-smoothstep(.36,.89,h))
   *smoothstep(.022,.115,length(n.xz))*(1.0-smoothstep(.035,.15,footprint));
 var rill=0.0;
 if(rillWeight>.0){
  let xScale=vec2f(4.8,.83);let zScale=xScale.yx;
  let rx=terrainDetailGrad(p/xScale,dx/xScale,dy/xScale).w;
  let rz=terrainDetailGrad(p/zScale,dx/zScale,dy/zScale).w;
  let w=n.x*n.x/max(dot(n.xz,n.xz),.0001);
  rill=(mix(rz,rx,w)-.5)*rillWeight;
 }
 let dark=vec3f(.50,.55,.59)*(1.0+rill*.24);
 let wetSand=mix(dry,dry*dark,wet);
 // Stored native bubbles brighten only their tiny, stationary lace strands.
 let bubbles=creekStrandBubbles(p,history.y,footprint)
   *smoothstep(-.05,.045,h)*(1.0-smoothstep(.68,1.15,h));
 let relief=(grain*.005*grainWeight+fragments*.003+ripple*.0048)*(1.0-wet*.67)+rill*.0029;
 let rough=mix(.93,mix(.57,.24,glossy),wet);
 return StrandSurface(mix(wetSand,${srgb(.82,.83,.80)},bubbles*.66),relief,
   mix(rough,.68,bubbles),.22+.18*wet+.11*glossy);
}
`});

export class CreekTerrain extends Terrain {
  constructor({scene,data,terrainGPU}) {
    super({scene,terrainData:data.terrain,terrainGPU,gridSize:64,rangeFactor:3});
    const old=this.lod;
    this.lod=new CDLOD({gridSize:64,leafSize:8,levels:Math.ceil(Math.log2(data.terrain.size/8))+1,rangeFactor:3,maxInstances:3000,prefix:'terrainLod',heightBounds:(...p)=>data.terrain.boundsFor(...p),center:{x:data.terrain.origin,z:data.terrain.origin,size:data.terrain.size}});
    this.mesh.geometry=this.lod.geometry;old.geometry.dispose?.();
    const mat=this.material;
    mat.modules=[terrainGPU.module,terrainShadingModule(),this.lod.module,terrainGPU.sunModulationModule,data.field.module,data.appearance.module];
    mat.modules.push(new ShaderModule({name:'museumShoreLandforms',code:data.landforms.materialWGSL}));
    mat.appliesHillShadow=true;mat.defines.MATERIAL_SUN_MODULATION=1;mat.defines.MUSEUM_TERRAIN_RECEIVER=1;
    this.review=new UniformBlock('MuseumGroundReview',{snow:['f32',1],bump:['f32',1],filtered:['f32',1],seabedLegacy:['f32',0],bedDebug:['f32',0],inlandBedLegacy:['f32',0],naturalStrand:['f32',1]});
    mat.modules.push(new ShaderModule({name:'museumGroundReview',uniforms:this.review}),naturalStrand);
    mat.surface=`
 let P=in.P;let nr=terrainNormalRock(P.xz);let filteredN=normalize(vec3f(nr.x,sqrt(max(1.0-dot(nr.xy,nr.xy),.0025)),nr.y));var N=normalize(filteredN);
 // The level-zero comparison samples every active terrain atlas a second time.
 // Only the diagnostics blend uses it; the visitor path uses the filtered normal.
 if(museumGroundReview.filtered!=1.0){N=normalize(mix(terrainNormalAt(P.xz),filteredN,museumGroundReview.filtered));}
 let worldGrad=terrainImplicitGrad(P);
 // The longer pixel axis controls relief resolution on grazing surfaces.
 let reliefFootprint=max(length(worldGrad.dpdx),length(worldGrad.dpdy));
 let footprint=max(length(fwidth(P)),.001);let cover=museumCover(P.xz,footprint);
 let d=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/3.5);let m=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/27.0);
 let micro=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/0.28);
 let macroTone=m.w*0.65+d.y*0.35;
 let wf=creekFieldAt(P.xz);
#if MUSEUM_TERRAIN_RECEIVER
 museumTerrainReceiver=wf;museumTerrainLightWeight=museumInlandWeightForField(wf);
#endif
 let sampleField=museumSampleField(P.xz);
 let sampleBank=sampleField.y<12.0;
 // At mean tide the river registry extends over the dry spit. Its surveyed
 // extent is not a gravel or wetting line on the marine face of the beach.
 let tidalOutlet=museumMainTidalWeight(P.xz);
 let tidalSand=tidalOutlet*(1.0-smoothstep(.08,1.2,wf.x-frame.seaLevel));
 let bank=(1.0-tidalSand)*select(1.0-smoothstep(2.0,10.0,abs(wf.y)),1.0-smoothstep(.25,2.0,wf.y),sampleBank)*(1.0-smoothstep(0.6,2.2,P.y-wf.x));
 let channelStone=bank*smoothstep(.08,.4,1.0-N.y);
 // Flow can expose bedrock on a steep submerged bank well inside the signed
 // water footprint. Its face keeps the same fractures above and below water.
 let cutFace=smoothstep(.135,.32,1.0-N.y)*smoothstep(.14,.30,length(wf.zw))
   *smoothstep(.25,.85,wf.x-P.y)*(1.0-smoothstep(-.2,.2,wf.y))
   *smoothstep(1.0,2.0,wf.x-frame.seaLevel)*smoothstep(44.0,74.0,sampleField.y);
 let rockW=max(max(museumShoreRock(nr.z,N.y),channelStone*.92),cutFace);
 // Sea and freshwater have separate local bed levels at the mouth.
 let seaDepth=frame.seaLevel-P.y;
 let riverDepth=wf.x-P.y;
 // The last river-profile row extends hundreds of metres into the sea.
 // In that reach deposition follows the tidal fan, rather than two banks
 // implied by the survey strip. Fade its gravel signal by marine exposure.
 let seaFan=tidalOutlet*(1.0-smoothstep(-598.0,-401.0,P.x));
 let riverBed=(1.0-seaFan)*(1.0-smoothstep(-1.0,1.0,wf.y))*smoothstep(.04,.65,riverDepth);
 let seaBed=smoothstep(.04,.75,seaDepth);
 let underBed=max(riverBed,seaBed);
 let marsh=museumWetlandSoil(P.xz);
 // Backshore growth follows interrupted wind and drainage pockets. A fixed
 // height contour made a perfectly even grass wall behind the broad sand.
 let duneEdge=perlin2(P.xz/61.0)*2.2+perlin2(P.xz/23.0+vec2f(31.7,7.1))*.95;
 let beach=(1.0-marsh)*(1.0-smoothstep(1.7+duneEdge,10.0+duneEdge,P.y-frame.seaLevel))*(1.0-rockW)*(1.0-cover.r);
 // The river-fed sand fan drifts southward as it widens offshore. Keep its
 // material mask on the same axis and feather as the physical shelf overlay.
 let fanOffshore=max(-864.0-P.x,0.0);
 let fanDistance=length(vec2f(fanOffshore/570.0,(P.z-126.0-fanOffshore*.10)/260.0));
 let marineFan=1.0-smoothstep(.84,1.22,fanDistance);
 let coveW=museumShelfWeight(P,footprint);
 // The beach apron and the offshore plume continue past the cove classification.
 // The fan covers the old dark inland-bed patch on the level sea floor.
 let mouthDistance=distance(P.xz,vec2f(-875.0,125.0));
 let mouthRegion=1.0-smoothstep(170.0,320.0,mouthDistance);
 let beachH=P.y-frame.seaLevel;
 let strandWarp=(m.w-.5)*3.0+(d.w-.5)*1.4;
 let strand=1.0-smoothstep(11.0+strandWarp,19.0+strandWarp,beachH);
 let mouthSand=max(mouthRegion*(1.0-rockW)*(1.0-cover.r)*max(max(beach,strand),seaBed*.9),marineFan*seaBed*.86);
 // Complete sediment and mouth-sand layers replace both soil pigment and sward relief.
 let soilVisible=underBed<1.0 && mouthSand<1.0;
 let meadow=museumSward(P,footprint,mat.gustOffset,soilVisible);
 var ground=vec3f(0.0);var meadowRelief=0.0;
 if(soilVisible){
  var litter=mix(${srgb(.25,.23,.16)},${srgb(.36,.32,.22)},macroTone);
  if(cover.b*cover.a>.025){
   let bed=clamp(.45+duneEdge*.105+(m.y-.5)*.49,0.0,1.0);
   let seams=smoothstep(.42,.68,micro.w*.37+d.w*.63);
   let dark=mix(${srgb(.115,.103,.077)},${srgb(.26,.209,.14)},bed);
   let dryNeedles=mix(${srgb(.26,.213,.137)},${srgb(.385,.315,.205)},d.z);
   let organic=mix(dark,dryNeedles,seams*(.23+.49*bed));
   litter=mix(litter,organic,cover.b*smoothstep(.17,.75,cover.a));
  }
  let soil=mix(${srgb(.32,.30,.24)},${srgb(.48,.45,.37)},d.z);
  ground=mix(meadow.albedo,litter,cover.a*0.70);
  ground=mix(ground,soil,cover.r);
  let grove=museumGroveFloor(P.xz);
  let humus=mix(${srgb(.17,.145,.10)},${srgb(.28,.245,.165)},d.y*.6+m.z*.4);
  let moss=mix(${srgb(.17,.22,.12)},${srgb(.27,.30,.16)},d.w);
  var needleBed=mix(humus,moss,smoothstep(.52,.77,grove.z)*(1.0-grove.y)*.53);
  needleBed=mix(needleBed,${srgb(.29,.25,.18)}*(.85+d.y*.3),grove.y*.5);
  ground=mix(ground,needleBed,grove.x*.94);
  let gravel=mix(${srgb(.34,.34,.29)},${srgb(.43,.42,.35)},d.z*.65+m.w*.35);
  ground=mix(ground,gravel,bank*(1.0-cover.r*0.3));
  meadowRelief=meadow.relief*(1.0-cover.a*.7)*(1.0-cover.r)*(1.0-grove.x);
 }
 // Wide cliffs use larger fractures in the same native material. Evaluate
 // rock only on exposed faces. Analytic warp gradients keep the mip footprint
 // exact without adding several Perlin evaluations over every grass pixel.
 var rockColour=vec3f(0.0);var rockRough=.94;var rockRelief=0.0;
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
  // Keep resolved stone relief on close faces. At grazing angles the longer
  // pixel axis can span several plate edges while the other axis is sharp.
  let plateWeight=1.0-smoothstep(.14,.72,reliefFootprint);
  rockColour=mix(rock.albedo,weathered,.25);rockRough=rock.rough;
  rockRelief=(rock.hd*.8+rock.height*.14-.16)*plateWeight;
 }
 ground=mix(ground,rockColour,rockW);
 let sourceWet=museumSourceWet(P);
 ground=mix(ground,rockColour,sourceWet*rockW*.8);
 var wet=(1.0-tidalSand)*(1.0-smoothstep(.08,.7,P.y-wf.x))*(1.0-smoothstep(0.0,2.5,wf.y));
 let mud=mix(${srgb(.24,.25,.18)},${srgb(.34,.32,.23)},m.w*.5+d.y*.5);
 ground=mix(ground,mud,marsh*(1.0-rockW)*.86);

 let coastSand=mix(${srgb(.48,.46,.39)},${srgb(.66,.61,.49)},m.z*0.55+micro.z*0.45);
 let estuaryBank=tidalOutlet*smoothstep(-540.0,-394.0,P.x);
 // Sheltered banks above the wrack line accumulate silt and vegetation,
 // whereas exposed forebeach sand continues toward the spit.
 var saltGrass=0.0;
 if(estuaryBank>0.0){saltGrass=estuaryBank*museumTidalGrowth(P.xz,beachH)*(.55+.38*cover.g);}
 ground=mix(ground,coastSand,beach*(1.0-saltGrass));
 // Mix two rotated, slowly warped native detail scales. Fine grit affects
 // roughness/near relief; it must not stamp a bright dot into every 28cm tile.
 var bedRelief=0.0;
 // Even under covered pigment, short footprints still need A/B for bed relief.
 let bedColorVisible=mouthSand<1.0 && coveW*underBed<1.0;
 if(underBed>.001 && (bedColorVisible || footprint<.42)){
  let phase=vec2f(P.z*.113+P.x*.037,P.x*.093-P.z*.041);
  let bw=sin(phase)*1.7;let warpCos=cos(phase);
  let q=P.xz+bw;let uvA=vec2f(q.x*.819-q.y*.574,q.x*.574+q.y*.819)/8.7;
  let uvB=vec2f(q.x*.39+q.y*.921,-q.x*.921+q.y*.39)/13.1;
  let wx=worldGrad.dpdx.xz;let wy=worldGrad.dpdy.xz;
  let dx=wx+warpCos*vec2f(dot(wx,vec2f(.037,.113)),dot(wx,vec2f(.093,-.041)))*1.7;
  let dy=wy+warpCos*vec2f(dot(wy,vec2f(.037,.113)),dot(wy,vec2f(.093,-.041)))*1.7;
  let A=terrainDetailGrad(uvA,vec2f(dx.x*.819-dx.y*.574,dx.x*.574+dx.y*.819)/8.7,vec2f(dy.x*.819-dy.y*.574,dy.x*.574+dy.y*.819)/8.7);
  let B=terrainDetailGrad(uvB,vec2f(dx.x*.39+dx.y*.921,-dx.x*.921+dx.y*.39)/13.1,vec2f(dy.x*.39+dy.y*.921,-dy.x*.921+dy.y*.39)/13.1);
  if(bedColorVisible){
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
   // Organic fines settle in quiet lake hollows; neighbouring washed pockets
   // expose lighter silt. Reuse the filtered deposits, including their gradients.
   let profundal=riverBed*smoothstep(4.2,8.0,riverDepth)*(1.0-smoothstep(.09,.19,length(wf.zw)));
   let lens=smoothstep(.54,.73,m.w*.47+deposit*.37+B.y*.16);
   bedColour=mix(bedColour,${srgb(.32,.30,.26)},profundal*lens*.52);
   bedColour=mix(mix(bedColour,legacyBed,museumGroundReview.inlandBedLegacy),mud,marsh*.75);
   ground=mix(ground,mix(bedColour,rockColour,cutFace*.87),underBed);
  }
  bedRelief=(A.y*.009+B.z*.004)*(1.0-smoothstep(.08,.42,footprint))*underBed;
 }
 let stoneShare=max(smoothstep(.1,.55,1.0-N.y),smoothstep(.52,.8,m.w)*.45);

 if(coveW>.001 && mouthSand<1.0){let covePatch=museumCovePatch(P.xz,footprint,museumGroundReview.seabedLegacy);
 let coveSand=mix(${srgb(.82,.77,.65)},${srgb(.73,.72,.62)},covePatch.z*.75+(m.w-.5)*.12);
 let coveRubble=mix(${srgb(.34,.34,.29)},${srgb(.49,.47,.39)},covePatch.z);
 let coveGrass=mix(${srgb(.23,.27,.17)},${srgb(.33,.34,.23)},covePatch.z);
 // The river feeds a sandy offshore fan. A legacy broad seagrass patch was
 // rendering its newly levelled bed as a rectangular dark hole from above.
 // Keep grass and rubble around the fan, with small traces within it.
 let mouthDeposit=1.0-smoothstep(.55,.98,fanDistance);
 let grassBed=covePatch.x*smoothstep(.8,2.0,seaDepth)*(1.0-smoothstep(7.0,12.0,seaDepth))*(1.0-mouthDeposit*.94);
 let coveBed=mix(mix(coveSand,coveRubble,covePatch.y*.65*(1.0-mouthDeposit*.82)),coveGrass,grassBed*.85);
 ground=mix(ground,coveBed,coveW*underBed);
 ground=mix(ground,coveSand,coveW*beach*(1.0-underBed)*.65);
 }
 let highland=museumSnowShelter(P.xz);
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

 // Derivatives stay in uniform flow, including at the edge of the sand mask.
 let ripplePhaseDry=dot(P.xz,frame.windDir)*59.839+d.w*22.0+m.w*17.0;
 let dryRippleWidth=fwidth(ripplePhaseDry);
 let shoreWet=creekCoastWetness(P.xz,beachH);
 var grainRelief=0.0;
 if(mouthSand>.001){
  let drift=clamp(.5+perlin2(P.xz/29.0)*.5,0.0,1.0);
  let sandPatch=clamp(m.z*.32+d.w*.28+micro.z*.18+drift*.22,0.0,1.0);
  let fineWeight=1.0-smoothstep(.025,.15,footprint);
  let grit=terrainDetailGrad(P.xz/.095,worldGrad.dpdx.xz/.095,worldGrad.dpdy.xz/.095);
  let grains=min(grit.z,.62)*.55+min(micro.z,.62)*.45;
  var drySand=mix(${srgb(.70,.62,.48)},${srgb(.87,.78,.63)},sandPatch);
  drySand*=mix(1.0,1.0+(grains-.45)*.25,fineWeight);
  let wrackH=beachH+(m.w-.5)*.48+(d.w-.5)*.12;
  let wrackBand=smoothstep(1.15,1.48,wrackH)*(1.0-smoothstep(2.15,2.75,wrackH));
  let sparseGrit=smoothstep(.62,.80,m.w+d.w*.24)*.16;
  let pebble=smoothstep(.76,.90,micro.z+(d.y-.5)*.10)*(sparseGrit+wrackBand)
   *(1.0-smoothstep(.04,.13,footprint));
  let shell=smoothstep(.78,.92,grit.z)*wrackBand*fineWeight*.25;
  drySand=mix(drySand,mix(${srgb(.66,.61,.53)},${srgb(.37,.35,.32)},d.y),pebble*.55+shell);
  let wrack=wrackBand*smoothstep(.64,.82,d.y)*smoothstep(.42,.68,m.w)*.36;
  drySand=mix(drySand,${srgb(.31,.27,.20)},wrack);
  let rippleK=(1.0-smoothstep(.6,2.2,dryRippleWidth))*smoothstep(1.6,2.8,beachH)*(1.0-underBed);
  let rippleDry=pow(sin(ripplePhaseDry)*.5+.5,1.6)-.5;
  drySand*=1.0+rippleDry*.085*rippleK;
  let riverBand=(1.0-smoothstep(.0,1.1,sampleField.y))*(1.0-smoothstep(.05,.8,P.y-sampleField.x));
  // The beach darkens where native ShoreSim remembers a passing sheet, then
  // dries back out. A height-quantised material stripe stays put while the
  // wave drains and reads as several simultaneous tide lines.
  let damp=max(shoreWet.x,riverBand*.7)*mix(.30,.55,smoothstep(.28,.75,d.w*.65+m.z*.35));
  var graded=mix(drySand,drySand*vec3f(.79,.82,.84),damp);
  let submerged=smoothstep(.08,.8,seaDepth);
  graded=mix(graded,mix(${srgb(.82,.77,.65)},${srgb(.70,.69,.61)},smoothstep(1.0,9.0,seaDepth))*(.92+sandPatch*.13),submerged);
  ground=mix(ground,graded,mouthSand);
  grainRelief=((grains-.45)*.007*fineWeight+rippleDry*.003*rippleK)*mouthSand;
 }

 // Fine sand ripples are filtered at their projected wavelength; broad bed
 // undulation comes from shared CPU/GPU terrain heights (BedRelief).
 let ripplePhase=P.x*13.0+P.z*4.1+sin(P.z*.72+m.y*3.0)*(.65+mouthRegion*.8)+mouthRegion*(d.x*3.0+m.z*4.0);
 let rippleWidth=fwidth(ripplePhase);
 // Native ocean history supplies the moving wet boundary. A narrow capillary
 // fringe continues it on land and along the freshwater margin. The signed
 // inland field sets that local datum through the channel mouth and lakes.
 let bankRise=P.y-wf.x;
 var dampFilm=0.0;
 var marineProbe=0.0;
 // Both envelopes are identically zero outside their height support. Most
 // upland fragments can bypass the entire shore material, including its map.
 if((beachH>-.85 && beachH<5.9)||(bankRise>-.85 && bankRise<5.9)){
  let lakeMargin=museumLakeMargin(P.xz,wf);
  let brackish=(1.0-smoothstep(.05,8.0,wf.y))*smoothstep(0.0,.35,wf.x-frame.seaLevel);
  var coastSupply=max(max(mouthRegion,coveW),tidalSand);
  if(beachH>-.95 && beachH<6.0 && beach>.015 && coastSupply<.99){
   // The marine channel holds *connected water*. Look just downslope to
   // continue its sediment onto the dry shore without tinting inland hollows.
   let probe=P.xz+N.xz/max(length(N.xz),.025)*56.0;
   marineProbe=textureSampleLevel(museumFlora,smpLinearClamp,(probe+16384.0)/32768.0,0.0).r;
   coastSupply=max(coastSupply,marineProbe);
  }
  // Select coverage only after evaluating each bank against its own water
  // level. The lake's signed extent sets its influence along the outer bank.
  let seaFace=smoothstep(-.85,-.14,beachH)*(1.0-smoothstep(2.8,5.9,beachH));
  let bankFace=smoothstep(-.85,-.14,bankRise);
  let saltRim=coastSupply*(1.0-marsh)*mix(seaFace,bankFace*(1.0-smoothstep(2.8,5.9,bankRise)),brackish);
  let freshRim=lakeMargin*bankFace*(1.0-smoothstep(1.6,3.3,bankRise));
  let softBed=(1.0-rockW)*(1.0-cover.r)*(1.0-saltGrass);
  let rim=max(saltRim,freshRim)*softBed;
  let grainField=d.z*.56+micro.z*.27+m.z*.17;
  let wick=.40+(m.w-.5)*.26+(d.w-.5)*.12;
  let seaDamp=1.0-smoothstep(.035,wick,beachH);
  let bankDamp=1.0-smoothstep(.035,wick,bankRise);
  let tidalFilm=max(shoreWet.x,.68*mix(seaDamp,bankDamp,brackish))*saltRim;
  dampFilm=max(tidalFilm,.68*bankDamp*freshRim)*softBed;
  if(rim>.001){
   let saltDeposit=mix(museumMarineStrand(beachH),museumMarineStrand(bankRise),brackish);
   let deposit=mix(saltDeposit,1.0-smoothstep(.75,1.8,bankRise),lakeMargin);
   let sort=smoothstep(.42,.77,d.w*.64+m.w*.36)*deposit;
   let fine=1.0-smoothstep(.035,.19,footprint);
   let speck=smoothstep(.48,.84,d.z*.67+micro.y*.33)*fine;
   let sand=mix(${srgb(.64,.545,.405)},${srgb(.85,.76,.60)},clamp(grainField*.8+m.w*.24,0.0,1.0));
   let shingle=mix(${srgb(.37,.375,.34)},${srgb(.65,.62,.53)},grainField);
   var sorted=mix(sand,shingle,clamp(lakeMargin*.58+sort*.53+speck*.34,0.0,.93));
   // Winnowed lenses are broken patches of darker heavy grit, visible between
   // the individual shells. Their relief disappears at the grain footprint.
   let lens=deposit*smoothstep(.39,.64,m.w*.58+d.w*.42);
   let concentrate=lens*smoothstep(.43,.70,d.z*.79+micro.y*.21);
   sorted=mix(sorted,${srgb(.45,.40,.33)}*(.85+grainField*.26),concentrate*.49);
   sorted*=1.0+(micro.z-.47)*.26*fine;
   ground=mix(ground,sorted,rim*mix(.67,.83,lakeMargin));
   grainRelief+=(d.z-.43)*(.004+sort*.009+lakeMargin*.006)*fine*rim;
  }
 }
 // Below the wetland bank top, standing water darkens organic silt in
 // pockets. The rendered height above this water body locates the real
 // shoreline, including mud flats deep inside the broad marsh footprint.
 if(marsh*cover.b>.001 && wf.y<12.0 && wf.x>frame.seaLevel+.55 && bankRise>-.28 && bankRise<1.65){
  let deposit=clamp(m.w*.53+d.y*.31+micro.z*.16,0.0,1.0);
  let top=.64+(m.z-.5)*.71+(d.w-.5)*.16;
  let damp=1.0-smoothstep(.06,top,bankRise);
  let matting=smoothstep(top*.62,top*1.52,bankRise)*smoothstep(.35,.65,deposit);
  let fineMud=mix(${srgb(.20,.195,.145)},${srgb(.38,.345,.25)},deposit);
  let sedgeMat=mix(${srgb(.25,.27,.14)},${srgb(.36,.35,.19)},m.z);
  let clay=mix(fineMud,${srgb(.43,.395,.29)}*(.74+.48*deposit),1.0-damp);
  let margin=marsh*cover.b*(1.0-rockW)*(1.0-cover.r)*(1.0-smoothstep(.85,1.65,bankRise))
    *smoothstep(-.28,-.03,bankRise);
  ground=mix(ground,mix(clay,sedgeMat,matting*.68),margin*.91);
  dampFilm=max(dampFilm,margin*damp*.5);
 }
 let rippleFilter=1.0-smoothstep(.6,2.2,rippleWidth);
 let sandRipples=sin(ripplePhase)*.0025*rippleFilter*underBed*(1.0-stoneShare);
 var strandWeight=0.0;
 var naturalSurface:StrandSurface;
 if(museumGroundReview.naturalStrand>0.0 && beachH>-.20 && beachH<10.0 && beach>.01 && rockW<.48){
  // Ease in beyond the two hand-authored mouths and their material feathers.
  let mainMargin=museumMainTidalWeight(mix(vec2f(-653.0,3690.0),P.xz,.82));
  let openCoast=smoothstep(320.0,425.0,mouthDistance)*(1.0-smoothstep(.0,.14,mainMargin));
  let freshBank=(1.0-smoothstep(.15,8.0,wf.y))*smoothstep(.25,.75,wf.x-frame.seaLevel);
  let loose=beach*(1.0-saltGrass)*(1.0-freshBank)*(1.0-smoothstep(.10,.48,rockW))
    *smoothstep(.937,.989,N.y)*smoothstep(-.20,-.015,beachH);
  if(loose*openCoast>.001){
   // The 32 m connectivity map contains only open sea. Use a second reach
   // downslope for the upper beach where the first probe can still be dry.
   if(marineProbe<.84){
    let downhill=filteredN.xz/max(length(filteredN.xz),.018);
    let reach=clamp(43.0+max(beachH,0.0)*18.0,43.0,156.0);
    marineProbe=max(marineProbe,textureSampleLevel(museumFlora,smpLinearClamp,
      (P.xz+downhill*reach+16384.0)/32768.0,0.0).r);
   }
   strandWeight=clamp(museumGroundReview.naturalStrand,0.0,1.0)*loose*openCoast
     *smoothstep(.12,.72,marineProbe);
   if(strandWeight>.001){naturalSurface=museumStrandSurface(P.xz,beachH,N,d,m,micro,worldGrad,reliefFootprint,shoreWet.yz);}
   else{strandWeight=0.0;}
  }
 }
 wet=max(max(wet,shoreWet.x),sourceWet*.94);
 // Shore darkening belongs on exposed damp sand. The inherited river-field
 // wet mask continues into the bay; applying it to submerged sediment made
 // a rectangular dark patch even after the physical offshore pit was gone.
 let surfaceWet=wet*(1.0-seaBed);
 let legacyAlbedo=ground*mix(1.0,.72,surfaceWet)*mix(vec3f(1.0),vec3f(.72,.77,.82),dampFilm);
 let legacyRough=mix(mix(mix(mix(.94,rockRough,rockW),.48,surfaceWet),mix(.86,rockRough,stoneShare*.7),underBed),.34,dampFilm);
 s.albedo=mix(legacyAlbedo,naturalSurface.albedo,strandWeight);
 s.roughness=mix(legacyRough,naturalSurface.roughness,strandWeight);
 s.specularIntensity=mix(.22+.20*dampFilm,naturalSurface.specular,strandWeight);
 // Fade each relief scale before its gradient becomes unresolved. The
 // filtered albedo and broad terrain normal still carry the same substrate.
 let litterWeight=1.0-smoothstep(.030,.135,reliefFootprint);
 let sandGrainWeight=1.0-smoothstep(.004,.026,reliefFootprint);
 let swardWeight=1.0-smoothstep(.055,.27,reliefFootprint);
 let swardRelief=meadowRelief*swardWeight*(1.0-underBed)*(1.0-mouthSand)*(1.0-snow*museumGroundReview.snow);
 let soilRelief=((d.y-.35)*.022*litterWeight+(micro.z-.45)*.003*sandGrainWeight)*(1.0-mouthSand);
 let groundRelief=mix(soilRelief+swardRelief,rockRelief,rockW)*(1.0-underBed);
 let exposedCut=rockRelief*cutFace*underBed*.70;
 let legacyRelief=groundRelief+exposedCut+bedRelief+sandRipples+grainRelief;
 let strandRelief=naturalSurface.relief+exposedCut+bedRelief+sandRipples;
 s.normal=terrainPerturbNormal(P,N,mix(legacyRelief,strandRelief,strandWeight)*museumGroundReview.bump,1.0);s.ao=mix(.72,1.0,nr.w);
 if(underBed>.5){if(museumGroundReview.bedDebug==1.0){s.albedo=vec3f(.2);}if(museumGroundReview.bedDebug==2.0){s.normal=vec3f(0.0,1.0,0.0);}if(museumGroundReview.bedDebug==3.0){s.albedo=vec3f(.15+(wf.x-P.y)*.025);s.normal=vec3f(0.0,1.0,0.0);}if(museumGroundReview.bedDebug==4.0){s.albedo=vec3f(.2);s.normal=vec3f(0.0,1.0,0.0);s.ao=1.0;}}
`;
    this.setCoastWetness(null);mat.needsUpdate=true;this.mesh.name='Original museum creek and western coast terrain';
  }
  setCoastWetness(sim){
    const m=this.material;
    if(this._coastWet)m.modules=m.modules.filter(x=>x!==this._coastWet);
    this._coastWet=new ShaderModule({name:'museumCoastWetness',deps:sim?[sim.module]:[],code:sim?`
fn creekCoastWetness(p:vec2f,h:f32)->vec3f{
 let detail=museumSurfDetailAt(p);let state=shoreSimSample(p)*detail;let inside=shoreSimInside(shoreSimUvOf(p))*detail;
 let damp=(1.0-smoothstep(-0.15,0.20,h))*(1.0-smoothstep(1.0,2.4,-h));
 return vec3f(max(state.y,damp*(1.0-inside)),state.yz);
}
fn creekStrandBubbles(p:vec2f,amount:f32,footprint:f32)->f32{
 // Native lace has no mip levels on this four-load binding. Fade the actual
 // strands as they become unresolved; a uniform fallback reads as a blotch.
 let resolved=1.0-smoothstep(.010,.031,footprint);
 if(amount<.035 || resolved<=0.0){return 0.0;}
 let lace=shoreSimLaceLoad(p+11.3);
 let pop=smoothstep(lace.w*.49,lace.w*.49+.11,amount);
 let line=(1.0-smoothstep(.044,.147,lace.x))*smoothstep(.28,.68,lace.z)*.70;
 let bubbles=smoothstep(.26,.66,lace.y);
 return max(line,bubbles)*pop*resolved*smoothstep(.04,.28,amount);
}`:`
fn creekCoastWetness(p:vec2f,h:f32)->vec3f{return vec3f(0.0);}
fn creekStrandBubbles(p:vec2f,amount:f32,footprint:f32)->f32{return 0.0;}
`});
    m.modules.push(this._coastWet);m.needsUpdate=true;
  }
}
