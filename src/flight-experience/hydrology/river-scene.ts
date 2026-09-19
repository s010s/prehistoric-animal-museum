import { BufferAttribute, BufferGeometry, Group, Mesh, type ShaderMaterial } from 'three'
import { waterVertex, WATER_GRID_STEP } from './water-surface'
import { type Address, type WorldSampler } from '../world'
/** Water-only replacement rectangle. Ground is exclusively TerrainStream's mesh.
 * Cartesian cells cannot fold on a bend; its border is exactly the ocean plane. */
export class RiverScene {
 readonly root=new Group()
 busy=true
 error:string|null=null
 ready=false
 private released=false
 private geometry:BufferGeometry|null=null
 private material:ShaderMaterial|null=null
 constructor(private readonly world:WorldSampler,private readonly createMaterial:()=>ShaderMaterial,private readonly publish:(ready:boolean)=>void,wake:()=>void){
  this.root.name='finite-water-owner'
  void this.prepare().catch(e=>{this.error=String(e)}).finally(()=>{this.busy=false;wake()})
 }
 private async prepare(){
  const b=this.world.river.bounds,step=WATER_GRID_STEP,nx=Math.round((b.maxX-b.minX)/step)+1,nz=Math.round((b.maxZ-b.minZ)/step)+1
  const positions=new Float32Array(nx*nz*3),flow=new Float32Array(nx*nz*3),indices:number[]=[]
  for(let z=0;z<nz;z++){
   if(this.released)return
   for(let x=0;x<nx;x++){
    const wx=b.minX+x*step,wz=b.minZ+z*step,i=z*nx+x,vertex=waterVertex(this.world,wx,wz)
    positions.set([wx,vertex.height,wz],i*3);flow.set(vertex.flow,i*3)
    if(z<nz-1&&x<nx-1)indices.push(i,i+nx,i+1,i+1,i+nx,i+nx+1)
   }
   if(z%8===7)await new Promise<void>(resolve=>setTimeout(resolve,0))
  }
  if(this.released)return
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('waterFlow',new BufferAttribute(flow,3));geometry.setIndex(indices);geometry.computeBoundingSphere()
  const material=this.createMaterial(),mesh=new Mesh(geometry,material);mesh.receiveShadow=true
  // One synchronous ownership transfer after every required resource exists.
  this.geometry=geometry;this.material=material;this.root.add(mesh);this.ready=true;this.publish(true)
 }
 relocate(origin:Address){this.root.position.set(-origin.x,0,-origin.z)}
 dispose(){if(this.released)return;this.released=true;this.publish(false);this.ready=false;this.root.removeFromParent();this.geometry?.dispose();this.material?.dispose();this.root.clear()}
}
