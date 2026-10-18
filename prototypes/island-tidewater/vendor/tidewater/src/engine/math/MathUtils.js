// Scalar helpers (three.js MathUtils-compatible subset).

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

const _hex = [];
for ( let i = 0; i < 256; i ++ ) _hex[ i ] = ( i < 16 ? '0' : '' ) + i.toString( 16 );

export function generateUUID() {

	const d0 = Math.random() * 0xffffffff | 0, d1 = Math.random() * 0xffffffff | 0;
	const d2 = Math.random() * 0xffffffff | 0, d3 = Math.random() * 0xffffffff | 0;
	const s = _hex[ d0 & 0xff ] + _hex[ d0 >> 8 & 0xff ] + _hex[ d0 >> 16 & 0xff ] + _hex[ d0 >> 24 & 0xff ] + '-' +
		_hex[ d1 & 0xff ] + _hex[ d1 >> 8 & 0xff ] + '-' + _hex[ d1 >> 16 & 0x0f | 0x40 ] + _hex[ d1 >> 24 & 0xff ] + '-' +
		_hex[ d2 & 0x3f | 0x80 ] + _hex[ d2 >> 8 & 0xff ] + '-' + _hex[ d2 >> 16 & 0xff ] + _hex[ d2 >> 24 & 0xff ] +
		_hex[ d3 & 0xff ] + _hex[ d3 >> 8 & 0xff ] + _hex[ d3 >> 16 & 0xff ] + _hex[ d3 >> 24 & 0xff ];
	return s.toLowerCase();

}

export const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );
export const euclideanModulo = ( n, m ) => ( ( n % m ) + m ) % m;
export const mapLinear = ( x, a1, a2, b1, b2 ) => b1 + ( x - a1 ) * ( b2 - b1 ) / ( a2 - a1 );
export const inverseLerp = ( x, y, v ) => ( x !== y ? ( v - x ) / ( y - x ) : 0 );
export const lerp = ( x, y, t ) => ( 1 - t ) * x + t * y;
export const damp = ( x, y, lambda, dt ) => lerp( x, y, 1 - Math.exp( - lambda * dt ) );
export const pingpong = ( x, length = 1 ) => length - Math.abs( euclideanModulo( x, length * 2 ) - length );

export function smoothstep( x, min, max ) {

	if ( x <= min ) return 0;
	if ( x >= max ) return 1;
	x = ( x - min ) / ( max - min );
	return x * x * ( 3 - 2 * x );

}

export function smootherstep( x, min, max ) {

	if ( x <= min ) return 0;
	if ( x >= max ) return 1;
	x = ( x - min ) / ( max - min );
	return x * x * x * ( x * ( x * 6 - 15 ) + 10 );

}

export const randInt = ( low, high ) => low + Math.floor( Math.random() * ( high - low + 1 ) );
export const randFloat = ( low, high ) => low + Math.random() * ( high - low );
export const randFloatSpread = ( range ) => range * ( 0.5 - Math.random() );

// Mulberry32, deterministic when seeded.
let _seed = 1234567;
export function seededRandom( s ) {

	if ( s !== undefined ) _seed = s;
	let t = _seed += 0x6D2B79F5;
	t = Math.imul( t ^ t >>> 15, t | 1 );
	t ^= t + Math.imul( t ^ t >>> 7, t | 61 );
	return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

}

export const degToRad = ( d ) => d * DEG2RAD;
export const radToDeg = ( r ) => r * RAD2DEG;
export const isPowerOfTwo = ( v ) => ( v & ( v - 1 ) ) === 0 && v !== 0;
export const ceilPowerOfTwo = ( v ) => Math.pow( 2, Math.ceil( Math.log( v ) / Math.LN2 ) );
export const floorPowerOfTwo = ( v ) => Math.pow( 2, Math.floor( Math.log( v ) / Math.LN2 ) );

// Typed-array value <-> [0,1] / [-1,1] float (normalized vertex attributes).
export function denormalize( v, array ) {

	switch ( array.constructor ) {

		case Float32Array: case Float64Array: return v;
		case Uint32Array: return v / 4294967295;
		case Uint16Array: return v / 65535;
		case Uint8Array: case Uint8ClampedArray: return v / 255;
		case Int32Array: return Math.max( v / 2147483647, - 1 );
		case Int16Array: return Math.max( v / 32767, - 1 );
		case Int8Array: return Math.max( v / 127, - 1 );
		default: return v;

	}

}

export function normalize( v, array ) {

	switch ( array.constructor ) {

		case Float32Array: case Float64Array: return v;
		case Uint32Array: return Math.round( v * 4294967295 );
		case Uint16Array: return Math.round( v * 65535 );
		case Uint8Array: case Uint8ClampedArray: return Math.round( v * 255 );
		case Int32Array: return Math.round( v * 2147483647 );
		case Int16Array: return Math.round( v * 32767 );
		case Int8Array: return Math.round( v * 127 );
		default: return v;

	}

}

export const MathUtils = {
	normalize, denormalize,
	DEG2RAD, RAD2DEG, generateUUID, clamp, euclideanModulo, mapLinear, inverseLerp, lerp, damp, pingpong,
	smoothstep, smootherstep, randInt, randFloat, randFloatSpread, seededRandom, degToRad, radToDeg,
	isPowerOfTwo, ceilPowerOfTwo, floorPowerOfTwo,
};
