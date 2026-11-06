// Adapted from Tidewater src/ocean/SurfFoam.js at 4811ba48.
// Copyright (c) 2026 DRG Software Solutions LLC. MIT; see THIRD_PARTY_NOTICES.txt.
// CPU-only asset bake; runtime uploads the mipmapped RGBA field.
import {writeFileSync} from "node:fs";
function laceData( size ) {

	const data = new Uint8Array( size * size * 4 );
	const hash = ( x, y, s ) => {

		let h = ( x * 374761393 + y * 668265263 + s * 2246822519 ) | 0;
		h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
		h ^= h >>> 16;
		return ( h >>> 0 ) / 4294967296;

	};

	const vnoise = ( x, y, n, s ) => {

		const i = Math.floor( x ), j = Math.floor( y );
		const fx = x - i, fy = y - j;
		const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy );
		const w = ( a ) => ( ( a % n ) + n ) % n;
		const a = hash( w( i ), w( j ), s ), b = hash( w( i + 1 ), w( j ), s );
		const c = hash( w( i ), w( j + 1 ), s ), d = hash( w( i + 1 ), w( j + 1 ), s );
		return ( a * ( 1 - ux ) + b * ux ) * ( 1 - uy ) + ( c * ( 1 - ux ) + d * ux ) * uy;

	};

	const fbm = ( x, y, n, s, oct = 3 ) => {

		let v = 0, a = 0.5, t = 0;
		for ( let o = 0; o < oct; o ++ ) {

			v += vnoise( x * ( 1 << o ), y * ( 1 << o ), n * ( 1 << o ), s + o * 17 ) * a;
			t += a;
			a *= 0.5;

		}

		return v / t;

	};

	// Voronoi F1, F2 and nearest cell id on an n x n periodic jittered grid (coordinates in cells)
	const voronoi = ( x, y, n, s ) => {

		const i = Math.floor( x ), j = Math.floor( y );
		let f1 = 9, f2 = 9, id = 0;
		for ( let dj = - 1; dj <= 1; dj ++ ) for ( let di = - 1; di <= 1; di ++ ) {

			const ci = i + di, cj = j + dj;
			const wi = ( ( ci % n ) + n ) % n, wj = ( ( cj % n ) + n ) % n;
			const px = ci + 0.15 + 0.7 * hash( wi, wj, s ), py = cj + 0.15 + 0.7 * hash( wi, wj, s + 1 );
			const d = Math.hypot( px - x, py - y );
			if ( d < f1 ) {

				f2 = f1; f1 = d; id = hash( wi, wj, s + 2 );

			} else if ( d < f2 ) f2 = d;

		}

		return [ f1, f2, id ];

	};

	const sstep = ( a, b, x ) => {

		const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
		return t * t * ( 3 - 2 * t );

	};

	// pass 1: warped coordinates and the contour noise at every texel
	const N = size * size;
	const UU = new Float32Array( N ), VV = new Float32Array( N ), NC = new Float32Array( N );
	for ( let py = 0; py < size; py ++ ) for ( let px = 0; px < size; px ++ ) {

		const u = ( px + 0.5 ) / size, v = ( py + 0.5 ) / size;
		// two-level domain warp: organic, curvy strands
		const w1x = ( fbm( u * 3, v * 3, 3, 3 ) - 0.5 ) * 0.16, w1y = ( fbm( u * 3 + 5.2, v * 3 + 1.3, 3, 7 ) - 0.5 ) * 0.16;
		const w2x = ( fbm( ( u + w1x ) * 9, ( v + w1y ) * 9, 9, 13 ) - 0.5 ) * 0.07, w2y = ( fbm( ( u + w1x ) * 9 + 2.7, ( v + w1y ) * 9, 9, 17 ) - 0.5 ) * 0.07;
		const k = py * size + px;
		UU[ k ] = u + w1x + w2x;
		VV[ k ] = v + w1y + w2y;
		NC[ k ] = fbm( UU[ k ] * 6, VV[ k ] * 6, 6, 91, 3 );

	}

	// pass 2: distance to the nearest strand
	const N1 = 16, half = 0.5 / N1;
	const D = new Float32Array( N );
	for ( let py = 0; py < size; py ++ ) for ( let px = 0; px < size; px ++ ) {

		const u = ( px + 0.5 ) / size, v = ( py + 0.5 ) / size;
		const k = py * size + px;
		const uu = UU[ k ], vv = VV[ k ];
		// strands 1: edges of a warped cell network (distance to the edge ~ (F2 - F1) / 2, in cells)
		const [ a1, b1, id1 ] = voronoi( uu * N1, vv * N1, N1, 11 );
		const dCells = ( b1 - a1 ) * 0.5 / N1;
		// strands 2: contour loops of the warped noise; distance ~ |n - c| / |grad n| (texture units)
		const n1 = NC[ k ];
		const xl = ( px + size - 1 ) % size, xr = ( px + 1 ) % size, yd = ( py + size - 1 ) % size, yu = ( py + 1 ) % size;
		const gx = ( NC[ py * size + xr ] - NC[ py * size + xl ] ) * size * 0.5;
		const gy = ( NC[ yu * size + px ] - NC[ yd * size + px ] ) * size * 0.5;
		const g = Math.max( Math.hypot( gx, gy ), 0.5 );
		const dLoops = Math.min( Math.abs( n1 - 0.5 ), Math.abs( n1 - 0.36 ), Math.abs( n1 - 0.64 ) ) / g;
		// normalised by half a cell: 0 on a strand, ~1 in the middle of a hole. Irregular hole edges
		// (fine noise) and places where the strands break up (gaps).
		const hi = fbm( u * 24, v * 24, 24, 5, 2 );
		const gap = sstep( 0.52, 0.36, fbm( u * 10 + 3.1, v * 10, 10, 31 ) );
		const d = Math.min( dCells * 1.35 + 0.004, dLoops ) / half * ( 0.75 + 0.5 * hi ) + gap * 0.22;
		const mott = fbm( u * 3, v * 3, 3, 71, 4 );
		// bubbles: small dots, clustered near the strands
		const N3 = 120;
		const [ a3, , id3 ] = voronoi( u * N3, v * N3, N3, 61 );
		const rad = 0.1 + 0.22 * id3;
		const dot = sstep( rad, rad * 0.35, a3 ) * ( id3 > 0.45 ? 1 : 0 );
		const bub = dot * ( 0.25 + 0.75 * sstep( 0.5, 0.1, d ) );
		D[ k ] = Math.min( 1, d );
		data[ k * 4 + 1 ] = Math.round( Math.min( 1, bub ) * 255 );
		data[ k * 4 + 2 ] = Math.round( mott * 255 );
		data[ k * 4 + 3 ] = Math.round( id1 * 255 );

	}

	// pass 3: rounded holes: blurred distance inside the holes, the exact one near the strands
	const D0 = new Float32Array( D );
	const T = new Float32Array( N );
	for ( let it = 0; it < 2; it ++ ) {

		for ( let py = 0; py < size; py ++ ) for ( let px = 0; px < size; px ++ ) {

			let s = 0;
			for ( let o = - 2; o <= 2; o ++ ) s += D[ py * size + ( ( px + o + size ) % size ) ];
			T[ py * size + px ] = s / 5;

		}

		for ( let py = 0; py < size; py ++ ) for ( let px = 0; px < size; px ++ ) {

			let s = 0;
			for ( let o = - 2; o <= 2; o ++ ) s += T[ ( ( py + o + size ) % size ) * size + px ];
			D[ py * size + px ] = s / 5;

		}

	}

	for ( let k = 0; k < N; k ++ ) data[ k * 4 ] = Math.round( ( D0[ k ] + ( D[ k ] - D0[ k ] ) * sstep( 0.12, 0.45, D0[ k ] ) ) * 255 );
	return data;

}

const data=laceData(512);writeFileSync(new URL("../public/assets/surf-lace.bin",import.meta.url),data);console.log(`surf lace: ${data.length} bytes`);
