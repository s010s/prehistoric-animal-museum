import type { WorldSampler } from './world'
function riverCell(world:WorldSampler,x:number,z:number){const q=world.river.query(x+32,z+32);return q!==null&&q.signedBankDistance<64}
/** Fine cells only along the finite watercourse. Adjacent coarse cells inherit the
 * same edge subdivisions; all tile borders keep the near terrain's 8m contract. */
export function farCellTopology(world:WorldSampler,x:number,z:number){
 const xz:number[]=[],indices:number[]=[]
 if(riverCell(world,x,z)){
  for(let row=0;row<=8;row++)for(let col=0;col<=8;col++)xz.push(col*8,row*8)
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){const i=row*9+col;indices.push(i,i+9,i+1,i+1,i+9,i+10)}
 }else{
  xz.push(32,32)
  const sides=[[0,0,0,64,-64,0],[0,64,64,64,0,64],[64,64,64,0,64,0],[64,0,0,0,0,-64]]
  for(const [ax,az,bx,bz,dx,dz] of sides as [number,number,number,number,number,number][]){
   const fine=(ax===bx?(x+ax)%512===0:(z+az)%512===0)||riverCell(world,x+dx,z+dz),n=fine?8:1
   for(let i=0;i<n;i++)xz.push(ax+(bx-ax)*i/n,az+(bz-az)*i/n)
  }
  const count=xz.length/2;for(let i=1;i<count;i++)indices.push(0,i,i===count-1?1:i+1)
 }
 return {xz,indices}
}
const caches=new WeakMap<WorldSampler,Map<string,{xz:number[];indices:number[];heights:number[]}>>()
export function farSurfaceHeight(world:WorldSampler,x:number,z:number){
 const cx=Math.floor(x/64)*64,cz=Math.floor(z/64)*64,key=`${cx},${cz}`
 let cache=caches.get(world);if(!cache){cache=new Map();caches.set(world,cache)}
 let cell=cache.get(key);if(!cell){const topology=farCellTopology(world,cx,cz);cell={...topology,heights:Array.from({length:topology.xz.length/2},(_,i)=>world.terrainAt(cx+topology.xz[i*2]!,cz+topology.xz[i*2+1]!).height)};if(cache.size>=2048)cache.delete(cache.keys().next().value!);cache.set(key,cell)}
 const px=x-cx,pz=z-cz
 for(let i=0;i<cell.indices.length;i+=3){const A=cell.indices[i]!,B=cell.indices[i+1]!,C=cell.indices[i+2]!,ax=cell.xz[A*2]!,az=cell.xz[A*2+1]!,bx=cell.xz[B*2]!,bz=cell.xz[B*2+1]!,dx=cell.xz[C*2]!,dz=cell.xz[C*2+1]!,den=(bz-dz)*(ax-dx)+(dx-bx)*(az-dz),a=((bz-dz)*(px-dx)+(dx-bx)*(pz-dz))/den,b=((dz-az)*(px-dx)+(ax-dx)*(pz-dz))/den,c=1-a-b;if(a>=-1e-7&&b>=-1e-7&&c>=-1e-7)return cell.heights[A]!*a+cell.heights[B]!*b+cell.heights[C]!*c}
 return cell.heights[0]!
}
