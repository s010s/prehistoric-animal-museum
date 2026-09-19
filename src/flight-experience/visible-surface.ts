import type { TerrainStream } from './terrain-stream'
import { visibleWaterHeight } from './hydrology/water-surface'
import { type WorldSampler } from './world'
/** The renderer's committed triangle surface is the authority, not the analytic
 * carving function. Collision clearance is explicit and kept outside this contract. */
export class VisibleSurfaceSnapshot {
 readonly worldKey:string
 constructor(private readonly terrain:TerrainStream,private readonly world:WorldSampler){this.worldKey=JSON.stringify(world.config)}
 sample(x:number,z:number){
  const step=this.terrain.resident.has(`${Math.floor(x/512)},${Math.floor(z/512)}`)?128:64,minX=Math.floor(x/step)*step,minZ=Math.floor(z/step)*step
  const height=this.terrain.displayedHeight(x,z),e=.25
  const dx=this.terrain.displayedHeight(x-e,z)-this.terrain.displayedHeight(x+e,z),dz=this.terrain.displayedHeight(x,z-e)-this.terrain.displayedHeight(x,z+e),length=Math.hypot(dx,2*e,dz)
  return{worldKey:this.worldKey,coverageRect:{minX,minZ,maxX:minX+step,maxZ:minZ+step},surfaceId:this.terrain.surfaceIdentity(x,z),regionRevision:this.terrain.surfaceIdentity(x,z),height,normal:[dx/length,2*e/length,dz/length] as const,waterHeight:visibleWaterHeight(this.world,x,z)}
 }
 height=(x:number,z:number)=>this.terrain.displayedHeight(x,z)
}
