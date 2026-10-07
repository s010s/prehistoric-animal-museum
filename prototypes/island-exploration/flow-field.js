import * as T from 'three'
import {riverX,riverLevel} from './field.js'
export function makeFlowField(rocks,diagnostics){
 const size=256,span=256,data=new Uint8Array(size*size*4);for(let i=0;i<data.length;i+=4){data[i]=128;data[i+1]=180;data[i+3]=255}
 const texture=new T.DataTexture(data,size,size,T.RGBAFormat);texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
 const origin=new T.Vector2(1e8,1e8),worker=new Worker(new URL('./flow-worker.js',import.meta.url),{type:'module'});let pending=true,error=null,deferred=null;
 worker.onerror=e=>{error=e.message;pending=false;console.error("Island flow worker:",e.message)};
 worker.onmessage=e=>{if(e.data.ready){pending=false;return}deferred=e.data;};
 const consume=data=>{const e={data};const consumeStart=performance.now();texture.image.data=e.data.data;origin.set(e.data.ox,e.data.oz);texture.needsUpdate=true;pending=false;diagnostics?.event('workerConsume',{worker:'flow',workerMs:e.data.workerMs??null,cpuMs:performance.now()-consumeStart,textureStagingBytes:e.data.data.byteLength})};
 return{texture,origin,span,dispose(){worker.terminate();deferred=null;texture.dispose();},status:()=>({pending,error,deferredResults:deferred?1:0,origin:origin.toArray()}),update(camera){if(deferred){const data=deferred;deferred=null;consume(data);}if(error||pending||Math.abs(camera.position.x-riverX(camera.position.z))>250||camera.position.y-riverLevel(camera.position.z)>150)return;const ox=Math.round(camera.position.x/64)*64-span/2,oz=Math.round(camera.position.z/64)*64-span/2;if(ox===origin.x&&oz===origin.y)return;pending=true;worker.postMessage({ox,oz,rocks})}}
}
