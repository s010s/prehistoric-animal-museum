import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {noise,hash,terrainHeight,riverX,halfWidth} from './field.js'
// Broad, inclined fracture faces and stepped strata. Bases intersect the terrain.
function rockGeometry(seed){
 const radial=48,levels=18,p=[],uv=[],idx=[]
 for(let j=0;j<=levels;j++)for(let i=0;i<=radial;i++){
 const t=j/levels,a=i/radial*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a)
 const profile=Math.pow(Math.max(.003,1-Math.pow(Math.abs(t*2-1),7)),.19)
 const strata=1+.025*Math.sin(t*43+seed)+.035*Math.floor(t*5)/5
 const r=profile*strata*(1-t*.27)*(.90+.13*Math.sin(a*3+seed)+.075*Math.sin(a*7+seed*3))
 const rough=(noise(ca*4+seed,t*11+sa*3)-.5)*.085
 p.push(Math.sign(ca)*Math.pow(Math.abs(ca),.62)*r+rough+t*.21,t-.5,Math.sign(sa)*Math.pow(Math.abs(sa),.69)*r+rough-t*.13);uv.push(i/radial,t)
 if(i<radial&&j<levels){const q=j*(radial+1)+i;idx.push(q,q+1,q+radial+1,q+1,q+radial+2,q+radial+1)}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g
}
export async function makeCliffs(){
 const loader=new T.TextureLoader(),tx=await Promise.all(['albedo','normal','arm'].map(n=>loader.loadAsync(`./assets/cliff-${n}.webp`)))
 tx.forEach((t,i)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;if(!i)t.colorSpace=T.SRGBColorSpace})
 const mat=new T.MeshStandardMaterial({map:tx[0],roughness:1,color:'#bdc0ac'});mat.onBeforeCompile=s=>{
 s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 rockP,rockN;').replace('#include <begin_vertex>','#include <begin_vertex>\nrockP=(modelMatrix*vec4(position,1.)).xyz;rockN=normalize(mat3(modelMatrix)*normal);')
 s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 rockP,rockN;').replace('#include <map_fragment>',`vec3 w=pow(abs(rockN),vec3(5.));w/=dot(w,vec3(1.));vec3 p=rockP/12.7;vec3 albedo=texture2D(map,p.yz).rgb*w.x+texture2D(map,p.xz).rgb*w.y+texture2D(map,p.xy).rgb*w.z;float strata=.86+.14*smoothstep(.15,.5,fract((rockP.y+sin(rockP.x*.1)*1.5)*.14));float moss=smoothstep(.45,.9,rockN.y)*.45;diffuseColor.rgb*=mix(albedo*strata,albedo*vec3(.60,.75,.42),moss);`)
 }
 const group=new T.Group(),variants=[0,1,2,3,4].map(rockGeometry)
 function add(x,z,w,h,d,i){const g=variants[i%5],m=new T.Mesh(g,mat);m.position.set(x,terrainHeight(x,z)+h*.23,z);m.scale.set(w,h,d);m.rotation.y=hash(i,4)*6.28;m.receiveShadow=true;m.castShadow=true;group.add(m)}
 for(let i=0;i<54;i++){const z=-1500+i*24+hash(i,4)*17,side=i%3===0?1:-1,x=riverX(z)+side*(halfWidth(z)+33+hash(i,5)*70);add(x,z,9+hash(i,6)*18,12+hash(i,7)*29,8+hash(i,8)*16,i)}

 const chunks=[];group.updateMatrixWorld(true);for(const m of group.children)chunks.push(m.geometry.clone().applyMatrix4(m.matrixWorld));group.clear();const combined=new T.Mesh(mergeGeometries(chunks),mat);combined.castShadow=true;combined.receiveShadow=true;group.add(combined);chunks.forEach(g=>g.dispose());return group
}
