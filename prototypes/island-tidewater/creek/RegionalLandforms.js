// Island XZ in metres. These local landforms join the inherited island at the
// tile perimeter. Their sampled heights drive collision, materials and water.
import {TerrainData} from '../vendor/tidewater/src/world/TerrainData.js';
import {Noise2D} from '../vendor/tidewater/src/util/Noise.js';
import {smooth} from './ContinuousSample.js';

const noise = new Noise2D(58431);
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const mix = (a, b, w) => a + (b - a) * w;
const bell = x => Math.exp(-x * x);
const envelope = (distance, inner, outer) => 1 - smooth(inner, outer, Math.abs(distance));

export const REGIONAL_LANDFORMS = [
  {id:'alluvial-bend', center:[7850, 4200], res:512, size:512, inner:215, outer:248, offset:[0, 0]},
  {id:'lake-shingle', center:[3210, -1930], res:512, size:512, inner:215, outer:248, offset:[512, 0]},
  {id:'tarn-moraine', center:[3850, -4840], res:512, size:512, inner:215, outer:248, offset:[0, 512]},
  {id:'dry-escarpment', center:[4980, 520], res:256, size:320, inner:126, outer:154, offset:[512, 512]},
  {id:'wetland-runnels', center:[5480, 5900], res:256, size:320, inner:126, outer:154, offset:[768, 512]},
];

// The old tributary retains its level and outer course. A variable-width bend
// pinches into a riffle; its point bar pushes the deepest flow to the far bank.
// The CPU mesh and WGSL queries both interpolate these same eight-metre rows.
export function authorRegionalTributary(source) {
  return source.map(([x, level, width, z]) => {
    const d = z - REGIONAL_LANDFORMS[0].center[1];
    const weight = envelope(d, 102, 171);
    const bend = 21 * bell((d + 16) / 71) - 9 * bell((d - 85) / 40) - 8 * bell((d + 111) / 39);
    const reducedWidth = 14 + 10 * bell((d + 12) / 74) + 4 * bell((d - 115) / 28);
    return [x + bend * weight, level, mix(width, reducedWidth, weight), z];
  });
}

// The tributary atlas's fourth channel can store a lateral current because
// rows already encode Z by index. Outside this bend, retain the existing flow.
export function regionalTributaryDrift(rows) {
  return Float32Array.from(rows, ([,,,z], i) => {
    const d = z - REGIONAL_LANDFORMS[0].center[1];
    const w = envelope(d, 128, 171);
    if (w === 0) return .035;
    const before = rows[Math.max(0, i-1)], after = rows[Math.min(rows.length-1, i+1)];
    return mix(.035, .3 * (after[0] - before[0]) / (after[3] - before[3]), w);
  });
}

function profileAt(rows, z) {
  const f = clamp((z - rows[0][3]) / 8, 0, rows.length - 1.001);
  const i = Math.floor(f), t = f - i;
  const a = rows[i], b = rows[i + 1];
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// Finish the lower tributary where its inherited flat bed meets the mudplain.
// The existing tributary and wetland already share this water datum.
export function gradeTributaryConfluence(grids, world) {
  for (const grid of grids) {
    const step = grid.texel, startX = grid.center[0] - grid.size / 2 + step / 2;
    const startZ = grid.center[1] - grid.size / 2 + step / 2;
    const firstRow = Math.max(0, Math.ceil((5520 - startZ) / step));
    const lastRow = Math.min(grid.res - 1, Math.floor((6060 - startZ) / step));
    for (let j = firstRow; j <= lastRow; j++) {
      const z = startZ + j * step;
      const [x, level, width] = profileAt(world.tributary, z);
      const taper = smooth(5520, 5620, z) * (1 - smooth(5890, 6060, z));
      const axis = x + 4 * noise.noise(z / 91, 89.3);
      const depth = .99 + .17 * noise.noise(z / 74, 32.7);
      const first = Math.max(0, Math.ceil((axis - width - 3 - startX) / step));
      const last = Math.min(grid.res - 1, Math.floor((axis + width + 3 - startX) / step));
      for (let i = first; i <= last; i++) {
        const cross = Math.abs(startX + i * step - axis) / width;
        const k = j * grid.res + i, old = grid.heights[k];
        const bank = 1 - smooth(.27, .96, cross);
        const target = level - bank * depth;
        grid.heights[k] = Math.min(old, mix(old, target, taper * bank));
      }
    }
  }
}

function alluvialBend(x, z, h, grain, [center, level, width]) {
  const d = z - 4200;
  const cross = x - center;
  const u = cross / width;
  const edge = Math.abs(cross) - width;
  const bend = bell((d + 15) / 71);
  // Concave outer bank and convex point bar. The concavity form reaches the
  // waterline smoothly without carving a second, dry canyon outside it.
  const thalweg = Math.max(0, 1 - Math.abs(u + .36 * bend) / (u < -.36 * bend ? .65 : 1.25));
  const scour = .74 + 1.82 * bend + .48 * bell((d - 81) / 30);
  const depth = scour * thalweg ** 1.4;
  const ridge = .16 * bell((d - 51 - u * 9) / 8) + .18 * bell((d + 89 - u * 6) / 10);
  const submerged = smooth(0, 3.5, -edge);
  const wetBed = level + .05 + submerged * (-depth + ridge * (1 - u * u) ** 2 + .07 * grain);
  const scroll = .43 * bell((edge - 19 - d * .043) / 6) + .22 * bell((edge - 44 - d * .06) / 10);
  const rise = cross < 0 ? edge * .15 + 1.8 * smooth(10, 30, edge) : edge * .025 + scroll;
  const dryBank = level + .05 + rise + .12 * grain * smooth(0, 8, edge);
  const support = envelope(d, 169, 219) * envelope(edge, 43, cross < 0 ? 92 : 105);
  const bed = mix(h, edge < 0 ? wetBed : dryBank, support);
  const rock = support * (.12 + .37 * ridge + .42 * (cross < 0 ? smooth(4, 24, edge) : 0));
  const sand = support * smooth(-.8, .2, bed - level) * (1 - smooth(1.8, 4.2, bed - level));
  return [bed, rock, sand, support];
}

function lakeShingle(x, z, h, grain, lake) {
  const dz = z - lake.center[1];
  const outerX = lake.center[0] + lake.rx * Math.sqrt(1.06 ** 2 - (dz / lake.rz) ** 2);
  // Sheltered bays behind wave-built gravel spits interrupt the long bank.
  const drift = 10 * bell((z + 2006) / 31) - 13 * bell((z + 1949) / 44) + 11 * bell((z + 1872) / 28);
  const shore = outerX - 22 + drift;
  const d = x - shore;
  const ridge = 1.15 * bell((d - 13 - .045 * dz) / 7) * (.38 + .62 * smooth(-.4, .6, noise.noise(z / 36, 3.1)));
  const target = lake.level + d * .09 + ridge + grain * .18 + 6 * smooth(20, 74, d) + 9 * smooth(46, 112, d);
  const support = envelope(z + 1930, 95, 192) * (1 - smooth(31, 85, -d)) * (1 - smooth(43, 112, d));
  const rock = .13 + .34 * smooth(-.4, .7, grain) + .34 * smooth(22, 63, d);
  const sand = .64 * envelope(d - 2, 9, 23);
  return [mix(h, target, support), rock, sand, support];
}

function tarnMoraine(u, v, h, grain) {
  // The ridge is oblique to the basin. Two terminal lobes bracket a low
  // meltwater saddle, with smaller till hummocks behind their crest.
  const across = u + .31 * v - 14 * bell((v + 28) / 78);
  const saddle = bell((v + 19) / 20);
  const lobe = 13 * envelope(v, 60, 153) * bell(across / 31) * (1 - .83 * saddle);
  const parallel = 5.6 * envelope(v + 18, 57, 122) * bell((across - 62) / 25);
  const hummock = 4.6 * bell((u + 73) / 37) * bell((v - 42) / 33) + 2.3 * bell((u + 63) / 23) * bell((v + 63) / 30);
  const melt = 2.3 * saddle * bell((across + 24) / 42);
  const support = envelope(u, 125, 203) * envelope(v, 123, 197);
  const slabs = .9 * grain + 1.6 * noise.noise(across / 16, v / 39);
  const rock = .27 + .49 * smooth(1, 9, lobe + parallel) + .12 * grain;
  return [h + support * (lobe + parallel + hummock - melt + slabs), rock, .02, support];
}

function dryEscarpment(u, v, h, grain) {
  // Tilted strata crop out along an irregular break in slope. Gullies split
  // the face into buttresses. A colluvial apron and a gentler floor sit below.
  const strike = u - .42 * v;
  const warp = 8 * noise.noise(v / 33, 29) + 5 * noise.noise(v / 81, u / 90);
  const scarp = strike - warp;
  const gully = .63 * bell((v - 24 + .33 * u) / 9) + .77 * bell((v + 47 + .19 * u) / 11);
  const upper = 15 * smooth(-13, 2, scarp);
  const middle = 6 * smooth(-26, -18, scarp + 2 * grain);
  const lower = 4 * smooth(-42, -24, scarp) + 1.5 * smooth(-67, -43, scarp);
  const wash = 2.6 * envelope(v + 5, 42, 125) * bell((scarp + 57) / 8.5);
  const talus = (2.1 + grain) * bell((scarp + 39) / 18) * (1 - .66 * gully);
  const bedding = .65 * noise.noise(scarp / 4.8, v / 41) * smooth(-38, -8, scarp);
  const support = envelope(u, 80, 144) * envelope(v, 76, 143);
  const rock = clamp(.15 + .77 * smooth(-36, -1, scarp) * (1 - .52 * gully) + .23 * talus, 0, 1);
  const sand = .26 * bell((scarp + 50) / 22);
  return [h + support * ((upper + middle) * (1 - gully) + lower + talus - wash + bedding + .24 * grain), rock, sand, support];
}

function wetlandRunnels(u, v, h, grain, level) {
  // Natural levee, permanently submerged runnels and low backswamp pans.
  // Both channels fall within the same tidal datum and meet the wetland at
  // their ends. This needs neither a second water mesh nor a fictitious tide.
  const axis = .29 * v + 13 * Math.sin((v + 13) / 39) + 4 * Math.sin((v - 19) / 22)
    + 86 * smooth(87, 142, -v) + 54 * smooth(75, 144, v);
  const branch = 37 + 15 * bell((v - 10) / 52) - 26 * bell((v + 107) / 37) - 30 * bell((v - 106) / 41);
  const main = bell((u - axis) / (10 + 4.2 * bell((v + 21) / 36)));
  const creek = bell((u - axis - branch) / 8.7);
  const levee = .76 * bell((u - axis + 17) / 9) + .94 * bell((u - axis - 19) / 14);
  const pan = .51 * bell((u + 54 + .15 * v) / 18) * bell((v + 16) / 38);
  const ridge = .49 * envelope(v, 57, 119) * bell((u + 75 - .08 * v) / 19);
  const target = level + .49 + levee + ridge - Math.max(2.41 * main, 1.65 * creek) - pan + .15 * grain;
  const support = envelope(u - 6, 93, 145) * envelope(v, 75, 147);
  return [mix(h, target, support), .045, .28 * envelope(target - level, .25, .65), support];
}

function bakePatch(site, terrain, world, rockAt) {
  const {id, center, size, res} = site;
  const texel = size / res;
  const length = res * res, heights = new Float32Array(length), rock = new Float32Array(length), sand = new Uint8Array(length);
  const zero = new Uint8Array(length);
  const patch = Object.assign(Object.create(TerrainData.prototype), site, {
    texel, origin:-size / 2, heights, rock, sand, path:zero, gully:zero, seagrass:zero, rubble:zero, scarp:zero,
  });
  const lake = world.lakes.find(b => b.id === 'lake');
  for (let j = 0; j < res; j++) {
    const v = -size / 2 + (j + .5) * texel, z = center[1] + v;
    const river = id === 'alluvial-bend' ? profileAt(world.tributary, z) : null;
    for (let i = 0; i < res; i++) {
      const u = -size / 2 + (i + .5) * texel, x = center[0] + u, k = j * res + i;
      const base = terrain.heightAt(x, z), inheritedRock = rockAt(x, z);
      const grain = noise.noise(x / 9.3, z / 11.8) + .52 * noise.noise(x / 3.8, z / 4.7);
      let bed;
      switch (id) {
        case 'alluvial-bend': bed = alluvialBend(x, z, base, grain, river); break;
        case 'lake-shingle': bed = lakeShingle(x, z, base, grain, lake); break;
        case 'tarn-moraine': bed = tarnMoraine(u, v, base, grain); break;
        case 'dry-escarpment': bed = dryEscarpment(u, v, base, grain); break;
        case 'wetland-runnels': bed = wetlandRunnels(u, v, base, grain, world.marsh.level); break;
      }
      heights[k] = bed[0];
      rock[k] = mix(inheritedRock, bed[1], bed[3]);
      sand[k] = Math.round(255 * bed[2] * bed[3]);
    }
  }
  patch.buildMinMax();
  const heightAt = patch.heightAt.bind(patch), boundsFor = patch.boundsFor.bind(patch);
  patch.heightAt = (x, z) => heightAt(x - center[0], z - center[1]);
  patch.boundsFor = (x0, z0, x1, z1) => boundsFor(x0 - center[0], z0 - center[1], x1 - center[0], z1 - center[1]);
  return patch;
}

function alignRegionalCover(data, patches, sparse) {
  const {terrain, field, island, islandMasks:masks} = data;
  const {maskRes:res, size} = island, step = size / res;
  const worldToCell = x => Math.floor((x + size / 2) / step);
  const wf = [0, 0, 0, 0];
  for (const patch of patches) {
    const [cx, cz] = patch.center, r = patch.outer;
    for (let j = worldToCell(cz - r); j <= worldToCell(cz + r); j++) {
      const z = -size / 2 + (j + .5) * step;
      for (let i = worldToCell(cx - r); i <= worldToCell(cx + r); i++) {
        const x = -size / 2 + (i + .5) * step, k = (j * res + i) * 4;
        const weight = envelope(Math.max(Math.abs(x - cx), Math.abs(z - cz)), patch.inner, patch.outer);
        if (weight === 0) continue;
        const u = Math.floor((x - cx + patch.size / 2) / patch.texel);
        const v = Math.floor((z - cz + patch.size / 2) / patch.texel);
        const index = v * patch.res + u;
        const {rock, sand} = patch;
        const h = terrain.heightAt(x, z);
        const slopeX = (terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z)) / 4;
        const slopeZ = (terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2)) / 4;
        const ny = 1 / Math.hypot(1, slopeX, slopeZ);
        field.sample(x, z, wf);
        const water = wf[1] < .05 ? Math.max(island.seaLevel, wf[0]) : island.seaLevel;
        const openSoil = (1 - smooth(.22, .92, rock[index])) * (1 - sand[index] / 338);
        const density = smooth(.70, .94, ny) * smooth(.16, 1.2, h - water) * openSoil
          * (1 - masks[k] / 255) * (.38 + .46 * (1 - masks[k+3] / 255)) * (1 - sparse.weight(x, z) * .68);
        masks[k+1] = data.grass.data[k+1] = Math.round(mix(masks[k+1], density * 255, weight));
        masks[k+2] = Math.round(mix(masks[k+2], rock[index] * 255, weight));
      }
    }
  }
}

export function installRegionalLandforms(data, rockAt, sparse) {
  const terrain = data.terrain;
  const patches = REGIONAL_LANDFORMS.map(site => bakePatch(site, terrain, data.island, rockAt));
  const baseHeight = terrain.heightAt.bind(terrain);
  const baseBounds = terrain.boundsFor.bind(terrain);
  terrain.heightAt = (x, z) => {
    for (const patch of patches) {
      const d = Math.max(Math.abs(x - patch.center[0]), Math.abs(z - patch.center[1]));
      if (d >= patch.outer) continue;
      if (d <= patch.inner) return patch.heightAt(x, z);
      return mix(baseHeight(x, z), patch.heightAt(x, z), envelope(d, patch.inner, patch.outer));
    }
    return baseHeight(x, z);
  };
  terrain.boundsFor = (x0, z0, x1, z1) => {
    let [lo, hi] = baseBounds(x0, z0, x1, z1);
    for (const patch of patches) {
      const [x, z] = patch.center, s = patch.outer;
      if (x1 < x - s || x0 > x + s || z1 < z - s || z0 > z + s) continue;
      const b = patch.boundsFor(x0, z0, x1, z1);
      lo = Math.min(lo, b[0]);
      hi = Math.max(hi, b[1]);
    }
    return [lo, hi];
  };
  data.regionalTerrains = patches;
  alignRegionalCover(data, patches, sparse);
  data.field.regionalAuditPoints = patches.flatMap(patch => {
    const {center:[x,z], inner, outer} = patch;
    return [[x,z], [x+15,z-26], [x-41,z+43], ...[inner-.1,inner+.1,outer-.1,outer+.1].flatMap(d => [[x+d,z],[x-d,z],[x,z+d],[x,z-d]])];
  });
  const confluence = data.island.tributary.filter(([, , , z], i) => z > 5618 && z < 5891 && i % 5 === 0);
  data.field.regionalAuditPoints.push(
    [7854,4200], [7885,4200], [3229,-1940], [3242,-1940], [5480,5900], [5505,5900], [5535,5900],
    ...confluence.map(([x, , , z]) => [x, z]),
    ...data.cove.continuous.summary.apronProbes.map(probe => probe.point),
  );
}

export function regionalLandformVisits(terrain) {
  const scarp = terrain.heightAt(4975, 535);
  const moraine = terrain.heightAt(3845, -4830);
  return {
    'alluvial-bend': {
      id:'alluvial-bend', title:'东部支流曲流滩',
      note:'沿东岸缓坡走，看浅滩伸向河心。弯道外侧的水更深，河床另一边是被冲刷的陡岸。',
      p:[7910, 4200], gaze:[7853, 2.9, 4195], time:9.2,
    },
    'lake-shingle': {
      id:'lake-shingle', title:'山间长湖砾岸',
      note:'沿砾滩走，观察伸入水中的短砂嘴和背后的浅水。岸边坡缓，可以一路涉入湖中。',
      p:[3242, -1940], gaze:[3210, 385.4, -1985], time:9.5,
    },
    'tarn-moraine': {
      id:'tarn-moraine', title:'高地冰碛脊',
      note:'沿缓坡绕过两段碎石脊。脊间有一处低缺口，回头可以看见盆地里的高地湖。',
      p:[3800, -4840], gaze:[3845, moraine + 1.5, -4830], time:15.4,
    },
    'dry-escarpment': {
      id:'dry-escarpment', title:'背风谷岩阶',
      note:'沿坡脚走，看岩壁的层理和被雨水切开的沟槽。岩阶下方堆着崩落的碎石。',
      p:[4910, 555], gaze:[4975, scarp + 4, 535], time:16.0,
    },
    'wetland-runnels': {
      id:'wetland-runnels', title:'南部湿地汊道',
      note:'沿微高的泥脊走到汊口，看两道水槽绕过泥洲。沿缓坡可涉水进入浅槽。',
      p:[5400, 5900], gaze:[5480, 2.7, 5910], time:8.1,
    },
  };
}
