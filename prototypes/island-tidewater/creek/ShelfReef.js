// Museum-authored patch-reef composition, using Tidewater's MIT procedural
// geometry, batched LODs and underwater material. Morphological proxies, not
// a claim that modern Caribbean taxa reconstruct every prehistoric period.
import {Group,Vector3,Quaternion,Matrix4,Frustum,Sphere} from '../vendor/tidewater/src/engine/index.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import * as Geo from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {createReefMaterials,createReefView,SURFACE} from '../vendor/tidewater/src/world/reef/ReefMaterials.js';
import {createNoiseVolume} from '../vendor/tidewater/src/world/reef/ReefNoise.js';
import {setRefractionFrustum} from './RefractionFrustum.js';

const forms=[
 {name:'framework',surface:SURFACE.rock,gen:(r,l)=>Geo.createMound(r,l,'slab'),palette:[0x877c69,0x99917a]},
 {name:'mound-coral',surface:SURFACE.porites,gen:Geo.createDome,palette:[0x9f926f,0x787857]},
 {name:'plate-coral',surface:SURFACE.plate,gen:Geo.createPlates,palette:[0x957c69,0xb0a38c]},
 {name:'finger-coral',surface:SURFACE.finger,gen:Geo.createFingers,palette:[0x9c856f,0xb9b096]},
 {name:'rubble',surface:SURFACE.rubble,gen:Geo.createRubble,palette:[0x9e9786,0x92917e]},
];

export class ShelfReef{
 constructor(app,data){
  this.items=[];this.obstacles=[];this.sites=[];this.trackingColonies=[];this.enabled=true;this.group=new Group();this.group.name='Museum shelf patch reefs';
  this.terrain=data.terrain;const rng=mulberry32(51873),kinds=[];
  this.models=forms.map((form,i)=>{
   const start=kinds.length;let geometry;
   for(let lod=0;lod<3;lod++){const g=form.gen(mulberry32(7319+i*179),lod);kinds.push({geometry:g});if(!lod)geometry=g;}
   const proxy=kinds.length;kinds.push({geometry:form.gen(mulberry32(7319+i*179),2),shadow:true,shadowOnly:true});
   return {...form,start,proxy,geometry};
  });
  const up=new Vector3(0,1,0),p=new Vector3(),q=new Quaternion(),matrix=new Matrix4();
  for(const [sector,site] of data.cove.continuous.divingSites.entries()){
   const before=this.items.length,center=site.point,local=[];
   // North-facing cold shores favour exposed framework and rubble; the
   // sheltered east/south have denser colonies. Sand gaps remain between them.
   const warm=[0,1,2,7].includes(sector),target=warm?42:27;
   // Cluster colonies into 3–4 natural reef bommies with open sand channels between them.
   const coreCount=warm?4:3,cores=[];
   for(let c=0;c<coreCount;c++){
    const baseAngle=(c/coreCount)*Math.PI*2+rng()*.65;
    for(let tries=0;tries<18;tries++){
     const ca=baseAngle+(rng()-.5)*.45,cr=6.5+rng()*8.5;
     const cx=center[0]+Math.cos(ca)*cr,cz=center[1]+Math.sin(ca)*cr;
     const cf=this.terrain.heightAt(cx,cz),cd=-.7-cf;
     if(cd<2.2||cd>9.2||data.cove.continuous.marineAt(cx,cz)<.82)continue;
     if(cores.some(k=>Math.hypot(k.x-cx,k.z-cz)<5.8))continue;
     cores.push({x:cx,z:cz,angle:ca});break;
    }
   }
   for(let attempt=0;attempt<target*16&&this.items.length-before<target;attempt++){
    const placed=this.items.length-before;
    const core=cores.length?cores[attempt%cores.length]:{x:center[0],z:center[1],angle:rng()*Math.PI*2};
    const isCoreFramework=placed<cores.length;
    const type=isCoreFramework?0:!warm?(rng()<.36?0:4):rng()<.14?0:rng()<.22?4:1+Math.floor(rng()*3),model=this.models[type];
    const angle=rng()*Math.PI*2;
    const r=isCoreFramework?rng()*1.2:type===4?2.0+rng()*2.6:Math.pow(rng(),1.35)*(type===0?2.4:3.3);
    const x=core.x+Math.cos(angle)*r,z=core.z+Math.sin(angle)*r;
    const floor=this.terrain.heightAt(x,z),depth=-.7-floor;if(depth<2.1||depth>9.5||data.cove.continuous.marineAt(x,z)<.8)continue;
    if((app.coveRocks.instances??[]).some(rock=>Math.hypot(x-rock.x,z-rock.z)<rock.footRadius*.86+1.0))continue;
    const s=type===0?1.15+rng()*1.35:type===4?.45+rng()*.52:.58+rng()*.68;
    const spacing=type===0?1.85:type===4?.72:.78;if(local.some(a=>Math.hypot(x-a.x,z-a.z)<spacing+a.radius*.36))continue;
    const sy=type===0?.38+rng()*.24:.7+rng()*.4,sx=.8+rng()*.45,sz=.8+rng()*.45;
    const normal=new Vector3(this.terrain.heightAt(x-.5,z)-this.terrain.heightAt(x+.5,z),1,this.terrain.heightAt(x,z-.5)-this.terrain.heightAt(x,z+.5));normal.normalize().lerp(up,.4).normalize();
    q.setFromUnitVectors(up,normal).multiply(new Quaternion().setFromAxisAngle(up,rng()*Math.PI*2));
    let y=floor-(type===0?.14:.09);for(let a=0;a<6;a++)y=Math.min(y,this.terrain.heightAt(x+Math.cos(a)*s*.7,z+Math.sin(a)*s*.7)-.05);
    matrix.compose(new Vector3(x,y,z),q,new Vector3(s*sx,s*sy,s*sz));
    let top=-Infinity,bottom=Infinity,radius=0;const positions=model.geometry.attributes.position;
    for(let v=0;v<positions.count;v++){p.set(positions.getX(v),positions.getY(v),positions.getZ(v)).applyMatrix4(matrix);top=Math.max(top,p.y);bottom=Math.min(bottom,p.y);radius=Math.max(radius,Math.hypot(p.x-x,p.z-z));}
    // Keep all living forms well below mean sea, including their real bounds.
    if(top> -1.65){const sink=top+1.65;y-=sink;bottom-=sink;top=-1.65;}
    const item={id:this.items.length,x,y,z,s,sx,sy,sz,q:q.clone(),type,model,top,bottom,radius,range:type===0?110:45,seed:rng(),site:site.id};
    local.push(item);this.items.push(item);
    if(radius>.4){const solid={...item,size:radius,footRadius:radius};this.obstacles.push(solid);item.collider=app.colliders.addCylinder(x,z,radius*.8,bottom,top,{tag:'submerged reef'});}
   }
   this.sites.push({id:site.id,center,count:this.items.length-before,warm});
  }
  this.batch=new ReefBatch('Museum reef',kinds,{maxInstances:Math.max(1,this.items.length),fade:true});
  this.view=createReefView();this.view.fields.position.value=new Vector3();
  const noise=createNoiseVolume(),options={hard:this.batch,soft:this.batch,getOcean:()=>app.fft,noise,view:this.view};
  this.material=createReefMaterials(options).hard;this.fadeMaterial=createReefMaterials({...options,fade:true}).hard;
  this.group.add(this.batch.createMesh(this.material,{castShadow:true}),this.batch.createFadeMesh(this.fadeMaterial));
  for(let i=0;i<this.items.length;i++){
   const r=this.items[i];this.batch.data.set([r.x,r.y,r.z,r.s,...r.q.toArray(),...r.model.palette,r.range+r.seed,r.model.surface,r.sx,r.sy,r.sz,0],i*16);
  }
  data.reefObservations=['shelf-east','shelf-south','shelf-northeast'].flatMap(id=>{
   const site=data.cove.continuous.divingSites.find(s=>s.id===id),p=site.point,dx=site.gaze[0]-p[0],dz=site.gaze[2]-p[1];
   const candidates=this.items.filter(r=>r.site===id&&r.type>0&&r.type<4);
   const score=r=>Math.hypot(r.x-p[0],r.z-p[1])+Math.max(0,(r.x-p[0])*dx+(r.z-p[1])*dz)*.5;
   const r=candidates.sort((a,b)=>score(a)-score(b))[0];if(!r)return [];
   let arrival=p;const angle=Math.atan2(p[1]-r.z,p[0]-r.x),distance=r.radius+2.2;
   for(const offset of [0,.4,-.4,.8,-.8,1.2,-1.2]){
    const x=r.x+Math.cos(angle+offset)*distance,z=r.z+Math.sin(angle+offset)*distance;
    if(this.terrain.heightAt(x,z)>-3.3||this.obstacles.some(b=>Math.hypot(x-b.x,z-b.z)<b.radius*.8+1)||app.coveRocks.instances.some(b=>Math.hypot(x-b.x,z-b.z)<b.footRadius*.72+1))continue;
    arrival=[x,z];break;
   }
   return [{id:'reef-'+id.slice(6),p:arrival,gaze:[r.x,(r.top+r.bottom)*.5,r.z],colony:{type:r.model.name,top:r.top,bottom:r.bottom}}];
  });
  this.batch.upload();app.scene.add(this.group);this.frustum=new Frustum();this.refractionFrustum=new Frustum();this.vp=new Matrix4();this.sphere=new Sphere();this.update(app.camera);
 }
 update(camera){
  const cp=camera.position,range=cp.y<.3?45:Math.min(110,35+Math.max(0,cp.y)*1.4);
  this.view.fields.position.value.copy(cp);this.view.fields.range.value=range;camera.updateMatrixWorld();this.vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.vp,camera.coordinateSystem,camera.reversedDepth);setRefractionFrustum(this.refractionFrustum,camera,this.vp);
  this.batch.begin();this.visible=0;this.visibleTypes={};this.trackingColonies.length=0;
  if(this.enabled)for(let i=0;i<this.items.length;i++){
   const r=this.items[i],d=Math.hypot(cp.x-r.x,cp.y-r.y,cp.z-r.z),max=Math.min(range,r.range);
   if(d>max+r.radius)continue;
   if(d<22&&r.radius>.6)this.batch.add(r.model.proxy,i);
   this.sphere.center.set(r.x,(r.top+r.bottom)*.5,r.z);this.sphere.radius=r.radius+Math.max(0,r.top-r.y);
   const visible=this.frustum.intersectsSphere(this.sphere);
   if(r.type>0&&r.type<4&&d<max){r.trackingVisible=visible;this.trackingColonies.push(r);}
   if(!visible&&!this.refractionFrustum.intersectsSphere(this.sphere))continue;
   const d0=Math.max(5,r.radius*7),d1=Math.max(17,r.radius*19),lod=d<d0?0:d<d1?1:2,kind=r.model.start+lod;
   if(d>max*.85)this.batch.addFade(kind,i,Math.max(0,(max-d)/(max*.15)),false);
   else if(lod<2&&d>(lod?d1:d0)*.88){const fade=(d/(lod?d1:d0)-.88)/.12;this.batch.addFade(kind,i,fade,true);this.batch.addFade(kind+1,i,fade,false);}
   else this.batch.add(kind,i);
   this.visible++;this.visibleTypes[r.model.name]=(this.visibleTypes[r.model.name]??0)+1;
  }
  this.batch.commit();
 }
 stats(){return {enabled:this.enabled,instances:this.items.length,sites:this.sites,visible:this.visible,visibleTypes:this.visibleTypes,triangles:this.batch.visibleTriangles,shadowTriangles:this.batch.shadowTriangles,forms:forms.map(f=>f.name),minSurfaceClearance:Math.min(...this.items.map(r=>-.7-r.top)),budget:'native opaque ReefBatch, three same-seed LODs,45m colonies/110m framework,22m low shadow proxies; fixed world anchors',palaeoScope:'morphological environmental proxies; no species/period reconstruction claim'};}
}
