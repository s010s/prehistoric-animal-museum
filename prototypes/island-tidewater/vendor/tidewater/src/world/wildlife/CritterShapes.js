import * as THREE from '../../engine/index.js';

// Beach critters sharing one template: ghost crab, hermit crab (in a turban shell) and the crab
// burrow (a dark hole in a fan of dug-out sand).
//
// Units: carapace widths (the instance scale is the carapace width in metres). Frame: +z the
// crab's front (eyes), +x its left, y up, origin on the ground under the body centre.
//
// Vertices:
//   body  NU x NV grid + two poles, per species (storage buffer: A = position, part 0; B = normal,
//         pattern v) - carapace, shell, or burrow mound
//   limbs parametric (vertex attributes, same for every species), placed in the shader from the
//         species' limb table and the gait: 8 walking legs, 2 claws, 2 eyestalks
//         aLimb = ( limb index, segment, t along, radius scale ), aRing = ( cos, sin ) around

export const CRITTER = { GHOST: 0, HERMIT: 1, BURROW: 2 };

export const NU = 12, NV = 9;
export const BODY_VERTS = NU * NV + 2;

// limbs: 0..7 legs (left 0..3 front to back, right 4..7), 8 / 9 claws (left / right), 10 / 11 eyes
export const LIMBS = 12;

const spow = ( x, e ) => Math.sign( x ) * Math.pow( Math.abs( x ), e );
const smooth01 = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// ---- body grids (v from the top pole to the bottom pole, u around from the front)

function carapace( u, v ) {

	// ghost crab: squarish, wider than long, convex top, flat underside, straight front edge
	const W = 0.5, L = 0.43, HT = 0.2, HB = 0.1;
	const th = u * Math.PI * 2;
	const cu = Math.cos( th ), su = Math.sin( th );
	const phi = v * Math.PI;
	const rh = Math.pow( Math.sin( phi ), 0.55 );
	const cy = Math.cos( phi );
	let z = L * spow( cu, 0.35 ) * rh;
	const x = W * spow( su, 0.35 ) * rh * ( 1 - 0.12 * Math.max( 0, - cu ) ); // narrower behind
	if ( z > 0 ) z *= 1 - 0.05 * ( 1 - Math.abs( su ) ); // straight front
	const y = cy > 0 ? HT * spow( cy, 0.6 ) : HB * spow( cy, 0.8 );
	return [ x, y + 0.02 * Math.cos( th ) * rh, z ];

}

function shell( u, v ) {

	// turban shell: low spire at the back, big round body whorl resting on the sand, the aperture
	// facing forward and down (the pattern paints the sutures and the aperture)
	const th = u * Math.PI * 2;
	const a = prof( SHELL_A, v ), r = prof( SHELL_R, v );
	const px = r * Math.sin( th ), py = r * Math.cos( th );
	// axis from the apex (back, up) to the base (front, low), tilted 38 degrees
	const t = 0.66, ca = Math.cos( t ), sa = Math.sin( t );
	return [ px, 0.74 - a * sa + py * ca, 0.05 + a * ca + py * sa ];

}

const SHELL_A = [ [ 0, - 0.9 ], [ 0.15, - 0.7 ], [ 0.35, - 0.42 ], [ 0.55, - 0.12 ], [ 0.72, 0.12 ], [ 0.86, 0.32 ], [ 0.95, 0.46 ], [ 1, 0.5 ] ];
const SHELL_R = [ [ 0, 0 ], [ 0.15, 0.2 ], [ 0.35, 0.42 ], [ 0.55, 0.62 ], [ 0.72, 0.72 ], [ 0.86, 0.66 ], [ 0.95, 0.44 ], [ 1, 0.18 ] ];

const prof = ( pts, x ) => {

	if ( x <= pts[ 0 ][ 0 ] ) return pts[ 0 ][ 1 ];
	for ( let i = 1; i < pts.length; i ++ ) {

		if ( x <= pts[ i ][ 0 ] ) {

			const a = pts[ i - 1 ], b = pts[ i ];
			const t = ( x - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			return a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * ( t * t * ( 3 - 2 * t ) );

		}

	}

	return pts[ pts.length - 1 ][ 1 ];

};

function burrow( u, v ) {

	// dark hole ringed by a raised lip, dug sand fanned out in front (+z)
	const th = u * Math.PI * 2;
	const fan = 1 + 1.4 * Math.max( 0, Math.cos( th ) ) ** 2;
	const r = v < 0.34 ? 0.5 * v / 0.34 : 0.5 + ( v - 0.34 ) / 0.66 * 1.6 * fan;
	const lip = Math.exp( - Math.pow( ( v - 0.4 ) / 0.1, 2 ) ) * 0.2;
	const mound = v > 0.34 ? 0.12 * Math.sin( Math.PI * ( v - 0.34 ) / 0.66 ) * ( fan - 0.6 ) : 0;
	const y = v < 0.34 ? - 0.05 + 0.2 * Math.pow( v / 0.34, 2 ) : lip + mound;
	return [ r * Math.sin( th ), Math.max( y, 0 ) * 0.9 + 0.01, r * Math.cos( th ) ];

}

const BODIES = [ carapace, shell, burrow ];

// limb tables per species: for every limb ( attach xyz, azimuth ) ( len1, len2, len3, radius )
// azimuth: direction in the horizontal plane (0 = +x, the crab's left; pi/2 = front)
function limbTable( species ) {

	const out = [];
	const leg = ( s, j, L, r ) => {

		const az = [ 0.62, 0.2, - 0.18, - 0.6 ][ j ];
		const a = s > 0 ? az : Math.PI - az;
		out.push( new THREE.Vector4( s * 0.44, 0.06, 0.2 - j * 0.14, a ), new THREE.Vector4( L[ 0 ], L[ 1 ], L[ 2 ], r ) );

	};

	if ( species === 0 ) {

		// ghost crab: long legs (span ~3 carapace widths), unequal claws, tall club eyestalks
		for ( const s of [ 1, - 1 ] ) for ( let j = 0; j < 4; j ++ ) leg( s, j, [ 0.58 - j * 0.02, 0.28, 0.55 - Math.abs( j - 1.5 ) * 0.05 ], 0.045 );
		out.push( new THREE.Vector4( 0.22, 0.05, 0.38, 1.25 ), new THREE.Vector4( 0.3, 0.22, 0.34, 0.07 ) );
		out.push( new THREE.Vector4( - 0.22, 0.05, 0.38, Math.PI - 1.25 ), new THREE.Vector4( 0.26, 0.18, 0.27, 0.055 ) );
		out.push( new THREE.Vector4( 0.36, 0.17, 0.4, 1.35 ), new THREE.Vector4( 0.2, 0.18, 0, 0.05 ) );
		out.push( new THREE.Vector4( - 0.36, 0.17, 0.4, Math.PI - 1.35 ), new THREE.Vector4( 0.2, 0.18, 0, 0.05 ) );

	} else if ( species === 1 ) {

		// hermit crab: two pairs of walking legs out of the shell, a big purple left claw
		for ( const s of [ 1, - 1 ] ) for ( let j = 0; j < 4; j ++ ) leg( s, j, j < 2 ? [ 0.36, 0.22, 0.34 ] : [ 0, 0, 0 ], 0.06 );
		for ( let k = 0; k < 8; k += 2 ) out[ k ].z += 0.32; // legs come out of the aperture (front)
		out.push( new THREE.Vector4( 0.14, 0.12, 0.62, 1.35 ), new THREE.Vector4( 0.18, 0.14, 0.34, 0.1 ) );
		out.push( new THREE.Vector4( - 0.14, 0.12, 0.6, Math.PI - 1.35 ), new THREE.Vector4( 0.14, 0.1, 0.2, 0.065 ) );
		out.push( new THREE.Vector4( 0.08, 0.3, 0.66, 1.45 ), new THREE.Vector4( 0.18, 0.1, 0, 0.035 ) );
		out.push( new THREE.Vector4( - 0.08, 0.3, 0.66, Math.PI - 1.45 ), new THREE.Vector4( 0.18, 0.1, 0, 0.035 ) );

	} else {

		for ( let k = 0; k < LIMBS; k ++ ) out.push( new THREE.Vector4(), new THREE.Vector4() );

	}

	return out;

}

// Builds the template: body grids of every species (storage data) and the limb vertices.
export function buildCritters() {

	const idx = [];
	const S = BODIES.length;
	const bodyData = new Float32Array( S * BODY_VERTS * 8 );

	// body grid topology: rings 0..NV-1, poles top (NU * NV) and bottom (+1)
	const G = ( i, j ) => i * NU + ( j % NU );
	const top = NU * NV, bot = top + 1;
	for ( let i = 0; i < NV - 1; i ++ ) {

		for ( let j = 0; j < NU; j ++ ) idx.push( G( i, j ), G( i + 1, j ), G( i, j + 1 ), G( i, j + 1 ), G( i + 1, j ), G( i + 1, j + 1 ) );

	}

	for ( let j = 0; j < NU; j ++ ) {

		idx.push( top, G( 0, j ), G( 0, j + 1 ) );
		idx.push( bot, G( NV - 1, j + 1 ), G( NV - 1, j ) );

	}

	for ( let s = 0; s < S; s ++ ) {

		const f = BODIES[ s ];
		const pos = new Float32Array( BODY_VERTS * 3 ), pv = new Float32Array( BODY_VERTS );
		for ( let i = 0; i < NV; i ++ ) {

			const v = ( i + 1 ) / ( NV + 1 );
			for ( let j = 0; j < NU; j ++ ) {

				pos.set( f( j / NU, v ), G( i, j ) * 3 );
				pv[ G( i, j ) ] = v;

			}

		}

		pos.set( f( 0, 0 ), top * 3 );
		pos.set( f( 0, 1 ), bot * 3 );
		pv[ top ] = 0; pv[ bot ] = 1;
		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
		g.setIndex( idx.slice() );
		g.computeVertexNormals();
		const n = g.attributes.normal.array;
		for ( let i = 0; i < BODY_VERTS; i ++ ) {

			const u = i < top ? ( i % NU ) / NU : 0;
			bodyData.set( [ pos[ i * 3 ], pos[ i * 3 + 1 ], pos[ i * 3 + 2 ], u, n[ i * 3 ], n[ i * 3 + 1 ], n[ i * 3 + 2 ], pv[ i ] ], ( s * BODY_VERTS + i ) * 8 );

		}

	}

	// ---- limbs: rings of 4 (legs, arms, stalks) with a tip; the claw "hand" is a thicker spindle
	const limb = [], ring = [];
	let nv = BODY_VERTS;
	for ( let i = 0; i < BODY_VERTS; i ++ ) {

		limb.push( - 1, 0, 0, 0 );
		ring.push( 0, 0 );

	}

	const add = ( k, seg, t, r, c, s ) => {

		limb.push( k, seg, t, r );
		ring.push( c, s );
		return nv ++;

	};

	for ( let k = 0; k < LIMBS; k ++ ) {

		const isClaw = k === 8 || k === 9, isEye = k >= 10;
		// joints along the limb: segment boundaries 0 .. 3 (legs: coxa, knee, ankle, tip)
		const stations = isClaw ? [ [ 0, 0, 1 ], [ 1, 0, 1 ], [ 2, 0, 1.6 ], [ 2, 0.45, 2.1 ], [ 2, 1, 0.9 ] ] : isEye ? [ [ 0, 0, 1 ], [ 1, 0, 0.8 ], [ 1, 0.5, 1.6 ], [ 1, 1, 1.3 ] ] : [ [ 0, 0, 1.15 ], [ 1, 0, 1 ], [ 2, 0, 0.8 ] ];
		const first = nv;
		for ( const [ seg, t, r ] of stations ) {

			for ( let j = 0; j < 4; j ++ ) {

				const a = j / 4 * Math.PI * 2 + Math.PI / 4;
				add( k, seg, t, r, Math.cos( a ), Math.sin( a ) );

			}

		}

		const tip = add( k, isEye ? 1 : 2, isClaw ? 1.18 : isEye ? 1.12 : 1, 0, 0, 0 );
		const n = stations.length;
		for ( let i = 0; i < n - 1; i ++ ) {

			for ( let j = 0; j < 4; j ++ ) {

				const a = first + i * 4 + j, b = first + i * 4 + ( j + 1 ) % 4;
				idx.push( a, a + 4, b, b, a + 4, b + 4 );

			}

		}

		for ( let j = 0; j < 4; j ++ ) idx.push( first + ( n - 1 ) * 4 + j, tip, first + ( n - 1 ) * 4 + ( j + 1 ) % 4 );

	}

	const g = new THREE.BufferGeometry();
	const p = new Float32Array( nv * 3 ), nn = new Float32Array( nv * 3 );
	for ( let i = 0; i < nv; i ++ ) nn[ i * 3 + 1 ] = 1;
	g.setAttribute( 'position', new THREE.BufferAttribute( p, 3 ) );
	g.setAttribute( 'normal', new THREE.BufferAttribute( nn, 3 ) );
	g.setAttribute( 'aLimb', new THREE.Float32BufferAttribute( limb, 4 ) );
	g.setAttribute( 'aRing', new THREE.Float32BufferAttribute( ring, 2 ) );
	g.setIndex( idx );

	const limbs = [];
	for ( let s = 0; s < S; s ++ ) limbs.push( ...limbTable( s ) );
	return { geometry: g, bodyData, limbs, species: S, vertices: nv, triangles: idx.length / 3 };

}
