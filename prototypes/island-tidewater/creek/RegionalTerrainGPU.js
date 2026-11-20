import {bakeTerrainMaps} from '../vendor/tidewater/src/world/terrain/TerrainBake.js';

export function packRegionalTerrain(patches) {
  const n = 1024, heights = new Float32Array(n * n), normals = new Uint8Array(n * n * 4);
  for (const {heights:source, offset:[x, z], res, ...patch} of patches) {
    const normal = bakeTerrainMaps({...patch, res, heights:source}).normal;
    for (let j = 0; j < res; j++) {
      const index = (z + j) * n + x;
      heights.set(source.subarray(j * res, (j + 1) * res), index);
      normals.set(normal.subarray(j * res * 4, (j + 1) * res * 4), index * 4);
    }
  }
  return {heights, normals};
}

export function regionalTerrainShader(patches, layer) {
  const f = n => n.toFixed(2);
  const vec = v => 'vec2f(' + v.map(f).join(',') + ')';
  const extent = [Math.min(...patches.map(p => p.center[0] - p.outer)), Math.max(...patches.map(p => p.center[0] + p.outer))];
  const search = zPositive => patches.map(p => {
    if ((p.center[1] >= 0) !== zPositive) return '';
    return `{let q=p-${vec(p.center)};let d=max(abs(q.x),abs(q.y));if(d<${f(p.outer)}){
       return MuseumRegional(q,${vec(p.offset)},${f(p.size)},${f(p.res)},1.0-smoothstep(${f(p.inner)},${f(p.outer)},d));
    }}`;
  }).join('\n');
  const height = `
struct MuseumRegional { q:vec2f, offset:vec2f, span:f32, res:f32, weight:f32 };
fn museumRegional(p:vec2f)->MuseumRegional {
 if(p.x>${f(extent[0])}&&p.x<${f(extent[1])}){
  if(p.y>=0.0){${search(true)}}else{${search(false)}}
 }
 return MuseumRegional(vec2f(0.0),vec2f(0.0),1.0,1.0,0.0);
}
fn museumRegionalHeight(r:MuseumRegional)->f32 {
 let f=clamp((r.q+r.span*.5)/r.span*r.res-.5,vec2f(0.0),vec2f(r.res-1.001));
 let q=vec2i(floor(f)+r.offset);let t=fract(f);
 return mix(mix(textureLoad(terrainFineHeightTex,q,${layer},0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,0),${layer},0).x,t.x),
            mix(textureLoad(terrainFineHeightTex,q+vec2i(0,1),${layer},0).x,textureLoad(terrainFineHeightTex,q+vec2i(1,1),${layer},0).x,t.x),t.y);
}`;
  // Hill clearance extracts the height functions for a compute shader with
  // height bindings only. Keep the filtered normal function out of that slice.
  const normal = `
fn museumRegionalNormal(r:MuseumRegional,lod:f32)->vec4f {
 let tc=(r.q+r.span*.5)/r.span*r.res;
 // Bounded mips and an eight-texel inset prevent sampling a neighbouring tile.
 return textureSampleLevel(terrainFineNormalTex,smpLinearClamp,(clamp(tc,vec2f(8.0),vec2f(r.res-8.0))+r.offset)/1024.0,${layer},clamp(lod,0.0,3.0));
}`;
  return {height, normal};
}
