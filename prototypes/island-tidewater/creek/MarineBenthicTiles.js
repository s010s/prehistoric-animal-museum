// Sand runs between the ordinary shelf's hard grounds. Named reef beds and
// authored river mouths retain their own compositions.
import {mulberry32, Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {BED_CELL, BED_CELL_CAPACITY} from './FreshwaterBedPlan.js';
import {mainEstuaryWeight} from './MainEstuary.js';
import {fitMarineOutcrop, settleMarineOutcrop} from './MarineOutcrops.js';

const seams = new Noise2D(66287);
const TAU = Math.PI * 2;
const BIN = 48;
const bedLanes = (x,z) => seams.noise(x/26+80,z/34) + .47*seams.noise(x/14,z/17+73);

export function marineBedExclusions(app, data) {
  const bins = new Map();
  function protect(x,z,radius) {
    const entry = {x,z,radius};
    const reach = radius + 3; // Include checks for a neighbouring rock footprint.
    for(let bx=Math.floor((x-reach)/BIN);bx<=Math.floor((x+reach)/BIN);bx++)
      for(let bz=Math.floor((z-reach)/BIN);bz<=Math.floor((z+reach)/BIN);bz++) {
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

function bedAt(data,exclusions,x,z,pad=0) {
  // The mouth and the whole approved sample cove include wide, intentional
  // sand corridors outside the individually named observation patches.
  if(x>-1225-pad&&x< -755+pad&&z> -83-pad&&z<315+pad)return null;
  if(pad>0 && mainEstuaryWeight(x,z)>.02)return null;
  const near=exclusions?.get(Math.floor(x/BIN)+','+Math.floor(z/BIN));
  if(near?.some(p=>(x-p.x)**2+(z-p.z)**2<(p.radius+pad)**2))return null;
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

export function planMarineBedCell(data,ix,iz,exclusions,remainingCapacity=BED_CELL_CAPACITY,outcropKinds) {
  const sites=[];
  if(remainingCapacity<=0)return sites;
  const seed=Math.imul(ix,0x12ac6b)^Math.imul(iz,0x478c0f)^0xd34531;
  const random=mulberry32(seed);
  const x0=ix*BED_CELL,z0=iz*BED_CELL, xm=x0+BED_CELL*.5, zm=z0+BED_CELL*.5;
  const coast=data.cove.continuous;
  if(coast.marineAt(xm,zm)<.32 || coast.distanceAt(xm,zm)>1025)return sites;
  const bedRegion=seams.noise(xm/154,zm/154)+seams.noise(xm/53+22,zm/59)*.55;
  const rockBases = outcropKinds?.size ? planOutcrops(data, exclusions, x0, z0, bedRegion, mulberry32(seed^0xacb1), outcropKinds, sites, remainingCapacity) : [];
  const pockets=2+Math.floor(random()*3);
  for(let pocket=0;pocket<pockets;pocket++){
    const cx=x0+random()*BED_CELL,cz=z0+random()*BED_CELL;
    const anchor=bedAt(data,exclusions,cx,cz);
    if(!anchor)continue;
    // A depositional shoal can cross many streamed tiles. Large-scale
    // sediment lanes determine the empty sand, not the tile boundaries.
    const lie=bedRegion+seams.noise(cx/26,cz/31)*.51;
    if(lie<-.36||Math.abs(seams.noise(cx/89+12,cz/134))<.028)continue;
    const inMainEstuary=mainEstuaryWeight(cx,cz)>.02;
    if (!inMainEstuary && bedLanes(cx,cz)<-.19) continue;
    const grass=anchor.depth<6.6&&anchor.slope<.18&&lie>(inMainEstuary?.04:-.11);
    const heading=anchor.slope>.018?Math.atan2(anchor.gx,-anchor.gz):seams.noise(cx/270,cz/270)*TAU;
    const c=Math.cos(heading),s=Math.sin(heading);
    const size=inMainEstuary?.45+random()*.8:.65+random()*.9, reach=.68+random()*1.35, count=grass?9+Math.floor(random()*12):5+Math.floor(random()*5);
    for(let j=0;j<count&&sites.length<remainingCapacity;j++){
      const angle=random()*TAU,r=Math.sqrt(random()),u=Math.cos(angle)*r*reach*1.5,v=Math.sin(angle)*r*reach*.6;
      const x=cx+c*u-s*v,z=cz+s*u+c*v;
      if(x<x0||x>=x0+BED_CELL||z<z0||z>=z0+BED_CELL)continue;
      const b=bedAt(data,exclusions,x,z);
      if(!b||grass&&(b.slope>.18||b.depth>7)||rockBases.some(rock=>(rock.x-x)**2+(rock.z-z)**2<(rock.radius+.22)**2))continue;
      const kind=grass?'seagrass':j===0&&b.slope>.08?'slab':random()<.66?'pebble':'cobble';
      const scale=grass?size*(.34+.72*(1-r))*(.75+random()*.55):kind==='slab' ? .45+random()*.56 : .11+random()**2*.58;
      sites.push({kind,x,y:b.floor-.018,z,scale,yaw:kind==='slab'?-heading+(random()-.5)*.26:random()*TAU,
        seed:random(),gx:b.gx,gz:b.gz,flowX:c*.075,flowZ:s*.075,depth:b.depth,mode:3});
    }
  }
  return sites;
}

function planOutcrops(data, exclusions, x0, z0, region, random, kinds, sites, capacity) {
  let anchor = null;
  for (let i = 0; i < 4; i++) {
    const x = x0 + 4.3 + random() * 7.4, z = z0 + 4.3 + random() * 7.4;
    const b = bedAt(data, exclusions, x, z, 3);
    if (!b || b.depth < 1.8 || b.slope > .27) continue;
    const substrate = data.landforms?.substrateAt(x, z);
    const rock = substrate?.rock ?? 0, sand = substrate?.sand ?? 1;
    // Follow contour variations in the measured shelf. Irregular sandy runs
    // cross tiles and widen over the flatter, more depositional parts.
    const score = region * .34 + bedLanes(x,z) * .72 + rock * .68 + (1 - sand) * .16 + b.slope * 1.9;
    if (score < .04 || anchor && score < anchor.score) continue;
    anchor = {...b, x, z, rock, score};
  }
  if (!anchor) return [];

  const trend = (anchor.slope > .013 ? Math.atan2(anchor.gx, -anchor.gz) : seams.noise(anchor.x/260, anchor.z/270)*TAU) + (random()-.5)*.8;
  const dx = Math.cos(trend), dz = Math.sin(trend), lithology = (anchor.rock > .23) === (random() < .69) ? 'sandstone' : 'conglomerate';
  const level = data.island.seaLevel, rocks = [];
  const members = 5 + Math.floor(random()*3);
  for (let i = 0; i < members && sites.length + rocks.length < capacity; i++) {
    const side = i < 3 ? (random()-.5)*(i ? 2.9 : .5) : (i%2 ? -1 : 1)*(1.0+random()*1.3);
    const along = i < 3 ? (i === 0 ? 0 : (i%2 ? 1 : -1))*(.9+i*.55+random()*.75) : (random()-.48)*5.6;
    const x = anchor.x + along*dx - side*dz, z = anchor.z + along*dz + side*dx;
    const scale = i === 0 ? 2.5+random()*2.0 : i < 3 ? 1.25+random()*1.35 : .62+random()*1.02;
    const b = bedAt(data, exclusions, x, z, scale*.55);
    if (!b || b.depth < 1.75 || b.slope > .32 || x<x0 || x>=x0+BED_CELL || z<z0 || z>=z0+BED_CELL) continue;
    const kind = kinds.has(lithology) ? lithology : 'sandstone';
    const yaw = -trend + (random()-.5) * (i ? 1.6 : .5);
    const rock = fitMarineOutcrop(data.terrain, level, {...b, kind, x, z, scale, yaw, seed:random(), mode:3,
      flowX:0, flowZ:0, fixed:true, reach:31}, kinds.get(kind)[0].geometry);
    if (rock && !rocks.some(other => Math.hypot(other.x-x, other.z-z)<(other.radius+rock.radius)*.47)) rocks.push(rock);
  }
  for (const rock of rocks) {
    const {host, ...site} = rock;
    sites.push(site);
  }
  if (!rocks.length) return rocks;

  const occupied = [];
  // Coral recruits share only the larger hard surfaces in the middle of the
  // light zone. A second settlement is limited to established, higher rock.
  const coralHabitat = anchor.depth > 2.15 && anchor.depth < 7.0 && random() < .79;
  for (const [i, rock] of rocks.entries()) {
    const living = coralHabitat && (i===0 || i===1 && rock.scale>1.7 && random()<.61);
    const colony = living ? (random()<.56 ? 'colony' : 'fingers') : null;
    const settlements = settleMarineOutcrop(rock, data.terrain, level, random, rocks, occupied, colony);
    sites.push(...settlements.slice(0,capacity-sites.length));
  }

  // An apron of sand-set rubble and occasional broken slabs joins the hard
  // face to open sediment. The long sides stay open for the swim lanes.
  const deposits = [];
  for (let i = 0; i < 11 && sites.length < capacity; i++) {
    const a = (i/11 + random()*.17)*TAU, r = .53+random()*.52;
    const along = Math.cos(a)*r*4.3, side = Math.sin(a)*r*3.25;
    const x = anchor.x+dx*along-dz*side, z = anchor.z+dz*along+dx*side;
    const b = bedAt(data, exclusions, x, z, .8);
    if (!b || x<x0 || x>=x0+BED_CELL || z<z0 || z>=z0+BED_CELL ||
        rocks.some(rock=>Math.hypot(rock.x-x,rock.z-z)<rock.radius*.71) ||
        deposits.some(site=>Math.hypot(site.x-x,site.z-z)<.68)) continue;
    const rubble = i%3!==0;
    const site = {kind:rubble?'reef-rubble':'cobble', x, y:b.floor-.018, z,
      scale:rubble?1.15+random()*1.33:.34+random()*.45, yaw:-trend+(random()-.5)*1.3,
      seed:random(), gx:b.gx, gz:b.gz, flowX:0, flowZ:0, depth:b.depth, mode:3, fixed:true, reach:rubble?20:23};
    deposits.push(site);
    sites.push(site);
  }
  return rocks;
}
