import {InstancedMesh,Matrix4,Quaternion,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {loadGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {reviewedAlbedo,reviewedGeometry} from './VaultEnvironmentAssets.js';
import {CORALS,SHELLS,SPONGES,REEF_URLS} from './VaultReefAssets.js';

export const VAULT_BENTHIC=Object.keys(REEF_URLS);

export async function loadVaultCoastLife(kinds){
 const entries=[];
 for(let i=0;i<kinds.length;i+=6){
  const batch=await Promise.all(kinds.slice(i,i+6).map(async kind=>[kind,await loadGLB(REEF_URLS[kind])]));
  entries.push(...batch);
 }
 return Object.fromEntries(entries);
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

export async function createVaultBenthos(vault,scene,terrain,{coralSites,shellSites,spongeSites}){
 if(!coralSites.length&&!shellSites.length&&!spongeSites.length)return null;
 const corals=[],shells=[],sponges=[],up=new Vector3(0,1,0),leanAxis=new Vector3(0,0,1),normal=new Vector3(),pos=new Vector3(),q=new Quaternion(),yawQ=new Quaternion(),leanQ=new Quaternion(),size=new Vector3(),vertex=new Vector3(),transform=new Matrix4();
 const shellHinge=new Vector3(1,0,0);
 const resources=[];
 const dispose=()=>{
  for(const {mesh,texture} of resources){
   mesh.removeFromParent();mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();texture.destroy();
  }
  resources.length=0;
 };
 const batches=async(kinds,allSites,out,category)=>{
  for(const kind of kinds){
   const sites=allSites.filter(site=>site.kind===kind);if(!sites.length)continue;
   const isShell=category==='shell forms',gltf=vault[kind];
   const geometry=reefGeometry(gltf,isShell),positions=geometry.attributes.position.array;
   const texture=await reviewedAlbedo(gltf,kind);
   if(!texture)throw Error('Missing reviewed reef colour map for '+kind);
   const material=new Material({name:'Museum reef '+kind,vertexColors:true,roughness:.88,metalness:0,
    textures:{reefAlbedo:texture},surface:'s.albedo*=textureSample(reefAlbedo,smpAnisoRepeat,in.uv).rgb;'});
   const batch=new InstancedMesh(geometry,material,sites.length),matrices=[];
   resources.push({mesh:batch,texture});
   batch.name=kind+' '+category;batch.castShadow=true;batch.receiveShadow=true;batch.staticVelocity=true;batch.frustumCulled=false;
   for(const site of sites){
    yawQ.setFromAxisAngle(up,site.yaw??0);
    if(isShell){
     // The upper valve and whorl carry the exposed pigment. The shortest
     // AABB axis can turn the dark sediment-facing side into the sky.
     q.copy(yawQ);
     if(kind==='trigonia')q.multiply(leanQ.setFromAxisAngle(shellHinge,-Math.PI*.31));
     q.multiply(leanQ.setFromAxisAngle(leanAxis,site.lean??0));
    }
    else{
     normal.set(-(terrain.heightAt(site.x+.4,site.z)-terrain.heightAt(site.x-.4,site.z))/.8,1,-(terrain.heightAt(site.x,site.z+.4)-terrain.heightAt(site.x,site.z-.4))/.8).normalize();
     q.setFromUnitVectors(up,normal).multiply(yawQ);
    }
    let low=Infinity,high=-Infinity;
    for(let k=0;k<positions.length;k+=3){vertex.set(positions[k],positions[k+1],positions[k+2]).applyQuaternion(q);low=Math.min(low,vertex.y*site.span);high=Math.max(high,vertex.y*site.span);}
    // Both a tilted shell and a sloping coral base use the real lowest
    // vertex. Source origins and nominal asset dimensions are not contacts.
    if(isShell)site.embed=.004+(high-low)*(site.embedFraction??.25);
    site.y=site.floor-(site.embed??.015)-low;
    site.centerY=site.y+(low+high)*.5;
    site.halfHeight=(high-low)*.5;
    pos.set(site.x,site.y,site.z);size.setScalar(site.span);transform.compose(pos,q,size);matrices.push(Float32Array.from(transform.elements));
   }
   batch.count=0;scene.add(batch);out.push({kind,mesh:batch,sites,matrices,range:isShell?22:34,activeIndices:[]});
  }
 };
 try{
  await batches(CORALS.map(c=>c.id),coralSites,corals,'coral colonies');
  await batches(SHELLS,shellSites,shells,'shell forms');
  await batches(SPONGES,spongeSites,sponges,'sponges');
 }catch(error){
  dispose();
  throw error;
 }
 let lastCamera=new Vector3(Infinity,Infinity,Infinity);
 const update=camera=>{
  // Pack nearby instances only. Increasing the habitat footprint must not
  // submit every distant colony whenever one member of its species is near.
  if(camera.position.distanceToSquared(lastCamera)>.36){
   lastCamera.copy(camera.position);
   for(const b of [...corals,...shells,...sponges]){
    let count=0;
    b.activeIndices.length=0;
    for(let i=0;i<b.sites.length;i++){
     const p=b.sites[i];if(Math.hypot(camera.position.x-p.x,camera.position.y-p.floor,camera.position.z-p.z)>b.range)continue;
     b.activeIndices.push(i);
     b.mesh.instanceMatrix.array.set(b.matrices[i],count++*16);
    }
    b.mesh.count=count;b.mesh.visible=count>0;b.mesh.instanceMatrix.needsUpdate=true;
   }
  }
 };
 return {corals,shells,sponges,update,dispose};
}
