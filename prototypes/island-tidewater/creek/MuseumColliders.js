// Keep Tidewater's collision solver and index the island's trunks by location.
import { Colliders } from '../vendor/tidewater/src/world/Colliders.js';

export const WALK_CAPSULE = Object.freeze({ radius: .3, height: 1.75 });

export class MuseumColliders extends Colliders {
  constructor() {
    super();
    this.treeCells = new Map();
    this.nearTrees = [];
  }

  addCylinder(x, z, ...args) {
    const cylinder = super.addCylinder(x, z, ...args);
    const key = Math.floor(x / 32) + ',' + Math.floor(z / 32);
    let cell = this.treeCells.get(key);
    if (!cell) this.treeCells.set(key, cell = []);
    cell.push(cylinder);
    return cylinder;
  }

  removeBox(box) {
    const index = this.boxes.indexOf(box);
    if (index >= 0) this.boxes.splice(index, 1);
  }

  // Use the engine's oriented-box intersection while excluding the animal
  // being identified. Only nearby boxes can lie on this short sight line.
  sightDistance(origin, dir, distance, ownCollider) {
    const query = this.sightQuery ??= new Colliders();
    query.boxes.length = 0;
    for (const box of this.boxes) {
      if (box === ownCollider || !box.solid) continue;
      const reach = distance + box.radius;
      if (Math.abs(box.center.x-origin.x) <= reach && Math.abs(box.center.z-origin.z) <= reach) query.boxes.push(box);
    }
    return query.raycast(origin, dir, distance);
  }

  resolveCapsule(pos, radius, height, stepHeight = .35) {
    const all = this.cylinders, near = this.nearTrees;
    near.length = 0;
    const ix = Math.floor(pos.x / 32), iz = Math.floor(pos.z / 32);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cell = this.treeCells.get((ix + i) + ',' + (iz + j));
      if (!cell) continue;
      for (const cylinder of cell) {
        // Give the native radial solver a direction for an exact-centre spawn.
        if (pos.x === cylinder.x && pos.z === cylinder.z &&
            pos.y + height >= cylinder.yMin && pos.y + stepHeight <= cylinder.yMax) {
          pos.x += .001;
        }
        near.push(cylinder);
      }
    }
    this.cylinders = near;
    try {
      const hit = super.resolveCapsule(pos, radius, height, stepHeight);
      if (hit) this.hitCount = (this.hitCount ?? 0) + 1;
      return hit;
    } finally {
      this.cylinders = all;
    }
  }
}
