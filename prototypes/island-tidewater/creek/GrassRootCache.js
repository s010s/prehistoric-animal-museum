import {GPU,StorageBuffer,ComputeKernel} from '../vendor/tidewater/src/engine/webgpu.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {vegModule} from '../vendor/tidewater/src/world/vegetation/VegNodes.js';
import {G} from '../vendor/tidewater/src/core/Globals.js';

const ROWS=4,STRIDE=64;
// Island cells lie on an integer grid. Keep the public field query usable for
// fractional cells as well, without collisions or quantising their position.
function cellKey(x,z){
 return Number.isInteger(x)&&Number.isInteger(z)&&Math.abs(x)<32768&&Math.abs(z)<32768
  ? (z+32768)*65536+x+32768 : x+','+z;
}
// Literal original CreekGrass vertex placement; compute keeps its f32 order.
const PLACEMENT=`let cellYaw=floor(vegHash12(cell*.137+vec2f(7.1,19.3))*4.0)*1.57079632679;
 let cs=cos(cellYaw);let sn=sin(cellYaw);let q=slot.xy-vec2f(4.0);
 let shift=vec2f(vegHash12(cell*.271+3.7),vegHash12(cell*.319+71.0))*8.0;
 let xz=cell+fract((vec2f(q.x*cs-q.y*sn,q.x*sn+q.y*cs)+4.0+shift)/8.0)*8.0;`;

export class GrassRootCache{
 constructor({appearance,levels,material}){
  this.appearance=appearance;this.material=material;this.maxCells=levels.reduce((n,l)=>n+l.max,0);
  const originalVertex=material.vertex;
  // Z held an unused slotRand. Reject any new reader before reusing that lane.
  const slotReaders=originalVertex.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'').replace(/\blet\s+slot\s*=\s*v\.aSlot\s*;/,'').replace(/\bslot\s*\.\s*[xyw]{1,4}\b/g,'');
  if(/\bslot\b|\bv\s*\.\s*aSlot\b/.test(slotReaders))throw Error('Grass slot Z is no longer unused');
  this.slotIds=[];
  const slots=[],byBits=new Map(),bits=new Uint32Array(2),floats=new Float32Array(bits.buffer);
  for(const level of levels){
   const attr=level.geometry.attributes.aSlot,ids=new Uint32Array(attr.count);
   for(let i=0;i<attr.count;i++){
    floats[0]=attr.getX(i);floats[1]=attr.getY(i);const key=bits[0]+','+bits[1];let id=byBits.get(key);
    if(id===undefined){id=slots.length/4;if(Math.fround(id)!==id)throw Error('Grass slot ID is not an exact f32 integer');byBits.set(key,id);slots.push(floats[0],floats[1],0,0);}
    ids[i]=id;attr.setZ(i,id);
   }
   attr.needsUpdate=true;this.slotIds.push(ids);
  }
  this.slotCount=slots.length/4;if(!this.slotCount)throw Error('Grass root cache has no template slots');
  this.slotData=new Float32Array(slots);this.cellData=new Float32Array(this.maxCells*4);
  this.writes=new Float32Array(this.maxCells*4);this.residents=new Map();
  this.keys=new Array(this.maxCells);this.liveKeys=new Set();this.freeSlots=[];this.filledCells=0;this.lastFill=0;
  this.byteLength=this.maxCells*this.slotCount*STRIDE;
  const limits=GPU.device.limits;
  if(this.byteLength>limits.maxStorageBufferBindingSize||this.byteLength>limits.maxBufferSize||Math.fround((this.maxCells-1)*this.slotCount)!==(this.maxCells-1)*this.slotCount)throw Error('Grass root cache exceeds fixed resource/address limits');
  this.buffer=new StorageBuffer({label:'Museum shared static grass roots',count:this.maxCells*this.slotCount*ROWS,type:'vec4f'});
  this.cellBuffer=new StorageBuffer({label:'Museum selected grass root cells',count:this.maxCells,type:'vec4f'});
  this.slotBuffer=new StorageBuffer({label:'Museum unique exact grass slot XY',count:this.slotCount,type:'vec4f',data:this.slotData});
  this.review=new UniformBlock('MuseumGrassRootReview',{enabled:['f32',1],ready:['f32',0],cellCount:['u32',0],writeCount:['u32',0]});
  this.module=new ShaderModule({name:'museumGrassRootCache',deps:[appearance.module,vegModule],uniforms:this.review,uniformName:'museumGrassRootReview',bindings:{museumGrassRootData:{storage:this.buffer,access:'read'}}});
  this.kernel=new ComputeKernel({label:'Museum static grass roots once per selected cell/slot',modules:[appearance.module,vegModule],bindings:{museumGrassRootReview:{uniform:this.review},museumGrassRootCells:{storage:this.cellBuffer,access:'read'},museumGrassRootSlots:{storage:this.slotBuffer,access:'read'},museumGrassRootOut:{storage:this.buffer,access:'read_write'}},code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let index=gid.x;if(index>=museumGrassRootReview.writeCount*${this.slotCount}u){return;}
 let record=museumGrassRootCells[index/${this.slotCount}u];let cell=record.xy;let slot=museumGrassRootSlots[index%${this.slotCount}u];
 ${PLACEMENT}
 let forms=museumFloraAt(xz,0.0);let height=terrainHeightAt(xz);let cover=museumCover(xz,0.0).a;
 let water=creekFieldAt(xz);let meadow=museumMeadowAt(xz,0.0);let row=(u32(record.z)+index%${this.slotCount}u)*4u;
 museumGrassRootOut[row]=forms;museumGrassRootOut[row+1u]=vec4f(xz,height,cover);
 museumGrassRootOut[row+2u]=vec4f(water.xy,meadow.lush,0.0);museumGrassRootOut[row+3u]=vec4f(meadow.tone,meadow.dry);
}`});
  this._counts=new Uint32Array(levels.length);this._valid=false;this.cells=0;this.dispatches=0;this.lastReason='uninitialized';
  this._patchCover=NaN;this._legacyWater=NaN;this._seaLevel=NaN;
  const change=(from,to)=>{if(!material.vertex.includes(from))throw Error('Pinned grass root cache seam changed: '+from.slice(0,60));material.vertex=material.vertex.replace(from,to);};
  change(PLACEMENT,`let museumRootRow=(u32(v.iCell.z)+u32(slot.z))*4u;
 let xz=museumGrassRootData[museumRootRow+1u].xy;`);
  change('let m = museumFloraAt(xz,0.0);','let m=museumGrassRootData[museumRootRow];');
  change('let mt = museumMeadowAt(xz,0.0);','let museumToneDry=museumGrassRootData[museumRootRow+3u];var mt:MeadowTone;mt.tone=museumToneDry.xyz;mt.dry=museumToneDry.w;mt.lush=museumGrassRootData[museumRootRow+2u].z;');
  change('let dist=distance(vec3f(xz.x,terrainHeightAt(xz),xz.y),vegParams.camPos);',`let museumClumpHeight=museumGrassRootData[museumRootRow+1u].z;
 let dist=distance(vec3f(xz.x,museumClumpHeight,xz.y),vegParams.camPos);`);
  change('let waterField=creekFieldAt(xz);','let waterField=vec4f(museumGrassRootData[museumRootRow+2u].xy,0.0,0.0);let museumRootCover=museumGrassRootData[museumRootRow+1u].w;');
  change('terrainHeightAt(xz)-waterField.x','museumClumpHeight-waterField.x');
  change('mix(1.0,.6,museumCover(xz,0.0).a)','mix(1.0,.6,museumRootCover)');
  material.vertex=`#if MUSEUM_GRASS_ROOT_CACHE\n${material.vertex}\n#else\n${originalVertex}\n#endif\n`;
  material.defines.MUSEUM_GRASS_ROOT_CACHE=1;
  material.modules.push(this.module);material.needsUpdate=true;
  // Normal vegetation.update prepares before draw. Also enforce it for a caller
  // switching variants while paused and then collecting a nonempty draw directly.
  const cache=this;
  for(const level of levels){
   const previous=level.mesh.onBeforeRender;
   level.mesh.onBeforeRender=function(...args){
    if(previous)previous.apply(this,args);
    if(material.defines.MUSEUM_GRASS_ROOT_CACHE===1&&!cache._valid&&level.geometry.instanceCount>0){
     cache.update(levels);
     if(!cache._valid)throw Error('Cached grass draw requires prepared root data');
    }
   };
  }
 }
 invalidate(){this._valid=false;this.review.fields.ready.value=0;}
 setEnabled(on){
  const value=on?1:0;
  if(this.review.fields.enabled.value!==value){this.review.fields.enabled.value=value;this.invalidate();}
  if(this.material.defines.MUSEUM_GRASS_ROOT_CACHE!==value){this.material.defines.MUSEUM_GRASS_ROOT_CACHE=value;this.material.needsUpdate=true;}
  return this;
 }
 update(levels,{pass=null,selectionUnchanged=false}={}){
  if(this.review.fields.enabled.value<=.5){this.invalidate();return false;}
  if(levels.length!==this._counts.length)throw Error('Grass root cache LOD count changed');
  const habitat=this.appearance.review.fields,patchCover=habitat.patchCover.value,legacyWater=habitat.legacyWater.value,seaLevel=G.seaLevel.value;
  const reviewChanged=patchCover!==this._patchCover||legacyWater!==this._legacyWater,seaChanged=seaLevel!==this._seaLevel;
  const reset=!this._valid||reviewChanged||seaChanged;
  // Only the native camera selection can certify that its instance arrays were untouched.
  if(selectionUnchanged&&!reset)return false;
  let cells=0,changed=reset;
  for(let tier=0;tier<levels.length;tier++){
   const l=levels[tier];if(l.count<0||l.count>l.max||cells+l.count>this.maxCells)throw Error('Grass root cache selected cells exceed capacity');
   if(this._counts[tier]!==l.count)changed=true;
   for(let i=0;i<l.count;i++){
    const from=i*4,to=(cells+i)*4,x=l.arr[from],z=l.arr[from+1];
    if(this.cellData[to]!==x||this.cellData[to+1]!==z)changed=true;
    this.cellData[to]=x;this.cellData[to+1]=z;
   }
   cells+=l.count;
  }
  let fills=0;
  if(changed){
   if(reset){
    this.residents.clear();this.freeSlots.length=0;
    for(let i=this.maxCells-1;i>=0;i--)this.freeSlots.push(i);
   }
   // Mark the complete new selection first: a later tier can still reference
   // a resident that an earlier tier just dropped. Draw order stays native.
   const live=this.liveKeys;live.clear();
   for(let i=0;i<cells;i++){const key=cellKey(this.cellData[4*i],this.cellData[4*i+1]);this.keys[i]=key;live.add(key);}
   for(const [key,slot] of this.residents)if(!live.has(key)){this.residents.delete(key);this.freeSlots.push(slot);}
   for(let i=0;i<cells;i++){
    const key=this.keys[i],j=i*4;let slot=this.residents.get(key);
    if(slot===undefined){
     slot=this.freeSlots.pop();if(slot===undefined)throw Error('Grass root slot budget exhausted');
     this.residents.set(key,slot);
     const k=4*fills++;this.writes[k]=this.cellData[j];this.writes[k+1]=this.cellData[j+1];this.writes[k+2]=slot*this.slotCount;
    }
    this.cellData[j+2]=slot*this.slotCount;
   }
   this.review.fields.cellCount.value=cells;this.review.fields.writeCount.value=fills;
   if(fills){
    // Selection bookkeeping is already updated. A failed upload must never
    // let the following frame use these slots as if they had been filled.
    try{this.cellBuffer.write(this.writes.subarray(0,fills*4));this.kernel.dispatch(this.kernel.groups(fills*this.slotCount),{pass});}
    catch(error){this.invalidate();throw error;}
    this.dispatches++;this.filledCells+=fills;
   }
   this.lastFill=fills;
   this.lastReason=[!this._valid?'invalidated':null,reviewChanged?'habitat review':null,seaChanged?'sea level':null,reset?null:'selection'].filter(Boolean).join(', ');
  }
  let cursor=0;
  for(let tier=0;tier<levels.length;tier++){
   const l=levels[tier];let dirty=false;
   for(let i=0;i<l.count;i++,cursor++){
    const base=this.cellData[cursor*4+2],k=i*4+2;
    if(l.arr[k]!==base){l.arr[k]=base;dirty=true;}
   }
   if(dirty){l.attr.clearUpdateRanges();l.attr.addUpdateRange(0,Math.max(1,l.count)*4);l.attr.needsUpdate=true;}
   this._counts[tier]=l.count;
  }
  this.cells=cells;this._patchCover=patchCover;this._legacyWater=legacyWater;this._seaLevel=seaLevel;this._valid=true;this.review.fields.ready.value=1;
  return fills>0;
 }
 stats(){return {enabled:this.review.fields.enabled.value>.5,variant:this.material.defines.MUSEUM_GRASS_ROOT_CACHE,materialVersion:this.material.version,ready:this.review.fields.ready.value>.5,cells:this.cells,slotsPerCell:this.slotCount,maxCells:this.maxCells,rootStrideBytes:STRIDE,bufferBytes:this.byteLength,dispatches:this.dispatches,lastReason:this.lastReason,fixedSharedBuffer:true,residentCells:this.residents.size,filledCells:this.filledCells,lastSelectionFill:this.lastFill,contents:'forms; XZ/height/cover; waterXY/lush; tone/dry',perBladeGround:'original museumGrassGround(rootXZ) retained',invalidation:'entering world cells only, shared across tiers; all residents on patchCover, legacyWater, seaLevel, explicit invalidation or reenable'};}
}
