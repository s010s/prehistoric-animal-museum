// Application-side policy for the pinned Tidewater SkyProClouds implementation
// (MIT, DRG Software Solutions LLC). Keep its march, light and temporal pipeline.
import {SkyProClouds} from '../vendor/tidewater/src/sky/SkyProClouds.js';
import {Vector3} from '../vendor/tidewater/src/engine/index.js';

export class MuseumClouds extends SkyProClouds {
 constructor(...args){
  super(...args);this.legacyShadowRecentre=false;this._museumPosition=new Vector3();
  this.shadowAudit={recentres:0,fullUpdates:0,partialUpdates:0,staleRecentres:0,lastMode:'initial',events:[]};this._museumSpan=this.shadowSize.value;
 }
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
