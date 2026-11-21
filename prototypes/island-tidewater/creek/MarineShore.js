// The island shelf supplies a coarse open-ocean mask and a coast search seed.
// Recover the actual waterline from the finished terrain in small reusable
// patches, including tidal channels and any features added after the shelf.
const STEP = 4;
const PATCH = 416;
const SNAP = 160;
const MAX_PATCHES = 6;
const MAX_APPROACH = 1400;
const nearestByTerrain = new WeakMap();
const breakerSamples = new WeakMap();
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (x, length) => ((x % length) + length) % length;

function measurePath(points, loop, side) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return {points, distances, length: distances.at(-1), loop, side};
}

function positionAt(path, along) {
  const d = path.loop ? wrap(along, path.length) : Math.min(path.length, Math.max(0, along));
  const {points, distances} = path;
  let lo = 0, hi = distances.length - 1;
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (distances[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - distances[lo]) / (distances[hi] - distances[lo] || 1);
  return [lerp(points[lo][0], points[hi][0], t), lerp(points[lo][1], points[hi][1], t)];
}

function* buildPatch(terrain, shelf, seaLevel, x0, z0) {
  const n = 2 * PATCH / STEP + 1, size = n * n;
  const heights = new Float32Array(size), marine = new Uint8Array(size), queue = new Int32Array(size);
  const pointAt = k => [x0 + (k % n) * STEP, z0 + Math.floor(k / n) * STEP];
  let read = 0, write = 0;
  const enqueue = k => {
    if (heights[k] >= 0 || marine[k]) return;
    marine[k] = 1;
    queue[write++] = k;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * STEP, z = z0 + j * STEP;
      // A tiny bias makes an exact sea-level corner land for connectivity.
      heights[k] = terrain.heightAt(x, z) - seaLevel + 1e-6;
      if ((i === 0 || i === n - 1 || j === 0 || j === n - 1) && shelf.marineAt(x, z) > .6) enqueue(k);
    }
    yield;
  }
  while (read < write) {
    const k = queue[read++];
    if (k % n > 0) enqueue(k - 1);
    if (k % n < n - 1) enqueue(k + 1);
    if (k >= n) enqueue(k - n);
    if (k < size - n) enqueue(k + n);
    if (read % 1024 === 0) yield;
  }

  const nodes = new Map();
  function crossing(a, b) {
    const key = 2 * Math.min(a, b) + Number(Math.abs(a - b) === n);
    let hit = nodes.get(key);
    if (!hit) {
      const [ax, az] = pointAt(a), [bx, bz] = pointAt(b);
      const f = heights[a] / (heights[a] - heights[b]);
      const wet = heights[a] < 0 ? a : b;
      hit = {point: [lerp(ax, bx, f), lerp(az, bz, f)], wet: pointAt(wet), marine: marine[wet], links: []};
      nodes.set(key, hit);
    }
    return hit;
  }
  function join(a, b) {
    if (!a.marine && !b.marine) return;
    a.links.push(b);
    b.links.push(a);
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const k = j * n + i, north = heights[k] < 0;
      if (north === (heights[k + 1] < 0) && north === (heights[k + n] < 0) && north === (heights[k + n + 1] < 0)) continue;
      const corners = [k, k + 1, k + n + 1, k + n], hits = [];
      for (let e = 0; e < 4; e++) {
        const a = corners[e], b = corners[(e + 1) % 4];
        if ((heights[a] < 0) !== (heights[b] < 0)) hits.push(crossing(a, b));
      }
      if (hits.length === 2) join(...hits);
      else if (hits.length === 4) {
        // Resolve the bilinear saddle by the corner determinant. This preserves
        // the two shoreline branches through a diagonal wet/dry cell.
        const determinant = heights[corners[0]] * heights[corners[2]] - heights[corners[1]] * heights[corners[3]];
        const offset = determinant < 0 ? 1 : 0;
        join(hits[offset], hits[offset + 1]);
        join(hits[offset + 2], hits[(offset + 3) % 4]);
      }
    }
    yield;
  }

  const paths = [];
  function trace(start) {
    let last, node = start, side = 0;
    const points = [];
    do {
      node.visited = true;
      points.push(node.point);
      const next = node.links.find(link => link !== last);
      if (next) {
        const [x, z] = node.point;
        const tx = next.point[0] - x, tz = next.point[1] - z;
        side += tx * (node.wet[1] + next.wet[1] - 2 * z) - tz * (node.wet[0] + next.wet[0] - 2 * x);
      }
      last = node;
      node = next;
    } while (node && !node.visited);

    const loop = node === start;
    if (loop) points.push(start.point);
    const raw = measurePath(points, loop, side < 0 ? -1 : 1);
    if (raw.length < STEP * 2) return;
    // Resample before smoothing. Otherwise points where the contour clips a
    // grid corner would have a disproportionate influence on its tangent.
    const count = Math.ceil(raw.length / STEP), resampled = [];
    for (let i = 0; i <= count; i++) resampled.push(positionAt(raw, i * raw.length / count));
    const smoothed = resampled.map((p, i) => {
      if (!loop && (i === 0 || i === count)) return p;
      const a = resampled[(i + count - 1) % count], b = resampled[(i + 1) % count];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
    paths.push(measurePath(smoothed, loop, raw.side));
  }
  // Open paths must start at an end. Remaining unvisited nodes are loops.
  for (const node of nodes.values()) if (node.links.length === 1 && !node.visited) {
    trace(node);
    yield;
  }
  for (const node of nodes.values()) if (node.links.length && !node.visited) {
    trace(node);
    yield;
  }
  return paths;
}

function actualCoastPoint(terrain, seaLevel, point, normal) {
  const height = d => terrain.heightAt(point[0] + normal[0] * d, point[1] + normal[1] * d) - seaLevel;
  let closest = Infinity, bracket;
  let before = height(-8);
  for (let d = -6; d <= 8; d += 2) {
    const after = height(d);
    if (before >= 0 && after < 0 && Math.abs(d - 1) < closest) {
      closest = Math.abs(d - 1);
      bracket = [d - 2, d];
    }
    before = after;
  }
  if (!bracket) return null;
  let [lo, hi] = bracket;
  for (let i = 0; i < 9; i++) {
    const d = (lo + hi) * .5;
    if (height(d) >= 0) lo = d;
    else hi = d;
  }
  const d = (lo + hi) * .5;
  return [point[0] + normal[0] * d, point[1] + normal[1] * d];
}

class MarineShore {
  constructor(terrain, shelf, seaLevel) {
    this.terrain = terrain;
    this.shelf = shelf;
    this.seaLevel = seaLevel;
    this.patches = new Map();
  }

  at(path, along) {
    if (!path.loop && (along < 0 || along > path.length)) return null;
    const point = positionAt(path, along);
    const radius = Math.min(10, path.length * .16);
    const a = positionAt(path, along - radius), b = positionAt(path, along + radius);
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < .001) return null;
    const normal = [-dz / length * path.side, dx / length * path.side];
    const refined = actualCoastPoint(this.terrain, this.seaLevel, point, normal);
    return refined && {point: refined, normal};
  }

  // Finite budgets return undefined while a new patch is being traced.
  // Null means the requested location has no nearby marine waterline.
  nearest(x, z, {budgetMs = Infinity} = {}) {
    const deadline = performance.now() + budgetMs;
    let best = MAX_APPROACH ** 2, seed;
    for (const segment of this.shelf.segments) {
      const [sx, sz] = segment.point;
      const d = (x - sx) ** 2 + (z - sz) ** 2;
      if (d < best) { best = d; seed = segment.point; }
    }
    if (!seed) return null;
    const x0 = Math.round(seed[0] / SNAP) * SNAP - PATCH;
    const z0 = Math.round(seed[1] / SNAP) * SNAP - PATCH;
    const key = x0 + ',' + z0;
    let patch = this.patches.get(key);
    if (patch) this.patches.delete(key);
    else {
      patch = {build: buildPatch(this.terrain, this.shelf, this.seaLevel, x0, z0)};
      if (this.patches.size >= MAX_PATCHES) this.patches.delete(this.patches.keys().next().value);
    }
    this.patches.set(key, patch);
    if (patch.build) {
      while (performance.now() < deadline) {
        const step = patch.build.next();
        if (!step.done) continue;
        patch.paths = step.value;
        patch.build = null;
        break;
      }
      if (patch.build) return undefined;
    }

    let result = null;
    for (const path of patch.paths) {
      best = Infinity;
      let along;
      for (let i = 1; i < path.points.length; i++) {
        const [ax, az] = path.points[i - 1], [bx, bz] = path.points[i];
        const dx = bx - ax, dz = bz - az, squared = dx * dx + dz * dz;
        if (squared < 1e-8) continue;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / squared));
        const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
        if (d >= best) continue;
        best = d;
        along = lerp(path.distances[i - 1], path.distances[i], t);
      }
      if (result && best > (result.distance + 8) ** 2) continue;
      for (const offset of [0, -2, 2, -4, 4]) {
        const a = along + offset;
        const sample = this.at(path, a);
        if (!sample) continue;
        const distance = Math.hypot(x - sample.point[0], z - sample.point[1]);
        if (!result || distance < result.distance) result = {...sample, along:a, path, distance};
        if (offset === 0) break;
      }
    }
    return result;
  }

}

// CPU contour samples are shared by the optical and acoustic shoreline adapters.
export function marineShoreFor(terrain, shelf, seaLevel = -.7) {
  let byShelf = nearestByTerrain.get(terrain);
  if (!byShelf) nearestByTerrain.set(terrain, byShelf = new WeakMap());
  let shore = byShelf.get(shelf);
  if (!shore || shore.seaLevel !== seaLevel) byShelf.set(shelf, shore = new MarineShore(terrain, shelf, seaLevel));
  return shore;
}

// Match the native 64-sample budget. The extended scan keeps a 2 m stride
// through the first 32 m, then uses the remaining 47 samples up to 8 m apart.
export const BREAKER_SCAN_SAMPLES = 64;
export const BREAKER_INNER_SAMPLES = 16;
export const BREAKER_INNER_DISTANCE = 32;
export const BREAKER_NATIVE_DISTANCE = 126;
export const BREAKER_MAX_DISTANCE = BREAKER_INNER_DISTANCE + (BREAKER_SCAN_SAMPLES - 1 - BREAKER_INNER_SAMPLES) * 8;

export function breakerTransectEnd(terrain, seaLevel, {point, normal}) {
  const [x, z] = point, [nx, nz] = normal;
  let wet = false, deep = 0;
  for (let d = 2; d <= BREAKER_MAX_DISTANCE; d += 2) {
    const depth = seaLevel - terrain.heightAt(x + nx * d, z + nz * d);
    // A straight transect into a headland or the opposite inlet bank ends
    // here. A wet patch beyond that barrier belongs to a different coast.
    if (depth <= 0) return wet ? d - 2 : 0;
    if (depth >= .12) wet = true;
    deep = depth >= 3.4 ? deep + 2 : 0;
    if (deep >= 24 && d >= BREAKER_NATIVE_DISTANCE) return d;
  }
  return wet ? BREAKER_MAX_DISTANCE : 0;
}

export function* buildBreakerWindow(shore, anchor, spacing, capacity, out) {
  out.fill(0);
  const {path} = anchor;
  const available = Math.floor(path.length / spacing) + (path.loop ? 0 : 1);
  const count = Math.min(capacity, available);
  // A camera move slides the window by whole stations along its coast.
  // Both terrain samples and positions survive through the overlapping part.
  let start = Math.round(anchor.along / spacing - (count - 1) * .5);
  if (!path.loop) start = Math.max(0, Math.min(available - count, start));
  let cache = breakerSamples.get(path);
  if (!cache || cache.spacing !== spacing) breakerSamples.set(path, cache = {spacing, samples: new Map()});
  let valid = 0, span = 0;
  const rangeStart = capacity * 4;
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % 4 === 0) yield;
    const index = path.loop ? wrap(start + i, available) : start + i;
    let sample = cache.samples.get(index);
    if (sample === undefined) {
      const s = shore.at(path, index * spacing);
      const end = s ? breakerTransectEnd(shore.terrain, shore.seaLevel, s) : 0;
      sample = end ? {...s, end} : null;
      cache.samples.set(index, sample);
    }
    if (!sample) continue;
    out.set([...sample.point, ...sample.normal], i * 4);
    out[rangeStart + i * 4] = sample.end;
    valid++;
    span = Math.max(span, sample.end);
  }
  return {valid, span};
}
