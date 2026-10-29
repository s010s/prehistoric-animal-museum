// Lowpoly Vault models are static source art. This adapter keeps their geometry
// and credit intact while giving fins, wings and walking limbs local motion.
import {BufferGeometry,BufferAttribute,Float32BufferAttribute,InstancedMesh,Matrix4,Quaternion,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {loadGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {CORALS,SHELLS,SPONGES,REEF_URLS} from './VaultReefAssets.js';
import {createVaultArticulatedModel,eryonWalkState} from './VaultArticulation.js';

const urls={
 aeger:new URL('./assets/aeger-lowpoly-vault.glb',import.meta.url).href,
 aspidorhynchus:new URL('./assets/aspidorhynchus-lowpoly-vault.glb',import.meta.url).href,
 rhamphorhynchus:new URL('./assets/rhamphorhynchus-lowpoly-vault.glb',import.meta.url).href,
 diplomystus:new URL('./assets/diplomystus-lowpoly-vault.glb',import.meta.url).href,
 eusthenopteron:new URL('./assets/eusthenopteron-lowpoly-vault.glb',import.meta.url).href,
 anomalocaris:new URL('./assets/anomalocaris-lowpoly-vault.glb',import.meta.url).href,
 eryon:new URL('./assets/eryon-lowpoly-vault.glb',import.meta.url).href,
 thecosmilia:new URL('./assets/thecosmilia-lowpoly-vault.glb',import.meta.url).href,
 favosites:new URL('./assets/favosites-lowpoly-vault.glb',import.meta.url).href,
 meganeura:new URL('./assets/meganeura-lowpoly-vault.glb',import.meta.url).href,
 pterodaustro:new URL('./assets/pterodaustro-lowpoly-vault.glb',import.meta.url).href,
 acrocyathus:new URL('./assets/acrocyathus-lowpoly-vault.glb',import.meta.url).href,
 gryphaea:new URL('./assets/gryphaea-lowpoly-vault.glb',import.meta.url).href,
 hippurites:new URL('./assets/hippurites-lowpoly-vault.glb',import.meta.url).href,
 coccosteus:new URL('./assets/coccosteus-lowpoly-vault.glb',import.meta.url).href,
 dipterus:new URL('./assets/dipterus-lowpoly-vault.glb',import.meta.url).href,
 ...REEF_URLS,
};
export async function loadVaultCoastLife(){
 const models=await Promise.all(Object.values(urls).map(loadGLB));
 return Object.fromEntries(Object.keys(urls).map((key,i)=>[key,models[i]]));
}

function collect(gltf,accept,convert=(x,y,z)=>[x,y,z],{side=0,swimPart=()=>0}={}){
 const positions=[],normals=[],data=[],colors=[],indices=[];
 for(const node of gltf.nodes){
  if(node.mesh===undefined||!accept(node.name))continue;
  if(node.s.some(v=>v!==1)||node.r.some((v,i)=>v!==(i===3?1:0)))throw Error('Vault model transform needs baking: '+node.name);
  for(const primitive of gltf.meshes[node.mesh]){
   const p=primitive.attributes.POSITION.array,n=primitive.attributes.NORMAL?.array;
   const material=primitive.material??0,color=gltf.materials[material]?.pbrMetallicRoughness?.baseColorFactor??[.5,.5,.5,1];
   const localPart=swimPart(node.name,material);
   const offset=positions.length/3;
   for(let i=0;i<p.length;i+=3){
    const v=convert(p[i]+node.t[0],p[i+1]+node.t[1],p[i+2]+node.t[2]);positions.push(...v);
    const normal=convert(n?.[i]??0,n?.[i+1]??1,n?.[i+2]??0,true);normals.push(...normal);
    // Integer = fish motion part; fraction = Vault material slot. The source
    // eye must not accidentally behave like a native fish fin.
    data.push(Math.max(0,Math.min(1,.5-v[2])),localPart+material/16,localPart===5?Math.max(.3,Math.min(1,Math.abs(v[0])*2)):v[0],Math.max(-1,Math.min(1,v[1]*3)));
    colors.push(...color.slice(0,3));
   }
   const ix=primitive.indices??Array.from({length:p.length/3},(_,i)=>i);
   for(let i=0;i<ix.length;i+=3){
    if(side){const centroid=(p[ix[i]*3]+p[ix[i+1]*3]+p[ix[i+2]*3])/3+node.t[0];if((centroid<0?-1:1)!==side)continue;}
    indices.push(offset+ix[i],offset+ix[i+1],offset+ix[i+2]);
   }
  }
 }
 if(!indices.length)throw Error('Empty vault geometry');
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('normal',new Float32BufferAttribute(normals,3));g.setAttribute('aData',new Float32BufferAttribute(data,4));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.setIndex(new BufferAttribute(new Uint32Array(indices),1));g.computeBoundingSphere();return g;
}
function lengthwiseBounds(gltf){
 let min=Infinity,max=-Infinity,low=Infinity,high=-Infinity;
 for(const node of gltf.nodes)if(node.mesh!==undefined)for(const primitive of gltf.meshes[node.mesh]){
  const p=primitive.attributes.POSITION.array;for(let i=2;i<p.length;i+=3){min=Math.min(min,p[i]+node.t[2]);max=Math.max(max,p[i]+node.t[2]);low=Math.min(low,p[i-1]+node.t[1]);high=Math.max(high,p[i-1]+node.t[1]);}
 }
 return {length:max-min,center:(min+max)*.5,centerY:(low+high)*.5};
}
export function vaultFishGeometry(gltf,kind){
 let convert;
 if(kind==='aeger')convert=(x,y,z,normal=false)=>normal?[x,y,z]:[x/.174,y/.174,(z-.045)/.174];
 else if(kind==='aspidorhynchus')convert=(x,y,z,normal=false)=>normal?[-z,y,x]:[-z/.9,y/.9,x/.9];
 else{const {length,center,centerY}=lengthwiseBounds(gltf);convert=(x,y,z,normal=false)=>normal?[x,y,z]:[x/length,(y-centerY)/length,(z-center)/length];}
 const swimPart=(name,material)=>kind==='aeger'&&material===3||kind==='anomalocaris'&&(name.includes('flaps')||name.includes('tail-fan'))||kind==='diplomystus'&&name.includes('fins')||['eusthenopteron','coccosteus','dipterus'].includes(kind)&&/pectoral|pelvic/i.test(name)?5:0;
 return collect(gltf,()=>true,convert,{swimPart});
}
export function vaultFishSurface(gltf,pattern,tint=[1,1,1]){
 const colours=gltf.materials.map(m=>m.pbrMetallicRoughness?.baseColorFactor??[.5,.5,.5,1]);
 const rgb=c=>c.slice(0,3).map((v,i)=>(v*tint[i]).toFixed(6)).join(',');
 // Native fish use the integer part of aData.y for articulation. The
 // material slot lives in its fraction so source colours remain distinct.
 let code=`if(in.vs.vFishInfo.x>=${pattern}.0&&in.vs.vFishInfo.x<${pattern+1}.0){let vaultPart=floor(fract(in.vs.vFishData.y)*16.0+0.25);var vaultColor=vec3f(${rgb(colours[0])});`;
 for(let i=1;i<colours.length;i++)code+=`if(vaultPart>${i-.5}){vaultColor=vec3f(${rgb(colours[i])});}`;
 return code+'s.albedo=vaultColor;s.metalness=0.0;s.roughness=.68;s.specularIntensity=.16;s.translucency=vec3f(0.0);}\n';
}

const animalMaterial=name=>new Material({name,vertexColors:true,roughness:.79,metalness:0,side:'double'});

export async function createVaultPterosaurs(rhamphorhynchus,pterodaustro,scene,terrain){
 const flyers=[];
 for(let i=0;i<2;i++){
  const articulation=await createVaultArticulatedModel(rhamphorhynchus,'rhamphorhynchus'),{root}=articulation,left=articulation.bone('left-shoulder'),right=articulation.bone('right-shoulder');
  root.name='Rhamphorhynchus '+(i+1);root.scale.setScalar(1+i*.08);scene.add(root);
  flyers.push({species:'Rhamphorhynchus',root,left,right,articulation,model:articulation.model,phase:i*Math.PI,radius:28+i*9,altitude:9+i*2});
 }
 const articulation=await createVaultArticulatedModel(pterodaustro,'pterodaustro'),{root}=articulation,left=articulation.bone('left-shoulder'),right=articulation.bone('right-shoulder');
 root.name='Pterodaustro';scene.add(root);flyers.push({species:'Pterodaustro',root,left,right,articulation,model:articulation.model,phase:1.4,radius:39,altitude:12});
 const update=(time,camera)=>{
  for(const [i,f]of flyers.entries()){
   const pte=f.species==='Pterodaustro',a=time*(pte?.055:.075)+f.phase,rx=f.radius,rz=pte?f.radius*.62:f.radius;
   const x=(pte?-915:-883)+Math.cos(a)*rx,z=(pte?146:139)+Math.sin(a)*rz;
   const y=Math.max(terrain.heightAt(x,z),-.7)+f.altitude+Math.sin(time*.31+f.phase)*.5;
   f.root.visible=Math.hypot(camera.position.x-x,camera.position.z-z)<230;
   f.root.position.set(x,y,z);f.root.rotation.set(.025*Math.sin(time*.6+i),Math.atan2(-rx*Math.sin(a),rz*Math.cos(a)),Math.sin(time*.4+i)*.08);
   f.articulation.update(time+f.phase*1.7);
  }
 };
 return {flyers,update,hold:()=>flyers.forEach(f=>f.articulation.hold()),stats:()=>flyers.map(f=>({species:f.species,...f.articulation.stats()}))};
}

export async function createVaultInsect(gltf,scene,terrain,query){
 const articulation=await createVaultArticulatedModel(gltf,'meganeura'),{root}=articulation;
 const wings=articulation.rig.wings.map(w=>({side:w.side,pair:w.pair,mesh:articulation.handles[w.bones[0]],camber:articulation.handles[w.bones[1]]}));
 root.name='Meganeura at creek mouth';root.scale.setScalar(.85);for(const m of articulation.model.meshes)m.castShadow=true;
 // query.height deliberately returns -90 on dry ground. Compare the bank
 // against the nearby physical water plane, never that no-water sentinel.
 const waterAt=(x,z)=>{const f=query.field.sample(x,z);return Math.max(-.7,f[1]<44?f[0]:-.7);};
 let perch=null;
 for(let dz=-48;dz<=48;dz+=2)for(let dx=-48;dx<=48;dx+=2){
  const x=-824+dx,z=102+dz,floor=terrain.heightAt(x,z),water=waterAt(x,z),clear=floor-water;
  if(clear<.3||clear>12)continue;const score=Math.hypot(dx,dz)+Math.abs(clear-.8)*3;if(!perch||score<perch.score)perch={x,z,y:floor+.001,water,clearance:clear,score};
 }
 if(!perch)throw Error('No dry Meganeura perch beside the widened sample creek');
 const up=new Vector3(0,1,0),forward=new Vector3(0,0,1),normal=new Vector3(),q=new Quaternion(),yawQ=new Quaternion(),rollQ=new Quaternion();
 scene.add(root);
 const update=(time,camera)=>{
  const cycle=time%31,flying=cycle<9,strength=flying?Math.max(0,Math.min(1,cycle/1.4,(9-cycle)/1.4)):0;
  const x=perch.x+strength*Math.sin(cycle*.71)*4.2,z=perch.z+strength*Math.sin(cycle*.48)*3;
  const y=perch.y+strength*(Math.max(terrain.heightAt(x,z),query.height(x,z))+1.5+Math.sin(time*2.1)*.16-perch.y);
  root.visible=Math.hypot(camera.position.x-x,camera.position.z-z)<75;
  root.position.set(x,y,z);
  normal.set(-(terrain.heightAt(perch.x+.08,perch.z)-terrain.heightAt(perch.x-.08,perch.z))/.16,1,-(terrain.heightAt(perch.x,perch.z+.08)-terrain.heightAt(perch.x,perch.z-.08))/.16).normalize().lerp(up,strength).normalize();
  q.setFromUnitVectors(up,normal).multiply(yawQ.setFromAxisAngle(up,flying?Math.atan2(.71*4.2*Math.cos(cycle*.71),.48*3*Math.cos(cycle*.48)):1.2));
  q.multiply(rollQ.setFromAxisAngle(forward,Math.sin(time*1.5)*.10*strength));root.quaternion.copy(q);
  articulation.update(time,strength);
 };
 return {root,wings,perch,update,articulation,model:articulation.model,hold:articulation.hold,stats:()=>({...articulation.stats(),perch,position:root.position.toArray(),groundClearance:root.position.y-terrain.heightAt(root.position.x,root.position.z),waterClearance:root.position.y-waterAt(root.position.x,root.position.z)})};
}

function reefGeometry(gltf,tint,shell=false){
 const geometry=collect(gltf,()=>true),positions=geometry.attributes.position.array,colors=geometry.attributes.color.array;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],positions[i+k]);hi[k]=Math.max(hi[k],positions[i+k]);}
 const dimensions=hi.map((v,i)=>v-lo[i]),span=shell?Math.max(...dimensions):Math.max(dimensions[0],dimensions[2]),cx=(lo[0]+hi[0])*.5,cz=(lo[2]+hi[2])*.5,height=hi[1]-lo[1];
 geometry.reefFlatAxis=dimensions.indexOf(Math.min(...dimensions));
 for(let i=0;i<positions.length;i+=3){
  const shade=.74+.26*Math.sqrt(Math.max(0,(positions[i+1]-lo[1])/Math.max(.001,height)));
  positions[i]=(positions[i]-cx)/span;positions[i+1]=(positions[i+1]-lo[1])/span;positions[i+2]=(positions[i+2]-cz)/span;
  for(let k=0;k<3;k++)colors[i+k]=(colors[i+k]*.45+tint[k]*.55)*shade;
 }
 geometry.computeBoundingSphere();return geometry;
}

export async function createVaultBenthos(vault,scene,terrain,{aeger:anchor,coralSites=[],shellSites=[],spongeSites=[],obstacles=[]}={}){
 if(!anchor&&!coralSites.length&&!shellSites.length)return null;
 const {eryon}=vault;
 const crawlers=[];
 if(anchor){
  // Reserve the complete crawl ellipse, animal and near observation camera.
  // A free root point alone can still put the feet or camera inside a colony.
  const blockers=[...coralSites,...shellSites,...spongeSites].map(s=>({x:s.x,z:s.z,r:(s.span??.25)*.72})).concat(obstacles.map(s=>({x:s.x,z:s.z,r:s.footRadius??(s.scale??s.size??.3)*.75})));
  const findPatch=(cx,cz)=>{
   let best=null;
   for(let dz=-8;dz<=8;dz+=.25)for(let dx=-8;dx<=8;dx+=.25){
    const x=cx+dx,z=cz+dz,floor=terrain.heightAt(x,z),depth=-.7-floor;
    if(depth<1.4||depth>3.8||crawlers.some(c=>Math.hypot(x-c.x,z-c.z)<1.2))continue;
    let gap=Infinity;for(const p of blockers){gap=Math.min(gap,Math.hypot(p.x-x,p.z-z)-p.r-.74);if(gap<.025)break;}if(gap<.025)continue;
    let relief=0;for(let a=0;a<16;a++){const q=a*Math.PI/8;relief=Math.max(relief,Math.abs(terrain.heightAt(x+Math.cos(q)*.64,z+Math.sin(q)*.64)-floor));}
    if(relief>.065)continue;const score=Math.hypot(dx,dz)+relief*2;
    if(!best||score<best.score)best={x,z,score,placement:{minimumColonyGap:gap,footAndCameraEnvelope:.74,bedRelief:relief,meanWaterDepth:depth}};
   }
   if(!best)throw Error('No open sand patch for articulated Eryon and close observation');return best;
  };
  for(let i=0;i<2;i++){
   const articulation=await createVaultArticulatedModel(eryon,'eryon'),{root}=articulation;
   root.name='Eryon '+(i+1);root.scale.setScalar(1.18);scene.add(root);
   crawlers.push({root,articulation,model:articulation.model,left:articulation.bone('left-leg-0-link-0'),right:articulation.bone('right-leg-0-link-0'),tail:articulation.bone('abdomen-plate-5'),phase:i*2.7,...findPatch(anchor.x+(i?1.25:-1.15),anchor.z+(i?-.75:1.25))});
  }
 }
 const corals=[],shells=[],sponges=[],up=new Vector3(0,1,0),leanAxis=new Vector3(0,0,1),normal=new Vector3(),pos=new Vector3(),q=new Quaternion(),yawQ=new Quaternion(),leanQ=new Quaternion(),size=new Vector3(),vertex=new Vector3(),transform=new Matrix4();
 const coralMat=animalMaterial('museum-coral-gardens-vault'),shellMat=animalMaterial('museum-shell-forms-vault'),spongeMat=animalMaterial('museum-sponges-vault');
 for(const material of [coralMat,shellMat,spongeMat])material.surface='s.roughness=.88;s.emissive=s.albedo*.028;';
 const batches=(kinds,allSites,material,out,tintFor,category)=>{
  for(const kind of kinds){
   const sites=allSites.filter(site=>site.kind===kind);if(!sites.length)continue;
   const isShell=category==='shell forms',geometry=reefGeometry(vault[kind],tintFor(kind),isShell),positions=geometry.attributes.position.array;
   const batch=new InstancedMesh(geometry,material,sites.length),matrices=[];
   batch.name=kind+' '+category;batch.castShadow=true;batch.receiveShadow=true;batch.staticVelocity=true;batch.frustumCulled=false;
   for(const site of sites){
    yawQ.setFromAxisAngle(up,site.yaw??0);
    if(isShell){
     normal.set(geometry.reefFlatAxis===0?1:0,geometry.reefFlatAxis===1?1:0,geometry.reefFlatAxis===2?1:0);
     q.copy(yawQ);if(!site.upright)q.multiply(leanQ.setFromUnitVectors(normal,up));
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
    pos.set(site.x,site.y,site.z);size.setScalar(site.span);transform.compose(pos,q,size);matrices.push(Float32Array.from(transform.elements));
   }
   batch.count=0;scene.add(batch);out.push({kind,mesh:batch,sites,matrices});
  }
 };
 batches(CORALS.map(c=>c.id),coralSites,coralMat,corals,kind=>CORALS.find(c=>c.id===kind).tint,'coral colonies');
 batches(SHELLS,shellSites,shellMat,shells,()=>[.68,.63,.52],'shell forms');
 batches(SPONGES,spongeSites,spongeMat,sponges,kind=>kind==='vauxia'?[.52,.59,.39]:[.64,.53,.39],'sponges');
 let lastCamera=new Vector3(Infinity,Infinity,Infinity);
 const update=(time,camera)=>{
  for(const c of crawlers){
   const walk=eryonWalkState(time+c.phase),angle=walk.clock*.18+c.phase;
   const x=c.x+Math.cos(angle)*.26,z=c.z+Math.sin(angle)*.19;
   c.root.visible=Math.hypot(camera.position.x-x,camera.position.z-z)<32;
   c.root.position.set(x,terrain.heightAt(x,z)+.002,z);
   normal.set(-(terrain.heightAt(x+.04,z)-terrain.heightAt(x-.04,z))/.08,1,-(terrain.heightAt(x,z+.04)-terrain.heightAt(x,z-.04))/.08).normalize();
   q.setFromUnitVectors(up,normal).multiply(yawQ.setFromAxisAngle(up,Math.atan2(-.26*Math.sin(angle),.19*Math.cos(angle))));c.root.quaternion.copy(q);
   c.articulation.update(time+c.phase,walk.activity,walk.clock);
  }
  // Pack nearby instances only. Increasing the habitat footprint must not
  // submit every distant colony whenever one member of its species is near.
  if(camera.position.distanceToSquared(lastCamera)>.36){
   lastCamera.copy(camera.position);
   for(const b of [...corals,...shells,...sponges]){
    let count=0;const range=b.mesh.material===shellMat?31:42;
    for(let i=0;i<b.sites.length;i++){
     const p=b.sites[i];if(Math.hypot(camera.position.x-p.x,camera.position.y-p.floor,camera.position.z-p.z)>range)continue;
     b.mesh.instanceMatrix.array.set(b.matrices[i],count++*16);
    }
    b.mesh.count=count;b.mesh.visible=count>0;b.mesh.instanceMatrix.needsUpdate=true;
   }
  }
 };
 return {crawlers,corals,shells,sponges,update,hold:()=>crawlers.forEach(c=>c.articulation.hold()),stats:()=>crawlers.map(c=>({species:'Eryon',...c.articulation.stats(),position:c.root.position.toArray(),placement:c.placement}))};
}
