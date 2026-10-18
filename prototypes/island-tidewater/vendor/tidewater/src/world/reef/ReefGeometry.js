import * as THREE from '../../engine/index.js';

// Procedural models of reef organisms, each at several levels of detail (0 = full detail).
//
// Generators take ( rng, lod ) and return an indexed BufferGeometry with `position`,
// `normal` and `aData` (vec4). Models are built around the attachment point at the
// origin with +y up, in meters at scale 1. aData is shared by all models:
//   x: position along the growth axis (0 base .. 1 tip / top)
//   y: baked ambient occlusion (0 enclosed .. 1 open)
//   z: part / flag (model specific: inner wall, spine, tentacle, blade edge ...)
//   w: random value per part (branch, lobe, blade), for colour and motion variation
// Surface detail (corallites, meanders, pores, polyps) is procedural in the materials,
// so the meshes only carry the silhouette.

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3( 0, 1, 0 );
const _x = new THREE.Vector3( 1, 0, 0 );
const TAU = Math.PI * 2;

export const rand = ( rng, a, b ) => a + ( b - a ) * rng();
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

export function perpendicular( v, out = new THREE.Vector3() ) {

	out.crossVectors( v, Math.abs( v.y ) < 0.9 ? _up : _x );
	return out.normalize();

}

export function randomUnitVector( rng, out = new THREE.Vector3() ) {

	const z = rng() * 2 - 1;
	const a = rng() * TAU;
	const r = Math.sqrt( 1 - z * z );
	return out.set( r * Math.cos( a ), z, r * Math.sin( a ) );

}

// Sum of random plane waves: smooth 3D noise in about [-1, 1] for deforming shapes.
export function waveNoise( rng, count, fMin, fMax ) {

	const w = [];
	let norm = 0;
	for ( let i = 0; i < count; i ++ ) {

		const d = randomUnitVector( rng ).multiplyScalar( rand( rng, fMin, fMax ) );
		const a = 1 / ( 1 + i * 0.5 );
		norm += a * a;
		w.push( d.x, d.y, d.z, rng() * TAU, a );

	}

	norm = 1 / Math.sqrt( norm * 0.5 );
	return ( x, y, z ) => {

		let s = 0;
		for ( let i = 0; i < w.length; i += 5 ) s += Math.sin( x * w[ i ] + y * w[ i + 1 ] + z * w[ i + 2 ] + w[ i + 3 ] ) * w[ i + 4 ];
		return s * norm;

	};

}

export class MeshBuilder {

	constructor() {

		this.position = [];
		this.normal = [];
		this.data = [];
		this.index = [];

	}

	get count() {

		return this.position.length / 3;

	}

	vertex( p, n, d0 = 0, d1 = 1, d2 = 0, d3 = 0 ) {

		this.position.push( p.x, p.y, p.z );
		this.normal.push( n.x, n.y, n.z );
		this.data.push( d0, d1, d2, d3 );
		return this.count - 1;

	}

	tri( a, b, c ) {

		this.index.push( a, b, c );

	}

	quad( a, b, c, d ) {

		this.index.push( a, b, c, a, c, d );

	}

	// Appends a copy of the triangles in [ first, end ) facing the other way (thin sheets).
	backfaces( firstVertex, firstIndex ) {

		const nv = this.count, ni = this.index.length;
		const map = new Map();
		for ( let v = firstVertex; v < nv; v ++ ) {

			map.set( v, this.count );
			_p.fromArray( this.position, v * 3 );
			_n.fromArray( this.normal, v * 3 ).negate();
			const d = this.data;
			this.vertex( _p, _n, d[ v * 4 ], d[ v * 4 + 1 ], d[ v * 4 + 2 ], d[ v * 4 + 3 ] );

		}

		for ( let i = firstIndex; i < ni; i += 3 ) this.tri( map.get( this.index[ i ] ), map.get( this.index[ i + 2 ] ), map.get( this.index[ i + 1 ] ) );

	}

	// ao: { radius, strength } bakes occlusion into aData.y (multiplied with what is there)
	build( { normals = false, ao = null } = {} ) {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( this.position, 3 ) );
		geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.normal, 3 ) );
		geometry.setAttribute( 'aData', new THREE.Float32BufferAttribute( this.data, 4 ) );
		geometry.setIndex( this.index );
		if ( normals ) geometry.computeVertexNormals();
		if ( ao ) bakeOcclusion( geometry, ao.radius, ao.strength ?? 1, ao.ground ?? true );
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		return geometry;

	}

}

// Ambient occlusion from the model itself: every triangle is a small disc occluder
// (Bunnell, GPU Gems 2), accumulated for each vertex over its upper hemisphere within
// `radius`. With `ground`, the plane y = 0 occludes too (the seabed the model sits on).
export function bakeOcclusion( geometry, radius, strength = 1, ground = true ) {

	const pos = geometry.attributes.position.array, nrm = geometry.attributes.normal.array;
	const idx = geometry.index.array, dat = geometry.attributes.aData.array;
	const nt = idx.length / 3, nv = pos.length / 3;
	const cx = new Float32Array( nt ), cy = new Float32Array( nt ), cz = new Float32Array( nt );
	const ex = new Float32Array( nt ), ey = new Float32Array( nt ), ez = new Float32Array( nt ), ea = new Float32Array( nt );
	const cell = radius;
	const grid = new Map();
	const key = ( i, j, k ) => ( i + 512 ) * 1048576 + ( j + 512 ) * 1024 + ( k + 512 );
	for ( let t = 0; t < nt; t ++ ) {

		const a = idx[ t * 3 ] * 3, b = idx[ t * 3 + 1 ] * 3, c = idx[ t * 3 + 2 ] * 3;
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ];
		const vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const l = Math.hypot( nx, ny, nz ) || 1e-9;
		ea[ t ] = l * 0.5;
		nx /= l; ny /= l; nz /= l;
		ex[ t ] = nx; ey[ t ] = ny; ez[ t ] = nz;
		cx[ t ] = ( pos[ a ] + pos[ b ] + pos[ c ] ) / 3;
		cy[ t ] = ( pos[ a + 1 ] + pos[ b + 1 ] + pos[ c + 1 ] ) / 3;
		cz[ t ] = ( pos[ a + 2 ] + pos[ b + 2 ] + pos[ c + 2 ] ) / 3;
		const k = key( Math.floor( cx[ t ] / cell ), Math.floor( cy[ t ] / cell ), Math.floor( cz[ t ] / cell ) );
		let list = grid.get( k );
		if ( ! list ) grid.set( k, list = [] );
		list.push( t );

	}

	const r2 = radius * radius;
	for ( let v = 0; v < nv; v ++ ) {

		const px = pos[ v * 3 ], py = pos[ v * 3 + 1 ], pz = pos[ v * 3 + 2 ];
		const nx = nrm[ v * 3 ], ny = nrm[ v * 3 + 1 ], nz = nrm[ v * 3 + 2 ];
		const qx = px + nx * radius * 0.02, qy = py + ny * radius * 0.02, qz = pz + nz * radius * 0.02;
		const gi = Math.floor( qx / cell ), gj = Math.floor( qy / cell ), gk = Math.floor( qz / cell );
		let occ = 0;
		for ( let i = gi - 1; i <= gi + 1; i ++ ) for ( let j = gj - 1; j <= gj + 1; j ++ ) for ( let k = gk - 1; k <= gk + 1; k ++ ) {

			const list = grid.get( key( i, j, k ) );
			if ( ! list ) continue;
			for ( let m = 0; m < list.length; m ++ ) {

				const t = list[ m ];
				const dx = cx[ t ] - qx, dy = cy[ t ] - qy, dz = cz[ t ] - qz;
				const d2 = dx * dx + dy * dy + dz * dz;
				if ( d2 > r2 || d2 < 1e-10 ) continue;
				const d = Math.sqrt( d2 );
				const cr = ( dx * nx + dy * ny + dz * nz ) / d; // receiver cosine
				if ( cr <= 0.05 ) continue;
				const ce = Math.abs( dx * ex[ t ] + dy * ey[ t ] + dz * ez[ t ] ) / d; // emitter cosine
				const A = ea[ t ];
				occ += cr * Math.min( 1, 4 * ce + 0.25 ) * A / ( Math.PI * d2 + A ) * ( 1 - d2 / r2 );

			}

		}

		// the seabed below the model
		if ( ground && ny < 0.9 ) {

			const h = Math.max( py, 0.002 );
			occ += Math.max( 0, - ny * 0.8 + 0.35 ) * Math.exp( - h / ( radius * 0.6 ) ) * 0.6;

		}

		dat[ v * 4 + 1 ] *= clamp( 1 - occ * strength, 0.05, 1 );

	}

}

// Tapered (optionally elliptical) tube along a polyline with an optional rounded end cap.
// o.sides, o.cap (true: rounded tip), o.capLength (tip length / radius, default 0.95: lower is
// blunter), o.ellipse (minor / major radius), o.axis (Vector3 or ( i ) => Vector3, hint for the
// major axis), o.data( i, t ) => [ d0, d2, d3 ] (aData x, z, w)
export function tube( b, points, radii, o = {} ) {

	const sides = o.sides ?? 6;
	const n = points.length;
	const ellipse = o.ellipse ?? 1;
	const s = [ 0 ];
	for ( let i = 1; i < n; i ++ ) s.push( s[ i - 1 ] + points[ i ].distanceTo( points[ i - 1 ] ) );
	const L = s[ n - 1 ] || 1;

	const T = [], N = [], B = [];
	for ( let i = 0; i < n; i ++ ) {

		const a = points[ Math.max( 0, i - 1 ) ], c = points[ Math.min( n - 1, i + 1 ) ];
		T.push( new THREE.Vector3().subVectors( c, a ).normalize() );

	}

	let prev = null;
	for ( let i = 0; i < n; i ++ ) {

		let hint;
		if ( o.axis ) hint = typeof o.axis === 'function' ? o.axis( i ) : o.axis;
		else hint = prev ?? perpendicular( T[ i ] );
		const nn = hint.clone().addScaledVector( T[ i ], - hint.dot( T[ i ] ) );
		if ( nn.lengthSq() < 1e-8 ) perpendicular( T[ i ], nn );
		nn.normalize();
		N.push( nn );
		B.push( new THREE.Vector3().crossVectors( T[ i ], nn ) );
		prev = nn;

	}

	const base = b.count;
	const tw = o.twist ?? 0;
	for ( let i = 0; i < n; i ++ ) {

		const r = radii[ i ];
		const i0 = Math.max( 0, i - 1 ), i1 = Math.min( n - 1, i + 1 );
		const slope = ( radii[ i0 ] - radii[ i1 ] ) / Math.max( 1e-5, s[ i1 ] - s[ i0 ] );
		const d = o.data ? o.data( i, s[ i ] / L ) : [ s[ i ] / L, 0, 0 ];
		for ( let j = 0; j < sides; j ++ ) {

			const a = ( j / sides ) * TAU + tw * i;
			const ca = Math.cos( a ), sa = Math.sin( a );
			_p.copy( points[ i ] ).addScaledVector( N[ i ], ca * r ).addScaledVector( B[ i ], sa * r * ellipse );
			_n.copy( N[ i ] ).multiplyScalar( ca * ellipse ).addScaledVector( B[ i ], sa ).normalize().addScaledVector( T[ i ], slope ).normalize();
			b.vertex( _p, _n, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

	}

	for ( let i = 0; i < n - 1; i ++ ) {

		for ( let j = 0; j < sides; j ++ ) {

			const a = base + i * sides + j, a1 = base + i * sides + ( j + 1 ) % sides;
			b.tri( a, a1, a + sides );
			b.tri( a1, a1 + sides, a + sides );

		}

	}

	if ( o.cap ) {

		const i = n - 1, r = radii[ i ];
		const d = o.data ? o.data( i, 1 ) : [ 1, 0, 0 ];
		const ring = base + i * sides;
		const mid = b.count;
		const capLength = o.capLength ?? 0.95;
		for ( let j = 0; j < sides; j ++ ) {

			const a = ( j / sides ) * TAU + tw * i;
			const ca = Math.cos( a ), sa = Math.sin( a );
			_p.copy( points[ i ] ).addScaledVector( T[ i ], r * capLength * 0.63 ).addScaledVector( N[ i ], ca * r * 0.75 ).addScaledVector( B[ i ], sa * r * 0.75 * ellipse );
			_n.copy( N[ i ] ).multiplyScalar( ca * ellipse ).addScaledVector( B[ i ], sa ).normalize().multiplyScalar( 0.7 ).addScaledVector( T[ i ], 0.72 ).normalize();
			b.vertex( _p, _n, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

		for ( let j = 0; j < sides; j ++ ) {

			const j1 = ( j + 1 ) % sides;
			b.tri( ring + j, ring + j1, mid + j );
			b.tri( ring + j1, mid + j1, mid + j );

		}

		_p.copy( points[ i ] ).addScaledVector( T[ i ], r * capLength );
		const tip = b.vertex( _p, T[ i ], d[ 0 ], 1, d[ 1 ], d[ 2 ] );
		for ( let j = 0; j < sides; j ++ ) b.tri( mid + j, mid + ( j + 1 ) % sides, tip );

	}

	return { T, N, B, length: L };

}

// Surface of revolution around +y. profile: [ { r, y, d } ] from the bottom of the outer
// wall up and over the rim down the inner wall (visible side to the right of the walk).
// radial( phi, i ) returns a radius multiplier; d = [ aData.x, aData.z, aData.w ].
export function lathe( b, profile, segments, radial = null, ox = 0, oz = 0 ) {

	const base = b.count;
	for ( let i = 0; i < profile.length; i ++ ) {

		const { r, y, d = [ 0, 0, 0 ] } = profile[ i ];
		for ( let j = 0; j < segments; j ++ ) {

			const phi = ( j / segments ) * TAU;
			const k = radial ? radial( phi, i ) : 1;
			_p.set( ox + r * k * Math.cos( phi ), y, oz - r * k * Math.sin( phi ) );
			b.vertex( _p, _up, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

		}

	}

	for ( let i = 0; i < profile.length - 1; i ++ ) {

		for ( let j = 0; j < segments; j ++ ) {

			const a = base + i * segments + j, a1 = base + i * segments + ( j + 1 ) % segments;
			b.tri( a, a1, a + segments );
			b.tri( a1, a1 + segments, a + segments );

		}

	}

}

// Indexed icosphere (unit radius) with outward winding.
const _ico = new Map();
export function icosphere( detail ) {

	if ( _ico.has( detail ) ) return _ico.get( detail );
	const t = ( 1 + Math.sqrt( 5 ) ) / 2;
	const verts = [
		[ - 1, t, 0 ], [ 1, t, 0 ], [ - 1, - t, 0 ], [ 1, - t, 0 ], [ 0, - 1, t ], [ 0, 1, t ],
		[ 0, - 1, - t ], [ 0, 1, - t ], [ t, 0, - 1 ], [ t, 0, 1 ], [ - t, 0, - 1 ], [ - t, 0, 1 ],
	].map( ( v ) => new THREE.Vector3( v[ 0 ], v[ 1 ], v[ 2 ] ).normalize() );
	let faces = [
		[ 0, 11, 5 ], [ 0, 5, 1 ], [ 0, 1, 7 ], [ 0, 7, 10 ], [ 0, 10, 11 ], [ 1, 5, 9 ], [ 5, 11, 4 ], [ 11, 10, 2 ], [ 10, 7, 6 ], [ 7, 1, 8 ],
		[ 3, 9, 4 ], [ 3, 4, 2 ], [ 3, 2, 6 ], [ 3, 6, 8 ], [ 3, 8, 9 ], [ 4, 9, 5 ], [ 2, 4, 11 ], [ 6, 2, 10 ], [ 8, 6, 7 ], [ 9, 8, 1 ],
	];
	for ( let d = 0; d < detail; d ++ ) {

		const cache = new Map();
		const mid = ( a, b ) => {

			const key = a < b ? a * 100000 + b : b * 100000 + a;
			let m = cache.get( key );
			if ( m === undefined ) {

				m = verts.length;
				verts.push( verts[ a ].clone().add( verts[ b ] ).normalize() );
				cache.set( key, m );

			}

			return m;

		};

		const next = [];
		for ( const [ a, b, c ] of faces ) {

			const ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
			next.push( [ a, ab, ca ], [ b, bc, ab ], [ c, ca, bc ], [ ab, bc, ca ] );

		}

		faces = next;

	}

	const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
	for ( const f of faces ) {

		e1.subVectors( verts[ f[ 1 ] ], verts[ f[ 0 ] ] );
		e2.subVectors( verts[ f[ 2 ] ], verts[ f[ 0 ] ] );
		fn.crossVectors( e1, e2 );
		if ( fn.dot( verts[ f[ 0 ] ] ) < 0 ) {

			const tmp = f[ 1 ];
			f[ 1 ] = f[ 2 ];
			f[ 2 ] = tmp;

		}

	}

	const r = { verts, faces };
	_ico.set( detail, r );
	return r;

}

// Deformed icosphere. fn( dir, out ) writes the position and returns [ d0, d2, d3 ].
export function blob( b, detail, fn ) {

	const { verts, faces } = icosphere( detail );
	const base = b.count;
	const out = new THREE.Vector3();
	for ( const v of verts ) {

		const d = fn( v, out ) ?? [ 0, 0, 0 ];
		b.vertex( out, v, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

	}

	for ( const f of faces ) b.tri( base + f[ 0 ], base + f[ 1 ], base + f[ 2 ] );

}

// Grid sheet over ( u, v ) in [0,1]^2: fn( u, v, out ) writes the position, returns [ d0, d2, d3 ].
export function sheet( b, nu, nv, fn, twoSided = true ) {

	const first = b.count, firstIndex = b.index.length;
	const out = new THREE.Vector3();
	for ( let j = 0; j <= nv; j ++ ) for ( let i = 0; i <= nu; i ++ ) {

		const d = fn( i / nu, j / nv, out ) ?? [ 0, 0, 0 ];
		b.vertex( out, _up, d[ 0 ], 1, d[ 1 ], d[ 2 ] );

	}

	for ( let j = 0; j < nv; j ++ ) for ( let i = 0; i < nu; i ++ ) {

		const a = first + j * ( nu + 1 ) + i;
		b.quad( a, a + 1, a + nu + 2, a + nu + 1 );

	}

	// flat-ish normals from the grid (the front side faces +cross( du, dv ))
	const P = b.position, N = b.normal;
	const at = ( i, j ) => first + clamp( j, 0, nv ) * ( nu + 1 ) + clamp( i, 0, nu );
	for ( let j = 0; j <= nv; j ++ ) for ( let i = 0; i <= nu; i ++ ) {

		const a = at( i - 1, j ), c = at( i + 1, j ), d = at( i, j - 1 ), e = at( i, j + 1 );
		_t.set( P[ c * 3 ] - P[ a * 3 ], P[ c * 3 + 1 ] - P[ a * 3 + 1 ], P[ c * 3 + 2 ] - P[ a * 3 + 2 ] );
		_p.set( P[ e * 3 ] - P[ d * 3 ], P[ e * 3 + 1 ] - P[ d * 3 + 1 ], P[ e * 3 + 2 ] - P[ d * 3 + 2 ] );
		_n.crossVectors( _t, _p ).normalize();
		const v = at( i, j );
		N[ v * 3 ] = _n.x;
		N[ v * 3 + 1 ] = _n.y;
		N[ v * 3 + 2 ] = _n.z;

	}

	if ( twoSided ) b.backfaces( first, firstIndex );

}

// Recomputes smooth normals of the vertices from `first` on, from the triangles from `firstIndex` on.
export function smoothNormals( b, first = 0, firstIndex = 0 ) {

	const P = b.position, N = b.normal, I = b.index;
	for ( let v = first; v < b.count; v ++ ) N[ v * 3 ] = N[ v * 3 + 1 ] = N[ v * 3 + 2 ] = 0;
	const a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
	for ( let i = firstIndex; i < I.length; i += 3 ) {

		const i0 = I[ i ], i1 = I[ i + 1 ], i2 = I[ i + 2 ];
		a.fromArray( P, i0 * 3 );
		c.fromArray( P, i1 * 3 ).sub( a );
		d.fromArray( P, i2 * 3 ).sub( a );
		c.cross( d );
		for ( const k of [ i0, i1, i2 ] ) {

			N[ k * 3 ] += c.x;
			N[ k * 3 + 1 ] += c.y;
			N[ k * 3 + 2 ] += c.z;

		}

	}

	for ( let v = first; v < b.count; v ++ ) {

		a.fromArray( N, v * 3 ).normalize();
		N[ v * 3 ] = a.x;
		N[ v * 3 + 1 ] = a.y;
		N[ v * 3 + 2 ] = a.z;

	}

}

// Breadth-first branching: specs are { p, dir, r, len, depth, ... }; grow( spec ) returns children.
export function branch( roots, budget, grow ) {

	const queue = roots.slice();
	let made = 0;
	while ( queue.length > 0 && made < budget ) {

		const spec = queue.shift();
		made ++;
		const children = grow( spec );
		if ( children ) for ( const c of children ) queue.push( c );

	}

}

// Points of a gently curving path from p along dir; bend( i, dir ) may modify dir per step.
export function path( p, dir, length, steps, bend ) {

	const pts = [ p.clone() ];
	const d = dir.clone().normalize();
	const step = length / steps;
	for ( let i = 1; i <= steps; i ++ ) {

		if ( bend ) bend( i, d );
		d.normalize();
		pts.push( pts[ i - 1 ].clone().addScaledVector( d, step ) );

	}

	return pts;

}

// ---------------------------------------------------------------------------
// Massive forms
// ---------------------------------------------------------------------------

const ICO = [ 3, 2, 1 ]; // icosphere subdivisions per level of detail

// Distance along the ray from the origin in direction d to the far side of the union of
// ellipsoidal lumps [ cx, cy, cz, ax, ay, az ] (the model is star-shaped around the origin).
function lumpRadius( d, lumps, fallback ) {

	let best = fallback;
	for ( let i = 0; i < lumps.length; i += 6 ) {

		const cx = lumps[ i ], cy = lumps[ i + 1 ], cz = lumps[ i + 2 ];
		const ax = lumps[ i + 3 ], ay = lumps[ i + 4 ], az = lumps[ i + 5 ];
		const dx = d.x / ax, dy = d.y / ay, dz = d.z / az;
		const ox = cx / ax, oy = cy / ay, oz = cz / az;
		const A = dx * dx + dy * dy + dz * dz;
		const B = - 2 * ( dx * ox + dy * oy + dz * oz );
		const C = ox * ox + oy * oy + oz * oz - 1;
		const disc = B * B - 4 * A * C;
		if ( disc < 0 ) continue;
		const t = ( - B + Math.sqrt( disc ) ) / ( 2 * A );
		if ( t > best ) best = t;

	}

	return best;

}

// Massive forms on the seabed, built as a union of ellipsoidal lumps (creases where lumps
// meet) with bumps on top. About 1 m wide at scale 1.
//  'rock':    dead coral head: a few big lumps, undercut, pitted (framework, bommie bases)
//  'slab':    low, broad, lumpy framework outcrop that carpets the reef platform
//  'boulder': living star coral mound: smooth big lobes, spreading margin
//  'knobby':  mustard hill coral: many small knobs
//  'smooth':  starlet coral: an almost smooth hemisphere
// aData = ( height 0..1, ao, 0, noise )
export function createMound( rng, lod, style = 'boulder' ) {

	const S = {
		rock: { n: [ 4, 7 ], spread: 0.24, size: [ 0.18, 0.32 ], flat: [ 0.55, 0.85 ], lift: 0.12, bumps: 0.1, bumpF: [ 5, 11 ], fine: 0.04, undercut: 0.35, ridged: true },
		slab: { n: [ 10, 16 ], spread: 0.4, size: [ 0.12, 0.22 ], flat: [ 0.3, 0.55 ], lift: 0.02, bumps: 0.06, bumpF: [ 5, 11 ], fine: 0.03, undercut: 0.1, ico: [ 4, 3, 2, 1 ] },
		boulder: { n: [ 3, 6 ], spread: 0.18, size: [ 0.24, 0.38 ], flat: [ 0.6, 0.9 ], lift: 0.08, bumps: 0.06, bumpF: [ 3, 7 ], fine: 0.012, undercut: 0.25 },
		knobby: { n: [ 7, 12 ], spread: 0.26, size: [ 0.12, 0.2 ], flat: [ 0.8, 1.0 ], lift: 0.1, bumps: 0.03, bumpF: [ 8, 14 ], fine: 0.01, undercut: 0.1 },
		smooth: { n: [ 1, 2 ], spread: 0.05, size: [ 0.45, 0.5 ], flat: [ 0.7, 0.95 ], lift: 0.04, bumps: 0.02, bumpF: [ 3, 5 ], fine: 0.004, undercut: 0.05 },
	}[ style ];
	const lumps = [];
	const n = S.n[ 0 ] + Math.floor( rng() * ( S.n[ 1 ] - S.n[ 0 ] + 1 ) );
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * S.spread * ( i === 0 ? 0.3 : 1 );
		const size = rand( rng, S.size[ 0 ], S.size[ 1 ] ) * ( i === 0 ? 1.15 : 1 );
		const fl = rand( rng, S.flat[ 0 ], S.flat[ 1 ] );
		lumps.push( Math.cos( a ) * r, S.lift + rand( rng, - 0.05, 0.06 ), Math.sin( a ) * r, size * rand( rng, 0.85, 1.2 ), size * fl * 1.6, size * rand( rng, 0.85, 1.2 ) );

	}

	const bump = waveNoise( rng, 7, S.bumpF[ 0 ], S.bumpF[ 1 ] );
	const fine = waveNoise( rng, 8, 14, 26 );
	const tmp = new THREE.Vector3();
	const b = new MeshBuilder();
	let H = 0;
	blob( b, ( S.ico ?? ICO )[ lod ], ( d, out ) => {

		// the lower hemisphere maps onto the buried base (squashed below the ground)
		tmp.set( d.x, d.y >= 0 ? d.y : d.y * 0.3, d.z ).normalize();
		let r = lumpRadius( tmp, lumps, 0.12 );
		const bv = bump( d.x, d.y, d.z );
		// ridged: sharp crevices between rounded knobs (eroded framework)
		r *= 1 + S.bumps * ( S.ridged ? 0.6 - 1.6 * bv * bv : bv ) + ( lod === 0 ? S.fine * fine( d.x, d.y, d.z ) : 0 );
		out.copy( tmp ).multiplyScalar( r );
		// undercut: the base is narrower than the bulging sides
		const nearBase = 1 - smooth( 0.0, 0.14, out.y );
		out.x *= 1 - S.undercut * nearBase * 0.5;
		out.z *= 1 - S.undercut * nearBase * 0.5;
		if ( d.y < 0 ) out.y = Math.max( out.y, - 0.05 );
		H = Math.max( H, out.y );
		return [ 0, 0, bump( d.x * 0.5, d.y * 0.5, d.z * 0.5 ) * 0.5 + 0.5 ];

	} );
	for ( let v = 0; v < b.count; v ++ ) b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ] / H, 0, 1 );
	smoothNormals( b );
	return b.build( { ao: { radius: 0.16, strength: 0.55 } } );

}

// Lobed / columnar star coral (Orbicella annularis): a clump of columns with swollen,
// rounded tops, fused near the base. About 0.9 m wide, 0.5 m tall at scale 1.
// aData = ( height 0..1, ao, 0, lobe random )
export function createLobes( rng, lod ) {

	if ( lod === 2 ) return createMound( rng, 2, 'knobby' );
	const b = new MeshBuilder();
	const segs = lod === 0 ? 11 : 6;
	const n = 5 + Math.floor( rng() * 5 );
	const cols = [];
	for ( let i = 0; i < n * 8 && cols.length < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.36;
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const rad = rand( rng, 0.07, 0.12 );
		if ( cols.some( ( c ) => Math.hypot( c.x - x, c.z - z ) < ( c.rad + rad ) * 0.8 ) ) continue;
		cols.push( { x, z, rad, h: rand( rng, 0.18, 0.3 ) + 0.28 * ( 1 - r / 0.36 ), w: rng() } );

	}

	const H = Math.max( ...cols.map( ( c ) => c.h + c.rad ) );
	for ( const c of cols ) {

		const lean = 0.25 / Math.max( 0.1, Math.hypot( c.x, c.z ) + 0.1 );
		const lx = c.x * lean * 0.3, lz = c.z * lean * 0.3;
		const prof = [];
		const rings = lod === 0 ? 5 : 3;
		for ( let i = 0; i <= rings; i ++ ) {

			const t = i / rings;
			prof.push( { r: c.rad * ( 1.25 - 0.25 * smooth( 0, 0.4, t ) + 0.12 * smooth( 0.6, 0.95, t ) ), y: - 0.03 + t * c.h } );

		}

		const capRings = lod === 0 ? 3 : 2;
		for ( let i = 1; i <= capRings; i ++ ) {

			const a = ( i / capRings ) * Math.PI * 0.5;
			prof.push( { r: c.rad * 1.12 * Math.cos( a ) + 0.001, y: c.h + c.rad * 0.9 * Math.sin( a ) } );

		}

		const first = b.count, firstIndex = b.index.length;
		const bumpy = waveNoise( rng, 4, 8, 16 );
		lathe( b, prof.map( ( p ) => ( { ...p, d: [ 0, 0, c.w ] } ) ), segs, ( phi, i ) => 1 + 0.06 * bumpy( Math.cos( phi ), i * 0.3, Math.sin( phi ) ), c.x, c.z );
		for ( let v = first; v < b.count; v ++ ) {

			const y = b.position[ v * 3 + 1 ];
			const k = clamp( y / c.h, 0, 1.2 );
			b.position[ v * 3 ] += lx * k * 0.3;
			b.position[ v * 3 + 2 ] += lz * k * 0.3;
			b.data[ v * 4 ] = clamp( y / H, 0, 1 );

		}

		smoothNormals( b, first, firstIndex );

	}

	// fused base
	const first = b.count, firstIndex = b.index.length;
	const bn = waveNoise( rng, 4, 2, 4 );
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		const r = 0.44 * ( 1 + 0.12 * bn( d.x, d.y, d.z ) );
		out.set( d.x * r, Math.max( d.y >= 0 ? d.y * 0.16 : d.y * 0.02, - 0.03 ), d.z * r );
		return [ out.y / H, 0, 0 ];

	} );
	smoothNormals( b, first, firstIndex );
	return b.build( { ao: { radius: 0.14, strength: 1.3 } } );

}

// Brain coral: a hemispherical to flattened dome with a slightly flared living margin
// (the meanders are procedural). About 1 m wide at scale 1. aData = ( height, ao, 0, 0 )
export function createDome( rng, lod ) {

	const b = new MeshBuilder();
	const segs = [ 30, 12, 7 ][ lod ], rings = [ 10, 5, 2 ][ lod ];
	const H = rand( rng, 0.42, 0.58 );
	const n = waveNoise( rng, 5, 1.5, 3.5 );
	const prof = [ { r: 0.5, y: - 0.03 }, { r: 0.515, y: 0.0 } ];
	for ( let i = 1; i <= rings; i ++ ) {

		const a = ( i / rings ) * Math.PI * 0.5;
		// superellipse profile: a fuller shoulder than a sphere
		const c = Math.pow( Math.cos( a ), 0.8 ), s = Math.pow( Math.sin( a ), 1.15 );
		prof.push( { r: 0.5 * c + 1e-3, y: H * s } );

	}

	const first = b.count;
	lathe( b, prof, segs, ( phi ) => 1 + 0.05 * n( Math.cos( phi ), 0, Math.sin( phi ) ) );
	for ( let v = first; v < b.count; v ++ ) {

		const x = b.position[ v * 3 ], y = b.position[ v * 3 + 1 ], z = b.position[ v * 3 + 2 ];
		b.position[ v * 3 + 1 ] = y * ( 1 + 0.08 * n( x * 2, 0.5, z * 2 ) );
		b.data[ v * 4 ] = clamp( y / H, 0, 1 );

	}

	smoothNormals( b );
	return b.build( { ao: { radius: 0.1, strength: 0.6 } } );

}

// Pillar coral (Dendrogyra cylindrus): upright cylinders with rounded tops from a common
// encrusting base. About 0.5 m wide, 1 m tall at scale 1. aData = ( height, ao, 0, pillar random )
export function createPillars( rng, lod ) {

	const b = new MeshBuilder();
	const segs = [ 12, 7, 5 ][ lod ];
	const n = 3 + Math.floor( rng() * 4 );
	for ( let k = 0; k < n; k ++ ) {

		const a = ( k / n ) * TAU + rng() * 0.8, r = k === 0 ? 0 : rand( rng, 0.1, 0.22 );
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const rad = rand( rng, 0.05, 0.085 ), h = k === 0 ? rand( rng, 0.75, 1.0 ) : rand( rng, 0.3, 0.8 );
		const prof = [];
		const rings = [ 8, 4, 2 ][ lod ];
		for ( let i = 0; i <= rings; i ++ ) {

			const t = i / rings;
			prof.push( { r: rad * ( 1.3 - 0.3 * smooth( 0, 0.2, t ) + 0.05 * Math.sin( t * 9 + k ) ), y: - 0.02 + t * h, d: [ 0, 0, k / n ] } );

		}

		for ( let i = 1; i <= ( lod === 2 ? 1 : 3 ); i ++ ) {

			const q = ( i / ( lod === 2 ? 1 : 3 ) ) * Math.PI * 0.5;
			prof.push( { r: rad * Math.cos( q ) + 1e-3, y: h + rad * 0.8 * Math.sin( q ), d: [ 0, 0, k / n ] } );

		}

		const first = b.count, fi = b.index.length;
		lathe( b, prof, segs, null, x, z );
		for ( let v = first; v < b.count; v ++ ) b.data[ v * 4 ] = clamp( b.position[ v * 3 + 1 ], 0, 1 );
		smoothNormals( b, first, fi );

	}

	return b.build( { ao: { radius: 0.12, strength: 1 } } );

}

// ---------------------------------------------------------------------------
// Branching and plating corals
// ---------------------------------------------------------------------------

// Elkhorn coral (Acropora palmata): a stout trunk dividing into thick branches that rise and
// spread outward, flattening into broad antler-like blades with rounded, palmate tips; clear
// gaps between the branches. About 1.2 m wide, 0.6 m tall at scale 1.
// aData = ( t along the colony 0..1, ao, growing margin flag, branch random )
export function createElkhorn( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 8, 5, 4 ][ lod ];
	const rings = [ 4, 2, 1 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 );
	const trunkTop = new THREE.Vector3( rand( rng, - 0.03, 0.03 ), rand( rng, 0.12, 0.18 ), rand( rng, - 0.03, 0.03 ) );
	tube( b, [ new THREE.Vector3( 0, - 0.03, 0 ), new THREE.Vector3( 0, 0.06, 0 ), trunkTop ], [ 0.11, 0.08, 0.065 ], { sides, ellipse: 0.8, data: ( i, t ) => [ t * 0.15, 0, 0 ] } );
	const roots = [];
	const n = 3 + Math.floor( rng() * 2 );
	const a0 = rng() * TAU;
	for ( let i = 0; i < n; i ++ ) {

		const az = a0 + ( i / n ) * TAU + rand( rng, - 0.3, 0.3 );
		const el = rand( rng, 0.35, 0.75 );
		const dir = new THREE.Vector3( Math.cos( az ) * Math.cos( el ), Math.sin( el ), Math.sin( az ) * Math.cos( el ) );
		roots.push( { p: trunkTop.clone().addScaledVector( dir, - 0.02 ), dir, w: 0.055, len: rand( rng, 0.2, 0.3 ), depth: 0, t0: 0.15 } );

	}

	const maxDepth = lod === 2 ? 1 : 2;
	branch( roots, 40, ( s ) => {

		// blade plane: contains the growth direction and the horizontal side vector
		const side = new THREE.Vector3().crossVectors( s.dir, up );
		if ( side.lengthSq() < 1e-4 ) side.set( 1, 0, 0 );
		side.normalize();
		const pts = path( s.p, s.dir, s.len, rings, ( i, d ) => {

			d.y -= 0.03; // branches level out as they grow
			d.addScaledVector( side, ( rng() - 0.5 ) * 0.12 );

		} );
		const last = s.depth >= maxDepth;
		const wEnd = s.w * ( last ? 1.6 : 1.35 ); // palmate: broadening toward the tips
		const radii = pts.map( ( p, i ) => s.w + ( wEnd - s.w ) * ( i / rings ) );
		const flat = clamp( 0.55 - s.depth * 0.12, 0.3, 0.55 );
		const t1 = Math.min( 1, s.t0 + s.len / 0.75 );
		const w = rng();
		tube( b, pts, radii, {
			sides, ellipse: flat, cap: last, capLength: 0.4, axis: side,
			data: ( i, t ) => [ s.t0 + ( t1 - s.t0 ) * t, last && t > 0.9 ? 1 : 0, w ],
		} );
		if ( last ) return null;
		const end = pts[ pts.length - 1 ];
		const dir = end.clone().sub( pts[ pts.length - 2 ] ).normalize();
		const out = [];
		const k = rng() < 0.3 ? 3 : 2;
		const fan = rand( rng, 0.9, 1.4 );
		for ( let c = 0; c < k; c ++ ) {

			const spread = ( ( c / ( k - 1 ) ) - 0.5 ) * fan;
			const d = dir.clone().applyAxisAngle( up, spread ).addScaledVector( up, rand( rng, 0.0, 0.25 ) ).normalize();
			out.push( { p: end.clone().addScaledVector( dir, - s.w * 0.4 ), dir: d, w: wEnd * rand( rng, 0.62, 0.75 ), len: s.len * rand( rng, 0.75, 1.05 ), depth: s.depth + 1, t0: t1 } );

		}

		return out;

	} );

	smoothNormals( b );
	return b.build( { ao: { radius: 0.18, strength: 1.1 } } );

}

// Staghorn coral (Acropora cervicornis): upright antler-like cylindrical branches that
// fork repeatedly with pale growing tips. About 1 m wide, 0.6 m tall at scale 1.
// aData = ( t along the colony, ao, tip flag, branch random )
export function createStaghorn( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 5, 4, 3 ][ lod ];
	const rings = [ 3, 2, 1 ][ lod ];
	const thick = [ 1, 1.15, 1.9 ][ lod ];
	const budget = [ 56, 30, 14 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 );
	const roots = [];
	const n = 4 + Math.floor( rng() * 3 );
	for ( let i = 0; i < n; i ++ ) {

		const az = ( i / n ) * TAU + rng() * 0.9;
		const el = rand( rng, 0.55, 1.2 );
		const dir = new THREE.Vector3( Math.cos( az ) * Math.cos( el ), Math.sin( el ), Math.sin( az ) * Math.cos( el ) );
		const off = rand( rng, 0, 0.12 );
		roots.push( { p: new THREE.Vector3( Math.cos( az ) * off, - 0.02, Math.sin( az ) * off ), dir, r: 0.016, len: rand( rng, 0.18, 0.3 ), depth: 0, t0: 0 } );

	}

	branch( roots, budget, ( s ) => {

		const pts = path( s.p, s.dir, s.len, rings, ( i, d ) => {

			d.y += 0.12; // grows toward the light
			d.x += ( rng() - 0.5 ) * 0.25;
			d.z += ( rng() - 0.5 ) * 0.25;

		} );
		const last = s.depth >= 3 || s.len < 0.07;
		const rEnd = Math.max( 0.0075, s.r * 0.78 );
		const radii = pts.map( ( p, i ) => ( s.r + ( rEnd - s.r ) * ( i / rings ) ) * thick );
		const t1 = Math.min( 1, s.t0 + s.len / 0.55 );
		tube( b, pts, radii, { sides, cap: last, data: ( i, t ) => [ s.t0 + ( t1 - s.t0 ) * t, last && t > 0.8 ? 1 : 0, rng() ] } );
		if ( last ) return null;
		// lateral branches along the axis plus the continuing leader
		const out = [];
		const dir = pts[ pts.length - 1 ].clone().sub( pts[ pts.length - 2 ] ).normalize();
		out.push( { p: pts[ pts.length - 1 ].clone(), dir, r: rEnd, len: s.len * rand( rng, 0.7, 0.95 ), depth: s.depth + 1, t0: t1 } );
		const laterals = s.depth < 2 ? 2 : 1;
		for ( let c = 0; c < laterals; c ++ ) {

			const f = rand( rng, 0.35, 0.85 );
			const i = Math.min( rings - 1, Math.floor( f * rings ) );
			const p = pts[ i ].clone().lerp( pts[ i + 1 ], f * rings - i );
			const side = perpendicular( dir ).applyAxisAngle( dir, rng() * TAU );
			const d = dir.clone().multiplyScalar( 0.6 ).addScaledVector( side, 0.8 ).addScaledVector( up, 0.25 ).normalize();
			out.push( { p, dir: d, r: s.r * 0.8, len: s.len * rand( rng, 0.5, 0.8 ), depth: s.depth + 1, t0: s.t0 + ( t1 - s.t0 ) * f } );

		}

		return out;

	} );

	return b.build( { ao: { radius: 0.12, strength: 1.4 } } );

}

// Finger coral (Porites porites): a clump of stubby fingers with blunt, swollen tips.
// About 0.4 m wide at scale 1. aData = ( t, ao, tip flag, finger random )
export function createFingers( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 6, 4, 3 ][ lod ];
	const rings = [ 3, 1, 1 ][ lod ];
	const n = [ 28, 14, 7 ][ lod ];
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.15;
		const el = 1.45 - ( r / 0.15 ) * 0.55 + rand( rng, - 0.15, 0.15 );
		const dir = new THREE.Vector3( Math.cos( a ) * Math.cos( el ), Math.sin( el ), Math.sin( a ) * Math.cos( el ) );
		const p = new THREE.Vector3( Math.cos( a ) * r, - 0.01, Math.sin( a ) * r );
		const len = rand( rng, 0.08, 0.17 ) * ( 1.15 - r * 2.5 );
		const pts = path( p, dir, len, rings, ( k, d ) => {

			d.x += ( rng() - 0.5 ) * 0.25;
			d.z += ( rng() - 0.5 ) * 0.25;
			d.y += 0.05;

		} );
		const rad = rand( rng, 0.012, 0.018 ) * ( lod === 2 ? 1.4 : 1 );
		const w = rng();
		tube( b, pts, pts.map( ( q, k ) => rad * ( 1 + 0.3 * ( k / rings ) ) ), { sides, cap: true, data: ( k, t ) => [ t, t > 0.75 ? 1 : 0, w ] } );

	}

	return b.build( { ao: { radius: 0.06, strength: 1.2 } } );

}

// Blade fire coral (Millepora complanata): thin upright blades with lobed upper edges,
// joined in honeycomb-like rows. About 0.4 m wide at scale 1. aData = ( height, ao, edge, blade random )
export function createBlades( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 9, 6, 4 ][ lod ];
	const nu = [ 6, 4, 2 ][ lod ], nv = [ 3, 1, 1 ][ lod ];
	for ( let k = 0; k < n; k ++ ) {

		const cx = rand( rng, - 0.16, 0.16 ), cz = rand( rng, - 0.16, 0.16 );
		const yaw = ( Math.floor( rng() * 3 ) / 3 ) * Math.PI + rand( rng, - 0.2, 0.2 );
		const w = rand( rng, 0.1, 0.18 ), h = rand( rng, 0.08, 0.2 ), th = 0.011;
		const lobe = waveNoise( rng, 3, 10, 25 );
		const wave = waveNoise( rng, 2, 15, 30 );
		const bend = rand( rng, - 0.03, 0.03 );
		const ca = Math.cos( yaw ), sa = Math.sin( yaw );
		const r = rng();
		const at = ( u, v, s, out ) => {

			const x = ( u - 0.5 ) * w;
			// rounded, lobed top edge; the blade undulates and thins toward the top
			const e = Math.abs( u - 0.5 ) * 2;
			const top = h * ( 0.85 + 0.15 * lobe( x, 0, 0 ) ) * ( 0.4 + 0.6 * Math.sqrt( Math.max( 0, 1 - Math.pow( e, 3 ) ) ) );
			const y = v * top;
			const zz = s * th * ( 1 - 0.6 * v ) * ( 1 - 0.5 * e * e ) + bend * e * e + 0.012 * wave( x * 3, y * 3, 0 ) * v;
			out.set( cx + x * ca - zz * sa, y - 0.01, cz + x * sa + zz * ca );
			return [ v, v > 0.8 ? 1 : 0, r ];

		};

		const first = b.count, fi = b.index.length;
		sheet( b, nu, nv, ( u, v, out ) => at( u, v, 1, out ), false );
		sheet( b, nu, nv, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
		// top rim between the faces
		const rim = [];
		for ( let i = 0; i <= nu; i ++ ) {

			const u = i / nu;
			const pa = new THREE.Vector3(), pb = new THREE.Vector3();
			at( u, 1, 1, pa );
			at( u, 1, - 1, pb );
			rim.push( b.vertex( pa, _up, 1, 1, 1, r ), b.vertex( pb, _up, 1, 1, 1, r ) );

		}

		for ( let i = 0; i < nu; i ++ ) b.quad( rim[ i * 2 ], rim[ i * 2 + 2 ], rim[ i * 2 + 3 ], rim[ i * 2 + 1 ] );
		smoothNormals( b, first, fi );

	}

	return b.build( { ao: { radius: 0.05, strength: 0.6 } } );

}

// Plate coral (Agaricia lamarcki / Orbicella franksi plates): thin, gently undulating
// shelves in tiers, growing out from a small base. About 0.7 m wide at scale 1.
// aData = ( radial 0..1, ao, top (1) / underside (0), plate random )
export function createPlates( rng, lod ) {

	const b = new MeshBuilder();
	const nr = [ 4, 2, 1 ][ lod ], na = [ 12, 8, 4 ][ lod ];
	const n = 2 + Math.floor( rng() * 2 );
	const az0 = rng() * TAU;
	const levels = [ 0.05 ];
	for ( let k = 1; k < n; k ++ ) levels.push( levels[ k - 1 ] + rand( rng, 0.09, 0.13 ) );
	// the column the tiers grow from
	const colTop = levels[ n - 1 ] + 0.01;
	lathe( b, [ { r: 0.07, y: - 0.02, d: [ 0, 0, 0 ] }, { r: 0.05, y: colTop * 0.5, d: [ 0.2, 0, 0 ] }, { r: 0.04, y: colTop, d: [ 0.3, 0, 0 ] }, { r: 0.002, y: colTop + 0.015, d: [ 0.3, 0, 0 ] } ], lod === 0 ? 8 : 5 );
	for ( let k = 0; k < n; k ++ ) {

		const R = rand( rng, 0.26, 0.38 ) * ( 1 - k * 0.18 );
		const y0 = levels[ k ];
		const az = az0 + rand( rng, - 0.5, 0.5 ) + k * 0.4, span = rand( rng, 2.0, 3.2 );
		const tilt = rand( rng, 0.05, 0.2 );
		const wave = waveNoise( rng, 3, 2, 4 );
		const r0 = rng();
		const at = ( u, v, sgn, out ) => {

			// u: around the shelf, v: radial; sgn: top (+1) / underside (-1)
			const a = az + ( u - 0.5 ) * span;
			const edge = 1 - 0.35 * Math.pow( Math.abs( u - 0.5 ) * 2, 2 );
			const r = 0.03 + v * R * edge * ( 1 + 0.08 * wave( Math.cos( a ), 0, Math.sin( a ) ) );
			const y = y0 + v * R * tilt - 0.06 * v * v * R + 0.012 * v * wave( Math.cos( a ) * 2, 1, Math.sin( a ) * 2 ) + sgn * 0.006 * ( 1 - v * 0.5 );
			out.set( Math.cos( a ) * r, y, Math.sin( a ) * r );
			return [ v, sgn > 0 ? 1 : 0, r0 ];

		};

		const first = b.count, fi = b.index.length;
		sheet( b, na, nr, ( u, v, out ) => at( u, v, 1, out ), false );
		sheet( b, na, nr, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
		const rim = [];
		for ( let i = 0; i <= na; i ++ ) {

			const pa = new THREE.Vector3(), pb = new THREE.Vector3();
			at( i / na, 1, 1, pa );
			at( i / na, 1, - 1, pb );
			rim.push( b.vertex( pa, _up, 1, 1, 1, r0 ), b.vertex( pb, _up, 1, 1, 1, r0 ) );

		}

		for ( let i = 0; i < na; i ++ ) b.quad( rim[ i * 2 ], rim[ i * 2 + 2 ], rim[ i * 2 + 3 ], rim[ i * 2 + 1 ] );
		smoothNormals( b, first, fi );

	}

	// encrusting base
	const first = b.count, fi = b.index.length;
	blob( b, [ 2, 1, 0 ][ lod ], ( d, out ) => {

		out.set( d.x * 0.1, Math.max( d.y >= 0 ? d.y * 0.12 : d.y * 0.02, - 0.02 ), d.z * 0.1 );
		return [ 0, 0, 0 ];

	} );
	smoothNormals( b, first, fi );
	return b.build( { ao: { radius: 0.1, strength: 1.1 } } );

}

// ---------------------------------------------------------------------------
// Gorgonians (octocorals): flexible, they sway with the surge in the vertex shader
// ---------------------------------------------------------------------------

// Sea rod (Plexaura / Eunicea): a candelabra of thick, fuzzy branches forking upward
// from a short stem. About 0.8 m tall at scale 1. aData = ( height 0..1, ao, 0, branch random )
export function createSeaRod( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 5, 4, 3 ][ lod ];
	const rings = [ 3, 2, 1 ][ lod ];
	const thick = [ 1, 1.2, 2 ][ lod ];
	const H = 0.85;
	const up = new THREE.Vector3( 0, 1, 0 );
	const plane = rand( rng, 0, TAU ); // colonies branch roughly in one plane (facing the surge)
	const pn = new THREE.Vector3( Math.cos( plane ), 0, Math.sin( plane ) );
	branch( [ { p: new THREE.Vector3( 0, - 0.02, 0 ), dir: new THREE.Vector3( rand( rng, - 0.1, 0.1 ), 1, rand( rng, - 0.1, 0.1 ) ), r: 0.02, len: rand( rng, 0.1, 0.16 ), depth: 0 } ], [ 36, 20, 10 ][ lod ], ( s ) => {

		const pts = path( s.p, s.dir, s.len, rings, ( i, d ) => {

			d.y += 0.08;
			d.addScaledVector( pn, ( rng() - 0.5 ) * 0.2 );

		} );
		const last = s.depth >= 5 || pts[ pts.length - 1 ].y > H * 0.92;
		const rEnd = s.r * 0.9;
		const w = rng();
		tube( b, pts, pts.map( ( p, i ) => ( s.r + ( rEnd - s.r ) * i / rings ) * thick ), { sides, cap: last, data: ( i, t ) => [ clamp( pts[ i ].y / H, 0, 1 ), 0, w ] } );
		if ( last ) return null;
		const end = pts[ pts.length - 1 ];
		const dir = end.clone().sub( pts[ pts.length - 2 ] ).normalize();
		const out = [];
		for ( const sgn of [ - 1, 1 ] ) {

			const a = sgn * rand( rng, 0.3, 0.6 );
			const axis = new THREE.Vector3().crossVectors( dir, pn ).normalize();
			if ( axis.lengthSq() < 0.1 ) axis.set( 1, 0, 0 );
			const d = dir.clone().applyAxisAngle( axis, a ).applyAxisAngle( dir, rand( rng, - 0.5, 0.5 ) ).addScaledVector( up, 0.3 ).normalize();
			out.push( { p: end.clone(), dir: d, r: Math.max( 0.011, rEnd * 0.92 ), len: rand( rng, 0.09, 0.19 ), depth: s.depth + 1 } );

		}

		return out;

	} );
	return b.build( { ao: { radius: 0.08, strength: 1 } } );

}

// Sea whips / slit-pore sea rods: a few long, thin, unbranched or once-forked whips.
// About 1 m tall at scale 1. aData = ( height 0..1, ao, 0, whip random )
export function createWhips( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 6, 4, 3 ][ lod ];
	const rings = [ 10, 5, 3 ][ lod ];
	const n = 3 + Math.floor( rng() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, lean = rand( rng, 0.05, 0.4 );
		const dir = new THREE.Vector3( Math.cos( a ) * lean, 1, Math.sin( a ) * lean );
		const curl = rand( rng, - 0.06, 0.06 );
		const pts = path( new THREE.Vector3( 0, - 0.02, 0 ), dir, rand( rng, 0.6, 1.1 ), rings, ( k, d ) => {

			d.x += curl;
			d.y += 0.02;

		} );
		const r = rand( rng, 0.006, 0.009 ) * ( lod === 2 ? 1.8 : 1 );
		const w = rng();
		tube( b, pts, pts.map( ( p, k ) => r * ( 1 - 0.4 * k / rings ) ), { sides, cap: true, data: ( k, t ) => [ clamp( pts[ k ].y, 0, 1 ), 0, w ] } );

	}

	return b.build();

}

// ---------------------------------------------------------------------------
// Sponges. aData = ( height 0..1, ao, inner wall flag, tube random )
// ---------------------------------------------------------------------------

// Giant barrel sponge (Xestospongia muta): a bulging vase with knobby vertical ridges and
// a deep central cavity. About 0.7 m wide, 0.8 m tall at scale 1.
export function createBarrel( rng, lod ) {

	const b = new MeshBuilder();
	const segs = [ 48, 24, 12 ][ lod ];
	const ridges = 9 + Math.floor( rng() * 6 );
	const ph = rng() * TAU;
	const knob = waveNoise( rng, 5, 8, 16 );
	const H = rand( rng, 0.65, 0.9 );
	const rim = rand( rng, 0.28, 0.34 );
	const outer = [ [ 0.16, - 0.02 ], [ 0.24, 0.1 ], [ 0.33, 0.3 ], [ 0.35, 0.5 ], [ rim + 0.01, 0.75 ], [ rim, 1 ] ];
	const prof = [];
	const step = lod === 2 ? 2 : 1;
	for ( let i = 0; i < outer.length; i += step ) prof.push( { r: outer[ i ][ 0 ], y: outer[ i ][ 1 ] * H, d: [ outer[ i ][ 1 ], 0, 0 ] } );
	if ( lod === 2 ) prof.push( { r: rim, y: H, d: [ 1, 0, 0 ] } );
	// rim, then down the inner wall into the cavity
	prof.push( { r: rim - 0.035, y: H - 0.01, d: [ 1, 1, 0 ] } );
	prof.push( { r: rim - 0.06, y: H * 0.7, d: [ 0.7, 1, 0 ] } );
	if ( lod < 2 ) prof.push( { r: rim - 0.1, y: H * 0.35, d: [ 0.35, 1, 0 ] } );
	prof.push( { r: 0.02, y: H * 0.18, d: [ 0.2, 1, 0 ] } );
	const nOuter = prof.findIndex( ( p ) => p.d[ 1 ] === 1 );
	lathe( b, prof, segs, ( phi, i ) => {

		if ( i >= nOuter ) return 1;
		const t = prof[ i ].y / H;
		const rid = Math.pow( Math.abs( Math.cos( ( phi * ridges ) / 2 + ph ) ), 2.5 );
		return 1 + ( 0.1 * rid - 0.04 ) * smooth( 0.05, 0.3, t ) + 0.04 * knob( Math.cos( phi ), t * 2, Math.sin( phi ) );

	} );
	smoothNormals( b );
	return b.build( { ao: { radius: 0.2, strength: 1.2 } } );

}

// Tube sponges (Aplysina, Callyspongia): a cluster of open-ended tubes; `vase` makes fewer,
// wider, flaring vases. About 0.35 m tall at scale 1.
export function createTubes( rng, lod, vase = false ) {

	const b = new MeshBuilder();
	const segs = [ 12, 6, 4 ][ lod ];
	const n = vase ? 1 + Math.floor( rng() * 3 ) : 2 + Math.floor( rng() * 5 );
	for ( let k = 0; k < n; k ++ ) {

		const a = rng() * TAU, off = k === 0 ? 0 : rand( rng, 0.03, 0.09 );
		const ox = Math.cos( a ) * off, oz = Math.sin( a ) * off;
		const h = vase ? rand( rng, 0.25, 0.4 ) : rand( rng, 0.15, 0.42 );
		const r = vase ? rand( rng, 0.05, 0.08 ) : rand( rng, 0.022, 0.04 );
		const flare = vase ? rand( rng, 1.8, 2.6 ) : rand( rng, 1.0, 1.25 );
		const lean = rand( rng, 0.05, 0.25 ), la = Math.atan2( oz, ox ) + rand( rng, - 0.4, 0.4 );
		const w = rng();
		const rings = [ 4, 2, 1 ][ lod ];
		const prof = [];
		for ( let i = 0; i <= rings; i ++ ) {

			const t = i / rings;
			prof.push( { r: r * ( 0.8 + ( flare - 0.8 ) * Math.pow( t, vase ? 1.6 : 1 ) ), y: - 0.02 + t * h, d: [ t, 0, w ] } );

		}

		const top = prof[ prof.length - 1 ];
		const wall = vase ? 0.006 : r * 0.28;
		if ( lod < 2 ) {

			prof.push( { r: top.r - wall, y: top.y - 0.004, d: [ 1, 1, w ] } );
			prof.push( { r: ( top.r - wall ) * 0.85, y: top.y - h * 0.3, d: [ 0.7, 1, w ] } );
			prof.push( { r: 0.004, y: top.y - h * 0.6, d: [ 0.4, 1, w ] } );

		} else {

			// far away: the opening is just a dark disc
			prof.push( { r: 0.002, y: top.y - h * 0.15, d: [ 1, 1, w ] } );

		}
		const first = b.count, fi = b.index.length;
		const bumpy = waveNoise( rng, 3, 10, 20 );
		lathe( b, prof, segs, ( phi, i ) => 1 + 0.05 * bumpy( Math.cos( phi ), i * 0.4, Math.sin( phi ) ), 0, 0 );
		for ( let v = first; v < b.count; v ++ ) {

			const y = Math.max( 0, b.position[ v * 3 + 1 ] );
			b.position[ v * 3 ] += ox + Math.cos( la ) * lean * y;
			b.position[ v * 3 + 2 ] += oz + Math.sin( la ) * lean * y;

		}

		smoothNormals( b, first, fi );

	}

	return b.build( { ao: { radius: 0.08, strength: 1.2 } } );

}

// Rope sponges (Aplysina cauliformis): long rope-like branches arching over the reef.
// About 0.6 m across at scale 1. aData = ( t, ao, 0, rope random )
export function createRopes( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 6, 4, 3 ][ lod ];
	const rings = [ 8, 4, 2 ][ lod ];
	const n = 2 + Math.floor( rng() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU;
		const dir = new THREE.Vector3( Math.cos( a ), rand( rng, 0.6, 1.4 ), Math.sin( a ) );
		const pts = path( new THREE.Vector3( 0, - 0.01, 0 ), dir, rand( rng, 0.3, 0.6 ), rings, ( k, d ) => {

			d.y -= 0.18; // arches over and down
			d.x += ( rng() - 0.5 ) * 0.3;
			d.z += ( rng() - 0.5 ) * 0.3;

		} );
		for ( const p of pts ) p.y = Math.max( p.y, 0.01 );
		const r = rand( rng, 0.014, 0.022 );
		const w = rng();
		tube( b, pts, pts.map( () => r ), { sides, cap: true, data: ( k, t ) => [ t, 0, w ] } );

	}

	return b.build( { ao: { radius: 0.06, strength: 1 } } );

}

// ---------------------------------------------------------------------------
// Small organisms and debris
// ---------------------------------------------------------------------------

// Long-spined sea urchin (Diadema antillarum). About 0.45 m across the spines at scale 1.
// aData = ( spine t, ao, spine flag, spine random )
export function createUrchin( rng, lod ) {

	const b = new MeshBuilder();
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		out.set( d.x * 0.045, 0.035 + d.y * ( d.y > 0 ? 0.035 : 0.02 ), d.z * 0.045 );
		return [ 0, 0, 0 ];

	} );
	smoothNormals( b );
	const n = lod === 0 ? 56 : 18;
	const dir = new THREE.Vector3(), side = new THREE.Vector3(), side2 = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		// spines radiate mostly upward and sideways
		randomUnitVector( rng, dir );
		dir.y = Math.abs( dir.y ) * 0.9 + 0.1;
		dir.normalize();
		const len = rand( rng, 0.12, 0.22 ) * ( 0.6 + 0.4 * dir.y );
		const r = 0.0032;
		const base = new THREE.Vector3( 0, 0.035, 0 ).addScaledVector( dir, 0.04 );
		perpendicular( dir, side );
		side2.crossVectors( dir, side );
		const w = rng();
		const ids = [];
		for ( let k = 0; k < 3; k ++ ) {

			const a = ( k / 3 ) * TAU;
			_n.copy( side ).multiplyScalar( Math.cos( a ) ).addScaledVector( side2, Math.sin( a ) );
			_p.copy( base ).addScaledVector( _n, r );
			ids.push( b.vertex( _p, _n, 0, 1, 1, w ) );

		}

		_p.copy( base ).addScaledVector( dir, len );
		const tip = b.vertex( _p, dir, 1, 1, 1, w );
		for ( let k = 0; k < 3; k ++ ) b.tri( ids[ k ], ids[ ( k + 1 ) % 3 ], tip );

	}

	return b.build();

}

// Giant Caribbean anemone (Condylactis gigantea): a short column crowned by thick
// tentacles with swollen tips. About 0.3 m across at scale 1.
// aData = ( tentacle t, ao, tentacle flag, tentacle random )
export function createAnemone( rng, lod ) {

	const b = new MeshBuilder();
	const segs = lod === 0 ? 12 : 7;
	lathe( b, [ { r: 0.045, y: - 0.01 }, { r: 0.04, y: 0.03 }, { r: 0.05, y: 0.05 }, { r: 0.03, y: 0.058 }, { r: 0.002, y: 0.06 } ], segs );
	smoothNormals( b );
	const n = lod === 0 ? 44 : 18;
	const sides = lod === 0 ? 4 : 3, rings = lod === 0 ? 4 : 2;
	for ( let i = 0; i < n; i ++ ) {

		const a = ( i / n ) * TAU * 3.1 + rng() * 0.3; // three whorls
		const ring = ( i % 3 ) / 3;
		const r0 = 0.018 + ring * 0.025;
		const el = rand( rng, 0.5, 1.2 ) - ring * 0.4;
		const dir = new THREE.Vector3( Math.cos( a ) * Math.cos( el ), Math.sin( el ), Math.sin( a ) * Math.cos( el ) );
		const p = new THREE.Vector3( Math.cos( a ) * r0, 0.055, Math.sin( a ) * r0 );
		const len = rand( rng, 0.08, 0.14 );
		const pts = path( p, dir, len, rings, ( k, d ) => {

			d.y -= 0.12; // droop outward
			d.x += Math.cos( a ) * 0.1;
			d.z += Math.sin( a ) * 0.1;

		} );
		const w = rng();
		tube( b, pts, pts.map( ( q, k ) => 0.0065 * ( 1 - 0.35 * k / rings ) ), { sides, cap: true, data: ( k, t ) => [ t, 1, w ] } );

	}

	return b.build( { ao: { radius: 0.04, strength: 0.8 } } );

}

// Coral rubble: broken staghorn fragments, plate chips and pebbles lying on the seabed.
// About 0.6 m across at scale 1. aData = ( 0, ao, bleached fragment flag, piece random )
export function createRubble( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 12, 6, 3 ][ lod ];
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.28;
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const w = rng();
		const bleached = rng() < 0.4 ? 1 : 0;
		if ( rng() < 0.55 ) {

			// branch fragment lying on the ground
			const ya = rng() * TAU, len = rand( rng, 0.05, 0.14 ), rad = rand( rng, 0.008, 0.014 );
			const d = new THREE.Vector3( Math.cos( ya ), rand( rng, - 0.1, 0.25 ), Math.sin( ya ) );
			const p0 = new THREE.Vector3( x, rad * 0.7, z );
			const pts = [ p0, p0.clone().addScaledVector( d.normalize(), len ) ];
			tube( b, pts, [ rad, rad * 0.8 ], { sides: lod === 0 ? 5 : 3, cap: true, data: () => [ 0, bleached, w ] } );

		} else {

			const s = rand( rng, 0.025, 0.07 );
			const nz = waveNoise( rng, 3, 2, 4 );
			const first = b.count, fi = b.index.length;
			blob( b, lod === 0 ? 1 : 0, ( d, out ) => {

				const k = 1 + 0.3 * nz( d.x, d.y, d.z );
				out.set( x + d.x * s * k, Math.max( 0.3 * s + d.y * s * 0.6 * k, - 0.01 ), z + d.z * s * k );
				return [ 0, bleached * 0.5, w ];

			} );
			smoothNormals( b, first, fi );

		}

	}

	return b.build( { ao: { radius: 0.05, strength: 1 } } );

}

// Turtle grass clump (Thalassia testudinum): ribbon blades, bent by the surge in the shader.
// aData = ( t along the blade, ao, across -1..1, blade random ); blades are two-sided.
export function createSeagrass( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 10, 6, 3 ][ lod ];
	const segs = [ 5, 3, 2 ][ lod ];
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = rng() * 0.05;
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const yaw = rng() * Math.PI;
		const len = rand( rng, 0.15, 0.32 ), w = rand( rng, 0.008, 0.011 ) * ( lod === 2 ? 1.6 : 1 );
		const ca = Math.cos( yaw ), sa = Math.sin( yaw );
		const lean = rand( rng, - 0.15, 0.15 );
		const bw = rng();
		const first = b.count, fi = b.index.length;
		for ( let k = 0; k <= segs; k ++ ) {

			const t = k / segs;
			const y = t * len;
			const off = lean * y * t;
			const ww = w * ( k === segs ? 0.4 : 1 );
			_n.set( - sa, 0, ca );
			for ( const s of [ - 1, 1 ] ) {

				_p.set( x + ca * s * ww * 0.5 - sa * off, y, z + sa * s * ww * 0.5 + ca * off );
				b.vertex( _p, _n, t, 0.6 + 0.4 * t, s, bw );

			}

		}

		for ( let k = 0; k < segs; k ++ ) b.quad( first + k * 2, first + k * 2 + 1, first + k * 2 + 3, first + k * 2 + 2 );
		b.backfaces( first, fi );

	}

	return b.build();

}

// ---------------------------------------------------------------------------
// Lattice / feathery gorgonians (alpha-tested, double-sided material)
// ---------------------------------------------------------------------------

// Common sea fan (Gorgonia ventalina): a lobed, slightly bowed and ruffled net in the
// local xy plane on a short stalk. About 0.9 m wide, 0.8 m tall at scale 1.
// aData = ( radial t, ao, part (0 net, 1 stalk), fan random )
export function createSeaFan( rng, lod ) {

	const b = new MeshBuilder();
	const nu = [ 18, 10, 6 ][ lod ], nv = [ 10, 5, 3 ][ lod ];
	const H = 0.8, th = rand( rng, 1.0, 1.25 );
	const lobe = waveNoise( rng, 5, 2, 6 );
	const ruffle = waveNoise( rng, 4, 3, 7 );
	const bow = rand( rng, - 0.25, 0.25 );
	const w = rng();
	const y0 = 0.06;
	sheet( b, nu, nv, ( u, v, out ) => {

		const a = ( u - 0.5 ) * 2 * th;
		const R = H * ( 0.88 + 0.12 * lobe( Math.sin( a ), Math.cos( a ), 0 ) ) * ( 1 - 0.22 * Math.pow( Math.abs( a ) / th, 3 ) );
		const r = 0.02 + v * ( R - 0.02 );
		const x = Math.sin( a ) * r * 1.1, y = y0 + Math.cos( a ) * r;
		const z = bow * x * x + 0.03 * v * ruffle( x * 2, y * 2, 0 );
		out.set( x, y, z );
		return [ v, 0, w ];

	}, false );
	// stalk
	tube( b, [ new THREE.Vector3( 0, - 0.02, 0 ), new THREE.Vector3( 0, y0 + 0.02, 0 ) ], [ 0.018, 0.012 ], { sides: lod === 0 ? 5 : 3, data: () => [ 0, 1, w ] } );
	return b.build();

}

// Sea plume (Antillogorgia / Pseudopterogorgia): a short stem forking into long, drooping
// feathery branches; each branch is a pair of crossed ribbons whose pinnules come from the
// alpha mask. About 1 m tall at scale 1.
// aData = ( t along the branch, ao, across -1..1 (4 for the solid stem), branch random )
export function createSeaPlume( rng, lod ) {

	const b = new MeshBuilder();
	const segs = [ 9, 5, 3 ][ lod ];
	const n = [ 7, 5, 3 ][ lod ] + Math.floor( rng() * 3 );
	const stemTop = new THREE.Vector3( rand( rng, - 0.02, 0.02 ), rand( rng, 0.08, 0.14 ), rand( rng, - 0.02, 0.02 ) );
	tube( b, [ new THREE.Vector3( 0, - 0.02, 0 ), stemTop ], [ 0.012, 0.008 ], { sides: 4, data: () => [ 0, 4, 0 ] } );
	const plane = rng() * TAU;
	for ( let i = 0; i < n; i ++ ) {

		const a = plane + ( ( i / Math.max( 1, n - 1 ) ) - 0.5 ) * rand( rng, 1.4, 2.2 ) + rand( rng, - 0.2, 0.2 ) + ( rng() < 0.3 ? Math.PI : 0 );
		const lean = rand( rng, 0.2, 0.6 );
		const dir = new THREE.Vector3( Math.cos( a ) * lean, 1, Math.sin( a ) * lean ).normalize();
		const len = rand( rng, 0.5, 0.95 );
		const droop = rand( rng, 0.02, 0.08 );
		const pts = path( stemTop, dir, len, segs, ( k, d ) => {

			d.y -= droop * k / segs;

		} );
		const width = rand( rng, 0.05, 0.08 );
		const bw = rng();
		const roll = rng() * Math.PI;
		for ( let r = 0; r < 2; r ++ ) {

			const first = b.count;
			for ( let k = 0; k <= segs; k ++ ) {

				const t = k / segs;
				const p = pts[ k ];
				const T = pts[ Math.min( segs, k + 1 ) ].clone().sub( pts[ Math.max( 0, k - 1 ) ] ).normalize();
				const side = perpendicular( T ).applyAxisAngle( T, roll + r * Math.PI * 0.5 );
				const ww = width * ( r === 0 ? 1 : 0.6 ) * Math.sin( Math.min( 1, t * 6 ) * Math.PI * 0.5 ) * ( 1 - 0.55 * t );
				_n.crossVectors( T, side ).normalize();
				for ( const s of [ - 1, 1 ] ) {

					_p.copy( p ).addScaledVector( side, s * ww );
					b.vertex( _p, _n, t, 1, s, bw );

				}

			}

			for ( let k = 0; k < segs; k ++ ) b.quad( first + k * 2, first + k * 2 + 1, first + k * 2 + 3, first + k * 2 + 2 );

		}

	}

	return b.build();

}

// ---------------------------------------------------------------------------
// Seagrass meadows and macroalgae (flexible: they sway with the surge in the shader)
// ---------------------------------------------------------------------------

// Ribbon blade from p along dir with `segs` segments, tapering to the tip and curving over by
// `lean` (m of horizontal offset at the tip, along `out`); both faces.
function blade( b, p, dir, out, len, w, lean, segs, d2, d3, ao0 = 0.45 ) {

	const first = b.count, fi = b.index.length;
	const side = new THREE.Vector3().crossVectors( dir, out ).normalize();
	const pts = [];
	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		pts.push( p.clone().addScaledVector( dir, t * len ).addScaledVector( out, lean * t * t ) );

	}

	for ( let k = 0; k <= segs; k ++ ) {

		const t = k / segs;
		const T = pts[ Math.min( segs, k + 1 ) ].clone().sub( pts[ Math.max( 0, k - 1 ) ] ).normalize();
		_n.crossVectors( side, T ).normalize();
		const ww = w * ( k === segs ? 0.35 : 1 - 0.25 * t );
		for ( const s of [ - 1, 1 ] ) {

			_p.copy( pts[ k ] ).addScaledVector( side, s * ww * 0.5 );
			b.vertex( _p, _n, t, ao0 + ( 1 - ao0 ) * t, s, d3 );

		}

	}

	for ( let k = 0; k < segs; k ++ ) b.quad( first + k * 2, first + k * 2 + 1, first + k * 2 + 3, first + k * 2 + 2 );
	b.backfaces( first, fi );

}

// A patch of seagrass meadow over a disc of radius 1 m at scale 1: turtle grass shoots
// (Thalassia testudinum, 2-5 strap blades each) mixed with manatee grass (Syringodium
// filiforme: thin, taller blades). All random values are drawn for every shoot whatever the
// level of detail, so the lower levels keep a subset of the same shoots (with wider blades)
// and the meadow thins out in place instead of shifting. The terrain's meadow texture fills in
// between. aData = ( t along the blade, ao, across -1..1, blade random )
export function createMeadow( rng, lod ) {

	const b = new MeshBuilder();
	const N = 140;
	const shoots = [];
	for ( let i = 0; i < N; i ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.97;
		const manatee = rng() < 0.2;
		const nb = 2 + Math.floor( rng() * 3 );
		const yaw = rng() * Math.PI;
		const blades = [];
		for ( let k = 0; k < 4; k ++ ) blades.push( [ rng(), rng(), rng(), rng() ] );
		shoots.push( { x: Math.cos( a ) * r, z: Math.sin( a ) * r, manatee, nb, yaw, blades } );

	}

	const keep = [ N, 46, 16 ][ lod ];
	const segs = [ 2, 1, 1 ][ lod ];
	const widen = [ 1, 1.45, 2.3 ][ lod ];
	const maxBlades = [ 4, 2, 1 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 ), out = new THREE.Vector3(), dir = new THREE.Vector3(), base = new THREE.Vector3();
	for ( let i = 0; i < keep; i ++ ) {

		const s = shoots[ i ];
		const nb = Math.min( s.nb, maxBlades );
		for ( let k = 0; k < nb; k ++ ) {

			const [ r1, r2, r3, r4 ] = s.blades[ k ];
			const len = s.manatee ? 0.22 + r1 * 0.26 : 0.1 + r1 * 0.26;
			const w = ( s.manatee ? 0.0035 : 0.008 + r2 * 0.005 ) * widen;
			// blades of a shoot fan out in one plane and lean outward
			const spread = ( k - ( nb - 1 ) / 2 );
			out.set( Math.cos( s.yaw ), 0, Math.sin( s.yaw ) );
			dir.copy( up ).addScaledVector( out, spread * 0.14 + ( r3 - 0.5 ) * 0.1 ).normalize();
			const lean = ( r4 - 0.3 ) * 0.35 * len * Math.sign( spread || 1 );
			base.set( s.x + out.x * 0.003 * spread, - 0.01, s.z + out.z * 0.003 * spread );
			blade( b, base, dir, out, len, w, lean, segs, 0, r3 );

		}

	}

	return b.build();

}

// Halimeda (calcareous green alga): chains of flat, kidney-shaped segments forking upward from
// a holdfast in the sand; a clump of a few plants. About 0.25 m tall at scale 1.
// aData = ( height t, ao, 0, segment random )
export function createHalimeda( rng, lod ) {

	const b = new MeshBuilder();
	const plants = 3 + Math.floor( rng() * 3 );
	const budget = [ 28, 11, 4 ][ lod ];
	const grow = [ 1, 1.4, 2.2 ][ lod ];
	const sides = lod === 0 ? 7 : 5;
	const H = 0.25;
	for ( let p = 0; p < plants; p ++ ) {

		const a = rng() * TAU, r = Math.sqrt( rng() ) * 0.13;
		const w0 = rng();
		branch( [ { p: new THREE.Vector3( Math.cos( a ) * r, 0, Math.sin( a ) * r ), dir: new THREE.Vector3( rand( rng, - 0.3, 0.3 ), 1, rand( rng, - 0.3, 0.3 ) ).normalize(), n: 0 } ], budget, ( s ) => {

			// one segment: a flat disc facing sideways
			const size = rand( rng, 0.011, 0.016 ) * grow * ( 1 - 0.25 * s.p.y / H );
			const c = s.p.clone().addScaledVector( s.dir, size );
			const face = new THREE.Vector3( Math.cos( w0 * 20 + s.n ), 0.25, Math.sin( w0 * 20 + s.n ) ).normalize();
			const u = new THREE.Vector3().crossVectors( face, s.dir ).normalize(), v = new THREE.Vector3().crossVectors( u, face ).normalize();
			const first = b.count, fi = b.index.length;
			const t = clamp( c.y / H, 0, 1 );
			const w = rng();
			const mid = b.vertex( c, face, t, 1, 0, w );
			for ( let k = 0; k < sides; k ++ ) {

				const ang = k / sides * TAU;
				const kidney = 1 - 0.25 * Math.max( 0, Math.cos( ang ) ); // notch where the next segment joins
				_p.copy( c ).addScaledVector( u, Math.sin( ang ) * size * 1.15 ).addScaledVector( v, Math.cos( ang ) * size * kidney );
				b.vertex( _p, face, t, 0.9, 0, w );

			}

			for ( let k = 0; k < sides; k ++ ) b.tri( mid, first + 1 + k, first + 1 + ( k + 1 ) % sides );
			b.backfaces( first, fi );
			if ( c.y > H || s.n > 9 ) return null;
			const next = [];
			const forks = s.n > 1 && rng() < 0.35 ? 2 : 1;
			for ( let f = 0; f < forks; f ++ ) {

				const d = s.dir.clone().add( new THREE.Vector3( rand( rng, - 0.35, 0.35 ), 0.15, rand( rng, - 0.35, 0.35 ) ) ).normalize();
				next.push( { p: c.clone().addScaledVector( s.dir, size * 0.35 ), dir: d, n: s.n + 1 } );

			}

			return next;

		} );

	}

	return b.build();

}

// Shaving-brush alga (Penicillus capitatus): a pale stalk topped by a dense tuft of calcified
// filaments; a clump of a few. About 0.12 m tall at scale 1. aData = ( t, ao, 1 on the tuft, random )
export function createPenicillus( rng, lod ) {

	const b = new MeshBuilder();
	const n = 2 + Math.floor( rng() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, r = i === 0 ? 0 : rand( rng, 0.03, 0.1 );
		const x = Math.cos( a ) * r, z = Math.sin( a ) * r;
		const h = rand( rng, 0.05, 0.1 ), lean = new THREE.Vector3( rand( rng, - 0.15, 0.15 ), 1, rand( rng, - 0.15, 0.15 ) ).normalize();
		const top = new THREE.Vector3( x, - 0.01, z ).addScaledVector( lean, h );
		const w = rng();
		tube( b, [ new THREE.Vector3( x, - 0.01, z ), top ], [ 0.004, 0.0035 ], { sides: lod === 0 ? 4 : 3, data: () => [ 0.5, 0, w ] } );
		const first = b.count, fi = b.index.length;
		const rr = rand( rng, 0.014, 0.022 ) * ( lod === 2 ? 1.2 : 1 );
		blob( b, lod === 0 ? 1 : 0, ( d, out ) => {

			out.set( top.x + d.x * rr, top.y + rr * 0.9 + d.y * rr * 1.25, top.z + d.z * rr );
			return [ 1, 1, w ];

		} );
		smoothNormals( b, first, fi );

	}

	return b.build();

}

// Sargassum (Caribbean brown alga): wiry, branching axes bearing serrated lance-shaped leaves
// and small round gas bladders, in bushy tufts on the shallow reef flat; very flexible. About
// 0.45 m tall at scale 1. aData = ( height t, ao, part (0 axis, 1 leaf, 2 bladder), random )
export function createSargassum( rng, lod ) {

	const b = new MeshBuilder();
	const axes = 2 + Math.floor( rng() * 3 );
	const H = 0.45;
	const segs = [ 7, 4, 2 ][ lod ];
	const leafKeep = [ 1, 0.4, 0.15 ][ lod ];
	const widen = [ 1, 1.5, 2.2 ][ lod ];
	const up = new THREE.Vector3( 0, 1, 0 );
	for ( let i = 0; i < axes; i ++ ) {

		const a = rng() * TAU, lean = rand( rng, 0.1, 0.4 );
		const dir = new THREE.Vector3( Math.cos( a ) * lean, 1, Math.sin( a ) * lean );
		const len = rand( rng, 0.3, 0.5 );
		const wig = rand( rng, 0.1, 0.25 );
		const pts = path( new THREE.Vector3( rand( rng, - 0.02, 0.02 ), - 0.01, rand( rng, - 0.02, 0.02 ) ), dir, len, segs, ( k, d ) => {

			d.x += ( rng() - 0.5 ) * wig;
			d.z += ( rng() - 0.5 ) * wig;

		} );
		const w = rng();
		tube( b, pts, pts.map( ( p, k ) => 0.0028 * widen * ( 1 - 0.3 * k / segs ) ), { sides: 3, cap: false, data: ( k ) => [ clamp( pts[ k ].y / H, 0, 1 ), 0, w ] } );
		// leaves and bladders along the axis (all random values drawn whatever the lod)
		const nl = 14;
		for ( let k = 0; k < nl; k ++ ) {

			const t = 0.15 + 0.85 * ( k + rng() ) / nl;
			const f = t * segs, i0 = Math.min( segs - 1, Math.floor( f ) );
			const p = pts[ i0 ].clone().lerp( pts[ i0 + 1 ], f - i0 );
			const ya = rng() * TAU, el = rand( rng, 0.3, 1.1 ), ll = rand( rng, 0.025, 0.045 ), lw = rand( rng, 0.005, 0.009 );
			const bladder = rng() < 0.35;
			const keep = rng() < leafKeep;
			if ( ! keep ) continue;
			const ld = new THREE.Vector3( Math.cos( ya ) * Math.cos( el ), Math.sin( el ), Math.sin( ya ) * Math.cos( el ) );
			const face = new THREE.Vector3().crossVectors( ld, up ).normalize();
			if ( face.lengthSq() < 0.1 ) face.set( 1, 0, 0 );
			const tt = clamp( p.y / H, 0, 1 );
			blade( b, p, ld, face, ll, lw * widen, ll * 0.3, 1, 1, rng(), 0.7 );
			for ( let v = b.count - 8; v < b.count; v ++ ) {

				b.data[ v * 4 ] = tt;
				b.data[ v * 4 + 2 ] = 1;

			}

			if ( bladder && lod === 0 ) {

				const first = b.count, fi = b.index.length;
				const c = p.clone().addScaledVector( ld, - 0.004 ).addScaledVector( face, 0.006 );
				blob( b, 0, ( d, o ) => {

					o.copy( c ).addScaledVector( d, 0.0035 );
					return [ tt, 2, w ];

				} );
				smoothNormals( b, first, fi );

			}

		}

	}

	return b.build();

}

// ---------------------------------------------------------------------------
// More reef builders: the deeper slope and wall, sponges
// ---------------------------------------------------------------------------

// Lettuce coral (Agaricia tenuifolia): a dense clump of thin, upright, twisting blades.
// About 0.5 m across at scale 1. aData as createBlades.
export function createLettuce( rng, lod ) {

	const b = new MeshBuilder();
	const n = [ 16, 10, 6 ][ lod ];
	const nu = [ 6, 3, 2 ][ lod ], nv = [ 3, 1, 1 ][ lod ];
	for ( let k = 0; k < n; k ++ ) {

		const a = rng() * TAU, rr = Math.sqrt( rng() ) * 0.2;
		const cx = Math.cos( a ) * rr, cz = Math.sin( a ) * rr;
		const yaw = rng() * Math.PI;
		const w = rand( rng, 0.08, 0.16 ), h = rand( rng, 0.1, 0.24 ) * ( 1 - rr * 1.5 ), th = 0.005;
		const lobe = waveNoise( rng, 3, 12, 28 );
		const twist = rand( rng, - 0.9, 0.9 );
		const r = rng();
		const at = ( u, v, s, out ) => {

			const x = ( u - 0.5 ) * w;
			const e = Math.abs( u - 0.5 ) * 2;
			const top = h * ( 0.8 + 0.2 * lobe( x, 0, 0 ) ) * ( 0.45 + 0.55 * Math.sqrt( Math.max( 0, 1 - Math.pow( e, 2.5 ) ) ) );
			const y = v * top;
			// the blade twists with height and curls at its edges
			const yw = yaw + twist * v;
			const zz = s * th * ( 1 - 0.5 * v ) + 0.04 * e * e * v + 0.01 * lobe( x * 4, y * 4, 0 );
			const ca = Math.cos( yw ), sa = Math.sin( yw );
			out.set( cx + x * ca - zz * sa, y - 0.01, cz + x * sa + zz * ca );
			return [ v, v > 0.8 ? 1 : 0, r ];

		};

		const first = b.count, fi = b.index.length;
		sheet( b, nu, nv, ( u, v, out ) => at( u, v, 1, out ), false );
		sheet( b, nu, nv, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
		smoothNormals( b, first, fi );

	}

	return b.build( { ao: { radius: 0.06, strength: 0.8 } } );

}

// Wall plates (Agaricia lamarcki / grahamae): one or two broad, thin shelves spreading from a
// small attachment, in tiers down the drop-off. About 1.2 m across at scale 1.
// aData = ( radial 0..1, ao, top (1) / underside (0), plate random )
export function createWallPlates( rng, lod ) {

	const b = new MeshBuilder();
	const nr = [ 5, 3, 1 ][ lod ], na = [ 16, 9, 6 ][ lod ];
	const n = 1 + ( rng() < 0.55 ? 1 : 0 );
	for ( let k = 0; k < n; k ++ ) {

		const R = rand( rng, 0.4, 0.62 ) * ( 1 - k * 0.3 );
		const y0 = 0.1 + k * rand( rng, 0.14, 0.22 );
		const az = rng() * TAU, span = rand( rng, 2.6, 3.8 );
		const tilt = rand( rng, 0.0, 0.12 );
		const wave = waveNoise( rng, 4, 2, 5 );
		const r0 = rng();
		const at = ( u, v, sgn, out ) => {

			const a = az + ( u - 0.5 ) * span;
			const edge = 1 - 0.3 * Math.pow( Math.abs( u - 0.5 ) * 2, 2 );
			const r = 0.03 + v * R * edge * ( 1 + 0.1 * wave( Math.cos( a ), 0, Math.sin( a ) ) );
			// thin shelf, curling down at the rim, ruffled
			const y = y0 + v * R * tilt - 0.08 * v * v * v * R + 0.03 * v * v * wave( Math.cos( a ) * 3, 2, Math.sin( a ) * 3 ) + sgn * 0.005 * ( 1 - v * 0.6 );
			out.set( Math.cos( a ) * r, y, Math.sin( a ) * r );
			return [ v, sgn > 0 ? 1 : 0, r0 ];

		};

		const first = b.count, fi = b.index.length;
		sheet( b, na, nr, ( u, v, out ) => at( u, v, 1, out ), false );
		sheet( b, na, nr, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
		const rim = [];
		for ( let i = 0; i <= na; i ++ ) {

			const pa = new THREE.Vector3(), pb = new THREE.Vector3();
			at( i / na, 1, 1, pa );
			at( i / na, 1, - 1, pb );
			rim.push( b.vertex( pa, _up, 1, 1, 1, r0 ), b.vertex( pb, _up, 1, 1, 1, r0 ) );

		}

		for ( let i = 0; i < na; i ++ ) b.quad( rim[ i * 2 ], rim[ i * 2 + 2 ], rim[ i * 2 + 3 ], rim[ i * 2 + 1 ] );
		smoothNormals( b, first, fi );

	}

	// the stout column the shelves grow from
	const first = b.count, fi = b.index.length;
	lathe( b, [ { r: 0.13, y: - 0.03, d: [ 0, 0, 0 ] }, { r: 0.1, y: 0.06, d: [ 0.1, 0, 0 ] }, { r: 0.07, y: 0.14 + ( n - 1 ) * 0.16, d: [ 0.2, 0, 0 ] }, { r: 0.002, y: 0.16 + ( n - 1 ) * 0.16, d: [ 0.2, 0, 0 ] } ], lod === 0 ? 9 : 6 );
	smoothNormals( b, first, fi );
	return b.build( { ao: { radius: 0.12, strength: 1.0 } } );

}

// Wire coral (Cirrhipathes): a single long, thin, unbranched whip growing out from the wall
// and coiling at its end. About 1.6 m long at scale 1. aData = ( t, ao, 0, random )
export function createWireCoral( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 4, 3, 3 ][ lod ];
	const rings = [ 24, 12, 6 ][ lod ];
	const n = rng() < 0.3 ? 2 : 1;
	for ( let i = 0; i < n; i ++ ) {

		const a = rng() * TAU, lean = rand( rng, 0.3, 0.8 );
		const dir = new THREE.Vector3( Math.cos( a ) * lean, 1, Math.sin( a ) * lean );
		const len = rand( rng, 1.1, 1.8 );
		const coil = rand( rng, 0.25, 0.45 ) * ( rng() < 0.5 ? 1 : - 1 );
		const pts = path( new THREE.Vector3( 0, - 0.01, 0 ), dir, len, rings, ( k, d ) => {

			const t = k / rings;
			d.y += 0.02;
			// the free end coils into a loose spiral
			if ( t > 0.45 ) d.applyAxisAngle( _up, coil * ( t - 0.45 ) * 2 );

		} );
		const r = 0.0045 * ( lod === 2 ? 1.8 : 1 );
		const w = rng();
		tube( b, pts, pts.map( ( p, k ) => r * ( 1 - 0.5 * k / rings ) ), { sides, cap: true, data: ( k, t ) => [ t, 0, w ] } );

	}

	return b.build();

}

// Black coral (Antipathes): a bushy tree of fine branches on the deep wall. About 0.8 m tall at
// scale 1. aData = ( height 0..1, ao, 0, branch random )
export function createBlackCoral( rng, lod ) {

	const b = new MeshBuilder();
	const sides = [ 4, 3, 3 ][ lod ];
	const H = 0.8;
	const up = new THREE.Vector3( 0, 1, 0 );
	branch( [ { p: new THREE.Vector3( 0, - 0.02, 0 ), dir: new THREE.Vector3( rand( rng, - 0.1, 0.1 ), 1, rand( rng, - 0.1, 0.1 ) ), r: 0.014, len: rand( rng, 0.12, 0.18 ), depth: 0 } ], [ 80, 34, 12 ][ lod ], ( s ) => {

		const pts = path( s.p, s.dir, s.len, 2, ( i, d ) => {

			d.y += 0.05;
			d.x += ( rng() - 0.5 ) * 0.25;
			d.z += ( rng() - 0.5 ) * 0.25;

		} );
		const last = s.depth >= 6 || pts[ 2 ].y > H;
		const rEnd = s.r * 0.78;
		const w = rng();
		const radii = pts.map( ( p, i ) => Math.max( 0.0025, s.r + ( rEnd - s.r ) * i / 2 ) * ( lod === 2 ? 1.6 : 1 ) );
		tube( b, pts, radii, { sides, cap: last, data: ( i ) => [ clamp( pts[ i ].y / H, 0, 1 ), 0, w ] } );
		if ( last ) return null;
		const end = pts[ 2 ];
		const dir = end.clone().sub( pts[ 1 ] ).normalize();
		const out = [];
		const k = s.depth < 2 ? 2 : 2 + ( rng() < 0.4 ? 1 : 0 );
		for ( let j = 0; j < k; j ++ ) {

			const d = dir.clone().add( randomUnitVector( rng, new THREE.Vector3() ).multiplyScalar( 0.75 ) ).addScaledVector( up, 0.35 ).normalize();
			out.push( { p: end.clone(), dir: d, r: rEnd, len: s.len * rand( rng, 0.7, 0.95 ), depth: s.depth + 1 } );

		}

		return out;

	} );
	return b.build( { ao: { radius: 0.08, strength: 0.8 } } );

}

// Elephant ear sponge (Agelas / Ianthella): a thick, upright, lobed plate from a narrow base,
// bowed into a shallow cup, convoluted. About 0.8 m wide, 0.7 m tall at scale 1.
// aData = ( height 0..1, ao, 0, random )
export function createEarSponge( rng, lod ) {

	const b = new MeshBuilder();
	const nu = [ 12, 7, 4 ][ lod ], nv = [ 7, 4, 2 ][ lod ];
	const W = rand( rng, 0.65, 0.9 ), H = rand( rng, 0.55, 0.75 ), th = rand( rng, 0.025, 0.04 );
	const lobe = waveNoise( rng, 4, 3, 8 );
	const ruffle = waveNoise( rng, 4, 4, 9 );
	const bow = rand( rng, 0.3, 0.8 );
	const r = rng();
	const at = ( u, v, s, out ) => {

		const x0 = ( u - 0.5 ) * 2;
		const width = W * 0.5 * ( 0.18 + 0.82 * Math.sin( Math.min( 1, v * 1.4 ) * Math.PI * 0.5 ) );
		const x = x0 * width;
		const e = Math.abs( x0 );
		const top = H * ( 0.8 + 0.2 * lobe( x, 0, 0 ) ) * ( 0.55 + 0.45 * Math.sqrt( Math.max( 0, 1 - e * e ) ) );
		const y = v * top;
		const z = bow * x * x + 0.05 * ruffle( x * 2, y * 2, 0 ) * v + s * th * 0.5 * ( 1 - 0.4 * v );
		out.set( x, y - 0.02, z );
		return [ v, 0, r ];

	};

	const first = b.count, fi = b.index.length;
	sheet( b, nu, nv, ( u, v, out ) => at( u, v, 1, out ), false );
	sheet( b, nu, nv, ( u, v, out ) => at( 1 - u, v, - 1, out ), false );
	const rim = [];
	for ( let i = 0; i <= nu; i ++ ) {

		const pa = new THREE.Vector3(), pb = new THREE.Vector3();
		at( i / nu, 1, 1, pa );
		at( i / nu, 1, - 1, pb );
		rim.push( b.vertex( pa, _up, 1, 1, 0, r ), b.vertex( pb, _up, 1, 1, 0, r ) );

	}

	for ( let i = 0; i < nu; i ++ ) b.quad( rim[ i * 2 ], rim[ i * 2 + 2 ], rim[ i * 2 + 3 ], rim[ i * 2 + 1 ] );
	// sides of the plate
	for ( const u of [ 0, 1 ] ) {

		const col = [];
		for ( let j = 0; j <= nv; j ++ ) {

			const pa = new THREE.Vector3(), pb = new THREE.Vector3();
			at( u, j / nv, 1, pa );
			at( u, j / nv, - 1, pb );
			col.push( b.vertex( pa, _up, j / nv, 1, 0, r ), b.vertex( pb, _up, j / nv, 1, 0, r ) );

		}

		for ( let j = 0; j < nv; j ++ ) {

			if ( u === 0 ) b.quad( col[ j * 2 ], col[ j * 2 + 1 ], col[ j * 2 + 3 ], col[ j * 2 + 2 ] );
			else b.quad( col[ j * 2 ], col[ j * 2 + 2 ], col[ j * 2 + 3 ], col[ j * 2 + 1 ] );

		}

	}

	smoothNormals( b, first, fi );
	return b.build( { ao: { radius: 0.15, strength: 1.0 } } );

}

// ---------------------------------------------------------------------------
// Small life on the sand (bay floor)

// Cushion sea star (Oreaster): a thick five-armed star, 0.12 m in radius.
export function createStarfish( rng, lod ) {

	const b = new MeshBuilder();
	const tips = [], top = new THREE.Vector3( 0, 0.03, 0 ), bottom = new THREE.Vector3( 0, 0.002, 0 );
	const w = rng();
	const ct = b.vertex( top, _up, 0, 1, 0, w );
	for ( let i = 0; i < 10; i ++ ) {

		const a = i / 10 * TAU + rng() * 0.08;
		const r = i % 2 ? 0.045 : 0.12 * rand( rng, 0.9, 1.05 );
		const y = i % 2 ? 0.022 : 0.008;
		tips.push( b.vertex( new THREE.Vector3( Math.cos( a ) * r, y, Math.sin( a ) * r ), _up, 1, 1, 0, w ) );

	}

	const cb = b.vertex( bottom, new THREE.Vector3( 0, - 1, 0 ), 0, 1, 0, w );
	for ( let i = 0; i < 10; i ++ ) {

		b.tri( ct, tips[ ( i + 1 ) % 10 ], tips[ i ] );
		b.tri( cb, tips[ i ], tips[ ( i + 1 ) % 10 ] );

	}

	smoothNormals( b );
	return b.build();

}

// Sea cucumber: a warty sausage lying on the sand, 0.26 m long.
export function createCucumber( rng, lod ) {

	const b = new MeshBuilder();
	const nz = waveNoise( rng, 3, 3, 6 );
	const bend = rand( rng, - 0.3, 0.3 );
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		const k = 1 + 0.12 * nz( d.x, d.y, d.z );
		out.set( d.x * 0.13, 0.028 + d.y * 0.026 * k, d.z * 0.034 * k + bend * d.x * d.x * 0.1 );
		return [ 0, 0, rng() * 0.2 ];

	} );
	smoothNormals( b );
	return b.build();

}

// Queen conch: a pale, knobbed spire with a flared lip, 0.2 m long.
export function createConch( rng, lod ) {

	const b = new MeshBuilder();
	blob( b, lod === 0 ? 2 : 1, ( d, out ) => {

		const along = d.x; // -1 spire .. 1 siphonal end
		const spire = Math.max( 0, - along );
		const r = 0.05 * ( 1 - 0.75 * spire * spire ) * ( 1 + 0.12 * Math.sin( Math.atan2( d.z, d.y ) * 7 ) * spire );
		const lip = Math.max( 0, d.z ) * Math.max( 0, 1 - Math.abs( along + 0.1 ) ) * 0.035;
		out.set( along * 0.1, 0.04 + d.y * r * 0.9, d.z * ( r + lip ) );
		return [ 0, 1, 0 ];

	} );
	smoothNormals( b );
	return b.build();

}
