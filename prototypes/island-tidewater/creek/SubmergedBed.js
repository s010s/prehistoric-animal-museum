// Local sediment, rooted macrophytes and waterlogged wood follow the visitor
// through inland channels and across the nearshore shelf between named stops.
import {BufferAttribute, Frustum, Matrix4, Quaternion, Sphere, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {Builder} from '../vendor/tidewater/src/world/village/GeoBuilder.js';
import {driftLog} from '../vendor/tidewater/src/world/debris/DebrisShapes.js';
import {terrainShadingModule} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {createHabitatPlantMaterial} from './HabitatPlantMaterial.js';
import {islandEcologyGeometry} from './IslandEcology.js';
import {marineBedExclusions, nearMarineBed, planMarineBedCell} from './MarineBenthicTiles.js';
import {freshwaterRibbons} from './FreshwaterRibbons.js';
import {marineOutcropKinds} from './MarineOutcrops.js';
import {BED_CELL, BED_RADIUS, BED_CELL_CAPACITY, planFreshwaterBedCell} from './FreshwaterBedPlan.js';

const REACH = 26;
const WINDOW_CELLS = (BED_RADIUS * 2 + 1) ** 2;
const CAPACITY = WINDOW_CELLS * BED_CELL_CAPACITY;
const LOAD_PER_UPDATE = 2;
const INSTANCE_STRIDE = 16;
const TRIANGLE_LIMIT = 37000;
const FORMS = ['ribbon', 'streamleaf', 'cobble', 'pebble', 'slab', 'ledge', 'limb', 'seagrass'];
const COLONY_MATERIAL = new Map([['colony', 3], ['low-colony', 4], ['tube-sponge', 5], ['fingers', 6]]);

function sunkenLimb() {
  const b = new Builder();
  driftLog(b, () => 0, 0, 0, 0, mulberry32(59822), {
    len: 1.8, r0: .12, r1: .062, stubs: 3, bark: .74, bend: .19, sink: .34,
  });
  const geometry = b.batch('nature').build(), p = geometry.attributes.position;
  const data = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), angle = Math.atan2(p.getZ(i), y - .07);
    const ridge = Math.cos(angle * 6 + p.getX(i) * 1.8);
    data.set([0, ridge > 0 ? 0x282016 : 0x1a150f, .77 + Math.min(.21, Math.max(0, y)), 0], i * 4);
  }
  geometry.setAttribute('aData', new BufferAttribute(data, 4));
  return geometry;
}

function buildKinds() {
  const kinds = [];
  for (const [i, id] of FORMS.entries()) {
    const form = id === 'slab' || id === 'ledge' ? 'scree' : 'cobble';
    for (let lod = 0; lod < 2; lod++) {
      let geometry;
      if (id === 'ribbon' || id === 'streamleaf') geometry = freshwaterRibbons(7903 + i, lod, id === 'streamleaf');
      else if (id === 'seagrass') geometry = islandEcologyGeometry('seagrass', lod, 5652);
      else if (id === 'limb') geometry = sunkenLimb();
      else geometry = islandEcologyGeometry(form, lod, 81914 + i * 17);
      if (id === 'ledge') geometry.scale(1.64, .68, .71);
      if (id === 'pebble') geometry.scale(.85, .80, 1.15);
      kinds.push({geometry});
    }
  }
  return kinds;
}

export class SubmergedBed {
  constructor(app, data) {
    this.data = data;
    this.colliders = app.colliders;
    this.rockKinds = marineOutcropKinds(app.life?.marineRockProfiles ?? []);
    const kinds = buildKinds();
    this.firstKind = new Map(FORMS.map((kind, index) => [kind, index*2]));
    for (const [kind, pair] of this.rockKinds) {
      this.firstKind.set(kind, kinds.length);
      kinds.push(...pair);
    }
    this.exclusions = marineBedExclusions(app, data);
    this.view = new UniformBlock('SubmergedBedView', {position: ['vec3f', new Vector3()]});
    this.batch = new ReefBatch('Submerged floor', kinds, {maxInstances: CAPACITY});
    this.material = createHabitatPlantMaterial(this.batch, app.terrainGPU, this.view, {
      name: 'Submerged bed deposits and rooted leaves', namespace: 'submergedBed', rigidSolids: true,
    });
    this.material.modules.push(terrainShadingModule());
    // Share the resident Tidewater reef volume, including between adjacent tiles.
    this.material.bindings.bedGrowthNoise = app.shelfReef.material.bindings.reefNoise;
    this.material.varyings.vBedMineral = 'f32';
    this.material.varyings.vBedLocal = 'vec3f';
    this.material.vertex += '\no.vBedMineral=r2.w; o.vBedLocal=v.position*r0.w;';
    this.material.surface += `
 let uvBed=vec2f(in.P.x*.79+in.P.z*.46,in.P.y+in.P.z*.61-in.P.x*.39);
 let gradX=dpdx(uvBed);let gradY=dpdy(uvBed);
 let rockGrad=terrainImplicitGrad(in.P);
 let footprint=max(length(rockGrad.dpdx),length(rockGrad.dpdy));
 let mineral=in.vs.vBedMineral;
 var relief=0.0;
 if(mineral>.5){
   if(mineral<1.5){
     let sediment=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,uvBed/.52,gradX/.52,gradY/.52);
     s.albedo*=mix(.74,1.22,sediment.w);
     s.roughness=.93;
   }else{
     let p=in.vs.vBedLocal;
     let bedding=textureSampleLevel(bedGrowthNoise,smpLinearRepeat,in.P*.17,0.0);
     let stone=textureSampleLevel(bedGrowthNoise,smpLinearRepeat,p*.89+bedding.xyz*.17,0.0);
     let near=1.0-smoothstep(.008,.035,footprint);
     if(mineral<2.5){
       // A three-dimensional field wraps the exposed top and vertical faces
       // without stretching a projected texture into parallel scratches.
       let up=smoothstep(.14,.91,in.N.y);
       let film=smoothstep(.38,.55,bedding.x*.58+stone.w*.42);
       let crust=smoothstep(.50,.585,bedding.w*.62+stone.x*.38);
       let turf=mix(vec3f(.105,.106,.043),vec3f(.29,.27,.096),stone.w);
       let growth=mix(vec3f(.35,.18,.092),vec3f(.34,.19,.255),smoothstep(.43,.57,bedding.y));
       s.albedo=mix(s.albedo,turf,film*(.45+.21*up));
       s.albedo=mix(s.albedo,growth,crust*(.91-.24*up));
       s.albedo*=.87+.24*stone.z;
       relief=bedding.z*.041+stone.x*.016+near*(film*.003+crust*.004);
       // Add centimetre-scale fractures across all three aspects. Only spend
       // the detail samples where an individual mineral chip is resolvable.
       if(near>.01){
         let chips=terrainTriplanar(in.P,terrainTriWeights(in.N),1.65,rockGrad);
         let recess=1.0-smoothstep(.09,.35,chips.x);
         s.albedo*=mix(1.0,(.83+.33*chips.w)*(1.0-recess*.31),near);
         relief+=near*((chips.x-.5)*.028+(chips.w-.5)*.004-recess*.002);
       }
       s.roughness=.93;
     }else{
       let grain=textureSampleLevel(bedGrowthNoise,smpLinearRepeat,p*4.4+stone.xyz*.37,0.0);
       var ridge=smoothstep(.015,.087,abs(grain.x-.5));
       // Thin plates carry curved growth rings; sponge walls have pores.
       if(mineral<3.5){ridge=.5+.5*sin(length(p.xz)*158.0+stone.y*7.0);}
       if(mineral>4.5){ridge=smoothstep(.39,.53,grain.y);}
       s.albedo*=mix(.88,1.18,stone.z)*mix(1.0,.76+.38*ridge,near);
       relief=stone.w*.004+near*(ridge-.5)*.0038;
       s.roughness=.84;
     }
   }
   s.translucency=vec3f(0.0);
 }
 // Derivatives must be taken in uniform flow. Fade subpixel relief as the
 // swimmer moves away to avoid sparkle on distant rocks and colonies.
 s.normal=terrainPerturbNormal(in.P,in.N,relief,1.0);`;
    this.mesh = this.batch.createMesh(this.material);
    this.mesh.visible = false;
    app.scene.add(this.mesh);
    this.cells = new Map();
    this.rockColliderCenter = new Vector3();
    this.rockColliderHalf = new Vector3();
    this.cellSlots = new Map();
    this.freeSlots = Array.from({length: WINDOW_CELLS}, (_, i) => WINDOW_CELLS - 1 - i);
    this.pending = [];
    this.nextCell = 0;
    this.cellX = this.cellZ = null;
    this.sites = new Array(CAPACITY).fill(null);
    this.residentSites = 0;
    this.revision = 0;
    this.disposed = false;
    this.frustum = new Frustum();
    this.matrix = new Matrix4();
    this.sphere = new Sphere();
    this.floorNormal = new Vector3();
    this.up = new Vector3(0,1,0);
    this.tilt = new Quaternion();
    this.heading = new Quaternion();
    this.lastPosition = new Vector3(Infinity, Infinity, Infinity);
    this.lastFacing = new Quaternion();
    this._visible = {};
    this.candidates = [];
    this.candidatePool = Array.from({length: CAPACITY}, () => ({index: 0, dist2: 0, rock: false}));
    this.detailedHosts = new Set();
  }

  loadWindow(cellX, cellZ, position) {
    this.cellX = cellX;
    this.cellZ = cellZ;
    const pending = this.pending;
    pending.length = 0;
    this.nextCell = 0;
    const wanted = new Set();
    for (let dz = -BED_RADIUS; dz <= BED_RADIUS; dz++) for (let dx = -BED_RADIUS; dx <= BED_RADIUS; dx++) {
      const x = cellX + dx, z = cellZ + dz, key = x + ',' + z;
      wanted.add(key);
      if (this.cells.has(key)) continue;
      const minX = x * BED_CELL, minZ = z * BED_CELL;
      const gapX = Math.max(minX - position.x, position.x - minX - BED_CELL, 0);
      const gapZ = Math.max(minZ - position.z, position.z - minZ - BED_CELL, 0);
      const dist2 = dx === 0 && dz === 0 ? -1 : gapX * gapX + gapZ * gapZ;
      pending.push({x, z, key, dist2});
    }
    pending.sort((a,b) => a.dist2 - b.dist2);
    for (const [key, cell] of this.cells) if (!wanted.has(key)) this.releaseCell(key, cell);
  }

  loadPending() {
    const end = Math.min(this.nextCell + LOAD_PER_UPDATE, this.pending.length);
    for (; this.nextCell < end; this.nextCell++) this.loadCell(this.pending[this.nextCell]);
  }

  loadCell({key, x, z}) {
    const cell = planFreshwaterBedCell(this.data, x, z);
    cell.push(...planMarineBedCell(this.data, x, z, this.exclusions, BED_CELL_CAPACITY - cell.length, this.rockKinds));
    const slot = this.freeSlots.at(-1);
    const first = slot * BED_CELL_CAPACITY;
    const start = first * INSTANCE_STRIDE;
    for (let i = 0; i < cell.length; i++) this.writeSite(first + i, cell[i]);
    if (cell.length) {
      const data = this.batch.data;
      this.batch.instanceBuffer.write(data.subarray(start, start + cell.length * INSTANCE_STRIDE), start * data.BYTES_PER_ELEMENT);
    }
    for (const site of cell) {
      const c = site.collision;
      if (!c || !this.colliders) continue;
      const center = this.rockColliderCenter.set(c.x, (c.yMin + c.yMax) * .5, c.z);
      const half = this.rockColliderHalf.set(c.halfX, (c.yMax - c.yMin) * .5, c.halfZ);
      site.collider = this.colliders.addBox(center, half, c.yaw, {tag: 'subtidal rock'});
    }
    this.freeSlots.pop();
    this.cellSlots.set(key, slot);
    this.cells.set(key, cell);
    for (let i = 0; i < cell.length; i++) this.sites[first + i] = cell[i];
    this.residentSites += cell.length;
    this.revision++;
  }

  writeSite(index, s) {
    const planted = s.kind === 'ribbon' || s.kind === 'streamleaf' || s.kind === 'seagrass';
    const q = s.q ?? this.heading.setFromAxisAngle(this.up, s.yaw);
    if (!s.q && !planted) q.premultiply(this.tilt.setFromUnitVectors(this.up, this.floorNormal.set(-s.gx, 1, -s.gz).normalize()));
    const mineral = COLONY_MATERIAL.get(s.kind) ?? (s.q || s.kind === 'reef-rubble' ? 2 : s.hostX !== undefined || planted || s.kind === 'limb' ? 0 : 1);
    const flex = s.kind === 'wrack' ? .52 : s.kind === 'holdfast' || s.kind === 'reef-rod' ? .29 : planted ? .95 : 0;
    // A resident tile owns a fixed instance block and keeps it while nearby.
    const data = this.batch.data, start = index * INSTANCE_STRIDE;
    data[start] = s.x;
    data[start + 1] = s.y;
    data[start + 2] = s.z;
    data[start + 3] = s.scale;
    data[start + 4] = q.x;
    data[start + 5] = q.y;
    data[start + 6] = q.z;
    data[start + 7] = q.w;
    data[start + 8] = s.seed;
    data[start + 9] = s.reach ?? REACH;
    data[start + 10] = s.mode ?? 2;
    data[start + 11] = mineral;
    data[start + 12] = s.flowX;
    data[start + 13] = s.flowZ;
    data[start + 14] = flex;
    data[start + 15] = s.fixed ? -1 : 0;
  }

  releaseCell(key, cell) {
    const slot = this.cellSlots.get(key), first = slot * BED_CELL_CAPACITY;
    this.sites.fill(null, first, first + cell.length);
    for (const site of cell) if (site.collider) {
      this.colliders.removeBox(site.collider);
      delete site.collider;
    }
    this.cellSlots.delete(key);
    this.cells.delete(key);
    this.freeSlots.push(slot);
    this.residentSites -= cell.length;
    this.revision++;
  }

  clearWindow() {
    for (const [key, cell] of this.cells) this.releaseCell(key, cell);
    this.pending.length = 0;
    this.nextCell = 0;
    this.cellX = this.cellZ = null;
    this.mesh.visible = false;
    this._visible = {};
  }

  update(camera) {
    if (this.disposed) return;
    const p = camera.position;
    this.view.fields.position.value.copy(p);
    const moved = this.lastPosition.distanceToSquared(p) > .16 ** 2;
    const projection = camera.projectionMatrix.elements;
    const recull = moved || !(Math.abs(camera.quaternion.dot(this.lastFacing)) > .99996) ||
      this.lastFocalX !== projection[0] || this.lastFocalY !== projection[5];
    const revision = this.revision;
    if (moved) {
      this.lastPosition.copy(p);
      const [level, edge] = this.data.field.sample(p.x, p.z);
      const inland = edge <= 40 && p.y <= level + REACH && level > this.data.island.seaLevel + .55;
      if (!inland && !nearMarineBed(this.data, p)) {
        if (this.cellX !== null) this.clearWindow();
        return;
      }
      const x = Math.floor(p.x / BED_CELL), z = Math.floor(p.z / BED_CELL);
      if (this.cellX !== x || this.cellZ !== z) this.loadWindow(x, z, p);
    }
    if (this.cellX === null) return;
    this.loadPending();
    if (!recull && revision === this.revision) return;
    this.lastFocalX = projection[0];
    this.lastFocalY = projection[5];
    this.lastFacing.copy(camera.quaternion);
    const candidates = this.candidates;
    candidates.length = 0;
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem, camera.reversedDepth);
    for (let index = 0; index < this.sites.length; index++) {
      const s = this.sites[index];
      if (!s) continue;
      const dist2 = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
      const reach = s.reach ?? REACH;
      if (dist2 > reach*reach) continue;
      this.sphere.center.set(s.x, s.q ? (s.top+s.bottom)*.5 : s.y+s.scale*.25, s.z);
      this.sphere.radius = s.q ? Math.hypot(s.radius, (s.top-s.bottom)*.5) : s.radius ?? (s.scale*1.25+.75);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const candidate = this.candidatePool[candidates.length];
      candidate.index = index;
      candidate.dist2 = dist2;
      candidate.rock = Boolean(s.q);
      candidates.push(candidate);
    }
    // Keep the detail used to fit settlers if their host fits the budget.
    candidates.sort((a,b) => Number(b.rock) - Number(a.rock) || a.dist2 - b.dist2);
    this.detailedHosts.clear();
    this.batch.begin();
    let triangles = 0;
    this._visible = {};
    for (const {index, dist2} of candidates) {
      const s = this.sites[index];
      if (s.hostRockId !== undefined && !this.detailedHosts.has(s.hostRockId)) continue;
      const near = s.q ? Math.max(13, s.scale*3.6) : s.fixed ? Math.min(10, Math.max(4.5, s.scale*8)) : Math.max(4.5, s.scale*13);
      const base = this.firstKind.get(s.kind), lod = Number(dist2 > near*near);
      let kind = base + lod;
      if (!lod && s.q && triangles + this.batch.kinds[kind].triangles > TRIANGLE_LIMIT) kind++;
      const cost = this.batch.kinds[kind].triangles;
      if (triangles + cost > TRIANGLE_LIMIT) continue;
      this.batch.add(kind, index);
      if (kind === base && s.rockId !== undefined) this.detailedHosts.add(s.rockId);
      this._visible[s.kind] = (this._visible[s.kind] ?? 0) + 1;
      triangles += cost;
    }
    this.batch.commit();
    this.mesh.visible = this.batch.visibleInstances > 0;
  }

  stats() {
    return {revision: this.revision, residentCells: this.cells.size, residentSites: this.residentSites,
      pendingCells: this.pending.length - this.nextCell, visible: this._visible,
      triangles: this.mesh.visible ? this.batch.visibleTriangles : 0, maxTriangles: TRIANGLE_LIMIT};
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearWindow();
    this.batch.dispose();
    this.material.uniformBlock.buffer?.destroy();
    this.material.dispose();
    this.view.buffer?.destroy();
  }
}
