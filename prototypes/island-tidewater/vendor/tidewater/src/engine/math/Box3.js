// Axis-aligned bounding box (three.js Box3-compatible).

import { Vector3 } from './Vector3.js';

const _v = /*@__PURE__*/ new Vector3();
const _pts = /*@__PURE__*/ Array.from( { length: 8 }, () => new Vector3() );

export class Box3 {

	constructor( min = new Vector3( Infinity, Infinity, Infinity ), max = new Vector3( - Infinity, - Infinity, - Infinity ) ) {

		this.min = min;
		this.max = max;

	}

	set( min, max ) { this.min.copy( min ); this.max.copy( max ); return this; }

	setFromArray( a ) {

		this.makeEmpty();
		for ( let i = 0; i < a.length; i += 3 ) this.expandByPoint( _v.fromArray( a, i ) );
		return this;

	}

	setFromBufferAttribute( attr ) {

		this.makeEmpty();
		for ( let i = 0; i < attr.count; i ++ ) this.expandByPoint( _v.fromBufferAttribute( attr, i ) );
		return this;

	}

	setFromPoints( pts ) { this.makeEmpty(); for ( const p of pts ) this.expandByPoint( p ); return this; }

	setFromCenterAndSize( c, size ) {

		_v.copy( size ).multiplyScalar( 0.5 );
		this.min.copy( c ).sub( _v );
		this.max.copy( c ).add( _v );
		return this;

	}

	// World-space bounds of an object hierarchy (uses geometry bounding boxes).
	setFromObject( object, precise = false ) { this.makeEmpty(); return this.expandByObject( object, precise ); }

	clone() { return new Box3().copy( this ); }
	copy( b ) { this.min.copy( b.min ); this.max.copy( b.max ); return this; }

	makeEmpty() {

		this.min.x = this.min.y = this.min.z = Infinity;
		this.max.x = this.max.y = this.max.z = - Infinity;
		return this;

	}

	isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
	getCenter( t ) { return this.isEmpty() ? t.set( 0, 0, 0 ) : t.addVectors( this.min, this.max ).multiplyScalar( 0.5 ); }
	getSize( t ) { return this.isEmpty() ? t.set( 0, 0, 0 ) : t.subVectors( this.max, this.min ); }
	expandByPoint( p ) { this.min.min( p ); this.max.max( p ); return this; }
	expandByVector( v ) { this.min.sub( v ); this.max.add( v ); return this; }
	expandByScalar( s ) { this.min.addScalar( - s ); this.max.addScalar( s ); return this; }

	expandByObject( object, precise = false ) {

		object.updateWorldMatrix( false, false );
		const g = object.geometry;

		if ( g !== undefined ) {

			const pos = g.getAttribute( 'position' );
			if ( precise && pos !== undefined ) {

				for ( let i = 0; i < pos.count; i ++ ) this.expandByPoint( _v.fromBufferAttribute( pos, i ).applyMatrix4( object.matrixWorld ) );

			} else {

				if ( g.boundingBox === null ) g.computeBoundingBox();
				_box.copy( g.boundingBox ).applyMatrix4( object.matrixWorld );
				this.union( _box );

			}

		}

		for ( const c of object.children ) this.expandByObject( c, precise );
		return this;

	}

	containsPoint( p ) {

		return ! ( p.x < this.min.x || p.x > this.max.x || p.y < this.min.y || p.y > this.max.y || p.z < this.min.z || p.z > this.max.z );

	}

	containsBox( b ) {

		return this.min.x <= b.min.x && b.max.x <= this.max.x && this.min.y <= b.min.y && b.max.y <= this.max.y && this.min.z <= b.min.z && b.max.z <= this.max.z;

	}

	getParameter( p, t ) {

		return t.set( ( p.x - this.min.x ) / ( this.max.x - this.min.x ), ( p.y - this.min.y ) / ( this.max.y - this.min.y ), ( p.z - this.min.z ) / ( this.max.z - this.min.z ) );

	}

	intersectsBox( b ) {

		return ! ( b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y || b.max.z < this.min.z || b.min.z > this.max.z );

	}

	intersectsSphere( s ) {

		this.clampPoint( s.center, _v );
		return _v.distanceToSquared( s.center ) <= s.radius * s.radius;

	}

	intersectsPlane( pl ) {

		let min, max;
		const n = pl.normal;
		if ( n.x > 0 ) { min = n.x * this.min.x; max = n.x * this.max.x; } else { min = n.x * this.max.x; max = n.x * this.min.x; }
		if ( n.y > 0 ) { min += n.y * this.min.y; max += n.y * this.max.y; } else { min += n.y * this.max.y; max += n.y * this.min.y; }
		if ( n.z > 0 ) { min += n.z * this.min.z; max += n.z * this.max.z; } else { min += n.z * this.max.z; max += n.z * this.min.z; }
		return min <= - pl.constant && max >= - pl.constant;

	}

	clampPoint( p, t ) { return t.copy( p ).clamp( this.min, this.max ); }
	distanceToPoint( p ) { return this.clampPoint( p, _v ).distanceTo( p ); }

	getBoundingSphere( t ) {

		if ( this.isEmpty() ) { t.makeEmpty(); return t; }
		this.getCenter( t.center );
		t.radius = this.getSize( _v ).length() * 0.5;
		return t;

	}

	intersect( b ) { this.min.max( b.min ); this.max.min( b.max ); if ( this.isEmpty() ) this.makeEmpty(); return this; }
	union( b ) { this.min.min( b.min ); this.max.max( b.max ); return this; }

	applyMatrix4( m ) {

		if ( this.isEmpty() ) return this;
		const a = this.min, b = this.max;
		_pts[ 0 ].set( a.x, a.y, a.z ).applyMatrix4( m );
		_pts[ 1 ].set( a.x, a.y, b.z ).applyMatrix4( m );
		_pts[ 2 ].set( a.x, b.y, a.z ).applyMatrix4( m );
		_pts[ 3 ].set( a.x, b.y, b.z ).applyMatrix4( m );
		_pts[ 4 ].set( b.x, a.y, a.z ).applyMatrix4( m );
		_pts[ 5 ].set( b.x, a.y, b.z ).applyMatrix4( m );
		_pts[ 6 ].set( b.x, b.y, a.z ).applyMatrix4( m );
		_pts[ 7 ].set( b.x, b.y, b.z ).applyMatrix4( m );
		return this.setFromPoints( _pts );

	}

	translate( o ) { this.min.add( o ); this.max.add( o ); return this; }
	equals( b ) { return b.min.equals( this.min ) && b.max.equals( this.max ); }

}

Box3.prototype.isBox3 = true;

const _box = /*@__PURE__*/ new Box3();
