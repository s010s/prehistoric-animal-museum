import { SEA_LEVEL, type WorldSampler } from '../world'
export const WATER_GRID_STEP=4
export function waterVertex(world:WorldSampler,x:number,z:number){
 // Keep the level surface beneath both banks; taper only inside dry ground.
 // Tapering at the visible bank makes the terrain and water meshes cut a sawtooth shoreline.
 const q=world.river.query(x,z),b=q?Math.max(0,Math.min(1,1-(q.signedBankDistance-8)/8)):0,blend=b*b*(3-2*b)
 return {height:q?SEA_LEVEL+(q.waterLevel-SEA_LEVEL)*blend:SEA_LEVEL,flow:[q?.flow.x??0,q?.flow.z??0,(q?.speed??0)*blend]}
}
/** Exact barycentric query of the published Cartesian water triangles. */
export function visibleWaterHeight(world:WorldSampler,x:number,z:number){
 const b=world.river.bounds;if(x<b.minX||x>=b.maxX||z<b.minZ||z>=b.maxZ)return SEA_LEVEL
 const step=WATER_GRID_STEP,cx=Math.floor(x/step)*step,cz=Math.floor(z/step)*step,u=(x-cx)/step,v=(z-cz)/step
 const a=waterVertex(world,cx,cz).height,c=waterVertex(world,cx+step,cz).height,d=waterVertex(world,cx,cz+step).height
 return u+v<=1?a*(1-u-v)+c*u+d*v:c*(1-v)+d*(1-u)+waterVertex(world,cx+step,cz+step).height*(u+v-1)
}
