import { GPU } from '../gpu/GPU.js';
import { composeShader, createShaderModule, getBindGroupLayout, group0ForBlock } from '../gpu/Shader.js';
import { buildMeshShader } from './MeshShader.js';
import { blendState } from './Material.js';
import { SceneLighting } from './wgsl/lighting.js';
import { FrameUniforms } from './Frame.js';
import { Frustum, Matrix4, Sphere, Vector3 } from '../math/index.js';

// Draws scene meshes: geometry upload, pipeline cache, per-draw uniforms, culling and sorting.
//
//   meshRenderer.render( scene, {
//     camera,                         // culling + sorting (its view must match frameBlock)
//     frameBlock: FrameUniforms,      // group 0 frame uniforms of this view
//     kind: 'main' | 'depth' | 'color', late: false,
//     colorViews: [ GPUTextureView... ], colorFormats: [ ... ], depthView, depthFormat,
//     clearColors: [ [ r, g, b, a ] | null ... ], clearDepth: 0 | 1 | null (null = load),
//     depthCompare: 'greater-equal',
//     layerMask: 1 << LAYER,
//     filter: ( object ) => bool,
//     after: ( pass ) => {}           // extra draws inside the same render pass (background, ...)
//   } );

const _sphere = new Sphere();
const _frustum = new Frustum();
const _vp = new Matrix4();
const _v = new Vector3();
const _camPos = new Vector3();

const _layouts = new WeakMap();
let _listToken = 0; // one per drawItems call (see BindingSet.getBindGroup)

const DRAW_STRIDE = 256; // minUniformBufferOffsetAlignment
const DRAW_FLOATS = 40;

export class MeshRenderer {

	constructor() {

		this.pipelines = new Map();
		this.geometries = new WeakMap();
		this.capacity = 8192;
		this.drawBuffer = null;
		this.drawData = null;
		this.drawCount = 0;
		this.frame = - 1;
		this.stats = { draws: 0, triangles: 0, pipelines: 0 };
		this.drawLayout = null;
		this.drawBindGroup = null;
		// true: a draw compiles its pipeline on the spot (one-off bakes, portraits, tests); the engine's
		// scene renderer sets false: pipelines compile in the background and a draw is skipped until
		// its pipeline is ready (no first-use stalls)
		this.syncPipelines = true;

	}

	_ensureDrawBuffer() {

		if ( this.drawBuffer && this.drawData.byteLength >= this.capacity * DRAW_STRIDE ) return;
		if ( this.drawBuffer ) this.drawBuffer.destroy();
		this.drawBuffer = GPU.device.createBuffer( { label: 'draws', size: this.capacity * DRAW_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
		this.drawData = new Float32Array( this.capacity * DRAW_STRIDE / 4 );
		this.drawLayout = getBindGroupLayout( [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: DRAW_FLOATS * 4 } } ], 'draw' );
		this.drawBindGroup = GPU.device.createBindGroup( { label: 'draws', layout: this.drawLayout, entries: [ { binding: 0, resource: { buffer: this.drawBuffer, size: DRAW_FLOATS * 4 } } ] } );

	}

	_beginFrame() {

		if ( this.frame === GPU.frame ) return;
		this.frame = GPU.frame;
		this._ensureDrawBuffer();
		// grow for next frame if this one came close
		if ( this.drawCount > this.capacity * 0.75 ) {

			this.capacity *= 2;
			this._ensureDrawBuffer();

		}

		this.drawCount = 0;
		GPU.onSubmit( () => {

			if ( this.drawCount ) GPU.queue.writeBuffer( this.drawBuffer, 0, this.drawData.buffer, 0, this.drawCount * DRAW_STRIDE );

		} );
		this.stats.draws = 0;
		this.stats.triangles = 0;

	}

	// per-object slot in this frame's draw buffer (shared by every pass that draws it this frame)
	_slot( obj ) {

		let g = obj.__draw;
		if ( ! g ) g = obj.__draw = { frame: - 1, slot: 0, cur: new Float32Array( 16 ), prev: new Float32Array( 16 ), has: false };
		if ( g.frame === GPU.frame ) return g.slot;
		if ( this.drawCount >= this.capacity ) throw new Error( 'MeshRenderer: draw buffer full' );
		g.frame = GPU.frame;
		g.slot = this.drawCount ++;
		const e = obj.matrixWorld.elements;
		if ( g.has && ! obj.resetVelocity ) g.prev.set( g.cur );
		else g.prev.set( e );
		g.cur.set( e );
		g.has = true;
		obj.resetVelocity = false;
		const o = g.slot * DRAW_STRIDE / 4;
		const d = this.drawData;
		d.set( g.cur, o );
		d.set( obj.staticVelocity ? g.cur : g.prev, o + 16 );
		const p = obj.drawParams;
		d[ o + 32 ] = obj.id ?? 0;
		d[ o + 33 ] = p ? p[ 0 ] : 0;
		d[ o + 34 ] = p ? p[ 1 ] : 0;
		d[ o + 35 ] = p ? p[ 2 ] : 0;
		if ( p && p.length > 3 ) for ( let i = 0; i < 4; i ++ ) d[ o + 36 + i ] = p[ 3 + i ] ?? 0;
		return g.slot;

	}

	// ------------------------------------------------------------------------------ geometry

	_geometryGPU( geometry ) {

		let g = this.geometries.get( geometry );
		if ( ! g ) {

			g = { buffers: new Map(), index: null, indexVersion: - 1 };
			this.geometries.set( geometry, g );
			if ( geometry.addEventListener ) geometry.addEventListener( 'dispose', () => {

				for ( const b of g.buffers.values() ) b.buffer.destroy();
				if ( g.index ) g.index.buffer.destroy();
				this.geometries.delete( geometry );

			} );

		}

		return g;

	}

	// GPU buffer for an attribute (or its interleaved buffer)
	_attributeBuffer( geometry, attr ) {

		const g = this._geometryGPU( geometry );
		const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
		if ( src.gpuBuffer ) return src.gpuBuffer.getGPU ? src.gpuBuffer.getGPU() : src.gpuBuffer; // storage-backed attribute
		let b = g.buffers.get( src );
		const version = src.version ?? 0;
		// unchanged since the last upload (same array, same version)
		if ( b && b.version === version && b.array === src.array ) return b.buffer;
		const conv = convertArray( attr );
		if ( ! b || b.size < conv.byteLength ) {

			if ( b ) b.buffer.destroy();
			b = { buffer: GPU.device.createBuffer( { label: attr.name || 'attribute', size: Math.max( 16, align4( conv.byteLength ) ), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } ), size: conv.byteLength, version: - 1 };
			g.buffers.set( src, b );

		}

		if ( b.version !== version ) {

			const range = src.updateRanges && src.updateRanges.length && b.version >= 0 ? src.updateRanges : null;
			if ( range && conv.array === src.array ) {

				const bpe = src.array.BYTES_PER_ELEMENT;
				for ( const r of range ) GPU.queue.writeBuffer( b.buffer, r.start * bpe, src.array.buffer, src.array.byteOffset + r.start * bpe, align4( r.count * bpe ) );
				if ( src.clearUpdateRanges ) src.clearUpdateRanges();
				else src.updateRanges.length = 0;

			} else {

				writePadded( b.buffer, conv );

			}

			b.version = version;

		}

		b.array = src.array;
		return b.buffer;

	}

	_indexBuffer( geometry ) {

		const index = geometry.index;
		if ( ! index ) return null;
		const g = this._geometryGPU( geometry );
		if ( g.indexRef && g.indexSrc === index.array && g.indexVersion === ( index.version ?? 0 ) ) return g.indexRef;
		const arr = index.array instanceof Uint16Array || index.array instanceof Uint32Array ? index.array : new Uint32Array( index.array );
		if ( ! g.index || g.index.size < arr.byteLength ) {

			if ( g.index ) g.index.buffer.destroy();
			g.index = { buffer: GPU.device.createBuffer( { label: 'index', size: Math.max( 16, align4( arr.byteLength ) ), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST } ), size: arr.byteLength };
			g.indexVersion = - 1;

		}

		if ( g.indexVersion !== ( index.version ?? 0 ) ) {

			writePadded( g.index.buffer, arr );
			g.indexVersion = index.version ?? 0;

		}

		g.indexSrc = index.array;
		g.indexRef = { buffer: g.index.buffer, format: arr instanceof Uint16Array ? 'uint16' : 'uint32' };
		return g.indexRef;

	}

	// cached _layout(): per geometry and material, checked against the attribute objects it used
	_cachedLayout( object, geometry, material ) {

		let byMat = _layouts.get( geometry );
		if ( ! byMat ) _layouts.set( geometry, byMat = new Map() );
		const inst = object.isInstancedMesh ? ( object.instanceColor ? 2 : 1 ) : 0;
		const mkey = inst ? material.id + ':' + inst : material.id;
		let e = byMat.get( mkey );
		if ( e && e.version === material.version && e.attrsVersion === geometry.attributesVersion && ( ! inst || e.instanceMatrix === object.instanceMatrix ) ) {

			const refs = e.refs, names = e.names, attrs = geometry.attributes;
			let ok = true;
			for ( let i = 0; i < names.length; i ++ ) if ( attrs[ names[ i ] ] !== refs[ i ] ) {

				ok = false;
				break;

			}

			if ( ok ) return e.vl;

		}

		const vl = this._layout( object, geometry, material );
		const names = vl.layout.filter( ( l ) => ! l.name.startsWith( 'instance' ) ).map( ( l ) => l.name );
		e = { version: material.version, attrsVersion: geometry.attributesVersion, instanceMatrix: object.instanceMatrix, names, refs: names.map( ( n ) => geometry.attributes[ n ] ), vl };
		vl.pipelines = new Map();
		byMat.set( mkey, e );
		return vl;

	}

	// vertex buffer layouts for this (material, geometry, object): only the attributes the shader reads
	_layout( object, geometry, material ) {

		const attrs = [];
		const want = [ 'position', 'normal', 'uv', 'color', ...Object.keys( material.attributes ) ];
		for ( const name of want ) {

			const a = geometry.attributes[ name ];
			if ( a && ! ( name === 'color' && ! material.vertexColors && ! material.attributes.color ) ) attrs.push( { name, attr: a } );

		}

		if ( object.isInstancedMesh ) {

			for ( let i = 0; i < 4; i ++ ) attrs.push( { name: 'instanceMatrix' + i, attr: object.instanceMatrix, column: i } );
			if ( object.instanceColor ) attrs.push( { name: 'instanceColor', attr: object.instanceColor } );

		}

		const buffers = [];
		const layout = [];
		const bufIndex = new Map();
		let loc = 0;
		for ( const e of attrs ) {

			const a = e.attr;
			const src = a.isInterleavedBufferAttribute ? a.data : a;
			const instanced = !! ( a.isInstancedBufferAttribute || src.isInstancedInterleavedBuffer || a.meshPerAttribute || src.meshPerAttribute ) || e.name.startsWith( 'instance' );
			const f = vertexFormat( a );
			let slot = bufIndex.get( src );
			if ( slot === undefined ) {

				slot = buffers.length;
				bufIndex.set( src, slot );
				const stride = a.isInterleavedBufferAttribute ? a.data.stride * f.bytesPerComponent : a.itemSize * f.bytesPerComponent;
				buffers.push( { src, attr: a, layout: { arrayStride: f.converted ? f.itemSize * 4 : stride, stepMode: instanced ? 'instance' : 'vertex', attributes: [] } } );

			}

			let offset = a.isInterleavedBufferAttribute ? a.offset * f.bytesPerComponent : 0;
			let format = f.format, wgsl = f.wgsl;
			if ( e.column !== undefined ) {

				offset = e.column * 16;
				format = 'float32x4';
				wgsl = 'vec4f';

			}

			buffers[ slot ].layout.attributes.push( { shaderLocation: loc, offset, format } );
			// standard attributes have fixed shader types
			if ( e.name === 'position' || e.name === 'normal' ) wgsl = 'vec3f';
			if ( e.name === 'uv' ) wgsl = 'vec2f';
			if ( e.name === 'color' ) wgsl = a.itemSize === 4 ? 'vec4f' : 'vec3f';
			if ( e.name === 'instanceColor' ) wgsl = 'vec3f';
			if ( material.attributes[ e.name ] ) wgsl = material.attributes[ e.name ];
			layout.push( { name: e.name, wgsl, location: loc, instanced } );
			loc ++;

		}

		const key = layout.map( ( l ) => `${ l.name }:${ l.wgsl }` ).join( ',' ) + '|' + buffers.map( ( b ) => `${ b.layout.arrayStride }/${ b.layout.stepMode }/${ b.layout.attributes.map( ( x ) => x.format + '@' + x.offset ).join( ';' ) }` ).join( ',' );
		return { key, layout, buffers };

	}

	// ------------------------------------------------------------------------------ pipelines

	// the pipeline of ( material, vertex layout, pass ); the material key is computed once per frame
	_pipeline( material, vl, pass ) {

		if ( material.__pkFrame !== GPU.frame ) {

			material.__pk = material.pipelineKey() + '|' + SceneLighting.version;
			material.__pkFrame = GPU.frame;

		}

		const passKey = pass.passKey;
		let c = vl.pipelines && vl.pipelines.get( passKey );
		if ( c && c.materialKey === material.__pk ) return c.p;
		const key = `${ material.__pk }|${ vl.key }|${ passKey }`;
		let p = this.pipelines.get( key );
		if ( ! p ) p = this._createPipeline( material, vl, pass, key );
		if ( vl.pipelines ) vl.pipelines.set( passKey, { materialKey: material.__pk, p } );
		return p;

	}

	_createPipeline( material, vl, pass, key ) {

		const src = buildMeshShader( material, vl.layout, pass );
		const c = composeShader( { modules: src.modules, bindings: src.bindings, code: src.code, defines: src.defines, stage: 'render', label: material.name } );
		const module = createShaderModule( c.code, material.name );
		this._ensureDrawBuffer();
		const layout = GPU.device.createPipelineLayout( { bindGroupLayouts: [ c.group0.layout, c.bindings.layout, this.drawLayout ] } );

		const blend = blendState( material.blending );
		let targets = [];
		if ( pass.kind === 'main' ) {

			targets = [
				{ format: pass.colorFormats[ 0 ], blend: material.transparent || pass.late ? blend : undefined, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
				{ format: pass.colorFormats[ 1 ], blend: pass.late ? blendState( 'premultiplied' ) : undefined, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
				{ format: pass.colorFormats[ 2 ], blend: blendState( 'normal' ), writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
			];

		} else if ( pass.kind === 'color' ) {

			targets = pass.colorFormats.map( ( format ) => ( { format, blend, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 } ) );

		}

		const side = material.side;
		const cullMode = pass.cullOverride || ( side === 'double' ? 'none' : side === 'back' ? 'front' : 'back' );
		const depthCompare = material.depthTest ? ( material.depthCompare || pass.depthCompare ) : 'always';
		const desc = {
			label: material.name + ' ' + pass.kind,
			layout,
			vertex: { module, entryPoint: 'vs', buffers: vl.buffers.map( ( b ) => b.layout ) },
			primitive: { topology: material.topology, cullMode, frontFace: 'ccw' },
		};
		if ( src.hasFragment ) desc.fragment = { module, entryPoint: 'fs', targets };
		if ( pass.depthFormat ) desc.depthStencil = {
			format: pass.depthFormat,
			depthWriteEnabled: material.depthWrite,
			depthCompare,
			depthBias: pass.kind === 'depth' ? ( pass.depthBias || 0 ) : material.depthBias,
			depthBiasSlopeScale: pass.kind === 'depth' ? ( pass.depthBiasSlopeScale || 0 ) : material.depthBiasSlopeScale,
		};
		// compiled in the background: the draw is skipped until it is ready (see GPU.renderPipeline)
		const p = { handle: GPU.renderPipeline( desc ), bindings: c.bindings, label: desc.label };
		this.pipelines.set( key, p );
		this.stats.pipelines = this.pipelines.size;
		return p;

	}

	// ------------------------------------------------------------------------------ draw lists

	collect( scene, { camera, layerMask = 0xffffffff, filter = null, kind = 'main', cull = true } ) {

		const opaque = [];
		const transparent = [];
		if ( camera ) {

			camera.updateMatrixWorld();
			_vp.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse.copy( camera.matrixWorld ).invert() );
			_frustum.setFromProjectionMatrix( _vp, camera.reversedDepth !== false );
			_camPos.setFromMatrixPosition( camera.matrixWorld );

		}

		// precompile: every mesh of the pass, hidden or not (builds all pipelines behind the loading screen)
		const all = this.precompiling;
		const visit = ( o ) => {

			if ( ! o.visible && ! all ) return;
			if ( o.isMesh && o.material && o.geometry && ( o.layers.mask & layerMask ) !== 0 && ( ! filter || filter( o ) ) && ( kind !== 'depth' || o.castShadow ) ) {

				if ( all || ! cull || ! camera || o.frustumCulled === false || this._inFrustum( o ) ) {

					// ported systems use this for their own LOD / culling (called per pass, as three does)
					if ( o.onBeforeRender ) o.onBeforeRender( null, null, camera, o.geometry, o.material, null );
					if ( o.visible || all ) this._addItems( o, opaque, transparent );

				}

			}

			for ( const c of o.children ) visit( c );

		};

		scene.updateMatrixWorld();
		visit( scene );
		opaque.sort( ( a, b ) => a.renderOrder - b.renderOrder || a.pipeKey - b.pipeKey || a.z - b.z );
		transparent.sort( ( a, b ) => a.renderOrder - b.renderOrder || b.z - a.z );
		return { opaque, transparent };

	}

	_inFrustum( o ) {

		let s = null;
		if ( o.isInstancedMesh ) {

			if ( ! o.boundingSphere && o.computeBoundingSphere ) o.computeBoundingSphere();
			s = o.boundingSphere;

		} else {

			if ( ! o.geometry.boundingSphere ) o.geometry.computeBoundingSphere();
			s = o.geometry.boundingSphere;

		}

		if ( ! s || s.radius < 0 || ! Number.isFinite( s.radius ) ) return true;
		_sphere.copy( s ).applyMatrix4( o.matrixWorld );
		return _frustum.intersectsSphere( _sphere );

	}

	_addItems( o, opaque, transparent ) {

		const geo = o.geometry;
		const mats = Array.isArray( o.material ) ? o.material : null;
		const z = _v.setFromMatrixPosition( o.matrixWorld ).distanceToSquared( _camPos );
		const push = ( material, start, count ) => {

			if ( ! material || ( ! material.visible && ! this.precompiling ) ) return;
			const item = { object: o, geometry: geo, material, start, count, z, renderOrder: o.renderOrder || 0, pipeKey: material.id };
			( material.transparent ? transparent : opaque ).push( item );

		};

		const range = geo.drawRange || { start: 0, count: Infinity };
		if ( mats && geo.groups && geo.groups.length ) {

			for ( const g of geo.groups ) {

				const start = Math.max( g.start, range.start );
				const end = Math.min( g.start + g.count, range.start + range.count );
				if ( end > start ) push( mats[ g.materialIndex ], start, end - start );

			}

		} else {

			push( mats ? mats[ 0 ] : o.material, range.start, range.count );

		}

	}

	// ------------------------------------------------------------------------------ render

	render( scene, pass ) {

		this._beginFrame();
		pass = {
			kind: 'main', late: false, colorFormats: [], depthFormat: null, depthCompare: 'greater-equal',
			frameBlock: FrameUniforms, layerMask: 0xffffffff, ...pass,
		};
		pass.passKey = `${ pass.kind }.${ pass.late ? 1 : 0 }.${ pass.colorFormats.join( ',' ) }.${ pass.depthFormat }.${ pass.depthCompare }.${ pass.cullOverride || '' }.${ pass.defines ? JSON.stringify( pass.defines ) : '' }`;
		const lists = pass.items || this.collect( scene, pass );
		const enc = GPU.getEncoder();
		const colorAttachments = ( pass.colorViews || [] ).map( ( view, i ) => {

			const clear = pass.clearColors ? pass.clearColors[ i ] : null;
			return { view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: clear || [ 0, 0, 0, 0 ] };

		} );
		const desc = { label: pass.label || pass.kind, colorAttachments };
		if ( pass.depthView ) desc.depthStencilAttachment = {
			view: pass.depthView,
			depthLoadOp: pass.clearDepth === null || pass.clearDepth === undefined ? 'load' : 'clear',
			depthStoreOp: 'store',
			depthClearValue: pass.clearDepth ?? 0,
		};
		if ( pass.timestampWrites ) desc.timestampWrites = pass.timestampWrites;
		const rp = enc.beginRenderPass( desc );
		if ( pass.viewport ) rp.setViewport( ...pass.viewport );
		rp.setBindGroup( 0, group0ForBlock( pass.frameBlock, 'render' ).getBindGroup() );
		this.drawItems( rp, lists.opaque, pass );
		if ( pass.betweenLists ) pass.betweenLists( rp );
		this.drawItems( rp, lists.transparent, pass );
		if ( pass.after ) pass.after( rp );
		rp.end();

	}

	drawItems( rp, items, pass ) {

		let lastPipeline = null, lastGroup = null;
		const token = ++ _listToken;
		for ( const it of items ) {

			const { object: o, geometry: geo, material } = it;
			if ( ! geo.attributes.position && ! geo.vertexCount && ! geo.indirect ) continue;
			let vl, p;
			if ( this.precompiling ) {

				// a hidden mesh may not be drawable yet: its pipeline is optional
				try {

					vl = this._cachedLayout( o, geo, material );
					p = this._pipeline( material, vl, pass );

				} catch ( e ) {

					continue;

				}

				continue; // only the pipelines are wanted

			}

			vl = this._cachedLayout( o, geo, material );
			p = this._pipeline( material, vl, pass );
			const pipeline = p.handle.pipeline || ( this.syncPipelines ? GPU.ready( p.handle ) : null );
			if ( ! pipeline ) continue; // still compiling
			if ( p !== lastPipeline ) {

				rp.setPipeline( pipeline );
				lastPipeline = p;

			}

			const group = p.bindings.getBindGroup( token );
			if ( group !== lastGroup ) {

				rp.setBindGroup( 1, group );
				lastGroup = group;

			}

			rp.setBindGroup( 2, this.drawBindGroup, [ this._slot( o ) * DRAW_STRIDE ] );
			for ( let i = 0; i < vl.buffers.length; i ++ ) rp.setVertexBuffer( i, this._attributeBuffer( geo, vl.buffers[ i ].attr ) );
			const instances = o.isInstancedMesh ? o.count : geo.instanceCount ?? 1;
			if ( instances === 0 ) continue;
			const index = this._indexBuffer( geo );
			if ( geo.indirect ) {

				const ib = geo.indirect.buffer.getGPU ? geo.indirect.buffer.getGPU() : geo.indirect.buffer;
				// `offsets`: several indirect commands (byte offsets) in one buffer, drawn in turn
				// (three's geometry.setIndirect( attr, offsets ) multi-draw)
				const offs = geo.indirect.offsets || [ geo.indirect.offset || 0 ];
				if ( index ) rp.setIndexBuffer( index.buffer, index.format );
				for ( const off of offs ) {

					if ( index ) rp.drawIndexedIndirect( ib, off );
					else rp.drawIndirect( ib, off );
					this.stats.draws ++;

				}

				continue;

			}

			if ( index ) {

				const count = Math.min( it.count, geo.index.count - it.start );
				if ( count <= 0 ) continue;
				rp.setIndexBuffer( index.buffer, index.format );
				rp.drawIndexed( count, instances === Infinity ? 1 : instances, it.start, 0, 0 );
				this.stats.triangles += count / 3 * instances;

			} else {

				const total = geo.attributes.position ? geo.attributes.position.count : geo.vertexCount;
				const count = Math.min( it.count, total - it.start );
				if ( count <= 0 ) continue;
				rp.draw( count, instances, it.start, 0 );
				this.stats.triangles += count / 3 * instances;

			}

			this.stats.draws ++;

		}

	}

}

// ---------------------------------------------------------------------------------- formats

function align4( n ) {

	return Math.ceil( n / 4 ) * 4;

}

function writePadded( buffer, arr ) {

	if ( arr.byteLength % 4 === 0 ) {

		GPU.queue.writeBuffer( buffer, 0, arr.buffer, arr.byteOffset, arr.byteLength );
		return;

	}

	const padded = new Uint8Array( align4( arr.byteLength ) );
	padded.set( new Uint8Array( arr.buffer, arr.byteOffset, arr.byteLength ) );
	GPU.queue.writeBuffer( buffer, 0, padded );

}

const _convCache = new WeakMap();

// the attribute's array as uploaded (8/16-bit arrays with itemSize 1 or 3 are widened to float32)
function convertArray( attr ) {

	const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
	const f = vertexFormat( attr );
	if ( ! f.converted ) return src.array;
	let c = _convCache.get( src );
	if ( c && c.version === src.version ) return c.array;
	const n = attr.count, k = attr.itemSize;
	const out = new Float32Array( n * k );
	const div = attr.normalized ? normDiv( src.array ) : 1;
	for ( let i = 0; i < n * k; i ++ ) out[ i ] = src.array[ i ] / div;
	_convCache.set( src, { version: src.version, array: out } );
	return out;

}

function normDiv( a ) {

	if ( a instanceof Uint8Array ) return 255;
	if ( a instanceof Int8Array ) return 127;
	if ( a instanceof Uint16Array ) return 65535;
	if ( a instanceof Int16Array ) return 32767;
	return 1;

}

function vertexFormat( attr ) {

	const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
	const a = src.array;
	const k = attr.itemSize;
	const n = attr.normalized;
	const vec = ( base ) => k === 1 ? base : `vec${ k }${ base === 'f32' ? 'f' : base === 'u32' ? 'u' : 'i' }`;
	if ( a instanceof Float32Array ) return { format: k === 1 ? 'float32' : `float32x${ k }`, wgsl: vec( 'f32' ), bytesPerComponent: 4, itemSize: k };
	if ( a instanceof Uint32Array ) return { format: k === 1 ? 'uint32' : `uint32x${ k }`, wgsl: vec( 'u32' ), bytesPerComponent: 4, itemSize: k };
	if ( a instanceof Int32Array ) return { format: k === 1 ? 'sint32' : `sint32x${ k }`, wgsl: vec( 'i32' ), bytesPerComponent: 4, itemSize: k };
	const small = { Uint8Array: [ 'uint8', 'unorm8', 1 ], Int8Array: [ 'sint8', 'snorm8', 1 ], Uint16Array: [ 'uint16', 'unorm16', 2 ], Int16Array: [ 'sint16', 'snorm16', 2 ] }[ a.constructor.name ];
	if ( small && ( k === 2 || k === 4 ) && ! attr.isInterleavedBufferAttribute ) {

		const fmt = ( n ? small[ 1 ] : small[ 0 ] ) + 'x' + k;
		const wgsl = n ? vec( 'f32' ) : vec( a instanceof Uint8Array || a instanceof Uint16Array ? 'u32' : 'i32' );
		return { format: fmt, wgsl, bytesPerComponent: small[ 2 ], itemSize: k };

	}

	return { format: k === 1 ? 'float32' : `float32x${ k }`, wgsl: vec( 'f32' ), bytesPerComponent: 4, itemSize: k, converted: true };

}
