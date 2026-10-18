import { Vector2 } from '../engine/math/index.js';
import { toHalfFloat } from '../engine/math/DataUtils.js';
import { Texture, UniformBlock, ShaderModule, commonModule } from '../engine/webgpu.js';
import { G } from '../engine/render/Frame.js';
import { mulberry32 } from '../util/Noise.js';

// Large-scale variation of the sea surface in world space (never repeats with the FFT tiles):
//  - gusts ("cat's paws"): patches of rougher water drifting downwind. Rough water reflects less
//    of the bright horizon sky, so from a low viewpoint gusts read as irregular dark patches.
//  - slicks: long calm bands along the wind (surfactant films) where capillary waves are damped;
//    mirror-like and bright, mostly in light to moderate wind.
//  - windrows: thin wavy foam lines along the wind in fresh wind (Langmuir circulation).
//
// WGSL (this.module, prefix seaDetail):
//   struct SeaDetailSample { rough: f32, gust: f32, slick: f32, streak: f32 }
//   fn seaDetailSample( xz: vec2f ) -> SeaDetailSample
//     rough: short-wave slope multiplier, gust 0..1, slick 0..1, streak 0..1
export class SeaDetail {

	constructor( size = 256 ) {

		this.texture = makeNoiseTexture( size );
		this.size = size;
		// hardware bilinear through the shared repeat sampler (group 0). The noise is smooth and low
		// frequency, so no mipmaps are needed.
		this.uniforms = new UniformBlock( 'SeaDetailParams', {
			offset: [ 'vec2f', new Vector2() ], // accumulated wind drift (m)
			gustAmount: [ 'f32', 1 ],
			slickAmount: [ 'f32', 1 ],
			streakAmount: [ 'f32', 0.3 ],
		} );
		const F = this.uniforms.fields;
		this.gustAmount = F.gustAmount;
		this.slickAmount = F.slickAmount;
		this.streakAmount = F.streakAmount;
		this.offset = F.offset;

		this.module = new ShaderModule( {
			name: 'seaDetail',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			bindings: { seaDetailNoise: { texture: this.texture } },
			code: /* wgsl */`
struct SeaDetailSample { rough: f32, gust: f32, slick: f32, streak: f32 };

// hardware bilinear, repeat-wrapped (the shared sampler: no binding of its own)
fn seaDetailLoad( uv: vec2f ) -> vec4f {
	return textureSampleLevel( seaDetailNoise, smpLinearRepeat, uv, 0.0 );
}

fn seaDetailSample( xz: vec2f ) -> SeaDetailSample {
	let p = xz - seaDetailParams.offset;

	// gusts: two octaves (~600 m and ~230 m features), the second slowly morphing
	let g1 = seaDetailLoad( p / 620.0 ).x;
	let g2 = seaDetailLoad( p / 230.0 + vec2f( frame.time * 0.0009, 0.37 ) ).y;
	let gustRaw = g1 * 0.62 + g2 * 0.38;
	let gust = sat( ( gustRaw - 0.5 ) * 2.4 * seaDetailParams.gustAmount + 0.5 );

	// wind-aligned frame, lightly domain-warped so bands meander
	let w = frame.windDir;
	let along = dot( xz, w );
	let across = dot( xz, vec2f( - w.y, w.x ) ) + ( g2 - 0.5 ) * 26.0;

	// slicks: long bands, strongest in light wind, torn apart by gusts
	let sl = seaDetailLoad( vec2f( along / 1100.0, across / 70.0 ) ).z;
	let calmWind = smoothstep( 13.0, 4.0, frame.windSpeed );
	let slick = smoothstep( 0.64, 0.76, sl ) * ( 1.0 - gust * 0.8 ) * calmWind * seaDetailParams.slickAmount;

	// windrows: thin foam lines ~10 m apart that come and go along their length
	let st = seaDetailLoad( vec2f( along / 380.0, across / 11.0 ) + vec2f( 0.13, 0.71 ) ).w;
	let breakUp = seaDetailLoad( vec2f( along / 140.0, across / 40.0 ) + vec2f( 0.51, 0.29 ) ).x;
	let freshWind = smoothstep( 6.0, 12.0, frame.windSpeed );
	let streak = smoothstep( 0.68, 0.82, st ) * smoothstep( 0.4, 0.62, breakUp ) * freshWind * seaDetailParams.streakAmount;

	// windrows show mostly as smooth lanes (surfactant and debris collect in the convergence lines
	// and damp the ripples), with only a trace of foam
	let rough = mix( 0.5, 1.5, gust ) * ( 1.0 - slick * 0.8 ) * ( 1.0 - streak / max( seaDetailParams.streakAmount, 1e-3 ) * 0.45 );
	return SeaDetailSample( rough, gust, slick, streak );
}
`,
		} );

	}

	update( dt ) {

		// gust patterns travel with the wind at roughly its speed near the surface
		const w = G.windDir.value, s = G.windSpeed.value * 0.7 * dt;
		this.offset.value.x += w.x * s;
		this.offset.value.y += w.y * s;

	}

}

// Tileable smooth fbm in 4 channels (different seeds / base frequencies).
function makeNoiseTexture( size ) {

	const data = new Uint16Array( size * size * 4 );
	const channels = [
		{ seed: 11, freq: 4, oct: 4 },
		{ seed: 23, freq: 5, oct: 4 },
		{ seed: 37, freq: 4, oct: 3 },
		{ seed: 53, freq: 6, oct: 3 },
	];

	for ( let c = 0; c < 4; c ++ ) {

		const { seed, freq, oct } = channels[ c ];
		const rand = mulberry32( seed );
		// gradient tables per octave (periodic lattice)
		const tables = [];
		for ( let o = 0; o < oct; o ++ ) {

			const n = freq << o;
			const g = new Float32Array( n * n * 2 );
			for ( let i = 0; i < n * n; i ++ ) {

				const a = rand() * Math.PI * 2;
				g[ i * 2 ] = Math.cos( a );
				g[ i * 2 + 1 ] = Math.sin( a );

			}

			tables.push( { n, g } );

		}

		let mn = Infinity, mx = - Infinity;
		const vals = new Float32Array( size * size );
		for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {

			let v = 0, amp = 1, norm = 0;
			for ( let o = 0; o < oct; o ++ ) {

				const { n, g } = tables[ o ];
				const fx = x / size * n, fy = y / size * n;
				const xi = Math.floor( fx ), yi = Math.floor( fy );
				const xf = fx - xi, yf = fy - yi;
				const grad = ( ix, iy, dx, dy ) => {

					const k = ( ( ( iy % n ) + n ) % n ) * n + ( ( ( ix % n ) + n ) % n );
					return g[ k * 2 ] * dx + g[ k * 2 + 1 ] * dy;

				};

				const u = xf * xf * xf * ( xf * ( xf * 6 - 15 ) + 10 );
				const w = yf * yf * yf * ( yf * ( yf * 6 - 15 ) + 10 );
				const a0 = grad( xi, yi, xf, yf ), a1 = grad( xi + 1, yi, xf - 1, yf );
				const b0 = grad( xi, yi + 1, xf, yf - 1 ), b1 = grad( xi + 1, yi + 1, xf - 1, yf - 1 );
				const nv = ( a0 + ( a1 - a0 ) * u ) + ( ( b0 + ( b1 - b0 ) * u ) - ( a0 + ( a1 - a0 ) * u ) ) * w;
				v += nv * amp;
				norm += amp;
				amp *= 0.5;

			}

			v /= norm;
			vals[ y * size + x ] = v;
			mn = Math.min( mn, v );
			mx = Math.max( mx, v );

		}

		for ( let i = 0; i < size * size; i ++ ) data[ i * 4 + c ] = toHalfFloat( ( vals[ i ] - mn ) / ( mx - mn ) );

	}

	// no mips: sampled at level 0 with the shared linear repeat sampler
	return new Texture( { label: 'seaDetailNoise', width: size, height: size, format: 'rgba16float', data, usage: [ 'sample', 'copyDst' ] } );

}
