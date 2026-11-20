import { Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { faunaMediumLimits } from './IslandFaunaHabitats.js';
import { ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS } from './IslandFaunaPlan.js';
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
const exhibitBySpecies = new Map(ISLAND_FAUNA_PLAN.map(exhibit => [exhibit.id, exhibit]));
const regionTitles = new Map(ISLAND_FAUNA_REGIONS.map(region => [region.id, region.title]));
const districtVisits = { creek: 'entrance', 'west-coast': 'west-shelf' };
const CELL_SIZE = 128;
const spawnGrids = new WeakMap();
const spawnPositions = new WeakMap();
const observations = new WeakMap();
const articulatedCenter = new Vector3();

function spawnGrid(fauna) {
  let grid = spawnGrids.get(fauna);
  if (grid) return grid;
  grid = new Map();
  for (const actor of fauna.individuals.values()) {
    const [x, , z] = actor.route.origin;
    const key = `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(actor);
  }
  spawnGrids.set(fauna, grid);
  return grid;
}

function spawnPosition(app, actor) {
  if (!spawnPositions.has(actor)) spawnPositions.set(actor, testSpawnPosition(app, actor));
  return spawnPositions.get(actor);
}

function testSpawnPosition(app, actor) {
  const { site, body, route } = actor;
  // The runtime starts at distance zero and falls back to the resting heading.
  for (const [x, y, z, yaw] of [routePoint(route, 0), [...route.origin, route.yaw]]) {
    const fit = faunaMediumLimits(app.terrainData, app.creekData.field, site, body, x, z, yaw);
    if (!fit) continue;
    const ground = site.medium === 'ground' || site.medium === 'benthic';
    return { x, y: ground ? fit.min : Math.min(fit.max, Math.max(fit.min, y)), z };
  }
  return null;
}

function observationPoint(app, visit) {
  if (!visit?.p || visit.habitatAvailable === false) return null;
  if (observations.has(visit)) return observations.get(visit);
  const x = visit.p[0], z = visit.p.at(-1);
  const dive = visit.diveLevel;
  const y = dive !== undefined ? dive - (visit.eyeBelowSurface ?? 1.2) : visit.eye?.[1]
    ?? (visit.fly ? visit.p[1] : (visit.footing?.ground ?? visit.footing?.y ?? app.terrainData.heightAt(x, z)) + 1.62);
  const medium = dive !== undefined ? 'water' : visit.fly ? 'air' : 'ground';
  const result = { id: visit.id, x, y, z, medium, waterLevel: dive };
  observations.set(visit, result);
  return result;
}

function availabilityFor(residency, id, live) {
  if (live) return 'live';
  const status = residency?.state(id)?.status;
  if (status === 'failed') return 'unavailable';
  return status === 'queued' || status === 'loading' ? 'loading' : 'habitat';
}

function isLive(actor) {
  return !!(actor.active && actor.model?.group.visible);
}

function islandRecord(app, actor) {
  const { id, site, body } = actor;
  const live = isLive(actor);
  const point = live ? actor : spawnPosition(app, actor);
  if (!point) return null;
  const { x, y, z } = point;
  const { medium, title: name, length: size, id: speciesId, regionId, englishName, population } = site;
  const source = population ? 'population' : 'collection';
  const visit = population ? null : app.islandVisits?.[site.visitId];
  const district = app.islandVisits?.[districtVisits[site.districtId] ?? site.districtId];
  const habitat = (population ? district?.title : null) ?? regionTitles.get(regionId);
  const observation = observationPoint(app, visit);
  return { id, speciesId, name, englishName, habitat, x, y, z, halfHeight: body.half[1], size, live, visible: live, museum: true,
    source, medium, availability: availabilityFor(app.islandFauna.residency, id, live), occluder: live ? actor.collider : undefined,
    observation, visitId: observation?.id ?? null, fallbackVisitId: population ? site.visitId : null };
}

function visitIsland(app, visitor, radius, inReach, offer, speciesId) {
  const fauna = app.islandFauna;
  if (!fauna || fauna.residency.disposed) return;
  for (const actor of fauna.residents) {
    if ((!speciesId || speciesId === actor.site.id) && isLive(actor) && inReach(actor.x, actor.z)) offer(islandRecord(app, actor));
  }
  const grid = spawnGrid(fauna);
  const visitCell = entries => {
    for (const actor of entries) {
      const [px, , pz] = actor.route.origin;
      if (isLive(actor) || (speciesId && speciesId !== actor.site.id) || !inReach(px, pz)) continue;
      offer(islandRecord(app, actor));
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

function sampleRecord(app, { id: speciesId, name, size, medium, actor, position, halfHeight, visit }) {
  if (!position) return null;
  const id = `sample:${speciesId}`;
  const live = isLive(actor);
  const exhibit = exhibitBySpecies.get(speciesId);
  const observation = observationPoint(app, visit);
  const { x, y, z } = position;
  return { id, speciesId, name, englishName: exhibit?.englishName, x, y, z, halfHeight, size, live, visible: live, museum: true, medium,
    source: 'sample', habitat: medium === 'ground' ? '西岸溪谷样板' : '西岸样板浅海',
    observation, visitId: observation?.id ?? null, fallbackVisitId: null, occluder: live ? actor.collider : undefined,
    availability: availabilityFor(app.islandFauna?.residency, id, live) };
}

function visitSample(app, offer, speciesId) {
  const residency = app.islandFauna?.residency;
  if (residency?.disposed) return;
  app.animals?.visitTrackingActors?.(actor => {
    const { definition, halfExtents } = actor;
    if (speciesId && speciesId !== definition.id) return;
    const visit = app.islandVisits?.[`sample-${definition.id}`] ?? app.animals.visits?.[`sample-${definition.id}`];
    offer(sampleRecord(app, { id: definition.id, name: definition.name, size: definition.metres, medium: 'ground', actor,
      position: isLive(actor) ? actor.center : actor.trackingSpawn, halfHeight: halfExtents[1], visit }));
  });
  const sample = app.sampleMuseumLife;
  if (!sample?.group.visible) return;
  for (const actor of sample.actors) {
    const { definition } = actor;
    const { data, title } = definition;
    if (speciesId && speciesId !== data.id) continue;
    const anchor = sample.reviewAnchors[data.id];
    const center = isLive(actor) ? sample.centerOf(actor) : anchor?.initialCenter;
    if (!center) continue;
    const [x, y, z] = center;
    const medium = definition.habitat === 'land' ? 'ground' : definition.habitat;
    const visit = app.islandVisits?.[`sample-${data.id}`] ?? anchor?.visit;
    offer(sampleRecord(app, { id: data.id, name: title, size: data.metres, medium, actor, position: { x, y, z },
      halfHeight: data.dimensions[1] * data.scale * .5, visit }));
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
    offer(`environment:swimmer:${fish.trackingId}`, fish.vault ?? 'native-swimmer', name, x, y, z, fish.L * .21, fish.L, medium, fish.trackingVisible);
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
  offer(`environment:${kind}:${id}`, kind, environmentNames[kind], x, y, z, halfHeight, size, medium);
}

function visitBenthos(benthos, offer) {
  benthos.crawlers.forEach((animal, i) => visitArticulated(offer, animal, 'eryon', i, 'benthic'));
  for (const [batches, name] of [[benthos.corals, '珊瑚群体'], [benthos.shells, '贝类'], [benthos.sponges, '海绵']]) {
    for (const batch of batches) {
      if (!batch.mesh.visible) continue;
      for (const index of batch.activeIndices) {
        const site = batch.sites[index];
        offer(`environment:bottom:${batch.kind}:${index}`, batch.kind, name, site.x, site.centerY, site.z, site.halfHeight, site.span, 'benthic');
      }
    }
  }
}

function visitEnvironment(app, emit) {
  const offer = (id, speciesId, name, x, y, z, halfHeight, size, medium, visible = true, occluder) => {
    emit({ id, speciesId, name, x, y, z, halfHeight, size, medium, live: true, visible, museum: false,
      source: 'environment', availability: 'live', observation: null, visitId: null, fallbackVisitId: null, occluder });
  };
  const life = app.life;
  if (life?.enabled && !life.disposed && life.group.visible) {
    visitSwimmers(life, offer);
    const flight = life.environment;
    for (const flier of flight.trackingFliers) {
      if (!flight.types.get(flier.species).batch) continue;
      const { x, y, z } = flier.position;
      offer(`environment:flight:${flier.id}`, flier.species, environmentNames[flier.species], x, y, z, flier.trackingSpan * .23, flier.trackingSpan, 'air', flier.trackingVisible);
    }
    life.pterosaurs?.flyers.forEach((animal, i) => visitArticulated(offer, animal, animal.species.toLowerCase(), i, 'air'));
    visitArticulated(offer, life.insect, 'meganeura', 0, 'air');
    if (life.benthos) visitBenthos(life.benthos, offer);
  }
  const reef = app.shelfReef;
  if (!reef?.enabled || !reef.group.visible) return;
  for (const colony of reef.trackingColonies) {
    const { id, type, x, z, top, bottom, radius, trackingVisible, collider } = colony;
    offer(`environment:reef:${id}`, `reef-form-${type}`, reefNames[type], x, (top + bottom) * .5, z, (top - bottom) * .5, radius * 2, 'benthic', trackingVisible, collider);
  }
}

// Live positions can be tracked outside the current camera frame. Spawn points
// belong to placed encounters and never request a residency slot on their own.
export function visitNearbyFauna(app, visitor, radius, emit, { museumOnly = false, includeUnavailable = false, speciesId } = {}) {
  const radiusSquared = radius * radius;
  const inReach = (x, z) => (x - visitor.x) ** 2 + (z - visitor.z) ** 2 <= radiusSquared;
  const offer = target => {
    if (target && inReach(target.x, target.z) && Number.isFinite(target.y)
        && (includeUnavailable || target.availability !== 'unavailable')
        && (!speciesId || target.speciesId === speciesId)) emit(target);
  };
  visitIsland(app, visitor, radius, inReach, offer, speciesId);
  visitSample(app, offer, speciesId);
  if (!museumOnly) visitEnvironment(app, offer);
}

export function readFaunaTarget(app, id) {
  if (app.islandFauna?.residency.disposed) return null;
  const actor = app.islandFauna?.individuals.get(id);
  if (actor) return islandRecord(app, actor);
  let target = null;
  const match = candidate => {
    if (candidate?.id === id) target = candidate;
  };
  if (id.startsWith('sample:')) visitSample(app, match, id.slice(7));
  else if (id.startsWith('environment:')) visitEnvironment(app, match);
  return target;
}
