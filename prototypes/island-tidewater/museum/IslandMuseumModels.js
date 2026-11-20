import { BufferAttribute, BufferGeometry, Color, Mesh } from '../vendor/tidewater/src/engine/index.js';
import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { StorageBuffer, Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { decodeImage } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { applyIslandHeadTurn, makeIslandHeadTurn } from './IslandMuseumHeadTurn.js';
import { createIslandModelPose, floatAttribute, islandModelPieces, islandMorphWeights, museumSrgbTextures, museumTextureUsages, parseIslandMuseumModel } from './IslandMuseumModelData.js';
import lock from './island-museum-models.lock.json';

export const islandMuseumModels = Object.freeze(lock.animals);
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
  if (primitive.indices) {
    const indices = primitive.indices instanceof Uint8Array ? Uint16Array.from(primitive.indices) : primitive.indices;
    geometry.setIndex(new BufferAttribute(indices, 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function makeMorph(primitive) {
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
  const current = new Float32Array(count), previous = new Float32Array(count), uniforms = {};
  let vertex = '';
  for (let i = 0; i < count; i += 4) {
    uniforms['museumMorphCur' + i] = ['vec4f', current.subarray(i, i + 4)];
    uniforms['museumMorphPrev' + i] = ['vec4f', previous.subarray(i, i + 4)];
  }
  for (let i = 0; i < count; i++) {
    const block = i - i % 4, component = 'xyzw'[i % 4];
    vertex += [
      'let m' + i + ' = v.vertex * ' + 6 * count + 'u + ' + 6 * i + 'u;',
      'let md' + i + ' = vec3f(museumMorph[m' + i + '], museumMorph[m' + i + ' + 1u], museumMorph[m' + i + ' + 2u]);',
      'point += md' + i + ' * mat.museumMorphCur' + block + '.' + component + ';',
      'previousPoint += md' + i + ' * mat.museumMorphPrev' + block + '.' + component + ';',
      'normal += vec3f(museumMorph[m' + i + ' + 3u], museumMorph[m' + i + ' + 4u], museumMorph[m' + i + ' + 5u]) * mat.museumMorphCur' + block + '.' + component + ';',
      '',
    ].join('\n');
  }
  return { buffer: new StorageBuffer({ label: 'museum morph deltas', count: data.length, type: 'f32', data }), current, previous, uniforms, vertex };
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

export async function loadIslandMuseumModel(id, { signal } = {}) {
  if (!Object.hasOwn(islandMuseumModels, id)) throw Error('Unknown island museum animal ' + id);
  const url = urls['./assets/island/' + id + '.glb.gz'];
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw Error('Island museum model ' + id + ': ' + response.status);
  // A static host may already have decoded gzip if it set Content-Encoding.
  const unpacked = response.headers.get('Content-Encoding')?.includes('gzip')
    ? response : new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
  const bytes = await unpacked.arrayBuffer();
  signal?.throwIfAborted();
  const gltf = parseIslandMuseumModel(bytes);
  const { pieces, skin } = islandModelPieces(gltf);
  const headTurn = makeIslandHeadTurn(id, gltf.nodes, skin);
  const pose = createIslandModelPose(gltf, skin);
  const group = pose.group, meshes = [], resources = new Set([pose.jointBuffer]);
  const texCache = new Map(), materials = new Map(), animated = [];
  const mipEncoder = GPU.device.createCommandEncoder({ label: 'island museum textures' });
  const dispose = () => {
    group.removeFromParent();
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const resource of resources) {
      if (resource.isMaterial) {
        resource.uniformBlock.buffer?.destroy();
        resource.dispose();
      } else resource.destroy();
    }
    resources.clear();
    group.clear();
  };
  try {
    for (const piece of pieces) {
      const { primitive, nodeIndex, influences } = piece;
      const source = gltf.materials[primitive.material] ?? {};
      const morph = makeMorph(primitive);
      if (morph) resources.add(morph.buffer);
      const key = primitive.material + ':' + influences.length + ':' + !!primitive.attributes.COLOR_0;
      let material = !morph ? materials.get(key) : null;
      if (!material) {
        const textures = {};
        for (const [role, get] of Object.entries(museumTextureUsages)) {
          const info = get(source);
          if (!info) continue;
          const imageIndex = gltf.textures[info.index].source;
          const srgb = museumSrgbTextures.has(role);
          const key = imageIndex + ':' + srgb;
          if (!texCache.has(key)) {
            const image = gltf.images[imageIndex];
            const pixels = await decodeImage(image.bytes, image.mimeType);
            signal?.throwIfAborted();
            const texture = new Texture({
              label: 'island museum ' + id + ':' + imageIndex,
              width: pixels.width, height: pixels.height, mips: true, data: pixels.data,
              format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
            });
            resources.add(texture);
            generateMipmaps(texture, mipEncoder);
            texCache.set(key, texture);
          }
          textures[role] = texCache.get(key);
        }
        material = modelMaterial(source, piece, pose, textures, morph);
        resources.add(material);
        if (!morph) materials.set(key, material);
      }
      const mesh = new Mesh(makeGeometry(piece), material);
      mesh.name = 'island museum ' + id + ' ' + gltf.nodes[nodeIndex].name;
      mesh.receiveShadow = true;
      mesh.castShadow = !material.transparent;
      mesh.frustumCulled = !morph && !influences.length;
      const row = influences.length ? null : pose.world.subarray(nodeIndex * 16, nodeIndex * 16 + 16);
      if (row) {
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(row);
        mesh.matrixWorldNeedsUpdate = true;
      }
      if (morph || row) animated.push({ piece: { nodeIndex, defaultWeights: piece.defaultWeights }, mesh, morph, row });
      meshes.push(mesh);
      group.add(mesh);
    }
    signal?.throwIfAborted();
    GPU.queue.submit([mipEncoder.finish()]);
  } catch (error) {
    dispose();
    throw error;
  }
  // Keep only the pose, vertex/index buffers and native materials resident.
  pose.gltf = null;
  const sync = (reset) => {
    for (const { piece, mesh, morph, row } of animated) {
      if (row) {
        mesh.matrix.fromArray(row);
        mesh.matrixWorldNeedsUpdate = true;
      }
      if (morph) {
        morph.previous.set(morph.current);
        islandMorphWeights(piece, pose.layers, morph.current);
        if (reset) morph.previous.set(morph.current);
      }
    }
  };
  let headYaw = 0;
  const update = dt => {
    pose.update(dt);
    if (headTurn && headYaw) {
      applyIslandHeadTurn(pose, headTurn, headYaw, dt === 0);
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
  pose.play('Idle', { loop: true, fade: 0 });
  update(0);
  hold();
  return {
    group, meshes, update, hold, dispose,
    headYawLimit: headTurn?.limit ?? 0,
    setHeadYaw: radians => { headYaw = radians; },
    clipNames: () => pose.clipNames(),
    clipDuration: name => pose.clipDuration(name),
    play: (name, options) => pose.play(name, options),
    get current() { return pose.current; },
    get layers() { return pose.layers; },
  };
}
