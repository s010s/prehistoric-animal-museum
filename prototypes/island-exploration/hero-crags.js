import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {terrainHeight,riverX,halfWidth,slopeAt} from './field.js'

// Authored jointed bedrock study. Convex intersections of fracture planes,
// with separate tilted blocks embedded into the bank; no radial cylinders.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x))
const hash=(a,b=0)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n)}
const v=(x,y,z)=>new T.Vector3(x,y,z)
function planesFor(seed){
 const planes=[]
 const add=(x,y,z,d)=>{const n=v(x,y,z),l=n.length();planes.push({n:n.divideScalar(l),d:d/l})}
 // Tall broad joint faces are cut at different attitudes, not rounded equally.
 add(1,.13+.14*hash(seed,1),.06,.5);add(-1,-.08,.11,.48)
 add(.06,.09,1,.47);add(-.12,-.10,-1,.49)
 add(.20,1,-.17,.47);add(-.10,-1,.06,.50)
 add(.64, .32, .80,.65+.10*hash(seed,2))
 add(-.76,.17, .65,.60+.10*hash(seed,3))
 add(.75,-.10,-.72,.62+.12*hash(seed,4))
 add(-.70,.26,-.73,.64+.08*hash(seed,5))
 // Unequal broken top corners; no common horizontal lid.
 add( .71,.83, .19,.54+.10*hash(seed,6))
 add(-.47,.94,-.56,.58+.09*hash(seed,7))
 if(seed%3===0)add(.92,.54,-.35,.54)
 return planes
}
function fracturePolyhedron(seed){
 const planes=planesFor(seed),points=[]
 for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++)for(let k=j+1;k<planes.length;k++){
  const a=planes[i],b=planes[j],c=planes[k],bc=b.n.clone().cross(c.n),det=a.n.dot(bc)
  if(Math.abs(det)<1e-7)continue
  const q=bc.multiplyScalar(a.d).add(c.n.clone().cross(a.n).multiplyScalar(b.d)).add(a.n.clone().cross(b.n).multiplyScalar(c.d)).divideScalar(det)
  if(planes.every(p=>p.n.dot(q)<p.d+1e-6)&&!points.some(p=>p.distanceToSquared(q)<1e-10))points.push(q)
 }
 return planes.map(plane=>{
  const ring=points.filter(p=>Math.abs(plane.n.dot(p)-plane.d)<1e-5)
  if(ring.length<3)return null
  const center=ring.reduce((s,p)=>s.add(p),v(0,0,0)).divideScalar(ring.length)
  const u=(Math.abs(plane.n.y)>.85?v(1,0,0):v(0,1,0)).cross(plane.n).normalize(),w=plane.n.clone().cross(u)
  ring.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(w),a.clone().sub(center).dot(u))-Math.atan2(b.clone().sub(center).dot(w),b.clone().sub(center).dot(u)))
  return {ring,center,normal:plane.n}
 }).filter(Boolean)
}
export function createCragGeometry(seed,size){
 const p=[],uv=[],indices=[];const [sx,sy,sz]=size
 for(const face of fracturePolyhedron(seed)){
  const ring=face.ring.map(a=>v(a.x*sx,a.y*sy,a.z*sz)),center=face.center.clone().multiply(v(sx,sy,sz))
  const fn=face.normal.clone().divide(v(sx,sy,sz)).normalize()
  for(let edge=0;edge<ring.length;edge++){
   const a=center,b=ring[edge],c=ring[(edge+1)%ring.length],n=6,base=p.length/3,row=[]
   for(let i=0;i<=n;i++){
    row[i]=[]
    for(let j=0;j<=n-i;j++){
     const u=i/n,w=j/n,t=1-u-w,q=a.clone().multiplyScalar(t).addScaledVector(b,u).addScaledVector(c,w)
     // Keep all polygon edges exact. Shallow bedding pits live inside faces.
     const anchor=Math.sin(Math.PI*t)*Math.sin(Math.PI*u)*Math.sin(Math.PI*w)
     const grain=Math.sin(q.x*1.6+q.z*.7+seed)*Math.sin(q.y*2.8+seed*.7)
     const bedding=-Math.pow(.5+.5*Math.sin(q.y*4.6+q.x*.28+q.z*.17+seed),12)
     q.addScaledVector(fn,anchor*(grain*.12+bedding*.19))
     row[i][j]=p.length/3;p.push(q.x,q.y,q.z)
     if(Math.abs(fn.y)>.65)uv.push(q.x/12.7,q.z/12.7)
     else uv.push((Math.abs(fn.x)>Math.abs(fn.z)?q.z:q.x)/12.7,q.y/12.7)
    }
   }
   for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
    indices.push(row[i][j],row[i+1][j],row[i][j+1])
    if(j<n-i-1)indices.push(row[i+1][j],row[i+1][j+1],row[i][j+1])
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('uv1',g.getAttribute('uv').clone());g.setIndex(indices);g.computeVertexNormals();return g
}
export function createHeroCragLayout(){
 const layout=[]
 const clusters=[[-1175,35,13],[-935,26,10],[-745,27,18],[-570,25,14],[-355,39,12],[-175,29,8]]
 let id=0
 const put=(x,z,size,rotation,burial,kind)=>{
  const ground=terrainHeight(x,z),[w,h,d]=size,seed=id++
  // Fit the actual rotated underside, not just the centre of a sloping bank.
  const probe=createCragGeometry(seed,size),pp=probe.attributes.position,rot=new T.Matrix4().makeRotationFromEuler(new T.Euler(...rotation))
  let allowed=Infinity
  for(let i=0;i<pp.count;i++)if(pp.getY(i)<-h*.25){
   const q=v(pp.getX(i),pp.getY(i),pp.getZ(i)).applyMatrix4(rot)
   allowed=Math.min(allowed,terrainHeight(x+q.x,z+q.z)-q.y-.35)
  }
  probe.dispose()
  layout.push({seed,position:[x,Math.min(ground+h*(.5-burial),allowed),z],size,rotation,kind})
 }
 for(let ci=0;ci<clusters.length;ci++){
  const [cz,distance,height]=clusters[ci],count=3+(ci%2),yaw=Math.atan2(riverX(cz+5)-riverX(cz-5),10)
  for(let j=0;j<count;j++){
   const z=cz+(j-(count-1)/2)*(9+hash(ci,j)*5),x=riverX(z)-halfWidth(z)-distance-(hash(ci+10,j)-.5)*14
   const h=height*(.52+.48*hash(ci+20,j)),w=7+hash(ci+30,j)*10,d=8+hash(ci+40,j)*8
   put(x,z,[w,h,d],[(hash(ci+50,j)-.5)*.25,yaw+(hash(ci+60,j)-.5)*1.1,(hash(ci+70,j)-.5)*.28],.28+hash(ci+80,j)*.15,'bedrock')
  }
  // Fallen fragments form asymmetric fans below the outcrop, never a bead row.
  for(let j=0;j<4;j++){
   const z=cz+(hash(ci+100,j)-.5)*49,x=riverX(z)-halfWidth(z)-(7+hash(ci+110,j)*13)
   const h=1.8+hash(ci+120,j)*3.6
   put(x,z,[h*(1.1+hash(ci+130,j)),h,h*(1.0+hash(ci+140,j))],[(hash(ci+150,j)-.5)*.8,hash(ci+160,j)*6.28,(hash(ci+170,j)-.5)*.7],.32,'talus')
  }
 }
 // Exposed sea-facing escarpment: unequal joint blocks rooted in the existing
 // slope, with recesses between groups and smaller fallen slabs below.
 for(let i=0;i<46;i++){
  const z=-2900+i*39+(hash(i,220)-.5)*22;
  let x=-2460,best=Infinity;
  for(let sx=-2550;sx<-2350;sx+=10){const h=terrainHeight(sx,z),score=Math.abs(h-155)+slopeAt(sx,z)*24;if(score<best){best=score;x=sx}}
  if(hash(i,221)<.14)continue;
  const h=44+hash(i,222)*57,w=24+hash(i,223)*30,d=27+hash(i,224)*26;

  if(i%3===0)for(let j=0;j<3;j++){
   const tz=z+(hash(i,j+230)-.5)*70,tx=x-45-hash(i,j+240)*60,r=4+hash(i,j+250)*10;
   put(tx,tz,[r*1.8,r,r*1.3],[hash(i,j)*.7,hash(i,j+1)*6.28,hash(i,j+2)*.8],.38,'coastal-talus');
  }
 }
 return layout
}
export function createHeroCragMeshGeometry(){
 const chunks=[]
 for(const item of createHeroCragLayout()){
  const g=createCragGeometry(item.seed,item.size),matrix=new T.Matrix4().compose(new T.Vector3(...item.position),new T.Quaternion().setFromEuler(new T.Euler(...item.rotation)),v(1,1,1));g.applyMatrix4(matrix);chunks.push(g)
 }
 const geometry=mergeGeometries(chunks);chunks.forEach(g=>g.dispose());return geometry
}
export async function makeHeroCrags(){
 const loader=new T.TextureLoader(),tx=await Promise.all(['albedo','normal','arm'].map(n=>loader.loadAsync(`./assets/cliff-${n}.webp`)))
 tx.forEach((t,i)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;if(i===0)t.colorSpace=T.SRGBColorSpace})
 const mat=new T.MeshStandardMaterial({map:tx[0],normalMap:tx[1],normalScale:new T.Vector2(.75,.75),roughnessMap:tx[2],aoMap:tx[2],aoMapIntensity:.65,roughness:.95,color:'#b8c0b6'})
 // Darker seams / gentle upward moss: the source remains a real layered PBR set.
 mat.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cragP,cragN;').replace('#include <begin_vertex>','#include <begin_vertex>\ncragP=(modelMatrix*vec4(position,1.)).xyz;cragN=normalize(mat3(modelMatrix)*normal);')
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 cragP,cragN;').replace('#include <map_fragment>','#include <map_fragment>\nfloat moss=smoothstep(.35,.90,cragN.y)*(.30+.10*sin(cragP.x*.62+cragP.z*.41));float seams=0.;diffuseColor.rgb*=mix(vec3(1.),vec3(.50,.67,.37),moss)*(1.-seams*.18);')
 }
 const group=new T.Group(),mesh=new T.Mesh(createHeroCragMeshGeometry(),mat);mesh.name='jointed-bedrock-and-talus';mesh.castShadow=true;mesh.receiveShadow=true;group.name='hero-crags';group.add(mesh);return group
}
// Drop-in compatibility with the prototype's existing cliffs module.
export const makeCliffs=makeHeroCrags
