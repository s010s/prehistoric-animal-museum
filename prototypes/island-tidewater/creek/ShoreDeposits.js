// A valve is a curved, fluted fan radiating from its hinge. The underside,
// scalloped rim and missing lip on the broken variant remain readable up close.
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {gridMesh, mergeParts, shell, branch, seagrassWrack, driftLog, stone, weedMat, KIND, nat} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';
import {pocketBeachSites} from './PocketBeaches.js';
import {pocketBeachVisits} from './IslandVisits.js';

function valve(chipped) {
  const outer=[], inner=[], rows=3, sides=22;
  for (let j=0;j<=rows;j++) {
    const row=[], lining=[], r=.035+.965*j/rows;
    for (let i=0;i<=sides;i++) {
      const u=i/sides, angle=(u-.5)*2.48, flute=Math.cos(u*Math.PI*20);
      const chip=chipped && u>.62 && u<.84? .13+.045*Math.cos(u*41):0;
      const end=1-Math.pow(Math.abs(u*2-1),2.3)*.4-chip+.033*flute;
      const x=-.34+r*end*Math.cos(angle)*.88, z=r*end*Math.sin(angle)*.75;
      const crown=(.16*Math.sin(Math.PI*r)+.065*(1-r))*(1-.75*(2*u-1)**2);
      const y=crown+.024*flute*r**.7;
      row.push([x,y,z]);lining.push([x,y-.024-.016*(1-r),z]);
    }
    outer.push(row);inner.push(lining);
  }
  const uv=(i,j)=>[j/rows, i/sides*Math.PI*2], up=()=>[0,1,0], down=()=>[0,-1,0];
  const exterior=gridMesh(outer,false,uv,up),interior=gridMesh(inner,false,uv,down);
  // Close all boundaries, including the short hinge and the two radial edges.
  const loop=grid=>[...grid[rows], ...grid.slice(0,-1).reverse().map(row=>row[sides]),
    ...grid[0].slice(0,-1).reverse(), ...grid.slice(1,-1).map(row=>row[0])];
  const rim=gridMesh([loop(outer),loop(inner)],true,(i,j)=>[j,i*.08]);
  return mergeParts([exterior,interior,rim]);
}

const valves=[valve(false),valve(true)];

function addValve(builder,batch,ground,item) {
  const rand=mulberry32(item.seed), start=batch.pos.length;
  const {x,z,size,flat}=item;
  if (rand()<.23 && !flat) {
    shell(builder,ground,x,z,size,rand,{type:1});
  } else {
    const part=valves[rand()<.33?1:0], inside=rand()<.48;
    builder.part('nature',part,x,item.height,z,{
      ry:rand()*Math.PI*2, rx:(inside?Math.PI:0)+(rand()-.5)*(flat?.22:.45), rz:(rand()-.5)*(flat?.20:.4),
      sx:size,sy:size*(.84+rand()*.35)*(flat?.72:1),sz:size*(.84+rand()*.2),
      tint:[1,.98,.94],data:nat(rand(),KIND.SHELL,rand()*.85,size),
    });
  }
  // Set the shell on the local tangent plane after rotating it.
  const e=.23, dx=(ground(x+e,z)-ground(x-e,z))/(2*e), dz=(ground(x,z+e)-ground(x,z-e))/(2*e);
  let gap=Infinity;
  for(let i=start;i<batch.pos.length;i+=3) {
    const floor=item.height+(batch.pos[i]-x)*dx+(batch.pos[i+2]-z)*dz;
    gap=Math.min(gap,batch.pos[i+1]-floor);
  }
  const embed=size*(.022+rand()*.042);
  for(let i=start+1;i<batch.pos.length;i+=3) batch.pos[i]-=gap+embed;
}

export function buildShoreDeposits(plan, ground) {
  if (!plan.shells.length) return null;
  const builder=new Builder(), batch=builder.batch('nature');
  for (const pocket of plan.shells) for (const item of pocket.members) {
    addValve(builder,batch,ground,item);
  }
  for(const pocket of plan.shells) if(pocket.shoulder) {
    const rand=mulberry32(pocket.members[0].seed),[nx,nz]=plan.normal;
    const yaw=Math.atan2(nx,-nz);
    // The long straws, dark leaf litter and a stranded twig follow the bank.
    // Separate small deposits leave sand showing between the shell valves.
    for(const a of [-1.35,-.48,.72]) {
      const x=pocket.x-nz*a+nx*.28,z=pocket.z+nx*a+nz*.28;
      seagrassWrack(builder,ground,x,z,.27+rand()*.28,rand,{dry:.65+rand()*.3,
        dir:yaw,count:11+Math.floor(rand()*7),minLen:.24,lift:.022});
    }
    branch(builder,ground,pocket.x+nz*.74,pocket.z-nx*.74,yaw+(rand()-.5)*.35,
      1.25+rand()*.65,.029+rand()*.013,rand,{twigs:1});
  }
  const geometry=batch.build();geometry.computeBoundingSphere();
  return geometry;
}

// Intermittent deposits along the two visitor strands. Distances are measured
// along each beach, heights above the mean sea. The first few metres of the
// arrival and the broad dry shoulder stay open for walking.
const pocketWrack = {
  'east-pocket-beach': {seed:672945,groups:[
    {along:9.3,rise:.59,log:{len:3.35,r0:.235,r1:.103,turn:-.24,bark:.46},mats:2,grit:12},
    {along:24,rise:.72,mats:1,grit:7},
    {along:47.5,rise:.86,log:{len:2.6,r0:.154,r1:.082,turn:.32,bark:.12},mats:3,grit:10},
    {along:91,rise:.65,mats:2,grit:8},
  ]},
  'north-pocket-beach': {seed:502917,groups:[
    {along:-8.9,rise:.53,mats:3,grit:7},
    {along:-24.6,rise:.67,log:{len:3.15,r0:.216,r1:.127,turn:.38,bark:.34},mats:1,grit:10},
    {along:38,rise:.78,mats:2,grit:11},
    {along:72,rise:.98,log:{len:3.75,r0:.226,r1:.088,turn:-.42,bark:.16},mats:2,grit:7},
  ]},
};

function groundedPocket(data,ground,origin,[nx,nz],along,rise) {
  const sea=data.island.seaLevel, x=origin[0]-nz*along, z=origin[1]+nx*along;
  const at=d=>ground(x-nx*d,z-nz*d);
  let lo=-48,hi=44;
  if(at(lo)>sea-.2 || at(hi)<sea+rise || data.cove.continuous.marineAt(x-nx*lo,z-nz*lo)<.6) return null;
  for(let i=0;i<16;i++){
    const mid=(lo+hi)/2;
    if(at(mid)<sea+rise) lo=mid;
    else hi=mid;
  }
  const d=(lo+hi)/2, px=x-nx*d, pz=z-nz*d;
  const dx=ground(px-.5,pz)-ground(px+.5,pz), dz=ground(px,pz-.5)-ground(px,pz+.5);
  const slope=Math.hypot(dx,dz);
  if(slope<.025 || slope>.25 || (dx*nx+dz*nz)/slope<.55) return null;
  return {x:px,z:pz,h:at(d),nx:dx/slope,nz:dz/slope};
}

function tintContact(batch, start, ground) {
  for(let i=start;i<batch.vcount;i++){
    const k=i*3, x=batch.pos[k], z=batch.pos[k+2];
    const clearance=batch.pos[k+1]-ground(x,z);
    const contact=.68+.32*Math.min(1,Math.max(0,clearance)/.17);
    for(let c=0;c<3;c++) batch.tint[k+c]*=contact;
  }
}

function addWeatheredLog(builder,batch,ground,x,z,yaw,rand,log,stubs) {
  const start=batch.pos.length;
  const {y,pitch}=driftLog(builder,ground,x,z,yaw,rand,{...log,sink:.38,stubs});
  const dx=Math.cos(yaw),dz=-Math.sin(yaw);
  // The thicker end is split across the grain. Push its soft heart back,
  // leave unequal splinters at the edge, and feather into the original tube.
  for(let i=start;i<batch.pos.length;i+=3){
    const px=batch.pos[i]-x,pz=batch.pos[i+2]-z;
    const along=px*dx+pz*dz, side=(pz*dx-px*dz)/log.r0;
    const crown=(batch.pos[i+1]-y-along*Math.tan(pitch))/log.r0;
    const end=1-smooth(.05,.84,along+log.len*.5);
    const hollow=Math.max(0,1-Math.hypot(side,crown));
    const split=(.33*hollow+.21*crown-.11*side+.10*Math.sin(side*8.4+crown*4.1))*end;
    batch.pos[i]+=dx*split;
    batch.pos[i+2]+=dz*split;
  }
}

export function buildPocketBeachDeposits(data,ground) {
  const stations=[];
  for(const visit of Object.values(pocketBeachVisits())){
    const layout=pocketWrack[visit.id],{nx,nz}=pocketBeachSites[visit.id];
    const length=Math.hypot(nx,nz),normal=[nx/length,nz/length],rand=mulberry32(layout.seed);
    const builder=new Builder(),batch=builder.batch('nature');
    const counts={driftwood:0,wrack:0,shell:0,stone:0,coralFragment:0}, pockets=[];
    const sea=data.island.seaLevel;
    for(const plan of layout.groups){
      const center=groundedPocket(data,ground,visit.p,normal,plan.along,plan.rise);
      if(!center) continue;
      const {x,z,h,nx,nz}=center, tangent=Math.atan2(nx,-nz);
      const at=(along,off)=>[x-nz*along+nx*off,z+nx*along+nz*off];
      const start=batch.vcount;
      const log=plan.log,yaw=-tangent+(log?.turn??0);
      if(log){
        addWeatheredLog(builder,batch,ground,x,z,yaw,rand,log,plan.along>40?1:0);
        counts.driftwood++;
      }
      // Accumulations start from a single flattened clump. Short, overlapping
      // tails taper into its rim so distinct mats don't stack in a low view.
      const coreAlong=log?1.14:0,coreOff=.39+(rand()-.5)*.26;
      for(let i=0;i<plan.mats;i++){
        const primary=i===0, along=primary?0:(i===1?1:-1)*(.31+rand()*.09);
        const [px,pz]=at(coreAlong+along,coreOff+(rand()-.5)*.18);
        const radius=(primary?.39:.26)+rand()*.11, height=(primary?.030:.012)+rand()*.016;
        weedMat(builder,ground,px,pz,radius,height,rand,{
          dry:.37+rand()*.32,aspect:1.22+rand()*.56,rot:tangent+(rand()-.5)*.98,strands:primary?1:0,
        });
        counts.wrack++;
      }
      if(log) {
        const heel=log.len*.51,dx=Math.cos(yaw),dz=-Math.sin(yaw);
        branch(builder,ground,x-dx*heel-dz*.105,z-dz*heel+dx*.105,yaw+.38,
          .75+rand()*.35,.045+rand()*.014,rand,{twigs:1});
      }
      const grit=[];
      for(let i=0;i<plan.grit*3 && grit.length<plan.grit;i++){
        const [px,pz]=at((rand()-.46)*5.2,(rand()-.38)*2.05);
        const py=ground(px,pz);
        if(py<sea+.29 || py>sea+1.46 || grit.some(p=>Math.hypot(p[0]-px,p[1]-pz)<.18)) continue;
        grit.push([px,pz]);
        if(rand()<.47){
          addValve(builder,batch,ground,{x:px,z:pz,height:py,size:.057+rand()*.11,seed:Math.floor(rand()*4294967296),flat:true});
          counts.shell++;
        } else {
          const size=(grit.length===1?.13:.046)+rand()*.06;
          stone(builder,ground,px,pz,size,size*(.28+rand()*.25),size*(.68+rand()*.25),rand,{
            palette:.27+rand()*.30,detail:0,sink:.39,
          });
          counts.stone++;
        }
      }
      tintContact(batch,start,ground);
      pockets.push({center:[x,h,z],along:plan.along,rise:h-sea,log:plan.log?.len??0});
    }
    if(!pockets.length) continue;
    stations.push({
      site:{id:visit.id,kind:'sheltered-bay',x:visit.p[0],z:visit.p[1],level:sea},
      geometry:batch.build(),counts,pockets,
    });
  }
  return stations;
}
