import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {VegInstances,LodLevel} from '../vendor/tidewater/src/world/vegetation/InstanceLOD.js';

// A depth-only representation for the existing sample and its neighbouring
// casters. Colour LODs must not turn their screen-door transition into a grid
// of holes in the shadow map. This uses the same rest pose and wind as colour.
export const CANOPY_SHADOW_LAYER=4;
export const hasFixedCanopyShadow=r=>r.x>=-1636&&r.x<=-412&&r.z>=-772&&r.z<=452;
export const fixedCanopyShadowWGSL='museumCanopy.fixedShadows>.5&&all(in.vs.vRoot.xz>=vec2f(-1636.0,-772.0))&&all(in.vs.vRoot.xz<=vec2f(-412.0,452.0))';

export class CanopyShadows{
 constructor(name,records,geometry,material){
  this.records=records;this.inst=new VegInstances(records);this.ids=new Int32Array(Math.max(1,records.length));
  this.near=new LodLevel([{geometry,material,castShadow:true,name}],Math.max(1,records.length),new Vector3());this.near.setDynamic();this.meshes=this.near.meshes;
  for(const mesh of this.meshes)mesh.layers.set(CANOPY_SHADOW_LAYER);
  this.last=[Infinity,Infinity,Infinity];
 }
 update(position){
  // CSM reaches 400m with a 200m light margin. Do not view-frustum cull:
  // an off-screen crown can still cast a visible shadow into the stream.
  if(Math.hypot(position.x-this.last[0],position.y-this.last[1],position.z-this.last[2])<12)return;
  this.last=[position.x,position.y,position.z];let n=0;
  for(let i=0;i<this.inst.count;i++){
   const r=this.records[i];if(Math.hypot(r.x-position.x,r.y-position.y,r.z-position.z)<=650+r.H)this.ids[n++]=i;
  }
  this.near.fill(this.inst,this.ids,n);
 }
 stats(){return {instances:this.inst.count,submitted:this.near.count,triangles:this.near.triangles,layer:CANOPY_SHADOW_LAYER,colourPass:false,rangeMetres:650,selection:'fixed existing catchment casters; 3D range including crown height; no view-frustum cull',cameraLodDither:false};}
}
