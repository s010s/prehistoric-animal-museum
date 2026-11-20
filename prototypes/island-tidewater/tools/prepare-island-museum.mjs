import { articulateSarcosuchus } from './articulate-sarcosuchus.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, prune, simplify } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { parseIslandMuseumModel, createIslandModelPose, islandModelPieces, islandMorphWeights, museumTextureUsages, museumSrgbTextures } from '../museum/IslandMuseumModelData.js';
import { StorageBuffer } from '../vendor/tidewater/src/engine/gpu/Texture.js';

const root = new URL('../', import.meta.url);
const revision = execFileSync('git', ['rev-parse', process.argv[2] ?? 'origin/main'], { encoding: 'utf8' }).trim();
const git = path => execFileSync('git', ['show', revision + ':' + path], { maxBuffer: 64 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = path => git(path).toString('utf8');
const catalog = utf8('src/content/collections/main.ts').match(/animalIds:\s*\[([^\]]*)\]/)[1];
const ids = [...catalog.matchAll(/'([\w-]+)'/g)].map(m => m[1]);
const calibration = JSON.parse(await readFile(new URL('./island-museum-calibration.json', import.meta.url), 'utf8'));
const comparisons = JSON.parse(utf8('src/scale-encounter/canonical-comparison-metadata.json'));
const scaleSource = utf8('src/viewer/scale-encounter.ts');
const previousScale = Object.fromEntries([...scaleSource.matchAll(/\bid:\s*'([\w-]+)'[\s\S]*?displayedMeters:\s*([\d.]+),[\s\S]*?measurementAxis:\s*'([xyz])'/g)].map(([, id, metres, axis]) => [id, { metres: +metres, axis }]));
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// The offline validator runs the unchanged native pose evaluator without allocating a GPU.
StorageBuffer.prototype.write = function (data) { this.pendingData = data; };

const modelDir = new URL('museum/assets/island/', root);
await mkdir(modelDir, { recursive: true });
const lock = { schema: 'museum-island-models-v1', revision, referencePose: 'Idle at 0 seconds', envelopeSampleIntervalSeconds: .24, ids, animals: {} };
const credits = ['# 岛屿馆藏模型署名', '', '本岛馆藏转换版沿用 CC BY 4.0。原始模型链接、作者与既有修改记录逐项列在下方。岛屿版重新打包动画与几何、调整贴图分辨率并转 WebP。风神翼龙网格另做适度简化。', '', '[CC BY 4.0 许可](https://creativecommons.org/licenses/by/4.0/)。', ''];

const numberField = (source, key) => Number(source.match(new RegExp('["\']?' + key + '["\']?\\s*:\\s*([\\d._]+)'))?.[1].replaceAll('_', ''));
function stringField(source, key) {
  const match = source.match(new RegExp('["\']?' + key + '["\']?\\s*:\\s*(["\'])(.*?)\\1'));
  if (!match) throw Error('Missing source field ' + key);
  return match[2];
}

function readJson(bytes) {
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

function islandGlb(bytes, dimensions, animationTiming) {
  const input = Buffer.from(bytes), json = readJson(input);
  const binStart = 20 + input.readUInt32LE(12);
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    if (!p.targets?.length) continue;
    p.extras = { ...p.extras, islandMorphTargets: p.targets };
    delete p.targets;
  }
  for (const animation of json.animations) {
    const weights = animation.channels.filter(c => c.target.path === 'weights');
    if (!weights.length) continue;
    animation.extras = { ...animation.extras, islandMorph: { ...animationTiming.get(animation.name), channels: weights } };
    animation.channels = animation.channels.filter(c => c.target.path !== 'weights');
  }
  for (const texture of json.textures) {
    // Stream the converted WebP bytes into native ImageBitmap, without a fallback copy.
    texture.source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    delete texture.extensions?.EXT_texture_webp;
    const image = json.images[texture.source], view = json.bufferViews[image.bufferView];
    const start = binStart + 8 + (view.byteOffset ?? 0);
    image.extras = { islandSize: dimensions.get(hash(input.subarray(start, start + view.byteLength))) };
    if (!image.extras.islandSize) throw Error('Converted texture dimensions were lost');
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(name => name !== 'EXT_texture_webp');
  json.extensionsRequired = (json.extensionsRequired ?? []).filter(name => name !== 'EXT_texture_webp');
  if (json.extensionsRequired.length || json.accessors.some(a => a.sparse)) throw Error('Unsupported required island model extension');
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, ' ')]);
  const bin = input.subarray(binStart);
  const header = Buffer.from(input.subarray(0, 20));
  header.writeUInt32LE(header.length + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, bin]);
}

function emptyBounds() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function include(dst, src) {
  for (let i = 0; i < 3; i++) {
    dst.min[i] = Math.min(dst.min[i], src.min[i]);
    dst.max[i] = Math.max(dst.max[i], src.max[i]);
  }
}
function rounded(bounds) {
  return Object.fromEntries(Object.entries(bounds).map(([key, xyz]) => [key, xyz.map(value => +value.toPrecision(9))]));
}

function modelPoints(pieces, pose, callback) {
  for (const piece of pieces) {
    const { primitive, influences, nodeIndex } = piece;
    const position = primitive.attributes.POSITION.array;
    const weights = islandMorphWeights(piece, pose.layers, new Float32Array(primitive.targets.length));
    const rigid = pose.world, rigidBase = nodeIndex * 16, skin = pose.jointData;
    for (let i = 0, v = 0; i < position.length; i += 3, v++) {
      let x = position[i], y = position[i + 1], z = position[i + 2];
      for (let t = 0; t < weights.length; t++) {
        const delta = primitive.targets[t].position;
        if (!delta) continue;
        x += delta[i] * weights[t]; y += delta[i + 1] * weights[t]; z += delta[i + 2] * weights[t];
      }
      let px = 0, py = 0, pz = 0;
      if (influences.length) {
        for (const f of influences) for (let j = v * 4; j < v * 4 + 4; j++) {
          const w = f.weights[j] / 65535, m = f.joints[j] * 16;
          if (!w) continue;
          px += w * (skin[m] * x + skin[m + 4] * y + skin[m + 8] * z + skin[m + 12]);
          py += w * (skin[m + 1] * x + skin[m + 5] * y + skin[m + 9] * z + skin[m + 13]);
          pz += w * (skin[m + 2] * x + skin[m + 6] * y + skin[m + 10] * z + skin[m + 14]);
        }
      } else {
        const m = rigidBase;
        px = rigid[m] * x + rigid[m + 4] * y + rigid[m + 8] * z + rigid[m + 12];
        py = rigid[m + 1] * x + rigid[m + 5] * y + rigid[m + 9] * z + rigid[m + 13];
        pz = rigid[m + 2] * x + rigid[m + 6] * y + rigid[m + 10] * z + rigid[m + 14];
      }
      callback(px, py, pz, piece);
    }
  }
}

function measurePose(pieces, pose, axis) {
  const bounds = emptyBounds();
  let start = Infinity, end = -Infinity;
  modelPoints(pieces, pose, (x, y, z) => {
    bounds.min[0] = Math.min(bounds.min[0], x); bounds.max[0] = Math.max(bounds.max[0], x);
    bounds.min[1] = Math.min(bounds.min[1], y); bounds.max[1] = Math.max(bounds.max[1], y);
    bounds.min[2] = Math.min(bounds.min[2], z); bounds.max[2] = Math.max(bounds.max[2], z);
    const v = x * axis[0] + y * axis[1] + z * axis[2];
    start = Math.min(start, v); end = Math.max(end, v);
  });
  if (![...bounds.min, ...bounds.max, start, end].every(Number.isFinite)) throw Error('Invalid posed island bounds');
  return { bounds, span: end - start };
}

function textureGpuBytes(gltf) {
  const unique = new Set();
  let bytes = 0;
  for (const material of gltf.materials) for (const [role, get] of Object.entries(museumTextureUsages)) {
    const info = get(material);
    if (!info) continue;
    const image = gltf.textures[info.index].source;
    const key = image + ':' + museumSrgbTextures.has(role);
    if (unique.has(key)) continue;
    unique.add(key);
    let [width, height] = gltf.json.images[image].extras.islandSize;
    for (;;) {
      bytes += width * height * 4;
      if (width === 1 && height === 1) break;
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);
    }
  }
  return bytes;
}

function modelGeometryBytes(pieces, skin) {
  let bytes = skin.joints.length * 128, triangles = 0, vertices = 0;
  for (const { primitive, influences } of pieces) {
    const a = primitive.attributes;
    const count = a.POSITION.array.length / 3;
    vertices += count;
    triangles += (primitive.indices?.length ?? count) / 3;
    const indexBytes = primitive.indices ? primitive.indices.length * (primitive.indices instanceof Uint32Array ? 4 : 2) : 0;
    bytes += (a.NORMAL ? 24 : 12) * count + indexBytes;
    for (const [name, attribute] of Object.entries(a)) {
      if (name.startsWith('TEXCOORD_') || name === 'COLOR_0' || name === 'TANGENT') bytes += attribute.array.length * 4;
    }
    bytes += influences.length * count * 16;
    bytes += primitive.targets.length * count * 6 * 4;
  }
  return { bytes, triangles, vertices, paletteRows: skin.joints.length };
}

for (const id of ids) {
  const prefix = 'src/content/animals/' + id + '/';
  const source = prefix + 'model/model.glb', original = git(source);
  const en = utf8(prefix + 'content.en.ts'), zh = utf8(prefix + 'content.zh-CN.ts'), pkg = utf8(prefix + 'package.ts');
  if (stringField(pkg.slice(pkg.indexOf('export const animalDefinition')), 'status') !== 'published') throw Error(id + ' is not published in the source collection');
  const size = en.match(/["']?size["']?\s*:\s*\{([^}]+)\}/)[1];
  const metric = stringField(size, 'kind'), habitat = stringField(pkg, 'habitat');
  const selected = calibration[id];
  if (!selected?.forward) throw Error(id + ' requires an anatomical facing direction');
  const compare = comparisons[id];
  const metres = selected.metres ?? previousScale[id]?.metres ?? compare?.meters ?? (numberField(size, 'minMeters') + numberField(size, 'maxMeters')) / 2;
  if (!(metres > 0)) throw Error(id + ' has no representative metric');
  const provenance = utf8(prefix + 'provenance.ts');
  const declaration = provenance.search(/["']?model["']?\s*:\s*\{|["']?assetPath["']?\s*:\s*["']model\/model\.glb["']/);
  if (declaration < 0) throw Error(id + ' is missing model provenance');
  const modelProvenance = provenance.slice(declaration);
  const sourceAuthor = stringField(modelProvenance, 'author'), sourceTitle = stringField(modelProvenance, 'title');
  const sourceUrl = stringField(modelProvenance, 'url');
  const licenseFile = git(prefix + 'provenance/LICENSES/model-license.txt');
  if (!/CC BY 4\.0|CC-BY-4\.0|creativecommons.org\/licenses\/by\/4.0/.test(licenseFile.toString('utf8'))) throw Error(id + ' needs separate license review');
  const sourceRecord = git(prefix + 'provenance/LICENSES/model-source.txt');
  const doc = await io.readBinary(original), gltfRoot = doc.getRoot();
  await doc.transform(dequantize());
  if (id === 'sarcosuchus') articulateSarcosuchus(doc);
  const sourceChannelCount = new Map(), animationTiming = new Map();
  for (const animation of gltfRoot.listAnimations()) {
    let start = Infinity, end = -Infinity, trsStart = Infinity;
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      if (!['LINEAR', 'STEP'].includes(sampler.getInterpolation())) throw Error(id + ' has an unsupported sampler');
      const times = sampler.getInput().getArray();
      start = Math.min(start, times[0]);
      end = Math.max(end, times.at(-1));
      if (channel.getTargetPath() !== 'weights') trsStart = Math.min(trsStart, times[0]);
    }
    animationTiming.set(animation.getName(), { start, end, trsStart: Number.isFinite(trsStart) ? trsStart : null });
    sourceChannelCount.set(animation.getName(), animation.listChannels().length);
  }
  if (id === 'quetzalcoatlus') {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: .28, error: .004, lockBorder: true }));
  }
  const materialFaces = new Map();
  for (const mesh of gltfRoot.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (primitive.getMode() !== 4) throw Error(id + ' has non-triangle primitives');
    primitive.setAttribute('COLOR_1', null);
    const material = primitive.getMaterial();
    if (!material?.getNormalTexture()) primitive.setAttribute('TANGENT', null);
    const corners = (primitive.getIndices() ?? primitive.getAttribute('POSITION')).getCount();
    materialFaces.set(material, (materialFaces.get(material) ?? 0) + corners);
    const usedUVs = new Set(material ? [
      material.getBaseColorTextureInfo(), material.getNormalTextureInfo(),
      material.getMetallicRoughnessTextureInfo(), material.getOcclusionTextureInfo(), material.getEmissiveTextureInfo(),
      material.getExtension('KHR_materials_specular')?.getSpecularTextureInfo(),
      material.getExtension('KHR_materials_specular')?.getSpecularColorTextureInfo(),
    ].filter(Boolean).map(info => 'TEXCOORD_' + info.getTexCoord()) : []);
    for (const semantic of primitive.listSemantics()) {
      if (semantic.startsWith('TEXCOORD_') && !usedUVs.has(semantic)) primitive.setAttribute(semantic, null);
    }
  }
  doc.disposeExtension('EXT_meshopt_compression');
  doc.disposeExtension('EXT_texture_webp');
  await doc.transform(prune({ keepAttributes: true }));
  for (const accessor of gltfRoot.listAccessors()) accessor.setSparse(false);
  doc.createExtension(ALL_EXTENSIONS.find(ext => ext.EXTENSION_NAME === 'EXT_texture_webp')).setRequired(true);
  const dimensions = new Map();
  // Spend at most two 1K maps per species on the dominant textured surface.
  // An eye, specular mask or incidental material keeps the cheaper 512 cap.
  const primary = [...materialFaces].filter(([m]) => m?.getBaseColorTexture()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const closeDetail = new Set([primary?.getBaseColorTexture(), primary?.getNormalTexture()]);
  for (const texture of gltfRoot.listTextures()) {
    const originalImage = texture.getImage();
    const cap = closeDetail.has(texture) ? 1024 : 512;
    const metadata = await sharp(originalImage).metadata();
    const { data, info } = closeDetail.has(texture) && metadata.format === 'webp' && Math.max(metadata.width, metadata.height) <= cap
      ? { data: originalImage, info: metadata }
      : await sharp(originalImage).resize(cap, cap, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: closeDetail.has(texture) ? 93 : 88, alphaQuality: 100, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    texture.setImage(data).setMimeType('image/webp').setURI(texture.getName().replace(/[^\w]+/g, '-') + '.webp');
    dimensions.set(hash(data), [info.width, info.height]);
  }
  const unpacked = islandGlb(await io.writeBinary(doc), dimensions, animationTiming);
  const gltf = parseIslandMuseumModel(Uint8Array.from(unpacked).buffer);
  const { pieces, skin } = islandModelPieces(gltf);
  const pose = createIslandModelPose(gltf, skin);

  // Several canonical bind poses are authored in the rig's modelling axes.
  // Exhibit bodies, terrain contact and physical size use the visible Idle pose.
  pose.play('Idle', { loop: false, fade: 0 });
  pose.update(0);
  const initial = measurePose(pieces, pose, [1, 0, 0]).bounds;
  const rawDimensions = initial.max.map((value, i) => value - initial.min[i]);
  const forward = selected.forward;
  const axis = selected.axis ?? (metric === 'wingspan' ? [forward[1], 0, -forward[0]]
    : ['standing-height', 'shoulder-height'].includes(metric) ? [0, 1, 0]
      : [forward[0], 0, forward[1]]);
  const measured = measurePose(pieces, pose, axis);
  let scaleSpan = measured.span;
  const animated = { min: [...initial.min], max: [...initial.max] };
  const clips = [];
  for (const clip of gltf.animations) {
    const channels = clip.channels.length + clip.morphChannels.size;
    if (channels !== sourceChannelCount.get(clip.name)) throw Error(id + ' lost authored clip channels');
    const steps = Math.max(1, Math.ceil(clip.duration / .24));
    const bounds = emptyBounds();
    pose.layers.length = 0;
    const layer = pose.play(clip.name, { loop: false, fade: 0 });
    for (let frame = 0; frame <= steps; frame++) {
      layer.time = clip.duration * frame / steps;
      pose.update(0);
      const current = measurePose(pieces, pose, axis);
      include(bounds, current.bounds);
      if (metric === 'wingspan' && clip.name === 'Idle') scaleSpan = Math.max(scaleSpan, current.span);
    }
    include(animated, bounds);
    clips.push({ name: clip.name, duration: +clip.duration.toFixed(6), channels, bounds: rounded(bounds) });
  }
  const geometry = modelGeometryBytes(pieces, skin);
  const textureBytes = textureGpuBytes(gltf);
  const bytes = gzipSync(unpacked, { level: 9 });
  const path = 'museum/assets/island/' + id + '.glb.gz';
  await writeFile(new URL(path, root), bytes);
  lock.animals[id] = {
    id, name: stringField(zh, 'name'), englishName: stringField(en, 'name'), habitat, metric, metres, forward, axis,
    bounds: rounded(initial), animatedBounds: rounded(animated), dimensions: rawDimensions.map(value => +value.toPrecision(9)),
    scale: +(metres / scaleSpan).toPrecision(12), clips,
    geometry, textureBytes, gpuBytes: geometry.bytes + textureBytes, bytes: bytes.length, unpackedBytes: unpacked.length,
    path, sha256: hash(bytes), source, sourceSha256: hash(original), sourceBytes: original.length,
    attribution: { author: sourceAuthor, title: sourceTitle, url: sourceUrl, license: 'CC-BY-4.0', licenseSha256: hash(licenseFile), sourceRecordSha256: hash(sourceRecord) },
  };
  credits.push('## ' + lock.animals[id].name + ' · ' + lock.animals[id].englishName, '', '[' + sourceTitle + '](' + sourceUrl + ') · ' + sourceAuthor + ' · CC BY 4.0', '', '<details>', '<summary>来源与既有修改记录</summary>', '', sourceRecord.toString('utf8').trim(), '', '</details>', '');
  console.log(id + ': ' + original.length + ' → ' + bytes.length + ' bytes, ' + geometry.triangles + ' triangles, ' + Math.round(lock.animals[id].gpuBytes / 1024) + ' KiB GPU, ' + clips.map(c => c.name + ' (' + c.channels + ')').join(', '));
}
const creditBytes = Buffer.from(credits.join('\n'));
lock.credits = { path: 'notices/island-museum-models.md', bytes: creditBytes.length, sha256: hash(creditBytes) };
await writeFile(new URL(lock.credits.path, root), creditBytes);
await writeFile(new URL('museum/island-museum-models.lock.json', root), JSON.stringify(lock, null, 2) + '\n');
