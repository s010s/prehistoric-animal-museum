// Tube swept along a curve using its Frenet frames (three.js TubeGeometry-compatible).

import { BufferGeometry } from './BufferGeometry.js';
import { Float32BufferAttribute } from './BufferAttribute.js';
import { Vector3 } from '../math/Vector3.js';

export class TubeGeometry extends BufferGeometry {

	constructor( path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false ) {

		super();
		this.type = 'TubeGeometry';
		this.parameters = { path, tubularSegments, radius, radialSegments, closed };

		const frames = path.computeFrenetFrames( tubularSegments, closed );
		this.tangents = frames.tangents;
		this.normals = frames.normals;
		this.binormals = frames.binormals;

		const vertices = [], normals = [], uvs = [], indices = [];
		const P = new Vector3(), n = new Vector3(), v3 = new Vector3();

		const segment = ( i ) => {

			path.getPointAt( i / tubularSegments, P );
			const N = frames.normals[ i ], B = frames.binormals[ i ];

			for ( let j = 0; j <= radialSegments; j ++ ) {

				const v = j / radialSegments * Math.PI * 2;
				const s = Math.sin( v ), c = - Math.cos( v );
				n.set( c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z ).normalize();
				normals.push( n.x, n.y, n.z );
				v3.copy( P ).addScaledVector( n, radius );
				vertices.push( v3.x, v3.y, v3.z );

			}

		};

		for ( let i = 0; i < tubularSegments; i ++ ) segment( i );
		segment( closed === false ? tubularSegments : 0 );

		for ( let i = 0; i <= tubularSegments; i ++ ) for ( let j = 0; j <= radialSegments; j ++ ) uvs.push( i / tubularSegments, j / radialSegments );

		for ( let j = 1; j <= tubularSegments; j ++ ) {

			for ( let i = 1; i <= radialSegments; i ++ ) {

				const r1 = radialSegments + 1;
				const a = r1 * ( j - 1 ) + ( i - 1 ), b = r1 * j + ( i - 1 ), c = r1 * j + i, d = r1 * ( j - 1 ) + i;
				indices.push( a, b, d, b, c, d );

			}

		}

		this.setIndex( indices );
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

	}

}
