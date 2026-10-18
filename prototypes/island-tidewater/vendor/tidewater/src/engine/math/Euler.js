// Euler angles (three.js Euler-compatible; intrinsic rotations, default 'XYZ').

import { Matrix4 } from './Matrix4.js';
import { Quaternion } from './Quaternion.js';

const _m = /*@__PURE__*/ new Matrix4();
const _q = /*@__PURE__*/ new Quaternion();
const clamp1 = ( v ) => Math.max( - 1, Math.min( 1, v ) );

export class Euler {

	constructor( x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER ) {

		this._x = x;
		this._y = y;
		this._z = z;
		this._order = order;
		this._onChangeCallback = noop;

	}

	get x() { return this._x; }
	set x( v ) { this._x = v; this._onChangeCallback(); }
	get y() { return this._y; }
	set y( v ) { this._y = v; this._onChangeCallback(); }
	get z() { return this._z; }
	set z( v ) { this._z = v; this._onChangeCallback(); }
	get order() { return this._order; }
	set order( v ) { this._order = v; this._onChangeCallback(); }

	set( x, y, z, order = this._order ) {

		this._x = x; this._y = y; this._z = z; this._order = order;
		this._onChangeCallback();
		return this;

	}

	clone() { return new Euler( this._x, this._y, this._z, this._order ); }
	copy( e ) { return this.set( e._x, e._y, e._z, e._order ); }

	// `m` must be a pure rotation (unscaled) in its upper 3x3.
	setFromRotationMatrix( m, order = this._order, update = true ) {

		const e = m.elements;
		const m11 = e[ 0 ], m12 = e[ 4 ], m13 = e[ 8 ], m21 = e[ 1 ], m22 = e[ 5 ], m23 = e[ 9 ], m31 = e[ 2 ], m32 = e[ 6 ], m33 = e[ 10 ];
		const lim = 0.9999999;

		switch ( order ) {

			case 'XYZ':
				this._y = Math.asin( clamp1( m13 ) );
				if ( Math.abs( m13 ) < lim ) { this._x = Math.atan2( - m23, m33 ); this._z = Math.atan2( - m12, m11 ); } else { this._x = Math.atan2( m32, m22 ); this._z = 0; }
				break;
			case 'YXZ':
				this._x = Math.asin( - clamp1( m23 ) );
				if ( Math.abs( m23 ) < lim ) { this._y = Math.atan2( m13, m33 ); this._z = Math.atan2( m21, m22 ); } else { this._y = Math.atan2( - m31, m11 ); this._z = 0; }
				break;
			case 'ZXY':
				this._x = Math.asin( clamp1( m32 ) );
				if ( Math.abs( m32 ) < lim ) { this._y = Math.atan2( - m31, m33 ); this._z = Math.atan2( - m12, m22 ); } else { this._y = 0; this._z = Math.atan2( m21, m11 ); }
				break;
			case 'ZYX':
				this._y = Math.asin( - clamp1( m31 ) );
				if ( Math.abs( m31 ) < lim ) { this._x = Math.atan2( m32, m33 ); this._z = Math.atan2( m21, m11 ); } else { this._x = 0; this._z = Math.atan2( - m12, m22 ); }
				break;
			case 'YZX':
				this._z = Math.asin( clamp1( m21 ) );
				if ( Math.abs( m21 ) < lim ) { this._x = Math.atan2( - m23, m22 ); this._y = Math.atan2( - m31, m11 ); } else { this._x = 0; this._y = Math.atan2( m13, m33 ); }
				break;
			case 'XZY':
				this._z = Math.asin( - clamp1( m12 ) );
				if ( Math.abs( m12 ) < lim ) { this._x = Math.atan2( m32, m22 ); this._y = Math.atan2( m13, m11 ); } else { this._x = Math.atan2( - m23, m33 ); this._y = 0; }
				break;
			default: throw new Error( 'Euler.setFromRotationMatrix: unknown order ' + order );

		}

		this._order = order;
		if ( update ) this._onChangeCallback();
		return this;

	}

	setFromQuaternion( q, order, update ) {

		_m.makeRotationFromQuaternion( q );
		return this.setFromRotationMatrix( _m, order, update );

	}

	setFromVector3( v, order = this._order ) { return this.set( v.x, v.y, v.z, order ); }

	reorder( order ) { _q.setFromEuler( this ); return this.setFromQuaternion( _q, order ); }

	equals( e ) { return e._x === this._x && e._y === this._y && e._z === this._z && e._order === this._order; }

	fromArray( a ) {

		this._x = a[ 0 ]; this._y = a[ 1 ]; this._z = a[ 2 ];
		if ( a[ 3 ] !== undefined ) this._order = a[ 3 ];
		this._onChangeCallback();
		return this;

	}

	toArray( a = [], o = 0 ) { a[ o ] = this._x; a[ o + 1 ] = this._y; a[ o + 2 ] = this._z; a[ o + 3 ] = this._order; return a; }
	_onChange( cb ) { this._onChangeCallback = cb; return this; }

	*[ Symbol.iterator ]() { yield this._x; yield this._y; yield this._z; yield this._order; }

}

function noop() {}

Euler.DEFAULT_ORDER = 'XYZ';
Euler.prototype.isEuler = true;
