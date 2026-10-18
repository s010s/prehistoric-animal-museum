import { Vector3, Matrix4 } from '../../engine/index.js';
import { Part, mat4, fixWinding, slabPart, CAP_U } from '../village/GeoBuilder.js';
import { WOOD, HARD, C, lin, mulc, buoy } from '../Props.js';

// Geometry emitters for the shoreline wrack and the village clutter (DebrisPlacement decides
// where). Everything is written into a GeoBuilder with the village material keys (wood, hard,
// rope, net) plus 'nature' (NatureMaterial: stones, coconuts, seaweed, shells, coral, fronds).
//
// nature vdata: x seed, y kind (KIND), z kind parameter (see NatureMaterial), w object size (m).
// uv in metres, u along the main axis / fibres.
//
// Draped items (seaweed mats, seagrass, rope, nets, fronds, branches) are generated directly in
// world space on the terrain (`ground( x, z )`); rigid items are built in a local frame and
// placed with B.pushAt.

export const KIND = { STONE: 0, COCONUT: 1, WEED: 2, SHELL: 3, CORAL: 4, FROND: 5, DRIFT: 6 };
export const nat = ( seed, kind, p0 = 0, size = 0.1 ) => [ seed, kind, p0, size ];

const TAU = Math.PI * 2;
const _v = new Vector3();
const _n = new Vector3();
const IDENT = new Matrix4();

// ---------------------------------------------------------------------------
// noise helpers

export function hash1( n ) {

	const s = Math.sin( n * 127.1 + 311.7 ) * 43758.5453;
	return s - Math.floor( s );

}

function hash3( i, j, k, s ) {

	let h = ( i * 374761393 + j * 668265263 + k * 1440662683 + s * 2147483647 ) | 0;
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}

// smooth 3D value noise in [-1, 1]
export function vnoise3( x, y, z, s = 0 ) {

	const i = Math.floor( x ), j = Math.floor( y ), k = Math.floor( z );
	const fx = x - i, fy = y - j, fz = z - k;
	const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy ), uz = fz * fz * ( 3 - 2 * fz );
	const l = ( a, b, t ) => a + ( b - a ) * t;
	const h = ( a, b, c ) => hash3( i + a, j + b, k + c, s );
	return l(
		l( l( h( 0, 0, 0 ), h( 1, 0, 0 ), ux ), l( h( 0, 1, 0 ), h( 1, 1, 0 ), ux ), uy ),
		l( l( h( 0, 0, 1 ), h( 1, 0, 1 ), ux ), l( h( 0, 1, 1 ), h( 1, 1, 1 ), ux ), uy ),
		uz
	) * 2 - 1;

}

// ---------------------------------------------------------------------------
// mesh helpers

// Grid of points P[j][i] (rows j along the main axis, columns i around / across) -> Part with
// smooth normals. wrap: the columns close around (tubes); the seam is duplicated for the uvs.
// uvFn( i, j ) -> [u, v]. Normals are accumulated from the faces (area weighted) and oriented
// by `ref( j, i, p )` (a rough outward direction): default away from the row centroid for
// tubes, +y for open sheets lying on the ground.
export function gridMesh( P, wrap, uvFn, ref = null ) {

	const rows = P.length, cols = P[ 0 ].length;
	const N = [];
	for ( let j = 0; j < rows; j ++ ) {

		N.push( [] );
		for ( let i = 0; i < cols; i ++ ) N[ j ].push( [ 0, 0, 0 ] );

	}

	const cI = wrap ? cols : cols - 1;
	const acc = ( a, n ) => {

		a[ 0 ] += n[ 0 ]; a[ 1 ] += n[ 1 ]; a[ 2 ] += n[ 2 ];

	};

	const tri = ( a, b, c ) => {

		const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
		const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
		return [ uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ];

	};

	for ( let j = 0; j < rows - 1; j ++ ) for ( let i = 0; i < cI; i ++ ) {

		const i1 = ( i + 1 ) % cols;
		const a = P[ j ][ i ], b = P[ j ][ i1 ], c = P[ j + 1 ][ i ], d = P[ j + 1 ][ i1 ];
		const n1 = tri( a, c, b ), n2 = tri( b, c, d );
		acc( N[ j ][ i ], n1 ); acc( N[ j + 1 ][ i ], n1 ); acc( N[ j ][ i1 ], n1 );
		acc( N[ j ][ i1 ], n2 ); acc( N[ j + 1 ][ i ], n2 ); acc( N[ j + 1 ][ i1 ], n2 );

	}

	// orientation: flip everything if the normals point inward / down on the whole
	let dsum = 0;
	for ( let j = 0; j < rows; j ++ ) {

		let cx = 0, cy = 0, cz = 0;
		for ( let i = 0; i < cols; i ++ ) {

			cx += P[ j ][ i ][ 0 ]; cy += P[ j ][ i ][ 1 ]; cz += P[ j ][ i ][ 2 ];

		}

		cx /= cols; cy /= cols; cz /= cols;
		for ( let i = 0; i < cols; i ++ ) {

			const q = P[ j ][ i ], m = N[ j ][ i ];
			const r = ref ? ref( j, i, q ) : wrap ? [ q[ 0 ] - cx, q[ 1 ] - cy, q[ 2 ] - cz ] : [ 0, 1, 0 ];
			dsum += m[ 0 ] * r[ 0 ] + m[ 1 ] * r[ 1 ] + m[ 2 ] * r[ 2 ];

		}

	}

	const sgn = dsum < 0 ? - 1 : 1;

	const p = [], n = [], uv = [], idx = [];
	const W = wrap ? cols + 1 : cols;
	for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < W; i ++ ) {

		const ii = i % cols;
		const q = P[ j ][ ii ], m = N[ j ][ ii ];
		const l = ( Math.hypot( m[ 0 ], m[ 1 ], m[ 2 ] ) || 1 ) * sgn;
		p.push( q[ 0 ], q[ 1 ], q[ 2 ] );
		n.push( m[ 0 ] / l, m[ 1 ] / l, m[ 2 ] / l );
		const t = uvFn( i, j );
		uv.push( t[ 0 ], t[ 1 ] );

	}

	for ( let j = 0; j < rows - 1; j ++ ) for ( let i = 0; i < W - 1; i ++ ) {

		const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
		idx.push( a, c, b, b, c, d );

	}

	return fixWinding( new Part( p, n, uv, idx ) );

}

// Merge parts (same local frame) into one.
export function mergeParts( parts ) {

	const p = [], n = [], uv = [], idx = [];
	for ( const q of parts ) {

		const base = p.length / 3;
		for ( let i = 0; i < q.p.length; i ++ ) p.push( q.p[ i ] );
		for ( let i = 0; i < q.n.length; i ++ ) n.push( q.n[ i ] );
		for ( let i = 0; i < q.uv.length; i ++ ) uv.push( q.uv[ i ] );
		for ( let i = 0; i < q.idx.length; i ++ ) idx.push( base + q.idx[ i ] );

	}

	return new Part( p, n, uv, idx );

}

// Flat cap (fan) closing a ring of points; the normal is given; uvs are centred cap coordinates
// (metres) + CAP_U so the wood material draws end grain.
function capPart( ring, center, normal, capU = CAP_U, jag = 0, seed = 0 ) {

	const p = [ center[ 0 ], center[ 1 ], center[ 2 ] ], n = [ ...normal ], uv = [ capU, 0 ], idx = [];
	// in-plane basis
	const nn = _n.set( normal[ 0 ], normal[ 1 ], normal[ 2 ] ).normalize();
	const a = Math.abs( nn.y ) < 0.9 ? new Vector3( 0, 1, 0 ) : new Vector3( 1, 0, 0 );
	const e1 = a.sub( nn.clone().multiplyScalar( a.dot( nn ) ) ).normalize();
	const e2 = nn.clone().cross( e1 );
	for ( let i = 0; i < ring.length; i ++ ) {

		const q = ring[ i ];
		p.push( q[ 0 ], q[ 1 ], q[ 2 ] );
		n.push( normal[ 0 ], normal[ 1 ], normal[ 2 ] );
		const dx = q[ 0 ] - center[ 0 ], dy = q[ 1 ] - center[ 1 ], dz = q[ 2 ] - center[ 2 ];
		uv.push( dx * e1.x + dy * e1.y + dz * e1.z + capU, dx * e2.x + dy * e2.y + dz * e2.z );

	}

	for ( let i = 0; i < ring.length; i ++ ) idx.push( 0, 1 + i, 1 + ( i + 1 ) % ring.length );
	// splintered end: push the centre in or out a little
	if ( jag ) {

		const k = ( hash1( seed * 7.1 ) - 0.5 ) * jag;
		p[ 0 ] += normal[ 0 ] * k; p[ 1 ] += normal[ 1 ] * k; p[ 2 ] += normal[ 2 ] * k;

	}

	return fixWinding( new Part( p, n, uv, idx ) );

}

// Tapered tube along a polyline (arrays of [x, y, z] and radii), parallel-transport frames.
// radial: segments around. rFn( k, a ) optional radius modulation (knots, ovality).
// Returns { part, rings, frames } (rings for caps).
export function taperTube( pts, radii, radial = 6, rFn = null, uScale = 1 ) {

	const m = pts.length;
	const T = [], Nf = [], Bf = [];
	for ( let k = 0; k < m; k ++ ) {

		const a = pts[ Math.max( 0, k - 1 ) ], b = pts[ Math.min( m - 1, k + 1 ) ];
		T.push( new Vector3( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ).normalize() );

	}

	let n0 = Math.abs( T[ 0 ].y ) < 0.9 ? new Vector3( 0, 1, 0 ) : new Vector3( 1, 0, 0 );
	n0.sub( T[ 0 ].clone().multiplyScalar( n0.dot( T[ 0 ] ) ) ).normalize();
	Nf.push( n0 );
	Bf.push( T[ 0 ].clone().cross( n0 ) );
	for ( let k = 1; k < m; k ++ ) {

		const prev = Nf[ k - 1 ];
		const nn = prev.clone().sub( T[ k ].clone().multiplyScalar( prev.dot( T[ k ] ) ) );
		if ( nn.lengthSq() < 1e-8 ) nn.copy( prev );
		nn.normalize();
		Nf.push( nn );
		Bf.push( T[ k ].clone().cross( nn ) );

	}

	const len = [ 0 ];
	for ( let k = 1; k < m; k ++ ) len.push( len[ k - 1 ] + Math.hypot( pts[ k ][ 0 ] - pts[ k - 1 ][ 0 ], pts[ k ][ 1 ] - pts[ k - 1 ][ 1 ], pts[ k ][ 2 ] - pts[ k - 1 ][ 2 ] ) );

	const P = [];
	for ( let k = 0; k < m; k ++ ) {

		const row = [];
		for ( let i = 0; i < radial; i ++ ) {

			const a = i / radial * TAU;
			const c = Math.cos( a ), s = Math.sin( a );
			const r = radii[ k ] * ( rFn ? rFn( k, a ) : 1 );
			row.push( [
				pts[ k ][ 0 ] + ( Nf[ k ].x * c + Bf[ k ].x * s ) * r,
				pts[ k ][ 1 ] + ( Nf[ k ].y * c + Bf[ k ].y * s ) * r,
				pts[ k ][ 2 ] + ( Nf[ k ].z * c + Bf[ k ].z * s ) * r,
			] );

		}

		P.push( row );

	}

	const rAvg = radii.reduce( ( s, r ) => s + r, 0 ) / m;
	const part = gridMesh( P, true, ( i, j ) => [ len[ j ] * uScale, i / radial * TAU * rAvg ] );
	return { part, rings: P, T, len };

}

// ---------------------------------------------------------------------------
// icosphere based stones

function icosphere( detail ) {

	const t = ( 1 + Math.sqrt( 5 ) ) / 2;
	const V = [ [ - 1, t, 0 ], [ 1, t, 0 ], [ - 1, - t, 0 ], [ 1, - t, 0 ], [ 0, - 1, t ], [ 0, 1, t ], [ 0, - 1, - t ], [ 0, 1, - t ], [ t, 0, - 1 ], [ t, 0, 1 ], [ - t, 0, - 1 ], [ - t, 0, 1 ] ]
		.map( ( v ) => {

			const l = Math.hypot( v[ 0 ], v[ 1 ], v[ 2 ] );
			return [ v[ 0 ] / l, v[ 1 ] / l, v[ 2 ] / l ];

		} );
	let F = [ 0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1 ];
	for ( let d = 0; d < detail; d ++ ) {

		const cache = new Map();
		const mid = ( a, b ) => {

			const key = a < b ? a * 100000 + b : b * 100000 + a;
			let r = cache.get( key );
			if ( r === undefined ) {

				const p = [ V[ a ][ 0 ] + V[ b ][ 0 ], V[ a ][ 1 ] + V[ b ][ 1 ], V[ a ][ 2 ] + V[ b ][ 2 ] ];
				const l = Math.hypot( p[ 0 ], p[ 1 ], p[ 2 ] );
				V.push( [ p[ 0 ] / l, p[ 1 ] / l, p[ 2 ] / l ] );
				r = V.length - 1;
				cache.set( key, r );

			}

			return r;

		};

		const F2 = [];
		for ( let f = 0; f < F.length; f += 3 ) {

			const a = F[ f ], b = F[ f + 1 ], c = F[ f + 2 ];
			const ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
			F2.push( a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca );

		}

		F = F2;

	}

	return { V, F };

}

const ICO = [ icosphere( 0 ), icosphere( 1 ), icosphere( 2 ) ];

// smooth vertex normals of an indexed mesh
function vertexNormals( p, idx ) {

	const n = new Float32Array( p.length );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uy = p[ b + 1 ] - p[ a + 1 ], uz = p[ b + 2 ] - p[ a + 2 ];
		const vx = p[ c ] - p[ a ], vy = p[ c + 1 ] - p[ a + 1 ], vz = p[ c + 2 ] - p[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		for ( const o of [ a, b, c ] ) {

			n[ o ] += nx; n[ o + 1 ] += ny; n[ o + 2 ] += nz;

		}

	}

	for ( let i = 0; i < n.length; i += 3 ) {

		const l = Math.hypot( n[ i ], n[ i + 1 ], n[ i + 2 ] ) || 1;
		n[ i ] /= l; n[ i + 1 ] /= l; n[ i + 2 ] /= l;

	}

	return n;

}

// Unit-radius stone: rounded (beach pebble / cobble) or angular (broken rock with a few flat
// faces, for walls). Scaled per instance with sx, sy, sz.
const stoneCache = new Map();
export function stonePart( variant, detail = 1, angular = 0 ) {

	const key = variant + '|' + detail + '|' + angular;
	let part = stoneCache.get( key );
	if ( part ) return part;
	const { V, F } = ICO[ detail ];
	const s = variant * 17 + 3;
	// a few flat fracture planes for angular stones
	const planes = [];
	for ( let k = 0; k < Math.round( angular * 6 ); k ++ ) {

		const u = hash1( s + k * 3.1 ) * 2 - 1, a = hash1( s + k * 5.7 ) * TAU;
		const rr = Math.sqrt( 1 - u * u );
		planes.push( [ rr * Math.cos( a ), u * 0.7, rr * Math.sin( a ), 0.68 + hash1( s + k * 9.3 ) * 0.22 ] );

	}

	const p = [];
	for ( const v of V ) {

		let r = 1 + 0.13 * vnoise3( v[ 0 ] * 1.3 + s, v[ 1 ] * 1.3, v[ 2 ] * 1.3, s ) + 0.05 * vnoise3( v[ 0 ] * 3.1, v[ 1 ] * 3.1 + s, v[ 2 ] * 3.1, s + 1 );
		for ( const q of planes ) {

			const d = v[ 0 ] * q[ 0 ] + v[ 1 ] * q[ 1 ] + v[ 2 ] * q[ 2 ];
			if ( d > 0.05 ) {

				// soft-min with the plane distance: flat face, rounded edge
				const rp = q[ 3 ] / d;
				const k = 0.08;
				const h = Math.max( 0, Math.min( 1, 0.5 + 0.5 * ( rp - r ) / k ) );
				r = rp + ( r - rp ) * h - k * h * ( 1 - h );

			}

		}

		p.push( v[ 0 ] * r, v[ 1 ] * r, v[ 2 ] * r );

	}

	const idx = F.slice();
	const n = vertexNormals( p, idx );
	const uv = [];
	for ( let i = 0; i < p.length; i += 3 ) uv.push( p[ i ] * 0.5 + p[ i + 1 ] * 0.2, p[ i + 2 ] * 0.5 );
	part = fixWinding( new Part( p, Array.from( n ), uv, idx ) );
	stoneCache.set( key, part );
	return part;

}

// A stone resting on the ground: scale (half extents) sx, sy, sz, yaw, sunk by `sink` of its height.
export function stone( B, ground, x, z, sx, sy, sz, rand, o = {} ) {

	const g = o.y ?? minGround( ground, x, z, Math.max( sx, sz ) * 0.7 );
	const y = g + sy * ( 1 - ( o.sink ?? 0.35 ) * 2 ); // centre height (sink: fraction of the height buried)
	const part = stonePart( Math.floor( rand() * 12 ), o.detail ?? 1, o.angular ?? 0 );
	B.part( 'nature', part, x, y, z, {
		ry: rand() * TAU, rx: ( rand() - 0.5 ) * ( o.tilt ?? 0.3 ), rz: ( rand() - 0.5 ) * ( o.tilt ?? 0.3 ),
		sx, sy, sz, tint: o.tint || [ 1, 1, 1 ], data: nat( rand(), KIND.STONE, o.palette ?? rand(), Math.max( sx, sy, sz ) * 2 ),
	} );
	return y + sy;

}

export function minGround( ground, x, z, r ) {

	let g = ground( x, z );
	for ( let a = 0; a < 5; a ++ ) g = Math.min( g, ground( x + Math.cos( a * 1.2566 ) * r, z + Math.sin( a * 1.2566 ) * r ) );
	return g;

}

// ---------------------------------------------------------------------------
// driftwood

// Driftwood log lying on the ground along `yaw`, sunk into the sand: bleached, twisted and
// fluted (the grain spirals and the soft wood has worn out between the ridges), tapered, with
// splintered broken ends, knots, branch stubs and (optionally) a root flare. Nature material
// (KIND.DRIFT: open grain, cracks, bark remnants, bleaching).
// o: { len, r0 (base radius), r1 (tip radius), roots, weather, sink, bend, stubs, bark }
export function driftLog( B, ground, x, z, yaw, rand, o = {} ) {

	const L = o.len ?? 3, r0 = o.r0 ?? 0.16, r1 = o.r1 ?? r0 * 0.5;
	const seed = rand();
	const dx = Math.cos( yaw ), dz = - Math.sin( yaw ); // local +x in world (mat4 yaw convention)
	// rest on the ground: fit the axis through the ground under both halves, then sink
	const hA = minGround( ground, x - dx * L * 0.3, z - dz * L * 0.3, r0 * 0.8 ), hB = minGround( ground, x + dx * L * 0.3, z + dz * L * 0.3, r1 * 0.8 );
	const hM = ground( x, z );
	const pitch = Math.atan2( hB - hA, L * 0.6 );
	const rM = ( r0 + r1 ) / 2;
	const sink = o.sink ?? 0.3;
	const yC = Math.min( ( hA + hB ) / 2, hM + 0.05 ) + rM * ( 1 - 2 * sink );

	const nRows = Math.max( 7, Math.min( 24, Math.round( L / 0.2 ) ) );
	const radial = rM > 0.1 ? 12 : rM > 0.05 ? 9 : 6;
	const bend = o.bend ?? ( rand() - 0.5 ) * 0.14 * L;
	const bendZ = ( rand() - 0.5 ) * 0.1 * L;
	const flutes = 4 + Math.floor( rand() * 4 ), fluteD = 0.14 + rand() * 0.14, twist = ( rand() - 0.5 ) * 6.0;
	const knots = [];
	for ( let k = 0; k < 3 + Math.floor( rand() * 5 ); k ++ ) knots.push( [ rand(), rand() * TAU, 0.08 + rand() * 0.2, 0.05 + rand() * 0.1 ] );
	const oval = 0.05 + rand() * 0.12, ovalA = rand() * TAU;
	const pts = [], radii = [];
	for ( let j = 0; j <= nRows; j ++ ) {

		const t = j / nRows;
		const lx = ( t - 0.5 ) * L;
		const s = Math.sin( Math.PI * t );
		pts.push( [ lx, bend * s * 0.5 + Math.sin( t * 5.3 + seed * 9 ) * rM * 0.15, bendZ * s + Math.sin( t * 3.7 + seed * 4 ) * rM * 0.2 ] );
		// tapered, with a slight swelling where branches were
		radii.push( ( r0 + ( r1 - r0 ) * Math.pow( t, 0.7 ) ) * ( 1 + 0.08 * Math.sin( t * 11 + seed * 20 ) ) );

	}

	const rFn = ( k, a ) => {

		const t = k / nRows;
		// fluted: worn grooves between hard ridges, spiralling with the grain
		const fl = Math.pow( Math.abs( Math.sin( flutes * 0.5 * ( a + twist * t ) + seed * 7 ) ), 0.6 );
		let f = 1 - fluteD * ( 1 - fl ) + oval * Math.cos( 2 * ( a - ovalA ) ) + 0.03 * vnoise3( Math.cos( a ) * 2, Math.sin( a ) * 2, t * L * 3, 11 );
		for ( const q of knots ) {

			const dt = ( t - q[ 0 ] ) * L / Math.max( 0.12, rM * 2.5 );
			let da = Math.abs( a - q[ 1 ] ) % TAU;
			if ( da > Math.PI ) da = TAU - da;
			f += q[ 3 ] * Math.exp( - dt * dt - da * da * 5 );

		}

		// splintered ends: the last rings fray inward
		const endK = Math.max( 0, 1 - Math.min( t, 1 - t ) * L / Math.max( 0.05, rM * 1.5 ) );
		f *= 1 - endK * 0.25 * ( 0.5 + 0.5 * vnoise3( Math.cos( a ) * 3, Math.sin( a ) * 3, t * 7, 5 ) );
		return f;

	};

	const tube = taperTube( pts, radii, radial, rFn );
	// jagged broken ends: pull the end rings along the axis by a per-angle splinter length
	const P = tube.part.p;
	const W = radial + 1;
	for ( let i = 0; i < W; i ++ ) for ( const [ row, dir, rr ] of [ [ 0, 1, r0 ], [ nRows, - 1, r1 ] ] ) {

		const a = i / radial * TAU;
		const splinter = Math.max( 0, vnoise3( Math.cos( a ) * 2.5, Math.sin( a ) * 2.5, row * 0.1 + seed * 13, 3 ) ) * rr * 1.4;
		P[ ( row * W + i ) * 3 ] += dir * splinter;

	}

	const drift = nat( seed, KIND.DRIFT, o.bark ?? ( rand() < 0.35 ? 0.6 + rand() * 0.4 : rand() * 0.2 ), rM * 2 );
	B.pushAt( x, yC, z, yaw, 0, pitch );
	B.add( 'nature', tube.part, IDENT, [ 1, 1, 1 ], drift );
	// broken ends: end grain caps (the splintered rim hides their flatness)
	const ringA = tube.rings[ 0 ], ringB = tube.rings[ tube.rings.length - 1 ];
	B.add( 'nature', capPart( ringA.map( ( q, i ) => [ P[ i * 3 ], P[ i * 3 + 1 ], P[ i * 3 + 2 ] ] ), [ pts[ 0 ][ 0 ] + r0 * 0.5, pts[ 0 ][ 1 ], pts[ 0 ][ 2 ] ], [ - 1, 0, 0 ], 0, 0, seed ), IDENT, [ 0.9, 0.88, 0.84 ], drift );
	B.add( 'nature', capPart( ringB.map( ( q, i ) => [ P[ ( nRows * W + i ) * 3 ], P[ ( nRows * W + i ) * 3 + 1 ], P[ ( nRows * W + i ) * 3 + 2 ] ] ), [ pts[ nRows ][ 0 ] - r1 * 0.5, pts[ nRows ][ 1 ], pts[ nRows ][ 2 ] ], [ 1, 0, 0 ], 0, 0, seed + 1 ), IDENT, [ 0.9, 0.88, 0.84 ], drift );

	// broken branch stubs (never pointing into the ground)
	const stubs = o.stubs ?? Math.floor( rand() * 4 );
	for ( let k = 0; k < stubs; k ++ ) {

		const t = 0.15 + rand() * 0.75;
		const j = Math.round( t * nRows );
		const a = - Math.PI * 0.35 + rand() * Math.PI * 1.7;
		const r = radii[ j ];
		const ca = Math.cos( a ), sa = Math.sin( a );
		const base = [ pts[ j ][ 0 ], pts[ j ][ 1 ] + ca * r * 0.7, pts[ j ][ 2 ] + sa * r * 0.7 ];
		const sl = r * ( 1.2 + rand() * 4 );
		const fwd = ( rand() - 0.2 ) * 0.9;
		const tip = [ base[ 0 ] + fwd * sl, base[ 1 ] + ca * sl, base[ 2 ] + sa * sl ];
		const mid = [ ( base[ 0 ] + tip[ 0 ] ) / 2 + ( rand() - 0.5 ) * sl * 0.2, ( base[ 1 ] + tip[ 1 ] ) / 2, ( base[ 2 ] + tip[ 2 ] ) / 2 ];
		const sr = r * ( 0.3 + rand() * 0.25 );
		B.add( 'nature', taperTube( [ base, mid, tip ], [ sr, sr * 0.75, sr * 0.3 ], 6 ).part, IDENT, [ 1, 1, 1 ], drift );

	}

	// root flare: roots radiating from the base end, curling down into the sand
	if ( o.roots ) {

		const nR = 5 + Math.floor( rand() * 5 );
		for ( let k = 0; k < nR; k ++ ) {

			const a = ( k + rand() * 0.6 ) / nR * TAU;
			const ca = Math.cos( a ), sa = Math.sin( a );
			const rr = r0 * ( 0.22 + rand() * 0.22 );
			const lenR = r0 * ( 3 + rand() * 5 );
			const rp = [], rr2 = [];
			for ( let m = 0; m <= 5; m ++ ) {

				const t = m / 5;
				const out = r0 * 0.6 + lenR * t;
				const back = - lenR * 0.35 * t * t;
				const kink = Math.sin( t * 6 + k ) * rr * 0.8;
				rp.push( [ pts[ 0 ][ 0 ] + back - r0 * 0.1 * t, pts[ 0 ][ 1 ] + ca * out - lenR * 0.25 * t * t * ( ca > - 0.3 ? 1 : 0.4 ) + kink, pts[ 0 ][ 2 ] + sa * out + kink ] );
				rr2.push( rr * ( 1 - t * 0.85 ) );

			}

			B.add( 'nature', taperTube( rp, rr2, 6 ).part, IDENT, [ 0.95, 0.93, 0.9 ], drift );

		}

	}

	B.pop();
	return { y: yC, pitch, r: rM };

}

// Thin branch / stick lying on the ground (world space, draped), with a couple of side twigs.
export function branch( B, ground, x, z, yaw, len, r0, rand, o = {} ) {

	const seed = rand();
	const n = Math.max( 3, Math.min( 10, Math.round( len / 0.18 ) ) );
	const dx = Math.cos( yaw ), dz = - Math.sin( yaw );
	const curve = ( rand() - 0.5 ) * 0.6;
	const pts = [], radii = [];
	let px = x - dx * len / 2, pz = z - dz * len / 2, ang = yaw - curve * 0.5;
	for ( let k = 0; k <= n; k ++ ) {

		const t = k / n;
		const r = r0 * ( 1 - 0.7 * t );
		pts.push( [ px, ground( px, pz ) + r * 0.7, pz ] );
		radii.push( r );
		ang += curve / n + ( rand() - 0.5 ) * 0.25;
		px += Math.cos( ang ) * len / n;
		pz -= Math.sin( ang ) * len / n;

	}

	const wd = nat( seed, KIND.DRIFT, 0.1, r0 * 2 );
	const tone = o.tone || [ 1, 1, 1 ];
	const tube = taperTube( pts, radii, r0 > 0.03 ? 6 : 5 );
	B.add( 'nature', tube.part, IDENT, tone, wd );
	// side twigs
	const twigs = o.twigs ?? Math.floor( rand() * 3 );
	for ( let k = 0; k < twigs; k ++ ) {

		const j = 1 + Math.floor( rand() * ( n - 1 ) );
		const a = ang + ( rand() < 0.5 ? 1 : - 1 ) * ( 0.4 + rand() * 0.7 );
		const tl = len * ( 0.15 + rand() * 0.3 );
		const q0 = pts[ j ];
		const qx = q0[ 0 ] + Math.cos( a ) * tl, qz = q0[ 2 ] - Math.sin( a ) * tl;
		const mx = ( q0[ 0 ] + qx ) / 2, mz = ( q0[ 2 ] + qz ) / 2;
		const tr = radii[ j ] * 0.5;
		const tp = [ q0, [ mx, ground( mx, mz ) + tr * 0.9, mz ], [ qx, ground( qx, qz ) + tr * 0.4, qz ] ];
		const tw = taperTube( tp, [ tr, tr * 0.7, tr * 0.3 ], 4 );
		B.add( 'nature', tw.part, IDENT, tone, wd );

	}

	return pts;

}

// ---------------------------------------------------------------------------
// planks and boards

// A loose board lying on the ground (optionally weathered paint remnants), tilted to the ground.
export function plank( B, ground, x, z, yaw, len, w, th, rand, o = {} ) {

	const seed = rand();
	const dx = Math.cos( yaw ), dz = - Math.sin( yaw );
	const hA = ground( x - dx * len * 0.4, z - dz * len * 0.4 ), hB = ground( x + dx * len * 0.4, z + dz * len * 0.4 );
	const hS = ground( x - dz * w * 0.4, z + dx * w * 0.4 ), hT = ground( x + dz * w * 0.4, z - dx * w * 0.4 );
	const pitch = Math.atan2( hB - hA, len * 0.8 ) + ( o.lift ?? 0 );
	const roll = Math.atan2( hS - hT, w * 0.8 );
	const y = ( o.y ?? ( hA + hB ) / 2 ) + th / 2 - th * ( o.sink ?? 0.3 );
	const paint = o.paint ?? 0;
	B.pushAt( x, y, z, yaw, roll, pitch );
	B.box( 'wood', 0, 0, 0, len, th, w, { grain: 0, tint: o.tint || [ 1.02, 1.0, 0.96 ], data: WOOD( seed, o.weather ?? 0.95, paint, 0 ) } );
	B.pop();
	return y;

}

// ---------------------------------------------------------------------------
// coconuts

const coconutCache = new Map();
function coconutPart( variant ) {

	let part = coconutCache.get( variant );
	if ( part ) return part;
	const L = 0.25, R = 0.098;
	const rows = 6, cols = 8;
	const ph = hash1( variant * 3.3 ) * TAU;
	const P = [];
	for ( let j = 0; j <= rows; j ++ ) {

		const t = j / rows;
		// obovoid: rounded stem end, tapering to a blunt point
		const tt = 0.015 + 0.97 * t;
		const r = R * Math.pow( Math.sin( Math.PI * tt ), 0.62 ) * ( 1.06 - 0.22 * t ) * ( j === 0 || j === rows ? 0.12 : 1 );
		const row = [];
		for ( let i = 0; i < cols; i ++ ) {

			const a = i / cols * TAU;
			const ridge = 1 + 0.075 * Math.cos( 3 * ( a + ph ) ) * Math.sin( Math.PI * t );
			const lump = 1 + 0.03 * vnoise3( Math.cos( a ) * 2, Math.sin( a ) * 2, t * 3, variant );
			row.push( [ Math.cos( a ) * r * ridge * lump, t * L - L / 2, Math.sin( a ) * r * ridge * lump ] );

		}

		P.push( row );

	}

	part = gridMesh( P, true, ( i, j ) => [ j / rows * L, i / cols * TAU * R ] );
	coconutCache.set( variant, part );
	return part;

}

// Whole coconut in its husk lying on its side. p0: 0 fresh (green / yellow), 0.5 brown, 1 grey old
export function coconut( B, ground, x, z, rand, o = {} ) {

	const s = ( o.scale ?? 1 ) * ( 0.85 + rand() * 0.3 );
	const g = ground( x, z );
	const age = o.age ?? rand();
	const lie = Math.PI / 2 + ( rand() - 0.5 ) * 0.5;
	B.part( 'nature', coconutPart( Math.floor( rand() * 6 ) ), x, g + 0.098 * s * 0.72, z, {
		ry: rand() * TAU, rz: lie, rx: ( rand() - 0.5 ) * 0.3, sx: s, sy: s, sz: s,
		tint: [ 1, 1, 1 ], data: nat( rand(), KIND.COCONUT, age, 0.2 * s ),
	} );

}

// Split husk / shell half (cup), open side up or down.
const huskCache = new Map();
function huskPart( variant ) {

	let part = huskCache.get( variant );
	if ( part ) return part;
	const R = 0.085, H = 0.075, th = 0.022;
	const rows = 4, cols = 8;
	// outer surface bottom -> rim, inner surface rim -> bottom
	const P = [];
	const jag = [];
	for ( let i = 0; i < cols; i ++ ) jag.push( 0.012 * ( hash1( variant * 13 + i ) - 0.5 ) );
	for ( let j = 0; j <= rows * 2 + 1; j ++ ) {

		const row = [];
		for ( let i = 0; i < cols; i ++ ) {

			const a = i / cols * TAU;
			let r, y;
			if ( j <= rows ) {

				const t = j / rows;
				r = R * Math.sin( t * Math.PI / 2 ) * ( 1 + 0.04 * Math.cos( 3 * a ) );
				y = H * ( 1 - Math.cos( t * Math.PI / 2 ) ) + ( j === rows ? jag[ i ] : 0 );

			} else {

				const t = 1 - ( j - rows - 1 ) / rows;
				r = ( R - th ) * Math.sin( t * Math.PI / 2 ) * ( 1 + 0.04 * Math.cos( 3 * a ) );
				y = th * 0.8 + ( H - th * 0.8 ) * ( 1 - Math.cos( t * Math.PI / 2 ) ) + ( j === rows + 1 ? jag[ i ] : 0 );

			}

			row.push( [ Math.cos( a ) * Math.max( r, 0.002 ), y, Math.sin( a ) * Math.max( r, 0.002 ) ] );

		}

		P.push( row );

	}

	// outer rows face away from the axis, inner rows toward it
	part = gridMesh( P, true, ( i, j ) => [ j * 0.02, i / cols * TAU * R ], ( j, i, q ) => ( j <= rows ? [ q[ 0 ], 0, q[ 2 ] ] : [ - q[ 0 ], 0.3, - q[ 2 ] ] ) );
	huskCache.set( variant, part );
	return part;

}

export function husk( B, ground, x, z, rand, o = {} ) {

	const s = 0.85 + rand() * 0.35;
	const up = rand() < 0.5;
	const g = ground( x, z );
	B.part( 'nature', huskPart( Math.floor( rand() * 4 ) ), x, g + ( up ? - 0.012 : 0.072 * s ), z, {
		ry: rand() * TAU, rx: ( up ? 0 : Math.PI ) + ( rand() - 0.5 ) * 0.5, rz: ( rand() - 0.5 ) * 0.5, sx: s, sy: s * ( 0.8 + rand() * 0.3 ), sz: s,
		tint: [ 1, 1, 1 ], data: nat( rand(), KIND.COCONUT, 1.5 + rand() * 0.5, 0.17 * s ),
	} );

}

// ---------------------------------------------------------------------------
// seaweed and seagrass wrack (draped on the ground, world space)

// Sargassum mat: lumpy, ragged-edged clump. R: radius (m), H: height. p0 dryness 0..1
export function weedMat( B, ground, x, z, R, H, rand, o = {} ) {

	const seed = rand();
	const nr = 3, na = R > 0.35 ? 10 : 7;
	const aspect = o.aspect ?? 1 + rand() * 0.8, rot = o.rot ?? rand() * TAU;
	const ca = Math.cos( rot ), sa = Math.sin( rot );
	const edge = [];
	for ( let i = 0; i < na; i ++ ) edge.push( 0.62 + 0.55 * hash1( seed * 91 + i * 1.7 ) );
	const P = [];
	for ( let j = 0; j <= nr; j ++ ) {

		const t = j / nr;
		const row = [];
		for ( let i = 0; i < na; i ++ ) {

			const a = i / na * TAU;
			const e = edge[ i ] * 0.6 + edge[ ( i + 1 ) % na ] * 0.2 + edge[ ( i + na - 1 ) % na ] * 0.2;
			const rr = R * Math.max( t, 0.04 ) * e;
			const lx = Math.cos( a ) * rr * aspect, lz = Math.sin( a ) * rr;
			const wx = x + lx * ca - lz * sa, wz = z + lx * sa + lz * ca;
			const lump = 0.55 + 0.9 * ( vnoise3( wx * 9, wz * 9, seed * 50, 7 ) * 0.5 + 0.5 );
			const h = H * Math.pow( Math.max( 0, 1 - t * t ), 0.6 ) * lump;
			row.push( [ wx, ground( wx, wz ) + h - 0.012 * t, wz ] );

		}

		P.push( row );

	}

	const part = gridMesh( P, true, ( i, j ) => [ P[ j ][ i % na ][ 0 ] - x, P[ j ][ i % na ][ 2 ] - z ], () => [ 0, 1, 0 ] );
	const dry = o.dry ?? rand();
	B.add( 'nature', part, IDENT, o.tint || [ 1, 1, 1 ], nat( seed, KIND.WEED, dry, R * 2 ) );
	// seagrass ribbons tangled into the clump, sticking out of its edges
	if ( o.fringe !== false ) seagrassWrack( B, ground, x, z, R * 0.95, rand, { count: Math.round( 2 + R * 6 ), dry: Math.min( 1, dry + 0.2 ), lift: H * 0.5, minLen: R * 0.6 } );
	// loose strands trailing out of the clump
	const strands = o.strands ?? Math.floor( rand() * 2 );
	for ( let k = 0; k < strands; k ++ ) {

		const a0 = rand() * TAU;
		let px = x + Math.cos( a0 ) * R * 0.7, pz = z + Math.sin( a0 ) * R * 0.7;
		let a = a0 + ( rand() - 0.5 ) * 0.8;
		const L = R * ( 0.8 + rand() * 1.5 ), n = 5;
		const pts = [], radii = [];
		for ( let m = 0; m <= n; m ++ ) {

			const r = 0.006 * ( 1 - 0.5 * m / n );
			pts.push( [ px, ground( px, pz ) + r * 0.8, pz ] );
			radii.push( r );
			a += ( rand() - 0.5 ) * 0.7;
			px += Math.cos( a ) * L / n;
			pz += Math.sin( a ) * L / n;

		}

		B.add( 'nature', taperTube( pts, radii, 4 ).part, IDENT, [ 1, 1, 1 ], nat( seed + k, KIND.WEED, dry, 0.05 ) );

	}

}

// Tangle of dried seagrass / turtle grass ribbons lying flat (a patch of radius R).
export function seagrassWrack( B, ground, x, z, R, rand, o = {} ) {

	const seed = rand();
	const count = o.count ?? Math.round( 8 + R * 45 );
	const dir = o.dir ?? rand() * TAU;
	const lift0 = o.lift ?? 0;
	for ( let k = 0; k < count; k ++ ) {

		const rr = R * Math.sqrt( rand() );
		const a0 = rand() * TAU;
		let px = x + Math.cos( a0 ) * rr, pz = z + Math.sin( a0 ) * rr;
		let a = dir + ( rand() - 0.5 ) * 1.6 + ( rand() < 0.5 ? Math.PI : 0 );
		const L = ( o.minLen ?? 0.1 ) + rand() * 0.34, w = 0.008 + rand() * 0.007;
		const n = 3;
		// piled: ribbons near the middle of the patch lie higher
		const lift = 0.003 + ( k % 5 ) * 0.003 + lift0 * Math.max( 0, 1 - rr / R ) * rand() + ( 1 - rr / R ) * 0.012;
		const P = [];
		for ( let m = 0; m <= n; m ++ ) {

			const sx = Math.sin( a ) * w * 0.5, sz = - Math.cos( a ) * w * 0.5;
			const g0 = ground( px - sx, pz - sz ) + lift, g1 = ground( px + sx, pz + sz ) + lift;
			P.push( [ [ px - sx, g0, pz - sz ], [ px + sx, g1, pz + sz ] ] );
			a += ( rand() - 0.5 ) * 0.5;
			px += Math.cos( a ) * L / n;
			pz += Math.sin( a ) * L / n;

		}

		const part = gridMesh( P, false, ( i, j ) => [ j / n * L, i * w ] );
		// flat ribbons face up
		for ( let i = 0; i < part.n.length; i += 3 ) {

			part.n[ i ] *= 0.2; part.n[ i + 1 ] = Math.abs( part.n[ i + 1 ] ) + 0.8; part.n[ i + 2 ] *= 0.2;
			const l = Math.hypot( part.n[ i ], part.n[ i + 1 ], part.n[ i + 2 ] );
			part.n[ i ] /= l; part.n[ i + 1 ] /= l; part.n[ i + 2 ] /= l;

		}

		fixUp( part );
		const tone = 0.75 + rand() * 0.5;
		B.add( 'nature', part, IDENT, [ tone, tone, tone ], nat( seed + k * 0.013, KIND.WEED, Math.min( 1, ( o.dry ?? 0.7 ) + ( rand() - 0.5 ) * 0.5 ), 0.03 ) );

	}

}

// make every triangle and normal face +y (flat sheets seen from above)
function fixUp( part ) {

	const { p, n, idx } = part;
	for ( let i = 0; i < n.length; i += 3 ) if ( n[ i + 1 ] < 0 ) {

		n[ i ] = - n[ i ]; n[ i + 1 ] = - n[ i + 1 ]; n[ i + 2 ] = - n[ i + 2 ];

	}

	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uz = p[ b + 2 ] - p[ a + 2 ];
		const vx = p[ c ] - p[ a ], vz = p[ c + 2 ] - p[ a + 2 ];
		if ( uz * vx - ux * vz < 0 ) {

			const s = idx[ t + 1 ];
			idx[ t + 1 ] = idx[ t + 2 ];
			idx[ t + 2 ] = s;

		}

	}

}

// ---------------------------------------------------------------------------
// palm fronds (dry, fallen)

// Fallen coconut palm frond: arching rachis lying on the ground with drooping, partly broken
// leaflets on both sides. dry: 0 recently fallen (olive / yellow) .. 1 grey-brown
export function frond( B, ground, x, z, yaw, len, rand, o = {} ) {

	const seed = rand();
	const dry = o.dry ?? 0.5 + rand() * 0.5;
	const data = nat( seed, KIND.FROND, dry, 0.4 );
	const n = 9;
	const pts = [], radii = [], dirs = [];
	let a = yaw, px = x, pz = z;
	const curve = ( rand() - 0.5 ) * 0.5;
	for ( let k = 0; k <= n; k ++ ) {

		const t = k / n;
		const r = 0.035 * ( 1 - t * 0.85 ) + 0.004;
		// the base (petiole) lies on the ground, the middle arches up a little
		const lift = r * 0.8 + Math.sin( Math.PI * Math.min( 1, t * 1.3 ) ) * 0.06 * ( o.arch ?? 1 );
		pts.push( [ px, ground( px, pz ) + lift, pz ] );
		radii.push( r );
		dirs.push( a );
		a += curve / n + ( rand() - 0.5 ) * 0.12;
		px += Math.cos( a ) * len / n;
		pz -= Math.sin( a ) * len / n;

	}

	B.add( 'nature', taperTube( pts, radii, 4 ).part, IDENT, [ 1, 1, 1 ], nat( seed, KIND.FROND, dry, 0.3 ) );
	// flat, widened base (sheath)
	{

		const bx = x - Math.cos( yaw ) * 0.25, bz = z + Math.sin( yaw ) * 0.25;
		const w = 0.16;
		const P = [];
		for ( let m = 0; m <= 2; m ++ ) {

			const t = m / 2;
			const cx = bx + ( x - bx ) * t, cz = bz + ( z - bz ) * t;
			const ww = w * ( 1 - t * 0.7 );
			const sx = Math.sin( yaw ) * ww, sz = Math.cos( yaw ) * ww;
			P.push( [ [ cx - sx, ground( cx - sx, cz - sz ) + 0.012, cz - sz ], [ cx, ground( cx, cz ) + 0.03, cz ], [ cx + sx, ground( cx + sx, cz + sz ) + 0.012, cz + sz ] ] );

		}

		const part = gridMesh( P, false, ( i, j ) => [ j * 0.12, i * 0.08 ] );
		fixUp( part );
		B.add( 'nature', part, IDENT, [ 0.85, 0.8, 0.75 ], data );

	}

	// leaflets
	const count = o.leaflets ?? 14;
	for ( let k = 0; k < count; k ++ ) {

		const t = 0.12 + 0.86 * k / count;
		const f = t * n, j = Math.min( n - 1, Math.floor( f ) ), ft = f - j;
		const bx = pts[ j ][ 0 ] + ( pts[ j + 1 ][ 0 ] - pts[ j ][ 0 ] ) * ft, bz = pts[ j ][ 2 ] + ( pts[ j + 1 ][ 2 ] - pts[ j ][ 2 ] ) * ft;
		const by = pts[ j ][ 1 ] + ( pts[ j + 1 ][ 1 ] - pts[ j ][ 1 ] ) * ft;
		const ad = dirs[ j ];
		for ( const side of [ - 1, 1 ] ) {

			if ( rand() < ( o.broken ?? 0.3 ) ) continue; // torn off
			const ll = len * ( 0.34 - 0.2 * Math.abs( t - 0.4 ) ) * ( 0.6 + rand() * 0.5 ) * ( rand() < 0.15 ? 0.4 : 1 );
			const la = ad + side * ( 0.75 + rand() * 0.35 ) - 0.15 * side;
			const w = 0.028 + rand() * 0.012;
			const P = [];
			let lx = bx, lz = bz, lang = la;
			const m = 3;
			for ( let q = 0; q <= m; q ++ ) {

				const tq = q / m;
				const ww = w * ( q === m ? 0.15 : 1 - tq * 0.4 );
				const sx = Math.sin( lang ) * ww * 0.5, sz = Math.cos( lang ) * ww * 0.5;
				const gy = ground( lx, lz ) + 0.006 + ( k % 3 ) * 0.002;
				const y = q === 0 ? Math.max( by, gy ) : Math.max( gy, by + ( gy - by ) * Math.min( 1, tq * 2.5 ) );
				P.push( [ [ lx - sx, y + ww * 0.15, lz - sz ], [ lx + sx, y + ww * 0.15, lz + sz ] ] );
				lang += side * ( rand() - 0.3 ) * 0.2;
				lx += Math.cos( lang ) * ll / m;
				lz -= Math.sin( lang ) * ll / m;

			}

			const part = gridMesh( P, false, ( i, jj ) => [ jj / m * ll, i * w ] );
			fixUp( part );
			B.add( 'nature', part, IDENT, [ 1, 1, 1 ], nat( seed + k * 0.07, KIND.FROND, Math.min( 1, dry + ( rand() - 0.5 ) * 0.3 ), 0.4 ) );

		}

	}

}

// ---------------------------------------------------------------------------
// shells and coral

// Larger shells: clam half-shells (cups) and turban / cone shells. size ~ length (m)
export function shell( B, ground, x, z, size, rand, o = {} ) {

	const g = ground( x, z );
	const type = o.type ?? ( rand() < 0.65 ? 0 : 1 );
	const seed = rand();
	const hue = rand();
	if ( type === 0 ) {

		// clam half shell: a ribbed cup, lying either way up
		const up = rand() < 0.55;
		const prof = [ [ 0, 0 ], [ 0.35, 0.1 ], [ 0.72, 0.26 ], [ 1, 0.38 ], [ 0.93, 0.36 ], [ 0.66, 0.24 ], [ 0.3, 0.1 ], [ 0.001, 0.05 ] ];
		B.lathe( 'nature', x, g + ( up ? 0.003 : size * 0.19 ), z, prof, {
			segs: 6, ry: rand() * TAU, rx: up ? ( rand() - 0.5 ) * 0.3 : Math.PI + ( rand() - 0.5 ) * 0.3, sx: size * 0.5, sy: size * 0.5, sz: size * 0.43,
			tint: [ 1, 1, 1 ], data: nat( seed, KIND.SHELL, hue, size ),
		} );

	} else {

		// turban / top shell: spiral cone lying on its side
		const prof = [ [ 0.001, 0 ], [ 0.42, 0.05 ], [ 0.5, 0.22 ], [ 0.4, 0.45 ], [ 0.27, 0.66 ], [ 0.13, 0.86 ], [ 0.001, 1 ] ];
		B.lathe( 'nature', x, g + size * 0.3, z, prof.map( ( [ r, y ] ) => [ r, y - 0.4 ] ), {
			segs: 7, ry: rand() * TAU, rz: Math.PI / 2 - 0.35 + ( rand() - 0.5 ) * 0.3, sx: size, sy: size, sz: size,
			tint: [ 1, 1, 1 ], data: nat( seed, KIND.SHELL, 1 + hue, size ),
		} );

	}

}

// Branching coral rubble (bleached) or a rounded brain-coral chunk.
export function coralPiece( B, ground, x, z, size, rand, o = {} ) {

	const g = ground( x, z );
	const seed = rand();
	const bleach = o.bleach ?? 0.6 + rand() * 0.4;
	if ( o.head || rand() < 0.15 ) {

		const part = stonePart( Math.floor( rand() * 12 ), 1, 0 );
		B.part( 'nature', part, x, g + size * 0.25, z, { ry: rand() * TAU, sx: size * 0.5, sy: size * 0.38, sz: size * 0.45, tint: [ 1, 1, 1 ], data: nat( seed, KIND.CORAL, bleach + 2, size ) } );
		return;

	}

	// staghorn fragment: a main stick with 1-3 short branches, lying flat
	const yaw = rand() * TAU;
	const L = size;
	const r = size * ( 0.07 + rand() * 0.04 );
	const pts = [];
	const n = 3;
	for ( let k = 0; k <= n; k ++ ) {

		const t = k / n - 0.5;
		const px = x + Math.cos( yaw ) * t * L, pz = z - Math.sin( yaw ) * t * L;
		pts.push( [ px, g + r * 0.8 + ( k === 1 ? r * 0.3 : 0 ), pz ] );

	}

	const d = nat( seed, KIND.CORAL, bleach, size );
	B.add( 'nature', taperTube( pts, [ r, r * 1.05, r * 0.95, r * 0.7 ], 6 ).part, IDENT, [ 1, 1, 1 ], d );
	const nb = 1 + Math.floor( rand() * 3 );
	for ( let k = 0; k < nb; k ++ ) {

		const j = 1 + Math.floor( rand() * 2 );
		const a = yaw + ( rand() < 0.5 ? 1 : - 1 ) * ( 0.5 + rand() * 0.6 );
		const bl = L * ( 0.25 + rand() * 0.3 );
		const q = pts[ j ];
		const e = [ q[ 0 ] + Math.cos( a ) * bl, q[ 1 ] + ( rand() - 0.3 ) * bl * 0.4, q[ 2 ] - Math.sin( a ) * bl ];
		B.rod( 'nature', q, e, r * 0.8, r * 0.5, { segs: 5, capTop: true, tint: [ 1, 1, 1 ], data: d } );

	}

}

// ---------------------------------------------------------------------------
// man-made debris

// Old tyre lying flat (or leaning: o.lean), sunk in the sand.
export function tyre( B, ground, x, z, rand, o = {} ) {

	const R = o.R ?? 0.27 + rand() * 0.05, r = o.r ?? 0.09 + rand() * 0.015;
	const g = o.y ?? ground( x, z );
	const seed = rand();
	const lean = o.lean ?? 0;
	B.torus( 'hard', x, g + r * 0.72 * ( 1 - ( o.sink ?? 0.35 ) ) + Math.sin( lean ) * R, z, R, r, {
		ry: o.ry ?? rand() * TAU, rz: lean + ( rand() - 0.5 ) * 0.1, rx: ( rand() - 0.5 ) * 0.1, sy: 0.72,
		radial: 8, tubular: 18, tint: mulc( C.rubber, 1.3 + rand() * 0.6 ), data: HARD( seed, 0, 0, 0.82 ),
	} );
	return g + r * 0.72 * 2;

}

// plastic bottle on its side
export function bottle( B, ground, x, z, rand ) {

	const g = ground( x, z );
	const pal = [ lin( 0xd8e4e6 ), lin( 0x7fb0c8 ), lin( 0x6f9a70 ), lin( 0xe8e6de ), lin( 0x9fc0cf ) ];
	const tint = pal[ Math.floor( rand() * pal.length ) ];
	const s = 0.8 + rand() * 0.5;
	const prof = [ [ 0.001, 0 ], [ 0.03, 0.002 ], [ 0.034, 0.012 ], [ 0.034, 0.16 ], [ 0.028, 0.2 ], [ 0.013, 0.235 ], [ 0.013, 0.25 ], [ 0.015, 0.252 ], [ 0.015, 0.268 ], [ 0.001, 0.27 ] ];
	B.lathe( 'hard', x, g + 0.026 * s, z, prof.map( ( [ r, y ] ) => [ r, y - 0.13 ] ), {
		segs: 8, ry: rand() * TAU, rz: Math.PI / 2 + ( rand() - 0.5 ) * 0.2, sx: s, sy: s, sz: s, tint, data: HARD( rand(), 0, 0, 0.3 ),
	} );

}

// flip-flop (rubber sandal)
export function flipFlop( B, ground, x, z, rand ) {

	const g = ground( x, z );
	const pal = [ lin( 0x2f6fa8 ), lin( 0xc94a3a ), lin( 0xe0b640 ), lin( 0x3a8a6a ), lin( 0x303030 ), lin( 0xe07aa0 ) ];
	const tint = pal[ Math.floor( rand() * pal.length ) ];
	const yaw = rand() * TAU, s = 0.9 + rand() * 0.2;
	const pts = [ [ 0, - 0.12 ], [ 0.04, - 0.1 ], [ 0.045, 0.0 ], [ 0.05, 0.08 ], [ 0.03, 0.13 ], [ - 0.02, 0.135 ], [ - 0.045, 0.08 ], [ - 0.04, - 0.02 ], [ - 0.035, - 0.1 ] ];
	B.pushAt( x, g + 0.012, z, yaw, ( rand() - 0.5 ) * 0.1, ( rand() - 0.5 ) * 0.1 );
	const V = pts.map( ( [ a, b ] ) => new Vector3( a * s, 0, b * s ) );
	B.add( 'hard', slabPart( V, 0.014, new Vector3( 0, 0, 1 ), new Vector3( 0, 1, 0 ) ), IDENT, mulc( tint, 0.8 ), HARD( rand(), 0, 0, 0.85 ) );
	const strap = [ new Vector3( - 0.038 * s, 0, 0.0 ), new Vector3( - 0.02 * s, 0.03, 0.06 * s ), new Vector3( 0, 0.012, 0.1 * s ), new Vector3( 0.02 * s, 0.03, 0.06 * s ), new Vector3( 0.04 * s, 0, 0.0 ) ];
	B.tube( 'hard', strap, 0.0055, { radial: 4, tint: mulc( tint, 0.9 ), data: HARD( rand(), 0, 0, 0.7 ) } );
	B.pop();

}

// Draped rope scrap with a frayed end, or a tangled ball of rope (o.tangle).
export function ropeScrap( B, ground, x, z, rand, o = {} ) {

	const r = o.r ?? 0.009 + rand() * 0.008;
	const tint = o.tint || [ C.rope, C.ropeDark, C.ropeBlue, lin( 0xd0c070 ), lin( 0x3f7f55 ), lin( 0xc8602c ) ][ Math.floor( rand() * 6 ) ];
	const seed = rand();
	if ( o.tangle ) {

		// a loose ball of loops
		const R = o.R ?? 0.12 + rand() * 0.12;
		const g = ground( x, z );
		const loops = 3 + Math.floor( rand() * 3 );
		for ( let k = 0; k < loops; k ++ ) {

			const pts = [];
			const ax = rand() * TAU, tilt = 0.3 + rand() * 0.8;
			for ( let m = 0; m <= 12; m ++ ) {

				const a = m / 12 * TAU * ( 0.8 + rand() * 0.1 );
				const lx = Math.cos( a ) * R * ( 0.7 + rand() * 0.4 ), ly = Math.sin( a ) * R * 0.6 * Math.sin( tilt ), lz = Math.sin( a ) * R * Math.cos( tilt );
				const wx = x + lx * Math.cos( ax ) - lz * Math.sin( ax ), wz = z + lx * Math.sin( ax ) + lz * Math.cos( ax );
				pts.push( new Vector3( wx, Math.max( g + ly + R * 0.45, ground( wx, wz ) + r ), wz ) );

			}

			B.tube( 'rope', pts, r, { radial: 4, tint, data: [ seed + k * 0.1, 0, 0, 0 ] } );

		}

		return;

	}

	const L = o.len ?? 0.5 + rand() * 1.4;
	const n = Math.max( 6, Math.round( L / 0.08 ) );
	let a = rand() * TAU, px = x, pz = z;
	const pts = [];
	for ( let m = 0; m <= n; m ++ ) {

		pts.push( new Vector3( px, ground( px, pz ) + r * 0.8, pz ) );
		a += ( rand() - 0.5 ) * 0.9;
		px += Math.cos( a ) * L / n;
		pz += Math.sin( a ) * L / n;

	}

	B.tube( 'rope', pts, r, { radial: 4, tint, data: [ seed, 0, 0, 0 ] } );

}

// A torn piece of fishing net lying bunched up on the ground (fabric material, alpha tested).
export function netScrap( B, ground, x, z, rand, o = {} ) {

	const W = o.w ?? 0.8 + rand() * 1.2, D = o.d ?? 0.5 + rand() * 0.8;
	const cols = 7, rows = 5;
	const yaw = rand() * TAU, cy = Math.cos( yaw ), sy = Math.sin( yaw );
	const seed = rand();
	const tint = o.tint || [ lin( 0x3f6f5f ), lin( 0x2f5f8a ), lin( 0xb0553a ), lin( 0x6a8a3a ), lin( 0x506070 ) ][ Math.floor( rand() * 5 ) ];
	const folds = 1 + rand() * 2.5;
	const P = [];
	for ( let j = 0; j <= rows; j ++ ) {

		const row = [];
		for ( let i = 0; i <= cols; i ++ ) {

			const u = i / cols - 0.5, v = j / rows - 0.5;
			// bunched: pulled together along one axis with ridges
			const lx = u * W * ( 0.75 + 0.25 * Math.cos( v * 3 ) ) + ( rand() - 0.5 ) * 0.05, lz = v * D + ( rand() - 0.5 ) * 0.05;
			const wx = x + lx * cy + lz * sy, wz = z - lx * sy + lz * cy;
			const ridge = Math.max( 0, Math.sin( u * Math.PI * folds * 2 + seed * 6 ) ) * 0.05 * ( 1 - Math.abs( v ) * 1.5 );
			row.push( [ wx, ground( wx, wz ) + 0.01 + ridge + 0.02 * ( 1 - Math.abs( u ) * 2 ) * ( 1 - Math.abs( v ) * 2 ), wz ] );

		}

		P.push( row );

	}

	const part = gridMesh( P, false, ( i, j ) => [ i / cols * W, j / rows * D ] );
	B.add( 'net', part, IDENT, tint, [ seed, 0, 0.03 + rand() * 0.02, 0 ] );
	// a float or two still attached
	if ( rand() < 0.5 ) {

		const fx = P[ 0 ][ 0 ][ 0 ], fz = P[ 0 ][ 0 ][ 2 ];
		buoy( B, fx, ground( fx, fz ) + 0.075, fz, C.orange, C.orange, 2, rand(), { rz: Math.PI / 2, ry: rand() * TAU } );

	}

}

// Washed-up fishing float lying on its side: egg float, round trawl float or foam cylinder.
// Sun-faded and dirty (hard material rust channel as grime).
const FLOAT_COLORS = [ [ 0xe8622a, 0xf2efe6 ], [ 0xf0a020, 0xf0a020 ], [ 0xc23b2e, 0xf2efe6 ], [ 0xf0c23a, 0x202020 ], [ 0xf2efe6, 0x2f6fa8 ], [ 0xe8622a, 0xe8622a ], [ 0x3f7f55, 0xf0c23a ], [ 0xd8d4c8, 0xd8d4c8 ] ];
export function floatBuoy( B, ground, x, z, rand, o = {} ) {

	const [ ca, cb ] = FLOAT_COLORS[ Math.floor( rand() * FLOAT_COLORS.length ) ];
	const fade = 0.08 + rand() * 0.3;
	const fa = lin( ca ).map( ( c ) => c + ( 0.62 - c ) * fade ), fb = lin( cb ).map( ( c ) => c + ( 0.62 - c ) * fade );
	const d = HARD( rand(), 0.12 + rand() * 0.25, 0, 0.45 + rand() * 0.2 );
	const kind = o.kind ?? ( rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2 );
	const g = ground( x, z );
	const s = 0.85 + rand() * 0.3;
	if ( kind === 0 ) {

		const prof = [ [ 0.0, 0.0 ], [ 0.05, 0.008 ], [ 0.092, 0.035 ], [ 0.12, 0.09 ], [ 0.124, 0.15 ], [ 0.11, 0.22 ], [ 0.075, 0.275 ], [ 0.035, 0.302 ], [ 0.0, 0.31 ] ];
		B.lathe( 'hard', x, g + 0.105 * s, z, prof.map( ( [ r, y ] ) => [ r, y - 0.155 ] ), {
			segs: 14, ry: rand() * TAU, rz: Math.PI / 2 + ( rand() - 0.5 ) * 0.25, sx: s, sy: s, sz: s, tint: ( px, py ) => ( py > 0.0 ? fa : fb ), data: d,
		} );

	} else if ( kind === 1 ) {

		const prof = [];
		for ( let k = 0; k <= 8; k ++ ) {

			const a = - Math.PI / 2 + k / 8 * Math.PI;
			prof.push( [ Math.cos( a ) * 0.1 + ( k === 0 || k === 8 ? 0 : 0 ), Math.sin( a ) * 0.1 ] );

		}

		prof[ 0 ][ 0 ] = 0.001; prof[ 8 ][ 0 ] = 0.001;
		const yaw = rand() * TAU;
		B.lathe( 'hard', x, g + 0.085 * s, z, prof, { segs: 14, ry: yaw, rz: Math.PI / 2 + ( rand() - 0.5 ) * 0.6, sx: s, sy: s, sz: s, tint: fa, data: d } );
		// moulded eyes on the equator
		B.torus( 'hard', x + Math.cos( yaw ) * 0.1 * s, g + 0.1 * s, z - Math.sin( yaw ) * 0.1 * s, 0.022 * s, 0.007 * s, { ry: yaw, rx: Math.PI / 2, radial: 4, tubular: 8, tint: fa, data: d } );

	} else {

		const prof = [ [ 0.001, 0 ], [ 0.055, 0.004 ], [ 0.07, 0.02 ], [ 0.072, 0.17 ], [ 0.058, 0.188 ], [ 0.001, 0.19 ] ];
		B.lathe( 'hard', x, g + 0.06 * s, z, prof.map( ( [ r, y ] ) => [ r, y - 0.095 ] ), {
			segs: 12, ry: rand() * TAU, rz: Math.PI / 2 + ( rand() - 0.5 ) * 0.15, sx: s, sy: s, sz: s, tint: fa, data: HARD( rand(), 0.25 + rand() * 0.3, 0, 0.85 ),
		} );

	}

}

// Wheelbarrow (galvanised tray, wooden handles), wheel toward local +x.
export function wheelbarrow( B, ground, x, z, yaw, rand, o = {} ) {

	const seed = rand();
	const g = ground( x, z );
	const rust = 0.4 + rand() * 0.4;
	const tray = HARD( seed, rust, 0.55, 0.55 );
	const tint = o.tint || ( rand() < 0.5 ? C.galv : lin( 0x3f7f55 ) );
	B.pushAt( x, g, z, yaw );
	// tray: bottom, two sides, back, sloped front
	B.box( 'hard', 0, 0.42, 0, 0.62, 0.012, 0.46, { tint, data: tray } );
	for ( const s of [ - 1, 1 ] ) B.box( 'hard', 0.02, 0.55, s * 0.28, 0.78, 0.26, 0.012, { rx: s * 0.28, tint, data: tray } );
	B.box( 'hard', - 0.33, 0.56, 0, 0.012, 0.28, 0.62, { rz: - 0.25, tint, data: tray } );
	B.box( 'hard', 0.42, 0.53, 0, 0.012, 0.3, 0.62, { rz: 0.7, tint, data: tray } );
	// handles and legs
	for ( const s of [ - 1, 1 ] ) {

		B.beam( 'wood', [ 0.55, 0.28, s * 0.12 ], [ - 1.0, 0.5, s * 0.27 ], 0.045, 0.045, { data: WOOD( seed + s, 0.8, 0, 0 ) } );
		B.beam( 'wood', [ - 0.25, 0.36, s * 0.2 ], [ - 0.3, 0.0, s * 0.22 ], 0.04, 0.04, { data: WOOD( seed + s * 2, 0.8, 0, 0 ) } );

	}

	// wheel
	B.torus( 'hard', 0.62, 0.17, 0, 0.14, 0.045, { rx: Math.PI / 2, radial: 6, tubular: 14, tint: C.rubber, data: HARD( seed, 0, 0, 0.85 ) } );
	B.cyl( 'hard', 0.62, 0.17, - 0.05, 0.05, 0.05, 0.1, { rx: Math.PI / 2, segs: 8, tint: C.galv, data: HARD( seed, rust, 0.6, 0.5 ) } );
	B.pop();

}

// A pile of boards on two sleepers.
export function plankPile( B, ground, x, z, yaw, rand, o = {} ) {

	const g = minGround( ground, x, z, 0.8 );
	const n = o.n ?? 4 + Math.floor( rand() * 5 );
	const L = o.len ?? 2.2 + rand() * 1.2;
	B.pushAt( x, g, z, yaw );
	for ( const s of [ - 0.7, 0.7 ] ) B.box( 'wood', s * L * 0.35, 0.04, 0, 0.09, 0.09, 0.9, { grain: 2, data: WOOD( rand(), 0.9, 0, 0 ) } );
	let y = 0.09;
	for ( let k = 0; k < n; k ++ ) {

		const w = 0.14 + rand() * 0.1, th = 0.025 + rand() * 0.015;
		const off = ( rand() - 0.5 ) * 0.5;
		const paint = rand() < 0.3 ? 0.2 + rand() * 0.3 : 0;
		const pc = [ lin( 0x5dbcb0 ), lin( 0xec8b76 ), lin( 0xefe2c2 ), lin( 0x8cc2e0 ), lin( 0xf0cf7c ) ][ Math.floor( rand() * 5 ) ];
		B.box( 'wood', ( rand() - 0.5 ) * 0.3, y + th / 2, off, L * ( 0.8 + rand() * 0.25 ), th, w, {
			grain: 0, ry: ( rand() - 0.5 ) * 0.12, tint: paint ? pc : [ 1, 1, 1 ], data: WOOD( rand(), 0.9, paint, 0 ),
		} );
		if ( k % 2 === 1 ) y += th;

	}

	B.pop();
	return { h: y + 0.05, L };

}
