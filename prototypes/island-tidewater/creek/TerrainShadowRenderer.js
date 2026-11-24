import { GPU } from '../vendor/tidewater/src/engine/gpu/GPU.js';
import { InstancedBufferGeometry, InstancedBufferAttribute } from '../vendor/tidewater/src/engine/geometry/index.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { selectTerrainNodesForOrtho } from './TerrainCDLODSelect.js';

function makePacket(geometry, capacity, cascade, index) {
  const copy = new InstancedBufferGeometry();
  const nodes = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  // Source attributes are immutable. MeshRenderer owns GPU buffers per
  // geometry, so each cascade keeps its own nodeData buffer and disposal event.
  copy.setAttribute('position', geometry.attributes.position);
  copy.setAttribute('nodeData', nodes);
  copy.setIndex(geometry.index);
  copy.instanceCount = 0;
  return {
    copy,
    nodes,
    cascade,
    label: 'shadow cascade ' + index,
    matrix: new Float32Array(16),
    viewPos: new Float32Array(3),
    frame: -1,
  };
}

// Pass this wrapper to shadows.render(). Each CSM cascade selects its own
// CDLOD terrain nodes directly against that cascade's orthographic light
// frustum (independent of the main camera frustum) and renders terrain depth
// two-sided so steep back-facing cliff walls cannot leak sunlight into valleys.
export class TerrainShadowRenderer {
  constructor(terrain, shadows, renderer) {
    this.terrain = terrain;
    this.shadows = shadows;
    this.native = renderer;
    this.packets = [];
    this.boxes = new Map();
    this.enabled = true;
    this.shadowMaterial = null;
    const { lod, data, mesh, material, gpu } = terrain;
    const geo = lod.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    if (lod.G !== 64 || lod.leafSize !== 8 || data.size !== 32768 || data.texel !== 16 || !data.boundsFor ||
        mesh.geometry !== geo || mesh.material !== material || mesh.isInstancedMesh || mesh.frustumCulled ||
        geo.indirect || geo.groups.length || geo.drawRange.start !== 0 || geo.drawRange.count < idx?.count ||
        pos?.count !== 4225 || idx?.count !== 24576 || geo.attributes.nodeData !== lod.nodeAttr ||
        material.attributes.nodeData !== 'vec4f' || shadows.cascades.length !== 3) return;
    this.source = {
      geo,
      material,
      vertex: material.vertex,
      pos,
      idx,
      posArray: pos.array,
      idxArray: idx.array,
      positions: pos.version,
      indices: idx.version,
      attributes: geo.attributesVersion,
      nodes: lod.nodeArray,
      bounds: data.boundsFor,
    };
    this.packets = shadows.cascades.map((cascade, i) => makePacket(geo, lod.maxInstances, cascade, i));
    // Dedicated vertex-only two-sided depth material sharing the live viewPos
    // uniform reference so geomorphing matches the main pass exactly without
    // mutating terrain.material.side mid-frame.
    this.shadowMaterial = new Material({
      name: 'MuseumTerrainShadowTwoSided',
      side: 'double',
      lit: false,
      modules: [gpu.module, lod.module],
      attributes: { nodeData: 'vec4f' },
      uniforms: { viewPos: ['vec3f', terrain.uViewPos.value] },
      vertex: material.vertex,
    });
  }

  // DynamicMuseumShadows uses these native entry points for its unchanged
  // animal draws and scissored restores. Keep `this` bound to the real renderer.
  get precompiling() { return this.native.precompiling; }
  get syncPipelines() { return this.native.syncPipelines; }
  set syncPipelines(value) { this.native.syncPipelines = value; }
  get stats() { return this.native.stats; }
  _beginFrame() { return this.native._beginFrame(); }
  collect(scene, pass) { return this.native.collect(scene, pass); }
  drawItems(renderPass, items, pass) { return this.native.drawItems(renderPass, items, pass); }

  prepare(packet, pass) {
    const { lod, data, mesh, uViewPos } = this.terrain;
    const s = this.source;
    const g = s.geo;
    if (mesh.geometry !== g || mesh.material !== s.material || mesh.frustumCulled || s.material.vertex !== s.vertex ||
        s.attributes !== g.attributesVersion || g.attributes.position !== s.pos || g.index !== s.idx ||
        s.pos.array !== s.posArray || s.idx.array !== s.idxArray || s.pos.version !== s.positions || s.idx.version !== s.indices ||
        g.indirect || g.groups.length || g.drawRange.start !== 0 || g.drawRange.count < g.index.count ||
        geoChanged(lod, g, s) || data.boundsFor !== s.bounds) return false;
    const values = pass.frameBlock.fields.viewProj.value.elements;
    const m = packet.matrix;
    const vp = uViewPos.value;
    if (packet.frame === GPU.frame &&
        packet.viewPos[0] === vp.x && packet.viewPos[1] === vp.y && packet.viewPos[2] === vp.z) {
      let same = true;
      for (let i = 0; i < 16; i++) if (m[i] !== Math.fround(values[i])) { same = false; break; }
      if (same) return true;
    }
    m.set(values);
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false;
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return false;
    if (this.boxes.size > 16384) this.boxes.clear();

    const kept = selectTerrainNodesForOrtho(this.terrain, vp, m, this.shadows.size, packet.nodes.array, this.boxes);
    packet.frame = GPU.frame;
    packet.viewPos[0] = vp.x;
    packet.viewPos[1] = vp.y;
    packet.viewPos[2] = vp.z;
    packet.copy.instanceCount = kept;
    if (kept > 0) {
      packet.nodes.clearUpdateRanges();
      packet.nodes.addUpdateRange(0, kept * 4);
      packet.nodes.needsUpdate = true;
    }
    return true;
  }

  render(scene, pass) {
    const mesh = this.terrain.mesh;
    if (this.enabled && this.shadowMaterial && pass.kind === 'depth' && pass.depthFormat === 'depth32float' &&
        pass.depthCompare === 'less-equal' && !pass.items && !pass.scissorRect && !pass.viewport) {
      if (this.native.precompiling) {
        const originalGeo = mesh.geometry;
        const originalMat = mesh.material;
        mesh.material = this.shadowMaterial;
        if (this.packets[0]) mesh.geometry = this.packets[0].copy;
        try { return this.native.render(scene, pass); }
        finally { mesh.geometry = originalGeo; mesh.material = originalMat; }
      }
      for (const packet of this.packets) {
        if (pass.camera !== packet.cascade.camera || pass.frameBlock !== packet.cascade.block || pass.label !== packet.label) continue;
        if (!this.prepare(packet, pass)) break;
        const originalGeo = mesh.geometry;
        const originalMat = mesh.material;
        mesh.geometry = packet.copy;
        mesh.material = this.shadowMaterial;
        try { return this.native.render(scene, pass); }
        finally { mesh.geometry = originalGeo; mesh.material = originalMat; }
      }
    }
    return this.native.render(scene, pass);
  }

  reportStats() {
    return {
      enabled: this.enabled && this.packets.length === 3 && !!this.shadowMaterial,
      selection: 'independent per-cascade orthographic light-frustum CDLOD',
      cullMode: 'none (two-sided depth)',
      cascadeNodes: this.packets.map(p => p.copy.instanceCount),
      cachedBoxes: this.boxes.size,
    };
  }

  dispose() {
    this.enabled = false;
    this.boxes.clear();
    const packets = this.packets;
    const mat = this.shadowMaterial;
    this.packets = [];
    this.shadowMaterial = null;
    const release = () => {
      for (const packet of packets) packet.copy.dispose();
      mat?.uniformBlock.buffer?.destroy();
      mat?.dispose();
    };
    if (GPU.encoder) GPU.onSubmit(null, release);
    else release();
  }
}

function geoChanged(lod, geo, source) {
  return lod.geometry !== geo || lod.nodeArray !== source.nodes || geo.attributes.nodeData !== lod.nodeAttr ||
    lod.nodeAttr.array !== source.nodes || geo.instanceCount !== lod.count || lod.count > lod.maxInstances;
}
