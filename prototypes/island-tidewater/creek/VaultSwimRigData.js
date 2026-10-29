// Museum-authored bindings for static Vault swim art. No source vertex, normal,
// index, palette or aData is rewritten. Pivots use the adapter's normalized space.
import {BufferAttribute} from '../vendor/tidewater/src/engine/geometry/BufferAttribute.js';

const names=['aRig0','aRig1','aRig2'];
const supported=new Set(['dipterus','coccosteus','eusthenopteron','anomalocaris','aeger','diplomystus','aspidorhynchus']);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const distance=(a,b)=>Math.hypot(...sub(a,b));
const average=ps=>[0,1,2].map(k=>ps.reduce((s,p)=>s+p[k],0)/ps.length);
const midpoint=(a,b)=>a.map((v,i)=>(v+b[i])*.5);
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};

function principalEnds(c){
 const center=average(c.points),cov=new Float64Array(9);
 for(const p of c.points){const d=sub(p,center);for(let i=0;i<3;i++)for(let j=0;j<3;j++)cov[i*3+j]+=d[i]*d[j];}
 let axis=[1,.37,.19];
 for(let n=0;n<20;n++){const next=[0,1,2].map(i=>cov[i*3]*axis[0]+cov[i*3+1]*axis[1]+cov[i*3+2]*axis[2]),L=Math.hypot(...next);if(L<1e-14)break;axis=next.map(v=>v/L);}
 const ds=c.points.map(p=>dot(sub(p,center),axis)),lo=Math.min(...ds),hi=Math.max(...ds),margin=Math.max(1e-7,(hi-lo)*.025);
 return [lo,hi].map(end=>average(c.points.filter((_p,i)=>Math.abs(ds[i]-end)<=margin)));
}

function primitivePieces(primitive,node,offset,positions){
 const raw=primitive.attributes.POSITION.array,count=raw.length/3,parent=Int32Array.from({length:count},(_,i)=>i),weld=new Map(),indices=primitive.indices??Uint32Array.from({length:count},(_,i)=>i);
 const find=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const next=parent[i];parent[i]=r;i=next;}return r;};
 for(let i=0;i<count;i++){const key=[0,1,2].map(k=>Math.round((raw[i*3+k]+node.t[k])*1e6)).join(',');if(weld.has(key))parent[i]=find(weld.get(key));else weld.set(key,i);}
 for(let i=0;i<indices.length;i+=3){const r=find(indices[i]);parent[find(indices[i+1])]=r;parent[find(indices[i+2])]=r;}
 const groups=new Map(),byVertex=[];
 for(let i=0;i<count;i++){
  const key=find(i);let c=groups.get(key);
  if(!c){c={node:node.name,material:primitive.material??0,first:offset+i,vertices:[],points:[],rawPoints:[],triangles:0,lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};groups.set(key,c);}
  const p=Array.from(positions.subarray((offset+i)*3,(offset+i)*3+3)),r=[0,1,2].map(k=>raw[i*3+k]+node.t[k]);
  c.vertices.push(offset+i);c.points.push(p);c.rawPoints.push(r);for(let k=0;k<3;k++){c.lo[k]=Math.min(c.lo[k],p[k]);c.hi[k]=Math.max(c.hi[k],p[k]);}byVertex[i]=c;
 }
 for(let i=0;i<indices.length;i+=3)byVertex[indices[i]].triangles++;
 for(const c of groups.values()){c.center=average(c.points);c.rawCenter=average(c.rawPoints);c.ends=principalEnds(c);}
 return [...groups.values()];
}

function sourceParts(gltf,geometry,kind){
 const positions=geometry.attributes.position.array,raw=[];let offset=0,minZ=Infinity,maxZ=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const n of gltf.nodes)if(n.mesh!==undefined){
  if(n.s.some(v=>v!==1)||n.r.some((v,i)=>v!==(i===3?1:0)))throw Error('Vault swim binding requires baked transform: '+n.name);
  for(const p of gltf.meshes[n.mesh]){raw.push({node:n,primitive:p,offset});const a=p.attributes.POSITION.array;offset+=a.length/3;for(let i=0;i<a.length;i+=3){minZ=Math.min(minZ,a[i+2]+n.t[2]);maxZ=Math.max(maxZ,a[i+2]+n.t[2]);minY=Math.min(minY,a[i+1]+n.t[1]);maxY=Math.max(maxY,a[i+1]+n.t[1]);}}
 }
 if(offset!==geometry.attributes.position.count)throw Error('Vault swim collect vertex order/count changed: '+kind);
 const L=maxZ-minZ,cz=(maxZ+minZ)*.5,cy=(maxY+minY)*.5;
 const convert=p=>kind==='aeger'?[p[0]/.174,p[1]/.174,(p[2]-.045)/.174]:kind==='aspidorhynchus'?[-p[2]/.9,p[1]/.9,p[0]/.9]:[p[0]/L,(p[1]-cy)/L,(p[2]-cz)/L];
 let maxError=0;
 for(const part of raw){const a=part.primitive.attributes.POSITION.array;for(let i=0;i<a.length;i+=3){const expected=convert([0,1,2].map(k=>a[i+k]+part.node.t[k]));for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(expected[k]-positions[(part.offset+i/3)*3+k]));}}
 if(!(maxError<1e-5))throw Error('Vault swim normalized collect order changed: '+kind+' error='+maxError);
 return {pieces:raw.flatMap(p=>primitivePieces(p.primitive,p.node,p.offset,positions)),maxError,convert,sourceMinY:minY};
}

function bindingWriter(arrays,stats){
 const bound=new Set();
 const bind=(c,role,pivots,segment=0,phase=0,weight=()=>1)=>{
  if(bound.has(c))throw Error('Vault swim component bound twice: '+c.node);
  bound.add(c);const [root,joint1=root,joint2=joint1]=pivots;
  for(let n=0;n<c.vertices.length;n++){
   const i=c.vertices[n]*4,w=clamp(weight(c.points[n],n));
   arrays[0].set([...root,role+segment/4],i);arrays[1].set([...joint1,w],i);arrays[2].set([...joint2,phase],i);
  }
  stats.roles[role].components++;stats.roles[role].vertices+=c.vertices.length;
 };
 return {bind,bound};
}

function pairedFin(parts,phase,bind,stats){
 const points=parts.flatMap(c=>c.points),side=Math.sign(average(points)[0]);if(!side)return false;
 const abs=points.map(p=>Math.abs(p[0])),inner=Math.min(...abs),outer=Math.max(...abs),span=outer-inner;
 if(span<1e-5)return false;
 const edge=Math.max(1e-7,span*.065),rootPoints=points.filter((_p,i)=>abs[i]<=inner+edge),root=average(rootPoints);
 // All vertices at the source seam are pinned; distal influence ramps smoothly.
 const weight=p=>smooth((Math.abs(p[0])-inner-edge)/Math.max(1e-7,span-edge));
 const rootWeight=Math.max(...rootPoints.map(weight));stats.rootProtection.maxRootWeight=Math.max(stats.rootProtection.maxRootWeight,rootWeight);stats.rootProtection.pinnedVertices+=rootPoints.length;
 for(const c of parts)bind(c,1,[root],0,phase,weight);stats.pairedFinGroups=(stats.pairedFinGroups??0)+1;return true;
}

function lineDistance(point,a,b){const ab=sub(b,a),t=clamp(dot(sub(point,a),ab)/Math.max(1e-12,dot(ab,ab))),p=a.map((v,i)=>v+ab[i]*t);return distance(point,p);}

function aegerBindings(pieces,bind,stats){
 const limbs=pieces.filter(c=>c.material===3),chains=[];
 const chain=(parts,role,row,side)=>{
  let previous=null;const segments=parts.map(c=>{let n=previous?(distance(c.ends[0],previous)<=distance(c.ends[1],previous)?0:1):(Math.abs(c.ends[0][0])<Math.abs(c.ends[1][0])?0:1);const start=c.ends[n],end=c.ends[1-n],gap=previous?distance(start,previous):0;previous=end;return {c,start,end,gap};});
  const maximumJoin=Math.max(...segments.map(s=>s.gap));
  if(maximumJoin>.012){stats.warnings.push('Aeger chain left static: role '+role+' row '+row+' side '+side+' join '+maximumJoin);return;}
  stats.maximumChainJoin=Math.max(stats.maximumChainJoin,maximumJoin);
  const joints=[segments[0].start,...segments.slice(1).map((s,i)=>midpoint(s.start,segments[i].end))],pivots=[joints[0],joints[1]??joints[0],joints[2]??joints[1]??joints[0]],phase=row*1.1+(side>0?Math.PI:0);
  const entry={role,row,side,pivots,segments,parts:segments.map(s=>s.c),phase,end:segments.at(-1).end};chains.push(entry);
  segments.forEach((s,i)=>bind(s.c,role,pivots,Math.min(i,2),phase));stats.roles[role].chains++;
 };
 for(const side of [-1,1]){
  const walk=limbs.filter(c=>c.triangles===52&&Math.sign(c.rawCenter[0])===side).sort((a,b)=>a.first-b.first);
  const mxp=limbs.filter(c=>c.triangles===68&&Math.sign(c.rawCenter[0])===side).sort((a,b)=>a.first-b.first);
  if(walk.length===15)for(let i=0;i<5;i++)chain(walk.slice(i*3,i*3+3),3,i,side);else stats.warnings.push('Unexpected Aeger walking topology: '+side+' '+walk.length);
  if(mxp.length===4)chain(mxp,4,0,side);else stats.warnings.push('Unexpected Aeger maxilliped topology: '+side+' '+mxp.length);
 }
 // Separate source palette pieces (spines, chela tips) follow their hard segment.
 for(const c of pieces){
  const tip=c.material===2&&c.triangles===20&&Math.abs(c.rawCenter[0])>.014;
  const spine=c.material===4&&Math.abs(c.rawCenter[0])>.006;
  if(!tip&&!spine)continue;
  let nearest=null;for(const chain of chains)if(chain.side===Math.sign(c.rawCenter[0]))for(const [i,s]of chain.segments.entries()){const d=lineDistance(c.center,s.start,s.end);if(!nearest||d<nearest.d)nearest={chain,i,d};}
  if(nearest&&nearest.d<.028){bind(c,nearest.chain.role,nearest.chain.pivots,Math.min(nearest.i,2),nearest.chain.phase);nearest.chain.parts.push(c);}else stats.warnings.push('Aeger detached tip kept static: '+c.first);
 }
 // Five abdominal pairs: each stem and both terminal leaves share one hinge.
 for(const side of [-1,1]){
  const sameSide=c=>c.material===2&&Math.sign(c.rawCenter[0])===side&&c.rawCenter[2]<-.003;
  const stems=pieces.filter(c=>sameSide(c)&&c.triangles===20&&Math.abs(c.rawCenter[0])<.005&&c.rawCenter[1]>0).sort((a,b)=>b.rawCenter[2]-a.rawCenter[2]);
  const leaves=pieces.filter(c=>sameSide(c)&&c.triangles===28&&Math.abs(c.rawCenter[0])<.008&&c.rawCenter[1]>-.003);
  if(stems.length!==5){stats.warnings.push('Unexpected Aeger swimmeret stems: '+side+' '+stems.length);continue;}
  for(const [row,stem]of stems.entries()){
   const own=leaves.filter(c=>stems.reduce((best,s)=>distance(c.center,s.center)<distance(c.center,best.center)?s:best,stems[0])===stem);
   if(own.length!==2){stats.warnings.push('Aeger swimmeret left static: '+side+' '+row);continue;}
   const root=stem.ends[0][1]>=stem.ends[1][1]?stem.ends[0]:stem.ends[1],phase=row*1.1;
   for(const c of [stem,...own])bind(c,5,[root],0,phase);stats.roles[5].chains++;
  }
 }
 // Long antennae and the four anterior fine feelers, never thoracic limbs.
 for(const c of limbs)if(c.triangles===94||c.triangles===32&&c.rawCenter[2]>.045){
  const root=c.ends[0][2]<c.ends[1][2]?c.ends[0]:c.ends[1],tip=c.ends[0]===root?c.ends[1]:c.ends[0],axis=sub(tip,root),L2=Math.max(1e-9,dot(axis,axis));
  bind(c,2,[root],0,(c.rawCenter[0]>0?Math.PI:0)+c.first*.003,p=>smooth(dot(sub(p,root),axis)/L2));
 }
 const footPoints=chains.filter(c=>c.role===3).flatMap(c=>c.parts.flatMap(p=>p.rawPoints)),minFootY=footPoints.length?Math.min(...footPoints.map(p=>p[1])):null;
 stats.aeger={walkingChains:stats.roles[3].chains,maxillipedChains:stats.roles[4].chains,swimmeretPairs:stats.roles[5].chains/2,sourceFootMinY:minFootY,normalizedFootMinY:minFootY===null?null:minFootY/.174,bedCenterFormula:'bedY - minY * displayedLength + 0.001 to 0.003 metres',exampleLength:.174,exampleCenterAboveBed:minFootY===null?null:-minFootY+.002};
}

/** aRig0.xyz=root, w=role+segment/4; aRig1.xyz=joint1,w=weight;
 * aRig2.xyz=joint2,w=phase in radians. Roles: 1 paired fin/lobe, 2 feeler,
 * 3 walking chain, 4 maxilliped chain, 5 abdominal swimmeret. Role 0 is static.
 */
export function prepareVaultSwimGeometry(geometry,kind,gltf){
 const count=geometry.attributes.position.count,arrays=names.map(()=>new Float32Array(count*4)),pos=geometry.attributes.position.array;
 const stats={kind,vertices:count,roles:Object.fromEntries([1,2,3,4,5].map(r=>[r,{components:0,vertices:0,chains:0}])),staticComponents:0,minY:Infinity,maxY:-Infinity,sourceOrderMaxError:0,zeroPoseMaxError:0,rootProtection:{maxRootWeight:0,pinnedVertices:0},maximumChainJoin:0,warnings:[]};
 for(let i=1;i<pos.length;i+=3){stats.minY=Math.min(stats.minY,pos[i]);stats.maxY=Math.max(stats.maxY,pos[i]);}
 if(supported.has(kind)&&gltf){
  const source=sourceParts(gltf,geometry,kind),pieces=source.pieces,{bind,bound}=bindingWriter(arrays,stats);stats.sourceOrderMaxError=source.maxError;stats.sourceComponents=pieces.length;stats.sourceMinY=source.sourceMinY;
  if(kind==='aeger')aegerBindings(pieces,bind,stats);
  else if(['dipterus','coccosteus','eusthenopteron'].includes(kind)){
   // A fleshy fin and its disconnected ray/detail pieces are one organ. Their
   // common coordinate weight field prevents a ray from hinging on its own tip.
   const groups=new Map();for(const c of pieces)if(/pectoral|pelvic/i.test(c.node)){const key=c.node+':'+Math.sign(c.center[0]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
   for(const parts of groups.values()){const phase=(parts[0].center[0]>0?Math.PI:0)+(/pelvic/i.test(parts[0].node)?1.3:0);pairedFin(parts,phase,bind,stats);}
  }
  else for(const c of pieces){
   const name=c.node.toLowerCase(),side=Math.sign(c.center[0]);let paired=false,phase=side>0?Math.PI:0;
   if(kind==='anomalocaris'){
    paired=name.includes('flaps')||name.includes('tail-fan');
    if(name.includes('flaps'))phase=Math.round((.088974-c.rawCenter[2])/.0244854)*.55;
    else if(name.includes('tail-fan'))phase=2;
   }
   else if(kind==='diplomystus'||kind==='aspidorhynchus'){
    if(name.includes('fins')){
     // Median fins straddle x=0 after the source-axis conversion; only fully
     // lateral components can become paired fins. Rays remain with the body.
     const width=c.hi[0]-c.lo[0],oneSide=c.lo[0]>1e-5||c.hi[0]<-1e-5;
     paired=oneSide&&width>.012&&Math.abs(c.center[0])>.025;
    }
   }
   if(paired)pairedFin([c],phase,bind,stats);
  }
  stats.staticComponents=pieces.length-bound.size;
  stats.boundComponents=bound.size;
  if(!bound.size)stats.warnings.push('No reliable local bindings; source remains static');
 }else stats.warnings.push('Native or unsupported kind: zero local-rig attributes');
 for(let i=0;i<3;i++)geometry.setAttribute(names[i],new BufferAttribute(arrays[i],4));
 geometry.vaultRigStats=stats;return geometry;
}

/** ReefBatch only merges four built-in attributes. Install local rig data in
 * the same kind/vertex order, with zero padding for every native LOD kind. */
export function installVaultSwimAttributes(batch){
 const count=batch.geometry.attributes.position.count,merged=names.map(()=>new Float32Array(count*4));let offset=0;
 for(const kind of batch.kinds){
  const g=kind.geometry,n=g.attributes.position.count;
  for(let i=0;i<3;i++){
   const a=g.attributes[names[i]];
   if(a&&(a.itemSize!==4||a.count!==n))throw Error('Vault swim batch attribute size mismatch: '+names[i]);
   if(a)merged[i].set(a.array,offset*4);
   else g.setAttribute(names[i],new BufferAttribute(new Float32Array(n*4),4));
  }
  offset+=n;
 }
 if(offset!==count)throw Error('Vault swim batch vertex order/count mismatch');
 for(let i=0;i<3;i++){const a=new BufferAttribute(merged[i],4);batch.geometry.setAttribute(names[i],a);if(batch.fadeGeometry)batch.fadeGeometry.setAttribute(names[i],a);}
 batch.vaultRigStats={vertices:count,attributeBytes:count*4*4*3,kinds:batch.kinds.map(k=>k.geometry.vaultRigStats??null),fadeSharesAttributes:!!batch.fadeGeometry};return batch;
}
