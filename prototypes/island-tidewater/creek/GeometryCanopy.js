import {Frustum,Matrix4,Sphere,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {VegInstances,LodLevel} from '../vendor/tidewater/src/world/vegetation/InstanceLOD.js';

// World-space middle LOD: the same branch/spray centres and instance matrix,
// with fewer surface subdivisions. Screen-small trees alone reach the atlas.
export const TREE_ATLAS_PIXELS=18;
export class GeometryCanopy {
 constructor(name,records,geometry,material,bounds){
  this.name=name;this.records=records;this.inst=new VegInstances(records);
  this.ids=new Int32Array(Math.max(1,records.length));this.bounds=bounds;
  this.near=new LodLevel([{geometry,material,castShadow:false,name}],Math.max(1,records.length),new Vector3());this.near.setDynamic();
  this.meshes=this.near.meshes;this.frustum=new Frustum();this.matrix=new Matrix4();this.sphere=new Sphere();this.selected=0;this.pixelScale=1;this._selectionState=null;
 }
 // Records/packed instance data are static; invalidate after explicitly editing them.
 invalidate(){this._selectionState=null;}
 update(position,camera,force=false){
  this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const {px,py,pz,iDat}=this.inst,b=this.bounds,last=this._selectionState;
  // Wind remains in the shader. Only an identical selection state can reuse buffers.
  if(!force&&last&&this.matrix.equals(last.matrix)&&last.position.equals(position)&&
   this.pixelScale===last.pixelScale&&b.center.y===last.boundsY&&b.radius===last.boundsRadius&&
   camera.coordinateSystem===last.coordinateSystem&&camera.reversedDepth===last.reversedDepth&&this.inst.count===last.count)return false;
  this.frustum.setFromProjectionMatrix(this.matrix,camera.coordinateSystem,camera.reversedDepth);let n=0;
  for(let i=0;i<this.inst.count;i++){
   const H=iDat[i*4+2],seed=iDat[i*4+3],nd=seed>=4?190:65,far=Math.max(nd*4,H*this.pixelScale/TREE_ATLAS_PIXELS),d2=(px[i]-position.x)**2+(py[i]-position.y)**2+(pz[i]-position.z)**2;
   if(d2<(nd*.8)**2||d2>(far*1.14+2)**2)continue;
   const r=this.records[i],s=r.s,sy=Math.abs(r.sy);this.sphere.center.set(px[i],py[i]+b.center.y*s*sy,pz[i]);this.sphere.radius=b.radius*s*Math.max(1,sy)+H*.025+2;
   if(!this.frustum.intersectsSphere(this.sphere))continue;this.ids[n++]=i;
  }
  this.near.fill(this.inst,this.ids,n);this.selected=n;
  const state=last??{matrix:new Matrix4(),position:new Vector3()};
  state.matrix.copy(this.matrix);state.position.copy(position);state.pixelScale=this.pixelScale;state.boundsY=b.center.y;state.boundsRadius=b.radius;
  state.coordinateSystem=camera.coordinateSystem;state.reversedDepth=camera.reversedDepth;state.count=this.inst.count;this._selectionState=state;
  return true;
 }
 stats(){return {instances:this.inst.count,selected:this.selected,capacity:this.near.capacity,triangles:this.near.triangles,method:'fixed branch/spray centres; actual 3D surfaces; conservative per-tree volume and range',atlasAtHeightPixels:TREE_ATLAS_PIXELS};}
}
