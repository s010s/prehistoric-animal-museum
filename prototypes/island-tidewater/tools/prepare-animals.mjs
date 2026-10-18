import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, getBounds, prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const out = new URL('../museum/assets/', import.meta.url);
await mkdir(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function nativeSkinBounds(skin, primitive) {
  // Native Skinning.js deliberately ignores the skinned mesh node's transform.
  // getBounds(scene) only sees that node + raw positions; it is not a posed bound.
  const inverse = skin.getInverseBindMatrices().getArray();
  const matrices = skin.listJoints().map((joint, i) => {
    const a = joint.getWorldMatrix(), b = inverse.subarray(i * 16, i * 16 + 16), m = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) m[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return m;
  });
  const position = primitive.getAttribute('POSITION').getArray(), joints = primitive.getAttribute('JOINTS_0').getArray(), weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length / 3; i++) {
    const xyz = [0, 0, 0], total = weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3];
    if (!(total > 0)) throw Error('Skinned vertex has no weights');
    for (let k = 0; k < 4; k++) {
      const m = matrices[joints[i * 4 + k]], w = weights[i * 4 + k] / total;
      if (!m) throw Error('Joint index is out of range');
      for (let r = 0; r < 3; r++) xyz[r] += w * (m[r] * position[i * 3] + m[4 + r] * position[i * 3 + 1] + m[8 + r] * position[i * 3 + 2] + m[12 + r]);
    }
    for (let r = 0; r < 3; r++) { min[r] = Math.min(min[r], xyz[r]); max[r] = Math.max(max[r], xyz[r]); }
  }
  return { min, max };
}
const reports = [];
for (const [id, metres] of [['apatosaurus', 22], ['triceratops', 8.5]]) {
  const original = await readFile(new URL(`src/content/animals/${id}/model/model.glb`, root));
  const json = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)));
  const doc = await io.readBinary(original);
  const r = doc.getRoot();
  const meshNodes = r.listNodes().filter(n => n.getMesh());
  if (meshNodes.length !== 1 || meshNodes[0].getMesh().listPrimitives().length !== 1) throw Error(`${id}: unsupported multiple meshes/primitives`);
  if (r.listSkins().length !== (id === 'triceratops' ? 1 : 0)) throw Error(`${id}: unexpected skin count`);
  for (const a of r.listAnimations()) for (const s of a.listSamplers()) if (s.getInterpolation() !== 'LINEAR') throw Error(`${id}: interpolation requires separate validation`);
  for (const m of r.listMaterials()) if (m.getAlphaMode() !== 'OPAQUE') throw Error(`${id}: non-opaque material needs explicit support`);
  await doc.transform(dequantize());
  const node = meshNodes[0], primitive = node.getMesh().listPrimitives()[0];
  const bounds = id === 'triceratops' ? nativeSkinBounds(r.listSkins()[0], primitive) : getBounds(r.listScenes()[0]);
  const dimensions = bounds.max.map((v, i) => v - bounds.min[i]);
  const scale = metres / Math.max(dimensions[0], dimensions[2]);
  const derived = { id, metres, bounds, boundsMethod: id === 'triceratops' ? 'rest-pose weighted jointWorld * inverseBind, matching native SkinnedModel' : 'scene/node transform of original base morph geometry', dimensions, scale, originalSha256: hash(original), node: { translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale() } };
  if (id === 'apatosaurus') {
    const targets = primitive.listTargets();
    const animation = r.listAnimations()[0];
    const channels = animation.listChannels();
    if (targets.length !== 2 || channels.length !== 1 || channels[0].getTargetPath() !== 'weights') throw Error('apatosaurus: expected two animated morph targets');
    const sampler = channels[0].getSampler();
    const times = Array.from(sampler.getInput().getArray());
    const weights = Array.from(sampler.getOutput().getArray());
    if (weights.length !== times.length * 2) throw Error('morph weight layout mismatch');
    const chunks = [], attributes = {};
    let offset = 0;
    for (let i = 0; i < 2; i++) for (const semantic of ['POSITION', 'NORMAL']) {
      const data = targets[i].getAttribute(semantic).getArray();
      if (!(data instanceof Float32Array) || data.length !== primitive.getAttribute('POSITION').getArray().length) throw Error('morph float/vertex layout mismatch');
      const name = `${semantic === 'POSITION' ? 'morphPos' : 'morphNorm'}${i}`;
      attributes[name] = { byteOffset: offset, count: data.length, itemSize: 3 };
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      chunks.push(bytes); offset += bytes.length;
    }
    const binary = Buffer.concat(chunks);
    await writeFile(new URL(`${id}-morph.bin`, out), binary);
    derived.morph = { name: animation.getName(), interpolation: 'LINEAR', times, weights, duration: times.at(-1) - times[0], attributes, bytes: binary.length, sha256: hash(binary) };
    for (const target of [...targets]) { primitive.removeTarget(target); target.dispose(); }
    for (const a of r.listAnimations()) a.dispose();
    node.getMesh().setWeights([]);
  }
  // Decode compressed buffers and quantized attributes, preserving geometry and
  // animation. PNG retains decoded WebP pixels without adding another lossy step.
  for (const texture of r.listTextures()) {
    const image = texture.getImage();
    texture.setImage(await sharp(image).png().toBuffer()).setMimeType('image/png');
    texture.setURI(texture.getName().replace(/\W+/g, '-') + '.png');
  }
  doc.disposeExtension('EXT_meshopt_compression');
  doc.disposeExtension('EXT_texture_webp');
  await doc.transform(prune());
  const bytes = await io.writeBinary(doc);
  const core = JSON.parse(Buffer.from(bytes).subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)));
  if (core.extensionsRequired?.length || core.accessors.some(a => a.sparse)) throw Error('native loader incompatibility remains');
  if (id === 'triceratops' && (core.skins.length !== 1 || core.animations[0].channels.length !== 4)) throw Error('skin animation was lost');
  if (core.meshes.some(m => m.primitives.some(p => p.targets?.length))) throw Error('unhandled native morph remained');
  await writeFile(new URL(`${id}.glb`, out), bytes);
  await writeFile(new URL(`${id}.json`, out), JSON.stringify(derived, null, 2));
  reports.push({ ...derived, source: `src/content/animals/${id}/model/model.glb`, sourceBytes: original.length, sourceRequired: json.extensionsRequired, derivedBytes: bytes.length, derivedSha256: hash(bytes), derivedRequired: core.extensionsRequired ?? [], animations: core.animations?.map(a => a.name) ?? [], morphAnimation: derived.morph ? 'sidecar native material vertex deformation, current and previous' : null, licensing: 'Museum source attribution remains in upstream/asset notices; original preserved.' });
}
await writeFile(new URL('conversion.json', out), JSON.stringify({ schema: 'museum-native-animals-v1', tool: '@gltf-transform/core/functions 4.5.0, meshoptimizer, sharp', changes: 'Meshopt decoded, vertex attributes dequantized, WebP decoded losslessly to PNG. Apatosaurus morph data moved to native adapter sidecar; no animation flattened.', animals: reports }, null, 2));
console.log(JSON.stringify(reports.map(r => ({ id: r.id, sourceBytes: r.sourceBytes, derivedBytes: r.derivedBytes, morphBytes: r.morph?.bytes ?? 0, scale: r.scale }))));
