import * as T from 'three'
import {buildRockGeometry} from './weathered-rock.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {terrainHeight,riverX,halfWidth,slopeAt} from './field.js'

// Weathered outcrops support the continuous terrain cliff, at metre scale.
const hash=(a,b=0)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n)}
const v=(x,y,z)=>new T.Vector3(x,y,z)
export function createCragGeometry(seed,size){
 const g=buildRockGeometry(seed%3,seed+31,3);g.scale(size[0]*.65,size[1]*.65,size[2]*.65);
 const p=g.attributes.position,n=g.attributes.normal,uv=[];for(let i=0;i<p.count;i++){if(Math.abs(n.getY(i))>.65)uv.push(p.getX(i)/3.7,p.getZ(i)/3.7);else uv.push((Math.abs(n.getX(i))>Math.abs(n.getZ(i))?p.getZ(i):p.getX(i))/3.7,p.getY(i)/3.7)}g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('uv1',g.attributes.uv.clone());return g;
}
export function createHeroCragLayout(improved=true){
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
  let x=-2460,best=Infinity;const targetHeight=85+hash(i,225)*195;
  for(let sx=-2550;sx<-2350;sx+=10){const h=terrainHeight(sx,z),score=Math.abs(h-targetHeight)+slopeAt(sx,z)*24;if(score<best){best=score;x=sx}}
  if(hash(i,221)<.14)continue;
  const h=5+hash(i,222)*12,w=h*(1.4+hash(i,223)),d=h*(1.2+hash(i,224));

  if(improved)put(x,z,[w,h,d],[(hash(i,226)-.5)*.24,hash(i,227)*.7,(hash(i,228)-.5)*.24],.42+hash(i,229)*.12,'coastal-bedrock');
  if(i%3===0)for(let j=0;j<3;j++){
   const tz=z+(hash(i,j+230)-.5)*70,tx=x-45-hash(i,j+240)*60,r=4+hash(i,j+250)*10;
   put(tx,tz,[r*1.8,r,r*1.3],[hash(i,j)*.7,hash(i,j+1)*6.28,hash(i,j+2)*.8],.38,'coastal-talus');
  }
 }
 // Intertidal remnants and talus connect the cliff mass to the waterline.
 // They use the same fractured-rock mesh and buried underside as the upland crags.
 if(improved)for(let i=0;i<68;i++){
  const z=-2860+i*24+(hash(i,401)-.5)*18,target=-4+hash(i,402)*9;
  let x=-2900,best=Infinity;
  for(let sx=-3270;sx<-2580;sx+=5){const score=Math.abs(terrainHeight(sx,z)-target);if(score<best){x=sx;best=score;}}
  if(best>8||hash(i,403)<.22)continue;
  const large=hash(i,404)>.70,h=large?18+hash(i,405)*20:3+hash(i,405)*9,w=h*(.9+hash(i,406)*.7);
  put(x,z,[w,h,w*(.75+hash(i,407)*.45)],[(hash(i,408)-.5)*.15,hash(i,409)*6.28,(hash(i,410)-.5)*.16],large?.18:.35,'intertidal-remnant');
 }
 return layout
}
export function createHeroCragMeshGeometry(improved=true){
 const chunks=[]
 for(const item of createHeroCragLayout(improved)){
  const g=createCragGeometry(item.seed,item.size),matrix=new T.Matrix4().compose(new T.Vector3(...item.position),new T.Quaternion().setFromEuler(new T.Euler(...item.rotation)),v(1,1,1));g.applyMatrix4(matrix);chunks.push(g)
 }
 const geometry=mergeGeometries(chunks);chunks.forEach(g=>g.dispose());return geometry
}
export async function makeHeroCrags(improved=true){
 const loader=new T.TextureLoader(),tx=await Promise.all(['albedo','normal','arm'].map(n=>loader.loadAsync(`./assets/cliff-${n}.webp`)))
 tx.forEach((t,i)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;if(i===0)t.colorSpace=T.SRGBColorSpace})
 const mat=new T.MeshStandardMaterial({map:tx[0],normalMap:tx[1],normalScale:new T.Vector2(.75,.75),roughnessMap:tx[2],aoMap:tx[2],aoMapIntensity:.65,roughness:.95,color:'#b8c0b6'})
 // Darker seams / gentle upward moss: the source remains a real layered PBR set.
 mat.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cragP,cragN;').replace('#include <begin_vertex>','#include <begin_vertex>\ncragP=(modelMatrix*vec4(position,1.)).xyz;cragN=normalize(mat3(modelMatrix)*normal);');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
  varying vec3 cragP,cragN;
  vec3 cragWeights(vec3 n){vec3 w=pow(abs(n),vec3(4.));return w/max(.001,w.x+w.y+w.z);}
  vec3 cragTri(sampler2D tx,vec3 p,vec3 n){vec3 w=cragWeights(n);return texture2D(tx,p.zy).rgb*w.x+texture2D(tx,p.xz).rgb*w.y+texture2D(tx,p.xy).rgb*w.z;}`)
  .replace('#include <map_fragment>',`diffuseColor.rgb*=cragTri(map,cragP/3.7,cragN);
  float moss=smoothstep(.35,.90,cragN.y)*(.30+.10*sin(cragP.x*.62+cragP.z*.41));
  diffuseColor.rgb*=mix(vec3(1.),vec3(.50,.67,.37),moss);
  float tideWet=1.-smoothstep(.15,2.1,cragP.y);diffuseColor.rgb*=mix(vec3(1.),vec3(.38,.43,.38),tideWet);`)
  .replace('#include <normal_fragment_maps>',`vec3 cw=cragWeights(cragN),cp=cragP/3.7;
  vec3 ca=texture2D(normalMap,cp.zy).rgb*2.-1.,cb=texture2D(normalMap,cp.xz).rgb*2.-1.,cc=texture2D(normalMap,cp.xy).rgb*2.-1.;
  vec3 cn=normalize(cragN+vec3(cb.x*cw.y+cc.x*cw.z,ca.y*cw.x+cc.y*cw.z,ca.x*cw.x+cb.y*cw.y)*.60);
  normal=normalize(mat3(viewMatrix)*cn);`)
  .replace('#include <roughnessmap_fragment>','float roughnessFactor=mix(clamp(cragTri(roughnessMap,cragP/3.7,cragN).g*.95,.7,1.),.48,tideWet);')
  .replace('#include <aomap_fragment>','reflectedLight.indirectDiffuse*=mix(1.,cragTri(aoMap,cragP/3.7,cragN).r,.65);');
 };
 mat.customProgramCacheKey=()=> 'triplanar-weathered-crags-r7';
 const group=new T.Group(),mesh=new T.Mesh(createHeroCragMeshGeometry(improved),mat);mesh.name='jointed-bedrock-and-talus';mesh.castShadow=true;mesh.receiveShadow=true;group.name='hero-crags';group.add(mesh);
 // Collision samples the very same weathered triangles, binned in world XZ.
 const grid=new Map(),p=mesh.geometry.attributes.position,ix=mesh.geometry.index.array;
 for(let f=0;f<ix.length;f+=3){const a=v().fromBufferAttribute(p,ix[f]),b=v().fromBufferAttribute(p,ix[f+1]),c=v().fromBufferAttribute(p,ix[f+2]);const det=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(det)<1e-8)continue;const tri={a,b,c,det};for(let z=Math.floor(Math.min(a.z,b.z,c.z)/32);z<=Math.floor(Math.max(a.z,b.z,c.z)/32);z++)for(let x=Math.floor(Math.min(a.x,b.x,c.x)/32);x<=Math.floor(Math.max(a.x,b.x,c.x)/32);x++){const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(tri)}}
 group.userData.heightAt=(x,z)=>{let top=-Infinity;for(const {a,b,c,det} of grid.get(Math.floor(x/32)+','+Math.floor(z/32))??[]){const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/det,w=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/det;if(u>=0&&w>=0&&u+w<=1)top=Math.max(top,u*a.y+w*b.y+(1-u-w)*c.y)}return top};

 return group
}
// Drop-in compatibility with the prototype's existing cliffs module.
export const makeCliffs=makeHeroCrags
