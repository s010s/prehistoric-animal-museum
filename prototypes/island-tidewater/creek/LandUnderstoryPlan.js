// Small colonies on the shoulders of existing paths and clearings. Each form
// refers to an existing island mesh and material. Distances are in metres.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {islandGroundAt} from './IslandEcologyPlan.js';
import {routePoint} from './IslandFaunaRoute.js';

const TAU = 2 * Math.PI;
const cover = (form, count, low, high) => ({form, count, low, high});
const COMMUNITIES = {
  floodplain: [cover('onoclea', 3, .51, .78), cover('rush', 7, .59, .96), cover('cobble', 12, .24, .99)],
  marsh: [cover('rush', 12, .66, 1.2), cover('onoclea', 4, .52, .85), cover('duff', 7, .55, 1.2)],
  meadow: [cover('cycad', 3, .67, .99), cover('heath', 9, .62, 1.1), cover('tussock', 13, .53, 1.06)],
  'meadow-edge': [cover('cycad', 6, .91, 1.66), cover('heath', 7, .64, 1.05), cover('tussock', 10, .51, 1.09)],
  savanna: [cover('heath', 12, .54, .98), cover('tussock', 17, .66, 1.19)],
  dry: [cover('cycad', 3, .58, .91), cover('scree', 16, .46, 1.64), cover('heath', 9, .42, .86)],
  conifer: [cover('onoclea', 7, .59, .95), cover('duff', 13, .62, 1.3), cover('scree', 7, .32, .93)],
  tundra: [cover('talus', 11, .35, .88), cover('scree', 9, .32, .94), cover('heath', 6, .27, .45), cover('tussock', 9, .46, .84)],
};
const DISTRICTS = [
  ['fauna-maiasaura', 'meadow'], ['fauna-ankylosaurus', 'meadow'], ['fauna-phorusrhacos', 'savanna'],
  ['fauna-gallimimus', 'conifer'], ['fauna-carnotaurus', 'dry'], ['fauna-mammoth', 'tundra'],
  ['fauna-baryonyx', 'floodplain'], ['fauna-spinosaurus', 'marsh'], ['grassland', 'meadow-edge'],
  ['dry-upland', 'dry'], ['alluvial-bend', 'floodplain'], ['wetland-runnels', 'marsh'],
];

function animalTrack(actor) {
  const {body, route} = actor, [hx,,hz] = body.half;
  const count = Math.max(1, Math.ceil(route.length / 1.5));
  return Array.from({length: count}, (_, i) => {
    const [x,,z,yaw] = routePoint(route, i * route.length / count);
    return {x, z, hx: hx + .68, hz: hz + .68, sin: Math.sin(yaw), cos: Math.cos(yaw)};
  });
}

function intersectsTrack(track, x, z, pad) {
  return track.some(p => {
    const dx = x - p.x, dz = z - p.z;
    return Math.abs(p.cos * dx - p.sin * dz) < p.hx + pad
      && Math.abs(p.sin * dx + p.cos * dz) < p.hz + pad;
  });
}

export function planLandUnderstory(data, app, plantSpecs) {
  const visits = {...app.islandVisits, ...app.islandFaunaHabitats?.visits};
  const plants = [], coverSites = [], landmarks = [], counts = {}, used = [];
  const routes = [...(app.islandFauna?.actors.values() ?? [])].filter(a => a.site.medium === 'ground').map(animalTrack);
  const trees = app.vegetation?.records ?? [];
  for (const [index, [id, community]] of DISTRICTS.entries()) {
    const visit = visits[id];
    if (!visit) continue;
    const [ox, oz] = [visit.p[0], visit.p.at(-1)], [tx,,tz] = visit.gaze;
    const sight = Math.hypot(tx - ox, tz - oz);
    if (sight < .01) continue;
    const dx = (tx - ox) / sight, dz = (tz - oz) / sight;
    const tracks = routes.filter(samples => samples.some(p => Math.abs(ox - p.x) < 50 && Math.abs(oz - p.z) < 50)).flat();
    const trunks = trees.filter(t => Math.abs(ox - t.x) < 40 && Math.abs(oz - t.z) < 40);
    const rng = mulberry32(62019 + 953 * index), regional = counts[id] = {};
    const anchors = [];
    // Near clumps flank the open centre. Beyond the clearing they become
    // irregular, longer colonies following local ground contours.
    for (let i = 0; i < 11; i++) {
      const along = 2.4 + i * 2.14 + rng() * 1.8;
      const lateral = (i % 2 ? 1 : -1) * (1.8 + rng() * (2.4 + along * .28));
      const x = ox + dx * along - dz * lateral, z = oz + dz * along + dx * lateral;
      const g = islandGroundAt(data, x, z);
      anchors.push({x, z, angle: g.slope > .025 ? Math.atan2(g.gx, -g.gz) : rng() * TAU});
    }
    function free(x, z, radius) {
      const ex = x - ox, ez = z - oz, forward = ex * dx + ez * dz;
      if (Math.hypot(ex, ez) < 2.4 + radius) return false;
      if (forward > -2 && forward < Math.min(sight + 1, 18) && Math.abs(ex * dz - ez * dx) < 1 + radius) return false;
      return !intersectsTrack(tracks, x, z, radius) && !trunks.some(t => Math.hypot(t.x - x, t.z - z) < .6 + radius)
        && !used.some(p => Math.abs(p.x - x) < 5 && Math.hypot(p.x - x, p.z - z) < p.radius + radius);
    }
    if (id === 'fauna-carnotaurus') {
      const scale = 2.55;
      for (const a of anchors.slice(5)) {
        const g = islandGroundAt(data, a.x, a.z);
        if (g.height < .2 || g.slope > .44 || g.trail > .52 || !free(g.x, g.z, scale * .83)) continue;
        if (Math.abs((a.x - ox) * dz - (a.z - oz) * dx) < 6.8) continue;
        landmarks.push({id:'cross-bedded-sandstone', region:id, ground:g,
          scale:[scale, scale, scale], embed:.46, yaw:a.angle + (rng() - .5) * .6});
        used.push({x:g.x, z:g.z, radius:scale * .81});
        break;
      }
    }
    for (const [n, spec] of COMMUNITIES[community].entries()) {
      const {form, count, low, high} = spec;
      const atlasKind = form === 'cycad' || form === 'onoclea' ? plantSpecs.findIndex(s => s.id === form) : -1;
      let accepted = 0;
      for (let trial = 0; trial < count * 20 && accepted < count; trial++) {
        // Each species colonises several pockets and grows in families of
        // different size. Adjacent rock and vegetation can share a pocket.
        const a = anchors[(Math.floor(trial / 3) * 3 + n * 2) % anchors.length];
        const along = (rng() - .5) * 5.8, across = (rng() - .5) * 2.65;
        const x = a.x + along * Math.cos(a.angle) - across * Math.sin(a.angle);
        const z = a.z + along * Math.sin(a.angle) + across * Math.cos(a.angle);
        // The tall native grasses at the eastern meadow obscure low recruits.
        // A mature crown and younger neighbours mark the middle-distance slope.
        const meadowCrown = community === 'meadow-edge' && form === 'cycad';
        const alongView = (x - ox) * dx + (z - oz) * dz;
        const toSide = Math.abs((x - ox) * dz - (z - oz) * dx);
        if (meadowCrown && (alongView < 12 || toSide > alongView * .48 || toSide < 3.5)) continue;
        const scale = meadowCrown ? high - (accepted % 3) * .32 + rng() * .13 : low + (high - low) * rng() ** 1.45;
        const radius = scale * (form === 'cycad' ? 1.2 : form === 'onoclea' || form === 'scree' || form === 'talus' ? .75 : .45);
        if (!free(x, z, radius)) continue;
        const g = islandGroundAt(data, x, z);
        if (g.height < .09 || g.trail > .55 || g.slope > (form === 'scree' || form === 'talus' ? .75 : .53)) continue;
        if (form === 'rush' && !(g.fresh && g.height < 2.3)) continue;
        if ((form === 'cycad' || form === 'onoclea') && g.rock > .77) continue;
        const site = {region:id, x, z, y:g.y - .018, scale, seed:rng(), yaw:rng() * TAU,
          mode:0, depth:-g.height, flow:g.flow};
        if (atlasKind >= 0) {
          const p = plantSpecs[atlasKind];
          plants.push({...site, id:form, kind:atlasKind, height:p.height * scale, ground:g.y, slope:g.slope,
            water:g.level, range:p.range, flex:p.flex, lift:0});
        } else {
          coverSites.push({...site, form});
        }
        used.push({x, z, radius});
        accepted++;
      }
      regional[form] = accepted;
    }
  }
  return {plants, coverSites, landmarks, counts};
}
