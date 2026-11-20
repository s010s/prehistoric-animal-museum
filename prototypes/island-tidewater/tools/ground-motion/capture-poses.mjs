import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ISLAND_FAUNA_PLAN } from '../../creek/IslandFaunaPlan.js';
import { prepareMuseumMotion } from '../../museum/AnimalMotionPolish.js';
import { syncIslandLegRigPalette } from '../../museum/IslandMuseumLegRig.js';
import { createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, parseIslandMuseumModel } from '../../museum/IslandMuseumModelData.js';
import { mergeMuseumSkins } from '../../museum/NativeMuseumSkin.js';
import { createMuseumGroundMotion } from '../../museum/MuseumGroundMotion.js';
import { prepareGroundSpecimen } from '../../museum/PrepareGroundSpecimen.js';
import { Matrix4, Vector3 } from '../../vendor/tidewater/src/engine/index.js';
import { StorageBuffer } from '../../vendor/tidewater/src/engine/gpu/Texture.js';

StorageBuffer.prototype.write = () => {};
const read = path => readFileSync(new URL('../../museum/' + path, import.meta.url));
const metadata = JSON.parse(read('island-museum-models.lock.json')).animals;
const [directory, ...options] = process.argv.slice(2);
const sequence = options.includes('--sequence');
const requested = options.filter(option => option !== '--sequence');
if (!directory) throw Error('Usage: node tools/ground-motion/capture-poses.mjs <output-directory> [--sequence] [specimen ...]');
mkdirSync(directory, { recursive: true });

function openSpecimen(id) {
  const key = id.replace(/^sample-/, '');
  const sample = id !== key;
  const bytes = sample ? read('assets/' + id + '.glb') : gunzipSync(read('assets/island/' + id + '.glb.gz'));
  const parsed = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const model = sample ? prepareMuseumMotion(mergeMuseumSkins(parsed), key) : parsed;
  const meta = sample ? JSON.parse(read('assets/' + id + '.json')) : metadata[key];
  const { pieces, skin } = islandModelPieces(model);
  const rig = prepareGroundSpecimen(key, model, pieces, skin, meta, { sample });
  const pose = createIslandModelPose(model, skin);
  pose.play('Idle', { fade: 0 });
  pose.update(0);
  const motion = createMuseumGroundMotion(key, meta, pose, rig);
  const site = sample ? key === 'lystrosaurus' ? { speed: .18, behavior: 'forage' } : { speed: .50, behavior: 'browse' }
    : ISLAND_FAUNA_PLAN.find(stop => stop.id === id);
  return { pieces, pose, motion, meta, rig, site };
}

function meshTopology(pieces) {
  const indices = [];
  let offset = 0;
  for (const piece of pieces) {
    const count = piece.positions.length / 3;
    const source = piece.primitive.indices;
    for (let i = 0; i < (source?.length ?? count); i++) indices.push(offset + (source?.[i] ?? i));
    offset += count;
  }
  return { indices: new Uint32Array(indices), count: offset };
}

function capture(id) {
  const { pieces: modelPieces, pose, motion, meta, rig, site } = openSpecimen(id);
  const pieces = modelPieces.filter(piece => piece.primitive.mode === 4);
  for (const piece of pieces) {
    piece.positions = floatAttribute(piece.primitive.attributes.POSITION);
    piece.morph = new Float32Array(piece.primitive.targets.length);
  }
  const { count, indices } = meshTopology(pieces);
  const frames = [];
  const [fx, fz] = meta.forward;
  const point = new Vector3(), local = new Vector3(), scratch = new Vector3();
  const rigid = new Matrix4();
  const write = (name, data) => writeFileSync(join(directory, id + '-' + name + '.bin'), Buffer.from(data.buffer));

  function snapshot(name, grounded) {
    const coords = new Float32Array(count * 3);
    const matrices = Array.from({ length: pose.joints }, (_, i) => new Matrix4().fromArray(pose.jointData, i * 16));
    let offset = 0;
    for (const piece of pieces) {
      const { positions, primitive, influences, morph, nodeIndex, groundMorphMask, groundMorphWeights } = piece;
      islandMorphWeights(piece, pose.layers, morph);
      rigid.fromArray(pose.world, nodeIndex * 16);
      for (let i = 0; i < positions.length / 3; i++) {
        local.fromArray(positions, i * 3);
        for (const [m, { position }] of primitive.targets.entries()) {
          const mask = grounded ? groundMorphMask?.[i] ?? 0 : 0;
          const weight = mask ? morph[m] + (groundMorphWeights[m] - morph[m]) * mask : morph[m];
          if (position && weight) local.addScaledVector(scratch.fromArray(position, i * 3), weight);
        }
        if (influences.length) {
          point.set(0, 0, 0);
          for (const { weights, joints } of influences) for (let j = i * 4; j < i * 4 + 4; j++) {
            if (weights[j]) point.addScaledVector(scratch.copy(local).applyMatrix4(matrices[joints[j]]), weights[j] / 65535);
          }
        } else point.copy(local).applyMatrix4(rigid);
        // glTF Y up to Blender Z up, +X forwards and +Y left.
        coords[offset++] = point.x * fx + point.z * fz;
        coords[offset++] = point.z * fx - point.x * fz;
        coords[offset++] = point.y + pose.group.position.y / meta.scale;
      }
    }
    write(name, coords);
    const contacts = motion.diagnostics().contacts;
    frames.push({ name, phase: motion.diagnostics().phase, planted: contacts.map(contact => contact.planted) });
  }

  const { group } = pose;
  const initialYaw = -Math.atan2(fx, fz);
  group.scale.setScalar(meta.scale);
  group.rotation.y = initialYaw;
  const ground = { heightAt: (x, z) => .061 * x + .009 * Math.max(0, z - site.speed * 3) };
  const floor = -meta.bounds.min[1] * meta.scale;
  group.position.y = floor;
  snapshot('Source', false);
  motion.apply(pose, { dt: 0, terrain: ground, travelled: 0, behavior: site.behavior });
  syncIslandLegRigPalette(pose, rig, true, true);
  snapshot('Stand', true);
  const seen = new Set();
  let heading = 0;
  for (let frame = 1; frame <= 460; frame++) {
    const dt = 1 / 60;
    const moving = frame < 322;
    const step = motion.advance(dt, moving, site.speed) * dt;
    heading += frame > 218 && frame <= 318 ? dt * .40 : 0;
    group.rotation.y = initialYaw + heading;
    group.position.x += Math.sin(heading) * step;
    group.position.z += Math.cos(heading) * step;
    group.position.y = ground.heightAt(group.position.x, group.position.z) + floor;
    if (pose.clipDuration('StrideBase')) pose.play(moving ? 'StrideBase' : 'Idle', { fade: .28 });
    pose.update(dt);
    motion.apply(pose, { dt, terrain: ground, travelled: step, behavior: site.behavior });
    syncIslandLegRigPalette(pose, rig, false, true);
    const { contacts } = motion.diagnostics();
    // Six seconds at 20 fps include the continuous stride, turn, and stop.
    if (sequence && frame >= 75 && frame <= 435 && (frame - 75) % 3 === 0) snapshot('Step ' + String(frame).padStart(3, '0'), true);
    const active = contacts.findIndex(contact => !contact.planted);
    if (frame > 55 && frame < 218 && active >= 0) {
      const { swing, side, lane } = contacts[active];
      const name = contacts.length === 2 ? '' : (lane === 0 ? 'Fore ' : 'Hind ');
      const tag = name + (side < 0 ? 'L' : 'R');
      const checkpoints = side < 0 ? [[.20, 'lift'], [.50, 'pass'], [.83, 'land']] : [[.50, 'pass']];
      for (const [at, phase] of checkpoints) {
        const label = `${tag} ${phase}`;
        if (swing < at || seen.has(label)) continue;
        snapshot(label, true);
        seen.add(label);
      }
    }
    if ([249, 301, 460].includes(frame)) snapshot({ 249: 'Turn in', 301: 'Turn out', 460: 'Settle' }[frame], true);
  }
  write('topology', indices);
  writeFileSync(join(directory, id + '.json'), JSON.stringify({ id, count, frames }));
  console.log(id, frames.map(frame => frame.name).join(' | '));
}

for (const id of requested.length ? requested : ISLAND_FAUNA_PLAN.filter(site => site.medium === 'ground').map(site => site.id)) capture(id);
