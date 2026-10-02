// One authored watershed shared by the terrain, water, plants and navigation.
// Coordinates are local to the cliff-foot source; levels descend downstream.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const river=z=>-1830+190*Math.sin(z/640)+72*Math.sin(z/230);
export const springOrigin={x:river(-4023),z:-4023,level:209.35};
// A small bank-side seep uses the existing cliff foot, not a lowered mountain.
export const forestSpring={x:river(-720)-49.296222483495185,z:-720,level:30.8};
// x offset, z offset, water elevation, half width, bed depth, flow speed.
const main=[[-2,-19,210.15,.22,.09,.16],[-3,-13,209.55,.42,.13,.25],[0,-7,209.35,3.9,.48,.06],[0,0,209.35,6.7,.63,.045],[2,7,209.35,4.6,.42,.06],[4,12,209.28,.78,.23,.45],[7,20,208.94,.72,.27,.7],[5,28,208.72,1.1,.35,.45],[-1,37,208.13,.9,.25,.95],[-3,45,207.92,2.7,.48,.2],[0,53,207.92,3.5,.54,.15],[5,62,207.38,2.1,.33,.75],[9,74,206.93,3.4,.44,.48],[8,87,206.6,6.2,.62,.25],[river(-3915)-springOrigin.x,108,206.6,15,.95,.18]];
const branches=[main,[[-19,11,210.0,.18,.10,.16],[-13,20,209.25,.3,.13,.3],[-8,29,208.65,.4,.17,.4],[-1,37,208.13,.55,.23,.45]],[[25,39,209.0,.16,.08,.18],[18,47,208.3,.28,.12,.35],[14,56,207.7,.45,.16,.5],[5,62,207.38,.65,.22,.45]]];
const forestPoints=[[-1,-3,31.0,.45,.3,.2],[0,0,30.8,.5,.3,.35],[2,3,28.8,.5,.2,1.2],[3,7,24.9,.75,.3,1.4],[7,11,21.5,2.1,.55,.12],[10,16,21.5,2.4,.55,.08],[12,20,20.6,.65,.26,.75],[15,24,20.0,1.6,.42,.12],[19,27,20.0,1.7,.45,.1],[21,30,19.0,.65,.24,.8],[24,33,18.3,1.2,.35,.3],[28,36,17.0,.7,.24,1.0],[32,40,15.3,.8,.27,.9],[36,43,14.9,1.4,.4,.4],[river(-675)-forestSpring.x,45,17.3*(1-smooth(-1550,2800,-675))-.7,2.3,.5,.3]];
// Catmull-Rom x/z interpolation, monotone linear elevations prevent uphill flow.
function sampleRun(points,origin){
 const samples=[];
 for(let i=0;i<points.length-1;i++){
  const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)],count=Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1])*2);
  for(let k=0;k<count;k++){const t=k/count,t2=t*t,t3=t2*t,p=b.map((v,j)=>j<2?.5*((2*v)+(-a[j]+c[j])*t+(2*a[j]-5*v+4*c[j]-d[j])*t2+(-a[j]+3*v-3*c[j]+d[j])*t3):v+(c[j]-v)*t);samples.push(p);}
 }
 samples.push(points.at(-1));return samples.map(p=>({x:p[0]+origin.x,z:p[1]+origin.z,level:p[2],width:p[3],depth:p[4],speed:p[5]}));
}
export const forestSpringRun=sampleRun(forestPoints,forestSpring);
export const springRuns=[...branches.map(points=>sampleRun(points,springOrigin)),forestSpringRun];
// Coarser centreline is sufficient for distance queries on the 1 m ground mesh.
const reaches=springRuns.flatMap((run,index)=>{const nodes=run.filter((_,i)=>i%4===0).concat(run.at(-1));return nodes.slice(1).map((b,i)=>({a:nodes[i],b,forest:index===3}));});
export function springAt(x,z){
 const forest=z>-736&&z<-659&&x>forestSpring.x-15&&x<forestSpring.x+61;
 if(!forest&&(z< -4052||z> -3898||Math.abs(x-springOrigin.x)>65))return null;
 let best=null,score=Infinity;
 for(const reach of reaches){if(reach.forest!==forest)continue;const {a,b}=reach,dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)),width=a.width+(b.width-a.width)*t,d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t),edge=d-width;
  if(edge<score){score=edge;best={edge,d,width,level:a.level+(b.level-a.level)*t,depth:a.depth+(b.depth-a.depth)*t,speed:a.speed+(b.speed-a.speed)*t,forest};}
 }
 return best;
}
export function springTerrain(x,z,h){
 const s=springAt(x,z);if(!s)return h;
 const boundary=s.forest?1:smooth(-4052,-4043,z)*(1-smooth(-3920,-3898,z));
 const zone=boundary*(1-smooth(s.forest?1.6:7,s.forest?6:24,s.edge));
 const pebble=.035*Math.sin(x*2.31+z*1.71)+.023*Math.sin(x*4.13-z*2.3);
 const bed=s.level-s.depth+s.depth*Math.min(1,(s.d/s.width)**3)+pebble;
 const bank=s.level+.08+Math.max(0,s.edge)*.19+pebble;
 const target=s.edge<0?bed:bank;
 // The side channel leaves the surrounding escarpment and river valley intact.
 return h+(s.forest?Math.max(-12,Math.min(2.5,target-h)):target-h)*zone;
}
