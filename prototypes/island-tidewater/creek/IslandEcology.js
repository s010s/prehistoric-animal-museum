import {BufferAttribute, BufferGeometry, Float32BufferAttribute, Frustum, Group, Matrix4, Quaternion, Sphere, Vector3} from '../vendor/tidewater/src/engine/index.js';
import {UniformBlock} from '../vendor/tidewater/src/engine/gpu/Shader.js';
import {ReefBatch} from '../vendor/tidewater/src/world/reef/ReefBatch.js';
import {createSeagrass} from '../vendor/tidewater/src/world/reef/ReefGeometry.js';
import {buildRockGeometry} from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import {terrainShadingModule} from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import {mulberry32} from '../vendor/tidewater/src/util/Noise.js';
import {createHabitatPlantMaterial} from './HabitatPlantMaterial.js';
import {WOODLAND_FLOOR_FORMS, woodlandFloorGeometry} from './WoodlandFloorGeometry.js';
import {roamingStoneGeometry} from './RoamingStone.js';
import {LAND_CAPACITY, RoamingLandCover} from './RoamingLandCover.js';
import {planIslandEcology} from './IslandEcologyPlan.js';

const TRIANGLE_BUDGET = 68000;
const SHADOW_TRIANGLE_BUDGET = 4200;
const TAU = Math.PI * 2;

// Display-referred swatches. Convert to linear before sending reflectance to WGSL.
const FORMS = {
  fern: {reach: 59, flex: .65, color: [0x4c5737, 0x606d46]},
  rush: {reach: 84, flex: .88, color: [0x475333, 0x65704a, 0x5f5741, 0x42442e]},
  tussock: {reach: 89, flex: .90, color: [0x686146, 0x8a7f56]},
  heath: {reach: 74, flex: .30, color: [0x4c553c, 0x63694e]},
  submerged: {reach: 36, flex: .78, color: [0x505937, 0x62704a]},
  seagrass: {reach: 39, flex: 1, color: [0x526344, 0x8a905e]},
  algae: {reach: 30, flex: .33, color: [0x5b5940, 0x6d6b4d]},
  duff: {reach: 34, flex: 0, color: [0x4d4635, 0x5d513e]},
  scree: {reach: 100, flex: 0, color: [0x5c5a52, 0x7a7162], rock: 2},
  cobble: {reach: 67, flex: 0, color: [0x52564c, 0x6c6a5e], rock: 0},
  talus: {reach: 68, flex: 0, color: [0x414645, 0x5c6059], rock: 1},
  ...WOODLAND_FLOOR_FORMS,
};

function linearSwatch(packed) {
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const value = ((packed >> shift) & 255) / 255;
    const linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    result += Math.round(linear * 255) << shift;
  }
  return result;
}

function foliageGeometry(form, colors, lod, seed) {
  const random = mulberry32(seed), positions = [], flex = [], indices = [];
  function ribbon(nodes, part, stiffness = 1) {
    const first = positions.length / 3;
    for (const [x, y, z, angle, width, shade = part % 2] of nodes) {
      for (const side of [-1, 1]) {
        positions.push(x + Math.cos(angle) * width * side, y, z + Math.sin(angle) * width * side);
        flex.push(Math.min(1, Math.max(0, y)) * stiffness, colors[shade], .74 + .26 * Math.min(1, y / .25), (part * .123) % 1);
      }
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      const k = first + i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  function blade(x, z, angle, height, lean, width, part, segments, leaflets = false) {
    const dx = Math.cos(angle), dz = Math.sin(angle), nodes = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      nodes.push([x + dx * lean * t * t, height * (t - .26 * t * t), z + dz * lean * t * t,
        angle + Math.PI / 2, width * Math.max(.018, Math.sin(Math.PI * t) * .7 + (1 - t) * .42)]);
    }
    ribbon(nodes, part);
    if (!leaflets) return;
    for (let i = 1; i < segments; i++) {
      const [lx, ly, lz] = nodes[i], t = i / segments;
      for (const side of [-1, 1]) {
        const a = angle + side * .92, r = (.38 + random() * .16) * (1 - t) * lean, touch = a + Math.PI / 2;
        const ex = lx + Math.cos(a) * r, ez = lz + Math.sin(a) * r;
        ribbon([[lx, ly, lz, touch, .012], [(lx + ex) * .5, ly + .035, (lz + ez) * .5, touch, r * .24],
          [ex, ly + .018, ez, touch, .002]], part + i);
      }
    }
  }
  const segments = lod ? 4 : 7;
  if (form === 'fern') {
    for (let i = 0; i < (lod ? 5 : 8); i++) {
      blade(0, 0, i * 2.39996, .48 + random() * .58, .64 + random() * .43, .020, i, segments, true);
    }
  } else if (form === 'rush') {
    // Curved, jointed hollow stems taper to a closed shoot tip. Low sheaths
    // and unequal, ascending whorls separate their silhouettes along the bank.
    for (let i = 0; i < (lod ? 6 : 9); i++) {
      const a = i * 2.39996, radius = .09 + random() * .28;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      const h = .47 + random() * .86, lean = .08 + random() * .34, sideBend = (random() - .5) * .095;
      const heading = a + (random() - .5) * 1.75;
      const dx = Math.cos(heading), dz = Math.sin(heading);
      const center = t => {
        const arc = lean * t ** 1.7, twist = Math.sin(t * Math.PI) * sideBend;
        return [x + dx * arc - dz * twist, h * t - .10 * lean * t * t, z + dz * arc + dx * twist];
      };
      const joints = [.22, .42, .61, .77, .89], tubeSides = lod ? 3 : 5;
      const rings = lod ? [0, .28, .53, .74, .92, 1]
        : [0, .055, ...joints.flatMap(t => [t - .014, t, t + .017]), .963, 1];
      const first = positions.length / 3, stalkWidth = .009 + random() * .007;
      for (const t of rings) {
        const [cx, cy, cz] = center(t), joint = joints.some(node => Math.abs(node - t) < .003);
        const width = t === 1 ? .0005 : stalkWidth * (1 - t * .77) * (joint || t < .055 ? 1.32 : 1);
        const shade = t < .06 ? 3 : joint ? 2 : i % 3 === 1 ? 1 : 0;
        for (let side = 0; side < tubeSides; side++) {
          const az = TAU * side / tubeSides + heading;
          positions.push(cx + Math.cos(az) * width, cy, cz + Math.sin(az) * width);
          flex.push(t * .83, colors[shade], .62 + .38 * Math.min(1, cy / .24), (i * .127) % 1);
        }
      }
      for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < tubeSides; k++) {
        const lower = first + j * tubeSides, next = (k + 1) % tubeSides;
        indices.push(lower + k, lower + tubeSides + k, lower + next,
          lower + next, lower + tubeSides + k, lower + tubeSides + next);
      }
      const whorls = lod ? [.42, .70] : joints.slice(0, 4);
      for (const [j, t] of whorls.entries()) {
        const [lx, ly, lz] = center(t);
        const n = lod ? 3 : 4 + (i + j) % 2;
        for (let k = 0; k < n; k++) {
          const direction = heading + j * .64 + TAU * k / n + (random() - .5) * .28;
          const reach = (.12 + random() * .14) * (1.21 - t * .58), rise = reach * (.42 + random() * .43);
          const tx = Math.cos(direction) * reach, tz = Math.sin(direction) * reach, touch = direction + Math.PI / 2;
          ribbon([[lx, ly, lz, touch, .010, 3], [lx + tx * .57, ly + rise * .37, lz + tz * .57, touch, .007, i % 3 === 1 ? 1 : 0],
            [lx + tx, ly + rise, lz + tz, touch, .001, k % 2]], i + j, .86);
        }
      }
    }
  } else if (form === 'algae') {
    for (let i = 0; i < (lod ? 5 : 8); i++) {
      const a = i * 2.39996, h = .34 + random() * .56;
      const nodes = Array.from({length: 7}, (_, j) => {
        const t = j / 6, spread = t * .34;
        return [Math.cos(a) * spread, h * t, Math.sin(a) * spread, a + Math.PI / 2, j % 2 ? .079 : .026];
      });
      ribbon(nodes, i);
    }
  } else if (form === 'duff') {
    for (let i = 0; i < (lod ? 5 : 10); i++) {
      const a = random() * TAU, reach = .2 + random() * .44, x = Math.cos(a) * reach, z = Math.sin(a) * reach;
      ribbon([[x * .35, .024, z * .35, a, .040], [x * .7, .062, z * .7, a, .066],
        [x, .036, z, a, .006]], i, 0);
    }
  } else {
    const [nearCount, farCount, height, lean, width] = form === 'heath'
      ? [18, 9, .47, .76, .11] : form === 'submerged' ? [14, 7, .84, .56, .053] : [23, 11, 1.21, .53, .025];
    for (let i = 0; i < (lod ? farCount : nearCount); i++) {
      const a = i * 2.39996, reach = random() * .19;
      blade(Math.cos(a) * reach, Math.sin(a) * reach, a, height * (.37 + random() * .63), lean * (.44 + random() * .56), width, i, segments);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('aData', new Float32BufferAttribute(flex, 4));
  g.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  g.computeVertexNormals();
  return g;
}

export function islandEcologyGeometry(name, lod, seed) {
  if (Object.hasOwn(WOODLAND_FLOOR_FORMS,name)) return woodlandFloorGeometry(name,lod);
  const form = FORMS[name], colors = form.color.map(linearSwatch);
  if (form.rock != null) {
    const g = buildRockGeometry(form.rock, seed, lod ? 1 : 2), pos = g.attributes.position, ao = g.attributes.ao, packed = [];
    if (name === 'talus') g.scale(.88, .74, .73);
    else g.scale(name === 'scree' ? .98 : 1.11, name === 'scree' ? .54 : .42, .79);
    g.rotateZ(name === 'scree' ? -.12 : .17);
    g.translate(0, .018, 0);
    for (let i = 0; i < pos.count; i++) {
      const mineral = pos.getX(i) * .89 - pos.getZ(i) * .61 + pos.getY(i) * 2.7;
      packed.push(0, colors[mineral > .03 ? 1 : 0], ao.getX(i), 0);
    }
    g.setAttribute('aData', new Float32BufferAttribute(packed, 4));
    return g;
  }
  if (name === 'seagrass') {
    const g = createSeagrass(mulberry32(seed), lod), d = g.attributes.aData, pos = g.attributes.position;
    // Flat blades arch along the local current. The tapered, lit tips
    // separate neighbouring shoots when looking horizontally underwater.
    g.scale(2.1, 1.52, 2.1);
    const normal = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const t = d.getX(i), blade = d.getW(i), direction = blade * TAU;
      const arch = t * t * (.12 + .19 * blade), height = pos.getY(i);
      pos.setXYZ(i,pos.getX(i) + arch * (.65 + Math.cos(direction)),
        height * (1 - t*t*(.15 + .22*blade)),pos.getZ(i) + arch * Math.sin(direction));
      const ny = normal.getY(i) + .25 + .46 * t, nx = normal.getX(i), nz = normal.getZ(i);
      const length = Math.hypot(nx,ny,nz);
      normal.setXYZ(i,nx/length,ny/length,nz/length);
      d.setY(i,colors[t>.62||blade>.73?1:0]);
      d.setZ(i,.84 + .15*t);
    }
    g.computeBoundingSphere();
    return g;
  }
  return foliageGeometry(name, colors, lod, seed);
}

export class IslandEcology {
  constructor(app, data, visits) {
    const shelf = app.shelfReef?.obstacles ?? [];
    const rock = app.coveRocks?.instances ?? [];
    this.plan = planIslandEcology(data, visits, [...shelf, ...rock], app.habitatEnrichment?.landUnderstory.coverSites);
    app.life?.addMarineBed(this.plan);
    this.group = new Group();
    this.group.name = 'Island banks, scree, understory and marine vegetation';
    this.shapes = {};
    const kinds = [];
    for (const [i, [name, form]] of Object.entries(FORMS).entries()) {
      const kind = kinds.length;
      kinds.push({geometry: islandEcologyGeometry(name, 0, 17147 + i)}, {geometry: islandEcologyGeometry(name, 1, 17147 + i)});
      const proxy = form.rock == null && !form.floorShadow ? null : kinds.length;
      if (proxy != null) kinds.push({geometry: form.floorShadow === true ? kinds[kind].geometry : kinds[kind+1].geometry, shadow: true, shadowOnly: true});
      const shape = this.shapes[name] = {...form, kind, proxy};
      if (form.rock != null) {
        const geo = kinds[kind].geometry;
        geo.computeBoundingBox();
        const b = geo.boundingBox;
        shape.solid = {halfX:(b.max.x-b.min.x)*.34, halfZ:(b.max.z-b.min.z)*.34, top:b.max.y*.82};
      }
    }
    this.roamingShapes = {...this.shapes};
    const profiles = app.life?.marineRockProfiles ?? [];
    for (const [id, name] of ['scree','talus'].entries()) {
      if (!profiles[id]) continue;
      const kind=kinds.length, near=roamingStoneGeometry(profiles[id],false), far=roamingStoneGeometry(profiles[id],true);
      kinds.push({geometry:near},{geometry:far},{geometry:near,shadow:true,shadowOnly:true});
      near.computeBoundingBox();
      const b=near.boundingBox;
      this.roamingShapes[name]={...this.shapes[name],kind,proxy:kind+2,solid:{
        halfX:(b.max.x-b.min.x)*.34,halfZ:(b.max.z-b.min.z)*.34,top:b.max.y*.82}};
    }
    this.up=new Vector3(0,1,0); this.normal=new Vector3();
    this.yawRotation=new Quaternion(); this.groundRotation=new Quaternion();
    this.terrain=data.terrain;
    this.view = new UniformBlock('IslandHabitatView', {position: ['vec3f', new Vector3()]});
    this.batch = new ReefBatch('Island Ecology', kinds, {maxInstances: this.plan.sites.length + LAND_CAPACITY});
    const material = this.material = createHabitatPlantMaterial(this.batch, app.terrainGPU, this.view, {
      name: 'Island ecology wind, swash and contact', namespace: 'islandHabitat', roamingGround: true,
    });
    material.modules.push(terrainShadingModule());
    material.varyings.vIslandCover = 'vec3f';
    material.vertex += `
 o.vIslandCover=vec3f(r2.w,world.y-habitatGround,select(0.0,1.0,r3.w<0.0));
`;
    material.surface += `
 let stone=in.vs.vIslandCover.x;
 let above=in.vs.vIslandCover.y;
 let q=vec2f(in.P.x*.831+in.P.z*.557,in.P.y*.91+in.P.x*.41-in.P.z*.38);
 let qDx=dpdx(q);
 let qDy=dpdy(q);
 var mottle=.5;
 var grain=.5;
 if(stone>.5){
   mottle=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,q/.64,qDx/.64,qDy/.64).w;
   grain=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,q/.16,qDx/.16,qDy/.16).w;
 }
 let contact=1.0-smoothstep(.01,.17,above+(mottle-.5)*.08);
 let mineral=in.vs.vHabitatColor * mix(.77,1.18,mottle) * mix(.87,1.11,grain);
 let soil=mineral*vec3f(.60,.56,.47);
 let micro=terrainPerturbNormal(in.P,in.N,(grain*.58+mottle*.42)*.012,1.0);
 s.albedo=mix(s.albedo,mix(mineral,soil,contact*.74),stone);
 s.normal=normalize(mix(s.normal,micro,stone));
 s.roughness=mix(s.roughness,mix(.9,.97,contact),stone);
 s.ao=mix(s.ao,max(.33,s.ao)*(1.0-.4*contact),stone);
 s.translucency*=mix(.68,0.0,stone);
 // The screened rock scan has a thin, inward-facing return surface. Match
 // its original single-sided material inside the two-sided foliage batch.
 if(in.vs.vIslandCover.z>.5 && !in.front){discard;}
`;
    material.shadow='return in.vs.vIslandCover.z<.5 || in.front;';
    this.group.add(this.batch.createMesh(material, {castShadow: true}));
    this.visible = {}; this.visibleForms = {};
    this.cells = new Map();
    const cell = k => Math.floor(k / 96);
    for (const [i, p] of this.plan.sites.entries()) {
      const id = cell(p.x) + ',' + cell(p.z);
      this.writeSite(i, p, this.shapes[p.form].reach);
      if (!this.cells.has(id)) this.cells.set(id, []);
      this.cells.get(id).push(i);
    }
    this.batch.upload();
    this.colliders = app.colliders;
    this.localSolids = new Map();
    this.roaming = new RoamingLandCover(data, (slot, sites) => {
      const first = this.plan.sites.length + slot;
      for (let i = 0; i < sites.length; i++) this.writeSite(first+i, sites[i], Math.min(78, this.shapes[sites[i].form].reach), true);
      if (sites.length) this.batch.instanceBuffer.write(this.batch.data.subarray(first*16, (first+sites.length)*16), first*64);
    });
    this.frustum = new Frustum();
    this.viewProjection = new Matrix4();
    this.sphere = new Sphere();
    this.candidates = [];
    this.frame = 0;
    this.collectRoaming = (site,i) => this.collect(site,this.plan.sites.length+i,this.view.fields.position.value,true);
    app.scene.add(this.group);
  }

  writeSite(index, site, reach, roaming = false) {
    const f = (roaming ? this.roamingShapes : this.shapes)[site.form];
    const q = this.yawRotation.setFromAxisAngle(this.up,site.yaw);
    let base = site.y;
    const rigid = roaming && f.rock != null;
    if (rigid) {
      const {gx,gz}=site, radius=site.scale;
      const align=this.groundRotation.setFromUnitVectors(this.up,this.normal.set(-gx,1,-gz).normalize());
      q.premultiply(align);
      // Embed the cut base in the lowest residual of the local supporting
      // bed. This accounts for curvature even when the centre is on a ridge.
      let residual=0;
      for (let i=0;i<8;i++) {
        const dx=radius*Math.cos(i*Math.PI/4), dz=radius*Math.sin(i*Math.PI/4);
        residual=Math.min(residual,this.terrain.heightAt(site.x+dx,site.z+dz)-(site.y+.018+gx*dx+gz*dz));
      }
      base+=residual-.105*radius;
      site.footing=base;
    }
    this.batch.data.set([site.x, base, site.z, site.scale, q.x,q.y,q.z,q.w,
      site.seed, reach, site.mode, Number(f.rock != null), ...site.flow, f.flex, rigid ? -1 : 0], index*16);
  }

  collect(site, index, p, roaming) {
    const shape = (roaming ? this.roamingShapes : this.shapes)[site.form];
    const dx = site.x-p.x, dy = site.y-p.y, dz = site.z-p.z, d2 = dx*dx + dy*dy + dz*dz;
    const reach = roaming ? Math.min(78, shape.reach) : shape.reach;
    if (d2 > reach*reach) return;
    if (roaming && d2 < 100 && shape.solid && site.footing + shape.solid.top * site.scale > site.y+.35) {
      let solid = this.localSolids.get(site);
      if (!solid) {
        const h = shape.solid.top*site.scale;
        const center = new Vector3(site.x,site.footing+(h-.2)/2,site.z);
        const half = new Vector3(shape.solid.halfX*site.scale,(h+.2)/2,shape.solid.halfZ*site.scale);
        const box = this.colliders.addBox(center,half,site.yaw,{tag:'roaming outcrop'});
        this.localSolids.set(site, solid = {box});
      }
      solid.frame = this.frame;
    }
    this.sphere.center.set(site.x, site.y + site.scale * .45, site.z);
    this.sphere.radius = site.scale * 1.45 + .47;
    const visible = this.frustum.intersectsSphere(this.sphere);
    if (visible || (d2 < 256 && shape.proxy != null)) this.candidates.push({site,index,distance:Math.sqrt(d2),visible,roaming});
  }

  update(camera) {
    if (this.disposed) return;
    const p = camera.position, sites = this.plan.sites, candidates = this.candidates;
    this.view.fields.position.value.copy(p);
    candidates.length = 0;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const ix = Math.floor(p.x / 96), iz = Math.floor(p.z / 96);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      for (const index of this.cells.get((ix + i) + ',' + (iz + j)) ?? []) {
        this.collect(sites[index],index,p,false);
      }
    }
    this.frame++;
    this.roaming.update(p);
    this.roaming.visit(this.collectRoaming);
    for (const [site,solid] of this.localSolids) {
      if (solid.frame === this.frame) continue;
      this.colliders.removeBox(solid.box);
      this.localSolids.delete(site);
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.batch.begin();
    this.visible = {}; this.visibleForms = {};
    let triangles = 0, shadowTriangles = 0;
    this.roamingTriangles = this.roamingVisible = 0;
    for (const {site, index, distance, visible, roaming} of candidates) {
      const form = (roaming ? this.roamingShapes : this.shapes)[site.form];
      const kind = form.kind + (distance > Math.max(17, site.scale * 34) ? 1 : 0);
      const cost = this.batch.kinds[kind].triangles;
      if (visible && triangles + cost <= TRIANGLE_BUDGET) {
        this.batch.add(kind, index);
        triangles += cost;
        if (roaming) { this.roamingVisible++; this.roamingTriangles += cost; }
        this.visible[site.region] = (this.visible[site.region] ?? 0) + 1;
        this.visibleForms[site.form] = (this.visibleForms[site.form] ?? 0) + 1;
      }
      if (form.proxy != null && site.scale > .34 && distance < 15) {
        const shadowCost = this.batch.kinds[form.proxy].triangles;
        if (shadowTriangles + shadowCost <= SHADOW_TRIANGLE_BUDGET) {
          this.batch.add(form.proxy, index);
          shadowTriangles += shadowCost;
        }
      }
    }
    this.batch.commit();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.roaming.clear();
    for (const solid of this.localSolids.values()) this.colliders.removeBox(solid.box);
    this.localSolids.clear();
    this.group.removeFromParent();
    this.batch.dispose();
    this.material.dispose();
  }

  stats() {
    return {sites: this.plan.sites.length, roaming:{...this.roaming.stats(),visible:this.roamingVisible,triangles:this.roamingTriangles,solidRocks:this.localSolids.size}, counts: this.plan.counts, visibleByRegion: this.visible, visibleByForm: this.visibleForms,
      triangles: this.batch.visibleTriangles, maxTriangles: TRIANGLE_BUDGET,
      shadowTriangles: this.batch.shadowTriangles, maxShadowTriangles: SHADOW_TRIANGLE_BUDGET,
      drawKinds: this.batch.mainOffsets.length, rootEmbedMetres: .018};
  }
}
