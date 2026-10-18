import * as THREE from '../../engine/index.js';
import { PART } from './FishGeometry.js';

// Rays and the green sea turtle, in the fish frame (nose +z, back +y, total length 1 from the
// snout at z = +0.5) so they share the fish batch, material and swimming data:
//  - rays: a flat disc (PART.DISC) whose margins undulate (stingray) or flap (eagle ray) in the
//    vertex shader, eyes and spiracles on top, a whip tail (PART.WHIP, swings sideways).
//    aData: x = position along the body, z = distance from the midline (0 .. 1 at the wing tip),
//    w = 1 on the back, -1 on the belly.
//  - turtle: domed carapace (PART.CARAPACE, pattern coordinates in z / w), plastron, head and
//    neck (PART.SKIN), flippers (PART.FLIPPER: z = distance from the shoulder, w = flipper id
//    0 / 1 front left / right, 2 / 3 hind) that stroke about their shoulders.

const TAU = Math.PI * 2;

class Acc {

	constructor() {

		this.pos = [];
		this.dat = [];
		this.idx = [];

	}

	v( x, y, z, a, b, c, d ) {

		this.pos.push( x, y, z );
		this.dat.push( a, b, c, d );
		return this.pos.length / 3 - 1;

	}

	build() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'aData', new THREE.Float32BufferAttribute( this.dat, 4 ) );
		g.setIndex( this.idx );
		g.computeVertexNormals();
		g.computeBoundingSphere();
		return g;

	}

}

// Tapered tube along points (x, y, z, radius); part and aData z / w per point from fn( i, t ).
function tube( A, pts, sides, part, dataFn, caps = true ) {

	const rows = [];
	for ( let i = 0; i < pts.length; i ++ ) {

		const p = pts[ i ], q = pts[ Math.min( i + 1, pts.length - 1 ) ], o = pts[ Math.max( i - 1, 0 ) ];
		const d = new THREE.Vector3( q[ 0 ] - o[ 0 ], q[ 1 ] - o[ 1 ], q[ 2 ] - o[ 2 ] ).normalize();
		const s1 = new THREE.Vector3( 0, 1, 0 ).cross( d );
		if ( s1.lengthSq() < 1e-6 ) s1.set( 1, 0, 0 );
		s1.normalize();
		const s2 = new THREE.Vector3().crossVectors( d, s1 );
		const row = [];
		const t = i / ( pts.length - 1 );
		const [ dz, dw ] = dataFn( i, t );
		for ( let j = 0; j < sides; j ++ ) {

			const a = j / sides * TAU;
			const r = p[ 3 ];
			row.push( A.v(
				p[ 0 ] + ( s1.x * Math.cos( a ) + s2.x * Math.sin( a ) ) * r,
				p[ 1 ] + ( s1.y * Math.cos( a ) + s2.y * Math.sin( a ) ) * r * ( p[ 4 ] ?? 1 ),
				p[ 2 ] + ( s1.z * Math.cos( a ) + s2.z * Math.sin( a ) ) * r,
				0.5 - p[ 2 ], part, dz, dw,
			) );

		}

		rows.push( row );

	}

	for ( let i = 0; i < rows.length - 1; i ++ ) for ( let j = 0; j < sides; j ++ ) {

		const a = rows[ i ][ j ], b = rows[ i ][ ( j + 1 ) % sides ], c = rows[ i + 1 ][ ( j + 1 ) % sides ], d = rows[ i + 1 ][ j ];
		A.idx.push( a, d, b, b, d, c );

	}

	if ( caps ) {

		const last = rows[ rows.length - 1 ];
		const p = pts[ pts.length - 1 ];
		const c = A.v( p[ 0 ], p[ 1 ], p[ 2 ], 0.5 - p[ 2 ], part, ...dataFn( pts.length - 1, 1 ) );
		for ( let j = 0; j < sides; j ++ ) A.idx.push( last[ j ], c, last[ ( j + 1 ) % sides ] );

	}

}

// o: { lod, eagle } (southern stingray: rhombic disc that undulates; spotted eagle ray: pointed,
// swept wings that flap, a protruding head and a very long tail)
export function rayGeometry( { lod = 0, eagle = false } = {} ) {

	const A = new Acc();
	const nA = lod ? 20 : 44, nR = lod ? 4 : 9;
	// disc outline (right half, x >= 0, from the snout clockwise to the tail), radius at angle a
	// (0 = straight ahead, PI / 2 = the right wing tip) found by intersecting the polygon
	const half = eagle ?
		[ [ 0, 0.27 ], [ 0.05, 0.25 ], [ 0.07, 0.19 ], [ 0.2, 0.12 ], [ 0.36, 0.04 ], [ 0.5, - 0.07 ], [ 0.42, - 0.09 ], [ 0.26, - 0.11 ], [ 0.13, - 0.17 ], [ 0.04, - 0.2 ], [ 0, - 0.2 ] ] :
		[ [ 0, 0.43 ], [ 0.08, 0.37 ], [ 0.3, 0.17 ], [ 0.47, 0.02 ], [ 0.5, - 0.03 ], [ 0.44, - 0.12 ], [ 0.26, - 0.3 ], [ 0.12, - 0.4 ], [ 0, - 0.42 ] ];
	const poly = [ ...half, ...half.slice( 1, - 1 ).reverse().map( ( p ) => [ - p[ 0 ], p[ 1 ] ] ) ];
	const outline = ( a ) => {

		const dx = Math.sin( a ), dz = Math.cos( a );
		let best = 0;
		for ( let i = 0; i < poly.length; i ++ ) {

			const p = poly[ i ], q = poly[ ( i + 1 ) % poly.length ];
			// ray (0,0) + t (dx, dz) against the segment p q
			const ex = q[ 0 ] - p[ 0 ], ez = q[ 1 ] - p[ 1 ];
			const den = dx * ez - dz * ex;
			if ( Math.abs( den ) < 1e-9 ) continue;
			const t = ( p[ 0 ] * ez - p[ 1 ] * ex ) / den;
			const u = ( p[ 0 ] * dz - p[ 1 ] * dx ) / den;
			if ( t > 0 && u >= 0 && u <= 1 ) best = Math.max( best, t );

		}

		return best;

	};

	const cz = eagle ? 0.23 : 0.07; // disc centre (the disc sits at the front of the total length)
	const thick = eagle ? 0.07 : 0.06;
	for ( const side of [ 1, - 1 ] ) {

		const rows = [];
		const centre = A.v( 0, side * thick * ( side > 0 ? 1 : 0.4 ), cz, 0.5 - cz, PART.DISC, 0, side );
		for ( let k = 1; k <= nR; k ++ ) {

			const s = k / nR;
			const row = [];
			for ( let j = 0; j < nA; j ++ ) {

				const a = j / nA * TAU;
				const r = outline( a ) * s;
				const x = Math.sin( a ) * r, z = cz + Math.cos( a ) * r * ( eagle ? 1 : 1 );
				// body dome over the middle, thin margins
				const body = Math.exp( - ( x * x ) / ( eagle ? 0.012 : 0.02 ) - Math.pow( ( z - cz ) / 0.28, 2 ) );
				const y = side * ( thick * body * ( side > 0 ? 1 : 0.45 ) + 0.004 * ( 1 - s ) );
				row.push( A.v( x, y, z, 0.5 - z, PART.DISC, Math.abs( x ) / 0.5, side ) );

			}

			rows.push( row );

		}

		for ( let j = 0; j < nA; j ++ ) {

			const j1 = ( j + 1 ) % nA;
			if ( side > 0 ) A.idx.push( centre, rows[ 0 ][ j ], rows[ 0 ][ j1 ] );
			else A.idx.push( centre, rows[ 0 ][ j1 ], rows[ 0 ][ j ] );
			for ( let k = 0; k < nR - 1; k ++ ) {

				const a = rows[ k ][ j ], b = rows[ k ][ j1 ], c = rows[ k + 1 ][ j1 ], d = rows[ k + 1 ][ j ];
				if ( side > 0 ) A.idx.push( a, d, b, b, d, c );
				else A.idx.push( a, b, d, b, c, d );

			}

		}

	}

	// eyes on top
	if ( lod === 0 ) {

		for ( const s of [ 1, - 1 ] ) {

			const ex = s * ( eagle ? 0.09 : 0.06 ), ez = cz + ( eagle ? 0.13 : 0.16 );
			tube( A, [ [ ex, thick * 0.7, ez + 0.012, 0.004 ], [ ex, thick * 0.85, ez, 0.013 ], [ ex, thick * 0.9, ez - 0.012, 0.004 ] ], 6, PART.EYE, () => [ 0, 0 ] );

		}

	}

	// tail: long whip (the eagle ray's is three times the disc length)
	const tl = eagle ? 1.0 : 0.62;
	const tz0 = cz - ( eagle ? 0.19 : 0.4 );
	const tp = [];
	const nT = lod ? 4 : 10;
	for ( let i = 0; i <= nT; i ++ ) {

		const t = i / nT;
		tp.push( [ 0, 0.01 - t * 0.01, tz0 - t * tl, ( eagle ? 0.014 : 0.026 ) * ( 1 - t ) + 0.002, 0.8 ] );

	}

	tube( A, tp, lod ? 3 : 5, PART.WHIP, () => [ 0, 1 ] );
	const g = A.build();
	return g;

}

// Green sea turtle (carapace length ~0.72 of the total length 1, head forward).
export function turtleGeometry( { lod = 0 } = {} ) {

	const A = new Acc();
	const L = 0.72, W = 0.56, Hc = 0.2, zc = - 0.02;
	const nA = lod ? 14 : 30, nR = lod ? 3 : 7;
	// carapace: heart-shaped dome; plastron: flat below
	const rim = ( a ) => {

		const s = Math.sin( a ), c = Math.cos( a );
		const r = 1 / Math.sqrt( ( s * s ) / ( W * W / 4 ) + ( c * c ) / ( L * L / 4 ) );
		return r * ( 1 - 0.12 * Math.pow( Math.max( 0, - c ), 3 ) ) * ( 1 + 0.04 * Math.max( 0, c ) );

	};

	for ( const top of [ true, false ] ) {

		const rows = [];
		const centre = A.v( 0, top ? Hc : - 0.07, zc, 0.5 - zc, top ? PART.CARAPACE : PART.SKIN, 0, top ? 0 : 2 );
		for ( let k = 1; k <= nR; k ++ ) {

			const s = k / nR;
			const row = [];
			for ( let j = 0; j < nA; j ++ ) {

				const a = j / nA * TAU;
				const r = rim( a ) * s;
				const x = Math.sin( a ) * r, z = zc + Math.cos( a ) * r;
				const y = top ? Hc * Math.pow( 1 - s * s, 0.6 ) * ( 1 - 0.1 * Math.cos( a ) ) - 0.02 * s * s : - 0.07 * ( 1 - s * s * s ) - 0.015;
				row.push( A.v( x, y, z, 0.5 - z, top ? PART.CARAPACE : PART.SKIN, x / ( W / 2 ), top ? ( z - zc ) / ( L / 2 ) : 2 ) );

			}

			rows.push( row );

		}

		for ( let j = 0; j < nA; j ++ ) {

			const j1 = ( j + 1 ) % nA;
			if ( top ) A.idx.push( centre, rows[ 0 ][ j ], rows[ 0 ][ j1 ] );
			else A.idx.push( centre, rows[ 0 ][ j1 ], rows[ 0 ][ j ] );
			for ( let k = 0; k < nR - 1; k ++ ) {

				const a = rows[ k ][ j ], b = rows[ k ][ j1 ], c = rows[ k + 1 ][ j1 ], d = rows[ k + 1 ][ j ];
				if ( top ) A.idx.push( a, d, b, b, d, c );
				else A.idx.push( a, b, d, b, c, d );

			}

		}

	}

	// head and neck (w = 1: head skin)
	const sides = lod ? 5 : 9;
	tube( A, [
		[ 0, 0.0, zc + L / 2 - 0.08, 0.075, 0.75 ], [ 0, 0.01, zc + L / 2 + 0.02, 0.065, 0.8 ], [ 0, 0.02, zc + L / 2 + 0.1, 0.07, 0.85 ],
		[ 0, 0.02, zc + L / 2 + 0.16, 0.06, 0.8 ], [ 0, 0.0, zc + L / 2 + 0.2, 0.03, 0.7 ],
	], sides, PART.SKIN, () => [ 0, 1 ] );
	// eyes
	if ( lod === 0 ) for ( const s of [ 1, - 1 ] ) {

		const ex = s * 0.052, ez = zc + L / 2 + 0.13;
		tube( A, [ [ ex, 0.035, ez + 0.012, 0.004 ], [ ex * 1.08, 0.037, ez, 0.013 ], [ ex, 0.035, ez - 0.012, 0.004 ] ], 6, PART.EYE, () => [ 0, 0 ] );

	}

	// flippers: flattened tapered tubes from the shoulders (w = flipper id, z = distance along)
	const flipper = ( id, x0, z0, dir, len, width ) => {

		const pts = [];
		const n = lod ? 4 : 8;
		for ( let i = 0; i <= n; i ++ ) {

			const t = i / n;
			// paddle: widest a third of the way out, curving back toward the tip
			const w = width * ( 0.55 + 0.9 * Math.sin( Math.PI * Math.min( 1, 0.15 + t * 0.95 ) ) ) * ( 1 - 0.7 * t * t );
			const x = x0 + dir[ 0 ] * len * t, z = z0 + dir[ 2 ] * len * t - len * 0.25 * t * t;
			pts.push( [ x, - 0.03 - t * 0.02, z, w, 0.22 ] );

		}

		tube( A, pts, lod ? 4 : 7, PART.FLIPPER, ( i, t ) => [ t, id ] );

	};

	const s2 = Math.SQRT1_2;
	flipper( 0, 0.2, zc + 0.2, [ s2 * 1.2, 0, s2 * 0.2 ], 0.48, 0.07 );
	flipper( 1, - 0.2, zc + 0.2, [ - s2 * 1.2, 0, s2 * 0.2 ], 0.48, 0.07 );
	flipper( 2, 0.16, zc - 0.28, [ 0.8, 0, - 0.6 ], 0.2, 0.06 );
	flipper( 3, - 0.16, zc - 0.28, [ - 0.8, 0, - 0.6 ], 0.2, 0.06 );
	// short tail
	tube( A, [ [ 0, - 0.02, zc - L / 2 + 0.02, 0.035, 0.6 ], [ 0, - 0.03, zc - L / 2 - 0.08, 0.004, 0.6 ] ], lod ? 3 : 5, PART.SKIN, () => [ 0, 1 ] );
	return A.build();

}
