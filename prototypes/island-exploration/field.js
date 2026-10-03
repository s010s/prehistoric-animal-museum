import {springAt,springTerrain,forestSpring,springOrigin} from './spring.js'
import {sculptRegion} from './sample-region.js'
// Original flight-world seed and coastal-valley primitives, composed into an authored island.
import {createWorldSampler,WORLD} from '../../src/flight-experience/world.ts'
import {riverReach} from './hydrology.js'
import {erosionDelta} from './erosion-field.js'
const original=createWorldSampler(WORLD)
export const SIZE=20480,SEA=-.7,STEP=64
export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v))
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t)}
export const noise=(x,z)=>original.noise(x,z,91)
export const hash=(x,z)=>original.hash(Math.floor(x*731),Math.floor(z*193),71)
export const fbm=(x,z)=>noise(x,z)*.57+noise(x*2.03+17,z*2.03)*.28+noise(x*4.11,z*4.11-9)*.15
export const riverX=z=>-1830+190*Math.sin(z/640)+72*Math.sin(z/230)-smooth(2400,4000,z)*1550
export const riverLevel=z=>17.3*(1-smooth(-1550,2800,z))+190*(1-smooth(-3800,-1550,z))-.7
export const headwaters={x:riverX(-3980),z:-3980,level:riverLevel(-3980)}
export const hero=z=>smooth(-1450,-1050,z)*(1-smooth(0,400,z))
export const halfWidth=z=>(15+24*Math.exp(-1*((z+3950)/65)**2)+8*noise(z/125,9)+1.8*noise(z/14,7)+smooth(1600,3500,z)*60+15*Math.exp(-1*((z+1800)/260)**2))*(1-.52*hero(z))
export const lake={x:850,z:-2600,level:385,rx:390,rz:640}
export const wetland={x:3600,z:5400,rx:2250,rz:1500,level:2.4}
export const wetlandLevel=z=>2.4-3.1*smooth(6200,7200,z)
export const tarn={x:1600,z:-5930,rx:330,rz:490,level:455}
export const marshTrunk=z=>3500+240*Math.sin(z/810)+90*noise(z/260,41)
export const tributaryX=z=>{const old=6300+360*Math.sin(z/730)+110*Math.sin(z/210);return old+(marshTrunk(z)+300-old)*smooth(4000,5550,z)+(95*Math.sin(z/175)+45*Math.sin(z/83))*smooth(3700,4200,z)*(1-smooth(4900,5500,z))}
export const tributaryWidth=z=>17+14*noise(z/290,27)+7*noise(z/93,51)
export const tributaryLevel=z=>2.4+82*(1-smooth(500,3630,z))
export function biomeAt(x,z){
 const grass=(1-smooth(.65,1.2,Math.hypot((x-5700)/2700,(z-1900)/2900)))*(1-smooth(4800,5650,z))
 const marsh=1-smooth(.78,1.13,Math.hypot((x-wetland.x)/wetland.rx,(z-wetland.z)/wetland.rz))
 const heath=1-smooth(.5,1.2,Math.hypot((x-1400)/2700,(z+5900)/2400))
 return {grass,marsh,heath}
}
export const bankAt=(x,z)=>Math.hypot(x-riverX(z),Math.max(0,-4000-z)*2)-halfWidth(z)
const mixHeight=(a,b,t)=>a+(b-a)*t
function terrainBase(x,z){
 const cliffBand=smooth(-3250,-2880,z)*(1-smooth(-1200,-820,z))*(1-smooth(-2630,-2100,x))*smooth(-3100,-2700,x)
 const coastalFold=((noise(z/185,37)-.5)*340+(noise(z/67,42)-.5)*135)*cliffBand
 const sx=x+2800+coastalFold,sz=z*.65-1000,n=original.noise
 const inland=sx-original.coastAt(sz)+(noise(sz/140,5)-.5)*80,land=smooth(-95,205,inland),upland=smooth(110,870,inland)
 const canyon=smooth(900,2100,-sz)*(.65+.35*n(sx/4000,sz/4000,13))
 const valley=1-smooth(0,280-canyon*125,Math.abs(sx-original.valleyAt(sz)))
 const ridge=1-Math.abs(n(sx/1050,sz/1050,9)*2-1)
 let ground=12+upland*(125+ridge*245+120*n(sx/2300,sz/2300,11))*(1-valley*(.64+canyon*.17))+16*(n(sx/180,sz/180,7)-.5)*land
 const warped=x+(noise(x/1300,z/1100)-.5)*650
 const spine=690*Math.exp(-1*((warped-600)/1600)**2-((z+600)/2800)**2)+350*Math.exp(-1*((x-2400)/1300)**2-((z+2600)/1500)**2)
 const fold=1-Math.abs(noise((x+noise(x/350,z/400)*160)/440,z/600)*2-1)
 ground+=spine*(.62+.45*fold)+((1-Math.abs(noise(x/140+noise(x/400,z/400)*2,z/190)*2-1))*65+(1-Math.abs(noise(x/55,z/77)*2-1))*25)*smooth(100,550,spine)
 let h=(-80+25*n(sx/500,sz/500,2))*(1-land)+ground*land
 h+=(fbm(x/45,z/65)-.5)*48*smooth(-20,100,h)*(1-smooth(250,850,inland))
 // Deliberate north/east/south coast, keeping the old world's west coastal geology.
 const radius=Math.hypot((x-500)/4700,z/5400),angle=Math.atan2(z/5400,(x-500)/4700)
 const edge=1+.055*Math.sin(angle*5+.7)+.018*Math.sin(angle*11)
 const eastAngle=Math.atan2((z-1800)/5500,(x-3000)/6100),east=(1+.055*Math.sin(eastAngle*7+.4)-Math.hypot((x-3000)/6100,(z-1800)/5500))*3000
 const northAngle=Math.atan2((z+3500)/4800,(x-1300)/4400),north=(1+.045*Math.sin(northAngle*9)-Math.hypot((x-1300)/4400,(z+3500)/4800))*3000
 const coast=Math.max((edge-radius)*3000,east,north),beach=smooth(1000,3700,x)*smooth(-1800,2500,z)
 const rocky=coast*(.32+.9*smooth(-100,450,coast)),sandy=coast*.065+smooth(150,900,coast)*.28*Math.max(0,coast-180)
 const coastHeight=rocky*(1-beach)+sandy*beach
 h=Math.min(h,Math.max(-90,coastHeight))
 const bay=Math.hypot((x-9750)/850,(z-1500)/1200)
 const bayBlend=1-smooth(1.25,2.7,bay);h=h*(1-bayBlend)+Math.min(h,(bay-1)*90+(fbm(x/110,z/140)-.5)*18*smooth(1.2,2.,bay))*bayBlend
 const bank=bankAt(x,z),riverMask=smooth(-4100,-3700,z)*(1-smooth(4050,4400,z))
 const w=halfWidth(z),ratio=Math.abs(x-riverX(z))/w,level=riverLevel(z)
 const depth=riverReach(z).depth,bed=level-depth+(depth-.1)*Math.pow(clamp(ratio),2.8)+.16*(noise(x*.25,z*.18)-.5)
 const shelf=3+noise(z/23,11)*4,eroded=smooth(shelf,shelf+1.8,bank)*(1.1+noise(x/15,z/17)*1.4)*hero(z)
 // Inside bends accumulate wider bars; the opposite cut bank stays steeper.
 const side=Math.sign(x-riverX(z)),curvature=(riverX(z+90)+riverX(z-90)-2*riverX(z))/30
 const deposition=clamp(.45+side*curvature*.8+(noise(z/310,side*17)-.5)*.7)
 const bankSlope=.035+(1-deposition)**2*.24,barWidth=20+deposition*125
 const gravel=level+.08+(noise(x/17,z/23)-.5)*.42+Math.max(0,bank)*bankSlope+eroded
 const valleyFloor=Math.min(h,bank<0?bed:gravel+Math.pow(Math.max(0,bank-barWidth),1.22)*.13)
 h=h*(1-riverMask*(1-smooth(220,760,bank)))+valleyFloor*riverMask*(1-smooth(220,760,bank))
 const lakeAngle=Math.atan2((z-lake.z)/lake.rz,(x-lake.x)/lake.rx);
 const basin=Math.hypot((x-lake.x+(noise(x/230,z/190)-.5)*70)/lake.rx,(z-lake.z)/lake.rz)+(noise(x/80,z/95)-.5)*.13+Math.sin(lakeAngle*3+.7)*.13+Math.sin(lakeAngle*7-1.2)*.055
 h=h*smooth(.94,1.8,basin)+(lake.level-12+Math.pow(Math.min(basin,1.7),4)*11)*(1-smooth(.94,1.8,basin))
 // A fractured western watershed gives the river an asymmetric canyon wall.
 // Four overlapping ridges taper into the island rather than forming a flat lid.
 const west=riverX(z)-x-halfWidth(z),ridgeWarp=(noise(x/83,z/117)-.5)*47+(noise(x/23,z/37)-.5)*10
 const cragHeight=220*Math.exp(-1*((z+1060)/230)**2)+290*Math.exp(-1*((z+680)/265)**2)+165*Math.exp(-1*((z+220)/230)**2)
 const lateral=(west+ridgeWarp-210)/180,front=smooth(38,115,west+ridgeWarp),outline=Math.exp(-lateral*lateral)*front
 const fracture=.55+.45*(1-Math.abs(noise(x/55,z/130)*2-1))
 h+=cragHeight*outline*fracture
 // Expose existing eroded drainage instead of burying it under a smooth base.
 const erosion=erosionDelta(x,z),uplandRelief=smooth(160,420,h)*(1-smooth(1050,1400,h));
 h+=erosion*smooth(110,260,h)*1.65;
 // Warped meso-scale ribs break the rounded ridge flanks; lower banks remain intact.
 const drainageWarp=(noise(x/310,z/370)-.5)*110;
 const ribs=1-Math.abs(noise((x+drainageWarp)/87,(z-drainageWarp*.5)/145)*2-1);
 h+=(ribs-.56)*22*uplandRelief;

 // Eroded bedding ledges follow the coastal rock mass, not freestanding blocks.
 h+=cliffBand*smooth(70,130,h)*(1-smooth(330,430,h))*((noise(x/37+h/83,z/51)-.5)*18+(noise(x/13,z/29)-.5)*5)
 // Patchy rock ledges remain part of the land itself (not inserted slabs).
 const inlandRock=smooth(32,88,west)*(1-smooth(430,650,west))*smooth(-1650,-1300,z)*(1-smooth(120,430,z));
 const rockWeight=Math.max(cliffBand*smooth(45,105,h)*(1-smooth(370,500,h)),inlandRock*smooth(65,120,h));
 const lift=16+13*noise(x/97,z/97),warp=(noise(x/41,z/41)-.5)*10+(noise(x/17,z/17)-.5)*3;
 const band=(h+warp)/lift,ledge=(Math.floor(band)+smooth(.48,.82,band-Math.floor(band)))*lift-warp;
 h+=(ledge-h)*.82*rockWeight;
 // Differential erosion leaves broad bedding shelves and narrow vertical joints.
 // World-space ridges vary with height, so the face cannot read as a smooth cone.
 const jointWarp=(noise(x/85,z/130)-.5)*26;
 const buttress=1-Math.abs(noise((x+jointWarp)/27,(z+jointWarp)/98)*2-1);
 const fissure=Math.pow(clamp((noise((x+jointWarp)/19,z/74)-.50)*2.3),2);
 h+=((buttress-.5)*36-fissure*42)*rockWeight;
 // Ravines cut the coastal escarpment into unequal headlands and recessed coves.
 const notch=Math.pow(noise(z/155,91),3)*125+Math.pow(noise(z/51,53),4)*32;
 h-=cliffBand*smooth(65,150,h)*(1-smooth(380,530,h))*notch;
 // Eastern rain-shadow prairie: broad rolling folds, a continuous tributary and wet lowlands.
 const eco=biomeAt(x,z),dryFloor=95+95*fbm(x/1500,z/1600)+37*noise(x/420,z/530)+17*noise((x+noise(x/290,z/330)*80)/130,z/190)+5*noise(x/47,z/63)
 h=h*(1-eco.grass)+Math.min(h,dryFloor)*eco.grass
 const tw=tributaryWidth(z)+smooth(4000,4700,z)*85,tx=tributaryX(z),tb=Math.abs(x-tx)-tw,tm=smooth(100,500,z)*(1-smooth(5400,5750,z))*(1-smooth(90,380,tb)),tl=tributaryLevel(z)
 const deposit=clamp(.5+Math.sign(x-tx)*(tributaryX(z+70)+tributaryX(z-70)-2*tx)/35+(noise(z/220,33)-.5)*.5)
 const deltaDepth=2.1*(1-smooth(4550,5000,z));
 const tf=tl-deltaDepth+smooth(-tw,0,tb)*(deltaDepth+.1)+Math.max(0,tb)*(.028+.16*(1-deposit)**2)+Math.pow(Math.max(0,tb-30-deposit*90),1.3)*.11
 h=h*(1-tm)+Math.min(h,tf)*tm
 // A connected backwater complex, with muddy islands, reed shelves and sinuous channels.
 // Broad connected shallow depressions, peat hummocks and one drainage trunk.
 // No transverse canal: pool outlines emerge from the floodplain elevation.
 const poolNoise=fbm((x+noise(x/600,z/530)*160)/210,(z+noise(x/510,z/610)*130)/185)
 const hummocks=(poolNoise-.48)*8.8+(noise(x/23,z/31)-.5)*.70+(noise(x/8,z/11)-.5)*.12
 const drainage=Math.abs(x-marshTrunk(z)),channelWidth=45+60*noise(z/340,13)
 const trunk=-1.45+smooth(channelWidth*.25,channelWidth+120,drainage)*3.4
 const shelves=wetlandLevel(z)+Math.min(hummocks,trunk)
 h=h*(1-eco.marsh)+Math.min(h,shelves)*eco.marsh
 const glacialWall=230*Math.exp(-1*((x-1050+(noise(x/270,z/330)-.5)*220)/790)**2-((z+6710)/470)**2);
 const glacialSpur=135*Math.exp(-1*((x-2150)/480)**2-((z+6400)/730)**2);
 const glacialRibs=.48+.52*(1-Math.abs(noise((x+noise(x/210,z/330)*90)/170,z/340)*2-1));
 const plateau=480+fbm(x/1400,z/1300)*85+(glacialWall+glacialSpur)*glacialRibs;h+=(Math.max(h,plateau)-h)*eco.heath*smooth(20,80,h);
 const tarnAngle=Math.atan2((z-tarn.z)/tarn.rz,(x-tarn.x)/tarn.rx);
 const tr=Math.max(0,Math.hypot((x-tarn.x+(noise(x/190,z/210)-.5)*85)/tarn.rx,(z-tarn.z)/tarn.rz)+Math.sin(tarnAngle*3+.4)*.19+Math.sin(tarnAngle*7)*.055+(noise(x/63,z/77)-.5)*.16),tmix=1-smooth(.94,1.65,tr)
 h=h*(1-tmix)+(tarn.level-9+10*Math.min(tr,1.65)**3.5)*tmix
 // Re-cut the spring basin after the northern plateau, with a closed rock headwall.
 if(z<-3500&&z>-4220){
  const source=smooth(-4220,-4100,z)*(1-smooth(-3600,-3500,z));
  const margin=1-smooth(12,110,bank),floor=(bank<0?bed:level+.12+Math.max(0,bank)*.24)+Math.max(0,-3980-z)*.26;
  h=mixHeight(h,Math.min(h,floor),source*margin);
 }

 return springTerrain(x,z,sculptRegion(x,z,h,riverX,riverLevel,halfWidth,noise))
}
// A dry, level observation clearing; the same surface is used by terrain, plants and collision.
export const encounter={x:riverX(-560)+halfWidth(-560)+44,z:-560};
encounter.y=terrainBase(encounter.x,encounter.z);
export const companion={x:-1949,z:-605};companion.y=terrainBase(companion.x,companion.z);
export function terrainHeight(x,z){let h=terrainBase(x,z);
 // A shallow gravel riffle keeps the two walking banks connected. Only the bed
 // is raised here; river centreline, banks and water elevation are unchanged.
 const ford=(1-smooth(8,18,Math.abs(z+675)))*(1-smooth(halfWidth(z)+2,halfWidth(z)+9,Math.abs(x-riverX(z))));
 if(ford>0)h=mixHeight(h,Math.max(h,riverLevel(z)-.12+.055*Math.sin(x*1.3+z*.7)),ford);
 for(const [site,inner,outer]of [[encounter,18,40],[companion,8,18]]){const d=Math.hypot(x-site.x,z-site.z);h=mixHeight(site.y,h,smooth(inner,outer,d));}return h}
export function meshHeight(x,z,step=STEP){const gx=Math.floor(x/step)*step,gz=Math.floor(z/step)*step,u=(x-gx)/step,v=(z-gz)/step,a=terrainHeight(gx,gz),b=terrainHeight(gx+step,gz),c=terrainHeight(gx,gz+step),d=terrainHeight(gx+step,gz+step);return u+v<=1?a+u*(b-a)+v*(c-a):d+(1-u)*(c-d)+(1-v)*(b-d)}
export function slopeAt(x,z){return 1/Math.hypot((terrainHeight(x+2,z)-terrainHeight(x-2,z))/4,1,(terrainHeight(x,z+2)-terrainHeight(x,z-2))/4)}
export function waterLevelAt(x,z){let level=SEA;const spring=springAt(x,z);if(spring&&spring.edge<1)level=spring.level;if(z>-3930&&z<4320&&Math.abs(x-riverX(z))<halfWidth(z)+25)level=Math.max(level,riverLevel(z));if(Math.abs(x-lake.x)<lake.rx*1.75&&Math.abs(z-lake.z)<lake.rz*1.75)level=Math.max(level,lake.level);if(Math.abs(x-wetland.x)<wetland.rx*1.18&&Math.abs(z-wetland.z)<wetland.rz*1.18)level=Math.max(level,wetlandLevel(z));if(Math.abs(x-tarn.x)<tarn.rx*1.75&&Math.abs(z-tarn.z)<tarn.rz*1.75)level=Math.max(level,tarn.level);if(z>100&&z<5700&&Math.abs(x-tributaryX(z))<50)level=Math.max(level,tributaryLevel(z));return level}
// Bank materials need the watershed's reference level, not the draw footprint.
// Fade only on dry uplands; the narrow physical water mask remains for collision.
export function bankWaterLevelAt(x,z){
 let level=SEA;const spring=springAt(x,z);if(spring&&spring.edge<24)level=spring.level;
 const riverMask=smooth(-4250,-3970,z)*(1-smooth(4050,4500,z))*(1-smooth(180,720,Math.abs(x-riverX(z))-halfWidth(z)));
 level=Math.max(level,SEA+(riverLevel(z)-SEA)*riverMask);
 const tributaryMask=smooth(-100,350,z)*(1-smooth(5550,5950,z))*(1-smooth(110,440,Math.abs(x-tributaryX(z))-tributaryWidth(z)));
 level=Math.max(level,SEA+(tributaryLevel(z)-SEA)*tributaryMask);
 for(const body of [lake,tarn,wetland]){const d=Math.hypot((x-body.x)/body.rx,(z-body.z)/body.rz),mask=1-smooth(1.45,2.25,d);level=Math.max(level,SEA+((body===wetland?wetlandLevel(z):body.level)-SEA)*mask)}
 return level;
}
// Coastal material influence is a watershed label, never a water-mesh owner.
export function coastalInfluenceAt(x,z){
 const valley=(1-smooth(140,740,bankAt(x,z)))*smooth(-4300,-3900,z)*(1-smooth(1700,2850,z));
 const eastern=(1-smooth(100,470,Math.abs(x-tributaryX(z))-tributaryWidth(z)))*smooth(0,400,z)*(1-smooth(4500,5550,z));
 let inland=Math.max(valley,eastern,biomeAt(x,z).marsh);
 for(const body of [lake,tarn])inland=Math.max(inland,1-smooth(1.3,2.1,Math.hypot((x-body.x)/body.rx,(z-body.z)/body.rz)));
 return 1-inland;
}
export const surfaceHeight=(x,z)=>Math.max(terrainHeight(x,z),waterLevelAt(x,z))
export function woodland(x,z){const h=terrainHeight(x,z),bank=bankAt(x,z);if(h<waterLevelAt(x,z)+1)return 0;const eco=biomeAt(x,z);return smooth(28,58,Math.hypot(x-encounter.x,z-encounter.z))*(1-eco.marsh*.98)*(1-eco.grass*.99)*(1-eco.heath*.82)*smooth(3,18,h)*(1-smooth(1020,1240,h))*smooth(.48,.82,slopeAt(x,z))*smooth(.24,.62,noise(x/270,z/340))*smooth(4,18,bank)}
const rz=-500,rx=riverX(rz),ry=riverLevel(rz)
export const landmarks=[
 {id:'encounter',name:'溪畔的巨影',note:'停在林缘，观察一只迷惑龙',p:[encounter.x-23,encounter.y+3.6,encounter.z+24],t:[encounter.x,encounter.y+4.3,encounter.z]},
 {id:'forest',name:'杉林溪谷',note:'近岸岩石、浅滩和成熟针叶林',p:[riverX(rz+58)+2,riverLevel(rz+58)+4.2,rz+58],t:[riverX(rz-90),ry+1,rz-90]},
 {id:'estuary',name:'河海交汇',note:'长河谷通往潮汐沙洲',p:[riverX(3350)+50,105,3500],t:[riverX(2900),8,2850]},
 {id:'bay',name:'东岸长湾',note:'开阔海岸、低地与遥远的山脊',p:[9160,5,2330],t:[8920,-20,2040]},
 {id:'lagoon',name:'高地湖泊',note:'山谷中的高地静水',p:[lake.x+250,430,lake.z+220],t:[lake.x,390,lake.z-100]},
 {id:'summit',name:'中央山脉',note:'山脊、支脉与森林低地',p:[1100,1250,-850],t:[-1700,90,100]},
 {id:'grassland',name:'东部草原',note:'起伏草坡、疏林和蜿蜒支流',p:[5940,180,2200],t:[6800,110,1300]},
 {id:'wetland',name:'沼泽水乡',note:'浅水支汊、芦苇泥洲与湿地草甸',p:[3345,7,5200],t:[3449,2.5,5320]},
 {id:'mudflat',name:'淤泥浅滩',note:'泥岸水洼与退向大海的低地',p:[2635,7,6200],t:[2680,2.1,6380]},
 {id:'heath',name:'北部高原',note:'山间草甸、岩脊和冰斗状小湖',p:[1900,565,-5500],t:[1600,456,-6200]},
 {id:'cliffs',name:'西岸岩岬',note:'原史前天地的岩岸地形',p:[-3100,140,-2100],t:[-2460,70,-2500]},
 {id:'side-spring',name:'岩壁清泉',note:'沿浅池、短跌水和林间小径，走向动物空地',p:[forestSpring.x+14,29.0,forestSpring.z+15],t:[forestSpring.x+5,28.0,forestSpring.z+8]},
 {id:'north-source',name:'北部泉源',note:'独立的北部泉池，距小侧泉约 3.3 公里',p:[springOrigin.x+10,211.8,springOrigin.z+10],t:[springOrigin.x,209.6,springOrigin.z-5]}
]
