// Museum-owned spring fissure and layered wet-bank vegetation. These are
// botanical/landform studies, not species-level palaeo-reconstructions.
import {Group,Mesh,BufferGeometry,Float32BufferAttribute,CylinderGeometry,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {ShaderModule} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {VegType} from '../vendor/tidewater/src/world/vegetation/InstanceLOD.js';
import {vegModule} from '../vendor/tidewater/src/world/vegetation/VegNodes.js';
import {buildRockGeometry} from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
function horsetail(){
 const parts=[];for(let s=0;s<3;s++){const h=1.45+s*.23,x=(s-1)*.16,z=s%2*.16,c=new CylinderGeometry(.013,.023,h,5,9);c.translate(x,h/2,z);parts.push(c);
  const p=[],n=[],uv=[],idx=[];for(let j=1;j<7;j++)for(let a=0;a<7;a++){const angle=a*Math.PI*2/7+j*.37,y=j*h/7,L=.23*(1-j/9),i=p.length/3;for(const [r,dy,w] of [[0,0,-.007],[L,.07,0],[0,0,.007]]){p.push(x+Math.cos(angle)*r+Math.sin(angle)*w,y+dy,z+Math.sin(angle)*r-Math.cos(angle)*w);n.push(0,.85,.3);uv.push(r/L,j/7);}idx.push(i,i+1,i+2);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('normal',new Float32BufferAttribute(n,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(idx);parts.push(g);
 }
 const g=mergeGeometries(parts);parts.forEach(x=>x.dispose());const p=g.attributes.position,a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=p.getY(i)/2;g.setAttribute('aFlex',new Float32BufferAttribute(a,1));return g;
}
export class LandscapeDetails{
 constructor({scene,data,colliders}){
  this.group=new Group();this.group.name='Museum spring and wet-bank layers';this.records=[];
  const terrain=data.terrain,F=data.field,random=mulberry32(197701),sites=[];
  for(let z=-130;z<180;z+=5){const r=F.riverAt(z);if(r)for(const side of [-1,1])sites.push([r.x+side*(r.width-4+random()*12),z+random()*3]);}
  for(const lake of data.island.lakes)for(let n=0;n<500;n++){const a=n/500*Math.PI*2,r=.82+random()*.3;sites.push([lake.center[0]+Math.cos(a)*lake.rx*r,lake.center[1]+Math.sin(a)*lake.rz*r]);}
  for(let z=5670;z<6230;z+=10)for(let x=5140;x<5660;x+=10)if(random()<.45)sites.push([x+random()*7,z+random()*7]);
  for(const source of [F.headwater,F.tributarySource])for(let i=0;i<72;i++){
   const z=source.origin.z+4+random()*90,r=source.at(z);if(r)sites.push([r.x+(i%2?1:-1)*(r.width+.3+random()*2.8),z]);
  }
  for(const [x,z] of sites){const outcrop=[F.headwater,F.tributarySource].some(s=>Math.hypot((x-s.origin.x)/6.6,(z-s.origin.z+1.8)/5.6)<1);if(outcrop)continue;const y=terrain.heightAt(x,z),f=F.sample(x,z),gap=y-f[0],s=Math.hypot(terrain.heightAt(x+1,z)-terrain.heightAt(x-1,z),terrain.heightAt(x,z+1)-terrain.heightAt(x,z-1))/2;if(gap<-.35||gap>1.25||s>.65||f[1]>12)continue;this.records.push({x,y:y-.045,z,s:(z>5600&&z<6400?1.12:.7)+random()*.45,sy:1,yaw:random()*6.283,seed:random(),H:2,la:0,l:0,qr:80});}
  const material=new Material({name:'Museum jointed wet-bank plants',side:'double',modules:[vegModule],attributes:{iPos:'vec4f',iDat:'vec4f',aFlex:'f32'},varyings:{vAge:'f32',vStem:'f32'},vertex:`
 let base=v.iPos.xyz;let p=(v.model*vec4f(v.position,1.0)).xyz;let flex=v.aFlex*v.aFlex*.085;let ph=base.x*.37+base.z*.19;
 let sway=vegWindDir3()*sin(frame.time*1.2+ph)*flex*vegWindStrength();let old=vegWindDir3()*sin((frame.time-frame.dt)*1.2+ph)*flex*vegWindStrength();
 v.useWorld=true;v.worldPos=p+sway;v.prevWorldPos=p+old;v.worldNormal=vegInstanceNormal(v.model,v.normal);o.vAge=v.iDat.w;o.vStem=v.aFlex;`,surface:`
 let age=in.vs.vAge;let segment=1.0-smoothstep(.0,.035,abs(fract(in.vs.vStem*9.0)-.5));
 s.albedo=mix(vec3f(.048,.073,.028),vec3f(.105,.104,.052),age*.65)*(1.0-segment*.12);s.roughness=.96;s.specularIntensity=.1;s.normal=normalize(in.N+in.V*.08);s.translucency=s.albedo*.10;`});
  this.plants=new VegType('Museum horsetail form',this.records,{fade:[55,75],margin:10,sortNear:true,near:[{geometry:horsetail(),material,castShadow:false,name:'Jointed bank plants'}]});for(const m of this.plants.meshes)this.group.add(m);
  const makeSource=(spring,east=false)=>{
  const first=spring.origin;
  const rock=new Material({name:'Freshwater fractured source rock',modules:[data.appearance.module,F.module],surface:`
 let P=in.P;let N=in.N;let grad=terrainImplicitGrad(P);let d=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/3.5);
 let rock=terrainRockSurface(P,N,P.y,d.w,.37,.22,grad);
 let wet=museumSourceWet(P);let grain=textureSample(terrainDetailTex,smpAnisoRepeat,vec2f(P.x*.61+P.z*.79,P.y)/5.7);
 let mineral=mix(vec3f(.105,.111,.099),vec3f(.185,.181,.153),grain.w);
 s.albedo=mix(rock.albedo,mineral,.42)*mix(.93,.48,wet);s.normal=terrainPerturbNormal(P,N,rock.hd*.7,1.0);s.roughness=mix(.94,.44,wet);s.ao=.88;s.specularIntensity=.18;`});
  const portal=new Group();portal.position.set(first.x,first.level,first.z);portal.name='Three-dimensional fractured headwater';
  const pieces=[],rand=mulberry32(171014),add=(x,y,z,sx,sy,sz,seed,tilt=0)=>{
   const g=buildRockGeometry(seed%3,seed,2);g.scale(sx,sy,sz);g.rotateZ(tilt);g.rotateY(seed*.37);g.translate(x,y,z);pieces.push(g);
   if(Math.max(sx,sz)>.55&&colliders)colliders.addCylinder(first.x+x,first.z+z,Math.min(sx,sz)*.65,first.level+y-sy,first.level+y+sy,{tag:'headwater fissure rock'});
  };
  // Unequal, embedded slabs form a recess with real side faces and an offset
  // roof. The cliff behind closes it; there is no painted black opening.
  const slab=(front,seed)=>{
   const points=[...front,...front.map(([x,y,z])=>[x,y-.1,z-1.7])],ix=[],n=front.length;
   for(let i=1;i<n-1;i++)ix.push(0,i,i+1,n,n+i+1,n+i);
   for(let i=0;i<n;i++){const j=(i+1)%n;ix.push(i,n+i,j,j,n+i,n+j);}
   const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points.flat(),3));g.setIndex(ix);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();flat.setAttribute('ao',new Float32BufferAttribute(new Float32Array(flat.attributes.position.count).fill(1),1));pieces.push(flat);
   if(colliders){const x=front.reduce((v,p)=>v+p[0],0)/n,z=front.reduce((v,p)=>v+p[2],0)/n;colliders.addCylinder(first.x+x,first.z+z,.6,first.level-1,first.level+5,{tag:'source embedded cleft'});}
  };
  if(east){
   // A low fractured outcrop sits in this slope foot; two freestanding tall
   // plates suggested a gateway. Embedded blocks surround a narrow wet cleft.
   add(-2.2,1.2,-1.4,2.5,3.0,3.0,240,.12);
   add(2.6,.7,-1.7,2.9,2.3,3.5,243,-.21);
   add(.25,1.8,-3.5,2.3,1.3,3.4,247,.08);
   for(const [x,z,sx,sy,sz,seed] of [[-5,-3,3.1,1.4,2.7,252],[5.2,-3.6,2.8,1.5,3.4,254],[-3.8,1.4,1.8,.9,2.3,257],[4.1,1,1.9,.8,1.8,260]]){
    add(x,terrain.heightAt(first.x+x,first.z+z)-first.level-.15,z,sx,sy,sz,seed,.1);
   }
  }else{
   slab([[-4.5,-.6,-1.8],[-1.5,-.5,.2],[-.48,.85,-.05],[-.40,2.5,-1.2],[-1.2,4.5,-2.3],[-4.3,5.8,-2.7]],61);
   slab([[.4,-.1,.3],[3.9,-.5,-.4],[5.5,3.6,-2.7],[2.7,5.4,-3.2],[.45,3.6,-1.5],[.35,1.8,-.2]],72);
  }
  add(-1.85,.15,.12,1.13,.78,1.26,94,.18);
  add(1.46,.04,.65,.97,.68,1.22,105,-.11);
  // Fractured apron edges and a few submerged blocks collect around the
  // short stepped chute. Keep its central ribbon clear and its pool open.
  for(let i=0;i<17;i++){
   const z=.35+rand()*8.2,r=spring.at(first.z+Math.min(z,6.4));
   const x=(r?.x??first.x)-first.x+(i%2?1:-1)*(.8+rand()*1.5),wx=first.x+x,wz=first.z+z;
   const y=terrain.heightAt(wx,wz)-first.level-.07,size=.24+rand()*.56;
   add(x,y,wz-first.z,size,.23+rand()*.42,size*(.65+rand()*.6),116+i,(rand()-.5)*.5);
  }
  for(let i=0;i<(east?36:22);i++){
   const dz=8+rand()*(east?102:64),r=spring.at(first.z+dz);if(!r)continue;
   const lateral=(i%2?1:-1)*r.width*(.5+rand()*.65),wx=r.x+lateral,wz=first.z+dz;
   const h=terrain.heightAt(wx,wz),size=.18+Math.pow(rand(),2)*.8;
   if(h>r.level+.4||h<r.level-1.4)continue;
   add(wx-first.x,h-first.level-size*.12,dz,size,.16+size*.45,size*(.65+rand()*.65),400+i,(rand()-.5)*.5);
  }
  const flatPieces=pieces.map(g=>g.index?g.toNonIndexed():g);const geo=mergeGeometries(flatPieces);for(const g of new Set([...pieces,...flatPieces]))g.dispose();const mesh=new Mesh(geo,rock);mesh.castShadow=true;mesh.receiveShadow=true;mesh.staticVelocity=true;portal.add(mesh);
  this.sourceTriangles=(geo.index?.count??geo.attributes.position.count)/3;this.sourceAudit=spring.points.map(p=>({x:p.x,z:p.z,profile:p.level,water:F.sample(p.x,p.z)[0],bed:terrain.heightAt(p.x,p.z)}));this.sourceRockCount=pieces.length;
  this.group.add(portal);return {portal,audit:this.sourceAudit,triangles:this.sourceTriangles,rocks:pieces.length};
  };
  this.sources=[makeSource(F.headwater),makeSource(F.tributarySource,true)];this.portal=this.sources[0].portal;scene.add(this.group);this.camera=new Vector3();

 }
 update(camera){this.plants.update(camera.position);for(const {portal} of this.sources)portal.visible=camera.position.distanceTo(portal.position)<600;}
 stats(){return {jointedBankClumps:this.records.length,nearClumps:this.plants.near.count,portal:this.portal.position.toArray(),sourceGeometry:'embedded fractured slabs with side faces; no black quad; shared profile/physical apron/native 10cm water',sourceRockCount:this.sourceRockCount,sourceTriangles:this.sourceTriangles,sourceProfile:'rock-fissure-profile-v2',sourceAudit:this.sources[0].audit,eastSource:{profile:'east-slope-foot-spring-v1',portal:this.sources[1].portal.position.toArray(),audit:this.sources[1].audit,triangles:this.sources[1].triangles},forms:'segmented stems/whorls, native grass/oat, fern, low leaf cover'};}
}
