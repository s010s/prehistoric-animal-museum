// Subdivided polyhedra projected onto a sphere (three.js PolyhedronGeometry /
// IcosahedronGeometry-compatible: non-indexed, spherical UVs with seam fix-up).

import { BufferGeometry } from './BufferGeometry.js';
import { Float32BufferAttribute } from './BufferAttribute.js';
import { Vector3 } from '../math/Vector3.js';
import { Vector2 } from '../math/Vector2.js';

const azimuth = ( v ) => Math.atan2( v.z, - v.x );
const inclination = ( v ) => Math.atan2( - v.y, Math.sqrt( v.x * v.x + v.z * v.z ) );

export class PolyhedronGeometry extends BufferGeometry {

	constructor( vertices = [], indices = [], radius = 1, detail = 0 ) {

		super();
		this.type = 'PolyhedronGeometry';
		this.parameters = { vertices, indices, radius, detail };

		const vb = [], uvb = [];
		const push = ( v ) => vb.push( v.x, v.y, v.z );
		const get = ( i, v ) => v.set( vertices[ i * 3 ], vertices[ i * 3 + 1 ], vertices[ i * 3 + 2 ] );

		const subdivideFace = ( a, b, c, d ) => {

			const cols = d + 1, v = [];

			for ( let i = 0; i <= cols; i ++ ) {

				v[ i ] = [];
				const aj = a.clone().lerp( c, i / cols ), bj = b.clone().lerp( c, i / cols );
				const rows = cols - i;
				for ( let j = 0; j <= rows; j ++ ) v[ i ][ j ] = ( j === 0 && i === cols ) ? aj : aj.clone().lerp( bj, j / rows );

			}

			for ( let i = 0; i < cols; i ++ ) {

				for ( let j = 0; j < 2 * ( cols - i ) - 1; j ++ ) {

					const k = Math.floor( j / 2 );
					if ( j % 2 === 0 ) { push( v[ i ][ k + 1 ] ); push( v[ i + 1 ][ k ] ); push( v[ i ][ k ] ); } else { push( v[ i ][ k + 1 ] ); push( v[ i + 1 ][ k + 1 ] ); push( v[ i + 1 ][ k ] ); }

				}

			}

		};

		const a = new Vector3(), b = new Vector3(), c = new Vector3();
		for ( let i = 0; i < indices.length; i += 3 ) {

			get( indices[ i ], a ); get( indices[ i + 1 ], b ); get( indices[ i + 2 ], c );
			subdivideFace( a, b, c, detail );

		}

		const v = new Vector3();
		for ( let i = 0; i < vb.length; i += 3 ) {

			v.fromArray( vb, i ).normalize().multiplyScalar( radius );
			vb[ i ] = v.x; vb[ i + 1 ] = v.y; vb[ i + 2 ] = v.z;

		}

		for ( let i = 0; i < vb.length; i += 3 ) {

			v.fromArray( vb, i );
			uvb.push( azimuth( v ) / 2 / Math.PI + 0.5, 1 - ( inclination( v ) / Math.PI + 0.5 ) );

		}

		// fix UVs of vertices on the seam / poles relative to their face centroid
		const A = new Vector3(), B = new Vector3(), C = new Vector3(), cen = new Vector3();
		const uA = new Vector2(), uB = new Vector2(), uC = new Vector2();
		const fix = ( uv, j, vec, azi ) => {

			if ( azi < 0 && uv.x === 1 ) uvb[ j ] = uv.x - 1;
			if ( vec.x === 0 && vec.z === 0 ) uvb[ j ] = azi / 2 / Math.PI + 0.5;

		};

		for ( let i = 0, j = 0; i < vb.length; i += 9, j += 6 ) {

			A.fromArray( vb, i ); B.fromArray( vb, i + 3 ); C.fromArray( vb, i + 6 );
			uA.fromArray( uvb, j ); uB.fromArray( uvb, j + 2 ); uC.fromArray( uvb, j + 4 );
			cen.copy( A ).add( B ).add( C ).divideScalar( 3 );
			const azi = azimuth( cen );
			fix( uA, j, A, azi ); fix( uB, j + 2, B, azi ); fix( uC, j + 4, C, azi );

		}

		for ( let i = 0; i < uvb.length; i += 6 ) {

			const x0 = uvb[ i ], x1 = uvb[ i + 2 ], x2 = uvb[ i + 4 ];
			if ( Math.max( x0, x1, x2 ) > 0.9 && Math.min( x0, x1, x2 ) < 0.1 ) {

				if ( x0 < 0.2 ) uvb[ i ] += 1;
				if ( x1 < 0.2 ) uvb[ i + 2 ] += 1;
				if ( x2 < 0.2 ) uvb[ i + 4 ] += 1;

			}

		}

		this.setAttribute( 'position', new Float32BufferAttribute( vb, 3 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( vb.slice(), 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvb, 2 ) );
		if ( detail === 0 ) this.computeVertexNormals(); else this.normalizeNormals();

	}

}

const T = ( 1 + Math.sqrt( 5 ) ) / 2;
const ICO_V = [ - 1, T, 0, 1, T, 0, - 1, - T, 0, 1, - T, 0, 0, - 1, T, 0, 1, T, 0, - 1, - T, 0, 1, - T, T, 0, - 1, T, 0, 1, - T, 0, - 1, - T, 0, 1 ];
const ICO_I = [ 0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1 ];

export class IcosahedronGeometry extends PolyhedronGeometry {

	constructor( radius = 1, detail = 0 ) {

		super( ICO_V, ICO_I, radius, detail );
		this.type = 'IcosahedronGeometry';
		this.parameters = { radius, detail };

	}

}
