// Reproduce the native skin palette on the CPU and measure both the solved
// contact point and representative sole vertices in world metres.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ISLAND_FAUNA_PLAN } from '../creek/IslandFaunaPlan.js';
import { createIslandFaunaHabitats, faunaBodyPlacement, faunaMediumLimits } from '../creek/IslandFaunaHabitats.js';
import { makeRoute, routePoint } from '../creek/IslandFaunaRoute.js';
import { loadRuntimeTerrain } from './load-runtime-terrain.mjs';
import { Matrix4, Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { StorageBuffer } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { prepareMuseumMotion } from '../museum/AnimalMotionPolish.js';
import { createIslandModelPose, floatAttribute, islandMorphWeights, islandModelPieces, parseIslandMuseumModel } from '../museum/IslandMuseumModelData.js';
import { augmentIslandLegRig, syncIslandLegRigPalette } from '../museum/IslandMuseumLegRig.js';
import { createMuseumGroundMotion } from '../museum/MuseumGroundMotion.js';
import { prepareMuseumGroundPose } from '../museum/MuseumGroundPose.js';
import { mergeMuseumSkins } from '../museum/NativeMuseumSkin.js';

StorageBuffer.prototype.write = () => {};
const read = relative => readFileSync(new URL(relative, import.meta.url));
const lock = JSON.parse(read('../museum/island-museum-models.lock.json')).animals;
const specimens = ISLAND_FAUNA_PLAN.filter(site => site.medium === 'ground').concat([
  { id: 'sample-lystrosaurus', speed: .18, behavior: 'forage' },
  { id: 'sample-parasaurolophus', speed: .18, behavior: 'browse' },
]);
const fullRoute = process.argv.includes('--full-route');
const selected = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const matrix = new Matrix4();
const local = new Vector3(), weighted = new Vector3(), transformed = new Vector3();
const clamp = (v, low, high) => Math.max(low, Math.min(v, high));

function frameVertex(piece, vertex, pose, groupFrame, result) {
  const { xyz, primitive, influences, morph } = piece;
  const at = vertex * 3;
  local.fromArray(xyz, at);
  const mask = piece.groundMorphMask?.[vertex] ?? 0;
  for (const [i, target] of primitive.targets.entries()) {
    const influence = mask ? morph[i] + (piece.groundMorphWeights[i] - morph[i]) * mask : morph[i];
    if (target.position && influence) local.addScaledVector(transformed.fromArray(target.position, at), influence);
  }
  result.set(0, 0, 0);
  for (const { weights, joints } of influences) for (let k = vertex * 4; k < vertex * 4 + 4; k++) {
    if (!weights[k]) continue;
    matrix.fromArray(pose.jointData, joints[k] * 16);
    result.addScaledVector(weighted.copy(local).applyMatrix4(matrix), weights[k] / 65535);
  }
  return result.applyMatrix4(groupFrame);
}

function soleVertices(pose, pieces, contacts, rig, height, groupFrame) {
  if (rig) return rig.chains.map(limb => limb.samples.map(({ piece, vertex }) => ({ piece, vertex })));
  return contacts.map(contact => {
    const center = new Vector3(...contact.sole);
    const descendants = new Set();
    for (const joint of pose.order) {
      if (joint === contact.joint || descendants.has(pose.parent[joint])) descendants.add(joint);
    }
    const candidates = [], rows = pose.skin.joints.map(i => descendants.has(i));
    for (const [pieceIndex, piece] of pieces.entries()) {
      if (!piece.influences.length) continue;
      for (let v = 0; v < piece.xyz.length / 3; v++) {
        let distalWeight = 0;
        for (const { weights, joints } of piece.influences) for (let k = v * 4; k < v * 4 + 4; k++) {
          if (rows[joints[k]]) distalWeight += weights[k];
        }
        if (distalWeight < 65535 * .94) continue;
        const p = frameVertex(piece, v, pose, groupFrame, new Vector3());
        if (Math.hypot(p.x - center.x, p.z - center.z) > height * .21) continue;
        candidates.push({ piece: pieceIndex, vertex: v, position: p });
      }
    }
    assert(candidates.length >= 3, 'Need representative sole vertices');
    candidates.sort((a, b) => a.position.y - b.position.y);
    const bottom = candidates[0].position.y;
    const patch = candidates.filter(({ position }) => position.y <= bottom + height * .018);
    const spacing = height * .018;
    const samples = [];
    for (const sample of patch) {
      if (samples.some(s => s.position.distanceTo(sample.position) < spacing)) continue;
      samples.push(sample);
      if (samples.length >= 10) break;
    }
    return samples;
  });
}

function openSpecimen(id) {
  const sample = id.startsWith('sample-');
  const key = id.replace(/^sample-/, '');
  const bytes = sample ? read('../museum/assets/' + id + '.glb') : gunzipSync(read('../museum/assets/island/' + id + '.glb.gz'));
  const raw = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const gltf = sample ? prepareMuseumMotion(mergeMuseumSkins(raw), key) : raw;
  prepareMuseumGroundPose(gltf, key);
  const meta = sample ? JSON.parse(read('../museum/assets/' + id + '.json')) : lock[key];
  const { pieces, skin } = islandModelPieces(gltf);
  const rig = sample ? null : augmentIslandLegRig(key, gltf, pieces, skin);
  for (const piece of pieces) {
    piece.xyz = floatAttribute(piece.primitive.attributes.POSITION);
    piece.morph = new Float32Array(piece.primitive.targets.length);
  }
  const pose = createIslandModelPose(gltf, skin);
  pose.play('Idle', { fade: 0 });
  pose.update(0);
  const motion = createMuseumGroundMotion(key, meta, pose, rig);
  assert(motion, 'Missing leg articulation for ' + id);
  pose.group.scale.setScalar(meta.scale);
  return { pieces, rig, meta, pose, motion };
}

function run(site, data, terrain, realSite = null, field = null) {
  const { pieces, rig, pose, motion, meta } = data;
  const { group } = pose;
  const groupFrame = new Matrix4();
  const yawForForward = Math.atan2(meta.forward[0], meta.forward[1]);
  const height = (meta.bounds.max[1] - meta.bounds.min[1]) * meta.scale;
  const dt = 1 / 60, observationFrames = 28 * 60;
  const placement = faunaBodyPlacement(meta);
  const route = realSite && makeRoute(realSite, placement);
  const frames = fullRoute && route?.length
    ? observationFrames + Math.ceil(route.length / (site.speed * .42) / dt) : observationFrames;
  const bounds = meta.animatedBounds ?? meta.bounds;
  const center = new Vector3(...bounds.min.map((v, i) => (v + bounds.max[i]) * meta.scale * .5));
  const offset = new Vector3();
  let previousYaw;
  function seat(distance) {
    const [x, , z, targetYaw] = route ? routePoint(route, distance) : [0, 0, distance, -yawForForward];
    const delta = targetYaw - previousYaw;
    const yaw = previousYaw === undefined ? targetYaw : previousYaw + clamp(Math.atan2(Math.sin(delta), Math.cos(delta)), -.6 * dt, .6 * dt);
    const fit = realSite && faunaMediumLimits(terrain, field, realSite, placement, x, z, yaw);
    if (realSite && !fit) return false;
    previousYaw = yaw;
    group.rotation.y = yaw;
    offset.copy(center).applyQuaternion(group.quaternion);
    const y = fit ? fit.min : terrain.heightAt(x, z) - placement.floor;
    group.position.set(x - offset.x, y - offset.y, z - offset.z);
    groupFrame.compose(group.position, group.quaternion, group.scale);
    return true;
  }
  motion.reset();
  assert(seat(0), site.id + ' cannot fit terrain at route start');
  pose.play('Idle', { fade: 0 });
  pose.layers = pose.layers.filter(layer => layer.target === 1);
  for (const layer of pose.layers) { layer.time = 0; layer.weight = 1; }
  pose.update(0);
  motion.apply(pose, { dt: 0, terrain, travelled: 0, behavior: site.behavior });
  syncIslandLegRigPalette(pose, rig, true, true);
  for (const piece of pieces) islandMorphWeights(piece, pose.layers, piece.morph);
  const manifest = soleVertices(pose, pieces, motion.diagnostics().contacts, rig, height, groupFrame);
  const angles = manifest.map(() => [Infinity, -Infinity]);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const plantedAt = manifest.map(samples => samples.map(() => new Vector3()));
  let maxSkate = 0, maxSoleSkate = 0, maxError = 0, lift = 0, distance = 0, minSupport = Infinity, previous = [];
  for (let frame = 1; frame <= frames; frame++) {
    const withinCycle = frame % observationFrames;
    const walkingWindow = withinCycle > 180 && withinCycle < 890 || withinCycle > 1080 && withinCycle < 1470;
    const moving = walkingWindow && (!route || route.length > 0);
    const proposed = dt * motion.advance(dt, moving, site.speed);
    const step = proposed && seat(distance + proposed) ? proposed : 0;
    distance += step;
    if (pose.clipDuration('StrideBase')) pose.play(moving ? 'StrideBase' : 'Idle', { fade: .28 });
    pose.update(dt);
    motion.apply(pose, { dt, terrain, travelled: step, behavior: site.behavior });
    syncIslandLegRigPalette(pose, rig, false, true);
    for (const piece of pieces) islandMorphWeights(piece, pose.layers, piece.morph);
    const contacts = motion.diagnostics().contacts;
    minSupport = Math.min(minSupport, contacts.filter(p => p.planted).length);
    for (const [limb, contact] of contacts.entries()) {
      const lower = pose.parent[contact.joint], upper = pose.parent[lower];
      b.fromArray(pose.world, lower * 16 + 12);
      a.fromArray(pose.world, upper * 16 + 12).sub(b);
      c.fromArray(pose.world, contact.joint * 16 + 12).sub(b);
      const angle = Math.acos(clamp(a.dot(c) / (a.length() * c.length()), -1, 1)) * 180 / Math.PI;
      angles[limb][0] = Math.min(angles[limb][0], angle);
      angles[limb][1] = Math.max(angles[limb][1], angle);
      if (!contact.planted) {
        lift = Math.max(lift, contact.terrainClearanceMetres);
        continue;
      }
      maxError = Math.max(maxError, contact.errorMetres);
      const continuous = previous[limb]?.planted;
      if (continuous) maxSkate = Math.max(maxSkate, Math.hypot(...contact.sole.map((v, i) => v - previous[limb].sole[i])));
      for (const [i, { piece, vertex }] of manifest[limb].entries()) {
        const p = frameVertex(pieces[piece], vertex, pose, groupFrame, new Vector3());
        const anchor = plantedAt[limb][i];
        if (continuous) maxSoleSkate = Math.max(maxSoleSkate, Math.hypot(p.x - anchor.x, p.z - anchor.z));
        else anchor.copy(p);
      }
    }
    previous = contacts;
  }
  const steps = Math.min(...previous.map(p => p.steps));
  const kneeArc = Math.min(...angles.map(([low, high]) => high - low));
  return { distance, steps, minSupport, lift, maxSkate, maxError, maxSoleSkate, kneeArc, limbs: manifest.length, routeLength: route?.length ?? null };
}

const results = [];
const terrainData = await loadRuntimeTerrain();
const habitats = createIslandFaunaHabitats(terrainData, lock).sites;
let failure = false;
for (const site of specimens) {
  if (selected.length && !selected.includes(site.id)) continue;
  const data = openSpecimen(site.id);
  const flat = run(site, data, { heightAt: () => 0 });
  const island = habitats[site.id] && run(site, data, terrainData.terrain, habitats[site.id], terrainData.field);
  const runs = island ? [flat, island] : [flat];
  const value = (property, fn = Math.max) => fn(...runs.map(run => run[property]));
  const digits = n => +n.toFixed(5);
  const row = { specimen: site.id, route_m: island ? digits(island.routeLength) : null, route_travelled_m: island ? digits(island.distance) : null,
    cycles_each_foot: (island?.routeLength ? island : flat).steps, knee_arc_deg: digits((island?.routeLength ? island : flat).kneeArc),
    swing_lift_m: digits(value('lift')), min_support: value('minSupport', Math.min), contact_frame_drift_m: digits(value('maxSkate')),
    contact_error_m: digits(value('maxError')), rendered_sole_drift_m: digits(value('maxSoleSkate')) };
  assert(flat.distance > site.speed * 6 && flat.steps >= 2 && flat.lift > .015, site.id + ' should take visible steps on level ground');
  assert(row.min_support >= (flat.limbs === 2 ? 1 : 3), site.id + ' should keep support throughout the walk');
  if (fullRoute && island?.routeLength) assert(island.distance >= island.routeLength, site.id + ' could not complete its checked terrain route');
  if (row.contact_frame_drift_m > .008 || row.contact_error_m > .025 || row.rendered_sole_drift_m > .035 || row.knee_arc_deg < 2) failure = true;
  results.push(row);
}
console.table(results);
assert(!failure, 'Ground cycle exceeded pose or rendered sole drift tolerance');
