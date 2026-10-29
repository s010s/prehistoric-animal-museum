import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { FullscreenPass } from '../vendor/tidewater/src/engine/render/FullscreenPass.js';
import { setFrameCamera } from '../vendor/tidewater/src/engine/render/Frame.js';
import {group0ForBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';

// Keep native CSM fitting, periods, final texture and PCSS. Only the few animated
// museum casters are redrawn between static refreshes of the slower cascades.
const controllers = new WeakMap();
const LEGACY_NAMES = new Set(['museum:apatosaurus', 'museum:triceratops']);
const DEPTH_PASS_KEY = 'depth.0..depth32float.less-equal..';
const rectUnion = (a, b) => {
  if (!a) return b ? [...b] : null;
  if (!b) return [...a];
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y];
};
const sameValues = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
const fullRect = size => [0, 0, size, size];

// CSM is orthographic. Project the eight corners of a world-space sphere's
// enclosing box; including two extra pixels covers rasterization at its edge.
function projectedRect(mesh, cascade, size, unbounded) {
  if (unbounded) return fullRect(size);
  const sphere = mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry?.boundingSphere;
  const m = mesh.matrixWorld?.elements, p = cascade.viewProj?.elements;
  if (!sphere || !m || !p || !Number.isFinite(sphere.radius) || sphere.radius < 0) return fullRect(size);
  const c = sphere.center;
  const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12];
  const y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13];
  const z = m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14];
  const r = sphere.radius * Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
  if (![x, y, z, r].every(Number.isFinite)) return fullRect(size);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) {
    const bx = x + dx, by = y + dy, bz = z + dz;
    const w = p[3] * bx + p[7] * by + p[11] * bz + p[15];
    if (!Number.isFinite(w) || w <= 1e-8) return fullRect(size);
    const px = (p[0] * bx + p[4] * by + p[8] * bz + p[12]) / w;
    const py = (p[1] * bx + p[5] * by + p[9] * bz + p[13]) / w;
    const pz = (p[2] * bx + p[6] * by + p[10] * bz + p[14]) / w;
    if (![px, py, pz].every(Number.isFinite)) return fullRect(size);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
  }
  if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1 || maxZ < 0 || minZ > 1) return null;
  const clamp = n => Math.max(0, Math.min(size, n));
  const left = clamp(Math.floor((minX * .5 + .5) * size) - 2);
  const top = clamp(Math.floor((.5 - maxY * .5) * size) - 2);
  const right = clamp(Math.ceil((maxX * .5 + .5) * size) + 2);
  const bottom = clamp(Math.ceil((.5 - minY * .5) * size) + 2);
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}

function descendants(root, visit) {
  if (!root) return;
  visit(root);
  for (const child of root.children ?? []) descendants(child, visit);
}

export function attachDynamicMuseumShadows(app, { enabled = true } = {}) {
  const existing = controllers.get(app);
  if (existing) return existing;
  const shadows = app.shadows ?? app.csm;
  if (!shadows?.render || !shadows.texture || !shadows.cascades?.length) throw Error('Dynamic museum shadows require native sun cascades');
  const nativeRender = shadows.render;
  let enabledReview = !!enabled, disposed = false;
  let finalTexture = shadows.texture, staticBase = null, restorePasses = [], layers = [];
  let resourceSize = 0, resourceCount = 0, previousPeriods = null, previousSun = null;
  let dynamic = new Map(), legacyMeshes = [], legacyScene = null, sceneChildren = [];
  let staticRefreshes = 0, dynamicDraws = 0, restoredPixels = 0, fullRestores = 0;
  let frameRestoredPixels = 0, frameDynamicDraws = 0, activeCasters = 0;

  function invalidate(markDirty = true) {
    for (const layer of layers) { layer.valid = false; layer.previousRect = null; layer.matrix = null; layer.lastRect = null; }
    if (markDirty) for (const cascade of shadows.cascades) cascade.dirty = true;
  }
  function retire(texture) {
    if (!texture) return;
    if (GPU.encoder) GPU.onSubmit(null, () => texture.destroy());
    else texture.destroy();
  }
  function ensureResources() {
    const size = shadows.size, count = shadows.cascades.length;
    if (staticBase && size === resourceSize && count === resourceCount && shadows.texture === finalTexture) return;
    retire(staticBase);
    finalTexture = shadows.texture; resourceSize = size; resourceCount = count;
    staticBase = new Texture({ label: 'Museum sun static base', width: size, height: size, depth: count,
      dimension: '2d-array', format: 'depth32float', usage: ['sample', 'render'] });
    layers = shadows.cascades.map(() => ({ valid: false, matrix: null, previousRect: null, lastRect: null }));
    // A compile-time layer avoids overwriting one shared uniform between passes
    // recorded into the same submission.
    restorePasses = shadows.cascades.map((_, i) => new FullscreenPass({
      label: 'Museum restore static shadow ' + i,
      colorFormats: [], depthFormat: 'depth32float', depthCompare: 'always', depthWrite: true,
      bindings: { museumStaticSunDepth: { texture: () => staticBase, viewDimension: '2d-array' } },
      code: `@fragment fn fs(in: FSIn) -> @builtin(frag_depth) f32 {
  return textureLoad(museumStaticSunDepth, vec2i(in.pos.xy), ${i}, 0);
}`,
    }));
    invalidate(false);
  }
  function discover(scene) {
    // Old museum animals are closed over by app.animals. Cache their scene-graph
    // lookup, while noticing additions/replacements of the scene's root groups.
    const children = scene.children ?? [];
    if (legacyScene !== scene || children.length !== sceneChildren.length || children.some((child, i) => child !== sceneChildren[i])) {
      legacyScene = scene; sceneChildren = [...children]; legacyMeshes = [];
      descendants(scene, object => {
        if (LEGACY_NAMES.has(object.name)) descendants(object, child => { if (child.isMesh) legacyMeshes.push(child); });
      });
    }
    const next = new Map();
    const addModel = model => { for (const mesh of model?.meshes ?? []) next.set(mesh, { unbounded: false, batch: null }); };
    for (const actor of app.sampleMuseumLife?.actors ?? []) addModel(actor.model);
    for (const flyer of app.life?.pterosaurs?.flyers ?? []) addModel(flyer.model);
    addModel(app.life?.insect?.model);
    for (const crawler of app.life?.benthos?.crawlers ?? []) addModel(crawler.model);
    // These two older animals intentionally have no native frustum culling:
    // their rest bounds do not enclose all morph/skin motion. Full depth restore
    // is conservative and still does not redraw static forest geometry.
    for (const mesh of legacyMeshes) next.set(mesh, { unbounded: true, batch: null });
    const batch = app.life?.batch;
    if (batch?.geometry) descendants(app.life.group, mesh => {
      if (mesh.isMesh && mesh.geometry === batch.geometry) next.set(mesh, { unbounded: true, batch });
    });
    if (next.size !== dynamic.size || [...next.keys()].some(mesh => !dynamic.has(mesh))) invalidate(false);
    dynamic = next;
  }
  function eligible(mesh) {
    const entry = dynamic.get(mesh);
    return !!entry && (!entry.batch || entry.batch.shadowOffsets?.length > 0);
  }
  function render(scene, meshRenderer, indices) {
    frameRestoredPixels = 0; frameDynamicDraws = 0; activeCasters = 0;
    for (const layer of layers) layer.lastRect = null;
    if (disposed || !enabledReview) return nativeRender.call(this, scene, meshRenderer, indices);
    if (meshRenderer.precompiling || this.enabled === false) {
      invalidate();
      return nativeRender.call(this, scene, meshRenderer, indices);
    }
    try {
      ensureResources(); discover(scene);
      const periods = [...this.periods];
      const sun = this.lastSun ? [this.lastSun.x, this.lastSun.y, this.lastSun.z] : null;
      if (previousPeriods && !sameValues(previousPeriods, periods)) invalidate(false);
      if (previousSun && sun && !sameValues(previousSun, sun)) invalidate(false);
      previousPeriods = periods; previousSun = sun;
      const cached = this.cascades.map((_, i) => i).filter(i => periods[i] > 1);
      const nativeIndices = indices.filter(i => !(periods[i] > 1));
      const refresh = cached.filter(i => indices.includes(i) || !layers[i].valid || !sameValues(layers[i].matrix, this.cascades[i].viewProj.elements));
      // drawItems shares the native per-object slot across every pass. It also
      // needs the native per-frame draw buffer when no cascade was scheduled.
      meshRenderer._beginFrame();
      nativeRender.call(this, scene, meshRenderer, nativeIndices);
      if (refresh.length) {
        const saved = [...dynamic.keys()].map(mesh => [mesh, mesh.castShadow]);
        try {
          for (const [mesh] of saved) mesh.castShadow = false;
          this.texture = staticBase;
          nativeRender.call(this, scene, meshRenderer, refresh);
        } finally {
          this.texture = finalTexture;
          for (const [mesh, castShadow] of saved) mesh.castShadow = castShadow;
        }
        staticRefreshes += refresh.length;
        for (const i of refresh) {
          layers[i].valid = true;
          layers[i].matrix = Array.from(this.cascades[i].viewProj.elements);
        }
      }
      const drawn = new Set();
      for (const i of cached) {
        const cascade = this.cascades[i], layer = layers[i];
        // Even a stale matrix needs current simulation time for animated hooks.
        setFrameCamera(cascade.camera, resourceSize, resourceSize, { block: cascade.block });
        const pass = { label: 'Museum current dynamic shadow ' + i,
          kind: 'depth', late: false, colorFormats: [], depthFormat: 'depth32float', depthCompare: 'less-equal',
          camera: cascade.camera, frameBlock: cascade.block, layerMask: this.layerMask,
          depthBias: 2, depthBiasSlopeScale: 1.5, passKey: DEPTH_PASS_KEY,
          filter: eligible };
        // Native collection honors ancestor visibility, caster flag, layers,
        // material groups, light frustum and onBeforeRender (Aeger's offsets).
        const lists = meshRenderer.collect(scene, pass);
        let currentRect = null;
        for (const item of [...lists.opaque, ...lists.transparent]) {
          const mesh = item.object;
          drawn.add(mesh);
          currentRect = rectUnion(currentRect, projectedRect(mesh, cascade, resourceSize, dynamic.get(mesh).unbounded));
        }
        const rect = refresh.includes(i) ? fullRect(resourceSize) : rectUnion(layer.previousRect, currentRect);
        if (!rect) { layer.previousRect = currentRect; continue; }
        const rp = GPU.getEncoder().beginRenderPass({ label: pass.label, colorAttachments: [],
          depthStencilAttachment: { view: finalTexture.view({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }),
            depthLoadOp: 'load', depthStoreOp: 'store' } });
        const syncPipelines = meshRenderer.syncPipelines;
        try {
          rp.setScissorRect(...rect);
          restorePasses[i].draw(rp, cascade.block);
          rp.setScissorRect(0, 0, resourceSize, resourceSize);
          rp.setBindGroup(0,group0ForBlock(cascade.block,'render').getBindGroup());
          // Normally these are the already-precompiled native shadow pipelines.
          // A newly added animal must not silently lose its first shadow frame.
          meshRenderer.syncPipelines = true;
          const before = meshRenderer.stats?.draws;
          meshRenderer.drawItems(rp, lists.opaque, pass);
          meshRenderer.drawItems(rp, lists.transparent, pass);
          const after = meshRenderer.stats?.draws;
          const count = Number.isFinite(before) && Number.isFinite(after) ? after - before : lists.opaque.length + lists.transparent.length;
          dynamicDraws += count; frameDynamicDraws += count;
        } finally {
          meshRenderer.syncPipelines = syncPipelines;
          rp.end();
        }
        const pixels = rect[2] * rect[3];
        restoredPixels += pixels; frameRestoredPixels += pixels;
        if (pixels === resourceSize * resourceSize) fullRestores++;
        layer.lastRect = [...rect]; layer.previousRect = currentRect;
      }
      activeCasters = drawn.size;
    } catch (error) {
      invalidate();
      throw error;
    }
  }
  function stats() {
    return { enabled: enabledReview && !disposed, disposed, casters: dynamic.size, activeCasters,
      staticRefreshes, dynamicDraws, restoredPixels, fullRestores, frameDynamicDraws, frameRestoredPixels,
      cascadePeriods: [...shadows.periods], cachedLayers: layers.map((layer, i) => ({ index: i, valid: layer.valid,
        lastRect: layer.lastRect ? [...layer.lastRect] : null })),
      lastRect: layers.map(layer => layer.lastRect ? [...layer.lastRect] : null),
      unboundedCasters: [...dynamic].filter(([, entry]) => entry.unbounded).map(([mesh]) => mesh.name),
      staticBaseBytes: resourceSize * resourceSize * resourceCount * 4,
      finalTexturePreserved: shadows.texture === finalTexture,
      coverage: 'sample museum skins, legacy museum animals, Vault pterosaurs/Meganeura/Eryon, active Aeger shadow offsets; static coral/shell batches excluded' };
  }
  const controller = {
    setEnabled(value) {
      if (!disposed && enabledReview !== !!value) { enabledReview = !!value; invalidate(); }
      return stats();
    },
    stats,
    dispose() {
      if (disposed) return;
      disposed = true; invalidate();
      if (shadows.render === render) shadows.render = nativeRender;
      controllers.delete(app); retire(staticBase); staticBase = null; restorePasses = [];
    },
  };
  shadows.render = render; controllers.set(app, controller); invalidate();
  return controller;
}
