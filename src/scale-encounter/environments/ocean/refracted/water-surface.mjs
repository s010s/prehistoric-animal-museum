// SPDX-License-Identifier: AGPL-3.0-only
// Continuous solar-disc integration of the same Gaussian slope-average radiance
// used by v4. This is not a full microfacet BTDF: no visibility/masking or eta^2
// transport factor is introduced. Wide sky/Fresnel quadrature remains unchanged.
import * as THREE from 'three';
import { CLOUD_BANK_GLSL, CLOUD_BANK } from './cloud-bank.mjs';
import { WAVE_GLSL, WAVE_COMPONENTS, WAVE_MAX_AMPLITUDE } from './wave-field.mjs';
import { MEDIUM, FIELD } from './config.mjs';
const ETA = 1.333, TAU = 2 * Math.PI;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export function unresolvedSlopeBasis(footprint) {
    let xx = 0, xz = 0, zz = 0;
    for (const w of WAVE_COMPONENTS) {
        const g = Math.exp(-.5 * (w.k * footprint) ** 2), v = .5 * (w.amplitude * w.k) ** 2 * (1 - g * g);
        xx += v * w.dirX * w.dirX;
        xz += v * w.dirX * w.dirZ;
        zz += v * w.dirZ * w.dirZ;
    }
    const a = Math.sqrt(Math.max(xx, 0)), b = a > 1e-8 ? xz / a : 0, c = Math.sqrt(Math.max(zz - b * b, 0));
    return { basis: [a, b, 0, c], covariance: [xx, xz, zz] };
}
export function angularSlopeSamples(count = 64) {
    const points = Array.from({ length: count }, (_, i) => { const r = Math.sqrt(-2 * Math.log(1 - (i + .5) / count)), a = i * Math.PI * (3 - Math.sqrt(5)); return [r * Math.cos(a), r * Math.sin(a)]; });
    const mean = [0, 1].map(k => points.reduce((sum, v) => sum + v[k], 0) / count);
    for (const v of points) {
        v[0] -= mean[0];
        v[1] -= mean[1];
    }
    const xx = points.reduce((sum, v) => sum + v[0] * v[0], 0) / count, xz = points.reduce((sum, v) => sum + v[0] * v[1], 0) / count, zz = points.reduce((sum, v) => sum + v[1] * v[1], 0) / count;
    const a = Math.sqrt(xx), b = xz / a, c = Math.sqrt(zz - b * b);
    return points.map(([x, z]) => { const q = x / a; return [q, (z - b * q) / c]; });
}
export function waterToAirFresnel(ci) {
    if (ci <= 0)
        return 1;
    ci = Math.min(ci, 1);
    const st2 = ETA * ETA * Math.max(0, 1 - ci * ci);
    if (st2 >= 1)
        return 1;
    const ct = Math.sqrt(1 - st2), rs = (ETA * ci - ct) / (ETA * ci + ct), rp = (ci - ETA * ct) / (ci + ETA * ct);
    return .5 * (rs * rs + rp * rp);
}
// Map an air direction back to the graph slope that sends this water view ray
// there. ds/dOmega = dot(N,S)/(N.y*K.y^2), K=eta*rd-S. Absolute determinant.
export function solarTargetSlope(rd, S) {
    const K = rd.map((x, i) => ETA * x - S[i]);
    if (K[1] <= 1e-9)
        return null;
    const N = norm(K), ci = dot(rd, N), ct = dot(S, N);
    if (ci <= 0 || ct <= 0)
        return null;
    return { slope: [-K[0] / K[1], -K[2] / K[1]], normal: N, cosWater: ci, cosAir: ct, jacobian: ct / (N[1] * K[1] * K[1]) };
}
export function gaussianSlopePdf(q, covariance) {
    const [xx, xz, zz] = covariance, det = xx * zz - xz * xz;
    if (det <= 0)
        return 0;
    return Math.exp(-.5 * (zz * q[0] * q[0] - 2 * xz * q[0] * q[1] + xx * q[1] * q[1]) / det) / (TAU * Math.sqrt(det));
}
export function addPixelSlopeCovariance(base, dx, dz) {
    return [base[0] + (dx[0] ** 2 + dz[0] ** 2) / 12, base[1] + (dx[0] * dx[1] + dz[0] * dz[1]) / 12, base[2] + (dx[1] ** 2 + dz[1] ** 2) / 12];
}
const GAUSS = {
    2: [[-.5773502691896257, 1], [.5773502691896257, 1]],
    4: [[-.8611363115940526, .3478548451374538], [-.3399810435848563, .6521451548625461], [.3399810435848563, .6521451548625461], [.8611363115940526, .3478548451374538]],
    8: [[-.9602898564975363, .1012285362903763], [-.7966664774136267, .2223810344533745], [-.525532409916329, .3137066458778873], [-.1834346424956498, .362683783378362], [.1834346424956498, .362683783378362], [.525532409916329, .3137066458778873], [.7966664774136267, .2223810344533745], [.9602898564975363, .1012285362903763]],
};
export function solarDiscEffectiveSolidAngle(radius) { return TAU * (1 - .5 * (Math.cos(radius * .9) + Math.cos(radius * 1.1))); }
export function makeSolarDiscQuadrature(sun, radius, { radialOrder = 2, azimuthalOrder = 4 } = {}) {
    if (!GAUSS[radialOrder] || !Number.isInteger(azimuthalOrder) || azimuthalOrder < 4)
        throw new Error('Unsupported solar quadrature');
    const S = norm(sun), T = norm(cross(Math.abs(S[1]) < .95 ? [0, 1, 0] : [1, 0, 0], S)), B = cross(S, T), a = Math.cos(radius * 1.1), b = Math.cos(radius * .9), samples = [];
    // Split the full-intensity core and cubic smoothstep shoulder. Two Gauss
    // nodes integrate the shoulder weight exactly in cos(theta), hence dOmega.
    for (const [lo, hi, shoulder] of [[b, 1, false], [a, b, true]])
        for (const [x, w] of GAUSS[radialOrder]) {
            const c = (lo + hi) / 2 + x * (hi - lo) / 2, r = Math.sqrt(Math.max(0, 1 - c * c));
            const weight = w * (hi - lo) / 2 * (shoulder ? smooth((c - a) / (b - a)) : 1) * TAU / azimuthalOrder;
            for (let j = 0; j < azimuthalOrder; j++) {
                const phi = TAU * (j + .5) / azimuthalOrder;
                const direction = S.map((v, k) => v * c + r * (T[k] * Math.cos(phi) + B[k] * Math.sin(phi)));
                samples.push({ direction, solidAngle: weight });
            }
        }
    return samples;
}
// Evaluate density times Jacobian in the exponent domain. At K.y -> 0 the
// slope demand tends to infinity and Gaussian decay dominates K.y^-3. Keeping
// their product together avoids either a 0*Infinity or artificial bright tail.
export function solarSlopeIntegral(rd, meanSlope, covariance, samples) {
    const [xx, xz, zz] = covariance, det = xx * zz - xz * xz;
    if (det <= 0)
        return 0;
    let sum = 0;
    for (const { direction: S, solidAngle } of samples) {
        const K = rd.map((v, i) => ETA * v - S[i]), ky = K[1];
        if (ky <= 0)
            continue;
        const N = norm(K), ci = dot(rd, N), ctK = dot(S, K);
        if (ci <= 0 || ctK <= 0)
            continue;
        const f = [K[0] + ky * meanSlope[0], K[2] + ky * meanSlope[1]];
        const mahal = Math.max(0, zz * f[0] * f[0] - 2 * xz * f[0] * f[1] + xx * f[1] * f[1]) / (det * ky * ky);
        const logDensityJacobian = -.5 * mahal - Math.log(TAU) - .5 * Math.log(det) + Math.log(ctK) - 3 * Math.log(ky);
        sum += solidAngle * Math.exp(logDensityJacobian) * (1 - waterToAirFresnel(ci));
    }
    return sum;
}
export const PIXEL_GAUSS_OFFSET = 1 / (2 * Math.sqrt(3));
export function solarPixelIntegral(rd, meanSlope, covariance, samples, { rayDx = [0, 0, 0], rayDy = [0, 0, 0], slopeDx = [0, 0], slopeDy = [0, 0] } = {}) {
    let sum = 0;
    for (const x of [-PIXEL_GAUSS_OFFSET, PIXEL_GAUSS_OFFSET])
        for (const y of [-PIXEL_GAUSS_OFFSET, PIXEL_GAUSS_OFFSET]) {
            const ray = norm(rd.map((v, i) => v + x * rayDx[i] + y * rayDy[i])), slope = meanSlope.map((v, i) => v + x * slopeDx[i] + y * slopeDy[i]);
            sum += solarSlopeIntegral(ray, slope, covariance, samples) * .25;
        }
    return sum;
}
export function createPhysicalWaterSurface(field, radianceTexture) {
    const day = Object.fromEntries(Object.entries({ horizon: '#bbcdd5', skyLow: '#a9bfcd', skyMid: '#8bacc2', skyUpper: '#678fab', skyZenith: '#48789b' }).map(([k, v]) => [k, new THREE.Color(v).toArray()])), unresolved = unresolvedSlopeBasis(field.waveUniforms.uWaveFootprint.value), radius = FIELD.sunAngularDiameterDegrees * Math.PI / 360;
    const solarSamples = makeSolarDiscQuadrature(MEDIUM.sunDirection, radius), sunDiscGain = { value: 1 };
    const uniforms = { ...field.uniforms, uInverseProjection: { value: new THREE.Matrix4() }, uCameraWorld: { value: new THREE.Matrix4() }, uWaterLut: { value: radianceTexture }, uAirSunDirection: { value: new THREE.Vector3(...MEDIUM.sunDirection) }, uAirSunColor: { value: new THREE.Vector3(...MEDIUM.sunIrradiance) }, uAirSunRadius: { value: radius }, uSlopeSamples: { value: angularSlopeSamples(16).map(q => new THREE.Vector2(...q)) }, uSlopeBasis: { value: new THREE.Matrix2().fromArray(unresolved.basis) }, uSlopeCovariance: { value: new THREE.Vector3(...unresolved.covariance) }, uSolarDirections: { value: solarSamples.map(s => new THREE.Vector3(...s.direction)) }, uSolarSolidAngles: { value: solarSamples.map(s => s.solidAngle) }, uSunDiscGain: sunDiscGain };
    for (const [u, k] of [['uSkyHorizon', 'horizon'], ['uSkyLow', 'skyLow'], ['uSkyMid', 'skyMid'], ['uSkyUpper', 'skyUpper'], ['uSkyZenith', 'skyZenith']])
        uniforms[u] = { value: new THREE.Vector3(...day[k]) };
    const material = new THREE.ShaderMaterial({ uniforms, side: THREE.DoubleSide, depthWrite: true, depthTest: true, toneMapped: false, vertexShader: `varying vec2 vScreenUv;
 void main(){vScreenUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`, fragmentShader: `precision highp float;
 varying vec2 vScreenUv;uniform mat4 uInverseProjection,uCameraWorld,projectionMatrix;uniform sampler2D uWaterLut;
 uniform vec3 uAirSunDirection,uAirSunColor,uSkyHorizon,uSkyLow,uSkyMid,uSkyUpper,uSkyZenith,uSlopeCovariance;
 ${CLOUD_BANK_GLSL}
 uniform mat2 uSlopeBasis;uniform vec2 uSlopeSamples[16];uniform float uAirSunRadius,uSunDiscGain;
 uniform vec3 uSolarDirections[${solarSamples.length}];uniform float uSolarSolidAngles[${solarSamples.length}];
 ${WAVE_GLSL}
 vec2 envUv(vec3 d){return vec2(atan(d.z,d.x)*.15915494309189535+.5,asin(clamp(d.y,-1.,1.))*.3183098861837907+.5);}
 float fresnel(float ci){float st=1.333*sqrt(max(0.,1.-ci*ci));if(st>=1.)return 1.;float ct=sqrt(max(0.,1.-st*st));float rs=(1.333*ci-ct)/(1.333*ci+ct),rp=(ci-1.333*ct)/(ci+1.333*ct);return .5*(rs*rs+rp*rp);}
 // Preserve v4's wide sky and halo exactly; the small solar disc is integrated separately.
 vec3 outsideSky(vec3 d){float y=max(0.,d.y);vec3 sky=mix(uSkyHorizon,uSkyLow,smoothstep(0.,.055,y));sky=mix(sky,uSkyMid,smoothstep(.02,.18,y));sky=mix(sky,uSkyUpper,smoothstep(.10,.36,y));sky=mix(sky,uSkyZenith,smoothstep(.27,.75,y));float c=dot(d,uAirSunDirection),halo=pow(max(c,0.),512.)*.2;return sky+uAirSunColor*halo;}
 vec3 surfaceRadiance(vec3 rd,vec2 slope,vec2 surfaceXZ){vec3 n=normalize(vec3(-slope.x,1.,-slope.y));float F=fresnel(clamp(dot(rd,n),0.,1.));vec3 transmitted=refract(rd,-n,1.333),reflected=reflect(rd,-n);vec3 reflectedWater=texture2D(uWaterLut,envUv(reflected)).rgb*cloudWaterRadianceScale(surfaceXZ);vec3 airRadiance=dot(transmitted,transmitted)<.1?vec3(0.):outsideSky(normalize(transmitted))*cloudSkyRadianceScale(surfaceXZ);return mix(airRadiance,reflectedWater,F);}
 // Continuous Gaussian-slope solar integral, with no inverse-Snell derivatives.
 float pointSun(vec3 rd,vec2 slope,vec3 C){
  float det=C.x*C.z-C.y*C.y;
  float sum=0.;
  for(int i=0;i<${solarSamples.length};i++){
   vec3 S=uSolarDirections[i],K=1.333*rd-S;
   if(K.y<=0.)continue;
   vec3 n=normalize(K);float ci=dot(rd,n),ctK=dot(S,K);
   if(ci<=0.||ctK<=0.)continue;
   // f=-K.y*(targetSlope-resolvedSlope) stays finite at K.y=0.
   vec2 mismatch=K.xz+K.y*slope;
   float numerator=max(0.,C.z*mismatch.x*mismatch.x-2.*C.y*mismatch.x*mismatch.y+C.x*mismatch.y*mismatch.y);
   float mahal=numerator/(det*K.y*K.y);
   // Exact PDF*Jacobian; Gaussian tail wins over K.y^-3 at the pole.
   float logDensityJacobian=-.5*mahal-1.8378770664093453-.5*log(det)+log(ctK)-3.*log(K.y);
   sum+=uSolarSolidAngles[i]*exp(logDensityJacobian)*(1.-fresnel(clamp(ci,0.,1.)));
  }
  return sum;
 }
 float continuousSun(vec3 rd,vec2 slope,vec3 covariance){
  // Integrate a finite square pixel, not an unbounded Gaussian fitted after a
  // singular coordinate transformation. These derivatives are of smooth world
  // quantities only. The 2x2 Gauss rule has zero mean and exact variance 1/12.
  vec3 rx=dFdx(rd),ry=dFdy(rd);vec2 sx=dFdx(slope),sy=dFdy(slope);
  vec3 base=covariance;
  if(dot(base,vec3(1.,0.,1.))<1.e-14){
   vec3 n=normalize(vec3(-slope.x,1.,-slope.y)),tr=refract(rd,-n,1.333);
   float c=dot(tr,uAirSunDirection),a=cos(uAirSunRadius*1.1),b=cos(uAirSunRadius*.9);
   float width=max(fwidth(c),1.e-9);float disc=smoothstep(a-width*.5,b+width*.5,c);
   return disc*(1.-fresnel(clamp(dot(rd,n),0.,1.)));
  }
  base.xz+=vec2(1.e-12);
  float sum=0.;
  for(int i=0;i<4;i++){
   vec2 offset=vec2((i==0||i==2)?-1.:1.,i<2?-1.:1.)*.2886751345948129;
   vec3 r=normalize(rd+rx*offset.x+ry*offset.y);
   vec2 s=slope+sx*offset.x+sy*offset.y;
   sum+=pointSun(r,s,base)*.25;
  }
  return sum;
 }
 vec3 rayDirection(){vec4 p=uInverseProjection*vec4(vScreenUv*2.-1.,.9998,1.);return normalize((uCameraWorld*vec4(p.xyz/p.w,1.)).xyz-cameraPosition);}
 void main(){
 vec3 rd=rayDirection();if(abs(rd.y)<1.e-6)discard;
 float t=(uSeaLevel-cameraPosition.y)/rd.y;if(t<=0.)discard;
 if(t>=160.){gl_FragDepth=.999998;gl_FragColor=vec4(texture2D(uWaterLut,envUv(rd)).rgb,1.);return;}
 float delta=${WAVE_MAX_AMPLITUDE.toFixed(8)}*abs(uWaveScale/rd.y);
 float low=max(.001,t-delta),high=t+delta;
 // Infinite shared wave surface, solved in world coordinates. It writes real
 // fragment depth so opaque animals and the child retain ordinary occlusion.
 // Far grazing rays use the smooth mean-wave continuation, never a mesh edge.
 float resolved=1.-smoothstep(150.,600.,t);vec3 wave;
 for(int i=0;i<3;i++){vec3 p=cameraPosition+rd*t;wave=waveHeightSlope(p.xz);float h=mix(uSeaLevel,wave.x,resolved);float derivative=rd.y-resolved*dot(wave.yz,rd.xz);t=clamp(t-(p.y-h)/(abs(derivative)>.001?derivative:rd.y),low,high);}
 vec3 vWaterWorld=cameraPosition+rd*t;
 // Pixel filtering is derived from the same wave spectrum, rather than a
 // separate normal texture. Unresolved variance moves into sky quadrature.
 float pixelFootprint=max(uWaveFootprint,.35*max(length(dFdx(vWaterWorld.xz)),length(dFdy(vWaterWorld.xz))));
 vec2 slope=waveFilteredHeightSlope(vWaterWorld.xz,pixelFootprint).yz*resolved;
 vec3 covariance=waveUnresolvedCovariance(pixelFootprint);
 float a=sqrt(max(covariance.x,1.e-14)),b=covariance.y/a,c=sqrt(max(covariance.z-b*b,1.e-14));
 mat2 slopeBasis=mat2(a,b,0.,c);
 vec4 clip=projectionMatrix*viewMatrix*vec4(vWaterWorld,1.);gl_FragDepth=min(.999998,clip.z/clip.w*.5+.5);
 float nearSurface=1.-smoothstep(35.,160.,t);if(nearSurface==0.){gl_FragColor=vec4(texture2D(uWaterLut,envUv(rd)).rgb,1.);return;}
 vec3 radiance=vec3(0.);
 for(int i=0;i<16;i++){radiance+=surfaceRadiance(rd,slope+slopeBasis*uSlopeSamples[i],vWaterWorld.xz)*(1./16.);}
 radiance+=uAirSunColor*(28.*uSunDiscGain*continuousSun(rd,slope,covariance)*cloudSolarTransmission(vWaterWorld.xz));
 // Match the same deep-water boundary radiance at grazing distance; the
 // resolved interface fades continuously into its distant ocean continuation.
 radiance=mix(texture2D(uWaterLut,envUv(rd)).rgb,radiance,nearSurface);
 gl_FragColor=vec4(radiance,1.);}` });
    const g = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'shared-wave-refracting-water-surface-v12';
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    return { mesh, uniforms, sunDiscGain, diagnostics: { cloudBank: CLOUD_BANK, localReflectionApproximation: true, unresolvedSlopeCovariance: unresolved.covariance, angularSamples: 16, solarDiscSamples: solarSamples.length, solarDiscEffectiveSolidAngle: solarDiscEffectiveSolidAngle(radius), solarDiscQuadratureWeightSum: solarSamples.reduce((s, x) => s + x.solidAngle, 0), solarIntegration: 'Continuous Gaussian slope PDF transformed from finite smooth solar disc by exact Snell direction-to-slope Jacobian', pixelFootprint: 'Finite 2x2 square-pixel Gauss quadrature of smooth view ray and resolved slope; exact variance 1/12', pixelSamples: 4, singularMappingFix: 'Exponent-domain Gaussian PDF times Snell Jacobian; no derivative of inverse Snell slope', radianceConvention: 'Retains v4 slope-averaged radiance; no added eta squared factor or solar gain change', approximations: ['Gaussian unresolved slope distribution', 'Local linear world-space pixel footprint with 2x2 Gauss quadrature', '16-point finite solar-disc quadrature', 'Wide sky/Fresnel uses 16 real-time slope samples', 'No microfacet visibility/masking', 'Flat limit uses derivative-filtered direct solar image'], externalSky: 'PR27 linear noon palette, shared current sun' }, dispose() { g.dispose(); material.dispose(); } };
}
