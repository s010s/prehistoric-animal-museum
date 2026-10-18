// 2D vector (three.js Vector2-compatible).

export class Vector2 {

	constructor( x = 0, y = 0 ) {

		this.x = x;
		this.y = y;

	}

	get width() { return this.x; }
	set width( v ) { this.x = v; }
	get height() { return this.y; }
	set height( v ) { this.y = v; }

	set( x, y ) { this.x = x; this.y = y; return this; }
	setScalar( s ) { this.x = s; this.y = s; return this; }
	setX( x ) { this.x = x; return this; }
	setY( y ) { this.y = y; return this; }
	setComponent( i, v ) { if ( i === 0 ) this.x = v; else this.y = v; return this; }
	getComponent( i ) { return i === 0 ? this.x : this.y; }
	clone() { return new Vector2( this.x, this.y ); }
	copy( v ) { this.x = v.x; this.y = v.y; return this; }
	add( v ) { this.x += v.x; this.y += v.y; return this; }
	addScalar( s ) { this.x += s; this.y += s; return this; }
	addVectors( a, b ) { this.x = a.x + b.x; this.y = a.y + b.y; return this; }
	addScaledVector( v, s ) { this.x += v.x * s; this.y += v.y * s; return this; }
	sub( v ) { this.x -= v.x; this.y -= v.y; return this; }
	subScalar( s ) { this.x -= s; this.y -= s; return this; }
	subVectors( a, b ) { this.x = a.x - b.x; this.y = a.y - b.y; return this; }
	multiply( v ) { this.x *= v.x; this.y *= v.y; return this; }
	multiplyScalar( s ) { this.x *= s; this.y *= s; return this; }
	divide( v ) { this.x /= v.x; this.y /= v.y; return this; }
	divideScalar( s ) { return this.multiplyScalar( 1 / s ); }

	applyMatrix3( m ) {

		const x = this.x, y = this.y, e = m.elements;
		this.x = e[ 0 ] * x + e[ 3 ] * y + e[ 6 ];
		this.y = e[ 1 ] * x + e[ 4 ] * y + e[ 7 ];
		return this;

	}

	min( v ) { this.x = Math.min( this.x, v.x ); this.y = Math.min( this.y, v.y ); return this; }
	max( v ) { this.x = Math.max( this.x, v.x ); this.y = Math.max( this.y, v.y ); return this; }
	clamp( lo, hi ) { this.x = Math.max( lo.x, Math.min( hi.x, this.x ) ); this.y = Math.max( lo.y, Math.min( hi.y, this.y ) ); return this; }
	clampScalar( lo, hi ) { this.x = Math.max( lo, Math.min( hi, this.x ) ); this.y = Math.max( lo, Math.min( hi, this.y ) ); return this; }

	clampLength( lo, hi ) {

		const l = this.length();
		return this.divideScalar( l || 1 ).multiplyScalar( Math.max( lo, Math.min( hi, l ) ) );

	}

	floor() { this.x = Math.floor( this.x ); this.y = Math.floor( this.y ); return this; }
	ceil() { this.x = Math.ceil( this.x ); this.y = Math.ceil( this.y ); return this; }
	round() { this.x = Math.round( this.x ); this.y = Math.round( this.y ); return this; }
	roundToZero() { this.x = Math.trunc( this.x ); this.y = Math.trunc( this.y ); return this; }
	negate() { this.x = - this.x; this.y = - this.y; return this; }
	dot( v ) { return this.x * v.x + this.y * v.y; }
	cross( v ) { return this.x * v.y - this.y * v.x; }
	lengthSq() { return this.x * this.x + this.y * this.y; }
	length() { return Math.sqrt( this.x * this.x + this.y * this.y ); }
	manhattanLength() { return Math.abs( this.x ) + Math.abs( this.y ); }
	normalize() { return this.divideScalar( this.length() || 1 ); }
	angle() { return Math.atan2( - this.y, - this.x ) + Math.PI; }

	angleTo( v ) {

		const d = Math.sqrt( this.lengthSq() * v.lengthSq() );
		if ( d === 0 ) return Math.PI / 2;
		return Math.acos( Math.max( - 1, Math.min( 1, this.dot( v ) / d ) ) );

	}

	distanceTo( v ) { return Math.sqrt( this.distanceToSquared( v ) ); }
	distanceToSquared( v ) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
	manhattanDistanceTo( v ) { return Math.abs( this.x - v.x ) + Math.abs( this.y - v.y ); }
	setLength( l ) { return this.normalize().multiplyScalar( l ); }
	lerp( v, a ) { this.x += ( v.x - this.x ) * a; this.y += ( v.y - this.y ) * a; return this; }
	lerpVectors( a, b, t ) { this.x = a.x + ( b.x - a.x ) * t; this.y = a.y + ( b.y - a.y ) * t; return this; }
	equals( v ) { return v.x === this.x && v.y === this.y; }
	fromArray( a, o = 0 ) { this.x = a[ o ]; this.y = a[ o + 1 ]; return this; }
	toArray( a = [], o = 0 ) { a[ o ] = this.x; a[ o + 1 ] = this.y; return a; }
	fromBufferAttribute( attr, i ) { this.x = attr.getX( i ); this.y = attr.getY( i ); return this; }

	rotateAround( c, angle ) {

		const cs = Math.cos( angle ), sn = Math.sin( angle );
		const x = this.x - c.x, y = this.y - c.y;
		this.x = x * cs - y * sn + c.x;
		this.y = x * sn + y * cs + c.y;
		return this;

	}

	random() { this.x = Math.random(); this.y = Math.random(); return this; }

	*[ Symbol.iterator ]() { yield this.x; yield this.y; }

}

Vector2.prototype.isVector2 = true;
