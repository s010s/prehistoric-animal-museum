import type { TerrainResult } from './terrain-protocol'
import { locateTerrainTriangle } from './terrain-patches'
export interface DisplayedSurface {result:TerrainResult;morph:number;startNormals:Float32Array;startColors:Float32Array;vertexBlend?:Float32Array}
const lookup=new Float64Array(6)
/** Hot/cold height query uses analytic parent-triangle descent; no arrays or maps are allocated. */
export function sampleDisplayedHeight(surface:DisplayedSurface,x:number,z:number):number{
  const r=surface.result;locateTerrainTriangle(r.lod,x,z,lookup,r.indices,r.verticesPerPatch,r.patchIndex,r.topologyNodes)
  let height=0
  for(let k=0;k<3;k++){const id=lookup[k]!,m=surface.vertexBlend?.[id]??surface.morph;height+=(r.coarseHeights[id]!*(1-m)+r.positions[id*3+1]!*m)*lookup[k+3]!}
  return height
}
/** Full attributes are requested only for preparing a surface transition. */
export function sampleDisplayed(surface:DisplayedSurface,x:number,z:number){
  const r=surface.result;locateTerrainTriangle(r.lod,x,z,lookup,r.indices,r.verticesPerPatch,r.patchIndex,r.topologyNodes)
  let height=0;const normal=[0,0,0],color=[0,0,0]
  for(let k=0;k<3;k++){
    const id=lookup[k]!,weight=lookup[k+3]!,m=surface.vertexBlend?.[id]??surface.morph
    height+=(r.coarseHeights[id]!*(1-m)+r.positions[id*3+1]!*m)*weight
    for(let c=0;c<3;c++){normal[c]!+=(surface.startNormals[id*3+c]!*(1-m)+r.normals[id*3+c]!*m)*weight;color[c]!+=(surface.startColors[id*3+c]!*(1-m)+r.colors[id*3+c]!*m)*weight}
  }
  return {height,normal,color}
}
