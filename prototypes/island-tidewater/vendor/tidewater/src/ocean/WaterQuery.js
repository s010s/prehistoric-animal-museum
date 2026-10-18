import { G, StorageBuffer, ShaderModule, ComputeKernel, Readback } from '../engine/webgpu.js';
import { commonModule } from '../engine/render/wgsl/common.js';

export const MAX_QUERIES = 64;

// Water surface queries on the GPU.
//   - slot 0 is always the camera (consumed the same frame by the waterline/underwater passes)
//   - other slots are gameplay points (boat hull samples, swimmer, particles...)
// Results are read back asynchronously for CPU physics (1-3 frames latency).
//
// Height is Eulerian: the FFT displacement is Lagrangian (x0 -> x0 + D(x0)), so we solve
// x0 + D(x0) = xz with a few fixed-point iterations.
//
// WGSL (prefix `waterQuery`):
//   query.resultsModule (the results buffer, read-only; cheap):
//     fn waterQueryCameraState() -> vec4f           ( height, nx, nz, sea floor ) at the camera (slot 0)
//     fn waterQueryHeightAt( slot: u32 ) -> f32
//     fn waterQueryResult( slot: u32 ) -> vec4f
//   query.heightModule (the full surface: FFT maps, shore, wake, terrain; built on first access):
//   query.module = both (built on first access)
//     fn waterQueryDispAt( x0: vec2f, depth: f32 ) -> vec3f   displacement at Lagrangian point x0
//     fn waterQueryHeightAtXZ( xz: vec2f ) -> f32              Eulerian water height at xz
export class WaterQuery {

	constructor( renderer, surface ) {

		this.renderer = renderer;
		this.surface = surface;
		this.inputs = new Float32Array( MAX_QUERIES * 4 );
		this.inputBuffer = new StorageBuffer( { label: 'waterQueryInputs', count: MAX_QUERIES, type: 'vec4f' } );
		this.results = new StorageBuffer( { label: 'waterQueryResults', count: MAX_QUERIES, type: 'vec4f', data: new Float32Array( MAX_QUERIES * 4 ) } );
		this.count = 1;
		this.cpu = new Float32Array( MAX_QUERIES * 4 );
		this.cpuValid = false;
		this._pending = false;
		// read-back bookkeeping: `version` increments with every new result, `resultTime` is the
		// simulation time the result was computed at (it arrives 1-3 frames later)
		this.version = 0;
		this.resultTime = 0;
		this.resultInputs = new Float32Array( MAX_QUERIES * 4 ); // query points of the latest result
		this._issueInputs = new Float32Array( MAX_QUERIES * 4 );
		this.latency = 0.05; // s, smoothed age of the results when they arrive
		this.frameLatency = 0;
		this.slots = new Map();
		this.readback = new Readback( { byteLength: MAX_QUERIES * 16, ring: 3, label: 'waterQuery' } );

		this.resultsModule = new ShaderModule( {
			name: 'waterQuery',
			bindings: { waterQueryResults: { storage: this.results, access: 'read' } },
			code: /* wgsl */`
fn waterQueryResult( slot: u32 ) -> vec4f { return waterQueryResults[ slot ]; }
fn waterQueryHeightAt( slot: u32 ) -> f32 { return waterQueryResults[ slot ].x; }
fn waterQueryCameraState() -> vec4f { return waterQueryResults[ 0 ]; }
`,
		} );

		this._heightModule = null;
		this._module = null;
		this.kernel = null;

	}

	// Everything (results + the Eulerian height solve). Built on first access: the wake / shore
	// attached to the surface after this query was created are part of it.
	get module() {

		if ( ! this._module ) this._module = new ShaderModule( { name: 'waterQueryAll', deps: [ this.resultsModule, this.heightModule ] } );
		return this._module;

	}

	// Returns the displacement (vec3) of the full water surface at Lagrangian point x0.
	get heightModule() {

		if ( this._heightModule ) return this._heightModule;
		const S = this.surface;
		const fft = S.fft;
		const C = fft.cascades;
		let casc = '';
		for ( let c = 0; c < C; c ++ ) {

			casc += `\td += textureSampleLevel( oceanDisplacement, smpLinearRepeat, x0 / ocean.sizes[ ${ c } ].x, ${ c }, ${ c === C - 1 ? '2.0' : '0.0' } ).xyz * waterSurfaceCascadeAttenuation( ${ c }, depth );\n`;

		}

		const SH = !! ( S.shore && S.terrain );
		this._heightModule = new ShaderModule( {
			name: 'waterQueryHeight',
			deps: [ commonModule, fft.module, S.attenuationModule, S.terrain && S.terrain.module, SH && S.shore.module, S.wake && S.wake.module ],
			uniforms: S.params,
			uniformName: 'waterSurface',
			code: /* wgsl */`
fn waterQueryDispAt( x0: vec2f, depth: f32 ) -> vec3f {
	var d = vec3f( 0.0 );
${ casc }
	d *= waterSurface.amplitude;
${ SH ? '	d += shoreEvaluateNoNormal( x0, depth, terrainHeightAt( x0 ) ).disp;' : '' }
${ S.wake ? '	d += wakeDisplacement( x0 );' : '' }
	return d;
}

fn waterQueryHeightAtXZ( p: vec2f ) -> f32 {
	let depth = ${ S.terrain ? 'frame.seaLevel - terrainHeightAt( p )' : '500.0' };
	var x0 = p;
	for ( var i = 0; i < 2; i++ ) {
		x0 = p - waterQueryDispAt( x0, depth ).xz;
	}
	return frame.seaLevel + waterQueryDispAt( x0, depth ).y;
}
`,
		} );
		return this._heightModule;

	}

	// WGSL call expression (three version: TSL node)
	heightAtNode( xz ) {

		return `waterQueryHeightAtXZ( ${ xz } )`;

	}

	_build() {

		const S = this.surface;
		this.kernel = new ComputeKernel( {
			label: 'Water Queries',
			modules: [ this.heightModule ],
			bindings: {
				queryInputs: { storage: this.inputBuffer, access: 'read' },
				queryResults: { storage: this.results, access: 'read_write' },
			},
			workgroupSize: [ 64, 1, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let i = gid.x;
	if ( i >= ${ MAX_QUERIES }u ) { return; }
	let q = queryInputs[ i ];
	let xz = q.xy;
	let h = waterQueryHeightAtXZ( xz );
	let e = 0.35;
	let hx = waterQueryHeightAtXZ( xz + vec2f( e, 0.0 ) );
	let hz = waterQueryHeightAtXZ( xz + vec2f( 0.0, e ) );
	let n = normalize( vec3f( ( h - hx ) / e, 1.0, ( h - hz ) / e ) );
	let seaFloor = ${ S.terrain ? 'terrainHeightAt( xz )' : '-500.0' };
	queryResults[ i ] = vec4f( h, n.x, n.z, seaFloor );
}`,
		} );

	}

	// ---------------------------------------------------------------- CPU API

	setCamera( x, z ) {

		this.inputs[ 0 ] = x;
		this.inputs[ 1 ] = z;

	}

	// allocate named slots (e.g. 'boat' -> 24 points). Returns the first index.
	allocate( name, n ) {

		if ( this.slots.has( name ) ) return this.slots.get( name ).start;
		const start = this.count;
		if ( start + n > MAX_QUERIES ) throw new Error( 'WaterQuery: out of slots' );
		this.slots.set( name, { start, n } );
		this.count += n;
		return start;

	}

	setPoint( i, x, z ) {

		this.inputs[ i * 4 ] = x;
		this.inputs[ i * 4 + 1 ] = z;

	}

	// last read-back results: { height, nx, nz, floor }
	get( i, out = {} ) {

		const c = this.cpu;
		out.height = c[ i * 4 ];
		out.nx = c[ i * 4 + 1 ];
		out.nz = c[ i * 4 + 2 ];
		out.floor = c[ i * 4 + 3 ];
		return out;

	}

	update() {

		// built on first use: the wake / shore attached to the surface after construction are included
		if ( ! this.kernel ) this._build();
		this.inputBuffer.write( this.inputs );
		this.kernel.dispatch( 1 );

		if ( ! this._pending ) {

			const issued = G.time.value;
			this._issueInputs.set( this.inputs );
			this.readback.onData = ( buf ) => {

				this.cpu.set( new Float32Array( buf ) );
				this.cpuValid = true;
				this._pending = false;
				this.latency += ( Math.min( G.time.value - this._issued, 0.25 ) - this.latency ) * 0.2;
				this.resultTime = this._issued;
				this.resultInputs.set( this._issueInputs );
				this.version ++;

			};
			if ( this.readback.request( this.results ) ) {

				this._pending = true;
				this._issued = issued;

			}

		}

	}

	// WGSL: camera water state (same frame), vec4f( height, nx, nz, floor ) — see query.module.
	// Returns a WGSL expression (String object) carrying `.module`, with .x/.y/.z/.w components
	// (so `query.cameraState().x` still works where the TSL node was used).
	cameraState() {

		const mk = ( e ) => {

			const o = new String( e ); // eslint-disable-line no-new-wrappers
			o.module = this.resultsModule;
			return o;

		};
		const r = mk( 'waterQueryCameraState()' );
		for ( const c of 'xyzw' ) r[ c ] = mk( `waterQueryCameraState().${ c }` );
		return r;

	}

}
