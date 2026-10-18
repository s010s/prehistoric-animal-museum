import { Texture } from '../../engine/gpu/Texture.js';
import { FullscreenPass } from '../../engine/render/FullscreenPass.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { vegModule, f } from './VegNodes.js';

// Leaf-cluster cards baked once on the GPU (instead of evaluating the leaf shapes per fragment):
// a 2 x 2 atlas of tiles, each tile a card of many small twig-end leaf whorls (tropical almond /
// sea hibiscus style: 8-25 cm leaves clustered at the twig tips) on a jittered grid with empty
// cells, in two offset layers: clumps with sky holes, no regular pattern. 4x supersampled,
// mipmapped.
//   R coverage, G brightness structure (leaf tip lightening, midrib) / 1.4, B per-leaf random
// Tiles: 0 tree, broad leaves   1 tree, narrow leaves   2 shrub, round leaves   3 shrub, narrow leaves
//
// WGSL: materials sampling the atlas list `leafAtlas.module` and call
//   fn vegLeafSample( st: vec2f, tile: f32 ) -> vec4f   (coverage, bright, cell, 1)
export const LEAF_TILES = [
	{ grid: 4, leaves: 6, width: 0.34 },
	{ grid: 4, leaves: 8, width: 0.2 },
	{ grid: 3, leaves: 6, width: 0.45 },
	{ grid: 3, leaves: 8, width: 0.22 },
];
const SIZE = 1024;

// leaf rosettes tiled G x G over a card: each cell holds one rosette with its own rotation /
// size; leaves have a short petiole gap at the centre. Returns ( d: signed distance to the leaf
// edge (in rosette units, > 0 inside), bright, cell ).
const ROSETTE = /* wgsl */`
struct VegRosette { d: f32, bright: f32, cell: f32 };
fn vegRosette( st: vec2f, G: f32, nLeaves: f32, width: f32, rot: f32 ) -> VegRosette {
	let cuv = st * G;
	let cell = floor( cuv );
	let h1 = vegHash12( cell + rot * 17.3 );
	let h2 = vegHash12( cell * 1.7 + rot * 31.1 + 5.2 );
	let h3 = vegHash12( cell * 2.3 + rot * 7.7 + 1.9 );
	// whorls of different sizes, off the cell centres; some cells stay empty (sky holes)
	let sc = mix( 0.62, 1.05, h2 ) * select( 1.0, 0.001, h3 < 0.2 );
	let off = vec2f( h1 - 0.5, h3 - 0.5 ) * 0.34;
	let p = ( fract( cuv ) - 0.5 - off ) * 2.0 / sc;
	let r = length( p );
	let ang = atan2( p.y, p.x ) + rot + h1 * 6.2832;
	let sector = ang * ( nLeaves / 6.2832 );
	let k = floor( sector + 0.5 );
	// irregular leaf spacing and lengths so clusters don't read as flowers
	let lr = vegHash12( vec2f( k, h1 * 13.7 ) );
	let jit = ( lr - 0.5 ) * 0.8;
	let L = mix( 0.5, 1.0, fract( lr * 7.13 ) );
	// each blade curves a little to one side (leaves, not a star)
	let curve = ( fract( lr * 3.31 ) - 0.5 ) * 0.9;
	let da = ( sector - k - jit ) * ( 6.2832 / nLeaves ) - curve * ( r / L ) * ( r / L ) * 0.35;
	let along = r * cos( da );
	let across = abs( r * sin( da ) );
	let x = along / L;
	let bx = clamp( ( x - 0.18 ) / 0.82, 0.0, 1.0 ); // blade after a short petiole
	// obovate (widest beyond the middle) with a short pointed tip
	let shape = pow( max( sin( pow( bx, 0.62 ) * 3.14159 ), 0.0 ), 0.8 ) * ( smoothstep( 1.0, 0.86, bx ) * 0.25 + 0.75 );
	let hw = shape * width * L;
	let inBlade = x > 0.16 && x < 1.0;
	let dBlade = select( -1.0, hw - across, inBlade );
	let dPet = select( -1.0, 0.012 - across, x < 0.2 );
	var o: VegRosette;
	o.d = max( dBlade, dPet );
	let vein = smoothstep( 0.03, 0.0, across ) * smoothstep( 0.05, 0.25, bx ) * smoothstep( 1.0, 0.7, bx );
	o.bright = ( ( h1 * 0.7 + lr * 0.3 ) * 0.22 + 0.88 ) * mix( 0.82, 1.08, bx ) * ( vein * 0.09 + 1.0 );
	o.cell = h1 * 0.7 + lr * 0.3;
	return o;
}
`;

export class LeafAtlas {

	constructor() {

		this.texture = new Texture( { label: 'vegLeafClusters', width: SIZE, height: SIZE, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'render', 'copyDst', 'copySrc' ], sampler: 'anisoRepeat' } );
		this.rt = { dispose: () => this.texture.destroy() };
		this.baked = false;
		const self = this;
		// render targets are stored top row first (the bake flips v, like three's quad)
		this.module = new ShaderModule( {
			name: 'vegLeafAtlas', deps: [ vegModule ],
			bindings: { vegLeafTex: { texture: () => self.texture } },
			code: /* wgsl */`
// sample tile ( 0..3 ) at card uv st -> ( coverage, bright, cell, 1 )
fn vegLeafSample( st: vec2f, tile: f32 ) -> vec4f {
	let tuv = ( vec2f( fract( tile * 0.5 ) * 2.0, floor( tile * 0.5 ) ) + clamp( st, vec2f( 0.004 ), vec2f( 0.996 ) ) ) * 0.5;
	return textureSample( vegLeafTex, smpAnisoRepeat, vec2f( tuv.x, 1.0 - tuv.y ) );
}
`,
		} );

	}

	// renderer: unused (kept for the three.js signature); records into the frame encoder
	bake() {

		let body = '';
		for ( let t = 0; t < 4; t ++ ) {

			const T = LEAF_TILES[ t ];
			body += `\tif ( tid == ${ t }.0 ) {\n`;
			// 2 x 2 supersampling
			for ( let s = 0; s < 4; s ++ ) {

				const ox = ( ( s % 2 ) - 0.5 ) * px * 0.5, oy = ( Math.floor( s / 2 ) - 0.5 ) * px * 0.5;
				body += /* wgsl */`\t\t{
			let q = local + vec2f( ${ f( ox ) }, ${ f( oy ) } );
			let A = vegRosette( q, ${ f( T.grid ) }, ${ f( T.leaves ) }, ${ f( T.width ) }, 0.0 );
			let B = vegRosette( q + ${ f( 0.5 / T.grid ) }, ${ f( T.grid ) }, ${ f( T.leaves ) }, ${ f( T.width ) }, 2.1 );
			let inA = A.d > 0.0; let inB = B.d > 0.0;
			if ( inA || inB ) {
				cov += 0.25;
				bright += select( B.bright, A.bright, inA ) * 0.25;
				cellR += select( B.cell, A.cell, inA ) * 0.25;
			}
		}\n`;

			}

			body += '\t}\n';

		}

		const pass = new FullscreenPass( {
			label: 'veg leaf atlas bake',
			modules: [ vegModule ],
			colorFormats: [ 'rgba8unorm' ],
			code: ROSETTE + /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	// three's quad uv: v up
	let st = vec2f( in.uv.x, 1.0 - in.uv.y );
	let tile = floor( st * 2.0 );
	let tid = tile.x + tile.y * 2.0;
	let local = fract( st * 2.0 );
	var cov = 0.0; var bright = 0.0; var cellR = 0.0;
${ body }
	// colour channels are stored un-premultiplied (valid where covered)
	let inv = 1.0 / max( cov, 1e-3 );
	return vec4f( cov, bright * inv / 1.4, cellR * inv, 1.0 );
}
`,
		} );
		pass.render( { colorViews: [ this.texture ], clear: [ 0, 0, 0, 0 ] } );
		generateMipmaps( this.texture );
		this.baked = true;

	}

}

const px = 1 / ( SIZE / 2 ); // texel size in tile uv
