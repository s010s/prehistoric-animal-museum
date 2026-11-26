// Shared museum ground/plant representation, using Tidewater's palette and
// multi-scale handover contract. Botanical forms are visual placeholders.
import {mainTidalShading} from './MainEstuary.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {coveShadingWGSL} from './ShallowCove.js';
import {groveModule,groveWeight,groveOpening,grovePathDistance,grovePatch} from './GroveDesign.js';
import {terrainShadingModule,srgb} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {groundNoiseModule} from './GroundNoise.js';
import {createGrassDistance} from './GrassDistance.js';
import {buildStrandGrowth} from './StrandGrowth.js';
import {sampleForestWeight,sampleForestWGSL} from './SampleForest.js';
import {buildSampleGroundCover} from './SampleGroundCover.js';
import {LYSTROSAURUS_CLEARING} from './IslandFaunaPlan.js';
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

export function createMeadowAppearance(data,terrainGPU){
 const distance=createGrassDistance();
 const {geography:g}=data,terrain=data.coverTerrain??data.terrain,mask=data.grass;
 const counts={meadow:0,upright:0,groundcover:0};
 for(let j=0;j<mask.res;j++)for(let i=0;i<mask.res;i++){
  const k=(j*mask.res+i)*4;let v=mask.data[k+1]/255;if(v<.02)continue;
  const x=terrain.origin+(i+.5)*terrain.size/mask.res,z=terrain.origin+(j+.5)*terrain.size/mask.res;
  const f=data.field.sample(x,z),cx=Math.max(0,Math.min(g.maskRes-1,Math.floor((x+512)/1024*g.maskRes))),cz=Math.max(0,Math.min(g.maskRes-1,Math.floor((z+512)/1024*g.maskRes)));
  // Let the tidal beach breathe. Terrestrial grass retreats above the swash
  // band; this does not erase the riverbank vegetation at its higher water level.
  if(terrain.heightAt(x,z)<4.5&&data.cove.continuous.marineAt(x,z)>0&&!(f[1]<2&&f[0]>1)){v*=smooth(1.2,4.5,terrain.heightAt(x,z)+.7);mask.data[k+1]=Math.round(v*255);}
  const inside=Math.max(Math.abs(x),Math.abs(z))<496;
  const wood=(inside?data.masks[(cz*g.maskRes+cx)*4+3]:data.islandMasks[k+3])/255;
  const damp=(1-smooth(2,15,Math.abs(f[1])))*smooth(.12,1.2,terrain.heightAt(x,z)-f[0]);
  const marshUprights=1-data.landforms.climate.wetland.weight(x,z);
  mask.data[k+2]=Math.round(v*damp*.8*marshUprights*255);
  // Sparse woodland groundcover; the native bright beach creeper must not be
  // distributed across every inland meadow simply because it has woodland.
  mask.data[k+3]=Math.round(v*(.018+wood*.13)*255);
  const gw=groveWeight(x,z),gap=Math.max(groveOpening(x,z),1-smooth(1.5,3.4,grovePathDistance(x,z)));
  const keep=1-gw*(.92-gap*.30-smooth(.6,.9,grovePatch(x,z))*.30);
  for(let c=1;c<4;c++)mask.data[k+c]=Math.round(mask.data[k+c]*keep);
  if(data.field.continuousSample){const sw=sampleForestWeight(x,z);mask.data[k+1]=Math.round(mask.data[k+1]*(1-sw*.88));mask.data[k+2]=Math.round(mask.data[k+2]*(1-sw*.7));mask.data[k+3]=Math.round(mask.data[k+3]*(1-sw*.35));}
  counts.meadow++;if(mask.data[k+2]>8)counts.upright++;if(mask.data[k+3]>8)counts.groundcover++;
 }
 const make=(label,res,bytes)=>{const t=new Texture({label,width:res,height:res,format:'rgba8unorm',data:bytes,mips:true,usage:['sample','copyDst'],sampler:'linearClamp'});t.getGPU();generateMipmaps(t);return t;};
 const groundCover=buildSampleGroundCover(!!data.field.continuousSample,data.terrain);
 // GPU-only spare R stores ocean connectivity. Do not expose it to native
 // CPU grass occupancy or its dune-grass selector; those retain their zero R.
 const densityBytes=new Uint8Array(mask.data),wf=[0,0,0,0];
 for(let j=0;j<mask.res;j++)for(let i=0;i<mask.res;i++){
  const x=-16384+(i+.5)*32768/mask.res,z=-16384+(j+.5)*32768/mask.res;
  let marine=data.cove.continuous.marineAt(x,z);if(marine>0){data.field.sample(x,z,wf);if(wf[1]<2&&wf[0]>-.1)marine=0;}
  densityBytes[(j*mask.res+i)*4]=Math.round(marine*255);
 }
 const fine=make('Museum creek habitat',g.maskRes,data.masks),coarse=make('Museum watershed habitat',data.island.maskRes,data.islandMasks),density=make('Museum multi-form ground cover + marine connectivity',mask.res,densityBytes),sampleGround=make('Museum 2m sample ground mosaic',groundCover.res,groundCover.bytes);
 const strand=buildStrandGrowth(data,terrainGPU.shoreField);
 const strandExposure=new Texture({label:'Museum connected shore growth exposure',width:strand.res,height:strand.res,format:'rg8unorm',data:strand.bytes,usage:['sample','copyDst'],sampler:'linearClamp'});
 strandExposure.getGPU();
 const review=new UniformBlock('MuseumHabitatReview',{legacyWater:['f32',0],patchCover:['f32',1]});
 const module=new ShaderModule({name:'museumMeadow',deps:[terrainGPU.module,terrainShadingModule(),groundNoiseModule(),data.field.module,groveModule,distance.module,mainTidalShading],uniforms:review,uniformName:'museumHabitatReview',bindings:{museumFineCover:{texture:fine},museumOuterCover:{texture:coarse},museumFlora:{texture:density},museumSampleGroundCover:{texture:sampleGround},museumStrandExposure:{texture:strandExposure}},code:`
${data.landforms.climate.wgsl}
${coveShadingWGSL}
${sampleForestWGSL}
${strand.wgsl}
fn museumSampleGroundAt(p:vec2f,footprint:f32)->vec3f{
 if(p.x<${groundCover.origin[0]}.0||p.x>${groundCover.origin[0]+groundCover.size}.0||p.y<${groundCover.origin[1]}.0||p.y>${groundCover.origin[1]+groundCover.size}.0){return vec3f(1.0,1.0,0.0);}
 let uv=(p-vec2f(${groundCover.origin[0]}.0,${groundCover.origin[1]}.0))/${groundCover.size}.0;
 return textureSampleLevel(museumSampleGroundCover,smpLinearClamp,uv,max(0.0,log2(max(footprint,.001)/2.0))).rgb;
}
// Finer sediment holds vegetation in pockets behind the tidal strand. The
// low spit stays open; dry ground and blade instances share its inland edge.
fn museumTidalGrowth(p:vec2f,rise:f32)->f32{
 if(rise<.65){return 0.0;}if(rise>10.0){return 1.0;}
 let pocket=perlin2(p/37.0+vec2f(4.5,7.2))*.68+perlin2(p/11.0)*.32;
 let toes=1.15+2.4*smoothstep(-.36,.32,pocket);
 let spaced=smoothstep(toes,toes+2.4,rise)*(.22+.78*smoothstep(-.23,.37,pocket+rise*.038));
 return mix(spaced,1.0,smoothstep(5.8,10.0,rise));
}
fn museumMouthGrassFactor(p:vec2f,h:f32)->f32{
 let q=p-vec2f(-875.0,125.0);let d2=dot(q,q);
 if(d2>=102400.0||h>31.0){return 1.0;}
 // The near grass and distant sward receive the same mask. Its open sand
 // contour follows the ground material's 11–19 m coastal sand transition.
 let reach=1.0-smoothstep(170.0,320.0,sqrt(d2));
 let warp=sin(p.x*.081+p.y*.023)*.70+sin(p.y*.12-p.x*.047)*.35;
 let aboveSea=h+.7;
 let openSand=reach*(1.0-smoothstep(11.0+warp,19.0+warp,aboveSea));
 if(aboveSea<=10.0){return 1.0-openSand;}
 // Behind the sand, grass collects in irregular dune pockets. Between them
 // the low, dry ground remains visible instead of a continuous green sheet.
 let dune=reach*smoothstep(10.0,17.0,aboveSea)*(1.0-smoothstep(25.0,31.0,aboveSea));
 let pocketNoise=clamp(.5+perlin2(p/19.3)*.32+perlin2(p/6.7+13.0)*.16,0.0,1.0);
 let pockets=mix(.035,.55,smoothstep(.46,.70,pocketNoise));
 return (1.0-openSand)*mix(1.0,pockets,dune);
}
// Fast 1-tap isotropic multi-octave macro field from museumGroundTex Layer 0
// (613 m tile, 12..14 cells/tile -> 51 m..3 m octaves, 0 banding, compute-safe).
fn museumMacroField(p:vec2f,footprint:f32)->f32{
 const r1=mat2x2f(.95630,.29237,-.29237,.95630);
 let t=museumGroundLevel(p,613.0,r1,vec2f(.13,.41),footprint,0);
 return clamp(.5+(t.r*.62+t.g*.38-.5)*1.12,0.0,1.0);
}
// Break up the 32 m outer habitat grid into organic hillside contours in 1 smooth tap
// while keeping the fine creek core, river/lake margins and coastal shore unwarped.
// Returns vec3f(warp.x, warp.y, outerSmooth) so both outer cover and flora soften their 32 m grid uniformly.
fn museumOuterWarpWithField(p:vec2f,f:vec4f,h:f32)->vec3f{
 let outer=1.0-terrainFineWeight(p);
 if(outer<=0.0){return vec3f(0.0);}
 let dryLand=smoothstep(8.0,32.0,abs(f.y))*smoothstep(10.0,24.0,h-frame.seaLevel);
 let outerSmooth=outer*dryLand;
 let amp=outerSmooth*58.0;
 if(amp<=.1){return vec3f(0.0,0.0,outerSmooth);}
 const rW=mat2x2f(.89101,.45399,-.45399,.89101);
 let t=textureSampleLevel(museumGroundTex,smpLinearRepeat,(rW*p)*(1.0/480.0)+vec2f(.21,.67),0,2.0);
 return vec3f((t.rg-vec2f(.5))*(2.0*amp),outerSmooth);
}
fn museumOuterWarp(p:vec2f)->vec3f{
 let outer=1.0-terrainFineWeight(p);
 if(outer<=0.0){return vec3f(0.0);}
 return museumOuterWarpWithField(p,creekFieldAt(p),terrainHeightAt(p));
}
fn museumCoverWithWarp(p:vec2f,footprint:f32,ow:vec3f)->vec4f{
 let fineW=terrainFineWeight(p);
 let a=textureSampleLevel(museumFineCover,smpLinearClamp,(p+512.0)/1024.0,max(0.0,log2(max(footprint,0.001)/2.0)));
 // Hardware mip softening on dry outer hillsides dissolves 32 m bilinear checkerboard
 // texels uniformly (never dropping to 0 at warp zero-crossings) before fractal breakup restores detail.
 let outerLod=max(0.0,log2(max(footprint,0.001)/32.0))+ow.z*1.15;
 let b=textureSampleLevel(museumOuterCover,smpLinearClamp,(p+ow.xy+16384.0)/32768.0,outerLod);
 var cover=mix(b,a,fineW);cover.b=b.b;cover.a=max(cover.a,max(museumGroveWeight(p)*.94,${data.field.continuousSample?'museumSampleForest(p)*.92':'0.0'}));return cover;
}
fn museumCover(p:vec2f,footprint:f32)->vec4f{
 return museumCoverWithWarp(p,footprint,museumOuterWarp(p));
}
struct MuseumFloraSample { forms:vec4f, cover:vec4f, wf:vec4f, grove:vec3f, coverFactor:f32, glade:f32, litter:f32, rootFloor:f32 };
fn museumFloraSampleAt(p:vec2f,footprint:f32)->MuseumFloraSample{
 var out:MuseumFloraSample;out.forms=vec4f(0.0);out.cover=vec4f(0.0);out.wf=vec4f(0.0,1e6,0.0,0.0);out.grove=vec3f(0.0);out.coverFactor=1.0;out.rootFloor=-1000.0;
 if(max(abs(p.x),abs(p.y))>16368.0){return out;}
 let f=creekFieldAt(p);let h=terrainHeightAt(p);out.wf=f;
 let lod32=max(0.0,log2(max(footprint,0.001)/32.0));
 var m=textureSampleLevel(museumFlora,smpLinearClamp,(p+16384.0)/32768.0,lod32);
 let marine=m.r;
 let ow=museumOuterWarpWithField(p,f,h);
 if(ow.z>0.001){
  let mw=textureSampleLevel(museumFlora,smpLinearClamp,(p+ow.xy+16384.0)/32768.0,lod32+ow.z*1.15);
  m=vec4f(marine,mw.gba);
 }
 let cov=museumCoverWithWarp(p,footprint,ow);out.cover=cov;m.g=mix(m.g,cov.g,terrainFineWeight(p));
 // The nearest owner may be a lake kilometres away and hundreds of metres
 // above this dry slope. Its level applies only inside its signed-edge support.
 // Blades and the distant ground share this continuous water/bank handover.
 let support=1.0-smoothstep(0.0,2.5,f.y);
 let dry=mix(1.0,smoothstep(.08,.6,h-f.x),mix(support,1.0,museumHabitatReview.legacyWater));m.g*=dry;
 let rise=h-f.x;
 let freshWater=smoothstep(.55,1.55,f.x-frame.seaLevel);
 let bank=1.0-smoothstep(1.5,6.5,abs(f.y));
 let freshBank=freshWater*bank*smoothstep(.08,.38,rise)*(1.0-smoothstep(1.1,2.35,rise));
 let aboveSea=h-frame.seaLevel;
 let strand=smoothstep(.025,.28,marine)*smoothstep(.50,1.12,aboveSea)*(1.0-smoothstep(2.8,5.7,aboveSea));
 let saline=strand*(1.0-freshWater*bank);
 // R admits coastal seed heads. B admits shorter upright shoots on dry
 // freshwater margins and exposed shore. The marsh has jointed rushes.
 m.r=saline;
 let shoreStalks=max(m.b,m.g*.85*(1.0-smoothstep(1.0,12.0,abs(f.y)))*dry)*saline*.58;
 let freshShoots=max(m.b,m.g*.85)*freshBank;
 m.b=max(freshShoots,shoreStalks)*(1.0-museumWetlandSoil(p));
 let grove=museumGroveFloor(p);out.grove=grove;let gk=1.0-grove.x*(.92-grove.y*.30-smoothstep(.6,.9,grove.z)*.30);
 // Fine reconstruction also observes the same world-fixed litter/opening field.
 m.g=mix(m.g,m.g*gk,terrainFineWeight(p));m.a*=1.0-grove.x*.75;
 ${data.field.continuousSample?`let sf=museumSampleField(p);if(sf.y<44.0){
  // Sea-oat seed-head cards are a modern coastal template. This sample uses
  // jointed wet-bank forms instead; bare wet margins share the same field.
  m.b=0.0;let tidal=1.0-smoothstep(.4,3.0,sf.x);let margin=mix(.18,1.35,tidal);
  let retreat=smoothstep(margin,margin+.9,h-sf.x);let support=1.0-smoothstep(2.0,8.0,sf.y);let retreatKeep=mix(1.0,retreat,support);m.g*=retreatKeep;m.a*=retreatKeep;
 }
 let mouthFactor=museumMouthGrassFactor(p,h);m=vec4f(m.r,m.gba*mouthFactor);`:''}
 let tidal=museumMainTidalWeight(p);
 if(tidal>0.0&&aboveSea<10.0){let tidalFactor=mix(1.0,museumTidalGrowth(p,aboveSea),tidal);m=vec4f(m.r,m.gba*tidalFactor);}
 let springKeep=1.0-museumSpringOutcrop(p);m=vec4f(m.r,m.gba*springKeep);
 // A dry opening in the terrace leaves room to see the low animal through
 // the sward without changing its real size. The coarse cover stays intact.
 let clearing=p-vec2f(${LYSTROSAURUS_CLEARING.map(v=>v.toFixed(1)).join(',')});
 let margin=length(clearing)+.65*sin(p.x*.93)*sin(p.y*.81);
 let clearingKeep=mix(.025,1.0,smoothstep(8.0,16.0,margin));m=vec4f(m.r,m.gba*clearingKeep);
 ${data.field.continuousSample?`if(museumHabitatReview.patchCover>0.0){
  // The beach mask already protects open sand. Let a world-fixed pattern
  // interrupt the over-broad 32 m grass channel on the vegetated backshore.
  let dryBackshore=smoothstep(4.0,12.0,h-frame.seaLevel);
  let bankAway=smoothstep(1.5,7.0,abs(f.y));
  let enabled=clamp(museumHabitatReview.patchCover,0.0,1.0);
  let sampleGround=museumSampleGroundAt(p,footprint);
  let pattern=mix(1.0,sampleGround.r,enabled*dryBackshore*bankAway);
  // The G channel was baked from the actual composed 1 m height surface;
  // suppress all ground-flora forms on walls while leaving level banks alone.
  let slope=mix(1.0,sampleGround.g,enabled*sampleGround.b);
  out.coverFactor=pattern*slope;
  m.g*=out.coverFactor;m.b*=out.coverFactor;m.a*=mix(1.0,pattern,.5)*slope;
 }`:''}
 if(cov.b>.001){
  // Decametre openings connect the pigment below the stems with the
  // density of rooted blades. Both samples are static in island coordinates.
  let broad=perlin2(p/57.0+vec2f(14.7,5.2));
  let tuft=perlin2(p/13.7+vec2f(broad*.8,19.3));
  let opening=smoothstep(-.42,.34,broad*.70+tuft*.58);
  let damp=smoothstep(.45,1.5,f.x-frame.seaLevel)*(1.0-smoothstep(.0,1.1,rise))
     *(1.0-smoothstep(.0,14.0,f.y));
  // Open inland tall meadows retain continuous lush waves instead of punching bare holes;
  // coastal strands (<7m), woodland margins and sparse upland slopes keep organic openings.
  let inlandOpen=smoothstep(7.5,16.0,aboveSea);
  let lushOpen=smoothstep(.44,.78,m.g)*(1.0-smoothstep(.12,.45,cov.a))*inlandOpen;
  let pocketFloor=mix(.045,.52,lushOpen)+.075*inlandOpen*(1.0-lushOpen)*(1.0-cov.a);
  let pocket=mix(pocketFloor,1.0,opening)*(1.0-cov.a*.49)*(1.0-damp*.74);
  let keep=mix(1.0,pocket,cov.b);
  m.g*=keep;m.a*=keep;
  out.glade=cov.b*(1.0-opening)*(1.0-lushOpen*.65);
  out.litter=cov.b*cov.a*(1.0-opening*.40);
  out.coverFactor*=keep;
 }
 if(aboveSea<7.0){
  // The designed mouths have their own bank communities. The signed
  // freshwater support takes priority where a higher bank meets the sea.
  let ordinaryCoast=smoothstep(320.0,425.0,length(p-vec2f(-875.0,125.0)))
    *(1.0-smoothstep(.0,.14,museumMainTidalWeight(mix(vec2f(-653.0,3690.0),p,.82))))
    *(1.0-freshWater*(1.0-smoothstep(.15,8.0,f.y)));
  let growth=museumStrandGrowth(p,aboveSea,ordinaryCoast);
  m=vec4f(m.r,m.gba*growth.x);
  out.rootFloor=growth.y;
 }
 if(m.g>.14 && aboveSea>6.0){
  let clumpFade=(1.0-smoothstep(.65,2.6,footprint))*smoothstep(6.0,10.0,aboveSea);
  if(clumpFade>0.0){
   const rC=mat2x2f(.79864,.60182,-.60182,.79864);
   let c=museumGroundLevel(p,180.0,rC,vec2f(.19,.47),footprint,0);
   let rawClump=mix(.85,1.15,smoothstep(.22,.78,c.r*.62+c.g*.38));
   let edgeRamp=smoothstep(.14,.38,m.g);
   m.g=min(1.0,m.g*mix(1.0,rawClump,clumpFade*edgeRamp));
  }
 }
 out.forms=m;return out;
}
fn museumFloraAt(p:vec2f,footprint:f32)->vec4f{return museumFloraSampleAt(p,footprint).forms;}
fn museumMeadowFromBroad(p:vec2f,broad:f32)->MeadowTone{
 let dry=smoothstep(.18,.82,broad);
 var tone:MeadowTone;tone.tone=mix(${srgb(.25,.30,.15)},${srgb(.37,.38,.23)},dry*.72);tone.dry=dry*.55;tone.lush=1.0-dry;
 let upland=museumDryGrassTone(p);let heath=museumCoolGrassTone(p);
 tone.tone=mix(tone.tone,${srgb(.41,.36,.27)},upland*.52);tone.tone=mix(tone.tone,${srgb(.32,.36,.30)},heath*.72);return tone;
}
fn museumMeadowAt(p:vec2f,footprint:f32)->MeadowTone{
 // Shared identically by rooted blades and distant slopes via the same 613 m field.
 return museumMeadowFromBroad(p,museumMacroField(p,footprint));
}
struct MuseumSward { albedo:vec3f, relief:f32 };
fn museumMeadowSoil(tone:vec3f)->vec3f{return mix(tone*.75,${srgb(.29,.28,.22)},.55);}
fn museumSwardTerrain(
 p:vec3f,footprint:f32,reliefFootprint:f32,gustOffset:vec2f,visible:bool,
 flora:MuseumFloraSample,m:vec4f,d:vec4f,orgB:vec4f,gf:MuseumGroundField,
 normalY:f32,terrainAO:f32,
)->MuseumSward{
 var out:MuseumSward;
 if(!visible){return out;}
 // Reuse gf.broad directly (exact match with museumMeadowAt, 0 extra fetches).
 let mt=museumMeadowFromBroad(p.xz,gf.broad);let density=flora.forms.g;
 let fine=1.0-smoothstep(.022,.11,reliefFootprint);
 let middle=1.0-smoothstep(.25,.90,reliefFootprint);
 let broadFiltered=clamp(gf.broad*.55+gf.zone*.27+gf.meso*.18,0.0,1.0);
 let clump=mix(broadFiltered,gf.fbm*.56+gf.gran*.44,middle*.72);
 // Cover and colour belong to the world, independent of the camera's pitch
 // or grass rendering radius. Only unresolved detail is footprint-filtered.
 let slope=clamp(1.0-normalY,0.0,1.0);
 let hollow=clamp((.86-terrainAO)*2.2,0.0,1.0);
 let lushPocket=smoothstep(.44,.82,(1.0-gf.dry)*.48+hollow*.38+(1.0-gf.fbm)*.24);
 let strawPatch=smoothstep(.48,.84,gf.dry*.42+gf.fbm*.34+slope*.45+(gf.grit-.5)*.28);
 var lawnTone=mix(mt.tone,mt.tone*vec3f(.87,.94,.82),lushPocket*.24);
 lawnTone=mix(lawnTone,mix(mt.tone,${srgb(.43,.38,.23)},.40),strawPatch*.30);
 let toCam=frame.cameraPos-p;
 let camDist=length(toCam);
 let invCamDist=1.0/max(camDist,1e-4);
 // Distant tussock contrast grows smoothly where blades thin out (Tidewater
 // handover contract) while staying 100% driven by hardware-mipmapped isotropic channels.
 let clumpK=mix(.28,.62,smoothstep(42.0,155.0,camDist));
 var lawn=lawnTone*(1.0+(clump-.5)*clumpK+(gf.gran-.5)*.22+(gf.grit-.5)*.10);
 let windP=p.xz-gustOffset;
 const rW=mat2x2f(.88295,.46947,-.46947,.88295);
 let gustW=textureSampleLevel(museumGroundTex,smpLinearRepeat,(rW*windP)*(1.0/360.0)+vec2f(.11,.37),0,2.0).r;
 let gust=smoothstep(.46,.68,gustW)*clamp(frame.windSpeed*.05,0.0,.35);
 lawn=mix(lawn,lawn*vec3f(1.14,1.12,1.04),gust*.48);
 let soilTone=museumMeadowSoil(mt.tone);
 var base=soilTone*(1.0+(broadFiltered-.5)*.20)*(1.0+(gf.fbm-.5)*.22*middle)*(1.0+(gf.gran-.5)*.24+(gf.grit-.5)*.14);
 // A thin sward exposes soil, dry litter and small clumps gradually. Soft
 // breakup feathers outer transitions without sharp blotch contours.
 let outer=1.0-terrainFineWeight(p.xz);
 let edgeOrganic=(gf.fbm-.5)*.36*outer*smoothstep(.008,.24,density);
 let spatialCover=smoothstep(.004,.40,density+edgeOrganic);
 // Harmonize ground beneath 3D grass blades with their shaded root bases (matching
 // Tidewater's swardBase handover) so blades root naturally without pale floor glare,
 // and deepen inter-tussock gaps beyond the grass radius so hills never turn flat.
 var fieldK=0.0;
 if(camDist<museumGrassDistance.fade.y){
  fieldK=(1.0-smoothstep(museumGrassDistance.fade.x*.74,museumGrassDistance.fade.y*.98,camDist))*spatialCover;
  let swardBase=mix(mt.tone*.56,soilTone*.80,.36)*(1.0+(gf.gran-.5)*.24+(gf.grit-.5)*.12);
  lawn=mix(lawn,swardBase,fieldK*.54);
 }
 let gapK=smoothstep(.60,.24,clump)*smoothstep(28.0,125.0,camDist)*spatialCover*(1.0-fieldK*.6);
 lawn=mix(lawn,soilTone*.76,gapK*.34);
 let graze=smoothstep(.45,.08,abs(toCam.y*invCamDist))*spatialCover;
 lawn=mix(lawn,lawn*vec3f(1.03,1.07,.93),graze*.34);
 let dryThatch=mix(mt.tone*.78,${srgb(.36,.34,.23)},.26);
 base=mix(base,dryThatch,(1.0-spatialCover)*(1.0-flora.coverFactor)*.64);
 let thatch=mix(${srgb(.29,.27,.17)},${srgb(.42,.38,.24)},clump);
 base=mix(base,thatch,flora.glade*.46);
 let humus=mix(${srgb(.19,.16,.115)},${srgb(.32,.27,.19)},mix(broadFiltered,gf.fbm*.52+gf.gran*.48,middle));
 lawn=mix(lawn,humus,flora.litter*.38);
 base=mix(base,humus,flora.litter*.90);
 out.albedo=mix(base,lawn,spatialCover);
 // Fine close-range tussock relief complements the hardware-mipmapped normal.
 out.relief=(gf.gran-.5)*.024*fine*spatialCover;
 return out;
}
fn museumSward(p:vec3f,footprint:f32,gustOffset:vec2f,visible:bool)->MuseumSward{
 let px=dpdx(p.xz);let py=dpdy(p.xz);
 let flora=museumFloraSampleAt(p.xz,footprint);
 let gf=museumGroundField(p.xz,px,py,footprint);
 let m=vec4f(.411,.370,.455,clamp(.498+(gf.fbm-.5)*.38,0.0,1.0));
 let d=vec4f(.411,clamp(.370+(gf.gran-.5)*.36,0.0,1.0),.455,clamp(.498+(gf.fbm-.5)*.38,0.0,1.0));
 return museumSwardTerrain(p,footprint,footprint,gustOffset,visible,flora,m,d,d,gf,1.0,.85);
}
fn museumGrassGround(p:vec2f)->f32{return terrainHeightAt(p)-.035;}
`});
 const setRoamingGround = pixels => {coarse.upload(pixels);generateMipmaps(coarse);};
 return {module,density,counts,distance,review,strand,setRoamingGround,groundCover:groundCover.stats,description:'moisture/613m macro tones with warped detail, region palettes; 2m sample ground mosaic shared by ground and blades; signed water support'};
}
