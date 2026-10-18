// 2D polygon helpers (three.js ShapeUtils-compatible): signed area, winding test
// and triangulation of a contour with holes (hole bridging + ear clipping).

export function area( pts ) {

	const n = pts.length;
	let a = 0;
	for ( let p = n - 1, q = 0; q < n; p = q ++ ) a += pts[ p ].x * pts[ q ].y - pts[ q ].x * pts[ p ].y;
	return a * 0.5;

}

export const isClockWise = ( pts ) => area( pts ) < 0;

function removeDupEndPts( pts ) {

	const l = pts.length;
	if ( l > 2 && pts[ l - 1 ].x === pts[ 0 ].x && pts[ l - 1 ].y === pts[ 0 ].y ) pts.pop();

}

const cross = ( a, b, c ) => ( b.x - a.x ) * ( c.y - b.y ) - ( b.y - a.y ) * ( c.x - b.x );
const same = ( a, b ) => a.x === b.x && a.y === b.y;

function inTri( a, b, c, p ) {

	return ( c.x - p.x ) * ( a.y - p.y ) >= ( a.x - p.x ) * ( c.y - p.y ) &&
		( a.x - p.x ) * ( b.y - p.y ) >= ( b.x - p.x ) * ( a.y - p.y ) &&
		( b.x - p.x ) * ( c.y - p.y ) >= ( c.x - p.x ) * ( b.y - p.y );

}

function polyArea( idx, P ) {

	let a = 0;
	for ( let i = 0, j = idx.length - 1; i < idx.length; j = i ++ ) a += P[ idx[ j ] ].x * P[ idx[ i ] ].y - P[ idx[ i ] ].x * P[ idx[ j ] ].y;
	return a;

}

// Splice `hole` (CW) into `poly` (CCW) via a bridge from the hole's rightmost
// vertex to a visible outer vertex (ray cast toward +x).
function bridge( poly, hole, P ) {

	let hm = 0;
	for ( let i = 1; i < hole.length; i ++ ) if ( P[ hole[ i ] ].x > P[ hole[ hm ] ].x ) hm = i;
	const M = P[ hole[ hm ] ];

	let best = Infinity, bi = - 1;
	const n = poly.length;

	for ( let i = 0; i < n; i ++ ) {

		const a = P[ poly[ i ] ], b = P[ poly[ ( i + 1 ) % n ] ];
		if ( ( a.y <= M.y && M.y <= b.y ) || ( b.y <= M.y && M.y <= a.y ) ) {

			if ( a.y === b.y ) continue;
			const x = a.x + ( M.y - a.y ) * ( b.x - a.x ) / ( b.y - a.y );
			if ( x >= M.x && x < best ) {

				best = x;
				bi = a.x > b.x ? i : ( i + 1 ) % n;

			}

		}

	}

	if ( bi < 0 ) return poly;

	// A reflex vertex inside triangle (M, I, P) may block the view; take the one
	// with the smallest angle to the ray instead.
	const I = { x: best, y: M.y };
	let Pv = P[ poly[ bi ] ];

	if ( best !== Pv.x || M.y !== Pv.y ) {

		let tanMin = Infinity;
		const tri = Pv.y < M.y ? [ M, Pv, I ] : [ M, I, Pv ];
		const start = bi;

		for ( let k = 0; k < n; k ++ ) {

			const i = ( start + k ) % n, v = P[ poly[ i ] ];
			if ( v.x < M.x || i === start ) continue;
			const pv = P[ poly[ ( i + n - 1 ) % n ] ], nv = P[ poly[ ( i + 1 ) % n ] ];
			const reflex = cross( pv, v, nv ) < 0;
			if ( ! reflex && ! ( v.x === M.x && v.y === M.y ) ) continue;
			if ( ! inTriCCW( tri, v ) ) continue;
			const tan = Math.abs( M.y - v.y ) / ( v.x - M.x || 1e-12 );
			if ( tan < tanMin || ( tan === tanMin && v.x < Pv.x ) ) { tanMin = tan; bi = i; Pv = v; }

		}

	}

	// A vertex may occur several times (earlier bridges); connect through the
	// occurrence whose interior wedge contains M.
	for ( let k = 0; k < n; k ++ ) {

		if ( ! same( P[ poly[ k ] ], Pv ) ) continue;
		const pv = P[ poly[ ( k + n - 1 ) % n ] ], nv = P[ poly[ ( k + 1 ) % n ] ];
		const l1 = cross( pv, Pv, M ) >= 0, l2 = cross( Pv, nv, M ) >= 0;
		if ( cross( pv, Pv, nv ) >= 0 ? ( l1 && l2 ) : ( l1 || l2 ) ) { bi = k; break; }

	}

	const rot = hole.slice( hm ).concat( hole.slice( 0, hm ) );
	return poly.slice( 0, bi + 1 ).concat( rot, [ hole[ hm ], poly[ bi ] ], poly.slice( bi + 1 ) );

}

function inTriCCW( t, p ) {

	const [ a, b, c ] = cross( t[ 0 ], t[ 1 ], t[ 2 ] ) >= 0 ? t : [ t[ 0 ], t[ 2 ], t[ 1 ] ];
	return inTri( a, b, c, p );

}

function earClip( poly, P, out ) {

	const idx = poly.slice();
	let guard = 0;

	while ( idx.length > 3 && guard ++ < 100000 ) {

		const n = idx.length;
		let clipped = false;

		for ( let pass = 0; pass < 2 && ! clipped; pass ++ ) {

			for ( let i = 0; i < n; i ++ ) {

				const ia = idx[ ( i + n - 1 ) % n ], ib = idx[ i ], ic = idx[ ( i + 1 ) % n ];
				const a = P[ ia ], b = P[ ib ], c = P[ ic ];
				const cr = cross( a, b, c );
				if ( pass === 0 ? cr <= 0 : cr < 0 ) continue;
				let ear = true;

				if ( cr > 0 ) {

					for ( let k = 0; k < n; k ++ ) {

						const v = P[ idx[ k ] ];
						if ( same( v, a ) || same( v, b ) || same( v, c ) ) continue;
						if ( inTri( a, b, c, v ) ) { ear = false; break; }

					}

				}

				if ( ear ) {

					out.push( [ ia, ib, ic ] );
					idx.splice( i, 1 );
					clipped = true;
					break;

				}

			}

		}

		if ( ! clipped ) {

			// self-intersecting or degenerate input: cut the least reflex vertex
			let bi = 0, bc = - Infinity;
			for ( let i = 0; i < n; i ++ ) {

				const c = cross( P[ idx[ ( i + n - 1 ) % n ] ], P[ idx[ i ] ], P[ idx[ ( i + 1 ) % n ] ] );
				if ( c > bc ) { bc = c; bi = i; }

			}

			out.push( [ idx[ ( bi + n - 1 ) % n ], idx[ bi ], idx[ ( bi + 1 ) % n ] ] );
			idx.splice( bi, 1 );

		}

	}

	if ( idx.length === 3 ) out.push( [ idx[ 0 ], idx[ 1 ], idx[ 2 ] ] );
	return out;

}

// Returns index triples into contour.concat( ...holes ). Like three.js, a
// duplicated closing point is removed from each input array in place.
export function triangulateShape( contour, holes = [] ) {

	removeDupEndPts( contour );
	holes.forEach( removeDupEndPts );
	const P = contour.concat( ...holes );

	let poly = contour.map( ( _, i ) => i );
	const outerCW = polyArea( poly, P ) < 0;
	if ( outerCW ) poly.reverse();

	let off = contour.length;
	const hs = holes.map( ( h ) => {

		const idx = h.map( ( _, i ) => off + i );
		off += h.length;
		if ( polyArea( idx, P ) > 0 ) idx.reverse();
		return idx;

	} ).filter( ( h ) => h.length >= 3 );

	hs.sort( ( a, b ) => Math.max( ...b.map( ( i ) => P[ i ].x ) ) - Math.max( ...a.map( ( i ) => P[ i ].x ) ) );
	for ( const h of hs ) poly = bridge( poly, h, P );

	const tris = earClip( poly, P, [] );
	if ( outerCW ) for ( const t of tris ) { const s = t[ 0 ]; t[ 0 ] = t[ 2 ]; t[ 2 ] = s; }
	return tris;

}

export const ShapeUtils = { area, isClockWise, triangulateShape };
