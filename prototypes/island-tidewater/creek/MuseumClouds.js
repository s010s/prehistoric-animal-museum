// Application-side policy for the pinned Tidewater SkyProClouds implementation
// (MIT, DRG Software Solutions LLC). Keep its march, light and temporal pipeline.
import {SkyProClouds} from '../vendor/tidewater/src/sky/SkyProClouds.js';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';

// Bound every direction in the cloud view, including rolled cameras. Below
// -.07 both native cloud samplers return transparent black. The panorama
// still supplies reflections and every direction outside this view.
export function cloudViewHidden(camera) {
 if(!camera.isPerspectiveCamera||!Number.isFinite(camera.fov)||camera.fov<=0||camera.fov>=180||
  !Number.isFinite(camera.zoom)||camera.zoom<=0||!Number.isFinite(camera.aspect)||camera.aspect<=0)return false;
 const e=camera.matrixWorld.elements;
 const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
 const R=unit([e[0],e[1],e[2]]),U=unit([e[4],e[5],e[6]]),F=unit([-e[8],-e[9],-e[10]]);
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
 const ty=Math.tan(camera.fov*Math.PI/360)/camera.zoom,tx=ty*camera.aspect;
 const x=tx*1.002,y=ty*1.002;
 const orthogonal=Math.max(Math.abs(dot(R,U)),Math.abs(dot(R,F)),Math.abs(dot(U,F)))<1e-6;
 const numerator=F[1]+Math.abs(R[1])*x+Math.abs(U[1])*y;
 const lengthBound=Math.sqrt(1+x*x+y*y+2e-6*(x+y+x*y));
 const upperY=numerator<0?numerator/lengthBound:1;
 return orthogonal&&tx>0&&ty>0&&Number.isFinite(upperY)&&upperY<=-.071;
}

export class MuseumClouds extends SkyProClouds {
 constructor(...args){
  super(...args);this.legacyShadowRecentre=false;this._museumPosition=new Vector3();
  this.shadowAudit={recentres:0,fullUpdates:0,partialUpdates:0,staleRecentres:0,lastMode:'initial',events:[]};this._museumSpan=this.shadowSize.value;
 }
 isViewHidden(camera){return cloudViewHidden(camera);}
 update(dt,camera){
  // Native map is 256² and snapped by four texels. Old rows cannot be
  // interpreted in a new coordinate frame, even for just three frames.
  camera.updateMatrixWorld();const p=camera.getWorldPosition(this._museumPosition),span=this.shadowSize.value,cell=span/256*4;
  const phase=this.frameIndex%4,initial=!this._shadowInit;
  const x=Math.round(p.x/cell)*cell,z=Math.round(p.z/cell)*cell;
  const changed=(phase===0||initial)&&(x!==this.shadowCenter.value.x||z!==this.shadowCenter.value.y)||span!==this._museumSpan;
  if(changed&&!this.legacyShadowRecentre)this._shadowInit=false;
  const full=!this._shadowInit;
  super.update(dt,camera);
  const s=this.shadowAudit;s[full?'fullUpdates':'partialUpdates']++;s.lastMode=full?'full':'quarter';s.center=this.shadowCenter.value.toArray();s.span=span;s.phase=phase;
  if(changed){s.recentres++;if(!full)s.staleRecentres++;s.events.push({frame:this.frameIndex-1,center:s.center.slice(),mode:s.lastMode,initial});if(s.events.length>16)s.events.shift();}
  this._museumSpan=span;
 }
 setLegacyShadowRecentre(on){this.legacyShadowRecentre=!!on;this._shadowInit=false;this.shadowAudit.staleRecentres=0;}
 stabilityStats(){return {...this.shadowAudit,legacy:this.legacyShadowRecentre,policy:'full native map on coordinate-frame change; quarter rows otherwise',resolution:256,snapMetres:this.shadowSize.value/256*4};}
}
