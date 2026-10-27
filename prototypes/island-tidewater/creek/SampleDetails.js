import {Group,Mesh,BufferGeometry,Float32BufferAttribute,CylinderGeometry,Vector3,Quaternion} from '../vendor/tidewater/src/engine/index.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {buildRockGeometry} from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {coniferTextures} from './ConiferGeometry.js';

export class SampleDetails{
 static async create(options){
  if(!options.data.field.continuousSample)return null;
  const r=await fetch(new URL('./assets/sample-fissure.json',import.meta.url));if(!r.ok)throw Error('Authored sample outcrop missing');
  return new SampleDetails(options,await r.json());
 }
 constructor({scene,data,colliders},asset){
  const d=this.design=data.field.continuousSample,t=data.terrain,rng=mulberry32(181071),rocks=[],wood=[],UP=new Vector3(0,1,0);
  this.group=new Group();this.group.name='West continuous sample landmarks';this.rootFeet=[];this.logs=[];this.snags=[];this.rocks=[];
  const geometry=(p,n,uv,ix)=>{const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('normal',new Float32BufferAttribute(n,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(ix);return g;};
  this.heroTriangles=asset.index.length/3;const hero=geometry(asset.position,asset.normal,asset.uv,asset.index);hero.translate(...asset.origin);rocks.push(hero);
  // Conservative individual slabs; the small central emerging channel remains
  // open. Collision bounds are part of the landmark, not invisible railings.
  for(const [x,z,r]of [[-643.9,-501.6,1.15],[-640.3,-501.8,1.1],[-642,-503.6,1.4]])colliders.addCylinder(x,z,r,54,59,{tag:'sample embedded source slab'});
  const addRock=(x,z,size,seed)=>{
   const h=t.heightAt(x,z),g=buildRockGeometry(seed%3,seed,2);g.scale(size,size*(.45+rng()*.5),size*(.7+rng()*.45));g.rotateY(.42+(rng()-.5)*.7);g.rotateZ((rng()-.5)*.35);g.translate(x,h-size*.22,z);rocks.push(g);
   const top=h+size*.78;this.rocks.push({x,z,size,base:h-size*.22,top});if(size>.32)colliders.addCylinder(x,z,size*.68,h-size*.3,top,{tag:'sample channel boulder'});
  };
  // Discrete rock controls at the plunge apron and selected bends. Density
  // varies by landmark; no regularly spaced ring or repeat along the stream.
  for(const [cx,cz,count,spread,scale] of [[-650,-489,11,4.2,.5],[-660,-480,9,4.5,.42],[-706,-403,10,8,.7],[-714,-287,13,9,.65],[-743,-168,9,10,.6],[-783,24,7,8,.4],[-958,164,8,11,.9],[-1010,126,11,17,1.7]]){
   for(let i=0;i<count;i++){
    const a=rng()*Math.PI*2,r=Math.sqrt(rng())*spread,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,f=data.field.sample(x,z),h=t.heightAt(x,z);
    if(h>f[0]+6||h<f[0]-12||Math.hypot(x+642,z+500)<2.5)continue;
    addRock(x,z,scale*(.22+Math.pow(rng(),1.4)*1.5),1800+rocks.length*7);
   }
  }
  const addWood=(g,kind=0)=>{g.setAttribute('aKind',new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(kind),1));wood.push(g);};
  for(const control of d.channelControls){
   if(control.kind==='rock'){addRock(...control.position,control.radius,18813);continue;}
   const a=control.a,b=control.b,r=control.radius,A=new Vector3(a[0],data.field.sample(...a)[0]+r*.22,a[1]),B=new Vector3(b[0],data.field.sample(...b)[0]+r*.22,b[1]),axis=B.clone().sub(A),g=new CylinderGeometry(r*.72,r,axis.length(),11,8),q=new Quaternion().setFromUnitVectors(UP,axis.clone().normalize()),uv=g.attributes.uv;
   for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i),uv.getY(i)*axis.length()/3.1);g.applyQuaternion(q);g.translate(...A.clone().add(B).multiplyScalar(.5).toArray());addWood(g,1);
   for(let i=0;i<Math.ceil(axis.length());i++){const p=A.clone().lerp(B,(i+.5)/Math.ceil(axis.length()));colliders.addCylinder(p.x,p.z,r*.8,p.y-r,p.y+r,{tag:'sample channel wood control'});}
   this.logs.push({id:control.id,hydraulicControl:true,a:A.toArray(),b:B.toArray(),radius:r,length:axis.length(),scour:control.scour,method:'shared authored wood/scour positions; geometric analogue, not sediment or flow simulation'});
  }
  for(const tree of d.forestRecords.filter(r=>r.variant===4)){
   for(let arm=0;arm<5;arm++){
    const angle=tree.yaw+arm*1.256637,dx=Math.cos(angle),dz=Math.sin(angle),sx=-dz,sz=dx,start=tree.s*.20,L=tree.s*(1.6+(arm%3)*.19),p=[],uv=[],ix=[];
    for(let j=0;j<=4;j++){
     const u=j/4,dist=start+u*L,w=tree.s*(.26*(1-u)+.025),H=tree.s*.18*(1-u)**2;
     for(let k=0;k<=6;k++){const a=Math.PI*k/6,x=tree.x+dx*dist+sx*Math.cos(a)*w,z=tree.z+dz*dist+sz*Math.cos(a)*w;p.push(x,t.heightAt(x,z)-.055+Math.sin(a)*H,z);uv.push(u*3,k/6);}
    }
    for(let j=0;j<4;j++)for(let k=0;k<6;k++){const a=j*7+k;ix.push(a,a+7,a+8,a,a+8,a+1);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();addWood(g);
    this.rootFeet.push({tree:[tree.x,tree.z],end:[tree.x+dx*(start+L),tree.z+dz*(start+L)],maxBaseOffset:-.055});
   }
  }
  // A fallen stem rests on the highest required support along its length.
  // Search for modest gradients instead of burying a rigid cylinder in a hill.
  for(const [cx,cz,angle,L,radius]of [[-739,-318,.4,11,.54],[-681,-431,-.7,8,.43],[-765,-201,1.3,13,.61],[-699,-370,2.1,7,.32]]){
   let site=null;
   for(let iz=-4;iz<=4;iz++)for(let ix=-4;ix<=4;ix++){
    const x=cx+ix*2,z=cz+iz*2,dx=Math.cos(angle)*L/2,dz=Math.sin(angle)*L/2,A=[x-dx,z-dz],B=[x+dx,z+dz],a=t.heightAt(...A)+radius*.70,b=t.heightAt(...B)+radius*.70;
    if(Math.abs(a-b)/L>.35||d.forestRecords.some(q=>Math.hypot(q.x-x,q.z-z)<3.5)||data.field.sample(x,z)[1]<4)continue;
    let raise=0;const support=[];
    for(let j=0;j<=20;j++){const u=j/20,px=A[0]+(B[0]-A[0])*u,pz=A[1]+(B[1]-A[1])*u,ground=t.heightAt(px,pz);raise=Math.max(raise,ground+radius*.48-(a+(b-a)*u));support.push({u,x:px,z:pz,ground});}
    if(raise>.4)continue;
    const score=Math.hypot(ix,iz)+raise*10;if(!site||score<site.score)site={A,B,a:a+raise,b:b+raise,support,score};
   }
   if(!site)continue;
   const A=new Vector3(site.A[0],site.a,site.A[1]),B=new Vector3(site.B[0],site.b,site.B[1]),axis=B.clone().sub(A),g=new CylinderGeometry(radius*.72,radius,axis.length(),11,8),q=new Quaternion().setFromUnitVectors(UP,axis.clone().normalize()),p=g.attributes.position,uv=g.attributes.uv;
   for(let i=0;i<p.count;i++)uv.setXY(i,uv.getX(i),uv.getY(i)*L/3.1);g.applyQuaternion(q);g.translate(...A.clone().add(B).multiplyScalar(.5).toArray());addWood(g,1);
   for(let j=0;j<Math.ceil(L);j++){const p=A.clone().lerp(B,(j+.5)/Math.ceil(L));colliders.addCylinder(p.x,p.z,radius*.86,p.y-radius,p.y+radius,{tag:'sample fallen log'});}
   this.logs.push({a:A.toArray(),b:B.toArray(),radius,length:axis.length(),support:site.support.map(s=>({...s,centreHeight:site.a+(site.b-site.a)*s.u,undersideGap:site.a+(site.b-site.a)*s.u-radius-s.ground}))});
  }
  for(const tree of d.forestRecords.filter(r=>r.variant===4).filter((_,i)=>i%9===4)){
   const x=tree.x+7,z=tree.z+6,y=t.heightAt(x,z);if(data.field.sample(x,z)[1]<3)continue;
   const H=9+rng()*12,r=.35+rng()*.35,g=new CylinderGeometry(r*.33,r,H,9,7);g.translate(x,y+H/2-.12,z);addWood(g,2);colliders.addCylinder(x,z,r,y-.2,y+H,{tag:'sample snag'});this.snags.push({x,z,height:H,radius:r});
  }
  const rockMat=new Material({name:'Weathered coastal granite and wet joints',modules:[data.appearance.module,data.field.module],surface:`
 let P=in.P;let N=in.N;let grad=terrainImplicitGrad(P);let d=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/3.5);let r=terrainRockSurface(P*.83,N,P.y,d.w,.24,.18,grad);
 let f=creekFieldAt(P.xz);let wet=(1.0-smoothstep(.08,.9,P.y-f.x))*(1.0-smoothstep(.0,1.8,f.y));let tone=vec3f(.245,.238,.209)*(.82+d.z*.26);s.albedo=mix(r.albedo,tone,.62)*mix(1.0,.57,wet);s.normal=terrainPerturbNormal(P,N,r.hd*.45,1.0);s.roughness=mix(.93,.46,wet);s.specularIntensity=.18;s.ao=.94;`});
  const woodMat=new Material({name:'Sample old wood and damp roots',attributes:{aKind:'f32'},varyings:{vKind:'f32'},bindings:{sampleBark:{texture:()=>coniferTextures.bark}},vertex:'o.vKind=v.aKind;',surface:`
 let bark=textureSample(sampleBark,smpAnisoRepeat,in.uv*vec2f(1.0,2.0)).rgb;let wet=smoothstep(.25,.9,in.N.y);s.albedo=bark*vec3f(.70,.74,.62);s.albedo=mix(s.albedo,vec3f(.055,.071,.029),wet*.33);s.roughness=.96;s.specularIntensity=.10;s.ao=.90;
 if(in.vs.vKind>1.5){s.albedo*=.74;}
 `});
  const addMesh=(parts,mat,name)=>{if(!parts.length)return;for(const g of parts){delete g.attributes.ao;if(!g.attributes.uv)g.setAttribute('uv',new Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));}const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());g.computeBoundingSphere();const mesh=new Mesh(g,mat);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.staticVelocity=true;this.group.add(mesh);return g.index.count/3;};
  this.rockTriangles=addMesh(rocks,rockMat,'Sample granite source and forced-pool stones');this.woodTriangles=addMesh(wood,woodMat,'Sample mixed-age dead wood and rooted feet');scene.add(this.group);
 }
 update(camera){this.group.visible=this.reviewVisible!==false&&Math.hypot(camera.position.x+750,camera.position.z+230)<1700;}
 stats(){return {source:{origin:[-642,55,-500],triangles:this.heroTriangles,method:'Blender closed weathered joint masses and physically embedded recess'},rootFeet:this.rootFeet.length,logs:this.logs,snags:this.snags,rocks:this.rocks.length,rockTriangles:this.rockTriangles,woodTriangles:this.woodTriangles,scientificStatus:'authored landform/structural forest analogy, not scan or taxonomic reconstruction'};}
}
