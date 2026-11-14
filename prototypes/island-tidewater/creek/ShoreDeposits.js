// A valve is a curved, fluted fan radiating from its hinge. The underside,
// scalloped rim and missing lip on the broken variant remain readable up close.
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {gridMesh, mergeParts, shell, branch, seagrassWrack, KIND, nat} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

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

export function buildShoreDeposits(plan, ground) {
  if (!plan.shells.length) return null;
  const builder=new Builder(), batch=builder.batch('nature');
  for (const pocket of plan.shells) for (const item of pocket.members) {
    const rand=mulberry32(item.seed), start=batch.pos.length;
    const {x,z,size}=item;
    if (rand()<.23) {
      shell(builder,ground,x,z,size,rand,{type:1});
    } else {
      const part=valves[rand()<.33?1:0], inside=rand()<.48;
      builder.part('nature',part,x,item.height,z,{
        ry:rand()*Math.PI*2, rx:(inside?Math.PI:0)+(rand()-.5)*.45, rz:(rand()-.5)*.4,
        sx:size,sy:size*(.84+rand()*.35),sz:size*(.84+rand()*.2),
        tint:[1,.98,.94],data:nat(rand(),KIND.SHELL,rand()*.85,size),
      });
    }
    // Set each rigid valve down on the local tangent plane *after* rotating it.
    // Aligning its centre alone leaves cup-up valves hanging above sloping sand.
    const e=.23, dx=(ground(x+e,z)-ground(x-e,z))/(2*e), dz=(ground(x,z+e)-ground(x,z-e))/(2*e);
    let gap=Infinity;
    for(let i=start;i<batch.pos.length;i+=3) {
      const floor=item.height+(batch.pos[i]-x)*dx+(batch.pos[i+2]-z)*dz;
      gap=Math.min(gap,batch.pos[i+1]-floor);
    }
    const embed=size*(.022+rand()*.042);
    for(let i=start+1;i<batch.pos.length;i+=3) batch.pos[i]-=gap+embed;
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
