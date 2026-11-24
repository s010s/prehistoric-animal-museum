import { Vector3 } from '../vendor/tidewater/src/engine/index.js';
import { VegInstances, LodLevel } from '../vendor/tidewater/src/world/vegetation/InstanceLOD.js';

// Depth-only canopy shadow pool covering the whole island via VegInstances'
// spatial grid. Colour LODs must not turn their screen-door transition into a
// grid of holes in the shadow map. Uses the same rest pose and wind as colour.
export const CANOPY_SHADOW_LAYER = 4;
export const hasFixedCanopyShadow = () => true;
export const fixedCanopyShadowWGSL = 'museumCanopy.fixedShadows>.5';

const RANGE_METRES = 650;
const MAX_POOL_PER_SPECIES = 4096;

export class CanopyShadows {
  constructor(name, records, geometry, material) {
    this.records = records;
    this.inst = new VegInstances(records);
    let maxH = 0;
    for (let i = 0; i < records.length; i++) {
      if (records[i].H > maxH) maxH = records[i].H;
    }
    this.maxH = maxH;
    const capacity = Math.max(1, Math.min(records.length, MAX_POOL_PER_SPECIES));
    this.ids = new Int32Array(Math.max(1, records.length));
    this._dist2 = new Float32Array(Math.max(1, records.length));
    this.near = new LodLevel([{ geometry, material, castShadow: true, name }], capacity, new Vector3());
    this.near.setDynamic();
    this.meshes = this.near.meshes;
    for (const mesh of this.meshes) mesh.layers.set(CANOPY_SHADOW_LAYER);
    this.last = [Infinity, Infinity, Infinity];
    this.overflows = 0;
  }

  update(position) {
    // CSM reaches 400 m with a 200 m light margin. Do not view-frustum cull:
    // an off-screen crown can still cast a visible shadow into the view.
    if (Math.hypot(position.x - this.last[0], position.y - this.last[1], position.z - this.last[2]) < 12) return;
    this.last = [position.x, position.y, position.z];
    const { inst, records, ids, _dist2 } = this;
    const cs = inst.cellSize;
    const search = RANGE_METRES + this.maxH;
    const i0 = Math.floor((position.x - search) / cs);
    const i1 = Math.floor((position.x + search) / cs);
    const j0 = Math.floor((position.z - search) / cs);
    const j1 = Math.floor((position.z + search) / cs);
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = inst.cells.get(inst._key(i, j));
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const id = cell[k];
          const r = records[id];
          const dx = r.x - position.x;
          const dy = r.y - position.y;
          const dz = r.z - position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const limit = RANGE_METRES + r.H;
          if (d2 <= limit * limit) {
            ids[n++] = id;
            _dist2[id] = d2;
          }
        }
      }
    }
    if (n > this.near.capacity) {
      this.overflows++;
      const view = ids.subarray(0, n);
      view.sort((a, b) => _dist2[a] - _dist2[b]);
      n = this.near.capacity;
    }
    this.near.fill(inst, ids, n);
  }

  stats() {
    return {
      instances: this.inst.count,
      capacity: this.near.capacity,
      submitted: this.near.count,
      overflows: this.overflows,
      triangles: this.near.triangles,
      layer: CANOPY_SHADOW_LAYER,
      colourPass: false,
      rangeMetres: RANGE_METRES,
      selection: 'whole-island spatial grid; 3D range including crown height; no view-frustum cull',
      cameraLodDither: false,
    };
  }
}
