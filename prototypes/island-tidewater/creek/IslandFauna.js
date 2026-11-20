import { Sphere, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { islandMuseumModels, loadIslandMuseumModel } from '../museum/IslandMuseumModels.js';
import { FaunaResidency } from './FaunaResidency.js';
import { faunaBodyPlacement, faunaMediumLimits } from './IslandFaunaHabitats.js';
import { faunaTorso, placeFaunaTorso } from './FaunaLandInteraction.js';
import { attachStreamedFaunaPipelines, markStreamedFaunaMaterials } from '../museum/StreamedFaunaPipelines.js';
import { clipCreekRefraction } from './CreekWater.js';

const TAU = 2 * Math.PI;
const SEA = -.7;
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
    : medium === 'air' ? match(/fly|flap|flight|hover|soar|glide/i)
    : medium === 'benthic' ? match(/crawl|walk|scuttle/i)
    : match(/swim|cruise|pulse|undulat/i);
  const activity = behavior === 'graze' || behavior === 'browse' || behavior === 'forage' ? match(/eat|feed|graze|browse|forage/i)
    : behavior === 'glide' || behavior === 'soar' ? match(/glide|soar/i) : null;
  return { idle, movement, activity, alert: match(/alert|watch|look/i) };
}

function makeRoute(site, body) {
  const origin = site.path?.[0] ?? [site.x, site.y, site.z];
  const radius = site.radius ?? 0;
  // Habitat placement can supply a checked loop. The fallback starts on the
  // habitat anchor so the animal lines up with the authored observation view.
  const points = site.path?.length > 1 ? site.path : radius > .05 ? Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * TAU;
    return [origin[0] + (Math.cos(a) - 1) * radius * .45, origin[1], origin[2] + Math.sin(a) * radius * .39];
  }) : [origin];
  const segments = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const size = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (size < .0001) continue;
    segments.push({ a, b, start: length, size, yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) - body.forward });
    length += size;
  }
  return { origin, segments, length, yaw: (site.yaw ?? 0) - body.forward };
}

function routePoint(route, distance) {
  if (!route.length) return [...route.origin, route.yaw];
  const s = distance % route.length;
  const segment = route.segments.find(a => s < a.start + a.size) ?? route.segments.at(-1);
  const t = (s - segment.start) / segment.size;
  return [...segment.a.map((v, i) => mix(v, segment.b[i], t)), segment.yaw];
}

function bodyBounds(metadata) {
  const bounds = metadata.animatedBounds ?? metadata.bounds;
  const center = bounds.min.map((v, i) => (v + bounds.max[i]) * .5);
  const placement = faunaBodyPlacement(metadata);
  return { ...placement, center, scale: metadata.scale,
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
  const bob = onGround || benthic ? 0 : Math.sin(actor.time * (site.medium === 'air' ? 1.2 : .67)) * Math.min(.42, body.half[1] * .22);
  const y = onGround || benthic ? fit.min : clamp(defaultY + bob, fit.min, fit.max);
  const [cx, cy, cz] = body.center, c = Math.cos(yaw), s = Math.sin(yaw);
  const rootX = x - body.scale * (cx * c + cz * s), rootY = y - body.scale * cy, rootZ = z - body.scale * (-cx * s + cz * c);
  if (!placeFaunaTorso(app, actor, rootX, rootY, rootZ, yaw + body.forward, dt > 0 && groundGait > 0)) return false;
  model.group.rotation.y = yaw;
  model.group.position.set(rootX, rootY, rootZ);
  actor.x = x; actor.y = y; actor.z = z; actor.yaw = yaw;
  actor.bottomClearance = y - body.half[1] - fit.bottom;
  actor.surfaceClearance = fit.surface === undefined ? null : fit.surface - y - body.half[1];
  return true;
}

function prepareModelMaterials(app, actor, model) {
  model.group.name = `museum-island:${actor.site.id}`;
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
  actor.headYaw = 0;
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
  const resting = behavior === 'rest' || behavior === 'ambush' || behavior === 'hover';
  const arrivalHold = stayedAtArrival && actor.time < 4;
  const pause = arrivalHold || ground && (alert || resting || actor.time % 18 < 5) || benthic && alert;
  // A land translation needs a source or authored gait. An idle exhibit can
  // use an authored alert pose or a proven neck branch while feet stay put.
  const moving = route.length > 0 && !pause && (!ground || !!clips.movement) && (!resting || alert);
  const canWatch = ground && (clips.alert || model.headYawLimit);
  const groundResponse = canWatch ? 'watching-visitor' : clips.movement ? 'yielding-to-visitor' : 'holding-footing';
  actor.response = alert ? ground ? groundResponse : benthic ? 'holding-bed' : m === 'air' ? 'passing-overhead' : 'giving-swimmer-space'
    : moving ? behavior : 'resting';
  const clip = (alert && clips.alert) || (moving && clips.movement)
    || (!alert && clips.activity) || clips.idle;
  if (clip && clip !== actor.clip) {
    model.play(clip, { loop: true, speed: 1, fade: actor.clip ? .28 : 0 });
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
  model.update(dt * (alert && wet && moving ? 1.32 : 1));
  const groundGait = ground && moving ? (model.layers.find(layer => layer.clip.name === clips.movement && layer.target > 0)?.weight ?? 0) : 0;
  const moveScale = ground ? groundGait : alert ? (m === 'air' ? 1.12 : 1.45) : 1;
  const next = actor.distance + (moving ? (site.speed ?? 0) * moveScale * dt : 0);
  if (place(app, actor, routePoint(route, next), dt, groundGait, alert ? visitor : null)) actor.distance = next;
  else if (moving) actor.response = 'holding-habitat-edge';
  for (const mesh of model.meshes) mesh.castShadow = !mesh.material.transparent && observerDistance < Math.min(120, range * .67);
}

export class IslandFauna {
  constructor(app, sites) {
    this.app = app;
    this.sites = sites;
    this.pipelines = attachStreamedFaunaPipelines(app.engine.meshRenderer);
    this.actors = new Map();
    this.residency = new FaunaResidency();
    this.lastScan = null;
    this.scanTime = 0;
    for (const site of Object.values(sites)) {
      const metadata = islandMuseumModels[site.id];
      if (!metadata) throw Error(`No native island model for ${site.id}`);
      const body = bodyBounds(metadata);
      const range = clamp(metadata.metres * 14 + (site.medium === 'air' ? 56 : 34), 36, 265);
      const torso = site.medium === 'ground' ? faunaTorso(site.id, metadata) : null;
      const actor = { site, metadata, body, range, torso, torsoCenter: torso && new Vector3(),
        route: makeRoute(site, body), model: null, active: false };
      this.actors.set(site.id, actor);
      const [x, y, z] = site.center ?? [site.x, site.y, site.z];
      this.residency.add({ ...site, x, y, z, radius: site.radius + Math.hypot(body.half[0], body.half[2]),
        minY: site.minY - body.half[1], maxY: site.maxY + body.half[1],
        range: range + 32, bytes: metadata.gpuBytes,
        load: signal => loadIslandMuseumModel(site.id, { signal }),
        prepare: (model, signal) => {
          prepareModelMaterials(app, actor, model);
          return this.pipelines.prepareMain(model, signal);
        },
        attach: model => { attachModel(app, actor, model); moveActor(app, actor, 0, app.camera.position); },
        detach: model => {
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
    for (const actor of this.actors.values()) if (actor.model) moveActor(this.app, actor, step, camera.position);
  }

  models() {
    return [...this.actors.values()].flatMap(actor => actor.model ? [actor.model] : []);
  }

  state(id) {
    const status = this.residency.state(id);
    if (!status) return null;
    const actor = this.actors.get(id);
    return { ...status, region: actor?.site.regionId, medium: actor?.site.medium, active: actor?.active ?? status.status === 'resident',
      visible: !!actor?.model?.group.visible, disposition: actor?.model ? actor.response : null,
      position: actor?.model ? [actor.x, actor.y, actor.z] : null, clip: actor?.model ? actor.clip : null,
      heading: actor?.model ? actor.yaw + actor.body.forward : null, headYaw: actor?.model ? actor.headYaw : null,
      torsoCollider: actor?.collider?.solid ? { center: actor.collider.center.toArray(), half: actor.collider.half.toArray() } : null,
      clipSeconds: actor?.model?.layers?.find(layer => layer.clip.name === actor.clip)?.time ?? null,
      travelledMetres: actor?.model ? actor.distance : null,
      bottomClearance: actor?.model ? actor.bottomClearance : null, surfaceClearance: actor?.model ? actor.surfaceClearance : null };
  }

  stats() {
    return { ...this.residency.stats(), museumSpecies: this.actors.size,
      active: [...this.actors.values()].filter(a => a.active).length, pipelines: this.pipelines.stats(),
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
