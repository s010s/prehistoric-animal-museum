// Small, world-anchored environmental life. Native Tidewater fish/bird drawing
// and articulation; our hydrology, habitat placement, routes and shrimp form.
import {Group,Vector3,Quaternion,Euler,Matrix4,Frustum,Sphere,SphereGeometry,CylinderGeometry,Float32BufferAttribute} from '../vendor/tidewater/src/engine/index.js';
import {mergeGeometries} from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {fishGeometry} from '../vendor/tidewater/src/world/fish/FishGeometry.js';
import {SPECIES} from '../vendor/tidewater/src/world/fish/FishSpecies.js';
import {createSwimMaterial} from '../vendor/tidewater/src/world/fish/FishMaterial.js';
import {BirdBatch} from '../vendor/tidewater/src/world/wildlife/BirdBatch.js';
import {Flyer} from '../vendor/tidewater/src/world/wildlife/Flight.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

function shrimpGeometry(){
 const parts=[],up=new Vector3(0,1,0);
 for(let i=0;i<7;i++){const g=new SphereGeometry(1,6,4),z=.36-i*.105,r=.11-i*.007;g.scale(r,r*.75,.10);g.translate(0,.08+Math.sin(i/6*Math.PI)*.06,z);parts.push(g);}
 for(let side of [-1,1]){
  for(let i=0;i<5;i++){const a=new Vector3(side*.07,.09,.25-i*.11),b=new Vector3(side*(.21+i*.006),-.015,.17-i*.12),d=b.clone().sub(a),g=new CylinderGeometry(.007,.009,d.length(),3);g.applyQuaternion(new Quaternion().setFromUnitVectors(up,d.clone().normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());parts.push(g);}
  for(let i=0;i<2;i++){const a=new Vector3(side*.04,.12,.40),b=new Vector3(side*(.14+i*.03),.14-i*.06,.88+i*.12),d=b.clone().sub(a),g=new CylinderGeometry(.002,.005,d.length(),3);g.applyQuaternion(new Quaternion().setFromUnitVectors(up,d.clone().normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());parts.push(g);}
  const eye=new SphereGeometry(.018,5,4);eye.translate(side*.08,.17,.4);parts.push(eye);
 }
 const tail=new SphereGeometry(1,5,3);tail.scale(.17,.017,.12);tail.translate(0,.045,-.34);parts.push(tail);
 const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());const p=g.attributes.position,a=new Float32Array(p.count*4);for(let i=0;i<p.count;i++)a.set([Math.max(0,Math.min(1,.5-p.getZ(i))),0,0,0],i*4);g.setAttribute('aData',new Float32BufferAttribute(a,4));return g;
}

export class IslandLife{
 constructor({app,data,visits}){
  this.app=app;this.data=data;this.terrain=data.terrain;this.query=app.query;this.time=0;this.groups=[];this.fish=[];this.birds=[];this.audit={fleeFrames:0,fleeAwayFrames:0,obstacleDeflections:0,maxPanic:0,violations:0,minBedClearance:Infinity,minSurfaceClearance:Infinity,birdCorrections:0,minBirdGroundClearance:Infinity};this.group=new Group();this.group.name='Museum environmental life';const rng=mulberry32(440213);
  // Habitat and visitor arrival are designed together. Keep native short draw
  // ranges; moving the lake school sixty metres away defeats a normal shore walk.
  const seaLevel=-.7,seaExposure=[0,0,0,0];
  const breakDepth=(x,z)=>{app.shoreField.sampleAt(x,z,seaExposure);const e=Math.min(1,Math.hypot(seaExposure[1],seaExposure[2]));return Math.pow(.42*1.3*e*3.556/.78,.8);};
  this.breakDepth=breakDepth;
  const wetNear=(cx,cz,{min=.65,max=6,target=1.2,radius=30,step=1.5,sea=false}={})=>{let best=null;for(let dz=-radius;dz<=radius;dz+=step)for(let dx=-radius;dx<=radius;dx+=step){const x=cx+dx,z=cz+dz,h=sea?seaLevel:this.query.height(x,z),floor=this.terrain.heightAt(x,z),depth=h-floor;if(depth<min||depth>max||sea&&depth<breakDepth(x,z)+.55)continue;if(sea){let fits=true;for(let a=0;a<8;a++){const px=x+Math.cos(a*Math.PI/4)*3.5,pz=z+Math.sin(a*Math.PI/4)*3.5,d=h-this.terrain.heightAt(px,pz);if(d<Math.max(1.5,breakDepth(px,pz)+.4)){fits=false;break;}}if(!fits)continue;}const score=Math.hypot(dx,dz)+Math.abs(depth-target)*3;if(!best||score<best.score)best={x,z,h,floor,score};}return best;};
  const lakePoint=id=>{const v=visits[id],b=v.water,dx=b.center[0]-v.p[0],dz=b.center[1]-v.p[1],l=Math.hypot(dx,dz);return {x:v.p[0]+dx/l*10,z:v.p[1]+dz/l*10};};
  const westCenter=data.cove.shelves[0].at(0,175),eastCenter=data.cove.shelves[1].at(0,175);
  const specs=[['creek',{x:-27,z:0},18,.14,.9,{min:.65,max:2,radius:26}],['west-sea',{x:westCenter[0],z:westCenter[1]},36,.23,4,{min:1.8,max:7,target:3.5,radius:90,sea:true}],['lake',lakePoint('lake'),28,.18,2,{min:.7,max:3,radius:25}],['tarn',lakePoint('highland-lake'),18,.16,1.8,{min:.7,max:3,radius:25}],['wetland',{x:visits.wetland.p[0]+15,z:visits.wetland.p[1]+12},20,.13,1.3,{min:.55,max:3,radius:180,step:3}],['east-sea',{x:eastCenter[0],z:eastCenter[1]},40,.24,4.5,{min:1.8,max:7,target:3.5,radius:90,sea:true}]];
  if(data.field.continuousSample)specs.push(['sample-pool',{x:-656,z:-482},12,.11,.62,{min:.55,max:1.4,target:.8,radius:3,step:.25}],['sample-sea',{x:-966,z:146},24,.19,3,{min:2.2,max:5,target:3.1,radius:16,step:1,sea:true}]);
  for(const shelf of data.cove.shelves){for(const a of [-.48,.4]){const p=shelf.at(a*shelf.along,150);specs.push([shelf.id+'-'+a,{x:p[0],z:p[1]},24,.24,5,{min:1.8,max:7,target:3.5,radius:75,step:3,sea:true}]);}}
  for(const site of data.cove.continuous.divingSites){specs.push([site.id+'-life',{x:site.point[0],z:site.point[1]},22,.22,4,{min:2.2,max:9,target:3.8,radius:45,step:2,sea:true}]);}
  for(const [id,p,count,length,radius,search] of specs){const c=wetNear(p.x,p.z,search);if(!c)continue;const g={id,...c,sea:!!search.sea,radius,first:this.fish.length,count};this.groups.push(g);for(let i=0;i<count;i++)this.fish.push({group:g,phase:rng()*Math.PI*2,slot:rng()*6.283,spread:.25+rng()*.75,depth:.35+rng()*.6,L:length*(.8+rng()*.5),p:new Vector3(c.x,Math.max(c.floor+.15,c.h-.6),c.z),previous:new Vector3(),fresh:true,sleeping:true,velocity:new Vector3(),panic:0,yaw:rng()*6.283,morph:i%5===0?1:0,seed:rng(),shrimp:false});}
  for(const [id,x,z,radius,step]of [['creek-shrimp',-26,0,30,1],...(data.field.continuousSample?[['sample-shrimp',-661,-477,5,.25]]:[])]){
   const shallow=wetNear(x,z,{min:.38,max:.8,target:.55,radius,step});if(!shallow)continue;const g={...shallow,id,first:this.fish.length,count:10,radius:.4};this.groups.push(g);for(let i=0;i<10;i++)this.fish.push({group:g,phase:rng()*6.283,slot:rng()*6.283,spread:.4+rng()*.5,depth:1,L:.09+rng()*.025,p:new Vector3(g.x,g.floor+.04,g.z),previous:new Vector3(),fresh:true,sleeping:true,velocity:new Vector3(),panic:0,yaw:rng()*6.283,morph:0,seed:rng(),shrimp:true});
  }
  data.lifeObservations={shrimp:this.groups.find(g=>g.id==='creek-shrimp'),west:this.groups.find(g=>g.id==='west-sea')};
  data.sampleLife={shrimp:this.groups.find(g=>g.id==='sample-shrimp'),pool:this.groups.find(g=>g.id==='sample-pool'),sea:this.groups.find(g=>g.id==='sample-sea')};
  for(const g of this.groups)g.obstacles=[...(app.coveRocks?.instances??[]),...(app.shelfReef?.obstacles??[])].filter(r=>Math.hypot(r.x-g.x,r.z-g.z)<g.radius+12);
  const kinds=[SPECIES.silverside,SPECIES.mullet].flatMap(species=>[0,1,2,3].map(lod=>({geometry:fishGeometry(species,{lod,pose:'swim'}),shadow:false})));kinds.push({geometry:shrimpGeometry(),shadow:false});
  this.batch=new ReefBatch('Museum life',kinds,{maxInstances:Math.max(1,this.fish.length),dynamic:true,fade:true});
  this.material=createSwimMaterial(this.batch);this.fadeMaterial=createSwimMaterial(this.batch,{fade:true});
  for(const m of [this.material,this.fadeMaterial])m.surface+=`\nif(in.vs.vFishInfo.x<90.0&&fishPartOf(in.vs.vFishData)<7.5){s.albedo*=vec3f(.72,.82,.78);s.metalness*=.55;s.roughness=max(s.roughness,.46);s.specularIntensity=.10;}\nif(in.vs.vFishInfo.x>90.0){s.albedo=vec3f(.095,.082,.061)*(0.80+in.vs.vFishInfo.y*.25);s.roughness=.8;s.specularIntensity=.24;s.metalness=0.0;}`;
  this.group.add(this.batch.createMesh(this.material,{castShadow:false}),this.batch.createFadeMesh(this.fadeMaterial));
  this.birdBatch=new BirdBatch({csm:app.csm,capacity:48});this.birdBatch.mesh.castShadow=false;this.group.add(this.birdBatch.mesh);
  const anchors=[{id:'west-sea',p:[data.coast.coast.x-26,data.coast.coast.z+7],height:7.5,radius:22,count:4},{id:'east-sea',p:[visits['east-bay'].p[0]-28,visits['east-bay'].p[1]-20],height:12,radius:32,count:4}];
  if(data.field.continuousSample)anchors.push({id:'sample-mouth',p:[-884,137],height:7.5,radius:21,count:2});
  for(const a of anchors)for(let i=0;i<a.count;i++){const f=new Flyer(i%2,Math.floor(rng()*65535),rng),phase=i/a.count*6.283+.3,radius=a.radius+rng()*8,x=a.p[0]+Math.cos(phase)*radius,z=a.p[1]+Math.sin(phase)*radius;f.place(x,Math.max(this.terrain.heightAt(x,z),-.7)+a.height+i*.6,z,-phase);this.birds.push({id:a.id+'-'+i,kind:i%2?'tern':'gull',anchor:a,flyer:f,phase,radius,scale:f.P.scale,active:false});}
  // Modern seabird shapes stay at the sea. Forest calls use actual tree perches;
  // a later region review can add its own appropriate visible forest wildlife.
  app.scene.add(this.group);this.q=new Quaternion();this.euler=new Euler(0,0,0,'YXZ');this.frustum=new Frustum();this.viewProjection=new Matrix4();this.sphere=new Sphere();this.screen=new Vector3();this.frameSight={fish:[],shrimp:[],birds:[]};this.enabled=true;this.update(0,app.camera);
 }
 update(dt,camera){
  this.time+=dt;const cp=camera.position,D=this.batch.data;camera.updateMatrixWorld();this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.viewProjection,camera.coordinateSystem,camera.reversedDepth);this.pxScale=camera.projectionMatrix.elements[5]*this.app.engine.height*.5;this.frameSight={fish:[],shrimp:[],birds:[]};this.batch.begin();let live=0,shrimp=0;this.audit.minBedClearance=Infinity;this.audit.minSurfaceClearance=Infinity;
  for(let i=0;i<this.fish.length;i++){
   const f=this.fish[i],g=f.group,dist=Math.hypot(cp.x-g.x,cp.z-g.z);if(!this.enabled||dist>65||cp.y>g.h+8){f.fresh=true;f.sleeping=true;continue;}
   f.previous.copy(f.p);this.advance(f,Math.min(dt,.1),cp);const {x,y,z}=f.p,h=g.sea?g.h:this.query.height(x,z),floor=this.terrain.heightAt(x,z),panic=f.panic;

   const clear=y-floor,top=h-y;this.audit.minBedClearance=Math.min(this.audit.minBedClearance,clear);this.audit.minSurfaceClearance=Math.min(this.audit.minSurfaceClearance,top);if(clear<0||top<0)this.audit.violations++;
   const distance=cp.distanceTo(f.p),range=f.shrimp?6:42;if(distance>range){f.fresh=true;continue;}
   const L=f.L,pixels=L*this.pxScale/Math.max(.2,distance),level=pixels>=320?0:pixels>=80?1:pixels>=22?2:3,lod=f.shrimp?8:f.morph*4+level;this.sphere.center.copy(f.p);this.sphere.radius=L;if(pixels<1.2||!this.frustum.intersectsSphere(this.sphere)){f.fresh=true;continue;}
   this.screen.copy(f.p).project(camera);this.frameSight[f.shrimp?'shrimp':'fish'].push({position:f.p.toArray(),length:L,distance,pixels,ndc:[this.screen.x,this.screen.y],habitat:g.id});
   const speed=f.velocity.length(),yaw=Math.atan2(f.velocity.x,f.velocity.z);let turn=Math.atan2(Math.sin(yaw-f.yaw),Math.cos(yaw-f.yaw));f.yaw+=turn*Math.min(1,dt*7);const pitch=-Math.atan2(f.velocity.y,Math.max(.02,Math.hypot(f.velocity.x,f.velocity.z)));this.euler.set(pitch,f.yaw,Math.max(-.18,Math.min(.18,turn*.3)),'YXZ');this.q.setFromEuler(this.euler);
   const deltaPhase=dt*(f.shrimp?4:7+speed/f.L*3)*(1+panic*.4);f.phase+=deltaPhase;const k=i*16;
   D.set([x,y,z,L,this.q.x,this.q.y,this.q.z,this.q.w,f.phase,f.shrimp?.012:.018+Math.min(.025,speed*.035),Math.max(-.12,Math.min(.12,turn*.15)),(f.shrimp?99:f.morph?14:0)+f.seed*.9,f.fresh?0:x-f.previous.x,f.fresh?0:y-f.previous.y,f.fresh?0:z-f.previous.z,f.fresh?0:deltaPhase],k);f.fresh=false;
   const threshold=[320,80,22][level];
   if(distance>range*.85)this.batch.addFade(lod,i,Math.max(0,(range-distance)/(range*.15)),false);
   else if(!f.shrimp&&level<3&&pixels<threshold*1.15){const a=(pixels/threshold-1)/.15;this.batch.addFade(lod,i,a,false);this.batch.addFade(lod+1,i,a,true);}
   else this.batch.add(lod,i);live++;if(f.shrimp)shrimp++;

  }
  this.batch.commit();this.batch.upload();this.visibleFish=live-shrimp;this.visibleShrimp=shrimp;this.drawnTriangles=this.batch.kinds.reduce((sum,k,i)=>sum+k.geometry.index.count/3*(this.batch.counts[i]+this.batch.fadeCounts[i]),0);
  this.birdBatch.begin();let active=0;this.audit.minBirdGroundClearance=Infinity;
  for(const b of this.birds){const a=b.anchor,dist=Math.hypot(cp.x-a.p[0],cp.z-a.p[1]);if(!this.enabled||dist>650){b.active=false;continue;}const f=b.flyer;if(!b.active){f.P.fresh=true;b.active=true;}
   b.phase+=dt*.29;const tx=a.p[0]+Math.cos(b.phase)*b.radius,tz=a.p[1]+Math.sin(b.phase)*b.radius,lookX=f.x+Math.sin(f.yaw)*14,lookZ=f.z+Math.cos(f.yaw)*14,h=Math.max(this.terrain.heightAt(tx,tz),this.terrain.heightAt(lookX,lookZ),this.terrain.heightAt(f.x,f.z),-.7)+a.height;
   if(![tx,h,tz,f.x,f.y,f.z,dt,b.scale].every(Number.isFinite))throw Error('Invalid bird navigation: '+JSON.stringify({id:b.id,target:[tx,h,tz],position:[f.x,f.y,f.z],dt,scale:b.scale,anchor:a}));
   f.steer(dt,tx,h,tz,f.cfg.speed,1,1);const minimum=this.terrain.heightAt(f.x,f.z)+Math.max(4,b.scale*2);if(f.y<minimum){f.y=minimum;f.vy=Math.max(f.vy,1);f.P.fresh=true;this.audit.birdCorrections++;}this.audit.minBirdGroundClearance=Math.min(this.audit.minBirdGroundClearance,f.y-this.terrain.heightAt(f.x,f.z));f.animate(dt);f.P.scale=b.scale*Math.max(0,Math.min(1,(650-dist)/120));this.sphere.center.set(f.x,f.y,f.z);this.sphere.radius=f.sp.span*b.scale;const distance=cp.distanceTo(this.sphere.center),pixels=this.sphere.radius*this.pxScale/Math.max(.2,distance);if(pixels>1.2&&this.frustum.intersectsSphere(this.sphere)){this.birdBatch.write(f.P);active++;this.screen.copy(this.sphere.center).project(camera);this.frameSight.birds.push({id:b.id,kind:b.kind,position:[f.x,f.y,f.z],span:f.sp.span*b.scale,pixels,distance,ndc:[this.screen.x,this.screen.y]});}
  }
  this.birdBatch.commit();this.visibleBirds=active;
 }
 advance(f,dt,cp){
  const g=f.group,p=f.p,v=f.velocity;
  if(f.sleeping){p.set(g.x+Math.cos(f.slot)*g.radius*f.spread*.65,g.h-f.depth*.8-(g.sea?.65:0),g.z+Math.sin(f.slot)*g.radius*f.spread*.5);v.set(Math.sin(f.slot)*.12,0,Math.cos(f.slot)*.12);f.sleeping=false;f.previous.copy(p);}
  const steps=Math.max(1,Math.ceil(dt/.035)),hdt=dt/steps;
  for(let k=0;k<steps;k++){
   const time=this.time*(.11+f.seed*.07)+f.slot,r=g.radius*f.spread,tx=g.x+Math.cos(time)*r,tz=g.z+Math.sin(time*.73+f.seed)*r*.68;
   const speed=f.shrimp?.04:f.L*(1.2+f.seed*.9),dx=tx-p.x,dz=tz-p.z,dl=Math.hypot(dx,dz)||1;
   let ax=(dx/dl*speed-v.x)*1.5,az=(dz/dl*speed-v.z)*1.5;
   const awayX=p.x-cp.x,awayZ=p.z-cp.z,awayY=p.y-cp.y,away=Math.hypot(awayX,awayY,awayZ),reach=f.shrimp?.65:2.7;
   f.panic=Math.max(0,f.panic-hdt*.6);
   if(away<reach){const a=1-away/reach,force=(a*a*8+a*2)*(f.shrimp?.3:1);ax+=awayX/(away+.01)*force;az+=awayZ/(away+.01)*force;f.panic=Math.max(f.panic,a);this.audit.fleeFrames++;if(v.x*awayX+v.z*awayZ>0)this.audit.fleeAwayFrames++;}
   // Short-range body separation within the active school, scaled by length.
   if(!f.shrimp)for(let i=g.first;i<g.first+g.count;i++){const q=this.fish[i];if(q===f||q.sleeping)continue;const sx=p.x-q.p.x,sz=p.z-q.p.z,sd=Math.hypot(sx,sz),clear=(f.L+q.L)*.8;if(sd<clear&&sd>.001){const force=(clear-sd)*1.8;ax+=sx/sd*force;az+=sz/sd*force;}}
   for(const rock of g.obstacles??[]){const rx=p.x-rock.x,rz=p.z-rock.z,d=Math.hypot(rx,rz),safe=(rock.footRadius??rock.size*.9)+f.L*1.5;if(d<safe+1.1&&p.y<(rock.top??rock.y+rock.size*rock.sy*1.1)){const force=(safe+1.1-d)*3;ax+=rx/(d+.01)*force;az+=rz/(d+.01)*force;this.audit.obstacleDeflections++;}}
   const lookX=p.x+v.x*.8,lookZ=p.z+v.z*.8,water=g.sea?g.h:this.query.height(lookX,lookZ),bed=this.terrain.heightAt(lookX,lookZ),minimum=g.sea?Math.max(1.5,this.breakDepth(lookX,lookZ)+.35):.35;
   if(water-bed<minimum){const gx=this.terrain.heightAt(lookX+.5,lookZ)-this.terrain.heightAt(lookX-.5,lookZ),gz=this.terrain.heightAt(lookX,lookZ+.5)-this.terrain.heightAt(lookX,lookZ-.5),l=Math.hypot(gx,gz)||1;ax-=gx/l*2+v.x*2;az-=gz/l*2+v.z*2;}
   v.x+=ax*hdt;v.z+=az*hdt;const max=speed*(1+f.panic*3),length=Math.hypot(v.x,v.z);if(length>max){v.x*=max/length;v.z*=max/length;}
   let nx=p.x+v.x*hdt,nz=p.z+v.z*hdt,h=g.sea?g.h:this.query.height(nx,nz),floor=this.terrain.heightAt(nx,nz),ceiling=h-(g.sea?.85:.16);
   if(h-floor<minimum||ceiling<floor+.2){nx=p.x;nz=p.z;v.x*=-.3;v.z*=-.3;h=g.sea?g.h:this.query.height(nx,nz);floor=this.terrain.heightAt(nx,nz);ceiling=h-(g.sea?.85:.16);}
   const target=f.shrimp?floor+.025:Math.max(floor+.18,Math.min(ceiling,g.h-f.depth*.8-(g.sea?.65:0)+Math.sin(time*.6)*.06));
   v.y+=(target-p.y)*hdt*4-v.y*hdt*3;const y=f.shrimp?target:Math.max(floor+.18,Math.min(ceiling,p.y+v.y*hdt));p.set(nx,y,nz);this.audit.maxPanic=Math.max(this.audit.maxPanic,f.panic);
  }
 }
 stats(){return {enabled:this.enabled,fish:this.fish.filter(f=>!f.shrimp).length,shrimp:this.fish.filter(f=>f.shrimp).length,birds:this.birds.length,visibleFish:this.visibleFish,visibleShrimp:this.visibleShrimp,visibleBirds:this.visibleBirds,activeBirds:this.birds.filter(b=>b.active).length,drawnTriangles:this.drawnTriangles,habitats:this.groups.map(g=>({id:g.id,center:[g.x,g.h,g.z],floor:g.floor,depth:g.h-g.floor,count:g.count,radius:g.radius,sea:g.sea??false,surfaceReference:g.sea?'fixed mean sea with 0.85m ceiling margin and native breaker exclusion':'local inland water'})),waterBounds:{...this.audit,scope:'fish centre against terrain and conservative ceiling; conservative rock steering; not a full deforming mesh/wave-trough collision proof'},screenCandidates:Object.fromEntries(Object.entries(this.frameSight).map(([k,v])=>[k,{count:v.length,examples:v.slice(0,12)}])),visibilityMeaning:'main-camera frustum + projected pixel threshold + distance; not occlusion or water-transmission proof; inspect actual video',appearance:'native countershaded silver/olive skin, fin membranes and scales; slender and fuller environmental fish forms, 320/80/22px LOD with 15% crossfade',movement:this.fish.filter(f=>!f.shrimp&&!f.sleeping).slice(0,10).map(f=>({position:f.p.toArray(),velocity:f.velocity.toArray(),panic:f.panic,group:f.group.id})),method:'native fish geometry/swim/LOD and BirdBatch/Flyer; world-fixed shore habitats, goal velocity + directed camera flee + rock/shallow lookahead, own shrimp; fish 65m simulation/42m drawing, shrimp 6m, birds 650m; distant habitats dormant',scientificStatus:'environmental forms and modern CC0 bird calls; not species-level prehistoric reconstruction'};}
}
