import {SAMPLE} from './ContinuousSample.js';
function shellObservation(data){
 const bed=data.sampleBenthicDetails;
 if(!bed?.shellSites.length)return null;
 const candidates=bed.shellSites.filter(s=>s.garden===0&&s.kind==='naticarius');
 const nearby=candidates.length?candidates:bed.shellSites;
 const obstacles=[
  ...bed.coralSites.concat(bed.spongeSites,bed.shellSites).map(s=>({site:s,radius:s.span*.6})),
  ...bed.plants.map(s=>({site:s,radius:s.scale*(s.kind==='meadow'?.95:.36)})),
  ...bed.hardSites.map(s=>({site:s,radius:s.scale*.65})),
  ...(data.sampleHabitatEnrichment?.plan.plants??[]).filter(s=>s.id==='halimeda').map(s=>({site:s,radius:s.height*.85})),
 ];
 for(const shell of [...nearby].sort((a,b)=>b.span*(1-b.embedFraction)-a.span*(1-a.embedFraction))){
  const range=.47,near=obstacles.filter(o=>o.site!==shell&&Math.hypot(o.site.x-shell.x,o.site.z-shell.z)<o.radius+range+.15);
  const gazeY=shell.centerY===undefined?shell.floor+shell.span*.24:shell.centerY+shell.halfHeight*.15;
  // Face the lit spiral flank. The shell's local azimuth rotates opposite
  // its world XZ bearing under the placement's positive Y-axis rotation.
  for(const offset of [0,1,-1,2,-2,3,-3,4,-4,5,-5,6,-6,7,-7,8]){
   const yaw=2.02-shell.yaw+offset*Math.PI/8,dx=Math.cos(yaw),dz=Math.sin(yaw);
   const x=shell.x+range*dx,z=shell.z+range*dz;
   const eye=Math.max(data.terrain.heightAt(x,z)+.46,gazeY+.45);
   if(eye>SAMPLE.sea-.45)continue;
   const blocked=near.some(({site,radius})=>{
    const along=Math.max(0,Math.min(range,(site.x-shell.x)*dx+(site.z-shell.z)*dz));
    return Math.hypot(site.x-shell.x-dx*along,site.z-shell.z-dz*along)<radius+.04;
   });
   if(blocked)continue;
   return {p:[x,z],gaze:[shell.x,gazeY,shell.z],diveLevel:SAMPLE.sea,eyeBelowSurface:SAMPLE.sea-eye};
  }
 }
 return null;
}
export function sampleVisits(data){
 const t=data.terrain,fly=(id,title,p,gaze,note)=>({id,title,p,gaze,fly:true,time:12.6,note}),ground=(id,title,p,gaze,note)=>({id,title,p,gaze,time:12.6,note});
 const visits={
  'sample-life':ground('sample-life','岩阶浅池的古鱼',[-653,-480],[-656,52,-482],'在细泉入池处观察 Diplomystus 的游鳍和摆尾。'),
  'sample-source':ground('sample-source','岩隙里的细泉',[-639.5,-494.5],[-642,55.3,-500],'从嵌坡岩体下的湿隙看细泉，沿短沟走向下方浅池。此处采用现代地貌类比。'),
  'sample-pool':ground('sample-pool','岩阶下的浅池',[-651,-478],[-656,52.2,-482],'细沟在岩阶下形成较深的小池，再从另一侧溢出。靠近时留意石边的小生命。'),
  'sample-forest':ground('sample-forest','溪谷巨木与幼树',[-710,-319],[-727,t.heightAt(-727,-325)+22,-325],'沿湿润谷地看粗干、幼树、根盘和倒木。巨木尺度与群落属于现代森林结构类比。'),
  'sample-jam':ground('sample-jam','倒木下游的冲刷潭',[-690,-275],[-701,30,-267],'斜落的木体与下游较深的床面共用同一组设计坐标。这是床形类比，不是实时泥沙或流体模拟。'),
  'sample-roots':ground('sample-roots','巨木坡脚与根盘',[-716,-321],[-727,t.heightAt(-727,-325)+1.5,-325],'从溪岸靠近巨木坡脚，观察根盘如何贴合真实坡面，沿倒木和幼树间的空隙通过。'),
  'sample-stream':ground('sample-stream','弯流与石滩',[-742,-153],[-751,18.3,-160],'从岸边看弯道、水深变化与非周期石滩。谷地外缘接回原岛屿。'),
  'sample-mouth':ground('sample-mouth','溪水进入浅湾',[-823,119],[-858,-.45,123],'溪床连续下降，咸淡水接管在同一床面上展开。前方是浅海砂槽。'),
  'sample-under':{id:'sample-under',title:'浅湾水下砂槽',p:[-966,147.35],gaze:[-969.6,-2.45,145.2],diveLevel:SAMPLE.sea,eyeBelowSurface:.75,time:12.6,note:'游过河口砂槽，观察尖吻鱼和镰鳍鲨，再沿浅坡上岸。'},
  'sample-overview':fly('sample-overview','从岩隙泉到浅海',[-1090,195,-90],[-704,28,-180],'这条有限样板约一公里，包含泉口、细沟、池潭、巨木溪谷、河口与浅海。'),
  'sample-mouth-aerial-land':fly('sample-mouth-aerial-land','河口俯瞰向岸',[-943.92,116.62,140.27],[-864.52,51.21,130.49],'固定机位，检查溪道、沙滩与海岸接续。'),
  'sample-mouth-aerial-sea':fly('sample-mouth-aerial-sea','河口俯瞰向海',[-943.92,116.62,140.27],[-1023.30,42.20,150.23],'与向岸视角同机位，检查浅海床面与浪线。'),
  'sample-boundary':fly('sample-boundary','样板与原岛接续',[-526,155,-185],[-665,45,-210],'沿制作域边界横向往返，检查地形、植被和光照接续。'),
  'sample-rill-close':fly('sample-rill-close','细沟近看',[-643,55.45,-495],[-646.1,54.5,-494.6],'固定低位观察岩体出水、薄沟与湿壁。'),
  'sample-canopy':fly('sample-canopy','溪谷林冠往返',[-940,67,-325],[-727,t.heightAt(-727,-325)+26,-325],'沿同一巨木接近后退，核查主要树形、根盘和林冠交接。'),
 };
 const g=data.sampleLife?.pool;
 if(g){let best=null;for(let i=0;i<24;i++)for(const r of [1.1,1.4,1.8]){const a=i*Math.PI/12,x=g.x+Math.cos(a)*r,z=g.z+Math.sin(a)*r,y=t.heightAt(x,z),depth=g.h-y;if(depth<-.4||depth>.4)continue;const score=Math.abs(depth-.1)+r*.08;if(!best||score<best.score)best={p:[x,z],score};}if(best)visits['sample-life']=ground('sample-life','岩阶浅池的古鱼',best.p,[g.x,g.floor+.16,g.z],'低头看 Diplomystus 的局部游动。');}
 const bankFooting=(cx,cz,alongSign,preferredSide=0,minAlong=0)=>{
  const route=data.field.continuousSample?.nearest(cx,cz),dir=route?.dir??[-1,0];
  let best=null;
  for(let i=0;i<48;i++)for(let r=5;r<=34;r+=.5){
   const a=i*Math.PI/24,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,h=t.heightAt(x,z),water=data.field.sample(x,z)[0],clear=h-water;
   const slope=Math.hypot(t.heightAt(x+.6,z)-t.heightAt(x-.6,z),t.heightAt(x,z+.6)-t.heightAt(x,z-.6))/1.2;
   if(clear<.16||clear>1.35||slope>.42)continue;
   const fx=(cx-x)/r,fz=(cz-z)/r,along=(fx*dir[0]+fz*dir[1])*alongSign;
   const side=(x-cx)*dir[1]-(z-cz)*dir[0];
   if(preferredSide&&side*preferredSide<=0||along<minAlong)continue;
   // A side-on view ended on the opposite sand bank. Keep actual fish in the
   // sight line and favour a wet channel continuing beyond their position.
   let continuation=0;
   for(const d of [3,6,9,12]){
    const px=cx+fx*d,pz=cz+fz*d,f=data.field.sample(px,pz),depth=f[0]-t.heightAt(px,pz);
    if(f[1]<.05&&depth>.45)continuation+=Math.min(1,depth/1.4);
   }
   const score=r+Math.abs(clear-.32)*1.8+slope*2+Math.max(0,.35-along)*8-continuation*2.15;
   if(!best||score<best.score)best={p:[x,z],score,ground:h,water,clear,slope,along,side,continuation,distance:r};
  }
  return best??{p:[cx+22,cz],fallback:true};
 };
 const lower=data.sampleLife?.lowerCreek;
 for(const [key,prefix,title] of [['siltPool','sample-mid-creek','溪潭里的棘鱼'],['logPool','sample-log-fish','倒木潭里的盾皮鱼']]){
  const school=data.sampleLife?.[key];if(!school)continue;
  const bank=bankFooting(school.x,school.z,-1);
  const gazeY=key==='siltPool'?school.floor+.34:(school.h+school.floor)*.5;
  visits[prefix+'-life']={...ground(prefix+'-life',title,bank.p,[school.x,gazeY,school.z],'沿缓岸看水生动物在溪潭中停留和巡游。'),habitatAvailable:true,footing:bank};
  const r=data.field.continuousSample.nearest(school.x,school.z);let spot=null;
  for(const offset of [1.7,1.3,.9,.6,0]){
   const x=school.x+r.dir[1]*offset,z=school.z-r.dir[0]*offset,depth=data.field.sample(x,z)[0]-t.heightAt(x,z);
   if(depth>1.05){spot={x,z,depth};break;}
  }
  if(spot)visits[prefix+'-under']={id:prefix+'-under',title:title+' · 水下',p:[spot.x,spot.z],gaze:[school.x,gazeY,school.z],diveLevel:school.h,eyeBelowSurface:Math.min(1.15,spot.depth-.4),time:12.6,note:'近看游鳍、摆尾与贴近河床的动作。',habitatAvailable:true};
 }
 const lowerPoint=lower??{x:-799,z:75,floor:t.heightAt(-799,75)};
 // The east bank downstream of the school looks upstream into the creek's
 // brighter valley; the opposite bank backed the fish with a dark escarpment.
 const lowerBank=bankFooting(lowerPoint.x,lowerPoint.z,-1,1,.5);
 visits['sample-lower-creek-life']={...ground('sample-lower-creek-life',lower?'下游溪潭的古鱼':'下游溪潭',lowerBank.p,[lowerPoint.x,lower?lower.h-.55:lowerPoint.floor+.35,lowerPoint.z],lower?'从干岸沿溪道看扩宽溪潭里的 Diplomystus。':'当前鱼群未找到合适水深，回退到溪潭地貌观察。'),habitatAvailable:!!lower,footing:lowerBank};
 if(lower){
  const route=data.field.continuousSample?.nearest(lower.x,lower.z),dir=route?.dir??[-.5,.86];
  let underwater=null;
  for(const r of [3.2,3.6,4,4.4]){
   const x=lower.x+dir[1]*r,z=lower.z-dir[0]*r,f=data.field.sample(x,z),floor=t.heightAt(x,z);
   if(f[1]<.05&&f[0]-floor>1.15&&lower.h-.8>floor+.25){underwater={x,z,floor,depth:f[0]-floor};break;}
  }
  if(underwater)visits['sample-lower-creek-under']={id:'sample-lower-creek-under',title:'下游溪潭水下古鱼',p:[underwater.x,underwater.z],gaze:[lower.x,lower.h-.65,lower.z],diveLevel:lower.h,eyeBelowSurface:.8,time:12.6,note:'贴近溪潭观察 Diplomystus 的摆尾与游鳍，再沿缓岸回到步行路线。',habitatAvailable:true,underwater};
 }
 const transition=data.sampleLife?.transition;
 const transitionPoint=transition??{x:-858,z:123,floor:t.heightAt(-858,123)};
 const transitionBank=bankFooting(transitionPoint.x,transitionPoint.z,1);
 visits['sample-estuary-life']={...ground('sample-estuary-life',transition?'咸淡水交界的鱼':'河口浅岸',transitionBank.p,[transitionPoint.x,transition?transition.h-.55:transitionPoint.floor+.35,transitionPoint.z],transition?'从干岸顺河口看 Eusthenopteron。':'当前过渡带鱼群未找到合适水深，回退到河口浅岸观察。'),habitatAvailable:!!transition,footing:transitionBank};
 const bed=data.sampleLife?.marineBed??{x:-966,z:146,floor:t.heightAt(-966,146)};
 const bedEye=[bed.x+1.9,bed.z+1.1];
 const colony=data.sampleBenthicDetails?.coralSites.reduce((nearest,site)=>{
  if(site.span<.3)return nearest;
  const distance=Math.hypot(site.x-bedEye[0],site.z-bedEye[1]);
  return distance>1&&distance<12&&(!nearest||distance<nearest.distance)?{site,distance}:nearest;
 },null)?.site;
 const bedGaze=colony?[colony.x,colony.floor+colony.span*.24,colony.z]:[bed.x,bed.floor+.1,bed.z];
 visits['sample-benthos']={id:'sample-benthos',title:colony?'浅海底栖观察':'浅海底床观察',p:bedEye,gaze:bedGaze,diveLevel:SAMPLE.sea,eyeBelowSurface:1.95,time:12.6,note:colony?'贴近海床观察珊瑚群落，再沿沙隙游向浅湾。':'沿浅湾砂槽观察海床与沙纹。',habitatAvailable:!!colony};
 const garden=data.sampleBenthicDetails?.reefGardens[0];
 if(garden){
  // An outer honeycomb colony has open water on the observer's side and
  // the rest of the garden behind its sunlit crown.
  const edgeX=garden.x-2.8,edgeZ=garden.z+.5;
  const coral=data.sampleBenthicDetails.coralSites.filter(site=>site.garden===0&&site.kind==='favosites')
   .sort((a,b)=>Math.hypot(a.x-edgeX,a.z-edgeZ)-Math.hypot(b.x-edgeX,b.z-edgeZ))[0];
  const range=coral?coral.span*2:4;
  const target=coral??garden;
  const gazeY=coral?(coral.centerY===undefined?coral.floor+coral.span*.36:coral.centerY+coral.halfHeight*.57):garden.floor+.4;
  const p=[target.x-Math.sqrt(3)*.5*range,target.z+.5*range];
  const eye=Math.min(SAMPLE.sea-.4,Math.max(t.heightAt(...p)+.65,gazeY+.74*range));
  visits['sample-coral']={id:'sample-coral',title:'浅海珊瑚花园',p,gaze:[target.x,gazeY,target.z],diveLevel:SAMPLE.sea,eyeBelowSurface:SAMPLE.sea-eye,time:12.6,note:'近看蜂巢珊瑚相连的小室，再沿沙隙游过整片群落。'};
 }
 const shells=shellObservation(data);
 if(shells)visits['sample-shells']={id:'sample-shells',title:'贝壳沉积带',...shells,time:12.6,note:'近看月螺壳顶的螺旋，再沿沙地寻找扇形的双壳。'};
 // Widening moves the waterline. Re-seat former fixed dry-bank arrivals
 // against the same physical field used by the water and player collision.
 for(const visit of Object.values(visits)){
  if(visit.fly||visit.diveLevel!==undefined||visit.footing)continue;
  const f=data.field.sample(...visit.p),floor=t.heightAt(...visit.p);
  if(f[1]<.05&&f[0]-floor>.05){const r=data.field.continuousSample.nearest(...visit.p),bank=bankFooting(r.x,r.z,1);visit.p=bank.p;visit.footing=bank;}
 }
 if(data.sampleStrandVisit) visits[data.sampleStrandVisit.id]=data.sampleStrandVisit;
 Object.assign(visits,data.sampleMuseumLifeVisits??{},data.sampleHabitatEnrichmentVisits??{});
 return visits;
}
