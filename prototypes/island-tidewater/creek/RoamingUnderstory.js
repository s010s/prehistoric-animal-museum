// Only the local nine cells need instance records. Their positions and age
// depend on the island, so a colony stays rooted when the visitor comes back.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {landContextAt} from './LandHabitatField.js';

const CELL = 42, FAMILY_SIZE = 4, CELL_SLOTS = FAMILY_SIZE + 2, VISIBLE_LIMIT = 10, TAU = Math.PI * 2;
export const ROAMING_PLANT_SLOTS = 9 * CELL_SLOTS;
const wrap = n => (n % 3 + 3) % 3;

function trunkGap(cells, x, z) {
  if (!cells) return Infinity;
  const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
  let gap = Infinity;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    for (const tree of cells.get((cx + i) + ',' + (cz + j)) ?? []) {
      gap = Math.min(gap, Math.hypot(tree.x - x, tree.z - z) - tree.radius);
    }
  }
  return gap;
}

function sourcePlant(ground, gap, random) {
  if (!ground || ground.snow > .13 || ground.trail > .44 || ground.rock > .74 || ground.slope > .54 || gap < 1.1) return null;
  switch (ground.biome) {
    case 'wet-bank': return 'onoclea';
    case 'woodland': return gap < 15 || ground.wood > .6 || random < .62 ? 'onoclea' : 'cycad';
    case 'meadow': return 'cycad';
    case 'dry-slope': return ground.slope < .42 && ground.rock < .53 ? 'cycad' : null;
    case 'upland': return gap < 22 && ground.wood > .19 && ground.snow < .025 ? 'onoclea' : null;
    default: return null;
  }
}

const abundance = {'wet-bank': .99, woodland: .98, meadow: .85, 'dry-slope': .64, upland: .62};

export class RoamingUnderstory {
  constructor(data, app, specs) {
    this.data = data;
    this.treeCells = app.colliders?.treeCells;
    this.forms = {};
    for (const [kind, spec] of specs.entries()) this.forms[spec.id] = {...spec, kind};
    this.cells = Array.from({length: 9}, () => ({x:NaN, z:NaN, plants:[]}));
    this.cx = this.cz = NaN;
    this.nearby = [];
    this.visible = this.triangles = this.cellsBuilt = this.bytesUploaded = 0;
  }

  planCell(cx, cz) {
    const rng = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x715ab521);
    const presence = rng(), species = rng();
    let best = null;
    // Screen neighbouring seed beds. Families follow a local contour
    // rather than carpeting rock, trail, snow or the exposed salt shore.
    for (let i = 0; i < 5; i++) {
      const x = (cx + .5) * CELL + (rng() - .5) * 22;
      const z = (cz + .5) * CELL + (rng() - .5) * 22;
      const g = landContextAt(this.data, x, z);
      if (!g) continue;
      const gap = trunkGap(this.treeCells, x, z), id = sourcePlant(g, gap, species);
      if (!id) continue;
      const score = abundance[g.biome] * (.70 + .30 * g.patchStrength) - Math.max(0, g.rock - .23) * .36;
      if (score > presence && (!best || score > best.score)) best = {x, z, g, score, id};
    }
    const plants = [];
    if (best) this.addFamily(plants, best, rng, species);
    this.addBankFerns(plants, cx, cz);
    return plants;
  }

  addFamily(plants, best, rng, species) {
    const {x, z, g, id} = best, form = this.forms[id];
    const angle = g.slope > .025 ? Math.atan2(g.gx, -g.gz) : rng() * TAU;
    const side = rng() < .5 ? 1 : -1;
    const reach = (id === 'cycad' ? 2.1 : 1.25) + rng() * 1.5;
    const size = id === 'onoclea' ? .87 + rng() * .42 : (g.biome === 'meadow' ? 1.28 : .94) + rng() * .43;
    const familySize = 2 + Math.floor((.5 * g.patchStrength + .5 * rng()) * 3);
    for (let i = 0; i < Math.min(FAMILY_SIZE, familySize); i++) {
      const along = i === 0 ? 0 : (i % 2 ? 1 : -1) * reach * side * (.7 + rng() * .5);
      const across = i === 0 ? 0 : (i === 3 ? 1.65 : 0) + (rng() - .5) * reach * .75;
      const px = x + Math.cos(angle) * along - Math.sin(angle) * across;
      const pz = z + Math.sin(angle) * along + Math.cos(angle) * across;
      const root = i === 0 ? g : landContextAt(this.data, px, pz);
      if (i && (root?.biome !== g.biome || sourcePlant(root, trunkGap(this.treeCells, px, pz), species) !== id)) continue;
      const scale = size * (i === 0 ? 1 : .55 + rng() * .25);
      if (plants.some(p => Math.hypot(p.x - px, p.z - pz) < scale * .65)) continue;
      plants.push({id, kind:form.kind, x:px, z:pz, y:root.y - .018, scale, yaw:rng() * TAU, seed:rng(),
        range:id === 'cycad' ? 44 : 39, mode:0, height:form.height * scale, flex:form.flex, flow:[0,0], lift:0});
    }
  }

  // A narrow bank can run through the corner of a mostly submerged cell.
  // Follow the water footprint there, even when the main seed bed is inland.
  addBankFerns(plants, cx, cz) {
    const ox = (cx + .5) * CELL, oz = (cz + .5) * CELL;
    const [level, edge] = this.data.field.sample(ox, oz);
    if (level <= this.data.island.seaLevel + .55 || Math.abs(edge) > 48) return;
    const rng = mulberry32(Math.imul(cx, 33497) ^ Math.imul(cz, 12637) ^ 0x145f179b);
    let bank;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = ox + i * 13 + (rng() - .5) * 4, z = oz + j * 13 + (rng() - .5) * 4;
      const g = landContextAt(this.data, x, z);
      if (!g?.fresh || g.biome !== 'wet-bank' || g.height > 2.9 || g.edge > 16 ||
          sourcePlant(g, trunkGap(this.treeCells, x, z), 0) !== 'onoclea') continue;
      if (plants.some(p => Math.hypot(p.x - x, p.z - z) < 7)) continue;
      const cost = Math.abs(g.edge - 3.5) + g.slope * 8 - g.patchStrength * 4;
      if (!bank || cost < bank.cost) bank = {x, z, g, cost};
    }
    if (!bank) return;
    const form = this.forms.onoclea, angle = Math.atan2(bank.g.gx, -bank.g.gz) + (rng() - .5);
    for (let i = 0; i < 2; i++) {
      const d = i * (1.25 + rng() * 1.4), x = bank.x + Math.cos(angle)*d, z = bank.z + Math.sin(angle)*d;
      const g = i ? landContextAt(this.data, x, z) : bank.g;
      if (!g?.fresh || g.biome !== 'wet-bank' || sourcePlant(g, trunkGap(this.treeCells, x, z), 0) !== 'onoclea') continue;
      const scale = (i ? .62 : .95) + rng() * .28;
      plants.push({id:'onoclea', kind:form.kind, x, z, y:g.y - .018, scale, yaw:rng() * TAU, seed:rng(),
        range:39, mode:0, height:form.height * scale, flex:form.flex, flow:[0,0], lift:0});
    }
  }

  update(position, batch, startIndex, writePlant) {
    const cx = Math.floor(position.x / CELL), cz = Math.floor(position.z / CELL);
    if (this.cx !== cx || this.cz !== cz) {
      this.cx = cx; this.cz = cz;
      for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
        const slot = wrap(z) * 3 + wrap(x), cell = this.cells[slot];
        if (cell.x === x && cell.z === z) continue;
        cell.x = x; cell.z = z; cell.plants = this.planCell(x, z);
        this.cellsBuilt++;
        const start = startIndex + slot * CELL_SLOTS;
        for (const [i, p] of cell.plants.entries()) writePlant(batch, start + i, p);
        if (cell.plants.length) this.dirty = true;
      }
    }
    this.nearby.length = 0;
    for (let slot = 0; slot < this.cells.length; slot++) {
      const plants = this.cells[slot].plants;
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i];
        p.distance = Math.hypot(position.x - p.x, position.y - p.y, position.z - p.z);
        p.relativeDistance = p.distance / p.range;
        if (p.relativeDistance >= 1) continue;
        p.recordIndex = startIndex + slot * CELL_SLOTS + i;
        this.nearby.push(p);
      }
    }
    // Let the eleventh closest crown define the outer fade in dense stands.
    // As neighbours exchange rank both are already below the visible size.
    this.nearby.sort((a, b) => a.relativeDistance - b.relativeDistance);
    const rangeFraction = this.nearby[VISIBLE_LIMIT]?.relativeDistance ?? 1;
    this.visible = this.triangles = 0;
    for (let i = 0; i < Math.min(this.nearby.length, VISIBLE_LIMIT); i++) {
      const p = this.nearby[i], offset = p.recordIndex * 16 + 9;
      const reach = rangeFraction * p.range;
      if (Math.abs(batch.data[offset] - reach) > .06) {
        batch.data[offset] = reach;
        this.dirty = true;
      }
      batch.add(p.kind, p.recordIndex);
      this.visible++;
      this.triangles += batch.kinds[p.kind].triangles;
    }
    if (this.dirty) {
      const data = batch.data.subarray(startIndex * 16);
      batch.instanceBuffer.write(data, startIndex * 64);
      this.bytesUploaded += data.byteLength;
      this.dirty = false;
    }
  }
}
