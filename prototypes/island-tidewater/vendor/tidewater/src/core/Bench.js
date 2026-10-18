import { Vector3 } from '../engine/math/index.js';
import { GPU } from '../engine/gpu/GPU.js';
import { Texture } from '../engine/gpu/Texture.js';
import { readTexture } from '../engine/gpu/Readback.js';
import { G } from './Globals.js';
import { VIEWS } from './DebugViews.js';

// Frame-time benchmark (?bench in the URL; console: `await __bench.run()`).
//
// Stops the render loop, fixes the output size, then for each view renders warm-up frames followed by
// measured frames. Every render / compute pass of a frame gets GPU timestamps automatically (the
// encoder's begin*Pass is wrapped), so the GPU time of a frame is last end - first begin, and the
// per-pass costs are charged the same way as the Profiler (ordered by end, time since the previous
// end). Wall time: frames rendered back to back with at most two in flight (CPU + GPU throughput).
//
// Views: the DebugViews review cameras plus 'boatFish' (aboard the boat in open water, looking over
// the side with the rod out) and 'boatHelm'.
const MAX = 512;
const _up = new Vector3( 0, 1, 0 );
const DEFAULT_VIEWS = [ 'beach', 'pier', 'sunGlitter', 'village', 'underwater', 'aerial', 'palms', 'boatFish' ];

export class Bench {

	constructor( app ) {

		this.app = app;
		this.enabled = GPU.hasTimestamp;
		this.frames = [];
		this._labels = [];
		this._capture = false;
		if ( ! this.enabled ) return;
		const d = GPU.device;
		this.querySet = d.createQuerySet( { type: 'timestamp', count: MAX * 2 } );
		this.resolve = d.createBuffer( { size: MAX * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC } );
		this.ring = Array.from( { length: 6 }, () => ( { buffer: d.createBuffer( { size: MAX * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } ), busy: false } ) );
		this._wrap();

	}

	_wrap() {

		const self = this;
		const proto = GPUCommandEncoder.prototype;
		const rp = proto.beginRenderPass, cp = proto.beginComputePass;
		const tag = ( desc, kind ) => {

			if ( ! self._capture || self._labels.length >= MAX ) return desc;
			const i = self._labels.length;
			self._labels.push( ( desc && desc.label ) || kind );
			return { ...( desc || {} ), timestampWrites: { querySet: self.querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } };

		};

		proto.beginRenderPass = function ( desc ) {

			return rp.call( this, tag( desc, 'render' ) );

		};

		proto.beginComputePass = function ( desc ) {

			return cp.call( this, tag( desc, 'compute' ) );

		};

		const submit = GPU.submit.bind( GPU );
		GPU.submit = () => {

			if ( self._capture && self._labels.length && GPU.encoder ) self._resolveFrame();
			submit();

		};

	}

	_resolveFrame() {

		const n = this._labels.length;
		const labels = this._labels;
		this._labels = [];
		const slot = this.ring.find( ( s ) => ! s.busy );
		if ( ! slot ) return;
		slot.busy = true;
		const enc = GPU.encoder;
		enc.resolveQuerySet( this.querySet, 0, n * 2, this.resolve, 0 );
		enc.copyBufferToBuffer( this.resolve, 0, slot.buffer, 0, n * 16 );
		GPU.onSubmit( null, () => {

			slot.buffer.mapAsync( GPUMapMode.READ ).then( () => {

				const t = new BigInt64Array( slot.buffer.getMappedRange().slice( 0, n * 16 ) );
				slot.buffer.unmap();
				slot.busy = false;
				this._frameResult( labels, t );

			} ).catch( () => {

				slot.busy = false;

			} );

		} );

	}

	_frameResult( labels, t ) {

		const order = [];
		let first = null, last = null;
		for ( let i = 0; i < labels.length; i ++ ) {

			const a = t[ i * 2 ], b = t[ i * 2 + 1 ];
			if ( b > 0n && b >= a ) {

				order.push( { i, a, b } );
				if ( first === null || a < first ) first = a;
				if ( last === null || b > last ) last = b;

			}

		}

		if ( first === null ) return;
		order.sort( ( x, y ) => ( x.b < y.b ? - 1 : x.b > y.b ? 1 : 0 ) );
		const passes = new Map();
		let prev = null;
		for ( const o of order ) {

			const start = prev !== null && prev > o.a ? prev : o.a;
			const ms = Number( o.b - start ) / 1e6;
			passes.set( labels[ o.i ], ( passes.get( labels[ o.i ] ) || 0 ) + ms );
			prev = o.b;

		}

		this.frames.push( { gpu: Number( last - first ) / 1e6, passes } );

	}

	// output size used by the benchmark (the README's target: 2560 x 1267)
	setSize( w = 2560, h = 1267 ) {

		const e = this.app.engine;
		e.canvas.width = w;
		e.canvas.height = h;
		e.camera.aspect = w / h;
		e.camera.updateProjectionMatrix();

	}

	pose( name ) {

		const app = this.app;
		if ( name === 'boatFish' || name === 'boatHelm' ) {

			const b = app.boatCtl, p = app.player;
			app.setFreeCam( false );
			b.moored = true; // held on its mooring out in open water (steady heading)
			b.position.set( 30, 0, 150 );
			b.mooring.anchor.copy( b.position );
			b.quaternion.setFromAxisAngle( _up, 0.6 );
			b.mooring.heading = 0.6;
			b.velocity.set( 0, 0, 0 );
			b.angular.set( 0, 0, 0 );
			app.settings.timeOfDay = 16.2;
			if ( name === 'boatHelm' ) {

				if ( p.mode !== 'boat' ) p.enterBoat();

			} else {

				if ( p.mode === 'boat' ) p.leaveHelm();
				if ( p.mode !== 'deck' ) p.boardBoat();
				p.deckYaw = Math.PI * 0.5;
				p.pitch = - 0.12;

			}

			return;

		}

		const v = VIEWS[ name ];
		if ( v.time !== undefined ) app.settings.timeOfDay = v.time;
		app.setFreeCam( true );
		app.fly.setPose( new Vector3( ...v.p ), v.yaw, v.pitch );
		app.fly.velocity.set( 0, 0, 0 );

	}

	async _frames( n, dt ) {

		const app = this.app;
		let pending = null;
		for ( let i = 0; i < n; i ++ ) {

			app.frame( dt );
			const done = GPU.queue.onSubmittedWorkDone();
			if ( pending ) await pending;
			pending = done;

		}

		await pending;

	}

	// ?bench&auto=tag: reference shots (tag-view.bgra), then the timings (bench-tag.json), both uploaded
	// to `url` (a local collector, see shots())
	async auto( tag, { url = 'http://127.0.0.1:5190/', runs = 1 } = {} ) {

		const views = [ ...DEFAULT_VIEWS, 'boatHelm' ];
		await this.shots( views, { tag, url } );
		// per view the fastest of the runs (clock and thermal drift only ever add time)
		let best = null;
		for ( let i = 0; i < runs; i ++ ) {

			const r = await this.run( { views, top: 60 } );
			if ( ! best ) best = r;
			else for ( const v of views ) if ( r[ v ].gpu < best[ v ].gpu ) best[ v ] = r[ v ];

		}

		best.total = {
			wall: + views.reduce( ( a, k ) => a + best[ k ].wall, 0 ).toFixed( 3 ),
			gpu: + views.reduce( ( a, k ) => a + best[ k ].gpu, 0 ).toFixed( 3 ),
		};
		await fetch( url + 'bench-' + tag + '.json', { method: 'POST', body: JSON.stringify( best ) } );
		return best.total;

	}

	// returns { view: { wall, gpu, passes } } (ms per frame; passes: the top per-pass GPU costs)
	async run( { views = DEFAULT_VIEWS, warm = 90, frames = 120, dt = 1 / 60, top = 40 } = {} ) {

		const app = this.app;
		app.engine.stop();
		this.setSize();
		const out = {};
		for ( const name of views ) {

			this.pose( name );
			G.time.value = 1000;
			await this._frames( warm, dt );
			this.frames = [];
			this._capture = true;
			const t0 = performance.now();
			await this._frames( frames, dt );
			const wall = ( performance.now() - t0 ) / frames;
			this._capture = false;
			// wait for the last read-backs
			for ( let k = 0; k < 20 && this.frames.length < frames; k ++ ) await new Promise( ( r ) => setTimeout( r, 20 ) );
			const fs = this.frames.slice();
			const gpus = fs.map( ( f ) => f.gpu ).sort( ( a, b ) => a - b );
			const passes = new Map();
			for ( const f of fs ) for ( const [ k, v ] of f.passes ) passes.set( k, ( passes.get( k ) || 0 ) + v / fs.length );
			out[ name ] = {
				wall: + wall.toFixed( 3 ),
				gpu: + ( gpus.reduce( ( a, b ) => a + b, 0 ) / gpus.length ).toFixed( 3 ),
				gpuMedian: + gpus[ gpus.length >> 1 ].toFixed( 3 ),
				cpu: + app.cpuMs.toFixed( 3 ),
				passes: [ ...passes ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, top ).map( ( [ k, v ] ) => [ k, + v.toFixed( 3 ) ] ),
			};

		}

		const names = Object.keys( out );
		out.total = {
			wall: + names.reduce( ( a, k ) => a + out[ k ].wall, 0 ).toFixed( 3 ),
			gpu: + names.reduce( ( a, k ) => a + out[ k ].gpu, 0 ).toFixed( 3 ),
		};
		this.result = out;
		return out;

	}

	// Reference shots for visual checks: on a fresh ?bench load (seeded random, no render loop), render
	// each view with the simulation clock stopped (dt = 0, so the waves, clouds, particles and animals
	// hold still and the temporal filters converge) and upload the final image (raw BGRA8 after an
	// 8-byte width / height header) to `url` + tag-view.bgra. The same sequence on the same code gives
	// the same images, so a shot before and after a change can be compared pixel by pixel.
	// dt > 0: the clock runs (animated artefacts: noise the temporal filters don't settle); one image per
	// `every` frames after the first `frames` is uploaded as tag-view-N.bgra when `seq` > 1
	async shots( views = DEFAULT_VIEWS, { tag = 'shot', frames = 64, url = 'http://127.0.0.1:5190/', dt = 0, seq = 1, every = 1 } = {} ) {

		const app = this.app;
		app.engine.stop();
		this.setSize();
		const { width, height } = app.engine.canvas;
		if ( ! this._out || this._out.width !== width || this._out.height !== height ) this._out = new Texture( { width, height, format: GPU.format, usage: [ 'render', 'copySrc', 'sample' ], label: 'bench output' } );
		G.time.value = 1000;
		for ( const name of views ) {

			this.pose( name );
			app.post.outputTexture = this._out;
			try {

				const lookSun = VIEWS[ name ] && VIEWS[ name ].lookSun;
				if ( lookSun ) {

					// the sun follows the time of day set by pose(): aim once the sky has updated
					await this._frames( 2, dt );
					const d = G.sunDir.value;
					app.fly.setPose( app.fly.camera.position.clone(), Math.atan2( - d.x, - d.z ) + lookSun[ 0 ], Math.asin( d.y ) + lookSun[ 1 ] );

				}

				await this._frames( frames, dt );
				for ( let k = 0; k < seq; k ++ ) {

					if ( k > 0 ) await this._frames( every, dt );
					const img = await readTexture( this._out );
					const body = new Uint8Array( 8 + img.data.byteLength );
					new Uint32Array( body.buffer, 0, 2 ).set( [ img.width, img.height ] );
					body.set( new Uint8Array( img.data ), 8 );
					await fetch( url + tag + '-' + name + ( seq > 1 ? '-' + k : '' ) + '.bgra', { method: 'POST', body } );

				}

			} finally {

				app.post.outputTexture = null;

			}

		}

		return tag;

	}

}
