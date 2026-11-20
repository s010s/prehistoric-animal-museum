// Inspect the native visitor's vertex layouts with its compressed models
// and augmented skins. Use --all to include non-land specimens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { ISLAND_FAUNA_PLAN } from '../creek/IslandFaunaPlan.js';
import { applyIslandAquaticMotion, loadIslandAquaticClips } from '../museum/IslandAquaticMotion.js';
import { applyIslandFlightMotion, loadIslandFlightClip } from '../museum/IslandFlightMotion.js';
import { augmentIslandMediumRig } from '../museum/IslandMuseumMediumRig.js';
import { islandModelPieces, museumTextureUsages, parseIslandMuseumModel } from '../museum/IslandMuseumModelData.js';
import { makeGeometry, makeVertex } from '../museum/IslandMuseumVertex.js';
import { prepareGroundSpecimen } from '../museum/PrepareGroundSpecimen.js';
import { MeshRenderer } from '../vendor/tidewater/src/engine/render/MeshRenderer.js';

const lock = JSON.parse(readFileSync(new URL('../museum/island-museum-models.lock.json', import.meta.url))).animals;
const renderer = new MeshRenderer();
const report = [];
const all = process.argv.includes('--all');
for (const { id } of ISLAND_FAUNA_PLAN.filter(site => all || site.medium === 'ground')) {
  const bytes = gunzipSync(readFileSync(new URL('../museum/assets/island/' + id + '.glb.gz', import.meta.url)));
  const gltf = parseIslandMuseumModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const [aquatic, flight] = await Promise.all([loadIslandAquaticClips(id), loadIslandFlightClip(id)]);
  if (aquatic) applyIslandAquaticMotion(gltf, aquatic.default);
  if (flight) applyIslandFlightMotion(gltf, id, flight.default);
  const { pieces, skin } = islandModelPieces(gltf);
  prepareGroundSpecimen(id, gltf, pieces, skin, lock[id]);
  augmentIslandMediumRig(id, gltf, pieces, skin, lock[id]);
  const draws = pieces.map(piece => {
    const { primitive, influences, groundMorphMask } = piece;
    const geometry = makeGeometry(piece);
    const source = gltf.materials[primitive.material] ?? {};
    const uvChannels = new Set(Object.values(museumTextureUsages).flatMap(get => {
      const info = get(source);
      return info ? [info.texCoord ?? 0] : [];
    }));
    const morph = primitive.targets.length ? { vertex: '', groundMorph: !!groundMorphMask } : null;
    const { attributes } = makeVertex({ joints: skin.joints.length }, piece, morph, uvChannels);
    const material = { attributes, vertexColors: !!primitive.attributes.COLOR_0 };
    const { buffers, layout } = renderer._layout({}, geometry, material);
    const label = id + '/' + (source.name ?? piece.nodeIndex);
    assert(buffers.length <= 8 && layout.length <= 16, label + ' exceeds baseline WebGPU limits');
    const skinLayout = buffers.filter(({ src }) => src === geometry.attributes.museumSkin0?.data);
    assert.equal(skinLayout.length, Number(influences.length > 0), label + ' should use one slot for its complete skin');
    if (influences.length) assert.equal(skinLayout[0].layout.arrayStride, influences.length * 16, label);
    for (const [i, { joints, weights }] of influences.entries()) {
      const attribute = geometry.attributes['museumSkin' + i];
      assert.equal(skinLayout[0].layout.attributes[i].format, 'uint32x4', label);
      assert.equal(skinLayout[0].layout.attributes[i].offset, i * 16, label);
      for (let vertex = 0; vertex < attribute.count; vertex++) {
        const offset = vertex * attribute.data.stride + attribute.offset;
        for (let k = 0; k < 4; k++) {
          const word = attribute.data.array[offset + k];
          const input = vertex * 4 + k;
          if ((word & 65535) !== joints[input] || (word >>> 16) !== weights[input]) {
            throw Error(label + ' lost a packed bone index or weight');
          }
        }
      }
    }
    return { buffers: buffers.length, attributes: layout.length };
  });
  report.push({
    specimen: id,
    draws: draws.length,
    buffersPerDraw: draws.map(draw => draw.buffers).join(', '),
    maxBuffers: Math.max(...draws.map(draw => draw.buffers)),
    maxAttributes: Math.max(...draws.map(draw => draw.attributes)),
  });
}
console.table(report);
