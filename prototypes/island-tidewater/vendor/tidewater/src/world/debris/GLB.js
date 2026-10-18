import { BufferGeometry, BufferAttribute, Matrix4, Matrix3, Vector3, Quaternion } from '../../engine/index.js';

// Minimal binary glTF (.glb) reader for the photoscanned debris (replaces three's GLTFLoader):
// JSON chunk + BIN chunk -> one engine BufferGeometry per mesh node, with the node's world
// transform applied (positions, normals). Handles POSITION / NORMAL / TEXCOORD_0 and the index
// accessor (float / normalized or plain 8 / 16 / 32-bit components, interleaved buffer views).
// Not handled (not used by the assets): Draco / meshopt / quantization extensions, skins, morph
// targets, sparse accessors, embedded images (the textures ship as separate JPEGs), materials.
//
//   parseGLB( arrayBuffer ) -> { meshes: [ { name, geometry } ], json }

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 1, 5126: 1 };

export function parseGLB( buffer ) {

	const dv = new DataView( buffer );
	if ( dv.getUint32( 0, true ) !== 0x46546C67 ) throw new Error( 'GLB: bad magic' );
	const length = dv.getUint32( 8, true );
	let json = null, bin = null;
	for ( let o = 12; o < length; ) {

		const len = dv.getUint32( o, true ), type = dv.getUint32( o + 4, true );
		if ( type === 0x4E4F534A ) json = JSON.parse( new TextDecoder().decode( new Uint8Array( buffer, o + 8, len ) ) );
		else if ( type === 0x004E4942 ) bin = new Uint8Array( buffer, o + 8, len );
		o += 8 + len;

	}

	if ( ! json ) throw new Error( 'GLB: no JSON chunk' );
	if ( json.extensionsRequired && json.extensionsRequired.length ) throw new Error( 'GLB: unsupported extensions ' + json.extensionsRequired.join( ', ' ) );

	// accessor -> tightly packed typed array (+ item size, normalized)
	const read = ( i ) => {

		const a = json.accessors[ i ];
		const n = COMPONENTS[ a.type ];
		const Arr = ARRAYS[ a.componentType ];
		const out = new Arr( a.count * n );
		if ( a.bufferView === undefined ) return { array: out, itemSize: n };
		const bv = json.bufferViews[ a.bufferView ];
		if ( bv.buffer !== 0 || ! bin ) throw new Error( 'GLB: external buffers are not supported' );
		const base = bin.byteOffset + ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 );
		const stride = bv.byteStride || n * Arr.BYTES_PER_ELEMENT;
		if ( stride === n * Arr.BYTES_PER_ELEMENT && base % Arr.BYTES_PER_ELEMENT === 0 ) {

			out.set( new Arr( bin.buffer, base, a.count * n ) );

		} else {

			const src = new DataView( bin.buffer );
			const get = {
				5120: ( o ) => src.getInt8( o ), 5121: ( o ) => src.getUint8( o ), 5122: ( o ) => src.getInt16( o, true ),
				5123: ( o ) => src.getUint16( o, true ), 5125: ( o ) => src.getUint32( o, true ), 5126: ( o ) => src.getFloat32( o, true ),
			}[ a.componentType ];
			for ( let k = 0; k < a.count; k ++ ) for ( let c = 0; c < n; c ++ ) out[ k * n + c ] = get( base + k * stride + c * Arr.BYTES_PER_ELEMENT );

		}

		return { array: out, itemSize: n, normalized: !! a.normalized, componentType: a.componentType };

	};

	// float attribute (normalized integers are expanded, as three does for its attributes)
	const floats = ( i ) => {

		const r = read( i );
		if ( r.array instanceof Float32Array ) return r;
		const f = new Float32Array( r.array.length );
		const k = r.normalized ? 1 / NORM[ r.componentType ] : 1;
		for ( let j = 0; j < f.length; j ++ ) f[ j ] = r.array[ j ] * k;
		return { array: f, itemSize: r.itemSize };

	};

	const meshes = [];
	const nodeMatrix = ( node ) => {

		const m = new Matrix4();
		if ( node.matrix ) return m.fromArray( node.matrix );
		const t = node.translation || [ 0, 0, 0 ], r = node.rotation || [ 0, 0, 0, 1 ], s = node.scale || [ 1, 1, 1 ];
		return m.compose( new Vector3( ...t ), new Quaternion( ...r ), new Vector3( ...s ) );

	};

	const visit = ( ni, parent ) => {

		const node = json.nodes[ ni ];
		const world = new Matrix4().multiplyMatrices( parent, nodeMatrix( node ) );
		if ( node.mesh !== undefined ) {

			const mesh = json.meshes[ node.mesh ];
			const nm = new Matrix3().getNormalMatrix( world );
			mesh.primitives.forEach( ( prim, pi ) => {

				if ( prim.mode !== undefined && prim.mode !== 4 ) return; // triangles only
				const g = new BufferGeometry();
				const at = prim.attributes;
				if ( at.POSITION !== undefined ) {

					const p = floats( at.POSITION );
					g.setAttribute( 'position', new BufferAttribute( p.array, 3 ).applyMatrix4( world ) );

				}

				if ( at.NORMAL !== undefined ) {

					const nr = floats( at.NORMAL );
					g.setAttribute( 'normal', new BufferAttribute( nr.array, 3 ).applyNormalMatrix( nm ) );

				}

				if ( at.TEXCOORD_0 !== undefined ) g.setAttribute( 'uv', new BufferAttribute( floats( at.TEXCOORD_0 ).array, 2 ) );
				if ( prim.indices !== undefined ) {

					const ix = read( prim.indices ).array;
					g.setIndex( new BufferAttribute( ix instanceof Uint8Array ? new Uint16Array( ix ) : ix, 1 ) );

				}

				meshes.push( { name: node.name || mesh.name || 'mesh' + node.mesh + ( pi ? '_' + pi : '' ), geometry: g } );

			} );

		}

		for ( const c of node.children || [] ) visit( c, world );

	};

	const scene = json.scenes ? json.scenes[ json.scene || 0 ] : { nodes: json.nodes.map( ( _, i ) => i ) };
	for ( const ni of scene.nodes ) visit( ni, new Matrix4() );
	return { meshes, json };

}
