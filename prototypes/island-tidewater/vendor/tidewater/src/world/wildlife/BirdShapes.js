import * as THREE from '../../engine/index.js';

// Bird species and their shared-topology template.
//
// Every species is built from the same vertex / triangle layout (lofted body with neck and head,
// lofted bill, fan tail, two three-bone wings with an airfoil section, two legs), so one
// instanced draw renders them all: the vertex shader fetches the species' own rest shape by
// vertex index (BirdBatch). Rest pose: flight posture, wings spread along +x (left wing; the
// right wing mirrors it), forward = +z, y up, metres, origin at the centre of mass.
//
// Per vertex and species (4 vec4):
//   A = rest position, part            (0 body, 1 neck, 2 head, 3 bill, 4 tail, 5 arm, 6 forearm,
//                                        7 hand, 8 leg)
//   B = rest normal, blend weight      (neck: 1 body .. 0 head; wing: weight of the parent bone)
//   C = folded position, u             (wings: laid along the flank; u, v: pattern coordinates)
//   D = folded normal, v
// Legs are built in the shader from the posed knee / foot: A = ( side, segment, t, 8 ),
// B = ( cos, sin, radius scale, 0 ), C = toe offset (feet).

export const BIRD = { GULL: 0, TERN: 1, PELICAN: 2, FRIGATE: 3, SANDERLING: 4 };

// body stations: [ z, y, half width, half height above, half height below ] from the tail base
// to the forehead. neck: z range blending body -> head; pivot: neck joint (head rotation)
export const SPECIES = [
	{
		name: 'laughing gull', length: 0.42, span: 1.03,
		body: [
			[ - 0.125, 0.012, 0.017, 0.01, 0.01 ], [ - 0.095, 0.007, 0.033, 0.024, 0.027 ], [ - 0.045, 0, 0.049, 0.038, 0.045 ],
			[ 0.01, 0, 0.054, 0.042, 0.049 ], [ 0.055, 0.005, 0.049, 0.039, 0.045 ], [ 0.088, 0.014, 0.036, 0.033, 0.033 ],
			[ 0.108, 0.022, 0.029, 0.03, 0.027 ], [ 0.132, 0.027, 0.028, 0.03, 0.024 ], [ 0.154, 0.025, 0.021, 0.025, 0.018 ],
			[ 0.17, 0.02, 0.012, 0.015, 0.012 ],
		],
		neck: [ 0.066, 0.104 ], pivot: [ 0, 0.012, 0.08 ],
		bill: { z: 0.163, y: 0.018, len: 0.046, pitch: - 0.07, w: 0.0056, up: 0.0068, low: 0.0062, hook: 0.0035, gonys: 0.0022, pouch: 0 },
		tail: { z: - 0.118, y: 0.012, w: 0.017, len: [ 0.112, 0.113, 0.115, 0.116 ], spread: 0.32 },
		wing: {
			root: [ 0.03, 0.022, 0.03 ], span: 0.485, elbow: 0.23, wrist: 0.47, thick: [ 0.15, 0.08, 0.035 ],
			le: [ [ 0, 0.045 ], [ 0.23, 0.052 ], [ 0.47, 0.046 ], [ 0.7, 0.008 ], [ 0.87, - 0.042 ], [ 1, - 0.1 ] ],
			chord: [ [ 0, 0.165 ], [ 0.23, 0.165 ], [ 0.47, 0.15 ], [ 0.7, 0.112 ], [ 0.87, 0.072 ], [ 1, 0.014 ] ],
		},
		fold: { front: 0.07, tip: - 0.285, top: 0.034, h: 0.058, minX: 0.009 },
		legs: { hip: [ 0.022, - 0.03, - 0.004 ], tibia: 0.048, tarsus: 0.052, r: 0.0034, toe: 0.036, web: 1 },
		eye: [ 0.142, 0.034, 0.0036 ],
	},
	{
		name: 'royal tern', length: 0.47, span: 1.3,
		body: [
			[ - 0.12, 0.012, 0.016, 0.009, 0.009 ], [ - 0.09, 0.006, 0.03, 0.021, 0.023 ], [ - 0.045, 0, 0.043, 0.033, 0.037 ],
			[ 0.01, 0, 0.046, 0.036, 0.04 ], [ 0.055, 0.004, 0.04, 0.033, 0.036 ], [ 0.088, 0.013, 0.027, 0.027, 0.026 ],
			[ 0.11, 0.021, 0.022, 0.03, 0.021 ], [ 0.133, 0.025, 0.022, 0.028, 0.019 ], [ 0.155, 0.023, 0.017, 0.02, 0.015 ],
			[ 0.17, 0.019, 0.01, 0.012, 0.01 ],
		],
		neck: [ 0.066, 0.105 ], pivot: [ 0, 0.012, 0.08 ],
		bill: { z: 0.162, y: 0.017, len: 0.064, pitch: - 0.1, w: 0.0058, up: 0.0062, low: 0.0058, hook: 0.0012, gonys: 0.0015, pouch: 0 },
		tail: { z: - 0.114, y: 0.012, w: 0.016, len: [ 0.085, 0.098, 0.128, 0.168 ], spread: 0.24 },
		wing: {
			root: [ 0.028, 0.02, 0.028 ], span: 0.62, elbow: 0.2, wrist: 0.43, thick: [ 0.14, 0.07, 0.03 ],
			le: [ [ 0, 0.04 ], [ 0.2, 0.05 ], [ 0.43, 0.045 ], [ 0.7, 0.0 ], [ 0.88, - 0.06 ], [ 1, - 0.13 ] ],
			chord: [ [ 0, 0.15 ], [ 0.2, 0.15 ], [ 0.43, 0.135 ], [ 0.7, 0.1 ], [ 0.88, 0.06 ], [ 1, 0.012 ] ],
		},
		fold: { front: 0.07, tip: - 0.25, top: 0.031, h: 0.05, minX: 0.008 },
		legs: { hip: [ 0.02, - 0.028, 0.0 ], tibia: 0.03, tarsus: 0.032, r: 0.0032, toe: 0.03, web: 0.8 },
		eye: [ 0.142, 0.031, 0.0034 ],
	},
	{
		name: 'brown pelican', length: 1.25, span: 2.1,
		body: [
			[ - 0.31, 0.03, 0.045, 0.028, 0.028 ], [ - 0.245, 0.02, 0.09, 0.068, 0.07 ], [ - 0.12, 0, 0.13, 0.1, 0.11 ],
			[ 0.02, 0, 0.14, 0.11, 0.12 ], [ 0.12, 0.012, 0.125, 0.105, 0.11 ], [ 0.19, 0.05, 0.088, 0.095, 0.09 ],
			[ 0.225, 0.105, 0.058, 0.066, 0.068 ], [ 0.255, 0.135, 0.046, 0.05, 0.042 ], [ 0.28, 0.139, 0.039, 0.044, 0.034 ],
			[ 0.302, 0.131, 0.026, 0.029, 0.024 ],
		],
		neck: [ 0.13, 0.215 ], pivot: [ 0, 0.06, 0.16 ],
		bill: { z: 0.288, y: 0.126, len: 0.33, pitch: - 0.3, w: 0.027, up: 0.013, low: 0.012, hook: 0.013, gonys: 0, pouch: 0.05 },
		tail: { z: - 0.3, y: 0.03, w: 0.045, len: [ 0.145, 0.143, 0.138, 0.128 ], spread: 0.36 },
		wing: {
			root: [ 0.1, 0.07, 0.08 ], span: 0.95, elbow: 0.28, wrist: 0.55, thick: [ 0.14, 0.08, 0.035 ],
			le: [ [ 0, 0.11 ], [ 0.28, 0.11 ], [ 0.55, 0.09 ], [ 0.8, 0.035 ], [ 0.93, - 0.02 ], [ 1, - 0.085 ] ],
			chord: [ [ 0, 0.43 ], [ 0.28, 0.41 ], [ 0.55, 0.38 ], [ 0.8, 0.31 ], [ 0.93, 0.23 ], [ 1, 0.11 ] ],
		},
		fold: { front: 0.17, tip: - 0.42, top: 0.1, h: 0.15, minX: 0.025 },
		legs: { hip: [ 0.06, - 0.09, - 0.03 ], tibia: 0.085, tarsus: 0.075, r: 0.0085, toe: 0.095, web: 1 },
		eye: [ 0.268, 0.146, 0.007 ],
	},
	{
		name: 'magnificent frigatebird', length: 1.0, span: 2.3,
		body: [
			[ - 0.172, 0.012, 0.022, 0.015, 0.015 ], [ - 0.12, 0.004, 0.048, 0.036, 0.038 ], [ - 0.04, 0, 0.068, 0.053, 0.058 ],
			[ 0.045, 0, 0.068, 0.053, 0.06 ], [ 0.11, 0.01, 0.047, 0.043, 0.045 ], [ 0.15, 0.022, 0.031, 0.033, 0.032 ],
			[ 0.178, 0.029, 0.03, 0.033, 0.028 ], [ 0.203, 0.031, 0.029, 0.032, 0.026 ], [ 0.224, 0.028, 0.022, 0.025, 0.019 ],
			[ 0.24, 0.024, 0.013, 0.015, 0.011 ],
		],
		neck: [ 0.105, 0.16 ], pivot: [ 0, 0.02, 0.125 ],
		bill: { z: 0.233, y: 0.024, len: 0.115, pitch: - 0.04, w: 0.0075, up: 0.0075, low: 0.006, hook: 0.013, gonys: 0, pouch: 0 },
		tail: { z: - 0.165, y: 0.012, w: 0.02, len: [ 0.14, 0.2, 0.31, 0.42 ], spread: 0.1 },
		wing: {
			root: [ 0.05, 0.03, 0.05 ], span: 1.1, elbow: 0.19, wrist: 0.41, thick: [ 0.13, 0.07, 0.03 ],
			le: [ [ 0, 0.07 ], [ 0.19, 0.08 ], [ 0.41, 0.09 ], [ 0.68, 0.01 ], [ 0.88, - 0.09 ], [ 1, - 0.19 ] ],
			chord: [ [ 0, 0.3 ], [ 0.19, 0.29 ], [ 0.41, 0.26 ], [ 0.68, 0.17 ], [ 0.88, 0.09 ], [ 1, 0.018 ] ],
		},
		fold: { front: 0.11, tip: - 0.48, top: 0.05, h: 0.075, minX: 0.012 },
		legs: { hip: [ 0.03, - 0.05, 0.0 ], tibia: 0.022, tarsus: 0.022, r: 0.005, toe: 0.04, web: 0.6 },
		eye: [ 0.212, 0.04, 0.0055 ],
	},
	{
		name: 'sanderling', length: 0.2, span: 0.38,
		body: [
			[ - 0.066, 0.007, 0.011, 0.007, 0.007 ], [ - 0.046, 0.004, 0.021, 0.017, 0.019 ], [ - 0.016, 0, 0.029, 0.025, 0.029 ],
			[ 0.014, 0, 0.03, 0.026, 0.029 ], [ 0.038, 0.004, 0.025, 0.023, 0.024 ], [ 0.056, 0.012, 0.017, 0.018, 0.016 ],
			[ 0.069, 0.017, 0.016, 0.018, 0.015 ], [ 0.082, 0.019, 0.015, 0.017, 0.013 ], [ 0.093, 0.017, 0.011, 0.013, 0.009 ],
			[ 0.1, 0.014, 0.006, 0.007, 0.005 ],
		],
		neck: [ 0.043, 0.062 ], pivot: [ 0, 0.008, 0.05 ],
		bill: { z: 0.096, y: 0.0135, len: 0.027, pitch: - 0.06, w: 0.0026, up: 0.0028, low: 0.0024, hook: 0.0004, gonys: 0, pouch: 0 },
		tail: { z: - 0.062, y: 0.008, w: 0.01, len: [ 0.05, 0.048, 0.045, 0.041 ], spread: 0.3 },
		wing: {
			root: [ 0.016, 0.012, 0.012 ], span: 0.174, elbow: 0.22, wrist: 0.46, thick: [ 0.15, 0.08, 0.035 ],
			le: [ [ 0, 0.016 ], [ 0.22, 0.019 ], [ 0.46, 0.017 ], [ 0.7, 0.001 ], [ 0.88, - 0.016 ], [ 1, - 0.038 ] ],
			chord: [ [ 0, 0.06 ], [ 0.22, 0.058 ], [ 0.46, 0.052 ], [ 0.7, 0.04 ], [ 0.88, 0.025 ], [ 1, 0.005 ] ],
		},
		fold: { front: 0.035, tip: - 0.1, top: 0.022, h: 0.03, minX: 0.005 },
		legs: { hip: [ 0.011, - 0.021, 0.004 ], tibia: 0.02, tarsus: 0.024, r: 0.0019, toe: 0.017, web: 0 },
		eye: [ 0.081, 0.025, 0.0024 ],
	},
];

// ---------------------------------------------------------------- topology

const NB = 12, NR = 10; // body rings, vertices around
const RING_S = [ 0, 0.06, 0.16, 0.29, 0.43, 0.56, 0.66, 0.74, 0.81, 0.875, 0.94, 1 ];
const NBL = 5, NRB = 8; // bill rings, vertices around
const BILL_T = [ 0, 0.22, 0.48, 0.72, 0.9 ];
const NT = 7; // tail rays
const NS = 9; // wing span stations
const WV = [ 0, 0.18, 0.55, 1 ]; // wing chord stations (leading .. trailing edge)
const AIR_TOP = [ 0.05, 1.0, 0.62, 0 ]; // airfoil half thickness above / below the camber line
const AIR_BOT = [ 0.05, 0.42, 0.22, 0 ];
const AIR_CAMBER = [ 0, 0.05, 0.045, 0 ]; // camber (fraction of the chord)

// smooth piecewise profile over [ [ x, value ], ... ]
const prof = ( pts, x ) => {

	if ( x <= pts[ 0 ][ 0 ] ) return pts[ 0 ][ 1 ];
	for ( let i = 1; i < pts.length; i ++ ) {

		if ( x <= pts[ i ][ 0 ] ) {

			const a = pts[ i - 1 ], b = pts[ i ];
			const t = ( x - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			const s = t * t * ( 3 - 2 * t );
			return a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * ( 0.4 * t + 0.6 * s );

		}

	}

	return pts[ pts.length - 1 ][ 1 ];

};

const spow = ( x, e ) => Math.sign( x ) * Math.pow( Math.abs( x ), e );
const smooth01 = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// wing span stations for a species (the elbow and wrist are stations of their own)
function spanStations( W ) {

	const e = W.elbow, w = W.wrist;
	return [ 0, e * 0.5, e, ( e + w ) / 2, w, w + ( 1 - w ) * 0.3, w + ( 1 - w ) * 0.58, w + ( 1 - w ) * 0.82, 1 ];

}

// joint positions of the left wing (rest pose): the bone line runs at ~22% of the chord
export function wingJoints( sp ) {

	const W = sp.wing;
	const at = ( u ) => {

		const le = prof( W.le, u ), c = prof( W.chord, u );
		return [ W.root[ 0 ] + u * W.span, W.root[ 1 ], W.root[ 2 ] + le - c * 0.22 ];

	};

	return { S: at( 0 ), E: at( W.elbow ), W: at( W.wrist ) };

}

// Builds one species. Returns per-vertex arrays (see the header) and the index list.
export function buildBird( sp ) {

	const pos = [], fold = [], part = [], wgt = [], uu = [], vv = [], idx = [];
	const legA = [], legB = []; // leg parameters (stored in place of the rest position / normal)
	const legs = [];
	const vtx = ( p, f, pt, w, u, v ) => {

		pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
		fold.push( f[ 0 ], f[ 1 ], f[ 2 ] );
		part.push( pt );
		wgt.push( w );
		uu.push( u );
		vv.push( v );
		return pos.length / 3 - 1;

	};

	// ---- body loft (tail base -> forehead), closed with a cap at each end
	const B = sp.body;
	const z0 = B[ 0 ][ 0 ], z1 = B[ B.length - 1 ][ 0 ];
	const col = ( k ) => B.map( ( s ) => [ s[ 0 ], s[ k ] ] );
	const Y = col( 1 ), HW = col( 2 ), HT = col( 3 ), HB = col( 4 );
	const neckW = ( z ) => 1 - smooth01( sp.neck[ 0 ], sp.neck[ 1 ], z ); // 1 body .. 0 head
	const partOf = ( z ) => z < sp.neck[ 0 ] ? 0 : z < sp.neck[ 1 ] ? 1 : 2;
	const firstBody = pos.length / 3;
	for ( let i = 0; i < NB; i ++ ) {

		const s = RING_S[ i ];
		const z = z0 + ( z1 - z0 ) * s;
		const y = prof( Y, z ), hw = prof( HW, z ), ht = prof( HT, z ), hb = prof( HB, z );
		for ( let j = 0; j < NR; j ++ ) {

			const th = j / NR * Math.PI * 2; // 0 = top, pi / 2 = left (+x)
			const c = Math.cos( th ), sn = Math.sin( th );
			const p = [ hw * spow( sn, 0.85 ), y + ( c > 0 ? ht : hb ) * spow( c, 0.85 ), z ];
			vtx( p, p, partOf( z ), neckW( z ), s, j / NR );

		}

	}

	const rear = vtx( [ 0, prof( Y, z0 ), z0 - prof( HW, z0 ) * 0.5 ], [ 0, prof( Y, z0 ), z0 - prof( HW, z0 ) * 0.5 ], 0, 1, 0, 0.5 );
	const fz = z1 + prof( HW, z1 ) * 0.6;
	const front = vtx( [ 0, prof( Y, z1 ), fz ], [ 0, prof( Y, z1 ), fz ], 2, 0, 1, 0.5 );
	const P = ( i, j ) => firstBody + i * NR + ( j % NR );
	for ( let i = 0; i < NB - 1; i ++ ) {

		for ( let j = 0; j < NR; j ++ ) idx.push( P( i, j ), P( i + 1, j ), P( i, j + 1 ), P( i, j + 1 ), P( i + 1, j ), P( i + 1, j + 1 ) );

	}

	for ( let j = 0; j < NR; j ++ ) {

		idx.push( rear, P( 0, j ), P( 0, j + 1 ) );
		idx.push( front, P( NB - 1, j + 1 ), P( NB - 1, j ) );

	}

	// ---- bill (starts inside the head), closed at the tip
	const Bl = sp.bill;
	const firstBill = pos.length / 3;
	const billAt = ( t ) => {

		const cz = Bl.z + t * Bl.len * Math.cos( Bl.pitch );
		const cy = Bl.y + t * Bl.len * Math.sin( Bl.pitch ) - Bl.hook * smooth01( 0.72, 1, t ) * 1.3;
		const taper = 1 - 0.72 * Math.pow( t, 1.3 );
		const hw = Bl.w * taper;
		const up = Bl.up * ( 1 - 0.65 * Math.pow( t, 1.2 ) );
		// lower mandible: gonys bulge (gulls), pouch (pelicans)
		const low = Bl.low * ( 1 - 0.7 * Math.pow( t, 1.1 ) ) + Bl.gonys * Math.exp( - Math.pow( ( t - 0.78 ) / 0.08, 2 ) ) + Bl.pouch * Math.sin( Math.PI * Math.min( 1, Math.pow( t, 0.7 ) * 1.05 ) ) * ( 1 - t * 0.6 );
		return { cz, cy, hw, up, low };

	};

	for ( let i = 0; i < NBL; i ++ ) {

		const t = BILL_T[ i ];
		const b = billAt( t );
		for ( let j = 0; j < NRB; j ++ ) {

			const th = j / NRB * Math.PI * 2;
			const c = Math.cos( th ), sn = Math.sin( th );
			const p = [ b.hw * spow( sn, 0.8 ), b.cy + ( c > 0 ? b.up : b.low ) * spow( c, 0.8 ), b.cz ];
			vtx( p, p, 3, 0, t, j / NRB );

		}

	}

	const tip = billAt( 1 );
	const billTip = vtx( [ 0, tip.cy - tip.low * 0.2, tip.cz + 0.002 ], [ 0, tip.cy - tip.low * 0.2, tip.cz + 0.002 ], 3, 0, 1, 0.5 );
	const PB = ( i, j ) => firstBill + i * NRB + ( j % NRB );
	for ( let i = 0; i < NBL - 1; i ++ ) {

		for ( let j = 0; j < NRB; j ++ ) idx.push( PB( i, j ), PB( i + 1, j ), PB( i, j + 1 ), PB( i, j + 1 ), PB( i + 1, j ), PB( i + 1, j + 1 ) );

	}

	for ( let j = 0; j < NRB; j ++ ) idx.push( billTip, PB( NBL - 1, j + 1 ), PB( NBL - 1, j ) );

	// ---- tail: a thin fan (upper and lower layer), rays spread from the tail base
	const T = sp.tail;
	const firstTail = pos.length / 3;
	for ( const layer of [ 1, - 1 ] ) {

		for ( let r = 0; r < 3; r ++ ) {

			const f = r / 2; // 0 base .. 1 tip
			for ( let k = 0; k < NT; k ++ ) {

				const a = k / ( NT - 1 ) * 2 - 1; // -1 .. 1 across
				const len = T.len[ Math.round( Math.abs( a ) * 3 ) ];
				const ang = a * T.spread;
				const bx = a * T.w;
				const p = [
					bx + Math.sin( ang ) * len * f,
					T.y + layer * 0.0012 * ( 1 - f * 0.6 ) * ( sp.length / 0.4 ) - 0.004 * f * f * ( sp.length / 0.4 ),
					T.z - Math.cos( ang ) * len * f,
				];
				vtx( p, p, 4, 0, k / ( NT - 1 ), f );

			}

		}

	}

	const PT = ( layer, r, k ) => firstTail + layer * 3 * NT + r * NT + k;
	for ( let r = 0; r < 2; r ++ ) {

		for ( let k = 0; k < NT - 1; k ++ ) {

			// upper layer faces up, lower layer faces down
			idx.push( PT( 0, r, k ), PT( 0, r, k + 1 ), PT( 0, r + 1, k ), PT( 0, r, k + 1 ), PT( 0, r + 1, k + 1 ), PT( 0, r + 1, k ) );
			idx.push( PT( 1, r, k ), PT( 1, r + 1, k ), PT( 1, r, k + 1 ), PT( 1, r, k + 1 ), PT( 1, r + 1, k ), PT( 1, r + 1, k + 1 ) );

		}

	}

	// ---- wings
	const Wg = sp.wing, Fd = sp.fold;
	const us = spanStations( Wg );
	const flankX = ( y, z ) => {

		// half width of the body at ( y, z ) (0 outside it)
		if ( z < z0 || z > z1 ) return 0;
		const yc = prof( Y, z ), hw = prof( HW, z ), hh = y > yc ? prof( HT, z ) : prof( HB, z );
		const d = ( y - yc ) / hh;
		return d >= 1 ? 0 : hw * Math.sqrt( 1 - d * d );

	};

	for ( const side of [ 1, - 1 ] ) {

		const first = pos.length / 3;
		for ( let i = 0; i < NS; i ++ ) {

			const u = us[ i ];
			const le = prof( Wg.le, u ), c = prof( Wg.chord, u );
			const th = u < Wg.wrist ? Wg.thick[ 0 ] + ( Wg.thick[ 1 ] - Wg.thick[ 0 ] ) * u / Wg.wrist : Wg.thick[ 1 ] + ( Wg.thick[ 2 ] - Wg.thick[ 1 ] ) * ( u - Wg.wrist ) / ( 1 - Wg.wrist );
			const x = Wg.root[ 0 ] + u * Wg.span;
			// bone and blend weight: the joint stations are shared half / half
			let pt, w;
			if ( u < Wg.elbow - 1e-6 ) { pt = 5; w = 0; }
			else if ( u < Wg.elbow + 1e-6 ) { pt = 6; w = 0.5; }
			else if ( u < Wg.wrist - 1e-6 ) { pt = 6; w = 0; }
			else if ( u < Wg.wrist + 1e-6 ) { pt = 7; w = 0.5; }
			else { pt = 7; w = 0; }

			// folded: laid back along the upper flank, primaries bundled over the tail
			const a = Math.pow( u, 0.85 );
			const zfA = Fd.front + ( Fd.tip - Fd.front ) * a;
			const hA = Fd.h * Math.pow( 1 - a, 0.55 ) * ( 1 - 0.25 * a ) + Fd.h * 0.08;
			const ring = [ [ 0, 1 ], [ WV[ 1 ], 1 ], [ WV[ 2 ], 1 ], [ 1, 0 ], [ WV[ 2 ], - 1 ], [ WV[ 1 ], - 1 ] ];
			for ( const [ v, s ] of ring ) {

				const k = WV.indexOf( v );
				const ht = s >= 0 ? AIR_TOP[ k ] : - AIR_BOT[ k ];
				const y = Wg.root[ 1 ] + ( AIR_CAMBER[ k ] + ht * th * ( v === 0 || v === 1 ? 1 : 1 ) ) * c;
				const p = [ side * x, y, Wg.root[ 2 ] + le - v * c ];
				// folded position
				const yTop = prof( Y, Math.min( Math.max( zfA, z0 ), z1 ) ) + Fd.top * ( 1 - 0.55 * a ) - 0.004 * a;
				const yf = yTop - v * hA;
				const zf = zfA - v * hA * 0.35;
				const layer = s >= 0 ? 0.0035 : - 0.001;
				const xf = Math.max( flankX( yf, zf ) * 1.06, Fd.minX * ( 1 - 0.3 * v ) ) + layer * ( sp.length / 0.4 ) + 0.0015 * ( 1 - u );
				vtx( p, [ side * xf, yf, zf ], pt, w, u, s >= 0 ? v : - v );

			}

		}

		const PW = ( i, j ) => first + i * 6 + ( j % 6 );
		for ( let i = 0; i < NS - 1; i ++ ) {

			for ( let j = 0; j < 6; j ++ ) {

				if ( side < 0 ) idx.push( PW( i, j ), PW( i, j + 1 ), PW( i + 1, j ), PW( i, j + 1 ), PW( i + 1, j + 1 ), PW( i + 1, j ) );
				else idx.push( PW( i, j ), PW( i + 1, j ), PW( i, j + 1 ), PW( i, j + 1 ), PW( i + 1, j ), PW( i + 1, j + 1 ) );

			}

		}

	}

	// ---- legs: tube hip -> knee -> ankle (4 sides), webbed / slender foot at the ankle
	const L = sp.legs;
	for ( const side of [ 1, - 1 ] ) {

		const first = pos.length / 3;
		for ( let r = 0; r < 3; r ++ ) {

			for ( let j = 0; j < 4; j ++ ) {

				const a = j / 4 * Math.PI * 2 + Math.PI / 4;
				const i = vtx( [ side, r, 0, 8 ], [ 0, 0, 0 ], 8, 0, r / 2, j / 4 );
				legs.push( i );
				legA[ i ] = [ side, r, 0 ];
				legB[ i ] = [ Math.cos( a ), Math.sin( a ), r === 0 ? 1.25 : r === 1 ? 1.1 : 0.9 ];

			}

		}

		const PL = ( r, j ) => first + r * 4 + ( j % 4 );
		for ( let r = 0; r < 2; r ++ ) {

			for ( let j = 0; j < 4; j ++ ) idx.push( PL( r, j ), PL( r, j + 1 ), PL( r + 1, j ), PL( r, j + 1 ), PL( r + 1, j + 1 ), PL( r + 1, j ) );

		}

		// foot: centre, three toe tips with web points between them (pulled in when not webbed)
		const toe = L.toe;
		const toes = [ - 0.5, 0, 0.5 ];
		const fc = pos.length / 3;
		const footPts = [ [ 0, 0, - toe * 0.12 ] ];
		for ( let k = 0; k < 3; k ++ ) {

			const a = toes[ k ] * side;
			footPts.push( [ Math.sin( a ) * toe, 0, Math.cos( a ) * toe * ( k === 1 ? 1.08 : 0.92 ) ] );
			if ( k < 2 ) {

				const b = ( toes[ k ] + 0.25 ) * side;
				const wr = toe * ( 0.22 + 0.55 * L.web );
				footPts.push( [ Math.sin( b ) * wr, 0, Math.cos( b ) * wr ] );

			}

		}

		for ( const f of footPts ) {

			const i = vtx( [ side, 3, 0, 8 ], f, 8, 0, 1, 0 );
			legs.push( i );
			legA[ i ] = [ side, 3, 0 ];
			legB[ i ] = [ 0, 0, 0 ];

		}

		for ( let k = 1; k < footPts.length - 1; k ++ ) {

			if ( side > 0 ) idx.push( fc, fc + k + 1, fc + k );
			else idx.push( fc, fc + k, fc + k + 1 );

		}

	}

	// ---- normals of the rest and the folded shape
	const n = pos.length / 3;
	const normalsOf = ( arr ) => {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( arr, 3 ) );
		g.setIndex( idx );
		g.computeVertexNormals();
		return g.attributes.normal.array;

	};

	const nRest = normalsOf( pos ), nFold = normalsOf( fold );
	const A = new Float32Array( n * 4 ), Bn = new Float32Array( n * 4 ), C = new Float32Array( n * 4 ), D = new Float32Array( n * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const isLeg = part[ i ] === 8;
		const la = legA[ i ], lb = legB[ i ];
		A.set( isLeg ? [ la[ 0 ], la[ 1 ], la[ 2 ], 8 ] : [ pos[ i * 3 ], pos[ i * 3 + 1 ], pos[ i * 3 + 2 ], part[ i ] ], i * 4 );
		Bn.set( isLeg ? [ lb[ 0 ], lb[ 1 ], lb[ 2 ], 0 ] : [ nRest[ i * 3 ], nRest[ i * 3 + 1 ], nRest[ i * 3 + 2 ], wgt[ i ] ], i * 4 );
		C.set( [ fold[ i * 3 ], fold[ i * 3 + 1 ], fold[ i * 3 + 2 ], uu[ i ] ], i * 4 );
		D.set( [ nFold[ i * 3 ], nFold[ i * 3 + 1 ], nFold[ i * 3 + 2 ], vv[ i ] ], i * 4 );

	}

	return { count: n, A, B: Bn, C, D, index: idx, joints: wingJoints( sp ) };

}
