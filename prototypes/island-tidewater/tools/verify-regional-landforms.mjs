// Run with Node. Read the exact local terrain pipeline without a GPU or server.
import assert from 'node:assert/strict';
import {loadRuntimeTerrain} from './load-runtime-terrain.mjs';

const data = await loadRuntimeTerrain();
const {regionalLandformVisits} = await import('../creek/RegionalLandforms.js');
const {packRegionalTerrain, regionalTerrainShader} = await import('../creek/RegionalTerrainGPU.js');
const terrain = data.terrain;
const field = data.field;
const visits = regionalLandformVisits(terrain);
const routes = {
  'alluvial-bend': [[7910,4200],[7910,4240],[7920,4280]],
  'lake-shingle': [[3242,-1940],[3246,-1920],[3248,-1905],[3250,-1880]],
  'tarn-moraine': [[3800,-4840],[3809,-4854],[3822,-4865],[3839,-4868]],
  'dry-escarpment': [[4910,555],[4918,541],[4920,520],[4918,510]],
  'wetland-runnels': [[5400,5900],[5402,5920],[5407,5940],[5410,5970]],
};
const waterDepth = (x, z) => {
  const [level, edge] = field.sample(x, z);
  return edge < .05 ? level - terrain.heightAt(x, z) : -Infinity;
};
const slope = (x, z) => Math.hypot(
  terrain.heightAt(x + .5, z) - terrain.heightAt(x - .5, z),
  terrain.heightAt(x, z + .5) - terrain.heightAt(x, z - .5),
);
function transect(points) {
  const samples = [];
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1], [tx, tz] = points[i];
    const n = Math.ceil(2 * Math.hypot(tx - x, tz - z));
    for (let j = 0; j <= n; j++) {
      const a = x + (tx - x) * j / n, b = z + (tz - z) * j / n;
      samples.push({position:[a,b], slope:slope(a,b), depth:waterDepth(a,b), height:terrain.heightAt(a,b)});
    }
  }
  return samples;
}
const round = n => +n.toFixed(3);
const walking = Object.fromEntries(Object.entries(routes).map(([id, points]) => {
  assert.deepEqual(points[0], visits[id].p);
  const samples = transect(points);
  const maxSlope = Math.max(...samples.map(p => p.slope));
  assert(maxSlope < .62 && samples.every(p => p.depth < -.08), id + ' has a steep or submerged approach');
  const metres = points.slice(1).reduce((sum, [x,z], i) => sum + Math.hypot(x - points[i][0], z - points[i][1]), 0);
  return [id,{metres:round(metres), maxSlope:round(maxSlope), samples:samples.length}];
}));
const traverses = {
  northApron: [[3100,-7350],[3450,-7350]],
  northeastApron: [[7690,-2560],[7750,-2410]],
  eastHillside: [[6960,2100],[7160,1980]],
};
const offStation = Object.fromEntries(Object.entries(traverses).map(([id, points]) => {
  const samples = transect(points);
  const maxSlope = Math.max(...samples.map(p => p.slope));
  assert(maxSlope < .32 && samples.every(p => p.height > data.island.seaLevel && p.depth < 0),
    id + ' traverse crosses an abrupt or water-covered surface');
  return [id,{maxSlope:round(maxSlope), samples:samples.length}];
}));
const lakeAccess = transect([[3242,-1940],[3200,-1940]]);
assert(lakeAccess[0].depth < 0 && lakeAccess.at(-1).depth > 1.7);
assert(lakeAccess.every(p => p.slope < .23), 'lake ramp has an abrupt ledge');
const runnels = [5480, 5505, 5535].map(x => waterDepth(x,5900));
assert(runnels[0] > 1.5 && runnels[1] < -.9 && runnels[2] > .75, 'wetland cross-section lost its two channels or island');
const channelReach = transect([
  [5524,5730], [5523,5760], [5514,5770], [5474,5790], [5447,5810],
  [5448,5820], [5463,5870], [5481,5900], [5502,5930], [5514,5970], [5514,5980],
  [5526,6000], [5536,6010], [5546,6020], [5556,6030], [5562,6040], [5567,6055], [5570,6065],
]);
const minRunnelDepth = Math.min(...channelReach.map(p => p.depth));
assert(minRunnelDepth > .13, 'wetland runnel is isolated by a dry sill');
const pool = [4195,4200,4205].flatMap(z => [7851,7854,7857].map(x => waterDepth(x,z)));
assert(Math.min(...pool) > 1.7, 'outer-bank scour became shallow or too narrow');
const bendFlow = field.sample(7854,4200);
assert(bendFlow[2] < -.03 && bendFlow[3] > .2, 'bend current should follow the downstream thalweg');
assert(terrain.heightAt(4975,520) - terrain.heightAt(4920,520) > 16, 'escarpment lost its exposed headwall');

const lowerReaches = data.island.tributary.filter(([, , , z]) => z > 5618 && z < 5891);
const confluenceDepth = Math.min(...lowerReaches.map(([x, , , z]) => waterDepth(x, z)));
assert(confluenceDepth > .65, 'lower tributary has a dry interruption at the wetland confluence');

// Walk-in arrival, continuous tidal thalweg and the former square-edged
// trench below the main outlet. Distances and slopes use the actual bed.
const estuaryBank = data.hydrology.coasts.find(s => s.id === 'estuary').visit;
assert(terrain.heightAt(...estuaryBank) > data.island.seaLevel + .35, 'main estuary arrival flooded');
for (let z=3120; z<=3910; z+=4) {
  const river=field.riverAt(z), depth=river.level-terrain.heightAt(river.x,z);
  assert(depth>1 && depth<8, 'main tidal channel has a sill or offshore trench at '+z);
}
let greatestFanSlope=0, deepestFan=0;
for (let z=3650; z<=3810; z+=4) for (let x=-750; x<=-542; x+=4) {
  greatestFanSlope=Math.max(greatestFanSlope,slope(x,z));
  deepestFan=Math.max(deepestFan,data.island.seaLevel-terrain.heightAt(x,z));
}
assert(greatestFanSlope<.18 && deepestFan<8, 'tidal fan contains an abrupt undersea wall');

// The user's separate, approved west sample has an intentionally deeper
// mouth bar and sand channel. Compare its actual bed within two centimetres.
for (const [x,z,reference] of [[-848,118,-2.287],[-870,124,-2.624],[-915,136,-2.935],
  [-980,145,-3.673],[-1110,170,-2.838],[-822,131,.600]]) {
  assert(Math.abs(terrain.heightAt(x,z)-reference)<.02, 'west sample bed moved near '+[x,z]);
}

const apronProbes = data.cove.continuous.summary.apronProbes;
const [outer, inner] = apronProbes;
const apronGrade = key => (inner[key] - outer[key]) / 80;
assert(apronGrade('before') > 1.8 && apronGrade('after') < .7, 'north coastal apron retained the legacy wall');
assert(data.cove.continuous.apronAt(-980,125) === 0, 'coastal apron overlaps west sample');
const shape = regionalTerrainShader(data.regionalTerrains, 5);
assert(!shape.height.includes('terrainFineNormalTex') && shape.normal.includes('terrainFineNormalTex'),
  'height-only shadow compute must require height bindings alone');

const n = 1024, packed = packRegionalTerrain(data.regionalTerrains);
for (const patch of data.regionalTerrains) {
  const [x,z] = patch.offset;
  for (let j = 0; j < patch.res; j++) {
    const start = (z + j) * n + x;
    assert.deepEqual(packed.heights.subarray(start, start + patch.res), patch.heights.subarray(j * patch.res, (j + 1) * patch.res), patch.id + ' atlas height row ' + j);
  }
  const [cx,cz] = patch.center;
  assert(cx - patch.outer > 2600, patch.id + ' moved into the west sample');
  for (const d of [patch.inner,patch.outer]) {
    for (const side of [-1,1]) {
      const near = [[cx + side * (d - .01),cz],[cx,cz + side * (d - .01)]];
      const far = [[cx + side * (d + .01),cz],[cx,cz + side * (d + .01)]];
      near.forEach((p,i) => assert(Math.abs(terrain.heightAt(...p) - terrain.heightAt(...far[i])) < .05, patch.id + ' has a tile seam'));
    }
  }
}
assert.equal(new Set(data.regionalTerrains.map(p => p.id)).size, 5);
console.log(JSON.stringify({
  walking, offStation, mainEstuary:{deepestFan:round(deepestFan),greatestFanSlope:round(greatestFanSlope)}, lakeEntryDepth:round(lakeAccess.at(-1).depth), runnels:runnels.map(round), minRunnelDepth:round(minRunnelDepth),
  poolMinimumDepth:round(Math.min(...pool)), confluenceDepth:round(confluenceDepth),
  northApronGrade:{before:round(apronGrade('before')),after:round(apronGrade('after'))},
  terrainAtlasLayerBytes:packed.heights.byteLength + packed.normals.byteLength,
}, null, 2));
