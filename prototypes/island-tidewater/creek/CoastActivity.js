// The ocean horizon and wave clock cover the whole view. Breaker emitters and
// near-shore history have a finite footprint around the actual sea-level contour.
// Index that contour once so crossing the island never scans the entire coast.
const cellSize = 1024;
const reach = 1800;
const cellKey = (i, j) => i + ',' + j;

export class CoastActivity {
  constructor(shelf) {
    this.shelf = shelf;
    this.cells = new Map();
    this.lastX = Infinity;
    this.lastZ = Infinity;
    this.surf = true;
    this.lighting = true;
    for (const segment of shelf.segments) {
      const [x, z] = segment.point;
      const key = cellKey(Math.floor(x / cellSize), Math.floor(z / cellSize));
      const cell = this.cells.get(key);
      if (cell) cell.push(segment);
      else this.cells.set(key, [segment]);
    }
  }

  update(x, z) {
    if (Math.abs(x - this.lastX) < 32 && Math.abs(z - this.lastZ) < 32) return;
    this.lastX = x;
    this.lastZ = z;
    let best = reach * reach;
    for (let j = Math.floor((z - reach) / cellSize); j <= Math.floor((z + reach) / cellSize); j++) {
      for (let i = Math.floor((x - reach) / cellSize); i <= Math.floor((x + reach) / cellSize); i++) {
        const cell = this.cells.get(cellKey(i, j));
        if (!cell) continue;
        for (const segment of cell) {
          const dx = x - segment.point[0], dz = z - segment.point[1];
          best = Math.min(best, dx * dx + dz * dz);
        }
      }
    }
    // Native recentering starts within 950 m. Wake before that point even
    // on a diagonal crossing of a coarse contour cell. Retain hysteresis.
    this.surf = best < (this.surf ? 1080 : 960) ** 2;
    this.lighting = this.surf || best < (this.lighting ? 1200 : 1060) ** 2 || this.shelf.marineAt(x, z) > 0;
  }
}
