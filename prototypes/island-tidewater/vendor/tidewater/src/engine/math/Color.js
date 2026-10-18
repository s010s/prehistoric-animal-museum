// RGB color stored as linear-sRGB floats (three.js Color with ColorManagement
// enabled): hex / CSS inputs are sRGB and get linearized; getHex / getStyle
// convert back to sRGB. setHSL / getHSL / offsetHSL work in the linear
// working space by default, like three.js.

export const NoColorSpace = '';
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'srgb-linear';

export const SRGBToLinear = ( c ) => ( c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 ) );
export const LinearToSRGB = ( c ) => ( c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow( c, 0.41666 ) - 0.055 );

const clamp01 = ( v ) => Math.max( 0, Math.min( 1, v ) );
const euclid = ( n, m ) => ( ( n % m ) + m ) % m;

function hue2rgb( p, q, t ) {

	if ( t < 0 ) t += 1;
	if ( t > 1 ) t -= 1;
	if ( t < 1 / 6 ) return p + ( q - p ) * 6 * t;
	if ( t < 1 / 2 ) return q;
	if ( t < 2 / 3 ) return p + ( q - p ) * 6 * ( 2 / 3 - t );
	return p;

}

const _hsl = { h: 0, s: 0, l: 0 };

export class Color {

	constructor( r, g, b ) {

		this.r = 1;
		this.g = 1;
		this.b = 1;
		this.set( r, g, b );

	}

	set( r, g, b ) {

		if ( g === undefined && b === undefined ) {

			if ( r === undefined ) return this;
			if ( r && r.isColor ) this.copy( r );
			else if ( typeof r === 'number' ) this.setHex( r );
			else if ( typeof r === 'string' ) this.setStyle( r );

		} else {

			this.setRGB( r, g, b );

		}

		return this;

	}

	setScalar( s ) { this.r = s; this.g = s; this.b = s; return this; }

	setHex( hex, colorSpace = SRGBColorSpace ) {

		hex = Math.floor( hex );
		return this.setRGB( ( hex >> 16 & 255 ) / 255, ( hex >> 8 & 255 ) / 255, ( hex & 255 ) / 255, colorSpace );

	}

	setRGB( r, g, b, colorSpace = LinearSRGBColorSpace ) {

		if ( colorSpace === SRGBColorSpace ) { r = SRGBToLinear( r ); g = SRGBToLinear( g ); b = SRGBToLinear( b ); }
		this.r = r; this.g = g; this.b = b;
		return this;

	}

	setHSL( h, s, l, colorSpace = LinearSRGBColorSpace ) {

		h = euclid( h, 1 ); s = clamp01( s ); l = clamp01( l );
		if ( s === 0 ) return this.setRGB( l, l, l, colorSpace );
		const p = l <= 0.5 ? l * ( 1 + s ) : l + s - l * s;
		const q = 2 * l - p;
		return this.setRGB( hue2rgb( q, p, h + 1 / 3 ), hue2rgb( q, p, h ), hue2rgb( q, p, h - 1 / 3 ), colorSpace );

	}

	setStyle( style, colorSpace = SRGBColorSpace ) {

		let m;
		if ( ( m = /^#([A-Fa-f\d]+)$/.exec( style ) ) ) {

			const h = m[ 1 ];
			if ( h.length === 3 ) return this.setRGB( parseInt( h[ 0 ], 16 ) / 15, parseInt( h[ 1 ], 16 ) / 15, parseInt( h[ 2 ], 16 ) / 15, colorSpace );
			if ( h.length === 6 ) return this.setHex( parseInt( h, 16 ), colorSpace );

		} else if ( ( m = /^rgba?\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*[\d.]+\s*)?\)$/.exec( style ) ) ) {

			const k = m[ 2 ] === '%' ? 100 : 255;
			return this.setRGB( Math.min( 1, m[ 1 ] / k ), Math.min( 1, m[ 3 ] / k ), Math.min( 1, m[ 4 ] / k ), colorSpace );

		} else if ( ( m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/.exec( style ) ) ) {

			return this.setHSL( m[ 1 ] / 360, m[ 2 ] / 100, m[ 3 ] / 100, colorSpace );

		} else if ( NAMED[ style.toLowerCase() ] !== undefined ) {

			return this.setHex( NAMED[ style.toLowerCase() ], colorSpace );

		}

		console.warn( 'Color: unknown color ' + style );
		return this;

	}

	clone() { return new Color( this.r, this.g, this.b ); }
	copy( c ) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
	copySRGBToLinear( c ) { this.r = SRGBToLinear( c.r ); this.g = SRGBToLinear( c.g ); this.b = SRGBToLinear( c.b ); return this; }
	copyLinearToSRGB( c ) { this.r = LinearToSRGB( c.r ); this.g = LinearToSRGB( c.g ); this.b = LinearToSRGB( c.b ); return this; }
	convertSRGBToLinear() { return this.copySRGBToLinear( this ); }
	convertLinearToSRGB() { return this.copyLinearToSRGB( this ); }

	getHex( colorSpace = SRGBColorSpace ) {

		let r = this.r, g = this.g, b = this.b;
		if ( colorSpace === SRGBColorSpace ) { r = LinearToSRGB( r ); g = LinearToSRGB( g ); b = LinearToSRGB( b ); }
		return Math.round( clamp01( r ) * 255 ) * 65536 + Math.round( clamp01( g ) * 255 ) * 256 + Math.round( clamp01( b ) * 255 );

	}

	getHexString( colorSpace = SRGBColorSpace ) { return ( '000000' + this.getHex( colorSpace ).toString( 16 ) ).slice( - 6 ); }

	getHSL( target, colorSpace = LinearSRGBColorSpace ) {

		let r = this.r, g = this.g, b = this.b;
		if ( colorSpace === SRGBColorSpace ) { r = LinearToSRGB( r ); g = LinearToSRGB( g ); b = LinearToSRGB( b ); }
		const max = Math.max( r, g, b ), min = Math.min( r, g, b );
		let h = 0, s = 0;
		const l = ( min + max ) / 2;

		if ( min !== max ) {

			const d = max - min;
			s = l <= 0.5 ? d / ( max + min ) : d / ( 2 - max - min );
			if ( max === r ) h = ( g - b ) / d + ( g < b ? 6 : 0 );
			else if ( max === g ) h = ( b - r ) / d + 2;
			else h = ( r - g ) / d + 4;
			h /= 6;

		}

		target.h = h; target.s = s; target.l = l;
		return target;

	}

	getRGB( target, colorSpace = LinearSRGBColorSpace ) {

		target.r = this.r; target.g = this.g; target.b = this.b;
		if ( colorSpace === SRGBColorSpace ) { target.r = LinearToSRGB( target.r ); target.g = LinearToSRGB( target.g ); target.b = LinearToSRGB( target.b ); }
		return target;

	}

	getStyle( colorSpace = SRGBColorSpace ) {

		const c = this.getRGB( {}, colorSpace );
		return `rgb(${ Math.round( c.r * 255 ) },${ Math.round( c.g * 255 ) },${ Math.round( c.b * 255 ) })`;

	}

	offsetHSL( h, s, l ) {

		this.getHSL( _hsl );
		return this.setHSL( _hsl.h + h, _hsl.s + s, _hsl.l + l );

	}

	add( c ) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
	addColors( a, b ) { this.r = a.r + b.r; this.g = a.g + b.g; this.b = a.b + b.b; return this; }
	addScalar( s ) { this.r += s; this.g += s; this.b += s; return this; }
	sub( c ) { this.r = Math.max( 0, this.r - c.r ); this.g = Math.max( 0, this.g - c.g ); this.b = Math.max( 0, this.b - c.b ); return this; }
	multiply( c ) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
	multiplyScalar( s ) { this.r *= s; this.g *= s; this.b *= s; return this; }
	lerp( c, a ) { this.r += ( c.r - this.r ) * a; this.g += ( c.g - this.g ) * a; this.b += ( c.b - this.b ) * a; return this; }
	lerpColors( a, b, t ) { this.r = a.r + ( b.r - a.r ) * t; this.g = a.g + ( b.g - a.g ) * t; this.b = a.b + ( b.b - a.b ) * t; return this; }
	equals( c ) { return c.r === this.r && c.g === this.g && c.b === this.b; }
	fromArray( a, o = 0 ) { this.r = a[ o ]; this.g = a[ o + 1 ]; this.b = a[ o + 2 ]; return this; }
	toArray( a = [], o = 0 ) { a[ o ] = this.r; a[ o + 1 ] = this.g; a[ o + 2 ] = this.b; return a; }
	fromBufferAttribute( attr, i ) { this.r = attr.getX( i ); this.g = attr.getY( i ); this.b = attr.getZ( i ); return this; }

	*[ Symbol.iterator ]() { yield this.r; yield this.g; yield this.b; }

}

Color.prototype.isColor = true;

const NAMED = { black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x008000, lime: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, cyan: 0x00ffff, magenta: 0xff00ff, gray: 0x808080, grey: 0x808080, orange: 0xffa500 };
Color.NAMES = NAMED;
