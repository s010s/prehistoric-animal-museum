import { GPU } from './GPU.js';

// Uniform blocks: a WGSL struct plus a CPU mirror and a GPU buffer.
//
//   const U = new UniformBlock( 'OceanParams', {
//     choppiness: [ 'f32', 0.9 ],
//     sizes: [ 'vec4f', [ 733, 157, 33.3, 7.1 ] ],
//     sysA: [ 'vec4f[2]' ],
//     viewProj: 'mat4x4f',
//   } );
//   U.values.choppiness = 1.2;  // or U.set( 'choppiness', 1.2 )
//   U.fields.choppiness.value   // three-style handle: { value } that the block reads on upload
//
// Values may be numbers, arrays, Vector2/3/4, Color (r, g, b), Quaternion, Matrix3/4 (elements).
// Arrays of scalars are not allowed in uniform address space; use vec4f[N].
// The block uploads itself on bind (upload() checks a dirty flag set by set()); fields reached
// through their `{ value }` handles are compared against the last upload each frame instead.

const TYPES = {
	f32: { size: 4, align: 4, n: 1 },
	i32: { size: 4, align: 4, n: 1, int: true },
	u32: { size: 4, align: 4, n: 1, uint: true },
	vec2f: { size: 8, align: 8, n: 2 },
	vec3f: { size: 12, align: 16, n: 3 },
	vec4f: { size: 16, align: 16, n: 4 },
	vec2i: { size: 8, align: 8, n: 2, int: true },
	vec4i: { size: 16, align: 16, n: 4, int: true },
	vec2u: { size: 8, align: 8, n: 2, uint: true },
	vec4u: { size: 16, align: 16, n: 4, uint: true },
	mat3x3f: { size: 48, align: 16, n: 12, mat3: true },
	mat4x4f: { size: 64, align: 16, n: 16 },
};

function parseType( t ) {

	const m = /^(\w+)(?:\[(\d+)\])?$/.exec( t );
	if ( ! m || ! TYPES[ m[ 1 ] ] ) throw new Error( 'Unsupported uniform type ' + t );
	const base = TYPES[ m[ 1 ] ];
	const count = m[ 2 ] ? Number( m[ 2 ] ) : 0;
	if ( count && base.align < 16 ) throw new Error( `uniform array ${ t }: element must be 16-byte aligned (use vec4f)` );
	return { name: m[ 1 ], base, count };

}

// write one value into a float/int/uint view at word offset o
function writeValue( f32, u32, i32, o, type, v ) {

	const { base } = type;
	const view = base.int ? i32 : base.uint ? u32 : f32;
	if ( typeof v === 'number' || typeof v === 'boolean' ) {

		view[ o ] = Number( v );
		return;

	}

	if ( v == null ) return;
	if ( v.isMatrix4 || v.isMatrix3 ) {

		const e = v.elements;
		if ( base.mat3 ) {

			// mat3x3f columns are padded to vec4
			if ( e.length === 9 ) for ( let c = 0; c < 3; c ++ ) for ( let r = 0; r < 3; r ++ ) f32[ o + c * 4 + r ] = e[ c * 3 + r ];
			else for ( let c = 0; c < 3; c ++ ) for ( let r = 0; r < 3; r ++ ) f32[ o + c * 4 + r ] = e[ c * 4 + r ];

		} else {

			for ( let i = 0; i < 16; i ++ ) f32[ o + i ] = e[ i ];

		}

		return;

	}

	if ( v.isColor ) {

		view[ o ] = v.r; view[ o + 1 ] = v.g; view[ o + 2 ] = v.b;
		if ( base.n === 4 ) view[ o + 3 ] = 1;
		return;

	}

	if ( v.isVector2 ) {

		view[ o ] = v.x; view[ o + 1 ] = v.y;
		return;

	}

	if ( v.isVector3 ) {

		view[ o ] = v.x; view[ o + 1 ] = v.y; view[ o + 2 ] = v.z;
		return;

	}

	if ( v.isVector4 || v.isQuaternion ) {

		view[ o ] = v.x; view[ o + 1 ] = v.y; view[ o + 2 ] = v.z; view[ o + 3 ] = v.w;
		return;

	}

	if ( ArrayBuffer.isView( v ) || Array.isArray( v ) ) {

		for ( let i = 0; i < Math.min( v.length, base.n ); i ++ ) view[ o + i ] = v[ i ];
		return;

	}

	throw new Error( 'Cannot write uniform value ' + v );

}

let _blockId = 0;

export class UniformBlock {

	// fields: { name: 'type' | [ 'type', initialValue ] }
	constructor( structName, fields, { label } = {} ) {

		this.structName = structName;
		this.label = label || structName;
		this.id = _blockId ++;
		this.layout = {};
		this.fields = {};
		this.order = [];
		let offset = 0;
		let maxAlign = 16;
		for ( const name in fields ) {

			const def = fields[ name ];
			const typeStr = Array.isArray( def ) ? def[ 0 ] : def;
			const init = Array.isArray( def ) ? def[ 1 ] : undefined;
			const type = parseType( typeStr );
			const align = type.base.align;
			maxAlign = Math.max( maxAlign, align );
			offset = Math.ceil( offset / align ) * align;
			const stride = type.count ? Math.ceil( type.base.size / 16 ) * 16 : type.base.size;
			const size = type.count ? stride * type.count : type.base.size;
			this.layout[ name ] = { offset, type, typeStr, stride, size };
			this.order.push( name );
			this.fields[ name ] = { value: init !== undefined ? init : defaultValue( type ) };
			offset += size;

		}

		this.byteLength = Math.max( 16, Math.ceil( offset / maxAlign ) * maxAlign );
		this.data = new ArrayBuffer( this.byteLength );
		this.f32 = new Float32Array( this.data );
		this.u32 = new Uint32Array( this.data );
		this.i32 = new Int32Array( this.data );
		this.buffer = null;
		this.version = 0;
		// values proxy: U.values.x = 1
		const self = this;
		this.values = new Proxy( {}, {
			get: ( _, k ) => self.fields[ k ] && self.fields[ k ].value,
			set: ( _, k, v ) => ( self.set( k, v ), true ),
		} );

	}

	get wgsl() {

		let s = `struct ${ this.structName } {\n`;
		for ( const name of this.order ) {

			const { type } = this.layout[ name ];
			s += type.count ? `\t${ name }: array<${ type.name }, ${ type.count }>,\n` : `\t${ name }: ${ type.name },\n`;

		}

		return s + '};\n';

	}

	set( name, v ) {

		const f = this.fields[ name ];
		if ( ! f ) throw new Error( `${ this.structName }: no uniform ${ name }` );
		// keep the handle's object when it is a math type (callers hold references to it)
		if ( f.value && typeof f.value === 'object' && ! Array.isArray( f.value ) && f.value.copy && v && v.constructor === f.value.constructor ) f.value.copy( v );
		else f.value = v;

	}

	get( name ) {

		return this.fields[ name ].value;

	}

	// serialize all field values into the CPU mirror
	_pack() {

		if ( this.onBeforePack ) this.onBeforePack( this );
		const { f32, u32, i32, fields } = this;
		const plan = this._plan || this._makePlan();
		for ( let k = 0; k < plan.length; k ++ ) {

			const { name, o, type, stride, count, n } = plan[ k ];
			const v = fields[ name ].value;
			if ( typeof v === 'number' ) {

				// scalar fast path (writeValue's number case)
				( type.base.int ? i32 : type.base.uint ? u32 : f32 )[ o ] = v;
				continue;

			}

			if ( count ) {

				if ( ! v ) continue;
				if ( typeof v[ 0 ] === 'number' ) {

					// flat numbers: n per element, elements `stride` words apart
					const view = type.base.int ? i32 : type.base.uint ? u32 : f32;
					const m = Math.min( count, v.length / n );
					for ( let i = 0; i < m; i ++ ) {

						const d = o + i * stride, sIdx = i * n, e = Math.min( n, v.length - sIdx );
						for ( let j = 0; j < e; j ++ ) view[ d + j ] = v[ sIdx + j ];

					}

				} else {

					const m = Math.min( count, v.length );
					for ( let i = 0; i < m; i ++ ) writeValue( f32, u32, i32, o + i * stride, type, v[ i ] );

				}

			} else {

				writeValue( f32, u32, i32, o, type, v );

			}

		}

	}

	_makePlan() {

		this._plan = this.order.map( ( name ) => {

			const { offset, type, stride } = this.layout[ name ];
			return { name, o: offset / 4, type, stride: stride / 4, count: type.count, n: type.base.n };

		} );
		return this._plan;

	}

	getBuffer() {

		if ( ! this.buffer ) {

			this.buffer = GPU.device.createBuffer( { label: this.label, size: this.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST } ); // STORAGE: may be bound read-only when a stage runs out of uniform slots (Shader.js)
			this._last = new Uint32Array( this.byteLength / 4 );
			this._last.fill( 0xffffffff );

		}

		return this.buffer;

	}

	// upload when anything changed since the last upload (cheap compare of the packed words)
	// token: calls with the same token as the previous upload skip the repack (the caller knows
	// nothing ran in between, see BindingSet.getBindGroup)
	upload( token ) {

		if ( token !== undefined && token === this._token && this.buffer ) return this.buffer;
		this._token = token;
		const buf = this.getBuffer();
		this._pack();
		const cur = this.u32, last = this._last;
		let dirty = false;
		for ( let i = 0; i < cur.length; i ++ ) if ( cur[ i ] !== last[ i ] ) {

			dirty = true;
			break;

		}

		if ( dirty ) {

			last.set( cur );
			GPU.queue.writeBuffer( buf, 0, this.data );

		}

		return buf;

	}

}

function defaultValue( type ) {

	if ( type.count ) return null;
	if ( type.base.n === 1 ) return 0;
	return new Array( type.base.n ).fill( 0 );

}
