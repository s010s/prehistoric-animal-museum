// Prehistoric open-habitat shrub templates (Group 1 of MuseumImpostorAtlas)
// and low-poly weathered rock outcrop clusters for mid/far ecological continuity.
import * as T from '../vendor/tidewater/src/engine/index.js';
import { mergeGeometries } from '../vendor/tidewater/src/engine/geometry/BufferGeometryUtils.js';
import { buildRockGeometry } from '../vendor/tidewater/src/world/terrain/RockGeometry.js';
import { mulberry32 } from '../vendor/tidewater/src/util/Noise.js';

const UP = new T.Vector3(0, 1, 0);

function buildShrubTemplate({ seed, height, radius, stems, lobes, cardsPerLobe, cardScale, flatten, bury = 0.24 }) {
  const rng = mulberry32(seed);
  const branches = [];
  const verts = [], normals = [], uv = [], colors = [], indices = [];

  const addBranch = (a, b, rBot, rTop, sides = 3) => {
    const axis = b.clone().sub(a);
    const len = axis.length();
    if (len < 1e-4) return;
    const cyl = new T.CylinderGeometry(rTop, rBot, len, sides, 1);
    cyl.applyQuaternion(new T.Quaternion().setFromUnitVectors(UP, axis.normalize()));
    cyl.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
    branches.push(cyl);
  };

  const addSprayCard = (center, along, side, length, width, shade, crownCenter) => {
    const idx = verts.length / 3;
    const outward = center.clone().sub(crownCenter);
    outward.y = Math.max(outward.y, 0.22) + 0.32;
    if (outward.lengthSq() < 1e-5) outward.set(0, 1, 0);
    outward.normalize();
    for (let j = 0; j <= 1; j++) {
      for (const v of [0, 1]) {
        const u = j;
        const p = center.clone()
          .addScaledVector(along, (u - 0.5) * length)
          .addScaledVector(side, (v - 0.5) * width);
        const n = outward.clone().addScaledVector(side, (v - 0.5) * 0.30).normalize();
        verts.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        uv.push(u, v);
        colors.push(shade * 0.94, shade, shade * 0.88);
      }
    }
    indices.push(idx, idx + 2, idx + 3, idx, idx + 3, idx + 1);
  };

  // Ground-hugging crown profile: core dome + spreading low basal skirt lobes so
  // bushes never show bare "lollipop stilts" in meadow grass or highland tundra.
  const crownCenter = new T.Vector3(0, height * 0.36, 0);
  const lobeCenters = [];
  for (let i = 0; i < lobes; i++) {
    const isCore = i === 0;
    const isSkirt = i > 0 && i <= Math.ceil((lobes - 1) * 0.6);
    const a = i * 2.39996 + (rng() - 0.5) * 0.55;
    const rFrac = isCore ? 0.06 : isSkirt ? 0.42 + rng() * 0.34 : 0.26 + rng() * 0.32;
    const yFrac = isCore ? 0.48 + rng() * 0.14 : isSkirt ? 0.16 + rng() * 0.18 : 0.36 + rng() * 0.22;
    const cx = Math.cos(a) * radius * rFrac;
    const cz = Math.sin(a) * radius * rFrac;
    const cy = height * yFrac;
    const lr = radius * (isCore ? 0.54 : isSkirt ? 0.44 + rng() * 0.18 : 0.36 + rng() * 0.18);
    lobeCenters.push({ c: new T.Vector3(cx, cy, cz), r: lr, isSkirt });
  }

  // Short rooted woody basal stems buried inside the lower crown
  for (let i = 0; i < stems; i++) {
    const target = lobeCenters[i % lobeCenters.length];
    const a = i * 2.39996 + (rng() - 0.5) * 0.5;
    const base = new T.Vector3(Math.cos(a) * radius * 0.14, -bury, Math.sin(a) * radius * 0.14);
    const tip = target.c.clone().lerp(base, 0.26);
    const r0 = 0.036 + rng() * 0.018;
    addBranch(base, tip, r0, r0 * 0.38, 3);
  }

  // Crossed foliage spray cards around every lobe, extending down to ground level
  for (const lobe of lobeCenters) {
    for (let k = 0; k < cardsPerLobe; k++) {
      const a = k * 2.39996 + rng() * 0.9;
      const elev = (rng() - 0.42) * 1.12;
      const rr = lobe.r * (0.24 + 0.76 * Math.sqrt(rng()));
      const pos = new T.Vector3(
        lobe.c.x + Math.cos(a) * Math.cos(elev) * rr,
        Math.max(-0.04, lobe.c.y + Math.sin(elev) * rr * flatten),
        lobe.c.z + Math.sin(a) * Math.cos(elev) * rr,
      );
      const radialDist = pos.distanceTo(crownCenter) / Math.max(radius, 0.1);
      const shade = Math.max(0.36, Math.min(0.98, 0.40 + radialDist * 0.32 + Math.max(0, pos.y / height) * 0.36));
      const shootA = a + (rng() - 0.5) * 0.75;
      const along = new T.Vector3(Math.cos(shootA), (lobe.isSkirt ? 0.08 : 0.20) + (rng() - 0.35) * 0.50, Math.sin(shootA)).normalize();
      const tilt = (k % 3) * (Math.PI / 3) + (rng() - 0.5) * 0.55;
      const side = new T.Vector3(-Math.sin(shootA) * Math.cos(tilt), Math.sin(tilt), Math.cos(shootA) * Math.cos(tilt)).normalize();
      const len = lobe.r * cardScale * (0.85 + rng() * 0.40);
      const wid = len * (0.70 + rng() * 0.28);
      addSprayCard(pos, along, side, len, wid, shade, crownCenter);
    }
  }

  const wood = mergeGeometries(branches);
  branches.forEach(g => g.dispose());
  const leaves = new T.BufferGeometry();
  leaves.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
  leaves.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  leaves.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  leaves.setIndex(indices);
  return { height, width: radius * 2, wood, leaves, leafKind: 1 };
}

export function shrubTemplates() {
  return [
    // Variant 0: Ground-hugging lush meadow woody thicket (Tall Meadow & grasslands)
    buildShrubTemplate({ seed: 4109, height: 1.48, radius: 1.56, stems: 5, lobes: 7, cardsPerLobe: 9, cardScale: 1.28, flatten: 0.72 }),
    // Variant 1: Cold-highland wind-sculpted dwarf heath / krummholz cushion
    buildShrubTemplate({ seed: 7321, height: 0.96, radius: 1.58, stems: 4, lobes: 6, cardsPerLobe: 9, cardScale: 1.24, flatten: 0.50 }),
    // Variant 2: Dry-slope gnarled arid scrub & coarse thicket
    buildShrubTemplate({ seed: 9157, height: 1.18, radius: 1.38, stems: 4, lobes: 6, cardsPerLobe: 8, cardScale: 1.22, flatten: 0.62 }),
  ];
}

// Single asymmetric 3-stone weathered geological outcrop cluster:
// near detail=1 (~240 tris), far detail=0 (~60 tris). Per-instance yaw,
// non-uniform (sx, sy, sz) stretch, mineral warmth and world-space terrainDetailTex
// give every cluster a distinct silhouette without 3x vertex discard overhead.
export function buildOutcropClusterGeometry(lod) {
  const detail = lod ? 0 : 1;
  const specs = [
    { style: 2, seed: 311, scale: [1.18, 0.58, 0.88], pos: [-0.08, 0.08, 0.04], rot: [0.05, 0.2, -0.09], tone: 0 },
    { style: 0, seed: 317, scale: [0.68, 0.44, 0.58], pos: [0.76, -0.02, 0.26], rot: [-0.08, 1.4, 0.12], tone: 1 },
    { style: 1, seed: 331, scale: [0.54, 0.36, 0.48], pos: [-0.74, -0.05, -0.24], rot: [0.11, 2.6, -0.07], tone: 0 },
  ];

  const posOut = [], norOut = [], dataOut = [], idxOut = [];
  const mat = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), p = new T.Vector3();
  const v = new T.Vector3(), n = new T.Vector3(), nMat = new T.Matrix3();

  for (const part of specs) {
    const g = buildRockGeometry(part.style, part.seed, detail);
    e.set(part.rot[0], part.rot[1], part.rot[2]);
    q.setFromEuler(e);
    p.set(part.pos[0], part.pos[1], part.pos[2]);
    s.set(part.scale[0], part.scale[1], part.scale[2]);
    mat.compose(p, q, s);
    nMat.getNormalMatrix(mat);
    const gp = g.attributes.position, gn = g.attributes.normal, gao = g.attributes.ao;
    const base = posOut.length / 3;
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i).applyMatrix4(mat);
      n.fromBufferAttribute(gn, i).applyMatrix3(nMat).normalize();
      const mineral = (v.x * 0.75 - v.z * 0.55 + v.y * 1.9) > 0.02 ? 1 : 0;
      const toneMix = (part.tone + mineral) * 0.5;
      const ao = gao ? gao.getX(i) : 0.85;
      posOut.push(v.x, v.y, v.z);
      norOut.push(n.x, n.y, n.z);
      dataOut.push(toneMix, ao, 0, Math.max(0, v.y + 0.32));
    }
    const ix = g.index ? g.index.array : Array.from({ length: gp.count }, (_, k) => k);
    for (let i = 0; i < ix.length; i++) idxOut.push(ix[i] + base);
    g.dispose();
  }

  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(posOut, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(norOut, 3));
  out.setAttribute('aRock', new T.Float32BufferAttribute(dataOut, 4));
  out.setIndex(idxOut);
  out.computeBoundingSphere();
  return out;
}
