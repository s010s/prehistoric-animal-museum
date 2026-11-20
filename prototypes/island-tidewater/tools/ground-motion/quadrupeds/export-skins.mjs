// Materialize the island's displayed neutral mesh, including augmented limbs,
// in Blender coordinates (+X forward, +Y across, +Z up).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { prepareGroundSpecimen } from '../../../museum/PrepareGroundSpecimen.js';
import { createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, parseIslandMuseumModel } from '../../../museum/IslandMuseumModelData.js';
import { museumGroundRigs } from '../../../museum/MuseumGroundRigs.js';
import { Matrix4, Vector3 } from '../../../vendor/tidewater/src/engine/index.js';
import { StorageBuffer } from '../../../vendor/tidewater/src/engine/gpu/Texture.js';

StorageBuffer.prototype.write = () => {};
const root = new URL('../../../museum/', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('island-museum-models.lock.json', root))).animals;
const [directory, ...requested] = process.argv.slice(2);
if (!directory) throw Error('Usage: node export-skins.mjs <directory> [species ...]');
mkdirSync(directory, { recursive: true });

function exportSkin(id) {
  const meta = metadata[id], [fx, fz] = meta.forward;
  const b = gunzipSync(readFileSync(new URL('assets/island/' + id + '.glb.gz', root)));
  const gltf = parseIslandMuseumModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const { pieces, skin } = islandModelPieces(gltf);
  const rig = prepareGroundSpecimen(id, gltf, pieces, skin, meta);
  const pose = createIslandModelPose(gltf, skin);
  pose.play('StrideBase', { fade: 0 });
  pose.update(0);

  const toBlender = ({ x, y, z }) => [fx * x + fz * z, fz * x - fx * z, y];
  const point = new Vector3(), local = new Vector3(), scratch = new Vector3();
  const palette = skin.joints.map((_, i) => new Matrix4().fromArray(pose.jointData, i * 16));
  const nodes = gltf.nodes.map(({ name, children }, i) => ({
    name, children, p: toBlender(point.fromArray(pose.world, i * 16 + 12)),
  }));
  const rigged = museumGroundRigs[id];
  const names = rigged?.legs.map(chain => chain.slice(0, 3))
    ?? rig.chains.map(({ upper, lower, foot }) => [upper, lower, foot].map(i => nodes[i].name));
  const vertices = [], faces = [], weights = [];
  for (const piece of pieces) {
    const { primitive, influences } = piece;
    if (primitive.mode !== 4) continue;
    const positions = floatAttribute(primitive.attributes.POSITION), count = positions.length / 3;
    const morph = islandMorphWeights(piece, pose.layers, new Float32Array(primitive.targets.length));
    const offset = vertices.length;
    for (let v = 0; v < count; v++) {
      local.fromArray(positions, v * 3);
      for (const [m, { position }] of primitive.targets.entries()) if (position && morph[m]) {
        local.addScaledVector(scratch.fromArray(position, v * 3), morph[m]);
      }
      point.set(0, 0, 0);
      const attached = new Map();
      for (const set of influences) for (let k = v * 4; k < v * 4 + 4; k++) {
        if (!set.weights[k]) continue;
        const row = set.joints[k], weight = set.weights[k] / 65535;
        point.addScaledVector(scratch.copy(local).applyMatrix4(palette[row]), weight);
        const joint = skin.joints[row];
        attached.set(joint, (attached.get(joint) ?? 0) + weight);
      }
      vertices.push(toBlender(point).map(n => +n.toFixed(6)));
      weights.push([...attached].map(([i, w]) => [i, +w.toFixed(6)]));
    }
    const indices = primitive.indices;
    for (let i = 0; i < (indices?.length ?? count); i += 3) {
      faces.push([0, 1, 2].map(k => offset + (indices?.[i + k] ?? i + k)));
    }
  }
  const rootName = rigged?.root ?? nodes[rig.root].name;
  writeFileSync(join(directory, id + '.json'), JSON.stringify({ id, nodes, rootName, legs: names, vertices, faces, weights }));
}

for (const id of requested.length ? requested : ['stegosaurus', 'apatosaurus', 'ankylosaurus', 'dimetrodon', 'lystrosaurus',
  'maiasaura', 'parasaurolophus', 'sauropelta', 'regaliceratops', 'triceratops', 'mammoth']) exportSkin(id);
