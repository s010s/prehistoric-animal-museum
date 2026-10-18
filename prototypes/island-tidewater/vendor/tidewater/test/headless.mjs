// Headless WebGPU (Dawn via the `webgpu` npm package) for engine tests.
import { create, globals } from 'webgpu';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

Object.assign( globalThis, globals );
Object.defineProperty( globalThis, 'navigator', { value: { gpu: create( [] ) }, configurable: true } );
globalThis.location = { search: '' };

// minimal RGBA8 PNG writer
export function writePNG( path, width, height, rgba ) {

	const crcTable = new Int32Array( 256 ).map( ( _, n ) => {

		let c = n;
		for ( let k = 0; k < 8; k ++ ) c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
		return c;

	} );
	const crc = ( buf ) => {

		let c = - 1;
		for ( const b of buf ) c = crcTable[ ( c ^ b ) & 255 ] ^ ( c >>> 8 );
		return ( c ^ - 1 ) >>> 0;

	};
	const chunk = ( type, data ) => {

		const out = Buffer.alloc( 12 + data.length );
		out.writeUInt32BE( data.length, 0 );
		out.write( type, 4, 'ascii' );
		data.copy( out, 8 );
		out.writeUInt32BE( crc( out.subarray( 4, 8 + data.length ) ), 8 + data.length );
		return out;

	};
	const raw = Buffer.alloc( ( width * 4 + 1 ) * height );
	for ( let y = 0; y < height; y ++ ) {

		raw[ y * ( width * 4 + 1 ) ] = 0;
		Buffer.from( rgba.buffer, rgba.byteOffset + y * width * 4, width * 4 ).copy( raw, y * ( width * 4 + 1 ) + 1 );

	}

	const ihdr = Buffer.alloc( 13 );
	ihdr.writeUInt32BE( width, 0 );
	ihdr.writeUInt32BE( height, 4 );
	ihdr[ 8 ] = 8; ihdr[ 9 ] = 6;
	writeFileSync( path, Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', ihdr ), chunk( 'IDAT', deflateSync( raw ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] ) );

}
