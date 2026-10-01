import {treeWindGLSL} from './tree-wind.js'
import {bakeCanopyLighting} from './canopy-light.js'
import * as T from 'three'
import {trailWeight} from './habitat.js'
import {ginkgoTemplate} from './ginkgo.js'
import {coniferTemplate} from './conifers.js'
import {bakeTreeAtlas} from './tree-atlas.js'
import {configureForestImpostor,treeTime} from './forest-impostor.js'
import {surfaceToneGLSL,grassRange} from './surface-tone.js'
import {createFeatherFernParts} from './feather-ferns.js'
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js'
import{MeshoptDecoder}from'three/addons/libs/meshopt_decoder.module.js'
import{hash,noise,terrainHeight,slopeAt,woodland,riverX,halfWidth,riverLevel,bankAt,SIZE,smooth,biomeAt,waterLevelAt,encounter}from'./world.js'
const habitat=new URLSearchParams(location.search).get('look')!=='baseline';
const rand=(i,n)=>hash(i*1.71+n*14.19,n*7.38-i*.31)
function templateParts(object){object.updateWorldMatrix(true,true);const box=new T.Box3().setFromObject(object),center=box.getCenter(new T.Vector3()),shift=new T.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z),parts=[];object.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();for(const name of ['position','normal','tangent']){const a=o.geometry.getAttribute(name);if(a){const d=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)d[i*a.itemSize+c]=a.getComponent(i,c);g.setAttribute(name,new T.BufferAttribute(d,a.itemSize))}}g.applyMatrix4(new T.Matrix4().multiplyMatrices(shift,o.matrixWorld));parts.push({geometry:g,material:o.material.clone()})});return{parts,height:box.max.y-box.min.y,width:Math.max(box.max.x-box.min.x,box.max.z-box.min.z)}}
function instances(group,part,items,shadow=true){if(!items.length)return;const pool=group.userData.instancePool,key=part.geometry.uuid+part.material.uuid;let mesh=pool?.get(key);if(mesh&&mesh.instanceMatrix.count<items.length){group.remove(mesh);mesh.dispose();mesh.material.dispose();pool.delete(key);mesh=null;}if(!mesh){const m=part.material.clone();m.onBeforeCompile=part.material.onBeforeCompile;m.customProgramCacheKey=part.material.customProgramCacheKey;m.envMapIntensity=.65;m.roughness=Math.max(.8,m.roughness??.8);if(m.map)m.map.anisotropy=8;if(m.alphaTest>0||m.transparent){m.transparent=false;m.alphaTest=habitat?Math.min(m.alphaTest||.28,.28):.32;m.depthWrite=true;m.side=T.DoubleSide;m.alphaToCoverage=habitat&&Boolean(part.material.userData.treeWind)}mesh=new T.InstancedMesh(part.geometry,m,pool?2**Math.ceil(Math.log2(Math.max(32,items.length))):items.length);group.add(mesh);pool?.set(key,mesh);}mesh.count=items.length;mesh.visible=true;const o=new T.Object3D(),c=new T.Color();items.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(p.tilt??0,p.yaw,p.roll??0);o.scale.set(p.scale*(p.sx??1),p.scale*(p.sy??1),p.scale*(p.sz??1));o.updateMatrix();mesh.setMatrixAt(i,o.matrix);const shade=p.tint??1;p.color?c.fromArray(p.color):c.setRGB(shade*.97,shade,shade*.93);mesh.setColorAt(i,c)});if(habitat&&part.material.userData.treeWind&&!mesh.customDepthMaterial){mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:part.material.map,alphaTest:part.material.alphaTest,side:T.DoubleSide});mesh.customDepthMaterial.onBeforeCompile=s=>{s.uniforms.viewerPosition=part.material.userData.treeViewer;s.uniforms.treeTime=treeTime;s.uniforms.leafMotion={value:part.material.alphaTest>0?1:0};s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float treeTime,leafMotion;uniform vec3 viewerPosition;varying float shadowTreeDistance;'+treeWindGLSL).replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;shadowTreeDistance=distance(viewerPosition,root);transformed+=treeWindOffset(position,root,leafMotion);');};}mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();return mesh}
async function atlasTree(){
 const tx=await new T.TextureLoader().loadAsync('./assets/fir-a-atlas.webp');tx.colorSpace=T.SRGBColorSpace;tx.anisotropy=8
 // Atlas side cutout occupies 50% of each cell width and 97% of cell height.
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-.345,-.016,0,.345,-.016,0,-.345,1.016,0,.345,1.016,0,-.1825,.65,-.275,.1825,.65,-.275,-.1825,.65,.275,.1825,.65,.275],3));g.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1,1,1,0,0,1,0,0,1,1,1],2));g.setAttribute('crownPlane',new T.Float32BufferAttribute([0,0,0,0,1,1,1,1],1));g.setIndex([0,1,2,2,1,3,4,6,5,6,7,5]);g.computeVertexNormals();
 return{geometry:g,material:new T.MeshBasicMaterial({map:tx,alphaTest:.28,side:T.DoubleSide,color:'#a9b89d'})}
}
export const riverRocks=Array.from({length:440},(_,i)=>{const z=-3900+i*18.5+rand(i,36)*9;return{x:riverX(z)+(i%5===0?(rand(i,37)-.5)*.9:(i%2?1:-1)*(.68+rand(i,37)*.32))*halfWidth(z),z,radius:1.1+rand(i,38)**1.5*2.7,strength:.5+rand(i,39)*.5}}).filter(r=>r.z<2600&&terrainHeight(r.x,r.z)>riverLevel(r.z)-4.5)
for(let i=0;i<125;i++){const z=-1350+i*11+rand(i,92)*4;riverRocks.push({x:riverX(z)+(i%2?1:-1)*halfWidth(z)*(.78+rand(i,93)*.3),z,radius:.65+rand(i,94)*1.65,strength:.6+rand(i,95)*.4})}
// Broken, staggered riffle groups: never a full-width row across the channel.
for(const [j,center]of [-1370,-875,-470,180,970,-2250].entries())for(let k=0;k<12;k++){
 const z=center+(rand(j*13+k,122)-.5)*48,x=riverX(z)+(k%2?1:-1)*halfWidth(z)*(.12+rand(j*13+k,123)*.56);
 riverRocks.push({x,z,radius:1.35+rand(j*13+k,124)*2.0,strength:.75+rand(j*13+k,125)*.25})
}
export async function makeProps(renderer,apply,getFine=()=>false,diagnostics){
 const stage=name=>{document.body.dataset.loadingStage=name};stage("scanned-props");
 const viewerPosition={value:new T.Vector3()},grassFade=grassRange;
 const group=new T.Group(),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),scan=await loader.loadAsync('./assets/scanned-props.glb'),rock=templateParts(scan.scene.getObjectByName('rock_07')),fern=createFeatherFernParts({seed:17,pairs:habitat?11:16,fronds:habitat?6:5,leafletWidth:habitat?2.3:1,spread:habitat?1.65:1})
 stage('stone-texture');const stoneMap=await new T.TextureLoader().loadAsync('./assets/cliff-albedo.webp');stoneMap.colorSpace=T.SRGBColorSpace;stoneMap.anisotropy=8;for(const part of rock.parts){part.material.map=stoneMap;part.material.vertexColors=false;part.material.color.set('#a3ac9c');part.material.roughness=.95;part.material.metalness=0;part.material.normalScale?.set(.65,.65)}
 // The same permanent obstacles drive both visible rocks and the water field.
 const riverStoneChunks=new Map();
 for(const r of riverRocks){const sy=.8+hash(r.x,r.z)*.5,scale=r.radius*2/rock.width,y=terrainHeight(r.x,r.z)-r.radius*.22,exposed=y+rock.height*scale*sy-riverLevel(r.z);r.strength*=smooth(-.35,.4,exposed);const key=Math.floor(r.z/256);if(!riverStoneChunks.has(key))riverStoneChunks.set(key,[]);riverStoneChunks.get(key).push({x:r.x,z:r.z,y,scale,sy,yaw:r.z,tint:.68+hash(r.z,r.x)*.2})}
 for(const rows of riverStoneChunks.values())for(const part of rock.parts)instances(group,part,rows,true);
 const coastStones=[];for(let z=1690;z<2690;z+=26)for(let x=8880;x<9540;x+=28){const px=x+hash(x,z)*18,pz=z+hash(z,x)*19,y=terrainHeight(px,pz);if(y< -7.5||y>1.2||noise(px/90,pz/115)<.46)continue;const r=.7+hash(px,pz+3)**2*3.0;coastStones.push({x:px,z:pz,y:y-r*.24,scale:r*2/rock.width,yaw:hash(px+7,pz)*6.28,sy:.65+hash(pz,px)*.35,tint:.78+hash(px,pz)*.18})}for(const part of rock.parts)instances(group,part,coastStones,true);
 stage('tree-bark');const barkMaps=await Promise.all(['albedo','normal','rough'].map(n=>new T.TextureLoader().loadAsync(`./assets/fir-bark-${n}.webp`)));barkMaps.forEach((t,i)=>{t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(2,12);t.anisotropy=8;if(i===0)t.colorSpace=T.SRGBColorSpace;});const barkMaterial=new T.MeshStandardMaterial({map:barkMaps[0],normalMap:barkMaps[1],normalScale:new T.Vector2(.65,.65),roughnessMap:barkMaps[2],roughness:.97,color:0xffffff});
 stage('needle-spray');const needleMap=await new T.TextureLoader().loadAsync('./assets/needle-spray-v1.png');needleMap.colorSpace=T.SRGBColorSpace;needleMap.anisotropy=8;
 stage('tree-model');const templates=habitat?[coniferTemplate(17,0,barkMaterial,needleMap),coniferTemplate(39,1,barkMaterial,needleMap),null,coniferTemplate(87,3,barkMaterial,needleMap)]:[templateParts((await loader.loadAsync('./assets/fir-a-spatial-near-layered.glb')).scene)];if(habitat)templates[2]=ginkgoTemplate(63,templates[0].parts[0].material);const tree=templates[0],far=habitat?bakeTreeAtlas(renderer,templates):await atlasTree();
 if(!habitat){tree.parts=tree.parts.filter(p=>!p.material.name.includes('full canopy silhouette'));for(const part of tree.parts){const a=part.geometry.attributes.position;for(let i=0;i<a.count;i++){const y=a.getY(i);a.setY(i,(y<8?y*.55:y-3.6)/.81)}part.geometry.computeVertexNormals();part.geometry.computeBoundingSphere()}}
 stage('meadow-model');const meadowAsset=await loader.loadAsync('./assets/meadow-grass.glb'),meadowVariants=['tiny_b','tiny_c','tiny_d'].map(n=>templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_'+n+'_LOD0'))),fullGrass=templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_small_a_LOD0')),wetGrass=templateParts(meadowAsset.scene.getObjectByName('grass_medium_01_tall_a_LOD0'));
 for(const part of [...meadowVariants.flatMap(v=>v.parts),...wetGrass.parts,...fullGrass.parts]){part.material.color.setRGB(2.2,2.6,1.65);part.material.envMapIntensity=.35;part.material.emissive.setRGB(.055,.075,.018);part.material.emissiveIntensity=.35}
 stage('forest-placement');let treeCount=0;const all=[],buckets=new Map(),spacing=18
 for(let iz=-465;iz<425;iz++)for(let ix=-215;ix<520;ix++){
 const i=(iz+465)*735+ix+215,x=(ix+hash(ix,iz))*spacing,z=(iz+hash(iz,ix+11))*spacing,density=woodland(x,z)
 if(rand(i,3)>density*.94)continue;const y=terrainHeight(x,z);if(y<3)continue
 const h=12+rand(i,4)**.85*24+noise(x/140,z/170)*5,p={x,z,y:y-.25,scale:h,yaw:rand(i,5)*6.28,tint:.69+rand(i,6)*.30,sx:.78+rand(i,7)*.4,sz:.85+rand(i,8)*.3,id:treeCount};if(Math.hypot(p.x-encounter.x,p.z-encounter.z)<48+p.scale*.28)continue;all.push(p);const key=`${Math.floor(x/128)},${Math.floor(z/128)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);treeCount++
 }
 // Mixed-age groups grow inside established woodland. Clearings stay open;
 // a second crown is offset from its parent cell instead of tightening a grid.
 if(habitat)for(const parent of [...all]){
  const gallery=parent.z>-1700&&parent.z<500&&bankAt(parent.x,parent.z)<180;
  const seed=hash(parent.x+123,parent.z-71);if(seed>(gallery?.52:.84)||noise(parent.x/95,parent.z/117)<(gallery?.43:.32))continue;
  for(let sibling=0;sibling<(gallery?1:2);sibling++){
   const angle=hash(parent.z+19+sibling*83,parent.x)*6.28,distance=6+hash(parent.x+sibling*39,parent.z+81)*8;
   const x=parent.x+Math.cos(angle)*distance,z=parent.z+Math.sin(angle)*distance,y=terrainHeight(x,z);
   if(woodland(x,z)<.26||slopeAt(x,z)<.70||Math.hypot(x-encounter.x,z-encounter.z)<60)continue;
   const p={x,z,y:y-.18,scale:parent.scale*(.62+hash(x,z+12)*.48),yaw:hash(z,x)*6.28,tint:.7+seed*.4,sx:.94+hash(x+13,z)*.3,sz:.96+hash(x,z+14)*.25,id:treeCount++};
   all.push(p);const key=`${Math.floor(x/128)},${Math.floor(z/128)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);
  }
 }
 // Denser gallery forest along the main low river, with gaps at gravel bars.
 for(let iz=-170;iz<40;iz++)for(let ix=-16;ix<=16;ix++){
 const z=iz*10+hash(ix,iz)*7,x=riverX(z)+ix*9+(hash(iz,ix)-.5)*6,b=bankAt(x,z),y=terrainHeight(x,z);if(b<6||b>135||slopeAt(x,z)<.72||hash(ix+11,iz)<.46||noise(x/35,z/47)<.35)continue
 const key=`${Math.floor(x/128)},${Math.floor(z/128)}`;const existing=buckets.get(key)??[];if(existing.some(p=>Math.hypot(p.x-x,p.z-z)<5))continue
 const p={x,z,y:y-.15,scale:18+hash(ix,iz+4)*17,yaw:hash(iz+17,ix)*6.28,tint:.64+hash(ix+8,iz)*.24,sx:.9+hash(ix,iz+9)*.2,sz:1,id:treeCount};if(Math.hypot(p.x-encounter.x,p.z-encounter.z)<48+p.scale*.28)continue;all.push(p);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);treeCount++
 }
 // Younger trees break up the bare-trunk rows and close the understory gaps.
 for(let i=0;i<1000;i++){const z=-1500+rand(i,83)*1900,side=i%2?1:-1,x=riverX(z)+side*(halfWidth(z)+7+rand(i,84)*95),y=terrainHeight(x,z);if(slopeAt(x,z)<.7||noise(x/17,z/21)<.38)continue;const key=`${Math.floor(x/128)},${Math.floor(z/128)}`,p={x,z,y:y-.12,scale:5+rand(i,85)*10,yaw:rand(i,86)*6.28,tint:.65+rand(i,87)*.23,sx:.9,sz:1,id:treeCount++};if(Math.hypot(p.x-encounter.x,p.z-encounter.z)<48+p.scale*.28)continue;all.push(p);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p)}
 // Coherent stands, individual age and species tint; reused exactly by near and far LODs.
 for(let i=all.length-1;i>=0;i--)if(trailWeight(all[i].x,all[i].z)>.12){const p=all[i];all.splice(i,1);const key=`${Math.floor(p.x/128)},${Math.floor(p.z/128)}`;buckets.set(key,buckets.get(key).filter(t=>t!==p));}
 for(const p of all){const sp=hash(Math.floor(p.x/31),Math.floor(p.z/37));p.species=sp<.34?0:sp<.59?1:sp<.88?2:3;
 const stand=noise(p.x/210,p.z/260),age=hash(p.x+19,p.z-41),light=.78+age*.34;
 const cool=[.74,.86,.94],warm=[1.18,1.02,.74],t=smooth(.28,.73,stand)*.8+(p.species?.13:0);
 const speciesTint=[[.86,.92,.92],[1.04,.94,.75],[1.18,1.02,.72],[.79,.86,.85]][p.species];p.color=cool.map((v,k)=>(v+(warm[k]-v)*t)*light*(.94+p.tint*.12)*speciesTint[k]);if(age>.94)p.color=[1.24,.98,.69].map(v=>v*light);}

 if(habitat)bakeCanopyLighting(all,templates);
 stage('pine-atlas');const pineMap=await new T.TextureLoader().loadAsync('./assets/pine-b-atlas.webp');pineMap.colorSpace=T.SRGBColorSpace;pineMap.anisotropy=8;
 // Camera-facing crowns keep full silhouettes in the distant forest. Close trees get geometry.
 const forest=new T.Group();diagnostics?.labelGroup(forest,'forestAtlas');group.add(forest);const chunks=new Map();
 for(let i=all.length-1;i>=0;i--)if(Math.hypot(all[i].x-encounter.x,all[i].z-encounter.z)<29)all.splice(i,1);
 for(const [key,items]of buckets)buckets.set(key,items.filter(p=>Math.hypot(p.x-encounter.x,p.z-encounter.z)>=29));
 for(const p of all){const key=`${Math.floor(p.x/512)},${Math.floor(p.z/512)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(p)}
 const forestRange={value:getFine()?8500:5700},nearFraction={value:habitat?(getFine()?1:.35):0};
 for(const items of chunks.values()){
 const mesh=instances(forest,far,items,false);mesh.geometry=far.geometry.clone();
 mesh.geometry.setAttribute('nearSeed',new T.InstancedBufferAttribute(new Float32Array(items.map(p=>hash(p.x+73,p.z-91))),1));
 mesh.geometry.setAttribute('treeSpecies',new T.InstancedBufferAttribute(new Float32Array(items.map(p=>p.species)),1));mesh.geometry.setAttribute('treeYaw',new T.InstancedBufferAttribute(new Float32Array(items.map(p=>p.yaw)),1));
 mesh.userData.center=new T.Vector3(items.reduce((v,p)=>v+p.x,0)/items.length,items.reduce((v,p)=>v+p.y,0)/items.length,items.reduce((v,p)=>v+p.z,0)/items.length);
 mesh.geometry.computeBoundingSphere();mesh.computeBoundingSphere();mesh.boundingSphere.radius+=70;
 mesh.material.onBeforeCompile=shader=>{
 shader.uniforms.viewerPosition=viewerPosition;shader.uniforms.pineMap={value:pineMap};shader.uniforms.firMap={value:far.material.map};shader.uniforms.forestRange=forestRange;shader.uniforms.nearFraction=nearFraction;
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform vec3 viewerPosition;attribute float nearSeed;varying float nearIdentity,rootDistance;attribute float treeYaw;attribute float treeSpecies;attribute float crownPlane;varying float species,atlasView,nextView,viewMix,coverage,treeDistance;')
 .replace('#include <project_vertex>',`species=treeSpecies;vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;vec3 toEye=cameraPosition-root;treeDistance=length(toEye);rootDistance=length(viewerPosition-root);nearIdentity=nearSeed;float elevation=abs(toEye.y)/max(1.,treeDistance);float viewAngle=mod((atan(toEye.x,toEye.z)-treeYaw)/.785398+16.,8.);atlasView=crownPlane>.5?8.:floor(viewAngle);nextView=crownPlane>.5?8.:mod(atlasView+1.,8.);viewMix=fract(viewAngle);vec3 scale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));vec3 right=normalize(vec3(toEye.z,0.,-toEye.x));vec3 world=root;if(crownPlane>.5){world+=vec3(position.x*scale.x,position.y*scale.y,position.z*scale.x);coverage=smoothstep(.78,.97,elevation);}else{world+=right*position.x*scale.x+vec3(0.,position.y*scale.y,0.);coverage=1.-smoothstep(.93,.998,elevation);}airWorld=world;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);`);
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
 uniform sampler2D pineMap,firMap;uniform float forestRange,nearFraction;varying float nearIdentity,rootDistance;varying float species,atlasView,nextView,viewMix,coverage,treeDistance;
 vec4 treeTex(vec2 p,float v){vec2 uv=vec2((p.x+mod(v,4.))/4.,(p.y+2.-floor(v/4.))/3.);return species>.5?texture2D(pineMap,uv):texture2D(firMap,uv);}`)
 .replace('#include <map_fragment>',`vec2 treeUV=vMapUv;if(atlasView<7.5&&species<.5)treeUV.y=treeUV.y<.287?treeUV.y*.81/.55:treeUV.y*.81+.19;vec4 texel=mix(treeTex(treeUV,atlasView),treeTex(treeUV,nextView),viewMix);float visibility=coverage*(1.-smoothstep(forestRange-1400.,forestRange,treeDistance));float stipple=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(stipple>visibility)discard;${habitat?'float nearCoverage=(species<.5&&nearIdentity<nearFraction)?1.-smoothstep(35.,90.,rootDistance):0.;if(stipple<nearCoverage)discard;':''}diffuseColor*=texel;`);
 };mesh.material.customProgramCacheKey=()=> `continuous-tree-r5-${habitat}`;
 if(habitat){mesh.material.alphaTest=.44;configureForestImpostor(mesh,far,viewerPosition,forestRange,nearFraction);}
 }
 const nearTrees=new T.Group(),details=new T.Group();group.add(nearTrees,details);diagnostics?.labelGroup(nearTrees,'nearTrees');diagnostics?.labelGroup(details,'detailOther');diagnostics?.labelGroup(group,'propsOther');nearTrees.userData.instancePool=new Map();details.userData.instancePool=new Map();let lastX=1e8,lastZ=1e8,lastFine=null,detailX=1e8,detailZ=1e8,detailFine=null,detailPending=false,counts={riverBoulders:riverRocks.length,trees:treeCount,nearTrees:0,rocks:0,ferns:0,grass:0}
 const dummy=new T.Object3D()
 // Ground blades share one mesh and are restricted to the nearby banks, not the whole island.
 const grassG=new T.BufferGeometry(),gp=[],gc=[],gi=[]
 // Curved, tapered blades: fixed roots and height, distance changes only width.
 // Coverage handover follows Tidewater's GrassField, with shared terrain pigment.
 const bladeSide=[],bladeHeight=[];
 for(let k=0;k<12;k++){
 const angle=k*2.39996,radius=.04+rand(k,12)*.21,bx=Math.cos(angle)*radius,bz=Math.sin(angle)*radius,h=.28+rand(k,20)*.64,w=.010+rand(k,19)*.012,base=gp.length/3;
 for(let j=0;j<=3;j++){const t=j/3,bend=t*t*h*(.27+rand(k,14)*.56),half=w*(1-Math.pow(t,1.6)),cx=bx+Math.cos(angle)*bend,cz=bz+Math.sin(angle)*bend,y=h*t;
 for(const side of [-1,1]){const sx=Math.sin(angle)*half*side,sz=-Math.cos(angle)*half*side;gp.push(cx+sx,y,cz+sz);bladeSide.push(sx,0,sz);bladeHeight.push(t);gc.push(.16+t*.12,.25+t*.15,.07+t*.055)}
 if(j<3){const i=base+j*2;gi.push(i,i+2,i+1);if(j<2)gi.push(i+1,i+2,i+3)}}}
 grassG.setAttribute('position',new T.Float32BufferAttribute(gp,3));grassG.setAttribute('color',new T.Float32BufferAttribute(gc,3));grassG.setAttribute('bladeSide',new T.Float32BufferAttribute(bladeSide,3));grassG.setAttribute('bladeHeight',new T.Float32BufferAttribute(bladeHeight,1));grassG.setIndex(gi);grassG.computeVertexNormals();
 const normals=grassG.getAttribute('normal');for(let i=0;i<normals.count;i++){const n=new T.Vector3(normals.getX(i)*.45,Math.abs(normals.getY(i))+.8,normals.getZ(i)*.45).normalize();normals.setXYZ(i,n.x,n.y,n.z)}
 const grassPart={geometry:grassG,material:new T.MeshStandardMaterial({vertexColors:true,roughness:.96,side:T.DoubleSide})};
 const pebbleG=new T.IcosahedronGeometry(1,0),pebblePart={geometry:pebbleG,material:rock.parts[0].material}
 const debrisG=new T.CylinderGeometry(.018,.04,1,5,1);debrisG.rotateZ(Math.PI/2);debrisG.translate(0,.04,0);
 const debrisPart={geometry:debrisG,material:new T.MeshStandardMaterial({color:'#625544',roughness:1})};
 const litterG=new T.BufferGeometry(),lp=[0,.025,0],li=[];
 for(let i=0;i<9;i++){const a=-1.1+i/8*2.2;lp.push(Math.sin(a)*.62,.015+Math.cos(a*3)*.04,Math.cos(a));if(i<8)li.push(0,i+1,i+2);}
 litterG.setAttribute('position',new T.Float32BufferAttribute(lp,3));litterG.setIndex(li);litterG.computeVertexNormals();
 const litterPart={geometry:litterG,material:new T.MeshStandardMaterial({color:0xffffff,roughness:1,side:T.DoubleSide})};
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
 for(const part of [grassPart,reedPart,...fern.parts,...meadowVariants.flatMap(v=>v.parts),...wetGrass.parts,...fullGrass.parts]){part.material.alphaToCoverage=true;part.material.onBeforeCompile=shader=>{shader.uniforms.plantTime=plantTime;shader.uniforms.viewerPosition=viewerPosition;shader.uniforms.grassFade=grassFade;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float plantTime;').replace('#include <begin_vertex>',`#include <begin_vertex>
 vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;float breeze=sin(plantTime*1.15+root.x*.031+root.z*.024)+sin(plantTime*.71+root.x*.071)*.3;transformed.x+=breeze*position.y*position.y*.055;transformed.z+=breeze*position.y*.02;`);shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 viewerPosition;uniform vec2 grassFade;').replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
 float densityFade=1.-smoothstep(${habitat&&(part===grassPart||meadowVariants.some(v=>v.parts.includes(part))||fullGrass.parts.includes(part))?'grassFade.x,grassFade.y':'95.,155.'},length(airWorld-viewerPosition));diffuseColor.a*=densityFade;if(densityFade<.001)discard;`)};part.material.customProgramCacheKey=()=> 'ground-wind-r4'}
 const grassCompile=grassPart.material.onBeforeCompile;
 grassPart.material.onBeforeCompile=shader=>{
 grassCompile(shader);
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform vec3 viewerPosition;uniform vec2 grassFade;attribute vec3 bladeSide;attribute float bladeHeight;varying vec2 pigmentRoot;varying float leafHeight;')
 .replace('float breeze=', 'pigmentRoot=root.xz;leafHeight=bladeHeight;float bladeDistance=length(root-viewerPosition);float widthFade=1.-smoothstep(grassFade.x,grassFade.y,bladeDistance);float resolvedWidth=mix(1.,1.75,smoothstep(8.,35.,bladeDistance));transformed+=bladeSide*(resolvedWidth*widthFade-1.);float breeze=');
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 pigmentRoot;varying float leafHeight;'+surfaceToneGLSL)
 .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=meadowPigment(pigmentRoot)*mix(.58,1.24,leafHeight);float straw=pow(pigmentHash(floor(pigmentRoot*5.)),3.)*.72;diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.55,1.24,.75),straw);')
 .replace('#include <normal_fragment_maps>', 'normal=normalize(vNormal);')
 .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*.07*leafHeight;');
 };
 const swardCompile=grassPart.material.onBeforeCompile;grassPart.material.onBeforeCompile=s=>{swardCompile(s);s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.035;reflectedLight.indirectSpecular*=.035;');};
 grassPart.material.customProgramCacheKey=()=> 'matte-tall-sward-r10';

 // A permanent coarse reed layer keeps the floodplain inhabited from flight height.
 // Fine nearby plants add detail without shrinking or replacing these stems.
 const marshP=[],marshI=[];
 for(let b=0;b<12;b++){const angle=b*2.39996,px=Math.cos(angle)*(.3+b*.24),pz=Math.sin(angle)*(.3+b*.24),height=1.1+rand(b,239)*.7;const start=marshP.length/3;
 for(let j=0;j<=3;j++){const t=j/3,width=.032*(1-t)+.003,lean=t*t*.48;for(const side of[-1,1])marshP.push(px+Math.cos(angle)*lean+Math.sin(angle)*width*side,height*t,pz+Math.sin(angle)*lean-Math.cos(angle)*width*side);if(j<3){const n=start+j*2;marshI.push(n,n+2,n+1,n+1,n+2,n+3)}}}
 const marshG=new T.BufferGeometry();marshG.setAttribute('position',new T.Float32BufferAttribute(marshP,3));marshG.setIndex(marshI);marshG.computeVertexNormals();
 const marshPart={geometry:marshG,material:new T.MeshStandardMaterial({color:'#82905d',emissive:'#1b230d',emissiveIntensity:.25,roughness:.95,side:T.DoubleSide})},reedChunks=new Map();
 for(let z=3900;z<6900;z+=22)for(let x=1300;x<5900;x+=22){const px=x+(hash(x,z)-.5)*18,pz=z+(hash(z,x)-.5)*18;if(biomeAt(px,pz).marsh<.9||noise(px/90,pz/110)<.39)continue;const y=terrainHeight(px,pz),wl=waterLevelAt(px,pz);if(y<wl-.35||y>wl+1.35)continue;const key=`${Math.floor(px/512)},${Math.floor(pz/512)}`;if(!reedChunks.has(key))reedChunks.set(key,[]);reedChunks.get(key).push({x:px,z:pz,y:y-.08,scale:.7+hash(px,pz)*.6,yaw:hash(pz,px)*6.28,tint:.7+hash(px+1,pz)*.45})}
 for(const items of reedChunks.values())instances(group,marshPart,items,false);
 diagnostics?.labelGeometry(grassG,'grass');for(const part of fern.parts)diagnostics?.labelGeometry(part.geometry,'ferns');
 stage('detail-worker');const detailWorker=new Worker(new URL('./detail-worker.js',import.meta.url),{type:'module'});
 let currentCamera;
 detailWorker.onerror=e=>{console.error('Island detail worker:',e.message);counts.detailError=e.message;detailPending=false};
 detailWorker.onmessage=e=>{
 const consumeStart=performance.now();
 if(e.data.ready){detailPending=false;detailX=detailZ=1e8;return}
 const {cx,cz,rocks,pebbles,ferns,grass,reeds,debris=[],litter=[]}=e.data;const camera=currentCamera,fine=getFine();
 for(const list of [rocks,ferns,grass,reeds]){for(const p of list)p.viewDistanceSquared=(p.x-camera.position.x)**2+(p.y-camera.position.y)**2+(p.z-camera.position.z)**2;list.sort((a,b)=>a.viewDistanceSquared-b.viewDistanceSquared);}reeds.length=Math.min(reeds.length,fine?3000:1400);
 rocks.length=Math.min(rocks.length,fine?1500:380);ferns.length=Math.min(ferns.length,fine?650:120);grass.length=Math.min(grass.length,habitat?(fine?60000:15000):(fine?8000:2200));
 const instanceStart=performance.now();clear(details);instances(details,litterPart,litter,false);instances(details,debrisPart,debris,false);for(const p of rock.parts)instances(details,p,rocks);instances(details,pebblePart,pebbles,false);for(const p of fern.parts)instances(details,p,ferns,false);if(habitat)instances(details,grassPart,grass,false);else for(let i=0;i<meadowVariants.length;i++){const variant=meadowVariants[i],items=grass.filter(p=>Math.floor(hash(p.x,p.z)*3)===i).map(p=>({...p,scale:p.scale*.4/variant.height}));for(const part of variant.parts)instances(details,part,items,false)}for(const part of wetGrass.parts)instances(details,part,reeds.map(p=>({...p,scale:p.scale*1.25/wetGrass.height})),false);
 diagnostics?.event('instanceWrites',{cpuMs:performance.now()-instanceStart,source:'detail-worker'});
 counts.litter=litter.length;counts.rocks=rocks.length+pebbles.length;counts.ferns=ferns.length;counts.grass=grass.length;counts.reeds=reeds.length;apply?.(details);detailPending=false;diagnostics?.event('workerConsume',{worker:'detail',cpuMs:performance.now()-consumeStart,workerMs:e.data.workerMs??null,grass:grass.length});
 };
 for(const part of templates.flatMap(t=>t.parts)){part.material.userData.treeWind=true;part.material.userData.treeViewer=viewerPosition;part.material.onBeforeCompile=s=>{s.uniforms.viewerPosition=viewerPosition;if(habitat){s.uniforms.treeTime=treeTime;s.uniforms.leafMotion={value:part.material.alphaTest>0?1:0};s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float treeTime,leafMotion;'+treeWindGLSL).replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 treeRoot=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;transformed+=treeWindOffset(position,treeRoot,leafMotion);');}if(habitat&&part.material.alphaTest>0)s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>','normal=normalize(vNormal);');if(habitat&&part.material.alphaTest>0)s.fragmentShader=s.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.025;reflectedLight.indirectSpecular*=.025;');if(habitat)s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform vec3 viewerPosition;varying float rootDistance;').replace('#include <begin_vertex>','#include <begin_vertex>\nrootDistance=distance(viewerPosition,(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz);');if(habitat)s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 viewerPosition;varying float rootDistance;');s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
 float nearCoverage=1.-smoothstep(${habitat?'80.,112.,rootDistance':'70.,95.,length(airWorld-cameraPosition)'});float transitionNoise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));if(transitionNoise>=nearCoverage)discard;`)};if(habitat&&!(part.material.alphaTest>0)){const compile=part.material.onBeforeCompile;part.material.onBeforeCompile=s=>{compile(s);s.fragmentShader=s.fragmentShader.replace('if(transitionNoise>=nearCoverage)discard;','if(rootDistance>112.)discard;');};}part.material.customProgramCacheKey=()=> `near-canopy-r10-${habitat}`}
 function refresh(camera,time){
 treeTime.value=time;viewerPosition.value.copy(camera.position);grassFade.value.set(getFine()?32:22,getFine()?85:48);plantTime.value=time;currentCamera=camera;const fine=getFine(),step=habitat?16:32,cx=Math.floor(camera.position.x/step)*step,cz=Math.floor(camera.position.z/step)*step;
 forestRange.value=fine?8500:5700;nearFraction.value=habitat?(fine?1:.35):0;for(const mesh of forest.children)mesh.visible=mesh.userData.center.distanceTo(camera.position)<forestRange.value+500;
 if(cx!==lastX||cz!==lastZ||fine!==lastFine){lastX=cx;lastZ=cz;lastFine=fine;clear(nearTrees);const candidates=[];
 for(let iz=Math.floor((cz-220)/128);iz<=Math.floor((cz+220)/128);iz++)for(let ix=Math.floor((cx-220)/128);ix<=Math.floor((cx+220)/128);ix++)for(const p of buckets.get(`${ix},${iz}`)??[])if((habitat||p.species<.5)&&hash(p.x+73,p.z-91)<(habitat?(fine?1:.35):(fine?.12:.045))&&Math.hypot(p.x-camera.position.x,p.y+(habitat?0:p.scale*.5)-camera.position.y,p.z-camera.position.z)<(habitat?150:185))candidates.push(p);
 candidates.sort((a,b)=>Math.hypot(a.x-camera.position.x,a.z-camera.position.z)-Math.hypot(b.x-camera.position.x,b.z-camera.position.z));
 for(let species=0;species<templates.length;species++){const template=templates[species],near=candidates.filter(p=>!habitat||p.species===species).map(p=>({...p,scale:p.scale/(habitat?template.height:18.925)}));for(const part of template.parts)instances(nearTrees,part,near);}counts.nearTrees=candidates.length;counts.closestFir=candidates[0]?{x:candidates[0].x,y:candidates[0].y,z:candidates[0].z,height:candidates[0].scale}:null;apply?.(nearTrees);
 }
 const detailStep=habitat?16:64,dx=Math.floor(camera.position.x/detailStep)*detailStep,dz=Math.floor(camera.position.z/detailStep)*detailStep,altitude=camera.position.y-terrainHeight(camera.position.x,camera.position.z);
 details.visible=altitude<200;
 if(!detailPending&&altitude<200&&(dx!==detailX||dz!==detailZ||fine!==detailFine)){detailX=dx;detailZ=dz;detailFine=fine;detailPending=true;detailWorker.postMessage({cx:dx,cz:dz,fine,habitat,rockWidth:rock.width,fernHeight:fern.height})}
 }
 // The 512 px mirror uses the same tree identities through their relightable atlas.
 // Keep full branch geometry in the main view and shadow pass.
 return {group,update:refresh,reflectionMode(active){nearTrees.visible=!active;nearFraction.value=active?0:habitat?(getFine()?1:.35):0;},counts,status:()=>({pending:detailPending,error:counts.detailError??null,time:plantTime.value,counts:{...counts}})}
}
