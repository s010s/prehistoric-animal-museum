import { BufferGeometry, BufferAttribute, Mesh } from '../../engine/index.js';
import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';

// Many different instanced models in a single render object.
//
// All models ("kinds": an organism type at one level of detail) share one vertex / index
// buffer. Every frame the owner decides which instances are drawn with which kind
// (culling + LOD) and calls commit(): the instance ids of each kind are packed into one
// list and one indirect draw command per non-empty kind is written (firstIndex /
// baseVertex select the model, instanceCount the number of instances). The vertex
// shader finds its instance as list[ base[ kind ] + instance_index ], with the kind
// stored per vertex, so no per-instance vertex buffers are needed (the draw uses four
// vertex buffers) and the draws don't rely on the 'indirect-first-instance' feature.
// Per-instance data lives in a storage buffer (4 vec4 per instance, owner defined).
// Nothing is allocated per frame.
//
// The shadow pass draws only the kinds flagged `shadow` (large near corals): the
// indirect offsets are swapped in onBeforeRender when the camera is a shadow camera.
//
// Level-of-detail cross-fades (option `fade`): instances in a transition band are listed in a
// second channel instead, drawn by a second mesh over the same buffers with a material that
// screen-door dithers them (materials/LODFade.js): both levels of an instance with the same fade,
// the outgoing one keeping the complementary pixels, and the last level fading out at the far
// culling distance. The main channel's material stays free of discard (hidden surface removal).
// The fade channel casts no shadows (the main channel's shadow proxies do).
//
// WGSL port: the batch exposes `batch.module` (a ShaderModule; add it to the material's modules)
// with prefix P = batch.prefix (from the name: 'Reef.hard' -> 'reefHard', 'Fish' -> 'fish'):
//   bindings  P + 'Instances' (array<vec4f>, 4 per instance), P + 'List' / P + 'Base' (array<u32>),
//             P + 'FadeList' / P + 'FadeBase' (with `fade`)
//   fn P + 'RecordIndex'( kind: u32, instance: u32 ) -> u32
//   fn P + 'Record'( index: u32, k: u32 ) -> vec4f             (k = 0..3)
//   fn P + 'FadeEntry'( kind: u32, instance: u32 ) -> P + 'FadeInfo'   { index: u32, fade: f32, outgoing: f32 }
// The JS helpers recordIndex() / record( index ) / fadeEntry() return those calls as WGSL
// expression strings for a material `vertex` snippet (they read `v.aKind` and `v.instance`;
// declare `attributes: { aKind: 'f32', aData: 'vec4f' }` on the material).

function prefixOf( name ) {

	const parts = name.split( /[^A-Za-z0-9]+/ ).filter( Boolean );
	return parts.map( ( p, i ) => i === 0 ? p[ 0 ].toLowerCase() + p.slice( 1 ) : p[ 0 ].toUpperCase() + p.slice( 1 ) ).join( '' );

}

export class ReefBatch {

	constructor( name, kinds, { maxInstances, dynamic = false, fade = false } ) {

		this.name = name;
		this.kinds = kinds;
		const K = kinds.length;
		this.maxInstances = maxInstances;
		this.dynamic = dynamic;
		const P = this.prefix = prefixOf( name );

		// ---- merged geometry
		let nv = 0, ni = 0;
		for ( const k of kinds ) {

			nv += k.geometry.attributes.position.count;
			ni += k.geometry.index.count;

		}

		const pos = new Float32Array( nv * 3 ), nrm = new Float32Array( nv * 3 ), dat = new Float32Array( nv * 4 ), kid = new Float32Array( nv );
		const idx = new Uint32Array( ni );
		this.firstIndex = new Uint32Array( K );
		this.indexCount = new Uint32Array( K );
		this.baseVertex = new Uint32Array( K );
		let v0 = 0, i0 = 0;
		kinds.forEach( ( k, i ) => {

			const g = k.geometry;
			const n = g.attributes.position.count;
			pos.set( g.attributes.position.array, v0 * 3 );
			nrm.set( g.attributes.normal.array, v0 * 3 );
			if ( g.attributes.aData ) dat.set( g.attributes.aData.array, v0 * 4 );
			kid.fill( i, v0, v0 + n );
			idx.set( g.index.array, i0 );
			this.firstIndex[ i ] = i0;
			this.indexCount[ i ] = g.index.count;
			this.baseVertex[ i ] = v0;
			k.triangles = g.index.count / 3;
			k.vertices = n;
			v0 += n;
			i0 += g.index.count;

		} );

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
		geometry.setAttribute( 'normal', new BufferAttribute( nrm, 3 ) );
		geometry.setAttribute( 'aData', new BufferAttribute( dat, 4 ) );
		geometry.setAttribute( 'aKind', new BufferAttribute( kid, 1 ) );
		geometry.setIndex( new BufferAttribute( idx, 1 ) );
		this.vertexCount = nv;

		// ---- per-instance data (owner writes this.data, then calls upload())
		this.data = new Float32Array( maxInstances * 16 );
		this.instanceBuffer = new StorageBuffer( { label: name + '.instances', count: maxInstances * 4, type: 'vec4f' } );
		// three-style handle: `batch.dataAttr.needsUpdate = true` uploads the data
		const self = this;
		this.dataAttr = { set needsUpdate( v ) { if ( v ) self.upload(); } };

		// ---- visible instance ids, per-kind bases and the indirect commands (an instance can be
		// listed twice: drawn, and as a shadow proxy)
		const cap = maxInstances * 2;
		this.list = new Uint32Array( cap );
		this.listBuffer = new StorageBuffer( { label: name + '.list', count: cap, type: 'u32' } );
		this.baseArray = new Uint32Array( Math.max( K, 4 ) );
		this.baseBuffer = new StorageBuffer( { label: name + '.base', count: this.baseArray.length, type: 'u32' } );
		this.commands = new Uint32Array( K * 5 );
		this.indirectBuffer = new StorageBuffer( { label: name + '.indirect', count: K * 5, type: 'u32', usage: [ 'indirect' ] } );
		this.offsetPool = [ [], [] ]; // arrays of indirect offsets by length (no per-frame allocation)
		this.mainOffsets = [];
		this.shadowOffsets = [];
		geometry.indirect = { buffer: this.indirectBuffer, offsets: this.mainOffsets };
		this.geometry = geometry;

		// per-frame ( kind, id ) pairs, sorted by kind in commit()
		this.pairKind = new Uint16Array( cap );
		this.pairId = new Uint32Array( cap );
		this.pairs = 0;
		this.counts = new Uint32Array( K );
		this.cursor = new Uint32Array( K );
		this.visibleInstances = 0;
		this.visibleTriangles = 0;
		this.shadowTriangles = 0;

		this.mesh = null;
		this.fadeMesh = null;
		this.fadeOffsets = [];
		this.fadeInstances = 0;
		const bindings = {
			[ P + 'Instances' ]: { storage: this.instanceBuffer, access: 'read' },
			[ P + 'List' ]: { storage: this.listBuffer, access: 'read' },
			[ P + 'Base' ]: { storage: this.baseBuffer, access: 'read' },
		};
		let code = /* wgsl */`
fn ${ P }RecordIndex( kind: u32, instance: u32 ) -> u32 { return ${ P }List[ ${ P }Base[ kind ] + instance ]; }
fn ${ P }Record( index: u32, k: u32 ) -> vec4f { return ${ P }Instances[ index * 4u + k ]; }
`;
		if ( fade ) {

			this.fadeList = new Uint32Array( cap );
			this.fadeListBuffer = new StorageBuffer( { label: name + '.fadeList', count: cap, type: 'u32' } );
			this.fadeBaseArray = new Uint32Array( Math.max( K, 4 ) );
			this.fadeBaseBuffer = new StorageBuffer( { label: name + '.fadeBase', count: this.fadeBaseArray.length, type: 'u32' } );
			this.fadeCommands = new Uint32Array( K * 5 );
			this.fadeIndirectBuffer = new StorageBuffer( { label: name + '.fadeIndirect', count: K * 5, type: 'u32', usage: [ 'indirect' ] } );
			const fg = new BufferGeometry();
			for ( const k in geometry.attributes ) fg.setAttribute( k, geometry.attributes[ k ] );
			fg.setIndex( geometry.index );
			fg.indirect = { buffer: this.fadeIndirectBuffer, offsets: this.fadeOffsets };
			this.fadeGeometry = fg;
			this.fadeKind = new Uint16Array( cap );
			this.fadeVal = new Uint32Array( cap );
			this.fadePairs = 0;
			this.fadeCounts = new Uint32Array( K );
			this.fadeCursor = new Uint32Array( K );
			this.fadePool = [];
			bindings[ P + 'FadeList' ] = { storage: this.fadeListBuffer, access: 'read' };
			bindings[ P + 'FadeBase' ] = { storage: this.fadeBaseBuffer, access: 'read' };
			code += /* wgsl */`
struct ${ P }FadeInfo { index: u32, fade: f32, outgoing: f32 };
// fade channel: the instance record index, its fade (0..1) and whether this draw is the
// outgoing level (1) or the incoming one (0)
fn ${ P }FadeEntry( kind: u32, instance: u32 ) -> ${ P }FadeInfo {
	let e = ${ P }FadeList[ ${ P }FadeBase[ kind ] + instance ];
	return ${ P }FadeInfo( e & 0xffffffu, f32( ( e >> 24u ) & 127u ) / 127.0, f32( e >> 31u ) );
}
`;

		}

		this.module = new ShaderModule( { name: 'batch-' + P, bindings, code } );

	}

	// WGSL (vertex snippet), fade channel: expression of type P + 'FadeInfo' (index, fade, outgoing)
	fadeEntry() {

		return `${ this.prefix }FadeEntry( u32( v.aKind ), v.instance )`;

	}

	// fade channel entry: fade = share of this level that is visible (see LODFade.js)
	addFade( kind, id, fade, outgoing ) {

		const n = this.fadePairs ++;
		this.fadeKind[ n ] = kind;
		const q = Math.round( Math.min( 1, Math.max( 0, fade ) ) * 127 );
		this.fadeVal[ n ] = ( ( id & 0xffffff ) | ( q << 24 ) | ( outgoing ? 0x80000000 : 0 ) ) >>> 0;
		this.fadeCounts[ kind ] ++;

	}

	createFadeMesh( material ) {

		const mesh = new Mesh( this.fadeGeometry, material );
		mesh.name = this.name + '.fade';
		mesh.frustumCulled = false;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		const g = this.fadeGeometry;
		mesh.onBeforeRender = () => {

			g.indirect.offsets = this.fadeOffsets;

		};

		this.fadeMesh = mesh;
		return mesh;

	}

	// WGSL (vertex snippet): instance record index for the current vertex, and its 4 data vec4s
	recordIndex() {

		return `${ this.prefix }RecordIndex( u32( v.aKind ), v.instance )`;

	}

	record( index ) {

		return [ 0, 1, 2, 3 ].map( ( k ) => `${ this.prefix }Record( ${ index }, ${ k }u )` );

	}

	createMesh( material, { castShadow = false, receiveShadow = true } = {} ) {

		const mesh = new Mesh( this.geometry, material );
		mesh.name = this.name;
		mesh.frustumCulled = false;
		mesh.castShadow = castShadow;
		mesh.receiveShadow = receiveShadow;
		mesh.matrixAutoUpdate = false;
		const geometry = this.geometry;
		mesh.onBeforeRender = ( renderer, scene, camera ) => {

			// the engine's shadow cascade cameras are standard-Z (reversedDepth false)
			const shadowCam = camera && ( camera.isOrthographicCamera || camera.reversedDepth === false );
			geometry.indirect.offsets = shadowCam ? this.shadowOffsets : this.mainOffsets;

		};

		this.mesh = mesh;
		return mesh;

	}

	upload() {

		this.instanceBuffer.write( this.data );

	}

	// ---- per frame: begin(), add( kind, id ) for every drawn instance, commit()

	begin() {

		this.pairs = 0;
		this.counts.fill( 0 );
		if ( this.fadeList ) {

			this.fadePairs = 0;
			this.fadeCounts.fill( 0 );

		}

	}

	add( kind, id ) {

		const n = this.pairs ++;
		this.pairKind[ n ] = kind;
		this.pairId[ n ] = id;
		this.counts[ kind ] ++;

	}

	offsets( which, n ) {

		const pool = this.offsetPool[ which ];
		return pool[ n ] || ( pool[ n ] = new Array( n ).fill( 0 ) );

	}

	commit() {

		const K = this.kinds.length;
		const cmd = this.commands, base = this.baseArray, counts = this.counts, cursor = this.cursor;
		let n = 0, nMain = 0, nShadow = 0, tris = 0, shadowTris = 0;
		for ( let k = 0; k < K; k ++ ) {

			const c = counts[ k ];
			base[ k ] = n;
			cursor[ k ] = n;
			const o = k * 5;
			cmd[ o ] = this.indexCount[ k ];
			cmd[ o + 1 ] = c;
			cmd[ o + 2 ] = this.firstIndex[ k ];
			cmd[ o + 3 ] = this.baseVertex[ k ];
			cmd[ o + 4 ] = 0;
			if ( c > 0 ) {

				if ( this.kinds[ k ].shadow ) nShadow ++;
				if ( ! this.kinds[ k ].shadowOnly ) nMain ++;

			}

			n += c;

		}

		// counting sort of the pairs into the per-kind ranges of the list
		const list = this.list, pk = this.pairKind, pid = this.pairId;
		for ( let i = 0; i < this.pairs; i ++ ) list[ cursor[ pk[ i ] ] ++ ] = pid[ i ];
		const main = this.offsets( 0, nMain ), shadow = this.offsets( 1, nShadow );
		let im = 0, is = 0;
		for ( let k = 0; k < K; k ++ ) {

			const c = counts[ k ];
			if ( c === 0 ) continue;
			const kind = this.kinds[ k ];
			if ( ! kind.shadowOnly ) {

				main[ im ++ ] = k * 20;
				tris += c * kind.triangles;

			}

			if ( kind.shadow ) {

				shadow[ is ++ ] = k * 20;
				shadowTris += c * kind.triangles;

			}

		}

		this.mainOffsets = main;
		this.shadowOffsets = shadow;
		this.geometry.indirect.offsets = main;
		if ( this.fadeList ) this.commitFade();
		this.visibleInstances = n;
		this.visibleTriangles = tris;
		this.shadowTriangles = shadowTris;
		if ( n > 0 ) this.listBuffer.write( list.subarray( 0, n ) );
		this.baseBuffer.write( base );
		this.indirectBuffer.write( cmd );

	}

	commitFade() {

		const K = this.kinds.length;
		const cmd = this.fadeCommands, base = this.fadeBaseArray, counts = this.fadeCounts, cursor = this.fadeCursor;
		let n = 0, used = 0;
		for ( let k = 0; k < K; k ++ ) {

			const c = counts[ k ];
			base[ k ] = n;
			cursor[ k ] = n;
			const o = k * 5;
			cmd[ o ] = this.indexCount[ k ];
			cmd[ o + 1 ] = c;
			cmd[ o + 2 ] = this.firstIndex[ k ];
			cmd[ o + 3 ] = this.baseVertex[ k ];
			cmd[ o + 4 ] = 0;
			if ( c > 0 && ! this.kinds[ k ].shadowOnly ) used ++;
			n += c;

		}

		const list = this.fadeList, fk = this.fadeKind, fv = this.fadeVal;
		for ( let i = 0; i < this.fadePairs; i ++ ) list[ cursor[ fk[ i ] ] ++ ] = fv[ i ];
		const offs = this.fadePool[ used ] || ( this.fadePool[ used ] = new Array( used ).fill( 0 ) );
		let j = 0, tris = 0;
		for ( let k = 0; k < K; k ++ ) {

			if ( counts[ k ] === 0 || this.kinds[ k ].shadowOnly ) continue;
			offs[ j ++ ] = k * 20;
			tris += counts[ k ] * this.kinds[ k ].triangles;

		}

		this.fadeOffsets = offs;
		this.fadeGeometry.indirect.offsets = offs;
		this.fadeInstances = n;
		this.visibleTriangles += tris;
		if ( n > 0 ) this.fadeListBuffer.write( list.subarray( 0, n ) );
		this.fadeBaseBuffer.write( base );
		this.fadeIndirectBuffer.write( cmd );
		if ( this.fadeMesh ) this.fadeMesh.visible = used > 0;

	}

	dispose() {

		this.geometry.dispose();
		if ( this.fadeGeometry ) this.fadeGeometry.dispose();
		for ( const b of [ this.instanceBuffer, this.listBuffer, this.baseBuffer, this.indirectBuffer, this.fadeListBuffer, this.fadeBaseBuffer, this.fadeIndirectBuffer ] ) if ( b ) b.destroy();
		if ( this.mesh ) this.mesh.removeFromParent();

	}

}
