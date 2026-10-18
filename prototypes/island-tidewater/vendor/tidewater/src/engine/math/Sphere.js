// Bounding sphere (three.js Sphere-compatible).

import { Vector3 } from './Vector3.js';
import { Box3 } from './Box3.js';

const _box = /*@__PURE__*/ new Box3();
const _v = /*@__PURE__*/ new Vector3();

export class Sphere {

	constructor( center = new Vector3(), radius = - 1 ) {

		this.center = center;
		this.radius = radius;

	}

	set( center, radius ) { this.center.copy( center ); this.radius = radius; return this; }

	setFromPoints( pts, optionalCenter ) {

		if ( optionalCenter !== undefined ) this.center.copy( optionalCenter );
		else _box.setFromPoints( pts ).getCenter( this.center );
		let r2 = 0;
		for ( const p of pts ) r2 = Math.max( r2, this.center.distanceToSquared( p ) );
		this.radius = Math.sqrt( r2 );
		return this;

	}

	copy( s ) { this.center.copy( s.center ); this.radius = s.radius; return this; }
	clone() { return new Sphere().copy( this ); }
	isEmpty() { return this.radius < 0; }
	makeEmpty() { this.center.set( 0, 0, 0 ); this.radius = - 1; return this; }
	containsPoint( p ) { return p.distanceToSquared( this.center ) <= this.radius * this.radius; }
	distanceToPoint( p ) { return p.distanceTo( this.center ) - this.radius; }

	intersectsSphere( s ) {

		const r = this.radius + s.radius;
		return s.center.distanceToSquared( this.center ) <= r * r;

	}

	intersectsBox( b ) { return b.intersectsSphere( this ); }
	intersectsPlane( p ) { return Math.abs( p.distanceToPoint( this.center ) ) <= this.radius; }

	clampPoint( p, t ) {

		const d2 = this.center.distanceToSquared( p );
		t.copy( p );
		if ( d2 > this.radius * this.radius ) t.sub( this.center ).normalize().multiplyScalar( this.radius ).add( this.center );
		return t;

	}

	getBoundingBox( t ) {

		if ( this.isEmpty() ) return t.makeEmpty();
		t.set( this.center, this.center );
		return t.expandByScalar( this.radius );

	}

	applyMatrix4( m ) {

		this.center.applyMatrix4( m );
		this.radius *= m.getMaxScaleOnAxis();
		return this;

	}

	translate( o ) { this.center.add( o ); return this; }

	expandByPoint( p ) {

		if ( this.isEmpty() ) { this.center.copy( p ); this.radius = 0; return this; }
		_v.subVectors( p, this.center );
		const l2 = _v.lengthSq();

		if ( l2 > this.radius * this.radius ) {

			const l = Math.sqrt( l2 ), delta = ( l - this.radius ) * 0.5;
			this.center.addScaledVector( _v, delta / l );
			this.radius += delta;

		}

		return this;

	}

	union( s ) {

		if ( s.isEmpty() ) return this;
		if ( this.isEmpty() ) return this.copy( s );
		const d = this.center.distanceTo( s.center );
		if ( d + s.radius <= this.radius ) return this;
		if ( d + this.radius <= s.radius ) return this.copy( s );
		const r = ( d + this.radius + s.radius ) * 0.5;
		this.center.lerp( s.center, ( r - this.radius ) / d );
		this.radius = r;
		return this;

	}

	equals( s ) { return s.center.equals( this.center ) && s.radius === this.radius; }

}

Sphere.prototype.isSphere = true;
