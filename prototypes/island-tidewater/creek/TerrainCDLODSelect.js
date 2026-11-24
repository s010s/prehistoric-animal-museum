import { Box3, Frustum, Matrix4 } from '../vendor/tidewater/src/engine/index.js';
import { TerrainData } from '../vendor/tidewater/src/world/TerrainData.js';

const _frustum = new Frustum();
const _vp = new Matrix4();
const _box = new Box3();

// Pad every composed terrain layer's boundsFor query by -texel on -X/-Z so
// TerrainData.boundsFor covers the -0.5 bilinear texel tap without editing
// vendor TerrainData.js or cartography-locked terrain authoring inputs.
export function hardenTerrainBounds(data) {
  const base = data?.terrain;
  if (!base || base._boundsHardened) return base;
  const protoBounds = TerrainData.prototype.boundsFor;
  const layers = [
    ...(data.regionTerrains ?? []),
    data.coreTerrain,
    data.sourceTerrain,
    data.eastSourceTerrain,
    ...(data.sampleTerrains ?? []),
    ...(data.regionalTerrains ?? []),
  ].filter(Boolean);
  const rawBase = (x0, z0, x1, z1) => {
    const cx = base.center?.[0] ?? 0;
    const cz = base.center?.[1] ?? 0;
    return protoBounds.call(base, x0 - cx - base.texel, z0 - cz - base.texel, x1 - cx, z1 - cz);
  };
  base.boundsFor = (x0, z0, x1, z1) => {
    let [lo, hi] = rawBase(x0, z0, x1, z1);
    for (const p of layers) {
      const cx = p.center?.[0] ?? 0;
      const cz = p.center?.[1] ?? 0;
      const half = (p.outer ?? p.size * 0.5) + p.texel;
      if (x1 < cx - half || x0 > cx + half || z1 < cz - half || z0 > cz + half) continue;
      const b = protoBounds.call(p, x0 - cx - p.texel, z0 - cz - p.texel, x1 - cx, z1 - cz);
      if (b[0] < lo) lo = b[0];
      if (b[1] > hi) hi = b[1];
    }
    return [lo, hi];
  };
  base._boundsHardened = true;
  return base;
}

// Conservative world-space AABB for a CDLOD terrain node, accounting for
// -spacing geomorph shift, rounding, bilinear height taps, and domain edge.
export function terrainNodeBox(data, x, z, size, spacing) {
  const x0 = x - spacing - 2;
  const z0 = z - spacing - 2;
  const x1 = x + size + 2;
  const z1 = z + size + 2;
  const pad = data.texel + 2;
  let [y0, y1] = data.boundsFor(x0 - pad, z0 - pad, x1 + pad, z1 + pad);
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 > y1) return null;
  if (x0 < -16370 || z0 < -16370 || x1 > 16370 || z1 > 16370) y0 = Math.min(y0, -90);
  y0 -= 2;
  y1 += 2;
  return {
    x: (x0 + x1) * 0.5,
    y: (y0 + y1) * 0.5,
    z: (z0 + z1) * 0.5,
    rx: (x1 - x0) * 0.5,
    ry: (y1 - y0) * 0.5,
    rz: (z1 - z0) * 0.5,
  };
}

function getCachedNodeBox(cache, data, x, z, size, level, spacing) {
  const full = size === 64 * spacing;
  const canCache = (full || size === 32 * spacing) && spacing === (2 ** level) / 8 && level >= 0 && level <= 12
    && Number.isInteger(level) && Number.isInteger(x / 4) && Number.isInteger(z / 4)
    && x >= -16384 && z >= -16384 && x + size <= 16384 && z + size <= 16384;
  if (!canCache || !cache) return terrainNodeBox(data, x, z, size, spacing);
  const key = (((x + 16384) / 4 * 8193 + (z + 16384) / 4) * 32) + 2 * level + Number(full);
  let box = cache.get(key);
  if (!box) {
    box = terrainNodeBox(data, x, z, size, spacing);
    if (box) cache.set(key, box);
  }
  return box;
}

export function outsideOrthoMap(box, matrix, margin) {
  for (let i = 0; i < 2; i++) {
    const ax = matrix[i] * box.x;
    const ay = matrix[i + 4] * box.y;
    const az = matrix[i + 8] * box.z;
    const t = matrix[i + 12];
    const extent = Math.abs(matrix[i]) * box.rx + Math.abs(matrix[i + 4]) * box.ry + Math.abs(matrix[i + 8]) * box.rz;
    const error = 2e-6 * (Math.abs(ax) + Math.abs(ay) + Math.abs(az) + Math.abs(t) + extent + 1);
    if (Math.abs(ax + ay + az + t) > 1 + extent + margin + error) return true;
  }
  // Orthographic standard Z in WebGPU clip space is [0, 1].
  const zx = matrix[2] * box.x;
  const zy = matrix[6] * box.y;
  const zz = matrix[10] * box.z;
  const zt = matrix[14];
  const zc = zx + zy + zz + zt;
  const zExt = Math.abs(matrix[2]) * box.rx + Math.abs(matrix[6]) * box.ry + Math.abs(matrix[10]) * box.rz;
  const zErr = 2e-6 * (Math.abs(zx) + Math.abs(zy) + Math.abs(zz) + Math.abs(zt) + zExt + 1);
  if (zc - zExt > 1 + zErr || zc + zExt < -zErr) return true;
  return false;
}

function sphereHitsNode(lod, cam, x, z, size, r) {
  let minY = lod.minY;
  let maxY = lod.maxY;
  if (lod.heightBounds) {
    const b = lod.heightBounds(x, z, x + size, z + size);
    minY = b[0];
    maxY = b[1];
  }
  const dx = Math.max(x - cam.x, 0, cam.x - (x + size));
  const dy = Math.max(minY - cam.y, 0, cam.y - maxY);
  const dz = Math.max(z - cam.z, 0, cam.z - (z + size));
  return dx * dx + dy * dy + dz * dz <= r * r;
}

// Select CDLOD terrain patches directly against an orthographic shadow cascade
// frustum while keeping LOD transitions anchored to the main camera viewPos so
// shadow geometry matches the main-pass terrain surface without cracks or acne.
export function selectTerrainNodesForOrtho(terrain, viewPos, matrix, mapSize, dst, boxCache = null) {
  const { lod, data } = terrain;
  const maxInstances = lod.maxInstances;
  const ranges = lod.ranges;
  const spacings = lod.uSpacing.array;
  const margin = 4 / mapSize;
  let count = 0;

  const add = (x, z, size, level) => {
    if (count >= maxInstances) return;
    const o = count++ * 4;
    dst[o] = x;
    dst[o + 1] = z;
    dst[o + 2] = size;
    dst[o + 3] = level;
  };

  const visible = (x, z, size, level) => {
    const box = getCachedNodeBox(boxCache, data, x, z, size, level, spacings[level]);
    return !box || !outsideOrthoMap(box, matrix, margin);
  };

  const select = (x, z, size, level) => {
    if (!sphereHitsNode(lod, viewPos, x, z, size, ranges[level])) return false;
    if (!visible(x, z, size, level)) return true;
    if (level === 0 || !sphereHitsNode(lod, viewPos, x, z, size, ranges[level - 1])) {
      add(x, z, size, level);
      return true;
    }
    const h = size * 0.5;
    if (!select(x, z, h, level - 1) && visible(x, z, h, level)) add(x, z, h, level);
    if (!select(x + h, z, h, level - 1) && visible(x + h, z, h, level)) add(x + h, z, h, level);
    if (!select(x, z + h, h, level - 1) && visible(x, z + h, h, level)) add(x, z + h, h, level);
    if (!select(x + h, z + h, h, level - 1) && visible(x + h, z + h, h, level)) add(x + h, z + h, h, level);
    return true;
  };

  const top = lod.levels - 1;
  const rootSize = lod.leafSize * (2 ** top);
  if (lod.fixedRoot) {
    const { x, z, size } = lod.fixedRoot;
    const n = Math.ceil(size / rootSize);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) select(x + i * rootSize, z + j * rootSize, rootSize, top);
  } else {
    const cx = Math.floor(viewPos.x / rootSize);
    const cz = Math.floor(viewPos.z / rootSize);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) select((cx + i) * rootSize, (cz + j) * rootSize, rootSize, top);
  }

  return count;
}

// Select CDLOD terrain patches against an arbitrary perspective camera frustum
// (e.g., the widened refraction guard-band camera) while keeping LOD distances
// anchored to viewPos so interior/perimeter morphing matches the main pass.
export function selectTerrainNodesForFrustum(terrain, camera, viewPos, dst, order = []) {
  const { lod } = terrain;
  camera.updateMatrixWorld();
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_vp, camera.coordinateSystem, camera.reversedDepth);

  const maxInstances = lod.maxInstances;
  const ranges = lod.ranges;
  let count = 0;

  const boxOf = (x, z, size) => {
    if (lod.heightBounds) {
      const [a, b] = lod.heightBounds(x, z, x + size, z + size);
      _box.min.set(x, a, z);
      _box.max.set(x + size, b, z + size);
    } else {
      _box.min.set(x, lod.minY, z);
      _box.max.set(x + size, lod.maxY, z + size);
    }
    return _box;
  };

  const add = (x, z, size, level) => {
    if (count >= maxInstances) return;
    const o = count++ * 4;
    dst[o] = x;
    dst[o + 1] = z;
    dst[o + 2] = size;
    dst[o + 3] = level;
  };

  const select = (x, z, size, level) => {
    const box = boxOf(x, z, size);
    const dx = Math.max(box.min.x - viewPos.x, 0, viewPos.x - box.max.x);
    const dy = Math.max(box.min.y - viewPos.y, 0, viewPos.y - box.max.y);
    const dz = Math.max(box.min.z - viewPos.z, 0, viewPos.z - box.max.z);
    if (dx * dx + dy * dy + dz * dz > ranges[level] * ranges[level]) return false;
    if (!_frustum.intersectsBox(box)) return true;
    if (level === 0 || dx * dx + dy * dy + dz * dz > ranges[level - 1] * ranges[level - 1]) {
      add(x, z, size, level);
      return true;
    }
    const h = size * 0.5;
    for (const [cx, cz] of [[x, z], [x + h, z], [x, z + h], [x + h, z + h]]) {
      if (!select(cx, cz, h, level - 1)) {
        if (_frustum.intersectsBox(boxOf(cx, cz, h))) add(cx, cz, h, level);
      }
    }
    return true;
  };

  const top = lod.levels - 1;
  const rootSize = lod.leafSize * (2 ** top);
  if (lod.fixedRoot) {
    const { x, z, size } = lod.fixedRoot;
    const n = Math.ceil(size / rootSize);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) select(x + i * rootSize, z + j * rootSize, rootSize, top);
  } else {
    const cx = Math.floor(viewPos.x / rootSize);
    const cz = Math.floor(viewPos.z / rootSize);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) select((cx + i) * rootSize, (cz + j) * rootSize, rootSize, top);
  }

  // Front-to-back order for early-Z in the refraction pass.
  order.length = count;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const x = dst[o], z = dst[o + 1], s = dst[o + 2], l = dst[o + 3];
    const dx = Math.max(x - viewPos.x, 0, viewPos.x - x - s);
    const dz = Math.max(z - viewPos.z, 0, viewPos.z - z - s);
    order[i] = { d: dx * dx + dz * dz, x, z, s, l };
  }
  order.sort((a, b) => a.d - b.d);
  for (let i = 0; i < count; i++) {
    const o = order[i];
    dst[i * 4] = o.x;
    dst[i * 4 + 1] = o.z;
    dst[i * 4 + 2] = o.s;
    dst[i * 4 + 3] = o.l;
  }
  return count;
}
