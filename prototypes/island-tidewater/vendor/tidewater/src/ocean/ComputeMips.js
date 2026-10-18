import { ComputeKernel } from '../engine/webgpu.js';

// Box-filtered mip chain of a square power-of-two 2d / 2d-array / cube texture in two compute
// dispatches, instead of a render pass per level and layer (generateMipmaps):
//   A: 16x16 threads per 32x32 tile of level 0 -> levels 1..5 through workgroup memory
//   B: one workgroup per layer: level 5 -> the rest of the chain
// The texture needs 'storage' usage and a storage-capable float format (e.g. rgba16float).
//
//   const mips = new ComputeMips( tex, 'label' );
//   GPU.computePass( 'x', ( pass ) => mips.dispatch( pass ) );   // or mips.dispatch() (own pass)
export class ComputeMips {

	constructor( tex, label = tex.label ) {

		const res = tex.width;
		if ( tex.height !== res || res & ( res - 1 ) || res < 32 || res > 512 ) throw new Error( 'ComputeMips: square power-of-two 32..512 only' );
		this.res = res;
		this.layers = tex.dimension === '3d' ? 1 : tex.depth;
		const levels = tex.mipLevelCount;
		const top = Math.min( 5, levels - 1 );
		const out = ( l ) => ( { storageTexture: tex, access: 'write', view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );
		const src = ( l ) => ( { texture: tex, view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );
		// threads (lx, ly) < width reduce 2x2 of `from` (row 2 * width) into level lvl (and `to`)
		const reduce = ( from, to, width, lvl ) => /* wgsl */`
	if ( lx < ${ width }u && ly < ${ width }u ) {
		let i = ly * ${ 4 * width }u + lx * 2u;
		let v = ( ${ from }[ i ] + ${ from }[ i + 1u ] + ${ from }[ i + ${ 2 * width }u ] + ${ from }[ i + ${ 2 * width + 1 }u ] ) * 0.25;
		textureStore( out${ lvl }, vec2u( gx * ${ width }u + lx, gy * ${ width }u + ly ), layer, v );
		${ to ? `${ to }[ ly * ${ width }u + lx ] = v;` : '' }
	}
	workgroupBarrier();`;

		const bA = { src0: src( 0 ) };
		let codeA = '';
		for ( let l = 1; l <= top; l ++ ) bA[ 'out' + l ] = out( l );
		for ( let l = 2, w = 8; l <= top; l ++, w >>= 1 ) codeA += reduce( 's' + ( l - 1 ), l < top ? 's' + l : null, w, l );
		this.kernelA = new ComputeKernel( {
			label: label + ' mips A',
			bindings: bA,
			workgroupSize: [ 16, 16, 1 ],
			code: /* wgsl */`
var<workgroup> s1: array<vec4f, 256>;
var<workgroup> s2: array<vec4f, 64>;
var<workgroup> s3: array<vec4f, 16>;
var<workgroup> s4: array<vec4f, 4>;
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y;
	let gx = wid.x; let gy = wid.y; let layer = wid.z;
	let x1 = gx * 16u + lx; let y1 = gy * 16u + ly;
	let p = vec2u( x1, y1 ) * 2u;
	let v1 = ( textureLoad( src0, p, layer, 0 ) + textureLoad( src0, p + vec2u( 1u, 0u ), layer, 0 ) + textureLoad( src0, p + vec2u( 0u, 1u ), layer, 0 ) + textureLoad( src0, p + vec2u( 1u, 1u ), layer, 0 ) ) * 0.25;
	textureStore( out1, vec2u( x1, y1 ), layer, v1 );
	s1[ ly * 16u + lx ] = v1;
	workgroupBarrier();
${ codeA }
}`,
		} );

		// level 5 is res / 32 texels square
		this.kernelB = null;
		const w5 = res >> 5;
		if ( levels > 6 && w5 > 1 ) {

			const bB = { src5: src( 5 ) };
			let codeB = '', decl = '';
			let from = 's5';
			for ( let l = 6, w = w5 >> 1; l < levels && w >= 1; l ++, w >>= 1 ) {

				bB[ 'out' + l ] = out( l );
				const to = w > 1 && l < levels - 1 ? 's' + l : null;
				if ( to ) decl += `var<workgroup> ${ to }: array<vec4f, ${ w * w }>;\n`;
				codeB += reduce( from, to, w, l );
				from = to;

			}

			this.kernelB = new ComputeKernel( {
				label: label + ' mips B',
				bindings: bB,
				workgroupSize: [ w5, w5, 1 ],
				code: /* wgsl */`
var<workgroup> s5: array<vec4f, ${ w5 * w5 }>;
${ decl }
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y; let layer = wid.z;
	let gx = 0u; let gy = 0u;
	s5[ ly * ${ w5 }u + lx ] = textureLoad( src5, vec2u( lx, ly ), layer, 0 );
	workgroupBarrier();
${ codeB }
}`,
			} );

		}

	}

	dispatch( pass = null ) {

		const o = pass ? { pass } : undefined;
		this.kernelA.dispatch( [ this.res / 32, this.res / 32, this.layers ], o );
		if ( this.kernelB ) this.kernelB.dispatch( [ 1, 1, this.layers ], o );

	}

}
