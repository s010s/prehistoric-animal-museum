import { Quaternion, Sphere, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { islandAssetStats, islandMuseumModels, islandMuseumResidencyBudget, loadIslandMuseumModel } from '../museum/IslandMuseumModels.js';
import { FaunaResidency } from './FaunaResidency.js';
import { makeRoute, routePoint } from './IslandFaunaRoute.js';
import { faunaBodyPlacement, faunaMediumLimits } from './IslandFaunaHabitats.js';
import { faunaTorso, placeFaunaTorso } from './FaunaLandInteraction.js';
import { attachStreamedFaunaPipelines, markStreamedFaunaMaterials } from '../museum/StreamedFaunaPipelines.js';
import { clipCreekRefraction } from './CreekWater.js';

const SEA = -.7;
const up = new Vector3(0, 1, 0), lean = new Quaternion(), attitude = new Quaternion(), offset = new Vector3();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const signedAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const turn = (a, b, max) => a + clamp(signedAngle(b - a), -max, max);
const waterborne = medium => medium === 'marine' || medium === 'freshwater' || medium === 'benthic';

function motionClips(model, medium, behavior) {
  const names = model.clipNames();
  const match = re => names.find(name => re.test(name));
  const idle = match(/idle|rest|breathe|stand/i) ?? names[0];
  const movement = medium === 'ground' ? match(/walk|amble|forage|trot|stride|wade/i)
    : medium === 'air' ? match(/^fly$/i) ?? match(/fly|flap|flight|hover|soar|glide/i)
    : medium === 'benthic' ? match(/^crawl$/i) ?? match(/crawl|walk|scuttle/i)
    : match(/^swim$/i) ?? match(/swim|cruise|pulse|undulat/i);
  const activity = behavior === 'graze' || behavior === 'browse' || behavior === 'forage' ? match(/eat|feed|graze|browse|forage/i)
    : behavior === 'glide' || behavior === 'soar' ? match(/glide|soar/i) : null;
  return { idle, movement, activity, strideBase: match(/^StrideBase$/), hover: match(/^hover$/i) ?? match(/^feed$/i), alert: match(/alert|watch|look/i) };
}

function bodyBounds(metadata) {
  const bounds = metadata.animatedBounds ?? metadata.bounds;
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) * .5);
  const placement = faunaBodyPlacement(metadata);
  const forward = new Vector3(metadata.forward[0], 0, metadata.forward[1]).normalize();
  return { ...placement, center, forwardAxis: forward, rightAxis: new Vector3(forward.z, 0, -forward.x), scale: metadata.scale,
    sphere: new Sphere(new Vector3(...center), Math.hypot(...placement.half) * 1.12 / metadata.scale) };
}

function place(app, actor, point, dt, groundGait = 0, visitor = null) {
  const { model, body, site } = actor;
  const [x, defaultY, z, heading] = point;
  const onGround = site.medium === 'ground', benthic = site.medium === 'benthic';
  const currentYaw = actor.yaw ?? heading;
  const targetYaw = visitor && benthic
    ? Math.atan2(visitor.x - x, visitor.z - z) - body.forward : heading;
  const yaw = turn(currentYaw, targetYaw, dt * (onGround ? .6 * groundGait : 1.65));
  const fit = faunaMediumLimits(app.terrainData, app.creekData.field, site, body, x, z, yaw);
  if (!fit) return false;
  const air = site.medium === 'air';
  const clock = actor.time + actor.phase;
  const bob = onGround || benthic ? 0 : Math.sin(clock * (air ? 1.2 : .67)) * Math.min(.32, body.half[1] * .18);
  const boundsY = defaultY + bob;
  const articulationGuard = site.id === 'styxosaurus' ? .12 : site.id === 'quetzalcoatlus' ? .37 : 0;
  const half = body.half;
  const free = Math.max(0, Math.min(boundsY - fit.min, fit.max - boundsY) - articulationGuard);
  const maxLean = Math.min(air ? .27 : .12, free / Math.max(.1, half[0] + half[2]));
  const conform = dt ? 1 - Math.exp(-dt * 3) : 1;
  const yawRate = dt ? signedAngle(yaw - currentYaw) / dt : 0;
  const bank = mix(actor.bank ?? 0, clamp(-yawRate * (air ? .3 : .17), -maxLean, maxLean), conform);
  const pitch = mix(actor.pitch ?? 0, clamp(-Math.cos(clock * (air ? 1.2 : .67)) * (air ? .023 : .016), -maxLean, maxLean), conform);
  attitude.setFromAxisAngle(up, yaw);
  let margin = 0;
  if (!onGround && !benthic && site.id !== 'pteranodon') {
    attitude.multiply(lean.setFromAxisAngle(body.rightAxis, pitch)).multiply(lean.setFromAxisAngle(body.forwardAxis, bank));
    const { x: qx, y: qy, z: qz, w: qw } = attitude;
    margin = Math.max(0, Math.abs(2 * (qx*qy + qw*qz)) * half[0] + Math.abs(1 - 2 * (qx*qx + qz*qz)) * half[1]
      + Math.abs(2 * (qy*qz - qw*qx)) * half[2] - half[1]);
  }
  const guard = Math.min((fit.max - fit.min) / 2, margin + articulationGuard);
  const y = onGround || benthic ? fit.min : clamp(boundsY, fit.min + guard, fit.max - guard);
  offset.fromArray(body.center).multiplyScalar(body.scale).applyQuaternion(attitude);
  const rootX = x - offset.x, rootY = y - offset.y, rootZ = z - offset.z;
  if (!placeFaunaTorso(app, actor, rootX, rootY, rootZ, yaw + body.forward, dt > 0 && groundGait > 0)) return false;
  model.group.quaternion.copy(attitude);
  model.group.position.set(rootX, rootY, rootZ);
  actor.x = x; actor.y = y; actor.z = z; actor.yaw = yaw;
  actor.bank = bank; actor.pitch = pitch;
  actor.bottomClearance = y - half[1] - margin - fit.bottom;
  actor.surfaceClearance = fit.surface === undefined ? null : fit.surface - y - half[1] - margin;
  return true;
}

function prepareModelMaterials(app, actor, model) {
  model.group.name = `museum-island:${actor.id}`;
  model.group.scale.setScalar(actor.body.scale);
  markStreamedFaunaMaterials(model, actor.site.id);
  for (const mesh of model.meshes) {
    if (mesh.matrixAutoUpdate !== false) {
      mesh.geometry.boundingSphere = actor.body.sphere.clone();
      mesh.frustumCulled = true;
    }
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) clipCreekRefraction(mat, app.creekData.field);
  }
}

function attachModel(app, actor, model) {
  actor.model = model;
  actor.clips = motionClips(model, actor.site.medium, actor.site.behavior);
  actor.clip = null;
  if (!resetActor(app, actor)) throw Error(`Habitat cannot fit the animated body of ${actor.site.id}`);
  app.scene.add(model.group);
}

function resetActor(app, actor) {
  actor.distance = 0;
  actor.time = 0;
  actor.alert = 0;
  actor.yaw = undefined;
  actor.bank = actor.pitch = actor.headYaw = 0;
  actor.model.groundMotion?.reset(actor.phase);
  actor.model.setHeadYaw(0);
  actor.response = 'routine';
  // When a route is authored it begins at the observation gaze target.
  let fits = place(app, actor, routePoint(actor.route, 0), 0);
  if (!fits) fits = place(app, actor, [...actor.route.origin, actor.route.yaw], 0);
  if (!fits) return false;
  for (const mesh of actor.model.meshes) mesh.resetVelocity = true;
  return true;
}

function moveActor(app, actor, dt, camera) {
  const { site, body, route, model, clips } = actor;
  const { medium: m, behavior } = site;
  const group = model.group;
  const range = actor.range;
  const observerDistance = Math.hypot(camera.x - actor.x, camera.y - actor.y, camera.z - actor.z);
  const active = observerDistance < range + (actor.active ? 12 : 0);
  if (!active) {
    if (actor.active) model.hold();
    if (actor.collider) actor.collider.solid = false;
    actor.active = group.visible = false;
    return;
  }
  if (!actor.active) {
    for (const mesh of model.meshes) mesh.resetVelocity = true;
    model.update(0); model.hold();
  }
  actor.active = group.visible = true;
  actor.time += dt;
  const visitor = app.freeCam ? camera : app.player.position;
  const wet = waterborne(m);
  const wetVisitor = !app.freeCam ? !!app.player.wet : camera.y < (site.level ?? SEA) - .18;
  // The authored observation point already sits close to some tiny swimmers.
  // Treat arrival there as observation, and arm avoidance after an approach.
  const arrival = actor.arrival;
  const stayedAtArrival = arrival && arrival.distanceToSquared(camera) < Math.min(.55, Math.max(.15, Math.hypot(...body.half) * .3)) ** 2;
  if (!stayedAtArrival) actor.arrival = null;
  const near = !stayedAtArrival && (!wet || wetVisitor) && Math.hypot(visitor.x - actor.x, visitor.y - actor.y, visitor.z - actor.z)
    < Math.max(m === 'air' ? 7 : 1.3, Math.hypot(...body.half) * 1.45 + 1.1);
  actor.alert = near ? 2.2 : Math.max(0, actor.alert - dt);
  const alert = actor.alert > 0;
  const ground = m === 'ground', benthic = m === 'benthic';
  const clock = actor.time + actor.phase;
  const cycle = clock % (19 + actor.phase * .4);
  const quiet = behavior === 'rest' || behavior === 'ambush' || behavior === 'hover';
  const feeding = /graze|browse|forage/.test(behavior);
  const quietWindow = quiet ? 12 : feeding ? 5 : 1.6;
  // A guided view can briefly hold a land animal. A flier needs forward
  // motion even while the visitor is still at the viewing point.
  const arrivalHold = m !== 'air' && stayedAtArrival && actor.time < 4;
  const pause = arrivalHold || (ground && (alert || cycle < quietWindow)) || (benthic && alert)
    || (!ground && quiet && !alert && cycle < quietWindow);
  const moving = route.length > 0 && !pause && (!ground || !!model.groundMotion || !!clips.movement);
  const canWatch = ground && (clips.alert || model.headYawLimit);
  actor.response = alert ? ground ? canWatch ? 'watching-visitor' : 'holding-footing' : benthic ? 'holding-bed'
    : m === 'air' ? 'passing-overhead' : 'giving-swimmer-space' : moving ? behavior : 'resting';
  let clip = clips.idle;
  if (m === 'air') clip = clips.movement || clips.idle;
  else if (moving) clip = ground && model.groundMotion ? clips.strideBase || clips.idle : clips.movement || clips.idle;
  else if (!ground && !benthic) clip = clips.hover || clips.movement || clips.idle;
  else clip = (alert && clips.alert) || clips.activity || clips.idle;
  if (clip && clip !== actor.clip) {
    // Match the stroke across Swim/Hover. Changing cadence should not swap
    // a loaded fin for the opposite fin in the middle of its power stroke.
    const prior = wet ? model.layers.find(layer => layer.clip.name === actor.clip) : undefined;
    const period = model.clipDuration(clip) || 1;
    const from = prior?.clip.duration > 0 ? (prior.time / prior.clip.duration % 1) * period : actor.phase % period;
    const layer = model.play(clip, { loop: true, from, fade: actor.clip ? .28 : .07 });
    if (!actor.clip) layer.time = from;
    actor.clip = clip;
  }
  if (ground && model.headYawLimit) {
    const direction = Math.atan2(visitor.x - actor.x, visitor.z - actor.z);
    const heading = actor.yaw + body.forward;
    const limit = model.headYawLimit;
    const target = alert && !clips.alert ? clamp(signedAngle(direction - heading), -limit, limit) : 0;
    actor.headYaw = mix(actor.headYaw, target, 1 - Math.exp(-dt * 4.5));
    if (Math.abs(actor.headYaw) < .0001) actor.headYaw = 0;
    model.setHeadYaw(actor.headYaw);
  }
  const speed = site.speed ?? 0;
  const metresPerSecond = ground && model.groundMotion ? model.groundMotion.advance(dt, moving, speed)
    : moving ? speed * (alert && wet ? 1.32 : 1) : 0;
  const travelled = metresPerSecond * dt;
  const next = actor.distance + travelled;
  let accepted = 0;
  if (travelled || !ground || !actor.collider?.solid) {
    if (place(app, actor, routePoint(route, next), dt, ground && metresPerSecond > .001 ? 1 : 0, alert ? visitor : null)) {
      accepted = travelled;
      actor.distance = next;
    } else if (travelled) actor.response = 'holding-habitat-edge';
  }
  model.update(dt * (alert && wet && moving ? 1.32 : 1),
    ground ? { terrain: app.terrainData, behavior, alert, travelled: accepted } : undefined);
  for (const mesh of model.meshes) mesh.castShadow = !mesh.material.transparent && observerDistance < Math.min(120, range * .67);
}

export class IslandFauna {
  constructor(app, sites, population = []) {
    this.app = app;
    this.sites = sites;
    this.pipelines = attachStreamedFaunaPipelines(app.engine.meshRenderer, app.sceneRenderer.mainPassDefines);
    this.actors = new Map();
    this.individuals = new Map();
    this.residents = new Set();
    const bodies = new Map();
    this.residency = new FaunaResidency();
    this.lastScan = null;
    this.scanTime = 0;
    for (const site of [...Object.values(sites), ...population]) {
      const metadata = islandMuseumModels[site.id];
      if (!metadata) throw Error(`No native island model for ${site.id}`);
      if (!bodies.has(site.id)) bodies.set(site.id, bodyBounds(metadata));
      const body = bodies.get(site.id);
      const range = clamp(metadata.metres * 14 + (site.medium === 'air' ? 56 : 34), 36, 265);
      const torso = site.medium === 'ground' ? faunaTorso(site.id, metadata) : null;
      const id = site.actorId ?? site.id;
      const phase = site.activityPhase ?? [...id].reduce((n, char) => (n * 31 + char.charCodeAt(0)) % 1783, 0) / 100;
      const actor = { id, phase, site, metadata, body, range, torso, torsoCenter: torso && new Vector3(),
        route: makeRoute(site, body), model: null, active: false };
      this.individuals.set(id, actor);
      if (!site.population) this.actors.set(id, actor);
      const [x, y, z] = site.center ?? [site.x, site.y, site.z];
      this.residency.add({ ...site, ...islandMuseumResidencyBudget(metadata), id, x, y, z, radius: site.radius + Math.hypot(body.half[0], body.half[2]),
        minY: site.minY - body.half[1], maxY: site.maxY + body.half[1],
        range: range + 32,
        load: signal => loadIslandMuseumModel(site.id, { signal }),
        prepare: (model, signal) => {
          prepareModelMaterials(app, actor, model);
          return this.pipelines.prepareMain(model, signal);
        },
        attach: model => { attachModel(app, actor, model); this.residents.add(actor); moveActor(app, actor, 0, app.camera.position); },
        detach: model => {
          this.residents.delete(actor);
          app.dynamicMuseumShadows?.removeModel(model);
          if (actor.collider) app.colliders.removeBox(actor.collider);
          actor.collider = null;
          model.group.removeFromParent(); actor.model = null; actor.active = false;
        },
        dispose: model => model.dispose(),
      });
    }
  }

  scan(camera = this.app.camera.position, focus) {
    this.lastScan = new Vector3(camera.x, camera.y, camera.z);
    this.scanTime = 0;
    this.residency.scan(camera, focus);
  }

  observe(id) {
    const actor = this.actors.get(id);
    this.residency.retry(id);
    if (actor) actor.arrival = this.app.camera.position.clone();
    if (actor?.model) { resetActor(this.app, actor); moveActor(this.app, actor, 0, this.app.camera.position); }
    this.scan(this.app.camera.position, id);
  }

  update(dt, camera = this.app.camera) {
    if (this.residency.disposed) return;
    const step = clamp(dt, 0, .08);
    this.scanTime += step;
    if (!this.lastScan || this.scanTime >= .24 || this.lastScan.distanceToSquared(camera.position) > 144) this.scan(camera.position);
    for (const actor of this.residents) moveActor(this.app, actor, step, camera.position);
  }

  models() {
    return Array.from(this.residents, actor => actor.model);
  }

  state(id) {
    const status = this.residency.state(id);
    if (!status) return null;
    const actor = this.individuals.get(id);
    return { ...status, speciesId: actor?.site.id, group: actor?.site.groupId, region: actor?.site.regionId, medium: actor?.site.medium, active: actor?.active ?? status.status === 'resident',
      visible: !!actor?.model?.group.visible, disposition: actor?.model ? actor.response : null,
      position: actor?.model ? [actor.x, actor.y, actor.z] : null, clip: actor?.model ? actor.clip : null,
      heading: actor?.model ? actor.yaw + actor.body.forward : null, headYaw: actor?.model ? actor.headYaw : null,
      torsoCollider: actor?.collider?.solid ? { center: actor.collider.center.toArray(), half: actor.collider.half.toArray() } : null,
      clipSeconds: actor?.model?.layers?.find(layer => layer.clip.name === actor.clip)?.time ?? null,
      travelledMetres: actor?.model ? actor.distance : null,
      bottomClearance: actor?.model ? actor.bottomClearance : null, surfaceClearance: actor?.model ? actor.surfaceClearance : null };
  }

  stats() {
    const present = [...this.residents].filter(actor => actor.active);
    return { ...this.residency.stats(), museumSpecies: this.actors.size, plannedIndividuals: this.individuals.size,
      active: present.length, activeIndividuals: present.map(actor => this.state(actor.id)), assets: islandAssetStats(), pipelines: this.pipelines.stats(),
      species: [...this.actors.keys()].map(id => this.state(id)) };
  }

  hold() {
    for (const model of this.models()) {
      model.hold();
      for (const mesh of model.meshes) mesh.resetVelocity = true;
    }
  }

  dispose() {
    this.residency.dispose();
    this.pipelines.dispose();
  }
}
