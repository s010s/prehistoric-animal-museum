import { Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { faunaMediumLimits } from './IslandFaunaHabitats.js';
import { routePoint } from './IslandFaunaRoute.js';

const environmentNames = {
  ichthyornis: '鱼鸟',
  sapeornis: '会鸟',
  meganeura: '巨脉蜻蜓',
  stenodictya: '古网翅目昆虫（Stenodictya）',
  juracimbrophlebia: '侏罗蝎蛉',
  rhamphorhynchus: '喙嘴翼龙',
  pterodaustro: '南方翼龙',
  diplomystus: '双棱鲱',
  aspidorhynchus: '剑鼻鱼',
  cheiracanthus: '棘鱼（Cheiracanthus）',
  dipterus: '双鳍鱼',
  coccosteus: '盾皮鱼（Coccosteus）',
  eusthenopteron: '真掌鳍鱼',
  falcatus: '古软骨鱼（Falcatus）',
  anomalocaris: '奇虾',
  aeger: '底栖虾（Aeger）',
  eryon: '甲壳类（Eryon）',
};
const reefNames = { 1: '块状珊瑚', 2: '片状珊瑚', 3: '指状珊瑚' };
const CELL_SIZE = 128;
const spawnGrids = new WeakMap();
const articulatedCenter = new Vector3();

function spawnGrid(fauna) {
  let grid = spawnGrids.get(fauna);
  if (grid) return grid;
  grid = new Map();
  for (const actor of fauna.individuals.values()) {
    const [x, , z] = actor.route.origin;
    const key = `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ actor, spawn: undefined });
  }
  spawnGrids.set(fauna, grid);
  return grid;
}

function spawnPosition(app, actor) {
  const { site, body, route } = actor;
  // The runtime starts at distance zero and falls back to the resting heading.
  for (const [x, y, z, yaw] of [routePoint(route, 0), [...route.origin, route.yaw]]) {
    const fit = faunaMediumLimits(app.terrainData, app.creekData.field, site, body, x, z, yaw);
    if (!fit) continue;
    const ground = site.medium === 'ground' || site.medium === 'benthic';
    return [x, ground ? fit.min : Math.min(fit.max, Math.max(fit.min, y)), z];
  }
  return null;
}

function visitIsland(app, visitor, radius, inReach, offer) {
  const fauna = app.islandFauna;
  if (!fauna || fauna.residency.disposed) return;
  for (const actor of fauna.residents) {
    const visible = actor.active && !!actor.model?.group.visible;
    offer(actor.id, actor.site.title, actor.x, actor.y, actor.z, actor.body.half[1], actor.site.length, actor.site.medium, visible, visible, actor.collider);
  }
  const grid = spawnGrid(fauna);
  const visitCell = entries => {
    for (const entry of entries) {
      const { actor } = entry;
      const [px, , pz] = actor.route.origin;
      if (actor.model || !inReach(px, pz) || fauna.residency.state(actor.id)?.status === 'failed') continue;
      if (entry.spawn === undefined) entry.spawn = spawnPosition(app, actor);
      if (!entry.spawn) continue;
      offer(actor.id, actor.site.title, ...entry.spawn, actor.body.half[1], actor.site.length, actor.site.medium, false);
    }
  };
  if (radius === Infinity) {
    for (const entries of grid.values()) visitCell(entries);
    return;
  }
  const x0 = Math.floor((visitor.x - radius) / CELL_SIZE), x1 = Math.floor((visitor.x + radius) / CELL_SIZE);
  const z0 = Math.floor((visitor.z - radius) / CELL_SIZE), z1 = Math.floor((visitor.z + radius) / CELL_SIZE);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const entries = grid.get(`${x},${z}`);
    if (entries) visitCell(entries);
  }
}

function visitSample(app, offer) {
  const residency = app.islandFauna?.residency;
  if (residency?.disposed) return;
  app.animals?.visitTrackingActors(actor => {
    const { definition, model, active, halfExtents } = actor;
    const id = `sample:${definition.id}`;
    if (!model && residency?.state(id)?.status === 'failed') return;
    const visible = active && !!model?.group.visible;
    const { x, y, z } = model ? actor.center : actor.trackingSpawn;
    offer(id, definition.name, x, y, z, halfExtents[1], definition.metres, 'ground', visible, visible, actor.collider);
  });
  const sample = app.sampleMuseumLife;
  if (!sample?.group.visible) return;
  for (const actor of sample.actors) {
    const { definition, model, active } = actor;
    const { data, title } = definition;
    const id = `sample:${data.id}`;
    if (!model && residency?.state(id)?.status === 'failed') continue;
    const visible = active && !!model?.group.visible;
    const center = model ? sample.centerOf(actor) : sample.reviewAnchors[data.id]?.initialCenter;
    const medium = definition.habitat === 'land' ? 'ground' : definition.habitat;
    if (center) offer(id, title, ...center, data.dimensions[1] * data.scale * .5, data.metres, medium, visible, visible, actor.collider);
  }
}

function visitSwimmers(life, offer) {
  for (const fish of life.trackingSwimmers) {
    const { x, y, z } = fish.p, group = fish.group;
    if (group.reviewed && !life.reviewedSwim[group.reviewed].ready) continue;
    const species = environmentNames[fish.vault] ?? '浅水鱼';
    // Keep each member's pose so there is a label for the individuals in view.
    const name = group.school ? species + '群' : species;
    const medium = fish.shrimp ? 'benthic' : group.sea ? 'marine' : 'freshwater';
    offer(`environment:swimmer:${fish.trackingId}`, name, x, y, z, fish.L * .21, fish.L, medium, true, fish.trackingVisible);
  }
}

function visitArticulated(offer, animal, kind, id, medium) {
  if (!animal?.root.visible) return;
  const { root } = animal;
  const { min, max } = animal.articulation.rig.info.bounds;
  articulatedCenter.set((min[0] + max[0]) * .5, (min[1] + max[1]) * .5, (min[2] + max[2]) * .5)
    .multiply(root.scale).applyQuaternion(root.quaternion).add(root.position);
  const { x, y, z } = articulatedCenter;
  const halfHeight = (max[1] - min[1]) * root.scale.y * .5;
  const size = Math.max((max[0] - min[0]) * root.scale.x, (max[2] - min[2]) * root.scale.z, halfHeight * 2);
  offer(`environment:${kind}:${id}`, environmentNames[kind], x, y, z, halfHeight, size, medium);
}

function visitBenthos(benthos, offer) {
  benthos.crawlers.forEach((animal, i) => visitArticulated(offer, animal, 'eryon', i, 'benthic'));
  for (const [batches, name] of [[benthos.corals, '珊瑚群体'], [benthos.shells, '贝类'], [benthos.sponges, '海绵']]) {
    for (const batch of batches) {
      if (!batch.mesh.visible) continue;
      for (const index of batch.activeIndices) {
        const site = batch.sites[index];
        offer(`environment:bottom:${batch.kind}:${index}`, name, site.x, site.centerY, site.z, site.halfHeight, site.span, 'benthic');
      }
    }
  }
}

function visitEnvironment(app, offer) {
  const life = app.life;
  if (life?.enabled && !life.disposed && life.group.visible) {
    visitSwimmers(life, offer);
    const flight = life.environment;
    for (const flier of flight.trackingFliers) {
      if (!flight.types.get(flier.species).batch) continue;
      const { x, y, z } = flier.position;
      offer(`environment:flight:${flier.id}`, environmentNames[flier.species], x, y, z, flier.trackingSpan * .23, flier.trackingSpan, 'air', true, flier.trackingVisible);
    }
    life.pterosaurs?.flyers.forEach((animal, i) => visitArticulated(offer, animal, animal.species.toLowerCase(), i, 'air'));
    visitArticulated(offer, life.insect, 'meganeura', 0, 'air');
    if (life.benthos) visitBenthos(life.benthos, offer);
  }
  const reef = app.shelfReef;
  if (!reef?.enabled || !reef.group.visible) return;
  for (const colony of reef.trackingColonies) {
    const { id, type, x, z, top, bottom, radius, trackingVisible, collider } = colony;
    offer(`environment:reef:${id}`, reefNames[type], x, (top + bottom) * .5, z, (top - bottom) * .5, radius * 2, 'benthic', true, trackingVisible, collider);
  }
}

// Live positions can be tracked outside the current camera frame. Spawn points
// belong to placed encounters and never request a residency slot on their own.
export function visitNearbyFauna(app, visitor, radius, emit, { museumOnly = false } = {}) {
  const radiusSquared = radius * radius;
  const inReach = (x, z) => (x - visitor.x) ** 2 + (z - visitor.z) ** 2 <= radiusSquared;
  const offer = museum => (id, name, x, y, z, halfHeight, size, medium, live = true, visible = live, occluder) => {
    if (inReach(x, z) && Number.isFinite(y)) emit({ id, name, x, y, z, halfHeight, size, live, visible, museum, medium, occluder });
  };
  const offerMuseum = offer(true);
  visitIsland(app, visitor, radius, inReach, offerMuseum);
  visitSample(app, offerMuseum);
  if (!museumOnly) visitEnvironment(app, offer(false));
}
