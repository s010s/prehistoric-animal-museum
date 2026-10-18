// Half-line origin + t * direction (three.js Ray-compatible subset).

import { Vector3 } from './Vector3.js';

const _v = /*@__PURE__*/ new Vector3();

export class Ray {

	constructor( origin = new Vector3(), direction = new Vector3( 0, 0, - 1 ) ) {

		this.origin = origin;
		this.direction = direction;

	}

	set( o, d ) { this.origin.copy( o ); this.direction.copy( d ); return this; }
	copy( r ) { this.origin.copy( r.origin ); this.direction.copy( r.direction ); return this; }
	clone() { return new Ray().copy( this ); }
	at( t, target ) { return target.copy( this.origin ).addScaledVector( this.direction, t ); }
	lookAt( v ) { this.direction.copy( v ).sub( this.origin ).normalize(); return this; }
	recast( t ) { this.origin.copy( this.at( t, _v ) ); return this; }

	closestPointToPoint( p, target ) {

		const t = Math.max( 0, target.subVectors( p, this.origin ).dot( this.direction ) );
		return target.copy( this.origin ).addScaledVector( this.direction, t );

	}

	distanceSqToPoint( p ) { return this.closestPointToPoint( p, _v ).distanceToSquared( p ); }
	distanceToPoint( p ) { return Math.sqrt( this.distanceSqToPoint( p ) ); }

	intersectSphere( s, target ) {

		_v.subVectors( s.center, this.origin );
		const tca = _v.dot( this.direction ), d2 = _v.dot( _v ) - tca * tca, r2 = s.radius * s.radius;
		if ( d2 > r2 ) return null;
		const thc = Math.sqrt( r2 - d2 ), t0 = tca - thc, t1 = tca + thc;
		if ( t1 < 0 ) return null;
		return this.at( t0 < 0 ? t1 : t0, target );

	}

	intersectsSphere( s ) { return this.distanceSqToPoint( s.center ) <= s.radius * s.radius; }

	distanceToPlane( pl ) {

		const den = pl.normal.dot( this.direction );
		if ( den === 0 ) return pl.distanceToPoint( this.origin ) === 0 ? 0 : null;
		const t = - ( this.origin.dot( pl.normal ) + pl.constant ) / den;
		return t >= 0 ? t : null;

	}

	intersectPlane( pl, target ) {

		const t = this.distanceToPlane( pl );
		return t === null ? null : this.at( t, target );

	}

	intersectBox( b, target ) {

		let tmin, tmax, tymin, tymax, tzmin, tzmax;
		const ix = 1 / this.direction.x, iy = 1 / this.direction.y, iz = 1 / this.direction.z, o = this.origin;
		if ( ix >= 0 ) { tmin = ( b.min.x - o.x ) * ix; tmax = ( b.max.x - o.x ) * ix; } else { tmin = ( b.max.x - o.x ) * ix; tmax = ( b.min.x - o.x ) * ix; }
		if ( iy >= 0 ) { tymin = ( b.min.y - o.y ) * iy; tymax = ( b.max.y - o.y ) * iy; } else { tymin = ( b.max.y - o.y ) * iy; tymax = ( b.min.y - o.y ) * iy; }
		if ( tmin > tymax || tymin > tmax ) return null;
		if ( tymin > tmin || isNaN( tmin ) ) tmin = tymin;
		if ( tymax < tmax || isNaN( tmax ) ) tmax = tymax;
		if ( iz >= 0 ) { tzmin = ( b.min.z - o.z ) * iz; tzmax = ( b.max.z - o.z ) * iz; } else { tzmin = ( b.max.z - o.z ) * iz; tzmax = ( b.min.z - o.z ) * iz; }
		if ( tmin > tzmax || tzmin > tmax ) return null;
		if ( tzmin > tmin || tmin !== tmin ) tmin = tzmin;
		if ( tzmax < tmax || tmax !== tmax ) tmax = tzmax;
		if ( tmax < 0 ) return null;
		return this.at( tmin >= 0 ? tmin : tmax, target );

	}

	intersectsBox( b ) { return this.intersectBox( b, _v ) !== null; }

	intersectTriangle( a, b, c, backfaceCulling, target ) {

		const e1 = new Vector3().subVectors( b, a ), e2 = new Vector3().subVectors( c, a );
		const n = new Vector3().crossVectors( e1, e2 );
		let DdN = this.direction.dot( n ), sign;
		if ( DdN > 0 ) { if ( backfaceCulling ) return null; sign = 1; } else if ( DdN < 0 ) { sign = - 1; DdN = - DdN; } else return null;
		const diff = new Vector3().subVectors( this.origin, a );
		const DdQxE2 = sign * this.direction.dot( e2.crossVectors( diff, e2 ) );
		if ( DdQxE2 < 0 ) return null;
		const DdE1xQ = sign * this.direction.dot( e1.cross( diff ) );
		if ( DdE1xQ < 0 || DdQxE2 + DdE1xQ > DdN ) return null;
		const QdN = - sign * diff.dot( n );
		if ( QdN < 0 ) return null;
		return this.at( QdN / DdN, target );

	}

	applyMatrix4( m ) {

		this.origin.applyMatrix4( m );
		this.direction.transformDirection( m );
		return this;

	}

	equals( r ) { return r.origin.equals( this.origin ) && r.direction.equals( this.direction ); }

}
