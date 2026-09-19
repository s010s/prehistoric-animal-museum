import { makeMaterialTerrain, sampleHeight, type MaterialTrial } from './material-terrain'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, type BufferGeometry, type Material, type Object3D, type PerspectiveCamera, type Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { loadLookdevMaterials } from './material-library'
const candidateUrls=import.meta.glob<string>('../assets/ecology-r5/*.glb',{eager:true,query:'?url',import:'default'})
/** 256m isolated review stage. Uses the runtime environment; never scatters new assets globally. */
export class LookdevScene {
 readonly root=new Group()
 private readonly owned: Object3D[]=[]
 private library:Awaited<ReturnType<typeof loadLookdevMaterials>>|null=null
 private released=false
 busy=true
 error:string|null=null
 candidateAvailable=false
 readonly origin={x:0,y:620,z:0}
 private selected=new URLSearchParams(location.search).get('flightMaterialScene')==='1'?'material-scene':'tree-0-0'
 readonly trial:MaterialTrial={method:'histogram',channel:'pbr',scale:1,layers:2}
 private trialMaterial:Material|null=null
 setTrial(patch:Partial<MaterialTrial>){Object.assign(this.trial,patch);if(this.trialMaterial)this.trialMaterial.needsUpdate=true;this.wake()}
 private readonly materialStage=new Group()
 private readonly sampleObjects:Object3D[]=[]
 private lod=0
 private angle=0
 private elevation=4
 private distance=24
 private extent={height:12,width:48,depth:8}
 private sources: {group:Group;side:'baseline'|'candidate'}[]=[]
 constructor(private readonly decorate:(material:Material)=>void,private readonly wake:()=>void){void this.prepare()}
 private async prepare(){
  try{
   this.library=await loadLookdevMaterials()
   if(this.released){this.library.dispose();this.library=null;return}
   this.library.materials.forEach(this.decorate)
   for(let i=0;i<4;i++){
    const surface=new Mesh(new PlaneGeometry(24,24,1,1),this.library.materials[i]);surface.rotation.x=-Math.PI/2;surface.position.set(-42+i*28,.01,-35);surface.receiveShadow=true;this.root.add(surface);this.sampleObjects.push(surface);this.owned.push(surface)
   }
   const floorMat=new MeshStandardMaterial({color:'#777568',roughness:1});this.decorate(floorMat)
   const floor=new Mesh(new PlaneGeometry(256,256),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=0;floor.receiveShadow=true;this.root.add(floor);this.sampleObjects.push(floor);this.owned.push(floor)
   const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
   const entries:[string,'baseline'|'candidate'][]=[[new URL('../assets/landscape/landscape-samples.glb',import.meta.url).href,'baseline']]
   const candidate=Object.values(candidateUrls)[0];if(candidate)entries.push([candidate,'candidate'])
   for(const [url,side] of entries){
    const gltf=await loader.loadAsync(url)
    if(this.released){this.disposeObjects([gltf.scene]);return}
    gltf.scene.traverse(object=>{if(object instanceof Mesh){object.castShadow=true;object.receiveShadow=true;for(const mat of Array.isArray((object as Mesh<BufferGeometry,Material|Material[]>).material)?(object as Mesh<BufferGeometry,Material[]>).material:[(object as Mesh<BufferGeometry,Material>).material]){if(side==='candidate'&&(object.name.startsWith('tree-1-')||object.parent?.name.startsWith('tree-1-'))&&mat instanceof MeshStandardMaterial){mat.aoMapIntensity=.28;mat.normalScale.setScalar(.45)}this.decorate(mat)}}})
    this.sources.push({group:gltf.scene,side});this.root.add(gltf.scene);this.owned.push(gltf.scene)
    if(side==='candidate')this.candidateAvailable=true
   }
   // A 1m neutral reference block gives an explicit scale cue without baked lighting.
   const ruler=new Mesh(new BoxGeometry(1,1,1),floorMat);ruler.position.set(0,.5,0);this.root.add(ruler);this.owned.push(ruler)
   const terrain=makeMaterialTerrain(this.library.materials,this.decorate,this.trial);this.trialMaterial=terrain.material;this.materialStage.add(terrain)
   const candidateSource=this.sources.find(source=>source.side==='candidate')
   const placements:[string,number,number,number][]=[['cliff-group-0',-28,-7,.7],['cliff-group-0',-37,-14,.5],['rock-group-0',-15,12,.7],['rock-group-1',-8,24,.8],['rock-group-0',28,16,.5],['tree-0-0',14,-10,.8],['tree-0-1',28,-19,.9],['tree-1-0',35,0,.8],['tree-1-1',22,-32,1]]
   for(let i=0;i<20;i++)placements.push([`understory-${i%2}`,8+(i%5)*7,Math.floor(i/5)*9-28,.65+(i%3)*.15])
   for(const [id,x,z,scale] of placements){const source=candidateSource?.group.children.find(o=>o.name===`${id}-lod0`);if(!source)continue;const group=new Group(),copy=source.clone(true);group.add(copy);group.scale.setScalar(scale);const ground=id.startsWith('cliff')?Math.min(...Array.from({length:8},(_,j)=>sampleHeight(x+Math.cos(j*Math.PI/4)*12*scale,z+Math.sin(j*Math.PI/4)*12*scale)))-.2:sampleHeight(x,z);group.position.set(x,ground,z);group.rotation.y=id.startsWith('cliff')?.3:x*.37;this.materialStage.add(group)}
   this.root.add(this.materialStage);this.owned.push(this.materialStage);this.sampleObjects.push(ruler)
   this.select(this.selected,0,0,4)
  }catch(error){this.error=String(error)}finally{this.busy=false;this.wake()}
 }
 select(id:string,lod:number,angle:number,elevation:number,distance=24){
  this.selected=id;this.lod=lod;this.angle=angle;this.elevation=elevation;this.distance=distance
  const scene=id.startsWith('material-scene');this.materialStage.visible=scene;this.materialStage.rotation.y=0
  this.sampleObjects.forEach(o=>o.visible=!scene)
  for(const source of this.sources){
   source.group.visible=!scene
   const separation=id.startsWith('understory')?3:id.startsWith('rock-')?6:id.startsWith('cliff-')?20:14
   source.group.position.set((source.side==='baseline'?-1:1)*separation,0,0)
   source.group.rotation.y=angle*Math.PI/180
   const sourceId=source.side==='baseline'?(id==='cliff-group-0'?'cliff-0':id.replace('rock-group-','rock-')):id
   source.group.traverse(object=>{if(object instanceof Mesh)object.visible=object.name===`${sourceId}-lod${lod}`||object.parent?.name===`${sourceId}-lod${lod}`})
  }
  this.root.updateWorldMatrix(true,true)
  const bounds=new Box3()
  for(const source of this.sources)source.group.traverse(object=>{if(object instanceof Mesh&&object.visible){const mesh=object as Mesh<BufferGeometry>;mesh.geometry.computeBoundingBox();if(mesh.geometry.boundingBox)bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))}})
  if(!bounds.isEmpty()){const size=bounds.getSize(new Vector3());this.extent={height:Math.max(1,size.y),width:2*Math.max(Math.abs(bounds.min.x-this.root.position.x),Math.abs(bounds.max.x-this.root.position.x)),depth:size.z}}
  this.wake()
 }
 update(camera:PerspectiveCamera,worldOrigin:{x:number;z:number}){
  this.root.position.set(this.origin.x-worldOrigin.x,this.origin.y,this.origin.z-worldOrigin.z)
  if(this.selected.startsWith('material-scene-')){const points:Record<string,[number,number]>={'material-scene-rock':[-25,-8],'material-scene-soil':[-7,-12],'material-scene-sand':[-2,35],'material-scene-floor':[22,-15]};const [x,z]=points[this.selected]??[0,0],a=(this.angle+28)*Math.PI/180,y=sampleHeight(x,z);camera.position.set(this.root.position.x+x+Math.sin(a)*24,this.origin.y+y+9+this.elevation,this.root.position.z+z+Math.cos(a)*24);camera.lookAt(this.root.position.x+x,this.origin.y+y+1,this.root.position.z+z);camera.updateMatrixWorld(true);return}
  if(this.selected==='material-scene'){const a=(this.angle+28)*Math.PI/180;camera.position.set(this.root.position.x+Math.sin(a)*80,this.origin.y+35+this.elevation,this.root.position.z+Math.cos(a)*80);camera.lookAt(this.root.position.x,this.origin.y+3,this.root.position.z-4);camera.updateMatrixWorld(true);return}
  const surface=['material-rock','material-soil','material-sand','material-floor'].indexOf(this.selected)
  const center=new Vector3(this.root.position.x+(surface>=0?-42+surface*28:0),this.origin.y+(surface>=0?0:this.extent.height*.48),this.root.position.z+(surface>=0?-35:0))
  const tangent=Math.tan(camera.fov*Math.PI/360)
  const minimum=this.selected.startsWith('understory')?5:this.selected.startsWith('rock-')?12:this.distance
  const distance=Math.max(minimum,1.2*Math.max(this.extent.height/(2*tangent),this.extent.width/(2*tangent*camera.aspect))+this.extent.depth*.5)
  camera.position.copy(center).add(new Vector3(0,surface>=0?Math.max(2,12+this.elevation):this.elevation*this.extent.height/12,surface>=0?15:distance));camera.lookAt(center);camera.updateMatrixWorld(true)
 }
 metadata(){return {materialTrial:{...this.trial},selected:this.selected,lod:this.lod,sampleRotationDegrees:this.angle,elevation:this.elevation,distance:this.distance,candidateAvailable:this.candidateAvailable,error:this.error,reviewStatus:'needs_review',bounds:this.root.children.length?new Box3().setFromObject(this.root).getSize(new Vector3()).toArray():null}}
 private disposeObjects(objects:Object3D[]){
  const geometry=new Set<BufferGeometry>(),material=new Set<Material>(),texture=new Set<Texture>()
  for(const object of objects)object.traverse(o=>{if(o instanceof Mesh){const mesh=o as Mesh<BufferGeometry,Material|Material[]>;geometry.add(mesh.geometry);for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){if(this.library?.materials.includes(m as MeshStandardMaterial))continue;material.add(m);for(const v of Object.values(m))if(v&&typeof v==='object'&&'isTexture'in v)texture.add(v as Texture)}}})
  geometry.forEach(g=>g.dispose());material.forEach(m=>m.dispose());texture.forEach(t=>t.dispose())
 }
 dispose(){if(this.released)return;this.released=true;this.disposeObjects(this.owned);this.library?.dispose();this.root.clear();this.root.removeFromParent()}
}
