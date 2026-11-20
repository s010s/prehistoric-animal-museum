import { mulberry32 } from '../vendor/tidewater/src/util/Noise.js';
import { ISLAND_FAUNA_POPULATION_PLAN } from './IslandFaunaPopulationPlan.js';
import { ISLAND_FAUNA_PLAN } from './IslandFaunaPlan.js';

const SEA_LEVEL = -.7;
const TAU = Math.PI * 2;
const distance = (x, z, [a, b]) => Math.hypot(x - a, z - b);

function habitatFits(data, habitat, site, x, z) {
  if (!habitat) return true;
  const h = data.terrain.heightAt(x, z);
  const [level, edge] = data.field.sample(x, z);
  switch (habitat) {
    case 'lake-edge':
      return Math.abs(level - 385) < 1 && edge < 135 && h < level + 28;
    case 'river-bank':
      return level > SEA_LEVEL + .15 && edge < 63 && h < level + 17;
    case 'river':
      return level > SEA_LEVEL + .15 && edge < 0 && level - h > .7;
    case 'tarn-forage':
      // Shelter is only one term in the renderer's snow mask. The lower
      // basin benches remain exposed even at the centre of the snow climate.
      return h > 452 && (h < 620 || h < 725 && (data.landforms?.climate.snow.weight(x, z) ?? 0) < .58);
    case 'sea-edge':
      if (site.medium === 'air') return h >= -32 && h < 16;
      return h < SEA_LEVEL - .8 && h > SEA_LEVEL - 29;
    case 'shoal':
      return h < SEA_LEVEL - .55 && h > SEA_LEVEL - 13;
    case 'shelf':
      return h < SEA_LEVEL - 2 && h > SEA_LEVEL - 46;
  }
  throw Error('Unknown fauna habitat ' + habitat);
}

function obstacleFree(colliders, site, body, route, restingYaw = 0) {
  if (!colliders) return true;
  const [hx, hy, hz] = body.half;
  const ground = site.medium === 'ground', bed = site.medium === 'benthic';
  const radius = Math.hypot(hx, hz) + .25;
  for (let i = 0; i < route.path.length; i++) {
    const [x, y, z] = route.path[i];
    const [nextX, nextY, nextZ] = route.path[(i + 1) % route.path.length];
    const yaw = (route.path.length > 1 ? Math.atan2(nextX - x, nextZ - z) : restingYaw) - body.forward;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const t of [0, .5]) {
      const px = x + (nextX - x) * t, pz = z + (nextZ - z) * t;
      const py = y + (nextY - y) * t + (ground ? -body.floor : bed ? hy : 0);
      const pad = Math.min(.65, radius * .16);
      const cellX = Math.floor(px / 32), cellZ = Math.floor(pz / 32);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cylinders = colliders.treeCells.get((cellX + dx) + ',' + (cellZ + dz)) ?? [];
        for (const cylinder of cylinders) {
          if (py - hy > cylinder.yMax || py + hy < cylinder.yMin) continue;
          const wx = cylinder.x - px, wz = cylinder.z - pz;
          const lx = Math.abs(wx * c - wz * s), lz = Math.abs(wx * s + wz * c);
          if (Math.hypot(Math.max(0, lx - hx), Math.max(0, lz - hz)) < cylinder.radius + pad) return false;
        }
      }
      for (const box of colliders.boxes) {
        if (!box.solid || py - hy > box.top || py + hy < box.bottom) continue;
        if (Math.hypot(px - box.center.x, pz - box.center.z) < box.radius + radius) return false;
      }
    }
  }
  return true;
}

function claimFor(site, body) {
  const [x, , z] = site.center;
  const groundLift = site.medium === 'ground' ? -body.floor : site.medium === 'benthic' ? body.half[1] : 0;
  const range = Math.max(...site.path.map(([px, , pz]) => Math.hypot(px - x, pz - z)));
  const y = site.path.map(p => p[1] + groundLift);
  return {
    x, z, radius: range + Math.hypot(body.half[0], body.half[2]),
    low: Math.min(...y) - body.half[1], high: Math.max(...y) + body.half[1],
  };
}

function intersects(a, b, gap = .8) {
  return a.high + gap >= b.low && b.high + gap >= a.low &&
    Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius + gap;
}

function sightClaim(eye, gaze) {
  // Guard the space between the original camera and specimen. A passing
  // animal outside the shot can still be encountered on the way there.
  const x = (eye[0] + gaze[0]) * .5, z = (eye[2] + gaze[2]) * .5;
  return { x, z, radius: Math.hypot(gaze[0] - x, gaze[2] - z) + 1.2,
    low: Math.min(eye[1], gaze[1]) - 1.8, high: Math.max(eye[1], gaze[1]) + 2.3 };
}

function hash(id) {
  let h = 2166136261;
  for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

function preferredTravel(spec) {
  if (spec.behavior === 'ambush' || spec.behavior === 'hover') return spec.radius * .6;
  if (spec.id === 'pteranodon') return 24;
  if (spec.medium === 'air' || spec.medium === 'marine') return spec.radius * .83;
  if (spec.medium === 'benthic') return spec.radius * .9;
  return spec.behavior === 'patrol' || spec.behavior === 'amble' ? spec.radius * .74 : spec.radius * .67;
}

function solveIndividual(context, patch, spec, body, actorId, groupId, rng, claims, focus) {
  const { data } = context;
  const [cx, cz] = focus ?? patch.center;
  const travel = patch.route?.radius ?? preferredTravel(spec);
  const phase = rng() * TAU, activityPhase = rng() * 18;
  const form = { phase, aspect: .67 + rng() * .24, altitude: .87 + rng() * .38 };
  if (patch.route) Object.assign(form, patch.route.form);
  const speed = spec.speed * (.91 + rng() * .18);
  const wet = spec.medium === 'marine' || spec.medium === 'benthic' || spec.medium === 'freshwater';
  const options = travel ? [travel, .76 * travel, .53 * travel] : [0];
  // Ambush and hover exhibits may wait in a small pocket of suitable water.
  if (spec.behavior === 'ambush' || spec.behavior === 'hover') options.push(0);
  for (const radius of options) {
    const contour = { ...form };
    if (spec.medium === 'ground' && radius) {
      // Broad hips and planted outer feet need space in a turn. Near the
      // minimum radius use a rounded arc and let wider circuits meander.
      const turnRadius = spec.length * .37;
      if (radius < turnRadius) continue;
      contour.aspect = Math.max(form.aspect, Math.sqrt(turnRadius / radius));
      contour.wander = .11 * Math.max(0, 1 - turnRadius / (radius * contour.aspect ** 2));
    }
    for (let attempt = 0; attempt < (patch.spread ? 38 : 1); attempt++) {
      const a = phase + attempt * 2.399963229728653;
      const r = Math.sqrt(attempt / 37) * patch.spread;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (distance(x, z, patch.center) > patch.spread || !habitatFits(data, patch.habitat, spec, x, z)) continue;
      const axis = patch.route?.axis ?? phase + attempt * .38;
      const h = data.terrain.heightAt(x, z);
      const [level, edge] = data.field.sample(x, z);
      if (wet && spec.medium !== 'freshwater' && ((edge <= .05 && level > SEA_LEVEL + .15) || h >= SEA_LEVEL)) continue;
      if (wet && spec.medium !== 'freshwater' && data.cove.continuous.marineAt(x, z) < .62) continue;
      if (spec.medium === 'ground' && h < (edge <= .05 ? Math.max(SEA_LEVEL, level) : SEA_LEVEL) - .42) continue;
      const route = context.routeAt(context, spec, body, x, z, radius, axis, contour);
      if (!route || !obstacleFree(context.colliders, spec, body, route, axis + .9)) continue;
      const [startX, startY, startZ] = route.path[0];
      const [nextX, , nextZ] = route.path[1] ?? route.path[0];
      const [surface, shore] = data.field.sample(startX, startZ);
      const centerY = route.path.reduce((sum, p) => sum + p[1], 0) / route.path.length;
      const site = { ...spec, actorId, groupId, districtId: patch.districtId, population: true,
        activityPhase, speed, radius, path: route.path, center: [x, centerY, z],
        x: startX, y: startY, z: startZ, yaw: radius ? Math.atan2(nextX - startX, nextZ - startZ) : axis + .9,
        ground: data.terrain.heightAt(startX, startZ),
        level: shore <= .05 && surface > SEA_LEVEL + .15 ? surface : SEA_LEVEL,
        minY: route.minY, maxY: route.maxY,
      };
      const claim = claimFor(site, body);
      const gap = Math.min(2.2, Math.max(.18, Math.hypot(...body.half) * .45));
      if (claims.some(other => intersects(claim, other, gap))) continue;
      claims.push(claim);
      return site;
    }
  }
  return null;
}

export function createIslandFaunaPopulation({ data, colliders, catalog, sites, visits, routeAt, bodyPlacement }) {
  const population = [];
  const context = { data, terrain: data.terrain, field: data.field, colliders, routeAt };
  const bodies = new Map(Object.keys(sites).map(id => [id, bodyPlacement(catalog[id])]));
  const species = new Map(ISLAND_FAUNA_PLAN.map(spec => [spec.id, spec]));
  const claims = Object.values(sites).map(site => claimFor(site, bodies.get(site.id)));
  for (const visit of Object.values(visits)) claims.push(sightClaim(visit.eye, visit.gaze));
  for (const legacy of data.geography.animals) {
    const { x, z, sourceGround } = legacy;
    claims.push({ x, z, radius: legacy.id === 'apatosaurus' ? 26 : 15, low: sourceGround - 2, high: sourceGround + 12 });
  }
  for (const patch of ISLAND_FAUNA_POPULATION_PLAN) {
    for (const [id, count] of patch.species) {
      const source = species.get(id);
      if (!source) throw Error('Missing population species ' + id);
      const spec = { ...source, length: sites[id].length };
      const groupId = patch.id + '-' + id;
      const rng = mulberry32(hash(groupId));
      let focus = null;
      for (let i = 0; i < count; i++) {
        const site = solveIndividual(context, patch, spec, bodies.get(id), 'population-' + groupId + '-' + (i + 1),
          groupId, rng, claims, focus);
        if (!site) continue;
        population.push(site);
        // Stay near the first usable part of this habitat despite a nominal
        // patch centre on the far side of a creek, cliff, or dense stand.
        if (!focus) focus = [site.center[0], site.center[2]];
      }
    }
  }
  return population;
}
