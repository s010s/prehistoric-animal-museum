import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { StorageBuffer } from '../engine/gpu/Texture.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { MathUtils, Vector2, Vector3 } from '../engine/math/index.js';

// Camera lens flare for the sun (and the moon, dimly), built from what a real multi-element lens
// does rather than sprites:
//  - ghosts: reflections between lens surfaces, images of the 7-blade aperture strung along the line
//    from the sun through the image centre; each with a bright rim, a soft body and dispersion
//    fringes (every colour images the aperture at a slightly different size)
//  - halo: a faint dispersive ring around the image centre, strongest when the sun nears the edge
//  - starburst: diffraction spikes from the aperture blades (14 for 7 blades) around the sun: short
//    and tapering, each a little different in length and strength (no two blades are identical), red
//    reaching a little further than blue (diffraction scales with wavelength), a pixel or so wide;
//    and a haze of fine short streaks right around the disc
//  - veiling glare: a soft wide glow lifting the blacks
// The sun's visibility (fraction of the disc not hidden by the scene, times the cloud
// transmittance) is measured on the GPU from the depth buffer every frame and eased, so leaves and
// masts crossing the sun make the flare flicker naturally without popping.
//
// WGSL (this.module, prefix `flare`): fn flareLight( uv: vec2f ) -> vec3f (the former node( uv )).
// `this.kernel` (ComputeKernel) measures the visibility: dispatch( 1 ) after the scene render.
// Consumed: clouds.module `cloudsSampleView( dir: vec3f ) -> vec4f` (optional).

const BLADES = 7;
const ROT = 0.3; // aperture rotation (rad)
// a: position along the axis (1 = sun, 0 = image centre, < 0 past it), r: radius (fraction of the
// image height), tint, strength
const GHOSTS = [
	{ a: 0.72, r: 0.018, tint: [ 1.0, 0.85, 0.6 ], k: 0.55 },
	{ a: 0.44, r: 0.045, tint: [ 0.55, 0.9, 1.0 ], k: 0.35 },
	{ a: 0.16, r: 0.022, tint: [ 0.8, 1.0, 0.7 ], k: 0.45 },
	{ a: - 0.18, r: 0.07, tint: [ 0.6, 0.75, 1.0 ], k: 0.22 },
	{ a: - 0.42, r: 0.03, tint: [ 1.0, 0.7, 0.9 ], k: 0.4 },
	{ a: - 0.75, r: 0.11, tint: [ 0.7, 1.0, 0.85 ], k: 0.14 },
	{ a: - 1.15, r: 0.05, tint: [ 1.0, 0.8, 0.55 ], k: 0.28 },
];
const VIS_TAPS = 24;

const f = ( x ) => {

	const s = String( x );
	return s.includes( '.' ) || s.includes( 'e' ) ? s : s + '.0';

};

export class LensFlare {

	constructor( { depthTexture, clouds = null, sunDir } ) {

		this.sunDir = sunDir; // true sun direction (atmosphere): a { value: Vector3 } handle
		this.uniforms = new UniformBlock( 'FlareParams', {
			sunDir: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			strength: [ 'f32', 1 ],
			sunUV: [ 'vec2f', new Vector2( 0.5, 0.5 ) ],
			inView: [ 'f32', 0 ], // 0..1, fades as the sun leaves the frame
			aboveWater: [ 'f32', 1 ],
			aspect: [ 'f32', 16 / 9 ],
			discPx: [ 'f32', 6 ], // sun disc radius in depth-buffer pixels
			dt: [ 'f32', 1 / 60 ],
		}, { label: 'flare' } );
		const U = this.uniforms.fields;
		this.strength = U.strength;
		this.sunUV = U.sunUV;
		this.inView = U.inView;
		this.aboveWater = U.aboveWater;
		this.aspect = U.aspect;
		this.discPx = U.discPx;
		this.dt = U.dt;
		this.visibility = new StorageBuffer( { label: 'flareVisibility', count: 1, type: 'f32', data: new Float32Array( [ 0 ] ) } );
		this.depthTexture = depthTexture;
		this.clouds = clouds;

		let taps = '';
		for ( let i = 0; i < VIS_TAPS; i ++ ) {

			// golden-angle spiral over the sun's disc
			const r = Math.sqrt( ( i + 0.5 ) / VIS_TAPS );
			const t = i * 2.39996323;
			taps += `\tsky += flareSkyTap( c + vec2f( ${ f( Math.cos( t ) * r ) }, ${ f( Math.sin( t ) * r ) } ) * flareParams.discPx, size );\n`;

		}

		const hasClouds = !! ( clouds && clouds.module );
		this.kernel = new ComputeKernel( {
			label: 'Lens Flare Visibility',
			modules: [ commonModule, hasClouds ? clouds.module : null ].filter( Boolean ),
			bindings: {
				flareParams: { uniform: this.uniforms },
				flareDepth: { texture: () => this.depthTexture },
				flareVisRW: { storage: this.visibility, access: 'read_write' },
			},
			workgroupSize: [ 1, 1, 1 ],
			code: /* wgsl */`
fn flareSkyTap( p: vec2f, size: vec2i ) -> f32 {
	let q = clamp( vec2i( p ), vec2i( 0 ), size - 1 );
	// reversed depth: the sky is at 0
	return select( 0.0, 1.0, textureLoad( flareDepth, q, 0 ) < 1e-7 );
}
@compute @workgroup_size( 1 )
fn main() {
	let size = vec2i( textureDimensions( flareDepth ) );
	let c = flareParams.sunUV * vec2f( size );
	var sky = 0.0;
${ taps }
	let cloudT = ${ hasClouds ? 'cloudsSunTransmittance( cloudsSampleView( flareParams.sunDir ).a )' : '1.0' };
	let up = smoothstep( -0.02, 0.04, flareParams.sunDir.y );
	let tgt = sky / ${ f( VIS_TAPS ) } * cloudT * up * flareParams.inView * flareParams.aboveWater;
	let v = flareVisRW[ 0 ];
	flareVisRW[ 0 ] = mix( v, tgt, 1.0 - exp( flareParams.dt * -14.0 ) );
}
`,
		} );

		let ghosts = '';
		for ( const g of GHOSTS ) {

			ghosts += /* wgsl */`
	{
		let pd = flarePolyDist( p - s * ${ f( g.a ) } );
		let body = vec3f( smoothstep( ${ f( g.r * 0.975 ) }, ${ f( g.r * 0.975 * 0.9 ) }, pd ), smoothstep( ${ f( g.r ) }, ${ f( g.r * 0.9 ) }, pd ), smoothstep( ${ f( g.r * 1.025 ) }, ${ f( g.r * 1.025 * 0.9 ) }, pd ) );
		let rim = smoothstep( ${ f( g.r * 0.55 ) }, ${ f( g.r ) }, pd ) * 0.7 + 0.3;
		// smaller ghosts concentrate the same reflected energy: brighter
		ghosts += body * rim * vec3f( ${ g.tint.map( f ).join( ', ' ) } ) * ${ f( g.k * 0.0028 / ( g.r * g.r ) ) };
	}`;

		}

		this.module = new ShaderModule( {
			name: 'flare',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			uniformName: 'flareParams',
			bindings: { flareVis: { storage: this.visibility, access: 'read' } },
			code: /* wgsl */`
const FLARE_SEG: f32 = ${ f( 2 * Math.PI / BLADES ) };

// aperture polygon: distance scaled so the polygon edge sits at the given radius
fn flarePolyDist( d: vec2f ) -> f32 {
	let a = atan2( d.y, d.x ) + ${ f( ROT ) };
	return length( d ) * cos( floor( a / FLARE_SEG + 0.5 ) * FLARE_SEG - a );
}

// HDR flare light for this screen position (added before exposure / tone mapping)
fn flareLight( uv: vec2f ) -> vec3f {
	let asp = vec2f( flareParams.aspect, 1.0 );
	let p = ( uv - 0.5 ) * asp * vec2f( 1.0, -1.0 );
	let s = ( flareParams.sunUV - 0.5 ) * asp * vec2f( 1.0, -1.0 );
	let vis = flareVis[ 0 ];
	// light arriving from the sun disc (the key light colour follows the atmosphere's
	// transmittance; at night the moon is the key light and flares only faintly)
	let light = frame.sunColor * vis * flareParams.strength * 0.02;
	if ( vis <= 0.0 ) { return vec3f( 0.0 ); }

	var ghosts = vec3f( 0.0 );
${ ghosts }

	// fade the ghosts as the sun nears the centre (they collapse onto it and vanish)
	let offAxis = smoothstep( 0.02, 0.2, length( s ) );

	// halo: dispersive ring about the image centre
	let rc = length( p );
	let halo = vec3f( smoothstep( 0.03, 0.0, abs( rc - 0.43 ) ), smoothstep( 0.03, 0.0, abs( rc - 0.445 ) ), smoothstep( 0.03, 0.0, abs( rc - 0.46 ) ) ) * smoothstep( 0.25, 0.8, length( s ) ) * 0.12;

	// starburst and veiling glare around the sun (distances in image heights)
	let q = p - s;
	let rq = max( length( q ), 1e-4 );
	let aq = atan2( q.y, q.x ) + ${ f( ROT ) };
	let px = 1.0 / max( frame.outputResolution.y, 1.0 );
	// the nearest spike (two per blade) and this pixel's distance from its line
	let seg = ${ f( Math.PI / BLADES ) };
	let k = floor( aq / seg + 0.5 );
	let perp = abs( sin( aq - k * seg ) ) * rq;
	let ki = k - ${ f( 2 * BLADES ) } * floor( k / ${ f( 2 * BLADES ) } ); // same spike across the atan2 seam
	let h1 = fract( sin( ki * 12.9898 + 4.1 ) * 43758.5453 );
	let h2 = fract( sin( ki * 78.233 + 1.7 ) * 43758.5453 );
	// thin at the disc, a little softer outward (same energy across the line: dimmer as it widens)
	let width = px * 0.8 + rq * 0.003;
	let line = exp( - ( perp * perp ) / ( width * width ) ) * ( px * 0.8 / width );
	let len = 0.05 + 0.08 * h1;
	let lenC = vec3f( len * 1.12, len, len * 0.88 );
	let taper = exp( - rq / lenC - ( rq * rq ) / ( lenC * lenC * 4.0 ) );
	let spikes = line * taper * ( 0.45 + 0.55 * h2 ) * 1.4;
	// fine streaks around the disc: smooth angular noise, short
	let t = ( aq * ${ f( 1 / ( 2 * Math.PI ) ) } + 0.5 ) * 48.0;
	let ti = floor( t );
	let hA = fract( sin( ( ti - 48.0 * floor( ti / 48.0 ) ) * 91.345 ) * 43758.5453 );
	let hB = fract( sin( ( ti + 1.0 - 48.0 * floor( ( ti + 1.0 ) / 48.0 ) ) * 91.345 ) * 43758.5453 );
	let n = mix( hA, hB, smoothstep( 0.0, 1.0, t - ti ) );
	let fine = pow( n, 5.0 ) * exp( - rq / 0.03 ) * 0.3;
	let glow = exp( rq * -5.0 ) * 0.05 + exp( rq * -40.0 ) * 0.4;
	let burst = spikes + vec3f( fine + glow );

	return light * ( ghosts * offAxis + halo + burst );
}
`,
		} );

	}

	// per frame, before the post chain: sun position on screen and whether it can flare
	update( camera, dt, { aboveWater = true } = {} ) {

		const d = this.uniforms.fields.sunDir.value.copy( this.sunDir.value || this.sunDir );
		camera.updateMatrixWorld();
		const v = _v.copy( camera.position ).addScaledVector( d, 1000 ).project( camera );
		const ahead = _f.set( 0, 0, - 1 ).applyQuaternion( camera.quaternion ).dot( d ) > 0.05;
		this.sunUV.value.set( v.x * 0.5 + 0.5, 0.5 - v.y * 0.5 );
		// fade out over the last 5% before the frame edge (no pop when the sun leaves the view)
		const edge = Math.max( Math.abs( v.x ), Math.abs( v.y ) );
		this.inView.value = ahead ? MathUtils.clamp( ( 1.0 - edge ) / 0.1, 0, 1 ) : 0;
		this.aboveWater.value = aboveWater ? 1 : 0;
		this.aspect.value = camera.aspect;
		this.dt.value = Math.min( dt, 0.1 );
		// sun disc radius (0.265°) in pixels of the depth buffer
		const h = this._depthH || 1080;
		this.discPx.value = Math.max( 1.5, 0.004625 / Math.tan( MathUtils.degToRad( camera.fov ) * 0.5 ) * h * 0.5 );

	}

	setDepthHeight( h ) {

		this._depthH = h;

	}

}

const _v = new Vector3();
const _f = new Vector3();
