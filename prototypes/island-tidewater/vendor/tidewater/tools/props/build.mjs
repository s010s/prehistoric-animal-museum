// Builds the vendor-stall assets in public/models/props/ from Poly Haven (CC0) downloads:
//   node tools/props/build.mjs            (after python3 tools/props/fetch.py)
//
//   props.bin / props.json   every prop model merged into one vertex + index buffer:
//                            vertex = position (3), normal (3), uv (2), texture layer (1) floats;
//                            props.json lists each model's range and bounds, and the layer names
//   p_<layer>_{a,n,r}.jpg    prop textures, 512 px: albedo (sRGB), OpenGL normal, ARM
//                            (R occlusion, G roughness, B metalness), one set per model material
//   s_<name>_{a,n,r}.jpg     tiling surface textures (planks, corrugated iron, painted timber), 1K
//   signs.png                hand-lettered signs, chalk prices and the scale dial (RGBA: paint
//                            colour + coverage), drawn with ImageMagick and OFL / Apache fonts
//
// Needs ImageMagick (magick) on the PATH. Raw downloads: tools/props/.raw (see fetch.py).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname( fileURLToPath( import.meta.url ) );
const RAW = process.env.RAW || path.join( HERE, '.raw' );
const OUT = path.join( HERE, '../../public/models/props' );
const PROP_SIZE = 512, SURF_SIZE = 1024;

export const MODELS = [
	'wooden_crate_02', 'wooden_crate_01', 'wooden_bucket_01', 'fish_knife', 'wooden_cutting_board', 'lifebuoy',
	'wooden_lantern_01', 'fishermans_hat', 'WoodenTable_03', 'metal_jerrycan_green', 'plastic_jerrycan', 'life_jacket',
	'metal_toolbox', 'wooden_display_shelves_01',
];
export const SURFACES = [ 'weathered_brown_planks', 'weathered_planks', 'worn_corrugated_iron', 'weathered_peeling_timber' ];

fs.mkdirSync( OUT, { recursive: true } );
const magick = ( ...a ) => execFileSync( 'magick', a, { stdio: [ 'ignore', 'ignore', 'inherit' ] } );

// ---------------------------------------------------------------- surfaces
for ( const s of SURFACES ) {

	const src = ( m ) => path.join( RAW, 'tex', s, `${ s }_${ m }.jpg` );
	magick( src( 'Diffuse' ), '-resize', `${ SURF_SIZE }x${ SURF_SIZE }!`, '-quality', '88', path.join( OUT, `s_${ s }_a.jpg` ) );
	magick( src( 'nor_gl' ), '-resize', `${ SURF_SIZE }x${ SURF_SIZE }!`, '-quality', '92', path.join( OUT, `s_${ s }_n.jpg` ) );
	magick( src( 'arm' ), '-resize', `${ SURF_SIZE }x${ SURF_SIZE }!`, '-quality', '90', path.join( OUT, `s_${ s }_r.jpg` ) );

}

// ---------------------------------------------------------------- models
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array, 5120: Int8Array, 5122: Int16Array };

function readAccessor( gltf, bin, i ) {

	const a = gltf.accessors[ i ], bv = gltf.bufferViews[ a.bufferView ];
	const n = COMP[ a.type ], T = TYPED[ a.componentType ];
	const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
	const out = new Float64Array( a.count * n );
	const dv = new DataView( bin.buffer, bin.byteOffset + ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 ) );
	const get = { 5126: 'getFloat32', 5125: 'getUint32', 5123: 'getUint16', 5121: 'getUint8', 5122: 'getInt16', 5120: 'getInt8' }[ a.componentType ];
	for ( let k = 0; k < a.count; k ++ ) for ( let c = 0; c < n; c ++ ) out[ k * n + c ] = dv[ get ]( k * stride + c * T.BYTES_PER_ELEMENT, true );
	return out;

}

function mat4FromNode( n ) {

	if ( n.matrix ) return n.matrix.slice();
	const [ x, y, z, w ] = n.rotation || [ 0, 0, 0, 1 ];
	const [ sx, sy, sz ] = n.scale || [ 1, 1, 1 ];
	const [ tx, ty, tz ] = n.translation || [ 0, 0, 0 ];
	const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
	return [
		( 1 - ( yy + zz ) ) * sx, ( xy + wz ) * sx, ( xz - wy ) * sx, 0,
		( xy - wz ) * sy, ( 1 - ( xx + zz ) ) * sy, ( yz + wx ) * sy, 0,
		( xz + wy ) * sz, ( yz - wx ) * sz, ( 1 - ( xx + yy ) ) * sz, 0,
		tx, ty, tz, 1,
	];

}

const mul = ( a, b ) => {

	const o = new Array( 16 ).fill( 0 );
	for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < 4; r ++ ) for ( let k = 0; k < 4; k ++ ) o[ c * 4 + r ] += a[ k * 4 + r ] * b[ c * 4 + k ];
	return o;

};

const layers = [];
const verts = [], idx = [];
const props = {};
for ( const m of MODELS ) {

	// geometry from the decimated copy when there is one (decimate.py), textures from the original
	const dir = path.join( RAW, 'mod', m ), decDir = path.join( RAW, 'dec', m );
	const orig = JSON.parse( fs.readFileSync( path.join( dir, m + '.gltf' ), 'utf8' ) );
	const useDec = fs.existsSync( path.join( decDir, m + '.gltf' ) );
	const gltf = useDec ? JSON.parse( fs.readFileSync( path.join( decDir, m + '.gltf' ), 'utf8' ) ) : orig;
	const bin = fs.readFileSync( path.join( useDec ? decDir : dir, gltf.buffers[ 0 ].uri ) );
	// one texture layer per material of the original
	const origLayer = orig.materials.map( ( mat, k ) => {

		const img = ( t ) => t ? path.join( dir, orig.images[ orig.textures[ t.index ].source ].uri ) : null;
		const pbr = mat.pbrMetallicRoughness || {};
		const name = `${ m }_${ k }`;
		const a = img( pbr.baseColorTexture ), n = img( mat.normalTexture ), r = img( pbr.metallicRoughnessTexture ) || img( mat.occlusionTexture );
		const R = `${ PROP_SIZE }x${ PROP_SIZE }!`;
		if ( a ) magick( a, '-alpha', 'off', '-resize', R, '-quality', '88', path.join( OUT, `p_${ name }_a.jpg` ) );
		else magick( '-size', R, 'xc:#808080', path.join( OUT, `p_${ name }_a.jpg` ) );
		if ( n ) magick( n, '-resize', R, '-quality', '92', path.join( OUT, `p_${ name }_n.jpg` ) );
		else magick( '-size', R, 'xc:#8080ff', path.join( OUT, `p_${ name }_n.jpg` ) );
		if ( r ) magick( r, '-resize', R, '-quality', '90', path.join( OUT, `p_${ name }_r.jpg` ) );
		else magick( '-size', R, 'xc:#ffc000', path.join( OUT, `p_${ name }_r.jpg` ) );
		layers.push( name );
		return layers.length - 1;

	} );
	// the decimated file's materials are placeholders: match them to the original's by name
	const matLayer = ( gltf.materials || [ {} ] ).map( ( mat, k ) => {

		const i = orig.materials.findIndex( ( o ) => o.name === mat.name );
		return origLayer[ i >= 0 ? i : Math.min( k, origLayer.length - 1 ) ];

	} );

	const vOff = verts.length / 9, iOff = idx.length;
	const min = [ 1e9, 1e9, 1e9 ], max = [ - 1e9, - 1e9, - 1e9 ];
	const visit = ( ni, parent ) => {

		const node = gltf.nodes[ ni ];
		const M = mul( parent, mat4FromNode( node ) );
		if ( node.mesh !== undefined ) for ( const p of gltf.meshes[ node.mesh ].primitives ) {

			const P = readAccessor( gltf, bin, p.attributes.POSITION );
			const N = readAccessor( gltf, bin, p.attributes.NORMAL );
			const UV = p.attributes.TEXCOORD_0 !== undefined ? readAccessor( gltf, bin, p.attributes.TEXCOORD_0 ) : new Float64Array( P.length / 3 * 2 );
			const I = readAccessor( gltf, bin, p.indices );
			const base = verts.length / 9;
			const layer = matLayer[ p.material ?? 0 ];
			for ( let k = 0; k < P.length / 3; k ++ ) {

				const x = P[ k * 3 ], y = P[ k * 3 + 1 ], z = P[ k * 3 + 2 ];
				const wx = M[ 0 ] * x + M[ 4 ] * y + M[ 8 ] * z + M[ 12 ], wy = M[ 1 ] * x + M[ 5 ] * y + M[ 9 ] * z + M[ 13 ], wz = M[ 2 ] * x + M[ 6 ] * y + M[ 10 ] * z + M[ 14 ];
				const a = N[ k * 3 ], b = N[ k * 3 + 1 ], c = N[ k * 3 + 2 ];
				let nx = M[ 0 ] * a + M[ 4 ] * b + M[ 8 ] * c, ny = M[ 1 ] * a + M[ 5 ] * b + M[ 9 ] * c, nz = M[ 2 ] * a + M[ 6 ] * b + M[ 10 ] * c;
				const l = Math.hypot( nx, ny, nz ) || 1;
				nx /= l; ny /= l; nz /= l;
				verts.push( wx, wy, wz, nx, ny, nz, UV[ k * 2 ], UV[ k * 2 + 1 ], layer );
				min[ 0 ] = Math.min( min[ 0 ], wx ); min[ 1 ] = Math.min( min[ 1 ], wy ); min[ 2 ] = Math.min( min[ 2 ], wz );
				max[ 0 ] = Math.max( max[ 0 ], wx ); max[ 1 ] = Math.max( max[ 1 ], wy ); max[ 2 ] = Math.max( max[ 2 ], wz );

			}

			for ( const i of I ) idx.push( base - vOff + i );

		}

		for ( const c of node.children || [] ) visit( c, M );

	};

	const I4 = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
	for ( const r of gltf.scenes[ gltf.scene || 0 ].nodes ) visit( r, I4 );
	props[ m ] = { vOff, vCount: verts.length / 9 - vOff, iOff, iCount: idx.length - iOff, min: min.map( ( v ) => + v.toFixed( 4 ) ), max: max.map( ( v ) => + v.toFixed( 4 ) ) };

}

const vb = new Float32Array( verts ), ib = new Uint32Array( idx );
const buf = Buffer.alloc( vb.byteLength + ib.byteLength );
Buffer.from( vb.buffer ).copy( buf, 0 );
Buffer.from( ib.buffer ).copy( buf, vb.byteLength );
fs.writeFileSync( path.join( OUT, 'props.bin' ), buf );
fs.writeFileSync( path.join( OUT, 'props.json' ), JSON.stringify( { vertexFloats: 9, vertexCount: vb.length / 9, indexCount: ib.length, indexByteOffset: vb.byteLength, layers, props }, null, '\t' ) );
console.log( 'props', Object.keys( props ).length, 'layers', layers.length, 'vertices', vb.length / 9, 'triangles', ib.length / 3 );

// ---------------------------------------------------------------- signs (2048 x 1024, RGBA)
//   rows: [0, 256) "JOE'S FRESH FISH", [256, 512) "MARTA'S CHANDLERY" + "BAIT · TACKLE · FUEL",
//   [512, 1024) left: chalk prices (1024 x 512), right: the scale dial (512 x 512) + spare
const FONT = path.join( HERE, 'fonts' );
const signs = path.join( OUT, 'signs.png' );
magick(
	'-size', '2048x1024', 'xc:none',
	// Joe
	'-font', path.join( FONT, 'PermanentMarker-Regular.ttf' ),
	'-fill', '#f1ead6', '-pointsize', '150', '-gravity', 'NorthWest', '-annotate', '+190+40', 'JOE\'S FRESH FISH',
	// a painted fish either side
	'-fill', '#e2a53a', '-draw', 'ellipse 64,130 44,22 0,360', '-draw', 'polygon 100,130 134,106 134,154',
	'-draw', 'ellipse 1968,130 50,24 0,360', '-draw', 'polygon 1928,130 1898,104 1898,156',
	// Marta
	'-fill', '#f4e7c4', '-pointsize', '118', '-annotate', '+110+262', 'MARTA\'S CHANDLERY',
	'-fill', '#e8b04a', '-pointsize', '72', '-annotate', '+300+398', 'BAIT  ·  TACKLE  ·  FUEL',
	// chalk prices
	'-font', path.join( FONT, 'CabinSketch-Bold.ttf' ), '-fill', '#ecebe4',
	'-pointsize', '84', '-annotate', '+60+540', 'TODAY  WE BUY',
	'-pointsize', '54', '-annotate', '+70+650', 'Red snapper ....... $18/kg',
	'-annotate', '+70+720', 'Hogfish ............. $16/kg',
	'-annotate', '+70+790', 'Yellowtail .......... $12/kg',
	'-annotate', '+70+860', 'Grunt  $7    Jack  $6',
	'-annotate', '+70+930', 'Tuna / Mahi ... ASK JOE',
	signs,
);
// scale dial: white enamel face, ticks and numbers 0-25 kg, drawn at 512 x 512 and composited
const dial = path.join( OUT, '.dial.png' );
const ticks = [];
for ( let i = 0; i <= 50; i ++ ) {

	const a = ( - 150 + i * 6 ) * Math.PI / 180, r0 = i % 10 === 0 ? 170 : i % 2 === 0 ? 186 : 194, r1 = 210;
	ticks.push( '-draw', `line ${ 256 + Math.sin( a ) * r0 },${ 256 - Math.cos( a ) * r0 } ${ 256 + Math.sin( a ) * r1 },${ 256 - Math.cos( a ) * r1 }` );

}

const nums = [];
for ( let i = 0; i <= 5; i ++ ) {

	// (the text box's top-left corner: centre each number on its spot)
	const a = ( - 150 + i * 60 ) * Math.PI / 180, r = 128, t = String( i * 5 ), w = 24 * t.length;
	nums.push( '-annotate', `+${ Math.round( 256 + Math.sin( a ) * r - w / 2 ) }+${ Math.round( 256 - Math.cos( a ) * r - 30 ) }`, t );

}

magick( '-size', '512x512', 'xc:none', '-fill', '#e9e4d6', '-draw', 'circle 256,256 256,24',
	'-stroke', '#1c1c1c', '-strokewidth', '5', ...ticks, '-stroke', 'none',
	'-fill', '#1c1c1c', '-font', path.join( FONT, 'Oswald.ttf' ), '-pointsize', '52', '-gravity', 'NorthWest', ...nums,
	'-pointsize', '40', '-annotate', '+238+300', 'kg', dial );
magick( signs, dial, '-geometry', '+1536+512', '-composite', signs );
fs.unlinkSync( dial );
console.log( 'signs.png' );
