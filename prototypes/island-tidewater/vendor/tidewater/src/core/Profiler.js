import { GPU } from '../engine/gpu/GPU.js';

// GPU timestamp profiler (enable with ?profile in the URL, or `new Profiler( renderer, { enabled: true } )`;
// needs the 'timestamp-query' feature).
//
// track( name, pass ) takes anything with a `timestampWrites` slot: ComputeKernel (dispatches that
// open their own compute pass), FullscreenPass (render()), or an object with { timestampWrites }
// used by custom passes. Each tracked pass gets two query slots; after each submit the results are
// resolved into a buffer and read back asynchronously (a ring of staging buffers, a frame or two
// late). result: { compute: ms, render: ms, items: [ { name, ms } ] sorted by cost }.
// A pass recorded several times in one frame reports its last recording; one not recorded in a frame
// reports its last measurement (it is still listed).
const MAX_PASSES = 128;

export class Profiler {

	constructor( renderer, { enabled = null } = {} ) {

		this.renderer = renderer;
		const want = enabled ?? ( typeof location !== 'undefined' && /(^|[?&])profile\b/.test( location.search || '' ) );
		this.enabled = !! want && GPU.hasTimestamp;
		this.nodes = new Map(); // name -> pass
		this.result = { compute: 0, render: 0, items: [] };
		this._t = 0;
		this._busy = false;
		this._slots = [];
		if ( ! this.enabled ) return;
		this.querySet = GPU.device.createQuerySet( { type: 'timestamp', count: MAX_PASSES * 2 } );
		this.resolveBuffer = GPU.device.createBuffer( { label: 'profiler resolve', size: MAX_PASSES * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC } );
		this.ring = [ 0, 1, 2 ].map( () => ( { buffer: GPU.device.createBuffer( { label: 'profiler read', size: MAX_PASSES * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } ), busy: false } ) );
		this._last = new Map();

	}

	track( name, node ) {

		if ( ! node ) return;
		this.nodes.set( name, node );
		if ( ! this.enabled ) return;
		const i = this._slots.length;
		if ( i >= MAX_PASSES ) return;
		this._slots.push( { name, node } );
		node.timestampWrites = { querySet: this.querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };

	}

	// resolve this frame's queries (call once per frame before GPU.submit(); App calls update() after the
	// submit, which also works: the resolve then lands in the next frame's command buffer)
	_record() {

		const n = this._slots.length;
		if ( ! n ) return;
		const slot = this.ring.find( ( s ) => ! s.busy );
		if ( ! slot ) return;
		slot.busy = true;
		const enc = GPU.getEncoder();
		enc.resolveQuerySet( this.querySet, 0, n * 2, this.resolveBuffer, 0 );
		enc.copyBufferToBuffer( this.resolveBuffer, 0, slot.buffer, 0, n * 16 );
		const names = this._slots.map( ( s ) => s.name );
		const kinds = this._slots.map( ( s ) => s.node.dispatch || ( s.node.handle ? s.node.handle.kind === 'compute' : s.node.pipeline && /Compute/.test( s.node.pipeline.constructor.name ) ) ? 'compute' : 'render' );
		GPU.onSubmit( null, () => {

			slot.buffer.mapAsync( GPUMapMode.READ ).then( () => {

				const t = new BigInt64Array( slot.buffer.getMappedRange().slice( 0 ) );
				slot.buffer.unmap();
				slot.busy = false;
				const items = [];
				if ( this.debugRaw ) console.log( 'raw', Array.from( t.slice( 0, names.length * 2 ), ( x ) => Number( x - t[ 0 ] ) / 1e6 ).map( ( x ) => x.toFixed( 3 ) ).join( ' ' ) );
				let compute = 0, render = 0;
				// Tile-based GPUs (Apple) overlap consecutive passes and report the beginning of a batch as
				// every pass's start: order the passes by their end and charge each the time since the
				// previous end (or its own start, if later). Passes are dependent, so this is their cost.
				const order = [];
				for ( let i = 0; i < names.length; i ++ ) {

					const a = t[ i * 2 ], b = t[ i * 2 + 1 ];
					if ( b > 0n && b >= a ) order.push( { i, a, b } );

				}

				order.sort( ( x, y ) => ( x.b < y.b ? - 1 : x.b > y.b ? 1 : 0 ) );
				const cost = new Map();
				let prevEnd = null;
				for ( const o of order ) {

					const start = prevEnd !== null && prevEnd > o.a ? prevEnd : o.a;
					cost.set( o.i, Number( o.b - start ) / 1e6 );
					prevEnd = o.b;

				}

				for ( let i = 0; i < names.length; i ++ ) {

					let ms = cost.get( i ) || 0;
					if ( ms > 1000 || ms < 0 ) ms = 0;
					if ( ms > 0 ) this._last.set( names[ i ], ms );
					else ms = this._last.get( names[ i ] ) || 0;
					items.push( { name: names[ i ], ms, kind: kinds[ i ] } );
					if ( kinds[ i ] === 'compute' ) compute += ms; else render += ms;

				}

				items.sort( ( x, y ) => y.ms - x.ms );
				this.result = { compute, render, items };

			} ).catch( () => {

				slot.busy = false;

			} );

		} );

	}

	update( dt ) {

		if ( ! this.enabled ) return;
		this._t += dt;
		if ( this._t > 0.5 ) {

			this._t = 0;
			this._record();

		}

	}

	// one-line summary of the most expensive passes
	summary( n = 12 ) {

		return this.result.items.slice( 0, n ).map( ( i ) => `${ i.name } ${ i.ms.toFixed( 2 ) }` ).join( ' · ' );

	}

}
