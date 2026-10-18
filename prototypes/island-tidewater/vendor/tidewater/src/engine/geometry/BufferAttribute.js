// Vertex attribute storage (three.js BufferAttribute family-compatible).
// Setting `needsUpdate = true` bumps `version`; the renderer re-uploads when
// `version` changes (honouring `updateRanges` when non-empty).

import { Vector3 } from '../math/Vector3.js';
import { Vector2 } from '../math/Vector2.js';
import { generateUUID, normalize, denormalize } from '../math/MathUtils.js';
import { StaticDrawUsage } from '../constants.js';
import { EventDispatcher } from '../core/EventDispatcher.js';

const _v = /*@__PURE__*/ new Vector3();
const _v2 = /*@__PURE__*/ new Vector2();

// Accessors shared by plain and interleaved attributes; they rely on
// _idx( index, component ) and `array` / `normalized`.
const accessors = {

	getComponent( i, c ) { const v = this.array[ this._idx( i, c ) ]; return this.normalized ? denormalize( v, this.array ) : v; },
	setComponent( i, c, v ) { this.array[ this._idx( i, c ) ] = this.normalized ? normalize( v, this.array ) : v; return this; },
	getX( i ) { return this.getComponent( i, 0 ); },
	getY( i ) { return this.getComponent( i, 1 ); },
	getZ( i ) { return this.getComponent( i, 2 ); },
	getW( i ) { return this.getComponent( i, 3 ); },
	setX( i, x ) { return this.setComponent( i, 0, x ); },
	setY( i, y ) { return this.setComponent( i, 1, y ); },
	setZ( i, z ) { return this.setComponent( i, 2, z ); },
	setW( i, w ) { return this.setComponent( i, 3, w ); },
	setXY( i, x, y ) { this.setComponent( i, 0, x ); return this.setComponent( i, 1, y ); },
	setXYZ( i, x, y, z ) { this.setComponent( i, 0, x ); this.setComponent( i, 1, y ); return this.setComponent( i, 2, z ); },

	setXYZW( i, x, y, z, w ) {

		this.setComponent( i, 0, x ); this.setComponent( i, 1, y ); this.setComponent( i, 2, z );
		return this.setComponent( i, 3, w );

	},

	applyMatrix3( m ) {

		if ( this.itemSize === 2 ) {

			for ( let i = 0; i < this.count; i ++ ) { _v2.fromBufferAttribute( this, i ).applyMatrix3( m ); this.setXY( i, _v2.x, _v2.y ); }

		} else if ( this.itemSize === 3 ) {

			for ( let i = 0; i < this.count; i ++ ) { _v.fromBufferAttribute( this, i ).applyMatrix3( m ); this.setXYZ( i, _v.x, _v.y, _v.z ); }

		}

		return this;

	},

	applyMatrix4( m ) {

		for ( let i = 0; i < this.count; i ++ ) { _v.fromBufferAttribute( this, i ).applyMatrix4( m ); this.setXYZ( i, _v.x, _v.y, _v.z ); }
		return this;

	},

	applyNormalMatrix( m ) {

		for ( let i = 0; i < this.count; i ++ ) { _v.fromBufferAttribute( this, i ).applyNormalMatrix( m ); this.setXYZ( i, _v.x, _v.y, _v.z ); }
		return this;

	},

	transformDirection( m ) {

		for ( let i = 0; i < this.count; i ++ ) { _v.fromBufferAttribute( this, i ).transformDirection( m ); this.setXYZ( i, _v.x, _v.y, _v.z ); }
		return this;

	},

};

export class BufferAttribute extends EventDispatcher {

	constructor( array, itemSize, normalized = false ) {

		super();
		if ( Array.isArray( array ) ) throw new TypeError( 'BufferAttribute: array should be a Typed Array.' );
		this.name = '';
		this.array = array;
		this.itemSize = itemSize;
		this.count = array !== undefined ? array.length / itemSize : 0;
		this.normalized = normalized;
		this.usage = StaticDrawUsage;
		this.updateRanges = [];
		this.gpuType = 1015; // FloatType
		this.version = 0;
		this.onUploadCallback = noop;

	}

	set needsUpdate( v ) { if ( v === true ) this.version ++; }

	_idx( i, c ) { return i * this.itemSize + c; }

	setUsage( u ) { this.usage = u; return this; }
	addUpdateRange( start, count ) { this.updateRanges.push( { start, count } ); }
	clearUpdateRanges() { this.updateRanges.length = 0; }
	onUpload( cb ) { this.onUploadCallback = cb; return this; }

	copy( src ) {

		this.name = src.name;
		this.array = new src.array.constructor( src.array );
		this.itemSize = src.itemSize;
		this.count = src.count;
		this.normalized = src.normalized;
		this.usage = src.usage;
		this.gpuType = src.gpuType;
		return this;

	}

	copyAt( i1, attr, i2 ) {

		const s = this.itemSize;
		i1 *= s; i2 *= attr.itemSize;
		for ( let i = 0; i < s; i ++ ) this.array[ i1 + i ] = attr.array[ i2 + i ];
		return this;

	}

	copyArray( a ) { this.array.set( a ); return this; }
	set( value, offset = 0 ) { this.array.set( value, offset ); return this; }
	clone() { return new this.constructor( this.array, this.itemSize ).copy( this ); }
	dispose() { this.dispatchEvent( { type: 'dispose' } ); }

}

Object.assign( BufferAttribute.prototype, accessors );
BufferAttribute.prototype.isBufferAttribute = true;

function noop() {}

export class Int8BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Int8Array( a ), s, n ); } }
export class Uint8BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Uint8Array( a ), s, n ); } }
export class Uint8ClampedBufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Uint8ClampedArray( a ), s, n ); } }
export class Int16BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Int16Array( a ), s, n ); } }
export class Uint16BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Uint16Array( a ), s, n ); } }
export class Int32BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Int32Array( a ), s, n ); } }
export class Uint32BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Uint32Array( a ), s, n ); } }
export class Float32BufferAttribute extends BufferAttribute { constructor( a, s, n ) { super( new Float32Array( a ), s, n ); } }

export class InstancedBufferAttribute extends BufferAttribute {

	constructor( array, itemSize, normalized, meshPerAttribute = 1 ) {

		super( array, itemSize, normalized );
		this.meshPerAttribute = meshPerAttribute;

	}

	copy( src ) { super.copy( src ); this.meshPerAttribute = src.meshPerAttribute; return this; }
	clone() { return new InstancedBufferAttribute( this.array, this.itemSize ).copy( this ); }

}

InstancedBufferAttribute.prototype.isInstancedBufferAttribute = true;

// One vertex buffer holding several attributes at `stride` floats per vertex.
export class InterleavedBuffer extends EventDispatcher {

	constructor( array, stride ) {

		super();
		this.array = array;
		this.stride = stride;
		this.count = array !== undefined ? array.length / stride : 0;
		this.usage = StaticDrawUsage;
		this.updateRanges = [];
		this.version = 0;
		this.uuid = generateUUID();
		this.onUploadCallback = noop;

	}

	set needsUpdate( v ) { if ( v === true ) this.version ++; }
	setUsage( u ) { this.usage = u; return this; }
	addUpdateRange( start, count ) { this.updateRanges.push( { start, count } ); }
	clearUpdateRanges() { this.updateRanges.length = 0; }
	set( value, offset = 0 ) { this.array.set( value, offset ); return this; }
	onUpload( cb ) { this.onUploadCallback = cb; return this; }

	copy( src ) {

		this.array = new src.array.constructor( src.array );
		this.count = src.count;
		this.stride = src.stride;
		this.usage = src.usage;
		return this;

	}

	copyAt( i1, buf, i2 ) {

		i1 *= this.stride; i2 *= buf.stride;
		for ( let i = 0; i < this.stride; i ++ ) this.array[ i1 + i ] = buf.array[ i2 + i ];
		return this;

	}

	clone() { return new this.constructor( new this.array.constructor( this.array ), this.stride ).copy( this ); }
	dispose() { this.dispatchEvent( { type: 'dispose' } ); }

}

InterleavedBuffer.prototype.isInterleavedBuffer = true;

export class InstancedInterleavedBuffer extends InterleavedBuffer {

	constructor( array, stride, meshPerAttribute = 1 ) {

		super( array, stride );
		this.meshPerAttribute = meshPerAttribute;

	}

	copy( src ) { super.copy( src ); this.meshPerAttribute = src.meshPerAttribute; return this; }
	clone() { return new InstancedInterleavedBuffer( new this.array.constructor( this.array ), this.stride, this.meshPerAttribute ); }

}

InstancedInterleavedBuffer.prototype.isInstancedInterleavedBuffer = true;

export class InterleavedBufferAttribute {

	constructor( interleavedBuffer, itemSize, offset, normalized = false ) {

		this.name = '';
		this.data = interleavedBuffer;
		this.itemSize = itemSize;
		this.offset = offset;
		this.normalized = normalized;

	}

	get count() { return this.data.count; }
	get array() { return this.data.array; }
	set needsUpdate( v ) { this.data.needsUpdate = v; }

	_idx( i, c ) { return i * this.data.stride + this.offset + c; }

	// De-interleaves into a standalone BufferAttribute.
	clone() {

		const a = new this.array.constructor( this.count * this.itemSize );
		for ( let i = 0; i < this.count; i ++ ) for ( let c = 0; c < this.itemSize; c ++ ) a[ i * this.itemSize + c ] = this.array[ this._idx( i, c ) ];
		return new BufferAttribute( a, this.itemSize, this.normalized );

	}

}

Object.assign( InterleavedBufferAttribute.prototype, accessors );
InterleavedBufferAttribute.prototype.isInterleavedBufferAttribute = true;
