import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';

const SHOALS = [
  {id: 'lake-shingle', reach: 60, halfWidth: 20, patches: 4},
  {id: 'wetland-runnels', reach: 108, halfWidth: 24, patches: 4},
  {id: 'alluvial-bend', reach: 68, halfWidth: 18, patches: 3},
  {id: 'east-source', reach: 60, halfWidth: 15, patches: 2},
  {id: 'north-source', reach: 46, halfWidth: 12, patches: 2},
];

const ROOT_EMBED = .018;

function shallowBed(data, x, z) {
  const [level, edge, flowX, flowZ] = data.field.sample(x, z);
  const speed = Math.hypot(flowX, flowZ);
  if (level <= data.island.seaLevel + .55 || edge > -.04 || speed > .24) return null;
  const heightAt = data.terrain.heightAt.bind(data.terrain);
  const y = heightAt(x, z), depth = level - y;
  if (depth < .10 || depth > .31) return null;
  const gx = (heightAt(x + .35, z) - heightAt(x - .35, z)) / .7;
  const gz = (heightAt(x, z + .35) - heightAt(x, z - .35)) / .7;
  const slope = Math.hypot(gx, gz);
  if (slope > .32) return null;
  return {x, z, y, depth, gx, gz, slope, speed, flow: [flowX, flowZ]};
}

function placePatch(data, spec, kind, shoal, root, random, plants) {
  // The long axis follows the measured shoreline contour where it is defined.
  const angle = root.slope > .02 ? Math.atan2(root.gx, -root.gz) : random() * Math.PI * 2;
  const dx = Math.cos(angle), dz = Math.sin(angle);
  const count = 6 + Math.floor(random() * 4);
  let planted = 0;
  for (let attempt = 0; attempt < 40 && planted < count; attempt++) {
    const along = (random() - .5) * 3.6, across = (random() - .5) * 1.25;
    const bed = shallowBed(data, root.x + dx * along - dz * across, root.z + dz * along + dx * across);
    if (!bed || plants.some(p => Math.hypot(p.x - bed.x, p.z - bed.z) < .31)) continue;
    const scale = Math.min(1.65 + random() * .72, (bed.depth + ROOT_EMBED + .045) / spec.height);
    const leafAboveWater = .005 + random() * .028;
    const lift = Math.max(0, bed.depth + ROOT_EMBED + leafAboveWater - spec.height * scale);
    if (lift > .16) continue;
    plants.push({
      id: spec.id, kind, x: bed.x, z: bed.z, y: bed.y - ROOT_EMBED, ground: bed.y,
      water: bed.y + bed.depth, depth: bed.depth, slope: bed.slope, scale, lift,
      height: spec.height * scale + lift, mode: spec.mode, range: spec.range,
      seed: random(), yaw: random() * Math.PI * 2, flex: spec.flex, flow: bed.flow,
      shoal,
    });
    planted++;
  }
  return planted;
}

export function planFreshwaterMarsilea(data, visits, specs) {
  const kind = specs.findIndex(spec => spec.id === 'marsilea');
  const spec = specs[kind];
  if (!spec) return [];

  const plants = [];
  SHOALS.forEach(({id, reach, halfWidth, patches}, index) => {
    const visit = visits[id];
    if (!visit) return;
    const [px] = visit.p, pz = visit.p.at(-1);
    const vx = visit.gaze[0] - px, vz = visit.gaze[2] - pz;
    const length = Math.hypot(vx, vz);
    if (length < .1) return;
    const dx = vx / length, dz = vz / length, random = mulberry32(21573 + 97 * index);
    const candidates = [];
    // Seek wet, sheltered shelves in the visible approach, then leave open
    // gaps between clumps. No planting occurs along the deep channel.
    for (let forward = 1.2; forward <= reach; forward += 1.1) {
      for (let side = -halfWidth; side <= halfWidth; side += 1.15) {
        const across = side + random() * .7;
        const x = px + dx * forward - dz * across, z = pz + dz * forward + dx * across;
        const bed = shallowBed(data, x, z);
        if (!bed) continue;
        const score = forward * .56 + Math.abs(across) * .29
          + Math.abs(bed.depth - .20) * 20 + bed.slope * 5 + bed.speed * 12;
        candidates.push({bed, score});
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const centres = [];
    for (const {bed} of candidates) {
      if (centres.some(p => Math.hypot(p.x - bed.x, p.z - bed.z) < 5.2)) continue;
      if (placePatch(data, spec, kind, id, bed, random, plants)) centres.push(bed);
      if (centres.length === patches) break;
    }
  });
  return plants;
}
