// Museum-authored fallen wood and root feet. All contact vertices use the same
// CPU terrain as walking; materials stay in the native opaque/shadow/TAA pass.
import {Group,Mesh,BufferGeometry,Float32BufferAttribute,CylinderGeometry,SphereGeometry,Vector3,Quaternion} from '../vendor/tidewater/src/engine/index.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {coniferTextures} from './ConiferGeometry.js';
import {GROVE,groveWeight,grovePathDistance} from './GroveDesign.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
const UP=new Vector3(0,1,0);
const segmentDistance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(x-a[0]-u*dx,z-a[1]-u*dz);};
function placeLog(a,b,r,forest,data){
 const cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2,L=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[1]-a[1],b[0]-a[0]);
 const trees=forest.records.filter(t=>Math.hypot(t.x-cx,t.z-cz)<L+65);let best=null;
 for(let dz=-36;dz<=36;dz+=4)for(let dx=-36;dx<=36;dx+=4)for(const turn of [0,-.35,.35]){
  const q=yaw+turn,vx=Math.cos(q)*L/2,vz=Math.sin(q)*L/2,A=[cx+dx-vx,cz+dz-vz],B=[cx+dx+vx,cz+dz+vz];let stem=Infinity,path=Infinity,wet=false;
  for(const t of trees)stem=Math.min(stem,segmentDistance(t.x,t.z,A,B)-(t.variant===4?.9:.24)*t.s-r);
  if(stem<.5)continue;
  for(let k=0;k<=8;k++){const x=A[0]+(B[0]-A[0])*k/8,z=A[1]+(B[1]-A[1])*k/8;path=Math.min(path,grovePathDistance(x,z)-r);if(data.field.sample(x,z)[1]<3)wet=true;}
  if(path<3.5||wet)continue;
  const ya=data.terrain.heightAt(...A),yb=data.terrain.heightAt(...B),slope=Math.abs(ya-yb)/L;
  if(slope>.33)continue;
  const score=Math.hypot(dx,dz)+Math.abs(turn)*12+slope*18;
  if(!best||score<best.score)best={a:A,b:B,score,stemClearance:stem,pathClearance:path};
 }
 if(!best)throw Error('No unobstructed fallen wood site near '+cx+','+cz);return best;
}
export class GroveDetails{
 constructor({scene,data,forest,colliders}){
  this.group=new Group();this.group.name='Museum old-growth fallen wood and roots';const parts=[],terrain=data.terrain;this.logs=[];this.rootFeet=[];this.snags=[];this.fungalSpots=[];
  const add=(g,kind)=>{g.setAttribute('aWood',new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(kind),1));parts.push(g);};
  const logs=[[[1398,-2077],[1412,-2068],.62],[[1345,-2119],[1359,-2128],.83],[[1458,-2144],[1477,-2135],.96],[[1509,-2027],[1521,-2020],.47],[[1277,-2166],[1292,-2162],.72],[[1500,-2170],[1531,-2156],1.12],[[1540,-2253],[1574,-2258],1.15],[[1418,-2318],[1446,-2343],1.24],[[1313,-2226],[1346,-2210],1.10],[[1606,-2326],[1639,-2312],1.22],[[1715,-2172],[1744,-2191],.91],[[1180,-2130],[1206,-2120],.83],[[1468,-2440],[1508,-2436],1.04]];
  for(const [requestedA,requestedB,r] of logs){
   const site=placeLog(requestedA,requestedB,r,forest,data),a=site.a,b=site.b;
   const pa=new Vector3(a[0],terrain.heightAt(...a)+r*.56,a[1]),pb=new Vector3(b[0],terrain.heightAt(...b)+r*.56,b[1]),axis=pb.clone().sub(pa),L=axis.length(),q=new Quaternion().setFromUnitVectors(UP,axis.clone().normalize());
   const g=new CylinderGeometry(r*.69,r,L,11,6),pos=g.attributes.position,n=g.attributes.normal,wood=new Float32Array(pos.count);
   for(let i=0;i<pos.count;i++){const y=pos.getY(i),a0=Math.atan2(pos.getZ(i),pos.getX(i)),k=1+Math.sin(a0*5+y*.65)*.055;pos.setXYZ(i,pos.getX(i)*k,y+(Math.abs(n.getY(i))>.5?Math.sin(a0*3)*r*.09:0),pos.getZ(i)*k);wood[i]=Math.abs(n.getY(i))>.5?1:0;}
   const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)if(wood[i]<.5)uv.setXY(i,uv.getX(i),uv.getY(i)*L/4);
   g.computeVertexNormals();g.setAttribute('aWood',new Float32BufferAttribute(wood,1));g.applyQuaternion(q);g.translate(...pa.clone().add(pb).multiplyScalar(.5).toArray());parts.push(g);
   const segments=Math.ceil(L);for(let j=0;j<segments;j++){const p0=pa.clone().lerp(pb,j/segments),p1=pa.clone().lerp(pb,(j+1)/segments),center=p0.clone().add(p1).multiplyScalar(.5),span=Math.hypot(p1.x-p0.x,p1.z-p0.z);colliders.addBox(center,new Vector3(r,r+Math.abs(p1.y-p0.y)*.5,span*.5+r*.12),Math.atan2(pb.x-pa.x,pb.z-pa.z),{solid:true,tag:'old-growth sloping log segment'});}
   this.logs.push({a:pa.toArray(),b:pb.toArray(),radius:r,length:L,stemClearance:site.stemClearance,pathClearance:site.pathClearance});
   // Small dull bracket/fruiting-body forms show the decomposer niche on
   // fallen wood. These are an ecological form, not a named fossil species.
   if(this.logs.length%2===0||this.logs.length===7){
    const d=pb.clone().sub(pa).normalize(),side=new Vector3(-d.z,0,d.x),spot=pa.clone().lerp(pb,.23).addScaledVector(side,r*.48);spot.y+=r*.78;
    for(let k=0;k<4;k++){const cap=new SphereGeometry(1,8,4),size=.15+(k%3)*.045;cap.scale(size,.035+k*.004,size*.8);cap.translate(spot.x+side.x*k*.16,spot.y+k*.055,spot.z+side.z*k*.16);add(cap,2);}
    this.fungalSpots.push(spot.toArray());
   }
  }
  const rng=mulberry32(17102026);
  for(let i=0;i<170&&this.snags.length<28;i++){
   const a=rng()*6.283,d=Math.sqrt(rng())*650,x=1400+Math.cos(a)*d,z=-2120+Math.sin(a)*d/GROVE.zScale;
   if(groveWeight(x,z)<.35||grovePathDistance(x,z)<10||data.field.sample(x,z)[1]<6||forest.records.some(r=>Math.hypot(r.x-x,r.z-z)<7))continue;
   const H=20+rng()*17,r=.65+rng()*.8,y=terrain.heightAt(x,z),g=new CylinderGeometry(r*.36,r,H,9,7),p=g.attributes.position,uv=g.attributes.uv;
   for(let j=0;j<p.count;j++){const h=p.getY(j)+H/2,angle=Math.atan2(p.getZ(j),p.getX(j)),px=x+p.getX(j),pz=z+p.getZ(j);let py=y+h;if(h<2)py+=(terrain.heightAt(px,pz)-y-.08)*(1-h/2);if(h>H-.1)py-=r*(.4+.35*Math.sin(angle*5+H));p.setXYZ(j,px,py,pz);uv.setXY(j,uv.getX(j),uv.getY(j)*H/4);}
   g.computeVertexNormals();add(g,3);colliders.addCylinder(x,z,r,y-.15,y+H,{tag:'old-growth standing dead wood'});this.snags.push({x,z,height:H,radius:r});
  }
  for(const r of forest.records.filter(r=>r.variant===4&&(r.landmark||grovePathDistance(r.x,r.z)<18)).sort((a,b)=>(b.landmark?1:0)-(a.landmark?1:0)||grovePathDistance(a.x,a.z)-grovePathDistance(b.x,b.z)).slice(0,72)){
   for(let arm=0;arm<5;arm++){
    // Start inside the actual flared stem, keeping each outer tip fixed.
    // The old .65*s head could stick out above the narrower trunk surface.
    const angle=arm*1.256637+r.yaw,dx=Math.cos(angle),dz=Math.sin(angle),sx=-dz,sz=dx,start=.22*r.s,L=r.s*(1.71+(arm%3)*.2),verts=[],uv=[],idx=[];
    for(let j=0;j<4;j++){const t=j/3,d=start+t*L,width=r.s*(.30*(1-t)+.035),height=r.s*.20*(1-t)*(1-t);
     for(let ring=0;ring<=6;ring++){const angle=Math.PI*(1-ring/6),side=Math.cos(angle),up=Math.sin(angle),x=r.x+dx*d+sx*side*width,z=r.z+dz*d+sz*side*width,y=terrain.heightAt(x,z)-.055+height*up;verts.push(x,y,z);uv.push(t*3,ring/6);}
    }
    for(let j=0;j<3;j++)for(let k=0;k<6;k++){const a=j*7+k;idx.push(a,a+7,a+8,a,a+8,a+1);}
    const cx=r.x+dx*start,cz=r.z+dz*start,cap=verts.length/3;verts.push(cx,terrain.heightAt(cx,cz)-.055,cz);uv.push(0,.5);for(let k=0;k<6;k++)idx.push(cap,k+1,k);
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(verts,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();add(g,0);this.rootFeet.push({tree:[r.x,r.z],end:[r.x+dx*(L+start),r.z+dz*(L+start)]});
    for(let j=0;j<3;j++){const t0=j/3,t1=(j+1)/3,d0=start+t0*L,d1=start+t1*L,x=r.x+dx*(d0+d1)*.5,z=r.z+dz*(d0+d1)*.5,base=terrain.heightAt(x,z)-.07,top=base+r.s*.20*(1-t0)*(1-t0);colliders.addBox(new Vector3(x,(base+top)*.5,z),new Vector3(r.s*(.30*(1-t0)+.035),Math.max(.06,(top-base)*.5),L/6),Math.atan2(dx,dz),{solid:true,walkable:true,tag:'old-growth exposed root'});}
   }
  }
  const material=new Material({name:'Museum aged wood and moss',side:'double',attributes:{aWood:'f32'},varyings:{vWood:'f32'},bindings:{groveBark:{texture:()=>coniferTextures.bark}},vertex:'o.vWood=v.aWood;',surface:`
 let bark=textureSample(groveBark,smpAnisoRepeat,in.uv*vec2f(1.0,2.4)).rgb;
 let r=length(in.uv-.5);let grain=sin(r*120.0)*(.12*(1.0-smoothstep(.01,.05,fwidth(r))));
 let end=mix(vec3f(.095,.061,.028),vec3f(.20,.144,.07),r*.6+.3+grain);
 let moss=.5+.25*sin(in.P.x*.9+sin(in.P.z*.7))+.2*sin(in.P.z*1.7);
 s.albedo=mix(bark*vec3f(.77,.76,.69),end,step(.5,in.vs.vWood));
 s.albedo=mix(s.albedo,vec3f(.055,.080,.025),smoothstep(.4,.8,in.N.y)*smoothstep(.51,.75,moss)*.65);
 if(in.vs.vWood>1.5&&in.vs.vWood<2.5){s.albedo=mix(vec3f(.12,.086,.046),vec3f(.22,.18,.12),clamp(in.N.y,0.0,1.0));}
 if(in.vs.vWood>2.5){s.albedo=bark*vec3f(.58,.58,.53);}
 s.roughness=.96;s.specularIntensity=.08;s.ao=.82;`});
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());geometry.computeBoundingSphere();this.mesh=new Mesh(geometry,material);this.mesh.name='Grove rooted feet and fallen trunks';this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.staticVelocity=true;this.group.add(this.mesh);scene.add(this.group);this.triangles=geometry.index.count/3;
  const point=this.fungalSpots[3]??this.fungalSpots[0];let view=null;
  const nearby=forest.records.filter(t=>Math.hypot(t.x-point[0],t.z-point[2])<20);
  for(let a=0;a<24;a++)for(const d of [3.5,4.5,6]){const x=point[0]+Math.cos(a*Math.PI/12)*d,z=point[2]+Math.sin(a*Math.PI/12)*d,y=terrain.heightAt(x,z);if(nearby.some(t=>Math.hypot(x-t.x,z-t.z)<(t.variant===4?.92:.24)*t.s+.5)||this.logs.some(l=>segmentDistance(x,z,[l.a[0],l.a[2]],[l.b[0],l.b[2]])<l.radius+.8))continue;const score=d+Math.abs(y+1.62-point[1])*2;if(!view||score<view.score)view={p:[x,z],score};}
  if(!view)throw Error('No safe decomposer observation footing');
  data.groveObservations={decomposition:{point,arrival:view.p},log:{point:this.logs[0].a,arrival:[this.logs[0].a[0]+3.5,this.logs[0].a[2]+3.5]}};
 }
 stats(){return {logs:this.logs,snags:this.snags,fungalSpots:this.fungalSpots,fungalForms:this.fungalSpots.length*4,rootFeet:this.rootFeet.length,triangles:this.triangles,draws:1,scientificStatus:'fallen wood / standing dead wood / decomposer forms as old-growth ecological analogies; no named fossil fungi',contact:'CPU terrain at every root-foot vertex; approximate solid cylinders/boxes for stems and fallen wood'};}
}
