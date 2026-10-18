// Shared museum ground/plant representation, using Tidewater's palette and
// multi-scale handover contract. Botanical forms are visual placeholders.
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {coveShadingWGSL} from './ShallowCove.js';
import {groveModule,groveWeight,groveOpening,grovePathDistance,grovePatch} from './GroveDesign.js';
import {terrainShadingModule,srgb} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {createGrassDistance} from './GrassDistance.js';
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
  mask.data[k+2]=Math.round(v*damp*.8*255);
  // Sparse woodland groundcover; the native bright beach creeper must not be
  // distributed across every inland meadow simply because it has woodland.
  mask.data[k+3]=Math.round(v*(.018+wood*.13)*255);
  const gw=groveWeight(x,z),gap=Math.max(groveOpening(x,z),1-smooth(1.5,3.4,grovePathDistance(x,z)));
  const keep=1-gw*(.92-gap*.30-smooth(.6,.9,grovePatch(x,z))*.30);
  for(let c=1;c<4;c++)mask.data[k+c]=Math.round(mask.data[k+c]*keep);
  counts.meadow++;if(mask.data[k+2]>8)counts.upright++;if(mask.data[k+3]>8)counts.groundcover++;
 }
 const make=(label,res,bytes)=>{const t=new Texture({label,width:res,height:res,format:'rgba8unorm',data:bytes,mips:true,usage:['sample','copyDst'],sampler:'linearClamp'});t.getGPU();generateMipmaps(t);return t;};
 // GPU-only spare R stores ocean connectivity. Do not expose it to native
 // CPU grass occupancy or its dune-grass selector; those retain their zero R.
 const densityBytes=new Uint8Array(mask.data),wf=[0,0,0,0];
 for(let j=0;j<mask.res;j++)for(let i=0;i<mask.res;i++){
  const x=-16384+(i+.5)*32768/mask.res,z=-16384+(j+.5)*32768/mask.res;
  let marine=data.cove.continuous.marineAt(x,z);if(marine>0){data.field.sample(x,z,wf);if(wf[1]<2&&wf[0]>-.1)marine=0;}
  densityBytes[(j*mask.res+i)*4]=Math.round(marine*255);
 }
 const fine=make('Museum creek habitat',g.maskRes,data.masks),coarse=make('Museum watershed habitat',data.island.maskRes,data.islandMasks),density=make('Museum multi-form ground cover + marine connectivity',mask.res,densityBytes);
 const review=new UniformBlock('MuseumHabitatReview',{legacyWater:['f32',0]});
 const module=new ShaderModule({name:'museumMeadow',deps:[terrainGPU.module,terrainShadingModule(),data.field.module,groveModule,distance.module],uniforms:review,uniformName:'museumHabitatReview',bindings:{museumFineCover:{texture:fine},museumOuterCover:{texture:coarse},museumFlora:{texture:density}},code:`
${coveShadingWGSL}
fn museumCover(p:vec2f,footprint:f32)->vec4f{
 let a=textureSampleLevel(museumFineCover,smpLinearClamp,(p+512.0)/1024.0,max(0.0,log2(max(footprint,0.001)/2.0)));
 let b=textureSampleLevel(museumOuterCover,smpLinearClamp,(p+16384.0)/32768.0,max(0.0,log2(max(footprint,0.001)/32.0)));
 var cover=mix(b,a,terrainFineWeight(p));cover.a=max(cover.a,museumGroveWeight(p)*.94);return cover;
}
fn museumFloraAt(p:vec2f,footprint:f32)->vec4f{
 if(max(abs(p.x),abs(p.y))>16368.0){return vec4f(0.0);}
 var m=textureSampleLevel(museumFlora,smpLinearClamp,(p+16384.0)/32768.0,max(0.0,log2(max(footprint,0.001)/32.0)));m.r=0.0;
 let cov=museumCover(p,footprint);m.g=mix(m.g,cov.g,terrainFineWeight(p));
 // The nearest owner may be a lake kilometres away and hundreds of metres
 // above this dry slope. Its level applies only inside its signed-edge support.
 // Blades and the distant ground share this continuous water/bank handover.
 let f=creekFieldAt(p);let h=terrainHeightAt(p);
 let support=1.0-smoothstep(0.0,2.5,f.y);
 let dry=mix(1.0,smoothstep(.08,.6,h-f.x),mix(support,1.0,museumHabitatReview.legacyWater));m.g*=dry;
 let damp=(1.0-smoothstep(1.0,12.0,abs(f.y)))*dry;
 m.b=max(m.b,m.g*damp*.85);
 let grove=museumGroveFloor(p);let gk=1.0-grove.x*(.92-grove.y*.30-smoothstep(.6,.9,grove.z)*.30);
 // Fine reconstruction also observes the same world-fixed litter/opening field.
 m.g=mix(m.g,m.g*gk,terrainFineWeight(p));m.a*=1.0-grove.x*.75;m.gba*=1.0-museumSpringOutcrop(p);return m;
}
fn museumMeadowAt(p:vec2f,footprint:f32)->MeadowTone{
 let a=mat2x2f(.764842187,.644217687,-.644217687,.764842187)*p/173.0;
 let b=mat2x2f(-.504846105,.863209367,-.863209367,-.504846105)*p/47.0;
 let ma=textureSampleLevel(terrainDetailTex,smpLinearRepeat,a,max(0.0,log2(max(footprint,.001)*512.0/173.0))).w;
 let mb=textureSampleLevel(terrainDetailTex,smpLinearRepeat,b,max(0.0,log2(max(footprint,.001)*512.0/47.0))).w;
 // Broad, low-contrast moisture variation. Native tropical threshold bands
 // amplified repeating detail tiles when seen across kilometres of bare slope.
 let broad=textureSampleLevel(terrainDetailTex,smpLinearRepeat,p/613.0+vec2f(mb,ma)*.13,max(0.0,log2(max(footprint,.001)*512.0/613.0))).w;
 let dry=smoothstep(.32,.78,ma*.35+mb*.25+broad*.4);
 var tone:MeadowTone;tone.tone=mix(${srgb(.25,.30,.15)},${srgb(.37,.38,.23)},dry*.7);tone.dry=dry*.55;tone.lush=1.0-dry;
 let sx=p.x-2000.0;let sz=p.y-650.0;
 let upland=exp(-dot((vec2f(sx,sz)-vec2f(3000.0,-200.0))/vec2f(1400.0,1700.0),(vec2f(sx,sz)-vec2f(3000.0,-200.0))/vec2f(1400.0,1700.0)));
 let heath=exp(-dot((vec2f(sx,sz)-vec2f(1600.0,-5930.0))/vec2f(2300.0,2100.0),(vec2f(sx,sz)-vec2f(1600.0,-5930.0))/vec2f(2300.0,2100.0)));
 tone.tone=mix(tone.tone,${srgb(.41,.36,.27)},upland*.52);tone.tone=mix(tone.tone,${srgb(.32,.36,.30)},heath*.72);return tone;
}
struct MuseumSward { albedo:vec3f, relief:f32 };
fn museumSward(p:vec3f,N:vec3f,footprint:f32,gustOffset:vec2f)->MuseumSward{
 let mt=museumMeadowAt(p.xz,footprint);let density=museumFloraAt(p.xz,footprint).g;
 // Continuous, world-fixed sward: resolved leaf detail gives way to broad
 // non-periodic clumps before it becomes a subpixel repeated lattice.
 let r=mat2x2f(.267499,.963558,-.963558,.267499);
 let warp=vec2f(perlin2(p.xz/71.3),perlin2(p.xz/59.1+27.0));
 let dN=textureSample(terrainDetailTex,smpAniso4Repeat,(p.xz+warp*.65)/1.9);
 let dM=textureSample(terrainDetailTex,smpAniso4Repeat,r*(p.xz+warp*3.2)/6.7+.21);
 let dF=textureSample(terrainDetailTex,smpAniso4Repeat,mat2x2f(-.737394,.675463,-.675463,-.737394)*p.xz/.63+.53);
 let fine=1.0-smoothstep(.018,.12,footprint);
 // The texture's mip chain already removes subpixel grain. Keep metre-scale
 // clumps until they too become subpixel, rather than flattening them at 0.65m.
 let middle=1.0-smoothstep(.4,1.4,footprint);
 let broad=clamp(.5+perlin2(p.xz/13.7+warp*.9)*.45,0.0,1.0);
 let broadFiltered=mix(.5,broad,1.0-smoothstep(2.0,8.0,footprint));
 let clump=mix(broadFiltered,dM.w*.6+dN.y*.4,middle*.7);
 // Cover and colour belong to the world, independent of the camera's pitch
 // or grass rendering radius. Only unresolved detail is footprint-filtered.
 var lawn=mt.tone*(1.0+(clump-.5)*.36)*(1.0+(dF.y-.4)*.08*fine);
 let along=dot(p.xz,frame.windDir);let across=dot(p.xz,vec2f(-frame.windDir.y,frame.windDir.x));
 let comb=textureSample(terrainDetailTex,smpAniso4Repeat,vec2f(along/7.5,across/.9)+vec2f(.31,.77)).w;
 lawn*=1.0+(comb-.5)*.10*fine;
 let windP=p.xz-gustOffset;
 let gustA=textureSample(terrainDetailTex,smpAniso4Repeat,windP/140.0).w;
 let gustB=textureSample(terrainDetailTex,smpAniso4Repeat,windP/61.0+.37).w;
 let gust=smoothstep(.46,.6,gustA*.62+gustB*.38)*clamp(frame.windSpeed*.05,0.0,.35);
 lawn=mix(lawn,lawn*vec3f(1.14,1.12,1.04),gust*.5);
 let base=mix(mt.tone*.75,${srgb(.29,.28,.22)},.55)*(1.0+(dN.y-.45)*.22)*(1.0+(dF.y-.4)*.08*fine);
 // A thin sward exposes soil, dry litter and small clumps gradually. This is
 // the same continuous density that decides the world-fixed blade presence.
 let spatialCover=smoothstep(.008,.36,density);
 var out:MuseumSward;out.albedo=mix(base,lawn,spatialCover);
 // Centimetre-scale tussock relief succeeds distant blades in the native
 // surface-gradient normal. Broad warped clumps survive; subpixel detail fades.
 out.relief=(clump-.5)*.085*middle*spatialCover;
 return out;
}
fn museumGrassGround(p:vec2f)->f32{return terrainHeightAt(p)-.035;}
`});
 return {module,density,counts,distance,review,description:'moisture/613m macro tones with warped detail, region palettes; low, tall, upright and woodland cover; signed water support shared by ground and blades'};
}
