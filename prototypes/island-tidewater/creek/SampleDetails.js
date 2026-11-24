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
  const visitorSpots=[[-639.5,-494.5],[-690,-275],[-742,-153],[-651,-478]];
  const nearVisitor=(x,z)=>visitorSpots.some(([vx,vz])=>Math.hypot(x-vx,z-vz)<2.3);
  const addRock=(x,z,size,seed,subdiv=null)=>{
   const h=t.heightAt(x,z),g=buildRockGeometry(seed%3,seed,subdiv??(size<.32?1:2));g.scale(size,size*(.38+rng()*.46),size*(.68+rng()*.46));g.rotateY(.42+(rng()-.5)*1.4);g.rotateZ((rng()-.5)*.32);g.translate(x,h-size*.24,z);rocks.push(g);
   const top=h+size*.72;this.rocks.push({x,z,size,base:h-size*.24,top});if(size>.36)colliders.addCylinder(x,z,size*.68,h-size*.3,top,{tag:'sample channel boulder'});
  };
  // Discrete rock controls at the plunge apron and selected bends. Density
  // varies by landmark; no regularly spaced ring or repeat along the stream.
  for(const [cx,cz,count,spread,scale] of [
   [-646,-494,14,3.4,.28],[-650,-489,14,4.4,.46],[-660,-480,12,4.8,.40],
   [-706,-403,11,8,.68],[-714,-287,14,9,.62],[-696,-276,22,7.5,.38],[-703,-266,18,7.5,.34],
   [-746,-161,24,8.5,.36],[-754,-166,18,7.5,.32],[-743,-168,11,10,.56],
   [-783,24,9,8,.42],[-958,164,8,11,.9],[-1010,126,11,17,1.7],
  ]){
   for(let i=0;i<count;i++){
    const a=rng()*Math.PI*2,r=Math.sqrt(rng())*spread,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,f=data.field.sample(x,z),h=t.heightAt(x,z);
    if(h>f[0]+3.6||h<f[0]-10||Math.hypot(x+642,z+500)<2.4||nearVisitor(x,z))continue;
    addRock(x,z,scale*(.20+Math.pow(rng(),1.35)*1.42),1800+rocks.length*7);
   }
  }
  // Dense bank cobble & gravel shoals hugging the waterline at sample-source, sample-jam & sample-stream.
  for(const [startD,endD,stepD,clusterCount] of [[16,62,4.5,4],[228,286,4.2,5],[358,412,4.5,5]]){
   for(const pt of d.points){
    if(pt.distance<startD||pt.distance>endD)continue;
    if(Math.floor(pt.distance/stepD)===Math.floor((pt.distance-4)/stepD))continue;
    const rn=d.nearest(pt.x,pt.z);if(!rn)continue;
    const nx=rn.dir[1],nz=-rn.dir[0];
    for(const side of [-1,1]){
     for(let c=0;c<clusterCount;c++){
      const along=(rng()-.5)*3.4,off=rn.width*(.72+rng()*.62)*side;
      const x=pt.x+rn.dir[0]*along+nx*off,z=pt.z+rn.dir[1]*along+nz*off;
      const f=data.field.sample(x,z),h=t.heightAt(x,z);
      if(nearVisitor(x,z)||Math.hypot(x+642,z+500)<2.6||h>f[0]+1.25||h<f[0]-.65)continue;
      const sz=.11+Math.pow(rng(),1.7)*.34;
      addRock(x,z,sz,4100+rocks.length*11,1);
     }
    }
   }
  }
  const addWood=(g,kind=0)=>{g.setAttribute('aKind',new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(kind),1));wood.push(g);};
  for(const control of d.channelControls){
   if(control.kind==='rock'){addRock(...control.position,control.radius,18813);continue;}
   const a=control.a,b=control.b,r=control.radius,A=new Vector3(a[0],data.field.sample(...a)[0]+r*.22,a[1]),B=new Vector3(b[0],data.field.sample(...b)[0]+r*.22,b[1]),axis=B.clone().sub(A),L=axis.length(),g=new CylinderGeometry(r*.68,r*1.04,L,13,12),q=new Quaternion().setFromUnitVectors(UP,axis.clone().normalize()),p=g.attributes.position,uv=g.attributes.uv;
   // Give the storm-felled jam trunk organic bark flutes, slight bow and weathered end.
   for(let i=0;i<p.count;i++){
    const py=p.getY(i),u=(py+L*.5)/L,ang=Math.atan2(p.getZ(i),p.getX(i));
    const flute=1+.085*Math.sin(ang*5+py*1.1)+.045*Math.cos(ang*3-py*.6);
    const bow=Math.sin(u*Math.PI)*.14;
    p.setXYZ(i,p.getX(i)*flute+bow,py,p.getZ(i)*flute);
    uv.setXY(i,uv.getX(i),uv.getY(i)*L/3.1);
   }
   g.computeVertexNormals();g.applyQuaternion(q);g.translate(...A.clone().add(B).multiplyScalar(.5).toArray());addWood(g,1);
   // Wedged driftwood limbs and broken stubs caught against the fallen jam log.
   const dir=axis.clone().normalize(),perp=new Vector3(-dir.z,0,dir.x);
   for(const [u,sideSign,len,rad,pitch,yawOff] of [[.26,1,3.2,.11,.14,.52],[.48,-1,2.6,.09,.08,-.64],[.68,1,2.1,.08,.22,.88]]){
    const baseP=A.clone().lerp(B,u).addScaledVector(perp,sideSign*r*.45);
    baseP.y-=r*.15;
    const limbDir=dir.clone().multiplyScalar(Math.cos(yawOff)).addScaledVector(perp,Math.sin(yawOff)*sideSign);
    limbDir.y=pitch;limbDir.normalize();
    const tipP=baseP.clone().addScaledVector(limbDir,len);
    const lg=new CylinderGeometry(rad*.35,rad,len,7,4);
    lg.applyQuaternion(new Quaternion().setFromUnitVectors(UP,limbDir));
    lg.translate(...baseP.clone().add(tipP).multiplyScalar(.5).toArray());
    addWood(lg,1);
   }
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
 let P=in.P;let N=in.N;let grad=terrainImplicitGrad(P);let d=textureSample(terrainDetailTex,smpAnisoRepeat,P.xz/3.5);let d2=textureSample(terrainDetailTex,smpAnisoRepeat,(P.xz+vec2f(P.y*.4,-P.y*.3))/1.3);let r=terrainRockSurface(P*.92,N,P.y,d.w,.32,.22,grad);
 let f=creekFieldAt(P.xz);
 let springDist=length(P.xz-vec2f(-642.0,-500.0));
 let springSeep=(1.0-smoothstep(1.2,4.4,springDist))*(1.0-smoothstep(-.2,1.65,P.y-55.0));
 let wet=max((1.0-smoothstep(.06,.85,P.y-f.x))*(1.0-smoothstep(.0,2.2,f.y)),springSeep*.82);
 let strata=sin(P.y*7.8+d.w*2.6+P.x*.45)*.5+.5;
 let tone=mix(vec3f(.175,.168,.148),vec3f(.275,.258,.218),strata*.55+d2.w*.45)*(.84+d.z*.26);
 let mossMask=smoothstep(.46,.84,N.y)*smoothstep(.38,.72,d.w*.58+d2.w*.42)*(1.0-smoothstep(.02,.25,wet*.4));
 var col=mix(r.albedo,tone,.52);
 col=mix(col,vec3f(.075,.115,.042),mossMask*.56);
 let seamAO=mix(.62,1.0,smoothstep(-.05,.38,P.y-terrainHeightAt(P.xz)));
 s.albedo=col*mix(1.0,.52,wet);s.normal=terrainPerturbNormal(P,N,r.hd*.72+(d2.w-.5)*.022,1.0);s.roughness=mix(.93,.36,wet);s.specularIntensity=mix(.18,.34,wet);s.ao=.92*seamAO;`});
  const woodMat=new Material({name:'Sample old wood and damp roots',attributes:{aKind:'f32'},varyings:{vKind:'f32'},modules:[data.field.module],bindings:{sampleBark:{texture:()=>coniferTextures.bark},sampleBarkNormal:{texture:()=>coniferTextures.barkNormal}},vertex:'o.vKind=v.aKind;',surface:`
 let barkUV=in.uv*vec2f(1.0,2.2);
 let bark=textureSample(sampleBark,smpAnisoRepeat,barkUV).rgb;
 let barkNM=textureSample(sampleBarkNormal,smpAnisoRepeat,barkUV).xyz*2.0-1.0;
 let barkN=perturbNormalByMap(in.P,in.N,barkUV,barkNM);
 let wf=creekFieldAt(in.P.xz);
 let waterWet=(1.0-smoothstep(.04,.55,in.P.y-wf.x))*(1.0-smoothstep(0.0,1.8,wf.y));
 let moss=smoothstep(.32,.86,in.N.y)*(.45+.45*sin(in.P.x*1.3+in.P.z*.9));
 s.albedo=bark*vec3f(.68,.70,.58);
 s.albedo=mix(s.albedo,vec3f(.055,.082,.028),clamp(moss*.48,0.0,.55));
 s.albedo*=mix(1.0,.54,waterWet);
 s.normal=barkN;
 s.roughness=mix(.95,.46,waterWet);s.specularIntensity=mix(.10,.26,waterWet);s.ao=.88*mix(.82,1.0,clamp(barkNM.z,0.0,1.0));
 if(in.vs.vKind>1.5){s.albedo*=.74;}
 `});
  const addMesh=(parts,mat,name)=>{
   if(!parts.length)return 0;
   const buckets=new Map();
   for(const g of parts){
    delete g.attributes.ao;
    if(!g.attributes.uv)g.setAttribute('uv',new Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    g.computeBoundingSphere();
    const c=g.boundingSphere.center,key=Math.floor(c.x/160)+','+Math.floor(c.z/160);
    let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push(g);
   }
   let total=0;
   for(const [key,list] of buckets){
    const g=mergeGeometries(list);list.forEach(p=>p.dispose());g.computeBoundingSphere();
    const mesh=new Mesh(g,mat);mesh.name=buckets.size===1?name:`${name} (${key})`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.staticVelocity=true;this.group.add(mesh);
    total+=g.index.count/3;
   }
   return total;
  };
  this.rockTriangles=addMesh(rocks,rockMat,'Sample granite source and forced-pool stones');this.woodTriangles=addMesh(wood,woodMat,'Sample mixed-age dead wood and rooted feet');scene.add(this.group);
 }
 update(camera){this.group.visible=this.reviewVisible!==false&&Math.hypot(camera.position.x+750,camera.position.z+230)<1700;}
 stats(){return {source:{origin:[-642,55,-500],triangles:this.heroTriangles,method:'Blender closed weathered joint masses and physically embedded recess'},rootFeet:this.rootFeet.length,logs:this.logs,snags:this.snags,rocks:this.rocks.length,rockTriangles:this.rockTriangles,woodTriangles:this.woodTriangles,scientificStatus:'authored landform/structural forest analogy, not scan or taxonomic reconstruction'};}
}
