// Sparse free-swimming habitat across the island shelf. Fixed galleries and
// the approved western estuary retain their own local seafloor compositions.
import {mulberry32, Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {BED_CELL, BED_CELL_CAPACITY} from './FreshwaterBedPlan.js';

const seams = new Noise2D(66287);
const TAU = Math.PI * 2;
const BIN = 48;

export function marineBedExclusions(app, data) {
  const bins = new Map();
  function protect(x,z,radius) {
    const entry = {x,z,radius};
    for(let bx=Math.floor((x-radius)/BIN);bx<=Math.floor((x+radius)/BIN);bx++)
      for(let bz=Math.floor((z-radius)/BIN);bz<=Math.floor((z+radius)/BIN);bz++) {
        const key=bx+','+bz;
        if(!bins.has(key))bins.set(key,[]);
        bins.get(key).push(entry);
      }
  }
  for(const p of app.life?.marineBed?.patches??[]) {
    const mesh=p.mesh.geometry;
    if(!mesh.boundingSphere)mesh.computeBoundingSphere();
    const {center,radius}=mesh.boundingSphere;
    protect(center.x,center.z,radius+4);
  }
  for(const p of app.shelfReef?.items??[])protect(p.x,p.z,p.radius+1);
  for(const p of app.coveRocks?.instances??[])protect(p.x,p.z,p.footRadius+1);
  for(const garden of data.sampleBenthicDetails?.reefGardens??[])protect(garden.x,garden.z,garden.radius+16);
  return bins;
}

export function nearMarineBed(data, position) {
  const coast=data.cove.continuous, level=data.island.seaLevel;
  const {x,y,z}=position;
  // A wader on dry sand can already see through the water. Keep the local
  // window alive until its furthest visible bed has faded, even on a bank.
  if (y > level + 26 || y < level - 36 || coast.distanceAt(x,z) > 1035) return false;
  if (coast.marineAt(x,z) > .25) return true;
  return coast.marineAt(x-25,z) > .25 || coast.marineAt(x+25,z) > .25 ||
    coast.marineAt(x,z-25) > .25 || coast.marineAt(x,z+25) > .25;
}

function bedAt(data,exclusions,x,z) {
  // The mouth and the whole approved sample cove include wide, intentional
  // sand corridors outside the individually named observation patches.
  if(x>-1225&&x< -755&&z> -83&&z<315)return null;
  const near=exclusions?.get(Math.floor(x/BIN)+','+Math.floor(z/BIN));
  if(near?.some(p=>(x-p.x)**2+(z-p.z)**2<p.radius**2))return null;
  const coast=data.cove.continuous;
  if(coast.marineAt(x,z)<.72||coast.distanceAt(x,z)>1000)return null;
  const [surface,edge]=data.field.sample(x,z),level=data.island.seaLevel;
  if(edge<=.12&&surface>level+.15)return null;
  const t=data.terrain,floor=t.heightAt(x,z),depth=level-floor;
  if(depth<1.25||depth>9.5)return null;
  const gx=t.heightAt(x+.5,z)-t.heightAt(x-.5,z),gz=t.heightAt(x,z+.5)-t.heightAt(x,z-.5);
  const slope=Math.hypot(gx,gz);
  return slope<.45?{floor,depth,gx,gz,slope}:null;
}

export function planMarineBedCell(data,ix,iz,exclusions,remainingCapacity=BED_CELL_CAPACITY) {
  const sites=[];
  if(remainingCapacity<=0)return sites;
  const random=mulberry32(Math.imul(ix,0x12ac6b)^Math.imul(iz,0x478c0f)^0xd34531);
  const x0=ix*BED_CELL,z0=iz*BED_CELL, xm=x0+BED_CELL*.5, zm=z0+BED_CELL*.5;
  const coast=data.cove.continuous;
  if(coast.marineAt(xm,zm)<.32 || coast.distanceAt(xm,zm)>1025)return sites;
  const bedRegion=seams.noise(xm/154,zm/154)+seams.noise(xm/53+22,zm/59)*.55;
  const pockets=2+Math.floor(random()*3);
  for(let pocket=0;pocket<pockets;pocket++){
    const cx=x0+random()*BED_CELL,cz=z0+random()*BED_CELL;
    const anchor=bedAt(data,exclusions,cx,cz);
    if(!anchor)continue;
    // A depositional shoal can cross many streamed tiles. Large-scale
    // sediment lanes determine the empty sand, not the tile boundaries.
    const lie=bedRegion+seams.noise(cx/26,cz/31)*.51;
    if(lie<-.36||Math.abs(seams.noise(cx/89+12,cz/134))<.028)continue;
    const grass=anchor.depth<6.6&&anchor.slope<.18&&lie>.04;
    const heading=anchor.slope>.018?Math.atan2(anchor.gx,-anchor.gz):seams.noise(cx/270,cz/270)*TAU;
    const c=Math.cos(heading),s=Math.sin(heading);
    const size=.45+random()*.8, reach=.68+random()*1.35, count=grass?9+Math.floor(random()*12):5+Math.floor(random()*5);
    for(let j=0;j<count&&sites.length<remainingCapacity;j++){
      const angle=random()*TAU,r=Math.sqrt(random()),u=Math.cos(angle)*r*reach*1.5,v=Math.sin(angle)*r*reach*.6;
      const x=cx+c*u-s*v,z=cz+s*u+c*v;
      if(x<x0||x>=x0+BED_CELL||z<z0||z>=z0+BED_CELL)continue;
      const b=bedAt(data,exclusions,x,z);
      if(!b||grass&&(b.slope>.18||b.depth>7))continue;
      const kind=grass?'seagrass':j===0&&b.slope>.08?'slab':random()<.66?'pebble':'cobble';
      const scale=grass?size*(.34+.72*(1-r))*(.75+random()*.55):kind==='slab' ? .45+random()*.56 : .11+random()**2*.58;
      sites.push({kind,x,y:b.floor-.018,z,scale,yaw:kind==='slab'?-heading+(random()-.5)*.26:random()*TAU,
        seed:random(),gx:b.gx,gz:b.gz,flowX:c*.075,flowZ:s*.075,depth:b.depth,mode:3});
    }
  }
  return sites;
}
