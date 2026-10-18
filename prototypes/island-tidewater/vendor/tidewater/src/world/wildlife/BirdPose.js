import { SPECIES } from './BirdShapes.js';
import { qAxis, qMul, clamp } from './Kit.js';

// Pose of one bird as the renderer wants it (see BirdBatch), plus helpers that turn wing / leg /
// head articulation into it. All vectors are plain arrays; nothing is allocated per frame.

const _t = [ 0, 0, 0, 1 ], _u = [ 0, 0, 0, 1 ];

export function createPose( species, seed = 0 ) {

	return {
		species, seed, sp: SPECIES[ species ],
		pos: [ 0, 0, 0 ], scale: 1, q: [ 0, 0, 0, 1 ],
		QA: [ 0, 0, 0, 1 ], QB: [ 0, 0, 0, 1 ], QC: [ 0, 0, 0, 1 ],
		qH: [ 0, 0, 0, 1 ], headOff: [ 0, 0, 0 ], fold: 0,
		kneeL: [ 0, 0, 0 ], footL: [ 0, 0, 0 ], kneeR: [ 0, 0, 0 ], footR: [ 0, 0, 0 ],
		tailPitch: 0, tailSpread: 1,
		pPos: [ 0, 0, 0 ], pScale: 1, pQ: [ 0, 0, 0, 1 ], pQA: [ 0, 0, 0, 1 ], pQB: [ 0, 0, 0, 1 ], pQC: [ 0, 0, 0, 1 ],
		fresh: true,
	};

}

// Remember this frame's body and wing pose as the previous one (call before changing it).
export function storePrevious( P ) {

	for ( let i = 0; i < 3; i ++ ) P.pPos[ i ] = P.pos[ i ];
	for ( let i = 0; i < 4; i ++ ) {

		P.pQ[ i ] = P.q[ i ];
		P.pQA[ i ] = P.QA[ i ];
		P.pQB[ i ] = P.QB[ i ];
		P.pQC[ i ] = P.QC[ i ];

	}

	P.pScale = P.scale;

}

// no motion blur on the first frame (or after a teleport)
export function resetPrevious( P ) {

	storePrevious( P );
	P.fresh = false;

}

// Wing articulation (left wing; the right one mirrors it), radians:
//   elev: shoulder elevation (wing up > 0)   sweep: shoulder sweep (back > 0)
//   twist: leading edge down > 0             elbow, wrist: flexion (folding back > 0)
//   hand: hand elevation relative to the forearm (tip up > 0), handTwist
export function setWings( P, elev, sweep, twist, elbow, wrist, hand, handTwist = 0 ) {

	const A = P.QA, B = P.QB, C = P.QC;
	qAxis( A, 0, 0, 1, elev );
	qMul( A, A, qAxis( _t, 0, 1, 0, sweep ) );
	qMul( A, A, qAxis( _t, 1, 0, 0, twist ) );
	qMul( B, A, qAxis( _t, 0, 1, 0, elbow ) );
	qMul( C, B, qAxis( _t, 0, 1, 0, wrist ) );
	qMul( C, C, qAxis( _u, 0, 0, 1, hand ) );
	if ( handTwist !== 0 ) qMul( C, C, qAxis( _t, 1, 0, 0, handTwist ) );

}

// Flapping wing at phase ph (0 = top of the stroke), amplitude amp (0 = glide pose g).
// g: { elev, sweep, twist, elbow, wrist, hand } glide articulation of the species.
export function flapWings( P, g, ph, amp, extra = 0 ) {

	// downstroke takes a little longer than the upstroke
	const w = ph - 0.12 * Math.sin( ph );
	const c = Math.cos( w ), s = Math.sin( w );
	const up = amp * Math.max( 0, - s ); // upstroke: the wing half folds and is swept back
	const elev = g.elev + amp * ( 0.9 * c + 0.12 ) + extra;
	const hand = g.hand + amp * 0.55 * Math.cos( w - 0.7 ) - up * 0.25;
	setWings( P,
		elev,
		g.sweep - amp * 0.18 * s + up * 0.1,
		g.twist + amp * 0.22 * s,
		g.elbow + up * 0.55,
		g.wrist + up * 0.9,
		hand,
		- amp * 0.15 * s,
	);

}

// two-bone leg: hip -> knee -> foot (body frame), the joint bends backward (bird "knee")
export function solveLeg( knee, foot, hx, hy, hz, fx, fy, fz, a, b ) {

	let dx = fx - hx, dy = fy - hy, dz = fz - hz;
	let d = Math.hypot( dx, dy, dz );
	const maxD = ( a + b ) * 0.999;
	if ( d > maxD ) {

		const k = maxD / d;
		dx *= k; dy *= k; dz *= k;
		d = maxD;
		fx = hx + dx; fy = hy + dy; fz = hz + dz;

	}

	foot[ 0 ] = fx; foot[ 1 ] = fy; foot[ 2 ] = fz;
	// distance of the knee along hip -> foot and away from it
	const x = ( a * a - b * b + d * d ) / ( 2 * Math.max( d, 1e-6 ) );
	const h = Math.sqrt( Math.max( 0, a * a - x * x ) );
	const inv = 1 / Math.max( d, 1e-6 );
	const ux = dx * inv, uy = dy * inv, uz = dz * inv;
	// bend direction: backward (-z), made perpendicular to the leg
	let bx = 0, by = 0, bz = - 1;
	const dp = bx * ux + by * uy + bz * uz;
	bx -= ux * dp; by -= uy * dp; bz -= uz * dp;
	const bl = Math.hypot( bx, by, bz ) || 1;
	knee[ 0 ] = hx + ux * x + bx / bl * h;
	knee[ 1 ] = hy + uy * x + by / bl * h;
	knee[ 2 ] = hz + uz * x + bz / bl * h;

}

// legs standing / stepping: feet at body-frame positions (fx, fy, fz) for the left foot (the
// right mirrors x)
export function setLegs( P, lx, ly, lz, rx, ry, rz ) {

	const L = P.sp.legs;
	solveLeg( P.kneeL, P.footL, L.hip[ 0 ], L.hip[ 1 ], L.hip[ 2 ], lx, ly, lz, L.tibia, L.tarsus );
	solveLeg( P.kneeR, P.footR, - L.hip[ 0 ], L.hip[ 1 ], L.hip[ 2 ], rx, ry, rz, L.tibia, L.tarsus );

}

// legs tucked into the belly feathers (flight): collapsed, not drawn
export function tuckLegs( P, dangle = 0 ) {

	const L = P.sp.legs;
	if ( dangle <= 0.001 ) {

		for ( const s of [ 1, - 1 ] ) {

			const k = s > 0 ? P.kneeL : P.kneeR, f = s > 0 ? P.footL : P.footR;
			k[ 0 ] = f[ 0 ] = s * L.hip[ 0 ];
			k[ 1 ] = f[ 1 ] = L.hip[ 1 ];
			k[ 2 ] = f[ 2 ] = L.hip[ 2 ];

		}

		return;

	}

	// lowered for landing: hanging down and a little forward
	const reach = ( L.tibia + L.tarsus ) * ( 0.55 + 0.4 * dangle );
	const fy = L.hip[ 1 ] - reach * 0.85, fz = L.hip[ 2 ] + reach * 0.35 * dangle - reach * 0.4 * ( 1 - dangle );
	setLegs( P, L.hip[ 0 ] * 0.9, fy, fz, - L.hip[ 0 ] * 0.9, fy, fz );

}

// head turned by yaw (left > 0) and pitch (down > 0), shifted by (ox, oy, oz) in the body frame
export function setHead( P, yaw, pitch, ox = 0, oy = 0, oz = 0 ) {

	qAxis( P.qH, 0, 1, 0, yaw );
	qMul( P.qH, P.qH, qAxis( _t, 1, 0, 0, pitch ) );
	P.headOff[ 0 ] = ox; P.headOff[ 1 ] = oy; P.headOff[ 2 ] = oz;

}

// standing height of the body origin above the feet for a species (legs slightly bent)
export function standHeight( sp, bend = 0.9 ) {

	const L = sp.legs;
	return - L.hip[ 1 ] + ( L.tibia + L.tarsus ) * bend * 0.93;

}

export const clampAngle = ( a, m ) => clamp( a, - m, m );

// Standing / walking bird: body origin at (x, y + height, z) facing yaw, pitched up by pitch
// (level body frame -> body frame), feet on the ground plane y. gait: phase of the stride (feet
// alternate), stride length and step height (0 = standing still), spread: feet apart.
const _qg = [ 0, 0, 0, 1 ];
export function groundPose( P, x, y, z, yaw, pitch, height, phase = 0, stride = 0, lift = 0, spread = 1 ) {

	const L = P.sp.legs;
	P.pos[ 0 ] = x; P.pos[ 1 ] = y + height; P.pos[ 2 ] = z;
	qAxis( P.q, 0, 1, 0, yaw );
	qMul( P.q, P.q, qAxis( _qg, 1, 0, 0, - pitch ) );
	const c = Math.cos( pitch ), s = Math.sin( pitch );
	const fx = L.hip[ 0 ] * 0.9 * spread;
	const base = L.hip[ 2 ] * c + 0.25 * L.tarsus * s;
	for ( let k = 0; k < 2; k ++ ) {

		const ph = phase + k * Math.PI;
		const fz = base + Math.sin( ph ) * stride * 0.5;
		const fy = - height + Math.max( 0, Math.cos( ph ) ) * lift;
		const lx = k === 0 ? fx : - fx;
		// level frame -> body frame
		const by = fy * c - fz * s, bz = fy * s + fz * c;
		if ( k === 0 ) solveLeg( P.kneeL, P.footL, L.hip[ 0 ], L.hip[ 1 ], L.hip[ 2 ], lx, by, bz, L.tibia, L.tarsus );
		else solveLeg( P.kneeR, P.footR, - L.hip[ 0 ], L.hip[ 1 ], L.hip[ 2 ], lx, by, bz, L.tibia, L.tarsus );

	}

}
