// Helpers for the ocean stream's headless tests.
import { writePNG } from './headless.mjs';
import { readTexture } from '../src/engine/gpu/Readback.js';

export function halfToFloat( h ) {

	const s = ( h & 0x8000 ) ? - 1 : 1, e = ( h >> 10 ) & 0x1f, f = h & 0x3ff;
	if ( e === 0 ) return s * Math.pow( 2, - 14 ) * ( f / 1024 );
	if ( e === 31 ) return f ? NaN : s * Infinity;
	return s * Math.pow( 2, e - 15 ) * ( 1 + f / 1024 );

}

// read an rgba16float / rgba32float texture layer as Float32Array (rgba)
export async function readFloatTexture( tex, opts = {} ) {

	const r = await readTexture( tex, opts );
	if ( tex.format === 'rgba16float' || tex.format === 'r16float' ) {

		const u = new Uint16Array( r.data );
		const out = new Float32Array( u.length );
		for ( let i = 0; i < u.length; i ++ ) out[ i ] = halfToFloat( u[ i ] );
		return { data: out, width: r.width, height: r.height };

	}

	return { data: new Float32Array( r.data ), width: r.width, height: r.height };

}

// write channels of a float image mapped by ( v - lo ) / ( hi - lo )
export function writeFloatPNG( path, img, { channels = [ 0, 1, 2 ], lo = - 1, hi = 1, comps = 4 } = {} ) {

	const { data, width, height } = img;
	const out = new Uint8Array( width * height * 4 );
	for ( let i = 0; i < width * height; i ++ ) {

		for ( let k = 0; k < 3; k ++ ) {

			const ch = channels[ Math.min( k, channels.length - 1 ) ];
			const v = ch < 0 ? 0 : data[ i * comps + ch ];
			out[ i * 4 + k ] = Math.max( 0, Math.min( 255, ( ( v - lo ) / ( hi - lo ) ) * 255 ) );

		}

		out[ i * 4 + 3 ] = 255;

	}

	writePNG( path, width, height, out );

}

export function stats( img, ch, comps = 4 ) {

	let mn = Infinity, mx = - Infinity, sum = 0, sq = 0, nan = 0;
	const n = img.width * img.height;
	for ( let i = 0; i < n; i ++ ) {

		const v = img.data[ i * comps + ch ];
		if ( ! Number.isFinite( v ) ) { nan ++; continue; }
		mn = Math.min( mn, v ); mx = Math.max( mx, v ); sum += v; sq += v * v;

	}

	const mean = sum / n;
	return { min: mn, max: mx, mean, std: Math.sqrt( Math.max( 0, sq / n - mean * mean ) ), nan };

}
