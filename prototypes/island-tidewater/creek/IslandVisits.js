// Museum visitor routes in one continuous world. Arrival points are checked
// against the same physical terrain and inland water used for navigation.
import {sampleVisits} from './SampleVisits.js';
export function createIslandVisits(data){
 const t=data.terrain,field=data.field;
 const dryNear=(x,z,level,radius=100)=>{let best=null;for(let j=-radius;j<=radius;j+=4)for(let i=-radius;i<=radius;i+=4){const px=x+i,pz=z+j,h=t.heightAt(px,pz),f=field.sample(px,pz),s=Math.hypot(t.heightAt(px+2,pz)-t.heightAt(px-2,pz),t.heightAt(px,pz+2)-t.heightAt(px,pz-2))/4;if(h<level+.7||h>level+7||(f[1]<0&&h<f[0]+.35)||s>.6)continue;const score=Math.hypot(i,j)+Math.abs(h-level-2)*9+s*30;if(!best||score<best.score)best={p:[px,pz],score,h};}return best?.p??[x,z];};
 const visits={};
 visits['review-cove-safe']={id:'review-cove-safe',title:'浅湾与海底石脊',note:'从海上俯视浅湾与岸肩，沿岸平移检查水色、床面和落石的连续性。',p:[-980,65,100],gaze:[-890,-2,-20],fly:true,time:10.7};
 visits['review-cove-boundary']={id:'review-cove-boundary',title:'浅湾波场接续',note:'沿岸平移检查局部精细传播场与整岛波场的连续接续。',p:[-1000,100,330],gaze:[-830,-1,330],fly:true,time:10.7};
 visits['cove-close']={id:'cove-close',title:'西岸浅砂岩湾',note:'顺着浅砂舌看向海底石脊和落石。左前方有鱼群；可降低飞速接近观察。',p:[-833,24,60],gaze:[-920,-2,-35],fly:true,time:10.7};
 visits['review-cove']={id:'review-cove',title:'西岸浅砂岩湾',note:'浅砂舌、海底石脊与成组落石之间留出清水通道。降落后可沿岸涉水。',p:[-807,38,100],gaze:[-941,-1,-20],fly:true,time:10.7};
 for(const b of data.island.lakes){const p=dryNear(b.center[0]+b.rx,b.center[1]+b.rz*.12,b.level,180),near=b.id==='lake'?'lake':'highland-lake';visits[near]={id:near,title:b.name,note:b.id==='lake'?'湖盆与海面使用各自的水位。沿缓岸入水，观察砾坡、鱼群和水下光线。':'寒凉高地的小湖，岸边碎石与残雪过渡到矮针林。可以下潜，也能飞到分水岭。',p,gaze:[b.center[0],b.level+.4,b.center[1]],time:b.id==='lake'?9:15.4,water:b};}
 visits.highland={id:'highland',title:'北部寒凉高地',note:'风化砾坡、矮针林、冰斗湖与背阴残雪。这里是气候地貌展区，并不代表整个史前年代。',p:[3900,-4850],gaze:[3600,455,-5350],time:15.4};
 visits['review-highland-grid']={id:'review-highland-grid',title:'高地草坡 · 固定俯瞰',note:'平移机位检查残雪边缘、草地覆盖和地面细节的稳定性。',p:[4330,795,-5970],gaze:[4310,560,-6360],fly:true,time:15.4};
 visits['review-highland-dry']={id:'review-highland-dry',title:'高地无雪草坡',note:'沿未积雪的草坡步行，观察低草、丛间暗隙与中远覆盖。',p:[3000,-7000],gaze:[3025,t.heightAt(3025,-7040)+1.62,-7040],time:12.6};
 visits['review-highland-ground']={id:'review-highland-ground',title:'高地草坡 · 步行',note:'从矮草地走向背阴残雪，观察近草与远处地面的接续。',p:[4380,-5990],gaze:[4380,t.heightAt(4380,-6110)+1.62,-6110],time:15.4};
 visits.grassland={id:'grassland',title:'东部疏林与高草甸',note:'宽缓丘陵上的高低草丛与疏林，支流沿浅谷进入南部湿地。植物目前是群落外形示意。',p:[7940,2850],gaze:[8800,120,1950],time:8.8};
 visits.wetland={id:'wetland',title:'南部低地湿地',note:'浅水、泥岛、节状挺水丛与主槽。沿干地观察，也可游入水道看小鱼。',p:dryNear(5345,5850,2.4,220),gaze:[5449,2.8,5970],time:8.1};
 visits['dry-upland']={id:'dry-upland',title:'背风旱谷与台地',note:'山脊背面的疏林、旱沟、暖灰砾坡与局部露岩，向东逐渐进入高草甸。',p:[4900,650],gaze:[5200,t.heightAt(5200,320)+35,320],time:16.3};
 const ep=dryNear(11160,2980,-.7,800);visits['east-bay']={id:'east-bay',title:'东岸浅海与礁坡',note:'与西岸不同的凹入海湾、缓坡砂底与水下石脊。鱼群只在有足够水深的连通海水中活动。',p:ep,gaze:[ep[0]+180,-.1,ep[1]-20],time:8.5};
 visits['review-source-bed']={id:'review-source-bed',title:'源头溪床对照',note:'从空中沿浅池缓慢平移，检查溪床纹理、缓滩和连续水线。',p:[260,216,-3282],gaze:[255,207,-3310],fly:true,time:12.6};
 const eastSource=field.tributarySource.origin;
 visits['east-source']={id:'east-source',title:'东部坡脚泉',note:'岩隙细流沿坡脚汇入浅池，碎石与节状挺水植物依水深分布。沿支流可以走向南部湿地。',p:[eastSource.x+6,eastSource.z+26],gaze:[eastSource.x,eastSource.level+1.6,eastSource.z],time:14.2};
 const sc=data.island.source.center;visits['north-source']={id:'north-source',title:'北部岩隙源头',note:'泉水从岩隙中流出，汇入山脚浅池，再沿主河道降向大海。',p:[sc[0]+6,sc[1]-9],gaze:[sc[0]-2,210.6,sc[1]-18],time:12.6};
 visits['giant-forest']={id:'giant-forest',title:'古杉巨木林',note:'沿林隙进入连片巨木林。粗干、幼树、蕨丛、枯立木与倒木组成不同层次；更高的地标木藏在林心。这是一处古森林生态类比展区。',p:[1360,-2090],gaze:[1410,t.heightAt(1410,-2120)+27,-2120],time:9.2};
 visits['giant-root']={id:'giant-root',title:'巨木根盘',note:'走近粗干，再抬头看高处的枝冠。根盘两侧保留通行空间。',p:[1382,-2116],gaze:[1390,t.heightAt(1390,-2116)+3.8,-2116],time:9.2};
 visits['giant-glade']={id:'giant-glade',title:'林隙晨光',note:'晨光经过上层枝冠，在湿润林隙中留下明暗层次。空气微尘随光线与风移动；不同朝向看到的亮度不同。',p:[1407,-2092],gaze:[1444,t.heightAt(1407,-2092)+19,-2087],time:7.8};
 const log=data.groveObservations.log;
 visits['giant-log']={id:'giant-log',title:'倒木与幼树',note:'枯木、苔色和幼树组成林下层次。沿倒木边走，观察端面与底部接触。',p:log.arrival,gaze:log.point,time:9.2};
 const crown=data.groveHeroes.reduce((a,b)=>a.height>b.height?a:b),crownY=t.heightAt(crown.x,crown.z);
 visits['giant-heart']={id:'giant-heart',title:'巨木林心',note:'走到林心，沿粗干仰望高出林冠的地标木。身边有蕨丛、幼树与倒木；这些群落采用古森林的生态类比，并非同一化石地点的复原。',p:[1530,-2260],gaze:[crown.x,crownY+28,crown.z],time:9.2};
 visits['giant-avenue']={id:'giant-avenue',title:'巨干之间',note:'沿林下空隙前行，近处根盘与远处树干不断交叠。大树之间留有更新幼树，也保留自然的林隙。',p:[1490,-2128],gaze:[1520,t.heightAt(1520,-2200)+8,-2200],time:9.2};
 const decay=data.groveObservations.decomposition;
 visits['giant-decomposition']={id:'giant-decomposition',title:'倒木上的生命',note:'靠近潮湿的倒木，可以观察表面的苔色与小型菌体形态。枯木也是森林生境的一部分。',p:decay.arrival,gaze:decay.point,time:9.2};
 visits['giant-canopy']={id:'giant-canopy',title:'巨木林冠上方',note:'从空中看连片林冠、林隙和不同高度的幼树层；降低飞速可回到林下。',p:[1410,t.heightAt(1410,-2055)+130,-2055],gaze:[1460,t.heightAt(1460,-2225)+50,-2225],fly:true,time:9.2};
 visits['giant-extent']={id:'giant-extent',title:'连绵巨木林',note:'沿山麓展开的森林向湖岸与溪谷过渡。成熟木、枯立木和林隙形成连片而有变化的林冠。',p:[950,t.heightAt(950,-1950)+260,-1950],gaze:[1510,t.heightAt(1510,-2200)+40,-2200],fly:true,time:9.2};
 visits['review-grove-lod']={id:'review-grove-lod',target:[1390,-2116],title:'巨木交接往返',note:'从约235米外接近同一粗干，检查近远表示的连续交接。',p:[1155,t.heightAt(1390,-2116)+22,-2116],gaze:[1390,t.heightAt(1390,-2116)+28,-2116],fly:true,time:9.2};
 visits['island-overview']={id:'island-overview',title:'整岛俯瞰',note:'从高空看整座岛屿的分水岭、湖盆、溪谷、湿地与海岸；降低高度可回到各区域细节。',p:[2800,5200,14000],gaze:[2600,160,1200],fly:true,time:14.6};
 visits.summit={id:'summit',title:'全岛分水岭',note:'自由飞行俯瞰山脊、两座湖盆、东部丘陵、湿地和两侧海岸。可在飞速中选择跨岛巡游。',p:[3100,1450,-200],gaze:[4300,150,2200],fly:true,time:15.4};
 for(const shelf of data.cove.shelves){const p=shelf.at(-shelf.along*.19,104),g=shelf.at(-shelf.along*.1,215);visits[shelf.id]={id:shelf.id,title:({ 'west-shelf':'西岸连绵浅湾','east-shelf':'东岸蓝色浅海','south-shelf':'南岸砂洲浅海'})[shelf.id],note:'浅砂槽、海底岩脊与落石沿海岸连续展开。可在附近下潜观察小鱼与浮游碎屑。',p:[p[0],16,p[1]],gaze:[g[0],-2,g[1]],fly:true,time:shelf.id==='east-shelf'?9.5:10.7};}
 for(const station of data.cove.continuous.stations){
  const p=station.at(190,95),g=station.at(65,-75),site=data.cove.continuous.divingSites?.find(s=>s.id===station.id),d=site?.point??station.at(260);
  visits[station.id]={id:station.id,title:station.label+' · 环岛浅海',note:'沿真实岸线展开的浅海床，亮砂槽、局部礁坡和成组落石有不同水深。岸景菜单可进入本处水下。',p:[p[0],72,p[1]],gaze:[g[0],-1.5,g[1]],fly:true,time:station.sector<3?9.5:14.2};
  visits[station.id+'-under']={id:station.id+'-under',title:station.label+' · 浅海水下',note:'沿缓坡游过砂槽与潜石，抬头看水面和光线。WASD 游动，空格上浮，C 下潜。',p:d,gaze:site?.gaze??[d[0]+station.normal[0]*12,-2.2,d[1]+station.normal[1]*12],diveLevel:-.7,time:station.sector<3?9.5:14.2};
 }
 for(const reef of data.reefObservations??[]){visits[reef.id]={...reef,title:({'reef-east':'东岸珊瑚浅礁','reef-south':'南岸砂槽与暗礁','reef-northeast':'东北岸珊瑚与碎礁'})[reef.id],note:'低饱和珊瑚团块、盘状群落与碎礁依附浅海床生长，砂槽留出游览空间。目前采用环境形态代理。',diveLevel:-.7,time:reef.id==='reef-northeast'?14.2:9.5};}
 const life=data.lifeObservations;if(life?.shrimp){const g=life.shrimp;let footing=null;for(let dz=-3;dz<=3;dz+=.25)for(let dx=-3;dx<=3;dx+=.25){const x=g.x+dx,z=g.z+dz,d=Math.hypot(dx,dz),h=t.heightAt(x,z),depth=g.h-h;if(d<.8||d>2.8||depth<-.1||depth>.6)continue;const score=Math.abs(d-1.4)+Math.abs(depth-.35);if(!footing||score<footing.score)footing={p:[x,z],score};}visits['creek-life']={id:'creek-life',title:'溪边浅石下的小生命',note:'站在浅水石边低头观察，约十厘米的小虾就在脚边。也能沿浅岸走近小鱼。',p:footing?.p??[g.x,g.z],gaze:[g.x,g.floor+.04,g.z],time:12.6};}
 if(life?.west){const g=life.west,c=data.coast.coast;visits['coast-birds']={id:'coast-birds',title:'浅湾海鸟掠岸',note:'留在岸边观察低空掠过岩湾的海鸟。开启自然声，可以听见来自实际鸟位的叫声。',p:[c.x+5,c.z],gaze:[c.x-45,7,c.z+7],time:10.7};visits['shore-life']={id:'shore-life',title:'浅湾潜水看鱼',note:'潜入砂槽，在清水中观察小鱼。WASD 游动，空格上浮，C 下潜；岸上的海鸟仍在飞行。',diveLevel:g.h,p:[g.x+4,g.z+1],gaze:[g.x,g.h-1,g.z],time:10.7};}
 Object.assign(visits,sampleVisits(data));
 for(const v of Object.values(visits)){v.ground=t.heightAt(v.p[0],v.p.at(-1));v.waterAtArrival=field.sample(v.p[0],v.p.at(-1))[0];}
 return visits;
}
