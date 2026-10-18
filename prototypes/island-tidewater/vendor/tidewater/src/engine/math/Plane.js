// Plane n.p + constant = 0 (three.js Plane-compatible).

import { Vector3 } from './Vector3.js';
import { Matrix3 } from './Matrix3.js';

const _v1 = /*@__PURE__*/ new Vector3(), _v2 = /*@__PURE__*/ new Vector3();
const _m3 = /*@__PURE__*/ new Matrix3();

export class Plane {

	constructor( normal = new Vector3( 1, 0, 0 ), constant = 0 ) {

		this.normal = normal;
		this.constant = constant;

	}

	set( normal, constant ) { this.normal.copy( normal ); this.constant = constant; return this; }
	setComponents( x, y, z, w ) { this.normal.set( x, y, z ); this.constant = w; return this; }
	setFromNormalAndCoplanarPoint( n, p ) { this.normal.copy( n ); this.constant = - p.dot( n ); return this; }

	setFromCoplanarPoints( a, b, c ) {

		const n = _v1.subVectors( c, b ).cross( _v2.subVectors( a, b ) ).normalize();
		return this.setFromNormalAndCoplanarPoint( n, a );

	}

	copy( p ) { this.normal.copy( p.normal ); this.constant = p.constant; return this; }
	clone() { return new Plane().copy( this ); }

	normalize() {

		const l = this.normal.length();
		if ( l === 0 ) return this; // degenerate (e.g. infinite far plane): leave as-is
		const il = 1 / l;
		this.normal.multiplyScalar( il );
		this.constant *= il;
		return this;

	}

	negate() { this.constant *= - 1; this.normal.negate(); return this; }
	distanceToPoint( p ) { return this.normal.dot( p ) + this.constant; }
	distanceToSphere( s ) { return this.distanceToPoint( s.center ) - s.radius; }
	projectPoint( p, t ) { return t.copy( p ).addScaledVector( this.normal, - this.distanceToPoint( p ) ); }
	coplanarPoint( t ) { return t.copy( this.normal ).multiplyScalar( - this.constant ); }
	intersectsBox( b ) { return b.intersectsPlane( this ); }
	intersectsSphere( s ) { return s.intersectsPlane( this ); }

	applyMatrix4( m, normalMatrix ) {

		const nm = normalMatrix || _m3.getNormalMatrix( m );
		const ref = this.coplanarPoint( _v1 ).applyMatrix4( m );
		const n = this.normal.applyMatrix3( nm ).normalize();
		this.constant = - ref.dot( n );
		return this;

	}

	translate( o ) { this.constant -= o.dot( this.normal ); return this; }
	equals( p ) { return p.normal.equals( this.normal ) && p.constant === this.constant; }

}

Plane.prototype.isPlane = true;
