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
const CAPACITY = (BED_RADIUS * 2 + 1) ** 2 * BED_CELL_CAPACITY;
const TRIANGLE_LIMIT = 37000;
const FORMS = ['ribbon', 'streamleaf', 'cobble', 'pebble', 'slab', 'ledge', 'limb', 'seagrass'];

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
    this.material.varyings.vBedMineral = 'f32';
    this.material.vertex += '\no.vBedMineral=r2.w;';
    this.material.surface += `
 let uvBed=vec2f(in.P.x*.79+in.P.z*.46,in.P.y+in.P.z*.61-in.P.x*.39);
 let gradX=dpdx(uvBed);let gradY=dpdy(uvBed);
 if(in.vs.vBedMineral>.5){
   let stone=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,uvBed/.52,gradX/.52,gradY/.52);
   s.albedo*=mix(.74,1.22,stone.w);
   if(in.vs.vBedMineral>1.5){
     let fine=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,uvBed/.19,gradX/.19,gradY/.19).z;
     let crust=smoothstep(.36,.71,stone.x*.61+stone.w*.31+fine*.19)*smoothstep(.05,.78,in.N.y);
     s.albedo=mix(s.albedo,vec3f(.23,.27,.11),crust*.54)*mix(.83,1.20,fine);
   }
   s.roughness=.93;
   s.translucency=vec3f(0.0);
 }`;
    this.mesh = this.batch.createMesh(this.material);
    this.mesh.visible = false;
    app.scene.add(this.mesh);
    this.cells = new Map();
    this.rockColliderCenter = new Vector3();
    this.rockColliderHalf = new Vector3();
    this.sites = [];
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
  }

  loadWindow(cellX, cellZ) {
    const next = new Map(), sites = this.sites;
    sites.length = 0;
    for (let dz = -BED_RADIUS; dz <= BED_RADIUS; dz++) for (let dx = -BED_RADIUS; dx <= BED_RADIUS; dx++) {
      const x = cellX + dx, z = cellZ + dz, key = x + ',' + z;
      let cell = this.cells.get(key);
      if (!cell) {
        cell = planFreshwaterBedCell(this.data, x, z);
        cell.push(...planMarineBedCell(this.data, x, z, this.exclusions, BED_CELL_CAPACITY - cell.length, this.rockKinds));
        for (const s of cell) {
          if (!s.q || s.top - s.floor < .42) continue;
          const high = s.top - .12, low = s.floor - .12;
          const center = this.rockColliderCenter.set(s.x, (high+low)*.5, s.z);
          const half = this.rockColliderHalf.set(s.scale*.22, (high-low)*.5, s.scale*.14);
          s.collider = this.colliders?.addBox(center, half, s.yaw, {tag:'subtidal rock'});
        }
      }
      next.set(key, cell);
      for (const s of cell) {
        const index = sites.length, planted = s.kind === 'ribbon' || s.kind === 'streamleaf' || s.kind === 'seagrass';
        const q = s.q ?? this.heading.setFromAxisAngle(this.up, s.yaw);
        if (!s.q && !planted) q.premultiply(this.tilt.setFromUnitVectors(this.up, this.floorNormal.set(-s.gx,1,-s.gz).normalize()));
        const mineral = s.q || s.kind === 'reef-rubble' ? 2 : s.hostX !== undefined || planted || s.kind === 'limb' ? 0 : 1;
        const flex = s.kind === 'wrack' ? .52 : s.kind === 'holdfast' ? .29 : planted ? .95 : 0;
        // The fitted rock and its settlers share fixed world transforms.
        // Bending is local to the flexible ends of attached fronds.
        this.batch.data.set([s.x, s.y, s.z, s.scale, q.x, q.y, q.z, q.w,
          s.seed, s.reach ?? REACH, s.mode ?? 2, mineral, s.flowX, s.flowZ, flex, s.fixed ? -1 : 0], index * 16);
        sites.push(s);
      }
    }
    if (sites.length) this.batch.instanceBuffer.write(this.batch.data.subarray(0, sites.length * 16));
    for (const [key, cell] of this.cells) if (!next.has(key)) this.removeColliders(cell);
    this.cells = next;
    this.cellX = cellX;
    this.cellZ = cellZ;
  }

  removeColliders(cell) {
    for (const s of cell) if (s.collider) this.colliders.removeBox(s.collider);
  }

  clearWindow() {
    for (const cell of this.cells.values()) this.removeColliders(cell);
    this.cells.clear();
    this.sites.length = 0;
  }

  update(camera) {
    const p = camera.position;
    this.view.fields.position.value.copy(p);
    const moved = this.lastPosition.distanceToSquared(p) > .16 ** 2;
    const projection = camera.projectionMatrix.elements;
    if (!moved && Math.abs(camera.quaternion.dot(this.lastFacing)) > .99996 &&
        this.lastFocalX === projection[0] && this.lastFocalY === projection[5]) return;
    this.lastFocalX = projection[0];
    this.lastFocalY = projection[5];
    this.lastPosition.copy(p);
    this.lastFacing.copy(camera.quaternion);
    const [level, edge] = this.data.field.sample(p.x, p.z);
    const inland = edge <= 40 && p.y <= level + REACH && level > this.data.island.seaLevel + .55;
    if (!inland && !nearMarineBed(this.data, p)) {
      if (this.cells.size) {
        this.clearWindow();
        this.cellX = this.cellZ = null;
        this.mesh.visible = false;
        this._visible = {};
      }
      return;
    }
    const ix = Math.floor(p.x / BED_CELL), iz = Math.floor(p.z / BED_CELL);
    if (this.cellX !== ix || this.cellZ !== iz) this.loadWindow(ix, iz);
    const candidates = this.candidates;
    candidates.length = 0;
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem, camera.reversedDepth);
    for (const [index, s] of this.sites.entries()) {
      const dist2 = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
      const reach = s.reach ?? REACH;
      if (dist2 > reach*reach) continue;
      this.sphere.center.set(s.x, s.q ? (s.top+s.bottom)*.5 : s.y+s.scale*.25, s.z);
      this.sphere.radius = s.q ? Math.hypot(s.radius, (s.top-s.bottom)*.5) : s.radius ?? (s.scale*1.25+.75);
      if (this.frustum.intersectsSphere(this.sphere)) candidates.push({index, dist2});
    }
    candidates.sort((a,b) => a.dist2 - b.dist2);
    this.batch.begin();
    let triangles = 0;
    this._visible = {};
    for (const {index, dist2} of candidates) {
      const s = this.sites[index];
      const near = s.q ? Math.max(13, s.scale*3.6) : s.fixed ? Math.min(10, Math.max(4.5, s.scale*8)) : Math.max(4.5, s.scale*13);
      const base = this.firstKind.get(s.kind), lod = Number(dist2 > near*near);
      let kind = base + lod;
      if (!lod && s.q && triangles + this.batch.kinds[kind].triangles > TRIANGLE_LIMIT) kind++;
      const cost = this.batch.kinds[kind].triangles;
      if (triangles + cost > TRIANGLE_LIMIT) continue;
      this.batch.add(kind, index);
      this._visible[s.kind] = (this._visible[s.kind] ?? 0) + 1;
      triangles += cost;
    }
    this.batch.commit();
    this.mesh.visible = this.batch.visibleInstances > 0;
  }

  stats() {
    return {residentCells: this.cells.size, residentSites: this.sites.length, visible: this._visible,
      triangles: this.mesh.visible ? this.batch.visibleTriangles : 0, maxTriangles: TRIANGLE_LIMIT};
  }

  dispose() {
    this.clearWindow();
    this.batch.dispose();
    this.material.uniformBlock.buffer?.destroy();
    this.material.dispose();
    this.view.buffer?.destroy();
  }
}
