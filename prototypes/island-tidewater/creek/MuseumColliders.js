// Keep Tidewater's collision solver; index our much larger forest by location.
import {Colliders} from '../vendor/tidewater/src/world/Colliders.js';
export class MuseumColliders extends Colliders{
 constructor(){super();this.treeCells=new Map();this.nearTrees=[];}
 addCylinder(...args){const before=this.cylinders.length,result=super.addCylinder(...args),c=this.cylinders[before],key=Math.floor(args[0]/32)+','+Math.floor(args[1]/32);let cell=this.treeCells.get(key);if(!cell)this.treeCells.set(key,cell=[]);cell.push(c);return result;}
 resolveCapsule(pos,...args){const all=this.cylinders,near=this.nearTrees;near.length=0;const ix=Math.floor(pos.x/32),iz=Math.floor(pos.z/32);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const c=this.treeCells.get((ix+i)+','+(iz+j));if(c)for(const item of c)near.push(item);}this.cylinders=near;try{const hit=super.resolveCapsule(pos,...args);if(hit)this.hitCount=(this.hitCount??0)+1;return hit;}finally{this.cylinders=all;}}
}
