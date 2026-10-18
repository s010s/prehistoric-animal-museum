import { GPU } from './GPU.js';

// Asynchronous GPU -> CPU readback of a storage buffer range, a few frames late.
//
//   const rb = new Readback( { byteLength: 64 } );
//   rb.request( storageBuffer, byteOffset );   // after recording the pass that writes it
//   ... later frames: if ( rb.latest ) use( new Float32Array( rb.latest ) )  (rb.frame = when it was requested)
//
// A small ring of staging buffers keeps one copy in flight per frame without stalling.
export class Readback {

	constructor( { byteLength, ring = 3, label = 'readback' } ) {

		this.byteLength = Math.ceil( byteLength / 4 ) * 4;
		this.label = label;
		this.ring = [];
		for ( let i = 0; i < ring; i ++ ) this.ring.push( { buffer: null, busy: false, frame: 0 } );
		this.latest = null;
		this.frame = - 1;
		this.onData = null;

	}

	_slot() {

		for ( const s of this.ring ) if ( ! s.busy ) {

			if ( ! s.buffer ) s.buffer = GPU.device.createBuffer( { label: this.label, size: this.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
			return s;

		}

		return null;

	}

	// Copy `src` (StorageBuffer or GPUBuffer) into a free staging buffer at the end of this frame's
	// command buffer; returns false if all slots are still in flight.
	request( src, srcOffset = 0 ) {

		const s = this._slot();
		if ( ! s ) return false;
		s.busy = true;
		s.frame = GPU.frame;
		const buf = src.getGPU ? src.getGPU() : src;
		GPU.getEncoder().copyBufferToBuffer( buf, srcOffset, s.buffer, 0, this.byteLength );
		GPU.onSubmit( null, () => {

			s.buffer.mapAsync( GPUMapMode.READ ).then( () => {

				const copy = s.buffer.getMappedRange().slice( 0 );
				s.buffer.unmap();
				s.busy = false;
				if ( s.frame >= this.frame ) {

					this.latest = copy;
					this.frame = s.frame;
					if ( this.onData ) this.onData( copy, s.frame );

				}

			} ).catch( () => {

				s.busy = false;

			} );

		} );
		return true;

	}

}

// One-off read of a buffer (awaits the GPU; for startup / tests).
export async function readBuffer( src, byteLength, srcOffset = 0 ) {

	const buf = src.getGPU ? src.getGPU() : src;
	const staging = GPU.device.createBuffer( { size: Math.ceil( byteLength / 4 ) * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
	const enc = GPU.getEncoder();
	enc.copyBufferToBuffer( buf, srcOffset, staging, 0, staging.size );
	GPU.submit();
	await staging.mapAsync( GPUMapMode.READ );
	const out = staging.getMappedRange().slice( 0 );
	staging.unmap();
	staging.destroy();
	return out;

}

// One-off read of a texture level (rows unpadded in the result).
export async function readTexture( texture, { mip = 0, layer = 0, bytesPerTexel = null } = {} ) {

	const { formatInfo } = await import( './GPU.js' );
	const bpp = bytesPerTexel || formatInfo( texture.format ).bytes;
	const w = Math.max( 1, texture.width >> mip ), h = Math.max( 1, texture.height >> mip );
	const rowBytes = w * bpp;
	const padded = Math.ceil( rowBytes / 256 ) * 256;
	const staging = GPU.device.createBuffer( { size: padded * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
	const enc = GPU.getEncoder();
	enc.copyTextureToBuffer( { texture: texture.getGPU(), mipLevel: mip, origin: { x: 0, y: 0, z: layer } }, { buffer: staging, bytesPerRow: padded, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 } );
	GPU.submit();
	await staging.mapAsync( GPUMapMode.READ );
	const src = new Uint8Array( staging.getMappedRange() );
	const out = new Uint8Array( rowBytes * h );
	for ( let y = 0; y < h; y ++ ) out.set( src.subarray( y * padded, y * padded + rowBytes ), y * rowBytes );
	staging.unmap();
	staging.destroy();
	return { data: out.buffer, width: w, height: h };

}
