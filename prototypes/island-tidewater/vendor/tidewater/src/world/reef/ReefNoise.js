import { Texture } from '../../engine/gpu/Texture.js';
import { mulberry32 } from '../../util/Noise.js';

// Tileable 3D gradient noise in a small RGBA8 volume: four independent noise channels with
// `cells` noise cells across the tile (size / cells texels per cell), sampled with trilinear
// filtering and repeat wrapping. One fetch returns four noise values, far cheaper than
// evaluating procedural noise per pixel. The noise is band-limited (features span several
// texels), so sampling it minified doesn't alias as long as the features stay larger than a
// pixel, which the materials ensure by fading detail with the pixel footprint.
//
// Stored as v * 0.55 + 0.5 (v: unit-gradient Perlin noise, |v| < 0.87); NOISE_SCALE maps a
// fetched value back to about the range of MaterialX noise: ( s - 0.5 ) * NOISE_SCALE.
export const NOISE_SCALE = 2.55;

export function createNoiseVolume( size = 64, cells = 8, seed = 90210 ) {

	const rng = mulberry32( seed );
	const n = cells, n3 = n * n * n;
	const data = new Uint8Array( size * size * size * 4 );
	const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );
	// per-axis interpolation tables (the same for x, y and z)
	const i0 = new Int32Array( size ), i1 = new Int32Array( size ), fr = new Float32Array( size ), fw = new Float32Array( size );
	for ( let x = 0; x < size; x ++ ) {

		const p = ( x + 0.5 ) * n / size;
		const i = Math.floor( p );
		i0[ x ] = i % n;
		i1[ x ] = ( i + 1 ) % n;
		fr[ x ] = p - i;
		fw[ x ] = fade( p - i );

	}

	const gx = new Float32Array( n3 ), gy = new Float32Array( n3 ), gz = new Float32Array( n3 );
	for ( let ch = 0; ch < 4; ch ++ ) {

		for ( let k = 0; k < n3; k ++ ) {

			// random unit gradient
			const z = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt( 1 - z * z );
			gx[ k ] = r * Math.cos( a );
			gy[ k ] = r * Math.sin( a );
			gz[ k ] = z;

		}

		const dot = ( ix, iy, iz, x, y, z ) => {

			const k = ( iz * n + iy ) * n + ix;
			return gx[ k ] * x + gy[ k ] * y + gz[ k ] * z;

		};

		for ( let z = 0; z < size; z ++ ) {

			const z0 = i0[ z ], z1 = i1[ z ], fz = fr[ z ], wz = fw[ z ];
			for ( let y = 0; y < size; y ++ ) {

				const y0 = i0[ y ], y1 = i1[ y ], fy = fr[ y ], wy = fw[ y ];
				for ( let x = 0; x < size; x ++ ) {

					const x0 = i0[ x ], x1 = i1[ x ], fx = fr[ x ], wx = fw[ x ];
					const a = dot( x0, y0, z0, fx, fy, fz ), b = dot( x1, y0, z0, fx - 1, fy, fz );
					const c = dot( x0, y1, z0, fx, fy - 1, fz ), d = dot( x1, y1, z0, fx - 1, fy - 1, fz );
					const e = dot( x0, y0, z1, fx, fy, fz - 1 ), f = dot( x1, y0, z1, fx - 1, fy, fz - 1 );
					const g = dot( x0, y1, z1, fx, fy - 1, fz - 1 ), h = dot( x1, y1, z1, fx - 1, fy - 1, fz - 1 );
					const ab = a + ( b - a ) * wx, cd = c + ( d - c ) * wx, ef = e + ( f - e ) * wx, gh = g + ( h - g ) * wx;
					const lo = ab + ( cd - ab ) * wy, hi = ef + ( gh - ef ) * wy;
					const v = lo + ( hi - lo ) * wz;
					data[ ( ( z * size + y ) * size + x ) * 4 + ch ] = Math.max( 0, Math.min( 255, Math.round( ( v * 0.55 + 0.5 ) * 255 ) ) );

				}

			}

		}

	}

	// sampled trilinear with repeat wrapping (the shared `smpLinearRepeat` sampler), no mipmaps
	const tex = new Texture( { label: 'reefNoise', width: size, height: size, depth: size, dimension: '3d', format: 'rgba8unorm', data, sampler: 'linearRepeat' } );
	return tex;

}
