// Museum content adapter. All GPU objects and shading belong to native Tidewater.
import { Group, Mesh, BufferGeometry, BufferAttribute, Color, Vector2, Vector3, Euler } from '../vendor/tidewater/src/engine/index.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import apato from './assets/apatosaurus.json';
import tri from './assets/triceratops.json';
import { findMuseumGround, seatMuseumModel, museumGroundVisit } from './MuseumGrounding.js';
import { markStreamedFaunaMaterials } from './StreamedFaunaPipelines.js';
import { createSampleSkinnedModel, disposeSampleModel, loadSampleGLB, removeSampleCollider, withSampleTextures } from './SampleModelResources.js';

const definitions = [
  { id: 'apatosaurus', name: '迷惑龙', metres: 22, yaw: -.45, x: -35, z: -92, data: apato, glb: new URL('./assets/apatosaurus.glb', import.meta.url).href },
  { id: 'triceratops', name: '三角龙', metres: 8.5, yaw: .6, x: -12, z: -73, data: tri, glb: new URL('./assets/triceratops.glb', import.meta.url).href },
];

export function museumMaterialOptions({ gltfMaterial: gm, textures, nativeNormalIncluded = true }) {
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

async function morphModel(gltf, metadata, signal) {
  const raw = await fetch(new URL('./assets/apatosaurus-morph.bin', import.meta.url), { signal });
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
  return withSampleTextures(gltf, 'museum Apatosaurus morph', signal, async loadTextures => {
    const textures = await loadTextures(gm);
    return makeMorphModel(gltf, geometry, info, gm, pbr, textures);
  });
}

function makeMorphModel(gltf, geometry, info, gm, pbr, textures) {
  const current = new Vector2(), previous = new Vector2();
  const extra = museumMaterialOptions({ gltfMaterial: gm, textures, nativeNormalIncluded: false });
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

export async function createMuseumAnimals(app, residency = null, prepareMaterial = null) {
  const animals = [], sample = !!app.creekData?.field.continuousSample, visits = {}, sites = {};
  let passVisit = null;
  for (const baseDefinition of definitions) {
    const definition = { ...baseDefinition, ...(app.geography?.animals.find(a => a.id === baseDefinition.id) ?? {}) };
    const scale = definition.data.scale;
    const group = new Group(), mount = { group };
    group.scale.setScalar(scale); group.rotation.y = definition.yaw;
    let ground = app.terrainData.heightAt(definition.x, definition.z), site = null;
    if (sample) {
      const spec = definition.id === 'apatosaurus'
        ? { preferred: [-668, -245], yaw: 1.2, supportHalf: [1.7, .8], contactCenter: [-4.26 / scale, 0], radius: 48, maxSlope: .24 }
        : { preferred: [-777, -71], yaw: 0, supportHalf: [1, .9], contactCenter: [0, .27 / scale], radius: 42, maxSlope: .24 };
      site = findMuseumGround(app, definition.data, spec);
      definition.x = site.x; definition.z = site.z; definition.yaw = site.yaw; ground = site.y;
      seatMuseumModel(mount, definition.data, site, spec.contactCenter);
      sites[definition.id] = { id: definition.id, x: site.x, y: site.y, z: site.z, yaw: site.yaw, supportHalf: spec.supportHalf, contactCenter: spec.contactCenter, slope: site.slope, residual: site.residual, groundClearance: site.clear, waterEdge: site.edge, metres: definition.metres, placement: 'four contact regions fitted to existing gentle dry ground; entire rest body clears trunks' };
    } else group.position.set(definition.x, ground - definition.data.bounds.min[1] * scale, definition.z);
    const center = new Vector3(...definition.data.bounds.min.map((v, i) => (v + definition.data.bounds.max[i]) * scale * .5)).applyQuaternion(group.quaternion).add(group.position);
    if (sample) visits[`sample-${definition.id}`] = museumGroundVisit(app, `sample-${definition.id}`, definition.id === 'apatosaurus' ? '溪谷林缘的迷惑龙' : '林缘停留的三角龙', site, definition.data.dimensions[1] * scale * .56, definition.id === 'apatosaurus' ? 24 : 13, center.toArray());
    const halfExtents = definition.data.dimensions.map(v => v * scale * .49);
    const range = definition.id === 'apatosaurus' ? 360 : 240;
    const actor = { definition, group, model: null, ground, site, center, halfExtents, range, active: false };
    animals.push(actor);
    const load = async signal => {
      const gltf = await loadSampleGLB(definition.glb, signal);
      signal?.throwIfAborted();
      return definition.id === 'apatosaurus' ? morphModel(gltf, definition.data, signal) : createSampleSkinnedModel(gltf, signal, museumMaterialOptions);
    };
    const prepare = (model, signal) => {
      markStreamedFaunaMaterials(model, 'sample:' + definition.id);
      if (prepareMaterial) for (const mesh of model.meshes) prepareMaterial(mesh.material);
      return app.islandFauna.pipelines.prepareMain(model, signal);
    };
    const attach = model => {
      actor.model = model;
      model.group.name = `museum:${definition.id}`;
      model.group.position.copy(group.position);
      model.group.quaternion.copy(group.quaternion);
      model.group.scale.copy(group.scale);
      for (const mesh of model.meshes) {
        const original = mesh.onBeforeRender;
        mesh.onBeforeRender = (...args) => { original?.apply(mesh, args); passVisit?.(definition.id); };
      }
      if (definition.id === 'triceratops') model.play('Idle', { loop: true, speed: .9, fade: 0 });
      model.update(0); model.hold();
      app.scene.add(model.group);
      actor.active = true;
      if (sample) actor.collider = app.colliders?.addBox(center, new Vector3(...halfExtents), definition.yaw, { tag: 'museum animal', solid: true });
    };
    const detach = model => {
      app.dynamicMuseumShadows?.removeModel(model);
      model.group.removeFromParent();
      actor.model = null;
      actor.active = false;
      removeSampleCollider(app.colliders, actor.collider);
      actor.collider = null;
    };
    if (residency) residency.add({ id: 'sample:' + definition.id, x: center.x, y: center.y, z: center.z, range: range + 30,
      radius: Math.max(halfExtents[0], halfExtents[2]), bytes: 20 * 1024 ** 2, priority: 8, load, prepare, attach, detach, dispose: disposeSampleModel });
    else attach(await load());
  }
  if (sample) {
    app.creekData.sampleMuseumLifeSites = { ...app.creekData.sampleMuseumLifeSites, ...sites };
    app.creekData.sampleMuseumLifeVisits = { ...app.creekData.sampleMuseumLifeVisits, ...visits };
  }
  return {
    visits,
    models() { return animals.flatMap(a => a.model ? [a.model] : []); },
    update(dt) {
      for (const a of animals) {
        if (!a.model) continue;
        if (sample) {
          const active = app.camera.position.distanceTo(a.center) < a.range + (a.active ? 20 : 0);
          if (!active) {
            if (a.active) a.model.hold();
            a.model.group.visible = a.active = false;
            continue;
          }
          if (!a.active) { a.model.update(0); a.model.hold(); for (const mesh of a.model.meshes) mesh.resetVelocity = true; }
          a.model.group.visible = a.active = true;
        }
        a.model.update(dt);
      }
    },
    instrumentPassVisits(callback) { passVisit = callback; },
    hold() { for (const a of animals) if (a.model) { a.model.hold(); for (const mesh of a.model.meshes) mesh.resetVelocity = true; } },
    lookAt(id) {
      const a = animals.find(a => a.definition.id === id);
      if (!a) return;
      const p = a.group.position, size = a.definition.metres;
      const pos = new Vector3(p.x - size * .65, a.ground + 2.5 + size * .12, p.z + size * 1.5);
      app.camera.position.copy(pos);
      app.camera.lookAt(new Vector3(p.x, a.ground + a.definition.data.dimensions[1] * a.definition.data.scale * .5, p.z));
      const e = new Euler().setFromQuaternion(app.camera.quaternion, 'YXZ');
      app.freeCam = true; app.fly.setPose(pos, e.y, e.x); app.fly.velocity.set(0, 0, 0);
      app.islandFauna?.scan(app.camera.position, 'sample:' + id);
      this.hold();
      if (app.post?.taau) app.post.taau._needsRestart = true;
    },
    state() { return animals.map(a => ({
      id: a.definition.id, lengthMetres: a.definition.metres,
      horizontalRestLengthMetres: Math.max(a.definition.data.dimensions[0], a.definition.data.dimensions[2]) * a.group.scale.x,
      position: a.group.position.toArray(), ground: a.ground, yaw: a.definition.yaw,
      halfExtents: a.halfExtents, colliderCenter: a.center.toArray(), sampleSite: sites[a.definition.id] ?? null,
      localPose: a.model?.state?.().current ?? [...new Set(a.model?.layers[0]?.clip.channels.map(c => c.node) ?? [])].slice(0, 3).flatMap(i => Array.from(a.model.local[i].r)),
      visible: a.model?.group.visible ?? false, active: a.active, residency: residency?.state('sample:' + a.definition.id)?.status,
      meshes: a.model?.meshes.map(m => ({ name: m.name, castShadow: m.castShadow, receiveShadow: m.receiveShadow, frustumCulled: m.frustumCulled, resetVelocity: m.resetVelocity })) ?? [],
      animation: a.model ? a.model.state?.() ?? { kind: 'native-skin', joints: a.model.joints, clips: a.model.clipNames(), layers: a.model.layers.map(l => ({ time: l.time, weight: l.weight, speed: l.speed })) } : null,
    })); },
  };
}
