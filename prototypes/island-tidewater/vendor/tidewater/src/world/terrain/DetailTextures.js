import { Texture } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { hash2 } from './TerrainNoise.js';

// Tileable procedural detail heights shared by the terrain and rock materials (RGBA8, mipmapped,
// repeat wrapping). One texture, four height fields:
//   R  rock:  fractured plates (warped Voronoi cracks) with chipped facets and grain
//   G  soil:  leaf litter / clumps / small stones
//   B  sand:  grains, shell grit and scattered pebbles
//   A  fbm:   smooth multi-octave noise (macro variation when sampled at large scales)
// Generated once on the CPU and cached.

const S = 512;

// periodic gradient noise over a P x P lattice (precomputed gradients), roughly [-1, 1]
function makeNoise( P, seed ) {

	const gx = new Float32Array( P * P ), gy = new Float32Array( P * P );
	for ( let j = 0; j < P; j ++ ) for ( let i = 0; i < P; i ++ ) {

		const a = hash2( i, j, seed ) * 6.2831853;
		gx[ j * P + i ] = Math.cos( a );
		gy[ j * P + i ] = Math.sin( a );

	}

	return ( x, y ) => {

		const xi = Math.floor( x ), yi = Math.floor( y );
		const xf = x - xi, yf = y - yi;
		const x0 = ( ( xi % P ) + P ) % P, y0 = ( ( yi % P ) + P ) % P;
		const x1 = x0 + 1 === P ? 0 : x0 + 1, y1 = y0 + 1 === P ? 0 : y0 + 1;
		const k00 = y0 * P + x0, k10 = y0 * P + x1, k01 = y1 * P + x0, k11 = y1 * P + x1;
		const a = gx[ k00 ] * xf + gy[ k00 ] * yf;
		const b = gx[ k10 ] * ( xf - 1 ) + gy[ k10 ] * yf;
		const c = gx[ k01 ] * xf + gy[ k01 ] * ( yf - 1 );
		const d = gx[ k11 ] * ( xf - 1 ) + gy[ k11 ] * ( yf - 1 );
		const u = xf * xf * xf * ( xf * ( xf * 6 - 15 ) + 10 );
		const v = yf * yf * yf * ( yf * ( yf * 6 - 15 ) + 10 );
		return ( a + ( b - a ) * u + ( c - a + ( a - b - c + d ) * u ) * v ) * 1.414;

	};

}

function makeFbm( P, octaves, seed ) {

	const oct = [];
	for ( let o = 0; o < octaves; o ++ ) oct.push( makeNoise( P << o, seed + o * 17 ) );
	return ( x, y ) => {

		let s = 0, amp = 1, norm = 0, f = 1;
		for ( let o = 0; o < octaves; o ++ ) {

			s += oct[ o ]( x * f, y * f ) * amp;
			norm += amp;
			amp *= 0.5;
			f *= 2;

		}

		return s / norm;

	};

}

// periodic Voronoi over P x P cells. Feature points are stored with a 2-cell apron so the
// search never wraps indices; the 5x5 search (R = 2) makes F2 exact, R = 1 is enough for F1.
function makeWorley( P, seed ) {

	const Q = P + 4;
	const px = new Float32Array( Q * Q ), py = new Float32Array( Q * Q ), pid = new Float32Array( Q * Q );
	for ( let j = 0; j < Q; j ++ ) for ( let i = 0; i < Q; i ++ ) {

		const wi = ( i - 2 + P ) % P, wj = ( j - 2 + P ) % P;
		px[ j * Q + i ] = hash2( wi, wj, seed ) + i - 2;
		py[ j * Q + i ] = hash2( wi, wj, seed + 1 ) + j - 2;
		pid[ j * Q + i ] = hash2( wi, wj, seed + 2 );

	}

	// f1: distance to the nearest site, edge: distance to the nearest cell border (exact, so
	// cracks keep a constant width even between two nearly coincident sites), id: cell hash
	const out = { f1: 0, edge: 0, id: 0 };
	return ( x, y, R = 2 ) => {

		// x, y in [0, P)
		const xi = Math.floor( x ), yi = Math.floor( y );
		let f1 = 99, id = 0, kn = 0;
		for ( let j = - 1; j <= 1; j ++ ) {

			const row = ( yi + j + 2 ) * Q + 2 + xi;
			for ( let i = - 1; i <= 1; i ++ ) {

				const k = row + i;
				const dx = px[ k ] - x, dy = py[ k ] - y;
				const d = dx * dx + dy * dy;
				if ( d < f1 ) {

					f1 = d; id = pid[ k ]; kn = k;

				}

			}

		}

		let edge = 99;
		if ( R > 1 ) {

			const ax = px[ kn ], ay = py[ kn ];
			for ( let j = - 2; j <= 2; j ++ ) {

				const row = ( yi + j + 2 ) * Q + 2 + xi;
				for ( let i = - 2; i <= 2; i ++ ) {

					const k = row + i;
					if ( k === kn ) continue;
					const bx = px[ k ], by = py[ k ];
					const ex = bx - ax, ey = by - ay;
					const el = Math.sqrt( ex * ex + ey * ey );
					const e = ( ( ax + bx ) * 0.5 - x ) * ex / el + ( ( ay + by ) * 0.5 - y ) * ey / el;
					if ( e < edge ) edge = e;

				}

			}

		}

		out.f1 = Math.sqrt( f1 ); out.edge = edge; out.id = id;
		out.dx = x - px[ kn ]; out.dy = y - py[ kn ];
		return out;

	};

}

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

let cached = null;

export function getDetailTexture() {

	if ( cached ) return cached;
	const t0 = performance.now();

	const warpA = makeFbm( 4, 2, 11 ), warpB = makeFbm( 4, 2, 23 );
	const rockCells = makeWorley( 7, 101 ), rockChips = makeWorley( 23, 211 );
	const rockGrain = makeFbm( 16, 3, 307 );
	const leafCells = makeWorley( 26, 401 ), stoneCells = makeWorley( 12, 601 );
	const soilFbm = makeFbm( 10, 3, 503 );
	const grainA = makeNoise( 180, 701 ), grainB = makeNoise( 90, 709 );
	const pebbles = makeWorley( 18, 801 );
	const macro = makeFbm( 4, 5, 907 );

	const data = new Uint8Array( S * S * 4 );
	for ( let j = 0; j < S; j ++ ) {

		const v = j / S;
		for ( let i = 0; i < S; i ++ ) {

			const u = i / S;
			const o = ( j * S + i ) * 4;

			// ---- rock: plates split by warped cracks, each plate offset, chipped edges, grain
			let wu = u + warpA( u * 4, v * 4 ) * 0.035, wv = v + warpB( u * 4, v * 4 ) * 0.035;
			wu -= Math.floor( wu );
			wv -= Math.floor( wv );
			// fractured faces: every block is a tilted facet (neighbours catch the light differently),
			// blocks are split into smaller chips. The per-cell tilt / offset fades to zero toward the
			// joints (bevelled edges) so the height stays continuous across cells: a step there would
			// light up as a bright line in the bump.
			let w = rockCells( wu * 7, wv * 7 );
			const ta = w.id * 40.0;
			const bevel = smooth( 0.0, 0.2, w.edge );
			const facet = ( ( w.dx * Math.cos( ta ) + w.dy * Math.sin( ta ) ) * 0.5 + ( w.id - 0.5 ) * 0.22 ) * bevel;
			// joints: soft grooves, deeper for some blocks
			const joint = smooth( 0.0, 0.1 + 0.08 * w.id, w.edge );
			const chips = rockChips( wu * 23, wv * 23, 2 );
			const tb = chips.id * 40.0;
			const chipB = smooth( 0.0, 0.14, chips.edge );
			const chip = ( ( chips.dx * Math.cos( tb ) + chips.dy * Math.sin( tb ) ) * 0.22 + ( chips.id - 0.5 ) * 0.1 ) * chipB;
			const rg = rockGrain( u * 16, v * 16 );
			let r = ( 0.45 + facet + chip * 0.6 + 0.16 * rg ) * ( 0.66 + 0.34 * joint ) * ( 0.94 + 0.06 * chipB );

			// ---- soil / litter: flat leaf blobs, clumps and a few stones
			w = leafCells( u * 26, v * 26, 1 );
			const leaf = w.id < 0.6 ? ( 1 - smooth( 0.1 + 0.15 * w.id, 0.45, w.f1 ) ) * ( 0.4 + 0.6 * w.id ) : 0;
			const clump = soilFbm( u * 10, v * 10 );
			const st = stoneCells( u * 12, v * 12, 1 );
			const stone = st.id < 0.15 ? ( 1 - smooth( 0.06, 0.28, st.f1 ) ) : 0;
			let g = 0.34 + 0.3 * clump + 0.26 * leaf + 0.45 * stone;

			// ---- sand: fine grains, grit and sparse pebbles
			const grain = grainA( u * 180, v * 180 ) * 0.55 + grainB( u * 90, v * 90 ) * 0.45;
			const pw = pebbles( u * 18, v * 18, 1 );
			const pebble = pw.id < 0.2 ? Math.max( 0, 1 - ( pw.f1 / ( 0.14 + 0.12 * pw.id * 5 ) ) ** 2 ) : 0;
			let b = 0.45 + 0.2 * grain + 0.5 * Math.sqrt( pebble );

			// ---- generic fbm
			let a = 0.5 + 0.55 * macro( u * 4, v * 4 );

			r = r < 0 ? 0 : r > 1 ? 1 : r;
			g = g < 0 ? 0 : g > 1 ? 1 : g;
			b = b < 0 ? 0 : b > 1 ? 1 : b;
			a = a < 0 ? 0 : a > 1 ? 1 : a;
			data[ o ] = r * 255; data[ o + 1 ] = g * 255; data[ o + 2 ] = b * 255; data[ o + 3 ] = a * 255;

		}

	}

	// repeat wrapping + trilinear / anisotropic filtering come from the shared samplers
	// (smpAniso4Repeat: grazing views of the beach, anisotropy 4 as before; smpLinearRepeat elsewhere)
	const tex = new Texture( { label: 'terrainDetail', width: S, height: S, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'aniso4Repeat', data } );
	tex.getGPU();
	generateMipmaps( tex );
	tex.userData = {};
	// CPU copy for placement code sampling the same fbm (vegetation Scatter.js, three's DataTexture.image)
	tex.image = { width: S, height: S, data };
	tex.userData.ms = performance.now() - t0;
	cached = tex;
	return tex;

}
