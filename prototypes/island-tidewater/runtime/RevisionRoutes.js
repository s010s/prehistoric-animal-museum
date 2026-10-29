// Local, repeatable visual regression rails. They move only the review camera;
// the normal scene, terrain, vegetation, water and renderer remain active.
const MOUTH=[-996.4528440617662,12.978116949028509,148.79295916774882];
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const routes={
 'anomaly-source':{label:'验收 · 尖片原机位缓移往返',make:()=>{const p=[-644.1815606333212,65.78109867798963,-499.9445528429592],q=[p[0]+2,p[1]+1.5,p[2]+1];return {keys:[[0,p],[4,p],[11,q],[13,q],[20,p],[24,p]],yaw:-2.529742886500603,pitch:-.7221675171164188};}},
 'anomaly-shadow-water':{label:'验收 · 点阵水面原机位往返',make:()=>{const p=[-670.6331275743049,53.21579669090143,-464.8492248928736],q=[p[0]-.5,p[1]+.7,p[2]-.5];return {keys:[[0,p],[4,p],[11,q],[13,q],[20,p],[24,p]],yaw:2.1188424206789915,pitch:-.7969675171164191};}},
 'anomaly-surf-static':{label:'验收 · 矩形浪花原机位定点',make:()=>{const p=[-848.8600875348036,4.026981689322265,119.86351318619481];return {keys:[[0,p],[24,p]],yaw:1.7778424206789745,pitch:-.21616751711641904};}},
 'anomaly-surf-travel':{label:'验收 · 矩形浪花缓移往返',make:()=>{const p=[-848.8600875348036,4.026981689322265,119.86351318619481],q=[p[0]-12,p[1]+4,p[2]+6];return {keys:[[0,p],[4,p],[11,q],[13,q],[23,p],[24,p]],yaw:1.7778424206789745,pitch:-.21616751711641904};}},
 'review-mouth-approach':{label:'验收 · 原现场河口接近往返',make:()=>({keys:[[0,MOUTH],[1,MOUTH],[11,[-907.9178,12.978116949028509,132.6199]],[13,[-907.9178,12.978116949028509,132.6199]],[23,MOUTH],[24,MOUTH]],yaw:-1.3901281936802612,pitch:-.017200000000004843})},
 'review-mouth-orbit':{label:'验收 · 河口两岸环绕',make:()=>({keys:[[0,MOUTH],[1,MOUTH],[6,[-947,20,60]],[11,[-870,24,65]],[16,[-871,24,211]],[21,[-978,20,220]],[24,MOUTH]],target:[-881,1,130]})},
 'review-mouth-lookback':{label:'验收 · 河口回头看上游',make:()=>({keys:[[0,[-823,4.5423355650901795,119]],[24,[-823,4.5423355650901795,119]]],yawKeys:[[0,1.685],[2,1.685],[11,-.5],[13,-.5],[22,1.685],[24,1.685]],pitch:-.14})},
 'review-mouth-shelf':{label:'验收 · 入海槽与海床',make:()=>({keys:[[0,[-880,30,130]],[1,[-880,30,130]],[11,[-1270,30,180]],[13,[-1270,30,180]],[23,[-880,30,130]],[24,[-880,30,130]]],yaw:1.6983,pitch:-.9})},
 'review-reef-diversity':{label:'验收 · 珊瑚花园水下往返',make:a=>{const at=(x,z)=>[x,Math.min(-1.55,a.terrainData.heightAt(x,z)+.8),z],p=at(-926.4,149.9),m=at(-948,153),q=at(-974,146);return {keys:[[0,p],[1,p],[6,m],[11,q],[13,q],[18,m],[23,p],[24,p]],yawKeys:[[0,1.55],[10,1.55],[12,-1.55],[22,-1.55],[24,1.55]],pitch:-.18};}},
 'review-creek-swim':{label:'验收 · 扩宽溪潭水下往返',make:a=>{const field=a.creekData.field.continuousSample,p=field.nearest(-777,20),q=field.nearest(-799,75),pose=r=>[r.x,r.level-.8,r.z],yaw=r=>Math.atan2(-r.dir[0],-r.dir[1]),y=yaw(p);return {keys:[[0,pose(p)],[1,pose(p)],[11,pose(q)],[13,pose(q)],[23,pose(p)],[24,pose(p)]],yawKeys:[[0,y],[10,yaw(q)],[12,yaw(q)+Math.PI],[22,y+Math.PI],[24,y]],pitch:-.12};}},
 'review-sample-herbivore':{label:'验收 · 副栉龙侧身与足迹往返',make:a=>{const actor=sampleActor(a,'parasaurolophus'),c=a.sampleMuseumLife.centerOf(actor),at=(x,z)=>[x,a.terrainData.heightAt(x,z)+1.65,z],p=at(-762,65),q=at(-769,69);return {keys:[[0,p],[3,p],[11,q],[14,q],[22,p],[24,p]],target:[c[0],c[1]-.3,c[2]]};}},
 'review-sample-flight':{label:'验收 · 无齿翼龙近看翼部动作',make:a=>sampleFollow(a,'pteranodon')},
 'review-wing-membrane':{label:'验收 · 翼膜同相位环绕',make:a=>{const actor=sampleActor(a,'pteranodon');actor.route.phase=0;actor.time=0;for(const layer of actor.model.layers)layer.time=0;actor.model.update(0);a.sampleMuseumLife.place(actor,0);const p=actor.model.group.position.toArray();return {keys:[[0,p],[24,p]],target:p,wingFollow:true,initialFlightPhase:0,initialClipSeconds:0,orbitMetres:9};}},
 'review-wing-macro':{label:'验收 · 翼膜近景高频检查',make:a=>({...routes['review-wing-membrane'].make(a),wingMacro:true,orbitMetres:3.2})},
 'review-sample-marine':{label:'验收 · 鱼龙全身与游鳍',make:a=>sampleFollow(a,'ichthyosaur')},
 'review-vault-flight':{label:'验收 · 喙嘴翼龙关节与滑翔',make:a=>vaultFollow(a,'pterosaur',0,[1.65,.12,1.4])},
 'review-vault-filterer':{label:'验收 · 南翼龙翼膜与腕指',make:a=>vaultFollow(a,'pterosaur',2,[3,.18,2.4])},
 'review-vault-crawler':{label:'验收 · Eryon 分足步行与觅食',make:a=>vaultFollow(a,'crawler',0,[.20,.095,.22])},
 'review-vault-insect':{label:'验收 · 巨脉蜻蜓四翼与停栖',make:a=>({...vaultFollow(a,'insect',0,[.55,.12,.6]),durationMs:36000})},
 'review-tree-descent':{label:'验收 · 固定巨木高空下降返回',make:a=>{const r=hero(a),h=r.y,low=Math.max(h+8,a.terrainData.heightAt(-765,-340)+2);return {keys:[[0,[-765,h+260,-340]],[1,[-765,h+260,-340]],[11,[-765,low,-340]],[13,[-765,low,-340]],[23,[-765,h+260,-340]],[24,[-765,h+260,-340]]],target:[r.x,h+26,r.z],tree:[r.x,r.z]};}},
 'review-tree-orbit':{label:'验收 · 固定巨木林冠环绕',make:a=>{const r=hero(a),keys=[];for(let i=0;i<=16;i++){const angle=i/16*Math.PI*2;keys.push([i/16*24,[r.x+Math.cos(angle)*62,r.y+35,r.z+Math.sin(angle)*62]]);}return {keys,target:[r.x,r.y+25,r.z],tree:[r.x,r.z]};}},
 'review-tree-young':{label:'验收 · 普通树高空下降返回',make:a=>{const r=young(a),p=[r.x-23,r.y+145,r.z-9],low=[p[0],Math.max(r.y+3,a.terrainData.heightAt(p[0],p[2])+2),p[2]];return {keys:[[0,p],[1,p],[11,low],[13,low],[23,p],[24,p]],target:[r.x,r.y+r.H*.6,r.z],tree:[r.x,r.z]};}},
};
function sampleActor(a,id){const actor=a.sampleMuseumLife?.actors.find(x=>x.definition.data.id===id);if(!actor)throw Error('Missing museum sample actor: '+id);return actor;}
function vaultRoot(a,kind,index){return kind==='pterosaur'?a.life.pterosaurs.flyers[index].root:kind==='crawler'?a.life.benthos.crawlers[index].root:a.life.insect.root;}
function vaultFollow(a,kind,index,offset){const root=vaultRoot(a,kind,index),p=root.position.toArray(),camera=p.map((v,i)=>v+offset[i]);return {keys:[[0,camera],[24,camera]],target:p,vaultFollow:{kind,index,offset}};}
function sampleFollow(a,id){
 const actor=sampleActor(a,id),r=actor.route,air=id==='pteranodon',keys=[],targetKeys=[];
 for(let s=0;s<=24;s++){
  const phase=r.phase+s*(air?r.speed/58:.72/16),x=(air?r.center[0]:r.x)+Math.cos(phase)*r.radii[0],z=(air?r.center[1]:r.z)+Math.sin(phase)*r.radii[1],y=air?r.altitude+Math.sin(phase*2)*1.3:r.y+Math.sin(phase*2)*.025;
  const p=air?[x+10,y-1.5,z+9]:[x+6,Math.max(a.terrainData.heightAt(x+6,z+3)+.45,y+.1),z+3];
  keys.push([s,p]);targetKeys.push([s,[x,y,z]]);
 }
 return {keys,targetKeys,actor:id};
}
function hero(a){return a.vegetation.records.find(r=>r.sample&&r.landmark&&Math.abs(r.x+727)<.1)??a.vegetation.records.find(r=>r.sample&&r.landmark);}
function young(a){const h=hero(a);return a.vegetation.records.filter(r=>r.sample&&r.variant<2&&r.H>12).sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0];}
export function revisionPose(route,seconds){
 const t=Math.max(0,Math.min(24,seconds));let i=1;while(i<route.keys.length-1&&t>route.keys[i][0])i++;
 const [ta,a]=route.keys[i-1],[tb,b]=route.keys[i],p=mix(a,b,Math.max(0,Math.min(1,(t-ta)/(tb-ta))));
 let target=route.target;
 if(route.targetKeys){let j=1;while(j<route.targetKeys.length-1&&t>route.targetKeys[j][0])j++;const [ta,a]=route.targetKeys[j-1],[tb,b]=route.targetKeys[j];target=mix(a,b,Math.max(0,Math.min(1,(t-ta)/(tb-ta))));}
 const d=target?.map((v,k)=>v-p[k]);let yaw=route.yaw;
 if(route.yawKeys){let j=1;while(j<route.yawKeys.length-1&&t>route.yawKeys[j][0])j++;const [a0,y0]=route.yawKeys[j-1],[b0,y1]=route.yawKeys[j];yaw=y0+(y1-y0)*Math.max(0,Math.min(1,(t-a0)/(b0-a0)));}
 return {position:p,yaw:d?Math.atan2(-d[0],-d[2]):yaw,pitch:d?Math.atan2(d[1],Math.hypot(d[0],d[2])):route.pitch};
}
function apply(runtime,route,seconds){const a=runtime.app,p=revisionPose(route,seconds);if(route.wingFollow){const actor=sampleActor(a,"pteranodon"),angle=.4+seconds/24*Math.PI*2,radius=route.orbitMetres??9,off=a.camera.position.clone().set(Math.cos(angle)*radius,Math.sin(seconds/24*Math.PI*4)*(route.wingMacro?1:3),Math.sin(angle)*radius).applyQuaternion(actor.model.group.quaternion),target=a.camera.position.clone().fromArray(a.sampleMuseumLife.centerOf(actor));if(route.wingMacro){const k=actor.poseNodes[0]*16;target.set(actor.model.world[k+12],actor.model.world[k+13],actor.model.world[k+14]).applyMatrix4(actor.model.group.matrixWorld);}const position=target.clone().add(off),d=target.clone().sub(position);p.position=position.toArray();p.yaw=Math.atan2(-d.x,-d.z);p.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));}if(route.vaultFollow){const f=route.vaultFollow,root=vaultRoot(a,f.kind,f.index),off=a.camera.position.clone().fromArray(f.offset).applyQuaternion(root.quaternion),position=root.position.clone().add(off);if(f.kind==='insect')position.y=Math.max(position.y,a.terrainData.heightAt(position.x,position.z)+.06);const d=root.position.clone().sub(position);p.position=position.toArray();p.yaw=Math.atan2(-d.x,-d.z);p.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));}a.fly.setPose(a.camera.position.clone().fromArray(p.position),p.yaw,p.pitch);a.fly.velocity.set(0,0,0);}
export function revisionTrees(app,route){
 const center=route.tree??[-727,-325];return app.vegetation.records.filter(r=>r.sample).sort((a,b)=>Math.hypot(a.x-center[0],a.z-center[1])-Math.hypot(b.x-center[0],b.z-center[1])).slice(0,5).map(r=>({id:`tree@${r.x.toFixed(4)},${r.z.toFixed(4)}`,root:[r.x,r.y,r.z],height:r.H,scale:[r.s,r.s*r.sy,r.s],yaw:r.yaw,variant:r.variant,seed:r.seed}));
}
export function prepareRevisionRoute(runtime,name){
 if(!routes[name])return null;const a=runtime.app;if(!a.creekData.field.continuousSample)throw Error('验收路线需要当前连续样板');
 const route=routes[name].make(a);if(route.wingFollow){a.sampleMuseumLife.hold();runtime.resetHistory();}runtime.clearInput();if(!a.freeCam)a.setFreeCam(true);apply(runtime,route,0);
 return {schema:'museum-revision-route-v1',id:name,label:routes[name].label,durationMs:24000,tickHz:30,fov:62,...route,trees:revisionTrees(a,route)};
}
export function applyRevisionTick(runtime,route,elapsedMs){const tick=Math.max(0,Math.min(720,Math.floor(elapsedMs*.03)));apply(runtime,route,tick/30);runtime.videoRouteTick=tick;}
export function bindRevisionRoutes(runtime){
 const select=document.querySelector('#motion-route');if(!select)return;
 for(const [value,route]of Object.entries(routes)){const option=document.createElement('option');option.value=value;option.textContent=route.label;select.append(option);}
 select.onchange=()=>{if(runtime.phase!=='ready'||runtime.recordingVideo)return;const route=prepareRevisionRoute(runtime,select.value);document.querySelector('#record-video').textContent=route?`动态录像 ${route.durationMs/1000} 秒`:'动态录像 12 秒';if(route){runtime.app.camera.fov=62;runtime.app.camera.updateProjectionMatrix();runtime.resetHistory();runtime.resume();runtime.event('revision-route-selected',route);runtime.publish();}};
}
