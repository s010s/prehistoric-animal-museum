// A small representative cast from the museum's 36-animal mainCollection.
// Source and Blender-authored actions feed the same native WebGPU skinning.
import { Group, Vector3, Sphere } from '../vendor/tidewater/src/engine/index.js';
import { mergeMuseumSkins } from '../museum/NativeMuseumSkin.js';
import { prepareMuseumMotion, museumMotionEnvelope, sampleIchthyosaurEnvelope } from '../museum/AnimalMotionPolish.js';
import { createMuseumGroundMotion } from '../museum/MuseumGroundMotion.js';
import { prepareIslandAquaticMotion } from '../museum/IslandAquaticMotion.js';
import { museumMaterialOptions } from '../museum/animals.js';
import { findMuseumGround, museumGroundSupport, museumTrunkClear, seatMuseumModel, museumGroundVisit, museumXZ } from '../museum/MuseumGrounding.js';
import { markStreamedFaunaMaterials } from '../museum/StreamedFaunaPipelines.js';
import { createSampleSkinnedModel, disposeSampleModel, loadSampleGLB, removeSampleCollider } from '../museum/SampleModelResources.js';
import { setPteranodonReview } from '../museum/PteranodonReview.js';
import { clipCreekRefraction } from './CreekWater.js';
import lystro from '../museum/assets/sample-lystrosaurus.json';
import paras from '../museum/assets/sample-parasaurolophus.json';
import ptera from '../museum/assets/sample-pteranodon.json';
import ichthy from '../museum/assets/sample-ichthyosaur.json';

const source = [
  { data: lystro, costMiB: 8, title: '水龙兽', habitat: 'land', range: 62, url: new URL('../museum/assets/sample-lystrosaurus.glb', import.meta.url).href },
  { data: paras, costMiB: 7, title: '副栉龙', habitat: 'land', range: 210, url: new URL('../museum/assets/sample-parasaurolophus.glb', import.meta.url).href },
  { data: ptera, costMiB: 25, title: '无齿翼龙', habitat: 'air', range: 340, url: new URL('../museum/assets/sample-pteranodon.glb', import.meta.url).href },
  { data: ichthy, costMiB: 68, title: '鱼龙', habitat: 'marine', range: 100, url: new URL('../museum/assets/sample-ichthyosaur.glb', import.meta.url).href },
];
const sea = -.7, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const marineRadii = [20, 10], marineBob = .025, marineBank = .018;
const yawFor = (data, dx, dz) => Math.atan2(dx, dz) - Math.atan2(data.forward[0], data.forward[1]);
const envelope = data => data.motionEnvelope ?? ({ min: [0, 1, 2].map(k => Math.min(...data.animationEnvelope.clips.map(c => c.min[k]))), max: [0, 1, 2].map(k => Math.max(...data.animationEnvelope.clips.map(c => c.max[k]))) });
function plainSite(site) {
  return { x: site.x, y: site.y, z: site.z, yaw: site.yaw, slope: site.slope, residual: site.residual, groundClearance: site.clear, waterEdge: site.edge };
}
function dryEntry(app, preferred) {
  let best = null;
  for (let r = 0; r <= 30; r += 2) for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12, x = preferred[0] + Math.cos(a) * r, z = preferred[1] + Math.sin(a) * r;
    const y = app.terrainData.heightAt(x, z), f = app.creekData.field.sample(x, z);
    const slope = Math.hypot(app.terrainData.heightAt(x + .5, z) - app.terrainData.heightAt(x - .5, z), app.terrainData.heightAt(x, z + .5) - app.terrainData.heightAt(x, z - .5));
    if (y < f[0] + .15 || slope > .38 || (app.vegetation?.records ?? []).some(t => Math.hypot(t.x - x, t.z - z) < 1.5)) continue;
    const score = r + slope * 5;
    if (!best || score < best.score) best = { p: [x, z], y, slope, score };
  }
  if (!best) throw Error('No dry sample museum-life entry');
  return best;
}

function lystroRoute(app, start, supportHalf, contactCenter) {
  const { yaw } = start, dir = [Math.sin(yaw), Math.cos(yaw)];
  const points = [[start.x, start.y, start.z]];
  const length = .49, spacing = .07;
  for (let distance = spacing; distance <= length + .00001; distance += spacing) {
    const x = start.x + dir[0] * distance, z = start.z + dir[1] * distance;
    const site = museumGroundSupport(app.terrainData, app.creekData.field, x, z, yaw, supportHalf);
    if (site.clear < .22 || site.edge < .3 || site.slope > .15 || site.residual > .028 ||
        !museumTrunkClear(app, site, lystro, contactCenter, .65)) break;
    points.push([site.x, site.y, site.z]);
  }
  return { yaw, dir, supportHalf, points, length: (points.length - 1) * spacing, speed: .18 };
}

function parasRoute(app) {
  const data = paras, center = [-774, 72], dir = [-.29552020666133955, .955336489125606], length = 12;
  const yaw = yawFor(data, ...dir), contactCenter = [-1.88, .004], supportHalf = [.58, .68];
  const points = [], supports = [];
  for (let s = -length / 2; s <= length / 2 + .0001; s += .5) {
    const x = center[0] + dir[0] * s, z = center[1] + dir[1] * s;
    const site = museumGroundSupport(app.terrainData, app.creekData.field, x, z, yaw, supportHalf);
    if (site.clear < .12 || site.edge < .1 || site.slope > .14 || site.residual > .055 || !museumTrunkClear(app, site, data, contactCenter, .7)) throw Error('Parasaurolophus dry patrol no longer clears water, support or trunks');
    points.push([x, site.y, z]); supports.push(site);
  }
  return { center, dir, length, yaw, contactCenter, supportHalf, supports, points, speed: .50, sourceStanceVelocity: .1800,
    trackPath: { start: points[0], end: points.at(-1), points, stepMetres: 1.08, traceStepMetres: 1.08, footLengthMetres: .54,
      halfTrackMetres: .34, bankOffsetMetres: -.9, correspondence: 'older normal walking pass; the current foraging gait keeps separate live foot contacts' } };
}

function findMarineRoute(app, data) {
  const env = envelope(data), [rx, rz] = marineRadii;
  // In this rig the nose is -X. Bank about X and pitch about Z, keeping the
  // complete swim pose between the reef and the local wave troughs.
  const ex = Math.max(Math.abs(env.min[0]), Math.abs(env.max[0]));
  const ez = Math.max(Math.abs(env.min[2]), Math.abs(env.max[2]));
  const pitch = Math.atan2(2 * marineBob, Math.min(rx, rz));
  const verticalTilt = ez * Math.sin(marineBank) + ex * Math.sin(pitch);
  const minY = (env.min[1] - verticalTilt) * data.scale;
  const maxY = (env.max[1] + verticalTilt) * data.scale;
  const hx = ex * data.scale + .12, hz = ez * data.scale + .12;
  const reefs = [...(app.creekData.sampleBenthicDetails?.coralSites ?? []), ...(app.creekData.sampleBenthicDetails?.spongeSites ?? [])];
  const rocks = app.coveRocks?.instances ?? [];
  const candidates = [];
  for (let z = 135; z <= 189; z += 6) for (let x = -1088; x <= -956; x += 6) candidates.push({ x, z, score: Math.hypot(x + 998, z - 159) });
  candidates.sort((a, b) => a.score - b.score);
  for (const center of candidates) {
    let bed = -Infinity, occupiedTop = -Infinity;
    const points = [];
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI / 36, x = center.x + Math.cos(a) * rx, z = center.z + Math.sin(a) * rz, yaw = yawFor(data, -rx * Math.sin(a), rz * Math.cos(a));
      let localBed = -Infinity;
      for (const lx of [-hx, -hx / 2, 0, hx / 2, hx]) for (const lz of [-hz, 0, hz]) {
        const [dx, dz] = museumXZ(lx, lz, yaw);
        localBed = Math.max(localBed, app.terrainData.heightAt(x + dx, z + dz));
      }
      bed = Math.max(bed, localBed); occupiedTop = Math.max(occupiedTop, localBed + .06);
      for (const reef of reefs) {
        if (Math.hypot(reef.x - x, reef.z - z) > hx + (reef.span ?? .5) + 1) continue;
        const [lx, lz] = museumXZ(reef.x - x, reef.z - z, -yaw), radius = (reef.span ?? .5) * .6;
        if (Math.abs(lx) < hx + radius && Math.abs(lz) < hz + radius) occupiedTop = Math.max(occupiedTop, reef.floor + (reef.span ?? .5) * 1.6);
      }
      for (const rock of rocks) {
        const radius = rock.footRadius ?? rock.radius ?? rock.size ?? 0;
        if (Math.hypot(rock.x - x, rock.z - z) < hx + hz + radius) occupiedTop = Math.max(occupiedTop, rock.top ?? rock.y + rock.size * 2);
      }
      points.push([x, z]);
    }
    const lower = occupiedTop + .32 - minY + marineBob, upper = sea - .55 - maxY - marineBob;
    if (lower > upper) continue;
    const y = (lower + upper) / 2;
    return { ...center, y, radii: marineRadii, points, bedMaximum: bed, occupiedTop, envelope: env, rollEnvelopeRadians: marineBank, pitchEnvelopeRadians: pitch, verticalEnvelopeMetres: [minY,maxY], minimumBedClearance: y + minY - bed - marineBob, minimumOccupiedClearance: y + minY - occupiedTop - marineBob, minimumMeanSurfaceClearance: sea - (y + maxY + marineBob), scaleLabel: '5 m representative fish-shaped marine reptile; no age/adult claim', exactWater: 'mean sea level; .55 m minimum top margin covers ordinary local wave troughs, not extreme waves' };
  }
  throw Error('No 5m ichthyosaur route with full animated body, reef and surface clearance');
}

function marineEntry(app, route) {
  let best = null;
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI / 16, x = route.x + Math.cos(a) * 30, z = route.z + Math.sin(a) * 22;
    const floor = app.terrainData.heightAt(x, z), clearance = route.y - floor;
    if (clearance < .55 || sea - floor < 1.6) continue;
    if ((app.coveRocks?.instances ?? []).some(r => Math.hypot(r.x - x, r.z - z) < (r.footRadius ?? r.radius ?? 0) + 1.2 && r.top > route.y - .8)) continue;
    const score = Math.abs(a) + Math.max(0, 1 - clearance);
    if (!best || score < best.score) best = { p: [x, z], floor, eye: route.y, bedClearanceAtEye: clearance, score };
  }
  if (!best) throw Error('No submerged observation entry outside the ichthyosaur patrol');
  return best;
}

export class SampleMuseumLife {
  static create(app, residency) {
    const life = new SampleMuseumLife(app);
    if (app.creekData.field.continuousSample) life.init(residency);
    return life;
  }
  constructor(app) {
    this.app = app; this.actors = []; this.visits = { ...app.creekData.sampleMuseumLifeVisits }; this.reviewAnchors = {};
    this.group = new Group(); this.group.name = 'Museum collection in the continuous coastal sample'; app.scene.add(this.group);
  }
  init(residency) {
    const app = this.app, sites = app.creekData.sampleMuseumLifeSites ?? {};
    for (const original of source) {
      const id = original.data.id;
      const data = id === 'ichthyosaur' ? { ...original.data, motionEnvelope: sampleIchthyosaurEnvelope } : original.data;
      const definition = { ...original, data };
      const actor = { definition, group: new Group(), model: null, active: false, time: 0, nearTime: 0, distance: 0, mode: 'idle', hiddenFrames: 0, poseNodes: [] };
      actor.group.scale.setScalar(data.scale);
      if (id === 'lystrosaurus') {
        actor.contactCenter = [0, .35]; actor.supportHalf = [.13, .22];
        actor.site = findMuseumGround(app, data, { preferred: [-772, 53], yaw: -.4, supportHalf: actor.supportHalf, contactCenter: actor.contactCenter, radius: 18, maxSlope: .13, maxResidual: .025 });
        actor.route = lystroRoute(app, actor.site, actor.supportHalf, actor.contactCenter);
        sites[id] = { id, ...plainSite(actor.site), metres: data.metres, habitat: 'dry bank near the lower-creek vegetation',
          contactCenter: actor.contactCenter, supportHalf: actor.supportHalf, path: actor.route.points };
        this.visits['sample-' + id] = museumGroundVisit(app, 'sample-' + id, '岸边的水龙兽', actor.site, .23, 2.7);
        actor.colliderHalf = [.18, .24, .52];
      } else if (id === 'parasaurolophus') {
        actor.route = parasRoute(app); actor.site = actor.route.supports[0]; actor.contactCenter = actor.route.contactCenter;
        sites[id] = { id, ...plainSite(actor.route.supports[12]), metres: data.metres, habitat: 'gentle dry downstream east bank', path: actor.route.points, trackPath: actor.route.trackPath, speed: actor.route.speed, sourceStanceVelocity: actor.route.sourceStanceVelocity, maximumSupportResidual: Math.max(...actor.route.supports.map(s => s.residual)), maximumSlope: Math.max(...actor.route.supports.map(s => s.slope)) };
        this.visits['sample-' + id] = museumGroundVisit(app, 'sample-' + id, '缓岸觅食的副栉龙', actor.route.supports[12], 2.2, 11);
        actor.colliderHalf = [4.75, 1.95, .8];
      } else if (id === 'pteranodon') {
        let altitude = 18;
        for (let i = 0; i < 72; i++) {
          const a = i * Math.PI / 36, x = -946 + Math.cos(a) * 70, z = 160 + Math.sin(a) * 45;
          altitude = Math.max(altitude, app.terrainData.heightAt(x, z) + 10);
          for (const t of app.vegetation?.records ?? []) if (Math.hypot(t.x - x, t.z - z) < 6) altitude = Math.max(altitude, t.y + t.H + 7);
        }
        actor.route = { center: [-946, 160], radii: [70, 45], altitude, phase: 0, speed: 5 };
        actor.mode = 'flapping-coastal-circuit';
        sites[id] = { id, metres: 7, metric: 'wingspan', habitat: 'coastal air over beach and sea', bird: false, path: actor.route, action: 'source 125-bone wing animation with continuous-tangent rotations and banked coastal circuit' };
        const entry = dryEntry(app, app.islandVisits?.['sample-mouth']?.p ?? [-823, 119]);
        this.visits['sample-' + id] = { id: 'sample-' + id, title: '海风中的无齿翼龙', p: entry.p, gaze: [-946, altitude, 160], time: 12.6, note: '', footing: entry };
      } else {
        actor.route = { ...findMarineRoute(app, data), phase: 0, speed: 1.25 };
        actor.mode = 'swimming';
        sites[id] = { id, metres: data.metres, habitat: 'marine only; open sand corridor beside the outer gardens', path: actor.route, action: 'four separated fin sockets with rest-preserving skin bindings and a Blender-authored swimming cycle' };
        const entry = marineEntry(app, actor.route);
        this.visits['sample-' + id] = { id: 'sample-' + id, title: '浅湾外缘的鱼龙', p: entry.p, gaze: [actor.route.x, actor.route.y, actor.route.z], diveLevel: sea, eyeBelowSurface: sea - actor.route.y, time: 12.6, note: '', habitatAvailable: true, underwaterEntry: entry, waterClearance: { bottom: actor.route.minimumOccupiedClearance, meanSurface: actor.route.minimumMeanSurfaceClearance } };
      }
      this.actors.push(actor);
      this.place(actor, 0);
      const initialCenter = this.centerOf(actor);
      this.reviewAnchors[id] = { id, habitat: definition.habitat, lengthMetres: data.metres, metric: data.metric, initialCenter, visit: this.visits['sample-' + id] };
      const center = id === 'pteranodon' ? [actor.route.center[0], actor.route.altitude, actor.route.center[1]]
        : id === 'ichthyosaur' ? [actor.route.x, actor.route.y, actor.route.z] : initialCenter;
      const radius = id === 'pteranodon' ? 70 : id === 'ichthyosaur' ? 20 : id === 'parasaurolophus' ? 12 : 1;
      residency.add({ id: 'sample:' + id, x: center[0], y: center[1], z: center[2], radius, range: definition.range + 24,
        bytes: definition.costMiB * 1024 ** 2, priority: 8,
        load: async signal => {
          const gltf = prepareMuseumMotion(mergeMuseumSkins(await loadSampleGLB(definition.url, signal)), id);
          if (id === 'ichthyosaur') await prepareIslandAquaticMotion(gltf, id);
          signal.throwIfAborted();
          const probes = { lystrosaurus: ['head_065_62', 'Tail_3_033_29'], parasaurolophus: ['骨骼.018_end', '骨骼.030_end'], pteranodon: ['Lwing03.37_37', 'Rwing03.67_67'], ichthyosaur: ['front_fin_L', 'rear_fin_R', 'tail_05', 'tail_06'] };
          actor.poseNodes = probes[id].map(name => gltf.nodes.findIndex(n => n.name === name));
          if (actor.poseNodes.some(i => i < 0)) throw Error(`Missing local pose probe for ${id}`);
          return createSampleSkinnedModel(gltf, signal, museumMaterialOptions);
        },
        prepare: (model, signal) => {
          markStreamedFaunaMaterials(model, 'sample:' + id);
          for (const mesh of model.meshes) clipCreekRefraction(mesh.material, app.creekData.field);
          return app.islandFauna.pipelines.prepareMain(model, signal);
        },
        attach: model => {
          actor.model = model;
          const bounds = museumMotionEnvelope(data, model.gltf);
          const center = new Vector3(...bounds.min.map((v, i) => (v + bounds.max[i]) * .5));
          const radius = Math.hypot(...bounds.max.map((v, i) => (v - bounds.min[i]) * .5)) * 1.2 + .15 / data.scale;
          for (const mesh of model.meshes) {
            mesh.geometry.boundingSphere = new Sphere(center.clone(), radius);
            mesh.frustumCulled = true;
          }
          model.group.name = `museum-sample:${id}`;
          model.group.scale.copy(actor.group.scale);
          model.play(id === 'ichthyosaur' ? 'Swim' : 'Idle', { fade: 0, loop: true, speed: 1 });
          model.update(0);
          if (definition.habitat === 'land') actor.groundMotion = createMuseumGroundMotion(id, data, model);
          if (actor.colliderHalf) actor.collider = app.colliders?.addBox(new Vector3(), new Vector3(...actor.colliderHalf), actor.site.yaw, { tag: 'museum sample herbivore', solid: true });
          this.place(actor, 0);
          model.hold();
          this.group.add(model.group);
          sites[id].motion = model.gltf.museumMotion;
          if (id === 'pteranodon') {
            const selection = globalThis.document?.querySelector('#pteranodon-review')?.value;
            if (selection && selection !== 'normal') setPteranodonReview(app, selection);
          }
        },
        detach: model => {
          app.dynamicMuseumShadows?.removeModel(model);
          if (id === 'pteranodon') setPteranodonReview(app, 'normal');
          model.group.removeFromParent();
          actor.group.position.copy(model.group.position);
          actor.group.quaternion.copy(model.group.quaternion);
          actor.model = null; actor.active = false;
          actor.groundMotion = null;
          removeSampleCollider(app.colliders, actor.collider);
          actor.collider = null;
        },
        dispose: disposeSampleModel,
      });
    }
    app.creekData.sampleMuseumLifeSites = sites;
    app.creekData.sampleMuseumLifeVisits = this.visits;
  }
  centerOf(actor) {
    const group = actor.model?.group ?? actor.group;
    const d = actor.definition.data, p = new Vector3(...d.bounds.min.map((v, i) => (v + d.bounds.max[i]) * d.scale * .5)).applyQuaternion(group.quaternion).add(group.position);
    return p.toArray();
  }
  updateCollider(actor) {
    if (!actor.collider) return;
    const c = this.centerOf(actor), b = actor.collider;
    b.center.fromArray(c); b.rotY = actor.site.yaw; b.cos = Math.cos(b.rotY); b.sin = Math.sin(b.rotY); b.top = b.center.y + b.half.y; b.bottom = b.center.y - b.half.y;
  }
  place(actor, dt) {
    const app = this.app, data = actor.definition.data, id = data.id, model = actor.model ?? { group: actor.group, layers: [] };
    if (actor.definition.habitat === 'land') {
      const route = actor.route;
      const visitor = app.freeCam ? app.camera.position : app.player?.position ?? app.camera.position;
      const paras = id === 'parasaurolophus';
      const distance = Math.hypot(visitor.x - actor.site.x, visitor.y - actor.site.y, visitor.z - actor.site.z);
      const front = distance < (paras ? 4.2 : .85);
      actor.nearTime = distance < (paras ? 28 : 7) ? actor.nearTime + dt : 0;
      const remaining = Math.max(0, route.length - actor.distance);
      const walking = actor.nearTime >= (paras ? 4 : 3.5) && remaining > .005 && !front;
      const previous = actor.distance;
      // The ground action already animates these limbs from Blender swing
      // curves. The source Walk would pose the same joints again.
      const speed = actor.groundMotion?.advance(dt, walking, Math.min(route.speed, Math.sqrt(.85 * remaining))) ?? 0;
      actor.distance = Math.min(route.length, actor.distance + speed * dt);
      actor.mode = front ? 'yielding-to-visitor' : walking ? 'short-step-foraging' : actor.distance > route.length - .08 ? 'resting-at-end-of-trail' : 'idle-before-foraging';
      const start = route.points[0], x = start[0] + route.dir[0] * actor.distance, z = start[2] + route.dir[1] * actor.distance;
      actor.site = museumGroundSupport(app.terrainData, app.creekData.field, x, z, route.yaw, route.supportHalf);
      seatMuseumModel(model, data, actor.site, actor.contactCenter);
      if (actor.groundMotion?.apply(model, {
        dt, terrain: app.terrainData, behavior: paras ? 'browse' : 'forage', alert: front, travelled: actor.distance - previous,
      })) {
        if (dt === 0) model.jointData.copyWithin(model.joints * 16, 0, model.joints * 16);
        model.jointBuffer.write(model.jointData);
      }
    } else if (id === 'pteranodon') {
      const r = actor.route; r.phase += dt * r.speed / 58;
      const a = r.phase, x = r.center[0] + Math.cos(a) * r.radii[0], z = r.center[1] + Math.sin(a) * r.radii[1];
      model.group.position.set(x, r.altitude + Math.sin(a * 2) * 1.3, z);
      model.group.rotation.set(.035 * Math.cos(a * 2), yawFor(data, -r.radii[0] * Math.sin(a), r.radii[1] * Math.cos(a)), -.10, 'YXZ');
    } else {
      const r = actor.route, [rx, rz] = r.radii;
      const rate = r.speed / Math.hypot(rx * Math.sin(r.phase), rz * Math.cos(r.phase));
      r.phase += dt * rate;
      const a = r.phase, alongX = -rx * Math.sin(a), alongZ = rz * Math.cos(a);
      const x = r.x + Math.cos(a) * rx, z = r.z + Math.sin(a) * rz;
      const rise = Math.cos(a * 2) * 2 * marineBob * rate;
      const bank = -marineBank * (1 + 2 * Math.cos(a) ** 2) / 3;
      model.group.position.set(x, r.y + Math.sin(a * 2) * marineBob, z);
      model.group.rotation.set(bank, yawFor(data, alongX, alongZ), -Math.atan2(rise, r.speed), 'YXZ');
    }
    this.updateCollider(actor);
  }
  update(dt, camera = this.app.camera) {
    const step = clamp(dt, 0, .08), p = camera.position;
    for (const actor of this.actors) {
      if (!actor.model) continue;
      const q = actor.model.group.position, d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      const active = d < actor.definition.range + (actor.active ? 10 : 0);
      if (!active) {
        if (actor.active) actor.model.hold();
        actor.active = false; actor.nearTime = 0;
        actor.model.group.visible = false; actor.hiddenFrames++; continue;
      }
      if (!actor.active) { actor.model.update(0); actor.model.hold(); for (const mesh of actor.model.meshes) mesh.resetVelocity = true; }
      actor.active = true; actor.model.group.visible = true; actor.time += step;
      actor.model.update(step); this.place(actor, step);
      for (const mesh of actor.model.meshes) mesh.castShadow = d < (actor.definition.habitat === 'marine' ? 48 : actor.definition.range * .65);
    }
  }
  hold() {
    for (const actor of this.actors) if (actor.model) { actor.model.hold(); for (const mesh of actor.model.meshes) mesh.resetVelocity = true; }
  }
  async ready(id) {
    const actor = this.actors.find(a => a.definition.data.id === id);
    if (!actor) return null;
    const key = 'sample-' + id;
    const stream = this.app.islandFauna.residency;
    const entry = 'sample:' + id;
    const previous = stream.state(entry);
    if (this.app.currentLandmark !== key || !previous?.inRange) this.app.showLandmark(key);
    stream.retry(entry);
    this.app.islandFauna.scan(this.app.camera.position, 'sample:' + id);
    return stream.ready(entry);
  }
  stats() {
    return {
      collection: 'six curated sample encounters', addedSpecies: this.actors.length,
      sampleCounts: { land: 4, pterosaurs: 1, birds: 0, marineReptiles: 1 },
      localAnimation: 'native skin poses with sampled limb contact, supported weight shifts and sample-specific joint repairs',
      culling: 'nearby assets resident, hidden actors hold history, distant resources released',
      sites: this.app.creekData.sampleMuseumLifeSites,
      actors: this.actors.map(a => {
        const model = a.model, id = a.definition.data.id;
        return {
          id, habitat: a.definition.habitat, metres: a.definition.data.metres, metric: a.definition.data.metric, mode: a.mode,
          position: (model?.group ?? a.group).position.toArray(), center: this.centerOf(a),
          localPose: model ? a.poseNodes.flatMap(i => [12, 13, 14, 0, 5, 10].map(k => model.world[i * 16 + k])) : [],
          poseProbeNodes: model ? a.poseNodes.map(i => model.gltf.nodes[i].name) : [], held: model?._held ?? true,
          time: a.time, distance: a.distance, visible: model?.group.visible ?? false, active: a.active, hiddenFrames: a.hiddenFrames,
          joints: model?.joints ?? 0, sourcePieces: model?.gltf.museumPieces ?? 0, meshCount: model?.meshes.length ?? 0, range: a.definition.range,
          clip: model?.current ?? null, layers: model?.layers.map(l => ({ clip: l.clip.name, time: l.time, weight: l.weight, speed: l.speed })) ?? [],
          contact: a.site ? plainSite(a.site) : null, residency: this.app.islandFauna.residency.state('sample:' + id)?.status,
          groundMotion: a.groundMotion?.diagnostics() ?? null,
        };
      }),
    };
  }
}
