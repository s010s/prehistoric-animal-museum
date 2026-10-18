import * as THREE from '../../engine/index.js';

// Procedural fish meshes built from the anatomy tables in FishSpecies.js.
//
// Local frame (total length 1): snout at z = +0.5, tip of the tail fin at z = -0.5, back at +y,
// the body axis on y = 0. Parts:
//  - body: rings of superellipse cross-sections (depth above / below the axis and half width
//    change from the snout to the caudal peduncle). The mouth line splits the head into an upper
//    jaw and a lower jaw (jaw weight 1, rotated about the hinge at the corner of the mouth by
//    the vertex shader) with a mouth cavity behind the lips.
//  - fins: membranes stretched between rays. Every ray is a column of the fin mesh and the
//    membrane dips between the ray tips (deeply for spines). Caudal fins take their outline from
//    the species (forked, lunate, rounded, truncate); pectorals fan out from a short base behind
//    the gill cover; tunas get finlets.
//  - eyes: domes over the painted eye (nearest level of detail).
// Poses: 'swim' (fins spread) and 'dead' (fins relaxed and partly lowered: landed and market fish).
//
// aData per vertex:
//   x: position along the fish (0 snout .. 1 tail tip): swimming wave, bending
//   y: part id + 0.9 * jaw weight
//   z, w: body: arc length around the girth from the dorsal midline, height fraction (-1 belly
//         .. 1 back); fins: position along the ray (0 base .. 1 edge), ray coordinate (integer
//         on the rays); eye: disc coordinates (-1 .. 1); mouth: depth (0 lips .. 1 throat);
//         flesh: coordinates on the cut face

export const PART = {
	BODY: 0, DORSAL1: 1, DORSAL2: 2, ANAL: 3, CAUDAL: 4, PECTORAL: 5, PELVIC: 6, FINLET: 7, EYE: 8,
	MOUTH: 9, FLESH: 10, ICE: 11, LEAF: 12, SHELL: 13, FILLET: 14,
	DISC: 15, WHIP: 16, CARAPACE: 17, SKIN: 18, FLIPPER: 19, // rays and the turtle (CreatureGeometry.js)
};

const TAU = Math.PI * 2;

// smooth piecewise profile: pts = [ [ u, value ], ... ] with increasing u
export const prof = ( pts, u ) => {

	if ( u <= pts[ 0 ][ 0 ] ) return pts[ 0 ][ 1 ];
	for ( let i = 1; i < pts.length; i ++ ) {

		if ( u <= pts[ i ][ 0 ] ) {

			const a = pts[ i - 1 ], b = pts[ i ];
			const t = ( u - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			const s = t * t * ( 3 - 2 * t );
			return a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * ( 0.5 * t + 0.5 * s );

		}

	}

	return pts[ pts.length - 1 ][ 1 ];

};

const lerp = ( a, b, t ) => a + ( b - a ) * t;
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// ---------------------------------------------------------------------------
// mesh accumulator

class MeshData {

	constructor() {

		this.pos = [];
		this.dat = [];
		this.idx = [];
		this.seams = []; // pairs of coincident vertices whose normals are averaged

	}

	v( x, y, z, d0, d1, d2, d3 ) {

		this.pos.push( x, y, z );
		this.dat.push( d0, d1, d2, d3 );
		return this.pos.length / 3 - 1;

	}

	tri( a, b, c ) {

		this.idx.push( a, b, c );

	}

	// a b / d c, counter-clockwise seen from the front
	quad( a, b, c, d ) {

		this.idx.push( a, b, d, b, c, d );

	}

	build() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'aData', new THREE.Float32BufferAttribute( this.dat, 4 ) );
		g.setIndex( this.idx );
		g.computeVertexNormals();
		const n = g.attributes.normal.array;
		for ( const [ a, b ] of this.seams ) {

			let x = n[ a * 3 ] + n[ b * 3 ], y = n[ a * 3 + 1 ] + n[ b * 3 + 1 ], z = n[ a * 3 + 2 ] + n[ b * 3 + 2 ];
			const l = Math.hypot( x, y, z ) || 1;
			x /= l; y /= l; z /= l;
			n[ a * 3 ] = n[ b * 3 ] = x;
			n[ a * 3 + 1 ] = n[ b * 3 + 1 ] = y;
			n[ a * 3 + 2 ] = n[ b * 3 + 2 ] = z;

		}

		g.computeBoundingSphere();
		return g;

	}

}

// ---------------------------------------------------------------------------
// body

// cross-section of species S at u (0 snout .. 1 caudal peduncle)
export function section( S, u ) {

	return { T: prof( S.top, u ), B: prof( S.bot, u ), W: prof( S.wid, u ), e: 2 / S.sec };

}

// point on the section outline at angle phi (0 top, PI / 2 right flank (+x), PI belly)
function outline( c, phi, out ) {

	const s = Math.sin( phi ), k = Math.cos( phi );
	out[ 0 ] = c.W * Math.sign( s ) * Math.pow( Math.abs( s ), c.e );
	out[ 1 ] = ( k >= 0 ? c.T : c.B ) * Math.sign( k ) * Math.pow( Math.abs( k ), c.e );
	return out;

}

// arc length along the outline from the dorsal midline to angle phi (0 .. PI)
function arcTo( c, phi ) {

	const n = 24, p = [ 0, 0 ], q = [ 0, 0 ];
	outline( c, 0, p );
	let s = 0;
	for ( let i = 1; i <= n; i ++ ) {

		outline( c, phi * i / n, q );
		s += Math.hypot( q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] );
		p[ 0 ] = q[ 0 ];
		p[ 1 ] = q[ 1 ];

	}

	return s;

}

// half width of the body surface at height y on the section (0 outside)
export function surfaceX( c, y ) {

	const H = y >= 0 ? c.T : c.B;
	const r = Math.min( 1, Math.abs( y ) / Math.max( H, 1e-4 ) );
	// |x / W| ^ (2 / e) + |y / H| ^ (2 / e) = 1
	const n = 2 / c.e;
	return c.W * Math.pow( Math.max( 0, 1 - Math.pow( r, n ) ), 1 / n );

}

// angle on the outline where it crosses height y on the right flank
function angleAt( c, y ) {

	const e = c.e;
	const k = y >= 0 ? Math.pow( clamp( y / Math.max( c.T, 1e-4 ), 0, 0.97 ), 1 / e ) : - Math.pow( clamp( - y / Math.max( c.B, 1e-4 ), 0, 0.97 ), 1 / e );
	return Math.acos( k );

}

function ringUs( S, lod, u0, u1 ) {

	const n = [ 34, 16, 7, 4 ][ lod ];
	const us = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		us.push( 0.6 * Math.pow( t, 1.55 ) + 0.4 * t ); // denser at the head

	}

	us[ 0 ] = [ 0.006, 0.014, 0.03, 0.05 ][ lod ];
	// rings exactly at the corner of the mouth (jaw hinge) and around the eye
	const snap = ( u ) => {

		let best = 1, bd = Infinity;
		for ( let i = 1; i < us.length - 1; i ++ ) {

			const d = Math.abs( us[ i ] - u );
			if ( d < bd ) {

				bd = d;
				best = i;

			}

		}

		us[ best ] = u;

	};

	if ( lod < 2 ) snap( S.mouth.corner );
	const out = us.filter( ( u ) => u >= u0 - 1e-6 && u <= u1 + 1e-6 );
	if ( out[ 0 ] > u0 + 1e-4 && u0 > 0 ) out.unshift( u0 );
	if ( out[ out.length - 1 ] < u1 - 1e-4 ) out.push( u1 );
	return out;

}

// o: { lod, mouth (split jaws + cavity), u0, u1 (cut pieces: flesh caps at the cut ends) }
function buildBody( M, S, o ) {

	const lod = o.lod;
	const L = S.body;
	const zOf = ( u ) => 0.5 - u * L;
	const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1;
	const NQ = [ 26, 14, 7, 5 ][ lod ];
	const us = ringUs( S, lod, u0, u1 );
	const mouth = o.mouth && u0 === 0;
	const Mo = S.mouth;
	const corner = Mo.corner;
	const mouthY = ( u ) => lerp( Mo.tip, Mo.y, Math.min( 1, u / corner ) );
	// angle of the upper / lower split: the mouth line up to the corner, then kept
	const cCorner = section( S, corner );
	const phiCorner = angleAt( cCorner, Mo.y );
	const nu = clamp( Math.round( NQ * phiCorner / Math.PI ), 3, NQ - 3 ), nl = NQ - nu;
	const jawW = ( u ) => mouth ? 1 - smooth( corner * 0.8, corner * 1.3, u ) : 0;
	const rings = [];
	const p = [ 0, 0 ];

	for ( const u of us ) {

		const c = section( S, u );
		const phiM = u < corner ? angleAt( c, mouthY( u ) ) : angleAt( c, Mo.y * ( c.T + c.B ) / ( cCorner.T + cCorner.B ) );
		const z = zOf( u );
		const jawFwd = 0;
		const ring = { u, upper: [], lower: [] };
		const wj = jawW( u );
		const arcHalf = arcTo( c, Math.PI );
		for ( let j = 0; j <= nu; j ++ ) {

			const phi = - phiM + 2 * phiM * j / nu;
			outline( c, phi, p );
			const s = arcTo( c, Math.abs( phi ) );
			const h = p[ 1 ] >= 0 ? p[ 1 ] / Math.max( c.T, 1e-4 ) : p[ 1 ] / Math.max( c.B, 1e-4 );
			ring.upper.push( M.v( p[ 0 ], p[ 1 ], z, u * L, PART.BODY, s, h ) );

		}

		for ( let j = 0; j <= nl; j ++ ) {

			const phi = phiM + ( TAU - 2 * phiM ) * j / nl;
			outline( c, phi, p );
			const a = phi > Math.PI ? TAU - phi : phi;
			const s = Math.min( arcHalf, arcTo( c, a ) );
			const h = p[ 1 ] >= 0 ? p[ 1 ] / Math.max( c.T, 1e-4 ) : p[ 1 ] / Math.max( c.B, 1e-4 );
			// lips move with the jaw only in front of the corner (behind it the seam stays closed)
			const w = ( j === 0 || j === nl ) && u >= corner ? 0 : wj;
			ring.lower.push( M.v( p[ 0 ], p[ 1 ], z, u * L, PART.BODY + 0.9 * w, s, h ) );

		}

		M.seams.push( [ ring.upper[ nu ], ring.lower[ 0 ] ], [ ring.upper[ 0 ], ring.lower[ nl ] ] );
		ring.c = c;
		ring.z = z;
		ring.phiM = phiM;
		ring.wj = wj;
		ring.jawFwd = jawFwd;
		rings.push( ring );

	}

	// skin between the rings
	for ( let i = 0; i < rings.length - 1; i ++ ) {

		const A = rings[ i ], B = rings[ i + 1 ];
		for ( let j = 0; j < nu; j ++ ) M.quad( A.upper[ j ], A.upper[ j + 1 ], B.upper[ j + 1 ], B.upper[ j ] );
		for ( let j = 0; j < nl; j ++ ) M.quad( A.lower[ j ], A.lower[ j + 1 ], B.lower[ j + 1 ], B.lower[ j ] );

	}

	const first = rings[ 0 ], last = rings[ rings.length - 1 ];

	// ---- snout
	if ( u0 === 0 ) {

		const zt = 0.5;
		const yt = mouthY( 0 );
		const gap = Math.min( first.c.T, first.c.B ) * 0.3;
		const upTip = M.v( 0, yt + gap * 0.5, zt, 0, PART.BODY, 0, 0 );
		const loTip = M.v( 0, yt - gap * 0.5, zt + ( mouth ? Mo.protrude : 0 ), 0, PART.BODY + 0.9 * ( mouth ? 1 : 0 ), 0, 0 );
		for ( let j = 0; j < nu; j ++ ) M.tri( upTip, first.upper[ j + 1 ], first.upper[ j ] );
		for ( let j = 0; j < nl; j ++ ) M.tri( loTip, first.lower[ j + 1 ], first.lower[ j ] );
		if ( ! mouth ) {

			// closed lips at the tip
			M.tri( upTip, first.upper[ 0 ], loTip );
			M.tri( upTip, loTip, first.upper[ nu ] );

		}

		if ( mouth ) {

			// cavity: roof under the upper jaw and floor over the lower jaw, meeting in the
			// throat at the corner of the mouth
			const roof = [], floor = [];
			const ringsM = rings.filter( ( r ) => r.u <= corner + 1e-6 );
			const dep = ( u ) => Math.min( 1, u / corner );
			for ( const r of ringsM ) {

				const k = 0.45 * ( 1 - dep( r.u ) );
				const ym = mouthY( r.u );
				const R = r.upper[ nu ], Lf = r.upper[ 0 ];
				const rx = M.pos[ R * 3 ], lx = M.pos[ Lf * 3 ];
				const yr = M.pos[ R * 3 + 1 ];
				const top = r.c.T, bot = r.c.B;
				const dd = dep( r.u );
				roof.push( [
					M.v( rx * 0.97, yr, r.z, r.u * L, PART.MOUTH, dd, 0 ),
					M.v( 0, ym + k * ( top - ym ) * 0.8, r.z - 0.004, r.u * L, PART.MOUTH, dd, 0 ),
					M.v( lx * 0.97, yr, r.z, r.u * L, PART.MOUTH, dd, 0 ),
				] );
				const w = r.wj;
				const zf = r.z + r.jawFwd;
				floor.push( [
					M.v( rx * 0.97, yr, zf, r.u * L, PART.MOUTH + 0.9 * w, dd, 0 ),
					M.v( 0, ym - k * ( ym + bot ) * 0.8, zf - 0.004, r.u * L, PART.MOUTH + 0.9 * w, dd, 0 ),
					M.v( lx * 0.97, yr, zf, r.u * L, PART.MOUTH + 0.9 * w, dd, 0 ),
				] );

			}

			for ( let i = 0; i < roof.length - 1; i ++ ) {

				const a = roof[ i ], b = roof[ i + 1 ];
				// roof faces down (into the mouth)
				M.quad( a[ 0 ], a[ 1 ], b[ 1 ], b[ 0 ] );
				M.quad( a[ 1 ], a[ 2 ], b[ 2 ], b[ 1 ] );
				const f = floor[ i ], g = floor[ i + 1 ];
				M.quad( f[ 1 ], f[ 0 ], g[ 0 ], g[ 1 ] );
				M.quad( f[ 2 ], f[ 1 ], g[ 1 ], g[ 2 ] );

			}

			// front of the cavity closed to the lip tips
			const r0 = roof[ 0 ], f0 = floor[ 0 ];
			M.tri( upTip, r0[ 1 ], r0[ 0 ] );
			M.tri( upTip, r0[ 2 ], r0[ 1 ] );
			M.tri( loTip, f0[ 0 ], f0[ 1 ] );
			M.tri( loTip, f0[ 1 ], f0[ 2 ] );

		}

	} else {

		fleshCap( M, first, nu, nl, L, true );

	}

	// ---- caudal peduncle end (under the tail fin) or a cut face
	if ( u1 >= 1 ) {

		const end = M.v( 0, 0, last.z - 0.004, L, PART.BODY, 0, 0 );
		for ( let j = 0; j < nu; j ++ ) M.tri( end, last.upper[ j ], last.upper[ j + 1 ] );
		for ( let j = 0; j < nl; j ++ ) M.tri( end, last.lower[ j ], last.lower[ j + 1 ] );

	} else {

		fleshCap( M, last, nu, nl, L, false );

	}

	return rings;

}

// cut face: the section filled with flesh (coordinates on the face in z / w)
function fleshCap( M, ring, nu, nl, L, front ) {

	const ids = [ ...ring.upper, ...ring.lower.slice( 1, nl ) ];
	const verts = ids.map( ( i ) => {

		const x = M.pos[ i * 3 ], y = M.pos[ i * 3 + 1 ];
		return M.v( x, y, ring.z, ring.u * L, PART.FLESH, x, y );

	} );
	const c = M.v( 0, ( ring.c.T - ring.c.B ) * 0.3, ring.z, ring.u * L, PART.FLESH, 0, ( ring.c.T - ring.c.B ) * 0.3 );
	for ( let j = 0; j < verts.length; j ++ ) {

		const a = verts[ j ], b = verts[ ( j + 1 ) % verts.length ];
		if ( front ) M.tri( c, b, a );
		else M.tri( c, a, b );

	}

}

// ---------------------------------------------------------------------------
// fins

// A membrane between rays. rays: [ { b: [ x, y, z ], t: [ x, y, z ], ub, ut } ] (base, tip and
// their positions along the fish); notch: membrane dip between the tips (fraction of the ray
// length); rows: vertex rows from the base to the edge; rayIds: ray coordinate of each ray.
function membrane( M, part, rays, notch, rows, rayIds, flip ) {

	const cols = [];
	for ( let k = 0; k < rays.length; k ++ ) {

		cols.push( { ...rays[ k ], dip: 0, id: rayIds[ k ] } );
		if ( k < rays.length - 1 ) {

			const a = rays[ k ], b = rays[ k + 1 ];
			const mid = ( p, q ) => [ ( p[ 0 ] + q[ 0 ] ) / 2, ( p[ 1 ] + q[ 1 ] ) / 2, ( p[ 2 ] + q[ 2 ] ) / 2 ];
			cols.push( { b: mid( a.b, b.b ), t: mid( a.t, b.t ), ub: ( a.ub + b.ub ) / 2, ut: ( a.ut + b.ut ) / 2, dip: notch, id: ( rayIds[ k ] + rayIds[ k + 1 ] ) / 2 } );

		}

	}

	// front and back faces (separate vertices: opposite normals)
	for ( const back of [ false, true ] ) {

		const grid = [];
		for ( const c of cols ) {

			const col = [];
			const top = 1 - c.dip;
			for ( let r = 0; r <= rows; r ++ ) {

				const t = ( r / rows ) * top;
				col.push( M.v(
					lerp( c.b[ 0 ], c.t[ 0 ], t ), lerp( c.b[ 1 ], c.t[ 1 ], t ), lerp( c.b[ 2 ], c.t[ 2 ], t ),
					lerp( c.ub, c.ut, t ), part, t, c.id,
				) );

			}

			grid.push( col );

		}

		for ( let k = 0; k < grid.length - 1; k ++ ) {

			for ( let r = 0; r < rows; r ++ ) {

				const a = grid[ k ][ r ], b = grid[ k + 1 ][ r ], c = grid[ k + 1 ][ r + 1 ], d = grid[ k ][ r + 1 ];
				if ( back !== flip ) M.quad( b, a, d, c );
				else M.quad( a, b, c, d );

			}

		}

	}

}

// subset of ray indices for a level of detail (always the first and the last)
function pickRays( n, max ) {

	if ( n <= max ) return [ ...Array( n ).keys() ];
	const out = [];
	for ( let i = 0; i < max; i ++ ) out.push( Math.round( i * ( n - 1 ) / ( max - 1 ) ) );
	return out;

}

// dorsal (sign 1) and anal (sign -1) fins along the midline
function midlineFins( M, S, segs, sign, o ) {

	const L = S.body, zOf = ( u ) => 0.5 - u * L;
	const dead = o.pose === 'dead';
	const rows = [ 3, 1, 1, 1 ][ o.lod ];
	segs.forEach( ( seg, si ) => {

		const part = sign > 0 ? ( seg.spiny ? PART.DORSAL1 : PART.DORSAL2 ) : PART.ANAL;
		const ids = pickRays( seg.rays, [ 40, 7, 3, 2 ][ o.lod ] );
		const fold = dead ? ( seg.spiny ? 0.42 : 0.22 ) : 0;
		const rays = ids.map( ( k ) => {

			const t = seg.rays > 1 ? k / ( seg.rays - 1 ) : 0;
			const u = lerp( seg.from, seg.to, t );
			const c = section( S, u );
			const y0 = sign > 0 ? c.T * 0.9 : - c.B * 0.9;
			let h = prof( seg.h, t ) + ( sign > 0 ? c.T : c.B ) * 0.1;
			let rake = lerp( seg.rake[ 0 ], seg.rake[ 1 ], t );
			rake = lerp( rake, 1.45, fold );
			h *= dead ? ( seg.rays > 30 ? 0.85 : 0.95 ) : 1;
			const tip = [ 0, y0 + sign * h * Math.cos( rake ), zOf( u ) - h * Math.sin( rake ) ];
			return { b: [ 0, y0, zOf( u ) ], t: tip, ub: u * L, ut: ( u * L ) + h * Math.sin( rake ) };

		} );
		// the last ray of a segment followed by another one: membrane continues to its base
		membrane( M, part, rays, o.lod >= 2 ? 0 : seg.notch, rows, ids.map( ( k ) => k + si * 40 ), sign < 0 );

	} );

}

function caudalFin( M, S, o ) {

	const C = S.caudal, L = S.body;
	const zb = 0.5 - L + 0.014;
	const cEnd = section( S, 1 );
	const hp = Math.min( cEnd.T, cEnd.B ) * 0.9;
	const dead = o.pose === 'dead';
	const R = C.rays;
	const ids = pickRays( R, [ 40, 9, 5, 3 ][ o.lod ] );
	const span = C.span * ( dead ? 0.93 : 1 );
	const rays = ids.map( ( k ) => {

		const s = - 1 + 2 * k / ( R - 1 ); // -1 lower lobe .. 1 upper lobe
		const a = Math.abs( s );
		let y, len;
		if ( C.shape === 'rounded' ) {

			y = span * s * 0.95;
			len = C.len * ( 1 - 0.3 * s * s );

		} else if ( C.shape === 'truncate' ) {

			y = span * s;
			len = C.len * ( 1 - 0.05 * s * s ) * lerp( C.fork, 1, a );

		} else if ( C.shape === 'lunate' ) {

			y = span * s * ( 0.75 + 0.25 * a );
			len = C.len * ( C.fork + ( 1 - C.fork ) * Math.pow( a, 1.8 ) );

		} else {

			y = span * s;
			len = C.len * ( C.fork + ( 1 - C.fork ) * Math.pow( a, 1.3 ) );

		}

		return { b: [ 0, hp * s, zb ], t: [ 0, y, zb - 0.014 - len ], ub: L - 0.014, ut: L + len };

	} );
	membrane( M, PART.CAUDAL, rays, o.lod >= 2 ? 0 : 0.05, [ 3, 1, 1, 1 ][ o.lod ], ids, false );

}

// paired fins: rays fanning out from a short base on the flank
function pairedFins( M, S, F, part, o ) {

	const L = S.body, zOf = ( u ) => 0.5 - u * L;
	const dead = o.pose === 'dead';
	const c = section( S, F.u );
	const R = F.rays;
	const ids = pickRays( R, [ 24, 5, 3, 2 ][ o.lod ] );
	const rows = [ 2, 1, 1, 1 ][ o.lod ];
	const pelvic = part === PART.PELVIC;
	for ( const side of [ 1, - 1 ] ) {

		const rays = ids.map( ( k ) => {

			const t = R > 1 ? k / ( R - 1 ) : 0; // 0 leading (upper) ray .. 1 last
			let yb, xb, alpha, len, spread;
			if ( pelvic ) {

				yb = - c.B * 0.88;
				xb = side * ( c.W * 0.22 + t * c.W * 0.12 );
				alpha = lerp( - 0.35, - 0.75, t );
				len = F.len * ( 1 - 0.45 * t );
				spread = dead ? 0.14 : 0.35;

			} else {

				yb = F.y + F.base * ( 0.5 - t );
				xb = side * surfaceX( c, yb ) * 0.94;
				const shape = F.shape;
				alpha = shape === 'falcate' ? lerp( 0.05, - 0.55, t ) : shape === 'pointed' ? lerp( 0.1, - 0.85, t ) : lerp( 0.25, - 1.1, t );
				len = F.len * ( shape === 'falcate' ? 1 - 0.85 * Math.pow( t, 0.55 ) : shape === 'pointed' ? 1 - 0.62 * Math.pow( t, 0.9 ) : 0.62 + 0.38 * Math.sin( Math.PI * ( 0.15 + 0.85 * t ) ) );
				spread = dead ? 0.16 : F.spread;
				if ( dead ) alpha = alpha * 0.6 - 0.08; // relaxed: rays closer together, pointing back

			}

			const dir = [ side * Math.sin( spread ) * Math.cos( alpha ), Math.sin( alpha ), - Math.cos( spread ) * Math.cos( alpha ) ];
			const zb = zOf( F.u );
			return { b: [ xb, yb, zb ], t: [ xb + dir[ 0 ] * len, yb + dir[ 1 ] * len, zb + dir[ 2 ] * len ], ub: F.u * L, ut: F.u * L - dir[ 2 ] * len };

		} );
		const first = M.pos.length / 3;
		membrane( M, part, rays, o.lod >= 2 ? 0 : 0.035, rows, ids, side < 0 );
		// keep the membrane outside the flank it lies against
		for ( let i = first; i < M.pos.length / 3; i ++ ) {

			const x = M.pos[ i * 3 ], y = M.pos[ i * 3 + 1 ], z = M.pos[ i * 3 + 2 ];
			const u = clamp( ( 0.5 - z ) / L, 0, 1 );
			const sx = surfaceX( section( S, u ), y ) + 0.004;
			if ( Math.abs( x ) < sx ) M.pos[ i * 3 ] = side * sx;

		}

	}

}

function finlets( M, S, o ) {

	const F = S.finlets, L = S.body, zOf = ( u ) => 0.5 - u * L;
	for ( const [ n, sign ] of [ [ F.dorsal, 1 ], [ F.ventral, - 1 ] ] ) {

		for ( let i = 0; i < n; i ++ ) {

			const u = lerp( F.from, F.to, ( i + 0.5 ) / n );
			const c = section( S, u );
			const y0 = sign > 0 ? c.T * 0.85 : - c.B * 0.85;
			const w = ( F.to - F.from ) / n * 0.75;
			const h = 0.006 + ( sign > 0 ? c.T : c.B ) * 0.12;
			for ( const back of [ false, true ] ) {

				const a = M.v( 0, y0, zOf( u ), u * L, PART.FINLET, 0, 0 );
				const b = M.v( 0, y0, zOf( u + w ), ( u + w ) * L, PART.FINLET, 0, 1 );
				const t = M.v( 0, y0 + sign * h, zOf( u + w * 1.6 ), ( u + w * 1.6 ) * L, PART.FINLET, 1, 0.5 );
				if ( ( sign > 0 ) !== back ) M.tri( a, t, b );
				else M.tri( a, b, t );

			}

		}

	}

}

// domes over the eyes: disc coordinates in z / w
function eyes( M, S, o ) {

	const E = S.eye, L = S.body;
	const u = E.u, z0 = 0.5 - u * L;
	const c = section( S, u );
	const r = E.r;
	const segs = o.lod === 0 ? 18 : 10, rings = o.lod === 0 ? 5 : 2;
	const bulge = 0.34 * r;
	for ( const side of [ 1, - 1 ] ) {

		const xs = surfaceX( c, E.y );
		// axis: sideways, a little forward (fish look ahead) and up
		const ax = new THREE.Vector3( side, 0.06, 0.22 ).normalize();
		const t1 = new THREE.Vector3( 0, 1, 0 ).addScaledVector( ax, - ax.y ).normalize();
		const t2 = new THREE.Vector3().crossVectors( ax, t1 );
		const base = new THREE.Vector3( side * ( xs - r * 0.12 ), E.y, z0 );
		const idx = [];
		for ( let i = 0; i <= rings; i ++ ) {

			const rho = i / rings; // 0 apex .. 1 rim
			const row = [];
			const n = i === 0 ? 1 : segs;
			for ( let j = 0; j < n; j ++ ) {

				const a = ( j / segs ) * TAU;
				const ca = Math.cos( a ) * rho, sa = Math.sin( a ) * rho;
				const h = bulge * ( 1 - rho * rho ) + r * 0.12;
				const px = base.x + t1.x * sa * r + t2.x * ca * r + ax.x * h;
				const py = base.y + t1.y * sa * r + t2.y * ca * r + ax.y * h;
				const pz = base.z + t1.z * sa * r + t2.z * ca * r + ax.z * h;
				row.push( M.v( px, py, pz, u * L, PART.EYE, ca * side, sa ) );

			}

			idx.push( row );

		}

		for ( let i = 0; i < rings; i ++ ) {

			for ( let j = 0; j < segs; j ++ ) {

				const j1 = ( j + 1 ) % segs;
				if ( i === 0 ) {

					if ( side > 0 ) M.tri( idx[ 0 ][ 0 ], idx[ 1 ][ j ], idx[ 1 ][ j1 ] );
					else M.tri( idx[ 0 ][ 0 ], idx[ 1 ][ j1 ], idx[ 1 ][ j ] );

				} else {

					const a = idx[ i ][ j ], b = idx[ i ][ j1 ], cc = idx[ i + 1 ][ j1 ], d = idx[ i + 1 ][ j ];
					if ( side > 0 ) M.quad( a, d, cc, b );
					else M.quad( a, b, cc, d );

				}

			}

		}

	}

}

// ---------------------------------------------------------------------------
// public builders

// Whole fish. opts: { lod: 0 | 1 | 2, pose: 'swim' | 'dead', mouth (split jaws), eyes, fins,
// u0 / u1 (a cut piece: 0 .. 1 of the body, flesh on the cut faces) }
export function fishGeometry( S, opts = {} ) {

	const o = { lod: 0, pose: 'swim', ...opts };
	const lod = o.lod;
	o.mouth = o.mouth ?? ( lod < 2 && o.pose === 'dead' );
	const M = new MeshData();
	const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1;
	buildBody( M, S, o );
	const has = ( u ) => u >= u0 && u <= u1;
	if ( o.fins !== false ) {

		const main = ( segs ) => lod < 3 ? segs : segs.slice( - 1 );
		midlineFins( M, S, main( S.dorsal.filter( ( d ) => has( d.from ) ) ), 1, o );
		if ( lod < 3 ) midlineFins( M, S, S.anal.filter( ( d ) => has( d.from ) ), - 1, o );
		if ( u1 >= 1 ) caudalFin( M, S, o );
		if ( has( S.pectoral.u ) && lod < 3 ) pairedFins( M, S, S.pectoral, PART.PECTORAL, o );
		if ( S.pelvic && has( S.pelvic.u ) && lod < 2 ) pairedFins( M, S, S.pelvic, PART.PELVIC, o );
		if ( S.finlets && lod < 2 && u1 >= 1 ) finlets( M, S, o );

	}

	if ( ( o.eyes ?? lod === 0 ) && has( S.eye.u ) ) eyes( M, S, o );
	return M.build();

}

// Split, salted and sun-dried fish (butterflied from the back, head removed): a thin slab, the
// flesh side up (+y), skin below, with the dried tail fin. Same length conventions as a fish
// (the tail tip at z = -0.5).
export function splitFishGeometry( S, { lod = 0 } = {} ) {

	const M = new MeshData();
	const L = S.body;
	const zOf = ( u ) => 0.5 - u * L;
	const uf = S.opercle + 0.02;
	const nu = [ 16, 7 ][ lod ], nx = [ 8, 4 ][ lod ];
	// half width of the opened fish (one flank from the back to the belly): widest at the
	// shoulders, tapering in a long triangle to the tail
	const w0 = ( section( S, uf ).T + section( S, uf ).B ) * 0.8;
	const halfW = ( u ) => {

		const t = ( u - uf ) / ( 1 - uf );
		const c = section( S, u );
		return Math.max( ( c.T + c.B ) * 0.55, w0 * ( 1 - 0.72 * Math.pow( t, 1.1 ) ) * ( 1 - 0.15 * ( 1 - t ) * ( 1 - t ) ) );

	};

	const thick = ( u, t ) => {

		const c = section( S, u );
		return Math.max( 0.004, c.W * 0.5 * ( 1 - 0.75 * t * t ) );

	};

	// cupped: the edges curl up a little as the flesh dries
	const cup = ( u, t ) => 0.012 * t * t * ( 1 - 0.5 * u );
	const top = [], bot = [];
	for ( let i = 0; i <= nu; i ++ ) {

		const u = lerp( uf, 1, Math.pow( i / nu, 0.85 ) );
		const w = halfW( u );
		// front edge: the cut behind the collarbone, curved back at the sides
		const zc = zOf( u );
		const rowT = [], rowB = [];
		for ( let j = - nx; j <= nx; j ++ ) {

			const t = Math.abs( j / nx );
			const x = ( j / nx ) * w;
			const zz = zc - ( i === 0 ? 0.04 * t * t : 0 );
			const y = cup( u, t );
			const th = thick( u, t );
			rowT.push( M.v( x, y + th * 0.5, zz, u * L, PART.FILLET, j / nx, zz ) );
			rowB.push( M.v( x, y - th * 0.5, zz, u * L, PART.BODY, Math.abs( x ), 1 - 2 * t ) );

		}

		top.push( rowT );
		bot.push( rowB );

	}

	const n = 2 * nx;
	for ( let i = 0; i < nu; i ++ ) {

		for ( let j = 0; j < n; j ++ ) {

			M.quad( top[ i ][ j ], top[ i ][ j + 1 ], top[ i + 1 ][ j + 1 ], top[ i + 1 ][ j ] );
			M.quad( bot[ i ][ j + 1 ], bot[ i ][ j ], bot[ i + 1 ][ j ], bot[ i + 1 ][ j + 1 ] );

		}

	}

	// rim: the thin cut edges around the slab
	const rim = ( a, b, flip ) => {

		for ( let k = 0; k < a.length - 1; k ++ ) {

			if ( flip ) M.quad( a[ k + 1 ], a[ k ], b[ k ], b[ k + 1 ] );
			else M.quad( a[ k ], a[ k + 1 ], b[ k + 1 ], b[ k ] );

		}

	};

	const col = ( rows, j ) => rows.map( ( r ) => r[ j ] );
	rim( top[ 0 ], bot[ 0 ], false );
	rim( col( top, 0 ), col( bot, 0 ), false );
	rim( col( top, n ), col( bot, n ), true );

	// dried tail fin, flattened into the plane of the slab
	const C = S.caudal;
	const R = [ 13, 5 ][ lod ];
	const zb = zOf( 1 ) + 0.01;
	const w1 = halfW( 1 ) * 0.9;
	const rays = [];
	const ids = [];
	for ( let k = 0; k < R; k ++ ) {

		const s = - 1 + 2 * k / ( R - 1 );
		const a = Math.abs( s );
		const len = C.len * ( C.shape === 'rounded' || C.shape === 'truncate' ? 1 - 0.2 * s * s : lerp( C.fork, 1, Math.pow( a, 1.3 ) ) ) * 0.9;
		rays.push( { b: [ w1 * s, cup( 1, a ), zb ], t: [ C.span * 0.8 * s, cup( 1, a ) + 0.004, zb - len ], ub: L, ut: L + len } );
		ids.push( k );

	}

	membrane( M, PART.CAUDAL, rays, 0.08, 1, ids, true );
	return M.build();

}
