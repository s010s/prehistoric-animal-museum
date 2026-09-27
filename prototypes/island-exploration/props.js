import * as T from 'three'
import {createFeatherFernParts} from './feather-ferns.js'
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js'
import{MeshoptDecoder}from'three/addons/libs/meshopt_decoder.module.js'
import{hash,noise,terrainHeight,slopeAt,woodland,riverX,halfWidth,riverLevel,bankAt,SIZE,smooth,biomeAt,waterLevelAt}from'./world.js'
const rand=(i,n)=>hash(i*1.71+n*14.19,n*7.38-i*.31)
function templateParts(object){object.updateWorldMatrix(true,true);const box=new T.Box3().setFromObject(object),center=box.getCenter(new T.Vector3()),shift=new T.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z),parts=[];object.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();for(const name of ['position','normal','tangent']){const a=o.geometry.getAttribute(name);if(a){const d=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)d[i*a.itemSize+c]=a.getComponent(i,c);g.setAttribute(name,new T.BufferAttribute(d,a.itemSize))}}g.applyMatrix4(new T.Matrix4().multiplyMatrices(shift,o.matrixWorld));parts.push({geometry:g,material:o.material.clone()})});return{parts,height:box.max.y-box.min.y,width:Math.max(box.max.x-box.min.x,box.max.z-box.min.z)}}
function instances(group,part,items,shadow=true){if(!items.length)return;const pool=group.userData.instancePool,key=part.geometry.uuid+part.material.uuid;let mesh=pool?.get(key);if(mesh&&mesh.instanceMatrix.count<items.length){group.remove(mesh);mesh.dispose();mesh.material.dispose();pool.delete(key);mesh=null;}if(!mesh){const m=part.material.clone();m.onBeforeCompile=part.material.onBeforeCompile;m.customProgramCacheKey=part.material.customProgramCacheKey;m.envMapIntensity=.65;m.roughness=Math.max(.8,m.roughness??.8);if(m.map)m.map.anisotropy=8;if(m.alphaTest>0||m.transparent){m.transparent=false;m.alphaTest=.32;m.depthWrite=true;m.side=T.DoubleSide}mesh=new T.InstancedMesh(part.geometry,m,pool?2**Math.ceil(Math.log2(Math.max(32,items.length))):items.length);group.add(mesh);pool?.set(key,mesh);}mesh.count=items.length;mesh.visible=true;const o=new T.Object3D(),c=new T.Color();items.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(p.tilt??0,p.yaw,p.roll??0);o.scale.set(p.scale*(p.sx??1),p.scale*(p.sy??1),p.scale*(p.sz??1));o.updateMatrix();mesh.setMatrixAt(i,o.matrix);const shade=p.tint??1;c.setRGB(shade*.97,shade,shade*.93);mesh.setColorAt(i,c)});mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();return mesh}
async function atlasTree(){
 const tx=await new T.TextureLoader().loadAsync('./assets/fir-a-atlas.webp');tx.colorSpace=T.SRGBColorSpace;tx.anisotropy=8
 // Atlas side cutout occupies 50% of each cell width and 97% of cell height.
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-.345,-.016,0,.345,-.016,0,-.345,1.016,0,.345,1.016,0,-.1825,.65,-.275,.1825,.65,-.275,-.1825,.65,.275,.1825,.65,.275],3));g.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1],2));g.setAttribute('crownPlane',new T.Float32BufferAttribute([0,0,0,0,1,1,1,1],1));g.setIndex([0,1,2,2,1,3,4,6,5,6,7,5]);g.computeVertexNormals();
 return{geometry:g,material:new T.MeshBasicMaterial({map:tx,alphaTest:.28,side:T.DoubleSide,color:'#a9b89d'})}
}
export const riverRocks=Array.from({length:440},(_,i)=>{const z=-3900+i*18.5+rand(i,36)*9;return{x:riverX(z)+(i%5===0?(rand(i,37)-.5)*.9:(i%2?1:-1)*(.68+rand(i,37)*.32))*halfWidth(z),z,radius:1.1+rand(i,38)**1.5*2.7,strength:.5+rand(i,39)*.5}}).filter(r=>r.z<2600&&terrainHeight(r.x,r.z)>riverLevel(r.z)-4.5)
for(let i=0;i<125;i++){const z=-1350+i*11+rand(i,92)*4;riverRocks.push({x:riverX(z)+(i%2?1:-1)*halfWidth(z)*(.78+rand(i,93)*.3),z,radius:.65+rand(i,94)*1.65,strength:.6+rand(i,95)*.4})}
// Broken, staggered riffle groups: never a full-width row across the channel.
for(const [j,center]of [-1370,-875,-470,180,970,-2250].entries())for(let k=0;k<7;k++){
 const z=center+(rand(j*13+k,122)-.5)*48,x=riverX(z)+(k%2?1:-1)*halfWidth(z)*(.12+rand(j*13+k,123)*.56);
 riverRocks.push({x,z,radius:1.35+rand(j*13+k,124)*2.0,strength:.75+rand(j*13+k,125)*.25})
}
riverRocks.push({x:riverX(-4014),z:-4014,radius:6.2,strength:.8})
// Weathered scanned boulders frame the spring fissure; leave its centre open.
for(let i=0;i<9;i++){const z=-4010+rand(i,201)*27;riverRocks.push({x:riverX(z)+(i%2?1:-1)*(5+rand(i,202)*12),z,radius:3+rand(i,203)*3.5,strength:.8})}
export async function makeProps(renderer,apply,getFine=()=>false){
 const stage=name=>{document.body.dataset.loadingStage=name};stage("scanned-props");
 const group=new T.Group(),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),scan=await loader.loadAsync('./assets/scanned-props.glb'),rock=templateParts(scan.scene.getObjectByName('rock_07')),fern=createFeatherFernParts({seed:17,pairs:16})
 stage('stone-texture');const stoneMap=await new T.TextureLoader().loadAsync('./assets/cliff-albedo.webp');stoneMap.colorSpace=T.SRGBColorSpace;stoneMap.anisotropy=8;for(const part of rock.parts){part.material.map=stoneMap;part.material.vertexColors=false;part.material.color.set('#a3ac9c');part.material.roughness=.95;part.material.metalness=0;part.material.normalScale?.set(.65,.65)}
 // The same permanent obstacles drive both visible rocks and the water field.
 const riverStoneChunks=new Map();
 for(const r of riverRocks){const sy=.8+hash(r.x,r.z)*.5,scale=r.radius*2/rock.width,y=terrainHeight(r.x,r.z)-r.radius*.22,exposed=y+rock.height*scale*sy-riverLevel(r.z);r.strength*=smooth(-.35,.4,exposed);const key=Math.floor(r.z/256);if(!riverStoneChunks.has(key))riverStoneChunks.set(key,[]);riverStoneChunks.get(key).push({x:r.x,z:r.z,y,scale,sy,yaw:r.z,tint:.68+hash(r.z,r.x)*.2})}
 for(const rows of riverStoneChunks.values())for(const part of rock.parts)instances(group,part,rows,true);
 stage('tree-model');const treeGLB=await loader.loadAsync('./assets/fir-a-spatial-near-layered.glb'),tree=templateParts(treeGLB.scene),far=await atlasTree();tree.parts=tree.parts.filter(p=>!p.material.name.includes('full canopy silhouette'));for(const part of tree.parts){const a=part.geometry.attributes.position;for(let i=0;i<a.count;i++){const y=a.getY(i);a.setY(i,(y<8?y*.55:y-3.6)/.81)}part.geometry.computeVertexNormals();part.geometry.computeBoundingSphere()}
 stage('meadow-model');const meadowAsset=await loader.loadAsync('./assets/meadow-grass.glb'),meadowVariants=['tiny_b','tiny_c','tiny_d'].map(n=>templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_'+n+'_LOD0'))),fullGrass=templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_small_a_LOD0')),wetGrass=templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_tall_a_LOD0'));
 for(const part of [...meadowVariants.flatMap(v=>v.parts),...wetGrass.parts,...fullGrass.parts]){part.material.color.setRGB(2.2,2.6,1.65);part.material.envMapIntensity=.35;part.material.emissive.setRGB(.055,.075,.018);part.material.emissiveIntensity=.35}
 stage('forest-placement');let treeCount=0;const all=[],buckets=new Map(),spacing=18
 for(let iz=-465;iz<425;iz++)for(let ix=-215;ix<520;ix++){
 const i=(iz+465)*735+ix+215,x=(ix+.1+hash(ix,iz)*.8)*spacing,z=(iz+.1+hash(iz,ix+11)*.8)*spacing,density=woodland(x,z)
 if(rand(i,3)>density*.94)continue;const y=terrainHeight(x,z);if(y<3)continue
 const h=18+rand(i,4)**.7*20,p={x,z,y:y-.25,scale:h,yaw:rand(i,5)*6.28,tint:.69+rand(i,6)*.30,sx:.78+rand(i,7)*.4,sz:.85+rand(i,8)*.3,id:treeCount};all.push(p);const key=`${Math.floor(x/128)},${Math.floor(z/128)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);treeCount++
 }
 // Denser gallery forest along the main low river, with gaps at gravel bars.
 for(let iz=-170;iz<40;iz++)for(let ix=-16;ix<=16;ix++){
 const z=iz*10+hash(ix,iz)*7,x=riverX(z)+ix*9+(hash(iz,ix)-.5)*6,b=bankAt(x,z),y=terrainHeight(x,z);if(b<6||b>135||slopeAt(x,z)<.72||hash(ix+11,iz)<.22)continue
 const key=`${Math.floor(x/128)},${Math.floor(z/128)}`;const existing=buckets.get(key)??[];if(existing.some(p=>Math.hypot(p.x-x,p.z-z)<5))continue
 const p={x,z,y:y-.15,scale:23+hash(ix,iz+4)*20,yaw:hash(iz+17,ix)*6.28,tint:.64+hash(ix+8,iz)*.24,sx:.9+hash(ix,iz+9)*.2,sz:1,id:treeCount};all.push(p);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);treeCount++
 }
 // Younger trees break up the bare-trunk rows and close the understory gaps.
 for(let i=0;i<1500;i++){const z=-1500+rand(i,83)*1900,side=i%2?1:-1,x=riverX(z)+side*(halfWidth(z)+7+rand(i,84)*95),y=terrainHeight(x,z);if(slopeAt(x,z)<.7||noise(x/17,z/21)<.38)continue;const key=`${Math.floor(x/128)},${Math.floor(z/128)}`,p={x,z,y:y-.12,scale:5+rand(i,85)*10,yaw:rand(i,86)*6.28,tint:.65+rand(i,87)*.23,sx:.9,sz:1,id:treeCount++};all.push(p);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p)}
 for(const p of all)p.species=hash(Math.floor(p.x/31),Math.floor(p.z/37))>.57?1:0;
 stage('pine-atlas');const pineMap=await new T.TextureLoader().loadAsync('./assets/pine-b-atlas.webp');pineMap.colorSpace=T.SRGBColorSpace;pineMap.anisotropy=8;
 // Camera-facing crowns keep full silhouettes in the distant forest. Close trees get geometry.
 const forest=new T.Group();group.add(forest);const chunks=new Map();
 for(const p of all){const key=`${Math.floor(p.x/512)},${Math.floor(p.z/512)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(p)}
 const forestRange={value:getFine()?8500:5700};
 for(const items of chunks.values()){
 const mesh=instances(forest,far,items,false);mesh.geometry=far.geometry.clone();
 mesh.geometry.setAttribute('treeSpecies',new T.InstancedBufferAttribute(new Float32Array(items.map(p=>p.species)),1));mesh.geometry.setAttribute('treeYaw',new T.InstancedBufferAttribute(new Float32Array(items.map(p=>p.yaw)),1));
 mesh.userData.center=new T.Vector3(items.reduce((v,p)=>v+p.x,0)/items.length,items.reduce((v,p)=>v+p.y,0)/items.length,items.reduce((v,p)=>v+p.z,0)/items.length);
 mesh.geometry.computeBoundingSphere();mesh.computeBoundingSphere();mesh.boundingSphere.radius+=70;
 mesh.material.onBeforeCompile=shader=>{
 shader.uniforms.pineMap={value:pineMap};shader.uniforms.firMap={value:far.material.map};shader.uniforms.forestRange=forestRange;
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float treeYaw;attribute float treeSpecies;attribute float crownPlane;varying float species,atlasView,nextView,viewMix,coverage,treeDistance;')
 .replace('#include <project_vertex>',`species=treeSpecies;vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;vec3 toEye=cameraPosition-root;treeDistance=length(toEye);float elevation=abs(toEye.y)/max(1.,treeDistance);float viewAngle=mod((atan(toEye.x,toEye.z)-treeYaw)/.785398+16.,8.);atlasView=crownPlane>.5?8.:floor(viewAngle);nextView=crownPlane>.5?8.:mod(atlasView+1.,8.);viewMix=fract(viewAngle);vec3 scale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));vec3 right=normalize(vec3(toEye.z,0.,-toEye.x));vec3 world=root;if(crownPlane>.5){world+=vec3(position.x*scale.x,position.y*scale.y,position.z*scale.x);coverage=smoothstep(.78,.97,elevation);}else{world+=right*position.x*scale.x+vec3(0.,position.y*scale.y,0.);coverage=1.-smoothstep(.93,.998,elevation);}airWorld=world;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
 uniform sampler2D pineMap,firMap;uniform float forestRange;varying float species,atlasView,nextView,viewMix,coverage,treeDistance;
 vec4 treeTex(vec2 p,float v){vec2 uv=vec2((p.x+mod(v,4.))/4.,(p.y+2.-floor(v/4.))/3.);return species>.5?texture2D(pineMap,uv):texture2D(firMap,uv);}`)
 .replace('#include <map_fragment>',`vec2 treeUV=vMapUv;if(atlasView<7.5&&species<.5)treeUV.y=treeUV.y<.287?treeUV.y*.81/.55:treeUV.y*.81+.19;vec4 texel=mix(treeTex(treeUV,atlasView),treeTex(treeUV,nextView),viewMix);float visibility=coverage*(1.-smoothstep(forestRange-1400.,forestRange,treeDistance));float stipple=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(stipple>visibility)discard;diffuseColor*=texel;`);
 };mesh.material.customProgramCacheKey=()=> 'continuous-tree-r4';
 }
 const nearTrees=new T.Group(),details=new T.Group();group.add(nearTrees,details);nearTrees.userData.instancePool=new Map();details.userData.instancePool=new Map();let lastX=1e8,lastZ=1e8,lastFine=null,detailX=1e8,detailZ=1e8,detailFine=null,detailPending=false,counts={riverBoulders:riverRocks.length,trees:treeCount,nearTrees:0,rocks:0,ferns:0,grass:0}
 const dummy=new T.Object3D()
 // Ground blades share one mesh and are restricted to the nearby banks, not the whole island.
 const grassG=new T.BufferGeometry(),gp=[],gc=[],gi=[]
 for(let k=0;k<7;k++){const angle=k*2.39996,bx=Math.cos(angle)*.13,bz=Math.sin(angle)*.13,h=.22+rand(k,20)*.37,w=.012+rand(k,19)*.007,base=gp.length/3;
 for(let j=0;j<=3;j++){const t=j/3,bend=t*t*h*.5,half=w*(1-t)+.0008,cx=bx+Math.cos(angle)*bend,cz=bz+Math.sin(angle)*bend,y=h*t;for(const side of [-1,1]){gp.push(cx+Math.sin(angle)*half*side,y,cz-Math.cos(angle)*half*side);gc.push(.16+t*.12,.25+t*.15,.07+t*.055)}if(j<3){const i=base+j*2;gi.push(i,i+2,i+1,i+1,i+2,i+3)}}}
 grassG.setAttribute('position',new T.Float32BufferAttribute(gp,3));grassG.setAttribute('color',new T.Float32BufferAttribute(gc,3));grassG.setIndex(gi);grassG.computeVertexNormals()
 const grassPart={geometry:grassG,material:new T.MeshStandardMaterial({vertexColors:true,emissive:'#263c11',emissiveIntensity:.25,roughness:.95,side:T.DoubleSide})}
 const pebbleG=new T.IcosahedronGeometry(1,0),pebblePart={geometry:pebbleG,material:rock.parts[0].material}
 function clear(g){for(const m of g.children){m.count=0;m.visible=false}}
 const reedG=new T.BufferGeometry(),rp=[],ri=[];
 function reedQuad(a,b,c,d){const n=rp.length/3;rp.push(...a,...b,...c,...d);ri.push(n,n+1,n+2,n+2,n+1,n+3)}
 for(let k=0;k<3;k++){const angle=k*2.4,bx=Math.cos(angle)*.15,bz=Math.sin(angle)*.15,h=1.05+rand(k,99)*.55;
 for(let j=0;j<3;j++){const a=j*2.094,b=(j+1)*2.094;reedQuad([bx+Math.cos(a)*.003,0,bz+Math.sin(a)*.003],[bx+Math.cos(b)*.003,0,bz+Math.sin(b)*.003],[bx+Math.cos(a)*.001,h,bz+Math.sin(a)*.003],[bx+Math.cos(b)*.001,h,bz+Math.sin(b)*.003])}
 for(let j=0;j<4;j++){const a=angle+j*2.4,y=h*(.2+j*.15),len=.30+j*.035,w=.012,dx=Math.cos(a),dz=Math.sin(a),base=rp.length/3;
 for(let segment=0;segment<=6;segment++){const t=segment/6,reach=len*t,up=.18*Math.sin(t*2.5),width=w*Math.sin(t*Math.PI)*(.85+.15*t);rp.push(bx+dx*reach-dz*width,y+up,bz+dz*reach+dx*width,bx+dx*reach+dz*width,y+up,bz+dz*reach-dx*width);if(segment<6){const n=base+segment*2;ri.push(n,n+2,n+1,n+1,n+2,n+3)}}}

 }
 reedG.setAttribute('position',new T.Float32BufferAttribute(rp,3));reedG.setIndex(ri);reedG.computeVertexNormals();
 const reedPart={geometry:reedG,material:new T.MeshStandardMaterial({color:'#778441',emissive:'#2b3414',emissiveIntensity:.12,roughness:.86,side:T.DoubleSide})};
 const plantTime={value:0};
 for(const part of [grassPart,reedPart,...fern.parts,...meadowVariants.flatMap(v=>v.parts),...wetGrass.parts,...fullGrass.parts]){part.material.onBeforeCompile=shader=>{shader.uniforms.plantTime=plantTime;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float plantTime;').replace('#include <begin_vertex>',`#include <begin_vertex>
 vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;float breeze=sin(plantTime*1.15+root.x*.031+root.z*.024)+sin(plantTime*.71+root.x*.071)*.3;transformed.x+=breeze*position.y*position.y*.055;transformed.z+=breeze*position.y*.02;`);shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
 float densityFade=1.-smoothstep(95.,155.,length(airWorld-cameraPosition));float pattern=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(pattern>densityFade)discard;`)};part.material.customProgramCacheKey=()=> 'ground-wind-r4'}
 // A permanent coarse reed layer keeps the floodplain inhabited from flight height.
 // Fine nearby plants add detail without shrinking or replacing these stems.
 const marshP=[],marshI=[];
 for(let b=0;b<12;b++){const angle=b*2.39996,px=Math.cos(angle)*(.3+b*.24),pz=Math.sin(angle)*(.3+b*.24),height=1.1+rand(b,239)*.7;const start=marshP.length/3;
 for(let j=0;j<=3;j++){const t=j/3,width=.032*(1-t)+.003,lean=t*t*.48;for(const side of[-1,1])marshP.push(px+Math.cos(angle)*lean+Math.sin(angle)*width*side,height*t,pz+Math.sin(angle)*lean-Math.cos(angle)*width*side);if(j<3){const n=start+j*2;marshI.push(n,n+2,n+1,n+1,n+2,n+3)}}}
 const marshG=new T.BufferGeometry();marshG.setAttribute('position',new T.Float32BufferAttribute(marshP,3));marshG.setIndex(marshI);marshG.computeVertexNormals();
 const marshPart={geometry:marshG,material:new T.MeshStandardMaterial({color:'#82905d',emissive:'#1b230d',emissiveIntensity:.25,roughness:.95,side:T.DoubleSide})},reedChunks=new Map();
 for(let z=3900;z<6900;z+=22)for(let x=1300;x<5900;x+=22){const px=x+(hash(x,z)-.5)*18,pz=z+(hash(z,x)-.5)*18;if(biomeAt(px,pz).marsh<.9||noise(px/90,pz/110)<.39)continue;const y=terrainHeight(px,pz),wl=waterLevelAt(px,pz);if(y<wl-.35||y>wl+1.35)continue;const key=`${Math.floor(px/512)},${Math.floor(pz/512)}`;if(!reedChunks.has(key))reedChunks.set(key,[]);reedChunks.get(key).push({x:px,z:pz,y:y-.08,scale:.7+hash(px,pz)*.6,yaw:hash(pz,px)*6.28,tint:.7+hash(px+1,pz)*.45})}
 for(const items of reedChunks.values())instances(group,marshPart,items,false);
 stage('detail-worker');const detailWorker=new Worker(new URL('./detail-worker.js',import.meta.url),{type:'module'});
 let currentCamera;
 detailWorker.onerror=e=>{console.error('Island detail worker:',e.message);counts.detailError=e.message;detailPending=false};
 detailWorker.onmessage=e=>{
 if(e.data.ready){detailPending=false;detailX=detailZ=1e8;return}
 const {cx,cz,rocks,pebbles,ferns,grass,reeds}=e.data;const camera=currentCamera,fine=getFine();
 const distance=p=>Math.hypot(p.x-camera.position.x,p.y-camera.position.y,p.z-camera.position.z);rocks.sort((a,b)=>distance(a)-distance(b));ferns.sort((a,b)=>distance(a)-distance(b));grass.sort((a,b)=>distance(a)-distance(b));reeds.sort((a,b)=>distance(a)-distance(b));reeds.length=Math.min(reeds.length,fine?3000:1400);
 rocks.length=Math.min(rocks.length,fine?1500:380);ferns.length=Math.min(ferns.length,fine?440:85);grass.length=Math.min(grass.length,fine?8000:2200);
 clear(details);for(const p of rock.parts)instances(details,p,rocks);instances(details,pebblePart,pebbles,false);for(const p of fern.parts)instances(details,p,ferns,false);for(let i=0;i<meadowVariants.length;i++){const variant=meadowVariants[i],items=grass.filter(p=>Math.floor(hash(p.x,p.z)*3)===i).map(p=>({...p,scale:p.scale*.4/variant.height}));for(const part of variant.parts)instances(details,part,items,false)}const lush=grass.filter(p=>hash(p.x+41,p.z-29)<.10).map(p=>({...p,scale:p.scale*.4/fullGrass.height}));for(const part of fullGrass.parts)instances(details,part,lush,false);for(const part of wetGrass.parts)instances(details,part,reeds.map(p=>({...p,scale:p.scale*1.25/wetGrass.height})),false);
 counts.rocks=rocks.length+pebbles.length;counts.ferns=ferns.length;counts.grass=grass.length;counts.reeds=reeds.length;apply?.(details);detailPending=false;
 };
 for(const part of tree.parts){part.material.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
 float nearCoverage=1.-smoothstep(65.,145.,length(airWorld-cameraPosition));float pattern=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(pattern>nearCoverage)discard;`)};part.material.customProgramCacheKey=()=> 'near-canopy-overlay-r4'}
 function refresh(camera){
 plantTime.value=performance.now()*.001;currentCamera=camera;const fine=getFine(),cx=Math.floor(camera.position.x/32)*32,cz=Math.floor(camera.position.z/32)*32;
 forestRange.value=fine?8500:5700;for(const mesh of forest.children)mesh.visible=mesh.userData.center.distanceTo(camera.position)<forestRange.value+500;
 if(cx!==lastX||cz!==lastZ||fine!==lastFine){lastX=cx;lastZ=cz;lastFine=fine;clear(nearTrees);const candidates=[];
 for(let iz=Math.floor((cz-220)/128);iz<=Math.floor((cz+220)/128);iz++)for(let ix=Math.floor((cx-220)/128);ix<=Math.floor((cx+220)/128);ix++)for(const p of buckets.get(`${ix},${iz}`)??[])if(p.species<.5&&hash(p.x+73,p.z-91)<(fine?.12:.045)&&Math.hypot(p.x-camera.position.x,p.y+p.scale*.5-camera.position.y,p.z-camera.position.z)<185)candidates.push(p);
 candidates.sort((a,b)=>Math.hypot(a.x-camera.position.x,a.z-camera.position.z)-Math.hypot(b.x-camera.position.x,b.z-camera.position.z));
 const near=candidates.map(p=>({...p,scale:p.scale/18.925}));for(const p of tree.parts){const m=instances(nearTrees,p,near);}counts.nearTrees=near.length;counts.closestFir=candidates[0]?{x:candidates[0].x,y:candidates[0].y,z:candidates[0].z,height:candidates[0].scale}:null;apply?.(nearTrees);
 }
 const dx=Math.floor(camera.position.x/64)*64,dz=Math.floor(camera.position.z/64)*64,altitude=camera.position.y-terrainHeight(camera.position.x,camera.position.z);
 details.visible=altitude<200;
 if(!detailPending&&altitude<200&&(dx!==detailX||dz!==detailZ||fine!==detailFine)){detailX=dx;detailZ=dz;detailFine=fine;detailPending=true;detailWorker.postMessage({cx:dx,cz:dz,fine,rockWidth:rock.width,fernHeight:fern.height})}
 }
 return {group,update:refresh,counts}
}
