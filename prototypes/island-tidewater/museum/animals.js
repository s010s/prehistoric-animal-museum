// Museum content adapter. All GPU objects and shading belong to native Tidewater.
import { Group, Mesh, BufferGeometry, BufferAttribute, Color, Vector2, Vector3, Euler } from '../vendor/tidewater/src/engine/index.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { loadGLB, decodeImage } from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../vendor/tidewater/src/engine/render/Skinning.js';
import apato from './assets/apatosaurus.json';
import tri from './assets/triceratops.json';

const definitions = [
  { id: 'apatosaurus', name: '迷惑龙', metres: 22, yaw: -.45, x: -35, z: -92, data: apato, glb: new URL('./assets/apatosaurus.glb', import.meta.url).href },
  { id: 'triceratops', name: '三角龙', metres: 8.5, yaw: .6, x: -12, z: -73, data: tri, glb: new URL('./assets/triceratops.glb', import.meta.url).href },
];

function materialOptions({ gltfMaterial: gm, textures, nativeNormalIncluded = true }) {
  const pbr = gm.pbrMetallicRoughness ?? {};
  const color = pbr.baseColorFactor ?? [1, 1, 1, 1];
  const normalScale = gm.normalTexture?.scale ?? 1;
  const specular = gm.extensions?.KHR_materials_specular?.specularFactor ?? 1;
  return {
    color: new Color(...color.slice(0, 3)),
    // Museum skin has always been nonmetallic (see original encounter.js).
    metalness: 0,
    surface: `s.specularIntensity *= ${Number(specular).toFixed(8)};
${gm.occlusionTexture && textures.orm && gm.occlusionTexture.index === pbr.metallicRoughnessTexture?.index ? `s.ao *= mix(1.0, orm.r, ${Number(.6 * (gm.occlusionTexture.strength ?? 1)).toFixed(8)});` : ''}
${textures.normal && (!nativeNormalIncluded || normalScale !== 1) ? `let museumN = textureSample(chNormal, smpAnisoRepeat, in.uv).xyz * 2.0 - 1.0;
s.normal = perturbNormalByMap(in.P, in.N, in.uv, vec3f(museumN.xy * ${Number(normalScale).toFixed(8)}, museumN.z));` : ''}`,
  };
}

async function morphModel(gltf, metadata) {
  const raw = await fetch(new URL('./assets/apatosaurus-morph.bin', import.meta.url));
  if (!raw.ok) throw Error('Morph sidecar unavailable');
  const binary = await raw.arrayBuffer();
  const info = metadata.morph;
  const primitive = gltf.meshes[0][0], A = primitive.attributes;
  const geometry = new BufferGeometry();
  for (const [key, semantic, size] of [['position', 'POSITION', 3], ['normal', 'NORMAL', 3], ['uv', 'TEXCOORD_0', 2]]) geometry.setAttribute(key, new BufferAttribute(A[semantic].array, size));
  geometry.setIndex(new BufferAttribute(primitive.indices, 1));
  for (const [name, view] of Object.entries(info.attributes)) geometry.setAttribute(name, new BufferAttribute(new Float32Array(binary, view.byteOffset, view.count), view.itemSize));
  geometry.computeBoundingSphere();
  const gm = gltf.materials[primitive.material], pbr = gm.pbrMetallicRoughness ?? {};
  const textures = {};
  for (const [key, source, srgb] of [['albedo', pbr.baseColorTexture, true], ['normal', gm.normalTexture, false], ['orm', pbr.metallicRoughnessTexture, false]]) {
    if (!source) continue;
    const image = gltf.images[gltf.textures[source.index].source];
    const pixels = await decodeImage(image.bytes, image.mimeType);
    const texture = new Texture({ label: `museum-apato-${key}`, width: pixels.width, height: pixels.height, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', data: pixels.data, mips: true, usage: ['sample', 'copyDst'], sampler: 'anisoRepeat' });
    texture.getGPU(); generateMipmaps(texture); textures[key] = texture;
  }
  const current = new Vector2(), previous = new Vector2();
  const extra = materialOptions({ gltfMaterial: gm, textures, nativeNormalIncluded: false });
  const material = new Material({
    name: 'museum-apatosaurus-morph',
    color: extra.color, roughness: pbr.roughnessFactor ?? 1, metalness: 0,
    textures: { chAlbedo: textures.albedo, chNormal: textures.normal, chOrm: textures.orm },
    attributes: Object.fromEntries(Object.keys(info.attributes).map(name => [name, 'vec3f'])),
    uniforms: { morphCurrent: ['vec2f', current], morphPrevious: ['vec2f', previous] },
    vertex: `let p = v.position + v.morphPos0 * mat.morphCurrent.x + v.morphPos1 * mat.morphCurrent.y;
let n = v.normal + v.morphNorm0 * mat.morphCurrent.x + v.morphNorm1 * mat.morphCurrent.y;
let pp = v.position + v.morphPos0 * mat.morphPrevious.x + v.morphPos1 * mat.morphPrevious.y;
v.useWorld = true;
v.worldPos = (v.model * vec4f(p, 1.0)).xyz;
v.worldNormal = cofactor3(v.model) * n;
v.prevWorldPos = (v.prevModel * vec4f(pp, 1.0)).xyz;`,
    surface: `let albedo = textureSample(chAlbedo, smpAnisoRepeat, in.uv);
s.albedo *= albedo.rgb; s.alpha *= albedo.a;
let orm = textureSample(chOrm, smpAnisoRepeat, in.uv);
s.roughness *= orm.g;
${extra.surface}`,
    side: gm.doubleSided ? 'double' : 'front',
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'museum:apatosaurus'; mesh.castShadow = mesh.receiveShadow = true;
  // Bind pose does not include animated morph displacement; two animals make a
  // conservative no-cull choice cheap and keep shadows/near-plane views complete.
  mesh.frustumCulled = false;
  const node = gltf.nodes.find(n => n.mesh !== undefined);
  mesh.position.fromArray(node.t); mesh.quaternion.fromArray(node.r); mesh.scale.fromArray(node.s);
  const group = new Group(); group.add(mesh);
  let time = 0;
  function update(dt) {
    previous.copy(current);
    time = (time + dt * .9) % info.duration;
    const t = info.times[0] + time;
    let i = 0;
    while (i < info.times.length - 2 && info.times[i + 1] <= t) i++;
    const blend = (t - info.times[i]) / (info.times[i + 1] - info.times[i]);
    current.set(info.weights[2 * i] * (1 - blend) + info.weights[2 * (i + 1)] * blend, info.weights[2 * i + 1] * (1 - blend) + info.weights[2 * (i + 1) + 1] * blend);
  }
  update(0); previous.copy(current);
  return { group, meshes: [mesh], update, hold() { previous.copy(current); mesh.resetVelocity = true; }, state: () => ({ kind: 'two-target-native-morph', time, current: current.toArray(), previous: previous.toArray(), vertexBuffers: 7, shadowAndVelocity: 'same native material vertex hook' }) };
}

export async function createMuseumAnimals(app) {
  const animals = [];
  for (const baseDefinition of definitions) {
    const definition = { ...baseDefinition, ...(app.geography?.animals.find(a => a.id === baseDefinition.id) ?? {}) };
    const gltf = await loadGLB(definition.glb);
    const model = definition.id === 'apatosaurus' ? await morphModel(gltf, definition.data) : await SkinnedModel.create(gltf, { materials: materialOptions });
    if (definition.id === 'triceratops') model.play('Idle', { loop: true, speed: .9, fade: 0 });
    const scale = definition.data.scale;
    model.group.scale.setScalar(scale); model.group.rotation.y = definition.yaw;
    const ground = app.terrainData.heightAt(definition.x, definition.z);
    model.group.position.set(definition.x, ground - definition.data.bounds.min[1] * scale, definition.z);
    model.group.name = `museum:${definition.id}`;
    app.scene.add(model.group);
    model.update(0); model.hold();
    animals.push({ definition, model, ground });
  }
  return {
    update(dt) { for (const a of animals) a.model.update(dt); },
    instrumentPassVisits(callback) { for (const a of animals) for (const mesh of a.model.meshes) { const original = mesh.onBeforeRender; mesh.onBeforeRender = (...args) => { original?.apply(mesh, args); callback(a.definition.id); }; } },
    hold() { for (const a of animals) { a.model.hold(); for (const mesh of a.model.meshes) mesh.resetVelocity = true; } },
    lookAt(id) {
      const a = animals.find(a => a.definition.id === id);
      if (!a) return;
      const p = a.model.group.position;
      const size = a.definition.metres;
      const pos = new Vector3(p.x - size * .65, a.ground + 2.5 + size * .12, p.z + size * 1.5);
      app.camera.position.copy(pos);
      app.camera.lookAt(new Vector3(p.x, a.ground + a.definition.data.dimensions[1] * a.definition.data.scale * .5, p.z));
      const e = new Euler().setFromQuaternion(app.camera.quaternion, 'YXZ');
      app.freeCam = true; app.fly.setPose(pos, e.y, e.x); app.fly.velocity.set(0, 0, 0);
      this.hold();
      if (app.post?.taau) app.post.taau._needsRestart = true;
    },
    state() { return animals.map(a => ({ id: a.definition.id, lengthMetres: a.definition.metres, horizontalRestLengthMetres: Math.max(a.definition.data.dimensions[0], a.definition.data.dimensions[2]) * a.model.group.scale.x, position: a.model.group.position.toArray(), ground: a.ground, meshes: a.model.meshes.map(m => ({ name: m.name, castShadow: m.castShadow, receiveShadow: m.receiveShadow, frustumCulled: m.frustumCulled, resetVelocity: m.resetVelocity })), animation: a.model.state?.() ?? { kind: 'native-skin', joints: a.model.joints, clips: a.model.clipNames(), layers: a.model.layers.map(l => ({ time: l.time, weight: l.weight, speed: l.speed })) } })); },
  };
}
