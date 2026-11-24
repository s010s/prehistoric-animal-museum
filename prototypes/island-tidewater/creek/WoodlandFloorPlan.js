// A branch belongs to its source trunk's cell even after it has rolled a
// short distance downhill. This keeps it fixed across streaming boundaries.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {landContextAt, landTrunkCells} from './LandHabitatField.js';

const TAU = Math.PI * 2;
const woodTags = new Set(['museum tree trunk', 'museum giant trunk']);

function trunksInCell(data, ix, iz, size) {
  const cells = landTrunkCells(data), list = [];
  if (!cells) return list;
  const ox=ix*size, oz=iz*size;
  for(let z=Math.floor(oz/32);z<=Math.floor((oz+size)/32);z++) {
    for(let x=Math.floor(ox/32);x<=Math.floor((ox+size)/32);x++) {
      for(const trunk of cells.get(x+','+z) ?? []) {
        if(woodTags.has(trunk.tag) && trunk.x>=ox && trunk.x<ox+size && trunk.z>=oz && trunk.z<oz+size) list.push(trunk);
      }
    }
  }
  return list;
}

function eligible(g) {
  return g && g.trail<.42 && g.height>.16 && g.rock<.84 && g.slope<.72 &&
    g.biome!=='shore' && g.snow<.14;
}

function blocked(x,z,pad,sites) {
  return sites.some(s=>{
    const rock=s.form==='scree'||s.form==='talus'||s.form==='cobble';
    if(!rock && s.mode!==-1)return false;
    const min=pad+(rock?s.scale*.83:s.scale*.38);
    return (s.x-x)**2+(s.z-z)**2<min*min;
  });
}

export function* woodlandFloorPockets(data,ix,iz,size,remaining,existing) {
  if(remaining<1)return;
  const trunks=trunksInCell(data,ix,iz,size);
  const rng=mulberry32(Math.imul(ix,7877)^Math.imul(iz,69691)^0x8251811);
  // Do not let the storage order of a dense clump consume all its litter
  // slots on one side of the cell.
  for(let i=trunks.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    [trunks[i],trunks[j]]=[trunks[j],trunks[i]];
  }
  // Visit each tree before returning to the first. This spreads litter
  // across the canopy footprint when little of a cell's budget is left.
  const sources=trunks.map(tree=>({tree,bearing:rng()*TAU}));
  let accepted=0;
  for(let pass=0;pass<4 && accepted<remaining;pass++) {
    for(const {tree,bearing} of sources) {
      if(accepted>=remaining)break;
      const sites=[];
      for(let j=0;j<(pass===2?1:2) && accepted<remaining;j++) {
        const i=pass*2+j;
        const angle=bearing+i*2.39996+(rng()-.5)*.8;
        const reach=tree.radius+1.05+(i<2?rng()*2.8:1.8+rng()*5.5);
        const x=tree.x+Math.cos(angle)*reach,z=tree.z+Math.sin(angle)*reach;
        const g=landContextAt(data,x,z);
        if(!eligible(g))continue;
        const form=i%3===0?'needle-litter':i===1?'moss-hummock':i===2?'split-bough':rng()<.48?'fallen-branch':rng()<.55?'moss-hummock':'needle-litter';
        const litter=form==='needle-litter'||form==='moss-hummock', scale=form==='needle-litter'?1.08+rng()*.62:form==='moss-hummock'?.95+rng()*.72:form==='fallen-branch'?1.12+rng()*.64:.68+rng()*.55;
        const pad=scale*(litter?.32:.54);
        if(blocked(x,z,pad,existing) || blocked(x,z,pad,sites))continue;
        const yaw=angle+(rng()-.5)*1.42;
        if(!litter) {
          const half=scale*(form==='split-bough'?.92:.24), dx=Math.cos(yaw)*half, dz=-Math.sin(yaw)*half;
          if(!eligible(landContextAt(data,x+dx,z+dz)) || !eligible(landContextAt(data,x-dx,z-dz)))continue;
        }
        sites.push({x,z,y:g.y-.018,scale,form,yaw,region:'roaming-'+g.biome,seed:rng(),mode:-1,flow:[0,0]});
        accepted++;
      }
      existing.push(...sites);
      yield sites;
    }
  }
}
