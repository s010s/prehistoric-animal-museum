// A coordinate always produces the same deposit, even after its GPU tile is recycled.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

export const BED_CELL = 16;
export const BED_RADIUS = 2;
export const BED_CELL_CAPACITY = 48;
const TAU = Math.PI * 2;

function protectedReach(data, x, z) {
  if (x < -1536 || x > -512 || z < -672 || z > 352) return false;
  return (data.field.continuousSample?.sample(x, z)?.[1] ?? Infinity) < 74;
}

function bedAt(data, x, z, maxSlope = .68) {
  if (protectedReach(data, x, z)) return null;
  const [level, edge, flowX, flowZ] = data.field.sample(x, z);
  if (edge > -.08 || level <= data.island.seaLevel + .55) return null;
  const terrain = data.terrain, floor = terrain.heightAt(x, z), depth = level - floor;
  if (depth < .23) return null;
  const gx = (terrain.heightAt(x + .6, z) - terrain.heightAt(x - .6, z)) / 1.2;
  const gz = (terrain.heightAt(x, z + .6) - terrain.heightAt(x, z - .6)) / 1.2;
  const slope = Math.hypot(gx, gz);
  if (slope > maxSlope) return null;
  return {floor, depth, slope, gx, gz, flowX, flowZ, speed: Math.hypot(flowX, flowZ)};
}

export function planFreshwaterBedCell(data, ix, iz) {
  const seed = Math.imul(ix, 0x53a9e5) ^ Math.imul(iz, 0x7f4a7c15) ^ 0x73819;
  const random = mulberry32(seed);
  const x0 = ix * BED_CELL, z0 = iz * BED_CELL;
  const sites = [];
  // A cell spans less than one shoal. Use the local wetland and tarn extents
  // to distinguish organic deposits, rounded river gravels and glacial rubble.
  const xMid = x0 + BED_CELL / 2, zMid = z0 + BED_CELL / 2;
  const marsh = data.island.marsh, tarn = data.island.lakes.find(b => b.id === 'tarn');
  const wetland = Math.hypot((xMid - marsh.x) / marsh.rx, (zMid - marsh.z) / marsh.rz) < 1.04;
  const cirque = tarn && Math.hypot((xMid - tarn.center[0]) / tarn.rx, (zMid - tarn.center[1]) / tarn.rz) < 1.06;
  function place(kind, x, z, bed, scale, yaw = random() * TAU) {
    if (sites.length >= BED_CELL_CAPACITY) return;
    sites.push({kind, x, y: bed.floor - .018, z, scale, yaw, seed: random(),
      flowX: bed.flowX, flowZ: bed.flowZ, gx: bed.gx, gz: bed.gz, depth: bed.depth});
  }

  const pockets = 3 + Math.floor(random() * 3);
  for (let i = 0; i < pockets; i++) {
    const cx = x0 + random() * BED_CELL, cz = z0 + random() * BED_CELL;
    const anchor = bedAt(data, cx, cz);
    if (!anchor) continue;
    const shallow = anchor.depth < (wetland ? 2.7 : cirque ? 5.3 : 6.4);
    const trailing = anchor.speed > .15;
    const vegetation = shallow && random() < (wetland ? .79 : cirque ? .49 : .66);
    // Faster channels scour a clear thread. A wider lee-side ribbon of
    // smaller stones or plants marks each deposit downstream.
    const bearing = anchor.speed > .16 ? Math.atan2(anchor.flowZ, anchor.flowX) : random() * TAU;
    const dx = Math.cos(bearing), dz = Math.sin(bearing);
    const size = vegetation ? .62 + random() * .62 : .22 + random() * .42;
    const dominant = random();
    const members = vegetation ? 6 + Math.floor(random() * 6) : 4 + Math.floor(random() * 5);
    for (let j = 0; j < members; j++) {
      const along = (random() - .34) * (vegetation ? 4.4 : 3.5);
      const side = (random() - .5) * (vegetation ? 2.8 : 1.9);
      const x = cx + dx * along - dz * side, z = cz + dz * along + dx * side;
      const b = bedAt(data, x, z);
      if (!b) continue;
      if (vegetation) {
        if (b.slope > .43 || b.depth > (wetland ? 2.7 : cirque ? 5.3 : 6.4)) continue;
        const scale = Math.min(b.depth * .84, size * (.53 + random() * .68)) * (b.speed > .36 ? .72 : 1);
        place(trailing ? 'streamleaf' : 'ribbon', x, z, b, scale, -bearing + (random() - .5) * (trailing ? .68 : 2.2));
      } else {
        // Soft lake centres have small, widely spaced deposits. Talus remains
        // coarser on the steeper sides and floor of the glacial lake.
        if ((wetland || (!cirque && b.depth > 7 && b.speed < .1)) && j > 2) continue;
        const scale = Math.min(b.depth * .78, size * (j === 0 ? 1.2 : .15 + random() ** 2 * .72));
        const kind = cirque && dominant < .77 ? 'slab' : dominant < .55 ? 'cobble' : 'pebble';
        place(kind, x, z, b, scale * (cirque ? 1.34 : 1));
      }
    }
  }
  // Occasional broken limbs strand on the margins or collect in low-energy
  // pools. Leave open lake centres and upland talus clear of woody tangles.
  if (!cirque && random() < (wetland ? .62 : .45)) {
    const x = x0 + random() * BED_CELL, z = z0 + random() * BED_CELL;
    const b = bedAt(data, x, z);
    if (b && (b.depth < 5.6 || b.speed < .09) && b.slope < .19) {
      const yaw = -Math.atan2(b.flowZ, b.flowX) + (random() - .5) * (b.speed > .18 ? .86 : TAU);
      const scale = b.depth > 6 ? 1.18 + random() * .6 : .64 + random() * .56;
      place('limb', x, z, b, scale, yaw);
    }
  }
  // In the cirque shallows, coarse moraine breaks through the vegetated
  // shelf as isolated angular stones between stands of leaves.
  if (cirque) {
    for (let i = 0; i < 4; i++) {
      const x = x0 + (i % 2 + random()) * BED_CELL / 2;
      const z = z0 + (Math.floor(i / 2) + random()) * BED_CELL / 2;
      const b = bedAt(data, x, z);
      if (b && b.depth > 1.1 && b.depth < 6.4) place('slab', x, z, b, .22 + random() ** 2 * .66);
    }
  }
  // On the steep sides of running channels only the exposed bedding is fixed
  // in place. Follow the contour and recess most of the layer into the bank.
  for (let i = 0; i < 9; i++) {
    const x = x0 + ((i % 3) + random()) * BED_CELL / 3;
    const z = z0 + (Math.floor(i / 3) + random()) * BED_CELL / 3;
    const b = bedAt(data, x, z, 2.2);
    if (!b || b.speed < .14 || b.slope < .48 || b.depth < .38) continue;
    const along = Math.atan2(-b.gx, b.gz);
    const yaw = -along + (random() - .5) * .19;
    for (let j = 0; j < 3; j++) {
      const step = (j - 1) * (.53 + random() * .53);
      const cx = x + Math.cos(along) * step, cz = z + Math.sin(along) * step;
      const ledge = bedAt(data, cx, cz, 2.2);
      if (ledge && ledge.slope > .38) place('ledge', cx, cz, ledge, .48 + random() * .75, yaw);
    }
  }
  return sites;
}
