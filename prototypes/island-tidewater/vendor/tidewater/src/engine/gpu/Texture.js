import { GPU, formatInfo, sampleTypeOf } from './GPU.js';

// GPU texture wrapper. Created lazily, re-created by resize(); `version` changes whenever the
// underlying GPUTexture does, which is how bind groups know to rebuild.
//
//   new Texture( { width, height, depth = 1, dimension: '2d' | '2d-array' | '3d' | 'cube',
//                  format: 'rgba16float', mips: false | true | n, usage: [ 'sample', 'render', 'storage', 'copySrc', 'copyDst' ],
//                  sampler: 'linearRepeat' | ... (default sampler name, informative for ports) } )
//
// `data` uploads level 0 (TypedArray, tightly packed rows; 2d-array / 3d / cube: all layers).

let _texId = 0;

export class Texture {

	constructor( o = {} ) {

		this.id = _texId ++;
		this.label = o.label || o.name || 'texture' + this.id;
		this.width = Math.max( 1, o.width || 1 );
		this.height = Math.max( 1, o.height || 1 );
		this.depth = Math.max( 1, o.depth || ( o.dimension === 'cube' ? 6 : 1 ) );
		this.dimension = o.dimension || '2d';
		this.format = o.format || 'rgba8unorm';
		this.mipsOption = o.mips ?? false;
		this.sampleCount = o.sampleCount || 1;
		const u = o.usage || [ 'sample', 'copyDst' ];
		this.usageList = u;
		this.sampler = o.sampler || 'linearClamp';
		this.gpu = null;
		this.version = 0;
		this._views = new Map();
		this.isTexture = true;
		if ( o.data ) this.pendingData = o.data;

	}

	get mipLevelCount() {

		if ( this.mipsOption === true ) return Math.floor( Math.log2( Math.max( this.width, this.height, this.dimension === '3d' ? this.depth : 1 ) ) ) + 1;
		if ( typeof this.mipsOption === 'number' ) return this.mipsOption;
		return 1;

	}

	get usage() {

		let u = 0;
		for ( const k of this.usageList ) u |= {
			sample: GPUTextureUsage.TEXTURE_BINDING,
			render: GPUTextureUsage.RENDER_ATTACHMENT,
			storage: GPUTextureUsage.STORAGE_BINDING,
			copySrc: GPUTextureUsage.COPY_SRC,
			copyDst: GPUTextureUsage.COPY_DST,
		}[ k ];
		// mip generation renders into each level
		if ( this.mipLevelCount > 1 ) u |= GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
		return u;

	}

	get isDepth() {

		return this.format.startsWith( 'depth' );

	}

	get sampleType() {

		return sampleTypeOf( this.format );

	}

	// WGSL type of a sampled binding for the default view of this texture
	wgslType( viewDimension = this.defaultViewDimension ) {

		const st = this.sampleType;
		if ( st === 'depth' ) return { '2d': 'texture_depth_2d', '2d-array': 'texture_depth_2d_array', cube: 'texture_depth_cube' }[ viewDimension ];
		const t = st === 'uint' ? 'u32' : st === 'sint' ? 'i32' : 'f32';
		return `texture_${ viewDimension.replace( '-', '_' ) }<${ t }>`;

	}

	get defaultViewDimension() {

		return this.dimension;

	}

	getGPU() {

		if ( ! this.gpu ) this._create();
		return this.gpu;

	}

	_create() {

		const dim = this.dimension === '3d' ? '3d' : '2d';
		this.gpu = GPU.device.createTexture( {
			label: this.label,
			size: { width: this.width, height: this.height, depthOrArrayLayers: this.depth },
			dimension: dim,
			format: this.format,
			mipLevelCount: this.mipLevelCount,
			sampleCount: this.sampleCount,
			usage: this.usage,
		} );
		this._views.clear();
		this.version ++;
		if ( this.pendingData ) {

			const d = this.pendingData;
			this.pendingData = null;
			this.upload( d );

		}

	}

	// view: { dimension, baseMipLevel, mipLevelCount, baseArrayLayer, arrayLayerCount, aspect }
	view( o = null ) {

		const g = this.getGPU();
		const key = o ? JSON.stringify( o ) : '';
		let v = this._views.get( key );
		if ( ! v ) {

			v = g.createView( { label: this.label + key, dimension: o?.dimension || this.defaultViewDimension, ...( o || {} ) } );
			this._views.set( key, v );

		}

		return v;

	}

	resize( w, h, d = this.depth ) {

		w = Math.max( 1, Math.floor( w ) );
		h = Math.max( 1, Math.floor( h ) );
		if ( w === this.width && h === this.height && d === this.depth && this.gpu ) return false;
		this.width = w;
		this.height = h;
		this.depth = d;
		if ( this.gpu ) {

			// commands recorded earlier this frame may still use it: free it after the submit
			const old = this.gpu;
			GPU.onSubmit( null, () => old.destroy() );
			this.gpu = null;

		}

		this._create();
		return true;

	}

	// Upload level `mip` (all layers). data: TypedArray matching the format's bytes per texel.
	upload( data, { mip = 0, layer = 0, layers = null, width = null, height = null, x = 0, y = 0 } = {} ) {

		if ( ! this.gpu ) {

			if ( mip === 0 && layer === 0 && ! width ) {

				this.pendingData = data;
				this.getGPU();
				return;

			}

			this.getGPU();

		}

		const bpp = formatInfo( this.format ).bytes;
		const w = width || Math.max( 1, this.width >> mip );
		const h = height || Math.max( 1, this.height >> mip );
		const d = layers || ( this.dimension === '3d' ? Math.max( 1, this.depth >> mip ) : this.depth - layer );
		const bytes = data instanceof ArrayBuffer ? data : data.buffer;
		const byteOffset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
		GPU.queue.writeTexture(
			{ texture: this.gpu, mipLevel: mip, origin: { x, y, z: layer } },
			bytes,
			{ offset: byteOffset, bytesPerRow: w * bpp, rowsPerImage: h },
			{ width: w, height: h, depthOrArrayLayers: d },
		);

	}

	destroy() {

		if ( this.gpu ) this.gpu.destroy();
		this.gpu = null;
		this.version ++;

	}

}

// Render target: a set of color textures + an optional depth texture of the same size.
export class RenderTarget {

	constructor( width, height, { colors = [ 'rgba16float' ], depth = null, label = 'rt', mips = false, usage = [ 'sample', 'render', 'copySrc', 'copyDst' ], depthUsage = [ 'sample', 'render', 'copySrc', 'copyDst' ], scale = 1 } = {} ) {

		this.label = label;
		this.width = Math.max( 1, width | 0 );
		this.height = Math.max( 1, height | 0 );
		this.scale = scale; // informative: resolution relative to the internal render size
		this.textures = colors.map( ( c, i ) => {

			const f = typeof c === 'string' ? { format: c } : c;
			return new Texture( { label: `${ label }.${ f.name || i }`, width: this.width, height: this.height, format: f.format, mips: f.mips ?? mips, usage: f.usage || usage } );

		} );
		this.depthTexture = depth ? new Texture( { label: label + '.depth', width: this.width, height: this.height, format: depth, usage: depthUsage } ) : null;

	}

	get texture() {

		return this.textures[ 0 ];

	}

	get formats() {

		return this.textures.map( ( t ) => t.format );

	}

	setSize( w, h ) {

		w = Math.max( 1, w | 0 );
		h = Math.max( 1, h | 0 );
		if ( w === this.width && h === this.height ) return false;
		this.width = w;
		this.height = h;
		for ( const t of this.textures ) t.resize( w, h );
		if ( this.depthTexture ) this.depthTexture.resize( w, h );
		return true;

	}

}

// Storage buffer (array of structs / vectors) with an optional initial fill.
let _bufId = 0;
export class StorageBuffer {

	// type: WGSL element type ('vec4f', 'f32', 'u32', 'MyStruct'); count: elements; stride: bytes per element
	constructor( { label, count, type = 'vec4f', stride = null, data = null, usage = [] } ) {

		this.id = _bufId ++;
		this.label = label || 'buffer' + this.id;
		this.count = count;
		this.type = type;
		this.stride = stride || { f32: 4, u32: 4, i32: 4, 'atomic<u32>': 4, 'atomic<i32>': 4, vec2f: 8, vec2u: 8, vec3f: 16, vec4f: 16, vec4u: 16, vec4i: 16, mat4x4f: 64 }[ type ];
		if ( ! this.stride ) throw new Error( `StorageBuffer ${ this.label }: pass a stride for ${ type }` );
		this.byteLength = Math.max( 16, count * this.stride );
		this.extraUsage = usage;
		this.gpu = null;
		this.version = 0;
		this.pendingData = data;
		this.isStorageBuffer = true;

	}

	getGPU() {

		if ( ! this.gpu ) {

			let u = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
			for ( const k of this.extraUsage ) u |= { vertex: GPUBufferUsage.VERTEX, index: GPUBufferUsage.INDEX, indirect: GPUBufferUsage.INDIRECT, uniform: GPUBufferUsage.UNIFORM }[ k ];
			this.gpu = GPU.device.createBuffer( { label: this.label, size: Math.ceil( this.byteLength / 4 ) * 4, usage: u } );
			this.version ++;
			if ( this.pendingData ) {

				const d = this.pendingData;
				this.pendingData = null;
				this.write( d );

			}

		}

		return this.gpu;

	}

	write( data, byteOffset = 0 ) {

		if ( ! this.gpu ) {

			if ( byteOffset === 0 ) {

				this.pendingData = data;
				this.getGPU();
				return;

			}

			this.getGPU();

		}

		GPU.queue.writeBuffer( this.gpu, byteOffset, data.buffer || data, data.byteOffset || 0, data.byteLength ?? undefined );

	}

	destroy() {

		if ( this.gpu ) this.gpu.destroy();
		this.gpu = null;

	}

}
