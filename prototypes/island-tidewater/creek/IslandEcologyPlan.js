// All dimensions are metres. Bands refer to the local physical water surface
// only when its signed footprint reaches the candidate.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const TAU = Math.PI * 2;
const between = (value, [low, high]) => value >= low && value <= high;

function rule(form, count, scale, band, slope, spacing, substrate = 'soil') {
  return {form, count, scale, band, slope, spacing, substrate};
}

export const ISLAND_COVER_RECIPES = {
  'mixed-forest': [
    rule('fern', 76, [.30, .8], [.5, 150], .52, 2.2),
    rule('duff', 27, [.4, 1.1], [.3, 150], .7, 4.3),
  ],
  'ridge-woodland': [
    rule('heath', 68, [.23, .57], [.22, 400], .61, 3.8),
    rule('scree', 58, [.26, 1.35], [.24, 400], .86, 4.4, 'rock'),
  ],
  'giant-forest': [
    rule('fern', 126, [.42, 1.04], [.5, 1200], .5, 2.6),
    rule('duff', 65, [.5, 1.37], [.3, 1200], .57, 3.6),
  ],
  lake: [
    rule('fern', 75, [.27, .7], [.7, 17], .54, 2.8),
    rule('rush', 76, [.48, 1.1], [-.26, .72], .44, 1.25, 'fresh-margin'),
    rule('submerged', 42, [.32, .72], [-2.8, -.92], .36, 1.7, 'fresh-shoal'),
    rule('cobble', 48, [.17, .72], [-.8, 4.7], .66, 2.4, 'bank'),
  ],
  grassland: [
    rule('tussock', 190, [.35, 1.12], [.35, 280], .49, 1.75),
    rule('heath', 56, [.27, .61], [.4, 280], .48, 3.7),
    rule('cobble', 46, [.21, .65], [.28, 85], .65, 5.5, 'bank'),
  ],
  'east-alluvial': [
    rule('tussock', 118, [.38, 1.04], [.27, 160], .47, 1.9),
    rule('rush', 70, [.46, 1.03], [-.17, 1.5], .47, 1.3, 'fresh-margin'),
    rule('cobble', 102, [.18, .82], [-.34, 2.8], .55, 2.15, 'bank'),
  ],
  wetland: [
    rule('rush', 212, [.58, 1.45], [-.28, 1.05], .40, 1.02, 'fresh-margin'),
    rule('fern', 81, [.32, .76], [.18, 2.2], .41, 1.95, 'fresh-bank'),
    rule('submerged', 87, [.38, .72], [-2.05, -.9], .33, 1.28, 'fresh-shoal'),
    rule('duff', 40, [.28, .73], [.10, 1.4], .42, 2.6, 'fresh-bank'),
  ],
  highland: [
    rule('heath', 82, [.18, .42], [.15, 1200], .51, 2.9),
    rule('scree', 118, [.20, 1.65], [.25, 1200], .77, 3.2, 'rock'),
  ],
  'highland-lake': [
    rule('heath', 76, [.24, .53], [.7, 28], .52, 3.1),
    rule('cobble', 132, [.16, .95], [-1.2, 21.5], .66, 2.26, 'bank'),
    rule('submerged', 22, [.21, .48], [-2.35, -.85], .42, 2.0, 'fresh-shoal'),
  ],
  'dry-upland': [
    rule('heath', 64, [.26, .58], [.8, 1200], .57, 4.55),
    rule('tussock', 42, [.22, .59], [1, 1200], .53, 4.6),
    rule('scree', 136, [.26, 1.24], [.65, 1200], .86, 2.65, 'rock'),
  ],
  'west-coast': [
    rule('heath', 41, [.19, .45], [2.7, 16], .60, 3.3),
    rule('cobble', 78, [.20, .9], [-1.1, 7], .68, 2.45, 'bank'),
    rule('algae', 57, [.21, .61], [-5.2, -1.55], .48, 1.62, 'marine-rock'),
  ],
  estuary: [
    rule('rush', 92, [.49, 1.18], [-.13, 1.5], .39, 1.35, 'estuary-margin'),
    rule('cobble', 75, [.18, .77], [-.38, 3.4], .57, 2.3, 'bank'),
  ],
  'east-bay': [
    rule('tussock', 47, [.25, .64], [1.8, 11.3], .48, 3.9),
    rule('cobble', 106, [.16, .68], [-.9, 5.7], .60, 2.1, 'bank'),
  ],
  'east-bay-shoal': [
    rule('seagrass', 115, [.37, .95], [-7.2, -1.65], .32, 1.19, 'marine-sand'),
    rule('algae', 49, [.27, .80], [-8.7, -2.1], .48, 1.44, 'marine-rock'),
  ],
  'shelf-east': [
    rule('seagrass', 112, [.35, .96], [-7.9, -1.65], .30, 1.12, 'marine-sand'),
    rule('algae', 56, [.29, .82], [-8.4, -2.1], .50, 1.37, 'marine-rock'),
  ],
  'shelf-south': [
    rule('seagrass', 134, [.31, .85], [-7.9, -1.65], .31, 1.1, 'marine-sand'),
    rule('algae', 47, [.27, .75], [-8.4, -2.1], .48, 1.49, 'marine-rock'),
  ],
  'shelf-northeast': [
    rule('algae', 64, [.26, .71], [-8.4, -2.1], .51, 1.55, 'marine-rock'),
    rule('cobble', 62, [.21, .71], [-9.1, -2], .59, 1.55, 'marine-bed'),
  ],
  'north-source': [
    rule('rush', 43, [.36, .78], [-.18, .94], .53, 1.1, 'fresh-margin'),
    rule('fern', 58, [.26, .65], [.19, 8], .49, 1.7, 'fresh-bank'),
  ],
  'east-source': [
    rule('rush', 47, [.43, 1], [-.16, .94], .50, 1.1, 'fresh-margin'),
    rule('fern', 67, [.3, .78], [.26, 8], .47, 1.8, 'fresh-bank'),
  ],
};

export function islandCoverAreas(data, visits) {
  const areas = {};
  const fromVisit = (id, visitId, reach) => {
    const visit = visits[visitId];
    if (!visit) return;
    const origin = [visit.p[0], visit.p.at(-1)];
    const vector = [visit.gaze[0] - origin[0], visit.gaze[2] - origin[1]];
    const length = Math.hypot(...vector) || 1;
    areas[id] = {origin, direction: vector.map(v => v / length), reach};
  };
  fromVisit('mixed-forest', 'mixed-forest', 195);
  fromVisit('ridge-woodland', 'ridge-woodland', 210);
  fromVisit('giant-forest', 'giant-forest', 265);
  fromVisit('lake', 'lake-shingle', 215);
  if (!areas.lake) areas.lake = {origin: [3242, -1940], direction: [-1, .08], reach: 215};
  fromVisit('grassland', 'grassland', 300);
  fromVisit('east-alluvial', 'alluvial-bend', 218);
  fromVisit('wetland', 'wetland-runnels', 250);
  if (!areas.wetland) areas.wetland = {origin: [5400, 5900], direction: [.97, .24], reach: 250};
  fromVisit('highland', 'review-highland-ground', 250);
  fromVisit('highland-lake', 'tarn-moraine', 190);
  if (!areas['highland-lake']) areas['highland-lake'] = {origin: [3800, -4840], direction: [-.79, -.61], reach: 190};
  fromVisit('dry-upland', 'dry-escarpment', 250);
  if (!areas['dry-upland']) areas['dry-upland'] = {origin: [4910, 555], direction: [.91, -.42], reach: 250};
  fromVisit('west-coast', 'rock-cove', 155);
  fromVisit('estuary', 'estuary', 175);
  fromVisit('east-bay', 'east-bay', 185);
  const eastShelf = data.cove.shelves[1];
  if (eastShelf) areas['east-bay-shoal'] = {origin: eastShelf.at(0, 175), direction: [-.6, -.8], reach: 60};
  fromVisit('north-source', 'north-source', 62);
  fromVisit('east-source', 'east-source', 72);
  for (const id of ['mixed-forest', 'ridge-woodland']) {
    if (areas[id]) continue;
    const pilot = id === 'mixed-forest' ? [-590, 610, .53, .85] : [640, -655, .69, -.72];
    areas[id] = {origin: pilot.slice(0, 2), direction: pilot.slice(2), reach: 210};
  }
  if (!areas['east-alluvial']) areas['east-alluvial'] = {origin: [7910, 4200], direction: [-.98, -.18], reach: 218};
  for (const id of ['west-coast', 'estuary']) {
    if (areas[id]) continue;
    const site = data.hydrology.coasts.find(s => s.id === (id === 'west-coast' ? 'rock-cove' : id));
    if (site) areas[id] = {origin: site.visit, direction: id === 'west-coast' ? [-.94, .34] : [-.7, .71], reach: 156};
  }
  for (const site of data.cove.continuous.divingSites ?? []) {
    if (!ISLAND_COVER_RECIPES[site.id]) continue;
    areas[site.id] = {origin: site.point, direction: [0, 1], reach: 58};
  }
  return areas;
}

export function islandGroundAt(data, x, z) {
  const {terrain, field, island} = data;
  const y = terrain.heightAt(x, z), delta = 1;
  const gx = (terrain.heightAt(x + delta, z) - terrain.heightAt(x - delta, z)) / (2 * delta);
  const gz = (terrain.heightAt(x, z + delta) - terrain.heightAt(x, z - delta)) / (2 * delta);
  const [inlandLevel, edge, flowX, flowZ] = field.sample(x, z);
  const marine = data.cove.continuous.marineAt(x, z);
  const fresh = inlandLevel > island.seaLevel + .55 && edge < 24;
  const sea = marine > .60 && !fresh;
  const level = fresh ? inlandLevel : island.seaLevel;
  const res = island.maskRes;
  const tx = Math.max(0, Math.min(res - 1, Math.floor((x / island.size + .5) * res)));
  const tz = Math.max(0, Math.min(res - 1, Math.floor((z / island.size + .5) * res)));
  const offset = (tz * res + tx) * 4;
  const substrate = data.landforms?.substrateAt?.(x, z);
  const rock = substrate?.rock ?? data.islandMasks[offset + 2] / 255;
  const sand = substrate?.sand ?? 1;
  const slope = Math.hypot(gx, gz);
  return {x, y, z, gx, gz, slope, edge, marine, fresh, sea, level, height: y - level, rock, sand,
    trail: data.islandMasks[offset] / 255, wood: data.islandMasks[offset + 3] / 255, flow: [flowX, flowZ]};
}

function suitable(g, spec, id) {
  if (!Number.isFinite(g.y) || g.slope > spec.slope || !between(g.height, spec.band)) return false;
  if (g.height > 0 && g.trail > .55) return false;
  switch (spec.substrate) {
    case 'fresh-margin': return g.fresh && (g.edge < 1.4 || g.height > .1) && g.rock < .79;
    case 'fresh-shoal': return g.fresh && g.edge < -.25 && Math.hypot(...g.flow) < .34 && g.rock < .69;
    case 'fresh-bank': return g.fresh && g.height > .08 && g.rock < .72;
    case 'estuary-margin': return (g.fresh || g.marine > .35) && g.height > -.15 && g.rock < .54;
    case 'marine-sand': return g.sea && g.slope < .23 && g.sand > .42 && g.rock < .43;
    case 'marine-rock': return g.sea && (g.rock > .14 || g.sand < .68 || g.slope > .036 || g.nearMarineRock);
    case 'marine-bed': return g.sea;
    case 'bank': return (g.fresh || g.marine > .19 || g.height < 62) && (g.height > 0 || g.sea || g.edge < 0);
    case 'rock': return g.height > 0 && (g.rock > .32 || g.slope > .17);
    default: return g.height > 0 && g.rock < .75
      && (id !== 'giant-forest' || g.wood > .28);
  }
}

function pockets(area, rng, count) {
  const [x, z] = area.origin, [dx, dz] = area.direction;
  return Array.from({length: count}, (_, i) => {
    const reach = i < 12 ? 13 + rng() * Math.min(area.reach * .23, 51) : Math.sqrt(rng()) * area.reach;
    const a = Math.atan2(dz, dx) + (rng() - .5) * (i < 12 ? 2.65 : TAU);
    return [x + Math.cos(a) * reach, z + Math.sin(a) * reach];
  });
}

export function planIslandEcology(data, visits, obstacles = [], visitorCover = []) {
  const areas = islandCoverAreas(data, visits), sites = [], counts = {};
  const route = data.field.continuousSample;
  const cellSize = 48, byCell = new Map();
  for (const p of obstacles) {
    const key = Math.floor(p.x / cellSize) + ',' + Math.floor(p.z / cellSize);
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(p);
  }
  function nearbyObstacles(x, z) {
    const i = Math.floor(x / cellSize), j = Math.floor(z / cellSize), nearby = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cell = byCell.get((i + dx) + ',' + (j + dz));
      if (cell) nearby.push(...cell);
    }
    return nearby;
  }
  let seed = 74713;
  for (const [id, specs] of Object.entries(ISLAND_COVER_RECIPES)) {
    const area = areas[id];
    if (!area) continue;
    const regional = counts[id] = {};
    for (const spec of specs) {
      const rng = mulberry32(seed += 1777), anchors = pockets(area, rng, 73);
      const accepted = [];
      for (let i = 0; i < spec.count * 30 && accepted.length < spec.count; i++) {
        const a = anchors[i % anchors.length], angle = rng() * TAU;
        const radius = (1 + rng() * rng() * 8) * (i % 3 === 0 ? 1.6 : 1);
        const x = a[0] + Math.cos(angle) * radius, z = a[1] + Math.sin(angle) * radius;
        if (Math.max(Math.abs(x), Math.abs(z)) < 515) continue;
        if (Math.hypot(x - area.origin[0], z - area.origin[1]) < 3.1) continue;
        if (x > -1536 && x < -512 && z > -672 && z < 352 && (route?.sample(x, z)?.[1] ?? 100) < 74) continue;
        const g = islandGroundAt(data, x, z);
        const seabed = g.sea && g.height < 0;
        const solids = seabed ? nearbyObstacles(x, z) : [];
        g.nearMarineRock = solids.some(p => Math.hypot(x - p.x, z - p.z) < (p.radius ?? p.footRadius ?? 0) + 5.5);
        if (!suitable(g, spec, id)) continue;
        if (accepted.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < spec.spacing ** 2)) continue;
        const [low, high] = spec.scale, scale = low + rng() * (high - low);
        if (solids.some(p => Math.hypot(x - p.x, z - p.z) < (p.footRadius ?? p.radius ?? 0) * .84 + scale)) continue;
        if (spec.form === 'submerged' && -g.height < scale + .22) continue;
        const marine = spec.substrate.startsWith('marine');
        const mode = spec.form === 'submerged' ? 2 : marine ? 3 : 0;
        const site = {region: id, form: spec.form, x, y: g.y - .018, z, scale, depth: -g.height, mode,
          yaw: rng() * TAU, seed: rng(), flow: marine ? [.09, .025] : g.flow};
        accepted.push(site);
        sites.push(site);
      }
      regional[spec.form] = accepted.length;
    }
  }
  for (const site of visitorCover) {
    sites.push(site);
    const regional = counts[site.region] ??= {};
    regional[site.form] = (regional[site.form] ?? 0) + 1;
  }
  return {areas, sites, counts};
}
