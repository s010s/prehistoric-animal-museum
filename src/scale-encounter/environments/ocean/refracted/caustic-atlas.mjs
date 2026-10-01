/*!
MIT License

Copyright (c) 2026 Scottie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * Shared real-time refracted irradiance with RGBA32F accumulation.
 * Requires float blending and float linear filtering. No visual-parameter changes.
 * Water-surface refracted irradiance atlas v2, WebGL2 / Three.js.
 * Reconstruct in a mean-ray-sheared light coordinate system; use one stationary
 * source mesh for every depth and a finite solar-disk / receiver-pixel quadrature.
 * Algorithm reference: ScottieFox/caustic-volume, MIT, Copyright (c) 2026 Scottie.
 * Pinned upstream d87351bff19831aa9d11c0679605fad6797b133f:
 * sandbox/src/20_caustic.js (photon-grid area Jacobian), 30_trace.js (slice query).
 * Upstream notice and pinned source: LICENSE-ScottieFox.txt and README.md.
 * This is an original narrow implementation, not a port of that complete renderer.
 *
 * Units: atlas stores RGB irradiance perpendicular to the refracted beam, already
 * attenuated along the incident underwater path. Multiply by sigma_s * phase in
 * a volume, or by BRDF * max(dot(N, -D), 0) on a surface. Do NOT attenuate the light
 * path twice. View-path transmittance remains the compositor's responsibility.
 * Limitations: finite quadrature of one solar disk; piecewise-linear photon bundles; scalar
 * irradiance does not retain multiple incoming directions after caustic folding;
 * phase/BRDF uses the mean flat-water direction; no actor occlusion in this field.
 */
import { CLOUD_BANK_GLSL, CLOUD_BANK } from './cloud-bank.mjs';
import { WAVE_GLSL, WAVE_COMPONENTS, WAVE_MAX_AMPLITUDE, sampleWave, createWaveUniforms } from './wave-field.mjs';
export const CAUSTIC_REFERENCE_COMMIT = 'd87351bff19831aa9d11c0679605fad6797b133f';
const norm = a => { const v = Array.isArray(a) ? a : [a.x, a.y, a.z]; const l = Math.hypot(...v); return v.map(x => x / l); };
const vec = (a, fallback) => a === undefined ? [...fallback] : Array.isArray(a) ? [...a] : [a.x ?? a.r, a.y ?? a.g, a.z ?? a.b];
export function fresnelDielectric(cosI, etaI = 1, etaT = 1.333) {
    cosI = Math.min(1, Math.max(0, cosI));
    const sinT2 = (etaI / etaT) ** 2 * (1 - cosI * cosI);
    if (sinT2 >= 1)
        return 1;
    const cosT = Math.sqrt(1 - sinT2);
    const rs = (etaT * cosI - etaI * cosT) / (etaT * cosI + etaI * cosT);
    const rp = (etaI * cosI - etaT * cosT) / (etaI * cosI + etaT * cosT);
    return 0.5 * (rs * rs + rp * rp);
}
export function refractSun(sunDirection, normal = [0, 1, 0], ior = 1.333) {
    const S = norm(sunDirection), N = norm(normal), I = S.map(v => -v), eta = 1 / ior;
    const NI = I.reduce((a, v, i) => a + v * N[i], 0), k = 1 - eta * eta * (1 - NI * NI);
    if (k < 0)
        return [0, 0, 0];
    return I.map((v, i) => eta * v - (eta * NI + Math.sqrt(k)) * N[i]);
}
export function flatIrradiance(depth, { sunDirection = [-0.295, 0.5, -0.814], sunIrradiance = [4.8, 4.6, 4.1], sigmaT = [0.038, 0.023, 0.020], ior = 1.333, } = {}) {
    const S = norm(sunDirection), D = refractSun(S, [0, 1, 0], ior);
    const cosine = Math.max(-D[1], 1e-6);
    const transfer = Math.max(S[1], 0) * (1 - fresnelDielectric(S[1], 1, ior)) / cosine;
    return vec(sunIrradiance).map((E, i) => E * transfer * Math.exp(-vec(sigmaT)[i] * Math.max(depth, 0) / cosine));
}
/** Equal-energy symmetric quadrature of a uniform-radiance solar disk.
 * Four samples reproduce its first/second angular moments. Eight add two rings.
 * Receiver offsets are an explicit 2x2 pixel-area quadrature, not a blur radius.
 * Pairing the angular and receiver samples is a low-order product-rule
 * approximation; increase samples and resolution for convergence checks.
 */
export function makeSunDiskSamples(sunDirection, count = 4, angularDiameterDegrees = 0.53) {
    if (![1, 4, 8].includes(count))
        throw new Error('sunSamples must be 1, 4, or 8');
    const S = norm(sunDirection), radius = angularDiameterDegrees * Math.PI / 360;
    if (!(radius >= 0 && radius < 0.1))
        throw new Error('Invalid sun angular diameter');
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const U = norm(cross(Math.abs(S[1]) > .95 ? [1, 0, 0] : [0, 1, 0], S)), V = cross(S, U);
    const pixelOffsets = [[-.25, -.25], [.25, .25], [-.25, .25], [.25, -.25]];
    if (count === 1)
        return [{ direction: S, weight: 1, receiverOffset: [0, 0], angle: 0 }];
    return Array.from({ length: count }, (_, i) => {
        const ring = Math.floor(i / 4), radial = count === 4 ? Math.SQRT1_2 : Math.sqrt((ring + .5) / 2);
        const angle = radius * radial, phi = (i % 4) * Math.PI / 2 + Math.PI / 4 + ring * Math.PI / 4;
        return { direction: norm(S.map((s, c) => s * Math.cos(angle) + (U[c] * Math.cos(phi) + V[c] * Math.sin(phi)) * Math.sin(angle))),
            weight: 1 / count, receiverOffset: pixelOffsets[i % 4], angle };
    });
}
export function flatSunDiskIrradiance(depth, options = {}) {
    const sum = [0, 0, 0];
    for (const sample of makeSunDiskSamples(options.sunDirection ?? [-.295, .5, -.814], options.sunSamples ?? 4, options.sunAngularDiameterDegrees ?? .53)) {
        const value = flatIrradiance(depth, { ...options, sunDirection: sample.direction });
        for (let c = 0; c < 3; c++)
            sum[c] += sample.weight * value[c];
    }
    return sum;
}
export function worldToLightXZ(p, meanY, meanDirection) {
    const D = vec(meanDirection), distance = (meanY - p[1]) / Math.max(-D[1], 1e-6);
    return [p[0] - D[0] * distance, p[2] - D[2] * distance];
}
export function traceWavePhoton(x, z, time, depth, options = {}) {
    const meanY = options.meanY ?? 12.5, ior = options.ior ?? 1.333;
    const S = norm(options.sunDirection ?? [-0.295, 0.5, -0.814]);
    const wave = sampleWave(x, z, time, {
        meanY, amplitudeScale: options.waveScale ?? 1, footprint: options.waveFootprint ?? 0,
    });
    const D = refractSun(S, wave.normal, ior), cosI = S.reduce((a, v, i) => a + v * wave.normal[i], 0);
    const t = (meanY - depth - wave.height) / D[1];
    // Flux per unit horizontal source area; divide receiver-area irradiance by
    // abs(D.y) to obtain perpendicular-beam irradiance in the shader.
    const fluxWeight = Math.max(cosI, 0) / wave.normal[1] * (1 - fresnelDielectric(cosI, 1, ior));
    return { entry: [x, wave.height, z], direction: D, distance: t, valid: t >= 0 && D[1] < 0 && cosI > 0,
        position: [x + D[0] * t, meanY - depth, z + D[2] * t], fluxWeight,
        perpendicularWeight: fluxWeight / Math.max(-D[1], 1e-6) };
}
export function homogeneousVolumeReference(distance, E, sigmaS, sigmaT, phase = 1 / (4 * Math.PI)) {
    return {
        transmittance: sigmaT.map(s => Math.exp(-s * distance)),
        scattering: E.map((e, i) => e * sigmaS[i] * phase * (sigmaT[i] < 1e-12 ? distance : -Math.expm1(-sigmaT[i] * distance) / sigmaT[i])),
    };
}
export const CAUSTIC_SAMPLER_GLSL = `
${CLOUD_BANK_GLSL}
uniform sampler2D uCausticAtlas;
uniform vec4 uCausticBounds;
uniform vec4 uCausticLightBounds;
uniform vec4 uCausticAtlasLayout; // columns, tile stride, inner tile size, padding
uniform vec2 uCausticAtlasSize;
uniform vec2 uCausticDepthRange;
uniform float uCausticLayers;
uniform float uCausticDepthExponent;
uniform float uCausticSeaLevel;
uniform float uCausticBorder;
uniform vec3 uCausticSigmaT;
uniform vec3 uCausticFlatIrradiance;
uniform vec3 uCausticMeanDirection;
vec3 flatWaterIrradiance(vec3 p) {
  float path = max(uCausticSeaLevel - p.y, 0.0) / max(-uCausticMeanDirection.y, 0.001);
  vec2 entry=p.xz-uCausticMeanDirection.xz*path;
  return uCausticFlatIrradiance * exp(-uCausticSigmaT * path)*cloudSolarTransmission(entry);
}
vec3 causticSlice(vec2 uv, float layer) {
  float col = mod(layer, uCausticAtlasLayout.x);
  float row = floor(layer / uCausticAtlasLayout.x);
  float r = uCausticAtlasLayout.z;
  vec2 inner = clamp(uv, vec2(0.5/r), vec2(1.0-0.5/r)) * r;
  vec2 pixel = vec2(col,row) * uCausticAtlasLayout.y + uCausticAtlasLayout.w + inner;
  return texture(uCausticAtlas, pixel/uCausticAtlasSize).rgb;
}
vec3 sampleField(vec3 p) {
  vec3 base = flatWaterIrradiance(p);
  float depth = uCausticSeaLevel-p.y;
  // Interpolate along the refracted mean ray, NOT along world-vertical columns.
  vec2 lightXZ=p.xz-uCausticMeanDirection.xz*depth/max(-uCausticMeanDirection.y,0.001);
  vec2 uv = (lightXZ-uCausticLightBounds.xy)/(uCausticLightBounds.zw-uCausticLightBounds.xy);
  float edge = min(min(p.x-uCausticBounds.x,uCausticBounds.z-p.x),min(p.z-uCausticBounds.y,uCausticBounds.w-p.z));
  float spatial = smoothstep(0.0,uCausticBorder,edge);
  float d = clamp((depth-uCausticDepthRange.x)/(uCausticDepthRange.y-uCausticDepthRange.x),0.0,1.0);
  float layer = pow(d,1.0/uCausticDepthExponent)*(uCausticLayers-1.0);
  float a = min(floor(layer),uCausticLayers-2.0);
  vec3 field = mix(causticSlice(uv,a),causticSlice(uv,a+1.0),layer-a);
  float deepFade = 1.0-smoothstep(uCausticDepthRange.y-4.0,uCausticDepthRange.y,depth);
  return max(mix(base,field,spatial*deepFade),vec3(0.0));
}
`;
const VERTEX_SHADER = `
precision highp float;
in vec3 position;
${WAVE_GLSL}
uniform vec4 uPhotonDomain;
uniform vec4 uFieldBounds;
uniform vec3 uFieldMeanDirection;
uniform vec2 uReceiverJitter;
uniform float uReceiverResolution;
uniform vec3 uAirSunDirection;
uniform float uWaterIor;
uniform float uSliceY;
out vec2 vSourceXZ;
out vec2 vReceiverXZ;
out float vPerpendicularWeight;
out float vLightDistance;
float fresnelWater(float c) {
  c=clamp(c,0.0,1.0);
  float ct=sqrt(max(0.0,1.0-(1.0-c*c)/(uWaterIor*uWaterIor)));
  float rs=(uWaterIor*c-ct)/max(uWaterIor*c+ct,1e-7);
  float rp=(c-uWaterIor*ct)/max(c+uWaterIor*ct,1e-7);
  return 0.5*(rs*rs+rp*rp);
}
void main() {
  vec2 xz=mix(uPhotonDomain.xy,uPhotonDomain.zw,position.xz);
  vec3 h=waveHeightSlope(xz);
  vec3 P=vec3(xz.x,h.x,xz.y);
  vec3 N=normalize(vec3(-h.y,1.0,-h.z));
  vec3 D=refract(-uAirSunDirection,N,1.0/uWaterIor);
  float distance=(uSliceY-P.y)/min(D.y,-1e-5);
  vec3 Q=P+D*max(distance,0.0);
  float ci=dot(uAirSunDirection,N);
  float valid=(distance>=0.0 && D.y<0.0 && ci>0.0)?1.0:0.0;
  vPerpendicularWeight=valid*max(ci,0.0)/max(N.y,1e-5)*(1.0-fresnelWater(ci))/max(-D.y,1e-5);
  vLightDistance=max(distance,0.0);
  float sliceDepth=uSeaLevel-uSliceY;
  vec2 lightXZ=Q.xz-uFieldMeanDirection.xz*sliceDepth/max(-uFieldMeanDirection.y,0.001);
  vSourceXZ=P.xz; vReceiverXZ=lightXZ;
  vec2 uv=(lightXZ-uFieldBounds.xy)/(uFieldBounds.zw-uFieldBounds.xy);
  uv+=uReceiverJitter/uReceiverResolution;
  gl_Position=vec4(uv*2.0-1.0,0.0,1.0);
}`;
const FRAGMENT_SHADER = `
precision highp float;
${CLOUD_BANK_GLSL}
in vec2 vSourceXZ;
in vec2 vReceiverXZ;
in float vPerpendicularWeight;
in float vLightDistance;
uniform vec3 uFieldSigmaT;
uniform vec3 uFieldSunIrradiance;
out vec4 outColor;
void main() {
  vec2 a=dFdx(vSourceXZ),b=dFdy(vSourceXZ),c=dFdx(vReceiverXZ),d=dFdy(vReceiverXZ);
  float oldArea=abs(a.x*b.y-a.y*b.x),newArea=abs(c.x*d.y-c.y*d.x);
  float jacobian=oldArea/max(newArea,1e-18);
  vec3 energy=uFieldSunIrradiance*jacobian*vPerpendicularWeight*exp(-uFieldSigmaT*vLightDistance)*cloudSolarTransmission(vSourceXZ);
  if(any(isnan(energy))||any(isinf(energy))) discard;
  // Half-float overflow guard only, not the upstream artistic contrast/clamp.
  outColor=vec4(min(energy,vec3(60000.0)),0.0);
}`;
export function createRefractedCausticField(THREE, renderer, input = {}) {
    const options = {
        meanY: 12.5, bounds: [-32, -48, 32, 24], photonResolution: 128,
        sliceResolution: 128, layers: 24, maxDepth: 40, depthExponent: 1.2,
        sunSamples: 4, sunAngularDiameterDegrees: 0.53, waveFootprint: 0.65,
        waveScale: 1, border: 6, ior: 1.333,
        sunDirection: [-0.295, 0.5, -0.814], sunIrradiance: [4.8, 4.6, 4.1], sigmaT: [0.038, 0.023, 0.020],
        ...input,
    };
    options.sunDirection = norm(options.sunDirection);
    options.sunIrradiance = vec(options.sunIrradiance);
    options.sigmaT = vec(options.sigmaT);
    for (const k of ['photonResolution', 'sliceResolution', 'layers']) {
        if (!Number.isInteger(options[k]) || options[k] < 2)
            throw new Error(`Invalid ${k}`);
    }
    if (!renderer.capabilities.isWebGL2)
        throw new Error('Refracted field requires WebGL2');
    if (!renderer.extensions.has('EXT_color_buffer_float'))
        throw new Error('Refracted field requires EXT_color_buffer_float');
    if (!renderer.extensions.has('EXT_float_blend'))
        throw new Error('F32 diagnostic requires EXT_float_blend');
    if (!renderer.extensions.has('OES_texture_float_linear'))
        throw new Error('F32 diagnostic requires OES_texture_float_linear');
    if (options.sunDirection[1] <= 0)
        throw new Error('Air sun must be above the horizon');
    if (options.bounds.length !== 4 || options.bounds[2] <= options.bounds[0] || options.bounds[3] <= options.bounds[1])
        throw new Error('Invalid field bounds');
    const D = refractSun(options.sunDirection, [0, 1, 0], options.ior);
    const sunSamples = makeSunDiskSamples(options.sunDirection, options.sunSamples, options.sunAngularDiameterDegrees);
    const topMargin = WAVE_MAX_AMPLITUDE * Math.abs(options.waveScale) + 0.05;
    const depthRange = [-topMargin, options.maxDepth];
    const sliceDepths = Array.from({ length: options.layers }, (_, i) => depthRange[0] + (depthRange[1] - depthRange[0]) * Math.pow(i / (options.layers - 1), options.depthExponent));
    // Include every world-domain point at every depth in the sheared atlas.
    const b = options.bounds, lightPoints = [];
    for (const depth of depthRange)
        for (const x of [b[0], b[2]])
            for (const z of [b[1], b[3]])
                lightPoints.push(worldToLightXZ([x, options.meanY - depth, z], options.meanY, D));
    const lightBounds = [Math.min(...lightPoints.map(p => p[0])), Math.min(...lightPoints.map(p => p[1])), Math.max(...lightPoints.map(p => p[0])), Math.max(...lightPoints.map(p => p[1]))];
    // Bound all surface slopes of the filtered spectrum. Shift and expand EACH
    // slice's emission domain so the atlas does not acquire artificial dark edges.
    const slopeBound = Math.abs(options.waveScale) * WAVE_COMPONENTS.reduce((s, w) => s + w.amplitude * w.k * Math.exp(-0.5 * (w.k * options.waveFootprint) ** 2), 0);
    const deviation = [0, 0], maxRatio = [Math.abs(D[0] / D[1]), Math.abs(D[2] / D[1])];
    for (const sunSample of sunSamples)
        for (let k = 0; k < 1024; k++) {
            const a = k / 1024 * 2 * Math.PI, N = norm([-slopeBound * Math.cos(a), 1, -slopeBound * Math.sin(a)]);
            if (N.reduce((s, v, i) => s + v * sunSample.direction[i], 0) <= 0)
                continue;
            const d = refractSun(sunSample.direction, N, options.ior);
            if (d[1] >= -0.05)
                throw new Error('Wave slopes can refract too close to horizontal for this bounded atlas');
            for (let c = 0; c < 2; c++) {
                const axis = c === 0 ? 0 : 2;
                deviation[c] = Math.max(deviation[c], Math.abs(d[axis] / d[1] - D[axis] / D[1]));
                maxRatio[c] = Math.max(maxRatio[c], Math.abs(d[axis] / d[1]));
            }
        }
    const mx = 2 + options.maxDepth * deviation[0] * 1.03 + topMargin * maxRatio[0];
    const mz = 2 + options.maxDepth * deviation[1] * 1.03 + topMargin * maxRatio[1];
    const sourceDomain = [lightBounds[0] - mx, lightBounds[1] - mz, lightBounds[2] + mx, lightBounds[3] + mz];
    const photonDomainForDepth = () => sourceDomain;
    const waveUniforms = createWaveUniforms({ meanY: options.meanY, waveScale: options.waveScale, footprint: options.waveFootprint });
    const columns = Math.ceil(Math.sqrt(options.layers)), rows = Math.ceil(options.layers / columns), padding = 1, stride = options.sliceResolution + 2 * padding;
    const width = columns * stride, height = rows * stride;
    if (Math.max(width, height) > renderer.capabilities.maxTextureSize)
        throw new Error('Caustic atlas exceeds MAX_TEXTURE_SIZE');
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    target.texture.name = 'refracted-irradiance-atlas';
    target.texture.colorSpace = THREE.NoColorSpace;
    const flat = flatSunDiskIrradiance(0, options);
    const cloudBankEnabled = { value: 1 }, cloudOrigin = { value: new THREE.Vector2() };
    const uniforms = { ...waveUniforms, uCloudBankEnabled: cloudBankEnabled, uCloudOrigin: cloudOrigin,
        uCausticAtlas: { value: target.texture }, uCausticBounds: { value: new THREE.Vector4(...options.bounds) },
        uCausticLightBounds: { value: new THREE.Vector4(...lightBounds) },
        uCausticAtlasLayout: { value: new THREE.Vector4(columns, stride, options.sliceResolution, padding) },
        uCausticAtlasSize: { value: new THREE.Vector2(width, height) }, uCausticDepthRange: { value: new THREE.Vector2(...depthRange) },
        uCausticLayers: { value: options.layers }, uCausticDepthExponent: { value: options.depthExponent },
        uCausticSeaLevel: { value: options.meanY }, uCausticBorder: { value: options.border },
        uCausticSigmaT: { value: new THREE.Vector3(...options.sigmaT) }, uCausticFlatIrradiance: { value: new THREE.Vector3(...flat) },
        uCausticMeanDirection: { value: new THREE.Vector3(...D) },
    };
    const materialUniforms = { ...waveUniforms, uCloudBankEnabled: cloudBankEnabled, uCloudOrigin: cloudOrigin,
        uPhotonDomain: { value: new THREE.Vector4(...sourceDomain) }, uFieldBounds: { value: new THREE.Vector4(...lightBounds) },
        uFieldMeanDirection: { value: new THREE.Vector3(...D) }, uReceiverJitter: { value: new THREE.Vector2() }, uReceiverResolution: { value: options.sliceResolution },
        uAirSunDirection: { value: new THREE.Vector3(...options.sunDirection) }, uWaterIor: { value: options.ior }, uSliceY: { value: options.meanY },
        uFieldSigmaT: { value: new THREE.Vector3(...options.sigmaT) }, uFieldSunIrradiance: { value: new THREE.Vector3(...options.sunIrradiance) },
    };
    const n = options.photonResolution, positions = new Float32Array(n * n * 3), indices = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
            const k = (j * n + i) * 3;
            positions[k] = i / (n - 1);
            positions[k + 2] = j / (n - 1);
        }
    let at = 0;
    for (let j = 0; j < n - 1; j++)
        for (let i = 0; i < n - 1; i++) {
            const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
            indices.set([a, b, c, b, d, c], at);
            at += 6;
        }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: materialUniforms,
        vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
        transparent: true, forceSinglePass: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.Camera();
    const diagnostics = { referenceCommit: CAUSTIC_REFERENCE_COMMIT, threeRevision: THREE.REVISION, options,
        cloudBank: CLOUD_BANK, cloudControl: 'Actual photon sourceXZ solar attenuation; far continuation uses mean-ray entry. Explicit broad world-space artistic cloud bank.', revision: 'ray-aligned-atlas-v12-cloud-bank', accumulationFormat: 'RGBA32F', atlasSize: [width, height], atlasBytes: width * height * 16, trianglesPerUpdate: 2 * (n - 1) * (n - 1) * options.layers * sunSamples.length,
        lightBounds, fixedSourceDomain: sourceDomain, sunDiskSamples: sunSamples,
        reconstruction: 'mean-ray-sheared trilinear, fixed source nodes, finite solar-disk plus explicit receiver-pixel quadrature',
        receiverTexelMetres: [(lightBounds[2] - lightBounds[0]) / options.sliceResolution, (lightBounds[3] - lightBounds[1]) / options.sliceResolution],
        photonSpacingMetres: [(sourceDomain[2] - sourceDomain[0]) / (n - 1), (sourceDomain[3] - sourceDomain[1]) / (n - 1)],
        sliceDepths, photonSourceDomains: sliceDepths.map(photonDomainForDepth), filteredSlopeBound: slopeBound, maximumSlopeDeflection: deviation,
        meanRefractedDirection: D, flatSurfaceIrradiance: flat, lastTime: null, updates: 0,
        approximations: ['finite uniform solar-disk quadrature', 'coupled angular and receiver-pixel quadrature', 'mean direction for phase/BRDF', 'finite photon-grid rasterization', 'no actor light-path occlusion', 'far-field flat-water continuation', 'half-float overflow guard at 60000 per contribution'] };
    let disposed = false;
    function update(time) {
        if (disposed)
            throw new Error('Caustic field disposed');
        if (!Number.isFinite(time))
            throw new Error('Invalid wave time');
        waveUniforms.uWaveTime.value = time;
        const previous = { target: renderer.getRenderTarget(), viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
            scissorTest: renderer.getScissorTest(), clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, xr: renderer.xr.enabled };
        try {
            renderer.xr.enabled = false;
            renderer.autoClear = false;
            // RenderTarget rectangles are texture pixels. Renderer setters use
            // logical pixels and multiply DPR even while an RTT is bound.
            target.viewport.set(0, 0, width, height);
            target.scissor.set(0, 0, width, height);
            target.scissorTest = false;
            renderer.setRenderTarget(target);
            renderer.setClearColor(0, 0);
            renderer.clear(true, false, false);
            target.scissorTest = true;
            const captureState = options.captureRenderState?.();
            if (captureState) diagnostics.tileRenderStates = [];
            for (let l = 0; l < options.layers; l++) {
                const depth = sliceDepths[l];
                // Same source vertex is the same physical ray bundle in EVERY slice.
                materialUniforms.uPhotonDomain.value.set(...sourceDomain);
                materialUniforms.uSliceY.value = options.meanY - depth;
                const x = (l % columns) * stride + padding, y = Math.floor(l / columns) * stride + padding;
                target.viewport.set(x, y, options.sliceResolution, options.sliceResolution);
                target.scissor.set(x, y, options.sliceResolution, options.sliceResolution);
                renderer.setRenderTarget(target);
                if (captureState && (l === 0 || l === options.layers - 1)) {
                    const gl = renderer.getContext();
                    diagnostics.tileRenderStates.push({ layer: l, expected: [x, y, options.sliceResolution, options.sliceResolution], viewport: Array.from(gl.getParameter(gl.VIEWPORT)), scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)), scissorTest: gl.isEnabled(gl.SCISSOR_TEST), targetSize: [width, height], dpr: renderer.getPixelRatio() });
                }
                for (const sample of sunSamples) {
                    materialUniforms.uAirSunDirection.value.set(...sample.direction);
                    materialUniforms.uReceiverJitter.value.set(...sample.receiverOffset);
                    materialUniforms.uFieldSunIrradiance.value.set(...options.sunIrradiance.map(E => E * sample.weight));
                    renderer.render(scene, camera);
                }
            }
            diagnostics.lastTime = time;
            diagnostics.updates++;
        }
        finally {
            renderer.setRenderTarget(previous.target);
            renderer.setClearColor(previous.clearColor, previous.clearAlpha);
            renderer.autoClear = previous.autoClear;
            renderer.xr.enabled = previous.xr;
        }
    }
    function readSliceStatistics({ layer = Math.floor(options.layers / 2), region = null } = {}) {
        if (disposed)
            throw new Error('Caustic field disposed');
        if (!Number.isInteger(layer) || layer < 0 || layer >= options.layers)
            throw new Error('Invalid atlas layer');
        const size = options.sliceResolution, r = region ?? { x: Math.floor(size / 2) - 16, y: Math.floor(size / 2) - 16, width: 32, height: 32 };
        for (const k of ['x', 'y', 'width', 'height'])
            if (!Number.isInteger(r[k]))
                throw new Error('Readback region must use integer pixels');
        if (r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 || r.x + r.width > size || r.y + r.height > size)
            throw new Error('Readback region outside slice');
        const data = new Float32Array(r.width * r.height * 4), gl = renderer.getContext();
        const priorError = gl.getError();
        if (priorError !== gl.NO_ERROR)
            throw new Error(`GL error before caustic readback: ${priorError}`);
        // RGBA16F readPixels HALF_FLOAT support differs by backend. Copy only the
        // requested region to a tiny RGBA32F target, then read the guaranteed FLOAT
        // representation without tone mapping, color conversion, or quantization.
        const readTarget = new THREE.WebGLRenderTarget(r.width, r.height, { type: THREE.FloatType, format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
        readTarget.texture.colorSpace = THREE.NoColorSpace;
        const readMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
            uniforms: { tAtlas: { value: target.texture }, uOrigin: { value: new THREE.Vector2((layer % columns) * stride + padding + r.x, Math.floor(layer / columns) * stride + padding + r.y) },
                uRegion: { value: new THREE.Vector2(r.width, r.height) }, uSize: { value: new THREE.Vector2(width, height) } },
            vertexShader: 'precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
            fragmentShader: 'precision highp float;in vec2 vUv;uniform sampler2D tAtlas;uniform vec2 uOrigin,uRegion,uSize;out vec4 outColor;void main(){outColor=texture(tAtlas,(uOrigin+vUv*uRegion)/uSize);}' });
        const readGeometry = new THREE.PlaneGeometry(2, 2), readScene = new THREE.Scene();
        readScene.add(new THREE.Mesh(readGeometry, readMaterial));
        const previous = { target: renderer.getRenderTarget(), viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
            scissorTest: renderer.getScissorTest(), autoClear: renderer.autoClear, xr: renderer.xr.enabled };
        try {
            renderer.xr.enabled = false;
            renderer.autoClear = false;
            renderer.setRenderTarget(readTarget);
            renderer.render(readScene, new THREE.Camera());
            renderer.readRenderTargetPixels(readTarget, 0, 0, r.width, r.height, data);
            const error = gl.getError();
            if (error !== gl.NO_ERROR)
                throw new Error(`Float32 caustic readback failed: ${error}`);
        }
        finally {
            renderer.setRenderTarget(previous.target);
            renderer.autoClear = previous.autoClear;
            renderer.xr.enabled = previous.xr;
            readTarget.dispose();
            readMaterial.dispose();
            readGeometry.dispose();
        }
        const sum = [0, 0, 0], sum2 = [0, 0, 0], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        let nonFinite = 0;
        for (let p = 0; p < data.length; p += 4)
            for (let c = 0; c < 3; c++) {
                const v = data[p + c];
                if (!Number.isFinite(v)) {
                    nonFinite++;
                    continue;
                }
                sum[c] += v;
                sum2[c] += v * v;
                min[c] = Math.min(min[c], v);
                max[c] = Math.max(max[c], v);
            }
        const count = r.width * r.height, mean = sum.map(x => x / count), expectedFlat = flatSunDiskIrradiance(sliceDepths[layer], options);
        return { layer, depth: sliceDepths[layer], region: r, count, mean, min, max, standardDeviation: sum2.map((v, i) => Math.sqrt(Math.max(0, v / count - mean[i] * mean[i]))), nonFinite,
            expectedFlat, relativeFlatError: mean.map((v, i) => (v - expectedFlat[i]) / expectedFlat[i]), waveScale: waveUniforms.uWaveScale.value };
    }
    function dispose() { if (disposed)
        return; disposed = true; target.dispose(); geometry.dispose(); material.dispose(); }
    return { update, texture: target.texture, target, renderTarget: target, readSliceStatistics, samplerGLSL: CAUSTIC_SAMPLER_GLSL, uniforms, waveUniforms,
        meanRefractedDirection: new THREE.Vector3(...D), options, diagnostics, dispose };
}
export const createCausticAtlas = createRefractedCausticField;
