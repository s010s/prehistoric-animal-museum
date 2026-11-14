// Museum-authored near-shore placement. Heights and sizes are metres. Each
// recipe sets a site's sediment supply and finite detail budget. The actual
// bed, slope and neighbouring water determine where a deposit can occur.
import {smooth} from './ContinuousSample.js';

const shores = {
  'shell-beach': {
    fineSediment: .82,
    detail: {clusterCount: 12, shellPocketCount: 20, plantHeight: [.65, 1.45], plantReach: 160, shellReach: 76},
  },
  'rocky-cove': {
    fineSediment: .12,
    detail: {clusterCount: 6, shellPocketCount: 5, plantHeight: [.42, 1.05], plantReach: 155, shellReach: 62},
  },
  'tidal-estuary': {
    fineSediment: .9,
    detail: {clusterCount: 15, shellPocketCount: 16, plantHeight: [.8, 1.65], plantReach: 180, shellReach: 80},
  },
  'sheltered-bay': {
    fineSediment: .66,
    detail: {clusterCount: 12, shellPocketCount: 12, plantHeight: [.72, 1.5], plantReach: 160, shellReach: 75},
  },
  'freshwater-shore': {
    fineSediment: .26,
    detail: {clusterCount: 18, shellPocketCount: 0, plantHeight: [.85, 2.1], plantReach: 180, shellReach: 0},
  },
};

const marineStrand = [.12, .55, 2.1, 3.15];
const lakeFade = [6, 24]; // metres outside the signed inland-water extent
const maskRock = [.12, .72], slopeRock = [.18, .62], slopeRockMax = .86;
const band = (h, lo, innerLo, innerHi, hi) => smooth(lo, innerLo, h) * (1 - smooth(innerHi, hi, h));
const mix = (a, b, w) => a * (1 - w) + b * w;
const f = n => n.toFixed(6);

function lakeBounds(lake) {
  // A broad rejection only. The shared inland water field carries the actual
  // signed extent, including precedence at nearby tributaries and sources.
  return [lake.rx * 2, lake.rz * 2];
}

function withinLakeBounds(lake, x, z) {
  const [rx, rz] = lakeBounds(lake);
  return Math.abs(x - lake.center[0]) < rx && Math.abs(z - lake.center[1]) < rz;
}

function materialFor(lakes) {
  const [a, b, c, d] = marineStrand.map(f);
  return `
fn museumMarineStrand(h:f32)->f32{return smoothstep(${a},${b},h)*(1.0-smoothstep(${c},${d},h));}
fn museumShoreRock(mask:f32,normalY:f32)->f32{return max(smoothstep(${maskRock.map(f)},mask),smoothstep(${slopeRock.map(f)},1.0-normalY)*${f(slopeRockMax)});}
fn museumLakeMargin(p:vec2f,wf:vec4f)->f32{
  ${lakes.map(lake => `if(wf.x==${f(lake.level)}&&all(abs(p-vec2f(${lake.center.map(f)}))<vec2f(${lakeBounds(lake).map(f)}))){return 1.0-smoothstep(${lakeFade.map(f)},wf.y);}`).join('\n  ')}
  return 0.0;
}`;
}

// Bilinear sampling of the actual loose-sand and exposed-rock channels, in
// texel-centre coordinates. The same ordered footprints blend the rendered
// terrain normals. These few reads happen only while placing local patches.
function groundChannels(grid, x, z) {
  const {res, texel, origin, rock, sand} = grid;
  const u = Math.max(0, Math.min(res - 1.001, (x - (grid.center?.[0] ?? 0) - origin) / texel - .5));
  const v = Math.max(0, Math.min(res - 1.001, (z - (grid.center?.[1] ?? 0) - origin) / texel - .5));
  const i = Math.floor(u), j = Math.floor(v), k = j * res + i;
  function read(bytes) {
    return mix(mix(bytes[k], bytes[k + 1], u - i), mix(bytes[k + res], bytes[k + res + 1], u - i), v - j);
  }
  return {rock: read(rock), sand: read(sand) / 255};
}

function lakeNormal(lake, x, z) {
  // Inward normal of the registered elliptical basin at this bank.
  const dx = (lake.center[0] - x) / lake.rx ** 2, dz = (lake.center[1] - z) / lake.rz ** 2;
  const length = Math.hypot(dx, dz);
  if (!length) throw new Error('Lake shore station is at the basin centre');
  return [dx / length, dz / length];
}

function nearestCoastNormal(segments, x, z) {
  let normal = null, nearest = Infinity;
  for (const {point, normal: seaward} of segments) {
    const dx = x - point[0], dz = z - point[1], distance2 = dx * dx + dz * dz;
    if (distance2 < nearest) { nearest = distance2; normal = seaward; }
  }
  if (!normal) throw new Error('Shore profile requires an ocean-connected contour');
  return normal;
}

export function createShoreLandforms(data) {
  const sea = data.island.seaLevel, lakes = data.island.lakes, shelf = data.cove.continuous;
  const layers = [
    ...data.regionTerrains.map(grid => ({grid, inner: 3800, outer: 4080})),
    {grid: data.coreTerrain, inner: 448, outer: 496},
    ...[data.sourceTerrain, data.eastSourceTerrain].map(grid => ({grid, inner: 112, outer: 124})),
    ...data.sampleTerrains.map(grid => ({grid, inner: grid.inner, outer: grid.outer})),
  ];
  function substrateAt(x, z) {
    const base = groundChannels(data.terrain, x, z);
    for (const {grid, inner, outer} of layers) {
      const d = Math.max(Math.abs(x - (grid.center?.[0] ?? 0)), Math.abs(z - (grid.center?.[1] ?? 0)));
      if (d >= outer) continue;
      const local = groundChannels(grid, x, z), w = 1 - smooth(inner, outer, d);
      base.rock = mix(base.rock, local.rock, w);
      base.sand = mix(base.sand, local.sand, w);
    }
    return base;
  }

  function profileFor(site) {
    const recipe = shores[site.kind];
    if (!recipe) throw new Error('Unknown shore landform ' + site.kind);
    const freshwater = site.kind === 'freshwater-shore';
    const lake = freshwater && lakes.find(b => withinLakeBounds(b, site.x, site.z) && (site.level == null || b.level === site.level));
    if (freshwater && !lake) throw new Error('Freshwater shore needs a registered lake at ' + site.id);
    const normal = site.normal ?? (freshwater ? lakeNormal(lake, site.x, site.z) : nearestCoastNormal(shelf.segments, site.x, site.z));
    const detail = {...recipe.detail, plantClumpCap: recipe.detail.clusterCount * 7, shellCap: recipe.detail.shellPocketCount * 8};
    return {kind: site.kind, freshwater, level: freshwater ? lake.level : sea, lake, normal, fineSediment: recipe.fineSediment, detail};
  }

  function sample(profile, x, z) {
    const height = data.terrain.heightAt(x, z);
    const dx = (data.terrain.heightAt(x + 1, z) - data.terrain.heightAt(x - 1, z)) * .5;
    const dz = (data.terrain.heightAt(x, z + 1) - data.terrain.heightAt(x, z - 1)) * .5;
    const slope = Math.hypot(dx, dz), normalY = 1 / Math.hypot(1, slope);
    const wf = data.field.sample(x, z), edge = wf[1], ground = substrateAt(x, z);
    let level = profile.level, support, withinWater, marine = 0, channel = 0;
    if (profile.freshwater) {
      const thisLake = wf[0] === profile.level && withinLakeBounds(profile.lake, x, z);
      support = thisLake ? 1 - smooth(...lakeFade, edge) : 0;
      withinWater = thisLake && edge < .05;
    } else {
      // The ocean chart contains water cells. Extend its influence onto this
      // bank by sampling along the local seaward normal. A landlocked bowl at
      // sea level stays dry. The 32 m chart is bilinearly reconstructed.
      const [nx, nz] = profile.normal;
      const ocean = shelf.marineAt(x, z);
      support = Math.max(ocean, shelf.marineAt(x + nx * 48, z + nz * 48), shelf.marineAt(x + nx * 112, z + nz * 112));
      withinWater = ocean > .5 || (edge < .05 && wf[0] >= sea);
      const bank = 1 - smooth(.05, 8, edge), riverRise = Math.max(0, wf[0] - sea);
      level += bank * riverRise;
      marine = support * (1 - bank * smooth(0, 1.5, riverRise));
      channel = (1 - smooth(-.25, 3, edge)) * (1 - smooth(.03, .6, height - wf[0]));
    }
    const relativeHeight = height - level;
    // A dry bank needs a local datum for deposition. An isolated hollow
    // below that datum has no water column outside the registered footprint.
    const depth = withinWater ? Math.max(0, -relativeHeight) : 0;
    const rock = Math.max(smooth(...maskRock, ground.rock), smooth(...slopeRock, 1 - normalY) * slopeRockMax);
    const mineral = (1 - rock) * support * (1 - smooth(2.5, 8, relativeHeight));
    const sand = mineral * mix(profile.fineSediment, 1, ground.sand);
    const gravel = mineral - sand, soil = Math.max(0, 1 - rock - mineral);
    const depositional = support * (1 - channel);
    const swash = depositional * (profile.freshwater ? band(relativeHeight, -.65, -.18, .16, .65) : band(relativeHeight, -.8, -.18, .37, 1.15));
    const strand = depositional * (profile.freshwater ? band(relativeHeight, .05, .28, .85, 1.8) : band(relativeHeight, ...marineStrand));
    const rooted = depositional * (1 - smooth(.27, .68, slope)) * (1 - rock);
    const backshore = rooted * (profile.freshwater ? band(relativeHeight, .06, .42, 2.65, 5) : band(relativeHeight, .7, 1.65, 6.2, 10.6));
    return {height, level, relativeHeight, depth, slope, marine, channel, swash, strand, backshore, rock, sand, gravel, soil};
  }

  return {profileFor, sample, materialWGSL: materialFor(lakes)};
}
