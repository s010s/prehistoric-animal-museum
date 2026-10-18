import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { GPU } from '../engine/gpu/GPU.js';
import { FrameUniforms, G } from '../engine/render/Frame.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Vector2, Vector3, MathUtils } from '../engine/math/index.js';

// Volumetric trade-wind cumulus (Schneider/Nubis density model, Hillaire multiple-scattering
// approximation) under a thin cirrus veil.
//   - view: ray marched in screen space, one pixel of every 4x4 block per frame (two while the camera
//     turns), accumulated at 0.6x the render resolution with reprojection (camera motion and wind drift)
//     and upsampled bicubically, like sky-pro-webgpu's High quality (about 1/44 of the display pixels
//     marched per frame). Empty space is skipped with a coverage dependent 3D distance field, so rays
//     only take small (24 m) steps near clouds.
//   - panorama: a cheaper low resolution version of the whole sky dome for water reflections,
//     the environment cube and Snell's window, refreshed progressively (1/32 per frame).
//   - shadow: transmittance of the cloud layer along the sun around the camera (1/4 per frame).
// Detail (after the user's sky-pro-webgpu renderer): a 3 octave worley erosion volume filtered by the pixel
// footprint (plus a finer fetch at close range), erosion growing with height in the cloud (flat bases,
// cauliflower tops, wispy undersides) and a short detailed light tap that shades the billows. Lighting also
// follows sky-pro: three scattering orders from one exponential with a droplet phase, skylight occlusion
// from two upward probes, darker bases.
// Everything outputs vec4( in-scattered radiance, transmittance ): sky * a + rgb composites it.
//
// WGSL module (`clouds.module`, prefix `clouds`):
//   uniform var cloudsParams: CloudsParams
//   fn cloudsSample( dir: vec3f ) -> vec4f       panorama (reflections, environment, Snell's window)
//   fn cloudsSampleView( dir: vec3f ) -> vec4f   full resolution view clouds (main background), panorama outside
//   fn cloudsShadow( xz: vec2f ) -> f32          cloud shadow transmittance at a world position (1 = clear)
// `clouds.shadowModule`: cloudsShadow alone (one texture: for lighting hooks / materials that only need it)
// Port notes: three updated the uniforms before each compute call, so the several traces of one frame
// (camera cut rebuild, turning camera) saw their own slot / previous camera. A WebGPU buffer holds one
// value per submit, so each trace of a frame has its own `CloudsTrace` block and kernel set.

const PI = Math.PI;
const EARTH_R = 6360000;
const TILE = 32768; // m, period of the whole cloud field (every noise tiles within it)
const WEATHER_RES = 512;
const SDF_RES = 256, SDF_H = 16; // distance field cells (horizontal over the tile, vertical over the layer)
const SDF_R = 24; // cells searched horizontally
const SHAPE_RES = 128, SHAPE_SIZE = 2048;
const SHEAR = 0.12; // horizontal lean of the clouds per metre of height (downwind)
const EDGE = 15; // density ramp of the raw shape value (softness of the cloud surface: crisp, the detail erosion shapes it)
const ISLAND_NEAR = 2500, ISLAND_FAR = 9000; // m: big clusters only a little away from the island
// broad, rounded billows: the coarsest erosion lumps are ~190 m (the fine octaves are kept light,
// they only read as grain on the lit surfaces)
const DETAIL_RES = 64, DETAIL_SIZE = 1000;
// detail erosion (after sky-pro-webgpu / Nubis): three worley fbm octaves per fetch (r: 4 - 16, g: 8 - 32,
// b: 16 - 64 cells per period). An octave fades to the mean once its features shrink under ~2 px (a mip
// filter without mips); `crease` is 0 on a lump, 1 between lumps
const D_MEAN = 0.48;
const D_S1 = DETAIL_SIZE / 4, D_NEAR = 3.7, D_S2 = D_S1 / D_NEAR; // m: coarsest features of the two fetches
const PANO_W = 1024, PANO_H = 320;
// cirrus veil: coverage varying over hundreds of km, fibres (flow line streaks, mipmapped)
const SYN_RES = 256, SYN_SIZE = 409600; // m
const FIB_RES = 1024, FIB_TILE = 40000; // m
const SHADOW_RES = 256;
const AP_DIST = 30000; // m, aerial perspective scale toward the horizon
const MS_GAIN = 2.6; // energy of the diffusion (multiply scattered) sunlight term

// 4x4 ordered-dither sequence: one pixel of every block per frame
const ORDER = [ 0, 10, 2, 8, 5, 15, 7, 13, 1, 11, 3, 9, 4, 14, 6, 12 ];
const REBUILD_SLOTS = 4; // slots traced per frame right after a camera cut (sharp again after 16 / 4 frames)
// history resolution relative to the (dynamic) render resolution: like sky-pro-webgpu's High quality (0.5),
// the clouds are reconstructed at reduced width and height and one pixel of every 4x4 block is marched per
// frame; the saved rays buy finer steps and fuller lighting
const HISTORY_SCALE = 0.75;

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

// ------------------------------------------------------------ WGSL: noise generation helpers

const NOISE_WGSL = /* wgsl */`
fn clMod( x: f32, y: f32 ) -> f32 { return x - y * floor( x / y ); }
fn clMod2( x: vec2f, y: vec2f ) -> vec2f { return x - y * floor( x / y ); }
fn clMod3( x: vec3f, y: f32 ) -> vec3f { return x - y * floor( x / y ); }
fn clHash3( p: vec3f ) -> f32 { return fract( sin( dot( p, vec3f( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
fn clHash2( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }

// tileable 3D worley (F1) with cells cells per unit
fn clWorley3( p: vec3f, cells: f32 ) -> f32 {
	let q = p * cells;
	let ip = floor( q );
	let fp = fract( q );
	var d = 1e3;
	for ( var z = -1; z <= 1; z++ ) { for ( var y = -1; y <= 1; y++ ) { for ( var x = -1; x <= 1; x++ ) {
		let o = vec3f( f32( x ), f32( y ), f32( z ) );
		let cell = clMod3( ip + o, cells );
		let h = vec3f( clHash3( cell ), clHash3( cell + 19.7 ), clHash3( cell + 41.3 ) );
		d = min( d, length( o + h - fp ) );
	} } }
	return d;
}

// tileable 3D gradient (perlin) noise, about -1..1
fn clGrad3( i: vec3f, f: vec3f, o: vec3f, cells: f32 ) -> f32 {
	let c = clMod3( i + o, cells );
	let gv = vec3f( clHash3( c ), clHash3( c + 13.1 ), clHash3( c + 27.7 ) ) * 2.0 - 1.0;
	return dot( gv, f - o );
}
fn clGnoise( p: vec3f, cells: f32 ) -> f32 {
	let q = p * cells;
	let i = floor( q );
	let f = fract( q );
	let u = f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 ); // (sic: the original's fade, f^2 not f^3)
	let x00 = mix( clGrad3( i, f, vec3f( 0.0, 0.0, 0.0 ), cells ), clGrad3( i, f, vec3f( 1.0, 0.0, 0.0 ), cells ), u.x );
	let x10 = mix( clGrad3( i, f, vec3f( 0.0, 1.0, 0.0 ), cells ), clGrad3( i, f, vec3f( 1.0, 1.0, 0.0 ), cells ), u.x );
	let x01 = mix( clGrad3( i, f, vec3f( 0.0, 0.0, 1.0 ), cells ), clGrad3( i, f, vec3f( 1.0, 0.0, 1.0 ), cells ), u.x );
	let x11 = mix( clGrad3( i, f, vec3f( 0.0, 1.0, 1.0 ), cells ), clGrad3( i, f, vec3f( 1.0, 1.0, 1.0 ), cells ), u.x );
	return mix( mix( x00, x10, u.y ), mix( x01, x11, u.y ), u.z );
}

// billows: inverted worley fbm (1 at the feature points)
fn clBillows( p: vec3f, c: f32 ) -> f32 { return 1.0 - ( clWorley3( p, c ) * 0.625 + clWorley3( p, c * 2.0 ) * 0.25 + clWorley3( p, c * 4.0 ) * 0.125 ); }
fn clPerlinFbm( p: vec3f, c: f32 ) -> f32 { return clGnoise( p, c ) * 0.5 + clGnoise( p, c * 2.0 ) * 0.25 + clGnoise( p, c * 4.0 ) * 0.125; }

fn clVh( i: vec2f, o: vec2f, cells: vec2f ) -> f32 { return clHash2( clMod2( i + o, cells ) ); }
fn clVnoise2( p: vec2f, cells: vec2f ) -> f32 {
	let q = p * cells;
	let i = floor( q );
	let f = fract( q );
	let u = f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 ); // (sic: the original's fade, f^2 not f^3)
	return mix( mix( clVh( i, vec2f( 0.0, 0.0 ), cells ), clVh( i, vec2f( 1.0, 0.0 ), cells ), u.x ),
		mix( clVh( i, vec2f( 0.0, 1.0 ), cells ), clVh( i, vec2f( 1.0, 1.0 ), cells ), u.x ), u.y );
}

fn clGh( i: vec2f, f: vec2f, o: vec2f, cells: vec2f ) -> f32 {
	let c = clMod2( i + o, cells );
	let a = clHash2( c ) * ${ f( 2 * PI ) };
	return dot( vec2f( cos( a ), sin( a ) ), f - o );
}
fn clGnoise2( p: vec2f, cells: vec2f ) -> f32 {
	let q = p * cells;
	let i = floor( q );
	let f = fract( q );
	let u = f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 ); // (sic: the original's fade, f^2 not f^3)
	return mix( mix( clGh( i, f, vec2f( 0.0, 0.0 ), cells ), clGh( i, f, vec2f( 1.0, 0.0 ), cells ), u.x ),
		mix( clGh( i, f, vec2f( 0.0, 1.0 ), cells ), clGh( i, f, vec2f( 1.0, 1.0 ), cells ), u.x ), u.y );
}
// gradient noise fbm remapped to about 0..1 (smoother than value noise, no grid artefacts)
fn clGfbm( p: vec2f, cells: vec2f, seed: f32 ) -> f32 {
	return ( clGnoise2( p + seed, cells ) * 0.55 + clGnoise2( p + seed * 1.7, cells * 2.0 ) * 0.3 + clGnoise2( p + seed * 2.3, cells * 4.0 ) * 0.15 ) * 1.6 + 0.5;
}
`;

// ------------------------------------------------------------ WGSL: shared cloud helpers (constants + small functions)

function helpersWGSL( rot ) {

	const c = Math.cos( rot ), s = Math.sin( rot );
	const ha = rot + 0.6;
	return /* wgsl */`
const CL_EARTH_R: f32 = ${ f( EARTH_R ) };
const CL_TILE: f32 = ${ f( TILE ) };
const CL_D_MEAN: f32 = ${ f( D_MEAN ) };
const CL_EDGE: f32 = ${ f( EDGE ) };
const CL_AP_DIST: f32 = ${ f( AP_DIST ) };
const CL_MS: f32 = ${ f( MS_GAIN ) };
// weather map lookups are rotated so cloud streets line up with the (initial) wind
const CL_C: f32 = ${ f( c ) };
const CL_S: f32 = ${ f( s ) };
// frame of the upper wind (veered from the trades)
const CL_HC: f32 = ${ f( Math.cos( ha ) ) };
const CL_HS: f32 = ${ f( Math.sin( ha ) ) };

// top of a cloud column (fraction of the layer) from the cell profile (0..1), the cell's top and
// the turret noise: broad rounded domes, uneven
fn clSmallTop( cs: f32, top: f32, lump: f32 ) -> f32 { return top * pow( cs, 0.42 ) * ( lump * 0.8 + 0.65 ); }
fn clBigTop( cb: f32, lump: f32 ) -> f32 { return pow( cb, 0.6 ) * ( lump * 0.35 + 0.7 ); }
fn clCreaseOf( x: f32 ) -> f32 { return smoothstep( 0.42, 0.64, x ); }
// erosion grows with the height in the cloud: flat, dense bases, billowy tops; the undersides use the
// inverted field (wisps instead of lumps)
fn clErosionAmount( b: vec4f ) -> f32 { return mix( 0.25, 1.0, smoothstep( 0.05, 0.6, b.y ) ); }
fn clErosionField( F: f32, b: vec4f ) -> f32 { return mix( 1.0 - F, F, smoothstep( 0.0, 0.08, b.y ) ); }
// erosion only eats the outer shell of the base shape (Nubis remap): the dense core keeps no holes
fn clEroded( b: vec4f, crease: f32 ) -> f32 { return sat( ( b.x - crease * clErosionAmount( b ) * sat( 1.0 - b.x * 0.9 ) - 0.012 ) * CL_EDGE ); }
// density with every detail octave at its mean (reflections, shadows, deep light samples): the same
// cloud as the detailed one, seen through a coarse filter
fn clMeanCrease( b: vec4f ) -> f32 { return clCreaseOf( clErosionField( CL_D_MEAN, b ) ); }
fn clMeanDensity( b: vec4f ) -> f32 { return clEroded( b, clMeanCrease( b ) ); }
// layer a (in-scattered radiance, transmittance) in front of layer b
fn clOver( a: vec4f, b: vec4f ) -> vec4f { return vec4f( a.rgb + b.rgb * a.a, a.a * b.a ); }
// Henyey-Greenstein phase
fn clPhaseHG( c: f32, g: f32 ) -> f32 { return ( ( 1.0 - g * g ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g * g - c * 2.0 * g, 1e-4 ), 1.5 ); }

// distance along rd from a point at height camY (on the planet axis) to the sphere at altitude H
// (camera below it). Stable form: |oc|^2 - R^2 = (camY - H)(2Re + camY + H)
fn cloudsShell( camY: f32, rd: vec3f, H: f32 ) -> f32 {
	let b = rd.y * ( camY + CL_EARTH_R );
	let cc = ( camY - H ) * ( camY + H + 2.0 * CL_EARTH_R );
	let disc = b * b - cc;
	return - b + sqrt( max( disc, 0.0 ) );
}

// camera frame projection: direction -> uv (y down) of a camera given by its basis and frustum tangents
fn cloudsProject( d: vec3f, right: vec3f, up: vec3f, fwd: vec3f, tanv: vec2f ) -> vec2f {
	let z = max( dot( d, fwd ), 1e-4 );
	let ndc = vec2f( dot( d, right ), dot( d, up ) ) / ( tanv * z );
	return vec2f( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
}
`;

}

// bicubic Catmull-Rom in 5 bilinear taps (corners dropped), for texture `tex` (sampled with smpLinearClamp)
function catmullRomWGSL( name, tex ) {

	return /* wgsl */`
fn ${ name }( uv: vec2f, size: vec2f ) -> vec4f {
	let sp = uv * size;
	let tp1 = floor( sp - 0.5 ) + 0.5;
	let f = sp - tp1;
	let w0 = f * ( f * ( f * -0.5 + 1.0 ) - 0.5 );
	let w1 = f * f * ( f * 1.5 - 2.5 ) + 1.0;
	let w2 = f * ( f * ( f * -1.5 + 2.0 ) + 0.5 );
	let w3 = f * f * ( f * 0.5 - 0.5 );
	let w12 = w1 + w2;
	let tc0 = ( tp1 - 1.0 ) / size;
	let tc3 = ( tp1 + 2.0 ) / size;
	let tc12 = ( tp1 + w2 / w12 ) / size;
	let a = w12.x * w0.y; let b = w0.x * w12.y; let cc = w12.x * w12.y; let d = w3.x * w12.y; let e = w12.x * w3.y;
	let sum = textureSampleLevel( ${ tex }, smpLinearClamp, vec2f( tc12.x, tc0.y ), 0.0 ) * a
		+ textureSampleLevel( ${ tex }, smpLinearClamp, vec2f( tc0.x, tc12.y ), 0.0 ) * b
		+ textureSampleLevel( ${ tex }, smpLinearClamp, vec2f( tc12.x, tc12.y ), 0.0 ) * cc
		+ textureSampleLevel( ${ tex }, smpLinearClamp, vec2f( tc3.x, tc12.y ), 0.0 ) * d
		+ textureSampleLevel( ${ tex }, smpLinearClamp, vec2f( tc12.x, tc3.y ), 0.0 ) * e;
	return sum / ( a + b + cc + d + e );
}
`;

}

export class Clouds {

	constructor( renderer, atmosphere ) {

		this.renderer = renderer;
		this.atmosphere = atmosphere;

		const wind0 = new Vector2().copy( G.windDir.value ).normalize().multiplyScalar( 12 );
		this.params = new UniformBlock( 'CloudsParams', {
			coverage: [ 'f32', 0.45 ],
			densityScale: [ 'f32', 0.07 ], // extinction (1/m) of the densest cloud
			bottom: [ 'f32', 750 ],
			top: [ 'f32', 2400 ],
			// m/s; clouds drift along it (by default with the surface wind, as trade winds do)
			wind: [ 'vec2f', wind0 ],
			offset: [ 'vec2f', new Vector2() ], // accumulated wind offset (m)
			shadowCenter: [ 'vec2f', new Vector2() ],
			shadowSize: [ 'f32', 8000 ],
			shadowStrength: [ 'f32', 0.85 ],
			// cirrus veil: amount 0..1 (0.5: faint, opacity mostly 0.05 - 0.2) and altitude (m)
			cirrus: [ 'f32', 0.5 ],
			cirrusAlt: [ 'f32', 9000 ],
			// per frame state (camera relative: the camera sits on the planet axis)
			camY: [ 'f32', 1 ],
			horizonY: [ 'f32', - 0.001 ], // rays below hit the planet
			nOrigin: [ 'vec2f', new Vector2() ], // noise space origin
			wOrigin: [ 'vec2f', new Vector2() ], // weather space origin
			camXZ: [ 'vec2f', new Vector2() ],
			hOffset: [ 'vec2f', new Vector2() ], // cirrus drift (faster upper wind)
			windN: [ 'vec2f', new Vector2( 1, 0 ) ], // wind direction (shear lean)
			viewSize: [ 'vec2f', new Vector2( 4, 4 ) ],
			traceSize: [ 'vec2f', new Vector2( 1, 1 ) ],
			displayH: [ 'f32', 4 ], // render height (px): filters the noise
			viewValid: [ 'f32', 0 ],
			sdfCoverage: [ 'f32', 0 ],
			shadowPhase: [ 'f32', 0 ],
			panoSlot: [ 'vec2f', new Vector2() ],
			// camera basis (unit vectors) and frustum tangents
			camRight: [ 'vec3f', new Vector3( 1, 0, 0 ) ],
			camUp: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			camFwd: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
			camTan: [ 'vec2f', new Vector2( 1, 1 ) ],
			// camera the view texture was last traced with
			viewRight: [ 'vec3f', new Vector3( 1, 0, 0 ) ],
			viewUp: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			viewFwd: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
			viewTan: [ 'vec2f', new Vector2( 1, 1 ) ],
		}, { label: 'clouds' } );
		const U = this.params.fields;
		// three-style handles (same names as the TSL version)
		this.coverage = U.coverage;
		this.densityScale = U.densityScale;
		this.bottom = U.bottom;
		this.top = U.top;
		this.wind = U.wind;
		this.offset = U.offset;
		this.shadowCenter = U.shadowCenter;
		this.shadowSize = U.shadowSize;
		this.shadowStrength = U.shadowStrength;
		this.cirrus = U.cirrus;
		this.cirrusAlt = U.cirrusAlt;
		this.camY = U.camY;
		this.nOrigin = U.nOrigin;
		this.wOrigin = U.wOrigin;
		this.camXZ = U.camXZ;
		this.hOffset = U.hOffset;
		this.horizonY = U.horizonY;
		this.windN = U.windN;
		this.viewSize = U.viewSize;
		this.displayH = U.displayH;
		this.traceSize = U.traceSize;
		this.viewValid = U.viewValid;
		this.sdfCoverage = U.sdfCoverage;
		this.shadowPhase = U.shadowPhase;
		this.panoSlot = U.panoSlot;
		this.cam = { right: U.camRight, up: U.camUp, fwd: U.camFwd, tan: U.camTan };
		this.viewCam = { right: U.viewRight, up: U.viewUp, fwd: U.viewFwd, tan: U.viewTan };
		// previous frame's camera (CPU side; each trace gets a copy in its own block)
		this.prev = { right: { value: new Vector3( 1, 0, 0 ) }, up: { value: new Vector3( 0, 1, 0 ) }, fwd: { value: new Vector3( 0, 0, - 1 ) }, tan: { value: new Vector2( 1, 1 ) } };
		this.camDelta = { value: new Vector3() }; // camera motion minus wind drift
		this.camDeltaHi = { value: new Vector3() }; // same for the high layers
		this.historyValid = { value: 0 };
		// weight of a new sample for static pixels: a running average right after a cut, then an
		// exponential one over about 16 samples
		this.minAlpha = { value: 0.12 };
		this.rebuildK = { value: - 1 }; // >= 0: rebuilding after a camera cut (slots traced so far)
		this.slot = { value: new Vector2() };
		this.subPixel = { value: new Vector2() }; // ray offset in the traced pixel
		this.frameNoise = { value: 0 };

		// weather map lookups are rotated so cloud streets line up with the (initial) wind
		const w = this.wind.value;
		this._rot = Math.atan2( w.y, w.x );
		this._offsetW = new Vector2();
		this._offsetH = new Vector2();

		this._makeNoise();
		this._makeTargets();
		this._buildModules();
		this._buildKernels();
		this._generateNoise();

		this.frame = 0;
		this.panoWarm = 1;
		// resolution of the view clouds relative to the drawing buffer (e.g. follow a dynamic
		// resolution scale); the sky is reconstructed per pixel from direction, so any size works
		this.resolutionScale = 1;
		// output (drawing buffer) size override; default: renderer.getDrawingBufferSize, the canvas or frame.outputResolution
		this.outputSize = null;
		this._prevCam = new Vector3();
		this._prevSun = new Vector3();
		this._hasPrev = false;
		this._rebuild = 0; // slots traced since the last camera cut (16: done)
		this._since = 0; // frames since the rebuild completed
		this._traces = 0;
		this._pp = 0; // history ping-pong
		this._traceIndex = 0; // traces recorded this frame (each needs its own uniform block)

	}

	// ------------------------------------------------------------ noise volumes

	_makeNoise() {

		const make3D = ( size, name ) => new Texture( { label: name, width: size, height: size, depth: size, dimension: '3d', format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		this.shapeTex = make3D( SHAPE_RES, 'cloudShape' );
		this.detailTex = make3D( DETAIL_RES, 'cloudDetail' );
		// r = small cell profile, g = its top (fraction of the layer), b = turrets, a = big cell profile
		this.weatherTex = new Texture( { label: 'cloudWeather', width: WEATHER_RES, height: WEATHER_RES, format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		// r = cirrus coverage (hundreds of km), g = broad streets along the upper wind, b = patches (5 - 50 km)
		this.synTex = new Texture( { label: 'cloudSynoptic', width: SYN_RES, height: SYN_RES, format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		// cirrus: r = fibres, g = veil noise (mipmapped: the fibres are filtered by the pixel footprint)
		this.fibTex = new Texture( { label: 'cloudFibres', width: FIB_RES, height: FIB_RES, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'storage', 'render' ] } );
		// fibre seeds and flow direction (r = seeds, g = flow angle)
		this.auxTex = new Texture( { label: 'cloudFibreFlow', width: FIB_RES, height: FIB_RES, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );

	}

	_generateNoise() {

		const k = this._noiseKernels;
		k.syn.dispatch( [ SYN_RES / 8, SYN_RES / 8, 1 ] );
		k.aux.dispatch( [ FIB_RES / 8, FIB_RES / 8, 1 ] );
		k.fib.dispatch( [ FIB_RES / 8, FIB_RES / 8, 1 ] );
		generateMipmaps( this.fibTex );
		k.shape.dispatch( [ SHAPE_RES / 4, SHAPE_RES / 4, SHAPE_RES / 4 ] );
		k.detail.dispatch( [ DETAIL_RES / 4, DETAIL_RES / 4, DETAIL_RES / 4 ] );
		k.weather.dispatch( [ WEATHER_RES / 8, WEATHER_RES / 8, 1 ] );

	}

	_makeTargets() {

		const make = ( w, h, name ) => new Texture( { label: name, width: w, height: h, format: 'rgba16float', usage: [ 'sample', 'storage', 'copySrc' ] } );
		this.panorama = make( PANO_W, PANO_H, 'cloudPanorama' );
		// read with textureLoad (manual bilinear): materials need no sampler for it
		this.shadowMap = make( SHADOW_RES, SHADOW_RES, 'cloudShadow' );
		// 3D distance field (in cells) to anything that may hold cloud; ping-pong for the passes
		const make3 = ( name ) => new Texture( { label: name, width: SDF_RES, height: SDF_RES, depth: SDF_H, dimension: '3d', format: 'rgba8unorm', usage: [ 'sample', 'storage' ] } );
		this.sdfA = make3( 'cloudSdfA' );
		this.sdfB = make3( 'cloudSdfB' );
		this.sdfTex = make3( 'cloudSdf' );

		// screen space view buffers (resized with the canvas)
		this.traceTex = make( 1, 1, 'cloudTrace' );
		this.traceDepth = make( 1, 1, 'cloudTraceDepth' );
		this.highTrace = make( 1, 1, 'cloudHighTrace' );
		this.motionTex = make( 1, 1, 'cloudMotion' );
		// range of this frame's samples around each block (neighborhood clamp of the history)
		this.boxMin = make( 1, 1, 'cloudBoxMin' );
		this.boxMax = make( 1, 1, 'cloudBoxMax' );
		this.history = [ make( 4, 4, 'cloudViewA' ), make( 4, 4, 'cloudViewB' ) ];
		this.viewTex = this.history[ 0 ];
		this._w = 0;
		this._h = 0;

	}

	// ------------------------------------------------------------ WGSL modules

	_buildModules() {

		const atmo = this.atmosphere;
		const helpers = new ShaderModule( { name: 'cloudsHelpers', deps: [ commonModule ], code: helpersWGSL( this._rot ) } );
		this.helpersModule = helpers;

		// density, lighting and the marches (kernels only)
		this.coreModule = new ShaderModule( {
			name: 'cloudsCore',
			deps: [ commonModule, atmo.module, helpers ],
			uniforms: this.params,
			uniformName: 'cloudsParams',
			bindings: {
				cloudsWeatherTex: { texture: this.weatherTex },
				cloudsShapeTex: { texture: this.shapeTex },
				cloudsDetailTex: { texture: this.detailTex },
				cloudsSdfTex: { texture: this.sdfTex },
				cloudsSynTex: { texture: this.synTex },
				cloudsFibTex: { texture: this.fibTex },
			},
			code: /* wgsl */`
// weather space (rotated so cloud streets follow the wind) uv of a camera relative position
fn cloudsWeatherUV( pxz: vec2f ) -> vec2f {
	return ( vec2f( pxz.x * CL_C + pxz.y * CL_S, pxz.y * CL_C - pxz.x * CL_S ) + cloudsParams.wOrigin ) / CL_TILE;
}

// x: cell profile (after the coverage control), y: top of this column (fraction of the layer).
// pxz: camera relative; big cells and towers are only allowed far from the island (origin)
fn cloudsWeather( pxz: vec2f ) -> vec2f {
	let w = textureSampleLevel( cloudsWeatherTex, smpLinearRepeat, cloudsWeatherUV( pxz ), 0.0 );
	let thr = 1.0 - cloudsParams.coverage * 1.3;
	let far = smoothstep( ${ f( ISLAND_NEAR ) }, ${ f( ISLAND_FAR ) }, length( pxz + cloudsParams.camXZ ) );
	// cells too weak to hold more than a scrap of cloud are dropped (no scattered specks)
	let cs = sat( ( ( w.x - thr ) / max( 1.0 - thr, 0.05 ) - 0.08 ) * 1.09 );
	let cb = sat( ( ( w.w * far - thr ) / max( 1.0 - thr, 0.05 ) - 0.08 ) * 1.09 );
	return vec2f( max( cs, cb ), max( clSmallTop( cs, w.y, w.z ), clBigTop( cb, w.z ) ) );
}

// distance (m) that is certainly free of cloud around p (0 near clouds). Nearest lookup of the distance
// field: x / y repeat (the field tiles), z clamped to the layer
fn cloudsSkip( p: vec3f ) -> f32 {
	let alt = p.y + ( p.x * p.x + p.z * p.z ) / ${ f( 2 * EARTH_R ) };
	let H = cloudsParams.top - cloudsParams.bottom;
	let uvw = vec3f( fract( cloudsWeatherUV( p.xz ) ), sat( ( alt - cloudsParams.bottom ) / H ) );
	let ix = vec3i( min( vec3f( floor( uvw * vec3f( ${ f( SDF_RES ) }, ${ f( SDF_RES ) }, ${ f( SDF_H ) } ) ) ), vec3f( ${ f( SDF_RES - 1 ) }, ${ f( SDF_RES - 1 ) }, ${ f( SDF_H - 1 ) } ) ) );
	let d = textureLoad( cloudsSdfTex, ix, 0 ).x * 255.0;
	return max( d - 1.0, 0.0 ) * min( H / ${ f( SDF_H ) }, ${ f( TILE / SDF_RES ) } );
}

// base shape. p: camera relative (sheared) position, w: weather
// returns vec4( raw shape value, height inside the cloud 0..1, swirl xy ); density = ramp( x )
fn cloudsBase( p: vec3f, w: vec2f ) -> vec4f {
	let alt = p.y + ( p.x * p.x + p.z * p.z ) / ${ f( 2 * EARTH_R ) };
	let hL = ( alt - cloudsParams.bottom ) / ( cloudsParams.top - cloudsParams.bottom );
	let np = p.xz + cloudsParams.nOrigin;
	let n = textureSampleLevel( cloudsShapeTex, smpLinearRepeat, vec3f( np.x, alt * 1.4, np.y ) / ${ f( SHAPE_SIZE ) }, 0.0 );
	// flat, slightly uneven base, the column's (domed) top, edges from the cell profile (steep,
	// so the shape noise can't break fragments off the rim)
	let hb = n.y * 0.025;
	// columns whose top stays very low hold no cloud: the saddles between overlapping weak cells
	// along a street made long, thin, flat ribbons, and the thin rims of each dome made it a flat
	// pancake. Without them the cells stay separate and their sides rise steeply.
	let Ce = sat( ( w.y - hL ) * 3.5 ) * smoothstep( 0.0, 0.45, w.x ) * smoothstep( hb, hb + 0.012, hL ) * smoothstep( 0.1, 0.2, w.y );
	// the shape noise carves the boundary. x is the raw shape value (density before the ramp,
	// negative outside): the detail erodes it in the same units, and the coarse search uses it
	// to slow down near a cloud
	return vec4f( n.x + Ce - 1.0, sat( hL / max( w.y, 0.05 ) ), n.y, n.z );
}

// three detail octaves per fetch; s: size (m) of the coarsest features
fn cloudsOctaves( uvw: vec3f, s: f32, foot: f32 ) -> f32 {
	let d = textureSampleLevel( cloudsDetailTex, smpLinearRepeat, uvw, 0.0 ).xyz;
	let w = vec3f( smoothstep( s * 0.24, s * 0.09, foot ), smoothstep( s * 0.12, s * 0.045, foot ), smoothstep( s * 0.06, s * 0.0225, foot ) );
	return dot( mix( vec3f( CL_D_MEAN ), d, w ), vec3f( 0.56, 0.32, 0.12 ) );
}

// full density with detail erosion. b: result of cloudsBase, foot: pixel footprint (m) that filters the
// octaves. Returns vec2( density, lump ) (1 on a lump, 0 in a crease: shades the crevices)
fn cloudsErode( p: vec3f, b: vec4f, foot: f32 ) -> vec2f {
	let alt = p.y + ( p.x * p.x + p.z * p.z ) / ${ f( 2 * EARTH_R ) };
	let np = p.xz + cloudsParams.nOrigin;
	// low frequency swirl of the detail lookup
	let sw = ( b.zw - 0.5 ) * ( 0.3 * ( 1.0 - b.y * 0.6 ) );
	let dp = vec3f( np.x, alt, np.y ) / ${ f( DETAIL_SIZE ) } + vec3f( sw.x, 0.0, sw.y ) + vec3f( frame.time * 0.0015, 0.0, 0.0 );
	var f1 = CL_D_MEAN;
	var f2 = CL_D_MEAN;
	if ( foot < ${ f( D_S1 * 0.24 ) } ) {
		f1 = cloudsOctaves( dp, ${ f( D_S1 ) }, foot );
		// close range: a finer fetch (lumps down to ~3 m) keeps near clouds crisp
		if ( foot < ${ f( D_S2 * 0.24 ) } ) {
			f2 = cloudsOctaves( dp * ${ f( D_NEAR ) } + 0.37, ${ f( D_S2 ) }, foot );
		}
	}
	let crease = clCreaseOf( clErosionField( f1 * 0.78 + f2 * 0.22, b ) );
	// the creases are eaten: round lumps (cauliflower) on the upper parts, wisps underneath
	return vec2f( clEroded( b, crease ), 1.0 - crease );
}

// the cloud field leans downwind with height (wind shear)
fn cloudsSheared( p: vec3f ) -> vec3f {
	let lean = max( p.y - cloudsParams.bottom, 0.0 ) * ${ f( SHEAR ) };
	return vec3f( p.x - cloudsParams.windN.x * lean, p.y, p.z - cloudsParams.windN.y * lean );
}

// Key light of the clouds: the sun while it is the app's key light (seen from cloud altitude,
// so it keeps lighting the clouds a little after it has set at sea level), else the moon.
// E: illuminance before the earth shadow.
struct CloudsLight { dir: vec3f, E: vec3f, isMoon: bool };
fn cloudsKeyLight( altKm: f32 ) -> CloudsLight {
	var l: CloudsLight;
	l.isMoon = dot( frame.sunDir, atmosphereParams.sunDir ) < 0.9999;
	let sunE = atmosphereSampleTransmittance( 6360.0 + altKm, frame.sunDir.y ) * atmosphereParams.sunIlluminance;
	l.dir = frame.sunDir;
	l.E = select( sunE, frame.sunColor, l.isMoon );
	return l;
}

// earth shadow on a point at altitude alt (m) and horizontal offset pxz (m) from the camera: the
// light is below its horizon once mu < -sqrt( 2 alt / R ) (the local vertical tilts with distance)
fn cloudsEarthShadow( light: CloudsLight, alt: f32, pxz: vec2f ) -> f32 {
	let mu = light.dir.y + dot( light.dir.xz, pxz ) / CL_EARTH_R;
	let lit = smoothstep( -0.006, 0.006, mu + sqrt( max( alt, 0.0 ) * ${ f( 2 / EARTH_R ) } ) );
	return select( lit, 1.0, light.isMoon );
}

// cubic B-spline filtered texture lookup in 4 bilinear taps (GPU Gems 2, ch. 20): magnified cirrus fibres
// stay smooth instead of showing the bilinear texel grid (res: texels at mip 0)
fn cloudsBspline( uv: vec2f, lod: f32 ) -> vec4f {
	let size = ${ f( FIB_RES ) } / exp2( lod );
	let st = uv * size - 0.5;
	let i = floor( st );
	let fr = st - i;
	let f2 = fr * fr; let f3 = f2 * fr;
	let w0 = ( - f3 + f2 * 3.0 - fr * 3.0 + 1.0 ) / 6.0;
	let w1 = ( f3 * 3.0 - f2 * 6.0 + 4.0 ) / 6.0;
	let w3 = f3 / 6.0;
	let w2 = 1.0 - w0 - w1 - w3;
	let g0 = w0 + w1; let g1 = w2 + w3;
	let p0 = ( i - 0.5 + w1 / g0 ) / size; let p1 = ( i + 1.5 + w3 / g1 ) / size;
	return textureSampleLevel( cloudsFibTex, smpLinearRepeat, vec2f( p0.x, p0.y ), lod ) * ( g0.x * g0.y )
		+ textureSampleLevel( cloudsFibTex, smpLinearRepeat, vec2f( p1.x, p0.y ), lod ) * ( g1.x * g0.y )
		+ textureSampleLevel( cloudsFibTex, smpLinearRepeat, vec2f( p0.x, p1.y ), lod ) * ( g0.x * g1.y )
		+ textureSampleLevel( cloudsFibTex, smpLinearRepeat, vec2f( p1.x, p1.y ), lod ) * ( g1.x * g1.y );
}

fn cloudsToWind( v: vec2f ) -> vec2f { return vec2f( v.x * CL_HC + v.y * CL_HS, v.y * CL_HC - v.x * CL_HS ); }

// anisotropic filtering: n taps along the long axis of the footprint at the mip of its short axis
fn cloudsFibres( q: vec2f, fA: vec2f, fB: vec2f, tile: f32, rot: f32 ) -> vec4f {
	let cr = cos( rot ); let sr = sin( rot );
	let wq = cloudsToWind( q ); let wa = cloudsToWind( fA ); let wb = cloudsToWind( fB );
	let uv = vec2f( wq.x * cr + wq.y * sr, wq.y * cr - wq.x * sr ) / tile;
	let a = vec2f( wa.x * cr + wa.y * sr, wa.y * cr - wa.x * sr ) / tile;
	let b = vec2f( wb.x * cr + wb.y * sr, wb.y * cr - wb.x * sr ) / tile;
	let la = length( a ) * ${ f( FIB_RES ) }; let lb = length( b ) * ${ f( FIB_RES ) };
	let major = select( b, a, la > lb );
	const n = 3;
	let lod = max( log2( max( min( la, lb ), max( la, lb ) / f32( n ) ) ), 0.0 );
	var sum = vec4f( 0.0 );
	for ( var i = 0; i < n; i++ ) {
		sum += cloudsBspline( uv + major * ( ( f32( i ) + 0.5 ) / f32( n ) - 0.5 ), lod );
	}
	return sum / f32( n );
}

// Cirrus veil seen along rd: vec4( radiance, transmittance ). A thin sheet on a curved-earth
// shell, so its fibres converge toward the horizon in true perspective. Its coverage varies
// only over hundreds of km (clearer and thicker parts of the sky, no outlines); long, gently
// curved fibres follow the upper wind and give a low contrast texture. The fibre texture is
// filtered anisotropically with the footprint of one pixel (pxAngle, radians), which turns
// distant fibres into a smooth veil. Lighting: single scattering by ice crystals (strong
// forward peak: bright near the sun, a faint 22 degree halo) plus multiple scattering and sky
// light; lit by the sun from below its horizon for a while after sunset.
fn cloudsHigh( rd: vec3f, pxAngle: f32 ) -> vec4f {
	let H = cloudsParams.cirrusAlt;
	let light = cloudsKeyLight( 9.0 );
	let sunDir = light.dir;
	let cosT = dot( rd, sunDir );

	// geometry: hit point, local incidence, pixel footprint on the sheet (across the view and
	// along it, stretched by 1 / mu)
	let t = cloudsShell( cloudsParams.camY, rd, H );
	let pxz = rd.xz * t;
	let up = normalize( vec3f( pxz.x / CL_EARTH_R, 1.0, pxz.y / CL_EARTH_R ) );
	let mu = max( dot( rd, up ), 0.02 );
	let radial = normalize( rd.xz + vec2f( 1e-6, 0.0 ) );
	let fA = vec2f( - radial.y, radial.x ) * ( t * pxAngle );
	let fB = radial * ( t * pxAngle / mu );
	let q = pxz + cloudsParams.camXZ - cloudsParams.hOffset;

	// coverage: patches of 5 - 50 km with clear gaps, modulated over hundreds of km, broad bands
	let syn = textureSampleLevel( cloudsSynTex, smpLinearRepeat, cloudsToWind( q ) * ${ f( 1 / SYN_SIZE ) }, 0.0 );
	let cov = smoothstep( 0.15, 0.85, syn.x ) * smoothstep( 0.4, 0.72, syn.z ) * ( syn.y * 0.4 + 0.6 );
	// fibres at two scales (hides the tiling of the texture)
	let f1 = cloudsFibres( q, fA, fB, ${ f( FIB_TILE ) }, 0.0 );
	let f2 = cloudsFibres( q, fA, fB, ${ f( FIB_TILE * 2.3 ) }, 0.5 );
	let fib = f1.x * 0.6 + f2.x * 0.4;
	let veil = f1.y * 0.5 + f2.y * 0.5;
	// vertical optical depth: faint wisps (opacity mostly 0.05 - 0.2 at the default amount) over
	// a thinner veil
	let amount = cloudsParams.cirrus * ( cloudsParams.coverage * 0.5 + 0.78 );
	let tau = amount * 0.4 * cov * ( fib * 0.75 + 0.25 ) * ( veil * 0.4 + 0.8 );
	// slant path, bounded so the veil doesn't turn into a white band at the horizon
	let alpha = 1.0 - exp( - tau / max( mu, 0.25 ) );

	// lighting: the key light at the sheet (sunset colours depend on the altitude)
	let muS = dot( sunDir, up );
	let E = select( atmosphereSampleTransmittance( 6360.0 + H / 1000.0, muS ) * atmosphereParams.sunIlluminance, light.E, light.isMoon )
		* cloudsEarthShadow( light, H, pxz );
	// ice: strong forward peak, a faint 22 degree halo, some backscatter; thin: mostly single
	// scattering, a little multiply scattered light
	let hd = ( acos( clamp( cosT, -1.0, 1.0 ) ) - 0.384 ) / 0.02;
	let halo = exp( - hd * hd ) * 0.04;
	let phase = clPhaseHG( cosT, 0.85 ) * 0.4 + clPhaseHG( cosT, 0.3 ) * 0.35 + clPhaseHG( cosT, -0.15 ) * 0.25 + halo;
	let Ts = exp( tau * -0.5 / max( muS, 0.1 ) );
	let L = ( E * ( phase * Ts + ( 1.0 - Ts ) * 0.06 ) + frame.skyIrradiance * 0.9 ) * alpha;
	// aerial perspective: haze in front of the sheet shows sky light where the sheet hides it
	let tr = exp( t * ${ f( - 0.25 / AP_DIST ) } );
	let skyL = atmosphereSkyLuminance( rd );
	return vec4f( L * tr + skyL * alpha * ( 1.0 - tr ), 1.0 - alpha );
}

// Samples lie on a lattice along the ray, shared by all rays and jittered per frame: steps of
// ds in distance bands ( [0, 5), [5, 10), [10, 20), [20, 40), 40+ km, ds doubling), fine points
// every ds, coarse points every coarse fine points. Jumps over empty space snap onto it, so
// neighbouring pixels always sample the clouds at consistent positions (arbitrary landing
// points after a jump would average into contour lines)
const CL_B0: f32 = 2500.0;
fn cloudsBand( t: f32 ) -> f32 { return clamp( floor( log2( max( t, CL_B0 ) / CL_B0 ) ), 0.0, 4.0 ); }
fn cloudsBandStart( b: f32 ) -> f32 { return select( exp2( b ) * CL_B0, 0.0, b == 0.0 ); }
fn cloudsPosMod( x: f32, c: f32 ) -> f32 { return x - floor( x / c ) * c; }

struct CloudsMarch { L: vec3f, T: f32, depth: f32 };
${ marchWGSL( 'View', { maxSteps: 200, maxDist: 50000, ds0: 24, dsMax: 120, coarse: 4, lightSteps: [ 12, 50, 140, 350, 900, 1800 ], lightDetail: 3, detail: true, ambient: 1.2, pxAngle: 'cloudsParams.camTan.y * 2.0 / cloudsParams.displayH' } ) }
${ marchWGSL( 'Pano', { maxSteps: 56, maxDist: 50000, ds0: 60, dsMax: 320, coarse: 2, lightSteps: [ 120, 500 ], lightDetail: 0, detail: false, ambient: 1.2, pxAngle: f( 2 * PI / PANO_W ) } ) }
`,
		} );

		// cloud shadow only (one texture, no sampler): for the lighting hooks of every lit material
		this.shadowModule = new ShaderModule( {
			name: 'cloudsShadow',
			deps: [ commonModule ],
			uniforms: this.params,
			uniformName: 'cloudsParams',
			bindings: { cloudsShadowMap: { texture: this.shadowMap } },
			code: /* wgsl */`
// cloud shadow transmittance (1 = clear) at a world position. Manual bilinear filtering of an
// unfilterable texture: costs no sampler in the (sampler hungry) scene materials.
fn cloudsShadowTap( i: vec2i ) -> f32 { return textureLoad( cloudsShadowMap, clamp( i, vec2i( 0 ), vec2i( ${ SHADOW_RES - 1 } ) ), 0 ).x; }
fn cloudsShadow( worldXZ: vec2f ) -> f32 {
	let uv = ( worldXZ - cloudsParams.shadowCenter ) / cloudsParams.shadowSize + 0.5;
	let st = uv * ${ f( SHADOW_RES ) } - 0.5;
	let i0 = vec2i( floor( st ) );
	let fr = fract( st );
	let s = mix( mix( cloudsShadowTap( i0 ), cloudsShadowTap( i0 + vec2i( 1, 0 ) ), fr.x ), mix( cloudsShadowTap( i0 + vec2i( 0, 1 ) ), cloudsShadowTap( i0 + vec2i( 1, 1 ) ), fr.x ), fr.y );
	// no data outside the map: fade to unshadowed at its border
	let e = abs( uv - 0.5 );
	let inside = smoothstep( 0.5, 0.42, max( e.x, e.y ) );
	return mix( 1.0, s, cloudsParams.shadowStrength * inside );
}
`,
		} );

		// public sampling module (sky, environment, water, materials)
		this.module = new ShaderModule( {
			name: 'clouds',
			deps: [ commonModule, helpers, this.shadowModule ],
			uniforms: this.params,
			uniformName: 'cloudsParams',
			bindings: {
				cloudsPanorama: { texture: this.panorama },
				cloudsView: { texture: () => this.viewTex },
			},
			code: /* wgsl */`
${ catmullRomWGSL( 'cloudsViewCatmullRom', 'cloudsView' ) }

// vec4(rgb in-scattered radiance, a transmittance) for a view direction (panorama)
fn cloudsSample( dir: vec3f ) -> vec4f {
	let az = atan2( dir.z, dir.x );
	let u = fract( az / ${ f( 2 * PI ) } );
	let elev = - acos( clamp( dir.y, -1.0, 1.0 ) ) + ${ f( PI / 2 ) };
	let t = clamp( ( elev + ${ f( ( 4 / 180 ) * PI ) } ) / ${ f( ( 94 / 180 ) * PI ) }, 0.0, 1.0 );
	let v = sqrt( t );
	let s = textureSampleLevel( cloudsPanorama, smpLinearRepeat, vec2f( u, v ), 0.0 );
	// below the panorama range: no clouds
	let below = smoothstep( -0.07, -0.03, dir.y );
	return vec4f( s.rgb * below, mix( 1.0, s.a, below ) );
}

// Full resolution clouds for the main background. The view texture is looked up with the camera
// it was traced with (it can lag behind: underwater frames skip the tracing); directions outside
// it, or a texture without data yet (startup, resize), fall back to the panorama, so the sky can
// never show empty texels
// Transmittance for the sun's disc behind the clouds. The cloud march stops once less than 0.3 % of
// the light gets through and reports that remainder, which (noisy from frame to frame) let a
// clamped sun disc of 2500x the sky shine and sparkle through thick cloud: below ~0.4 % it is dark.
fn cloudsSunTransmittance( T: f32 ) -> f32 { return T * smoothstep( 0.004, 0.04, T ); }

fn cloudsSampleView( dir: vec3f ) -> vec4f {
	let uv = cloudsProject( dir, cloudsParams.viewRight, cloudsParams.viewUp, cloudsParams.viewFwd, cloudsParams.viewTan );
	let inside = cloudsParams.viewValid > 0.5 && dot( dir, cloudsParams.viewFwd ) > 0.01 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
	if ( inside ) {
		// bicubic (Catmull-Rom) upsampling of the half resolution history keeps the edges crisp
		let v = max( cloudsViewCatmullRom( uv, cloudsParams.viewSize ), vec4f( 0.0 ) );
		let above = smoothstep( -0.05, -0.03, dir.y );
		return vec4f( v.rgb * above, mix( 1.0, min( v.a, 1.0 ), above ) );
	}
	return cloudsSample( dir );
}

`,
		} );

	}

	// ------------------------------------------------------------ kernels

	_buildKernels() {

		const noise = new ShaderModule( { name: 'cloudsNoise', deps: [ commonModule ], code: NOISE_WGSL } );
		const helpers = this.helpersModule;
		const K = ( label, modules, bindings, code, wg = [ 8, 8, 1 ] ) => new ComputeKernel( { label, modules, bindings, code, workgroupSize: wg } );
		const MAIN = '@compute @workgroup_size( WG_X, WG_Y, WG_Z ) fn main( @builtin( global_invocation_id ) gid: vec3u )';

		this._noiseKernels = {
			// shape: r = billowy base shape (worley fbm dilated by perlin), gb = low frequency swirl for
			// the detail lookups
			shape: K( 'Cloud Shape Noise', [ noise ], { outTex: { storageTexture: this.shapeTex } }, /* wgsl */`${ MAIN } {
	let p = ( vec3f( gid ) + 0.5 ) / ${ f( SHAPE_RES ) };
	let b = clBillows( p, 4.0 );
	let pn = clPerlinFbm( p, 4.0 ) * 0.9 + 0.5;
	// perlin-worley: remap( perlin, 0, 1, worley, 1 ) keeps the billows, breaks their regularity
	let pw = b + sat( pn ) * ( 1.0 - b ) * 0.5;
	let base = sat( ( pw - 0.42 ) / 0.5 );
	let cx = clGnoise( p + 0.31, 4.0 ) * 0.7 + 0.5;
	let cz = clGnoise( p + 0.67, 4.0 ) * 0.7 + 0.5;
	textureStore( outTex, gid, vec4f( base, sat( cx ), sat( cz ), 1.0 ) );
}`, [ 4, 4, 4 ] ),

			// detail: worley fbm distance (0 at the centre of a lump, high in the creases between lumps) at
			// three frequencies (sky-pro-webgpu's base noise profile: cells 4 / 8 / 16 per period, octaves x2, x4)
			detail: K( 'Cloud Detail Noise', [ noise ], { outTex: { storageTexture: this.detailTex } }, /* wgsl */`
fn fbmW( p: vec3f, c: f32 ) -> f32 { return clWorley3( p, c ) * 0.625 + clWorley3( p, c * 2.0 ) * 0.25 + clWorley3( p, c * 4.0 ) * 0.125; }
${ MAIN } {
	let p = ( vec3f( gid ) + 0.5 ) / ${ f( DETAIL_RES ) };
	textureStore( outTex, gid, vec4f( sat( fbmW( p, 4.0 ) ), sat( fbmW( p, 8.0 ) ), sat( fbmW( p, 16.0 ) ), 1.0 ) );
}`, [ 4, 4, 4 ] ),

			// ---- weather: r = small cell profile, g = its top (fraction of the layer), b = turrets,
			// a = big cell profile
			weather: K( 'Cloud Weather', [ noise ], { outTex: { storageTexture: this.weatherTex } }, /* wgsl */`
// cells of varying size: max over cells of a blob that fades out at its random radius,
// cells switch on where the mesoscale field allows. returns vec2( blob, its size )
fn blobs( p: vec2f, cells: vec2f, meso: f32, seed: f32 ) -> vec2f {
	let q = p * cells;
	let ip = floor( q );
	let fp = fract( q );
	var b = vec2f( 0.0 );
	for ( var y = -1; y <= 1; y++ ) { for ( var x = -1; x <= 1; x++ ) {
		let o = vec2f( f32( x ), f32( y ) );
		let cell = clMod2( ip + o, cells ) + seed;
		let hx = clHash2( cell ); let hy = clHash2( cell + 19.7 ); let hr = clHash2( cell + 41.3 ); let hp = clHash2( cell + 7.1 );
		let d = length( o + vec2f( hx, hy ) * 0.6 + 0.2 - fp );
		// radii 0.34 - 0.74 cells (was up to 0.9): neighbours in a row no longer fuse into one long ridge,
		// which from underneath read as a stretched, smeared tube
		let rad = hr * hr * 0.4 + 0.34;
		let on = smoothstep( hp - 0.15, hp + 0.15, meso + 0.12 );
		let v = sat( 1.0 - d / rad ) * on;
		if ( v > b.x ) { b = vec2f( v, hr ); }
	} }
	return b;
}
${ MAIN } {
	let p = ( vec2f( gid.xy ) + 0.5 ) / ${ f( WEATHER_RES ) };
	let meso = clVnoise2( p, vec2f( 4.0 ) ) * 0.6 + clVnoise2( p, vec2f( 8.0 ) ) * 0.3 + clVnoise2( p, vec2f( 16.0 ) ) * 0.1;
	// low frequency warp: irregular footprints, wavy streets
	let pw = p + ( vec2f( clVnoise2( p, vec2f( 24.0 ) ), clVnoise2( p + 0.37, vec2f( 24.0 ) ) ) - 0.5 ) * 0.03;
	// cloud streets along the wind (x), about 3 km apart
	let street = sin( pw.y * ${ f( 2 * PI * 11 ) } + clVnoise2( p, vec2f( 3.0 ) ) * 6.0 ) * 0.5 + 0.5;
	// fair weather cumulus: cells of 0.5 - 2 km, mostly along the streets
	// (loosely: a street seen end-on from under it lines its cells up into one long tube)
	let small = blobs( pw, vec2f( 15.0, 19.0 ), meso * 0.7 + street * 0.22 - 0.16, 0.0 );
	// big cells and towers (used far from the island only)
	let big = blobs( pw, vec2f( 6.0, 8.0 ), meso - 0.1, 3.7 );
	// turrets: several bumps per cell
	let lump = clVnoise2( pw, vec2f( 80.0 ) ) * 0.65 + clVnoise2( pw + 0.5, vec2f( 160.0 ) ) * 0.35;
	// top of the small cells (fraction of the layer): bigger cells grow taller
	let top = ( small.y * 0.35 + 0.4 ) * ( clVnoise2( p, vec2f( 12.0 ) ) * 0.5 + 0.75 );
	textureStore( outTex, gid.xy, vec4f( small.x, sat( top ), lump, big.x ) );
}` ),

			// ---- cirrus coverage: smooth fields of hundreds of km (u = x along the upper wind)
			syn: K( 'Cloud Synoptic Fields', [ noise ], { outTex: { storageTexture: this.synTex } }, /* wgsl */`${ MAIN } {
	let p = ( vec2f( gid.xy ) + 0.5 ) / ${ f( SYN_RES ) };
	let cov = clGfbm( p, vec2f( 2.0, 3.0 ), 0.31 );
	let streets = clGfbm( p, vec2f( 4.0, 14.0 ), 0.59 );
	let patches = clGfbm( p, vec2f( 10.0, 14.0 ), 0.83 ) * 0.7 + clGfbm( p, vec2f( 28.0, 40.0 ), 0.21 ) * 0.3;
	textureStore( outTex, gid.xy, clamp( vec4f( cov, streets, patches, 1.0 ), vec4f( 0.0 ), vec4f( 1.0 ) ) );
}` ),

			// ---- cirrus fibres: sparse seeds integrated along a smooth, gently meandering flow (line
			// integral convolution): long filaments of varied width, brightness and length
			aux: K( 'Cloud Fibre Flow', [ noise ], { outTex: { storageTexture: this.auxTex } }, /* wgsl */`
fn psi( q: vec2f ) -> f32 { return clGnoise2( q, vec2f( 3.0 ) ) * 0.5 + clGnoise2( q + 0.37, vec2f( 7.0 ) ) * 0.25 + clGnoise2( q + 0.71, vec2f( 15.0 ) ) * 0.1; }
// sparse jittered points: n cells per texture, probability, radius (cells), seed
fn points( p: vec2f, cluster: f32, n: f32, prob: f32, sigma: f32, seed: f32 ) -> f32 {
	let q = p * n;
	let ip = floor( q );
	let fp = fract( q );
	var v = 0.0;
	for ( var y = -1; y <= 1; y++ ) { for ( var x = -1; x <= 1; x++ ) {
		let o = vec2f( f32( x ), f32( y ) );
		let c = clMod2( ip + o, vec2f( n ) ) + seed;
		let pos = o + vec2f( clHash2( c ), clHash2( c + 19.7 ) ) * 0.8 + 0.1;
		let on = select( 0.0, 1.0, clHash2( c + 41.3 ) < cluster * prob );
		let d = pos - fp;
		v = max( v, exp( dot( d, d ) * ( -0.5 / ( sigma * sigma ) ) ) * on * ( clHash2( c + 7.1 ) * 0.7 + 0.3 ) );
	} }
	return v;
}
${ MAIN } {
	let p = ( vec2f( gid.xy ) + 0.5 ) / ${ f( FIB_RES ) };
	let e = ${ f( 1 / FIB_RES ) };
	let curl = vec2f( psi( p + vec2f( 0.0, e ) ) - psi( p - vec2f( 0.0, e ) ), psi( p - vec2f( e, 0.0 ) ) - psi( p + vec2f( e, 0.0 ) ) ) / ( 2.0 * e );
	let dir = normalize( vec2f( 1.0, 0.0 ) + vec2f( 0.0, clGnoise2( p + 0.13, vec2f( 3.0 ) ) * 0.5 ) + curl * 0.05 );
	let cluster = sat( clGfbm( p, vec2f( 5.0 ), 0.9 ) * 1.6 - 0.3 );
	let seeds = max( points( p, cluster, 110.0, 0.3, 0.18, 0.0 ), points( p, cluster, 44.0, 0.3, 0.18, 3.3 ) * 0.8 );
	// tufts (heads of hooked filaments) and, just downwind of them, a sideways sag of the flow
	let tuft = points( p, cluster, 40.0, 0.4, 0.1, 6.1 );
	let droop = points( p, cluster, 40.0, 0.4, 0.3, 6.1 );
	textureStore( outTex, gid.xy, vec4f( seeds, atan2( dir.y, dir.x ), tuft, droop ) );
}` ),

			// short strands: each wisp fades in and out along its length and is broken up by fine noise
			fib: K( 'Cloud Fibres', [ noise ], { auxTex: { texture: this.auxTex }, outTex: { storageTexture: this.fibTex } }, /* wgsl */`${ MAIN } {
	const LIC_STEPS = 44;
	let LIC_STEP = ${ f( 1 / FIB_RES ) };
	let p = ( vec2f( gid.xy ) + 0.5 ) / ${ f( FIB_RES ) };
	var x1 = p; var x2 = p;
	var fib = 0.0;
	var head = 0.0;
	for ( var i = 0; i < LIC_STEPS; i++ ) {
		let k = f32( i );
		let a = textureSampleLevel( auxTex, smpLinearRepeat, x1, 0.0 );
		fib += a.x * sin( ( k + 0.5 ) * ${ f( PI / 44 ) } );
		x1 -= vec2f( cos( a.y ), sin( a.y ) ) * LIC_STEP;
		// hooked tails: from the tuft downwind, sagging sideways
		let b = textureSampleLevel( auxTex, smpLinearRepeat, x2, 0.0 );
		head += b.z * exp( k * ${ f( - 1 / 12 ) } );
		x2 -= normalize( vec2f( cos( b.y ), sin( b.y ) + b.w * 1.2 ) ) * LIC_STEP;
	}
	let breakup = sat( clGfbm( p, vec2f( 24.0 ), 0.71 ) * 1.6 - 0.25 );
	let wisps = ( 1.0 - exp( fib * -0.8 ) ) * breakup;
	let hooks = 1.0 - exp( head * -0.5 );
	let veil = clGfbm( p, vec2f( 4.0 ), 0.33 );
	textureStore( outTex, gid.xy, vec4f( sat( max( wisps, hooks ) ), sat( veil ), 0.0, 1.0 ) );
}` ),
		};

		// ---- coverage dependent 3D distance field (Chebyshev, separable passes) of the dome footprint.
		// Built for a coverage a little above the current one, so small changes need no rebuild
		const sdfParams = this.params;
		const sdfMod = new ShaderModule( { name: 'cloudsSdfParams', deps: [ commonModule, helpers ], uniforms: sdfParams, uniformName: 'cloudsParams', code: '' } );
		// occupancy: a cell may hold cloud if the dome of any weather texel influencing it reaches
		// the cell's lowest altitude
		this.sdfOccKernel = K( 'Cloud SDF Occupancy', [ sdfMod ], { weatherTex: { texture: this.weatherTex }, outTex: { storageTexture: this.sdfA } }, /* wgsl */`${ MAIN } {
	let ix = i32( gid.x ); let iy = i32( gid.y );
	let h0 = f32( gid.z ) / ${ f( SDF_H ) };
	let thr = 1.0 - cloudsParams.sdfCoverage * 1.3;
	// conservative: maxima of every weather quantity around the cell (they are interpolated
	// separately), big cells assumed allowed
	var mx = vec4f( 0.0 );
	for ( var y = -1; y <= 2; y++ ) { for ( var x = -1; x <= 2; x++ ) {
		let wc = vec2i( ( ix * 2 + x + ${ WEATHER_RES } ) % ${ WEATHER_RES }, ( iy * 2 + y + ${ WEATHER_RES } ) % ${ WEATHER_RES } );
		mx = max( mx, textureLoad( weatherTex, wc, 0 ) );
	} }
	let cs = sat( ( mx.x - thr ) / max( 1.0 - thr, 0.05 ) );
	let cb = sat( ( mx.w - thr ) / max( 1.0 - thr, 0.05 ) );
	let occ = max( select( -1.0, clSmallTop( cs, mx.y, mx.z ), cs > 0.0 ), select( -1.0, clBigTop( cb, mx.z ), cb > 0.0 ) ) - h0;
	textureStore( outTex, gid, vec4f( select( 1.0, 0.0, occ > 0.0 ), 0.0, 0.0, 1.0 ) );
}` );

		this.sdfXKernel = K( 'Cloud SDF X', [ commonModule ], { src: { texture: this.sdfA }, outTex: { storageTexture: this.sdfB } }, /* wgsl */`${ MAIN } {
	let ix = i32( gid.x ); let iy = i32( gid.y ); let iz = i32( gid.z );
	var d = ${ f( SDF_R + 1 ) };
	for ( var k = ${ - SDF_R }; k <= ${ SDF_R }; k++ ) {
		if ( textureLoad( src, vec3i( ( ix + k + ${ SDF_RES } ) % ${ SDF_RES }, iy, iz ), 0 ).x * 255.0 < 0.5 ) {
			d = min( d, f32( abs( k ) ) );
		}
	}
	textureStore( outTex, gid, vec4f( d / 255.0, 0.0, 0.0, 1.0 ) );
}` );

		this.sdfYKernel = K( 'Cloud SDF Y', [ commonModule ], { src: { texture: this.sdfB }, outTex: { storageTexture: this.sdfA } }, /* wgsl */`${ MAIN } {
	let ix = i32( gid.x ); let iy = i32( gid.y ); let iz = i32( gid.z );
	var d = ${ f( SDF_R + 1 ) };
	for ( var k = ${ - SDF_R }; k <= ${ SDF_R }; k++ ) {
		d = min( d, max( textureLoad( src, vec3i( ix, ( iy + k + ${ SDF_RES } ) % ${ SDF_RES }, iz ), 0 ).x * 255.0, f32( abs( k ) ) ) );
	}
	textureStore( outTex, gid, vec4f( d / 255.0, 0.0, 0.0, 1.0 ) );
}` );

		this.sdfZKernel = K( 'Cloud SDF Z', [ commonModule ], { src: { texture: this.sdfA }, outTex: { storageTexture: this.sdfTex } }, /* wgsl */`${ MAIN } {
	let ix = i32( gid.x ); let iy = i32( gid.y ); let iz = i32( gid.z );
	var d = ${ f( SDF_R + 1 ) };
	for ( var k = ${ - ( SDF_H - 1 ) }; k <= ${ SDF_H - 1 }; k++ ) {
		let z = iz + k;
		if ( z >= 0 && z < ${ SDF_H } ) {
			d = min( d, max( textureLoad( src, vec3i( ix, iy, z ), 0 ).x * 255.0, f32( abs( k ) ) ) );
		}
	}
	textureStore( outTex, gid, vec4f( d / 255.0, 0.0, 0.0, 1.0 ) );
}` );

		// ---- view: one pixel of every 4x4 block per frame. Per trace: its own block + kernels (see header)
		this._traceSets = [];
		// created up front (at most REBUILD_SLOTS traces a frame) so their pipelines compile in the
		// background during loading, not serially in the first frame
		for ( let i = 0; i < REBUILD_SLOTS; i ++ ) this._traceSet( i );

		// ---- panorama (reflections / environment): interleaved progressive refresh (PANO_FULL: every texel)
		const panoCode = ( full ) => /* wgsl */`
// per pixel random offset (white noise: subsampled every 4 pixels, structured noise such as
// interleaved gradient noise would alias into a visible grid) for the golden ratio sequence
fn pixelHash( px: vec2f ) -> f32 {
	var p3 = fract( vec3f( px.x, px.y, px.x ) * vec3f( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
${ MAIN } {
	${ full ? 'let px = gid.xy;' : 'let px = gid.xy * vec2u( 8u, 4u ) + vec2u( cloudsParams.panoSlot );' }
	if ( px.x >= ${ PANO_W }u || px.y >= ${ PANO_H }u ) { return; }
	let uv = ( vec2f( px ) + 0.5 ) / vec2f( ${ f( PANO_W ) }, ${ f( PANO_H ) } );
	let az = uv.x * ${ f( 2 * PI ) };
	let elev = uv.y * uv.y * ${ f( ( 94 / 180 ) * PI ) } - ${ f( ( 4 / 180 ) * PI ) };
	let rd = vec3f( cos( elev ) * cos( az ), sin( elev ), cos( elev ) * sin( az ) );
	let jitter = pixelHash( vec2f( px ) );
	let m = cloudsMarchPano( rd, jitter );
	// panorama texel: 2 pi / PANO_W across; the elevation mapping is similar near the horizon
	let hi = cloudsHigh( rd, ${ f( 2 * PI / PANO_W ) } );
	textureStore( outTex, px, clOver( vec4f( m.L, m.T ), hi ) );
}`;
		this.panoKernel = K( 'Clouds Panorama', [ this.coreModule ], { outTex: { storageTexture: this.panorama } }, panoCode( false ) );
		this.panoFullKernel = K( 'Clouds Panorama (full)', [ this.coreModule ], { outTex: { storageTexture: this.panorama } }, panoCode( true ) );

		// ---- cloud shadow: transmittance of the layer along the key light (sun, or the moon at
		// night), 1/4 of the rows per frame
		this.shadowKernel = K( 'Cloud Shadow', [ this.coreModule ], { outTex: { storageTexture: this.shadowMap } }, /* wgsl */`${ MAIN } {
	let px = vec2u( gid.x, gid.y * 4u + u32( cloudsParams.shadowPhase ) );
	let uv = ( vec2f( px ) + 0.5 ) / ${ f( SHADOW_RES ) };
	// camera relative ground position
	let gxz = cloudsParams.shadowCenter + ( uv - 0.5 ) * cloudsParams.shadowSize - cloudsParams.camXZ;
	let sunDir = frame.sunDir;
	let mu = max( sunDir.y, 0.08 );
	let tb = cloudsParams.bottom / mu;
	let tt = cloudsParams.top / mu;
	var od = 0.0;
	const steps = 8;
	for ( var k = 0; k < steps; k++ ) {
		let t = mix( tb, tt, ( f32( k ) + 0.5 ) / f32( steps ) );
		let p = cloudsSheared( vec3f( gxz.x, 0.0, gxz.y ) + sunDir * t );
		od += clMeanDensity( cloudsBase( p, cloudsWeather( p.xz ) ) );
	}
	let T = exp( od * cloudsParams.densityScale * ( ( tt - tb ) / f32( steps ) ) * -0.5 );
	textureStore( outTex, px, vec4f( T, 0.0, 0.0, 1.0 ) );
}` );

	}

	// the kernels of the i-th trace of a frame (own uniform block: slot, previous camera, ...)
	_traceSet( i ) {

		if ( this._traceSets[ i ] ) return this._traceSets[ i ];
		const block = new UniformBlock( 'CloudsTrace', {
			slot: [ 'vec2f', new Vector2() ],
			subPixel: [ 'vec2f', new Vector2() ],
			prevRight: [ 'vec3f', new Vector3() ],
			frameNoise: [ 'f32', 0 ],
			prevUp: [ 'vec3f', new Vector3() ],
			rebuildK: [ 'f32', - 1 ],
			prevFwd: [ 'vec3f', new Vector3() ],
			minAlpha: [ 'f32', 0.12 ],
			prevTan: [ 'vec2f', new Vector2( 1, 1 ) ],
			historyValid: [ 'f32', 0 ],
			pad: [ 'f32', 0 ],
			camDelta: [ 'vec3f', new Vector3() ],
			camDeltaHi: [ 'vec3f', new Vector3() ],
		}, { label: 'cloudsTrace' + i } );
		const traceMod = new ShaderModule( {
			name: 'cloudsTrace' + i,
			deps: [ this.coreModule ],
			uniforms: block,
			uniformName: 'cloudsTrace',
			code: /* wgsl */`
fn cloudsViewDir( uv: vec2f ) -> vec3f {
	let ndc = vec2f( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 ) * cloudsParams.camTan;
	return normalize( cloudsParams.camFwd + cloudsParams.camRight * ndc.x + cloudsParams.camUp * ndc.y );
}
// interleaved gradient noise (Jimenez 2014)
fn cloudsIGN( px: vec2f ) -> f32 { return fract( fract( dot( px, vec2f( 0.06711056, 0.00583715 ) ) ) * 52.9829189 ); }
fn cloudsTracedPixel( tp: vec2u ) -> vec2f { return vec2f( tp * 4u + vec2u( cloudsTrace.slot ) ) + 0.5 + cloudsTrace.subPixel; }
fn cloudsOutside( tp: vec2u ) -> bool { return tp.x >= u32( cloudsParams.traceSize.x ) || tp.y >= u32( cloudsParams.traceSize.y ); }
`,
		} );
		const K = ( label, bindings, code ) => new ComputeKernel( { label, modules: [ traceMod ], bindings, code, workgroupSize: [ 8, 8, 1 ] } );
		const MAIN = '@compute @workgroup_size( WG_X, WG_Y, WG_Z ) fn main( @builtin( global_invocation_id ) gid: vec3u )';

		const trace = K( 'Clouds Trace', { traceOut: { storageTexture: this.traceTex }, depthOut: { storageTexture: this.traceDepth } }, /* wgsl */`${ MAIN } {
	let tp = gid.xy;
	if ( cloudsOutside( tp ) ) { return; }
	let px = cloudsTracedPixel( tp );
	let rd = cloudsViewDir( px / cloudsParams.viewSize );
	// well distributed in space (interleaved gradient noise on the grid of traced pixels) and over
	// the traces of each pixel (per cycle offset): the residual noise is high frequency, easy to average
	let jitter = fract( cloudsIGN( vec2f( tp ) ) + cloudsTrace.frameNoise );
	let m = cloudsMarchView( rd, jitter );
	textureStore( traceOut, tp, vec4f( m.L, m.T ) );
	// depth + opacity of the cumulus: the resolve reprojects either the cumulus or the high layers
	textureStore( depthOut, tp, vec4f( m.depth, 1.0 - m.T, 0.0, 1.0 ) );
}` );

		// high layers for the same pixels (separate kernel: keeps the march kernel lean)
		const high = K( 'Clouds High Trace', { traceDepth: { texture: this.traceDepth }, highOut: { storageTexture: this.highTrace }, motionOut: { storageTexture: this.motionTex } }, /* wgsl */`${ MAIN } {
	let tp = gid.xy;
	if ( cloudsOutside( tp ) ) { return; }
	let px = cloudsTracedPixel( tp );
	let rd = cloudsViewDir( px / cloudsParams.viewSize );
	var hi = vec4f( 0.0, 0.0, 0.0, 1.0 );
	if ( rd.y > -0.01 ) {
		hi = cloudsHigh( rd, cloudsParams.camTan.y * 2.0 / cloudsParams.viewSize.y );
	}
	textureStore( highOut, tp, hi );

	// motion for the resolve: the closest cumulus sample around this block (like the closest
	// depth dilation of TAA), so the edges of a cloud move with it and foreground wins
	var best = vec3f( 1e9, 0.0, 0.0 ); // depth key, depth, opacity
	let tmax = vec2i( cloudsParams.traceSize ) - 1;
	for ( var y = -1; y <= 1; y++ ) { for ( var x = -1; x <= 1; x++ ) {
		let dz = textureLoad( traceDepth, clamp( vec2i( tp ) + vec2i( x, y ), vec2i( 0 ), tmax ), 0 );
		let key = select( 1e9, dz.x, dz.y > 0.15 );
		if ( key < best.x ) { best = vec3f( key, dz.xy ); }
	} }
	if ( best.x > 1e8 ) {
		best = vec3f( 0.0, textureLoad( traceDepth, vec2i( tp ), 0 ).xy );
	}
	textureStore( motionOut, tp, vec4f( best.yz, 0.0, 1.0 ) );
}` );

		// range (min, max) of this frame's composited samples in the 3x3 blocks around each block
		const box = K( 'Clouds Box', { traceTex: { texture: this.traceTex }, highTrace: { texture: this.highTrace }, minOut: { storageTexture: this.boxMin }, maxOut: { storageTexture: this.boxMax } }, /* wgsl */`${ MAIN } {
	let tp = vec2i( gid.xy );
	if ( cloudsOutside( gid.xy ) ) { return; }
	let tmax = vec2i( cloudsParams.traceSize ) - 1;
	var lo = vec4f( 1e4 ); var hi = vec4f( -1e4 );
	for ( var y = -1; y <= 1; y++ ) { for ( var x = -1; x <= 1; x++ ) {
		let q = clamp( tp + vec2i( x, y ), vec2i( 0 ), tmax );
		let c = clOver( textureLoad( traceTex, q, 0 ), textureLoad( highTrace, q, 0 ) );
		lo = min( lo, c );
		hi = max( hi, c );
	} }
	textureStore( minOut, tp, lo );
	textureStore( maxOut, tp, hi );
}` );

		// ---- resolve: reproject the history, refresh the traced pixels
		const resolve = ( src, dst ) => K( 'Clouds Resolve', {
			motionTex: { texture: this.motionTex }, traceTex: { texture: this.traceTex }, highTrace: { texture: this.highTrace },
			boxMin: { texture: this.boxMin }, boxMax: { texture: this.boxMax }, srcHistory: { texture: src }, dstHistory: { storageTexture: dst },
		}, /* wgsl */`
${ catmullRomWGSL( 'historyCatmullRom', 'srcHistory' ) }
// this frame's samples upsampled (they sit at the slot of each block)
fn upsampled( p: vec2u ) -> vec4f {
	let suv = ( ( vec2f( p ) - cloudsTrace.slot ) / 4.0 + 0.5 ) / cloudsParams.traceSize;
	return clOver( textureSampleLevel( traceTex, smpLinearClamp, suv, 0.0 ), textureSampleLevel( highTrace, smpLinearClamp, suv, 0.0 ) );
}
fn b2( a: f32, b: f32 ) -> f32 { return abs( a - b ) * 2.0 + b; }
${ MAIN } {
	let p = gid.xy;
	if ( p.x >= u32( cloudsParams.viewSize.x ) || p.y >= u32( cloudsParams.viewSize.y ) ) { return; }
	let uv = ( vec2f( p ) + 0.5 ) / cloudsParams.viewSize;
	let rd = cloudsViewDir( uv );
	if ( rd.y < -0.06 ) { return; }

	let tp = p / 4u;
	let fresh = ( p.x % 4u ) == u32( cloudsTrace.slot.x ) && ( p.y % 4u ) == u32( cloudsTrace.slot.y );
	let dz = textureLoad( motionTex, vec2i( tp ), 0 );
	// where was this cloud point last frame (camera motion and wind drift): cumulus, or the high
	// layers where there is no cumulus in front
	let T = cloudsTrace;
	let pdC = normalize( rd * dz.x + T.camDelta );
	let pdH = normalize( rd * cloudsShell( cloudsParams.camY, rd, cloudsParams.cirrusAlt ) + T.camDeltaHi );
	let pd = select( pdH, pdC, dz.y > 0.3 );
	let puv = mix( cloudsProject( pdH, T.prevRight, T.prevUp, T.prevFwd, T.prevTan ), cloudsProject( pdC, T.prevRight, T.prevUp, T.prevFwd, T.prevTan ), smoothstep( 0.1, 0.5, dz.y ) );
	let valid = T.historyValid > 0.5 && dot( pd, T.prevFwd ) > 0.01 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0 && pd.y > -0.05;
	var out = vec4f( 0.0, 0.0, 0.0, 1.0 );
	if ( rd.y > -0.035 ) {
		if ( valid ) {
			// reprojected history, clamped to the range of this frame's samples around it (with a
			// margin): real changes (lighting, motion the reprojection missed) can't leave ghosts,
			// so the samples can be averaged over many frames, which removes the noise
			let h = max( historyCatmullRom( puv, cloudsParams.viewSize ), vec4f( 0.0 ) );
			let lo = textureLoad( boxMin, vec2i( tp ), 0 ); let hi = textureLoad( boxMax, vec2i( tp ), 0 );
			let pad = ( hi - lo ) * 0.25 + 0.01;
			out = select( h, clamp( h, lo - pad, hi + pad ), T.rebuildK < 0.0 );
		} else {
			out = upsampled( p );
		}

		if ( fresh ) {
			let cu = textureLoad( traceTex, vec2i( tp ), 0 );
			let hl = textureLoad( highTrace, vec2i( tp ), 0 );
			let cur = clOver( cu, hl );
			// average the jittered samples over time (removes the ray march noise); a little
			// shorter where the clouds move fast on screen (the history is resampled every frame)
			let hist = out;
			let motion = length( ( puv - uv ) * cloudsParams.viewSize );
			let a0 = T.minAlpha;
			let a = clamp( motion * 0.1 + a0, a0, 0.35 );
			// rebuilding after a camera cut: each pixel takes its own first sample as is
			out = select( cur, mix( hist, cur, a ), valid && T.rebuildK < 0.0 );
		} else if ( T.rebuildK >= 0.0 && valid ) {
			// rebuilding: pixels without a sample of their own since the cut average the upsampled
			// samples of every slot traced so far (their refresh rank is the 4x4 Bayer index)
			let x = f32( p.x % 4u ); let y = f32( p.y % 4u );
			let rank = b2( x % 2.0, y % 2.0 ) * 4.0 + b2( floor( x / 2.0 ), floor( y / 2.0 ) );
			if ( rank > T.rebuildK ) {
				out = mix( out, upsampled( p ), 1.0 / ( T.rebuildK + 1.0 ) );
			}
		}
	}

	textureStore( dstHistory, p, vec4f( out.rgb, clamp( out.a, 0.0, 1.0 ) ) );
}` );

		const set = { block, trace, high, box, resolve: [ resolve( this.history[ 1 ], this.history[ 0 ] ), resolve( this.history[ 0 ], this.history[ 1 ] ) ] };
		this._traceSets[ i ] = set;
		return set;

	}

	_resize( fw, fh ) {

		this._w = fw;
		this._h = fh;
		this._scale = this.resolutionScale;
		const w = Math.max( 4, Math.round( fw * this._scale * HISTORY_SCALE ) ), h = Math.max( 4, Math.round( fh * this._scale * HISTORY_SCALE ) );
		this.displayH.value = Math.max( 4, fh * this._scale );
		const tw = Math.ceil( w / 4 ), th = Math.ceil( h / 4 );
		this.viewSize.value.set( w, h );
		this.traceSize.value.set( tw, th );
		for ( const t of [ this.traceTex, this.traceDepth, this.highTrace, this.boxMin, this.boxMax, this.motionTex ] ) t.resize( tw, th );
		this.history[ 0 ].resize( w, h );
		this.history[ 1 ].resize( w, h );
		// the new textures hold nothing until traced: the sky uses the panorama meanwhile
		this.viewValid.value = 0;
		this.resetHistory();

	}

	_drawingBufferSize() {

		if ( this.outputSize ) return this.outputSize;
		const r = this.renderer;
		if ( r && r.getDrawingBufferSize ) return r.getDrawingBufferSize( this._size || ( this._size = new Vector2() ) );
		if ( r && r.width && r.height ) return { x: r.width, y: r.height };
		if ( GPU.canvas ) return { x: GPU.canvas.width, y: GPU.canvas.height };
		return FrameUniforms.fields.outputResolution.value;

	}

	// ------------------------------------------------------------ per frame

	update( dt, camera ) {

		this._traceIndex = 0;

		// wind drift, kept bounded (every noise tiles within TILE)
		const wind = this.wind.value;
		const c = Math.cos( this._rot ), s = Math.sin( this._rot );
		const o = this.offset.value;
		o.addScaledVector( wind, dt );
		o.set( ( ( o.x % TILE ) + TILE ) % TILE, ( ( o.y % TILE ) + TILE ) % TILE );
		const ow = this._offsetW;
		ow.x += ( wind.x * c + wind.y * s ) * dt;
		ow.y += ( wind.y * c - wind.x * s ) * dt;
		ow.set( ( ( ow.x % TILE ) + TILE ) % TILE, ( ( ow.y % TILE ) + TILE ) % TILE );

		const oh = this._offsetH;
		oh.addScaledVector( wind, dt * 1.6 );
		oh.set( ( ( oh.x % TILE ) + TILE ) % TILE, ( ( oh.y % TILE ) + TILE ) % TILE );

		camera.updateMatrixWorld();
		const cp = camera.position;
		// the march assumes a camera below the cloud base
		this.camY.value = MathUtils.clamp( cp.y, 1, this.bottom.value - 50 );
		if ( wind.lengthSq() > 1e-6 ) this.windN.value.copy( wind ).normalize();
		this.horizonY.value = - Math.sqrt( 2 * this.camY.value / EARTH_R );
		// the field moves along +wind: sample it at (position - offset)
		this.nOrigin.value.set( cp.x - o.x, cp.z - o.y );
		this.wOrigin.value.set( cp.x * c + cp.z * s - ow.x, cp.z * c - cp.x * s - ow.y );

		// ---- coverage changes: rebuild the distance field when it no longer bounds the clouds (or
		// has become too loose to skip well); the view and panorama converge on their own
		const cov = this.coverage.value;
		if ( cov > this.sdfCoverage.value || cov < this.sdfCoverage.value - 0.1 ) {

			this.sdfCoverage.value = Math.min( cov + 0.04, 1 );
			this._buildSDF();

		}

		// ---- view camera frame
		const size = this._drawingBufferSize();
		if ( size.x !== this._w || size.y !== this._h || this.resolutionScale !== this._scale ) this._resize( size.x, size.y );
		const e = camera.matrixWorld.elements;
		const tanY = Math.tan( MathUtils.degToRad( camera.fov * 0.5 ) ) / ( camera.zoom || 1 );
		const C = this.cam, P = this.prev;
		P.right.value.copy( C.right.value );
		P.up.value.copy( C.up.value );
		P.fwd.value.copy( C.fwd.value );
		P.tan.value.copy( C.tan.value );
		C.right.value.set( e[ 0 ], e[ 1 ], e[ 2 ] ).normalize();
		C.up.value.set( e[ 4 ], e[ 5 ], e[ 6 ] ).normalize();
		C.fwd.value.set( - e[ 8 ], - e[ 9 ], - e[ 10 ] ).normalize();
		C.tan.value.set( tanY * camera.aspect, tanY );
		// camera cuts (teleports, big turns, time of day jumps, zoom): the history is useless, rebuild
		// it at full rate. Ordinary camera motion is handled by the reprojection
		const moved = this._hasPrev ? cp.distanceTo( this._prevCam ) : Infinity;
		const turned = C.fwd.value.angleTo( P.fwd.value );
		this._turned = turned;
		const sun = G.sunDir.value;
		if ( moved > 8 || turned > 0.5 || sun.angleTo( this._prevSun ) > 0.05 || Math.abs( C.tan.value.y - P.tan.value.y ) > 1e-3 * C.tan.value.y ) this.resetHistory();
		this._prevSun.copy( sun );
		// camera motion since last frame minus the wind drift of the clouds
		this.camDelta.value.set( cp.x - this._prevCam.x - wind.x * dt, cp.y - this._prevCam.y, cp.z - this._prevCam.z - wind.y * dt );
		this.camDeltaHi.value.set( cp.x - this._prevCam.x - wind.x * dt * 1.6, cp.y - this._prevCam.y, cp.z - this._prevCam.z - wind.y * dt * 1.6 );
		this._prevCam.copy( cp );
		this._hasPrev = true;

		this.shadowPhase.value = this.frame % 4;
		if ( this.frame % 4 === 0 ) this.shadowCenter.value.set( cp.x, cp.z );
		this.camXZ.value.set( cp.x, cp.z );
		this.hOffset.value.copy( oh );

		// ---- panorama: 1/32 of the texels per frame (8x4 blocks); all of them after a reset
		if ( this.panoWarm > 0 ) {

			this.panoFullKernel.dispatch( [ PANO_W / 8, PANO_H / 8, 1 ] );
			this.panoWarm = 0;

		}

		this._panoSlot( this.frame );
		const shadowAndPano = () => {

			this.shadowKernel.dispatch( [ SHADOW_RES / 8, SHADOW_RES / 32, 1 ] );
			this.panoKernel.dispatch( [ PANO_W / 64, PANO_H / 32, 1 ] );

		};

		if ( G.cameraUnderwater.value > 0.5 ) {

			// the sky is only seen through Snell's window (panorama): no view clouds
			shadowAndPano();
			this.resetHistory();

		} else if ( this._rebuild < 16 ) {

			// after a cut: several slots per frame, until every pixel has a sample of its own
			for ( let k = 0; k < REBUILD_SLOTS && this._rebuild < 16; k ++ ) {

				if ( k > 0 ) this._holdCamera();
				this.rebuildK.value = this._rebuild;
				this._trace( ORDER[ this._rebuild ++ ] );

			}

			shadowAndPano();

		} else {

			// samples every pixel holds since the cut
			const n = 1 + Math.floor( this._since ++ / 16 );
			this.minAlpha.value = Math.max( 0.12, 1 / ( n + 1 ) );
			this.rebuildK.value = - 1;
			this._trace( ORDER[ this.frame % 16 ] );
			shadowAndPano();
			// turning camera: a second slot per frame (every pixel refreshed in 8 frames instead of 16)
			// keeps the reprojected history from softening
			if ( this._turned > 0.003 ) {

				this._holdCamera();
				this._trace( ORDER[ ( this.frame + 8 ) % 16 ] );

			}

		}

		this.frame ++;

	}

	// trace one slot of every 4x4 block and resolve it into the history
	_trace( order ) {

		this.slot.value.set( order % 4, Math.floor( order / 4 ) );
		// R2 sequence over the traces (one offset per 16 frame cycle, so each pixel sees them all)
		const n = Math.floor( this._traces / 16 ) + 1;
		this.subPixel.value.set( ( ( 0.5 + n * 0.7548776662 ) % 1 ) - 0.5, ( ( 0.5 + n * 0.5698402910 ) % 1 ) - 0.5 ).multiplyScalar( 0.25 );
		// march jitter: a pixel is traced once per 16 frame cycle, so the offset advances per cycle
		// (golden ratio sequence on top of the pixel's IGN value): every trace of a pixel gets a new,
		// well spread offset and the history converges. (Stepping it per trace, mod 64, gave each
		// pixel only 4 offsets: a fixed residual of the step and light-march pattern, seen as grain.)
		this.frameNoise.value = ( n * 0.6180339887 ) % 1;
		this._traces ++;

		// this trace's own copy of the per-trace state
		const set = this._traceSet( this._traceIndex ++ );
		const B = set.block.fields, P = this.prev;
		B.slot.value.copy( this.slot.value );
		B.subPixel.value.copy( this.subPixel.value );
		B.frameNoise.value = this.frameNoise.value;
		B.rebuildK.value = this.rebuildK.value;
		B.minAlpha.value = this.minAlpha.value;
		B.historyValid.value = this.historyValid.value;
		B.prevRight.value.copy( P.right.value );
		B.prevUp.value.copy( P.up.value );
		B.prevFwd.value.copy( P.fwd.value );
		B.prevTan.value.copy( P.tan.value );
		B.camDelta.value.copy( this.camDelta.value );
		B.camDeltaHi.value.copy( this.camDeltaHi.value );

		const tg = [ Math.ceil( this.traceSize.value.x / 8 ), Math.ceil( this.traceSize.value.y / 8 ), 1 ];
		set.trace.dispatch( tg );
		set.high.dispatch( tg );
		set.box.dispatch( tg );
		set.resolve[ this._pp ].dispatch( [ Math.ceil( this.viewSize.value.x / 8 ), Math.ceil( this.viewSize.value.y / 8 ), 1 ] );
		this.viewTex = this.history[ this._pp ];
		this._pp = 1 - this._pp;
		this.historyValid.value = 1;
		const C = this.cam, V = this.viewCam;
		V.right.value.copy( C.right.value );
		V.up.value.copy( C.up.value );
		V.fwd.value.copy( C.fwd.value );
		V.tan.value.copy( C.tan.value );
		this.viewValid.value = 1;

	}

	// no camera motion between the traces of one frame
	_holdCamera() {

		const C = this.cam, P = this.prev;
		P.right.value.copy( C.right.value );
		P.up.value.copy( C.up.value );
		P.fwd.value.copy( C.fwd.value );
		P.tan.value.copy( C.tan.value );
		this.camDelta.value.set( 0, 0, 0 );
		this.camDeltaHi.value.set( 0, 0, 0 );

	}

	// Restart the view accumulation (camera cuts are also detected on their own), rebuilding it at
	// full rate over the next frames so no seam shows.
	resetHistory() {

		this._rebuild = 0;
		this._since = 0;
		this.historyValid.value = 0;

	}

	_panoSlot( k ) {

		const o = ORDER[ k % 16 ];
		this.panoSlot.value.set( ( o % 4 ) * 2 + ( Math.floor( k / 16 ) % 2 ), Math.floor( o / 4 ) );

	}

	_buildSDF() {

		const d = [ SDF_RES / 8, SDF_RES / 8, SDF_H ];
		for ( const k of [ this.sdfOccKernel, this.sdfXKernel, this.sdfYKernel, this.sdfZKernel ] ) k.dispatch( d );

	}

	// restart all accumulation (view, panorama)
	invalidate() {

		this.panoWarm = 1;
		this.resetHistory();

	}

}

// ------------------------------------------------------------ the ray march (one WGSL function per quality)

// Ray march the cumulus layer along rd (camera relative, camera on the planet axis).
// Returns { L, T, depth }: sky * T + L is the composite, L includes aerial perspective.
function marchWGSL( name, q ) {

	const bandStep = `min( exp2( b ) * ${ f( q.ds0 ) }, ${ f( q.dsMax ) } )`;
	let light = '';
	let prev = 0;
	for ( let k = 0; k < q.lightSteps.length; k ++ ) {

		const dist = q.lightSteps[ k ];
		const len = dist - prev;
		prev = dist;
		light += `\t\t\t\t{\n\t\t\t\t\tlet lp = cloudsSheared( pr + sunDir * ( lj * ${ f( dist - len * 0.5 ) } ) );\n`;
		if ( k < q.lightDetail ) {

			// detailed self shadowing matters near the visible surface only
			light += `\t\t\t\t\tlet lb = cloudsBase( lp, w );
					if ( T > 0.5 ) {
						// filtered at the size of the light segment
						od += cloudsErode( lp, lb, max( foot, ${ f( len * 0.35 ) } ) ).x * ${ f( len ) };
					} else {
						od += clMeanDensity( lb ) * ${ f( len ) };
					}\n`;

		} else {

			light += `\t\t\t\t\tlet lb = cloudsBase( lp, cloudsWeather( lp.xz ) );\n\t\t\t\t\tod += clMeanDensity( lb ) * ${ f( len ) };\n`;

		}

		light += '\t\t\t\t}\n';

	}

	return /* wgsl */`
fn cloudsBandStep${ name }( b: f32 ) -> f32 { return ${ bandStep }; }
fn cloudsSnapCoarse${ name }( t: f32, up: bool, jitter: f32, k0: f32 ) -> f32 {
	let b = cloudsBand( t ); let s0 = cloudsBandStart( b ); let ds = cloudsBandStep${ name }( b );
	let i = ( t - s0 ) / ds - jitter;
	let m = select( floor( i + 1e-3 ), ceil( i - 1e-3 ), up );
	let mc = select( m - cloudsPosMod( m - k0, ${ f( q.coarse ) } ), m + cloudsPosMod( k0 - m, ${ f( q.coarse ) } ), up );
	return s0 + ( mc + jitter ) * ds;
}
fn cloudsMarch${ name }( rd: vec3f, jitter: f32 ) -> CloudsMarch {
	let camY = cloudsParams.camY;
	let light = cloudsKeyLight( ( cloudsParams.bottom + cloudsParams.top ) * 0.0005 );
	let sunDir = light.dir;
	let pxAngle = ${ q.pxAngle };
	let t0 = max( cloudsShell( camY, rd, cloudsParams.bottom ), 0.0 );
	let t1 = min( cloudsShell( camY, rd, cloudsParams.top ), ${ f( q.maxDist ) } );
	var L = vec3f( 0.0 );
	var T = 1.0;
	var opac = 0.0;
	var tAcc = 0.0;
	var wAcc = 0.0;
	let k0 = floor( fract( jitter * 7.31 + 0.37 ) * ${ f( q.coarse ) } ); // coarse phase

	let cosT = dot( rd, sunDir );
	// multiple scattering octaves (Hillaire 2016): scattering a^i, extinction b^i, eccentricity c^i
	// (sky-pro-webgpu) normalized droplet phase: 80% forward / 20% back; each order halves the asymmetry
	let phase = vec3f( clPhaseHG( cosT, 0.8 ), clPhaseHG( cosT, 0.4 ), clPhaseHG( cosT, 0.2 ) ) * 0.8
		+ vec3f( clPhaseHG( cosT, -0.2 ), clPhaseHG( cosT, -0.1 ), clPhaseHG( cosT, -0.05 ) ) * 0.2;
	let ph3 = ${ f( 0.15 / ( 4 * PI ) ) }; // light diffused through the whole cloud (keeps thick bodies from going black)
	let sunE = light.E;
	let amb = frame.skyIrradiance * ${ f( q.ambient ) };
	// in-scatter probability (Schneider 2015 'powder', Nubis 2017): light scattered toward the viewer
	// builds up inside the cloud, so thin edges and the underside look darker; faded out looking
	// toward the sun, where the forward peak makes the thin edges glow (silver lining)
	let powderK = sat( cosT * -0.5 + 0.6 );
	// warm light bounced by the sunlit sea onto the undersides (at low sun the sunlight is warm)
	let bounce = frame.sunColor * ( max( sunDir.y, 0.0 ) * 0.01 + 0.003 );

	var t = cloudsSnapCoarse${ name }( t0, true, jitter, k0 );
	var bd = cloudsBand( t );
	// Nubis stepping: coarse steps with the cheap density until something is hit, then step
	// back and walk through it with fine, fully detailed samples
	var fineSteps = 0;

	if ( rd.y > cloudsParams.horizonY && t1 > t0 ) {
		for ( var it = 0; it < ${ q.maxSteps }; it++ ) {
			if ( t > t1 || T < 0.015 ) { break; }

			// entering the next distance band: onto its lattice
			if ( cloudsBand( t ) != bd ) {
				bd = cloudsBand( t );
				if ( fineSteps == 0 ) {
					t = cloudsSnapCoarse${ name }( t, true, jitter, k0 );
				} else {
					let s0 = cloudsBandStart( bd ); let d0 = cloudsBandStep${ name }( bd );
					t = s0 + ( ceil( ( t - s0 ) / d0 - jitter - 1e-3 ) + jitter ) * d0;
				}
			}

			let pr = vec3f( rd.x * t, camY + rd.y * t, rd.z * t );
			let p = cloudsSheared( pr );
			let ds = cloudsBandStep${ name }( bd );

			if ( fineSteps == 0 ) {
				let sk = cloudsSkip( p );
				// the shear can move the sample up to 12% more than the ray
				let jump = sk * 0.89;
				if ( jump > ds * ${ f( q.coarse ) } ) {
					// far from any cloud: jump, landing on the coarse lattice (at least one stride on)
					t = max( cloudsSnapCoarse${ name }( t + jump, false, jitter, k0 ), t + ds * ${ f( q.coarse ) } );
					bd = cloudsBand( t );
				} else {
					let b = cloudsBase( p, cloudsWeather( p.xz ) );
					// switch to fine steps a little before the surface so thin wisps aren't skipped
					if ( b.x > -0.08 ) {
						t -= ds * ${ f( q.coarse - 1 ) };
						fineSteps = 5;
					} else {
						t += ds * ${ f( q.coarse ) };
					}
				}
			} else {
				let w = cloudsWeather( p.xz );
				let b = cloudsBase( p, w );
				fineSteps -= 1;

				if ( b.x > 0.002 ) {
					fineSteps = 3;
					// detail level from the pixel footprint (m): the close range octave (lumps of ~13 - 51 m)
					// fades out beyond ~3 km, the erosion (~47 - 190 m) beyond ~24 km, so nothing smaller
					// than about two pixels is ever sampled (that would only alias into grain)
					let foot = t * pxAngle;
					var er = vec2f( clMeanDensity( b ), 1.0 - clMeanCrease( b ) );
					// detail erosion (every octave under 2 px: the mean erosion above)
${ q.detail ? `\t\t\t\t\tif ( foot < ${ f( D_S1 * 0.24 ) } ) { er = cloudsErode( p, b, foot ); }` : '' }
					let dens = er.x;

					if ( dens > 0.002 ) {
						// light march toward the sun: near samples share the weather and keep the
						// detail, far ones only see the base shape
						var od = 0.0;
						// jittered along the light ray: its sampling pattern turns into noise the
						// temporal filter removes, instead of streaks across the cloud
						let lj = fract( jitter + 0.5 ) * 0.3 + 0.85;
${ light }
						let sig = dens * cloudsParams.densityScale;
						// light optical depth (the local segment included); multiple scattering lowers the
						// effective extinction of the light
						let tau = ( od + dens * 6.0 ) * cloudsParams.densityScale;
						// single scattering (dual-lobe HG) through the true optical depth, one multiple
						// scattering octave (Wrenninge 2013: extinction and eccentricity lowered), and the
						// diffusion regime of a thick, non-absorbing cloud: diffuse light is transmitted
						// ~ 1 / (1 + 0.75 (1 - g) tau), so a sunlit surface reflects like a bright diffuser and
						// the shaded side stays grey, not black (the octave sum alone was ~4x too dark)
						// multiply scattered light builds up with height in the cloud (Nubis 'vertical
						// probability'): the lower parts are darker
						let msV = mix( 0.35, 1.0, smoothstep( 0.0, 0.45, b.y ) );
						let sun = phase.x * exp( -tau ) + ( phase.y * 0.6 * exp( tau * -0.3 )
							+ phase.z * ( CL_MS / pow2( 1.0 + 0.1 * tau ) ) + ph3 * exp( tau * -0.03 ) ) * msV;
						// skylight occlusion: two broad upward probes (125 m, 600 m) of the filtered density
						let pu1 = cloudsSheared( pr + vec3f( 0.0, 125.0, 0.0 ) ); let pu2 = cloudsSheared( pr + vec3f( 0.0, 600.0, 0.0 ) );
						let skyTau = ( clMeanDensity( cloudsBase( pu1, w ) ) * 250.0 + clMeanDensity( cloudsBase( pu2, cloudsWeather( pu2.xz ) ) ) * 700.0
							+ dens * 25.0 ) * cloudsParams.densityScale;
						let skyVis = 0.3 + 0.7 / ( skyTau * 0.35 + 1.0 );
						// darker bases (their direct light is scattered away by the cloud above)
						let baseShadow = mix( 0.55, 1.0, smoothstep( -0.1, 0.45, b.y ) );
						let depthP = pow( dens, mix( 0.5, 1.6, b.y ) ) * 0.95 + 0.05;
						let vertP = pow( smoothstep( 0.02, 0.2, b.y ), 0.8 ) * 0.85 + 0.15;
						let powder = mix( 1.0, depthP * vertP, powderK );
						// ambient: the sky lights the tops; the bases only see the dark sea and the
						// horizon (darker, bluer), and crevices of the detail noise are occluded
						let up = sat( b.y * 1.4 );
						let ambH = mix( vec3f( 0.45, 0.5, 0.58 ), vec3f( 1.0 ), sqrt( up ) ) * skyVis * ( er.y * 0.75 + 0.42 );
						// after sunset the tops stay lit longest
						let alt = pr.y + dot( pr.xz, pr.xz ) / ${ f( 2 * EARTH_R ) };
						let S = sunE * ( sun * powder * baseShadow * ( er.y * 0.5 + 0.5 ) * cloudsEarthShadow( light, alt, pr.xz ) ) + amb * ambH
							+ bounce * ( 1.0 - up );
						let Tstep = exp( - sig * ds );
						let tap = exp( t * ${ f( - 1 / AP_DIST ) } );
						let dT = T * ( 1.0 - Tstep );
						L += S * dT * tap;
						opac += dT * tap;
						tAcc += t * dT;
						wAcc += dT;
						T *= Tstep;
					}
				}

				t += ds;
				if ( fineSteps == 0 ) {
					t = cloudsSnapCoarse${ name }( t, true, jitter, k0 );
				}
			}
		}
	}

	var m: CloudsMarch;
	m.depth = select( t0 + 4000.0, tAcc / max( wAcc, 1e-4 ), wAcc > 1e-4 );
	// aerial perspective: the haze in front of distant clouds shows sky light where the cloud
	// hides the sky (sky luminance times the hidden fraction not reached by the cloud's light)
	// the march stops at 98.5% opacity: the rest counts as opaque (the sun disc must not shine through)
	let Tc = sat( ( T - 0.015 ) / 0.985 );
	let haze = 1.0 - Tc - opac;
	m.L = L + atmosphereSkyLuminance( rd ) * max( haze, 0.0 );
	m.T = Tc;
	return m;
}
`;

}
