import { GPU } from './GPU.js';
import { composeShader, createShaderModule } from './Shader.js';

// A compute pipeline built from modules + a main WGSL body.
//
//   const k = new ComputeKernel( {
//     label: 'fft rows',
//     modules: [ fftModule ],
//     bindings: { waveData: { storage: waveBuf, access: 'read_write' } },
//     workgroupSize: [ 256, 1, 1 ],
//     code: /* wgsl */`
//       @compute @workgroup_size( WG_X, WG_Y, WG_Z )
//       fn main( @builtin( global_invocation_id ) gid: vec3u ) { ... }`,
//   } );
//   k.dispatch( Math.ceil( n / 256 ) );              // records into the frame encoder
//   k.dispatch( [ x, y, z ], { pass } );             // or into an open compute pass
//
// WG_X / WG_Y / WG_Z are substituted from workgroupSize. The entry point must be `main` unless
// `entryPoint` is given. Several kernels can share one pass: GPU.computePass( label, ( pass ) => { a.dispatch( n, { pass } ); b.dispatch( m, { pass } ); } ).

export class ComputeKernel {

	constructor( { label = 'kernel', modules = [], bindings = {}, code, workgroupSize = [ 64, 1, 1 ], defines = {}, entryPoint = 'main' } ) {

		this.label = label;
		this.workgroupSize = workgroupSize;
		const [ x, y = 1, z = 1 ] = workgroupSize;
		const body = code.replace( /\bWG_X\b/g, x ).replace( /\bWG_Y\b/g, y ).replace( /\bWG_Z\b/g, z );
		const c = composeShader( { modules, bindings, code: body, defines, stage: 'compute', label } );
		this.source = c.code;
		this.bindings = c.bindings;
		this.group0 = c.group0;
		const module = createShaderModule( c.code, label );
		this.handle = GPU.computePipeline( {
			label,
			layout: GPU.device.createPipelineLayout( { bindGroupLayouts: [ c.group0.layout, c.bindings.layout ] } ),
			compute: { module, entryPoint },
		} );
		this.timestampWrites = null; // set by the profiler

	}

	get pipeline() {

		return GPU.ready( this.handle );

	}

	// counts: number of workgroups (x) or [ x, y, z ]
	dispatch( counts, { pass = null, indirect = null } = {} ) {

		const [ x, y = 1, z = 1 ] = Array.isArray( counts ) ? counts : [ counts ];
		if ( ! indirect && ( x === 0 || y === 0 || z === 0 ) ) return;
		const run = ( p ) => {

			p.setPipeline( GPU.ready( this.handle ) );
			p.setBindGroup( 0, this.group0.getBindGroup() );
			p.setBindGroup( 1, this.bindings.getBindGroup() );
			if ( indirect ) p.dispatchWorkgroupsIndirect( indirect.buffer.getGPU ? indirect.buffer.getGPU() : indirect.buffer, indirect.offset || 0 );
			else p.dispatchWorkgroups( x, y, z );

		};

		if ( pass ) run( pass );
		else GPU.computePass( this.label, run, this.timestampWrites || undefined );

	}

	// threads -> workgroups helper
	groups( nx, ny = 1, nz = 1 ) {

		const [ x, y = 1, z = 1 ] = this.workgroupSize;
		return [ Math.ceil( nx / x ), Math.ceil( ny / y ), Math.ceil( nz / z ) ];

	}

}
