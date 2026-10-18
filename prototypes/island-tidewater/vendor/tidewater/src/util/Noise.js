// Small, fast, seeded 2D noise utilities for CPU-side procedural generation.

export function mulberry32( seed ) {

	let a = seed >>> 0;
	return function () {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export class Noise2D {

	constructor( seed = 1 ) {

		const rand = mulberry32( seed );
		const p = new Uint8Array( 256 );
		for ( let i = 0; i < 256; i ++ ) p[ i ] = i;
		for ( let i = 255; i > 0; i -- ) {

			const j = Math.floor( rand() * ( i + 1 ) );
			const t = p[ i ]; p[ i ] = p[ j ]; p[ j ] = t;

		}

		this.perm = new Uint8Array( 512 );
		for ( let i = 0; i < 512; i ++ ) this.perm[ i ] = p[ i & 255 ];
		this.grad = new Float32Array( 512 );
		for ( let i = 0; i < 256; i ++ ) {

			const a = rand() * Math.PI * 2;
			this.grad[ i * 2 ] = Math.cos( a );
			this.grad[ i * 2 + 1 ] = Math.sin( a );

		}

	}

	// gradient noise, roughly in [-1, 1]
	noise( x, y ) {

		const xi = Math.floor( x ), yi = Math.floor( y );
		const xf = x - xi, yf = y - yi;
		const X = xi & 255, Y = yi & 255;
		const perm = this.perm, g = this.grad;
		const h00 = perm[ X + perm[ Y ] ], h10 = perm[ X + 1 + perm[ Y ] ];
		const h01 = perm[ X + perm[ Y + 1 ] ], h11 = perm[ X + 1 + perm[ Y + 1 ] ];
		const d00 = g[ h00 * 2 ] * xf + g[ h00 * 2 + 1 ] * yf;
		const d10 = g[ h10 * 2 ] * ( xf - 1 ) + g[ h10 * 2 + 1 ] * yf;
		const d01 = g[ h01 * 2 ] * xf + g[ h01 * 2 + 1 ] * ( yf - 1 );
		const d11 = g[ h11 * 2 ] * ( xf - 1 ) + g[ h11 * 2 + 1 ] * ( yf - 1 );
		const u = xf * xf * xf * ( xf * ( xf * 6 - 15 ) + 10 );
		const v = yf * yf * yf * ( yf * ( yf * 6 - 15 ) + 10 );
		const a = d00 + ( d10 - d00 ) * u;
		const b = d01 + ( d11 - d01 ) * u;
		return ( a + ( b - a ) * v ) * 1.414;

	}

	fbm( x, y, octaves = 5, lacunarity = 2.0, gain = 0.5 ) {

		let sum = 0, amp = 1, freq = 1, norm = 0;
		for ( let i = 0; i < octaves; i ++ ) {

			sum += this.noise( x * freq + i * 17.13, y * freq - i * 9.71 ) * amp;
			norm += amp;
			amp *= gain;
			freq *= lacunarity;

		}

		return sum / norm;

	}

	ridged( x, y, octaves = 5 ) {

		let sum = 0, amp = 0.5, freq = 1, prev = 1;
		for ( let i = 0; i < octaves; i ++ ) {

			let n = 1 - Math.abs( this.noise( x * freq + i * 31.7, y * freq + i * 11.3 ) );
			n *= n;
			sum += n * amp * prev;
			prev = n;
			amp *= 0.5;
			freq *= 2.03;

		}

		return sum;

	}

}

export const smoothstep = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

export const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
