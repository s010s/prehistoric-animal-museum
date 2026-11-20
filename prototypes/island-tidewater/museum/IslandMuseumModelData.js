import { parseGLB } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../vendor/tidewater/src/engine/render/Skinning.js';

export function floatAttribute(attribute) {
  const { array, normalized, componentType } = attribute;
  if (array instanceof Float32Array) return array;
  const range = normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[componentType] : 1;
  return Float32Array.from(array, value => Math.max(-1, value / range));
}

function floatAccessor(json, buffer, binOffset, index) {
  const a = json.accessors[index], bv = json.bufferViews[a.bufferView];
  const itemSize = { SCALAR: 1, VEC3: 3 }[a.type];
  if (a.componentType !== 5126 || a.sparse || !itemSize) throw Error('Invalid island morph accessor');
  const offset = binOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? itemSize * 4;
  const result = new Float32Array(a.count * itemSize);
  const view = new DataView(buffer, offset);
  for (let n = 0; n < a.count; n++) {
    for (let c = 0; c < itemSize; c++) result[n * itemSize + c] = view.getFloat32(n * stride + c * 4, true);
  }
  return result;
}

export function parseIslandMuseumModel(buffer) {
  const model = parseGLB(buffer);
  const json = model.json;
  const binOffset = 28 + new DataView(buffer).getUint32(12, true);
  const read = index => floatAccessor(json, buffer, binOffset, index);
  for (const [meshIndex, mesh] of model.meshes.entries()) {
    for (const [i, primitive] of mesh.entries()) {
      const source = json.meshes[meshIndex].primitives[i];
      primitive.targets = (source.extras?.islandMorphTargets ?? []).map(target => ({
        position: target.POSITION === undefined ? null : read(target.POSITION),
        normal: target.NORMAL === undefined ? null : read(target.NORMAL),
      }));
    }
  }
  for (const [i, clip] of model.animations.entries()) {
    const source = json.animations[i], extra = source.extras?.islandMorph;
    clip.morphChannels = new Map();
    if (!extra) continue;
    // Tidewater shifts TRS keyframes to zero. Morph and TRS must share the same source origin.
    const offset = extra.trsStart === null ? 0 : extra.trsStart - extra.start;
    if (offset) for (const c of clip.channels) c.times = Float32Array.from(c.times, t => t + offset);
    clip.duration = extra.end - extra.start;
    for (const { sampler, target } of extra.channels) {
      const s = source.samplers[sampler];
      const times = read(s.input).map(t => t - extra.start), values = read(s.output);
      clip.morphChannels.set(target.node, { times, values, step: s.interpolation === 'STEP' });
    }
  }
  return model;
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Keep authored skin palettes, normalizing only the joint-row numbering and influence weights. */
export function islandModelPieces(gltf) {
  const joints = [], inverse = [], rows = new Map(), pieces = [];
  const used = new Set();
  function visit(i) {
    if (used.has(i)) return;
    used.add(i);
    for (const child of gltf.nodes[i].children) visit(child);
  }
  for (const i of gltf.roots) visit(i);
  for (const nodeIndex of used) {
    const node = gltf.nodes[nodeIndex];
    if (node.mesh === undefined) continue;
    const skin = node.skin === undefined ? null : gltf.skins[node.skin];
    const palette = skin?.joints.map((joint, i) => {
      const matrix = skin.inverseBindMatrices.subarray(i * 16, i * 16 + 16);
      const key = joint + ':' + matrix.join(',');
      if (!rows.has(key)) {
        rows.set(key, joints.length);
        joints.push(joint);
        inverse.push(...matrix);
      }
      return rows.get(key);
    });
    for (const primitive of gltf.meshes[node.mesh]) {
      const a = primitive.attributes;
      const morphCount = primitive.targets.length;
      const defaultWeights = new Float32Array(morphCount);
      defaultWeights.set(gltf.json.nodes[nodeIndex].weights ?? gltf.json.meshes[node.mesh].weights ?? []);
      const influences = [];
      if (skin) {
        const sets = a.JOINTS_1 ? 2 : 1;
        const vertexCount = a.POSITION.array.length / 3;
        const source = Array.from({ length: sets }, (_, i) => ({
          joints: a['JOINTS_' + i].array,
          weights: floatAttribute(a['WEIGHTS_' + i]),
        }));
        for (let i = 0; i < sets; i++) {
          influences.push({ joints: new Uint16Array(vertexCount * 4), weights: new Uint16Array(vertexCount * 4) });
        }
        for (let v = 0; v < vertexCount; v++) {
          const base = v * 4;
          let total = 0, largest = -1, largestSet = 0, largestComponent = base, quantized = 0;
          for (const s of source) for (let j = base; j < base + 4; j++) total += s.weights[j];
          if (!(total > 0)) throw Error('Island model has a vertex with no skin weights');
          for (let s = 0; s < sets; s++) {
            for (let j = base; j < base + 4; j++) {
              const w = source[s].weights[j];
              const row = w > 0 ? palette[source[s].joints[j]] : 0;
              if (row === undefined || row > 65535) throw Error('Island model skin joint is out of range');
              const normalized = Math.round(w / total * 65535);
              influences[s].joints[j] = row;
              influences[s].weights[j] = normalized;
              quantized += normalized;
              if (w > largest) {
                largest = w;
                largestSet = s;
                largestComponent = j;
              }
            }
          }
          influences[largestSet].weights[largestComponent] += 65535 - quantized;
        }
      }
      pieces.push({ nodeIndex, primitive, influences, defaultWeights });
    }
  }
  if (!pieces.length) throw Error('Island model has no mesh pieces');
  if (!joints.length) {
    // The native pose evaluator also handles animated rigid transforms.
    joints.push(gltf.roots[0]);
    inverse.push(...identity);
  }
  return { pieces, skin: { joints, inverseBindMatrices: Float32Array.from(inverse) } };
}

export function createIslandModelPose(gltf, skin) {
  return new SkinnedModel({ ...gltf, skins: [skin] });
}

export function islandMorphWeights(piece, layers, result) {
  result.fill(0);
  let active = 0;
  for (const layer of layers) {
    const channel = layer.clip.morphChannels.get(piece.nodeIndex);
    if (!channel || layer.weight <= 0) continue;
    const { times, values, step } = channel;
    const count = result.length;
    if (values.length !== times.length * count) throw Error('Invalid island morph channels');
    const time = Math.min(times.at(-1), Math.max(times[0], layer.time));
    let i = 0;
    while (i < times.length - 2 && times[i + 1] <= time) i++;
    if (step && time === times.at(-1)) i = times.length - 1;
    const next = Math.min(i + 1, times.length - 1);
    const blend = step || next === i ? 0 : (time - times[i]) / (times[next] - times[i]);
    for (let j = 0; j < count; j++) {
      result[j] += layer.weight * (values[i * count + j] * (1 - blend) + values[next * count + j] * blend);
    }
    active += layer.weight;
  }
  for (let j = 0; j < result.length; j++) result[j] += (1 - active) * piece.defaultWeights[j];
  return result;
}

export const museumTextureUsages = {
  albedo: material => material.pbrMetallicRoughness?.baseColorTexture,
  normal: material => material.normalTexture,
  orm: material => material.pbrMetallicRoughness?.metallicRoughnessTexture,
  occlusion: material => material.occlusionTexture,
  emissive: material => material.emissiveTexture,
  specular: material => material.extensions?.KHR_materials_specular?.specularTexture,
  specularColor: material => material.extensions?.KHR_materials_specular?.specularColorTexture,
};

export const museumSrgbTextures = new Set(['albedo', 'emissive', 'specularColor']);
