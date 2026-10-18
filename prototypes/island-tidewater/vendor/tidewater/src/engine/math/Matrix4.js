// 4x4 matrix, column-major `elements` (three.js Matrix4-compatible).
// Projection helpers target WebGPU clip space (z in [0, 1]) and default to
// reversed depth (near -> 1, far -> 0).

import { Vector3 } from './Vector3.js';
import { Quaternion } from './Quaternion.js';

export const WebGLCoordinateSystem = 2000;
export const WebGPUCoordinateSystem = 2001;

const _v1 = /*@__PURE__*/ new Vector3();
const _x = /*@__PURE__*/ new Vector3(), _y = /*@__PURE__*/ new Vector3(), _z = /*@__PURE__*/ new Vector3();
const _q = /*@__PURE__*/ new Quaternion();
const _one = /*@__PURE__*/ new Vector3( 1, 1, 1 ), _zero = /*@__PURE__*/ new Vector3();

export class Matrix4 {

	constructor( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

		this.elements = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
		if ( n11 !== undefined ) this.set( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 );

	}

	// row-major arguments
	set( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

		const e = this.elements;
		e[ 0 ] = n11; e[ 4 ] = n12; e[ 8 ] = n13; e[ 12 ] = n14;
		e[ 1 ] = n21; e[ 5 ] = n22; e[ 9 ] = n23; e[ 13 ] = n24;
		e[ 2 ] = n31; e[ 6 ] = n32; e[ 10 ] = n33; e[ 14 ] = n34;
		e[ 3 ] = n41; e[ 7 ] = n42; e[ 11 ] = n43; e[ 15 ] = n44;
		return this;

	}

	identity() { return this.set( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ); }
	clone() { return new Matrix4().fromArray( this.elements ); }
	copy( m ) { const e = this.elements, s = m.elements; for ( let i = 0; i < 16; i ++ ) e[ i ] = s[ i ]; return this; }
	copyPosition( m ) { const e = this.elements, s = m.elements; e[ 12 ] = s[ 12 ]; e[ 13 ] = s[ 13 ]; e[ 14 ] = s[ 14 ]; return this; }

	setFromMatrix3( m ) {

		const e = m.elements;
		return this.set( e[ 0 ], e[ 3 ], e[ 6 ], 0, e[ 1 ], e[ 4 ], e[ 7 ], 0, e[ 2 ], e[ 5 ], e[ 8 ], 0, 0, 0, 0, 1 );

	}

	extractBasis( x, y, z ) {

		x.setFromMatrixColumn( this, 0 ); y.setFromMatrixColumn( this, 1 ); z.setFromMatrixColumn( this, 2 );
		return this;

	}

	makeBasis( x, y, z ) { return this.set( x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1 ); }

	extractRotation( m ) {

		const e = this.elements, me = m.elements;
		const sx = 1 / _v1.setFromMatrixColumn( m, 0 ).length();
		const sy = 1 / _v1.setFromMatrixColumn( m, 1 ).length();
		const sz = 1 / _v1.setFromMatrixColumn( m, 2 ).length();
		e[ 0 ] = me[ 0 ] * sx; e[ 1 ] = me[ 1 ] * sx; e[ 2 ] = me[ 2 ] * sx; e[ 3 ] = 0;
		e[ 4 ] = me[ 4 ] * sy; e[ 5 ] = me[ 5 ] * sy; e[ 6 ] = me[ 6 ] * sy; e[ 7 ] = 0;
		e[ 8 ] = me[ 8 ] * sz; e[ 9 ] = me[ 9 ] * sz; e[ 10 ] = me[ 10 ] * sz; e[ 11 ] = 0;
		e[ 12 ] = 0; e[ 13 ] = 0; e[ 14 ] = 0; e[ 15 ] = 1;
		return this;

	}

	makeRotationFromEuler( e ) { return this.compose( _zero, _q.setFromEuler( e, false ), _one ); }
	makeRotationFromQuaternion( q ) { return this.compose( _zero, q, _one ); }

	// Rotation so that local +Z points from `target` toward `eye` (three.js convention).
	lookAt( eye, target, up ) {

		const e = this.elements;
		_z.subVectors( eye, target );
		if ( _z.lengthSq() === 0 ) _z.z = 1;
		_z.normalize();
		_x.crossVectors( up, _z );

		if ( _x.lengthSq() === 0 ) {

			if ( Math.abs( up.z ) === 1 ) _z.x += 0.0001; else _z.z += 0.0001;
			_z.normalize();
			_x.crossVectors( up, _z );

		}

		_x.normalize();
		_y.crossVectors( _z, _x );
		e[ 0 ] = _x.x; e[ 4 ] = _y.x; e[ 8 ] = _z.x;
		e[ 1 ] = _x.y; e[ 5 ] = _y.y; e[ 9 ] = _z.y;
		e[ 2 ] = _x.z; e[ 6 ] = _y.z; e[ 10 ] = _z.z;
		return this;

	}

	multiply( m ) { return this.multiplyMatrices( this, m ); }
	premultiply( m ) { return this.multiplyMatrices( m, this ); }

	multiplyMatrices( a, b ) {

		const ae = a.elements, be = b.elements, te = this.elements;
		const a11 = ae[ 0 ], a12 = ae[ 4 ], a13 = ae[ 8 ], a14 = ae[ 12 ];
		const a21 = ae[ 1 ], a22 = ae[ 5 ], a23 = ae[ 9 ], a24 = ae[ 13 ];
		const a31 = ae[ 2 ], a32 = ae[ 6 ], a33 = ae[ 10 ], a34 = ae[ 14 ];
		const a41 = ae[ 3 ], a42 = ae[ 7 ], a43 = ae[ 11 ], a44 = ae[ 15 ];
		const b11 = be[ 0 ], b12 = be[ 4 ], b13 = be[ 8 ], b14 = be[ 12 ];
		const b21 = be[ 1 ], b22 = be[ 5 ], b23 = be[ 9 ], b24 = be[ 13 ];
		const b31 = be[ 2 ], b32 = be[ 6 ], b33 = be[ 10 ], b34 = be[ 14 ];
		const b41 = be[ 3 ], b42 = be[ 7 ], b43 = be[ 11 ], b44 = be[ 15 ];

		te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
		te[ 4 ] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
		te[ 8 ] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
		te[ 12 ] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
		te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
		te[ 5 ] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
		te[ 9 ] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
		te[ 13 ] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
		te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
		te[ 6 ] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
		te[ 10 ] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
		te[ 14 ] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
		te[ 3 ] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
		te[ 7 ] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
		te[ 11 ] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
		te[ 15 ] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
		return this;

	}

	multiplyScalar( s ) { const e = this.elements; for ( let i = 0; i < 16; i ++ ) e[ i ] *= s; return this; }

	determinant() {

		const e = this.elements;
		const n11 = e[ 0 ], n12 = e[ 4 ], n13 = e[ 8 ], n14 = e[ 12 ];
		const n21 = e[ 1 ], n22 = e[ 5 ], n23 = e[ 9 ], n24 = e[ 13 ];
		const n31 = e[ 2 ], n32 = e[ 6 ], n33 = e[ 10 ], n34 = e[ 14 ];
		const n41 = e[ 3 ], n42 = e[ 7 ], n43 = e[ 11 ], n44 = e[ 15 ];
		const s0 = n33 * n44 - n34 * n43, s1 = n32 * n44 - n34 * n42, s2 = n32 * n43 - n33 * n42;
		const s3 = n31 * n44 - n34 * n41, s4 = n31 * n43 - n33 * n41, s5 = n31 * n42 - n32 * n41;
		return n11 * ( n22 * s0 - n23 * s1 + n24 * s2 ) -
			n12 * ( n21 * s0 - n23 * s3 + n24 * s4 ) +
			n13 * ( n21 * s1 - n22 * s3 + n24 * s5 ) -
			n14 * ( n21 * s2 - n22 * s4 + n23 * s5 );

	}

	transpose() {

		const e = this.elements;
		let t;
		t = e[ 1 ]; e[ 1 ] = e[ 4 ]; e[ 4 ] = t;
		t = e[ 2 ]; e[ 2 ] = e[ 8 ]; e[ 8 ] = t;
		t = e[ 6 ]; e[ 6 ] = e[ 9 ]; e[ 9 ] = t;
		t = e[ 3 ]; e[ 3 ] = e[ 12 ]; e[ 12 ] = t;
		t = e[ 7 ]; e[ 7 ] = e[ 13 ]; e[ 13 ] = t;
		t = e[ 11 ]; e[ 11 ] = e[ 14 ]; e[ 14 ] = t;
		return this;

	}

	setPosition( x, y, z ) {

		const e = this.elements;
		if ( x.isVector3 ) { e[ 12 ] = x.x; e[ 13 ] = x.y; e[ 14 ] = x.z; } else { e[ 12 ] = x; e[ 13 ] = y; e[ 14 ] = z; }
		return this;

	}

	invert() {

		// cofactor expansion via 2x2 sub-determinants
		const m = this.elements;
		const a00 = m[ 0 ], a01 = m[ 1 ], a02 = m[ 2 ], a03 = m[ 3 ];
		const a10 = m[ 4 ], a11 = m[ 5 ], a12 = m[ 6 ], a13 = m[ 7 ];
		const a20 = m[ 8 ], a21 = m[ 9 ], a22 = m[ 10 ], a23 = m[ 11 ];
		const a30 = m[ 12 ], a31 = m[ 13 ], a32 = m[ 14 ], a33 = m[ 15 ];
		const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
		const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
		const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
		const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
		const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
		if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 );
		const id = 1 / det;
		m[ 0 ] = ( a11 * b11 - a12 * b10 + a13 * b09 ) * id;
		m[ 1 ] = ( a02 * b10 - a01 * b11 - a03 * b09 ) * id;
		m[ 2 ] = ( a31 * b05 - a32 * b04 + a33 * b03 ) * id;
		m[ 3 ] = ( a22 * b04 - a21 * b05 - a23 * b03 ) * id;
		m[ 4 ] = ( a12 * b08 - a10 * b11 - a13 * b07 ) * id;
		m[ 5 ] = ( a00 * b11 - a02 * b08 + a03 * b07 ) * id;
		m[ 6 ] = ( a32 * b02 - a30 * b05 - a33 * b01 ) * id;
		m[ 7 ] = ( a20 * b05 - a22 * b02 + a23 * b01 ) * id;
		m[ 8 ] = ( a10 * b10 - a11 * b08 + a13 * b06 ) * id;
		m[ 9 ] = ( a01 * b08 - a00 * b10 - a03 * b06 ) * id;
		m[ 10 ] = ( a30 * b04 - a31 * b02 + a33 * b00 ) * id;
		m[ 11 ] = ( a21 * b02 - a20 * b04 - a23 * b00 ) * id;
		m[ 12 ] = ( a11 * b07 - a10 * b09 - a12 * b06 ) * id;
		m[ 13 ] = ( a00 * b09 - a01 * b07 + a02 * b06 ) * id;
		m[ 14 ] = ( a31 * b01 - a30 * b03 - a32 * b00 ) * id;
		m[ 15 ] = ( a20 * b03 - a21 * b01 + a22 * b00 ) * id;
		return this;

	}

	scale( v ) {

		const e = this.elements;
		e[ 0 ] *= v.x; e[ 4 ] *= v.y; e[ 8 ] *= v.z;
		e[ 1 ] *= v.x; e[ 5 ] *= v.y; e[ 9 ] *= v.z;
		e[ 2 ] *= v.x; e[ 6 ] *= v.y; e[ 10 ] *= v.z;
		e[ 3 ] *= v.x; e[ 7 ] *= v.y; e[ 11 ] *= v.z;
		return this;

	}

	getMaxScaleOnAxis() {

		const e = this.elements;
		const x = e[ 0 ] * e[ 0 ] + e[ 1 ] * e[ 1 ] + e[ 2 ] * e[ 2 ];
		const y = e[ 4 ] * e[ 4 ] + e[ 5 ] * e[ 5 ] + e[ 6 ] * e[ 6 ];
		const z = e[ 8 ] * e[ 8 ] + e[ 9 ] * e[ 9 ] + e[ 10 ] * e[ 10 ];
		return Math.sqrt( Math.max( x, y, z ) );

	}

	makeTranslation( x, y, z ) {

		if ( x.isVector3 ) return this.set( 1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1 );
		return this.set( 1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1 );

	}

	makeRotationX( t ) { const c = Math.cos( t ), s = Math.sin( t ); return this.set( 1, 0, 0, 0, 0, c, - s, 0, 0, s, c, 0, 0, 0, 0, 1 ); }
	makeRotationY( t ) { const c = Math.cos( t ), s = Math.sin( t ); return this.set( c, 0, s, 0, 0, 1, 0, 0, - s, 0, c, 0, 0, 0, 0, 1 ); }
	makeRotationZ( t ) { const c = Math.cos( t ), s = Math.sin( t ); return this.set( c, - s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ); }

	makeRotationAxis( axis, angle ) {

		const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;
		const x = axis.x, y = axis.y, z = axis.z, tx = t * x, ty = t * y;
		return this.set(
			tx * x + c, tx * y - s * z, tx * z + s * y, 0,
			tx * y + s * z, ty * y + c, ty * z - s * x, 0,
			tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
			0, 0, 0, 1
		);

	}

	makeScale( x, y, z ) { return this.set( x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1 ); }

	makeShear( xy, xz, yx, yz, zx, zy ) {

		return this.set( 1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1 );

	}

	compose( position, quaternion, scale ) {

		const e = this.elements;
		const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		const sx = scale.x, sy = scale.y, sz = scale.z;
		e[ 0 ] = ( 1 - ( yy + zz ) ) * sx; e[ 1 ] = ( xy + wz ) * sx; e[ 2 ] = ( xz - wy ) * sx; e[ 3 ] = 0;
		e[ 4 ] = ( xy - wz ) * sy; e[ 5 ] = ( 1 - ( xx + zz ) ) * sy; e[ 6 ] = ( yz + wx ) * sy; e[ 7 ] = 0;
		e[ 8 ] = ( xz + wy ) * sz; e[ 9 ] = ( yz - wx ) * sz; e[ 10 ] = ( 1 - ( xx + yy ) ) * sz; e[ 11 ] = 0;
		e[ 12 ] = position.x; e[ 13 ] = position.y; e[ 14 ] = position.z; e[ 15 ] = 1;
		return this;

	}

	decompose( position, quaternion, scale ) {

		const e = this.elements;
		let sx = Math.hypot( e[ 0 ], e[ 1 ], e[ 2 ] );
		const sy = Math.hypot( e[ 4 ], e[ 5 ], e[ 6 ] );
		const sz = Math.hypot( e[ 8 ], e[ 9 ], e[ 10 ] );
		if ( this.determinant() < 0 ) sx = - sx;

		position.x = e[ 12 ]; position.y = e[ 13 ]; position.z = e[ 14 ];

		const m = _m1.copy( this ), me = m.elements;
		const ix = 1 / sx, iy = 1 / sy, iz = 1 / sz;
		me[ 0 ] *= ix; me[ 1 ] *= ix; me[ 2 ] *= ix;
		me[ 4 ] *= iy; me[ 5 ] *= iy; me[ 6 ] *= iy;
		me[ 8 ] *= iz; me[ 9 ] *= iz; me[ 10 ] *= iz;
		quaternion.setFromRotationMatrix( m );

		scale.x = sx; scale.y = sy; scale.z = sz;
		return this;

	}

	// Off-center perspective. Default: WebGPU clip space with reversed depth
	// (near -> 1, far -> 0). `far === Infinity` gives an infinite far plane.
	makePerspective( left, right, top, bottom, near, far, coordinateSystem = WebGPUCoordinateSystem, reversedDepth = true ) {

		const e = this.elements;
		const x = 2 * near / ( right - left ), y = 2 * near / ( top - bottom );
		const a = ( right + left ) / ( right - left ), b = ( top + bottom ) / ( top - bottom );
		let c, d;
		const inf = far === Infinity;

		if ( reversedDepth ) {

			if ( coordinateSystem !== WebGPUCoordinateSystem ) throw new Error( 'Matrix4.makePerspective: reversed depth requires WebGPU clip space' );
			c = inf ? 0 : near / ( far - near );
			d = inf ? near : far * near / ( far - near );

		} else if ( coordinateSystem === WebGPUCoordinateSystem ) {

			c = inf ? - 1 : - far / ( far - near );
			d = inf ? - near : - far * near / ( far - near );

		} else {

			c = inf ? - 1 : - ( far + near ) / ( far - near );
			d = inf ? - 2 * near : - 2 * far * near / ( far - near );

		}

		e[ 0 ] = x; e[ 4 ] = 0; e[ 8 ] = a; e[ 12 ] = 0;
		e[ 1 ] = 0; e[ 5 ] = y; e[ 9 ] = b; e[ 13 ] = 0;
		e[ 2 ] = 0; e[ 6 ] = 0; e[ 10 ] = c; e[ 14 ] = d;
		e[ 3 ] = 0; e[ 7 ] = 0; e[ 11 ] = - 1; e[ 15 ] = 0;
		return this;

	}

	makeOrthographic( left, right, top, bottom, near, far, coordinateSystem = WebGPUCoordinateSystem, reversedDepth = true ) {

		const e = this.elements;
		const w = 1 / ( right - left ), h = 1 / ( top - bottom ), p = 1 / ( far - near );
		const x = ( right + left ) * w, y = ( top + bottom ) * h;
		let z, zInv;

		if ( reversedDepth ) {

			z = far * p; zInv = p; // (z_view + far) / (far - near)

		} else if ( coordinateSystem === WebGPUCoordinateSystem ) {

			z = - near * p; zInv = - p;

		} else {

			z = - ( far + near ) * p; zInv = - 2 * p;

		}

		e[ 0 ] = 2 * w; e[ 4 ] = 0; e[ 8 ] = 0; e[ 12 ] = - x;
		e[ 1 ] = 0; e[ 5 ] = 2 * h; e[ 9 ] = 0; e[ 13 ] = - y;
		e[ 2 ] = 0; e[ 6 ] = 0; e[ 10 ] = zInv; e[ 14 ] = z;
		e[ 3 ] = 0; e[ 7 ] = 0; e[ 11 ] = 0; e[ 15 ] = 1;
		return this;

	}

	equals( m ) { for ( let i = 0; i < 16; i ++ ) if ( this.elements[ i ] !== m.elements[ i ] ) return false; return true; }
	fromArray( a, o = 0 ) { for ( let i = 0; i < 16; i ++ ) this.elements[ i ] = a[ i + o ]; return this; }
	toArray( a = [], o = 0 ) { const e = this.elements; for ( let i = 0; i < 16; i ++ ) a[ o + i ] = e[ i ]; return a; }

}

Matrix4.prototype.isMatrix4 = true;

const _m1 = /*@__PURE__*/ new Matrix4();
