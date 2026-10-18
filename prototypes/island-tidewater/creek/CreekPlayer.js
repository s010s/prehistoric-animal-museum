// Native Tidewater walking/swimming with explicit own water-domain transitions.
import { Player } from '../vendor/tidewater/src/player/Player.js';
export class CreekPlayer extends Player {
  constructor(options){super(options);this.field=options.query;this.wet=false;this.boundaryHits=0;}
  update(dt){
    const p=this.position,f=this.field.sample(p.x,p.z),wet=f[1]<.05;
    if(wet!==this.wet||!wet){
      this.waterMean=this.waterH=wet?f[0]:this.terrain.heightAt(p.x,p.z)-.2;
      if(!wet&&this.mode==='swim'){this.mode='walk';p.y=Math.max(p.y,this.terrain.heightAt(p.x,p.z));this.velocity.y=0;}
      if(!wet)this.floating=true;
      this.wet=wet;
    }
    super.update(dt);
    const limit=this.terrain.size/2-24;const x=Math.max(-limit,Math.min(limit,p.x)),z=Math.max(-limit,Math.min(limit,p.z));
    if(x!==p.x||z!==p.z){p.x=x;p.z=z;this.velocity.x=this.velocity.z=0;this.boundaryHits++;this.camera.position.x=x;this.camera.position.z=z;}
  }
}
