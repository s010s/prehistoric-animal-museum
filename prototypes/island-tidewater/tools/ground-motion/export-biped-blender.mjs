// Export the exact visible reference skin and the subset of its weighted
// skeleton used for biped authoring. Node and Blender require no GPU.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { bipedAnatomy } from '../../museum/ground-motion/BipedAnatomy.js';
import { prepareBipedBodyRig } from '../../museum/ground-motion/BipedSkin.js';
import { prepareGroundRestingJaws } from '../../museum/ground-motion/GroundRestingJaws.js';
import { prepareMuseumGroundPose } from '../../museum/MuseumGroundPose.js';
import { augmentIslandLegRig } from '../../museum/IslandMuseumLegRig.js';
import { createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, parseIslandMuseumModel } from '../../museum/IslandMuseumModelData.js';
import { Matrix4, Vector3 } from '../../vendor/tidewater/src/engine/index.js';
import { StorageBuffer } from '../../vendor/tidewater/src/engine/gpu/Texture.js';

const directory = process.argv[2];
if (!directory) throw Error('Usage: node tools/ground-motion/export-biped-blender.mjs <temporary-directory>');
mkdirSync(directory, { recursive: true });
const file = path => readFileSync(new URL('../../museum/' + path, import.meta.url));
const meta = JSON.parse(file('island-museum-models.lock.json')).animals;
StorageBuffer.prototype.write = () => {};

for (const [id, anatomy] of Object.entries(bipedAnatomy)) {
  const bytes = gunzipSync(file('assets/island/' + id + '.glb.gz'));
  const model = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  prepareMuseumGroundPose(model, id);
  const { pieces, skin } = islandModelPieces(model);
  const legs = augmentIslandLegRig(id, model, pieces, skin);
  const priorRows = skin.joints.length;
  const priorSets = pieces.map(p => p.influences.length);
  prepareBipedBodyRig(id, model, pieces, skin, legs);
  prepareGroundRestingJaws(id, model, pieces, skin);
  const pose = createIslandModelPose(model, skin);
  pose.play(pose.clipDuration('StrideBase') ? 'StrideBase' : 'Idle', { fade: 0 });
  pose.update(0);
  const controls = [anatomy.chest ?? null, anatomy.neck, anatomy.head, ...anatomy.left, ...anatomy.right, ...anatomy.tail];
  const [fx, fz] = meta[id].forward;
  const canonical = (x, y, z) => [x * fx + z * fz, z * fx - x * fz, y];
  const bones = model.nodes.map((node, i) => ({
    name: node.name, parent: pose.parent[i], pivot: canonical(...pose.world.subarray(i * 16 + 12, i * 16 + 15)),
  }));
  const matrices = skin.joints.map((_, j) => new Matrix4().fromArray(pose.jointData, j * 16));
  const positions = [], indices = [], influences = [], weightCounts = [];
  const p = new Vector3(), point = new Vector3(), d = new Vector3();
  for (const piece of pieces) {
    const { primitive, nodeIndex } = piece;
    const offset = positions.length / 3;
    const raw = floatAttribute(primitive.attributes.POSITION);
    const rigid = new Matrix4().fromArray(pose.world, nodeIndex * 16);
    const morph = islandMorphWeights(piece, pose.layers, new Float32Array(primitive.targets.length));
    for (let i = 0; i < raw.length; i += 3) {
      p.fromArray(raw, i);
      for (const [k, target] of primitive.targets.entries()) if (target.position && morph[k]) {
        p.addScaledVector(d.fromArray(target.position, i), morph[k]);
      }
      point.set(0, 0, 0);
      let count = 0;
      for (const set of piece.influences) for (let k = i / 3 * 4; k < i / 3 * 4 + 4; k++) {
        if (!set.weights[k]) continue;
        point.addScaledVector(d.copy(p).applyMatrix4(matrices[set.joints[k]]), set.weights[k] / 65535);
        influences.push(skin.joints[set.joints[k]], set.weights[k]);
        count++;
      }
      if (!count) {
        point.copy(p).applyMatrix4(rigid);
        influences.push(nodeIndex, 65535);
        count = 1;
      }
      positions.push(...canonical(point.x, point.y, point.z));
      weightCounts.push(count);
    }
    if (primitive.indices) for (const j of primitive.indices) indices.push(offset + j);
    else for (let i = 0; i < raw.length / 3; i++) indices.push(offset + i);
  }
  const save = (name, data) => writeFileSync(join(directory, id + '-' + name + '.bin'), Buffer.from(data.buffer));
  save('positions', Float32Array.from(positions));
  save('indices', Uint32Array.from(indices));
  save('links', Uint16Array.from(influences));
  save('counts', Uint8Array.from(weightCounts));
  writeFileSync(join(directory, id + '.json'), JSON.stringify({ id, bones, controls, anatomy }));
  console.log(id, { vertices: positions.length / 3, paletteRows: skin.joints.length, newRows: skin.joints.length - priorRows, newVertices: pieces.reduce((s,p,i) => s + (p.influences.length - priorSets[i]) * p.primitive.attributes.POSITION.array.length / 3, 0) });
}
