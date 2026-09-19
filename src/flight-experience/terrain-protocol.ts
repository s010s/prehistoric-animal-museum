import { CHUNK_SIZE, type WorldConfig, createWorldSampler, type Address, type Lod } from './world'
import { terrainTopology, locateTerrainTriangle, topologyLayoutId } from './terrain-patches'
export interface TerrainJob {
  type:'generate';sessionId:number;requestId:number;world:WorldConfig;chunk:Address;lod:Lod
  configHash:'terrain-v1'|'terrain-v2'|'terrain-v3';errorSampling?:boolean;patchIndex?:number
}
export interface TerrainResult extends Omit<TerrainJob,'type'> {
  type:'generated';topologyLayoutId:string;verticesPerPatch:number;patchIndex?:number
  topologyNodes:Int16Array;positions:Float32Array;normals:Float32Array;colors:Float32Array;indices:Uint16Array
  boundaryHeights:Float32Array;coarseHeights:Float32Array;patchErrors:Float32Array
  errorSampleSpacing:4|0;bounds:readonly[number,number,number,number,number,number];generatedInMs:number
}
export function* generateTerrainSteps(job:TerrainJob):Generator<void,TerrainResult>{
  const start=performance.now(),topology=terrainTopology(job.lod),per=topology.verticesPerPatch,patchCount=job.patchIndex===undefined?16:1,count=per*patchCount
  const sampler=createWorldSampler(job.world),positions=new Float32Array(count*3),normals=new Float32Array(count*3),colors=new Float32Array(count*3)
  const indices=new Uint16Array(topology.indices.length*patchCount),coarseHeights=new Float32Array(count),boundaryHeights=new Float32Array(65*4),patchErrors=new Float32Array(16)
  let min=Infinity,max=-Infinity
  for(let localPatch=0;localPatch<patchCount;localPatch++){
    const patch=job.patchIndex??localPatch
    const px=patch%4*128,pz=Math.floor(patch/4)*128
    for(let i=0;i<per;i++){
      const id=localPatch*per+i,x=px+topology.xz[i*2]!,z=pz+topology.xz[i*2+1]!,wx=job.chunk.x*512+x,wz=job.chunk.z*512+z
      const t=sampler.terrainAt(wx,wz),normal=sampler.normalAt(wx,wz)
      // Every patch boundary is the identical true 8m polyline in every level.
      const h=t.height
      positions.set([x,h,z],id*3);normals.set(normal,id*3);coarseHeights[id]=h
      min=Math.min(min,h);max=Math.max(max,h)
      const rock=Math.min(1,Math.max(0,(1-normal[1])*3.8+t.canyonWeight*.35)),sand=Math.max(0,1-Math.abs(t.height-3)/22)
      const green=[.16+t.moisture*.035,.24+t.moisture*.065,.12+t.moisture*.015],stone=[.42,.37,.29],beach=[.58,.51,.36]
      for(let c=0;c<3;c++)colors[id*3+c]=(green[c]!*(1-rock)+stone[c]!*rock)*(1-sand)+beach[c]!*sand
    }
    for(let i=0;i<topology.indices.length;i++)indices[localPatch*topology.indices.length+i]=localPatch*per+topology.indices[i]!
    yield
  }
  const lookup=new Float64Array(6)
  // Dense sampled error covers every patch, edge and ridge crossing at 4m spacing.
  // It is explicitly a sampled maximum, not a global mathematical bound.
  const minX=job.patchIndex===undefined?0:job.patchIndex%4*128,minZ=job.patchIndex===undefined?0:Math.floor(job.patchIndex/4)*128,size=job.patchIndex===undefined?512:128
  if(job.errorSampling!==false)for(let z=minZ;z<=minZ+size;z+=4){for(let x=minX;x<=minX+size;x+=4){
    locateTerrainTriangle(job.lod,x,z,lookup,indices,per,job.patchIndex,topology.nodes)
    const h=positions[lookup[0]!*3+1]!*lookup[3]!+positions[lookup[1]!*3+1]!*lookup[4]!+positions[lookup[2]!*3+1]!*lookup[5]!
    const patch=job.patchIndex??(Math.min(3,Math.floor(z/128))*4+Math.min(3,Math.floor(x/128)))
    patchErrors[patch]=Math.max(patchErrors[patch]!,Math.abs(h-sampler.terrainAt(job.chunk.x*512+x,job.chunk.z*512+z).height))
  }
  yield
  }
  for(let i=0;i<=64;i++){
    boundaryHeights[i]=sampler.terrainAt(job.chunk.x*512+i*8,job.chunk.z*512).height
    boundaryHeights[65+i]=sampler.terrainAt((job.chunk.x+1)*512,job.chunk.z*512+i*8).height
    boundaryHeights[130+i]=sampler.terrainAt(job.chunk.x*512+i*8,(job.chunk.z+1)*512).height
    boundaryHeights[195+i]=sampler.terrainAt(job.chunk.x*512,job.chunk.z*512+i*8).height
  }
  return {...job,type:'generated',topologyLayoutId:topology.id,verticesPerPatch:per,topologyNodes:topology.nodes.slice(),positions,normals,colors,indices,boundaryHeights,coarseHeights,patchErrors,errorSampleSpacing:job.errorSampling===false?0:4,bounds:[0,min,0,CHUNK_SIZE,max,CHUNK_SIZE],generatedInMs:performance.now()-start}
}
export function generateTerrain(job:TerrainJob):TerrainResult{const steps=generateTerrainSteps(job);let next=steps.next();while(!next.done)next=steps.next();return next.value}
export function resultBytes(r:TerrainResult){return r.positions.byteLength+r.normals.byteLength+r.colors.byteLength+r.indices.byteLength+r.boundaryHeights.byteLength+r.coarseHeights.byteLength+r.patchErrors.byteLength+r.topologyNodes.byteLength}
export function validTerrainResult(value:unknown,job:TerrainJob):value is TerrainResult{
  if(!value||typeof value!=='object')return false
  const r=value as Partial<TerrainResult>,per=r.verticesPerPatch??0,vertices=per*(job.patchIndex===undefined?16:1)
  if(r.type!=='generated'||r.patchIndex!==job.patchIndex||r.sessionId!==job.sessionId||r.requestId!==job.requestId||r.lod!==job.lod||r.chunk?.x!==job.chunk.x||r.chunk?.z!==job.chunk.z||r.configHash!==job.configHash||JSON.stringify(r.world)!==JSON.stringify(job.world)||r.topologyLayoutId!==topologyLayoutId(job.lod)||per<65||per>3000)return false
  for(const array of [r.positions,r.normals,r.colors])if(!(array instanceof Float32Array)||array.length!==vertices*3||!array.every(Number.isFinite))return false
  if(!(r.topologyNodes instanceof Int16Array)||r.topologyNodes.length<256||r.topologyNodes.length%4!==0||!(r.indices instanceof Uint16Array))return false
  const nodes=r.topologyNodes,count=nodes.length/4,triangles=r.indices.length/3/(job.patchIndex===undefined?16:1)
  for(let i=0;i<count;i++){
    const edge=nodes[i*4]!,left=nodes[i*4+1]!,right=nodes[i*4+2]!,triangle=nodes[i*4+3]!
    if(edge===-1){if(triangle<0||triangle>=triangles)return false}
    else if(edge<0||edge>2||left<=i||right<=i||left>=count||right>=count)return false
  }
  return r.indices instanceof Uint16Array&&r.indices.length>0&&r.indices.length%(job.patchIndex===undefined?48:3)===0&&r.indices.every(i=>i<vertices)&&r.coarseHeights instanceof Float32Array&&r.coarseHeights.length===vertices&&r.coarseHeights.every(Number.isFinite)&&r.boundaryHeights instanceof Float32Array&&r.boundaryHeights.length===260&&r.boundaryHeights.every(Number.isFinite)&&r.patchErrors instanceof Float32Array&&r.patchErrors.length===16&&r.patchErrors.every(Number.isFinite)&&r.topologyNodes instanceof Int16Array&&r.topologyNodes.length>=256&&r.topologyNodes.length%4===0&&r.errorSampleSpacing===(job.errorSampling===false?0:4)&&Array.isArray(r.bounds)&&r.bounds.length===6&&r.bounds.every(Number.isFinite)&&Number.isFinite(r.generatedInMs)
}
