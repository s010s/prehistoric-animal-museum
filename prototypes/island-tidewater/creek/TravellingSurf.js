// Tidewater's near-shore simulation and breaker ribbons, carried around the
// museum coast with a bounded budget. Native physics/shading remain in vendor.
import {ShoreSim} from '../vendor/tidewater/src/ocean/ShoreSim.js';
import {Breakers} from '../vendor/tidewater/src/ocean/Breakers.js';
import {Vector2} from '../vendor/tidewater/src/engine/index.js';
import {GPU,Texture,UniformBlock,ShaderModule,ComputeKernel} from '../vendor/tidewater/src/engine/webgpu.js';

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
  if(!mat.vertex.includes(seam))throw Error('Pinned breaker segment validity seam changed');
  // Equal wave IDs alone do not imply a connected crest: stations on opposite
  // banks of an inlet can follow the same wave at unrelated positions. Both
  // ends evaluate these symmetric tests, so an invalid strip fully collapses.
  mat.vertex=mat.vertex.replace(seam,`
 let otherRoot=breakersCrest[eo].xyz;
 let otherBack=breakersCrest[eo+1u].xyz;
 let otherDir=breakersCrest[eo+2u].xy;
 let connected=distance(c0.xyz,otherRoot)<${(this.spacing*6).toFixed(7)}&&distance(c1.xyz,otherBack)<${(this.spacing*8).toFixed(7)}&&dot(c2.xy,otherDir)>.90;
 let valid=c2.w>.5&&abs(mOther-c2.w)<.5&&c0.w<1.25&&bOther<1.25&&connected;`);
  mat.needsUpdate=true;
 }
 constructor(renderer,options){super(renderer,options);if(this.NS<2)throw Error('Missing native breaker capacity');this.actualTerrain=options.actualTerrain;this.shelf=options.shelf;this.lastCamera=[1e9,1e9];this.recentres=0;this.validStations=0;this.coastQueries=0;}
 update(camera){
  const c=camera.position;
  if(c.y<300&&Math.hypot(c.x-this.lastCamera[0],c.z-this.lastCamera[1])>100){
   this.lastCamera=[c.x,c.z];this.coastQueries++;const near=closestCoast(this.shelf,c.x,c.z);
   if(near.distance<950){
    const s=near.segment,[nx,nz]=s.normal,t=this.actualTerrain,half=(this.NS-1)*this.spacing/2;let valid=0;
    for(let i=0;i<this.NS;i++){
     const a=i*this.spacing-half,x=s.point[0]-nz*a,z=s.point[1]+nx*a,point=d=>[x+nx*d,z+nz*d];let lo=-190,hi=240;
     if(t.heightAt(...point(lo))<-.7||t.heightAt(...point(hi))>=-.7){this.stationData.set([1e6,1e6,nx,nz],i*4);continue;}
     for(let k=0;k<17;k++){const m=(lo+hi)/2;if(t.heightAt(...point(m))>-.7)lo=m;else hi=m;}
     const [px,pz]=point((lo+hi)/2);let dx=t.heightAt(px-4,pz)-t.heightAt(px+4,pz),dz=t.heightAt(px,pz-4)-t.heightAt(px,pz+4),l=Math.hypot(dx,dz);
     if(l<.001){dx=nx;dz=nz;l=1;}
     this.stationData.set([px,pz,dx/l,dz/l],i*4);valid++;
    }
    this.stations.write(this.stationData);GPU.getEncoder().clearBuffer(this.crest.getGPU());this.validStations=valid;this.recentres++;this.lastCamera=[c.x,c.z];
   }
  }
  super.update(camera);
 }
 stats(){return {capacity:this.NS,validStations:this.validStations,spacing:this.spacing,recentres:this.recentres,coastQueries:this.coastQueries,anchorCamera:this.lastCamera,placement:'bounded native lip ribbon follows physical coast near camera; no all-island emitter multiplication; coast probe throttled to100m camera travel'};}
}
