import { readFaunaTarget, visitNearbyFauna } from './NearbyFaunaSources.js';

const NEARBY_RANGE = 320;
const FAR_REFRESH_DISTANCE = 48;
const SEA = -.7;
const targetSurfaces = new WeakMap();
const submerged = medium => medium === 'marine' || medium === 'freshwater' || medium === 'benthic';
const distanceTo = (visitor, target) => Math.hypot(target.x - visitor.x, target.y - visitor.y, target.z - visitor.z);

function candidateAt(target, distance) {
  // A moving body is a better encounter inside a size-dependent viewing
  // range. Beyond that range its distance competes with planned locations.
  const viewingRange = Math.min(160, Math.max(1.5, 2 + target.size * 12));
  return { target, distance, observable: target.live && distance <= viewingRange };
}

function betterCandidate(candidate, previous) {
  if (!previous) return true;
  const unavailable = candidate.target.availability === 'unavailable';
  const previousUnavailable = previous.target.availability === 'unavailable';
  if (unavailable !== previousUnavailable) return !unavailable;
  if (candidate.observable !== previous.observable) return candidate.observable;
  if (candidate.distance !== previous.distance) return candidate.distance < previous.distance;
  if (candidate.target.live !== previous.target.live) return candidate.target.live;
  if (candidate.target.museum !== previous.target.museum) return candidate.target.museum;
  return candidate.target.id < previous.target.id;
}

function waterSurfaceAt(app, x, z) {
  const [level, edge] = app.creekData.field.sample(x, z);
  return edge <= .05 && level > SEA + .15 ? level : SEA;
}

function surfacesAtTarget(app, target) {
  const { x, z, medium } = target;
  const previous = targetSurfaces.get(target);
  if (previous?.app === app && previous.x === x && previous.z === z && previous.medium === medium) return previous;
  const floor = app.terrainData.heightAt(x, z);
  const water = medium === 'air' || submerged(medium) ? waterSurfaceAt(app, x, z) : null;
  const result = { app, x, z, medium, floor, water };
  targetSurfaces.set(target, result);
  return result;
}

export function describeFaunaTarget(app, visitor, target) {
  if (!target) return null;
  const dx = target.x - visitor.x, dz = target.z - visitor.z;
  const relativeHeight = target.y - visitor.y;
  const horizontalDistance = Math.hypot(dx, dz);
  const slantDistance = Math.hypot(horizontalDistance, relativeHeight);
  const { floor, water } = surfacesAtTarget(app, target);
  const terrainClearance = target.y - floor;
  let height = null;
  if (submerged(target.medium)) {
    height = { type: 'depth', metres: Math.max(0, water - target.y), reference: 'water' };
  } else if (target.medium === 'air') {
    const reference = water > floor ? 'water' : 'ground';
    height = { type: 'altitude', metres: Math.max(0, target.y - Math.max(floor, water)), reference };
  }

  const { observation } = target;
  const observationDistance = observation ? distanceTo(visitor, observation) : null;
  const observationHorizontal = observation ? Math.hypot(visitor.x - observation.x, visitor.z - observation.z) : null;
  const observationVertical = observation ? observation.y - visitor.y : null;
  let atObservation = false;
  if (observation && observationHorizontal <= 3 && Math.abs(observationVertical) <= 1.35) {
    const visitorWater = waterSurfaceAt(app, visitor.x, visitor.z);
    if (observation.medium === 'water') atObservation = visitor.y < visitorWater - .05;
    else if (observation.medium === 'ground') {
      const visitorFloor = app.terrainData.heightAt(visitor.x, visitor.z);
      atObservation = visitor.y > visitorFloor && (visitorFloor > visitorWater - .05 || visitor.y > visitorWater);
    } else atObservation = true;
  }
  return { horizontalDistance, slantDistance, relativeHeight, terrainClearance, height,
    atObservation, observationDistance, observationHorizontal, observationVertical };
}

export class FaunaTracking {
  constructor(app) {
    this.app = app;
    this.locked = null;
  }

  directory(visitor = this.app.camera.position) {
    const closest = new Map();
    visitNearbyFauna(this.app, visitor, Infinity, target => {
      const item = candidateAt(target, distanceTo(visitor, target));
      if (betterCandidate(item, closest.get(target.speciesId))) closest.set(target.speciesId, item);
    }, { museumOnly: true, includeUnavailable: true });
    return [...closest.values()].sort((a, b) => a.distance - b.distance).map(({ target, distance }) => ({
      ...target, title: target.name, distance, horizontalDistance: Math.hypot(target.x - visitor.x, target.z - visitor.z),
    }));
  }

  lockSpecies(speciesId, visitor = this.app.camera.position) {
    let closest = null;
    visitNearbyFauna(this.app, visitor, Infinity, target => {
      const item = candidateAt(target, distanceTo(visitor, target));
      if (betterCandidate(item, closest)) closest = item;
    }, { museumOnly: true, includeUnavailable: true, speciesId });
    return closest ? this.remember(closest.target) : null;
  }

  lockIndividual(id) {
    const target = typeof id === 'string' && readFaunaTarget(this.app, id);
    return target ? this.remember(target) : null;
  }

  remember(target) {
    this.locked = { id: target.id, speciesId: target.speciesId, name: target.name };
    this.autoId = null;
    return target;
  }

  clearLock() {
    this.locked = null;
    this.autoId = null;
  }

  scan(visitor = this.app.camera.position, mode = 'museum') {
    const near = [];
    if (mode === 'off') return { target: null, near, lock: this.lockState() };

    let closest = null, previous = null, lockedTarget = null;
    if (this.lastMode !== mode) this.autoId = null;
    this.lastMode = mode;
    visitNearbyFauna(this.app, visitor, NEARBY_RANGE, target => {
      const distance = distanceTo(visitor, target);
      const labelRange = Math.min(34, Math.max(2.5, 2.2 + target.size * 3.5));
      if (target.live && target.visible && distance < labelRange) near.push(target);
      if (this.locked) {
        if (target.id === this.locked.id) lockedTarget = target;
        return;
      }
      if (distance > NEARBY_RANGE || (!target.museum && mode !== 'all')) return;
      const item = candidateAt(target, distance);
      if (betterCandidate(item, closest)) closest = item;
      if (target.id === this.autoId) previous = item;
    });

    if (this.locked) {
      // A lock follows the same individual across streaming and travel.
      const target = lockedTarget ?? readFaunaTarget(this.app, this.locked.id);
      return { target, near, lock: this.lockState(target) };
    }
    if (previous && previous.observable === closest.observable
        && previous.distance <= closest.distance + Math.min(1.5, closest.distance * .035)) closest = previous;
    const target = closest?.target ?? this.farTarget(visitor);
    this.autoId = target?.id;
    return { target, near, lock: null };
  }

  lockState(target = this.locked && readFaunaTarget(this.app, this.locked.id)) {
    return this.locked && { ...this.locked, state: target?.availability ?? 'unavailable' };
  }

  farTarget(visitor) {
    const cached = this.farId && readFaunaTarget(this.app, this.farId);
    if (cached && cached.availability !== 'unavailable' && distanceTo(visitor, this.farPosition) <= FAR_REFRESH_DISTANCE) return cached;
    let closest = null;
    visitNearbyFauna(this.app, visitor, Infinity, target => {
      const item = candidateAt(target, distanceTo(visitor, target));
      if (betterCandidate(item, closest)) closest = item;
    }, { museumOnly: true });
    this.farId = closest?.target.id;
    this.farPosition = { x: visitor.x, y: visitor.y, z: visitor.z };
    return closest?.target ?? null;
  }
}
