// Unit quaternion (three.js Quaternion-compatible). Setting x/y/z/w fires the
// change callback so Object3D can keep its Euler rotation in sync.

export class Quaternion {

	constructor( x = 0, y = 0, z = 0, w = 1 ) {

		this._x = x;
		this._y = y;
		this._z = z;
		this._w = w;
		this._onChangeCallback = noop;

	}

	static slerpFlat( dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t ) {

		const a = new Quaternion().fromArray( src0, srcOffset0 );
		const b = new Quaternion().fromArray( src1, srcOffset1 );
		a.slerp( b, t ).toArray( dst, dstOffset );

	}

	get x() { return this._x; }
	set x( v ) { this._x = v; this._onChangeCallback(); }
	get y() { return this._y; }
	set y( v ) { this._y = v; this._onChangeCallback(); }
	get z() { return this._z; }
	set z( v ) { this._z = v; this._onChangeCallback(); }
	get w() { return this._w; }
	set w( v ) { this._w = v; this._onChangeCallback(); }

	set( x, y, z, w ) { this._x = x; this._y = y; this._z = z; this._w = w; this._onChangeCallback(); return this; }
	clone() { return new Quaternion( this._x, this._y, this._z, this._w ); }
	copy( q ) { this._x = q.x; this._y = q.y; this._z = q.z; this._w = q.w; this._onChangeCallback(); return this; }
	identity() { return this.set( 0, 0, 0, 1 ); }

	setFromEuler( e, update = true ) {

		const x = e._x, y = e._y, z = e._z, order = e._order;
		const c1 = Math.cos( x / 2 ), c2 = Math.cos( y / 2 ), c3 = Math.cos( z / 2 );
		const s1 = Math.sin( x / 2 ), s2 = Math.sin( y / 2 ), s3 = Math.sin( z / 2 );

		// sign pattern per order: (x, y, z, w) terms of s1c2c3 / c1s2c3 / c1c2s3 / c1c2c3
		switch ( order ) {

			case 'XYZ':
				this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
			case 'YXZ':
				this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
			case 'ZXY':
				this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
			case 'ZYX':
				this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
			case 'YZX':
				this._x = s1 * c2 * c3 + c1 * s2 * s3; this._y = c1 * s2 * c3 + s1 * c2 * s3;
				this._z = c1 * c2 * s3 - s1 * s2 * c3; this._w = c1 * c2 * c3 - s1 * s2 * s3; break;
			case 'XZY':
				this._x = s1 * c2 * c3 - c1 * s2 * s3; this._y = c1 * s2 * c3 - s1 * c2 * s3;
				this._z = c1 * c2 * s3 + s1 * s2 * c3; this._w = c1 * c2 * c3 + s1 * s2 * s3; break;
			default: throw new Error( 'Quaternion.setFromEuler: unknown order ' + order );

		}

		if ( update ) this._onChangeCallback();
		return this;

	}

	setFromAxisAngle( axis, angle ) {

		const h = angle / 2, s = Math.sin( h );
		this._x = axis.x * s; this._y = axis.y * s; this._z = axis.z * s; this._w = Math.cos( h );
		this._onChangeCallback();
		return this;

	}

	setFromRotationMatrix( m ) {

		const e = m.elements;
		const m11 = e[ 0 ], m12 = e[ 4 ], m13 = e[ 8 ], m21 = e[ 1 ], m22 = e[ 5 ], m23 = e[ 9 ], m31 = e[ 2 ], m32 = e[ 6 ], m33 = e[ 10 ];
		const tr = m11 + m22 + m33;

		if ( tr > 0 ) {

			const s = 0.5 / Math.sqrt( tr + 1 );
			this._w = 0.25 / s; this._x = ( m32 - m23 ) * s; this._y = ( m13 - m31 ) * s; this._z = ( m21 - m12 ) * s;

		} else if ( m11 > m22 && m11 > m33 ) {

			const s = 2 * Math.sqrt( 1 + m11 - m22 - m33 );
			this._w = ( m32 - m23 ) / s; this._x = 0.25 * s; this._y = ( m12 + m21 ) / s; this._z = ( m13 + m31 ) / s;

		} else if ( m22 > m33 ) {

			const s = 2 * Math.sqrt( 1 + m22 - m11 - m33 );
			this._w = ( m13 - m31 ) / s; this._x = ( m12 + m21 ) / s; this._y = 0.25 * s; this._z = ( m23 + m32 ) / s;

		} else {

			const s = 2 * Math.sqrt( 1 + m33 - m11 - m22 );
			this._w = ( m21 - m12 ) / s; this._x = ( m13 + m31 ) / s; this._y = ( m23 + m32 ) / s; this._z = 0.25 * s;

		}

		this._onChangeCallback();
		return this;

	}

	setFromUnitVectors( from, to ) {

		let r = from.x * to.x + from.y * to.y + from.z * to.z + 1;

		if ( r < Number.EPSILON ) {

			// opposite vectors: rotate 180 degrees around any orthogonal axis
			r = 0;
			if ( Math.abs( from.x ) > Math.abs( from.z ) ) {

				this._x = - from.y; this._y = from.x; this._z = 0; this._w = r;

			} else {

				this._x = 0; this._y = - from.z; this._z = from.y; this._w = r;

			}

		} else {

			this._x = from.y * to.z - from.z * to.y;
			this._y = from.z * to.x - from.x * to.z;
			this._z = from.x * to.y - from.y * to.x;
			this._w = r;

		}

		return this.normalize();

	}

	angleTo( q ) { return 2 * Math.acos( Math.abs( Math.max( - 1, Math.min( 1, this.dot( q ) ) ) ) ); }

	rotateTowards( q, step ) {

		const angle = this.angleTo( q );
		if ( angle === 0 ) return this;
		return this.slerp( q, Math.min( 1, step / angle ) );

	}

	invert() { return this.conjugate(); }
	conjugate() { this._x *= - 1; this._y *= - 1; this._z *= - 1; this._onChangeCallback(); return this; }
	dot( q ) { return this._x * q._x + this._y * q._y + this._z * q._z + this._w * q._w; }
	lengthSq() { return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w; }
	length() { return Math.sqrt( this.lengthSq() ); }

	normalize() {

		let l = this.length();
		if ( l === 0 ) { this._x = 0; this._y = 0; this._z = 0; this._w = 1; } else {

			l = 1 / l;
			this._x *= l; this._y *= l; this._z *= l; this._w *= l;

		}

		this._onChangeCallback();
		return this;

	}

	multiply( q ) { return this.multiplyQuaternions( this, q ); }
	premultiply( q ) { return this.multiplyQuaternions( q, this ); }

	multiplyQuaternions( a, b ) {

		const ax = a._x, ay = a._y, az = a._z, aw = a._w, bx = b._x, by = b._y, bz = b._z, bw = b._w;
		this._x = ax * bw + aw * bx + ay * bz - az * by;
		this._y = ay * bw + aw * by + az * bx - ax * bz;
		this._z = az * bw + aw * bz + ax * by - ay * bx;
		this._w = aw * bw - ax * bx - ay * by - az * bz;
		this._onChangeCallback();
		return this;

	}

	slerp( qb, t ) {

		if ( t === 0 ) return this;
		if ( t === 1 ) return this.copy( qb );

		const x = this._x, y = this._y, z = this._z, w = this._w;
		let cosHalf = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
		let bx = qb._x, by = qb._y, bz = qb._z, bw = qb._w;
		if ( cosHalf < 0 ) { bx = - bx; by = - by; bz = - bz; bw = - bw; cosHalf = - cosHalf; }

		if ( cosHalf >= 1 ) return this;

		const sqrSin = 1 - cosHalf * cosHalf;

		if ( sqrSin <= Number.EPSILON ) {

			const s = 1 - t;
			this._w = s * w + t * bw; this._x = s * x + t * bx; this._y = s * y + t * by; this._z = s * z + t * bz;
			return this.normalize();

		}

		const sinHalf = Math.sqrt( sqrSin ), half = Math.atan2( sinHalf, cosHalf );
		const ra = Math.sin( ( 1 - t ) * half ) / sinHalf, rb = Math.sin( t * half ) / sinHalf;
		this._w = w * ra + bw * rb; this._x = x * ra + bx * rb; this._y = y * ra + by * rb; this._z = z * ra + bz * rb;
		this._onChangeCallback();
		return this;

	}

	slerpQuaternions( a, b, t ) { return this.copy( a ).slerp( b, t ); }

	random() {

		const t1 = 2 * Math.PI * Math.random(), t2 = 2 * Math.PI * Math.random();
		const u = Math.random(), s1 = Math.sqrt( 1 - u ), s2 = Math.sqrt( u );
		return this.set( s1 * Math.sin( t1 ), s1 * Math.cos( t1 ), s2 * Math.sin( t2 ), s2 * Math.cos( t2 ) );

	}

	equals( q ) { return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w; }
	fromArray( a, o = 0 ) { this._x = a[ o ]; this._y = a[ o + 1 ]; this._z = a[ o + 2 ]; this._w = a[ o + 3 ]; this._onChangeCallback(); return this; }
	toArray( a = [], o = 0 ) { a[ o ] = this._x; a[ o + 1 ] = this._y; a[ o + 2 ] = this._z; a[ o + 3 ] = this._w; return a; }
	fromBufferAttribute( attr, i ) { return this.set( attr.getX( i ), attr.getY( i ), attr.getZ( i ), attr.getW( i ) ); }
	_onChange( cb ) { this._onChangeCallback = cb; return this; }

	*[ Symbol.iterator ]() { yield this._x; yield this._y; yield this._z; yield this._w; }

}

function noop() {}

Quaternion.prototype.isQuaternion = true;
