import * as T from 'three'
import {SIZE,landmarks,smooth,terrainHeight} from './field.js'
export * from './field.js'
export async function groundMaterial(){
 const loader=new T.TextureLoader(),textures=await Promise.all(['cliff','ganges_river_pebbles','rocky_terrain_02','leafy_grass','sandy_gravel_02'].flatMap(n=>['albedo','normal','arm'].map(c=>loader.loadAsync(`./assets/${n}-${c}.webp`))))
 textures.forEach((t,i)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;if(i%3===0)t.colorSpace=T.SRGBColorSpace})
 const debugGround=new URLSearchParams(location.search).has('ground');
 const m=new T.MeshStandardMaterial({roughness:1,map:textures[0],normalMap:textures[1]});m.onBeforeCompile=s=>{
 textures.forEach((t,i)=>s.uniforms['g'+i]={value:t});s.uniforms.groundDebug={value:debugGround?1:0}
 s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float landShade;attribute float waterHeight;varying float localWater;varying float bakedShade;attribute vec3 surfaceBlend;varying vec3 landP,landN,landW;').replace('#include <begin_vertex>','#include <begin_vertex>\nlocalWater=waterHeight;landP=(modelMatrix*vec4(position,1.)).xyz;landN=normalize(transpose(mat3(viewMatrix))*normalMatrix*normal);landW=surfaceBlend;bakedShade=landShade;')
 s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
 uniform float groundDebug;varying float localWater;varying float bakedShade;varying vec3 landP,landN,landW;${textures.map((_,i)=>`uniform sampler2D g${i};`).join('')}
 float hn(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float nn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hn(i),hn(i+vec2(1,0)),f.x),mix(hn(i+vec2(0,1)),hn(i+1.),f.x),f.y);}
 // Triangular stochastic sampling: stable offsets AND rotations, shared weights.
 vec3 tileSample(sampler2D tx,vec2 p,vec2 id,vec2 dx,vec2 dy){float angle=hn(id+3.17)*6.2831853;mat2 r=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));vec2 offset=vec2(hn(id+17.),hn(id-31.))*37.;return textureGrad(tx,fract(r*p+offset),r*dx,r*dy).rgb;}
 vec3 tile(sampler2D tx,vec2 p){vec2 dx=dFdx(p),dy=dFdy(p);vec2 skew=mat2(1.,0.,-.57735027,1.15470054)*(p*1.7);vec2 id=floor(skew),f=fract(skew);vec2 a,b,c;vec3 w;if(f.x+f.y<1.){a=id;b=id+vec2(1,0);c=id+vec2(0,1);w=vec3(1.-f.x-f.y,f.x,f.y);}else{a=id+1.;b=id+vec2(0,1);c=id+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}w=w*w;w/=dot(w,vec3(1));return tileSample(tx,p,a,dx,dy)*w.x+tileSample(tx,p,b,dx,dy)*w.y+tileSample(tx,p,c,dx,dy)*w.z;}
 vec3 tri(sampler2D tx,vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(4.));w/=dot(w,vec3(1));return tile(tx,p.zy)*w.x+tile(tx,p.xz)*w.y+tile(tx,p.xy)*w.z;}`)
 s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`
 vec3 w=landW/max(.001,dot(landW,vec3(1)));vec2 p=landP.xz;
 float macro=.91+.10*nn(p/113.)+.06*nn(p/29.);
 float coastCover=(1.-smoothstep(4.,21.,landP.y+(nn(p/70.)-.5)*6.))*(1.-smoothstep(.01,1.,abs(localWater+.7)))*(1.-w.x);
 vec3 rock=vec3(.18),gravel=vec3(.18,.17,.14),grass=vec3(.12,.16,.06),sand=vec3(.25,.20,.14);
 if(w.x>.005){rock=tri(g0,landP/12.7,landN)*vec3(.55,.60,.58);rock*=.80+.26*nn(p*.023+landP.y*.021);
 float fracture=nn(landP.xy/vec2(21.,37.)+vec2(nn(landP.zy/61.))*2.);rock*=.84+.20*fracture;}
 if(w.y>.005||coastCover>.005){gravel=tile(g3,p/2.8)*vec3(.86,.89,.84);}
 // Fine sand fades into gravel through a broken sediment fringe, not round noise islands.
 if(coastCover>.005){float bankHeight=landP.y-localWater;
 float tidal=1.-smoothstep(.6,3.1,bankHeight+(nn(p/13.)-.5)*.45);
 vec3 sandScan=tile(g12,p/3.2);vec3 fineSand=mix(vec3(.29,.235,.17),sandScan,.30)*mix(vec3(.59,.63,.61),vec3(.88,.89,.83),1.-tidal);
 float fringe=exp(-pow((bankHeight-2.8+(nn(p/7.)-.5)*2.)/1.3,2.));
 float grit=fringe*smoothstep(.3,.72,nn(p/2.7))*.28;
 sand=mix(fineSand,gravel,grit);}
 if(w.z>.005){vec3 leaf=tile(g9,p/2.6)*vec3(.43,.64,.43);float dry=nn(p/65.+vec2(nn(p/140.))*1.7);
 grass=leaf*mix(vec3(.93,1.03,.94),vec3(1.16,1.04,.84),dry);
 float prairie=(1.-smoothstep(.65,1.2,length((p-vec2(5700.,1900.))/vec2(2700.,2900.))))*(1.-smoothstep(4800.,5650.,p.y));
 grass*=mix(vec3(1),vec3(1.17,1.09,.84),prairie);}
 float marsh=1.-smoothstep(.78,1.13,length((p-vec2(3600.,5400.))/vec2(2250.,1500.)));
 float wet=1.-smoothstep(localWater+.15,localWater+1.2,landP.y);
 vec3 mud=mix(vec3(.095,.077,.048),vec3(.16,.135,.08),nn(p/3.7))*(.87+.18*nn(p/11.));
 vec3 ground=(rock*w.x+gravel*w.y+grass*w.z)*macro;
 ground=mix(ground,sand*macro,coastCover);
 ground=mix(ground,mix(grass*mix(vec3(.71,.77,.52),vec3(.92,.87,.63),nn(p/23.)),mud,wet)*macro,marsh*(1.-w.x));
 ground*=mix(.63,1.,smoothstep(localWater+.05,localWater+1.5,landP.y));diffuseColor.rgb*=ground*bakedShade;`)
 s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor=mix(.91,.69,wet);`);
 s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`float detailWeight=1.-smoothstep(50.,260.,length(vViewPosition));if(w.x>.01&&detailWeight>.001){
 vec3 bn=normalize(landN),weights=pow(abs(bn),vec3(4.));weights/=dot(weights,vec3(1));vec3 q=landP/12.7;
 vec3 nx=texture2D(g1,q.zy).xyz*2.-1.,ny=texture2D(g1,q.xz).xyz*2.-1.,nz=texture2D(g1,q.xy).xyz*2.-1.;
 vec3 perturb=vec3(0.,nx.y,nx.x)*weights.x+vec3(ny.x,0.,ny.y)*weights.y+vec3(nz.x,nz.y,0.)*weights.z;
 perturb-=bn*dot(perturb,bn);vec3 worldN=normalize(bn+perturb*.48);
 normal=normalize(mix(normal,mat3(viewMatrix)*worldN,w.x*detailWeight));}`)

 s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','if(groundDebug>.5)outgoingLight=diffuseColor.rgb;\n#include <opaque_fragment>');
 };return m
}

function geometry(r){const g=new T.BufferGeometry();g.setIndex(new T.BufferAttribute(r.indices,1));g.setAttribute('position',new T.BufferAttribute(r.p,3));g.setAttribute('normal',new T.BufferAttribute(r.n,3));g.setAttribute('surfaceBlend',new T.BufferAttribute(r.w,3));g.setAttribute('landShade',new T.BufferAttribute(r.shade,1));g.setAttribute('waterHeight',new T.BufferAttribute(r.water,1));g.computeBoundingSphere();return g}
export function makeLandscape(material,apply,getFine=()=>false){
 const group=new T.Group();let readyResolve,pending=true,triangles=0,vertices=0
 const ready=new Promise(resolve=>readyResolve=resolve)
 const worker=new Worker(new URL('./stable-terrain.js',import.meta.url),{type:'module'})
 worker.onmessage=({data})=>{
  if(data.ready){worker.postMessage({build:true});return}
  const {chunks}=data
  for(const r of chunks){const mesh=new T.Mesh(geometry(r),material);mesh.receiveShadow=true;apply?.(mesh);group.add(mesh);triangles+=r.indices.length/3;vertices+=r.p.length/3}
  pending=false;worker.terminate();readyResolve()
 }
 // Three.js performs separate frustum culling for the main, reflection and shadow
 // cameras. Geometry and materials never change with distance or quality.
 return {group,ready,update(){},status:()=>({pending,revision:pending?0:1,mode:'fixed-geography',chunks:group.children.length,triangles,vertices,joined:true,riverDetailMetres:8})}
}
