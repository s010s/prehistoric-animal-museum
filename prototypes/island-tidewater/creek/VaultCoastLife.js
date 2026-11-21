import {InstancedMesh,Matrix4,Quaternion,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {loadGLB,parseGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {reviewedAlbedo,reviewedGeometry} from './VaultEnvironmentAssets.js';
import {REEF_URLS} from './VaultReefAssets.js';

const fittedMatrices = new WeakMap();

async function loadCoastModel(kind, signal) {
 const url = REEF_URLS[kind];
 if (globalThis.__assetFile) return loadGLB(url);
 const response = await fetch(url, {signal});
 if (!response.ok) throw Error('Vault '+kind+' GLB returned '+response.status);
 const buffer = await response.arrayBuffer();
 signal.throwIfAborted();
 return parseGLB(buffer);
}

function reefGeometry(gltf,shell){
 const geometry=reviewedGeometry(gltf,(x,y,z)=>[x,y,z]),positions=geometry.attributes.position.array,colors=geometry.attributes.color.array;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],positions[i+k]);hi[k]=Math.max(hi[k],positions[i+k]);}
 // A shell may be laid onto a different axis. Center it before that
 // rotation so its map, label and physical placement share an XZ origin.
 const cy=shell?(lo[1]+hi[1])*.5:lo[1];
 const dimensions=hi.map((v,i)=>v-lo[i]),span=shell?Math.max(...dimensions):Math.max(dimensions[0],dimensions[2]),cx=(lo[0]+hi[0])*.5,cz=(lo[2]+hi[2])*.5,height=hi[1]-lo[1];
 for(let i=0;i<positions.length;i+=3){
  const shade=.74+.26*Math.sqrt(Math.max(0,(positions[i+1]-lo[1])/Math.max(.001,height)));
  positions[i]=(positions[i]-cx)/span;positions[i+1]=(positions[i+1]-cy)/span;positions[i+2]=(positions[i+2]-cz)/span;
  for(let k=0;k<3;k++)colors[i+k]*=shade;
 }
 geometry.computeBoundingSphere();return geometry;
}

// World-fixed placements outlive a streamed mesh. Re-entering a district only
// recreates its GPU resources, with the same contact planes and tracking IDs.
async function fitInstances(kind, sites, terrain, geometry, shell, signal) {
 const positions=geometry.attributes.position.array, matrices=[], cells=new Map();
 const up=new Vector3(0,1,0), hinge=new Vector3(1,0,0), lean=new Vector3(0,0,1);
 const q=new Quaternion(), yaw=new Quaternion(), local=new Quaternion();
 const yAxis=new Vector3(), bedAxis=new Vector3(), position=new Vector3(), size=new Vector3(), transform=new Matrix4();
 let sliceStart=performance.now();
 for (const [index, site] of sites.entries()) {
  let matrix=fittedMatrices.get(site);
  if (!matrix) {
   const gx=site.slopeX??(terrain.heightAt(site.x+.4,site.z)-terrain.heightAt(site.x-.4,site.z))/.8;
   const gz=site.slopeZ??(terrain.heightAt(site.x,site.z+.4)-terrain.heightAt(site.x,site.z-.4))/.8;
   yaw.setFromAxisAngle(up,site.yaw??0);
   if (shell) {
    q.copy(yaw);
    if (kind==='trigonia') q.multiply(local.setFromAxisAngle(hinge,-Math.PI*.31));
    q.multiply(local.setFromAxisAngle(lean,site.lean??0));
   } else {
    q.setFromUnitVectors(up,bedAxis.set(-gx,1,-gz).normalize()).multiply(yaw);
   }
   local.copy(q).invert();
   yAxis.copy(up).applyQuaternion(local);
   bedAxis.set(-gx,1,-gz).applyQuaternion(local);
   let low=Infinity,high=-Infinity,contact=Infinity;
   for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    const h=x*yAxis.x+y*yAxis.y+z*yAxis.z;
    low=Math.min(low,h);high=Math.max(high,h);
    contact=Math.min(contact,x*bedAxis.x+y*bedAxis.y+z*bedAxis.z);
   }
   low*=site.span;high*=site.span;
   if(shell)site.embed=.004+(high-low)*(site.embedFraction??.25);
   const embed=Math.min(site.embed??.015,(high-low)*.32);
   site.y=site.floor-embed-contact*site.span;
   site.centerY=site.y+(low+high)*.5;
   site.halfHeight=(high-low)*.5;
   position.set(site.x,site.y,site.z);size.setScalar(site.span);
   matrix=Float32Array.from(transform.compose(position,q,size).elements);
   fittedMatrices.set(site,matrix);
  }
  matrices.push(matrix);
  const key=Math.floor(site.x/40)+','+Math.floor(site.z/40);
  if(!cells.has(key))cells.set(key,[]);
  cells.get(key).push(index);
  if(performance.now()-sliceStart>4){
   await new Promise(resolve=>setTimeout(resolve,0));
   signal.throwIfAborted();
   sliceStart=performance.now();
  }
 }
 return {matrices,cells};
}

export async function loadBenthicSpecies(kind, category, sites, terrain, signal) {
 const gltf=await loadCoastModel(kind,signal);
 signal.throwIfAborted();
 let texture,geometry,material,mesh;
 const dispose=()=>{
  mesh?.removeFromParent();
  mesh?.dispose();
  geometry?.dispose();
  material?.uniformBlock.buffer?.destroy();
  material?.dispose();
  texture?.destroy();
 };
 try{
  texture=await reviewedAlbedo(gltf,kind,signal);
  if(!texture)throw Error('Missing reviewed reef colour map for '+kind);
  signal.throwIfAborted();
  const shell=category==='shells';
  geometry=reefGeometry(gltf,shell);
  const {matrices,cells}=await fitInstances(kind,sites,terrain,geometry,shell,signal);
  signal.throwIfAborted();
  material=new Material({name:'Museum reef '+kind,vertexColors:true,roughness:.88,metalness:0,
   textures:{reefAlbedo:texture},surface:'s.albedo*=textureSample(reefAlbedo,smpAnisoRepeat,in.uv).rgb;'});
  mesh=new InstancedMesh(geometry,material,sites.length);
  mesh.name=kind+' '+category;mesh.castShadow=true;mesh.receiveShadow=true;mesh.staticVelocity=true;
  mesh.frustumCulled=false;mesh.visible=false;mesh.count=0;
  const range=shell?22:34,activeIndices=[],lastCamera=new Vector3(Infinity,Infinity,Infinity);
  const update=camera=>{
   const p=camera.position;
   if(p.distanceToSquared(lastCamera)<=.36)return;
   lastCamera.copy(p);
   activeIndices.length=0;
   const cx=Math.floor(p.x/40),cz=Math.floor(p.z/40);
   for(let z=cz-1;z<=cz+1;z++)for(let x=cx-1;x<=cx+1;x++)for(const i of cells.get(x+','+z)??[]){
    const site=sites[i];
    if((p.x-site.x)**2+(p.y-site.floor)**2+(p.z-site.z)**2>(site.range??range)**2)continue;
    mesh.instanceMatrix.array.set(matrices[i],activeIndices.length*16);
    activeIndices.push(i);
   }
   mesh.count=activeIndices.length;
   mesh.visible=mesh.count>0;
   if(mesh.visible)mesh.instanceMatrix.needsUpdate=true;
  };
  return {kind,category,mesh,sites,activeIndices,update,dispose};
 }catch(error){dispose();throw error;}
}
