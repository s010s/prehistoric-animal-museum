// Immutable, licensed Lowpoly Vault sources from island-ecology.lock.json.
// These are sparse landmarks. Native grass, retained tree populations and the
// lighter regional scatter carry density and remain available while GLBs load.
import {Box3, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Quaternion, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {decodeImage, parseGLB} from '../vendor/tidewater/src/engine/loaders/GLTF.js';
import {GPU} from '../vendor/tidewater/src/engine/gpu/GPU.js';
import {Texture} from '../vendor/tidewater/src/engine/gpu/Texture.js';
import {generateMipmaps} from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import {Material} from '../vendor/tidewater/src/engine/render/Material.js';
import {islandGroundAt} from './IslandEcologyPlan.js';
import {clipCreekRefraction} from './CreekWater.js';
import {markStreamedFaunaMaterials} from '../museum/StreamedFaunaPipelines.js';
import {removeSampleCollider} from '../museum/SampleModelResources.js';

function landmark(id, region, offset, scale, band, slope, anchor, embed = .12) {
  return {id, region, offset, scale, band, slope, anchor, embed};
}

const LANDMARKS = [
  landmark('desiccation-crack-surface', 'wetland', [8, -3], [3.2, .58, 3.2], [.20, 1.18], .13, 'fresh', .035),
  landmark('cross-bedded-sandstone', 'dry-upland', [19, -3.5], [6.3, 6.3, 6.3], [1, 1200], .64, 'land', 1.05),
  landmark('glacial-erratic', 'highland-lake', [17, -4], [5.2, 5.2, 5.2], [.35, 25], .41, 'fresh-bank', .67),
  landmark('cycad', 'dry-upland', [8, 4.5], [1.55, 1.55, 1.55], [1, 1200], .42, 'land', .035),
  landmark('marsilea', 'lake', [16, -4], [1.12, 1.12, 1.12], [-.64, -.19], .32, 'fresh', .016),
  landmark('isastraea', 'shelf-south', [10, 4], [1.5, 1.5, 1.5], [-7.5, -2.3], .40, 'marine', .17),
  landmark('conglomerate-outcrop', 'east-alluvial', [10, 4], [3.8, 3.8, 3.8], [.24, 4.4], .60, 'fresh-bank', .31),
];

const URLS = {
  'desiccation-crack-surface': new URL('./assets/island-desiccation-crack-surface-vault.glb', import.meta.url),
  'cross-bedded-sandstone': new URL('./assets/island-cross-bedded-sandstone-vault.glb', import.meta.url),
  'glacial-erratic': new URL('./assets/island-glacial-erratic-vault.glb', import.meta.url),
  cycad: new URL('./assets/island-cycad-vault.glb', import.meta.url),
  marsilea: new URL('./assets/island-marsilea-vault.glb', import.meta.url),
  isastraea: new URL('./assets/island-isastraea-vault.glb', import.meta.url),
  'conglomerate-outcrop': new URL('./assets/island-conglomerate-outcrop-vault.glb', import.meta.url),
};
const UP = new Vector3(0, 1, 0);
const PLACE_RANGE = 145;
const UNLOAD_RANGE = 365;
// These exact source revisions include a display footing in their remeshed
// primitive. Cut the footing below its measured source-space shoulder.
const FOOTING_CUTS = {'glacial-erratic': -.203, 'cross-bedded-sandstone': -.231};
const SOLID = new Set(['cross-bedded-sandstone', 'glacial-erratic', 'conglomerate-outcrop']);
function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function eligible(g, spec) {
  if (g.height < spec.band[0] || g.height > spec.band[1] || g.slope > spec.slope) return false;
  switch (spec.anchor) {
    case 'fresh': return g.fresh && (g.height > 0 || g.edge < -.05);
    case 'fresh-bank': return g.fresh && g.height > 0;
    case 'marine': return g.sea && (g.rock > .14 || g.sand < .67 || g.slope > .036 || g.nearMarineRock);
    default: return g.height > .15 && g.trail < .51;
  }
}

export function arrangeIslandLandmarks(data, areas, obstacles = []) {
  return LANDMARKS.flatMap(spec => {
    const area = areas[spec.region];
    if (!area) return [];
    const [ox, oz] = area.origin, [dx, dz] = area.direction;
    const [along, lateral] = spec.offset;
    const px = ox + dx * along - dz * lateral, pz = oz + dz * along + dx * lateral;
    const span = Math.max(...spec.scale) * .55;
    const radius = spec.anchor === 'land' ? 34 : spec.anchor === 'marine' ? 38 : 83;
    const nearby = obstacles.filter(p => p.x > px - radius - 25 && p.x < px + radius + 25
      && p.z > pz - radius - 25 && p.z < pz + radius + 25);
    let best = null;
    for (let j = -radius; j <= radius; j += 2.25) for (let i = -radius; i <= radius; i += 2.25) {
      const x = px + i, z = pz + j;
      if (Math.hypot(x - ox, z - oz) < Math.max(span + 2.5, 5)) continue;
      const g = islandGroundAt(data, x, z);
      g.nearMarineRock = g.sea && nearby.some(p => Math.hypot(p.x - x, p.z - z) < (p.footRadius ?? p.radius ?? 0) + 4.6);
      if (!eligible(g, spec)) continue;
      if (nearby.some(p => Math.hypot(p.x - x, p.z - z) < (p.footRadius ?? p.radius ?? 0) * .75 + span)) continue;
      const ahead = (x - ox) * dx + (z - oz) * dz;
      const anglePenalty = ahead >= 0 ? 0 : 2 * Math.abs(ahead);
      const substrate = spec.anchor === 'marine' ? -g.rock * 4 : spec.id === 'cycad' ? g.rock * 6 : 0;
      const score = Math.hypot(i, j) + anglePenalty + g.slope * (spec.id === 'desiccation-crack-surface' ? 50 : 6) + substrate;
      if (!best || score < best.score) best = {g, score};
    }
    return best ? [{...spec, ground: best.g, yaw: Math.atan2(dx, dz) + .39}] : [];
  });
}

function materialBuilder(gltf, textures, data, spec, terrainGPU, isCurrent, materials, encoder) {
  const field = data.field;
  const cache = new Map();
  const isStone = SOLID.has(spec.id);
  const isSandstone = spec.id === 'cross-bedded-sandstone';
  async function materialFor(index, hasColors) {
    const key = index + ':' + hasColors;
    if (cache.has(key)) return cache.get(key);
    const m = gltf.materials[index] ?? {}, pbr = m.pbrMetallicRoughness ?? {}, bindings = {};
    async function add(name, info, srgb) {
      if (!info) return;
      const image = gltf.textures[info.index].source;
      const id = image + (srgb ? ':srgb' : ':linear');
      if (!textures.has(id)) {
        const source = gltf.images[image];
        const px = await decodeImage(source.bytes, source.mimeType);
        if (!isCurrent()) throw new Error('Cancelled');
        const t = new Texture({label: 'Island Vault ' + id, width: px.width, height: px.height,
          format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', data: px.data, mips: true, usage: ['sample', 'copyDst']});
        textures.set(id, t);
        t.getGPU();
        generateMipmaps(t, encoder);
      }
      bindings[name] = textures.get(id);
    }
    await add('islandVaultColor', pbr.baseColorTexture, true);
    await add('islandVaultNormal', m.normalTexture, false);
    await add('islandVaultOrm', pbr.metallicRoughnessTexture, false);
    await add('islandVaultEmission', m.emissiveTexture, true);
    const color = new Vector3().fromArray(pbr.baseColorFactor ?? [1, 1, 1]);
    const emissive = new Vector3().fromArray(m.emissiveFactor ?? [0, 0, 0])
      .multiplyScalar(m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1);
    const stoneBlend = isStone && terrainGPU ? `
let lmGroundY = terrainHeightAt(in.P.xz);
let lmAbove = max(in.P.y - lmGroundY, 0.0);
let lmDustNoise = .5 + .25 * sin(in.P.x * 1.9 + in.P.z * 1.3) + .25 * sin(in.P.z * 3.7 - in.P.x * 2.1);
let lmSkirt = 1.0 - smoothstep(0.02, 0.58, lmAbove + (lmDustNoise - .5) * .16);
let lmTopDust = smoothstep(0.52, 0.90, in.N.y) * (.22 + .18 * lmDustNoise);
let lmSeamAO = 1.0 - 0.42 * (1.0 - smoothstep(0.0, 0.30, lmAbove));
${isSandstone ? `let lmLuma = dot(s.albedo, vec3f(0.32, 0.48, 0.20));
let lmWeathered = vec3f(lmLuma * 1.05, lmLuma * 0.95, lmLuma * 0.78);
s.albedo = mix(s.albedo, lmWeathered, 0.56);
let lmLocalEarth = vec3f(0.24, 0.21, 0.145) * (0.86 + 0.24 * lmDustNoise);` : `let lmLocalEarth = vec3f(0.17, 0.16, 0.125) * (0.86 + 0.24 * lmDustNoise);`}
s.albedo = mix(s.albedo, lmLocalEarth, clamp(lmSkirt * 0.76 + lmTopDust * 0.35, 0.0, 0.84));
s.roughness = max(s.roughness, mix(0.88, 0.96, lmSkirt));
s.specularIntensity = min(s.specularIntensity, 0.18);
s.ao *= lmSeamAO;` : '';
    const surface = [
      bindings.islandVaultColor ? 'let texel=textureSample(islandVaultColor,smpAnisoRepeat,in.uv);s.albedo*=texel.rgb;s.alpha*=texel.a;' : '',
      bindings.islandVaultNormal ? 'let nm=textureSample(islandVaultNormal,smpAnisoRepeat,in.uv).xyz*2.0-1.0;s.normal=perturbNormalByMap(in.P,in.N,in.uv,nm);' : '',
      bindings.islandVaultOrm ? 'let orm=textureSample(islandVaultOrm,smpAnisoRepeat,in.uv);s.roughness*=orm.g;s.metalness*=orm.b;' : '',
      bindings.islandVaultEmission ? 's.emissive*=textureSample(islandVaultEmission,smpAnisoRepeat,in.uv).rgb;' : '',
      stoneBlend,
    ].join('\n');
    const material = new Material({name: m.name || 'Island Vault stone and leaf', color, emissive,
      roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 1,
      side: m.doubleSided ? 'double' : 'front', vertexColors: hasColors,
      alphaTest: m.alphaMode === 'MASK' ? (m.alphaCutoff ?? .5) : 0,
      modules: isStone && terrainGPU ? [terrainGPU.module] : [],
      textures: bindings, surface});
    clipCreekRefraction(material, field);
    cache.set(key, material);
    materials.add(material);
    return material;
  }
  return materialFor;
}

function geometryFromPrimitive(primitive) {
  const g = new BufferGeometry(), a = primitive.attributes;
  g.setAttribute('position', new BufferAttribute(a.POSITION.array, 3));
  if (a.NORMAL) g.setAttribute('normal', new BufferAttribute(a.NORMAL.array, 3));
  if (a.TEXCOORD_0) g.setAttribute('uv', new BufferAttribute(a.TEXCOORD_0.array, 2));
  if (a.COLOR_0) {
    const {array, itemSize, normalized} = a.COLOR_0;
    const count = array.length / itemSize, color = new Float32Array(count * 4);
    const divisor = !normalized ? 1 : array instanceof Uint8Array ? 255 : 65535;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 4; c++) color[i * 4 + c] = c < itemSize ? array[i * itemSize + c] / divisor : 1;
    }
    g.setAttribute('color', new BufferAttribute(color, 4));
  }
  if (primitive.indices) g.setIndex(new BufferAttribute(primitive.indices, 1));
  if (!a.NORMAL) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function trimDisplayFooting(geometry, cut) {
  const p = geometry.attributes.position, source = geometry.index.array, kept = [];
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i], b = source[i + 1], c = source[i + 2];
    if (Math.max(p.getY(a), p.getY(b), p.getY(c)) >= cut) kept.push(a, b, c);
  }
  geometry.setIndex(new BufferAttribute(new Uint32Array(kept), 1));
  geometry.computeVertexNormals();
}

function rootGeometry(mesh, spec, terrain, referenceY, bounds) {
  const geometry = mesh.geometry, positions = geometry.attributes.position, world = new Vector3();
  const yScale = spec.scale[1], mud = spec.id === 'desiccation-crack-surface';
  const extent = bounds.getSize(new Vector3()).multiplyScalar(.5), center = bounds.getCenter(new Vector3());
  for (let i = 0; i < positions.count; i++) {
    world.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    const ground = terrain.heightAt(world.x, world.z), y = positions.getY(i);
    if (mud) {
      // Expose irregular central cracking. The sidewall and rectangular
      // perimeter descend into the actual bank along the local contour.
      const u = (positions.getX(i) - center.x) / extent.x, v = (positions.getZ(i) - center.z) / extent.z;
      const outline = Math.hypot(u + .12 * Math.sin(v * 9), v * 1.17 + .12 * Math.sin(u * 8));
      const relief = (y - .012) * .43 + .012 - .101 * smooth(.39, .95, outline);
      positions.setY(i, y + (ground + relief - world.y) / yScale);
    } else {
      const contact = 1 - smooth(.08, .61, (y - referenceY) * yScale);
      positions.setY(i, y + (ground - spec.ground.y) * contact / yScale);
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  positions.needsUpdate = true;
}

function release(resources) {
  if (!resources) return;
  resources.group.removeFromParent();
  removeSampleCollider(resources.colliders, resources.collider);
  for (const geometry of resources.geometries) geometry.dispose();
  for (const material of resources.materials) {
    material.uniformBlock.buffer?.destroy();
    material.dispose();
  }
  for (const texture of resources.textures.values()) texture.destroy();
}

async function makeModel(gltf, data, spec, terrainGPU, isCurrent) {
  const group = new Group(), content = new Group(), textures = new Map(), geometries = [], bounds = new Box3();
  const resources = {group, textures, geometries, materials: new Set()};
  const encoder = GPU.device.createCommandEncoder({label: 'Island landmark ' + spec.id});
  const materials = materialBuilder(gltf, textures, data, spec, terrainGPU, isCurrent, resources.materials, encoder);
  const cut = FOOTING_CUTS[spec.id];
  const local = new Matrix4(), point = new Vector3();
  async function visit(id, parentMatrix) {
    const node = gltf.nodes[id], matrix = local.compose(
      new Vector3().fromArray(node.t), new Quaternion().fromArray(node.r), new Vector3().fromArray(node.s),
    ).clone().premultiply(parentMatrix);
    for (const p of gltf.meshes[node.mesh] ?? []) {
      if (!isCurrent()) throw new Error('Cancelled');
      if (p.mode !== 4) throw Error('Island landmark source needs triangles: ' + spec.id);
      const geometry = geometryFromPrimitive(p);
      geometries.push(geometry);
      geometry.applyMatrix4(matrix);
      if (cut !== undefined) trimDisplayFooting(geometry, cut);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      const material = await materials(p.material, !!p.attributes.COLOR_0);
      if (spec.id === 'desiccation-crack-surface') material.uniforms.color.value.setRGB(.50, .53, .42);
      const mesh = new Mesh(geometry, material);
      mesh.name = spec.id;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.staticVelocity = true;
      content.add(mesh);
    }
    for (const child of node.children) await visit(child, matrix);
  }
  try {
    for (const root of gltf.roots) await visit(root, new Matrix4());
    if (!isCurrent()) throw new Error('Cancelled');
    if (bounds.isEmpty()) throw Error('Island landmark has no renderable geometry: ' + spec.id);
    bounds.getCenter(point);
    const referenceY = cut ?? bounds.min.y;
    content.position.set(-point.x, -referenceY, -point.z);
    group.add(content);
    group.name = 'Island landmark ' + spec.id;
    const g = spec.ground;
    group.position.set(g.x, g.y - spec.embed, g.z);
    group.scale.fromArray(spec.scale);
    group.quaternion.setFromAxisAngle(UP, spec.yaw);
    group.updateMatrixWorld(true);
    for (const mesh of content.children) rootGeometry(mesh, spec, data.terrain, referenceY, bounds);
    markStreamedFaunaMaterials({meshes: content.children}, 'landmark:' + spec.id);
    if (SOLID.has(spec.id)) {
      const s = bounds.getSize(new Vector3()).multiply(group.scale);
      const top = g.y - spec.embed + (bounds.max.y - referenceY) * group.scale.y;
      resources.solid = {center: new Vector3(g.x, (top + g.y) * .5, g.z),
        half: new Vector3(s.x * .35, Math.max(.1, (top - g.y) * .5), s.z * .35)};
    }
    GPU.queue.submit([encoder.finish()]);
    return resources;
  } catch (error) {
    release(resources);
    throw error;
  }
}

export class IslandLandmarkProps {
  constructor(app, data, areas) {
    this.data = data;
    this.terrainGPU = app.terrainGPU;
    this.colliders = app.colliders;
    this.slots = arrangeIslandLandmarks(data, areas, [...(app.coveRocks?.instances ?? []), ...(app.shelfReef?.obstacles ?? [])]);
    this.slots.push(...(app.habitatEnrichment?.landUnderstory.landmarks ?? []));
    this.group = new Group();
    this.group.name = 'Reviewed Lowpoly Vault island landmarks';
    this.active = true;
    this.position = new Vector3();
    app.scene.add(this.group);
  }

  update(camera) {
    if (!this.active) return;
    this.position.copy(camera.position);
    for (const slot of this.slots) {
      const g = slot.ground;
      const distance = Math.hypot(g.x - this.position.x, g.y - this.position.y, g.z - this.position.z);
      if (distance > UNLOAD_RANGE) {
        slot.abort?.abort();
        // One request per visit. Returning after leaving the district lets a
        // visitor recover from a transient asset fetch or decode failure.
        delete slot.failure;
        if (slot.resources) {
          release(slot.resources);
          delete slot.resources;
        }
        continue;
      }
      if (slot.resources) {
        slot.resources.group.visible = distance < PLACE_RANGE;
      } else if (distance < PLACE_RANGE && !slot.pending && !slot.failure) {
        this.request(slot);
      }
    }
  }

  request(slot) {
    const controller = slot.abort = new AbortController();
    const inReach = () => this.active && !controller.signal.aborted && Math.hypot(this.position.x - slot.ground.x,
      this.position.y - slot.ground.y, this.position.z - slot.ground.z) < UNLOAD_RANGE;
    slot.pending = (async () => {
      try {
        const response = await fetch(URLS[slot.id], {signal: controller.signal});
        if (!response.ok) throw Error('Island GLB load failed ' + response.status + ': ' + slot.id);
        const gltf = parseGLB(await response.arrayBuffer());
        if (!inReach()) return;
        const resources = await makeModel(gltf, this.data, slot, this.terrainGPU, inReach);
        if (!inReach()) {
          release(resources);
          return;
        }
        if (resources.solid && this.colliders) {
          const {center, half} = resources.solid;
          resources.colliders = this.colliders;
          resources.collider = this.colliders.addBox(center, half, slot.yaw, {tag: slot.id, solid: true});
        }
        slot.resources = resources;
        this.group.add(resources.group);
      } catch (error) {
        if (inReach() && !controller.signal.aborted) slot.failure = String(error.message ?? error);
      } finally {
        delete slot.pending;
        delete slot.abort;
      }
    })();
  }

  dispose() {
    if (!this.active) return;
    this.active = false;
    for (const slot of this.slots) {
      slot.abort?.abort();
      release(slot.resources);
      delete slot.resources;
    }
    this.group.removeFromParent();
  }

  stats() {
    return this.slots.map(slot => ({id: slot.id, region: slot.region, point: [slot.ground.x, slot.ground.y, slot.ground.z],
      scale: slot.scale, depth: -slot.ground.height, ready: !!slot.resources, visible: slot.resources?.group.visible ?? false,
      loading: !!slot.pending, failure: slot.failure ?? null}));
  }
}
