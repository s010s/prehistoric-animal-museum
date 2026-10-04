import {regionPathField} from './sample-region.js'
import {canopyLighting} from './canopy-light.js'
import * as T from 'three'
import {habitatGLSL} from './habitat.js'
import {shoreResources,shoreGLSL} from './shore.js'
import {surfaceToneGLSL,grassRange} from './surface-tone.js'
import {SIZE,landmarks,smooth,terrainHeight} from './field.js'
export * from './field.js'
export async function groundMaterial(){
 const shore=await shoreResources();
 const pathField=regionPathField(),pathDistance=new T.DataTexture(pathField.data,pathField.size,pathField.size,T.RedFormat,T.FloatType);pathDistance.name='region-trail-distance';pathDistance.minFilter=pathDistance.magFilter=T.LinearFilter;pathDistance.needsUpdate=true;
 const coverData=new Uint8Array(await(await fetch('./assets/terrain-cover.bin')).arrayBuffer());if(coverData.length!==512*512*4)throw Error('Invalid habitat coverage');
 const cover=new T.DataTexture(coverData,512,512,T.RGBAFormat);cover.minFilter=cover.magFilter=T.LinearFilter;cover.needsUpdate=true;
 const loader=new T.TextureLoader(),textures=await Promise.all(['cliff','ganges_river_pebbles','rocky_terrain_02','leafy_grass','sandy_gravel_02'].flatMap(n=>['albedo','normal','arm'].map(c=>loader.loadAsync(`./assets/${n}-${c}.webp`))))
 // WebGL2 texture arrays keep the full PBR ground stack within 16 texture units.
 function textureArray(indices,srgb){const size=1024,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true}),data=new Uint8Array(size*size*4*indices.length);
 indices.forEach((index,layer)=>{ctx.drawImage(textures[index].image,0,0,size,size);data.set(ctx.getImageData(0,0,size,size).data,layer*size*size*4)});
 const tx=new T.DataArrayTexture(data,size,size,indices.length);tx.wrapS=tx.wrapT=T.RepeatWrapping;tx.minFilter=T.LinearMipmapLinearFilter;tx.magFilter=T.LinearFilter;tx.generateMipmaps=true;tx.anisotropy=4;if(srgb)tx.colorSpace=T.SRGBColorSpace;tx.needsUpdate=true;return tx;}
 const albedo=textureArray([0,3,6,9,12],true),linear=textureArray([1,2,4,5,7,8,10,11,13,14],false);textures.forEach(t=>t.dispose());
 const debugGround=new URLSearchParams(location.search).has('ground');
 const m=new T.MeshStandardMaterial({roughness:1});m.onBeforeCompile=s=>{
 Object.assign(s.uniforms,shore,{regionTrailDistance:{value:pathDistance},canopyLighting,habitatCover:{value:cover},groundGrassRange:grassRange});
 s.uniforms.groundAlbedo={value:albedo};s.uniforms.groundLinear={value:linear};s.uniforms.groundDebug={value:debugGround?1:0}
 s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float landShade;attribute float coastalInfluence;varying float localCoast;attribute float waterHeight;varying float localWater;attribute float seepWet;varying float localSeep;varying float bakedShade;attribute vec3 surfaceBlend;varying vec3 landP,landN,landW;').replace('#include <begin_vertex>','#include <begin_vertex>\nlocalSeep=seepWet;localWater=waterHeight;localCoast=coastalInfluence;landP=(modelMatrix*vec4(position,1.)).xyz;landN=normalize(transpose(mat3(viewMatrix))*normalMatrix*normal);landW=surfaceBlend;bakedShade=landShade;')
 s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
 ${surfaceToneGLSL}
 ${habitatGLSL}
 uniform sampler2D habitatCover,canopyLighting;uniform vec2 groundGrassRange;
 ${shoreGLSL}
 uniform float groundDebug;varying float localCoast,localWater,localSeep;varying float bakedShade;varying vec3 landP,landN,landW;precision highp sampler2DArray;uniform sampler2DArray groundAlbedo,groundLinear;
 float hn(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float nn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hn(i),hn(i+vec2(1,0)),f.x),mix(hn(i+vec2(0,1)),hn(i+1.),f.x),f.y);}
 // Triangular stochastic sampling: stable offsets AND rotations, shared weights.
 vec3 tileSample(sampler2DArray tx,float layer,vec2 p,vec2 id,vec2 dx,vec2 dy){float angle=hn(id+3.17)*6.2831853;mat2 r=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));vec2 offset=vec2(hn(id+17.),hn(id-31.))*37.;return textureGrad(tx,vec3(fract(r*p+offset),layer),r*dx,r*dy).rgb;}
 vec3 tile(sampler2DArray tx,float layer,vec2 p){vec2 dx=dFdx(p),dy=dFdy(p);vec2 skew=mat2(1.,0.,-.57735027,1.15470054)*(p*1.7);vec2 id=floor(skew),f=fract(skew);vec2 a,b,c;vec3 w;if(f.x+f.y<1.){a=id;b=id+vec2(1,0);c=id+vec2(0,1);w=vec3(1.-f.x-f.y,f.x,f.y);}else{a=id+1.;b=id+vec2(0,1);c=id+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}w=w*w;w/=dot(w,vec3(1));return tileSample(tx,layer,p,a,dx,dy)*w.x+tileSample(tx,layer,p,b,dx,dy)*w.y+tileSample(tx,layer,p,c,dx,dy)*w.z;}
 vec3 tileNormalSample(sampler2DArray tx,float layer,vec2 p,vec2 id,vec2 dx,vec2 dy){float angle=hn(id+3.17)*6.2831853;mat2 r=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));vec2 offset=vec2(hn(id+17.),hn(id-31.))*37.;vec3 n=textureGrad(tx,vec3(fract(r*p+offset),layer),r*dx,r*dy).rgb*2.-1.;n.xy=transpose(r)*n.xy;return n;}
 vec3 tileNormal(sampler2DArray tx,float layer,vec2 p){vec2 dx=dFdx(p),dy=dFdy(p);vec2 skew=mat2(1.,0.,-.57735027,1.15470054)*(p*1.7);vec2 id=floor(skew),f=fract(skew);vec2 a,b,c;vec3 w;if(f.x+f.y<1.){a=id;b=id+vec2(1,0);c=id+vec2(0,1);w=vec3(1.-f.x-f.y,f.x,f.y);}else{a=id+1.;b=id+vec2(0,1);c=id+vec2(1,0);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}w=w*w;w/=dot(w,vec3(1));return tileNormalSample(tx,layer,p,a,dx,dy)*w.x+tileNormalSample(tx,layer,p,b,dx,dy)*w.y+tileNormalSample(tx,layer,p,c,dx,dy)*w.z;}
 vec3 rockDetail(vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(4.));w/=dot(w,vec3(1));vec3 a=tileNormal(groundLinear,0.,p.zy),b=tileNormal(groundLinear,0.,p.xz),c=tileNormal(groundLinear,0.,p.xy);return normalize(n+vec3(b.x*w.y+c.x*w.z,a.y*w.x+c.y*w.z,a.x*w.x+b.y*w.y)*.52);}
 vec3 tri(sampler2DArray tx,float layer,vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(4.));w/=dot(w,vec3(1));return tile(tx,layer,p.zy)*w.x+tile(tx,layer,p.xz)*w.y+tile(tx,layer,p.xy)*w.z;}`)
 s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`
 vec3 w=landW/max(.001,dot(landW,vec3(1)));vec2 p=landP.xz;
 float rockFold=nn(landP.xz/27.+landP.y/41.)*.65+nn(landP.xy/6.1+landP.z/19.)*.25+nn(landP.zy/1.3)*.10;
 float bedding=nn(vec2(landP.y*.11+nn(landP.xz/43.)*2.1,nn(landP.xz/91.)*3.));float structure=rockFold*.85+bedding*.15;
 float strataPhase=landP.y/6.7+nn(p/57.)*3.1+nn(p/17.)*.48;
 float strataEdge=1.-smoothstep(.025,.12,abs(fract(strataPhase)-.5));
 float strataBreak=smoothstep(.22,.61,nn(p/11.+landP.y*.09));
 float joint=1.-smoothstep(.022,.11,abs(nn(vec2(landP.x*.09+landP.y*.022,landP.z*.085))-.5));
 float macro=.86+.18*nn(p/113.)+.09*nn(p/29.);
 vec4 habitat=texture2D(habitatCover,(p/20480.+.5)*(511./512.)+.5/512.);
 float viewDistance=length(landP-cameraPosition);
 float bladePresence=1.-smoothstep(groundGrassRange.x,groundGrassRange.y,viewDistance);
 float pixelMetres=max(length(dFdx(p)),length(dFdy(p)));
 float clumpResolved=1.-smoothstep(.9,3.2,pixelMetres);
 float tussock=nn(p/2.7+vec2(nn(p/11.))*1.3)*.65+nn(p/.95)*.35;
 float grassHabitat=smoothstep(.12,.42,max(habitat.g,habitat.b))*smoothstep(localWater+.12,localWater+.6,landP.y);
 vec2 canopy=texture2D(canopyLighting,p/20480.+.5).rg;
 float forestFloor=habitat.r*(1.-smoothstep(0.82,.97,w.x));
 float path=trailMask(p)*(1.-w.x);path*=smoothstep(.16,.48,path+(nn(p*1.8)-.5)*.28);
 float litter=forestFloor*smoothstep(.26,.61,nn(p/8.5+nn(p/31.)*3.));
 float coastCover=(1.-smoothstep(4.,21.,landP.y+(nn(p/70.)-.5)*6.))*clamp(localCoast,0.,1.)*(1.-w.x);
 vec3 rock=vec3(.18),gravel=vec3(.18,.17,.14),grass=vec3(.12,.16,.06),sand=vec3(.25,.20,.14);
 if(w.x>.005){rock=tri(groundAlbedo,0.,landP/6.1,landN)*vec3(.53,.56,.50);rock*=.80+.26*nn(p*.023+landP.y*.021);
 float fracture=nn(landP.xy/vec2(21.,37.)+vec2(nn(landP.zy/61.))*2.);rock*=mix(.56,1.18,structure)*(1.-strataEdge*strataBreak*.27)*(1.-joint*.10);rock*=mix(vec3(.88,.90,.88),vec3(1.10,1.035,.94),nn(vec2(landP.y*.19,nn(p/150.)*3.)));rock=mix(rock,rock*vec3(.67,.79,.55),smoothstep(.55,.88,landN.y)*smoothstep(.4,.75,fracture)*.48);}
 if(w.y>.005||coastCover>.005){gravel=tile(groundAlbedo,1.,p/2.8)*vec3(.86,.89,.84);}
 // Fine sand fades into gravel through a broken sediment fringe, not round noise islands.
 if(coastCover>.005){float bankHeight=landP.y-localWater;
 float tidal=1.-smoothstep(.6,3.1,bankHeight+(nn(p/13.)-.5)*.45);
 vec3 sandScan=tile(groundAlbedo,4.,p/3.2);vec3 fineSand=mix(vec3(.29,.235,.17),sandScan,.30)*mix(vec3(.59,.63,.61),vec3(.88,.89,.83),1.-tidal);
 float fringe=exp(-pow((bankHeight-2.8+(nn(p/7.)-.5)*2.)/1.3,2.));
 float grit=fringe*smoothstep(.3,.72,nn(p/2.7))*.28;
 sand=mix(fineSand,gravel,grit);}
 if(w.z>.005){vec3 leaf=tile(groundAlbedo,3.,p/2.6);float grain=clamp(dot(leaf,vec3(.3,.5,.2))*4.36,.82,1.18);grass=meadowPigment(p)*grain;
 // Unresolved leaves retain the mean straw tint and upward-facing canopy response.
 grass*=mix(vec3(1.),vec3(1.19,1.13,.98),1.-bladePresence);
 vec3 soil=tile(groundAlbedo,2.,p/2.3)*vec3(.37,.39,.34);vec3 needles=tile(groundAlbedo,3.,p/1.8)*vec3(.62,.47,.31);
 // Tidewater's blade-to-sward handover, scaled to our actual blade cutoff.
 float clumpContrast=mix(.24,.85,1.-bladePresence)*clumpResolved;
 grass*=1.+(tussock-.5)*clumpContrast;
 float gaps=(1.-smoothstep(.26,.53,tussock))*clumpResolved;
 float overhead=smoothstep(.25,.85,abs(dot(normalize(landN),normalize(cameraPosition-landP))));
 grass=mix(grass,soil,gaps*overhead*.25*grassHabitat);
 grass=mix(grass,grass*.68+soil*.12,bladePresence*grassHabitat*.48);
 vec3 understory=mix(soil,needles,.45+.35*nn(p/3.7));grass=mix(grass,understory,clamp(litter*.86+forestFloor*.18,0.,.92));
 vec3 crownFloor=mix(vec3(.028,.043,.012),vec3(.072,.092,.027),nn(p/13.)*.55+nn(p/47.)*.45);
 grass=mix(grass,crownFloor,canopy.g*smoothstep(90.,250.,viewDistance)*.80*(1.-path));
 vec3 trailScan=tile(groundAlbedo,4.,p/1.35);
 float worn=smoothstep(.27,.73,nn(p/vec2(1.3,4.7)+vec2(nn(p/8.))*2.));
 vec3 trailSoil=mix(trailScan*vec3(.56,.50,.38),trailScan*vec3(.90,.81,.63),worn);
 float loose=smoothstep(.55,.79,nn(p*2.9))*(1.-smoothstep(.82,1.,path));
 trailSoil=mix(trailSoil,tile(groundAlbedo,1.,p/1.2)*vec3(.64,.59,.47),loose*.5);
 grass=mix(grass,trailSoil,path*.93);
 float pathGrain=nn(p*4.)*.7+nn(p*11.)*.3;grass*=mix(1.,.88+pathGrain*.24,path); }

 float marsh=1.-smoothstep(.78,1.13,length((p-vec2(3600.,5400.))/vec2(2250.,1500.)));
 float wet=1.-smoothstep(localWater+.15,localWater+1.2,landP.y);
 vec3 mud=mix(vec3(.095,.077,.048),vec3(.16,.135,.08),nn(p/3.7))*(.87+.18*nn(p/11.));
 vec3 ground=(rock*w.x+gravel*w.y+grass*w.z)*macro;
 float springZone=(1.-smoothstep(12.,38.,length((p-vec2(-1760.1431125663364,-4031.))*vec2(1.,.7))))*(1.-smoothstep(212.,230.,landP.y));
 float seepVein=pow(.5+.5*sin(p.x*1.7+nn(p/3.)*5.),12.);
 ground=mix(ground,ground*vec3(.38,.49,.35),springZone*(.40+.35*seepVein));
 ground=mix(ground,sand*macro,coastCover);
 ground=mix(ground,mix(grass*mix(vec3(.71,.77,.52),vec3(.92,.87,.63),nn(p/23.)),mud,wet)*macro,marsh*(1.-w.x));
 float dampSeep=clamp(localSeep,0.,1.)*(.82+.18*nn(p/1.8));
 ground*=mix(vec3(1.),vec3(.71,.78,.73),dampSeep);
 float recentWater=shoreWet(p);ground*=mix(1.,.55,recentWater);
 ground*=mix(.63,1.,smoothstep(localWater+.05,localWater+1.5,landP.y));diffuseColor.rgb*=ground*bakedShade;`)
 s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(1.,.025,w.z*(1.-wet));reflectedLight.indirectSpecular*=mix(1.,.025,w.z*(1.-wet));reflectedLight.indirectDiffuse*=mix(1.,.69,canopy.g);reflectedLight.directDiffuse*=mix(1.,mix(.28,1.,canopy.r),smoothstep(65.,100.,viewDistance));');
 s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`vec3 arm=vec3(1.,.91,0.);
 if(w.y>.01)arm=mix(arm,tile(groundLinear,3.,p/2.8),w.y);
 if(w.z>.01)arm=mix(arm,mix(tile(groundLinear,7.,p/2.6),tile(groundLinear,5.,p/2.3),litter),w.z);
 if(coastCover>.01||path>.01)arm=mix(arm,tile(groundLinear,9.,p/3.2),max(coastCover,path));
 float roughnessFactor=mix(mix(clamp(arm.g,.66,.98),.62,wet),.27,recentWater);roughnessFactor=mix(roughnessFactor,.32,dampSeep);diffuseColor.rgb*=mix(.78,1.,arm.r);`);
 s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`float detailWeight=1.-smoothstep(100.,520.,length(vViewPosition));
 float swardWeight=grassHabitat*(1.-forestFloor)*(1.-path)*w.z*clumpResolved;
 float swardHeight=(tussock-.5)*.38*swardWeight;
 float detailHeight=(structure*2.1-strataEdge*strataBreak*.17-joint*.06)*w.x+nn(landP.xz*2.)*.045*w.y+nn(landP.xz*3.)*.023*w.z+(nn(p*9.)*.018+nn(p*1.7)*.035)*path;
 vec3 swardN=surfaceGradient(landP,normalize(landN),swardHeight);
 vec3 detailedN=surfaceGradient(landP,swardN,detailHeight);
 if(w.x>.05&&detailWeight>.01)detailedN=normalize(mix(detailedN,rockDetail(landP/6.1,normalize(landN)),w.x*.7));
 if(detailWeight>.01){vec3 soilN=vec3(0.,0.,1.);
 if(w.y>.01)soilN+=tileNormal(groundLinear,2.,p/2.8)*w.y*.52;
 if(w.z>.01)soilN+=mix(tileNormal(groundLinear,6.,p/2.6),tileNormal(groundLinear,4.,p/2.3),litter)*w.z*.65;
 if(coastCover>.01||path>.01)soilN=mix(soilN,tileNormal(groundLinear,8.,p/3.2),max(coastCover,path)*.75);
 detailedN=normalize(detailedN+vec3(soilN.x,0.,soilN.y)*.62*(1.-w.x));}
 normal=normalize(mat3(viewMatrix)*mix(swardN,detailedN,detailWeight));`)


 s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','if(groundDebug>.5)outgoingLight=diffuseColor.rgb;\n#include <opaque_fragment>');
 };return m
}

function geometry(r){const g=new T.BufferGeometry();g.setIndex(new T.BufferAttribute(r.indices,1));g.setAttribute('position',new T.BufferAttribute(r.p,3));g.setAttribute('normal',new T.BufferAttribute(r.n,3));g.setAttribute('surfaceBlend',new T.BufferAttribute(r.w,3));g.setAttribute('landShade',new T.BufferAttribute(r.shade,1));g.setAttribute('waterHeight',new T.BufferAttribute(r.water,1));g.setAttribute('coastalInfluence',new T.BufferAttribute(r.coast,1));g.setAttribute('seepWet',new T.BufferAttribute(r.seepWet??new Float32Array(r.p.length/3),1));g.computeBoundingSphere();return g}
export function makeLandscape(material,apply,getFine=()=>false,diagnostics){
 const group=new T.Group(),collision=new Map(),mirrorMeshes=[];let readyResolve,pending=true,triangles=0,vertices=0,mirrorTriangles=0,mirrorActive=false;
 let reflectionProxy=new URLSearchParams(location.search).get('reflectionTerrain')!=='full';
 diagnostics?.labelGroup(group,'terrain');
 const ready=new Promise(resolve=>readyResolve=resolve)
 const worker=new Worker(new URL('./stable-terrain.js',import.meta.url),{type:'module'})
 worker.onmessage=({data})=>{
  if(data.ready){worker.postMessage({build:true});return}
  const consumeStart=performance.now();const {chunks,reflectionChunks}=data
  for(const r of chunks){
   // Index the exact rendered triangles, including stitched boundaries.
   const bins=new Map();for(let t=0;t<r.indices.length;t+=3){const a=r.indices[t]*3,b=r.indices[t+1]*3,c=r.indices[t+2]*3;
    const x0=Math.floor(Math.min(r.p[a],r.p[b],r.p[c])/64),x1=Math.floor((Math.max(r.p[a],r.p[b],r.p[c])-1e-5)/64),z0=Math.floor(Math.min(r.p[a+2],r.p[b+2],r.p[c+2])/64),z1=Math.floor((Math.max(r.p[a+2],r.p[b+2],r.p[c+2])-1e-5)/64);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(t);}}
   for(const[key,list]of bins)collision.set(key,{p:r.p,ix:r.indices,list:new Uint32Array(list)});
   const mesh=new T.Mesh(geometry(r),material),proxy=reflectionChunks[chunks.indexOf(r)];
   mirrorMeshes.push({mesh,main:mesh.geometry,mirror:proxy?geometry(proxy):mesh.geometry});mirrorTriangles+=(proxy??r).indices.length/3;
   mesh.receiveShadow=true;apply?.(mesh);group.add(mesh);triangles+=r.indices.length/3;vertices+=r.p.length/3}
  // Refine only dense collision buckets; keep their exact original triangle ownership.
  for(const cell of collision.values())if(cell.list.length>1024){
   const bins=new Map(),{p,ix}=cell;
   for(const t of cell.list){
    const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3;
    const minX=Math.min(p[a],p[b],p[c]),maxX=Math.max(p[a],p[b],p[c]),minZ=Math.min(p[a+2],p[b+2],p[c+2]),maxZ=Math.max(p[a+2],p[b+2],p[c+2]);
    // Cover the existing barycentric epsilon just outside triangle bounds.
    const padX=(maxX-minX)*4e-6+1e-5,padZ=(maxZ-minZ)*4e-6+1e-5;
    for(let z=Math.floor((minZ-padZ)/8);z<=Math.floor((maxZ+padZ)/8);z++)for(let x=Math.floor((minX-padX)/8);x<=Math.floor((maxX+padX)/8);x++){
     const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(t);
    }
   }
   cell.secondary=new Map(Array.from(bins,([key,list])=>[key,new Uint32Array(list)]));
  }
  pending=false;worker.terminate();readyResolve();diagnostics?.event('workerConsume',{worker:'terrain',cpuMs:performance.now()-consumeStart})
 }
 // Three.js performs separate frustum culling for the main, reflection and shadow
 // cameras. Main geometry and collision never change with distance or quality.
 const heightAt=(x,z)=>{const cell=collision.get(Math.floor(x/64)+','+Math.floor(z/64));if(!cell)return terrainHeight(x,z);const {p,ix}=cell,list=cell.secondary?.get(Math.floor(x/8)+','+Math.floor(z/8))??cell.list;let h=-Infinity;for(const t of list){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3,ax=p[a],az=p[a+2],bx=p[b],bz=p[b+2],cx=p[c],cz=p[c+2],den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)h=Math.max(h,u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1]);}return Number.isFinite(h)?h:terrainHeight(x,z)};
 return {group,ready,heightAt,update(){},setReflectionTerrain(value){reflectionProxy=Boolean(value);},reflectionMode(active){mirrorActive=active;for(const r of mirrorMeshes)r.mesh.geometry=active&&reflectionProxy?r.mirror:r.main;},dispose(){worker.terminate();for(const r of mirrorMeshes){r.main.dispose();if(r.mirror!==r.main)r.mirror.dispose();}collision.clear();},status:()=>({pending,revision:pending?0:1,mode:'fixed-geography',chunks:group.children.length,triangles,vertices,joined:true,riverDetailMetres:8,reflection:{mode:reflectionProxy?'fixed-proxy':'full',triangles:reflectionProxy?mirrorTriangles:triangles,proxyGeometries:mirrorMeshes.filter(r=>r.main!==r.mirror).length,shoreContactPreserved:true,mainRestored:!mirrorActive&&mirrorMeshes.every(r=>r.mesh.geometry===r.main)}})}
}
