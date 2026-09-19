import { Box3, Box3Helper, InstancedMesh, Matrix4, Raycaster, Vector2, Vector3, type BufferGeometry, type LineBasicMaterial } from 'three'
import type { FlightRuntime } from './FlightRuntime'
/** Review-only picking against the submitted GLB instances; keeps a ghost if its ID is released. */
export function installPropPicker(runtime:FlightRuntime,onPick:(id:string)=>void){
 const canvas=document.querySelector<HTMLCanvasElement>('canvas[data-experience="flight"]')
 if(!canvas)return ()=>{}
 const ray=new Raycaster(),pointer=new Vector2(),matrix=new Matrix4(),logicalBox=new Box3(),box=new Box3()
 const helper=new Box3Helper(box,0x27e7ef);helper.visible=false;helper.frustumCulled=false;helper.renderOrder=100
 const material=helper.material as LineBasicMaterial
 material.depthTest=false;material.depthWrite=false
 let selected=''
 const update=()=>{
  if(!selected)return
  const instance=runtime.scenery.props.inspectObject(selected)
  if(instance){
   const {position,physical}=instance
   logicalBox.min.set(position.x-physical.crownRadius,position.y,position.z-physical.crownRadius)
   logicalBox.max.set(position.x+physical.crownRadius,position.y+physical.physicalHeight,position.z+physical.crownRadius)
  }
  const origin=runtime.reviewOrigin
  box.copy(logicalBox).translate(new Vector3(-origin.x,0,-origin.z));helper.updateMatrixWorld(true)
  material.color.setHex(instance?0x27e7ef:0xff7b35)
 }
 const pick=(event:PointerEvent)=>{
  if(!['paused','ready'].includes(runtime.getSnapshot().phase)||runtime.lookdevActive)return
  if(event.target instanceof Element&&event.target.closest('button,input,select,textarea,details'))return
  const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2)
  runtime.scene.updateMatrixWorld(true);ray.setFromCamera(pointer,runtime.camera)
  for(const mesh of runtime.scenery.props.root.children)if(mesh instanceof InstancedMesh&&mesh.visible)mesh.computeBoundingSphere()
  const hit=ray.intersectObjects(runtime.scenery.props.root.children,false).find(h=>h.instanceId!==undefined)
  if(!hit||!(hit.object instanceof InstancedMesh))return
  const id=(hit.object.userData.propIds as string[]|undefined)?.[hit.instanceId!];if(!id)return
  selected=id;hit.object.getMatrixAt(hit.instanceId!,matrix)
  const geometry=hit.object.geometry as BufferGeometry
  geometry.computeBoundingBox()
  if(geometry.boundingBox){logicalBox.copy(geometry.boundingBox).applyMatrix4(matrix).applyMatrix4(hit.object.matrixWorld);const origin=runtime.reviewOrigin;logicalBox.translate(new Vector3(origin.x,0,origin.z))}
  helper.visible=true;runtime.scenery.props.setTracing(true,id);update();onPick(id);runtime.refreshReview()
 }
 runtime.scene.add(helper);runtime.reviewOverlayUpdate=update;window.addEventListener('pointerdown',pick,true)
 return ()=>{window.removeEventListener('pointerdown',pick,true);if(runtime.reviewOverlayUpdate===update)runtime.reviewOverlayUpdate=undefined;helper.removeFromParent();helper.geometry.dispose();material.dispose()}
}
