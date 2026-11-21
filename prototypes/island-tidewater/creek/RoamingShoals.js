import {Vector3} from '../vendor/tidewater/src/engine/index.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {REVIEWED_SWIM_RIGS} from './VaultReviewedSwimMotion.js';

const CELL = 44, SLOTS = 3, MEMBERS = 7;
const TAU = Math.PI * 2;
export const ROAMING_FISH_CAPACITY = SLOTS * MEMBERS;

function inSample(x,z,margin=0) {
  return x>-1536-margin && x< -512+margin && z>-672-margin && z<352+margin;
}

export function createSwimmer(group, index, length, random, shallow, depthRange) {
  const kind = group.reviewed, L = length * (.82 + random() * .36);
  return {
    group, thrustPhase: kind ? REVIEWED_SWIM_RIGS[kind].thrustPhase : 0,
    phase: random() * TAU, slot: random() * 6.283, spread: .25 + random() * .75,
    depth: shallow + random() * depthRange, L,
    p: new Vector3(group.x, Math.max(group.floor + .15, group.h - .6), group.z),
    previous: new Vector3(), velocity: new Vector3(), fresh: true, sleeping: true,
    panic: 0, yaw: random() * 6.283, morph: kind ? 0 : index % 5 === 0 ? 1 : 0, seed: random(), vault: kind,
  };
}

function habitat(data, breakDepth, x, z) {
  const floor = data.terrain.heightAt(x, z), sea = data.island.seaLevel;
  const [surface, edge, flowX, flowZ] = data.field.sample(x, z);
  if (edge < -.15 && surface > sea + .5) {
    const depth = surface - floor;
    if (depth < .72 || depth > 19) return null;
    const lake = data.island.lakes.find(b => Math.hypot((x-b.center[0])/b.rx,(z-b.center[1])/b.rz) < 1.06);
    const tide = surface < sea + 1.9 && data.cove.continuous.distanceAt(x,z) < 700;
    const flow=Math.hypot(flowX,flowZ);
    return { x, z, h:surface, floor, depth, water:lake?.id ?? (tide ? 'tidal' : 'river'), sea:false,
      current:!lake&&flow>.12 ? [flowX/flow,flowZ/flow] : null };
  }
  const depth = sea - floor, coast = data.cove.continuous;
  if (depth < 1.65 || depth > 15 || coast.marineAt(x,z) < .70 || coast.distanceAt(x,z) > 1000 ||
      depth < breakDepth(x,z) + .65) return null;
  const tidal=edge < -.5 && surface >= sea-.05 && coast.distanceAt(x,z) < 440;
  return { x, z, h:sea, floor, depth, water:tidal?'tidal':'shelf', sea:true };
}

function channelCenters(data, z) {
  const centers = [], river = data.field.riverAt(z);
  if (river?.width > 1) centers.push(river.x);
  const rows = data.island.tributary, i = Math.floor((z - rows[0][3]) / 8);
  if (i >= 0 && i < rows.length-1) {
    const source = data.field.tributarySource.at(z);
    const t = (z - rows[i][3]) / 8;
    centers.push(source?.x ?? rows[i][0] + (rows[i+1][0] - rows[i][0]) * t);
  }
  return centers;
}

function chooseSpecies(site, roll) {
  if (site.water === 'shelf') return roll < .70 ? 'aspidorhynchus' : 'falcatus';
  if (site.water === 'tidal') return 'eusthenopteron';
  if (site.water === 'tarn') return site.depth > 4 && roll < .28 ? 'coccosteus' : 'cheiracanthus';
  if (site.depth > 2.5 && roll < .20) return 'coccosteus';
  return roll > .74 ? 'cheiracanthus' : 'diplomystus';
}

const lengths = {aspidorhynchus:.54,falcatus:.31,eusthenopteron:.53,coccosteus:.42,cheiracanthus:.29,diplomystus:.28};

// The same flooded cell always owns the same school. Slots only reserve bone
// buffer offsets while a visitor is close; they do not identify an animal.
export class RoamingShoals {
  constructor(data, authored, breakDepth, obstacles) {
    this.data=data; this.authored=authored; this.breakDepth=breakDepth;
    this.rocks=new Map();
    for(const rock of obstacles) {
      const reach=(rock.footRadius??rock.size)+10;
      for(let ix=Math.floor((rock.x-reach)/CELL);ix<=Math.floor((rock.x+reach)/CELL);ix++)
        for(let iz=Math.floor((rock.z-reach)/CELL);iz<=Math.floor((rock.z+reach)/CELL);iz++) {
          const key=ix+','+iz;
          if(!this.rocks.has(key))this.rocks.set(key,[]);
          this.rocks.get(key).push(rock);
        }
    }
    this.cells=new Map(); this.slots=Array(SLOTS).fill(null);
    this.groups=[]; this.last=null;
  }

  plan(ix, iz) {
    const seed=Math.imul(ix,0x9184f1)^Math.imul(iz,0x61c889)^0x5f175d;
    const random=mulberry32(seed), x0=ix*CELL, z0=iz*CELL;
    if(random()<.19)return null;
    // Scatter in flooded area first. Narrow streams also get a candidate
    // along their surveyed centreline when it falls inside the same cell.
    for(let pass=0;pass<4;pass++) {
      const z=z0+3+random()*(CELL-6), scattered=x0+3+random()*(CELL-6);
      const targets=[scattered,...channelCenters(this.data,z)];
      for(const x of targets) {
        if(x < x0+2 || x > x0+CELL-2)continue;
        if(inSample(x,z,47))continue;
        if(this.authored.some(g => (g.x-x)**2+(g.z-z)**2 < (g.radius+49)**2))continue;
        const c=habitat(this.data,this.breakDepth,x,z);
        if(!c)continue;
        const radius=Math.min(3.6,1.2+c.depth*.83), reviewed=chooseSpecies(c,random());
        const rocks=this.rocks.get(ix+','+iz)??[];
        if(rocks.some(r=>Math.hypot(x-r.x,z-r.z) < radius+(r.footRadius??r.size)+.8))continue;
        const levelTolerance=c.current ? .13*(radius+1)+.12 : .36;
        let fits=true;
        for(let j=0;j<8;j++) {
          const a=j*TAU/8, px=x+Math.cos(a)*(radius+1), pz=z+Math.sin(a)*(radius+1);
          const edge=habitat(this.data,this.breakDepth,px,pz);
          if(!edge || c.sea!==edge.sea || Math.abs(edge.h-c.h)>levelTolerance) { fits=false; break; }
        }
        if(!fits)continue;
        const school=reviewed==='diplomystus'||reviewed==='cheiracanthus'||reviewed==='aspidorhynchus';
        const count=(school?4:2)+Math.floor(random()*(school?4:2));
        return {...c,id:'wild-water-'+ix+'-'+iz,seed,reviewed,radius,count,school,obstacles:rocks,
          routePhase:random()*TAU,lowerDwell:false,cruise:1};
      }
    }
    return null;
  }

  arrive(site,slot,swimmers) {
    const g={...site,first:0,members:[]};
    const random=mulberry32(site.seed^0x45eb19), base=swimmers[g.reviewed].fixedCount+slot*MEMBERS;
    const shallow=g.reviewed==='coccosteus'?.63:.25;
    for(let i=0;i<g.count;i++) {
      const f=createSwimmer(g,i,lengths[g.reviewed],random,shallow,shallow>.6?.23:.40);
      f.renderIndex=base+i; f.trackingId=g.id+'-'+i;
      g.members.push(f);
    }
    return g;
  }

  scan(p, swimmers) {
    if(this.last && this.last.distanceToSquared(p)<25)return false;
    (this.last??=new Vector3()).copy(p);
    const ix=Math.floor(p.x/CELL),iz=Math.floor(p.z/CELL), candidates=[];
    const floor=this.data.terrain.heightAt(p.x,p.z);
    const protectedView=inSample(p.x,p.z) ||
      this.authored.some(g=>(g.x-p.x)**2+(g.z-p.z)**2<(g.radius+2)**2);
    if(!protectedView && p.y < Math.max(this.data.island.seaLevel,floor)+25 && p.y>floor-5) {
      for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++) {
        const bx=ix+dx,bz=iz+dz,key=bx+','+bz;
        let tile=this.cells.get(key);
        if(!tile) {
          tile={bx,bz,site:this.plan(bx,bz)};
          this.cells.set(key,tile);
        }
        const s=tile.site;
        if(!s || p.y>s.h+9 || p.y<s.floor-5)continue;
        const distance=Math.hypot(s.x-p.x,s.z-p.z);
        const held=this.groups.some(g=>g.id===s.id);
        if(distance>(held?88:76))continue;
        candidates.push({s,score:held && distance<48 ? distance-90 : distance-(held?9:0)});
      }
    }
    for(const [key,tile] of this.cells)if(Math.abs(tile.bx-ix)>2 || Math.abs(tile.bz-iz)>2)this.cells.delete(key);
    candidates.sort((a,b)=>a.score-b.score || a.s.id.localeCompare(b.s.id));
    const selected=candidates.slice(0,SLOTS).map(c=>c.s);
    for(let i=0;i<SLOTS;i++)if(this.slots[i]&&!selected.some(s=>s.id===this.slots[i].id))this.slots[i]=null;
    for(const site of selected)if(!this.slots.some(g=>g?.id===site.id)) {
      const slot=this.slots.indexOf(null); this.slots[slot]=this.arrive(site,slot,swimmers);
    }
    this.groups=this.slots.filter(Boolean);
    return true;
  }
}
