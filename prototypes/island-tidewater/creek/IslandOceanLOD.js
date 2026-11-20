import {CDLOD} from '../vendor/tidewater/src/core/CDLOD.js';

// A marine fragment under the composed bed is discarded by MuseumWaterMaterial.
// Skip whole small nodes whose lowest possible bed lies above the top of the
// ocean's own conservative wave envelope (25 m). The horizon uses native CDLOD.
export class IslandOceanLOD extends CDLOD {
  constructor(terrain) {
    super({gridSize:32, leafSize:8, levels:17, minY:-25, maxY:25});
    this.terrain = terrain;
    this.landTiles = new Map();
  }

  _add(x, z, size, lod) {
    const half = this.terrain.size / 2;
    if (size <= 512 && x >= -half && z >= -half && x + size <= half && z + size <= half) {
      const tile = Math.max(128, size);
      let cache = this.landTiles.get(tile);
      const columns = this.terrain.size / tile;
      if (!cache) {
        cache = new Uint8Array(columns * columns);
        this.landTiles.set(tile, cache);
      }
      const i = Math.floor((x + half) / tile), j = Math.floor((z + half) / tile);
      const key = j * columns + i;
      if (!cache[key]) {
        const ox = i * tile - half, oz = j * tile - half;
        // Parent-grid morphing and horizontal wave displacement can carry a
        // boundary vertex outside the patch. Include both in the bound.
        const margin = 32 + 4 * tile / this.G;
        const [low] = this.terrain.boundsFor(ox - margin, oz - margin, ox + tile + margin, oz + tile + margin);
        cache[key] = low > this.maxY + 1 ? 2 : 1;
      }
      if (cache[key] === 2) return;
    }
    super._add(x, z, size, lod);
  }
}
