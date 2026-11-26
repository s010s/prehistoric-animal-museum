// Streaming mid/far ecological cover (shrubs via Group-1 MuseumImpostorAtlas +
// low-poly weathered boulder/outcrop clusters) extending open habitats (Cold Highland,
// Tall Meadow, Dry Escarpment) from 0 m smoothly out to ~385-410 m at minimal GPU cost.
// Strictly honors landContextAt(): zero intrusion into protectedSampleLand, trails,
// water, snow, visitor sightlines, tree trunks, or animal patrol corridors.
import {
  Group, InstancedMesh, InstancedBufferAttribute, InstancedInterleavedBuffer,
  InterleavedBufferAttribute, DynamicDrawUsage, Matrix4, Quaternion, Vector3,
} from '../vendor/tidewater/src/engine/index.js';
import { Material } from '../vendor/tidewater/src/engine/render/Material.js';
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import { buildImpostorQuad } from '../vendor/tidewater/src/world/vegetation/Impostors.js';
import { lodFadeModule } from '../vendor/tidewater/src/materials/LODFade.js';
import { terrainShadingModule, srgb } from '../vendor/tidewater/src/world/terrain/TerrainShading.js';
import { mulberry32, Noise2D } from '../vendor/tidewater/src/util/Noise.js';
import { landContextAt, protectedSampleLand } from './LandHabitatField.js';
import { buildOutcropClusterGeometry } from './ShrubGeometry.js';

const CELL = 64;
const RADIUS = 6; // 13x13 coarse cells = +-384 m around camera
const SHRUB_NEAR = 56;
const SHRUB_FAR_FADE = [305, 385];
const ROCK_NEAR = 68;
const ROCK_FAR_FADE = [330, 410];
const MAX_SHRUB_NEAR = 192; // per variant (only active biome variant draws)
const MAX_SHRUB_FAR = 1600;
const MAX_ROCK_NEAR = 256;
const MAX_ROCK_FAR = 1152;
const MAX_ALTITUDE = 270;

const clumpNoise = new Noise2D(774219);
const _mat = new Matrix4();
const _quat = new Quaternion();
const _align = new Quaternion();
const _pos = new Vector3();
const _scl = new Vector3();
const _up = new Vector3(0, 1, 0);
const _norm = new Vector3();

const shrubTintModule = new ShaderModule({
  name: 'museumOpenShrubTint',
  code: `
fn openShrubTint(seed:f32)->vec3f{
 let kind=floor(seed);
 let t=fract(seed*11.37);
 let v=fract(seed*29.71);
 // 0: Tall meadow woody thicket (rich olive-emerald to warm sunlit sage)
 if(kind<.5){
  return mix(vec3f(.76,.92,.60),vec3f(.98,1.02,.68),t)*(.86+v*.24);
 }
 // 1: Cold highland dwarf heath / krummholz cushion (muted alpine olive-sage & bronze)
 if(kind<1.5){
  return mix(vec3f(.62,.72,.56),vec3f(.86,.80,.56),t)*(.84+v*.24);
 }
 // 2: Dry escarpment arid scrub (warm weathered sage-ochre)
 return mix(vec3f(.88,.84,.62),vec3f(1.06,.92,.62),t)*(.85+v*.22);
}
`,
});

function buildCellHorizonSites(data, ix, iz) {
  const shrubs = [];
  const rocks = [];
  const terrain = data.terrain;
  const rng = mulberry32(Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ 912743);
  const cx = (ix + 0.5) * CELL;
  const cz = (iz + 0.5) * CELL;
  if (Math.max(Math.abs(cx), Math.abs(cz)) > data.island.size * 0.5 - 32) return { shrubs, rocks };
  if (protectedSampleLand(cx, cz) && protectedSampleLand(cx - 32, cz - 32) && protectedSampleLand(cx + 32, cz + 32)
      && protectedSampleLand(cx - 32, cz + 32) && protectedSampleLand(cx + 32, cz - 32)) {
    return { shrubs, rocks };
  }

  for (let g = 0; g < 4; g++) {
    const gx = (ix + 0.1 + rng() * 0.8) * CELL;
    const gz = (iz + 0.1 + rng() * 0.8) * CELL;
    const home = landContextAt(data, gx, gz);
    if (!home) continue;

    const clump = 0.5 + 0.5 * clumpNoise.noise(gx / 115, gz / 115);
    const biome = home.biome;
    if (biome === 'shore') continue;

    // 1. Mid/far boulder & rock outcrop clusters (Cold Highland, Dry Escarpment, meadow rises)
    const rockChance = biome === 'upland' ? 0.58 + clump * 0.34
      : biome === 'dry-slope' ? 0.48 + clump * 0.34
      : biome === 'meadow' ? (home.slope > 0.11 ? 0.22 : 0.07)
      : 0.05;
    if (rng() < rockChance) {
      const rockCount = biome === 'upland' ? 2 + Math.floor(rng() * 3)
        : biome === 'dry-slope' ? 1 + Math.floor(rng() * 3) : 1;
      const contour = home.slope > 0.08 ? Math.atan2(home.gx, -home.gz) + (rng() - 0.5) * 0.7 : rng() * Math.PI * 2;
      const ca = Math.cos(contour), sa = Math.sin(contour);
      for (let k = 0; k < rockCount; k++) {
        const along = k === 0 ? 0 : (rng() - 0.5) * 18;
        const across = k === 0 ? 0 : (rng() - 0.5) * 6.5;
        const rx = gx + ca * along - sa * across;
        const rz = gz + sa * along + ca * across;
        const ctx = k === 0 ? home : landContextAt(data, rx, rz);
        if (!ctx || ctx.biome === 'shore' || ctx.biome === 'wet-bank') continue;
        if (rocks.some(r => (r.x - rx) ** 2 + (r.z - rz) ** 2 < 22)) continue;
        const baseScale = biome === 'upland' ? 1.25 + rng() * 1.45
          : biome === 'dry-slope' ? 1.05 + rng() * 1.30
          : 0.85 + rng() * 0.80;
        const sx = baseScale * (0.82 + rng() * 0.40);
        const sz = baseScale * (0.82 + rng() * 0.40);
        const sy = baseScale * (0.76 + rng() * 0.46);
        const warm = biome === 'upland' ? (rng() < 0.65 ? 0.92 : 0.12)
          : biome === 'dry-slope' ? 0.85 : 0.32;
        // Measure 4-point perimeter terrain residual (same footing rule as IslandEcology)
        // so boulder clusters never perch or float on convex slopes.
        const rFoot = Math.max(sx, sz) * 0.95;
        let residual = 0;
        for (let c = 0; c < 4; c++) {
          const ang = c * (Math.PI * 0.5);
          const dx = Math.cos(ang) * rFoot, dz = Math.sin(ang) * rFoot;
          residual = Math.min(residual, terrain.heightAt(rx + dx, rz + dz) - (ctx.y + ctx.gx * dx + ctx.gz * dz));
        }
        rocks.push({
          x: rx, y: ctx.y + residual - 0.14 * sy, z: rz,
          gx: ctx.gx, gz: ctx.gz,
          sx, sy, sz, s: baseScale,
          yaw: contour + (rng() - 0.5) * 1.6,
          warm, seed: rng(),
        });
      }
    }

    // 2. Open-habitat shrubs & thickets (Group-1 octahedral impostors beyond 56 m)
    const shrubChance = biome === 'meadow' ? 0.46 + clump * 0.42
      : biome === 'upland' ? 0.46 + clump * 0.34
      : biome === 'dry-slope' ? 0.42 + clump * 0.34
      : biome === 'woodland' ? (home.wood < 0.74 ? 0.28 : 0.06)
      : biome === 'wet-bank' ? 0.24
      : 0;
    if (rng() < shrubChance) {
      const members = biome === 'meadow' ? 2 + Math.floor(rng() * 3)
        : biome === 'upland' || biome === 'dry-slope' ? 1 + Math.floor(rng() * 3)
        : 1 + Math.floor(rng() * 2);
      const spread = biome === 'meadow' ? 9.5 : 8.0;
      for (let m = 0; m < members; m++) {
        const ang = rng() * Math.PI * 2;
        const rad = m === 0 ? 0 : (2.2 + rng() * spread);
        const sx = gx + Math.cos(ang) * rad;
        const sz = gz + Math.sin(ang) * rad;
        const ctx = m === 0 ? home : landContextAt(data, sx, sz);
        if (!ctx || ctx.biome === 'shore') continue;
        if (shrubs.some(s => (s.x - sx) ** 2 + (s.z - sz) ** 2 < 7.0)) continue;
        const variant = ctx.biome === 'upland' ? 1 : ctx.biome === 'dry-slope' ? 2 : 0;
        const scale = variant === 0 ? 0.85 + rng() * 0.90
          : variant === 1 ? 0.78 + rng() * 0.92
          : 0.80 + rng() * 0.80;
        const sy = 0.82 + rng() * 0.32;
        const templateH = variant === 0 ? 1.48 : variant === 1 ? 0.96 : 1.18;
        shrubs.push({
          x: sx, y: ctx.y - 0.12 * scale, z: sz,
          s: scale, sy, yaw: rng() * Math.PI * 2,
          H: templateH * scale * sy,
          variant,
          seed: variant + rng() * 0.999,
        });
      }
    }
  }
  return { shrubs, rocks };
}

function makeShrubMaterials(forest) {
  const shader = forest.shrubShader;
  const near = new Material({
    name: 'museum-open-shrub-near',
    side: 'double',
    modules: [shader, shrubTintModule],
    attributes: { iPos: 'vec4f', iDat: 'vec4f', aMat: 'vec4f', aVeg: 'vec4f' },
    varyings: { vMat: 'vec4f', vSeed: 'f32', vDistance: 'f32' },
    vertex: `
 let base=v.iPos.xyz;
 let d=length(vegParams.camPos-base);
 let limit=${(SHRUB_NEAR * 1.14).toFixed(2)};
 let vis=select(0.0,1.0,d<limit);
 let p=(v.model*vec4f(v.position,1.0)).xyz;
 let gust=vegGustAt(base.xz);
 let offset=creekLeafWind(p,base,v.aVeg.x,v.iDat.z,v.iDat.w,v.aMat.x,gust,frame.time)*0.55;
 let oldOffset=creekLeafWind(p,base,v.aVeg.x,v.iDat.z,v.iDat.w,v.aMat.x,gust,frame.time-frame.dt)*0.55;
 v.useWorld=true;
 v.worldPos=base+(p+offset-base)*vis;
 v.prevWorldPos=base+(p+oldOffset-base)*vis;
 v.worldNormal=vegInstanceNormal(v.model,v.normal);
 o.vMat=v.aMat;o.vSeed=v.iDat.w;o.vDistance=d;
`,
    surface: `
 let leafKind=in.vs.vMat.x;
 let leaf=min(leafKind,1.0);
 if(leafKind>0.5 && !creekNeedleVisible(in.uv,in.P,in.V)){discard;}
 let fade=smoothstep(${(SHRUB_NEAR * 0.86).toFixed(2)},${(SHRUB_NEAR * 1.14).toFixed(2)},in.vs.vDistance);
 if(bayer4(in.pixel)<fade){discard;}
 s.albedo=creekTemplateAlbedo(in.uv,leafKind,in.vs.vMat.z)*openShrubTint(in.vs.vSeed);
 s.ao=mix(.46,1.0,in.vs.vMat.y);
 s.roughness=0.93;
 s.specularIntensity=0.12;
 let leafN=normalize(in.vs.normal);
 s.normal=normalize(leafN+in.V*0.12*leaf);
 s.translucency=vegTranslucency(s.albedo,leafN,0.28,in.P)*leaf*(.55+.45*in.vs.vMat.y);
`,
  });
  near.underwaterLighting = 'none';

  const far = forest.atlas.createMaterial({
    isGroup1: () => 'true',
    variantOf: seed => `floor(${seed})`,
    nearDist: () => `${SHRUB_NEAR.toFixed(1)}`,
    colorOf: () => 'vec3f(bright,leaf,cr)',
  });
  far.name = 'museum-open-shrub-impostor';
  far.modules.push(shader, shrubTintModule);
  far.underwaterLighting = 'none';
  const albedoMatch = /let albedo = [^;]+;/;
  if (!albedoMatch.test(far.surface)) throw Error('Open shrub impostor albedo seam changed');
  far.surface = far.surface
    .replace(albedoMatch, 'let albedo=vA.rgb/cov*openShrubTint(iDat.w)*mix(.32,1.0,clamp(ex,0.0,1.0)*clamp(ex,0.0,1.0));\n s.ao=mix(.46,1.0,clamp(ex,0.0,1.0));')
    .replace('let nl = vB.xyz / max( vA.w, 1e-3 ) * 2.0 - 1.0;', 'let nl=normalize(vN.xyz/max(vN.w,.001));')
    .replace('s.normal = normalize( nw + in.V * 0.12 );', 's.normal=normalize(nw+in.V*.12*clamp(vB.z/cov,0.0,1.0));')
    .replace('s.translucency = vegTranslucency( albedo, in.N, 0.35, in.P );', 's.translucency=vegTranslucency(albedo,nw,.28,in.P)*clamp(vB.z/cov,0.0,1.0)*(.55+.45*clamp(ex,0.0,1.0));')
    .replace('s.roughness = 0.85;', 's.roughness = 0.93;')
    .replace('vA.w > 0.42', 'vA.w > 0.44');
  far.vertex = far.vertex
    .replace('v.worldPos=posed+creekTreeWind(base,hf,iDat.z,iDat.w,frame.time);', 'v.worldPos=posed+creekTreeWindG(hf,iDat.z,iDat.w,g,frame.time)*0.55;')
    + `
 let oldD=length(frame.prevCameraPos-base);
 let oldFadeOut=1.0-smoothstep(draw.params.z,maxD,oldD);
 let oldS=iPos.w*oldFadeOut;
 let oldK=oldS*vis;
 let oldCs=base+vec3f(0.0,Cy*oldS*sy,0.0);
 let oldToCam=normalize(frame.prevCameraPos-oldCs);
 let oldRight=normalize(cross(VEG_UP,oldToCam)+vec3f(1e-4,0.0,0.0));
 let oldUp=cross(oldToCam,oldRight);
 let oldTy=abs(oldToCam.y);
 let oldH=(Hv*sy*sqrt(max(1.0-oldTy*oldTy,0.0))+Rh*oldTy)*oldK;
 let oldP=oldCs+oldRight*(p.x*Rh*oldK)+oldUp*(p.y*oldH);
 v.prevWorldPos=oldP+creekTreeWindG(clamp((oldP.y-base.y)/max(iDat.z,.01),0.0,1.15),iDat.z,iDat.w,g,frame.time-frame.dt)*0.55;
`;
  const cy = forest.shrubBounds.center.y.toFixed(7);
  far.output += `
#if PASS_MAIN
 let ip=in.vs.vIPos4;let id=in.vs.vIDat;let sy=abs(id.y);let yaw=id.x;
 let q=museumImpHit+vec3f(0.0,${cy},0.0);
 let si=in.vs.vImp.w;
 let local=q*vec3f(si,si*sy,si);
 let rest=ip.xyz+vec3f(local.x*cos(yaw)+local.z*sin(yaw),local.y,local.z*cos(yaw)-local.x*sin(yaw));
 let hf=clamp((rest.y-ip.y)/max(id.z,.01),0.0,1.15);
 let motionG=vegGustAt(ip.xyz.xz);
 let now=frame.viewProjNoJitter*vec4f(rest+creekTreeWindG(hf,id.z,id.w,motionG,frame.time)*0.55,1.0);
 let old=frame.prevViewProjNoJitter*vec4f(rest+creekTreeWindG(hf,id.z,id.w,motionG,frame.time-frame.dt)*0.55,1.0);
 r.velocity=vec4f((now.xy/now.w-old.xy/old.w)*vec2f(.5,-.5),0.0,1.0);
#endif
`;
  return { near, far };
}

function makeOutcropMaterial(data, terrainGPU, isFar) {
  const mat = new Material({
    name: isFar ? 'museum-open-outcrop-far' : 'museum-open-outcrop-near',
    side: 'front',
    modules: [terrainGPU.module, terrainShadingModule(), data.appearance.module, lodFadeModule],
    attributes: { aRock: 'vec4f', iPos: 'vec4f', iDat: 'vec4f' },
    varyings: { vRock: 'vec4f', vTone: 'vec3f' },
    vertex: `
 let base=v.iPos.xyz;
 let d=length(frame.cameraPos-base);
 ${isFar
   ? `let vis=select(0.0,1.0,d>=${(ROCK_NEAR - 12).toFixed(1)} && d<${ROCK_FAR_FADE[1].toFixed(1)});
      let shrink=1.0-smoothstep(${ROCK_FAR_FADE[0].toFixed(1)},${ROCK_FAR_FADE[1].toFixed(1)},d);`
   : `let vis=select(0.0,1.0,d<${(ROCK_NEAR + 12).toFixed(1)});
      let shrink=1.0;`}
 let p=(v.model*vec4f(v.position*shrink,1.0)).xyz;
 v.useWorld=true;
 v.worldPos=base+(p-base)*vis;
 v.prevWorldPos=v.worldPos;
 v.worldNormal=normalize((v.model*vec4f(v.normal,0.0)).xyz);
 let groundY=terrainHeightAt(v.worldPos.xz);
 o.vRock=vec4f(v.aRock.x,v.aRock.y,max(v.worldPos.y-groundY,0.0),d);
 o.vTone=vec3f(v.iDat.y,v.iDat.z,v.iDat.w);
`,
    surface: `
 let d=in.vs.vRock.w;
 ${isFar
   ? `let fade=smoothstep(${(ROCK_NEAR - 10).toFixed(1)},${(ROCK_NEAR + 10).toFixed(1)},d);
      if(bayer4(in.pixel)>=fade){discard;}`
   : `let fade=smoothstep(${(ROCK_NEAR - 10).toFixed(1)},${(ROCK_NEAR + 10).toFixed(1)},d);
      if(bayer4(in.pixel)<fade){discard;}`}
 let warm=in.vs.vTone.x;
 let toneMix=in.vs.vRock.x;
 let above=in.vs.vRock.z;
 let q=vec2f(in.P.x*.79+in.P.z*.61,in.P.y*.88+in.P.x*.37-in.P.z*.42);
 let qDx=dpdx(q);let qDy=dpdy(q);
 let mottle=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,q/.95,qDx/.95,qDy/.95).w;
 ${isFar
   ? `let grain=0.5;`
   : `let grain=textureSampleGrad(terrainDetailTex,smpAniso4Repeat,q/.24,qDx/.24,qDy/.24).w;`}
 // Match foreground highland sandstone ochre & alpine granite palettes seamlessly
 let greyStone=mix(${srgb(.38,.41,.39)},${srgb(.56,.56,.51)},toneMix);
 let warmStone=mix(${srgb(.56,.44,.30)},${srgb(.76,.58,.38)},toneMix);
 var mineral=mix(greyStone,warmStone,warm)*mix(.82,1.16,mottle)*mix(.90,1.10,grain);
 let dryTone=museumDryGrassTone(in.P.xz);
 let woodCov=museumCover(in.P.xz,0.0).a;
 let contact=1.0-smoothstep(.02,.46,above+(mottle-.5)*.16);
 let localSoil=mix(mix(mineral*vec3f(.56,.54,.42),vec3f(.22,.19,.13),dryTone*.65),vec3f(.13,.15,.08),woodCov*.45);
 let mossTop=smoothstep(.58,.90,in.N.y)*smoothstep(.36,.72,mottle)*(1.0-dryTone*.7)*.24;
 s.albedo=mix(mix(mineral,localSoil,contact*.68),${srgb(.25,.29,.17)},mossTop);
 ${isFar
   ? `s.normal=normalize(in.N);
      s.specularIntensity=.08;`
   : `let micro=terrainPerturbNormal(in.P,in.N,(grain*.55+mottle*.45)*.014,1.0);
      s.normal=normalize(micro);
      s.specularIntensity=.14;`}
 s.roughness=mix(.91,.97,contact);
 s.metalness=0.0;
 s.ao=max(.38,in.vs.vRock.y)*(1.0-.40*contact);
`,
  });
  mat.underwaterLighting = 'none';
  return mat;
}

function makeInstancedPool(geometry, material, capacity, name, drawParams) {
  const matrixAttr = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
  matrixAttr.setUsage(DynamicDrawUsage);
  const iBuf = new InstancedInterleavedBuffer(new Float32Array(capacity * 8), 8);
  iBuf.setUsage(DynamicDrawUsage);
  geometry.setAttribute('iPos', new InterleavedBufferAttribute(iBuf, 4, 0));
  geometry.setAttribute('iDat', new InterleavedBufferAttribute(iBuf, 4, 4));
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix = matrixAttr;
  mesh.count = 0;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.underwaterLighting = 'none';
  if (drawParams) mesh.drawParams = drawParams;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  const trisPer = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  return { mesh, matrixAttr, iBuf, capacity, count: 0, trisPer };
}

export class OpenHabitatHorizon {
  constructor(app, data) {
    this.data = data;
    this.terrain = data.terrain;
    this.group = new Group();
    this.group.name = 'Open habitat mid/far shrubs and outcrops';

    const { near: shrubNearMat, far: shrubFarMat } = makeShrubMaterials(app.vegetation);
    // One lean near pool per shrub variant: avoids submitting & discarding the other 2 variants
    this.shrubNears = app.vegetation.shrubVariantGeometries.map((geo, v) => {
      const pool = makeInstancedPool(geo.clone(), shrubNearMat, MAX_SHRUB_NEAR, `open-shrub-near-${v}`, [0, SHRUB_NEAR, SHRUB_NEAR + 0.01]);
      pool.mesh.renderOrder = 1;
      return pool;
    });
    this.shrubFar = makeInstancedPool(buildImpostorQuad(), shrubFarMat, MAX_SHRUB_FAR, 'open-shrub-far', [SHRUB_NEAR, SHRUB_FAR_FADE[0], SHRUB_FAR_FADE[1]]);
    this.shrubFar.mesh.renderOrder = 2;

    const rockNearGeo = buildOutcropClusterGeometry(0);
    const rockFarGeo = buildOutcropClusterGeometry(1);
    const rockNearMat = makeOutcropMaterial(data, app.terrainGPU, false);
    const rockFarMat = makeOutcropMaterial(data, app.terrainGPU, true);
    this.rockNear = makeInstancedPool(rockNearGeo, rockNearMat, MAX_ROCK_NEAR, 'open-outcrop-near');
    this.rockFar = makeInstancedPool(rockFarGeo, rockFarMat, MAX_ROCK_FAR, 'open-outcrop-far');
    this.rockNear.mesh.renderOrder = 0;
    this.rockFar.mesh.renderOrder = 0;

    this.pools = [...this.shrubNears, this.shrubFar, this.rockNear, this.rockFar];
    for (const pool of this.pools) this.group.add(pool.mesh);
    this.materials = [shrubNearMat, shrubFarMat, rockNearMat, rockFarMat];
    this.tiles = new Map();
    this.pending = [];
    this.ix = undefined;
    this.iz = undefined;
    this.lastRebuildX = Infinity;
    this.lastRebuildZ = Infinity;
    this.dirty = false;
    this.disposed = false;
    app.scene.add(this.group);
  }

  _clearAll() {
    this.tiles.clear();
    this.pending.length = 0;
    this.ix = this.iz = undefined;
    for (const pool of this.pools) {
      pool.count = 0;
      pool.mesh.count = 0;
    }
  }

  update(camera) {
    if (this.disposed) return;
    const p = camera.position;
    const ground = this.terrain.heightAt(p.x, p.z);
    if (p.y > ground + MAX_ALTITUDE || p.y < this.data.island.seaLevel - 60) {
      if (this.tiles.size || this.shrubFar.count || this.rockFar.count) this._clearAll();
      return;
    }

    const ix = Math.floor(p.x / CELL), iz = Math.floor(p.z / CELL);
    if (ix !== this.ix || iz !== this.iz) {
      this.ix = ix; this.iz = iz;
      for (const [id, tile] of this.tiles) {
        if (Math.abs(tile.x - ix) <= RADIUS && Math.abs(tile.z - iz) <= RADIUS) continue;
        this.tiles.delete(id);
        this.dirty = true;
      }
      for (let j = iz - RADIUS; j <= iz + RADIUS; j++) {
        for (let i = ix - RADIUS; i <= ix + RADIUS; i++) {
          const id = i + ',' + j;
          if (!this.tiles.has(id)) {
            this.tiles.set(id, { x: i, z: j, ready: false, shrubs: null, rocks: null });
          }
        }
      }
      this.pending = [...this.tiles.values()]
        .filter(t => !t.ready)
        .sort((a, b) => Math.hypot(a.x + 0.5 - p.x / CELL, a.z + 0.5 - p.z / CELL) - Math.hypot(b.x + 0.5 - p.x / CELL, b.z + 0.5 - p.z / CELL));
    }

    if (this.pending.length) {
      const burst = this.pending.length > 36;
      const deadline = performance.now() + (burst ? 3.0 : 1.0);
      const limit = burst ? 48 : 16;
      let built = 0;
      while (this.pending.length && built < limit) {
        const tile = this.pending.shift();
        const res = buildCellHorizonSites(this.data, tile.x, tile.z);
        tile.shrubs = res.shrubs;
        tile.rocks = res.rocks;
        tile.ready = true;
        built++;
        this.dirty = true;
        if (performance.now() >= deadline) break;
      }
    }

    const movedSq = (p.x - this.lastRebuildX) ** 2 + (p.z - this.lastRebuildZ) ** 2;
    if (!this.dirty && movedSq < 100) return;
    this.dirty = false;
    this.lastRebuildX = p.x;
    this.lastRebuildZ = p.z;
    this._rebuildBuffers(p);
  }

  _rebuildBuffers(p) {
    const snLim2 = (SHRUB_NEAR * 1.18 + 12) ** 2;
    const sfMin2 = (SHRUB_NEAR * 0.78 - 12) ** 2;
    const sfMax2 = (SHRUB_FAR_FADE[1] + 12) ** 2;
    const rnLim2 = (ROCK_NEAR + 22) ** 2;
    const rfMin2 = (ROCK_NEAR - 24) ** 2;
    const rfMax2 = (ROCK_FAR_FADE[1] + 12) ** 2;

    const snByVar = this.shrubNears.map(() => []);
    const sfList = [], rnList = [], rfList = [];
    for (const tile of this.tiles.values()) {
      if (!tile.ready) continue;
      for (const s of tile.shrubs) {
        const dx = s.x - p.x, dz = s.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 > sfMax2) continue;
        if (d2 < snLim2) snByVar[s.variant].push({ s, d2 });
        if (d2 >= sfMin2) sfList.push({ s, d2 });
      }
      for (const r of tile.rocks) {
        const dx = r.x - p.x, dz = r.z - p.z, d2 = dx * dx + dz * dz;
        if (d2 > rfMax2) continue;
        if (d2 < rnLim2) rnList.push({ r, d2 });
        if (d2 >= rfMin2) rfList.push({ r, d2 });
      }
    }

    for (const list of snByVar) list.sort((a, b) => a.d2 - b.d2);
    sfList.sort((a, b) => a.d2 - b.d2);
    rnList.sort((a, b) => a.d2 - b.d2);
    rfList.sort((a, b) => a.d2 - b.d2);

    const writeShrub = (pool, list, withMatrix) => {
      const n = Math.min(list.length, pool.capacity);
      const M = pool.matrixAttr.array, B = pool.iBuf.array;
      for (let i = 0; i < n; i++) {
        const s = list[i].s;
        if (withMatrix) {
          _pos.set(s.x, s.y, s.z);
          _quat.setFromAxisAngle(_up, s.yaw);
          _scl.set(s.s, s.s * s.sy, s.s);
          _mat.compose(_pos, _quat, _scl).toArray(M, i * 16);
        }
        const o = i * 8;
        B[o] = s.x; B[o + 1] = s.y; B[o + 2] = s.z; B[o + 3] = s.s;
        B[o + 4] = s.yaw; B[o + 5] = -s.sy; B[o + 6] = s.H; B[o + 7] = s.seed;
      }
      if (withMatrix && n > 0) {
        pool.matrixAttr.clearUpdateRanges();
        pool.matrixAttr.addUpdateRange(0, n * 16);
        pool.matrixAttr.needsUpdate = true;
      }
      if (n > 0) {
        pool.iBuf.clearUpdateRanges();
        pool.iBuf.addUpdateRange(0, n * 8);
        pool.iBuf.needsUpdate = true;
      }
      pool.count = n;
      pool.mesh.count = n;
    };

    const writeRock = (pool, list) => {
      const n = Math.min(list.length, pool.capacity);
      const M = pool.matrixAttr.array, B = pool.iBuf.array;
      for (let i = 0; i < n; i++) {
        const r = list[i].r;
        _pos.set(r.x, r.y, r.z);
        _quat.setFromAxisAngle(_up, r.yaw);
        _align.setFromUnitVectors(_up, _norm.set(-r.gx * 0.72, 1, -r.gz * 0.72).normalize());
        _quat.premultiply(_align);
        _scl.set(r.sx, r.sy, r.sz);
        _mat.compose(_pos, _quat, _scl).toArray(M, i * 16);
        const o = i * 8;
        B[o] = r.x; B[o + 1] = r.y; B[o + 2] = r.z; B[o + 3] = r.s;
        B[o + 4] = 0; B[o + 5] = r.warm; B[o + 6] = r.seed; B[o + 7] = 0;
      }
      if (n > 0) {
        pool.matrixAttr.clearUpdateRanges();
        pool.matrixAttr.addUpdateRange(0, n * 16);
        pool.matrixAttr.needsUpdate = true;
        pool.iBuf.clearUpdateRanges();
        pool.iBuf.addUpdateRange(0, n * 8);
        pool.iBuf.needsUpdate = true;
      }
      pool.count = n;
      pool.mesh.count = n;
    };

    this.shrubNears.forEach((pool, v) => writeShrub(pool, snByVar[v], true));
    writeShrub(this.shrubFar, sfList, false);
    writeRock(this.rockNear, rnList);
    writeRock(this.rockFar, rfList);
  }

  stats() {
    return {
      residentCells: this.tiles.size,
      pendingCells: this.pending.length,
      shrubNear: this.shrubNears.reduce((n, p) => n + p.count, 0),
      shrubFarImpostors: this.shrubFar.count,
      outcropNear: this.rockNear.count,
      outcropFar: this.rockFar.count,
      triangles: Math.round(this.pools.reduce((sum, p) => sum + p.count * p.trisPer, 0)),
      reachMetres: { shrubImpostor: SHRUB_FAR_FADE[1], outcrop: ROCK_FAR_FADE[1] },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearAll();
    for (const p of this.pools) p.mesh.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
