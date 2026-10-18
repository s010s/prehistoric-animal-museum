import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { RenderTarget } from '../engine/gpu/Texture.js';
import { FullscreenPass } from '../engine/render/FullscreenPass.js';
import { Matrix4, Vector3, Vector4 } from '../engine/math/index.js';
import { localLightsModule } from '../materials/LocalLights.js';

const IOR = 1.333;

// Everything that happens when the camera is (partly) underwater:
//  - the medium at the lens, per pixel. The lens is the near clip plane: the water between the eye
//    and the lens is clipped away and the view starts at the lens, so where the surface crosses the
//    near plane the view splits into an above-water and an underwater part (underwaterMedium)
//  - participating medium: Beer-Lambert absorption + single scattering of depth-attenuated
//    sun and sky light (analytic), with ray-marched caustic light shafts near the camera
//  - the meniscus band along the waterline on the lens: refraction through a rounded water edge,
//    a dark contact line and a bright rim
//
// WGSL (this.module, prefix `underwater`), used by the post chain (PostFX):
//   fn underwaterViewZ( d: f32 ) -> f32            reversed-Z depth -> view Z (negative)
//   fn underwaterViewRay( uv: vec2f ) -> vec3f     view-space ray (z = -1)
//   fn underwaterWorldDir( uv: vec2f ) -> vec3f
//   fn underwaterMedium( uv: vec2f ) -> f32        medium at the near clip plane (1 water, 0 air): the
//                                                  former mediumNode(), rendered into the medium target
//   fn underwaterComposite( uv: vec2f, pixel: vec2f ) -> vec4f
//                                                  the former node(): calls `postSceneSample( uv ) -> vec3f`,
//                                                  which the shader using it defines (the lit scene colour
//                                                  with AO and haze applied); needs mediumBinding()
// Consumed: waterQuery.module `waterQueryCameraState() -> vec4f` (x = water height at the camera) and
// `waterQueryHeightAtXZ( xz: vec2f ) -> f32` (the original query.heightAtNode( xz )); caustics.module
// `causticsSampleLevel( P: vec3f, depth: f32, level: f32 ) -> vec3f` (the original caustics.sample( p, z, 1.5 ));
// the flashlight (materials/LocalLights FLASH) through localLightsModule: uniforms
// `localLights.flash{ On, Pos, Dir, Col, Cone }` and `localLightsSpotProfile( cd, cosInner, cosOuter ) -> f32`.
// m: closer than this to the surface the near plane can cross it (farther, the whole view is in the
// camera's medium)
export const LENS_REACH = 0.35;
const STRADDLE = LENS_REACH;
const BAND = 16; // px: widest meniscus band searched

// the flashlight (materials/LocalLights FLASH) through the localLights uniforms
const flashModule = new ShaderModule( { name: 'underwater-flash', deps: [ localLightsModule ], code: /* wgsl */`
fn uwFlashOn() -> f32 { return localLights.flashOn; }
fn uwFlashPos() -> vec3f { return localLights.flashPos; }
fn uwFlashDir() -> vec3f { return localLights.flashDir; }
fn uwFlashCol() -> vec3f { return localLights.flashCol; }
fn uwFlashCone() -> vec2f { return localLights.flashCone; }
` } );

const f32s = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

export class Underwater {

	constructor( { depthTexture, maskTexture, query, caustics, fft } ) {

		this.depthTexture = depthTexture;
		this.maskTexture = maskTexture;
		this.query = query;
		this.caustics = caustics;
		this.fft = fft;
		this.mediumTexture = null; // render target of the medium pass, set by the post chain

		// explicit scene-camera uniforms (unjittered)
		this.uniforms = new UniformBlock( 'UnderwaterParams', {
			camWorld: [ 'mat4x4f', new Matrix4() ],
			camPos: [ 'vec3f', new Vector3() ],
			lensDistance: [ 'f32', 0.1 ], // = camera.near (the lens is the near clip plane)
			proj: [ 'vec4f', new Vector4( 1, 1, 0.1, 1000 ) ], // p00, p11, near, far
			shafts: [ 'f32', 1.0 ],
			band: [ 'f32', 9 ], // meniscus half-width in pixels (<= BAND)
			enabled: [ 'f32', 1 ],
			torchBeam: [ 'f32', 3 ], // flashlight beam in-scatter strength
			hasShafts: [ 'f32', 0 ], // the half resolution shaft / torch march ran this frame
		}, { label: 'underwater' } );
		const U = this.uniforms.fields;
		this.lensDistance = U.lensDistance;
		this.shafts = U.shafts;
		this.band = U.band;
		this.enabled = U.enabled;
		this.torchBeam = U.torchBeam;
		this.camPos = U.camPos;
		this.camWorld = U.camWorld;
		this.proj = U.proj;
		this._module = null;
		// caustic light shafts + torch beam in-scatter, ray marched at half the internal resolution
		// (rgb: in-scatter, a: the pixel's view distance for the depth-aware upsample in the composite)
		this.shaftTarget = new RenderTarget( 1, 1, { colors: [ 'rgba16float' ], label: 'uwShafts' } );
		this._shaftPass = null;

	}

	// internal (scene) size
	setSize( w, h ) {

		this.shaftTarget.setSize( Math.max( 1, Math.ceil( w / 2 ) ), Math.max( 1, Math.ceil( h / 2 ) ) );

	}

	get shaftPass() {

		if ( ! this._shaftPass ) this._shaftPass = new FullscreenPass( {
			label: 'underwater shafts', colorFormats: [ 'rgba16float' ], modules: [ this.module ], code: this._shaftCode(),
		} );
		return this._shaftPass;

	}

	// record the half resolution march when any pixel can be under water (active), before the composite
	renderShafts( active ) {

		this.uniforms.fields.hasShafts.value = active ? 1 : 0;
		if ( active ) this.shaftPass.render( { colorViews: [ this.shaftTarget.texture ], clear: [ 0, 0, 0, 0 ] } );

	}

	updateCamera( camera ) {

		camera.updateMatrixWorld();
		this.camPos.value.setFromMatrixPosition( camera.matrixWorld );
		this.camWorld.value.copy( camera.matrixWorld );
		const e = camera.projectionMatrix.elements;
		this.proj.value.set( e[ 0 ], e[ 5 ], camera.near, camera.far );
		this.lensDistance.value = camera.near;

	}

	// the shader module (built on first use: the other systems' modules must exist by then)
	get module() {

		if ( this._module ) return this._module;
		this._module = new ShaderModule( {
			name: 'underwater',
			deps: [ commonModule, this.query && this.query.module, this.caustics && this.caustics.module, flashModule ],
			uniforms: this.uniforms,
			uniformName: 'underwaterParams',
			bindings: {
				underwaterDepth: { texture: () => this.depthTexture },
				underwaterMask: { texture: () => this.maskTexture },
			},
			code: this._code(),
		} );
		return this._module;

	}

	// the composite (needs the medium texture: not usable by the medium pass itself)
	get compositeModule() {

		if ( this._compositeModule ) return this._compositeModule;
		this._compositeModule = new ShaderModule( {
			name: 'underwater-composite',
			deps: [ this.module ],
			bindings: { underwaterMediumTex: { texture: () => this.mediumTexture }, underwaterShaftTex: { texture: () => this.shaftTarget.texture } },
			code: this._compositeCode(),
		} );
		return this._compositeModule;

	}

	_code() {

		return /* wgsl */`
const UW_STRADDLE: f32 = ${ f32s( STRADDLE ) };
const UW_BAND: i32 = ${ BAND };
const UW_IOR: f32 = ${ f32s( IOR ) };

// reversed-Z depth -> view Z (negative)
fn underwaterViewZ( d: f32 ) -> f32 {
	let n = underwaterParams.proj.z; let f = underwaterParams.proj.w;
	return n * f / ( ( n - f ) * d - n );
}

// view-space ray for screen uv (unnormalized, z = -1)
fn underwaterViewRay( uv: vec2f ) -> vec3f {
	let ndc = vec2f( uv.x * 2.0 - 1.0, ( 1.0 - uv.y ) * 2.0 - 1.0 );
	return vec3f( ndc.x / underwaterParams.proj.x, ndc.y / underwaterParams.proj.y, -1.0 );
}

fn underwaterWorldDir( uv: vec2f ) -> vec3f {
	return normalize( ( underwaterParams.camWorld * vec4f( underwaterViewRay( uv ), 0.0 ) ).xyz );
}

fn _uwDepthAt( uv: vec2f ) -> f32 {
	let size = vec2f( textureDimensions( underwaterDepth ) );
	return textureLoad( underwaterDepth, vec2i( clamp( uv, vec2f( 0.0 ), vec2f( 0.9999 ) ) * size ), 0 );
}

// Medium at the near clip plane for each pixel (1: water, 0: air).
//  - a water surface in view: the side it is seen from (written by the water material) is the
//    medium between the lens and the surface
//  - no surface in view: the ray never crosses the surface beyond the lens, so it is in the medium
//    of its far end: an object hit below the surface is in water; the sky is air (a downward ray
//    that reaches nothing is in water)
// The waterline on the lens is then exactly where the rendered surface crosses the near plane:
// the surface fragments on one side end right there, and the far ends on the other side agree.
// Farther than STRADDLE from the surface the near plane can't reach it: the camera's medium.
fn underwaterMedium( uv: vec2f ) -> f32 {
	let size = vec2f( textureDimensions( underwaterMask ) );
	let px = vec2i( clamp( uv, vec2f( 0.0 ), vec2f( 0.9999 ) ) * size );
	let m = textureLoad( underwaterMask, px, 0 );
	let camH = underwaterParams.camPos.y - waterQueryCameraState().x;
	var water = select( 0.0, 1.0, camH < 0.0 );
	if ( m.y > 0.5 ) {
		water = m.x;
	} else if ( abs( camH ) < UW_STRADDLE ) {
		let d = _uwDepthAt( uv );
		let ray = underwaterViewRay( uv );
		let dirW = ( underwaterParams.camWorld * vec4f( ray, 0.0 ) ).xyz;
		if ( d < 1e-7 ) {
			water = select( 0.0, 1.0, dirW.y < 0.0 );
		} else {
			let q = underwaterParams.camPos + dirW * ( - underwaterViewZ( d ) );
			water = select( 0.0, 1.0, q.y < waterQueryHeightAtXZ( q.xz ) );
		}
	}
	return water;
}

`;

	}


	// caustic light shafts + torch beam in-scatter along the view ray, at half the internal resolution
	// (pixel: this pass's fragment coordinate; the noise is resolved by the TAAU)
	_shaftCode() {

		const shafts = this.caustics && this.caustics.module ? /* wgsl */`
		{
			let steps = 20;
			let maxD = min( dist, 22.0 );
			let ds = maxD / f32( steps );
			// interleaved gradient noise on the pixel grid, moved every frame (Jimenez 2014) so the
			// temporal resolve integrates the steps instead of freezing a noise pattern on screen
			let fragPx = pixel + f32( frame.frameIndex % 64u ) * 5.588238;
			let jitter = _uwIgn( fragPx );
			// gusts / slicks vary over hundreds of metres: one sample for the whole march
			let detK = causticsDetailK( underwaterParams.camPos.xz + dir.xz * ( maxD * 0.5 ) );
			for ( var i = 0; i < steps; i++ ) {
				let s = ( f32( i ) + jitter ) * ds;
				let p = underwaterParams.camPos + dir * s;
				let z = max( st.x - p.y, 0.01 );
				let caus = causticsSampleShaft( p, z, 1.5, detK );
				let Tl = exp( - sigT * ( s + z / mu ) );
				shafts += ( caus - 1.0 ) * Tl * ds;
			}
			shafts = shafts * sunE * sigS * phase * underwaterParams.shafts * 2.5;
		}` : '';

		return /* wgsl */`
fn _uwIgn( px: vec2f ) -> f32 { return fract( fract( dot( px, vec2f( 0.06711056, 0.00583715 ) ) ) * 52.9829189 ); }

fn fragment( in: FSIn ) -> vec4f {
	let uv = in.uv;
	let pixel = in.pos.xy;
	let d = _uwDepthAt( uv );
	let vz = underwaterViewZ( d );
	let ray = underwaterViewRay( uv );
	let dist = max( min( length( ray * ( - vz ) ), 600.0 ) - underwaterParams.lensDistance * length( ray ), 0.0 );
	let dir = underwaterWorldDir( uv );
	let st = waterQueryCameraState();
	let sigS = frame.waterScattering;
	let sigT = frame.waterAbsorption + sigS;

	let Ls = - refract( - frame.sunDir, vec3f( 0.0, 1.0, 0.0 ), 1.0 / UW_IOR ); // toward the sun, underwater
	let mu = max( Ls.y, 0.15 );
	let cosPh = dot( dir, Ls );
	let g = 0.85;
	let phase = ( 1.0 - g * g ) / ( 4.0 * PI ) / pow( max( 1.0 + g * g - cosPh * 2.0 * g, 1e-4 ), 1.5 ) * 0.75 + 0.25 / ( 4.0 * PI );

	let sunE = frame.sunColor * 0.96;

	var shafts = vec3f( 0.0 );
${ shafts }
	// diver's torch: single scattering of the flashlight cone along the view ray (the torch sits
	// beside the eye, so the beam is a shaft slightly off the view axis), extinction on the light
	// and the view legs, same phase function, up to the scene depth
	var torch = vec3f( 0.0 );
	if ( uwFlashOn() > 0.5 ) {
		let tSteps = 8;
		let tMax = min( dist, 25.0 );
		let tds = tMax / f32( tSteps );
		let tPx = pixel + f32( frame.frameIndex % 64u ) * 5.588238 + 17.3;
		let tJit = _uwIgn( tPx );
		let fpos = uwFlashPos(); let fdir = uwFlashDir(); let cone = uwFlashCone();
		for ( var i = 0; i < tSteps; i++ ) {
			let s = ( f32( i ) + tJit ) * tds;
			let v = underwaterParams.camPos + dir * s - fpos;
			let r2 = max( dot( v, v ), 1e-4 );
			let r = sqrt( r2 );
			let Lr = v / r;
			let spot = localLightsSpotProfile( dot( Lr, fdir ), cone.x, cone.y );
			// same lobe as the sun in-scatter (0.75 forward g = 0.85 + 0.25 isotropic), Schlick's form
			let sk = 1.55 * g - 0.55 * g * g * g;
			let sd = 1.0 - dot( dir, - Lr ) * sk;
			let ph = ( 1.0 - sk * sk ) / ( 4.0 * PI ) * 0.75 / ( sd * sd ) + 0.25 / ( 4.0 * PI );
			torch += exp( - sigT * ( r + s ) ) * ( spot * ph / ( r2 + 0.15 ) );
		}
		// x3: the suspended particles scatter more than the clear-water coefficient (the beam reads)
		torch = torch * uwFlashCol() * sigS * tds * underwaterParams.torchBeam;
	}

	return vec4f( max( shafts, vec3f( 0.0 ) ) + torch, dist );
}
`;

	}

	_compositeCode() {

		return /* wgsl */`
fn _uwMed( pc: vec2i, dy: i32, mSize: vec2i ) -> f32 {
	return textureLoad( underwaterMediumTex, vec2i( pc.x, clamp( pc.y + dy, 0, mSize.y - 1 ) ), 0 ).r;
}

fn _uwLit( m: f32, sigT: vec3f, zc: f32, dirY: f32, dist: f32 ) -> vec3f {
	let a = sigT * zc / m;
	let kk = sigT * ( 1.0 - dirY / m );
	let e0 = exp( - a );
	let e1 = exp( - max( a + kk * dist, vec3f( 0.0 ) ) );
	return select( ( e0 - e1 ) / kk, e0 * dist, abs( kk ) < vec3f( 1e-4 ) );
}

// pixel: fragment coordinate of the composite (screenCoordinate)
fn underwaterComposite( uv: vec2f, pixel: vec2f ) -> vec4f {
	let mSize = vec2i( textureDimensions( underwaterMediumTex ) );
	let pc = clamp( vec2i( uv * vec2f( mSize ) ), vec2i( 0 ), mSize - 1 );
	let here = _uwMed( pc, 0, mSize );
	let under = here > 0.5;

	// distance to the waterline on the lens in pixels, searched vertically (the line runs roughly
	// across the screen: no camera roll, and over the few cm of the lens the surface is a plane)
	var lineDist = 1e4;
	var lineDir = 0.0; // uv.y direction toward the other medium
	let camH = underwaterParams.camPos.y - waterQueryCameraState().x;
	if ( abs( camH ) < UW_STRADDLE ) {
		let flips = abs( _uwMed( pc, -8, mSize ) - here ) + abs( _uwMed( pc, 8, mSize ) - here ) + abs( _uwMed( pc, -UW_BAND, mSize ) - here ) + abs( _uwMed( pc, UW_BAND, mSize ) - here );
		if ( flips > 0.5 ) {
			for ( var i = 1; i < UW_BAND + 1; i++ ) {
				let up = abs( _uwMed( pc, -i, mSize ) - here ) > 0.5;
				let down = abs( _uwMed( pc, i, mSize ) - here ) > 0.5;
				if ( lineDist > 1e3 && ( up || down ) ) {
					lineDist = f32( i ) - 0.5;
					lineDir = select( 1.0, -1.0, up );
				}
			}
		}
	}

	// ---- meniscus band: rounded water edge acting like a cylindrical lens; samples are pushed
	// away from the line on both sides
	let bandW = underwaterParams.band;
	let tBand = clamp( lineDist / bandW, 0.0, 1.0 );
	let bendPx = tBand * sqrt( max( 1.0 - tBand * tBand, 0.0 ) ) * bandW * 0.8;
	let uvB = uv - vec2f( 0.0, lineDir * bendPx / f32( mSize.y ) );
	let base = postSceneSample( uvB );

	var result = base;

	if ( under && underwaterParams.enabled > 0.5 ) {
		// scene distance along this pixel
		let d = _uwDepthAt( uv );
		let vz = underwaterViewZ( d );
		let ray = underwaterViewRay( uv );
		// the water between the eye and the lens is clipped away: the medium starts at the lens
		let dist = max( min( length( ray * ( - vz ) ), 600.0 ) - underwaterParams.lensDistance * length( ray ), 0.0 );
		let dir = underwaterWorldDir( uv );

		let st = waterQueryCameraState();
		let zc = max( st.x - underwaterParams.camPos.y, 0.0 ); // camera depth below the surface
		let sigA = frame.waterAbsorption;
		let sigS = frame.waterScattering;
		let sigT = sigA + sigS;

		let Ls = - refract( - frame.sunDir, vec3f( 0.0, 1.0, 0.0 ), 1.0 / UW_IOR ); // toward the sun, underwater
		let mu = max( Ls.y, 0.15 );
		let cosPh = dot( dir, Ls );
		let g = 0.85;
		let phase = ( 1.0 - g * g ) / ( 4.0 * PI ) / pow( max( 1.0 + g * g - cosPh * 2.0 * g, 1e-4 ), 1.5 ) * 0.75 + 0.25 / ( 4.0 * PI );

		// light arriving at depth z: E0 exp(-sigT z / m); along the ray z(s) = zc - dir.y s, seen through
		// exp(-sigT s). The in-scatter integral is (exp(-a) - exp(-(a + k d))) / k with a = sigT zc / m
		// and k = sigT (1 - dir.y / m): both exponents stay <= 0 while the ray is in the water, so it
		// can't overflow looking up through deep water (exp(-a) (1 - exp(-k d)) / k does, and the
		// Inf / NaN would stick in the TAA history)
		let sunE = frame.sunColor * 0.96;
		let ambE = frame.skyIrradiance * PI * 0.9;

		let bb = sigS * 0.035;
		let msAlb = bb * 1.3 / ( sigA + bb );
		let inSun = sunE * ( sigS * phase + msAlb * sigT * ( 1.0 / PI ) ) * _uwLit( mu, sigT, zc, dir.y, dist );
		let inAmb = ambE * ( sigS * ( 1.0 / ( 4.0 * PI ) ) + msAlb * sigT * ( 1.0 / PI ) ) * _uwLit( 0.8, sigT, zc, dir.y, dist );

		// caustic light shafts and the torch beam: the half resolution march (underwaterShafts), depth-aware
		// upsampled (bilinear weights times the view distance similarity)
		var extra = vec3f( 0.0 );
		if ( underwaterParams.hasShafts > 0.5 ) {
			let ls = vec2i( textureDimensions( underwaterShaftTex ) );
			let pa = uv * vec2f( ls ) - 0.5;
			let q0 = floor( pa );
			let fr = pa - q0;
			var acc = vec3f( 0.0 );
			var wSum = 1e-6;
			for ( var k = 0; k < 4; k++ ) {
				let o = vec2i( k & 1, k >> 1u );
				let sm = textureLoad( underwaterShaftTex, clamp( vec2i( q0 ) + o, vec2i( 0 ), ls - 1 ), 0 );
				let wb = select( 1.0 - fr.x, fr.x, o.x == 1 ) * select( 1.0 - fr.y, fr.y, o.y == 1 );
				let rel = abs( sm.w - dist ) / max( dist, 0.5 );
				let wt = wb / pow2( rel * 10.0 + 1.0 ) + 1e-5;
				acc += sm.rgb * wt;
				wSum += wt;
			}
			extra = acc / wSum;
		}

		let T = exp( - sigT * dist );
		result = base * T + inSun + inAmb + extra;
	}

	// meniscus contact line and bright rim
	let line = smoothstep( 2.0, 0.0, lineDist );
	let rim = smoothstep( bandW, bandW * 0.4, lineDist ) * smoothstep( 0.5, 2.5, lineDist );
	let withLine = result * ( 1.0 - line * 0.55 ) + rim * 0.15 * ( frame.skyIrradiance * 2.5 + frame.sunColor * 0.02 );
	return vec4f( withLine, 1.0 );
}
`;

	}

}
