// Museum geography export. Reads the previous prototype without changing it.
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {museumReliefPlugin,loadMuseumSampler,reliefRevision} from './museum-relief.mjs';

const prototype = fileURLToPath(new URL('../', import.meta.url));
const previous = process.argv[2] ?? path.resolve(prototype, '../../../island-perceptual-budget');
const output = path.join(prototype, 'creek/assets');
await mkdir(output, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const origin = [-2000, -650]; // XZ translation; protected creek/animal/path Y, revised upland relief
const size = 1024, res = 1024, texel = size / res;
const waterSize = 512, waterRes = 1024;
const server = await createServer({ configFile: false, plugins:[museumReliefPlugin()], root: previous, cacheDir: path.join(prototype, '.cache/creek-export'), optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
try {
  const F = await loadMuseumSampler(server);
  const S = await server.ssrLoadModule('/prototypes/island-exploration/spring.js');
  const R = await server.ssrLoadModule('/prototypes/island-exploration/sample-region.js');
  const H = await server.ssrLoadModule('/prototypes/island-exploration/habitat.js');
  const sourceFiles = ['field.js', 'spring.js', 'sample-region.js', 'habitat.js', 'hydrology.js', 'erosion-field.js', 'erosion-data.js'].map(p => 'prototypes/island-exploration/' + p).concat(['src/flight-experience/world.ts', 'src/flight-experience/hydrology/world-river.ts', 'src/flight-experience/hydrology/coastal-river-candidate.ts']);
  const sources = [];
  for (const file of sourceFiles) sources.push({ path: file, sha256: hash(await readFile(path.join(previous, file))) });
  const data = new Float32Array(res * res);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < res; j++) {
    const z = origin[1] - size / 2 + (j + .5) * texel;
    for (let i = 0; i < res; i++) {
      const h = F.terrainHeight(origin[0] - size / 2 + (i + .5) * texel, z);
      if (!Number.isFinite(h)) throw Error('Nonfinite original terrain');
      data[j * res + i] = h; min = Math.min(min, h); max = Math.max(max, h);
    }
    if (j % 256 === 0) console.log(`Original terrain ${j}/${res}`);
  }
  const water = new Float32Array(waterRes * waterRes * 4);
  for (let j = 0; j < waterRes; j++) {
    const z = origin[1] - waterSize / 2 + (j + .5) * waterSize / waterRes;
    const cx = F.riverX(z), width = F.halfWidth(z) + 25, level = F.riverLevel(z);
    const dx = (F.riverX(z + .5) - F.riverX(z - .5));
    for (let i = 0; i < waterRes; i++) {
      const x = origin[0] - waterSize / 2 + (i + .5) * waterSize / waterRes;
      let h = level, edge = Math.abs(x - cx) - width, vx = dx / Math.hypot(dx, 1) * .38, vz = 1 / Math.hypot(dx, 1) * .38;
      const spring = S.springAt(x, z);
      if (spring && spring.forest && (spring.edge < edge || spring.edge < 1)) {
        h = edge < 0 && spring.edge < 1 ? Math.max(h, spring.level) : spring.level; edge = Math.min(edge, spring.edge);
        const index = S.forestSpringRun.reduce((best, p, n) => Math.hypot(p.x - x, p.z - z) < Math.hypot(S.forestSpringRun[best].x - x, S.forestSpringRun[best].z - z) ? n : best, 0);
        const a = S.forestSpringRun[Math.max(0, index - 1)], b = S.forestSpringRun[Math.min(S.forestSpringRun.length - 1, index + 1)];
        const length = Math.max(.001, Math.hypot(b.x - a.x, b.z - a.z));
        vx = (b.x - a.x) / length * spring.speed; vz = (b.z - a.z) / length * spring.speed;
      }
      water.set([h, edge, vx, vz], (j * waterRes + i) * 4);
    }
  }
  const local = p => [p[0] - origin[0], p[1] - origin[1]];
  const mainRun = [];
  for (let z = origin[1] - 254; z <= origin[1] + 254; z += .5) mainRun.push({ x: F.riverX(z) - origin[0], z: z - origin[1], level: F.riverLevel(z), width: F.halfWidth(z) + 25, depth: 1.5, speed: .38 });
  const springRun = S.forestSpringRun.map(p => ({ ...p, x: p.x - origin[0], z: p.z - origin[1] }));
  const trees = [];
  for (let z = -465; z < 465; z += 8) for (let x = -465; x < 465; x += 8) {
    const sx = origin[0] + x + (F.hash(x + 11, z + 7) - .5) * 6;
    const sz = origin[1] + z + (F.hash(x + 79, z + 31) - .5) * 6;
    const density = F.woodland(sx, sz);
    if (F.hash(x + 197, z - 31) > density * .86 || H.trailWeight(sx, sz) > .03 || R.regionOpening(sx, sz, 4) || F.terrainHeight(sx, sz) < F.waterLevelAt(sx, sz) + 2) continue;
    trees.push({ x: sx - origin[0], z: sz - origin[1], s: .82 + F.hash(x + 7, z + 333) * .72, sy: .87 + F.hash(x + 45, z + 61) * .3, yaw: F.hash(x, z + 57) * Math.PI * 2, seed: F.hash(x + 9, z + 17) });
  }
  const maskRes = 512, masks = new Uint8Array(maskRes * maskRes * 4);
  for (let j = 0; j < maskRes; j++) for (let i = 0; i < maskRes; i++) {
    const x = origin[0] - size / 2 + (i + .5) * size / maskRes, z = origin[1] - size / 2 + (j + .5) * size / maskRes;
    const h = F.terrainHeight(x, z), w = F.waterLevelAt(x, z), trail = H.trailWeight(x, z), woodland = F.woodland(x, z), ny = F.slopeAt(x, z);
    const k = (j * maskRes + i) * 4;
    masks[k] = Math.round(trail * 255);
    masks[k + 1] = Math.round(F.smooth(.72, .94, ny) * F.smooth(.22, 1.3, h - w) * (1 - trail) * (.28 + .48 * (1 - woodland)) * (1 - F.smooth(350, 465, Math.hypot(x - origin[0], z - origin[1]))) * 255);
    masks[k + 2] = Math.round((1 - F.smooth(.38, .83, ny)) * 255);
    masks[k + 3] = Math.round(woodland * 255);
  }
  const route = { ...R.REGION_ROUTE, points: R.REGION_ROUTE.points.map(local), gaze: R.REGION_ROUTE.gaze.map(([x,z,y]) => [x - origin[0], y, z - origin[1]]) };
  const animals = [ ['apatosaurus', F.encounter, -.45], ['triceratops', F.companion, .6] ].map(([id,p,yaw]) => ({ id, x: p.x - origin[0], z: p.z - origin[1], sourceGround: p.y, yaw }));
  const landmarks = [
    { id: 'entrance', title: '林间入口', note: '沿小径走向侧泉，听水声、观察岩壁。', p: local([-2047,-714]), gaze: [-2051 - origin[0], 30.5, -720 - origin[1]] },
    { id: 'pool', title: '侧泉浅池', note: '原侧泉的高程与跌水保留。可以近看水下河床。', p: local([-2047.5,-721]), gaze: [S.forestSpring.x - origin[0],30.2,S.forestSpring.z - origin[1]] },
    { id: 'ford', title: '溪流浅滩', note: '沿原浅滩穿过水道，水位随河谷缓慢下降。', p: local([-2012,-676]), gaze: [F.riverX(-675)-origin[0], F.riverLevel(-675), -675-origin[1]] },
    { id: 'giant', title: '溪畔的巨影', note: '停在林缘，观察22米长的迷惑龙。', p: [F.encounter.x - origin[0] - 23,F.encounter.z - origin[1] + 24], gaze: [F.encounter.x-origin[0],F.encounter.y+4.3,F.encounter.z-origin[1]] },
  ];
  const reference = [];
  for (const p of [...R.REGION_ROUTE.points,...animals.map(a=>[a.x+origin[0],a.z+origin[1]])]) reference.push({ source:p, local:local(p), height:F.terrainHeight(...p), originalHeight:F.sourceTerrainHeight(...p), water:F.waterLevelAt(...p) });
  const outputs = [];
  async function save(name, bytes) { await writeFile(path.join(output,name),bytes); outputs.push({ path:'assets/'+name,bytes:bytes.length,sha256:hash(bytes) }); }
  await save('heights.bin',Buffer.from(data.buffer)); await save('water.bin',Buffer.from(water.buffer)); await save('masks.bin',Buffer.from(masks.buffer));
  const geography = { schema:'museum-creek-geography-v1',sourceOrigin:origin,translationOnly:false,relief:reliefRevision,size,res,texel,origin:-size/2,waterSize,waterRes,maskRes,minHeight:min,maxHeight:max,region:R.REGION_VERSION,route,animals,landmarks,waterRuns:[mainRun,springRun],trees,reference };
  await save('geography.json',Buffer.from(JSON.stringify(geography)));
  const lock = { schema:'museum-creek-export-v1',originalCandidate:'e002260f',sourceOrigin:origin,relief:reliefRevision,reliefAdapterSha256:hash(await readFile(new URL('./museum-relief.mjs',import.meta.url))),sources,outputs,sourceBounds:[origin[0]-size/2,origin[1]-size/2,origin[0]+size/2,origin[1]+size/2],coreWaterBounds:[origin[0]-waterSize/2,origin[1]-waterSize/2,origin[0]+waterSize/2,origin[1]+waterSize/2],trees:trees.length,reference,waterProfile:'Original halfWidth + 25m physical ribbon, riverLevel and overlapping forestSpringRun maximum; no equal-level flattening.' };
  await writeFile(path.join(prototype,'creek/geography.lock.json'),JSON.stringify(lock,null,2)+'\n');
  console.log(JSON.stringify({ complete:true,trees:trees.length,min,max,outputs:outputs.map(o=>({path:o.path,bytes:o.bytes})) }));
} finally { await server.close(); }
