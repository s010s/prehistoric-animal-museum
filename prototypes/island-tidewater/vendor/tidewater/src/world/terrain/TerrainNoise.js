// Fast CPU helpers for terrain generation: integer hashes, sin/cos, slope-aligned erosion
// noise, separable resampling and blurs over Float32Array grids.

// integer lattice hash -> [0, 1)
export function hash2( i, j, s ) {

	let h = Math.imul( i, 374761393 ) + Math.imul( j, 668265263 ) + Math.imul( s, 1274126177 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}

// 0 below 0, quadratic fillet up to 2k, then linear (x - k)
export const softRamp = ( x, k ) => x <= 0 ? 0 : x < 2 * k ? x * x / ( 4 * k ) : x - k;

const TAU = Math.PI * 2;
const _sc = new Float64Array( 2 );

// cos / sin with ~1e-4 absolute error (range reduced polynomial), result in _sc
function sincos( a ) {

	a -= TAU * Math.round( a / TAU ); // [-pi, pi]
	// cos via even polynomial on [-pi, pi] using half angle: cos a = 1 - 2 sin^2(a/2)
	const h = a * 0.5; // [-pi/2, pi/2]
	const h2 = h * h;
	// sin(h) minimax-ish (Taylor to h^9 is accurate to 4e-6 on [-pi/2, pi/2])
	const s = h * ( 1 - h2 * ( 1 / 6 - h2 * ( 1 / 120 - h2 * ( 1 / 5040 - h2 / 362880 ) ) ) );
	const c = 1 - h2 * ( 0.5 - h2 * ( 1 / 24 - h2 * ( 1 / 720 - h2 / 40320 ) ) );
	_sc[ 0 ] = 1 - 2 * s * s; // cos a
	_sc[ 1 ] = 2 * s * c; // sin a

}

// Slope-aligned gully noise (after Clay John's "eroded terrain noise"). Each octave sums
// windowed plane waves oriented along the local fall line; the gradient of the octaves so far
// bends the next ones so the gullies branch. Returns a zero-mean relief offset in meters.
//   gx, gz: slope of the terrain being eroded (dh/dx, dh/dz)
export const EROSION = { octaves: 5, cell: 160, amp: 36, gain: 0.5, lac: 2, slope: 1.1, branch: 1.0, maxSlope: 0.9 };

export function erosionNoise( x, z, gx, gz, octaves = EROSION.octaves, cell0 = EROSION.cell, amp0 = EROSION.amp ) {

	let h = 0, hx = 0, hz = 0;
	let a = amp0, cs = cell0;
	const R2 = 1.5625; // kernel radius 1.25 cells -> a 3x3 neighbourhood is exact
	for ( let o = 0; o < octaves; o ++ ) {

		let sx = gx + hx * EROSION.branch, sz = gz + hz * EROSION.branch;
		const sl = Math.sqrt( sx * sx + sz * sz );
		if ( sl > EROSION.maxSlope ) {

			sx *= EROSION.maxSlope / sl; sz *= EROSION.maxSlope / sl;

		}

		// stripes vary along the contour direction -> they run downhill
		const dx = sz * EROSION.slope, dz = - sx * EROSION.slope;
		const px = x / cs, pz = z / cs;
		const ix = Math.floor( px ), iz = Math.floor( pz );
		const fx = px - ix, fz = pz - iz;
		let v = 0, vx = 0, vz = 0, wt = 0;
		for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) {

			const cx = ix + i, cz = iz + j;
			// feature point: cell centre +- 0.25
			const ox = fx - i - 0.25 - hash2( cx, cz, 11 + o ) * 0.5;
			const oz = fz - j - 0.25 - hash2( cx, cz, 57 + o ) * 0.5;
			const d2 = ox * ox + oz * oz;
			if ( d2 >= R2 ) continue;
			const q = 1 - d2 / R2;
			const w = q * q * q;
			sincos( ( ox * dx + oz * dz ) * TAU );
			v += _sc[ 0 ] * w;
			vx -= _sc[ 1 ] * dx * w;
			vz -= _sc[ 1 ] * dz * w;
			wt += w;

		}

		if ( wt > 1e-6 ) {

			v /= wt; vx /= wt; vz /= wt;

		} else v = 1;

		// subtract the expected value of the windowed waves for this frequency so the carving is
		// zero-mean: ridges rise above the envelope as much as the gullies cut below it
		const vm = Math.exp( - 3.4 * ( dx * dx + dz * dz ) );
		h += a * ( v - vm );
		hx += a * vx * TAU / cs;
		hz += a * vz * TAU / cs;
		a *= EROSION.gain;
		cs /= EROSION.lac;

	}

	return h * 0.5;

}

// bilinear sample of a grid whose texel centres are at o + (i + 0.5) * t
export function sampleGrid( g, n, o, t, x, z ) {

	let fx = ( x - o ) / t - 0.5, fz = ( z - o ) / t - 0.5;
	fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx;
	fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz;
	const i = fx | 0, j = fz | 0;
	const tx = fx - i, tz = fz - j;
	const k = j * n + i;
	return ( g[ k ] * ( 1 - tx ) + g[ k + 1 ] * tx ) * ( 1 - tz ) + ( g[ k + n ] * ( 1 - tx ) + g[ k + n + 1 ] * tx ) * tz;

}

// Upsample an n x n grid by 2 (texel centres aligned as in sampleGrid) with Catmull-Rom
// (interpolating) or bilinear filtering. Separable.
export function upsample2( src, n, cubic = true ) {

	const m = n * 2;
	const tmp = new Float32Array( m * n );
	const out = new Float32Array( m * m );
	// new texel centre i maps to source coordinate (i + 0.5) / 2 - 0.5 = i / 2 - 0.25
	// even i: frac 0.75 of (i/2 - 1), odd i: frac 0.25 of (i - 1) / 2
	const wc = cubic ? catmull : linear;
	const W0 = wc( 0.75 ), W1 = wc( 0.25 );
	const clampI = ( i ) => i < 0 ? 0 : i >= n ? n - 1 : i;
	for ( let j = 0; j < n; j ++ ) {

		const row = j * n;
		for ( let i = 0; i < m; i ++ ) {

			const base = ( i & 1 ) ? ( i - 1 ) >> 1 : ( i >> 1 ) - 1;
			const w = ( i & 1 ) ? W1 : W0;
			tmp[ j * m + i ] = src[ row + clampI( base - 1 ) ] * w[ 0 ] + src[ row + clampI( base ) ] * w[ 1 ] + src[ row + clampI( base + 1 ) ] * w[ 2 ] + src[ row + clampI( base + 2 ) ] * w[ 3 ];

		}

	}

	for ( let j = 0; j < m; j ++ ) {

		const base = ( j & 1 ) ? ( j - 1 ) >> 1 : ( j >> 1 ) - 1;
		const w = ( j & 1 ) ? W1 : W0;
		const r0 = clampI( base - 1 ) * m, r1 = clampI( base ) * m, r2 = clampI( base + 1 ) * m, r3 = clampI( base + 2 ) * m;
		const o = j * m;
		for ( let i = 0; i < m; i ++ ) {

			out[ o + i ] = tmp[ r0 + i ] * w[ 0 ] + tmp[ r1 + i ] * w[ 1 ] + tmp[ r2 + i ] * w[ 2 ] + tmp[ r3 + i ] * w[ 3 ];

		}

	}

	return out;

}

function catmull( t ) {

	const t2 = t * t, t3 = t2 * t;
	return [ - 0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, - 1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2 ];

}

function linear( t ) {

	return [ 0, 1 - t, t, 0 ];

}

// separable box blur (radius r texels), in place via a temp buffer
export function boxBlur( src, w, h, r, out = new Float32Array( w * h ) ) {

	const tmp = new Float32Array( w * h );
	const inv = 1 / ( 2 * r + 1 );
	for ( let j = 0; j < h; j ++ ) {

		const o = j * w;
		let acc = 0;
		for ( let k = - r; k <= r; k ++ ) acc += src[ o + Math.min( w - 1, Math.max( 0, k ) ) ];
		for ( let i = 0; i < w; i ++ ) {

			tmp[ o + i ] = acc * inv;
			acc += src[ o + Math.min( w - 1, i + r + 1 ) ] - src[ o + Math.max( 0, i - r ) ];

		}

	}

	for ( let i = 0; i < w; i ++ ) {

		let acc = 0;
		for ( let k = - r; k <= r; k ++ ) acc += tmp[ Math.min( h - 1, Math.max( 0, k ) ) * w + i ];
		for ( let j = 0; j < h; j ++ ) {

			out[ j * w + i ] = acc * inv;
			acc += tmp[ Math.min( h - 1, j + r + 1 ) * w + i ] - tmp[ Math.max( 0, j - r ) * w + i ];

		}

	}

	return out;

}
