// Small, wind-pruned groves on the stable shoulders of the two pocket bays.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';
import {pocketBeachSites} from './PocketBeaches.js';
import {pocketBeachVisits} from './IslandVisits.js';

const bays=[
 {id:'east-pocket-beach',seed:125841,crownRatio:.68,patches:[
  // Alongshore position, inland setback, half-length, half-width, tree limit.
  [-236,107,23,32,4],[-127,92,24,35,5],[-35,104,33,26,4],
  [75,53,15,18,7],[176,68,19,30,4],[160,151,12,16,3],[223,108,22,31,2],
 ]},
 {id:'north-pocket-beach',seed:612815,crownRatio:.75,patches:[
  [-235,130,25,35,3],[-125,105,23,37,4],[-42,92,33,26,4],
  [80,99,3.5,7,1],[79,117,20,25,4],[146,169,16,22,5],[166,180,14,24,2],
 ]},
];

const SHORE_REACH=240;
const MIN_RISE=5.8, MAX_ROCK=.52, MAX_SLOPE=.54, MIN_SETBACK=38;

function habitatAt(data,x,z) {
 const {size,maskRes:n}=data.island,step=size/n;
 const u=(x+size*.5)/step-.5,v=(z+size*.5)/step-.5,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
 const at=(i,j,c)=>data.islandMasks[(j*n+i)*4+c]/255;
 const blend=c=>(at(i,j,c)*(1-a)+at(i+1,j,c)*a)*(1-b)+(at(i,j+1,c)*(1-a)+at(i+1,j+1,c)*a)*b;
 return {grass:blend(1),wood:blend(3)};
}

function beachChart(data,bay) {
 const {terrain,island:{seaLevel},cove:{continuous:shelf}}=data;
 const {x,z,nx:vx,nz:vz}=pocketBeachSites[bay.id],n=Math.hypot(vx,vz),nx=vx/n,nz=vz/n;
 const point=(along,off)=>[x-nz*along+nx*off,z+nx*along+nz*off];
 const edges=new Map();
 const crossing=along=>{
  if(edges.has(along)) return edges.get(along);
  const dry=b=>terrain.heightAt(...point(along,b))>seaLevel;
  let lo=-SHORE_REACH,hi=SHORE_REACH;
  if(!dry(lo)||dry(hi)||shelf.marineAt(...point(along,hi))<.75) return null;
  for(let i=0;i<16;i++){
   const mid=(lo+hi)*.5;
   if(dry(mid)) lo=mid;else hi=mid;
  }
  const coast=(lo+hi)*.5;
  edges.set(along,coast);
  return coast;
 };
 return {point,edge(along){
  const i=4*Math.floor(along*.25),a=crossing(i),b=crossing(i+4);
  return a===null||b===null?null:a+(b-a)*(along-i)*.25;
 }};
}

export function plantPocketWoodland(data,templates,records,queryRadius) {
 const {terrain,island:{seaLevel}}=data,visits=pocketBeachVisits(),summary=[];
 const added=[];
 for(const bay of bays) {
  const rand=mulberry32(bay.seed), chart=beachChart(data,bay), {x:ax,z:az}=pocketBeachSites[bay.id];
  const nearby=records.filter(r=>Math.abs(ax-r.x)<420&&Math.abs(az-r.z)<420);
  const [px,pz]=visits[bay.id].p;
  const planted=[],counts=[];
  for(const [centre,setback,halfLength,halfWidth,limit] of bay.patches) {
   const start=planted.length;
   for(let attempt=0;attempt<270&&planted.length-start<limit;attempt++) {
    const heading=rand()*Math.PI*2,radius=Math.sqrt(rand());
    const along=centre+Math.sin(heading)*radius*halfLength;
    const inland=setback+Math.cos(heading)*radius*halfWidth;
    const edge=chart.edge(along);
    if(edge===null||inland<MIN_SETBACK) continue;
    const [x,z]=chart.point(along,edge-inland),h=terrain.heightAt(x,z),rise=h-seaLevel;
    if(rise<MIN_RISE||Math.hypot(x-px,z-pz)<22) continue;
    const {rock,sand}=data.landforms.substrateAt(x,z);
    const {grass,wood}=habitatAt(data,x,z);
    if(rock>MAX_ROCK||sand>.40||Math.max(grass,wood)<.34) continue;
    const slope=Math.hypot(terrain.heightAt(x+2,z)-terrain.heightAt(x-2,z),terrain.heightAt(x,z+2)-terrain.heightAt(x,z-2))/4;
    if(slope>MAX_SLOPE||h-Math.min(terrain.heightAt(x+1,z),terrain.heightAt(x-1,z),terrain.heightAt(x,z+1),terrain.heightAt(x,z-1))>.55) continue;
    const tip=Math.max(Math.exp(-(((along-126)/57)**2)),Math.exp(-(((along+187)/64)**2)));
    const shield=smooth(42,133,inland)*(1-tip*.58)*(1-smooth(.13,.52,rock)*.38);
    const H=3.65+shield*7.8+rand()*(1.95+shield*1.3);
    if(nearby.some(t=>Math.hypot(x-t.x,z-t.z)<3.3+.26*((t.H??7)+H))) continue;
    if(planted.some(t=>Math.hypot(x-t.x,z-t.z)<4.8+.22*(t.H+H))) continue;
    const pick=rand(),variant=pick<.64-shield*.45?3:pick<.96-shield*.36?1:0;
    // A lower vertical ratio gives shore trees a squat silhouette while
    // preserving the native trunk/crown template for render and collision.
    const sy=bay.crownRatio+shield*.16+rand()*.10,s=H/(templates[variant].height*sy);
    const yaw=rand()*Math.PI*2,seed=variant===0?rand()*.49:variant===1?.5+rand()*.49:3+rand()*.999;
    const sink=Math.min(.21,.08+s*.32*slope);
    planted.push({x,z,y:h-sink,H,variant,s,sy,seed,yaw,la:yaw,l:sy,qr:queryRadius,pocketWoodland:bay.id,
     shoreRoot:{along,inland,rise,slope,rock,sand,grass,wood,shield}});
   }
   counts.push({along:centre,trees:planted.length-start,limit});
  }
  summary.push({id:bay.id,trees:planted.length,patches:counts,roots:planted.map(r=>({x:r.x,y:r.y,z:r.z,height:r.H,variant:r.variant,...r.shoreRoot}))});
  added.push(...planted);
 }
 // Append so the indices, order and seeds of inherited trees remain stable.
 records.push(...added);
 return summary;
}
