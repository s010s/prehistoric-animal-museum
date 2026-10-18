// View frustum as six inward-facing planes (three.js Frustum-compatible).
// Defaults to this engine's convention: WebGPU clip space with reversed depth.

import { Vector3 } from './Vector3.js';
import { Sphere } from './Sphere.js';
import { Plane } from './Plane.js';
import { WebGLCoordinateSystem, WebGPUCoordinateSystem } from './Matrix4.js';

const _sphere = /*@__PURE__*/ new Sphere();
const _v = /*@__PURE__*/ new Vector3();

export class Frustum {

	constructor( p0 = new Plane(), p1 = new Plane(), p2 = new Plane(), p3 = new Plane(), p4 = new Plane(), p5 = new Plane() ) {

		this.planes = [ p0, p1, p2, p3, p4, p5 ];

	}

	set( p0, p1, p2, p3, p4, p5 ) {

		const p = this.planes;
		p[ 0 ].copy( p0 ); p[ 1 ].copy( p1 ); p[ 2 ].copy( p2 ); p[ 3 ].copy( p3 ); p[ 4 ].copy( p4 ); p[ 5 ].copy( p5 );
		return this;

	}

	copy( f ) { for ( let i = 0; i < 6; i ++ ) this.planes[ i ].copy( f.planes[ i ] ); return this; }
	clone() { return new Frustum().copy( this ); }

	// Planes: 0 left, 1 right, 2 bottom, 3 top, 4 near, 5 far.
	// With reversed depth and an infinite far plane the far plane degenerates to
	// (0, 0, 0, near) which never rejects anything.
	setFromProjectionMatrix( m, coordinateSystem = WebGPUCoordinateSystem, reversedDepth = true ) {

		const p = this.planes, e = m.elements;
		const r00 = e[ 0 ], r01 = e[ 4 ], r02 = e[ 8 ], r03 = e[ 12 ];
		const r10 = e[ 1 ], r11 = e[ 5 ], r12 = e[ 9 ], r13 = e[ 13 ];
		const r20 = e[ 2 ], r21 = e[ 6 ], r22 = e[ 10 ], r23 = e[ 14 ];
		const r30 = e[ 3 ], r31 = e[ 7 ], r32 = e[ 11 ], r33 = e[ 15 ];

		p[ 0 ].setComponents( r30 + r00, r31 + r01, r32 + r02, r33 + r03 ).normalize();
		p[ 1 ].setComponents( r30 - r00, r31 - r01, r32 - r02, r33 - r03 ).normalize();
		p[ 2 ].setComponents( r30 + r10, r31 + r11, r32 + r12, r33 + r13 ).normalize();
		p[ 3 ].setComponents( r30 - r10, r31 - r11, r32 - r12, r33 - r13 ).normalize();

		if ( reversedDepth ) {

			p[ 4 ].setComponents( r30 - r20, r31 - r21, r32 - r22, r33 - r23 ).normalize(); // z <= w
			p[ 5 ].setComponents( r20, r21, r22, r23 ).normalize(); // z >= 0

		} else if ( coordinateSystem === WebGLCoordinateSystem ) {

			p[ 4 ].setComponents( r30 + r20, r31 + r21, r32 + r22, r33 + r23 ).normalize();
			p[ 5 ].setComponents( r30 - r20, r31 - r21, r32 - r22, r33 - r23 ).normalize();

		} else {

			p[ 4 ].setComponents( r20, r21, r22, r23 ).normalize();
			p[ 5 ].setComponents( r30 - r20, r31 - r21, r32 - r22, r33 - r23 ).normalize();

		}

		return this;

	}

	intersectsObject( object ) {

		const g = object.geometry;
		if ( g.boundingSphere === null ) g.computeBoundingSphere();
		_sphere.copy( g.boundingSphere ).applyMatrix4( object.matrixWorld );
		return this.intersectsSphere( _sphere );

	}

	intersectsSphere( s ) {

		const p = this.planes, c = s.center, nr = - s.radius;
		for ( let i = 0; i < 6; i ++ ) if ( p[ i ].distanceToPoint( c ) < nr ) return false;
		return true;

	}

	intersectsBox( b ) {

		const p = this.planes;

		for ( let i = 0; i < 6; i ++ ) {

			const n = p[ i ].normal;
			_v.x = n.x > 0 ? b.max.x : b.min.x;
			_v.y = n.y > 0 ? b.max.y : b.min.y;
			_v.z = n.z > 0 ? b.max.z : b.min.z;
			if ( p[ i ].distanceToPoint( _v ) < 0 ) return false;

		}

		return true;

	}

	containsPoint( pt ) {

		for ( let i = 0; i < 6; i ++ ) if ( this.planes[ i ].distanceToPoint( pt ) < 0 ) return false;
		return true;

	}

}
