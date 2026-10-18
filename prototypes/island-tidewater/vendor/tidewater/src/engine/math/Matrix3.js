// 3x3 matrix, column-major `elements` (three.js Matrix3-compatible).

export class Matrix3 {

	constructor( n11, n12, n13, n21, n22, n23, n31, n32, n33 ) {

		this.elements = [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
		if ( n11 !== undefined ) this.set( n11, n12, n13, n21, n22, n23, n31, n32, n33 );

	}

	// row-major arguments
	set( n11, n12, n13, n21, n22, n23, n31, n32, n33 ) {

		const e = this.elements;
		e[ 0 ] = n11; e[ 1 ] = n21; e[ 2 ] = n31;
		e[ 3 ] = n12; e[ 4 ] = n22; e[ 5 ] = n32;
		e[ 6 ] = n13; e[ 7 ] = n23; e[ 8 ] = n33;
		return this;

	}

	identity() { return this.set( 1, 0, 0, 0, 1, 0, 0, 0, 1 ); }
	copy( m ) { const e = this.elements, s = m.elements; for ( let i = 0; i < 9; i ++ ) e[ i ] = s[ i ]; return this; }
	clone() { return new Matrix3().fromArray( this.elements ); }

	setFromMatrix4( m ) {

		const e = m.elements;
		return this.set( e[ 0 ], e[ 4 ], e[ 8 ], e[ 1 ], e[ 5 ], e[ 9 ], e[ 2 ], e[ 6 ], e[ 10 ] );

	}

	multiply( m ) { return this.multiplyMatrices( this, m ); }
	premultiply( m ) { return this.multiplyMatrices( m, this ); }

	multiplyMatrices( a, b ) {

		const ae = a.elements, be = b.elements, te = this.elements;
		const a11 = ae[ 0 ], a12 = ae[ 3 ], a13 = ae[ 6 ], a21 = ae[ 1 ], a22 = ae[ 4 ], a23 = ae[ 7 ], a31 = ae[ 2 ], a32 = ae[ 5 ], a33 = ae[ 8 ];
		const b11 = be[ 0 ], b12 = be[ 3 ], b13 = be[ 6 ], b21 = be[ 1 ], b22 = be[ 4 ], b23 = be[ 7 ], b31 = be[ 2 ], b32 = be[ 5 ], b33 = be[ 8 ];
		te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31; te[ 3 ] = a11 * b12 + a12 * b22 + a13 * b32; te[ 6 ] = a11 * b13 + a12 * b23 + a13 * b33;
		te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31; te[ 4 ] = a21 * b12 + a22 * b22 + a23 * b32; te[ 7 ] = a21 * b13 + a22 * b23 + a23 * b33;
		te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31; te[ 5 ] = a31 * b12 + a32 * b22 + a33 * b32; te[ 8 ] = a31 * b13 + a32 * b23 + a33 * b33;
		return this;

	}

	multiplyScalar( s ) { const e = this.elements; for ( let i = 0; i < 9; i ++ ) e[ i ] *= s; return this; }

	determinant() {

		const e = this.elements;
		const a = e[ 0 ], b = e[ 1 ], c = e[ 2 ], d = e[ 3 ], f = e[ 4 ], g = e[ 5 ], h = e[ 6 ], i = e[ 7 ], j = e[ 8 ];
		return a * f * j - a * g * i - b * d * j + b * g * h + c * d * i - c * f * h;

	}

	invert() {

		const e = this.elements;
		const n11 = e[ 0 ], n21 = e[ 1 ], n31 = e[ 2 ], n12 = e[ 3 ], n22 = e[ 4 ], n32 = e[ 5 ], n13 = e[ 6 ], n23 = e[ 7 ], n33 = e[ 8 ];
		const t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13;
		const det = n11 * t11 + n21 * t12 + n31 * t13;
		if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0 );
		const id = 1 / det;
		e[ 0 ] = t11 * id; e[ 1 ] = ( n31 * n23 - n33 * n21 ) * id; e[ 2 ] = ( n32 * n21 - n31 * n22 ) * id;
		e[ 3 ] = t12 * id; e[ 4 ] = ( n33 * n11 - n31 * n13 ) * id; e[ 5 ] = ( n31 * n12 - n32 * n11 ) * id;
		e[ 6 ] = t13 * id; e[ 7 ] = ( n21 * n13 - n23 * n11 ) * id; e[ 8 ] = ( n22 * n11 - n21 * n12 ) * id;
		return this;

	}

	transpose() {

		const m = this.elements;
		let t;
		t = m[ 1 ]; m[ 1 ] = m[ 3 ]; m[ 3 ] = t;
		t = m[ 2 ]; m[ 2 ] = m[ 6 ]; m[ 6 ] = t;
		t = m[ 5 ]; m[ 5 ] = m[ 7 ]; m[ 7 ] = t;
		return this;

	}

	getNormalMatrix( m4 ) { return this.setFromMatrix4( m4 ).invert().transpose(); }

	makeTranslation( x, y ) { if ( x.isVector2 ) { y = x.y; x = x.x; } return this.set( 1, 0, x, 0, 1, y, 0, 0, 1 ); }
	makeRotation( t ) { const c = Math.cos( t ), s = Math.sin( t ); return this.set( c, - s, 0, s, c, 0, 0, 0, 1 ); }
	makeScale( x, y ) { return this.set( x, 0, 0, 0, y, 0, 0, 0, 1 ); }

	setUvTransform( tx, ty, sx, sy, rotation, cx, cy ) {

		const c = Math.cos( rotation ), s = Math.sin( rotation );
		return this.set(
			sx * c, sx * s, - sx * ( c * cx + s * cy ) + cx + tx,
			- sy * s, sy * c, - sy * ( - s * cx + c * cy ) + cy + ty,
			0, 0, 1
		);

	}

	scale( sx, sy ) { return this.premultiply( _m3.makeScale( sx, sy ) ); }
	rotate( theta ) { return this.premultiply( _m3.makeRotation( - theta ) ); }
	translate( tx, ty ) { return this.premultiply( _m3.makeTranslation( tx, ty ) ); }

	equals( m ) { for ( let i = 0; i < 9; i ++ ) if ( this.elements[ i ] !== m.elements[ i ] ) return false; return true; }
	fromArray( a, o = 0 ) { for ( let i = 0; i < 9; i ++ ) this.elements[ i ] = a[ i + o ]; return this; }
	toArray( a = [], o = 0 ) { for ( let i = 0; i < 9; i ++ ) a[ o + i ] = this.elements[ i ]; return a; }

}

Matrix3.prototype.isMatrix3 = true;

const _m3 = /*@__PURE__*/ new Matrix3();
