// A school occupies the open flank of a streamed rock formation. Its home and
// patrol are fixed in world space, so returning to the reef finds the same fish.
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {BED_CELL} from './FreshwaterBedPlan.js';

const TAU = Math.PI * 2;

export function reefSchoolSite(data, crest, siblings, breakDepth) {
  const ix = Math.floor(crest.x / BED_CELL), iz = Math.floor(crest.z / BED_CELL);
  const seed = Math.imul(ix, 0x4e6d9) ^ Math.imul(iz, 0x826b3) ^ 0x3fe12;
  const random = mulberry32(seed), side = random() < .5 ? -1 : 1;
  const h = data.island.seaLevel, radius = 2.7 + random() * .9;
  const alongX = Math.cos(crest.reefYaw), alongZ = Math.sin(crest.reefYaw);
  for (const bank of [side, -side]) {
    const offset = (crest.radius + radius * .6 + 1.35) * bank;
    const x = crest.x - alongZ * offset, z = crest.z + alongX * offset;
    const floor = data.terrain.heightAt(x, z), depth = h - floor;
    // The ellipse follows the rock face. Check both ends and both shoulders
    // against the bed and maximum wave trough before reserving any fish.
    const minDepth = Math.max(1.65, breakDepth(x,z) + .48);
    let clear = true;
    for (let k = 0; k < 8; k++) {
      const theta = k * TAU / 8;
      const u = Math.cos(theta) * (radius + .7), v = Math.sin(theta) * (radius * .53 + .7);
      const px = x + alongX*u - alongZ*v, pz = z + alongZ*u + alongX*v;
      if (h - data.terrain.heightAt(px,pz) < minDepth) { clear = false; break; }
    }
    if (!clear || depth < minDepth || siblings.some(s => s.q &&
        Math.hypot(s.x-x,s.z-z) < s.radius + .7 && s.top > h - 1.55)) continue;
    return {id:'reef-school-' + crest.reefId, seed, x, z, h, floor, depth, radius,
      sea:true, water:'reef', reviewed:'aspidorhynchus', school:true, lowerDwell:false, cruise:1,
      length:.50 + random()*.17, count:7 + Math.floor(random()*4),
      routePhase:random()*TAU, alongX, alongZ, reefId:crest.reefId, routeRate:.16+random()*.046};
  }
  return null;
}

// Phase offsets make the outside fish follow a turning leader. Their spacing
// survives the turn at either end of the ledge, including at initial arrival.
export function reefPatrolTarget(out, group, fish, clock) {
  const angle = clock * group.routeRate + group.routePhase + fish.patrolLag;
  const lateral = fish.patrolSide + .13 * Math.sin(clock*.36 + fish.slot);
  const u = Math.cos(angle) * (group.radius + lateral);
  const v = Math.sin(angle) * (group.radius * .53 + lateral);
  out.x = group.x + group.alongX*u - group.alongZ*v;
  out.z = group.z + group.alongZ*u + group.alongX*v;
  return out;
}

export function reefObstacleTop(rocks,x,z,pad) {
  let top=-Infinity;
  if (rocks) for (const rock of rocks) {
    const dx=x-rock.x,dz=z-rock.z,r=rock.radius+pad;
    if (dx*dx+dz*dz<r*r) top=Math.max(top,rock.top);
  }
  return top;
}
