// 3D vector (three.js Vector3-compatible).

import { Quaternion } from './Quaternion.js';

const _q = /*@__PURE__*/ new Quaternion();

export class Vector3 {

	constructor( x = 0, y = 0, z = 0 ) {

		this.x = x;
		this.y = y;
		this.z = z;

	}

	set( x, y, z ) { if ( z === undefined ) z = this.z; this.x = x; this.y = y; this.z = z; return this; }
	setScalar( s ) { this.x = s; this.y = s; this.z = s; return this; }
	setX( x ) { this.x = x; return this; }
	setY( y ) { this.y = y; return this; }
	setZ( z ) { this.z = z; return this; }
	setComponent( i, v ) { if ( i === 0 ) this.x = v; else if ( i === 1 ) this.y = v; else this.z = v; return this; }
	getComponent( i ) { return i === 0 ? this.x : i === 1 ? this.y : this.z; }
	clone() { return new Vector3( this.x, this.y, this.z ); }
	copy( v ) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
	add( v ) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
	addScalar( s ) { this.x += s; this.y += s; this.z += s; return this; }
	addVectors( a, b ) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
	addScaledVector( v, s ) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
	sub( v ) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
	subScalar( s ) { this.x -= s; this.y -= s; this.z -= s; return this; }
	subVectors( a, b ) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
	multiply( v ) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
	multiplyScalar( s ) { this.x *= s; this.y *= s; this.z *= s; return this; }
	multiplyVectors( a, b ) { this.x = a.x * b.x; this.y = a.y * b.y; this.z = a.z * b.z; return this; }
	divide( v ) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
	divideScalar( s ) { return this.multiplyScalar( 1 / s ); }

	applyEuler( e ) { return this.applyQuaternion( _q.setFromEuler( e ) ); }
	applyAxisAngle( axis, angle ) { return this.applyQuaternion( _q.setFromAxisAngle( axis, angle ) ); }

	applyMatrix3( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		this.x = e[ 0 ] * x + e[ 3 ] * y + e[ 6 ] * z;
		this.y = e[ 1 ] * x + e[ 4 ] * y + e[ 7 ] * z;
		this.z = e[ 2 ] * x + e[ 5 ] * y + e[ 8 ] * z;
		return this;

	}

	applyNormalMatrix( m ) { return this.applyMatrix3( m ).normalize(); }

	applyMatrix4( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		const w = 1 / ( e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ] );
		this.x = ( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] ) * w;
		this.y = ( e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ] ) * w;
		this.z = ( e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] ) * w;
		return this;

	}

	applyQuaternion( q ) {

		// v' = v + 2w(q x v) + 2 q x (q x v)
		const vx = this.x, vy = this.y, vz = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		const tx = 2 * ( qy * vz - qz * vy ), ty = 2 * ( qz * vx - qx * vz ), tz = 2 * ( qx * vy - qy * vx );
		this.x = vx + qw * tx + qy * tz - qz * ty;
		this.y = vy + qw * ty + qz * tx - qx * tz;
		this.z = vz + qw * tz + qx * ty - qy * tx;
		return this;

	}

	project( camera ) { return this.applyMatrix4( camera.matrixWorldInverse ).applyMatrix4( camera.projectionMatrix ); }
	unproject( camera ) { return this.applyMatrix4( camera.projectionMatrixInverse ).applyMatrix4( camera.matrixWorld ); }

	transformDirection( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		this.x = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z;
		this.y = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z;
		this.z = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z;
		return this.normalize();

	}

	min( v ) { this.x = Math.min( this.x, v.x ); this.y = Math.min( this.y, v.y ); this.z = Math.min( this.z, v.z ); return this; }
	max( v ) { this.x = Math.max( this.x, v.x ); this.y = Math.max( this.y, v.y ); this.z = Math.max( this.z, v.z ); return this; }

	clamp( lo, hi ) {

		this.x = Math.max( lo.x, Math.min( hi.x, this.x ) );
		this.y = Math.max( lo.y, Math.min( hi.y, this.y ) );
		this.z = Math.max( lo.z, Math.min( hi.z, this.z ) );
		return this;

	}

	clampScalar( lo, hi ) {

		this.x = Math.max( lo, Math.min( hi, this.x ) );
		this.y = Math.max( lo, Math.min( hi, this.y ) );
		this.z = Math.max( lo, Math.min( hi, this.z ) );
		return this;

	}

	clampLength( lo, hi ) {

		const l = this.length();
		return this.divideScalar( l || 1 ).multiplyScalar( Math.max( lo, Math.min( hi, l ) ) );

	}

	floor() { this.x = Math.floor( this.x ); this.y = Math.floor( this.y ); this.z = Math.floor( this.z ); return this; }
	ceil() { this.x = Math.ceil( this.x ); this.y = Math.ceil( this.y ); this.z = Math.ceil( this.z ); return this; }
	round() { this.x = Math.round( this.x ); this.y = Math.round( this.y ); this.z = Math.round( this.z ); return this; }
	roundToZero() { this.x = Math.trunc( this.x ); this.y = Math.trunc( this.y ); this.z = Math.trunc( this.z ); return this; }
	negate() { this.x = - this.x; this.y = - this.y; this.z = - this.z; return this; }
	dot( v ) { return this.x * v.x + this.y * v.y + this.z * v.z; }
	lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
	length() { return Math.sqrt( this.x * this.x + this.y * this.y + this.z * this.z ); }
	manhattanLength() { return Math.abs( this.x ) + Math.abs( this.y ) + Math.abs( this.z ); }
	normalize() { return this.divideScalar( this.length() || 1 ); }
	setLength( l ) { return this.normalize().multiplyScalar( l ); }
	lerp( v, a ) { this.x += ( v.x - this.x ) * a; this.y += ( v.y - this.y ) * a; this.z += ( v.z - this.z ) * a; return this; }

	lerpVectors( a, b, t ) {

		this.x = a.x + ( b.x - a.x ) * t;
		this.y = a.y + ( b.y - a.y ) * t;
		this.z = a.z + ( b.z - a.z ) * t;
		return this;

	}

	cross( v ) { return this.crossVectors( this, v ); }

	crossVectors( a, b ) {

		const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
		this.x = ay * bz - az * by;
		this.y = az * bx - ax * bz;
		this.z = ax * by - ay * bx;
		return this;

	}

	projectOnVector( v ) {

		const d = v.lengthSq();
		if ( d === 0 ) return this.set( 0, 0, 0 );
		const s = v.dot( this ) / d;
		return this.copy( v ).multiplyScalar( s );

	}

	projectOnPlane( n ) {

		const d = this.dot( n ) / ( n.lengthSq() || 1 );
		return this.addScaledVector( n, - d );

	}

	reflect( n ) { return this.addScaledVector( n, - 2 * this.dot( n ) ); }

	angleTo( v ) {

		const d = Math.sqrt( this.lengthSq() * v.lengthSq() );
		if ( d === 0 ) return Math.PI / 2;
		return Math.acos( Math.max( - 1, Math.min( 1, this.dot( v ) / d ) ) );

	}

	distanceTo( v ) { return Math.sqrt( this.distanceToSquared( v ) ); }
	distanceToSquared( v ) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
	manhattanDistanceTo( v ) { return Math.abs( this.x - v.x ) + Math.abs( this.y - v.y ) + Math.abs( this.z - v.z ); }

	setFromSpherical( s ) { return this.setFromSphericalCoords( s.radius, s.phi, s.theta ); }

	setFromSphericalCoords( r, phi, theta ) {

		const sp = Math.sin( phi ) * r;
		this.x = sp * Math.sin( theta );
		this.y = Math.cos( phi ) * r;
		this.z = sp * Math.cos( theta );
		return this;

	}

	setFromCylindricalCoords( r, theta, y ) { this.x = r * Math.sin( theta ); this.y = y; this.z = r * Math.cos( theta ); return this; }
	setFromMatrixPosition( m ) { const e = m.elements; this.x = e[ 12 ]; this.y = e[ 13 ]; this.z = e[ 14 ]; return this; }

	setFromMatrixScale( m ) {

		const sx = this.setFromMatrixColumn( m, 0 ).length();
		const sy = this.setFromMatrixColumn( m, 1 ).length();
		const sz = this.setFromMatrixColumn( m, 2 ).length();
		return this.set( sx, sy, sz );

	}

	setFromMatrixColumn( m, i ) { return this.fromArray( m.elements, i * 4 ); }
	setFromMatrix3Column( m, i ) { return this.fromArray( m.elements, i * 3 ); }
	setFromEuler( e ) { this.x = e._x; this.y = e._y; this.z = e._z; return this; }
	setFromColor( c ) { this.x = c.r; this.y = c.g; this.z = c.b; return this; }
	equals( v ) { return v.x === this.x && v.y === this.y && v.z === this.z; }
	fromArray( a, o = 0 ) { this.x = a[ o ]; this.y = a[ o + 1 ]; this.z = a[ o + 2 ]; return this; }
	toArray( a = [], o = 0 ) { a[ o ] = this.x; a[ o + 1 ] = this.y; a[ o + 2 ] = this.z; return a; }
	fromBufferAttribute( attr, i ) { this.x = attr.getX( i ); this.y = attr.getY( i ); this.z = attr.getZ( i ); return this; }
	random() { this.x = Math.random(); this.y = Math.random(); this.z = Math.random(); return this; }

	randomDirection() {

		const t = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, c = Math.sqrt( 1 - u * u );
		this.x = c * Math.cos( t ); this.y = u; this.z = c * Math.sin( t );
		return this;

	}

	*[ Symbol.iterator ]() { yield this.x; yield this.y; yield this.z; }

}

Vector3.prototype.isVector3 = true;
