import { BufferAttribute, BufferGeometry } from '../vendor/tidewater/src/engine/index.js';

const paths = {
  falcatus: new URL('./assets/.transport/fauna-falcatus.indices', import.meta.url),
  cheiracanthus: new URL('./assets/.transport/fauna-cheiracanthus.indices', import.meta.url),
  ichthyornis: new URL('./assets/.transport/fauna-ichthyornis.indices', import.meta.url),
  sapeornis: new URL('./assets/.transport/fauna-sapeornis.indices', import.meta.url),
  meganeura: new URL('./assets/.transport/fauna-meganeura.indices', import.meta.url),
  stenodictya: new URL('./assets/.transport/fauna-stenodictya.indices', import.meta.url),
  juracimbrophlebia: new URL('./assets/.transport/fauna-juracimbrophlebia.indices', import.meta.url),
};

export async function loadReviewedIndices(kind, signal) {
  if (globalThis.__assetFile) {
    const bytes = await globalThis.__assetFile(paths[kind].href);
    signal?.throwIfAborted();
    return bytes;
  }
  const response = await fetch(paths[kind], { signal });
  if (!response.ok) throw Error('Cannot load fauna silhouettes for ' + kind);
  return response.arrayBuffer();
}

export function reviewedGeometryLods(geometry, bytes) {
  const count = geometry.attributes.position.count;
  const Index = count <= 65535 ? Uint16Array : Uint32Array;
  const lengths = new Uint32Array(bytes, 0, 2);
  const source = new Index(bytes, 8);
  if (source.length !== lengths[0] + lengths[1]) throw Error('Incomplete fauna silhouette indices');
  let start = 0;
  return [geometry, ...Array.from(lengths, length => {
    const remap = new Map();
    const indices = new Index(length);
    for (let i = 0; i < length; i++) {
      const original = source[start + i];
      if (original >= count) throw Error('Fauna silhouette exceeds original geometry');
      if (!remap.has(original)) remap.set(original, remap.size);
      indices[i] = remap.get(original);
    }
    start += length;
    const reduced = new BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      const data = new attr.array.constructor(remap.size * attr.itemSize);
      for (const [original, dest] of remap) {
        for (let j = 0; j < attr.itemSize; j++) data[dest * attr.itemSize + j] = attr.array[original * attr.itemSize + j];
      }
      reduced.setAttribute(name, new BufferAttribute(data, attr.itemSize, attr.normalized));
    }
    reduced.setIndex(new BufferAttribute(indices, 1));
    return reduced;
  })];
}
