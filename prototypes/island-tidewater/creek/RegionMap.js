// Museum-authored atlas of the live composed terrain. One CPU bake, no scene pass.
import {ISLAND_PLAN} from '../island/plan.js';
export class RegionMap {
 constructor(app,onTravel){
  this.app=app;this.onTravel=onTravel;this.bounds=ISLAND_PLAN.bounds.map((v,i)=>v-ISLAND_PLAN.sourceOrigin[i%2]+(i<2?-500:500));this.res=256;this.bakedRows=0;this.travels=[];this.lastUpdate=0;
  const host=this.host=document.createElement('aside');host.id='region-map';host.setAttribute('aria-label','岛屿区域地图');
  host.innerHTML='<header><span>岛屿导览</span><button id="map-toggle" aria-expanded="true" aria-controls="region-map-content">收起地图</button></header><div id="region-map-content"><div class="map-surface"><canvas width="256" height="256" aria-label="当前岛屿地形，北方朝上"></canvas><span class="map-north" aria-hidden="true">N ↑</span><span class="map-camera" aria-label="当前位置"></span></div><output id="map-place" aria-live="polite">点击区域，快速到达</output><div class="map-key"></div></div>';
  document.body.append(host);this.canvas=host.querySelector('canvas');this.ctx=this.canvas.getContext('2d',{alpha:false});this.ctx.fillStyle='#416879';this.ctx.fillRect(0,0,256,256);this.marker=host.querySelector('.map-camera');this.output=host.querySelector('output');
  host.querySelector('#map-toggle').onclick=()=>{const collapsed=host.classList.toggle('collapsed');host.querySelector('#map-toggle').setAttribute('aria-expanded',String(!collapsed));host.querySelector('#map-toggle').textContent=collapsed?'展开地图':'收起地图';};
  const names=['溪谷','西岸浅湾','巨木林','长湖','高草甸','湿地','寒凉高地','旱谷','东湾浅海'];
  const places={creek:'entrance','west-coast':'west-shelf','east-bay':'east-shelf'};
  const offsets={creek:[-4,7],'west-coast':[-8,9],'giant-forest':[-5,-3],lake:[5,-2]};
  this.entries=ISLAND_PLAN.regions.map((r,i)=>{
   const place=places[r.id]??r.id,pt=r.point.map((v,k)=>v-ISLAND_PLAN.sourceOrigin[k]),uv=this.uv(...pt),off=offsets[r.id]??[0,0];
   if(off[0]||off[1]){const line=document.createElement('span'),dx=off[0]*2.06,dy=off[1]*2.06;line.className='map-connector';line.style.left=`${uv[0]*100}%`;line.style.top=`${uv[1]*100}%`;line.style.width=`${Math.hypot(off[0],off[1])}%`;line.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;host.querySelector('.map-surface').append(line);}
   const b=document.createElement('button');b.className='map-destination';b.dataset.mapPlace=place;b.textContent=String(i+1);b.title=names[i];b.setAttribute('aria-label','前往'+names[i]);b.style.left=`${uv[0]*100+off[0]}%`;b.style.top=`${uv[1]*100+off[1]}%`;
   b.onclick=()=>{if(!onTravel(place))return;this.travels.push({place,at:performance.now(),position:app.camera.position.toArray()});this.output.textContent=names[i]+' · 已到达';this.update(performance.now(),true);};host.querySelector('.map-surface').append(b);
   const key=document.createElement('button');key.className='map-key-item';key.textContent=`${i+1} ${names[i]}`;key.setAttribute('aria-label','地图到达'+names[i]);key.onclick=()=>b.click();host.querySelector('.map-key').append(key);return {id:r.id,place,name:names[i],point:pt,button:b,key};
  });
  this.image=this.ctx.createImageData(256,256);requestAnimationFrame(()=>this.bake());
 }
 uv(x,z){const [x0,z0,x1,z1]=this.bounds;return[(x-x0)/(x1-x0),(z-z0)/(z1-z0)];}
 bake(){
  const t=this.app.terrainData,[x0,z0,x1,z1]=this.bounds,s=(x1-x0)/this.res,bytes=this.image.data;
  for(let j=this.bakedRows;j<Math.min(256,this.bakedRows+16);j++)for(let i=0;i<256;i++){
   const x=x0+(i+.5)*s,z=z0+(j+.5)*s,h=t.heightAt(x,z);let c;
   const field=this.app.creekData.field.sample(x,z),level=field[1]<0?Math.max(-.7,field[0]):-.7;
   if(h<level){const depth=Math.min(1,(level-h)/28);c=[137-depth*92,191-depth*94,186-depth*65];}
   else{const shade=Math.max(.55,Math.min(1.25,1+(t.heightAt(x-s,z)-t.heightAt(x+s,z))*.006+(t.heightAt(x,z+s)-t.heightAt(x,z-s))*.004));const high=Math.max(0,Math.min(1,(h-280)/440));c=[(111+high*58)*shade,(132+high*39)*shade,(94+high*66)*shade];}
   const k=(j*256+i)*4;bytes[k]=c[0];bytes[k+1]=c[1];bytes[k+2]=c[2];bytes[k+3]=255;
  }
  this.bakedRows=Math.min(256,this.bakedRows+16);this.ctx.putImageData(this.image,0,0);if(this.bakedRows<256)requestAnimationFrame(()=>this.bake());
 }
 update(now,force=false){if(!force&&now-this.lastUpdate<160)return;this.lastUpdate=now;const p=this.app.camera.position,u=this.uv(p.x,p.z);this.marker.style.left=`${Math.max(0,Math.min(1,u[0]))*100}%`;this.marker.style.top=`${Math.max(0,Math.min(1,u[1]))*100}%`;const e=this.app.camera.matrixWorld.elements;this.marker.style.transform=`translate(-50%,-50%) rotate(${Math.atan2(-e[8],e[10])}rad)`;
  // The marker/label follow real position, including flight and HUD visits.
  // These are neighbouring exhibit centres, not surveyed biome boundaries.
  const nearest=this.entries.reduce((a,b)=>Math.hypot(p.x-a.point[0],p.z-a.point[1])<Math.hypot(p.x-b.point[0],p.z-b.point[1])?a:b);
  let selected=nearest,name='邻近 · '+nearest.name;const ground=this.app.terrainData.heightAt(p.x,p.z);
  for(const shelf of this.app.creekData.cove.shelves){const dx=p.x-shelf.center[0],dz=p.z-shelf.center[1],a=dx*shelf.tangent[0]+dz*shelf.tangent[1],d=dx*shelf.normal[0]+dz*shelf.normal[1]-shelf.shore(a);
   if(Math.abs(a)<shelf.along&&d> -55&&d<shelf.width+150&&ground<3){const id=shelf.id==='west-shelf'?'west-coast':shelf.id==='east-shelf'?'east-bay':null;selected=this.entries.find(r=>r.id===id);name=shelf.id==='south-shelf'?'南岸浅海':selected.name;break;}
  }
  if(p.y-ground>900){selected=null;name='全岛上空';}
  this.output.textContent=name;this.activeRegion=selected?.id??null;
  for(const r of this.entries){const yes=r===selected;r.button.setAttribute('aria-current',String(yes));r.key.setAttribute('aria-current',String(yes));}

 }
 stats(){return {label:this.output.textContent,activeRegion:this.activeRegion,northUp:true,bounds:this.bounds,source:'live composed CPU terrain, one 256² bake in 16 row slices; no added 3D pass or GPU query',ready:this.bakedRows===256,position:this.app.camera.position.toArray(),destinations:this.entries.map(({id,place,name,point})=>({id,place,name,point})),travels:this.travels.slice(-12)};}
}
