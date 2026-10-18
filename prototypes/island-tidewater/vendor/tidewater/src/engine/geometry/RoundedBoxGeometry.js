// Box with rounded edges and corners (three.js addons RoundedBoxGeometry-
// compatible): a non-indexed unit box with an odd segment count whose vertices
// are pushed onto an inner box offset by `radius` along a smoothed normal.

import { BoxGeometry } from './PrimitiveGeometries.js';
import { Vector3 } from '../math/Vector3.js';

const _n = new Vector3();

// UV coordinate along `uvAxis` for a face, arc-length parameterized so the
// rounded strip and the flat center share texel density.
function arcUv( faceDir, normal, uvAxis, projectionAxis, radius, sideLength ) {

	const totArc = 2 * Math.PI * radius / 4;
	const center = Math.max( sideLength - 2 * radius, 0 );
	const halfArc = Math.PI / 4;
	_n.copy( normal );
	_n[ projectionAxis ] = 0;
	_n.normalize();
	const arcUvRatio = 0.5 * totArc / ( totArc + center );
	const arcAngleRatio = 1.0 - ( _n.angleTo( faceDir ) / halfArc );
	if ( Math.sign( _n[ uvAxis ] ) === 1 ) return arcAngleRatio * arcUvRatio;
	const lenUv = center / ( totArc + center );
	return lenUv + arcUvRatio + arcUvRatio * ( 1.0 - arcAngleRatio );

}

export class RoundedBoxGeometry extends BoxGeometry {

	constructor( width = 1, height = 1, depth = 1, segments = 2, radius = 0.1 ) {

		segments = segments * 2 + 1;
		radius = Math.min( width / 2, height / 2, depth / 2, radius );
		super( 1, 1, 1, segments, segments, segments );
		this.type = 'RoundedBoxGeometry';
		this.parameters = { width, height, depth, segments, radius };

		if ( segments === 1 ) return;

		const flat = this.toNonIndexed();
		this.index = null;
		this.attributes.position = flat.attributes.position;
		this.attributes.normal = flat.attributes.normal;
		this.attributes.uv = flat.attributes.uv;

		const position = new Vector3(), normal = new Vector3(), faceDir = new Vector3();
		const box = new Vector3( width, height, depth ).divideScalar( 2 ).subScalar( radius );
		const P = this.attributes.position.array, N = this.attributes.normal.array, U = this.attributes.uv.array;
		const perFace = P.length / 3 / 6;
		const halfSeg = 0.5 / segments;

		for ( let i = 0, j = 0; i < P.length / 3; i ++, j += 3 ) {

			position.fromArray( P, j );
			normal.copy( position );
			normal.x -= Math.sign( normal.x ) * halfSeg;
			normal.y -= Math.sign( normal.y ) * halfSeg;
			normal.z -= Math.sign( normal.z ) * halfSeg;
			normal.normalize();

			P[ j ] = box.x * Math.sign( position.x ) + normal.x * radius;
			P[ j + 1 ] = box.y * Math.sign( position.y ) + normal.y * radius;
			P[ j + 2 ] = box.z * Math.sign( position.z ) + normal.z * radius;
			N[ j ] = normal.x; N[ j + 1 ] = normal.y; N[ j + 2 ] = normal.z;

			const k = i * 2;
			switch ( Math.floor( i / perFace ) ) {

				case 0: // +x
					faceDir.set( 1, 0, 0 );
					U[ k ] = arcUv( faceDir, normal, 'z', 'y', radius, depth );
					U[ k + 1 ] = 1.0 - arcUv( faceDir, normal, 'y', 'z', radius, height );
					break;
				case 1: // -x
					faceDir.set( - 1, 0, 0 );
					U[ k ] = 1.0 - arcUv( faceDir, normal, 'z', 'y', radius, depth );
					U[ k + 1 ] = 1.0 - arcUv( faceDir, normal, 'y', 'z', radius, height );
					break;
				case 2: // +y
					faceDir.set( 0, 1, 0 );
					U[ k ] = 1.0 - arcUv( faceDir, normal, 'x', 'z', radius, width );
					U[ k + 1 ] = arcUv( faceDir, normal, 'z', 'x', radius, depth );
					break;
				case 3: // -y
					faceDir.set( 0, - 1, 0 );
					U[ k ] = 1.0 - arcUv( faceDir, normal, 'x', 'z', radius, width );
					U[ k + 1 ] = 1.0 - arcUv( faceDir, normal, 'z', 'x', radius, depth );
					break;
				case 4: // +z
					faceDir.set( 0, 0, 1 );
					U[ k ] = 1.0 - arcUv( faceDir, normal, 'x', 'y', radius, width );
					U[ k + 1 ] = 1.0 - arcUv( faceDir, normal, 'y', 'x', radius, height );
					break;
				case 5: // -z
					faceDir.set( 0, 0, - 1 );
					U[ k ] = arcUv( faceDir, normal, 'x', 'y', radius, width );
					U[ k + 1 ] = 1.0 - arcUv( faceDir, normal, 'y', 'x', radius, height );
					break;

			}

		}

	}

}
