import { Vector3 } from '../../engine/index.js';

// Lines plan of an ~8.2 m Downeast lobster boat, in the boat's local frame:
// +Z forward (bow), +Y up, +X port. y = 0 is the design waterline, x = 0 the
// centerline and z = 0 the middle of the waterline.
//
// The hull surface is parameterized by t (0 = transom .. 1 = stem head) and a
// section index j running from the keel (j = 0) up to the sheer. Each section
// is a centripetal Catmull-Rom spline through seven control points (keel,
// garboard, bilge start, bilge, bilge end, topsides, sheer). Aft sections are
// planar (constant z); forward of t = 0.55 they tilt progressively so that the
// last one (t = 1) traces the raked stem with a rounded forefoot.

const clamp01 = ( x ) => Math.min( 1, Math.max( 0, x ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const sstep = ( a, b, x ) => {

	const t = clamp01( ( x - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );

};

// Intervals per spline span (K-G, G-B1, B1-C, C-B2, B2-M, M-S) at density 1.
const SPANS = [ 4, 4, 3, 3, 8, 10 ];

export const RHO_SEAWATER = 1025;

export class HullLines {

	constructor() {

		this.zAft = - 3.9;
		this.zBow = 4.3;
		this.length = this.zBow - this.zAft;

		this.deckY = 0.35; // cockpit sole
		this.shell = 0.07; // outer skin to inner lining at the sheer
		this.houseBack = - 0.35; // aft end of the wheelhouse side walls
		this.houseFront = 1.45; // wheelhouse front (base of the windshield)

		// Stem: straight rake above the forefoot, circular forefoot below.
		const k = 0.2, R = 0.45;
		const yF = this.keelY( 1 ), yTip = this.sheerY( 1 );
		const zW = this.zBow - k * yTip;
		const q = Math.sqrt( 1 + k * k );
		const yc = yF + R;
		this.stem = { k, R, yF, zW, yc, zc: zW + k * yc - R * q, yT: yc - R * k / q };

		this._setback = new Map();
		this._sectionCache = new Map();

		this.analyze();

	}

	// ---------------------------------------------------------------- design curves

	sheerZ( t ) {

		return this.zAft + this.length * t;

	}

	tAtSheerZ( z ) {

		return clamp01( ( z - this.zAft ) / this.length );

	}

	sheerY( t ) {

		const a = Math.max( 0, 1 - t / 0.2 );
		return 0.98 + 0.62 * Math.pow( t, 2.2 ) + 0.04 * a * a;

	}

	sheerX( t ) {

		if ( t <= 0.42 ) {

			const a = 1 - t / 0.42;
			return 1.45 - 0.17 * a * a;

		}

		const s = ( t - 0.42 ) / 0.58;
		return 1.45 * ( 1 - Math.pow( s, 2.6 ) );

	}

	keelY( t ) {

		if ( t <= 0.45 ) return - 0.23 - 0.22 * Math.sin( Math.PI * 0.5 * t / 0.45 );
		return - 0.45 + 0.33 * Math.pow( sstep( 0.45, 1, t ), 1.6 );

	}

	chineX( t ) {

		if ( t <= 0.42 ) {

			const a = 1 - t / 0.42;
			return 1.26 - 0.1 * a * a;

		}

		const s = ( t - 0.42 ) / 0.58;
		return 1.26 * Math.pow( Math.max( 0, 1 - Math.pow( s, 1.7 ) ), 1.15 );

	}

	chineY( t ) {

		return lerp( 0.01, - 0.045, sstep( 0, 0.45, t ) ) + 0.33 * Math.pow( sstep( 0.5, 1, t ), 1.3 );

	}

	bilgeTangent( t ) {

		return lerp( 0.2, 0.24, sstep( 0, 0.4, t ) ) * ( 1 - 0.55 * sstep( 0.6, 1, t ) );

	}

	bottomConvexity( t ) {

		return lerp( 0.025, 0.012, sstep( 0.55, 0.95, t ) );

	}

	flare( t ) {

		return lerp( - 0.012, 0.075, sstep( 0.3, 0.85, t ) ) * ( 1 - 0.3 * sstep( 0.9, 1, t ) );

	}

	bowBlend( t ) {

		return t > 0.55 ? ( ( t - 0.55 ) / 0.45 ) ** 2 : 0;

	}

	stemZ( y ) {

		const s = this.stem;
		if ( y >= s.yT ) return s.zW + s.k * y;
		const dy = y - s.yc;
		return s.zc + Math.sqrt( Math.max( 0, s.R * s.R - dy * dy ) );

	}

	// ---------------------------------------------------------------- sections

	controlPoints( t ) {

		const K = [ 0, this.keelY( t ) ];
		const C0 = [ this.chineX( t ), this.chineY( t ) ];
		const S = [ this.sheerX( t ), this.sheerY( t ) ];

		const bx = C0[ 0 ] - K[ 0 ], by = C0[ 1 ] - K[ 1 ];
		const lb = Math.hypot( bx, by );
		const dbx = bx / lb, dby = by / lb;
		const tx = S[ 0 ] - C0[ 0 ], ty = S[ 1 ] - C0[ 1 ];
		const lt = Math.hypot( tx, ty );
		const dtx = tx / lt, dty = ty / lt;

		// shape offsets fade out where the section collapses into the stem
		const w = sstep( 0, 0.3, C0[ 0 ] );
		const r = Math.min( this.bilgeTangent( t ), 0.3 * lb, 0.3 * lt );

		const convex = this.bottomConvexity( t ) * lb * w;
		const G = [ K[ 0 ] + dbx * lb * 0.5 + dby * convex, K[ 1 ] + dby * lb * 0.5 - dbx * convex ];
		const B1 = [ C0[ 0 ] - dbx * r, C0[ 1 ] - dby * r ];
		const B2 = [ C0[ 0 ] + dtx * r, C0[ 1 ] + dty * r ];

		// midpoint of a circular fillet between bottom and topsides lines
		const psi = Math.acos( Math.min( 1, Math.max( - 1, dbx * dtx + dby * dty ) ) );
		const mx = dtx - dbx, my = dty - dby;
		const ml = Math.hypot( mx, my );
		const e = ml > 1e-6 ? r * Math.tan( psi / 4 ) / ml : 0;
		const Cm = [ C0[ 0 ] + mx * e, C0[ 1 ] + my * e ];

		const fl = this.flare( t ) * lt * w; // > 0: concave flare
		const M = [ C0[ 0 ] + dtx * lt * 0.5 - dty * fl, C0[ 1 ] + dty * lt * 0.5 + dtx * fl ];

		return [ K, G, B1, Cm, B2, M, S ];

	}

	// Section points (x >= 0, y) from keel to sheer as a flat [x0, y0, x1, y1, ...] array.
	sectionPoints( t, density = 1 ) {

		const key = t + ':' + density;
		const cached = this._sectionCache.get( key );
		if ( cached ) return cached;

		const cp = this.controlPoints( t );
		const n = cp.length;
		const ext = [
			[ 2 * cp[ 0 ][ 0 ] - cp[ 1 ][ 0 ], 2 * cp[ 0 ][ 1 ] - cp[ 1 ][ 1 ] ],
			...cp,
			[ 2 * cp[ n - 1 ][ 0 ] - cp[ n - 2 ][ 0 ], 2 * cp[ n - 1 ][ 1 ] - cp[ n - 2 ][ 1 ] ],
		];

		const count = SPANS.reduce( ( a, b ) => a + b, 0 ) * density + 1;
		const out = new Float64Array( count * 2 );
		let k = 0;
		const p = [ 0, 0 ];
		for ( let s = 0; s < SPANS.length; s ++ ) {

			const steps = SPANS[ s ] * density;
			for ( let i = 0; i < steps; i ++ ) {

				catmullRom( ext[ s ], ext[ s + 1 ], ext[ s + 2 ], ext[ s + 3 ], i / steps, p );
				out[ k ++ ] = Math.max( 0, p[ 0 ] );
				out[ k ++ ] = p[ 1 ];

			}

		}

		out[ k ++ ] = cp[ n - 1 ][ 0 ];
		out[ k ++ ] = cp[ n - 1 ][ 1 ];

		if ( this._sectionCache.size > 4096 ) this._sectionCache.clear();
		this._sectionCache.set( key, out );
		return out;

	}

	// Longitudinal setback of each section point, so the t = 1 section traces the stem.
	setback( density = 1 ) {

		let H = this._setback.get( density );
		if ( H ) return H;
		const sec = this.sectionPoints( 1, density );
		const n = sec.length / 2;
		H = new Float64Array( n );
		for ( let j = 0; j < n; j ++ ) H[ j ] = this.zBow - this.stemZ( sec[ 2 * j + 1 ] );
		H[ n - 1 ] = 0;
		this._setback.set( density, H );
		return H;

	}

	sectionCount( density = 1 ) {

		return SPANS.reduce( ( a, b ) => a + b, 0 ) * density + 1;

	}

	// Surface points of station t as Vector3s (port side).
	station( t, density = 1 ) {

		const sec = this.sectionPoints( t, density );
		const H = this.setback( density );
		const zs = this.sheerZ( t ), D = this.bowBlend( t );
		const pts = [];
		for ( let j = 0; j < H.length; j ++ ) pts.push( new Vector3( sec[ 2 * j ], sec[ 2 * j + 1 ], zs - D * H[ j ] ) );
		return pts;

	}

	// Station parameters, denser toward the bow where the sections change quickly.
	stationParams( count ) {

		const density = ( t ) => 1 + 2.2 * sstep( 0.62, 1, t ) + 0.5 * ( 1 - sstep( 0, 0.08, t ) );
		const N = 2000;
		const cum = new Float64Array( N + 1 );
		for ( let i = 1; i <= N; i ++ ) cum[ i ] = cum[ i - 1 ] + density( ( i - 0.5 ) / N ) / N;
		const total = cum[ N ];
		const ts = [];
		let k = 0;
		for ( let i = 0; i < count; i ++ ) {

			const target = total * i / ( count - 1 );
			while ( k < N && cum[ k + 1 ] < target ) k ++;
			const f = ( target - cum[ k ] ) / Math.max( 1e-12, cum[ k + 1 ] - cum[ k ] );
			ts.push( i === count - 1 ? 1 : ( k + clamp01( f ) ) / N );

		}

		return ts;

	}

	// Outer half-breadth of the station t at height y (topsides, above the bilge).
	halfBreadth( t, y ) {

		const sec = this.sectionPoints( t, 2 );
		const n = sec.length / 2;
		if ( y >= sec[ 2 * n - 1 ] ) return sec[ 2 * n - 2 ];
		for ( let j = n - 2; j >= 0; j -- ) {

			const y0 = sec[ 2 * j + 1 ], y1 = sec[ 2 * j + 3 ];
			if ( y >= y0 && y <= y1 ) {

				const f = ( y - y0 ) / Math.max( 1e-9, y1 - y0 );
				return lerp( sec[ 2 * j ], sec[ 2 * j + 2 ], f );

			}

		}

		return 0;

	}

	// Station parameter whose surface passes through longitudinal position z at height y.
	tAt( z, y ) {

		let lo = 0, hi = 1;
		for ( let i = 0; i < 40; i ++ ) {

			const mid = ( lo + hi ) * 0.5;
			if ( this.zOnStation( mid, y ) < z ) lo = mid; else hi = mid;

		}

		return ( lo + hi ) * 0.5;

	}

	// Longitudinal position of station t at height y (accounts for the tilted bow sections).
	zOnStation( t, y ) {

		const D = this.bowBlend( t );
		if ( D === 0 ) return this.sheerZ( t );
		const sec = this.sectionPoints( t, 2 );
		const H = this.setback( 2 );
		const n = sec.length / 2;
		let h = 0;
		if ( y <= sec[ 1 ] ) h = H[ 0 ];
		else if ( y >= sec[ 2 * n - 1 ] ) h = 0;
		else {

			for ( let j = 0; j < n - 1; j ++ ) {

				const y0 = sec[ 2 * j + 1 ], y1 = sec[ 2 * j + 3 ];
				if ( y >= y0 && y <= y1 ) {

					h = lerp( H[ j ], H[ j + 1 ], ( y - y0 ) / Math.max( 1e-9, y1 - y0 ) );
					break;

				}

			}

		}

		return this.sheerZ( t ) - D * h;

	}

	// Outer hull half-breadth at an arbitrary (z, y) on the topsides.
	hullXAt( z, y ) {

		return this.halfBreadth( this.tAt( z, y ), y );

	}

	// ---------------------------------------------------------------- hydrostatics

	analyze() {

		const density = 3;
		const NT = 480;
		const H = this.setback( density );
		const nj = H.length;

		// Waterline (y = 0 crossing of every station).
		const wl = [];
		for ( let i = 0; i <= NT; i ++ ) {

			const t = i / NT;
			const sec = this.sectionPoints( t, density );
			const zs = this.sheerZ( t ), D = this.bowBlend( t );
			for ( let j = 0; j < nj - 1; j ++ ) {

				const y0 = sec[ 2 * j + 1 ], y1 = sec[ 2 * j + 3 ];
				if ( y0 <= 0 && y1 > 0 ) {

					const f = - y0 / ( y1 - y0 );
					wl.push( [ zs - D * lerp( H[ j ], H[ j + 1 ], f ), lerp( sec[ 2 * j ], sec[ 2 * j + 2 ], f ) ] );
					break;

				}

			}

		}

		wl.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
		this.wlStart = wl[ 0 ][ 0 ];
		this.wlEnd = wl[ wl.length - 1 ][ 0 ];

		const TN = 512;
		this._beamTable = new Float64Array( TN + 1 );
		this._tableZ0 = this.wlStart;
		this._tableDz = ( this.wlEnd - this.wlStart ) / TN;
		let k = 0;
		for ( let i = 0; i <= TN; i ++ ) {

			const z = this.wlStart + i * this._tableDz;
			while ( k < wl.length - 2 && wl[ k + 1 ][ 0 ] < z ) k ++;
			const a = wl[ k ], b = wl[ k + 1 ];
			const f = clamp01( ( z - a[ 0 ] ) / Math.max( 1e-9, b[ 0 ] - a[ 0 ] ) );
			this._beamTable[ i ] = lerp( a[ 1 ], b[ 1 ], f );

		}

		// Rasterize the immersed canoe body (port half) into a bottom height field.
		const cell = 0.02;
		const x0 = 0, z0 = this.zAft - 0.02;
		const nx = Math.ceil( 1.5 / cell ), nz = Math.ceil( ( this.wlEnd + 0.05 - z0 ) / cell );
		const bottom = new Float32Array( nx * nz ).fill( Infinity );
		const grid = [];
		for ( let i = 0; i <= NT; i ++ ) {

			const t = i / NT;
			const sec = this.sectionPoints( t, density );
			const zs = this.sheerZ( t ), D = this.bowBlend( t );
			const row = new Float64Array( nj * 3 );
			for ( let j = 0; j < nj; j ++ ) {

				row[ 3 * j ] = sec[ 2 * j ];
				row[ 3 * j + 1 ] = sec[ 2 * j + 1 ];
				row[ 3 * j + 2 ] = zs - D * H[ j ];

			}

			grid.push( row );

		}

		const tri = ( a, b, c ) => {

			// a, b, c: [x, y, z]
			if ( Math.min( a[ 1 ], b[ 1 ], c[ 1 ] ) > 0.01 ) return;
			const minX = Math.min( a[ 0 ], b[ 0 ], c[ 0 ] ), maxX = Math.max( a[ 0 ], b[ 0 ], c[ 0 ] );
			const minZ = Math.min( a[ 2 ], b[ 2 ], c[ 2 ] ), maxZ = Math.max( a[ 2 ], b[ 2 ], c[ 2 ] );
			const i0 = Math.max( 0, Math.ceil( ( minX - x0 ) / cell - 0.5 ) ), i1 = Math.min( nx - 1, Math.floor( ( maxX - x0 ) / cell - 0.5 ) );
			const k0 = Math.max( 0, Math.ceil( ( minZ - z0 ) / cell - 0.5 ) ), k1 = Math.min( nz - 1, Math.floor( ( maxZ - z0 ) / cell - 0.5 ) );
			if ( i0 > i1 || k0 > k1 ) return;
			const det = ( b[ 2 ] - c[ 2 ] ) * ( a[ 0 ] - c[ 0 ] ) + ( c[ 0 ] - b[ 0 ] ) * ( a[ 2 ] - c[ 2 ] );
			if ( Math.abs( det ) < 1e-12 ) return;
			for ( let kk = k0; kk <= k1; kk ++ ) {

				const pz = z0 + ( kk + 0.5 ) * cell;
				for ( let ii = i0; ii <= i1; ii ++ ) {

					const px = x0 + ( ii + 0.5 ) * cell;
					const l1 = ( ( b[ 2 ] - c[ 2 ] ) * ( px - c[ 0 ] ) + ( c[ 0 ] - b[ 0 ] ) * ( pz - c[ 2 ] ) ) / det;
					const l2 = ( ( c[ 2 ] - a[ 2 ] ) * ( px - c[ 0 ] ) + ( a[ 0 ] - c[ 0 ] ) * ( pz - c[ 2 ] ) ) / det;
					const l3 = 1 - l1 - l2;
					if ( l1 < - 1e-9 || l2 < - 1e-9 || l3 < - 1e-9 ) continue;
					const y = l1 * a[ 1 ] + l2 * b[ 1 ] + l3 * c[ 1 ];
					const idx = kk * nx + ii;
					if ( y < bottom[ idx ] ) bottom[ idx ] = y;

				}

			}

		};

		const A = [ 0, 0, 0 ], B = [ 0, 0, 0 ], C = [ 0, 0, 0 ], Dp = [ 0, 0, 0 ];
		const get = ( row, j, out ) => {

			out[ 0 ] = row[ 3 * j ]; out[ 1 ] = row[ 3 * j + 1 ]; out[ 2 ] = row[ 3 * j + 2 ];
			return out;

		};

		for ( let i = 0; i < NT; i ++ ) {

			for ( let j = 0; j < nj - 1; j ++ ) {

				get( grid[ i ], j, A ); get( grid[ i + 1 ], j, B ); get( grid[ i + 1 ], j + 1, C ); get( grid[ i ], j + 1, Dp );
				tri( A, B, C ); tri( A, C, Dp );

			}

		}

		this._field = { bottom, nx, nz, cell, x0, z0 };

		// Waterplane area, displaced volume, centers.
		let area = 0, volume = 0, mz = 0, vz = 0, vy = 0;
		for ( let kk = 0; kk < nz; kk ++ ) {

			const pz = z0 + ( kk + 0.5 ) * cell;
			for ( let ii = 0; ii < nx; ii ++ ) {

				const y = bottom[ kk * nx + ii ];
				if ( ! ( y < 0 ) ) continue;
				const dA = cell * cell * 2;
				area += dA;
				mz += dA * pz;
				volume += dA * - y;
				vz += dA * - y * pz;
				vy += dA * - y * ( y * 0.5 );

			}

		}

		this.waterplaneArea = area;
		this.canoeVolume = volume;
		this.centerOfFlotationZ = mz / area;
		this.centerOfBuoyancy = new Vector3( 0, vy / volume, vz / volume );

	}

	// Waterplane half-beam at longitudinal position z (0 outside the waterline).
	halfBeamAt( z ) {

		if ( z < this.wlStart || z > this.wlEnd ) return 0;
		const f = ( z - this._tableZ0 ) / this._tableDz;
		const i = Math.min( this._beamTable.length - 2, Math.max( 0, Math.floor( f ) ) );
		return lerp( this._beamTable[ i ], this._beamTable[ i + 1 ], clamp01( f - i ) );

	}

	// Canoe-body depth below the waterline (at the centerline) at z, 0 outside.
	draftAt( z ) {

		const { bottom, nx, nz, cell, z0 } = this._field;
		const f = ( z - z0 ) / cell - 0.5;
		if ( f < - 0.5 || f > nz - 0.5 ) return 0;
		const k = Math.min( nz - 2, Math.max( 0, Math.floor( f ) ) );
		const a = bottom[ k * nx ], b = bottom[ ( k + 1 ) * nx ];
		const da = a < 0 ? - a : 0, db = b < 0 ? - b : 0;
		return lerp( da, db, clamp01( f - k ) );

	}

	// Hull bottom height (canoe body) at (x, z); +Infinity outside the immersed footprint.
	bottomAt( x, z ) {

		const { bottom, nx, nz, cell, x0, z0 } = this._field;
		const i = Math.floor( ( Math.abs( x ) - x0 ) / cell ), k = Math.floor( ( z - z0 ) / cell );
		if ( i < 0 || i >= nx || k < 0 || k >= nz ) return Infinity;
		return bottom[ k * nx + i ];

	}

	// Buoyancy samples: `slices` longitudinal slices x 4 lateral strips (two per side).
	// Each sample carries the waterplane area of its patch; its y is the mean hull
	// depth of the patch, so sum(area * -y) equals the displaced canoe-body volume,
	// and x sits at the patch's radius of gyration so roll stiffness is preserved.
	buildHullSamples( slices = 8 ) {

		const { bottom, nx, nz, cell, x0, z0 } = this._field;
		const L = this.wlEnd - this.wlStart;
		const acc = [];
		for ( let s = 0; s < slices; s ++ ) acc.push( [ 0, 1 ].map( () => ( { a: 0, x2: 0, z: 0, v: 0 } ) ) );

		for ( let kk = 0; kk < nz; kk ++ ) {

			const pz = z0 + ( kk + 0.5 ) * cell;
			const s = Math.min( slices - 1, Math.max( 0, Math.floor( ( pz - this.wlStart ) / L * slices ) ) );
			const hb = this.halfBeamAt( pz );
			for ( let ii = 0; ii < nx; ii ++ ) {

				const y = bottom[ kk * nx + ii ];
				if ( ! ( y < 0 ) ) continue;
				const px = x0 + ( ii + 0.5 ) * cell;
				const strip = hb > 0 && px > hb * 0.5 ? 1 : 0;
				const dA = cell * cell;
				const c = acc[ s ][ strip ];
				c.a += dA; c.x2 += dA * px * px; c.z += dA * pz; c.v += dA * - y;

			}

		}

		const samples = [];
		for ( let s = 0; s < slices; s ++ ) {

			for ( let strip = 0; strip < 2; strip ++ ) {

				const c = acc[ s ][ strip ];
				if ( c.a <= 0 ) continue;
				const x = Math.sqrt( c.x2 / c.a ), z = c.z / c.a, y = - c.v / c.a;
				const bottomY = Math.min( 0, this.bottomAt( x, z ) );
				samples.push( { position: new Vector3( x, y, z ), area: c.a, depth: - y, bottomY } );
				samples.push( { position: new Vector3( - x, y, z ), area: c.a, depth: - y, bottomY } );

			}

		}

		return samples;

	}

}

// Centripetal Catmull-Rom between p1 and p2.
function catmullRom( p0, p1, p2, p3, u, out ) {

	const d01 = Math.max( 1e-5, Math.sqrt( Math.hypot( p1[ 0 ] - p0[ 0 ], p1[ 1 ] - p0[ 1 ] ) ) );
	const d12 = Math.max( 1e-5, Math.sqrt( Math.hypot( p2[ 0 ] - p1[ 0 ], p2[ 1 ] - p1[ 1 ] ) ) );
	const d23 = Math.max( 1e-5, Math.sqrt( Math.hypot( p3[ 0 ] - p2[ 0 ], p3[ 1 ] - p2[ 1 ] ) ) );
	const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
	const t = t1 + ( t2 - t1 ) * u;

	for ( let c = 0; c < 2; c ++ ) {

		const a1 = ( ( t1 - t ) * p0[ c ] + ( t - t0 ) * p1[ c ] ) / ( t1 - t0 );
		const a2 = ( ( t2 - t ) * p1[ c ] + ( t - t1 ) * p2[ c ] ) / ( t2 - t1 );
		const a3 = ( ( t3 - t ) * p2[ c ] + ( t - t2 ) * p3[ c ] ) / ( t3 - t2 );
		const b1 = ( ( t2 - t ) * a1 + ( t - t0 ) * a2 ) / ( t2 - t0 );
		const b2 = ( ( t3 - t ) * a2 + ( t - t1 ) * a3 ) / ( t3 - t1 );
		out[ c ] = ( ( t2 - t ) * b1 + ( t - t1 ) * b2 ) / ( t2 - t1 );

	}

	return out;

}

export { sstep, lerp, clamp01 };
