import { BufferAttribute, BufferGeometry, Color, Mesh } from '../vendor/tidewater/src/engine/index.js';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { StorageBuffer, Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { decodeImage } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { applyIslandHeadTurn, makeIslandHeadTurn } from './IslandMuseumHeadTurn.js';
import { createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, museumSrgbTextures, museumTextureUsages, parseIslandMuseumModel } from './IslandMuseumModelData.js';
import { prepareIslandAquaticMotion } from './IslandAquaticMotion.js';
import { prepareIslandFlightMotion } from './IslandFlightMotion.js';
import { augmentIslandLegRig, islandLegRigExtraGpuBytes, syncIslandLegRigPalette } from './IslandMuseumLegRig.js';
import { createMuseumGroundMotion } from './MuseumGroundMotion.js';
import { augmentIslandMediumRig, islandMediumRigExtraGpuBytes } from './IslandMuseumMediumRig.js';
import lock from './island-museum-models.lock.json';

export const islandMuseumModels = Object.freeze(lock.animals);
export function islandMuseumResidencyBudget(metadata) {
  const extra = islandLegRigExtraGpuBytes(metadata.id, metadata.geometry) + islandMediumRigExtraGpuBytes(metadata.id, metadata.geometry);
  const instanceBytes = 8192 + 128 * (metadata.geometry.paletteRows + (extra ? 32 : 0));
  return { assetId: metadata.id, instanceBytes, bytes: metadata.gpuBytes + extra + instanceBytes };
}

const urls = import.meta.glob('./assets/island/*.glb.gz', { eager: true, query: '?url', import: 'default' });

function wgsl(value) {
  return Number(value).toFixed(8);
}

function makeGeometry(piece) {
  const { primitive, influences } = piece;
  const geometry = new BufferGeometry();
  for (const [key, a] of Object.entries(primitive.attributes)) {
    const name = { POSITION: 'position', NORMAL: 'normal', COLOR_0: 'color', TEXCOORD_0: 'uv' }[key]
      ?? (key.startsWith('TEXCOORD_') ? 'islandUv' + key.slice(9) : null);
    if (name) geometry.setAttribute(name, new BufferAttribute(floatAttribute(a), a.itemSize));
  }
  for (const [i, { joints, weights }] of influences.entries()) {
    geometry.setAttribute('museumJoint' + i, new BufferAttribute(joints, 4));
    geometry.setAttribute('museumWeight' + i, new BufferAttribute(weights, 4, true));
  }
  if (piece.groundMorphMask) geometry.setAttribute('museumGroundMorph', new BufferAttribute(piece.groundMorphMask, 1));
  if (primitive.indices) {
    const indices = primitive.indices instanceof Uint8Array ? Uint16Array.from(primitive.indices) : primitive.indices;
    geometry.setIndex(new BufferAttribute(indices, 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function makeMorph({ primitive, groundMorphWeights }) {
  const count = primitive.targets.length;
  if (!count) return null;
  if (count > 8) throw Error('Island animal exceeds the native morph target limit');
  const data = new Float32Array(primitive.attributes.POSITION.array.length * count * 2);
  for (let i = 0; i < primitive.attributes.POSITION.array.length; i += 3) {
    for (const [target, { position, normal }] of primitive.targets.entries()) {
      const offset = i * count * 2 + target * 6;
      for (let j = 0; j < 3; j++) {
        data[offset + j] = position?.[i + j] ?? 0;
        data[offset + 3 + j] = normal?.[i + j] ?? 0;
      }
    }
  }
  let vertex = groundMorphWeights ? [
    'let groundMorphCurrent = v.museumGroundMorph * mat.museumGroundMorphFrame.x;',
    'let groundMorphPrevious = v.museumGroundMorph * mat.museumGroundMorphFrame.y;',
    '',
  ].join('\n') : '';
  for (let i = 0; i < count; i++) {
    const block = i - i % 4, component = 'xyzw'[i % 4];
    const current = 'mat.museumMorphCur' + block + '.' + component;
    const previous = 'mat.museumMorphPrev' + block + '.' + component;
    // Ground motion poses the distal leg around its measured reference sole.
    // Damp the authored morph there by the same foot weight used by skinning.
    const currentWeight = groundMorphWeights ? 'mix(' + current + ', ' + wgsl(groundMorphWeights[i]) + ', groundMorphCurrent)' : current;
    const previousWeight = groundMorphWeights ? 'mix(' + previous + ', ' + wgsl(groundMorphWeights[i]) + ', groundMorphPrevious)' : previous;
    vertex += [
      'let m' + i + ' = v.vertex * ' + 6 * count + 'u + ' + 6 * i + 'u;',
      'let md' + i + ' = vec3f(museumMorph[m' + i + '], museumMorph[m' + i + ' + 1u], museumMorph[m' + i + ' + 2u]);',
      'point += md' + i + ' * ' + currentWeight + ';',
      'previousPoint += md' + i + ' * ' + previousWeight + ';',
      'normal += vec3f(museumMorph[m' + i + ' + 3u], museumMorph[m' + i + ' + 4u], museumMorph[m' + i + ' + 5u]) * ' + currentWeight + ';',
      '',
    ].join('\n');
  }
  return { buffer: new StorageBuffer({ label: 'museum morph deltas', count: data.length, type: 'f32', data }), count, vertex, groundMorph: !!groundMorphWeights };
}

function makeVertex(pose, piece, morph, uvChannels) {
  const attributes = {}, varyings = {}, storage = {};
  const vertex = [];
  for (const channel of uvChannels) {
    if (channel === 0) continue;
    const name = 'islandUv' + channel;
    attributes[name] = varyings[name] = 'vec2f';
    vertex.push('o.' + name + ' = v.' + name + ';');
  }
  if (!morph && !piece.influences.length) return { attributes, varyings, storage, vertex: vertex.join('\n') };
  vertex.push('var point = v.position;', 'var previousPoint = v.position;', 'var normal = v.normal;');
  if (morph) {
    storage.museumMorph = morph.buffer;
    if (morph.groundMorph) attributes.museumGroundMorph = 'f32';
    vertex.push(morph.vertex);
  }
  const sets = piece.influences.length;
  let matrix = 'v.model', previousMatrix = 'v.prevModel';
  if (sets) {
    storage.museumPalette = pose.jointBuffer;
    const weighted = (frameOffset) => Array.from({ length: sets }, (_, j) => ['x', 'y', 'z', 'w'].map(c =>
      'museumPalette[v.museumJoint' + j + '.' + c + frameOffset + '] * v.museumWeight' + j + '.' + c).join(' + ')).join(' + ');
    for (let i = 0; i < sets; i++) {
      attributes['museumJoint' + i] = 'vec4u';
      attributes['museumWeight' + i] = 'vec4f';
    }
    vertex.push('let joint = ' + weighted('') + ';', 'let previousJoint = ' + weighted(' + ' + pose.joints + 'u') + ';');
    matrix += ' * joint';
    previousMatrix += ' * previousJoint';
  }
  vertex.push(
    'let localToWorld = ' + matrix + ';',
    'v.useWorld = true;',
    'v.worldPos = (localToWorld * vec4f(point, 1.0)).xyz;',
    'v.worldNormal = cofactor3(localToWorld) * normal;',
    'v.prevWorldPos = (' + previousMatrix + ' * vec4f(previousPoint, 1.0)).xyz;',
  );
  return { attributes, varyings, storage, vertex: vertex.join('\n') };
}

function modelMaterial(source, piece, pose, textures, morph) {
  const pbr = source.pbrMetallicRoughness ?? {};
  const base = pbr.baseColorFactor ?? [1, 1, 1, 1];
  const emissive = source.emissiveFactor ?? [0, 0, 0];
  const specular = source.extensions?.KHR_materials_specular;
  const ior = source.extensions?.KHR_materials_ior?.ior ?? 1.5;
  const clearcoat = source.extensions?.KHR_materials_clearcoat;
  const uvChannels = new Set(), textureBindings = {}, fragment = [];
  for (const [role, get] of Object.entries(museumTextureUsages)) {
    const info = get(source);
    if (!info) continue;
    const key = 'modelTex_' + role;
    const channel = info.texCoord ?? 0;
    uvChannels.add(channel);
    const uv = channel === 0 ? 'in.uv' : 'in.vs.islandUv' + channel;
    const value = 'tex_' + role;
    textureBindings[key] = textures[role];
    fragment.push('let ' + value + ' = textureSample(' + key + ', smpAnisoRepeat, ' + uv + ');');
    switch (role) {
      case 'albedo': fragment.push('s.albedo *= ' + value + '.rgb;', 's.alpha *= ' + value + '.a;'); break;
      case 'normal': fragment.push(
        'let detailNormal = ' + value + '.xyz * 2.0 - 1.0;',
        's.normal = perturbNormalByMap(in.P, in.N, ' + uv + ', vec3f(detailNormal.xy * ' + wgsl(info.scale ?? 1) + ', detailNormal.z));',
      ); break;
      case 'orm': fragment.push('s.roughness *= ' + value + '.g;', 's.metalness *= ' + value + '.b;'); break;
      case 'occlusion': fragment.push('s.ao *= mix(1.0, ' + value + '.r, ' + wgsl(info.strength ?? 1) + ');'); break;
      case 'emissive': fragment.push('s.emissive *= ' + value + '.rgb;'); break;
      case 'specular': fragment.push('s.specularIntensity *= ' + value + '.a;'); break;
      case 'specularColor': fragment.push('s.specularIntensity *= dot(' + value + '.rgb, vec3f(.2126, .7152, .0722));'); break;
      default: break;
    }
  }
  // Tidewater's dielectric Fresnel coefficient is conventionally 0.04 at IOR 1.5.
  const rgbSpecular = specular?.specularColorFactor ?? [1, 1, 1];
  const brightness = rgbSpecular[0] * .2126 + rgbSpecular[1] * .7152 + rgbSpecular[2] * .0722;
  const specularIntensity = (specular?.specularFactor ?? 1) * brightness * ((ior - 1) / (ior + 1)) ** 2 / .04;
  fragment.push('s.specularIntensity *= ' + wgsl(specularIntensity) + ';');
  if (clearcoat?.clearcoatFactor) fragment.push(
    's.clearcoat = ' + wgsl(clearcoat.clearcoatFactor) + ';',
    's.clearcoatRoughness = ' + wgsl(clearcoat.clearcoatRoughnessFactor ?? 0) + ';',
  );
  return new Material({
    name: 'island museum ' + (source.name ?? 'material'),
    ...makeVertex(pose, piece, morph, uvChannels),
    uniforms: morph?.uniforms,
    textures: textureBindings,
    surface: fragment.join('\n'),
    vertexColors: !!piece.primitive.attributes.COLOR_0,
    color: new Color(...base.slice(0, 3)),
    emissive: new Color(...emissive),
    opacity: base[3],
    defines: { CLEARCOAT: clearcoat?.clearcoatFactor > 0 ? 1 : 0 },
    roughness: pbr.roughnessFactor ?? 1,
    metalness: pbr.metallicFactor ?? 1,
    alphaTest: source.alphaMode === 'MASK' ? source.alphaCutoff ?? .5 : 0,
    transparent: source.alphaMode === 'BLEND',
    side: source.doubleSided ? 'double' : 'front',
  });
}

// Geometry, immutable morph targets and images live once per resident species.
// Each individual binds its own palette and morph weights to these assets.
const speciesAssets = new Map();
let assetLoads = 0;
let liveInstances = 0;

function instanceMorph(shared) {
  if (!shared) return null;
  const current = new Float32Array(shared.count), previous = new Float32Array(shared.count);
  const uniforms = {};
  for (let i = 0; i < shared.count; i += 4) {
    uniforms['museumMorphCur' + i] = ['vec4f', current.subarray(i, i + 4)];
    uniforms['museumMorphPrev' + i] = ['vec4f', previous.subarray(i, i + 4)];
  }
  const groundFrame = shared.groundMorph ? new Float32Array(2) : null;
  if (groundFrame) uniforms.museumGroundMorphFrame = ['vec2f', groundFrame];
  return { ...shared, current, previous, uniforms, groundFrame };
}

async function buildSpecies(id, signal) {
  const metadata = islandMuseumModels[id];
  const response = await fetch(urls['./assets/island/' + id + '.glb.gz'], { signal });
  if (!response.ok || !response.body) throw Error('Island museum model ' + id + ': ' + response.status);
  const unpacked = response.headers.get('Content-Encoding')?.includes('gzip')
    ? response : new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
  const bytes = await unpacked.arrayBuffer();
  signal.throwIfAborted();
  const gltf = parseIslandMuseumModel(bytes);
  prepareIslandAquaticMotion(gltf, id, metadata);
  prepareIslandFlightMotion(gltf, id, metadata);
  const { pieces, skin } = islandModelPieces(gltf);
  const legRig = augmentIslandLegRig(id, gltf, pieces, skin);
  augmentIslandMediumRig(id, gltf, pieces, skin, metadata);
  const headTurn = makeIslandHeadTurn(id, gltf.nodes, skin);
  const rig = { nodes: gltf.nodes, roots: gltf.roots, animations: gltf.animations };
  const draws = [], geometries = [], immutable = new Set(), texturesByImage = new Map();
  const encoder = GPU.device.createCommandEncoder({ label: 'island museum textures' });
  function dispose() {
    for (const geometry of geometries) geometry.dispose();
    for (const resource of immutable) resource.destroy();
    immutable.clear();
  }
  try {
    for (const piece of pieces) {
      const { primitive, nodeIndex, influences, defaultWeights } = piece;
      const source = gltf.materials[primitive.material] ?? {};
      const textures = {};
      for (const [role, get] of Object.entries(museumTextureUsages)) {
        const info = get(source);
        if (!info) continue;
        const imageIndex = gltf.textures[info.index].source, srgb = museumSrgbTextures.has(role);
        const key = imageIndex + ':' + srgb;
        if (!texturesByImage.has(key)) {
          const image = gltf.images[imageIndex];
          const pixels = await decodeImage(image.bytes, image.mimeType);
          signal.throwIfAborted();
          const texture = new Texture({ label: 'island museum ' + id + ':' + imageIndex, width: pixels.width,
            height: pixels.height, mips: true, data: pixels.data, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm' });
          immutable.add(texture);
          generateMipmaps(texture, encoder);
          texturesByImage.set(key, texture);
        }
        textures[role] = texturesByImage.get(key);
      }
      const geometry = makeGeometry(piece);
      geometries.push(geometry);
      const morph = makeMorph(piece);
      if (morph) immutable.add(morph.buffer);
      // Shaders need only the joint-set count and the presence of vertex color.
      const materialPiece = { influences: { length: influences.length },
        primitive: { attributes: { COLOR_0: !!primitive.attributes.COLOR_0 } } };
      draws.push({ geometry, morph, nodeIndex, defaultWeights, source, textures, materialPiece,
        materialKey: primitive.material + ':' + influences.length + ':' + !!primitive.attributes.COLOR_0 });
    }
    signal.throwIfAborted();
    GPU.queue.submit([encoder.finish()]);
    assetLoads++;
    return { id, metadata, draws, rig, skin, headTurn, legRig, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

function instantiateSpecies(asset, release) {
  const { id, metadata, draws, rig, skin, headTurn, legRig } = asset;
  const pose = createIslandModelPose(rig, skin);
  const group = pose.group, meshes = [], animated = [], materials = new Map(), owned = new Set();
  let disposed = false, headYaw = 0, groundMotion = null, footGrounded = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const material of owned) {
      material.uniformBlock.buffer?.destroy();
      material.dispose();
    }
    pose.jointBuffer.destroy();
    group.clear();
    liveInstances--;
    release();
  };
  liveInstances++;
  try {
    for (const draw of draws) {
      const morph = instanceMorph(draw.morph);
      let material = !morph ? materials.get(draw.materialKey) : null;
      if (!material) {
        material = modelMaterial(draw.source, draw.materialPiece, pose, draw.textures, morph);
        owned.add(material);
        if (!morph) materials.set(draw.materialKey, material);
      }
      const mesh = new Mesh(draw.geometry, material);
      mesh.name = 'island museum ' + id + ' ' + rig.nodes[draw.nodeIndex].name;
      mesh.receiveShadow = true;
      mesh.castShadow = !material.transparent;
      const skinned = draw.materialPiece.influences.length > 0;
      mesh.frustumCulled = !morph && !skinned;
      const row = skinned ? null : pose.world.subarray(draw.nodeIndex * 16, draw.nodeIndex * 16 + 16);
      if (row) {
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(row);
        mesh.matrixWorldNeedsUpdate = true;
      }
      if (morph || row) animated.push({ draw, mesh, morph, row });
      meshes.push(mesh);
      group.add(mesh);
    }
    pose.play('Idle', { loop: true, fade: 0 });
    pose.update(0);
    groundMotion = createMuseumGroundMotion(id, metadata, pose, legRig);
  } catch (error) {
    dispose();
    throw error;
  }
  pose.gltf = null;
  const sync = reset => {
    for (const { draw, mesh, morph, row } of animated) {
      if (row) {
        mesh.matrix.fromArray(row);
        mesh.matrixWorldNeedsUpdate = true;
      }
      if (morph) {
        morph.previous.set(morph.current);
        if (morph.groundFrame) {
          morph.groundFrame[1] = reset ? Number(footGrounded) : morph.groundFrame[0];
          morph.groundFrame[0] = Number(footGrounded);
        }
        islandMorphWeights(draw, pose.layers, morph.current);
        if (reset) morph.previous.set(morph.current);
      }
    }
  };
  const update = (dt, motion) => {
    pose.update(dt);
    const grounded = motion && groundMotion?.apply(pose, { ...motion, dt, lookYaw: headTurn ? 0 : headYaw });
    if (headTurn && headYaw) applyIslandHeadTurn(pose, headTurn, headYaw);
    footGrounded = !!grounded;
    if (legRig) syncIslandLegRigPalette(pose, legRig, dt === 0, footGrounded);
    if (legRig || grounded || (headTurn && headYaw)) {
      if (dt === 0) pose.jointData.copyWithin(pose.joints * 16, 0, pose.joints * 16);
      pose.jointBuffer.write(pose.jointData);
    }
    sync(dt === 0);
  };
  const hold = () => {
    pose.hold();
    sync(true);
    for (const mesh of meshes) mesh.resetVelocity = true;
  };
  group.name = 'island museum ' + id;
  sync(true);
  hold();
  return { group, meshes, update, hold, dispose, groundMotion, get local() { return pose.local; }, get world() { return pose.world; }, get joints() { return pose.joints; },
    headYawLimit: headTurn?.limit ?? groundMotion?.headYawLimit ?? 0, setHeadYaw: radians => { headYaw = radians; },
    clipNames: () => pose.clipNames(), clipDuration: name => pose.clipDuration(name),
    play: (name, options) => pose.play(name, options), get current() { return pose.current; }, get layers() { return pose.layers; } };
}

export function islandAssetStats() {
  return { species: speciesAssets.size, loads: assetLoads, instances: liveInstances };
}

export async function loadIslandMuseumModel(id, { signal } = {}) {
  if (!Object.hasOwn(islandMuseumModels, id)) throw Error('Unknown island museum animal ' + id);
  signal?.throwIfAborted();
  let entry = speciesAssets.get(id);
  if (!entry) {
    entry = { references: 0, controller: new AbortController(), asset: null };
    entry.ready = buildSpecies(id, entry.controller.signal).then(asset => (entry.asset = asset));
    speciesAssets.set(id, entry);
  }
  entry.references++;
  let released = false, abort;
  const release = () => {
    if (released) return;
    released = true;
    if (--entry.references) return;
    if (speciesAssets.get(id) === entry) speciesAssets.delete(id);
    entry.controller.abort();
    // Last waiters can leave immediately before the build promise resolves.
    entry.ready.then(asset => asset.dispose(), () => {});
  };
  try {
    const asset = signal ? await Promise.race([entry.ready, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]) : await entry.ready;
    signal?.throwIfAborted();
    return instantiateSpecies(asset, release);
  } catch (error) {
    release();
    throw error;
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}
