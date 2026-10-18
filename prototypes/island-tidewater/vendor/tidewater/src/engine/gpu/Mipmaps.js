import { GPU } from './GPU.js';

// Box-filtered mip chain generation for 2d / 2d-array / cube textures with a filterable,
// renderable format (render pass per level and layer). Storage-written textures that need a
// custom downsample (e.g. the FFT maps) do their own.

const _pipelines = new Map();
let _module = null;

function pipelineFor( format ) {

	let p = _pipelines.get( format );
	if ( p ) return p;
	if ( ! _module ) _module = GPU.device.createShaderModule( { label: 'mipmap', code: /* wgsl */`
		struct VSOut { @builtin( position ) pos: vec4f, @location( 0 ) uv: vec2f };
		@vertex fn vs( @builtin( vertex_index ) i: u32 ) -> VSOut {
			let p = vec2f( f32( ( i << 1u ) & 2u ), f32( i & 2u ) );
			var o: VSOut;
			o.pos = vec4f( p * 2.0 - 1.0, 0.0, 1.0 );
			o.uv = vec2f( p.x, 1.0 - p.y );
			return o;
		}
		@group( 0 ) @binding( 0 ) var src: texture_2d<f32>;
		@group( 0 ) @binding( 1 ) var smp: sampler;
		@fragment fn fs( in: VSOut ) -> @location( 0 ) vec4f {
			return textureSampleLevel( src, smp, in.uv, 0.0 );
		}
	` } );
	p = GPU.device.createRenderPipeline( {
		label: 'mipmap ' + format,
		layout: 'auto',
		vertex: { module: _module, entryPoint: 'vs' },
		fragment: { module: _module, entryPoint: 'fs', targets: [ { format } ] },
		primitive: { topology: 'triangle-list' },
	} );
	_pipelines.set( format, p );
	return p;

}

// per texture: the views, bind groups and pass descriptors of each level/layer, rebuilt when the
// GPUTexture changes (textures regenerated every frame, e.g. the caustics, reuse them)
const _chains = new WeakMap();

function chainFor( texture, g, pipeline ) {

	let c = _chains.get( texture );
	if ( c && c.gpu === g ) return c;
	const levels = texture.mipLevelCount;
	const layers = texture.dimension === '3d' ? 1 : texture.depth;
	const steps = [];
	const layout = pipeline.getBindGroupLayout( 0 );
	for ( let layer = 0; layer < layers; layer ++ ) {

		for ( let m = 1; m < levels; m ++ ) {

			const src = g.createView( { dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 } );
			const dst = g.createView( { dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 } );
			const bg = GPU.device.createBindGroup( { label: 'mipmap ' + texture.label, layout, entries: [ { binding: 0, resource: src }, { binding: 1, resource: GPU.samplers.linearClamp } ] } );
			steps.push( { bg, desc: { label: 'mipmap', colorAttachments: [ { view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [ 0, 0, 0, 0 ] } ] } } );

		}

	}

	c = { gpu: g, pipeline, steps };
	_chains.set( texture, c );
	return c;

}

export function generateMipmaps( texture, encoder = GPU.getEncoder() ) {

	if ( texture.mipLevelCount < 2 ) return;
	const g = texture.getGPU();
	const pipeline = pipelineFor( texture.format );
	const { steps } = chainFor( texture, g, pipeline );
	for ( let i = 0; i < steps.length; i ++ ) {

		const pass = encoder.beginRenderPass( steps[ i ].desc );
		pass.setPipeline( pipeline );
		pass.setBindGroup( 0, steps[ i ].bg );
		pass.draw( 3 );
		pass.end();

	}

}
