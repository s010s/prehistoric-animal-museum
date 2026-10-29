// Museum-authored functional rigs for static Lowpoly Vault art. Raw GLBs stay
// unchanged. Every colour, shadow and velocity pass uses native GPU skinning.
import {BufferAttribute,Color,Euler,Quaternion,Sphere,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {SkinnedModel} from '../vendor/tidewater/src/engine/render/Skinning.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const length=v=>Math.hypot(...v);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const distance=(a,b)=>length(sub(a,b));
const q=new Quaternion(),euler=new Euler();
const geometryCache=new WeakMap();

class Rig {
 constructor(kind){this.kind=kind;this.bones=[];this.names=new Map();this.motion=[];this.probes=[];this.legs=[];this.claws=[];this.wings=[];this.diagnostics={};this.lastState={};}
 bone(name,parent,at){const i=this.bones.length;this.bones.push({name,parent,at:[...at]});this.names.set(name,i);return i;}
 drive(index,fn){this.motion.push({index,fn});return index;}
 index(name){const i=this.names.get(name);if(i===undefined)throw Error('Missing Vault rig bone '+name);return i;}
 pose(time,activity=1,clock=time){for(const d of this.motion){const r=d.fn(time,activity,clock);if(r.isQuaternion){q.copy(r);euler.setFromQuaternion(q,'XYZ');d.euler=[euler.x,euler.y,euler.z];}else{q.setFromEuler(euler.set(r[0]??0,r[1]??0,r[2]??0,'XYZ'));d.euler=r;}d.channel.values.set(q.toArray());}this.lastState={time,activity,clock};}
}
function blend(a,b,t){return [...a.map(([i,w])=>[i,w*(1-t)]),...b.map(([i,w])=>[i,w*t])];}
function packed(weights){const sums=new Map();for(const [i,w]of weights)if(w>1e-7)sums.set(i,(sums.get(i)??0)+w);const p=[...sums].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=p.reduce((s,v)=>s+v[1],0);if(!(sum>0))throw Error('Unweighted Vault vertex');return p.map(([i,w])=>[i,w/sum]);}
function chainWeight(indices,positions,x){
 if(x<=positions[0])return [[indices[0],1]];
 for(let i=1;i<positions.length;i++)if(x<positions[i])return [[indices[i-1],1-smooth(positions[i-1],positions[i],x)],[indices[i],smooth(positions[i-1],positions[i],x)]];
 return [[indices.at(-1),1]];
}
function hingedWeight(indices,ranges,x){
 for(let i=0;i<ranges.length;i++){const [a,b]=ranges[i];if(x<a)return [[indices[i],1]];if(x<b){const t=smooth(a,b,x);return [[indices[i],1-t],[indices[i+1],t]];}}
 return [[indices.at(-1),1]];
}

function pterosaurRig(kind){
 const p=kind==='pterodaustro',rig=new Rig(kind),body=rig.bone('thorax',-1,[0,0,0]);
 const neck0=rig.bone('neck-root',body,p?[0,.055,.11]:[0,.048,.075]),head=rig.bone('head',neck0,p?[0,.14,.30]:[0,.065,.14]);
 rig.drive(neck0,t=>[Math.sin(t*.83)*.020,Math.sin(t*.47)*.024,0]);
 rig.drive(head,t=>[Math.sin(t*.83-1.1)*.018,Math.sin(t*.47+.4)*.045,0]);
 const tails=p?[]:[rig.bone('tail-base',body,[0,.04,-.10])];
 if(!p){tails.push(rig.bone('tail-middle',tails[0],[0,.04,-.25]));tails.push(rig.bone('tail-vane',tails[1],[0,.043,-.38]));for(const [i,b]of tails.entries())rig.drive(b,t=>[.012*Math.sin(t*.65-i*.45),.026*Math.sin(t*.71-i*.65),0]);}
 const bodyWeight=v=>{
  if(v[2]>(p?.11:.075)&&Math.abs(v[0])<(p?.055:.036))return chainWeight([body,neck0,head],p?[.11,.20,.32]:[.075,.108,.145],v[2]);
  if(!p&&v[2]<-.075&&Math.abs(v[0])<.028)return chainWeight([body,...tails],[.075,.10,.25,.38],-v[2]);
  return [[body,1]];
 };
 for(const side of [-1,1]){
  const name=side<0?'left':'right',positions=p?[[.055,.024,.115],[.25,.058,.17],[.48,.055,.19],[.85,.089,.055]]:[[.026,.046,.052],[.105,.057,.075],[.175,.055,.095],[.36,.079,.045]];
  const bones=[];for(let i=0;i<positions.length;i++)bones.push(rig.bone(name+'-'+['shoulder','elbow','wrist','wing-digit'][i],i?bones[i-1]:body,[positions[i][0]*side,positions[i][1],positions[i][2]]));
  const flight=(t,offset=0)=>{const c=t%(p?18:15),end=p?11:9,start=1.2,gate=smooth(0,start,c)*(1-smooth(end-1.4,end,c)),stroke=Math.sin(t*(p?2.7:4.05)+offset);return {gate,stroke};};
  const ankle=p?[side*.18,-.053,-.35]:[side*.07,.007,-.12],axis=new Vector3(...sub(rig.bones[bones[0]].at,ankle)).normalize(),flapQ=new Quaternion();
  rig.drive(bones[0],t=>{const f=flight(t);return flapQ.setFromAxisAngle(axis,side*(.025+f.gate*(.10+.55*f.stroke)));});
  rig.drive(bones[1],t=>{const f=flight(t,-.55);return [0,-side*(.020+.065*f.gate*(.5+.5*f.stroke)),side*.045*f.gate*Math.sin(t*(p?2.7:4.05)-.6)];});
  rig.drive(bones[2],t=>{const f=flight(t,-.95);return [(.020+.06*f.gate*f.stroke),-side*.04*f.gate*(.5+.5*f.stroke),0];});
  rig.drive(bones[3],t=>{const f=flight(t,-1.2);return [.035*f.gate*f.stroke,0,side*.04*f.gate*f.stroke];});
  rig.wings.push({side,bones});
 }
 rig.weight=(v,node)=>{
  const wing=p?/Wing|Forelimbs/.test(node)||(/Claws/.test(node)&&v[2]>.1&&Math.abs(v[0])>.25):/integrated closed ankle-attached wing|manual digits|manual claws/.test(node);
  if(!wing)return bodyWeight(v);
  const side=v[0]<0?-1:1,w=rig.wings.find(w=>w.side===side),x=Math.abs(v[0]);
  // The body-to-ankle edge remains anchored, including the trailing membrane.
  const edge=p?mix(.055,.18,clamp((.115-v[2])/.465)):mix(.026,.07,clamp((.057-v[2])/.177));
  const strength=smooth(edge+.002,edge+(p?.06:.035),x);
  // The posterior edge converges on the ankle, not the shoulder. Measure
  // span from that edge so an ankle vertex never receives an elbow/wrist
  // weight just because its absolute x is near the forelimb elbow.
  const shoulder=p?.055:.026,tip=p?1.2:.6,span=shoulder+Math.max(0,x-edge)*(tip-shoulder)/(tip-edge);
  const weights=hingedWeight(w.bones,p?[[.19,.31],[.40,.56],[.74,.96]]:[[.065,.145],[.145,.205],[.31,.41]],span);
  return blend(bodyWeight(v),weights,strength);
 };
 rig.probes=[rig.wings[0].bones[2],rig.wings[1].bones[2],head,...tails.slice(-1)];
 rig.diagnostics={method:'museum functional shoulder/elbow/wrist/digit chains derived from source geometry, with a shared membrane/arm/claw field and shoulder-to-ankle flap axis; not fossil joint reconstruction',sourceSkeleton:false,shoulderAxisStrokeDegrees:[-.425*180/Math.PI,.675*180/Math.PI],wingspanMetres:p?2.4:1.2,glideSeconds:p?7:6};
 return rig;
}

function insectRig(){
 const rig=new Rig('meganeura'),body=rig.bone('rigid-thorax',-1,[0,0,0]),head=rig.bone('head',body,[0,.055,.036]);
 rig.drive(head,t=>[.025*Math.sin(t*1.1),.08*Math.sin(t*.64),0]);
 const tails=[];for(let i=0;i<4;i++){const b=rig.bone('abdomen-'+i,i?tails[i-1]:body,[0,.052-i*.006,-.036-i*.075]);tails.push(b);rig.drive(b,(t,a)=>[.014*Math.sin(t*.71-i*.5)+a*.015,.016*Math.sin(t*.63-i*.45),0]);}
 for(const side of [-1,1])for(const pair of [0,1]){
  const root=[side*(pair?.018:.017),.08,pair?-.025:.03],b=rig.bone((side<0?'left':'right')+'-'+(pair?'hind':'fore')+'-wing-root',body,root),tip=rig.bone((side<0?'left':'right')+'-'+(pair?'hind':'fore')+'-wing-camber',b,[side*.205,.083,pair?-.064:.035]);
  rig.drive(b,(t,a)=>[0,side*a*.065*Math.cos(t*50+pair*1.25),side*(.025+a*(.08+.60*Math.sin(t*50+pair*1.25)))]);
  rig.drive(tip,(t,a)=>[a*.12*Math.sin(t*50+pair*1.25-.55),0,side*a*.035*Math.sin(t*50+pair*1.25-.55)]);
  rig.wings.push({side,pair,bones:[b,tip]});
 }
 const legs=[];for(const side of [-1,1])for(let i=0;i<3;i++){
  const root=[side*.014,.05,[.027,0,-.034][i]],hip=rig.bone((side<0?'left':'right')+'-leg-'+i,body,root),knee=rig.bone((side<0?'left':'right')+'-tarsus-'+i,hip,[side*[.032,.04,.048][i],.025,[.044,.002,-.06][i]]);
  rig.drive(hip,(t,a)=>[a*.08,side*a*.12,side*a*.22]);rig.drive(knee,(t,a)=>[a*.05,0,-side*a*.18]);legs.push({side,i,bones:[hip,knee]});
 }
 rig.weight=(v,node)=>{
  if(/wing-/.test(node)){const pair=node.startsWith('forewing')?0:1,side=v[0]<0?-1:1,w=rig.wings.find(w=>w.side===side&&w.pair===pair),x=Math.abs(v[0]),root=pair?.018:.017,s=smooth(root,root+.028,x);return blend([[body,1]],chainWeight(w.bones,[root,.205],x),s);}
  if(node.startsWith('leg-')){const match=/leg-(\d)-(left|right)/.exec(node),leg=legs.find(l=>l.side===(match[2]==='left'?-1:1)&&l.i===+match[1]-1);return chainWeight(leg.bones,[.014,[.032,.04,.048][leg.i]],Math.abs(v[0]));}
  if(/head|eye-|mandible|antennae/.test(node))return blend([[body,1]],[[head,1]],smooth(.027,.041,v[2]));
  if(/abdomen|cerci/.test(node))return chainWeight([body,...tails],[.025,.036,.111,.186,.261],-v[2]);
  return [[body,1]];
 };
 rig.legs=legs;rig.probes=[rig.wings[0].bones[1],rig.wings[1].bones[1],head,tails.at(-1)];
 rig.diagnostics={method:'four separately phased wing-root/camber pairs, rigid thorax, segmented abdomen and six tucking leg chains; common membrane/vein weights',sourceSkeleton:false,wingStrokeDegrees:[-29,40],flightHz:50/(Math.PI*2)};
 return rig;
}

// Source faces are flat-shaded and contain duplicated vertices. Welding is
// used only to identify rigid source pieces; the rendered topology is retained.
function components(P,ix,t){
 const count=P.length/3,parent=Int32Array.from({length:count},(_,i)=>i),weld=new Map();
 const find=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const n=parent[i];parent[i]=r;i=n;}return r;};
 for(let i=0;i<count;i++){const key=[0,1,2].map(k=>Math.round((P[i*3+k]+t[k])*1e6)).join(',');if(weld.has(key))parent[i]=find(weld.get(key));else weld.set(key,i);}
 for(let i=0;i<ix.length;i+=3){const r=find(ix[i]);parent[find(ix[i+1])]=r;parent[find(ix[i+2])]=r;}
 const map=new Map(),byVertex=[];
 for(let i=0;i<count;i++){const r=find(i);let c=map.get(r);if(!c){c={vertices:[],triangles:0,center:[0,0,0],lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};map.set(r,c);}const p=[0,1,2].map(k=>P[i*3+k]+t[k]);c.vertices.push({index:i,p});for(let k=0;k<3;k++){c.center[k]+=p[k];c.lo[k]=Math.min(c.lo[k],p[k]);c.hi[k]=Math.max(c.hi[k],p[k]);}byVertex[i]=c;}
 for(let i=0;i<ix.length;i+=3)byVertex[ix[i]].triangles++;
 for(const c of map.values()){c.center=c.center.map(v=>v/c.vertices.length);c.ends=principalEnds(c);}
 return {pieces:[...map.values()],byVertex};
}
function principalEnds(c){
 const cov=new Float64Array(9);for(const {p}of c.vertices){const d=sub(p,c.center);for(let i=0;i<3;i++)for(let j=0;j<3;j++)cov[i*3+j]+=d[i]*d[j];}
 let axis=[1,.37,.19];for(let n=0;n<16;n++){const b=[0,1,2].map(i=>cov[i*3]*axis[0]+cov[i*3+1]*axis[1]+cov[i*3+2]*axis[2]),l=length(b);if(l<1e-15)break;axis=b.map(v=>v/l);}
 const ds=c.vertices.map(v=>sub(v.p,c.center).reduce((s,x,i)=>s+x*axis[i],0)),lo=Math.min(...ds),hi=Math.max(...ds);
 return [lo,hi].map(d=>{const close=c.vertices.filter((v,i)=>Math.abs(ds[i]-d)<Math.max(1e-7,(hi-lo)*.025));return [0,1,2].map(k=>close.reduce((s,v)=>s+v.p[k],0)/close.length);});
}

function eryonRig(flat){
 const rig=new Rig('eryon'),body=rig.bone('rigid-carapace',-1,[0,0,0]),tails=[];
 for(let i=0;i<6;i++){const b=rig.bone('abdomen-plate-'+i,i?tails[i-1]:body,[0,.0108-i*.0006,-.02525-i*.006]);tails.push(b);rig.drive(b,t=>[.004+.012*(1+Math.sin(t*.9-i*.4))*.5+.045*Math.pow(Math.max(0,Math.sin(t*.31)),6),.005*Math.sin(t*.75-i*.3),0]);}
 const fans=[-1,1].map(side=>{const b=rig.bone((side<0?'left':'right')+'-tail-fan',tails[5],[side*.0035,.0045,-.0599]);rig.drive(b,t=>[0,side*.12*(.5+.5*Math.sin(t*.7)),0]);return b;});
 const limbs=flat.filter(p=>p.name==='Eryon_limb').flatMap(p=>p.components.pieces).filter(c=>c.triangles===44),used=new Set();
 // This source lays out each rigid leg chain consecutively, front to back.
 // A global nearest-neighbour walk steals adjoining feet in the close rows.
 // Guard the source topology and preserve its explicit 4/3/3/3/3 segment order.
 const chains=[];
 for(const side of [-1,1]){const pieces=limbs.filter(c=>Math.sign(c.center[0])===side);if(pieces.length!==16)throw Error('Eryon source leg topology changed');let offset=0;for(let i=0;i<5;i++){const count=i?3:4;chains.push({side,i,parts:pieces.slice(offset,offset+count)});offset+=count;}}
 let maximumJoin=0;
 for(const {side,i,parts}of chains){
  let point=null,prev=body;const bones=[];
  for(const [j,c]of parts.entries()){
   const near=j?(distance(point,c.ends[0])<distance(point,c.ends[1])?0:1):(Math.abs(c.ends[0][0])<Math.abs(c.ends[1][0])?0:1),start=c.ends[near],end=c.ends[1-near],gap=j?distance(point,start):0;
   if(gap>1e-6)throw Error(`Eryon source leg joint changed side=${side} row=${i} link=${j} gap=${gap}`);
   used.add(c);maximumJoin=Math.max(maximumJoin,gap);
   const b=rig.bone((side<0?'left':'right')+'-leg-'+i+'-link-'+j,prev,start);bones.push(b);c.rigBone=b;point=end;prev=b;
  }
  const phase=i*.16+(side>0?.5:0),leg={side,i,bones,parts,end:point,phase};rig.legs.push(leg);
  for(const [j,b]of bones.entries())rig.drive(b,(t,a,clock)=>{const p=(clock*2.3+phase)%1,duty=.68,stance=p<duty,swing=stance?0:Math.sin((p-duty)/(1-duty)*Math.PI),sweep=stance?mix(-.20,.20,p/duty):.20*Math.cos((p-duty)/(1-duty)*Math.PI);return [0,side*(j===0?sweep:j===1?-.025*Math.sin(p*Math.PI*2):0),side*swing*a*(j===0?.10:j===1?.045:j===2?-.035:0)];});
 }
 if(used.size!==32)throw Error('Eryon leg segment coverage changed');
 const nearestLeg=c=>rig.legs.filter(l=>l.side===Math.sign(c.center[0])).sort((a,b)=>distance(c.center,a.end)-distance(c.center,b.end))[0];
 for(const part of flat)for(const c of part.components.pieces){
  if(part.name==='Eryon_limb'){c.rigBone??=body;continue;}
  if(part.name==='Eryon_shell'&&c.triangles===76){c.rigBone=tails[clamp(Math.floor((-c.center[2]-.02525)/.006),0,5)];continue;}
  if(part.name==='Eryon_margin'&&c.triangles===38){
   const leg=nearestLeg(c),pair=rig.claws.filter(a=>a.leg===leg).length,ends=c.ends,at=distance(ends[0],leg.end)<distance(ends[1],leg.end)?ends[0]:ends[1],b=rig.bone((leg.side<0?'left':'right')+'-claw-'+leg.i+'-'+pair,leg.bones.at(-1),at);
   c.rigBone=b;rig.claws.push({leg,b,pair});rig.drive(b,(t,a)=>[0,(pair?1:-1)*(.025+(1-a)*.14*(.5+.5*Math.sin(t*.85+leg.i*.5))),0]);continue;
  }
  if(part.name==='Eryon_margin'&&c.triangles===32&&c.center[2]>.027){const end=c.ends[0][2]<c.ends[1][2]?c.ends[0]:c.ends[1],b=rig.bone('antenna-'+rig.bones.length,body,end),side=Math.sign(c.center[0]);c.rigBone=b;rig.drive(b,t=>[.08*Math.sin(t*.9),side*.25*Math.sin(t*.73+Math.abs(c.center[0])*60),0]);continue;}
  if(c.center[2]<-.059){c.rigBone=Math.abs(c.center[0])>.003?fans[c.center[0]<0?0:1]:tails[5];continue;}
  if(c.center[2]<-.026&&part.name!=='Eryon_ventral'){c.rigBone=tails[clamp(Math.floor((-c.center[2]-.02525)/.006),0,5)];continue;}
  c.rigBone=body;
 }
 rig.weight=(v,node,part,i)=>node==='Eryon_ventral'?chainWeight([body,...tails],[.022,.02525,.03125,.03725,.04325,.04925,.05525],-v[2]):[[part.components.byVertex[i].rigBone,1]];
 rig.probes=[rig.legs[0].bones[1],rig.legs[5].bones[1],tails[5],rig.claws[0].b];
 rig.diagnostics={method:'ten individually phased 3/4-link source limb chains, sixteen chela tips, six hard abdominal plates, four antenna roots; rigid carapace',sourceSkeleton:false,walkingPairs:5,legSegments:32,maximumSourceSegmentJoinMetres:maximumJoin,hipSweepDegrees:[-11.46,11.46],stanceDuty:.68,nominalGaitHz:2.3};
 return rig;
}

function flattened(gltf){
 const out=[];for(const node of gltf.nodes){if(node.mesh===undefined)continue;if(node.s.some(v=>v!==1)||node.r.some((v,i)=>v!==(i===3?1:0)))throw Error('Vault rig requires baked source rotation/scale: '+node.name);
  for(const primitive of gltf.meshes[node.mesh]){const P=primitive.attributes.POSITION.array,ix=primitive.indices??Uint32Array.from({length:P.length/3},(_,i)=>i);out.push({name:node.name,t:node.t,primitive,components:components(P,ix,node.t)});}
 }return out;
}
export function buildVaultArticulation(gltf,kind){
 if(gltf.skins.length||gltf.animations.length)throw Error('Vault source has acquired an authored rig; review rather than replace it');
 const flat=flattened(gltf),rig=kind==='eryon'?eryonRig(flat):kind==='meganeura'?insectRig():pterosaurRig(kind);
 const positions=[],normals=[],colours=[],joints=[],weights=[],indices=[],partSpans=[];let sourceTriangles=0;
 for(const part of flat){const {primitive,t,name}=part,A=primitive.attributes,P=A.POSITION.array,N=A.NORMAL?.array,material=gltf.materials[primitive.material??0],color=material?.pbrMetallicRoughness?.baseColorFactor??[.5,.5,.5,1],offset=positions.length/3;
  if(material?.pbrMetallicRoughness?.baseColorTexture||color[3]<.999)throw Error('Vault articulation palette needs a texture/alpha path');
  for(let i=0;i<P.length/3;i++){const v=[0,1,2].map(k=>P[i*3+k]+t[k]),w=packed(rig.weight(v,name,part,i));positions.push(...v);normals.push(N?.[i*3]??0,N?.[i*3+1]??1,N?.[i*3+2]??0);colours.push(...color.slice(0,3));for(let j=0;j<4;j++){joints.push(w[j]?.[0]??0);weights.push(w[j]?.[1]??0);}}
  const ix=primitive.indices??Uint32Array.from({length:P.length/3},(_,i)=>i);for(const i of ix)indices.push(offset+i);sourceTriangles+=ix.length/3;partSpans.push({name,start:offset,count:P.length/3});
 }
 const nodes=[{name:kind+' source geometry',mesh:0,skin:0,t:[0,0,0],r:[0,0,0,1],s:[1,1,1],children:[]}],inverse=new Float32Array(rig.bones.length*16);
 for(const [i,b]of rig.bones.entries()){nodes.push({name:b.name,t:b.parent<0?[...b.at]:sub(b.at,rig.bones[b.parent].at),r:[0,0,0,1],s:[1,1,1],children:[]});nodes[b.parent<0?0:b.parent+1].children.push(i+1);inverse.set([1,0,0,0,0,1,0,0,0,0,1,0,-b.at[0],-b.at[1],-b.at[2],1],i*16);}
 const channels=rig.motion.map(d=>{const c={node:d.index+1,path:'rotation',times:new Float32Array([0]),values:new Float32Array([0,0,0,1]),step:false};d.channel=c;return c;});
 const attr=(array,itemSize,type='VEC3')=>({array,itemSize,type,normalized:false,componentType:array instanceof Uint32Array?5125:5126});
 const primitive={attributes:{POSITION:attr(Float32Array.from(positions),3),NORMAL:attr(Float32Array.from(normals),3),COLOR_0:attr(Float32Array.from(colours),3),JOINTS_0:attr(Uint32Array.from(joints),4,'VEC4'),WEIGHTS_0:attr(Float32Array.from(weights),4,'VEC4')},indices:Uint32Array.from(indices),material:0};
 rig.gltf={nodes,roots:[0],meshes:[[primitive]],materials:[{name:'Vault source vertex palette',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],roughnessFactor:.79,metallicFactor:0}}],skins:[{name:kind+' museum functional skeleton',joints:rig.bones.map((_,i)=>i+1),inverseBindMatrices:inverse}],animations:[{name:'museum functional motion',duration:1e9,channels}],textures:[],images:[]};
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],positions[i+k]);hi[k]=Math.max(hi[k],positions[i+k]);}
 rig.info={kind,joints:rig.bones.length,sourcePieces:flat.length,sourceVertices:positions.length/3,sourceTriangles,sourceSkins:gltf.skins.length,sourceClips:gltf.animations.length,draws:1,bounds:{min:lo,max:hi},parts:partSpans,...rig.diagnostics};rig.primitive=primitive;return rig;
}

export async function createVaultArticulatedModel(gltf,kind){
 const rig=buildVaultArticulation(gltf,kind),model=await SkinnedModel.create(rig.gltf,{materials:()=>({color:new Color(1,1,1),metalness:0,surface:'s.specularIntensity=.13;s.translucency=s.albedo*.035;'})});
 const mesh=model.meshes[0],cached=geometryCache.get(gltf)?.get(kind);if(cached)mesh.geometry=cached;else{mesh.geometry.setAttribute('color',new BufferAttribute(rig.primitive.attributes.COLOR_0.array,3));const center=new Vector3(...rig.info.bounds.min.map((v,i)=>(v+rig.info.bounds.max[i])*.5)),radius=Math.hypot(...rig.info.bounds.max.map((v,i)=>(v-rig.info.bounds.min[i])*.5))*1.6+.02;mesh.geometry.boundingSphere=new Sphere(center,radius);if(!geometryCache.has(gltf))geometryCache.set(gltf,new Map());geometryCache.get(gltf).set(kind,mesh.geometry);}
 for(const material of model.materials){material.vertexColors=true;material.name='museum-rigged-'+kind;}
 mesh.frustumCulled=true;mesh.receiveShadow=true;model.group.name='Vault functional rig '+kind;model.play('museum functional motion',{fade:0,loop:true});let lastTime=null;
 const handles=rig.bones.map((b,i)=>({name:b.name,index:i,rotation:new Euler(),position:new Vector3(...b.at)}));
 const update=(time,activity=1,clock=time)=>{
  if(!model.group.visible){if(lastTime!==null)model.hold();lastTime=null;return;}
  rig.pose(time,activity,clock);for(const d of rig.motion)handles[d.index].rotation.set(...d.euler,'XYZ');
  const dt=lastTime===null?0:time-lastTime;model.update(dt<=0||dt>.20?0:dt);if(lastTime===null||dt>.20)for(const m of model.meshes)m.resetVelocity=true;lastTime=time;
 };
 const hold=()=>{model.hold();lastTime=null;};
 const stats=()=>({kind,joints:model.joints,sourceSkins:0,sourceClips:0,sourcePieces:rig.info.sourcePieces,triangles:rig.info.sourceTriangles,draws:1,held:model._held,activity:rig.lastState.activity??0,localPose:rig.probes.flatMap(i=>[12,13,14,0,5,10].map(k=>model.world[(i+1)*16+k])),probeNames:rig.probes.map(i=>rig.bones[i].name),method:rig.info.method,diagnostics:rig.diagnostics});
 update(0,kind==='meganeura'?0:1);hold();return {root:model.group,model,rig,handles,update,hold,stats,bone:name=>handles[rig.index(name)]};
}

export function eryonWalkState(time){
 const period=14,active=9,ramp=.8,n=Math.floor(time/period),t=time-n*period,integral=t<=0?0:t<ramp?.5*t-ramp/(2*Math.PI)*Math.sin(Math.PI*t/ramp):t<active-ramp?t-ramp*.5:t<active?active-ramp-.5*(active-t)+ramp/(2*Math.PI)*Math.sin(Math.PI*(active-t)/ramp):active-ramp;
 const activity=t<ramp?.5-.5*Math.cos(Math.PI*t/ramp):t<active-ramp?1:t<active?.5-.5*Math.cos(Math.PI*(active-t)/ramp):0;
 return {clock:n*(active-ramp)+integral,activity};
}
