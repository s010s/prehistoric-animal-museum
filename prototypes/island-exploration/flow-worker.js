import {riverX,halfWidth,riverLevel,smooth} from './field.js'
import {riverReach,obstacleFlow} from './hydrology.js'
self.onmessage=e=>{const workerStart=performance.now();const {ox,oz,rocks}=e.data,size=256,span=256,data=new Uint8Array(size*size*4),buckets=new Map();for(const r of rocks){const key=Math.floor(r.z/32);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r)}
 for(let iz=0;iz<size;iz++){const z=oz+(iz+.5)*span/size,rx=riverX(z),w=halfWidth(z),dx=(riverX(z+2)-riverX(z-2))/4,len=Math.hypot(dx,1),reach=riverReach(z),near=[];for(let b=Math.floor((z-75)/32);b<=Math.floor((z+16)/32);b++)near.push(...(buckets.get(b)??[]))
 for(let ix=0;ix<size;ix++){const x=ox+(ix+.5)*span/size,i=(iz*size+ix)*4,bank=Math.abs(x-rx)/w,speed=reach.speed*(1-.64*smooth(.35,1.15,bank)),base=[dx/len*speed,speed/len],result=bank<1.4?obstacleFlow(x,z,base,near):{velocity:base,foam:0};
 data[i]=Math.round((result.velocity[0]/6+.5)*255);data[i+1]=Math.round((result.velocity[1]/6+.5)*255);data[i+2]=Math.round(result.foam*255);data[i+3]=Math.round(reach.agitation*255)
 }}self.postMessage({ox,oz,data,workerMs:performance.now()-workerStart},[data.buffer])}
self.postMessage({ready:true});
