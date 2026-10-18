import { Texture, ComputeKernel, generateMipmaps } from '../engine/webgpu.js';

// Tileable procedural foam, generated once on the GPU.
//
// Real sea foam is an irregular bubbly mat: dense rafts with ragged edges, holes of every size,
// thin bubble streaks, and fine bubbles. Thresholding this density field against the local foam
// coverage (in the water shader) makes foam grow, tear into lace and dissolve naturally.
//   R: foam density field (thresholded by coverage)
//   G: fine bubble detail (brightness / normal variation)
//   B: soft large-scale mottling
//   A: streaks
// Sample it with smpAnisoRepeat / smpLinearRepeat (mipmapped rgba16float).
export function createFoamTexture( renderer, size = 1024 ) {

	const tex = new Texture( {
		label: 'foamPattern', width: size, height: size, format: 'rgba16float', mips: true,
		usage: [ 'sample', 'storage', 'copyDst' ], sampler: 'anisoRepeat',
	} );

	// fbm( uv, base, oct ) unrolled like the TSL version (constant octave weights)
	const fbm = ( uv, base, oct ) => {

		let s = '', a = 0.5, n = 0;
		for ( let o = 0; o < oct; o ++ ) {

			s += `${ s ? ' + ' : '' }vnoise( ${ uv }, ${ ( base * Math.pow( 2, o ) ).toFixed( 1 ) } ) * ${ a }`;
			n += a;
			a *= 0.5;

		}

		return `( ( ${ s } ) / ${ n } )`;

	};

	const kernel = new ComputeKernel( {
		label: 'Foam Pattern',
		bindings: { foamOut: { storageTexture: tex, access: 'write', view: { dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 } } },
		workgroupSize: [ 8, 8, 1 ],
		code: /* wgsl */`
fn hash2( p: vec2f ) -> vec2f { return fract( sin( vec2f( dot( p, vec2f( 127.1, 311.7 ) ), dot( p, vec2f( 269.5, 183.3 ) ) ) ) * 43758.5453 ); }
// GLSL-style mod (TSL .mod): x - y * floor( x / y )
fn fmod2( x: vec2f, y: f32 ) -> vec2f { return x - y * floor( x / y ); }

// periodic worley F1 with jittered cell sizes
fn worley( uv: vec2f, cells: f32 ) -> f32 {
	let p = uv * cells;
	let ip = floor( p );
	let fp = fract( p );
	var f1 = 8.0;
	for ( var j = -1; j <= 1; j++ ) {
		for ( var i = -1; i <= 1; i++ ) {
			let o = vec2f( f32( i ), f32( j ) );
			let cell = fmod2( ip + o, cells );
			let h = hash2( cell );
			let d = length( o + h - fp );
			f1 = min( f1, d );
		}
	}
	return f1;
}

fn vnoise( uv: vec2f, cells: f32 ) -> f32 {
	let p = uv * cells;
	let i = floor( p );
	let f = fract( p );
	let u = f * f * ( 3.0 - f * 2.0 );
	let a = hash2( fmod2( i, cells ) ).x;
	let b = hash2( fmod2( i + vec2f( 1.0, 0.0 ), cells ) ).x;
	let c = hash2( fmod2( i + vec2f( 0.0, 1.0 ), cells ) ).x;
	let d = hash2( fmod2( i + vec2f( 1.0, 1.0 ), cells ) ).x;
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let px = gid.xy;
	let uv = ( vec2f( px ) + 0.5 ) / ${ size }.0;

	// domain warp (organic, flowing shapes)
	let w1 = ( vec2f( ${ fbm( 'uv', 3, 4 ) }, ${ fbm( '( uv + 0.43 )', 3, 4 ) } ) - 0.5 ) * 0.14;
	let wuv = uv + w1;

	// density: ragged rafts
	let dens = ${ fbm( 'wuv', 4, 6 ) };

	// holes of many sizes punched through the mat (worley, radius varied by noise)
	let holeA = smoothstep( 0.28, 0.12, worley( wuv, 7.0 ) + ( ${ fbm( 'uv', 16, 3 ) } - 0.5 ) * 0.25 );
	let holeB = smoothstep( 0.30, 0.16, worley( wuv + 0.17, 19.0 ) + ( ${ fbm( 'uv', 32, 2 ) } - 0.5 ) * 0.3 );
	let holeC = smoothstep( 0.32, 0.18, worley( wuv + 0.61, 47.0 ) );
	let holes = clamp( holeA * 0.9 + holeB * 0.7 + holeC * 0.45, 0.0, 1.0 );

	// fine bubbles: small bright dots
	let bub = smoothstep( 0.24, 0.08, worley( uv + 0.33, 140.0 ) ) * 0.8 + smoothstep( 0.2, 0.05, worley( uv + 0.71, 260.0 ) ) * 0.5;

	// streaks (drawn out by flow)
	let suv = vec2f( uv.x * 1.0, uv.y * 1.0 ) + w1 * 2.0;
	let streak = ${ fbm( 'suv', 12, 4 ) };

	let foam = clamp( dens * 1.35 - holes * 0.55 + bub * 0.08, 0.0, 1.0 );
	let mottle = ${ fbm( 'uv', 2, 3 ) };

	textureStore( foamOut, px, vec4f( foam, clamp( bub, 0.0, 1.0 ), mottle, streak ) );
}`,
	} );

	kernel.dispatch( [ size / 8, size / 8, 1 ] );
	generateMipmaps( tex );
	return tex;

}
