import { GPU } from './GPU.js';
import { UniformBlock } from './Uniforms.js';

// WGSL composition.
//
// A shader is assembled from modules: pieces of WGSL (functions, structs, constants) plus the
// resources they read. Systems expose modules instead of TSL functions, e.g. the terrain exports a
// module whose code defines `fn terrainHeight( xz: vec2f ) -> f32` and whose bindings carry the
// height texture. Any shader that lists the module (directly or through deps) gets the code once
// and the bindings declared in group 1.
//
//   export const terrainModule = new ShaderModule( {
//     name: 'terrain',
//     deps: [ commonModule ],
//     uniforms: terrainUniforms,                       // UniformBlock, declared as var<uniform> terrain: TerrainParams
//     bindings: {
//       terrainHeightTex: { texture: () => heightTex },  // Texture or getter
//       terrainNormals: { storage: normalsBuffer, access: 'read' },
//     },
//     code: /* wgsl */`fn terrainHeight( xz: vec2f ) -> f32 { ... textureSampleLevel( terrainHeightTex, smpLinearClamp, uv, 0 ).r ... }`,
//   } );
//
// Groups:
//   0: frame uniforms (`frame`: camera, time, sun, ...) + the shared samplers (always present)
//   1: module / material resources (composed per shader)
//   2: per-draw data (render pipelines only, see MeshRenderer)
//
// Code may use a small preprocessor: #if NAME, #if !NAME, #ifdef, #ifndef, #elif NAME, #else, #endif,
// and #if NAME == value / != value. Defines come from the shader (material.defines etc.).

export const SAMPLERS = [
	[ 'smpLinearRepeat', 'linearRepeat', 'filtering' ],
	[ 'smpLinearClamp', 'linearClamp', 'filtering' ],
	[ 'smpLinearMirror', 'linearMirror', 'filtering' ],
	[ 'smpAnisoRepeat', 'anisoRepeat', 'filtering' ],
	[ 'smpAnisoClamp', 'anisoClamp', 'filtering' ],
	[ 'smpAniso4Repeat', 'aniso4Repeat', 'filtering' ],
	[ 'smpNearestClamp', 'nearestClamp', 'non-filtering' ],
	[ 'smpNearestRepeat', 'nearestRepeat', 'non-filtering' ],
	[ 'smpShadow', 'shadow', 'comparison' ],
];

let _modId = 0;

export class ShaderModule {

	constructor( { name, deps = [], code = '', bindings = {}, uniforms = null, uniformName = null } ) {

		this.id = _modId ++;
		this.name = name || 'module' + this.id;
		this.deps = deps.filter( Boolean );
		this.code = code;
		this.bindings = { ...bindings };
		if ( uniforms ) this.bindings[ uniformName || lowerFirst( uniforms.structName ) ] = { uniform: uniforms };
		this.isShaderModule = true;

	}

}

function lowerFirst( s ) {

	return s[ 0 ].toLowerCase() + s.slice( 1 );

}

// dependency-ordered list of unique modules
export function collectModules( list ) {

	const out = [];
	const seen = new Set();
	const visit = ( m ) => {

		if ( ! m || seen.has( m ) ) return;
		seen.add( m );
		for ( const d of m.deps ) visit( d );
		out.push( m );

	};

	for ( const m of list ) visit( m );
	return out;

}

// ---------------------------------------------------------------------------------- preprocessor

export function preprocess( code, defines = {} ) {

	const lines = code.split( '\n' );
	const out = [];
	// stack of { active, taken, parentActive }
	const stack = [];
	const active = () => stack.length === 0 || stack[ stack.length - 1 ].active;
	const evalCond = ( expr ) => {

		expr = expr.trim();
		let m;
		if ( ( m = /^!\s*(\w+)$/.exec( expr ) ) ) return ! truthy( defines[ m[ 1 ] ] );
		if ( ( m = /^(\w+)\s*(==|!=|>=|<=|>|<)\s*([\w.'"-]+)$/.exec( expr ) ) ) {

			const a = defines[ m[ 1 ] ];
			let b = m[ 3 ].replace( /^['"]|['"]$/g, '' );
			if ( ! isNaN( Number( b ) ) && typeof a === 'number' ) b = Number( b );
			switch ( m[ 2 ] ) {

				case '==': return a == b; // eslint-disable-line eqeqeq
				case '!=': return a != b; // eslint-disable-line eqeqeq
				case '>=': return a >= b;
				case '<=': return a <= b;
				case '>': return a > b;
				case '<': return a < b;

			}

		}

		if ( /\|\|/.test( expr ) ) return expr.split( '||' ).some( ( e ) => evalCond( e ) );
		if ( /&&/.test( expr ) ) return expr.split( '&&' ).every( ( e ) => evalCond( e ) );
		return truthy( defines[ expr ] );

	};

	for ( const line of lines ) {

		const t = line.trim();
		let m;
		if ( ( m = /^#(if|ifdef|ifndef)\s+(.*)$/.exec( t ) ) ) {

			const parent = active();
			let c;
			if ( m[ 1 ] === 'ifdef' ) c = defines[ m[ 2 ].trim() ] !== undefined;
			else if ( m[ 1 ] === 'ifndef' ) c = defines[ m[ 2 ].trim() ] === undefined;
			else c = evalCond( m[ 2 ] );
			stack.push( { active: parent && c, taken: c, parent } );
			continue;

		}

		if ( ( m = /^#elif\s+(.*)$/.exec( t ) ) ) {

			const s = stack[ stack.length - 1 ];
			const c = ! s.taken && evalCond( m[ 1 ] );
			s.active = s.parent && c;
			s.taken = s.taken || c;
			continue;

		}

		if ( t === '#else' ) {

			const s = stack[ stack.length - 1 ];
			s.active = s.parent && ! s.taken;
			s.taken = true;
			continue;

		}

		if ( t === '#endif' ) {

			stack.pop();
			continue;

		}

		if ( active() ) out.push( line );

	}

	if ( stack.length ) throw new Error( 'preprocess: unterminated #if' );
	return out.join( '\n' );

}

function truthy( v ) {

	return v !== undefined && v !== null && v !== false && v !== 0 && v !== '0';

}

// ---------------------------------------------------------------------------------- bindings

// Resolve a binding spec to its current resource (specs may hold getters).
function resolve( r ) {

	return typeof r === 'function' ? r() : r;

}

// layout entry + WGSL declaration for one binding spec
function describe( name, spec, stage ) {

	const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
	const vis = stage === 'compute' ? GPUShaderStage.COMPUTE : VF;
	if ( spec.uniform ) {

		const u = spec.uniform;
		return {
			layout: { visibility: vis, buffer: { type: 'uniform' } },
			decl: `var<uniform> ${ name }: ${ u.structName };`,
			struct: u,
		};

	}

	if ( spec.uniformBuffer ) {

		return { layout: { visibility: vis, buffer: { type: 'uniform' } }, decl: `var<uniform> ${ name }: ${ spec.wgslType };` };

	}

	if ( spec.storage ) {

		const b = resolve( spec.storage );
		const access = spec.access || 'read';
		const t = spec.wgslType || `array<${ spec.type || b.type }>`;
		const v = stage === 'compute' ? vis : access === 'read' ? VF : GPUShaderStage.FRAGMENT;
		return {
			layout: { visibility: v, buffer: { type: access === 'read' ? 'read-only-storage' : 'storage' } },
			decl: `var<storage, ${ access === 'read' ? 'read' : 'read_write' }> ${ name }: ${ t };`,
		};

	}

	if ( spec.storageTexture ) {

		const t = resolve( spec.storageTexture );
		const access = spec.access || 'write';
		const dim = spec.viewDimension || spec.view?.dimension || t.defaultViewDimension;
		const v = stage === 'compute' ? vis : GPUShaderStage.FRAGMENT;
		return {
			layout: { visibility: v, storageTexture: { access: access === 'write' ? 'write-only' : access === 'read' ? 'read-only' : 'read-write', format: t.format, viewDimension: dim } },
			decl: `var ${ name }: texture_storage_${ dim.replace( '-', '_' ) }<${ t.format }, ${ access }>;`,
		};

	}

	if ( spec.texture ) {

		const t = resolve( spec.texture );
		const dim = spec.viewDimension || spec.view?.dimension || t.defaultViewDimension;
		let sampleType = spec.sampleType || t.sampleType;
		let wgsl = spec.wgslType || t.wgslType( dim );
		// depth read as plain float (textureLoad / manual compare)
		if ( spec.sampleType === 'unfilterable-float' && t.isDepth ) wgsl = `texture_${ dim.replace( '-', '_' ) }<f32>`;
		return {
			layout: { visibility: vis, texture: { sampleType, viewDimension: dim, multisampled: t.sampleCount > 1 } },
			decl: `var ${ name }: ${ wgsl };`,
		};

	}

	if ( spec.sampler ) {

		return { layout: { visibility: vis, sampler: { type: spec.samplerType || 'filtering' } }, decl: `var ${ name }: ${ spec.samplerType === 'comparison' ? 'sampler_comparison' : 'sampler' };` };

	}

	throw new Error( `binding ${ name }: unknown spec` );

}

function resourceOf( spec ) {

	if ( spec.uniform ) return { buffer: spec.uniform.getBuffer() }; // uploaded by getBindGroup
	if ( spec.uniformBuffer ) return { buffer: resolve( spec.uniformBuffer ) };
	if ( spec.storage ) {

		const b = resolve( spec.storage );
		const buf = b.getGPU ? b.getGPU() : b;
		return spec.offset !== undefined ? { buffer: buf, offset: spec.offset, size: spec.size } : { buffer: buf };

	}

	if ( spec.storageTexture ) return resolve( spec.storageTexture ).view( spec.view || { dimension: spec.viewDimension || resolve( spec.storageTexture ).defaultViewDimension, mipLevelCount: 1, baseMipLevel: spec.mip || 0 } );
	if ( spec.texture ) {

		const t = resolve( spec.texture );
		return spec.view || spec.viewDimension ? t.view( { ...( spec.view || {} ), dimension: spec.viewDimension || spec.view.dimension } ) : t.view();

	}

	if ( spec.sampler ) return typeof spec.sampler === 'string' ? GPU.samplers[ spec.sampler ] : spec.sampler;
	throw new Error( 'unknown binding' );

}

// what a binding resolves to, as ( object, version ) pairs compared without building strings
const K_UNIFORM = 0, K_UBUF = 1, K_STORAGE = 2, K_TEXTURE = 3, K_OTHER = 4;

function kindOf( spec ) {

	if ( spec.uniform ) return K_UNIFORM;
	if ( spec.uniformBuffer ) return K_UBUF;
	if ( spec.storage ) return K_STORAGE;
	if ( spec.storageTexture || spec.texture ) return K_TEXTURE;
	return K_OTHER;

}

// bind groups kept per set: ping-pong resources (history textures, ...) alternate between a few
// combinations; each keeps its group instead of re-creating one per frame
const GROUP_CACHE = 4;

const _layoutCache = new Map();

export function getBindGroupLayout( entries, label ) {

	const key = JSON.stringify( entries );
	let l = _layoutCache.get( key );
	if ( ! l ) {

		l = GPU.device.createBindGroupLayout( { label, entries } );
		_layoutCache.set( key, l );

	}

	return l;

}

// A composed set of group-1 bindings: layout + a bind group rebuilt when a resource changes.
export class BindingSet {

	// stageOf: { name: 'vertex' | 'fragment' } for render bindings only one stage reads (keeps the
	// per-stage uniform buffer / texture counts down); demote: uniform blocks bound as read-only storage
	constructor( specs, stage, label = 'bindings', stageOf = null, demote = null ) {

		this.label = label;
		this.stage = stage;
		this.names = Object.keys( specs );
		this.specs = specs;
		this.described = this.names.map( ( n ) => describe( n, specs[ n ], stage ) );
		if ( stageOf ) for ( let i = 0; i < this.names.length; i ++ ) {

			const l = this.described[ i ].layout;
			const st = stageOf[ this.names[ i ] ];
			if ( st === 'fragment' && ( l.visibility & GPUShaderStage.FRAGMENT ) ) l.visibility = GPUShaderStage.FRAGMENT;
			if ( st === 'vertex' && ( l.visibility & GPUShaderStage.VERTEX ) ) l.visibility = GPUShaderStage.VERTEX;

		}

		if ( demote ) for ( let i = 0; i < this.names.length; i ++ ) {

			const d = this.described[ i ];
			if ( ! demote.has( this.names[ i ] ) ) continue;
			d.layout.buffer = { type: 'read-only-storage' };
			d.decl = d.decl.replace( /^var<uniform>/, 'var<storage, read>' );

		}

		this.layout = getBindGroupLayout( this.described.map( ( d, i ) => ( { binding: i, ...d.layout } ) ), label );
		this.group = null;
		const n = this.names.length;
		this._specs = this.names.map( ( k ) => specs[ k ] );
		this._kinds = this._specs.map( kindOf );
		this._blocks = this._specs.filter( ( sp ) => sp.uniform ).map( ( sp ) => sp.uniform );
		this._objs = new Array( n ).fill( null ); // scratch: resolved resources of this call
		this._vers = new Array( n ).fill( 0 );
		this._entry = null; // { objs, vers, group } of this.group
		this._cache = [];
		this._token = null;

	}

	declarations( group ) {

		return this.described.map( ( d, i ) => `@group(${ group }) @binding(${ i }) ${ d.decl }` ).join( '\n' );

	}

	structs() {

		const out = [];
		for ( const d of this.described ) if ( d.struct && ! out.includes( d.struct ) ) out.push( d.struct );
		return out;

	}

	// current bind group (uploads uniform blocks, rebuilds after resource changes).
	// token: callers drawing many items in a row with nothing else running in between (one list of
	// a render pass) pass the same token; repeated calls with it return the group as is.
	getBindGroup( token ) {

		if ( token !== undefined && token === this._token && this.group ) return this.group;
		this._token = token;
		const specs = this._specs, kinds = this._kinds, objs = this._objs, vers = this._vers;
		const n = specs.length;
		for ( let i = 0; i < n; i ++ ) {

			const spec = specs[ i ];
			let o = null, v = 0;
			switch ( kinds[ i ] ) {

				case K_UNIFORM: o = spec.uniform; break;
				case K_UBUF: o = resolve( spec.uniformBuffer ); break;
				case K_STORAGE:
					o = resolve( spec.storage );
					if ( o.getGPU ) {

						o.getGPU();
						v = o.version;

					}

					break;
				case K_TEXTURE:
					o = resolve( spec.storageTexture || spec.texture );
					if ( o && o.getGPU ) {

						o.getGPU();
						v = o.version;

					}

					break;
				default: o = spec.sampler;

			}

			objs[ i ] = o;
			vers[ i ] = v;

		}

		const blocks = this._blocks;
		for ( let i = 0; i < blocks.length; i ++ ) blocks[ i ].upload( token );
		if ( this._entry && this._matches( this._entry ) ) return this.group;
		const cache = this._cache;
		for ( let c = 0; c < cache.length; c ++ ) {

			const e = cache[ c ];
			if ( e === this._entry || ! this._matches( e ) ) continue;
			this._entry = e;
			this.group = e.group;
			return this.group;

		}

		const entries = new Array( n );
		for ( let i = 0; i < n; i ++ ) entries[ i ] = { binding: i, resource: resourceOf( specs[ i ] ) };
		this.group = GPU.device.createBindGroup( { label: this.label, layout: this.layout, entries } );
		this._entry = { objs: objs.slice(), vers: vers.slice(), group: this.group };
		cache.unshift( this._entry );
		if ( cache.length > GROUP_CACHE ) cache.pop();
		return this.group;

	}

	_matches( e ) {

		const objs = this._objs, vers = this._vers, eo = e.objs, ev = e.vers;
		for ( let i = 0; i < objs.length; i ++ ) if ( objs[ i ] !== eo[ i ] || vers[ i ] !== ev[ i ] ) return false;
		return true;

	}

}

// ---------------------------------------------------------------------------------- group 0

let _frameBlock = null;
let _group0 = null;

// The frame uniform block is defined by the renderer (render/Frame.js) and registered here so
// compute shaders see the same `frame` struct.
export function setFrameUniforms( block ) {

	_frameBlock = block;
	_group0 = null;

}

export function frameUniforms() {

	return _frameBlock;

}

export function group0( stage ) {

	if ( ! _group0 ) _group0 = {};
	if ( ! _group0[ stage ] ) {

		const specs = { frame: { uniform: _frameBlock } };
		for ( const [ n, s, type ] of SAMPLERS ) specs[ n ] = { sampler: s, samplerType: type };
		_group0[ stage ] = new BindingSet( specs, stage, 'group0-' + stage );

	}

	return _group0[ stage ];

}

// group 0 for another view's frame block (same layout, own buffer)
const _viewGroups = new WeakMap();
export function group0ForBlock( block, stage = 'render' ) {

	if ( block === _frameBlock ) return group0( stage );
	let m = _viewGroups.get( block );
	if ( ! m ) _viewGroups.set( block, m = {} );
	if ( ! m[ stage ] ) {

		const specs = { frame: { uniform: block } };
		for ( const [ n, s, type ] of SAMPLERS ) specs[ n ] = { sampler: s, samplerType: type };
		m[ stage ] = new BindingSet( specs, stage, 'group0-' + block.label );

	}

	return m[ stage ];

}

// ---------------------------------------------------------------------------------- compose

// Assemble a full WGSL source: structs, group 0/1 declarations, module code, main code.
//   modules: ShaderModule[]; bindings: extra { name: spec } (material resources); code: main WGSL
// returns { code, bindings: BindingSet (group 1), group0: BindingSet }
export function composeShader( { modules = [], bindings = {}, code = '', defines = {}, stage = 'render', label = 'shader', header = '' } ) {

	const mods = collectModules( modules );
	const specs = {};
	for ( const m of mods ) for ( const k in m.bindings ) {

		if ( specs[ k ] && specs[ k ] !== m.bindings[ k ] && ! sameSpec( specs[ k ], m.bindings[ k ] ) ) throw new Error( `${ label }: binding ${ k } declared twice (${ m.name })` );
		specs[ k ] = m.bindings[ k ];

	}

	for ( const k in bindings ) specs[ k ] = bindings[ k ];
	let stageOf = null;
	let demote = null;
	if ( stage === 'render' && /@vertex\s+fn\s+vs\b/.test( code ) ) {

		// bindings only one entry point can reach are declared for that stage only (per-stage limits:
		// 12 uniform buffers, 16 sampled textures on some adapters)
		let all = '';
		for ( const m of mods ) all += m.code + '\n';
		const full = preprocess( all + code, defines );
		const usedV = reachableIdentifiers( full, 'vs' );
		const usedF = /@fragment\s+fn\s+fs\b/.test( full ) ? reachableIdentifiers( full, 'fs' ) : null;
		stageOf = {};
		for ( const k in specs ) {

			if ( ! usedV.has( k ) && ( ! usedF || usedF.has( k ) ) ) stageOf[ k ] = 'fragment';
			else if ( usedF && ! usedF.has( k ) && usedV.has( k ) ) stageOf[ k ] = 'vertex';

		}

		// still over the uniform buffer budget of a stage (frame + per-draw blocks take 2 of 12): the
		// excess blocks are bound as read-only storage buffers instead (same struct layout)
		demote = new Set();
		const limits = GPU.limits || {};
		const maxU = ( limits.maxUniformBuffersPerShaderStage || 12 ) - 2;
		const maxS = { vertex: limits.maxStorageBuffersInVertexStage ?? 4, fragment: limits.maxStorageBuffersInFragmentStage ?? limits.maxStorageBuffersPerShaderStage ?? 8 };
		const inStage = ( k, st ) => ! stageOf[ k ] || stageOf[ k ] === st;
		for ( const st of [ 'fragment', 'vertex' ] ) {

			const uniforms = Object.keys( specs ).filter( ( k ) => specs[ k ].uniform && inStage( k, st ) && ! demote.has( k ) );
			let storage = Object.keys( specs ).filter( ( k ) => ( specs[ k ].storage || demote.has( k ) ) && inStage( k, st ) ).length;
			// prefer blocks the other stage doesn't see, the smallest last-declared first
			uniforms.sort( ( a, b ) => ( stageOf[ a ] === st ? 0 : 1 ) - ( stageOf[ b ] === st ? 0 : 1 ) );
			let n = uniforms.length;
			for ( const k of uniforms ) {

				if ( n <= maxU ) break;
				if ( storage >= maxS[ st ] ) break;
				demote.add( k );
				storage ++;
				n --;

			}

		}

	}

	const set = new BindingSet( specs, stage, label + '.g1', stageOf, demote );
	const g0 = group0( stage );
	const structs = [ ...new Set( [ ...g0.structs(), ...set.structs() ] ) ];
	let src = '';
	if ( GPU.features.has( 'shader-f16' ) && defines.F16 ) src += 'enable f16;\n';
	if ( defines.CLIP_DISTANCES ) src += 'enable clip_distances;\n';
	// as three.js' WGSL builder: derivatives inside data-dependent branches are allowed (the ported
	// materials rely on it; results there are only used where the quad agrees)
	if ( ! /diagnostic\s*\(\s*off\s*,\s*derivative_uniformity/.test( header ) ) src += 'diagnostic( off, derivative_uniformity );\n';
	src += header;
	src += structs.map( ( s ) => s.wgsl ).join( '\n' ) + '\n';
	src += g0.declarations( 0 ) + '\n';
	src += set.declarations( 1 ) + '\n';
	for ( const m of mods ) src += `// ---- ${ m.name }\n${ m.code }\n`;
	src += code;
	return { code: preprocess( src, defines ), bindings: set, group0: g0, modules: mods };

}

// Identifiers reachable from function `entry` through the call graph of the top-level functions.
export function reachableIdentifiers( code, entry ) {

	const fns = new Map();
	const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
	let m;
	while ( ( m = re.exec( code ) ) ) {

		const open = code.indexOf( '{', m.index );
		if ( open < 0 ) break;
		let depth = 0, i = open;
		for ( ; i < code.length; i ++ ) {

			const c = code[ i ];
			if ( c === '{' ) depth ++;
			else if ( c === '}' && -- depth === 0 ) break;

		}

		// entry points are never called (a local variable named like one must not pull it in)
		const isEntry = /@(vertex|fragment|compute)[^;{}]*$/.test( code.slice( Math.max( 0, m.index - 80 ), m.index ) );
		if ( ! isEntry || m[ 1 ] === entry ) fns.set( m[ 1 ], code.slice( m.index, i + 1 ) );
		re.lastIndex = i + 1;

	}

	const used = new Set();
	const queue = [ entry ];
	const seen = new Set();
	while ( queue.length ) {

		const f = queue.pop();
		if ( seen.has( f ) || ! fns.has( f ) ) continue;
		seen.add( f );
		for ( const id of fns.get( f ).match( /[A-Za-z_]\w*/g ) || [] ) {

			used.add( id );
			if ( fns.has( id ) && ! seen.has( id ) ) queue.push( id );

		}

	}

	return used;

}

function sameSpec( a, b ) {

	const ka = Object.keys( a ), kb = Object.keys( b );
	return ka.length === kb.length && ka.every( ( k ) => a[ k ] === b[ k ] );

}

// Shader module creation with readable errors (line numbers + source excerpt).
const _moduleCache = new Map();

export function createShaderModule( code, label ) {

	let m = _moduleCache.get( code );
	if ( m ) return m;
	m = GPU.device.createShaderModule( { label, code } );
	_moduleCache.set( code, m );
	if ( m.getCompilationInfo ) m.getCompilationInfo().then( ( info ) => {

		const errs = info.messages.filter( ( x ) => x.type === 'error' );
		if ( ! errs.length ) return;
		const lines = code.split( '\n' );
		for ( const e of errs ) {

			const a = Math.max( 0, e.lineNum - 4 ), b = Math.min( lines.length, e.lineNum + 2 );
			const excerpt = lines.slice( a, b ).map( ( l, i ) => `${ a + i + 1 }${ a + i + 1 === e.lineNum ? '>' : ' ' } ${ l }` ).join( '\n' );
			console.error( `WGSL error in ${ label } (${ e.lineNum }:${ e.linePos }): ${ e.message }\n${ excerpt }` );

		}

	} );
	return m;

}

export { UniformBlock };
