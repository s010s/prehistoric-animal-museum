// Museum-authored atlas of the live composed terrain. One CPU bake, no scene pass.
import {ISLAND_PLAN} from '../island/plan.js';
import {mainEstuaryWeight} from './MainEstuary.js';

const locationInterval = 160;
const arrivalRadius = {enter: 30, exit: 42};

export class RegionMap {
 constructor(app,onTravel,guide){
  this.guide=guide;
  this.app=app;this.onTravel=onTravel;this.bounds=ISLAND_PLAN.bounds.map((v,i)=>v-ISLAND_PLAN.sourceOrigin[i%2]+(i<2?-500:500));this.res=256;this.bakedRows=0;this.travels=[];this.lastUpdate=-Infinity;
  this.title=document.querySelector('#place-title');
  this.note=document.querySelector('#place-note');
  const host=this.host=document.createElement('aside');host.id='region-map';host.setAttribute('aria-label','岛屿区域地图');
  host.innerHTML='<header><span>岛屿导览</span><button id="map-toggle" aria-expanded="true" aria-controls="region-map-content">收起地图</button></header><div id="region-map-content"><div class="map-surface"><canvas width="256" height="256" aria-label="当前岛屿地形，北方朝上"></canvas><span class="map-north" aria-hidden="true">N ↑</span><span class="map-camera" aria-label="当前位置"></span></div><output id="map-place" aria-live="polite">点击区域，快速到达</output><div class="map-key"></div></div>';
  document.body.append(host);this.canvas=host.querySelector('canvas');this.ctx=this.canvas.getContext('2d',{alpha:false});this.ctx.fillStyle='#416879';this.ctx.fillRect(0,0,256,256);this.marker=host.querySelector('.map-camera');this.output=host.querySelector('output');
  const surface=host.querySelector('.map-surface');
  this.bearingLine=document.createElement('span');
  this.bearingLine.className='map-wildlife-bearing';
  this.bearingLine.hidden=true;
  this.wildlifePin=document.createElement('button');
  this.wildlifePin.type='button';
  this.wildlifePin.className='map-fauna-pin';
  this.wildlifePin.hidden=true;
  this.wildlifePin.onclick=()=>{
   if(this.shownAnimal?.museum && this.guide.trackId!==this.shownAnimal.id){
    this.guide.trackIndividual(this.shownAnimal.id);
    this.update(performance.now(),true);
   }else document.querySelector('#wildlife-open')?.click();
  };
  surface.append(this.bearingLine,this.wildlifePin);
  this.wildlifeKey=document.createElement('div');
  this.wildlifeKey.className='map-wildlife-key';
  this.wildlifeKey.hidden=true;
  this.output.before(this.wildlifeKey);
  host.querySelector('#map-toggle').onclick=()=>{const collapsed=host.classList.toggle('collapsed');host.querySelector('#map-toggle').setAttribute('aria-expanded',String(!collapsed));host.querySelector('#map-toggle').textContent=collapsed?'展开地图':'收起地图';if(!collapsed){this.update(performance.now(),true);this.queueBake();}};
  const names=['溪谷','西岸浅湾','巨木林','长湖','高草甸','湿地','寒凉高地','旱谷','东湾浅海'];
  const places={creek:'entrance','west-coast':'sample-mouth','east-bay':'east-shelf',lake:'lake-shingle',grassland:'alluvial-bend',wetland:'wetland-runnels',highland:'tarn-moraine','dry-upland':'dry-escarpment'};
  const offsets={creek:[-4,7],'west-coast':[-8,9],'giant-forest':[-5,-3],lake:[5,-2]};
  this.entries=ISLAND_PLAN.regions.map((r,i)=>{
   const center=r.point.map((v,k)=>v-ISLAND_PLAN.sourceOrigin[k]);
   const place=places[r.id]??r.id,visit=app.islandVisits[place],pt=visit?[visit.p[0],visit.p.at(-1)]:center,uv=this.uv(...pt),off=offsets[r.id]??[0,0];
   if(off[0]||off[1]){const line=document.createElement('span'),dx=off[0]*2.06,dy=off[1]*2.06;line.className='map-connector';line.style.left=`${uv[0]*100}%`;line.style.top=`${uv[1]*100}%`;line.style.width=`${Math.hypot(off[0],off[1])}%`;line.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;surface.append(line);}
   const b=document.createElement('button');b.className='map-destination';b.dataset.mapPlace=place;b.textContent=String(i+1);b.title=names[i];b.setAttribute('aria-label','前往'+names[i]);b.style.left=`${uv[0]*100+off[0]}%`;b.style.top=`${uv[1]*100+off[1]}%`;
   b.onclick=()=>{if(!onTravel(place))return;this.travels.push({place,at:performance.now(),position:app.camera.position.toArray()});this.update(performance.now(),true);};surface.append(b);
   const key=document.createElement('button');key.className='map-key-item';key.textContent=`${i+1} ${names[i]}`;key.setAttribute('aria-label','地图到达'+names[i]);key.onclick=()=>b.click();host.querySelector('.map-key').append(key);return {id:r.id,place,name:names[i],point:pt,center,button:b,key};
  });
  this.image=this.ctx.createImageData(256,256);
  host.querySelector('#map-toggle').click();
  this.update(performance.now(),true);
 }
 uv(x,z){const [x0,z0,x1,z1]=this.bounds;return[(x-x0)/(x1-x0),(z-z0)/(z1-z0)];}
 queueBake(){
  if(this.bakeQueued || this.bakedRows>=this.res || this.host.classList.contains('collapsed'))return;
  this.bakeQueued=true;
  requestAnimationFrame(()=>{this.bakeQueued=false;if(!this.host.classList.contains('collapsed'))this.bake();});
 }
 bake(){
  const t=this.app.terrainData,[x0,z0,x1,z1]=this.bounds,s=(x1-x0)/this.res,bytes=this.image.data;
  const first=this.bakedRows,end=performance.now()+2;
  do {const j=this.bakedRows;for(let i=0;i<this.res;i++){
   const x=x0+(i+.5)*s,z=z0+(j+.5)*s,h=t.heightAt(x,z);let c;
   const field=this.app.creekData.field.sample(x,z),level=field[1]<0?Math.max(-.7,field[0]):-.7;
   if(h<level){const depth=Math.min(1,(level-h)/28);c=[137-depth*92,191-depth*94,186-depth*65];}
   else{const shade=Math.max(.55,Math.min(1.25,1+(t.heightAt(x-s,z)-t.heightAt(x+s,z))*.006+(t.heightAt(x,z+s)-t.heightAt(x,z-s))*.004));const high=Math.max(0,Math.min(1,(h-280)/440));c=[(111+high*58)*shade,(132+high*39)*shade,(94+high*66)*shade];}
   const k=(j*256+i)*4;bytes[k]=c[0];bytes[k+1]=c[1];bytes[k+2]=c[2];bytes[k+3]=255;
  }
  this.bakedRows++;}while(this.bakedRows<this.res && performance.now()<end);
  this.ctx.putImageData(this.image,0,0,0,first,this.res,this.bakedRows-first);this.queueBake();
 }
 update(now,force=false){
  if(!force&&now-this.lastUpdate<locationInterval)return;
  this.lastUpdate=now;
  const {x,y,z}=this.app.camera.position;
  const id=this.app.currentLandmark, title=this.title.textContent, note=this.note.textContent;
  // All visit entry points already write both HUD fields at the camera's arrival.
  // Compare our last render too, so returning via the same stop is seen after roaming.
  if(!this.arrival||id!==this.arrival.id||title!==this.renderedTitle||note!==this.renderedNote){
   this.arrival={id,title,note,x,y,z};
   this.atArrival=true;
  }
  const previous=this.locationPosition;
  if(!previous||x!==previous.x||y!==previous.y||z!==previous.z){
   this.locationPosition={x,y,z};
   this.location=this.locate(x,y,z);
  }
  const radius=this.atArrival?arrivalRadius.exit:arrivalRadius.enter;
  this.atArrival=Math.hypot(x-this.arrival.x,y-this.arrival.y,z-this.arrival.z)<=radius;
  this.renderedTitle=this.atArrival?this.arrival.title:this.location.name;
  this.renderedNote=this.atArrival?this.arrival.note:'';
  if(title!==this.renderedTitle)this.title.textContent=this.renderedTitle;
  if(note!==this.renderedNote)this.note.textContent=this.renderedNote;
  this.note.hidden=!this.renderedNote;

  const label=this.location.nearby?'邻近 · '+this.location.name:this.location.name;
  if(this.output.textContent!==label)this.output.textContent=label;
  if(this.activeRegion!==this.location.id){
   this.activeRegion=this.location.id;
   for(const r of this.entries){
    const current=String(r.id===this.activeRegion);
    r.button.setAttribute('aria-current',current);
    r.key.setAttribute('aria-current',current);
   }
  }
  if(this.host.classList.contains('collapsed'))return;
  const [u,v]=this.uv(x,z);
  this.marker.style.left=`${Math.max(0,Math.min(1,u))*100}%`;
  this.marker.style.top=`${Math.max(0,Math.min(1,v))*100}%`;
  const e=this.app.camera.matrixWorld.elements;
  this.marker.style.transform=`translate(-50%,-50%) rotate(${Math.atan2(-e[8],e[10])}rad)`;
  this.updateWildlife(u,v);
 }
 updateWildlife(u,v){
  const animal=this.guide?.nearby.snapshot?.target;
  this.shownAnimal=animal;
  const visible=animal && Number.isFinite(animal.x) && Number.isFinite(animal.z);
  this.wildlifePin.hidden=this.bearingLine.hidden=this.wildlifeKey.hidden=!visible;
  if(!visible)return;
  const [a,b]=this.uv(animal.x,animal.z);
  const dx=a-u,dz=b-v;
  this.bearingLine.style.left=u*100+'%';
  this.bearingLine.style.top=v*100+'%';
  this.bearingLine.style.width=Math.hypot(dx,dz)*100+'%';
  this.bearingLine.style.transform='rotate('+Math.atan2(dz,dx)+'rad)';
  this.wildlifePin.style.left=a*100+'%';
  this.wildlifePin.style.top=b*100+'%';
  const locked=this.guide.trackId===animal.id;
  this.wildlifePin.dataset.locked=String(locked);
  const name=(locked?'追踪中 · ':'附近 · ')+animal.name+(animal.live?'':'（栖息地）');
  this.wildlifePin.title=name;
  this.wildlifePin.setAttribute('aria-label',locked||!animal.museum?'打开动物寻踪':'追踪'+animal.name);
  if(this.wildlifeKey.textContent!==name)this.wildlifeKey.textContent=name;
 }
 locate(x,y,z){
  const ground=this.app.terrainData.heightAt(x,z);
  if(y-ground>900)return {id:null,name:'全岛上空'};
  if(mainEstuaryWeight(x,z)>.12)return {id:'main-estuary',name:'主河入海口'};
  const sample=this.app.creekData.field.continuousSample;
  const reach=sample?.nearest(x,z);
  if(reach&&sample.weight(x,z,reach)>.12){
   return {id:'west-coast',name:reach.level<=1.6?'西岸样板河口':'西岸溪谷样板'};
  }
  if(ground<3){
   for(const shelf of this.app.creekData.cove.shelves){
    const dx=x-shelf.center[0],dz=z-shelf.center[1];
    const along=dx*shelf.tangent[0]+dz*shelf.tangent[1];
    const offshore=dx*shelf.normal[0]+dz*shelf.normal[1]-shelf.shore(along);
    if(Math.abs(along)>=shelf.along||offshore<=-55||offshore>=shelf.width+150)continue;
    if(shelf.id==='west-shelf')return {id:'west-coast',name:'西岸浅湾'};
    if(shelf.id==='east-shelf')return {id:'east-bay',name:'东湾浅海'};
    return {id:null,name:'南岸浅海'};
   }
  }
  // Use the atlas geography when there is no finer coastal classification.
  // These are neighbouring exhibit centres, not surveyed biome boundaries.
  const distance=region=>(x-region.center[0])**2+(z-region.center[1])**2;
  const nearest=this.entries.reduce((a,b)=>distance(a)<distance(b)?a:b);
  return {id:nearest.id,name:nearest.name,nearby:true};
 }
 stats(){return {label:this.output.textContent,activeRegion:this.activeRegion,northUp:true,bounds:this.bounds,source:'live composed CPU terrain, one on-demand 256² bake in time-limited slices; no added 3D pass or GPU query',ready:this.bakedRows===256,position:this.app.camera.position.toArray(),destinations:this.entries.map(({id,place,name,point})=>({id,place,name,point})),travels:this.travels.slice(-12)};}
}
