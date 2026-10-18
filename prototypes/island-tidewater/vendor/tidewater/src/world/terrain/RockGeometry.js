import * as THREE from '../../engine/index.js';
import { hash2 } from './TerrainNoise.js';

// Procedural rock meshes: an icosphere carved by a handful of random planes (fracture facets),
// blended with an ellipsoid and roughened by 3D noise. The same shape function is evaluated
// on every LOD so silhouettes stay consistent. A per-vertex cavity term is baked into the
// 'ao' attribute.

// ---- small 3D gradient noise (value hashed on the integer lattice)
function hash3( i, j, k, s ) {

	return hash2( i * 73 + k * 19349663, j * 31 + k * 83492791, s );

}

function noise3( x, y, z, s ) {

	const xi = Math.floor( x ), yi = Math.floor( y ), zi = Math.floor( z );
	const xf = x - xi, yf = y - yi, zf = z - zi;
	const u = xf * xf * ( 3 - 2 * xf ), v = yf * yf * ( 3 - 2 * yf ), w = zf * zf * ( 3 - 2 * zf );
	const c = ( a, b, d ) => hash3( xi + a, yi + b, zi + d, s );
	const x00 = c( 0, 0, 0 ) + ( c( 1, 0, 0 ) - c( 0, 0, 0 ) ) * u;
	const x10 = c( 0, 1, 0 ) + ( c( 1, 1, 0 ) - c( 0, 1, 0 ) ) * u;
	const x01 = c( 0, 0, 1 ) + ( c( 1, 0, 1 ) - c( 0, 0, 1 ) ) * u;
	const x11 = c( 0, 1, 1 ) + ( c( 1, 1, 1 ) - c( 0, 1, 1 ) ) * u;
	const y0 = x00 + ( x10 - x00 ) * v, y1 = x01 + ( x11 - x01 ) * v;
	return ( y0 + ( y1 - y0 ) * w ) * 2 - 1;

}

function fbm3( x, y, z, oct, s ) {

	let a = 1, f = 1, sum = 0, n = 0;
	for ( let o = 0; o < oct; o ++ ) {

		sum += noise3( x * f, y * f, z * f, s + o * 7 ) * a;
		n += a;
		a *= 0.5;
		f *= 2.03;

	}

	return sum / n;

}

// ---- icosphere (indexed, shared vertices)
function icosphere( subdiv ) {

	const t = ( 1 + Math.sqrt( 5 ) ) / 2;
	let verts = [ - 1, t, 0, 1, t, 0, - 1, - t, 0, 1, - t, 0, 0, - 1, t, 0, 1, t, 0, - 1, - t, 0, 1, - t, t, 0, - 1, t, 0, 1, - t, 0, - 1, - t, 0, 1 ];
	let faces = [ 0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1 ];
	const norm = ( i ) => {

		const l = Math.hypot( verts[ i * 3 ], verts[ i * 3 + 1 ], verts[ i * 3 + 2 ] );
		verts[ i * 3 ] /= l; verts[ i * 3 + 1 ] /= l; verts[ i * 3 + 2 ] /= l;

	};

	for ( let i = 0; i < verts.length / 3; i ++ ) norm( i );
	for ( let s = 0; s < subdiv; s ++ ) {

		const cache = new Map();
		const mid = ( a, b ) => {

			const key = a < b ? a * 100000 + b : b * 100000 + a;
			let m = cache.get( key );
			if ( m !== undefined ) return m;
			m = verts.length / 3;
			verts.push( ( verts[ a * 3 ] + verts[ b * 3 ] ) / 2, ( verts[ a * 3 + 1 ] + verts[ b * 3 + 1 ] ) / 2, ( verts[ a * 3 + 2 ] + verts[ b * 3 + 2 ] ) / 2 );
			norm( m );
			cache.set( key, m );
			return m;

		};

		const nf = [];
		for ( let f = 0; f < faces.length; f += 3 ) {

			const a = faces[ f ], b = faces[ f + 1 ], c = faces[ f + 2 ];
			const ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
			nf.push( a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca );

		}

		faces = nf;

	}

	return { verts: new Float32Array( verts ), faces };

}

// Rock styles: ellipsoid proportions, number of fracture planes, facet sharpness, roughness
export const ROCK_STYLES = [
	{ name: 'boulder', scale: [ 1.0, 0.8, 0.9 ], planes: 10, cut: [ 0.62, 0.88 ], soft: 0.08, rough: 0.06 },
	{ name: 'block', scale: [ 1.1, 0.9, 0.95 ], planes: 13, cut: [ 0.58, 0.8 ], soft: 0.04, rough: 0.045 },
	{ name: 'slab', scale: [ 1.35, 0.55, 1.0 ], planes: 11, cut: [ 0.6, 0.86 ], soft: 0.05, rough: 0.045 },
	{ name: 'spire', scale: [ 0.75, 1.45, 0.8 ], planes: 12, cut: [ 0.58, 0.84 ], soft: 0.05, rough: 0.05 },
];

// radius of the rock surface along unit direction (x, y, z)
function makeShape( style, seed ) {

	const planes = [];
	for ( let i = 0; i < style.planes; i ++ ) {

		// fracture planes: random normals, biased toward the sides (rocks break in slabs)
		const a = hash2( seed, i, 1 ) * Math.PI * 2;
		const y = ( hash2( seed, i, 2 ) * 2 - 1 ) * 0.85;
		const r = Math.sqrt( 1 - y * y );
		const d = style.cut[ 0 ] + ( style.cut[ 1 ] - style.cut[ 0 ] ) * hash2( seed, i, 3 );
		planes.push( [ Math.cos( a ) * r, y, Math.sin( a ) * r, d ] );

	}

	// flat-ish base so the rock sits on the ground
	planes.push( [ 0, - 1, 0, 0.62 + 0.15 * hash2( seed, 99, 4 ) ] );
	const [ sx, sy, sz ] = style.scale;
	return ( x, y, z ) => {

		let rp = 1.6;
		for ( const [ nx, ny, nz, d ] of planes ) {

			const c = x * nx + y * ny + z * nz;
			if ( c > 1e-3 ) rp = Math.min( rp, d / c );

		}

		// smooth-min with the unit sphere (rounded, weathered edges)
		const k = style.soft;
		const h = Math.max( k - Math.abs( 1 - rp ), 0 ) / k;
		let r = Math.min( 1, rp ) - h * h * k * 0.25;
		r += fbm3( x * 2.1 + seed, y * 2.1, z * 2.1, 4, seed ) * style.rough;
		r -= Math.abs( noise3( x * 5.3, y * 5.3 + seed, z * 5.3, seed + 3 ) ) * style.rough * 0.35;
		// ellipsoid proportions
		return [ x * r * sx, y * r * sy, z * r * sz ];

	};

}

export function buildRockGeometry( styleIndex, seed, subdiv ) {

	const style = ROCK_STYLES[ styleIndex ];
	const shape = makeShape( style, seed );
	const { verts, faces } = icosphere( subdiv );
	const n = verts.length / 3;
	const pos = new Float32Array( n * 3 );
	const rad = new Float32Array( n );
	for ( let i = 0; i < n; i ++ ) {

		const p = shape( verts[ i * 3 ], verts[ i * 3 + 1 ], verts[ i * 3 + 2 ] );
		pos[ i * 3 ] = p[ 0 ]; pos[ i * 3 + 1 ] = p[ 1 ]; pos[ i * 3 + 2 ] = p[ 2 ];
		rad[ i ] = Math.hypot( p[ 0 ], p[ 1 ], p[ 2 ] );

	}

	// cavity: vertices below the average of their neighbours are occluded
	const sum = new Float32Array( n ), cnt = new Uint16Array( n );
	for ( let f = 0; f < faces.length; f += 3 ) {

		for ( let e = 0; e < 3; e ++ ) {

			const a = faces[ f + e ], b = faces[ f + ( e + 1 ) % 3 ];
			sum[ a ] += rad[ b ]; cnt[ a ] ++;
			sum[ b ] += rad[ a ]; cnt[ b ] ++;

		}

	}

	const ao = new Float32Array( n );
	for ( let i = 0; i < n; i ++ ) {

		const d = sum[ i ] / cnt[ i ] - rad[ i ];
		ao[ i ] = Math.max( 0.35, Math.min( 1, 1 - d * 9 ) );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
	g.setAttribute( 'ao', new THREE.BufferAttribute( ao, 1 ) );
	g.setIndex( faces );
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;

}
