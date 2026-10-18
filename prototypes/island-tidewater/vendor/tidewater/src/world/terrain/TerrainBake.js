import { DataUtils } from '../../engine/index.js';

// CPU bakes of the terrain maps sampled by the terrain material (and the water):
//   normal RGBA8: nx * 0.5 + 0.5, nz * 0.5 + 0.5, rock mask, ambient occlusion
//   splat  RGBA8: loose sand, worn paths / trampled ground, gullies (land) or seagrass
//                 meadows (seabed), coral rubble / rock heads on the seabed
// The ambient occlusion combines a horizon-based term (4 m grid, 8 directions, up to ~110 m)
// with a small-scale cavity term from the height Laplacian.

const AO_STEPS = [ 4, 8, 13, 19, 27, 38, 52, 72, 100 ];
const AO_DIRS = 8;

export function bakeTerrainMaps( terrain ) {

	const t0 = performance.now();
	const { res, heights: H, rock, texel, origin } = terrain;

	// ---- horizon AO on a coarse grid
	const F = 4; // texels per AO cell
	const N = res / F;
	const cell = texel * F;
	const hc = new Float32Array( N * N );
	for ( let j = 0; j < N; j ++ ) for ( let i = 0; i < N; i ++ ) {

		let s = 0;
		for ( let b = 0; b < F; b ++ ) {

			const row = ( j * F + b ) * res + i * F;
			for ( let a = 0; a < F; a ++ ) s += H[ row + a ];

		}

		hc[ j * N + i ] = s / ( F * F );

	}

	const ao = new Float32Array( N * N ).fill( 1 );
	const dirs = [];
	for ( let d = 0; d < AO_DIRS; d ++ ) {

		const a = ( d + 0.5 ) / AO_DIRS * Math.PI * 2;
		dirs.push( [ Math.cos( a ), Math.sin( a ) ] );

	}

	for ( let j = 1; j < N - 1; j ++ ) for ( let i = 1; i < N - 1; i ++ ) {

		const h0 = hc[ j * N + i ];
		if ( h0 < - 25 ) continue;
		let vis = 0;
		for ( let d = 0; d < AO_DIRS; d ++ ) {

			const [ dx, dz ] = dirs[ d ];
			let maxT = 0;
			for ( let s = 0; s < AO_STEPS.length; s ++ ) {

				const dist = AO_STEPS[ s ];
				const x = Math.round( i + dx * dist / cell ), z = Math.round( j + dz * dist / cell );
				if ( x < 0 || z < 0 || x >= N || z >= N ) break;
				const t = ( hc[ z * N + x ] - h0 - 0.3 ) / dist;
				if ( t > maxT ) maxT = t;

			}

			vis += 1 / ( 1 + maxT * maxT ); // cos^2 of the horizon elevation

		}

		ao[ j * N + i ] = vis / AO_DIRS;

	}

	const t1 = performance.now();

	// ---- per texel maps
	const normal = new Uint8Array( res * res * 4 );
	const splat = new Uint8Array( res * res * 4 );
	const sand = terrain.sand, path = terrain.path, gully = terrain.gully;
	const seagrass = terrain.seagrass, rubble = terrain.rubble, scarp = terrain.scarp;
	const inv2t = 1 / ( 2 * texel );
	for ( let j = 0; j < res; j ++ ) {

		const jm = j > 0 ? j - 1 : 0, jp = j < res - 1 ? j + 1 : res - 1;
		const j2m = j > 1 ? j - 2 : 0, j2p = j < res - 2 ? j + 2 : res - 1;
		// AO grid coordinate (cell centres at (i + 0.5) * F texels)
		let fz = ( j + 0.5 ) / F - 0.5;
		fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
		const az = fz | 0, tz = fz - az;
		for ( let i = 0; i < res; i ++ ) {

			const k = j * res + i;
			const im = i > 0 ? i - 1 : 0, ip = i < res - 1 ? i + 1 : res - 1;
			const hx = ( H[ j * res + ip ] - H[ j * res + im ] ) * inv2t;
			const hz = ( H[ jp * res + i ] - H[ jm * res + i ] ) * inv2t;
			const il = 1 / Math.sqrt( hx * hx + 1 + hz * hz );
			const nx = - hx * il, nz = - hz * il;

			// cavity from the Laplacian over a 2 m baseline (negative = convex)
			const i2m = i > 1 ? i - 2 : 0, i2p = i < res - 2 ? i + 2 : res - 1;
			const h = H[ k ];
			const lap = ( H[ j * res + i2m ] + H[ j * res + i2p ] + H[ j2m * res + i ] + H[ j2p * res + i ] - 4 * h ) * 0.25;
			let cav = 0.5 + lap * 0.9;
			cav = cav < 0 ? 0 : cav > 1 ? 1 : cav;

			let fx = ( i + 0.5 ) / F - 0.5;
			fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
			const ax = fx | 0, tx = fx - ax;
			const q = az * N + ax;
			const aoL = ( ao[ q ] * ( 1 - tx ) + ao[ q + 1 ] * tx ) * ( 1 - tz ) + ( ao[ q + N ] * ( 1 - tx ) + ao[ q + N + 1 ] * tx ) * tz;
			let aoT = aoL * ( 1 - Math.max( 0, cav - 0.5 ) * 0.7 );
			aoT = aoT < 0 ? 0 : aoT;

			const o = k * 4;
			normal[ o ] = ( nx * 0.5 + 0.5 ) * 255 + 0.5;
			normal[ o + 1 ] = ( nz * 0.5 + 0.5 ) * 255 + 0.5;
			normal[ o + 2 ] = rock[ k ] * 255 + 0.5;
			normal[ o + 3 ] = aoT * 255 + 0.5;
			splat[ o ] = sand[ k ];
			splat[ o + 1 ] = path[ k ];
			splat[ o + 2 ] = seagrass ? Math.max( gully[ k ], seagrass[ k ] ) : gully[ k ];
			// alpha: seabed rubble below the sea, the eroded beach scarp face on land
			splat[ o + 3 ] = Math.max( rubble ? rubble[ k ] : 0, scarp ? scarp[ k ] : 0 );

		}

	}

	// trampled ground around the building pads carved by the village
	if ( terrain.pads ) {

		for ( const p of terrain.pads ) {

			const R = p.radius + 3.5;
			const i0 = Math.max( 0, Math.floor( ( p.x - R - origin ) / texel ) ), i1 = Math.min( res - 1, Math.ceil( ( p.x + R - origin ) / texel ) );
			const j0 = Math.max( 0, Math.floor( ( p.z - R - origin ) / texel ) ), j1 = Math.min( res - 1, Math.ceil( ( p.z + R - origin ) / texel ) );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const x = origin + ( i + 0.5 ) * texel, z = origin + ( j + 0.5 ) * texel;
				const d = Math.hypot( x - p.x, z - p.z );
				const a = Math.atan2( z - p.z, x - p.x );
				// ragged edge: worn patches reach out unevenly around each building
				const reach = 1.2 + 1.8 * ( 0.5 + 0.5 * Math.sin( a * 3 + p.x ) * Math.sin( a * 5 - p.z ) );
				const t = d < p.radius ? 1 : Math.max( 0, 1 - ( d - p.radius ) / reach );
				const o = ( j * res + i ) * 4 + 1;
				const v = Math.round( t * t * 150 );
				if ( v > splat[ o ] ) splat[ o ] = v;

			}

		}

	}

	return { normal, splat, ms: { ao: t1 - t0, maps: performance.now() - t1 } };

}

// Coarse heights for the heightfield sun shadow: `factor` x `factor` box average of the
// heightmap, then a mip chain of 2 x 2 maxima (ridges keep their height when marched from far).
// Returns half-float mip levels for a DataTexture.
export function buildShadowHeights( terrain, factor = 4 ) {

	const { res, heights: H } = terrain;
	const n = res / factor;
	let cur = new Float32Array( n * n );
	let maxHeight = - Infinity;
	const inv = 1 / ( factor * factor );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		let s = 0;
		for ( let b = 0; b < factor; b ++ ) {

			const row = ( j * factor + b ) * res + i * factor;
			for ( let a = 0; a < factor; a ++ ) s += H[ row + a ];

		}

		const v = s * inv;
		cur[ j * n + i ] = v;
		if ( v > maxHeight ) maxHeight = v;

	}

	const toHalf = ( src ) => {

		const out = new Uint16Array( src.length );
		for ( let i = 0; i < src.length; i ++ ) out[ i ] = DataUtils.toHalfFloat( src[ i ] );
		return out;

	};

	const levels = [ { data: toHalf( cur ), width: n, height: n } ];
	let w = n;
	while ( w > 1 ) {

		const m = w >> 1;
		const next = new Float32Array( m * m );
		for ( let j = 0; j < m; j ++ ) for ( let i = 0; i < m; i ++ ) {

			const a = 2 * j * w + 2 * i;
			next[ j * m + i ] = Math.max( cur[ a ], cur[ a + 1 ], cur[ a + w ], cur[ a + w + 1 ] );

		}

		levels.push( { data: toHalf( next ), width: m, height: m } );
		cur = next;
		w = m;

	}

	return { levels, texel: terrain.texel * factor, maxHeight };

}
