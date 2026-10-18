import { GPU } from '../gpu/GPU.js';
import { composeShader, createShaderModule, group0ForBlock } from '../gpu/Shader.js';
import { FrameUniforms } from './Frame.js';
import { commonModule } from './wgsl/common.js';
import { blendState } from './Material.js';

// A full-screen triangle with a WGSL fragment (post effects, background, blits).
//
//   const pass = new FullscreenPass( {
//     label: 'tonemap',
//     modules: [ ... ],
//     bindings: { src: { texture: () => hdrTex } },
//     code: `fn fragment( in: FSIn ) -> vec4f { return textureSampleLevel( src, smpLinearClamp, in.uv, 0.0 ); }`,
//     colorFormats: [ 'rgba16float' ],        // or the canvas format
//     blend: 'none' | 'normal' | ...,
//   } );
//   pass.render( { colorViews: [ view ], clear: [ 0, 0, 0, 1 ] } );   // own render pass
//   pass.draw( renderPassEncoder );                                      // inside an open pass (formats must match)
//
// FSIn: pos (fragment coord), uv (0..1, y down). For several outputs write the whole entry point
// instead (code containing `@fragment fn fs( in: FSIn ) -> ...`).

const VERTEX = /* wgsl */`
struct FSIn { @builtin( position ) pos: vec4f, @location( 0 ) uv: vec2f };
@vertex fn vs( @builtin( vertex_index ) i: u32 ) -> FSIn {
	let p = vec2f( f32( ( i << 1u ) & 2u ), f32( i & 2u ) );
	var o: FSIn;
	o.pos = vec4f( p * 2.0 - 1.0, FS_DEPTH, 1.0 );
	o.uv = vec2f( p.x, 1.0 - p.y );
	return o;
}
`;

export class FullscreenPass {

	constructor( { label = 'fullscreen', modules = [], bindings = {}, code, colorFormats = [ 'rgba16float' ], blend = 'none', defines = {}, depthFormat = null, depthCompare = 'always', depthWrite = false, depth = 0, writeMasks = null, blends = null } ) {

		this.label = label;
		this.colorFormats = colorFormats;
		const main = code.includes( '@fragment' ) ? code : `${ code }\n@fragment fn fs( in: FSIn ) -> @location( 0 ) vec4f { return fragment( in ); }\n`;
		const c = composeShader( { modules: [ commonModule, ...modules ], bindings, code: VERTEX.replace( 'FS_DEPTH', depth.toFixed( 6 ) ) + main, defines, stage: 'render', label } );
		this.source = c.code;
		this.bindings = c.bindings;
		const module = createShaderModule( c.code, label );
		const desc = {
			label,
			layout: GPU.device.createPipelineLayout( { bindGroupLayouts: [ c.group0.layout, c.bindings.layout ] } ),
			vertex: { module, entryPoint: 'vs' },
			fragment: { module, entryPoint: 'fs', targets: colorFormats.map( ( format, i ) => ( {
				format,
				blend: blendState( blends ? blends[ i ] : i === 0 ? blend : 'none' ),
				writeMask: writeMasks ? writeMasks[ i ] : GPUColorWrite.ALL,
			} ) ) },
			primitive: { topology: 'triangle-list' },
		};
		if ( depthFormat ) desc.depthStencil = { format: depthFormat, depthCompare, depthWriteEnabled: depthWrite };
		this.handle = GPU.renderPipeline( desc );
		this.timestampWrites = null;

	}

	get pipeline() {

		return GPU.ready( this.handle );

	}

	draw( rp, frameBlock = FrameUniforms ) {

		rp.setPipeline( GPU.ready( this.handle ) );
		rp.setBindGroup( 0, group0ForBlock( frameBlock, 'render' ).getBindGroup() );
		rp.setBindGroup( 1, this.bindings.getBindGroup() );
		rp.draw( 3 );

	}

	// colorViews: GPUTextureView[] (or Texture[]); clear: null (load) or [ r, g, b, a ]
	render( { colorViews, clear = null, viewport = null, frameBlock = FrameUniforms, depthView = null, encoder = GPU.getEncoder() } = {} ) {

		const views = colorViews.map( ( v ) => v.isTexture ? v.view( { dimension: '2d', mipLevelCount: 1 } ) : v );
		const desc = {
			label: this.label,
			colorAttachments: views.map( ( view ) => ( { view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: clear || [ 0, 0, 0, 0 ] } ) ),
		};
		if ( depthView ) desc.depthStencilAttachment = { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' };
		if ( this.timestampWrites ) desc.timestampWrites = this.timestampWrites;
		const rp = encoder.beginRenderPass( desc );
		if ( viewport ) rp.setViewport( ...viewport );
		this.draw( rp, frameBlock );
		rp.end();

	}

}
