// A world-coordinate field shared by the native ground layer and the reviewed
// understory atlas. No camera position or order of travel enters a habitat.
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {islandGroundAt} from './IslandEcologyPlan.js';
import {routePoint} from './IslandFaunaRoute.js';
import {smooth} from './ContinuousSample.js';

const noise = new Noise2D(481621);
const fields = new WeakMap();
const key = (x, z) => Math.floor(x / 64) + ',' + Math.floor(z / 64);

export function prepareLandHabitatField(data, app) {
  const clearings = new Map();
  const discs = [];
  function protect(x, z, radius) {
    const disc = {x, z, radius};
    discs.push(disc);
    for (let j = Math.floor((z-radius)/64); j <= Math.floor((z+radius)/64); j++) {
      for (let i = Math.floor((x-radius)/64); i <= Math.floor((x+radius)/64); i++) {
        const id = i + ',' + j;
        if (!clearings.has(id)) clearings.set(id, []);
        clearings.get(id).push(disc);
      }
    }
  }
  for (const visit of Object.values({...app.islandVisits, ...app.islandFaunaHabitats?.visits})) {
    const [x, z] = [visit.p[0], visit.p.at(-1)];
    protect(x, z, 5.5);
    if (!visit.gaze) continue;
    const dx = visit.gaze[0] - x, dz = visit.gaze[2] - z, length = Math.hypot(dx, dz);
    for (let d = 8; d < Math.min(76, length + 8); d += 8) protect(x + d*dx/length, z + d*dz/length, 4.2);
  }
  for (const actor of app.islandFauna?.individuals.values() ?? []) {
    if (actor.site.medium !== 'ground') continue;
    const radius = Math.hypot(actor.body.half[0], actor.body.half[2]) + 4;
    const count = Math.max(1, Math.ceil(actor.route.length / 5));
    for (let i = 0; i < count; i++) {
      const [x,,z] = routePoint(actor.route, actor.route.length * i / count);
      protect(x, z, radius);
    }
  }
  fields.set(data, {clearings, trunks: app.colliders?.treeCells});
  if (!data.appearance?.setRoamingGround) return;
  // Reuse the uploaded outer-cover map. The terrain shader obtains rock from
  // the normal/rock atlas, leaving the blue channel free for this transition.
  const texels = data.islandMasks.slice(), res = data.island.maskRes, metres = data.island.size/res;
  const grid = v => (v/data.island.size+.5)*res-.5;
  for (let j=0; j<res; j++) for (let i=0; i<res; i++) {
    const x=(i+.5-res/2)*metres, z=(j+.5-res/2)*metres;
    // Protect the complete filter footprint on the accepted western route.
    const protectedCell = Math.abs(x)<515+metres && Math.abs(z)<515+metres
      || x>-1536-metres && x< -482+metres && z>-672-metres && z<352+metres;
    texels[(j*res+i)*4+2] = protectedCell ? 0 : 255;
  }
  for (const {x,z,radius} of discs) {
    const gx=grid(x), gz=grid(z), reach=radius/metres+2;
    for (let j=Math.max(0,Math.floor(gz-reach)); j<=Math.min(res-1,Math.ceil(gz+reach)); j++)
      for (let i=Math.max(0,Math.floor(gx-reach)); i<=Math.min(res-1,Math.ceil(gx+reach)); i++) {
        const k=(j*res+i)*4+2, d=Math.hypot(i-gx,j-gz)*metres;
        texels[k]=Math.min(texels[k],Math.round(255*smooth(radius+metres*.7,radius+metres*1.8,d)));
      }
  }
  // Crown area per texel gives the forest floor a gradual transition into
  // the adjoining glade, including stands outside the old woodland mask.
  for (const tree of app.vegetation?.records ?? []) {
    const gx=grid(tree.x), gz=grid(tree.z), ix=Math.floor(gx), iz=Math.floor(gz);
    const crown=Math.min(18,tree.H*.23);
    for (let j=iz;j<=iz+1;j++) for (let i=ix;i<=ix+1;i++) {
      if (i<0 || i>=res || j<0 || j>=res) continue;
      const k=(j*res+i)*4, influence=(1-Math.abs(gx-i))*(1-Math.abs(gz-j))*texels[k+2]/255;
      texels[k+3]=Math.min(255,texels[k+3]+Math.round(365*Math.PI*crown*crown/(metres*metres)*influence));
    }
  }
  data.appearance.setRoamingGround(texels);
}

// The artist-tuned western creek and outlet include their banks, camera
// approaches and backdrop. Keep that whole apron independent of new cover.
export function protectedSampleLand(x, z) {
  return Math.max(Math.abs(x), Math.abs(z)) < 515
    || (x > -1536 && x < -482 && z > -672 && z < 352);
}

export function landTrunkCells(data) {
  return fields.get(data)?.trunks;
}

function treeShadeAt(trunks, x, z) {
  if (!trunks) return 0;
  let shade = 0;
  for (let j = Math.floor((z-12)/32); j <= Math.floor((z+12)/32); j++) {
    for (let i = Math.floor((x-12)/32); i <= Math.floor((x+12)/32); i++) {
      for (const tree of trunks.get(i + ',' + j) ?? []) {
        if (tree.tag !== 'museum tree trunk' && tree.tag !== 'museum giant trunk') continue;
        const distanceSq = (x-tree.x)**2 + (z-tree.z)**2;
        if (distanceSq < (tree.radius + .43)**2) return -1;
        const canopy = Math.min(12, Math.max(3.5, tree.radius * 7));
        shade = Math.max(shade, 1 - distanceSq / (canopy * canopy));
      }
    }
  }
  return shade;
}

export function landContextAt(data, x, z) {
  if (protectedSampleLand(x, z) || Math.max(Math.abs(x), Math.abs(z)) >= data.island.size*.5) return null;
  const field = fields.get(data);
  for (const disc of field?.clearings.get(key(x,z)) ?? []) {
    if ((disc.x-x)**2 + (disc.z-z)**2 < disc.radius**2) return null;
  }
  // Reject ocean and lakes before evaluating soil or the five slope samples.
  const y = data.terrain.heightAt(x, z);
  if (y <= data.island.seaLevel + .14) return null;
  const g = islandGroundAt(data, x, z);
  if (g.trail > .48 || g.height < .1 || (g.edge < .05 && g.y <= g.level + .12) || g.slope > .89) return null;
  const {dry, wetland, heath, snow: snowArea} = data.landforms.climate;
  const snow = snowArea.weight(x,z) * smooth(508, 613, y + 25*g.gz/Math.hypot(1,g.slope));
  if (snow > .26) return null;
  const shade = treeShadeAt(field?.trunks, x, z);
  if (shade < 0) return null;
  const wood = Math.max(g.wood, shade);
  const patchStrength = Math.max(0, Math.min(1, .53 + .57*noise.noise(x/103,z/103) + .32*noise.noise(x/34+16,z/34)));
  let biome = 'meadow';
  if ((g.fresh && g.edge < 22 && g.height < 4.5) || (wetland.weight(x,z) > .55 && g.height < 9)) biome = 'wet-bank';
  else if (g.sea && g.height < 4.5) biome = 'shore';
  else if (heath.weight(x,z) > .38 && y > 248) biome = 'upland';
  else if (dry.weight(x,z) > .44 && wood < .67) biome = 'dry-slope';
  else if (wood > .45) biome = 'woodland';
  return {...g, wood, biome, snow, patchStrength};
}
