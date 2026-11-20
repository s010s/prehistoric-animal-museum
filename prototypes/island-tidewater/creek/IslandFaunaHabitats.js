import { ISLAND_FAUNA_PLAN, ISLAND_FAUNA_REGIONS } from './IslandFaunaPlan.js';
import { createIslandFaunaPopulation } from './IslandFaunaPopulation.js';
import { sunDirectionFromTime } from '../vendor/tidewater/src/sky/Sky.js';
import { islandFlightBounds } from '../museum/IslandFlightBounds.js';
import aquaticBounds from '../museum/aquatic-motion/animated-bounds.json' with { type: 'json' };

const SEA_LEVEL = -.7;
const INLAND_MARGIN = .15;
const WALK_EYE = 1.62;
const SWIM_CLEARANCE = .48;
const TAU = 2 * Math.PI;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const submerged = medium => ['marine', 'freshwater', 'benthic'].includes(medium);
const nearbyAngles = Array.from({ length: 16 }, (_, i) => i * TAU / 16);
const flightViews = {
  meganeura: { distance: 1.95, maxDistance: 3.1, sky: true, altitude: 3.05, incline: .92, sunSide: .12 },
  anurognathus: { distance: 1.7, sky: true, altitude: 2.55, incline: .92 },
  sordes: { distance: 1.9, sky: true, altitude: 2.75, incline: .92 },
  archaeopteryx: { distance: 1.95, sky: true, altitude: 3, incline: 1.08 },
  rhamphorhynchus: { distance: 3.8, maxDistance: 5.6, sky: true, altitude: 3.35, incline: .62 },
  tupandactylus: { distance: 6.2, maxDistance: 9.3, altitude: 3.8 },
};

function waterAt(field, x, z) {
  const [level, edge] = field.sample(x, z);
  const inland = edge <= .05 && level > SEA_LEVEL + INLAND_MARGIN;
  return { level: inland ? level : SEA_LEVEL, inland };
}

// Placement and live movement use the same animated body footprint. A
// camera-facing turn also passes through this check before playing out.
export function faunaMediumLimits(terrain, field, site, body, x, z, yaw) {
  const wet = submerged(site.medium);
  const fresh = site.medium === 'freshwater';
  const benthic = site.medium === 'benthic';
  const air = site.medium === 'air';
  const [hx, hy, hz] = body.half;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const worldEdge = terrain.size / 2 - 48;
  const dryClearance = site.behavior === 'wade' ? -.42 : .08;
  let bed = -Infinity;
  let surface = Infinity;
  for (const dx of [-hx, 0, hx]) for (const dz of [-hz, 0, hz]) {
    const px = x + c * dx + s * dz;
    const pz = z - s * dx + c * dz;
    if (Math.max(Math.abs(px), Math.abs(pz)) > worldEdge) return null;
    const ground = terrain.heightAt(px, pz);
    bed = Math.max(bed, ground);
    if (air) continue;
    const w = waterAt(field, px, pz);
    if (wet && w.inland !== fresh) return null;
    if (!wet && ground < w.level + dryClearance) return null;
    surface = Math.min(surface, w.level);
  }
  if (wet) {
    const tideGuard = Math.min(.52, .12 + hy * .23);
    const bottom = bed + (benthic ? .015 : .08);
    const min = bottom + hy;
    const max = surface - hy - (fresh ? .12 : tideGuard);
    return min <= max ? { min, max, bottom, surface } : null;
  }
  const min = air ? bed + hy + 1.3 : terrain.heightAt(x, z) - body.floor;
  return { min, max: Infinity, bottom: bed };
}

export function faunaBodyPlacement(metadata) {
  const bounds = metadata.animatedBounds ?? metadata.bounds;
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) * .5);
  const motion = islandFlightBounds[metadata.id] ?? aquaticBounds[metadata.id] ?? bounds;
  return {
    // The model origin stays on the authored route while fins and wings
    // gain the clearance they require on either side of its original center.
    half: center.map((c, i) => Math.max(Math.max(bounds.max[i], motion.max[i]) - c,
      c - Math.min(bounds.min[i], motion.min[i])) * metadata.scale),
    floor: (metadata.bounds.min[1] - center[1]) * metadata.scale,
    forward: Math.atan2(metadata.forward[0], metadata.forward[1]),
  };
}

function treeHeightAt(colliders, x, z, padding, crown = false) {
  if (!colliders) return -Infinity;
  let top = -Infinity;
  const cellX = Math.floor(x / 32);
  const cellZ = Math.floor(z / 32);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const trees = colliders.treeCells.get((cellX + i) + ',' + (cellZ + j)) ?? [];
    for (const tree of trees) {
      const canopy = crown && tree.tag.endsWith('trunk') ? Math.min(9, (tree.yMax - tree.yMin) * .097) : 0;
      if (Math.hypot(x - tree.x, z - tree.z) < tree.radius + padding + canopy) top = Math.max(top, tree.yMax);
    }
  }
  return top;
}

function gradeAt(terrain, x, z, w = 1.35) {
  return Math.hypot(terrain.heightAt(x + w, z) - terrain.heightAt(x - w, z),
    terrain.heightAt(x, z + w) - terrain.heightAt(x, z - w)) / (2 * w);
}

function preferredAltitude(site, body) {
  const closeFlight = flightViews[site.id]?.altitude;
  if (closeFlight !== undefined) return closeFlight;
  if (site.id === 'pteranodon') return 6.5;
  if (site.id === 'quetzalcoatlus') return 11;
  return clamp(body.half[0] * 2.5, 1.7, 7);
}

function routeAt(context, site, body, x, z, radius, axis, population = null) {
  const { terrain, field, colliders } = context;
  const ground = site.medium === 'ground';
  const air = site.medium === 'air';
  const benthic = site.medium === 'benthic';
  const c = Math.cos(axis);
  const s = Math.sin(axis);
  const steps = radius ? 32 : 1;
  const points = Array.from({ length: steps }, (_, i) => {
    const a = i * TAU / steps + (population?.phase ?? 0);
    const u = radius * Math.cos(a);
    const v = population ? radius * (population.aspect * Math.sin(a) + .11 * Math.sin(a * 2 + population.phase))
      : radius * .77 * Math.sin(a);
    return [x + u * c - v * s, z + v * c + u * s];
  });
  const path = [];
  let minY = -Infinity;
  let maxY = Infinity;
  for (const [i, [px, pz]] of points.entries()) {
    const [qx, qz] = points[(i + 1) % steps];
    const yaw = radius ? Math.atan2(qx - px, qz - pz) : axis + .9;
    // Check segment interiors too since runtime moves between the stored
    // points and the underlying bathymetry may turn within a segment.
    for (const t of radius ? [0, .5] : [0]) {
      const sx = px + (qx - px) * t;
      const sz = pz + (qz - pz) * t;
      const fit = faunaMediumLimits(terrain, field, site, body, sx, sz, yaw - body.forward);
      if (!fit) return null;
      const h = terrain.heightAt(sx, sz);
      if (ground && gradeAt(terrain, sx, sz) > .42) return null;
      const treeTop = !population && (ground || air) ? treeHeightAt(colliders, sx, sz, Math.hypot(body.half[0], body.half[2])) : -Infinity;
      if (ground && treeTop > h) return null;
      const min = air ? Math.max(fit.min, treeTop + body.half[1] + .7) : fit.min;
      minY = Math.max(minY, min);
      maxY = Math.min(maxY, fit.max);
      if (!t) path.push([px, ground || benthic ? h : min, pz]);
    }
  }

  if (ground || benthic) return { path, minY: Math.min(...path.map(p => p[1])), maxY: Math.max(...path.map(p => p[1])) };
  if (minY > maxY) return null;
  if (air) {
    const floor = terrain.heightAt(x, z);
    const takeoff = population ? Math.max(floor, waterAt(field, x, z).level) : floor;
    const altitude = preferredAltitude(site, body) * (population?.altitude ?? 1);
    if (population && minY > takeoff + altitude * 1.55) return null;
    const base = Math.max(minY, takeoff + altitude);
    const lift = .3 + Math.min(1.3, radius * .025);
    for (let i = 0; i < steps; i++) path[i][1] = base + lift * (1 + Math.sin(i * TAU / steps));
    return { path, minY, maxY: base + 2 * lift };
  }
  const isNearBed = site.behavior === 'hover';
  const fraction = isNearBed ? .22 : site.behavior === 'ambush' ? .66 : .68;
  const y = minY + (maxY - minY) * fraction;
  const rise = Math.min(isNearBed ? .045 : .55, (maxY - y) * .7);
  for (let i = 0; i < steps; i++) path[i][1] = y + Math.sin(i * TAU / steps) * rise;
  return { path, minY, maxY };
}

function clearSight(terrain, colliders, p, gaze) {
  const last = Math.hypot(gaze[0] - p[0], gaze[2] - p[2]);
  const segments = clamp(Math.ceil(last * 2), 6, 96);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const x = p[0] + (gaze[0] - p[0]) * t;
    const y = p[1] + (gaze[1] - p[1]) * t;
    const z = p[2] + (gaze[2] - p[2]) * t;
    if (Math.max(terrain.heightAt(x, z), treeHeightAt(colliders, x, z, .1)) >= y) return false;
  }
  return true;
}

function openFlightBackdrop(terrain, colliders, gaze, dx, dz, incline) {
  const skySlope = incline - .075;
  for (const d of [1.5, 3, 5, 8, 11, 14, 18, 22, 27, 32, 38, 45, 53, 62, 73, 85, 100, 120, 146, 180, 222, 280, 365, 480, 660, 920]) {
    const x = gaze[0] - dx * d;
    const z = gaze[2] - dz * d;
    const y = gaze[1] + skySlope * d - .35;
    const margin = Math.min(5.8, .9 + d * .065);
    // The projected body needs a little sky around it. Test the lower
    // and outer edges of that window through the local crowns and ridge.
    if (d <= 120 && treeHeightAt(colliders, x, z, margin, true) > y) return false;
    const left = terrain.heightAt(x - dz * margin, z + dx * margin);
    const right = terrain.heightAt(x + dz * margin, z - dx * margin);
    if (Math.max(terrain.heightAt(x, z), left, right) > y) return false;
  }
  return true;
}

function observationFor(context, site, body, path) {
  const { terrain, field, colliders } = context;
  const wet = submerged(site.medium);
  const air = site.medium === 'air';
  const ground = site.medium === 'ground';
  const benthic = site.medium === 'benthic';
  const length = site.length;
  const flight = flightViews[site.id];
  const mammoth = site.id === 'mammoth';
  const sunSideMin = mammoth ? .42 : flight?.sunSide;
  const daylight = sunSideMin === undefined ? null : sunDirectionFromTime(site.time);
  const view = flight?.distance ?? (wet
    ? clamp(length * 1.12, .37, 19)
    : air ? clamp(length * 2.1, 2.25, 37) : clamp(length * 1.13, 2.4, 29));
  const range = air ? [1, 1.7, .75, 2.6, 3.8] : [1, 1.2, .82, 1.55, .68];
  if (site.medium === 'freshwater') range.push(.48, .32);
  const lookHeight = ground ? Math.max(.16, -body.floor * 1.15) : benthic ? Math.max(.02, body.half[1] + .015) : 0;
  let best = null;
  for (let i = 0; i < path.length; i += Math.max(1, path.length / 8)) {
    const [x, y, z] = path[i];
    const [qx, , qz] = path[(i + 1) % path.length];
    const heading = path.length === 1 ? 0 : Math.atan2(qx - x, qz - z);
    const gaze = [x, y + lookHeight, z];
    for (const factor of range) for (const angle of nearbyAngles) {
      const distance = factor * view;
      if (distance > (flight?.maxDistance ?? Infinity)) continue;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const px = x + dx * distance;
      const pz = z + dz * distance;
      const floor = terrain.heightAt(px, pz);
      const { level, inland } = waterAt(field, px, pz);
      let py = floor + WALK_EYE;
      if (wet) {
        if (inland !== (site.medium === 'freshwater') || level - floor < 1.18) continue;
        py = clamp(gaze[1] + (benthic ? .42 : .12), floor + SWIM_CLEARANCE, level - (inland ? .26 : .52));
        if (py - floor < SWIM_CLEARANCE - .01) continue;
      } else if (floor < level + .12 || gradeAt(terrain, px, pz, .7) > .52) continue;

      if (treeHeightAt(colliders, px, pz, .66) > floor) continue;
      const viewIncline = (gaze[1] - py) / distance;
      if (flight?.sky && viewIncline < flight.incline * .62) continue;
      const sunSide = daylight ? (daylight.x * dx + daylight.z * dz) / Math.hypot(daylight.x, daylight.z) : 1;
      if (daylight && sunSide < sunSideMin) continue;
      const lightPenalty = mammoth ? (1 - sunSide) * 1.25 : daylight ? Math.abs(sunSide - .52) * .85 : 0;
      if (air && (viewIncline > (flight?.sky ? 2.05 : 1.7) || viewIncline < -.12)) continue;
      if (!wet && !air && viewIncline < -.57) continue;
      const oblique = Math.abs(dx * Math.sin(heading) + dz * Math.cos(heading));
      if (flight?.sky && (oblique < .20 || oblique > .72)) continue;
      const score = Math.abs(factor - 1) * 4 + Math.abs(oblique - (flight?.sky ? .39 : .35)) * (flight?.sky ? 3 : .95)
        + (air ? Math.abs(viewIncline - (flight?.incline ?? .14)) * 1.25 : 0)
        + lightPenalty + i * .005;
      if (best && score >= best.score) continue;
      if (flight?.sky && !openFlightBackdrop(terrain, colliders, gaze, dx, dz, viewIncline)) continue;
      if (!clearSight(terrain, colliders, [px, py, pz], gaze)) continue;
      best = { score, p: [px, pz], eye: [px, py, pz], gaze, i, heading,
        ...(wet ? { diveLevel: level, eyeBelowSurface: level - py } : {}) };
    }
  }
  return best;
}

function solveHabitat(context, spec, metadata, time) {
  const wet = submerged(spec.medium);
  const length = metadata.metric === 'shoulder-height' || metadata.metric === 'standing-height'
    ? spec.length * 1.6 : metadata.metres ?? spec.length;
  const site = { ...spec, length, time };
  const body = faunaBodyPlacement(metadata);
  const [cx, cz] = site.preferred;
  const step = wet ? Math.max(2, site.radius * .65) : Math.max(4, site.radius * .52);
  const offsets = [[0, 0]];
  const searchRings = flightViews[site.id]?.sky ? [1, 2, 3, 4, 6, 9, 13] : [1, 2, 3, 4, 6];
  for (const r of searchRings) for (const a of nearbyAngles) offsets.push([Math.cos(a) * step * r, Math.sin(a) * step * r]);
  // Preserve travel distance first. A shorter route near the intended site is
  // still preferable to snapping an animal into a different part of the island.
  const radii = site.radius ? [.99, .74, .49, .28].map(f => f * site.radius) : [0];
  if (site.behavior === 'ambush') radii.push(0);
  for (const radius of radii) for (const [dx, dz] of offsets) {
    const x = cx + dx;
    const z = cz + dz;
    for (const axis of [0, Math.PI / 2]) {
      const route = routeAt(context, site, body, x, z, radius, axis);
      if (!route) continue;
      const view = observationFor(context, site, body, route.path);
      if (!view) continue;
      const path = [...route.path.slice(view.i), ...route.path.slice(0, view.i)];
      const [startX, startY, startZ] = path[0];
      const ground = context.terrain.heightAt(startX, startZ);
      const { level } = waterAt(context.field, startX, startZ);
      return {
        site: { ...site, x: startX, y: startY, z: startZ, yaw: route.path.length === 1 ? axis + .9 : view.heading,
          radius, path, center: [x, (route.minY + route.maxY) * .5, z], ground, level,
          minY: route.minY, maxY: route.maxY, eyeHeight: view.gaze[1] - startY },
        visit: { id: site.visitId, animalId: site.id, regionId: site.regionId, title: site.title,
          englishName: site.englishName, era: site.era, medium: site.medium, note: site.note,
          p: view.p, gaze: view.gaze, eye: view.eye,
          ...(view.diveLevel === undefined ? {} : { diveLevel: view.diveLevel, eyeBelowSurface: view.eyeBelowSurface }) },
      };
    }
  }
  return null;
}

export function createIslandFaunaHabitats(data, catalog, { colliders = null } = {}) {
  const started = performance.now();
  const context = { terrain: data.terrain, field: data.field, colliders };
  const sites = {};
  const visits = {};
  const regions = ISLAND_FAUNA_REGIONS;
  const times = new Map(regions.map(r => [r.id, r.time]));
  const unavailable = [];
  for (const spec of ISLAND_FAUNA_PLAN) {
    const metadata = catalog[spec.id];
    if (!metadata) throw Error('Missing island catalog entry ' + spec.id);
    const match = solveHabitat(context, spec, metadata, times.get(spec.regionId));
    if (!match) {
      unavailable.push(spec.id);
      continue;
    }
    sites[spec.id] = match.site;
    visits[spec.visitId] = { ...match.visit, time: times.get(spec.regionId) };
  }
  if (unavailable.length) throw Error('No suitable habitat for: ' + unavailable.join(', '));
  const population = createIslandFaunaPopulation({
    data, colliders, catalog, sites, visits, routeAt, bodyPlacement: faunaBodyPlacement,
  });
  return { sites, visits, regions, population, elapsedMs: performance.now() - started };
}
