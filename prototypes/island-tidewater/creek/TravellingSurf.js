// Tidewater's near-shore simulation and breaker ribbons, carried around the
// museum coast with a bounded budget. Native physics/shading remain in vendor.
import {ShoreSim} from '../vendor/tidewater/src/ocean/ShoreSim.js';
import {Breakers} from '../vendor/tidewater/src/ocean/Breakers.js';
import {Vector2,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {GPU,Texture,StorageBuffer,UniformBlock,ShaderModule,ComputeKernel,commonModule} from '../vendor/tidewater/src/engine/webgpu.js';
import {
  marineShoreFor, buildBreakerWindow,
  BREAKER_SCAN_SAMPLES, BREAKER_INNER_SAMPLES, BREAKER_INNER_DISTANCE, BREAKER_NATIVE_DISTANCE,
} from './MarineShore.js';


function closestCoast(shelf,x,z){
 let best=null,d=Infinity;
 for(const s of shelf.segments){const q=Math.hypot(s.point[0]-x,s.point[1]-z);if(q<d){d=q;best=s;}}
 return {segment:best,distance:d};
}

export class TravellingShoreSim extends ShoreSim{
 constructor(renderer,options){
  super(renderer,options);this.shelf=options.shelf;this.recentres=0;this.resets=0;this.reprojections=0;this.events=[];this.lastProbe=[1e9,1e9];this.coastQueries=0;
  this.presentation=new UniformBlock('MuseumSurfPresentation',{legacy:['f32',0]});
  this.module.deps.push(new ShaderModule({name:'museumSurfPresentation',uniforms:this.presentation,uniformName:'museumSurfPresentation',code:`
// History and lace are near-field detail, not a second rectangular sea
// material. Their contribution converges to the common all-coast waves before
// the bounded simulation can be seen from above. The simulation stays native.
fn museumSurfDetailAt(p:vec2f)->f32{
 let uv=shoreSimUvOf(p);
 let edge=smoothstep(0.0,.12,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
 let near=1.0-smoothstep(55.0,145.0,distance(vec3f(p.x,frame.seaLevel,p.y),frame.cameraPos));
 return mix(edge*near,1.0,museumSurfPresentation.legacy);
}`}));
  const travel=new UniformBlock('MuseumSurfTravel',{shift:['vec2f',new Vector2()]});this.travel=travel;
  const previous=new ShaderModule({name:'museumSurfTravel',deps:[this.module],uniforms:travel,uniformName:'museumSurfTravel',code:`
fn museumShorePrevious(uv:vec2f)->vec4f{
 let old=uv+museumSurfTravel.shift;
 if(any(old<vec2f(0.0))||any(old>vec2f(1.0))){return vec4f(0.0);}
 return shoreSimStateAt(old);
}`});
  let body=this.kernel.source.slice(this.kernel.source.lastIndexOf('@compute'));
  const seam='let here = textureLoad( shoreSimStateTex, vec2i( gid.xy ), 0 );';
  if(!body.includes(seam))throw Error('Pinned ShoreSim history seam changed');
  body=body.replace(seam,`var here:vec4f;
 if(any(abs(museumSurfTravel.shift)>vec2f(.000001))){here=museumShorePrevious(uv);}
 else{here=textureLoad(shoreSimStateTex,vec2i(gid.xy),0);}`).replaceAll('shoreSimStateAt( back )','museumShorePrevious( back )').replaceAll('shoreSimStateAt( uv + dirH )','museumShorePrevious( uv + dirH )').replaceAll('shoreSimStateAt( uv - dirH )','museumShorePrevious( uv - dirH )');
  this.kernel=new ComputeKernel({label:'Museum travelling native ShoreSim',modules:[this.module,options.shore.module,options.terrainGPU.module,previous],workgroupSize:[8,8,1],bindings:{shoreSimOut:{storageTexture:this.stateB,access:'write'},shoreSimDeposit:{storage:this.deposit,access:'read_write',type:'u32'},shoreSimLace:{texture:this.lace}},code:body});
  // The native CPU lookup initially establishes its binding/uniform contract.
  // Subsequent centres reuse a single GPU-filled direction texture, avoiding
  // a 128² CPU rebuild and new texture allocation at every flight step.
  const shore=options.shore,old=shore.dirTexture,n=shore.dirRes;
  shore.dirTexture=new Texture({label:'Museum travelling surf directions',width:n,height:n,format:'rgba32float',usage:['sample','storage','copyDst'],data:new Float32Array(n*n*4)});old.destroy();
  this.directionKernel=new ComputeKernel({label:'Museum surf direction recenter',modules:[options.terrainGPU.module],workgroupSize:[8,8,1],bindings:{museumSurfDir:{uniform:this.uniforms},museumSurfDirOut:{storageTexture:shore.dirTexture,access:'write'}},code:`
@compute @workgroup_size(WG_X,WG_Y,WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=vec2u(${n}u))){return;}
 let p=museumSurfDir.min+(vec2f(gid.xy)+.5)/${n}.0*museumSurfDir.size;
 let f=terrainShoreSample(p);let e=length(f.yz);let dir=f.yz/max(e,.0001);
 textureStore(museumSurfDirOut,gid.xy,vec4f(dir,min(1.0,e*1.4),1.0));
}`});
  this.directionDirty=true;this.lastShift=[0,0];
 }
 update(camera){
  this.travel.fields.shift.value.set(0,0);this.lastShift=[0,0];
  if(camera&&Math.abs(camera.position.y)<240){
   const c=camera.position,size=this.uSize.value,min=this.uMin.value;
   // Find a new anchor only after leaving the protected central window.
   if(Math.hypot(c.x-min.x-size/2,c.z-min.y-size/2)>130&&Math.hypot(c.x-this.lastProbe[0],c.z-this.lastProbe[1])>32){
    this.lastProbe=[c.x,c.z];this.coastQueries++;const near=closestCoast(this.shelf,c.x,c.z),s=near.segment;
    if(near.distance<950){
     const x=Math.round((s.point[0]+s.normal[0]*85-size/2)/24)*24,z=Math.round((s.point[1]+s.normal[1]*85-size/2)/24)*24;
     const dx=x-min.x,dz=z-min.y;
     if(Math.hypot(dx,dz)>72){
      const shift=[dx/size,dz/size];this.travel.fields.shift.value.set(...shift);this.lastShift=shift;min.set(x,z);
      this.shore.dirMin.value.copy(min);this.shore.dirSize.value=size;this.directionDirty=true;
      GPU.getEncoder().clearBuffer(this.deposit.getGPU());
      this.recentres++;const reset=Math.abs(shift[0])>=1||Math.abs(shift[1])>=1;if(reset)this.resets++;else this.reprojections++;
      this.events.push({frame:GPU.frame,min:[x,z],shift,mode:reset?'new water; zero old history':'world-overlap reprojection'});if(this.events.length>12)this.events.shift();
     }
    }
   }
  }
  if(this.directionDirty){this.directionKernel.dispatch(this.directionKernel.groups(this.shore.dirRes,this.shore.dirRes));this.directionDirty=false;}
  super.update();
 }
 stats(){return {presentation:{legacy:this.presentation.fields.legacy.value,nearMetres:55,farMetres:145,edgeFeatherMetres:this.uSize.value*.12,policy:'same optical sea everywhere; continuous near history/lace/turbidity/wet-sand handover'},size:this.uSize.value,res:this.res,texelMetres:this.uSize.value/this.res,min:this.uMin.value.toArray(),recentres:this.recentres,reprojections:this.reprojections,resets:this.resets,coastQueries:this.coastQueries,lastShift:this.lastShift,events:this.events,history:'world-overlap reprojection; new texels zero; old spray deposit cleared on centre change',budget:'one native simulation window; normal-frame direct texel read; direction refresh only when recentering; coast probe throttled to32m camera travel'};}
}

export class TravellingBreakers extends Breakers{
 _buildMesh(){
  super._buildMesh();
  const mat=this.mesh.material;
  const seam='let valid = c2.w > 0.5 && abs( mOther - c2.w ) < 0.5 && c0.w < 1.25 && bOther < 1.25;';
  const fade='o.vLipFade = capA *';
  if(!mat.vertex.includes(seam)||!mat.vertex.includes(fade))throw Error('Pinned breaker sheet seam changed');
  // Equal wave IDs alone do not imply a connected crest: stations on opposite
  // banks can follow the same wave at unrelated positions. Use the same test
  // on the far side of each vertex to feather the end of a connected lip.
  mat.modules.push(new ShaderModule({name:'marineCrestContinuity',code:`
fn marineCrestsJoin(a:u32,b:u32)->bool{
 let a0=breakersCrest[a];
 let b0=breakersCrest[b];
 let a2=breakersCrest[a+2u];
 let b2=breakersCrest[b+2u];
 return a2.w>.5&&b2.w>.5&&abs(a2.w-b2.w)<.5&&a0.w<1.25&&b0.w<1.25
  &&distance(a0.xyz,b0.xyz)<${(this.spacing*6).toFixed(7)}
  &&distance(breakersCrest[a+1u].xyz,breakersCrest[b+1u].xyz)<${(this.spacing*8).toFixed(7)}
  &&dot(a2.xy,b2.xy)>.90;
}`}));
  mat.vertex=mat.vertex.replace(seam,`
 let valid=marineCrestsJoin(e,eo);
 let continuation=i32(st)+select(-1,1,side>0u);
 var endFade=0.0;
 if(valid&&continuation>=0&&continuation<${this.NS}){
  let neighbour=u32(continuation)*6u+slot*3u;
  endFade=select(0.0,1.0,marineCrestsJoin(e,neighbour));
 }`).replace(fade,'o.vLipFade = endFade * capA *');
  mat.needsUpdate=true;
 }
 _buildKernel() {
  // Generate the original crest processing and emitters from their native
  // models. Only the station layout and its phase search window travel.
  super._buildKernel();
  const source = this.kernel.source;
  const start = source.indexOf('const BRK_GRAVITY:');
  const main = source.lastIndexOf('@compute');
  const amplitude = 'let A = shoreWaveAmp( m, along );';
  const write = 'breakersCrestW[ k ] = vec4f( root, b );';
  const emit = 'breakersCrestW[ k + 2u ] = vec4f( dir, trough, id );';
  if (start < 0 || main < start || !source.includes(amplitude) || !source.includes(write) || !source.includes(emit)) {
    throw Error('Pinned breaker crest finder seam changed');
  }
  let crest = source.slice(start, main);
  if(this.spray){
    const emitCall='breakersEmit( i, slot, root, dir, b, H, trough, c, m, depth, shoreBore( A, depth ) );';
    const emitArgs='m: f32, depth: f32, bore: vec4f )';
    const roller='let roller = smoothstep( 1.05, 1.3, b ) * smoothstep( 0.06, 0.25, Hb );';
    if(![emitCall,emitArgs,roller].every(seam=>crest.includes(seam)))throw Error('Pinned roller spray seam changed');
    crest=crest
      .replace(emitCall,`var air=1.0;
    let ordinary=museumOrdinarySurf(pc);
    if(ordinary>0.0&&b>1.05){air=mix(1.0,museumRollerAir(pc,dir,depth,A,b),ordinary);}
    breakersEmit(i,slot,root,dir,b,H,trough,c,m,depth,shoreBore(A,depth),air);`)
      .replace(emitArgs,'m: f32, depth: f32, bore: vec4f, air: f32 )')
      .replace(roller,'let roller = smoothstep( 1.05, 1.3, b ) * smoothstep( 0.06, 0.25, Hb ) * air;');
  }
  const code = crest
    .replace(amplitude, 'let A = shoreWaveAmp( m, along ) * museumBreakerScale(ph.exposure);')
    // In 126 m the native last crossing usually wins. Across a wide reef,
    // a later bore on the same parity must not erase a visible plunging lip.
    .replace(write, `if (b < 1.25 || breakersCrestW[k + 2u].w < .5 || breakersCrestW[k].w >= 1.25) {
      ${write}`)
    .replace(emit, `${emit}
    }`) + `
@compute @workgroup_size(WG_X, WG_Y, WG_Z)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;
 if(i>=${this.NS}u){return;}
 let base=i*6u;
 breakersCrestW[base+2u]=vec4f(0.0);
 breakersCrestW[base+5u]=vec4f(0.0);
 let end=breakersStations[i+${this.NS}u].x;
 if(end<=0.0||breakersP.cameraPos.y>=300.0){return;}
 let st=breakersStations[i];
 var previousValid=false;
 var previousPhase=0.0;
 var previousDistance=0.0;
 for(var k=0;k<${BREAKER_SCAN_SAMPLES};k++){
  var dist=f32(k)*2.0;
  if(end>${BREAKER_NATIVE_DISTANCE}.0&&k>${BREAKER_INNER_SAMPLES}){
   dist=${BREAKER_INNER_DISTANCE}.0+(end-${BREAKER_INNER_DISTANCE}.0)*f32(k-${BREAKER_INNER_SAMPLES})/${BREAKER_SCAN_SAMPLES-1-BREAKER_INNER_SAMPLES}.0;
  }
  if(dist>end){break;}
  let ph=shorePhaseAt(st.xy+st.zw*dist);
  let valid=ph.T<10000.0&&ph.exposure>.0001;
  let wave=floor(ph.s);
  // A jump of more than a period usually crosses an invalid propagation
  // seam. The bounded stride is shorter than the local shallow wavelength.
  if(valid&&previousValid&&wave==floor(previousPhase)+1.0){
   var lo=previousDistance;
   var hi=dist;
   var sLo=previousPhase;
   var sHi=ph.s;
   var rootValid=true;
   var x=lo+(wave-sLo)/max(sHi-sLo,1e-5)*(hi-lo);
   for(var j=0;j<2;j++){
    let p=shorePhaseAt(st.xy+st.zw*x);
    if(p.T>=10000.0||p.exposure<=.0001){rootValid=false;break;}
    if(p.s<wave){lo=x;sLo=p.s;}else{hi=x;sHi=p.s;}
    x=lo+(wave-sLo)/max(sHi-sLo,1e-5)*(hi-lo);
   }
   if(rootValid){breakersProcessCrest(i,st.xy+st.zw*x,wave);}
  }
  previousDistance=dist;
  previousPhase=ph.s;
  previousValid=valid;
 }
}`;

  this.stationData = new Float32Array(this.NS * 8);
  this.stations = new StorageBuffer({label:'Marine breaker stations and range', count:this.NS * 2, data:this.stationData});
  this.kernel = new ComputeKernel({
    label:'Travelling native surf crests', workgroupSize:[64,1,1], code,
    modules:[commonModule,this.shore.module,this.surface.terrain?.module,this.surface.fft.module,this.spray?.module].filter(Boolean),
    bindings:{
      breakersP:{uniform:this.uniforms},
      breakersStations:{storage:this.stations,access:'read'},
      breakersCrestW:{storage:this.crest,access:'read_write'},
    },
  });
 }
 constructor(renderer,options) {
  super(renderer,options);
  if(this.NS<2)throw Error('Missing native breaker capacity');
  this.coast=marineShoreFor(options.actualTerrain,options.shelf,options.seaLevel);
  this.forward=new Vector3();
  this.probe=null;
  this.anchor=null;
  this.request=null;
  this.windowBuild=null;
  this.staging=new Float32Array(this.stationData.length);
  this.recentres=0;
  this.validStations=0;
  this.scanReach=0;
  this.coastQueries=0;
 }
 update(camera) {
  const c=camera.position;
  if(c.y>=300){
   this.probe=null;
   this.request=null;
  }else{
   this._trackCoast(camera,performance.now()+2);
  }
  super.update(camera);
 }
 _trackCoast(camera,deadline){
  const c=camera.position;
  camera.getWorldDirection(this.forward);
  const horizontal=Math.hypot(this.forward.x,this.forward.z);
  const fx=horizontal>.15?this.forward.x/horizontal:0;
  const fz=horizontal>.15?this.forward.z/horizontal:0;
  const [x,z,px,pz]=this.probe??[Infinity,Infinity,0,0];
  if(Math.hypot(c.x-x,c.z-z)>48||Math.hypot(fx-px,fz-pz)>.52){
   this.probe=[c.x,c.z,fx,fz];
   this.coastQueries++;
   // Look ahead so a stationary turn across a bay can select the bank
   // now in view. Near-vertical cameras use their position as the probe.
   this.request=[c.x+fx*96,c.z+fz*96];
  }
  if(this.request){
   const anchor=this.coast.nearest(...this.request,{budgetMs:Math.max(0,deadline-performance.now())});
   if(anchor===undefined)return;
   this.request=null;
   const next=anchor&&anchor.distance<950?anchor:null;
   const last=this.windowBuild?.anchor??this.anchor;
   const changed=last&&next&&(Math.hypot(next.point[0]-last.point[0],next.point[1]-last.point[1])>46||
     next.normal[0]*last.normal[0]+next.normal[1]*last.normal[1]<.7);
   if(changed||Boolean(next)!==Boolean(last)){
    this.windowBuild=next?{anchor:next,build:buildBreakerWindow(this.coast,next,this.spacing,this.NS,this.staging)}:null;
    if(!next&&this.anchor){
     this.staging.fill(0);
     this._swapWindow(null,0,0);
    }
   }
  }
  while(this.windowBuild&&performance.now()<deadline){
   const step=this.windowBuild.build.next();
   if(!step.done)continue;
   this._swapWindow(this.windowBuild.anchor,step.value.valid,step.value.span);
   this.windowBuild=null;
  }
 }
 _swapWindow(anchor,valid,span){
  this.anchor=anchor;
  this.validStations=valid;
  this.scanReach=span;
  [this.stationData,this.staging]=[this.staging,this.stationData];
  this.stations.write(this.stationData);
  this.recentres++;
 }
 stats(){
  return {capacity:this.NS,validStations:this.validStations,spacing:this.spacing,recentres:this.recentres,
    coastQueries:this.coastQueries,anchorCamera:this.probe?.slice(0,2)??null,anchorShore:this.anchor?.point??null,
    scanReach:this.scanReach,samplesPerStation:BREAKER_SCAN_SAMPLES,pending:Boolean(this.request||this.windowBuild),
    placement:'arc-length stations on the final marine contour, with shelf-depth scan and camera-heading reselection'};
 }
}
