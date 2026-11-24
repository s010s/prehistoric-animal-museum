import { shadowModule, ShadowUniforms } from '../vendor/tidewater/src/engine/render/wgsl/lighting.js';
import { orthoStandardZ } from '../vendor/tidewater/src/engine/render/Shadows.js';
import { Matrix4, Vector3, Vector4 } from '../vendor/tidewater/src/engine/index.js';

const _corners = Array.from({ length: 8 }, () => new Vector3());
const _center = new Vector3();
const _up = new Vector3(0, 1, 0);
const _inv = new Matrix4();
const _tmp = new Vector3();
const _tmp4 = new Vector4();
const _zero = new Vector3();
const _eye = new Vector3();

let installed = false;
export function installCreekShadowFilter() {
  if (installed) return;
  installed = true;
  const change = (from, to, expected = 1) => {
    const parts = shadowModule.code.split(from);
    if (parts.length !== expected + 1) throw Error('Pinned creek shadow filter seam changed: ' + from.slice(0, 48));
    shadowModule.code = parts.join(to);
  };
  // Select shadow cascades by 3D Euclidean distance to the camera rather than
  // view-Z projection so pitching or turning in place never slides cascade
  // seams, filter quality, or normal bias across stationary terrain.
  change(
    'let dist = dot( P - frame.cameraPos, - vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] ) );',
    'let dist = length( P - frame.cameraPos );',
    2,
  );
  // The half-resolution refraction source has no temporal resolve of its own.
  // Binary, per-pixel rotated PCSS taps survive as a visible stipple after the
  // water refracts that image. Integrate depth comparisons spatially here;
  // keep the physical blocker-derived penumbra and the original dry-land path.
  change('let Pb = P + N * info.z;', `let shadowNdL=max(dot(N,frame.sunDir),0.0);
 let shadowMaxBoost=select(select(2.1,2.5,c==1),1.8,c==0);
 let shadowSlopeBoost=mix(shadowMaxBoost,1.0,smoothstep(0.06,0.52,shadowNdL));
 let Pb=P+N*(info.z*shadowSlopeBoost);`);
  change('let phi = noise * TWO_PI;', `let phi = pcfNoise * TWO_PI;
#if CREEK_REFRACTION
 let filterPhi=0.731;
#else
 let filterPhi=phi;
#endif`);
  change('vogelDiskSample( i, SHADOW_SEARCH_TAPS, phi ) * searchUV', 'vogelDiskSample( i, SHADOW_SEARCH_TAPS, filterPhi ) * searchUV');
  change(`// 3. PCF over the penumbra
\t\tvar sum = 0.0;
\t\tfor ( var i = 0; i < SHADOW_FILTER_TAPS; i++ ) {
\t\t\tlet d = _shadowDepth( uvz.xy + vogelDiskSample( i, SHADOW_FILTER_TAPS, phi + 1.7 ) * penumbraUV, c );
\t\t\tsum += select( 0.0, 1.0, z <= d );
\t\t}
\t\treturn sum / f32( SHADOW_FILTER_TAPS );`, `// 3. PCF over the penumbra (hardware bilinear shadow compare for smooth, temporally stable edges)
#if CREEK_REFRACTION
 var integrated=0.0;
 for(var j=0;j<32;j++){
  integrated+=_shadowTap(uvz.xy+vogelDiskSample(j,32,filterPhi+1.7)*penumbraUV,c,z);
 }
 return integrated/32.0;
#else
 var sum=0.0;
 for(var i=0;i<SHADOW_FILTER_TAPS;i++){
  sum+=_shadowTap(uvz.xy+vogelDiskSample(i,SHADOW_FILTER_TAPS,filterPhi+1.7)*penumbraUV,c,z);
 }
 return sum/f32(SHADOW_FILTER_TAPS);
#endif`);
  change(`let phiP = pcfNoise * TWO_PI;
\tvar sum = 0.0;
\tfor ( var i = 0; i < 5; i++ ) {
\t\tsum += _shadowTap( uvz.xy + vogelDiskSample( i, 5, phiP ) * texel, c, z );
\t}
\treturn sum / 5.0;`, `let phiP = pcfNoise * TWO_PI;
#if CREEK_REFRACTION
 var integrated=0.0;
 for(var j=0;j<16;j++){
  integrated+=_shadowTap(uvz.xy+vogelDiskSample(j,16,.731)*texel,c,z);
 }
 return integrated/16.0;
#else
 var sum=0.0;
 for(var i=0;i<7;i++){
  sum+=_shadowTap(uvz.xy+vogelDiskSample(i,7,phiP)*(texel*1.30),c,z);
 }
 return sum/7.0;
#endif`);
}

// Match SunShadows._fit to Euclidean cascade selection: every receiver using
// cascade i satisfies length(P - cameraPos) <= far, so a sphere centered at
// cameraPos of radius ceil(far * 16) / 16 strictly encloses all receivers at
// every FOV and aspect ratio while remaining 100% invariant to camera rotation
// (eliminating shadow texel swimming and static shadow cache invalidation when
// turning or pitching the view). Keep vendor Shadows.js untouched.
export function stabilizeSunShadows(shadows) {
  shadows._fit = function fitEuclideanCascade(i, camera, sunDir) {
    const c = this.cascades[i];
    const x = i === 0 ? 0 : this.splits[i - 1];
    const y = this.splits[i];
    const mN = this._margin(x);
    const mF = this._margin(y);
    const far = i === this.count - 1 ? y : y + mF * 0.5;
    ShadowUniforms.fields.blend.value[i] = new Vector4(x, y, mN, mF);

    const e = camera.matrixWorld.elements;
    _center.set(e[12], e[13], e[14]);
    const r = Math.ceil(far * 16) / 16;
    c.radius = r;

    const cam = c.camera;
    const L = sunDir;
    const up = Math.abs(L.y) > 0.99 ? _tmp.set(1, 0, 0) : _up;
    cam.matrixWorld.lookAt(L, _zero, up);
    _inv.copy(cam.matrixWorld).invert();
    const texel = 2 * r / this.size;
    const ls = _tmp4.set(_center.x, _center.y, _center.z, 1).applyMatrix4(_inv);
    ls.x = Math.round(ls.x / texel) * texel;
    ls.y = Math.round(ls.y / texel) * texel;
    const back = r + this.lightMargin;
    _eye.set(ls.x, ls.y, ls.z + back).applyMatrix4(cam.matrixWorld);
    cam.matrixWorld.setPosition(_eye);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const n = 0.1;
    const f = back + r;
    cam.near = n;
    cam.far = f;
    orthoStandardZ(cam.projectionMatrix, -r, r, r, -r, n, f);
    c.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const U = ShadowUniforms.fields;
    U.matrices.value[i] = c.viewProj.clone();
    U.cascades.value[i] = new Vector4(far, texel, this.normalBias[i] ?? 0.05, f - n);
  };
  for (const cascade of shadows.cascades) cascade.dirty = true;
  return shadows;
}
