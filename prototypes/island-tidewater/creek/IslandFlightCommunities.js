import { mulberry32 } from '../vendor/tidewater/src/util/Noise.js';
import { ISLAND_FAUNA_PLAN } from './IslandFaunaPlan.js';

// Free-roaming animals occupy permanent territories. Placement uses the forest
// actually built for this island and the same freshwater surface used by a swimmer.
export function islandFlightCommunities(data, colliders, existing) {
  const { island, field, terrain } = data;
  const sample = field.continuousSample;
  if (!sample || !island) return [];
  const sites = [];
  const protectedSites = ISLAND_FAUNA_PLAN.map(({ preferred, radius }) => ({
    x: preferred[0], z: preferred[1], radius: radius + 40,
  }));

  function openSite(x, z, species, separation) {
    if (Math.abs(x - sample.center[0]) < 670 && Math.abs(z - sample.center[1]) < 670) return false;
    if (protectedSites.some(p => Math.hypot(x - p.x, z - p.z) < p.radius)) return false;
    for (const group of [existing, sites]) {
      if (group.some(h => h.species === species && Math.hypot(x - h.x, z - h.z) < separation)) return false;
    }
    return true;
  }

  // A glade must clear all nearby crown envelopes around the entire flock
  // orbit. A woodland cell with no mature edge nearby stays quiet.
  const cells = colliders?.treeCells;
  const crowns = new Map();
  const groves = new Set();
  for (const [key, trees] of cells ?? []) {
    if (!trees.some(t => t.crown)) continue;
    const [ix, iz] = key.split(',').map(Number);
    groves.add(Math.floor(ix / 9) + ',' + Math.floor(iz / 9));
  }
  function crownGap(x, z, reach) {
    let nearest = Infinity;
    if (!cells) return nearest;
    for (let iz = Math.floor((z-reach)/32); iz <= Math.floor((z+reach)/32); iz++) {
      for (let ix = Math.floor((x-reach)/32); ix <= Math.floor((x+reach)/32); ix++) {
        const trees = cells.get(ix + ',' + iz);
        if (!trees) continue;
        for (const tree of trees) {
          if (!tree.crown) continue;
          if (!crowns.has(tree.crown)) crowns.set(tree.crown, Math.max(...tree.crown));
          nearest = Math.min(nearest, Math.hypot(tree.x-x, tree.z-z) - crowns.get(tree.crown)*tree.crownScale);
        }
      }
    }
    return nearest;
  }
  for (const key of groves) {
    const [ix, iz] = key.split(',').map(Number);
    const random = mulberry32(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ 59863);
    if (random() > .43) continue;
    const rx = 13 + random()*8, rz = 8 + random()*5;
    for (let attempt=0; attempt<7; attempt++) {
      const x = (ix + .07 + .86*random())*288, z = (iz + .07 + .86*random())*288;
      const gap = crownGap(x, z, 84);
      if (gap < rx*1.14+3.6 || gap > 55) continue;
      const y = terrain.heightAt(x,z);
      if (y < 1 || y > 920 || field.sample(x,z)[1] < 2) continue;
      if (Math.max(...[[rx,0],[-rx,0],[0,rx],[0,-rx]].map(([dx,dz]) => Math.abs(terrain.heightAt(x+dx,z+dz)-y))) > rx*.45) continue;
      if (!openSite(x, z, 'sapeornis', 148)) continue;
      sites.push({id:'woodland-edge-'+key, roaming:true, species:'sapeornis', x,z,rx,rz,heading:random()*Math.PI,
        alt:4.5+random()*2.0, count:random()<.68?2:3});
      break;
    }
  }

  // River banks are irregular and the rendered bed can emerge inside the
  // nominal water mask. Search across both banks for actual shallow water.
  const random = mulberry32(740637);
  function margin(id, x, z, nx, nz) {
    const choices = [0,2.5,-2.5,5,-5,9,-9,15,-15,24,-24,36,-36];
    for (const offset of choices) {
      const px=x+offset*nx, pz=z+offset*nz;
      const [water, edge] = field.sample(px,pz);
      if (water <= .15 || edge >= -.12) continue;
      const depth=water-terrain.heightAt(px,pz);
      if (depth < .04 || depth > 1.05) continue;
      if (crownGap(px,pz,45) < 8.4 || !openSite(px,pz,'meganeura',73)) continue;
      sites.push({id,roaming:true,species:'meganeura',x:px,z:pz,rx:3.2+random()*2.2,rz:2+random(),alt:1.2+random()*.6,
        heading:Math.atan2(nz,nx)+Math.PI/2,count:random()<.62?2:3});
      return true;
    }
    return false;
  }
  const layout=field.riverLayout;
  for (let z=layout.riverStart+60; z<layout.riverStart+layout.riverStep*(layout.riverCount-1); z+=105+random()*104) {
    const p=field.riverAt(z);
    if (!p) continue;
    const side=random()<.5?-1:1, id='river-dragonflies-'+Math.round(z);
    if (!margin(id,p.x+side*p.width,z,side,0)) margin(id,p.x-side*p.width,z,-side,0);
  }
  for (let i=6; i<island.tributary.length; i+=12+Math.floor(random()*12)) {
    const [x,,width,z]=island.tributary[i],side=random()<.5?-1:1, id='tributary-dragonflies-'+i;
    if (!margin(id,x+side*width,z,side,0)) margin(id,x-side*width,z,-side,0);
  }
  function shore(id, cx, cz, rx, rz, scale) {
    const count=Math.round(Math.PI*(rx+rz)/139);
    for (let i=0;i<count;i++) {
      const a=(i+random()*.7)*Math.PI*2/count, dx=Math.cos(a),dz=Math.sin(a);
      const nx=dx/rx,nz=dz/rz,len=Math.hypot(nx,nz);
      margin(id+'-dragonflies-'+i,cx+dx*rx*scale,cz+dz*rz*scale,nx/len,nz/len);
    }
  }
  const lake=island.lakes.find(l => l.id==='lake');
  if (lake) shore('lake',...lake.center,lake.rx,lake.rz,1.04);
  const marsh=island.marsh;
  // Within the marsh mask, dry reed bars split the basin into shallow
  // runnels. The ellipse rim does not correspond to the walkable banks.
  for (let iz=0; iz<marsh.rz*2/165; iz++) {
    for (let ix=0; ix<marsh.rx*2/165; ix++) {
      const seed=mulberry32(Math.imul(ix,1376312589)^Math.imul(iz,19349663)^8857);
      if (seed()>.48) continue;
      for (let attempt=0;attempt<5;attempt++) {
        const x=marsh.x-marsh.rx+(ix+seed())*165, z=marsh.z-marsh.rz+(iz+seed())*165;
        if (Math.hypot((x-marsh.x)/marsh.rx,(z-marsh.z)/marsh.rz)>1.02) continue;
        const [level,edge]=field.sample(x,z);
        const depth=level-terrain.heightAt(x,z);
        if (level<=.15 || edge>-.12 || depth<.04 || depth>.8) continue;
        // Only occupy a margin that a visitor can approach on exposed ground.
        const start=seed()*Math.PI*2;
        let placed=false;
        for (let i=0;i<8;i++) {
          const angle=start+i*Math.PI/4, nx=Math.cos(angle),nz=Math.sin(angle);
          const px=x+nx*18,pz=z+nz*18;
          const [water,edge]=field.sample(px,pz);
          if (edge<0 && terrain.heightAt(px,pz)<water+.05) continue;
          placed=margin('marsh-dragonflies-'+ix+'-'+iz,x,z,nx,nz);
          break;
        }
        if (placed) break;
      }
    }
  }
  return sites;
}
