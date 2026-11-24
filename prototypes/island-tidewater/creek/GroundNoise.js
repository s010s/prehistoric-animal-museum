// Dedicated 512x512x2 RGBA8 hardware-mipmapped isotropic ground texture array
// baked once on the CPU (~45 ms, 0 network bytes, 1 sampled binding).
// Every channel has its row, column, and both diagonal means mathematically
// zeroed so horizontal/vertical/diagonal banding is impossible.
//
// Layer 0 (albedo & organic detail):
//   R  fbmA   12x12 base 5-octave isotropic FBM (mean 0.5, std 0.175)
//   G  fbmB   14x14 base 5-octave independent isotropic FBM (mean 0.5, std 0.175)
//   B  gran   multi-scale organic clumps, tufts & litter granulation (mean 0.5, std 0.17)
//   A  grit   fine mineral grain & sparse weathered pebbles (mean 0.5, std 0.165)
//
// Layer 1 (hardware-prefiltered analytic micro-topography & 3rd FBM):
//   RG slope  exact central-difference (dH/du, dH/dv) of smooth isotropic relief
//             (linear mipmapping pre-filters slopes cleanly before Nyquist!)
//   B  fbmC   10x10 base 4-octave uncorrelated FBM for moisture/moss/rock macro
//   A  ao     synchronized crevice/crown micro-AO
import { Texture } from '../vendor/tidewater/src/engine/gpu/Texture.js';
import { generateMipmaps } from '../vendor/tidewater/src/engine/gpu/Mipmaps.js';
import { ShaderModule } from '../vendor/tidewater/src/engine/gpu/Shader.js';
import { commonModule } from '../vendor/tidewater/src/engine/render/wgsl/common.js';

const S = 512;

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makePeriodicNoise(P, seed) {
  const gx = new Float32Array(P * P);
  const gy = new Float32Array(P * P);
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      const a = hash2(i, j, seed) * 6.28318530718;
      gx[j * P + i] = Math.cos(a);
      gy[j * P + i] = Math.sin(a);
    }
  }
  const xi = new Int32Array(S);
  const x1 = new Int32Array(S);
  const xf = new Float32Array(S);
  const ux = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    const t = (i / S) * P;
    const f0 = Math.floor(t);
    const f = t - f0;
    xi[i] = f0 % P;
    x1[i] = (f0 + 1) % P;
    xf[i] = f;
    ux[i] = f * f * f * (f * (f * 6 - 15) + 10);
  }
  return { P, gx, gy, xi, x1, xf, ux };
}

function addFbmTo(out, baseP, octaves, seed, persistence = 0.52) {
  const layers = [];
  let norm = 0;
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    layers.push({ n: makePeriodicNoise(baseP << o, seed + o * 37), amp });
    norm += amp;
    amp *= persistence;
  }
  const invNorm = 1.414 / norm;
  for (let o = 0; o < octaves; o++) {
    const { n, amp: a } = layers[o];
    const { P, gx, gy, xi, x1, xf, ux } = n;
    const scale = a * invNorm;
    for (let j = 0; j < S; j++) {
      const y0 = xi[j] * P;
      const y1 = x1[j] * P;
      const fy = xf[j];
      const fy1 = fy - 1;
      const v = ux[j];
      const row = j * S;
      for (let i = 0; i < S; i++) {
        const i0 = xi[i];
        const i1 = x1[i];
        const fx = xf[i];
        const fx1 = fx - 1;
        const u = ux[i];
        const k00 = y0 + i0;
        const k10 = y0 + i1;
        const k01 = y1 + i0;
        const k11 = y1 + i1;
        const a0 = gx[k00] * fx + gy[k00] * fy;
        const b0 = gx[k10] * fx1 + gy[k10] * fy;
        const c0 = gx[k01] * fx + gy[k01] * fy1;
        const d0 = gx[k11] * fx1 + gy[k11] * fy1;
        out[row + i] += (a0 + (b0 - a0) * u + (c0 - a0 + (a0 - b0 - c0 + d0) * u) * v) * scale;
      }
    }
  }
}

function addTuftsTo(out, P, seed, amp, keepProb = 0.62, sharpness = 2.1) {
  const Q = P + 2;
  const px = new Float32Array(Q * Q);
  const py = new Float32Array(Q * Q);
  const pw = new Float32Array(Q * Q);
  for (let j = 0; j < Q; j++) {
    for (let i = 0; i < Q; i++) {
      const wi = (i - 1 + P) % P;
      const wj = (j - 1 + P) % P;
      px[j * Q + i] = hash2(wi, wj, seed) + i - 1;
      py[j * Q + i] = hash2(wi, wj, seed + 1) + j - 1;
      const id = hash2(wi, wj, seed + 2);
      pw[j * Q + i] = id < keepProb ? (0.45 + 0.55 * (id / keepProb)) : 0;
    }
  }
  for (let j = 0; j < S; j++) {
    const y = (j / S) * P;
    const yi = Math.floor(y);
    const row = j * S;
    for (let i = 0; i < S; i++) {
      const x = (i / S) * P;
      const xi = Math.floor(x);
      let dMin = 9;
      let wBest = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const r = (yi + dj + 1) * Q + xi + 1;
        for (let di = -1; di <= 1; di++) {
          const k = r + di;
          const dx = px[k] - x;
          const dy = py[k] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < dMin) { dMin = d2; wBest = pw[k]; }
        }
      }
      if (wBest > 0) {
        const t = Math.max(0, 1 - Math.sqrt(dMin) * sharpness);
        out[row + i] += t * t * (3 - 2 * t) * wBest * amp;
      }
    }
  }
}

// Mathematically remove all horizontal (kx=0), vertical (ky=0), and +/-45 deg
// diagonal banding modes while preserving exact periodic wrap-around.
function destripeAndNormalize(arr, targetStd) {
  const rowM = new Float64Array(S);
  const colM = new Float64Array(S);
  const d1M = new Float64Array(S);
  const d2M = new Float64Array(S);
  for (let pass = 0; pass < 2; pass++) {
    rowM.fill(0);
    colM.fill(0);
    let total = 0;
    for (let j = 0; j < S; j++) {
      const r = j * S;
      let rs = 0;
      for (let i = 0; i < S; i++) {
        const v = arr[r + i];
        rs += v;
        colM[i] += v;
      }
      rowM[j] = rs / S;
      total += rs;
    }
    const mean = total / (S * S);
    for (let i = 0; i < S; i++) colM[i] /= S;
    for (let j = 0; j < S; j++) {
      const r = j * S;
      const rm = rowM[j] - mean;
      for (let i = 0; i < S; i++) arr[r + i] -= rm + colM[i];
    }
    d1M.fill(0);
    d2M.fill(0);
    for (let j = 0; j < S; j++) {
      const r = j * S;
      for (let i = 0; i < S; i++) {
        const v = arr[r + i];
        d1M[(i + j) & (S - 1)] += v;
        d2M[(i - j) & (S - 1)] += v;
      }
    }
    for (let k = 0; k < S; k++) { d1M[k] /= S; d2M[k] /= S; }
    for (let j = 0; j < S; j++) {
      const r = j * S;
      for (let i = 0; i < S; i++) {
        arr[r + i] -= 0.5 * (d1M[(i + j) & (S - 1)] + d2M[(i - j) & (S - 1)]);
      }
    }
  }
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    sum += v;
    sq += v * v;
  }
  const mean = sum / arr.length;
  const std = Math.sqrt(Math.max(1e-8, sq / arr.length - mean * mean));
  const scale = targetStd / std;
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.min(1, Math.max(0, 0.5 + (arr[i] - mean) * scale));
  }
}

let _groundTex = null;
let _module = null;

export function getGroundNoiseTexture() {
  if (_groundTex) return _groundTex;
  const fbmA = new Float32Array(S * S);
  const fbmB = new Float32Array(S * S);
  const gran = new Float32Array(S * S);
  const grit = new Float32Array(S * S);
  const fbmC = new Float32Array(S * S);

  // Band-split isotropic channels:
  // - fbmA / fbmB / fbmC: smooth 4-octave macro/meso ecological fields (zero high-freq jitter)
  // - gran: zero-low-freq (P>=32) crisp organic tufts, duff clumps, humus pockets & litter clusters
  // - grit: high-frequency mineral grain, sparse weathered pebbles, twigs & dark organic flecks
  addFbmTo(fbmA, 10, 4, 1009, 0.50);
  addFbmTo(fbmB, 12, 4, 2027, 0.50);
  addFbmTo(gran, 32, 4, 3041, 0.72);
  addTuftsTo(gran, 56, 4057, 0.54, 0.58, 2.35);
  addTuftsTo(gran, 96, 4129, -0.44, 0.50, 2.50);
  addTuftsTo(gran, 144, 4211, 0.34, 0.44, 2.65);
  addFbmTo(grit, 64, 3, 5077, 0.80);
  addTuftsTo(grit, 72, 6089, 0.62, 0.22, 2.80);
  addTuftsTo(grit, 88, 6173, -0.56, 0.25, 2.80);
  for (let j = 0; j < S; j++) {
    const r = j * S;
    for (let i = 0; i < S; i++) {
      grit[r + i] += (hash2(i, j, 6299) - 0.5) * 0.24;
    }
  }
  addFbmTo(fbmC, 10, 4, 7103, 0.50);

  destripeAndNormalize(fbmA, 0.175);
  destripeAndNormalize(fbmB, 0.175);
  destripeAndNormalize(gran, 0.185);
  destripeAndNormalize(grit, 0.180);
  destripeAndNormalize(fbmC, 0.175);

  const layer0 = new Uint8Array(S * S * 4);
  const layer1 = new Uint8Array(S * S * 4);
  const H = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    layer0[o] = Math.round(fbmA[i] * 255);
    layer0[o + 1] = Math.round(fbmB[i] * 255);
    layer0[o + 2] = Math.round(gran[i] * 255);
    layer0[o + 3] = Math.round(grit[i] * 255);
    H[i] = fbmA[i] * 0.32 + gran[i] * 0.54 + grit[i] * 0.14;
  }

  // Exact periodic central-difference slopes of H, normalized uniformly across X/Y
  // so hardware linear mipmapping pre-filters slopes cleanly before Nyquist.
  const sx = new Float32Array(S * S);
  const sy = new Float32Array(S * S);
  let sSq = 0;
  for (let j = 0; j < S; j++) {
    const jm = ((j - 1 + S) & (S - 1)) * S;
    const jp = ((j + 1) & (S - 1)) * S;
    const r = j * S;
    for (let i = 0; i < S; i++) {
      const im = (i - 1 + S) & (S - 1);
      const ip = (i + 1) & (S - 1);
      const gx = (H[r + ip] - H[r + im]) * 0.5;
      const gy = (H[jp + i] - H[jm + i]) * 0.5;
      sx[r + i] = gx;
      sy[r + i] = gy;
      sSq += gx * gx + gy * gy;
    }
  }
  const slopeStd = Math.sqrt(Math.max(1e-10, sSq / (2 * S * S)));
  const invSlopeRange = 0.5 / (3.4 * slopeStd);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    const nx = Math.min(1, Math.max(0, 0.5 + sx[i] * invSlopeRange));
    const ny = Math.min(1, Math.max(0, 0.5 + sy[i] * invSlopeRange));
    const ao = Math.min(1, Math.max(0, 0.5 + (H[i] - 0.5) * 1.65));
    layer1[o] = Math.round(nx * 255);
    layer1[o + 1] = Math.round(ny * 255);
    layer1[o + 2] = Math.round(fbmC[i] * 255);
    layer1[o + 3] = Math.round(ao * 255);
  }

  const tex = new Texture({
    label: 'museumGroundNoiseArray',
    width: S,
    height: S,
    depth: 2,
    dimension: '2d-array',
    format: 'rgba8unorm',
    mips: true,
    usage: ['sample', 'copyDst'],
    sampler: 'linearRepeat',
  });
  tex.getGPU();
  tex.upload(layer0, { layer: 0, layers: 1, width: S });
  tex.upload(layer1, { layer: 1, layers: 1, width: S });
  generateMipmaps(tex);
  _groundTex = tex;
  return tex;
}

const GROUND_NOISE_WGSL = /* wgsl */`
// Compute/vertex/fragment-safe isotropic noise lookup from museumGroundTex.
fn museumGroundLevel(p: vec2f, scale: f32, rot: mat2x2f, off: vec2f, footprint: f32, layer: i32) -> vec4f {
  let lod = max(0.0, log2(max(footprint, 0.001) * ${S}.0 / scale));
  return textureSampleLevel(museumGroundTex, smpLinearRepeat, (rot * p) * (1.0 / scale) + off, layer, lod);
}

struct MuseumGroundField {
  broad: f32,    // 0..1 ~613 m macro moisture/biome (shared bit-for-bit with grass blades)
  zone: f32,     // 0..1 ~197 m ecological patches
  meso: f32,     // 0..1 ~61 m hillside clusters
  clump: f32,    // 0..1 ~13.5..61 m tussock/duff mottling
  dry: f32,      // 0..1 orthogonal dryness/mineral contrast field
  fbm: f32,      // 0..1 multi-scale 1/f isotropic blend
  gran: f32,     // 0..1 crisp organic aerial-to-foot granulation (tufts, leaves, duff)
  grit: f32,     // 0..1 fine mineral grain & sparse weathered pebbles
  grad: vec2f,   // hardware-mipmapped analytic world-space slope (dh/dx, dh/dz)
  microAO: f32,  // ~0.91..1.05 crevice/crown micro-shading
};

// Multi-scale incommensurate rotated ground spectrum (613 m / 197 m / 59 m / 17 m / 4.3 m).
// High-frequency detail taps are unwarped (zero marble swirls, exact hardware mip derivatives)
// and band-split (P>=32 granulation/grit modulated by 613 m + 197 m macro fields -> LCM > 50,000 km).
fn museumGroundField(p: vec2f, wx: vec2f, wy: vec2f, footprint: f32) -> MuseumGroundField {
  // Tap 1: 613 m macro (10..12 cells/tile -> 61 m..7.6 m octaves). Shared with museumMeadowAt.
  const r1 = mat2x2f(0.95630, 0.29237, -0.29237, 0.95630); // 17 deg
  let inv1 = 1.0 / 613.0;
  let t1 = textureSampleGrad(museumGroundTex, smpLinearRepeat, (r1 * p) * inv1 + vec2f(0.13, 0.41), 0, (r1 * wx) * inv1, (r1 * wy) * inv1);

  // Tap 2: 197 m meso (83 deg, ultra-gentle low-Jacobian warp +-5.5 m -> zero swirls).
  const r2 = mat2x2f(0.12187, 0.99255, -0.99255, 0.12187); // 83 deg
  let inv2 = 1.0 / 197.0;
  let w2 = (t1.rg - vec2f(0.5)) * 0.06;
  let uv2 = (r2 * p) * inv2 + w2 + vec2f(0.37, 0.71);
  let dx2 = (r2 * wx) * inv2;
  let dy2 = (r2 * wy) * inv2;
  let t2 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv2, 0, dx2, dy2);
  let n2 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv2, 1, dx2, dy2);
  let s2 = (n2.rg - vec2f(0.5)) * 2.0;
  // Transform local UV slope back into world XZ via R2^T.
  var grad = vec2f(r2[0].x * s2.x + r2[0].y * s2.y, r2[1].x * s2.x + r2[1].y * s2.y) * 0.062;

  var zone = t2.r;
  var meso = t2.g;
  var clump = t2.b;
  var gran = t2.b;
  var grit = t2.a;
  var fbmC = n2.b;
  var aoSum = n2.a;

  // Tap 3: 59 m unwarped aerial/mid crisp granulation + pre-filtered analytic normal (149 deg).
  // Active below ~450 m altitude (0.85 m footprint); delivers crisp 0.25-2 m tufts, duff & stones.
  let detailK = 1.0 - smoothstep(0.30, 0.85, footprint);
  if (detailK > 0.001) {
    const r3 = mat2x2f(-0.85717, 0.51504, -0.51504, -0.85717); // 149 deg
    let inv3 = 1.0 / 59.0;
    let uv3 = (r3 * p) * inv3 + vec2f(0.61, 0.23);
    let dx3 = (r3 * wx) * inv3;
    let dy3 = (r3 * wy) * inv3;
    let t3 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv3, 0, dx3, dy3);
    let n3 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv3, 1, dx3, dy3);
    let s3 = (n3.rg - vec2f(0.5)) * 2.0;
    let g3 = vec2f(r3[0].x * s3.x + r3[0].y * s3.y, r3[1].x * s3.x + r3[1].y * s3.y);
    let g3K = (1.0 - smoothstep(0.24, 0.72, footprint)) * 0.098;
    grad += g3 * g3K;
    meso = mix(meso, t2.g * 0.62 + t3.r * 0.38, detailK);
    clump = mix(clump, t3.g * 0.45 + t3.b * 0.55, detailK);
    gran = mix(gran, t2.b * 0.26 + t3.b * 0.74, detailK);
    grit = mix(grit, t2.a * 0.24 + t3.a * 0.76, detailK);
    fbmC = mix(fbmC, n2.b * 0.62 + n3.b * 0.38, detailK);
    aoSum = mix(aoSum, n2.a * 0.36 + n3.a * 0.64, detailK);
  }

  // Tap 4: 17 m unwarped low-flyover / walking detail + tactile normal (41 deg).
  // Cross-scales with 59 m below ~180 m altitude (footprint < 0.24 m) for aperiodic crisp earth.
  let nearK = 1.0 - smoothstep(0.09, 0.24, footprint);
  if (nearK > 0.001) {
    const r4 = mat2x2f(0.75471, 0.65606, -0.65606, 0.75471); // 41 deg
    let inv4 = 1.0 / 17.0;
    let uv4 = (r4 * p) * inv4 + vec2f(0.29, 0.83);
    let dx4 = (r4 * wx) * inv4;
    let dy4 = (r4 * wy) * inv4;
    let t4 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv4, 0, dx4, dy4);
    let n4 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv4, 1, dx4, dy4);
    let s4 = (n4.rg - vec2f(0.5)) * 2.0;
    let g4 = vec2f(r4[0].x * s4.x + r4[0].y * s4.y, r4[1].x * s4.x + r4[1].y * s4.y);
    grad += g4 * (nearK * 0.078);
    clump = mix(clump, clump * 0.54 + t4.b * 0.46, nearK);
    gran = mix(gran, gran * 0.46 + t4.b * 0.54, nearK);
    grit = mix(grit, grit * 0.44 + t4.a * 0.56, nearK);
    aoSum = mix(aoSum, aoSum * 0.54 + n4.a * 0.46, nearK);
  }

  // Tap 5: 4.3 m unwarped foot-level fine mineral & soil grain (119 deg).
  // Skipped past ~22 m from the camera.
  let microK = 1.0 - smoothstep(0.014, 0.042, footprint);
  if (microK > 0.001) {
    const r5 = mat2x2f(-0.48481, 0.87462, -0.87462, -0.48481); // 119 deg
    let inv5 = 1.0 / 4.3;
    let uv5 = (r5 * p) * inv5 + vec2f(0.47, 0.19);
    let t5 = textureSampleGrad(museumGroundTex, smpLinearRepeat, uv5, 0, (r5 * wx) * inv5, (r5 * wy) * inv5);
    gran = mix(gran, gran * 0.58 + t5.b * 0.42, microK);
    grit = mix(grit, grit * 0.38 + t5.a * 0.62, microK);
  }

  let broad = clamp(0.5 + (t1.r * 0.62 + t1.g * 0.38 - 0.5) * 1.14, 0.0, 1.0);
  let dry = clamp(0.5 + (t1.g * 0.46 + fbmC * 0.38 + zone * 0.16 - 0.5) * 1.25, 0.0, 1.0);
  let fbm = clamp(0.5 + (zone * 0.42 + meso * 0.36 + clump * 0.22 - 0.5) * 1.32, 0.0, 1.0);

  var out: MuseumGroundField;
  out.broad = broad;
  out.zone = zone;
  out.meso = meso;
  out.clump = clump;
  out.dry = dry;
  out.fbm = fbm;
  out.gran = gran;
  out.grit = grit;
  out.grad = grad;
  out.microAO = mix(0.84, 1.08, aoSum);
  return out;
}
`;

export function groundNoiseModule() {
  if (_module) return _module;
  _module = new ShaderModule({
    name: 'museumGroundNoise',
    deps: [commonModule],
    bindings: { museumGroundTex: { texture: getGroundNoiseTexture() } },
    code: GROUND_NOISE_WGSL,
  });
  return _module;
}
