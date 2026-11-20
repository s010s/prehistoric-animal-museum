import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { parseGLB } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { prepareReviewedSwimIndices } from '../creek/VaultEnvironmentSwim.js';
import { reviewedFlightGeometry } from '../creek/VaultEnvironmentFlight.js';

const assets = new URL('../creek/assets/', import.meta.url);
const ids = ['ichthyornis', 'sapeornis', 'meganeura', 'juracimbrophlebia', 'stenodictya', 'falcatus', 'cheiracanthus'];

// Preserve membrane/feather outlines, skinning discontinuities and atlas seams
// at distance. Output references original vertices, including all joint weights.
function flightIndices(gltf, id) {
  const geometry = reviewedFlightGeometry(gltf, id);
  const { position, normal, uv, aWing, aFlightBody } = geometry.attributes;
  const width = 13;
  const attributes = new Float32Array(width * position.count);
  for (let i = 0; i < position.count; i++) {
    let cursor = i * width;
    for (const attr of [normal, uv, aWing, aFlightBody]) {
      for (let j = 0; j < attr.itemSize; j++) attributes[cursor++] = attr.array[i * attr.itemSize + j];
    }
  }
  const weights = [.015,.015,.015, .045,.045, .14,.02,.09,.12, .08,.08,.06,.04];
  const original = geometry.index.array;
  return [[.15, .006], [.033, .022]].map(([fraction, error]) => {
    const target = Math.max(240, Math.floor(original.length * fraction / 3) * 3);
    const [indices, achieved] = MeshoptSimplifier.simplifyWithAttributes(original, position.array, 3,
      attributes, width, weights, null, target, error, ['Permissive']);
    if (!indices.length || achieved > error * 1.001) throw Error('Invalid flight LOD for ' + id);
    return indices;
  });
}

export async function prepareFaunaLods() {
  await MeshoptSimplifier.ready;
  await mkdir(new URL('.transport/', assets), { recursive: true });
  for (const id of ids) {
    const input = await readFile(new URL('environment-' + id + '-vault.glb', assets));
    const gltf = parseGLB(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    const fish = id === 'falcatus' || id === 'cheiracanthus';
    const tiers = fish ? prepareReviewedSwimIndices(gltf, id, MeshoptSimplifier) : flightIndices(gltf, id);
    const vertices = gltf.nodes.reduce((sum, node) => node.mesh === undefined ? sum : sum +
      gltf.meshes[node.mesh].reduce((n, p) => n + p.attributes.POSITION.array.length / 3, 0), 0);
    const Index = vertices <= 65535 ? Uint16Array : Uint32Array;
    const lengths = Uint32Array.of(...tiers.map(indices => indices.length));
    const packed = Buffer.concat([Buffer.from(lengths.buffer), ...tiers.map(indices => Buffer.from(Index.from(indices).buffer))]);
    const destination = new URL('.transport/fauna-' + id + '.indices', assets);
    const existing = await readFile(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!existing?.equals(packed)) await writeFile(destination, packed);
  }
}
