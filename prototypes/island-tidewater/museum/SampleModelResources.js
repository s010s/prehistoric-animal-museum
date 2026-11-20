import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { BufferAttribute, BufferGeometry, Mesh } from '../vendor/tidewater/src/engine/index.js';
import { Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { decodeImage, loadGLB, parseGLB } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { SkinnedModel, skinnedMaterial } from '../vendor/tidewater/src/engine/render/Skinning.js';

export async function loadSampleGLB(url, signal) {
  if (!signal || globalThis.__assetFile) return loadGLB(url);
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`GLB: ${url} ${response.status}`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  return parseGLB(buffer);
}

// Each acquisition owns its decoded textures. Mipmap work uses a local
// encoder so a paused render loop or an aborted fetch cannot retain them.
export async function withSampleTextures(gltf, label, signal, prepare) {
  const textures = new Map();
  const encoder = GPU.device.createCommandEncoder({ label });
  const texture = async (info, srgb) => {
    if (!info) return null;
    const index = gltf.textures[info.index].source;
    const key = `${index}:${srgb}`;
    if (!textures.has(key)) {
      const image = gltf.images[index];
      const { width, height, data } = await decodeImage(image.bytes, image.mimeType);
      signal?.throwIfAborted();
      const imageTexture = new Texture({ label: `${label} ${index}`, width, height, data, mips: true,
        format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', sampler: 'anisoRepeat' });
      textures.set(key, imageTexture);
      generateMipmaps(imageTexture, encoder);
    }
    return textures.get(key);
  };
  try {
    const model = await prepare(async ({ pbrMetallicRoughness: pbr = {}, normalTexture }) => ({
      albedo: await texture(pbr.baseColorTexture, true),
      orm: await texture(pbr.metallicRoughnessTexture, false),
      normal: await texture(normalTexture, false),
    }));
    signal?.throwIfAborted();
    GPU.queue.submit([encoder.finish()]);
    return model;
  } catch (error) {
    for (const image of textures.values()) image.destroy();
    throw error;
  }
}

function asFloat(attribute) {
  const { array, normalized } = attribute;
  if (array instanceof Float32Array) return array;
  const divisor = normalized ? array instanceof Uint8Array ? 255 : array instanceof Uint16Array ? 65535 : 1 : 1;
  return Float32Array.from(array, x => x / divisor);
}

function makeSkinGeometry({ attributes: a, indices }) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(a.POSITION.array, 3));
  if (a.NORMAL) geometry.setAttribute('normal', new BufferAttribute(a.NORMAL.array, 3));
  if (a.TEXCOORD_0) geometry.setAttribute('uv', new BufferAttribute(asFloat(a.TEXCOORD_0), 2));
  geometry.setAttribute('skinIndex', new BufferAttribute(Uint32Array.from(a.JOINTS_0.array), 4));
  const weights = Float32Array.from(asFloat(a.WEIGHTS_0));
  for (let i = 0; i < weights.length; i += 4) {
    const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
    if (sum > 0) for (let j = 0; j < 4; j++) weights[i + j] /= sum;
    else weights[i] = 1;
  }
  geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
  if (indices) geometry.setIndex(new BufferAttribute(indices instanceof Uint32Array || indices instanceof Uint16Array ? indices : Uint32Array.from(indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export async function createSampleSkinnedModel(gltf, signal, materialOptions) {
  // Draw the approved sample meshes with Tidewater's existing palette and
  // shader. The wrapper tracks allocations even if a later image fails decode.
  const model = new SkinnedModel(gltf);
  try {
    return await withSampleTextures(gltf, 'sample animal skin', signal, async loadTextures => {
      const materials = new Map();
      for (const primitive of gltf.meshes[gltf.nodes.find(n => n.mesh !== undefined && n.skin !== undefined).mesh]) {
        const gm = gltf.materials[primitive.material] ?? {};
        if (!materials.has(primitive.material)) {
          const pbr = gm.pbrMetallicRoughness ?? {}, textures = await loadTextures(gm);
          const material = skinnedMaterial({
            name: 'skinned-' + (gm.name ?? 'material'), joints: model.joints, jointBuffer: model.jointBuffer, textures,
            alphaMode: gm.alphaMode ?? 'OPAQUE', alphaCutoff: gm.alphaCutoff ?? .5, doubleSided: !!gm.doubleSided,
            roughness: pbr.roughnessFactor ?? 1, ...materialOptions({ gltfMaterial: gm, textures }),
          });
          materials.set(primitive.material, material);
          model.materials.push(material);
        }
        const mesh = new Mesh(makeSkinGeometry(primitive), materials.get(primitive.material));
        mesh.name = 'skinned:' + (gm.name ?? '');
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = true;
        model.group.add(mesh); model.meshes.push(mesh);
      }
      return model;
    });
  } catch (error) { disposeSampleModel(model); throw error; }
}

export function disposeSampleModel(model) {
  const materials = new Set(model.materials ?? model.meshes.flatMap(mesh => mesh.material));
  const textures = new Set();
  for (const material of materials) for (const binding of Object.values(material.bindings)) {
    if (binding?.texture?.isTexture) textures.add(binding.texture);
  }
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (model.dispose) model.dispose();
    else for (const mesh of model.meshes) mesh.geometry.dispose();
    for (const material of materials) {
      material.uniformBlock.buffer?.destroy();
      material.dispose();
    }
    for (const texture of textures) texture.destroy();
  };
  if (GPU.encoder) {
    const encoder = GPU.encoder;
    GPU.onSubmit(null, destroy);
    // A paused scene still needs to flush any mipmaps recorded while loading.
    queueMicrotask(() => {
      if (GPU.encoder !== encoder) return;
      try { GPU.submit(); } catch { destroy(); }
    });
  } else destroy();
}

export function removeSampleCollider(colliders, box) {
  if (!box || !colliders) return;
  const index = colliders.boxes.indexOf(box);
  if (index !== -1) colliders.boxes.splice(index, 1);
}
