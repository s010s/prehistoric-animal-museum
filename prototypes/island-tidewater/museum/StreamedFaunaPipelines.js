import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { composeShader } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import { buildMeshShader } from '../vendor/tidewater/src/engine/render/MeshShader.js';
import { DEPTH_FORMAT, LAYERS, SCENE_FORMATS } from '../vendor/tidewater/src/engine/render/SceneRenderer.js';
import { SceneLighting } from '../vendor/tidewater/src/engine/render/wgsl/lighting.js';

const mainPass = (late, defines) => ({ kind: 'main', late, colorFormats: SCENE_FORMATS, depthFormat: DEPTH_FORMAT, defines,
  depthCompare: 'greater-equal', passKey: `main.${Number(late)}.${SCENE_FORMATS.join(',')}.${DEPTH_FORMAT}.greater-equal..${defines ? JSON.stringify(defines) : ''}` });
const lateLayers = (1 << LAYERS.WATER) | (1 << LAYERS.TRANSPARENT);

async function waitForCompilation(jobs, signal) {
  if (!signal) return Promise.all(jobs);
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([Promise.all(jobs), new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function markStreamedFaunaMaterials(model, assetId) {
  const materials = [...new Set(model.meshes.flatMap(mesh => mesh.material))];
  for (const [index, material] of materials.entries()) material.userData.streamedFauna = `${assetId}:${index}`;
}

// The native renderer pairs each pipeline with a material's actual bindings.
// Keep only compiled shader/pipeline handles in a stable cache and scope the
// material bindings to the lifetime of the drawable geometry/material.
export function attachStreamedFaunaPipelines(renderer, mainPassDefines) {
  const opaquePass = mainPass(false, mainPassDefines), latePass = mainPass(true, mainPassDefines);
  const nativePipeline = renderer._pipeline;
  const variants = new Map();
  const instances = new WeakMap();
  let reused = 0;
  function pipeline(material, layout, pass) {
    const asset = material.userData.streamedFauna;
    if (!asset) return nativePipeline.call(this, material, layout, pass);
    const scope = `${layout.key}|${pass.passKey}|${SceneLighting.version}`;
    let own = instances.get(material);
    if (!own) instances.set(material, own = new Map());
    const cached = own.get(scope);
    if (cached?.version === material.version && !cached.pipeline.handle.failed) return cached.pipeline;
    // Version and numeric material id vary between reacquisitions. The remaining
    // native key covers fixed-function state. The hooks and defines distinguish
    // the reversible wing review shader variants using that same asset slot.
    const variant = JSON.stringify([asset, scope, material.pipelineKey().replace(/^\d+\.\d+\./, ''),
      material.modules.map(module => module.id), material.defines, material.lit,
      material.vertex, material.surface, material.output, material.shadow]);
    let compiled = variants.get(variant);
    let bound;
    if (compiled && !compiled.handle.failed) {
      const source = buildMeshShader(material, layout.layout, pass);
      const composed = composeShader({ ...source, stage: 'render', label: material.name });
      bound = { ...compiled, bindings: composed.bindings };
      reused++;
    } else {
      const transient = `streamed-fauna:${material.id}`;
      const pendingBefore = GPU._pending.size;
      try { bound = this._createPipeline(material, layout, pass, transient); }
      finally { this.pipelines.delete(transient); this.stats.pipelines = this.pipelines.size; }
      // The pinned mesh renderer enqueues one native compile promise when it
      // creates a pipeline. Capture that promise, independently of world jobs.
      const completion = GPU._pending.size > pendingBefore ? Array.from(GPU._pending).at(-1) : Promise.resolve();
      compiled = { handle: bound.handle, label: bound.label, completion };
      bound.completion = completion;
      variants.set(variant, compiled);
    }
    own.set(scope, { version: material.version, pipeline: bound });
    return bound;
  }
  renderer._pipeline = pipeline;
  return {
    async prepareMain(model, signal) {
      signal?.throwIfAborted();
      const pipelines = new Set();
      for (const mesh of model.meshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const layout = renderer._cachedLayout(mesh, mesh.geometry, material);
          if (mesh.layers.mask & (1 << LAYERS.OPAQUE)) pipelines.add(pipeline.call(renderer, material, layout, opaquePass));
          if (mesh.layers.mask & lateLayers) pipelines.add(pipeline.call(renderer, material, layout, latePass));
        }
      }
      await waitForCompilation([...pipelines].map(value => value.completion), signal);
      for (const { handle, label } of pipelines) if (!handle.pipeline) throw Error(`Animal rendering could not prepare ${label}`);
    },
    stats: () => ({ compiledVariants: variants.size, reusedVariants: reused }),
    dispose() {
      if (renderer._pipeline === pipeline) renderer._pipeline = nativePipeline;
      variants.clear();
    },
  };
}
