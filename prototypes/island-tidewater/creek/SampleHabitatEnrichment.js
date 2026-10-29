// Rooted understory, fresh-water margins and shallow marine vegetation.
// Vault source bytes / licence / changes: sample-habitat.lock.json.
import {BufferGeometry,BufferAttribute,Float32BufferAttribute,Group,Mesh,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {ShaderModule,UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {commonModule} from '../vendor/tidewater/src/engine/render/wgsl/common.js';
import {loadGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {createSeagrass} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const URLS={
 cycad:new URL('./assets/habitat-cycad-vault.glb',import.meta.url),
 'fern-cluster':new URL('./assets/habitat-fern-cluster-vault.glb',import.meta.url),
 'horsetail-cluster':new URL('./assets/habitat-horsetail-cluster-vault.glb',import.meta.url),
 marsilea:new URL('./assets/habitat-marsilea-vault.glb',import.meta.url),
 montsechia:new URL('./assets/habitat-montsechia-vault.glb',import.meta.url),
 halimeda:new URL('./assets/habitat-halimeda-vault.glb',import.meta.url),
 'three-toed-track':new URL('./assets/habitat-three-toed-track-vault.glb',import.meta.url),
};
const SPECS=[
 {id:'cycad',count:44,mode:0,scale:[.55,.92],height:1.3678,bank:[5,23],rise:[.65,12],spacing:2.25,range:38,flex:.34},
 {id:'fern-cluster',count:62,mode:0,scale:[.46,.83],height:.8818,bank:[2.0,18],rise:[.24,9],spacing:1.35,range:29,flex:.72},
 {id:'horsetail-cluster',count:106,mode:0,scale:[.38,.72],height:1.4816,bank:[.5,7],rise:[.08,2.5],spacing:.69,range:31,flex:1},
 {id:'marsilea',count:90,mode:1,scale:[1.45,2.65],height:.08491,bank:[-1.8,-.15],spacing:.48,range:24,flex:.8},
 {id:'montsechia',count:100,mode:2,scale:[2.3,4.3],height:.15,spacing:.63,range:30,flex:.76},
 {id:'halimeda',count:132,mode:3,scale:[1.4,3.1],height:.15,spacing:.72,range:32,flex:.34},
 {id:'seagrass',count:108,mode:3,scale:[1.15,1.95],height:.32,spacing:1.15,range:34,flex:1},
];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const slopeAt=(terrain,x,z)=>Math.hypot(terrain.heightAt(x+.4,z)-terrain.heightAt(x-.4,z),terrain.heightAt(x,z+.4)-terrain.heightAt(x,z-.4))/.8;
const packedLinear=c=>c.slice(0,3).reduce((n,v,i)=>n+(Math.round(clamp(v,0,1)*255)<<(16-i*8)),0);
const pointXZ=p=>[p[0],p.length>2?p[2]:p[1]];
function distanceToTrack(x,z,path){
 const points=path?.points?.length>1?path.points:path?.start&&path?.end?[path.start,path.end]:[];
 let best=Infinity;
 for(let i=1;i<points.length;i++){
  const a=pointXZ(points[i-1]),b=pointXZ(points[i]),dx=b[0]-a[0],dz=b[1]-a[1],u=clamp(((x-a[0])*dx+(z-a[1])*dz)/Math.max(.000001,dx*dx+dz*dz),0,1);
  best=Math.min(best,Math.hypot(x-a[0]-dx*u,z-a[1]-dz*u));
 }
 return best;
}

// Kept separate from GPU construction so a placement audit uses the exact
// physical terrain and water fields that will later be rendered.
export function planSampleHabitat(data,forestRecords=[],trackPath=null){
 const route=data.field.continuousSample;
 if(!route)return {plants:[],tracks:[],counts:{},rejections:{},trackPath:null};
 const terrain=data.terrain,ground=(x,z)=>terrain.heightAt(x,z),rng=mulberry32(281094);
 const plants=[],counts={},rejections={};
 const nodes=route.points.filter(p=>p.distance>150&&p.distance<665);
 const lower=nodes.filter(p=>p.distance>445);
 const nearTrack=(x,z)=>distanceToTrack(x,z,trackPath)<1.6;
 const hard=data.sampleBenthicDetails?.coralSites??[];
 for(const spec of SPECS){
  let made=0,rejected=0;
  for(let attempt=0;made<spec.count&&attempt<spec.count*230;attempt++){
   let x,z,r;
   const scale=spec.scale[0]+rng()*(spec.scale[1]-spec.scale[0]);
   if(spec.mode<3){
    const choices=rng()<.73?lower:nodes,p=choices[Math.floor(rng()*choices.length)];
    r=route.nearest(p.x,p.z);
    const side=rng()<.5?-1:1;
    const offset=spec.mode===2?r.width*(.36+rng()*.44):r.width+spec.bank[0]+rng()*(spec.bank[1]-spec.bank[0]);
    x=p.x+r.dir[1]*offset*side+(rng()-.5)*1.7;
    z=p.z-r.dir[0]*offset*side+(rng()-.5)*1.7;
    r=route.nearest(x,z);
   }else{
    // Distinct bayside patches around broken hard-bottom; the ebb lane stays
    // bare. The two plant forms occupy overlapping but unequal pockets.
    const f=Math.floor(rng()*5),centers=[[-942,157],[-961,126],[-979,174],[-1001,148],[-974,107]],c=centers[f];
    const angle=rng()*Math.PI*2,rad=Math.sqrt(rng()),rx=spec.id==='halimeda'?12:17,rz=spec.id==='halimeda'?10:13;
    x=c[0]+Math.cos(angle)*rad*rx;z=c[1]+Math.sin(angle)*rad*rz;r=route.nearest(x,z);
   }
   const y=ground(x,z),wf=data.field.sample(x,z),water=spec.mode===3?-.7:wf[0],depth=water-y,rise=y-water;
   const slope=slopeAt(terrain,x,z),lift=spec.mode===1?Math.max(0,depth-.06*scale+.015):0,plantHeight=spec.height*scale+lift;
   let invalid=!Number.isFinite(y)||slope>(spec.mode===0?.49:spec.mode===1?.53:.30)||nearTrack(x,z);
   if(spec.mode===0){
    invalid ||= rise<spec.rise[0]||rise>spec.rise[1]||wf[1]<.15;
    // Dune/swash sand remains open. In the lower section understory follows
    // shaded backshore roots rather than extending the green carpet seaward.
    invalid ||= r.distance>600&&y<4.5;
    if(spec.id==='cycad')invalid ||= forestRecords.length>0&&!forestRecords.some(t=>Math.hypot(t.x-x,t.z-z)<20);
   }else if(spec.mode===1){
    // Marsilea is intentionally emergent at fresh-water margins, distinct
    // from the fully submerged Montsechia and marine plants below.
    invalid ||= depth<.15||depth>.65||wf[1]>.15||r.distance>625||wf[0]<3;
   }else if(spec.mode===2){
    invalid ||= depth<plantHeight+.24||depth>2.8||wf[1]>-.15||Math.abs(r.across)<r.width*.30;
   }else{
    invalid ||= depth<Math.max(1.45,plantHeight+.35)||depth>4.1;
    invalid ||= r&&r.distance<880&&Math.abs(r.across)<r.width*.30;
    invalid ||= hard.some(p=>Math.hypot(p.x-x,p.z-z)<(p.span??.5)*.60+(spec.id==='halimeda'?.25:.75));
   }
   // Broken clonal pockets, with clear sediment between them. This function
   // depends on world coordinates, so revisiting never rearranges a meadow.
   invalid ||= Math.sin(x*.37+Math.sin(z*.19)*1.9)+Math.sin(z*.29-x*.11)<-.92;
   invalid ||= plants.some(p=>p.id===spec.id&&Math.hypot(p.x-x,p.z-z)<spec.spacing);
   if(invalid){rejected++;continue;}
   plants.push({id:spec.id,kind:SPECS.indexOf(spec),x,z,y:y-.018,ground:y,water,depth,slope,scale,lift,height:plantHeight,mode:spec.mode,range:spec.range,seed:rng(),yaw:rng()*Math.PI*2,flex:spec.flex,flow:spec.mode===2?[wf[2],wf[3]]:[.09,.025]});made++;
  }
  counts[spec.id]=made;rejections[spec.id]=rejected;
 }
 const tracks=planTracks(data,trackPath,rng);
 return {plants,tracks,counts,rejections,trackPath};
}

function planTracks(data,path,rng){
 const route=data.field.continuousSample,terrain=data.terrain,prints=[];
 let start,end;
 if(path?.start&&path?.end){start=pointXZ(path.start);end=pointXZ(path.end);}
 else if(path?.points?.length>1){start=pointXZ(path.points[0]);end=pointXZ(path.points.at(-1));}
 else{
  // Resolve against the expanded river, never assume the previous narrow
  // creek's shore still exists at a fixed hard-coded X.
  const r=route.nearest(-799,75),n=[r.dir[1],-r.dir[0]],c=[r.x+n[0]*(r.width+2.0),r.z+n[1]*(r.width+2.0)];
  start=[c[0]-r.dir[0]*6,c[1]-r.dir[1]*6];end=[c[0]+r.dir[0]*6,c[1]+r.dir[1]*6];
 }
 const len=Math.hypot(end[0]-start[0],end[1]-start[1]);if(len<2)return prints;
 const dx=(end[0]-start[0])/len,dz=(end[1]-start[1])/len,step=path?.traceStepMetres??path?.stepMetres??1.08,footLength=path?.footLengthMetres??.54;
 for(let d=.35,i=0;d<len-.6;d+=step*(.93+rng()*.14),i++){
  const side=i%2?1:-1,lateral=(path?.bankOffsetMetres??-.9)+side*(path?.halfTrackMetres??.34)+(rng()-.5)*.10;
  const x=start[0]+dx*d+dz*lateral,z=start[1]+dz*d-dx*lateral,y=terrain.heightAt(x,z),wf=data.field.sample(x,z),r=route.nearest(x,z);
  const dry=y-wf[0];
  if(!Number.isFinite(y)||wf[1]<.04||dry<.035||dry>2.6||slopeAt(terrain,x,z)>.27||r.distance>690)continue;
  prints.push({x,y,z,side,phase:i,length:footLength*(.95+rng()*.10),yaw:Math.atan2(dx,dz)+(rng()-.5)*.11,age:.40+rng()*.35,reliefMetres:.0148,source:'three-toed-track',correspondence:'Older Parasaurolophus-like three-toed hindfoot trail; artistic previous walking pass beside current short-step animation, not exact live footfall or ichnotaxon identification'});
 }
 return prints;
}

// Merge source material slots without flattening their colour hierarchy.
// aData = root-to-tip bend, packed linear RGB, root contact AO, part seed.
export function habitatGeometry(gltf,id){
 const pos=[],normal=[],data=[],indices=[];let maxY=0;
 for(const node of gltf.nodes)if(node.mesh!==undefined){
  if(node.s.some(v=>Math.abs(v-1)>1e-6)||node.r.some((v,i)=>Math.abs(v-(i===3?1:0))>1e-6))throw Error('Habitat transform requires baking: '+id+' '+node.name);
  for(const p of gltf.meshes[node.mesh]){
   if(p.mode!==4||!p.attributes.NORMAL)throw Error('Habitat requires triangle geometry and normals: '+id);
   const a=p.attributes.POSITION.array,n=p.attributes.NORMAL.array,color=gltf.materials[p.material??0]?.pbrMetallicRoughness?.baseColorFactor??[.2,.3,.12],base=pos.length/3;
   const rigid=/caudex|persistent leaf bases/i.test(node.name),hash=Array.from(node.name).reduce((s,c)=>(s*31+c.charCodeAt(0))>>>0,0)/4294967296;
   for(let i=0;i<a.length;i+=3){
    const x=a[i]+node.t[0],y=a[i+1]+node.t[1],z=a[i+2]+node.t[2];
    if(![x,y,z,n[i],n[i+1],n[i+2]].every(Number.isFinite))throw Error('Nonfinite habitat vertex '+id);
    pos.push(x,y,z);normal.push(n[i],n[i+1],n[i+2]);maxY=Math.max(maxY,y);
    const growth=rigid?0:id==='cycad'?clamp((Math.hypot(x,z)-.18)/.92,0,1):clamp(y/(SPECS.find(s=>s.id===id)?.height??1),0,1);
    data.push(growth,packedLinear(color),.72+.28*smooth(.01,.16,y),hash);
   }
   const ix=p.indices??Array.from({length:a.length/3},(_,i)=>i);for(const i of ix)indices.push(base+i);
  }
 }
 if(!indices.length||maxY<=0)throw Error('Empty habitat geometry '+id);
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('normal',new Float32BufferAttribute(normal,3));g.setAttribute('aData',new Float32BufferAttribute(data,4));g.setIndex(new BufferAttribute(new Uint32Array(indices),1));g.computeBoundingSphere();return g;
}

function plantMaterial(batch,terrainGPU,view){
 const P=batch.prefix,records=batch.record('index');
 const motion=new ShaderModule({name:'sampleHabitatMotion',deps:[commonModule],uniforms:view,code:`
fn habitatColor(f:f32)->vec3f{let u=u32(f+.5);return vec3f(f32((u>>16u)&255u),f32((u>>8u)&255u),f32(u&255u))/255.0;}
fn habitatRotate(q:vec4f,p:vec3f)->vec3f{return p+cross(q.xyz,cross(q.xyz,p)+p*q.w)*2.0;}
fn habitatBend(xz:vec2f,t:f32,seed:f32,part:f32,weight:f32,mode:f32,flow:vec2f)->vec3f{
 let phase=seed*31.0+part*13.0;
 if(mode<1.5){
  let wind=max(frame.windSpeed*.1,.03);
  let gust=.57+.23*sin(dot(xz,vec2f(.071,.039))-t*.63)+.20*sin(dot(xz,vec2f(-.031,.083))-t*.37);
  let pulse=(.045+wind*.13)*gust+sin(t*2.3+phase)*.018*wind;
  let side=sin(t*5.1+phase+xz.x*.12)*.011*wind;
  return vec3f(frame.windDir.x*pulse-frame.windDir.y*side,-abs(pulse)*.06,frame.windDir.y*pulse+frame.windDir.x*side)*weight;
 }
 let marine=select(0.0,1.0,mode>2.5);
 let surge=sin(t*.77-dot(xz,vec2f(.024,.009))+phase*.12)*.11*marine;
 let current=flow*(.12+sin(t*1.27+phase)*.035);
 let flutter=vec2f(sin(t*2.1+phase),cos(t*1.63+phase))*.015;
 let d=(current+vec2f(surge,surge*.22)+flutter)*weight;
 return vec3f(d.x,-dot(d,d)*.35,d.y);
}`});
 return new Material({name:'Sample Vault leaves, wind and current',side:'double',modules:[batch.module,terrainGPU.module,motion],attributes:{aKind:'f32',aData:'vec4f'},varyings:{vHabitatColor:'vec3f',vHabitatAO:'f32',vHabitatMode:'f32'},vertex:`
 let index=${P}RecordIndex(u32(v.aKind),v.instance);
 let r0=${records[0]};let q=${records[1]};let r2=${records[2]};let r3=${records[3]};
 let distance=length(sampleHabitatView.position-r0.xyz);let grow=1.0-smoothstep(r2.y*.80,r2.y,distance);
 var local=v.position*r0.w*grow;
 if(r2.z>.5&&r2.z<1.5){local.y+=r3.w*smoothstep(.008,.036,v.position.y)*grow;}
 var world=habitatRotate(q,local)+r0.xyz;
 let contact=1.0-smoothstep(0.0,.13,local.y);
 world.y+=(terrainHeightAt(world.xz)-.018-r0.y)*contact;
 let weight=v.aData.x*v.aData.x*r3.z*r0.w*grow;
 let now=habitatBend(r0.xz,frame.time,r2.x,v.aData.w,weight,r2.z,r3.xy);
 let old=habitatBend(r0.xz,frame.time-frame.dt,r2.x,v.aData.w,weight,r2.z,r3.xy);
 v.useWorld=true;v.worldPos=world+now;v.prevWorldPos=world+old;v.worldNormal=normalize(habitatRotate(q,v.normal));
 o.vHabitatColor=habitatColor(v.aData.y)*(vec3f(.88,.91,.84)+r2.x*.16);
 o.vHabitatAO=v.aData.z;o.vHabitatMode=r2.z;
`,surface:`
 s.albedo=in.vs.vHabitatColor;s.roughness=select(.86,.75,in.vs.vHabitatMode>1.5);s.metalness=0.0;s.specularIntensity=.12;
 s.ao=in.vs.vHabitatAO;s.translucency=s.albedo*select(.12,.035,in.vs.vHabitatMode>1.5);
`});
}

export function footprintGeometry(gltf,prints,terrain){
 const positions=[],data=[],indices=[];
 // Extract the first recessed footprint from the source GLB. Source slab
 // plane: y=.133+.006*x-.004*z; source first visual centre=(-.86,-.18).
 // Its 87-degree travel is unrotated before placing each new step.
 const source=[];let sourceTriangles=0;
 for(const p of gltf.meshes[0]){
  const a=p.attributes.POSITION.array,ix=p.indices;
  for(let i=0;i<ix.length;i+=3){
   const tri=[ix[i],ix[i+1],ix[i+2]].map(k=>{const x=a[k*3],y=a[k*3+1],z=a[k*3+2];return {x,y,z,h:y-(.133+.006*x-.004*z)};});
   if(tri.some(v=>v.x>-.425||Math.hypot(v.x+.86,v.z+.18)>.51||v.h<-.048))continue;
   if(!tri.some(v=>Math.abs(v.h)>.001))continue;
   source.push(tri);sourceTriangles++;
  }
 }
 if(sourceTriangles<150)throw Error('Vault cavity extraction no longer matches source');
 const a=-87*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 for(const print of prints){
  const scale=print.length/(.72*.76),cs=Math.cos(print.yaw),sn=Math.sin(print.yaw);
  for(const tri of source){
   const offset=positions.length/3;
   for(const v of tri){
    const dx=v.x+.86,dz=v.z+.18;
    // Undo the source +X walk into local +Z; GLB Z reverses Blender Y.
    const lx=(dx*c+dz*s)*scale,lz=(-dx*s+dz*c)*scale;
    const x=print.x+lx*cs+lz*sn,z=print.z-lx*sn+lz*cs;
    const floor=terrain.heightAt(x,z),relief=.0018+clamp(v.h+.046,0,.054)*.24;
    positions.push(x,floor+relief,z);data.push(clamp(-v.h/.046,0,1),print.age);
   }
   indices.push(offset,offset+1,offset+2);
  }
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('aFoot',new Float32BufferAttribute(data,2));g.setIndex(new BufferAttribute(new Uint32Array(indices),1));g.computeVertexNormals();g.computeBoundingSphere();g.userData={sourceTriangles,tracks:prints.length};return g;
}

function readTrackPath(data){
 const sites=data.sampleMuseumLifeSites;
 if(!sites)return null;
 const rows=Array.isArray(sites)?sites:Object.values(sites);
 const para=rows.find(s=>/parasaurolophus/i.test(s?.id??s?.species??s?.key??''));
 return para?.trackPath??para?.path??para?.walkPath??data.sampleMuseumLifeSites.parasaurolophus?.trackPath??null;
}

function habitatVisits(data,plan){
 const terrain=data.terrain,visits={};
 const dryFooting=(x,z,r=3)=>{
  let best=null;
  for(let i=0;i<24;i++)for(const d of [r,r+1,r+2]){
   const a=i*Math.PI/12,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,y=terrain.heightAt(px,pz),f=data.field.sample(px,pz),slope=slopeAt(terrain,px,pz);
   if(y-f[0]<.12||f[1]<.05||slope>.5)continue;
   const score=d+slope*2+Math.abs(y-f[0]-.5)*.12;
   if(!best||score<best.score)best={p:[px,pz],score};
  }
  return best?.p??null;
 };
 const land=plan.plants.filter(p=>p.id==='cycad'||p.id==='fern-cluster').sort((a,b)=>Math.hypot(a.x+760,a.z-8)-Math.hypot(b.x+760,b.z-8))[0];
 if(land){const p=dryFooting(land.x,land.z,2.7);if(p)visits['sample-understory']={id:'sample-understory',title:'林缘苏铁与蕨丛',p,gaze:[land.x,land.ground+land.height*.6,land.z],time:12.6};}
 const margin=plan.plants.filter(p=>p.id==='marsilea').sort((a,b)=>Math.hypot(a.x+744,a.z+33)-Math.hypot(b.x+744,b.z+33))[0];
 if(margin){const p=dryFooting(margin.x,margin.z,2.2);if(p)visits['sample-water-plants']={id:'sample-water-plants',title:'溪岸的四叶水蕨',p,gaze:[margin.x,margin.water+.015,margin.z],time:12.6};}
 const marine=plan.plants.filter(p=>p.id==='halimeda').sort((a,b)=>Math.hypot(a.x+951,a.z-150)-Math.hypot(b.x+951,b.z-150))[0];
 if(marine)visits['sample-sea-plants']={id:'sample-sea-plants',title:'浅海海草与仙掌藻',p:[marine.x+1.6,marine.z+1.0],gaze:[marine.x,marine.ground+marine.height*.7,marine.z],diveLevel:-.7,eyeBelowSurface:Math.max(.9,Math.min(1.7,marine.depth-.55)),time:12.6};
 const print=plan.tracks[Math.floor(plan.tracks.length*.45)];
 if(print){const p=dryFooting(print.x,print.z,2.2);if(p)visits['sample-tracks']={id:'sample-tracks',title:'湿岸上的三趾步迹',p,gaze:[print.x,print.y+.006,print.z],time:12.6};}
 return visits;
}

export class SampleHabitatEnrichment{
 static async create(app,data){
  if(!data.field.continuousSample)return null;
  const entries=await Promise.all(Object.entries(URLS).map(async([id,url])=>[id,await loadGLB(url)]));
  return new SampleHabitatEnrichment(app,data,Object.fromEntries(entries));
 }
 constructor(app,data,models){
  this.group=new Group();this.group.name='Sample fern margins, aquatic plants and dinosaur tracks';
  this.data=data;this.plan=planSampleHabitat(data,app.vegetation?.records??[],readTrackPath(data));
  this.visits=habitatVisits(data,this.plan);
  const kinds=SPECS.map(spec=>({geometry:spec.id==='seagrass'?createSeagrass(mulberry32(281096),0):habitatGeometry(models[spec.id],spec.id),shadow:spec.mode===0}));
  // Native sea grass attributes use native reef meanings; convert colour/AO
  // once to our lean leaf material, keeping its tapered blade geometry.
  const sea=kinds.at(-1).geometry,sp=sea.attributes.position,sd=sea.attributes.aData;
  for(let i=0;i<sp.count;i++){sd.setY(i,0x354b2b);sd.setZ(i,.73+.27*smooth(.01,.12,sp.getY(i)));}
  this.batch=new ReefBatch('Sample Habitat Vault Plants',kinds,{maxInstances:Math.max(1,this.plan.plants.length)});
  this.view=new UniformBlock('SampleHabitatView',{position:['vec3f',new Vector3()]});
  this.material=plantMaterial(this.batch,app.terrainGPU,this.view);
  this.group.add(this.batch.createMesh(this.material,{castShadow:true}));
  for(const [i,p]of this.plan.plants.entries()){
   const half=p.yaw*.5;
   this.batch.data.set([p.x,p.y,p.z,p.scale,0,Math.sin(half),0,Math.cos(half),p.seed,p.range,p.mode,p.height,p.flow[0],p.flow[1],p.flex,p.lift??0],i*16);
  }
  this.batch.upload();
  this.trackMesh=null;
  if(this.plan.tracks.length){
   const geometry=footprintGeometry(models['three-toed-track'],this.plan.tracks,data.terrain),material=app.terrain.material.clone();
   material.name='Terrain-matched shallow dinosaur impressions';material.attributes={aFoot:'vec2f'};material.varyings={vFoot:'vec2f'};material.vertex='o.vFoot=v.aFoot;';
   material.surface+=`\nlet pressed=in.vs.vFoot.x;let age=in.vs.vFoot.y;s.albedo*=1.0-pressed*(.22+age*.18);s.roughness=mix(s.roughness,.66,pressed*.55);s.ao*=1.0-pressed*.16;s.normal=normalize(mix(s.normal,in.N,.72));`;
   const mesh=this.trackMesh=new Mesh(geometry,material);mesh.name='Parasaurolophus-like wet-bank track trail';mesh.castShadow=false;mesh.receiveShadow=true;mesh.staticVelocity=true;this.group.add(mesh);
   let min=Infinity,max=-Infinity;const pos=geometry.attributes.position;
   for(let i=0;i<pos.count;i++){const error=pos.getY(i)-data.terrain.heightAt(pos.getX(i),pos.getZ(i));min=Math.min(min,error);max=Math.max(max,error);}
   this.trackGroundAudit={minimumClearanceMetres:min,maximumClearanceMetres:max,expectedClearanceMetres:[.0018,.01476],meshVertices:pos.count};
  }
  app.scene.add(this.group);data.sampleHabitatEnrichment=this;this.update(0,app.camera);
 }
 update(dt,camera){
  // Also accepts update(camera) for the other local habitat adapters.
  if(!camera)camera=dt;
  const cp=camera.position;this.view.fields.position.value.copy(cp);this.batch.begin();
  for(let i=0;i<this.plan.plants.length;i++){
   const p=this.plan.plants[i];if(Math.hypot(cp.x-p.x,cp.y-p.y,cp.z-p.z)>p.range)continue;
   this.batch.add(p.kind,i);
  }
  this.batch.commit();
  if(this.trackMesh)this.trackMesh.visible=this.plan.tracks.some(p=>Math.hypot(cp.x-p.x,cp.y-p.y,cp.z-p.z)<34);
 }
 stats(){
  const p=this.plan;
  return {sourceRevision:'38ecb2c632dd4d6c23473a51f1d12bff5ea9f7af',plants:p.plants.length,byForm:p.counts,visiblePlants:this.batch.visibleInstances,visibleTriangles:this.batch.visibleTriangles,plantDrawKinds:this.batch.mainOffsets.length,sourceForms:6,nativeSeagrass:true,tracks:p.tracks,trackPath:p.trackPath,trackGroundAudit:this.trackGroundAudit??null,trackTriangles:this.trackMesh?.geometry.index.count/3??0,trackPlacement:'source cavity topology, no substrate slab; terrain-matched 2–15 mm shallow relief; older artistic Parasaurolophus-like hindfoot trail, not current short-step footfalls',submergedPlants:p.plants.filter(x=>x.mode>=2).length,emergentFreshwaterMargins:p.plants.filter(x=>x.mode===1).length,landPlants:p.plants.filter(x=>x.mode===0).length,minSubmergedHeadroom:Math.min(...p.plants.filter(x=>x.mode>=2).map(x=>x.depth-x.height)),maxRootEmbedMetres:.018,maxRootCentreErrorMetres:Math.max(0,...p.plants.map(x=>Math.abs(x.y+.018-this.data.terrain.heightAt(x.x,x.z)))),sites:p.plants.map(x=>({id:x.id,x:x.x,y:x.y,z:x.z,mode:x.mode,depth:x.depth,height:x.height,slope:x.slope,scale:x.scale})),wind:'root-anchored leaf/branch bend with native frame wind and previous-pose velocity; current and swell for submerged plants',rejections:p.rejections};
 }
}
