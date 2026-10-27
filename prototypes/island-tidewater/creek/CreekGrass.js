// Native blue-noise patches and actual 35/12/2 triangle LOD stay intact.
// Adapt only placement, shared ground appearance and museum habitat forms.
import {Float32BufferAttribute,InstancedBufferAttribute,DynamicDrawUsage} from '../vendor/tidewater/src/engine/index.js';
import {GrassField,CELL} from '../vendor/tidewater/src/world/vegetation/GrassField.js';
import {GPU,StorageBuffer,ComputeKernel,readBuffer} from '../vendor/tidewater/src/engine/webgpu.js';

// Occupancy is only a conservative CPU acceleration structure. The real
// density texture and world-fixed probability remain in museumFloraAt.
function occupancyMask(data){
 const raw=data.grass,bytes=new Uint8Array(raw.data);
 for(let i=0;i<bytes.length;i++)if(bytes[i]>0&&bytes[i]<9)bytes[i]=9;
 const fine=data.masks,n=data.geography.maskRes,t=data.coverTerrain??data.terrain;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(fine[(j*n+i)*4+1]){
  const x=-512+(i+.5)*1024/n,z=-512+(j+.5)*1024/n;
  if(Math.max(Math.abs(x),Math.abs(z))>496)continue;
  const ci=Math.max(0,Math.min(raw.res-1,Math.floor((x-t.origin)/t.size*raw.res))),cj=Math.max(0,Math.min(raw.res-1,Math.floor((z-t.origin)/t.size*raw.res)));
  bytes[(cj*raw.res+ci)*4+1]=255;
 }
 return {res:raw.res,data:bytes};
}

export class CreekGrass extends GrassField {
 constructor({data,terrainGPU}){
  super({terrain:data.coverTerrain??data.terrain,mask:occupancyMask(data)});this.appearance=data.appearance;this.gpu=terrainGPU;this.coverData=data;
  const mat=this.material;mat.modules.push(data.appearance.module);delete mat.bindings.grassHeights;
  const change=(from,to)=>{if(!mat.vertex.includes(from))throw Error('Pinned grass adapter seam changed: '+from.slice(0,45));mat.vertex=mat.vertex.replace(from,to);};
  change('let xz = cell + slot.xy;',`let cellYaw=floor(vegHash12(cell*.137+vec2f(7.1,19.3))*4.0)*1.57079632679;
 let cs=cos(cellYaw);let sn=sin(cellYaw);let q=slot.xy-vec2f(4.0);
 let shift=vec2f(vegHash12(cell*.271+3.7),vegHash12(cell*.319+71.0))*8.0;
 let xz=cell+fract((vec2f(q.x*cs-q.y*sn,q.x*sn+q.y*cs)+4.0+shift)/8.0)*8.0;`);
  const maskStart=mat.vertex.indexOf('let m = textureSampleLevel( grassMask');
  const maskEnd=mat.vertex.indexOf('let isGrass',maskStart);
  if(maskStart<0||maskEnd<0)throw Error('Pinned flora mask seam changed');
  mat.vertex=mat.vertex.slice(0,maskStart)+'let m = museumFloraAt(xz,0.0);\n\t'+mat.vertex.slice(maskEnd);delete mat.bindings.grassMask;
  change('let dist = length( xz - vegParams.camPos.xz );','let dist=distance(vec3f(xz.x,terrainHeightAt(xz),xz.y),vegParams.camPos);');
  change('let cut = mix( 67.0, 87.0, cutK - floor( cutK ) );','let cut=mix(museumGrassDistance.fade.x+5.0,museumGrassDistance.fade.y,fract(cutK));');
  change('let flowerOk = select( 1.0, select( 0.0, 1.0, r2 < 0.35 ), kind > 3.5 );','let flowerOk = select(1.0,0.0,kind>3.5);');
  const toneStart=mat.vertex.indexOf('let mA = textureSampleLevel( vegDetail');
  const toneEnd=mat.vertex.indexOf('// size:',toneStart);
  if(toneStart<0||toneEnd<0)throw Error('Pinned shared meadow tone seam changed');
  mat.vertex=mat.vertex.slice(0,toneStart)+'let mt = museumMeadowAt(xz,0.0);\n\t'+mat.vertex.slice(toneEnd);
  change('let scale = hScale * present * sizeK;','let stand=vegNoise(xz*.012+vec2f(17.0,41.0));let waterField=creekFieldAt(xz);let marsh=(1.0-smoothstep(.78,1.26,length((xz-vec2f(5600.0,6050.0))/vec2f(2250.0,1500.0))))*(1.0-smoothstep(.5,2.2,terrainHeightAt(xz)-waterField.x));let wetBank=max(1.0-smoothstep(2.0,18.0,abs(waterField.y)),marsh);let tall=mix(.52,1.05,smoothstep(.48,.7,stand));let scale=hScale*present*sizeK*select(mix(tall,1.25,wetBank)*mix(1.0,.6,museumCover(xz,0.0).a),.42,kind>=2.5);');
  change('let scale=hScale*present*sizeK*select(', 'let edgeHeight=select(1.0,mix(.35,1.0,smoothstep(.015,.32,density)),isGrass);let scale=hScale*present*sizeK*edgeHeight*select(');
  const groundStart=mat.vertex.indexOf('// terrain height (float texels');
  const groundEnd=mat.vertex.indexOf('let pl =',groundStart);
  if(groundStart<0||groundEnd<0)throw Error('Pinned grass ground seam changed');
  mat.vertex=mat.vertex.slice(0,groundStart)+`// Every blade uses its own root, sampled from the rendered fine/coarse terrain.
 let rootLocal=v.aRoot*spread*scale;
 let rootXZ=xz+vec2f(rootLocal.x*cy-rootLocal.y*sy,rootLocal.x*sy+rootLocal.y*cy);
 let ground=museumGrassGround(rootXZ);
 let base=vec3f(xz.x,ground,xz.y);
 `+mat.vertex.slice(groundEnd);
  change('let pos = base + ob + sideR * wide;',`var pos=base+ob+sideR*wide;
 if(kind>=2.5){pos.y=terrainHeightAt(pos.xz)+max(ob.y-.004,.003);}`);
  // Same native wind envelope; supply the previous pose for temporal reprojection.
  mat.vertex+=`
 let oldTm=frame.time-frame.dt;
 let oldBend=w*(g*.55+.22)+sin(oldTm*1.9+ph+xz.x*.2)*w*.1;
 let oldFlut=sin(oldTm*7.3+ph*3.0+bRnd*20.0)*(w*.06+.015);
 let oldDisp=(vegWindDir3()*(oldBend*hf2*stiff)+vegWindPerp3()*(oldFlut*hf2*stiff))*(length(o0)+1e-4);
 let oldOb=normalize(o0+oldDisp+vec3f(0.0,1e-5,0.0))*oL;
 var oldPos=base+oldOb+sideR*wide;
 if(kind>=2.5){oldPos.y=terrainHeightAt(oldPos.xz)+max(oldOb.y-.004,.003);}
 v.prevWorldPos=oldPos;`;
  mat.attributes.aRoot='vec2f';
  for(const level of this.levels){
   const geometry=level.geometry,p=geometry.attributes.position,b=geometry.attributes.aBlade,roots=new Float32Array(p.count*2);let x=0,z=0;
   for(let i=0;i<p.count;i++){
    if(b.getX(i)===0){x=p.getX(i);z=p.getZ(i);}
    roots[i*2]=x;roots[i*2+1]=z;
   }
   geometry.setAttribute('aRoot',new Float32BufferAttribute(roots,2));
  }
  this.capacity=[64,192,1280];this.overflowSeen=[0,0,0];this.rangeAudit={};
  for(let i=0;i<this.levels.length;i++){
   const l=this.levels[i];l.max=this.capacity[i];l.arr=new Float32Array(l.max*4);l.attr=new InstancedBufferAttribute(l.arr,4);l.attr.setUsage(DynamicDrawUsage);l.geometry.setAttribute('iCell',l.attr);l.candidates=[];
  }
  // Native wind preserves centre-line length. Bound every template vertex
  // with maximum size, spread and blade-width compensation, in every pose.
  let envelope=0;
  for(const level of this.levels){const g=level.geometry,p=g.attributes.position,b=g.attributes.aBlade,s=g.attributes.aSide;
   for(let i=0;i<p.count;i++){const kind=b.getY(i),grass=kind<.5,scale=grass?1.3*1.25*1.18*1.25:kind<2.5?1.55*1.25:1.2*.42,spread=grass?1.35:1;
    const line=Math.hypot(p.getX(i)*spread,p.getY(i),p.getZ(i)*spread)*scale;
    const side=Math.hypot(s.getX(i),s.getY(i),s.getZ(i))*scale*(grass?1.55*3.5:1);
    envelope=Math.max(envelope,line+side);
   }
  }
  this.envelope=Math.ceil((envelope+.1)*10)/10;this.legacyBounds=false;this.auditBounds=false;this.visible=true;
  // Roots displaced into a neighbour still use that neighbour's ground range.
  const n=this.cellsPerSide,t=data.coverTerrain??data.terrain;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=t.origin+i*CELL,z=t.origin+j*CELL,k=j*n+i;
   if(!this.cellFlags[k])continue;
   const [lo,hi]=t.boundsFor(x-this.envelope,z-this.envelope,x+CELL+this.envelope,z+CELL+this.envelope);this.cellMinY[k]=lo;this.cellMaxY[k]=hi;
  }
  mat.surface+=`
 if(kind>2.5&&kind<3.5){
  let leafAge=smoothstep(.45,.95,rnd);
  let olive=mix(tone*vec3f(.64,.68,.57),vec3f(.045,.042,.021),leafAge*.5);
  let midrib=pow(clamp(centre,0.0,1.0),5.0);
  s.albedo=olive*(.77+ao*.23)*(1.0+midrib*.12);
  s.roughness=.90;s.specularIntensity=.14;
  s.normal=normalize(normalize(in.vs.normal)+in.V*.12);
  s.translucency*=.28;
 }
`;
  mat.needsUpdate=true;this.groundAudit=null;
 }
 update(camera){
  const e=camera.matrixWorld.elements,pe=camera.projectionMatrix.elements,L=this._last;
  if(Math.abs(e[12]-L[0])<.05&&Math.abs(e[13]-L[1])<.05&&Math.abs(e[14]-L[2])<.05&&Math.abs(e[8]-L[3])<1e-3&&Math.abs(e[9]-L[4])<1e-3&&Math.abs(e[10]-L[5])<1e-3&&pe[0]===L[6]&&pe[5]===L[7])return false;
  L.set([e[12],e[13],e[14],e[8],e[9],e[10],pe[0],pe[5]]);
  this._mat.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this._frustum.setFromProjectionMatrix(this._mat,camera.coordinateSystem,camera.reversedDepth);
  const cx=e[12],cy=e[13],cz=e[14],t=this.terrain,n=this.cellsPerSide,far=this.appearance.distance.radius;
  const i0=Math.max(0,Math.floor((cx-far-t.origin)/CELL)),i1=Math.min(n-1,Math.floor((cx+far-t.origin)/CELL));
  const j0=Math.max(0,Math.floor((cz-far-t.origin)/CELL)),j1=Math.min(n-1,Math.floor((cz+far-t.origin)/CELL));
  for(const l of this.levels)l.pending=0;
  let unsafeRejected=0;const rescued=[];
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
   const k=j*n+i;if(!this.cellFlags[k])continue;const x=t.origin+i*CELL,z=t.origin+j*CELL;
   const dx=Math.max(x-cx,0,cx-x-CELL),dz=Math.max(z-cz,0,cz-z-CELL),dy=Math.max(this.cellMinY[k]-.5-cy,0,cy-this.cellMaxY[k]-1.8),d=Math.hypot(dx,dy,dz);
   if(d>far)continue;
   const pad=this.envelope;this._box.min.set(x-pad,this.cellMinY[k]-.5,z-pad);this._box.max.set(x+CELL+pad,this.cellMaxY[k]+pad,z+CELL+pad);if(!this._frustum.intersectsBox(this._box))continue;
   if(this.auditBounds||this.legacyBounds){const [oldLo,oldHi]=t.boundsFor(x-1,z-1,x+CELL+1,z+CELL+1);this._box.min.set(x,oldLo-.5,z);this._box.max.set(x+CELL,oldHi+2.8,z+CELL);
    if(!this._frustum.intersectsBox(this._box)){unsafeRejected++;if(rescued.length<12)rescued.push([x,z]);if(this.legacyBounds)continue;}}
   const l=this.levels[d<18?0:d<46?1:2],c=l.candidates[l.pending]??(l.candidates[l.pending]={});c.x=x;c.z=z;c.d=d;l.pending++;
  }
  let extendedCells=0;const overflow=[];
  for(let tier=0;tier<3;tier++){
   const l=this.levels[tier],lost=Math.max(0,l.pending-l.max);overflow.push(lost);this.overflowSeen[tier]=Math.max(this.overflowSeen[tier],lost);
   const candidates=lost?l.candidates.slice(0,l.pending).sort((a,b)=>a.d-b.d||a.x-b.x||a.z-b.z):l.candidates;
   l.count=Math.min(l.pending,l.max);l.maxSelectedDistance=0;
   for(let i=0;i<l.count;i++){const c=candidates[i],o=i*4;l.arr[o]=c.x;l.arr[o+1]=c.z;l.arr[o+2]=0;l.arr[o+3]=0;l.maxSelectedDistance=Math.max(l.maxSelectedDistance,c.d);if(c.d>=88)extendedCells++;}
   l.geometry.instanceCount=l.count;l.attr.clearUpdateRanges();l.attr.addUpdateRange(0,Math.max(1,l.count)*4);l.attr.needsUpdate=true;
  }
  this.rangeAudit={eligible:this.levels.map(l=>l.pending),capacity:this.capacity,overflow,overflowSeen:this.overflowSeen.slice(),extendedCells,maxSelectedDistance:this.levels.map(l=>l.maxSelectedDistance),envelope:this.envelope,legacyBounds:this.legacyBounds,boundsAudit:this.auditBounds,unsafeRejected:this.auditBounds||this.legacyBounds?unsafeRejected:null,rescued,selection:'conservative plant-envelope frustum; 3D cell distance; closest first only on overflow'};
  return true;
 }
 setFarRange(radius){this.appearance.distance.set(radius);this._last.fill(NaN);}
 setLegacyBounds(on){this.legacyBounds=!!on;this._last.fill(NaN);}
 setBoundsAudit(on){this.auditBounds=!!on;this._last.fill(NaN);}
 setVisible(on){this.visible=!!on;for(const m of this.meshes)m.visible=this.visible;}
 probeAt(x,z){
  const data=this.coverData,t=this.terrain,n=data.grass.res;
  const sample=(bytes,res,origin,size)=>{const fx=Math.max(0,Math.min(res-1,(x-origin)/size*res-.5)),fz=Math.max(0,Math.min(res-1,(z-origin)/size*res-.5)),i=Math.min(res-2,Math.floor(fx)),j=Math.min(res-2,Math.floor(fz)),a=fx-i,b=fz-j;const g=(i,j)=>bytes[(j*res+i)*4+1]/255;return (g(i,j)*(1-a)+g(i+1,j)*a)*(1-b)+(g(i,j+1)*(1-a)+g(i+1,j+1)*a)*b;};
  const coarse=sample(data.grass.data,n,t.origin,t.size),fine=sample(data.masks,data.geography.maskRes,-512,1024),edge=Math.max(Math.abs(x),Math.abs(z)),u=Math.max(0,Math.min(1,(edge-448)/48)),weight=1-u*u*(3-2*u);
  const k=Math.floor((z-t.origin)/CELL)*this.cellsPerSide+Math.floor((x-t.origin)/CELL),h=t.heightAt(x,z),water=data.field.sample(x,z),rise=Math.hypot(t.heightAt(x+1,z)-t.heightAt(x-1,z),t.heightAt(x,z+1)-t.heightAt(x,z-1))/2;
  const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const support=1-smooth(0,2.5,water[1]),legacy=this.appearance.review.fields.legacyWater.value,waterDry=1+(smooth(.08,.6,h-water[0])-1)*(support*(1-legacy)+legacy),density=coarse*(1-weight)+fine*weight;
  return {point:[x,h,z],coarseDensity:coarse,fineDensity:fine,fineWeight:weight,coverDensity:density,waterDry,effectiveWaterDensity:density*waterDry,water:{nearestLevel:water[0],signedEdge:water[1],support,contains:water[1]<=0,legacy},cpuOccupied:!!this.cellFlags[k],normalY:1/Math.sqrt(1+rise*rise),heightAboveWater:water[1]<=0?h-water[0]:null,scope:'CPU bilinear mask and signed-water support before final GPU wet-bank/grove suppression'};
 }
 async auditGround(){
  const pts=[[7690.312686253738,-2002.8799280156782],[8319.441878239979,-2633.1065592216073],[7486.592,-1873.309],[3600,-5280],[4170,-5280],[2850,-1950],[3520,-1950],...Array.from({length:25},(_,i)=>[-46+i*4,-60]),...Array.from({length:13},(_,i)=>[-170+i*8,80]),[460,0],[480,0],[496,0],[-460,80],[-480,80],[-496,80],[-849,-32],[-88,18],[-88,16],[-84,74],[-84,78],[-84,82],[-36,-60]];
  for(const p of this.coverData.field.continuousSample?.points.filter((_,i)=>i%37===0)??[]){const r=this.coverData.field.continuousSample.nearest(p.x,p.z);pts.push([p.x+r.dir[1]*(p.width+1),p.z-r.dir[0]*(p.width+1)]);}
  const input=new StorageBuffer({label:'Actual grass root audit points',count:pts.length,type:'vec4f',data:new Float32Array(pts.flatMap(p=>[...p,0,0]))});
  const output=new StorageBuffer({label:'Grass vs terrain root heights',count:pts.length,type:'vec4f'});
  const kernel=new ComputeKernel({label:'Museum grass startup integration audit',modules:[this.appearance.module],bindings:{grassAuditPoints:{storage:input,access:'read'},grassAuditHeights:{storage:output,access:'read_write'}},code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=${pts.length}u){return;}let p=grassAuditPoints[i].xy;grassAuditHeights[i]=vec4f(museumGrassGround(p),terrainHeightAt(p),terrainHeightAtCoarse(p),museumFloraAt(p,0.0).g);}`});
  await GPU.pipelinesReady();GPU.beginFrame();kernel.dispatch(Math.ceil(pts.length/64));const values=new Float32Array(await readBuffer(output,pts.length*16));
  const rows=pts.map((p,i)=>{const a=Array.from(values.subarray(i*4,i*4+4));return {point:p,root:a[0],surface:a[1],oldCoarse:a[2],density:a[3],cpu:this.terrain.heightAt(...p),gap:a[0]-a[1],oldError:a[2]-a[1]};});input.destroy();output.destroy();
  const passed=rows.every(r=>Math.abs(r.surface-r.cpu)<.002&&Math.abs(r.gap+.035)<.002);
  if(!passed)throw Error('Shared grass/terrain root integration failed');
  return this.groundAudit={passed,phase:'startup-only; no timed readback',rows,maxOldError:Math.max(...rows.map(r=>Math.abs(r.oldError))),maxOldErrorInGrass:Math.max(...rows.filter(r=>r.density>.035).map(r=>Math.abs(r.oldError))),maxRootError:Math.max(...rows.map(r=>Math.abs(r.gap+.035)))};
 }
 stats(){return {visible:this.visible,envelope:this.envelope,cells:this.levels.map(x=>x.count),triangles:this.triangles,patchTriangles:this.patchTris,forms:this.appearance.counts,range:this.appearance.distance.stats(),rangeAudit:this.rangeAudit,handover:'shared 3D tier0/ground fade; native near/mid tiers, projected warped tussocks and surface-gradient relief',placement:'same terrainHeightAt as ground, per-blade roots; cell-dependent torus offsets/quarter turns',wind:'native envelope; world-fixed 0.52–1.25 grass heights and 0.42 low cover; template-derived conservative root/vertex envelope',groundAudit:this.groundAudit};}
}
