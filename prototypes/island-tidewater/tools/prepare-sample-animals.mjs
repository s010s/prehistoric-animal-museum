import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mergeMuseumSkins } from '../museum/NativeMuseumSkin.js';

// A source checkout is an explicit input; source files are never modified.
const sourceRoot = process.argv[2];
if (!sourceRoot) throw Error('Usage: node tools/prepare-sample-animals.mjs <museum-source-checkout>');
const out = new URL('../museum/assets/', import.meta.url), notices = new URL('../notices/', import.meta.url);
await Promise.all([mkdir(out, { recursive: true }), mkdir(notices, { recursive: true })]);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Offline measurements use exactly the runtime's LINEAR/STEP pose sampler.
// Suppress GPU upload only inside this asset-processing process; no browser or
// renderer is started. The source/derived geometry and animation stay intact.
for (const name of ['GPUBufferUsage', 'GPUTextureUsage', 'GPUShaderStage', 'GPUMapMode']) globalThis[name] ??= new Proxy({}, { get: () => 1 });
const { parseGLB } = await import('../vendor/tidewater/src/engine/loaders/GLTF.js');
const { StorageBuffer } = await import('../vendor/tidewater/src/engine/gpu/Texture.js');
StorageBuffer.prototype.write = function(data) { this.pendingData = data; };
const { SkinnedModel } = await import('../vendor/tidewater/src/engine/render/Skinning.js');
function measureClips(bytes) {
  const g = mergeMuseumSkins(parseGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))), m = new SkinnedModel(g);
  const clips = [];
  for (const name of m.clipNames()) {
    m.layers = []; m.play(name, { fade: 0 });
    const duration = m.clipDuration(name), frames = [], steps = Math.ceil(duration / .2);
    for (let frame = 0; frame <= steps; frame++) {
      const time = duration * frame / steps;
      m.layers[0].time = time; m.update(0);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const p of g.meshes[0]) {
        const P = p.attributes.POSITION.array, J = p.attributes.JOINTS_0.array, W = p.attributes.WEIGHTS_0.array;
        for (let v = 0; v < P.length / 3; v++) {
          const xyz = [0, 0, 0], total = W[v * 4] + W[v * 4 + 1] + W[v * 4 + 2] + W[v * 4 + 3];
          for (let j = 0; j < 4; j++) {
            const o = J[v * 4 + j] * 16, w = W[v * 4 + j] / total, D = m.jointData;
            for (let r = 0; r < 3; r++) xyz[r] += w * (D[o + r] * P[v * 3] + D[o + 4 + r] * P[v * 3 + 1] + D[o + 8 + r] * P[v * 3 + 2] + D[o + 12 + r]);
          }
          for (let r = 0; r < 3; r++) { min[r] = Math.min(min[r], xyz[r]); max[r] = Math.max(max[r], xyz[r]); }
        }
      }
      frames.push({ time, minY: min[1], maxY: max[1] });
      if (frames.length === 1) clips.push({ name, min, max, frames });
      else for (let r = 0; r < 3; r++) { clips.at(-1).min[r] = Math.min(clips.at(-1).min[r], min[r]); clips.at(-1).max[r] = Math.max(clips.at(-1).max[r], max[r]); }
    }
  }
  return { paletteRows: m.joints, pieces: g.museumPieces, intervalMaxSeconds: .2, clips };
}
const selected = [
  { id: 'lystrosaurus', metres: 1.1, metric: 'body-length', axis: 2, forward: [0, 1], author: 'seth the yutyrannus', source: 'https://sketchfab.com/3d-models/lystrosaurus-32ea6a3bedd948638f9add8da7483b28' },
  { id: 'parasaurolophus', metres: 9.45, metric: 'body-length', axis: 0, forward: [-1, 0], author: 'htqj寒潭秋镜', source: 'https://sketchfab.com/3d-models/parasaurolophus-0f25fa4a55ba48c88adef066161f5e83' },
  { id: 'pteranodon', metres: 7, metric: 'wingspan', axis: 0, forward: [0, 1], author: 'Chistodrako._. / Oscar López Riviello', source: 'https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b' },
  { id: 'ichthyosaur', metres: 5, metric: 'representative-body-length', axis: 0, forward: [-1, 0], author: 'Julian Johnson-Mortimer / FreddyFoxFreddy', source: 'https://sketchfab.com/3d-models/ichthyosaurus-ef8609f5efa84984bc1800bdb36aac3c' },
];
function boundsFor(nodes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const node of nodes) {
    const skin = node.getSkin(), inverse = skin.getInverseBindMatrices().getArray();
    const matrices = skin.listJoints().map((joint, i) => {
      const a = joint.getWorldMatrix(), b = inverse.subarray(i * 16, i * 16 + 16), m = new Float64Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) m[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      return m;
    });
    for (const p of node.getMesh().listPrimitives()) {
      const P = p.getAttribute('POSITION').getArray(), J = p.getAttribute('JOINTS_0').getArray(), W = p.getAttribute('WEIGHTS_0').getArray();
      for (let v = 0; v < P.length / 3; v++) {
        const xyz = [0, 0, 0], total = W[v * 4] + W[v * 4 + 1] + W[v * 4 + 2] + W[v * 4 + 3];
        if (!(total > 0)) throw Error('Unweighted museum vertex');
        for (let j = 0; j < 4; j++) {
          const m = matrices[J[v * 4 + j]], w = W[v * 4 + j] / total;
          if (!m) throw Error('Invalid source joint');
          for (let r = 0; r < 3; r++) xyz[r] += w * (m[r] * P[v * 3] + m[4 + r] * P[v * 3 + 1] + m[8 + r] * P[v * 3 + 2] + m[12 + r]);
        }
        for (let r = 0; r < 3; r++) { min[r] = Math.min(min[r], xyz[r]); max[r] = Math.max(max[r], xyz[r]); }
        vertices++;
      }
    }
  }
  return { min, max, vertices };
}
const animals = [];
for (const spec of selected) {
  const relative = `src/content/animals/${spec.id}/model/model.glb`, original = await readFile(`${sourceRoot}/${relative}`);
  const doc = await io.readBinary(original), r = doc.getRoot();
  const meshNodes = r.listNodes().filter(n => n.getMesh());
  for (const n of meshNodes) {
    if (!n.getSkin()) throw Error(`${spec.id}: rigid piece requires explicit adapter`);
    for (const p of n.getMesh().listPrimitives()) if (p.listTargets().length) throw Error(`${spec.id}: unhandled morph animation`);
  }
  for (const a of r.listAnimations()) for (const s of a.listSamplers()) if (!['LINEAR', 'STEP'].includes(s.getInterpolation())) throw Error(`${spec.id}: unsupported interpolation`);
  await doc.transform(dequantize());
  const bounds = boundsFor(meshNodes), dimensions = bounds.max.map((v, i) => v - bounds.min[i]);
  const metadata = { ...spec, bounds, dimensions, scale: spec.metres / dimensions[spec.axis], originalSha256: hash(original), boundsMethod: 'all source pieces; rest-pose weighted jointWorld * inverseBind, matching native Skinning.js', sourceMeshNodes: meshNodes.length, sourceSkins: r.listSkins().length, clips: r.listAnimations().map(a => ({ name: a.getName(), duration: Math.max(...a.listSamplers().map(s => s.getInput().getArray().at(-1))), channels: a.listChannels().length })) };
  for (const texture of r.listTextures()) texture.setImage(await sharp(texture.getImage()).png().toBuffer()).setMimeType('image/png').setURI(texture.getName().replace(/\W+/g, '-') + '.png');
  doc.disposeExtension('EXT_meshopt_compression'); doc.disposeExtension('EXT_texture_webp');
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc), buffer = Buffer.from(bytes), core = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)));
  if (core.extensionsRequired?.length || core.accessors.some(a => a.sparse) || core.meshes.some(m => m.primitives.some(p => p.targets?.length))) throw Error(`${spec.id}: native loader incompatibility remains`);
  if (core.animations.length !== metadata.clips.length || core.animations.some((a, i) => a.channels.length !== metadata.clips[i].channels)) throw Error(`${spec.id}: animation channels were lost`);
  metadata.animationEnvelope = measureClips(bytes);
  await writeFile(new URL(`sample-${spec.id}.glb`, out), bytes);
  const metadataBytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(new URL(`sample-${spec.id}.json`, out), metadataBytes);
  const license = await readFile(`${sourceRoot}/src/content/animals/${spec.id}/provenance/LICENSES/model-license.txt`);
  await writeFile(new URL(`sample-${spec.id}-license.txt`, notices), license);
  animals.push({ id: spec.id, source: relative, sourceSha256: hash(original), sourceBytes: original.length, sourceRevision: 'dbe71900', derived: `museum/assets/sample-${spec.id}.glb`, sha256: hash(bytes), bytes: bytes.length, metadata: `museum/assets/sample-${spec.id}.json`, metadataSha256: hash(metadataBytes), metadataBytes: metadataBytes.length, license: 'CC-BY-4.0', licenseFile: `notices/sample-${spec.id}-license.txt`, licenseSha256: hash(license), licenseBytes: license.length, author: spec.author, sourceUrl: spec.source, changes: 'Meshopt decoded; quantization removed; images decoded losslessly to PNG; original skeleton, meshes, materials and clip channels retained. Runtime merges palettes and pieces without flattening animation.', geometry: { vertices: bounds.vertices, meshNodes: meshNodes.length, skins: r.listSkins().length }, clips: metadata.clips });
  console.log(`${spec.id}: ${original.length} -> ${bytes.length} bytes, ${meshNodes.length} pieces, ${metadata.clips.map(a => a.name).join('/')}`);
}
await writeFile(new URL('../creek/sample-animals.lock.json', import.meta.url), JSON.stringify({ schema: 'museum-sample-animals-v1', sourceCollection: 'museum mainCollection (36 entries)', sourceRevision: 'dbe71900', conversion: 'tools/prepare-sample-animals.mjs', animals }, null, 2) + '\n');
