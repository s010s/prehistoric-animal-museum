// Museum application geography revision. The previous prototype stays read-only.
// Evaluate its continuous landform with weaker quantized shelves and ribs,
// then protect water, animals and visitor paths with continuous weights.
export const reliefRevision={id:'museum-relief-v1',shelfStrength:[.82,.10],buttressMetres:[36,16],fissureMetres:[42,22],protected:'sea/beach below 8m; river +20–55m; spring +8–26m; animal sites 30–60m; visitor paths'};
const fieldPath='/prototypes/island-exploration/field.js';
export function museumReliefPlugin(){return {name:'museum-owned-relief',transform(code,id){
  if(!id.includes('/prototypes/island-exploration/field.js?museum-relief-v1'))return;
  for(const [before,after]of [
    ['h+=(ledge-h)*.82*rockWeight;','h+=(ledge-h)*.10*rockWeight;'],
    ['h+=((buttress-.5)*36-fissure*42)*rockWeight;','h+=((buttress-.5)*16-fissure*22)*rockWeight;'],
  ]){if(!code.includes(before))throw Error('Original museum landform seam changed: '+before);code=code.replace(before,after);}
  return {code,map:null};
}};}
export async function loadMuseumSampler(server){
  const original=await server.ssrLoadModule(fieldPath),revised=await server.ssrLoadModule(fieldPath+'?museum-relief-v1');
  const springs=await server.ssrLoadModule('/prototypes/island-exploration/spring.js');
  const habitat=await server.ssrLoadModule('/prototypes/island-exploration/habitat.js');
  const smooth=original.smooth;
  const height=(x,z)=>{
    const old=original.terrainHeight(x,z);
    let keep=1-smooth(8,22,old);
    const bank=Math.abs(x-original.riverX(z))-original.halfWidth(z)-25;
    keep=Math.max(keep,1-smooth(20,55,bank));
    const spring=springs.springAt(x,z);
    if(spring?.forest)keep=Math.max(keep,1-smooth(8,26,spring.edge));
    for(const p of [original.encounter,original.companion])keep=Math.max(keep,1-smooth(30,60,Math.hypot(x-p.x,z-p.z)));
    keep=Math.max(keep,smooth(0,.03,habitat.trailWeight(x,z)));
    if(keep>=1)return old;
    return old+(revised.terrainHeight(x,z)-old)*(1-keep);
  };
  const slopeAt=(x,z)=>1/Math.hypot((height(x+2,z)-height(x-2,z))/4,1,(height(x,z+2)-height(x,z-2))/4);
  return {...original,terrainHeight:height,slopeAt,sourceTerrainHeight:original.terrainHeight,relief:reliefRevision};
}
