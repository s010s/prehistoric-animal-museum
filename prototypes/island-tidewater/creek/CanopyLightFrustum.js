// Conservative per-light instance packets. Native vertices, materials and CSM stay intact.
import {CANOPY_LIGHT_LIMITS,auditCanopyLightMaterial,measureCanopyTemplate,canopyInstanceEnvelope,prepareCanopyLightTest} from './CanopyLightBounds.js';
export {CANOPY_LIGHT_LIMITS,canopyInstanceEnvelope,canopyLightReject} from './CanopyLightBounds.js';
const LIMIT=32*1024*1024,same=(a,b)=>!!a&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const sourceOf=a=>a.isInterleavedBufferAttribute?a.data:a;
function attributeSignature(geo){return Object.entries(geo.attributes).filter(([k])=>k!=='iPos'&&k!=='iDat').flatMap(([k,a])=>{const s=sourceOf(a);return [k,a,s.array,s.version];}).concat([geo.index,geo.index?.array,geo.index?.version]);}
function geometryBytes(geo){
 const seen=new Set();let bytes=geo.index?.array.byteLength??0;
 for(const [name,a]of Object.entries(geo.attributes)){if(name==='iPos'||name==='iDat')continue;const s=sourceOf(a);if(!seen.has(s)){seen.add(s);bytes+=s.array.byteLength;}}
 return bytes;
}
function affine(p){return p?.length===16&&Array.from(p).every(Number.isFinite)&&p[3]===0&&p[7]===0&&p[11]===0&&p[15]===1;}
function readView(cascade){return Float32Array.from(cascade.block.fields.viewProj.value.elements);}
function moduleSignature(roots){const modules=[],seen=new Set(),visit=m=>{if(!m||seen.has(m))return;seen.add(m);modules.push(m);for(const d of m.deps??[])visit(d);};roots.forEach(visit);return modules.flatMap(m=>[m,m.code,...m.deps]);}

export async function attachCanopyLightFrustum(app,{enabled=true,maxBytes=LIMIT,limits=CANOPY_LIGHT_LIMITS}={}){
 const types=app?.vegetation?.canopyShadows,shadows=app?.shadows??app?.csm,mr=app?.engine?.meshRenderer;
 if(!Array.isArray(types)||types.length!==5||!shadows?.cascades?.length||!mr?.render)throw Error('Expected five native museum fixed canopy types and CSM');
 if(!Number.isFinite(maxBytes)||maxBytes>LIMIT||maxBytes<0)throw Error('Canopy candidate budget must be <=32MiB');
 if(limits!==CANOPY_LIGHT_LIMITS)throw Error('Reviewed envelope limits are fixed; a different envelope needs a new failure contract');
 const [{BufferGeometry,InstancedBufferAttribute,InstancedInterleavedBuffer,InterleavedBufferAttribute},{GPU,G},{Object3D}]=await Promise.all([
  import('../vendor/tidewater/src/engine/geometry/index.js'),import('../vendor/tidewater/src/engine/webgpu.js'),import('../vendor/tidewater/src/engine/scene/Object3D.js')]);
 const entries=types.map((type,index)=>{
  if(type.meshes.length!==1)throw Error('Unproved multipart canopy type');
  const mesh=type.meshes[0],geo=mesh.geometry,material=mesh.material,audit=auditCanopyLightMaterial(material);
  if(!mesh.isInstancedMesh||mesh.frustumCulled!==false||mesh.instanceColor||(mesh.onBeforeRender&&mesh.onBeforeRender!==Object3D.prototype.onBeforeRender)||!audit||!geo.index||geo.indirect||geo.groups.length||geo.drawRange.start!==0||
   !(geo.drawRange.count===Infinity||geo.drawRange.count===geo.index.count)||geo.attributes.iPos!==type.near.iPos||geo.attributes.iDat!==type.near.iDat||
   mesh.instanceMatrix!==type.near.instanceMatrix||!(mesh.instanceMatrix.array instanceof Float32Array)||!(type.near.iBuffer.array instanceof Float32Array))throw Error('Unproved native canopy layout/vertex seam');
  const capacity=Math.max(1,type.inst.count),template=measureCanopyTemplate(geo);
  if(Object.values(geo.attributes).some(a=>sourceOf(a).gpuBuffer))throw Error('Unproved storage-backed canopy geometry');
  const detailSpec=audit.veg.bindings.vegDetail,detailSource=detailSpec?.texture,detail=typeof detailSource==='function'?detailSource():detailSource;
  if(!detail||detail.format!=='rgba8unorm')throw Error('Unproved finite normalized gust detail texture');
  return {index,type,mesh,geo,material,audit,capacity,template,detailSpec,detailSource,detail,detailVersion:detail.version,instanceMatrix:mesh.instanceMatrix,iBuffer:type.near.iBuffer,
   vertex:material.vertex,shadow:material.shadow,beforeRender:mesh.onBeforeRender,attributes:attributeSignature(geo),packets:[],envelopeKey:null,envelopes:null};
 });
 const cascadeCount=shadows.cascades.length;
 const allocatedBytes=entries.reduce((n,e)=>n+cascadeCount*(geometryBytes(e.geo)+e.capacity*96),0);
 let active=!!enabled,disposed=false,nativeFallback=allocatedBytes>maxBytes,reason=nativeFallback?'32MiB budget fallback':null;
 let frame=-1,passes=0,packetBuilds=0,packetHits=0,sourceFallbacks=0,windFallbacks=0,usedFallbacks=0,envelopeBuilds=0,envelopeHits=0;
 const latest=Array.from({length:cascadeCount},()=>null),nativeRender=mr.render;
 if(!nativeFallback)for(const entry of entries)for(let i=0;i<cascadeCount;i++){
  const geo=new BufferGeometry();
  for(const [name,a]of Object.entries(entry.geo.attributes))if(name!=='iPos'&&name!=='iDat')geo.setAttribute(name,a);
  const packed=new InstancedInterleavedBuffer(new Float32Array(entry.capacity*8),8);
  const matrix=new InstancedBufferAttribute(new Float32Array(entry.capacity*16),16);
  geo.setAttribute('iPos',new InterleavedBufferAttribute(packed,4,0));geo.setAttribute('iDat',new InterleavedBufferAttribute(packed,4,4));
  geo.setIndex(entry.geo.index);geo.setDrawRange(entry.geo.drawRange.start,entry.geo.drawRange.count);
  geo.boundingBox=entry.geo.boundingBox?.clone()??null;geo.boundingSphere=entry.geo.boundingSphere?.clone()??null;
  entry.packets.push({geo,packed,matrix,matrixWords:new Uint32Array(matrix.array.buffer),packedWords:new Uint32Array(packed.array.buffer),
   ids:new Int32Array(entry.capacity),signature:null,count:0,usedFrame:-1,last:null});
 }
 function sourceValid(e){
  const detailSpec=e.audit.veg.bindings.vegDetail,detailSource=detailSpec?.texture,detail=typeof detailSource==='function'?detailSource():detailSource;
  return e.mesh.geometry===e.geo&&e.mesh.frustumCulled===false&&e.mesh.instanceMatrix===e.instanceMatrix&&e.mesh.material===e.material&&e.mesh.onBeforeRender===e.beforeRender&&
   e.type.near.iBuffer===e.iBuffer&&e.type.near.instanceMatrix===e.instanceMatrix&&e.geo.attributes.iPos===e.type.near.iPos&&e.geo.attributes.iDat===e.type.near.iDat&&
   e.material.vertex===e.vertex&&e.material.shadow===e.shadow&&same(e.attributes,attributeSignature(e.geo))&&same(e.audit.signature,moduleSignature(e.material.modules))&&
   e.audit.conifer.bindings.museumCanopy?.uniform===e.audit.review&&e.audit.veg.bindings.vegParams?.uniform===e.audit.params&&
   detailSpec===e.detailSpec&&detailSource===e.detailSource&&detail===e.detail&&detail.version===e.detailVersion&&detail.format==='rgba8unorm'&&
   e.type.near.count===e.mesh.count&&e.mesh.count<=e.capacity&&e.mesh.count>=0;
 }
 function supportedWind(){
  const dir=G.windDir.value,speed=G.windSpeed.value,time=G.time.value,dt=G.dt.value;
  if(![dir.x,dir.y,speed,time,dt].every(Number.isFinite)||Math.hypot(dir.x,dir.y)>limits.windDirLengthMax||speed>limits.windSpeedMax||Math.abs(time)>1e7||Math.abs(dt)>1)return false;
  return entries.every(e=>{const w=e.audit.review.fields.wind.value,g=e.audit.params.fields.gustOffset.value;return Number.isFinite(w)&&Math.abs(w)<=limits.reviewWindAbsMax&&
   [g.x,g.y].every(Number.isFinite)&&Math.max(Math.abs(g.x),Math.abs(g.y))<=1e7;});
 }
 function planEntry(e,view){
  const n=e.mesh.count,M=e.instanceMatrix.array,B=e.iBuffer.array,world=Float32Array.from(e.mesh.matrixWorld.elements),kept=[],removed=[],unknown={};
  // The full-wind world envelope is independent of the light view and time.
  // Reuse it across cascades and camera motion until its instance inputs change.
  const envelopeKey=[n,M,e.instanceMatrix.version,B,e.iBuffer.version,...world];
  if(!same(e.envelopeKey,envelopeKey)){
   e.envelopes=Array.from({length:n},(_,k)=>canopyInstanceEnvelope(e.template,M.subarray(k*16,k*16+16),B.subarray(k*8,k*8+4),B.subarray(k*8+4,k*8+8),world,limits));
   e.envelopeKey=envelopeKey;envelopeBuilds++;
  }else envelopeHits++;
  const envelopes=e.envelopes,testLight=prepareCanopyLightTest(view,shadows.size,limits);
  for(let k=0;k<n;k++){
   const envelope=envelopes[k],plane=testLight(envelope);
   if(plane<0){kept.push(k);if(!envelope.known)unknown[envelope.reason]=(unknown[envelope.reason]??0)+1;}else removed.push({sourceSlot:k,plane});
  }
  return {species:e.index,mesh:e.mesh.name,selected:n,kept:kept.length,removed:removed.length,keptSlots:kept,removedSlots:removed,envelopes,unknown,
   originalTriangles:n*e.template.triangles,candidateTriangles:kept.length*e.template.triangles,world:Array.from(world),view:Array.from(view)};
 }
 function packetFor(e,index,view){
  const p=e.packets[index],signature=[e.mesh.count,e.instanceMatrix.array,e.instanceMatrix.version,e.iBuffer.array,e.iBuffer.version,
   ...Float32Array.from(e.mesh.matrixWorld.elements),...view];
  if(same(p.signature,signature)){packetHits++;return p;}
  if(p.usedFrame===GPU.frame){usedFallbacks++;return null;}
  const plan=planEntry(e,view),M=new Uint32Array(e.instanceMatrix.array.buffer,e.instanceMatrix.array.byteOffset,e.instanceMatrix.array.length),
   B=new Uint32Array(e.iBuffer.array.buffer,e.iBuffer.array.byteOffset,e.iBuffer.array.length);
  if(plan.kept>e.capacity)return null; // No clipping/truncation of a source pool.
  for(let k=0;k<plan.keptSlots.length;k++){
   const from=plan.keptSlots[k];p.ids[k]=from;p.matrixWords.set(M.subarray(from*16,from*16+16),k*16);p.packedWords.set(B.subarray(from*8,from*8+8),k*8);
  }
  for(const [attribute,width]of [[p.matrix,16],[p.packed,8]]){attribute.clearUpdateRanges();if(plan.kept)attribute.addUpdateRange(0,plan.kept*width);attribute.needsUpdate=true;}
  p.count=plan.kept;p.signature=signature;p.last=plan;packetBuilds++;return p;
 }
 const wrapped=function(scene,pass){
  if(disposed||!active||nativeFallback||this.precompiling||scene!==app.scene||pass?.kind!=='depth')return nativeRender.call(this,scene,pass);
  const match=/^shadow cascade (\d+)$/.exec(pass.label??'');if(!match)return nativeRender.call(this,scene,pass);
  const index=Number(match[1]),cascade=shadows.cascades[index];
  if(!cascade||pass.camera!==cascade.camera||pass.frameBlock!==cascade.block||pass.depthCompare!=='less-equal'||pass.depthBias!==2||pass.depthBiasSlopeScale!==1.5||pass.viewport||pass.scissorRect)return nativeRender.call(this,scene,pass);
  if(!entries.every(sourceValid)){sourceFallbacks++;nativeFallback=true;reason='Original canopy shader/attribute/layout changed; complete native fallback';return nativeRender.call(this,scene,pass);}
  if(!supportedWind()){windFallbacks++;reason='Unsupported wind/time state; original canopy retained';return nativeRender.call(this,scene,pass);}
  const view=readView(cascade);if(!affine(view))return nativeRender.call(this,scene,pass);
  scene.updateMatrixWorld();const prepared=[];
  for(const e of entries){const p=packetFor(e,index,view);if(!p)return nativeRender.call(this,scene,pass);prepared.push([e,p]);}
  if(frame!==GPU.frame){frame=GPU.frame;}
  passes++;reason=null;
  latest[index]={frame:GPU.frame,cascade:index,selected:prepared.reduce((n,[,p])=>n+p.last.selected,0),kept:prepared.reduce((n,[,p])=>n+p.count,0),
   removed:prepared.reduce((n,[,p])=>n+p.last.removed,0),triangles:prepared.reduce((n,[e,p])=>n+p.count*e.template.triangles,0),
   species:prepared.map(([e,p])=>({species:e.index,selected:p.last.selected,kept:p.count,removed:p.last.removed,unknown:p.last.unknown}))};
  const saved=prepared.map(([e,p])=>[e,e.mesh.geometry,e.mesh.instanceMatrix,e.mesh.count]);
  for(const [e,p]of prepared){e.mesh.geometry=p.geo;e.mesh.instanceMatrix=p.matrix;e.mesh.count=p.count;p.usedFrame=GPU.frame;}
  let adapted=pass;
  if(pass.items){
   const byMesh=new Map(prepared.map(([e,p])=>[e.mesh,p.geo])),replace=list=>list.map(it=>byMesh.has(it.object)?{...it,geometry:byMesh.get(it.object)}:it);
   adapted={...pass,items:{...pass.items,opaque:replace(pass.items.opaque),transparent:replace(pass.items.transparent)}};
  }
  const sync=this.syncPipelines;this.syncPipelines=true;
  try{return nativeRender.call(this,scene,adapted);}finally{this.syncPipelines=sync;for(const [e,geo,matrix,count]of saved){e.mesh.geometry=geo;e.mesh.instanceMatrix=matrix;e.mesh.count=count;}}
 };
 mr.render=wrapped;
 const api={
  setEnabled(value){if(disposed)throw Error('Canopy light culler disposed');active=!!value;return active;},
  stats(){return {version:3,enabled:active&&!nativeFallback,requestedEnabled:active,disposed,nativeFallback,reason,passes,packetBuilds,packetHits,envelopeBuilds,envelopeHits,sourceFallbacks,windFallbacks,usedFallbacks,
   allocatedBytes:nativeFallback&&allocatedBytes>maxBytes?0:allocatedBytes,budgetBytes:maxBytes,cascadeGeometries:entries.reduce((n,e)=>n+e.packets.length,0),
   originalRestored:entries.every(e=>e.mesh.geometry===e.geo&&e.mesh.instanceMatrix===e.instanceMatrix&&e.mesh.count===e.type.near.count),
   selected:entries.reduce((n,e)=>n+e.type.near.count,0),cascadePackets:latest,limits,
   caveat:'mathematical sine amplitude + fixed1% guard; device vertex enclosure and final depth0 acceptance required; all giants retained'};},
  audit(index){
   if(disposed||!shadows.cascades[index]||!entries.every(sourceValid))throw Error('Canopy audit source/cascade changed');
   app.scene.updateMatrixWorld();const view=readView(shadows.cascades[index]);return {cascade:index,view:Array.from(view),supportedWind:supportedWind(),entries:entries.map(e=>planEntry(e,view))};
  },
  // Read-only object references for the parent's independent untimed GPU probe.
  sources(){return entries.map(e=>({mesh:e.mesh,geometry:e.geo,material:e.material,template:e.template,instanceMatrix:e.instanceMatrix,iBuffer:e.iBuffer,capacity:e.capacity}));},
  auditCopies(){
   let packets=0,instances=0,mismatchedWords=0,unstableIds=0;
   for(const e of entries)for(const p of e.packets){if(p.usedFrame!==GPU.frame||!p.last)continue;packets++;
    const M=new Uint32Array(e.instanceMatrix.array.buffer,e.instanceMatrix.array.byteOffset,e.instanceMatrix.array.length),B=new Uint32Array(e.iBuffer.array.buffer,e.iBuffer.array.byteOffset,e.iBuffer.array.length);
    for(let k=0;k<p.count;k++){instances++;const from=p.ids[k];if(from!==p.last.keptSlots[k]||(k>0&&from<=p.ids[k-1]))unstableIds++;
     for(let j=0;j<16;j++)if(p.matrixWords[k*16+j]!==M[from*16+j])mismatchedWords++;
     for(let j=0;j<8;j++)if(p.packedWords[k*8+j]!==B[from*8+j])mismatchedWords++;
    }
   }
   return {packets,instances,mismatchedWords,unstableIds,passed:mismatchedWords===0&&unstableIds===0};
  },
  dispose(){
   if(disposed)return;if(mr.render!==wrapped)throw Error('Dispose later renderer wrappers before canopy candidate');mr.render=nativeRender;active=false;disposed=true;
   const destroy=()=>{for(const e of entries)for(const p of e.packets)p.geo.dispose();};if(GPU.encoder)GPU.onSubmit(null,destroy);else destroy();
  },
 };
 return api;
}
