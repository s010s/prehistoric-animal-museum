// Float32 <-> IEEE half-float (binary16) packing (three.js DataUtils-compatible).

const _f32 = new Float32Array( 1 );
const _u32 = new Uint32Array( _f32.buffer );

// Truncating conversion (same bit results as three.js); returns the 16-bit
// pattern as a number.
export function toHalfFloat( val ) {

	if ( Math.abs( val ) > 65504 ) console.warn( 'DataUtils.toHalfFloat(): value out of range.' );
	val = Math.max( - 65504, Math.min( 65504, val ) );
	_f32[ 0 ] = val;
	const x = _u32[ 0 ];
	const sign = ( x >>> 16 ) & 0x8000;
	const exp = ( x >>> 23 ) & 0xff;
	const mant = x & 0x7fffff;

	if ( exp === 0xff ) return sign | 0x7c00 | ( mant >>> 13 ); // NaN / Inf
	const e = exp - 127 + 15;
	if ( e >= 0x1f ) return sign | 0x7c00;
	if ( e <= 0 ) return e < - 10 ? sign : sign | ( ( mant | 0x800000 ) >>> ( 14 - e ) ); // subnormal
	return sign | ( e << 10 ) | ( mant >>> 13 );

}

export function fromHalfFloat( h ) {

	const sign = h & 0x8000 ? - 1 : 1;
	const e = ( h >>> 10 ) & 0x1f, m = h & 0x3ff;
	if ( e === 0 ) return sign * Math.pow( 2, - 14 ) * ( m / 1024 );
	if ( e === 0x1f ) return m ? NaN : sign * Infinity;
	return sign * Math.pow( 2, e - 15 ) * ( 1 + m / 1024 );

}

export const DataUtils = { toHalfFloat, fromHalfFloat };
