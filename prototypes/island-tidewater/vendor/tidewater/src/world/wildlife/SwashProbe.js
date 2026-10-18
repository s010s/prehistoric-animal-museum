import { StorageBuffer } from '../../engine/gpu/Texture.js';
import { ComputeKernel } from '../../engine/gpu/Compute.js';
import { Readback } from '../../engine/gpu/Readback.js';
import { G } from '../../core/Globals.js';

// Where is the edge of the swash? The run-up of the waves on the sand is analytic on the GPU
// (ShoreWaves); this evaluates it at a few points (the shorebirds) with the very same code the
// water uses, and reads the result back for the CPU (1-3 frames old, like WaterQuery).
//
// Per point: run-up of the current wave Rt and the point's own "inland" distance (both in metres
// up the beach, measured with the nominal beach slope), the speed of the leading edge (dRt/dt,
// > 0 while the water runs up) and the phase of the swash cycle.
//
// Consumes terrainHeightAt( xz ) (terrainGPU.module) and shoreEvaluateNoNormal( xz, depth, groundH )
// (shore.module). `renderer` is kept for the constructor signature (unused: the engine records the
// kernel into the frame encoder).

export class SwashProbe {

	constructor( renderer, { shore, terrainGPU, count = 32, interval = 6 } ) {

		this.renderer = renderer;
		this.shore = shore;
		this.n = count;
		this.interval = interval; // frames between dispatches (the owner extrapolates in between)
		this._frame = 0;
		this.inputs = new Float32Array( count * 4 );
		this.inputBuffer = new StorageBuffer( { label: 'swashProbeIn', count, type: 'vec4f' } );
		this.results = new StorageBuffer( { label: 'swashProbe', count, type: 'vec4f' } );
		this.readback = new Readback( { byteLength: count * 16, label: 'swashProbe' } );
		this.cpu = new Float32Array( count * 4 );
		this.valid = false;
		this.issued = new Float32Array( count * 4 ); // inputs of the latest result
		this.resultTime = 0;
		this._pending = false;
		this._inputsCopy = new Float32Array( count * 4 );
		this.active = false;

		this.kernel = new ComputeKernel( {
			label: 'Swash Probe',
			modules: [ terrainGPU.module, shore.module ],
			bindings: {
				swashIn: { storage: this.inputBuffer, access: 'read' },
				swashOut: { storage: this.results, access: 'read_write' },
			},
			workgroupSize: [ 32, 1, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let i = gid.x;
	if ( i >= ${ count }u ) { return; }
	let q = swashIn[ i ];
	if ( q.w > 0.5 ) {
		let p = q.xy;
		let ground = terrainHeightAt( p );
		let sw = shoreEvaluateNoNormal( p, frame.seaLevel - ground, ground );
		swashOut[ i ] = vec4f( sw.runup, sw.inland, sw.dRdt, sw.tau );
	}
}
`,
		} );
		this.readback.onData = ( buf ) => {

			this.cpu.set( new Float32Array( buf ) );
			this.issued.set( this._inputsCopy );
			this.resultTime = this._issuedTime;
			this.valid = true;
			this._pending = false;

		};

	}

	set( i, x, z ) {

		const o = i * 4;
		this.inputs[ o ] = x;
		this.inputs[ o + 1 ] = z;
		this.inputs[ o + 3 ] = 1;
		this.active = true;

	}

	clear( i ) {

		this.inputs[ i * 4 + 3 ] = 0;

	}

	update() {

		if ( ! this.active ) return;
		this.active = false;
		if ( this._pending || ( this._frame ++ ) % this.interval !== 0 ) return;
		this.inputBuffer.write( this.inputs );
		this.kernel.dispatch( Math.ceil( this.n / 32 ) );
		this._issuedTime = G.time.value;
		this._inputsCopy.set( this.inputs );
		this._pending = this.readback.request( this.results );

	}

	// latest result for point i: { runup, inland, speed, tau, age } (null until one arrives)
	get( i, out ) {

		if ( ! this.valid || this.issued[ i * 4 + 3 ] < 0.5 ) return null;
		const c = this.cpu, o = i * 4;
		const age = G.time.value - this.resultTime;
		const tau = c[ o + 3 ] + age / Math.max( this.shore.period.value, 1 );
		out.inland = c[ o + 1 ];
		out.x = this.issued[ o ];
		out.z = this.issued[ o + 1 ];
		out.age = age;
		if ( tau < 1 ) {

			out.runup = c[ o ] + c[ o + 2 ] * age;
			out.speed = c[ o + 2 ];

		} else {

			// the next wave has reached the shoreline since: its edge races up the beach
			const t = ( tau - 1 ) * this.shore.period.value;
			out.speed = 3.2 * Math.max( 0.2, 1 - t / 3 );
			out.runup = 0.35 + 3.2 * t * ( 1 - t / 6 );

		}

		out.tau = tau % 1;
		return out;

	}

}
