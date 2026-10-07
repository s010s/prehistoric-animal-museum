/**
 * Deterministic analytic ocean height field, in metres. Original implementation.
 * Shared by visible surface, refracted irradiance generation, and CPU checks.
 * No simulation state, wall clock, random calls, or independently animated normals.
 */
// A broad, deterministic directional spectrum. Irrational directions and
// incommensurate wavelengths avoid a tiled or parallel stripe appearance.
// All receivers still evaluate exactly this same analytic height/gradient.
export const WAVE_COMPONENTS = Object.freeze(Array.from({ length: 24 }, (_, i) => {
    const wavelength = 22 * Math.pow(.79, i), angle = i * 2.399963229728653 + .28;
    const amplitude = .11 * Math.pow(wavelength / 22, .76) * (1 + .23 * Math.sin(i * 1.71));
    return Object.freeze({ amplitude, wavelength, angle, phase: i * 1.61803398875 + .4,
        k: 2 * Math.PI / wavelength, dirX: Math.cos(angle), dirZ: Math.sin(angle),
        omega: Math.sqrt(9.81 * 2 * Math.PI / wavelength) });
}));
export const WAVE_MAX_AMPLITUDE = WAVE_COMPONENTS.reduce((a, w) => a + w.amplitude, 0);
export const WAVE_MAX_SLOPE = WAVE_COMPONENTS.reduce((a, w) => a + w.amplitude * w.k, 0);
export function sampleWave(x, z, time, { meanY = 12.5, amplitudeScale = 1, footprint = 0, } = {}) {
    let height = meanY, dx = 0, dz = 0;
    for (const w of WAVE_COMPONENTS) {
        // Gaussian low-pass in world space. The SAME footprint is used by all passes.
        const a = amplitudeScale * w.amplitude * Math.exp(-0.5 * (w.k * footprint) ** 2);
        const p = w.k * (w.dirX * x + w.dirZ * z) - w.omega * time + w.phase;
        height += a * Math.sin(p);
        const slope = a * w.k * Math.cos(p);
        dx += slope * w.dirX;
        dz += slope * w.dirZ;
    }
    const inv = 1 / Math.hypot(dx, 1, dz);
    return { height, dx, dz, normal: [-dx * inv, inv, -dz * inv] };
}
const n = x => Number(x).toFixed(12);
export const WAVE_GLSL = `
uniform float uWaveTime;
uniform float uWaveScale;
uniform float uSeaLevel;
uniform float uWaveFootprint;
vec3 waveFilteredHeightSlope(vec2 xz, float footprint) {
  vec3 h = vec3(uSeaLevel, 0.0, 0.0);
  ${WAVE_COMPONENTS.map(w => `{
    float a = uWaveScale * ${n(w.amplitude)} * exp(-0.5 * pow(${n(w.k)} * footprint, 2.0));
    vec2 dir = vec2(${n(w.dirX)}, ${n(w.dirZ)});
    float phase = ${n(w.k)} * dot(dir, xz) - ${n(w.omega)} * uWaveTime + ${n(w.phase)};
    h.x += a * sin(phase);
    h.yz += a * ${n(w.k)} * cos(phase) * dir;
  }`).join('\n')}
  return h;
}
vec3 waveHeightSlope(vec2 xz) { return waveFilteredHeightSlope(xz, uWaveFootprint); }
vec3 waveUnresolvedCovariance(float footprint) {
 vec3 covariance=vec3(0.);
 ${WAVE_COMPONENTS.map(w => `{
 float g=exp(-.5*pow(${n(w.k)}*footprint,2.));
 float v=.5*pow(uWaveScale*${n(w.amplitude*w.k)},2.)*(1.-g*g);
 covariance+=v*vec3(${n(w.dirX*w.dirX)},${n(w.dirX*w.dirZ)},${n(w.dirZ*w.dirZ)});
 }`).join('\n')}
 return covariance;
}
vec3 waveNormal(vec2 xz) {
  vec3 h = waveHeightSlope(xz);
  return normalize(vec3(-h.y, 1.0, -h.z));
}
`;
export function createWaveUniforms({ meanY = 12.5, waveScale = 1, footprint = 0 } = {}) {
    return {
        uWaveTime: { value: 0 }, uWaveScale: { value: waveScale },
        uSeaLevel: { value: meanY }, uWaveFootprint: { value: footprint },
    };
}
