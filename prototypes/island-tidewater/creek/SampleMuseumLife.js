// A small representative cast from the museum's 36-animal mainCollection.
// Source joint motion and runtime pose repairs drive native WebGPU skinning.
import { Group, Vector3, Sphere } from '../vendor/tidewater/src/engine/index.js';
import { loadGLB } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../vendor/tidewater/src/engine/render/Skinning.js';
import { mergeMuseumSkins } from '../museum/NativeMuseumSkin.js';
import { prepareMuseumMotion, museumMotionEnvelope } from '../museum/AnimalMotionPolish.js';
import { museumMaterialOptions } from '../museum/animals.js';
import { findMuseumGround, museumGroundSupport, museumTrunkClear, seatMuseumModel, museumGroundVisit, museumXZ } from '../museum/MuseumGrounding.js';
import lystro from '../museum/assets/sample-lystrosaurus.json';
import paras from '../museum/assets/sample-parasaurolophus.json';
import ptera from '../museum/assets/sample-pteranodon.json';
import ichthy from '../museum/assets/sample-ichthyosaur.json';

const source = [
  { data: lystro, title: '水龙兽', habitat: 'land', range: 62, url: new URL('../museum/assets/sample-lystrosaurus.glb', import.meta.url).href },
  { data: paras, title: '副栉龙', habitat: 'land', range: 210, url: new URL('../museum/assets/sample-parasaurolophus.glb', import.meta.url).href },
  { data: ptera, title: '无齿翼龙', habitat: 'air', range: 340, url: new URL('../museum/assets/sample-pteranodon.glb', import.meta.url).href },
  { data: ichthy, title: '鱼龙', habitat: 'marine', range: 100, url: new URL('../museum/assets/sample-ichthyosaur.glb', import.meta.url).href },
];
const sea = -.7, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yawFor = (data, dx, dz) => Math.atan2(dx, dz) - Math.atan2(data.forward[0], data.forward[1]);
const envelope = data => data.motionEnvelope ?? ({ min: [0, 1, 2].map(k => Math.min(...data.animationEnvelope.clips.map(c => c.min[k]))), max: [0, 1, 2].map(k => Math.max(...data.animationEnvelope.clips.map(c => c.max[k]))) });
function clipFloor(data, clip, time) {
  const frames = data.animationEnvelope.clips.find(c => c.name === clip)?.frames;
  if (!frames?.length) return data.bounds.min[1];
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].time <= time) i++;
  const a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)], t = clamp((time - a.time) / Math.max(.0001, b.time - a.time), 0, 1);
  return a.minY + (b.minY - a.minY) * t;
}
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
  return { center, dir, length, yaw, contactCenter, supportHalf, supports, points, speed: .18, sourceStanceVelocity: .1800, cycleSeconds: 2, currentStepMetres: .18, currentCycleStrideMetres: .36, trackPath: { start: points[0], end: points.at(-1), points, stepMetres: 1.08, traceStepMetres: 1.08, footLengthMetres: .54, halfTrackMetres: .34, bankOffsetMetres: -.9, currentStepMetres: .18, currentCycleStrideMetres: .36, correspondence: 'older normal walking pass; current source Walk clip is a slower short-step forage, not a live footprint simulation' } };
}

function findMarineRoute(app, data) {
  const env = envelope(data), roll = .018, c = Math.cos(roll), s = Math.sin(roll);
  // The coastal circuit banks slightly. Bound that rotation as well as every
  // local joint pose before selecting a height between reef and wave trough.
  const ex = Math.max(Math.abs(env.min[0]), Math.abs(env.max[0]));
  const minY = (env.min[1] * c - ex * s) * data.scale, maxY = (env.max[1] * c + ex * s) * data.scale;
  const hx = Math.max(Math.abs(env.min[0]), Math.abs(env.max[0])) * data.scale + .12;
  const hz = Math.max(Math.abs(env.min[2]), Math.abs(env.max[2])) * data.scale + .12;
  const reefs = [...(app.creekData.sampleBenthicDetails?.coralSites ?? []), ...(app.creekData.sampleBenthicDetails?.spongeSites ?? [])];
  const rocks = app.coveRocks?.instances ?? [];
  const candidates = [];
  for (let z = 135; z <= 189; z += 6) for (let x = -1088; x <= -956; x += 6) candidates.push({ x, z, score: Math.hypot(x + 998, z - 159) });
  candidates.sort((a, b) => a.score - b.score);
  for (const center of candidates) {
    let bed = -Infinity, occupiedTop = -Infinity;
    const points = [];
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI / 36, x = center.x + Math.cos(a) * 20, z = center.z + Math.sin(a) * 10, yaw = yawFor(data, -20 * Math.sin(a), 10 * Math.cos(a));
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
    const lower = occupiedTop + .32 - minY + .025, upper = sea - .55 - maxY - .025;
    if (lower > upper) continue;
    const y = (lower + upper) / 2;
    return { ...center, y, radii: [20, 10], points, bedMaximum: bed, occupiedTop, envelope: env, rollEnvelopeRadians: roll, verticalEnvelopeMetres: [minY,maxY], minimumBedClearance: y + minY - bed - .025, minimumOccupiedClearance: y + minY - occupiedTop - .025, minimumMeanSurfaceClearance: sea - (y + maxY + .025), scaleLabel: '5 m representative fish-shaped marine reptile; no age/adult claim', exactWater: 'mean sea level; .55 m minimum top margin covers ordinary local wave troughs, not extreme waves' };
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
  static async create(app) {
    const life = new SampleMuseumLife(app);
    if (app.creekData.field.continuousSample) await life.init();
    return life;
  }
  constructor(app) {
    this.app = app; this.actors = []; this.visits = { ...app.creekData.sampleMuseumLifeVisits }; this.reviewAnchors = {};
    this.group = new Group(); this.group.name = 'Museum collection in the continuous coastal sample'; app.scene.add(this.group);
  }
  async init() {
    const app = this.app, sites = app.creekData.sampleMuseumLifeSites ?? {};
    for (const original of source) {
      const gltf = prepareMuseumMotion(mergeMuseumSkins(await loadGLB(original.url)), original.data.id);
      const definition = { ...original, data: { ...original.data, motionEnvelope: museumMotionEnvelope(original.data, gltf) } };
      const model = await SkinnedModel.create(gltf, { materials: museumMaterialOptions });
      // Native skins disable culling because rest-pose bounds miss moving
      // limbs. Use the entire sampled animation envelope, padded by 20% and
      // 15 cm, for every source piece in both the view and shadow frusta.
      // Animation and world behaviour continue when an actor is offscreen.
      const bounds=envelope(definition.data),center=new Vector3(...bounds.min.map((v,i)=>(v+bounds.max[i])*.5));
      const radius=Math.hypot(...bounds.max.map((v,i)=>(v-bounds.min[i])*.5))*1.2+.15/definition.data.scale;
      for(const mesh of model.meshes){mesh.geometry.boundingSphere=new Sphere(center.clone(),radius);mesh.frustumCulled=true;}
      model.group.name = `museum-sample:${definition.data.id}`; model.group.scale.setScalar(definition.data.scale);
      model.play('Idle', { fade: 0, loop: true, speed: 1 }); model.update(0);
      const actor = { definition, model, active: true, time: 0, distance: 0, mode: 'idle', hiddenFrames: 0 };
      this.group.add(model.group);
      const id = definition.data.id, data = definition.data;
      const probes = { lystrosaurus: ['head_065_62', 'Tail_3_033_29'], parasaurolophus: ['骨骼.018_end', '骨骼.030_end'], pteranodon: ['Lwing03.37_37', 'Rwing03.67_67'], ichthyosaur: ['front_fin_L', 'rear_fin_R', 'tail_05', 'tail_06'] };
      actor.poseNodes = probes[id].map(name => gltf.nodes.findIndex(n => n.name === name));
      if (actor.poseNodes.some(i => i < 0)) throw Error(`Missing local pose probe for ${id}`);
      if (id === 'lystrosaurus') {
        actor.contactCenter = [0, .35]; actor.supportHalf = [.13, .22];
        actor.site = findMuseumGround(app, data, { preferred: [-772, 53], yaw: -.4, supportHalf: actor.supportHalf, contactCenter: actor.contactCenter, radius: 18, maxSlope: .13, maxResidual: .025 });
        seatMuseumModel(model, data, actor.site, actor.contactCenter, clipFloor(data, 'Idle', 0));
        sites[id] = { id, ...plainSite(actor.site), metres: data.metres, habitat: 'dry bank near the lower-creek vegetation', contactCenter: actor.contactCenter, supportHalf: actor.supportHalf };
        this.visits['sample-' + id] = museumGroundVisit(app, 'sample-' + id, '岸边的水龙兽', actor.site, .23, 2.7);
        actor.collider = app.colliders?.addBox(new Vector3(actor.site.x, actor.site.y + .22, actor.site.z), new Vector3(.18, .24, .52), actor.site.yaw, { tag: 'museum small herbivore', solid: true });
      } else if (id === 'parasaurolophus') {
        actor.route = parasRoute(app); actor.site = actor.route.supports[0]; actor.contactCenter = actor.route.contactCenter;
        seatMuseumModel(model, data, actor.site, actor.contactCenter);
        sites[id] = { id, ...plainSite(actor.route.supports[12]), metres: data.metres, habitat: 'gentle dry downstream east bank', path: actor.route.points, trackPath: actor.route.trackPath, speed: actor.route.speed, sourceStanceVelocity: actor.route.sourceStanceVelocity, maximumSupportResidual: Math.max(...actor.route.supports.map(s => s.residual)), maximumSlope: Math.max(...actor.route.supports.map(s => s.slope)) };
        this.visits['sample-' + id] = museumGroundVisit(app, 'sample-' + id, '缓岸觅食的副栉龙', actor.route.supports[12], 2.2, 11);
        actor.collider = app.colliders?.addBox(new Vector3(), new Vector3(4.75, 1.95, .8), actor.route.yaw, { tag: 'museum foraging herbivore', solid: true });
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
        actor.route = findMarineRoute(app, data); actor.route.phase = 0; actor.mode = 'swimming';
        sites[id] = { id, metres: data.metres, habitat: 'marine only; open sand corridor beside the outer gardens', path: actor.route, action: 'four separated fin sockets with rest-preserving skin bindings and extended tail articulation; all 3 source pieces retained' };
        const entry = marineEntry(app, actor.route);
        this.visits['sample-' + id] = { id: 'sample-' + id, title: '浅湾外缘的鱼龙', p: entry.p, gaze: [actor.route.x, actor.route.y, actor.route.z], diveLevel: sea, eyeBelowSurface: sea - actor.route.y, time: 12.6, note: '', habitatAvailable: true, underwaterEntry: entry, waterClearance: { bottom: actor.route.minimumOccupiedClearance, meanSurface: actor.route.minimumMeanSurfaceClearance } };
      }
      sites[id].motion = gltf.museumMotion;
      this.actors.push(actor); this.place(actor, 0); model.hold(); this.updateCollider(actor);
      this.reviewAnchors[id] = { id, habitat: definition.habitat, lengthMetres: data.metres, metric: data.metric, initialCenter: this.centerOf(actor), visit: this.visits['sample-' + id] };
    }
    app.creekData.sampleMuseumLifeSites = sites;
    app.creekData.sampleMuseumLifeVisits = this.visits;
  }
  centerOf(actor) {
    const d = actor.definition.data, p = new Vector3(...d.bounds.min.map((v, i) => (v + d.bounds.max[i]) * d.scale * .5)).applyQuaternion(actor.model.group.quaternion).add(actor.model.group.position);
    return p.toArray();
  }
  updateCollider(actor) {
    if (!actor.collider) return;
    const c = this.centerOf(actor), b = actor.collider;
    b.center.fromArray(c); b.rotY = actor.site.yaw; b.cos = Math.cos(b.rotY); b.sin = Math.sin(b.rotY); b.top = b.center.y + b.half.y; b.bottom = b.center.y - b.half.y;
  }
  place(actor, dt) {
    const app = this.app, data = actor.definition.data, id = data.id, model = actor.model;
    if (id === 'lystrosaurus') {
      const layer = model.layers.find(l => l.target === 1);
      seatMuseumModel(model, data, actor.site, actor.contactCenter, clipFloor(data, 'Idle', layer?.time ?? 0));
    } else if (id === 'parasaurolophus') {
      const route = actor.route, pedestrian = app.player?.position;
      const front = pedestrian && Math.hypot(pedestrian.x - actor.site.x, pedestrian.z - actor.site.z) < 4.2;
      const walking = actor.time >= 4 && actor.distance < route.length - .045 && !front;
      if (walking && model.current !== 'Walk') model.play('Walk', { fade: .55, loop: true, speed: 1 });
      if (!walking && model.current !== 'Idle') model.play('Idle', { fade: .55, loop: true, speed: 1 });
      const weight = model.layers.find(l => l.clip.name === 'Walk')?.weight ?? 0;
      actor.distance = Math.min(route.length, actor.distance + route.speed * weight * dt);
      actor.mode = front ? 'yielding-to-visitor' : walking ? 'short-step-foraging' : actor.distance > route.length - .08 ? 'resting-at-end-of-trail' : 'idle-before-foraging';
      const start = route.points[0], x = start[0] + route.dir[0] * actor.distance, z = start[2] + route.dir[1] * actor.distance;
      actor.site = museumGroundSupport(app.terrainData, app.creekData.field, x, z, route.yaw, route.supportHalf);
      seatMuseumModel(model, data, actor.site, actor.contactCenter);
    } else if (id === 'pteranodon') {
      const r = actor.route; r.phase += dt * r.speed / 58;
      const a = r.phase, x = r.center[0] + Math.cos(a) * r.radii[0], z = r.center[1] + Math.sin(a) * r.radii[1];
      model.group.position.set(x, r.altitude + Math.sin(a * 2) * 1.3, z);
      model.group.rotation.set(.035 * Math.cos(a * 2), yawFor(data, -r.radii[0] * Math.sin(a), r.radii[1] * Math.cos(a)), -.10, 'YXZ');
    } else {
      const r = actor.route; r.phase += dt * .72 / 16;
      const a = r.phase, x = r.x + Math.cos(a) * r.radii[0], z = r.z + Math.sin(a) * r.radii[1];
      model.group.position.set(x, r.y + Math.sin(a * 2) * .025, z);
      model.group.rotation.set(0, yawFor(data, -r.radii[0] * Math.sin(a), r.radii[1] * Math.cos(a)), .018 * Math.sin(a), 'YXZ');
    }
    this.updateCollider(actor);
  }
  update(dt, camera = this.app.camera) {
    const step = clamp(dt, 0, .08), p = camera.position;
    for (const actor of this.actors) {
      const q = actor.model.group.position, d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      const active = d < actor.definition.range + (actor.active ? 10 : 0);
      if (!active) {
        if (actor.active) actor.model.hold();
        actor.active = false; actor.model.group.visible = false; actor.hiddenFrames++; continue;
      }
      if (!actor.active) { actor.model.update(0); actor.model.hold(); for (const mesh of actor.model.meshes) mesh.resetVelocity = true; }
      actor.active = true; actor.model.group.visible = true; actor.time += step;
      actor.model.update(step); this.place(actor, step);
      for (const mesh of actor.model.meshes) mesh.castShadow = d < (actor.definition.habitat === 'marine' ? 48 : actor.definition.range * .65);
    }
  }
  hold() {
    for (const actor of this.actors) { actor.model.hold(); for (const mesh of actor.model.meshes) mesh.resetVelocity = true; }
  }
  stats() {
    return { collection: 'museum mainCollection 36; six representatives including existing Apatosaurus/Triceratops', addedSpecies: this.actors.length, sampleCounts: { land: 4, pterosaurs: 1, birds: 0, marineReptiles: 1 }, localAnimation: 'source TRS with rest-preserving fin sockets and continuous rotation curves on native current/previous GPU skin palettes; all source mesh pieces retained', culling: 'per-species metre ranges; hidden actors stop animation uploads and hold history; full resolution and world systems unchanged', sites: this.app.creekData.sampleMuseumLifeSites, actors: this.actors.map(a => ({ id: a.definition.data.id, habitat: a.definition.habitat, metres: a.definition.data.metres, metric: a.definition.data.metric, mode: a.mode, position: a.model.group.position.toArray(), center: this.centerOf(a), localPose: a.poseNodes.flatMap(i => [12, 13, 14, 0, 5, 10].map(k => a.model.world[i * 16 + k])), poseProbeNodes: a.poseNodes.map(i => a.model.gltf.nodes[i].name), held: a.model._held, time: a.time, distance: a.distance, visible: a.model.group.visible, active: a.active, hiddenFrames: a.hiddenFrames, joints: a.model.joints, sourcePieces: a.model.gltf.museumPieces, meshCount: a.model.meshes.length, range: a.definition.range, clip: a.model.current, layers: a.model.layers.map(l => ({ clip: l.clip.name, time: l.time, weight: l.weight, speed: l.speed })), contact: a.site ? plainSite(a.site) : null })), limitations: ['Pteranodon is a pterosaur; this addition does not increase bird count.', 'Parasaurolophus source Walk is a 0.18 m/s short-step forage; wider-spaced traces record an earlier walking pass.', 'Marine clearance uses a sampled animated envelope and mean sea with a margin, not continuous collision with every FFT crest.', 'No age co-occurrence claim; freshwater, marine and dry-ground habitats remain distinct.'] };
  }
}
