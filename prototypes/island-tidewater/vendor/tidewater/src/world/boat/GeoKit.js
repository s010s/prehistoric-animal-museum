import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, Euler, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, ShapeUtils, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3, RoundedBoxGeometry, mergeGeometries } from '../../engine/index.js';

// Geometry helpers for the procedural boat. Every geometry is normalized to the
// same attribute layout so parts can be merged per material:
//   position, normal, uv (meters where it matters), color (linear RGB),
//   aux = (roughness, metalness, pattern id, animation weight)

const KEEP = new Set( [ 'position', 'normal', 'uv', 'color', 'aux' ] );
const _color = new Color();
const _v = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();

export function mat4( x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ' ) {

	_e.set( rx, ry, rz, order );
	_q.setFromEuler( _e );
	return new Matrix4().compose( _v.set( x, y, z ), _q, _s.set( sx, sy, sz ) );

}

// Matrix placing the local +Y axis along `dir` at `pos`.
export function alignY( pos, dir, roll = 0 ) {

	const d = dir.clone().normalize();
	const q = new Quaternion().setFromUnitVectors( new Vector3( 0, 1, 0 ), d );
	if ( roll ) q.multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), roll ) );
	return new Matrix4().compose( pos, q, new Vector3( 1, 1, 1 ) );

}

export function linearColor( c ) {

	return c instanceof Color ? c : _color.set( c ).clone();

}

export function prepare( geo, { color = 0xffffff, rough = 0.5, metal = 0, pattern = 0, anim = 0, matrix = null } = {} ) {

	for ( const name of Object.keys( geo.attributes ) ) if ( ! KEEP.has( name ) ) geo.deleteAttribute( name );
	geo.morphAttributes = {};
	geo.clearGroups();

	const n = geo.attributes.position.count;
	if ( ! geo.index ) {

		const idx = new Array( n );
		for ( let i = 0; i < n; i ++ ) idx[ i ] = i;
		geo.setIndex( idx );

	}

	if ( ! geo.attributes.normal ) geo.computeVertexNormals();
	if ( ! geo.attributes.uv ) geo.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( n * 2 ), 2 ) );

	if ( ! geo.attributes.color ) {

		const c = linearColor( color );
		const arr = new Float32Array( n * 3 );
		for ( let i = 0; i < n; i ++ ) {

			arr[ i * 3 ] = c.r; arr[ i * 3 + 1 ] = c.g; arr[ i * 3 + 2 ] = c.b;

		}

		geo.setAttribute( 'color', new Float32BufferAttribute( arr, 3 ) );

	}

	if ( ! geo.attributes.aux ) {

		const arr = new Float32Array( n * 4 );
		for ( let i = 0; i < n; i ++ ) {

			arr[ i * 4 ] = rough; arr[ i * 4 + 1 ] = metal; arr[ i * 4 + 2 ] = pattern; arr[ i * 4 + 3 ] = anim;

		}

		geo.setAttribute( 'aux', new Float32BufferAttribute( arr, 4 ) );

	}

	// uniform float layout for merging
	for ( const name of Object.keys( geo.attributes ) ) {

		const a = geo.attributes[ name ];
		if ( ! ( a.array instanceof Float32Array ) || a.isInterleavedBufferAttribute ) {

			geo.setAttribute( name, new Float32BufferAttribute( Float32Array.from( { length: a.count * a.itemSize }, ( _, i ) => a.array[ i ] ), a.itemSize ) );

		}

	}

	if ( matrix ) geo.applyMatrix4( matrix );
	return geo;

}

// Collects geometries per material bucket and merges them.
export class GeoKit {

	constructor() {

		this.buckets = new Map();

	}

	add( bucket, geometry, opts ) {

		const g = prepare( geometry, opts );
		if ( ! this.buckets.has( bucket ) ) this.buckets.set( bucket, [] );
		this.buckets.get( bucket ).push( g );
		return g;

	}

	merged( bucket ) {

		const list = this.buckets.get( bucket );
		if ( ! list || list.length === 0 ) return null;
		const g = list.length === 1 ? list[ 0 ] : mergeGeometries( list, false );
		if ( ! g ) throw new Error( 'BoatModel: failed to merge bucket ' + bucket );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

// Merge a list of prepared geometries into one (for animated parts).
export function mergePrepared( list ) {

	const g = list.length === 1 ? list[ 0 ] : mergeGeometries( list, false );
	g.computeBoundingBox();
	g.computeBoundingSphere();
	return g;

}

// ------------------------------------------------------------------ primitives

// Box with UVs in meters.
export function box( w, h, d ) {

	const g = new BoxGeometry( w, h, d );
	const uv = g.attributes.uv;
	// face order: px, nx, py, ny, pz, nz (4 vertices each)
	const dims = [ [ d, h ], [ d, h ], [ w, d ], [ w, d ], [ w, h ], [ w, h ] ];
	for ( let f = 0; f < 6; f ++ ) {

		for ( let i = 0; i < 4; i ++ ) {

			const k = f * 4 + i;
			uv.setXY( k, uv.getX( k ) * dims[ f ][ 0 ], uv.getY( k ) * dims[ f ][ 1 ] );

		}

	}

	return g;

}

export function roundedBox( w, h, d, radius = 0.02, segments = 2 ) {

	const g = new RoundedBoxGeometry( w, h, d, segments, Math.min( radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4 ) );
	const uv = g.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * Math.max( w, d ), uv.getY( i ) * h );
	return g;

}

export function cylinder( rTop, rBottom, h, radial = 12, heightSegs = 1, open = false, thetaStart = 0, thetaLength = Math.PI * 2 ) {

	const g = new CylinderGeometry( rTop, rBottom, h, radial, heightSegs, open, thetaStart, thetaLength );
	const uv = g.attributes.uv;
	const circ = Math.max( rTop, rBottom ) * thetaLength;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * circ, uv.getY( i ) * h );
	return g;

}

// Cylinder between two points.
export function rod( a, b, radius, radial = 8, rEnd = radius ) {

	const dir = new Vector3().subVectors( b, a );
	const len = dir.length();
	const g = cylinder( rEnd, radius, len, radial, 1, false );
	g.applyMatrix4( alignY( new Vector3().addVectors( a, b ).multiplyScalar( 0.5 ), dir ) );
	return g;

}

export function sphere( r, w = 12, h = 8, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI ) {

	return new SphereGeometry( r, w, h, phiStart, phiLength, thetaStart, thetaLength );

}

export function torus( R, r, radial = 8, tubular = 24, arc = Math.PI * 2 ) {

	const g = new TorusGeometry( R, r, radial, tubular, arc );
	const uv = g.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * R * arc, uv.getY( i ) * 2 * Math.PI * r );
	return g;

}

// Lathe around +Y from [ [r, y], ... ] (bottom to top).
export function lathe( profile, segments = 16 ) {

	const pts = profile.map( ( p ) => new Vector2( Math.max( 0, p[ 0 ] ), p[ 1 ] ) );
	const g = new LatheGeometry( pts, segments );
	// three's lathe winds so normals face outward for bottom-to-top profiles
	return g;

}

export function tube( points, radius, tubular = 32, radial = 6, closed = false, tension = 0.5 ) {

	const curve = new CatmullRomCurve3( points, closed, 'catmullrom', tension );
	const g = new TubeGeometry( curve, tubular, radius, radial, closed );
	const len = curve.getLength();
	const uv = g.attributes.uv;
	for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) * len, uv.getY( i ) );
	return g;

}

// Indexed surface from rows[i][j] (Vector3). `flip` reverses the winding.
// UVs: u = distance along i (first column), v = distance along j (first row).
export function gridSurface( rows, { flip = false, uvFn = null, closeJ = false } = {} ) {

	const ni = rows.length, nj = rows[ 0 ].length;
	const pos = new Float32Array( ni * nj * 3 );
	const uvs = new Float32Array( ni * nj * 2 );
	let u = 0;
	for ( let i = 0; i < ni; i ++ ) {

		if ( i > 0 ) u += rows[ i ][ 0 ].distanceTo( rows[ i - 1 ][ 0 ] );
		let v = 0;
		for ( let j = 0; j < nj; j ++ ) {

			const p = rows[ i ][ j ];
			if ( j > 0 ) v += p.distanceTo( rows[ i ][ j - 1 ] );
			const k = i * nj + j;
			pos[ k * 3 ] = p.x; pos[ k * 3 + 1 ] = p.y; pos[ k * 3 + 2 ] = p.z;
			if ( uvFn ) {

				const t = uvFn( p, i, j, u, v );
				uvs[ k * 2 ] = t[ 0 ]; uvs[ k * 2 + 1 ] = t[ 1 ];

			} else {

				uvs[ k * 2 ] = u; uvs[ k * 2 + 1 ] = v;

			}

		}

	}

	const idx = [];
	const jmax = closeJ ? nj : nj - 1;
	for ( let i = 0; i < ni - 1; i ++ ) {

		for ( let j = 0; j < jmax; j ++ ) {

			const j1 = ( j + 1 ) % nj;
			const a = i * nj + j, b = ( i + 1 ) * nj + j, c = ( i + 1 ) * nj + j1, d = i * nj + j1;
			if ( flip ) idx.push( a, b, d, b, c, d );
			else idx.push( a, d, b, d, c, b );

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	return g;

}

// Flat polygon (Vector3 loop, assumed planar-ish and convex-ish) as a fan from its centroid.
export function fanCap( loop, normalHint ) {

	const c = new Vector3();
	for ( const p of loop ) c.add( p );
	c.divideScalar( loop.length );
	const pos = [ c.x, c.y, c.z ];
	for ( const p of loop ) pos.push( p.x, p.y, p.z );
	const idx = [];
	for ( let i = 0; i < loop.length; i ++ ) idx.push( 0, 1 + i, 1 + ( ( i + 1 ) % loop.length ) );
	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setIndex( idx );
	orientTowards( g, normalHint );
	g.computeVertexNormals();
	planarUV( g, normalHint );
	return g;

}

// Flip all triangles if their average normal disagrees with `dir`.
export function orientTowards( g, dir ) {

	const p = g.attributes.position, idx = g.index.array;
	const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), acc = new Vector3();
	for ( let i = 0; i < idx.length; i += 3 ) {

		a.fromBufferAttribute( p, idx[ i ] ); b.fromBufferAttribute( p, idx[ i + 1 ] ); c.fromBufferAttribute( p, idx[ i + 2 ] );
		n.subVectors( b, a ).cross( c.sub( a ) );
		acc.add( n );

	}

	if ( acc.dot( dir ) < 0 ) {

		const arr = Array.from( idx );
		for ( let i = 0; i < arr.length; i += 3 ) {

			const t = arr[ i + 1 ]; arr[ i + 1 ] = arr[ i + 2 ]; arr[ i + 2 ] = t;

		}

		g.setIndex( arr );

	}

	return g;

}

// Planar projection UVs (meters) perpendicular to `normal`.
export function planarUV( g, normal ) {

	const n = normal.clone().normalize();
	const t = Math.abs( n.y ) > 0.9 ? new Vector3( 1, 0, 0 ) : new Vector3( 0, 1, 0 ).cross( n ).normalize();
	const b = new Vector3().crossVectors( n, t );
	const p = g.attributes.position;
	const uv = new Float32Array( p.count * 2 );
	const v = new Vector3();
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		uv[ i * 2 ] = v.dot( t ); uv[ i * 2 + 1 ] = v.dot( b );

	}

	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	return g;

}

// Solid panel from a 2D outline (u, v in meters) with optional holes.
// map( u, v, side ) -> Vector3 gives the point on the front (side 0) or back (side 1) face.
// Faces are oriented automatically (front faces away from the back face, edges outward).
export function slab( outline, holes, map, { edges = true, back = true, front = true } = {} ) {

	const contour = outline.map( ( p ) => new Vector2( p[ 0 ], p[ 1 ] ) );
	const holeVs = holes.map( ( h ) => h.map( ( p ) => new Vector2( p[ 0 ], p[ 1 ] ) ) );
	if ( ShapeUtils.isClockWise( contour ) ) contour.reverse();
	for ( const h of holeVs ) if ( ! ShapeUtils.isClockWise( h ) ) h.reverse();
	const tris = ShapeUtils.triangulateShape( contour, holeVs );
	const all = contour.concat( ...holeVs );

	const parts = [];
	const faceGeo = ( side ) => {

		const pos = [], uvs = [];
		for ( const p of all ) {

			const q = map( p.x, p.y, side );
			pos.push( q.x, q.y, q.z );
			uvs.push( p.x, p.y );

		}

		// drop zero-area triangles (earcut emits them for collinear outline points)
		const idx = [];
		for ( const t of tris ) {

			const a = all[ t[ 0 ] ], b = all[ t[ 1 ] ], c = all[ t[ 2 ] ];
			if ( Math.abs( ( b.x - a.x ) * ( c.y - a.y ) - ( c.x - a.x ) * ( b.y - a.y ) ) > 1e-10 ) idx.push( t[ 0 ], t[ 1 ], t[ 2 ] );

		}

		const g = new BufferGeometry();
		g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
		g.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
		g.setIndex( idx );
		// orient: front normal points from back face toward front face
		const c = contour[ 0 ];
		const dir = map( c.x, c.y, side ).sub( map( c.x, c.y, 1 - side ) );
		orientTowards( g, dir );
		g.computeVertexNormals();
		// vertices left without triangles get the face direction
		const nrm = g.attributes.normal;
		dir.normalize();
		for ( let i = 0; i < nrm.count; i ++ ) {

			if ( Math.hypot( nrm.getX( i ), nrm.getY( i ), nrm.getZ( i ) ) < 0.5 ) nrm.setXYZ( i, dir.x, dir.y, dir.z );

		}

		return g;

	};

	if ( front ) parts.push( faceGeo( 0 ) );
	if ( back ) parts.push( faceGeo( 1 ) );

	if ( edges ) {

		const pos = [], uvs = [], idx = [];
		const loops = [ contour, ...holeVs ];
		const a0 = new Vector3(), a1 = new Vector3(), b0 = new Vector3(), b1 = new Vector3();
		const n = new Vector3(), out = new Vector3();
		for ( const loop of loops ) {

			let len = 0;
			for ( let i = 0; i < loop.length; i ++ ) {

				const p = loop[ i ], q = loop[ ( i + 1 ) % loop.length ];
				const el = p.distanceTo( q );
				if ( el < 1e-6 ) continue;
				a0.copy( map( p.x, p.y, 0 ) ); a1.copy( map( p.x, p.y, 1 ) );
				b0.copy( map( q.x, q.y, 0 ) ); b1.copy( map( q.x, q.y, 1 ) );
				const th = a0.distanceTo( a1 );
				const base = pos.length / 3;
				pos.push( a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z );
				uvs.push( len, 0, len + el, 0, len + el, th, len, th );
				len += el;
				// outward direction: right-hand side of the edge for CCW outline / CW holes
				const mx = ( p.x + q.x ) / 2, my = ( p.y + q.y ) / 2;
				const ox = ( q.y - p.y ) / el * 0.01, oy = - ( q.x - p.x ) / el * 0.01;
				out.copy( map( mx + ox, my + oy, 0 ) ).sub( map( mx, my, 0 ) );
				n.subVectors( b0, a0 ).cross( _v.subVectors( a1, a0 ) );
				if ( n.dot( out ) >= 0 ) idx.push( base, base + 1, base + 2, base, base + 2, base + 3 );
				else idx.push( base, base + 2, base + 1, base, base + 3, base + 2 );

			}

		}

		if ( pos.length ) {

			const g = new BufferGeometry();
			g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
			g.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
			g.setIndex( idx );
			g.computeVertexNormals();
			parts.push( g );

		}

	}

	return parts.length === 1 ? parts[ 0 ] : mergeGeometries( parts, false );

}

// Loft of profile loops/strips: profiles[i] = array of Vector3 (same length).
// `closed` joins the last profile point to the first (duplicating the seam so UVs
// stay continuous; seam normals are averaged).
export function loft( profiles, { closed = false, flip = false } = {} ) {

	const rows = closed ? profiles.map( ( r ) => [ ...r, r[ 0 ].clone() ] ) : profiles;
	const g = gridSurface( rows, { flip } );
	if ( closed ) {

		const nj = rows[ 0 ].length;
		const nrm = g.attributes.normal;
		const a = new Vector3(), b = new Vector3();
		for ( let i = 0; i < rows.length; i ++ ) {

			const i0 = i * nj, i1 = i * nj + nj - 1;
			a.fromBufferAttribute( nrm, i0 ); b.fromBufferAttribute( nrm, i1 );
			a.add( b ).normalize();
			nrm.setXYZ( i0, a.x, a.y, a.z ); nrm.setXYZ( i1, a.x, a.y, a.z );

		}

	}

	return g;

}

// Assign per-vertex colors with a function of the vertex position.
export function paintVertices( g, fn ) {

	const p = g.attributes.position;
	const arr = new Float32Array( p.count * 3 );
	const v = new Vector3();
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		const c = linearColor( fn( v, i ) );
		arr[ i * 3 ] = c.r; arr[ i * 3 + 1 ] = c.g; arr[ i * 3 + 2 ] = c.b;

	}

	g.setAttribute( 'color', new Float32BufferAttribute( arr, 3 ) );
	return g;

}

// Per-vertex aux attribute with a function returning [rough, metal, pattern, anim].
export function auxVertices( g, fn ) {

	const p = g.attributes.position;
	const arr = new Float32Array( p.count * 4 );
	const v = new Vector3();
	for ( let i = 0; i < p.count; i ++ ) {

		v.fromBufferAttribute( p, i );
		const a = fn( v, i );
		arr[ i * 4 ] = a[ 0 ]; arr[ i * 4 + 1 ] = a[ 1 ]; arr[ i * 4 + 2 ] = a[ 2 ]; arr[ i * 4 + 3 ] = a[ 3 ];

	}

	g.setAttribute( 'aux', new Float32BufferAttribute( arr, 4 ) );
	return g;

}

export function triangleCount( g ) {

	return g.index ? g.index.count / 3 : g.attributes.position.count / 3;

}
