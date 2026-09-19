import { CLIFF_SAMPLE, landmarkTop, type PropLandmark } from '../props/prop-obstacles'
import { dimensions } from '../props/prop-lod'
import { chunkAt, SEGMENTS, type WorldSampler } from '../world'
/** Two persistent landmarks in the existing coast-to-valley route, not camera-following scenery. */
export function coastValleyLandmarks(world: WorldSampler): PropLandmark[] {
  return [{id:'coast-bluff',x:world.shorelineAt(-450)+42,z:-450,yaw:-.1,scale:1.5},
    {id:'valley-gate',x:world.valleyAt(-1100)+110,z:-1100,yaw:1.05,scale:1.8}].map(p=>({
      ...p,asset:'cliff-0',y:Math.min(world.terrainAt(p.x,p.z).height,...SEGMENTS.map(n=>world.meshHeight(p.x,p.z,n)))-3,
    }))
}
export function scenicRouteAnchors(world: WorldSampler) {
  return [{name:'coast',x:world.coastAt(-450)+80,z:-450}, {name:'valley-mouth',x:world.valleyAt(-1100),z:-1100}, {name:'valley-reveal',x:world.valleyAt(-2200),z:-2200}]
}
/** Small spatial cache for exact asset envelopes; quality never changes collision.
 * The existing conservative terrain envelope is retained, with local landmark additions. */
export function createLandscapeSurface(world: WorldSampler, landmarks: readonly PropLandmark[], visibleHeight?:(x:number,z:number)=>number) {
  const tiles=new Map<string,Map<string,{x:number;z:number;y:number;radius:number}[]>>()
  return (x:number,z:number)=>{
    let top=visibleHeight?Math.max(0,visibleHeight(x,z))+16:world.safeSurface(x,z)
    const cx=Math.floor(x/32),cz=Math.floor(z/32)
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const gx=cx+dx,gz=cz+dz,address=chunkAt(gx*32,gz*32),tileKey=`${address.x},${address.z}`
      let cells=tiles.get(tileKey)
      if(!cells){
        cells=new Map()
        for(const prop of world.scatter(address)){
          const size=dimensions(prop),key=`${Math.floor(prop.x/32)},${Math.floor(prop.z/32)}`
          const bucket=cells.get(key)??[];bucket.push({x:prop.x,z:prop.z,y:prop.y+size.physicalHeight,radius:size.crownRadius});cells.set(key,bucket)
        }
        if(tiles.size>=32)tiles.delete(tiles.keys().next().value!)
        tiles.set(tileKey,cells)
      }
      for(const prop of cells.get(`${gx},${gz}`)??[])if((prop.x-x)**2+(prop.z-z)**2<=prop.radius**2)top=Math.max(top,prop.y+2)
    }
    for(const landmark of landmarks)top=Math.max(top,landmarkTop(landmark,x,z)+2)
    return top
  }
}
export const LANDMARK_BUDGET={count:2,maxRadius:CLIFF_SAMPLE.radius*1.8,maxHeight:CLIFF_SAMPLE.height*1.8}
