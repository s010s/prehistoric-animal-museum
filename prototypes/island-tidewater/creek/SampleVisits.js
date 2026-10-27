import {SAMPLE} from './ContinuousSample.js';
export function sampleVisits(data){
 const t=data.terrain,fly=(id,title,p,gaze,note)=>({id,title,p,gaze,fly:true,time:12.6,note}),ground=(id,title,p,gaze,note)=>({id,title,p,gaze,time:12.6,note});
 const visits={
  'sample-life':ground('sample-life','浅石边的小生命',[-653,-480],[-656,52,-482],'连续样板中的浅池观察点。'),
  'sample-source':ground('sample-source','岩隙里的细泉',[-639.5,-494.5],[-642,55.3,-500],'从嵌坡岩体下的湿隙看细泉，沿短沟走向下方浅池。此处采用现代地貌类比。'),
  'sample-pool':ground('sample-pool','岩阶下的浅池',[-651,-478],[-656,52.2,-482],'细沟在岩阶下形成较深的小池，再从另一侧溢出。靠近时留意石边的小生命。'),
  'sample-forest':ground('sample-forest','溪谷巨木与幼树',[-710,-319],[-727,t.heightAt(-727,-325)+22,-325],'沿湿润谷地看粗干、幼树、根盘和倒木。巨木尺度与群落属于现代森林结构类比。'),
  'sample-jam':ground('sample-jam','倒木下游的冲刷潭',[-690,-275],[-701,30,-267],'斜落的木体与下游较深的床面共用同一组设计坐标。这是床形类比，不是实时泥沙或流体模拟。'),
  'sample-roots':ground('sample-roots','巨木坡脚与根盘',[-716,-321],[-727,t.heightAt(-727,-325)+1.5,-325],'从溪岸靠近巨木坡脚，观察根盘如何贴合真实坡面，沿倒木和幼树间的空隙通过。'),
  'sample-stream':ground('sample-stream','弯流与石滩',[-742,-153],[-751,18.3,-160],'从岸边看弯道、水深变化与非周期石滩。谷地外缘接回原岛屿。'),
  'sample-mouth':ground('sample-mouth','溪水进入浅湾',[-823,119],[-858,-.45,123],'溪床连续下降，咸淡水接管在同一床面上展开。前方是浅海砂槽。'),
  'sample-under':{id:'sample-under',title:'浅湾水下砂槽',p:[-966,146],gaze:[-979,-2.1,148],diveLevel:SAMPLE.sea,time:12.6,note:'游过河口砂槽，抬头看水面，再沿浅坡上岸。环境生物形态不作为物种复原。'},
  'sample-overview':fly('sample-overview','从岩隙泉到浅海',[-1090,195,-90],[-704,28,-180],'这条有限样板约一公里，包含泉口、细沟、池潭、巨木溪谷、河口与浅海。'),
  'sample-boundary':fly('sample-boundary','样板与原岛接续',[-526,155,-185],[-665,45,-210],'沿制作域边界横向往返，检查地形、植被和光照接续。'),
  'sample-rill-close':fly('sample-rill-close','细沟近看',[-643,55.45,-495],[-646.1,54.5,-494.6],'固定低位观察岩体出水、薄沟与湿壁。'),
  'sample-canopy':fly('sample-canopy','溪谷林冠往返',[-940,67,-325],[-727,t.heightAt(-727,-325)+26,-325],'沿同一巨木接近后退，核查主要树形、根盘和林冠交接。'),
 };
 const g=data.sampleLife?.shrimp;
 if(g){let best=null;for(let i=0;i<24;i++)for(const r of [1.1,1.4,1.8]){const a=i*Math.PI/12,x=g.x+Math.cos(a)*r,z=g.z+Math.sin(a)*r,y=t.heightAt(x,z),depth=g.h-y;if(depth<-.4||depth>.4)continue;const score=Math.abs(depth-.1)+r*.08;if(!best||score<best.score)best={p:[x,z],score};}if(best)visits['sample-life']=ground('sample-life','浅石边的小生命',best.p,[g.x,g.floor+.04,g.z],'低头观察浅石旁约十厘米的虾形生物，再看稍远处的小鱼。它们是环境形态示意。');}
 return visits;
}
