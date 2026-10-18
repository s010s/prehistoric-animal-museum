// Headless SMAA: fetch serves public/textures/smaa and PNGs are decoded with zlib (import before the post chain)
import fs from 'node:fs';
import zlib from 'node:zlib';
const root = new URL( '../public', import.meta.url ).pathname;
const realFetch = globalThis.fetch;
globalThis.fetch = async ( url, o ) => {
	const u = String( url );
	if ( u.includes( 'textures/smaa/' ) ) { const b = fs.readFileSync( root + '/textures/smaa/' + u.split( '/' ).pop() ); return { arrayBuffer: async () => b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) }; }
	return realFetch( url, o );
};
// minimal PNG decoder (8-bit gray / RGB / RGBA, non-interlaced)
globalThis.__assetImage = async ( bytes ) => {
	const buf = Buffer.from( bytes ); let p = 8, w, h, ct, idat = [];
	while ( p < buf.length ) { const len = buf.readUInt32BE( p ); const type = buf.toString( 'ascii', p + 4, p + 8 ); const d = buf.subarray( p + 8, p + 8 + len );
		if ( type === 'IHDR' ) { w = d.readUInt32BE( 0 ); h = d.readUInt32BE( 4 ); ct = d[ 9 ]; } else if ( type === 'IDAT' ) idat.push( d ); p += 12 + len; }
	const raw = zlib.inflateSync( Buffer.concat( idat ) ); const ch = { 0: 1, 2: 3, 6: 4 }[ ct ]; const stride = w * ch;
	const out = new Uint8Array( w * h * 4 ); let prev = new Uint8Array( stride );
	for ( let y = 0; y < h; y ++ ) { const f = raw[ y * ( stride + 1 ) ]; const line = raw.subarray( y * ( stride + 1 ) + 1, ( y + 1 ) * ( stride + 1 ) ); const cur = new Uint8Array( stride );
		for ( let x = 0; x < stride; x ++ ) { const a = x >= ch ? cur[ x - ch ] : 0, b = prev[ x ], c = x >= ch ? prev[ x - ch ] : 0; let v = line[ x ];
			if ( f === 1 ) v += a; else if ( f === 2 ) v += b; else if ( f === 3 ) v += ( a + b ) >> 1; else if ( f === 4 ) { const pp = a + b - c, pa = Math.abs( pp - a ), pb = Math.abs( pp - b ), pc = Math.abs( pp - c ); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
			cur[ x ] = v & 255; }
		for ( let x = 0; x < w; x ++ ) { const o = ( y * w + x ) * 4; if ( ch === 1 ) { out[ o ] = out[ o + 1 ] = out[ o + 2 ] = cur[ x ]; out[ o + 3 ] = 255; } else { out[ o ] = cur[ x * ch ]; out[ o + 1 ] = cur[ x * ch + 1 ]; out[ o + 2 ] = cur[ x * ch + 2 ]; out[ o + 3 ] = ch === 4 ? cur[ x * ch + 3 ] : 255; } }
		prev = cur; }
	return { data: out, width: w, height: h };
};
