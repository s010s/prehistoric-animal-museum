import {Sky} from '../vendor/tidewater/src/sky/Sky.js';
import {commonModule} from '../vendor/tidewater/src/engine/render/wgsl/common.js';

const nativeRay = `fn viewRay( uv: vec2f ) -> vec3f {
	let p = frame.invViewProj * ndcFromUv( uv, 0.5 );
	return normalize( p.xyz / p.w - frame.cameraPos );
}`;
const relativeRay = `fn viewRay( uv: vec2f ) -> vec3f {
	let ndc = ndcFromUv( uv, 0.5 ) - vec4f( frame.jitter, 0.0, 0.0 );
	let view = frame.invProj * ndc;
	return normalize( ( frame.invView * vec4f( view.xyz, 0.0 ) ).xyz );
}`;

export class MuseumSky extends Sky {
  get background() {
    if (this._background) return this._background;
    const source = commonModule.code;
    if (!source.includes(nativeRay)) throw Error('Pinned Tidewater sky ray changed');
    // At the meadow the eye is 7.9 km from the origin. Subtracting two world
    // positions only 0.2 m apart quantizes the cloud direction by several pixels.
    // Native shader assembly is synchronous. Scope this substitution to the
    // backdrop that consumes the ray, including its rotation-only velocity.
    try {
      commonModule.code = source.replace(nativeRay, relativeRay);
      return super.background;
    } finally {
      commonModule.code = source;
    }
  }
}
