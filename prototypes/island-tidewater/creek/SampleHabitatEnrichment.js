// Rooted understory, fresh-water margins and shallow marine vegetation.
// Vault source bytes / licence / changes: sample-habitat.lock.json.
import {BufferGeometry,BufferAttribute,Float32BufferAttribute,Group,Mesh,Vector3} from '../vendor/tidewater/src/engine/index.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {uploadHabitatAlbedo} from './VaultEnvironmentAssets.js';
import {createHabitatPlantMaterial} from './HabitatPlantMaterial.js';
import {planFreshwaterMarsilea} from './FreshwaterMarsileaPlan.js';
import {RoamingUnderstory, ROAMING_PLANT_SLOTS} from './RoamingUnderstory.js';
import {planLandUnderstory} from './LandUnderstoryPlan.js';
import {islandEcologyGeometry} from './IslandEcology.js';
import {loadGLB,decodeImage} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {createSeagrass} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const PLANTS = new URL('./assets/habitat-reviewed-plants.glb', import.meta.url);
const TRACK = new URL('./assets/habitat-three-toed-track-vault.glb', import.meta.url);
const SPECS=[
 {id:'cycad',count:44,mode:0,scale:[.55,.92],height:1.3678,bank:[5,23],rise:[.65,12],spacing:2.25,range:38,flex:.34},
 {id:'onoclea',count:114,mode:0,scale:[.44,.86],height:.8818,bank:[.7,14],rise:[.16,9],spacing:1.15,range:32,flex:.72},
 {id:'rush',count:168,mode:0,scale:[.38,.78],height:1.4816,bank:[.25,5.5],rise:[.05,2.2],spacing:.58,range:33,flex:1},
 {id:'marsilea',count:90,mode:1,scale:[1.45,2.65],height:.08491,bank:[-1.8,-.15],spacing:.48,range:24,flex:.8},
 {id:'submerged',count:100,mode:2,scale:[2.3,4.3],height:.15,spacing:.63,range:30,flex:.76},
 {id:'halimeda',count:132,mode:3,scale:[1.4,3.1],height:.15,spacing:.72,range:32,flex:.34},
 {id:'seagrass',count:108,mode:3,scale:[1.15,1.95],height:.32,spacing:1.15,range:34,flex:1},
];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const slopeAt=(terrain,x,z)=>Math.hypot(terrain.heightAt(x+.4,z)-terrain.heightAt(x-.4,z),terrain.heightAt(x,z+.4)-terrain.heightAt(x,z-.4))/.8;
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

// Two broken lobes grow beside each actual reef. The inner, low Halimeda
// occupies coarse sediment by carbonate crust; tall blades root farther out
// in sand. Their two lobes follow the upstream and downstream reef shoulders.
function reefMargins(data){
 const bed=data.sampleBenthicDetails;
 if(!bed?.reefGardens?.length)return [];
 const obstacles=[...bed.coralSites,...bed.spongeSites,...bed.shellSites].map(p=>({x:p.x,z:p.z,r:p.span*.60}));
 for(const p of bed.hardSites)obstacles.push({x:p.x,z:p.z,r:p.scale*.75});
 const gardens=[...bed.reefGardens].sort((a,b)=>a.id.localeCompare(b.id));
 return gardens.flatMap(g=>{
  const route=data.field.continuousSample.nearest(g.x,g.z);
  if(!route)return [];
  const [dx,dz]=route.dir,side=Math.sign(route.across)||1;
  // Limit physical checks to this garden and neighbours that reach its lobes.
  const near=(p,r)=>Math.hypot(p.x-g.x,p.z-g.z)<g.radius+8+r;
  return [{center:g,axis:Math.atan2(-dx*side,dz*side),
   profile:data.landforms.profileFor({kind:'tidal-estuary',x:g.x,z:g.z}),
   gardens:gardens.filter(p=>near(p,p.radius)),obstacles:obstacles.filter(p=>near(p,p.r)),
   corals:bed.coralSites.filter(p=>near(p,p.span))}];
 });
}

// Kept separate from GPU construction so a placement audit uses the exact
// physical terrain and water fields that will later be rendered.
export function planSampleHabitat(data,forestRecords=[],trackPath=null){
 const route=data.field.continuousSample;
 if(!route)return {plants:[],tracks:[],counts:{},rejections:{},trackPath:null};
 const terrain=data.terrain,ground=(x,z)=>terrain.heightAt(x,z),rng=mulberry32(281094);
 const plants=[],counts={},rejections={};
 const nodes=route.points.filter(p=>p.distance>12&&p.distance<665);
 const upperMid=nodes.filter(p=>p.distance>12&&p.distance<445);
 const lower=nodes.filter(p=>p.distance>445);
 const visitorFootings=[[-639.5,-494.5],[-690,-275],[-742,-153],[-651,-478]];
 const nearTrack=(x,z)=>distanceToTrack(x,z,trackPath)<1.6||visitorFootings.some(([vx,vz])=>Math.hypot(x-vx,z-vz)<2.3);
 const margins=reefMargins(data);
 for(const spec of SPECS){
  let made=0,rejected=0;
  const lobes=spec.mode===3?margins.flatMap(margin=>[-1,1].map(side=>({margin,side,roots:0}))):[];
  for(let attempt=0;made<spec.count&&attempt<spec.count*230;attempt++){
   let x,z,r,margin,lobe;
   const scale=spec.scale[0]+rng()*(spec.scale[1]-spec.scale[0]);
   if(spec.mode<3){
    const bankFocus=spec.id==='onoclea'||spec.id==='rush';
    const choices=bankFocus?(rng()<.62?upperMid:lower):(rng()<.73?lower:nodes);
    const p=choices[Math.floor(rng()*choices.length)];
    r=route.nearest(p.x,p.z);
    const side=rng()<.5?-1:1;
    const offset=spec.mode===2?r.width*(.36+rng()*.44):r.width+spec.bank[0]+rng()*(spec.bank[1]-spec.bank[0]);
    x=p.x+r.dir[1]*offset*side+(rng()-.5)*1.7;
    z=p.z-r.dir[0]*offset*side+(rng()-.5)*1.7;
    r=route.nearest(x,z);
   }else{
    if(!lobes.length)break;
    // Give every flow shoulder several chances for its next root before
    // filling an easier one. Obstructed sediment remains empty.
    lobe=lobes[attempt%lobes.length];
    if(lobe.roots>=1+Math.floor(attempt/(lobes.length*6)))continue;
    margin=lobe.margin;
    const algae=spec.id==='halimeda',g=margin.center;
    const angle=margin.axis+lobe.side*(1.68+(rng()-.5)*1.16);
    const reach=g.radius+(algae?.15+rng()*1.85:1.05+rng()*3.65);
    x=g.x+Math.cos(angle)*reach;z=g.z+Math.sin(angle)*reach;r=route.nearest(x,z);
   }
   const y=ground(x,z),wf=data.field.sample(x,z),water=spec.mode===3?route.sea:wf[0],depth=water-y,rise=y-water;
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
    // from the fully submerged narrow-leaf beds and marine plants below.
    invalid ||= depth<.15||depth>.65||wf[1]>.15||r.distance>625||wf[0]<3;
   }else if(spec.mode===2){
    invalid ||= depth<plantHeight+.24||depth>2.8||wf[1]>-.15||Math.abs(r.across)<r.width*.30;
   }else{
    invalid ||= depth<Math.max(1.45,plantHeight+.35)||depth>4.1;
    const algae=spec.id==='halimeda',pad=algae?.25:.75;
    invalid ||= !r||Math.abs(r.across)<Math.max(5,r.width*.30)+pad;
    invalid ||= margin.gardens.some(g=>Math.hypot(g.x-x,g.z-z)<g.radius+.10);
    invalid ||= margin.obstacles.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+pad);
    const bed=data.landforms.sample(margin.profile,x,z);
    invalid ||= bed.marine<.6||bed.depth<=0||bed.sand<(algae?.25:.55);
    const nearCoral=margin.corals.some(p=>Math.hypot(p.x-x,p.z-z)<p.span*.60+(algae?2.7:1.5));
    invalid ||= algae?!nearCoral:nearCoral;
    invalid ||= plants.some(p=>p.mode===3&&p.id!==spec.id&&Math.hypot(p.x-x,p.z-z)<.65);
   }
   // Rooted river plants break into clonal pockets. Offshore the real reef
   // shoulders and upstream/downstream sand openings already separate them.
   if(spec.mode<3)invalid ||= Math.sin(x*.37+Math.sin(z*.19)*1.9)+Math.sin(z*.29-x*.11)<-.92;
   invalid ||= plants.some(p=>p.id===spec.id&&Math.hypot(p.x-x,p.z-z)<spec.spacing);
   if(invalid){rejected++;continue;}
   if(lobe)lobe.roots++;
   plants.push({id:spec.id,kind:SPECS.indexOf(spec),x,z,y:y-.018,ground:y,water,depth,slope,scale,lift,height:plantHeight,mode:spec.mode,range:spec.range,seed:rng(),yaw:rng()*Math.PI*2,flex:spec.flex,flow:spec.mode===2?[wf[2],wf[3]]:[.09,.025]});made++;
  }
  counts[spec.id]=made;rejections[spec.id]=rejected;
 }
 // The registered trail has its own frozen random stream, independent of
 // the number of rejected marine roots or the number of populated reefs.
 const tracks=planTracks(data,trackPath,mulberry32(0xea2c4f91));
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

// All four curated form meshes share one UV atlas. Native blades use its white tile.
function plantGeometry(model, spec) {
 if (spec.id === 'seagrass') {
  const geometry = createSeagrass(mulberry32(281096), 0);
  const positions = geometry.attributes.position, data = geometry.attributes.aData;
  for (let i = 0; i < positions.count; i++) {
   data.setY(i, 0x354b2b);
   data.setZ(i, .73 + .27 * smooth(.01, .12, positions.getY(i)));
  }
  return geometry;
 }
 if (spec.id === 'rush' || spec.id === 'submerged') {
  const geometry = islandEcologyGeometry(spec.id, 0, spec.id === 'rush' ? 281097 : 281098);
  geometry.computeBoundingBox();
  const scale = spec.height / geometry.boundingBox.max.y;
  geometry.scale(scale, scale, scale);
  return geometry;
 }
 const node = model.nodes.find(n => n.name === spec.id);
 const primitive = model.meshes[node.mesh][0], attributes = primitive.attributes;
 const geometry = new BufferGeometry();
 geometry.setAttribute('position',new BufferAttribute(attributes.POSITION.array,3));
 geometry.setAttribute('normal',new BufferAttribute(attributes.NORMAL.array,3));
 geometry.setAttribute('uv',new BufferAttribute(attributes.TEXCOORD_0.array,2));
 geometry.setIndex(new BufferAttribute(primitive.indices,1));
 const positions = geometry.attributes.position, data = new Float32Array(positions.count * 4);
 for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
  const growth = spec.id === 'cycad' ? clamp((Math.hypot(x,z)-.18)/.92,0,1) : clamp(y/spec.height,0,1);
  data.set([growth,0xffffff,.72+.28*smooth(.01,.16,y),.5+.5*Math.sin(x*5+z*7)],i*4);
 }
 geometry.setAttribute('aData',new BufferAttribute(data,4));
 return geometry;
}

async function plantTexture(model) {
 const image = model.images[model.textures[model.materials[0].pbrMetallicRoughness.baseColorTexture.index].source];
 const px = await decodeImage(image.bytes,image.mimeType);
 return uploadHabitatAlbedo('Sample foliage albedo', px);
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

function plantObservation(data, plan, app, species, near, companion) {
 const marine=species==='halimeda', shore=species==='marsilea';
 const distanceFromAnchor=p=>Math.hypot(p.x-near[0],p.z-near[1]);
 const plants=plan.plants.filter(p=>p.id===species);
 // Consider several planted patches near this stop. Larger crowns at a similar distance
 // from the original observation site read better at a visitor's standing eye height.
 const rank=p=>distanceFromAnchor(p)-p.scale*(shore?7:10);
 plants.sort((a,b)=>rank(a)-rank(b));
 let best=null;
 for(const plant of plants.slice(0,8)){
  const foliage=plan.plants.filter(p=>p!==plant&&Math.hypot(p.x-plant.x,p.z-plant.z)<6);
  const stems=(app.landscapeDetails?.records??[]).filter(p=>Math.hypot(p.x-plant.x,p.z-plant.z)<4);
  const gazeY=shore?plant.ground+plant.height-.025:plant.ground+plant.height*.59;
  const radius=marine?(.72+plant.height*.6):shore?.78:1.25+plant.height*.78;
  for(let i=0;i<16;i++){
   const angle=i*Math.PI/8,dx=Math.cos(angle),dz=Math.sin(angle);
   const x=plant.x+radius*dx,z=plant.z+radius*dz,floor=data.terrain.heightAt(x,z);
   const water=data.field.sample(x,z)[0];
   if(marine ? water-floor<.95 : floor-water<(shore?-.36:.09)||slopeAt(data.terrain,x,z)>.63)continue;
   const eye=marine?Math.max(floor+.55,gazeY+.32):floor+1.62;
   if(marine&&eye>plant.water-.45)continue;
   const ray=new Vector3(plant.x-x,gazeY-eye,plant.z-z),length=ray.length();
   if(app.colliders?.sightDistance(new Vector3(x,eye,z),ray.multiplyScalar(1/length),length)<length-.02)continue;
   if([.2,.4,.65,.82].some(t=>data.terrain.heightAt(x-t*radius*dx,z-t*radius*dz)>eye+t*(gazeY-eye)-.015))continue;
   // A tall, uncollidable clump can fill the camera even when the terrain is clear.
   const blocks=(p,top,width)=>{
    const along=(p.x-plant.x)*dx+(p.z-plant.z)*dz;
    if(along<.01||along>radius+.2)return false;
    const side=Math.abs((p.x-plant.x)*dz-(p.z-plant.z)*dx);
    return side<width&&top>gazeY+(eye-gazeY)*along/radius-.12;
   };
   if(stems.some(p=>blocks(p,p.y+p.s*1.8,.30*p.s))||
      foliage.some(p=>blocks(p,p.ground+p.height,Math.min(.7,p.height*.39))))continue;
   const companionDistance=Math.min(4,...foliage.filter(p=>p.id===companion&&
    (p.x-plant.x)*dx+(p.z-plant.z)*dz<.35).map(p=>Math.hypot(p.x-plant.x,p.z-plant.z)));
   const score=length/(shore?plant.scale*.10:plant.height)+distanceFromAnchor(plant)*.025+
    companionDistance*(shore?.08:.32);
   if(!best||score<best.score)best={score,p:[x,z],gaze:[plant.x,gazeY,plant.z],
    ...(marine?{diveLevel:plant.water,eyeBelowSurface:plant.water-eye}:{})};
  }
 }
 if(!best)return null;
 const {score,...view}=best;
 return view;
}

function habitatVisits(data,plan,app){
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
 for(const [id,title,species,anchor,companion] of [
  ['sample-understory','林缘苏铁与蕨丛','cycad',[-760,8],'onoclea'],
  ['sample-water-plants','溪岸的四叶水蕨','marsilea',[-744,-33],'marsilea'],
  ['sample-sea-plants','浅海海草与仙掌藻','halimeda',[-946,152],'seagrass'],
 ]){
  const view=plantObservation(data,plan,app,species,anchor,companion);
  if(view)visits[id]={id,title,...view,time:12.6};
 }
 const print=plan.tracks[Math.floor(plan.tracks.length*.45)];
 if(print){const p=dryFooting(print.x,print.z,2.2);if(p)visits['sample-tracks']={id:'sample-tracks',title:'湿岸上的三趾步迹',p,gaze:[print.x,print.y+.006,print.z],time:12.6};}
 return visits;
}

function writePlantRecord(batch, index, p) {
 const half=p.yaw*.5;
 batch.data.set([p.x,p.y,p.z,p.scale,0,Math.sin(half),0,Math.cos(half),p.seed,p.range,p.mode,p.height,p.flow[0],p.flow[1],p.flex,p.lift??0],index*16);
}

export class SampleHabitatEnrichment{
 static async create(app,data){
  if(!data.field.continuousSample)return null;
  const [model, track] = await Promise.all([loadGLB(PLANTS), loadGLB(TRACK)]);
  const atlas = await plantTexture(model);
  try {
   return new SampleHabitatEnrichment(app,data,model,track,atlas);
  } catch (error) {
   atlas.destroy();
   throw error;
  }
 }
 constructor(app,data,model,track,atlas){
  this.atlas=atlas;
  this.group=new Group();this.group.name='Sample fern margins, aquatic plants and dinosaur tracks';
  this.data=data;this.plan=planSampleHabitat(data,app.vegetation?.records??[],readTrackPath(data));
  this.visits=habitatVisits(data,this.plan,app);
  this.landUnderstory=planLandUnderstory(data,app,SPECS);
  this.freshwaterMarsilea=planFreshwaterMarsilea(data,app.islandVisits,SPECS);
  this.plants=[...this.plan.plants,...this.landUnderstory.plants,...this.freshwaterMarsilea];
  this.roamingUnderstory=new RoamingUnderstory(data,app,SPECS);
  const kinds=SPECS.map(spec=>({geometry:plantGeometry(model,spec),shadow:spec.mode===0}));
  this.batch=new ReefBatch('Sample Habitat Vault Plants',kinds,{maxInstances:this.plants.length+ROAMING_PLANT_SLOTS});
  const uv=new Float32Array(this.batch.vertexCount*2);
  let offset=0;
  for(const {geometry} of kinds){
   const n=geometry.attributes.position.count;
   if(geometry.attributes.uv)uv.set(geometry.attributes.uv.array,offset);
   else for(let i=0;i<n;i++){uv[offset+i*2]=.875;uv[offset+i*2+1]=.75;}
   offset+=n*2;
  }
  this.batch.geometry.setAttribute('uv',new BufferAttribute(uv,2));
  this.view=new UniformBlock('SampleHabitatView',{position:['vec3f',new Vector3()]});
  this.material=createHabitatPlantMaterial(this.batch,app.terrainGPU,this.view,{atlas});
  this.group.add(this.batch.createMesh(this.material,{castShadow:true}));
  this.plantCells=new Map();
  this.plantCellSize=Math.max(...SPECS.map(spec=>spec.range));
  for(const [i,p]of this.plants.entries()){
   const cell=Math.floor(p.x/this.plantCellSize)+','+Math.floor(p.z/this.plantCellSize);
   if(!this.plantCells.has(cell))this.plantCells.set(cell,[]);
   this.plantCells.get(cell).push(i);
   writePlantRecord(this.batch,i,p);
  }
  this.batch.upload();
  this.trackMesh=null;
  if(this.plan.tracks.length){
   const geometry=footprintGeometry(track,this.plan.tracks,data.terrain),material=app.terrain.material.clone();
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
  const cx=Math.floor(cp.x/this.plantCellSize),cz=Math.floor(cp.z/this.plantCellSize);
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
   const nearby=this.plantCells.get((cx+dx)+','+(cz+dz));
   if(!nearby)continue;
   for(const i of nearby){
    const p=this.plants[i];
    if((cp.x-p.x)**2+(cp.y-p.y)**2+(cp.z-p.z)**2<=p.range*p.range)this.batch.add(p.kind,i);
   }
  }
  this.roamingUnderstory.update(cp,this.batch,this.plants.length,writePlantRecord);
  this.batch.commit();
  if(this.trackMesh)this.trackMesh.visible=this.plan.tracks.some(p=>Math.hypot(cp.x-p.x,cp.y-p.y,cp.z-p.z)<34);
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;
  this.group.removeFromParent();
  this.batch.dispose();
  this.material.uniformBlock.buffer?.destroy();
  this.material.dispose();
  this.view.buffer?.destroy();
  this.atlas.destroy();
  if(this.trackMesh){
   this.trackMesh.geometry.dispose();
   this.trackMesh.material.uniformBlock.buffer?.destroy();
   this.trackMesh.material.dispose();
  }
 }
 stats(){
  const p=this.plan;
  return {sourceRevision:'b213afa4b401bc5ae9f29a4c3fff8187d2a71142',plants:p.plants.length,landUnderstory:this.landUnderstory.counts,roamingUnderstory:{visible:this.roamingUnderstory.visible,triangles:this.roamingUnderstory.triangles,slots:ROAMING_PLANT_SLOTS,cellsBuilt:this.roamingUnderstory.cellsBuilt},freshwaterMarsilea:this.freshwaterMarsilea.length,byForm:p.counts,visiblePlants:this.batch.visibleInstances,visibleTriangles:this.batch.visibleTriangles,plantDrawKinds:this.batch.mainOffsets.length,sourceForms:4,nativeSeagrass:true,tracks:p.tracks,trackPath:p.trackPath,trackGroundAudit:this.trackGroundAudit??null,trackTriangles:this.trackMesh?.geometry.index.count/3??0,trackPlacement:'source cavity topology, no substrate slab; terrain-matched 2–15 mm shallow relief; older artistic Parasaurolophus-like hindfoot trail, not current short-step footfalls',submergedPlants:p.plants.filter(x=>x.mode>=2).length,emergentFreshwaterMargins:p.plants.filter(x=>x.mode===1).length,landPlants:p.plants.filter(x=>x.mode===0).length,minSubmergedHeadroom:Math.min(...p.plants.filter(x=>x.mode>=2).map(x=>x.depth-x.height)),maxRootEmbedMetres:.018,maxRootCentreErrorMetres:Math.max(0,...p.plants.map(x=>Math.abs(x.y+.018-this.data.terrain.heightAt(x.x,x.z)))),sites:p.plants.map(x=>({id:x.id,x:x.x,y:x.y,z:x.z,mode:x.mode,depth:x.depth,height:x.height,slope:x.slope,scale:x.scale})),wind:'root-anchored leaf/branch bend with native frame wind and previous-pose velocity; current and swell for submerged plants',rejections:p.rejections};
 }
}
